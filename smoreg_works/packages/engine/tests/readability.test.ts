import { describe, it, expect } from "vitest";
import { DIRS4, type Point } from "../src/sim/grid.js";
import { Level, Tile, TILES, type RoomRect } from "../src/sim/level.js";
import { Rng } from "../src/sim/rng.js";
import {
  DEFAULT_SPEC,
  DeckBuilder,
  buildLevel,
  findRegions,
  type DeckPlan,
  type LevelSpec,
  type ZoneDensity,
  type ZoneKindSpec,
} from "../src/sim/mapgen/index.js";

/**
 * A deck is legible or it is not, and "legible" is measurable: how much of a
 * sector stays solid wall, how wide the walkable ground is, how many one-tile
 * stubs the player is invited to waste turns on. These are the numbers behind
 * the owner's note on day 3 — "more empty space between corridors, like Stone
 * Soup" — so they are asserted rather than eyeballed.
 *
 * Everything is measured on the sector interior: `zone.rect` inset by one on
 * every side is always inside the sector's carveable floor, whichever sides of
 * its frame the sector happens to own, so the frame never pads the wall share.
 */

const SEEDS = 200;
const DEPTHS = 6;

function deckSpec(plan: (depth: number, rng: Rng) => DeckPlan, over: Partial<LevelSpec> = {}): LevelSpec {
  return { ...DEFAULT_SPEC, builder: new DeckBuilder(plan), connect: false, vaultCount: 0, ...over };
}

function singleKind(interior: ZoneKindSpec["interior"], density: ZoneDensity): (d: number, r: Rng) => DeckPlan {
  return () => ({ zones: [{ kind: interior, name: interior.toUpperCase(), interior, density }] });
}

function inset(r: RoomRect): RoomRect {
  return { x1: r.x1 + 1, y1: r.y1 + 1, x2: r.x2 - 1, y2: r.y2 - 1 };
}

function walkableAt(level: Level, x: number, y: number): boolean {
  const t = level.tiles.get(x, y);
  return t !== undefined && TILES[t].walkable;
}

/** Share of the sector interior that is solid: the "air" the owner asked for. */
function wallShare(level: Level, rect: RoomRect): number {
  let walls = 0;
  let total = 0;
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      total++;
      if (!walkableAt(level, x, y)) walls++;
    }
  }
  return total === 0 ? 1 : walls / total;
}

/**
 * Share of the walkable ground that is at least two tiles across — a tile
 * counts when it sits in some all-walkable 2x2 block. A cave made of one-tile
 * threads scores near zero however much floor it has.
 */
function wideShare(level: Level, rect: RoomRect): number {
  let wide = 0;
  let total = 0;
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      if (!walkableAt(level, x, y)) continue;
      total++;
      const inBlock = [
        [0, 0],
        [-1, 0],
        [0, -1],
        [-1, -1],
      ].some(([ox, oy]) =>
        walkableAt(level, x + ox!, y + oy!) &&
        walkableAt(level, x + ox! + 1, y + oy!) &&
        walkableAt(level, x + ox!, y + oy! + 1) &&
        walkableAt(level, x + ox! + 1, y + oy! + 1),
      );
      if (inBlock) wide++;
    }
  }
  return total === 0 ? 1 : wide / total;
}

function exits(level: Level, p: Point): number {
  let n = 0;
  for (const d of DIRS4) {
    if (walkableAt(level, p.x + d.x, p.y + d.y)) n++;
  }
  return n;
}

/**
 * Length of every dead-end stub on the map: walk in from each tile with a
 * single exit until the corridor meets a junction. A stub of one tile is a
 * niche; a stub of five is a corridor that lies about going somewhere.
 */
function stubLengths(level: Level): number[] {
  const out: number[] = [];
  level.tiles.forEach((x, y, t) => {
    if (!TILES[t].walkable || exits(level, { x, y }) !== 1) return;
    let cur: Point = { x, y };
    let prev: Point | undefined;
    let len = 1;
    for (;;) {
      const next = DIRS4.map((d) => ({ x: cur.x + d.x, y: cur.y + d.y })).find(
        (n) => walkableAt(level, n.x, n.y) && !(prev && n.x === prev.x && n.y === prev.y),
      );
      if (!next || exits(level, next) > 2) break;
      prev = cur;
      cur = next;
      len++;
      if (len > 40) break;
    }
    out.push(len);
  });
  return out;
}

