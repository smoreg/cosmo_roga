import type { Level, Point, Zone } from "@jamrog/engine";
import { THEME } from "./theme.js";

/**
 * The DECK schematic: the sidebar's answer to "where am I and what is next to
 * me". A deck is a graph of zones joined by airlocks, and the player has to
 * plan routes through it long before the map is explored — so the schematic
 * draws every zone as a node in the place it actually occupies on the deck,
 * with a line to each zone an airlock leads to.
 *
 * Position is the whole point. A list would say the same thing about who is
 * next to whom, but "the reactor is bottom right" is the fact the player uses
 * when deciding which way to walk, and only a picture carries it.
 *
 * Pure text in, pure text out: no rot.js, no Game, no drawing. The whole thing
 * is one function so it can be tested against a real DeckBuilder level.
 */

export interface DeckMapLine {
  text: string;
  /** Set only where the default zone colour would be wrong. */
  fg?: string;
}

/** Node columns across the panel, and text columns each of them owns. */
const COLS = 3;
const CELL = 8;
/** The last column of a cell is the gutter a horizontal link runs through. */
const LABEL_WIDTH = CELL - 1;
/** Node rows; the schematic spends one text line between each pair for links. */
const ROWS = 4;
/**
 * Longest zone name a node shows. Five, not six: the brackets round the current
 * zone have to fit the same seven columns as every other label, and a schematic
 * that clips the name of the zone you stand in harder than every other is
 * the wrong trade.
 */
const NAME_MAX = 5;
/** Placeholder for a zone the player has never set foot in. */
const UNKNOWN = "····";
/** Where inside its cell a vertical link attaches. */
const STEM = 2;

interface Placed {
  zone: Zone;
  row: number;
  col: number;
  /** What was written into the cell, so a link knows where the label ends. */
  text: string;
}

/**
 * The deck as a graph drawn in place. Empty for a level without zones — every
 * generator except DeckBuilder — so the caller can skip the section.
 */
export function deckMapLines(level: Level, playerPos: Point): DeckMapLine[] {
  const zones = level.zones;
  if (zones.length === 0) return [];

  const here = level.zoneAt(playerPos) ?? zones[0]!;
  const placed = place(level, zones, (z) => label(level, z, z.id === here.id));
  const canvas = blank();

  for (const p of placed) write(canvas, p.row * 2, p.col * CELL, p.text);

  const mask = canvas.map((row) => new Array<number>(row.length).fill(0));
  const at = new Map<number, Placed>(placed.map((p) => [p.zone.id, p]));
  for (const [a, b] of edges(zones)) {
    const pa = at.get(a);
    const pb = at.get(b);
    if (pa && pb) link(mask, pa, pb, at);
  }
  // A node already written always wins its cell: the link stops at the label.
  mask.forEach((row, y) => row.forEach((dirs, x) => {
    if (dirs !== 0 && canvas[y]![x] === " ") canvas[y]![x] = GLYPH[dirs] ?? "┼";
  }));

  // The bracketed node says where the player is; accenting its whole line is
  // what makes it findable at a glance in a sidebar full of dim text.
  const hereLine = at.has(here.id) ? at.get(here.id)!.row * 2 : -1;
  const lines = canvas.map((row, i) => {
    const text = row.join("").replace(/\s+$/, "");
    return i === hereLine ? { text, fg: THEME.accent } : { text };
  });
  while (lines.length > 0 && lines[lines.length - 1]!.text.length === 0) lines.pop();
  return lines;
}

function blank(): string[][] {
  return Array.from({ length: ROWS * 2 - 1 }, () => new Array<string>(COLS * CELL).fill(" "));
}

/** `[HERE]`, the name once the zone has been entered, dots while it has not. */
function label(level: Level, zone: Zone, current: boolean): string {
  if (current) return `[${short(zone.name, NAME_MAX)}]`;
  return isExplored(level, zone) ? short(zone.name, NAME_MAX) : UNKNOWN;
}

