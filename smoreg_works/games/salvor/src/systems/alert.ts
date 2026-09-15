import {
  RoomDistance,
  Rng,
  dealDamage,
  isAlive,
  rememberRoom,
  spawnMonsterIn,
  type Door,
  type DoorFilter,
  type Entity,
  type MonsterKind,
  type Room,
  type RoomGame,
  type RoomId,
  type Ship,
  type System,
} from "@jamrog/engine";
import { classOfShip, specOfShip } from "../content/derelicts.js";
import type { Key } from "../content/i18n/keys.js";
import { CROWD, ENFORCER, MAX_MACHINES, machineName } from "../content/monsters.js";
import { OBJECTIVE_COUNT } from "../content/objectives.js";
import { PALETTE } from "../content/palette.js";
import { TUG_ID, isTug } from "../content/tug.js";
import { TUTORIAL_ID } from "../content/tutorial.js";
import { roomName } from "../content/zones.js";
import { t } from "../i18n.js";
import { blamedOn, hostilesIn } from "../twist/rig.js";
import { canSeeDrone } from "./sight.js";

/**
 * The ship's alert — the run's time pressure, and the reason a drone cannot
 * simply out-wait everything aboard.
 *
 * The gauge belongs to the *ship*, not to the drone (design-doc.md, "Тревога,
 * охотники и как спрятаться"): it lives in `currentShip.data`, so it survives
 * walking back to the tug, and the derelict is still looking for you when you
 * come back through the airlock. Time pushes it up and so does noise; standing
 * quiet — or standing in cover — pushes it back down.
 *
 * What the gauge *does* is a ladder of ten rungs (`LADDER` below), and every
 * rung is climbed once on the way up: the ship notices, listens, posts
 * machines where you have walked, sends one after you and starts shutting
 * doors, sends its hunter, locks the doors and hardens what it wakes, then
 * starts blowing its own compartments up on a visible fuse — and at the very
 * top it blows itself up, drone and all (docs/tasks/G90-smoreg-wave.md, A).
 * Neutralising the ship — all three systems up — switches the whole process
 * off (`standDown`, called from `systems/ship.ts`).
 *
 * A system, not the twist: it hooks the same turn cycle but knows nothing about
 * modules, and the rig knows nothing about it.
 */

/** Top of the gauge. */
export const MAX_LEVEL = 10;
/**
 * Turns aboard between time-driven raises. Half what the five-rung ladder ran
 * on: the ladder is twice as tall and the sorties that reached its old top
 * should reach the charges (`CHARGE_LEVEL`) on the new one. The run's first
 * derelict is the one learned on (`isFirstShip`), and keeps the slow clock.
 */
const PERIOD_FIRST_SHIP = 40;
export const PERIOD = 20;
/**
 * A compartment this loud anywhere aboard raises the alert. The engine rates a
 * fight at 9 and a step through a door at 3 (`rooms/game.ts`), so fighting is
 * heard and walking is not; the game's own loud verbs call `makeNoise`
 * themselves.
 */
const NOISE_THRESHOLD = 8;
/** ...but no more often than this, or one fight would fill the gauge. */
const NOISE_COOLDOWN = 5;

/** A turn is quiet when the drone's own compartment is under this. */
const DRONE_HEARD_AT = 5;
/** Quiet turns that talk the ship down one level — in the open, and in cover. */
const QUIET_TURNS = 8;
const QUIET_TURNS_HIDDEN = 4;

/** Nothing is ever woken this close to the drone: two doors is the ambush line. */
const MIN_SPAWN_DOORS = 2;
/**
 * The level at which the ship sends its hunter: the seventh rung, which on the
 * ten-rung ladder is where the fourth of five stood. Raising a system costs
 * `ALERT_PER_SYSTEM` rungs (`systems/ship.ts`), so a calm hull meets the
 * ENFORCER on its second system only if it has been loud as well.
 */
export const HUNTER_LEVEL = 7;
/** From `LOCK_LEVEL` the hunter is replaced this often. */
const HUNTER_PERIOD = 15;
/** How often a machine that walked the ship alone left a closed door open behind it. */
const TRAIL_CHANCE = 0.5;

/** From this level the ship shuts one door behind the drone every `DOOR_PERIOD` turns. */
const DOOR_LEVEL = 5;
export const DOOR_PERIOD = 10;
/** From this level the door it shuts is locked rather than closed. */
export const LOCK_LEVEL = 8;

/**
 * The charges: from `CHARGE_LEVEL` the ship sets a charge in one of its own
 * compartments every `CHARGE_PERIOD` turns, and each one blows `FUSE_TURNS`
 * turns after it is set, counting down on the panel, on the map and in the
 * log. What is in the compartment when it goes is gone; the drone, if it
 * stayed, takes `BLAST_DAMAGE` through the rack.
 */
export const CHARGE_LEVEL = 9;
export const CHARGE_PERIOD = 8;
export const FUSE_TURNS = 5;
export const BLAST_DAMAGE = 6;

/**
 * The detonation: `ARM_TURNS` after the charges start the ship arms itself —
 * the top rung, which no provocation reaches (`raiseAlert`) — and the top of
 * the gauge starts a `DETONATION_TURNS` countdown; at zero the hull is gone
 * with everything aboard it, the drone included, and the voyage moves on
 * without it (`systems/voyage.ts`, `loseDrone`). Two periods of charges
 * before the arming rather than one: measured over 200 careful voyages, one
 * period left the jam's three wins with nothing under them.
 */
export const ARM_TURNS = 2 * PERIOD;
export const DETONATION_TURNS = 3;

/**
 * From this level every machine the ladder wakes is tougher: `hp` and `hpMax`
 * both gain `level − STRONGER_FROM + 1`. Number and strength are the two axes
 * the owner named, and this is the second one.
 */
const STRONGER_FROM = LOCK_LEVEL;

/**
 * How far the gauge falls while nobody is aboard: four steps for a drone that
 * cycled out through the airlock, six for a drone the ship took apart — a
 * dead drone is a ship that has stopped hearing anything — never below the
 * floor its raised systems hold it at. Twice the two and three of the
 * five-rung ladder, for the same reason the clocks are half. The muster that
 * meets the next drone is sized by the level *before* the drop
 * (`shipAnswers`), which is where "по возвращению там будет прилично дронов"
 * lives.
 */
