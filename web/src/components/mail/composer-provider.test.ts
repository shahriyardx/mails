// @vitest-environment jsdom
import { act, createElement, type RefObject, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { shortcutBlocked } from "@/lib/hooks";

const flush = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

// A stand-in composer: shows its title and hands the provider its flush.
vi.mock("./composer", () => ({
  default: ({
    draft,
    flushRef,
  }: {
    draft: { title?: string };
    flushRef: RefObject<(() => Promise<boolean>) | null>;
  }) => {
    useEffect(() => {
      flushRef.current = flush;
    });
    return createElement("p", { role: "dialog" }, draft.title);
  },
}));

const { ComposerProvider, useComposer } = await import("./composer-provider");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api: { current?: ReturnType<typeof useComposer> } = {};
function Grab() {
  api.current = useComposer();
  return null;
}

async function setup() {
  const host = document.createElement("div");
  await act(async () => {
    createRoot(host).render(createElement(ComposerProvider, null, createElement(Grab)));
  });
  const open = async (title: string) => {
    await act(async () => api.current!.open({ title }));
    // The lazy composer module resolves on a later tick.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  };
  return { host, open };
}

describe("ComposerProvider", () => {
  it("saves the open composer before opening another", async () => {
    flush.mockResolvedValue(true);
    const { host, open } = await setup();
    await open("First");
    expect(host.textContent).toBe("First");

    await open("Second");
    expect(flush).toHaveBeenCalled();
    expect(host.textContent).toContain("Second");
  });

  it("keeps the open composer when its text could not be saved", async () => {
    flush.mockResolvedValue(true);
    const { host, open } = await setup();
    await open("First");

    flush.mockResolvedValue(false);
    await open("Second");
    expect(host.textContent).toBe("First");
  });
});

describe("shortcutBlocked", () => {
  const press = (target: Element, init: KeyboardEventInit = {}) => {
    let blocked: boolean | undefined;
    target.addEventListener("keydown", (event) => {
      blocked = shortcutBlocked(event as KeyboardEvent);
    });
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, ...init }));
    return blocked;
  };
  const el = (html: string) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    document.body.append(wrap);
    return wrap.querySelector("[data-target]")!;
  };

  it.each([
    ["the page", "<button data-target>Archive</button>", false],
    ["a text field", "<input data-target>", true],
    ["a rich editor", '<div contenteditable="" data-target></div>', true],
    [
      "a button inside the composer",
      '<section role="dialog"><button data-target>x</button></section>',
      true,
    ],
  ])("%s", (_, html, want) => {
    expect(press(el(html))).toBe(want);
  });

  it("with a modifier held", () => {
    expect(press(el("<span data-target></span>"), { ctrlKey: true })).toBe(true);
  });
});
