import { HEX_SPACING, type HexCell, type HexLayout } from "@jamrog/engine";
import { esc } from "./schematic-svg.js";
import type { SchematicDoor, SchematicInput, SchematicRoom } from "../schematic.js";

/**
 * The ship as a honeycomb: one hexagon per compartment, one straight corridor
 * per door, nothing crossing anything.
 *
 * The owner's third view and his own reference (`docs/tasks/G62-hex-view.md`):
 * a deck plan rather than a wiring diagram. Where the boxes-and-wires drawing
 * routes elbows through gutters and has to work at not crossing itself, this one
 * cannot cross by construction — every corridor joins two hexagons that touch,
 * and two touching hexagons have nothing between them.
 *
 * ## The geometry, and the one rule it turns on
 *
 * Pointy-top hexagons on axial coordinates (`hexLayout`, in the engine). The
 * line between the centres of two neighbouring cells is **perpendicular to the
 * edge they share**, and it crosses that edge at its midpoint — so a corridor
 * drawn centre to centre, trimmed by the inradius at each end, meets both
 * outlines at ninety degrees and enters neither at a corner. There is no case
 * analysis and no special-casing of diagonals: the lattice does it.
 *
 * Same input as the other two drawings — `schematicInputOf(game)` — plus the
 * layout. `col` and `row` are simply not read here; the states, the glyphs, the
 * machine counts and the door states are the same facts the terminal draws, so
 * the three screens cannot disagree about the ship.
 */

/** Circumradius of a hexagon: centre to a point. Everything else follows. */
const R = 46;

/** Half the width, and the distance centre-to-edge: where a corridor stops. */
const INRADIUS = (Math.sqrt(3) / 2) * R;

/**
 * Centre-to-centre step of two neighbours: twice the inradius would pack the
 * hexagons edge to edge, so the lattice is spread by `HEX_SPACING` and the
 * difference is the corridor. Packed tight there is nothing to draw — the
 * corridor comes out zero long, and the door label floats in a wall.
 */
const STEP = INRADIUS * 2 * HEX_SPACING;

/** Room for the labels of the outermost hexagons, and for the caption. */
const PAD = { x: 26, top: 46, bottom: 34 };

/** The label plate on a corridor, and the chip a link is drawn as. */
const TAG_H = 16;
const TAG_CHAR_W = 7;

/** What an unexplored compartment says instead of a name. Same as the terminal's. */
const UNKNOWN = "····";

interface Point {
  x: number;
  y: number;
}

/**
 * The whole picture. `banner` is the one line saying which ship this is, and it
 * is a parameter for the same reason it is one in `svgOf`: the terminal draws it
 * separately too.
 */
export function hexSvgOf(input: SchematicInput, layout: HexLayout, banner = ""): string {
  const at = new Map<number, Point>();
  for (const room of input.rooms) {
    const cell = layout.cells.get(room.id);
    if (cell) at.set(room.id, centre(cell));
  }
  if (at.size === 0) return "";
  const box = extent([...at.values()]);

  const corridors = input.doors.filter((d) => layout.corridors.has(d.id));
  const links = input.doors.filter((d) => layout.links.has(d.id) && d.a !== d.b);
  const named = new Map(input.rooms.map((room) => [room.id, room.label]));

  return [
    `<svg class="schematic hexmap" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet" role="img">`,
    ...links.map((door) => duct(door, at)),
    ...corridors.map((door) => corridor(door, at)),
    ...input.rooms.map((room) => hex(room, at.get(room.id))),
    ...corridors.map((door) => tag(door, at)),
    ...stacked(links, at, named),
    banner.length > 0 ? text(box.x + 14, box.y + 26, banner, "banner") : "",
    input.shipLine.length > 0
      ? text(box.x + 14, box.y + box.h - 12, input.shipLine, "ship-line")
      : "",
    "</svg>",
  ]
    .filter((s) => s.length > 0)
    .join("");
}

// ---------------------------------------------------------------- geometry

/** Axial to pixels, for pointy-top hexagons. */
function centre(cell: HexCell): Point {
  return { x: STEP * (cell.q + cell.r / 2), y: R * 1.5 * HEX_SPACING * cell.r };
}

