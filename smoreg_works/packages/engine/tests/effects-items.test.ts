import { describe, it, expect } from "vitest";
import { applyEffect, applyEffects, applyEffectsToArea, projectilePath, type Effect, type EffectContext } from "../src/sim/effects.js";
import { INVENTORY_SLOTS, dropSlot, inventoryOf, makeItem, pickUp, registry, rollItem, useItem, type ItemKind } from "../src/sim/items.js";
import { beginTargeting, candidates, cycleTarget, moveCursor, validateTarget, affectedArea, impactPoint } from "../src/sim/targeting.js";
import { hasStatus } from "../src/sim/status.js";
import { Faction, makeEntity, resetIds, type Entity } from "../src/sim/entity.js";
import { Rng } from "../src/sim/rng.js";
import { fromAscii } from "../src/testing/fixtures.js";
import { computeFov } from "../src/sim/fov.js";
import type { Level } from "../src/sim/level.js";

function mob(name: string, pos: { x: number; y: number }, faction = Faction.Monster, hp = 10): Entity {
  return makeEntity({
    name, ch: name[0]!, fg: "#fff", pos, faction,
    hp, hpMax: hp, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 8,
  });
}

function ctxFor(level: Level, entities: Entity[], seed = 1): EffectContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    level,
    entities,
    rng: new Rng(seed),
    lines,
    log: (t: string) => lines.push(t),
    blocked: (x, y) => !level.isWalkable(x, y),
  };
}

describe("effects", () => {
  it("damage removes HP and reports a kill", () => {
    resetIds();
    const f = fromAscii(["#####", "#@.t#", "#####"]);
    const target = mob("t", f.mark("t").x !== undefined ? f.mark("t") : { x: 3, y: 1 }, Faction.Monster, 3);
    const ctx = ctxFor(f.level, [target]);
    const out = applyEffect(ctx, undefined, target, { kind: "damage", dice: [1, 1, 9] });
    expect(out.damage).toBe(10);
    expect(out.killed).toContain(target);
    expect(target.alive).toBe(false);
  });

  it("a shield absorbs before HP", () => {
    resetIds();
    const f = fromAscii(["#####", "#@.t#", "#####"]);
    const target = mob("t", f.mark("t"), Faction.Monster, 10);
    const ctx = ctxFor(f.level, [target]);
    applyEffect(ctx, undefined, target, { kind: "status", status: "shield", turns: 9, magnitude: 4 });
    const out = applyEffect(ctx, undefined, target, { kind: "damage", dice: [1, 1, 5] });
    expect(out.damage).toBe(2);
    expect(target.hp).toBe(8);
  });

  it("heal never overfills", () => {
    resetIds();
    const f = fromAscii(["#####", "#@..#", "#####"]);
    const e = mob("p", f.player!, Faction.Player, 10);
    e.hp = 8;
    const ctx = ctxFor(f.level, [e]);
    const out = applyEffect(ctx, undefined, e, { kind: "heal", amount: 100 });
    expect(e.hp).toBe(10);
    expect(out.healed).toBe(2);
  });

  it("teleport lands on a free walkable tile", () => {
    resetIds();
    const f = fromAscii([
      "#######",
      "#.....#",
      "#..@..#",
      "#.....#",
      "#######",
    ]);
    const e = mob("p", f.player!, Faction.Player);
    const ctx = ctxFor(f.level, [e]);
    const before = { ...e.pos };
    applyEffect(ctx, undefined, e, { kind: "teleport", range: 2 });
    expect(e.pos).not.toEqual(before);
    expect(f.level.isWalkable(e.pos.x, e.pos.y)).toBe(true);
  });

  it("teleport with nowhere to go leaves the entity in place", () => {
    resetIds();
    const f = fromAscii(["###", "#@#", "###"]);
    const e = mob("p", f.player!, Faction.Player);
    const ctx = ctxFor(f.level, [e]);
    applyEffect(ctx, undefined, e, { kind: "teleport", range: 3 });
    expect(e.pos).toEqual(f.player);
  });

  it("push moves the target away and stops at a wall", () => {
    resetIds();
    const f = fromAscii(["########", "#@.t...#", "########"]);
    const source = mob("p", f.player!, Faction.Player);
    const target = mob("t", f.mark("t"));
    const ctx = ctxFor(f.level, [source, target]);
    applyEffect(ctx, source, target, { kind: "push", distance: 10 });
    expect(target.pos.x).toBe(6); // stopped by the wall at x=7
  });

  it("push is blocked by another body", () => {
    resetIds();
    const f = fromAscii(["########", "#@.tb..#", "########"]);
    const source = mob("p", f.player!, Faction.Player);
    const target = mob("t", f.mark("t"));
    const blocker = mob("b", f.mark("b"));
    const ctx = ctxFor(f.level, [source, target, blocker]);
    applyEffect(ctx, source, target, { kind: "push", distance: 3 });
    expect(target.pos).toEqual(f.mark("t"));
  });

  it("area effects hit everyone standing in the blast", () => {
    resetIds();
    const f = fromAscii([
      "#######",
      "#a.b.c#",
      "#######",
    ]);
    const a = mob("a", f.mark("a"));
    const b = mob("b", f.mark("b"));
    const c = mob("c", f.mark("c"));
    const ctx = ctxFor(f.level, [a, b, c]);
    const blast: Effect[] = [{ kind: "damage", dice: [1, 1, 2] }];
    applyEffectsToArea(ctx, undefined, [f.mark("a"), f.mark("b")], blast);
    expect(a.hp).toBeLessThan(10);
    expect(b.hp).toBeLessThan(10);
    expect(c.hp).toBe(10);
  });

  it("a list of effects applies in order", () => {
    resetIds();
    const f = fromAscii(["#####", "#@.t#", "#####"]);
    const t = mob("t", f.mark("t"));
    const ctx = ctxFor(f.level, [t]);
    applyEffects(ctx, undefined, t, [
      { kind: "damage", dice: [1, 1, 3] },
      { kind: "status", status: "poison", turns: 4 },
    ]);
    expect(t.hp).toBe(6);
    expect(hasStatus(t, "poison")).toBe(true);
  });

  it("projectilePath stops at the first wall", () => {
    const f = fromAscii(["#########", "#@..#...#", "#########"]);
    const ctx = ctxFor(f.level, []);
    const path = projectilePath(ctx, f.player!, { x: 7, y: 1 });
    expect(path[path.length - 1]).toEqual({ x: 4, y: 1 });
  });
});

