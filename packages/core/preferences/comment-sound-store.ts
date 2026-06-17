import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * Client/device preference for the new-comment notification sound. A short
 * chime plays whenever a `comment:created` WS event arrives for the active
 * workspace (see CommentSoundBridge). Persisted per device, not synced to the
 * server — like the browser-notification permission, it's a local choice.
 *
 * Enabled by default; users mute it from Settings → Notifications.
 */
interface CommentSoundStore {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useCommentSoundStore = create<CommentSoundStore>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: "multica_comment_sound",
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);
