import { HEX_SPACING, type HexCell, type HexLayout } from "@jamrog/engine";
import type { HullArt } from "../../content/hulls-art.js";
import { hullLayer, type Box } from "./hullart.js";
import { esc } from "./schematic-svg.js";
import { thingsOf, tileDefs, tileRow, tileRowWidth, zoneTile } from "./tiles.js";
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
 *
 * ## The hull under it
 *
 * Given `art`, a drawn ship goes **under** the honeycomb (`hullart.ts`): the
 * profile the honeycomb was grown inside when the layout honoured it
 * (`layout.masked`, G82), or a skin traced around the cells when it could not
 * (G81). It is the first thing in the document, so every duct, corridor,
 * hexagon and door covers it — the amber marks stay on top, and the map is
 * the map it was. It widens the frame by what it draws, and nothing else
 * about the picture moves. Without `art` the output is byte for byte what it
 * was before there was a hull, which is what `?hull=0` gives and what the
 * fixture in `tests/hex-svg.test.ts` holds it to.
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

/**
 * The tile row inside a hexagon (`?tiles=1`): four cells of twelve units on a
 * step of fifteen.
 *
 * Smaller than the box's sixteen, and the hexagon is why. A pointy-top cell is
 * widest across its middle and narrows to a point, and the middle is taken by
 * the name and the id — so the row sits low, where the outline has already
 * closed in. At `y + 29` the cell is 59 units across; four twelves on a step of
 * fifteen span 57, and that is the whole of the arithmetic. It is also the
 * ceiling `docs/tiles-design.md` (2.5) worked out for the honeycomb before any
 * of this was drawn.
 *
 * What the size costs is worth stating plainly, because it is the weakest part
 * of the feature. Measured across every class, twelve seeds and three depths,
 * inside the profile G82 grows the cells in: the view runs at 0.80–1.68x on the
 * itch page, median 1.11, so a twelve-unit tile is 13 CSS px in the middle of
 * the range and 10 at the worst. That is at or just under the floor of
 * `docs/gui-guides.md` 6.1 — and unavoidable in a frame that has to hold
 * nineteen compartments and a hull. What makes it worth doing anyway is the
 * comparison: the glyph it replaces is `font-size:12` with a fifth of an em of
 * tracking, so the picture is never smaller than the letter was.
 */
const TILE_SIZE = 12;
const TILE_STEP = 15;
const TILE_MAX = 4;
/** Bottom of the row, measured down from the centre: the id's descender clears it. */
const TILE_BOTTOM = 29;

/**
 * The compartment's own pictogram, above its name.
 *
 * The honeycomb is where this earns the most: twenty-two kinds, each clipped to
 * seven characters at `font-size:13` (`docs/tiles-design.md`, 1.2), so the shape
 * of the ship — where the three systems are — is a question the eye can answer
 * before it reads anything. Fourteen units rather than the box's sixteen, for
 * the same reason the row is twelve.
 */
const ZONE_SIZE = 14;
const ZONE_TOP = -30;

interface Point {
  x: number;
  y: number;
}

/**
 * The whole picture. `banner` is the one line saying which ship this is, and it
 * is a parameter for the same reason it is one in `svgOf`: the terminal draws it
 * separately too.
 */
export function hexSvgOf(
  input: SchematicInput,
  layout: HexLayout,
  banner = "",
  art?: HullArt,
  tiles = false,
): string {
  const at = new Map<number, Point>();
  const cells: HexCell[] = [];
  for (const room of input.rooms) {
    const cell = layout.cells.get(room.id);
    if (cell) {
      at.set(room.id, centre(cell));
      cells.push(cell);
    }
  }
  if (at.size === 0) return "";
  const hull = art === undefined ? undefined : hullLayer({
    cells,
    airlock: input.tug === undefined ? undefined : layout.cells.get(input.tug.at),
    at: centre,
    R,
    spacing: HEX_SPACING,
    art,
    form: layout.masked ? art.form : undefined,
  });
  const box = extent([...at.values()], hull?.box);

  const corridors = input.doors.filter((d) => layout.corridors.has(d.id));
  const links = input.doors.filter((d) => layout.links.has(d.id) && d.a !== d.b);
  const named = new Map(input.rooms.map((room) => [room.id, room.label]));

  const body = [
    hull?.svg ?? "",
    ...links.map((door) => duct(door, at)),
    ...corridors.map((door) => corridor(door, at)),
    ...input.rooms.map((room) => hex(room, at.get(room.id), tiles)),
    ...corridors.map((door) => tag(door, at)),
    ...stacked(links, at, named),
    // Where the drone is, last of everything on the deck: over the hazard's
    // floor, the target's dashes, the tiles and any chip that strays onto the
    // cell, so one amber mark is never covered by anything the map draws.
    ...input.rooms.map((room) => (room.state === "current" ? droneMark(at.get(room.id)) : "")),
    banner.length > 0 ? text(box.x + 14, box.y + 26, banner, "banner") : "",
    input.shipLine.length > 0
      ? text(box.x + 14, box.y + box.h - 12, input.shipLine, "ship-line")
      : "",
  ]
    .filter((s) => s.length > 0)
    .join("");
  // The symbols this frame referenced and none of the rest, read back off the
  // finished markup. Empty with the flag off, which is what keeps the drawing
  // byte for byte the one `tests/hex-svg.test.ts` holds a golden file of.
  return [
    `<svg class="schematic hexmap${tiles ? " has-tiles" : ""}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet" role="img">`,
    tileDefs(body),
    body,
    "</svg>",
  ]
    .filter((s) => s.length > 0)
    .join("");
}

