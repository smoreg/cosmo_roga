import { t } from "../i18n.js";
import { THEME } from "./theme.js";

/**
 * The ship schematic: the main screen, drawn the way Duskers draws a derelict —
 * a box per room, a label per door, and nothing else. The drone never walks a
 * grid, so position on this picture is the whole plan: "the reactor is two
 * columns deep behind a sealed bulkhead" is the fact the player acts on, and
 * only a picture carries it.
 *
 * Text in, text out: no rot.js, no RoomGame, no drawing. `schematicInputOf`
 * (G37) is the one place where the engine's `Ship` meets this file, so the
 * layout can be tested against hand-written inputs long before a ship exists.
 *
 * The geometry is design-doc.md ("Экран"), not taste: a room is a 9x4 box at
 * `x = 9 + 13*col`, `y = 1 + 5*row`, the four columns between two boxes are
 * exactly one door label wide, and the window shows four columns and six rows.
 *
 * The schematic never lies and is never silent either. A four-column gutter
 * cannot carry every wire — a label fills it edge to edge, so a run that has to
 * cross another compartment's label row has nowhere to go — and a picture that
 * simply dropped those edges drew a ship in pieces: the owner's fourth playtest
 * read the lower half of a hull as an island it had walked to on foot
 * (docs/tasks/G49-schematic-honesty.md). So an edge the layout cannot wire is
 * drawn as a reference at both of its ends instead — `→r11` against the box,
 * pointing the way the room lies. Only what neither a wire nor a reference can
 * carry comes back in `omitted`, for the panel to list.
 */

/**
 * Same states as the engine's `DoorState` (`rooms/graph.ts`, E17). Declared
 * here because E17 was not merged when this file was written; it becomes an
 * `import type` from `@jamrog/engine` in G37.
 */
export type DoorState = "open" | "closed" | "locked" | "sealed" | "broken" | "airlock";

/** How much the drone knows about a room, worst to best. */
export type RoomState = "unknown" | "scanned" | "explored" | "visible" | "current";

/**
 * One thing standing or lying in a compartment, as the picture knows it.
 *
 * The same list `glyphs` is spelled out of — `things.map(t => t.glyph).join(" ")`
 * is `glyphs`, and `tests/tiles-view.test.ts` holds the two to that — so a
 * drawing that can put a picture where a letter went reads this and a drawing
 * that cannot reads the string. Nothing here decides how either is drawn.
 */
export interface SchematicThing {
  glyph: string;
  name: string;
  /** A machine, painted in the colour of trouble. Absent means it is not one. */
  hostile?: true;
  /**
   * One of the three systems a derelict is neutralised by
   * (`content/objectives.ts`), and whether it is up yet: `"down"` while there
   * is work to do in there, `"up"` once it has been raised.
   *
   * Carried rather than read off the glyph, which is a content table's
   * business and not a drawing's. What the drawings do with it is give it a
   * colour of its own — the hull's whole job found at a glance, instead of
   * three marks in the same ink as the crates and the bodies («выделяй значки
   * с целями отдельным цветом, например зелёным» — the owner). Absent on
   * everything else, and on a hand-written fixture.
   */
  goal?: "up" | "down";
}

