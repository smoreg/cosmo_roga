import { hexLayout, isAlive } from "@jamrog/engine";
import type { Entity, RoomGame, RoomId } from "@jamrog/engine";
import { machineName } from "../../content/monsters.js";
import { MODULES, moduleKind, moduleName } from "../../content/modules.js";
import { roomActions } from "../actions.js";
import { doorWays } from "../doorlist.js";
import { hostilesIn, rigOf, wrecksOn } from "../../twist/rig.js";
import { BUCKET_GLYPH, CONTENT_KEYS, ONLINE_GLYPH, bucketName } from "../contents.js";
import { alertState } from "../../systems/alert.js";
import { shipState } from "../../systems/shipstate.js";
import { systemsAboard } from "../../systems/ship.js";
import { keysHeld } from "../../systems/doors.js";
import { currentDerelict, voyageOf } from "../../systems/voyage.js";
import { derelictName } from "../../content/derelicts.js";
import { tugCallsign } from "../../content/hints.js";
import { HULLS, hullName, hullTrait } from "../../content/hulls.js";
import { OBJECTIVE_COUNT, objectiveSpec } from "../../content/objectives.js";
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
function shipThings(game: RoomGame, room: RoomId): Array<{ id: number; glyph: string; name: string }> {
  const out: Array<{ id: number; glyph: string; name: string }> = [];
  for (const wreck of wrecksOn(game.ship, room)) {
    const kind = moduleKind(wreck.kind);
    out.push({
      id: wreck.id,
      glyph: wreck.glyph,
      name: `${wreck.glyph === "X" ? t("word.crate") : t("word.scrap")} ${moduleName(kind.id)}`,
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

  /**
   * Every way through a bulkhead the drone is standing next to.
   *
   * `doorWays` is the engine's own answer and it returns nothing when a door
   * has fewer than two ways, which is the terminal's rule: a sublist of one is
   * not a question. A popover of one is, so the single way is taken off the
   * compartment's list instead — the menu is the only place a door's verbs are
   * offered now that there is no numbered list beside the map.
   */
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
  /**
   * The rack: three hulls, and everything an inspection shows.
   *
   * The whole of each is carried rather than the line the row prints, because
   * the choice a voyage is made of is between these numbers and a player who
   * cannot compare them is choosing on the strength of an adjective.
   */
  hulls: Array<{
    id: string;
    name: string;
    trait: string;
    price: number;
    on: boolean;
    core: number;
    slots: number;
    speed?: number;
    modules: string[];
  }>;
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
      core: hull.core,
      slots: hull.slots,
      ...(hull.speed === undefined ? {} : { speed: hull.speed }),
      modules: hull.modules.map((m) => moduleName(m)),
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
  /* What the compartment is already carrying as an icon. A verb aimed at one
     of those is on the thing itself; a verb aimed at anything else has nowhere
     on the honeycomb to live and belongs here, whatever it is aimed at. The
     point of asking rather than assuming is that nothing can be lost: an
     `act` at a target the board does not draw used to vanish from both. */
  const carried = new Set(hereOf(game).map((t) => Number(t.id.slice(1))));
  const out: Offer[] = [];
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


/**
 * A hull's rack as it comes off the rails, for looking at rather than flying.
 *
 * The rack panel shows the drone that exists; this shows one that does not
 * yet, out of the catalogue rather than out of the game, so a player weighing
 * eight slots against six can see both racks instead of two adjectives. It is
 * a preview and it says so by being a different question: no integrity has
 * been spent on a hull nobody has undocked in.
 */
export function rackOfHull(id: string): { core: number; coreMax: number; slots: RackSlot[] } | undefined {
  const hull = HULLS.find((h) => h.id === id);
  if (hull === undefined) return undefined;
  const slots: RackSlot[] = hull.modules.map((kind) => {
    const full = hull.base?.[kind] ?? MODULES[kind].integrity;
    return { name: moduleName(kind), value: full, max: full };
  });
  while (slots.length < hull.slots) slots.push({});
  return { core: hull.core, coreMax: hull.core, slots };
}

// ------------------------------------------------------------------ the goal

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
  };
}

/**
 * A job already begun, as turns spent out of turns needed.
 *
 * The engine keeps what is *left* — it is what the bots read to know a job
 * moved at all — and a player wants to know how far in they are, so the count
 * is turned round here rather than in the engine. One job at a time is a fact
 * about the ship, not a limitation: `ShipState.work` is a single record
 * because walking away from a splice and starting another abandons the first.
 */
function workOn(game: RoomGame, id: number): { work: { done: number; of: number } } | undefined {
  const work = shipState(game).work;
  if (work === undefined || work.id !== id) return undefined;
  const system = systemsAboard(game).find((s) => s.id === id);
  if (system === undefined) return undefined;
  const spec = objectiveSpec(system.kind);
  const job = spec?.jobs.find((j) => j.tool === work.tool);
  if (job === undefined) return undefined;
  return { work: { done: job.turns - work.left, of: job.turns } };
}
