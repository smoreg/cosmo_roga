import type { UnitProfile, UnitType } from "./types";

/**
 * Damage-strikes, as in the brief. A weapon's class decides whether the
 * defender may answer: melee answers melee, ranged answers ranged, and a unit
 * with no weapon of the attacker's class does not strike back at all.
 */
/**
 * The hex size the rules were tuned at.
 *
 * Nothing is played at this size by default any more, but two quantities were
 * chosen while it was — how far a turn gets you, and how big a room has to be
 * to be worth taking — and both are recorded as the distance and the area
 * they came to rather than as the step counts they happened to be.
 */
export const REFERENCE_HEX_FEET = 35;

/**
 * How far anything aboard moves in a turn, in feet.
 *
 * It was four hexes when a hex was thirty-five feet, and it is the distance
 * that was tuned, not the number of steps — a drone crosses a large
 * compartment and no more. Stating it in feet means changing the hex size
 * changes the *grain* of a turn, which is the interesting part, instead of
 * secretly changing how far a turn gets you, which is not.
 */
const MOVEMENT_FEET = 4 * REFERENCE_HEX_FEET;

export const ROSTER: Readonly<Record<UnitType, UnitProfile>> = {
  drone: {
    type: "drone",
    label: "Drone",
    side: "drone",
    hitPoints: 12,
    movementFeet: MOVEMENT_FEET,
    cost: 0,
    weapons: [
      { name: "welder", weaponClass: "melee", damage: 3, strikes: 1 },
      { name: "emitter", weaponClass: "ranged", damage: 2, strikes: 2 },
    ],
  },
  scout: {
    type: "scout",
    label: "Scout",
    side: "ship",
    hitPoints: 4,
    movementFeet: MOVEMENT_FEET,
    cost: 6,
    weapons: [{ name: "claw", weaponClass: "melee", damage: 1, strikes: 2 }],
  },
  sentinel: {
    type: "sentinel",
    label: "Sentinel",
    side: "ship",
    hitPoints: 8,
    movementFeet: MOVEMENT_FEET,
    cost: 11,
    weapons: [
      { name: "ram", weaponClass: "melee", damage: 3, strikes: 2 },
      { name: "arc", weaponClass: "ranged", damage: 1, strikes: 2 },
    ],
  },
  hunter: {
    type: "hunter",
    label: "Hunter",
    side: "ship",
    hitPoints: 8,
    movementFeet: MOVEMENT_FEET,
    cost: 15,
    weapons: [
      { name: "blade", weaponClass: "melee", damage: 2, strikes: 2 },
      { name: "lance", weaponClass: "ranged", damage: 3, strikes: 3 },
    ],
  },
};

export const SHIP_UNIT_TYPES: readonly UnitType[] = ["scout", "sentinel", "hunter"];

/** Every strike is an independent draw at this chance. */
export const HIT_CHANCE = 0.75;

export function profileOf(type: UnitType): UnitProfile {
  return ROSTER[type];
}

/**
 * A turn's movement in steps, on a deck laid out at this hex size.
 *
 * Always at least one: a unit that cannot move at all is not a slower unit,
 * it is a broken one.
 */
export function movementHexes(profile: UnitProfile, feetAcross: number): number {
  return Math.max(1, Math.round(profile.movementFeet / feetAcross));
}
