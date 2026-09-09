import {
  DijkstraMap,
  Tile,
  chebyshev,
  exploreMap,
  key,
  label,
  type Command,
  type DijkstraOptions,
  type Entity,
  type Game,
  type Point,
} from "@jamrog/engine";
import { alertState } from "../systems/alert.js";
import { deckOf, rigOf, type Wreck } from "../twist/rig.js";

/**
 * Auto-explore and autofight — the two keys that keep a jam voter from quitting
 * in the second corridor, without taking a single decision away from them.
 *
 * `docs/traditional-checklist.md` calls automation that removes a tactical
 * decision an anti-pattern, and it is right. What makes DCSS's `o` legitimate
 * is not that it walks for you, it is that it stops the instant the situation
 * becomes a question: something in sight, something hurting you, the station
 * waking up. So the interesting half of this file is the stop list, not the
 * pathing — every step it does take is a step whose answer was already "walk
 * on", and every step it refuses to take is handed back to the player.
 *
 * No DOM and no randomness here: the timer that paces the loop lives in
 * `app.ts`, and every command below is a function of the game state, so a
 * recorded auto-explore replays exactly like a hand-played one.
 */

/** One decision: the next command, or the reason the run stops. */
export type AutoResult = { cmd: Command } | { stop: string };

export function isStop(result: AutoResult): result is { stop: string } {
  return "stop" in result;
}

/** Milliseconds between auto-explore steps. UI pacing only; the sim never sees it. */
export const AUTO_DELAY_MS = 40;

/** What the deck looked like at the previous step, to tell "new" from "still there". */
interface Seen {
  salvage: Set<number>;
  exits: Set<number>;
  /** Rig integrity plus CORE: any blow at all lowers this. */
  durability: number;
  alert: number;
}

export interface Explorer {
  /** One turn of auto-explore, or the reason to hand control back. */
  step(game: Game): AutoResult;
}

/**
 * An explore run. The state it keeps is exactly the "what changed" snapshot —
 * a stop like "new salvage in sight" is not a property of the current turn,
 * it is a difference between two of them.
 *
 * The first step takes the snapshot and reports no changes, which is what the
 * player means by pressing `o`: the wreck they are already looking at is not
 * news, the machine they are already looking at is.
 */
export function makeExplorer(): Explorer {
  let before: Seen | undefined;
  let walkedToHatch = false;

  return {
    step(game: Game): AutoResult {
      if (game.isOver()) return { stop: "The run is over." };

      const machine = nearestVisible(game);
      if (machine) return { stop: `You see ${label(game, machine)}.` };

      const salvage = visibleSalvage(game);
      const exits = visibleExits(game);
      const now: Seen = {
        salvage: new Set(salvage.map((w) => key(w.x, w.y))),
        exits: new Set(exits.map((e) => key(e.pos.x, e.pos.y))),
        durability: durability(game),
        alert: alertState(game).level,
      };
      const last = before;
      before = now;

      if (last) {
        if (now.durability < last.durability) return { stop: "Something is hitting you." };
        if (now.alert > last.alert) return { stop: "Alert rising." };

        const wreck = salvage.find((w) => !last.salvage.has(key(w.x, w.y)));
        if (wreck) return { stop: `Something here: ${salvageNoun(wreck)}.` };

        const exit = exits.find((e) => !last.exits.has(key(e.pos.x, e.pos.y)));
        if (exit) return { stop: exitLine(exit.tile) };
      }

      const opts = walkOptions(game);
      const map = exploreMap(game.level, game.player.pos, opts.passable);
      const step = map?.bestStep(game.player.pos, opts);
      if (step) return { cmd: stepTowards(game.player.pos, step) };

      // Nothing unseen left to reach: point the drone at the way down, take a
      // single step towards it, and give the deck back to the player.
      const hatch = knownHatch(game);
      if (!hatch) return { stop: "Nothing left to explore." };
      const where = `Deck explored. The hatch is ${bearing(game.player.pos, hatch)}.`;
      if (walkedToHatch) return { stop: where };
      const towards = pathStep(game, hatch, opts);
      if (!towards) return { stop: where };
      walkedToHatch = true;
      return { cmd: towards };
    },
  };
}

/**
 * One step of auto-explore with no memory of the previous one. Stops only on
 * what is true right now — a machine in sight, or a finished deck.
 */
