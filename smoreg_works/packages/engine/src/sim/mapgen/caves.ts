import { Grid, DIRS8 } from "../grid.js";
import { Tile } from "../level.js";
import type { BuildContext, BuildResult, MapBuilder } from "./types.js";

export interface CavesOptions {
  /** Fraction of tiles that start as wall. 0.45 is the classic sweet spot. */
  fillProbability: number;
  /** Smoothing generations. 4-5 gives cave-like blobs; 1-2 stays noisy. */
  generations: number;
  /** A cell becomes wall when it has at least this many wall neighbours. */
  birthLimit: number;
  /** A wall stays wall when it has at least this many wall neighbours. */
  survivalLimit: number;
}

export const CAVES_DEFAULTS: CavesOptions = {
  fillProbability: 0.45,
  generations: 4,
  birthLimit: 5,
  survivalLimit: 4,
};

/**
 * Cellular automata caves. Organic, fast, and the natural counterpart to
 * rooms-and-corridors — two generators is what makes procedural depth feel like
 * a place rather than a template.
 *
 * Produces islands by nature, so it must be run through connectRegions().
 */
export class CavesBuilder implements MapBuilder {
  readonly name = "caves";
  private opts: CavesOptions;

  constructor(opts: Partial<CavesOptions> = {}) {
    this.opts = { ...CAVES_DEFAULTS, ...opts };
  }

  build(ctx: BuildContext): BuildResult {
    const { width, height, rng } = ctx;
    let tiles = new Grid<Tile>(width, height, Tile.Wall);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        tiles.set(x, y, rng.chance(this.opts.fillProbability) ? Tile.Wall : Tile.Floor);
      }
    }

    for (let gen = 0; gen < this.opts.generations; gen++) {
      tiles = this.step(tiles);
    }

    return { tiles, rooms: [] };
  }

  private step(tiles: Grid<Tile>): Grid<Tile> {
    const next = new Grid<Tile>(tiles.width, tiles.height, Tile.Wall);
    for (let y = 1; y < tiles.height - 1; y++) {
      for (let x = 1; x < tiles.width - 1; x++) {
        let walls = 0;
        for (const d of DIRS8) {
          const t = tiles.get(x + d.x, y + d.y);
          if (t === undefined || t === Tile.Wall) walls++;
        }
        const isWall = tiles.at(x, y) === Tile.Wall;
        const stays = isWall ? walls >= this.opts.survivalLimit : walls >= this.opts.birthLimit;
        next.set(x, y, stays ? Tile.Wall : Tile.Floor);
      }
    }
    return next;
  }
}
