import { hexLayout, isAlive } from "@jamrog/engine";
import type { Entity, RoomGame, RoomId } from "@jamrog/engine";
import { machineName } from "../../content/monsters.js";
import { moduleName } from "../../content/modules.js";
import { roomActions } from "../actions.js";
import { hostilesIn, rigOf } from "../../twist/rig.js";
import { alertState } from "../../systems/alert.js";
import { currentDerelict, voyageOf } from "../../systems/voyage.js";
import { derelictName } from "../../content/derelicts.js";
import { tugCallsign } from "../../content/hints.js";
import { HULLS, hullName, hullTrait } from "../../content/hulls.js";
import { OBJECTIVE_COUNT } from "../../content/objectives.js";
import { isTug } from "../../content/tug.js";
import { codexFor } from "../../content/codex.js";
import { helpHeadings, helpPages } from "../input.js";
import { t } from "../../i18n.js";
import type { BoardDoor, BoardRoom, BoardThing, Knows, Route } from "./board/HexBoard.js";
import type { RackSlot } from "./meters/Rack.js";
import type { LogEntry } from "./action/Log.js";

/**
 * Everything the React screen is allowed to know about the game.
 *
 * One direction only: the engine is asked, never told. Nothing in here decides
 * a rule — which door can be walked through, what a thing can have done to it,
 * how much the drone knows about a compartment are all the engine's answers,
 * read out and reshaped. A second opinion in this file would be a second
 * implementation of the rules, and the first one would eventually be wrong.
 */

/**
 * How much the drone knows, in the four steps the board draws.
 *
 * The engine keeps five: a compartment it is *looking at* and one it has
 * *been in* are different facts, because what was left in a remembered room
 * may have walked out of it since. The board collapses them — both show their
 * contents and neither has the drone in it — so the distinction survives in
 * the model and not in the picture. If a stale manifest ever starts costing
 * runs, this is the line to reopen.
 */
function knowsOf(game: RoomGame, room: { id: RoomId; explored: boolean; scanned: boolean }): Knows {
  if (room.id === game.player.room) return "current";
  if (game.visible.has(room.id)) return "monitored";
  if (room.explored) return "monitored";
  if (room.scanned) return "detected";
  return "undetected";
}

/** Machines standing in a compartment right now, the drone excluded. */
function machinesIn(game: RoomGame, room: RoomId): Entity[] {
  return game.entitiesIn(room).filter((e) => e.id !== game.player.id && isAlive(e));
}

/** The verbs the engine is offering right now, by what they are aimed at. */
function verbsByTarget(game: RoomGame): Map<number, { verb: string; note?: string }> {
  const out = new Map<number, { verb: string; note?: string }>();
  if (game.status !== "playing") return out;
  for (const action of roomActions(game)) {
    if (!action.enabled) continue;
    const cmd = action.cmd;
    if (cmd.kind !== "attack" && cmd.kind !== "act") continue;
    const target = cmd.target;
    if (target === undefined) continue;
    /* The first verb offered for a thing is the one a click spends. The list is
       already in the engine's own order of preference, so taking the first is
       taking its answer rather than inventing a precedence here. */
    if (out.has(target)) continue;
    const verb = cmd.kind === "attack" ? "attack" : cmd.verb;
    out.set(target, action.extra === undefined ? { verb } : { verb, note: action.extra });
  }
  return out;
}

/** What is standing or lying in a compartment, with the ids verbs bind to. */
function thingsIn(game: RoomGame, room: RoomId, knows: Knows): BoardThing[] {
  if (knows === "undetected" || knows === "detected") return [];
  const verbs =
    room === game.player.room
      ? verbsByTarget(game)
      : new Map<number, { verb: string; note?: string }>();
  const hostile = new Set(hostilesIn(game, room).map((m) => m.id));
  return machinesIn(game, room).map((machine): BoardThing => {
    const offered = verbs.get(machine.id);
    const base: BoardThing = {
      id: `m${String(machine.id)}`,
      glyph: machine.ch,
      name: machineName(machine.name),
      threat: Math.min(3, Math.max(1, Math.ceil(machine.hp / 3))),
    };
    return {
      ...base,
      ...(hostile.has(machine.id) ? { hostile: true as const } : {}),
      ...(offered === undefined ? {} : { verb: offered.verb, note: offered.note }),
    };
  });
}

export interface BoardModel {
  rooms: BoardRoom[];
  doors: BoardDoor[];
  drone: RoomId | null;
  /** True when the honeycomb could be drawn; false means the hull had no mask. */
  laid: boolean;
}

/**
 * The hull as a honeycomb.
 *
 * `hexLayout` owns the geometry — it is the engine's, it is tested over
 * hundreds of seeds, and a second tiling here would drift from it the first
 * time either changed. A compartment it could not place is left out rather
 * than guessed at: a hexagon in the wrong cell is worse than no hexagon.
 */
