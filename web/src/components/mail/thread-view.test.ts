// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const purge = vi.hoisted(() => vi.fn(async () => {}));
const dialogs = vi.hoisted(() => ({ confirm: [] as (() => Promise<unknown>)[] }));
const actions = vi.hoisted(() => ({ trash: vi.fn(), setStarred: vi.fn(), setRead: vi.fn() }));
// The list the conversation was opened from, in order.
const list = vi.hoisted(() => ({ rows: [] as string[] }));

vi.mock("@/components/kit", async (original) => ({
  ...(await original<object>()),
  // Stand-in: hands the test the confirm action instead of a dialog.
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => Promise<unknown> }) => {
    dialogs.confirm.push(onConfirm);
    return null;
  },
}));
vi.mock("@/lib/api", () => ({
  errorMessage: String,
  useDeleteDraft: () => ({ mutate: vi.fn() }),
  useImageTrust: () => ({ data: {} }),
  useThreads: () => ({ data: { pages: [{ data: list.rows.map((id) => ({ id })) }] } }),
  useThread: () => ({
    isPending: false,
    isError: false,
    data: {
      id: "thr_1",
      subject: "Old",
      folders: ["trash"],
      messages: [],
      labels: [],
      unread_count: 0,
      message_count: 0,
    },
  }),
}));
vi.mock("./composer-provider", () => ({ useComposer: () => ({ open: vi.fn() }) }));
vi.mock("./label-menu", () => ({ LabelMenu: () => null }));
vi.mock("./use-thread-actions", () => ({
  useThreadActions: () => ({ purge, ...actions }),
  movableFolder: () => undefined,
}));

const { ThreadView } = await import("./thread-view");
const { setAfterMove } = await import("@/lib/after-move");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

function Where() {
  return createElement("output", null, useLocation().pathname);
}

/** The open conversation thr_1 (in Trash) at /trash/thr_1; the list is at /trash. */
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const view = createElement(ThreadView, {
    threadId: "thr_1",
    backHref: "/trash",
    folder: "trash",
    filter: { folder: "trash" },
    hrefFor: (id: string) => `/trash/${id}`,
  });
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/trash/thr_1"] },
        createElement(Where),
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/trash", element: "The list" }),
          createElement(Route, { path: "/trash/:id", element: view }),
        ),
      ),
    );
  });
  const where = () => host.querySelector("output")!.textContent;
  const press = (key: string) =>
    act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  return { host, where, press };
}

describe("ThreadView", () => {
  it("goes back to the list after deleting the conversation forever", async () => {
    list.rows = [];
    const { host, where } = await mount();
    await act(async () => dialogs.confirm.at(-1)!());
    expect(purge).toHaveBeenCalledWith(["thr_1"]);
    expect(where()).toBe("/trash");
    expect(host.textContent).toContain("The list");
  });

  it("opens the next conversation after deleting forever", async () => {
    list.rows = ["thr_0", "thr_1", "thr_2"];
    const { where } = await mount();
    await act(async () => dialogs.confirm.at(-1)!());
    expect(where()).toBe("/trash/thr_2");
  });

  it("goes back to the list instead when the owner chose so", async () => {
    list.rows = ["thr_0", "thr_1", "thr_2"];
    setAfterMove("list");
    const { where } = await mount();
    await act(async () => dialogs.confirm.at(-1)!());
    setAfterMove("next");
    expect(where()).toBe("/trash");
  });

  it("j opens the next conversation in list order", async () => {
    list.rows = ["thr_0", "thr_1", "thr_2"];
    const { where, press } = await mount();
    await press("j");
    expect(where()).toBe("/trash/thr_2");
  });

  it("k opens the previous conversation", async () => {
    list.rows = ["thr_0", "thr_1", "thr_2"];
    const { where, press } = await mount();
    await press("k");
    expect(where()).toBe("/trash/thr_0");
  });

  it("Escape closes", async () => {
    list.rows = [];
    const { where, press } = await mount();
    await press("Escape");
    expect(where()).toBe("/trash");
  });

  it("s stars; u marks unread and closes", async () => {
    list.rows = [];
    const m = await mount();
    await m.press("s");
    expect(actions.setStarred).toHaveBeenCalledWith(["thr_1"], true);
    await m.press("u");
    expect(actions.setRead).toHaveBeenCalledWith(["thr_1"], false);
    expect(m.where()).toBe("/trash");
  });

  it("ignores keys typed into a field", async () => {
    list.rows = ["thr_1", "thr_2"];
    const m = await mount();
    const input = document.createElement("input");
    m.host.append(input);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    });
    expect(m.where()).toBe("/trash/thr_1");
  });
});
