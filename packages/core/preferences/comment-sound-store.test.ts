import { describe, expect, it, beforeEach } from "vitest";
import { useCommentSoundStore } from "./comment-sound-store";

describe("comment-sound-store", () => {
  beforeEach(() => {
    useCommentSoundStore.setState({ enabled: true });
  });

  it("is enabled by default", () => {
    expect(useCommentSoundStore.getState().enabled).toBe(true);
  });

  it("toggles via setEnabled", () => {
    useCommentSoundStore.getState().setEnabled(false);
    expect(useCommentSoundStore.getState().enabled).toBe(false);
    useCommentSoundStore.getState().setEnabled(true);
    expect(useCommentSoundStore.getState().enabled).toBe(true);
  });
});