export interface SchematicRoom {
  id: number;
  /** The short id the panel and the log use: "r4". */
  label: string;
  name: string;
  col: number;
  row: number;
  state: RoomState;
  /**
   * The compartment the highlighted line of the move list points at. Drawn in
   * the accent colour on both screens, so `m` answers "which box is that" on
   * the map rather than only in the list.
   */
  target?: true;
  /**
   * The one compartment the map is *aiming* at — the pointer's, or the
   * highlighted row's (`ui/appstate.ts`, `aimedAt`) — and the one the honeycomb
   * draws its readout beside.
   *
   * Not `target`, which two things set: the aim, and every compartment this
   * turn's red line named (`signsNamed`). A readout per named hazard would be
   * three answers to a question nobody asked, so the aim carries a mark of its
   * own and there is never more than one of it on a drawing.
   */
  aimed?: true;
  /**
   * A machine in here hit the drone on the turn just gone, out of a compartment
   * the drone cannot see into (`strikersNear`, ui/panel.ts). Painted in the
   * colour of trouble whatever else the box is, and it is the only thing the
   * box gives away: no name, no contents, no count. Being shot says which
   * direction, and that is all it says.
   */
  threat?: true;
  /** What is in there, already spaced by the caller: `S x % †`. */
  glyphs: string;
  /**
   * The same contents unjoined, for a drawing that can put a tile where the
   * letter went (`?tiles=1`, `ui/web/tiles.ts`). Optional because a hand-written
   * fixture says `glyphs` and nothing else, and because `glyphs` is what the
   * terminal draws — this field may never become the only statement of what is
   * in a compartment.
   */
  things?: readonly SchematicThing[];
  /**
   * What the compartment is for, as the catalogue's own word (`content/zones.ts`,
   * `kind`). Carried rather than derived from `name`, which is translated: the
   * pictogram beside the name has to pick the same drawing in three languages.
   */
  kind?: string;
  /**
   * Columns at the head of `glyphs` that are machines, painted in the colour of
   * trouble. Absent means none — which is what a hand-written fixture says, and
   * what a remembered compartment says (`ui/schematic-input.ts`, `hostileWidth`).
   */
  hostiles?: number;
  /**
   * A machine has just come into sight in here, and the box is flashing for it
   * on the beat (`ui/pulse.ts`). Absent means the ordinary colour of its state,
   * which is what a fixture says and what every frame between pulses says.
   *
   * A colour and nothing else: the box does not grow, move or gain a mark, so a
   * pulse cannot reflow the drawing under the reader's eye.
   */
  alarm?: boolean;
  /**
   * The hazard filling the compartment, once the drone knows of it: the id the
   * honeycomb tints the floor by, and the codex's own short name for it, written
   * over the compartment's name. Decided by the same test that puts the hazard's
   * glyph among `things` (`ui/schematic-input.ts`, `knownHazard`), so the tint
   * and the glyph cannot disagree. Absent in a hand-written fixture.
   */
  hazard?: { id: string; word: string };
  /**
   * Turns left on the charge the ship set in here (`systems/alert.ts`,
   * `fuseIn`): a red number on the box in every view. Absent when there is
   * none, which is what a fixture says.
   */
  charge?: number;
  /**
   * What walking here would cost, for the readout the honeycomb draws beside
   * this compartment (`ui/web/hex-svg.ts`). Three answers, and every word of
   * them one the game already had:
   *
   *   `2 doors`      a walk, and how long it is (`dist.doors`)
   *   `locked · d4`  a walk with a door in it that has to be dealt with first
   *   `no way`       nothing reaches it at all (`dist.none`)
   *
   * `blocked` is the second and third — the two the click will not simply spend
   * — so the plate can be red for them and amber for the one that is a move.
   *
   * The partner's popover offers `move here` / `no route`; ours says how far
   * instead, because that number is the one the numbered list is showing at the
   * same moment, and the two screens quoting one number is worth more than the
   * imperative. Which door is in the way is his, and it is the half of the
   * readout that tells a player what to do next.
   *
   * Only ever on the compartment `aimed` is on, and never on the one underfoot:
   * there is no walk to where you already are — that cell gets its readout
   * without a cost. Assembled here and not in the
   * drawing, so `hexSvgOf` stays a function of its input alone — a picture that
   * called `t()` itself would draw differently in three languages while the
   * golden file remembers one of them.
   */
  reach?: { line: string; blocked?: true };
}

export interface SchematicDoor {
  /**
   * The door's own id. Carried because the honeycomb layout answers in ids —
   * which doors it could draw as corridors and which it had to state as links
   * (`hexLayout`) — and a label is a string a fixture may repeat.
   */
  id: number;
  /** "d4" — the same string the action list shows. */
  label: string;
  a: number;
  b: number;
  state: DoorState;
  /** Which of the two ports on that side of room `a` this door uses. */
  portA: 0 | 1;
  portB: 0 | 1;
  /**
   * The door a red hazard line has just named (`ui/schematic-input.ts`,
   * `signsFresh`): drawn in the accent colour, as the compartment the move
   * list points at is, so the line and the map say the same thing at once.
   */
  target?: true;
  /** The trap on the door, once the drone knows of it: its hazard id (`mine`). */
  trap?: string;
  /**
   * A door on the way to the compartment the drone is aiming at — the
   * highlighted line of the list, or the box under the pointer — in the order
   * a walk would take it (`ui/appstate.ts`, `mapAim`). The honeycomb draws it
   * as an amber line; the terminal leaves it to the target's own outline.
   */
  route?: true;
}

/** The colour a door's label is written in: its state's, or the accent when a line has just named it. */
function doorFg(door: SchematicDoor): string {
  return door.target === true ? THEME.accent : THEME.door[door.state];
}

export interface SchematicInput {
  rooms: SchematicRoom[];
  doors: SchematicDoor[];
  /** The room the tug is docked to, and the name of the airlock joining them. */
  tug?: { at: number; label?: string };
  /** "KESTREL · freighter · 12 rooms · 5 seen". */
  shipLine: string;
}

/** Half-open run of one colour. Uncovered text is structural: `THEME.fgDim`. */
export interface SchematicSpan {
  from: number;
  to: number;
  fg: string;
}

export interface SchematicLine {
  text: string;
  spans?: SchematicSpan[];
}

export interface SchematicViewport {
  /** Leftmost drawn column. Default: scrolled to keep the current room in. */
  col?: number;
  cols?: number;
  rows?: number;
}

export interface Schematic {
  lines: SchematicLine[];
  /**
   * Labels of doors the picture says nothing about — neither a wire nor a
   * reference beside a box. The panel still lists them.
   */
  omitted: string[];
  /** Labels of doors shown only as a reference: drawn, but not as a wire. */
  referenced: string[];
  /**
   * Compartments off each edge of the window, which the two counters name. A
   * box on the picture plus these two is always the whole ship: the counters
   * are what makes the drawing add up rather than merely look tidy.
   */
  behind: number;
  ahead: number;
}

// ---------------------------------------------------------------- geometry

