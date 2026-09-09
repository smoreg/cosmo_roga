import type { Door, DoorId, RoomId, Ship } from "../graph.js";
import { parentDoor } from "./layout.js";

/**
 * The same ship on a honeycomb: one hexagon per compartment, one corridor per
 * door, and every corridor a straight segment between two hexagons that touch.
 *
 * A second drawing of the graph and not a second graph. `layoutShip` puts a
 * ship in columns by depth, which draws well as boxes and wires; this puts it
 * on a triangular lattice, which draws well as a deck plan. Both are pure
 * functions of the same rooms and doors, and neither is allowed an opinion the
 * other does not share — a ship loaded from a save lays out identically, and
 * nothing here touches the rng.
 *
 * ## Why some doors are not corridors
 *
 * Asking for *every* door to join two touching hexagons is asking for a
 * unit-distance embedding of an arbitrary graph in the triangular lattice, and
 * that does not exist in general: a hexagon has six neighbours, and a ship with
 * loops can easily want a seventh, or want two rooms in one cell.
 *
 * So the honeycomb is grown along the **spanning tree** — which a generated
 * ship always has, and which `parentDoor` can read back off a finished ship —
 * and every door is then judged geometrically: cells that touch get a corridor,
 * cells that do not get a link drawn at both ends. That keeps the one rule the
 * map is judged on: a connection the picture cannot draw as a line is still
 * *said*, at both of its ends (`docs/tasks/G49-schematic-honesty.md`). A picture
 * that quietly dropped an edge would be worse than an ugly one.
 *
 * Every compartment gets a cell, always — a hexagon the reader can find beats a
 * name in a footnote, even when the corridor to it has to be a link. The two
 * fixtures that used to wedge (a fan of three subtrees, and generated seed 2)
 * are why placement is not simply "the first free neighbour": a child takes the
 * free neighbour with the most room left around it, so a subtree is given
 * somewhere to grow instead of being walled in by its own sibling.
 *
 * ## Coordinates
 *
 * Axial `q, r` for pointy-top hexagons: two vertical edges east and west, four
 * slanted ones. That is the arrangement in the owner's reference — corridors
 * run level or diagonal and never vertical — and it is why the six directions
 * below are the whole of the geometry. Turning them into pixels is the
 * renderer's business, not this file's.
 */

export interface HexCell {
  q: number;
  r: number;
}

/**
 * How far apart the lattice puts two neighbours, as a multiple of touching.
 *
 * One would pack the hexagons edge to edge — and a corridor between two
 * hexagons that share an edge has nowhere to be: trimmed by the inradius at
 * both ends it comes out exactly zero long, which is why the first honeycomb
 * drew door labels floating in a wall with no corridor under them ("почему тут
 * нет перемещения?"). The renderer scales the pixel basis by this, and the
 * difference is the corridor.
 */
export const HEX_SPACING = 1.34;

/** The six neighbours of a pointy-top hexagon, in the order the growth prefers. */
export const HEX_DIRS: readonly HexCell[] = [
  { q: 1, r: 0 }, // east
  { q: 1, r: -1 }, // north-east
  { q: 0, r: 1 }, // south-east
  { q: 0, r: -1 }, // north-west
  { q: -1, r: 1 }, // south-west
  { q: -1, r: 0 }, // west
];

export interface HexLayout {
  /** Where each compartment sits. A room with no cell is in `offLattice`. */
  readonly cells: ReadonlyMap<RoomId, HexCell>;
  /** Doors drawn as a corridor: both ends placed, and the two cells touch. */
  readonly corridors: ReadonlySet<DoorId>;
  /**
   * Doors that exist and are not corridors. Drawn as a labelled link beside
   * both of their compartments, never dropped.
   */
  readonly links: ReadonlySet<DoorId>;
  /**
   * Compartments the lattice had no free cell for, in room order. Shown in a
   * strip at the edge with the doors that reach them, the same way the terminal
   * schematic shows what its window cannot hold.
   */
  readonly offLattice: readonly RoomId[];
}

/** Are these two cells neighbours on the lattice? */
export function hexAdjacent(a: HexCell, b: HexCell): boolean {
  return HEX_DIRS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
}

/** The key a cell is claimed under. Axial coordinates are unique per cell. */
export function hexKey(cell: HexCell): string {
  return `${cell.q},${cell.r}`;
}

const key = hexKey;

/**
 * Where the generator wrote a compartment's cell, when the hull was grown on
 * the lattice in the first place (`ShipSpec.lattice`).
 *
 * On the room and not beside it, because it has to survive a save: a hull the
 * run walks back into a sortie later must draw the same deck. Read defensively
 * — `room.data` round-trips through JSON, so nothing in it is trusted.
 */
