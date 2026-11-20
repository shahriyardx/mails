// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, useDeleteWebhook, useRemoveDomain, useSavePreferences } from "./api";
import type { Preferences } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

// Renders a hook under client and returns what it gave back.
function Run({ hook, into }: { hook: () => unknown; into: { current?: unknown } }) {
  into.current = hook();
  return null;
}
async function mount<T>(client: QueryClient, hook: () => T) {
  const into: { current?: unknown } = {};
  await act(async () => {
    createRoot(document.createElement("div")).render(
      createElement(QueryClientProvider, { client }, createElement(Run, { hook, into })),
    );
  });
  return into as { current: T };
}

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
    const hook = await mount(client, useSavePreferences);
    const theme = () => client.getQueryData<Preferences>(keys.preferences)?.theme;

    await act(async () => hook.current.mutate({ theme: "light" }));
    await act(async () => hook.current.mutate({ theme: "dark" }));
    expect(theme()).toBe("dark");

    await act(async () => answers[0]!()); // the first answer: "light"
    expect(theme()).toBe("dark");
    await act(async () => answers[1]!());
    expect(theme()).toBe("dark");
  });
});

describe("deleting a domain or webhook", () => {
  it.each([
    ["removing a domain (its webhooks go too)", useRemoveDomain, { id: "dom_1" }],
    ["deleting a webhook", useDeleteWebhook, "wh_1"],
  ] as const)("%s refreshes webhooks and their deliveries", async (_, useHook, vars) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const hook = await mount(
      client,
      useHook as () => { mutateAsync: (vars: never) => Promise<unknown> },
    );
    await act(async () => {
      await hook.current.mutateAsync(vars as never);
    });
    const invalidated = spy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(invalidated).toContainEqual(["webhooks"]);
    expect(invalidated).toContainEqual(["webhook-deliveries"]);
  });
});
