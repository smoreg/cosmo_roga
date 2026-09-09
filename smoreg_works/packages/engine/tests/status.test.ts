import { describe, it, expect } from "vitest";
import {
  applyStatus, clearStatus, hasStatus, tickStatuses, effectiveSpeed, effectiveFov,
  actionScrambled, absorbDamage, statusLine, statusMagnitude,
} from "../src/sim/status.js";
import { Faction, makeEntity, resetIds, type Entity } from "../src/sim/entity.js";
import { Rng } from "../src/sim/rng.js";

function dummy(overrides: Partial<Entity> = {}): Entity {
  resetIds();
  return makeEntity({
    name: "target", ch: "t", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 20, hpMax: 20, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 8,
    ...overrides,
  });
}

const rng = new Rng(1);

describe("status effects", () => {
  it("applies and expires after the given number of turns", () => {
    const e = dummy();
    applyStatus(e, "poison", 3, 1);
    expect(hasStatus(e, "poison")).toBe(true);
    tickStatuses(e, rng);
    tickStatuses(e, rng);
    expect(hasStatus(e, "poison")).toBe(true);
    const last = tickStatuses(e, rng);
    expect(hasStatus(e, "poison")).toBe(false);
    expect(last.expired).toContain("poison");
  });

  it("deals tick damage scaled by magnitude", () => {
    const e = dummy({ hp: 20 });
    applyStatus(e, "burn", 2, 3); // 2 base damage x3 magnitude
    tickStatuses(e, rng);
    expect(e.hp).toBe(14);
  });

  it("regen heals but never past the maximum", () => {
    const e = dummy({ hp: 19 });
    applyStatus(e, "regen", 5, 1);
    tickStatuses(e, rng);
    expect(e.hp).toBe(20);
    tickStatuses(e, rng);
    expect(e.hp).toBe(20);
  });

  it("kills the bearer when a tick takes the last hit point", () => {
    const e = dummy({ hp: 1 });
    applyStatus(e, "poison", 5, 1);
    tickStatuses(e, rng);
    expect(e.hp).toBe(0);
    expect(e.alive).toBe(false);
  });

  it("opposing statuses cancel instead of stacking", () => {
    const e = dummy();
    applyStatus(e, "haste", 5);
    const change = applyStatus(e, "slow", 5);
    expect(change.applied).toBe(false);
    expect(change.cancelled).toBe("haste");
    expect(hasStatus(e, "haste")).toBe(false);
    expect(hasStatus(e, "slow")).toBe(false);
  });

  it("re-applying refreshes duration and keeps the stronger magnitude", () => {
    const e = dummy();
    applyStatus(e, "poison", 2, 3);
    applyStatus(e, "poison", 6, 1);
    const s = (e.statuses ?? []).find((x) => x.kind === "poison")!;
    expect(s.turns).toBe(6);
    expect(s.magnitude).toBe(3);
  });

  it("changes derived speed and sight, and restores them on expiry", () => {
    const e = dummy({ speed: 100, fovRadius: 8 });
    expect(effectiveSpeed(e)).toBe(100);
    applyStatus(e, "haste", 1);
    expect(effectiveSpeed(e)).toBe(200);
    applyStatus(e, "blind", 1);
    expect(effectiveFov(e)).toBeLessThan(8);
    tickStatuses(e, rng);
    expect(effectiveSpeed(e)).toBe(100);
    expect(effectiveFov(e)).toBe(8);
  });

  it("never lets speed or sight drop below 1", () => {
    const e = dummy({ speed: 1, fovRadius: 1 });
    applyStatus(e, "slow", 3);
    applyStatus(e, "blind", 3);
    expect(effectiveSpeed(e)).toBeGreaterThanOrEqual(1);
    expect(effectiveFov(e)).toBeGreaterThanOrEqual(1);
  });

  it("stun and confusion scramble the action", () => {
    const e = dummy();
    expect(actionScrambled(e)).toBe(false);
    applyStatus(e, "stun", 2);
    expect(actionScrambled(e)).toBe(true);
  });

  describe("shield absorption", () => {
    it("eats damage before HP and wears out", () => {
      const e = dummy({ hp: 20 });
      applyStatus(e, "shield", 10, 5);
      const first = absorbDamage(e, 3);
      expect(first.absorbed).toBe(3);
      expect(first.toHp).toBe(0);
      expect(statusMagnitude(e, "shield")).toBe(2);

      const second = absorbDamage(e, 6);
      expect(second.absorbed).toBe(2);
      expect(second.toHp).toBe(4);
      expect(hasStatus(e, "shield")).toBe(false);
    });

    it("passes damage straight through with no shield", () => {
      const e = dummy();
      expect(absorbDamage(e, 7)).toEqual({ toHp: 7, absorbed: 0 });
    });
  });

  it("clearStatus removes one kind only", () => {
    const e = dummy();
    applyStatus(e, "poison", 5);
    applyStatus(e, "burn", 5);
    clearStatus(e, "poison");
    tickStatuses(e, rng);
    expect(hasStatus(e, "poison")).toBe(false);
    expect(hasStatus(e, "burn")).toBe(true);
  });

  it("statusLine reads as a compact HUD string", () => {
    const e = dummy();
    applyStatus(e, "poison", 3);
    applyStatus(e, "haste", 7);
    expect(statusLine(e)).toBe("poisoned 3, hastened 7");
  });

  it("an entity with no statuses ticks harmlessly", () => {
    const e = dummy();
    const r = tickStatuses(e, rng);
    expect(r).toEqual({ hpDelta: 0, expired: [], messages: [] });
    expect(e.hp).toBe(20);
  });
});
