import { describe, expect, it } from "vitest";
import { focusAfterRemoval, keyTargets, listKeyAction } from "./list-keys";

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
    ["b", "snooze"],
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

describe("keyTargets", () => {
  it("acts on the selection when there is one, else the focused row", () => {
    expect(keyTargets(["a", "c"], "b")).toEqual(["a", "c"]);
    expect(keyTargets([], "b")).toEqual(["b"]);
  });
});

describe("focusAfterRemoval", () => {
  const rows = ["a", "b", "c", "d"];
  it("moves to the next row that stays", () => {
    expect(focusAfterRemoval(rows, "b", ["b", "c"])).toBe("d");
  });
  it("falls back to the nearest row above", () => {
    expect(focusAfterRemoval(rows, "d", ["c", "d"])).toBe("b");
  });
  it("gives nothing when every row goes", () => {
    expect(focusAfterRemoval(rows, "a", rows)).toBeUndefined();
  });
});
