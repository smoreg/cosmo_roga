import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAPGEN,
  DIRS8,
  DeckBuilder,
  Grid,
  Rng,
  Tile,
  TILES,
  distanceField,
  findRegions,
  generateLevel,
  type Entity,
  type Game,
  type GeneratedLevel,
  type Level,
  type Point,
  type RoomRect,
} from "@jamrog/engine";
import { newGame } from "../src/game.js";
import { DECKS, ZONE_KINDS, deckPlan } from "../src/content/zones.js";
import { STORYLETS } from "../src/content/storylets.js";
import { FORTNIGHT2 } from "../src/content/pack.js";
import { makeStartingRig } from "../src/twist/rig.js";
import { deckOf } from "../src/twist/rig.js";

/**
 * The station as content: zones per deck, storylets stamped into them, and the
 * markers those cards leave turned into machines and salvage.
 *
 * The engine has its own tests for the deck builder; these run the game the UI
 * runs, through the real turn cycle, with the real catalog — the failure this
 * file exists to catch is a card or a plan that is legal in the abstract and
 * builds a broken station in practice.
 */

const DECK_COUNT = DECKS.length;

/** Drop the drone on the hatch and take it. The bots' route, without the walk. */
function warpToStairs(game: Game): void {
  const stairs = stairsOf(game.level);
  expect(stairs, `depth ${game.depth} has no hatch`).toBeDefined();
  game.player.pos = { ...stairs! };
  game.descend();
}

function stairsOf(level: Level): Point | undefined {
  let found: Point | undefined;
  level.tiles.forEach((x, y, t) => {
    if (t === Tile.StairsDown) found = { x, y };
  });
  return found;
}

/** Every deck of one run, in order, without playing it. */
function decksOf(seed: number, upTo = DECK_COUNT): Game[] {
  const game = newGame(seed);
  const seen: Game[] = [game];
  for (let d = 1; d < upTo; d++) {
    warpToStairs(game);
    seen.push(game);
  }
  return seen;
}

function zoneKinds(game: Game): string[] {
  return game.level.zones.map((z) => z.kind);
}

function cardNames(game: Game): string[] {
  return game.lastGen.vaults.map((v) => v.vault.name);
}

// ------------------------------------------------------- the zone invariant

/**
 * Copied from packages/engine/tests/deck.test.ts on purpose: a game may not
 * reach into the engine's own test helpers, and the invariant is worth
 * re-asserting against the real catalog rather than the toy one.
 */
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

/** Every complaint one generated deck can raise. Empty means it is sound. */
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
      if (!TILES[tiles.at(nx, ny)].walkable) continue;
      if (zg.at(nx, ny) === zg.at(x, y)) continue;
      if (t === Tile.Airlock || tiles.at(nx, ny) === Tile.Airlock) continue;
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
  for (const [k, [, b]] of edges) {
    if (b < 0) bad.push(`airlock ${k} is recorded on one zone only`);
  }
  if (edges.size !== onMap.size) bad.push(`${onMap.size} airlock tiles vs ${edges.size} recorded edges`);

  const seen = new Set<number>([zones[0]?.id ?? 0]);
  for (let pass = 0; pass < zones.length; pass++) {
    for (const [, [a, b]] of edges) {
      if (seen.has(a)) seen.add(b);
      if (seen.has(b)) seen.add(a);
    }
  }
  if (seen.size !== zones.length) bad.push(`zone graph is disconnected: ${seen.size}/${zones.length}`);

  if (onMap.has(airlockKey(gen.stairs))) bad.push(`stairs ${airlockKey(gen.stairs)} sit in an airlock`);
  if (zg.at(gen.stairs.x, gen.stairs.y) < 0) bad.push("stairs belong to no zone");
  if (zg.at(gen.entry.x, gen.entry.y) < 0) bad.push("entry belongs to no zone");

  return bad;
}

// ---------------------------------------------------------------- the tests

