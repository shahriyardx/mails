// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, useSavePreferences } from "./api";
import type { Preferences } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

describe("useSavePreferences", () => {
  it("does not paint an older answer while a newer save is pending", async () => {
    // Each PATCH waits until the test answers it with what it saved.
    const answers: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve) =>
            answers.push(() =>
              resolve(
                new Response(init.body as string, {
                  headers: { "content-type": "application/json" },
                }),
              ),
            ),
          ),
      ),
    );
    const client = new QueryClient();
    client.setQueryData(keys.preferences, { theme: "dark" } as Preferences);
    const hook: { current?: ReturnType<typeof useSavePreferences> } = {};
    function Grab() {
      hook.current = useSavePreferences();
      return null;
    }
    await act(async () => {
      createRoot(document.createElement("div")).render(
        createElement(QueryClientProvider, { client }, createElement(Grab)),
      );
    });
    const theme = () => client.getQueryData<Preferences>(keys.preferences)?.theme;

    await act(async () => hook.current!.mutate({ theme: "light" }));
    await act(async () => hook.current!.mutate({ theme: "dark" }));
    expect(theme()).toBe("dark");

    await act(async () => answers[0]!()); // the first answer: "light"
    expect(theme()).toBe("dark");
    await act(async () => answers[1]!());
    expect(theme()).toBe("dark");
  });
});
