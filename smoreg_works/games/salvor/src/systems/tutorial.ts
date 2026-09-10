import type { RoomGame, System } from "@jamrog/engine";
import { classOfShip } from "../content/derelicts.js";
import { hint, saidHint } from "../content/hints.js";
import {
  TUTORIAL_ID,
  isTraining,
  stepDue,
  type TutorialSituation,
} from "../content/tutorial.js";
import { isTug } from "../content/tug.js";
import { currentDerelict, voyageOf } from "./voyage.js";
import { roomList, type ShipSystem } from "./populate.js";

/**
 * The training run's clock: seven lines, one at a time, each on the turn its
 * subject is first in front of the drone (docs/tasks/G69-tutorial.md).
 *
 * Inert in every other run. An ordinary voyage builds this system like all the
 * others and it returns on its first line — no roll, no log, no state written —
 * so the recordings in `tests/fixtures/voyage-*.json` and every balance number
 * are the same with it in the list as they were without it.
 *
 * A system rather than seven calls scattered through the files that own the
 * moments, and that is the opposite of how the five ordinary hints work
 * (`content/hints.ts`). The reason is the ordering: the ordinary lines are
 * independent — each is fired by the one file that owns its event, and any of
 * them may be the first a run ever hears. The chain is not. It is one sequence,
 * said in one order, and a sequence needs one reader; seven `if` statements in
 * six other systems would be the same order written down six times, and the
 * order would drift the first time one of those systems was edited by somebody
 * with a different question in mind.
 *
 * What it looks at is a `TutorialSituation` — eight booleans — and the decision
 * about which line is owed is `stepDue` in `content/tutorial.ts`. This file
 * holds no text and decides no order.
 */

/** Where the run remembers what turn the drone boarded the training hull on. */
const BOARDED_KEY = "tutorialBoarded";

export const TUTORIAL: System<RoomGame> = {
  name: "tutorial",

  /**
   * The boarding turn, remembered per ship, so `turnsAboard` counts from the
   * airlock and not from the start of the voyage. Written on every entry
   * including a second sortie into the same hull: the chain has almost always
   * moved past its first two lines by then, and a second boarding that reset
   * nothing would count the turns of the first one too.
   */
  onLevelEnter(game) {
    if (!isTraining(game.player) || !onTutorialHull(game)) return;
    game.currentShip.data[BOARDED_KEY] = game.schedule.time;
  },

  afterPlayerTurn(game) {
    if (game.status !== "playing" || !isTraining(game.player)) return;
    const step = stepDue(situation(game), (id) => saidHint(game.player, id));
    if (step !== undefined) hint(game, step.id);
  },
};

/** Is the drone standing on the hull the tutorial is about? */
function onTutorialHull(game: RoomGame): boolean {
  return !isTug(game) && classOfShip(game.ship) === TUTORIAL_ID;
}

/**
 * What the chain is allowed to know, read off the running game.
 *
 * Everything here is a question about *now* — where the drone is standing, what
 * it can see, what the account has been paid. Nothing is remembered but the
 * turn the sortie boarded on, because "once and in order" is the hint flags'
 * job and not this function's.
 */
function situation(game: RoomGame): TutorialSituation {
  const aboard = onTutorialHull(game);
  const room = game.roomOf(game.player);
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  const boarded = game.currentShip.data[BOARDED_KEY];

  return {
    aboard,
    turnsAboard: typeof boarded === "number" ? game.schedule.time - boarded : 0,
    // Anything that is not the drone, standing where the drone can see it: the
    // scout in the docking bay on the turn the sortie walks in on it, and a
    // machine two doors away through an open door just as well.
    contact:
      aboard &&
      game.entities.some(
        (e) => e.id !== game.player.id && e.room !== undefined && game.visible.has(e.room),
      ),
    lockedDoor: aboard && game.ship.doorsOf(room.id).some((d) => d.state === "locked"),
    system: aboard && roomList<ShipSystem>(room, "systems").length > 0,
    atAirlock: aboard && room.id === game.ship.entry,
    // Something to lose: credits in hand, or work done that only counts once
    // the drone is back out. Both are exactly what the airlock line is about.
    carrying: voyage.loot > 0 || state.online.length > 0,
    // Said on the tug, after the crossing that paid for the hull — which is the
    // one line of the chain whose moment is not aboard the ship at all.
    sold: state.spec.id === TUTORIAL_ID && state.sold,
  };
}
