/**
 * Turning a deck into things to draw.
 *
 * Pure geometry in feet — no DOM, no React, no stores. The renderer scales;
 * the model stays in ship units so a 25 ft map and a 35 ft map describe the
 * same vessel at the same size.
 */

import { cellAt, deckGeometry, doorBetween } from "../core/deck";
import { edgeKey, hexCentre, hexCorners, hexKey, hexNeighbours, sharedEdge } from "../core/hex";
import type { Axial, HexGeometry, Point } from "../core/hex";
import type { DeckMap, DoorState, Zone } from "../core/types";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HexShape {
  readonly at: Axial;
  readonly zoneId: number;
  readonly points: readonly Point[];
  readonly centre: Point;
}

export type WallKind = "hull" | "bulkhead";

export interface WallSegment {
  readonly kind: WallKind;
  readonly from: Point;
  readonly to: Point;
}

export interface DoorSegment {
  readonly doorId: number;
  readonly state: DoorState;
  readonly isLoop: boolean;
  /** A whole span when shut; two leaves with a gap between when it is not. */
  readonly leaves: readonly (readonly [Point, Point])[];
}

export interface DeckLayout {
  readonly geometry: HexGeometry;
  readonly bounds: Box;
  readonly hexes: readonly HexShape[];
  readonly walls: readonly WallSegment[];
  readonly rooms: readonly RoomShape[];
}

export interface RoomShape {
  readonly zone: Zone;
  readonly points: readonly (readonly Point[])[];
}

function boundsOf(geometry: HexGeometry, deck: DeckMap): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of deck.cells.values()) {
    for (const corner of hexCorners(geometry, cell.at)) {
      if (corner.x < minX) minX = corner.x;
      if (corner.y < minY) minY = corner.y;
      if (corner.x > maxX) maxX = corner.x;
      if (corner.y > maxY) maxY = corner.y;
    }
  }
  const pad = geometry.feetAcross * 0.9;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/**
 * The two corners of a hex facing a neighbour that is not there — an outer
 * hull edge has nothing to share corners with.
 */
function outerEdge(geometry: HexGeometry, at: Axial, towards: Axial): [Point, Point] | null {
  const corners = hexCorners(geometry, at);
  const here = hexCentre(geometry, at);
  const there = hexCentre(geometry, towards);
  const midpoint = { x: (here.x + there.x) / 2, y: (here.y + there.y) / 2 };
  const ranked = corners
    .map(function withDistance(point: Point): { point: Point; distance: number } {
      return { point, distance: Math.hypot(point.x - midpoint.x, point.y - midpoint.y) };
    })
    .sort(function nearestFirst(a, b): number {
      return a.distance - b.distance;
    });
  const first = ranked[0]?.point;
  const second = ranked[1]?.point;
  if (first === undefined || second === undefined) return null;
  return [first, second];
}

export function layoutDeck(deck: DeckMap): DeckLayout {
  const geometry = deckGeometry(deck);

  const hexes: HexShape[] = [];
  for (const cell of deck.cells.values()) {
    hexes.push({
      at: cell.at,
      zoneId: cell.zoneId,
      points: hexCorners(geometry, cell.at),
      centre: hexCentre(geometry, cell.at),
    });
  }

  /* Hull and bulkheads. A room boundary the artwork gave no door is a wall,
     and that is what makes the deck a graph of chokepoints. */
  const walls: WallSegment[] = [];
  const drawn = new Set<string>();
  for (const cell of deck.cells.values()) {
    for (const neighbour of hexNeighbours(cell.at)) {
      const key = edgeKey(cell.at, neighbour);
      if (drawn.has(key)) continue;
      const other = cellAt(deck, neighbour);

      if (other === null) {
        const segment = outerEdge(geometry, cell.at, neighbour);
        if (segment === null) continue;
        drawn.add(key);
        walls.push({ kind: "hull", from: segment[0], to: segment[1] });
        continue;
      }
      if (other.zoneId === cell.zoneId) continue;
      if (doorBetween(deck, cell.at, neighbour) !== null) continue;

      const segment = sharedEdge(geometry, cell.at, neighbour);
      if (segment === null) continue;
      drawn.add(key);
      walls.push({ kind: "bulkhead", from: segment[0], to: segment[1] });
    }
  }

  /* Rooms, as the hexes they own. Used for the backdrop, where they are
     blurred into a suggestion of structure rather than drawn sharply. */
  const byZone = new Map<number, Point[][]>();
  for (const shape of hexes) {
    const list = byZone.get(shape.zoneId) ?? [];
    list.push([...shape.points]);
    byZone.set(shape.zoneId, list);
  }
  const rooms: RoomShape[] = [];
  for (const [zoneId, polygons] of byZone) {
    const zone = deck.zones.get(zoneId);
    if (zone === undefined) continue;
    rooms.push({ zone, points: polygons });
  }

  return { geometry, bounds: boundsOf(geometry, deck), hexes, walls, rooms };
}

export function doorSegments(
  deck: DeckMap,
  layout: DeckLayout,
  doorStates: ReadonlyMap<number, DoorState>,
): DoorSegment[] {
  const out: DoorSegment[] = [];
  for (const door of deck.doors) {
    const segment = sharedEdge(layout.geometry, door.from, door.to);
    if (segment === null) continue;
    const state = doorStates.get(door.id) ?? "open";
    const [a, b] = segment;

    /* A door that will not let you past is drawn as one unbroken span; one
       that will is drawn as leaves pulled back against the jambs, so the gap
       in the middle is literally the way through. A broken door is a hole,
       so its gap is wider than an open one's. */
    if (state === "closed" || state === "locked") {
      out.push({ doorId: door.id, state, isLoop: door.isLoop, leaves: [[a, b]] });
      continue;
    }
    function along(t: number): Point {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    const shoulder = state === "broken" ? 0.18 : 0.3;
    out.push({
      doorId: door.id,
      state,
      isLoop: door.isLoop,
      leaves: [
        [along(0), along(shoulder)],
        [along(1 - shoulder), along(1)],
      ],
    });
  }
  return out;
}

export function hexShapeAt(layout: DeckLayout, at: Axial): HexShape | null {
  const wanted = hexKey(at);
  for (const shape of layout.hexes) {
    if (hexKey(shape.at) === wanted) return shape;
  }
  return null;
}

export function pointsToPath(points: readonly Point[]): string {
  return points
    .map(function toPair(point: Point): string {
      return `${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`;
    })
    .join(" ");
}
