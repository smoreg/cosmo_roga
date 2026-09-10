/**
 * The ship, drawn — and the game's own hex map laid on top of it.
 *
 * Two layers that owe each other nothing:
 *
 *   1. a picture of a hull: plated skin with a bow and a stern, frames across
 *      it, an inner hull line, a bridge with lit windows, engine nacelles with
 *      bells, hatches, portholes, antennae. Just a picture;
 *   2. over it, **the hexes** — the grid itself, cell by cell, edge to edge.
 *      Nothing about it changes because there is a drawing underneath: the
 *      background is decoration.
 *
 * The first version of this file got that backwards — it tiled the silhouette
 * with the compartments themselves, so the picture *was* the map. This one
 * keeps them apart. The hexagons are not aligned to anything in the drawing. That was allowed up
 * front («даже если они идеально не ложатся»), and it is what keeps this
 * affordable: the background has to read as a ship, the overlay has to read as
 * a graph, and neither has to agree with the other.
 *
 * Everything is a pure function of the same `(silhouette, seed)` the layout
 * came from — a second rng stream, so choosing a different hatch never moves a
 * compartment. Inline SVG, no gradients fetched, no fonts, no filters.
 *
 * The ship is drawn along x, bow away from the airlock: every mask in this
 * sandbox is wider than it is tall, and a hull that is not gets the same
 * treatment rather than a special case.
 */

import { hexCentre, hexCorners, hexKey, mulberry32, EDGE_OF_DIR, HEX_DIRS } from "./hexgrid.mjs";
import { extentOf, offsetLoop, outlineLoops, pathOf, simplify } from "./shapes.mjs";
import { PALETTE } from "./render.mjs";

const INK = {
  plate: PALETTE.plate,
  plateLit: "#33414d",
  deep: "#080b0e",
  // The windows are **not** amber. Amber means «here a decision is required» —
  // a door or the airlock — and it was spent on hatches, portholes, the flame
  // and these windows as well, a dozen small orange marks per hull among which
  // the doors were simply lost. Everything that is not a way through is steel.
  glass: PALETTE.steel,
};

/** How far the skin sits outside the hexagons it wraps, in hexagon radii. */
const OUTSET = 0.3;

/** Douglas–Peucker tolerance for the skin, in hexagon radii. See below. */
export const SIMPLIFY = 0.46;

