import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { keepMutation, keepQuery, QUEUED, SAVED_THREADS, trimSaved } from "./offline";
import { isAppleMobile } from "./push";

const query = (queryKey: unknown[], status = "success", data: unknown = {}) =>
  ({ queryKey, state: { status, data } }) as unknown as Parameters<typeof keepQuery>[0];
const mutation = (mutationKey: unknown[] | undefined, isPaused: boolean) =>
  ({ options: { mutationKey }, state: { isPaused } }) as unknown as Parameters<
    typeof keepMutation
  >[0];

describe("keepQuery", () => {
  it.each([
    [["threads", { folder: "inbox" }], true],
    [["thread", "thr_1"], true],
    [["counts", {}], true],
    [["threads", { folder: "inbox", q: "invoice" }], false],
    [["api-keys"], false],
    [["webhooks"], false],
    [["domains"], false],
    [["contacts", "a"], false],
  ])("%j -> %s", (key, want) => {
    expect(keepQuery(query(key))).toBe(want);
  });

  it("keeps the sign-in state only while signed in", () => {
    expect(keepQuery(query(["auth"], "success", { owner: { id: "u" }, claimed: true }))).toBe(true);
    expect(keepQuery(query(["auth"], "success", { owner: null, claimed: true }))).toBe(false);
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

describe("trimSaved", () => {
  it("keeps the newest conversations", () => {
    const client = new QueryClient();
    for (let i = 0; i < SAVED_THREADS + 5; i++) {
      client.setQueryData(["thread", `thr_${i}`], { id: i }, { updatedAt: 1000 + i });
    }
    client.setQueryData(["threads", {}], { pages: [] });
    trimSaved(client);
    const left = client.getQueryCache().findAll({ queryKey: ["thread"] });
    expect(left).toHaveLength(SAVED_THREADS);
    expect(client.getQueryData(["thread", "thr_0"])).toBeUndefined();
    expect(client.getQueryData(["thread", `thr_${SAVED_THREADS + 4}`])).toBeDefined();
    expect(client.getQueryData(["threads", {}])).toBeDefined();
  });
});

describe("isAppleMobile", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0, false],
    ["Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36", 5, false],
  ])("%s (%i touch) -> %s", (userAgent, maxTouchPoints, want) => {
    expect(isAppleMobile({ userAgent, maxTouchPoints })).toBe(want);
  });
});
