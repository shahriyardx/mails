import { describe, expect, it } from "vitest";
import { dayGroup, hueFor, initialsFor } from "./format";

// Thursday 20 Nov 2026, 15:00 local time.
const now = new Date(2026, 10, 20, 15, 0);
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

describe("dayGroup", () => {
  it.each([
    ["today", at(2026, 10, 20, 1), "Today"],
    ["later today (clock skew)", at(2026, 10, 20, 23), "Today"],
    ["yesterday", at(2026, 10, 19), "Yesterday"],
    ["Monday of this week", at(2026, 10, 16), "Earlier this week"],
    ["Sunday before", at(2026, 10, 15), "Sun 15 Nov"],
    ["last year", at(2025, 10, 15), "Sat 15 Nov 2025"],
  ])("%s", (_, value, want) => {
    expect(dayGroup(value, now)).toBe(want);
  });
});

describe("avatar", () => {
  it.each([
    ["Ada Lovelace", "ada@x.test", "AL"],
    ['"Ada"', "ada@x.test", "A"],
    [null, "bob@x.test", "B"],
    [null, null, "?"],
  ])("initials of %s <%s> are %s", (name, address, want) => {
    expect(initialsFor(name, address)).toBe(want);
  });

  it("keeps a hue per address, whatever the case", () => {
    expect(hueFor("Ada@X.test")).toBe(hueFor("ada@x.test"));
    expect(hueFor("ada@x.test")).toBeGreaterThanOrEqual(0);
    expect(hueFor("ada@x.test")).toBeLessThan(360);
  });
});
