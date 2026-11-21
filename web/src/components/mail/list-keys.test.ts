import { describe, expect, it } from "vitest";
import { listKeyAction } from "./list-keys";

describe("listKeyAction", () => {
  it.each([
    ["ArrowDown", "next"],
    ["j", "next"],
    ["ArrowUp", "prev"],
    ["k", "prev"],
    ["Home", "first"],
    ["End", "last"],
    ["x", "select"],
    ["e", "archive"],
    ["s", "star"],
    ["#", "delete"],
    ["Delete", "delete"],
    ["Backspace", "delete"],
    ["u", "read"],
    ["Enter", null],
    ["a", null],
  ])("%s -> %s", (key, want) => {
    expect(listKeyAction({ key })).toBe(want);
  });

  it("leaves shortcuts with modifiers to the browser", () => {
    expect(listKeyAction({ key: "ArrowDown", ctrlKey: true })).toBe(null);
    expect(listKeyAction({ key: "j", metaKey: true })).toBe(null);
    expect(listKeyAction({ key: "e", altKey: true })).toBe(null);
  });
});