const HEIGHT = 34;
/** The hull runs down the right edge; the schematic stops there. */
const HULL_X = 64;
const BOX_W = 9;
const BOX_H = 4;
const COL_STEP = 13;
const ROW_STEP = 5;
const ORIGIN_X = 9;
const ORIGIN_Y = 1;
/** Columns between two boxes: exactly one door label of a two-letter name. */
const GUTTER = COL_STEP - BOX_W;
/** Column of the gutter that carries a door's vertical run. */
const STEM = BOX_W + 1;
/** Column inside a box that a same-column door hangs from: its middle. */
const CHANNEL = 4;
const WINDOW_COLS = 4;
const WINDOW_ROWS = 6;
/** Text inside a box: seven columns between the two borders. */
const INNER = BOX_W - 2;
const SHIP_LINE_Y = HEIGHT - 1;
const COUNTER_Y = HEIGHT - 3;
const TUG_W = 5;
const TUG_H = 3;
/** The tug sits its own width plus a door label to the left of its room. */
const TUG_OFFSET = TUG_W + GUTTER;
const UNKNOWN = "····";

/** Which way the room at the far end of an unwired door lies. */
const ARROWS = { L: "←", R: "→", U: "↑", D: "↓" } as const;

const ROOM_FG: Record<RoomState, string> = {
  unknown: THEME.fgDim,
  scanned: THEME.zone,
  explored: THEME.fg,
  visible: THEME.bright,
  current: THEME.accent,
};

/** What a door's state looks like, straight from the design doc. */
const BRACKETS: Record<DoorState, readonly [string, string]> = {
  open: ["─", "─"],
  closed: ["(", ")"],
  locked: ["[", "]"],
  sealed: ["#", "#"],
  broken: ["·", "·"],
  airlock: ["(", ")"],
};

/** Frame glyphs per room state: solid, dashed for unknown, double for here. */
interface Frame {
  h: string;
  v: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
  teeTop: string;
  teeBottom: string;
  portL: string;
  portR: string;
}

const SOLID: Frame = {
  h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘",
  teeTop: "┴", teeBottom: "┬", portL: "┤", portR: "├",
};
/** Corners stay solid: a dashed corner reads as a smudge at this size. */
const DASHED: Frame = { ...SOLID, h: "╌", v: "┆" };
const DOUBLE: Frame = {
  h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝",
  teeTop: "╩", teeBottom: "╦", portL: "╣", portR: "╠",
};

// ------------------------------------------------------------------ public

export function schematicLines(input: SchematicInput, viewport?: SchematicViewport): SchematicLine[] {
  return schematic(input, viewport).lines;
}

/** The schematic and the doors it had to leave out, in one pass over the input. */
export function schematic(input: SchematicInput, viewport: SchematicViewport = {}): Schematic {
  const cols = Math.min(viewport.cols ?? WINDOW_COLS, WINDOW_COLS);
  const rows = Math.min(viewport.rows ?? WINDOW_ROWS, WINDOW_ROWS);
  const first = viewport.col ?? scroll(input.rooms, cols);
  const sheet = new Sheet();

  const placed = place(input.rooms, first, cols, rows);
  const boxes = new Map(placed.map((p) => [p.room.id, p]));
  const roomOf = new Map(input.rooms.map((r) => [r.id, r]));
  for (const p of placed) sheet.reserveRect(p.y, p.x, BOX_W, BOX_H);

  // The tug is drawn before any door, so the airlock owns its port outright:
  // the way home is the one edge the schematic must never drop. It only fits
  // beside the leftmost column — deeper in, the gutter is four columns wide.
  const ports = new Set<string>();
  const dock = input.tug ? boxes.get(input.tug.at) : undefined;
  const tug = dock && dock.x === ORIGIN_X ? dock : undefined;
  if (tug) {
    ports.add(slot(tug.room.id, "L", 0));
    sheet.reserveRect(tug.y, tug.x - TUG_OFFSET, TUG_OFFSET, TUG_H);
  }

  const omitted: string[] = [];
  const referenced: string[] = [];
  const marks = new Marks();
  const view = { first, last: first + cols - 1 };
  // Wires first, easiest first, and only then the references: a door that can
  // be a line has to get the cells before a door that can only be a name.
  const unwired: SchematicDoor[] = [];
  for (const door of ordered(input.doors, boxes)) {
    if (!route(sheet, marks, ports, boxes, roomOf, view, door)) unwired.push(door);
  }
  for (const door of unwired) {
    if (!boxes.has(door.a) && !boxes.has(door.b)) continue;
    if (refer(sheet, marks, ports, boxes, roomOf, door)) referenced.push(door.label);
    else omitted.push(door.label);
  }

  for (const p of placed) drawBox(sheet, p, ports, marks);
  if (tug) drawTug(sheet, tug, input.tug?.label ?? "a1");

  // Two counters, because one arrow cannot point both ways: the picture used to
  // say `» 5 rooms` while three of the five were behind the left edge, and the
  // only sign the window had scrolled at all was a `«` on a broken-off door.
  const drawn = new Set(placed.map((p) => p.room.id));
  const behind = input.rooms
    .filter((r) => r.col < view.first)
    .sort((a, b) => b.col - a.col || a.row - b.row);
  const ahead = input.rooms
    .filter((r) => !drawn.has(r.id) && r.col >= view.first)
    .sort((a, b) => a.col - b.col || a.row - b.row);
  // Split the row between them only when both have something to say; one side
  // alone gets the width of the schematic.
  const wide = HULL_X - 1;
  const half = Math.floor(wide / 2);
  const share = behind.length > 0 && ahead.length > 0;
  if (behind.length > 0) {
    sheet.write(COUNTER_Y, 0, tally("schematic.behind", behind, share ? half : wide));
  }
  if (ahead.length > 0) {
    const text = tally("schematic.hidden", ahead, share ? wide - half - 1 : wide);
    sheet.write(COUNTER_Y, HULL_X - text.length, text);
  }
  sheet.write(SHIP_LINE_Y, 1, clip(input.shipLine, HULL_X - 2), THEME.fg);
  for (let y = 0; y < HEIGHT; y++) sheet.put(y, HULL_X, "┃", THEME.hull);

  return { lines: sheet.lines(), omitted, referenced, behind: behind.length, ahead: ahead.length };
}

