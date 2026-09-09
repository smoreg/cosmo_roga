import { isAlive, portsOf, type Entity, type Room, type RoomGame, type RoomId, type Ship } from "@jamrog/engine";
import { derelictNameOf } from "../content/derelicts.js";
import { tugCallsign } from "../content/hints.js";
import { moduleKind, moduleName } from "../content/modules.js";
import { roomName } from "../content/zones.js";
import { t } from "../i18n.js";
import { isTug } from "../content/tug.js";
import { alertState } from "../systems/alert.js";
import { wrecksOn } from "../twist/rig.js";
import { strikersNear } from "./strikers.js";
import type { RoomState, SchematicDoor, SchematicInput, SchematicRoom } from "./schematic.js";

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
): SchematicInput {
  const docked = dockedHull(game);
  const input = docked ? remoteInput(docked.ship, docked.data) : aboardInput(game, alarm);
  if (target === undefined) return input;
  return {
    ...input,
    rooms: input.rooms.map((room) => (room.id === target ? { ...room, target: true as const } : room)),
  };
}

/**
 * Compartments flashing on this frame, when nothing is: the ordinary case, and
 * a shared empty set rather than a fresh one per frame.
 */
const NO_ALARM: ReadonlySet<RoomId> = new Set();

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
  const rooms = game.ship.rooms.map((room) => {
    const state = stateOf(game, room, here);
    const drawn = box(room, state, glyphsOf(game, room, state), hostileWidth(game, room, state));
    const lit = alarm.has(room.id) ? { ...drawn, alarm: true as const } : drawn;
    return struck.has(room.id) ? { ...lit, threat: true as const } : lit;
  });
  const line = isTug(game) ? tugLine(game) : shipLine(game.ship, game.currentShip.data, rooms);
  return frame(game.ship, rooms, line);
}

/** A hull nobody is aboard: what it was left like, and nothing more. */
function remoteInput(ship: Ship, data: Record<string, unknown>): SchematicInput {
  const rooms = ship.rooms.map((room) => {
    const state: RoomState = room.explored ? "explored" : room.scanned ? "scanned" : "unknown";
    return box(room, state, state === "unknown" ? "" : remembered(ship, room, state));
  });
  return frame(ship, rooms, shipLine(ship, data, rooms));
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

/** The geometry every drawing shares: the wires between the boxes, and the caption. */
function frame(ship: Ship, rooms: SchematicRoom[], caption: string): SchematicInput {
  const ports = portMap(ship);
  const doors: SchematicDoor[] = ship.doors
    .filter((d) => d.a !== d.b)
    .map((d) => ({
      id: d.id,
      label: d.label,
      a: d.a,
      b: d.b,
      state: d.state,
      portA: ports.get(portKey(d.a, d.id)) ?? 0,
      portB: ports.get(portKey(d.b, d.id)) ?? 0,
    }));

  const airlock = ship.airlock();
  const input: SchematicInput = { rooms, doors, shipLine: caption };
  if (airlock) input.tug = { at: ship.entry, label: airlock.label };
  return input;
}

function box(room: Room, state: RoomState, glyphs: string, hostiles = 0): SchematicRoom {
  const out: SchematicRoom = {
    id: room.id,
    label: room.label,
    name: roomName(room),
    col: room.col,
    row: room.row,
    state,
    glyphs,
  };
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
  // Counted off the same list `glyphsOf` draws from, so the prefix it paints is
  // exactly the machines and never a character of the scrap behind them.
  const machines = machinesIn(game, room.id).length;
  return machines === 0 ? 0 : machines * 2 - 1;
}

/** Everything lying in a compartment, in the order the panel lists it. */
export function thingsIn(game: RoomGame, room: RoomId): RoomThing[] {
  return thingsOn(game.ship, room);
}

/** The same, on a hull the drone is not aboard: content belongs to the ship. */
function thingsOn(ship: Ship, room: RoomId): RoomThing[] {
  const out: RoomThing[] = wrecksOn(ship, room).map((w) => {
    const kind = moduleKind(w.kind);
    const what = w.glyph === "X" ? t("word.crate") : t("word.scrap");
    return {
      glyph: w.glyph,
      name: `${what} ${moduleName(kind.id)} ${w.integrity}/${kind.integrity}`,
    };
  });

  const data = ship.roomAt(room).data;
  for (const key of CONTENT_KEYS) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const thing = asThing(raw);
      if (thing) out.push(thing);
    }
  }
  return out;
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
function glyphsOf(game: RoomGame, room: Room, state: RoomState): string {
  if (state === "unknown") return "";
  if (state !== "current" && state !== "visible") return remembered(game.ship, room, state);

  const machines = machinesIn(game, room.id).map((m) => m.ch);
  return [...machines, ...homeGlyphs(game.ship, room), ...thingsOn(game.ship, room.id).map((t) => t.glyph)]
    .join(" ");
}

/**
 * A compartment nobody is looking at: what was left lying in it, because
 * wreckage stays where it fell and machines do not — except after a pulse,
 * which is a snapshot and says so by being one.
 */
function remembered(ship: Ship, room: Room, state: RoomState): string {
  const home = homeGlyphs(ship, room);
  const snapshot = room.data.snapshot;
  if (state === "scanned" && typeof snapshot === "string") {
    return [...home, snapshot].filter((s) => s.length > 0).join(" ");
  }
  return [...home, ...thingsOn(ship, room.id).map((t) => t.glyph)].join(" ");
}

/** The airlock's own label, drawn in whichever compartment carries it. */
function homeGlyphs(ship: Ship, room: Room): string[] {
  const airlock = ship.doorsOf(room.id).find((d) => d.state === "airlock");
  return airlock ? [airlock.label] : [];
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

function clipTo(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(0, width));
}

function asThing(raw: unknown): RoomThing | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const thing = raw as { glyph?: unknown; name?: unknown; label?: unknown; online?: unknown };
  const mark = typeof thing.glyph === "string" && thing.glyph.length > 0 ? thing.glyph[0]! : undefined;
  if (mark === undefined) return undefined;
  // A system already up is drawn ticked rather than as the mark that means
  // "work to do here". Three `+` on a hull whose three systems are online is
  // the map telling a player to go and do what they have already done — the
  // owner, standing on a raised drive with `ALL THREE ONLINE` on the panel:
  // «почему тут +?». The tick is the panel's own mark for the same fact, and it
  // is a glyph rather than a word, so it needs no table.
  const glyph = thing.online === true ? "✓" : mark;
  const name =
    typeof thing.name === "string" ? thing.name : typeof thing.label === "string" ? thing.label : glyph;
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
