import { Grid, DIRS4, DIRS8, type Point } from "../grid.js";
import { Tile, TILES, isAirlock, type RoomRect } from "../level.js";
import type { Rng } from "../rng.js";

export interface Region {
  tiles: Point[];
  /** Any tile of the region, for pathing between regions. */
  seed: Point;
}

/** Connected components of walkable tiles (4-connectivity). */
export function findRegions(tiles: Grid<Tile>): Region[] {
  const seen = new Grid<boolean>(tiles.width, tiles.height, false);
  const regions: Region[] = [];

  tiles.forEach((x, y, t) => {
    if (!TILES[t].walkable || seen.at(x, y)) return;
    const region: Point[] = [];
    const queue: Point[] = [{ x, y }];
    seen.set(x, y, true);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++]!;
      region.push(cur);
      for (const d of DIRS4) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (!tiles.inBounds(nx, ny) || seen.at(nx, ny)) continue;
        if (!TILES[tiles.at(nx, ny)].walkable) continue;
        seen.set(nx, ny, true);
        queue.push({ x: nx, y: ny });
      }
    }
    regions.push({ tiles: region, seed: { x, y } });
  });

  return regions;
}

/**
 * Join every walkable region into one by tunnelling between the closest pairs.
 * Cellular and drunkard-walk generators routinely produce islands; shipping one
 * means shipping a level the player can be stranded on.
 */
export function connectRegions(tiles: Grid<Tile>, rng: Rng): void {
  let regions = findRegions(tiles);
  let guard = 0;
  while (regions.length > 1 && guard++ < 200) {
    // Always attach the smallest region to its nearest neighbour: keeps the
    // resulting corridors short and the main cave shape intact.
    regions.sort((a, b) => a.tiles.length - b.tiles.length);
    const small = regions[0]!;
    let best: { from: Point; to: Point; d: number } | undefined;

    for (let i = 1; i < regions.length; i++) {
      for (const a of sample(small.tiles, 40, rng)) {
        for (const b of sample(regions[i]!.tiles, 40, rng)) {
          const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          if (!best || d < best.d) best = { from: a, to: b, d };
        }
      }
    }
    if (!best) break;
    carveCorridor(tiles, best.from, best.to);
    regions = findRegions(tiles);
  }
}

/** L-shaped tunnel; the corner order is picked by coordinates, not chance. */
export function carveCorridor(tiles: Grid<Tile>, from: Point, to: Point): void {
  let x = from.x;
  let y = from.y;
  const horizontalFirst = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);

  const stepTo = (tx: number, ty: number) => {
    while (x !== tx) {
      x += Math.sign(tx - x);
      dig(tiles, x, y);
    }
    while (y !== ty) {
      y += Math.sign(ty - y);
      dig(tiles, x, y);
    }
  };

  dig(tiles, x, y);
  if (horizontalFirst) stepTo(to.x, to.y);
  else {
    while (y !== to.y) {
      y += Math.sign(to.y - y);
      dig(tiles, x, y);
    }
    stepTo(to.x, to.y);
  }
}

function dig(tiles: Grid<Tile>, x: number, y: number): void {
  // Never dig the outer border: an opening there lets the player walk off-map.
  if (x <= 0 || y <= 0 || x >= tiles.width - 1 || y >= tiles.height - 1) return;
  if (!TILES[tiles.at(x, y)].walkable) tiles.set(x, y, Tile.Floor);
}

/**
 * Fill in corridor dead ends. A maze full of one-tile stubs reads as noise and
 * wastes the player's turns; removing them makes the same layout feel designed.
 * `keep` leaves that many stubs alive, which is where secrets can go.
 */
export function removeDeadEnds(tiles: Grid<Tile>, maxPasses = 20, keep = 0): number {
  let removed = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const ends: Point[] = [];
    tiles.forEach((x, y, t) => {
      if (!TILES[t].walkable) return;
      let exits = 0;
      for (const d of DIRS4) {
        const n = tiles.get(x + d.x, y + d.y);
        if (n !== undefined && TILES[n].walkable) exits++;
      }
      if (exits <= 1) ends.push({ x, y });
    });
    if (ends.length <= keep) return removed;
    for (const e of ends.slice(0, ends.length - keep)) {
      tiles.set(e.x, e.y, Tile.Wall);
      removed++;
    }
  }
  return removed;
}

/**
 * `removeDeadEnds` confined to a rectangle: a tile's exits are counted inside
 * `rect` only, so the frame around it is neither read nor written. Sector
 * interiors are trimmed with this before the airlocks are cut — the global
 * version would count a neighbouring sector's floor as an exit and leave the
 * stub standing.
 *
 * Trimming never splits what is left: a tile with one exit is a leaf of its
 * region, so removing it, and then whatever became a leaf in turn, eats an
 * appendage from the tip and stops at the first junction.
 */