/**
 * What is off one edge of the window, named: `» REACTOR · ····`.
 *
 * `» 2 rooms` was all this used to say, and the owner's fourth playtest asked
 * the obvious question back — "не ясна карта, что за 2 отсека". A number says
 * the drawing is not the whole ship and stops there; a name says which way to
 * walk, and it is a name the player has already read on the panel or in the log.
 *
 * A compartment the drone has never been in has no name to give, so it shows
 * the same `····` its box would. When *none* of them has a name the list would
 * be nothing but those marks, and the count says the identical thing in a
 * quarter of the columns — so that case keeps the count. The nearest
 * compartment goes first, and whatever will not fit becomes `+N`.
 */
function tally(key: "schematic.hidden" | "schematic.behind", rooms: readonly SchematicRoom[], budget: number): string {
  const count = t(key, { n: rooms.length });
  // Named ones first, nearest first among them, and the nameless behind: when
  // the row runs out it is a `····` that goes, never the one word here that
  // tells the player anything.
  const names = rooms
    .map((r) => (r.state === "unknown" || r.name.length === 0 ? UNKNOWN : r.name))
    .sort((a, b) => (a === UNKNOWN ? 1 : 0) - (b === UNKNOWN ? 1 : 0));
  if (names[0] === UNKNOWN) return count;

  const arrow = key === "schematic.behind" ? "«" : "»";
  for (let shown = names.length; shown > 0; shown--) {
    const rest = names.length - shown;
    const parts = [...names.slice(0, shown), ...(rest > 0 ? [`+${rest}`] : [])];
    const text = `${arrow} ${parts.join(" · ")}`;
    if (text.length <= budget) return text;
  }
  return count;
}

/**
 * Doors in the order they get a chance at the gutter: a run that stays on one
 * row before a run that has to climb, and a short climb before a long one.
 *
 * The gutter is four columns wide and a door label fills all four, so a wire
 * that crosses another compartment's port row is refused outright. Letting the
 * cheap runs claim their cells first costs the expensive ones nothing they had
 * — they were going to be refused by the labels either way — and saves the ones
 * that only wanted a row somebody else's detour had already taken.
 */
function ordered(
  doors: readonly SchematicDoor[],
  boxes: ReadonlyMap<number, Placed>,
): SchematicDoor[] {
  const cost = (d: SchematicDoor): number => {
    const a = boxes.get(d.a);
    const b = boxes.get(d.b);
    if (!a || !b || a.room.col === b.room.col) return 0;
    const left = a.room.col < b.room.col ? a : b;
    const right = left === a ? b : a;
    return Math.abs(
      right.y + 1 + (right === a ? d.portA : d.portB) - (left.y + 1 + (left === a ? d.portA : d.portB)),
    );
  };
  return [...doors].sort((a, b) => cost(a) - cost(b));
}

// ----------------------------------------------------------------- window

/**
 * Which column the window starts at: the block of four the drone is standing
 * in, pulled back so the window never hangs past the deepest compartment.
 *
 * Blocks rather than "one column of context behind the drone", which is what
 * this used to be. That version moved the window every single time the drone
 * changed depth, so half the boxes slid thirteen columns sideways on a step
 * that had discovered nothing — "твой граф не связан и меняется" — and a
 * picture that reshuffles itself is not a map. On a hull six columns deep this
 * scrolls once, at the fourth door, instead of on every one of them.
 */
function scroll(rooms: readonly SchematicRoom[], cols: number): number {
  const here = rooms.find((r) => r.state === "current");
  if (!here) return 0;
  const deepest = rooms.reduce((m, r) => Math.max(m, r.col), 0);
  return Math.max(0, Math.min(Math.floor(here.col / cols) * cols, deepest - cols + 1));
}

interface Placed {
  room: SchematicRoom;
  x: number;
  y: number;
}

function here(room: SchematicRoom): number {
  return room.state === "current" ? 1 : 0;
}

/**
 * Rooms inside the window, first one per cell: two rooms never share a box.
 * The room the drone stands in goes first whatever the input order, because a
 * schematic without the current room on it is not a schematic.
 */
