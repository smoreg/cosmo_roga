import { describe, it, expect } from "vitest";
import { ALERT, alertState, raiseAlert } from "../src/systems/alert.js";
import { FORTNIGHT2 } from "../src/content/pack.js";
import { Game, replay } from "@jamrog/engine";
import { DEFAULT_MAPGEN, generateLevel, distanceField } from "@jamrog/engine";
import { DIRS8, Rng, Tile, chebyshev, isAlive } from "@jamrog/engine";
import type { Command, ContentPack, MonsterKind } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";

/**
 * A machine that never gets a turn: speed 1 against the player's 100 means it
 * acts once per hundred player turns, and it cannot see. Measuring the alert
 * clock needs reinforcements that arrive and then hold still — otherwise every
 * assertion about "exactly one more entity" is really an assertion about
 * pathfinding.
 */
const INERT: MonsterKind = {
  id: "inert",
  name: "inert hulk",
  ch: "h",
  fg: "#8b95a0",
  hp: 1,
  damage: [1, 1, 0],
  defense: 0,
  speed: 1,
  fovRadius: 1,
  behaviour: "brute",
  minDepth: 1,
  maxDepth: 6,
  weight: 10,
};

/** The real game with an empty deck and harmless reinforcements. */
function quietPack(over: Partial<ContentPack> = {}): ContentPack {
  return { ...FORTNIGHT2, monsterBudget: () => 0, monstersForDepth: () => [INERT], ...over };
}

function newGame(seed: number, content: ContentPack = quietPack()): Game {
  return new Game({ seed, content, systems: [ALERT] });
}

function waitTurns(game: Game, n: number): void {
  for (let i = 0; i < n; i++) game.playerCommand({ kind: "wait" });
}

/** Walk downhill towards the stairs; fight only what stands in the way. */
function stepTowardsStairs(game: Game): Command {
  const adjacent = game.entities.find(
    (e) => e.id !== game.player.id && isAlive(e) && chebyshev(e.pos, game.player.pos) === 1,
  );
  if (adjacent) {
    return { kind: "attack", dx: adjacent.pos.x - game.player.pos.x, dy: adjacent.pos.y - game.player.pos.y };
  }

  let stairs: { x: number; y: number } | undefined;
  game.level.tiles.forEach((x, y, t) => {
    if (t === Tile.StairsDown) stairs = { x, y };
  });
  if (!stairs) return { kind: "wait" };
  if (game.player.pos.x === stairs.x && game.player.pos.y === stairs.y) return { kind: "descend" };

  const dist = distanceField(game.level, stairs);
  let best: Command = { kind: "wait" };
  let bestD = dist.get(game.player.pos.x, game.player.pos.y) ?? Infinity;
  for (const d of DIRS8) {
    const nd = dist.get(game.player.pos.x + d.x, game.player.pos.y + d.y);
    if (nd === undefined || nd < 0 || nd >= bestD) continue;
    bestD = nd;
    best = { kind: "move", dx: d.x, dy: d.y };
  }
  return best;
}

/** Play until the deck below is reached. */
function descendOnce(game: Game): void {
  const from = game.depth;
  for (let steps = 0; steps < 2000 && game.depth === from; steps++) {
    const out = game.playerCommand(stepTowardsStairs(game));
    if (!out.ok) game.playerCommand({ kind: "wait" });
  }
  expect(game.depth, "never reached the deck below").toBe(from + 1);
}

describe("the deck alert is a clock", () => {
  it("raises every 80 turns on deck 1 and brings exactly one machine", () => {
    const game = newGame(4242);
    const st = alertState(game);
    const before = game.entities.length;

    waitTurns(game, 79);
    expect(st.turnsOnDeck).toBe(79);
    expect(st.level).toBe(0);
    expect(game.entities.length).toBe(before);

    waitTurns(game, 1);
    expect(st.level).toBe(1);
    expect(game.entities.length).toBe(before + 1);
  });

  it("raises every 40 turns from deck 2 on", () => {
    const game = newGame(515);
    descendOnce(game);
    const st = alertState(game);
    expect(game.depth).toBe(2);
    expect(st.level).toBe(0);

    const before = game.entities.length;
    while (st.turnsOnDeck < 39) game.playerCommand({ kind: "wait" });
    expect(st.level).toBe(0);
    expect(game.entities.length).toBe(before);

    game.playerCommand({ kind: "wait" });
    expect(st.turnsOnDeck).toBe(40);
    expect(st.level).toBe(1);
    expect(game.entities.length).toBe(before + 1);
  });

  it("descending resets the gauge", () => {
    const game = newGame(818);
    raiseAlert(game);
    raiseAlert(game);
    expect(alertState(game).level).toBe(2);

    descendOnce(game);
    const st = alertState(game);
    expect(st.level).toBe(0);
    expect(st.turnsOnDeck).toBeLessThan(40);
    expect(st.lastNoiseBump).toBeLessThanOrEqual(0);
  });
});

