import {
  TILE_BY_GLYPH,
  TILE_DEFS,
  TILE_IDS,
  ZONE_DEFS,
  ZONE_IDS,
} from "../../tiles/sprites.js";
import type { SchematicRoom, SchematicThing } from "../schematic.js";
import { esc } from "./xml.js";

/**
 * Tiles on the schematic: the one place a drawing turns a glyph into a picture.
 *
 * The rule the whole feature is built on is that there is no fourth view.
 * A tile **replaces a glyph and never a word** — the compartment's name, `rN`
 * and the door labels stay text, the panel keeps naming everything in the
 * sidebar, and a mark the set has no drawing for comes out as the letter it
 * always was (docs/tiles-design.md, 3). So this file has no policy of its own:
 * it is handed the same `things` the terminal spells its glyph row out of, and
 * answers with markup.
 *
 * Two consequences worth stating, because both are load-bearing:
 *
 * 1. **Symbols, not a PNG.** The schematic is an SVG with a `viewBox`, and on
 *    the itch viewport it runs at 2.0–2.6× — never a whole number, which no
 *    raster survives. The set is `<rect>`s on `currentColor` (`tiles/sprites.ts`),
 *    so scale costs nothing and the colour is the container's: whatever painted
 *    the glyph paints the tile, red machines included (G40).
 * 2. **Only what is on the screen.** `tileDefs` reads the finished markup back
 *    and emits the handful of symbols it referenced, rather than the whole
 *    64 kB set on every frame.
 */

/**
 * Which compartment kinds get a pictogram beside their name.
 *
 * Six, not the twenty-two the set draws. Twenty-two readable silhouettes at
 * sixteen pixels is the heaviest art order in the game and half of them would
 * make the map noisier rather than faster to read, so the pictogram is spent
 * where the answer is worth the ink: the three systems a voyage is *for*, the
 * way in, the way to heal and the place the salvage is (docs/tiles-design.md,
 * 1.2). Every other compartment keeps its name and nothing else.
 */
export const PICTOGRAM_KINDS: ReadonlySet<string> = new Set([
  "docking",
  "reactor",
  "engineering",
  "control",
  "med",
  "cargo",
]);

/** Where a row of tiles goes and how big its cells are, in view units. */
export interface TileRowSpec {
  /** Left edge of the first cell. */
  x: number;
  /** Top edge of every cell. */
  y: number;
  /** Drawn size of one tile. Square: the set is. */
  size: number;
  /**
   * Distance from one cell's left edge to the next. `step - size` is the gap,
   * and it may never be zero: the generator measured the set at full density
   * and reported that wide chassis touching each other read as one machine
   * (docs/tiles-design.md, 2.5).
   */
  step: number;
  /** How many cells the row has room for. The rest become `+N`. */
  max: number;
  /** Baseline for a mark with no tile, which is drawn as the letter it was. */
  baseline: number;
  /**
   * Leave the `<title>` off every tile in the row.
   *
   * For a drawing that answers a hover itself. A `<title>` is the browser's own
   * tooltip, and the browser draws it where it likes, in its own type, after a
   * delay of its own — over the honeycomb's readout, which says the same thing
   * in our letters and without the wait: "подсказка браузера тут точно не
   * нужна, нужна нашего интерфейса" (the owner). The boxes-and-wires view has
   * no readout, so it keeps its titles and this stays off.
   */
  quiet?: boolean;
}

/**
 * The contents of a compartment, as pictures where the set has one.
 *
 * A mark outside the set comes back as `<text class="glyph">` — the same
 * element, class and letter the glyph row draws — because the mark vocabulary
 * is open at the bottom (`content/cards.ts` takes any `marks` entry) and one
 * grey placeholder box standing for three different things is worse than three
 * letters.
 */
export function tileRow(things: readonly SchematicThing[], spec: TileRowSpec): string {
  const shown = things.slice(0, drawn(things.length, spec.max));
  const rest = things.length - shown.length;
  const cells = shown.map((thing, i) => cell(thing, spec.x + spec.step * i, spec));
  if (rest > 0) {
    const at = spec.x + spec.step * shown.length + spec.size / 2;
    cells.push(`<text class="glyph tile-more" x="${at}" y="${spec.baseline}" text-anchor="middle">+${rest}</text>`);
  }
  return cells.join("");
}

function cell(thing: SchematicThing, x: number, spec: TileRowSpec): string {
  const id = tileIdOf(thing.glyph);
  const tone = toneOf(thing);
  if (id === undefined) {
    // Centred in the cell the tile would have taken, because a mark is not
    // always one character wide — the airlock's label is two — and a letter set
    // from the cell's left edge grows into its neighbour.
    return `<text class="glyph${tone}" x="${x + spec.size / 2}" y="${spec.baseline}" text-anchor="middle">${esc(thing.glyph)}</text>`;
  }
  // The name rides along as a `<title>`, which is the only word a tile is
  // allowed to carry: it is read out by a screen reader and shown on hover, and
  // it never occupies a pixel — the rule is that text is never laid *under* a
  // tile (docs/gui-guides.md, 6.7). Unless the drawing says the same thing
  // itself, in which case the browser's tooltip is a second answer over the
  // top of the first (`quiet`).
  return [
    `<use class="tile${tone}" href="#${id}"`,
    ` x="${x}" y="${spec.y}" width="${spec.size}" height="${spec.size}"`,
    spec.quiet === true ? "/>" : `><title>${esc(thing.name)}</title></use>`,
  ].join("");
}

