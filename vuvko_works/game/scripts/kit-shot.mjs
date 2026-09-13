#!/usr/bin/env node
/**
 * Photograph an artboard out of the exported kit, so the game can be compared
 * against it rather than against a memory of it.
 *
 *     node scripts/kit-shot.mjs 4a /tmp/4a.png
 */
import { chromium } from "playwright";
import { resolve } from "node:path";

const which = process.argv[2] ?? "4a";
const out = process.argv[3] ?? `/tmp/${which}.png`;
const kit = resolve(import.meta.dirname, "../../extra_design/Derelict UI Kit.dc.html");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(`file://${kit}`, { waitUntil: "networkidle" });
/* The artboard, not the label above it: the first [data-frame] inside the
   section, which is the 1280x720 or 844x390 box the kit draws into. */
const frame = page.locator(`[id="${which}"] [data-frame]`).first();
await frame.waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
await frame.screenshot({ path: out });
const box = await frame.boundingBox();
console.log(`${which}  ${box?.width}x${box?.height}  -> ${out}`);
await browser.close();
