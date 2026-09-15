/**
 * The cover plate, screenshotted out of the running game.
 *
 *   npm run dev -w games/salvor      (in another shell)
 *   node tools/cover/shoot.mjs [url] [out]
 *
 * Taken at twice the size and scaled back down, because the hull is thin line
 * work over deck plating and a 1× shot of it aliases into mud. What comes out
 * is exactly 630×500, which is itch.io's own cover size.
 */
/* Playwright is not a dependency of this repo — nothing ships it and no test
   needs it. This runs on a workstation to make one file, so it is resolved
   from wherever the machine already has it, the same bargain `tools/deck`
   strikes with ImageMagick. */
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright").catch(() => {
  console.error("needs playwright: npx playwright install, or PLAYWRIGHT=/path/to/playwright/index.mjs");
  process.exit(1);
});

const url = process.argv[2] ?? "http://localhost:5173/cover.html";
const out = process.argv[3] ?? new URL("../../assets/cover.png", import.meta.url).pathname;

/* CHROME=/usr/bin/chromium uses the system browser rather than one of
   playwright's own downloads. */
const browser = await chromium.launch(
  process.env.CHROME === undefined ? {} : { executablePath: process.env.CHROME },
);
const page = await browser.newPage({
  viewport: { width: 630, height: 500 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: "networkidle" });
/* The deck art arrives over the network and the labels resolve out of noise on
   the frame clock; both have to have landed before the shutter. */
await page.waitForTimeout(3500);
await page.locator("#plate").screenshot({ path: out, scale: "css" });
await browser.close();
console.log(`  ${out} — 630x500`);
