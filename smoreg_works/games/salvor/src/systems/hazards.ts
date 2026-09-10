import {
  TURN_COST,
  dealDamage,
  isAlive,
  type ActionOffer,
  type Door,
  type Entity,
  type Outcome,
  type RoomCommand,
  type RoomGame,
  type RoomId,
  type System,
} from "@jamrog/engine";
import type { DerelictSpec } from "../content/derelicts.js";
import {
  FROST_FLOOR,
  FROST_PENALTY,
  HAZARDS,
  HEAT_NOISE,
  MAX_HAZARDS_ABOARD,
  MINE_DAMAGE,
  MINE_MACHINE_DAMAGE,
  hazardKind,
  isHazardId,
  type HazardId,
} from "../content/hazards.js";
import { moduleBurnLine, moduleName } from "../content/modules.js";
import { machineName } from "../content/monsters.js";
import { TUG_ID, isTug } from "../content/tug.js";
import { verbWord } from "../content/words.js";
import { roomName } from "../content/zones.js";
import { t } from "../i18n.js";
import { capitalize } from "../names.js";
import { applyDerived, blamedOn, derivedStats, findSlot, rigOf, routeDamage } from "../twist/rig.js";
import { raiseAlert } from "./alert.js";
import {
  doorHazard,
  hazardRecords,
  hazardStore,
  markHazard,
  removeHazard,
  roomHazard,
  threatAboard,
  type HazardRecord,
} from "./hazardstate.js";

/**
 * The hazards of a hull: where they go, when the drone hears about them, and
 * what the two on a compartment do (`content/hazards.ts`). The mine's other
 * half — lifting it with the welder — is the doors' (`systems/doors.ts`);
 * tripping it is here, because tripping is a *step* and steps are what this
 * system watches.
 *
 * The sign is the whole design. A hazard is told from the compartment next to
 * it, once a sortie, in red, the turn the drone walks in there; and from that
 * moment it is marked on the schematic and known to every walk
 * (`ui/auto.ts`, `dangerAhead`). That is what puts a player's turn between
 * learning of a thing and being hurt by it, and it holds on the first turn
 * aboard as well — boarding is walking in.
 */

/** Verb the drone spends warming an iced compartment with the CELL. */
const HEAT = "heat";

/** Integrity the heater takes out of the CELL: the same point a lock costs. */
const HEAT_COST = 1;

/** The name a machine's own per-entity bag keeps its last compartment under. */
const LAST_ROOM = "hazardRoom";

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

// ---------------------------------------------------------------- placing

/**
 * Draw this class's hazards onto the hull, first boarding only
 * (`systems/populate.ts` calls it beside `placeRelic`).
 *
 * From the class's own list, with repetition, until the next draw would go
 * over the class's budget or there is nowhere left to put one: a compartment
 * hazard wants a compartment that is not the airlock's and carries nothing
 * yet, a door trap wants a door between two compartments that is neither the
 * airlock, welded shut, nor on the airlock compartment — the first step of a
 * sortie is never the one that blows.
 *
 * Never on the first derelict of a voyage, whatever its class. The report's
 * budget table gives the first hull one point at most; this game gives it
 * none, because it is the hull the game is learned on and a rule is what the
 * tutorial can rely on where a low roll is not.
 */
export function placeHazards(game: RoomGame, spec: DerelictSpec | undefined): HazardRecord[] {
  const placed: HazardRecord[] = [];
  const pool = spec?.hazards ?? [];
  const threat = spec?.threat ?? 0;
  if (pool.length === 0 || threat <= 0 || isFirstDerelict(game)) return placed;

  const store = hazardStore(game);
  let spent = threatAboard(store);
  for (let guard = 0; guard < MAX_HAZARDS_ABOARD; guard++) {
    const id = game.rng.pick(pool);
    const kind = HAZARDS[id];
    if (spent + kind.level > threat) break;
    const rec = kind.on === "door" ? placeOnDoor(game, store, id) : kind.on === "room" ? placeInRoom(game, store, id) : undefined;
    if (!rec) break;
    store.push(rec);
    markHazard(game.ship, rec);
    placed.push(rec);
    spent += kind.level;
  }
  return placed;
}

