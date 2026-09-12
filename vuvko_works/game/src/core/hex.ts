/**
 * The lattice `hexmap.html` exports: flat-top axial coordinates, turned a
 * sixth and stood on the keel, so the columns run along the ship rather than
 * across it. Axial neighbours and distance are the same whichever way the
 * hexagon is turned; only the geometry below knows the difference.
 */

export interface Axial {
  readonly q: number;
  readonly r: number;
}

/** The six neighbours, in the order `hexmap.html` uses. */
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
];

export function hexKey(c: Axial): string {
  return `${c.q},${c.r}`;
}

/** Unordered, so one edge has one key whichever side you approach it from. */
export function edgeKey(a: Axial, b: Axial): string {
  const first = hexKey(a);
  const second = hexKey(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

export function hexEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function hexNeighbours(c: Axial): Axial[] {
  const out: Axial[] = [];
  for (const direction of HEX_DIRECTIONS) out.push(hexAdd(c, direction));
  return out;
}

export function areAdjacent(a: Axial, b: Axial): boolean {
  return hexDistance(a, b) === 1;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Feet, not pixels. The renderer scales; the model stays in ship units so a
 * 25 ft map and a 35 ft map describe the same vessel at the same size — and
 * so the deck plan drawn underneath lands in the same coordinates.
 */
export interface HexGeometry {
  /** Flat to flat. */
  readonly feetAcross: number;
  readonly circumradius: number;
  readonly originX: number;
  readonly originY: number;
}

/**
 * The floor a hex covers, in square feet.
 *
 * A regular hexagon measured across the flats: `(sqrt(3) / 2) * width^2`.
 * Anything the rules state as an area — how big a compartment must be to be
 * worth something — has to come back through this to be counted in hexes.
 */
export function hexArea(feetAcross: number): number {
  return (Math.sqrt(3) / 2) * feetAcross * feetAcross;
}

export function hexGeometry(feetAcross: number, originX = 0, originY = 0): HexGeometry {
  return { feetAcross, circumradius: feetAcross / Math.sqrt(3), originX, originY };
}

export function hexCentre(geometry: HexGeometry, c: Axial): Point {
  return {
    x: geometry.originX + 1.5 * geometry.circumradius * c.q,
    y: geometry.originY + geometry.feetAcross * (c.r + c.q / 2),
  };
}

export function hexCorners(geometry: HexGeometry, c: Axial): Point[] {
  const centre = hexCentre(geometry, c);
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({
      x: centre.x + geometry.circumradius * Math.cos(angle),
      y: centre.y + geometry.circumradius * Math.sin(angle),
    });
  }
  return corners;
}

/**
 * The cell opposite, across the keel.
 *
 * `-0` is normalised away: the reference produces it for the centre column,
 * and it compares unequal to `0` under Object.is, which trips both structural
 * equality and anything keyed on the pair.
 */
export function hexMirror(c: Axial): Axial {
  return { q: c.q === 0 ? 0 : -c.q, r: c.r + c.q };
}

/**
 * The hex a point falls in — `hexmap.html`'s own inverse, cube-rounded so it
 * picks the nearest centre rather than the containing bounding box, or the
 * columns would shear.
 */
export function hexAt(geometry: HexGeometry, point: Point): Axial {
  const x = point.x - geometry.originX;
  const y = point.y - geometry.originY;
  const q = ((2 / 3) * x) / geometry.circumradius;
  const r = (-x / 3 + (Math.sqrt(3) / 3) * y) / geometry.circumradius;

  const cubeY = -q - r;
  let roundedQ = Math.round(q);
  const roundedY = Math.round(cubeY);
  let roundedR = Math.round(r);
  const driftQ = Math.abs(roundedQ - q);
  const driftY = Math.abs(roundedY - cubeY);
  const driftR = Math.abs(roundedR - r);

  /* Two branches, as in the reference: only q and r are returned, so the
     third correction would be dead. */
  if (driftQ > driftY && driftQ > driftR) roundedQ = -roundedY - roundedR;
  else if (driftY <= driftR) roundedR = -roundedQ - roundedY;

  return { q: roundedQ, r: roundedR };
}

/** The two corners a pair of neighbouring hexes share, for drawing a wall or a door. */
export function sharedEdge(geometry: HexGeometry, a: Axial, b: Axial): [Point, Point] | null {
  const tolerance = geometry.feetAcross * 0.02;
  const cornersOfA = hexCorners(geometry, a);
  const cornersOfB = hexCorners(geometry, b);
  const shared: Point[] = [];
  for (const pointOfA of cornersOfA) {
    for (const pointOfB of cornersOfB) {
      if (Math.hypot(pointOfA.x - pointOfB.x, pointOfA.y - pointOfB.y) < tolerance) {
        shared.push(pointOfA);
        break;
      }
    }
  }
  if (shared.length !== 2) return null;
  const [first, second] = shared;
  if (first === undefined || second === undefined) return null;
  return [first, second];
}
