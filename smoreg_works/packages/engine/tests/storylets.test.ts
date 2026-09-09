import { describe, it, expect } from "vitest";
import { DIRS8, Grid, type Point } from "../src/sim/grid.js";
import { Level, Tile, TILES, type RoomRect } from "../src/sim/level.js";
import { Rng } from "../src/sim/rng.js";
import { Game } from "../src/sim/game.js";
import { DEFAULT_MAPGEN } from "../src/sim/mapgen.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";
import {
  DeckBuilder,
  DEFAULT_SPEC,
  buildLevel,
  findRegions,
  placeVaults,
  RoomsBuilder,
  vaultFootprint,
  type DeckPlan,
  type GeneratedLevel,
  type LevelSpec,
  type Vault,
  type ZoneKindSpec,
} from "../src/sim/mapgen/index.js";

/**
 * Storylets are the answer to "PCG must decide something": the station is built
 * out of what the run has already done to the drone. The engine's half of that
 * bargain is narrow and testable — a card goes only where its preconditions
 * allow, only inside its sector, and its flags outlive the deck.
 */

const CATALOG: ZoneKindSpec[] = [
  { kind: "cargo", name: "CARGO BAY", interior: "open", size: 1.5 },
  { kind: "hab", name: "HAB BLOCK", interior: "rooms" },
  { kind: "storage", name: "STORAGE", interior: "cluttered" },
];

/** A card small enough to fit in any sector, with one marker to find it by. */
function card(name: string, over: Partial<Vault> = {}): Vault {
  return {
    name,
    rows: [
      "#####",
      "#...#",
      "#.X.#",
      "#...#",
      "#####",
    ],
    ...over,
  };
}

function deckSpec(plan: (depth: number, rng: Rng) => DeckPlan, over: Partial<LevelSpec> = {}): LevelSpec {
  return { ...DEFAULT_SPEC, builder: new DeckBuilder(plan), connect: false, vaultCount: 0, ...over };
}

function planWith(vaults: readonly Vault[], perZone = 1, zones: ZoneKindSpec[] = CATALOG): () => DeckPlan {
  return () => ({ zones, vaults, vaultsPerZone: perZone });
}

function names(gen: GeneratedLevel): string[] {
  return gen.vaults.map((v) => v.vault.name);
}

function inset(r: RoomRect, by: number): RoomRect {
  return { x1: r.x1 + by, y1: r.y1 + by, x2: r.x2 - by, y2: r.y2 - by };
}

function contains(r: RoomRect, p: Point): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
}

/** Zone id per tile, so the isolation sweep is a lookup and not a search. */
function zoneGrid(level: Level): Grid<number> {
  const g = new Grid<number>(level.width, level.height, -1);
  for (const z of level.zones) {
    for (let y = z.rect.y1; y <= z.rect.y2; y++) {
      for (let x = z.rect.x1; x <= z.rect.x2; x++) g.set(x, y, z.id);
    }
  }
  return g;
}

/**
 * The E5 invariant, restated here so this file fails on its own when a card
 * breaches a zone wall: two adjacent walkable tiles are in the same zone, or
 * one of them is the airlock linking the pair.
 */
function isolationProblems(gen: GeneratedLevel): string[] {
  const bad: string[] = [];
  const tiles = gen.level.tiles;
  const zg = zoneGrid(gen.level);

  if (gen.problems.length > 0) bad.push(`validator: ${JSON.stringify(gen.problems)}`);
  if (findRegions(tiles).length !== 1) bad.push(`${findRegions(tiles).length} walkable regions`);

  tiles.forEach((x, y, t) => {
    if (!TILES[t].walkable || bad.length > 4) return;
    if (zg.at(x, y) < 0) bad.push(`walkable ${x},${y} belongs to no zone`);
    for (const d of DIRS8) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!tiles.inBounds(nx, ny)) continue;
      const n = tiles.at(nx, ny);
      if (!TILES[n].walkable) continue;
      if (zg.at(nx, ny) === zg.at(x, y)) continue;
      if (t === Tile.Airlock || n === Tile.Airlock) continue;
      bad.push(`zones ${zg.at(x, y)} and ${zg.at(nx, ny)} touch at ${x},${y}-${nx},${ny}`);
    }
  });
  return bad;
}

