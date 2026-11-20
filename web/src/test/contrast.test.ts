import { readFileSync } from "node:fs";
import { type Color, converter, interpolate, parse, wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

/**
 * Reads src/styles/tokens.css and checks every text/background pair the UI
 * uses against WCAG AA (4.5:1), in both themes. Tokens are resolved the way
 * the browser does: var() references followed, color-mix(in srgb, ...) mixed
 * in gamma sRGB. The light block only overrides, so it is read on top of the
 * dark one.
 */
const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

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

function resolve(theme: Theme, value: string): Color {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return token(theme, ref[1]!);
  const mix = value.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/);
  if (mix) {
    // color-mix(a p%, b) is p of a and the rest of b.
    return interpolate(
      [resolve(theme, mix[3]!), resolve(theme, mix[1]!)],
      "rgb",
    )(Number(mix[2]) / 100);
  }
  const color = parse(value);
  if (!color) throw new Error(`Cannot parse colour: ${value}`);
  return color;
}

function token(theme: Theme, name: string): Color {
  const value = THEMES[theme].get(name);
  if (!value) throw new Error(`No token ${name} in tokens.css (${theme})`);
  return toRgb(resolve(theme, value));
}

const ratio = (theme: Theme, text: string, background: string) =>
  wcagContrast(token(theme, text), token(theme, background));

// Text on every surface it can sit on.
const SURFACES = [
  "--background",
  "--surface-1",
  "--surface-2",
  "--surface-box",
  "--field-card",
  "--field-box",
  "--tonal",
  "--tonal-hover",
  "--selected",
];
const PAIRS: [string, string][] = [
  ...SURFACES.map((bg): [string, string] => ["--foreground", bg]),
  ...SURFACES.map((bg): [string, string] => ["--soft-foreground", bg]),
  ...SURFACES.map((bg): [string, string] => ["--muted-foreground", bg]),
  ["--primary-foreground", "--primary"],
  ["--accent", "--background"],
  ["--accent", "--surface-1"],
  ["--accent", "--accent-soft"],
  ["--foreground", "--accent-soft"],
  ["--tonal-foreground", "--tonal"],
  ["--tonal-foreground", "--tonal-hover"],
  ["--destructive", "--background"],
  ["--destructive", "--surface-1"],
  ["--destructive", "--destructive-soft"],
  ["--inverse-foreground", "--inverse"],
];

const CASES = (Object.keys(THEMES) as Theme[]).flatMap((theme) =>
  PAIRS.map(([text, bg]) => [theme, text, bg] as const),
);

describe("colour tokens", () => {
  it("defines the same tokens in both themes", () => {
    const light = block(/^\s*:root\[data-theme="light"\]\s*$/);
    expect([...light.keys()].sort()).toEqual([...dark.keys()].sort());
  });

  it.each(CASES)("%s: %s on %s is at least 4.5:1", (theme, text, background) => {
    expect(ratio(theme, text, background)).toBeGreaterThanOrEqual(4.5);
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
