import { hexKey } from "../hex";
import { nextFloat, nextInt, pickOne } from "../rng";
import type { RngState } from "../rng";
import { isFloorCell } from "./types";
import type { MapCell, MapWall, MapZone } from "./types";

/**
 * The seeded content pass: what a room is for decides what is in it, and the
 * artwork decided what the room is for. Nothing here invents a room.
 */
const FITTINGS: Readonly<Record<string, readonly string[]>> = {
  command: ["console", "nav plot", "comms set", "log core"],
  drive: ["reactor tap", "coolant line", "drive monitor", "toolrack"],
  fuel: ["fuel valve", "pump", "sample port"],
  weapon: ["turret seat", "ammo hoist", "fire panel"],
  bay: ["cargo crate", "loader", "manifest slate", "strongbox"],
  quarters: ["footlocker", "bunk", "personal effects", "galley stores"],
  service: ["workbench", "spares bin", "terminal", "medkit"],
  green: ["hydroponic tray", "seed store", "water tank"],
  vertical: ["lift call", "ladder well"],
  airlock: ["suit rack", "cycle control"],
  hold: ["debris", "loose panel", "stowage"],
};

const HAZARDS: readonly string[] = ["vented", "fire", "flooded", "live wiring", "radiation"];

const KIND_ORDER: readonly string[] = [
  "command",
  "drive",
  "fuel",
  "weapon",
  "bay",
  "green",
  "quarters",
  "service",
  "vertical",
  "airlock",
];

export function zoneKind(roles: readonly string[]): string {
  for (const kind of KIND_ORDER) {
    if (roles.includes(kind)) return kind;
  }
  return "hold";
}

export function dressUp(
  zones: readonly MapZone[],
  cells: readonly MapCell[],
  byKey: ReadonlyMap<string, MapCell>,
  walls: readonly MapWall[],
  rng: RngState,
): RngState {
  let current = rng;

  const named = new Map<string, number>();
  for (const zone of zones) {
    const base =
      zone.source === "" ? zone.kind : (zone.source.split(/[(,]/)[0] ?? zone.kind).trim();
    const seen = (named.get(base) ?? 0) + 1;
    named.set(base, seen);
    zone.name = seen > 1 ? `${base} ${String(seen)}` : base;

    /* Things are in rooms, not in hexagons: a hexagon can cover a whole suite,
       and putting the toolrack in one would invent a position the artwork
       never gave. */
    const pool = FITTINGS[zone.kind] ?? FITTINGS.hold ?? [];
    const most = zone.area > 900 ? 3 : zone.area > 300 ? 2 : 1;
    const [count, afterCount] = nextInt(current, most + 1);
    current = afterCount;
    const chosen = new Set<string>();
    for (let i = 0; i < count; i++) {
      const [mark, afterMark] = pickOne(current, pool);
      current = afterMark;
      if (mark !== null && !chosen.has(mark)) {
        chosen.add(mark);
        zone.marks.push(mark);
      }
    }
    const [hazardRoll, afterHazard] = nextFloat(current);
    current = afterHazard;
    if (hazardRoll < 0.14) {
      const [hazard, afterPick] = pickOne(current, HAZARDS);
      current = afterPick;
      if (hazard !== null) zone.hazard = hazard;
    }
  }

  /* Walk the ship the way a body would: freely across a room, and between
     rooms only where a wall has a door. What it cannot reach is sealed, and
     staying sealed is often right — better to say so than to invent a door
     through a fuel tank. */
  const wallBetween = new Map<string, MapWall>();
  for (const wall of walls) {
    if (wall.hull || wall.b === null) continue;
    wallBetween.set(`${hexKey(wall.a)}|${hexKey(wall.b)}`, wall);
    wallBetween.set(`${hexKey(wall.b)}|${hexKey(wall.a)}`, wall);
  }

  const floor = cells.filter(isFloorCell);
  const visited = new Set<MapCell>();
  const parts: MapCell[][] = [];
  for (const start of floor) {
    if (visited.has(start)) continue;
    const part = [start];
    const pending = [start];
    visited.add(start);
    while (pending.length > 0) {
      const cell = pending.pop();
      if (cell === undefined) break;
      for (const step of [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: 1 },
        { q: 0, r: -1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
      ]) {
        const next = byKey.get(hexKey({ q: cell.q + step.q, r: cell.r + step.r }));
        if (next === undefined) continue;
        if (!isFloorCell(next) || visited.has(next)) continue;
        if (
          next.zone !== cell.zone &&
          wallBetween.get(`${hexKey(cell)}|${hexKey(next)}`)?.door == null
        ) {
          continue;
        }
        visited.add(next);
        part.push(next);
        pending.push(next);
      }
    }
    parts.push(part);
  }
  parts.sort(function biggestFirst(a, b) {
    return b.length - a.length;
  });
  const body = new Set<MapCell>(parts[0] ?? []);
  /* One predicate, used by both questions below. */
  function inBody(cell: MapCell): boolean {
    return body.has(cell);
  }
  for (const cell of floor) cell.reachable = inBody(cell);
  for (const zone of zones) {
    zone.sealed = zone.cells.length > 0 && !zone.cells.some(inBody);
  }

  /* Come aboard somewhere you can walk out of: an airlock in the connected
     part of the ship, else its aftmost compartment, where a tube would clamp. */
  const reachable = zones.filter(function walkable(zone) {
    return !zone.sealed && zone.cells.some(inBody);
  });
  const locks = reachable.filter(function isAirlock(zone) {
    return zone.roles.includes("airlock");
  });

  let entry: MapZone | undefined;
  if (locks.length > 0) {
    const [chosen, afterEntry] = pickOne(current, locks);
    current = afterEntry;
    entry = chosen ?? undefined;
  } else {
    entry = [...reachable].sort(function aftmostFirst(a, b) {
      return b.cy - a.cy;
    })[0];
  }
  if (entry !== undefined) {
    entry.entry = true;
    entry.marks.unshift("boarding point");
  }

  return current;
}
