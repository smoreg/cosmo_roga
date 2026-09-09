import { Grid, type Point, chebyshev } from "./grid.js";

export const enum Tile {
  Wall = 0,
  Floor = 1,
  StairsDown = 2,
  Door = 3,
  Rubble = 4,
  /** The only legal passage between two zones. Walkable, but blocks sight. */
  Airlock = 5,
  /** A zone wall panel that was never cut open. Solid and opaque. */
  Bulkhead = 6,
  /**
   * The way off this level entirely, as opposed to `StairsDown`, which is the
   * way further in. Walkable and opaque like any airlock; what lies on the
   * other side is the game's business, not the engine's.
   */
  AirlockOut = 7,
}

export interface TileDef {
  ch: string;
  fg: string;
  bg: string;
  walkable: boolean;
  transparent: boolean;
  name: string;
}

export const TILES: Record<Tile, TileDef> = {
  [Tile.Wall]: { ch: "#", fg: "#5a5a66", bg: "#14141a", walkable: false, transparent: false, name: "wall" },
  [Tile.Floor]: { ch: ".", fg: "#4a4a55", bg: "#0b0b0f", walkable: true, transparent: true, name: "floor" },
  [Tile.StairsDown]: { ch: ">", fg: "#e8d16a", bg: "#0b0b0f", walkable: true, transparent: true, name: "stairs down" },
  [Tile.Door]: { ch: "+", fg: "#b08050", bg: "#14141a", walkable: true, transparent: false, name: "door" },
  [Tile.Rubble]: { ch: "%", fg: "#6b6b55", bg: "#0b0b0f", walkable: true, transparent: true, name: "rubble" },
  [Tile.Airlock]: { ch: "=", fg: "#6aa8c0", bg: "#14141a", walkable: true, transparent: false, name: "airlock" },
  [Tile.Bulkhead]: { ch: "|", fg: "#7a6a5a", bg: "#14141a", walkable: false, transparent: false, name: "sealed bulkhead" },
  [Tile.AirlockOut]: { ch: "<", fg: "#8fd0e0", bg: "#14141a", walkable: true, transparent: false, name: "outer airlock" },
};

/** Walkable but a doorway, never a floor: nothing may be built on one. */
export function isAirlock(t: Tile): boolean {
  return t === Tile.Airlock || t === Tile.AirlockOut;
}

export interface RoomRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function roomCenter(r: RoomRect): Point {
  return { x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 };
}

/**
 * A sector of the level: one named area whose only connections to its
 * neighbours are airlocks. Zones never overlap, so a point belongs to at most
 * one of them. What a zone *means* is the game's business — the engine carries
 * `kind` and `name` around without ever reading them.
 */
export interface Zone {
  id: number;
  /** Content-defined kind, e.g. "cargo". The engine never interprets it. */
  kind: string;
  name: string;
  /** Inclusive, and includes the zone's own wall ring. */
  rect: RoomRect;
  airlocks: Point[];
}

export class Level {
  readonly depth: number;
  readonly tiles: Grid<Tile>;
  /** Currently lit by the player's FOV. Recomputed every player turn. */
  readonly visible: Grid<boolean>;
  /** Ever seen. Drawn dimmed when not visible. */
  readonly explored: Grid<boolean>;
  readonly rooms: RoomRect[];
  /** Sectors this level is made of. Empty for generators without a zone graph. */
  readonly zones: Zone[];

  constructor(depth: number, width: number, height: number) {
    this.depth = depth;
    this.tiles = new Grid<Tile>(width, height, Tile.Wall);
    this.visible = new Grid<boolean>(width, height, false);
    this.explored = new Grid<boolean>(width, height, false);
    this.rooms = [];
    this.zones = [];
  }

  get width(): number {
    return this.tiles.width;
  }

  get height(): number {
    return this.tiles.height;
  }

  def(x: number, y: number): TileDef | undefined {
    const t = this.tiles.get(x, y);
    return t === undefined ? undefined : TILES[t];
  }

  isWalkable(x: number, y: number): boolean {
    return this.def(x, y)?.walkable ?? false;
  }

  isTransparent(x: number, y: number): boolean {
    return this.def(x, y)?.transparent ?? false;
  }

  /** Room containing the point, if any. */
  roomAt(p: Point): RoomRect | undefined {
    return this.rooms.find((r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2);
  }

  /** Zone containing the point, if any. Zones do not overlap, so this is unambiguous. */
  zoneAt(p: Point): Zone | undefined {
    return this.zones.find((z) => p.x >= z.rect.x1 && p.x <= z.rect.x2 && p.y >= z.rect.y1 && p.y <= z.rect.y2);
  }

  /** Walkable tiles at least `minDist` away from `from` (spawn placement). */
  walkableFar(from: Point, minDist: number): Point[] {
    const out: Point[] = [];
    this.tiles.forEach((x, y, t) => {
      if (TILES[t].walkable && chebyshev({ x, y }, from) >= minDist) out.push({ x, y });
    });
    return out;
  }
}
