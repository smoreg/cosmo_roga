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
import { specOfShip } from "../content/derelicts.js";
import type { Key } from "../content/i18n/keys.js";
import { CROWD, ENFORCER, MAX_MACHINES, machineName } from "../content/monsters.js";
import { OBJECTIVE_COUNT } from "../content/objectives.js";
import { PALETTE } from "../content/palette.js";
import { TUG_ID, isTug } from "../content/tug.js";
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
 * What the gauge *does* is a ladder (`LADDER` below), one rung per level, and
 * every rung is climbed once on the way up: the ship notices, then posts a
 * machine where you have walked, then sends one after you and starts shutting
 * doors, then sends its hunter, and at the top it locks the doors and begins
 * venting its own compartments one by one until you leave or it has nothing
 * left to vent. Neutralising the ship — all three systems up — switches the
 * whole process off (`standDown`, called from `systems/ship.ts`).
 *
 * A system, not the twist: it hooks the same turn cycle but knows nothing about
 * modules, and the rig knows nothing about it.
 */

/** Top of the gauge. Every number below is design-doc.md's. */
export const MAX_LEVEL = 5;
/** Turns aboard between time-driven raises. The run's first derelict is the tutorial. */
const PERIOD_FIRST_SHIP = 80;
export const PERIOD = 40;
/**
 * A compartment this loud anywhere aboard raises the alert. The engine rates a
 * fight at 9 and a step through a door at 3 (`rooms/game.ts`), so fighting is
 * heard and walking is not; the game's own loud verbs call `makeNoise`
 * themselves.
 */
const NOISE_THRESHOLD = 8;
/** ...but no more often than this, or one fight would fill the gauge. */
const NOISE_COOLDOWN = 10;

/** A turn is quiet when the drone's own compartment is under this. */
const DRONE_HEARD_AT = 5;
/** Quiet turns that talk the ship down one level — in the open, and in cover. */
const QUIET_TURNS = 15;
const QUIET_TURNS_HIDDEN = 8;

/** Nothing is ever woken this close to the drone: two doors is the ambush line. */
const MIN_SPAWN_DOORS = 2;
/**
 * The level at which the ship sends its hunter.
 *
 * design-doc.md, "Тревога", says three, and three is a number that reads well
 * next to a five-step gauge. It does not survive being multiplied by the other
 * rule the document has: "Обезвредить корабль" puts +2 on the gauge for every
 * system brought online, so a derelict that starts calm is at three the moment
 * the *second* system comes up — and a drone that has raised one system and is
 * standing in the reactor with a CELL half spent is not a drone that beats a
 * hunter. Measured over 600 seeds by G33: no bot and no scripted driver ever
 * brought a third system online, on a generated hull *or* on a hull with the
 * machines taken out of it altogether. `NEUTRALIZE` was not hard, it was
 * unreachable, and with it the sale, the 120 CR, and the rest of the itinerary.
 *
 * Four gives the drone the first two systems and sends the hunter for the
 * third, which is the shape the document actually describes — the ship notices,
 * and then it comes looking. Noise still gets there on its own: a fight is +1
 * every ten turns, so a loud sortie meets the ENFORCER without touching a
 * system at all.
 */
export const HUNTER_LEVEL = 4;
/** At the top of the gauge the hunter is replaced this often. */
const HUNTER_PERIOD = 15;
/** How often a machine that walked the ship alone left a closed door open behind it. */
const TRAIL_CHANCE = 0.5;

/** From this level the ship shuts one door behind the drone every `DOOR_PERIOD` turns. */
const DOOR_LEVEL = 3;
export const DOOR_PERIOD = 10;
/** From this level the door it shuts is locked rather than closed. */
const LOCK_LEVEL = MAX_LEVEL;

/**
 * The scuttle: at the top of the gauge the ship counts `SCUTTLE_WARN` turns
 * down on the panel — the last warning — and then vents one compartment every
 * `SCUTTLE_PERIOD` turns, farthest from the drone first. Fifteen and twelve
 * rather than twelve and ten: a bot that never reads the countdown dies in a
 * vented compartment on a quarter of the sorties it happens in at the shorter
 * clock, and on an eighth at this one — and a scuttle is a warning, not an
 * execution.
 */
export const SCUTTLE_WARN = 15;
export const SCUTTLE_PERIOD = 12;
/** What a turn spent standing in a vented compartment costs the rack. */
const VENT_DAMAGE = 1;

