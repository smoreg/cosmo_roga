import { chebyshev, DIRS8, type Point } from "../sim/grid.js";
import { isAlive } from "../sim/entity.js";
import { hasStatus } from "../sim/status.js";
import { Tile } from "../sim/level.js";
import { DijkstraMap } from "../sim/dijkstra.js";
import { Rng } from "../sim/rng.js";
import type { Command } from "../sim/actions.js";
import type { Game } from "../sim/game.js";

/**
 * Bots that play the game, standing in for playtesters you do not have at 3am.
 *
 *   random   — the fuzz tester: proves nothing crashes
 *   greedy   — a first-time player: walks to the stairs, swings at whatever
 *              blocks the way. The floor of the difficulty curve.
 *   careful  — a competent player: retreats when hurt, fights in corridors and
 *              uses the game's own verbs when the game says they are worth it
 *              (`Twist.botHints`). The ceiling. If careful cannot win, nobody can.
 *
 * Comparing greedy's and careful's death depths is the cheapest balance signal
 * there is, and it runs in a second in CI.
 */
export type Bot = (game: Game, rng: Rng) => Command;
/**
 * Bots are created per run. Anything a bot remembers (how long it has been
 * retreating, say) must not leak between runs, or the harness stops measuring
 * the game and starts measuring the previous seed.
 */
export type BotFactory = () => Bot;

const ALL_DIRS: Command[] = DIRS8.map((d) => ({ kind: "move", dx: d.x, dy: d.y }));

export const randomBot: Bot = (_game, rng) => {
  const roll = rng.int(0, 11);
  if (roll === 0) return { kind: "wait" };
  if (roll === 1) return { kind: "descend" };
  // A game's own verbs get fuzzed too, slots that do not exist included: the
  // engine must refuse them without spending a turn and without throwing.
  if (roll === 2) return { kind: "interact" };
  if (roll === 3) return { kind: "use", slot: rng.int(0, 5) };
  return rng.pick(ALL_DIRS);
};

export const greedyBot: Bot = (game, rng) => {
  const adjacent = adjacentEnemy(game);
  if (adjacent) {
    return { kind: "attack", dx: adjacent.x - game.player.pos.x, dy: adjacent.y - game.player.pos.y };
  }
  const step = stepToStairs(game);
  if (!step) return rng.pick(ALL_DIRS);
  if (step === "descend") return { kind: "descend" };
  return { kind: "move", dx: step.x - game.player.pos.x, dy: step.y - game.player.pos.y };
};

/** Retreating forever is not skill, it is a livelock: cap it. */
const MAX_CONSECUTIVE_RETREATS = 8;

export function makeCarefulBot(): Bot {
  let retreats = 0;

  return (game, rng) => {
  // The game's own verbs go first, because they are the ones the engine cannot
  // judge: a welder that never welds and a wreck never salvaged leave careful
  // an expensive copy of greedy. `botHints` has already decided these are worth
  // a turn, so they are spent without second-guessing — one use per turn.
  const hints = botHints(game);
  const slot = hints.useSlots[0];
  if (slot !== undefined) return { kind: "use", slot };
  if (hints.interactWorthIt) return { kind: "interact" };

  const hurt = game.player.hp / Math.max(1, game.player.hpMax);
  const threats = visibleThreats(game);
  // The counter resets on a genuine escape, not merely on a turn spent
  // swinging: resetting per non-retreat turn let retreat/fight/retreat cycle
  // forever, which the harness reported as a stuck run.
  if (threats.length === 0) retreats = 0;

  // Badly hurt with enemies in sight: back off along a safety map — but only
  // for a while. With no healing in the game, endless kiting neither wins nor
  // loses, and a run that never ends teaches the harness nothing.
  if (hurt < 0.4 && threats.length > 0 && retreats < MAX_CONSECUTIVE_RETREATS) {
    const opts = { passable: (x: number, y: number) => walkableAndFree(game, x, y), topology: 8 as const };
    const threatMap = DijkstraMap.from(game.level.width, game.level.height, threats, opts);
    const step = threatMap.fleeMap(opts).bestStep(game.player.pos, opts);
    if (step) {
      retreats++;
      return { kind: "move", dx: step.x - game.player.pos.x, dy: step.y - game.player.pos.y };
    }
    // Cornered: fight.
  }

  const adjacent = adjacentEnemy(game);
  if (adjacent) {
    return { kind: "attack", dx: adjacent.x - game.player.pos.x, dy: adjacent.y - game.player.pos.y };
  }

  // Resting is only rational when something actually restores HP. Waiting for
  // a regeneration the game does not have is how this bot used to livelock on
  // 19 seeds out of 24 — a real finding from the balance harness, kept here as
  // a comment because the same trap awaits the first "rest" mechanic added.
  if (hurt < 0.5 && threats.length === 0 && game.player.hp < game.player.hpMax && hasStatus(game.player, "regen")) {
    return { kind: "wait" };
  }

  return greedyBot(game, rng);
  };
}

export const BOTS: Record<string, BotFactory> = {
  random: () => randomBot,
  greedy: () => greedyBot,
  careful: makeCarefulBot,
};

/**
 * Ask every system what is worth a turn. A game without the hook answers
 * nothing, and careful falls back to the moves the engine understands.
 */
function botHints(game: Game): { interactWorthIt: boolean; useSlots: number[] } {
  let interactWorthIt = false;
  const useSlots: number[] = [];
  for (const sys of game.systems) {
    const hint = sys.botHints?.(game);
    if (!hint) continue;
    interactWorthIt ||= hint.interactWorthIt;
    useSlots.push(...hint.useSlots);
  }
  return { interactWorthIt, useSlots };
}

function adjacentEnemy(game: Game): Point | undefined {
  const e = game.entities.find(
    (m) => m.id !== game.player.id && isAlive(m) && chebyshev(m.pos, game.player.pos) === 1,
  );
  return e?.pos;
}

function visibleThreats(game: Game): Point[] {
  return game.entities
    .filter((e) => e.id !== game.player.id && isAlive(e) && game.level.visible.get(e.pos.x, e.pos.y) === true)
    .map((e) => e.pos);
}

function walkableAndFree(game: Game, x: number, y: number): boolean {
  if (!game.level.isWalkable(x, y)) return false;
  const occupant = game.entities.find((e) => isAlive(e) && e.pos.x === x && e.pos.y === y);
  return occupant === undefined || occupant.id === game.player.id;
}

function stepToStairs(game: Game): Point | "descend" | undefined {
  const stairs = findStairs(game);
  if (!stairs) return undefined;
  if (game.player.pos.x === stairs.x && game.player.pos.y === stairs.y) return "descend";

  const opts = { passable: (x: number, y: number) => game.level.isWalkable(x, y), topology: 8 as const };
  const map = DijkstraMap.from(game.level.width, game.level.height, [stairs], opts);
  return map.bestStep(game.player.pos, opts);
}

function findStairs(game: Game): Point | undefined {
  let found: Point | undefined;
  game.level.tiles.forEach((x, y, t) => {
    if (t === Tile.StairsDown) found = { x, y };
  });
  return found;
}
