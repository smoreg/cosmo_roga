import type { Entity } from "../entity.js";
import { Grid, type Point } from "../grid.js";
import { Level, Tile, TILES, isAirlock } from "../level.js";
import type { Rng } from "../rng.js";
import { BspBuilder } from "./bsp.js";
import { CavesBuilder } from "./caves.js";
import { RoomsBuilder } from "./rooms.js";
import { WalkBuilder } from "./walk.js";
import { connectRegions, enforceBorder, placeDoors, removeDeadEnds, sealUnreachable } from "./postprocess.js";
import { collectVaultFlags, placeVaults, type PlacedVault, type Vault, type VaultContext } from "./vaults.js";
import { validate, type Problem } from "./validate.js";
import type { BuildResult, MapBuilder } from "./types.js";

export * from "./types.js";
export * from "./postprocess.js";
export * from "./regions.js";
export * from "./storylets.js";
export * from "./vaults.js";
export * from "./validate.js";
export { BspBuilder, BSP_DEFAULTS } from "./bsp.js";
export { CavesBuilder, CAVES_DEFAULTS } from "./caves.js";
export { RoomsBuilder, ROOMS_DEFAULTS } from "./rooms.js";
export { WalkBuilder, WALK_DEFAULTS } from "./walk.js";
export {
  DeckBuilder,
  type DeckPlan,
  type ZoneKindSpec,
  type InteriorStyle,
  type ZoneDensity,
} from "./deck.js";

export interface LevelSpec {
  width: number;
  height: number;
  builder: MapBuilder;
  vaults?: readonly Vault[];
  vaultCount?: number;
  /** Run flags a storylet's `when` may read. Default: none. */
  flags?: ReadonlySet<string>;
  /** The player, for storylets that ask about its state. */
  player?: Entity;
  doorChance?: number;
  /**
   * Tunnel disconnected regions together. Default true. A builder that already
   * guarantees connectivity turns it off — otherwise a bug in it is silently
   * papered over by a corridor dug straight through whatever was in the way.
   */
  connect?: boolean;
  /** Fill in one-tile corridor stubs. Off for caves, on for mazy layouts. */
  trimDeadEnds?: boolean;
  minWalkable?: number;
  minStairsDistance?: number;
  /** Retries before giving up and returning the least-bad attempt. */
  maxAttempts?: number;
}

export interface GeneratedLevel {
  level: Level;
  entry: Point;
  stairs: Point;
  vaults: PlacedVault[];
  /** Flags the placed vaults raised; the game folds them into its run flags. */
  flagsSet: string[];
  builderName: string;
  attempts: number;
  /** Problems that survived every attempt. Empty in the normal case. */
  problems: Problem[];
}

export const DEFAULT_SPEC: Omit<LevelSpec, "builder"> = {
  width: 70,
  height: 34,
  vaultCount: 1,
  doorChance: 0.3,
  connect: true,
  trimDeadEnds: false,
  minWalkable: 220,
  minStairsDistance: 15,
  maxAttempts: 14,
};

/**
 * One generator per depth band, so the dungeon changes character as it goes
 * down. Nothing here is content — swapping the bands is a one-line change and
 * every builder is already covered by the same property tests.
 */
export function builderForDepth(depth: number): MapBuilder {
  if (depth <= 2) return new RoomsBuilder();
  if (depth <= 4) return new BspBuilder();
  if (depth <= 6) return new CavesBuilder();
  return new WalkBuilder();
}

/**
 * Build → post-process → validate → retry. A level only escapes this function
 * when it passes every invariant, or when the retries ran out — in which case
 * the surviving problems are reported on the result rather than silently shipped.
 */
export function buildLevel(depth: number, rng: Rng, spec: LevelSpec): GeneratedLevel {
  const cfg = { ...DEFAULT_SPEC, ...spec };
  const maxAttempts = cfg.maxAttempts ?? 14;
  let leastBad: GeneratedLevel | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptRng = rng.fork(depth * 7919 + attempt * 104729);
    const built = assemble(depth, attemptRng, cfg);
    if (!built) continue;

    const problems = validate(built.level.tiles, {
      minWalkable: cfg.minWalkable ?? 220,
      minStairsDistance: cfg.minStairsDistance ?? 15,
      entry: built.entry,
      stairs: built.stairs,
    });

    const candidate: GeneratedLevel = { ...built, attempts: attempt + 1, problems };
    if (problems.length === 0) return candidate;
    if (!leastBad || problems.length < leastBad.problems.length) leastBad = candidate;
  }

  if (!leastBad) {
    throw new Error(`buildLevel: no usable level for depth ${depth} after ${maxAttempts} attempts`);
  }
  return leastBad;
}

