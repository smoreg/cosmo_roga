import { describe, it, expect } from "vitest";
import { BEHAVIOURS, spawnMonster, type Entity, type Game } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";
import { MONSTERS, kindsForDepth, machineByName, monsterBudget } from "../src/content/monsters.js";
import { MODULES, type ModuleId } from "../src/content/modules.js";
import { rigOf, type Rig } from "../src/twist/rig.js";
import { FORTNIGHT2 } from "../src/content/pack.js";

/** Every deck of the run, so no test hard-codes the number. */
const DECKS = Array.from({ length: FORTNIGHT2.maxDepth }, (_, i) => i + 1);

/** Tile characters the map already spends, plus the player. A machine may use none of them. */
const RESERVED = ["#", ".", ">", "+", "%", "=", "|", "@"];

/**
 * A run on a hand-drawn deck: the map is replaced after the fact, but the game
 * is the real one `newGame` builds — same twist, same turn cycle, same routing.
 */
function gameOn(rows: string[], seed = 7): { game: Game; monsters: Entity[] } {
  const game = newGame(seed);
  const f = fromAscii(rows);
  game.level = f.level;
  game.entities = [game.player];
  game.player.pos = { ...f.player! };
  const monsters: Entity[] = [];
  for (const m of f.marks) {
    const kind = MONSTERS.find((k) => k.ch === m.ch);
    if (!kind) continue;
    const e = spawnMonster(kind, m.pos);
    game.schedule.admit(e);
    game.entities.push(e);
    monsters.push(e);
  }
  game.refreshFov();
  return { game, monsters };
}

/** Replace the rack wholesale: these tests care about routing, not about the loadout. */
function setRack(game: Game, rack: Array<[ModuleId, number] | null>): Rig {
  const rig = rigOf(game.player)!;
  for (let i = 0; i < rig.slots.length; i++) {
    const entry = rack[i];
    rig.slots[i] = entry ? { kind: entry[0], integrity: entry[1] } : null;
  }
  return rig;
}

/** Integrity per slot; -1 for an empty one, so a burn-out is visible as a change. */
function snapshot(rig: Rig): number[] {
  return rig.slots.map((s) => (s ? s.integrity : -1));
}

/**
 * Wait until the machine standing next to the drone lands one blow, and return
 * the rack before and after it. Nothing else moves: the drone only waits.
 */
function takeOneHit(game: Game, rig: Rig): { before: number[]; after: number[] } {
  for (let turn = 0; turn < 40; turn++) {
    const before = snapshot(rig);
    const hp = game.player.hp;
    game.playerCommand({ kind: "wait" });
    const after = snapshot(rig);
    if (after.some((v, i) => v !== before[i]) || game.player.hp !== hp) return { before, after };
  }
  throw new Error("the machine never attacked");
}

const DUEL = [
  "#######",
  "#.....#",
  "#.@X..#",
  "#.....#",
  "#######",
];

/** The duel map with `X` replaced by the machine under test. */
function duel(ch: string): string[] {
  return DUEL.map((row) => row.replace("X", ch));
}

