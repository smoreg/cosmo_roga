import { describe, it, expect } from "vitest";
import { Game } from "../src/sim/game.js";
import { LevelStore, levelSeed } from "../src/sim/levelstore.js";
import { Tile } from "../src/sim/level.js";
import type { Level } from "../src/sim/level.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";

/**
 * A level the player can walk back into is the one engine change the campaign
 * design rests on, so the tests are about identity, not about maps: the deck
 * that comes back has to be the deck that was left, down to the tile, the
 * explored mask, the corpses and the pocket the game wrote its own state into.
 */

const QUIET = { ...TEST_CONTENT, monstersForDepth: () => [], monsterBudget: () => 0 };

/** The whole tile grid as one string: the cheapest bit-for-bit comparison there is. */
function tileDump(level: Level): string {
  let out = "";
  level.tiles.forEach((_x, _y, t) => (out += String(t)));
  return out;
}

function exploredDump(level: Level): string {
  let out = "";
  level.explored.forEach((_x, _y, v) => (out += v ? "1" : "0"));
  return out;
}

describe("LevelStore", () => {
  it("stores, finds and reports what it holds", () => {
    const store = new LevelStore();
    expect(store.has("dock")).toBe(false);
    expect(store.get("dock")).toBeUndefined();

    const stored = { level: null, entities: [], scheduleSeed: 1, data: {}, gen: null, visits: 0 };
    store.put("dock", stored as never);
    expect(store.has("dock")).toBe(true);
    expect(store.get("dock")).toBe(stored);
    expect(store.size).toBe(1);
    expect(store.ids()).toEqual(["dock"]);
  });

  it("belongs to its game: a new run inherits nobody else's levels", () => {
    const first = new Game({ seed: 7, content: QUIET });
    first.travelTo("2", { depth: 2 });
    expect(first.levels.ids()).toEqual(["1", "2"]);

    const second = new Game({ seed: 7, content: QUIET });
    expect(second.levels.ids()).toEqual(["1"]);
  });

  it("derives a level's stream seed from the run and the id, without drawing one", () => {
    expect(levelSeed(4, "derelict-2/deck-1")).toBe(levelSeed(4, "derelict-2/deck-1"));
    expect(levelSeed(4, "a")).not.toBe(levelSeed(5, "a"));
    expect(levelSeed(4, "a")).not.toBe(levelSeed(4, "b"));

    // Naming a level differently must not move the run's own rng: two games
    // that travel the same shape end with the same numbers left in it.
    const named = new Game({ seed: 9, content: QUIET });
    named.travelTo("the-tug", { depth: 2 });
    const numbered = new Game({ seed: 9, content: QUIET });
    numbered.travelTo("2", { depth: 2 });
    expect(named.rng.state).toBe(numbered.rng.state);
  });
});