const LEAVE_DROP = 4;
const DEATH_DROP = 6;

/**
 * Colours come from `content/palette.ts`, not `ui/theme.ts`: rules never
 * depend on the renderer, and the palette is data either way.
 */
const WARN_FG = PALETTE.warn;
const BAD_FG = PALETTE.bad;
/** The gauge turns warn at this level and bad from `CHARGE_LEVEL`. */
const WARN_LEVEL = DOOR_LEVEL;

/**
 * Set on a compartment a charge has blown. The UI reads exactly this string
 * (`ui/schematic-input.ts`), and its doors are sealed with it, so nothing
 * walks in bare-handed and every path the game computes goes round it.
 */
export const BLOWN = "blown";

// ------------------------------------------------------------------ the ladder

/**
 * One rung of the ladder: the word the panel shows for the level, and what the
 * ship does the turn it gets there.
 *
 * `posted` machines are put down where the drone has walked and given no
 * orders — they are waiting where it has to walk, which is the whole of the
 * threat, exactly as the muster between sorties works. `sent` machines are
 * told which compartment the drone is in. `hunter` is the ENFORCER, and there
 * is never more than one of those aboard.
 */
interface Rung {
  word: Key;
  posted: number;
  sent: number;
  hunter: boolean;
}

/**
 * Data, not a state machine. The first two rungs buy nothing but the word;
 * the doors start shutting at `DOOR_LEVEL`, locking at `LOCK_LEVEL`, the
 * charges at `CHARGE_LEVEL` and the detonation at `MAX_LEVEL` — those are
 * clocks rather than one-off answers, so they live in `afterPlayerTurn` and
 * not here. None of the woken machines come on the run's first derelict
 * (`climb`): there the ladder is the word, the doors and the hunter.
 */
const LADDER: Readonly<Record<number, Rung>> = {
  1: { word: "alert.noticed", posted: 0, sent: 0, hunter: false },
  2: { word: "alert.searching", posted: 0, sent: 0, hunter: false },
  3: { word: "alert.post", posted: 1, sent: 0, hunter: false },
  4: { word: "alert.pickets", posted: 1, sent: 0, hunter: false },
  5: { word: "alert.hunting", posted: 0, sent: 1, hunter: false },
  6: { word: "alert.pack", posted: 0, sent: 1, hunter: false },
  7: { word: "alert.hunter", posted: 0, sent: 0, hunter: true },
  8: { word: "alert.lockdown", posted: 0, sent: 0, hunter: true },
  9: { word: "alert.scuttle", posted: 0, sent: 0, hunter: true },
  10: { word: "alert.detonation", posted: 0, sent: 0, hunter: true },
};

/** The rung's word, for the corner of the map and the tug's board. */
export function alertWord(level: number): Key | undefined {
  return LADDER[level]?.word;
}

// ------------------------------------------------------------------- the state

/** A charge set in a compartment: where, and the `turnsAboard` it blows at. */
export interface Fuse {
  room: RoomId;
  at: number;
}

export interface AlertState {
  /** 0..MAX_LEVEL. Each step up is a rung of the ladder. */
  level: number;
  /** Player turns spent aboard this ship, across every sortie. */
  turnsAboard: number;
  /** `turnsAboard` of the last noise-driven raise, for the cooldown. */
  lastNoiseBump: number;
  /** Consecutive turns of neither noise nor being seen. */
  quietTurns: number;
  /** `turnsAboard` of the last hunter dispatched. */
  lastHunter: number;
  /** How many times the alert has rolled for this ship. See `alertRng`. */
  rolls: number;
  /** `turnsAboard` of the last door the ship shut on the drone. */
  lastDoor: number;
  /** `turnsAboard` of the last charge set. */
  lastCharge: number;
  /** Charges set and not yet blown. */
  fuses: Fuse[];
  /** `turnsAboard` at which the ship arms itself (rung ten); −1 while it is not counting. */
  armAt: number;
  /** `turnsAboard` at which the ship blows up; −1 while the countdown is not running. */
  detonateAt: number;
  /** The ship blew up. Read by the voyage to take the hull off the itinerary. */
  detonated: boolean;
  /** Neutralised: the gauge is off, and nothing below moves it again. */
  frozen: boolean;
  /** A drone died aboard since the last entry: the next entry drops further. */
  lostDrone: boolean;
  /** Sorties during which the gauge reached the charges, and the visit it last did. */
  peaks: number;
  peakVisit: number;
  /** Compartments blown over the ship's life, and drones a blast killed. */
  blasts: number;
  blastDeaths: number;
}

/**
 * The gauge of the ship the drone is standing on.
 *
 * State lives in the ship's own pocket rather than in a module variable or on
 * the player: a module variable would survive a `new RoomGame` and break
 * replay, and the player carries between derelicts, which is exactly what the
 * alert must not do.
 */
export function alertState(game: RoomGame): AlertState {
  const data = game.currentShip.data;
  const existing = data.alert;
  if (isState(existing)) return complete(existing);
  const fresh = freshState();
  data.alert = fresh;
  return fresh;
}

/** The pocket round-trips through a save file, so nothing in it may be trusted. */
function isState(raw: unknown): raw is AlertState {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Partial<AlertState>;
  return (
    typeof s.level === "number" &&
    typeof s.turnsAboard === "number" &&
    typeof s.lastNoiseBump === "number" &&
    typeof s.quietTurns === "number" &&
    typeof s.lastHunter === "number" &&
    typeof s.rolls === "number"
  );
}

/**
 * A record written by an earlier build has the six numbers above and not all
 * of the rest. It is still that ship's gauge; the missing fields are filled
 * with what a fresh record would hold rather than thrown away with the level,
 * so a save from the day before loads with the same ship in it. A level off
 * the five-rung ladder is clamped, not scaled: an old save's ship is at most
 * five of ten, which is calmer than it was, and nobody loads a save to be
 * blown up by it.
 */