// ---------------------------------------------------------------- geometry

/**
 * Axial to pixels, for pointy-top hexagons. Exported with `hexCorners` and
 * `HEX_R` for the hull's tests, which have to ask where a cell really is
 * rather than guess the same formula twice.
 */
export function hexCentre(cell: HexCell): Point {
  return { x: STEP * (cell.q + cell.r / 2), y: R * 1.5 * HEX_SPACING * cell.r };
}

const centre = hexCentre;

/** The drawn hexagon's circumradius, for whoever measures the picture. */
export const HEX_R = R;

/**
 * The frame: the hexagons plus room for their labels and the two captions —
 * and, when there is a hull, whatever it drew past them. The hull's box is
 * measured off what it actually emits (a pod's bell, a mast's dish), because
 * a frame guessed from the cells cut the exhausts off every ship in the
 * sandbox that had engines. The hexagons' own margins are not changed by it.
 */
function extent(points: readonly Point[], hull?: Box): { x: number; y: number; w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let x = Math.min(...xs) - INRADIUS - PAD.x;
  let y = Math.min(...ys) - R - PAD.top;
  let right = Math.max(...xs) + INRADIUS + PAD.x;
  let bottom = Math.max(...ys) + R + PAD.bottom;
  if (hull) {
    x = Math.min(x, hull.minX - HULL_PAD.x);
    y = Math.min(y, hull.minY - HULL_PAD.top);
    right = Math.max(right, hull.maxX + HULL_PAD.x);
    bottom = Math.max(bottom, hull.maxY + HULL_PAD.bottom);
  }
  return { x: round(x), y: round(y), w: round(right - x), h: round(bottom - y) };
}

/**
 * Air between the hull's outermost mark and the edge of the frame: a little
 * at the sides, and above and below the two captions' own height, so the
 * banner is never printed across a deck and the ship line never across a
 * pod. The hexagons keep their own margins, which are wider still.
 */
const HULL_PAD = { x: 8, top: 28, bottom: 18 };

/** The six points of a pointy-top hexagon, clockwise from the top. */
export function hexCorners(c: Point): Point[] {
  return corners(c);
}

function corners(c: Point, r = R): Point[] {
  const half = (Math.sqrt(3) / 2) * r;
  return [
    { x: c.x, y: c.y - r },
    { x: c.x + half, y: c.y - r / 2 },
    { x: c.x + half, y: c.y + r / 2 },
    { x: c.x, y: c.y + r },
    { x: c.x - half, y: c.y + r / 2 },
    { x: c.x - half, y: c.y - r / 2 },
  ];
}

// ------------------------------------------------------------------- hexes

