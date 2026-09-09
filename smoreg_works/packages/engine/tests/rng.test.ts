import { describe, it, expect } from "vitest";
import { Rng } from "../src/sim/rng.js";

describe("Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("restores from serialised state", () => {
    const a = new Rng(999);
    a.next();
    a.next();
    const saved = a.state;
    const expected = [a.next(), a.next(), a.next()];

    const b = new Rng(0);
    b.state = saved;
    expect([b.next(), b.next(), b.next()]).toEqual(expected);
  });

  it("int() stays inside the inclusive range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it("roll(2,6) stays in 2..12 and covers the range", () => {
    const r = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.roll(2, 6);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(12);
      seen.add(v);
    }
    expect(seen.size).toBe(11);
  });

  it("weighted() respects weights roughly", () => {
    const r = new Rng(5);
    let orcs = 0;
    for (let i = 0; i < 10000; i++) if (r.weighted({ orc: 3, troll: 1 }) === "orc") orcs++;
    expect(orcs / 10000).toBeGreaterThan(0.70);
    expect(orcs / 10000).toBeLessThan(0.80);
  });

  it("fork() gives an independent stream", () => {
    const base = new Rng(100);
    const f1 = base.fork(1);
    const f2 = base.fork(2);
    expect(f1.next()).not.toBe(f2.next());
  });
});
