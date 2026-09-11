/**
 * Standing a mission up on a deck.
 *
 * Machinery fills the hex it sits on, so a node dropped on the single hex
 * linking two parts of the deck would wall the ship off without saying so.
 * Placement therefore refuses any hex whose loss would disconnect what is
 * walkable. The generator next door refuses to fabricate a door; this refuses
 * to remove one.
 */

import { cellAt, cellsOfZone, doorBetween } from "./deck";
import { hexDistance, hexKey, hexNeighbours } from "./hex";
import type { Axial } from "./hex";
import { createRng } from "./rng";
import { profileOf } from "./roster";
import type {
  Cell,
  DeckMap,
  DoorState,
  GameState,
  MapObject,
  Mission,
  MissionSettings,
  Unit,
  UnitType,
  Zone,
} from "./types";

export const DEFAULT_SETTINGS: MissionSettings = {
  seed: "boarding-1",
  incomePerNode: 1,
  spawnerHitPoints: 12,
  nodeHitPoints: 6,
};

/** A room needs more than three hexes to be worth a node. */
const NODE_MIN_HEXES = 4;

export interface MissionReport {
  readonly unreachableRooms: readonly string[];
  readonly nudgedPlacements: number;
  readonly spawnerCount: number;
  readonly nodeCount: number;
}

export interface BuiltMission extends Mission {
  readonly report: MissionReport;
}

export function makeUnit(type: UnitType, id: number, at: Axial, name?: string): Unit {
  const profile = profileOf(type);
  return {
    id,
    type,
    side: profile.side,
    name: name ?? profile.label,
    at,
    hp: profile.hitPoints,
    maxHp: profile.hitPoints,
    movement: profile.movement,
    maxMovement: profile.movement,
    hasAttacked: false,
  };
}

function totalDistanceTo(cell: Cell, others: readonly Cell[]): number {
  let total = 0;
  for (const other of others) total += hexDistance(cell.at, other.at);
  return total;
}

/** Room hexes, most central first, so machinery is never tucked into a doorway. */
function byCentrality(cells: readonly Cell[], taken: ReadonlySet<string>): Cell[] {
  const free: Cell[] = [];
  for (const cell of cells) {
    if (!taken.has(hexKey(cell.at))) free.push(cell);
  }
  const scored = free.map(function score(cell): { cell: Cell; distance: number } {
    return { cell, distance: totalDistanceTo(cell, cells) };
  });
  scored.sort(function closerToMiddleFirst(a, b): number {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return hexKey(a.cell.at) < hexKey(b.cell.at) ? -1 : 1;
  });
  return scored.map(function toCell(entry): Cell {
    return entry.cell;
  });
}

/** Joinable for the purpose of connectivity: a shut door can still be forced. */
function joinedForWalking(deck: DeckMap, a: Axial, b: Axial): boolean {
  const cellA = cellAt(deck, a);
  const cellB = cellAt(deck, b);
  if (cellA === null || cellB === null) return false;
  if (cellA.zoneId === cellB.zoneId) return true;
  return doorBetween(deck, a, b) !== null;
}

function wouldDisconnect(
  deck: DeckMap,
  playable: readonly Cell[],
  blocked: ReadonlySet<string>,
  candidate: Cell,
): boolean {
  const closed = new Set<string>(blocked);
  closed.add(hexKey(candidate.at));

  const free: Cell[] = [];
  for (const cell of playable) {
    if (!closed.has(hexKey(cell.at))) free.push(cell);
  }
  const start = free[0];
  if (start === undefined) return false;

  const seen = new Set<string>([hexKey(start.at)]);
  const pending: Axial[] = [start.at];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const neighbour of hexNeighbours(current)) {
      const key = hexKey(neighbour);
      if (seen.has(key) || closed.has(key)) continue;
      const cell = cellAt(deck, neighbour);
      if (cell === null || !deck.reachableZones.has(cell.zoneId)) continue;
      if (!joinedForWalking(deck, current, neighbour)) continue;
      seen.add(key);
      pending.push(neighbour);
    }
  }
  return seen.size !== free.length;
}

/**
 * Which rooms the ship builds out of.
 *
 * Read off the taxonomy rather than the room's name, so the rule survives a
 * ship the generator has never made before — one deck's weapons bay is
 * another's mine layer. A room qualifies if it runs the ship: its guns or its
 * command deck, or its engines. The boarding compartment never does; a spawn
 * zone on top of the airlock would be a trap, not a decision.
 */