describe("noise raises the alert, but not more than once per ten turns", () => {
  it("a loud turn counts, a second one three turns later does not", () => {
    const game = newGame(99);
    const st = alertState(game);

    game.makeNoise(game.player.pos, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsOnDeck).toBe(1);
    expect(st.level).toBe(1);

    waitTurns(game, 2);
    game.makeNoise(game.player.pos, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsOnDeck).toBe(4);
    expect(st.level, "inside the cooldown").toBe(1);

    waitTurns(game, 6);
    game.makeNoise(game.player.pos, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsOnDeck).toBe(11);
    expect(st.level, "cooldown expired").toBe(2);
  });

  it("a quiet turn never counts", () => {
    const game = newGame(1010);
    game.makeNoise(game.player.pos, 7);
    game.playerCommand({ kind: "wait" });
    expect(alertState(game).level).toBe(0);
  });
});

describe("reinforcements are placed safely", () => {
  it("never within 10 tiles, never in a wall, never on an occupied tile (500 raises)", () => {
    let raises = 0;

    for (let s = 0; s < 100; s++) {
      const seed = 900000 + s;
      const depth = 1 + (s % 6);
      const game = newGame(seed, { ...FORTNIGHT2, monsterBudget: () => 0 });
      // Reinforcements are placed on whatever deck is current; swapping the
      // level in covers all six depths without walking down to them.
      const gen = generateLevel(depth, new Rng(seed), { ...DEFAULT_MAPGEN, vaults: FORTNIGHT2.vaults, vaultCount: 0 });
      game.level = gen.level;
      game.depth = depth;
      game.player.pos = { ...gen.entry };

      for (let i = 0; i < 5; i++) {
        const before = game.entities.length;
        const occupied = new Set(game.entities.map((e) => `${e.pos.x},${e.pos.y}`));

        raiseAlert(game);

        expect(game.entities.length, `seed ${seed} depth ${depth}: no reinforcement`).toBe(before + 1);
        raises++;
        const m = game.entities[game.entities.length - 1]!;
        const where = `seed ${seed} depth ${depth} at ${m.pos.x},${m.pos.y}`;
        expect(chebyshev(m.pos, game.player.pos), `${where}: too close`).toBeGreaterThanOrEqual(10);
        expect(game.level.isWalkable(m.pos.x, m.pos.y), `${where}: not walkable`).toBe(true);
        expect(occupied.has(`${m.pos.x},${m.pos.y}`), `${where}: tile taken`).toBe(false);
      }
    }

    expect(raises).toBe(500);
  });

  it("skips the reinforcement when nowhere is far enough, without throwing", () => {
    const game = newGame(7);
    // A room whose farthest corner is 3 tiles away: spawnSpots comes back empty.
    game.level = fromAscii([
      "#######",
      "#.....#",
      "#.....#",
      "#.....#",
      "#######",
    ]).level;
    game.player.pos = { x: 3, y: 2 };

    const before = game.entities.length;
    expect(() => raiseAlert(game)).not.toThrow();
    expect(game.entities.length).toBe(before);
    expect(alertState(game).level, "the gauge still moves").toBe(1);
  });

  it("logs where the machine woke up", () => {
    const game = newGame(2024);
    raiseAlert(game);
    const line = game.log.lines[game.log.lines.length - 1]!;
    expect(line.text).toMatch(/^Something wakes up (in .+|somewhere on the deck)\.$/);
  });
});

/**
 * A machine that walks and does not stop: the opposite of INERT above. It sees
 * one tile, so nothing but the standing order the alert hands it can bring it
 * across the deck — which is exactly the property under test.
 */
const DISPATCHED: MonsterKind = {
  id: "dispatched",
  name: "dispatched unit",
  ch: "u",
  fg: "#8b95a0",
  hp: 40,
  damage: [1, 1, 0],
  defense: 0,
  speed: 100,
  fovRadius: 1,
  behaviour: "brute",
  minDepth: 1,
  maxDepth: 6,
  weight: 10,
};

