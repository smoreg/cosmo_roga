import {
  RoomDistance,
  blockedBy,
  exploreTarget,
  type Door,
  type DoorId,
  type Entity,
  type Room,
  type RoomCommand,
  type RoomGame,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import type { ModuleId } from "../content/modules.js";
import { machineName } from "../content/monsters.js";
import { isTug } from "../content/tug.js";
import { doorStateWord } from "../content/words.js";
import { roomName } from "../content/zones.js";
import { t, tId } from "../i18n.js";
import { entityLabel } from "../names.js";
import { alertState } from "../systems/alert.js";
import { keysHeld } from "../systems/doors.js";
import { jammed } from "../systems/jam.js";
import { roomList, type Body, type Crate, type RoomItem, type ShipSystem, type Wreck } from "../systems/populate.js";
import { findSlot, hostilesIn, rigOf, shootTarget, type Rig } from "../twist/rig.js";
import { strikersNear } from "./strikers.js";
import { tag } from "./schematic-input.js";

/**
 * Auto-explore and closing in — the two keys that keep a jam voter from quitting
 * in the second compartment, without taking a single decision away from them.
 *
 * `docs/traditional-checklist.md` calls automation that removes a tactical
 * decision an anti-pattern, and it is right. What makes DCSS's `o` legitimate
 * is not that it walks for you, it is that it stops the instant the situation
 * becomes a question: something in sight, something hurting you, the ship waking
 * up. So the interesting half of this file is the stop list, not the pathing —
 * every step it does take is a step whose answer was already "walk on", and
 * every step it refuses to take is handed back to the player.
 *
 * No DOM and no randomness here: the timer that paces the loop lives in
 * `app.ts`, and every command below is a function of the ship as it stands, so
 * a recorded walk replays exactly like a hand-played one.
 */

/**
 * One decision: the next command, or the reason the run stops.
 *
 * A stop may name a bulkhead, and one kind of stop does: a walk that has run
 * into something shut — travel sent at a compartment, and `o` once it has run
 * out of ship it can simply walk into. The screen answers that by opening that
 * door's own list of ways through it (`ui/appstate.ts`, `stoppedAt`), which is
 * the whole of the owner's second sentence — "двинулся в сторону закрытой —
 * предлагает варианты как вскрывать". Nothing here decides to spend a torch; it
 * only says which door the question is about.
 */
export type AutoResult = { cmd: RoomCommand } | { stop: string; door?: DoorId };

export function isStop(result: AutoResult): result is { stop: string } {
  return "stop" in result;
}

/** Milliseconds between auto-explore steps. UI pacing only; the sim never sees it. */
export const AUTO_DELAY_MS = 40;

/**
 * Which doors a walk may use: the three states a drone simply steps through.
 * Locked and sealed are deliberately out — auto-explore does not spend the
 * cutter, and it does not decide for the player that a bulkhead is worth three
 * loud turns. The airlock is out for the same reason: leaving the ship is not
 * exploring it.
 */
export function passableForPlayer(door: Door): boolean {
  return door.state === "open" || door.state === "closed" || door.state === "broken";
}

/** What the compartment looked like at the previous step: "new" against "still there". */
interface Seen {
  room: RoomId;
  /** Ids of everything lying in that compartment. */
  things: Set<number>;
  /** Rig integrity plus CORE: any blow at all lowers this. */
  durability: number;
  alert: number;
}

export interface Explorer {
  /** One turn of auto-explore, or the reason to hand control back. */
  step(game: RoomGame): AutoResult;
}

/**
 * An explore run. The state it keeps is exactly the "what changed" snapshot —
 * a stop like "there is salvage here" is not a property of the current turn, it
 * is a difference between two of them.
 *
 * The first step takes the snapshot and reports no changes, which is what the
 * player means by pressing `o`: the crate they are already standing over is not
 * news, the machine that walks in next turn is.
 *
 * What it walks towards is three questions in order, and the order is the
 * owner's (docs/tasks/G59-explore-to-decision.md): the nearest compartment
 * plain walking reaches, then the nearest bulkhead standing between the drone
 * and unexplored ship that this rig can actually open, and only then a word.
 * The middle one is the whole point — a key that answers "everything left is
 * behind d3" and then stands still has told the player where the next decision
 * is and left them to walk to it by hand.
 */
export function makeExplorer(): Explorer {
  const watch = makeWatch();
  let walkedBack = false;

  return {
    step(game: RoomGame): AutoResult {
      // The tug is four stations the drone has known since before the run: it
      // has nothing to explore, and pretending otherwise is where 5013 frames
      // of "ship explored" came from (docs/tasks/G55-playtest-findings.md).
      if (isTug(game)) return { stop: t("stop.tug") };

      const interrupt = watch(game);
      if (interrupt) return interrupt;

      const room = game.roomOf(game.player);
      const onwards = exploreTarget(game.ship, room.id, passableForPlayer);
      if (onwards) return { cmd: { kind: "go", door: onwards.id } };

      // Nothing is walkable any more, but something openable may still stand
      // between here and the rest of the ship: walk up to it and hand over the
      // question, which is what the screen turns into that bulkhead's own list
      // of ways through it (`ui/appstate.ts`, `stoppedAt`).
      const gate = nearestGate(game, room.id);
      if (gate?.step) return { cmd: { kind: "go", door: gate.step.id } };
      if (gate) {
        return {
          stop: t("stop.shut", { door: gate.door.label, state: doorStateWord(gate.door.state) }),
          door: gate.door.id,
        };
      }

      // Out of moves. Which of the two things that means is the difference
      // between a sortie that is finished and one that needs a tool, so the
      // line says which, and names the hull it is talking about (G54 §5).
      const left = game.ship.rooms.filter((r) => !r.explored).length;
      if (left > 0) return { stop: t("stop.noFurther", { hull: hullName(game), n: left }) };

      // Nothing unseen left to reach: point the drone at the way out, take a
      // single step towards it, and give the ship back to the player.
      const home = RoomDistance.from(game.ship, [airlockRoom(game.ship)], passableForPlayer);
      const where = t("stop.explored", { hull: hullName(game), back: airlockLine(home.at(room.id)) });
      if (walkedBack) return { stop: where };
      const back = home.nextDoor(room.id, passableForPlayer);
      if (!back) return { stop: where };
      walkedBack = true;
      return { cmd: { kind: "go", door: back.id } };
    },
  };
}

/** A shut bulkhead worth walking to, and the next step of the walk to it. */
interface Gate {
  door: Door;
  /** Undefined when the drone is already standing at that bulkhead. */
  step?: Door;
}

/**
 * The nearest bulkhead that alone stands between the drone and unexplored ship
 * *and* that the rack can open — the second of auto-explore's three questions.
 *
 * `blockedBy` (`rooms/paths.ts`) already knows which doors those are; what this
 * adds is the rig, because a lock nobody aboard can pick is not a destination,
 * it is a wall, and walking three compartments to read four greyed-out lines is
 * worse than being told the sortie is over. Ties go to the lower door id, so a
 * seed walks the same way twice.
 */
function nearestGate(game: RoomGame, here: RoomId): Gate | undefined {
  const ship = game.ship;
  const away = RoomDistance.from(ship, [here], passableForPlayer);
  // Exactly one end of a blocking door is walkable, so the min is that end.
  const reach = (d: Door): number => Math.min(away.at(d.a), away.at(d.b));

  let door: Door | undefined;
  for (const d of blockedBy(ship, here)) {
    if (canBreach(game, d) && (door === undefined || reach(d) < reach(door))) door = d;
  }
  if (door === undefined) return undefined;

  const inside = away.at(door.a) <= away.at(door.b) ? door.a : door.b;
  if (inside === here) return { door };
  const step = RoomDistance.from(ship, [inside], passableForPlayer).nextDoor(here, passableForPlayer);
  return step ? { door, step } : undefined;
}

/**
 * Has this rack anything that opens that bulkhead, right now?
 *
 * The same question `systems/doors.ts` answers for the compartment the drone is
 * standing in (`doorOffers`, `LOCKED_METHODS`), asked about a door several
 * compartments off — which is what lets a walk treat a lock as somewhere to go
 * rather than as the end of the ship. A lock has four answers and a welded seam
 * has one; a rack with none of them is why `o` says the sortie is over.
 */
function canBreach(game: RoomGame, door: Door): boolean {
  const rig = rigOf(game.player);
  const carries = (kind: ModuleId): boolean => rig !== undefined && findSlot(rig, kind) !== null;
  if (door.state === "sealed") return carries("cutter");
  if (door.state !== "locked") return false;
  return carries("cell") || carries("spike") || carries("cutter") || keysHeld(game.player) > 0;
}

/**
 * Which hull the walk is talking about: the callsign the voyage tagged the ship
 * with, or the plain word when a fixture never tagged one.
 *
 * The owner read `Корабль изучен.` standing aboard the tug and had no way to
 * tell which of the two ships on screen it meant (G54 §5). The callsign is the
 * name every other line of the screen already uses for it.
 */
function hullName(game: RoomGame): string {
  return tag(game, "name") ?? t("word.derelict").toUpperCase();
}

/**
 * The stop list, as one function of the run, shared by every walk there is.
 *
 * It is the interesting half of this file (see the header), so there is exactly
 * one copy of it: a machine in sight, a blow taken, the ship waking up, or
 * something lying in the compartment the walk has just entered. A second walk
 * with its own nearly-identical list would be two definitions of "something
 * happened", and the one that drifted would be the one nobody was reading.
 *
 * The closure is the snapshot: half of these are differences between two turns
 * rather than facts about one, and the first call only records — the crate the
 * drone is already standing over is not news.
 */
function makeWatch(): (game: RoomGame) => { stop: string } | undefined {
  let before: Seen | undefined;

  return (game: RoomGame) => {
    if (game.isOver()) return { stop: t("stop.over") };

    const machine = nearestVisible(game);
    if (machine) {
      return {
        stop: t("stop.machine", {
          machine: entityLabel(game, machine),
          room: roomName(game.roomOf(machine)),
        }),
      };
    }

    const room = game.roomOf(game.player);
    const things = thingsIn(room);
    const now: Seen = {
      room: room.id,
      things: new Set(things.map((t) => t.id)),
      durability: durability(game),
      alert: alertState(game).level,
    };
    const last = before;
    before = now;
    if (!last) return undefined;

    if (now.durability < last.durability) return { stop: t("stop.hit") };
    if (now.alert > last.alert) return { stop: t("stop.alert") };
    // A compartment the walk has just entered was never snapshotted, so
    // everything in it is new — which is the case the stop exists for.
    const fresh = things.find((t) => last.room !== room.id || !last.things.has(t.id));
    return fresh ? { stop: t("stop.thing", { thing: fresh.noun }) } : undefined;
  };
}

/**
 * Travel: walk to a compartment the player named, and stop at the first thing
 * worth a decision (docs/tasks/G48-travel-to-a-room.md).
 *
 * The owner's rule, word for word: «лучше на движение выбирается любая точка и
 * ты идёшь туда, пока не упрёшься во врага или закрытую дверь». It is DCSS's
 * travel command and it earns its place the same way `o` does — every step it
 * takes is a step whose answer was already "walk on", and it hands the ship
 * back the moment that stops being true. Nothing is free: each step is an
 * ordinary `go`, the world moves between them, and a route that has become
 * impossible mid-walk simply stops.
 *
 * Two ways it can end that `o` has no equivalent for: arriving, and running
 * into something shut. The second names the door, and the screen answers by
 * opening that bulkhead's own list of ways through it. Opening it does *not*
 * resume the walk — three turns with a torch is long enough for the ship to
 * have become a different ship, and a drone that then wandered on by itself
 * would be the automation the genre checklist forbids.
 */
export function makeTraveller(goal: RoomId): Explorer {
  const watch = makeWatch();

  return {
    step(game: RoomGame): AutoResult {
      const interrupt = watch(game);
      if (interrupt) return interrupt;

      const room = game.roomOf(game.player);
      if (room.id === goal) return { stop: t("stop.arrived", { room: roomName(room) }) };

      const route = travelRoute(game.ship, room.id, goal);
      const next = route?.[0];
      if (!next) return { stop: t("stop.noWay") };
      if (!passableForPlayer(next)) {
        return {
          stop: t("stop.shut", { door: next.label, state: doorStateWord(next.state) }),
          door: next.id,
        };
      }
      return { cmd: { kind: "go", door: next.id } };
    },
  };
}

/**
 * Doors a walk may use once the drone is willing to open what is in the way:
 * everything but the airlock, because leaving the ship is not moving about
 * inside it.
 *
 * This is what makes a locked bulkhead a *destination* rather than a wall. The
 * route through it is planned, walked up to and then handed to the player as a
 * question — which is the difference between "STORAGE is behind d3 (locked)"
 * and a list that simply does not mention STORAGE.
 */
export function breachable(door: Door): boolean {
  return door.state !== "airlock";
}

/**
 * The doors between here and there, in order, or undefined when there is no
 * route at all.
 *
 * A clear route wins whenever one exists, even a longer one: a player who can
 * walk round a lock would rather walk than spend a torch, and the walk cannot
 * ask. Only when plain walking cannot reach the compartment does the route go
 * through something shut — and then the first shut door on it is the thing the
 * list names and the walk stops at.
 */
export function travelRoute(ship: Ship, from: RoomId, goal: RoomId): Door[] | undefined {
  const clear = RoomDistance.from(ship, [goal], passableForPlayer);
  const walkable = Number.isFinite(clear.at(from));
  const map = walkable ? clear : RoomDistance.from(ship, [goal], breachable);
  const filter = walkable ? passableForPlayer : breachable;
  if (!Number.isFinite(map.at(from))) return undefined;

  const out: Door[] = [];
  let at = from;
  // The ship is finite and every step strictly descends the map, so this ends;
  // the bound is belt and braces against a map and a filter that disagree.
  while (at !== goal && out.length <= ship.size) {
    const door = map.nextDoor(at, filter);
    if (!door) return undefined;
    out.push(door);
    at = ship.other(door, at);
  }
  return at === goal ? out : undefined;
}

/**
 * One turn of closing in — the owner's rule, word for word (design-doc.md,
 * "`Tab` — сблизиться и ударить"): shoot if the shot is there, hit what is in
 * the compartment, otherwise take one step towards the nearest machine you know
 * of. Never "fight until one of us dies" — that is the version that decides the
 * fight for the player, and it is the version the checklist forbids.
 *
 * `melee` is shift+tab, and it is a second key rather than a mode because the
 * choice it makes is *which module to expose*: a shot risks the EMITTER, a swing
 * risks the CUTTER, a step risks the THRUSTERS. A rack with no melee weapon at
 * all — GHOST — has nothing to choose between, so it shoots either way.
 *
 * Every branch has to hand back a command the game will accept. One press is
 * one turn, and a press that cannot be a turn has to say so — a key that keeps
 * answering with a refusal is a key the player has lost, and with a jammer
 * standing in the compartment it would be lost for exactly as long as the one
 * machine that caused it is alive.
 */
export function engage(game: RoomGame, mode: "best" | "melee" = "best"): AutoResult {
  if (game.isOver()) return { stop: t("stop.over") };

  const here = game.roomOf(game.player).id;
  const rig = rigOf(game.player);
  // A jammer in the room switches the active modules off before the turn is
  // spent (`systems/jam.ts`), the EMITTER among them, so the shot is not on
  // offer — closing in is. Which is also the right answer: the jammer is in
  // this compartment, and hitting it is what turns the rack back on.
  const emitter = rig !== undefined && findSlot(rig, "emitter") !== null && !jammed(game);
  if (emitter && (mode === "best" || !hasMelee(rig!)) && shootTarget(game)) {
    return { cmd: { kind: "act", verb: "shoot" } };
  }

  const inRoom = hostilesIn(game, here);
  if (inRoom[0]) return { cmd: { kind: "attack", target: inRoom[0].id } };

  const known = knownMachineRooms(game, here);
  if (known.length === 0) return { stop: t("stop.noTarget") };

  const towards = RoomDistance.from(game.ship, known, passableForPlayer).nextDoor(here, passableForPlayer);
  return towards ? { cmd: { kind: "go", door: towards.id } } : { stop: t("stop.noWay") };
}

// ------------------------------------------------------------------ the ship

/**
 * Machines the drone can see, the one it would meet first at the head of the
 * list. The id tie-break is what keeps two machines at equal range from making
 * the same seed play out two ways.
 */
function nearestVisible(game: RoomGame): Entity | undefined {
  const here = game.roomOf(game.player).id;
  const rank = (e: Entity): number => (e.room === here ? 0 : 1);
  return [...game.visibleMonsters()].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0];
}

