import { isAlive, portsOf, type Entity, type Room, type RoomGame, type RoomId, type Ship } from "@jamrog/engine";
import { derelictNameOf } from "../content/derelicts.js";
import { tugCallsign } from "../content/hints.js";
import { moduleKind, moduleName } from "../content/modules.js";
import { machineName } from "../content/monsters.js";
import { roomName } from "../content/zones.js";
import { t } from "../i18n.js";
import { codexFor } from "../content/codex.js";
import { hazardKind, type HazardKind } from "../content/hazards.js";
import { isTug } from "../content/tug.js";
import { BLOWN, alertState, fuseIn, isBlown } from "../systems/alert.js";
import { doorHazard, hazardKnown, hazardsOf, roomHazard, signsFresh, type HazardRecord } from "../systems/hazardstate.js";
import { hostilesIn, wrecksOn } from "../twist/rig.js";
import { strikersNear } from "./strikers.js";

/**
 * What is in a compartment, in words.
 *
 * The knowledge rules and nothing else: what a compartment holds, what it is
 * called, which of its contents the drone may be told about. Every view this
 * game has had asks these questions and none is allowed a second opinion — a
 * crate drawn one way here and another there is two games, by the layer rule
 * in `.claude/CLAUDE.md`.
 *
 * It was `ui/schematic-input.ts` until the schematic went, and these answers
 * came across whole rather than the React branch's older copy being kept: they
 * had moved on while that branch was away. A compartment is `BLOWN` rather
 * than vented, a hazard the drone has been told about shows among the things,
 * and a wreck says its integrity. What did not come across is
 * `schematicInputOf` and the banner — the picture's own model, with nothing
 * left to draw.
 */

/**
 * How much the drone knows about a compartment.
 *
 * Five, and the board collapses them to four — it draws what is in a
 * compartment the same whether the drone is looking at it or remembers being
 * in it, and says where it does that (`react/model.ts`).
 */
export type RoomState = "unknown" | "scanned" | "explored" | "visible" | "current";

/**
 * One thing standing or lying in a compartment.
 *
 * Declared here rather than imported, because it used to live beside the
 * picture that drew it and the picture is gone. Nothing in it is about
 * drawing: a glyph is which thing this is, and what any view makes of that is
 * the view's business.
 */
export interface RoomThing {
  glyph: string;
  name: string;
  /** A machine. Absent means it is not one. */
  hostile?: true;
  /** One of the three systems, and whether it is up yet. */
  system?: "up" | "down";
  /** Part of what the run came for, so a view can pick it out of the rest. */
  goal?: string;
}

/**
 * Keys a compartment's own content lives under. `wrecks` is the twist's and has
 * a type; the rest belong to the derelict catalogue and are read defensively —
 * this file must not crash a run because a card left something it did not
 * expect, and a save file round-trips through JSON with no types at all.
 */
export const CONTENT_KEYS = ["bodies", "crates", "systems", "items"] as const;

/**
 * The mark a thing wears when its own record carries none.
 *
 * Bodies, crates and errand items are stored as plain records — `{id, searched}`,
 * `{id, kind}` — because nothing in the rules cares what they look like. The map
 * did care, and asked `glyph` of them: absent, so `asThing` dropped them and
 * they were invisible while the action list offered `search the body` twice over
 * (the owner, 10.09: «нет значков на обыск тел, пусть у всего есть значки»).
 *
 * So the bucket a thing came out of names its mark, and the record's own `glyph`
 * still wins where it has one. Every bucket is covered, and a bucket added
 * later without a mark fails the "everything on the deck has one" test rather
 * than quietly vanishing off the map.
 */
export const BUCKET_GLYPH: Readonly<Record<(typeof CONTENT_KEYS)[number], string>> = {
  bodies: "†",
  crates: "X",
  systems: "+",
  items: "*",
};

/** What each bucket's thing is called, when its record does not say. */
export function bucketName(key: (typeof CONTENT_KEYS)[number], raw: unknown): string {
  const rec = raw as { kind?: unknown; searched?: unknown } | null;
  const kind = typeof rec?.kind === "string" ? rec.kind : undefined;
  if (key === "bodies") return t(rec?.searched === true ? "thing.body.searched" : "thing.body");
  if (key === "crates") return t(kind === "contraband" ? "thing.contraband" : "thing.cargo");
  if (key === "items") return t(kind === "console" ? "thing.console" : "thing.package");
  return t("thing.system");
}