export function renderHullArt(deck, { uid = "art", R = 34 } = {}) {
  const cells = deck.cells;
  const rng = mulberry32((deck.seed * 2654435761) >>> 0);
  const at = new Map(cells.map((c) => [hexKey(c), mul(hexCentre(c), R)]));

  // Straightened and *not* rounded: the corner cutter is what turned these into
  // soft blobs. Douglas–Peucker on its own leaves long straight runs meeting at
  // real corners, which is what a hull plate looks like.
  //
  // **It does not come out of one number.** A hexagon staircase deviates from
  // its own mean line by a little under half a radius, so nothing below a
  // tolerance of about 0.42 collapses it — at 0.12 the ship kept every zigzag
  // and had no straight side anywhere. But Douglas–Peucker straightens a
  // staircase by *chording* it, and the chord runs inside the steps: at 0.46
  // the sides came out straight and the skin sliced the corners off the cells
  // it is supposed to contain. What pays for the chord is room to cut into, so
  // the skin is pushed further out — 0.16 radii before, 0.3 now — and the two
  // numbers only work as a pair.
  //
  // Even paired they are a compromise, not a solution: on some hulls the chord
  // still shaves a cell corner, and pushing the skin out any further inflates
  // the ship into a soft envelope. Straightening a lattice outline properly
  // means collapsing the zigzag as a zigzag rather than fitting a chord through
  // it — a question for design, not a constant to be nudged.
  //
  // Offset first, straighten second. Offsetting an already simplified line folds
  // it over itself wherever an edge is shorter than the offset, and the hull
  // crossed itself at every corner. On the raw outline each edge is a full
  // hexagon side, comfortably longer, so nothing can flip.
  const raw = outlineLoops(cells, R);
  const loops = raw.map((loop) => simplify(offsetLoop(loop, -R * OUTSET), R * SIMPLIFY));
  // There is no inner hull line. Simplifying an inward offset picks different
  // corners than the outer one does, and the two lines crossed each other at
  // every corner of the ship. The skin gets its double line from a thick stroke
  // overdrawn with a thin dark one instead — same look, and it cannot cross.
  const skin = loops.map(pathOf).join(" ");

  const corners = cells.flatMap((c) => hexCorners(c).map((p) => mul(p, R)));
  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));

  // Which way is aft. Everything else — nacelles, bridge, the bow cap — hangs
  // off this one decision, so it is worth getting right: **the stern is the
  // heavy end**. Reading it off the airlock instead put the tug's engines on
  // the tip of its towing boom, which is not a ship. The airlock only breaks a
  // tie, which is what a symmetrical hull like the tanker gives.
  const airlock = deck.compartments.find((c) => c.airlock) ?? deck.compartments[0];
  const dock = mul(hexCentre(airlock.cells[0]), R);
  const band = (maxX - minX) * 0.32;
  const heft = (side) =>
    cells.filter((c) => (side < 0 ? at.get(hexKey(c)).x < minX + band : at.get(hexKey(c)).x > maxX - band)).length;
  const tilt = heft(-1) - heft(1);
  const aft = Math.abs(tilt) <= 1 ? (dock.x < (minX + maxX) / 2 ? -1 : 1) : tilt > 0 ? -1 : 1;
  const sternX = aft < 0 ? minX : maxX;
  const bowX = aft < 0 ? maxX : minX;
  const box = { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };

  const body = [];
  body.push(nacelles(cells, at, box, aft, sternX, R, uid, rng));
  body.push(`<path d="${skin}" fill="${PALETTE.hull}" fill-rule="evenodd" />`);
  body.push(`<g clip-path="url(#skin-${uid})">${plating(box, aft, bowX, R, rng)}${spine(deck, at, R)}</g>`);
  body.push(`<g clip-path="url(#skin-${uid})">${bridge(box, aft, bowX, R)}${hatches(cells, at, R, rng)}</g>`);
  body.push(antennae(cells, at, R, rng));
  body.push(`<path d="${skin}" fill="none" fill-rule="evenodd" stroke="#8fa8b6" stroke-width="3" stroke-linejoin="miter" stroke-miterlimit="6" />`);
  body.push(`<path d="${skin}" fill="none" fill-rule="evenodd" stroke="${PALETTE.bg}" stroke-width="1" stroke-linejoin="miter" stroke-miterlimit="6" />`);
  // A wash over the picture so the grid has something to sit on. It is the skin
  // itself rather than a clipped rectangle: a rectangle sized off the viewBox
  // would have to be measured before the viewBox is known.
  body.push(`<path d="${skin}" fill="${PALETTE.bg}" fill-rule="evenodd" opacity="0.1" />`);
  // The honeycomb, over the picture and owing it nothing.
  body.push(hexGrid(deck, R));

  // The frame is measured off what is drawn, not off the hexagons. Sizing it by
  // the cells and adding a fixed margin cut the bells and the flame off every
  // ship that had engines — they hang some three radii past the stern, and the
  // margin was one and a half.
  const drawn = extentOf(body.join("\n"));
  const pad = R * 0.5;
  const vx = drawn.minX - pad;
  const vy = drawn.minY - pad;
  const vw = drawn.maxX - drawn.minX + pad * 2;
  const vh = drawn.maxY - drawn.minY + pad * 2;

  return [
    `<svg viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" ` +
      `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(deck.silhouette.name)}">`,
    `<defs><clipPath id="skin-${uid}"><path d="${skin}" /></clipPath></defs>`,
    ...body,
    "</svg>",
  ].join("\n");
}

/**
 * Engine nacelles, drawn under the skin so they tuck into the hull.
 *
 * They go on the widest column of the stern half — on a tug that is the head,
 * on a tanker the middle of the barrel — and reach a hexagon past the stern, so
 * the bells stick out where bells belong. A hull too narrow for two gets one on
 * the axis instead of two overlapping each other.
 */