/**
 * Compartments where the drone knows a machine stands: the ones it can see into
 * right now, and the ones a sensor pulse left a snapshot of. The snapshot is a
 * memory and may be stale — that is the model, not a bug (design-doc.md, "Что
 * видит игрок"), and one press of `Tab` is one turn, so a ghost costs a step.
 */
function knownMachineRooms(game: RoomGame, here: RoomId): RoomId[] {
  const rooms = new Set<RoomId>();
  for (const m of game.visibleMonsters()) {
    if (m.room !== undefined && m.room !== here) rooms.add(m.room);
  }
  // And whatever shot the drone through a shut door this turn. Without this,
  // a drone whose SCANNER has burned answers every press of Tab with `no
  // targets in sight` while an enforcer takes it apart from the next
  // compartment (`strikersNear` in ui/panel.ts). Being shot tells you where
  // from; the key has to be able to act on that.
  for (const { room } of strikersNear(game, here)) rooms.add(room);
  for (const room of game.ship.rooms) {
    if (room.id !== here && snapshotHasMachine(room)) rooms.add(room.id);
  }
  return [...rooms].sort((a, b) => a - b);
}

/** Glyphs a pulse snapshot uses for things rather than for machines. */
const SALVAGE_GLYPHS = new Set(["%", "X"]);

