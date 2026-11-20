import { spring, type Transition } from "motion/react";

/**
 * Spring presets, after Material 3 Expressive: spatial springs (position,
 * size, shape) carry a little bounce, effects springs (opacity, colour) none.
 * Bounce stays low so things settle softly instead of jiggling.
 *
 * Use these with motion components. CSS transitions (Base UI popups, button
 * press) read the same springs through --spring-spatial / --spring-effects,
 * set once at start by installSpringVars().
 */
export const spatial = {
  type: "spring",
  visualDuration: 0.35,
  bounce: 0.15,
} as const satisfies Transition;
export const spatialFast = {
  type: "spring",
  visualDuration: 0.22,
  bounce: 0.1,
} as const satisfies Transition;
export const effects = {
  type: "spring",
  visualDuration: 0.2,
  bounce: 0,
} as const satisfies Transition;

/**
 * Writes the springs as CSS custom properties ("<ms> linear(...)"). Under
 * prefers-reduced-motion the spatial spring becomes instant, so popups and
 * presses only fade.
 */
export function installSpringVars() {
  const style = document.createElement("style");
  const css = (t: { visualDuration: number; bounce: number }) =>
    String(spring(t.visualDuration, t.bounce));
  style.textContent = `:root{--spring-spatial:${css(spatial)};--spring-spatial-fast:${css(spatialFast)};--spring-effects:${css(effects)}}
@media (prefers-reduced-motion: reduce){:root{--spring-spatial:0s;--spring-spatial-fast:0s}}`;
  document.head.append(style);
}