/**
 * The two door states a walk cannot simply spend a turn on.
 *
 * `Ship.passable` lets the drone through `open`, `closed` and `broken` — a
 * closed door is opened by walking into it — and asks for a cutter at a
 * `locked` or a `sealed` one. Those two are what the readout names, because
 * they are the two the player has to do something about before the walk the
 * map is drawing is a walk at all. The airlock is not among them: it is the
 * way out, and the drone is the one thing that may use it.
 */
const SHUT = { locked: "state.locked", sealed: "state.sealed" } as const;

/**
 * Compartments flashing on this frame, when nothing is: the ordinary case, and
 * a shared empty set rather than a fresh one per frame.
 */
const NO_ALARM: ReadonlySet<RoomId> = new Set();
const NO_DOORS: ReadonlySet<number> = new Set();

/**
 * The compartments and doors this turn's red lines name, read the way the
 * line was worded (`systems/hazards.ts`, `hazardLine`): a compartment hazard
 * is the compartment and the door from here into it, a door trap is the door.
 */
function signsNamed(game: RoomGame, here: RoomId | undefined): { rooms: Set<RoomId>; doors: Set<number> } {
  const rooms = new Set<RoomId>();
  const doors = new Set<number>();
  if (here === undefined) return { rooms, doors };
  const ship = game.ship;
  for (const rec of signsFresh(game)) {
    if (rec.door !== undefined) {
      doors.add(rec.door);
      continue;
    }
    if (rec.room === undefined || rec.room === here) continue;
    rooms.add(rec.room);
    const door = ship
      .doorsOf(here)
      .filter((d) => ship.other(d, here) === rec.room)
      .sort((a, b) => a.id - b.id)[0];
    if (door) doors.add(door.id);
  }
  return { rooms, doors };
}

/**
 * `BRIGHT ANCHOR · your tug · docked to freighter`.
 *
 * Four rooms and no name is what the caption used to say — `DERELICT · 4 rooms
 * · 4 seen` — while the player stood in the DOCK asking where the tug was. The
 * picture was right and the words under it named somebody else's ship.
 */
function tugLine(game: RoomGame): string {
  const parts = [tugCallsign(game.seed), t("ship.yourTug")];
  const docked = derelictNameOf(tagOf(game.currentShip.data, "docked"));
  if (docked) parts.push(t("ship.dockedTo", { hull: docked }));
  return parts.join(" · ");
}

/** Everything lying in a compartment, in the order the panel lists it. */
export function thingsIn(game: RoomGame, room: RoomId): RoomThing[] {
  return thingsOn(game.ship, room, game.currentShip.data);
}

/**
 * A compartment a charge has blown open (`systems/alert.ts`, the scuttle).
 * Drawn among the compartment's things rather than as a state of the box,
 * because this one list is what every view and the panel's own block read:
 * one glyph here is the `~` in the ASCII box, in the SVG box and in the
 * hexagon, and the line `~ blown open` under the compartment's name — the
 * rule that a property of a compartment either shows everywhere or does not
 * exist (docs/tasks/G43-fire.md). The glyph and its tile are the ones the
 * vented compartment had before G90: what the mark says is "nothing here,
 * and no air", which is still true.
 */
export const VENTED_GLYPH = "~";

/**
 * The same, on a hull the drone is not aboard: content belongs to the ship,
 * and what the drone *knows* of its hazards to the ship's pocket in the store
 * (`systems/hazardstate.ts`), which is the `data` here.
 */
function thingsOn(ship: Ship, room: RoomId, pocket: Record<string, unknown>): RoomThing[] {
  const out: RoomThing[] = [];
  if (ship.roomAt(room).hazard === BLOWN) out.push({ glyph: VENTED_GLYPH, name: t("word.blown") });
  out.push(...hazardThings(ship, room, hazardsOf(pocket)));
  out.push(...wrecksOn(ship, room).map((w): RoomThing => {
    const kind = moduleKind(w.kind);
    const what = w.glyph === "X" ? t("word.crate") : t("word.scrap");
    return {
      glyph: w.glyph,
      name: `${what} ${moduleName(kind.id)} ${w.integrity}/${kind.integrity}`,
    };
  }));

  const data = ship.roomAt(room).data;
  for (const key of CONTENT_KEYS) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const thing = asThing(raw, BUCKET_GLYPH[key], bucketName(key, raw), key === "systems");
      if (thing) out.push(thing);
    }
  }
  return out;
}

