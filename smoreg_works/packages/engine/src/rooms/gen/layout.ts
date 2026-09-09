import type { Door, DoorId, Room, RoomId, Ship } from "../graph.js";

/**
 * Where a ship sits on the schematic, and the rules that keep it drawable.
 *
 * The schematic is Duskers': one column per depth, boxes 9x4, a door drawn as
 * a label on the wire between two boxes. A box has room for two ports a side —
 * the name row and the glyph row — and two wires leaving the same side have to
 * head in different directions, or they share the four-column gap and cross.
 * That drawing rule, lifted from how Pierce's geomorphs join along fixed edge
 * points, is why the generator asks the layout whether a room may be attached
 * at all instead of laying out whatever it happened to grow.
 *
 * The layout is a pure function of the graph: the column is the depth, and the
 * row comes from the spanning tree, which is read back from the door ids (see
 * `parentDoor`). Nothing here touches the rng, so laying out a ship loaded from
 * a save draws the same picture the generator drew.
 */

/** Rooms per column, which is also how many rows the schematic shows at once. */
export const MAX_COLUMN = 6;

/** Which side of a box a door leaves by. */
export type Port = "left" | "right" | "up" | "down";

export interface PortUse {
  door: Door;
  /** Rows between this room and the one across the door. */
  dy: number;
}

/**
 * The door a room hangs from: the lowest-id door to a room one column
 * shallower. The generator grows the spanning tree first and adds loops
 * afterwards, so a tree door always carries the lower id — which means the tree
 * can be read back off a finished ship instead of remembered on the side, and
 * a ship out of a save file lays out exactly as it did when it was generated.
 */
export function parentDoor(ship: Ship, r: RoomId): Door | undefined {
  const room = ship.roomAt(r);
  if (room.depth === 0) return undefined;

  let best: Door | undefined;
  for (const { door, room: far } of ship.neighbours(r)) {
    if (far.id === r) continue; // the airlock's self-edge
    if (far.depth !== room.depth - 1) continue;
    if (!best || door.id < best.id) best = door;
  }
  return best;
}

/** The spanning tree: one door per room, the one it hangs from. */
export function treeDoors(ship: Ship): Set<DoorId> {
  const out = new Set<DoorId>();
  for (const r of ship.rooms) {
    const door = parentDoor(ship, r.id);
    if (door) out.add(door.id);
  }
  return out;
}

/**
 * Fill in `col` and `row` for every room.
 *
 * Column is depth. Rows come in two passes over each column: every first child
 * takes its parent's own row, so its wire runs straight across the gap, and
 * every second child goes below. That is what earns the two ports on a box's
 * right side their different directions — level and down — without a search.
 * Parents hold distinct rows, so the first pass never collides.
 */
export function layoutShip(ship: Ship): void {
  const columns = new Map<number, Room[]>();
  for (const r of ship.rooms) {
    r.col = r.depth;
    r.row = 0;
    const list = columns.get(r.col);
    if (list) list.push(r);
    else columns.set(r.col, [r]);
  }

  for (const col of [...columns.keys()].sort((a, b) => a - b)) {
    const here = columns.get(col)!;
    const kids = new Map<RoomId, Room[]>();
    const loose: Room[] = [];

    for (const r of here) {
      const door = parentDoor(ship, r.id);
      const parent = door ? ship.roomAt(ship.other(door, r.id)) : undefined;
      if (!parent || parent.col !== col - 1) {
        loose.push(r);
        continue;
      }
      const list = kids.get(parent.id);
      if (list) list.push(r);
      else kids.set(parent.id, [r]);
    }

    const taken = new Set<number>();
    const parents = [...kids.keys()]
      .map((id) => ship.roomAt(id))
      .sort((a, b) => a.row - b.row || a.id - b.id);

    for (const p of parents) {
      const first = kids.get(p.id)![0]!;
      first.row = freeAt(taken, p.row);
      taken.add(first.row);
    }
    for (const p of parents) {
      for (const kid of kids.get(p.id)!.slice(1)) {
        // Below by preference, above when the last visible row is taken: one
        // port level with the parent and one away from it, either way.
        kid.row = freeBelow(taken, p.row) ?? freeAbove(taken, p.row) ?? freeAt(taken, p.row);
        taken.add(kid.row);
      }
    }
    // The entry, and whatever a hand-written fixture left hanging off nothing,
    // packs from the top.
    for (const r of loose) {
      r.row = freeAt(taken, 0);
      taken.add(r.row);
    }
  }
}

