import { describe, it, expect } from "vitest";
import {
  DIRS8,
  DijkstraMap,
  Rng,
  chebyshev,
  distanceField,
  isAlive,
  replay,
  type Command,
  type Game,
  type Point,
} from "@jamrog/engine";
import { BOTS, fromAscii } from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { HINTS } from "../src/content/modules.js";
import { TITLE_LINES } from "../src/ui/input.js";
import { RIG, addWreck, deckOf, findSlot, rigOf } from "../src/twist/rig.js";

/**
 * Deck 1 is the tutorial, and the tutorial is the deck itself: no text screen,
 * no scripted steps (design-doc.md, "Онбординг"). So what is testable is what
 * the deck makes happen — a machine and a salvage pile in front of a
 * first-time player inside the first forty turns, on every seed.
 *
 * The other half of onboarding is four log lines. The only thing that can go
 * wrong with them is repetition: a hint said twice is noise, and noise is what
 * a player learns to skip.
 */

/** How long a player is given to meet the deck before it stops being an excuse. */
const WINDOW = 40;
const SEEDS = 200;
const FIRST_SEED = 900000;

// ------------------------------------------------------------ a first-timer

/**
 * A player who has read nothing: swings at whatever is next to it, walks over
 * to salvage it can see a use for, and otherwise opens the deck up. It never
 * takes the hatch — the question here is what deck 1 shows in forty turns, and
 * a drone that already left has been shown nothing.
 */
function firstTimerStep(game: Game, greedy: Command, rng: Rng): Command {
  if (greedy.kind === "attack") return greedy;

  const rig = rigOf(game.player);
  const wreck = nearestWreck(game);
  if (rig && wreck && rig.slots.some((s) => s === null)) {
    if (chebyshev(wreck, game.player.pos) <= 1) return { kind: "interact" };
    const step = stepTowards(game, [wreck]);
    if (step) return step;
  }

  const goals: Point[] = [];
  game.level.tiles.forEach((x, y) => {
    if (game.level.isWalkable(x, y) && game.level.explored.get(x, y) !== true) goals.push({ x, y });
  });
  const explore = goals.length > 0 ? stepTowards(game, goals) : undefined;
  if (explore) return explore;

  const d = rng.pick(DIRS8);
  return { kind: "move", dx: d.x, dy: d.y };
}

function stepTowards(game: Game, goals: Point[]): Command | undefined {
  const opts = { passable: (x: number, y: number) => game.level.isWalkable(x, y), topology: 8 as const };
  const step = DijkstraMap.from(game.level.width, game.level.height, goals, opts).bestStep(game.player.pos, opts);
  if (!step) return undefined;
  return { kind: "move", dx: step.x - game.player.pos.x, dy: step.y - game.player.pos.y };
}

function nearestWreck(game: Game): Point | undefined {
  let best: Point | undefined;
  let bestD = Infinity;
  for (const w of deckOf(game).wrecks) {
    const d = chebyshev({ x: w.x, y: w.y }, game.player.pos);
    if (d < bestD) {
      bestD = d;
      best = { x: w.x, y: w.y };
    }
  }
  return best;
}

// -------------------------------------------------------------- what it saw

interface Window {
  /** A machine was on screen at least once. */
  sawMachine: boolean;
  /** A machine stood next to the drone: the fight was offered, not just shown. */
  metMachine: boolean;
  /** Salvage was within the reach of `g`. */
  reachedScrap: boolean;
  /** The rack took a blow — the twist, demonstrated rather than described. */
  tookAHit: boolean;
}

function playDeckOne(seed: number): Window {
  const game = newGame(seed);
  const greedy = BOTS.greedy!();
  const rng = new Rng(seed);
  const seen: Window = { sawMachine: false, metMachine: false, reachedScrap: false, tookAHit: false };
  let integrity = rackIntegrity(game);

  for (let turn = 0; turn < WINDOW && game.status === "playing" && game.depth === 1; turn++) {
    // Look before the command as well as after it. A machine standing next to
    // the drone is a machine the drone is about to kill, and the engine reaps
    // the dead before the next line of this loop ever sees them — sampling
    // only afterwards reported the shortest first fights as no fight at all.
    note(game, seen);
    const kills = game.kills;
    const out = game.playerCommand(firstTimerStep(game, greedy(game, rng), rng));
    if (!out.ok) game.playerCommand({ kind: "wait" });
    note(game, seen);
    if (game.kills > kills) {
      seen.sawMachine = true;
      seen.metMachine = true;
    }

    // A blow is the only thing that takes integrity off the rack: salvaging
    // adds a module, and nothing on deck 1 mends one.
    const now = rackIntegrity(game);
    if (now < integrity) seen.tookAHit = true;
    integrity = now;
  }
  return seen;
}