describe("the station generates", () => {
  it("builds all six decks of 100 runs without a single validator complaint", () => {
    const failures: string[] = [];
    for (let s = 0; s < 100; s++) {
      for (const game of decksOf(s + 310000)) {
        if (game.lastGen.problems.length > 0) {
          failures.push(`seed ${s} depth ${game.depth}: ${JSON.stringify(game.lastGen.problems)}`);
        }
      }
    }
    expect(failures.slice(0, 10).join("\n")).toBe("");
  }, 240000);

  it("keeps the zones isolated with the real storylet deck, 200 seeds x 6 decks", () => {
    const failures: string[] = [];
    for (let s = 0; s < 200; s++) {
      for (const game of decksOf(s + 420000)) {
        for (const p of deckProblems(game.lastGen)) failures.push(`seed ${s} depth ${game.depth}: ${p}`);
      }
    }
    expect(failures.slice(0, 10).join("\n")).toBe("");
  }, 300000);

  it("is a pure function of the seed, storylets included", () => {
    const dump = (seed: number) => decksOf(seed).map((g) => `${zoneKinds(g)}|${cardNames(g)}`).join("/");
    expect(dump(4242)).toBe(dump(4242));
    expect(dump(4242)).not.toBe(dump(4243));
  }, 60000);
});

describe("deck 1 is the tutorial", () => {
  it("always opens in a docking bay with salvage within four steps", () => {
    for (let s = 0; s < 100; s++) {
      const game = newGame(s + 510000);

      expect(zoneKinds(game), `seed ${s}: no docking bay`).toContain("docking");
      expect(game.level.zoneAt(game.player.pos)?.kind, `seed ${s}: entry`).toBe("docking");
      expect(cardNames(game), `seed ${s}: no docking bay card`).toContain("docking bay");

      const dist = distanceField(game.level, game.player.pos);
      const reach = deckOf(game).wrecks.map((w) => dist.get(w.x, w.y) ?? -1).filter((d) => d >= 0);
      expect(Math.min(...reach), `seed ${s}: nearest salvage`).toBeLessThanOrEqual(4);
    }
  }, 120000);
});

describe("deck 6 is the reactor", () => {
  it("always draws the antechamber and puts the hatch in the reactor", () => {
    for (let s = 0; s < 60; s++) {
      const decks = decksOf(s + 610000);
      const last = decks[decks.length - 1]!;
      expect(last.depth).toBe(DECK_COUNT);
      expect(cardNames(last), `seed ${s}: no antechamber`).toContain("reactor antechamber");
      expect(last.level.zoneAt(stairsOf(last.level)!)?.kind, `seed ${s}: hatch zone`).toBe("reactor");
    }
  }, 180000);
});

describe("markers become things", () => {
  it("leaves nothing drawn on a card unbuilt and nothing standing in a wall", () => {
    const failures: string[] = [];
    for (let s = 0; s < 60; s++) {
      for (const game of decksOf(s + 720000)) {
        const wrecks = new Set(deckOf(game).wrecks.map((w) => `${w.x},${w.y}`));
        const bodies = new Set(game.entities.map((e) => `${e.pos.x},${e.pos.y}`));
        for (const placed of game.lastGen.vaults) {
          for (const mark of placed.marks) {
            const at = `${mark.pos.x},${mark.pos.y}`;
            const where = `seed ${s} depth ${game.depth} ${placed.vault.name} '${mark.ch}' at ${at}`;
            if (!game.level.isWalkable(mark.pos.x, mark.pos.y)) failures.push(`${where}: in a wall`);
            else if (!wrecks.has(at) && !bodies.has(at)) failures.push(`${where}: nothing there`);
          }
        }
      }
    }
    expect(failures.slice(0, 10).join("\n")).toBe("");
  }, 180000);

  // Two since G9: deck 1 is the tutorial, and its budget dropped to one on top
  // of the machine the docking bay card always stamps.
  it("puts two machines on deck 1: the budget of one plus the card's one", () => {
    for (let s = 0; s < 40; s++) {
      const game = newGame(s + 810000);
      const machines = game.entities.filter((e) => e.id !== game.player.id).length;
      expect(machines, `seed ${s}`).toBe(2);
    }
  }, 60000);
});

