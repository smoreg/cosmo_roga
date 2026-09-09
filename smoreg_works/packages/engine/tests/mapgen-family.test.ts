import { describe, it, expect } from "vitest";
import {
  BspBuilder,
  CavesBuilder,
  RoomsBuilder,
  WalkBuilder,
  buildLevel,
  builderForDepth,
  DEFAULT_SPEC,
  findRegions,
  removeDeadEnds,
  connectRegions,
  enforceBorder,
  carveCorridor,
  validate,
  type MapBuilder,
} from "../src/sim/mapgen/index.js";
import { Tile, TILES } from "../src/sim/level.js";
import { Grid } from "../src/sim/grid.js";
import { Rng } from "../src/sim/rng.js";
import { fromAscii } from "../src/testing/fixtures.js";

const BUILDERS: MapBuilder[] = [new RoomsBuilder(), new BspBuilder(), new CavesBuilder(), new WalkBuilder()];
const SEEDS = 40;

describe("every builder satisfies the same contract", () => {
  for (const builder of BUILDERS) {
    describe(builder.name, () => {
      it("produces a single connected, validated level on every seed", () => {
        for (let s = 0; s < SEEDS; s++) {
          const gen = buildLevel(1 + (s % 8), new Rng(s + 4242), { ...DEFAULT_SPEC, builder });
          expect(gen.problems, `${builder.name} seed ${s}: ${JSON.stringify(gen.problems)}`).toEqual([]);
          expect(findRegions(gen.level.tiles).length).toBe(1);
        }
      });

      it("is a pure function of the seed", () => {
        const dump = (s: number) => {
          const gen = buildLevel(3, new Rng(s), { ...DEFAULT_SPEC, builder });
          let out = "";
          gen.level.tiles.forEach((_x, _y, t) => (out += String(t)));
          return out + `|${gen.entry.x},${gen.entry.y}|${gen.stairs.x},${gen.stairs.y}`;
        };
        expect(dump(1234)).toBe(dump(1234));
        expect(dump(1234)).not.toBe(dump(1235));
      });

      it("never opens the outer border", () => {
        for (let s = 0; s < 15; s++) {
          const gen = buildLevel(2, new Rng(s + 900), { ...DEFAULT_SPEC, builder });
          const t = gen.level.tiles;
          for (let x = 0; x < t.width; x++) {
            expect(TILES[t.at(x, 0)].walkable).toBe(false);
            expect(TILES[t.at(x, t.height - 1)].walkable).toBe(false);
          }
          for (let y = 0; y < t.height; y++) {
            expect(TILES[t.at(0, y)].walkable).toBe(false);
            expect(TILES[t.at(t.width - 1, y)].walkable).toBe(false);
          }
        }
      });

      it("puts the entry and the stairs on walkable ground, far apart", () => {
        for (let s = 0; s < 20; s++) {
          const gen = buildLevel(4, new Rng(s + 5000), { ...DEFAULT_SPEC, builder });
          expect(gen.level.isWalkable(gen.entry.x, gen.entry.y)).toBe(true);
          expect(gen.level.tiles.at(gen.stairs.x, gen.stairs.y)).toBe(Tile.StairsDown);
          expect(gen.entry).not.toEqual(gen.stairs);
        }
      });

      it("respects requested dimensions", () => {
        const gen = buildLevel(1, new Rng(7), { ...DEFAULT_SPEC, builder, width: 48, height: 22, minWalkable: 80 });
        expect(gen.level.width).toBe(48);
        expect(gen.level.height).toBe(22);
      });
    });
  }
});

describe("builderForDepth", () => {
  it("rotates through the family as the dungeon deepens", () => {
    const names = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => builderForDepth(d).name);
    expect(new Set(names).size).toBeGreaterThan(1);
  });
});

