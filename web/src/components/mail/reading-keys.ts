import { focusAfterRemoval } from "./list-keys";

/** What a key press does while a conversation is open. */
export type ReadingKeyAction =
  | "reply"
  | "replyAll"
  | "forward"
  | "next"
  | "prev"
  | "close"
  | "archive"
  | "trash"
  | "star"
  | "unread"
  | "snooze";

/**
 * Maps a key to a reading action, Gmail style: r reply, a reply all,
 * f forward, j / k the next / previous conversation in the list, Escape
 * back to the list, e archive, # / Delete / Backspace trash, s star,
 * u mark unread and go back, b snooze. Keys with Ctrl, Meta or Alt are never taken.
 */
export function readingKeyAction(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): ReadingKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "r":
      return "reply";
    case "a":
      return "replyAll";
    case "f":
      return "forward";
    case "j":
      return "next";
    case "k":
      return "prev";
    case "Escape":
      return "close";
    case "e":
      return "archive";
    case "#":
    case "Delete":
    case "Backspace":
      return "trash";
    case "s":
      return "star";
    case "u":
      return "unread";
    case "b":
      return "snooze";
    default:
      return null;
  }
}

/** The conversation `step` rows away from `id` in list order, if there is one. */
export function threadBeside(rows: readonly string[], id: string, step: 1 | -1) {
  const at = rows.indexOf(id);
  return at < 0 ? undefined : rows[at + step];
}

/**
 * The conversation to open once `id` leaves the list (archived, moved,
 * deleted): the one below, else the one above, else none. None too when
 * `id` was not in the list, so nothing unrelated opens.
 */
export function threadAfter(rows: readonly string[], id: string) {
  return rows.includes(id) ? focusAfterRemoval(rows, id, [id]) : undefined;
}
