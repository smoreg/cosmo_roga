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
import type {
  RoomState,
  SchematicDoor,
  SchematicInput,
  SchematicRoom,
  SchematicThing,
} from "./schematic.js";

/**
 * Where the engine's `Ship` meets the picture of it.
 *
 * `ui/schematic.ts` takes text and gives back text, on purpose: the geometry is
 * testable against hand-written inputs that no generator has to produce first.
 * This file is the one adapter, and it is where every rule about *what the
 * player knows* lives — a room the drone has never entered shows what a sensor
 * pulse remembered, not what is standing in it now (design-doc.md, "Что видит
 * игрок").
 */

/** Room contents the panel and the schematic both draw. */
export interface RoomThing {
  glyph: string;
  name: string;
}

/**
 * Keys a compartment's own content lives under. `wrecks` is the twist's and has
 * a type; the rest belong to the derelict catalogue and are read defensively —
 * this file must not crash a run because a card left something it did not
 * expect, and a save file round-trips through JSON with no types at all.
 */
const CONTENT_KEYS = ["bodies", "crates", "systems", "items"] as const;

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
function bucketName(key: (typeof CONTENT_KEYS)[number], raw: unknown): string {
  const rec = raw as { kind?: unknown; searched?: unknown } | null;
  const kind = typeof rec?.kind === "string" ? rec.kind : undefined;
  if (key === "bodies") return t(rec?.searched === true ? "thing.body.searched" : "thing.body");
  if (key === "crates") return t(kind === "contraband" ? "thing.contraband" : "thing.cargo");
  if (key === "items") return t(kind === "console" ? "thing.console" : "thing.package");
  return t("thing.system");
}

/**
 * The picture on the screen: the hull under the drone's feet, or — standing at
 * the tug's airlock — the derelict the tug is tied to.
 *
 * The second case is the whole of the tug's planning (design-doc.md, "Буксир"):
 * before spending anything on a sortie the player reads the ship they are about
 * to walk into, as the last drone left it. Nothing of it is live — the machines
 * aboard are the store's, not the game's — so the drawing is memory, and every
 * compartment shows what was left lying in it rather than what stands there now.
 */
export function schematicInputOf(
  game: RoomGame,
  alarm: ReadonlySet<RoomId> = NO_ALARM,
  target?: RoomId,
  route: ReadonlySet<number> = NO_DOORS,
): SchematicInput {
  const docked = dockedHull(game);
  const input = docked ? remoteInput(docked.ship, docked.data) : aboardInput(game, alarm);
  if (target === undefined) return input;
  return {
    ...input,
    rooms: input.rooms.map((room) => (room.id === target ? { ...room, target: true as const } : room)),
    // Only aboard: the tug's picture of the hull ahead is memory, with nobody
    // on it to walk anywhere.
    doors: docked || route.size === 0
      ? input.doors
      : input.doors.map((door) => (route.has(door.id) ? { ...door, route: true as const } : door)),
  };
}

/**
 * Compartments flashing on this frame, when nothing is: the ordinary case, and
 * a shared empty set rather than a fresh one per frame.
 */
const NO_ALARM: ReadonlySet<RoomId> = new Set();
const NO_DOORS: ReadonlySet<number> = new Set();

/**
 * The hull as the drone sees it from inside: sight, memory and the machines.
 *
 * `alarm` is the one thing here that is not a fact about the ship — it is which
 * boxes the screen is flashing this instant, decided by `ui/pulse.ts` against
 * the music's clock and handed down because both views draw off this one value
 * (`ui/render.ts` and `ui/web/schematic-svg.ts`). The remote hull takes none:
 * nobody is aboard it, so nothing can appear in it.
 */
