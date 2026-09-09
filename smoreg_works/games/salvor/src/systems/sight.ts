import { canSee, isAlive, type Entity, type RoomGame } from "@jamrog/engine";
import { derivedStats, rigOf } from "../twist/rig.js";

/**
 * Does a machine see the drone?
 *
 * One pure function, and the only place the BAFFLE's other half is spent. The
 * alternative — writing `sight: 0` onto every machine while the module is
 * intact and putting it back when it burns — would leave the ship's state
 * depending on the rack, which is a bug the moment anything else reads that
 * field: a machine the alert wakes while the BAFFLE is up would keep the
 * penalty after it burned, and a saved run would reload with it baked in. Here
 * nothing is written at all; the penalty is applied at the moment of the
 * question and nowhere else.
 *
 * What the BAFFLE does on a graph is design-doc.md, "Модули": machines do not
 * see the drone in the next compartment, and in cover not even a `keen` one
 * does. It never hides a drone standing in the same room as a machine — the
 * module buys a door of distance, not immunity.
 *
 * Deliberately not a `System`: it has no hooks and no state. The alert (G23)
 * and the hunting behaviours read it.
 */
export function canSeeDrone(game: RoomGame, machine: Entity): boolean {
  if (!isAlive(machine) || machine.room === undefined) return false;
  return canSee(game.ship, baffled(game) ? blinkered(machine) : machine, game.player);
}

/** Is a BAFFLE intact in the rack right now? */
export function baffled(game: RoomGame): boolean {
  const rig = rigOf(game.player);
  return rig !== undefined && derivedStats(rig).machineFovPenalty > 0;
}

/**
 * The same machine, one door shorter-sighted and no longer keen — a copy, so
 * the ship keeps whatever the bestiary gave it.
 */
function blinkered(machine: Entity): Entity {
  return { ...machine, sight: 0, keen: false };
}
