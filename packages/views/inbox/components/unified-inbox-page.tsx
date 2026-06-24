"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { allInboxListOptions } from "@multica/core/inbox/queries";
import { getLastIssuePath } from "@multica/core/inbox/last-issue-path";
import { paths } from "@multica/core/paths";
import type { UnifiedInboxItem } from "@multica/core/types";
import { StatusIcon } from "../../issues/components";
import { useTimeAgo } from "./inbox-list-item";
import { getInboxDisplayTitle } from "./inbox-display";

function WorkspaceBadge({ name }: { name: string }) {
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wide">
      {name}
    </span>
  );
}

function UnifiedInboxListItem({
  item,
  onClick,
}: {
  item: UnifiedInboxItem;
  onClick: () => void;
}) {
  const timeAgo = useTimeAgo();
  const title = getInboxDisplayTitle(item);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-6 py-3 text-left transition-colors hover:bg-accent/50 border-b border-border/50 last:border-b-0"
    >
      <div className="mt-0.5 shrink-0">
        {item.issue_status ? (
          <StatusIcon status={item.issue_status} className="size-4" />
        ) : (
          <div className="size-4 rounded-full bg-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5 mb-0.5">
          {!item.read && (
            <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-brand" />
          )}
          <span className="truncate text-sm text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceBadge name={item.workspace_name} />
          <span className="text-xs text-muted-foreground">
            {timeAgo(item.created_at)}
          </span>
        </div>
      </div>
    </button>
  );
}

export function UnifiedInboxPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthLoading = useAuthStore((s) => s.isLoading);

  const { data: items = [], isLoading, isError, error } = useQuery({
    ...allInboxListOptions(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.replace(`${paths.login()}?next=/inbox`);
    }
  }, [isAuthLoading, user, router]);

  useEffect(() => {
    if (isError && (error as { status?: number })?.status === 403) {
      router.replace("/");
    }
  }, [isError, error, router]);

  // Cmd/Ctrl+J from the unified inbox → back to last visited issue
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== "j" && e.key !== "J") || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const last = getLastIssuePath();
      if (last) router.push(last);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  if (isAuthLoading || !user) return null;

  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center border-b px-6 gap-3">
        <h1 className="text-sm font-semibold">Inbox</h1>
        {unread > 0 && (
          <span className="text-xs text-muted-foreground">{unread} unread</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            All caught up
          </div>
        ) : (
          <div>
            {items.map((item) => (
              <UnifiedInboxListItem
                key={item.id}
                item={item}
                onClick={() => {
                  if (item.issue_id) {
                    router.push(`/${item.workspace_slug}/issues/${item.issue_id}`);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
