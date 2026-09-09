import {
  RoomDistance,
  Rng,
  isAlive,
  rememberRoom,
  spawnMonsterIn,
  type DoorFilter,
  type Entity,
  type MonsterKind,
  type RoomGame,
  type RoomId,
  type Ship,
  type System,
} from "@jamrog/engine";
import { specOfShip } from "../content/derelicts.js";
import { ENFORCER, MAX_MACHINES, machineName } from "../content/monsters.js";
import { PALETTE } from "../content/palette.js";
import { isTug } from "../content/tug.js";
import { roomName } from "../content/zones.js";
import { t } from "../i18n.js";
import { canSeeDrone } from "./sight.js";

/**
 * The ship's alert — the run's time pressure, and the reason a drone cannot
 * simply out-wait everything aboard.
 *
 * The gauge belongs to the *ship*, not to the drone (design-doc.md, "Тревога,
 * охотники и как спрятаться"): it lives in `currentShip.data`, so it survives
 * walking back to the tug, and the derelict is still looking for you when you
 * come back through the airlock. Time pushes it up and so does noise; standing
 * quiet — or standing in cover — pushes it back down; near the top of it the
 * ship sends an ENFORCER that cuts doors to reach you.
 *
 * A system, not the twist: it hooks the same turn cycle but knows nothing about
 * modules, and the rig knows nothing about it.
 */

/** Top of the gauge. Every number below is design-doc.md's. */
const MAX_LEVEL = 5;
/** Turns aboard between time-driven raises. The run's first derelict is the tutorial. */
const PERIOD_FIRST_SHIP = 80;
const PERIOD = 40;
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
 * The level at which the ship answers, and the only level at which it does.
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

/**
 * Colours come from `content/palette.ts`, not `ui/theme.ts`: rules never
 * depend on the renderer, and the palette is data either way.
 */
const WARN_FG = PALETTE.warn;
const BAD_FG = PALETTE.bad;
/** The gauge turns warn at this level and bad at MAX_LEVEL. */
const WARN_LEVEL = 3;