describe("reinforcements arrive", () => {
  /**
   * The G8 finding: on seeds 7 and 31337 the gauge reached 5/5, the log filled
   * with `Something wakes up…`, and not one machine reached the drone in 1500
   * turns. Reinforcements spawn at least 10 tiles away — further than any
   * machine can see — so without a standing order they simply stood there.
   */
  const BUDGET = 60;

  it("a woken machine reaches a standing drone within 60 turns, on 50 seeds", () => {
    const slow: string[] = [];
    let measured = 0;

    for (let s = 0; s < 50; s++) {
      const seed = 950000 + s;
      const game = newGame(seed, quietPack({ monstersForDepth: () => [DISPATCHED] }));
      raiseAlert(game);
      const machine = game.entities[game.entities.length - 1]!;
      expect(machine.name, `seed ${seed}: no reinforcement`).toBe(DISPATCHED.name);

      // Skipped: a deck that cannot be walked across at all (a mapgen property
      // tested elsewhere), and one where the walk is longer than the budget —
      // a machine crossing 80 tiles at one tile a turn is arriving on time, it
      // just is not arriving inside 60 turns.
      const dist = distanceField(game.level, game.player.pos);
      const reachable = dist.get(machine.pos.x, machine.pos.y);
      if (reachable === undefined || reachable < 0 || reachable > BUDGET) continue;
      measured++;

      let turns = 0;
      while (turns < BUDGET && chebyshev(machine.pos, game.player.pos) > 1 && game.status === "playing") {
        game.playerCommand({ kind: "wait" });
        turns++;
      }
      if (chebyshev(machine.pos, game.player.pos) > 1) {
        slow.push(`${seed} (path ${reachable}, still ${chebyshev(machine.pos, game.player.pos)} away)`);
      }
    }

    expect(measured, "too few decks put the machine inside the budget to measure").toBeGreaterThanOrEqual(40);
    expect(slow.join("\n"), "reinforcements never arrived").toBe("");
  });
});

describe("the top of the gauge", () => {
  it("never goes past 5 and keeps sending machines every 10 turns", () => {
    const game = newGame(31337);
    const st = alertState(game);
    for (let i = 0; i < 7; i++) raiseAlert(game);
    expect(st.level).toBe(5);
    expect(game.entities.length).toBe(8); // player + 7

    const before = game.entities.length;
    waitTurns(game, 9);
    expect(game.entities.length, "turn 9 is not due yet").toBe(before);

    waitTurns(game, 1);
    expect(st.turnsOnDeck).toBe(10);
    expect(st.level).toBe(5);
    expect(game.entities.length).toBe(before + 1);

    waitTurns(game, 10);
    expect(game.entities.length).toBe(before + 2);
  });

  it("does not double-spawn when both periods fall on the same turn", () => {
    const game = newGame(64064);
    const st = alertState(game);
    for (let i = 0; i < 5; i++) raiseAlert(game);
    expect(st.level).toBe(5);

    // Deck 1's own period is 80, which is also a multiple of 10.
    waitTurns(game, 79);
    const before = game.entities.length;
    waitTurns(game, 1);
    expect(st.turnsOnDeck).toBe(80);
    expect(game.entities.length).toBe(before + 1);
  });
});

describe("the gauge as the sidebar sees it", () => {
  it("fills up and changes colour at 3 and at 5", () => {
    const game = newGame(11);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▯▯▯▯▯" }]);

    raiseAlert(game);
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▯▯▯" }]);

    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▮▯▯", fg: "#d9b56a" }]);

    raiseAlert(game);
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▮▮▮", fg: "#d96a6a" }]);
  });
});

describe("the alert is replayable", () => {
  it("replay(seed, inputs) reproduces the run bit for bit", () => {
    // A drone that survives long enough for the alert to fire several times:
    // CORE 3 ends most runs before the first raise, which would prove nothing.
    const content: ContentPack = {
      ...FORTNIGHT2,
      makePlayer: (p) => {
        const e = FORTNIGHT2.makePlayer(p);
        e.hp = 400;
        e.hpMax = 400;
        return e;
      },
    };
    const cfg = { content, systems: [ALERT] };
    const seed = 1234;

    const game = new Game({ ...cfg, seed });
    for (let i = 0; i < 1200 && game.status === "playing"; i++) {
      const out = game.playerCommand(stepTowardsStairs(game));
      if (!out.ok) game.playerCommand({ kind: "wait" });
    }
    expect(game.inputs.length, "the run was too short to prove anything").toBeGreaterThan(300);
    expect(
      game.log.lines.some((l) => l.text.startsWith("Something wakes up")),
      "the run never triggered the alert, so it does not test it",
    ).toBe(true);

    const again = replay(seed, game.inputs, cfg);
    expect(snapshot(again)).toEqual(snapshot(game));
    expect(alertState(again).level).toBe(alertState(game).level);
  });
});

function snapshot(game: Game): unknown {
  return {
    depth: game.depth,
    status: game.status,
    kills: game.kills,
    time: game.schedule.time,
    alert: { ...alertState(game) },
    entities: game.entities.map((e) => `${e.name}@${e.pos.x},${e.pos.y}:${e.hp}`),
    log: game.log.lines.map((l) => l.text),
  };
}
