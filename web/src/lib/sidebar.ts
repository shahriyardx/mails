import { useSyncExternalStore } from "react";

/**
 * Whether the desktop sidebar is folded down to icons. A per-browser
 * convenience, so localStorage (wrapped: it can throw or be empty).
 */
const KEY = "mails.sidebar-collapsed";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let collapsed = read();

export function setSidebarCollapsed(next: boolean) {
  collapsed = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Private window or blocked storage: it still works until reload.
  }
  for (const fn of listeners) fn();
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => collapsed,
  );
}

/** Domains whose mailboxes are folded away in the sidebar (per browser). */
const CLOSED_KEY = "mails.sidebar-closed-domains";
const closedListeners = new Set<() => void>();

function readClosed(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((d) => typeof d === "string") : []);
  } catch {
    return new Set();
  }
}

let closed = readClosed();

export function toggleDomainClosed(domain: string) {
  const next = new Set(closed);
  if (next.has(domain)) next.delete(domain);
  else next.add(domain);
  closed = next;
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...next]));
  } catch {
    // Storage blocked: it still works until reload.
  }
  for (const fn of closedListeners) fn();
}

export function useClosedDomains(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      closedListeners.add(fn);
      return () => closedListeners.delete(fn);
    },
    () => closed,
  );
}
