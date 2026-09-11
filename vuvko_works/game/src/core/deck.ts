/**
 * Reading a deck out of a `hexmap.html` export.
 *
 * The export is already most of a scenario file: typed rooms, a hex lattice,
 * and doors that sit on the lattice edge two hexes share. Nothing here invents
 * anything the artwork did not say — rooms the generator left without a door
 * stay sealed, and the mission is told which they are rather than having one
 * fabricated for it.
 */

import { edgeKey, hexGeometry, hexKey } from "./hex";
import type { Axial, HexGeometry } from "./hex";
import type { Cell, DeckMap, Door, DoorState, TilePlacement, Zone } from "./types";

interface RawZone {
  id: number;
  name: string;
  kind: string;
  roles?: string[];
  areaSqFt: number;
  hazard: string | null;
  entry: boolean;
  sealed: boolean;
  marks?: string[];
  from?: string;
}
interface RawCell {
  q: number;
  r: number;
  zone: number;
  over?: number[];
}
interface RawDoor {
  id: number;
  a: number;
  b: number;
  state: string;
  loop: boolean;
  at: [number, number];
  from: [number, number] | null;
  to: [number, number] | null;
}
export interface RawDeckExport {
  seed: string | number;
  ship: { name: string; ft: [number, number] };
  hex: { feetAcross: number };
  zones: RawZone[];
  hexes: RawCell[];
  doors: RawDoor[];
  plan?: { path: string; x: number; y: number; rot: number }[];
}

function toZone(raw: RawZone): Zone {
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    roles: raw.roles ?? [],
    areaSqFt: raw.areaSqFt,
    hazard: raw.hazard,
    isEntry: raw.entry,
    isSealed: raw.sealed,
    marks: raw.marks ?? [],
    sourceTile: raw.from ?? "",
  };
}

function toCell(raw: RawCell): Cell {
  return {
    at: { q: raw.q, r: raw.r },
    zoneId: raw.zone,
    overlaps: raw.over ?? [raw.zone],
  };
}

function toPlacement(raw: { path: string; x: number; y: number; rot: number }): TilePlacement {
  return { path: raw.path, x: raw.x, y: raw.y, rotation: raw.rot };
}

/**
 * Which rooms a drone can walk to from the boarding point, following doors
 * only. Two rooms whose hexes merely touch are separated by a bulkhead.
 */
function findReachableZones(entryZoneId: number, doors: readonly Door[]): Set<number> {
  const neighbours = new Map<number, number[]>();
  for (const door of doors) {
    const forA = neighbours.get(door.zoneA) ?? [];
    forA.push(door.zoneB);
    neighbours.set(door.zoneA, forA);
    const forB = neighbours.get(door.zoneB) ?? [];
    forB.push(door.zoneA);
    neighbours.set(door.zoneB, forB);
  }
  const reached = new Set<number>([entryZoneId]);
  const pending: number[] = [entryZoneId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const next of neighbours.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      pending.push(next);
    }
  }
  return reached;
}

export function parseDeck(raw: RawDeckExport): DeckMap {
  const zones = new Map<number, Zone>();
  for (const rawZone of raw.zones) zones.set(rawZone.id, toZone(rawZone));

  const cells = new Map<string, Cell>();
  for (const rawCell of raw.hexes) {
    const cell = toCell(rawCell);
    cells.set(hexKey(cell.at), cell);
  }

  const doors: Door[] = [];
  const doorsByEdge = new Map<string, Door>();
  for (const rawDoor of raw.doors) {
    if (rawDoor.from === null || rawDoor.to === null) continue;
    const door: Door = {
      id: rawDoor.id,
      zoneA: rawDoor.a,
      zoneB: rawDoor.b,
      initialState: toDoorState(rawDoor.state),
      isLoop: rawDoor.loop,
      from: { q: rawDoor.from[0], r: rawDoor.from[1] },
      to: { q: rawDoor.to[0], r: rawDoor.to[1] },
      atFeet: rawDoor.at,
    };
    doors.push(door);
    doorsByEdge.set(edgeKey(door.from, door.to), door);
  }

  const entryZone = raw.zones.find(isEntryZone) ?? raw.zones[0];
  if (entryZone === undefined) throw new Error("deck has no zones");

  const plan: TilePlacement[] = [];
  for (const placement of raw.plan ?? []) plan.push(toPlacement(placement));

  return {
    name: raw.ship.name,
    seed: String(raw.seed),
    feetAcross: raw.hex.feetAcross,
    sizeFeet: raw.ship.ft,
    zones,
    cells,
    doors,
    doorsByEdge,
    reachableZones: findReachableZones(entryZone.id, doors),
    entryZoneId: entryZone.id,
    plan,
  };
}

function isEntryZone(zone: RawZone): boolean {
  return zone.entry;
}

/** Anything the export calls something else is treated as shut, not as open. */
function toDoorState(raw: string): DoorState {
  if (raw === "open") return "open";
  if (raw === "locked") return "locked";
  if (raw === "broken") return "broken";
  return "closed";
}

/**
 * The lattice in the deck plan's own feet. Column 0 sits on the keel, which is
 * the origin `hexmap.html` builds the map with — get this wrong and the hexes
 * land half a ship away from the artwork under them.
 */
export function deckGeometry(deck: DeckMap): HexGeometry {
  return hexGeometry(deck.feetAcross, deck.sizeFeet[0] / 2, 0);
}

export function cellAt(deck: DeckMap, at: Axial): Cell | null {
  return deck.cells.get(hexKey(at)) ?? null;
}

export function zoneOf(deck: DeckMap, at: Axial): Zone | null {
  const cell = cellAt(deck, at);
  if (cell === null) return null;
  return deck.zones.get(cell.zoneId) ?? null;
}

export function doorBetween(deck: DeckMap, a: Axial, b: Axial): Door | null {
  return deck.doorsByEdge.get(edgeKey(a, b)) ?? null;
}

export function cellsOfZone(deck: DeckMap, zoneId: number): Cell[] {
  const out: Cell[] = [];
  for (const cell of deck.cells.values()) {
    if (cell.zoneId === zoneId) out.push(cell);
  }
  return out;
}

/** Rooms with hexes that no drone can reach — reported, never quietly patched. */
export function unreachableZones(deck: DeckMap): Zone[] {
  const out: Zone[] = [];
  for (const zone of deck.zones.values()) {
    if (deck.reachableZones.has(zone.id)) continue;
    if (cellsOfZone(deck, zone.id).length === 0) continue;
    out.push(zone);
  }
  return out;
}
