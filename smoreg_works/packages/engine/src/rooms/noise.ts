import type { Door, DoorState, RoomId, Ship } from "./graph.js";

/**
 * How much of a sound a door swallows. A hole in the wall costs the same as an
 * open door — one — and the airlock is the outside, which hears nothing.
 */
export const DOOR_LOSS: Record<DoorState, number> = {
  open: 1,
  broken: 1,
  closed: 3,
  locked: 4,
  sealed: 4,
  airlock: Infinity,
};

export function doorLoss(d: Door): number {
  return DOOR_LOSS[d.state];
}

/**
 * Spread noise across the ship, losing strength at every door — what
 * `sim/propagate.ts` does across tiles, over an adjacency list instead.
 *
 * Same loudest-first queue, and for the same reason: a room is finalised the
 * first time it is reached, so a quiet source behind a loud one never
 * overwrites it. Two sources therefore give the *maximum* that arrives, not
 * the sum — two machines shouting in different rooms do not add up into an
 * alarm nobody caused.
 *
 * The value is "how much arrived here", so a missing room means silence and a
 * machine's hearing check reads straight off the map.
 */
export function propagateRooms(
  ship: Ship,
  sources: ReadonlyArray<{ room: RoomId; strength: number }>,
  loss: (d: Door) => number = doorLoss,
): Map<RoomId, number> {
  const heard = new Map<RoomId, number>();
  const queue = [...sources]
    .filter((s) => s.strength > 0 && ship.rooms[s.room] !== undefined)
    .sort((a, b) => b.strength - a.strength)
    .map((s) => s.room);

  for (const s of sources) {
    if (ship.rooms[s.room] === undefined || s.strength <= 0) continue;
    if (s.strength > (heard.get(s.room) ?? 0)) heard.set(s.room, s.strength);
  }

  for (let head = 0; head < queue.length; head++) {
    const from = queue[head]!;
    const here = heard.get(from) ?? 0;
    if (here <= 0) continue;
    // A vented room has no air: it hears what reaches it and passes nothing on.
    if (ship.roomAt(from).hazard === "vented") continue;

    for (const d of ship.doorsOf(from)) {
      const to = ship.other(d, from);
      if (to === from) continue; // the airlock's self-edge
      const next = here - loss(d);
      if (next <= 0) continue;
      if (next <= (heard.get(to) ?? 0)) continue;
      heard.set(to, next);
      queue.push(to);
    }
  }

  return heard;
}

/** The loudest room within `radius` doors, for "walk towards the noise". */
export function loudestRoom(
  ship: Ship,
  noise: ReadonlyMap<RoomId, number>,
  from: RoomId,
  radius: number,
): RoomId | undefined {
  let best: RoomId | undefined;
  let bestV = 0;

  const seen = new Set<RoomId>([from]);
  let frontier: RoomId[] = [from];
  for (let step = 0; step <= radius; step++) {
    for (const r of frontier) {
      const v = noise.get(r) ?? 0;
      if (v > bestV) {
        bestV = v;
        best = r;
      }
    }
    const next: RoomId[] = [];
    for (const r of frontier) {
      for (const { door, room } of ship.neighbours(r)) {
        if (door.state === "airlock" || seen.has(room.id)) continue;
        seen.add(room.id);
        next.push(room.id);
      }
    }
    frontier = next;
  }
  return best;
}
