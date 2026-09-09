/**
 * Pointy-top hex geometry for the hull-form sandbox.
 *
 * Copied, not imported, from `packages/engine/src/rooms/gen/hexlayout.ts`: this
 * folder is a sandbox and must not depend on the engine (and the engine must
 * never learn about it). Axial `q, r`, six neighbours, two vertical edges east
 * and west — the same lattice the game draws its deck plans on.
 *
 * One deliberate difference: the engine spreads its hexagons apart by
 * `HEX_SPACING = 1.34` so a door has a corridor to be drawn in. Here the
 * hexagons touch, because the whole point is that the compartments tile the
 * hull and the silhouette is read off their outer edge. A door is a gap in a
 * shared wall instead of a segment of corridor.
 */

/**
 * How far apart the game's honeycomb puts two neighbours, as a multiple of
 * touching: the difference is the corridor. Copied from the engine, and used
 * only by the drawing that lays the game's own map over a picture.
 */
export const HEX_SPACING = 1.34;

/** The six neighbours of a pointy-top hexagon, in a fixed order. */
export const HEX_DIRS = [
  { q: 1, r: 0 }, // east
  { q: 1, r: -1 }, // north-east
  { q: 0, r: 1 }, // south-east
  { q: 0, r: -1 }, // north-west
  { q: -1, r: 1 }, // south-west
  { q: -1, r: 0 }, // west
];

export function hexKey(cell) {
  return `${cell.q},${cell.r}`;
}

export function hexAround(cell) {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

export function hexAdjacent(a, b) {
  return HEX_DIRS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
}

/**
 * ASCII row/column to axial, "odd-r" offset: odd rows sit half a cell to the
 * east. That is exactly how the masks are typed — every odd line is indented by
 * one space — so what is drawn in the source is what the lattice holds.
 */
export function offsetToAxial(row, col) {
  return { q: col - ((row - (row & 1)) >> 1), r: row };
}

/** Centre of a hexagon, in units of the hex radius. */
export function hexCentre(cell) {
  return {
    x: Math.sqrt(3) * (cell.q + cell.r / 2),
    y: 1.5 * cell.r,
  };
}

/** The six corners of a hexagon, in units of the hex radius. */
export function hexCorners(cell) {
  const c = hexCentre(cell);
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i + 30) * Math.PI) / 180;
    out.push({ x: c.x + Math.cos(a), y: c.y + Math.sin(a) });
  }
  return out;
}

/**
 * Which of the six corner-to-corner edges faces neighbour `dir`.
 *
 * Worked out numerically rather than written down as a table: the edge whose
 * midpoint points the same way as the neighbour's centre. Six comparisons at
 * module load beat one off-by-one in a hand-made lookup.
 */
export const EDGE_OF_DIR = HEX_DIRS.map((d) => {
  const target = hexCentre(d);
  const corners = hexCorners({ q: 0, r: 0 });
  let best = 0;
  let bestDot = -Infinity;
  for (let j = 0; j < 6; j++) {
    const a = corners[j];
    const b = corners[(j + 1) % 6];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dot = mid.x * target.x + mid.y * target.y;
    if (dot > bestDot) {
      bestDot = dot;
      best = j;
    }
  }
  return best;
});

/** The shared wall between a cell and its neighbour in direction `dirIndex`. */
export function edgeSegment(cell, dirIndex) {
  const corners = hexCorners(cell);
  const j = EDGE_OF_DIR[dirIndex];
  return [corners[j], corners[(j + 1) % 6]];
}

/** Deterministic 32-bit PRNG. No `Math.random` anywhere in this sandbox. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