/** Every door of a room, grouped by the side of the box it leaves by. */
export function portsOf(ship: Ship, r: RoomId): Map<Port, PortUse[]> {
  const room = ship.roomAt(r);
  const out = new Map<Port, PortUse[]>();

  for (const door of ship.doorsOf(r)) {
    const id = ship.other(door, r);
    const far = ship.roomAt(id);
    // The airlock hangs off the entry's left, where the tug box is drawn.
    const side: Port =
      id === r ? "left"
      : far.col > room.col ? "right"
      : far.col < room.col ? "left"
      : far.row > room.row ? "down"
      : "up";
    const use: PortUse = { door, dy: id === r ? 0 : far.row - room.row };
    const list = out.get(side);
    if (list) list.push(use);
    else out.set(side, [use]);
  }
  return out;
}

/**
 * Everything about a laid-out ship the schematic could not draw. Empty is the
 * only acceptable answer for a generated ship; the generator calls this after
 * every room it attaches and takes the room back when the list is not.
 */
export function layoutFaults(ship: Ship): string[] {
  const out: string[] = [];
  const cells = new Map<string, RoomId>();
  const perColumn = new Map<number, number>();

  for (const r of ship.rooms) {
    const cell = `${r.col},${r.row}`;
    const hit = cells.get(cell);
    if (hit !== undefined) out.push(`${r.label} and ${ship.roomAt(hit).label} share cell ${cell}`);
    cells.set(cell, r.id);
    if (r.col !== r.depth) out.push(`${r.label} is in column ${r.col} at depth ${r.depth}`);
    if (r.row < 0 || r.row >= MAX_COLUMN) out.push(`${r.label} sits on row ${r.row}, outside the visible band`);
    perColumn.set(r.col, (perColumn.get(r.col) ?? 0) + 1);
  }
  for (const [col, n] of perColumn) {
    if (n > MAX_COLUMN) out.push(`column ${col} holds ${n} rooms`);
  }

  for (const r of ship.rooms) {
    for (const [side, uses] of portsOf(ship, r.id)) {
      if (uses.length > 2) {
        out.push(`${r.label} has ${uses.length} doors on its ${side} side`);
        continue;
      }
      const [a, b] = uses;
      if (a && b && Math.sign(a.dy) === Math.sign(b.dy)) {
        out.push(`${r.label}: ${a.door.label} and ${b.door.label} leave its ${side} side the same way`);
      }
    }
  }

  for (const d of ship.doors) {
    if (d.a === d.b) continue;
    const a = ship.roomAt(d.a);
    const b = ship.roomAt(d.b);
    const dc = Math.abs(a.col - b.col);
    if (dc > 1) out.push(`${d.label} spans ${dc} columns`);
    // A wire inside one column is a straight segment between two boxes, so the
    // rooms it joins have to be neighbours in that column.
    else if (dc === 0 && Math.abs(a.row - b.row) !== 1) {
      out.push(`${d.label} joins ${a.label} and ${b.label} across ${Math.abs(a.row - b.row)} rows of one column`);
    }
  }
  return out;
}

/** The row itself when it is free, else the nearest free one, downwards first. */
function freeAt(taken: ReadonlySet<number>, from: number): number {
  const start = Math.max(0, from);
  if (!taken.has(start)) return start;
  for (let step = 1; step <= MAX_COLUMN; step++) {
    const down = start + step;
    if (down < MAX_COLUMN && !taken.has(down)) return down;
    const up = start - step;
    if (up >= 0 && !taken.has(up)) return up;
  }
  // Out of the visible band, which `layoutFaults` reports and the generator
  // refuses; a crowded column in a fixture still gets somewhere to stand.
  for (let row = MAX_COLUMN; ; row++) {
    if (!taken.has(row)) return row;
  }
}

function freeBelow(taken: ReadonlySet<number>, from: number): number | undefined {
  for (let row = Math.max(0, from) + 1; row < MAX_COLUMN; row++) {
    if (!taken.has(row)) return row;
  }
  return undefined;
}

function freeAbove(taken: ReadonlySet<number>, from: number): number | undefined {
  for (let row = Math.min(MAX_COLUMN, from) - 1; row >= 0; row--) {
    if (!taken.has(row)) return row;
  }
  return undefined;
}