function nacelles(cells, at, box, aft, sternX, R, uid, rng) {
  const cols = new Map();
  for (const cell of cells) {
    const p = at.get(hexKey(cell));
    const k = Math.round(p.x * 4) / 4;
    const col = cols.get(k) ?? { x: p.x, top: p.y, bottom: p.y };
    col.top = Math.min(col.top, p.y);
    col.bottom = Math.max(col.bottom, p.y);
    cols.set(k, col);
  }
  // Only columns at the stern itself. Taking the widest column of the whole
  // stern half seated them amidships, and a pod that reaches from midships to
  // past the tail is a pipe laid over the ship, not an engine.
  const reach = Math.max(R * 1.2, box.w * 0.2);
  const stern = [...cols.values()].filter((c) => Math.abs(c.x - sternX) <= reach);
  if (stern.length === 0) return "";
  const seat = stern.reduce((best, c) => (c.bottom - c.top > best.bottom - best.top ? c : best), stern[0]);

  // Long enough that the root is buried in the hull: the pod is drawn before
  // the skin, so overlap is what makes it look attached instead of parked
  // alongside.
  const length = Math.max(R * 2.4, Math.min(R * 3.8, box.w * 0.5));
  const tip = sternX + aft * R * 0.95;
  const root = tip - aft * length;
  const wide = seat.bottom - seat.top >= R * 0.9;
  const seats = wide ? [seat.top - R * 0.22, seat.bottom + R * 0.22] : [(seat.top + seat.bottom) / 2];
  const w = R * (wide ? 0.92 : 1.1);

  return seats
    .map((y) => {
      const x = Math.min(root, tip);
      const front = x + (aft < 0 ? length : 0);
      const ribs = [];
      for (let i = 1; i <= 3; i++) {
        const rx = root + aft * (length * i) / 4;
        ribs.push(`<line x1="${f(rx)}" y1="${f(y - w / 2)}" x2="${f(rx)}" y2="${f(y + w / 2)}" />`);
      }
      // Bell and flame as straight-edged shapes: a radial gradient plume read as
      // a smudge, and the ask was for clean lines.
      const bell = [
        [tip, y - w * 0.5],
        [tip + aft * R * 0.42, y - w * 0.72],
        [tip + aft * R * 0.42, y + w * 0.72],
        [tip, y + w * 0.5],
      ];
      const flame = [
        [tip + aft * R * 0.5, y - w * 0.42],
        [tip + aft * R * 1.5, y],
        [tip + aft * R * 0.5, y + w * 0.42],
      ];
      return (
        `<g>` +
        `<rect x="${f(x)}" y="${f(y - w / 2)}" width="${f(length)}" height="${f(w)}" ` +
        `fill="${INK.plate}" stroke="#8fa8b6" stroke-width="2" />` +
        `<line x1="${f(x + R * 0.2)}" y1="${f(y - w * 0.26)}" x2="${f(x + length - R * 0.2)}" y2="${f(y - w * 0.26)}" ` +
        `stroke="${PALETTE.steel}" stroke-width="1" opacity="0.45" />` +
        `<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.35">${ribs.join("")}</g>` +
        `<line x1="${f(front)}" y1="${f(y - w / 2)}" x2="${f(front)}" y2="${f(y + w / 2)}" ` +
        `stroke="${PALETTE.steel}" stroke-width="1.6" opacity="0.7" />` +
        `<polygon points="${pts(bell)}" fill="${INK.deep}" stroke="#8fa8b6" stroke-width="1.6" />` +
        `<polygon points="${pts(flame)}" fill="${PALETTE.steel}" opacity="0.22" />` +
        `<polyline points="${pts([[tip + aft * R * 0.45, y], [tip + aft * R * 1.35, y]])}" fill="none" ` +
        `stroke="${PALETTE.steel}" stroke-width="2" opacity="0.7" />` +
        `</g>`
      );
    })
    .join("");
}

/** Points for a polygon, from pairs. */
function pts(list) {
  return list.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
}

/**
 * Plating: frames across the hull, two longitudinal seams, a few panels caught
 * in a different light, and a bow cap. Clipped to the skin, so the hull shape
 * does all the work of making it fit.
 */
