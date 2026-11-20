// @vitest-environment jsdom
import { DeleteButton } from "@/components/kit";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(forever: boolean) {
  const onDelete = vi.fn();
  const host = document.createElement("div");
  act(() => createRoot(host).render(createElement(DeleteButton, { forever, onDelete })));
  const button = () => host.querySelector("button")!;
  const click = () => act(() => button().click());
  return { onDelete, button, click };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DeleteButton", () => {
  it("deletes on one click outside Trash", () => {
    const { onDelete, button, click } = mount(false);
    expect(button().getAttribute("aria-label")).toBe("Delete");
    click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("in Trash, the first click only asks and the second deletes forever", () => {
    const { onDelete, button, click } = mount(true);
    expect(button().getAttribute("aria-label")).toBe("Delete forever");
    click();
    expect(onDelete).not.toHaveBeenCalled();
    expect(button().getAttribute("aria-label")).toBe("Click again to delete forever");
    click();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("in Trash, the question lapses after a few seconds", () => {
    const { onDelete, button, click } = mount(true);
    click();
    act(() => vi.advanceTimersByTime(3000));
    expect(button().getAttribute("aria-label")).toBe("Delete forever");
    click();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