/** First word of the name, clipped: "CORE ACCESS" is CORE, not CORE A. */
function short(name: string, max: number): string {
  const word = name.trim().split(/\s+/)[0] ?? name;
  return word.slice(0, max);
}

// ------------------------------------------------------------------ placing

/**
 * Every zone into the cell that matches where its sector sits on the deck.
 *
 * Coordinates are ranked rather than scaled: sectors are banded by how far
 * apart their centres are, so two sectors side by side land in neighbouring
 * columns however wide they happen to be, and a deck that is two sectors tall
 * does not leave half the schematic blank.
 */
function place(level: Level, zones: readonly Zone[], label: (z: Zone) => string): Placed[] {
  const centre = (z: Zone): Point => ({ x: (z.rect.x1 + z.rect.x2) >> 1, y: (z.rect.y1 + z.rect.y2) >> 1 });
  const colOf = band(zones.map((z) => centre(z).x), COLS, level.width / (COLS * 2));
  const rowOf = band(zones.map((z) => centre(z).y), ROWS, level.height / (ROWS * 2));

  const taken = new Set<string>();
  const out: Placed[] = [];
  for (const zone of [...zones].sort((a, b) => a.id - b.id)) {
    const c = centre(zone);
    const spot = free(rowOf(c.y), colOf(c.x), taken);
    if (!spot) continue; // More zones than cells: impossible on a real deck.
    taken.add(`${spot.row},${spot.col}`);
    out.push({ zone, row: spot.row, col: spot.col, text: label(zone) });
  }
  return out;
}

/**
 * Group values into at most `max` bands: start a band, keep taking values that
 * sit within `tolerance` of it, and merge the closest pair of bands until few
 * enough remain. Returns the band index of any value.
 */
function band(values: number[], max: number, tolerance: number): (v: number) => number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let starts: number[] = [];
  for (const v of sorted) {
    if (starts.length === 0 || v - starts[starts.length - 1]! > tolerance) starts.push(v);
  }
  while (starts.length > max) {
    let closest = 1;
    for (let i = 2; i < starts.length; i++) {
      if (starts[i]! - starts[i - 1]! < starts[closest]! - starts[closest - 1]!) closest = i;
    }
    starts = starts.filter((_s, i) => i !== closest);
  }
  return (v: number) => {
    let idx = 0;
    for (let i = 0; i < starts.length; i++) {
      if (v >= starts[i]!) idx = i;
    }
    return Math.min(idx, max - 1);
  };
}

/** The wanted cell, else the nearest free one: ties broken by row then column. */
function free(row: number, col: number, taken: ReadonlySet<string>): { row: number; col: number } | undefined {
  const cells: Array<{ row: number; col: number }> = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) cells.push({ row: r, col: c });
  }
  cells.sort((a, b) => {
    const da = Math.abs(a.row - row) + Math.abs(a.col - col);
    const db = Math.abs(b.row - row) + Math.abs(b.col - col);
    return da - db || a.row - b.row || a.col - b.col;
  });
  return cells.find((c) => !taken.has(`${c.row},${c.col}`));
}

// ------------------------------------------------------------------ drawing

/** Which way a link leaves a cell. Glyphs are chosen once all links are in. */
const UP = 1;
const DOWN = 2;
const LEFT = 4;
const RIGHT = 8;

/**
 * Box-drawing glyph per set of directions. Building the mask first and picking
 * the glyph last is what lets two links share a cell: a stem coming down into
 * the same corner another link turns at becomes a tee, not whichever of the
 * two happened to be drawn first.
 */
