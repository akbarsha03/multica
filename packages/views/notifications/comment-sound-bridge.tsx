"use client";

import { useEffect } from "react";
import { useWS } from "@multica/core/realtime";
import { useCommentSoundStore } from "@multica/core/preferences";
import { playCommentSound } from "./play-comment-sound";

/**
 * Plays a chime whenever a `comment:created` event arrives for the active
 * workspace — any comment, any issue, any author (per product decision). Gated
 * by the per-device `comment_sound` preference, read via getState() inside the
 * handler so toggling the setting doesn't churn the subscription.
 *
 * Mounted once in the shared DashboardLayout, so web and desktop both get it.
 * Renders nothing.
 */
export function CommentSoundBridge() {
  const { subscribe } = useWS();

  useEffect(() => {
    return subscribe("comment:created", () => {
      if (useCommentSoundStore.getState().enabled) {
        playCommentSound();
      }
    });
  }, [subscribe]);

  return null;
}