export interface AlertState {
  /** 0..MAX_LEVEL. Each step up costs the drone one more machine aboard. */
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
  if (isState(existing)) return existing;
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

function freshState(): AlertState {
  // Both cooldowns start already expired, so the first loud turn aboard counts.
  return {
    level: 0,
    turnsAboard: 0,
    lastNoiseBump: -NOISE_COOLDOWN,
    quietTurns: 0,
    lastHunter: -HUNTER_PERIOD,
    rolls: 0,
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

/**
 * One step up the gauge. Exported because the alert is also something the game
 * provokes directly — a ship system brought online, a bulkhead cut open — not
 * only something time does.
 *
 * The gauge has exactly one output, and it is the hunter (design-doc.md,
 * "Тревога, охотники и как спрятаться": the gauge sends an ENFORCER, and at
 * five replaces it every fifteen turns and points the whole ship at the drone).
 * Everything under `HUNTER_LEVEL` buys nothing but the climb towards it.
 *
 * They used to buy a patrol each, and the balance pass measured what that cost:
 * a third spawner outside `DerelictSpec.machines`, worth one to six extra
 * machines over a sortie of thirty turns, on top of a hull's whole budget of
 * three to five. The two the document does name — the ship's own population and
 * the muster between sorties — are budgeted; this one was not, and it is the
 * reason a tutorial freighter could not be walked out of. Reinforcement between
 * sorties is `shipAnswers` below, and it is the one the document describes.
 */
export function raiseAlert(game: RoomGame, steps = 1): void {
  const st = alertState(game);
  for (let i = 0; i < steps; i++) {
    st.level = Math.min(MAX_LEVEL, st.level + 1);
    // The ship just noticed something: whatever silence had been banked is gone.
    st.quietTurns = 0;
    if (st.level >= HUNTER_LEVEL && !hunterAboard(game)) sendEnforcer(game);
  }
}

/** Is the ship's one hunter out there right now? */
export function hunterAboard(game: RoomGame): boolean {
  return game.entities.some((e) => isAlive(e) && e.name === ENFORCER.name);
}

/**
 * The ship's answer at level 3: one hunter, and never a second one.
 *
 * Distance is what makes the alert a clock rather than an ambush; the standing
 * order is what makes it arrive. Without one the hunter would see nothing on
 * the turn it wakes — a machine sees one compartment, and it starts at least
 * two away — and simply stand where it was put.
 */
function sendEnforcer(game: RoomGame): void {
  const room = pickSpawnRoom(game, alertRng(game), ENFORCER.breacher === true);
  if (room === undefined) return;

  dispatchTo(game, ENFORCER, room);
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
  // Not noise: a sound made here would settle into the field next turn and trip
  // the alert's own noise rule, so the gauge would keep raising itself.
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
  const rooms = roomsAtLeast(game.ship, game.roomOf(game.player).id, MIN_SPAWN_DOORS, breacher);
  if (rooms.length === 0) return undefined;
  const explored = rooms.filter((r) => game.ship.roomAt(r).explored);
  return rng.pick(explored.length > 0 ? explored : rooms);
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

// ------------------------------------------------------- between two sorties

/**
 * What the ship did while nobody was watching (design-doc.md, "Персистентный
 * дереликт"): it calmed down to the floor its raised systems hold it at, it
 * mustered machines into the compartments you already walked, and those
 * machines left a trail of doors they did not bother to close.
 *
 * The muster is sized by how alarmed the ship was when the drone left, not by
 * the floor it settles to — leaving at 5/5 is what makes coming back expensive,
 * and reading the floor instead would make the gauge free to fill.
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
  const alarmed = st.level;
  st.level = Math.min(st.level, onlineSystems(game));
  st.quietTurns = 0;

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
    const room = rng.pick(rooms);
    const kind = pickKind(rng, game.content.monstersForDepth(game.ship.roomAt(room).depth));
    if (!kind) continue;
    // No standing order: these are posted, not dispatched. They are waiting
    // where you have to walk, which is the whole of the threat.
    const machine = spawnMonsterIn(kind, room);
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
  },

  afterPlayerTurn(game) {
    if (game.status !== "playing" || isTug(game)) return;
    const st = alertState(game);
    st.turnsAboard++;

    const period = isFirstShip(game) ? PERIOD_FIRST_SHIP : PERIOD;
    if (st.turnsAboard % period === 0) raiseAlert(game);

    if (loudAnywhere(game) && st.turnsAboard - st.lastNoiseBump >= NOISE_COOLDOWN) {
      st.lastNoiseBump = st.turnsAboard;
      raiseAlert(game);
    }

    // At the top of the gauge the hunt never lapses: a hunter that died is
    // replaced, and everything aboard is told where you are.
    if (st.level >= MAX_LEVEL && st.turnsAboard - st.lastHunter >= HUNTER_PERIOD) {
      st.lastHunter = st.turnsAboard;
      if (!hunterAboard(game)) sendEnforcer(game);
      pointEveryoneAtTheDrone(game);
    }

    st.quietTurns = quietTurn(game) ? st.quietTurns + 1 : 0;
    const needed = game.player.hidden === true ? QUIET_TURNS_HIDDEN : QUIET_TURNS;
    if (st.level > 0 && st.quietTurns >= needed) {
      st.quietTurns = 0;
      st.level--;
      game.log.add(t("log.alert.calm"), game.schedule.time, "good", "log.alert.calm");
    }
  },

  panelLines(game) {
    // Nothing to raise an alert on the tug and nothing aboard to hunt: an empty
    // gauge at home is a counter for a rule that is not running, on the one
    // screen whose whole point is that the other half of the game is not
    // happening (docs/tasks/G53-tug-is-a-menu.md, 2).
    if (isTug(game)) return [];
    const level = alertState(game).level;
    const gauge = "▮".repeat(level) + "▯".repeat(MAX_LEVEL - level);
    const text = t("panel.alert", { gauge });
    const fg = level >= MAX_LEVEL ? BAD_FG : level >= WARN_LEVEL ? WARN_FG : undefined;
    const lines = [fg ? { text, fg } : { text }];
    if (hunterAboard(game)) lines.push({ text: t("panel.hunter"), fg: BAD_FG });
    return lines;
  },
};

/** The run's first derelict is the tutorial, and its clock runs half as fast. */
function isFirstShip(game: RoomGame): boolean {
  return game.ships.ids()[0] === game.shipId;
}
