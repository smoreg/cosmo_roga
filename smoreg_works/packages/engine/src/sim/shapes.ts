import { type Point, DIRS8 } from "./grid.js";

/**
 * Grid geometry: the shapes every targeted ability is built from. Kept separate
 * from targeting so it can be unit-tested without a game state.
 */

/** Bresenham line from a to b, inclusive of both ends. */
export function line(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx - dy;

  for (let guard = 0; guard < 4096; guard++) {
    out.push({ x: x0, y: y0 });
    if (x0 === b.x && y0 === b.y) return out;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}

/** Filled disc of chebyshev radius r (a square) or euclidean r (a circle). */
export function disc(center: Point, r: number, metric: "euclidean" | "chebyshev" = "euclidean"): Point[] {
  const out: Point[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const inside = metric === "chebyshev" ? true : dx * dx + dy * dy <= r * r + r;
      if (inside) out.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return out;
}

/** Just the outline at exactly distance r (chebyshev). */
export function ring(center: Point, r: number): Point[] {
  if (r === 0) return [{ ...center }];
  const out: Point[] = [];
  for (let dx = -r; dx <= r; dx++) {
    out.push({ x: center.x + dx, y: center.y - r });
    out.push({ x: center.x + dx, y: center.y + r });
  }
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    out.push({ x: center.x - r, y: center.y + dy });
    out.push({ x: center.x + r, y: center.y + dy });
  }
  return out;
}

/**
 * Cone of half-angle `spread` (in tiles of widening per step) from `origin`
 * towards `towards`, out to `range`. Simple and predictable on a grid: at step
 * n the cone is 1 + 2*floor(n*spread) tiles wide, which players can count.
 */
export function cone(origin: Point, towards: Point, range: number, spread = 0.5): Point[] {
  const dx = Math.sign(towards.x - origin.x);
  const dy = Math.sign(towards.y - origin.y);
  if (dx === 0 && dy === 0) return [{ ...origin }];

  const out: Point[] = [];
  const seen = new Set<string>();
  const push = (p: Point) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };

  for (let step = 1; step <= range; step++) {
    const half = Math.floor(step * spread);
    const cx = origin.x + dx * step;
    const cy = origin.y + dy * step;
    // Widen perpendicular to the main axis; for diagonals widen both ways.
    for (let w = -half; w <= half; w++) {
      if (dx !== 0 && dy !== 0) push({ x: cx + w, y: cy - w });
      else if (dx !== 0) push({ x: cx, y: cy + w });
      else push({ x: cx + w, y: cy });
    }
  }
  return out;
}

/** Beam along a line, stopping at the first blocked tile (inclusive). */
export function beam(origin: Point, towards: Point, range: number, blocked: (x: number, y: number) => boolean): Point[] {
  const dx = towards.x - origin.x;
  const dy = towards.y - origin.y;
  const len = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const far = { x: origin.x + Math.round((dx / len) * range), y: origin.y + Math.round((dy / len) * range) };

  const out: Point[] = [];
  for (const p of line(origin, far)) {
    if (p.x === origin.x && p.y === origin.y) continue;
    out.push(p);
    if (blocked(p.x, p.y)) break;
    if (Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y)) >= range) break;
  }
  return out;
}

/** The eight tiles around a point, in a stable order. */
export function neighbours(p: Point): Point[] {
  return DIRS8.map((d) => ({ x: p.x + d.x, y: p.y + d.y }));
}
