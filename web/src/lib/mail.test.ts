import { describe, expect, it } from "vitest";
import { dayGroup, formatStamp, swipeOutcome, withListParam } from "./mail";

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

describe("withListParam", () => {
  const params = () => new URLSearchParams("q=invoice&t=thr_1&label=lbl_1");

  it("keeps the open conversation when the search is cleared", () => {
    const next = withListParam(params(), "q", null);
    expect(next.get("t")).toBe("thr_1");
    expect(next.has("q")).toBe(false);
  });

  it("closes the open conversation when a filter narrows the list", () => {
    const next = withListParam(params(), "unread", "1");
    expect(next.has("t")).toBe(false);
    expect(next.get("unread")).toBe("1");
  });

  it("does not change the params it was given", () => {
    const current = params();
    withListParam(current, "q", null);
    expect(current.get("q")).toBe("invoice");
  });
});

describe("swipeOutcome", () => {
  it.each([
    ["short drag", 40, 0, "inbox", { action: null, slideOut: false }],
    ["left archives", -120, 0, "inbox", { action: "archive", slideOut: true }],
    ["right deletes", 120, 0, "inbox", { action: "delete", slideOut: true }],
    ["fast flick", 30, 900, "inbox", { action: "delete", slideOut: true }],
    // Delete in Trash opens a confirm dialog; Cancel must not leave the row off-screen.
    ["right in trash asks first", 120, 0, "trash", { action: "delete", slideOut: false }],
  ] as const)("%s", (_, offset, velocity, folder, want) => {
    expect(swipeOutcome(offset, velocity, folder)).toEqual(want);
  });
});
