import { isAlive, type RoomGame, type System } from "@jamrog/engine";
import { JAMMER } from "../content/monsters.js";

/**
 * The jammer's field: while one of them is standing in the drone's compartment,
 * the rack's active modules do nothing (design-doc.md, "Машины", `j`).
 *
 * One predicate and one panel line, because that is the whole mechanic — what
 * it costs the player is not a number but an ordering. A jammed drone can still
 * swing, still walk and still shut a door; what it cannot do is spend the SPIKE
 * on the bulkhead behind it or the EMP on the pack coming through it. So the
 * jammer is the machine you deal with first, and the price of dealing with it
 * first is that everything else aboard gets those turns for free.
 *
 * A system rather than a helper in the rig: the rig must not know which machine
 * this is, and the ship must be able to say "jammed" without the rig existing —
 * the panel line is the player's only warning, and a fight the module list has
 * quietly stopped answering is a bug report nobody can write.
 */

/** Copied from ui/theme.ts (THEME.bad): src/systems must not import src/ui. */
const BAD_FG = "#d96a6a";

/** Is a live jammer standing where the drone is? */
export function jammed(game: RoomGame): boolean {
  const here = game.player.room;
  if (here === undefined) return false;
  return game.entities.some((e) => e.name === JAMMER.name && e.room === here && isAlive(e));
}

export const JAM: System<RoomGame> = {
  name: "jam",

  /**
   * Nothing while the rack answers, one word while it does not. Silence is the
   * correct panel for a mechanic that is off: a permanent "JAMMED ▯" would cost
   * a line of a panel that is already full of the rack.
   */
  panelLines(game) {
    return jammed(game) ? [{ text: "JAMMED", fg: BAD_FG }] : [];
  },
};
