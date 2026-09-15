import { hexLayout, isAlive } from "@jamrog/engine";
import type { Entity, RoomGame, RoomId } from "@jamrog/engine";
import { machineName } from "../../content/monsters.js";
import { moduleKind, moduleName } from "../../content/modules.js";
import { roomActions } from "../actions.js";
import { doorWays } from "../doorlist.js";
import { findSlot, hostilesIn, pulseWait, rigOf, wrecksOn, type Rig } from "../../twist/rig.js";
import { BUCKET_GLYPH, CONTENT_KEYS, ONLINE_GLYPH, bucketName } from "../contents.js";
import { gaugeOf, alertState } from "../../systems/alert.js";
import { shipState } from "../../systems/shipstate.js";
import { systemsAboard } from "../../systems/ship.js";
import { keysHeld } from "../../systems/doors.js";
import { charterTag, currentDerelict, derelictAboard, voyageOf } from "../../systems/voyage.js";
import { zoneName } from "../../content/zones.js";
import { derelictName } from "../../content/derelicts.js";
import { tugCallsign } from "../../content/hints.js";
import { HULLS, hullName, hullTrait } from "../../content/hulls.js";
import { OBJECTIVE_COUNT, objectiveSpec } from "../../content/objectives.js";
import { isTug } from "../../content/tug.js";
import { droneName } from "../../content/drones.js";
import { codexFor } from "../../content/codex.js";
import { helpHeadings, helpPages } from "../input.js";
import { t } from "../../i18n.js";
import type { BoardDoor, BoardRoom, BoardThing, Knows, Route } from "./board/HexBoard.js";
import { keelOf, wreckage } from "./hull.js";
import { deckIndex } from "./deckindex.js";
import { deckOf } from "./deck.js";
import type { RackSlot } from "./meters/Rack.js";
import type { LogEntry } from "./action/Log.js";
import { jobNow, jobOn } from "../../systems/jobs.js";
import { BENCH_CURE_PRICE, cureTurns, harmLine, turnsToBeat, virusOf } from "../../systems/virus.js";
import { strainName, strainOf } from "../../content/viruses.js";
import { infectChance } from "../../systems/virus.js";
import { wreckSource } from "../../twist/rig.js";
import { specOfShip } from "../../content/derelicts.js";

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

/**
 * What is standing or lying in a compartment, with the ids verbs bind to.
 *
 * Machines and what is left of machines, in that order. A hostile that
 * collapses becomes a pile on the floor with a module in it — the engine has
 * always said so, and `act salvage {target}` has always been offered for it —
 * but the board was walking the living and nothing else, so the reward for
 * winning a fight was a compartment that looked empty.
 *
 * The prefix on the id is which list the number belongs to: machines are
 * entities, wrecks are the ship's own numbering, and the two would otherwise
 * be one integer meaning two things (`twist/rig.ts`, `FIRST_SHIP_ID`).
 */
