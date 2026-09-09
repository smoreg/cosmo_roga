import type { Room, RoomKindSpec } from "@jamrog/engine";
import { tId } from "../i18n.js";

/**
 * Every kind of compartment a derelict can be made of (design-doc.md, "Отсек").
 *
 * Twenty-two entries: the seventeen the grid version already had, plus five
 * taken from the geomorph vocabulary the owner pointed at — LIFE SUPPORT, CRYO,
 * SENSOR BAY, BRIG, ESCAPE PODS. Nothing was copied from those sheets; what
 * they contributed is the list of words a ship is built out of.
 *
 * The generator (E20) reads only this shape: a `kind` string it carries around,
 * a weight, and three flags. What a compartment *means* — which cards may land
 * in it, what a card leaves there — is `cards.ts`, and what a ship class is
 * made of is `derelicts.ts`. Three files, one direction of dependency.
 *
 * `cover` is the old interior style, boiled down to the only question the graph
 * model asks: is there anything in here to hide behind. `required` and `deep`
 * are the ship's three systems — a derelict without an engine room is not a
 * derelict, and a reactor by the airlock is not a ship.
 */

/** The compartment every derelict is entered through. */
export const ENTRY_KIND = "docking";

const DOCKING: RoomKindSpec = { kind: ENTRY_KIND, name: "DOCKING BAY" };
const CARGO: RoomKindSpec = { kind: "cargo", name: "CARGO BAY", weight: 2, cover: true };
const CORRIDOR: RoomKindSpec = { kind: "corridor", name: "CORRIDOR RING", weight: 3 };
const STORAGE: RoomKindSpec = { kind: "storage", name: "STORAGE", weight: 2, cover: true };
const MAINTENANCE: RoomKindSpec = { kind: "maintenance", name: "MAINTENANCE", weight: 2, cover: true };
const HAB: RoomKindSpec = { kind: "hab", name: "HAB BLOCK", weight: 2 };
const MESS: RoomKindSpec = { kind: "mess", name: "MESS" };
const HYDROPONICS: RoomKindSpec = { kind: "hydroponics", name: "HYDROPONICS", cover: true };
const MED: RoomKindSpec = { kind: "med", name: "MED BAY" };
const LAB: RoomKindSpec = { kind: "lab", name: "LAB" };
const QUARANTINE: RoomKindSpec = { kind: "quarantine", name: "QUARANTINE" };
const ENGINEERING: RoomKindSpec = { kind: "engineering", name: "ENGINEERING", required: true };
const WORKSHOP: RoomKindSpec = { kind: "workshop", name: "WORKSHOP", cover: true };
const ARMORY: RoomKindSpec = { kind: "armory", name: "ARMORY", cover: true };
const REACTOR: RoomKindSpec = { kind: "reactor", name: "REACTOR", required: true, deep: true };
const CONTROL: RoomKindSpec = { kind: "control", name: "CONTROL", required: true, deep: true };
const CORE_ACCESS: RoomKindSpec = { kind: "coreaccess", name: "CORE ACCESS" };
const LIFE_SUPPORT: RoomKindSpec = { kind: "lifesupport", name: "LIFE SUPPORT" };
const CRYO: RoomKindSpec = { kind: "cryo", name: "CRYO" };
const SENSORS: RoomKindSpec = { kind: "sensors", name: "SENSOR BAY" };
const BRIG: RoomKindSpec = { kind: "brig", name: "BRIG" };
const ESCAPE_PODS: RoomKindSpec = { kind: "escapepods", name: "ESCAPE PODS" };

/** The whole catalogue. A ship class names a subset of these by `kind`. */
export const ZONE_KINDS: readonly RoomKindSpec[] = [
  DOCKING, CARGO, CORRIDOR, STORAGE, MAINTENANCE, HAB, MESS, HYDROPONICS,
  MED, LAB, QUARANTINE, ENGINEERING, WORKSHOP, ARMORY, REACTOR, CONTROL,
  CORE_ACCESS, LIFE_SUPPORT, CRYO, SENSORS, BRIG, ESCAPE_PODS,
];

const BY_KIND = new Map(ZONE_KINDS.map((z) => [z.kind, z]));

/**
 * The catalogue entry for a kind. Throws rather than returning undefined: a
 * ship class naming a compartment that does not exist is a typo in content, and
 * a typo that ships a nameless room is worse than one that fails a test.
 */
export function zoneKind(kind: string): RoomKindSpec {
  const spec = BY_KIND.get(kind);
  if (!spec) throw new Error(`zones: no compartment kind '${kind}'`);
  return spec;
}

/**
 * What a compartment is called on the screen.
 *
 * `RoomKindSpec.name` is what the generator stamps into `Room.name`, and that
 * happens once, when the ship is built — so it can only ever be one language.
 * The screen therefore never reads it: it asks here, by the `kind` the room is
 * carrying anyway, and gets whichever language is on right now. The stamped
 * name is the fallback, which is also what a hand-written fixture ship gets.
 *
 * Seven characters is what the schematic draws in a box (`ui/schematic.ts`),
 * so a translation longer than that is clipped rather than wrong; a test holds
 * every catalogue name in all three languages to the panel's width.
 */
export function zoneName(kind: string): string {
  return tId("room", kind, BY_KIND.get(kind)?.name ?? kind.toUpperCase());
}

/** The same for a room that already exists, tug compartments included. */
export function roomName(room: Pick<Room, "kind" | "name">): string {
  return tId("room", room.kind, room.name);
}

/** Is this a kind the catalogue knows? For content tests and validators. */
export function isZoneKind(kind: string): boolean {
  return BY_KIND.has(kind);
}
