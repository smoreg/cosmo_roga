import { hexKey, type HexCell } from "@jamrog/engine";

/**
 * Hull shapes, built out of hexagons: the ship first, the deck inside it.
 *
 * The owner's third word on the honeycomb view (`docs/tasks/G82-hull-first-layout.md`):
 * «может будем генерить более симметричные корпуса хексами, а поверх корабль?»
 * So a hull here is not a polygon a honeycomb is dropped into — it is a
 * honeycomb of its own: a keel of cells along the axis, and to either side of
 * it the same rows, mirrored, in sections that widen and narrow from stern to
 * bow. What the deck is laid out inside (`hexLayout`, its mask) is exactly
 * this set of cells, and what the ship is drawn from (`ui/web/hullart.ts`) is
 * the same set, its border straightened along the sections — so the sides
 * come out straight because the sections are straight, not because a ragged
 * outline was smoothed, and nothing on the drawing can lie outside the cells
 * it was built from.
 *
 * A class of derelict says what proportions its hull has (`SHAPES`): a needle
 * is a long keel with a slight bulge, a barge train is boxes on a coupling,
 * a ring station a drum with a hole through it, a catamaran two keels and a
 * cross-piece. Those are the sandbox's twenty profiles said in cells rather
 * than in coordinates (`experiments/hullforms/shipform.mjs`). The size the
 * hull is built at follows the ship: as thick as its own deck is across,
 * long enough to hold its compartments with room to turn in (`hulls-art.ts`).
 *
 * All data and pure functions. No DOM, no `Math.random()`: the one variation
 * is a small deterministic jitter of the section lengths and the nose,
 * seeded by the caller from the ship's own store id, so a hull is the same
 * hull on every frame and after every load. `tests/purity.test.ts` scans this
 * directory for the rest.
 *
 * ## Units and symmetry
 *
 * Cells are the engine's: pointy-top, axial `q, r`, centre at
 * `(√3 (q + r/2), 1.5 r)` tiling radii, which is exactly what `hex-svg.ts`
 * draws at (`tests/hullart.test.ts` holds the two to each other). The keel is
 * row zero; a cell `(q, r)` mirrors across it to `(q + r, −r)`, the same
 * column at the same distance below — so every hull built here is symmetric
 * about its axis by construction, and the test says so. Polygons are in
 * tiling radii too, the stern plate at `x = 0` and the ship pointing east.
 */

export interface Point {
  x: number;
  y: number;
}

/** A closed polygon, first point not repeated at the end. */
export type Polygon = Point[];

/**
 * One section of a hull body, stern to bow: how much of the keel it takes,
 * and how many rows it stands above and below the body's own centreline, as
 * shares of the hull's size. A half-height share of one is the thickest the
 * deck asks for; zero is the keel row alone.
 */
export type SectionSpec = readonly [lengthShare: number, halfShare: number];

/** One body of a hull: sections along the keel, and where it sits off the axis. */
export interface BodySpec {
  /** Rows off the axis, as a share of the hull's half-height. Mirrored bodies come in pairs. */
  readonly dy?: number;
  /** Where along the keel it starts, as a share of the length. Zero is the stern plate. */
  readonly from?: number;
  readonly sections: readonly SectionSpec[];
  /** Ends on a flat face instead of a point. */
  readonly blunt?: boolean;
}

/**
 * A class of hull, in proportions. `bodies` come in mirror pairs or sit on
 * the axis; `holes` are cut out of the union. Sizes are shares, so the same
 * shape is a bigger ship at a bigger size, not a different ship.
 */
export interface ShapeSpec {
  readonly name: string;
  readonly bodies: readonly BodySpec[];
  readonly holes?: readonly BodySpec[];
  /** How far the point of the bow reaches past the last cell, in keel cells. */
  readonly nose: number;
}

/**
 * The shapes. The sandbox's rule holds: a silhouette lives on two or three
 * masses of different size, never on an interesting edge.
 */
