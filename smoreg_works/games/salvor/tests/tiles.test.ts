import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MONSTERS, ENFORCER } from "../src/content/monsters.js";
import { MODULES, type ModuleId } from "../src/content/modules.js";
import { ZONE_KINDS } from "../src/content/zones.js";
import { PALETTE } from "../src/content/palette.js";
import {
  TILE_BY_GLYPH,
  TILE_DEFS,
  TILE_GRID,
  TILE_IDS,
  TILE_NAMES,
  ZONE_DEFS,
  ZONE_GRID,
  ZONE_IDS,
  MACHINE_ROLES,
  type TileName,
} from "../src/tiles/sprites.js";

/**
 * The tileset, checked against the game rather than against itself.
 *
 * Everything here is generated (`npm run tiles -w games/salvor`) and committed,
 * so what can go wrong with it is drift: a machine added to the catalogue with
 * no icon, a compartment kind nobody drew, a colour changed in `palette.ts` and
 * left standing in the atlas. All three are silent — nothing imports the set
 * yet, so nothing crashes and nothing looks wrong until somebody switches a
 * view over and finds half a ship missing.
 *
 * There are two outputs and they have to agree. `src/tiles/sprites.ts` is what
 * the game can use: SVG symbols on `currentColor`, which is what survives the
 * fractional scale both graphic views run at and what a view can recolour. The
 * PNG atlases are the reference sheet. So the last test here rasterises every
 * symbol back to a grid and compares it to the atlas pixel for pixel: two
 * exports of one drawing that quietly disagree would be the worst outcome of
 * the lot, because each looks right on its own.
 */

const asset = (name: string): string => fileURLToPath(new URL(`../assets/tiles/${name}`, import.meta.url));

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Tile {
  readonly group: string;
  readonly label: string;
  readonly glyph: string | null;
  readonly colour: string;
  /** `behaviour` off the machine's row. Only machines have one. */
  readonly role?: string;
  readonly symbol: string;
  readonly rects: Record<string, Rect>;
}

interface Index {
  readonly grid: number;
  readonly count: number;
  readonly sizes: Record<string, { image: string; tile: number; width: number; height: number; count: number }>;
  readonly tiles: Record<string, Tile>;
}

const index = JSON.parse(readFileSync(asset("salvor.json"), "utf8")) as Index;

/** A PNG this repository wrote: 8-bit RGBA, filter 0 on every row. */
function decode(name: string): { width: number; height: number; pixels: Buffer } {
  const file = readFileSync(asset(name));
  expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  let at = 8;
  let header: Buffer | undefined;
  const parts: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString("ascii", at + 4, at + 8);
    if (type === "IHDR") header = file.subarray(at + 8, at + 8 + length);
    if (type === "IDAT") parts.push(file.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  if (header === undefined) throw new Error(`${name}: no IHDR`);

  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect([header[8], header[9], header[12]]).toEqual([8, 6, 0]);

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4 + 1;
  expect(raw.length).toBe(height * stride);

  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * stride]).toBe(0);
    raw.copy(pixels, y * width * 4, y * stride + 1, y * stride + 1 + width * 4);
  }
  return { width, height, pixels };
}

const images: Record<string, { width: number; height: number; pixels: Buffer }> = {
  [TILE_GRID]: decode(index.sizes[TILE_GRID]!.image),
  [ZONE_GRID]: decode(index.sizes[ZONE_GRID]!.image),
};

const imageAt = (size: number): { width: number; height: number; pixels: Buffer } => images[String(size)]!;

const opaque = (size: number, x: number, y: number): boolean =>
  imageAt(size).pixels[(y * imageAt(size).width + x) * 4 + 3]! > 0;

/** Every machine that can stand aboard, the one the alert sends included. */
const MACHINES = [...MONSTERS, ENFORCER];