export const HEX_KEY = "hex";

export function hexOf(room: { data: Record<string, unknown> }): HexCell | undefined {
  const raw = room.data[HEX_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const cell = raw as Partial<HexCell>;
  if (typeof cell.q !== "number" || typeof cell.r !== "number") return undefined;
  return { q: cell.q, r: cell.r };
}

/** Every neighbour of a cell, in the fixed direction order. */
export function hexAround(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

/**
 * Grow the honeycomb from the shallowest compartment outwards.
 *
 * Breadth-first along the spanning tree, so a compartment is placed only once
 * its parent has a cell, and the order within a level is by door id — the same
 * tie-break `layoutShip` uses, and the reason two runs of the same seed draw
 * the same deck.
 *
 * A child takes the free neighbour of its parent with the **most free
 * neighbours of its own**, direction order breaking the tie. That one line is
 * what stopped the layout wedging: taking the first free cell walls a subtree
 * in behind its sibling, and four compartments of generated seed 2 had nowhere
 * to go. Where a parent has no free neighbour at all the child still gets a
 * cell — the nearest free one, by rings outwards — and its own door becomes a
 * link rather than a corridor.
 */
export function hexLayout(ship: Ship): HexLayout {
  const stored = latticeCells(ship);
  if (stored !== undefined) return judge(ship, stored);

  const cells = new Map<RoomId, HexCell>();
  const taken = new Map<string, RoomId>();

  const roots = ship.rooms
    .filter((room) => parentDoor(ship, room.id) === undefined)
    .sort((a, b) => a.depth - b.depth || a.id - b.id);

  // Every root gets a lane of its own, well clear of the last one. A generated
  // ship has exactly one — the airlock compartment — and a hand-drawn fixture
  // can have several with nothing joining them.
  let lane = 0;
  for (const root of roots) {
    const at: HexCell = { q: 0, r: lane };
    if (taken.has(key(at))) continue;
    place(root.id, at);
    grow(root.id);
    lane += ship.rooms.length + 2;
  }

  // A room the tree never reached at all: a fixture with a door pointing at
  // nothing. It still gets a cell of its own rather than vanishing.
  const offLattice: RoomId[] = [];
  for (const room of ship.rooms) {
    if (cells.has(room.id)) continue;
    const free = nearestFree({ q: 0, r: lane });
    if (free === undefined) offLattice.push(room.id);
    else place(room.id, free);
    lane += 2;
  }

  repair();
  return { ...judge(ship, cells), offLattice };

  function place(room: RoomId, at: HexCell): void {
    cells.set(room, at);
    taken.set(key(at), room);
  }

  /**
   * Hill-climbing until no single move helps: for every compartment, every free
   * cell beside one of its neighbours, and take the move that draws more doors
   * as corridors than it breaks.
   *
   * Growth along the tree gets every tree door drawn and leaves the loops to
   * luck — 82 % of doors over two hundred hulls. The loops are what the owner
   * saw and would not have: a door drawn as a chip at both ends reads as a
   * teleport, whatever the label says. This pass is what closes the gap; the
   * measurement is in `packages/engine/tests/hexlayout.test.ts`.
   *
   * Deterministic to the last tie: compartments in id order, cells in the fixed
   * direction order, and a move taken only on a strict improvement. A layout
   * that depended on iteration order would break replay.
   */
  function repair(): void {
    const rooms = [...ship.rooms].sort((a, b) => a.id - b.id);
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (const room of rooms) {
        const from = cells.get(room.id);
        if (from === undefined) continue;
        const now = drawn(room.id, from);
        // Only cells beside a compartment this one has a door to: anywhere else
        // cannot improve its own doors, and moving it there would only break
        // somebody else's.
        for (const cell of candidates(room.id)) {
          if (drawn(room.id, cell) <= now) continue;
          taken.delete(key(from));
          place(room.id, cell);
          moved = true;
          break;
        }
      }
      if (!moved) return;
    }
  }

  /** How many of this compartment's doors would be corridors from `cell`. */
  function drawn(room: RoomId, cell: HexCell): number {
    let n = 0;
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at !== undefined && hexAdjacent(cell, at)) n++;
    }
    return n;
  }

  /** Free cells beside something this compartment has a door to. */
  function candidates(room: RoomId): HexCell[] {
    const out: HexCell[] = [];
    const seen = new Set<string>();
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === undefined) continue;
      for (const cell of around(at)) {
        if (!free(cell) || seen.has(key(cell))) continue;
        seen.add(key(cell));
        out.push(cell);
      }
    }
    return out;
  }

  function free(cell: HexCell): boolean {
    return !taken.has(key(cell));
  }

  function around(cell: HexCell): HexCell[] {
    return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
  }

  /** How much room a cell leaves for whatever is placed in it to grow into. */
  function breathing(cell: HexCell): number {
    return around(cell).filter(free).length;
  }

  /**
   * How many of this compartment's other doors would become real corridors if
   * it went in this cell — the doors to rooms already placed next door.
   */
  function loopsMet(room: RoomId, cell: HexCell): number {
    let met = 0;
    for (const { door, room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === undefined) continue;
      if (parentDoor(ship, room)?.id === door.id) continue; // the way in, already counted
      if (hexAdjacent(cell, at)) met++;
    }
    return met;
  }

  /** Rings outwards until something is free. Bounded: the lattice is infinite. */
  function nearestFree(from: HexCell): HexCell | undefined {
    if (free(from)) return from;
    for (let ring = 1; ring <= ship.rooms.length + 2; ring++) {
      for (let dq = -ring; dq <= ring; dq++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== ring) continue;
          const cell = { q: from.q + dq, r: from.r + dr };
          if (free(cell)) return cell;
        }
      }
    }
    return undefined;
  }

  /** Breadth-first from `from`, placing each child on a cell beside its parent. */
  function grow(from: RoomId): void {
    const queue: RoomId[] = [from];
    while (queue.length > 0) {
      const room = queue.shift()!;
      const here = cells.get(room)!;
      for (const child of childrenOf(ship, room)) {
        if (cells.has(child)) continue;
        const beside = around(here).filter(free);
        // Two things decide the cell, and in this order:
        //
        //   1. does it put the child next to a compartment it already has
        //      another door to? Every loop door landing beside its own room is
        //      a corridor drawn instead of two links written, and loops are the
        //      whole reason the honeycomb has links at all;
        //   2. how much elbow room is left around it, so the subtree has
        //      somewhere to grow and does not wedge behind its sibling.
        //
        // The direction order — east, then the diagonals — breaks what is left,
        // so a ship still spreads by depth rather than curling up.
        const score = (cell: HexCell): number => loopsMet(child, cell) * 8 + breathing(cell);
        const best = beside.sort((a, b) => score(b) - score(a))[0];
        const at = best ?? nearestFree(here);
        if (at === undefined) continue;
        place(child, at);
        queue.push(child);
      }
    }
  }
}

