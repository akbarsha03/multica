import { describe, expect, it, beforeEach } from "vitest";
import { useCommentSortStore } from "./comment-sort-store";

describe("comment-sort-store", () => {
  beforeEach(() => {
    useCommentSortStore.setState({ order: "desc" });
  });

  it("defaults to newest-first", () => {
    expect(useCommentSortStore.getState().order).toBe("desc");
  });

  it("toggles via setOrder", () => {
    useCommentSortStore.getState().setOrder("asc");
    expect(useCommentSortStore.getState().order).toBe("asc");
    useCommentSortStore.getState().setOrder("desc");
    expect(useCommentSortStore.getState().order).toBe("desc");
  });
});