describe("the tile set covers the game's vocabulary", () => {
  it("has a tile for every machine, in the colour its row declares", () => {
    for (const machine of MACHINES) {
      const tile = index.tiles[`machine.${machine.id}`];
      expect(tile, `machine.${machine.id}`).toBeDefined();
      expect(tile!.glyph, machine.id).toBe(machine.ch);
      expect(tile!.colour.toLowerCase(), machine.id).toBe(machine.fg.toLowerCase());
    }
  });

  it("has a tile for the drone and for the two things that wear its shape", () => {
    for (const [name, glyph] of [
      ["actor.drone", "@"],
      ["actor.ghost", "G"],
      ["actor.rival-drone", "r"],
    ] as const) {
      expect(index.tiles[name], name).toBeDefined();
      expect(index.tiles[name]!.glyph, name).toBe(glyph);
    }
  });

  it("has a tile for every module, and marks the relics as relics", () => {
    for (const id of Object.keys(MODULES) as ModuleId[]) {
      const tile = index.tiles[`module.${id}`];
      expect(tile, `module.${id}`).toBeDefined();
      expect(tile!.label, id).toBe(MODULES[id].name);
      expect(tile!.group, id).toBe(MODULES[id].relic === true ? "relic" : "module");
    }
  });

  it("has a tile for every compartment kind the catalogue names", () => {
    for (const zone of ZONE_KINDS) {
      const tile = index.tiles[`zone.${zone.kind}`];
      expect(tile, `zone.${zone.kind}`).toBeDefined();
      expect(tile!.label, zone.kind).toBe(zone.name);
    }
  });

  it("has a tile for each of the six door states, in that state's palette colour", () => {
    for (const [state, colour] of Object.entries(PALETTE.door)) {
      const tile = index.tiles[`door.${state}`];
      expect(tile, `door.${state}`).toBeDefined();
      expect(tile!.colour, state).toBe(colour);
    }
    expect(Object.keys(index.tiles).filter((name) => name.startsWith("door.")).length).toBe(6);
  });

  it("has a tile for everything else a compartment can hold", () => {
    const things: Record<string, string | null> = {
      "thing.crate": "X",
      "thing.scrap": "%",
      "thing.body": "†",
      "thing.keycard": null,
      "thing.vented": "~",
      "thing.system": "+",
      "thing.system-online": "✓",
      "thing.cover": null,
    };
    for (const [name, glyph] of Object.entries(things)) {
      expect(index.tiles[name], name).toBeDefined();
      expect(index.tiles[name]!.glyph, name).toBe(glyph);
    }
  });

  it("carries the three states as overlays under their own prefix", () => {
    for (const name of ["overlay.damaged", "overlay.infected", "overlay.exposed"]) {
      expect(index.tiles[name], name).toBeDefined();
      expect(index.tiles[name]!.group, name).toBe("overlay");
      // An overlay is a second layer over a tile, never one of the set.
      expect(TILE_IDS[name as TileName], name).toMatch(/^ov-/);
    }
    expect(index.tiles["overlay.infected"]!.glyph).toBe("!");
    expect(index.tiles["overlay.exposed"]!.glyph).toBe("◀");
  });

  it("says what each machine does, which is the thing a letter cannot", () => {
    // Thirteen letters are thirteen things to memorise; "stands still and
    // shoots" is a shape. The table is passed through from the catalogue, so
    // the view can group or tint by it — docs/tiles-design.md, "class and role
    // before identity".
    for (const machine of MACHINES) {
      expect(MACHINE_ROLES[`machine.${machine.id}`], machine.id).toBe(machine.behaviour);
    }
    expect(Object.keys(MACHINE_ROLES).length).toBe(MACHINES.length);
  });

  it("counts what it holds", () => {
    expect(Object.keys(index.tiles).length).toBe(index.count);
    expect(TILE_NAMES.length).toBe(index.count);
  });
});