/** Rooms hanging off this one in the spanning tree, by door id. */
function childrenOf(ship: Ship, room: RoomId): RoomId[] {
  const out: Array<{ id: RoomId; door: Door }> = [];
  for (const { door, room: far } of ship.neighbours(room)) {
    if (far.id === room) continue;
    const parent = parentDoor(ship, far.id);
    if (parent?.id === door.id) out.push({ id: far.id, door });
  }
  return out.sort((a, b) => a.door.id - b.door.id).map((x) => x.id);
}


/**
 * The cells the generator wrote, if it wrote them for every compartment.
 *
 * All or nothing on purpose: half a stored lattice and half a guessed one would
 * put two compartments in one cell, and a picture with two names in one hexagon
 * is worse than a picture with a link in it.
 */
function latticeCells(ship: Ship): Map<RoomId, HexCell> | undefined {
  const out = new Map<RoomId, HexCell>();
  const taken = new Set<string>();
  for (const room of ship.rooms) {
    const cell = hexOf(room);
    if (cell === undefined || taken.has(hexKey(cell))) return undefined;
    taken.add(hexKey(cell));
    out.set(room.id, cell);
  }
  return out.size === ship.rooms.length ? out : undefined;
}

/**
 * Sort the doors into the ones the picture can draw and the ones it can only
 * name. Geometry and nothing else: a hull grown on the lattice has no links at
 * all, and one embedded after the fact has whatever it has.
 */
function judge(ship: Ship, cells: ReadonlyMap<RoomId, HexCell>): HexLayout {
  const corridors = new Set<DoorId>();
  const links = new Set<DoorId>();
  for (const door of ship.doors) {
    if (door.a === door.b) continue; // the airlock's self-edge is not a corridor
    const a = cells.get(door.a);
    const b = cells.get(door.b);
    if (a && b && hexAdjacent(a, b)) corridors.add(door.id);
    else links.add(door.id);
  }
  return { cells, corridors, links, offLattice: [] };
}