function place(rooms: readonly SchematicRoom[], first: number, cols: number, rows: number): Placed[] {
  const byCell = [...rooms].sort((a, b) => here(b) - here(a));
  const taken = new Set<string>();
  const out: Placed[] = [];
  for (const room of byCell) {
    const col = room.col - first;
    if (col < 0 || col >= cols || room.row < 0 || room.row >= rows) continue;
    const cell = `${room.row}:${col}`;
    if (taken.has(cell)) continue;
    taken.add(cell);
    out.push({ room, x: ORIGIN_X + COL_STEP * col, y: ORIGIN_Y + ROW_STEP * room.row });
  }
  return out;
}

// ------------------------------------------------------------------ doors

/** Where a door meets a box: which side, and which of that side's two rows. */
function slot(room: number, side: "L" | "R", port: 0 | 1): string {
  return `${room}${side}${port}`;
}

/**
 * Tees a box has to draw once every same-column door has been routed, by the
 * column each one hangs from: a wire down the middle of the box and a reference
 * written off to one side both need the border broken where they meet it.
 */
class Marks {
  private readonly tees = new Map<string, Set<number>>();

  tee(room: number, edge: "top" | "bottom", dx: number): void {
    if (dx < 1 || dx > BOX_W - 2) return;
    const key = `${room}${edge}`;
    const at = this.tees.get(key);
    if (at) at.add(dx);
    else this.tees.set(key, new Set([dx]));
  }

  teesOf(room: number, edge: "top" | "bottom"): Iterable<number> {
    return this.tees.get(`${room}${edge}`) ?? [];
  }
}

/** A place a reference may go, and the port key it claims when it is on a side. */
interface Spot {
  y: number;
  x: number;
  claim?: string;
  /** Whether the box has to break its border where this one meets it. */
  tee?: "top" | "bottom";
}

/** The columns the window shows, inclusive. */
interface ColumnRange {
  first: number;
  last: number;
}

/**
 * One door onto the sheet, or `false` when it cannot be drawn: the label goes
 * beside the shallower room, the wire runs down the gutter, and both ends have
 * to be free. A refusal costs nothing — the door is still in the action list.
 */
function route(
  sheet: Sheet,
  marks: Marks,
  ports: Set<string>,
  boxes: ReadonlyMap<number, Placed>,
  roomOf: ReadonlyMap<number, SchematicRoom>,
  view: ColumnRange,
  door: SchematicDoor,
): boolean {
  if (door.a === door.b) return false;
  const a = boxes.get(door.a);
  const b = boxes.get(door.b);
  if (!a && !b) return false;
  if (!a || !b) {
    const here = a ?? b!;
    const away = roomOf.get(a ? door.b : door.a)?.col;
    if (away === undefined || (away >= view.first && away <= view.last)) return false;
    return breakOff(sheet, ports, here, door, a ? door.portA : door.portB, away);
  }
  if (a.room.col === b.room.col) return loop(sheet, marks, boxes, a, b, door);
  if (Math.abs(a.room.col - b.room.col) > 1) return false;

  const left = a.room.col < b.room.col ? a : b;
  const right = left === a ? b : a;
  const leftPort = left === a ? door.portA : door.portB;
  const rightPort = right === a ? door.portA : door.portB;
  if (ports.has(slot(left.room.id, "R", leftPort))) return false;
  if (ports.has(slot(right.room.id, "L", rightPort))) return false;

  const gx = left.x + BOX_W;
  const from = left.y + 1 + leftPort;
  const to = right.y + 1 + rightPort;
  const label = doorLabel(door, GUTTER);
  const step = to > from ? 1 : -1;

  const row: Array<[number, number]> = [];
  for (let i = 0; i < GUTTER; i++) row.push([from, gx + i]);

  const draw = (): void => {
    sheet.write(from, gx, label, doorFg(door));
    ports.add(slot(left.room.id, "R", leftPort));
    ports.add(slot(right.room.id, "L", rightPort));
  };

  if (to === from) {
    if (!sheet.free(row)) return false;
    sheet.reserve(row);
    draw();
    return true;
  }

  // Any of the gutter's lanes will do for the climb; the first is the one the
  // design doc draws, and the others are what a second wire in the same gutter
  // takes rather than being dropped.
  for (let lane = STEM; lane < BOX_W + GUTTER; lane++) {
    const stem = left.x + lane;
    const cells = [...row];
    for (let y = from + step; y !== to + step; y += step) cells.push([y, stem]);
    for (let x = stem + 1; x < gx + GUTTER; x++) cells.push([to, x]);
    if (!sheet.free(cells)) continue;

    sheet.reserve(cells);
    draw();
    for (let y = from + step; y !== to; y += step) sheet.put(y, stem, "│");
    sheet.put(to, stem, to > from ? "└" : "┌");
    for (let x = stem + 1; x < gx + GUTTER; x++) sheet.put(to, x, "─");
    return true;
  }
  return false;
}

/**
 * A door between two rooms of the same column: a wire down the middle of both
 * boxes with the label across it. Refused when another box stands between the
 * two, because a wire through a room would claim a passage that is not there.
 */