/**
 * The hazards a compartment shows: the one filling it, and a trap on any of
 * its doors, each only once the drone has been told or has scanned it. Drawn
 * among the compartment's things for the reason the vented mark is — one list
 * feeds the box in all three views and the line under the compartment's name
 * — and that is the whole of what "marked in every view" costs a new hazard:
 * a glyph and a word in its row of `content/hazards.ts`.
 */
function hazardThings(ship: Ship, room: RoomId, records: readonly HazardRecord[]): RoomThing[] {
  if (records.length === 0) return [];
  const out: RoomThing[] = [];
  const kind = knownHazard(ship, records, room);
  if (kind) out.push({ glyph: kind.glyph, name: t(kind.word) });
  for (const door of ship.doorsOf(room)) {
    const trap = knownTrap(ship, records, door.id);
    if (trap) out.push({ glyph: trap.glyph, name: t(trap.word, { door: door.label }) });
  }
  return out;
}

/** The hazard filling a compartment, when the ship still carries it and the drone knows. */
function knownHazard(ship: Ship, records: readonly HazardRecord[], room: RoomId): HazardKind | undefined {
  const rec = roomHazard(ship, records, room);
  const kind = rec === undefined ? undefined : hazardKind(rec.id);
  return rec && kind && hazardKnown(ship, rec) ? kind : undefined;
}

/** The trap on a door, on the same terms. */
function knownTrap(ship: Ship, records: readonly HazardRecord[], door: number): HazardKind | undefined {
  const rec = doorHazard(ship, records, door);
  const kind = rec === undefined ? undefined : hazardKind(rec.id);
  return rec && kind && hazardKnown(ship, rec) ? kind : undefined;
}

/**
 * Every hazard aboard the drone knows of, for the corner of the graphic view:
 * the glyph, the compartment it fills (a trap's word already names its door),
 * and the word the compartment block uses for it. Compartments first, then
 * doors, each in the ship's own order. Nothing at home: the tug has no hazards,
 * and it is not the hull the drone is about to walk into.
 */
export function hazardsAboard(game: RoomGame): KnownHazard[] {
  const records = hazardsOf(game.currentShip.data);
  if (records.length === 0 || isTug(game)) return [];
  const ship = game.ship;
  const out: KnownHazard[] = [];
  for (const room of ship.rooms) {
    const kind = knownHazard(ship, records, room.id);
    if (kind) out.push({ id: kind.id, glyph: kind.glyph, name: t(kind.word), where: room.label });
  }
  for (const door of ship.doors) {
    const kind = door.a === door.b ? undefined : knownTrap(ship, records, door.id);
    if (kind) out.push({ id: kind.id, glyph: kind.glyph, name: t(kind.word, { door: door.label }), where: "" });
  }
  return out;
}

/** One row of `hazardsAboard`: a thing with the hazard's id and where it is. */
export interface KnownHazard extends RoomThing {
  id: string;
  where: string;
}

/** Machines standing in a compartment right now, the drone excluded. */
export function machinesIn(game: RoomGame, room: RoomId): Entity[] {
  return game.entitiesIn(room).filter((e) => e.id !== game.player.id && isAlive(e));
}

// -------------------------------------------------------------------- pieces

/**
 * How much the drone knows about a compartment. Standing in it beats seeing it,
 * seeing it beats having stood in it once, and a sensor pulse is the least of
 * the four — the ship it drew may have moved since.
 */
export function stateOf(game: RoomGame, room: Room, here: RoomId | undefined): RoomState {
  if (room.id === here) return "current";
  if (game.visible.has(room.id)) return "visible";
  if (room.explored) return "explored";
  if (room.scanned) return "scanned";
  return "unknown";
}

/**
 * What the box shows. In sight: everything, machines first. Out of sight: what
 * was left lying there, because wreckage stays where it fell and machines do
 * not — except after a pulse, which is a snapshot and says so by being one.
 */
export function thingsOf(
  game: RoomGame,
  room: Room,
  state: RoomState,
  data: Record<string, unknown>,
): RoomThing[] {
  if (state === "unknown") return marksOf(game.ship, room, data);
  if (state !== "current" && state !== "visible") return remembered(game.ship, room, state, data);

  // The machines carry their own word, which is the one thing a picture of a
  // machine cannot: `machineName` is what the contact block calls it, so a tile
  // and the sidebar name the same thing. Hostile ones first, painted as such;
  // anything else alive in the compartment after them, in plain colour.
  const hostile = new Set(hostilesIn(game, room.id).map((m) => m.id));
  const machines = machinesIn(game, room.id)
    .sort((a, b) => Number(hostile.has(b.id)) - Number(hostile.has(a.id)))
    .map((m): RoomThing =>
      hostile.has(m.id)
        ? { glyph: m.ch, name: machineName(m.name), hostile: true }
        : { glyph: m.ch, name: machineName(m.name) },
    );
  return [...machines, ...homeThings(game.ship, room), ...thingsOn(game.ship, room.id, data)];
}

