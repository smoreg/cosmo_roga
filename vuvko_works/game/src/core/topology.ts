/**
 * What joins two hexes, and what that means for moving and fighting.
 *
 * Two hexes in the same room are always joined. Two hexes in different rooms
 * are joined only where the artwork put a door; everything else is a bulkhead.
 * That single rule is what turns the deck into a graph of chokepoints instead
 * of an open field.
 */

import { cellAt, doorBetween } from "./deck";
import { areAdjacent, hexNeighbours } from "./hex";
import type { Axial } from "./hex";
import type { DeckMap, Door, DoorState, GameState, MapObject, Side, Unit } from "./types";

export type EdgeBlock = "offMap" | "notAdjacent" | "bulkhead";

export interface EdgeLink {
  readonly joined: boolean;
  readonly door: Door | null;
  readonly doorState: DoorState | null;
  /** A shut door can be forced, at the cost of the rest of the move. */
  readonly needsForcing: boolean;
  readonly blockedBy: EdgeBlock | null;
}

const BULKHEAD: EdgeLink = {
  joined: false,
  door: null,
  doorState: null,
  needsForcing: false,
  blockedBy: "bulkhead",
};

export function doorStateOf(state: GameState, door: Door): DoorState {
  return state.doorStates.get(door.id) ?? "open";
}

export function edgeBetween(deck: DeckMap, state: GameState, from: Axial, to: Axial): EdgeLink {
  const cellFrom = cellAt(deck, from);
  const cellTo = cellAt(deck, to);
  if (cellFrom === null || cellTo === null) {
    return { joined: false, door: null, doorState: null, needsForcing: false, blockedBy: "offMap" };
  }
  if (!areAdjacent(from, to)) {
    return {
      joined: false,
      door: null,
      doorState: null,
      needsForcing: false,
      blockedBy: "notAdjacent",
    };
  }
  if (cellFrom.zoneId === cellTo.zoneId) {
    return { joined: true, door: null, doorState: null, needsForcing: false, blockedBy: null };
  }
  const door = doorBetween(deck, from, to);
  if (door === null) return BULKHEAD;
  const doorState = doorStateOf(state, door);
  return {
    joined: true,
    door,
    doorState,
    /* A shut door yields to a shoulder; a locked one has to be cut open. */
    needsForcing: doorState === "closed",
    blockedBy: null,
  };
}

/* ---------- occupancy ---------- */

export function unitAt(state: GameState, at: Axial): Unit | null {
  for (const unit of state.units) {
    if (unit.hp > 0 && unit.at.q === at.q && unit.at.r === at.r) return unit;
  }
  return null;
}

export function objectAt(state: GameState, at: Axial): MapObject | null {
  for (const object of state.objects) {
    if (object.hp > 0 && object.at.q === at.q && object.at.r === at.r) return object;
  }
  return null;
}

export function isOccupied(state: GameState, at: Axial): boolean {
  return unitAt(state, at) !== null || objectAt(state, at) !== null;
}

export function unitById(state: GameState, id: number): Unit | null {
  for (const unit of state.units) {
    if (unit.id === id) return unit;
  }
  return null;
}

export function objectById(state: GameState, id: number): MapObject | null {
  for (const object of state.objects) {
    if (object.id === id) return object;
  }
  return null;
}

/* ---------- side helpers, named so callbacks can pass them by reference ---------- */

export function isAlive(unit: Unit): boolean {
  return unit.hp > 0;
}

export function isDrone(unit: Unit): boolean {
  return unit.side === "drone" && unit.hp > 0;
}

export function isHostile(unit: Unit): boolean {
  return unit.side === "ship" && unit.hp > 0;
}

export function isLiveSpawner(object: MapObject): boolean {
  return object.kind === "spawner" && object.hp > 0;
}

export function isLiveNode(object: MapObject): boolean {
  return object.kind === "node" && object.hp > 0;
}

export function drones(state: GameState): Unit[] {
  return state.units.filter(isDrone);
}

export function hostiles(state: GameState): Unit[] {
  return state.units.filter(isHostile);
}

export function liveSpawners(state: GameState): MapObject[] {
  return state.objects.filter(isLiveSpawner);
}

export function liveNodes(state: GameState): MapObject[] {
  return state.objects.filter(isLiveNode);
}

/**
 * Zone of control reaches only through a joinable edge: nothing pins you
 * through a wall, and a shut door holds the line by itself.
 */
export function enemyExertingControl(
  deck: DeckMap,
  state: GameState,
  side: Side,
  at: Axial,
): Unit | null {
  for (const neighbour of hexNeighbours(at)) {
    const other = unitAt(state, neighbour);
    if (other === null || other.side === side) continue;
    const edge = edgeBetween(deck, state, at, neighbour);
    if (!edge.joined || edge.needsForcing) continue;
    return other;
  }
  return null;
}

/** Can these two trade blows across this edge? Adjacency is the only range. */
export function canReachAcross(deck: DeckMap, state: GameState, from: Axial, to: Axial): boolean {
  const edge = edgeBetween(deck, state, from, to);
  return edge.joined && !edge.needsForcing;
}