/**
 * From this level every machine the ladder wakes is tougher: `hp` and `hpMax`
 * both gain `level − STRONGER_FROM + 1`, so the level-4 hunter carries one
 * point more and whatever the top of the gauge sends carries two. Number and
 * strength are the two axes the owner named, and this is the second one.
 */
const STRONGER_FROM = 4;

/**
 * How far the gauge falls while nobody is aboard: two steps for a drone that
 * cycled out through the airlock, three for a drone the ship took apart — a
 * dead drone is a ship that has stopped hearing anything — never below the
 * floor its raised systems hold it at. The muster that meets the next drone is
 * sized by the level *before* the drop (`shipAnswers`), which is where "по
 * возвращению там будет прилично дронов" lives.
 *
 * The owner asked for one and two. Measured over 200 careful voyages with the
 * rest of the ladder in place: at one and two the gauge reaches the top on
 * 48 % of sorties and the voyage is won 3 times, which is the jam's line with
 * no margin under it; at two and three it is 33 % and 8 wins. What the extra
 * step buys is a second sortie that starts under the hunter instead of on it.
 */
const LEAVE_DROP = 2;
const DEATH_DROP = 3;

/**
 * Colours come from `content/palette.ts`, not `ui/theme.ts`: rules never
 * depend on the renderer, and the palette is data either way.
 */
const WARN_FG = PALETTE.warn;
const BAD_FG = PALETTE.bad;
/** The gauge turns warn at this level and bad at MAX_LEVEL. */
const WARN_LEVEL = 3;

/** Set on a vented compartment; the engine reads exactly this string (`rooms/noise.ts`). */
const VENTED = "vented";

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
 * Data, not a state machine. Level 1 buys nothing but the word; the doors
 * start shutting at `DOOR_LEVEL` and locking at `LOCK_LEVEL`, and the scuttle
 * starts at `MAX_LEVEL` — those three are clocks rather than one-off answers,
 * so they live in `afterPlayerTurn` and not here.
 *
 * One machine at two and one at three, and neither on the run's first
 * derelict. The owner asked for one and two; measured, every machine woken
 * inside a sortie is a machine outside the hull's budget, and the careful bot
 * — which never reads the panel — pays for each one in hulls sold: two sent at
 * three is 14 hulls of 32 and 4 wins in 200, one is 15 and 8. On the first
 * derelict, the tutorial, even one posted machine took the voyage from 16
 * hulls sold to 6, so there the ladder is the word, the doors and the hunter.
 */
const LADDER: Readonly<Record<number, Rung>> = {
  1: { word: "alert.noticed", posted: 0, sent: 0, hunter: false },
  2: { word: "alert.searching", posted: 1, sent: 0, hunter: false },
  3: { word: "alert.hunting", posted: 0, sent: 1, hunter: false },
  4: { word: "alert.hunter", posted: 0, sent: 0, hunter: true },
  5: { word: "alert.scuttle", posted: 0, sent: 0, hunter: true },
};

// ------------------------------------------------------------------- the state

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
  /** `turnsAboard` at which the scuttle countdown started; −1 while it is not running. */
  scuttleFrom: number;
  /** Neutralised: the gauge is off, and nothing below moves it again. */
  frozen: boolean;
  /** A drone died aboard since the last entry: the next entry drops two levels, not one. */
  lostDrone: boolean;
  /** Sorties during which the gauge reached the top, and the visit it last did. */
  peaks: number;
  peakVisit: number;
  /** Compartments vented over the ship's life, the sorties it happened in, and the last such visit. */
  vents: number;
  ventSorties: number;
  ventVisit: number;
  /** Drones that died standing in a vented compartment. */
  ventDeaths: number;
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
 * A record written by the build before the ladder has the six numbers above
 * and none of the rest. It is still that ship's gauge; the missing fields are
 * filled with what a fresh record would hold rather than thrown away with the
 * level, so a save from the day before loads with the same ship in it.
 */
