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
