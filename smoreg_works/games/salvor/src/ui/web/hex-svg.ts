import { HEX_SPACING, type HexCell, type HexLayout } from "@jamrog/engine";
import type { HullArt } from "../../content/hulls-art.js";
import { hullLayer, type Box } from "./hullart.js";
import { esc } from "./schematic-svg.js";
import { thingsOf, tileDefs, tileRow, tileRowWidth, zoneIdOf, zoneTile } from "./tiles.js";
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
 * ## The face of a cell, and why it is the encoding
 *
 * The partner's rework of the board (G91 B, his `HexTile.jsx`) turns on one
 * idea, and this file now does too: **how much is printed on a compartment is
 * how much the drone knows of it**, with colour backing that up rather than
 * carrying it. A cell nobody has found has no plate at all, which is why it
 * reads as a shape in the dark. A cell that was pinged has its name on a
 * *striped* plate — a label and not a look. A cell the drone has walked through
 * has it on a solid one: grey while that is memory, steel while the drone is
 * looking at it, amber while it is standing in it. Five states of ours against
 * his four, but the grammar is his, and it survives being printed in one colour.
 *
 * Everything else about a compartment — a hazard, an alarm — is a *property*
 * rather than knowledge, so it takes a channel of its own: a dashed ring inside
 * the outline whose rhythm says which one. A rhythm because the outline is the
 * state's, the floor is the hazard's tint and red is the machines'; there was
 * no hue left that meant anything, and there is always another rhythm.
 *
 * ## What a hover says, and who says it
 *
 * The board carries no `<title>`, on a cell or on a tile. It used to, and the
 * browser drew it: a yellow box in the system's own type, after the system's
 * own delay, over the readout that was already answering the same question in
 * our letters — "подсказка браузера тут точно не нужна, нужна нашего
 * интерфейса" (the owner). So the readout is the whole of it, and it is drawn
 * for every compartment the map is aiming at, including the one underfoot.
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

/**
 * The band the compartment's name is printed on.
 *
 * The partner's board (`design/salvor-design-system/components/board/HexTile.jsx`,
 * G91) turns on one idea: **the amount of information on a cell's face is the
 * encoding**, and the band is what carries it. A hexagon with no band has not
 * been found; a striped band means the drone has a label and not a look; a solid
 * one means it has been in there. The ink is knocked out of the plate, which is
 * the printed language the rest of the screen is already in.
 *
 * Sized off the lattice rather than chosen: a pointy-top hexagon is full width
 * for the whole `±R/2` about its centre, so a band sixteen units tall on the
 * name's own line is inside the outline by construction, whatever the cell.
 *
 * It is wider than the property ring is, and drawn after it, so on a cell that
 * has both the plate crosses the ring's two upright edges. That is his layering
 * and it is the right way round: the ring keeps its four slanted runs and its
 * lower halves — enough of a rhythm to read — and the name never has to give
 * width back to a decoration.
 */
const BAND_HALF = INRADIUS - 3;
const BAND_TOP = -15;
const BAND_H = 16;

/**
 * What one character of a name costs on the band: `font-size:13` in a monospace
 * face is 0.6em of advance, plus the tracking the honeycomb sets.
 *
 * Used to decide whether the name needs squeezing, not to lay it out — the
 * squeeze is `textLength`, so the browser's own metrics do the work and the
 * estimate only has to be close enough to catch the names that overflow.
 * His board clips a long name to the band's character budget; ours squeezes it,
 * because our names are translated and "ИНЖЕНЕРНЫЙ" cut to nine characters is a
 * different word in a way "ENGINEERIN" is not.
 */
const NAME_CHAR_W = 8.3;
const NAME_FIT = BAND_HALF * 2 - 6;

/** The ring a compartment's properties are said on: inside the outline, dashed. */
const PROP_RING_R = R - 7;

interface Point {
  x: number;
  y: number;
}