const POTION: ItemKind = {
  id: "potion", name: "healing draught", ch: "!", fg: "#d55",
  targeting: { kind: "self" }, effects: [{ kind: "heal", amount: 8 }],
  charges: 1, minDepth: 1, maxDepth: 9, weight: 10,
};
const WAND: ItemKind = {
  id: "wand", name: "wand of frost", ch: "/", fg: "#8cf",
  targeting: { kind: "ranged", range: 6 },
  effects: [{ kind: "damage", dice: [1, 1, 4] }, { kind: "status", status: "slow", turns: 3 }],
  charges: 2, minDepth: 2, maxDepth: 9, weight: 5,
};
const BOMB: ItemKind = {
  id: "bomb", name: "fire bomb", ch: "*", fg: "#f80",
  targeting: { kind: "area", range: 5, radius: 1 },
  effects: [{ kind: "damage", dice: [1, 1, 3] }],
  charges: 1, minDepth: 1, maxDepth: 9, weight: 6,
};
const REG = registry([POTION, WAND, BOMB]);

describe("items", () => {
  it("holds at most three and refuses the fourth", () => {
    resetIds();
    const e = mob("p", { x: 1, y: 1 }, Faction.Player);
    for (let i = 0; i < INVENTORY_SLOTS; i++) expect(pickUp(e, makeItem(POTION)).ok).toBe(true);
    const overflow = pickUp(e, makeItem(POTION));
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toMatch(/full/i);
    expect(inventoryOf(e).length).toBe(INVENTORY_SLOTS);
  });

  it("a single-charge item is consumed on use", () => {
    resetIds();
    const f = fromAscii(["#####", "#@..#", "#####"]);
    const e = mob("p", f.player!, Faction.Player, 20);
    e.hp = 5;
    pickUp(e, makeItem(POTION));
    const ctx = ctxFor(f.level, [e]);
    const res = useItem(ctx, REG, e, 0);
    expect(res.ok).toBe(true);
    expect(res.consumed).toBe(true);
    expect(e.hp).toBe(13);
    expect(inventoryOf(e).length).toBe(0);
  });

  it("a multi-charge item survives its first use", () => {
    resetIds();
    const f = fromAscii(["########", "#@...t.#", "########"]);
    const e = mob("p", f.player!, Faction.Player);
    const t = mob("t", f.mark("t"));
    pickUp(e, makeItem(WAND));
    const ctx = ctxFor(f.level, [e, t]);

    const first = useItem(ctx, REG, e, 0, t);
    expect(first.consumed).toBe(false);
    expect(hasStatus(t, "slow")).toBe(true);
    const second = useItem(ctx, REG, e, 0, t);
    expect(second.consumed).toBe(true);
    expect(inventoryOf(e).length).toBe(0);
  });

  it("an area item hits everything around the aim point", () => {
    resetIds();
    const f = fromAscii([
      "########",
      "#@..ab.#",
      "########",
    ]);
    const e = mob("p", f.player!, Faction.Player);
    const a = mob("a", f.mark("a"));
    const b = mob("b", f.mark("b"));
    pickUp(e, makeItem(BOMB));
    const ctx = ctxFor(f.level, [e, a, b]);
    useItem(ctx, REG, e, 0, f.mark("a"));
    expect(a.hp).toBeLessThan(10);
    expect(b.hp).toBeLessThan(10);
  });

  it("refuses an empty slot and an unknown item", () => {
    resetIds();
    const f = fromAscii(["#####", "#@..#", "#####"]);
    const e = mob("p", f.player!, Faction.Player);
    const ctx = ctxFor(f.level, [e]);
    expect(useItem(ctx, REG, e, 0).ok).toBe(false);
    inventoryOf(e).push({ kindId: "nonsense", charges: 1 });
    expect(useItem(ctx, REG, e, 0).ok).toBe(false);
  });

  it("dropSlot returns the item and frees the slot", () => {
    resetIds();
    const e = mob("p", { x: 1, y: 1 }, Faction.Player);
    pickUp(e, makeItem(POTION));
    expect(dropSlot(e, 0)?.kindId).toBe("potion");
    expect(inventoryOf(e).length).toBe(0);
    expect(dropSlot(e, 5)).toBeUndefined();
  });

  it("rollItem only offers items legal for the depth", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const k = rollItem(REG, 1, rng)!;
      expect(k.minDepth).toBeLessThanOrEqual(1);
    }
  });
});

