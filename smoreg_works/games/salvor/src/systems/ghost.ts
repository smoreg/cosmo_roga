import {
  Rng,
  RoomDistance,
  canSee,
  isAlive,
  spawnMonsterIn,
  type DoorFilter,
  type Entity,
  type MonsterKind,
  type RoomGame,
  type RoomId,
  type System,
} from "@jamrog/engine";
import { MODULES, type ModuleId } from "../content/modules.js";
import { CROWD } from "../content/monsters.js";
import { notePost } from "./alert.js";
import { t } from "../i18n.js";
import { addWreck, capOf, type Rig, type WreckSource } from "../twist/rig.js";

/**
 * The drone you lost, wearing the rack you lost with it.
 *
 * A dead drone leaves two things on a derelict (design-doc.md, "Призраки"):
 * its modules on the floor of the compartment it died in, and — the next time
 * the run comes aboard — a GHOST one or two doors away with the same rack, the
 * same reach and the same speed. Two objects, not one: the wreckage is the run
 * getting its rig back, the ghost is what the ship did with the drone.
 *
 * The system is the cheapest proof of the game's own premise. Nothing here is
 * new machinery — a rig is flat data, a spawn is one call — and yet it is the
 * one place that says out loud that a drone is equipment and not a life: what
 * dies aboard stays aboard, and it is still armed.
 *
 * A system rather than part of the twist: the rig knows nothing about deaths
 * and the ghost knows nothing about how damage routes. What connects them is
 * the death record, which the voyage keeps (`deathsOf`) and this file reads.
 */

/** Living ghosts one derelict holds at once. A third death feeds the oldest. */
export const MAX_GHOSTS = 2;
/** What that third death adds to it instead of standing up on its own. */
export const GHOST_REINFORCE_HP = 2;
/** Core hit points before the rack it wears is counted. */
const GHOST_BASE_HP = 4;
/** Doors between the wreckage and the thing wearing the rest of the rack. */
const MIN_DOORS = 1;
const MAX_DOORS = 2;

/** Ramming: a rack with nothing in it that cuts still has a chassis. */
const RAM: readonly [number, number, number] = [1, 1, 0];
/**
 * What can be swung or fired: every module the catalogue gives dice to, the
 * relic blade among them. The best of them arms the ghost — read off the table
 * rather than listed here, so a weapon added to the catalogue arms a ghost
 * without this file hearing about it.
 */
const ATTACK_MODULES: readonly ModuleId[] = (Object.keys(MODULES) as ModuleId[]).filter(
  (id) => MODULES[id].attack !== undefined,
);

export const GHOST_ID = "ghost";
export const GHOST_NAME = "ghost";
/**
 * The drone's own `#f0e6d2`, gone grey: the one glyph aboard that is supposed
 * to look like the player's colour remembered wrong.
 */
const GHOST_FG = "#b7ab97";

/** Said once per run, the turn the first ghost comes into view. */
const SIGHTED_KEY = "log.ghost.sighted";
/** Said when one comes apart, because five wrecks appearing in silence read as nothing. */
const DROP_KEY = "log.ghost.drop";
/** Onboarding, shown at the first death by the hint table — not from here; the drone is on the tug. */
export const GHOST_HINT_KEY = "hint.death";

/** Flag in `player.data.hints`, so the line is said once a run and not once a sortie. */
const HINT_FLAG = "ghost";
/**
 * Keeps this system's stream clear of the alert's. Both fork the ship's
 * `scheduleSeed`, so without an offset the two would draw the same numbers for
 * different questions — replayable, but correlated for no reason.
 */
const GHOST_SALT = 0x6768;

// ------------------------------------------------------------- what is left

/**
 * One drone lost on one derelict: where it died and what it was carrying.
 *
 * `ghostSpawned` is written back onto the record, so a ship the run walks into
 * five times raises one ghost and not five. `shipId` is what keeps a derelict's
 * dead off the tug when the records are kept in one flat list.
 */
export interface Death {
  room: RoomId;
  rig: Rig;
  /** True once this ship has answered the record. The record itself stays. */
  ghostSpawned?: boolean;
  /** Which derelict it happened on. Filtered by when present. */
  shipId?: string;
}

/**
 * The deaths that belong to the ship the drone is standing on.
 *
 * Three addresses, in order, because the voyage state (G26) lands in parallel
 * with this file: its per-derelict records, a flat list on the voyage, and
 * `player.data.deaths` for a test that wants neither. The first is the shape
 * to keep — selecting the record by `shipId` is also what stops a ghost from
 * rising in the tug's galley.
 *
 * The array is fresh but its entries are the live records, so writing
 * `ghostSpawned` through one of them persists.
 */
export function deathsOf(game: RoomGame): Death[] {
  const data = game.player.data;
  if (!data) return [];

  const voyage = data.voyage;
  if (isRecord(voyage)) {
    const states = voyage.state;
    if (Array.isArray(states)) {
      const here = states.find((s) => isRecord(s) && s.shipId === game.shipId);
      return isRecord(here) ? deathList(here.deaths, game) : [];
    }
    if (Array.isArray(voyage.deaths)) return deathList(voyage.deaths, game);
  }
  return deathList(data.deaths, game);
}

