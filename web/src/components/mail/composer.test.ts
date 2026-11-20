// @vitest-environment jsdom
import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutgoingMail } from "@/lib/types";

const api = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
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
  useSend: () => ({ isPending: false, mutateAsync: api.mutateAsync }),
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

const sent = () => api.mutateAsync.mock.calls.at(-1)?.[0] as OutgoingMail | undefined;

beforeEach(() => {
  api.mutateAsync.mockReset().mockResolvedValue({ status: "sent" });
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

    api.mutateAsync.mockRejectedValue(new Error("SES said no"));
    await click("Send");

    await click("Close (saves a draft)");
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft.mock.calls[0]![0]).toMatchObject({
      subject: "Hello",
      to: ["bob@example.test"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("a second Send while the draft is still saving sends once", async () => {
    let finishSave!: (value: { id: string }) => void;
    api.saveDraft.mockReturnValue(new Promise((resolve) => (finishSave = resolve)));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await render();
    await type(field("To"), "bob@example.test");
    await key(field("To"), { key: "Enter" });
    await type(field("Subject"), "Hello");
    // Autosave starts and hangs; both clicks wait on it.
    await act(async () => vi.advanceTimersByTimeAsync(3000));

    await click("Send");
    await click("Send");
    await act(async () => finishSave({ id: "drf_1" }));

    vi.useRealTimers();

    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.mutateAsync).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
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