function aboardInput(game: RoomGame, alarm: ReadonlySet<RoomId>): SchematicInput {
  const here = game.player.room;
  // Compartments a shot came out of this turn. The panel names the machine and
  // the door; the map has to show the box, or a player who reads the picture
  // and not the sidebar is still being hit by nothing ("опять невидимый
  // каратель", with the contact block already saying `E enforcer 10/10 d21`).
  const struck = new Set(
    here === undefined ? [] : strikersNear(game, here).map((s) => s.room),
  );
  const data = game.currentShip.data;
  // What the red line has just named: the compartment and the door it points
  // at, lit as the move list's destination is, so a player reading «за d19 —
  // ЦЕХ, там дым» finds d19 and the box on the map without looking for them
  // (docs/tasks/G83-anonymous-blows.md, 7).
  const named = signsNamed(game, here);
  const records = hazardsOf(data);
  const rooms = game.ship.rooms.map((room) => {
    const state = stateOf(game, room, here);
    const boxed = box(room, state, thingsOf(game, room, state, data), hostileWidth(game, room, state));
    // The charge burning in there, as turns left: the number every view draws
    // in red (`systems/alert.ts`, `fuseIn`).
    const fuse = fuseIn(game, room.id);
    const drawn = fuse === undefined ? boxed : { ...boxed, charge: fuse };
    const lit = alarm.has(room.id) ? { ...drawn, alarm: true as const } : drawn;
    const hit = struck.has(room.id) ? { ...lit, threat: true as const } : lit;
    return tinted(game.ship, records, named.rooms.has(room.id) ? { ...hit, target: true as const } : hit);
  });
  const line = isTug(game) ? tugLine(game) : shipLine(game.ship, game.currentShip.data, rooms);
  return frame(game.ship, rooms, line, named.doors, records);
}

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

