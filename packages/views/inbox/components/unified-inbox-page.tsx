"use client";

import { useEffect, useCallback, useState } from "react";
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
  items: UnifiedInboxItem[];
  latest: UnifiedInboxItem;
  hasUnread: boolean;
};

// ─── pinned state (localStorage) ─────────────────────────────────────────────

const PINNED_KEY = "multica:inbox:pinned";

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function savePinned(pinned: Set<string>): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
  } catch {
    // storage unavailable — silently ignore
  }
}

function usePinned() {
  const [pinned, setPinned] = useState<Set<string>>(() =>
    typeof window !== "undefined" ? loadPinned() : new Set(),
  );

  const togglePin = useCallback((key: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      savePinned(next);
      return next;
    });
  }, []);

  return { pinned, togglePin };
}

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
    latest: groupItems[0]!,
    hasUnread: groupItems.some((i) => !i.read),
  }));
}

function sortGroups(groups: InboxGroup[], pinned: Set<string>): InboxGroup[] {
  return [...groups].sort((a, b) => {
    const aPin = pinned.has(a.key) ? 0 : 1;
    const bPin = pinned.has(b.key) ? 0 : 1;
    if (aPin !== bPin) return aPin - bPin;
    // within same pin-tier, latest-first (groups are already in API order, so
    // preserve relative order with index — stableSort via localeCompare fallback)
    return new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime();
  });
}

// ─── icons ────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PinIcon({ filled }: { filled?: boolean }) {
  return filled ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L8 8H4l4 5v5l4-2 4 2v-5l4-5h-4L12 2z" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
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
  isPinned,
  onNavigate,
  onMarkRead,
  onTogglePin,
}: {
  group: InboxGroup;
  isPinned: boolean;
  onNavigate: () => void;
  onMarkRead: () => void;
  onTogglePin: () => void;
}) {
  const timeAgo = useTimeAgo();
  const { latest, hasUnread } = group;
  const title = getInboxDisplayTitle(latest);
  const subtitle = inboxSubtitle(latest);
  const count = group.items.length;

  return (
    <div className={`group flex w-full items-start gap-3 px-6 py-3 border-b border-border/50 last:border-b-0 hover:bg-accent/50 transition-colors ${isPinned ? "bg-accent/20" : ""}`}>
      {/* pin indicator stripe */}
      {isPinned && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-brand rounded-r" />
      )}

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

      {/* action buttons — visible on hover */}
      <div className="mt-0.5 shrink-0 hidden group-hover:flex items-center gap-1">
        {hasUnread && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
            title="Mark as read"
            className="flex items-center justify-center size-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <CheckIcon />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          title={isPinned ? "Unpin" : "Pin"}
          className={`flex items-center justify-center size-6 rounded hover:bg-muted transition-colors ${isPinned ? "text-brand" : "text-muted-foreground hover:text-foreground"}`}
        >
          <PinIcon filled={isPinned} />
        </button>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function UnifiedInboxPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const { pinned, togglePin } = usePinned();

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
      qc.setQueryData<UnifiedInboxItem[]>(
        unifiedInboxKeys.list(),
        (prev = []) => prev.map((i) => unreadIds.includes(i.id) ? { ...i, read: true } : i),
      );
      for (const id of unreadIds) markReadMutation.mutate(id);
    },
    [qc, markReadMutation],
  );

  const markAllRead = useCallback(() => {
    for (const group of groupItems(items)) {
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

  // 3-finger swipe-down (mobile): cycle back to last issue
  useEffect(() => {
    let startY = 0;
    let active = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 3) {
        startY = (e.touches[0]!.clientY + e.touches[1]!.clientY + e.touches[2]!.clientY) / 3;
        active = true;
      } else {
        active = false;
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const last = getLastIssuePath();
      if (t.clientY - startY > 60 && last) router.push(last);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [router]);

  if (isAuthLoading || !user) return null;

  const groups = sortGroups(groupItems(items), pinned);
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
          <div className="relative">
            {groups.map((group) => (
              <InboxGroupItem
                key={group.key}
                group={group}
                isPinned={pinned.has(group.key)}
                onNavigate={() => {
                  if (group.latest.issue_id) {
                    router.push(`/${group.latest.workspace_slug}/issues/${group.latest.issue_id}`);
                  }
                }}
                onMarkRead={() => markGroupRead(group)}
                onTogglePin={() => togglePin(group.key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
