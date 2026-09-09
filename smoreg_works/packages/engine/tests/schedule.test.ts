import { describe, it, expect } from "vitest";
import { Schedule, TURN_COST } from "../src/sim/schedule.js";
import { Faction, makeEntity, resetIds, type Entity } from "../src/sim/entity.js";

function actor(name: string, speed: number): Entity {
  return makeEntity({
    name, ch: "x", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 10, hpMax: 10, damage: [1, 1, 0], defense: 0, speed, fovRadius: 5,
  });
}

describe("Schedule", () => {
  it("gives a double-speed actor twice the turns", () => {
    resetIds();
    const s = new Schedule();
    const slow = actor("slow", 100);
    const fast = actor("fast", 200);
    const actors = [slow, fast];

    const taken: Record<string, number> = { slow: 0, fast: 0 };
    for (let i = 0; i < 300; i++) {
      const a = s.next(actors)!;
      taken[a.name]!++;
      s.spend(a, TURN_COST);
    }
    // 2:1 within a small margin.
    expect(taken.fast! / taken.slow!).toBeGreaterThan(1.9);
    expect(taken.fast! / taken.slow!).toBeLessThan(2.1);
  });

  it("skips dead actors", () => {
    resetIds();
    const s = new Schedule();
    const alive = actor("alive", 100);
    const dead = actor("dead", 100);
    dead.alive = false;
    dead.hp = 0;

    for (let i = 0; i < 20; i++) {
      const a = s.next([alive, dead])!;
      expect(a.name).toBe("alive");
      s.spend(a);
    }
  });

  it("returns undefined when nobody is alive", () => {
    resetIds();
    const s = new Schedule();
    const dead = actor("dead", 100);
    dead.alive = false;
    expect(s.next([dead])).toBeUndefined();
  });

  it("is order-stable for equal speeds (ascending id)", () => {
    resetIds();
    const s = new Schedule();
    const a = actor("a", 100);
    const b = actor("b", 100);
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      const cur = s.next([a, b])!;
      order.push(cur.name);
      s.spend(cur);
    }
    expect(order).toEqual(["a", "b", "a", "b", "a", "b"]);
  });

  /**
   * A zero-speed actor used to deadlock the scheduler. effectiveSpeed() now
   * floors every actor at 1, so "frozen" means "acts very rarely", never
   * "the game stops". The throw is kept as a backstop and is unreachable
   * through normal data.
   */
  it("a zero-speed actor still eventually acts instead of hanging", () => {
    resetIds();
    const s = new Schedule();
    const frozen = actor("frozen", 0);
    expect(s.next([frozen])).toBe(frozen);
    expect(s.time).toBeGreaterThan(50);
  });

  it("status effects change the effective turn rate", async () => {
    const { applyStatus } = await import("../src/sim/status.js");
    resetIds();
    const s = new Schedule();
    const normal = actor("normal", 100);
    const hasted = actor("hasted", 100);
    applyStatus(hasted, "haste", 999);

    const taken: Record<string, number> = { normal: 0, hasted: 0 };
    for (let i = 0; i < 300; i++) {
      const a = s.next([normal, hasted])!;
      taken[a.name]!++;
      s.spend(a, TURN_COST);
    }
    expect(taken.hasted! / taken.normal!).toBeGreaterThan(1.9);
  });
});
