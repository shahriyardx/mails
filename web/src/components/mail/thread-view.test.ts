// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

const purge = vi.hoisted(() => vi.fn(async () => {}));
const dialogs = vi.hoisted(() => ({ confirm: [] as (() => Promise<unknown>)[] }));

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
  useThreadActions: () => ({ purge, setRead: vi.fn() }),
  movableFolder: () => undefined,
}));

const { ThreadView } = await import("./thread-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ThreadView", () => {
  it("goes back to the list after deleting the conversation forever", async () => {
    const host = document.createElement("div");
    await act(async () => {
      createRoot(host).render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/trash/thr_1"] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/trash", element: "The list" }),
            createElement(Route, {
              path: "/trash/:id",
              element: createElement(ThreadView, {
                threadId: "thr_1",
                backHref: "/trash",
                folder: "trash",
              }),
            }),
          ),
        ),
      );
    });

    await act(async () => dialogs.confirm.at(-1)!());
    expect(purge).toHaveBeenCalledWith(["thr_1"]);
    expect(host.textContent).toBe("The list");
  });
});
