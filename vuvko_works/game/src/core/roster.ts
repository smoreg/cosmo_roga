import type { UnitProfile, UnitType } from "./types";

/**
 * Damage-strikes, as in the brief. A weapon's class decides whether the
 * defender may answer: melee answers melee, ranged answers ranged, and a unit
 * with no weapon of the attacker's class does not strike back at all.
 */
export const ROSTER: Readonly<Record<UnitType, UnitProfile>> = {
  drone: {
    type: "drone",
    label: "Drone",
    side: "drone",
    hitPoints: 12,
    movement: 4,
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
    movement: 4,
    cost: 6,
    weapons: [{ name: "claw", weaponClass: "melee", damage: 1, strikes: 2 }],
  },
  sentinel: {
    type: "sentinel",
    label: "Sentinel",
    side: "ship",
    hitPoints: 8,
    movement: 4,
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
    movement: 4,
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
