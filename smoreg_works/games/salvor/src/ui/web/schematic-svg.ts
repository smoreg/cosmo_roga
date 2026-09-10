import {
  TUG_GLYPH,
  type SchematicDoor,
  type SchematicInput,
  type SchematicRoom,
  type SchematicThing,
} from "../schematic.js";
import { thingsOf, tileDefs, tileRow, zoneTile } from "./tiles.js";
import { esc } from "./xml.js";

/**
 * The ship schematic again, as SVG this time.
 *
 * Same input as the terminal drawing — `schematicInputOf(game)` — and the same
 * facts on the screen: a box per compartment, a label per door, the tug hanging
 * off the airlock and the hull line down the right. What it does not share is the
 * terminal's arithmetic: a character cell is 1x1 and a viewBox is not, so the
 * geometry here is its own (`layout` below) and derived from the same `col`/`row`
 * the engine's `layoutShip` assigns.
 *
 * A string in, a string out, with every colour and weight left to the class
 * names — which is what makes the whole drawing testable in a suite with no DOM,
 * and what keeps the palette in `theme.ts` where the terminal reads it too.
 *
 * The one difference from the ASCII view worth stating: this drawing has no
 * window. The terminal shows four columns of six rows and writes the edges it
 * could not wire as references beside their boxes (`Schematic.referenced`, G49);
 * SVG scales, so every compartment is on screen and every door is a real line.
 */

/** The compartment box, and the grid it sits on. */
const BOX_W = 132;
const BOX_H = 76;
const COL_STEP = 186;
const ROW_STEP = 104;
/** Space to the left of the first column: exactly the tug and its airlock label. */
const ORIGIN_X = 112;
/** Space above the first row: the banner. */
const ORIGIN_Y = 58;
/** Space to the right of the last column, where the hull line runs. */
const RIGHT_PAD = 56;
/** Space under the last row: the caption naming the hull. */
const BOTTOM_PAD = 52;

/** The tug: its own box, and the gap the airlock label sits in. */
const TUG_W = 66;
const TUG_H = 52;
const TUG_GAP = 46;

/** Where a door meets a box, as a fraction of its height: the two ports a side has. */
const PORT_Y: readonly [number, number] = [0.34, 0.68];

/** How far into the gutter a door's vertical run sits, from the left box's edge. */
const GUTTER_MID = (COL_STEP - BOX_W) / 2;

/** The door label plate, drawn on the wire. */
const TAG_H = 20;
const TAG_CHAR_W = 8;
const TAG_PAD = 10;

/** What an unexplored compartment says instead of a name. Same mark as the terminal's. */
const UNKNOWN = "····";

/**
 * The tile row inside a box (`?tiles=1`): six cells of sixteen units on a step
 * of twenty.
 *
 * Every number here is a measurement rather than a taste, and the first one was
 * wrong before it was measured. `docs/tiles-design.md` (2.2) put the schematic
 * at 2.0–2.6×, which would have made a twelve-unit cell 24–31 CSS px; a hull of
 * the size the game actually generates draws at **1.2×**, and twelve units
 * there is fourteen pixels — under the em box of the letter it replaced and all
 * but on the floor the format has, where a tile reads slower than a character
 * (`docs/gui-guides.md`, 6.1). Sixteen units puts it back at nineteen.
 *
 * The four units the step leaves between cells are the gap the set was measured
 * to need: two wide chassis drawn touching read as one machine. Six cells is
 * what 132 units of box hold at that step, and the seventh thing becomes `+N`.
 *
 * The band `y + 34 … y + 50` is chosen by what it must not touch: the
 * compartment's name has its baseline at `y + 25` and `rN` at `y + 64`, and the
 * one rule a tile may not break is that a label never lies under it
 * (`docs/gui-guides.md`, 6.7) — `tests/tiles-view.test.ts` measures both gaps,
 * at the scale a generated hull is drawn at rather than at the fixture's.
 */
const TILE_SIZE = 16;
const TILE_STEP = 20;
const TILE_MAX = 6;
const TILE_X = 10;
const TILE_Y = 34;

/**
 * The compartment's own pictogram, at the set's larger grid, standing in front
 * of the name rather than over it. Six kinds have one (`ui/web/tiles.ts`); the
 * name starts where it always did on every other compartment, so a hull of
 * corridors is the drawing it was.
 */
const ZONE_SIZE = 16;
const ZONE_X = 10;
const ZONE_Y = 12;
/** Where the name begins once a pictogram is in front of it. */
const NAME_X_TILED = 32;

interface Point {
  x: number;
  y: number;
}

