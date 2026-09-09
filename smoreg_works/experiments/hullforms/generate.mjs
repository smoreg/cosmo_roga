/**
 * Lay compartments inside a hull silhouette.
 *
 * A pure function of `(silhouette, seed)`: same pair, same deck, every time.
 * The only source of chance is `mulberry32(seed)`, drawn in a fixed order.
 *
 * The idea in one line: **the hull is tiled, not filled**. Every cell of the
 * mask belongs to exactly one compartment, so the outer edge of the outermost
 * compartments *is* the silhouette — the shape is read off the rooms rather
 * than drawn behind them. Nothing sticks out, nothing is left as a hole the
 * reader has to interpret.
 *
 * Four steps:
 *
 *  1. classify every cell — rim (touches vacuum), keel (`*`), airlock (`@`) or
 *     core;
 *  2. grow compartments of one to three cells over the whole mask, rim
 *     compartments preferring to grow *along* the rim so the plating stays a
 *     legible chain of small rooms rather than one fat blob eating the nose;
 *  3. join every pair of compartments that share a wall into a candidate door;
 *  4. keep a spanning tree of those candidates plus a share of the rest, so the
 *     hull is connected and still has loops, and most shared walls stay walls.
 *
 * Step 4 is where the topology becomes readable: if every shared wall were a
 * door, a deck of twenty compartments would have fifty of them and the plan
 * would say nothing about where you can go.
 */

import { hexAdjacent, hexAround, hexKey, mulberry32, offsetToAxial, HEX_DIRS } from "./hexgrid.mjs";
import { parseMask } from "./silhouettes.mjs";

/** Doors on one compartment, matching the engine's `MAX_DEGREE`. */
export const MAX_DOORS = 4;

/** Share of the shared walls left over after the tree that become doors. */
export const LOOP_SHARE = 0.45;

/** Cells in one compartment. Three is a hold; one is a locker. */
const MAX_CELLS = 3;

export function generateDeck(silhouette, seed) {
  return deckFromCells(layCells(silhouette), seed, silhouette);
}

/**
 * The same generator, given the cells directly instead of a mask.
 *
 * `shipform.mjs` draws a hull first and then drops hexagons into it, so its
 * cells are whatever fell inside the shape — no mask, and holes wherever a
 * hexagon did not fit. Everything downstream is unchanged: compartments grow,
 * shared walls become candidates, doors are chosen.
 */
export function deckFromCells(cells, seed, silhouette = { id: "cells", name: "", note: "", mask: "" }) {
  const rng = mulberry32(seed);
  const byKey = new Map(cells.map((c) => [hexKey(c), c]));

  for (const cell of cells) {
    cell.rim = hexAround(cell).some((n) => !byKey.has(hexKey(n)));
    cell.weight = rng();
  }

  const compartments = growCompartments(cells, byKey, rng);
  const walls = sharedWalls(compartments, byKey);
  const doors = pickDoors(compartments, walls, rng);
  return finish(silhouette, seed, compartments, walls, doors, cells);
}

/** Mask characters to lattice cells. */
function layCells(silhouette) {
  return parseMask(silhouette.mask).map(({ row, col, ch }) => {
    const { q, r } = offsetToAxial(row, col);
    return { q, r, ch, keel: ch === "*", airlock: ch === "@", comp: -1, rim: false, weight: 0 };
  });
}

/**
 * Seed compartments and grow them.
 *
 * Seeding order decides the look of the deck. The airlock goes first so it is
 * always a compartment of its own; then the rim, so the plating is carved into
 * small rooms before anything inside can reach out and swallow a piece of it;
 * then the keel; then whatever is left. Within a class the order is the cell's
 * own random weight, which is why two seeds of the same hull are different
 * ships and not the same ship shifted.
 */
function growCompartments(cells, byKey, rng) {
  const rank = (c) => (c.airlock ? 0 : c.rim ? 1 : c.keel ? 2 : 3);
  const order = [...cells].sort((a, b) => rank(a) - rank(b) || a.weight - b.weight);

  const comps = [];
  for (const seed of order) {
    if (seed.comp >= 0) continue;
    const comp = { id: comps.length, cells: [seed], airlock: seed.airlock, keel: seed.keel };
    seed.comp = comp.id;
    comps.push(comp);
    // The airlock stays a single cell: it is the one room the player must be
    // able to find on the picture without counting walls.
    const target = seed.airlock ? 1 : 1 + Math.floor(rng() * MAX_CELLS);
    while (comp.cells.length < target) {
      const next = bestNeighbour(comp, seed, byKey);
      if (next === undefined) break;
      next.comp = comp.id;
      comp.cells.push(next);
    }
  }

  absorbStrays(comps, byKey);
  return comps.filter((c) => c.cells.length > 0).map((c, i) => ({ ...c, id: i, ...reindex(c, i) }));
}

