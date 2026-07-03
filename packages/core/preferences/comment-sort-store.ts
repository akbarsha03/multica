import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * Client/device preference for the issue-detail comment/activity timeline's
 * display order. Persisted per device, not synced to the server — like
 * CommentSoundStore, a local UI choice rather than workspace state.
 *
 * Defaults to "desc" (newest first) so a new comment from an agent or
 * teammate is visible without scrolling to the bottom of a long thread.
 */
export type CommentSortOrder = "asc" | "desc";

interface CommentSortStore {
  order: CommentSortOrder;
  setOrder: (order: CommentSortOrder) => void;
}

export const useCommentSortStore = create<CommentSortStore>()(
  persist(
    (set) => ({
      order: "desc",
      setOrder: (order) => set({ order }),
    }),
    {
      name: "multica_comment_sort_order",
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);
