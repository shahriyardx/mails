/** What a key press on a focused row of the conversation list does. */
export type ListKeyAction =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "select"
  | "archive"
  | "star"
  | "delete"
  | "read";

/**
 * Maps a key to a list action, Gmail style: arrows or j/k move, Home/End
 * jump, x selects, e archives, s stars, # / Delete / Backspace deletes, u toggles
 * read. Enter is left to the row's link (it opens the conversation).
 * Keys with Ctrl, Meta or Alt are never taken.
 */
export function listKeyAction(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): ListKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "ArrowDown":
    case "j":
      return "next";
    case "ArrowUp":
    case "k":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "x":
      return "select";
    case "e":
      return "archive";
    case "s":
      return "star";
    case "#":
    case "Delete":
    case "Backspace":
      return "delete";
    case "u":
      return "read";
    default:
      return null;
  }
}
