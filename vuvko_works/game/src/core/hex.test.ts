import { describe, expect, it } from "vitest";
import {
  areAdjacent,
  edgeKey,
  hexAdd,
  hexCentre,
  hexCorners,
  hexDistance,
  hexEquals,
  hexGeometry,
  hexAt,
  hexKey,
  hexMirror,
  hexNeighbours,
  sharedEdge,
  HEX_DIRECTIONS,
} from "./hex";

describe("axial coordinates", () => {
  it("keys and compares", () => {
    expect(hexKey({ q: -1, r: 11 })).toBe("-1,11");
    expect(hexEquals({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
    expect(hexEquals({ q: 1, r: 2 }, { q: 2, r: 1 })).toBe(false);
    expect(hexAdd({ q: 1, r: 2 }, { q: -3, r: 4 })).toEqual({ q: -2, r: 6 });
  });

  it("gives one edge the same key from either side", () => {
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: -1 };
    expect(edgeKey(a, b)).toBe(edgeKey(b, a));
  });

  it("has six distinct neighbours, all at distance one", () => {
    const centre = { q: 3, r: -2 };
    const neighbours = hexNeighbours(centre);
    expect(neighbours).toHaveLength(6);
    expect(new Set(neighbours.map(hexKey)).size).toBe(6);
    for (const neighbour of neighbours) {
      expect(hexDistance(centre, neighbour)).toBe(1);
      expect(areAdjacent(centre, neighbour)).toBe(true);
    }
    expect(HEX_DIRECTIONS).toHaveLength(6);
  });

  it("measures distance through the lattice, not across it", () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: 0 })).toBe(3);
    expect(hexDistance({ q: 0, r: 0 }, { q: -2, r: -1 })).toBe(3);
    expect(areAdjacent({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(false);
  });
});

describe("geometry", () => {
  /* These must match hexmap.html's own hexGeom, or a mission will not line up
     with the deck plan drawn under it. The lattice is flat-top, turned a sixth
     and stood on the keel, so columns run along the ship. */
  const geometry = hexGeometry(35);

  it("uses the flat-to-flat width the export declares", () => {
    expect(geometry.feetAcross).toBe(35);
    expect(geometry.circumradius).toBeCloseTo(35 / Math.sqrt(3), 10);
    expect(geometry.originX).toBe(0);
    expect(geometry.originY).toBe(0);
  });

  it("steps a column by one and a half radii, and half a width down with it", () => {
    expect(hexCentre(geometry, { q: 0, r: 0 })).toEqual({ x: 0, y: 0 });

    const across = hexCentre(geometry, { q: 1, r: 0 });
    expect(across.x).toBeCloseTo(1.5 * geometry.circumradius, 10);
    expect(across.y).toBeCloseTo(35 / 2, 10);

    const along = hexCentre(geometry, { q: 0, r: 1 });
    expect(along.x).toBeCloseTo(0, 10);
    expect(along.y).toBeCloseTo(35, 10);
  });

  it("honours an origin offset", () => {
    const shifted = hexGeometry(35, 100, -40);
    expect(hexCentre(shifted, { q: 0, r: 0 })).toEqual({ x: 100, y: -40 });
    expect(hexCentre(shifted, { q: 2, r: 1 }).x).toBeCloseTo(
      100 + hexCentre(geometry, { q: 2, r: 1 }).x,
      10,
    );
  });

  it("draws a flat-top hexagon: a vertex due east, a flat edge on top", () => {
    const corners = hexCorners(geometry, { q: 0, r: 0 });
    expect(corners).toHaveLength(6);

    const east = corners.reduce((best, p) => (p.x > best.x ? p : best), corners[0]!);
    expect(east.x).toBeCloseTo(geometry.circumradius, 10);
    expect(east.y).toBeCloseTo(0, 10);

    /* Flat top means two corners share the highest edge, half a width up. */
    const highest = Math.min(...corners.map((p) => p.y));
    expect(highest).toBeCloseTo(-35 / 2, 10);
    expect(corners.filter((p) => Math.abs(p.y - highest) < 1e-9)).toHaveLength(2);

    for (const corner of corners) {
      expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(geometry.circumradius, 10);
    }
  });

  it("finds the hex a point falls in, and round-trips every centre", () => {
    /* The inverse of hexCentre. If these disagree, a click lands on the wrong
       hex — and at 35 ft that is a whole compartment away. */
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const cell = { q, r };
        expect(hexAt(geometry, hexCentre(geometry, cell))).toEqual(cell);
      }
    }
  });

  it("picks the nearest centre for a point off-centre, not the bounding box", () => {
    const cell = { q: 2, r: -1 };
    const centre = hexCentre(geometry, cell);
    /* Nudged well inside the hexagon in every direction, it is still that hex. */
    const nudge = geometry.circumradius * 0.4;
    const offsets: [number, number][] = [
      [nudge, 0],
      [-nudge, 0],
      [0, nudge],
      [0, -nudge],
      [nudge * 0.6, nudge * 0.6],
      [-nudge * 0.6, -nudge * 0.6],
    ];
    for (const [dx, dy] of offsets) {
      expect(hexAt(geometry, { x: centre.x + dx, y: centre.y + dy })).toEqual(cell);
    }
  });

  it("honours the origin when inverting", () => {
    const shifted = hexGeometry(35, 100, -40);
    const cell = { q: -3, r: 4 };
    expect(hexAt(shifted, hexCentre(shifted, cell))).toEqual(cell);
  });

  it("mirrors a cell across the keel", () => {
    expect(hexMirror({ q: 0, r: 3 })).toEqual({ q: 0, r: 3 });
    expect(hexMirror({ q: 2, r: 1 })).toEqual({ q: -2, r: 3 });
    /* A mirrored cell sits the same distance the other side of the keel. */
    const cell = { q: 3, r: -1 };
    expect(hexCentre(geometry, hexMirror(cell)).x).toBeCloseTo(-hexCentre(geometry, cell).x, 10);
    expect(hexMirror(hexMirror(cell))).toEqual(cell);
  });

  it("finds exactly the two corners neighbours share, and none for strangers", () => {
    const a = { q: 0, r: 0 };
    for (const neighbour of hexNeighbours(a)) {
      const edge = sharedEdge(geometry, a, neighbour);
      expect(edge).not.toBeNull();
      const [first, second] = edge!;
      expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeCloseTo(
        geometry.circumradius,
        6,
      );
    }
    expect(sharedEdge(geometry, a, { q: 4, r: 0 })).toBeNull();
  });
});