describe("the bestiary", () => {
  /**
   * Deck 1 is deliberately outside this rule (G9): the tutorial deck holds one
   * kind, the scout, because a first fight that only happens when the player
   * walks into a slow patrol is a first fight half the seeds never have.
   * Variety starts where the run does — on deck 2.
   */
  it("offers at least two kinds on every deck below the tutorial deck", () => {
    expect(kindsForDepth(1).length, "deck 1 is the tutorial: one kind, nothing to roll").toBe(1);
    for (const depth of DECKS.filter((d) => d > 1)) {
      expect(kindsForDepth(depth).length, `deck ${depth} has too few kinds`).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every machine a module that exists", () => {
    for (const m of MONSTERS) {
      expect(m.salvage, `${m.id} salvages nothing`).toBeDefined();
      expect(MODULES[m.salvage!], `${m.id} salvages an unknown module`).toBeDefined();
    }
  });

  it("only asks the engine for behaviours it has", () => {
    for (const m of MONSTERS) {
      expect(Object.keys(BEHAVIOURS), `${m.id}: unknown behaviour`).toContain(m.behaviour);
    }
  });

  it("keeps every glyph unique and clear of the tiles", () => {
    const glyphs = MONSTERS.map((m) => m.ch);
    expect(new Set(glyphs).size, "two machines share a glyph").toBe(glyphs.length);
    for (const ch of glyphs) expect(RESERVED, `glyph '${ch}' is already a tile`).not.toContain(ch);
  });

  it("keeps ids, names and colours apart", () => {
    expect(new Set(MONSTERS.map((m) => m.id)).size).toBe(MONSTERS.length);
    // `machineByName` is the only link from a spawned entity back to its salvage.
    expect(new Set(MONSTERS.map((m) => m.name)).size).toBe(MONSTERS.length);
    expect(new Set(MONSTERS.map((m) => m.fg)).size).toBe(MONSTERS.length);
    for (const m of MONSTERS) expect(machineByName(m.name)).toBe(m);
  });

  it("stays inside its depth band and carries a spawn weight", () => {
    for (const m of MONSTERS) {
      expect(m.minDepth, `${m.id}: band starts off the station`).toBeGreaterThanOrEqual(1);
      expect(m.maxDepth, `${m.id}: band runs past the reactor`).toBeLessThanOrEqual(FORTNIGHT2.maxDepth);
      expect(m.minDepth).toBeLessThanOrEqual(m.maxDepth);
      expect(m.weight, `${m.id}: weight must be positive`).toBeGreaterThan(0);
    }
  });

  it("starts deck 1 light and never gets emptier as the station gets deeper", () => {
    // The shape, not the formula: repeating `4 + depth * 1.5` here only proved
    // the test could copy-paste, and it failed the first time a balance pass
    // changed the curve for a reason the shape still holds under.
    expect(monsterBudget(1), "deck 1 is onboarding").toBeLessThanOrEqual(3);
    expect(monsterBudget(2)).toBeGreaterThan(monsterBudget(1));
    let prev = monsterBudget(2);
    for (const depth of DECKS.slice(2)) {
      const here = monsterBudget(depth);
      expect(here, `deck ${depth} is emptier than deck ${depth - 1}`).toBeGreaterThanOrEqual(prev);
      prev = here;
    }
  });

  it("hands the twist the tags it routes damage by", () => {
    const { monsters } = gameOn(duel("x"));
    expect(monsters[0]!.tags).toContain("precise");
  });
});

describe("tagged machines break the routing rule", () => {
  it("a scrapper hits the weakest module, not the exposed one", () => {
    const { game } = gameOn(duel("x"));
    // Waiting exposes PLATING, in slot 0. The CUTTER is the weakest module and
    // deep enough that a 1d3 blow cannot burn it, so nothing spills.
    const rig = setRack(game, [["plating", 6], ["cutter", 4], null, null, null, null]);

    const { before, after } = takeOneHit(game, rig);

    expect(after[0], "the blow landed on the exposed PLATING").toBe(before[0]);
    expect(after[1], "the CUTTER took nothing").toBeLessThan(before[1]!);
    expect(game.player.hp, "damage reached CORE with the rack intact").toBe(game.player.hpMax);
  });

  it("an arc sentinel puts one point in every intact module", () => {
    const { game } = gameOn(duel("A"));
    const rig = setRack(game, [["plating", 6], ["cutter", 4], ["thrusters", 3], null, null, null]);

    const { before, after } = takeOneHit(game, rig);

    for (let i = 0; i < 3; i++) {
      expect(after[i], `slot ${i} did not take its single point`).toBe(before[i]! - 1);
    }
    expect(after.slice(3), "burst filled an empty slot").toEqual(before.slice(3));
    expect(game.player.hp, "burst reached CORE").toBe(game.player.hpMax);
  });
});
