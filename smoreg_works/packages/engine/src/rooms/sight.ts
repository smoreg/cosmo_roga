import type { Entity } from "../sim/entity.js";
import type { Door, RoomId, Ship } from "./graph.js";

/**
 * Visibility on a ship. Not shadowcasting: with no tiles there are no corners
 * to cast around, and the whole model is two rules — you see the room you are
 * standing in, and you see through a hole. What was `fovRadius 3` on the grid
 * is `sight` here: 0 sees this room only, 1 also sees the next one through an
 * open door, which is exactly the blindness that makes walking through a door
 * a decision.
 */

/**
 * Rooms within `depth` doors, counting only doors that can be seen through.
 *
 * An opaque room (`Room.opaque`) is a wall to sight both ways: nothing is seen
 * from inside it but itself, and from outside it is never reached, whatever
 * its doors are.
 */
export function visibleRooms(ship: Ship, from: RoomId, depth: number): Set<RoomId> {
  if (opaque(ship, from)) return new Set([from]);
  return spread(ship, from, depth, (d, to) => ship.seeThrough(d) && !opaque(ship, to));
}

/**
 * Rooms within `depth` doors through *any* door — the sensor pulse, which
 * reads the ship's structure rather than looking at it, smoke and all.
 */
export function scanRooms(ship: Ship, from: RoomId, depth: number): Set<RoomId> {
  return spread(ship, from, depth, () => true);
}

function opaque(ship: Ship, room: RoomId): boolean {
  return ship.roomAt(room).opaque === true;
}

/**
 * Can `viewer` see `target`? The same table for the player and for machines,
 * because the moment the two differ, hiding becomes a lie the UI tells.
 *
 *   same room        seen unless the target is hidden and the viewer is not keen
 *   next room        the same, and only with `sight >= 1`, an open door, and
 *                    neither room opaque
 *   anywhere else    no
 */
export function canSee(ship: Ship, viewer: Entity, target: Entity): boolean {
  const from = viewer.room;
  const to = target.room;
  if (from === undefined || to === undefined) return false;
  if (target.hidden === true && viewer.keen !== true) return false;
  if (from === to) return true;
  if ((viewer.sight ?? 0) < 1) return false;
  return visibleRooms(ship, from, 1).has(to);
}

function spread(
  ship: Ship,
  from: RoomId,
  depth: number,
  through: (d: Door, to: RoomId) => boolean,
): Set<RoomId> {
  const seen = new Set<RoomId>([from]);
  let frontier: RoomId[] = [from];

  for (let step = 0; step < depth; step++) {
    const next: RoomId[] = [];
    for (const r of frontier) {
      for (const d of ship.doorsOf(r)) {
        const to = ship.other(d, r);
        if (to === r || seen.has(to)) continue;
        if (!through(d, to)) continue;
        seen.add(to);
        next.push(to);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return seen;
}
