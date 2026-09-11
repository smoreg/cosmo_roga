import { chance, nextFloat } from "../rng";
import type { RngState } from "../rng";
import { LOOP_SHARE, PX_FT } from "./types";
import type { Contact, MapDoor, MapWall, MapZone, Stub } from "./types";

function pairKey(a: number, b: number): string {
  return a < b ? `${String(a)}:${String(b)}` : `${String(b)}:${String(a)}`;
}

/**
 * A door is a wall with a way through, so it is one of the edges the lattice
 * already has. The artwork says which rooms connect and roughly where; the
 * lattice says which edge that is.
 *
 * Not every shared wall becomes a door — a deck where they all did would say
 * nothing about where you can go — so a spanning tree is kept, which makes the
 * ship walkable, plus a share of the rest for loops.
 */
export function pickDoors(
  contacts: readonly Contact[],
  zoneOf: ReadonlyMap<number, number>,
  zones: readonly MapZone[],
  walls: readonly MapWall[],
  stubs: readonly Stub[],
  rng: RngState,
): [MapDoor[], RngState] {
  const byPair = new Map<string, MapWall[]>();
  for (const wall of walls) {
    if (wall.hull || wall.b === null) continue;
    const key = pairKey(wall.a.zone, wall.b.zone);
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [wall]);
    else list.push(wall);
  }

  /* What the artwork says connects to what. A room too small to own a hexagon
     is absorbed into one, and its connections have to come with it: a corridor
     five feet wide still lets you through, and dropping it would seal the
     rooms it served. So the contact graph is walked through absorbed rooms. */
  const contact = new Map<number, Map<number, number>>();
  for (const zone of zones) contact.set(zone.id, new Map());
  for (const entry of contacts) {
    const a = zoneOf.get(entry.a);
    const b = zoneOf.get(entry.b);
    if (a === undefined || b === undefined || a === b) continue;
    const fromA = contact.get(a);
    const fromB = contact.get(b);
    if (fromA === undefined || fromB === undefined) continue;
    fromA.set(b, Math.max(fromA.get(b) ?? 0, entry.n));
    fromB.set(a, Math.max(fromB.get(a) ?? 0, entry.n));
  }

  function absorbed(id: number): boolean {
    return (zones[id]?.cells.length ?? 0) === 0;
  }

  const joined = new Map<string, number>();
  for (const zone of zones) {
    if (absorbed(zone.id)) continue;
    const seen = new Set<number>([zone.id]);
    const queue: [number, number][] = [[zone.id, Infinity]];
    while (queue.length > 0) {
      const step = queue.shift();
      if (step === undefined) break;
      const [at, via] = step;
      for (const [next, n] of contact.get(at) ?? []) {
        if (seen.has(next)) continue;
        const strength = Math.min(via, n);
        seen.add(next);
        if (absorbed(next)) {
          queue.push([next, strength]);
          continue;
        }
        const key = pairKey(zone.id, next);
        joined.set(key, Math.max(joined.get(key) ?? 0, strength));
      }
    }
  }

  interface Candidate {
    readonly a: number;
    readonly b: number;
    readonly n: number;
    readonly wall: MapWall;
  }

  /* Each connection lands on the wall between the two rooms nearest where the
     artwork drew it. */
  const edges: Candidate[] = [];
  for (const [key, n] of joined) {
    const parts = key.split(":");
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    const options = byPair.get(key);
    if (options === undefined || options.length === 0) continue;

    const near = contacts.find(function between(entry) {
      const ca = zoneOf.get(entry.a);
      const cb = zoneOf.get(entry.b);
      return (ca === a && cb === b) || (ca === b && cb === a);
    });

    let best = options[0];
    if (best === undefined) continue;
    if (near !== undefined) {
      const x = near.x / PX_FT;
      const y = near.y / PX_FT;
      let closest = Infinity;
      for (const wall of options) {
        const distance = Math.hypot(wall.mx - x, wall.my - y);
        if (distance < closest) {
          closest = distance;
          best = wall;
        }
      }
    }
    edges.push({ a, b, n, wall: best });
  }

  /* A stub is not a candidate — it is where the tile was drawn to open. */
  const fixed: Candidate[] = [];
  const claimed = new Set<MapWall>();
  for (const stub of stubs) {
    const options = byPair.get(pairKey(stub.a, stub.b));
    if (options === undefined) continue;
    let best: MapWall | null = null;
    let closest = Infinity;
    for (const wall of options) {
      if (claimed.has(wall)) continue;
      const distance = Math.hypot(wall.mx - stub.x, wall.my - stub.y);
      if (distance < closest) {
        closest = distance;
        best = wall;
      }
    }
    if (best === null) continue;
    claimed.add(best);
    fixed.push({ a: stub.a, b: stub.b, n: Infinity, wall: best });
  }

  edges.sort(function strongestFirst(p, q) {
    return q.n - p.n;
  });

  const parent = zones.map(function self(_zone, index) {
    return index;
  });
  function find(index: number): number {
    let at = index;
    while ((parent[at] ?? at) !== at) at = parent[at] ?? at;
    let walk = index;
    while ((parent[walk] ?? walk) !== walk) {
      const next = parent[walk] ?? walk;
      parent[walk] = at;
      walk = next;
    }
    return at;
  }

  const doors: MapDoor[] = [];
  const usedWalls = new Set<MapWall>();
  function take(candidate: Candidate, tree: boolean): void {
    usedWalls.add(candidate.wall);
    doors.push({
      a: candidate.a,
      b: candidate.b,
      wall: candidate.wall,
      tree,
      id: -1,
      state: "open",
    });
  }

  for (const edge of fixed) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra !== rb) parent[ra] = rb;
    take(edge, true);
  }
  for (const edge of edges) {
    if (usedWalls.has(edge.wall)) continue;
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra !== rb) {
      parent[ra] = rb;
      take(edge, true);
    }
  }

  let current = rng;
  for (const edge of edges) {
    if (usedWalls.has(edge.wall)) continue;
    const already = doors.some(function samePair(door) {
      return door.a === edge.a && door.b === edge.b;
    });
    const [roll, afterRoll] = nextFloat(current);
    current = afterRoll;
    if (already && roll >= LOOP_SHARE) continue;
    const [keep, afterKeep] = chance(current, LOOP_SHARE);
    current = afterKeep;
    if (keep) take(edge, false);
  }

  for (let i = 0; i < doors.length; i++) {
    const door = doors[i];
    if (door === undefined) continue;
    door.id = i;
    door.wall.door = door;
    const [shut, afterShut] = nextFloat(current);
    current = afterShut;
    const [locked, afterLocked] = nextFloat(current);
    current = afterLocked;
    if (door.tree) {
      door.state = shut < 0.12 ? "closed" : "open";
    } else {
      door.state = locked < 0.25 ? "locked" : shut < 0.5 ? "closed" : "open";
    }
  }

  return [doors, current];
}