function thingsIn(game: RoomGame, room: RoomId, knows: Knows): BoardThing[] {
  if (knows === "undetected" || knows === "detected") return [];
  const verbs =
    room === game.player.room
      ? verbsByTarget(game)
      : new Map<number, { verb: string; note?: string }>();
  const hostile = new Set(hostilesIn(game, room).map((m) => m.id));

  const machines = machinesIn(game, room).map((machine): BoardThing => {
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

  /* Everything the ship itself holds, under one prefix because the ship holds
     it under one counter (`twist/rig.ts`, `FIRST_SHIP_ID`): wreckage, bodies,
     crates, its own systems, and whatever a charter left lying about. None of
     it walks away, so it is listed in a compartment the drone only remembers
     as readily as in the one it is standing in. */
  const held = shipThings(game, room).map((thing): BoardThing => {
    const offered = verbs.get(thing.id);
    const base: BoardThing = {
      id: `s${String(thing.id)}`,
      glyph: thing.glyph,
      name: thing.name,
      /* A job already begun says how far in it is. Without it a player who
         steps away for a turn comes back to a line that reads exactly as it
         did before they started, and starts again. */
      ...(room === game.player.room ? (workOn(game, thing.id) ?? {}) : {}),
      ...(thing.risk === undefined ? {} : { risk: thing.risk }),
    };
    return offered === undefined ? base : { ...base, verb: offered.verb, note: offered.note };
  });

  return [...machines, ...held];
}

/**
 * Everything lying in a compartment that the ship numbers, with its number.
 *
 * `ui/contents.ts` walks the same buckets and throws the id away, because the
 * picture it was built for had nothing to bind a verb to. That is exactly what
 * the board needs, so this walks them again and keeps it. The glyphs and the
 * names are that module's, not a second opinion: a crate drawn `X` in one view
 * and `▪` in another would be two games.
 */
function shipThings(
  game: RoomGame,
  room: RoomId,
): Array<{ id: number; glyph: string; name: string; risk?: number }> {
  const out: Array<{ id: number; glyph: string; name: string; risk?: number }> = [];
  /* What this hull adds to everything but a sealed crate. */
  const bonus = specOfShip(game.ship)?.virusBonus ?? 0;
  for (const wreck of wrecksOn(game.ship, room)) {
    const kind = moduleKind(wreck.kind);
    const risk = infectChance(wreckSource(wreck), bonus);
    out.push({
      id: wreck.id,
      glyph: wreck.glyph,
      name: `${wreck.glyph === "X" ? t("word.crate") : t("word.scrap")} ${moduleName(kind.id)}`,
      ...(risk > 0 ? { risk } : {}),
    });
  }
  const data = game.ship.roomAt(room).data;
  for (const key of CONTENT_KEYS) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== "object" || raw === null) continue;
      const rec = raw as { id?: unknown; glyph?: unknown; name?: unknown; label?: unknown; online?: unknown };
      if (typeof rec.id !== "number") continue;
      const own = typeof rec.glyph === "string" && rec.glyph.length > 0 ? rec.glyph[0] : undefined;
      /* A system already up is drawn ticked rather than as the mark that means
         "work to do here" — the old view's rule, kept whole. */
      const glyph = rec.online === true ? ONLINE_GLYPH : (own ?? BUCKET_GLYPH[key]);
      const name =
        typeof rec.name === "string"
          ? rec.name
          : typeof rec.label === "string"
            ? rec.label
            : bucketName(key, raw);
      out.push({ id: rec.id, glyph, name });
    }
  }
  return out;
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
export function boardOf(game: RoomGame, held?: ReadonlySet<RoomId>): BoardModel {
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
    /* A compartment a sweep has reached but the sweep has not got to yet.
       A scan is the one action whose entire output is a change in what the
       board shows, which makes it the one action that is nothing but an
       animation: reached all at once, it reads as a screen redrawing rather
       than as something going out from the drone. So the screen holds the far
       ones back for a frame or two and the board draws them as what they still
       were (`ui/react/Screen.tsx`, the sweep). */
    const knows = held?.has(room.id) === true ? "undetected" : knowsOf(game, room);
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

  /**
   * Every way through a bulkhead the drone is standing next to.
   *
   * `doorWays` is the engine's own answer and it returns nothing when a door
   * has fewer than two ways, which is the terminal's rule: a sublist of one is
   * not a question. A popover of one is, so the single way is taken off the
   * compartment's list instead — the menu is the only place a door's verbs are
   * offered now that there is no numbered list beside the map.
   */
  /**
   * And the hull the ship no longer has.
   *
   * `hexLayout` lays out a graph, and a graph grown along its spanning tree
   * comes out lopsided — which is right for a diagram and wrong for a ship,
   * because the first fact anyone knows about a ship is that it is the same on
   * both sides of its keel. So the cells with no opposite number get one, and
   * it is wreckage: hull that is still part of the vessel and no longer part of
   * anywhere you can go.
   *
   * Negative ids, because these are not rooms and must never be mistaken for
   * one by anything that indexes by id. Nothing is told to the engine and
   * nothing can be walked into; a run replays identically with the wreckage
   * drawn or not.
   */
  const keel = keelOf(cells.values());
  /* The deck each compartment wears, decided before the wreckage is added:
     wreckage is hull and not a room, so it has no deck to pick. */
  const decks = deckOf(game, deckIndex(), cells, keel);
  for (const room of rooms) {
    const deck = decks.get(room.id);
    if (deck?.id !== undefined) room.deck = deck;
  }
  for (const [i, cell] of wreckage(cells.values(), keel).entries()) {
    rooms.push({
      id: -1 - i,
      label: "",
      name: "",
      knows: "wrecked",
      q: cell.q,
      r: cell.r,
      things: [],
      props: [],
    });
  }

  /* What the run came for, ringed. Only where a contract names a compartment:
     START 3 and SALVAGE are about the whole hull and would ring everything. */
  const wanted = new Set(
    contractsOf(game)
      .filter((c) => !c.done && c.room?.id !== undefined)
      .map((c) => c.room?.id),
  );
  for (const room of rooms) if (wanted.has(room.id)) room.goal = true;

  const placed = new Set(rooms.map((r) => r.id));
  const doors: BoardDoor[] = ship.doors
    .filter((d) => d.a !== d.b && placed.has(d.a) && placed.has(d.b))
    .map((d) => ({
      id: d.id,
      label: d.label,
      a: d.a,
      b: d.b,
      state: d.state,
      verbs: waysOf(game, d.id),
    }));

  return { rooms, doors, drone: game.player.room ?? null, laid: layout.masked || rooms.length > 0 };
}

