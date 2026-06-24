"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { allInboxListOptions } from "@multica/core/inbox/queries";
import { getLastIssuePath } from "@multica/core/inbox/last-issue-path";
import { paths } from "@multica/core/paths";
import type { UnifiedInboxItem, InboxItemType } from "@multica/core/types";
import { StatusIcon } from "../../issues/components";
import { useTimeAgo } from "./inbox-list-item";
import { getInboxDisplayTitle } from "./inbox-display";

// Human-readable labels for each event type — no i18n needed for a self-hosted
// personal tool; these just need to distinguish events in the list.
const TYPE_LABEL: Record<InboxItemType, string> = {
  issue_assigned: "Assigned to you",
  issue_subscribed: "Subscribed",
  unassigned: "Unassigned",
  assignee_changed: "Assignee changed",
  status_changed: "Status changed",
  priority_changed: "Priority changed",
  start_date_changed: "Start date changed",
  due_date_changed: "Due date changed",
  new_comment: "New comment",
  mentioned: "Mentioned you",
  review_requested: "Review requested",
  task_completed: "Task completed",
  task_failed: "Task failed",
  agent_blocked: "Agent blocked",
  agent_completed: "Agent completed",
  reaction_added: "Reacted",
  quick_create_done: "Quick create done",
  quick_create_failed: "Quick create failed",
  wiki_proposal: "Wiki proposal",
};

function inboxSubtitle(item: UnifiedInboxItem): string {
  const details = (item.details ?? {}) as Record<string, string>;
  switch (item.type) {
    case "new_comment":
      return item.body ? item.body : TYPE_LABEL[item.type];
    case "status_changed":
      return details.to ? `Status → ${details.to}` : TYPE_LABEL[item.type];
    case "priority_changed":
      return details.to ? `Priority → ${details.to}` : TYPE_LABEL[item.type];
    case "wiki_proposal":
      return details.page_title ? `Wiki proposal · ${details.page_title}` : TYPE_LABEL[item.type];
    case "quick_create_done":
      return details.identifier ? `Created ${details.identifier}` : TYPE_LABEL[item.type];
    default:
      return TYPE_LABEL[item.type] ?? item.type;
  }
}

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
  const subtitle = inboxSubtitle(item);

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
          <span className={`truncate text-sm ${!item.read ? "font-medium text-foreground" : "text-foreground"}`}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceBadge name={item.workspace_name} />
          <span className="truncate text-xs text-muted-foreground flex-1">
            {subtitle}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
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
    // h-svh pins to viewport height so flex-1 child can scroll within the
    // body's overflow-hidden constraint.
    <div className="flex h-svh flex-col bg-background">
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
