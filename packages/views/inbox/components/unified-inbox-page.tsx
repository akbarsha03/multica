"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { allInboxListOptions, unifiedInboxKeys } from "@multica/core/inbox/queries";
import { getLastIssuePath } from "@multica/core/inbox/last-issue-path";
import { paths } from "@multica/core/paths";
import { api } from "@multica/core/api";
import type { UnifiedInboxItem, InboxItemType } from "@multica/core/types";
import { StatusIcon } from "../../issues/components";
import { useTimeAgo } from "./inbox-list-item";
import { getInboxDisplayTitle } from "./inbox-display";

// ─── types ────────────────────────────────────────────────────────────────────

type InboxGroup = {
  key: string;
  items: UnifiedInboxItem[];  // sorted latest-first by the API
  latest: UnifiedInboxItem;
  hasUnread: boolean;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<InboxItemType, string> = {
  issue_assigned:      "Assigned to you",
  issue_subscribed:    "Subscribed",
  unassigned:          "Unassigned",
  assignee_changed:    "Assignee changed",
  status_changed:      "Status changed",
  priority_changed:    "Priority changed",
  start_date_changed:  "Start date changed",
  due_date_changed:    "Due date changed",
  new_comment:         "New comment",
  mentioned:           "Mentioned you",
  review_requested:    "Review requested",
  task_completed:      "Task completed",
  task_failed:         "Task failed",
  agent_blocked:       "Agent blocked",
  agent_completed:     "Agent completed",
  reaction_added:      "Reacted",
  quick_create_done:   "Quick create done",
  quick_create_failed: "Quick create failed",
  wiki_proposal:       "Wiki proposal",
};

function inboxSubtitle(item: UnifiedInboxItem): string {
  const details = (item.details ?? {}) as Record<string, string>;
  switch (item.type) {
    case "new_comment":
      return item.body ?? TYPE_LABEL[item.type];
    case "status_changed":
      return details.to ? `Status → ${details.to}` : TYPE_LABEL[item.type];
    case "priority_changed":
      return details.to ? `Priority → ${details.to}` : TYPE_LABEL[item.type];
    case "wiki_proposal":
      return details.page_title
        ? `Wiki proposal · ${details.page_title}`
        : TYPE_LABEL[item.type];
    case "quick_create_done":
      return details.identifier
        ? `Created ${details.identifier}`
        : TYPE_LABEL[item.type];
    default:
      return TYPE_LABEL[item.type] ?? item.type;
  }
}

/** Group items by issue_id. Items without issue_id each form their own group. */
function groupItems(items: UnifiedInboxItem[]): InboxGroup[] {
  const map = new Map<string, UnifiedInboxItem[]>();

  for (const item of items) {
    const key = item.issue_id ?? `solo:${item.id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return Array.from(map.entries()).map(([key, groupItems]) => ({
    key,
    items: groupItems,
    latest: groupItems[0]!, // API returns latest-first
    hasUnread: groupItems.some((i) => !i.read),
  }));
}

// ─── sub-components ───────────────────────────────────────────────────────────

function WorkspaceBadge({ name }: { name: string }) {
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wide">
      {name}
    </span>
  );
}

function InboxGroupItem({
  group,
  onNavigate,
  onMarkRead,
}: {
  group: InboxGroup;
  onNavigate: () => void;
  onMarkRead: () => void;
}) {
  const timeAgo = useTimeAgo();
  const { latest, hasUnread } = group;
  const title = getInboxDisplayTitle(latest);
  const subtitle = inboxSubtitle(latest);
  const count = group.items.length;

  return (
    <div className="group flex w-full items-start gap-3 px-6 py-3 border-b border-border/50 last:border-b-0 hover:bg-accent/50 transition-colors">
      {/* status icon */}
      <div className="mt-0.5 shrink-0">
        {latest.issue_status ? (
          <StatusIcon status={latest.issue_status} className="size-4" />
        ) : (
          <div className="size-4 rounded-full bg-muted" />
        )}
      </div>

      {/* main content — clicking navigates */}
      <button
        type="button"
        onClick={onNavigate}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-start gap-1.5 mb-0.5">
          {hasUnread && (
            <span className="mt-[5px] size-1.5 shrink-0 rounded-full bg-brand" />
          )}
          <span className={`truncate text-sm ${hasUnread ? "font-medium text-foreground" : "text-foreground"}`}>
            {title}
          </span>
          {count > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground leading-none">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceBadge name={latest.workspace_name} />
          <span className="truncate text-xs text-muted-foreground flex-1">
            {subtitle}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(latest.created_at)}
          </span>
        </div>
      </button>

      {/* mark-read button — visible on hover, only when unread */}
      {hasUnread && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
          title="Mark as read"
          className="mt-0.5 shrink-0 hidden group-hover:flex items-center justify-center size-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function UnifiedInboxPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAuthLoading = useAuthStore((s) => s.isLoading);

  const { data: items = [], isLoading, isError, error } = useQuery({
    ...allInboxListOptions(),
    enabled: !!user,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markUnifiedInboxRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: unifiedInboxKeys.list() });
    },
  });

  const markGroupRead = useCallback(
    (group: InboxGroup) => {
      const unreadIds = group.items.filter((i) => !i.read).map((i) => i.id);
      // Optimistic update: mark all items in the group as read in cache
      qc.setQueryData<UnifiedInboxItem[]>(
        unifiedInboxKeys.list(),
        (prev = []) => prev.map((i) => unreadIds.includes(i.id) ? { ...i, read: true } : i),
      );
      // Fire requests for each unread item (they're cheap individual calls)
      for (const id of unreadIds) markReadMutation.mutate(id);
    },
    [qc, markReadMutation],
  );

  const markAllRead = useCallback(() => {
    const groups = groupItems(items);
    for (const group of groups) {
      if (group.hasUnread) markGroupRead(group);
    }
  }, [items, markGroupRead]);

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

  // Cmd/Ctrl+J → back to last visited issue
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

  const groups = groupItems(items);
  const unreadCount = groups.filter((g) => g.hasUnread).length;

  return (
    <div className="flex h-svh flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center border-b px-6 gap-3">
        <h1 className="text-sm font-semibold">Inbox</h1>
        {unreadCount > 0 && (
          <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
        )}
        <div className="ml-auto">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            All caught up
          </div>
        ) : (
          <div>
            {groups.map((group) => (
              <InboxGroupItem
                key={group.key}
                group={group}
                onNavigate={() => {
                  if (group.latest.issue_id) {
                    router.push(`/${group.latest.workspace_slug}/issues/${group.latest.issue_id}`);
                  }
                }}
                onMarkRead={() => markGroupRead(group)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
