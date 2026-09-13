#!/usr/bin/env node
/**
 * Play the game in a real browser and take a picture of it.
 *
 * Everything the map is built from can be tested without a browser, and is —
 * but the one stage that cannot is the one that draws: generation needs a
 * canvas, and jsdom does not have one. So the deck plan was the part nobody
 * had actually looked at, which is how it came to be drawing at a sixth of
 * its size without a single test noticing.
 *
 * This clicks through the loader, the title and the briefing, waits for a
 * hull to generate, and writes a PNG. It reports console errors, page errors
 * and failed requests on the way, because a blank map is usually one of
 * those.
 *
 *     npm run build && npx vite preview --port 4321 &
 *     node scripts/screenshot.mjs http://localhost:4321/ /tmp/game.png
 *
 * Playwright's own browsers are a large download; set CHROMIUM to use one
 * that is already on the machine.
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4321/";
const out = process.argv[3] ?? "game.png";
const executablePath = process.env.CHROMIUM;

/* Each click is the only way to reach the next screen, so a miss is worth
   saying out loud rather than failing on a blank picture further along. */
const FLOW = [/click to proceed/i, /^continue$/i, /new game/i, /board|launch|begin|deploy/i];

const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
/* The kit's artboards are 1280x720 and 844x390, so the shot has to be takeable
   at those sizes to be comparable with them. */
const size = (process.env.VIEWPORT ?? "1280x900").split("x").map(Number);
const page = await browser.newPage({
  viewport: { width: size[0] ?? 1280, height: size[1] ?? 900 },
});
page.on("pageerror", function crashed(problem) {
  console.log("[pageerror]", String(problem).slice(0, 400));
});
page.on("console", function logged(message) {
  if (message.type() === "error") console.log("[console]", message.text().slice(0, 200));
});
page.on("requestfailed", function lost(request) {
  console.log("[failed]", request.url().slice(-80), request.failure()?.errorText ?? "");
});

await page.goto(url, { waitUntil: "networkidle" });
for (const name of FLOW) {
  const button = page.getByRole("button", { name }).first();
  try {
    await button.waitFor({ state: "visible", timeout: 90_000 });
    await button.click();
    await page.waitForTimeout(1200);
  } catch {
    console.log("[missing]", String(name));
  }
}

/* The backdrop arrives as a data URL once the tiles are drawn; without it
   there is no point photographing the map. */
try {
  await page.waitForSelector("image[href^='data:']", { timeout: 120_000 });
} catch {
  console.log("[missing] the deck plan never rendered");
}
await page.waitForTimeout(2000);

console.log("[title]", (await page.locator("body").innerText()).split("\n")[0]);
await page.screenshot({ path: out });
await browser.close();
console.log("saved", out);