/** Every complaint about where the cards on a deck ended up. */
function placementProblems(gen: GeneratedLevel): string[] {
  const bad: string[] = [];
  const airlocks = new Set<string>();
  gen.level.tiles.forEach((x, y, t) => {
    if (t === Tile.Airlock) airlocks.add(`${x},${y}`);
  });

  for (const v of gen.vaults) {
    const zone = gen.level.zones.find((z) => z.id === v.zoneId);
    if (!zone) {
      bad.push(`${v.vault.name} has no zone (${v.zoneId})`);
      continue;
    }
    if (v.vault.zones && !v.vault.zones.includes(zone.kind)) {
      bad.push(`${v.vault.name} landed in ${zone.kind}, wants ${v.vault.zones.join("/")}`);
    }
    const allowed = inset(zone.rect, 1);
    for (const p of vaultFootprint(v)) {
      if (!contains(allowed, p)) bad.push(`${v.vault.name} cell ${p.x},${p.y} is on zone ${zone.id}'s frame`);
      if (airlocks.has(`${p.x},${p.y}`)) bad.push(`${v.vault.name} cell ${p.x},${p.y} is an airlock`);
    }
  }
  return bad;
}

describe("storylet preconditions", () => {
  it("never places a card whose `when` refuses", () => {
    const yes = card("yes");
    const no = card("no", { when: () => false });
    let sawYes = false;
    for (let s = 0; s < 40; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s + 5100), deckSpec(planWith([yes, no])));
      expect(names(gen)).not.toContain("no");
      if (names(gen).includes("yes")) sawYes = true;
    }
    expect(sawYes, "the control card never appeared either — the test proves nothing").toBe(true);
  }, 60000);

  it("passes depth, flags and the player to `when`", () => {
    const seen: Array<{ depth: number; flags: string[]; player: boolean }> = [];
    const probe = card("probe", {
      when: (ctx) => {
        seen.push({ depth: ctx.depth, flags: [...ctx.flags], player: ctx.player !== undefined });
        return false;
      },
    });
    buildLevel(5, new Rng(11), deckSpec(planWith([probe])));
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.depth).toBe(5);
      expect(s.flags).toEqual([]);
      expect(s.player).toBe(false);
    }
  });

  it("keeps a zoned card inside the zone kinds it named", () => {
    const only = card("only-hab", { zones: ["hab"] });
    const anywhere = card("anywhere");
    let sawOnly = false;
    const failures: string[] = [];

    for (let s = 0; s < 60; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s + 6100), deckSpec(planWith([only, anywhere], 2)));
      for (const v of gen.vaults) {
        const zone = gen.level.zoneAt(v.origin);
        expect(zone, `${v.vault.name} origin is outside every zone`).toBeDefined();
        if (v.vault.name !== "only-hab") continue;
        sawOnly = true;
        if (zone!.kind !== "hab") failures.push(`seed ${s}: only-hab in ${zone!.kind}`);
      }
      failures.push(...placementProblems(gen));
    }
    expect(failures.slice(0, 5).join("\n")).toBe("");
    expect(sawOnly, "the zoned card never appeared").toBe(true);
  }, 60000);

  it("lets `weightWhen` tilt the draw", () => {
    // Both cards may repeat, so every sector is an independent draw — with a
    // limit of one each, a deck of five sectors would place both regardless.
    const eager = card("eager", { weightWhen: () => 10, maxPerLevel: 9 });
    const plain = card("plain", { maxPerLevel: 9 });
    let eagerCount = 0;
    let plainCount = 0;

    for (let s = 0; s < 300; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s + 7100), deckSpec(planWith([eager, plain])));
      for (const n of names(gen)) {
        if (n === "eager") eagerCount++;
        else plainCount++;
      }
    }

    const total = eagerCount + plainCount;
    expect(total).toBeGreaterThan(100);
    expect(eagerCount / total, `eager ${eagerCount} vs plain ${plainCount}`).toBeGreaterThanOrEqual(0.7);
  }, 120000);

  it("drops a card whose `weightWhen` returns zero", () => {
    const off = card("off", { weightWhen: () => 0 });
    const on = card("on");
    for (let s = 0; s < 40; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s + 7600), deckSpec(planWith([off, on])));
      expect(names(gen)).not.toContain("off");
    }
  }, 60000);
});