export function boardOf(game: RoomGame): BoardModel {
  const ship = game.ship;
  const layout = hexLayout(ship);
  const cells = new Map<RoomId, { q: number; r: number }>();
  for (const room of ship.rooms) {
    const cell = layout.cells.get(room.id);
    if (cell !== undefined) cells.set(room.id, cell);
  }

  const rooms: BoardRoom[] = [];
  for (const room of ship.rooms) {
    const cell = cells.get(room.id);
    if (cell === undefined) continue;
    const knows = knowsOf(game, room);
    const props: string[] = [];
    if (room.hazard === "vented") props.push("vented");
    else if (room.hazard !== "") props.push("hazard");
    if (room.opaque === true) props.push("dark");
    rooms.push({
      id: room.id,
      label: room.label,
      name: room.name,
      knows,
      q: cell.q,
      r: cell.r,
      things: thingsIn(game, room.id, knows),
      props,
    });
  }

  const placed = new Set(rooms.map((r) => r.id));
  const doors: BoardDoor[] = ship.doors
    .filter((d) => d.a !== d.b && placed.has(d.a) && placed.has(d.b))
    .map((d) => ({ id: d.id, label: d.label, a: d.a, b: d.b, state: d.state, verbs: [] }));

  return { rooms, doors, drone: game.player.room ?? null, laid: layout.masked || rooms.length > 0 };
}

/**
 * What walking to a compartment would take, and what is in the way.
 *
 * Planned twice on purpose. Once over the doors the drone can actually pass,
 * and — when that finds nothing — again over every door, so the board can say
 * *which* bulkhead refuses rather than merely shrugging. `Ship.passable` is the
 * engine's own test, so the route the board previews is the route the command
 * would take.
 */
export function routeIn(game: RoomGame, board: BoardModel) {
  const ship = game.ship;
  const from = game.player.room;
  const walker = { isPlayer: true as const };

  return function route(to: RoomId): Route | null {
    if (from === undefined || to === from) return null;

    const walk = (openOnly: boolean): RoomId[] | null => {
      const seen = new Set<RoomId>([from]);
      const back = new Map<RoomId, RoomId>();
      const queue: RoomId[] = [from];
      while (queue.length > 0) {
        const at = queue.shift() as RoomId;
        if (at === to) break;
        for (const door of ship.doorsOf(at)) {
          if (openOnly && !ship.passable(door, walker)) continue;
          const far = ship.other(door, at);
          if (seen.has(far)) continue;
          seen.add(far);
          back.set(far, at);
          queue.push(far);
        }
      }
      if (!seen.has(to)) return null;
      const path: RoomId[] = [];
      let at = to;
      while (at !== from) {
        path.unshift(at);
        const prev = back.get(at);
        if (prev === undefined) return null;
        at = prev;
      }
      return path;
    };

    const clear = walk(true);
    if (clear !== null) return { path: clear, blocked: null };
    const any = walk(false);
    if (any === null) return null;

    /* The first shut bulkhead along the way is the one to point at. */
    const full = [from, ...any];
    for (let i = 0; i < full.length - 1; i++) {
      const door = ship
        .doorsOf(full[i] as RoomId)
        .find((d) => ship.other(d, full[i] as RoomId) === full[i + 1]);
      if (door !== undefined && !ship.passable(door, walker)) {
        const shown = board.doors.find((d) => d.id === door.id) ?? null;
        return { path: any, blocked: shown };
      }
    }
    return { path: any, blocked: null };
  };
}

/** Three pips, and the run ends when the last goes out. */
const CORE_MAX = 3;

/** The rack, as the drone wears it. Empty and burned look the same on purpose. */
export function rackOf(game: RoomGame): { core: number; coreMax: number; slots: RackSlot[] } {
  const rig = rigOf(game.player);
  if (rig === undefined) return { core: 0, coreMax: 3, slots: [] };
  const slots: RackSlot[] = rig.slots.map((slot) =>
    slot === null
      ? {}
      : { name: moduleName(slot.kind), value: slot.integrity, max: maxOf(slot) },
  );
  /* The core is the run: three pips, and the drone's own hp is how many are
     still lit. `CORE_MAX` rather than a field, because the entity carries no
     maximum and the rack's three boxes are a fact about the drone. */
  return { core: game.player.hp, coreMax: CORE_MAX, slots };
}

function maxOf(slot: { integrity: number; bonus?: number; base?: number }): number {
  return Math.max(slot.integrity, (slot.base ?? slot.integrity) + (slot.bonus ?? 0));
}

/** The log, newest first, which is the order the ticker reads. */
export function logOf(game: RoomGame, keep = 14): LogEntry[] {
  return game.log.lines
    .slice(-keep)
    .reverse()
    .map((line): LogEntry => {
      const tag = line.key === undefined ? "log" : (line.key.split(".")[0] ?? "log");
      const tone = line.tone === "bad" || line.tone === "alarm" ? "bad" : line.tone === "warn" ? "warn" : undefined;
      return tone === undefined ? { tag, text: line.text } : { tag, text: line.text, tone };
    });
}

/** How high the ship's alert has climbed, 0..5. */
export function alertOf(game: RoomGame): number {
  return alertState(game).level;
}

// ------------------------------------------------------------------ the tug

