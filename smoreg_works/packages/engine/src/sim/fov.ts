import type { Point } from "./grid.js";
import type { Level } from "./level.js";
import { shadowcast, lineOfSight } from "./shadowcast.js";

/**
 * Recompute `level.visible` and accumulate into `level.explored`.
 * Uses the symmetric shadowcaster, not rot.js: see the note in shadowcast.ts
 * for the measured asymmetry numbers that motivated it.
 */
export function computeFov(level: Level, origin: Point, radius: number): void {
  level.visible.fill(false);
  shadowcast(origin.x, origin.y, {
    transparent: (x, y) => level.isTransparent(x, y),
    reveal: (x, y) => {
      if (!level.tiles.inBounds(x, y)) return;
      level.visible.set(x, y, true);
      level.explored.set(x, y, true);
    },
    radius,
  });
}

/**
 * Line of sight between two points. Symmetric by construction, so a monster can
 * only shoot from a tile the player could have seen it on.
 */
export function hasLos(level: Level, from: Point, to: Point, maxRange: number): boolean {
  return lineOfSight(from, to, (x, y) => level.isTransparent(x, y), maxRange);
}