function complete(st: AlertState): AlertState {
  const s = st as Partial<AlertState> & AlertState;
  const fresh = freshState();
  if (typeof s.lastDoor !== "number") s.lastDoor = fresh.lastDoor;
  if (typeof s.lastCharge !== "number") s.lastCharge = fresh.lastCharge;
  if (!Array.isArray(s.fuses)) s.fuses = fresh.fuses;
  if (typeof s.armAt !== "number") s.armAt = fresh.armAt;
  if (typeof s.detonateAt !== "number") s.detonateAt = fresh.detonateAt;
  if (typeof s.detonated !== "boolean") s.detonated = fresh.detonated;
  if (typeof s.frozen !== "boolean") s.frozen = fresh.frozen;
  if (typeof s.lostDrone !== "boolean") s.lostDrone = fresh.lostDrone;
  if (typeof s.peaks !== "number") s.peaks = fresh.peaks;
  if (typeof s.peakVisit !== "number") s.peakVisit = fresh.peakVisit;
  if (typeof s.blasts !== "number") s.blasts = fresh.blasts;
  if (typeof s.blastDeaths !== "number") s.blastDeaths = fresh.blastDeaths;
  s.level = Math.min(MAX_LEVEL, Math.max(0, s.level));
  return s;
}

function freshState(): AlertState {
  // Both cooldowns start already expired, so the first loud turn aboard counts.
  return {
    level: 0,
    turnsAboard: 0,
    lastNoiseBump: -NOISE_COOLDOWN,
    quietTurns: 0,
    lastHunter: -HUNTER_PERIOD,
    rolls: 0,
    lastDoor: 0,
    lastCharge: 0,
    fuses: [],
    armAt: -1,
    detonateAt: -1,
    detonated: false,
    frozen: false,
    lostDrone: false,
    peaks: 0,
    peakVisit: 0,
    blasts: 0,
    blastDeaths: 0,
  };
}

/**
 * One stream of randomness per dispatch, forked off the ship's own seed rather
 * than drawn from `game.rng`.
 *
 * Replayable either way — the counter is part of the ship's state and comes
 * back out of the store with it — but only this way is the alert *orthogonal*:
 * a system that spends the run's stream shifts every roll made after it, so
 * switching the alert on would silently re-roll the rest of the game, and every
 * run recorded or balance number measured without it would stop meaning
 * anything. The engine puts `scheduleSeed` on a stored ship for exactly this.
 */
function alertRng(game: RoomGame): Rng {
  const st = alertState(game);
  return new Rng(game.currentShip.scheduleSeed).fork(st.rolls++);
}

// ------------------------------------------------------------------- climbing

/**
 * One step up the gauge. Exported because the alert is also something the game
 * provokes directly — a ship system brought online, a bulkhead cut open — not
 * only something time does.
 *
 * Every level climbed is a rung of `LADDER` executed exactly once, on the way
 * up and never on the way down or on a raise at the top: a ship already at
 * the top that is provoked again answers with nothing new — its clocks are
 * already running. Nothing at all moves a neutralised ship (`standDown`).
 *
 * The top rung is time's alone. A provoked raise — noise, a system brought
 * up, a mine — stops at `CHARGE_LEVEL`: a ship that has started blowing its
 * own compartments up has stopped listening, and what ends it is the clock,
 * `ARM_TURNS` on. So the charges are always two full periods of visible
 * warning before the countdown, and a drone that brings a system up on a
 * scuttling ship is not blown up for its trouble. Only the clock passes
 * `byTime`; measured, the alternative took the drone off two of every three
 * sorties that reached the charges.
 */
export function raiseAlert(game: RoomGame, steps = 1, byTime = false): void {
  const st = alertState(game);
  if (neutralised(game, st)) return;
  const top = byTime ? MAX_LEVEL : CHARGE_LEVEL;
  for (let i = 0; i < steps; i++) {
    // The ship just noticed something: whatever silence had been banked is gone.
    st.quietTurns = 0;
    if (st.level >= top) continue;
    st.level++;
    climb(game, st, st.level);
  }
}

/** The ship's answer to arriving at `level`, once. */
function climb(game: RoomGame, st: AlertState, level: number): void {
  const rung = LADDER[level];
  if (!rung) return;

  game.log.add(
    t("log.alert.up", { stage: t(rung.word) }),
    game.schedule.time,
    level >= WARN_LEVEL ? "bad" : "warn",
    "log.alert.up",
  );

  // The clocks that start on a rung rather than on a turn: the doors start
  // shutting `DOOR_PERIOD` turns from now, the first charge is set at once and
  // the next one `CHARGE_PERIOD` turns on, and the detonation starts counting.
  if (level === DOOR_LEVEL) st.lastDoor = st.turnsAboard;
  if (level === CHARGE_LEVEL) {
    const visit = game.currentShip.visits;
    if (st.peakVisit !== visit) {
      st.peakVisit = visit;
      st.peaks++;
    }
    st.lastCharge = st.turnsAboard;
    st.armAt = st.turnsAboard + ARM_TURNS;
    setCharge(game, st);
  }
  if (level === MAX_LEVEL) {
    st.detonateAt = st.turnsAboard + DETONATION_TURNS;
    game.log.add(
      t("log.alert.detonation", { n: DETONATION_TURNS }),
      game.schedule.time,
      "bad",
      "log.alert.detonation",
    );
  }

  // The first hull wakes nothing extra: its ladder is doors and the hunter —
  // and on the training hull not even the hunter.
  if (rung.posted + rung.sent > 0 && !isFirstShip(game)) {
    const rng = alertRng(game);
    for (let i = 0; i < rung.posted; i++) wake(game, rng, level, false);
    for (let i = 0; i < rung.sent; i++) wake(game, rng, level, true);
  }
  if (rung.hunter && !hunterAboard(game) && !isTutorialHull(game)) sendEnforcer(game, level);
}

/**
 * One machine of the compartment's own depth band, put down where the drone
 * has walked. `sent` gives it the drone's compartment as a standing order;
 * without one it is posted, and waits.
 */
