import type { RoomGame } from "@jamrog/engine";
import { derelictName, flavourCallsign } from "../content/derelicts.js";
import { tugCallsign } from "../content/hints.js";
import { HULLS, hullName, hullTrait } from "../content/hulls.js";
import { OBJECTIVE_COUNT } from "../content/objectives.js";
import { t } from "../i18n.js";
import { currentDerelict, voyageOf } from "../systems/voyage.js";

/**
 * What stands where the schematic does while the drone is home.
 *
 * The tug used to be drawn as a ship — four boxes in a line — and then, once it
 * had a hull tied to it, as *that* hull's schematic instead, on the argument
 * that a map of your own four compartments tells you nothing. Both readings
 * were wrong in the same way: the window was showing a place while every other
 * part of the screen was talking about a decision, and with the derelict in it
 * the screen carried three different answers to "where am I" at once
 * (docs/tasks/G54-two-ships-confusion.md, 3).
 *
 * So at home the window stops being a map. It answers the four questions a
 * player standing on the tug actually has — whose ship is this, what is it tied
 * to, what state is that hull in, and what can I fly — and it says, in one
 * line, that this is the half of the game with no alert and no corridors
 * (docs/tasks/G53-tug-is-a-menu.md, 2).
 *
 * Text and nothing else: `ui/render.ts` draws these rows where it would have
 * drawn the schematic, so the board is a pure function under test like every
 * other part of the screen. The derelict's own map is not lost, it is simply no
 * longer the default — putting it back on an explicit command is G54's.
 */
export function tugBoard(game: RoomGame): string[] {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  // The alert belongs to the hull's own line — it is a fact about that ship —
  // and the count of systems is said exactly once, next to the thing it is
  // counted for. It used to be on two rows running, `quiet · 0/3 up` over
  // `NEUTRALISE 0/3 — …`, and one number twice on one screen is the defect the
  // panel of the derelict was taken apart for: a player reads both and looks
  // for a difference that is not there.
  const alert = state.alert === 0 ? t("panel.quiet") : t("panel.alertAt", { n: state.alert });
  const out = [
    t("banner.tug", { callsign: tugCallsign(game.seed), hull: flavourCallsign(state.flavour) }),
    "",
    t("board.derelict", { hull: derelictName(state.spec), alert }),
  ];

  // What raising the three is worth, and how far the voyage has got. The goal
  // of the run, in the words the panel uses for it out on the hull
  // (`panel.goal`), so home and field never name it differently.
  if (state.sold) out.push(t("panel.tow"));
  else out.push(t("board.worth", { up: state.online.length, of: OBJECTIVE_COUNT, price: state.spec.salePrice }));
  out.push(t("board.sorties", { n: voyage.sortie, lost: lostDrones(voyage.state) }));

  // The rack. Three hulls, their prices and the one thing each does better than
  // the other two: the choice a voyage is made of, and the one place on the
  // screen there is room to print it whole.
  out.push("", t("board.rack"));
  for (const hull of HULLS) {
    out.push(
      voyage.hull === hull.id
        ? ` ${t("board.hull.yours", { hull: hullName(hull) })}`
        : ` ${t("board.hull", { hull: hullName(hull), price: hull.price, trait: hullTrait(hull) })}`,
    );
  }

  out.push("", t("board.mode"));
  return out;
}

/** Drones lost over the whole voyage, off the record every hull keeps. */
function lostDrones(state: ReadonlyArray<{ deaths: readonly unknown[] }>): number {
  return state.reduce((n, s) => n + s.deaths.length, 0);
}
