/** What a player or the ship's own turn can ask for. Built by name, like events. */

import type { Axial } from "./hex";

export interface MoveUnit {
  readonly kind: "moveUnit";
  readonly unitId: number;
  readonly to: Axial;
}

export interface AttackWith {
  readonly kind: "attackWith";
  readonly attackerId: number;
  readonly weaponIndex: number;
  readonly target: Axial;
}

export interface EndTurn {
  readonly kind: "endTurn";
}

export type Command = MoveUnit | AttackWith | EndTurn;

export function moveUnit(unitId: number, to: Axial): MoveUnit {
  return { kind: "moveUnit", unitId, to };
}

export function attackWith(attackerId: number, weaponIndex: number, target: Axial): AttackWith {
  return { kind: "attackWith", attackerId, weaponIndex, target };
}

export function endTurn(): EndTurn {
  return { kind: "endTurn" };
}
