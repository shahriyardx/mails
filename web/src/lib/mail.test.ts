import { describe, expect, it } from "vitest";
import { dayGroup, formatStamp } from "./mail";

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

  it("has no 'earlier this week' on a Monday", () => {
    const monday = new Date(2026, 10, 16, 10);
    expect(dayGroup(at(2026, 10, 14), monday)).toBe("Sat 14 Nov");
  });
});

describe("formatStamp", () => {
  it.each([
    [at(2026, 10, 20, 8), "08:00"],
    [at(2026, 10, 17), "Tue"],
    [at(2026, 9, 2), "2 Oct"],
    [at(2024, 0, 5), "Jan 24"],
  ])("%s -> %s", (value, want) => {
    expect(formatStamp(value, now)).toBe(want);
  });
});