function hex(room: SchematicRoom, c: Point | undefined, tiles: boolean): string {
  if (c === undefined) return "";
  const unknown = room.state === "unknown";
  const points = corners(c)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
  const body = [
    // What a pointer resting on the cell says: the name, the number and the
    // words of whatever the glyph row stands for — the same `things` the panel
    // names, so a hover never knows more than the drone does.
    `<title>${esc(tooltip(room, unknown))}</title>`,
    room.state === "current"
      ? `<polygon class="room-halo" points="${points}"/>`
      : "",
    `<polygon class="room-box" points="${points}"/>`,
    // Machines in sight in there: a red ring outside the outline, over whatever
    // state the compartment is in — the outline itself stays the state's.
    !unknown && (room.hostiles ?? 0) > 0 ? ring(c) : "",
    // A known hazard takes the one channel no state uses — the floor — and a
    // rim along the two upper edges, the side nearest the reader (3b). The
    // outline is left to the state, and red is left to the machines.
    room.hazard === undefined ? "" : rim(c),
    // What the compartment is for, over its name. Never on an unknown one:
    // that is precisely the fact the drone has not found out, and a reactor
    // drawn on a dashed cell would say otherwise.
    tiles && !unknown ? zoneTile(room, c.x - ZONE_SIZE / 2, c.y + ZONE_TOP, ZONE_SIZE) : "",
    // Its name over the compartment's, where the pictogram would otherwise go:
    // with tiles on, the tint and the tile say it between them.
    room.hazard === undefined || tiles ? "" : text(c.x, c.y - HAZARD_WORD, room.hazard.word, "hz-word", "middle"),
    text(c.x, c.y - 4, unknown ? UNKNOWN : room.name, "room-name", "middle"),
    text(c.x, c.y + 12, room.label, "room-id", "middle"),
  ];
  // Glyphs on an unknown hexagon are a known hazard's mark and nothing else
  // (`ui/schematic-input.ts`, `marksOf`).
  if (room.glyphs.length > 0) {
    body.push(tiles ? tileRowIn(room, c) : glyphRow(room, c, unknown));
  }
  if ((room.hostiles ?? 0) > 0) body.push(threat(c, room.hostiles ?? 0));
  if (room.charge !== undefined) body.push(fuse(c, room.charge));
  const fused = room.charge === undefined ? "" : ["", "is-fused"].join(" ");
  const aimed = room.target === true ? " is-goal" : "";
  const hot = room.alarm === true || room.threat === true ? " is-alarmed" : "";
  const hazard = room.hazard === undefined ? "" : ["", `hz-${room.hazard.id}`].join(" ");
  return [
    `<g class="room is-${room.state}${aimed}${hot}${hazard}${fused}" data-room="${room.id}">`,
    body.filter((s) => s.length > 0).join(""),
    "</g>",
  ].join("");
}

/** `MESS r6 · frost: engines slow here · scrap THRUSTERS 2/8`. */
function tooltip(room: SchematicRoom, unknown: boolean): string {
  const head = `${unknown ? UNKNOWN : room.name} ${room.label}`;
  return [head, ...(room.things ?? []).map((thing) => thing.name)].join(" · ");
}

/** Where the hazard's word sits, above the centre: clear of the name and of the cap. */
const HAZARD_WORD = 24;

/** The rim of a hazard: the upper-left and upper-right edges, over the outline. */
function rim(c: Point): string {
  const [top, right, , , , left] = corners(c);
  const points = [left!, top!, right!].map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
  return `<polyline class="hz-rim" points="${points}"/>`;
}

/**
 * The same contents with the pictures in it, centred on the cell.
 *
 * Centred and not left-aligned because a hexagon has no left edge to align to:
 * the row has to grow both ways from the middle or it leans out through one
 * side of the outline.
 */
function tileRowIn(room: SchematicRoom, c: Point): string {
  const things = thingsOf(room);
  const spec = { size: TILE_SIZE, step: TILE_STEP, max: TILE_MAX };
  return tileRow(things, {
    ...spec,
    x: round(c.x - tileRowWidth(things.length, spec) / 2),
    y: round(c.y + TILE_BOTTOM - TILE_SIZE),
    baseline: round(c.y + TILE_BOTTOM),
  });
}

/**
 * Machines in there: a red skull on the hexagon's own top point, with the count
 * inside it. A digit rather than a word — this file has no table to look one up
 * in — and an addition to whatever state the hexagon is in, never a replacement
 * for it. A skull rather than the plate it was: a red square read as one more
 * door tag («счётчик врагов в красном черепе вместо квадрата», the owner).
 */
function threat(c: Point, columns: number): string {
  const machines = Math.ceil(columns / 2);
  const x = round(c.x);
  const y = round(c.y - R);
  return [
    `<g class="threat" transform="translate(${x},${y})">`,
    `<polygon class="threat-skull" points="${SKULL}"/>`,
    ...[-3, 0, 3].map((dx) => `<line class="threat-teeth" x1="${dx}" y1="8" x2="${dx}" y2="11"/>`),
    `<text class="threat-count" x="0" y="3" text-anchor="middle">${machines}</text>`,
    "</g>",
  ].join("");
}

/**
 * The skull, centred on the point it sits on: a cranium ten units round, the
 * cheeks, and a jaw under them. The count is written where the eyes would be.
 */
const SKULL = [
  [-10, -1], [-9, -6], [-6, -10], [0, -12], [6, -10], [9, -6], [10, -1], [10, 4], [7, 7],
  [6, 7], [6, 12], [-6, 12], [-6, 7], [-7, 7], [-10, 4],
].map(([x, y]) => `${x},${y}`).join(" ");

/** The ring round a compartment with machines in sight: outside the outline, in red. */
function ring(c: Point): string {
  const points = corners(c, R + 6)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
  return `<polygon class="room-ring" points="${points}"/>`;
}

