/**
 * The event library.
 *
 * Rules never build event objects inline. Everything that can happen has a
 * named constructor here, so the set of things the game can report is a list
 * you can read in one file — and the renderer, the log and the tests all agree
 * on its shape because they all import it from here.
 *
 * An event says what happened, not what it looked like. Wording lives in the
 * UI; these carry the facts.
 */

import type { Axial } from "./hex";
import type { ObjectKind, Outcome, Side, UnitType, Weapon } from "./types";

export interface EventBase {
  readonly kind: string;
}

export interface UnitMoved extends EventBase {
  readonly kind: "unitMoved";
  readonly unitId: number;
  readonly from: Axial;
  readonly to: Axial;
  readonly enteredZone: number | null;
}

export interface MovementHalted extends EventBase {
  readonly kind: "movementHalted";
  readonly unitId: number;
  readonly by: number;
  readonly at: Axial;
}

export interface DoorForced extends EventBase {
  readonly kind: "doorForced";
  readonly unitId: number;
  readonly doorId: number;
  readonly intoZone: number;
}

export interface DoorCut extends EventBase {
  readonly kind: "doorCut";
  readonly unitId: number;
  readonly doorId: number;
}

export interface AttackDeclared extends EventBase {
  readonly kind: "attackDeclared";
  readonly attackerId: number;
  readonly targetId: number;
  readonly targetIsObject: boolean;
  readonly weapon: Weapon;
  readonly answeringWeapon: Weapon | null;
}

export interface StrikeLanded extends EventBase {
  readonly kind: "strikeLanded";
  readonly sourceId: number;
  readonly targetId: number;
  readonly targetIsObject: boolean;
  readonly damage: number;
  readonly remaining: number;
}

export interface StrikeMissed extends EventBase {
  readonly kind: "strikeMissed";
  readonly sourceId: number;
  readonly targetId: number;
  readonly targetIsObject: boolean;
}

export interface UnitDestroyed extends EventBase {
  readonly kind: "unitDestroyed";
  readonly unitId: number;
  readonly unitType: UnitType;
  readonly side: Side;
  readonly at: Axial;
}

export interface ObjectDestroyed extends EventBase {
  readonly kind: "objectDestroyed";
  readonly objectId: number;
  readonly objectKind: ObjectKind;
  readonly name: string;
  readonly at: Axial;
  readonly spawnersLeft: number;
  readonly nodesLeft: number;
}

export interface IncomePaid extends EventBase {
  readonly kind: "incomePaid";
  readonly amount: number;
  readonly pool: number;
  readonly liveNodes: number;
}

export interface HostileBuilt extends EventBase {
  readonly kind: "hostileBuilt";
  readonly unitId: number;
  readonly unitType: UnitType;
  readonly spawnerId: number;
  readonly at: Axial;
  readonly cost: number;
  readonly pool: number;
}

export interface BuildBlocked extends EventBase {
  readonly kind: "buildBlocked";
  readonly pool: number;
  readonly reason: "noRoom" | "cannotAfford" | "noSpawners";
}

export interface TurnBegan extends EventBase {
  readonly kind: "turnBegan";
  readonly turn: number;
  readonly side: Side;
}

export interface MissionEnded extends EventBase {
  readonly kind: "missionEnded";
  readonly outcome: Outcome;
  readonly turn: number;
}

export interface CommandRefused extends EventBase {
  readonly kind: "commandRefused";
  readonly reason: string;
}

export type GameEvent =
  | UnitMoved
  | MovementHalted
  | DoorForced
  | DoorCut
  | AttackDeclared
  | StrikeLanded
  | StrikeMissed
  | UnitDestroyed
  | ObjectDestroyed
  | IncomePaid
  | HostileBuilt
  | BuildBlocked
  | TurnBegan
  | MissionEnded
  | CommandRefused;

/* ---------- constructors ---------- */

export function unitMoved(
  unitId: number,
  from: Axial,
  to: Axial,
  enteredZone: number | null,
): UnitMoved {
  return { kind: "unitMoved", unitId, from, to, enteredZone };
}

export function movementHalted(unitId: number, by: number, at: Axial): MovementHalted {
  return { kind: "movementHalted", unitId, by, at };
}

export function doorForced(unitId: number, doorId: number, intoZone: number): DoorForced {
  return { kind: "doorForced", unitId, doorId, intoZone };
}

export function doorCut(unitId: number, doorId: number): DoorCut {
  return { kind: "doorCut", unitId, doorId };
}

export function attackDeclared(
  attackerId: number,
  targetId: number,
  targetIsObject: boolean,
  weapon: Weapon,
  answeringWeapon: Weapon | null,
): AttackDeclared {
  return { kind: "attackDeclared", attackerId, targetId, targetIsObject, weapon, answeringWeapon };
}

export function strikeLanded(
  sourceId: number,
  targetId: number,
  targetIsObject: boolean,
  damage: number,
  remaining: number,
): StrikeLanded {
  return { kind: "strikeLanded", sourceId, targetId, targetIsObject, damage, remaining };
}

export function strikeMissed(
  sourceId: number,
  targetId: number,
  targetIsObject: boolean,
): StrikeMissed {
  return { kind: "strikeMissed", sourceId, targetId, targetIsObject };
}

export function unitDestroyed(
  unitId: number,
  unitType: UnitType,
  side: Side,
  at: Axial,
): UnitDestroyed {
  return { kind: "unitDestroyed", unitId, unitType, side, at };
}

export function objectDestroyed(
  objectId: number,
  objectKind: ObjectKind,
  name: string,
  at: Axial,
  spawnersLeft: number,
  nodesLeft: number,
): ObjectDestroyed {
  return { kind: "objectDestroyed", objectId, objectKind, name, at, spawnersLeft, nodesLeft };
}

export function incomePaid(amount: number, pool: number, liveNodes: number): IncomePaid {
  return { kind: "incomePaid", amount, pool, liveNodes };
}

export function hostileBuilt(
  unitId: number,
  unitType: UnitType,
  spawnerId: number,
  at: Axial,
  cost: number,
  pool: number,
): HostileBuilt {
  return { kind: "hostileBuilt", unitId, unitType, spawnerId, at, cost, pool };
}

export function buildBlocked(pool: number, reason: BuildBlocked["reason"]): BuildBlocked {
  return { kind: "buildBlocked", pool, reason };
}

export function turnBegan(turn: number, side: Side): TurnBegan {
  return { kind: "turnBegan", turn, side };
}

export function missionEnded(outcome: Outcome, turn: number): MissionEnded {
  return { kind: "missionEnded", outcome, turn };
}

export function commandRefused(reason: string): CommandRefused {
  return { kind: "commandRefused", reason };
}