export const SHAPES = {
  /** The freighter: a box, blunt both ends, a short chin at the bow. */
  boxcar: {
    name: "box freighter",
    nose: 0.5,
    bodies: [{ sections: [[0.16, 1], [0.6, 1], [0.24, 0.6]], blunt: true }],
  },
  /** The barge: a pusher box, a coupling, a barge behind. */
  bargetrain: {
    name: "barge train",
    nose: 0.6,
    bodies: [
      { sections: [[0.42, 1]], blunt: true },
      { from: 0.4, sections: [[0.2, 0.15]], blunt: true },
      { from: 0.58, sections: [[0.3, 0.9], [0.12, 0.45]] },
    ],
  },
  /** The ferry: a whale, fat amidships, tapering both ways. */
  whale: {
    name: "whaler",
    nose: 0.9,
    bodies: [{ sections: [[0.18, 0.7], [0.5, 1], [0.2, 0.7], [0.12, 0.3]] }],
  },
  /** The probe: a teardrop, the bulk forward of the stern, a long point. */
  teardrop: {
    name: "probe teardrop",
    nose: 1.3,
    bodies: [{ sections: [[0.2, 0.6], [0.45, 1], [0.25, 0.6], [0.1, 0.2]] }],
  },
  /** The tender: a dock — a long flat slab with a bay cut into its belly. */
  drydock: {
    name: "dock ladder",
    nose: 0.4,
    bodies: [{ sections: [[0.3, 1], [0.25, 0.55], [0.45, 1]], blunt: true }],
  },
  /** The laboratory: a spindle, both ends drawn to a point. */
  spindle: {
    name: "courier spindle",
    nose: 1.1,
    bodies: [{ sections: [[0.18, 0.5], [0.44, 1], [0.24, 0.6], [0.14, 0.2]] }],
  },
  /** The military hull: a wedge, widest at the stern, straight to the point. */
  dreadnought: {
    name: "wedge dreadnought",
    nose: 1.0,
    bodies: [{ sections: [[0.3, 1], [0.3, 0.75], [0.25, 0.45], [0.15, 0.2]] }],
  },
  /** The smuggler: a hammer — a wide head aft, a narrow shaft forward. */
  hammerboat: {
    name: "hammer boat",
    nose: 0.7,
    // The head takes more of the keel than the sandbox's did: the game's
    // compartments come as a compact deck that has to fit in the head, and a
    // short head is a long shaft, which is a wide ship and small hexagons.
    bodies: [{ sections: [[0.55, 1], [0.35, 0.35], [0.1, 0.2]] }],
  },
  /** The corsair: a harpoon — a head, a long shaft, the longest point. */
  harpoon: {
    name: "harpoon corvette",
    nose: 1.5,
    bodies: [{ sections: [[0.36, 1], [0.44, 0.4], [0.2, 0.2]] }],
  },
  /** The quarantine hull: a station — a drum with a hole through the middle. */
  ringstation: {
    name: "ring station",
    nose: 0.3,
    bodies: [{ sections: [[0.2, 0.6], [0.6, 1], [0.2, 0.6]], blunt: true }],
    holes: [{ from: 0.4, sections: [[0.2, 0.15]], blunt: true }],
  },
  /** The father's tug: the hammer again, its head taller than anything. */
  tug: {
    name: "hammer tug",
    nose: 0.7,
    bodies: [{ sections: [[0.45, 1], [0.15, 0.6], [0.4, 0.3]] }],
  },
  /** A scout needle: the keel with a slight bulge. Unused by the catalogue, kept for variety. */
  needle: {
    name: "scout needle",
    nose: 1.4,
    bodies: [{ sections: [[0.25, 0.4], [0.4, 0.7], [0.35, 0.2]] }],
  },
  /** Two keels and a cross-piece. Unused by the catalogue, kept for variety. */
  catamaran: {
    name: "catamaran",
    nose: 0.9,
    bodies: [
      { dy: 1, sections: [[0.25, 0.45], [0.5, 0.5], [0.25, 0.25]] },
      { dy: -1, sections: [[0.25, 0.45], [0.5, 0.5], [0.25, 0.25]] },
      { from: 0.35, sections: [[0.3, 1]], blunt: true },
    ],
  },
  /** A hull and a tall cross-piece. Unused by the catalogue, kept for variety. */
  cross: {
    name: "hospital cross",
    nose: 0.8,
    bodies: [
      { sections: [[0.3, 0.5], [0.4, 0.5], [0.3, 0.3]] },
      { from: 0.4, sections: [[0.2, 1]], blunt: true },
    ],
  },
} as const satisfies Record<string, ShapeSpec>;

