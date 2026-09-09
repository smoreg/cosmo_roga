/**
 * Facade over the mapgen family. Keeps a single stable entry point for the game
 * while the builders, post-processing passes and validator live in mapgen/.
 */
import { Grid, DIRS4, type Point, chebyshev } from "./grid.js";
import type { Level } from "./level.js";
import type { Rng } from "./rng.js";
import {
  BspBuilder,
  CavesBuilder,
  RoomsBuilder,
  WalkBuilder,
  buildLevel,
  builderForDepth,
  DEFAULT_SPEC,
  type GeneratedLevel,
  type LevelSpec,
  type MapBuilder,
} from "./mapgen/index.js";
import type { Vault } from "./mapgen/vaults.js";
import type { Entity } from "./entity.js";

export * from "./mapgen/index.js";
export type { GeneratedLevel };

export interface MapgenOptions {
  width: number;
  height: number;
  /** Kept for compatibility with the RoomsBuilder-only era. */
  dugPercentage?: number;
  /** Vault library available to every depth. */
  vaults?: readonly Vault[];
  vaultCount?: number;
  /** Force one builder instead of the per-depth rotation. Useful in tests. */
  builderName?: "rooms" | "bsp" | "caves" | "walk";
  /**
   * A ready-made builder, for generators that are constructed with data —
   * `new DeckBuilder(planForDepth)`. Wins over `builderName`.
   */
  builder?: MapBuilder;
  /** Tunnel disconnected regions together. Default true; decks pass false. */
  connect?: boolean;
  /**
   * Run flags a storylet's `when` may read, and the player it may ask about.
   * `Game` passes its own; a test generating a bare level can leave them out.
   */
  flags?: ReadonlySet<string>;
  player?: Entity;
}

export const DEFAULT_MAPGEN: MapgenOptions = {
  width: 70,
  height: 34,
  vaultCount: 1,
};

/** The game's level entry point. Delegates to the validated build pipeline. */
export function generateLevel(depth: number, rng: Rng, opts: MapgenOptions = DEFAULT_MAPGEN): GeneratedLevel {
  const spec: LevelSpec = {
    ...DEFAULT_SPEC,
    width: opts.width,
    height: opts.height,
    builder: opts.builder ?? (opts.builderName ? namedBuilder(opts.builderName) : builderForDepth(depth)),
    vaults: opts.vaults,
    vaultCount: opts.vaultCount ?? 1,
    connect: opts.connect ?? true,
    flags: opts.flags,
    player: opts.player,
  };
  return buildLevel(depth, rng, spec);
}

function namedBuilder(name: NonNullable<MapgenOptions["builderName"]>): MapBuilder {
  switch (name) {
    case "rooms": return new RoomsBuilder();
    case "bsp": return new BspBuilder();
    case "caves": return new CavesBuilder();
    case "walk": return new WalkBuilder();
  }
}

/** BFS distance field over walkable tiles. -1 = unreachable. */
export function distanceField(level: Level, origin: Point): Grid<number> {
  const dist = new Grid<number>(level.width, level.height, -1);
  if (!level.isWalkable(origin.x, origin.y)) return dist;

  dist.set(origin.x, origin.y, 0);
  const queue: Point[] = [origin];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist.at(cur.x, cur.y);
    for (const dir of DIRS4) {
      const nx = cur.x + dir.x;
      const ny = cur.y + dir.y;
      if (!level.tiles.inBounds(nx, ny)) continue;
      if (!level.isWalkable(nx, ny)) continue;
      if (dist.at(nx, ny) !== -1) continue;
      dist.set(nx, ny, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

/** Reachable tiles at least `minDist` steps and `minDist` chebyshev from `from`. */
export function spawnSpots(level: Level, from: Point, minDist: number): Point[] {
  const dist = distanceField(level, from);
  const spots: Point[] = [];
  dist.forEach((x, y, d) => {
    if (d >= minDist && level.isWalkable(x, y) && chebyshev({ x, y }, from) >= minDist) spots.push({ x, y });
  });
  return spots;
}
