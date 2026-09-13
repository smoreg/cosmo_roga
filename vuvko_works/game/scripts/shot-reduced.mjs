#!/usr/bin/env node
/** The same screen for someone who asked for no motion. */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4334/";
const out = process.argv[3] ?? "/tmp/reduced.png";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.emulateMedia({ reducedMotion: "reduce" });
page.on("pageerror", (problem) => console.log("[pageerror]", String(problem).slice(0, 300)));
await page.goto(url, { waitUntil: "networkidle" });
for (const rx of [/click to proceed/i, /^continue$/i, /new game/i, /board it/i]) {
  try {
    const el = page.getByText(rx).first();
    await el.waitFor({ timeout: 9000 });
    await el.click();
  } catch {
    /* not in the flow this run */
  }
  await page.waitForTimeout(600);
}
await page.waitForSelector("[data-unit]", { timeout: 20000 });
/* Straight away: with motion off there is nothing to wait for, and if the
   screen is right this shot is already complete. */
await page.waitForTimeout(150);
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
