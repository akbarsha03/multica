# Excel Sheet Preview — Design Spec
**Date:** 2026-07-23

## Overview

Add `.xlsx`/`.xlsm` as a new previewable attachment kind so the existing Eye-button preview infrastructure (currently image/pdf/video/audio/markdown/html/text) also handles Excel files. No new UI surface is needed — the Eye button already appears generically wherever `AttachmentCard` renders (chat messages, issue comments, file-cards) once a file's `PreviewKind` is non-null; this feature only adds a new kind to that dispatch table plus its renderer.

## Scope

**In scope:**
- Detect `.xlsx` / `.xlsm` (by extension or OOXML content-type) as a new `"spreadsheet"` `PreviewKind`.
- Render all sheets as tabs (workbook can have >1 sheet).
- Cap rendering at 500 rows / 100 columns per sheet, with a truncation banner + Download CTA for the rest.
- Server-side fetch cap of 10 MB for this kind (vs 2 MB for existing text kinds).

**Out of scope:**
- Legacy binary `.xls` — not detected as a previewable kind; falls through to the existing Download-only path (Eye button simply doesn't show), same as any other unrecognized binary type today.
- Upgrading `.csv`/`.tsv` to a table renderer — they already preview fine as plaintext via the existing `"text"` kind; changing that is unrelated to this task.
- Editing, exporting, or any write path — preview is read-only, mirroring every other kind.

## Dependency

Add [`read-excel-file`](https://www.npmjs.com/package/read-excel-file) (^9.3.4) — not the more famous `xlsx` (SheetJS): the version SheetJS publishes to the public npm registry has two known unpatched CVEs (ReDoS + prototype pollution); their patched builds only ship via SheetJS's own CDN, not npm. `read-excel-file` is smaller, actively maintained, has no known CVEs, and its default export already returns exactly the shape this feature needs: `[{ name: string, data: unknown[][] }, ...]` — one entry per sheet, fitting the sheet-tabs requirement directly.

- `pnpm-workspace.yaml` catalog: add `read-excel-file: "^9.3.4"` (mirrors how `mermaid` is catalog-pinned despite being a single-package dependency).
- `packages/views/package.json`: add `"read-excel-file": "catalog:"`.

## Client changes

### 1. Preview kind detection — `packages/views/editor/utils/preview.ts`

- Add `"spreadsheet"` to the `PreviewKind` union.
- Add `SPREADSHEET_EXTS = new Set(["xlsx", "xlsm"])` and a content-type check for `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/vnd.ms-excel.sheet.macroEnabled.12`.
- In `getPreviewKind`, add a branch returning `"spreadsheet"` before the `isTextLike` check (same position as the existing pdf/video/audio branches) — ordering doesn't matter for correctness here since spreadsheet ext/content-types never overlap with the text whitelist, but keeping it grouped with the other binary kinds matches the file's existing organization.
- Update the file's "keep in sync with server" comment to mention the new server-side `isSpreadsheetPreviewable`.

No change needed in `attachment-card.tsx` — `canPreview` is already generic over any non-null `PreviewKind`, and since `"spreadsheet"` is deliberately NOT added to `isUrlPreviewableKind` (it needs the attachment ID to hit the authenticated `/content` proxy, same as markdown/html/text), the existing `canPreview = !!href && kind !== null && (!!attachmentId || isUrlPreviewableKind)` gate already does the right thing unmodified.

### 2. Server — `server/internal/handler/file.go`

- New `isSpreadsheetPreviewable(contentType, filename string) bool` alongside `isTextPreviewable`, checking the same ext/content-type set as the client.
- New constant `maxPreviewSpreadsheetSize = 10 << 20` (10 MB) alongside `maxPreviewTextSize`.
- In `GetAttachmentContent`:
  - Reject (415) only if neither `isTextPreviewable` nor `isSpreadsheetPreviewable` matches.
  - Pick the size cap (`maxPreviewSpreadsheetSize` vs `maxPreviewTextSize`) based on which whitelist matched.
  - For the spreadsheet branch, respond with `Content-Type: application/octet-stream` instead of the forced `text/plain; charset=utf-8` the text branch uses — the client reads this response as bytes (`arrayBuffer()`), never decodes it as text, and `octet-stream` is the correct "don't try to interpret this" signal for a binary payload. `X-Content-Type-Options: nosniff` and the existing security headers helper still apply unchanged.
  - `X-Original-Content-Type` header still set for parity, though the spreadsheet client path doesn't need it (kind is already known from the attachment record).

### 3. API client — `packages/core/api/client.ts`

New method alongside `getAttachmentTextContent`:

```ts
async getAttachmentBinaryContent(id: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await this.fetchRaw(`/api/attachments/${id}/content`);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 413) throw new PreviewTooLargeError();
      if (err.status === 415) throw new PreviewUnsupportedError();
    }
    throw err;
  }
  return res.arrayBuffer();
}
```

Reuses the existing `PreviewTooLargeError` / `PreviewUnsupportedError` classes — same 413/415 semantics, no new error types needed.

### 4. New hook — `packages/views/editor/hooks/use-attachment-binary-content.ts`

Same shape as `use-attachment-html-text.ts`, but wraps `api.getAttachmentBinaryContent`:

```ts
export function useAttachmentBinaryContent(attachmentId: string | null | undefined) {
  return useQuery({
    queryKey: ["attachment-binary-content", attachmentId ?? ""] as const,
    queryFn: () => api.getAttachmentBinaryContent(attachmentId as string),
    enabled: !!attachmentId,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
```

### 5. New component — `packages/views/editor/spreadsheet-preview.tsx`

- Lazily loads `read-excel-file` via a memoized dynamic import, mirroring the existing pattern in `mermaid-diagram.tsx`:
  ```ts
  let readExcelPromise: Promise<typeof import("read-excel-file")> | undefined;
  function loadReadExcelFile() {
    readExcelPromise ??= import("read-excel-file");
    return readExcelPromise;
  }
  ```
- Takes `attachmentId` + `onDownload`. Fetches via `useAttachmentBinaryContent`, then feeds the resolved `ArrayBuffer` into a second, chained `useQuery` (`queryKey: ["attachment-spreadsheet-parse", attachmentId]`, `enabled: !!binaryQuery.data`) whose `queryFn` does the dynamic import + `readSheet`/default-export parse. Two chained queries (not `useEffect`/`useState`) keeps loading/error state handling identical in shape to `TextBackedPreview`'s single-query pattern, just with an extra link in the chain.
- States, matching `TextBackedPreview`'s existing shape:
  - Loading → same spinner + `attachment.preview_loading`.
  - Fetch error (413/415) → same `UnsupportedFallback`-equivalent messages (`preview_too_large` / `preview_unsupported`) — this component owns a small local copy of that fallback markup rather than importing the modal's private `UnsupportedFallback`, keeping the modal file's internals private as today.
  - Parse failure (corrupt file) → `preview_failed`.
  - Empty workbook (zero sheets or zero rows) → `preview_failed` as well; not worth a dedicated empty-state string for a genuinely rare case.
- Success render:
  - If `sheets.length > 1`: `Tabs`/`TabsList`/`TabsTrigger` from `@multica/ui` (`variant="line"`), one trigger per sheet name, local `useState` for the active index (ephemeral view state, not Zustand — scoped to one modal instance).
  - `<table>` of the active sheet's `data`, sliced to first 500 rows and first 100 columns, styled with Tailwind utility classes directly on the elements (matching `CodeBlockStatic`'s approach — no new CSS file).
  - If truncated (either dimension), a banner above or below the table using a new i18n key `attachment.spreadsheet_truncated` with `{{shown}}`/`{{total}}` params, plus the existing Download CTA.

### 6. Modal dispatch — `packages/views/editor/attachment-preview-modal.tsx`

- Add `"spreadsheet"` to the defensive `attachmentId`-required guard list (alongside `"markdown" | "html" | "text"`).
- Add a `case "spreadsheet":` in `PreviewContent`'s switch, rendering `<SpreadsheetPreview attachmentId={state.attachmentId!} onDownload={onDownload} />`.
- `URL_ONLY_KINDS` stays unchanged (`image, pdf, video, audio`) — `"spreadsheet"` is correctly excluded, so `tryOpen` on a URL-only source with a spreadsheet filename returns `false` and callers fall back to download, same as markdown/html/text today.

### 7. i18n — `packages/views/locales/{en,ja,ko,zh-Hans}/editor.json`

One new key under `attachment`:
- `en`: `"spreadsheet_truncated": "Showing first {{shown}} of {{total}} rows — download for the full file."`
- Equivalent translations added to `ja`, `ko`, `zh-Hans` (best-effort; matches the tone of the existing `preview_too_large` string in each locale).

## Testing

Extend the existing test files that already cover this exact machinery — no new test files beyond the two new source files' own colocated tests:
- `packages/views/editor/utils/preview.test.ts`: `.xlsx`/`.xlsm` → `"spreadsheet"`; `.xls` → `null` (unchanged/no Eye button); OOXML content-type variants.
- `packages/core/api/client.test.ts`: `getAttachmentBinaryContent` 200 (returns bytes), 413 → `PreviewTooLargeError`, 415 → `PreviewUnsupportedError` — mirrors the existing `getAttachmentTextContent` describe block.
- `packages/views/editor/attachment-preview-modal.test.tsx`: mounts the modal with a fake spreadsheet attachment, mocks the binary fetch + `read-excel-file`, asserts the table renders, tabs appear for a multi-sheet fixture, and the truncation banner appears past the row cap.
- `server/internal/handler/file_test.go` (wherever `isTextPreviewable`/`GetAttachmentContent` are currently tested): `isSpreadsheetPreviewable` cases, and a `GetAttachmentContent` case confirming the 10 MB cap and `application/octet-stream` response for a spreadsheet-typed attachment vs the existing 2 MB / `text/plain` behavior for text kinds.
