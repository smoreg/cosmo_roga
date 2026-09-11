/**
 * Turning a hull plan into a deck map.
 *
 * This is `hexmap.html`'s extraction, ported: rasterise the plan, flood the
 * space it encloses, call each enclosed piece a room, lay a lattice over the
 * top, and put doors where the artwork drew walls thin enough to hold one.
 *
 * Everything here is pure and works on an ink mask, so the only part that
 * needs a canvas is the rasteriser that produces the mask.
 */

/** Raster resolution: 12 px to a 5 ft square, sampled down to 4. */
export const PX_FT = 4;
/** Above this alpha a pixel is structure. */
export const ALPHA = 12;
/** Shared walls kept as doors beyond the spanning tree. */
export const LOOP_SHARE = 0.45;
/** A hexagon this empty is not floor. */
export const MIN_OPEN = 0.1;
/** Smaller than this and it is a locker, not a room. */
export const MIN_ROOM_SQFT = 80;
/** Thicker than this is a hull, not a wall with a door in it. */
export const MAX_WALL_FT = 3;

export interface TileTax {
  readonly roles?: readonly string[];
  readonly edge?: Readonly<Record<string, string>>;
  readonly skin?: readonly string[];
  readonly attach?: readonly string[];
}

export interface PlanTile {
  readonly path: string;
  readonly label: string;
  readonly kind: string;
  readonly px: readonly [number, number];
  readonly w: number;
  readonly h: number;
  readonly mirror?: boolean;
  readonly overlay?: boolean;
  readonly tons?: number;
  readonly tax?: TileTax;
}

export interface Placement {
  readonly tile: PlanTile;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
  readonly rot: number;
}

/** What `geomorph-core`'s `layout()` hands back. */
export interface HullPlan {
  readonly seed: string;
  readonly name: string;
  readonly hull: string;
  readonly W: number;
  readonly H: number;
  readonly put: readonly Placement[];
}

/** One byte per pixel: 1 where the artwork put structure. */
export interface InkMask {
  readonly w: number;
  readonly h: number;
  readonly ink: Uint8Array;
}

export interface Regions {
  /** Region id per pixel: 1 is the vacuum, >1 a room, -1 structure. */
  readonly reg: Int32Array;
  /** Pixel count per region; 0 means struck off as too small. */
  readonly sizes: readonly number[];
  readonly sumX: Float64Array;
  readonly sumY: Float64Array;
}

export interface Contact {
  readonly a: number;
  readonly b: number;
  readonly n: number;
  readonly x: number;
  readonly y: number;
}

export interface Stub {
  readonly a: number;
  readonly b: number;
  readonly x: number;
  readonly y: number;
}

/* ---------- the lattice laid over the rooms ---------- */

export interface MapCell {
  readonly q: number;
  readonly r: number;
  /** How much of this hexagon each zone owns, in pixels. */
  readonly votes: Map<number, number>;
  floor: number;
  wall: number;
  kind: "floor" | "solid" | "void";
  zone: number;
  /** Every zone this hexagon covers, most floor first. */
  zones: number[];
  reachable: boolean;
}

export interface MapWall {
  readonly a: MapCell;
  readonly b: MapCell | null;
  readonly hull: boolean;
  /** The middle of the shared edge, in feet. */
  readonly mx: number;
  readonly my: number;
  door: MapDoor | null;
}

export interface MapZone {
  readonly id: number;
  readonly region: number;
  readonly cx: number;
  readonly cy: number;
  readonly roles: readonly string[];
  readonly cells: MapCell[];
  readonly area: number;
  readonly source: string;
  readonly kind: string;
  name: string;
  marks: string[];
  hazard: string;
  sealed: boolean;
  entry: boolean;
}

export interface MapDoor {
  readonly a: number;
  readonly b: number;
  readonly wall: MapWall;
  /** True for the doors that keep the ship walkable. */
  readonly tree: boolean;
  id: number;
  state: "open" | "closed" | "locked";
}

/** Asked in several places, so it is named once. */
export function isFloorCell(cell: MapCell): boolean {
  return cell.kind === "floor";
}

/** Overlays are vehicles parked on the plan, not part of the ship. */
export function isArchitecture(placement: {
  readonly tile: { readonly overlay?: boolean };
}): boolean {
  return placement.tile.overlay !== true;
}
