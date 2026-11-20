// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A promise resolved from the test, to land responses in a chosen order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const api = vi.hoisted(() => ({
  getThread: vi.fn(),
  listThreads: vi.fn(),
  patchThread: vi.fn(),
  deleteThread: vi.fn(),
}));

vi.mock("wxt/browser", () => ({ browser: { runtime: { getURL: (p: string) => p } } }));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  ...api,
  listMailboxes: vi.fn(async () => []),
}));
vi.mock("@/lib/cache", () => ({
  cacheList: vi.fn(),
  cacheMailboxes: vi.fn(),
  cachedList: vi.fn(async () => null),
  cachedMailboxes: vi.fn(async () => null),
}));
const settings = { baseUrl: "https://mail.test", apiKey: "k", watchAll: true, mailboxIds: [] };
vi.mock("@/lib/hooks", () => ({
  useSettings: () => ({ settings, update: vi.fn() }),
  useDebounced: <T>(value: T) => value,
  refreshBadge: vi.fn(),
  openTab: vi.fn(),
}));
vi.mock("@/lib/theme", () => ({ useTheme: () => "dark" }));
vi.mock("@/components/thread-row", () => ({
  ThreadRow: ({ thread, onOpen }: { thread: { id: string }; onOpen: () => void }) =>
    createElement("button", { type: "button", "data-row": thread.id, onClick: onOpen }, thread.id),
}));
vi.mock("@/components/thread-view", () => ({
  ThreadView: ({ thread, onTrash }: { thread: { subject: string } | null; onTrash: () => void }) =>
    createElement(
      "div",
      null,
      createElement("h2", { "data-reader": true }, thread?.subject ?? ""),
      createElement("button", { type: "button", "data-trash": true, onClick: onTrash }, "Trash"),
    ),
}));

const { App } = await import("@/entrypoints/popup/App");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string) => ({
  id,
  subject: `Subject ${id}`,
  last_message_at: "2026-11-20T10:00:00Z",
  unread_count: 0,
});

let host: HTMLDivElement;

async function render() {
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(createElement(App, { inTab: true }));
  });
}

const click = (selector: string) =>
  act(async () => host.querySelector<HTMLElement>(selector)!.click());

beforeEach(() => {
  vi.clearAllMocks();
  // Wide, so the list and the reader are both on screen.
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  api.listThreads.mockResolvedValue({
    threads: [row("thr_a"), row("thr_b")],
    nextCursor: null,
    hasMore: false,
  });
  api.deleteThread.mockResolvedValue({ deleted: true });
});

describe("popup", () => {
  it("shows the conversation clicked last, whichever answer lands last", async () => {
    await render();
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    api.getThread.mockImplementation((_s: unknown, id: string) =>
      id === "thr_a" ? a.promise : b.promise,
    );

    await click('[data-row="thr_a"]');
    await click('[data-row="thr_b"]');
    await act(async () => b.resolve(row("thr_b")));
    await act(async () => a.resolve(row("thr_a")));

    expect(host.querySelector("[data-reader]")!.textContent).toBe("Subject thr_b");
    await click("[data-trash]");
    expect(api.deleteThread).toHaveBeenCalledWith(settings, "thr_b", false);
  });

  it("keeps the newest list when an older load answers late", async () => {
    const first = deferred<unknown>();
    api.listThreads.mockReturnValueOnce(first.promise);
    await render();

    // Refresh starts a second load, which answers first.
    api.listThreads.mockResolvedValueOnce({
      threads: [row("thr_new")],
      nextCursor: null,
      hasMore: false,
    });
    await click('button[aria-label="Refresh"]');
    await act(async () =>
      first.resolve({ threads: [row("thr_old")], nextCursor: null, hasMore: false }),
    );

    expect(host.querySelector('[data-row="thr_new"]')).not.toBeNull();
    expect(host.querySelector('[data-row="thr_old"]')).toBeNull();
  });
});