/** The ways through one bulkhead, as lines a click can spend. */
function waysOf(game: RoomGame, id: number): BoardDoor["verbs"] {
  if (game.status !== "playing") return [];
  const ways = doorWays(game, id);
  if (ways !== undefined) {
    return ways
      .map((action, index) => ({ index, action }))
      .filter(({ action }) => action.step === undefined)
      .map(({ index, action }) => ({
        index,
        verb: action.label,
        note: action.enabled ? (action.extra ?? "") : (action.why ?? "no"),
        enabled: action.enabled,
        /* A way that is simply walking through is still walking: the board
           plays the drone across rather than spending it where it stands. */
        ...(action.cmd.kind === "go" ? { moves: true as const } : {}),
      }));
  }
  /* One way, or none. `roomActions` carries the single one on the
     compartment's own list, so it is found there rather than invented here. */
  const out: Array<BoardDoor["verbs"][number]> = [];
  roomActions(game).forEach((action, index) => {
    const cmd = action.cmd;
    if (!("door" in cmd) || cmd.door !== id) return;
    out.push({
      index: -1 - index,
      verb: action.label,
      note: action.enabled ? (action.extra ?? "") : (action.why ?? "no"),
      enabled: action.enabled,
      ...(cmd.kind === "go" ? { moves: true as const } : {}),
    });
  });
  return out;
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
export function rackOf(game: RoomGame): {
  core: number;
  coreMax: number;
  slots: RackSlot[];
  /** The class of the drone this rack is bolted into. */
  hull: string;
  /**
   * The strain aboard, where it is living and how long until its next beat.
   *
   * Four strains with four different periods, and the rack showed none of
   * them: a player could read that something was wrong only by watching a
   * number drop on a turn they did not spend. The engine has kept the clock
   * all along (`systems/virus.ts`, `turnsToBeat`); this turns it round.
   */
  virus?: Strain;
} {
  const voyage = voyageOf(game);
  const kind = HULLS.find((h) => h.id === voyage.hull);
  const hull = kind === undefined ? "no drone" : hullName(kind);
  const rig = rigOf(game.player);
  if (rig === undefined) return { core: 0, coreMax: 3, slots: [], hull };
  const slots: RackSlot[] = rig.slots.map((slot) =>
    slot === null
      ? {}
      : { name: moduleName(slot.kind), value: slot.integrity, max: maxOf(slot) },
  );
  const sick = strainOf_(game, rig);
  /* The core is the run: three pips, and the drone's own hp is how many are
     still lit. `CORE_MAX` rather than a field, because the entity carries no
     maximum and the rack's three boxes are a fact about the drone. */
  return { core: game.player.hp, coreMax: CORE_MAX, slots, hull, ...(sick === undefined ? {} : { virus: sick }) };
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

/**
 * Did the *hull* move a bulkhead this turn, or did the drone?
 *
 * The board marks the two differently and the difference is the whole point:
 * a door the player threw themselves gets the cut-out alone — they just picked
 * the verb, and a summons would point at where their cursor already is — while
 * a door the ladder shut gets a mark as well, because nothing told them.
 *
 * Read off the log's keys, which is what a key is for: an opaque id for the
 * event that survives rewording and translation, where the sentence does not.
 */
export function hullMovedDoor(game: RoomGame): boolean {
  const now = game.schedule.time;
  for (let i = game.log.lines.length - 1; i >= 0; i--) {
    const line = game.log.lines[i]!;
    if (line.turn !== now) return false;
    if (line.key === "log.alert.door" || line.key === "log.alert.lock") return true;
  }
  return false;
}

/**
 * The strain aboard, as the rack's own red frame and the card behind it.
 *
 * Everything a player can act on, in one place: what it does, how long until
 * it does it again, and the three prices for being rid of it. The period is
 * turned round into a countdown here for the reason the objectives' turns are
 * — a period is a fact about the strain and a countdown is a fact the player
 * can act on, and only one of the two belongs on a screen.
 */
export interface Strain {
  /** `LEECH`, `SPASM` — the strain, as the log and the codex name it. */
  name: string;
  /** Which bay it is living in: the frame goes round that row. */
  slot: number;
  /** What one beat costs, in a sentence. */
  beat: string;
  /** Turns until the next beat, and the period it counts down from. */
  next: number;
  period: number;
  /** Turns of welding still to do, where a purge is running. */
  purging?: number;
  /** What a purge costs this drone — halved by a SPIKE in the rack. */
  purgeTurns: number;
  /** What the tug bench charges, per point. */
  benchPrice: number;
}

function strainOf_(game: RoomGame, rig: Rig): Strain | undefined {
  const v = virusOf(game.player);
  if (v === undefined || rig.slots[v.slot] === null || rig.slots[v.slot] === undefined) {
    return undefined;
  }
  const strain = strainOf(v.strain);
  return {
    name: strainName(strain),
    slot: v.slot,
    beat: harmLine(strain),
    next: turnsToBeat(game, v),
    period: strain.period,
    ...(v.curing === undefined ? {} : { purging: v.curing.left }),
    purgeTurns: cureTurns(rig),
    benchPrice: BENCH_CURE_PRICE,
  };
}

/** The gauge with its word and its way back down, as the dial draws it. */
export interface AlertModel {
  level: number;
  top: number;
  /** `NOTICED`, `HUNTING`, `SCUTTLE` — the thing the ship is doing. */
  word: string;
  quiet: number;
  needed: number;
  hidden: boolean;
}

export function alertModelOf(game: RoomGame): AlertModel {
  const g = gaugeOf(game);
  return {
    level: g.level,
    top: g.top,
    word: g.word === undefined ? "QUIET" : t(g.word).toUpperCase(),
    quiet: g.quiet,
    needed: g.needed,
    hidden: g.hidden,
  };
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
  /**
   * The drone on the rails, where there is one.
   *
   * One and not three. The readout used to list every hull the yard sells,
   * which is a shelf and belongs with the other things that can be bought —
   * what this side of the screen is for is what the tug *has*. A voyage owns
   * a single drone at a time (`Voyage.hull`), so this is it or it is nothing.
   */
  drone?: {
    id: string;
    /** Which machine this one would be built as, for the icon. */
    who: string;
    /** What it is called: `NADIA KJ-07`. */
    name: string;
    /** And what class of machine it is. */
    hull: string;
    trait: string;
    core: number;
    slots: number;
    speed?: number;
    modules: string[];
  };
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
  const flying = HULLS.find((h) => h.id === voyage.hull);
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
    ...(flying === undefined
      ? {}
      : {
          drone: {
            id: flying.id,
            who: whoOf(game),
            name: droneName(whoOf(game)),
            hull: hullName(flying),
            trait: hullTrait(flying),
            core: flying.core,
            slots: flying.slots,
            ...(flying.speed === undefined ? {} : { speed: flying.speed }),
            modules: flying.modules.map((m) => moduleName(m)),
          },
        }),
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

// ----------------------------------------------------- what the panel carries

/**
 * The things in this compartment, with the verb each one answers to.
 *
 * The same list the hexagon draws, in words: a player who cannot find a shape
 * under the pointer can read the compartment instead, and a thing with no verb
 * is still named — knowing a crate is there and cannot be opened from here is
 * knowing something.
 */
export function hereOf(game: RoomGame): BoardThing[] {
  const room = game.player.room;
  if (room === undefined) return [];
  return thingsIn(game, room, "current");
}

/**
 * Everything the engine offers that is not aimed at a thing on the board.
 *
 * Objects carry their own verbs, and the ones left over are the commands that
 * are about the drone rather than about anything in the room — casting off,
 * sealing up behind you, waiting. They have nowhere on the honeycomb to live,
 * so they live in the panel. `leave` is the one that matters most: a hull you
 * cannot work out how to get off is a hull you die on.
 */
export function commandsOf(game: RoomGame): Offer[] {
  if (game.status !== "playing") return [];
  const out: Offer[] = [];

  /**
   * The scan, while a SCANNER is in the rack — cooling or not.
   *
   * A line of the view and not an offer of the engine, and the difference
   * matters: the engine's list is what a *turn* may spend, read by the bots and
   * by the fixtures and counted by the tug's own screen, and a permanent extra
   * row in it moved every numbered line in the game. What the drone may do is
   * unchanged; this is the board choosing to keep one of those things where it
   * can be seen instead of only where it can be guessed.
   *
   * Shown while it cools rather than hidden, because a line that greys out is
   * how a player learns there is a cooldown at all. The index is negative so
   * `order` knows to spend it by slot rather than by looking it up in a list it
   * was never in.
   */
  const rig = rigOf(game.player);
  const scanner = rig === undefined ? null : findSlot(rig, "scanner");
  if (scanner !== null && !isTug(game)) {
    const wait = pulseWait(game);
    out.push({
      index: -1 - scanner,
      label: t("action.scan"),
      enabled: wait === 0,
      ...(wait === 0 ? {} : { why: t("why.pulse.cooling", { n: wait }) }),
    });
  }
  /* What the compartment is already carrying as an icon. A verb aimed at one
     of those is on the thing itself; a verb aimed at anything else has nowhere
     on the honeycomb to live and belongs here, whatever it is aimed at. The
     point of asking rather than assuming is that nothing can be lost: an
     `act` at a target the board does not draw used to vanish from both. */
  const carried = new Set(hereOf(game).map((t) => Number(t.id.slice(1))));
  roomActions(game).forEach((action, index) => {
    const cmd = action.cmd;
    /* Anything aimed at a thing on the board is that thing's own verb, and
       anything aimed at a door is on that bulkhead's menu. */
    if ("target" in cmd && cmd.target !== undefined && carried.has(cmd.target)) return;
    if ("door" in cmd && cmd.door !== undefined) return;
    if (action.step !== undefined || action.travel !== undefined) return;
    out.push({
      index,
      label: action.label,
      enabled: action.enabled,
      ...(action.extra === undefined ? {} : { note: action.extra }),
      ...(action.why === undefined ? {} : { why: action.why }),
    });
  });
  return out;
}

// ------------------------------------------------------------------ the goal

/** One signed job, as the panel says it. */
export interface Contract {
  /** `RETRIEVE`, `UPLOAD`, `START 3`, `SALVAGE` — the job's own name. */
  name: string;
  /** What it asks for, in a sentence. */
  text: string;
  done: boolean;
  /** Where it asks for it, where it asks somewhere in particular. */
  room?: { kind: string; name: string; id?: RoomId };
  payout: number;
}

export interface GoalModel {
  /** The hull being worked, and which sortie of the voyage this is. */
  hull: string;
  sortie: number;
  /** What the run is for, and how much of it is done. */
  goal: string;
  online: number;
  of: number;
  /** What the hull is worth once it is done. */
  worth: number;
  /** Keycards the drone is carrying, and credits it has not banked yet. */
  keys: number;
  held: number;
  banked: number;
  /**
   * What was actually signed for this hull.
   *
   * The panel said "goal · neutralize · 150 cr" whatever the contract was,
   * which is the *kind* of thing a voyage is for and not the thing this one
   * is: a run carrying a RETRIEVE reads that line and goes looking for three
   * systems. The contracts are on the voyage and always have been.
   */
  contracts: Contract[];
}

/**
 * Why the drone is here, and what it stands to lose.
 *
 * Four facts, and none of them is on the board: what the hull is worth is a
 * number about the whole voyage, and what the drone is carrying is a number
 * about the next mistake — loot is lost with the drone and banked credits are
 * not, which is the whole of the decision "one more compartment or home".
 *
 * Aboard, how far along the hull is comes from the *ship's* own record rather
 * than the voyage's: a derelict half neutralised is the ship's condition, and
 * the run walks back into it a sortie later with a different drone.
 */
export function goalOf(game: RoomGame): GoalModel {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  const aboard = isTug(game) ? state.online.length : shipState(game).online.length;
  return {
    hull: derelictName(state.spec),
    sortie: voyage.sortie,
    goal: t("charter.name.neutralize"),
    online: aboard,
    of: OBJECTIVE_COUNT,
    worth: state.spec.salePrice,
    keys: keysHeld(game.player),
    held: voyage.loot,
    banked: voyage.credits,
    contracts: contractsOf(game),
  };
}

/**
 * The jobs signed against the hull the drone is on.
 *
 * Where one names a compartment, the compartment is found and carried with it:
 * a contract that says "the med bay" and a board that will not say which
 * hexagon that is leaves the player to walk the ship reading labels. The room
 * is named by *kind*, and a hull has one of each, so this is a lookup and not
 * a guess.
 */
function contractsOf(game: RoomGame): Contract[] {
  const voyage = voyageOf(game);
  const state = derelictAboard(game) ?? currentDerelict(game);
  return voyage.charters.map((charter): Contract => {
    const done = voyage.paid.includes(charter.id);
    const kind = charter.target?.kind;
    const base: Contract = {
      name: charterTag(charter),
      text: charter.text,
      done,
      payout: charter.id === "neutralize" ? state.spec.salePrice : charter.payout,
    };
    if (kind === undefined) return base;
    const room = game.ship.rooms.find((r) => r.kind === kind);
    return {
      ...base,
      room: { kind, name: zoneName(kind), ...(room === undefined ? {} : { id: room.id }) },
    };
  });
}

/**
 * A job already begun, as turns spent out of turns needed.
 *
 * One question to the shared template (`systems/jobs.ts`) rather than one
 * lookup into the ship's own record, which is what this used to be — and which
 * is why a five-turn upload drew nothing on its console while a three-turn
 * splice drew three pips on its reactor. The two are the same mechanic and
 * there is now one place that says so.
 */
function workOn(game: RoomGame, id: number): { work: { done: number; of: number } } | undefined {
  const job = jobOn(game, id);
  return job === undefined ? undefined : { work: { done: job.done, of: job.of } };
}

/**
 * The job the drone is in the middle of, as the panel says it.
 *
 * Every multi-turn action in the game answers here and they all read the same:
 * what is being worked, how far in, and — the part that is the whole reason
 * the panel exists — that walking away loses it. A player who does not know
 * that reads a job broken off as the game taking something from them.
 */
export interface Working {
  /** `Splicing`, `Cutting`, `Uploading` — the job as a thing in progress. */
  name: string;
  done: number;
  of: number;
}

/** What each kind of work is called while it is happening. */
const JOB_NAME: Readonly<Record<string, string>> = {
  splice: "Splicing",
  cut: "Cutting",
  weld: "Welding",
  defuse: "Defusing",
  ram: "Ramming",
  purge: "Purging",
  upload: "Uploading",
};

export function workingOf(game: RoomGame): Working | undefined {
  const job = jobNow(game);
  if (job === undefined) return undefined;
  return { name: JOB_NAME[job.what] ?? "Working", done: job.done, of: job.of };
}

/**
 * Who this drone is: the key everything about its identity is read off.
 *
 * Keyed on how many drones the voyage has *built*, never on how many sorties
 * it has flown. The two are not the same and the difference is a bug I shipped
 * an hour ago: a drone that comes home and goes out again is one machine and
 * two sorties, and undocking is exactly the moment the sortie count changes —
 * so the drone chosen on the dock was not the drone that flew, and it was
 * drawn as a different machine the instant it cast off.
 *
 * None of this is a roll. The rng is the run.
 */
export function whoOf(game: RoomGame): string {
  const voyage = voyageOf(game);
  /* Drones this voyage has put on the rails: one for every one it has lost,
     and one more for the one standing there now. Derived and not stored,
     because a field on the voyage is state the run carries — and a cosmetic
     one would change the fingerprint every recorded replay is checked against
     for a name nobody's ship ever felt. */
  const lost = voyage.state.reduce((n, s) => n + s.deaths.length, 0);
  const built = lost + (voyage.hull === undefined ? 0 : 1);
  return `${String(game.seed)}:${String(built)}:${voyage.hull ?? "none"}`;
}

/** What this drone is called: `NADIA KJ-07`. */
export function nameOfDrone(game: RoomGame): string {
  return droneName(whoOf(game));
}
