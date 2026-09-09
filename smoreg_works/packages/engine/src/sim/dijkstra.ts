import { Grid, DIRS8, DIRS4, type Point } from "./grid.js";
import type { Level } from "./level.js";

export const UNREACHABLE = Infinity;

export interface DijkstraOptions {
  /** Can an actor occupy this tile at all? */
  passable(x: number, y: number): boolean;
  /** 8 = diagonals allowed (default), 4 = orthogonal only. */
  topology?: 4 | 8;
  /** Extra step cost on a tile, e.g. 4 to make monsters avoid fire. Default 0. */
  extraCost?(x: number, y: number): number;
}

/**
 * Dijkstra maps, the single most reusable structure in roguelike development —
 * Brogue runs seeking, fleeing, item hunting, auto-explore and most of its
 * monster behaviour off this one primitive.
 *
 * A map holds, for every tile, the cheapest distance to the nearest goal.
 * An actor "rolls downhill" to approach and "uphill" to retreat. Multiple maps
 * can be scaled by a desire coefficient and summed, which is how a monster can
 * want to reach the player, avoid its allies and stay near an exit at once,
 * with no behaviour tree involved.
 *
 * Sources: The Incredible Power of Dijkstra Maps (RogueBasin / Brian Walker).
 */
export class DijkstraMap {
  readonly values: Grid<number>;

  private constructor(values: Grid<number>) {
    this.values = values;
  }

  get width(): number {
    return this.values.width;
  }

  get height(): number {
    return this.values.height;
  }

  at(x: number, y: number): number {
    return this.values.get(x, y) ?? UNREACHABLE;
  }

  /**
   * Distance map from a set of goal tiles. Unit step cost plus `extraCost`.
   *
   * A goal is seeded even when `passable` rejects it. That matters more than it
   * sounds: the tile a monster stands on is not passable to anyone else, so
   * requiring passable goals made every "distance to the monsters" map come out
   * empty, and every flee behaviour silently degrade into standing still.
   * Spreading still obeys `passable`; only the seed is exempt.
   */
  static from(width: number, height: number, goals: readonly Point[], opts: DijkstraOptions): DijkstraMap {
    const values = new Grid<number>(width, height, UNREACHABLE);
    for (const g of goals) {
      if (values.inBounds(g.x, g.y)) values.set(g.x, g.y, 0);
    }
    relax(values, opts);
    return new DijkstraMap(values);
  }

  /** Wrap an already-computed grid (used by combine/flee). */
  static fromValues(values: Grid<number>): DijkstraMap {
    return new DijkstraMap(values);
  }

  /**
   * Safety map: negate and rescale the source map, then re-relax. An actor
   * rolling downhill on the result runs away *around corners* instead of into
   * the nearest dead end — the classic problem with "step away from the player".
   *
   * The 1.2 multiplier is Brogue's: >1 makes fleeing worth more than the
   * distance it costs, so a monster will accept a detour to gain safety.
   */
  fleeMap(opts: DijkstraOptions, multiplier = -1.2): DijkstraMap {
    const values = new Grid<number>(this.width, this.height, UNREACHABLE);
    this.values.forEach((x, y, v) => {
      if (v === UNREACHABLE) return;
      values.set(x, y, v * multiplier);
    });
    relax(values, opts);
    return new DijkstraMap(values);
  }

  /**
   * Weighted sum of several maps. Positive coefficient = "want to be near",
   * negative = "want to be far". Unreachable tiles stay unreachable.
   *
   * Caveat worth knowing before it costs a day of debugging: a summed map is a
   * gradient, not a guaranteed-descending field. If a repulsion coefficient
   * outweighs the attractions, the actor's own tile can become a local minimum
   * and bestStep() returns undefined — correctly, there is nowhere better
   * adjacent. Keep |repulsion| < |attraction| for "approach but avoid", and use
   * fleeMap() when an actor genuinely has to escape. Covered by tests.
   */
  static combine(parts: ReadonlyArray<{ map: DijkstraMap; weight: number }>): DijkstraMap {
    if (parts.length === 0) throw new Error("DijkstraMap.combine: no parts");
    const first = parts[0]!.map;
    const values = new Grid<number>(first.width, first.height, UNREACHABLE);
    for (let y = 0; y < first.height; y++) {
      for (let x = 0; x < first.width; x++) {
        let sum = 0;
        let ok = true;
        for (const p of parts) {
          const v = p.map.at(x, y);
          if (v === UNREACHABLE) {
            ok = false;
            break;
          }
          sum += v * p.weight;
        }
        if (ok) values.set(x, y, sum);
      }
    }
    return new DijkstraMap(values);
  }

