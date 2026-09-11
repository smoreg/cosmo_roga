import type { ActionOffer, RoomCommand, RoomGame, System } from "@jamrog/engine";
import { isTug } from "../content/tug.js";

/**
 * The tug, after it stopped being a ship you walk about in.
 *
 * What used to live here was a table — which of four compartments each
 * between-sortie verb belonged to — and a refusal for pressing one anywhere
 * else. The owner played two live runs with it and asked for the opposite in as
 * many words: «на буксире безумно неудобно, ты ходишь криво по собственным
 * отсекам… используй самые обычные меню; это два разных режима игры»
 * (docs/tasks/G53-tug-is-a-menu.md).
 *
 * He is right about the mechanic and not only about the ergonomics. On a
 * derelict walking is the game — noise, alert, machines, the distance back to
 * the airlock — and every step is a bet. Aboard your own tug there is nobody to
 * walk away from and nothing to find, so a compartment boundary was a keystroke
 * and a turn spent on no decision at all. The table is gone with it: every verb
 * is offered wherever the drone stands aboard, and how the list is grouped for
 * reading is `ui/actions.ts`'s (`tugActions`), which is where the rest of the
 * screen's grouping already lives.
 *
 * What is left is the one rule that was never about geography: nothing lives on
 * the tug.
 */

/**
 * Everything the panel and the bots should see, from every system: the plain
 * join, and nothing but it.
 *
 * Kept as a name of its own because it is the list the whole game is read by —
 * a bot presses out of it, the panel is built from it, and the tug's grouped
 * list is this list arranged for reading. What it must never do is grow a
 * second copy of anything: TUG used to collect every other system's offers and
 * hand back gated copies of them, so the engine's plain join came back with
 * every station line in it twice — once gated and once raw — and a bot pressed
 * the raw copy the game then refused (G41).
 */
export function gatedOffers(game: RoomGame): Array<ActionOffer<RoomCommand>> {
  return game.systems.flatMap((s) => s.offerActions?.(game) ?? []);
}

export const TUG: System<RoomGame> = {
  name: "tug",

  /**
   * Nothing lives on the tug.
   *
   * The engine populates every ship it generates (`rooms/game.ts`), and it is
   * right to: it has no way of knowing that this one is the drone's own hull
   * rather than a derelict. Clearing the deck here rather than teaching the
   * content pack about ship ids keeps that knowledge in the one file that has
   * it, and it holds for any machine that ever ends up aboard.
   */
  onLevelEnter(game) {
    if (!isTug(game)) return;
    game.entities = game.entities.filter((e) => e.id === game.player.id);
  },

  // No `offerActions`, no `performCommand` and no `panelLines`. This system
  // offers nothing of its own, refuses nothing that used to be somebody else's
  // compartment, and says nothing on the panel: the stations are one grouped
  // list now (`ui/actions.ts`) and the voyage owns every one of their verbs.
};
