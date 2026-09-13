#!/usr/bin/env node
/**
 * Photograph the game with a drone picked up.
 *
 * `screenshot.mjs` shows the opening position, which is the one state where the
 * kit's side panel is deliberately absent — so it can never show whether the
 * panel is right. This clicks a drone token first.
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4333/";
const out = process.argv[3] ?? "/tmp/selected.png";
const size = (process.env.VIEWPORT ?? "1280x720").split("x").map(Number);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
});
const page = await browser.newPage({
  viewport: { width: size[0] ?? 1280, height: size[1] ?? 720 },
});
page.on("pageerror", (problem) => console.log("[pageerror]", String(problem).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });

for (const rx of [/click to proceed/i, /^continue$/i, /new game/i, /board it/i]) {
  try {
    const el = page.getByText(rx).first();
    await el.waitFor({ timeout: 9000 });
    await el.click();
  } catch {
    /* A screen that is not in the flow this run. */
  }
  await page.waitForTimeout(700);
}

await page.waitForSelector("[data-unit]", { timeout: 20000 });
const token = page.locator("[data-unit]").first();
const box = await token.boundingBox();
if (box !== null) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(900);

/* And hover a hex a few steps off, so the shot shows the planned route rather
   than only the selection. */
if (box !== null) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 150, { steps: 12 });
}
await page.waitForTimeout(900);
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