describe("returning to a level", () => {
  it("gives back the same map, explored mask, dead and data across 200 seeds", () => {
    const bad: string[] = [];

    for (let seed = 0; seed < 200; seed++) {
      const game = new Game({ seed, content: TEST_CONTENT });
      // Look around from the far end of the level: those tiles are explored
      // nowhere but in the stored mask, so a regenerated level loses them.
      const far = game.lastGen.stairs;
      game.player.pos = { ...far };
      game.refreshFov();
      game.player.pos = { ...game.lastGen.entry };

      const before = {
        tiles: tileDump(game.level),
        explored: exploredDump(game.level),
        ids: game.entities.map((e) => e.id).join(","),
      };
      // A run leaves marks: something died, something was recorded.
      const victim = game.entities.find((e) => e.id !== game.player.id);
      if (victim) {
        victim.hp = 0;
        victim.alive = false;
        game.reapDead();
      }
      game.currentLevel.data.taken = ["scrap"];
      const survivors = game.entities.filter((e) => e.id !== game.player.id).map((e) => e.id).join(",");

      game.travelTo("2", { depth: 2 });
      game.travelTo("1", { depth: 1 });

      const after = {
        tiles: tileDump(game.level),
        explored: exploredDump(game.level),
        ids: game.entities.filter((e) => e.id !== game.player.id).map((e) => e.id).join(","),
      };
      if (after.tiles !== before.tiles) bad.push(`seed ${seed}: the map changed`);
      // Explored only grows; every tile seen on the first visit is still seen.
      for (let i = 0; i < before.explored.length; i++) {
        if (before.explored[i] === "1" && after.explored[i] !== "1") {
          bad.push(`seed ${seed}: tile ${i} was explored and is not any more`);
          break;
        }
      }
      if (!game.level.explored.at(far.x, far.y)) bad.push(`seed ${seed}: the far end is unexplored again`);
      if (after.ids !== survivors) bad.push(`seed ${seed}: entities ${after.ids} != ${survivors}`);
      if (victim && game.entities.some((e) => e.id === victim.id)) bad.push(`seed ${seed}: the dead came back`);
      if (game.currentLevel.data.taken === undefined) bad.push(`seed ${seed}: the data pocket was cleared`);
      if (game.levels.size !== 2) bad.push(`seed ${seed}: ${game.levels.size} levels stored, expected 2`);
    }

    expect(bad.slice(0, 10).join("\n")).toBe("");
  }, 120000);

  it("does not repopulate: a cleared level stays cleared", () => {
    const game = new Game({ seed: 21, content: TEST_CONTENT });
    for (const e of game.entities) {
      if (e.id === game.player.id) continue;
      e.hp = 0;
      e.alive = false;
    }
    game.reapDead();
    expect(game.entities).toHaveLength(1);

    game.travelTo("2", { depth: 2 });
    expect(game.entities.length).toBeGreaterThan(1);
    game.travelTo("1", { depth: 1 });
    expect(game.entities).toHaveLength(1);
  });

  it("keeps the energy of everyone left behind", () => {
    const game = new Game({ seed: 22, content: TEST_CONTENT });
    const monster = game.entities.find((e) => e.id !== game.player.id)!;
    monster.energy = 37;

    game.travelTo("2", { depth: 2 });
    game.travelTo("1", { depth: 1 });
    expect(game.entities.find((e) => e.id === monster.id)!.energy).toBe(37);
  });

  it("lands the player on the entry by default and on the stairs when asked", () => {
    const game = new Game({ seed: 23, content: QUIET });
    const home = game.levels.get("1")!.gen;

    game.travelTo("2", { depth: 2 });
    game.travelTo("1", { depth: 1 });
    expect(game.player.pos).toEqual(home.entry);

    game.travelTo("2", { depth: 2 });
    game.travelTo("1", { depth: 1, entry: "stairs" });
    expect(game.player.pos).toEqual(home.stairs);
    expect(game.level.tiles.at(home.stairs.x, home.stairs.y)).toBe(Tile.StairsDown);
  });

  it("carries the player itself, with everything on it", () => {
    const game = new Game({ seed: 24, content: QUIET });
    const player = game.player;
    player.data = { credits: 12 };
    player.hp = 9;

    game.travelTo("2", { depth: 2 });
    game.travelTo("1", { depth: 1 });
    expect(game.player).toBe(player);
    expect(game.player.hp).toBe(9);
    expect(game.player.data).toEqual({ credits: 12 });
  });

  it("counts visits and hands the level's own pocket to the game", () => {
    const game = new Game({ seed: 25, content: QUIET });
    expect(game.currentLevel.visits).toBe(1);
    expect(game.currentLevel.data).toEqual({});

    game.travelTo("2", { depth: 2 });
    expect(game.currentLevel.visits).toBe(1);
    game.travelTo("1", { depth: 1 });
    expect(game.currentLevel.visits).toBe(2);
    expect(game.levels.get("2")!.visits).toBe(1);
  });

  it("runs the level hooks in order, with the reason for leaving", () => {
    const calls: string[] = [];
    const game = new Game({
      seed: 26,
      content: QUIET,
      twist: {
        name: "spy",
        onLevelEnter: (_g, depth) => void calls.push(`enter ${depth}`),
        beforeLevelLeave: (_g, depth, reason) => void calls.push(`leave ${depth} ${reason}`),
      },
    });

    game.travelTo("2", { depth: 2, reason: "airlock" });
    game.travelTo("1", { depth: 1 });
    expect(calls).toEqual(["enter 1", "leave 1 airlock", "enter 2", "leave 2 stairs", "enter 1"]);
  });
});
