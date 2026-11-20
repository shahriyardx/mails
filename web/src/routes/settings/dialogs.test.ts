// @vitest-environment jsdom
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every update fails the way the server does on a taken name (409).
const update = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn((_vars: unknown, options?: { onError?: (error: Error) => void }) =>
    options?.onError?.(new Error("That name is taken")),
  ),
}));
const idle = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };

vi.mock("@/lib/api", () => ({
  errorMessage: (error: Error) => error.message,
  useLabels: () => ({
    isPending: false,
    isError: false,
    data: [{ id: "lbl_1", name: "Work", color: "#8fa8c8" }],
  }),
  useCreateLabel: () => idle,
  useDeleteLabel: () => idle,
  useUpdateLabel: () => update,
  useMailboxes: () => ({
    isPending: false,
    isError: false,
    data: [
      {
        id: "mbx_1",
        address: "me@example.test",
        domain: "example.test",
        display_name: "Me",
        color: "#8fa8c8",
        signature: null,
        is_default: true,
        is_catch_all: false,
      },
    ],
  }),
  useDomains: () => ({
    data: { data: [{ id: "dom_1", name: "example.test", auto_create_mailboxes: true }] },
  }),
  useCreateMailbox: () => idle,
  useDeleteMailbox: () => idle,
  useUpdateMailbox: () => update,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () =>
  ({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;

let root: Root;
let host: HTMLDivElement;

async function render(page: FunctionComponent) {
  await act(async () => root.render(createElement(page)));
}

const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  update.mutate.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

describe("edit forms keep the typed edit when the save fails", () => {
  it("label dialog", async () => {
    const { default: Labels } = await import("./labels");
    await render(Labels);
    await act(async () => byLabel("Edit Work").click());
    const name = document.querySelector<HTMLInputElement>('input[placeholder="Newsletters"]')!;
    await type(name, "Taken");
    await act(async () => button("Save").click());

    expect(update.mutate).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLInputElement>('input[placeholder="Newsletters"]')?.value).toBe(
      "Taken",
    );
  });

  it("mailbox editor", async () => {
    const { default: Mailboxes } = await import("./mailboxes");
    await render(Mailboxes);
    await act(async () => document.querySelector<HTMLElement>("button[aria-expanded]")!.click());
    const name = document.querySelector<HTMLInputElement>('input[value="Me"]')!;
    await type(name, "Edited");
    await act(async () => button("Save").click());

    expect(update.mutate).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLInputElement>('input[value="Edited"]')).not.toBeNull();
  });
});

describe("deleting a mailbox", () => {
  it("says a domain that captures every address makes it again", async () => {
    const { default: Mailboxes } = await import("./mailboxes");
    await render(Mailboxes);
    await act(async () => byLabel("Delete me@example.test").click());
    expect(document.body.textContent).toContain("makes this mailbox again");
  });
});
