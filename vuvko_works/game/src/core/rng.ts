/**
 * Counter-based randomness.
 *
 * A sequential generator would have to live outside the state, which breaks
 * replay: you could not resume a match from a command list without also
 * restoring the generator's internals. Here a draw is a pure function of the
 * seed and a cursor that the state carries, so `applyCommand` stays pure and
 * a saved `{ seed, commands }` pair reproduces a match exactly.
 */

export interface RngState {
  readonly seed: number;
  readonly cursor: number;
}

export function seedFromString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed: string | number): RngState {
  const numeric = typeof seed === "number" ? seed >>> 0 : seedFromString(seed);
  return { seed: numeric, cursor: 0 };
}

/** splitmix32, mixing the cursor in so draws are addressable rather than sequential. */
function mix(seed: number, cursor: number): number {
  let z = (seed + Math.imul(cursor + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z / 4294967296;
}

/** A draw in [0, 1) and the state that follows it. Never reuse the state you passed in. */
export function nextFloat(rng: RngState): [number, RngState] {
  return [mix(rng.seed, rng.cursor), { seed: rng.seed, cursor: rng.cursor + 1 }];
}

/** An integer in [0, bound). */
export function nextInt(rng: RngState, bound: number): [number, RngState] {
  const [value, next] = nextFloat(rng);
  return [Math.floor(value * bound), next];
}

export function pickOne<T>(rng: RngState, items: readonly T[]): [T | null, RngState] {
  if (items.length === 0) return [null, rng];
  const [index, next] = nextInt(rng, items.length);
  return [items[index] ?? null, next];
}

/** True with the given probability. */
export function chance(rng: RngState, probability: number): [boolean, RngState] {
  const [value, next] = nextFloat(rng);
  return [value < probability, next];
}
