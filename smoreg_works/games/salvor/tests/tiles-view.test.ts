import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomGame, Rng, hexLayout, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { DERELICTS, buildDerelict } from "../src/content/derelicts.js";
import { TILE_BY_GLYPH, TILE_IDS, ZONE_IDS } from "../src/tiles/sprites.js";
import { HAZARDS, HAZARD_IDS } from "../src/content/hazards.js";
import { hullArtOf } from "../src/content/hulls-art.js";
import { hexSvgOf } from "../src/ui/web/hex-svg.js";
import type { DoorState, RoomState, SchematicDoor, SchematicInput, SchematicRoom } from "../src/ui/schematic.js";
import { bannerLine, schematicInputOf } from "../src/ui/schematic-input.js";
import { svgOf } from "../src/ui/web/schematic-svg.js";
import { PICTOGRAM_KINDS, zoneIdOf } from "../src/ui/web/tiles.js";

/**
 * Tiles on the schematic (`?tiles=1`), tested as the text they are.
 *
 * The feature's whole promise is a negative one — **a tile replaces a glyph and
 * never a word, and where there is no tile the letter stays** — so most of what
 * is checked here is that nothing else moved: the plain drawing byte for byte,
 * the same compartments and door labels in both modes, and a mark outside the
 * set still coming out as its letter.
 *
 * The rest is measurement, because the two ways a tileset fails are both
 * geometric and neither shows up in a string comparison: a label lying under a
 * picture (docs/gui-guides.md, 6.7), and tiles touching each other in a dense
 * row until the group reads as one shape (6.10, docs/tiles-design.md, 2.5). Both
 * are measured at the scale the schematic actually runs at on the itch page,
 * not at the scale the set was drawn at — the point of 6.1 is that a tile
 * checked at 400 % tells you nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));

const GOLDEN_SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d2:k1]- r3
  r2 -d3- r4
  r3 -#d4#- r5
  r4 -d5- r6
  r6 -d6- r7
  r7 -d7- r2
  r1: docking explored
  r2: cargo cover explored
  r3: storage scanned
  r4: hab explored
  r5: reactor
  r6: mess explored
  r7: lab scanned
`;

function goldenGame(): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(GOLDEN_SHIP).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed: 7 });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  return game;
}

// ------------------------------------------------------- the drawing untouched

describe("the schematic with tiles switched off", () => {
  it("is byte for byte the drawing it was before there were tiles", () => {
    // `?tiles=1` promises that leaving it out changes nothing, and "nothing" is
    // a file: the output of this very call, written down before `svgOf` learned
    // its third argument. A failure here may be right, but has to be on
    // purpose, and then the file is re-recorded.
    const game = goldenGame();
    const svg = svgOf(schematicInputOf(game), bannerLine(game));
    const golden = readFileSync(join(here, "fixtures", "schematic-svg-before-tiles.svg"), "utf8");
    expect(svg).toBe(golden);
  });

  it("carries no symbol, no reference and no tile class", () => {
    const game = goldenGame();
    const svg = svgOf(schematicInputOf(game), bannerLine(game));
    expect(svg).not.toContain("<defs>");
    expect(svg).not.toContain("<use");
    expect(svg).not.toContain("has-tiles");
    expect(svg).not.toContain("<symbol");
  });
});

describe("the two modes of one drawing", () => {
  const game = goldenGame();
  const input = schematicInputOf(game);
  const plain = svgOf(input, bannerLine(game));
  const tiled = svgOf(input, bannerLine(game), true);

  it("shows the same compartments", () => {
    expect(rooms(tiled)).toEqual(rooms(plain));
    expect(rooms(tiled).length).toBe(game.ship.rooms.length);
  });

  it("shows the same doors, each still labelled in text", () => {
    expect(labels(tiled)).toEqual(labels(plain));
    expect(labels(tiled).length).toBeGreaterThan(0);
  });

  it("keeps every compartment's name and id as text", () => {
    for (const cls of ["room-name", "room-id"]) {
      expect(count(tiled, `class="${cls}"`)).toBe(count(plain, `class="${cls}"`));
    }
  });

  it("says the same hull line and the same banner", () => {
    expect(textOf(tiled, "ship-line")).toEqual(textOf(plain, "ship-line"));
    expect(textOf(tiled, "banner")).toEqual(textOf(plain, "banner"));
  });
});

// ----------------------------------------------------- a tile, or else a letter

describe("what becomes a picture and what stays a letter", () => {
  it("draws every mark the set knows as a reference to its symbol", () => {
    const svg = svgOf(THINGS_SHIP, "", true);
    for (const glyph of ["S", "x", "%", "†"]) {
      const name = TILE_BY_GLYPH[glyph]!;
      expect(svg).toContain(`href="#${TILE_IDS[name]}"`);
    }
  });

  it("draws a mark the set does not know as the letter it always was", () => {
    // Two of them, and neither is an oversight. `a1` is the airlock's own label
    // — a name the player types, which must not become a silhouette — and `¤`
    // stands for the open bottom of the mark vocabulary: `content/cards.ts`
    // takes any `marks` entry, so a card can put a glyph on the map that no
    // artist has drawn, and one grey placeholder box on three different things
    // would be worse than three letters (docs/tiles-design.md, 3).
    const svg = svgOf(THINGS_SHIP, "", true);
    expect(TILE_BY_GLYPH["a1"]).toBeUndefined();
    expect(TILE_BY_GLYPH["¤"]).toBeUndefined();
    expect(svg).toContain(">a1</text>");
    expect(svg).toContain(">¤</text>");
    // As a glyph, in the glyph's own class: the same ink the letter had.
    for (const cell of cells(svg, "glyph")) expect(cell).not.toContain("<use");
  });

  it("names the machines in the colour of trouble and nothing else", () => {
    const svg = svgOf(THINGS_SHIP, "", true);
    // Two machines in r2 (`hostiles: 3` is 2n-1 terminal columns), and the
    // scrap behind them is not one of them.
    expect(count(svg, 'class="tile hostile"')).toBe(2);
  });

  it("carries the word with the picture, so the tile is never the only statement", () => {
    const game = goldenGame();
    const svg = svgOf(schematicInputOf(game), "", true);
    for (const use of svg.match(/<use[^>]*class="tile[^"]*"[^>]*>.*?<\/use>/g) ?? []) {
      expect(use).toMatch(/<title>[^<]+<\/title>/);
    }
  });
});

describe("every reference the drawing makes", () => {
  it("resolves to a symbol the drawing itself carries", () => {
    const svg = svgOf(THINGS_SHIP, "", true);
    const defs = svg.slice(svg.indexOf("<defs>"), svg.indexOf("</defs>"));
    expect(used(svg).size).toBeGreaterThan(0);
    for (const id of used(svg)) expect(defs).toContain(`<symbol id="${id}"`);
  });

  it("resolves to a symbol the set still exports, which renaming one would break", () => {
    // The check across the module boundary: a symbol renamed in
    // `tiles/sprites.ts` and not here would be an empty space on the map and
    // nothing at all in the console.
    const known = new Set([...Object.values(TILE_IDS), ...Object.values(ZONE_IDS)]);
    const game = goldenGame();
    for (const id of used(svgOf(schematicInputOf(game), "", true))) expect(known.has(id)).toBe(true);
  });

  it("carries only the symbols this frame uses, not the whole set", () => {
    const svg = svgOf(THINGS_SHIP, "", true);
    expect(count(svg, "<symbol")).toBe(used(svg).size);
    expect(count(svg, "<symbol")).toBeLessThan(Object.keys(TILE_IDS).length);
  });
});

// --------------------------------------------------- the compartment's own mark

describe("the pictogram beside a compartment's name", () => {
  it("is drawn for the six kinds that earn one and for no others", () => {
    const svg = svgOf(KINDS_SHIP, "", true);
    for (const kind of ["docking", "reactor", "cargo"]) {
      expect(svg).toContain(`href="#${ZONE_IDS[`zone.${kind}`]}"`);
    }
    for (const kind of ["corridor", "mess", "brig"]) {
      expect(zoneIdOf(kind)).toBeUndefined();
      expect(svg).not.toContain(`href="#${ZONE_IDS[`zone.${kind}`]}"`);
    }
    expect(PICTOGRAM_KINDS.size).toBe(6);
  });

  it("is never drawn on a compartment nobody has looked into", () => {
    // What a compartment is for is exactly what an unknown box does not know,
    // and a reactor's silhouette on a dashed box would say otherwise.
    const svg = svgOf(KINDS_SHIP, "", true);
    const box = group(svg, 9);
    expect(box).toContain("is-unknown");
    expect(box).not.toContain("zone-tile");
  });

  it("moves the name out from under itself and leaves every other name alone", () => {
    const tiled = svgOf(KINDS_SHIP, "", true);
    const plain = svgOf(KINDS_SHIP, "");
    // A compartment with a pictogram: the name starts further in.
    expect(nameX(group(tiled, 1))).toBeGreaterThan(nameX(group(plain, 1)));
    // One without: the drawing is what it was.
    expect(nameX(group(tiled, 3))).toBe(nameX(group(plain, 3)));
  });
});

// ------------------------------------------------------------- the measurements

/**
 * How many CSS pixels one view unit is worth on the itch page.
 *
 * The viewport is 1718x764 and the map column takes 1258x602 of it
 * (docs/itch-page.md, ui/web/styles.ts); `preserveAspectRatio="xMidYMid meet"`
 * makes the scale the smaller of the two ratios. Everything below is measured
 * through this, because a gap that is fine at 400 % and gone at 100 % is the
 * failure the rule exists for.
 */
