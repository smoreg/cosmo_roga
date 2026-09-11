/**
 * The two things anything on the map can do: move a hex, or attack a
 * neighbour. Both the player's commands and the ship's own turn go through
 * these, so the ship can never do something a drone could not.
 *
 * They live here rather than in `apply.ts` so that the turn logic and the
 * command dispatcher can both depend on them without depending on each other.
 */

import { answeringWeapon, resolveExchange } from "./combat";
import { cellAt } from "./deck";
import {
  commandRefused,
  doorCut,
  doorForced,
  missionEnded,
  movementHalted,
  objectDestroyed,
  unitDestroyed,
  unitMoved,
} from "./events";
import type { GameEvent } from "./events";
import type { Axial } from "./hex";
import { intentFor } from "./intent";
import { SHIP_UNIT_TYPES, profileOf } from "./roster";
import { drones, isHostile, isLiveNode, isLiveSpawner, unitById } from "./topology";
import type { DeckMap, DoorState, GameState, MapObject, Unit } from "./types";

export interface Applied {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export function refused(state: GameState, reason: string): Applied {
  return { state, events: [commandRefused(reason)] };
}

/** Swap one item of a readonly list by id, leaving the rest untouched. */
function replaceById<T extends { readonly id: number }>(items: readonly T[], updated: T): T[] {
  const out: T[] = [];
  for (const item of items) out.push(item.id === updated.id ? updated : item);
  return out;
}

export function replaceUnit(state: GameState, updated: Unit): GameState {
  return { ...state, units: replaceById(state.units, updated) };
}

export function replaceObject(state: GameState, updated: MapObject): GameState {
  return { ...state, objects: replaceById(state.objects, updated) };
}

export function setDoorState(state: GameState, doorId: number, doorState: DoorState): GameState {
  const doorStates = new Map(state.doorStates);
  doorStates.set(doorId, doorState);
  return { ...state, doorStates };
}

/**
 * Could the ship ever put anything else on the board?
 *
 * Not "can it right now": a pool short of the cheapest hostile still counts
 * while a single node is paying, because it will get there. Once the nodes are
 * cut the pool is frozen, and if it cannot afford the cheapest thing it never
 * will.
 */
export function canStillBuild(state: GameState): boolean {
  if (state.objects.filter(isLiveSpawner).length === 0) return false;
  const income = state.objects.filter(isLiveNode).length * state.incomePerNode;
  if (income > 0) return true;
  let cheapest = Infinity;
  for (const type of SHIP_UNIT_TYPES) cheapest = Math.min(cheapest, profileOf(type).cost);
  return state.pool >= cheapest;
}

/**
 * Win when the ship has nothing left to throw at you, lose when both drones
 * are gone.
 *
 * Levelling every spawn zone is the obvious way to win. The other is quieter:
 * cut the nodes, kill what is already aboard, and the ship is left with
 * spawners it can never pay for. Making the player walk to each spawner after
 * that would be bookkeeping, not a decision.
 */
export function checkOutcome(state: GameState): Applied {
  if (state.outcome !== null) return { state, events: [] };
  if (drones(state).length === 0) {
    return { state: { ...state, outcome: "loss" }, events: [missionEnded("loss", state.turn)] };
  }
  if (state.objects.filter(isLiveSpawner).length === 0) {
    return { state: { ...state, outcome: "win" }, events: [missionEnded("win", state.turn)] };
  }
  const aboard = state.units.filter(isHostile).length;
  if (aboard === 0 && !canStillBuild(state)) {
    return { state: { ...state, outcome: "win" }, events: [missionEnded("win", state.turn)] };
  }
  return { state, events: [] };
}

export function moveUnitTo(deck: DeckMap, state: GameState, unitId: number, to: Axial): Applied {
  const unit = unitById(state, unitId);
  if (unit === null) return refused(state, "no such unit");

  const intent = intentFor(deck, state, unit, to);
  if (intent.kind !== "move") return refused(state, "that move is not legal");

  const fromCell = cellAt(deck, unit.at);
  const toCell = cellAt(deck, to);
  const enteredZone =
    fromCell !== null && toCell !== null && fromCell.zoneId !== toCell.zoneId
      ? toCell.zoneId
      : null;

  const events: GameEvent[] = [unitMoved(unit.id, unit.at, to, enteredZone)];

  if (intent.forcesDoor !== null) {
    /* Forcing a shut door is the whole move: you get through, and you stop. */
    let next = replaceUnit(state, { ...unit, at: to, movement: 0 });
    next = setDoorState(next, intent.forcesDoor.id, "open");
    events.push(doorForced(unit.id, intent.forcesDoor.id, toCell?.zoneId ?? -1));
    return { state: next, events };
  }

  const halted = intent.haltedBy;
  const movement = halted !== null ? 0 : unit.movement - 1;
  const next = replaceUnit(state, { ...unit, at: to, movement });
  if (halted !== null) events.push(movementHalted(unit.id, halted.id, to));
  return { state: next, events };
}

export function attackFrom(
  deck: DeckMap,
  state: GameState,
  attackerId: number,
  weaponIndex: number,
  target: Axial,
): Applied {
  const attacker = unitById(state, attackerId);
  if (attacker === null) return refused(state, "no such unit");

  const intent = intentFor(deck, state, attacker, target);
  if (intent.kind !== "attack") return refused(state, "nothing to attack there");

  const weapon = profileOf(attacker.type).weapons[weaponIndex];
  if (weapon === undefined) return refused(state, "no such weapon");

  /* A locked door has one hit point and never answers: one landed strike
     opens it, and that is the drone's whole action. */
  if (intent.targetDoor !== null) {
    const door = intent.targetDoor;
    const exchange = resolveExchange({
      attackerId: attacker.id,
      attackerHp: attacker.hp,
      weapon,
      targetId: -1,
      targetHp: 1,
      targetIsObject: true,
      answering: null,
      rng: state.rng,
    });
    let cut: GameState = { ...state, rng: exchange.rng };
    cut = replaceUnit(cut, { ...attacker, movement: 0, hasAttacked: true });
    const events: GameEvent[] = [...exchange.events];
    if (exchange.targetHp <= 0) {
      cut = setDoorState(cut, door.id, "broken");
      events.push(doorCut(attacker.id, door.id));
    }
    return { state: cut, events };
  }

  const targetUnit = intent.targetUnit;
  const targetObject = intent.targetObject;
  const answering =
    targetUnit === null ? null : answeringWeapon(profileOf(targetUnit.type).weapons, weapon);

  const exchange = resolveExchange({
    attackerId: attacker.id,
    attackerHp: attacker.hp,
    weapon,
    targetId: targetUnit !== null ? targetUnit.id : (targetObject?.id ?? -1),
    targetHp: targetUnit !== null ? targetUnit.hp : (targetObject?.hp ?? 0),
    targetIsObject: targetUnit === null,
    answering,
    rng: state.rng,
  });

  let next: GameState = { ...state, rng: exchange.rng };
  const events: GameEvent[] = [...exchange.events];

  next = replaceUnit(next, {
    ...attacker,
    hp: exchange.attackerHp,
    movement: 0,
    hasAttacked: true,
  });

  if (targetUnit !== null) {
    next = replaceUnit(next, { ...targetUnit, hp: exchange.targetHp });
    if (exchange.targetHp <= 0) {
      events.push(unitDestroyed(targetUnit.id, targetUnit.type, targetUnit.side, targetUnit.at));
    }
  } else if (targetObject !== null) {
    next = replaceObject(next, { ...targetObject, hp: exchange.targetHp });
    if (exchange.targetHp <= 0) {
      events.push(
        objectDestroyed(
          targetObject.id,
          targetObject.kind,
          targetObject.name,
          targetObject.at,
          next.objects.filter(isLiveSpawner).length,
          next.objects.filter(isLiveNode).length,
        ),
      );
    }
  }

  if (exchange.attackerHp <= 0) {
    events.push(unitDestroyed(attacker.id, attacker.type, attacker.side, attacker.at));
  }

  const settled = checkOutcome(next);
  return { state: settled.state, events: [...events, ...settled.events] };
}