interface Placed {
  room: SchematicRoom;
  x: number;
  y: number;
}

/**
 * The whole picture. `banner` is `bannerLine(game)` — the one line of the screen
 * that says which ship this is — and it is a parameter rather than part of
 * `SchematicInput` because the terminal draws it separately too.
 */
export function svgOf(input: SchematicInput, banner = "", tiles = false): string {
  const placed = place(input.rooms);
  const boxes = new Map(placed.map((p) => [p.room.id, p]));
  const size = extent(placed);

  const parts = [
    hull(size),
    ...input.doors.map((door) => wire(door, boxes)).filter((s) => s.length > 0),
    ...placed.map((p) => box(p, tiles)),
    ...input.doors.map((door) => tag(door, boxes)).filter((s) => s.length > 0),
    tug(input, boxes),
    banner.length > 0 ? text(16, 30, banner, "banner") : "",
    input.shipLine.length > 0 ? text(16, size.h - 18, input.shipLine, "ship-line") : "",
  ];
  const body = parts.filter((s) => s.length > 0).join("");
  // The symbols this frame referenced, and none of the other sixty. Empty when
  // the flag is off, which is what makes the plain drawing byte for byte the
  // one it was before tiles existed (`tests/tiles-view.test.ts`).
  return [
    `<svg class="schematic${tiles ? " has-tiles" : ""}" viewBox="0 0 ${size.w} ${size.h}" preserveAspectRatio="xMidYMid meet" role="img">`,
    tileDefs(body),
    body,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------- geometry

/**
 * Every compartment on the grid, one per cell. Two rooms sharing a cell would be
 * one box drawn twice, so the deeper of the pair is dropped exactly as the
 * terminal drops it — a generator that produced one is a bug in the generator.
 */
function place(rooms: readonly SchematicRoom[]): Placed[] {
  const taken = new Set<string>();
  const out: Placed[] = [];
  for (const room of [...rooms].sort((a, b) => here(b) - here(a))) {
    const cell = `${room.row}:${room.col}`;
    if (room.col < 0 || room.row < 0 || taken.has(cell)) continue;
    taken.add(cell);
    out.push({ room, x: ORIGIN_X + COL_STEP * room.col, y: ORIGIN_Y + ROW_STEP * room.row });
  }
  return out;
}

function here(room: SchematicRoom): number {
  return room.state === "current" ? 1 : 0;
}

/** The canvas the placed boxes need, with room for the tug, the hull and the caption. */
function extent(placed: readonly Placed[]): { w: number; h: number } {
  const right = placed.reduce((m, p) => Math.max(m, p.x + BOX_W), ORIGIN_X);
  const bottom = placed.reduce((m, p) => Math.max(m, p.y + BOX_H), ORIGIN_Y);
  return { w: right + RIGHT_PAD, h: bottom + BOTTOM_PAD };
}

/** Which of the two ports on a side, as an absolute y inside a box. */
function portY(p: Placed, port: 0 | 1): number {
  return p.y + BOX_H * PORT_Y[port];
}

// ------------------------------------------------------------------- boxes

function box(p: Placed, tiles: boolean): string {
  const { room } = p;
  const unknown = room.state === "unknown";
  const name = unknown ? UNKNOWN : room.name;
  // The pictogram, and the name shifted out from under it. An unknown
  // compartment gets neither: what it is for is exactly what the drone has not
  // found out yet, and a picture of a reactor on a dashed box would be the map
  // telling a lie the dashes are there to prevent.
  const picture = tiles && !unknown ? zoneTile(room, p.x + ZONE_X, p.y + ZONE_Y, ZONE_SIZE) : "";
  const body = [
    `<rect class="room-box" x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="3"/>`,
    picture,
    text(p.x + (picture.length > 0 ? NAME_X_TILED : 10), p.y + 25, name, "room-name"),
    text(p.x + BOX_W - 10, p.y + BOX_H - 12, room.label, "room-id", "end"),
  ].filter((s) => s.length > 0);
  // An unknown box carries glyphs only when the adapter put a known hazard's
  // mark on it (`ui/schematic-input.ts`, `marksOf`): the one thing a
  // compartment nobody has looked into can still show.
  if (room.glyphs.length > 0) body.push(tiles ? tileRowOf(p) : glyphRow(p));
  if (!unknown && (room.hostiles ?? 0) > 0) body.push(threat(p));
  // The halo sits under nothing and over nothing: it is a second rect on the
  // box's own outline, so the amber frame of the compartment the drone stands
  // in reads from the far side of the screen without the frame itself growing.
  if (room.state === "current") {
    body.unshift(
      `<rect class="room-halo" x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="3"/>`,
    );
  }
  // A machine has just come into sight in here, and the box says so for a beat
  // or two (`ui/pulse.ts`). A class rather than an attribute, because the whole
  // of the effect is colour and the palette lives in the stylesheet — the same
  // flash the terminal draws by painting the box's cells `bad`.
  const flashing = room.alarm === true || room.threat === true ? " is-alarmed" : "";
  // Where the highlighted line of the move list would take the drone.
  const aimed = room.target === true ? " is-goal" : "";
  // The id is on the box so a click can be a destination (`ui/web/mount.ts`).
  return `<g class="room is-${room.state}${aimed}${flashing}" data-room="${room.id}">${body.join("")}</g>`;
}

/**
 * What is lying and standing in the compartment, machines first and in the
 * colour of trouble.
 *
 * `hostiles` counts terminal columns, and the terminal joins glyphs with a
 * space — so n machines are 2n-1 columns wide (`ui/schematic-input.ts`,
 * `hostileWidth`). Reading the count back out of that is the whole of the
 * arithmetic here: which glyphs are machines is decided over there, once.
 */
function glyphRow(p: Placed): string {
  const glyphs = p.room.glyphs.split(" ").filter((g) => g.length > 0);
  const machines = Math.ceil((p.room.hostiles ?? 0) / 2);
  // Advanced by what each mark actually is: the airlock's own label is two
  // characters wide and everything else is one (`homeGlyphs`), so a fixed step
  // either crowds the pair or wastes the row.
  let x = p.x + 12;
  const cells = glyphs.map((glyph, i) => {
    const cell = text(x, p.y + BOX_H - 14, glyph, i < machines ? "glyph hostile" : "glyph");
    x += glyph.length * 9 + 8;
    return cell;
  });
  return cells.join("");
}

/**
 * The same row with the pictures in it (`?tiles=1`).
 *
 * The row is the only thing that changes: same contents, same order, same
 * colours, and a mark the set has no drawing for still comes out as its letter
 * — which is the whole promise of the flag, and why it is a modifier rather
 * than a fourth view (docs/tiles-design.md, 3).
 */
function tileRowOf(p: Placed): string {
  return tileRow(thingsOf(p.room), {
    x: p.x + TILE_X,
    y: p.y + TILE_Y,
    size: TILE_SIZE,
    step: TILE_STEP,
    max: TILE_MAX,
    baseline: p.y + TILE_Y + TILE_SIZE,
  });
}

/**
 * Machines are in there, said on the box and not only on one small glyph: a red
 * cap over its top edge carrying the count.
 *
 * A digit rather than a word, because it has to be true in three languages and
 * this file has no table. It is an addition to the compartment's state and
 * never a replacement for it — the box keeps whatever frame being unknown, seen
 * or stood in gave it, and gains a cap.
 *
 * The count comes back out of `hostiles` the way `glyphRow` reads it: that
 * field is terminal columns, and the terminal joins glyphs with a space, so n
 * machines are 2n-1 columns wide (`ui/schematic-input.ts`, `hostileWidth`).
 */
function threat(p: Placed): string {
  const machines = Math.ceil((p.room.hostiles ?? 0) / 2);
  const w = 22;
  return [
    `<rect class="threat-cap" x="${p.x + BOX_W - w - 6}" y="${p.y - 7}" width="${w}" height="14" rx="2"/>`,
    text(p.x + BOX_W - w / 2 - 6, p.y + 4, String(machines), "threat-count", "middle"),
  ].join("");
}

// ------------------------------------------------------------------- doors

/**
 * The wire between two compartments: straight across the gutter when the rooms
 * sit on one row, and an elbow down the middle of it when they do not. Doors
 * inside one column run between the two boxes instead.
 *
 * Drawn before the boxes, so an elbow that has to pass a compartment passes
 * behind it rather than through it.
 */
function wire(door: SchematicDoor, boxes: ReadonlyMap<number, Placed>): string {
  const ends = endsOf(door, boxes);
  if (!ends) return "";
  const [from, to] = ends;
  const d =
    from.x === to.x
      ? `M ${from.x} ${from.y} L ${to.x} ${to.y}`
      : `M ${from.x} ${from.y} L ${bend(from, to)} ${from.y} L ${bend(from, to)} ${to.y} L ${to.x} ${to.y}`;
  return `<path class="door-wire is-${door.state}${door.target === true ? " is-goal" : ""}" d="${d}"/>`;
}

/**
 * The door's own label, on a plate over its wire.
 *
 * Pinned to the row the shallower compartment's port leaves by, which is the
 * terminal's rule as well ("метка двери прижата к стороне левого отсека",
 * design-doc.md, "Экран") and here it is load-bearing rather than decorative:
 * one box has two ports a side, so two doors down one gutter cannot land on the
 * same row — and hung at the middle of their wires instead, they did.
 */
function tag(door: SchematicDoor, boxes: ReadonlyMap<number, Placed>): string {
  const ends = endsOf(door, boxes);
  if (!ends) return "";
  const [from, to] = ends;
  // The middle of the wire, including the middle of an elbow's vertical run.
  // Pinned to the shallower room's port row before, which put every label of a
  // gutter on the same two rows: five chips in a stack, none of them obviously
  // on any one line.
  const at = from.x === to.x ? mid(from, to) : { x: bend(from, to), y: (from.y + to.y) / 2 };
  const w = door.label.length * TAG_CHAR_W + TAG_PAD;
  return [
    `<g class="door is-${door.state}${door.target === true ? " is-goal" : ""}">`,
    `<rect class="door-tag" x="${round(at.x - w / 2)}" y="${round(at.y - TAG_H / 2)}" width="${w}" height="${TAG_H}" rx="3"/>`,
    text(round(at.x), round(at.y + 5), door.label, "door-label", "middle"),
    "</g>",
  ].join("");
}

/**
 * Where a door leaves each of its two rooms. Nothing is returned for a door
 * whose far side is not on the drawing — which cannot happen here, since this
 * view has no window, and is the terminal's business (`refer`) when it does.
 */
function endsOf(door: SchematicDoor, boxes: ReadonlyMap<number, Placed>): [Point, Point] | undefined {
  if (door.a === door.b) return undefined;
  const a = boxes.get(door.a);
  const b = boxes.get(door.b);
  if (!a || !b) return undefined;

  if (a.room.col === b.room.col) {
    const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
    return [
      { x: upper.x + BOX_W / 2, y: upper.y + BOX_H },
      { x: lower.x + BOX_W / 2, y: lower.y },
    ];
  }
  const left = a.room.col < b.room.col ? a : b;
  const right = left === a ? b : a;
  const leftPort = left === a ? door.portA : door.portB;
  const rightPort = right === a ? door.portA : door.portB;
  return [
    { x: left.x + BOX_W, y: portY(left, leftPort) },
    { x: right.x, y: portY(right, rightPort) },
  ];
}

/** The column an elbow turns in: the middle of the gutter beside the shallower room. */
function bend(from: Point, to: Point): number {
  return round(Math.min(from.x, to.x) + GUTTER_MID);
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// -------------------------------------------------------------- the rest of it

/**
 * The drone's own ship, hanging off whichever compartment carries the airlock.
 * Always to the left, as on the terminal: home is the direction the player came
 * from, and it is the one edge the drawing may never drop.
 */
function tug(input: SchematicInput, boxes: ReadonlyMap<number, Placed>): string {
  const dock = input.tug ? boxes.get(input.tug.at) : undefined;
  if (!dock) return "";
  const x = dock.x - TUG_GAP - TUG_W;
  const y = dock.y + (BOX_H - TUG_H) / 2;
  const cy = y + TUG_H / 2;
  const label = input.tug?.label ?? "";
  return [
    '<g class="tug">',
    `<path class="door-wire is-airlock" d="M ${x + TUG_W} ${cy} L ${dock.x} ${cy}"/>`,
    `<rect class="tug-box" x="${x}" y="${y}" width="${TUG_W}" height="${TUG_H}" rx="4"/>`,
    text(x + TUG_W / 2, cy + 7, TUG_GLYPH, "tug-name", "middle"),
    label.length > 0 ? text(round(x + TUG_W + TUG_GAP / 2), round(cy - 8), label, "door-label", "middle") : "",
    "</g>",
  ]
    .filter((s) => s.length > 0)
    .join("");
}

/** The hull down the right edge, in the one red the terminal keeps for it. */
function hull(size: { w: number; h: number }): string {
  const x = size.w - RIGHT_PAD / 2;
  return `<path class="hull" d="M ${x} 12 L ${x} ${size.h - 12}"/>`;
}

function text(x: number, y: number, body: string, cls: string, anchor?: string): string {
  const at = anchor ? ` text-anchor="${anchor}"` : "";
  return `<text class="${cls}" x="${round(x)}" y="${round(y)}"${at}>${esc(body)}</text>`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The escape both drawings share, re-exported from where half the view already
 * imports it. It moved to `xml.ts` when `tiles.ts` came to need it too
 * (importing it back from here would have closed a cycle).
 */
export { esc } from "./xml.js";
