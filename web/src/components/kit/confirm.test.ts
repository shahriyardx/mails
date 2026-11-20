// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () =>
  ({ matches: false, addEventListener() {}, removeEventListener() {} }) as never;

describe("ConfirmDialog", () => {
  it("runs once while the first confirm is still going", async () => {
    const onConfirm = vi.fn(() => new Promise(() => {}));
    const host = document.body.appendChild(document.createElement("div"));
    await act(async () => {
      createRoot(host).render(
        createElement(ConfirmDialog, {
          open: true,
          onOpenChange: () => {},
          title: "Delete mailbox?",
          phrase: "me@example.test",
          onConfirm,
        }),
      );
    });
    const input = document.querySelector<HTMLInputElement>('input[aria-label^="Type"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "me@example.test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Enter in the field, three times.
    for (let i = 0; i < 3; i++) {
      await act(async () => input.form!.requestSubmit());
    }
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
