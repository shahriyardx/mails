// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { toggleDomainClosed, useClosedDomains } from "./sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: ReadonlySet<string> = new Set();
function Probe() {
  seen = useClosedDomains();
  return null;
}

describe("folded domains", () => {
  it("toggles a domain, tells subscribers and remembers it", () => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    act(() => toggleDomainClosed("a.test"));
    expect(seen.has("a.test")).toBe(true);
    expect(JSON.parse(localStorage.getItem("mails.sidebar-closed-domains") ?? "[]")).toEqual([
      "a.test",
    ]);
    act(() => toggleDomainClosed("a.test"));
    expect(seen.has("a.test")).toBe(false);
    act(() => root.unmount());
  });
});
