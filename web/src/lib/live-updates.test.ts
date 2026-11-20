// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveUpdates } from "./api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeSource {
  static CLOSED = 2;
  static all: FakeSource[] = [];
  readyState = 0;
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: (message: { data: string }) => void;
  close = vi.fn(() => {
    this.readyState = FakeSource.CLOSED;
  });
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSource.all = [];
});

function Live() {
  useLiveUpdates(true);
  return null;
}

describe("useLiveUpdates", () => {
  it("opens a new stream after the browser gives up on one", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeSource);
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(
        createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Live)),
      );
    });
    expect(FakeSource.all).toHaveLength(1);

    // A blip: the browser retries by itself, so no new stream.
    act(() => FakeSource.all[0]!.onerror!());
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(FakeSource.all).toHaveLength(1);

    // A 502: the stream is closed for good.
    FakeSource.all[0]!.readyState = FakeSource.CLOSED;
    act(() => FakeSource.all[0]!.onerror!());
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(FakeSource.all).toHaveLength(2);

    // Unmounting stops a pending retry and closes the stream.
    FakeSource.all[1]!.readyState = FakeSource.CLOSED;
    act(() => FakeSource.all[1]!.onerror!());
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(FakeSource.all).toHaveLength(2);
    expect(FakeSource.all[1]!.close).toHaveBeenCalled();
  });
});