function wake(game: RoomGame, rng: Rng, level: number, sent: boolean): void {
  const room = pickSpawnRoom(game, rng, false);
  if (room === undefined) return;
  const kind = pickKind(rng, game.content.monstersForDepth(game.ship.roomAt(room).depth));
  if (!kind) return;

  const machine = spawnMonsterIn(kind, room);
  harden(machine, level);
  notePost(machine);
  // Not noise: a sound made here would settle into the field next turn and trip
  // the alert's own noise rule, so the gauge would keep raising itself.
  if (sent) rememberRoom(machine, game.roomOf(game.player).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  game.log.add(
    t("log.alert.wake", { room: roomName(game.ship.roomAt(room)) }),
    game.schedule.time,
    "bad",
    "log.alert.wake",
  );
}

/** The strength axis: a machine woken high on the ladder carries more. */
function harden(machine: Entity, level: number): void {
  const bonus = Math.max(0, level - STRONGER_FROM + 1);
  machine.hp += bonus;
  machine.hpMax += bonus;
}

/** Is the ship's one hunter out there right now? */
export function hunterAboard(game: RoomGame): boolean {
  return game.entities.some((e) => isAlive(e) && e.name === ENFORCER.name);
}

/**
 * The ship's hunter: one, and never a second one.
 *
 * Distance is what makes the alert a clock rather than an ambush; the standing
 * order is what makes it arrive. Without one the hunter would see nothing on
 * the turn it wakes — a machine sees one compartment, and it starts at least
 * two away — and simply stand where it was put.
 */
function sendEnforcer(game: RoomGame, level: number): void {
  const room = pickSpawnRoom(game, alertRng(game), ENFORCER.breacher === true);
  if (room === undefined) return;

  const hunter = dispatchTo(game, ENFORCER, room);
  harden(hunter, level);
  alertState(game).lastHunter = alertState(game).turnsAboard;
  game.log.add(
    t("log.alert.hunter", {
      hunter: machineName(ENFORCER.name).toUpperCase(),
      room: roomName(game.ship.roomAt(room)),
    }),
    game.schedule.time,
    "bad",
    "log.alert.hunter",
  );
}

function dispatchTo(game: RoomGame, kind: MonsterKind, room: RoomId): Entity {
  const machine = spawnMonsterIn(kind, room);
  notePost(machine);
  rememberRoom(machine, game.roomOf(game.player).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  return machine;
}

/**
 * Where the ship puts something it has just woken: far enough to be a clock,
 * and by choice somewhere the drone has already walked, so what arrives comes
 * down a corridor it recognises instead of out of unexplored ship. Never a
 * compartment that has been blown: there is nothing left in it to stand on.
 */
function pickSpawnRoom(game: RoomGame, rng: Rng, breacher: boolean): RoomId | undefined {
  const rooms = roomsAtLeast(game.ship, game.roomOf(game.player).id, MIN_SPAWN_DOORS, breacher).filter(
    (r) => !crowded(game, r) && !isBlown(game.ship.roomAt(r)),
  );
  if (rooms.length === 0) return undefined;
  const explored = rooms.filter((r) => game.ship.roomAt(r).explored);
  return rng.pick(explored.length > 0 ? explored : rooms);
}

/**
 * Is this compartment as full as one gets? `CROWD` is the ceiling on every
 * way a machine arrives — woken, mustered, dispatched, or walking in — so a
 * fight is a doorway and not a pile (docs/tasks/G83-anonymous-blows.md, 4).
 */
function crowded(game: RoomGame, room: RoomId): boolean {
  return hostilesIn(game, room).length >= CROWD;
}

/**
 * A machine that has just walked into a full compartment waits at the door
 * instead: back where it came from, its turn spent. The engine has no notion
 * of a compartment's capacity and its pathing needs none — the fourth machine
 * still *goes* where it is pointed, it just does not get in until one of the
 * three has come out, which is the corridor fight this rule exists for.
 *
 * `POST` is where the machine stood before its turn, stamped on every hostile
 * at the top of each round and again after each of its own turns, so a fast
 * machine's second move is judged from where its first one left it.
 */
const POST = "post";

function stampPosts(game: RoomGame): void {
  for (const e of game.entities) {
    if (e.id !== game.player.id && e.faction !== game.player.faction) notePost(e);
  }
}

/**
 * Where a machine stands right now, written down for `holdAtTheDoor`.
 *
 * Every place a machine is put onto the ship calls this the moment it is —
 * the ladder and the muster here, the bloom's hatch, the ghost's rise, the
 * rival's boarding, the deck's own placing — because a machine born after
 * this round's stamp and moving in the same round has no "where from", and
 * a fourth machine with no where-from walked straight into a full
 * compartment on a live run (seed 70, turn 352: the hunter, dispatched in
 * `afterPlayerTurn` after the stamp, acting before the next one).
 */
export function notePost(machine: Entity): void {
  (machine.data ??= {})[POST] = machine.room;
}

function holdAtTheDoor(game: RoomGame, actor: Entity): void {
  const was = actor.data?.[POST];
  const now = actor.room;
  if (typeof was === "number" && now !== undefined && was !== now && isAlive(actor)) {
    if (hostilesIn(game, now).length > CROWD) actor.room = was;
  }
  notePost(actor);
}

/**
 * Compartments at least `doors` doors from `from`, by this walker's own rules —
 * so a patrol is never posted behind a bulkhead it cannot open, and a breacher
 * may be.
 */
function roomsAtLeast(ship: Ship, from: RoomId, doors: number, breacher: boolean): RoomId[] {
  const map = RoomDistance.from(ship, [from], walkFilter(ship, breacher));
  return ship.rooms.filter((r) => Number.isFinite(map.at(r.id)) && map.at(r.id) >= doors).map((r) => r.id);
}

/** How a machine walks: closed doors yield, locked and sealed ones need a cutter. */
function walkFilter(ship: Ship, breacher: boolean): DoorFilter {
  return (d) => ship.passable(d, { breacher });
}

function pickKind(rng: Rng, kinds: readonly MonsterKind[]): MonsterKind | undefined {
  if (kinds.length === 0) return undefined;
  const table: Record<string, number> = {};
  for (const k of kinds) table[k.id] = k.weight;
  const id = rng.weighted(table);
  return kinds.find((k) => k.id === id);
}

/** Did anything loud happen this turn, anywhere aboard? */
function loudAnywhere(game: RoomGame): boolean {
  for (const strength of game.noise.values()) {
    if (strength >= NOISE_THRESHOLD) return true;
  }
  return false;
}

/**
 * A quiet turn: nothing the drone did was heard where it stands, and nothing
 * aboard is looking at it. The second half is the BAFFLE's whole point — the
 * module does not make the ship calmer, it makes the machine in the next
 * compartment stop counting as a witness.
 */
function quietTurn(game: RoomGame): boolean {
  const here = game.roomOf(game.player).id;
  if ((game.noise.get(here) ?? 0) >= DRONE_HEARD_AT) return false;
  return !game.entities.some(
    (e) => e.id !== game.player.id && e.faction !== game.player.faction && canSeeDrone(game, e),
  );
}

/** From `LOCK_LEVEL`: everything aboard is told where you were. */
function pointEveryoneAtTheDrone(game: RoomGame): void {
  const here = game.roomOf(game.player).id;
  for (const e of game.entities) {
    if (e.id === game.player.id || !isAlive(e) || e.faction === game.player.faction) continue;
    rememberRoom(e, here);
  }
}

// ------------------------------------------------------------------ the doors

/**
 * The ship shuts a door behind the drone: an open one is closed, and from
 * `LOCK_LEVEL` an open or closed one is locked — with no key aboard for it, so
 * it is a CELL, a SPIKE, a torch or a card the drone happens to carry.
 *
 * Never a door of the compartment the drone is standing in, which is what
 * keeps this a clock and not a trap sprung underfoot, and never the last free
 * way home: a lock is only turned when a route from the drone to the airlock
 * through doors it can walk bare-handed still exists afterwards, so the ship
 * cannot wall in a drone that carries nothing (`tests/deadends.test.ts`,
 * `strandedAboard`). A drone that has already gone through a lock with its
 * tools has no such route to begin with, and then the ship locks nothing.
 */
function shutADoor(game: RoomGame, st: AlertState): void {
  const ship = game.ship;
  const here = game.roomOf(game.player).id;
  const lock = st.level >= LOCK_LEVEL;
  if (lock && !bareWayHome(ship, here)) return;

  const candidates = ship.doors.filter(
    (d) =>
      d.a !== d.b &&
      d.a !== here &&
      d.b !== here &&
      (d.state === "open" || (lock && d.state === "closed")),
  );
  if (candidates.length === 0) return;

  const rng = alertRng(game);
  for (const door of rng.shuffle([...candidates])) {
    if (lock && !lockable(ship, door, here)) continue;
    door.state = lock ? "locked" : "closed";
    st.lastDoor = st.turnsAboard;
    game.log.add(
      t(lock ? "log.alert.lock" : "log.alert.door", { door: door.label }),
      game.schedule.time,
      "bad",
      lock ? "log.alert.lock" : "log.alert.door",
    );
    return;
  }
}

/** Would the drone still have a bare-handed route to the airlock with this door locked? */
function lockable(ship: Ship, door: Door, here: RoomId): boolean {
  const was = door.state;
  door.state = "locked";
  const still = bareWayHome(ship, here);
  door.state = was;
  return still;
}

function bareWayHome(ship: Ship, here: RoomId): boolean {
  const map = RoomDistance.from(ship, [ship.entry], (d) => ship.passable(d, {}));
  return Number.isFinite(map.at(here));
}

// ---------------------------------------------------------------- the charges

/** A compartment a charge has already blown. */
export function isBlown(room: Room): boolean {
  return room.hazard === BLOWN;
}

/** Turns until the charge in `room` blows, when one is set there. Read by the map. */
export function fuseIn(game: RoomGame, room: RoomId): number | undefined {
  if (isTug(game)) return undefined;
  const st = alertState(game);
  const fuse = st.fuses.find((f) => f.room === room);
  return fuse === undefined ? undefined : Math.max(0, fuse.at - st.turnsAboard);
}

/**
 * The ship sets a charge in one of its own compartments.
 *
 * Never the drone's compartment and never the airlock's; never one holding
 * anything the drone came for — a system not yet raised, a module, a crate,
 * a charter's package, a body not yet searched (the keycard on it is the only
 * kind the ship has); and never one whose loss would cut the drone off from
 * the airlock or from any of those, whether it walks bare-handed or with a
 * cutter (`cutsOff`). The explosions are the ship closing in, not the ship
 * ending the run for the drone: what they take is time and room to move.
 *
 * Preferably a compartment the drone has walked: the fuse is a countdown the
 * player is meant to see, and a compartment on the far side of the hull is
 * not one they are looking at.
 */
function setCharge(game: RoomGame, st: AlertState): void {
  const ship = game.ship;
  const here = game.roomOf(game.player).id;
  const armed = new Set(st.fuses.map((f) => f.room));
  const candidates = ship.rooms.filter(
    (r) =>
      r.id !== here &&
      r.id !== ship.entry &&
      !isBlown(r) &&
      !armed.has(r.id) &&
      !worthKeeping(r) &&
      !cutsOff(ship, here, r.id, armed),
  );
  if (candidates.length === 0) return;

  const explored = candidates.filter((r) => r.explored);
  const room = alertRng(game).pick(explored.length > 0 ? explored : candidates);
  st.fuses.push({ room: room.id, at: st.turnsAboard + FUSE_TURNS });
  st.lastCharge = st.turnsAboard;
  game.log.add(
    t("log.alert.charge", { room: roomName(room), n: FUSE_TURNS }),
    game.schedule.time,
    "bad",
    "log.alert.charge",
  );
}

/** Does the compartment hold something the drone came for? */
function worthKeeping(room: Room): boolean {
  const data = room.data as Record<string, unknown>;
  const list = (key: string): unknown[] => (Array.isArray(data[key]) ? (data[key] as unknown[]) : []);
  if (list("systems").some((s) => (s as { online?: unknown }).online !== true)) return true;
  if (list("wrecks").length > 0 || list("crates").length > 0 || list("items").length > 0) return true;
  return list("bodies").some((b) => (b as { searched?: unknown }).searched !== true);
}

/**
 * Would blowing `room` cut the drone off from something it can reach now?
 *
 * The targets are the airlock and every compartment worth keeping; "reach" is
 * asked twice, for a drone with nothing in its hands and for one with a
 * cutter, and a target that is reachable one way and stops being so is a
 * cut. "Now" is the ship as it stands — a compartment whose charge is still
 * burning is still a compartment, and a route through it still a route —
 * and "after" is the ship with this compartment and every charged one gone,
 * so two charges cannot do together what neither may do alone. Asked when a
 * charge is set and again when it blows (`blast`), because the blasts in
 * between seal doors and change the map: on seed 43 the ARMORY's charge was
 * safe when set and the only way to the REACTOR by the time it went off.
 * `RoomDistance`, not a walk of its own.
 */
function cutsOff(ship: Ship, here: RoomId, room: RoomId, armed: ReadonlySet<RoomId>): boolean {
  const targets = [ship.entry, ...ship.rooms.filter((r) => worthKeeping(r) && !isBlown(r)).map((r) => r.id)];
  const gone = new Set([...armed, room]);
  const blocks = (d: Door) => gone.has(d.a) || gone.has(d.b);
  for (const walker of [{ isPlayer: true }, { isPlayer: true, breacher: true }]) {
    const walk = (d: Door) => ship.passable(d, walker);
    const before = RoomDistance.from(ship, [here], walk);
    const after = RoomDistance.from(ship, [here], (d) => walk(d) && !blocks(d));
    for (const target of targets) {
      if (Number.isFinite(before.at(target)) && !Number.isFinite(after.at(target))) return true;
    }
  }
  return false;
}

/**
 * The fuses burn down: every charge says how long it has left, and one at
 * zero goes off. True when a blast killed the drone — the death hook has
 * moved the operator home by then, and the caller must not touch the ship it
 * was reading.
 */
function tickFuses(game: RoomGame, st: AlertState): boolean {
  for (const fuse of [...st.fuses]) {
    const left = fuse.at - st.turnsAboard;
    const room = game.ship.roomAt(fuse.room);
    if (left > 0) {
      game.log.add(t("log.alert.fuse", { room: roomName(room), n: left }), game.schedule.time, "bad", "log.alert.fuse");
      continue;
    }
    st.fuses = st.fuses.filter((f) => f !== fuse);
    if (blast(game, st, room)) return true;
  }
  return false;
}

/**
 * The compartment goes up.
 *
 * The machines in it die through the game's own death hook, so every system
 * that keeps a record of one — the rival's drone, a ghost, a bloom — hears
 * about it; what those hooks drop on the deck goes with the blast a line
 * later, along with everything that was already lying there. The doors are
 * sealed behind it, so bare-handed nothing walks in and every path goes
 * round — unless that would wall the drone in: a drone that stayed for the
 * blast, or one that walked past the fuse into the compartments beyond it,
 * gets the doors blown out instead (`cutsOff`, asked again from where it
 * stands now), because the charges take time and room, never the way home.
 * What the drone takes goes through the rack (`BLAST_DAMAGE`), and true
 * means it did not survive.
 */
function blast(game: RoomGame, st: AlertState, room: Room): boolean {
  const inside = game.player.room === room.id;
  const here = game.player.room ?? game.ship.entry;
  const pending = new Set(st.fuses.filter((f) => f.room !== room.id).map((f) => f.room));
  st.blasts++;
  game.log.add(t("log.alert.blast", { room: roomName(room) }), game.schedule.time, "bad", "log.alert.blast");

  for (const e of [...game.entities]) {
    if (e.id === game.player.id || e.room !== room.id || !isAlive(e)) continue;
    e.hp = 0;
    e.alive = false;
    game.onDeath(e);
  }
  game.reapDead();
  room.hazard = BLOWN;
  room.cover = false;
  const data = room.data as Record<string, unknown[] | undefined>;
  // A raised system stays on the record: the SHIP system counts it from its
  // own pocket, and a wrecked compartment does not un-raise what it held.
  for (const key of ["wrecks", "crates", "items", "bodies"]) {
    if (Array.isArray(data[key])) data[key]!.length = 0;
  }
  const seal = !inside && !cutsOff(game.ship, here, room.id, pending);
  for (const door of game.ship.doorsOf(room.id)) {
    if (door.state === "airlock") continue;
    door.state = seal ? "sealed" : "broken";
  }

  if (!inside) return false;
  blamedOn("log.hit.blast", () => dealDamage(game, game.player, BLAST_DAMAGE));
  if (isAlive(game.player)) return false;
  st.blastDeaths++;
  game.onDeath(game.player);
  return true;
}

/**
 * The top of the gauge, at zero: the hull is gone. Everything aboard dies
 * through the death hook — the machines first, so their systems hear of it,
 * then the drone, which is what moves the operator home and takes the hull
 * off the itinerary (`systems/voyage.ts`, `loseDrone` reads `detonated`).
 * Always true: the caller is standing on a ship that no longer exists.
 */
function detonate(game: RoomGame, st: AlertState): boolean {
  st.detonated = true;
  st.detonateAt = -1;
  st.fuses = [];
  game.log.add(t("log.alert.boom"), game.schedule.time, "bad", "log.alert.boom");
  for (const e of [...game.entities]) {
    if (e.id === game.player.id || !isAlive(e)) continue;
    e.hp = 0;
    e.alive = false;
    game.onDeath(e);
  }
  game.reapDead();
  for (const room of game.ship.rooms) {
    room.hazard = BLOWN;
    room.cover = false;
  }
  game.player.hp = 0;
  game.player.alive = false;
  game.onDeath(game.player);
  return true;
}

/** Turns until the ship blows — the number on the panel — or nothing while it is not counting. */
export function detonationIn(game: RoomGame): number | undefined {
  if (isTug(game)) return undefined;
  const st = alertState(game);
  if (st.detonateAt < 0 || st.level < MAX_LEVEL) return undefined;
  return Math.max(0, st.detonateAt - st.turnsAboard);
}

/** Did this stored hull blow itself up? The one underfoot unless another is named. */
export function detonated(game: RoomGame, id = game.shipId): boolean {
  const raw = game.ships.get(id)?.data.alert;
  return isState(raw) && (raw as Partial<AlertState>).detonated === true;
}

// ------------------------------------------------------------- neutralised

/**
 * The ship is neutralised: the gauge stops, and with it every clock it runs —
 * no more raises, no doors, no charges, no countdown, no hunter replaced.
 * Called by `systems/ship.ts` the turn the third system comes up. What is
 * already awake stays awake; the ship stops *answering*, it does not
 * surrender.
 */
export function standDown(game: RoomGame): void {
  if (isTug(game)) return;
  const st = alertState(game);
  if (st.frozen) return;
  st.frozen = true;
  st.fuses = [];
  st.armAt = -1;
  st.detonateAt = -1;
  game.log.add(t("log.alert.down"), game.schedule.time, "good", "log.alert.down");
}

/**
 * Is the gauge off? The flag `standDown` sets, or the fact it is set for —
 * every system of the ship online, read off the SHIP system's own record —
 * so a hull neutralised by a save file from before the flag existed is still
 * a hull that has stopped answering.
 */
function neutralised(game: RoomGame, st: AlertState): boolean {
  return st.frozen || onlineSystems(game) >= OBJECTIVE_COUNT;
}

// ------------------------------------------------------- between two sorties

/**
 * What the ship did while nobody was watching (design-doc.md, "Персистентный
 * дереликт"): it calmed down — four steps for a drone that left through the
 * airlock, six for one it killed, never below the floor its raised systems
 * hold it at — its charges went off, it mustered machines into the
 * compartments you already walked, and those machines left a trail of doors
 * they did not bother to close.
 *
 * The muster is sized by how alarmed the ship was when the drone left, not by
 * what it settled to — leaving at the top is what makes coming back expensive,
 * and reading the settled level instead would make the gauge free to fill.
 * `2 + alert` on the ten-rung ladder is the `2 + 2 × alert` the document asks
 * of the five-rung one, rung for rung.
 *
 * It is sized *down* by what is already aboard, which is the half that was
 * missing. Nothing ever said a hull may hold ten times its own complement,
 * and nothing took the last muster off again. G33 measured the end of that:
 * four hundred entries into one freighter left about four hundred and twenty
 * machines standing in it. The rule is "the ship musters what it can spare",
 * and a ship cannot spare what it does not have.
 *
 * Every roll comes off `alertRng`, so what the ship did in your absence is the
 * same on a replay whatever the run spent its own randomness on in between.
 */
function shipAnswers(game: RoomGame): void {
  const st = alertState(game);
  if (neutralised(game, st)) return;
  const alarmed = st.level;
  st.level = Math.max(onlineSystems(game), alarmed - (st.lostDrone ? DEATH_DROP : LEAVE_DROP));
  st.lostDrone = false;
  st.quietTurns = 0;
  st.armAt = -1;
  st.detonateAt = -1;
  // The charges that were burning when the drone left are disarmed, like the
  // countdown: they were the ship's answer to a drone that is no longer
  // aboard, and a hull is the same place the second time
  // (`tests/persistence.test.ts` — what a sortie left lying about is there
  // when the next one walks in, doors and bodies included).
  st.fuses = [];

  const rng = alertRng(game);
  const entry = game.ship.entry;
  const rooms = roomsAtLeast(game.ship, entry, MIN_SPAWN_DOORS, false).filter(
    (r) => game.ship.roomAt(r).explored && !isBlown(game.ship.roomAt(r)),
  );
  if (rooms.length === 0) return;

  const walk = walkFilter(game.ship, false);
  const toEntry = RoomDistance.from(game.ship, [entry], walk);
  const room = musterRoom(game);
  let placed = 0;

  for (let i = 0; i < Math.min(2 + alarmed, room); i++) {
    // Never a fourth into a compartment that holds three: the muster spreads
    // down the corridors the drone walked, and stops when they are all full.
    const open = rooms.filter((r) => !crowded(game, r));
    if (open.length === 0) break;
    const room = rng.pick(open);
    const kind = pickKind(rng, game.content.monstersForDepth(game.ship.roomAt(room).depth));
    if (!kind) continue;
    // No standing order: these are posted, not dispatched. They are waiting
    // where you have to walk, which is the whole of the threat.
    const machine = spawnMonsterIn(kind, room);
    notePost(machine);
    game.schedule.admit(machine);
    game.entities.push(machine);
    placed++;
    leaveTrail(game.ship, toEntry, room, rng, walk);
  }

  if (placed > 0) {
    game.log.add(t("log.alert.busy", { n: placed }), game.schedule.time, "bad", "log.alert.busy");
  }
}

/**
 * How many more machines this hull can hold: its own complement, less what is
 * still alive aboard it.
 *
 * The complement is the class's `machines` ceiling, which is the same number
 * `systems/populate.ts` filled the ship to in the first place, so a muster can
 * bring a stripped hull back up to strength and never past it. A hull no class
 * built — a fixture drawn by hand — has no complement of its own and falls back
 * on the one ceiling every ship has (design-doc.md, "Машины": at most eight).
 */
function musterRoom(game: RoomGame): number {
  const complement = specOfShip(game.ship)?.machines[1] ?? MAX_MACHINES;
  const aboard = game.entities.filter(
    (e) => e.id !== game.player.id && isAlive(e) && e.faction !== game.player.faction,
  ).length;
  return Math.max(0, complement - aboard);
}

/**
 * The doors a machine walked through on its way to its post, some of them left
 * open behind it — the "somebody has been here" the player reads off the
 * schematic before meeting anything.
 */
function leaveTrail(ship: Ship, toEntry: RoomDistance, from: RoomId, rng: Rng, walk: DoorFilter): void {
  let at = from;
  for (let guard = 0; guard < ship.size; guard++) {
    if (at === ship.entry) return;
    const door = toEntry.nextDoor(at, walk);
    if (!door) return;
    if (door.state === "closed" && rng.chance(TRAIL_CHANCE)) door.state = "open";
    at = ship.other(door, at);
  }
}

/**
 * How many of the ship's systems the drone has brought online. Written by the
 * SHIP system (G17) into the same per-ship pocket; read defensively, because a
 * derelict nobody has worked on has no such record at all.
 */
function onlineSystems(game: RoomGame): number {
  const raw = game.currentShip.data.ship;
  if (typeof raw !== "object" || raw === null) return 0;
  const online = (raw as { online?: unknown }).online;
  return Array.isArray(online) ? online.length : 0;
}

// ------------------------------------------------------------- the system

export const ALERT: System<RoomGame> = {
  name: "alert",

  // Nothing is looking for the drone at home: the tug has no gauge, no
  // reinforcements and no hunter (design-doc.md, "Буксир").
  onLevelEnter(game) {
    if (isTug(game)) return;
    // Reading the state is what creates it, so a fresh derelict starts at zero
    // whether or not anything ever raises its alert.
    alertState(game);
    if (game.currentShip.visits > 1) shipAnswers(game);
    stampPosts(game);
  },

  /** A machine that walked into a full compartment did not get in (`holdAtTheDoor`). */
  afterActorTurn(game, actor) {
    if (isTug(game) || actor.id === game.player.id || actor.faction === game.player.faction) return;
    holdAtTheDoor(game, actor);
  },

  /**
   * A drone the ship took apart: remembered on the ship, so that the next entry
   * finds it calmer rather than one step so (`shipAnswers`). Every way a drone
   * dies aboard comes through here — a machine's blow through the engine, a
   * blast or the detonation through this file — and all go on to
   * `systems/voyage.ts`, which is later in the list and moves the operator home.
   */
  onDeath(game, victim) {
    if (victim.id !== game.player.id || isTug(game)) return;
    alertState(game).lostDrone = true;
  },

  afterPlayerTurn(game) {
    if (game.status !== "playing" || isTug(game)) return;
    // Where everything stands before the machines move: what `holdAtTheDoor`
    // sends a machine back to when it walks into a compartment that is full.
    stampPosts(game);
    const st = alertState(game);
    st.turnsAboard++;
    if (neutralised(game, st)) return;

    // The clock climbs the ladder up to the charges; the arming has its own
    // countdown, started on the ninth rung.
    const period = isFirstShip(game) ? PERIOD_FIRST_SHIP : PERIOD;
    if (st.level < CHARGE_LEVEL && st.turnsAboard % period === 0) raiseAlert(game, 1, true);
    if (st.level === CHARGE_LEVEL && st.armAt >= 0 && st.turnsAboard >= st.armAt) raiseAlert(game, 1, true);

    if (loudAnywhere(game) && st.turnsAboard - st.lastNoiseBump >= NOISE_COOLDOWN) {
      st.lastNoiseBump = st.turnsAboard;
      raiseAlert(game);
    }

    if (st.level >= DOOR_LEVEL && st.turnsAboard - st.lastDoor >= DOOR_PERIOD) shutADoor(game, st);

    // From the lockdown the hunt never lapses: a hunter that died is replaced,
    // and everything aboard is told where you are.
    if (st.level >= LOCK_LEVEL && st.turnsAboard - st.lastHunter >= HUNTER_PERIOD) {
      st.lastHunter = st.turnsAboard;
      if (!hunterAboard(game) && !isTutorialHull(game)) sendEnforcer(game, st.level);
      pointEveryoneAtTheDrone(game);
    }

    // A charge set is a charge that goes off, whatever the gauge does after:
    // the fuses burn first, then the next one is set into the ship as it is
    // after the blast, and the detonation is the last thing the turn does.
    if (tickFuses(game, st)) return;
    if (st.level >= CHARGE_LEVEL && st.turnsAboard - st.lastCharge >= CHARGE_PERIOD) setCharge(game, st);
    if (st.level >= MAX_LEVEL && st.detonateAt >= 0 && st.turnsAboard >= st.detonateAt) {
      detonate(game, st);
      return;
    }

    st.quietTurns = quietTurn(game) ? st.quietTurns + 1 : 0;
    const needed = game.player.hidden === true ? QUIET_TURNS_HIDDEN : QUIET_TURNS;
    if (st.level > 0 && st.quietTurns >= needed) {
      st.quietTurns = 0;
      st.level--;
      // Off the top: the countdown stops, and starts again only from a fresh
      // climb; off the charges, so does the arming. What is already set keeps
      // burning.
      if (st.level < MAX_LEVEL) st.detonateAt = -1;
      if (st.level < CHARGE_LEVEL) st.armAt = -1;
      game.log.add(t("log.alert.calm"), game.schedule.time, "good", "log.alert.calm");
    }
  },

  panelLines(game) {
    // Nothing to raise an alert on the tug and nothing aboard to hunt: an empty
    // gauge at home is a counter for a rule that is not running, on the one
    // screen whose whole point is that the other half of the game is not
    // happening (docs/tasks/G53-tug-is-a-menu.md, 2).
    if (isTug(game)) return [];
    const st = alertState(game);
    const level = st.level;
    const gauge = "▮".repeat(level) + "▯".repeat(MAX_LEVEL - level);

    // The word after the bar is the whole of the ladder made visible: what the
    // ship is doing about you, in one word, and at the top how long you have.
    const off = neutralised(game, st);
    const boom = detonationIn(game);
    let text: string;
    if (off) text = t("panel.alertOff", { gauge });
    else if (boom !== undefined) text = t("panel.alertBoom", { gauge, n: boom });
    else if (level > 0) text = t("panel.alertStage", { gauge, stage: t(LADDER[level]!.word) });
    else text = t("panel.alert", { gauge });

    const fg = off ? undefined : level >= CHARGE_LEVEL ? BAD_FG : level >= WARN_LEVEL ? WARN_FG : undefined;
    const lines = [fg ? { text, fg } : { text }];
    if (hunterAboard(game)) lines.push({ text: t("panel.hunter"), fg: BAD_FG });
    // Every fuse burning, nearest to zero first: the compartment's short id,
    // which is what the map is labelled with, and the turns left.
    for (const fuse of [...st.fuses].sort((a, b) => a.at - b.at)) {
      const n = Math.max(0, fuse.at - st.turnsAboard);
      lines.push({ text: t("panel.fuse", { room: game.ship.roomAt(fuse.room).label, n }), fg: BAD_FG });
    }
    return lines;
  },
};

/**
 * The run's first derelict — the hull the game is learned on: its clock runs
 * half as fast, its ladder wakes nothing, and `systems/hazards.ts` leaves it
 * clean.
 *
 * The first *derelict*, not the first ship in the store: a run starts on the
 * tug (`GAME_CONFIG.firstShipId`), so the store's first id is home, and read
 * that way no derelict was ever the first one — every hull ran on the fast
 * clock and the tutorial pace existed only in the fixture tests.
 *
 * And in a training run, the hull *after* the training one as well. The
 * training hull stands in front of the itinerary (`systems/voyage.ts`) and
 * read as the first derelict it took the slow clock and the clean deck with
 * it: the first real hull of a training run met the fast clock, the full
 * ladder and its class's hazards — everything the same hull is spared in an
 * ordinary run. Measured over 200 careful training voyages: 6 wins against
 * 15 once that hull counts as first too, and the first real hull sold on 19
 * voyages against 64. The training hull keeps its own slow clock; it is
 * where the ladder is read for the first time.
 */
export function isFirstShip(game: RoomGame): boolean {
  const ids = game.ships.ids().filter((id) => id !== TUG_ID);
  const at = ids.indexOf(game.shipId);
  return at === 0 || (at === 1 && isTutorialHull(game, ids[0]));
}

/** Is this stored ship — the one underfoot, unless another is named — the training hull? */
function isTutorialHull(game: RoomGame, id = game.shipId): boolean {
  const ship = game.ships.get(id)?.ship;
  return ship !== undefined && classOfShip(ship) === TUTORIAL_ID;
}
