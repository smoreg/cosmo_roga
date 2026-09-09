import type { Grid, Point } from "../grid.js";
import { Tile, type RoomRect } from "../level.js";
import type { Rng } from "../rng.js";
import { connectRegionsInRect } from "./regions.js";
import {
  collectVaultFlags,
  stampVault,
  vaultEligible,
  vaultSize,
  vaultWeight,
  type PlacedVault,
  type Vault,
  type VaultContext,
} from "./vaults.js";

/**
 * Storylets: hand-drawn compartments stamped into the sector the plan says they
 * belong in, chosen by what the run has already done to the player.
 *
 * The engine stays ignorant of the content. It only asks three questions a
 * vault answers itself — may it appear in this kind of zone, does `when` admit
 * the current state, and how much does `weightWhen` want it — and reports back
 * which flags the placed cards raised.
 *
 * Placement is deliberately narrower than `placeVaults`: a storylet lives one
 * tile inside its zone's frame, so it can never sit on an airlock or fuse two
 * sectors into one. Everything the stamp cuts off is reattached inside the
 * sector afterwards, so a card is never an island.
 */

/** What the placer needs to know about a sector. Compatible with `Zone`. */
export interface VaultZone {
  id: number;
  /** Content-defined kind, matched against a vault's `zones`. */
  kind: string;
  /** Zone bounds, wall ring included. Stamping stays one tile inside it. */
  rect: RoomRect;
  /** Carve-able area, where connectivity is repaired. Defaults to `rect`. */
  floor?: RoomRect;
}

export interface ZoneVaultPlacement {
  vaults: PlacedVault[];
  /** Union of the `sets` of everything placed, in placement order. */
  flagsSet: string[];
}

/** Position attempts per vault before giving up on it for this slot. */
const STAMP_ATTEMPTS = 40;

/**
 * Stamp up to `perZone` eligible vaults into every zone.
 *
 * Zones are walked in order and each gets its own rng stream, so adding a card
 * to the library never reshuffles the deck a different seed would have built.
 */
export function placeVaultsInZones(
  tiles: Grid<Tile>,
  zones: readonly VaultZone[],
  library: readonly Vault[],
  ctx: VaultContext,
  rng: Rng,
  perZone: number,
): ZoneVaultPlacement {
  const placed: PlacedVault[] = [];
  if (library.length === 0 || perZone <= 0) return { vaults: placed, flagsSet: [] };

  const used = new Map<string, number>();

  for (const zone of zones) {
    const area = inset(zone.rect, 1);
    if (area.x2 < area.x1 || area.y2 < area.y1) continue;

    const zoneRng = rng.fork(zone.id * 7919 + 13);
    const taken: RoomRect[] = [];
    let stamped = 0;

    for (let slot = 0; slot < perZone; slot++) {
      const table: Record<string, number> = {};
      for (const v of library) {
        if (!vaultEligible(v, ctx, zone.kind)) continue;
        if ((used.get(v.name) ?? 0) >= (v.maxPerLevel ?? 1)) continue;
        const { w, h } = vaultSize(v);
        if (w > area.x2 - area.x1 + 1 || h > area.y2 - area.y1 + 1) continue;
        const weight = vaultWeight(v, ctx);
        if (weight > 0) table[v.name] = weight;
      }

      // Retry with the rest of the table when a card does not fit anywhere:
      // one oversized vault must not eat the zone's whole budget.
      let done = false;
      while (!done && Object.keys(table).length > 0) {
        const name = zoneRng.weighted(table);
        delete table[name];
        const vault = library.find((v) => v.name === name)!;
        const result = tryStampInZone(tiles, vault, area, taken, zoneRng);
        if (!result) continue;
        result.zoneId = zone.id;
        placed.push(result);
        used.set(vault.name, (used.get(vault.name) ?? 0) + 1);
        const { w, h } = vaultSize(vault);
        taken.push({ x1: result.origin.x, y1: result.origin.y, x2: result.origin.x + w - 1, y2: result.origin.y + h - 1 });
        stamped++;
        done = true;
      }
      if (!done) break;
    }

    // A stamped card overwrites carved floor with its own walls, so the sector
    // may have fallen apart. Repair inside the sector only.
    if (stamped > 0) connectRegionsInRect(tiles, zone.floor ?? zone.rect);
  }

  return { vaults: placed, flagsSet: collectVaultFlags(placed) };
}

/**
 * Find a spot for `vault` fully inside `area`, clear of the tiles that already
 * carry structural meaning and of everything stamped before it.
 *
 * Unlike `tryPlaceVault` this happily overwrites carved floor: a closet cut
 * into a hab block is the point, and the sector is reconnected afterwards.
 */
function tryStampInZone(
  tiles: Grid<Tile>,
  vault: Vault,
  area: RoomRect,
  taken: readonly RoomRect[],
  rng: Rng,
): PlacedVault | undefined {
  const { w, h } = vaultSize(vault);
  const maxX = area.x2 - w + 1;
  const maxY = area.y2 - h + 1;
  if (maxX < area.x1 || maxY < area.y1) return undefined;

  for (let attempt = 0; attempt < STAMP_ATTEMPTS; attempt++) {
    const ox = rng.int(area.x1, maxX);
    const oy = rng.int(area.y1, maxY);
    if (!fitsInZone(tiles, vault, ox, oy, taken)) continue;
    return stampVault(tiles, vault, ox, oy);
  }
  return undefined;
}

function fitsInZone(
  tiles: Grid<Tile>,
  vault: Vault,
  ox: number,
  oy: number,
  taken: readonly RoomRect[],
): boolean {
  const { w, h } = vaultSize(vault);
  // One tile of slack around the footprint keeps two cards from fusing into a
  // single unreadable blob.
  const halo: RoomRect = { x1: ox - 1, y1: oy - 1, x2: ox + w, y2: oy + h };
  for (const t of taken) {
    if (overlaps(halo, t)) return false;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = vault.rows[y]?.[x] ?? "?";
      if (ch === "?") continue;
      const cur = tiles.at(ox + x, oy + y);
      // Airlocks and bulkheads are the map's structure, not its decoration.
      if (cur === Tile.Airlock || cur === Tile.Bulkhead) return false;
    }
  }
  return true;
}

function overlaps(a: RoomRect, b: RoomRect): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}

function inset(r: RoomRect, by: number): RoomRect {
  return { x1: r.x1 + by, y1: r.y1 + by, x2: r.x2 - by, y2: r.y2 - by };
}

/** Every tile a placed vault wrote, for tests and for content that needs it. */
export function vaultFootprint(p: PlacedVault): Point[] {
  const { w, h } = vaultSize(p.vault);
  const out: Point[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((p.vault.rows[y]?.[x] ?? "?") === "?") continue;
      out.push({ x: p.origin.x + x, y: p.origin.y + y });
    }
  }
  return out;
}
