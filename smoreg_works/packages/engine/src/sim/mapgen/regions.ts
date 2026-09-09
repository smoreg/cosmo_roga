import { DIRS4, type Point } from "../grid.js";
import { Tile, TILES, type RoomRect } from "../level.js";
import type { Grid } from "../grid.js";

/**
 * Connectivity work confined to a rectangle.
 *
 * The global `connectRegions` in postprocess.ts tunnels wherever it likes,
 * which is exactly wrong on a map whose whole point is that sectors touch only
 * through their airlocks. Everything here digs inside the rect it is given and
 * nowhere else, so a sector's frame survives the repair.
 */

export function inRect(r: RoomRect, p: Point): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
}

/** Walkable components inside `rect`, 4-connected, ignoring everything outside. */
export function regionsInRect(tiles: Grid<Tile>, rect: RoomRect): Point[][] {
  const seen = new Set<number>();
  const regions: Point[][] = [];
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      const k = y * tiles.width + x;
      if (seen.has(k) || !TILES[tiles.at(x, y)].walkable) continue;
      const region: Point[] = [];
      const queue: Point[] = [{ x, y }];
      seen.add(k);
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++]!;
        region.push(cur);
        for (const d of DIRS4) {
          const nx = cur.x + d.x;
          const ny = cur.y + d.y;
          if (nx < rect.x1 || nx > rect.x2 || ny < rect.y1 || ny > rect.y2) continue;
          const nk = ny * tiles.width + nx;
          if (seen.has(nk) || !TILES[tiles.at(nx, ny)].walkable) continue;
          seen.add(nk);
          queue.push({ x: nx, y: ny });
        }
      }
      regions.push(region);
    }
  }
  return regions;
}

/**
 * Join every walkable island inside `rect` to the largest one. Digging is
 * confined to the rect, which is what keeps a sector's frame intact — the
 * global `connectRegions` would happily tunnel through it.
 */
export function connectRegionsInRect(tiles: Grid<Tile>, rect: RoomRect): void {
  let regions = regionsInRect(tiles, rect);
  let guard = 0;
  while (regions.length > 1 && guard++ < 80) {
    regions.sort((a, b) => a.length - b.length);
    if (!tunnelToFloor(tiles, rect, regions[0]!)) break;
    regions = regionsInRect(tiles, rect);
  }
}

/**
 * Shortest tunnel from `sources` to any other walkable tile inside `rect`,
 * carved through the walls in between. Returns false when there is nothing to
 * reach.
 */
export function tunnelToFloor(tiles: Grid<Tile>, rect: RoomRect, sources: Point | Point[]): boolean {
  const seeds = Array.isArray(sources) ? sources : [sources];
  if (seeds.length === 0) return false;
  const w = tiles.width;
  const prev = new Map<number, number>();
  const queue: Point[] = [];
  for (const s of seeds) {
    prev.set(s.y * w + s.x, -1);
    queue.push(s);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    for (const d of DIRS4) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < rect.x1 || nx > rect.x2 || ny < rect.y1 || ny > rect.y2) continue;
      const nk = ny * w + nx;
      if (prev.has(nk)) continue;
      prev.set(nk, cur.y * w + cur.x);
      if (TILES[tiles.at(nx, ny)].walkable) {
        // Carve the wall run we came through; endpoints are already walkable.
        let back = prev.get(nk)!;
        while (back >= 0) {
          const bx = back % w;
          const by = (back - bx) / w;
          if (!TILES[tiles.at(bx, by)].walkable) tiles.set(bx, by, Tile.Floor);
          back = prev.get(back)!;
        }
        return true;
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}