function loop(
  sheet: Sheet,
  marks: Marks,
  boxes: ReadonlyMap<number, Placed>,
  a: Placed,
  b: Placed,
  door: SchematicDoor,
): boolean {
  const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
  for (const p of boxes.values()) {
    if (p.x === upper.x && p.y > upper.y && p.y < lower.y) return false;
  }
  const x = upper.x + CHANNEL;
  const top = upper.y + BOX_H;
  const bottom = lower.y - 1;
  const label = doorLabel(door, GUTTER);
  const labelY = (upper.y + BOX_H - 1 + lower.y) >> 1;
  const labelX = x - (label.length >> 1);

  const cells: Array<[number, number]> = [];
  for (let y = top; y <= bottom; y++) cells.push([y, x]);
  for (let i = 0; i < label.length; i++) cells.push([labelY, labelX + i]);
  if (!sheet.free(cells)) return false;

  sheet.reserve(cells);
  for (let y = top; y <= bottom; y++) {
    if (y !== labelY) sheet.put(y, x, "│");
  }
  sheet.write(labelY, labelX, label, doorFg(door));
  marks.tee(upper.room.id, "bottom", CHANNEL);
  marks.tee(lower.room.id, "top", CHANNEL);
  return true;
}

/**
 * A door to a room outside the window: no wire, just the label and the arrow
 * that says which way the rest of the ship went. The counter at the bottom
 * says how many rooms are out there.
 */
function breakOff(
  sheet: Sheet,
  ports: Set<string>,
  here: Placed,
  door: SchematicDoor,
  port: 0 | 1,
  col: number,
): boolean {
  const y = here.y + 1 + port;
  const right = col > here.room.col;
  const side = right ? "R" : "L";
  if (ports.has(slot(here.room.id, side, port))) return false;

  const room = right ? HULL_X - (here.x + BOX_W) - 1 : here.x - 1;
  const label = doorLabel(door, room);
  if (label.length === 0) return false;
  const x = right ? here.x + BOX_W : here.x - label.length;
  const arrow = right ? x + label.length : x - 1;

  const cells: Array<[number, number]> = [[y, arrow]];
  for (let i = 0; i < label.length; i++) cells.push([y, x + i]);
  if (!sheet.free(cells)) return false;

  sheet.reserve(cells);
  sheet.write(y, x, label, doorFg(door));
  sheet.put(y, arrow, right ? "»" : "«", doorFg(door));
  ports.add(slot(here.room.id, side, port));
  return true;
}

/**
 * A door no wire could carry, written against both of its boxes: `→r11` on the
 * side the other compartment lies, in the colour of the door's own state.
 *
 * This is the whole answer to "твой граф не связан": the reference sits exactly
 * where the wire would have met the box, so a compartment with four doors and
 * one drawable wire still shows four ways out, and the room each of them leads
 * to is named rather than left to be guessed from a picture that has no line on
 * it. Two references naming each other are the same edge seen from both ends —
 * an off-page connector, which is how a schematic has always carried a wire it
 * had no room to draw.
 *
 * The room label rather than the door's: the label is what the *picture* is
 * indexed by (`r11` is written in the box it belongs to), and the panel says
 * which door leads there in words the same turn (`ui/panel.ts`, `doorLine`).
 * Four columns of gutter hold one of the two, and the one that can be looked up
 * on the drawing itself is the one worth spending them on.
 */
function refer(
  sheet: Sheet,
  marks: Marks,
  ports: Set<string>,
  boxes: ReadonlyMap<number, Placed>,
  roomOf: ReadonlyMap<number, SchematicRoom>,
  door: SchematicDoor,
): boolean {
  if (door.a === door.b) return false;
  let drawn = false;
  for (const [mine, theirs, port] of [
    [door.a, door.b, door.portA],
    [door.b, door.a, door.portB],
  ] as const) {
    const box = boxes.get(mine);
    const far = roomOf.get(theirs);
    if (!box || !far) continue;
    const side =
      far.col > box.room.col ? "R"
      : far.col < box.room.col ? "L"
      : far.row > box.room.row ? "D"
      : far.row < box.room.row ? "U"
      : undefined;
    if (side === undefined) continue;
    if (mark(sheet, marks, ports, box, side, port, far.label, doorFg(door))) drawn = true;
  }
  return drawn;
}

/**
 * One reference beside one box, on the first free spot of its side.
 *
 * A reference asks for less than a wire did and takes what it can get: on a
 * side, either of the two port rows; above or below, anywhere across the width
 * of the box. Which port row a door was assigned is a drawing convenience, not
 * a fact about the ship, so borrowing the other one when a wire has already
 * taken the first costs the picture nothing and is the difference between a
 * compartment that admits a door and one that hides it.
 */