function extent(points: readonly Point[]): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - INRADIUS - PAD.x;
  const y = Math.min(...ys) - R - PAD.top;
  const w = Math.max(...xs) + INRADIUS + PAD.x - x;
  const h = Math.max(...ys) + R + PAD.bottom - y;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

/** The six points of a pointy-top hexagon, clockwise from the top. */
function corners(c: Point): Point[] {
  const half = INRADIUS;
  return [
    { x: c.x, y: c.y - R },
    { x: c.x + half, y: c.y - R / 2 },
    { x: c.x + half, y: c.y + R / 2 },
    { x: c.x, y: c.y + R },
    { x: c.x - half, y: c.y + R / 2 },
    { x: c.x - half, y: c.y - R / 2 },
  ];
}

// ------------------------------------------------------------------- hexes

function hex(room: SchematicRoom, c: Point | undefined): string {
  if (c === undefined) return "";
  const unknown = room.state === "unknown";
  const points = corners(c)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
  const body = [
    room.state === "current"
      ? `<polygon class="room-halo" points="${points}"/>`
      : "",
    `<polygon class="room-box" points="${points}"/>`,
    text(c.x, c.y - 4, unknown ? UNKNOWN : room.name, "room-name", "middle"),
    text(c.x, c.y + 12, room.label, "room-id", "middle"),
  ];
  if (!unknown && room.glyphs.length > 0) {
    body.push(text(c.x, c.y + 26, room.glyphs, "glyph", "middle"));
  }
  if ((room.hostiles ?? 0) > 0) body.push(threat(c, room.hostiles ?? 0));
  const aimed = room.target === true ? " is-goal" : "";
  const hot = room.alarm === true || room.threat === true ? " is-alarmed" : "";
  return [
    `<g class="room is-${room.state}${aimed}${hot}" data-room="${room.id}">`,
    body.filter((s) => s.length > 0).join(""),
    "</g>",
  ].join("");
}

/**
 * Machines in there: a red cap on the hexagon's own top point, with the count.
 * A digit rather than a word — this file has no table to look one up in — and an
 * addition to whatever state the hexagon is in, never a replacement for it.
 */
function threat(c: Point, columns: number): string {
  const machines = Math.ceil(columns / 2);
  const w = 20;
  return [
    `<rect class="threat-cap" x="${round(c.x - w / 2)}" y="${round(c.y - R - 7)}"`,
    ` width="${w}" height="14" rx="2"/>`,
    text(c.x, c.y - R + 4, String(machines), "threat-count", "middle"),
  ].join("");
}

// ---------------------------------------------------------------- corridors

/**
 * The corridor: centre to centre, trimmed by the inradius at both ends.
 *
 * That trim is the whole of the geometry rule. Two neighbouring centres lie on
 * the normal of the edge they share, so the segment leaves one outline and
 * meets the other at ninety degrees, at the middle of the edge, whichever of
 * the six directions it runs in.
 */
function corridor(door: SchematicDoor, at: ReadonlyMap<number, Point>): string {
  const ends = trimmed(door, at);
  if (!ends) return "";
  const [from, to] = ends;
  return [
    `<line class="hall-wall is-${door.state}"`,
    ` x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}"/>`,
    `<line class="door-wire is-${door.state}"`,
    ` x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}"/>`,
  ].join("");
}

/** Where the corridor starts and stops: on the two outlines, not in the centres. */
function trimmed(door: SchematicDoor, at: ReadonlyMap<number, Point>): [Point, Point] | undefined {
  const a = at.get(door.a);
  const b = at.get(door.b);
  if (!a || !b) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return undefined;
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: a.x + ux * INRADIUS, y: a.y + uy * INRADIUS },
    { x: b.x - ux * INRADIUS, y: b.y - uy * INRADIUS },
  ];
}

