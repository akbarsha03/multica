import { describe, it, expect } from "vitest";
import { diffLines } from "./wiki-diff";

describe("diffLines", () => {
  it("marks changed lines as del+add and keeps unchanged as same", () => {
    const rows = diffLines("a\nb\nc", "a\nB\nc");
    const types = rows.map((r) => r.type);
    expect(rows.find((r) => r.type === "del" && r.text === "b")).toBeTruthy();
    expect(rows.find((r) => r.type === "add" && r.text === "B")).toBeTruthy();
    expect(rows.filter((r) => r.type === "same" && r.text === "a").length).toBe(1);
    expect(types).toContain("same");
  });
  it("pure additions and deletions", () => {
    expect(diffLines("a", "a\nb").some((r) => r.type === "add" && r.text === "b")).toBe(true);
    expect(diffLines("a\nb", "a").some((r) => r.type === "del" && r.text === "b")).toBe(true);
  });
  it("identical text → all same", () => {
    expect(diffLines("x\ny", "x\ny").every((r) => r.type === "same")).toBe(true);
  });
});