function mark(
  sheet: Sheet,
  marks: Marks,
  ports: Set<string>,
  box: Placed,
  side: "L" | "R" | "U" | "D",
  port: 0 | 1,
  target: string,
  fg: string,
): boolean {
  const arrow = ARROWS[side];
  const sideways = side === "L" || side === "R";
  const width = sideways ? GUTTER : BOX_W - CHANNEL;
  const name = clip(target, Math.max(0, width - 1));
  if (name.length === 0) return false;
  // The arrow always touches the box and points out of it, so a reference reads
  // the same way a wire leaving that side would.
  const text = side === "L" ? name + arrow : arrow + name;
  const spots =
    side === "L" || side === "R" ?
      // A gutter with two wires in it has no room for a third thing, so a
      // sideways reference that cannot have its own port row is written above
      // or below the box instead, with the border broken over it so it belongs
      // to a box rather than floating between two. The arrow still points the
      // way the room lies; only the line it is written on gives.
      [...sideSpots(box, side, port, text), ...edgeSpots(box, "D", text), ...edgeSpots(box, "U", text)]
    : edgeSpots(box, side, text);

  for (const spot of spots) {
    // Never row zero. Boxes start on row one and the row above the top of them
    // is the banner's — `ORIGIN_Y` is what says so, and the banner is written
    // over the drawing rather than into it (`ui/render.ts`). A reference there
    // and the banner would overwrite each other; before the hulls grew loops
    // there were rarely enough of them for the top row to run out of side
    // spots, and never in two hundred seeds (docs/owner-queue.md, 3).
    if (spot.y < ORIGIN_Y) continue;
    if (spot.claim !== undefined && ports.has(spot.claim)) continue;
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < text.length; i++) cells.push([spot.y, spot.x + i]);
    if (!sheet.free(cells)) continue;

    sheet.reserve(cells);
    sheet.write(spot.y, spot.x, text, fg);
    if (spot.claim !== undefined) ports.add(spot.claim);
    if (spot.tee !== undefined) marks.tee(box.room.id, spot.tee, spot.x - box.x);
    return true;
  }
  return false;
}

/** Where a reference on a box's left or right may sit: its own port row, then the other. */
function sideSpots(box: Placed, side: "L" | "R", port: 0 | 1, text: string): Spot[] {
  const x = side === "L" ? box.x - text.length : box.x + BOX_W;
  return [port, (1 - port) as 0 | 1].map((p) => ({
    y: box.y + 1 + p,
    x,
    claim: slot(box.room.id, side, p),
  }));
}

/**
 * Where a reference above or below a box may sit: the middle of the box first,
 * where a wire in that direction would have hung, then anywhere across its
 * width that the loop wires and their labels have not taken.
 */
function edgeSpots(box: Placed, side: "U" | "D", text: string): Spot[] {
  const y = side === "U" ? box.y - 1 : box.y + BOX_H;
  const offsets = [CHANNEL, ...Array.from({ length: BOX_W - text.length + 1 }, (_, i) => i)];
  return offsets
    .filter((dx, i) => dx + text.length <= BOX_W && offsets.indexOf(dx) === i)
    .map((dx) => ({ y, x: box.x + dx, tee: side === "U" ? ("top" as const) : ("bottom" as const) }));
}

/**
 * The door's own label between the two state brackets, cut down to the room it
 * has. Brackets go before the name does: a label that says `d10` in a gutter
 * four columns wide is still true, one that says `d1` is not.
 */
function doorLabel(door: SchematicDoor, width: number): string {
  const [open, close] = BRACKETS[door.state];
  if (door.label.length + 2 <= width) return open + door.label + close;
  if (door.label.length + 1 <= width) return open + door.label;
  return door.label.slice(0, Math.max(0, width));
}

// ----------------------------------------------------------------- drawing

function drawBox(sheet: Sheet, p: Placed, ports: ReadonlySet<string>, marks: Marks): void {
  const { room, x, y } = p;
  const f = room.state === "current" ? DOUBLE : room.state === "unknown" ? DASHED : SOLID;
  // The frame glyphs stay whatever the room's state chose; only the colour
  // moves, so a pulse changes no character on the screen (`ui/pulse.ts`).
  const fg = room.alarm === true || room.threat === true
    ? THEME.bad
    : room.target === true
      ? THEME.accent
      : ROOM_FG[room.state];
  const bar = f.h.repeat(INNER);
  sheet.write(y, x, f.tl + bar + f.tr, fg);
  sheet.write(y + BOX_H - 1, x, f.bl + bar + f.br, fg);
  for (const dx of marks.teesOf(room.id, "top")) sheet.put(y, x + dx, f.teeTop, fg);
  for (const dx of marks.teesOf(room.id, "bottom")) sheet.put(y + BOX_H - 1, x + dx, f.teeBottom, fg);

  const unknown = room.state === "unknown";
  const name = unknown ? centre(UNKNOWN, INNER) : clip(room.name, INNER).padEnd(INNER, " ");
  // The adapter hands an unknown box no glyphs but a known hazard's mark
  // (`ui/schematic-input.ts`, `marksOnly`), so what it hands is what is drawn.
  const rows = [name, fill(room.glyphs, room.label, INNER)];
  for (const [i, text] of rows.entries()) {
    const port = i as 0 | 1;
    sheet.write(y + 1 + port, x, f.v + text + f.v, fg);
    if (ports.has(slot(room.id, "L", port))) sheet.put(y + 1 + port, x, f.portL, fg);
    if (ports.has(slot(room.id, "R", port))) sheet.put(y + 1 + port, x + BOX_W - 1, f.portR, fg);
  }

  // The machines at the head of the glyph row, repainted in the colour of
  // trouble. The owner's second playtest could not tell a compartment with an
  // ENFORCER in it from one holding a crate — every glyph in every box was the
  // one colour of the room's own state (docs/tasks/G40-tug-clarity.md, 7).
  const hostiles = unknown ? 0 : Math.min(room.hostiles ?? 0, INNER);
  if (hostiles > 0) sheet.write(y + 2, x + 1, rows[1]!.slice(0, hostiles), THEME.bad);

  // The fuse: the turns left, red, on the right end of the top bar — the one
  // row with no word on it, so the name stays whole and the number reads as
  // the cap on the hexagon does.
  if (room.charge !== undefined && !unknown) {
    const left = String(room.charge);
    sheet.write(y, x + BOX_W - 2 - left.length, `[${left}]`, THEME.bad);
  }
}

