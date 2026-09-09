import { describe, it, expect } from "vitest";
import { DIRS8, Grid, type Point } from "../src/sim/grid.js";
import { Level, Tile, TILES, type RoomRect } from "../src/sim/level.js";
import { Rng } from "../src/sim/rng.js";
import {
  DeckBuilder,
  DEFAULT_SPEC,
  buildLevel,
  findRegions,
  type DeckPlan,
  type GeneratedLevel,
  type LevelSpec,
  type ZoneKindSpec,
} from "../src/sim/mapgen/index.js";

/**
 * The deck builder's contract is structural, so the tests are too: they assert
 * on the zone graph, not on any particular map. The one that matters most is
 * "zones touch only through airlocks" — everything else in the station design
 * (the deck schematic, alerts naming a zone, storylets stamped per sector)
 * rests on it.
 */

const CATALOG: ZoneKindSpec[] = [
  { kind: "cargo", name: "CARGO BAY", interior: "open", size: 1.5, weight: 2 },
  { kind: "hab", name: "HAB BLOCK", interior: "rooms" },
  { kind: "storage", name: "STORAGE", interior: "cluttered" },
  { kind: "med", name: "MED BAY", interior: "rooms", size: 0.7 },
  { kind: "reactor", name: "REACTOR", interior: "open", size: 1.2, weight: 0.5 },
];

const planFor = (): DeckPlan => ({ zones: CATALOG });

function deckSpec(plan: (depth: number, rng: Rng) => DeckPlan, over: Partial<LevelSpec> = {}): LevelSpec {
  return { ...DEFAULT_SPEC, builder: new DeckBuilder(plan), connect: false, vaultCount: 0, ...over };
}

/** Zone id per tile, so the isolation sweep is a grid lookup and not a search. */
function zoneGrid(level: Level): Grid<number> {
  const g = new Grid<number>(level.width, level.height, -1);
  for (const z of level.zones) {
    for (let y = z.rect.y1; y <= z.rect.y2; y++) {
      for (let x = z.rect.x1; x <= z.rect.x2; x++) g.set(x, y, z.id);
    }
  }
  return g;
}

function overlaps(a: RoomRect, b: RoomRect): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}

function airlockKey(p: Point): string {
  return `${p.x},${p.y}`;
}

