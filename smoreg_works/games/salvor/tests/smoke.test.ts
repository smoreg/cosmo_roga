import { describe, it, expect } from "vitest";
import {
  BOTS_ROOMS,
  formatSummary,
  roomPlay,
  runBatchOn,
  seedRange,
  type BatchSummary,
} from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";

/**
 * The gate smoke: the whole game, exactly as it ships, driven by bots.
 *
 * Every other test in this package holds something still — a hand-drawn hull, a
 * rack written out by hand, the alert left out — so that what it measures is one
 * rule. This one holds nothing still: `newGame(seed)` is what the browser
 * builds, so a crash here is a crash a player would have had, and the table
 * below is the first derelict as a player meets it.
 */

/**
 * Long enough for the whole itinerary, which is what a voyage now is: the same
 * 1500 `balance.test.ts` and `winnable.test.ts` give it.
 *
 * It was 1200, which was long enough for a sortie, the tug and a second sortie
 * on a big freighter — the length of a run three passes ago. `stuck` counts a
 * run that reached no outcome inside the budget, and at 1200 the random bot hit
 * it on seed 21 by standing on the tug with 41 CR, no drone and `buy` two
 * compartments away: not a loop, a bot rolling dice, and it buys one and dies
 * inside 1500. Raising the budget is the honest fix; the threshold under it
 * stays zero.
 */
/** As in balance.test.ts: a careful voyage on the ten-rung ladder and the larger hulls can take 2550 steps to end (G90 A, B). */
const MAX_STEPS = 3000;

const SEEDS = seedRange(1, 32);

/**
 * One batch per bot for the whole file. A batch of a bot that survives a while
 * is thousands of turns of the real game, and three tests reading the same
 * table is three tests, not three runs.
 */
const batches = new Map<string, BatchSummary>();

function batch(name: string): BatchSummary {
  const done = batches.get(name);
  if (done) return done;

  const summary = runBatchOn(
    name,
    BOTS_ROOMS[name]!,
    SEEDS,
    roomPlay({ maxSteps: MAX_STEPS, make: (seed) => newGame(seed) }),
  );
  console.log(formatSummary(summary));
  batches.set(name, summary);
  return summary;
}

// Random input moved to `fuzz.test.ts` (G33), where the same two hundred runs
// of five hundred commands are also read for a negative balance, an entity
// aboard the wrong ship and a voyage record that would not survive a save file
// — and where a second batch with a floor under the account spends its whole
// budget instead of going broke a seventh of the way in. This file is the bots.

describe("the three bots on the first freighter", () => {
  it("every run of every bot reaches an outcome", () => {
    // `stuck` is not a score, it is a defect: the run neither won nor died in
    // 1200 commands, which means something aboard let the drone loop forever.
    // Zero of them is the one number of this file that is not negotiable.
    for (const name of ["random", "greedy", "careful"]) {
      const summary = batch(name);
      expect(summary.stuck, formatSummary(summary)).toBe(0);
    }
  });

  it("careful gets as far as the freighter lets it", () => {
    const summary = batch("careful");

    // `progress` is compartments of a *derelict* stood in, over every hull of
    // the voyage — so it counts a whole run and not one trip. Three passes have
    // moved it on these same 32 seeds:
    //
    //   v3-core gate      1.0   two populations on one hull, 12-15 machines
    //   one budget        4.0   `DerelictSpec.machines`, `systems/populate.ts`
    //   G30              10.0   the alert stopped spawning a patrol per step,
    //                           the bots learned to end a sortie, and the cost
    //                           of a fight came down (`content/modules.ts`)
    //   G30, second pass  12.5   the hunter comes at four rather than three, so
    //                           bringing a system online is no longer the same
    //                           thing as summoning one
    //   G41                9.0   the hold stopped paying more for a rack than a
    //                           hull costs, so "buy a drone and strip it" is no
    //                           longer +38 CR a cycle — and that cycle was what
    //                           funded these voyages. 11.0 over 100 seeds; the
    //                           threshold is what these 32 take, with a margin
    //   G30, third pass  13.5   the bot stopped pressing the DOCK's `undock` on
    //                           the turn it came home and walked the tug first,
    //                           so a voyage now signs 2.25 charters and buys the
    //                           jumps the itinerary is made of. 14.0 over 100
    //                           and over 200 seeds
    //   task/balance-3   20.0   the drone lives long enough to finish a hull:
    //                           four more integrity on each of the three modules
    //                           a sortie ends on, three on the CELL, the `+1`
    //                           off the hunter's die, and a bot that goes back
    //                           to a hull it has not finished instead of buying
    //                           the jump. This is the pass that took the win
    //
    // The win is not asserted here any more, and that is not the line moving.
    // A win is two or three voyages in a hundred, so on 32 seeds the count is a
    // coin toss on one seed rather than a threshold — it was 1 here and is 0
    // now, on a game that wins 5 of 200. It is asserted in `winnable.test.ts`
    // on a batch big enough to mean something, which is the file that owns the
    // acceptance line and carries the numbers. This one keeps what 32 seeds can
    // actually measure: that nothing loops, and how far the bot gets.
    expect(summary.medianProgress, formatSummary(summary)).toBeGreaterThanOrEqual(16);
  });

  it("greedy sweeps most of the hull", () => {
    // The floor of the curve, and the plainest reading of "the ship is a place
    // you can walk through": a bot that only fights what is in the room and
    // walks on should see most of a twelve-to-fourteen compartment freighter.
    //
    // 17.5 while a rack could be sold for more than the hull it came on: the
    // bot bought drones with the money and swept the ship again with each one.
    // 13.0 on one drone and what it carries (G41), and the bot no longer sells
    // the rack it is about to fly with (`testing/roombots.ts`). 14.0 after that:
    // the same walk on a rack that burns slower.
    //
    // 10.0 since G73, and the walk did not get shorter — the ship did. The
    // first hull of a run is drawn from five classes now and is seven to
    // fourteen compartments rather than always twelve to fourteen, so a bot
    // that sweeps *all* of a probe scores seven. What this number measures is
    // the hull it was flown on, so the threshold moves with the pool: the
    // distribution over 32 seeds runs 7 to 25 with eleven seeds at ten.
    const summary = batch("greedy");
    expect(summary.medianProgress, formatSummary(summary)).toBeGreaterThanOrEqual(9);
  });
});