export function exploreStep(game: Game): AutoResult {
  return makeExplorer().step(game);
}

/**
 * Autofight, DCSS-style and deliberately one turn deep: swing at an adjacent
 * machine, or take one step towards the nearest visible one. Never "fight
 * until one of us dies" — that is the version that decides the fight for the
 * player, and it is the version the checklist forbids.
 */
export function fightStep(game: Game): AutoResult {
  if (game.isOver()) return { stop: "The run is over." };

  const targets = visibleTargets(game);
  if (targets.length === 0) return { stop: "No target in sight." };

  const adjacent = targets.find((e) => chebyshev(game.player.pos, e.pos) === 1);
  if (adjacent) {
    return {
      cmd: {
        kind: "attack",
        dx: adjacent.pos.x - game.player.pos.x,
        dy: adjacent.pos.y - game.player.pos.y,
      },
    };
  }

  const opts = walkOptions(game);
  const step = pathStep(game, targets[0]!.pos, opts);
  return step ? { cmd: step } : { stop: "No way through." };
}

// ----------------------------------------------------------------- the deck

/**
 * Where the drone may put its chassis: a walkable tile with nothing standing
 * on it. Its own tile counts, or every map would start unreachable.
 */
function walkOptions(game: Game): DijkstraOptions {
  const self = game.player.pos;
  return {
    topology: 8,
    passable: (x, y) => {
      if (!game.level.isWalkable(x, y)) return false;
      if (x === self.x && y === self.y) return true;
      return game.monsterAt(x, y) === undefined;
    },
  };
}

/** One step of the cheapest route to `goal`, or undefined when there is none. */
function pathStep(game: Game, goal: Point, opts: DijkstraOptions): Command | undefined {
  const map = DijkstraMap.from(game.level.width, game.level.height, [goal], opts);
  const step = map.bestStep(game.player.pos, opts);
  return step ? stepTowards(game.player.pos, step) : undefined;
}

function stepTowards(from: Point, to: Point): Command {
  return { kind: "move", dx: to.x - from.x, dy: to.y - from.y };
}

/**
 * Visible living machines, nearest first. The id tie-break is what keeps two
 * machines at equal range from making the same seed play out two ways.
 */
function visibleTargets(game: Game): Entity[] {
  const self = game.player.pos;
  return game.visibleMonsters().sort((a, b) => {
    const d = chebyshev(self, a.pos) - chebyshev(self, b.pos);
    return d !== 0 ? d : a.id - b.id;
  });
}

function nearestVisible(game: Game): Entity | undefined {
  return visibleTargets(game)[0];
}

function visibleSalvage(game: Game): Wreck[] {
  return deckOf(game).wrecks.filter((w) => game.level.visible.get(w.x, w.y) === true);
}

/** `X` is a crate someone left; anything else is what a machine left behind. */
function salvageNoun(wreck: Wreck): string {
  return wreck.glyph === "X" ? "a parts crate" : "scrap";
}

interface Exit {
  pos: Point;
  tile: Tile;
}

/** Airlocks and the hatch: the two tiles worth interrupting a walk for. */
function visibleExits(game: Game): Exit[] {
  const out: Exit[] = [];
  game.level.tiles.forEach((x, y, tile) => {
    if (tile !== Tile.Airlock && tile !== Tile.StairsDown) return;
    if (game.level.visible.get(x, y) !== true) return;
    out.push({ pos: { x, y }, tile });
  });
  return out;
}

function exitLine(tile: Tile): string {
  return tile === Tile.StairsDown ? "The hatch is in sight." : "An airlock is in sight.";
}

/** The hatch, if the drone has ever seen it. */
function knownHatch(game: Game): Point | undefined {
  let found: Point | undefined;
  game.level.tiles.forEach((x, y, tile) => {
    if (found || tile !== Tile.StairsDown) return;
    if (game.level.explored.get(x, y) !== true) return;
    found = { x, y };
  });
  return found;
}

/** Rough compass bearing, for a log line that has to be read at a glance. */
function bearing(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "right here";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

/**
 * Everything a blow can take: the rack plus CORE. One number, because
 * auto-explore does not care what was hit, only that something was.
 */
function durability(game: Game): number {
  const rig = rigOf(game.player);
  const slots = rig ? rig.slots.reduce((sum, s) => sum + (s?.integrity ?? 0), 0) : 0;
  return slots + game.player.hp;
}
