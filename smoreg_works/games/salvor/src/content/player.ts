import { Faction, makeEntity, type Entity } from "@jamrog/engine";
import { STARTING_HULL, type HullKind } from "./hulls.js";
import { applyDerived, makeStartingRig } from "../twist/rig.js";

/**
 * The drone, as the hull it was bought as.
 *
 * No position: on a ship there are no tiles, and the room is set by `RoomGame`
 * when the drone comes aboard. `pos` is still a field of `Entity` because the
 * grid game shares the type, so it is filled with a placeholder nothing reads.
 *
 * Every stat below is the bare chassis, and every one of them is overwritten
 * from the rack the hull comes with (`applyDerived`): the rig is the only
 * source of truth for what a drone can do, so the numbers in `makeEntity` are
 * only ever seen by a drone with an empty rack — which is a drone that is
 * already dead. The rack is built here rather than by the twist because which
 * hull this is decides it, and a hull is a purchase (`systems/voyage.ts`),
 * not a mechanic.
 */
export function makePlayer(hull: HullKind = STARTING_HULL): Entity {
  const drone = makeEntity({
    name: "drone",
    ch: "@",
    fg: "#f0e6d2",
    pos: { x: 0, y: 0 },
    faction: Faction.Player,
    hp: hull.core,
    hpMax: hull.core,
    damage: [1, 1, 0],
    defense: 0,
    speed: 100,
    fovRadius: 0,
    sight: 0,
    tags: [],
  });
  // The one drone in the game that comes with a rack. A hull off the rails is
  // a bare chassis — «покупной дрон приходит без модулей, надо ставить что
  // принесёт дрон с дереликта» — but the run has to start somewhere, and it
  // starts with the five modules the whole game is written against.
  drone.data = { ...(drone.data ?? {}), rig: makeStartingRig(hull.slots) };
  applyDerived(drone);
  return drone;
}