/**
 * The drone's own ship: a 5x3 box hanging off the airlock, always to the left.
 *
 * A mark rather than a word, and the reason is the box: three columns inside
 * it. `TUG` fitted and was therefore Latin in the Russian and the Spanish run
 * both — the most-drawn word in the game (docs/tasks/G55, 14) — and nothing
 * true fits in three Cyrillic letters (`БУК` the owner read and rejected). So
 * the tug joins the vocabulary the schematic already has, `d3` and `r5` and
 * `(a1)`: marks, in one alphabet, the same in every language. `⌂` is the
 * roguelike's own glyph for the place you go back to, the help card names it
 * (`help.where.ship.3`), and the caption under the picture says `твой буксир`
 * in words whenever the drone is standing on it.
 */
export const TUG_GLYPH = "⌂";

function drawTug(sheet: Sheet, dock: Placed, label: string): void {
  const x = dock.x - TUG_OFFSET;
  sheet.write(dock.y, x, "╭───╮", THEME.fg);
  sheet.write(dock.y + 1, x, `│ ${TUG_GLYPH} ├`, THEME.fg);
  sheet.write(dock.y + 2, x, "╰───╯", THEME.fg);
  sheet.write(dock.y + 1, x + TUG_W, `(${clip(label, GUTTER - 2)})`, THEME.airlock);
}

/**
 * Glyphs left, room label right, in the seven columns a box has. A room packed
 * with things loses its label rather than its contents: the label is repeated
 * in the panel, the contents are not.
 */
function fill(glyphs: string, label: string, width: number): string {
  const left = clip(glyphs, width);
  const rest = width - left.length - label.length;
  return rest >= 1 ? left + " ".repeat(rest) + label : left.padEnd(width, " ");
}

function centre(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  return " ".repeat(pad >> 1) + text + " ".repeat(pad - (pad >> 1));
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(0, width));
}

// ------------------------------------------------------------------- sheet

/**
 * The canvas, the colour under every cell, and the cells the doors have
 * claimed. Reservations are what keep two wires out of one column: a route
 * asks whether all its cells are free before it draws any of them, so a door
 * is either drawn whole or not at all.
 */
class Sheet {
  private readonly chars: string[][];
  private readonly fgs: Array<Array<string | undefined>>;
  private readonly taken = new Set<number>();

  constructor() {
    this.chars = Array.from({ length: HEIGHT }, () => new Array<string>(HULL_X + 1).fill(" "));
    this.fgs = Array.from({ length: HEIGHT }, () => new Array<string | undefined>(HULL_X + 1).fill(undefined));
  }

  put(y: number, x: number, ch: string, fg?: string): void {
    const row = this.chars[y];
    if (!row || x < 0 || x > HULL_X) return;
    row[x] = ch;
    this.fgs[y]![x] = fg;
  }

  write(y: number, x: number, text: string, fg?: string): void {
    for (let i = 0; i < text.length; i++) this.put(y, x + i, text[i]!, fg);
  }

  free(cells: ReadonlyArray<readonly [number, number]>): boolean {
    return cells.every(([y, x]) => y >= 0 && y < HEIGHT && x >= 0 && x < HULL_X && !this.taken.has(key(y, x)));
  }

  reserve(cells: ReadonlyArray<readonly [number, number]>): void {
    for (const [y, x] of cells) this.taken.add(key(y, x));
  }

  reserveRect(y: number, x: number, w: number, h: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.taken.add(key(y + dy, x + dx));
    }
  }

  lines(): SchematicLine[] {
    return this.chars.map((row, y) => {
      const fgs = this.fgs[y]!;
      const spans: SchematicSpan[] = [];
      for (let x = 0; x <= HULL_X; x++) {
        const fg = fgs[x];
        if (fg === undefined) continue;
        const last = spans[spans.length - 1];
        if (last && last.to === x && last.fg === fg) last.to = x + 1;
        else spans.push({ from: x, to: x + 1, fg });
      }
      const text = row.join("");
      return spans.length > 0 ? { text, spans } : { text };
    });
  }
}

function key(y: number, x: number): number {
  return y * (HULL_X + 1) + x;
}
