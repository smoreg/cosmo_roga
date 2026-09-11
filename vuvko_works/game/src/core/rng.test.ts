import { describe, expect, it } from "vitest";
import { chance, createRng, nextFloat, nextInt, pickOne, seedFromString } from "./rng";

describe("counter-based randomness", () => {
  it("hashes a seed string to a stable number", () => {
    expect(seedFromString("boarding-1")).toBe(seedFromString("boarding-1"));
    expect(seedFromString("a")).not.toBe(seedFromString("b"));
    expect(createRng(7)).toEqual({ seed: 7, cursor: 0 });
  });

  it("never mutates the state it was handed", () => {
    const start = createRng("x");
    const [, next] = nextFloat(start);
    expect(start.cursor).toBe(0);
    expect(next.cursor).toBe(1);
    expect(next.seed).toBe(start.seed);
  });

  it("is addressable: the same cursor always gives the same draw", () => {
    const at = { seed: 1234, cursor: 9 };
    expect(nextFloat(at)[0]).toBe(nextFloat({ seed: 1234, cursor: 9 })[0]);
    expect(nextFloat(at)[0]).not.toBe(nextFloat({ seed: 1234, cursor: 10 })[0]);
  });

  it("stays inside its bounds over a long run", () => {
    let rng = createRng("spread");
    let low = 1;
    let high = 0;
    for (let i = 0; i < 2000; i++) {
      const [value, next] = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      low = Math.min(low, value);
      high = Math.max(high, value);
      rng = next;
    }
    expect(low).toBeLessThan(0.05);
    expect(high).toBeGreaterThan(0.95);
  });

  it("draws integers and picks items inside range", () => {
    let rng = createRng("pick");
    for (let i = 0; i < 200; i++) {
      const [index, next] = nextInt(rng, 5);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(5);
      rng = next;
    }
    const [chosen] = pickOne(createRng("one"), ["a", "b", "c"]);
    expect(["a", "b", "c"]).toContain(chosen);
    const [nothing, unchanged] = pickOne(createRng("empty"), []);
    expect(nothing).toBeNull();
    expect(unchanged.cursor).toBe(0);
  });

  it("lands close to the stated probability", () => {
    let rng = createRng("coin");
    let hits = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      const [hit, next] = chance(rng, 0.75);
      if (hit) hits++;
      rng = next;
    }
    expect(hits / trials).toBeGreaterThan(0.72);
    expect(hits / trials).toBeLessThan(0.78);
  });
});
