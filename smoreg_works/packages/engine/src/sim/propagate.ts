import { Grid, DIRS8, type Point } from "./grid.js";

export interface PropagateOptions {
  /** Can the quantity spread into this tile? Walls usually block sound too. */
  passable(x: number, y: number): boolean;
  /** How much is lost per step. 1 = one unit per tile. */
  falloff?: number;
  /** Extra loss on a tile, e.g. a closed door muffling sound. */
  extraFalloff?(x: number, y: number): number;
}

/**
 * Spread a quantity outward from sources, losing strength with distance.
 * One primitive, several classic uses:
 *   - noise: monsters hear the player's fight two rooms away
 *   - scent: a hound tracks where the player went, not where they are
 *   - heat / gas / light intensity
 *
 * Values are "remaining strength", so 0 means "nothing arrived here" and the
 * result reads directly as a monster's hearing check.
 */
export function propagate(
  width: number,
  height: number,
  sources: ReadonlyArray<{ pos: Point; strength: number }>,
  opts: PropagateOptions,
): Grid<number> {
  const values = new Grid<number>(width, height, 0);
  const falloff = opts.falloff ?? 1;
  // Highest-strength-first: a tile is finalised the first time it is reached,
  // so a loud source is never overwritten by a quiet one behind it.
  const queue = [...sources]
    .filter((s) => opts.passable(s.pos.x, s.pos.y))
    .sort((a, b) => b.strength - a.strength)
    .map((s) => ({ ...s.pos, strength: s.strength }));

  for (const s of queue) {
    if (s.strength > (values.get(s.x, s.y) ?? 0)) values.set(s.x, s.y, s.strength);
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const here = values.at(cur.x, cur.y);
    if (here <= 0) continue;

    for (const d of DIRS8) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!values.inBounds(nx, ny)) continue;
      if (!opts.passable(nx, ny)) continue;
      const loss = falloff + (opts.extraFalloff ? opts.extraFalloff(nx, ny) : 0);
      const next = here - loss;
      if (next <= 0) continue;
      if (next <= values.at(nx, ny)) continue;
      values.set(nx, ny, next);
      queue.push({ x: nx, y: ny, strength: next });
    }
  }

  return values;
}

/**
 * Decay a persistent field in place — a scent trail that fades, a fire that
 * burns out. Call once per turn.
 */
export function decay(field: Grid<number>, amount = 1): void {
  field.forEach((x, y, v) => {
    if (v > 0) field.set(x, y, Math.max(0, v - amount));
  });
}

/** Add a stamp of strength at a point, keeping the maximum. */
export function reinforce(field: Grid<number>, at: Point, strength: number): void {
  const cur = field.get(at.x, at.y) ?? 0;
  if (strength > cur) field.set(at.x, at.y, strength);
}

/** The loudest tile within a radius, for "walk towards the noise" behaviour. */
export function loudestNear(field: Grid<number>, from: Point, radius: number): Point | undefined {
  let best: Point | undefined;
  let bestV = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = from.x + dx;
      const y = from.y + dy;
      const v = field.get(x, y);
      if (v === undefined || v <= bestV) continue;
      bestV = v;
      best = { x, y };
    }
  }
  return best;
}
