import { useSyncExternalStore } from "react";

/**
 * What happens after the open conversation is archived, deleted or moved:
 * the next one in the list opens ("next", the default) or the list comes
 * back ("list"). Per browser in localStorage (wrapped: it can throw or be
 * empty), since server preferences are fixed columns.
 */
export type AfterMove = "next" | "list";

const KEY = "mails.after-move";
const listeners = new Set<() => void>();

function read(): AfterMove {
  try {
    return localStorage.getItem(KEY) === "list" ? "list" : "next";
  } catch {
    return "next";
  }
}

let current = read();

export function setAfterMove(next: AfterMove) {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked: it still works until reload.
  }
  for (const fn of listeners) fn();
}

export function useAfterMove(): AfterMove {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
