/**
 * What a unit could do about a neighbouring hex, and why not.
 *
 * The old prototype answered this from one function that also phrased the
 * refusal for the UI. Here the rules return a verdict and the UI does the
 * phrasing, so the same verdict drives the hover arrow, the command handler
 * and the AI without any of them reading each other's wording.
 */

import { cellAt } from "./deck";
import { hexKey, hexNeighbours } from "./hex";
import type { Axial } from "./hex";
import { edgeBetween, enemyExertingControl, objectAt, unitAt } from "./topology";
import type { DeckMap, Door, GameState, MapObject, Unit } from "./types";

export type RefusalReason =
  | "destroyed"
  | "offMap"
  | "notAdjacent"
  | "bulkhead"
  | "friendlyOccupied"
  | "objectInTheWay"
  | "alreadyAttacked"
  | "doorShut"
  | "doorLocked"
  | "noMovementLeft";

export interface MoveIntent {
  readonly kind: "move";
  readonly to: Axial;
  /** Forcing a shut door costs whatever movement is left. */
  readonly forcesDoor: Door | null;
  readonly haltedBy: Unit | null;
}

export interface AttackIntent {
  readonly kind: "attack";
  readonly targetUnit: Unit | null;
  readonly targetObject: MapObject | null;
  /** A locked door in the way: cut it open rather than walk through it. */
  readonly targetDoor: Door | null;
}

export interface RefusedIntent {
  readonly kind: "refused";
  readonly reason: RefusalReason;
}

export type Intent = MoveIntent | AttackIntent | RefusedIntent;

function refuse(reason: RefusalReason): RefusedIntent {
  return { kind: "refused", reason };
}

export function intentFor(deck: DeckMap, state: GameState, unit: Unit, to: Axial): Intent {
  if (unit.hp <= 0) return refuse("destroyed");

  const edge = edgeBetween(deck, state, unit.at, to);
  if (!edge.joined) {
    if (edge.blockedBy === "offMap") return refuse("offMap");
    if (edge.blockedBy === "notAdjacent") return refuse("notAdjacent");
    return refuse("bulkhead");
  }

  const targetUnit = unitAt(state, to);
  const targetObject = objectAt(state, to);

  /* An attack is gated by having not attacked yet, never by movement left.
     Spending the last point walking up to something must not be what stops
     you hitting it. */
  if (targetUnit !== null) {
    if (targetUnit.side === unit.side) return refuse("friendlyOccupied");
    if (unit.hasAttacked) return refuse("alreadyAttacked");
    if (edge.needsForcing) return refuse("doorShut");
    if (edge.doorState === "locked") return refuse("doorLocked");
    return { kind: "attack", targetUnit, targetObject: null, targetDoor: null };
  }
  if (targetObject !== null) {
    if (unit.side !== "drone") return refuse("objectInTheWay");
    if (unit.hasAttacked) return refuse("alreadyAttacked");
    if (edge.needsForcing) return refuse("doorShut");
    if (edge.doorState === "locked") return refuse("doorLocked");
    return { kind: "attack", targetUnit: null, targetObject, targetDoor: null };
  }

  /* A locked door is cut open, not shouldered. It is the thing you attack,
     and it has one hit point, so one landed strike does it. */
  if (edge.doorState === "locked" && edge.door !== null) {
    if (unit.side !== "drone") return refuse("doorLocked");
    if (unit.hasAttacked) return refuse("alreadyAttacked");
    return { kind: "attack", targetUnit: null, targetObject: null, targetDoor: edge.door };
  }

  if (unit.movement <= 0) return refuse("noMovementLeft");
  if (edge.needsForcing && edge.door !== null) {
    return { kind: "move", to, forcesDoor: edge.door, haltedBy: null };
  }
  return {
    kind: "move",
    to,
    forcesDoor: null,
    haltedBy: enemyExertingControl(deck, state, unit.side, to),
  };
}

export interface Reached {
  /** Movement still in hand on arrival. */
  readonly left: number;
  /** The hex stepped from, so a route can be walked back. */
  readonly from: Axial | null;
}

/**
 * Every hex this unit could still walk to this turn, and how it would get
 * there.
 *
 * Breadth-first over single legal steps, so the route it records is the
 * shortest one — and it stops expanding from a hex held in a zone of control,
 * because arriving there ends the move. Forcing a door is never part of a
 * route: that is its own decision and costs everything left.
 */
export function reachFrom(deck: DeckMap, state: GameState, unit: Unit): Map<string, Reached> {
  const reached = new Map<string, Reached>([
    [hexKey(unit.at), { left: unit.movement, from: null }],
  ]);
  const frontier: Axial[] = [unit.at];

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current === undefined) break;
    const here = reached.get(hexKey(current));
    if (here === undefined || here.left <= 0) continue;

    const probe: Unit = { ...unit, at: current, movement: here.left };
    for (const neighbour of hexNeighbours(current)) {
      if (cellAt(deck, neighbour) === null) continue;
      const intent = intentFor(deck, state, probe, neighbour);
      if (intent.kind !== "move" || intent.forcesDoor !== null) continue;

      const key = hexKey(neighbour);
      const left = here.left - 1;
      const best = reached.get(key);
      if (best !== undefined && best.left >= left) continue;
      reached.set(key, { left, from: current });
      if (intent.haltedBy === null) frontier.push(neighbour);
    }
  }
  return reached;
}

/** Every hex this unit could still walk to this turn, with the movement left on arrival. */
export function reachableHexes(deck: DeckMap, state: GameState, unit: Unit): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, reached] of reachFrom(deck, state, unit)) out.set(key, reached.left);
  out.delete(hexKey(unit.at));
  return out;
}

/**
 * The steps to walk from where the unit stands to `to`, not including the hex
 * it is standing on. Null when it cannot get there this turn.
 */
export function routeTo(deck: DeckMap, state: GameState, unit: Unit, to: Axial): Axial[] | null {
  const reached = reachFrom(deck, state, unit);
  if (!reached.has(hexKey(to))) return null;

  const route: Axial[] = [];
  let cursor: Axial | null = to;
  const start = hexKey(unit.at);
  while (cursor !== null && hexKey(cursor) !== start) {
    route.unshift(cursor);
    cursor = reached.get(hexKey(cursor))?.from ?? null;
  }
  return route;
}