function placeInRoom(game: RoomGame, store: readonly HazardRecord[], id: HazardId): HazardRecord | undefined {
  const entry = game.ship.entry;
  const rooms = game.ship.rooms.filter(
    (r) => r.id !== entry && r.hazard === "none" && !store.some((h) => h.room === r.id),
  );
  if (rooms.length === 0) return undefined;
  return { id, room: game.rng.pick(rooms).id, known: false };
}

function placeOnDoor(game: RoomGame, store: readonly HazardRecord[], id: HazardId): HazardRecord | undefined {
  const entry = game.ship.entry;
  const doors = game.ship.doors.filter(
    (d) =>
      d.a !== d.b &&
      d.state !== "airlock" &&
      d.state !== "sealed" &&
      d.trap === undefined &&
      d.a !== entry &&
      d.b !== entry &&
      !store.some((h) => h.door === d.id),
  );
  if (doors.length === 0) return undefined;
  return { id, door: game.rng.pick(doors).id, known: false };
}

/**
 * The run's first derelict: the same reading `systems/alert.ts` uses for the
 * tutorial clock. The first *derelict*, not the first ship in the store — a
 * run starts on the tug.
 */
function isFirstDerelict(game: RoomGame): boolean {
  return game.ships.ids().find((id) => id !== TUG_ID) === game.shipId;
}

// ------------------------------------------------------------------ the sign

/**
 * The red line for one hazard, as read from the compartment `here`: the door
 * it lies beyond and the compartment it fills, or the door it is on and where
 * that leads. Nothing when `here` is not next to it — a sign is given from
 * next door and from nowhere else — and nothing from inside the hazard, where
 * the compartment block already says the word.
 *
 * `via` names the door when the caller is asking about one in particular
 * (`ui/auto.ts`, `dangerAhead`); the sign itself takes the lowest-numbered
 * door into the compartment, so a seed says the same line twice.
 */
export function hazardLine(game: RoomGame, rec: HazardRecord, here: RoomId, via?: Door): string | undefined {
  const ship = game.ship;
  const kind = hazardKind(rec.id);
  if (!kind) return undefined;
  if (rec.door !== undefined) {
    const door = ship.doorAt(rec.door);
    if (door.a !== here && door.b !== here) return undefined;
    return t(kind.tell, { door: door.label, room: roomName(ship.roomAt(ship.other(door, here))) });
  }
  if (rec.room === undefined || rec.room === here) return undefined;
  const door =
    via ??
    ship
      .doorsOf(here)
      .filter((d) => ship.other(d, here) === rec.room)
      .sort((a, b) => a.id - b.id)[0];
  if (!door) return undefined;
  return t(kind.tell, { door: door.label, room: roomName(ship.roomAt(rec.room)) });
}

/** Is the ship still carrying what the record says it is? */
function live(game: RoomGame, rec: HazardRecord): boolean {
  const records = hazardRecords(game);
  if (rec.room !== undefined) return roomHazard(game.ship, records, rec.room) === rec;
  if (rec.door !== undefined) return doorHazard(game.ship, records, rec.door) === rec;
  return false;
}

/**
 * Say what is next to the drone, once a sortie per hazard. The compartment the
 * drone is standing in counts as told without a line: the block under the
 * schematic names it, and a line about the room you are in is not a warning.
 */
function tell(game: RoomGame): void {
  const here = game.roomOf(game.player).id;
  const visits = game.currentShip.visits;
  for (const rec of hazardRecords(game)) {
    if (rec.told === visits || !live(game, rec)) continue;
    if (rec.room === here) {
      rec.known = true;
      rec.told = visits;
      continue;
    }
    const line = hazardLine(game, rec, here);
    if (line === undefined) continue;
    rec.known = true;
    rec.told = visits;
    rec.toldAfter = game.inputs.length;
    game.log.add(line, game.schedule.time, "alarm", hazardKind(rec.id)!.tell);
  }
}

/**
 * Hazards the drone has been told about this sortie, by a name that survives
 * a record being removed: what a walk snapshots to notice a new sign
 * (`ui/auto.ts`, `makeWatch`).
 */
export function signsGiven(game: RoomGame): string[] {
  const visits = game.currentShip.visits;
  return hazardRecords(game)
    .filter((r) => r.told === visits)
    .map((r) => `${r.id}:${r.room ?? "-"}:${r.door ?? "-"}`);
}

