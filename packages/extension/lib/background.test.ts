import { beforeEach, describe, expect, it, vi } from "vitest";

/* A stand-in for the browser APIs the worker uses. */
const fake = vi.hoisted(() => {
  const listeners: Record<string, ((...args: unknown[]) => unknown)[]> = {};
  const event = (name: string) => ({
    addListener: (fn: (...args: unknown[]) => unknown) => {
      (listeners[name] ??= []).push(fn);
    },
  });
  const store: Record<string, unknown> = {};
  return {
    listeners,
    store,
    listThreads: vi.fn(),
    browser: {
      runtime: {
        onInstalled: event("installed"),
        onStartup: event("startup"),
        onMessage: event("message"),
        getURL: (path: string) => path,
      },
      alarms: { get: vi.fn(), create: vi.fn(), clear: vi.fn(), onAlarm: event("alarm") },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (values: Record<string, unknown>) => void Object.assign(store, values),
          onChanged: event("changed"),
        },
      },
      action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
      notifications: { create: vi.fn(), clear: vi.fn(), onClicked: event("clicked") },
      tabs: { create: vi.fn() },
    },
  };
});

vi.mock("wxt/browser", () => ({ browser: fake.browser }));
vi.mock("wxt/utils/define-background", () => ({ defineBackground: (main: () => void) => main }));
vi.mock("@/lib/cache", () => ({ clearCache: vi.fn() }));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  listThreads: fake.listThreads,
  threadUrl: vi.fn(),
}));

const thread = (id: string) => ({
  id,
  subject: `Subject ${id}`,
  last_message_at: "2026-11-20T10:00:00Z",
  participants: [{ name: "Bob", address: "bob@example.test" }],
  unread_count: 1,
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const fire = (name: string, ...args: unknown[]) =>
  Promise.all((fake.listeners[name] ?? []).map((fn) => fn(...args)));

async function start() {
  vi.resetModules();
  const main = (await import("@/entrypoints/background")).default as unknown as () => void;
  main();
  await settled();
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(fake.listeners)) delete fake.listeners[key];
  for (const key of Object.keys(fake.store)) delete fake.store[key];
  fake.store.settings = { baseUrl: "https://mail.test", apiKey: "k" };
  fake.store.state = { primed: true };
  fake.listThreads.mockResolvedValue({ threads: [], nextCursor: null, hasMore: false });
});

describe("background worker", () => {
  it("does not poll on a plain wake-up; the alarm that woke it does", async () => {
    fake.browser.alarms.get.mockResolvedValue({ name: "mails:poll" });
    await start();
    expect(fake.listThreads).not.toHaveBeenCalled();
    expect(fake.browser.alarms.create).not.toHaveBeenCalled();
  });

  it("creates the alarm when it is missing", async () => {
    fake.browser.alarms.get.mockResolvedValue(undefined);
    await start();
    expect(fake.browser.alarms.create).toHaveBeenCalledWith("mails:poll", expect.anything());
  });

  it("never runs two polls at once, so a new thread is announced once", async () => {
    fake.browser.alarms.get.mockResolvedValue({ name: "mails:poll" });
    await start();
    fake.listThreads.mockResolvedValue({
      threads: [thread("thr_1")],
      nextCursor: null,
      hasMore: false,
    });

    await Promise.all([fire("alarm", { name: "mails:poll" }), fire("installed")]);
    await settled();

    expect(fake.listThreads).toHaveBeenCalledTimes(1);
    expect(fake.browser.notifications.create).toHaveBeenCalledTimes(1);
  });
});
