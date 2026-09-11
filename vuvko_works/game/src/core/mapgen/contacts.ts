import { MAX_WALL_FT, PX_FT } from "./types";
import type { Contact, InkMask, Regions } from "./types";

interface Crossing {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

interface Pairing {
  readonly a: number;
  readonly b: number;
  readonly points: Crossing[];
}

/** A doorway is wider than this, so crossings this close are one run. */
const RUN_GRID = 4;

/**
 * Where two rooms are separated by one drawn wall and not by the hull.
 *
 * Walk the structure and look across it: a short crossing with a different
 * room on each side is somewhere a door can be. The thickness cutoff is what
 * keeps the hull — plating, tanks, the space between two hulls — from becoming
 * a doorway.
 */
export function findContacts(mask: InkMask, regions: Regions): Contact[] {
  const { w, h, ink } = mask;
  const { reg } = regions;
  const maxWall = Math.max(2, Math.round(MAX_WALL_FT * PX_FT));
  const found = new Map<string, Pairing>();

  function note(a: number, b: number, crossing: Crossing): void {
    if (a === b) return;
    const key = a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;
    let pairing = found.get(key);
    if (pairing === undefined) {
      pairing = { a: Math.min(a, b), b: Math.max(a, b), points: [] };
      found.set(key, pairing);
    }
    pairing.points.push(crossing);
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const index = y * w + x;
      if (ink[index] === 0) continue;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        let depth = 1;
        while (depth <= maxWall && ink[index + dy * depth * w + dx * depth] === 1) depth++;
        if (depth > maxWall) continue;
        const back = reg[index - dy * w - dx] ?? -1;
        const forward = reg[index + dy * depth * w + dx * depth] ?? -1;
        if (back > 1 && forward > 1) note(back, forward, { x, y, dx, dy });
      }
    }
  }

  const out: Contact[] = [];
  for (const pairing of found.values()) out.push(...splitRuns(pairing));
  return out;
}

/**
 * Two rooms can touch in more than one place — either side of a hall, or
 * around a corner — and averaging those together puts the door in the wall
 * between them, or inside a third room. Each run of touching wall is its own
 * candidate, so a pair with two ways between gets two.
 */
function splitRuns(pairing: Pairing): Contact[] {
  const buckets = new Map<string, Crossing[]>();
  for (const point of pairing.points) {
    const key = `${String(Math.floor(point.x / RUN_GRID))},${String(Math.floor(point.y / RUN_GRID))}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [point]);
    else bucket.push(point);
  }

  const seen = new Set<string>();
  const runs: Contact[] = [];
  for (const key of buckets.keys()) {
    if (seen.has(key)) continue;
    const points: Crossing[] = [];
    const pending = [key];
    seen.add(key);
    while (pending.length > 0) {
      const at = pending.pop();
      if (at === undefined) break;
      points.push(...(buckets.get(at) ?? []));
      const parts = at.split(",");
      const bx = Number(parts[0]);
      const by = Number(parts[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbour = `${String(bx + dx)},${String(by + dy)}`;
          if (buckets.has(neighbour) && !seen.has(neighbour)) {
            seen.add(neighbour);
            pending.push(neighbour);
          }
        }
      }
    }
    let sx = 0;
    let sy = 0;
    for (const point of points) {
      sx += point.x;
      sy += point.y;
    }
    runs.push({
      a: pairing.a,
      b: pairing.b,
      n: points.length,
      x: sx / points.length,
      y: sy / points.length,
    });
  }
  return runs;
}