/** The door's own label, on a plate at the middle of its corridor. */
function tag(door: SchematicDoor, at: ReadonlyMap<number, Point>): string {
  const ends = trimmed(door, at);
  if (!ends) return "";
  const [from, to] = ends;
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const w = door.label.length * TAG_CHAR_W + 8;
  return [
    `<g class="door is-${door.state}">`,
    `<rect class="door-tag" x="${round(mid.x - w / 2)}" y="${round(mid.y - TAG_H / 2)}"`,
    ` width="${w}" height="${TAG_H}" rx="2"/>`,
    text(mid.x, mid.y + 4, door.label, "door-label", "middle"),
    "</g>",
  ].join("");
}

/**
 * The run a link makes under the deck: a faint straight line between the two
 * compartments, drawn beneath the hexagons.
 *
 * This is what stops a link reading as a teleport. A chip on its own says "a
 * door is here" and nothing about the distance, and the owner read that exactly
 * as it looks: «че опять телепорты?». A line you can follow — long, dim, going
 * behind the compartments in between — says the other thing: a service run, a
 * walk the long way round. It is drawn first, so every hexagon and every
 * corridor covers it.
 */
function duct(door: SchematicDoor, at: ReadonlyMap<number, Point>): string {
  const a = at.get(door.a);
  const b = at.get(door.b);
  if (!a || !b) return "";
  return [
    `<line class="duct is-${door.state}"`,
    ` x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}"/>`,
  ].join("");
}

/**
 * Every link's two chips, spread so that two doors out of one compartment do
 * not print on top of each other.
 *
 * They did. A compartment with two long doors put both chips at the same point
 * on its own edge, one hiding the other's second half — legible in neither.
 * Chips are counted per compartment and stepped down by their own height.
 */
function stacked(
  links: readonly SchematicDoor[],
  at: ReadonlyMap<number, Point>,
  named: ReadonlyMap<number, string>,
): string[] {
  const used = new Map<number, number>();
  const step = (room: number): number => {
    const n = used.get(room) ?? 0;
    used.set(room, n + 1);
    return n;
  };
  return links.map((door) => {
    const a = at.get(door.a);
    const b = at.get(door.b);
    if (!a || !b) return "";
    return [
      chip(a, b, door, named.get(door.b) ?? "", step(door.a)),
      chip(b, a, door, named.get(door.a) ?? "", step(door.b)),
    ].join("");
  });
}

/**
 * A door the lattice could not draw as a corridor, said instead: a chip beside
 * each of its two compartments, naming the door and where it leads.
 *
 * The honesty rule, and the reason this view is allowed to exist at all — a
 * honeycomb cannot embed every graph, so the ones it cannot embed are stated
 * rather than dropped (`hexLayout`, and G49 before it).
 */
/**
 * One end of a link: a chip on `from`, leaning towards `to`, and **naming where
 * the door goes**.
 *
 * The name is the whole of it. A chip reading `d12 ⇄` says a door is here and
 * nothing about where it comes out, which the owner read as the one thing this
 * game does not have: "тут есть телепорты типа d12, так не должно быть". A chip
 * reading `d12 → r7` is a door to a compartment with an id on the same screen —
 * far away, walked to the long way round, and no more a teleport than a
 * corridor is.
 */
function chip(from: Point, to: Point, door: SchematicDoor, far: string, rank: number): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const x = from.x + (dx / len) * (INRADIUS - 4);
  const y = from.y + (dy / len) * (R - 6) + rank * (TAG_H + 3);
  const label = far.length > 0 ? `${door.label} → ${far}` : door.label;
  const w = label.length * TAG_CHAR_W + 8;
  return [
    `<g class="door link is-${door.state}">`,
    `<rect class="door-tag" x="${round(x - w / 2)}" y="${round(y - TAG_H / 2)}"`,
    ` width="${w}" height="${TAG_H}" rx="2"/>`,
    text(x, y + 4, label, "door-label", "middle"),
    "</g>",
  ].join("");
}

// -------------------------------------------------------------------- bits

function text(x: number, y: number, body: string, cls: string, anchor?: string): string {
  const at = anchor === undefined ? "" : ` text-anchor="${anchor}"`;
  return `<text class="${cls}" x="${round(x)}" y="${round(y)}"${at}>${esc(body)}</text>`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