/**
 * The free cell this compartment should take next.
 *
 * Two preferences, in order: stay in the same class as the seed — a rim
 * compartment grows along the rim, a keel compartment along the keel — and then
 * prefer the cell with the fewest free neighbours of its own, which fills
 * pockets before they become one-cell leftovers wedged between three rooms.
 */
function bestNeighbour(comp, seed, byKey) {
  let best;
  let bestScore = -Infinity;
  for (const cell of comp.cells) {
    for (const n of hexAround(cell)) {
      const cand = byKey.get(hexKey(n));
      if (cand === undefined || cand.comp >= 0 || cand.airlock) continue;
      const free = hexAround(cand).filter((x) => {
        const c = byKey.get(hexKey(x));
        return c !== undefined && c.comp < 0;
      }).length;
      const sameClass = cand.rim === seed.rim && cand.keel === seed.keel ? 4 : 0;
      const score = sameClass - free + cand.weight;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
  }
  return best;
}

/**
 * Fold one-cell compartments into a small neighbour.
 *
 * Growth leaves a scatter of single cells in the crevices, and a deck that is
 * half lockers reads as gravel rather than as a ship. Only merges that stay
 * under `MAX_CELLS` are taken, so the fold cannot undo the tiling, and the
 * airlock is never folded away.
 */
function absorbStrays(comps, byKey) {
  for (const comp of comps) {
    if (comp.cells.length !== 1 || comp.airlock) continue;
    const cell = comp.cells[0];
    let host;
    for (const n of hexAround(cell)) {
      const far = byKey.get(hexKey(n));
      if (far === undefined || far.comp === comp.id) continue;
      const other = comps[far.comp];
      if (other.airlock || other.cells.length + 1 > MAX_CELLS) continue;
      if (host === undefined || other.cells.length < host.cells.length) host = other;
    }
    if (host === undefined) continue;
    cell.comp = host.id;
    host.cells.push(cell);
    comp.cells = [];
  }
}

/** Point the cells at the compartment's new index after the empties are dropped. */
function reindex(comp, id) {
  for (const cell of comp.cells) cell.comp = id;
  return {};
}

/**
 * Every pair of compartments that share at least one hex wall, with the walls
 * they share. A door can only ever be one of these walls — the rule the engine
 * calls "дверь только между касающимися сотами".
 */
function sharedWalls(comps, byKey) {
  const pairs = new Map();
  for (const comp of comps) {
    for (const cell of comp.cells) {
      HEX_DIRS.forEach((d, dir) => {
        const far = byKey.get(hexKey({ q: cell.q + d.q, r: cell.r + d.r }));
        if (far === undefined || far.comp === comp.id) return;
        const a = Math.min(comp.id, far.comp);
        const b = Math.max(comp.id, far.comp);
        const id = `${a}-${b}`;
        let pair = pairs.get(id);
        if (pair === undefined) {
          pair = { id, a, b, walls: [] };
          pairs.set(id, pair);
        }
        if (comp.id === a) pair.walls.push({ cell, dir });
      });
    }
  }
  return [...pairs.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

/**
 * Choose which shared walls become doors.
 *
 * Breadth-first from the airlock, not cheapest-edge growth. Prim on random
 * weights is a *maze* algorithm: it was giving a twenty-room hull a depth of
 * eleven, one winding passage with no way round, which is the very complaint
 * the engine's loop share exists to answer («не получается мансить от охраны»).
 * Breadth-first keeps the deck as shallow as its shape allows, and a room's
 * depth then means what it looks like it means — how far in from the airlock
 * it is.
 *
 * Then a share of the leftover walls become loop doors, each on its own roll,
 * subject to the four-door cap. The cap is honoured for loop doors and
 * *broken* for tree doors when a compartment can be reached no other way: an
 * unreachable room would be a worse lie than a fifth door, and the metric
 * reports it instead of hiding it.
 */
function pickDoors(comps, walls, rng) {
  for (const w of walls) {
    w.weight = rng();
    w.loop = rng();
  }
  const degree = new Array(comps.length).fill(0);
  const doors = [];
  const used = new Set();
  const near = comps.map(() => []);
  for (const w of walls) {
    near[w.a].push(w);
    near[w.b].push(w);
  }

  const start = Math.max(0, comps.findIndex((c) => c.airlock));
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const w of [...near[at]].sort((x, y) => x.weight - y.weight)) {
      const far = w.a === at ? w.b : w.a;
      if (seen.has(far)) continue;
      if (degree[at] >= MAX_DOORS || degree[far] >= MAX_DOORS) continue;
      take(w);
      used.add(w.id);
      seen.add(far);
      queue.push(far);
    }
  }

  // Anything the cap fenced off gets its door anyway, and is counted. Repeated
  // until it stops helping: one pass reaches only the compartments next to the
  // fence, and behind a walled-off room there can be a whole wing.
  for (let pass = 0; pass < comps.length; pass++) {
    let joined = false;
    for (const w of walls) {
      if (used.has(w.id)) continue;
      if (seen.has(w.a) === seen.has(w.b)) continue;
      take(w);
      used.add(w.id);
      seen.add(w.a);
      seen.add(w.b);
      joined = true;
    }
    if (!joined) break;
  }

  for (const w of walls) {
    if (used.has(w.id)) continue;
    if (degree[w.a] >= MAX_DOORS || degree[w.b] >= MAX_DOORS) continue;
    if (w.loop > LOOP_SHARE) continue;
    take(w);
  }

  return doors;

  function take(w) {
    // Which of the shared walls carries the door: the rng picks, so a pair of
    // compartments meeting along three cells does not always open at the same
    // end of the seam.
    const wall = w.walls[Math.floor(w.weight * w.walls.length) % w.walls.length];
    degree[w.a]++;
    degree[w.b]++;
    doors.push({ a: w.a, b: w.b, wall, pair: w.id });
  }
}

/** Metrics, and the shape the renderer wants. */
function finish(silhouette, seed, comps, walls, doors, cells) {
  const degree = new Array(comps.length).fill(0);
  const adj = comps.map(() => []);
  for (const d of doors) {
    degree[d.a]++;
    degree[d.b]++;
    adj[d.a].push(d.b);
    adj[d.b].push(d.a);
  }

  const start = Math.max(
    0,
    comps.findIndex((c) => c.airlock),
  );
  const depth = new Array(comps.length).fill(-1);
  depth[start] = 0;
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const far of adj[at]) {
      if (depth[far] >= 0) continue;
      depth[far] = depth[at] + 1;
      queue.push(far);
    }
  }

  const perDepth = new Map();
  for (const d of depth) perDepth.set(d, (perDepth.get(d) ?? 0) + 1);

  return {
    silhouette,
    seed,
    cells,
    compartments: comps.map((c, i) => ({ ...c, depth: depth[i], doors: degree[i] })),
    walls,
    doors,
    metrics: {
      cells: cells.length,
      rooms: comps.length,
      doorCount: doors.length,
      wallCount: walls.length,
      maxDoors: Math.max(...degree, 0),
      overDoorCap: degree.filter((d) => d > MAX_DOORS).length,
      maxDepth: Math.max(...depth),
      widestDepth: Math.max(...[...perDepth.values()]),
      unreachable: depth.filter((d) => d < 0).length,
      loops: doors.length - (comps.length - 1),
    },
  };
}

/** Sanity checks a deck must pass. Used by `check.mjs`, not by the renderer. */
export function faults(deck) {
  const out = [];
  const { metrics } = deck;
  if (metrics.unreachable > 0) out.push(`${metrics.unreachable} отсеков не достижимы от шлюза`);
  if (!deck.compartments.some((c) => c.airlock)) out.push("нет шлюза");
  const covered = new Set();
  for (const comp of deck.compartments) for (const cell of comp.cells) covered.add(hexKey(cell));
  if (covered.size !== deck.cells.length) out.push("не все клетки маски накрыты отсеками");
  for (const door of deck.doors) {
    const a = deck.compartments[door.a];
    const b = deck.compartments[door.b];
    const touch = a.cells.some((x) => b.cells.some((y) => hexAdjacent(x, y)));
    if (!touch) out.push(`дверь ${door.a}-${door.b} между отсеками, которые не касаются`);
  }
  return out;
}
