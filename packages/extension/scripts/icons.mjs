// Renders assets/icon.svg to public/icon/{16,32,48,96,128}.png with a
// transparent background. Needs a Chromium: CHROME (default /usr/bin/chromium)
// and playwright-core from web/.
//   node scripts/icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../../web/node_modules/playwright-core/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "assets/icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/chromium" });
for (const size of [16, 32, 48, 96, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: join(root, `public/icon/${size}.png`), omitBackground: true });
  await page.close();
}
await browser.close();
