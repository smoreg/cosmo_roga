/**
 * Draw a deck as inline SVG, in the game's palette.
 *
 * What the picture has to say, in order of importance:
 *
 *  1. the silhouette — the outer edge of the compartments, drawn in steel and
 *     thicker than anything else;
 *  2. the bulkheads — where one compartment ends and the next begins;
 *  3. the doors — a gap in a bulkhead, in the accent colour, and nowhere else;
 *  4. the cells — the hex seams inside one compartment, faint, so the reader
 *     can see the lattice the whole thing is laid on without tripping over it.
 */

import { hexCorners, hexCentre, hexKey, HEX_DIRS, EDGE_OF_DIR } from "./hexgrid.mjs";

export const PALETTE = {
  bg: "#0a0d10",
  panel: "#10151a",
  text: "#b9c4cc",
  dim: "#3f4a52",
  accent: "#e0a458",
  steel: "#6f8a9a",
  bulkhead: "#5a4e42",

  // Three levels of tone, and the drawn ship needs all three: **background,
  // hull, detail**. The hull used to be filled `#141b22` against a `#0a0d10`
  // background — a difference of five points, invisible on a screen, so the
  // ship read as an outline over nothing and every panel and frame inside it
  // disappeared. These two are working values, deliberately far enough apart to
  // see; the exact ones are a question for design.
  hull: "#1b242c",
  plate: "#28343e",
};

const R = 13; // hex radius in px
const PAD = 10;

export function renderDeck(deck, { title = "" } = {}) {
  const cells = deck.cells;
  const byKey = new Map(cells.map((c) => [hexKey(c), c]));
  const doorWalls = new Set();
  for (const door of deck.doors) {
    const { cell, dir } = door.wall;
    doorWalls.add(`${hexKey(cell)}|${dir}`);
    const far = { q: cell.q + HEX_DIRS[dir].q, r: cell.r + HEX_DIRS[dir].r };
    doorWalls.add(`${hexKey(far)}|${5 - dir}`);
  }

  const pts = cells.flatMap((c) => hexCorners(c).map((p) => ({ x: p.x * R, y: p.y * R })));
  const minX = Math.min(...pts.map((p) => p.x)) - PAD;
  const maxX = Math.max(...pts.map((p) => p.x)) + PAD;
  const minY = Math.min(...pts.map((p) => p.y)) - PAD;
  const maxY = Math.max(...pts.map((p) => p.y)) + PAD;

  const out = [];
  out.push(
    `<svg viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" ` +
      `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">`,
  );

  // 1. compartment bodies
  for (const comp of deck.compartments) {
    const fill = comp.airlock ? "#1b1a17" : shade(comp.depth, deck.metrics.maxDepth);
    for (const cell of comp.cells) {
      out.push(`<polygon points="${poly(cell)}" fill="${fill}" />`);
    }
  }

  // 2. walls, in three weights
  const skin = [];
  const bulkheads = [];
  const seams = [];
  const doorways = [];
  for (const cell of cells) {
    HEX_DIRS.forEach((d, dir) => {
      const far = byKey.get(hexKey({ q: cell.q + d.q, r: cell.r + d.r }));
      const [p, q] = wall(cell, dir);
      if (far === undefined) {
        skin.push(line(p, q));
        return;
      }
      if (hexKey(cell) > hexKey(far)) return; // drawn from the other side
      if (far.comp === cell.comp) {
        seams.push(line(p, q));
        return;
      }
      if (doorWalls.has(`${hexKey(cell)}|${dir}`)) {
        // A doorway is a gap: the wall keeps its two ends and loses its middle.
        doorways.push(line(lerp(p, q, 0.0), lerp(p, q, 0.3)));
        doorways.push(line(lerp(p, q, 0.7), lerp(p, q, 1.0)));
        out.push(
          `<line ${line(lerp(p, q, 0.3), lerp(p, q, 0.7))} stroke="${PALETTE.accent}" ` +
            `stroke-width="2.4" stroke-linecap="round" />`,
        );
        return;
      }
      bulkheads.push(line(p, q));
    });
  }
  out.push(group(seams, PALETTE.dim, 0.5, 0.45));
  out.push(group(bulkheads, PALETTE.bulkhead, 1.6));
  out.push(group(doorways, PALETTE.bulkhead, 1.6));
  out.push(group(skin, PALETTE.steel, 2.4));

  // 3. one dot per compartment, so the rooms can be counted off the picture
  for (const comp of deck.compartments) {
    const c = centroid(comp);
    if (comp.airlock) {
      out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="4.4" fill="none" stroke="${PALETTE.accent}" stroke-width="1.5" />`);
      out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="1.7" fill="${PALETTE.accent}" />`);
    } else {
      out.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="1.6" fill="${PALETTE.dim}" />`);
    }
  }

  out.push("</svg>");
  return out.join("\n");
}

function group(lines, stroke, width, opacity = 1) {
  if (lines.length === 0) return "";
  return (
    `<g stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}">` +
    lines.map((l) => `<line ${l} />`).join("") +
    `</g>`
  );
}

function wall(cell, dir) {
  const corners = hexCorners(cell);
  const j = EDGE_OF_DIR[dir];
  const a = corners[j];
  const b = corners[(j + 1) % 6];
  return [
    { x: a.x * R, y: a.y * R },
    { x: b.x * R, y: b.y * R },
  ];
}

function poly(cell) {
  return hexCorners(cell)
    .map((p) => `${f(p.x * R)},${f(p.y * R)}`)
    .join(" ");
}

function centroid(comp) {
  const pts = comp.cells.map((c) => hexCentre(c));
  return {
    x: (pts.reduce((s, p) => s + p.x, 0) / pts.length) * R,
    y: (pts.reduce((s, p) => s + p.y, 0) / pts.length) * R,
  };
}

function line(p, q) {
  return `x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}"`;
}

function lerp(p, q, t) {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** Deeper compartments sit darker, so distance from the airlock is visible. */
function shade(depth, maxDepth) {
  const t = maxDepth > 0 ? Math.max(0, depth) / maxDepth : 0;
  const from = [0x18, 0x20, 0x27];
  const to = [0x0d, 0x11, 0x15];
  const mix = from.map((v, i) => Math.round(v + (to[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function f(n) {
  return Math.round(n * 100) / 100;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