/**
 * A compartment nobody is looking at: what was left lying in it, because
 * wreckage stays where it fell and machines do not — except after a pulse,
 * which is a snapshot and says so by being one. The hazard marks ride along
 * with the snapshot: a pulse is exactly how a hazard gets known without a
 * sign, and the snapshot string knows nothing about them.
 */
function remembered(
  ship: Ship,
  room: Room,
  state: RoomState,
  data: Record<string, unknown>,
): RoomThing[] {
  const home = homeThings(ship, room);
  const snapshot = room.data.snapshot;
  if (state === "scanned" && typeof snapshot === "string") {
    const marks = hazardThings(ship, room.id, hazardsOf(data));
    // The pulse wrote down marks and not names, so a remembered mark is its own
    // word: whatever stood there has had a chance to walk off, and inventing a
    // name for it would be the drawing claiming to know more than the sensor did.
    const seen = snapshot
      .split(" ")
      .filter((g) => g.length > 0)
      .map((glyph): RoomThing => ({ glyph, name: glyph }));
    return [...home, ...marks, ...seen];
  }
  return [...home, ...thingsOn(ship, room.id, data)];
}

/**
 * A compartment the drone knows nothing about — except, sometimes, that there
 * is a hazard in it. The sign is given from next door before the drone has
 * ever looked in (`systems/hazards.ts`), and a smoke-filled compartment is
 * one it *cannot* look into; the mark still has to be on the box, or the red
 * line points at nothing on the map.
 */
function marksOf(ship: Ship, room: Room, data: Record<string, unknown>): RoomThing[] {
  return hazardThings(ship, room.id, hazardsOf(data));
}

/**
 * The airlock's own label, drawn in whichever compartment carries it.
 *
 * Two characters wide and never a picture: `a1` is a door's name, and the set
 * has no tile for it on purpose — a label that turned into a silhouette would
 * stop being the thing the player types.
 */
function homeThings(ship: Ship, room: Room): RoomThing[] {
  const airlock = ship.doorsOf(room.id).find((d) => d.state === "airlock");
  return airlock ? [{ glyph: airlock.label, name: airlock.label }] : [];
}

/**
 * A string the derelict catalogue left on the ship's store entry. Defensive:
 * the catalogue (G36) fills these in, and until it does the schematic says
 * `DERELICT` rather than throwing at whatever is there instead.
 */
export function tag(game: RoomGame, key: string): string | undefined {
  return tagOf(game.currentShip.data, key);
}

function tagOf(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A system that is already up. Named and exported with the bucket marks
 * because between them they are the whole of what a card can put on the map
 * without carrying a glyph of its own, and `tests/tiles-view.test.ts` holds
 * every one of them to having a drawing.
 */
export const ONLINE_GLYPH = "✓";

function asThing(
  raw: unknown,
  fallback: string,
  called: string,
  goal = false,
): RoomThing | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const thing = raw as { glyph?: unknown; name?: unknown; label?: unknown; online?: unknown };
  const own = typeof thing.glyph === "string" && thing.glyph.length > 0 ? thing.glyph[0]! : undefined;
  const mark = own ?? fallback;
  if (mark.length === 0) return undefined;
  // A system already up is drawn ticked rather than as the mark that means
  // "work to do here". Three `+` on a hull whose three systems are online is
  // the map telling a player to go and do what they have already done — the
  // owner, standing on a raised drive with `ALL THREE ONLINE` on the panel:
  // «почему тут +?». The tick is the panel's own mark for the same fact, and it
  // is a glyph rather than a word, so it needs no table.
  const glyph = thing.online === true ? ONLINE_GLYPH : mark;
  const name =
    typeof thing.name === "string" ? thing.name : typeof thing.label === "string" ? thing.label : called;
  // And a system carries the fact that it is one, for the drawings to paint it
  // in the colour of the job rather than in the colour of the scenery.
  if (!goal) return { glyph, name };
  return { glyph, name, goal: thing.online === true ? "up" : "down" };
}