describe("storylet flags", () => {
  const beacon = card("beacon", { when: (ctx) => ctx.depth === 1, sets: ["beacon-lit"], maxPerLevel: 9 });
  const echo = card("echo", { when: (ctx) => ctx.flags.has("beacon-lit"), maxPerLevel: 9 });

  function deckGame(seed: number): Game {
    return new Game({
      seed,
      content: TEST_CONTENT,
      mapgen: {
        ...DEFAULT_MAPGEN,
        builder: new DeckBuilder(planWith([beacon, echo], 1)),
        connect: false,
        vaultCount: 0,
      },
    });
  }

  it("raises `sets` into game.flags on arrival, and the next deck sees them", () => {
    let sawEcho = false;
    for (let s = 0; s < 12; s++) {
      const game = deckGame(s + 8100);
      expect(game.flags.has("beacon-lit"), `seed ${s}: depth 1 raised no flag`).toBe(true);
      expect(names(game.lastGen)).toContain("beacon");
      // `echo` is gated on the flag, so it cannot have appeared yet.
      expect(names(game.lastGen)).not.toContain("echo");

      game.player.pos = { ...game.lastGen.stairs };
      const out = game.playerCommand({ kind: "descend" });
      expect(out.ok, `seed ${s}: ${out.reason}`).toBe(true);
      expect(game.depth).toBe(2);
      expect(names(game.lastGen)).not.toContain("beacon");
      if (names(game.lastGen).includes("echo")) sawEcho = true;
    }
    expect(sawEcho, "the flag never unlocked anything on deck 2").toBe(true);
  }, 60000);

  it("hands the carried player to the generator from deck 2 on", () => {
    let sawPlayer = false;
    const probe = card("probe", {
      when: (ctx) => {
        if (ctx.depth > 1 && ctx.player !== undefined) sawPlayer = true;
        return false;
      },
    });
    const game = new Game({
      seed: 4242,
      content: TEST_CONTENT,
      mapgen: {
        ...DEFAULT_MAPGEN,
        builder: new DeckBuilder(planWith([probe])),
        connect: false,
        vaultCount: 0,
      },
    });
    game.player.pos = { ...game.lastGen.stairs };
    game.playerCommand({ kind: "descend" });
    expect(sawPlayer).toBe(true);
  });
});

