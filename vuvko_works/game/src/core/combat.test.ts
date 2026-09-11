import { describe, expect, it } from "vitest";
import { answeringWeapon, forecast, resolveExchange, strikeOrder } from "./combat";
import { createRng } from "./rng";
import { HIT_CHANCE, profileOf } from "./roster";
import type { Weapon } from "./types";

const WELDER: Weapon = { name: "welder", weaponClass: "melee", damage: 3, strikes: 1 };
const EMITTER: Weapon = { name: "emitter", weaponClass: "ranged", damage: 2, strikes: 2 };

describe("the answering weapon", () => {
  it("answers only in the attacker's class", () => {
    const scout = profileOf("scout").weapons;
    expect(answeringWeapon(scout, WELDER)?.name).toBe("claw");
    expect(answeringWeapon(scout, EMITTER)).toBeNull();
  });

  it("lets a sentinel answer either way", () => {
    const sentinel = profileOf("sentinel").weapons;
    expect(answeringWeapon(sentinel, WELDER)?.name).toBe("ram");
    expect(answeringWeapon(sentinel, EMITTER)?.name).toBe("arc");
  });
});

describe("strike order", () => {
  it("alternates, and lets the longer weapon finish alone", () => {
    expect(strikeOrder(1, 2)).toEqual(["attacker", "defender", "defender"]);
    expect(strikeOrder(3, 1)).toEqual(["attacker", "defender", "attacker", "attacker"]);
    expect(strikeOrder(2, 0)).toEqual(["attacker", "attacker"]);
  });
});

describe("the exchange", () => {
  it("takes no answer from a target with no weapon of that class", () => {
    const result = resolveExchange({
      attackerId: 1,
      attackerHp: 12,
      weapon: EMITTER,
      targetId: 2,
      targetHp: 4,
      targetIsObject: false,
      answering: null,
      rng: createRng("x"),
    });
    expect(result.attackerHp).toBe(12);
    const declared = result.events[0];
    expect(declared?.kind).toBe("attackDeclared");
  });

  it("is reproducible from the same seed and moves the cursor on", () => {
    const input = {
      attackerId: 1,
      attackerHp: 12,
      weapon: WELDER,
      targetId: 2,
      targetHp: 8,
      targetIsObject: false,
      answering: profileOf("sentinel").weapons[0] ?? null,
    };
    const first = resolveExchange({ ...input, rng: createRng("same") });
    const second = resolveExchange({ ...input, rng: createRng("same") });
    expect(second.targetHp).toBe(first.targetHp);
    expect(second.attackerHp).toBe(first.attackerHp);
    expect(first.rng.cursor).toBeGreaterThan(0);
  });

  it("stops the moment one side is down", () => {
    const result = resolveExchange({
      attackerId: 1,
      attackerHp: 1,
      weapon: { ...WELDER, strikes: 5 },
      targetId: 2,
      targetHp: 1,
      targetIsObject: false,
      answering: { name: "claw", weaponClass: "melee", damage: 4, strikes: 5 },
      rng: createRng("lethal"),
    });
    expect(Math.min(result.attackerHp, result.targetHp)).toBeLessThanOrEqual(0);
  });
});

describe("the forecast", () => {
  it("is a distribution that sums to one", () => {
    const f = forecast({ weapon: EMITTER, answering: null, attackerHp: 12, targetHp: 4 });
    const total = f.targetHpChances.reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("knows an unanswerable attack costs nothing", () => {
    const f = forecast({ weapon: EMITTER, answering: null, attackerHp: 12, targetHp: 4 });
    expect(f.expectedTaken).toBe(0);
    expect(f.chanceAttackerDies).toBe(0);
  });

  it("matches the hand-computed odds of killing a 4hp scout with 2x2", () => {
    // Two strikes of 2 at 75% each: the scout dies only if both land.
    const f = forecast({ weapon: EMITTER, answering: null, attackerHp: 12, targetHp: 4 });
    expect(f.chanceTargetDies).toBeCloseTo(HIT_CHANCE * HIT_CHANCE, 10);
    expect(f.expectedDealt).toBeCloseTo(2 * 2 * HIT_CHANCE, 10);
  });

  it("charges the attacker when the target can answer", () => {
    const answering = profileOf("sentinel").weapons[0] ?? null;
    const f = forecast({ weapon: WELDER, answering, attackerHp: 12, targetHp: 8 });
    expect(f.expectedTaken).toBeGreaterThan(0);
    const total = f.attackerHpChances.reduce((sum, p) => sum + p, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});