// ----------------------------------------------------------------- effects

/**
 * The frost: the drone's speed, as the rack gives it, less the penalty while
 * it stands on ice nobody has warmed this sortie.
 *
 * Written onto the entity rather than into the rack, because the rack knows
 * nothing about compartments and `applyDerived` will keep rewriting speed
 * from the rack alone. So this is re-applied after the drone's turn and after
 * every machine's — a burned module in between would otherwise thaw the ice
 * for the rest of the round.
 */
function chill(game: RoomGame): void {
  const rig = rigOf(game.player);
  if (!rig || isTug(game)) return;
  const base = derivedStats(rig).speed;
  const rec = roomHazard(game.ship, hazardRecords(game), game.roomOf(game.player).id);
  const frozen = rec?.id === "frost" && rec.heated !== game.currentShip.visits;
  game.player.speed = frozen ? Math.max(FROST_FLOOR, base - FROST_PENALTY) : base;
}

/**
 * The mine goes off under whoever crossed first. For the drone that is a blow
 * into whatever the step exposed, one rung of the alert, and the ship's own
 * death hook if it was the last point; for a machine, a blow and nothing
 * else — the ship does not alarm at its own machinery.
 *
 * True when it killed the drone: the death hook has moved the operator home
 * by then, and the caller must not read the ship it was on.
 */
function tripMine(game: RoomGame, rec: HazardRecord, door: Door, victim: Entity): boolean {
  removeHazard(game, rec);
  if (victim.id === game.player.id) {
    game.log.add(t("log.hazard.mine.hit", { door: door.label }), game.schedule.time, "bad", "log.hazard.mine.hit");
    blamedOn("log.hit.mine", () => dealDamage(game, game.player, MINE_DAMAGE));
    raiseAlert(game, 1);
    if (isAlive(game.player)) return false;
    game.onDeath(game.player);
    return true;
  }
  if (victim.room !== undefined && game.visible.has(victim.room)) {
    game.log.add(
      t("log.hazard.mine.machine", { machine: capitalize(machineName(victim.name)), door: door.label }),
      game.schedule.time,
      "warn",
      "log.hazard.mine.machine",
    );
  }
  if (dealDamage(game, victim, MINE_MACHINE_DAMAGE).killed) game.onDeath(victim);
  return false;
}

/**
 * The one door a machine walked through between two compartments: the lowest
 * numbered one it could pass, which is the one the engine's own pathing hands
 * it first. Two rooms joined twice with a mine on one of the two is a shape no
 * generated hull has and a guess this makes the same way every time.
 */
function crossed(game: RoomGame, from: RoomId, to: RoomId): Door | undefined {
  return game.ship
    .doorsOf(from)
    .filter((d) => game.ship.other(d, from) === to && game.ship.passable(d, {}))
    .sort((a, b) => a.id - b.id)[0];
}

/** Remember where every machine stands, so its next move is a door and not a teleport. */
function watchMachines(game: RoomGame): void {
  for (const e of game.entities) {
    if (e.id === game.player.id) continue;
    (e.data ??= {})[LAST_ROOM] = e.room;
  }
}

// -------------------------------------------------------------------- heat

function heatOffer(game: RoomGame): Array<ActionOffer<RoomCommand>> {
  const room = game.roomOf(game.player);
  const rec = roomHazard(game.ship, hazardRecords(game), room.id);
  if (rec?.id !== "frost" || rec.heated === game.currentShip.visits) return [];
  const rig = rigOf(game.player);
  const has = rig !== undefined && findSlot(rig, "cell") !== null;
  const offer: ActionOffer<RoomCommand> = {
    label: `${verbWord(HEAT)} ${room.label}`,
    cmd: { kind: "act", verb: HEAT, target: room.id },
    enabled: has,
  };
  if (!has) offer.why = t("why.module.missing", { module: moduleName("cell") });
  return [offer];
}

/**
 * A point of the CELL into the heaters: the ice is gone until the drone leaves
 * the ship. Spent through the rig's own damage path, as a lock is
 * (`systems/doors.ts`, `spendCell`), so a CELL on its last point burns out the
 * way it burns out everywhere else.
 */
