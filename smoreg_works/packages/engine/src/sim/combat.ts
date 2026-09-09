import type { Entity } from "./entity.js";
import type { Rng } from "./rng.js";
import { applyDamage, type DamageResult } from "./damage.js";
import { effectiveDefense, modifiedStat } from "./status.js";

export interface AttackResult {
  hit: boolean;
  /** Damage that actually reached hit points. */
  damage: number;
  /** Damage eaten by a shield before HP. */
  absorbed: number;
  /** Damage a system took away before it could reach HP. */
  intercepted: number;
  killed: boolean;
}

/**
 * Where the blow lands once the dice are rolled. Given one, `attack` hands the
 * post-armour number over instead of subtracting hit points itself — that is
 * how `dealDamage`, and through it the twist, gets in front of the damage.
 */
export type DamageSink = (victim: Entity, raw: number) => DamageResult;

/**
 * Deliberately boring combat: to-hit is deterministic (always hits), damage is
 * dice minus flat defense. A traditional roguelike is read through positioning,
 * not through miss chance — and "I missed 4 times in a row" is the single most
 * common jam-feedback complaint.
 */
export function attack(attacker: Entity, defender: Entity, rng: Rng, sink?: DamageSink): AttackResult {
  const [n, sides] = attacker.damage;
  // Stat modifiers, not raw fields: a hasted attacker with a defense debuff on
  // its target must see both effects without combat knowing what a status is.
  const raw = rng.roll(n, sides) + modifiedStat(attacker, "damageBonus");
  const afterArmour = Math.max(1, raw - effectiveDefense(defender));
  const res = sink ? sink(defender, afterArmour) : applyDamage(defender, afterArmour);

  return { hit: true, damage: res.toHp, absorbed: res.absorbed, intercepted: res.intercepted, killed: res.killed };
}
