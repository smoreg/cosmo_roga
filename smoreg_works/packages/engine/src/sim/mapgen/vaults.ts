import type { Entity } from "../entity.js";
import { Grid, type Point } from "../grid.js";
import { Tile, TILES } from "../level.js";
import type { Rng } from "../rng.js";

/**
 * Prefab vaults: hand-drawn rooms stamped into a procedural level.
 *
 * This is the highest-value-per-line content tool in a jam. Purely procedural
 * levels feel samey; three hand-drawn vaults make a whole dungeon feel authored,
 * and each one is a text block anybody can add in a minute without touching code.
 *
 * Legend
 *   '#' wall      '.' floor     '>' stairs down    '+' door    '%' rubble
 *   '=' airlock   '|' sealed bulkhead   '<' outer airlock
 *   '?' wildcard: leave whatever is already there (use for ragged edges)
 *   any other char: a marker, returned in `marks` for the caller to populate
 *
 * The marker convention used by content code: 'm' monster, 'M' tough monster,
 * 'i' item, '!' trap, 'X' guaranteed loot. Nothing in sim/ enforces it.
 *
 * A vault with `when`/`weightWhen`/`sets` is a storylet in Emily Short's sense:
 * content plus a precondition on the run state plus an effect. The engine never
 * reads what a flag or a zone kind means — it only asks the predicate.
 */
export interface Vault {
  readonly name: string;
  readonly rows: readonly string[];
  /** Minimum depth this vault may appear on. */
  readonly minDepth?: number;
  /** Relative placement weight. */
  readonly weight?: number;
  /** Place at most this many per level. Default 1. */
  readonly maxPerLevel?: number;
  /** Zone kinds this vault may be stamped into. Absent = anywhere. */
  readonly zones?: readonly string[];
  /** Content predicate on the run state. Absent = always eligible. */
  readonly when?: (ctx: VaultContext) => boolean;
  /** Weight multiplier from state, for "more likely if…". Absent = 1. */
  readonly weightWhen?: (ctx: VaultContext) => number;
  /** Run flags to set once this vault is placed. */
  readonly sets?: readonly string[];
}

/**
 * What a storylet predicate may look at: how deep we are, which flags the run
 * has raised so far, and the player itself (its `data` is the game's own).
 */
export interface VaultContext {
  depth: number;
  flags: ReadonlySet<string>;
  player?: Entity;
}

export interface PlacedVault {
  vault: Vault;
  origin: Point;
  marks: Array<{ ch: string; pos: Point }>;
  /** Zone this vault was stamped into, for zone-aware placement. */
  zoneId?: number;
}

/** Empty run state, for callers that generate a level outside a run. */
export const NO_VAULT_STATE: ReadonlySet<string> = new Set<string>();

/** True when depth, zone kind and `when` all admit this vault. */
export function vaultEligible(v: Vault, ctx: VaultContext, zoneKind?: string): boolean {
  if (ctx.depth < (v.minDepth ?? 1)) return false;
  if (v.zones && (zoneKind === undefined || !v.zones.includes(zoneKind))) return false;
  if (v.when && !v.when(ctx)) return false;
  return true;
}

/** Placement weight after the state multiplier. Zero means "not this run". */
export function vaultWeight(v: Vault, ctx: VaultContext): number {
  const base = v.weight ?? 1;
  const mult = v.weightWhen ? v.weightWhen(ctx) : 1;
  return Math.max(0, base * mult);
}

const TILE_CHARS: Record<string, Tile> = {
  "#": Tile.Wall,
  ".": Tile.Floor,
  ">": Tile.StairsDown,
  "+": Tile.Door,
  "%": Tile.Rubble,
  "=": Tile.Airlock,
  "|": Tile.Bulkhead,
  "<": Tile.AirlockOut,
};

export function vaultSize(v: Vault): { w: number; h: number } {
  return { w: Math.max(...v.rows.map((r) => r.length)), h: v.rows.length };
}

/**
 * Try to stamp `vault` somewhere it fits. A spot fits when every non-wildcard
 * cell currently sits on solid rock or on floor the vault also declares floor —
 * so a vault can be embedded into open cave, but never straddles a corridor it
 * would cut in half.
 */