describe("the module the game would import", () => {
  it("declares a symbol for every tile and nothing else", () => {
    const ids = [...TILE_DEFS.matchAll(/<symbol id="([^"]+)"/g)].map(([, id]) => id);
    expect(ids.length).toBe(TILE_NAMES.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const name of TILE_NAMES) expect(ids, name).toContain(TILE_IDS[name]);
  });

  it("puts no colour in the art at all", () => {
    // Colour on a map carries state, so art that spends it has spent the map's
    // one signal (docs/gui-guides.md, §6.4). Amber especially: it means "a
    // decision is required" and is worn by the frame, never by the picture.
    for (const defs of [TILE_DEFS, ZONE_DEFS]) {
      expect(defs).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(defs.toLowerCase()).not.toContain("rgb");
      expect(defs).not.toMatch(/fill="(?!currentColor)/);
    }
  });

  it("gives every symbol the viewBox of the grid it was drawn on", () => {
    for (const [, box] of TILE_DEFS.matchAll(/viewBox="([^"]+)"/g)) expect(box).toBe(`0 0 ${TILE_GRID} ${TILE_GRID}`);
    for (const [, box] of ZONE_DEFS.matchAll(/viewBox="([^"]+)"/g)) expect(box).toBe(`0 0 ${ZONE_GRID} ${ZONE_GRID}`);
  });

  it("draws the compartment kinds a second time at the larger grid, and only those", () => {
    const kinds = ZONE_KINDS.map((zone) => `zone.${zone.kind}`);
    expect(Object.keys(ZONE_IDS).sort()).toEqual([...kinds].sort());
    expect([...ZONE_DEFS.matchAll(/<symbol/g)].length).toBe(ZONE_KINDS.length);
    expect(index.sizes[ZONE_GRID]!.count).toBe(ZONE_KINDS.length);
  });

  it("maps a glyph the terminal draws to the tile that would replace it", () => {
    for (const machine of MACHINES) expect(TILE_BY_GLYPH[machine.ch], machine.id).toBe(`machine.${machine.id}`);
    expect(TILE_BY_GLYPH["@"]).toBe("actor.drone");
    expect(TILE_BY_GLYPH["X"]).toBe("thing.crate");
    expect(TILE_BY_GLYPH["✓"]).toBe("thing.system-online");
    // No placeholder: the mark vocabulary is open at the bottom, and a glyph
    // with no tile is honestly drawn as the letter it always was.
    expect(TILE_BY_GLYPH["Ж"]).toBeUndefined();
  });
});

describe("the reference atlases", () => {
  it("are whole numbers of tiles across and down", () => {
    for (const size of [TILE_GRID, ZONE_GRID]) {
      const spec = index.sizes[size]!;
      const image = imageAt(size);
      expect(image.width, `${size}`).toBe(spec.width);
      expect(image.height, `${size}`).toBe(spec.height);
      expect(image.width % size, `${size}`).toBe(0);
      expect(image.height % size, `${size}`).toBe(0);
    }
  });

  it("draw something inside every rectangle the index promises", () => {
    for (const [name, tile] of Object.entries(index.tiles)) {
      for (const [size, rect] of Object.entries(tile.rects)) {
        const image = imageAt(Number(size));
        expect(rect.x + rect.w, `${name} at ${size}`).toBeLessThanOrEqual(image.width);
        expect(rect.y + rect.h, `${name} at ${size}`).toBeLessThanOrEqual(image.height);

        let painted = 0;
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            if (opaque(Number(size), x, y)) painted += 1;
          }
        }
        expect(painted, `${name} at ${size} is empty`).toBeGreaterThan(8);
      }
    }
  });

  it("give every tile a rectangle of its own", () => {
    for (const size of [TILE_GRID, ZONE_GRID]) {
      const at = Object.values(index.tiles)
        .map((tile) => tile.rects[size])
        .filter((rect): rect is Rect => rect !== undefined);
      expect(new Set(at.map((rect) => `${rect.x},${rect.y}`)).size, `${size}`).toBe(at.length);
    }
  });

  it("show the same drawing as the symbols, pixel for pixel", () => {
    const symbols = new Map<string, string>();
    for (const defs of [TILE_DEFS, ZONE_DEFS]) {
      for (const [, id, body] of defs.matchAll(/<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)) {
        symbols.set(id!, body!);
      }
    }

    /** The symbol's rectangles, painted back onto a grid. */
    const raster = (body: string, size: number): boolean[] => {
      const cells = new Array<boolean>(size * size).fill(false);
      for (const [, x, y, w, h] of body.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)) {
        for (let j = 0; j < Number(h); j += 1) {
          for (let i = 0; i < Number(w); i += 1) {
            const at = (Number(y) + j) * size + Number(x) + i;
            // A cell covered twice means the rectangles overlap, which is a bug
            // in the cover even though it draws the same picture.
            expect(cells[at], "overlapping rectangles").toBe(false);
            cells[at] = true;
          }
        }
      }
      return cells;
    };

    for (const [name, tile] of Object.entries(index.tiles)) {
      const pairs: [string, number][] = [[tile.symbol, TILE_GRID]];
      const zoneId = ZONE_IDS[name];
      if (zoneId !== undefined) pairs.push([zoneId, ZONE_GRID]);

      for (const [id, size] of pairs) {
        const body = symbols.get(id);
        expect(body, id).toBeDefined();
        const cells = raster(body!, size);
        const rect = tile.rects[size]!;
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            expect(cells[y * size + x], `${name} at ${size}, pixel ${x},${y}`).toBe(opaque(size, rect.x + x, rect.y + y));
          }
        }
      }
    }
  });
});

// ------------------------------------------------------ the set as readable text

/**
 * `tiles.txt` and `tiles.md`: the set written down so it can be re-drawn or
 * carried into another project without opening the generator.
 *
 * The owner's ask, and it only holds if the text is the same drawing as
 * everything else in the folder. So the masks in `tiles.txt` are compared to
 * the atlas pixel for pixel — the same comparison the symbols get above, which
 * closes the loop: text, symbol and PNG are three renderings of one mask, and
 * any two of them agreeing is not enough.
 */

const text = readFileSync(asset("tiles.txt"), "utf8");

