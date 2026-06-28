# Copy Workspace Feature — Design Spec
**Date:** 2026-06-28

## Overview

Extend the "Create Workspace" dialog with an optional "Copy from existing workspace" mode. When enabled, the user picks a source workspace and selects which entity types to copy. A new backend endpoint handles creation and copying atomically.

## Scope

Entities that can be copied (each independently toggleable):
- **Agents** — full copy including skills and env vars
- **Squads** — full copy including members (agent members remapped; human members dropped)
- **Autopilots** — full copy including all trigger types; run history dropped
- **Wiki** — full page tree copy including full revision history
- **Issues** — all issues; two-pass to preserve parent hierarchy

Out of scope: autopilot run history, member (human) assignee/author references (dropped, not reassigned).

---

## Backend

### Endpoint

```
POST /api/workspaces/copy
```

**Request body:**
```json
{
  "name": "My New Workspace",
  "slug": "my-new-workspace",
  "source_workspace_id": "<uuid>",
  "copy": {
    "agents": true,
    "squads": true,
    "autopilots": true,
    "wiki": true,
    "issues": true
  }
}
```

**Response:** `201 Created` with `WorkspaceResponse` (same shape as `POST /api/workspaces`).

**Authorization:** caller must be a member of the source workspace (read access sufficient). Same slug/name validation as regular `CreateWorkspace`.

### Handler

New func `CopyWorkspace` in `server/internal/handler/workspace.go`.

Route registered in `router.go` as `POST /api/workspaces/copy` — must appear **before** the `{id}` wildcard route to avoid routing conflict.

### Transaction Logic

Everything runs in a single Postgres transaction. Rollback on any error leaves no orphaned workspace.

**Copy order (dependency-aware):**

1. **Create workspace** — validate slug, create workspace row, add caller as owner member. Same logic as `CreateWorkspace`.

2. **Agents** (if `copy.agents`)
   - Copy all `agent` rows from source workspace. New UUIDs for all.
   - Copy `agent_skills`: find-or-create skill by name in new workspace, attach to new agent.
   - Copy `agent_env`: full copy including encrypted secret values.
   - Build map: `oldAgentID -> newAgentID`.

3. **Squads** (if `copy.squads`)
   - Copy all `squad` rows. New UUIDs.
   - Copy `squad_member` rows:
     - `member_type = agent` -> remap `member_id` via agent map (skip if source agent not copied)
     - `member_type = member` -> drop
   - Build map: `oldSquadID -> newSquadID`.

4. **Autopilots** (if `copy.autopilots`)
   - Copy all `autopilot` rows. New UUIDs.
   - Remap `assignee_id`:
     - `assignee_type = agent` -> remap via agent map
     - `assignee_type = squad` -> remap via squad map
   - Copy all `autopilot_trigger` rows (cron, webhook, api).
   - Skip `autopilot_run` and `autopilot_subscriber` rows.
   - Build map: `oldAutopilotID -> newAutopilotID`.

5. **Wiki** (if `copy.wiki`)
   - Recursive copy of `wiki_page` tree: process pages in parent-first order. Build `oldPageID -> newPageID` map; remap `parent_id` and `current_revision_id`.
   - Copy all `wiki_revision` rows per page:
     - `author_type = agent` -> remap `author_id` via agent map
     - `author_type = member` -> set `author_id = NULL`
   - Same for `reviewed_by_id`.

6. **Issues** (if `copy.issues`)
   - **Pass 1:** copy all `issue` rows with new UUIDs. Remap assignees:
     - `assignee_type = agent` -> remap via agent map
     - `assignee_type = squad` -> remap via squad map
     - `assignee_type = member` -> `assignee_id = NULL`
   - Remap `creator_id` same way. Set `parent_issue_id = NULL` during pass 1.
   - Build `oldIssueID -> newIssueID` map.
   - Re-sequence `number` field (1..N for new workspace).
   - **Pass 2:** update `parent_issue_id` for all issues that had a parent.

---

## Frontend

### Files Changed

| File | Change |
|------|--------|
| `packages/views/modals/create-workspace.tsx` | Pass workspace list + copy state into form |
| `packages/views/workspace/create-workspace-form.tsx` | Add copy toggle, source dropdown, entity checkboxes |
| `packages/core/workspace/mutations.ts` | Add `useCopyWorkspace` mutation |
| `packages/core/types/workspace.ts` | Add `CopyWorkspaceRequest` type |

### UI

The existing dialog gains a collapsible section below name/slug:

```
Name  [_____________________]
Slug  [_____________________]

[ ] Copy from existing workspace

(when enabled):
Source  [dropdown of user's workspaces ▾]

What to copy:
[x] Agents      [x] Squads
[x] Autopilots  [x] Wiki
[x] Issues

                [Cancel]  [Create]
```

### Form State Additions

```ts
copyEnabled: boolean                 // default false
sourceWorkspaceId: string | null     // required when copyEnabled
copySelections: {                    // all default true when toggled on
  agents: boolean
  squads: boolean
  autopilots: boolean
  wiki: boolean
  issues: boolean
}
```

Validation: if `copyEnabled`, `sourceWorkspaceId` required + at least one entity selected.

### Submission

- `copyEnabled = false` -> existing `createWorkspace` mutation (no change)
- `copyEnabled = true` -> new `copyWorkspace` mutation (`POST /api/workspaces/copy`)
- On success: navigate to `/{newSlug}/issues`

### Loading / Error States

- Submit button shows spinner + "Copying..." while in-flight.
- Dialog stays open until success or error.
- Errors displayed inline (same pattern as existing form).

### Workspace Dropdown

Populated from existing `useWorkspaces()` query — no new query needed.

---

## Error Cases

| Case | Response |
|------|----------|
| Slug already taken | 409 Conflict |
| Source workspace not found / caller not member | 403 Forbidden |
| Invalid slug format | 400 Bad Request |
| Workspace creation disabled | 403 Forbidden |
| DB error mid-copy | 500, full rollback — no orphaned workspace |

---

## Out of Scope

- Async / background copy
- Copying workspace settings, integrations, repos config
- Copying labels or projects
- Progress indicator beyond a spinner