export function tryPlaceVault(
  tiles: Grid<Tile>,
  vault: Vault,
  rng: Rng,
  attempts = 60,
): PlacedVault | undefined {
  const { w, h } = vaultSize(vault);
  if (w + 2 > tiles.width || h + 2 > tiles.height) return undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const ox = rng.int(1, tiles.width - w - 1);
    const oy = rng.int(1, tiles.height - h - 1);
    if (!fits(tiles, vault, ox, oy)) continue;
    return stampVault(tiles, vault, ox, oy);
  }
  return undefined;
}

function fits(tiles: Grid<Tile>, vault: Vault, ox: number, oy: number): boolean {
  const { w, h } = vaultSize(vault);
  // Require a one-tile margin of rock or wall around the footprint, so vaults
  // never fuse into each other.
  for (let y = -1; y <= h; y++) {
    for (let x = -1; x <= w; x++) {
      const tx = ox + x;
      const ty = oy + y;
      if (!tiles.inBounds(tx, ty)) return false;
      const inside = x >= 0 && y >= 0 && x < w && y < h;
      const ch = inside ? (vault.rows[y]?.[x] ?? "?") : "#";
      if (ch === "?") continue;
      const existing = tiles.at(tx, ty);
      // A marker always ends up on floor; a tile char is judged by its own def,
      // so a bulkhead is treated as solid rather than as "not a wall char".
      const declared = TILE_CHARS[ch];
      const wantsFloor = declared === undefined || TILES[declared].walkable;
      const hasFloor = TILES[existing].walkable;
      // Solid rock accepts anything; existing floor only accepts floor.
      if (hasFloor && !wantsFloor) return false;
    }
  }
  return true;
}

/**
 * Write the vault onto the grid at `ox,oy`, unconditionally. Callers decide
 * whether the spot is legal; `tryPlaceVault` and the zone placer each have
 * their own rule for that.
 */
export function stampVault(tiles: Grid<Tile>, vault: Vault, ox: number, oy: number): PlacedVault {
  const { w, h } = vaultSize(vault);
  const marks: Array<{ ch: string; pos: Point }> = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = vault.rows[y]?.[x] ?? "?";
      if (ch === "?") continue;
      const tx = ox + x;
      const ty = oy + y;
      if (tx <= 0 || ty <= 0 || tx >= tiles.width - 1 || ty >= tiles.height - 1) continue;

      const tile = TILE_CHARS[ch];
      if (tile !== undefined) {
        tiles.set(tx, ty, tile);
        continue;
      }
      tiles.set(tx, ty, Tile.Floor);
      marks.push({ ch, pos: { x: tx, y: ty } });
    }
  }

  return { vault, origin: { x: ox, y: oy }, marks };
}

/**
 * Place a weighted selection of vaults eligible for this depth.
 *
 * `ctx` carries the run state a storylet may test. There are no zones on a
 * plain dungeon map, so a vault that names `zones` is skipped here — it belongs
 * to a zone-graph level and `placeVaultsInZones` is where it gets its chance.
 */
export function placeVaults(
  tiles: Grid<Tile>,
  library: readonly Vault[],
  depth: number,
  rng: Rng,
  count: number,
  ctx: VaultContext = { depth, flags: NO_VAULT_STATE },
): PlacedVault[] {
  const eligible = library.filter((v) => vaultEligible(v, { ...ctx, depth }));
  if (eligible.length === 0) return [];

  const placed: PlacedVault[] = [];
  const used = new Map<string, number>();

  for (let i = 0; i < count; i++) {
    const table: Record<string, number> = {};
    for (const v of eligible) {
      const limit = v.maxPerLevel ?? 1;
      if ((used.get(v.name) ?? 0) >= limit) continue;
      const w = vaultWeight(v, { ...ctx, depth });
      if (w > 0) table[v.name] = w;
    }
    if (Object.keys(table).length === 0) break;

    const name = rng.weighted(table);
    const vault = eligible.find((v) => v.name === name)!;
    const result = tryPlaceVault(tiles, vault, rng);
    if (!result) continue;
    placed.push(result);
    used.set(vault.name, (used.get(vault.name) ?? 0) + 1);
  }
  return placed;
}

/** Flags raised by a batch of placements, deduplicated, in placement order. */
export function collectVaultFlags(placed: readonly PlacedVault[]): string[] {
  const out: string[] = [];
  for (const p of placed) {
    for (const f of p.vault.sets ?? []) {
      if (!out.includes(f)) out.push(f);
    }
  }
  return out;
}
