/**
 * Seeded RNG. Own implementation (mulberry32) rather than ROT.RNG because:
 *  - state is a single integer -> trivially serialisable into a save/replay file
 *  - instances are independent, so map generation cannot desync combat rolls
 *
 * ROT.RNG is still seeded from here before every rot.js map generator call,
 * see mapgen.ts.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  static fromString(s: string): Rng {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return new Rng(h >>> 0);
  }

  /** Serialisable state. */
  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [lo, hi] inclusive */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** true with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 1..sides */
  die(sides: number): number {
    return this.int(1, sides);
  }

  /** n dice of `sides`, e.g. roll(2, 6) == 2d6 */
  roll(n: number, sides: number): number {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.die(sides);
    return sum;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick: empty array");
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Fisher-Yates, in place, returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = a;
    }
    return arr;
  }

  /** Weighted pick: {orc: 3, troll: 1} -> "orc" 75% of the time. */
  weighted<K extends string>(table: Record<K, number>): K {
    const keys = Object.keys(table) as K[];
    let total = 0;
    for (const k of keys) total += table[k];
    let r = this.next() * total;
    for (const k of keys) {
      r -= table[k];
      if (r <= 0) return k;
    }
    return keys[keys.length - 1]!;
  }

  /** Derive an independent stream (for per-level generation). */
  fork(salt: number): Rng {
    return new Rng((Math.imul(this.s ^ salt, 2654435761) ^ 0x9e3779b9) >>> 0);
  }
}