/**
 * What a thing is painted as, on top of being a thing: a machine, or one of the
 * three systems that end the hull.
 *
 * Two colours and no third. Red is the machines' and has been since G40; green
 * is the job's — the owner asked for the objective marks to be told apart from
 * the crates and the bodies they were drawn in the same ink as, and named the
 * colour («например зелёным»). Amber was not free: on this screen it means a
 * decision is required here, and a system is a place, not a prompt.
 *
 * A system already up keeps the colour and loses the weight, so the three read
 * as one job with some of it done rather than as two kinds of thing.
 */
function toneOf(thing: SchematicThing): string {
  if (thing.hostile === true) return ["", "hostile"].join(" ");
  if (thing.goal === undefined) return "";
  return ["", "goal", `is-${thing.goal}`].join(" ");
}

/**
 * How many of a compartment's things get a picture.
 *
 * The counter takes a cell of its own rather than hanging off the end of a full
 * row: past the last cell there is no compartment left, and `+2` written there
 * would sit outside the thing it belongs to.
 */
function drawn(count: number, max: number): number {
  return count > max ? max - 1 : count;
}

/**
 * How wide the row comes out, for a drawing that centres it rather than hanging
 * it off a left edge — which the honeycomb does, having no left edge to hang
 * anything off.
 */
export function tileRowWidth(count: number, spec: Pick<TileRowSpec, "size" | "step" | "max">): number {
  const shown = drawn(count, spec.max);
  const cells = shown + (count > shown ? 1 : 0);
  return cells === 0 ? 0 : (cells - 1) * spec.step + spec.size;
}

/**
 * What is in a compartment, as a list.
 *
 * `schematicInputOf` puts one there. A hand-written fixture says `glyphs` and a
 * count of machine columns and nothing else, and it has to keep working: the
 * geometry of both drawings is tested against inputs no generator produced, and
 * a view that only understood the richer shape would have quietly stopped being
 * testable that way.
 */
export function thingsOf(room: SchematicRoom): readonly SchematicThing[] {
  if (room.things !== undefined) return room.things;
  const glyphs = room.glyphs.split(" ").filter((g) => g.length > 0);
  const machines = Math.ceil((room.hostiles ?? 0) / 2);
  return glyphs.map((glyph, i) =>
    i < machines ? { glyph, name: glyph, hostile: true as const } : { glyph, name: glyph },
  );
}

/** The symbol a mark is drawn by, or nothing at all — which means: draw the letter. */
export function tileIdOf(glyph: string): string | undefined {
  const name = TILE_BY_GLYPH[glyph];
  return name === undefined ? undefined : TILE_IDS[name];
}

/**
 * The compartment's own pictogram, or nothing.
 *
 * `kind` and not `name`: the name is translated, and the picture has to be the
 * same one in three languages.
 */
export function zoneTile(
  room: SchematicRoom,
  x: number,
  y: number,
  size: number,
  quiet = false,
): string {
  const id = zoneIdOf(room.kind);
  if (id === undefined) return "";
  return [
    `<use class="zone-tile" href="#${id}"`,
    ` x="${x}" y="${y}" width="${size}" height="${size}"`,
    quiet ? "/>" : `><title>${esc(room.name)}</title></use>`,
  ].join("");
}

/** The sixteen-grid drawing for a compartment kind, for the six that get one. */
export function zoneIdOf(kind: string | undefined): string | undefined {
  if (kind === undefined || !PICTOGRAM_KINDS.has(kind)) return undefined;
  return ZONE_IDS[`zone.${kind}`];
}

/**
 * The `<defs>` a finished drawing needs: the symbols it actually referenced and
 * not one more.
 *
 * Reading the markup back rather than tracking what was drawn keeps the two
 * from disagreeing — a `<use>` whose symbol was never emitted is an empty space
 * on the map and nothing in the console, and this is the one arrangement in
 * which that cannot happen.
 */
export function tileDefs(svg: string): string {
  const used = new Set<string>();
  for (const match of svg.matchAll(/href="#([^"]+)"/g)) used.add(match[1]!);
  if (used.size === 0) return "";
  // Emitted in the set's own order, so the same frame is the same bytes twice.
  const body = [...SYMBOLS].filter(([id]) => used.has(id)).map(([, symbol]) => symbol);
  return body.length === 0 ? "" : `<defs>${body.join("")}</defs>`;
}

/**
 * The set, cut back into one symbol per id.
 *
 * The generator hands over two long strings of concatenated `<symbol>`s, which
 * is the right shape for a file and the wrong one for a frame that uses six of
 * them. Split once, at module load.
 */
const SYMBOLS: ReadonlyMap<string, string> = indexSymbols(TILE_DEFS + ZONE_DEFS);

function indexSymbols(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of source.split("</symbol>")) {
    const id = /^<symbol id="([^"]+)"/.exec(part)?.[1];
    if (id !== undefined) out.set(id, `${part}</symbol>`);
  }
  return out;
}
