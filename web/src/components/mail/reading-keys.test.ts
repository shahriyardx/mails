import { describe, expect, it } from "vitest";
import { readingKeyAction, threadAfter, threadBeside } from "./reading-keys";

describe("readingKeyAction", () => {
  it.each([
    ["r", "reply"],
    ["a", "replyAll"],
    ["f", "forward"],
    ["j", "next"],
    ["k", "prev"],
    ["Escape", "close"],
    ["e", "archive"],
    ["#", "trash"],
    ["Delete", "trash"],
    ["Backspace", "trash"],
    ["s", "star"],
    ["u", "unread"],
    ["Enter", null],
    ["x", null],
    ["ArrowDown", null],
  ])("%s -> %s", (key, want) => {
    expect(readingKeyAction({ key })).toBe(want);
  });

  it("leaves shortcuts with modifiers to the browser", () => {
    expect(readingKeyAction({ key: "r", ctrlKey: true })).toBe(null);
    expect(readingKeyAction({ key: "f", metaKey: true })).toBe(null);
    expect(readingKeyAction({ key: "e", altKey: true })).toBe(null);
  });
});

describe("threadBeside", () => {
  const rows = ["a", "b", "c"];
  it.each([
    ["b", 1, "c"],
    ["b", -1, "a"],
    ["c", 1, undefined],
    ["a", -1, undefined],
    ["z", 1, undefined],
  ] as const)("%s %i -> %s", (id, step, want) => {
    expect(threadBeside(rows, id, step)).toBe(want);
  });
});

describe("threadAfter", () => {
  it.each([
    [["a", "b", "c"], "b", "c"],
    [["a", "b", "c"], "c", "b"],
    [["a"], "a", undefined],
    [["a", "b"], "z", undefined],
    [[], "a", undefined],
  ])("%j leaving %s -> %s", (rows, id, want) => {
    expect(threadAfter(rows, id)).toBe(want);
  });
});
