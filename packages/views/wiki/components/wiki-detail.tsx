"use client";

import { useState, useRef, useCallback } from "react";
import { Archive, BookOpen, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { wikiPageOptions, wikiRevisionsOptions, wikiProposalsOptions } from "@multica/core/wiki/queries";
import { useUpdateWikiPage, useArchiveWikiPage } from "@multica/core/wiki/mutations";
import { Button } from "@multica/ui/components/ui/button";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { ContentEditor, type ContentEditorRef, ReadonlyContent } from "../../editor";
import { useNavigation } from "../../navigation";
import { PageHeader } from "../../layout/page-header";
import { cn } from "@multica/ui/lib/utils";
import type { WikiRevision } from "@multica/core/types";

interface WikiDetailProps {
  pageId: string;
}

export function WikiDetail({ pageId }: WikiDetailProps) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const router = useNavigation();

  const { data: page, isLoading } = useQuery(wikiPageOptions(wsId, pageId));
  const { data: revisions = [] } = useQuery(wikiRevisionsOptions(wsId, pageId));
  const { data: allProposals = [] } = useQuery(wikiProposalsOptions(wsId));

  const updatePage = useUpdateWikiPage();
  const archivePage = useArchiveWikiPage();

  const [title, setTitle] = useState<string>("");
  const [titleInitialized, setTitleInitialized] = useState(false);

  // Sync title from server once on load
  if (page && !titleInitialized) {
    setTitle(page.title);
    setTitleInitialized(true);
  }

  // Reset when pageId changes
  const prevPageIdRef = useRef(pageId);
  if (prevPageIdRef.current !== pageId) {
    prevPageIdRef.current = pageId;
    setTitleInitialized(false);
    if (page) {
      setTitle(page.title);
      setTitleInitialized(true);
    }
  }

  const editorRef = useRef<ContentEditorRef>(null);

  // Debounced content save
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedContentSave = useCallback(
    (md: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (!page) return;
        updatePage.mutate({ id: pageId, title: title || page.title, content: md });
      }, 1500);
    },
    [page, pageId, title, updatePage],
  );

  const handleTitleBlur = () => {
    if (!page) return;
    const content = editorRef.current?.getMarkdown() ?? page.content;
    updatePage.mutate({ id: pageId, title: title || "Untitled", content });
  };

  const handleArchive = () => {
    if (!window.confirm("Archive this page?")) return;
    archivePage.mutate(pageId, {
      onSuccess: () => router.push(paths.wiki()),
    });
  };

  const pendingProposals = allProposals.filter(
    (r: WikiRevision) => r.page_id === pageId && r.status === "proposed",
  );

  const newestFirstRevisions = [...revisions].sort(
    (a: WikiRevision, b: WikiRevision) => b.created_at.localeCompare(a.created_at),
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        <PageHeader className="gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <Skeleton className="h-4 w-32" />
        </PageHeader>
        <div className="mx-auto w-full max-w-3xl px-8 py-8 space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p className="text-sm">Page not found.</p>
        <Button variant="outline" size="sm" onClick={() => router.push(paths.wiki())}>
          Back to Wiki
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="gap-2 justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{page.title || "Untitled"}</span>
        </div>
        <div className="flex items-center gap-2">
          {pendingProposals.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => {
                // TODO(wiki): open review dialog (Task 4)
              }}
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {pendingProposals.length}
              </span>
              Review {pendingProposals.length} proposal{pendingProposals.length !== 1 ? "s" : ""}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive"
            onClick={handleArchive}
            disabled={archivePage.isPending}
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Button>
        </div>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-8 space-y-6">
          {/* Editable title */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="Untitled"
            className="w-full text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground/50 text-foreground"
          />

          {/* Body editor */}
          <ContentEditor
            key={pageId}
            ref={editorRef}
            defaultValue={page.content}
            onUpdate={debouncedContentSave}
            debounceMs={1500}
            placeholder="Write something..."
            className="min-h-[200px]"
          />

          {/* History section */}
          {newestFirstRevisions.length > 0 && (
            <div className="border-t pt-6 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                History ({newestFirstRevisions.length} revision{newestFirstRevisions.length !== 1 ? "s" : ""})
              </div>
              <div className="space-y-4">
                {newestFirstRevisions.map((rev: WikiRevision) => (
                  <RevisionCard key={rev.id} revision={rev} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RevisionCard({ revision }: { revision: WikiRevision }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-accent/50 transition-colors rounded-lg"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            revision.status === "merged"
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : revision.status === "proposed"
                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                : "bg-muted text-muted-foreground",
          )}
        >
          {revision.status}
        </span>
        <span className="flex-1 truncate font-medium text-foreground">{revision.title || "Untitled"}</span>
        {revision.summary && (
          <span className="truncate text-xs text-muted-foreground max-w-[30%]">{revision.summary}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(revision.created_at).toLocaleDateString()}
        </span>
      </button>
      {expanded && (
        <div className="border-t px-4 py-3">
          <ReadonlyContent content={revision.content} />
        </div>
      )}
    </div>
  );
}
