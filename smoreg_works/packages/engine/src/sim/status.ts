import type { Entity } from "./entity.js";
import type { Rng } from "./rng.js";

export type StatusKind =
  | "poison"
  | "burn"
  | "stun"
  | "slow"
  | "haste"
  | "blind"
  | "shield"
  | "regen"
  | "confuse";

export interface Status {
  kind: StatusKind;
  /** Remaining turns. Decremented once per the bearer's turn. */
  turns: number;
  /** Strength: damage per tick, points of shield, speed delta, and so on. */
  magnitude: number;
}

/**
 * Stats a status (or later an item, or a twist) may modify.
 *
 * Borrowed from prism's Condition/ConditionModifier split: rather than each
 * status hard-coding which derived value it touches, it declares modifiers and
 * one function resolves them. Adding "this ring grants +2 defense" then needs
 * no new branch anywhere in the turn loop.
 */
export type Stat = "speed" | "fovRadius" | "defense" | "damageBonus";

export interface Modifier {
  /** Applied first, multiplicatively. */
  mul?: number;
  /** Applied after the multiplier. */
  add?: number;
}

export interface StatusDef {
  name: string;
  tone: "good" | "bad";
  /** Damage per turn (positive) or healing (negative). */
  tickDamage?: number;
  /** Changes to derived stats while the status is active. */
  modifiers?: Partial<Record<Stat, Modifier>>;
  /** The bearer cannot choose its action this turn. */
  scramblesAction?: boolean;
  /** Absorbs incoming damage before HP. */
  absorbs?: boolean;
  /** Applying this cancels that one instead of stacking. */
  opposes?: StatusKind;
}

/**
 * Status effects as data. Adding one is a table entry plus, at most, one line in
 * the two derived-stat helpers below — never a new branch in the turn loop.
 * That is what keeps a jam's content pass cheap on day 6.
 */
export const STATUS: Record<StatusKind, StatusDef> = {
  poison:  { name: "poisoned", tone: "bad",  tickDamage: 1 },
  burn:    { name: "burning",  tone: "bad",  tickDamage: 2 },
  stun:    { name: "stunned",  tone: "bad",  scramblesAction: true },
  slow:    { name: "slowed",   tone: "bad",  modifiers: { speed: { mul: 0.5 } }, opposes: "haste" },
  haste:   { name: "hastened", tone: "good", modifiers: { speed: { mul: 2 } }, opposes: "slow" },
  blind:   { name: "blinded",  tone: "bad",  modifiers: { fovRadius: { mul: 0.15 } } },
  shield:  { name: "shielded", tone: "good", absorbs: true },
  regen:   { name: "regenerating", tone: "good", tickDamage: -1 },
  confuse: { name: "confused", tone: "bad",  scramblesAction: true },
};

export function statusesOf(e: Entity): Status[] {
  if (!e.statuses) e.statuses = [];
  return e.statuses;
}

export function hasStatus(e: Entity, kind: StatusKind): boolean {
  return statusesOf(e).some((s) => s.kind === kind && s.turns > 0);
}

export function statusMagnitude(e: Entity, kind: StatusKind): number {
  return statusesOf(e).find((s) => s.kind === kind && s.turns > 0)?.magnitude ?? 0;
}

export interface StatusChange {
  applied: boolean;
  /** Set when this application cancelled an opposing status instead. */
  cancelled?: StatusKind;
  message: string;
}

/**
 * Apply a status. Opposing pairs cancel (haste vs slow) rather than coexisting;
 * same-kind applications refresh duration and take the stronger magnitude.
 */
export function applyStatus(e: Entity, kind: StatusKind, turns: number, magnitude = 1): StatusChange {
  const list = statusesOf(e);
  const def = STATUS[kind];

  if (def.opposes) {
    const other = list.find((s) => s.kind === def.opposes && s.turns > 0);
    if (other) {
      other.turns = 0;
      return { applied: false, cancelled: def.opposes, message: `${STATUS[def.opposes].name} wears off` };
    }
  }

  const existing = list.find((s) => s.kind === kind && s.turns > 0);
  if (existing) {
    existing.turns = Math.max(existing.turns, turns);
    existing.magnitude = Math.max(existing.magnitude, magnitude);
    return { applied: true, message: `${def.name} (extended)` };
  }

  list.push({ kind, turns, magnitude });
  return { applied: true, message: def.name };
}

