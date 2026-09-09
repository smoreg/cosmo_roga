import { describe, it, expect } from "vitest";
import { line, disc, ring, cone, beam, neighbours } from "../src/sim/shapes.js";
import { propagate, decay, reinforce, loudestNear } from "../src/sim/propagate.js";
import { fromAscii } from "../src/testing/fixtures.js";
import { Grid, chebyshev } from "../src/sim/grid.js";

describe("shapes", () => {
  describe("line", () => {
    it("includes both endpoints", () => {
      const l = line({ x: 1, y: 1 }, { x: 4, y: 1 });
      expect(l[0]).toEqual({ x: 1, y: 1 });
      expect(l[l.length - 1]).toEqual({ x: 4, y: 1 });
    });

    it("every step is adjacent to the previous one", () => {
      const l = line({ x: 0, y: 0 }, { x: 9, y: 4 });
      for (let i = 1; i < l.length; i++) expect(chebyshev(l[i - 1]!, l[i]!)).toBe(1);
    });

    it("is symmetric as a set", () => {
      const a = line({ x: 2, y: 7 }, { x: 11, y: 2 }).map((p) => `${p.x},${p.y}`).sort();
      const b = line({ x: 11, y: 2 }, { x: 2, y: 7 }).map((p) => `${p.x},${p.y}`).sort();
      expect(a).toEqual(b);
    });

    it("a zero-length line is one tile", () => {
      expect(line({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
    });
  });

  describe("disc and ring", () => {
    it("chebyshev disc of radius 2 is a 5x5 square", () => {
      expect(disc({ x: 0, y: 0 }, 2, "chebyshev").length).toBe(25);
    });

    it("euclidean disc is rounder than the square", () => {
      expect(disc({ x: 0, y: 0 }, 3).length).toBeLessThan(49);
      expect(disc({ x: 0, y: 0 }, 3).length).toBeGreaterThan(25);
    });

    it("ring holds only tiles at exactly that distance", () => {
      const r = ring({ x: 5, y: 5 }, 2);
      for (const p of r) expect(chebyshev(p, { x: 5, y: 5 })).toBe(2);
      expect(r.length).toBe(16);
    });

    it("ring of radius 0 is the centre", () => {
      expect(ring({ x: 2, y: 2 }, 0)).toEqual([{ x: 2, y: 2 }]);
    });
  });

  describe("cone", () => {
    it("widens with distance and never includes the origin", () => {
      const c = cone({ x: 10, y: 10 }, { x: 11, y: 10 }, 4);
      expect(c.some((p) => p.x === 10 && p.y === 10)).toBe(false);
      const atStep = (n: number) => c.filter((p) => p.x === 10 + n).length;
      expect(atStep(1)).toBeLessThanOrEqual(atStep(4));
      expect(atStep(4)).toBeGreaterThan(1);
    });

    it("has no duplicate tiles", () => {
      const c = cone({ x: 8, y: 8 }, { x: 9, y: 9 }, 5);
      expect(new Set(c.map((p) => `${p.x},${p.y}`)).size).toBe(c.length);
    });

    it("degenerates to the origin when aimed at itself", () => {
      expect(cone({ x: 1, y: 1 }, { x: 1, y: 1 }, 5)).toEqual([{ x: 1, y: 1 }]);
    });
  });

  describe("beam", () => {
    it("stops at the first wall, including it", () => {
      const f = fromAscii([
        "#########",
        "#@..#...#",
        "#########",
      ]);
      const b = beam(f.player!, { x: 7, y: 1 }, 6, (x, y) => !f.level.isTransparent(x, y));
      const last = b[b.length - 1]!;
      expect(last).toEqual({ x: 4, y: 1 });
    });

    it("never returns the origin", () => {
      const f = fromAscii(["#########", "#@......#", "#########"]);
      const b = beam(f.player!, { x: 7, y: 1 }, 6, () => false);
      expect(b.some((p) => p.x === f.player!.x && p.y === f.player!.y)).toBe(false);
    });

    it("respects the range", () => {
      const f = fromAscii(["############", "#@.........#", "############"]);
      const b = beam(f.player!, { x: 10, y: 1 }, 3, () => false);
      expect(b.length).toBe(3);
    });
  });

  it("neighbours returns exactly eight tiles", () => {
    expect(neighbours({ x: 4, y: 4 }).length).toBe(8);
  });
});

describe("propagate (noise / scent)", () => {
  it("falls off by one per step", () => {
    const f = fromAscii([
      "##########",
      "#@.......#",
      "##########",
    ]);
    const field = propagate(f.level.width, f.level.height, [{ pos: f.player!, strength: 5 }], {
      passable: (x, y) => f.level.isWalkable(x, y),
    });
    expect(field.at(1, 1)).toBe(5);
    expect(field.at(2, 1)).toBe(4);
    expect(field.at(5, 1)).toBe(1);
    expect(field.at(6, 1)).toBe(0);
  });

  it("does not pass through walls", () => {
    const f = fromAscii([
      "#########",
      "#@..#..a#",
      "#########",
    ]);
    const field = propagate(f.level.width, f.level.height, [{ pos: f.player!, strength: 20 }], {
      passable: (x, y) => f.level.isWalkable(x, y),
    });
    expect(field.at(f.mark("a").x, f.mark("a").y)).toBe(0);
  });

  it("goes round a corner, losing strength on the way", () => {
    const f = fromAscii([
      "#######",
      "#@#..a#",
      "#.#.###",
      "#...###",
      "#######",
    ]);
    const field = propagate(f.level.width, f.level.height, [{ pos: f.player!, strength: 12 }], {
      passable: (x, y) => f.level.isWalkable(x, y),
    });
    const a = f.mark("a");
    expect(field.at(a.x, a.y)).toBeGreaterThan(0);
    expect(field.at(a.x, a.y)).toBeLessThan(12);
  });

  it("extraFalloff muffles specific tiles", () => {
    const f = fromAscii([
      "##########",
      "#@..+....#",
      "##########",
    ]);
    const loud = propagate(f.level.width, f.level.height, [{ pos: f.player!, strength: 9 }], {
      passable: (x, y) => f.level.isWalkable(x, y),
    });
    const muffled = propagate(f.level.width, f.level.height, [{ pos: f.player!, strength: 9 }], {
      passable: (x, y) => f.level.isWalkable(x, y),
      extraFalloff: (x, y) => (f.level.tiles.at(x, y) === 3 ? 4 : 0),
    });
    expect(muffled.at(7, 1)).toBeLessThan(loud.at(7, 1));
  });

  it("the loudest source wins where two overlap", () => {
    const f = fromAscii([
      "###########",
      "#a.......b#",
      "###########",
    ]);
    const field = propagate(
      f.level.width,
      f.level.height,
      [
        { pos: f.mark("a"), strength: 3 },
        { pos: f.mark("b"), strength: 12 },
      ],
      { passable: (x, y) => f.level.isWalkable(x, y) },
    );
    // Midpoint hears the loud source, not the quiet one.
    expect(field.at(5, 1)).toBeGreaterThan(3);
  });

  it("decay and reinforce maintain a fading trail", () => {
    const field = new Grid<number>(5, 5, 0);
    reinforce(field, { x: 2, y: 2 }, 5);
    expect(field.at(2, 2)).toBe(5);
    reinforce(field, { x: 2, y: 2 }, 3); // keeps the max
    expect(field.at(2, 2)).toBe(5);
    decay(field, 2);
    expect(field.at(2, 2)).toBe(3);
    decay(field, 99);
    expect(field.at(2, 2)).toBe(0);
  });

  it("loudestNear finds the strongest tile in range", () => {
    const field = new Grid<number>(10, 10, 0);
    field.set(3, 3, 4);
    field.set(7, 7, 9);
    expect(loudestNear(field, { x: 4, y: 4 }, 2)).toEqual({ x: 3, y: 3 });
    expect(loudestNear(field, { x: 5, y: 5 }, 4)).toEqual({ x: 7, y: 7 });
    expect(loudestNear(field, { x: 0, y: 9 }, 1)).toBeUndefined();
  });
});