/** A hull nobody is aboard: what it was left like, and nothing more. */
function remoteInput(ship: Ship, data: Record<string, unknown>): SchematicInput {
  const records = hazardsOf(data);
  const rooms = ship.rooms.map((room) => {
    const state: RoomState = room.explored ? "explored" : room.scanned ? "scanned" : "unknown";
    const things = state === "unknown" ? marksOf(ship, room, data) : remembered(ship, room, state, data);
    return tinted(ship, records, box(room, state, things));
  });
  return frame(ship, rooms, shipLine(ship, data, rooms), NO_DOORS, records);
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

/** Columns the banner may use: the schematic's own width, short of the hull line. */
export const BANNER_WIDTH = 62;

/**
 * The line across the top of the schematic: which ship this is, in words.
 *
 * "буксир и данж путаются, давай хоть там текстом" — the owner, after two
 * playtests in which the only difference between home and a dead freighter was
 * the shape of four boxes (docs/tasks/G40-tug-clarity.md, 9). The caption under
 * the schematic says the same thing; this one says it where the eye lands
 * first, and says the alert with it, which the caption never did.
 */
export function bannerLine(game: RoomGame): string {
  const docked = dockedHull(game);
  if (docked) {
    const ship = docked.ship;
    return clipTo(
      t("banner.ahead", {
        hull: named(tagOf(docked.data, "name"), derelictNameOf(tagOf(docked.data, "type"))),
        rooms: t("ship.rooms", { n: ship.rooms.length }),
      }),
      BANNER_WIDTH,
    );
  }
  if (isTug(game)) {
    const to = hull(
      tagOf(game.currentShip.data, "dockedName"),
      derelictNameOf(tagOf(game.currentShip.data, "docked")),
    );
    return clipTo(t("banner.tug", { callsign: tugCallsign(game.seed), hull: to }), BANNER_WIDTH);
  }
  const parts = [
    named(tag(game, "name"), derelictNameOf(tag(game, "type"))),
    t("ship.rooms", { n: game.ship.rooms.length }),
    alertWord(game),
  ];
  return clipTo(t("banner.derelict", { parts: parts.join(" · ") }), BANNER_WIDTH);
}

/** `«KESTREL» · freighter`, with whichever half the store actually has. */
function named(name: string | undefined, type: string | undefined): string {
  const parts: string[] = [];
  if (name) parts.push(`«${name}»`);
  if (type) parts.push(type);
  return parts.length === 0 ? t("word.unknownHull") : parts.join(" · ");
}

/** `KESTREL (freighter)` — the same hull, named inside somebody else's sentence. */
function hull(name: string | undefined, type: string | undefined): string {
  if (!name) return type ?? t("word.unknownHull");
  return type ? `${name} (${type})` : name;
}

/** `quiet` or `alert 2`: the gauge, in the word the tug's own panel uses. */
function alertWord(game: RoomGame): string {
  const level = alertState(game).level;
  return level === 0 ? t("panel.quiet") : t("panel.alertAt", { n: level });
}

/**
 * The hull the tug is tied to, when the drone is standing at the tug's airlock
 * and the voyage has already been aboard it once.
 *
 * `data.from` is the voyage's own note on the tug's store entry
 * (`systems/voyage.ts`), read defensively: it round-trips through a save, and a
 * schematic that throws is a black screen.
 */
function dockedHull(game: RoomGame): { ship: Ship; data: Record<string, unknown> } | undefined {
  if (!isTug(game) || !game.atAirlock()) return undefined;
  const from = game.currentShip.data.from;
  const stored = typeof from === "string" ? game.ships.get(from) : undefined;
  return stored ? { ship: stored.ship, data: stored.data } : undefined;
}

/**
 * The geometry every drawing shares: the wires between the boxes, and the
 * caption. `lit` doors are the ones a red line has just named; `records` is
 * what the drone knows of the hull's hazards, for the traps on its doors.
 */
function frame(
  ship: Ship,
  rooms: SchematicRoom[],
  caption: string,
  lit: ReadonlySet<number> = NO_DOORS,
  records: readonly HazardRecord[] = [],
): SchematicInput {
  const ports = portMap(ship);
  const doors: SchematicDoor[] = ship.doors
    .filter((d) => d.a !== d.b)
    .map((d) => {
      const door: SchematicDoor = {
        id: d.id,
        label: d.label,
        a: d.a,
        b: d.b,
        state: d.state,
        portA: ports.get(portKey(d.a, d.id)) ?? 0,
        portB: ports.get(portKey(d.b, d.id)) ?? 0,
      };
      const trap = knownTrap(ship, records, d.id);
      const trapped = trap === undefined ? door : { ...door, trap: trap.id };
      return lit.has(d.id) ? { ...trapped, target: true as const } : trapped;
    });

  const airlock = ship.airlock();
  const input: SchematicInput = { rooms, doors, shipLine: caption };
  if (airlock) input.tug = { at: ship.entry, label: airlock.label };
  return input;
}

/**
 * A compartment as the drawings take it.
 *
 * `glyphs` is spelled out of `things` rather than built beside it, so the
 * string the terminal prints and the list a tile row walks cannot drift: one
 * list, joined for the view that needs a string. That is also why `things` may
 * never be dropped from a box that has contents — the ASCII schematic would go
 * blank with it.
 */
function box(room: Room, state: RoomState, things: readonly SchematicThing[], hostiles = 0): SchematicRoom {
  const out: SchematicRoom = {
    id: room.id,
    label: room.label,
    name: roomName(room),
    kind: room.kind,
    col: room.col,
    row: room.row,
    state,
    glyphs: things.map((thing) => thing.glyph).join(" "),
  };
  if (things.length > 0) out.things = things;
  if (hostiles > 0) out.hostiles = hostiles;
  return out;
}

/**
 * How many leading columns of a box's glyph row are machines.
 *
 * The schematic paints them in the colour of trouble, and the count is worked
 * out here because this is the file that decides what a box shows at all: a
 * remembered compartment lists the scrap that was left in it and no machines,
 * since machines move and wreckage does not. Glyphs are joined with a space, so
 * n machines occupy 2n-1 columns (docs/tasks/G40-tug-clarity.md, 7).
 */
function hostileWidth(game: RoomGame, room: Room, state: RoomState): number {
  if (state !== "current" && state !== "visible") return 0;
  // Counted off the list the contacts block counts (`hostilesIn`), and the
  // hostile glyphs lead the row (`thingsOf`), so the prefix it paints is
  // exactly those machines and never a character of anything behind them —
  // and the badge every view makes of this number is the number the panel's
  // rule shows (docs/tasks/G83-anonymous-blows.md, 4).
  const machines = hostilesIn(game, room.id).length;
  return machines === 0 ? 0 : machines * 2 - 1;
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
      const thing = asThing(raw, BUCKET_GLYPH[key], bucketName(key, raw));
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
 * The compartment with its hazard on it, for the drawing that tints a floor
 * (`ui/web/hex-svg.ts`). The word is the codex card's own name for the hazard —
 * `FROST`, not the sentence under the compartment's name, which is written for
 * a panel row and not for the inside of a hexagon.
 */
function tinted(ship: Ship, records: readonly HazardRecord[], room: SchematicRoom): SchematicRoom {
  // A blown compartment is a hazard the ship wrote over whatever was there
  // (`systems/alert.ts`, `blast`), so it takes the floor the same way.
  if (isBlown(ship.roomAt(room.id))) return { ...room, hazard: { id: BLOWN, word: t("word.blown") } };
  const kind = records.length === 0 ? undefined : knownHazard(ship, records, room.id);
  if (kind === undefined) return room;
  return { ...room, hazard: { id: kind.id, word: t(codexFor(kind.id)?.title ?? kind.word) } };
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
function stateOf(game: RoomGame, room: Room, here: RoomId | undefined): RoomState {
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
function thingsOf(
  game: RoomGame,
  room: Room,
  state: RoomState,
  data: Record<string, unknown>,
): SchematicThing[] {
  if (state === "unknown") return marksOf(game.ship, room, data);
  if (state !== "current" && state !== "visible") return remembered(game.ship, room, state, data);

  // The machines carry their own word, which is the one thing a picture of a
  // machine cannot: `machineName` is what the contact block calls it, so a tile
  // and the sidebar name the same thing. Hostile ones first, painted as such;
  // anything else alive in the compartment after them, in plain colour.
  const hostile = new Set(hostilesIn(game, room.id).map((m) => m.id));
  const machines = machinesIn(game, room.id)
    .sort((a, b) => Number(hostile.has(b.id)) - Number(hostile.has(a.id)))
    .map((m): SchematicThing =>
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
): SchematicThing[] {
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
      .map((glyph): SchematicThing => ({ glyph, name: glyph }));
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
function marksOf(ship: Ship, room: Room, data: Record<string, unknown>): SchematicThing[] {
  return hazardThings(ship, room.id, hazardsOf(data));
}

/**
 * The airlock's own label, drawn in whichever compartment carries it.
 *
 * Two characters wide and never a picture: `a1` is a door's name, and the set
 * has no tile for it on purpose — a label that turned into a silhouette would
 * stop being the thing the player types.
 */
function homeThings(ship: Ship, room: Room): SchematicThing[] {
  const airlock = ship.doorsOf(room.id).find((d) => d.state === "airlock");
  return airlock ? [{ glyph: airlock.label, name: airlock.label }] : [];
}

/**
 * `KESTREL · freighter · 12 rooms · 5 seen · 2 scanned`.
 *
 * Counted off the boxes rather than off the ship, because the caption sits
 * under the picture and the two used to disagree: `seen` was `room.explored`
 * while the drawing also fills in every compartment in sight through an open
 * door, so a player who could read two named boxes was told `1 seen` — on
 * 21 599 screens of a 98 447-screen sweep (docs/tasks/G55, 10). One number, one
 * source: what the drawing shows solid is `seen`, what it shows dashed from a
 * sensor pulse is `scanned`, and a box with nothing in it is neither.
 */
function shipLine(ship: Ship, data: Record<string, unknown>, drawn: readonly SchematicRoom[]): string {
  const parts = [tagOf(data, "name") ?? t("word.derelict").toUpperCase()];
  const type = derelictNameOf(tagOf(data, "type"));
  if (type) parts.push(type);

  const scanned = drawn.filter((r) => r.state === "scanned").length;
  const seen = drawn.filter((r) => r.state !== "unknown").length - scanned;
  parts.push(t("ship.rooms", { n: ship.rooms.length }), t("ship.seen", { n: seen }));
  if (scanned > 0) parts.push(t("ship.scanned", { n: scanned }));
  return parts.join(" · ");
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
 * Cut at a word, the way `clipName` cuts a name: a banner ending `(корса`
 * reads as a typo, one ending at a whole word reads as a width. The separator
 * a cut leaves dangling goes with it.
 */
function clipTo(text: string, width: number): string {
  if (text.length <= width) return text;
  const word = text.lastIndexOf(" ", width);
  const cut = word > 0 ? text.slice(0, word) : text.slice(0, Math.max(0, width));
  return cut.replace(/[\s·:,]+$/, "");
}

/**
 * A system that is already up. Named and exported with the bucket marks
 * because between them they are the whole of what a card can put on the map
 * without carrying a glyph of its own, and `tests/tiles-view.test.ts` holds
 * every one of them to having a drawing.
 */
export const ONLINE_GLYPH = "✓";

function asThing(raw: unknown, fallback: string, called: string): RoomThing | undefined {
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
  return { glyph, name };
}

/**
 * Which of the two ports on a side each door takes. The layout allows two per
 * side and demands they head in different directions, so ordering them by the
 * rows they cross is what stops two wires leaving one side and crossing in the
 * gutter — the rule the generator validates against (`layoutFaults`).
 */
function portMap(ship: Ship): Map<string, 0 | 1> {
  const out = new Map<string, 0 | 1>();
  for (const room of ship.rooms) {
    for (const [, uses] of portsOf(ship, room.id)) {
      [...uses]
        .sort((a, b) => a.dy - b.dy || a.door.id - b.door.id)
        .forEach((use, i) => out.set(portKey(room.id, use.door.id), i === 0 ? 0 : 1));
    }
  }
  return out;
}

function portKey(room: RoomId, door: number): string {
  return `${room}:${door}`;
}