function plating(box, aft, bowX, R, rng) {
  const out = [];
  const frames = [];
  const panels = [];
  const step = R * 1.15;
  for (let x = box.minX + step; x < box.maxX; x += step) {
    frames.push(`<line x1="${f(x)}" y1="${f(box.minY)}" x2="${f(x)}" y2="${f(box.maxY)}" />`);
    if (rng() < 0.34) {
      panels.push(
        `<rect x="${f(x)}" y="${f(box.minY)}" width="${f(step)}" height="${f(box.h)}" fill="#ffffff" opacity="0.045" />`,
      );
    }
  }
  out.push(panels.join(""));
  out.push(`<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.3">${frames.join("")}</g>`);

  const seams = [0.3, 0.7]
    .map((t) => {
      const y = box.minY + box.h * t;
      return `<line x1="${f(box.minX)}" y1="${f(y)}" x2="${f(box.maxX)}" y2="${f(y)}" />`;
    })
    .join("");
  out.push(`<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.18">${seams}</g>`);

  // Bow and stern caps: the end sections, in a slightly different light. Both
  // measured *inwards* from their end — the first version measured outwards,
  // put the cap and the bridge past the nose, and the clip path ate them.
  const capX = bowX + aft * R * 1.7;
  out.push(
    `<rect x="${f(Math.min(capX, bowX))}" y="${f(box.minY)}" width="${f(R * 1.7)}" height="${f(box.h)}" ` +
      `fill="#ffffff" opacity="0.045" />` +
      `<line x1="${f(capX)}" y1="${f(box.minY)}" x2="${f(capX)}" y2="${f(box.maxY)}" stroke="${PALETTE.steel}" ` +
      `stroke-width="1.4" opacity="0.4" />`,
  );
  const sternCapX = (aft < 0 ? box.minX : box.maxX) - aft * R * 1.4;
  out.push(
    `<line x1="${f(sternCapX)}" y1="${f(box.minY)}" x2="${f(sternCapX)}" y2="${f(box.maxY)}" ` +
      `stroke="${PALETTE.steel}" stroke-width="1.4" opacity="0.35" />`,
  );

  // Vents and radiators along the middle, where a ship keeps its machinery.
  const greebles = [];
  for (let i = 0; i < 6; i++) {
    const x = box.minX + box.w * (0.15 + rng() * 0.7);
    const y = box.minY + box.h * (0.35 + rng() * 0.3);
    const w = R * (0.4 + rng() * 0.5);
    greebles.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(R * 0.16)}" fill="${INK.deep}" opacity="0.5" />`,
    );
  }
  out.push(greebles.join(""));

  const ports = [];
  for (const t of [0.36, 0.64]) {
    const y = box.minY + box.h * t;
    for (let x = box.minX + R * 0.8; x < box.maxX - R * 0.4; x += R * 1.15) {
      if (rng() < 0.42) continue;
      ports.push(
        `<rect x="${f(x)}" y="${f(y)}" width="${f(R * 0.17)}" height="${f(R * 0.1)}" rx="${f(R * 0.04)}" ` +
          `fill="${PALETTE.steel}" opacity="0.5" />`,
      );
    }
  }
  out.push(ports.join(""));
  return out.join("");
}

/** The keel corridor, if the mask has one: a lane down the middle of the ship. */
function spine(deck, at, R) {
  const keel = deck.cells.filter((c) => c.keel).map((c) => at.get(hexKey(c)));
  if (keel.length < 2) return "";
  keel.sort((a, b) => a.x - b.x || a.y - b.y);
  const d = keel.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ");
  return (
    `<path d="${d}" fill="none" stroke="${PALETTE.steel}" stroke-width="${f(R * 0.62)}" opacity="0.16" stroke-linecap="round" stroke-linejoin="round" />` +
    `<path d="${d}" fill="none" stroke="${PALETTE.steel}" stroke-width="1" opacity="0.3" stroke-dasharray="6 5" />`
  );
}

/** The bridge: a block near the bow with three lit windows facing forward. */
function bridge(box, aft, bowX, R) {
  const w = R * 1.9;
  const h = R * 1.15;
  const cx = bowX + aft * R * 2.6;
  const cy = box.minY + box.h * 0.5;
  const nose = cx - aft * w * 0.5;
  const back = cx + aft * w * 0.5;
  const cut = R * 0.3;
  // A chamfer forward, square aft: the shape says which way the ship is facing.
  const body = [
    [back, cy - h / 2],
    [nose + aft * cut, cy - h / 2],
    [nose, cy - h / 2 + cut],
    [nose, cy + h / 2 - cut],
    [nose + aft * cut, cy + h / 2],
    [back, cy + h / 2],
  ];
  const glass = [-1, 0, 1]
    .map((k) => {
      const x = nose + aft * R * 0.34;
      return `<rect x="${f(Math.min(x, x + aft * R * 0.34))}" y="${f(cy + k * R * 0.28 - R * 0.08)}" ` +
        `width="${f(R * 0.34)}" height="${f(R * 0.16)}" fill="${INK.glass}" opacity="0.9" />`;
    })
    .join("");
  return `<g><polygon points="${pts(body)}" fill="${INK.plateLit}" stroke="#8fa8b6" stroke-width="1.8" />${glass}</g>`;
}