/** What is on screen and what is next to the drone, right now. */
function note(game: Game, seen: Window): void {
  for (const e of game.entities) {
    if (e.id === game.player.id || !isAlive(e)) continue;
    if (game.level.visible.get(e.pos.x, e.pos.y) === true) seen.sawMachine = true;
    if (chebyshev(e.pos, game.player.pos) === 1) seen.metMachine = true;
  }
  if (withinReachOfScrap(game)) seen.reachedScrap = true;
}

/** Integrity standing in the rack right now, across every intact module. */
function rackIntegrity(game: Game): number {
  const rig = rigOf(game.player);
  if (!rig) return 0;
  return rig.slots.reduce((sum, slot) => sum + (slot?.integrity ?? 0), 0);
}

/** Salvage under the drone or beside it — the range `g` reaches. */
function withinReachOfScrap(game: Game): boolean {
  return deckOf(game).wrecks.some((w) => chebyshev({ x: w.x, y: w.y }, game.player.pos) <= 1);
}

// -------------------------------------------------------------------- tests

describe("deck 1 teaches by construction", () => {
  it("always starts one machine and salvage within a few steps of the airlock", () => {
    const failures: string[] = [];

    for (let s = 0; s < SEEDS; s++) {
      const seed = FIRST_SEED + s;
      const game = newGame(seed);
      const machines = game.entities.filter((e) => e.id !== game.player.id && isAlive(e));
      if (machines.length === 0) failures.push(`seed ${seed}: no machine on deck 1`);

      // Walking distance, not chebyshev: a pile behind a wall teaches nothing.
      const dist = distanceField(game.level, game.player.pos);
      const near = deckOf(game).wrecks.some((w) => {
        const d = dist.get(w.x, w.y);
        return d !== undefined && d >= 0 && d <= 4;
      });
      if (!near) failures.push(`seed ${seed}: no salvage within four steps of the drone`);
    }

    expect(failures.slice(0, 10).join("\n")).toBe("");
  }, 60_000);

  it("shows a first-time player a machine and salvage inside 40 turns, on 200 seeds", () => {
    const blind: number[] = [];
    const dry: number[] = [];
    let met = 0;
    let hit = 0;

    for (let s = 0; s < SEEDS; s++) {
      const seed = FIRST_SEED + s;
      const played = playDeckOne(seed);
      if (!played.sawMachine) blind.push(seed);
      if (!played.reachedScrap) dry.push(seed);
      if (played.metMachine) met++;
      if (played.tookAHit) hit++;
    }

    // The onboarding signal, printed on every run: read it on balance day.
    console.log(
      `deck 1 in ${WINDOW} turns: saw a machine ${SEEDS - blind.length}/${SEEDS}, ` +
        `met one ${met}/${SEEDS}, reached scrap ${SEEDS - dry.length}/${SEEDS}, took a blow ${hit}/${SEEDS}`,
    );

    // Salvage is the half deck 1 can promise outright: the docking bay card
    // puts a pile beside the airlock and the populate pass guarantees one when
    // the card's roll did not.
    expect(dry, `salvage never came within reach of g: seeds ${dry.join(", ")}`).toEqual([]);

    // The fight cannot be promised the same way, and the reason is a hard
    // constraint rather than a missing knob: a hunting machine finds the drone
    // on 198 seeds of 200, and the only content lever that closes the last two
    // is a third machine on deck 1 — which puts the autopilot back to dying
    // there and takes winnable.test.ts red with it. A blow, in turn, only
    // lands when the player fails to kill a 3 HP machine before it swings,
    // which the opening CUTTER often does. So these are floors under the
    // measured numbers, and they catch a deck 1 that stopped offering the
    // fight at all: 198/200 found, 198/200 met, 124/200 hit.
    expect(blind.length, `nothing found the drone on seeds ${blind.join(", ")}`).toBeLessThanOrEqual(4);
    expect(met, "deck 1 stopped bringing a machine within reach").toBeGreaterThanOrEqual(196);
    expect(hit, "deck 1 stopped demonstrating the damage rule").toBeGreaterThanOrEqual(60);
  }, 120_000);
});

