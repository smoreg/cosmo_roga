import type { Rng } from "./rng.js";

export interface SpawnEntry<T> {
  value: T;
  /** Base relative weight. */
  weight: number;
  minDepth: number;
  maxDepth: number;
  /**
   * Optional depth shaping. Return a multiplier for the base weight; use it to
   * make a monster common in the middle of its band and rare at the edges.
   */
  weightAt?(depth: number): number;
}

/**
 * One generic weighted table for monsters, items, vaults and traps. Content
 * tuning happens by editing entries; no call site ever needs to change.
 */
export class SpawnTable<T> {
  private entries: Array<SpawnEntry<T>>;

  constructor(entries: Array<SpawnEntry<T>>) {
    this.entries = entries;
  }

  eligible(depth: number): Array<SpawnEntry<T>> {
    return this.entries.filter((e) => depth >= e.minDepth && depth <= e.maxDepth && this.weightOf(e, depth) > 0);
  }

  private weightOf(e: SpawnEntry<T>, depth: number): number {
    const mul = e.weightAt ? e.weightAt(depth) : 1;
    return Math.max(0, e.weight * mul);
  }

  /** Weighted pick, or undefined when nothing is legal at this depth. */
  pick(depth: number, rng: Rng): T | undefined {
    const pool = this.eligible(depth);
    if (pool.length === 0) return undefined;
    let total = 0;
    for (const e of pool) total += this.weightOf(e, depth);
    let r = rng.next() * total;
    for (const e of pool) {
      r -= this.weightOf(e, depth);
      if (r <= 0) return e.value;
    }
    return pool[pool.length - 1]!.value;
  }

  pickMany(depth: number, count: number, rng: Rng): T[] {
    const out: T[] = [];
    for (let i = 0; i < count; i++) {
      const v = this.pick(depth, rng);
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  /** Probability of each entry at a depth. For balance dashboards and tests. */
  distribution(depth: number): Array<{ value: T; p: number }> {
    const pool = this.eligible(depth);
    const total = pool.reduce((s, e) => s + this.weightOf(e, depth), 0);
    if (total === 0) return [];
    return pool.map((e) => ({ value: e.value, p: this.weightOf(e, depth) / total }));
  }
}

export interface CurveOptions {
  /** Value at depth 1. */
  base: number;
  /** Added per depth level. */
  perDepth: number;
  /** Hard ceiling, so depth 20 does not spawn 40 monsters. */
  max?: number;
  /** Random spread, +/- this fraction. 0.2 = +/-20%. */
  jitter?: number;
}

/**
 * The difficulty curve as one function with visible numbers, rather than magic
 * arithmetic scattered through the spawner. Balance day is then a matter of
 * editing four numbers and re-running the metrics harness.
 */
export function curve(depth: number, opts: CurveOptions, rng?: Rng): number {
  let v = opts.base + opts.perDepth * (depth - 1);
  if (opts.max !== undefined) v = Math.min(v, opts.max);
  if (rng && opts.jitter) {
    const spread = v * opts.jitter;
    v += rng.next() * spread * 2 - spread;
  }
  return Math.max(0, Math.round(v));
}

/**
 * A band function for `weightAt`: peaks in the middle of [from, to] and falls
 * to zero outside it. Gives each monster a natural window of relevance.
 */
export function band(from: number, to: number): (depth: number) => number {
  const mid = (from + to) / 2;
  const half = Math.max(1, (to - from) / 2);
  return (depth: number) => {
    if (depth < from || depth > to) return 0;
    return 1 - Math.abs(depth - mid) / (half + 1);
  };
}
