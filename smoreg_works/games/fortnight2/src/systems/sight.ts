import { chebyshev, effectiveFov, hasLos, isAlive, type Entity, type Game } from "@jamrog/engine";
import { MIN_MACHINE_FOV } from "../content/modules.js";
import { derivedStats, rigOf } from "../twist/rig.js";

/**
 * Does a machine see the drone?
 *
 * One pure function, and the only place the BAFFLE's other half is spent. The
 * alternative — writing a smaller `fovRadius` onto every machine while the
 * module is intact and putting it back when it burns — would leave the deck's
 * state depending on the rack, which is a bug the moment anything else reads
 * that field: a machine spawned by the alert while the BAFFLE was up would
 * keep the penalty after it burned, and a saved run would reload with it baked
 * in. Here nothing is written at all; the penalty is applied at the moment of
 * the question and nowhere else.
 *
 * Deliberately not a `System`: it has no hooks and no state. src/systems/alert.ts
 * (G23) and the hunter behaviour read it; today the machines' own AI still uses
 * the engine's plain FOV, so the BAFFLE shortens the range at which the ship
 * notices the drone and not yet the range at which one machine swings at it.
 */
export function canSeeDrone(game: Game, machine: Entity): boolean {
  if (!isAlive(machine)) return false;
  const radius = machineSight(game, machine);
  if (chebyshev(machine.pos, game.player.pos) > radius) return false;
  return hasLos(game.level, machine.pos, game.player.pos, radius);
}

/**
 * How far this machine notices the drone: its own sight, blind and dazed
 * statuses included (`effectiveFov`), minus what the rack hides — never below
 * the floor, because a module that made the drone untouchable next to a hauler
 * would be a different game.
 */
export function machineSight(game: Game, machine: Entity): number {
  const rig = rigOf(game.player);
  const penalty = rig ? derivedStats(rig).machineFovPenalty : 0;
  return Math.max(MIN_MACHINE_FOV, effectiveFov(machine) - penalty);
}