function heat(game: RoomGame, target: number | undefined): Outcome {
  const room = game.roomOf(game.player);
  const rec = roomHazard(game.ship, hazardRecords(game), room.id);
  if (target !== room.id || rec?.id !== "frost") return FAIL(t("why.hazard.noFrost"));
  if (rec.heated === game.currentShip.visits) return FAIL(t("why.hazard.heated", { room: roomName(room) }));
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "cell") : null;
  if (!rig || slot === null) return FAIL(t("why.module.missing", { module: moduleName("cell") }));

  rig.exposed = slot;
  for (const hit of routeDamage(rig, HEAT_COST, ["corrosive"]).hits) {
    if (hit.burned) game.log.add(moduleBurnLine(hit.kind), game.schedule.time, "bad", "log.module.burn");
  }
  applyDerived(game.player);
  rec.heated = game.currentShip.visits;
  game.makeNoise(room.id, HEAT_NOISE);
  game.log.add(
    t("log.hazard.heat", { module: moduleName("cell"), room: roomName(room) }),
    game.schedule.time,
    "good",
    "log.hazard.heat",
  );
  return DONE();
}

// ------------------------------------------------------------------ boarding

/**
 * Bring the record and the ship into step on boarding: a hazard a fixture
 * wrote straight onto the ship gets its record, a record the ship no longer
 * backs (the alert vented the compartment) is dropped, and every live one is
 * written back so a smoke compartment is opaque whichever way it was made.
 */
function adopt(game: RoomGame): void {
  const ship = game.ship;
  const existing = hazardRecords(game);
  const fresh: HazardRecord[] = [];
  for (const room of ship.rooms) {
    if (isHazardId(room.hazard) && !existing.some((r) => r.room === room.id)) {
      fresh.push({ id: room.hazard, room: room.id, known: false });
    }
  }
  for (const door of ship.doors) {
    if (isHazardId(door.trap) && !existing.some((r) => r.door === door.id)) {
      fresh.push({ id: door.trap, door: door.id, known: false });
    }
  }
  if (existing.length === 0 && fresh.length === 0) return;

  const store = hazardStore(game);
  store.push(...fresh);
  for (const rec of [...store]) {
    if (live(game, rec)) markHazard(ship, rec);
    else removeHazard(game, rec);
  }
}

// ---------------------------------------------------------------- the system

export const HAZARD: System<RoomGame> = {
  name: "hazards",

  onLevelEnter(game) {
    if (isTug(game)) return;
    adopt(game);
    chill(game);
    tell(game);
    watchMachines(game);
  },

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== HEAT) return undefined;
    return heat(game, cmd.target);
  },

  offerActions(game) {
    if (game.status !== "playing" || isTug(game)) return [];
    return heatOffer(game);
  },

  /**
   * After the drone's own step: the mine under it, the ice under it, and the
   * sign for whatever is next to where it now stands. A `go` that resolved is
   * a compartment changed — nothing else moves the drone within a ship, and a
   * change of ship comes through `onLevelEnter`.
   */
  afterPlayerTurn(game, cmd) {
    if (game.status !== "playing" || isTug(game)) return;
    if (cmd.kind === "go") {
      const rec = doorHazard(game.ship, hazardRecords(game), cmd.door);
      if (rec?.id === "mine" && tripMine(game, rec, game.ship.doorAt(cmd.door), game.player)) return;
    }
    chill(game);
    if (cmd.kind === "go") tell(game);
    watchMachines(game);
  },

  /**
   * After a machine's: did it just come through a mined door? The first one
   * through takes the blast, and a machine walked into it ahead of the drone
   * is the report's second way of lifting a mine.
   */
  afterActorTurn(game, actor) {
    if (isTug(game) || actor.id === game.player.id) return;
    const was = actor.data?.[LAST_ROOM];
    const now = actor.room;
    if (typeof was === "number" && now !== undefined && was !== now && isAlive(actor)) {
      const door = crossed(game, was, now);
      const rec = door === undefined ? undefined : doorHazard(game.ship, hazardRecords(game), door.id);
      if (door && rec?.id === "mine") tripMine(game, rec, door, actor);
    }
    (actor.data ??= {})[LAST_ROOM] = now;
    chill(game);
  },
};
