import type { Entity } from "./entity.js";
import { isAlive } from "./entity.js";
import { effectiveSpeed } from "./status.js";

export const TURN_COST = 100;

/**
 * Energy-based turn order. Deterministic: on every "beat" all living actors
 * gain `speed` energy, then whoever crossed TURN_COST acts, in ascending id
 * order. No wall clock, no callbacks, no rot.js Engine locks -> unit-testable
 * and replayable.
 */
export class Schedule {
  /** Whole game turns elapsed (one beat of a speed-100 actor). */
  time = 0;

  /**
   * Returns the next actor that may act, adding energy as needed.
   * `actors` is read every call, so entities may die or spawn mid-turn.
   */
  next(actors: Entity[]): Entity | undefined {
    const living = actors.filter(isAlive);
    if (living.length === 0) return undefined;

    for (let guard = 0; guard < 1000; guard++) {
      const ready = living.filter((e) => e.energy >= TURN_COST).sort((a, b) => a.id - b.id);
      if (ready.length > 0) return ready[0]!;
      // Status-adjusted, so haste and slow work without the scheduler knowing
      // what a status is.
      for (const e of living) e.energy += effectiveSpeed(e);
      this.time++;
    }
    throw new Error("Schedule.next: no actor became ready in 1000 beats (all speeds zero?)");
  }

  /** Charge an actor for an action. cost 100 = one normal turn. */
  spend(actor: Entity, cost: number = TURN_COST): void {
    actor.energy -= cost;
  }

  /** New actors start ready-ish so they do not get a free double turn. */
  admit(actor: Entity): void {
    actor.energy = 0;
  }
}
