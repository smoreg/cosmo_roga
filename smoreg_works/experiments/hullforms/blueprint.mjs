/**
 * The second drawing: the silhouette as a **deck plan**, with the compartment
 * graph laid over it.
 *
 * The first drawing (`render.mjs`) is honest to the lattice — every room is its
 * hexagons, every door is a gap in the wall those hexagons share. This one gives
 * that up on purpose. The hull is drawn the way a Traveller deck plan is drawn:
 * a smooth double-line skin, transverse bulkheads, a corridor down the spine,
 * pods for the limbs that hang off a neck. Then the graph — a dot per
 * compartment, a line per door — goes on top of it.
 *
 * **The dots are not meant to land in the rooms of the plan.** The owner said
 * so («даже если они идеально не ложатся»), and it is the whole reason this is
 * cheap: nothing here has to agree with anything, the plan has to read as a
 * ship and the graph has to read as a graph. Every line in this file is drawn
 * from the same mask the first drawing uses, so the two pictures can never
 * disagree about the shape — only about how much of the lattice they admit to.
 *
 * How each part of the plan is derived:
 *
 *   skin        the boundary edges of the mask, stitched into loops and rounded
 *               by two passes of Chaikin corner-cutting; drawn thick then
 *               overdrawn thin in the background colour, which is what makes it
 *               read as two parallel lines instead of one fat one
 *   bulkheads   three lines across the long axis, clipped to the skin
 *   corridor    the keel cells, same double-line trick, drawn over the
 *               bulkheads so it reads as passing through them
 *   pods        limbs: a piece the hull falls into when one cell is removed,
 *               small enough to be a nacelle rather than half the ship
 */

import { EDGE_OF_DIR, HEX_DIRS, hexAround, hexCentre, hexCorners, hexKey } from "./hexgrid.mjs";
import { PALETTE } from "./render.mjs";

const R = 13;
const PAD = 13;

/** A limb bigger than this share of the hull is not a nacelle, it is the ship. */
const LIMB_SHARE = 0.4;

export function renderBlueprint(deck, { uid = "bp" } = {}) {
  const cells = deck.cells;
  const hull = loops(cells).map((loop) => chaikin(simplify(loop), 3));
  const pods = limbs(cells).map((limb) => loops(limb).map((loop) => shrink(chaikin(simplify(loop), 3), 0.9)));

  const pts = cells.flatMap((c) => hexCorners(c).map((p) => ({ x: p.x * R, y: p.y * R })));
  const minX = Math.min(...pts.map((p) => p.x)) - PAD;
  const maxX = Math.max(...pts.map((p) => p.x)) + PAD;
  const minY = Math.min(...pts.map((p) => p.y)) - PAD;
  const maxY = Math.max(...pts.map((p) => p.y)) + PAD;
  const skin = hull.map(path).join(" ");

  const out = [
    `<svg viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" ` +
      `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(deck.silhouette.name)}">`,
    `<defs><clipPath id="hull-${uid}"><path d="${skin}" /></clipPath></defs>`,
    `<path d="${skin}" fill="#131920" fill-rule="evenodd" />`,
  ];

  // Bulkheads across the long axis, and the corridor over them.
  const across = [];
  const horizontal = maxX - minX >= maxY - minY;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    across.push(
      horizontal
        ? line({ x: minX + (maxX - minX) * t, y: minY }, { x: minX + (maxX - minX) * t, y: maxY })
        : line({ x: minX, y: minY + (maxY - minY) * t }, { x: maxX, y: minY + (maxY - minY) * t }),
    );
  }
  out.push(
    `<g clip-path="url(#hull-${uid})">` +
      `<g stroke="${PALETTE.steel}" stroke-width="1.3" opacity="0.55">${across.map((l) => `<line ${l} />`).join("")}</g>` +
      corridor(cells) +
      `</g>`,
  );

  for (const pod of pods) {
    const d = pod.map(path).join(" ");
    out.push(`<path d="${d}" fill="#171f26" fill-rule="evenodd" stroke="${PALETTE.steel}" stroke-width="1.6" opacity="0.8" />`);
  }

  out.push(`<path d="${skin}" fill="none" stroke="${PALETTE.steel}" stroke-width="4.6" stroke-linejoin="round" />`);
  out.push(`<path d="${skin}" fill="none" stroke="${PALETTE.bg}" stroke-width="1.9" stroke-linejoin="round" />`);

  // The graph, over the plan and owing it nothing.
  const at = deck.compartments.map(centroid);
  const doors = deck.doors
    .map((d) => `<line ${line(at[d.a], at[d.b])} />`)
    .join("");
  out.push(`<g stroke="${PALETTE.accent}" stroke-width="1.7" opacity="0.92" stroke-linecap="round">${doors}</g>`);
  deck.compartments.forEach((comp, i) => {
    const p = at[i];
    if (comp.airlock) {
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="5.6" fill="${PALETTE.bg}" stroke="${PALETTE.accent}" stroke-width="1.8" />`);
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="2" fill="${PALETTE.accent}" />`);
    } else {
      out.push(`<circle cx="${f(p.x)}" cy="${f(p.y)}" r="4.2" fill="${PALETTE.bg}" stroke="${PALETTE.text}" stroke-width="1.5" />`);
    }
  });

  out.push("</svg>");
  return out.join("\n");
}

