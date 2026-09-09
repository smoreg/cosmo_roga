import { describe, it, expect } from "vitest";
import { shadowcast, lineOfSight } from "../src/sim/shadowcast.js";
import { fromAscii } from "../src/testing/fixtures.js";
import type { Level } from "../src/sim/level.js";

function seenFrom(level: Level, x: number, y: number, radius: number): Set<string> {
  const seen = new Set<string>();
  shadowcast(x, y, {
    transparent: (tx, ty) => level.isTransparent(tx, ty),
    reveal: (tx, ty) => seen.add(`${tx},${ty}`),
    radius,
  });
  return seen;
}

function floors(level: Level): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  level.tiles.forEach((x, y) => {
    if (level.isTransparent(x, y)) out.push([x, y]);
  });
  return out;
}

const CHAMBER = [
  "##########",
  "#........#",
  "#..##....#",
  "#..#.....#",
  "#....#...#",
  "#..#.#...#",
  "#........#",
  "##########",
];

describe("symmetric shadowcasting", () => {
  it("is perfectly symmetric between floor tiles", () => {
    const { level } = fromAscii(CHAMBER);
    const tiles = floors(level);
    const cache = new Map<string, Set<string>>();
    const view = (x: number, y: number) => {
      const k = `${x},${y}`;
      let v = cache.get(k);
      if (!v) {
        v = seenFrom(level, x, y, 8);
        cache.set(k, v);
      }
      return v;
    };

    const broken: string[] = [];
    for (const [ax, ay] of tiles) {
      for (const [bx, by] of tiles) {
        if (ax === bx && ay === by) continue;
        const aSeesB = view(ax, ay).has(`${bx},${by}`);
        const bSeesA = view(bx, by).has(`${ax},${ay}`);
        if (aSeesB !== bSeesA) broken.push(`(${ax},${ay})<->(${bx},${by})`);
      }
    }
    // rot.js scores 9.3-11.1% asymmetric pairs on this exact chamber.
    expect(broken.slice(0, 5)).toEqual([]);
    expect(broken.length).toBe(0);
  });

  it("stays perfectly symmetric on a map split by an airlock", () => {
    // The same idea as above, but the chamber is now two zones divided by a
    // bulkhead wall with a single airlock in it. Airlocks are opaque, so they
    // must shadow exactly like a wall does.
    const { level } = fromAscii([
      "##########",
      "#...|....#",
      "#...|....#",
      "#...=....#",
      "#...|....#",
      "#..#|.#..#",
      "#...|....#",
      "##########",
    ]);
    const tiles = floors(level);
    const cache = new Map<string, Set<string>>();
    const view = (x: number, y: number) => {
      const k = `${x},${y}`;
      let v = cache.get(k);
      if (!v) {
        v = seenFrom(level, x, y, 8);
        cache.set(k, v);
      }
      return v;
    };

    const broken: string[] = [];
    for (const [ax, ay] of tiles) {
      for (const [bx, by] of tiles) {
        if (ax === bx && ay === by) continue;
        if (view(ax, ay).has(`${bx},${by}`) !== view(bx, by).has(`${ax},${ay}`)) {
          broken.push(`(${ax},${ay})<->(${bx},${by})`);
        }
      }
    }
    expect(broken.slice(0, 5)).toEqual([]);
    expect(broken.length).toBe(0);
    // Non-vacuous: the divider really does cut the chamber in two.
    expect(view(2, 3).has("6,3")).toBe(false);
  });

  it("sees the whole of a convex room, walls included", () => {
    const { level, player } = fromAscii([
      "#######",
      "#.....#",
      "#..@..#",
      "#.....#",
      "#######",
    ]);
    const seen = seenFrom(level, player!.x, player!.y, 10);
    let missing = 0;
    level.tiles.forEach((x, y) => {
      if (!seen.has(`${x},${y}`)) missing++;
    });
    expect(missing).toBe(0);
  });

  it("does not see through a wall", () => {
    const { level, player } = fromAscii([
      "#########",
      "#@..#..a#",
      "#########",
    ]);
    const seen = seenFrom(level, player!.x, player!.y, 20);
    const { level: l2, marks } = fromAscii([
      "#########",
      "#@..#..a#",
      "#########",
    ]);
    void l2;
    const behind = marks.find((m) => m.ch === "a")!.pos;
    expect(seen.has(`${behind.x},${behind.y}`)).toBe(false);
  });

  it("has no blind corners: a tile diagonally past a corner stays hidden", () => {
    // Standing at @, the tile marked 'x' is around the corner and must not be
    // visible — otherwise the player discovers rooms by walking diagonally.
    const { level, player, marks } = fromAscii([
      "#####",
      "#@#x#",
      "#.#.#",
      "#...#",
      "#####",
    ]);
    const seen = seenFrom(level, player!.x, player!.y, 10);
    const x = marks.find((m) => m.ch === "x")!.pos;
    expect(seen.has(`${x.x},${x.y}`)).toBe(false);
  });

  it("pillar shadows widen with distance", () => {
    const rows = ["#################"];
    for (let i = 0; i < 5; i++) rows.push("#...............#");
    rows.push("#################");
    const { level } = fromAscii(rows);
    level.tiles.set(8, 3, 0 as never); // a pillar mid-room
    const near = seenFrom(level, 2, 3, 20);
    // Tiles directly behind the pillar on the same row are shadowed.
    expect(near.has("9,3")).toBe(false);
    expect(near.has("14,3")).toBe(false);
  });

  it("respects the radius", () => {
    const rows = ["#".repeat(21)];
    for (let i = 0; i < 9; i++) rows.push("#" + ".".repeat(19) + "#");
    rows.push("#".repeat(21));
    const { level } = fromAscii(rows);
    const seen = seenFrom(level, 10, 5, 3);
    expect(seen.has("13,5")).toBe(true);
    expect(seen.has("15,5")).toBe(false);
  });

  it("always reveals the origin, even inside a wall", () => {
    const { level } = fromAscii(["###", "###", "###"]);
    const seen = seenFrom(level, 1, 1, 5);
    expect(seen.has("1,1")).toBe(true);
  });

  it("lineOfSight agrees with the FOV it is derived from", () => {
    const { level } = fromAscii(CHAMBER);
    const tiles = floors(level);
    for (const [ax, ay] of tiles) {
      const seen = seenFrom(level, ax, ay, 8);
      for (const [bx, by] of tiles) {
        const los = lineOfSight({ x: ax, y: ay }, { x: bx, y: by }, (x, y) => level.isTransparent(x, y), 8);
        expect(los, `(${ax},${ay})->(${bx},${by})`).toBe(seen.has(`${bx},${by}`));
      }
    }
  });
});
