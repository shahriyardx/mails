import { existsSync, readFileSync } from "node:fs";
import { type Color, converter, parse, wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

/**
 * assets/tokens.css is a copy of the dashboard's. This checks it has not
 * drifted, and (like web/src/test/contrast.test.ts) that every text/background
 * pair the extension uses is at least 4.5:1 in both themes.
 */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
const css = strip(readFileSync(new URL("../assets/tokens.css", import.meta.url), "utf8"));

function block(selector: RegExp) {
  const body = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find((m) => selector.test(m[1]!))?.[2];
  if (!body) throw new Error(`No block ${selector} in tokens.css`);
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

const dark = block(/data-theme="dark"/);
const THEMES = {
  dark,
  light: new Map([...dark, ...block(/^\s*:root\[data-theme="light"\]\s*$/)]),
};
type Theme = keyof typeof THEMES;

const toRgb = converter("rgb");
function token(theme: Theme, name: string): Color {
  const value = THEMES[theme].get(name);
  const ref = value?.match(/^var\((--[\w-]+)\)$/);
  if (ref) return token(theme, ref[1]!);
  const color = value && parse(value);
  if (!color) throw new Error(`No colour for ${name} (${theme})`);
  return toRgb(color);
}

const SURFACES = [
  "--background",
  "--surface-1",
  "--surface-2",
  "--surface-box",
  "--field-card",
  "--tonal",
  "--tonal-hover",
  "--selected",
];
const PAIRS: [string, string][] = [
  ...SURFACES.flatMap((bg): [string, string][] => [
    ["--foreground", bg],
    ["--soft-foreground", bg],
    ["--muted-foreground", bg],
  ]),
  ["--primary-foreground", "--primary"],
  ["--accent", "--background"],
  ["--accent", "--surface-1"],
  ["--accent", "--accent-soft"],
  ["--foreground", "--accent-soft"],
  ["--destructive", "--background"],
  ["--destructive", "--surface-1"],
  ["--destructive", "--destructive-soft"],
  ["--background", "--foreground"], // the picked chip
];

const CASES = (Object.keys(THEMES) as Theme[]).flatMap((theme) =>
  PAIRS.map(([text, bg]) => [theme, text, bg] as const),
);

describe("colour tokens", () => {
  const web = new URL("../../../web/src/styles/tokens.css", import.meta.url);
  it.skipIf(!existsSync(web))("match web/src/styles/tokens.css", () => {
    expect(css).toBe(strip(readFileSync(web, "utf8")));
  });

  it.each(CASES)("%s: %s on %s is at least 4.5:1", (theme, text, background) => {
    expect(wcagContrast(token(theme, text), token(theme, background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.keys(THEMES) as Theme[])(
    "%s: initials avatars are readable at every hue",
    (theme) => {
      const n = (name: string) => Number(THEMES[theme].get(name));
      for (let h = 0; h < 360; h += 15) {
        const bg = parse(`oklch(${n("--avatar-bg-l")} ${n("--avatar-bg-c")} ${h})`)!;
        const fg = parse(`oklch(${n("--avatar-fg-l")} ${n("--avatar-fg-c")} ${h})`)!;
        expect(wcagContrast(fg, bg), `hue ${h}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