describe("targeting", () => {
  function scene() {
    resetIds();
    const f = fromAscii([
      "############",
      "#@...a..#b.#",
      "############",
    ]);
    const self = mob("p", f.player!, Faction.Player);
    const a = mob("a", f.mark("a"));
    const b = mob("b", f.mark("b"));
    computeFov(f.level, self.pos, 12);
    return { f, ctx: { level: f.level, entities: [self, a, b], self }, self, a, b };
  }

  it("lists only visible enemies in range, nearest first", () => {
    const { ctx } = scene();
    const list = candidates(ctx, { kind: "ranged", range: 8 });
    expect(list.map((e) => e.name)).toEqual(["a"]); // 'b' is behind a wall
  });

  it("starts on the nearest candidate", () => {
    const { ctx, a } = scene();
    const s = beginTargeting(ctx, { kind: "ranged", range: 8 });
    expect(s.cursor).toEqual(a.pos);
  });

  it("cycles between candidates without leaving the list", () => {
    const { ctx } = scene();
    const s = beginTargeting(ctx, { kind: "ranged", range: 8 });
    const first = { ...s.cursor };
    cycleTarget(ctx, s);
    expect(s.cursor).toEqual(first); // only one candidate here
  });

  it("refuses a shot out of range or through a wall", () => {
    const { ctx, self } = scene();
    const s = beginTargeting(ctx, { kind: "ranged", range: 2 });
    s.cursor = { x: self.pos.x + 6, y: self.pos.y };
    expect(validateTarget(ctx, s).ok).toBe(false);
    expect(validateTarget(ctx, s).reason).toMatch(/range/i);
  });

  it("refuses to target an empty tile with a single-target ability", () => {
    const { ctx, self } = scene();
    const s = beginTargeting(ctx, { kind: "ranged", range: 8 });
    s.cursor = { x: self.pos.x + 1, y: self.pos.y };
    const v = validateTarget(ctx, s);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/nothing/i);
  });

  it("accepts an empty tile for an area ability and previews the blast", () => {
    const { ctx, self } = scene();
    const s = beginTargeting(ctx, { kind: "area", range: 8, radius: 1 });
    s.cursor = { x: self.pos.x + 2, y: self.pos.y };
    expect(validateTarget(ctx, s).ok).toBe(true);
    expect(affectedArea(ctx, s).length).toBeGreaterThan(1);
  });

  it("keeps the cursor inside range and inside the map", () => {
    const { ctx } = scene();
    const s = beginTargeting(ctx, { kind: "ranged", range: 2 });
    for (let i = 0; i < 20; i++) moveCursor(ctx, s, 1, 0);
    expect(Math.abs(s.cursor.x - s.origin.x)).toBeLessThanOrEqual(2);
  });

  it("impactPoint reports the wall a shot actually stops on", () => {
    const { ctx, self } = scene();
    const s = beginTargeting(ctx, { kind: "ranged", range: 10 });
    s.cursor = { x: self.pos.x + 9, y: self.pos.y };
    const hit = impactPoint(ctx, s);
    expect(hit.x).toBeLessThanOrEqual(8);
  });

  it("self-targeting is always valid and affects one tile", () => {
    const { ctx } = scene();
    const s = beginTargeting(ctx, { kind: "self" });
    expect(validateTarget(ctx, s).ok).toBe(true);
    expect(affectedArea(ctx, s).length).toBe(1);
  });
});