describe("storylet placement", () => {
  const LIBRARY: Vault[] = [
    card("closet", { zones: ["storage"] }),
    card("alcove", { minDepth: 3 }),
    {
      name: "checkpoint",
      rows: [
        "#######",
        "#..m..#",
        "#.###.#",
        "#.#X#.#",
        "#..+..#",
        "#######",
      ],
      zones: ["hab", "cargo"],
    },
    {
      name: "ward",
      rows: [
        "??###??",
        "?.....?",
        "#..X..#",
        "?.....?",
        "??###??",
      ],
      weight: 2,
    },
    card("locker", { maxPerLevel: 3 }),
  ];

  it("holds the zone invariants with a full library across 200 seeds and 8 depths", () => {
    const failures: string[] = [];
    let cards = 0;

    for (let s = 0; s < 200; s++) {
      for (let depth = 1; depth <= 8; depth++) {
        const gen = buildLevel(depth, new Rng(s * 37 + 5), deckSpec(planWith(LIBRARY, 2)));
        cards += gen.vaults.length;
        for (const p of isolationProblems(gen)) failures.push(`seed ${s} depth ${depth}: ${p}`);
        for (const p of placementProblems(gen)) failures.push(`seed ${s} depth ${depth}: ${p}`);
        if (failures.length > 10) break;
      }
    }

    expect(failures.slice(0, 10).join("\n")).toBe("");
    // Roughly one card per sector on 1600 decks; a placer that quietly gave up
    // would still pass every check above.
    expect(cards, `${cards} cards placed`).toBeGreaterThan(1600);
  }, 300000);

  it("leaves the markers on reachable floor", () => {
    let seen = 0;
    for (let s = 0; s < 60; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s + 9100), deckSpec(planWith(LIBRARY, 2)));
      for (const v of gen.vaults) {
        for (const m of v.marks) {
          seen++;
          expect(gen.level.isWalkable(m.pos.x, m.pos.y), `${v.vault.name} mark ${m.ch}`).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  }, 60000);

  it("honours minDepth and maxPerLevel per deck", () => {
    for (let s = 0; s < 40; s++) {
      const shallow = buildLevel(2, new Rng(s + 9600), deckSpec(planWith(LIBRARY, 2)));
      expect(names(shallow)).not.toContain("alcove");

      const counts = new Map<string, number>();
      for (const n of names(shallow)) counts.set(n, (counts.get(n) ?? 0) + 1);
      for (const [n, c] of counts) {
        const limit = LIBRARY.find((v) => v.name === n)!.maxPerLevel ?? 1;
        expect(c, `${n} placed ${c} times`).toBeLessThanOrEqual(limit);
      }
    }
  }, 60000);

  it("is a pure function of the seed, cards included", () => {
    const dump = (seed: number) => {
      const gen = buildLevel(4, new Rng(seed), deckSpec(planWith(LIBRARY, 2)));
      let tiles = "";
      gen.level.tiles.forEach((_x, _y, t) => (tiles += String(t)));
      const cards = gen.vaults.map((v) => `${v.vault.name}@${v.origin.x},${v.origin.y}#${v.zoneId}`).join(";");
      return `${tiles}|${cards}|${gen.flagsSet.join(",")}`;
    };
    expect(dump(3131)).toBe(dump(3131));
    expect(dump(3131)).not.toBe(dump(3132));
  });
});

describe("the old vault path", () => {
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
  };

  it("behaves exactly as before for vaults with none of the new fields", () => {
    const before = (seed: number) => {
      const tiles = new Grid<Tile>(60, 40, Tile.Wall);
      const placed = placeVaults(tiles, [SHRINE], 4, new Rng(seed), 3);
      return placed.map((p) => `${p.vault.name}@${p.origin.x},${p.origin.y}`).join(";");
    };
    // Same seed, same result; and the vault really does get placed.
    expect(before(21)).toBe(before(21));
    expect(before(21).length).toBeGreaterThan(0);
    expect(before(21)).not.toBe(before(22));
  });

  it("skips a zoned card on a map that has no zones", () => {
    const tiles = new Grid<Tile>(60, 40, Tile.Wall);
    const zoned: Vault = { ...SHRINE, name: "zoned", zones: ["hab"] };
    expect(placeVaults(tiles, [zoned], 4, new Rng(23), 3)).toEqual([]);
  });

  it("still raises `sets` through the plain pipeline", () => {
    let placed = 0;
    for (let s = 0; s < 25; s++) {
      const gen = buildLevel(3, new Rng(s + 9900), {
        ...DEFAULT_SPEC,
        builder: new RoomsBuilder(),
        vaults: [{ ...SHRINE, name: "relic", sets: ["found-relic"] }],
        vaultCount: 1,
      });
      if (gen.vaults.length > 0) {
        placed++;
        expect(gen.flagsSet).toEqual(["found-relic"]);
      } else {
        expect(gen.flagsSet).toEqual([]);
      }
    }
    expect(placed, "the relic never got placed — the flag was never tested").toBeGreaterThan(0);
  }, 60000);
});