const GLYPH: Record<number, string> = {
  [UP]: "│",
  [DOWN]: "│",
  [LEFT]: "─",
  [RIGHT]: "─",
  [UP | DOWN]: "│",
  [LEFT | RIGHT]: "─",
  [UP | RIGHT]: "└",
  [UP | LEFT]: "┘",
  [DOWN | RIGHT]: "┌",
  [DOWN | LEFT]: "┐",
  [UP | DOWN | LEFT]: "┤",
  [UP | DOWN | RIGHT]: "├",
  [UP | LEFT | RIGHT]: "┴",
  [DOWN | LEFT | RIGHT]: "┬",
  [UP | DOWN | LEFT | RIGHT]: "┼",
};

/**
 * One link between two nodes, as marks on the direction mask. Same row: a rule
 * from the end of the left label to the start of the right one. Otherwise: down
 * the stem of the upper node, along the line between the two rows, and down
 * into the lower one.
 *
 * A link is only drawn where it has room — a run that would cross a third node
 * is dropped, because a schematic that lies about which zones touch is worse
 * than one missing a line.
 */
function link(mask: number[][], a: Placed, b: Placed, at: ReadonlyMap<number, Placed>): void {
  const [top, bottom] = a.row <= b.row ? [a, b] : [b, a];
  const occupied = (row: number, col: number): boolean =>
    [...at.values()].some((p) => p.row === row && p.col === col);

  if (top.row === bottom.row) {
    const [left, right] = top.col <= bottom.col ? [top, bottom] : [bottom, top];
    for (let c = left.col + 1; c < right.col; c++) {
      if (occupied(left.row, c)) return;
    }
    const from = left.col * CELL + Math.min(left.text.length, LABEL_WIDTH);
    for (let x = from; x < right.col * CELL; x++) mark(mask, left.row * 2, x, LEFT | RIGHT);
    return;
  }

  // A two-row jump passes straight through the node row in between, so that
  // cell has to be free.
  for (let r = top.row + 1; r < bottom.row; r++) {
    if (occupied(r, top.col)) return;
  }

  const stemX = top.col * CELL + STEM;
  const endX = bottom.col * CELL + STEM;
  const line = bottom.row * 2 - 1;
  for (let row = top.row * 2 + 1; row < line; row++) mark(mask, row, stemX, UP | DOWN);

  if (stemX === endX) {
    mark(mask, line, stemX, UP | DOWN);
    return;
  }
  const towards = stemX < endX ? RIGHT : LEFT;
  const back = stemX < endX ? LEFT : RIGHT;
  mark(mask, line, stemX, UP | towards);
  mark(mask, line, endX, back | DOWN);
  const [from, to] = stemX < endX ? [stemX, endX] : [endX, stemX];
  for (let x = from + 1; x < to; x++) mark(mask, line, x, LEFT | RIGHT);
}

function mark(mask: number[][], row: number, col: number, dirs: number): void {
  const line = mask[row];
  if (!line || col < 0 || col >= line.length) return;
  line[col] = line[col]! | dirs;
}

function write(canvas: string[][], row: number, col: number, text: string): void {
  const line = canvas[row];
  if (!line) return;
  for (let i = 0; i < text.length && col + i < line.length; i++) line[col + i] = text[i]!;
}

// ------------------------------------------------------------------- graph

/** Zones are adjacent when they share an airlock tile; DeckBuilder cuts one per edge. */
function edges(zones: readonly Zone[]): Array<[number, number]> {
  const owners = new Map<string, number[]>();
  for (const z of zones) {
    for (const a of z.airlocks) {
      const key = `${a.x},${a.y}`;
      const list = owners.get(key);
      if (list) {
        if (!list.includes(z.id)) list.push(z.id);
      } else owners.set(key, [z.id]);
    }
  }

  const seen = new Set<string>();
  const out: Array<[number, number]> = [];
  for (const ids of owners.values()) {
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        const key = `${a}-${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([a, b]);
      }
    }
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** A zone counts as visited once any of its tiles has been seen. */
function isExplored(level: Level, zone: Zone): boolean {
  const { x1, y1, x2, y2 } = zone.rect;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (level.explored.get(x, y) === true) return true;
    }
  }
  return false;
}
