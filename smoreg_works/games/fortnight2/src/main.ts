import { App } from "./ui/app.js";
import { LAYOUT, SCREEN_WIDTH, SCREEN_HEIGHT } from "./ui/theme.js";

const mount = document.getElementById("game");
if (!mount) throw new Error("#game mount point missing from index.html");

// ?seed=123 reproduces a run exactly — the cheapest bug-report channel there is.
const fromUrl = new URLSearchParams(window.location.search).get("seed");
const seed = fromUrl !== null && /^\d+$/.test(fromUrl) ? Number(fromUrl) >>> 0 : (Math.random() * 0xffffffff) >>> 0;

/**
 * 96×42 square cells at the design font size want 1728 px, which no laptop
 * has. Fit the grid to the window instead, and never below 12 px: a 1366×768
 * screen — the smallest one worth planning for — lands on 14.
 */
function fitFontSize(): number {
  const byWidth = Math.floor((window.innerWidth - 8) / SCREEN_WIDTH);
  const byHeight = Math.floor((window.innerHeight - 8) / SCREEN_HEIGHT);
  return Math.max(12, Math.min(byWidth, byHeight, LAYOUT.fontSize));
}

new App(mount, seed, fitFontSize());
