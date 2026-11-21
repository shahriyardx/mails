// @vitest-environment jsdom
import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutgoingMail } from "@/lib/types";

const api = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  saveDraft: vi.fn(),
  undoSend: vi.fn(),
  uploadFile: vi.fn(),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast,
}));

vi.mock("@/lib/api", () => ({
  errorMessage: (error: unknown) => String(error),
  saveDraft: api.saveDraft,
  undoSend: api.undoSend,
  uploadFile: api.uploadFile,
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
  api.undoSend.mockReset();
  api.uploadFile.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  onClose.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Composer", () => {
  it("a held send closes, offers Undo for the window, and Undo reopens the draft", async () => {
    api.mutateAsync.mockResolvedValue({
      id: "msg_9",
      thread_id: "thr_1",
      status: "queued",
      undo_until: new Date(Date.now() + 10_000).toISOString(),
    });
    const files = [{ id: "att_1", filename: "a.txt", size_bytes: 3 }];
    api.undoSend.mockResolvedValue({ id: "msg_9", attachments: files });
    const onReopen = vi.fn();
    await render({
      onReopen,
      draft: { to: [{ name: "", address: "bob@example.test" }], subject: "Hi", threadId: "thr_1" },
    });
    await click("Send");

    expect(onClose).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    const [text, options] = toast.mock.calls.at(-1)!;
    expect(text).toBe("Sending…");
    expect(options.duration).toBeGreaterThan(9_000);
    expect(options.action.label).toBe("Undo");

    await act(async () => options.action.onClick());
    expect(api.undoSend).toHaveBeenCalledWith("msg_9");
    expect(onReopen).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "msg_9",
        subject: "Hi",
        threadId: "thr_1",
        to: [{ name: "", address: "bob@example.test" }],
        attachments: files,
        dirty: true,
      }),
    );
  });

  it("with the undo window off a send just says Sent", async () => {
    await render({ draft: { to: [{ name: "", address: "bob@example.test" }] } });
    await click("Send");
    expect(toast.success).toHaveBeenCalledWith("Sent");
    expect(toast).not.toHaveBeenCalled();
  });

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

  describe("files dropped or pasted", () => {
    const pdf = new File(["%PDF"], "plan.pdf", { type: "application/pdf" });
    // jsdom has no DataTransfer: a stand-in with what the composer reads.
    const transfer = (files: File[], types = files.length ? ["Files"] : ["text/plain"]) => ({
      types,
      files: Object.assign([...files], { item: (i: number) => files[i] }),
    });
    async function fire(type: string, data: object, key: "dataTransfer" | "clipboardData") {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, key, { value: data });
      await act(async () => {
        host.querySelector("section")!.dispatchEvent(event);
      });
      return event;
    }
    const dropZone = () => host.textContent?.includes("Drop to attach");

    it("dragging files shows the drop zone; dropping uploads them", async () => {
      api.uploadFile.mockResolvedValue({ id: "att_1", filename: "plan.pdf", size_bytes: 4 });
      await render();
      const over = await fire("dragover", transfer([pdf]), "dataTransfer");
      expect(over.defaultPrevented).toBe(true);
      expect(dropZone()).toBe(true);

      await fire("drop", transfer([pdf]), "dataTransfer");
      expect(dropZone()).toBe(false);
      expect(api.uploadFile).toHaveBeenCalledWith(pdf);
      expect(host.textContent).toContain("plan.pdf");
    });

    it("dragging text is left alone", async () => {
      await render();
      const over = await fire("dragover", transfer([]), "dataTransfer");
      expect(over.defaultPrevented).toBe(false);
      expect(dropZone()).toBe(false);
    });

    it("a failed upload is dropped with its reason", async () => {
      api.uploadFile.mockRejectedValue(new Error("Too large"));
      await render();
      await fire("drop", transfer([pdf]), "dataTransfer");
      expect(toast.error).toHaveBeenCalledWith("plan.pdf: Error: Too large");
      expect(host.textContent).not.toContain("plan.pdf");
    });

    it("pasting a file attaches it instead of pasting into the text", async () => {
      api.uploadFile.mockResolvedValue({ id: "att_2", filename: "shot.png", size_bytes: 9 });
      const png = new File(["x"], "shot.png", { type: "image/png" });
      await render();
      const paste = await fire("paste", transfer([png]), "clipboardData");
      expect(paste.defaultPrevented).toBe(true);
      expect(api.uploadFile).toHaveBeenCalledWith(png);
    });

    it("pasting text is left to the editor", async () => {
      await render();
      const paste = await fire("paste", { ...transfer([]), getData: () => "" }, "clipboardData");
      expect(paste.defaultPrevented).toBe(false);
      expect(api.uploadFile).not.toHaveBeenCalled();
    });
  });
});
