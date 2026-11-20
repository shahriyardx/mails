// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
// Each server call waits until the test answers it.
const calls = vi.hoisted(() => [] as { resolve: () => void; reject: (e: Error) => void }[]);
const pending = () =>
  new Promise<void>((resolve, reject) => calls.push({ resolve, reject: (e) => reject(e) }));

vi.mock("@/components/kit", () => ({ toast }));
vi.mock("@/lib/api", () => ({
  errorMessage: (error: Error) => error.message,
  useChangeThreads: () => useMutation({ mutationFn: pending }),
  useDeleteThreads: () => useMutation({ mutationFn: pending }),
  useRestoreThreads: () => useMutation({ mutationFn: pending }),
}));

const { useThreadActions } = await import("./use-thread-actions");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useThreadActions", () => {
  it("keeps every toast when actions overlap", async () => {
    const hook: { current?: ReturnType<typeof useThreadActions> } = {};
    function Grab() {
      hook.current = useThreadActions();
      return null;
    }
    await act(async () => {
      createRoot(document.createElement("div")).render(
        createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Grab)),
      );
    });

    await act(async () => {
      hook.current!.move(["thr_1"], "archive", "inbox");
      hook.current!.move(["thr_2"], "archive", "inbox");
      hook.current!.setStarred(["thr_3"], true);
      hook.current!.setStarred(["thr_4"], true);
    });
    await act(async () => {
      calls[0]!.resolve();
      calls[1]!.resolve();
      calls[2]!.reject(new Error("first failed"));
      calls[3]!.reject(new Error("second failed"));
    });

    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[0]![1]).toMatchObject({ action: { label: "Undo" } });
    expect(toast.error.mock.calls).toEqual([["first failed"], ["second failed"]]);
  });
});
