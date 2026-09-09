import { DEFAULT_MAPGEN, DeckBuilder, Game, type GameConfig } from "@jamrog/engine";
import { FORTNIGHT2 } from "./content/pack.js";
import { deckPlan } from "./content/zones.js";
import { RIG } from "./twist/rig.js";
import { ALERT } from "./systems/alert.js";
import { POPULATE } from "./systems/populate.js";

/**
 * What a SALVOR run is made of, in one place.
 *
 * The UI and every test build games through here: a run created without the
 * twist is a different game, and two of those in one repo means replays and
 * balance numbers that quietly disagree.
 */
export const GAME_CONFIG: Omit<GameConfig, "seed"> = {
  content: FORTNIGHT2,
  twist: RIG,
  // POPULATE goes last: it reads the markers the deck's storylets drew, and it
  // must see both the wreck list RIG cleared and the machines already spawned.
  systems: [ALERT, POPULATE],
  mapgen: {
    ...DEFAULT_MAPGEN,
    builder: new DeckBuilder(deckPlan),
    // A deck already comes out connected through its airlocks; the global
    // region joiner would tunnel through a zone wall and undo exactly that.
    connect: false,
    // Storylets are stamped per sector by the builder, not by the pipeline.
    vaultCount: 0,
  },
};

export function newGame(seed: number): Game {
  return new Game({ ...GAME_CONFIG, seed });
}
