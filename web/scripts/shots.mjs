// Screenshots of the dashboard for review: the inbox, a conversation, the
// composer, settings pages and a phone-width inbox.
//
//   mails seed-demo                      # some mail to look at
//   COOKIE=$(mails session) pnpm shots   # against a running Mails
//
// BASE (default http://localhost:3000), OUT (default shots/) and CHROME
// (default /usr/bin/chromium) can be set. Uses playwright-core with the
// system Chromium, so no browser download.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const OUT = process.env.OUT ?? "shots";
const COOKIE = process.env.COOKIE;
if (!COOKIE) {
  console.error("COOKIE is required: run `mails session` on the server and pass its output.");
  process.exit(1);
}

const desktop = { width: 1440, height: 900 };
const phone = { width: 414, height: 860 };

/** name, path, viewport, and an optional step before the picture. */
const SHOTS = [
  { name: "inbox", path: "/mail/all/inbox", viewport: desktop },
  { name: "conversation", path: "/mail/all/inbox", viewport: desktop, step: openFirstThread },
  { name: "composer", path: "/mail/all/inbox", viewport: desktop, step: openComposer },
  { name: "settings-domains", path: "/settings/domains", viewport: desktop },
  { name: "settings-mailboxes", path: "/settings/mailboxes", viewport: desktop },
  { name: "settings-reporting", path: "/settings/reporting", viewport: desktop },
  { name: "settings-api-keys", path: "/settings/api-keys", viewport: desktop },
  { name: "docs", path: "/docs/guide/self-hosting", viewport: desktop },
  { name: "phone-inbox", path: "/mail/all/inbox", viewport: phone, scale: 2 },
];

async function openFirstThread(page) {
  await page.getByRole("listitem").first().click();
  await page.waitForLoadState("networkidle");
}

async function openComposer(page) {
  await page
    .getByRole("button", { name: /compose/i })
    .first()
    .click();
  await page.waitForTimeout(400); // let the spring settle
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/chromium",
});
const { hostname, protocol } = new URL(BASE);
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: shot.scale ?? 1,
      reducedMotion: "reduce",
      colorScheme: "dark",
    });
    await context.addCookies([
      {
        name: "mails_session",
        value: COOKIE,
        domain: hostname,
        path: "/",
        secure: protocol === "https:",
      },
    ]);
    const page = await context.newPage();
    await page.goto(BASE + shot.path, { waitUntil: "networkidle" });
    if (page.url().includes("/sign-in"))
      throw new Error("The cookie was refused: run `mails session` again.");
    if (shot.step) await shot.step(page);
    await page.screenshot({ path: `${OUT}/${shot.name}.png`, animations: "disabled" });
    console.log(`${OUT}/${shot.name}.png`);
    await context.close();
  }
} finally {
  await browser.close();
}
