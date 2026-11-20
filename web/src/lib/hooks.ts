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
 * Whether a one-key shortcut ("c", "/") should stay quiet: a modifier is
 * held, or the key lands in a text field or a dialog such as the composer.
 */
export function shortcutBlocked(event: KeyboardEvent) {
  const target = event.target as Element | null;
  return Boolean(
    event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      target?.closest?.(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=dialog]',
      ),
  );
}
