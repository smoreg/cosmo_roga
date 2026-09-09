import type { Door, RoomId, Ship } from "./graph.js";

/** No route. Same sentinel as `sim/dijkstra.ts`, kept unexported to avoid a clash. */
const UNREACHABLE = Infinity;

export type DoorFilter = (d: Door) => boolean;

/**
 * Dijkstra maps over rooms — the graph twin of `sim/dijkstra.ts`, and the same
 * primitive it is built on: one map holds, for every room, the distance in
 * doors to the nearest goal. A machine rolls downhill to approach, uphill (or
 * over a flee map) to retreat, and several maps scaled by desire coefficients
 * sum into one field, which is how a behaviour profile stays four numbers
 * instead of a state machine.
 *
 * The grid version needs a binary heap because a level is 70x34 tiles; a ship
 * is twenty-odd rooms, so the frontier here is a linear scan. Same values, a
 * quarter of the code, and it still copes with the arbitrary negative values a
 * flee map starts from, because every edge costs 1.
 */
export class RoomDistance {
  readonly ship: Ship;
  private readonly values: number[];

  private constructor(ship: Ship, values: number[]) {
    this.ship = ship;
    this.values = values;
  }

  /**
   * Distance map from a set of goal rooms.
   *
   * Goals are seeded whether or not anything can be walked through to reach
   * them: the map "how far to the machines" has to be built from the rooms the
   * machines stand in, even when every door to them is welded shut.
   */
  static from(ship: Ship, goals: readonly RoomId[], passable: DoorFilter): RoomDistance {
    const values = new Array<number>(ship.size).fill(UNREACHABLE);
    for (const g of goals) {
      if (values[g] !== undefined) values[g] = 0;
    }
    relax(ship, values, passable);
    return new RoomDistance(ship, values);
  }

  /** Wrap already-computed values (used by flee/combine). */
  private static wrap(ship: Ship, values: number[]): RoomDistance {
    return new RoomDistance(ship, values);
  }

  at(r: RoomId): number {
    return this.values[r] ?? UNREACHABLE;
  }

  /**
   * The door to step through to get closer: the neighbour with the lowest
   * value, ties broken by the lower door id so a replay never depends on the
   * order rooms happened to be built in.
   *
   * Undefined means standing still is already the best move — the caller
   * decides whether that is "wait" or "attack what is here".
   */
  nextDoor(from: RoomId, passable: DoorFilter): Door | undefined {
    let best: Door | undefined;
    let bestV = this.at(from);

    for (const d of this.ship.doorsOf(from)) {
      if (!passable(d)) continue;
      const to = this.ship.other(d, from);
      if (to === from) continue; // the airlock's self-edge
      const v = this.at(to);
      if (v < bestV || (best !== undefined && v === bestV && d.id < best.id)) {
        bestV = v;
        best = d;
      }
    }
    return best;
  }

  /**
   * Safety map: negate, rescale, rescan. Rolling downhill on the result runs
   * away *around the ship* instead of into the nearest dead end. The 1.2 is
   * Brogue's — above 1, so a detour that gains distance is worth its cost.
   */
  flee(passable: DoorFilter, multiplier = -1.2): RoomDistance {
    const values = this.values.map((v) => (v === UNREACHABLE ? UNREACHABLE : v * multiplier));
    relax(this.ship, values, passable);
    return RoomDistance.wrap(this.ship, values);
  }

  /**
   * Weighted sum. Positive weight = "want to be near", negative = "want to be
   * far", unreachable stays unreachable. The same caveat as on the grid: a sum
   * is a gradient, not a guaranteed descent, so keep |repulsion| below
   * |attraction| and use `flee` when something genuinely has to escape.
   */
  static combine(parts: ReadonlyArray<{ map: RoomDistance; weight: number }>): RoomDistance {
    if (parts.length === 0) throw new Error("RoomDistance.combine: no parts");
    const ship = parts[0]!.map.ship;
    const values = new Array<number>(ship.size).fill(UNREACHABLE);

    for (let r = 0; r < ship.size; r++) {
      let sum = 0;
      let ok = true;
      for (const p of parts) {
        const v = p.map.at(r);
        if (v === UNREACHABLE) {
          ok = false;
          break;
        }
        sum += v * p.weight;
      }
      if (ok) values[r] = sum;
    }
    return RoomDistance.wrap(ship, values);
  }

