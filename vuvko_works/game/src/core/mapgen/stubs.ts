import { PX_FT, isArchitecture } from "./types";
import type { HullPlan, InkMask, Regions, Stub } from "./types";

/**
 * Where the geomorph system says two tiles join.
 *
 * Every tile edge carries its connections at the quarter points, so a shared
 * edge of 100 ft has two and one of 50 ft has one. That is a rule about the
 * tiles rather than a guess from the artwork, and it is what makes a plan
 * walkable: lay two geomorphs side by side and there are two ways between them.
 *
 * Each stub becomes a room-to-room connection by stepping a few feet either
 * side of the boundary and asking which compartment answers.
 */
export function findStubs(
  plan: HullPlan,
  mask: InkMask,
  regions: Regions,
  zoneOf: ReadonlyMap<number, number>,
): Stub[] {
  const tiles = plan.put.filter(isArchitecture);

  function zoneAt(x: number, y: number): number | undefined {
    const px = Math.round(x * PX_FT);
    const py = Math.round(y * PX_FT);
    if (px < 0 || py < 0 || px >= mask.w || py >= mask.h) return undefined;
    return zoneOf.get(regions.reg[py * mask.w + px] ?? -1);
  }

  /* The stub is a gap in the wall; step off it until a room answers. */
  function probe(x: number, y: number, dx: number, dy: number): number | undefined {
    for (const distance of [3, 6, 9, 12, 15]) {
      const zone = zoneAt(x + dx * distance, y + dy * distance);
      if (zone !== undefined) return zone;
    }
    return undefined;
  }

  const out: Stub[] = [];
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i];
      const b = tiles[j];
      if (a === undefined || b === undefined) continue;

      const vertical = a.x + a.w === b.x || b.x + b.w === a.x;
      const horizontal = a.y + a.h === b.y || b.y + b.h === a.y;
      let from: number;
      let to: number;
      let at: number;
      let dx: number;
      let dy: number;

      if (vertical) {
        from = Math.max(a.y, b.y);
        to = Math.min(a.y + a.h, b.y + b.h);
        if (to - from < 50) continue;
        at = a.x + a.w === b.x ? b.x : a.x;
        dx = 1;
        dy = 0;
      } else if (horizontal) {
        from = Math.max(a.x, b.x);
        to = Math.min(a.x + a.w, b.x + b.w);
        if (to - from < 50) continue;
        at = a.y + a.h === b.y ? b.y : a.y;
        dx = 0;
        dy = 1;
      } else {
        continue;
      }

      /* One connection per 50 ft of shared edge, at its middle — and if the
         middle lands in a bulkhead, a few feet either way before giving up. A
         join that finds no room on one side is a tank or an empty wing, and
         there is nothing there to open. */
      for (let t = from; t + 50 <= to; t += 50) {
        for (const offset of [25, 20, 30, 15, 35]) {
          const middle = t + offset;
          const x = vertical ? at : middle;
          const y = vertical ? middle : at;
          const za = probe(x, y, -dx, -dy);
          const zb = probe(x, y, dx, dy);
          if (za === undefined || zb === undefined || za === zb) continue;
          out.push({ a: za, b: zb, x, y });
          break;
        }
      }
    }
  }
  return out;
}
