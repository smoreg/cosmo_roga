import type { Door, RoomId, Ship } from "../graph.js";
import type { ShipProblem, ShipSpec } from "../types.js";
import { layoutFaults, treeDoors } from "./layout.js";

/**
 * Every invariant a generated ship has to hold, in one list.
 *
 * The point is the same as `sim/mapgen/validate.ts`: a broken ship is caught in
 * the generator's retry loop, where the fix is "next seed", and not in a
 * player's browser, where the fix is a one-star robustness rating. Each entry
 * below is one of the guarantees in the design brief, and each is a property
 * test over a couple of hundred seeds.
 *
 * The three constants the invariants are written against live here rather than
 * in the generator, so nothing has to import the generator to check its output.
 */

/** No `deep` room kind is ever placed shallower than this. */
export const DEEP_DEPTH = 3;

/** Mark prefix for a key lying in a room: `key:k1`. */
export const KEY_MARK = "key:";

/** The one card mark the engine acts on: lock the tree door into this room. */
export const LOCK_ENTRY = "lock-entry";

/** Rooms a drone with no cutter can stand in, and the keys it finds there. */
export interface KeyReach {
  rooms: Set<RoomId>;
  keys: Set<string>;
}

/**
 * Dormans's rule, read back off a finished ship: walk from the airlock, pick up
 * every key in reach, and walk again with those keys. A locked door opens only
 * once its key has been reached by that same walk, so a key that lies behind
 * the door it opens is never collected and never opens anything. Sealed doors
 * are walls here — a weld has no electronics to pick, and the point of this
 * walk is what a drone without a cutter can still finish.
 */
export function reachableWithKeys(ship: Ship): KeyReach {
  const rooms = new Set<RoomId>([ship.entry]);
  const keys = new Set<string>();

  for (;;) {
    let grew = false;
    for (const r of rooms) {
      for (const mark of ship.roomAt(r).marks) {
        if (!mark.startsWith(KEY_MARK)) continue;
        const id = mark.slice(KEY_MARK.length);
        if (keys.has(id)) continue;
        keys.add(id);
        grew = true;
      }
    }
    for (const r of [...rooms]) {
      for (const { door, room } of ship.neighbours(r)) {
        if (room.id === r || rooms.has(room.id)) continue;
        if (!openable(door, keys)) continue;
        rooms.add(room.id);
        grew = true;
      }
    }
    if (!grew) return { rooms, keys };
  }
}

