import { describe, it, expect } from "bun:test";
import { fuzzyFilter } from "../src/ui/fuzzy";

describe("fuzzyFilter", () => {
  const items = ["add-tests", "dark-mode", "fix-bug", "add-feature"];
  const getText = (s: string) => s;

  it("returns all indices for empty query", () => {
    const result = fuzzyFilter(items, "", getText);
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("returns all indices for whitespace-only query", () => {
    const result = fuzzyFilter(items, "   ", getText);
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("filters by single token", () => {
    const result = fuzzyFilter(items, "add", getText);
    expect(result).toEqual([0, 3]); // "add-tests" and "add-feature"
  });

  it("filters by multiple tokens (AND matching)", () => {
    const result = fuzzyFilter(items, "add test", getText);
    expect(result).toEqual([0]); // only "add-tests"
  });

  it("is case-insensitive", () => {
    const result = fuzzyFilter(items, "DARK", getText);
    expect(result).toEqual([1]); // "dark-mode"
  });

  it("returns empty array when no match", () => {
    const result = fuzzyFilter(items, "zzz", getText);
    expect(result).toEqual([]);
  });

  it("works with custom getText function", () => {
    const objects = [
      { name: "alpha", desc: "first" },
      { name: "beta", desc: "second" },
    ];
    const result = fuzzyFilter(objects, "bet", (o) => o.name);
    expect(result).toEqual([1]);
  });

  it("handles empty items array", () => {
    const result = fuzzyFilter([], "test", getText);
    expect(result).toEqual([]);
  });
});
