import { describe, it, expect } from "vitest";
import {
  DeckBuilder,
  Level,
  Rng,
  generateLevel,
  type DeckPlan,
  type Point,
  type Zone,
  type ZoneKindSpec,
} from "@jamrog/engine";
import { deckMapLines, type DeckMapLine } from "../src/ui/deckmap.js";
import { THEME } from "../src/ui/theme.js";

/**
 * The schematic is the only place the deck graph is ever shown, so it is tested
 * as text: what a player would read off the sidebar. What matters is that a
 * node lands where its sector actually is — the sketch is useless if the
 * reactor sits bottom right on the map and top left on the schematic — and that
 * a line appears exactly between the zones an airlock joins.
 *
 * Two kinds of level are used: hand-built ones whose geometry is known to the
 * tile, and a real DeckBuilder deck to prove the reader survives generated
 * geometry.
 */

/** Sidebar width minus its gutter column, and the lines the section may spend. */
const MAX_WIDTH = 25;
const MAX_LINES = 9;

const CATALOG: ZoneKindSpec[] = [
  { kind: "cargo", name: "CARGO BAY", interior: "open", size: 1.5, density: "sparse" },
  { kind: "hab", name: "HAB BLOCK", interior: "rooms", density: "normal" },
  { kind: "storage", name: "STORAGE", interior: "cluttered", density: "dense" },
  { kind: "med", name: "MED BAY", interior: "rooms", size: 0.7, density: "normal" },
];

const planFor = (): DeckPlan => ({ zones: CATALOG });

const CELL_W = 20;
const CELL_H = 10;

/**
 * Zones laid out on a real coordinate grid, row-major: `["A", "B", "C", "D"]`
 * over two columns is A B on top and C D underneath. No airlocks yet — the
 * tests join the pairs they care about.
 */
function gridLevel(cols: number, names: string[]): Level {
  const rows = Math.ceil(names.length / cols);
  const level = new Level(1, cols * CELL_W, rows * CELL_H);
  names.forEach((name, i) => {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    level.zones.push({
      id: i,
      kind: "test",
      name,
      rect: { x1: cx * CELL_W, y1: cy * CELL_H, x2: cx * CELL_W + CELL_W - 1, y2: cy * CELL_H + CELL_H - 1 },
      airlocks: [],
    });
  });
  return level;
}

/** Give two zones an airlock in common: that, and only that, is an edge. */
function join(level: Level, a: number, b: number): void {
  const za = level.zones.find((z) => z.id === a)!;
  const zb = level.zones.find((z) => z.id === b)!;
  const shared: Point = { x: za.rect.x2, y: za.rect.y2 };
  za.airlocks.push(shared);
  zb.airlocks.push(shared);
}

function exploreZone(level: Level, id: number): void {
  const z = level.zones.find((zone) => zone.id === id)!;
  level.explored.set(z.rect.x1 + 1, z.rect.y1 + 1, true);
}

function centreOf(level: Level, id: number): Point {
  const r = level.zones.find((z) => z.id === id)!.rect;
  return { x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1 };
}

function text(lines: DeckMapLine[]): string {
  return lines.map((l) => l.text).join("\n");
}

/** Where a label starts, as (line, column). Undefined when it is not drawn. */
function findAt(lines: DeckMapLine[], needle: string): { line: number; col: number } | undefined {
  for (let i = 0; i < lines.length; i++) {
    const col = lines[i]!.text.indexOf(needle);
    if (col >= 0) return { line: i, col };
  }
  return undefined;
}