/** The pocket round-trips through a save file, so nothing in it may be trusted. */
function snapshotHasMachine(room: Room): boolean {
  const raw = room.data.snapshot;
  if (typeof raw !== "string") return false;
  return raw.split(" ").some((glyph) => glyph.length > 0 && !SALVAGE_GLYPHS.has(glyph));
}

/** The compartment the airlock hangs off — where a finished sortie walks back to. */
export function airlockRoom(ship: Ship): RoomId {
  const airlock = ship.airlock();
  return airlock ? airlock.a : ship.entry;
}

/** How the walk reports the way out. A ship with no route left says so plainly. */
function airlockLine(doors: number): string {
  if (!Number.isFinite(doors)) return t("stop.airlock.none");
  if (doors === 0) return t("stop.airlock.here");
  return t("stop.airlock.away", { n: doors });
}

/** One thing lying in a compartment: its id, and what the log calls it. */
interface Thing {
  id: number;
  noun: string;
}

/**
 * Everything a compartment holds besides its doors — wreckage, bodies, cargo,
 * a charter's errand, one of the ship's own systems (design-doc.md,
 * "Автоисследование `o`"). Read through `roomList`, which never writes an empty
 * bucket into a room: a walk that looks at the ship must not change it.
 */
function thingsIn(room: Room): Thing[] {
  const out: Thing[] = [];
  for (const w of roomList<Wreck>(room, "wrecks")) {
    out.push({ id: w.id, noun: w.glyph === "X" ? t("thing.partsCrate") : t("thing.scrap") });
  }
  for (const b of roomList<Body>(room, "bodies")) {
    out.push({ id: b.id, noun: t("thing.body") });
  }
  for (const c of roomList<Crate>(room, "crates")) {
    out.push({ id: c.id, noun: c.kind === "contraband" ? t("thing.contraband") : t("thing.cargo") });
  }
  for (const i of roomList<RoomItem>(room, "items")) {
    out.push({ id: i.id, noun: i.kind === "console" ? t("thing.console") : t("thing.package") });
  }
  for (const s of roomList<ShipSystem>(room, "systems")) {
    out.push({ id: s.id, noun: tId("thing.system", s.kind, s.kind) });
  }
  return out;
}

/** A rack that can swing at something. Everything else rams, and GHOST only rams. */
function hasMelee(rig: Rig): boolean {
  return findSlot(rig, "cutter") !== null || findSlot(rig, "laser") !== null;
}

/**
 * Everything a blow can take: the rack plus CORE. One number, because
 * auto-explore does not care what was hit, only that something was.
 */
function durability(game: RoomGame): number {
  const rig = rigOf(game.player);
  const slots = rig ? rig.slots.reduce((sum, s) => sum + (s?.integrity ?? 0), 0) : 0;
  return slots + game.player.hp;
}
