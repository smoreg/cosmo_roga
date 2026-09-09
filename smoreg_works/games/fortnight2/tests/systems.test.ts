import { describe, it, expect } from "vitest";
import { FORTNIGHT2 } from "../src/content/pack.js";
import { Game } from "@jamrog/engine";
import type { Twist } from "@jamrog/engine";
import { modifiedStat, applyStatus, effectiveDefense } from "@jamrog/engine";
import { attack } from "@jamrog/engine";
import { Faction, makeEntity, resetIds, type Entity } from "@jamrog/engine";
import { Rng } from "@jamrog/engine";

function dummy(over: Partial<Entity> = {}): Entity {
  resetIds();
  return makeEntity({
    name: "t", ch: "t", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 30, hpMax: 30, damage: [1, 4, 2], defense: 3, speed: 100, fovRadius: 8,
    ...over,
  });
}

/**
 * Stat modifiers, generalised from prism's Condition/ConditionModifier split.
 * The point of the design is that a new modifier needs no new branch anywhere:
 * these tests pin that down for all four stats.
 */
describe("stat modifiers", () => {
  it("returns the base value with no statuses", () => {
    const e = dummy();
    expect(modifiedStat(e, "speed")).toBe(100);
    expect(modifiedStat(e, "fovRadius")).toBe(8);
    expect(modifiedStat(e, "defense")).toBe(3);
    expect(modifiedStat(e, "damageBonus")).toBe(2);
  });

  it("multipliers stack across statuses", () => {
    const e = dummy();
    applyStatus(e, "haste", 5);   // x2
    expect(modifiedStat(e, "speed")).toBe(200);
  });

  it("floors keep speed and sight usable, but let defense reach zero", () => {
    const e = dummy({ speed: 1, fovRadius: 1, defense: 0 });
    applyStatus(e, "slow", 5);
    applyStatus(e, "blind", 5);
    expect(modifiedStat(e, "speed")).toBeGreaterThanOrEqual(1);
    expect(modifiedStat(e, "fovRadius")).toBeGreaterThanOrEqual(1);
    expect(modifiedStat(e, "defense")).toBe(0);
  });

  it("an expired status stops modifying", () => {
    const e = dummy();
    applyStatus(e, "haste", 1);
    expect(modifiedStat(e, "speed")).toBe(200);
    for (const s of e.statuses ?? []) s.turns = 0;
    expect(modifiedStat(e, "speed")).toBe(100);
  });
});

describe("combat reads modified stats, not raw fields", () => {
  it("a shield absorbs before hit points and is reported separately", () => {
    const attacker = dummy({ damage: [1, 1, 9], defense: 0 });
    const defender = dummy({ hp: 20, defense: 0 });
    applyStatus(defender, "shield", 9, 4);

    const res = attack(attacker, defender, new Rng(1));
    expect(res.absorbed).toBe(4);
    expect(res.damage).toBe(6);
    expect(defender.hp).toBe(14);
  });

  it("defense comes from effectiveDefense, so a debuff would be honoured", () => {
    const defender = dummy({ defense: 3 });
    expect(effectiveDefense(defender)).toBe(3);
    const attacker = dummy({ damage: [1, 1, 10] });
    const res = attack(attacker, defender, new Rng(2));
    expect(res.damage).toBe(11 - 3);
  });

  it("damage never drops below 1 however high the defense", () => {
    const attacker = dummy({ damage: [1, 1, 0] });
    const defender = dummy({ defense: 999 });
    expect(attack(attacker, defender, new Rng(3)).damage).toBe(1);
  });
});

/**
 * Systems list, generalised from prism's SystemManager. The main twist is just
 * the first entry; smaller independent mechanics ride alongside instead of
 * being welded into game.ts.
 */
describe("systems", () => {
  function recorder(name: string, log: string[]): Twist {
    return {
      name,
      onRunStart: () => log.push(`${name}:start`),
      onLevelEnter: (_g, d) => log.push(`${name}:level${d}`),
      afterPlayerTurn: () => log.push(`${name}:player`),
      afterActorTurn: () => log.push(`${name}:actor`),
      onDeath: () => log.push(`${name}:death`),
      statusLine: () => `${name} ok`,
      overlayGlyphs: () => [{ x: 1, y: 1, ch: "*", fg: "#fff" }],
    };
  }

  it("runs the twist first, then every extra system", () => {
    const log: string[] = [];
    const game = new Game({ content: FORTNIGHT2, seed: 1, twist: recorder("twist", log), systems: [recorder("a", log), recorder("b", log)] });

    expect(log.filter((l) => l.endsWith(":start"))).toEqual(["twist:start", "a:start", "b:start"]);
    expect(log.some((l) => l === "twist:level1")).toBe(true);
    expect(log.some((l) => l === "b:level1")).toBe(true);
  });

  it("every system sees the player's turn", () => {
    const log: string[] = [];
    const game = new Game({ content: FORTNIGHT2, seed: 2, twist: recorder("twist", log), systems: [recorder("a", log)] });
    log.length = 0;
    game.playerCommand({ kind: "wait" });
    expect(log).toContain("twist:player");
    expect(log).toContain("a:player");
  });

  it("systems are exposed to the renderer in order", () => {
    const log: string[] = [];
    const game = new Game({ content: FORTNIGHT2, seed: 3, twist: recorder("twist", log), systems: [recorder("a", log)] });
    expect(game.systems.map((s) => s.name)).toEqual(["twist", "a"]);
    expect(game.systems.flatMap((s) => s.overlayGlyphs?.(game) ?? []).length).toBe(2);
  });

  it("a game with no twist and no systems still runs", () => {
    const game = new Game({ content: FORTNIGHT2, seed: 4 });
    expect(game.systems.length).toBe(1);
    expect(() => game.playerCommand({ kind: "wait" })).not.toThrow();
  });

  it("a system that only implements one hook is fine", () => {
    let deaths = 0;
    const counter: Twist = { name: "counter", onDeath: () => void deaths++ };
    const game = new Game({ content: FORTNIGHT2, seed: 5, systems: [counter] });
    const rng = new Rng(9);
    for (let i = 0; i < 300 && !game.isOver(); i++) {
      game.playerCommand(rng.pick([
        { kind: "move", dx: 1, dy: 0 }, { kind: "move", dx: -1, dy: 0 },
        { kind: "move", dx: 0, dy: 1 }, { kind: "move", dx: 0, dy: -1 },
      ] as const));
    }
    expect(deaths).toBe(game.kills + (game.status === "dead" ? 1 : 0));
  });
});