describe("storylets read the run", () => {
  /** A rack whose scanner burned and whose slot was refilled: only `burned` differs. */
  function drone(scannerBurned: boolean): Entity {
    const player = FORTNIGHT2.makePlayer({ x: 1, y: 1 });
    const rig = makeStartingRig();
    if (scannerBurned) {
      const i = rig.slots.findIndex((s) => s?.kind === "scanner");
      rig.slots[i] = { kind: "plating", integrity: 6 };
      rig.scars[i] = null;
      rig.burned.push("scanner");
      rig.burnedCount = rig.burned.length;
    }
    player.data = { ...(player.data ?? {}), rig };
    return player;
  }

  const CLOSET = STORYLETS.find((v) => v.name === "sensor closet")!;

  /**
   * One Bernoulli trial per deck: the lowest-numbered compartment the closet
   * could occupy, and whether it did.
   *
   * Counting decks instead would saturate — a card capped at one per level
   * turns up in most of them either way, and the signal drowns. The first
   * eligible zone is unbiased: nothing has used up the card's budget yet.
   */
  function closetsIn(scannerBurned: boolean, seeds: number): { trials: number; hits: number } {
    const player = drone(scannerBurned);
    let trials = 0;
    let hits = 0;
    for (let s = 0; s < seeds; s++) {
      const depth = 2 + (s % (DECK_COUNT - 1));
      const gen = generateLevel(depth, new Rng(s + 910000), {
        ...DEFAULT_MAPGEN,
        builder: new DeckBuilder(deckPlan),
        connect: false,
        vaultCount: 0,
        flags: new Set<string>(),
        player,
      });
      if (depth < (CLOSET.minDepth ?? 1)) continue;
      const zone = gen.level.zones
        .filter((z) => CLOSET.zones!.includes(z.kind))
        .sort((a, b) => a.id - b.id)[0];
      if (!zone) continue;
      trials++;
      const card = gen.vaults.find((v) => v.zoneId === zone.id);
      if (card?.vault.name === CLOSET.name) hits++;
    }
    return { trials, hits };
  }

  it("offers the sensor closet at least twice as often once the scanner is gone", () => {
    const intact = closetsIn(false, 200);
    const gone = closetsIn(true, 200);
    console.log(
      `sensor closet: ${intact.hits}/${intact.trials} compartments with a scanner, ` +
        `${gone.hits}/${gone.trials} without`,
    );
    expect(intact.trials, "no compartment ever admitted the closet").toBeGreaterThan(50);
    expect(gone.trials).toBe(intact.trials);
    expect(intact.hits, "the closet never turned up at all — the weights are wrong").toBeGreaterThan(0);
    expect(gone.hits / intact.hits).toBeGreaterThanOrEqual(2);
  }, 120000);

  it("names only zone kinds the station actually has", () => {
    const known = new Set(ZONE_KINDS.map((z) => z.kind));
    for (const card of STORYLETS) {
      for (const kind of card.zones ?? []) {
        expect(known, `card "${card.name}" names an unknown zone "${kind}"`).toContain(kind);
      }
    }
  });

  it("only ever offers a card the zone and the depth admit", () => {
    for (let s = 0; s < 60; s++) {
      for (const game of decksOf(s + 1010000)) {
        for (const placed of game.lastGen.vaults) {
          const card = STORYLETS.find((v) => v.name === placed.vault.name)!;
          const zone = game.level.zones.find((z) => z.id === placed.zoneId);
          expect(zone, `seed ${s}: card ${card.name} belongs to no zone`).toBeDefined();
          if (card.zones) expect(card.zones, `${card.name} on ${zone!.kind}`).toContain(zone!.kind);
          expect(game.depth, `${card.name} on deck ${game.depth}`).toBeGreaterThanOrEqual(card.minDepth ?? 1);
        }
      }
    }
  }, 180000);
});