/** One tile's block, split back into its fields and its masks. */
function block(name: string): { fields: string[]; masks: Record<number, string[]> } {
  const start = text.indexOf(`=== ${name} ===\n`);
  expect(start, `no block for ${name}`).toBeGreaterThan(-1);
  const next = text.indexOf("\n=== ", start + 1);
  const body = text.slice(start, next === -1 ? text.length : next).split("\n");
  const fields: string[] = [];
  const masks: Record<number, string[]> = {};
  let into: string[] | undefined;
  for (const line of body.slice(1)) {
    const size = /^(\d+)×\1$/.exec(line.trim());
    if (size !== null) {
      into = [];
      masks[Number(size[1])] = into;
      continue;
    }
    if (/^[.#]+$/.test(line)) {
      expect(into, `${name}: a mask row before its size`).toBeDefined();
      into!.push(line);
      continue;
    }
    if (line.trim().length > 0) fields.push(line);
  }
  return { fields, masks };
}

describe("the masks written down as text", () => {
  it("has a block for every tile the index knows, and none for anything else", () => {
    const named = [...text.matchAll(/^=== (\S+) ===$/gm)].map((m) => m[1]!);
    expect(named).toEqual(Object.keys(index.tiles));
  });

  it("says the same name, mark and role the index says", () => {
    for (const [name, tile] of Object.entries(index.tiles)) {
      const { fields } = block(name);
      const said = (key: string): string | undefined =>
        fields.find((line) => line.startsWith(key))?.slice(key.length).trim();
      expect(said("слово"), name).toBe(tile.label);
      expect(said("знак"), name).toBe(tile.glyph === null ? "—" : tile.glyph);
      expect(said("роль"), name).toBe(tile.role);
      expect(fields.some((line) => line.includes(tile.symbol)), name).toBe(true);
    }
  });

  it("draws the same picture as the atlas, pixel for pixel", () => {
    // The whole point of the file: a mask copied out of it and pasted into
    // another project is the tile, and not an approximation of it.
    let checked = 0;
    for (const [name, tile] of Object.entries(index.tiles)) {
      const { masks } = block(name);
      for (const size of [TILE_GRID, ZONE_GRID]) {
        const rect = tile.rects[size];
        if (rect === undefined) {
          expect(masks[size], `${name} has a ${size} mask and no ${size} rectangle`).toBeUndefined();
          continue;
        }
        const mask = masks[size];
        expect(mask, `${name}: no ${size} mask in tiles.txt`).toBeDefined();
        expect(mask!.length, `${name} at ${size}`).toBe(size);
        for (let y = 0; y < size; y += 1) {
          expect(mask![y]!.length, `${name} at ${size}, row ${y}`).toBe(size);
          for (let x = 0; x < size; x += 1) {
            const ink = mask![y]![x] === "#";
            expect(ink, `${name} at ${size}, pixel ${x},${y}`).toBe(opaque(size, rect.x + x, rect.y + y));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(73 * 144);
  });

  it("says nothing in a mask but ink and holes", () => {
    for (const name of Object.keys(index.tiles)) {
      for (const mask of Object.values(block(name).masks)) {
        for (const row of mask) expect(/^[.#]+$/.test(row), `${name}: ${row}`).toBe(true);
      }
    }
  });
});

describe("the catalogue as a table", () => {
  it("has a row for every tile, in the set's own order", () => {
    const md = readFileSync(asset("tiles.md"), "utf8");
    const named = [...md.matchAll(/^\| `([\w.-]+)` \|/gm)].map((m) => m[1]!);
    expect(named).toEqual(Object.keys(index.tiles));
  });

  it("points at the text file, which is the one a redraw starts from", () => {
    const md = readFileSync(asset("tiles.md"), "utf8");
    expect(md).toContain("tiles.txt");
    expect(md).toContain("npm run tiles -w games/salvor");
  });
});

describe("what is committed here", () => {
  it("is byte for byte what the generator writes today", () => {
    // Determinism and freshness in one assertion: the generator runs into a
    // temporary directory and the bytes are compared. A mask edited without
    // regenerating fails here, and so would anything in the output that
    // depended on the clock or on the order of a hash map.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const tmp = mkdtempSync(join(tmpdir(), "salvor-tiles-"));
    execFileSync(
      process.execPath,
      [
        join(root, "tools", "tiles", "tiles.mjs"),
        "--out", tmp,
        "--ts", join(tmp, "sprites.ts"),
        "--contact", join(tmp, "contact.html"),
      ],
      { stdio: "pipe" },
    );
    for (const name of ["tiles.txt", "tiles.md", "salvor.json", "salvor-12.png", "salvor-16.png"]) {
      expect(readFileSync(join(tmp, name)).equals(readFileSync(asset(name))), name).toBe(true);
    }
    expect(readFileSync(join(tmp, "sprites.ts"), "utf8")).toBe(
      readFileSync(join(root, "src", "tiles", "sprites.ts"), "utf8"),
    );
    rmSync(tmp, { recursive: true, force: true });
  });
});