export type HullFormId = keyof typeof SHAPES;

/** An engine pod off the stern plate: a rectangle, its bell hanging off `x`. */
export interface Pod {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One section of a body, resolved to cells: keel indices `[from, to)` and rows either side of `row`. */
export interface CellSection {
  from: number;
  to: number;
  half: number;
}

/** One body resolved to cells. */
export interface CellBody {
  /** The row its centreline runs along. */
  row: number;
  sections: CellSection[];
  blunt: boolean;
}

/** One hull: its cells, and the polygons drawn over them. */
export interface HullForm {
  readonly kind: HullFormId;
  readonly name: string;
  readonly seed: number;
  /** The keel length in cells the hull was built at. */
  readonly size: number;
  /** Rows either side of the axis at the thickest. */
  readonly half: number;
  /** Every cell of the hull, holes cut out, west to east and top to bottom. */
  readonly cells: readonly HexCell[];
  /** The first body: the hull proper, where the bridge goes. */
  readonly hull: Polygon;
  readonly bodies: readonly Polygon[];
  readonly holes: readonly Polygon[];
  readonly pods: readonly Pod[];
  /** Radius the polygons are in: always one — tiling radii. */
  readonly R: number;
  /** How far the bow reaches past the stern plate. */
  readonly length: number;
  readonly sternHalf: number;
  /** The widest half-height of any body. */
  readonly halfMax: number;
}

/** Column pitch of the lattice: centre to centre along a row, in radii. */
export const COL = Math.sqrt(3);

/**
 * One hull, built at a keel length of `size` cells and `half` rows either
 * side of the axis at the thickest. Deterministic from `(kind, seed)`: the
 * sections keep their proportions and the seed moves a boundary a cell one
 * way or the other and the nose a little, so two seeds of one class are two
 * ships of that class and not two different ships.
 */
export function shipForm(kind: HullFormId, seed: number, size: number, half: number): HullForm {
  const spec: ShapeSpec = SHAPES[kind];
  const rng = mulberry32(Math.imul(seed, 40503) >>> 0);
  const jitter = (): number => 0.9 + rng() * 0.2;

  // A body that starts part way along the keel starts no later than the
  // last one ended, so the cells of a train are one block and not three: a
  // coupling parted from its barge by a column is a deck the tree cannot
  // cross, and the layout would have to say the door in chips.
  const bodies: CellBody[] = [];
  for (const body of spec.bodies) {
    const end = Math.max(0, ...bodies.map((b) => b.sections[b.sections.length - 1]!.to));
    bodies.push(resolve(body, size, half, jitter, bodies.length === 0 ? undefined : end));
  }
  // A hole never takes the whole thickness: at least a row stays above it
  // and below, or the hull would fall into two blocks the deck cannot join.
  // A hull a single row thick has no room for a hole at all.
  const holes = half === 0 ? [] : (spec.holes ?? []).map((hole) => resolve(hole, size, half - 1, jitter, undefined));
  const nose = spec.nose * COL * jitter();

  const cells = cellsOf(bodies, holes);
  const polygons = bodies.map((body) => polygonOf(body, nose));
  const cuts = holes.map(holePolygonOf);
  const pods = bodies.flatMap((body, i) => (body.sections[0]!.from === 0 ? podsOf(polygons[i]!, rng) : []));

  const hull = polygons[0]!;
  const all = polygons.flat();
  return {
    kind,
    name: spec.name,
    seed,
    size,
    half,
    cells,
    hull,
    bodies: polygons,
    holes: cuts,
    pods,
    R: 1,
    length: Math.max(...all.map((p) => p.x)),
    sternHalf: Math.abs(hull[0]!.y),
    halfMax: Math.max(...all.map((p) => Math.abs(p.y))),
  };
}

/**
 * A body's sections in cells: lengths as shares of the keel, at least one
 * cell each; half-heights as shares of the hull's thickest, rounded, and a
 * section asked for any height at all keeps at least the keel row. The seed
 * nudges each length a tenth either way before rounding — a boundary a cell
 * to one side is what tells two ships of a class apart.
 */
function resolve(spec: BodySpec, size: number, half: number, jitter: () => number, noLaterThan: number | undefined): CellBody {
  const row = Math.round((spec.dy ?? 0) * (half + 1));
  let at = Math.round((spec.from ?? 0) * size);
  if (noLaterThan !== undefined) at = Math.min(at, noLaterThan);
  const sections: CellSection[] = [];
  for (const [lengthShare, halfShare] of spec.sections) {
    const length = Math.max(1, Math.round(lengthShare * size * jitter()));
    const rows = Math.round(halfShare * half);
    sections.push({ from: at, to: at + length, half: rows });
    at += length;
  }
  return { row, sections, blunt: spec.blunt === true };
}

/**
 * The cells: every row within a section's reach, every column within its
 * keel span — `q + r/2` in `[from, to)`, so odd rows sit half a column
 * east and the block stays a block — less the holes. Sorted, so the set is
 * the same set however the bodies were listed.
 */
function cellsOf(bodies: readonly CellBody[], holes: readonly CellBody[]): HexCell[] {
  const out = new Map<string, HexCell>();
  for (const body of bodies) {
    for (const cell of blockCells(body)) out.set(hexKey(cell), cell);
  }
  for (const hole of holes) {
    for (const cell of blockCells(hole)) out.delete(hexKey(cell));
  }
  return [...out.values()].sort((a, b) => 2 * a.q + a.r - (2 * b.q + b.r) || a.r - b.r);
}

function blockCells(body: CellBody): HexCell[] {
  const out: HexCell[] = [];
  for (const section of body.sections) {
    for (let r = body.row - section.half; r <= body.row + section.half; r++) {
      // Columns of this row inside the span: x = q + r/2 runs from `from` up
      // to but not including `to`, in steps of one.
      const first = Math.ceil(section.from - r / 2);
      const last = Math.ceil(section.to - r / 2) - 1;
      for (let q = first; q <= last; q++) out.push({ q, r });
    }
  }
  return out;
}

/**
 * The polygon over a body: each section a rectangle around all its cells'
 * hexagons, the steps between sections cut to slants, the bow a point.
 *
 * A section's cells reach half a column further east on odd rows than on
 * even ones, and half a column further west on even rows than on odd — the
 * rectangle takes the outer edge on both ends, so every hexagon is inside
 * and the side is straight. Where the hull narrows, the slant runs from the
 * taller section's corner into the shorter one, over the corner that holds
 * no cell; where it widens, the mirror of that. Every slant adds area to the
 * union of rectangles and cuts none away, which is why no hexagon can poke
 * out through a slant.
 */
function polygonOf(body: CellBody, nose: number): Polygon {
  const top: Point[] = [];
  const bottom: Point[] = [];
  const cy = body.row * 1.5;
  const sections = body.sections;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const H = s.half * 1.5 + 1;
    const x0 = (s.from - 0.5) * COL;
    const x1 = s.to * COL;
    const prev = sections[i - 1];
    const next = sections[i + 1];
    // Into a taller neighbour the slant leans out over this section's own end.
    const leanIn = prev !== undefined && prev.half > s.half ? chamfer(s, prev) : 0;
    const leanOut = next !== undefined && next.half > s.half ? chamfer(s, next) : 0;
    top.push({ x: x0 + leanIn, y: cy - H }, { x: x1 - leanOut, y: cy - H });
    bottom.push({ x: x0 + leanIn, y: cy + H }, { x: x1 - leanOut, y: cy + H });
  }
  const last = sections[sections.length - 1]!;
  const tip: Point[] = body.blunt ? [] : [{ x: last.to * COL + nose, y: cy }];
  return [...top, ...tip, ...bottom.reverse()];
}

