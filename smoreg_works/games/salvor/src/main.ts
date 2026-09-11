import { App } from "./ui/app.js";
import { seedFromUrl } from "./ui/title.js";
import { LAYOUT, SCREEN_WIDTH, SCREEN_HEIGHT } from "./ui/theme.js";

const mount = document.getElementById("game");
if (!mount) throw new Error("#game mount point missing from index.html");

// ?seed=123 reproduces a voyage exactly — the cheapest bug-report channel there
// is. Anything else in the parameter is not a seed, and what the game does about
// that is `ui/title.ts`'s to say: a random ship here, the training hull there.
const seed = seedFromUrl(window.location.search) ?? ((Math.random() * 0xffffffff) >>> 0);

/**
 * 95×42 square cells at the design font size want 1710 px, which no laptop
 * has. Fit the grid to the window instead, and never below 12 px: a 1366×768
 * screen — the smallest one worth planning for — lands on 14.
 */
function fitFontSize(): number {
  const byWidth = Math.floor((window.innerWidth - 8) / SCREEN_WIDTH);
  const byHeight = Math.floor((window.innerHeight - 8) / SCREEN_HEIGHT);
  return Math.max(12, Math.min(byWidth, byHeight, LAYOUT.fontSize));
}

new App(mount, seed, fitFontSize());
