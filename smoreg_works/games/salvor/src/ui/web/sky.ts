import { hexCentre, mulberry32, shipForm, type HullFormId, type Point } from "../../content/hullforms.js";

/**
 * The space behind the start screen: stars, and three hulls flying through it.
 *
 * The owner's word on the title artboard: «корабли летают в космосе, а не просто
 * узлы». So the ships are the game's own — `shipForm` out of
 * `content/hullforms.ts`, the same profiles the honeycomb view grows its deck
 * inside — turned and set on a dark field, and the drift is a CSS animation on
 * a layer `mount.ts` keeps between frames, so a key press never restarts it.
 *
 * A string of SVG and nothing else: no words, no DOM, no `Math.random()`. Every
 * star and every jitter of a hull comes out of a fixed seed, so the sky is the
 * same sky on every load and in every test.
 */

/** The frame the sky is drawn in. The layer covers the page with it (`slice`). */
export const SKY_W = 1360;
export const SKY_H = 780;

interface Flyer {
  readonly kind: HullFormId;
  readonly seed: number;
  /** Pixels per tiling radius. */
  readonly scale: number;
  /** Where the stern plate sits, and which way the bow points, in degrees. */
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  /** Further off: a dimmer rim and a slower drift. */
  readonly far: boolean;
  /** Seconds for one pass of the drift, there and back being two. */
  readonly period: number;
}

/** A harpoon close by, a hammer and a whale further off: three classes the catalogue flies. */
export const FLYERS: readonly Flyer[] = [
  { kind: "harpoon", seed: 771, scale: 17, x: 1000, y: 196, heading: -16, far: false, period: 38 },
  { kind: "hammerboat", seed: 4102, scale: 11, x: 1214, y: 484, heading: 143, far: true, period: 52 },
  { kind: "whale", seed: 20260909, scale: 7, x: 868, y: 632, heading: 26, far: true, period: 66 },
];

const STARS = 210;
const STAR_SEED = 90210;
/** The hulls are built small: a silhouette, not a deck plan. */
const SIZE = 6;
const HALF = 2;

export function skySvg(): string {
  return [
    `<svg class="sky" viewBox="0 0 ${SKY_W} ${SKY_H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`,
    starsSvg(),
    ...FLYERS.map(flyerSvg),
    "</svg>",
  ].join("");
}

function starsSvg(): string {
  const rng = mulberry32(STAR_SEED);
  const out: string[] = [];
  for (let i = 0; i < STARS; i++) {
    const cx = Math.round(rng() * SKY_W);
    const cy = Math.round(rng() * SKY_H);
    const r = rng() < 0.86 ? 0.7 : 1.3;
    out.push(`<circle class="sky-star" cx="${cx}" cy="${cy}" r="${r}" opacity="${f(0.1 + rng() * 0.32)}"/>`);
  }
  return `<g>${out.join("")}</g>`;
}

/**
 * One hull: engine pods, the skin, and the honeycomb it is made of, faintly.
 * The outer group places and turns it; the inner one drifts along its own keel,
 * so every ship moves the way its bow points.
 */
function flyerSvg(flyer: Flyer): string {
  const form = shipForm(flyer.kind, flyer.seed, SIZE, HALF);
  const U = flyer.scale;
  const pods = form.pods.map((p) =>
    [
      `<rect class="sky-pod" x="${f(p.x * U)}" y="${f(p.y * U)}" width="${f(p.w * U)}" height="${f(p.h * U)}"/>`,
      `<rect class="sky-bell" x="${f((p.x - 0.22) * U)}" y="${f((p.y + p.h * 0.18) * U)}" width="${f(0.24 * U)}" height="${f(p.h * 0.64 * U)}"/>`,
    ].join(""),
  );
  const skins = form.bodies.map((body) => `<path class="sky-skin" d="${pathOf(body, U)}"/>`);
  const cells = form.cells.map((cell) => pathOf(hexagon(hexCentre(cell, 1)), U)).join(" ");
  const far = flyer.far ? " is-far" : "";
  // A negative delay puts each ship part way through its pass on the first
  // frame, so the three are never seen setting off together.
  const style = `animation-duration:${flyer.period}s;animation-delay:-${Math.round(flyer.period * 0.4)}s`;
  return [
    `<g class="sky-ship${far}" transform="translate(${flyer.x} ${flyer.y}) rotate(${flyer.heading})">`,
    `<g class="sky-drift" style="${style}">`,
    ...pods,
    ...skins,
    `<path class="sky-cells" d="${cells}"/>`,
    "</g></g>",
  ].join("");
}

/** A pointy-top hexagon of one tiling radius, inset a little so neighbours read as cells. */
function hexagon(c: Point): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    out.push({ x: c.x + Math.cos(a) * 0.86, y: c.y + Math.sin(a) * 0.86 });
  }
  return out;
}

function pathOf(points: readonly Point[], U: number): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${f(p.x * U)} ${f(p.y * U)}`).join("") + "Z";
}

function f(n: number): string {
  return String(Math.round(n * 10) / 10);
}