/**
 * How far a slant reaches into the shorter of two sections: a gentle taper
 * about twice as long as it is tall, never past the shorter section's
 * middle. The region it crosses lies above the shorter section's rows and
 * beyond the taller one's last column, so no cell is ever under it.
 */
function chamfer(shorter: CellSection, taller: CellSection): number {
  const own = (shorter.to - shorter.from) * COL;
  return Math.min(own * 0.5, (taller.half - shorter.half) * 1.5 * 2.2);
}

/**
 * A hole's polygon: the rectangle *inside* the cells it took out, so the
 * hexagons kept beside it — which reach half a column and half a row into
 * the block on alternate rows — are not drawn over.
 */
function holePolygonOf(hole: CellBody): Polygon {
  const first = hole.sections[0]!;
  const last = hole.sections[hole.sections.length - 1]!;
  const cy = hole.row * 1.5;
  const H = Math.max(...hole.sections.map((s) => s.half)) * 1.5 + 0.5;
  const x0 = first.from * COL;
  const x1 = (last.to - 0.5) * COL;
  return [
    { x: x0, y: cy - H },
    { x: x1, y: cy - H },
    { x: x1, y: cy + H },
    { x: x0, y: cy + H },
  ];
}

/**
 * Engine pods on the stern plate: two, above and below the axis, unless the
 * stern is too narrow to hold them apart. The stern plate is the body's own
 * first and last corner, so a body off the spine gets its engines on itself.
 */
