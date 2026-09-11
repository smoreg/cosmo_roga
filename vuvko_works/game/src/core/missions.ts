/**
 * What a run is made of.
 *
 * One mission type for now, and the table exists so the second one is a row
 * rather than a refactor. The profiles are the hulls `hexmap.html` builds —
 * the same four its own generator offers.
 */

import { pickOne } from "./rng";
import type { RngState } from "./rng";

export interface MissionType {
  readonly id: string;
  readonly name: string;
  /** What the player is told to do. */
  readonly objective: string;
  /** How the game decides it is done. */
  readonly victory: string;
}

export const MISSION_TYPES: readonly MissionType[] = [
  {
    id: "secure",
    name: "Secure the ship",
    objective: "Clear the derelict. Nothing aboard, and nothing able to come aboard.",
    victory:
      "Level every spawn zone — or cut the nodes that pay for them, kill what is already walking, and leave the ship unable to build another.",
  },
];

export type ShipProfileCode = "1-2-1" | "1-2-3" | "2-1-2" | "3-2-1";

export interface ShipProfile {
  readonly code: ShipProfileCode;
  readonly name: string;
  readonly shape: string;
}

/** A hull described by its sections: "2-1-2" is two bays wide, then one, then two. */
export const SHIP_PROFILES: readonly ShipProfile[] = [
  { code: "1-2-1", name: "Bulged", shape: "Narrow at both ends, wide amidships." },
  { code: "1-2-3", name: "Tapered", shape: "Opening out from a sharp bow to a broad stern." },
  { code: "2-1-2", name: "Waisted", shape: "Pinched in the middle, heavy fore and aft." },
  { code: "3-2-1", name: "Wedge", shape: "Broad across the bow, narrowing all the way down." },
];

export interface MissionBrief {
  readonly type: MissionType;
  readonly profile: ShipProfile;
  /** The seed the deck and the mission are both built from. */
  readonly seed: string;
}

export function missionTypeById(id: string): MissionType | null {
  for (const type of MISSION_TYPES) {
    if (type.id === id) return type;
  }
  return null;
}

export function shipProfileByCode(code: string): ShipProfile | null {
  for (const profile of SHIP_PROFILES) {
    if (profile.code === code) return profile;
  }
  return null;
}

/** Roll a mission type, a hull, and the seed both are built from. */
export function rollMission(rng: RngState): [MissionBrief, RngState] {
  const [rolledType, afterType] = pickOne(rng, MISSION_TYPES);
  const [rolledProfile, afterProfile] = pickOne(afterType, SHIP_PROFILES);

  const type = rolledType ?? MISSION_TYPES[0];
  const profile = rolledProfile ?? SHIP_PROFILES[0];
  if (type === undefined || profile === undefined) throw new Error("no missions defined");

  return [{ type, profile, seed: seedName(afterProfile) }, afterProfile];
}

/** A seed a person can read back to you over a radio. */
export function seedName(rng: RngState): string {
  return `${rng.seed.toString(36).toUpperCase().slice(0, 4)}-${String(rng.cursor).padStart(3, "0")}`;
}