function assemble(
  depth: number,
  rng: Rng,
  cfg: LevelSpec,
): Omit<GeneratedLevel, "attempts" | "problems"> | undefined {
  const ctx: VaultContext = { depth, flags: cfg.flags ?? EMPTY_FLAGS, player: cfg.player };
  const result: BuildResult = cfg.builder.build({
    width: cfg.width,
    height: cfg.height,
    depth,
    rng,
    flags: ctx.flags,
    player: ctx.player,
  });
  const tiles = result.tiles;
  const connect = cfg.connect !== false;

  enforceBorder(tiles);
  if (connect) connectRegions(tiles, rng);
  if (cfg.trimDeadEnds) removeDeadEnds(tiles);

  const pipelineVaults = cfg.vaults && cfg.vaults.length > 0
    ? placeVaults(tiles, cfg.vaults, depth, rng, cfg.vaultCount ?? 1, ctx)
    : [];
  // A vault is stamped into solid rock, so it can land as an island.
  if (pipelineVaults.length > 0 && connect) connectRegions(tiles, rng);
  // The builder may have stamped its own (a deck places storylets per sector).
  const vaults = [...(result.vaults ?? []), ...pipelineVaults];
  const flagsSet = mergeFlags(result.flagsSet, collectVaultFlags(pipelineVaults));

  const entry = pickEntry(tiles, result, rng);
  if (!entry) return undefined;

  sealUnreachable(tiles, entry);

  const stairs = pickStairs(tiles, result, entry);
  if (!stairs) return undefined;
  tiles.set(stairs.x, stairs.y, Tile.StairsDown);

  if ((cfg.doorChance ?? 0) > 0) placeDoors(tiles, rng, cfg.doorChance);
  // Doors must never seal the entry or the stairs themselves.
  if (tiles.at(entry.x, entry.y) === Tile.Door) tiles.set(entry.x, entry.y, Tile.Floor);

  const level = new Level(depth, cfg.width, cfg.height);
  tiles.forEach((x, y, t) => level.tiles.set(x, y, t));
  level.rooms.push(...result.rooms);
  if (result.zones) level.zones.push(...result.zones);

  return { level, entry, stairs, vaults, flagsSet, builderName: cfg.builder.name };
}

const EMPTY_FLAGS: ReadonlySet<string> = new Set<string>();

function mergeFlags(a: readonly string[] | undefined, b: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of [...(a ?? []), ...b]) {
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

function pickEntry(tiles: Grid<Tile>, result: BuildResult, rng: Rng): Point | undefined {
  const hint = result.entryHint;
  if (hint && TILES[tiles.at(hint.x, hint.y)].walkable) return hint;

  const walkable: Point[] = [];
  tiles.forEach((x, y, t) => {
    if (TILES[t].walkable) walkable.push({ x, y });
  });
  if (walkable.length === 0) return undefined;
  return walkable[rng.int(0, walkable.length - 1)];
}

/**
 * The builder's hint wins when it points at plain floor; otherwise the deepest
 * tile from the entry. A hint on anything else is stale — a later pass moved
 * the map out from under it — and silently falling back beats a broken level.
 */
function pickStairs(tiles: Grid<Tile>, result: BuildResult, entry: Point): Point | undefined {
  const hint = result.stairsHint;
  if (hint && tiles.get(hint.x, hint.y) === Tile.Floor) return hint;
  return farthestWalkable(tiles, entry);
}

/** BFS from the entry; the deepest tile becomes the stairs. */
function farthestWalkable(tiles: Grid<Tile>, from: Point): Point | undefined {
  const dist = new Grid<number>(tiles.width, tiles.height, -1);
  dist.set(from.x, from.y, 0);
  const queue: Point[] = [from];
  let head = 0;
  let best = from;
  let bestD = 0;

  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist.at(cur.x, cur.y);
    // Walk through airlocks, never stop on one: a hatch in a doorway between
    // two zones belongs to neither of them, and one cut into the way out would
    // be the way out.
    if (d > bestD && !isAirlock(tiles.at(cur.x, cur.y))) {
      bestD = d;
      best = cur;
    }
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
  return bestD > 0 ? best : undefined;
}