/** Hatches on the plating: a ring with a seam across it. */
function hatches(cells, at, R, rng) {
  const rim = cells.filter((c) => c.rim);
  const out = [];
  for (let i = 0; i < 4 && rim.length > 0; i++) {
    const cell = rim[Math.floor(rng() * rim.length)];
    const p = at.get(hexKey(cell));
    const r = R * 0.24;
    out.push(
      `<g opacity="0.8"><rect x="${f(p.x - r)}" y="${f(p.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}" ` +
        `fill="${INK.deep}" stroke="${PALETTE.steel}" stroke-width="1.3" />` +
        `<line x1="${f(p.x - r)}" y1="${f(p.y)}" x2="${f(p.x + r)}" y2="${f(p.y)}" stroke="${PALETTE.steel}" stroke-width="1" /></g>`,
    );
  }
  return out.join("");
}

/**
 * Antennae and a dish, on the outside of the plating.
 *
 * Only on rim cells whose missing neighbour points up or down: a mast off the
 * bow reads as a broken hull, a mast off the back reads as an aerial.
 */
function antennae(cells, at, R, rng) {
  const posts = [];
  const set = new Set(cells.map(hexKey));
  for (const cell of cells) {
    if (!cell.rim) continue;
    for (const [i, d] of HEX_DIRS.entries()) {
      if (set.has(hexKey({ q: cell.q + d.q, r: cell.r + d.r }))) continue;
      const v = hexCentre(d);
      if (Math.abs(v.y) < 0.9) continue; // sideways: skip, that is the bow or the stern
      posts.push({ p: at.get(hexKey(cell)), v: norm(v), i });
    }
  }
  if (posts.length === 0) return "";

  const out = [];
  const count = Math.min(3, posts.length);
  for (let i = 0; i < count; i++) {
    const post = posts[Math.floor(rng() * posts.length)];
    const len = R * (0.7 + rng() * 0.6);
    const tip = { x: post.p.x + post.v.x * (R * 0.7 + len), y: post.p.y + post.v.y * (R * 0.7 + len) };
    const root = { x: post.p.x + post.v.x * R * 0.5, y: post.p.y + post.v.y * R * 0.5 };
    out.push(
      `<g stroke="${PALETTE.steel}" stroke-width="1.6" opacity="0.9">` +
        `<line x1="${f(root.x)}" y1="${f(root.y)}" x2="${f(tip.x)}" y2="${f(tip.y)}" />` +
        (i === 0 ? dish(tip, post.v, R) : `<circle cx="${f(tip.x)}" cy="${f(tip.y)}" r="2" fill="${PALETTE.steel}" stroke="none" />`) +
        `</g>`,
    );
  }
  return out.join("");
}

/**
 * Hexes over the ship: the grid itself, not a graph of it.
 *
 * Every cell of the hull is drawn as a hexagon, edge to edge, straight over the
 * picture — «корабль, а поверх хексы». Compartment walls are heavier than the
 * seams inside one compartment, and a door is a gap in a wall, which is how the
 * lattice drawing already reads.
 *
 * Nothing here is fitted to the drawing underneath and nothing needs to be: the
 * picture is decoration, the grid is the map.
 */