export function clearStatus(e: Entity, kind: StatusKind): void {
  for (const s of statusesOf(e)) if (s.kind === kind) s.turns = 0;
}

export interface TickResult {
  /** Net HP change applied this tick (negative = damage taken). */
  hpDelta: number;
  expired: StatusKind[];
  messages: string[];
}

/**
 * Advance one turn of statuses for a single entity. Call once per its turn,
 * before it acts, so "poisoned and out of HP" resolves before it swings.
 */
export function tickStatuses(e: Entity, _rng: Rng): TickResult {
  const result: TickResult = { hpDelta: 0, expired: [], messages: [] };
  const list = statusesOf(e);

  for (const s of list) {
    if (s.turns <= 0) continue;
    const def = STATUS[s.kind];
    if (def.tickDamage) {
      const delta = -def.tickDamage * s.magnitude;
      result.hpDelta += delta;
    }
    s.turns--;
    if (s.turns <= 0) {
      result.expired.push(s.kind);
      result.messages.push(`${def.name} wears off`);
    }
  }

  e.statuses = list.filter((s) => s.turns > 0);

  if (result.hpDelta !== 0) {
    e.hp = Math.max(0, Math.min(e.hpMax, e.hp + result.hpDelta));
    if (e.hp === 0) e.alive = false;
  }
  return result;
}

const BASE_STAT: Record<Stat, (e: Entity) => number> = {
  speed: (e) => e.speed,
  fovRadius: (e) => e.fovRadius,
  defense: (e) => e.defense,
  damageBonus: (e) => e.damage[2],
};

/** Stats that must never fall below 1; the rest may reach zero. */
const STAT_FLOOR: Record<Stat, number> = { speed: 1, fovRadius: 1, defense: 0, damageBonus: -99 };

/**
 * A stat after every active modifier. Multipliers apply first, then additions,
 * then the floor. This is the only correct way to read these values — reading
 * `entity.speed` directly silently ignores haste, slow and everything added later.
 */
export function modifiedStat(e: Entity, stat: Stat): number {
  let value = BASE_STAT[stat](e);
  let add = 0;
  for (const s of statusesOf(e)) {
    if (s.turns <= 0) continue;
    const mod = STATUS[s.kind].modifiers?.[stat];
    if (!mod) continue;
    if (mod.mul !== undefined) value *= mod.mul;
    if (mod.add !== undefined) add += mod.add * s.magnitude;
  }
  return Math.max(STAT_FLOOR[stat], Math.round(value + add));
}

/** Speed after statuses. The scheduler must use this, never `entity.speed`. */
export function effectiveSpeed(e: Entity): number {
  return modifiedStat(e, "speed");
}

/** Sight radius after statuses. */
export function effectiveFov(e: Entity): number {
  return modifiedStat(e, "fovRadius");
}

/** Defense after statuses. Combat must use this, never `entity.defense`. */
export function effectiveDefense(e: Entity): number {
  return modifiedStat(e, "defense");
}

/** True when the entity cannot choose its own action this turn. */
export function actionScrambled(e: Entity): boolean {
  return statusesOf(e).some((s) => s.turns > 0 && STATUS[s.kind].scramblesAction === true);
}

/**
 * Route damage through absorbing statuses first. Returns what actually reached
 * HP, so the caller can log "your shield absorbs 3" honestly.
 */
export function absorbDamage(e: Entity, amount: number): { toHp: number; absorbed: number } {
  let remaining = amount;
  let absorbed = 0;
  for (const s of statusesOf(e)) {
    if (s.turns <= 0 || !STATUS[s.kind].absorbs) continue;
    const take = Math.min(s.magnitude, remaining);
    s.magnitude -= take;
    remaining -= take;
    absorbed += take;
    if (s.magnitude <= 0) s.turns = 0;
    if (remaining <= 0) break;
  }
  e.statuses = statusesOf(e).filter((s) => s.turns > 0);
  return { toHp: remaining, absorbed };
}

/** Compact HUD string: "poisoned 3, hastened 5". */
export function statusLine(e: Entity): string {
  return statusesOf(e)
    .filter((s) => s.turns > 0)
    .map((s) => `${STATUS[s.kind].name} ${s.turns}`)
    .join(", ");
}