function deathList(raw: unknown, game: RoomGame): Death[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (d): d is Death => isDeath(d) && (d.shipId === undefined || d.shipId === game.shipId),
  );
}

/** Records round-trip through a save file, so nothing in one may be trusted. */
function isDeath(raw: unknown): raw is Death {
  if (!isRecord(raw)) return false;
  return typeof raw.room === "number" && isRecord(raw.rig) && Array.isArray(raw.rig.slots);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

// ------------------------------------------------------------- the machine

/**
 * The machine a rack makes. Built here rather than in content/monsters.ts on
 * purpose: there is no ghost archetype to put in a table — every ghost is a
 * different set of numbers, because it is a different rack.
 *
 * `sight: 1` and `brute` are the whole of its behaviour: it looks one door out
 * and walks at whatever it sees. It never opens the airlock (`passable` gives
 * that door to the player alone), so a ghost never leaves the ship it is on.
 */
export function ghostKind(rig: Rig): MonsterKind {
  const modules = moduleCount(rig);
  return {
    id: GHOST_ID,
    name: GHOST_NAME,
    ch: "G",
    fg: GHOST_FG,
    hp: GHOST_BASE_HP + modules,
    damage: bestAttack(rig),
    defense: 0,
    speed: 100,
    fovRadius: 6,
    behaviour: "brute",
    sight: 1,
    minDepth: 0,
    maxDepth: 99,
    weight: 0,
  };
}

/** Intact modules on the rack: what a ghost's hit points are counted from. */
export function moduleCount(rig: Rig): number {
  return rig.slots.filter((s) => s !== null).length;
}

/**
 * The best swing or shot the rack can make, by expected roll.
 *
 * Not `derivedStats`: that one ignores the EMITTER because a shot is a command
 * and not a stat, and a ghost has no commands — everything it carries has to
 * come out of the same bump attack or it might as well not be carrying it.
 */
export function bestAttack(rig: Rig): [number, number, number] {
  let best: readonly [number, number, number] | undefined;
  for (const id of ATTACK_MODULES) {
    if (!rig.slots.some((s) => s?.kind === id)) continue;
    const attack = MODULES[id].attack;
    if (attack && (!best || expected(attack) > expected(best))) best = attack;
  }
  const pick = best ?? RAM;
  return [pick[0], pick[1], pick[2]];
}

function expected(a: readonly [number, number, number]): number {
  return (a[0] * (a[1] + 1)) / 2 + a[2];
}

export function isGhost(e: Entity): boolean {
  return e.name === GHOST_NAME;
}

/** Ghosts walking this ship right now, oldest first. */
export function ghostsAboard(game: RoomGame): Entity[] {
  return game.entities.filter((e) => isGhost(e) && isAlive(e));
}

/**
 * The rack a ghost wears. Its own key rather than `data.rig`: only the drone
 * has a rig in the sense the twist means, and nothing that reads `rigOf` should
 * start finding machines.
 */
export function ghostRigOf(e: Entity): Rig | undefined {
  const raw = e.data?.ghostRig;
  return isRecord(raw) && Array.isArray(raw.slots) ? (raw as unknown as Rig) : undefined;
}

// -------------------------------------------------------------- the system

export const GHOST: System<RoomGame> = {
  name: "ghost",

  /**
   * Every sortie asks the ship what it did with its dead. A record it has
   * already answered is left alone, which is what makes coming back to a ship
   * that killed you twice cost two ghosts and not four.
   */
  onLevelEnter(game) {
    for (const death of deathsOf(game)) {
      if (death.ghostSpawned === true || !aboard(game, death.room)) continue;
      death.ghostSpawned = true;
      dropRig(game, death.room, death.rig, "drone");
      raise(game, death);
    }
  },

  /**
   * The one line the mechanic is owed, said the turn a ghost is first in view.
   *
   * Checked here rather than from the renderer because a hint is a rule of the
   * run: the flag lives on the player, so it survives the sortie and is not
   * said again on the ship after this one.
   */
  afterPlayerTurn(game) {
    const said = hints(game.player);
    if (said[HINT_FLAG] === true) return;
    if (!ghostsAboard(game).some((g) => canSee(game.ship, game.player, g))) return;
    said[HINT_FLAG] = true;
    game.log.add(t(SIGHTED_KEY), game.schedule.time, "bad", SIGHTED_KEY);
  },

  /**
   * Killed, it drops the whole rack — every module it was wearing, not the one
   * piece of scrap a machine leaves. That is the deal the design makes with the
   * player: the rig you lost is recoverable, and what it costs is the fight.
   */
  onDeath(game, victim) {
    if (!isGhost(victim) || victim.room === undefined) return;
    const rig = ghostRigOf(victim);
    if (!rig) return;
    if (dropRig(game, victim.room, rig, "ghost") > 0) {
      game.log.add(t(DROP_KEY), game.schedule.time, "plain", DROP_KEY);
    }
  },
};

// ------------------------------------------------------------------- pieces

/**
 * One ghost, or two points on the one already walking.
 *
 * The cap is what keeps a run that keeps dying on one derelict from turning it
 * into a wall of its own drones. The oldest is the one that grows, so the thing
 * the player has already met is the thing that got worse.
 */
function raise(game: RoomGame, death: Death): void {
  const living = ghostsAboard(game);
  if (living.length >= MAX_GHOSTS) {
    const oldest = living[0]!;
    oldest.hp += GHOST_REINFORCE_HP;
    oldest.hpMax += GHOST_REINFORCE_HP;
    return;
  }

  const room = pickRoom(game, death.room);
  if (room === undefined) return;
  const ghost = spawnMonsterIn(ghostKind(death.rig), room);
  ghost.data = { ...(ghost.data ?? {}), ghostRig: copyRig(death.rig) };
  notePost(ghost);
  game.schedule.admit(ghost);
  game.entities.push(ghost);
}

/**
 * One or two doors from the wreckage, by a machine's own walking rules — so a
 * ghost is never posted behind a bulkhead it cannot open, and the pile of your
 * modules is never the same compartment as the thing guarding it.
 *
 * A compartment sealed off from everything falls back to the wreckage itself:
 * a ghost that cannot be placed is a death record that silently did nothing.
 */
function pickRoom(game: RoomGame, from: RoomId): RoomId | undefined {
  const walk: DoorFilter = (d) => game.ship.passable(d, {});
  const map = RoomDistance.from(game.ship, [from], walk);
  // Never into a compartment already as full as one gets (`CROWD`): a ghost
  // is one more machine in the drone's way, and three is the most there are.
  const band = game.ship.rooms
    .map((r) => r.id)
    .filter((id) => map.at(id) >= MIN_DOORS && map.at(id) <= MAX_DOORS && !crowded(game, id));
  if (band.length === 0) return crowded(game, from) ? undefined : from;

  // Not on the drone's head the turn it comes aboard: the ghost is something
  // to walk into, not an ambush in the airlock.
  const here = game.roomOf(game.player).id;
  const clear = band.filter((id) => id !== here);
  return ghostRng(game).pick(clear.length > 0 ? clear : band);
}

function crowded(game: RoomGame, room: RoomId): boolean {
  return game.entities.filter((e) => e.room === room && e.id !== game.player.id && isAlive(e)).length >= CROWD;
}

/**
 * One wreck per intact module, in the compartment named.
 *
 * Off the ship's own seed and never off `game.rng`: `addWreck` takes ids from
 * the ship's counter and integrity straight from the slot, so laying a rack out
 * is not a roll at all, and the run's stream is untouched by whether a ghost
 * rose this sortie. Returns how many pieces went on the floor.
 */
function dropRig(game: RoomGame, room: RoomId, rig: Rig, source: WreckSource): number {
  let dropped = 0;
  for (const slot of rig.slots) {
    if (!slot || !MODULES[slot.kind]) continue;
    const integrity = Math.max(1, Math.min(slot.integrity, capOf(slot)));
    const wreck = addWreck(game, room, slot.kind, integrity);
    wreck.source = source;
    // A spent coil stays spent on the floor: what the dead drone had left is
    // what the pile holds, charges included.
    if (slot.charges !== undefined) wreck.charges = slot.charges;
    dropped++;
  }
  return dropped;
}

/**
 * One stream per placement, forked off the ship's seed rather than drawn from
 * `game.rng` — the alert's rule (systems/alert.ts) and for its reason: a system
 * that spends the run's stream re-rolls everything after it, so switching
 * ghosts on would silently change every other seed in the game.
 */
function ghostRng(game: RoomGame): Rng {
  const data = game.currentShip.data;
  const raw = data.ghostRolls;
  const rolls = typeof raw === "number" ? raw : 0;
  data.ghostRolls = rolls + 1;
  return new Rng(game.currentShip.scheduleSeed).fork(GHOST_SALT + rolls);
}

/** A room id this ship actually has. A record from another hull is not one. */
function aboard(game: RoomGame, room: RoomId): boolean {
  return Number.isInteger(room) && room >= 0 && room < game.ship.size;
}

/** The ghost's copy of the rack: the record keeps its own, unshared. */
function copyRig(rig: Rig): Rig {
  return {
    slots: rig.slots.map((s) => (s ? { ...s } : null)),
    exposed: typeof rig.exposed === "number" ? rig.exposed : null,
    burnedCount: rig.burnedCount ?? 0,
    burned: [...(rig.burned ?? [])],
    scars: [...(rig.scars ?? [])],
  };
}

/** The same record the twist says its onboarding lines through. */
function hints(player: Entity): Record<string, boolean> {
  const data = (player.data ??= {});
  const existing = data.hints as Record<string, boolean> | undefined;
  if (existing) return existing;
  const fresh: Record<string, boolean> = {};
  data.hints = fresh;
  return fresh;
}