function hexGrid(deck, R) {
  const byKey = new Map(deck.cells.map((c) => [hexKey(c), c]));
  const doorWalls = new Set();
  for (const door of deck.doors) {
    const { cell, dir } = door.wall;
    doorWalls.add(`${hexKey(cell)}|${dir}`);
    const far = { q: cell.q + HEX_DIRS[dir].q, r: cell.r + HEX_DIRS[dir].r };
    doorWalls.add(`${hexKey(far)}|${5 - dir}`);
  }

  const seams = [];
  const walls = [];
  const doors = [];
  for (const cell of deck.cells) {
    HEX_DIRS.forEach((d, dir) => {
      const far = byKey.get(hexKey({ q: cell.q + d.q, r: cell.r + d.r }));
      const [p, q] = edge(cell, dir, R);
      if (far === undefined) {
        walls.push(seg(p, q)); // the grid closes on itself at the hull line
        return;
      }
      if (hexKey(cell) > hexKey(far)) return;
      if (far.comp === cell.comp) {
        seams.push(seg(p, q));
        return;
      }
      if (doorWalls.has(`${hexKey(cell)}|${dir}`)) {
        doors.push(seg(mix(p, q, 0.26), mix(p, q, 0.74)));
        walls.push(seg(p, mix(p, q, 0.26)));
        walls.push(seg(mix(p, q, 0.74), q));
        return;
      }
      walls.push(seg(p, q));
    });
  }

  const marks = deck.compartments
    .map((comp) => {
      const pts = comp.cells.map((c) => mul(hexCentre(c), R));
      const p = {
        x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
        y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
      };
      return comp.airlock
        ? `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(R * 0.2)}" fill="${PALETTE.bg}" fill-opacity="0.8" ` +
            `stroke="${PALETTE.accent}" stroke-width="2" />` +
            `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(R * 0.07)}" fill="${PALETTE.accent}" />`
        : `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(R * 0.07)}" fill="${PALETTE.text}" opacity="0.55" />`;
    })
    .join("");

  return (
    `<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.3">${seams.join("")}</g>` +
    `<g stroke="${PALETTE.text}" stroke-width="1.7" opacity="0.55" stroke-linecap="round">${walls.join("")}</g>` +
    `<g stroke="${PALETTE.accent}" stroke-width="3" opacity="0.95" stroke-linecap="round">${doors.join("")}</g>` +
    marks
  );
}

/** One side of a hexagon, in pixels. */
function edge(cell, dir, R) {
  const corners = hexCorners(cell);
  const j = EDGE_OF_DIR[dir];
  return [mul(corners[j], R), mul(corners[(j + 1) % 6], R)];
}

function mix(p, q, t) {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** A flat panel on the end of a mast: an array, and four straight edges. */
function dish(tip, v, R) {
  const u = { x: -v.y, y: v.x };
  const long = R * 0.44;
  const thick = R * 0.13;
  const quad = [
    [tip.x + u.x * long - v.x * thick, tip.y + u.y * long - v.y * thick],
    [tip.x + u.x * long + v.x * thick, tip.y + u.y * long + v.y * thick],
    [tip.x - u.x * long + v.x * thick, tip.y - u.y * long + v.y * thick],
    [tip.x - u.x * long - v.x * thick, tip.y - u.y * long - v.y * thick],
  ];
  return `<polygon points="${pts(quad)}" fill="${INK.plateLit}" stroke="${PALETTE.steel}" stroke-width="1.3" />`;
}

/** The cell a compartment's hexagon sits on: the one nearest its middle. */
function anchor(comp) {
  const cx = comp.cells.reduce((s, c) => s + hexCentre(c).x, 0) / comp.cells.length;
  const cy = comp.cells.reduce((s, c) => s + hexCentre(c).y, 0) / comp.cells.length;
  return comp.cells.reduce((best, c) => {
    const p = hexCentre(c);
    const q = hexCentre(best);
    return Math.hypot(p.x - cx, p.y - cy) < Math.hypot(q.x - cx, q.y - cy) ? c : best;
  }, comp.cells[0]);
}

/** Corridor ends: on the two outlines, not in the centres. */
function trim(a, b, inradius) {
  if (a === undefined || b === undefined) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= inradius * 2) return undefined;
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: a.x + ux * inradius, y: a.y + uy * inradius },
    { x: b.x - ux * inradius, y: b.y - uy * inradius },
  ];
}

function hexPoints(c, r) {
  const half = (Math.sqrt(3) / 2) * r;
  return [
    [c.x, c.y - r],
    [c.x + half, c.y - r / 2],
    [c.x + half, c.y + r / 2],
    [c.x, c.y + r],
    [c.x - half, c.y + r / 2],
    [c.x - half, c.y - r / 2],
  ]
    .map(([x, y]) => `${f(x)},${f(y)}`)
    .join(" ");
}

function seg(p, q) {
  return `<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" />`;
}

function mul(p, k) {
  return { x: p.x * k, y: p.y * k };
}

function norm(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function f(n) {
  return Math.round(n * 10) / 10;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