/** Every complaint a single generated deck can raise. Empty means it is sound. */
function deckProblems(gen: GeneratedLevel): string[] {
  const bad: string[] = [];
  const level = gen.level;
  const tiles = level.tiles;
  const zones = level.zones;

  if (gen.problems.length > 0) bad.push(`validator: ${JSON.stringify(gen.problems)}`);
  if (zones.length < 2) bad.push(`only ${zones.length} zones`);
  if (findRegions(tiles).length !== 1) bad.push(`${findRegions(tiles).length} walkable regions`);

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      if (overlaps(zones[i]!.rect, zones[j]!.rect)) bad.push(`zones ${i} and ${j} overlap`);
    }
  }

  const zg = zoneGrid(level);

  // The main invariant: any two neighbouring walkable tiles are in the same
  // zone, or at least one of them is the airlock that links the two.
  tiles.forEach((x, y, t) => {
    if (!TILES[t].walkable) return;
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

  // One airlock tile per graph edge, recorded on both of its zones.
  const onMap = new Set<string>();
  tiles.forEach((x, y, t) => {
    if (t === Tile.Airlock) onMap.add(airlockKey({ x, y }));
  });
  const edges = new Map<string, [number, number]>();
  for (const z of zones) {
    if (z.airlocks.length === 0) bad.push(`zone ${z.id} (${z.kind}) has no airlock`);
    for (const a of z.airlocks) {
      if (!onMap.has(airlockKey(a))) bad.push(`zone ${z.id} lists airlock ${airlockKey(a)} that is not on the map`);
      const pair = edges.get(airlockKey(a));
      if (pair) pair[1] = z.id;
      else edges.set(airlockKey(a), [z.id, -1]);
    }
  }
  for (const [k, [a, b]] of edges) {
    if (b < 0) bad.push(`airlock ${k} is recorded on one zone only`);
  }
  if (edges.size !== onMap.size) bad.push(`${onMap.size} airlock tiles vs ${edges.size} recorded edges`);

  // The zone graph itself must be connected, not just the tiles.
  const seen = new Set<number>([zones[0]?.id ?? 0]);
  for (let pass = 0; pass < zones.length; pass++) {
    for (const [, [a, b]] of edges) {
      if (seen.has(a)) seen.add(b);
      if (seen.has(b)) seen.add(a);
    }
  }
  if (seen.size !== zones.length) bad.push(`zone graph is disconnected: ${seen.size}/${zones.length}`);

  // A hatch in an airlock would sit in the doorway of two zones at once.
  if (onMap.has(airlockKey(gen.stairs))) bad.push(`stairs ${airlockKey(gen.stairs)} sit in an airlock`);
  if (zg.at(gen.stairs.x, gen.stairs.y) < 0) bad.push("stairs belong to no zone");
  if (zg.at(gen.entry.x, gen.entry.y) < 0) bad.push("entry belongs to no zone");

  return bad;
}

describe("DeckBuilder", () => {
  it("holds every zone invariant across 200 seeds and 8 depths", () => {
    const failures: string[] = [];
    let buildMs = 0;
    let zoneTotal = 0;
    let airlockTotal = 0;

    for (let s = 0; s < 200; s++) {
      for (let depth = 1; depth <= 8; depth++) {
        const t0 = performance.now();
        const gen = buildLevel(depth, new Rng(s * 31 + 7), deckSpec(planFor));
        buildMs += performance.now() - t0;

        zoneTotal += gen.level.zones.length;
        for (const z of gen.level.zones) airlockTotal += z.airlocks.length;
        for (const p of deckProblems(gen)) failures.push(`seed ${s} depth ${depth}: ${p}`);
      }
    }

    expect(failures.slice(0, 10).join("\n")).toBe("");
    expect(zoneTotal / 1600).toBeGreaterThanOrEqual(4);
    expect(airlockTotal).toBeGreaterThan(0);
    // 20 s is the point where running these tests stops being free.
    expect(buildMs, `${Math.round(buildMs)} ms of build time`).toBeLessThan(20000);
  }, 180000);

  it("builds a sound deck out of any single interior style", () => {
    for (const style of ["open", "rooms", "cluttered"] as const) {
      const plan = (): DeckPlan => ({ zones: [{ kind: style, name: style.toUpperCase(), interior: style }] });
      const failures: string[] = [];
      for (let s = 0; s < 60; s++) {
        const gen = buildLevel(1 + (s % 8), new Rng(s + 91000), deckSpec(plan));
        for (const p of deckProblems(gen)) failures.push(`${style} seed ${s}: ${p}`);
      }
      expect(failures.slice(0, 5).join("\n")).toBe("");
    }
  }, 120000);

  it("uses the whole catalog, so all three interior styles show up", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s * 13 + 1), deckSpec(planFor));
      for (const z of gen.level.zones) seen.add(z.kind);
    }
    for (const spec of CATALOG) expect(seen, `kind ${spec.kind} never appeared`).toContain(spec.kind);
  }, 120000);

  it("puts the entry and the hatch in the zones the plan named", () => {
    const plan = (): DeckPlan => ({ zones: CATALOG, entryIn: "cargo", stairsIn: "reactor" });
    for (let s = 0; s < 40; s++) {
      const gen = buildLevel(3, new Rng(s + 4400), deckSpec(plan, { minStairsDistance: 10 }));
      expect(gen.level.zoneAt(gen.entry)?.kind, `seed ${s} entry`).toBe("cargo");
      expect(gen.level.zoneAt(gen.stairs)?.kind, `seed ${s} stairs`).toBe("reactor");
      expect(gen.level.tiles.at(gen.stairs.x, gen.stairs.y)).toBe(Tile.StairsDown);
    }
  }, 60000);

  it("is a pure function of the seed", () => {
    const dump = (seed: number) => {
      const gen = buildLevel(4, new Rng(seed), deckSpec(planFor));
      let tiles = "";
      gen.level.tiles.forEach((_x, _y, t) => (tiles += String(t)));
      return `${tiles}|${JSON.stringify(gen.level.zones)}|${JSON.stringify(gen.entry)}${JSON.stringify(gen.stairs)}`;
    };
    expect(dump(2024)).toBe(dump(2024));
    expect(dump(2024)).not.toBe(dump(2025));
  });

  it("would notice a hole punched through a zone wall", () => {
    // The isolation sweep is the whole point of this file, so it has to be
    // able to fail: open one wall tile with two zones' floor around it and the
    // same check must complain.
    const gen = buildLevel(3, new Rng(8081), deckSpec(planFor));
    expect(deckProblems(gen)).toEqual([]);

    const zg = zoneGrid(gen.level);
    let breach: Point | undefined;
    gen.level.tiles.forEach((x, y, t) => {
      if (breach || TILES[t].walkable) return;
      const around = new Set<number>();
      for (const d of DIRS8) {
        const n = gen.level.tiles.get(x + d.x, y + d.y);
        if (n !== undefined && TILES[n].walkable) around.add(zg.at(x + d.x, y + d.y));
      }
      if (around.size >= 2) breach = { x, y };
    });

    expect(breach, "no wall tile separates two zones — the map is not sectioned").toBeDefined();
    gen.level.tiles.set(breach!.x, breach!.y, Tile.Floor);
    expect(deckProblems(gen).join("\n")).toMatch(/touch at/);
  });

  it("keeps the sectors big enough to fight in", () => {
    for (let s = 0; s < 30; s++) {
      const gen = buildLevel(2, new Rng(s + 700), deckSpec(planFor));
      for (const z of gen.level.zones) {
        expect(z.rect.x2 - z.rect.x1 + 1, `zone ${z.id} width`).toBeGreaterThanOrEqual(12);
        expect(z.rect.y2 - z.rect.y1 + 1, `zone ${z.id} height`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("refuses a plan with no zones", () => {
    expect(() => buildLevel(1, new Rng(1), deckSpec(() => ({ zones: [] })))).toThrow(/empty zone catalog/);
  });
});

describe("the pipeline around the deck builder", () => {
  it("leaves a deck alone: connect:false means no tunnels through zone walls", () => {
    // Same seed, same builder, with the region-joining pass switched back on.
    // It has nothing to join, so the map must come out identical.
    const dump = (connect: boolean) => {
      const gen = buildLevel(5, new Rng(31337), deckSpec(planFor, { connect }));
      let out = "";
      gen.level.tiles.forEach((_x, _y, t) => (out += String(t)));
      return out;
    };
    expect(dump(false)).toBe(dump(true));
  });

  it("never puts the stairs on an airlock, hint or no hint", () => {
    for (let s = 0; s < 60; s++) {
      const gen = buildLevel(1 + (s % 8), new Rng(s + 2200), deckSpec(planFor));
      const airlocks = new Set<string>();
      gen.level.tiles.forEach((x, y, t) => {
        if (t === Tile.Airlock) airlocks.add(`${x},${y}`);
      });
      for (const z of gen.level.zones) {
        for (const a of z.airlocks) expect(airlocks.has(`${a.x},${a.y}`)).toBe(true);
      }
      expect(airlocks.has(`${gen.stairs.x},${gen.stairs.y}`)).toBe(false);
    }
  }, 60000);
});
