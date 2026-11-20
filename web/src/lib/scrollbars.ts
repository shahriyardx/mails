/**
 * Scrollbars show only while something scrolls: the scrolled element gets
 * data-scrolling for a moment, and app.css colours its thumb only then.
 * One capturing listener for the whole page, so every scroll box is covered.
 */
export function installScrollbars() {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target instanceof Element ? event.target : document.documentElement;
      el.setAttribute("data-scrolling", "");
      clearTimeout(timers.get(el));
      timers.set(
        el,
        window.setTimeout(() => el.removeAttribute("data-scrolling"), 900),
      );
    },
    { capture: true, passive: true },
  );
}
