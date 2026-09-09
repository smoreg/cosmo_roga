import { describe, it, expect } from "vitest";
import { generateLevel, distanceField, DEFAULT_MAPGEN } from "../src/sim/mapgen.js";
import { TILES } from "../src/sim/level.js";
import { Rng } from "../src/sim/rng.js";

/**
 * The invariant that saves a jam: 200 seeds x 8 depths, every one connected and
 * with reachable stairs. A single soft-locked level in a submitted build reads
 * to a voter as "broken game", and Robustness is a scored criterion.
 */
describe("mapgen invariants", () => {
  const SEEDS = 200;

  it("never produces an unreachable stairway", () => {
    for (let s = 0; s < SEEDS; s++) {
      const rng = new Rng(s);
      for (let depth = 1; depth <= 8; depth++) {
        const { level, entry, stairs } = generateLevel(depth, rng);
        const dist = distanceField(level, entry);
        const d = dist.get(stairs.x, stairs.y);
        expect(d, `seed ${s} depth ${depth}: stairs unreachable`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("leaves no walkable tile disconnected from the entry", () => {
    for (let s = 0; s < 60; s++) {
      const rng = new Rng(s + 5000);
      for (let depth = 1; depth <= 8; depth++) {
        const { level, entry } = generateLevel(depth, rng);
        const dist = distanceField(level, entry);
        let orphans = 0;
        level.tiles.forEach((x, y, t) => {
          if (TILES[t].walkable && dist.at(x, y) === -1) orphans++;
        });
        expect(orphans, `seed ${s} depth ${depth}`).toBe(0);
      }
    }
  });

  it("puts the stairs a real distance away from the entry", () => {
    let tooClose = 0;
    for (let s = 0; s < 100; s++) {
      const rng = new Rng(s + 9000);
      const { level, entry, stairs } = generateLevel(1, rng);
      const dist = distanceField(level, entry);
      if ((dist.get(stairs.x, stairs.y) ?? 0) < 15) tooClose++;
    }
    expect(tooClose).toBeLessThan(5);
  });

  it("is a pure function of (seed, depth)", () => {
    const a = generateLevel(3, new Rng(777));
    const b = generateLevel(3, new Rng(777));
    expect(a.entry).toEqual(b.entry);
    expect(a.stairs).toEqual(b.stairs);
    const dump = (g: typeof a) => {
      let s = "";
      g.level.tiles.forEach((_x, _y, t) => (s += String(t)));
      return s;
    };
    expect(dump(a)).toBe(dump(b));
  });

  it("respects the requested dimensions", () => {
    const { level } = generateLevel(1, new Rng(1), { ...DEFAULT_MAPGEN, width: 50, height: 25 });
    expect(level.width).toBe(50);
    expect(level.height).toBe(25);
  });
});