describe("the hints are said once", () => {
  /** Every hint the game can say, in the words the player reads. */
  const ALL_HINTS = Object.values(HINTS);

  it("no hint is ever repeated in a run", () => {
    for (let s = 0; s < 20; s++) {
      const seed = 910000 + s;
      const game = newGame(seed);
      const said = countLines(game);
      const greedy = BOTS.greedy!();
      const rng = new Rng(seed);

      for (let turn = 0; turn < 300 && game.status === "playing"; turn++) {
        const out = game.playerCommand(greedy(game, rng));
        if (!out.ok) game.playerCommand({ kind: "wait" });
      }

      for (const text of ALL_HINTS) {
        expect(said.get(text) ?? 0, `seed ${seed} said "${text}" more than once`).toBeLessThanOrEqual(1);
      }
    }
  }, 120_000);

  /** A room, a drone and nothing else: every hint below is fired on purpose. */
  function bareGame(): Game {
    const game = newGame(31);
    const f = fromAscii(["#####", "#...#", "#.@.#", "#...#", "#####"]);
    game.level = f.level;
    game.entities = [game.player];
    game.player.pos = { ...f.player! };
    return game;
  }

  it("explains the damage rule on the first blow, and the empty slot on the first burn", () => {
    const game = bareGame();
    const said = countLines(game);

    RIG.onDamage!(game, game.player, 1, undefined);
    expect(said.get(HINTS.exposure) ?? 0).toBe(1);
    expect(said.get(HINTS.burned) ?? 0).toBe(0);

    // Enough to burn through PLATING and then some: the rack loses a module.
    RIG.onDamage!(game, game.player, 20, undefined);
    expect(said.get(HINTS.burned) ?? 0).toBe(1);

    RIG.onDamage!(game, game.player, 20, undefined);
    expect(said.get(HINTS.exposure) ?? 0).toBe(1);
    expect(said.get(HINTS.burned) ?? 0).toBe(1);
  });

  it("points at salvage the first turn it is in reach, and never again", () => {
    const game = bareGame();
    const said = countLines(game);

    RIG.afterPlayerTurn!(game, { kind: "wait" });
    expect(said.get(HINTS.scrap) ?? 0).toBe(0);

    addWreck(game, { x: game.player.pos.x + 1, y: game.player.pos.y }, "plating", 1);
    RIG.afterPlayerTurn!(game, { kind: "wait" });
    RIG.afterPlayerTurn!(game, { kind: "wait" });
    expect(said.get(HINTS.scrap) ?? 0).toBe(1);
  });

  it("says what a lost scanner costs, the turn it is lost", () => {
    const game = bareGame();
    const said = countLines(game);
    const rig = rigOf(game.player)!;

    RIG.afterPlayerTurn!(game, { kind: "wait" });
    expect(said.get(HINTS.blind) ?? 0).toBe(0);

    rig.slots[findSlot(rig, "scanner")!] = null;
    RIG.afterPlayerTurn!(game, { kind: "wait" });
    RIG.afterPlayerTurn!(game, { kind: "wait" });
    expect(said.get(HINTS.blind) ?? 0).toBe(1);
  });
});

/**
 * When a hint is said, not just whether. A line that arrives a turn late is a
 * line about something the player has already stopped looking at — the rule it
 * explains cost them something on the turn before, and the log has moved on.
 */