  /** Debug view: "r1:0 r2:1 r3:.". For eyeballing a failing test. */
  toText(): string {
    return this.ship.rooms
      .map((r) => `${r.label}:${this.at(r.id) === UNREACHABLE ? "." : Math.round(this.at(r.id))}`)
      .join(" ");
  }
}

/**
 * Settle by repeatedly taking the cheapest unsettled room. O(rooms^2) with a
 * linear scan, which on a twenty-room ship is smaller than the heap that would
 * replace it.
 */
function relax(ship: Ship, values: number[], passable: DoorFilter): void {
  const settled = new Array<boolean>(ship.size).fill(false);

  for (;;) {
    let cur = -1;
    let curV = UNREACHABLE;
    for (let r = 0; r < values.length; r++) {
      if (!settled[r] && values[r]! < curV) {
        curV = values[r]!;
        cur = r;
      }
    }
    if (cur < 0) break;
    settled[cur] = true;

    for (const d of ship.doorsOf(cur)) {
      if (!passable(d)) continue;
      const to = ship.other(d, cur);
      const candidate = curV + 1;
      if (candidate < values[to]!) values[to] = candidate;
    }
  }
}

/**
 * Auto-explore as one distance map: goals are the rooms never stood in, so the
 * door this returns is the next step of an explore run. Undefined when there
 * is nothing left — either the ship is explored, or what remains is behind a
 * door this walker cannot open, and the caller treats both the same way.
 */
export function exploreTarget(ship: Ship, from: RoomId, passable: DoorFilter): Door | undefined {
  const goals = ship.rooms.filter((r) => !r.explored).map((r) => r.id);
  if (goals.length === 0) return undefined;
  const map = RoomDistance.from(ship, goals, passable);
  if (map.at(from) === UNREACHABLE) return undefined;
  return map.nextDoor(from, passable);
}

/**
 * The doors that alone stand between `from` and something unexplored: the shut
 * ones on the frontier of where a plain walk can go, with unexplored ship
 * behind them. Empty while auto-explore still has work it can reach, so a UI
 * can say `Everything left is behind d3.` instead of stopping in silence.
 *
 * Passability here is the plain walking rule — no breaching, no airlock, since
 * leaving the ship is not exploring it.
 */
export function blockedBy(ship: Ship, from: RoomId): Door[] {
  const walk = (d: Door): boolean => ship.passable(d, {});
  const reached = reachable(ship, from, walk);
  if (ship.rooms.some((r) => !r.explored && reached.has(r.id))) return [];

  const out: Door[] = [];
  for (const d of ship.doors) {
    if (walk(d)) continue;
    const inside = reached.has(d.a) ? d.a : reached.has(d.b) ? d.b : undefined;
    if (inside === undefined) continue;
    const beyond = ship.other(d, inside);
    if (beyond === inside) continue; // the airlock leads out, not on
    if (reached.has(beyond)) continue; // some other route already covers it
    const behind = reachable(ship, beyond, walk);
    if ([...behind].some((r) => !ship.roomAt(r).explored)) out.push(d);
  }
  return out;
}

function reachable(ship: Ship, from: RoomId, passable: DoorFilter): Set<RoomId> {
  const seen = new Set<RoomId>([from]);
  const queue: RoomId[] = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const d of ship.doorsOf(queue[head]!)) {
      if (!passable(d)) continue;
      const to = ship.other(d, queue[head]!);
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}
