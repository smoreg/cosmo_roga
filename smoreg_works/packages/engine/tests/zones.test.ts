import { describe, it, expect } from "vitest";
import { Grid, DIRS8, type Point } from "../src/sim/grid.js";
import { Level, Tile, TILES, type Zone } from "../src/sim/level.js";
import { Rng } from "../src/sim/rng.js";
import { shadowcast } from "../src/sim/shadowcast.js";
import { buildLevel, DEFAULT_SPEC, RoomsBuilder, placeDoors, tryPlaceVault } from "../src/sim/mapgen/index.js";
import type { BuildContext, BuildResult, MapBuilder } from "../src/sim/mapgen/types.js";
import type { Vault } from "../src/sim/mapgen/vaults.js";
import { fromAscii, toAscii } from "../src/testing/fixtures.js";

function seenFrom(level: Level, from: Point, radius: number): Set<string> {
  const seen = new Set<string>();
  shadowcast(from.x, from.y, {
    transparent: (x, y) => level.isTransparent(x, y),
    reveal: (x, y) => seen.add(`${x},${y}`),
    radius,
  });
  return seen;
}

describe("airlock and bulkhead tiles", () => {
  it("an airlock is walkable but opaque; a bulkhead is neither", () => {
    expect(TILES[Tile.Airlock]).toMatchObject({ ch: "=", walkable: true, transparent: false, name: "airlock" });
    expect(TILES[Tile.Bulkhead]).toMatchObject({ ch: "|", walkable: false, transparent: false });
  });

  it("every enum value has a definition", () => {
    // A gap here breaks validate(), toAscii and the game's renderer at once.
    for (const t of [Tile.Wall, Tile.Floor, Tile.StairsDown, Tile.Door, Tile.Rubble, Tile.Airlock, Tile.Bulkhead]) {
      expect(TILES[t], `tile ${t}`).toBeDefined();
      expect(TILES[t].ch.length).toBe(1);
    }
    // Every char is distinct, otherwise ASCII fixtures stop round-tripping.
    const chars = Object.values(TILES).map((d) => d.ch);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("round-trips through fromAscii / toAscii", () => {
    const rows = [
      "##########",
      "#...=..|.#",
      "#.>.=..|.#",
      "#..%+..|.#",
      "##########",
    ];
    const { level } = fromAscii(rows);
    expect(toAscii(level)).toEqual(rows);
  });

  it("reads the tiles it drew", () => {
    const { level } = fromAscii(["#####", "#.=|#", "#####"]);
    expect(level.tiles.at(2, 1)).toBe(Tile.Airlock);
    expect(level.isWalkable(2, 1)).toBe(true);
    expect(level.isTransparent(2, 1)).toBe(false);
    expect(level.tiles.at(3, 1)).toBe(Tile.Bulkhead);
    expect(level.isWalkable(3, 1)).toBe(false);
    expect(level.isTransparent(3, 1)).toBe(false);
  });
});

describe("field of view through an airlock", () => {
  const CORRIDOR = [
    "#########",
    "#.a.=.b.#",
    "#########",
  ];

  it("does not see through a closed airlock", () => {
    const f = fromAscii(CORRIDOR);
    const seen = seenFrom(f.level, f.mark("a"), 20);
    expect(seen.has(`${f.mark("b").x},${f.mark("b").y}`)).toBe(false);
    // The airlock itself is visible: opaque tiles are lit when the sweep hits them.
    expect(seen.has("4,1")).toBe(true);
  });

  it("standing on an airlock sees both sides", () => {
    const f = fromAscii(CORRIDOR);
    const seen = seenFrom(f.level, { x: 4, y: 1 }, 20);
    const a = f.mark("a");
    const b = f.mark("b");
    expect(seen.has(`${a.x},${a.y}`)).toBe(true);
    expect(seen.has(`${b.x},${b.y}`)).toBe(true);
  });

  it("a bulkhead blocks sight like a wall", () => {
    const f = fromAscii(["#########", "#.a.|.b.#", "#########"]);
    const seen = seenFrom(f.level, f.mark("a"), 20);
    expect(seen.has(`${f.mark("b").x},${f.mark("b").y}`)).toBe(false);
  });
});

describe("Level.zones", () => {
  const zone = (id: number, kind: string, rect: Zone["rect"]): Zone => ({
    id,
    kind,
    name: kind.toUpperCase(),
    rect,
    airlocks: [],
  });

  it("is empty until a generator fills it", () => {
    expect(new Level(1, 10, 10).zones).toEqual([]);
    expect(new Level(1, 10, 10).zoneAt({ x: 5, y: 5 })).toBeUndefined();
  });

  it("zoneAt finds the zone a point is in, including its wall ring", () => {
    const level = new Level(1, 30, 20);
    level.zones.push(zone(0, "cargo", { x1: 0, y1: 0, x2: 10, y2: 9 }));
    level.zones.push(zone(1, "reactor", { x1: 11, y1: 0, x2: 25, y2: 9 }));

    expect(level.zoneAt({ x: 5, y: 5 })?.kind).toBe("cargo");
    expect(level.zoneAt({ x: 0, y: 0 })?.kind).toBe("cargo"); // corner of the rect
    expect(level.zoneAt({ x: 10, y: 9 })?.kind).toBe("cargo"); // inclusive far edge
    expect(level.zoneAt({ x: 11, y: 0 })?.kind).toBe("reactor");
    expect(level.zoneAt({ x: 26, y: 5 })).toBeUndefined(); // right of every zone
    expect(level.zoneAt({ x: 5, y: 10 })).toBeUndefined(); // below every zone
  });

  it("the engine never reads a zone's kind", () => {
    const level = new Level(1, 10, 10);
    level.zones.push(zone(7, "whatever-the-game-says", { x1: 1, y1: 1, x2: 8, y2: 8 }));
    expect(level.zoneAt({ x: 2, y: 2 })).toMatchObject({ id: 7, kind: "whatever-the-game-says" });
  });
});

/** An open hall with two declared sectors; enough to reach validate() cleanly. */
class TwoZoneBuilder implements MapBuilder {
  readonly name = "two-zone";

  build(ctx: BuildContext): BuildResult {
    const tiles = new Grid<Tile>(ctx.width, ctx.height, Tile.Wall);
    for (let y = 1; y < ctx.height - 1; y++) {
      for (let x = 1; x < ctx.width - 1; x++) tiles.set(x, y, Tile.Floor);
    }
    const mid = ctx.width >> 1;
    for (let y = 1; y < ctx.height - 1; y++) tiles.set(mid, y, Tile.Bulkhead);
    const gate = { x: mid, y: ctx.height >> 1 };
    tiles.set(gate.x, gate.y, Tile.Airlock);

    const zones: Zone[] = [
      { id: 0, kind: "port", name: "PORT SIDE", rect: { x1: 0, y1: 0, x2: mid, y2: ctx.height - 1 }, airlocks: [gate] },
      {
        id: 1,
        kind: "starboard",
        name: "STARBOARD",
        rect: { x1: mid + 1, y1: 0, x2: ctx.width - 1, y2: ctx.height - 1 },
        airlocks: [gate],
      },
    ];
    return { tiles, rooms: [], entryHint: { x: 1, y: 1 }, zones };
  }
}

describe("mapgen carries zones onto the Level", () => {
  it("copies BuildResult.zones into level.zones", () => {
    const gen = buildLevel(1, new Rng(4242), { ...DEFAULT_SPEC, builder: new TwoZoneBuilder(), doorChance: 0 });
    expect(gen.problems).toEqual([]);
    expect(gen.level.zones.map((z) => z.kind)).toEqual(["port", "starboard"]);
    expect(gen.level.zoneAt({ x: 1, y: 1 })?.kind).toBe("port");
    expect(gen.level.zoneAt({ x: gen.level.width - 2, y: 1 })?.kind).toBe("starboard");
    // The airlock survived the post-processing pipeline.
    const gate = gen.level.zones[0]!.airlocks[0]!;
    expect(gen.level.tiles.at(gate.x, gate.y)).toBe(Tile.Airlock);
  });

  it("leaves zones empty for a generator that declares none", () => {
    const gen = buildLevel(1, new Rng(99), { ...DEFAULT_SPEC, builder: new RoomsBuilder() });
    expect(gen.level.zones).toEqual([]);
    expect(gen.level.zoneAt({ x: 5, y: 5 })).toBeUndefined();
  });
});

describe("placeDoors around an airlock", () => {
  // Two identical corridor stubs: the left one runs through an airlock, the
  // right one through plain floor. Only the right one may receive doors.
  const MAP = [
    "#############",
    "#...........#",
    "###.###.#####",
    "###=###.#####",
    "###.###.#####",
    "#...........#",
    "#############",
  ];

  it("never puts a door next to an airlock, and never overwrites one", () => {
    let doorsAnywhere = 0;
    for (let seed = 0; seed < 50; seed++) {
      const { level } = fromAscii(MAP);
      const tiles = level.tiles;
      placeDoors(tiles, new Rng(seed), 1);

      tiles.forEach((x, y, t) => {
        if (t !== Tile.Door) return;
        doorsAnywhere++;
        for (const d of DIRS8) {
          expect(tiles.get(x + d.x, y + d.y), `seed ${seed}: door at ${x},${y}`).not.toBe(Tile.Airlock);
        }
      });

      expect(tiles.at(3, 3), `seed ${seed}`).toBe(Tile.Airlock);
      expect(tiles.at(3, 2), `seed ${seed}`).not.toBe(Tile.Door);
      expect(tiles.at(3, 4), `seed ${seed}`).not.toBe(Tile.Door);
    }
    // Non-vacuous: the airlock-free corridor does get doors.
    expect(doorsAnywhere).toBeGreaterThan(0);
  });

  it("never turns a bulkhead into a door", () => {
    const { level } = fromAscii(["#########", "#.......#", "###|#####", "#.......#", "#########"]);
    placeDoors(level.tiles, new Rng(11), 1);
    expect(level.tiles.at(3, 2)).toBe(Tile.Bulkhead);
  });
});

describe("vaults with station hardware", () => {
  const LOCK: Vault = {
    name: "lock",
    rows: [
      "#####",
      "#..m#",
      "=...|",
      "#..X#",
      "#####",
    ],
  };

  it("stamps an airlock and a bulkhead, and keeps the markers on floor", () => {
    const tiles = new Grid<Tile>(30, 20, Tile.Wall);
    const placed = tryPlaceVault(tiles, LOCK, new Rng(5))!;
    expect(placed).toBeDefined();
    const o = placed.origin;
    expect(tiles.at(o.x, o.y + 2)).toBe(Tile.Airlock);
    expect(tiles.at(o.x + 4, o.y + 2)).toBe(Tile.Bulkhead);
    expect(placed.marks.map((m) => m.ch).sort()).toEqual(["X", "m"]);
    for (const m of placed.marks) expect(TILES[tiles.at(m.pos.x, m.pos.y)].walkable).toBe(true);
  });

  it("treats a bulkhead as solid when checking whether the vault fits", () => {
    // 5x5 leaves exactly one legal origin for a 3x3 vault, so the two vaults
    // below are judged against the same three-by-three patch of open floor.
    const patch = (): Grid<Tile> => {
      const g = new Grid<Tile>(5, 5, Tile.Wall);
      for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) g.set(x, y, Tile.Floor);
      return g;
    };
    const open: Vault = { name: "open", rows: ["...", "...", "..."] };
    const sealed: Vault = { name: "sealed", rows: ["...", ".|.", "..."] };

    expect(tryPlaceVault(patch(), open, new Rng(6), 50)).toBeDefined();
    // The bulkhead would weld shut a tile the level already relies on.
    expect(tryPlaceVault(patch(), sealed, new Rng(6), 50)).toBeUndefined();
  });
});
