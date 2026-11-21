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

/** The rows a key acts on: every selected row when any are selected, else the focused one. */
export function keyTargets(selected: readonly string[], focused: string): string[] {
  return selected.length > 0 ? [...selected] : [focused];
}

/**
 * Where focus goes after `removed` leave the list: the first row below the
 * focused one that stays, else the nearest one above, else nothing.
 */
export function focusAfterRemoval(
  rows: readonly string[],
  focused: string,
  removed: readonly string[],
): string | undefined {
  const gone = new Set(removed);
  const at = rows.indexOf(focused);
  return (
    rows.slice(at + 1).find((id) => !gone.has(id)) ??
    rows
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((id) => !gone.has(id))
  );
}