function isSystemsRoom(zone: Zone): boolean {
  const roles = zone.roles;
  if (roles.includes("weapon") || roles.includes("command")) return true;
  return roles.includes("drive");
}

export function buildMission(deck: DeckMap, overrides?: Partial<MissionSettings>): BuiltMission {
  const settings: MissionSettings = { ...DEFAULT_SETTINGS, ...overrides };

  const playable: Cell[] = [];
  for (const cell of deck.cells.values()) {
    if (deck.reachableZones.has(cell.zoneId)) playable.push(cell);
  }

  const taken = new Set<string>();
  const blocked = new Set<string>();
  const objects: MapObject[] = [];
  let nextObjectId = 0;
  let nudged = 0;

  function placeIn(zoneId: number): Cell | null {
    const cells = cellsOfZone(deck, zoneId);
    const candidates = byCentrality(cells, taken);
    const preferred = candidates[0];
    for (const candidate of candidates) {
      if (wouldDisconnect(deck, playable, blocked, candidate)) continue;
      if (preferred !== undefined && candidate !== preferred) nudged++;
      return candidate;
    }
    return null;
  }

  /* Spawn zones: the rooms that run the ship, big enough to build in. */
  for (const zone of deck.zones.values()) {
    if (!deck.reachableZones.has(zone.id)) continue;
    if (zone.id === deck.entryZoneId) continue;
    if (cellsOfZone(deck, zone.id).length < NODE_MIN_HEXES) continue;
    if (!isSystemsRoom(zone)) continue;
    const cell = placeIn(zone.id);
    if (cell === null) continue;
    taken.add(hexKey(cell.at));
    blocked.add(hexKey(cell.at));
    objects.push({
      id: nextObjectId++,
      kind: "spawner",
      name: zone.name + " spawner",
      zoneId: zone.id,
      at: cell.at,
      hp: settings.spawnerHitPoints,
      maxHp: settings.spawnerHitPoints,
    });
  }

  /* Resource nodes: one per room of more than three hexes, skipping rooms no
     drone can reach — a node behind a wall would fund the ship forever. */
  for (const zone of deck.zones.values()) {
    if (!deck.reachableZones.has(zone.id)) continue;
    if (cellsOfZone(deck, zone.id).length < NODE_MIN_HEXES) continue;
    const cell = placeIn(zone.id);
    if (cell === null) continue;
    taken.add(hexKey(cell.at));
    blocked.add(hexKey(cell.at));
    objects.push({
      id: nextObjectId++,
      kind: "node",
      name: zone.name + " node",
      zoneId: zone.id,
      at: cell.at,
      hp: settings.nodeHitPoints,
      maxHp: settings.nodeHitPoints,
    });
  }

  /* Two drones, in the boarding compartment the map itself marks. */
  const entryCells = cellsOfZone(deck, deck.entryZoneId);
  const seats = byCentrality(entryCells, taken);
  const units: Unit[] = [];
  for (let i = 0; i < 2 && i < seats.length; i++) {
    const seat = seats[i];
    if (seat === undefined) break;
    units.push(makeUnit("drone", i, seat.at, `Drone ${i + 1}`));
    taken.add(hexKey(seat.at));
  }

  /* The doors start as the generator drew them: open, shut, or locked. */
  const doorStates = new Map<number, DoorState>();
  for (const door of deck.doors) doorStates.set(door.id, door.initialState);

  const unreachable: string[] = [];
  for (const zone of deck.zones.values()) {
    if (deck.reachableZones.has(zone.id)) continue;
    if (cellsOfZone(deck, zone.id).length === 0) continue;
    unreachable.push(zone.name);
  }

  const state: GameState = {
    rng: createRng(settings.seed),
    turn: 1,
    side: "drone",
    pool: 0,
    incomePerNode: settings.incomePerNode,
    units,
    objects,
    doorStates,
    nextUnitId: units.length,
    outcome: null,
  };

  let spawnerCount = 0;
  let nodeCount = 0;
  for (const object of objects) {
    if (object.kind === "spawner") spawnerCount++;
    else nodeCount++;
  }

  return {
    deck,
    settings,
    state,
    report: { unreachableRooms: unreachable, nudgedPlacements: nudged, spawnerCount, nodeCount },
  };
}
