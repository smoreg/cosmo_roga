import type { Point } from "./grid.js";
import type { Entity } from "./entity.js";
import { isAlive } from "./entity.js";
import type { Level } from "./level.js";
import type { Rng } from "./rng.js";
import { applyDamage, type DamageResult } from "./damage.js";
import { applyStatus, type StatusKind } from "./status.js";
import { line } from "./shapes.js";

/**
 * Effects are data, never functions. An item, a monster ability and a trap all
 * describe what they do with the same list of these, which means new content is
 * a table entry and new *kinds* of content are one case in applyEffect.
 */
export type Effect =
  | { kind: "damage"; dice: [number, number, number] }
  | { kind: "heal"; amount: number }
  | { kind: "status"; status: StatusKind; turns: number; magnitude?: number }
  | { kind: "cure"; status: StatusKind }
  | { kind: "teleport"; range: number }
  | { kind: "push"; distance: number }
  | { kind: "pull"; distance: number }
  | { kind: "noise"; strength: number };

/** Everything an effect is allowed to touch. Keeps effects.ts free of Game. */
export interface EffectContext {
  level: Level;
  entities: Entity[];
  rng: Rng;
  /** Emit a player-facing line. */
  log(text: string, tone?: "plain" | "good" | "bad" | "warn"): void;
  /** Register a noise source for this turn, if the game tracks noise. */
  noise?(pos: Point, strength: number): void;
  /**
   * Route damage through the game's systems, so a potion of fire hurts the
   * same way a sword does. Absent = straight to shields and hit points.
   */
  damage?(target: Entity, raw: number, source?: Entity): DamageResult;
  blocked(x: number, y: number): boolean;
}

export interface EffectOutcome {
  /** Total HP actually removed from targets. */
  damage: number;
  /** Total HP restored. */
  healed: number;
  killed: Entity[];
  /** Human-readable summary lines, already logged. */
  notes: string[];
}

const EMPTY = (): EffectOutcome => ({ damage: 0, healed: 0, killed: [], notes: [] });

/** Apply a list of effects to one target entity. */
export function applyEffects(
  ctx: EffectContext,
  source: Entity | undefined,
  target: Entity,
  effects: readonly Effect[],
): EffectOutcome {
  const out = EMPTY();
  for (const e of effects) merge(out, applyEffect(ctx, source, target, e));
  return out;
}

/** Apply a list of effects to every entity standing in an area. */
export function applyEffectsToArea(
  ctx: EffectContext,
  source: Entity | undefined,
  area: readonly Point[],
  effects: readonly Effect[],
): EffectOutcome {
  const out = EMPTY();
  const hit = new Set(area.map((p) => `${p.x},${p.y}`));
  for (const target of ctx.entities.filter((e) => isAlive(e) && hit.has(`${e.pos.x},${e.pos.y}`))) {
    merge(out, applyEffects(ctx, source, target, effects));
  }
  return out;
}

export function applyEffect(
  ctx: EffectContext,
  source: Entity | undefined,
  target: Entity,
  effect: Effect,
): EffectOutcome {
  const out = EMPTY();
  const who = target.name;

  switch (effect.kind) {
    case "damage": {
      const [n, sides, bonus] = effect.dice;
      const raw = ctx.rng.roll(n, sides) + bonus;
      const res = ctx.damage ? ctx.damage(target, raw, source) : applyDamage(target, raw);
      if (res.absorbed > 0) note(ctx, out, `a shield absorbs ${res.absorbed}`, "good");
      if (res.toHp > 0) {
        out.damage += res.toHp;
        note(ctx, out, `${who} takes ${res.toHp}`, "bad");
      }
      if (res.killed) {
        out.killed.push(target);
        note(ctx, out, `${who} dies`, "bad");
      }
      return out;
    }

    case "heal": {
      const before = target.hp;
      target.hp = Math.min(target.hpMax, target.hp + effect.amount);
      const gained = target.hp - before;
      out.healed += gained;
      note(ctx, out, gained > 0 ? `${who} recovers ${gained}` : `${who} is already whole`, "good");
      return out;
    }

    case "status": {
      const change = applyStatus(target, effect.status, effect.turns, effect.magnitude ?? 1);
      note(ctx, out, `${who}: ${change.message}`, change.applied ? "warn" : "good");
      return out;
    }

    case "cure": {
      const had = (target.statuses ?? []).some((s) => s.kind === effect.status && s.turns > 0);
      for (const s of target.statuses ?? []) if (s.kind === effect.status) s.turns = 0;
      target.statuses = (target.statuses ?? []).filter((s) => s.turns > 0);
      note(ctx, out, had ? `${who} is cured` : `nothing happens`, "good");
      return out;
    }

    case "teleport": {
      const spot = randomSpotNear(ctx, target.pos, effect.range);
      if (!spot) {
        note(ctx, out, `${who} shimmers, but stays put`, "warn");
        return out;
      }
      target.pos = spot;
      note(ctx, out, `${who} blinks away`, "warn");
      return out;
    }

    case "push":
    case "pull": {
      if (!source) return out;
      const dist = effect.kind === "push" ? effect.distance : -effect.distance;
      const moved = shove(ctx, source.pos, target, dist);
      note(ctx, out, moved > 0 ? `${who} is ${effect.kind}ed ${moved}` : `${who} holds firm`, "warn");
      return out;
    }

    case "noise": {
      ctx.noise?.(target.pos, effect.strength);
      return out;
    }
  }
}

/** Shove `target` away from `from` (positive) or towards it (negative). */
function shove(ctx: EffectContext, from: Point, target: Entity, distance: number): number {
  const dir = distance >= 0 ? 1 : -1;
  const steps = Math.abs(distance);
  const dx = Math.sign(target.pos.x - from.x) * dir;
  const dy = Math.sign(target.pos.y - from.y) * dir;
  if (dx === 0 && dy === 0) return 0;

  let moved = 0;
  for (let i = 0; i < steps; i++) {
    const nx = target.pos.x + dx;
    const ny = target.pos.y + dy;
    if (ctx.blocked(nx, ny)) break;
    if (ctx.entities.some((e) => isAlive(e) && e.pos.x === nx && e.pos.y === ny)) break;
    target.pos = { x: nx, y: ny };
    moved++;
  }
  return moved;
}

function randomSpotNear(ctx: EffectContext, from: Point, range: number): Point | undefined {
  const candidates: Point[] = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = from.x + dx;
      const y = from.y + dy;
      if (dx === 0 && dy === 0) continue;
      if (ctx.blocked(x, y)) continue;
      if (ctx.entities.some((e) => isAlive(e) && e.pos.x === x && e.pos.y === y)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return undefined;
  return candidates[ctx.rng.int(0, candidates.length - 1)];
}

/** Tiles a projectile actually passes through, stopping at the first blocker. */
export function projectilePath(ctx: EffectContext, from: Point, to: Point): Point[] {
  const out: Point[] = [];
  for (const p of line(from, to)) {
    if (p.x === from.x && p.y === from.y) continue;
    out.push(p);
    if (ctx.blocked(p.x, p.y)) break;
  }
  return out;
}

function note(ctx: EffectContext, out: EffectOutcome, text: string, tone: "plain" | "good" | "bad" | "warn"): void {
  out.notes.push(text);
  ctx.log(text, tone);
}

function merge(into: EffectOutcome, from: EffectOutcome): void {
  into.damage += from.damage;
  into.healed += from.healed;
  into.killed.push(...from.killed);
  into.notes.push(...from.notes);
}