describe("the hints land on the turn the rule bites", () => {
  it("explains the damage rule on the same turn as the blow that proves it", () => {
    const wordy: string[] = [];
    for (let s = 0; s < 12; s++) {
      const seed = 920000 + s;
      const game = newGame(seed);
      const when = turnsSaid(game);
      const greedy = BOTS.greedy!();
      const rng = new Rng(seed);

      for (let turn = 0; turn < 200 && game.status === "playing"; turn++) {
        const out = game.playerCommand(greedy(game, rng));
        if (!out.ok) game.playerCommand({ kind: "wait" });
      }

      // The first blow that lands on a module and the line that explains it are
      // written by the same call: `hitLine` then `HINTS.exposure`.
      const firstHit = firstTurn(when, (text) => text.includes("hits your"));
      const explained = when.get(HINTS.exposure)?.[0];
      if (firstHit === undefined) continue; // Nothing touched the rack this run.
      if (explained !== firstHit) wordy.push(`seed ${seed}: hit on ${firstHit}, hint on ${explained}`);

      // Same for the first module lost: the burn line and the empty-slot hint.
      // THRUSTERS are the plural pair that "burns out" alone would miss.
      const firstBurn = firstTurn(when, (text) => /burns? out\./.test(text));
      const burnHint = when.get(HINTS.burned)?.[0];
      if (firstBurn !== undefined && burnHint !== firstBurn) {
        wordy.push(`seed ${seed}: burn on ${firstBurn}, hint on ${burnHint}`);
      }
    }
    expect(wordy.join("\n")).toBe("");
  }, 60_000);

  it("points at salvage on the turn it first comes into reach, not before", () => {
    const game = newGame(31);
    const f = fromAscii(["#####", "#...#", "#.@.#", "#...#", "#####"]);
    game.level = f.level;
    game.entities = [game.player];
    game.player.pos = { ...f.player! };
    const when = turnsSaid(game);

    // Three turns of nothing to salvage: the hint has no reason to exist yet.
    for (let i = 0; i < 3; i++) game.playerCommand({ kind: "wait" });
    expect(when.get(HINTS.scrap)).toBeUndefined();

    addWreck(game, { x: game.player.pos.x + 1, y: game.player.pos.y }, "plating", 1);
    const dropped = game.schedule.time;
    game.playerCommand({ kind: "wait" });
    expect(when.get(HINTS.scrap)).toEqual([dropped]);
  });

  it("says what a lost scanner costs on the turn it is lost", () => {
    const game = newGame(31);
    const f = fromAscii(["#####", "#...#", "#.@.#", "#...#", "#####"]);
    game.level = f.level;
    game.entities = [game.player];
    game.player.pos = { ...f.player! };
    const when = turnsSaid(game);
    const rig = rigOf(game.player)!;

    for (let i = 0; i < 3; i++) game.playerCommand({ kind: "wait" });
    expect(when.get(HINTS.blind)).toBeUndefined();

    rig.slots[findSlot(rig, "scanner")!] = null;
    const lost = game.schedule.time;
    game.playerCommand({ kind: "wait" });
    expect(when.get(HINTS.blind)).toEqual([lost]);
  });
});

describe("the title screen is UI only", () => {
  it("is six lines, names the keys and waits for one", () => {
    expect(TITLE_LINES).toHaveLength(6);
    expect(TITLE_LINES.some((l) => l.includes("g salvage"))).toBe(true);
    expect(TITLE_LINES[TITLE_LINES.length - 1]).toContain("any key to start");
  });

  it("does not touch the run: the same seed still replays bit for bit", () => {
    const seed = 900123;
    const game = newGame(seed);
    const greedy = BOTS.greedy!();
    const rng = new Rng(seed);
    const inputs: Command[] = [];

    for (let turn = 0; turn < 60 && game.status === "playing"; turn++) {
      const cmd = greedy(game, rng);
      inputs.push(cmd);
      game.playerCommand(cmd);
    }

    const again = replay(seed, inputs, GAME_CONFIG);
    expect(again.depth).toBe(game.depth);
    expect(again.schedule.time).toBe(game.schedule.time);
    expect(again.player.pos).toEqual(game.player.pos);
    expect(rigOf(again.player)).toEqual(rigOf(game.player));
  });
});

/**
 * Counts every line the game writes, by text. The log itself drops old lines
 * once it is full, so counting it afterwards would call an evicted hint "never
 * said" — the tap has to sit on `add`.
 */
/** The same tap, keeping the turn of every line instead of a count of them. */
function turnsSaid(game: Game): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  const log = game.log;
  const original = log.add.bind(log);
  log.add = (text, turn, tone) => {
    const turns = seen.get(text);
    if (turns) turns.push(turn);
    else seen.set(text, [turn]);
    original(text, turn, tone);
  };
  return seen;
}

/** The earliest turn any line matching `match` was written. */
function firstTurn(when: ReadonlyMap<string, number[]>, match: (text: string) => boolean): number | undefined {
  let earliest: number | undefined;
  for (const [text, turns] of when) {
    if (!match(text)) continue;
    for (const turn of turns) {
      if (earliest === undefined || turn < earliest) earliest = turn;
    }
  }
  return earliest;
}

function countLines(game: Game): Map<string, number> {
  const seen = new Map<string, number>();
  const log = game.log;
  const original = log.add.bind(log);
  log.add = (text, turn, tone) => {
    seen.set(text, (seen.get(text) ?? 0) + 1);
    original(text, turn, tone);
  };
  return seen;
}