export function validateShip(ship: Ship, spec: ShipSpec): ShipProblem[] {
  const out: ShipProblem[] = [];
  const say = (code: string, detail: string): void => {
    out.push({ code, detail });
  };

  if (ship.size < spec.rooms[0] || ship.size > spec.rooms[1]) {
    say("size", `${ship.size} rooms, spec asks for ${spec.rooms[0]}..${spec.rooms[1]}`);
  }

  const airlocks = ship.doors.filter((d) => d.state === "airlock");
  if (airlocks.length !== 1) say("airlock", `${airlocks.length} airlocks, expected exactly one`);
  const airlock = airlocks[0];
  if (airlock && (airlock.a !== ship.entry || airlock.b !== ship.entry)) {
    say("airlock", `${airlock.label} does not hang off the entry room`);
  }

  const entry = ship.roomAt(ship.entry);
  if (entry.depth !== 0) say("entry", `entry ${entry.label} is at depth ${entry.depth}`);
  if (entry.kind !== spec.entryKind) {
    say("entry", `entry ${entry.label} is a ${entry.kind}, not a ${spec.entryKind}`);
  }

  // With a cutter, every door but the airlock opens, so nothing may be an island.
  const cut = walk(ship, (d) => d.state !== "airlock");
  if (cut.size !== ship.size) {
    say("disconnected", `${ship.size - cut.size} rooms unreachable even with a cutter`);
  }

  const counts = new Map<string, number>();
  for (const r of ship.rooms) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  for (const k of spec.kinds) {
    if (k.required && (counts.get(k.kind) ?? 0) !== 1) {
      say("required", `${k.kind} appears ${counts.get(k.kind) ?? 0} times, expected once`);
    }
    if (!k.deep) continue;
    for (const r of ship.rooms) {
      if (r.kind === k.kind && r.depth < DEEP_DEPTH) {
        say("deep", `${r.label} (${k.kind}) sits at depth ${r.depth}`);
      }
    }
  }

  // The guarantee the whole key rule exists for: the ship can be finished by a
  // drone that owns no cutter at all.
  const reach = reachableWithKeys(ship);
  for (const k of spec.kinds) {
    if (!k.required) continue;
    for (const r of ship.rooms) {
      if (r.kind === k.kind && !reach.rooms.has(r.id)) {
        say("required-unreachable", `${r.label} (${k.kind}) needs a cutter or a key from behind a door`);
      }
    }
  }

  const placed = new Set<string>();
  for (const r of ship.rooms) {
    for (const mark of r.marks) {
      if (!mark.startsWith(KEY_MARK)) continue;
      const id = mark.slice(KEY_MARK.length);
      if (placed.has(id)) say("key", `key ${id} lies in more than one room`);
      placed.add(id);
      if (!ship.doors.some((d) => d.state === "locked" && d.key === id)) {
        say("key", `key ${id} in ${r.label} opens nothing`);
      }
    }
  }
  for (const d of ship.doors) {
    if (d.state !== "locked") continue;
    if (d.key === undefined) {
      say("key", `${d.label} is locked and names no key`);
      continue;
    }
    if (!placed.has(d.key)) say("key", `key ${d.key} for ${d.label} was never placed`);
    else if (!reach.keys.has(d.key)) say("key", `key ${d.key} lies behind ${d.label}, the door it opens`);
  }

  const tree = treeDoors(ship);
  for (const d of ship.doors) {
    if (d.state === "locked" && !tree.has(d.id)) say("locked-loop", `${d.label} is locked but is a loop`);
    if (d.state === "sealed" && tree.has(d.id)) say("sealed-tree", `${d.label} is welded shut across a tree edge`);
  }
  // The structural half of the same rule: a weld may cost a detour, never a room.
  const unwelded = walk(ship, (d) => d.state !== "airlock" && d.state !== "sealed");
  if (unwelded.size !== ship.size) {
    say("sealed-cuts", `welded doors cut ${ship.size - unwelded.size} rooms off the ship`);
  }

  for (const r of ship.rooms) {
    const deg = ship.doorsOf(r.id).length;
    if (deg > 4) say("degree", `${r.label} has ${deg} doors`);
    if (r.depth > spec.maxDepth) say("depth", `${r.label} is at depth ${r.depth}, spec allows ${spec.maxDepth}`);
  }
  for (const fault of layoutFaults(ship)) say("layout", fault);

  const library = spec.cards ?? [];
  if (library.length > 0) {
    for (const r of ship.rooms) {
      for (const mark of r.marks) {
        if (mark.startsWith(KEY_MARK)) continue;
        const fits = library.some(
          (c) => c.marks.includes(mark) && (!c.kinds || c.kinds.includes(r.kind)),
        );
        if (!fits) say("card", `${r.label} (${r.kind}) carries '${mark}', which no card may leave there`);
      }
    }
  }

  return out;
}

function openable(d: Door, keys: ReadonlySet<string>): boolean {
  switch (d.state) {
    case "open":
    case "closed":
    case "broken":
      return true;
    case "locked":
      return d.key !== undefined && keys.has(d.key);
    default:
      // Sealed needs a cutter; the airlock leads home, not on.
      return false;
  }
}

/** Flood fill from the airlock through whatever `passable` admits. */
function walk(ship: Ship, passable: (d: Door) => boolean): Set<RoomId> {
  const seen = new Set<RoomId>([ship.entry]);
  const queue: RoomId[] = [ship.entry];
  for (let head = 0; head < queue.length; head++) {
    for (const { door, room } of ship.neighbours(queue[head]!)) {
      if (room.id === queue[head]! || seen.has(room.id) || !passable(door)) continue;
      seen.add(room.id);
      queue.push(room.id);
    }
  }
  return seen;
}
