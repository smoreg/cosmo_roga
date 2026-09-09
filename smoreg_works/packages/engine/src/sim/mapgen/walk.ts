import { Grid, DIRS4 } from "../grid.js";
import { Tile } from "../level.js";
import type { BuildContext, BuildResult, MapBuilder } from "./types.js";

export interface WalkOptions {
  /** Target fraction of the map to carve out. */
  coverage: number;
  /** Number of independent diggers. 1 = one winding cave, 4 = a cave system. */
  diggers: number;
  /** Chance a digger keeps its current heading instead of turning. */
  inertia: number;
}

export const WALK_DEFAULTS: WalkOptions = {
  coverage: 0.4,
  diggers: 3,
  inertia: 0.7,
};

/**
 * Drunkard's walk. The cheapest generator that produces a playable space, and
 * the one to fall back on when a fancier algorithm misbehaves on day 12.
 * Guaranteed connected when diggers share a start; ours do not, so it still
 * goes through connectRegions().
 */
export class WalkBuilder implements MapBuilder {
  readonly name = "walk";
  private opts: WalkOptions;

  constructor(opts: Partial<WalkOptions> = {}) {
    this.opts = { ...WALK_DEFAULTS, ...opts };
  }

  build(ctx: BuildContext): BuildResult {
    const { width, height, rng } = ctx;
    const tiles = new Grid<Tile>(width, height, Tile.Wall);
    const target = Math.floor(width * height * this.opts.coverage);
    let carved = 0;

    const diggers = Array.from({ length: this.opts.diggers }, () => ({
      x: rng.int(2, width - 3),
      y: rng.int(2, height - 3),
      dir: rng.pick(DIRS4),
    }));

    // Bounded: a digger that keeps bouncing off walls must not hang the build.
    const maxSteps = target * 40;
    for (let step = 0; step < maxSteps && carved < target; step++) {
      for (const d of diggers) {
        if (tiles.at(d.x, d.y) !== Tile.Floor) {
          tiles.set(d.x, d.y, Tile.Floor);
          carved++;
        }
        if (!rng.chance(this.opts.inertia)) d.dir = rng.pick(DIRS4);
        const nx = d.x + d.dir.x;
        const ny = d.y + d.dir.y;
        if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) {
          d.dir = rng.pick(DIRS4);
          continue;
        }
        d.x = nx;
        d.y = ny;
      }
    }

    return { tiles, rooms: [] };
  }
}