  /**
   * The neighbouring tile with the lowest value (or highest, if `uphill`).
   * Returns undefined when standing still is already the best option, so the
   * caller can decide whether that means "wait" or "attack".
   */
  bestStep(from: Point, opts: DijkstraOptions, uphill = false): Point | undefined {
    const dirs = opts.topology === 4 ? DIRS4 : DIRS8;
    const here = this.at(from.x, from.y);
    let best: Point | undefined;
    let bestV = here;

    for (const d of dirs) {
      const nx = from.x + d.x;
      const ny = from.y + d.y;
      if (!this.values.inBounds(nx, ny)) continue;
      if (!opts.passable(nx, ny)) continue;
      const v = this.at(nx, ny);
      if (v === UNREACHABLE) continue;
      const better = uphill ? v > bestV : v < bestV;
      if (better) {
        bestV = v;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }

  /** Full path by walking downhill. Empty when the goal is unreachable. */
  pathFrom(from: Point, opts: DijkstraOptions, maxLen = 500): Point[] {
    const path: Point[] = [];
    let cur = from;
    for (let i = 0; i < maxLen; i++) {
      const step = this.bestStep(cur, opts);
      if (!step) break;
      path.push(step);
      if (this.at(step.x, step.y) === 0) break;
      cur = step;
    }
    return path;
  }

  /** Debug view: two-digit values, '##' impassable, '..' unreachable. */
  toAscii(): string[] {
    const out: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let row = "";
      for (let x = 0; x < this.width; x++) {
        const v = this.at(x, y);
        row += v === UNREACHABLE ? " .." : String(Math.round(v)).padStart(3, " ");
      }
      out.push(row);
    }
    return out;
  }
}

/**
 * Auto-explore, as one distance map: for every tile, how far to the nearest
 * walkable tile the player has never seen. `bestStep` on the result is the
 * next step of an explore run, and it costs one relaxation per step rather
 * than a frontier search plus a path.
 *
 * The goals are the unseen tiles themselves, not the seen tiles beside them.
 * That is the same thing for the first step and cheaper to state, because the
 * unseen area is passable to the spread and so the gradient keeps descending
 * once the explorer walks into it.
 *
 * Returns undefined when there is nothing left to reach — either everything
 * walkable is explored, or what remains is sealed off from `from`. The caller
 * treats both the same way: the deck is done.
 */
export function exploreMap(
  level: Level,
  from: Point,
  passable: (x: number, y: number) => boolean = (x, y) => level.isWalkable(x, y),
): DijkstraMap | undefined {
  const goals: Point[] = [];
  level.tiles.forEach((x, y) => {
    if (level.explored.get(x, y) === true) return;
    // Unlike `DijkstraMap.from`, this seeds no goal the actor cannot enter.
    // The exemption there exists so a threat map can be built from the tiles
    // monsters stand on; here it would put a zero right next to the explorer
    // and flatten the gradient it is supposed to descend — one blocked tile
    // beside the drone and auto-explore stands still with work left to do.
    if (!level.isWalkable(x, y) || !passable(x, y)) return;
    goals.push({ x, y });
  });
  if (goals.length === 0) return undefined;

  const map = DijkstraMap.from(level.width, level.height, goals, { passable });
  return map.at(from.x, from.y) === UNREACHABLE ? undefined : map;
}

/**
 * Relaxation by binary heap.
 *
 * The textbook Brogue formulation sweeps the whole grid until nothing changes.
 * That is fine for one map per turn and far too slow for one map per monster
 * per turn: on a 70x34 level with 15 actors it blew a 5s test budget. A heap
 * gives the same values in O(N log N), and — unlike a plain BFS — it still
 * handles the arbitrary, negative starting values a flee map begins with,
 * because every edge cost is positive.
 */
function relax(values: Grid<number>, opts: DijkstraOptions): void {
  const dirs = opts.topology === 4 ? DIRS4 : DIRS8;
  const extra = opts.extraCost;
  const heap = new MinHeap(values.width * values.height);

  values.forEach((x, y, v) => {
    if (v !== UNREACHABLE) heap.push(v, x, y);
  });

  while (heap.size > 0) {
    const node = heap.pop()!;
    // Stale entry: a cheaper route to this tile was already settled.
    if (node.value > values.at(node.x, node.y)) continue;

    const cost = 1 + (extra ? extra(node.x, node.y) : 0);
    for (const d of dirs) {
      const nx = node.x + d.x;
      const ny = node.y + d.y;
      if (!values.inBounds(nx, ny)) continue;
      if (!opts.passable(nx, ny)) continue;
      const candidate = node.value + cost;
      if (candidate < values.at(nx, ny)) {
        values.set(nx, ny, candidate);
        heap.push(candidate, nx, ny);
      }
    }
  }
}

/** Flat binary min-heap over (value, x, y). Avoids allocating a node per push. */
class MinHeap {
  private vals: Float64Array;
  private xs: Int32Array;
  private ys: Int32Array;
  size = 0;

  constructor(capacity: number) {
    const cap = Math.max(16, capacity);
    this.vals = new Float64Array(cap);
    this.xs = new Int32Array(cap);
    this.ys = new Int32Array(cap);
  }

  push(value: number, x: number, y: number): void {
    if (this.size === this.vals.length) this.grow();
    let i = this.size++;
    this.vals[i] = value;
    this.xs[i] = x;
    this.ys[i] = y;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.vals[parent]! <= this.vals[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { value: number; x: number; y: number } | undefined {
    if (this.size === 0) return undefined;
    const top = { value: this.vals[0]!, x: this.xs[0]!, y: this.ys[0]! };
    this.size--;
    if (this.size > 0) {
      this.vals[0] = this.vals[this.size]!;
      this.xs[0] = this.xs[this.size]!;
      this.ys[0] = this.ys[this.size]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.size && this.vals[l]! < this.vals[smallest]!) smallest = l;
        if (r < this.size && this.vals[r]! < this.vals[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const v = this.vals[a]!; this.vals[a] = this.vals[b]!; this.vals[b] = v;
    const x = this.xs[a]!; this.xs[a] = this.xs[b]!; this.xs[b] = x;
    const y = this.ys[a]!; this.ys[a] = this.ys[b]!; this.ys[b] = y;
  }

  private grow(): void {
    const cap = this.vals.length * 2;
    const vals = new Float64Array(cap); vals.set(this.vals); this.vals = vals;
    const xs = new Int32Array(cap); xs.set(this.xs); this.xs = xs;
    const ys = new Int32Array(cap); ys.set(this.ys); this.ys = ys;
  }
}