export function removeDeadEndsInRect(tiles: Grid<Tile>, rect: RoomRect, maxPasses = 20): number {
  let removed = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const ends: Point[] = [];
    for (let y = rect.y1; y <= rect.y2; y++) {
      for (let x = rect.x1; x <= rect.x2; x++) {
        if (!TILES[tiles.at(x, y)].walkable) continue;
        let exits = 0;
        for (const d of DIRS4) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (nx < rect.x1 || nx > rect.x2 || ny < rect.y1 || ny > rect.y2) continue;
          if (TILES[tiles.at(nx, ny)].walkable) exits++;
        }
        if (exits <= 1) ends.push({ x, y });
      }
    }
    if (ends.length === 0) return removed;
    for (const e of ends) {
      tiles.set(e.x, e.y, Tile.Wall);
      removed++;
    }
  }
  return removed;
}

/** Wall off every walkable tile not reachable from `origin`. */
export function sealUnreachable(tiles: Grid<Tile>, origin: Point): number {
  const regions = findRegions(tiles);
  const home = regions.find((r) => r.tiles.some((t) => t.x === origin.x && t.y === origin.y));
  if (!home) return 0;
  const keep = new Set(home.tiles.map((t) => `${t.x},${t.y}`));
  let sealed = 0;
  tiles.forEach((x, y, t) => {
    if (TILES[t].walkable && !keep.has(`${x},${y}`)) {
      tiles.set(x, y, Tile.Wall);
      sealed++;
    }
  });
  return sealed;
}

/** Force a solid one-tile wall border. Cheap insurance against off-map walks. */
export function enforceBorder(tiles: Grid<Tile>): void {
  for (let x = 0; x < tiles.width; x++) {
    tiles.set(x, 0, Tile.Wall);
    tiles.set(x, tiles.height - 1, Tile.Wall);
  }
  for (let y = 0; y < tiles.height; y++) {
    tiles.set(0, y, Tile.Wall);
    tiles.set(tiles.width - 1, y, Tile.Wall);
  }
}

/**
 * Put doors in the mouth of a passage — the tile where it meets a wider space —
 * and never in the middle of one. A door halfway down a corridor reads as a
 * random obstacle; the same door on a room's threshold reads as the room's.
 */
export function placeDoors(tiles: Grid<Tile>, rng: Rng, chance = 0.35): number {
  let placed = 0;
  const candidates: Point[] = [];
  tiles.forEach((x, y, t) => {
    // Only plain floor becomes a door: airlocks and bulkheads are structure.
    if (t !== Tile.Floor) return;
    if (!isPassage(tiles, x, y)) return;
    // A mouth has open ground on at least one end: the neighbour along the
    // passage is walkable and is not another slice of the same corridor.
    const pinchedSideways = isWall(tiles, x - 1, y) && isWall(tiles, x + 1, y);
    const along: Point[] = pinchedSideways
      ? [{ x, y: y - 1 }, { x, y: y + 1 }]
      : [{ x: x - 1, y }, { x: x + 1, y }];
    const opensUp = along.some((n) => {
      const nt = tiles.get(n.x, n.y);
      return nt !== undefined && TILES[nt].walkable && !isPassage(tiles, n.x, n.y);
    });
    if (opensUp) candidates.push({ x, y });
  });
  for (const c of candidates) {
    if (!rng.chance(chance)) continue;
    // Do not create adjacent doors: two in a row reads as a bug. An airlock is
    // a passage too, so a door beside one reads the same way.
    const nearPassage = DIRS8.some((d) => {
      const n = tiles.get(c.x + d.x, c.y + d.y);
      return n === Tile.Door || (n !== undefined && isAirlock(n));
    });
    if (nearPassage) continue;
    tiles.set(c.x, c.y, Tile.Door);
    placed++;
  }
  return placed;
}

/** Walkable and pinched between walls on exactly one axis: a corridor slice. */
function isPassage(tiles: Grid<Tile>, x: number, y: number): boolean {
  const t = tiles.get(x, y);
  if (t === undefined || !TILES[t].walkable) return false;
  const horiz = isWall(tiles, x - 1, y) && isWall(tiles, x + 1, y);
  const vert = isWall(tiles, x, y - 1) && isWall(tiles, x, y + 1);
  return horiz !== vert;
}

function isWall(tiles: Grid<Tile>, x: number, y: number): boolean {
  const t = tiles.get(x, y);
  return t === undefined || !TILES[t].walkable;
}

function sample<T>(arr: readonly T[], n: number, rng: Rng): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[rng.int(0, arr.length - 1)]!);
  return out;
}
