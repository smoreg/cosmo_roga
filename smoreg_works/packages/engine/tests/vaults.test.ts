import { describe, it, expect } from "vitest";
import { tryPlaceVault, placeVaults, vaultSize, type Vault } from "../src/sim/mapgen/vaults.js";
import { buildLevel, DEFAULT_SPEC, RoomsBuilder, findRegions } from "../src/sim/mapgen/index.js";
import { Grid } from "../src/sim/grid.js";
import { Tile, TILES } from "../src/sim/level.js";
import { Rng } from "../src/sim/rng.js";

const SHRINE: Vault = {
  name: "shrine",
  rows: [
    "#######",
    "#..m..#",
    "#.###.#",
    "#.#X#.#",
    "#.###.#",
    "#..+..#",
    "#######",
  ],
  weight: 1,
};

const RAGGED: Vault = {
  name: "ragged",
  rows: [
    "??#??",
    "?...?",
    "#.X.#",
    "?...?",
    "??#??",
  ],
};

describe("prefab vaults", () => {
  it("measures its own footprint", () => {
    expect(vaultSize(SHRINE)).toEqual({ w: 7, h: 7 });
  });

  it("stamps into solid rock and reports its markers", () => {
    const tiles = new Grid<Tile>(30, 20, Tile.Wall);
    const placed = tryPlaceVault(tiles, SHRINE, new Rng(1))!;
    expect(placed).toBeDefined();
    expect(placed.marks.map((m) => m.ch).sort()).toEqual(["X", "m"]);

    // Markers stand on floor, never inside a wall.
    for (const m of placed.marks) {
      expect(TILES[tiles.at(m.pos.x, m.pos.y)].walkable).toBe(true);
    }
    // The door char became a real door.
    let doors = 0;
    tiles.forEach((_x, _y, t) => {
      if (t === Tile.Door) doors++;
    });
    expect(doors).toBe(1);
  });

  it("stamps a vault that contains an airlock, and the level stays valid", () => {
    const LOCKUP: Vault = {
      name: "lockup",
      rows: [
        "#######",
        "#..X..#",
        "#.###.#",
        "=.#m#.=",
        "#.###.#",
        "#..+..#",
        "#######",
      ],
    };
    let sawAirlock = false;
    for (let s = 0; s < 25; s++) {
      const gen = buildLevel(3, new Rng(s + 99000), {
        ...DEFAULT_SPEC,
        builder: new RoomsBuilder(),
        vaults: [LOCKUP],
        vaultCount: 1,
      });
      expect(gen.problems, `seed ${s}: ${JSON.stringify(gen.problems)}`).toEqual([]);
      expect(findRegions(gen.level.tiles).length).toBe(1);
      for (const v of gen.vaults) {
        // Both airlock cells sit on the vault's outer wall ring: the '=' really
        // cut a passage through solid rock. The pipeline may still drop the
        // stairs onto one of them, since an airlock is walkable like any floor.
        for (const dx of [0, 6]) {
          const t = gen.level.tiles.at(v.origin.x + dx, v.origin.y + 3);
          expect([Tile.Airlock, Tile.StairsDown], `seed ${s} at +${dx},+3`).toContain(t);
          if (t === Tile.Airlock) sawAirlock = true;
        }
      }
    }
    expect(sawAirlock).toBe(true);
  });

  it("refuses to overwrite existing floor with wall", () => {
    const tiles = new Grid<Tile>(12, 12, Tile.Floor);
    // Every candidate spot is open floor, and the vault wants walls there.
    expect(tryPlaceVault(tiles, SHRINE, new Rng(2), 200)).toBeUndefined();
  });

  it("wildcards let a vault blend into existing floor", () => {
    const tiles = new Grid<Tile>(20, 20, Tile.Wall);
    // Carve a patch that the ragged vault's '?' cells can overlap.
    for (let y = 6; y < 12; y++) for (let x = 6; x < 12; x++) tiles.set(x, y, Tile.Floor);
    const placed = tryPlaceVault(tiles, RAGGED, new Rng(3), 400);
    expect(placed).toBeDefined();
  });

  it("never stamps outside the map", () => {
    const tiles = new Grid<Tile>(8, 8, Tile.Wall);
    const huge: Vault = { name: "huge", rows: Array.from({ length: 12 }, () => "#".repeat(12)) };
    expect(tryPlaceVault(tiles, huge, new Rng(4))).toBeUndefined();
  });

  it("respects minDepth and maxPerLevel", () => {
    const tiles = new Grid<Tile>(60, 40, Tile.Wall);
    const deep: Vault = { ...SHRINE, name: "deep", minDepth: 5 };
    expect(placeVaults(tiles, [deep], 2, new Rng(5), 3)).toEqual([]);

    const once: Vault = { ...SHRINE, name: "once", maxPerLevel: 1 };
    const placed = placeVaults(tiles, [once], 6, new Rng(6), 4);
    expect(placed.length).toBe(1);
  });

  it("a level built with vaults stays connected and valid", () => {
    for (let s = 0; s < 25; s++) {
      const gen = buildLevel(3, new Rng(s + 77000), {
        ...DEFAULT_SPEC,
        builder: new RoomsBuilder(),
        vaults: [SHRINE, RAGGED],
        vaultCount: 2,
      });
      expect(gen.problems, `seed ${s}: ${JSON.stringify(gen.problems)}`).toEqual([]);
      expect(findRegions(gen.level.tiles).length).toBe(1);
    }
  });

  it("vault markers on a built level land on reachable floor", () => {
    let seenAny = false;
    for (let s = 0; s < 25; s++) {
      const gen = buildLevel(3, new Rng(s + 88000), {
        ...DEFAULT_SPEC,
        builder: new RoomsBuilder(),
        vaults: [SHRINE],
        vaultCount: 1,
      });
      for (const v of gen.vaults) {
        for (const m of v.marks) {
          seenAny = true;
          expect(gen.level.isWalkable(m.pos.x, m.pos.y)).toBe(true);
        }
      }
    }
    expect(seenAny).toBe(true);
  });
});