function complete(st: AlertState): AlertState {
  const s = st as Partial<AlertState> & AlertState;
  const fresh = freshState();
  if (typeof s.lastDoor !== "number") s.lastDoor = fresh.lastDoor;
  if (typeof s.scuttleFrom !== "number") s.scuttleFrom = fresh.scuttleFrom;
  if (typeof s.frozen !== "boolean") s.frozen = fresh.frozen;
  if (typeof s.lostDrone !== "boolean") s.lostDrone = fresh.lostDrone;
  if (typeof s.peaks !== "number") s.peaks = fresh.peaks;
  if (typeof s.peakVisit !== "number") s.peakVisit = fresh.peakVisit;
  if (typeof s.vents !== "number") s.vents = fresh.vents;
  if (typeof s.ventSorties !== "number") s.ventSorties = fresh.ventSorties;
  if (typeof s.ventVisit !== "number") s.ventVisit = fresh.ventVisit;
  if (typeof s.ventDeaths !== "number") s.ventDeaths = fresh.ventDeaths;
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
    scuttleFrom: -1,
    frozen: false,
    lostDrone: false,
    peaks: 0,
    peakVisit: 0,
    vents: 0,
    ventSorties: 0,
    ventVisit: 0,
    ventDeaths: 0,
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
 * five that is provoked again answers with nothing new — its clocks (the
 * hunter, the doors, the scuttle) are already running. Nothing at all moves a
 * neutralised ship (`standDown`).
 */
export function raiseAlert(game: RoomGame, steps = 1): void {
  const st = alertState(game);
  if (neutralised(game, st)) return;
  for (let i = 0; i < steps; i++) {
    // The ship just noticed something: whatever silence had been banked is gone.
    st.quietTurns = 0;
    if (st.level >= MAX_LEVEL) continue;
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

  // The two clocks that start on a rung rather than on a turn: the doors start
  // shutting `DOOR_PERIOD` turns from now, and the scuttle starts counting.
  if (level === DOOR_LEVEL) st.lastDoor = st.turnsAboard;
  if (level === MAX_LEVEL) {
    st.scuttleFrom = st.turnsAboard;
    const visit = game.currentShip.visits;
    if (st.peakVisit !== visit) {
      st.peakVisit = visit;
      st.peaks++;
    }
    game.log.add(t("log.alert.scuttle", { n: SCUTTLE_WARN }), game.schedule.time, "bad", "log.alert.scuttle");
  }

  // The tutorial hull wakes nothing extra: its ladder is doors and the hunter.
  if (rung.posted + rung.sent > 0 && !isFirstShip(game)) {
    const rng = alertRng(game);
    for (let i = 0; i < rung.posted; i++) wake(game, rng, level, false);
    for (let i = 0; i < rung.sent; i++) wake(game, rng, level, true);
  }
  if (rung.hunter && !hunterAboard(game)) sendEnforcer(game, level);
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
 * down a corridor it recognises instead of out of unexplored ship.
 */
function pickSpawnRoom(game: RoomGame, rng: Rng, breacher: boolean): RoomId | undefined {
  const rooms = roomsAtLeast(game.ship, game.roomOf(game.player).id, MIN_SPAWN_DOORS, breacher).filter(
    (r) => !crowded(game, r),
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

/** Level 5: everything aboard is told where you were. */
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

// ---------------------------------------------------------------- the scuttle

/**
 * The ship vents one compartment: the one farthest from the drone among those
 * it has walked and that lie at least two doors away, so the venting is read
 * off the schematic as a thing coming closer rather than felt as a blow.
 *
 * Never the airlock compartment and never the one the drone is in — a vented
 * compartment is still a compartment and still walkable, so the way home is
 * never the thing that goes (`tests/deadends.test.ts`). What was in it is gone:
 * the machines die, the scrap and the crates are blown out with the air, and
 * whatever cover there was is torn loose. A drone that walks in afterwards
 * pays for every turn it stands there (`bleed`).
 */
function vent(game: RoomGame, st: AlertState): void {
  const ship = game.ship;
  const here = game.roomOf(game.player).id;
  const map = RoomDistance.from(ship, [here], walkFilter(ship, true));
  const candidates = ship.rooms.filter(
    (r) =>
      r.id !== here &&
      r.id !== ship.entry &&
      r.explored &&
      r.hazard !== VENTED &&
      Number.isFinite(map.at(r.id)) &&
      map.at(r.id) >= MIN_SPAWN_DOORS,
  );
  if (candidates.length === 0) return;

  const farthest = Math.max(...candidates.map((r) => map.at(r.id)));
  const pool = candidates.filter((r) => map.at(r.id) === farthest);
  const room = pool.length === 1 ? pool[0]! : alertRng(game).pick(pool);
  blowOut(game, room);

  st.vents++;
  const visit = game.currentShip.visits;
  if (st.ventVisit !== visit) {
    st.ventVisit = visit;
    st.ventSorties++;
  }
  game.log.add(t("log.alert.vent", { room: roomName(room) }), game.schedule.time, "bad", "log.alert.vent");
}

/**
 * The compartment, opened to space.
 *
 * The machines in it die through the game's own death hook, so every system
 * that keeps a record of one — the rival's drone, a ghost, a bloom — hears
 * about it; what those hooks drop on the deck goes out with the air a line
 * later, along with everything that was already lying there. Bodies stay:
 * a keycard on a corpse is the only kind the ship has, and a vent that ate
 * it would be a lock nothing opens.
 */
function blowOut(game: RoomGame, room: Room): void {
  room.hazard = VENTED;
  room.cover = false;
  for (const e of [...game.entities]) {
    if (e.id === game.player.id || e.room !== room.id || !isAlive(e)) continue;
    e.hp = 0;
    e.alive = false;
    game.onDeath(e);
  }
  game.reapDead();
  const data = room.data as Record<string, unknown[] | undefined>;
  if (Array.isArray(data.wrecks)) data.wrecks.length = 0;
  if (Array.isArray(data.crates)) data.crates.length = 0;
}

/**
 * A turn standing in a vented compartment: one point into the rack, through
 * the same path a blow takes, so the exposed module is what wears and the
 * PLATING is what saves the core. Whichever system routes the hit says what
 * it hit; this only speaks when the point went past the rack to the core,
 * because then nobody else has.
 *
 * True when the drone did not survive it — the death hook has moved the
 * operator home by the time this returns, and the caller must not touch the
 * ship it was reading.
 */
function bleed(game: RoomGame): boolean {
  const room = game.roomOf(game.player);
  if (room.hazard !== VENTED) return false;

  const res = blamedOn("log.hit.vent", () => dealDamage(game, game.player, VENT_DAMAGE));
  if (res.toHp > 0) {
    game.log.add(
      t("log.alert.vacuum", { room: roomName(room), n: res.toHp }),
      game.schedule.time,
      "bad",
      "log.alert.vacuum",
    );
  }
  if (isAlive(game.player)) return false;
  game.onDeath(game.player);
  return true;
}

/** Turns until the scuttle does something next — the number on the panel. */
function scuttleCountdown(st: AlertState): number {
  const elapsed = st.turnsAboard - st.scuttleFrom;
  if (elapsed < SCUTTLE_WARN) return SCUTTLE_WARN - elapsed;
  const since = (elapsed - SCUTTLE_WARN) % SCUTTLE_PERIOD;
  return since === 0 ? SCUTTLE_PERIOD : SCUTTLE_PERIOD - since;
}

function scuttleDue(st: AlertState): boolean {
  const elapsed = st.turnsAboard - st.scuttleFrom;
  return elapsed >= SCUTTLE_WARN && (elapsed - SCUTTLE_WARN) % SCUTTLE_PERIOD === 0;
}

// ------------------------------------------------------------- neutralised

/**
 * The ship is neutralised: the gauge stops, and with it every clock it runs —
 * no more raises, no doors, no scuttle, no hunter replaced. Called by
 * `systems/ship.ts` the turn the third system comes up. What is already awake
 * stays awake; the ship stops *answering*, it does not surrender.
 */
export function standDown(game: RoomGame): void {
  if (isTug(game)) return;
  const st = alertState(game);
  if (st.frozen) return;
  st.frozen = true;
  st.scuttleFrom = -1;
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

/** The same question, for the panel and the tests. */
export function alertOff(game: RoomGame): boolean {
  return !isTug(game) && neutralised(game, alertState(game));
}

// ------------------------------------------------------- between two sorties

/**
 * What the ship did while nobody was watching (design-doc.md, "Персистентный
 * дереликт"): it calmed down — one step for a drone that left through the
 * airlock, two for one it killed, never below the floor its raised systems
 * hold it at — it mustered machines into the compartments you already walked,
 * and those machines left a trail of doors they did not bother to close.
 *
 * The muster is sized by how alarmed the ship was when the drone left, not by
 * what it settled to — leaving at 5/5 is what makes coming back expensive,
 * and reading the settled level instead would make the gauge free to fill.
 *
 * It is sized *down* by what is already aboard, which is the half that was
 * missing. `2 + 2 × alert` is what the document asks a muster to bring; nothing
 * ever said a hull may hold ten times its own complement, and nothing took the
 * last muster off again. G33 measured the end of that: four hundred entries
 * into one freighter left about four hundred and twenty machines standing in
 * it. A real voyage makes two or three trips, so it never showed up as a
 * playable defect — but the rule it comes from is "the ship musters what it can
 * spare", and a ship cannot spare what it does not have.
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
  st.scuttleFrom = -1;

  const rng = alertRng(game);
  const entry = game.ship.entry;
  const rooms = roomsAtLeast(game.ship, entry, MIN_SPAWN_DOORS, false).filter(
    (r) => game.ship.roomAt(r).explored,
  );
  if (rooms.length === 0) return;

  const walk = walkFilter(game.ship, false);
  const toEntry = RoomDistance.from(game.ship, [entry], walk);
  const room = musterRoom(game);
  let placed = 0;

  for (let i = 0; i < Math.min(2 + 2 * alarmed, room); i++) {
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
   * finds it two steps calmer rather than one (`shipAnswers`). Both ways a
   * drone dies aboard come through here — a machine's blow through the engine,
   * the vacuum through `bleed` — and both go on to `systems/voyage.ts`, which is
   * later in the list and moves the operator home.
   */
  onDeath(game, victim) {
    if (victim.id !== game.player.id || isTug(game)) return;
    const st = alertState(game);
    st.lostDrone = true;
    if (game.roomOf(victim).hazard === VENTED) st.ventDeaths++;
  },

  afterPlayerTurn(game) {
    if (game.status !== "playing" || isTug(game)) return;
    // Where everything stands before the machines move: what `holdAtTheDoor`
    // sends a machine back to when it walks into a compartment that is full.
    stampPosts(game);
    const st = alertState(game);
    st.turnsAboard++;

    // The vacuum is not the alert's to switch off: a vented compartment stays
    // vented on a neutralised ship, and standing in it still costs.
    if (bleed(game)) return;
    if (neutralised(game, st)) return;

    const period = isFirstShip(game) ? PERIOD_FIRST_SHIP : PERIOD;
    if (st.turnsAboard % period === 0) raiseAlert(game);

    if (loudAnywhere(game) && st.turnsAboard - st.lastNoiseBump >= NOISE_COOLDOWN) {
      st.lastNoiseBump = st.turnsAboard;
      raiseAlert(game);
    }

    if (st.level >= DOOR_LEVEL && st.turnsAboard - st.lastDoor >= DOOR_PERIOD) shutADoor(game, st);

    // At the top of the gauge the hunt never lapses: a hunter that died is
    // replaced, everything aboard is told where you are, and the ship starts
    // taking itself apart from the far end.
    if (st.level >= MAX_LEVEL) {
      // The vent first: a hunter woken this turn is woken into the ship as
      // it is after the venting, not into the compartment about to be blown.
      if (st.scuttleFrom >= 0 && scuttleDue(st)) vent(game, st);
      if (st.turnsAboard - st.lastHunter >= HUNTER_PERIOD) {
        st.lastHunter = st.turnsAboard;
        if (!hunterAboard(game)) sendEnforcer(game, st.level);
        pointEveryoneAtTheDrone(game);
      }
    }

    st.quietTurns = quietTurn(game) ? st.quietTurns + 1 : 0;
    const needed = game.player.hidden === true ? QUIET_TURNS_HIDDEN : QUIET_TURNS;
    if (st.level > 0 && st.quietTurns >= needed) {
      st.quietTurns = 0;
      st.level--;
      // Off the top: the countdown stops, and starts again only from a fresh
      // climb to the top.
      if (st.level < MAX_LEVEL) st.scuttleFrom = -1;
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
    let text: string;
    if (off) text = t("panel.alertOff", { gauge });
    else if (level >= MAX_LEVEL && st.scuttleFrom >= 0) {
      text = t("panel.alertScuttle", { gauge, n: scuttleCountdown(st) });
    } else if (level > 0) text = t("panel.alertStage", { gauge, stage: t(LADDER[level]!.word) });
    else text = t("panel.alert", { gauge });

    const fg = off ? undefined : level >= MAX_LEVEL ? BAD_FG : level >= WARN_LEVEL ? WARN_FG : undefined;
    const lines = [fg ? { text, fg } : { text }];
    if (hunterAboard(game)) lines.push({ text: t("panel.hunter"), fg: BAD_FG });
    return lines;
  },
};

/**
 * The run's first derelict is the tutorial, and its clock runs half as fast.
 *
 * The first *derelict*, not the first ship in the store: a run starts on the
 * tug (`GAME_CONFIG.firstShipId`), so the store's first id is home, and read
 * that way no derelict was ever the first one — every hull ran on the forty-turn
 * clock and the tutorial pace existed only in the fixture tests.
 */
function isFirstShip(game: RoomGame): boolean {
  return game.ships.ids().find((id) => id !== TUG_ID) === game.shipId;
}
