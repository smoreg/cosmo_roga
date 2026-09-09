import { PALETTE } from "../content/palette.js";

/**
 * One place for every colour, for the renderer's own imports. The colours
 * themselves live in `content/palette.ts` now — plain data, importable from
 * `src/twist` and `src/systems` without dragging a renderer into the rules
 * (`tests/purity.test.ts`) — and this is that table under the name the screen
 * has always known it by.
 */
export const THEME = PALETTE;

export const LAYOUT = {
  mapWidth: 66,
  mapHeight: 34,
  sidebarWidth: 29,
  logHeight: 7,
  fontSize: 18,
} as const;

export const SCREEN_WIDTH = LAYOUT.mapWidth + LAYOUT.sidebarWidth;
export const SCREEN_HEIGHT = LAYOUT.mapHeight + LAYOUT.logHeight + 1;