describe("deck schematic", () => {
  it("draws nothing for a level without zones", () => {
    const gen = generateLevel(1, new Rng(7));
    expect(gen.level.zones).toHaveLength(0);
    expect(deckMapLines(gen.level, gen.entry)).toEqual([]);
  });

  it("brackets the zone the player is standing in and accents its line", () => {
    const level = gridLevel(2, ["ALPHA", "BETA"]);
    join(level, 0, 1);
    exploreZone(level, 0);
    exploreZone(level, 1);

    const lines = deckMapLines(level, centreOf(level, 1));
    expect(text(lines)).toContain("[BETA]");
    expect(text(lines)).not.toContain("[ALPHA]");

    const here = lines.find((l) => l.text.includes("[BETA]"))!;
    expect(here.fg).toBe(THEME.accent);
    expect(lines.filter((l) => l.fg !== undefined)).toHaveLength(1);
  });

  it("hides the name of a zone that has never been entered", () => {
    const level = gridLevel(2, ["ALPHA", "BETA"]);
    join(level, 0, 1);
    exploreZone(level, 0);

    const lines = deckMapLines(level, centreOf(level, 0));
    expect(text(lines)).toContain("[ALPHA]");
    expect(text(lines)).toContain("····");
    expect(text(lines)).not.toContain("BETA");
  });

  it("puts each node where its sector is, not where a list would put it", () => {
    // NW NE / SW SE. Whatever the schematic scales to, west stays left of east
    // and north stays above south.
    const level = gridLevel(2, ["NW", "NE", "SW", "SE"]);
    for (const z of level.zones) exploreZone(level, z.id);

    const lines = deckMapLines(level, centreOf(level, 3));
    const nw = findAt(lines, "NW")!;
    const ne = findAt(lines, "NE")!;
    const sw = findAt(lines, "SW")!;
    const se = findAt(lines, "[SE]")!;

    expect(nw.col).toBeLessThan(ne.col);
    expect(sw.col).toBeLessThan(se.col);
    expect(nw.line).toBeLessThan(sw.line);
    expect(ne.line).toBeLessThan(se.line);
    expect(nw.line).toBe(ne.line);
  });

  it("rules a line between zones an airlock joins, and nothing between the rest", () => {
    const level = gridLevel(2, ["WEST", "EAST"]);
    for (const z of level.zones) exploreZone(level, z.id);

    const apart = deckMapLines(level, centreOf(level, 0));
    const between = (lines: DeckMapLine[]): string => {
      const row = lines.find((l) => l.text.includes("EAST"))!.text;
      return row.slice(row.indexOf("]") + 1, row.indexOf("EAST"));
    };
    expect(between(apart).trim()).toBe("");

    join(level, 0, 1);
    const joined = deckMapLines(level, centreOf(level, 0));
    expect(between(joined)).toMatch(/^─+$/);
  });

  it("drops a vertical link from a zone to the one below it", () => {
    const level = gridLevel(1, ["TOP", "UNDER"]);
    join(level, 0, 1);
    for (const z of level.zones) exploreZone(level, z.id);

    const lines = deckMapLines(level, centreOf(level, 0));
    expect(lines).toHaveLength(3);
    expect(lines[1]!.text.trim()).toBe("│");
    expect(findAt(lines, "[TOP]")!.line).toBe(0);
    expect(findAt(lines, "UNDER")!.line).toBe(2);
  });

  it("turns a corner when the two zones are neither in line nor level", () => {
    const level = gridLevel(2, ["NW", "NE", "SW", "SE"]);
    join(level, 1, 2); // NE down to SW: the link has to travel and turn.
    for (const z of level.zones) exploreZone(level, z.id);

    const lines = deckMapLines(level, centreOf(level, 0));
    expect(text(lines)).toMatch(/[└┘┌┐┤├┴┬┼]/);
  });

  it("draws a deck with a hole in the hull, gap and all", () => {
    // A real station is not a full rectangle: the builder leaves cells empty
    // where the hull is cut away. Six cells, four sectors, the middle of each
    // row missing — the two sectors either side of the top gap are joined, and
    // the schematic has to run that link across the hole rather than drop it.
    const level = new Level(1, 3 * CELL_W, 2 * CELL_H);
    const cells: Array<[string, number, number]> = [
      ["PORT", 0, 0],
      ["STBD", 2, 0],
      ["HOLD", 0, 1],
      ["CORE", 2, 1],
    ];
    cells.forEach(([name, cx, cy], i) => {
      level.zones.push({
        id: i,
        kind: "test",
        name,
        rect: { x1: cx * CELL_W, y1: cy * CELL_H, x2: cx * CELL_W + CELL_W - 1, y2: cy * CELL_H + CELL_H - 1 },
        airlocks: [],
      });
    });
    join(level, 0, 1); // PORT — STBD, straight across the missing cell
    join(level, 1, 3); // STBD — CORE, straight down
    for (const z of level.zones) exploreZone(level, z.id);

    const lines = deckMapLines(level, centreOf(level, 0));
    const port = findAt(lines, "[PORT]")!;
    const stbd = findAt(lines, "STBD")!;
    const hold = findAt(lines, "HOLD")!;
    const core = findAt(lines, "CORE")!;

    // Every sector keeps its corner of the deck: west stays west, fore stays fore.
    expect(port.line).toBe(stbd.line);
    expect(hold.line).toBe(core.line);
    expect(port.col).toBeLessThan(stbd.col);
    expect(hold.col).toBeLessThan(core.col);
    expect(port.line).toBeLessThan(hold.line);

    // The hole costs the sidebar nothing: sectors are ranked, not scaled, so
    // the cutaway deck draws exactly like the same four sectors packed side by
    // side, rather than spending a third of a 25-column panel on empty hull.
    const packed = gridLevel(2, ["PORT", "STBD", "HOLD", "CORE"]);
    join(packed, 0, 1);
    join(packed, 1, 3);
    for (const z of packed.zones) exploreZone(packed, z.id);
    expect(text(lines)).toBe(text(deckMapLines(packed, centreOf(packed, 0))));

    // The link crosses the hole: an unbroken rule between the two labels.
    const top = lines[port.line]!.text;
    expect(top.slice(top.indexOf("]") + 1, stbd.col)).toMatch(/^─+$/);

    // PORT and HOLD share no airlock, so the column under PORT stays clear.
    const between = lines[port.line + 1]!.text;
    expect(between.slice(0, stbd.col).trim()).toBe("");

    for (const l of lines) expect(l.text.length, l.text).toBeLessThanOrEqual(MAX_WIDTH);
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
  });

  it("stays inside the sidebar, whatever the deck throws at it", () => {
    const level = gridLevel(4, Array.from({ length: 16 }, (_, i) => `ZONE${i}LONGNAME`));
    for (let i = 0; i + 1 < level.zones.length; i++) join(level, i, i + 1);
    for (const z of level.zones) exploreZone(level, z.id);

    const lines = deckMapLines(level, centreOf(level, 0));
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES);
    for (const l of lines) expect(l.text.length, l.text).toBeLessThanOrEqual(MAX_WIDTH);
  });

  it("reads a real generated deck", () => {
    for (let seed = 0; seed < 60; seed++) {
      const gen = generateLevel(1 + (seed % 6), new Rng(seed + 2026), {
        width: 70,
        height: 34,
        builder: new DeckBuilder(planFor),
        connect: false,
        vaultCount: 0,
      });
      const level = gen.level;
      expect(level.zones.length).toBeGreaterThan(1);

      const here = level.zoneAt(gen.entry)!;
      exploreZone(level, here.id);

      const lines = deckMapLines(level, gen.entry);
      expect(lines.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(lines.length, `seed ${seed}`).toBeLessThanOrEqual(MAX_LINES);
      for (const l of lines) expect(l.text.length, `seed ${seed}: "${l.text}"`).toBeLessThanOrEqual(MAX_WIDTH);

      // The player's zone is bracketed and accented; every other zone on this
      // deck is still unvisited, so the graph shows placeholders around it.
      expect(text(lines), `seed ${seed}`).toContain("[");
      expect(text(lines), `seed ${seed}`).toContain("····");
      expect(lines.filter((l) => l.fg === THEME.accent), `seed ${seed}`).toHaveLength(1);

      // Every zone got a node: nothing on a real deck is silently dropped.
      const nodes = text(lines).match(/\[|····|[A-Z]{2,}/g) ?? [];
      expect(nodes.length, `seed ${seed}: ${lines.length} lines`).toBeGreaterThanOrEqual(level.zones.length);
    }
  }, 60000);
});
