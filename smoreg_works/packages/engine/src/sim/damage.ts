import type { Entity } from "./entity.js";
import type { TurnHost } from "./twist.js";
import { absorbDamage } from "./status.js";

export interface DamageResult {
  /** Damage that actually reached hit points. */
  toHp: number;
  /** Damage eaten by a shield status before HP. */
  absorbed: number;
  /** Damage the systems took away before statuses saw it. */
  intercepted: number;
  killed: boolean;
}

/**
 * The one road from "an attack happened" to "hit points went down".
 *
 * Everything that hurts an entity goes through here, so a twist that puts
 * something in front of hit points — armour that breaks, modules that burn,
 * a second health bar — needs exactly one hook and never a fork of combat.
 *
 * Order is systems, then statuses, then hit points: a system decides how much
 * of the blow is even a blow, and only what survives that meets the shield.
 *
 * The host is taken by shape rather than as a `Game`, because a blow lands the
 * same way on a grid and on a ship: all this needs is the list of systems.
 */
export function dealDamage(host: TurnHost, victim: Entity, raw: number, source?: Entity): DamageResult {
  let remaining = raw;
  for (const sys of host.systems) {
    if (!sys.onDamage) continue;
    const left = sys.onDamage(host, victim, remaining, source);
    // A hook that returns junk must not silently zero the hit; ignore it.
    remaining = Number.isFinite(left) ? Math.max(0, left) : remaining;
  }
  return applyDamage(victim, remaining, raw - remaining);
}

/**
 * Damage with nothing in the way: shields, then hit points. Used directly by
 * code that has no Game to consult (bare `attack`, effects without a context).
 */
export function applyDamage(victim: Entity, raw: number, intercepted = 0): DamageResult {
  const { toHp, absorbed } = absorbDamage(victim, raw);
  victim.hp -= toHp;
  const killed = victim.hp <= 0;
  if (killed) {
    victim.hp = 0;
    victim.alive = false;
  }
  return { toHp, absorbed, intercepted, killed };
}
