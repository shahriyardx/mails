import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, errorMessage, keys, queryClient, staleKeys, withQuery } from "./api";

function respond(status: number, body?: string, type = "application/json") {
  const fetch = vi.fn(
    async () => new Response(body ?? null, { status, headers: { "content-type": type } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api", () => {
  it("returns parsed JSON", async () => {
    respond(200, '{"ok":true}');
    await expect(api("/api/app/x")).resolves.toEqual({ ok: true });
  });

  it("returns undefined for 204", async () => {
    respond(204);
    await expect(api("/api/app/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("turns the server's {error, code} into an ApiError", async () => {
    respond(422, '{"error":"to: Required","code":"invalid_request"}');
    const error = await api("/api/app/send", { method: "POST", body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "invalid_request", message: "to: Required" });
  });

  it("falls back to the status when the body is not JSON", async () => {
    respond(502, "<html>Bad gateway</html>", "text/html");
    const error = await api("/api/app/x").catch((e) => e);
    expect(error).toMatchObject({
      status: 502,
      code: "http_error",
      message: "Request failed (502)",
    });
  });

  it("reports a network failure as its own error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const error = await api("/api/app/x").catch((e) => e);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(errorMessage(error)).toMatch(/reach the server/);
  });

  it("sends objects as JSON and FormData as multipart", async () => {
    const fetch = respond(200, "{}");
    await api("/api/app/x", { method: "POST", body: { a: 1 } });
    await api("/api/app/x", { method: "POST", body: new FormData() });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    const json = calls[0]![1];
    const form = calls[1]![1];
    expect((json.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(json.body).toBe('{"a":1}');
    expect((form.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(form.body).toBeInstanceOf(FormData);
  });

  it("builds query strings without empty values", () => {
    expect(withQuery("/t", { folder: "inbox", q: "", cursor: undefined, unread: true })).toBe(
      "/t?folder=inbox&unread=true",
    );
    expect(withQuery("/t", {})).toBe("/t");
  });

  it("re-checks auth after a 401 anywhere", async () => {
    respond(401, '{"error":"Sign in first","code":"unauthorized"}');
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await queryClient
      .fetchQuery({ queryKey: ["x"], queryFn: () => api("/api/app/x"), retry: false })
      .catch(() => {});
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.auth });
  });
});

describe("live updates", () => {
  it("refreshes lists, counts and the touched threads", () => {
    expect(staleKeys({ type: "thread.updated", data: { thread_ids: ["thr_1", "thr_2"] } })).toEqual(
      [["threads"], ["counts"], ["thread", "thr_1"], ["thread", "thr_2"]],
    );
    expect(staleKeys({ type: "mail.received", data: { thread_id: "thr_3" } })).toContainEqual([
      "thread",
      "thr_3",
    ]);
  });

  it("refreshes every open thread when only a message id is known", () => {
    expect(staleKeys({ type: "message.updated", data: { message_id: "msg_1" } })).toContainEqual([
      "thread",
    ]);
  });
});
