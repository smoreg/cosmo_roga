import { describe, it, expect } from "vitest";
import { Game } from "../src/sim/game.js";
import { dealDamage } from "../src/sim/damage.js";
import { applyEffect, type EffectContext } from "../src/sim/effects.js";
import { applyStatus } from "../src/sim/status.js";
import { Faction, makeEntity, type Entity } from "../src/sim/entity.js";
import { Rng } from "../src/sim/rng.js";
import type { Twist } from "../src/sim/twist.js";
import type { Level } from "../src/sim/level.js";
import { fromAscii } from "../src/testing/fixtures.js";
import { TEST_CONTENT, TEST_MONSTERS, makeTestPlayer } from "../src/testing/dummycontent.js";
import { spawnMonster } from "../src/content/kinds.js";

function dummy(hp = 10): Entity {
  return makeEntity({
    name: "dummy", ch: "d", fg: "#888", pos: { x: 1, y: 1 }, faction: Faction.Monster,
    hp, hpMax: hp, damage: [1, 2, 0], defense: 0, speed: 100, fovRadius: 6, tags: [],
  });
}

/** A game on a hand-drawn map: the twist hooks are what the test is about. */
function gameOn(rows: string[], systems: Twist[]): Game {
  const game = new Game({
    seed: 7,
    content: { ...TEST_CONTENT, monstersForDepth: () => [], monsterBudget: () => 0 },
    twist: systems[0],
    systems: systems.slice(1),
  });
  const f = fromAscii(rows);
  game.level = f.level;
  game.entities = [game.player];
  game.player.pos = { ...f.player! };
  for (const m of f.marks) {
    const kind = TEST_MONSTERS.find((k) => k.ch === m.ch)!;
    const e = spawnMonster(kind, m.pos);
    game.schedule.admit(e);
    game.entities.push(e);
  }
  game.refreshFov();
  return game;
}

function absorbAll(name: string): Twist {
  return { name, onDamage: () => 0 };
}

describe("dealDamage", () => {
  it("with no systems behaves exactly like the old path: shield first, then hp", () => {
    const game = new Game({ seed: 1, content: TEST_CONTENT });
    const victim = dummy(10);
    applyStatus(victim, "shield", 9, 4);

    const res = dealDamage(game, victim, 6);
    expect(res).toEqual({ toHp: 2, absorbed: 4, intercepted: 0, killed: false });
    expect(victim.hp).toBe(8);
  });

  it("reports a kill and never leaves negative hit points", () => {
    const game = new Game({ seed: 1, content: TEST_CONTENT });
    const victim = dummy(3);
    const res = dealDamage(game, victim, 99);
    expect(res.killed).toBe(true);
    expect(victim.hp).toBe(0);
    expect(victim.alive).toBe(false);
  });

  it("a system returning 0 protects completely", () => {
    const game = new Game({ seed: 1, content: TEST_CONTENT, twist: absorbAll("wall") });
    const victim = dummy(10);

    const res = dealDamage(game, victim, 5);
    expect(victim.hp).toBe(10);
    expect(res.toHp).toBe(0);
    expect(res.intercepted).toBe(5);
    expect(res.killed).toBe(false);
  });

  it("chains systems: each one sees what the previous let through", () => {
    const seen: number[] = [];
    const eat = (n: number): Twist => ({
      name: `eat${n}`,
      onDamage: (_g, _v, amount) => {
        seen.push(amount);
        return Math.max(0, amount - n);
      },
    });
    const game = new Game({ seed: 1, content: TEST_CONTENT, twist: eat(2), systems: [eat(2)] });
    const victim = dummy(10);

    const res = dealDamage(game, victim, 5);
    expect(seen).toEqual([5, 3]);
    expect(res.toHp).toBe(1);
    expect(res.intercepted).toBe(4);
    expect(victim.hp).toBe(9);
  });

  it("passes the source and the victim to the hook", () => {
    const calls: Array<[string, string | undefined]> = [];
    const spy: Twist = {
      name: "spy",
      onDamage: (_g, victim, amount, source) => {
        calls.push([victim.name, source?.name]);
        return amount;
      },
    };
    const game = new Game({ seed: 1, content: TEST_CONTENT, twist: spy });
    const victim = dummy(10);
    const source = dummy(10);
    source.name = "attacker";

    dealDamage(game, victim, 1, source);
    dealDamage(game, victim, 1);
    expect(calls).toEqual([["dummy", "attacker"], ["dummy", undefined]]);
  });
});

describe("damage routed through the turn cycle", () => {
  it("a bump attack by the player goes through the hook", () => {
    const hits: string[] = [];
    const shield: Twist = {
      name: "shield",
      onDamage: (_g, victim, _amount, source) => {
        hits.push(`${source?.name} -> ${victim.name}`);
        return 0;
      },
    };
    const game = gameOn(["#####", "#@g.#", "#####"], [shield]);
    const monster = game.entities.find((e) => e.id !== game.player.id)!;
    const before = monster.hp;

    const out = game.playerCommand({ kind: "attack", dx: 1, dy: 0 });
    expect(out.ok).toBe(true);
    // The grunt swings back in the same turn; both blows take the same road.
    expect(hits).toEqual(["you -> grunt", "grunt -> you"]);
    expect(monster.hp).toBe(before);
  });

  it("a monster hitting the player goes through the hook too", () => {
    const game = gameOn(["#####", "#@g.#", "#####"], [absorbAll("plating")]);
    const before = game.player.hp;

    for (let i = 0; i < 5; i++) game.playerCommand({ kind: "wait" });
    expect(game.player.hp).toBe(before);
    expect(game.status).toBe("playing");
  });
});

describe("effect damage", () => {
  function ctxFor(level: Level, entities: Entity[]): EffectContext {
    return {
      level,
      entities,
      rng: new Rng(1),
      log: () => {},
      blocked: (x, y) => !level.isWalkable(x, y),
    };
  }

  it("uses ctx.damage when the game provides it", () => {
    const game = new Game({ seed: 1, content: TEST_CONTENT, twist: absorbAll("void") });
    const target = dummy(10);
    const ctx = ctxFor(game.level, [target]);
    ctx.damage = (t, raw, source) => dealDamage(game, t, raw, source);

    const out = applyEffect(ctx, undefined, target, { kind: "damage", dice: [1, 1, 5] });
    expect(out.damage).toBe(0);
    expect(target.hp).toBe(10);
  });

  it("falls back to shields and hit points without ctx.damage", () => {
    const game = new Game({ seed: 1, content: TEST_CONTENT, twist: absorbAll("void") });
    const target = dummy(10);
    const ctx = ctxFor(game.level, [target]);

    const out = applyEffect(ctx, undefined, target, { kind: "damage", dice: [1, 1, 5] });
    expect(out.damage).toBe(6);
    expect(target.hp).toBe(4);
  });

  it("still kills through ctx.damage, and says so once", () => {
    const game = new Game({ seed: 1, content: TEST_CONTENT });
    const target = makeTestPlayer({ x: 1, y: 1 });
    target.hp = 2;
    const ctx = ctxFor(game.level, [target]);
    ctx.damage = (t, raw, source) => dealDamage(game, t, raw, source);

    const out = applyEffect(ctx, undefined, target, { kind: "damage", dice: [1, 1, 9] });
    expect(out.killed).toEqual([target]);
    expect(target.hp).toBe(0);
    expect(out.notes.filter((n) => n.endsWith("dies")).length).toBe(1);
  });
});
