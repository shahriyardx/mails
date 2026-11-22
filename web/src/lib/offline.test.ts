import { describe, expect, it } from "vitest";
import { keepMutation, keepQuery, QUEUED } from "./offline";

const query = (queryKey: unknown[], status = "success") =>
  ({ queryKey, state: { status } }) as unknown as Parameters<typeof keepQuery>[0];
const mutation = (mutationKey: unknown[] | undefined, isPaused: boolean) =>
  ({ options: { mutationKey }, state: { isPaused } }) as unknown as Parameters<
    typeof keepMutation
  >[0];

describe("keepQuery", () => {
  it.each([
    [["threads", { folder: "inbox" }], true],
    [["thread", "thr_1"], true],
    [["auth"], true],
    [["counts", {}], true],
    [["threads", { folder: "inbox", q: "invoice" }], false],
    [["api-keys"], false],
    [["webhooks"], false],
    [["domains"], false],
    [["contacts", "a"], false],
  ])("%j -> %s", (key, want) => {
    expect(keepQuery(query(key))).toBe(want);
  });

  it("skips failed and pending queries", () => {
    expect(keepQuery(query(["thread", "thr_1"], "error"))).toBe(false);
    expect(keepQuery(query(["thread", "thr_1"], "pending"))).toBe(false);
  });
});

describe("keepMutation", () => {
  it("keeps only paused thread actions", () => {
    expect(keepMutation(mutation([QUEUED, "change-threads"], true))).toBe(true);
    expect(keepMutation(mutation([QUEUED, "change-threads"], false))).toBe(false);
    expect(keepMutation(mutation(["preferences"], true))).toBe(false);
    expect(keepMutation(mutation(undefined, true))).toBe(false);
  });
});
