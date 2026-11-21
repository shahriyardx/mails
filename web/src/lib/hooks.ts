import { useSyncExternalStore } from "react";

/** True while the media query matches; follows changes. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's md breakpoint (phones). */
export const useIsPhone = () => useMediaQuery("(max-width: 767px)");

/** A touch screen (no fine pointer): enables swipe gestures. */
export const useIsTouch = () => useMediaQuery("(pointer: coarse)");

/**
 * Whether a key landing on `target` belongs to what is there: a text
 * field, or a dialog or menu (the composer, the command menu, a dropdown).
 */
export function inTextOrDialog(target: EventTarget | null) {
  return Boolean(
    (target as Element | null)?.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=dialog], [role=menu]',
    ),
  );
}

/**
 * Whether a one-key shortcut ("c", "/") should stay quiet: a modifier is
 * held, or the key lands in a text field, a dialog such as the composer,
 * or a menu.
 */
export function shortcutBlocked(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey || event.altKey || inTextOrDialog(event.target);
}