function scaleOf(svg: string): number {
  const [w, h] = viewBox(svg);
  return Math.min(1258 / w, 602 / h);
}

/**
 * The worst scale the game can put a compartment on screen at: the widest hull
 * any class generates, since the more compartments a drawing carries the
 * smaller each one is drawn.
 *
 * Measured rather than assumed, and the measuring is the point. The design note
 * put the schematic at 2.0–2.6x from the size of a hand-drawn fixture; a hull
 * the generator actually makes comes out near 1.2, which is half the room the
 * tiles were first sized against (docs/tiles-design.md, 2.2). A two-room
 * fixture would have passed every assertion below and told us nothing.
 */
const WORST_SCALE = (() => {
  let worst = Infinity;
  for (const spec of DERELICTS) {
    for (let seed = 1; seed <= 12; seed++) {
      const built = buildDerelict(spec, 4, new Rng(seed), { flags: new Set(), shipIndex: 1 });
      const config: Omit<RoomGameConfig, "seed"> = {
        ...GAME_CONFIG,
        content: SALVOR,
        firstShip: () => built.ship,
        firstShipId: "1",
      };
      const game = new RoomGame({ ...config, seed });
      game.player.room = game.ship.rooms[0]!.id;
      game.refreshSight();
      worst = Math.min(worst, scaleOf(svgOf(schematicInputOf(game), "")));
    }
  }
  return worst;
})();

