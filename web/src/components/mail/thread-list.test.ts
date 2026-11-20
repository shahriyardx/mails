// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread, ViewFolder } from "@/lib/types";

const state = vi.hoisted(() => ({ threads: [] as Partial<Thread>[] }));
const actions = vi.hoisted(() => ({
  move: vi.fn(),
  trash: vi.fn(),
  purge: vi.fn(),
  restore: vi.fn(),
  setRead: vi.fn(),
  setStarred: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  errorMessage: String,
  useThreads: () => ({
    data: { pages: [{ data: state.threads }] },
    isPending: false,
    isError: false,
    isSuccess: true,
    hasNextPage: false,
  }),
}));
vi.mock("@/lib/hooks", () => ({ useIsTouch: () => false, useIsPhone: () => false }));
vi.mock("./label-menu", () => ({ LabelMenu: () => null }));
vi.mock("./use-thread-actions", () => ({
  useThreadActions: () => actions,
  movableFolder: (f: string) => f,
}));

const { ThreadList } = await import("./thread-list");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

const thread = (id: string): Partial<Thread> => ({
  id,
  subject: id,
  snippet: "",
  last_message_at: "2026-11-20T10:00:00Z",
  unread_count: 0,
  message_count: 1,
  participants: [{ name: "Bob", address: "bob@example.test" }],
  mailbox: "me@example.test",
});

async function render(folder: ViewFolder = "inbox") {
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(ThreadList, {
          filter: { folder },
          folder,
          hrefFor: (id: string) => `/t/${id}`,
          compact: false,
          showMailbox: false,
        }),
      ),
    );
  });
}

const button = (label: string) =>
  host.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? undefined;

async function click(label: string) {
  await act(async () => button(label)!.click());
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  for (const fn of Object.values(actions)) fn.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("ThreadList", () => {
  it("bulk actions skip picked threads that left the list", async () => {
    state.threads = [thread("A"), thread("B"), thread("C")];
    await render();
    await click("Select A");
    await click("Select B");

    // A is archived from its row (or by a live update): it leaves the list.
    state.threads = [thread("B"), thread("C")];
    await render();

    const count = button("Select all")!.parentElement!.querySelector(".tabular-nums");
    expect(count?.textContent).toBe("1");
    await click("Mark read");
    expect(actions.setRead).toHaveBeenCalledWith(["B"], true);
  });

});
