/**
 * Making a compartment graph look like a ship.
 *
 * `hexLayout` grows the honeycomb along the ship's spanning tree, which is the
 * right way to lay out a *graph*: every compartment gets a cell and every cell
 * is next to its parent. What it is not is a hull. A tree grown greedily comes
 * out as a blob — long on one side, short on the other — and a blob does not
 * read as a thing that was built, because the first fact anyone knows about a
 * ship is that it is the same on both sides of its keel.
 *
 * So the picture is made symmetric without the graph being touched. Every
 * occupied cell has an opposite number across the keel; where that opposite is
 * empty, a **wrecked** compartment is drawn there — a section of hull that is
 * still part of the ship and no longer part of anywhere you can go.
 *
 * That is a view decision and it stays in the view. Nothing here is passed to
 * the engine, nothing here can be walked into, and a run replays identically
 * with the wreckage drawn or not: `(seed, inputs)` never mentions it.
 *
 * ## The identity
 *
 * Rows run along the ship and stack across the beam, so `q` is length and `r`
 * is beam. A cell's place along the ship is `q + r/2`, so reflecting row `k+d`
 * into row `k-d` needs `q' = q + d` — an integer, always. No rounding, no
 * parity rule, and no column squared off to make the arithmetic come out.
 */

export interface Cell {
  q: number;
  r: number;
}

const key = (c: Cell): string => `${String(c.q)},${String(c.r)}`;

/** The cell opposite this one, across the keel at row `k`. */
export function mirror(cell: Cell, k: number): Cell {
  return { q: cell.q + (cell.r - k), r: 2 * k - cell.r };
}

/**
 * Which row to call the keel.
 *
 * The one that needs the least made up. A hull is judged by how much of it
 * looks deliberate, and the keel that leaves the fewest holes is the one the
 * ship was most nearly built around already — so the wreckage reads as damage
 * rather than as scaffolding holding a bad guess together.
 *
 * Ties go to the row nearest the middle, because a keel down the edge of the
 * ship is a keel in name only.
 */
export function keelOf(cells: Iterable<Cell>): number {
  const all = [...cells];
  if (all.length === 0) return 0;
  const taken = new Set(all.map(key));
  const rows = [...new Set(all.map((c) => c.r))].sort((a, b) => a - b);
  const middle = (rows[0] as number) + ((rows[rows.length - 1] as number) - (rows[0] as number)) / 2;

  let best = rows[0] as number;
  let bestCost = Infinity;
  let bestOff = Infinity;
  for (const k of rows) {
    let cost = 0;
    for (const cell of all) if (!taken.has(key(mirror(cell, k)))) cost++;
    const off = Math.abs(k - middle);
    if (cost < bestCost || (cost === bestCost && off < bestOff)) {
      best = k;
      bestCost = cost;
      bestOff = off;
    }
  }
  return best;
}

/**
 * The cells a hull needs to be symmetric about its keel, and does not have.
 *
 * Returned in a stable order — along the ship, then across it — so the same
 * ship always produces the same wreckage in the same places. A picture that
 * reshuffled its own hull between two frames of the same turn would be worse
 * than an asymmetric one.
 */
export function wreckage(cells: Iterable<Cell>, keel: number): Cell[] {
  const all = [...cells];
  const taken = new Set(all.map(key));
  const out = new Map<string, Cell>();
  for (const cell of all) {
    const twin = mirror(cell, keel);
    const id = key(twin);
    if (taken.has(id) || out.has(id)) continue;
    out.set(id, twin);
  }
  return [...out.values()].sort((a, b) => a.q + a.r / 2 - (b.q + b.r / 2) || a.r - b.r);
}