describe("deck readability", () => {
  it("leaves a sparse rooms sector more than a third solid wall", () => {
    const plan = singleKind("rooms", "sparse");
    let worst = 1;
    let sum = 0;
    let zones = 0;

    for (let s = 0; s < SEEDS; s++) {
      for (let depth = 1; depth <= DEPTHS; depth++) {
        const gen = buildLevel(depth, new Rng(s * 37 + 5), deckSpec(plan));
        for (const z of gen.level.zones) {
          const share = wallShare(gen.level, inset(z.rect));
          worst = Math.min(worst, share);
          sum += share;
          zones++;
        }
      }
    }

    expect(zones).toBeGreaterThan(SEEDS * DEPTHS * 3);
    expect(worst, `worst sector was ${(worst * 100).toFixed(1)} % wall`).toBeGreaterThanOrEqual(0.35);
    expect(sum / zones).toBeGreaterThanOrEqual(0.45);
  }, 180000);

  it("keeps most of a cluttered sector's floor two tiles wide", () => {
    const plan = singleKind("cluttered", "dense");
    let worst = 1;
    let sum = 0;
    let zones = 0;

    for (let s = 0; s < SEEDS; s++) {
      for (let depth = 1; depth <= DEPTHS; depth++) {
        const gen = buildLevel(depth, new Rng(s * 41 + 11), deckSpec(plan));
        for (const z of gen.level.zones) {
          const share = wideShare(gen.level, inset(z.rect));
          worst = Math.min(worst, share);
          sum += share;
          zones++;
        }
      }
    }

    expect(worst, `worst sector had ${(worst * 100).toFixed(1)} % of its floor two tiles wide`)
      .toBeGreaterThanOrEqual(0.55);
    expect(sum / zones).toBeGreaterThanOrEqual(0.8);
  }, 180000);

  it("does not leave corridors that go nowhere", () => {
    const plan = (): DeckPlan => ({
      zones: [
        { kind: "hall", name: "HALL", interior: "open", density: "sparse" },
        { kind: "cabins", name: "CABINS", interior: "rooms", density: "normal" },
        { kind: "hold", name: "HOLD", interior: "cluttered", density: "dense" },
      ],
    });

    const lengths: number[] = [];
    for (let s = 0; s < SEEDS; s++) {
      const gen = buildLevel(1 + (s % DEPTHS), new Rng(s * 43 + 3), deckSpec(plan));
      lengths.push(...stubLengths(gen.level));
    }

    // A stub is one tile long at best, so a mean of at most one means the deck
    // has no corridor that pretends to lead somewhere.
    const mean = lengths.length === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / lengths.length;
    expect(mean, `${lengths.length} stubs, mean length ${mean.toFixed(2)}`).toBeLessThanOrEqual(1);
  }, 180000);

  it("carves the hull into a silhouette without breaking the deck", () => {
    const plan = (): DeckPlan => ({
      zones: [
        { kind: "hall", name: "HALL", interior: "open", density: "sparse" },
        { kind: "cabins", name: "CABINS", interior: "rooms", density: "normal" },
        { kind: "hold", name: "HOLD", interior: "cluttered", density: "dense" },
      ],
      count: [4, 6],
      hullCutouts: 2,
    });

    let solidCorners = 0;
    for (let s = 0; s < SEEDS; s++) {
      const depth = 1 + (s % DEPTHS);
      const gen = buildLevel(depth, new Rng(s * 47 + 17), deckSpec(plan));
      const level = gen.level;

      // The cut is only ever a cut: the map is still one piece and every zone
      // still owns a rect of its own.
      expect(gen.problems, `seed ${s}`).toEqual([]);
      expect(findRegions(level.tiles), `seed ${s}: walkable regions`).toHaveLength(1);
      expect(level.zones.length, `seed ${s}: zones`).toBeGreaterThanOrEqual(4);

      // Nothing walkable outside a zone, cutouts included: they are hull.
      level.tiles.forEach((x, y, t) => {
        if (!TILES[t].walkable) return;
        expect(level.zoneAt({ x, y }), `seed ${s}: walkable ${x},${y} outside every zone`).toBeDefined();
      });

      const corners: Point[] = [
        { x: 1, y: 1 },
        { x: level.width - 2, y: 1 },
        { x: 1, y: level.height - 2 },
        { x: level.width - 2, y: level.height - 2 },
      ];
      if (corners.some((c) => !level.zones.some((z) => inside(z.rect, c)))) solidCorners++;
    }

    // Not a vacuous test: most decks really do lose a corner.
    expect(solidCorners, `${solidCorners}/${SEEDS} decks lost a corner`).toBeGreaterThan(SEEDS * 0.5);
  }, 180000);
});

function inside(r: RoomRect, p: Point): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
}
