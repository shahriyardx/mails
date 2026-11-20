import { afterEach, describe, expect, it, vi } from "vitest";
import { canReadMail, listThreads } from "./api";
import { DEFAULTS } from "./settings";

const thread = (id: string, at: string) => ({ id, last_message_at: at });
const page = (data: unknown[], hasMore = false) =>
  new Response(JSON.stringify({ object: "list", data, has_more: hasMore, next_cursor: null }));

describe("listThreads across several mailboxes", () => {
  const settings = {
    ...DEFAULTS,
    baseUrl: "https://mail.test",
    apiKey: "k",
    watchAll: false,
    mailboxIds: ["mbx_a", "mbx_b"],
  };

  afterEach(() => vi.unstubAllGlobals());

  it("fails when one mailbox fails, instead of quietly leaving its mail out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("mbx_a")
          ? page([thread("thr_a", "2026-11-20T10:00:00Z")])
          : new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      ),
    );
    await expect(listThreads(settings, "unread")).rejects.toThrow("boom");
  });

  it("merges the pages newest first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        page([
          url.includes("mbx_a")
            ? thread("thr_a", "2026-11-20T10:00:00Z")
            : thread("thr_b", "2026-11-20T11:00:00Z"),
        ]),
      ),
    );
    const result = await listThreads(settings, "unread");
    expect(result.threads.map((t) => t.id)).toEqual(["thr_b", "thr_a"]);
  });
});

describe("canReadMail", () => {
  it.each([
    [["*"], true],
    [["mail:read"], true],
    [["mail:write"], true],
    [["emails:send", "mail:read"], true],
    [[], false],
    [["mailboxes:read"], false],
    [["emails:send", "emails:read"], false],
  ])("%j -> %s", (scopes, want) => {
    expect(canReadMail(scopes)).toBe(want);
  });
});