describe("a dense compartment at the size it is actually drawn", () => {
  // The control frame Kyzrati asks for: not one handsome tile, but the row a
  // busy compartment produces — three machines, scrap, a body and a system.
  const svg = svgOf(DENSE_SHIP, "", true);
  // Not this fixture's own generous scale: the one a real hull is drawn at.
  const scale = WORST_SCALE;
  const row = tiles(group(svg, 2));

  it("draws all six of them", () => {
    expect(row.length).toBe(6);
  });

  it("shows each of them at or above the size the set was drawn for", () => {
    // 12x12 is the floor, not the target: below it a tile reads slower than the
    // letter it replaced (docs/gui-guides.md, 6.1). And it has to clear the
    // floor on the biggest hull the game makes, not on a two-room fixture.
    expect(WORST_SCALE).toBeLessThan(2);
    for (const tile of row) expect(tile.w * scale).toBeGreaterThanOrEqual(12);
  });

  it("leaves daylight between every pair, so the row is six things and not one", () => {
    for (let i = 1; i < row.length; i++) {
      const gap = (row[i]!.x - (row[i - 1]!.x + row[i - 1]!.w)) * scale;
      expect(gap).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the whole row inside the compartment it belongs to", () => {
    const box = boxOf(group(svg, 2));
    for (const tile of row) {
      expect(tile.x).toBeGreaterThanOrEqual(box.x);
      expect(tile.x + tile.w).toBeLessThanOrEqual(box.x + box.w);
      expect(tile.y).toBeGreaterThanOrEqual(box.y);
      expect(tile.y + tile.h).toBeLessThanOrEqual(box.y + box.h);
    }
  });

  it("counts the seventh thing rather than drawing it off the edge", () => {
    const crowded = svgOf(CROWDED_SHIP, "", true);
    const box = boxOf(group(crowded, 2));
    // Seven things in a row that holds six: five pictures and a count of the
    // rest, because the counter needs a cell of its own.
    expect(crowded).toContain(">+2</text>");
    expect(tiles(group(crowded, 2)).length).toBe(5);
    for (const label of texts(group(crowded, 2))) {
      expect(label.x).toBeLessThanOrEqual(box.x + box.w);
    }
  });
});

describe("the labels a tile may never lie under", () => {
  // The one rule of the whole feature that a player would notice being broken:
  // the compartment's name, `rN` and the door labels stay readable, because
  // they are the only way to know where a door goes (docs/gui-guides.md, 6.7).
  const svg = svgOf(DENSE_SHIP, "", true);

  it("keeps every picture clear of every word on the drawing", () => {
    for (const g of groups(svg)) {
      for (const tile of tiles(g)) {
        for (const label of texts(g)) {
          expect(overlaps(tile, boxOfText(label))).toBe(false);
        }
      }
    }
  });

  it("keeps the door labels clear of every picture on the drawing", () => {
    const plates = [...svg.matchAll(/<rect class="door-tag" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)];
    expect(plates.length).toBeGreaterThan(0);
    const all = groups(svg).flatMap((g) => tiles(g));
    for (const plate of plates) {
      const rect = { x: +plate[1]!, y: +plate[2]!, w: +plate[3]!, h: +plate[4]! };
      for (const tile of all) expect(overlaps(tile, rect)).toBe(false);
    }
  });
});

// --------------------------------------------- one list, on the ships we ship

describe("the list a tile row walks and the string the terminal prints", () => {
  it("are the same contents in the same order, on every hull a run meets", () => {
    // The whole arrangement rests on this: `glyphs` is spelled out of `things`
    // (`ui/schematic-input.ts`), so the two drawings cannot come to disagree
    // about what is in a compartment. Checked on generated ships rather than on
    // a fixture, because the interesting cases — a remembered compartment, a
    // scanned snapshot, a hazard mark on a box nobody has entered — are ones no
    // hand-written input produces.
    for (let seed = 1; seed <= 40; seed++) {
      const game = newGame(seed);
      for (const room of schematicInputOf(game).rooms) {
        const things = room.things ?? [];
        expect(things.map((thing) => thing.glyph).join(" ")).toBe(room.glyphs);
        // And the count of machines the box paints red is the count of things
        // that say they are machines.
        const hostiles = things.filter((thing) => thing.hostile === true).length;
        expect(hostiles === 0 ? 0 : hostiles * 2 - 1).toBe(room.hostiles ?? 0);
      }
    }
  });

  it("gives every thing a word, so the picture is never the only statement", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const room of schematicInputOf(newGame(seed)).rooms) {
        for (const thing of room.things ?? []) expect(thing.name.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("a hull the game generates, drawn with tiles", () => {
  it("is one well-formed element whichever way it is drawn", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = newGame(seed);
      const svg = svgOf(schematicInputOf(game), bannerLine(game), true);
      expect(count(svg, "<svg")).toBe(1);
      expect(count(svg, "</svg>")).toBe(1);
      expect(count(svg, "<g ")).toBe(count(svg, "</g>"));
      expect(count(svg, "<text")).toBe(count(svg, "</text>"));
      expect(count(svg, "<use")).toBe(count(svg, "</use>"));
      expect(count(svg, "<defs>")).toBe(count(svg, "</defs>"));
    }
  });

  it("names no colour of its own: the tile is painted by whatever painted the glyph", () => {
    // `currentColor` throughout, so the compartment's state still decides the
    // ink and the one red on machines (G40) is untouched.
    const svg = svgOf(DENSE_SHIP, "", true);
    const defs = svg.slice(svg.indexOf("<defs>"), svg.indexOf("</defs>"));
    expect(defs.length).toBeGreaterThan(0);
    expect(defs).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(defs.includes('fill="currentColor"')).toBe(true);
  });
});

// -------------------------------------------------------------------- fixtures

const room = (
  id: number,
  name: string,
  col: number,
  row: number,
  state: RoomState,
  extra: Partial<SchematicRoom> = {},
): SchematicRoom => ({ id, label: `r${id}`, name, col, row, state, glyphs: "", ...extra });

const door = (label: string, a: number, b: number, state: DoorState): SchematicDoor => ({
  id: Number(label.replace(/\D/g, "")) || 0,
  label,
  a,
  b,
  state,
  portA: 0,
  portB: 0,
});

/** A machine, a mark with no drawing, and the airlock's own two-character label. */
const THINGS_SHIP: SchematicInput = {
  rooms: [
    room(1, "DOCKING", 0, 0, "explored", { kind: "docking", glyphs: "a1 ¤", things: [
      { glyph: "a1", name: "a1" },
      { glyph: "¤", name: "something nobody drew" },
    ] }),
    room(2, "CARGO", 1, 0, "current", { kind: "cargo", glyphs: "S x % †", hostiles: 3, things: [
      { glyph: "S", name: "security unit", hostile: true },
      { glyph: "x", name: "scrapper", hostile: true },
      { glyph: "%", name: "scrap", },
      { glyph: "†", name: "body" },
    ] }),
  ],
  doors: [door("d1", 1, 2, "open")],
  shipLine: "KESTREL · 2 rooms",
};

/** One of each interesting compartment kind, including one nobody has seen. */
const KINDS_SHIP: SchematicInput = {
  rooms: [
    room(1, "DOCKING", 0, 0, "explored", { kind: "docking" }),
    room(2, "REACTOR", 1, 0, "visible", { kind: "reactor" }),
    room(3, "CORRIDR", 2, 0, "explored", { kind: "corridor" }),
    room(4, "CARGO", 0, 1, "explored", { kind: "cargo" }),
    room(5, "MESS", 1, 1, "explored", { kind: "mess" }),
    room(9, "BRIG", 2, 1, "unknown", { kind: "reactor" }),
  ],
  doors: [door("d1", 1, 2, "open"), door("d2", 2, 3, "closed")],
  shipLine: "KESTREL · 6 rooms",
};

/** The control frame: six things in one compartment, which is the row's ceiling. */
const DENSE_SHIP: SchematicInput = {
  rooms: [
    room(1, "DOCKING", 0, 0, "explored", { kind: "docking" }),
    room(2, "CARGO", 1, 0, "current", { kind: "cargo", glyphs: "S x E % † +", hostiles: 5, things: [
      { glyph: "S", name: "security unit", hostile: true },
      { glyph: "x", name: "scrapper", hostile: true },
      { glyph: "E", name: "enforcer", hostile: true },
      { glyph: "%", name: "scrap" },
      { glyph: "†", name: "body" },
      { glyph: "+", name: "drive" },
    ] }),
  ],
  doors: [door("d1", 1, 2, "open")],
  shipLine: "KESTREL · 2 rooms",
};

/** One more than the row holds. */
const CROWDED_SHIP: SchematicInput = {
  rooms: [
    room(1, "DOCKING", 0, 0, "explored", { kind: "docking" }),
    room(2, "CARGO", 1, 0, "current", { kind: "cargo", glyphs: "S x E % † + X", hostiles: 5, things: [
      { glyph: "S", name: "security unit", hostile: true },
      { glyph: "x", name: "scrapper", hostile: true },
      { glyph: "E", name: "enforcer", hostile: true },
      { glyph: "%", name: "scrap" },
      { glyph: "†", name: "body" },
      { glyph: "+", name: "drive" },
      { glyph: "X", name: "crate" },
    ] }),
  ],
  doors: [door("d1", 1, 2, "open")],
  shipLine: "KESTREL · 2 rooms",
};

// ----------------------------------------------------------------- the readers

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Label {
  x: number;
  y: number;
  cls: string;
  anchor: string;
  body: string;
}

function count(svg: string, needle: string): number {
  return svg.split(needle).length - 1;
}

/** The frame, whichever drawing: the honeycomb's origin is not at zero. */
function viewBox(svg: string): [number, number] {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg)!;
  return [Number(m[1]), Number(m[2])];
}

function rooms(svg: string): number[] {
  return [...svg.matchAll(/data-room="(\d+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

function labels(svg: string): string[] {
  return [...svg.matchAll(/<text class="door-label"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!).sort();
}

function textOf(svg: string, cls: string): string[] {
  return [...svg.matchAll(new RegExp(`<text class="${cls}"[^>]*>([^<]*)</text>`, "g"))].map((m) => m[1]!);
}

function cells(svg: string, cls: string): string[] {
  return [...svg.matchAll(new RegExp(`<text class="${cls}[^"]*"[^>]*>[^<]*</text>`, "g"))].map((m) => m[0]);
}

function used(svg: string): Set<string> {
  const out = new Set<string>();
  for (const m of svg.matchAll(/href="#([^"]+)"/g)) out.add(m[1]!);
  return out;
}

/** One compartment's `<g>`, by the id on it. */
function group(svg: string, id: number): string {
  const start = svg.indexOf(`data-room="${id}"`);
  expect(start).toBeGreaterThan(-1);
  const from = svg.lastIndexOf("<g ", start);
  return svg.slice(from, svg.indexOf("</g>", start));
}

function groups(svg: string): string[] {
  return [...svg.matchAll(/<g class="room[^>]*>[\s\S]*?<\/g>/g)].map((m) => m[0]);
}

/** The row's own tiles. The compartment's pictogram is not one of them: it is a
 * label for the box, sits on its own line and is measured against the name. */
function tiles(fragment: string): Rect[] {
  return [...fragment.matchAll(/<use class="tile[ "][^>]*x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }));
}

function texts(fragment: string): Label[] {
  return [...fragment.matchAll(/<text class="([^"]+)" x="([-\d.]+)" y="([-\d.]+)"( text-anchor="(\w+)")?>([^<]*)<\/text>/g)].map(
    (m) => ({ cls: m[1]!, x: Number(m[2]), y: Number(m[3]), anchor: m[5] ?? "start", body: m[6]! }),
  );
}

function boxOf(fragment: string): Rect {
  const m = /<rect class="room-box" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(fragment)!;
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}

/**
 * Where a line of text sits, generously.
 *
 * The stylesheet gives `room-name` and `glyph` fourteen pixels and `room-id`
 * eleven, in the monospace stack; an advance of .68em and a box from .85em
 * above the baseline to .3em below it are both wider than any of those faces
 * actually is, which is the point — a gap that survives an overestimate is a
 * gap.
 */
function boxOfText(label: Label, view: "box" | "hex" = "box"): Rect {
  const size = view === "hex"
    ? (label.cls.startsWith("room-id") ? 10 : 13)
    : (label.cls.startsWith("room-id") ? 11 : 14);
  const w = label.body.length * size * 0.68;
  const x = label.anchor === "end" ? label.x - w : label.anchor === "middle" ? label.x - w / 2 : label.x;
  return { x, y: label.y - size * 0.85, w, h: size * 1.15 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The hexagon's own outline, as the points it is drawn from. */
function polygon(fragment: string): Rect[] | undefined {
  const m = /<polygon class="room-box" points="([^"]+)"/.exec(fragment);
  if (m === null) return undefined;
  return m[1]!.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x!, y: y!, w: 0, h: 0 };
  });
}

function cornersOf(r: Rect): Array<{ x: number; y: number }> {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Ray casting, because a hexagon is convex but the test should not have to know. */
function inside(p: { x: number; y: number }, poly: readonly Rect[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function nameX(fragment: string): number {
  return texts(fragment).find((label) => label.cls === "room-name")!.x;
}

// ============================================================ the honeycomb

/**
 * The third view, which G82 rewrote under this task: the hull is laid out
 * first and the cells grow inside it. Tiles go on top of the cells and change
 * nothing about either, so what is checked here is the same three things —
 * a picture where a mark has one, a letter where it has not, and nothing lying
 * under a word — plus the one the honeycomb adds: a hexagon is not a box, and a
 * row that fits a rectangle can still poke out through a slanted side.
 */

function hexGame(specId: string, seed: number, depth = 3): RoomGame {
  const spec = DERELICTS.find((d) => d.id === specId)!;
  const built = buildDerelict(spec, depth, new Rng(seed), { flags: new Set(), shipIndex: 1 });
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: SALVOR,
    firstShip: () => built.ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  // Stood in the busiest compartment on the hull, not in the airlock. A
  // honeycomb drawn from the entry shows one compartment's contents and twelve
  // dashed cells, and every measurement below would pass by having nothing to
  // measure.
  let best = game.ship.rooms[0]!.id;
  let most = -1;
  for (const r of game.ship.rooms) {
    game.player.room = r.id;
    game.refreshSight();
    const here = schematicInputOf(game).rooms.find((x) => x.state === "current");
    const n = here?.things?.length ?? 0;
    if (n > most) {
      most = n;
      best = r.id;
    }
  }
  game.player.room = best;
  game.refreshSight();
  return game;
}

function hexOf(game: RoomGame, tiles: boolean): string {
  const art = hullArtOf(game.ship, game.shipId);
  return hexSvgOf(schematicInputOf(game), hexLayout(game.ship, { allowed: art?.mask }), "KESTREL", art, tiles);
}

describe("the honeycomb with tiles switched off", () => {
  it("carries no symbol, no reference and no tile class", () => {
    // The golden file that holds the bare honeycomb to the byte lives in
    // `hex-svg.test.ts` and still passes; this is the same promise stated where
    // the flag is, so a future edit here cannot pass by only looking local.
    // The hull's own `<defs>` is there either way — it carries the clip path
    // the profile is cut with (G82) — so what is asserted is that no symbol of
    // the tileset joined it.
    const svg = hexOf(hexGame("freighter", 3), false);
    expect(svg).not.toContain("<symbol");
    expect(svg).not.toContain("<use class=\"tile");
    expect(svg).not.toContain("has-tiles");
  });
});

describe("the honeycomb with tiles on", () => {
  const game = hexGame("military", 2);
  const plain = hexOf(game, false);
  const tiled = hexOf(game, true);

  it("shows the same compartments and the same door labels", () => {
    expect(rooms(tiled)).toEqual(rooms(plain));
    expect(labels(tiled)).toEqual(labels(plain));
  });

  it("keeps every name and id as text", () => {
    for (const cls of ["room-name", "room-id"]) {
      expect(count(tiled, `class="${cls}"`)).toBe(count(plain, `class="${cls}"`));
    }
  });

  it("draws pictures where the set has them", () => {
    expect(count(tiled, '<use class="tile')).toBeGreaterThan(0);
    for (const id of used(tiled)) {
      expect(tiled).toContain(`<symbol id="${id}"`);
    }
  });

  it("leaves the hull underneath alone", () => {
    // The hull is the first thing in the document and everything covers it
    // (G81, G82). Tiles are drawn with the cells, so the hull's own marks are
    // the same count in both.
    expect(count(tiled, 'class="hull-')).toBe(count(plain, 'class="hull-'));
  });
});

describe("a tile inside a hexagon", () => {
  // A hexagon narrows to a point, so "inside the bounding box" is not the
  // question — a row wide enough for the middle of a cell pokes out through the
  // slanted sides lower down, where the row actually sits.
  const svg = hexOf(hexGame("military", 2), true);

  it("stays inside the outline, corner by corner", () => {
    for (const g of groups(svg)) {
      const cell = polygon(g);
      if (cell === undefined) continue;
      for (const tile of tiles(g)) {
        for (const corner of cornersOf(tile)) {
          expect(inside(corner, cell), `${JSON.stringify(tile)} in ${JSON.stringify(cell[0])}`).toBe(true);
        }
      }
    }
  });

  it("never lies under the compartment's name or its id", () => {
    for (const g of groups(svg)) {
      for (const tile of tiles(g)) {
        for (const label of texts(g)) {
          if (label.cls.startsWith("threat")) continue;
          expect(overlaps(tile, boxOfText(label, "hex"))).toBe(false);
        }
      }
    }
  });

  it("leaves daylight between neighbours at the scale the honeycomb runs at", () => {
    let checked = 0;
    for (const g of groups(svg)) {
      const row = tiles(g).filter((t) => t.w === 12).sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) {
        expect((row[i]!.x - (row[i - 1]!.x + row[i - 1]!.w)) * HEX_WORST_SCALE).toBeGreaterThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

/**
 * The honeycomb's own worst scale, measured the way the schematic's is.
 *
 * It is the weak end of the whole feature and the number says so: 0.80 at the
 * worst, where a twelve-unit tile is under ten CSS px. What makes it acceptable
 * rather than a defect is that the glyph the tile replaces is smaller still —
 * `.hexmap .glyph` is `font-size:12` with .22em of tracking, so a mark occupies
 * about seven units across.
 */
const HEX_WORST_SCALE = (() => {
  let worst = Infinity;
  for (const spec of DERELICTS) {
    for (let seed = 1; seed <= 6; seed++) {
      worst = Math.min(worst, scaleOf(hexOf(hexGame(spec.id, seed, 4), true)));
    }
  }
  return worst;
})();

describe("the size a honeycomb tile comes out at", () => {
  it("is never smaller than the letter it replaced", () => {
    // The honest claim, and not a word more: a twelve-unit tile is wider and
    // taller than the mark it stands in for, on every hull. Not that the
    // honeycomb clears the 12 px floor — at the bottom of the range it does
    // not, and neither did the text that was there.
    expect(HEX_WORST_SCALE).toBeGreaterThan(0.75);
    expect(HEX_WORST_SCALE).toBeLessThan(1.2);
  });
});

// ------------------------------------------------- hazards, once they had tiles

describe("the hazard marks", () => {
  it("every hazard the game can place has a drawing and answers to its own mark", () => {
    // The drift this catches: a hazard added to `content/hazards.ts` whose
    // glyph never became a picture, or a glyph changed there and left behind in
    // the set. Both are silent — the map keeps drawing the letter (G83).
    for (const id of HAZARD_IDS) {
      const kind = HAZARDS[id];
      expect(TILE_BY_GLYPH[kind.glyph], `no tile for hazard ${id} (${kind.glyph})`).toBe(`hazard.${id}`);
      expect(TILE_IDS[`hazard.${id}` as keyof typeof TILE_IDS]).toBeDefined();
    }
  });

  it("draws as a picture on the map, in both drawings", () => {
    const frost: SchematicInput = {
      rooms: [
        room(1, "CARGO", 0, 0, "current", { kind: "cargo", glyphs: "≈", things: [{ glyph: "≈", name: "smoke" }] }),
      ],
      doors: [],
      shipLine: "",
    };
    const svg = svgOf(frost, "", true);
    expect(svg).toContain(`href="#${TILE_IDS["hazard.smoke"]}"`);
  });

  it("keeps the amber the red line puts on the compartment, and adds no colour of its own", () => {
    // G83 lights the compartment and the door a red log line names, with
    // `is-goal`, until the turn is spent. A tile is `currentColor` throughout,
    // so the class still decides the ink — which is only true if the symbol
    // names no colour, and that is what is asserted.
    const lit: SchematicInput = {
      rooms: [
        room(1, "CARGO", 0, 0, "current", {
          kind: "cargo",
          glyphs: "≈ S",
          hostiles: 1,
          target: true,
          things: [{ glyph: "≈", name: "smoke" }, { glyph: "S", name: "security unit", hostile: true }],
        }),
      ],
      doors: [],
      shipLine: "",
    };
    const svg = svgOf(lit, "", true);
    expect(svg).toContain("is-goal");
    const defs = svg.slice(svg.indexOf("<defs>"), svg.indexOf("</defs>"));
    expect(defs).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(defs).not.toContain("fill=\"#");
  });
});
