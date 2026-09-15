import type { Door, DoorId, RoomGame, RoomId, Ship } from "@jamrog/engine";
import { hazardKind, isHazardId, type HazardId } from "../content/hazards.js";

/**
 * What a hull remembers about its hazards, and nothing about what they do.
 *
 * A leaf file by the rule of `docs/adr/0003-decoupling.md`: this record is
 * read by the doors (a welder lifting a mine), the walks (`ui/auto.ts`,
 * "is there something known beyond that door"), the picture
 * (`ui/contents.ts`, the mark in the box) and the rules themselves
 * (`systems/hazards.ts`), and the one file that changes it must not be what
 * all of those have to import to read it.
 *
 * The ship carries the fact — `Room.hazard`, `Door.trap` — and the engine
 * carries the ship; what the ship cannot carry is what the *drone* knows about
 * it, and that is this list: one entry per hazard placed, with the moment it
 * was first told and whether the sortie has heard about it yet. Kept in the
 * ship's own pocket of the store (`StoredShip.data`), which is what survives a
 * sortie and a save.
 */
export interface HazardRecord {
  id: HazardId;
  /** A compartment hazard: the room it fills. */
  room?: RoomId;
  /** A door trap: the door it is on. */
  door?: DoorId;
  /**
   * The sign has been given at least once, so the mark is on the schematic
   * for the rest of the voyage. A sensor pulse knows it without a sign
   * (`hazardKnown`), which is what a pulse is for.
   */
  known: boolean;
  /** Visit of the hull the red line was last said on: once a sortie, no more. */
  told?: number;
  /**
   * How many commands the run had spent when the red line was said: while
   * that is still the count, the line is this turn's, and the door and the
   * compartment it names are lit on the schematic (`signsFresh`).
   */
  toldAfter?: number;
  /** Visit of the hull the CELL warmed this compartment on (frost only). */
  heated?: number;
}

const POCKET = "hazards";

/**
 * The list, read-only: an empty one for a hull that carries none, and never a
 * write into the pocket — a walk that looks at the ship must not change it.
 */
export function hazardRecords(game: RoomGame): readonly HazardRecord[] {
  return hazardsOf(game.currentShip.data);
}

/** The same off a store entry the drone is not aboard, for the tug's view of it. */
export function hazardsOf(data: Record<string, unknown>): readonly HazardRecord[] {
  const raw = data[POCKET];
  // The pocket round-trips through a save file, so nothing in it is trusted.
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord);
}

/** The list for a writer: created in the pocket on first use. */
export function hazardStore(game: RoomGame): HazardRecord[] {
  const data = game.currentShip.data;
  const raw = data[POCKET];
  if (Array.isArray(raw)) {
    const clean = raw.filter(isRecord);
    if (clean.length !== raw.length) raw.splice(0, raw.length, ...clean);
    return raw as HazardRecord[];
  }
  const fresh: HazardRecord[] = [];
  data[POCKET] = fresh;
  return fresh;
}

function isRecord(raw: unknown): raw is HazardRecord {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Partial<HazardRecord>;
  if (!isHazardId(r.id) || typeof r.known !== "boolean") return false;
  return typeof r.room === "number" || typeof r.door === "number";
}

/**
 * The hazard filling a compartment, when the ship still agrees it is there.
 *
 * The record and the ship's own field are two writers of one fact, and the
 * ship's wins: the alert vents a compartment by writing over `Room.hazard`
 * (`systems/alert.ts`), and a vented compartment has no ice left to slow
 * anybody. A record the ship no longer backs is a dead record, dropped by
 * `systems/hazards.ts` the next time the hull is boarded.
 */
export function roomHazard(ship: Ship, records: readonly HazardRecord[], room: RoomId): HazardRecord | undefined {
  const rec = records.find((r) => r.room === room);
  return rec !== undefined && ship.roomAt(room).hazard === rec.id ? rec : undefined;
}

/** The trap on a door, when the door still carries it. */
export function doorHazard(ship: Ship, records: readonly HazardRecord[], door: DoorId): HazardRecord | undefined {
  const rec = records.find((r) => r.door === door);
  return rec !== undefined && ship.doorAt(door).trap === rec.id ? rec : undefined;
}

/**
 * Does the drone know about this one? Told from next door, or read by a pulse:
 * a scanned compartment shows its hazard, and a scanned compartment on either
 * side of a door shows the trap on it — "the scanner shows hazards one door
 * away" is the report's whole rule for the module.
 */
export function hazardKnown(ship: Ship, rec: HazardRecord): boolean {
  if (rec.known) return true;
  if (rec.room !== undefined) return ship.roomAt(rec.room).scanned;
  if (rec.door !== undefined) {
    const door = ship.doorAt(rec.door);
    return ship.roomAt(door.a).scanned || ship.roomAt(door.b).scanned;
  }
  return false;
}

/**
 * Write a record's fact onto the ship: the hazard string, and for a blinding
 * one the engine's `opaque` and the cover it makes. Called by the placer and
 * again on boarding, so a hand-drawn fixture that only wrote `hazard=smoke`
 * gets the same compartment a generated hull does.
 */
export function markHazard(ship: Ship, rec: HazardRecord): void {
  const kind = hazardKind(rec.id);
  if (!kind) return;
  if (rec.room !== undefined) {
    const room = ship.roomAt(rec.room);
    room.hazard = rec.id;
    if (kind.opaque) room.opaque = true;
    if (kind.cover) room.cover = true;
  }
  if (rec.door !== undefined) ship.doorAt(rec.door).trap = rec.id;
}

/**
 * Take a hazard off the ship for good: the record goes, and so does the fact
 * on the room or the door. A lifted mine, a compartment nothing is wrong with
 * any more.
 */
export function removeHazard(game: RoomGame, rec: HazardRecord): void {
  const store = hazardStore(game);
  const at = store.indexOf(rec);
  if (at >= 0) store.splice(at, 1);
  if (rec.room !== undefined) {
    const room = game.ship.roomAt(rec.room);
    if (room.hazard === rec.id) room.hazard = "none";
    delete room.opaque;
  }
  if (rec.door !== undefined) {
    const door: Door = game.ship.doorAt(rec.door);
    if (door.trap === rec.id) delete door.trap;
  }
}

/**
 * The hazards whose red line was said this turn — no command spent since —
 * for the schematic to light the door and the compartment the line names
 * (docs/tasks/G83-anonymous-blows.md, 7). A command spent is the turn over,
 * whatever it was; a walk that stopped on the line, a list opened, a card
 * read spend none and keep the light on.
 */
export function signsFresh(game: RoomGame): readonly HazardRecord[] {
  const visits = game.currentShip.visits;
  const now = game.inputs.length;
  return hazardRecords(game).filter((r) => r.told === visits && r.toldAfter === now);
}

/** Budget points the hull is already carrying, for the placer's sum. */
export function threatAboard(records: readonly HazardRecord[]): number {
  return records.reduce((sum, r) => sum + (hazardKind(r.id)?.level ?? 0), 0);
}
