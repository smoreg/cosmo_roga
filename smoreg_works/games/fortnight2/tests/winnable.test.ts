import { describe, it, expect } from "vitest";
import { newGame } from "../src/game.js";
import type { Game } from "@jamrog/engine";
import { distanceField } from "@jamrog/engine";
import { Tile } from "@jamrog/engine";
import { DIRS8, chebyshev } from "@jamrog/engine";
import { isAlive } from "@jamrog/engine";
import type { Command } from "@jamrog/engine";

/**
 * Autopilot: a bot that walks downhill on a BFS field towards the stairs and
 * descends. It proves the dungeon is actually traversable through the real turn
 * cycle — the cheapest possible guard against shipping a soft-locked level,
 * which is the worst thing that can happen to a Robustness score.
 *
 * It fights back when cornered but never retreats, so it plays about as well
 * as a first-time player mashing a direction key.
 */
function autopilotStep(game: Game): Command {
  // Kill whatever is already adjacent: a player who walks past monsters just
  // accumulates free hits on their own back.
  const adjacent = game.entities.find(
    (e) => e.id !== game.player.id && isAlive(e) && chebyshev(e.pos, game.player.pos) === 1,
  );
  if (adjacent) {
    return { kind: "attack", dx: adjacent.pos.x - game.player.pos.x, dy: adjacent.pos.y - game.player.pos.y };
  }

  const stairs = findStairs(game);
  if (!stairs) return { kind: "wait" };
  if (game.player.pos.x === stairs.x && game.player.pos.y === stairs.y) return { kind: "descend" };

  const dist = distanceField(game.level, stairs);
  const here = dist.get(game.player.pos.x, game.player.pos.y) ?? Infinity;

  let best: Command = { kind: "wait" };
  let bestD = here;
  for (const d of DIRS8) {
    const nx = game.player.pos.x + d.x;
    const ny = game.player.pos.y + d.y;
    const nd = dist.get(nx, ny);
    if (nd === undefined || nd < 0) continue;
    if (nd < bestD) {
      bestD = nd;
      best = { kind: "move", dx: d.x, dy: d.y };
    }
  }
  return best;
}

function findStairs(game: Game): { x: number; y: number } | undefined {
  let found: { x: number; y: number } | undefined;
  game.level.tiles.forEach((x, y, t) => {
    if (t === Tile.StairsDown) found = { x, y };
  });
  return found;
}

describe("the dungeon is traversable", () => {
  /**
   * The autopilot is the weakest player the game has to be beatable by: it
   * walks at the stairs, swings at whatever is in the way, and never salvages,
   * welds or retreats. One win in thirty seeds is the whole bar — the run has
   * to be survivable by someone who plays badly and gets lucky, or the game is
   * arithmetic and the careful bot's 15 % is measuring nothing.
   */
  it("an autopilot never gets stuck and always finds the stairs, on 30 seeds", () => {
    let wins = 0;
    let deaths = 0;
    const depths: Record<number, number> = {};

    for (let s = 0; s < 30; s++) {
      const game = newGame(s + 700000);
      let steps = 0;
      const maxSteps = 4000;

      while (game.status === "playing" && steps < maxSteps) {
        const out = game.playerCommand(autopilotStep(game));
        // A refused command with nowhere better to go: burn a turn instead of spinning.
        if (!out.ok) game.playerCommand({ kind: "wait" });
        steps++;
      }

      expect(steps, `seed ${s + 700000}: autopilot never finished (stuck?)`).toBeLessThan(maxSteps);
      depths[game.depth] = (depths[game.depth] ?? 0) + 1;
      if (game.status === "won") wins++;
      if (game.status === "dead") deaths++;
    }

    // Balance signal, printed on every run.
    console.log(`autopilot: ${wins} wins / ${deaths} deaths, final depth histogram:`, depths);
    // Every run must end in a real outcome, never by exhausting the step budget.
    expect(wins + deaths).toBe(30);
    expect(wins, "the autopilot never won — the game may be unwinnable").toBeGreaterThanOrEqual(1);
    // Descending at least once proves stairs are reachable through the live
    // turn cycle, not just in mapgen's own tests.
    expect(Number(Object.keys(depths).map(Number).sort((a, b) => a - b)[0]),
      "autopilot died on depth 1 on every seed — stairs unreachable in play").toBeGreaterThan(1);
  });
});