function podsOf(body: Polygon, rng: () => number): Pod[] {
  const top = body[0]!;
  const bottom = body[body.length - 1]!;
  const half = (bottom.y - top.y) / 2;
  const mid = (bottom.y + top.y) / 2;
  const w = 0.95;
  const len = 2.2 + rng() * 0.8;
  const seats = half >= 1.5 ? [mid - half + w * 0.55, mid + half - w * 0.55] : [mid];
  return seats.map((y) => ({ x: top.x - len, y: y - w / 2, w: len + 0.4, h: w }));
}

/**
 * How much of the hull stands empty on purpose: cells over compartments, as
 * a share. The deck the layout grows needs slack to turn in — a hull exactly
 * the size of the deck walls its own subtrees in — and the empty cells are
 * the hold, the bow, the stern: hull that is hull and not deck.
 */
export const MASK_SLACK = 0.2;

/**
 * The keel length at which the shape holds at least `want` cells at `half`
 * rows, and no longer: the smallest one, found by counting up. Never above
 * `SIZE_CEILING`, which is a hull the frame would not hold anyway.
 */
export function fitSize(kind: HullFormId, seed: number, half: number, want: number): number {
  for (let size = 2; size < SIZE_CEILING; size++) {
    if (shipForm(kind, seed, size, half).cells.length >= want) return size;
  }
  return SIZE_CEILING;
}

/**
 * The longest keel worth building, in cells: past it the ship, its bow and
 * its pods are wider than the itch frame's 1718 at the renderer's radius
 * (twelve columns of √3 radii, a bow of one and a half, pods of three and a
 * half — twenty-six radii of the twenty-seven the frame holds).
 */
export const SIZE_CEILING = 12;

/**
 * How many rows either side of the axis the frame's height allows: a hull
 * `half` rows out stands `3·half + 2` radii tall, and the frame's 764 less
 * the two captions holds eleven — three rows out, seven rows in all.
 */
export const HALF_CEILING = 3;

/** Centre of a cell of the tiling lattice, in radii of `R`. The renderer's own formula. */
export function hexCentre(cell: HexCell, R: number): Point {
  return { x: Math.sqrt(3) * R * (cell.q + cell.r / 2), y: 1.5 * R * cell.r };
}

/** The six corners of a tiling cell, clockwise from the top. */
export function hexCorners(cell: HexCell, R: number): Point[] {
  const c = hexCentre(cell, R);
  const half = (Math.sqrt(3) / 2) * R;
  return [
    { x: c.x, y: c.y - R },
    { x: c.x + half, y: c.y - R / 2 },
    { x: c.x + half, y: c.y + R / 2 },
    { x: c.x, y: c.y + R },
    { x: c.x - half, y: c.y + R / 2 },
    { x: c.x - half, y: c.y - R / 2 },
  ];
}

/** The mirror of a cell across the keel row: the same column, the same distance below. */
export function mirrored(cell: HexCell): HexCell {
  return { q: cell.q + cell.r, r: -cell.r };
}

/** Is the point inside the polygon, by the crossing rule? */
export function inside(p: Point, poly: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Deterministic 32-bit generator, the sandbox's. Seeded by the caller, never by the clock. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