/**
 * One pressable line, as the engine offered it.
 *
 * `roomActions` already decides what may be done, in what order, grouped under
 * which heading and disabled for what reason. This carries the answer across
 * unchanged and adds one thing the terminal did not need: `index`, so a click
 * can find its way back to the command without the view holding a `RoomCommand`
 * it might edit.
 */
export interface Offer {
  index: number;
  label: string;
  enabled: boolean;
  note?: string;
  why?: string;
  head?: string;
  /** A line that opens a group, or `null` for the line back out of one. */
  into?: string | null;
}

export function offersOf(game: RoomGame, level?: string): Offer[] {
  return roomActions(game, level).map((action, index) => ({
    index,
    label: action.label,
    enabled: action.enabled,
    ...(action.extra === undefined ? {} : { note: action.extra }),
    ...(action.why === undefined ? {} : { why: action.why }),
    ...(action.head === undefined ? {} : { head: action.head }),
    ...(action.step === undefined ? {} : { into: typeof action.step === "string" ? action.step : null }),
  }));
}

export interface TugModel {
  callsign: string;
  /** The hull the tug is tied to, and how the last drone left it. */
  derelict: { name: string; alert: number; online: number; of: number; sold: boolean; price: number };
  account: { credits: number; loot: number; keys: number; sortie: number; hold: number };
  /** The rack: three hulls, their prices, and which one is on the rails. */
  hulls: Array<{ id: string; name: string; trait: string; price: number; on: boolean }>;
}

/**
 * The tug, which is a decision and not a place.
 *
 * It was drawn as a map twice — four boxes in a line, then the derelict's own
 * schematic — and both readings put a *where* on a screen whose whole subject is
 * a *what next* (`ui/tugboard.ts`). So the honeycomb does not come home with
 * the drone: what stands here is the account, the hull the tug is tied to, and
 * the rack, each of them a thing that can be looked at and spent on.
 */
export function tugOf(game: RoomGame): TugModel {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  return {
    callsign: tugCallsign(game.seed),
    derelict: {
      name: derelictName(state.spec),
      alert: state.alert,
      online: state.online.length,
      of: OBJECTIVE_COUNT,
      sold: state.sold,
      price: state.spec.salePrice,
    },
    account: {
      credits: voyage.credits,
      loot: voyage.loot,
      keys: voyage.keys,
      sortie: voyage.sortie,
      hold: voyage.hold.length,
    },
    hulls: HULLS.map((hull) => ({
      id: hull.id,
      name: hullName(hull),
      trait: hullTrait(hull),
      price: hull.price,
      on: voyage.hull === hull.id,
    })),
  };
}

/** True while the drone is home, which is the one place with no honeycomb. */
export function isHome(game: RoomGame): boolean {
  return isTug(game);
}

// -------------------------------------------------------------- the record

/** The whole log, newest first: what the history card pages through. */
export function historyOf(game: RoomGame): LogEntry[] {
  return logOf(game, game.log.lines.length);
}

/** How the run ended, and what it was worth. */
export interface EndingModel {
  won: boolean;
  seed: number;
  turns: number;
  sorties: number;
  credits: number;
  hulls: number;
}

export function endingOf(game: RoomGame): EndingModel {
  const voyage = voyageOf(game);
  return {
    won: game.status === "won",
    seed: game.seed,
    turns: game.schedule.time,
    sorties: voyage.sortie,
    credits: voyage.credits,
    hulls: voyage.state.filter((s) => s.sold).length,
  };
}

// ------------------------------------------------------------- the two cards

/** The controls, in the pages the engine packs them into. */
export function helpOf(game: RoomGame): { pages: string[][]; headings: ReadonlySet<string> } {
  return { pages: helpPages(isTug(game)), headings: new Set(helpHeadings()) };
}

export interface CodexCard {
  id: string;
  title: string;
  what: string;
  wrong: string;
  helps: string;
  turn?: string;
  lore: string;
  /** Modules that answer this, and whether the drone is carrying one. */
  answers: Array<{ name: string; fitted: boolean }>;
}

/**
 * One card of the codex, with its words already read out of the table.
 *
 * The terminal asked `codexView`, which took the whole `AppState` because the
 * terminal kept the queue in it. The card itself never needed the queue — it
 * needs an id and the rack — so this asks for those two and the React side
 * keeps its own place in the queue.
 */
export function codexOf(game: RoomGame, id: string): CodexCard | undefined {
  const entry = codexFor(id);
  if (entry === undefined) return undefined;
  const rig = rigOf(game.player);
  const fitted = new Set<string>();
  for (const slot of rig?.slots ?? []) if (slot !== null) fitted.add(slot.kind);
  return {
    id: entry.id,
    title: t(entry.title),
    what: t(entry.what),
    wrong: t(entry.wrong),
    helps: t(entry.helps),
    ...(entry.turn === undefined ? {} : { turn: t(entry.turn) }),
    lore: t(entry.lore),
    answers: (entry.modules ?? []).map((m) => ({ name: moduleName(m), fitted: fitted.has(m) })),
  };
}