/**
 * The glyph row with the machines at its head painted red. `hostiles` counts
 * terminal columns, the machines' glyphs and the spaces between them, which is
 * exactly the length of the string to lift out (`ui/schematic-input.ts`,
 * `hostileWidth`). Never on an unknown cell: its only glyph is a hazard's mark.
 */
function glyphRow(room: SchematicRoom, c: Point, unknown: boolean): string {
  const width = unknown ? 0 : Math.min(room.hostiles ?? 0, room.glyphs.length);
  if (width === 0) return text(c.x, c.y + 26, room.glyphs, "glyph", "middle");
  const head = `<tspan class="glyph hostile">${esc(room.glyphs.slice(0, width))}</tspan>`;
  return `<text class="glyph" x="${round(c.x)}" y="${round(c.y + 26)}" text-anchor="middle">${head}${esc(room.glyphs.slice(width))}</text>`;
}

/**
 * The drone, on the compartment it stands in: an amber disc on the cell's
 * bottom point. The halo says "here" to an eye already looking; this is what
 * finds the cell for one that is not («иногда тяжело увидеть, где дрон»).
 */
function droneMark(c: Point | undefined): string {
  if (c === undefined) return "";
  const x = round(c.x);
  const y = round(c.y + R);
  return [
    `<g class="drone-mark" transform="translate(${x},${y})">`,
    `<circle class="drone-disc" cx="0" cy="0" r="9"/>`,
    `<polygon class="drone-core" points="-4,0 0,-4 4,0 0,4"/>`,
    "</g>",
  ].join("");
}

/**
 * The charge the ship set in here: the turns left, red, on the hexagon's
 * lower point — the one place neither the cap, the name nor the glyph row
 * uses (`systems/alert.ts`, the scuttle). A digit, for the same reason the
 * cap is one.
 */
function fuse(c: Point, left: number): string {
  const w = 20;
  return [
    `<rect class="fuse-cap" x="${round(c.x - w / 2)}" y="${round(c.y + R - 9)}"`,
    ` width="${w}" height="14" rx="2"/>`,
    text(c.x, c.y + R + 2, String(left), "fuse-count", "middle"),
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
  // `data-door` on both strokes: a click on the corridor is a click on its door
  // (`mount.ts`), and `is-route` is the door on the way to where the drone is
  // aiming (`SchematicDoor.route`).
  const route = door.route === true ? " is-route" : "";
  return [
    `<line class="hall-wall is-${door.state}" data-door="${door.id}"`,
    ` x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}"/>`,
    `<line class="door-wire is-${door.state}${door.target === true ? " is-goal" : ""}${route}" data-door="${door.id}"`,
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
    `<g class="door is-${door.state}${door.target === true ? " is-goal" : ""}${trapClass(door)}" data-door="${door.id}">`,
    // A known trap: a chevron over the label, and the label on the warning
    // colour (3b). Not amber — a locked door is amber, and a mined one must not
    // differ from it by the dash alone.
    door.trap === undefined ? "" : chevron(mid),
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
    `<line class="duct is-${door.state}${door.route === true ? " is-route" : ""}"`,
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
    `<g class="door link is-${door.state}${door.target === true ? " is-goal" : ""}${trapClass(door)}" data-door="${door.id}">`,
    `<rect class="door-tag" x="${round(x - w / 2)}" y="${round(y - TAG_H / 2)}"`,
    ` width="${w}" height="${TAG_H}" rx="2"/>`,
    text(x, y + 4, label, "door-label", "middle"),
    "</g>",
  ].join("");
}

/** `has-trap hz-mine`, on a door the drone knows is trapped. */
function trapClass(door: SchematicDoor): string {
  return door.trap === undefined ? "" : ["", "has-trap", `hz-${door.trap}`].join(" ");
}

/** The mark over a trapped door's label: a chevron pointing up off the plate. */
function chevron(mid: Point): string {
  const top = mid.y - TAG_H / 2 - 12;
  const foot = mid.y - TAG_H / 2 - 3;
  const points = [
    [mid.x - 10, foot],
    [mid.x, top],
    [mid.x + 10, foot],
  ].map(([x, y]) => `${round(x!)},${round(y!)}`);
  return `<polyline class="trap-mark" points="${points.join(" ")}"/>`;
}

// -------------------------------------------------------------------- bits

function text(x: number, y: number, body: string, cls: string, anchor?: string): string {
  const at = anchor === undefined ? "" : ` text-anchor="${anchor}"`;
  return `<text class="${cls}" x="${round(x)}" y="${round(y)}"${at}>${esc(body)}</text>`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
