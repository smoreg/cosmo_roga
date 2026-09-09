import { chebyshev, type Point } from "./grid.js";
import type { Entity } from "./entity.js";
import { isAlive } from "./entity.js";
import type { Level } from "./level.js";
import type { TargetingMode } from "./items.js";
import { hasLos } from "./fov.js";
import { disc, beam } from "./shapes.js";

/**
 * Targeting is a UI mode with rules, and the rules belong in sim/ so they can be
 * tested and so the AI can reuse them to decide whether a shot is even possible.
 *
 * Roguelike UI convention this follows: a cursor you can move with the same
 * movement keys, Tab to cycle live targets, and the affected area previewed
 * before the turn is spent — never "you fire and find out".
 */
export interface TargetingSession {
  readonly mode: TargetingMode;
  readonly origin: Point;
  cursor: Point;
}

export interface TargetingContext {
  level: Level;
  entities: readonly Entity[];
  /** Whose turn it is; excluded from the candidate list. */
  self: Entity;
}

export function beginTargeting(ctx: TargetingContext, mode: TargetingMode): TargetingSession {
  const origin = { ...ctx.self.pos };
  const first = candidates(ctx, mode)[0];
  return { mode, origin, cursor: first ? { ...first.pos } : origin };
}

/** Live enemies that could legally be picked, nearest first. */
export function candidates(ctx: TargetingContext, mode: TargetingMode): Entity[] {
  const range = maxRange(mode);
  return ctx.entities
    .filter((e) => e.id !== ctx.self.id && isAlive(e) && e.faction !== ctx.self.faction)
    .filter((e) => ctx.level.visible.get(e.pos.x, e.pos.y) === true)
    .filter((e) => chebyshev(e.pos, ctx.self.pos) <= range)
    .filter((e) => hasLos(ctx.level, ctx.self.pos, e.pos, range))
    .sort((a, b) => chebyshev(a.pos, ctx.self.pos) - chebyshev(b.pos, ctx.self.pos));
}

/** Tab-cycle to the next candidate after the one under the cursor. */
export function cycleTarget(ctx: TargetingContext, session: TargetingSession, step = 1): void {
  const list = candidates(ctx, session.mode);
  if (list.length === 0) return;
  const idx = list.findIndex((e) => e.pos.x === session.cursor.x && e.pos.y === session.cursor.y);
  const next = list[(((idx + step) % list.length) + list.length) % list.length]!;
  session.cursor = { ...next.pos };
}

/** Free cursor movement, clamped to the map and to the ability's range. */
export function moveCursor(ctx: TargetingContext, session: TargetingSession, dx: number, dy: number): void {
  const nx = session.cursor.x + dx;
  const ny = session.cursor.y + dy;
  if (!ctx.level.tiles.inBounds(nx, ny)) return;
  if (chebyshev({ x: nx, y: ny }, session.origin) > maxRange(session.mode)) return;
  session.cursor = { x: nx, y: ny };
}

export interface Validity {
  ok: boolean;
  reason?: string;
}

export function validateTarget(ctx: TargetingContext, session: TargetingSession): Validity {
  const { mode, cursor, origin } = session;
  const range = maxRange(mode);

  if (mode.kind === "self") return { ok: true };

  const dist = chebyshev(cursor, origin);
  if (dist === 0) return { ok: false, reason: "You cannot target yourself." };
  if (dist > range) return { ok: false, reason: "Out of range." };

  if (mode.kind === "adjacent" && dist > 1) return { ok: false, reason: "Too far to reach." };

  if (!hasLos(ctx.level, origin, cursor, range)) return { ok: false, reason: "You cannot see that spot." };

  if (mode.kind === "adjacent" || mode.kind === "ranged") {
    if (!targetAt(ctx, cursor)) return { ok: false, reason: "Nothing there to hit." };
  }
  return { ok: true };
}

/** Tiles the ability will affect, for the preview overlay. */
export function affectedArea(ctx: TargetingContext, session: TargetingSession): Point[] {
  const { mode, cursor, origin } = session;
  switch (mode.kind) {
    case "self":
      return [{ ...origin }];
    case "adjacent":
    case "ranged":
      return [{ ...cursor }];
    case "area":
      return disc(cursor, mode.radius).filter((p) => ctx.level.tiles.inBounds(p.x, p.y));
  }
}

/** Where a projectile actually lands: the cursor, or the wall that stopped it. */
export function impactPoint(ctx: TargetingContext, session: TargetingSession): Point {
  if (session.mode.kind === "self" || session.mode.kind === "adjacent") return { ...session.cursor };
  const path = beam(session.origin, session.cursor, maxRange(session.mode), (x, y) => !ctx.level.isTransparent(x, y));
  const last = path[path.length - 1];
  return last ? { ...last } : { ...session.origin };
}

export function targetAt(ctx: TargetingContext, p: Point): Entity | undefined {
  return ctx.entities.find((e) => isAlive(e) && e.pos.x === p.x && e.pos.y === p.y);
}

export function maxRange(mode: TargetingMode): number {
  switch (mode.kind) {
    case "self": return 0;
    case "adjacent": return 1;
    case "ranged": return mode.range;
    case "area": return mode.range;
  }
}
