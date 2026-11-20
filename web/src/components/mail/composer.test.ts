// @vitest-environment jsdom
import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutgoingMail } from "@/lib/types";

const api = vi.hoisted(() => ({
  mutate: vi.fn(),
  saveDraft: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  errorMessage: (error: unknown) => String(error),
  saveDraft: api.saveDraft,
  uploadFile: vi.fn(),
  useContacts: () => ({ data: [] }),
  useDeleteDraft: () => ({ mutate: vi.fn() }),
  useMailboxes: () => ({
    data: [{ id: "mbx_1", address: "me@example.test", is_default: true, signature: null }],
    isPending: false,
  }),
  useSend: () => ({ isPending: false, mutate: api.mutate }),
}));
vi.mock("@/lib/hooks", () => ({ useIsPhone: () => false }));

const { default: Composer } = await import("./composer");

// React's act() wants this flag in a non-test-renderer environment.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const onClose = vi.fn();

async function render(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(Composer, { draft: {}, onClose, ...props }));
  });
}

const field = (label: string) =>
  host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(target: Element, init: KeyboardEventInit) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

async function click(label: string) {
  await act(async () => {
    const buttons = Array.from(host.querySelectorAll("button"));
    buttons
      .find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim().endsWith(label))!
      .click();
  });
}

const sent = () => api.mutate.mock.calls.at(-1)?.[0] as OutgoingMail | undefined;

beforeEach(() => {
  api.mutate.mockReset();
  api.saveDraft.mockReset().mockResolvedValue({ id: "drf_1" });
  onClose.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Composer", () => {
  it("Ctrl+Enter sends an address that was typed but not yet a chip", async () => {
    await render({
      draft: {
        to: [{ name: "", address: "bob@example.test" }],
        cc: [{ name: "", address: "x@example.test" }],
      },
    });
    await type(field("Cc"), "carol@example.test");
    await key(field("Cc"), { key: "Enter", ctrlKey: true });

    expect(sent()?.to).toEqual(["bob@example.test"]);
    expect(sent()?.cc).toEqual(["x@example.test", "carol@example.test"]);
  });

  it("a failed send keeps the message, so Close saves it as a draft", async () => {
    await render();
    await type(field("To"), "bob@example.test");
    await key(field("To"), { key: "Enter" });
    await type(field("Subject"), "Hello");

    await click("Send");
    const options = api.mutate.mock.calls[0]![1] as { onError: (error: unknown) => void };
    await act(async () => options.onError(new Error("SES said no")));

    await click("Close (saves a draft)");
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft.mock.calls[0]![0]).toMatchObject({
      subject: "Hello",
      to: ["bob@example.test"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("registers a flush that saves unsaved text before the composer is replaced", async () => {
    const flushRef: RefObject<(() => Promise<boolean>) | null> = { current: null };
    await render({ flushRef });
    await type(field("Subject"), "Half written");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await flushRef.current!();
    });
    expect(ok).toBe(true);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the flush reports failure when the draft cannot be saved", async () => {
    api.saveDraft.mockRejectedValue(new Error("offline"));
    const flushRef: RefObject<(() => Promise<boolean>) | null> = { current: null };
    await render({ flushRef });
    await type(field("Subject"), "Half written");

    let ok: boolean | undefined;
    await act(async () => {
      ok = await flushRef.current!();
    });
    expect(ok).toBe(false);
  });
});