/** The drawing's own viewBox, for whatever has to stay inside it. */
interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
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
  // The way round for each door the lattice could not lay a corridor on, worked
  // out once: the run is drawn under the hexagons and its label over them, and
  // the two must be the same walk.
  const runs = new Map<number, Point[]>();
  for (const door of links) {
    const run = longRun(layout.cells.get(door.a), layout.cells.get(door.b));
    if (run !== undefined) runs.set(door.id, run);
  }
  const nameplates = plates(input, at);

  const body = [
    hull?.svg ?? "",
    ...links.map((door) => longCorridor(door, runs.get(door.id))),
    ...corridors.map((door) => corridor(door, at)),
    ...input.rooms.map((room) => hex(room, at.get(room.id), tiles)),
    ...corridors.map((door) => tag(door, at)),
    ...links.map((door) => tag(door, at, runs.get(door.id))),
    // Where the drone is, last of everything on the deck: over the hazard's
    // floor, the target's dashes, the tiles and any chip that strays onto the
    // cell, so one amber mark is never covered by anything the map draws.
    ...input.rooms.map((room) => (room.state === "current" ? droneMark(at.get(room.id)) : "")),
    // And over even that: what the compartment being aimed at is, what is
    // unusual in it, and what walking there would cost. It is handed the name
    // plates of the whole board so it can stand where it hides fewest of them.
    ...input.rooms.map((room) => readout(room, at.get(room.id), box, nameplates)),
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
function extent(points: readonly Point[], hull?: Box): Frame {
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
    room.state === "current"
      ? `<polygon class="room-halo" points="${points}"/>`
      : "",
    `<polygon class="room-box" points="${points}"/>`,
    // Machines in sight in there: a red ring outside the outline, over whatever
    // state the compartment is in — the outline itself stays the state's.
    !unknown && (room.hostiles ?? 0) > 0 ? ring(c, R + 6, "room-ring") : "",
    // A known hazard takes the one channel no state uses — the floor — and a
    // rim along the two upper edges, the side nearest the reader (3b). The
    // outline is left to the state, and red is left to the machines.
    room.hazard === undefined ? "" : rim(c),
    // And whatever else is true of the compartment gets its own channel: a
    // dashed ring inside the outline whose *rhythm* says which (G91, his `PROP`
    // table). Frost is the long slow dash, smoke the sparse one, a blown
    // compartment the hazard beat, an alarmed one the fast beat — so two cells
    // tinted the same dark still read apart, and a colourblind reader has a
    // channel that is not a hue.
    propRing(room) ? ring(c, PROP_RING_R, "prop-ring") : "",
    // What the compartment is for, and what is in the air in it — the line
    // above the name, shared when the cell has both to say.
    cap(room, c, tiles, unknown),
    // The name on its band, knocked out of it. Not on an unknown cell: the
    // absence of the plate is the whole of what that cell has to say.
    unknown ? "" : band(c, room.state === "scanned"),
    text(c.x, c.y - 4, unknown ? UNKNOWN : room.name, "room-name", "middle", unknown ? undefined : NAME_FIT),
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

/** Where the hazard's word sits, above the centre: clear of the name and of the cap. */
const HAZARD_WORD = 24;

/**
 * How wide the hexagon still is on that line, and the air between the two
 * things that share it. A pointy-top cell is full width only about its middle;
 * by the cap's line it has closed in to a little over half, and a word set at
 * its natural length ran out through the outline — `BLOWN COMPARTMENT` is
 * seventeen characters, and in Spanish twenty-three.
 */
const CAP_FIT = 52;
const CAP_GAP = 4;

/**
 * The cap line: the compartment's pictogram, the word for what fills it, or
 * both side by side.
 *
 * The word used to be dropped whenever the tiles were on, on the argument that
 * the tint and the mark said it between them. They do not: the owner played
 * `?tiles=1`, found a compartment with a wavy mark in it and asked what the
 * mark was («что значит этот знак?»). A picture nobody can name is a picture
 * that has to be looked up, and the map is where the answer belongs — so the
 * word is now drawn in every mode, and where the cell also has a pictogram the
 * two share the line rather than one silencing the other. Squeezed to the
 * cell's own width (`textLength`), because three languages name the same
 * hazard in three lengths and the longest of them is a sentence.
 */
function cap(room: SchematicRoom, c: Point, tiles: boolean, unknown: boolean): string {
  // Never a pictogram on an unknown cell: that is precisely the fact the drone
  // has not found out, and a reactor drawn on a dashed cell would say otherwise.
  const pic = tiles && !unknown && zoneIdOf(room.kind) !== undefined;
  const word = room.hazard?.word;
  if (word === undefined) {
    return pic ? zoneTile(room, c.x - ZONE_SIZE / 2, c.y + ZONE_TOP, ZONE_SIZE, true) : "";
  }
  const shared = pic ? ZONE_SIZE + CAP_GAP : 0;
  const fit = CAP_FIT - shared;
  const wide = Math.min(word.length * NAME_CHAR_W, fit);
  const left = c.x - (wide + shared) / 2;
  return [
    pic ? zoneTile(room, left, c.y + ZONE_TOP, ZONE_SIZE, true) : "",
    text(left + shared + wide / 2, c.y - HAZARD_WORD, word, "hz-word", "middle", fit),
  ].join("");
}

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
    // No `<title>`: this board answers a hover itself, in the readout.
    quiet: true,
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

/**
 * A hexagon concentric with a cell's own, for whatever has to be said around it:
 * the red ring outside the outline when machines are in sight, and the dashed
 * ring inside it when the compartment is alarmed or full of something.
 */
function ring(c: Point, r: number, cls: string): string {
  const points = corners(c, r)
    .map((p) => `${round(p.x)},${round(p.y)}`)
    .join(" ");
  return `<polygon class="${cls}" points="${points}"/>`;
}

/**
 * Whether the compartment has a property worth a ring at all.
 *
 * One ring and never two, as on his board: a cell that is both alarmed and full
 * of frost has one thing worth knowing, and the stylesheet's last rule — the
 * alarm's — is the one that paints it. A machine in there outranks the weather,
 * which is the same rule that gives red to the machines and nothing else.
 */
function propRing(room: SchematicRoom): boolean {
  if (room.state === "unknown") return room.hazard !== undefined;
  return room.hazard !== undefined || room.alarm === true || room.threat === true;
}

/**
 * The plate the name is printed on: a solid rectangle in the state's own colour,
 * and — while the knowledge is second-hand — one dashed line as wide as the band
 * is tall, which is a stripe in a single element.
 *
 * The stripe is a stroke and not a `<pattern>` on purpose. A pattern would want
 * a `<defs>` entry, and `tileDefs` reads the finished markup back to decide what
 * goes in `<defs>`; a second producer of definitions is a second thing that can
 * disagree with it.
 */
function band(c: Point, striped: boolean): string {
  const x = round(c.x - BAND_HALF);
  const y = round(c.y + BAND_TOP);
  const w = round(BAND_HALF * 2);
  const mid = round(c.y + BAND_TOP + BAND_H / 2);
  const plate = `<rect class="room-band" x="${x}" y="${y}" width="${w}" height="${BAND_H}"/>`;
  if (!striped) return plate;
  return `${plate}<line class="band-hatch" x1="${x}" y1="${mid}" x2="${round(x + w)}" y2="${mid}"/>`;
}

/**
 * The glyph row with the machines at its head painted red, and each of the
 * three systems in the colour of the job.
 *
 * `hostiles` counts terminal columns — the machines' glyphs and the spaces
 * between them, which is exactly the length of the string to lift out
 * (`ui/schematic-input.ts`, `hostileWidth`) — and that is the whole of it while
 * nothing else on the row wants a colour. A compartment with a system in it
 * does: the row is then set from the things themselves, one `<tspan>` per mark,
 * which spells the same string (`tests/tiles-view.test.ts` holds `glyphs` and
 * `things` to each other) and can paint any of them. Never on an unknown cell:
 * its only glyph is a hazard's mark.
 */
function glyphRow(room: SchematicRoom, c: Point, unknown: boolean): string {
  const width = unknown ? 0 : Math.min(room.hostiles ?? 0, room.glyphs.length);
  const things = unknown ? undefined : room.things;
  if (things !== undefined && things.some((thing) => thing.goal !== undefined)) {
    const marks = things.map((thing, i) => {
      const tone =
        thing.hostile === true
          ? ["", "hostile"].join(" ")
          : ["", "goal", `is-${thing.goal}`].join(" ");
      const gap = i === 0 ? "" : " ";
      return thing.goal === undefined && thing.hostile !== true
        ? esc(gap + thing.glyph)
        : `${esc(gap)}<tspan class="glyph${tone}">${esc(thing.glyph)}</tspan>`;
    });
    return `<text class="glyph" x="${round(c.x)}" y="${round(c.y + 26)}" text-anchor="middle">${marks.join("")}</text>`;
  }
  if (width === 0) return text(c.x, c.y + 26, room.glyphs, "glyph", "middle");
  const head = `<tspan class="glyph hostile">${esc(room.glyphs.slice(0, width))}</tspan>`;
  return `<text class="glyph" x="${round(c.x)}" y="${round(c.y + 26)}" text-anchor="middle">${head}${esc(room.glyphs.slice(width))}</text>`;
}

/**
 * The drone, crowning the compartment it stands in: a small amber hexagon
 * straddling the cell's bottom point, with the ink knocked out of it and the
 * drone's own mark inside. The halo says "here" to an eye already looking; this
 * is what finds the cell for one that is not («иногда тяжело увидеть, где дрон»).
 *
 * A hexagon and no longer a disc, because his `DroneMark` is the board's shape
 * at a smaller size — the thing standing in a cell is made of the same geometry
 * as the cell. It stays on the bottom point rather than the top one his board
 * crowns: the top point is the machine count's skull, and the two of them
 * together is the commonest cell on the map to be looking at.
 */
function droneMark(c: Point | undefined): string {
  if (c === undefined) return "";
  const x = round(c.x);
  const y = round(c.y + R);
  const at = { x: 0, y: 0 };
  const shell = corners(at, 11).map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
  const core = corners(at, 7.5).map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
  return [
    `<g class="drone-mark" transform="translate(${x},${y})">`,
    `<polygon class="drone-disc" points="${shell}"/>`,
    `<polygon class="drone-core" points="${core}"/>`,
    `<polygon class="drone-pip" points="-4,0 0,-4 4,0 0,4"/>`,
    "</g>",
  ].join("");
}

/**
 * The readout beside the compartment the pointer or the highlighted line is
 * aiming at: what it is, what is unusual in it, and what walking there costs.
 *
 * The partner's popover (G91 B, `renderHover` in his `04-hex` screen), on a
 * board that cannot have one. His is a React element mounted beside the hex on
 * mouseover; ours is part of the same string the rest of the map is, drawn for
 * whichever compartment `schematicInputOf` was told to aim at — which is the
 * hovered one, and equally the one the highlighted row of the list points at.
 * That is not a workaround: it means the readout answers the keyboard too, and
 * `m` down the travel list narrates itself on the map as it goes.
 *
 * It never says more than the cell does. An unnamed compartment reads `····`
 * here as it does on its own face, and its contents line is empty, because not
 * knowing is exactly the fact the map is drawing.
 *
 * Drawn for every compartment the map is aiming at, the one underfoot included.
 * That one has no cost line — there is no walk to where you already are — and
 * for a while it had no readout either, so the one cell a player looks at most
 * was the one cell that answered nothing («при наведении на текущую комнату
 * ничего»). The chip is what the walk costs; the rest is what is in there, and
 * what is in there is true wherever the drone is standing.
 */
function readout(
  room: SchematicRoom,
  c: Point | undefined,
  box: Frame,
  plates: readonly Rect[],
): string {
  if (c === undefined || room.aimed !== true) return "";
  const unknown = room.state === "unknown";
  const head = `${unknown ? UNKNOWN : room.name} ${room.label}`;
  // The same words the panel names, and no others: a readout that out-knew the
  // compartment's own block would be a second answer to one question.
  const said = unknown ? [] : (room.things ?? []).map((thing) => thing.name);
  const lines = wrapped(said, READ_CHARS, READ_LINES);
  const cost = room.reach?.line;
  const costW = cost === undefined ? 0 : cost.length * READ_CHAR + 12;
  const w = round(
    Math.max(head.length * READ_CHAR + costW + 14, ...lines.map((l) => l.length * READ_CHAR + 14), 120),
  );
  const h = READ_HEAD + lines.length * READ_LINE;
  const { x, y } = spot(c, w, h, box, plates);
  const chipX = x + w - 7 - costW;
  return [
    // Amber when the click is a move and red when it is not: the chip and the
    // plate's rule both take it off the group, so the readout cannot say "go"
    // in one colour and "you cannot" in the other.
    `<g class="room-readout${room.reach?.blocked === true ? " is-shut" : ""}">`,
    `<rect class="readout-plate" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`,
    text(x + 7, y + 15, head, "readout-head"),
    cost === undefined
      ? ""
      : `<rect class="readout-chip" x="${round(chipX)}" y="${y + 4}" width="${round(costW)}" height="14" rx="2"/>`,
    cost === undefined ? "" : text(chipX + costW / 2, y + 15, cost, "readout-cost", "middle"),
    ...lines.map((line, i) => text(x + 7, y + 30 + i * READ_LINE, line, "readout-body")),
    "</g>",
  ]
    .filter((s) => s.length > 0)
    .join("");
}

/** How wide a row of the readout's contents may get before the next one starts. */
const READ_CHARS = 30;
/** And how many rows there are: two, and the rest is a count. */
const READ_LINES = 2;
/** What one character of it costs: the plate's two sizes average out to this. */
const READ_CHAR = 6.4;
/** The head's own height, and one row of contents under it. */
const READ_HEAD = 22;
const READ_LINE = 14;

/** What the things in a compartment are called, between two of them. */
const READ_SEP = " · ";

/**
 * The contents of a compartment in at most `max` rows, **broken between things
 * and never inside one**.
 *
 * It used to be one row cut at thirty characters with an ellipsis on the end,
 * which in Russian reads as a typo rather than as a width: `тело кого-т…` is a
 * word with its last letters missing, and the owner read it as one («список а
 * на обрыв за ...»). A thing is the unit here — the row breaks between two of
 * them, and what is left over after the last row is said as a number, which is
 * the same `+N` the tile row already counts its overflow with.
 */
function wrapped(names: readonly string[], width: number, max: number): string[] {
  const rows: string[][] = [];
  for (const name of names) {
    const row = rows[rows.length - 1];
    if (row === undefined || (row.length > 0 && [...row, name].join(READ_SEP).length > width)) {
      rows.push([name]);
      continue;
    }
    row.push(name);
  }
  if (rows.length <= max) return rows.map((row) => row.join(READ_SEP));
  // More than the plate holds: the rows that fit, and — in place of as many
  // things at the end of the last of them as it takes — how many went unsaid.
  const kept = rows.slice(0, max);
  const tail = kept[max - 1]!;
  let left = names.length - kept.reduce((n, row) => n + row.length, 0);
  while (tail.length > 1 && [...tail, `+${left}`].join(READ_SEP).length > width) {
    tail.pop();
    left++;
  }
  return [...kept.slice(0, max - 1), [...tail, `+${left}`]].map((row) => row.join(READ_SEP));
}

/** A rectangle on the board: the readout's plate, and the plates it tries to miss. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every compartment's name plate, for the readout to keep off. */
function plates(input: SchematicInput, at: ReadonlyMap<number, Point>): Rect[] {
  const out: Rect[] = [];
  for (const room of input.rooms) {
    const c = at.get(room.id);
    // An unknown cell has no plate at all — that absence is what it says.
    if (c === undefined || room.state === "unknown") continue;
    out.push({ x: c.x - BAND_HALF, y: c.y + BAND_TOP, w: BAND_HALF * 2, h: BAND_H });
  }
  return out;
}

/**
 * Where the readout stands: clear of the cell it belongs to, inside the frame,
 * and over as few of the other compartments' names as the board allows.
 *
 * Eight places are tried in the order they are worth having, and the first that
 * hides nothing wins. The cell's own face is never among them, so the
 * compartment the player is pointing at cannot be the one the answer covers
 * («при наведении текст наезжает»).
 *
 * The first two are beside the cell and **just below its name's line**, which is
 * the whole trick. Every plate on the board sits on the same band — a strip
 * sixteen units tall on each row's own centre — and the rows are ninety-two
 * apart, so the sixty units under one band row are the one place on a honeycomb
 * where a plate this wide crosses no name at all. Level with the cell, which is
 * where this used to start, is level with every name in the row.
 */
function spot(c: Point, w: number, h: number, box: Frame, plates: readonly Rect[]): Point {
  const right = c.x + INRADIUS + 10;
  const left = c.x - INRADIUS - 10 - w;
  const under = c.y + R + 6;
  const over = c.y - R - 6 - h;
  // Just clear of the name band's lower edge, and of the one a row further up.
  const below = c.y + BAND_TOP + BAND_H + 3;
  const above = c.y + BAND_TOP - 3 - h;
  const tries: Point[] = [
    { x: right, y: below },
    { x: left, y: below },
    { x: right, y: above },
    { x: left, y: above },
    { x: right, y: under },
    { x: left, y: under },
    { x: c.x - w / 2, y: under },
    { x: c.x - w / 2, y: over },
  ];
  let best: Point | undefined;
  let fewest = Number.POSITIVE_INFINITY;
  for (const p of tries) {
    if (p.x < box.x + 6 || p.x + w > box.x + box.w - 6) continue;
    if (p.y < box.y + 6 || p.y + h > box.y + box.h - 6) continue;
    const hidden = plates.filter((r) => hits(r, { ...p, w, h })).length;
    if (hidden < fewest) {
      fewest = hidden;
      best = p;
      if (hidden === 0) break;
    }
  }
  // Nothing fits the frame whole — a hull two compartments wide, and a plate
  // wider than either side of it. Beside the cell and pushed in, as before: a
  // readout may never be the one thing that grows the drawing.
  if (best === undefined) {
    const wanted = right + w < box.x + box.w - 6 ? right : left;
    best = { x: Math.min(Math.max(wanted, box.x + 6), box.x + box.w - w - 6), y: c.y - h / 2 };
  }
  return {
    x: round(best.x),
    y: round(Math.min(Math.max(best.y, box.y + 6), box.y + box.h - h - 6)),
  };
}

function hits(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
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
  // `data-door` on every stroke: a click on the corridor is a click on its door
  // (`mount.ts`), and `is-route` is the door on the way to where the drone is
  // aiming (`SchematicDoor.route`). The rails carry it as well as the door's own
  // line does, so the way reads as a lit corridor rather than as a brighter door
  // in a dark one — his bracket down both edges of the run, said in the strokes
  // that are already there.
  const route = door.route === true ? " is-route" : "";
  // The one segment all three strokes run along: the same line, drawn wide, then
  // narrow, then narrower.
  const run = ` x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}"/>`;
  return [
    `<line class="hall-wall is-${door.state}${route}" data-door="${door.id}"`,
    run,
    // The deck between the two rails, so the corridor is hollow rather than a
    // solid brown bar (G91, his corridor): what is left of the wall is a rail
    // down each side, and an open door is then a gap you can see through
    // instead of a stroke painted the colour of the floor. It carries
    // `data-door` too — it is the middle of the corridor, and a click on the
    // middle of a corridor is a click on its door.
    `<line class="hall-floor is-${door.state}" data-door="${door.id}"`,
    run,
    `<line class="door-wire is-${door.state}${door.target === true ? " is-goal" : ""}${route}" data-door="${door.id}"`,
    run,
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

/**
 * The door's own label, on a plate at the middle of its corridor — or, given a
 * long run, halfway along the walk rather than halfway between its two ends.
 */
function tag(door: SchematicDoor, at: ReadonlyMap<number, Point>, run?: Point[]): string {
  const mid = run === undefined ? straightMid(door, at) : halfway(run);
  if (mid === undefined) return "";
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

/** The middle of an ordinary corridor, where its own label goes. */
function straightMid(door: SchematicDoor, at: ReadonlyMap<number, Point>): Point | undefined {
  const ends = trimmed(door, at);
  if (!ends) return undefined;
  const [from, to] = ends;
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

// ------------------------------------------------------------- the long runs

/**
 * A door whose two compartments do not touch, drawn as the walk it is.
 *
 * The honeycomb cannot embed every graph — a cell has six neighbours and a ship
 * with loops can want a seventh — so `hexLayout` hands back the doors it could
 * not make corridors of. They used to be *said* rather than drawn: a chip beside
 * each of the two compartments naming the other, `d18 → r15`. Two things were
 * wrong with that and the owner found both. The chip is wider than the gap
 * between two hexagons, so it always lay across the cells around it and never
 * went away («появилось и висит»). And a label at each end with nothing between
 * them is the one thing this game does not have: «d18 → r15 — телепорт! их не
 * должно быть».
 *
 * So the leftovers are drawn too, the long way round: a corridor that leaves
 * the hexagon at a corner and bends through the **gutter** — the gaps the
 * lattice leaves between cells, which `HEX_SPACING` opened and which no
 * compartment can ever stand in. It crosses nothing, it ends on two outlines,
 * and on the hulls we ship the two cells are two steps apart at the median:
 * one hexagon to walk around, drawn as one hexagon walked around.
 */

/**
 * A vertex of the gutter: where three cells that all touch each other leave a
 * triangle of deck between them.
 *
 * Two per cell — the triangle east of it and the one north-east — and each one
 * lies `STEP/√3` from all three centres, which is 61.7 against a hexagon's
 * reach of 46. So every gutter vertex is outside every hexagon, and the segment
 * between two of them passes the midpoint of two cells' own gap: thirteen units
 * clear of both outlines, whichever pair it runs between.
 */
interface Gap {
  q: number;
  r: number;
  /** The north-east triangle of the cell rather than the south-east one. */
  up: boolean;
}

/** The three cells that leave this gap between them. */
function gapCells(g: Gap): HexCell[] {
  return g.up
    ? [{ q: g.q, r: g.r }, { q: g.q + 1, r: g.r }, { q: g.q + 1, r: g.r - 1 }]
    : [{ q: g.q, r: g.r }, { q: g.q + 1, r: g.r }, { q: g.q, r: g.r + 1 }];
}

/** Where it is: the middle of those three centres. */
function gapAt(g: Gap): Point {
  const cells = gapCells(g).map(centre);
  return {
    x: (cells[0]!.x + cells[1]!.x + cells[2]!.x) / 3,
    y: (cells[0]!.y + cells[1]!.y + cells[2]!.y) / 3,
  };
}

/** The three gaps this one can be walked to: the ones sharing two of its cells. */
function gapsAround(g: Gap): Gap[] {
  return g.up
    ? [
        { q: g.q, r: g.r, up: false },
        { q: g.q + 1, r: g.r - 1, up: false },
        { q: g.q, r: g.r - 1, up: false },
      ]
    : [
        { q: g.q, r: g.r, up: true },
        { q: g.q - 1, r: g.r + 1, up: true },
        { q: g.q, r: g.r + 1, up: true },
      ];
}

/** The six gaps around one cell — its own corners, in the fixed order. */
function gapsOf(cell: HexCell): Gap[] {
  return [
    { q: cell.q, r: cell.r, up: false },
    { q: cell.q - 1, r: cell.r, up: false },
    { q: cell.q, r: cell.r - 1, up: false },
    { q: cell.q, r: cell.r, up: true },
    { q: cell.q - 1, r: cell.r, up: true },
    { q: cell.q - 1, r: cell.r + 1, up: true },
  ];
}

function gapKey(g: Gap): string {
  return `${g.q},${g.r},${g.up ? 1 : 0}`;
}

/** How many gaps a run may walk through before the drawing gives it up. */
const RUN_STEPS = 48;

/**
 * The way round, from one cell's outline to the other's.
 *
 * Steepest descent through the gutter and not a search, because the gutter has
 * no obstacles in it: every vertex has three neighbours a hundred and twenty
 * degrees apart, so one of them always lies within sixty degrees of the target
 * and the walk shortens on every step until it arrives. It ends on one of the
 * six gaps around the far cell — those are the six nearest gutter vertices to
 * its centre, so the descent cannot pass them — and the fixed order of
 * `gapsAround` breaks what ties are left, which is what keeps one seed drawing
 * one picture.
 */
function longRun(a: HexCell | undefined, b: HexCell | undefined): Point[] | undefined {
  if (a === undefined || b === undefined) return undefined;
  const target = centre(b);
  const goal = new Set(gapsOf(b).map(gapKey));
  const start = gapsOf(a).sort((p, q) => away(p, target) - away(q, target))[0];
  if (start === undefined) return undefined;
  const walk = [start];
  let here = start;
  while (!goal.has(gapKey(here)) && walk.length < RUN_STEPS) {
    let best: Gap | undefined;
    let shortest = away(here, target);
    for (const next of gapsAround(here)) {
      const d = away(next, target);
      if (d < shortest) {
        shortest = d;
        best = next;
      }
    }
    if (best === undefined) return undefined;
    walk.push(best);
    here = best;
  }
  if (!goal.has(gapKey(here))) return undefined;
  const through = walk.map(gapAt);
  return [
    onOutline(centre(a), through[0]!),
    ...through,
    onOutline(centre(b), through[through.length - 1]!),
  ];
}

function away(g: Gap, to: Point): number {
  const p = gapAt(g);
  return Math.hypot(p.x - to.x, p.y - to.y);
}

/**
 * Where the run meets a hexagon: on its outline, in the direction of the first
 * gap it walks through. That direction is always one of the cell's six corners
 * — a gutter vertex lies on the corner's own ray — so the run is attached to a
 * point of the hexagon and never to the middle of an edge, which is a corridor's
 * place and has to stay one.
 */
function onOutline(from: Point, toward: Point): Point {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * R, y: from.y + (dy / len) * R };
}

/** Halfway along a walk, measured along it and not between its ends. */
function halfway(run: readonly Point[]): Point | undefined {
  if (run.length < 2) return run[0];
  const legs = run.slice(1).map((p, i) => Math.hypot(p.x - run[i]!.x, p.y - run[i]!.y));
  let left = legs.reduce((sum, leg) => sum + leg, 0) / 2;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    if (left > leg) {
      left -= leg;
      continue;
    }
    const t = leg === 0 ? 0 : left / leg;
    return {
      x: run[i]!.x + (run[i + 1]!.x - run[i]!.x) * t,
      y: run[i]!.y + (run[i + 1]!.y - run[i]!.y) * t,
    };
  }
  return run[run.length - 1];
}

/**
 * The run itself: the corridor's own three strokes, bent — a rail down each
 * side, the deck between them, the door's state down the middle — drawn thinner
 * than a corridor because the gutter is thinner than a corridor is, and because
 * a service run is not a main passage.
 *
 * Drawn with the corridors and under the hexagons, which costs it nothing: it
 * never passes over a cell, so there is nothing for a cell to cover.
 */
function longCorridor(door: SchematicDoor, run: Point[] | undefined): string {
  if (run === undefined) return "";
  const points = ` points="${run.map((p) => `${round(p.x)},${round(p.y)}`).join(" ")}"/>`;
  const route = door.route === true ? " is-route" : "";
  return [
    `<g class="link" data-door="${door.id}">`,
    `<polyline class="link-run hall-wall is-${door.state}${route}"`,
    points,
    `<polyline class="link-run hall-floor is-${door.state}"`,
    points,
    `<polyline class="link-run door-wire is-${door.state}${door.target === true ? " is-goal" : ""}${route}"`,
    points,
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

/**
 * A line of text, and — given `fit` — one that is never wider than that.
 *
 * `textLength` is asked for only when the string would overflow, so an ordinary
 * name is set at its natural width and nothing is squeezed for the sake of a
 * rule. `spacingAndGlyphs` rather than `spacing`: at eleven characters the
 * tracking alone runs out and the letters have to give.
 */
function text(x: number, y: number, body: string, cls: string, anchor?: string, fit?: number): string {
  const at = anchor === undefined ? "" : ` text-anchor="${anchor}"`;
  const wide = fit !== undefined && body.length * NAME_CHAR_W > fit;
  const squeeze = wide ? ` textLength="${round(fit)}" lengthAdjust="spacingAndGlyphs"` : "";
  return `<text class="${cls}" x="${round(x)}" y="${round(y)}"${at}${squeeze}>${esc(body)}</text>`;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
