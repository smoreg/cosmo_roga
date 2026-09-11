/**
 * The exchange, and the forecast the player sees before committing to it.
 *
 * Attacker strikes, defender answers, alternating until both have spent their
 * strikes or one dies. The defender answers only with a weapon of the
 * attacker's class — so shooting something that has nothing but a cutting arm
 * draws no reply at all, and closing with the welder lets it answer every
 * time. That asymmetry is the whole positioning game.
 */

import { attackDeclared, strikeLanded, strikeMissed } from "./events";
import type { GameEvent } from "./events";
import { HIT_CHANCE } from "./roster";
import { chance } from "./rng";
import type { RngState } from "./rng";
import type { Weapon } from "./types";

export type StrikerRole = "attacker" | "defender";

/** The order blows land in, independent of whether any of them hit. */
export function strikeOrder(attackerStrikes: number, defenderStrikes: number): StrikerRole[] {
  const order: StrikerRole[] = [];
  let fromAttacker = 0;
  let fromDefender = 0;
  while (fromAttacker < attackerStrikes || fromDefender < defenderStrikes) {
    if (fromAttacker < attackerStrikes) {
      order.push("attacker");
      fromAttacker++;
    }
    if (fromDefender < defenderStrikes) {
      order.push("defender");
      fromDefender++;
    }
  }
  return order;
}

/** The weapon the defender may answer with: same class, or nothing. */
export function answeringWeapon(
  defenderWeapons: readonly Weapon[],
  incoming: Weapon,
): Weapon | null {
  for (const weapon of defenderWeapons) {
    if (weapon.weaponClass === incoming.weaponClass) return weapon;
  }
  return null;
}

export interface ExchangeInput {
  readonly attackerId: number;
  readonly attackerHp: number;
  readonly weapon: Weapon;
  readonly targetId: number;
  readonly targetHp: number;
  readonly targetIsObject: boolean;
  readonly answering: Weapon | null;
  readonly rng: RngState;
}

export interface ExchangeResult {
  readonly events: GameEvent[];
  readonly attackerHp: number;
  readonly targetHp: number;
  readonly rng: RngState;
}

export function resolveExchange(input: ExchangeInput): ExchangeResult {
  const events: GameEvent[] = [
    attackDeclared(
      input.attackerId,
      input.targetId,
      input.targetIsObject,
      input.weapon,
      input.answering,
    ),
  ];
  const order = strikeOrder(input.weapon.strikes, input.answering?.strikes ?? 0);

  let attackerHp = input.attackerHp;
  let targetHp = input.targetHp;
  let rng = input.rng;

  for (const role of order) {
    if (attackerHp <= 0 || targetHp <= 0) break;
    const [hit, nextRng] = chance(rng, HIT_CHANCE);
    rng = nextRng;

    if (role === "attacker") {
      if (hit) {
        targetHp -= input.weapon.damage;
        events.push(
          strikeLanded(
            input.attackerId,
            input.targetId,
            input.targetIsObject,
            input.weapon.damage,
            Math.max(0, targetHp),
          ),
        );
      } else {
        events.push(strikeMissed(input.attackerId, input.targetId, input.targetIsObject));
      }
      continue;
    }

    const answer = input.answering;
    if (answer === null) continue;
    if (hit) {
      attackerHp -= answer.damage;
      events.push(
        strikeLanded(
          input.targetId,
          input.attackerId,
          false,
          answer.damage,
          Math.max(0, attackerHp),
        ),
      );
    } else {
      events.push(strikeMissed(input.targetId, input.attackerId, false));
    }
  }

  return { events, attackerHp, targetHp, rng };
}

/* ---------- the forecast ----------

   Not an expected value but the whole distribution, convolved strike by
   strike. Wesnoth computes this for the same reason: with three drones a
   single exchange can cost a third of the squad, and showing the real odds
   before committing is what stops a fair fight from feeling rigged. */

export interface Forecast {
  readonly weapon: Weapon;
  readonly answering: Weapon | null;
  readonly expectedDealt: number;
  readonly expectedTaken: number;
  readonly chanceTargetDies: number;
  readonly chanceAttackerDies: number;
  /** Probability the attacker/target ends on each hit point total, index = hp. */
  readonly attackerHpChances: readonly number[];
  readonly targetHpChances: readonly number[];
}

export interface ForecastInput {
  readonly weapon: Weapon;
  readonly answering: Weapon | null;
  readonly attackerHp: number;
  readonly targetHp: number;
}

function indexOf(attackerHp: number, targetHp: number, targetSpan: number): number {
  return attackerHp * targetSpan + targetHp;
}

/** Typed-array writes, with the index check the compiler wants done once. */
function addAt(into: Float64Array, index: number, amount: number): void {
  into[index] = (into[index] ?? 0) + amount;
}

export function forecast(input: ForecastInput): Forecast {
  const attackerSpan = input.attackerHp + 1;
  const targetSpan = input.targetHp + 1;
  let distribution = new Float64Array(attackerSpan * targetSpan);
  distribution[indexOf(input.attackerHp, input.targetHp, targetSpan)] = 1;

  const order = strikeOrder(input.weapon.strikes, input.answering?.strikes ?? 0);
  for (const role of order) {
    const next = new Float64Array(distribution.length);
    for (let attackerHp = 0; attackerHp < attackerSpan; attackerHp++) {
      for (let targetHp = 0; targetHp < targetSpan; targetHp++) {
        const probability = distribution[indexOf(attackerHp, targetHp, targetSpan)] ?? 0;
        if (probability === 0) continue;

        // A finished exchange stays where it is.
        if (attackerHp === 0 || targetHp === 0) {
          addAt(next, indexOf(attackerHp, targetHp, targetSpan), probability);
          continue;
        }
        const damage = role === "attacker" ? input.weapon.damage : (input.answering?.damage ?? 0);
        if (damage === 0) {
          addAt(next, indexOf(attackerHp, targetHp, targetSpan), probability);
          continue;
        }
        addAt(next, indexOf(attackerHp, targetHp, targetSpan), probability * (1 - HIT_CHANCE));

        const hitIndex =
          role === "attacker"
            ? indexOf(attackerHp, Math.max(0, targetHp - damage), targetSpan)
            : indexOf(Math.max(0, attackerHp - damage), targetHp, targetSpan);
        addAt(next, hitIndex, probability * HIT_CHANCE);
      }
    }
    distribution = next;
  }

  const attackerHpChances = Array.from<number>({ length: attackerSpan }).fill(0);
  const targetHpChances = Array.from<number>({ length: targetSpan }).fill(0);
  let expectedDealt = 0;
  let expectedTaken = 0;
  for (let attackerHp = 0; attackerHp < attackerSpan; attackerHp++) {
    for (let targetHp = 0; targetHp < targetSpan; targetHp++) {
      const probability = distribution[indexOf(attackerHp, targetHp, targetSpan)] ?? 0;
      if (probability === 0) continue;
      attackerHpChances[attackerHp] = (attackerHpChances[attackerHp] ?? 0) + probability;
      targetHpChances[targetHp] = (targetHpChances[targetHp] ?? 0) + probability;
      expectedDealt += probability * (input.targetHp - targetHp);
      expectedTaken += probability * (input.attackerHp - attackerHp);
    }
  }

  return {
    weapon: input.weapon,
    answering: input.answering,
    expectedDealt,
    expectedTaken,
    chanceTargetDies: targetHpChances[0] ?? 0,
    chanceAttackerDies: attackerHpChances[0] ?? 0,
    attackerHpChances,
    targetHpChances,
  };
}
