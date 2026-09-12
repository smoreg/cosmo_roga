import type { Axial } from "./hex";
import type { RngState } from "./rng";

export type Side = "drone" | "ship";
export type WeaponClass = "melee" | "ranged";
export type UnitType = "drone" | "scout" | "sentinel" | "hunter";
export type ObjectKind = "spawner" | "node";
/**
 * `locked` is not a heavier `closed`: it cannot be forced by walking into it.
 * It has to be cut open, and it has one hit point, so a single landed strike
 * does it — leaving it `broken`, which is a hole rather than a door and can
 * never be shut again.
 */
export type DoorState = "open" | "closed" | "locked" | "broken";
export type Outcome = "win" | "loss";

export interface Weapon {
  readonly name: string;
  readonly weaponClass: WeaponClass;
  readonly damage: number;
  readonly strikes: number;
}

export interface UnitProfile {
  readonly type: UnitType;
  readonly label: string;
  readonly side: Side;
  readonly hitPoints: number;
  /** How far it goes in a turn, in feet — the hex size turns it into steps. */
  readonly movementFeet: number;
  readonly cost: number;
  readonly weapons: readonly Weapon[];
}

export interface Unit {
  readonly id: number;
  readonly type: UnitType;
  readonly side: Side;
  readonly name: string;
  readonly at: Axial;
  readonly hp: number;
  readonly maxHp: number;
  readonly movement: number;
  readonly maxMovement: number;
  /** Has already attacked this turn. Movement is tracked separately, as in Wesnoth. */
  readonly hasAttacked: boolean;
}

export interface MapObject {
  readonly id: number;
  readonly kind: ObjectKind;
  readonly name: string;
  readonly zoneId: number;
  readonly at: Axial;
  readonly hp: number;
  readonly maxHp: number;
}

/* ---------- the deck, which never changes during a match ---------- */

export interface Zone {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly roles: readonly string[];
  readonly areaSqFt: number;
  readonly hazard: string | null;
  readonly isEntry: boolean;
  readonly isSealed: boolean;
  readonly marks: readonly string[];
  readonly sourceTile: string;
}

export interface Cell {
  readonly at: Axial;
  readonly zoneId: number;
  /** Every zone this hex covers, not only the one that owns most of it. */
  readonly overlaps: readonly number[];
}

export interface Door {
  readonly id: number;
  readonly zoneA: number;
  readonly zoneB: number;
  /** What the generator drew. The mission starts from this, not from open. */
  readonly initialState: DoorState;
  /** True when the deck stays connected without this door. */
  readonly isLoop: boolean;
  readonly from: Axial;
  readonly to: Axial;
  readonly atFeet: readonly [number, number];
}

export interface TilePlacement {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface DeckMap {
  readonly name: string;
  readonly seed: string;
  readonly feetAcross: number;
  readonly sizeFeet: readonly [number, number];
  readonly zones: ReadonlyMap<number, Zone>;
  readonly cells: ReadonlyMap<string, Cell>;
  readonly doors: readonly Door[];
  readonly doorsByEdge: ReadonlyMap<string, Door>;
  /** Zones a drone can walk to from the boarding point. */
  readonly reachableZones: ReadonlySet<number>;
  readonly entryZoneId: number;
  /** Tile placements, for the backdrop renderer. */
  readonly plan: readonly TilePlacement[];
}

/* ---------- the part that does change ---------- */

export interface GameState {
  readonly rng: RngState;
  readonly turn: number;
  readonly side: Side;
  /** Shared spawn budget, in resources. */
  readonly pool: number;
  /** Paid per live node per turn. */
  readonly incomePerNode: number;
  readonly units: readonly Unit[];
  readonly objects: readonly MapObject[];
  readonly doorStates: ReadonlyMap<number, DoorState>;
  readonly nextUnitId: number;
  readonly outcome: Outcome | null;
}

export interface MissionSettings {
  readonly seed: string;
  readonly incomePerNode: number;
  readonly spawnerHitPoints: number;
  readonly nodeHitPoints: number;
}

export interface Mission {
  readonly deck: DeckMap;
  readonly settings: MissionSettings;
  readonly state: GameState;
}
