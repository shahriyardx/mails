// Renders public/favicon.svg to the app icons the manifest and iOS use:
// public/icons/{192,512}.png (transparent), maskable-512.png and
// apple-touch-icon.png (on the dark app colour). Needs a Chromium:
// CHROME (default /usr/bin/chromium).
//   node scripts/pwa-icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "public/favicon.svg"), "utf8");
const icons = [
  { file: "192.png", size: 192, scale: 1, bg: "transparent" },
  { file: "512.png", size: 512, scale: 1, bg: "transparent" },
  // Maskable icons get cut to a circle or squircle: keep the mark in the middle 60%.
  { file: "maskable-512.png", size: 512, scale: 0.6, bg: "#16151a" },
  { file: "apple-touch-icon.png", size: 180, scale: 0.72, bg: "#16151a" },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/chromium" });
for (const { file, size, scale, bg } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * scale);
  await page.setContent(
    `<style>html,body{margin:0;background:${bg};height:100%;display:grid;place-items:center}svg{display:block;width:${inner}px;height:${inner}px}</style>${svg}`,
  );
  await page.screenshot({ path: join(root, "public/icons", file), omitBackground: bg === "transparent" });
  await page.close();
}
await browser.close();