/** The keel, as one corridor: thick steel overdrawn thin, so it comes out double. */
function corridor(cells) {
  const keel = cells.filter((c) => c.keel).map((c) => scale(hexCentre(c)));
  if (keel.length < 2) return "";
  keel.sort((a, b) => a.x - b.x || a.y - b.y);
  const d = keel.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ");
  return (
    `<path d="${d}" fill="none" stroke="${PALETTE.steel}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" opacity="0.55" />` +
    `<path d="${d}" fill="none" stroke="#131920" stroke-width="9.5" stroke-linejoin="round" stroke-linecap="round" />`
  );
}

/**
 * Limbs: cut one cell out of the hull and see what falls off.
 *
 * Anything smaller than `LIMB_SHARE` of the hull and bigger than a single cell
 * is a nacelle, a prong or a pod. Overlapping candidates are settled largest
 * first, so a pylon is drawn once and not as three nested pods.
 */
function limbs(cells) {
  const byKey = new Map(cells.map((c) => [hexKey(c), c]));
  const found = [];
  for (const cut of cells) {
    const rest = cells.filter((c) => c !== cut);
    for (const part of components(rest, byKey, hexKey(cut))) {
      if (part.length < 2 || part.length > cells.length * LIMB_SHARE) continue;
      found.push(part);
    }
  }
  found.sort((a, b) => b.length - a.length);

  const taken = new Set();
  const out = [];
  for (const part of found) {
    if (part.some((c) => taken.has(hexKey(c)))) continue;
    for (const c of part) taken.add(hexKey(c));
    out.push(part);
    if (out.length >= 8) break;
  }
  return out;
}

function components(cells, byKey, skip) {
  const live = new Set(cells.map(hexKey));
  live.delete(skip);
  const seen = new Set();
  const out = [];
  for (const cell of cells) {
    const k = hexKey(cell);
    if (seen.has(k) || !live.has(k)) continue;
    const part = [];
    const queue = [cell];
    seen.add(k);
    while (queue.length > 0) {
      const at = queue.pop();
      part.push(at);
      for (const n of hexAround(at)) {
        const nk = hexKey(n);
        if (!live.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        queue.push(byKey.get(nk));
      }
    }
    out.push(part);
  }
  return out;
}

/**
 * The outline of a set of cells, as closed loops.
 *
 * Every wall with nothing on the far side is a segment; segments are stitched
 * end to end by their endpoints. A hull with a hole in it — the ring station —
 * comes back as two loops, which is why the paths are filled `evenodd`.
 */
function loops(cells) {
  const set = new Set(cells.map(hexKey));
  const segs = [];
  for (const cell of cells) {
    HEX_DIRS.forEach((d, dir) => {
      if (set.has(hexKey({ q: cell.q + d.q, r: cell.r + d.r }))) return;
      const corners = hexCorners(cell);
      const j = EDGE_OF_DIR[dir];
      segs.push([scale(corners[j]), scale(corners[(j + 1) % 6])]);
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
 * This is the step that makes the plan look drawn rather than traced. A "flat"
 * side of a hex outline is not flat: it zigzags by half a hexagon every edge,
 * and smoothing a zigzag gives a wave, which is why the first pass came out as
 * a row of sausages. Dropping every vertex within `eps` of the chord collapses
 * the zigzag to one straight line and leaves the real corners alone — after
 * which the corner cutter has corners worth cutting.
 *
 * `eps` is just under half a hexagon: bigger, and a one-cell pylon is
 * straightened out of existence.
 */
function simplify(loop, eps = R * 0.42) {
  if (loop.length < 4) return loop;
  // Start at an extreme point: it is certainly a real corner, so the chain is
  // not cut open in the middle of a side.
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

/** Distance from a point to the segment through `a` and `b`. */
function away(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Corner cutting: Chaikin, on an outline that has already been straightened. */
function chaikin(loop, passes, t = 0.25) {
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

/** Pull a loop in towards its own middle, so a pod sits inside the skin. */
function shrink(loop, k) {
  const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length;
  const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length;
  return loop.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

function path(loop) {
  return loop.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ") + " Z";
}

function centroid(comp) {
  const pts = comp.cells.map((c) => scale(hexCentre(c)));
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

function scale(p) {
  return { x: p.x * R, y: p.y * R };
}

function line(p, q) {
  return `x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}"`;
}

function f(n) {
  return Math.round(n * 10) / 10;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
