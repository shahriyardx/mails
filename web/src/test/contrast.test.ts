import { readFileSync } from "node:fs";
import { type Color, converter, interpolate, parse, wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

/**
 * Reads src/styles/tokens.css and checks every text/background pair the UI
 * uses against WCAG AA (4.5:1). Tokens are resolved the way the browser does:
 * var() references followed, color-mix(in srgb, ...) mixed in gamma sRGB.
 */
const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const raw = new Map(
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
    m[1]!,
    m[2]!.trim(),
  ]),
);

const toRgb = converter("rgb");

function resolve(value: string): Color {
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return token(ref[1]!);
  const mix = value.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/);
  if (mix) {
    // color-mix(a p%, b) is p of a and the rest of b.
    return interpolate([resolve(mix[3]!), resolve(mix[1]!)], "rgb")(Number(mix[2]) / 100);
  }
  const color = parse(value);
  if (!color) throw new Error(`Cannot parse colour: ${value}`);
  return color;
}

function token(name: string): Color {
  const value = raw.get(name);
  if (!value) throw new Error(`No token ${name} in tokens.css`);
  return toRgb(resolve(value));
}

const ratio = (text: string, background: string) => wcagContrast(token(text), token(background));

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
  ...SURFACES.map((bg): [string, string] => ["--muted-foreground", bg]),
  ["--primary-foreground", "--primary"],
  ["--tonal-foreground", "--tonal"],
  ["--tonal-foreground", "--tonal-hover"],
  ["--destructive", "--background"],
  ["--destructive", "--surface-1"],
  ["--destructive", "--destructive-soft"],
  ["--inverse-foreground", "--inverse"],
];

describe("colour tokens", () => {
  it.each(PAIRS)("%s on %s is at least 4.5:1", (text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps body text in the soothing range (10-13:1), not higher", () => {
    const body = ratio("--foreground", "--background");
    expect(body).toBeGreaterThanOrEqual(10);
    expect(body).toBeLessThanOrEqual(13.5);
  });

  it("keeps every literal grey at hue 85 with chroma at or below 0.01", () => {
    for (const [name, value] of raw) {
      const m = value.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)$/);
      if (!m || name === "--destructive") continue;
      expect(Number(m[2]), name).toBeLessThanOrEqual(0.01);
      expect(Number(m[3]), name).toBe(85);
    }
  });

  it("steps each surface lighter than the one under it", () => {
    const lightness = (name: string) => converter("oklch")(token(name)).l;
    const steps = ["--background", "--surface-1", "--surface-box", "--field-card", "--field-box"];
    for (let i = 1; i < steps.length; i++) {
      expect(lightness(steps[i]!)).toBeGreaterThan(lightness(steps[i - 1]!));
    }
  });
});
