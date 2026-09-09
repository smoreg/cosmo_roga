import { Grid, type Point } from "../grid.js";
import { Tile, TILES } from "../level.js";
import { findRegions } from "./postprocess.js";

export interface Problem {
  code: "too-small" | "disconnected" | "no-entry" | "border-open" | "no-stairs" | "stairs-too-close";
  detail: string;
}

export interface ValidateOptions {
  /** Reject a level with fewer walkable tiles than this. */
  minWalkable: number;
  /** Reject when the stairs are fewer than this many steps from the entry. */
  minStairsDistance: number;
  entry?: Point;
  stairs?: Point;
}

/**
 * Every generator output goes through this before it can become a Level.
 * The point is that a broken map is caught in the builder loop, where the fix
 * is "retry with the next seed", not in a player's browser, where the fix is a
 * one-star Robustness rating.
 *
 * Derived from the fuzz-testing requirement used in procgen research: every
 * placed thing must be reachable from the player's start by flood fill.
 */
export function validate(tiles: Grid<Tile>, opts: ValidateOptions): Problem[] {
  const problems: Problem[] = [];

  let walkable = 0;
  tiles.forEach((_x, _y, t) => {
    if (TILES[t].walkable) walkable++;
  });
  if (walkable < opts.minWalkable) {
    problems.push({ code: "too-small", detail: `${walkable} walkable tiles < ${opts.minWalkable}` });
  }

  const regions = findRegions(tiles);
  if (regions.length > 1) {
    problems.push({ code: "disconnected", detail: `${regions.length} separate regions` });
  }
  if (regions.length === 0) {
    problems.push({ code: "no-entry", detail: "no walkable tile at all" });
    return problems;
  }

  for (let x = 0; x < tiles.width; x++) {
    if (TILES[tiles.at(x, 0)].walkable || TILES[tiles.at(x, tiles.height - 1)].walkable) {
      problems.push({ code: "border-open", detail: `open border at column ${x}` });
      break;
    }
  }
  for (let y = 0; y < tiles.height; y++) {
    if (TILES[tiles.at(0, y)].walkable || TILES[tiles.at(tiles.width - 1, y)].walkable) {
      problems.push({ code: "border-open", detail: `open border at row ${y}` });
      break;
    }
  }

  if (opts.entry && !TILES[tiles.at(opts.entry.x, opts.entry.y)].walkable) {
    problems.push({ code: "no-entry", detail: `entry ${opts.entry.x},${opts.entry.y} is not walkable` });
  }

  if (opts.stairs) {
    if (tiles.at(opts.stairs.x, opts.stairs.y) !== Tile.StairsDown) {
      problems.push({ code: "no-stairs", detail: "stairs tile missing at the recorded position" });
    }
    if (opts.entry) {
      const d = bfsDistance(tiles, opts.entry, opts.stairs);
      if (d < 0) problems.push({ code: "disconnected", detail: "stairs unreachable from entry" });
      else if (d < opts.minStairsDistance) {
        problems.push({ code: "stairs-too-close", detail: `${d} steps < ${opts.minStairsDistance}` });
      }
    }
  } else {
    problems.push({ code: "no-stairs", detail: "no stairs placed" });
  }

  return problems;
}

function bfsDistance(tiles: Grid<Tile>, from: Point, to: Point): number {
  if (!TILES[tiles.at(from.x, from.y)].walkable) return -1;
  const dist = new Grid<number>(tiles.width, tiles.height, -1);
  dist.set(from.x, from.y, 0);
  const queue: Point[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur.x === to.x && cur.y === to.y) return dist.at(cur.x, cur.y);
    const d = dist.at(cur.x, cur.y);
    for (const n of [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ]) {
      if (!tiles.inBounds(n.x, n.y) || dist.at(n.x, n.y) !== -1) continue;
      if (!TILES[tiles.at(n.x, n.y)].walkable) continue;
      dist.set(n.x, n.y, d + 1);
      queue.push(n);
    }
  }
  return -1;
}