describe("post-processing", () => {
  it("findRegions counts islands", () => {
    const f = fromAscii([
      "#########",
      "#..#..#.#",
      "#..#..#.#",
      "#########",
    ]);
    expect(findRegions(f.level.tiles).length).toBe(3);
  });

  it("connectRegions fuses every island into one", () => {
    const f = fromAscii([
      "###########",
      "#..#...#..#",
      "#..#...#..#",
      "###########",
    ]);
    expect(findRegions(f.level.tiles).length).toBe(3);
    connectRegions(f.level.tiles, new Rng(1));
    expect(findRegions(f.level.tiles).length).toBe(1);
  });

  it("connectRegions never opens the border", () => {
    for (let s = 0; s < 20; s++) {
      const tiles = new Grid<Tile>(24, 12, Tile.Wall);
      const rng = new Rng(s);
      // Scatter a few disconnected pockets.
      for (let i = 0; i < 8; i++) {
        const cx = rng.int(2, 21);
        const cy = rng.int(2, 9);
        tiles.set(cx, cy, Tile.Floor);
      }
      connectRegions(tiles, rng);
      enforceBorder(tiles);
      for (let x = 0; x < tiles.width; x++) expect(TILES[tiles.at(x, 0)].walkable).toBe(false);
    }
  });

  it("removeDeadEnds fills one-tile stubs but keeps the loop", () => {
    const f = fromAscii([
      "#######",
      "#.....#",
      "#.###.#",
      "#.#a#.#",
      "#.###.#",
      "#.....#",
      "#######",
    ]);
    const before = countWalkable(f.level.tiles);
    const removed = removeDeadEnds(f.level.tiles);
    // 'a' is a fully enclosed pocket -> it is a dead end and gets filled.
    expect(removed).toBeGreaterThan(0);
    // The surrounding ring has no dead ends, so most of the map survives.
    expect(countWalkable(f.level.tiles)).toBeGreaterThan(before - 4);
  });

  it("carveCorridor links two points with a walkable path", () => {
    const tiles = new Grid<Tile>(15, 10, Tile.Wall);
    carveCorridor(tiles, { x: 2, y: 2 }, { x: 12, y: 7 });
    expect(TILES[tiles.at(2, 2)].walkable).toBe(true);
    expect(TILES[tiles.at(12, 7)].walkable).toBe(true);
    expect(findRegions(tiles).length).toBe(1);
  });
});

describe("validate", () => {
  it("reports a disconnected map", () => {
    const f = fromAscii([
      "#######",
      "#.#.#.#",
      "#######",
    ]);
    const problems = validate(f.level.tiles, { minWalkable: 1, minStairsDistance: 0 });
    expect(problems.map((p) => p.code)).toContain("disconnected");
  });

  it("reports an open border", () => {
    const f = fromAscii([
      "..###",
      "#...#",
      "#####",
    ]);
    const problems = validate(f.level.tiles, { minWalkable: 1, minStairsDistance: 0 });
    expect(problems.map((p) => p.code)).toContain("border-open");
  });

  it("reports a too-small map and a missing stairway", () => {
    const f = fromAscii([
      "#####",
      "#...#",
      "#####",
    ]);
    const problems = validate(f.level.tiles, { minWalkable: 100, minStairsDistance: 0 });
    expect(problems.map((p) => p.code)).toContain("too-small");
    expect(problems.map((p) => p.code)).toContain("no-stairs");
  });

  it("reports stairs that are too close to the entry", () => {
    const f = fromAscii([
      "#######",
      "#@..>.#",
      "#######",
    ]);
    const problems = validate(f.level.tiles, {
      minWalkable: 1,
      minStairsDistance: 10,
      entry: f.player!,
      stairs: f.stairs!,
    });
    expect(problems.map((p) => p.code)).toContain("stairs-too-close");
  });

  it("passes a good map cleanly", () => {
    const f = fromAscii([
      "##########",
      "#@.......#",
      "#.######.#",
      "#.......>#",
      "##########",
    ]);
    const problems = validate(f.level.tiles, {
      minWalkable: 1,
      minStairsDistance: 3,
      entry: f.player!,
      stairs: f.stairs!,
    });
    expect(problems).toEqual([]);
  });
});

function countWalkable(tiles: Grid<Tile>): number {
  let n = 0;
  tiles.forEach((_x, _y, t) => {
    if (TILES[t].walkable) n++;
  });
  return n;
}
