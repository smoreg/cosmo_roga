/**
 * Turning a set of hexagons into drawable outlines.
 *
 * Shared by the two drawings that need a hull shape rather than a lattice:
 * `blueprint.mjs` (thin plan) and `hullart.mjs` (the drawn ship). Nothing here
 * knows what a compartment is — it takes cells and gives back closed loops in
 * pixels.
 */

import { EDGE_OF_DIR, HEX_DIRS, hexCorners, hexKey } from "./hexgrid.mjs";

/**
 * The outline of a set of cells, as closed loops, scaled to pixels.
 *
 * Every wall with nothing on the far side is a segment; segments are stitched
 * end to end by their endpoints. A hull with a hole in it — the ring station —
 * comes back as two loops, which is why callers fill `evenodd`.
 */
export function outlineLoops(cells, R) {
  const set = new Set(cells.map(hexKey));
  const segs = [];
  for (const cell of cells) {
    HEX_DIRS.forEach((d, dir) => {
      if (set.has(hexKey({ q: cell.q + d.q, r: cell.r + d.r }))) return;
      const corners = hexCorners(cell);
      const j = EDGE_OF_DIR[dir];
      segs.push([mul(corners[j], R), mul(corners[(j + 1) % 6], R)]);
    });
  }

  const at = (p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = at(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });

  const used = new Array(segs.length).fill(false);
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [segs[i][0], segs[i][1]];
    let cur = segs[i][1];
    for (;;) {
      const next = (ends.get(at(cur)) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = true;
      const seg = segs[next];
      const far = at(seg[0]) === at(cur) ? seg[1] : seg[0];
      if (at(far) === at(loop[0])) break;
      loop.push(far);
      cur = far;
    }
    if (loop.length >= 3) out.push(loop);
  }
  return out;
}

/**
 * Straighten a hex staircase into hull sides. Douglas–Peucker, on a closed loop.
 *
 * This is the step that makes a hull look drawn rather than traced. A "flat"
 * side of a hex outline is not flat: it zigzags by half a hexagon every edge,
 * and smoothing a zigzag gives a wave — the first plan came out as a row of
 * sausages. Dropping every vertex within `eps` of the chord collapses the
 * zigzag to one straight line and leaves the real corners alone.
 *
 * `eps` is just under half a hexagon: bigger, and a one-cell pylon is
 * straightened out of existence.
 */
export function simplify(loop, eps) {
  if (loop.length < 4) return loop;
  let start = 0;
  for (let i = 1; i < loop.length; i++) if (loop[i].x < loop[start].x) start = i;
  const chain = [...loop.slice(start), ...loop.slice(0, start)];
  chain.push(chain[0]);

  const keep = new Array(chain.length).fill(false);
  keep[0] = true;
  keep[chain.length - 1] = true;
  const stack = [[0, chain.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = away(chain[i], chain[a], chain[b]);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst < 0 || far <= eps) continue;
    keep[worst] = true;
    stack.push([a, worst], [worst, b]);
  }
  const out = chain.filter((_, i) => keep[i]);
  out.pop();
  return out.length >= 3 ? out : loop;
}

/** Corner cutting: Chaikin, on an outline that has already been straightened. */
export function chaikin(loop, passes, t = 0.25) {
  let pts = loop;
  for (let i = 0; i < passes; i++) {
    const next = [];
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j];
      const b = pts[(j + 1) % pts.length];
      next.push({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
      next.push({ x: a.x * t + b.x * (1 - t), y: a.y * t + b.y * (1 - t) });
    }
    pts = next;
  }
  return pts;
}

/**
 * The same loop, `d` pixels inside itself: an inner hull line.
 *
 * Per-vertex normals, not a scale about the centroid — scaling pulls the nose
 * of a long hull in by a tenth of its length while barely moving its sides, and
 * the inner line stops being parallel to anything. Thin parts can still fold
 * the offset over itself; callers clip it to the hull, so a fold stays inside
 * and out of sight.
 */
export function offsetLoop(loop, d) {
  const inward = signedArea(loop) > 0 ? -1 : 1;
  return loop.map((p, i) => {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const next = loop[(i + 1) % loop.length];
    const n1 = normal(prev, p);
    const n2 = normal(p, next);
    const nx = n1.x + n2.x;
    const ny = n1.y + n2.y;
    const len = Math.hypot(nx, ny) || 1;
    return { x: p.x + (nx / len) * d * inward, y: p.y + (ny / len) * d * inward };
  });
}

/** Loop to an SVG path. */
export function pathOf(loop) {
  return loop.map((p, i) => `${i === 0 ? "M" : "L"} ${r1(p.x)} ${r1(p.y)}`).join(" ") + " Z";
}

/** Pull a loop in towards its own middle. Fine for small, compact shapes. */
export function shrink(loop, k) {
  const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length;
  const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length;
  return loop.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

export function signedArea(loop) {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** The biggest loop is the hull; the rest are holes in it. */
export function outerLoop(loops) {
  return loops.reduce((best, loop) => (Math.abs(signedArea(loop)) > Math.abs(signedArea(best)) ? loop : best), loops[0]);
}

function normal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dy / len, y: -dx / len };
}

function away(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function mul(p, k) {
  return { x: p.x * k, y: p.y * k };
}

function r1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * The bounding box of everything an SVG fragment actually draws.
 *
 * Both drawings used to size their `viewBox` off the hexagons and add a fixed
 * margin, but the engine bells and the flame hang three hexagon radii past the
 * stern — so every ship with pods had its exhausts sliced off by the edge of
 * the picture. Measuring the fragment instead means a detail added later cannot
 * fall outside the frame: whatever is emitted is what gets measured.
 *
 * It reads the primitives this sandbox emits and nothing else — line, rect,
 * circle, `points=` and the `M/L/Z` paths `pathOf` writes. Strokes are not
 * accounted for; the caller's padding covers the half-width.
 */
export function extentOf(svg) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const note = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  };

  for (const m of svg.matchAll(/<line\b([^>]*)>/g)) {
    const a = numAttrs(m[1]);
    note(a.x1, a.y1);
    note(a.x2, a.y2);
  }
  for (const m of svg.matchAll(/<rect\b([^>]*)>/g)) {
    const a = numAttrs(m[1]);
    note(a.x, a.y);
    note(a.x + a.width, a.y + a.height);
  }
  for (const m of svg.matchAll(/<circle\b([^>]*)>/g)) {
    const a = numAttrs(m[1]);
    note(a.cx - a.r, a.cy - a.r);
    note(a.cx + a.r, a.cy + a.r);
  }
  for (const m of svg.matchAll(/points="([^"]*)"/g)) {
    for (const pair of m[1].trim().split(/\s+/)) {
      const [x, y] = pair.split(",").map(Number);
      note(x, y);
    }
  }
  for (const m of svg.matchAll(/\sd="([^"]*)"/g)) {
    const nums = (m[1].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) note(nums[i], nums[i + 1]);
  }

  return Number.isFinite(box.minX) ? box : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function numAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/([a-zA-Z][\w-]*)="(-?\d*\.?\d+)"/g)) out[m[1]] = Number(m[2]);
  return out;
}
