import { HEX_DIRS, type HexCell } from "@jamrog/engine";
import type { HullForm, Pod } from "../../content/hullforms.js";
import type { HullArt, HullProfile } from "../../content/hulls-art.js";

/**
 * The ship drawn under the honeycomb, laid **under** the hexagons so that the
 * map the player reads is exactly the map, and the picture is only what shows
 * between and around the cells.
 *
 * Two ways to draw it, and which one is used is decided by the layout:
 *
 *   - **the hull first** (`formLayer`, G82): the ship is a profile of straight
 *     sections from `content/hullforms.ts`, fitted to the compartment count,
 *     and the honeycomb was grown inside it (`hexLayout`, `masked: true`).
 *     The skin is the profile's own polygons — a straight side, a real bow —
 *     and the pods, bridge, masts and plating are placed by its geometry.
 *     Ported from `experiments/hullforms/shipform.mjs`, `renderShip`;
 *   - **the cells first** (`outlineLayer`, G81): when there is no profile, or
 *     the layout could not honour it (`masked: false`), the skin is traced
 *     around the compartments the lattice laid out, straightened and offset,
 *     with the details hung off the cells. Ported from
 *     `experiments/hullforms/{shapes,hullart}.mjs`. Never removed: it is what
 *     guarantees a ship is never without a hull.
 *
 * What is different from the sandbox in either case:
 *
 *   - the game's hexagons are spread apart by `HEX_SPACING` so a corridor has
 *     somewhere to be. The skin is therefore traced around the **tiling**
 *     hexagons — the ones of radius `R × HEX_SPACING` that pack the lattice
 *     edge to edge — so it closes over the corridors instead of dipping into
 *     every gap;
 *   - nothing here draws from an rng. Every small variation of the plating is
 *     a hash of the ship's own id and the thing being decided, so two frames of
 *     one ship, and two loads of one save, draw the same rivets. The picture is
 *     a pure function of the graph, the way `hexLayout` is, and
 *     `tests/hullart.test.ts` holds it to that.
 *
 * No `document`, no `window`, no `Math.random()`: a string in, a string out.
 */

export interface Point {
  x: number;
  y: number;
}

/** A closed polygon, first point not repeated at the end. */
export type Loop = Point[];

/** What the layer needs: the cells, where each one sits, and the scale. */
export interface HullInput {
  /** Every compartment that has a cell, in any order. */
  readonly cells: readonly HexCell[];
  /** The compartment the tug docks at, when it has a cell. Breaks the bow/stern tie. */
  readonly airlock: HexCell | undefined;
  /** Axial to pixels — the renderer's own mapping, so the two cannot drift. */
  readonly at: (cell: HexCell) => Point;
  /** Circumradius of a drawn hexagon. */
  readonly R: number;
  /** How far apart neighbours sit, as a multiple of touching (`HEX_SPACING`). */
  readonly spacing: number;
  readonly art: HullArt;
  /**
   * The profile the honeycomb was grown inside, in lattice units, when the
   * layout honoured it. Absent, the skin is traced around the cells.
   */
  readonly form?: HullForm;
}

/** The drawn layer and what it covers, so the frame can be sized off it. */
export interface HullLayer {
  readonly svg: string;
  readonly box: Box;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How far the skin sits outside the tiling hexagons, in tiling radii, and the
 * straightening tolerance, in the same unit. **The two only work as a pair.**
 *
 * A "flat" side of a hexagon outline is a staircase half a radius deep, and
 * Douglas–Peucker straightens it by chording it — the chord runs at whichever
 * height its two endpoints happen to be, so in the worst case it runs along
 * the valleys and cuts half a radius into the peaks. The outset is what pays
 * for that cut. The sandbox needed 0.3 and 0.46 with hexagons that touched;
 * ours are spread apart, so the drawn hexagon sits a quarter of a radius
 * inside the tiling one already, and the tolerance can go above the staircase
 * depth — which is what makes every run straight rather than most of them.
 * Worst case, the skin still clears a drawn corner by a tenth of a radius,
 * and `tests/hullart.test.ts` checks every corner of every cell on 200 hulls.
 */
const OUTSET = 0.36;
const SIMPLIFY = 0.52;

/**
 * The layer: an SVG fragment of the hull, to be written before the hexagons.
 *
 * Empty when there is nothing to trace. A profile of `undefined` draws the
 * skin and nothing on it — a class the catalogue has not dressed still gets a
 * hull, and never a crash.
 */
export function hullLayer(input: HullInput): HullLayer {
  if (input.cells.length === 0) return { svg: "", box: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  if (input.form !== undefined && input.art.profile !== undefined) {
    return formLayer(input, input.form, input.art.profile);
  }
  return outlineLayer(input);
}

/**
 * The skin traced around the cells (G81), and the details hung off them.
 *
 * Everything the layer draws is inside its silhouette — the skin, the pods
 * and the nose — twice over: geometrically, because the plating is cut to
 * the skin's own spans and a hatch that would not fit is not drawn, and by
 * the clip on the layer, which is the same silhouette. The owner's frame had
 * a mast and a seam floating outside the hull; a mast is outside by nature,
 * so there are no masts, and a seam is cut where the hull ends.
 */
function outlineLayer(input: HullInput): HullLayer {
  const { cells, at, R, spacing, art } = input;
  const U = R * spacing;
  const seed = fnv(`${art.seed}|${cells.map(key).sort().join(";")}`);
  const uid = seed.toString(36);

  // Outset first, straighten second (the sandbox's lesson): on the raw outline
  // every edge is a full hexagon side, longer than the outset, so nothing can
  // flip; on a simplified one a short edge folds and the skin crosses itself.
  const raw = outlineLoops(cells, at, U);
  const loops = raw.map((loop) => simplify(outset(loop, U * OUTSET), U * SIMPLIFY));
  const skin = loops.map(pathOf).join(" ");
  const hull = hullOfLoops(loops);

  // The tiling hexagons' bounding box: what the pods and the plating are laid
  // out against.
  const corners = cells.flatMap((c) => tilingCorners(at(c), U));
  const box = boxOf(corners);

  // Which way is aft. Everything else — pods, nose, bridge — hangs off this one
  // decision: **the stern is the heavy end**, and the airlock only breaks a tie
  // (the sandbox's rule: read off the airlock alone, a tug got its engines on
  // the tip of its towing boom).
  const aft = aftOf(cells, at, box, input.airlock, U);
  const sternX = aft < 0 ? box.minX : box.maxX;
  const bowX = aft < 0 ? box.maxX : box.minX;

  const profile = art.profile;
  const body: string[] = [];
  const drawn: Box = { ...box };
  const silhouette: Loop[] = [...loops];

  if (profile) {
    const pods = nacelles(cells, at, box, aft, sternX, U, profile, seed, drawn);
    const wedge = nose(cells, at, box, aft, bowX, U, profile, drawn);
    body.push(pods.svg, wedge.svg);
    silhouette.push(...pods.shapes, ...wedge.shapes);
  }
  body.push(`<path class="hull-skin" d="${skin}" fill-rule="evenodd"/>`);
  if (profile) {
    body.push(plating(hull, aft, bowX, U, profile, seed));
    body.push(hatches(cells, at, U, profile, seed, hull));
    body.push(portholes(cells, at, U, profile, seed, hull));
    body.push(bridge(cells, at, box, aft, bowX, U, profile, drawn));
  }
  // The double line of the skin: a thick steel stroke overdrawn with a thin
  // dark one. An inner offset line would be simplified to different corners
  // and cross the outer one — this cannot.
  body.push(`<path class="hull-rim" d="${skin}" fill-rule="evenodd"/>`);
  body.push(`<path class="hull-rim-in" d="${skin}" fill-rule="evenodd"/>`);
  // A wash over the whole picture so the hexagons have something quiet to sit on.
  body.push(`<path class="hull-wash" d="${skin}" fill-rule="evenodd"/>`);

  for (const loop of loops) grow(drawn, loop);
  // Half a rim stroke, so the line itself is inside the frame.
  drawn.minX -= 2;
  drawn.minY -= 2;
  drawn.maxX += 2;
  drawn.maxY += 2;

  const svg = [
    `<g class="hull-art">`,
    `<defs><clipPath id="hull-clip-${uid}"><path d="${silhouette.map(pathOf).join(" ")}" fill-rule="evenodd"/></clipPath></defs>`,
    `<g clip-path="url(#hull-clip-${uid})">`,
    ...body.filter((s) => s.length > 0),
    `</g>`,
    `</g>`,
  ].join("");
  return { svg, box: drawn };
}

// ------------------------------------------------------------ the profile

/**
 * The hull drawn from its profile, the honeycomb having been grown inside it.
 *
 * The two layers do not negotiate. The hull is the shape from `shipForm`,
 * drawn with its own straight lines in the same pixel space the cells sit in
 * — the profile is in tiling radii, the cells' centres are the same lattice
 * at the same radius (`content/hullforms.ts`, "Units") — and the hexagons go
 * over it wherever the layout put them.
 *
 * Every body is filled and the holes are painted back out, so the fill is the
 * union without any polygon arithmetic. The **outline** is the part that
 * needs care: stroking each body whole draws the coupling of a train straight
 * through its boxes. So a body's rim is masked by the other bodies — what
 * falls inside a neighbour is not on the union's boundary and is not drawn —
 * and holes are punched back into the mask, because an edge along a hole
 * *is* boundary. Masks rather than a union: the geometry stays a handful of
 * polygons, and the picture stays exact.
 */
function formLayer(input: HullInput, form: HullForm, profile: HullProfile): HullLayer {
  const { cells, R, spacing, art } = input;
  const U = R * spacing;
  const seed = fnv(`${art.seed}|${form.kind}|${cells.map(key).sort().join(";")}`);
  const uid = seed.toString(36);

  const bodies = form.bodies.map((poly) => poly.map((p) => scaled(p, U)));
  const holes = form.holes.map((poly) => poly.map((p) => scaled(p, U)));
  const skins = bodies.map(pathOf);
  const cuts = holes.map(pathOf);
  // The union, for the fill and the wash: every body wound the same way and
  // filled nonzero, so an overlap counts once and a hole — wound back the
  // other way — counts against.
  const union = [...bodies.map(clockwise), ...holes.map(counterclockwise)].map(pathOf).join(" ");
  const hull = hullOfForm(bodies, holes);
  const box = boxOf(bodies.flat());
  const bowX = box.maxX;
  const drawn: Box = { ...box };

  const defs: string[] = [];
  const span = { x: box.minX - U * 4, y: box.minY - U * 4, w: box.maxX - box.minX + U * 8, h: box.maxY - box.minY + U * 8 };
  skins.forEach((_, i) => {
    const others = skins.filter((__, j) => j !== i);
    if (others.length === 0 && cuts.length === 0) return;
    defs.push(
      `<mask id="hull-rim-${uid}-${i}" maskUnits="userSpaceOnUse" x="${f(span.x)}" y="${f(span.y)}" width="${f(span.w)}" height="${f(span.h)}">` +
        `<rect x="${f(span.x)}" y="${f(span.y)}" width="${f(span.w)}" height="${f(span.h)}" fill="#fff"/>` +
        others.map((d) => `<path d="${d}" fill="#000"/>`).join("") +
        cuts.map((d) => `<path d="${d}" fill="#fff"/>`).join("") +
        `</mask>`,
    );
  });

  const pods = podsOf(form, U, profile, drawn);
  // The silhouette: the bodies and the pods, the holes cut out. What the
  // layer is clipped to, and what every mark on it is inside of.
  const silhouette = [...bodies.map(clockwise), ...pods.shapes.map(clockwise), ...holes.map(counterclockwise)];
  defs.push(`<clipPath id="hull-clip-${uid}"><path d="${silhouette.map(pathOf).join(" ")}"/></clipPath>`);

  const body: string[] = [];
  body.push(pods.svg);
  body.push(`<path class="hull-skin" d="${union}"/>`);
  body.push(plating(hull, -1, bowX, U, profile, seed));
  for (const cut of cuts) body.push(`<path class="hull-hole" d="${cut}"/>`);
  skins.forEach((skin, i) => {
    const mask = skins.length > 1 || cuts.length > 0 ? ` mask="url(#hull-rim-${uid}-${i})"` : "";
    body.push(`<g${mask}><path class="hull-rim" d="${skin}"/><path class="hull-rim-in" d="${skin}"/></g>`);
  });
  for (const cut of cuts) body.push(`<path class="hull-rim" d="${cut}"/><path class="hull-rim-in" d="${cut}"/>`);
  body.push(hatchesOn(bodies[0]!, U, profile, seed, hull));
  body.push(portholesOn(bodies[0]!, U, profile, seed, hull));
  body.push(bridgeAt(bodies[0]!, U, profile, hull));
  body.push(`<path class="hull-wash" d="${union}"/>`);

  // Half a rim stroke, so the line itself is inside the frame.
  drawn.minX -= 2;
  drawn.minY -= 2;
  drawn.maxX += 2;
  drawn.maxY += 2;

  const svg = [
    `<g class="hull-art hull-profile">`,
    `<defs>${defs.join("")}</defs>`,
    `<g clip-path="url(#hull-clip-${uid})">`,
    ...body.filter((s) => s.length > 0),
    `</g>`,
    `</g>`,
  ].join("");
  return { svg, box: drawn };
}

/** The loop wound with the hull on the right of travel — positive area in screen coordinates. */
function clockwise(loop: Loop): Loop {
  return signedAreaOf(loop) >= 0 ? loop : [...loop].reverse();
}

function counterclockwise(loop: Loop): Loop {
  return signedAreaOf(loop) <= 0 ? loop : [...loop].reverse();
}

/** The profile's polygons in pixels, for a test that wants the geometry rather than the string. */
export function formLoops(form: HullForm, U: number): { bodies: Loop[]; holes: Loop[] } {
  return {
    bodies: form.bodies.map((poly) => poly.map((p) => scaled(p, U))),
    holes: form.holes.map((poly) => poly.map((p) => scaled(p, U))),
  };
}

/** Is the point inside the union of the bodies and outside every hole? */
export function insideForm(p: Point, loops: { bodies: Loop[]; holes: Loop[] }): boolean {
  return loops.bodies.some((b) => insideLoop(p, b)) && !loops.holes.some((h) => insideLoop(p, h));
}

function scaled(p: Point, U: number): Point {
  return { x: p.x * U, y: p.y * U };
}

/**
 * The pods, as many as the class wears: none for a dock; one on the axis of
 * the first body's stern plate for a single drive; for two, the pair the
 * profile seated on every body that starts at the stern plate. Square body,
 * trapezoid bell, a wedge of flame — under the skin, so the root is buried
 * in the hull.
 */
function podsOf(form: HullForm, U: number, profile: HullProfile, drawn: Box): Drawn {
  if (profile.nacelles === 0) return NOTHING;
  if (profile.nacelles === 1) {
    const hull = form.hull;
    const first = form.pods[0];
    const w = first?.h ?? 0.95;
    const reach = first?.w ?? 3.0;
    const mid = (hull[0]!.y + hull[hull.length - 1]!.y) / 2;
    return podOf({ x: hull[0]!.x - (reach - 0.4), y: mid - w / 2, w: reach, h: w }, U, drawn);
  }
  return form.pods.map((pod) => podOf(pod, U, drawn)).reduce(join, NOTHING);
}

/** A piece of the drawing and the shapes it adds to the silhouette. */
interface Drawn {
  svg: string;
  shapes: Loop[];
}

const NOTHING: Drawn = { svg: "", shapes: [] };

function join(a: Drawn, b: Drawn): Drawn {
  return { svg: a.svg + b.svg, shapes: [...a.shapes, ...b.shapes] };
}

function podOf(unit: Pod, U: number, drawn: Box): Drawn {
  const pod = { x: unit.x * U, y: unit.y * U, w: unit.w * U, h: unit.h * U };
  const y = pod.y + pod.h / 2;
  const rect: Point[] = [
    { x: pod.x, y: pod.y },
    { x: pod.x + pod.w, y: pod.y },
    { x: pod.x + pod.w, y: pod.y + pod.h },
    { x: pod.x, y: pod.y + pod.h },
  ];
  const bell: Point[] = [
    { x: pod.x, y: y - pod.h * 0.5 },
    { x: pod.x - U * 0.42, y: y - pod.h * 0.72 },
    { x: pod.x - U * 0.42, y: y + pod.h * 0.72 },
    { x: pod.x, y: y + pod.h * 0.5 },
  ];
  const flame: Point[] = [
    { x: pod.x - U * 0.5, y: y - pod.h * 0.42 },
    { x: pod.x - U * 1.5, y },
    { x: pod.x - U * 0.5, y: y + pod.h * 0.42 },
  ];
  grow(drawn, [...bell, ...flame, ...rect]);
  const ribs = [1, 2]
    .map((i) => seg({ x: pod.x + (pod.w * i) / 3, y: pod.y }, { x: pod.x + (pod.w * i) / 3, y: pod.y + pod.h }))
    .join("");
  const svg = [
    `<g class="hull-pod">`,
    `<rect class="hull-plate" x="${f(pod.x)}" y="${f(pod.y)}" width="${f(pod.w)}" height="${f(pod.h)}"/>`,
    `<g class="hull-line" opacity="0.35">${ribs}</g>`,
    `<polygon class="hull-bell" points="${pts(bell)}"/>`,
    `<polygon class="hull-flame" points="${pts(flame)}"/>`,
    seg({ x: pod.x - U * 0.5, y }, { x: pod.x - U * 1.35, y }, "hull-line", 0.7, 2),
    `</g>`,
  ].join("");
  // The flame is a mark on the page and not a shape of the ship; the bell
  // and the body are the silhouette. A little of the bell is left around
  // the flame's root so the line that draws it is inside.
  return { svg, shapes: [rect, bell, flame] };
}

/**
 * The bridge: a chamfered block up at the bow, three lit windows forward.
 *
 * On the **first body's** nose and on that body's own centreline, not on the
 * axis at the ship's longest point: on a catamaran the axis at the bow is the
 * gap between the two hulls. Inside the skin, where the bow taper holds no
 * hexagon — a cell that does land over it is drawn over it, which is the
 * order of the layers and not a fault.
 */
function bridgeAt(hull: Loop, U: number, profile: HullProfile, inside: Hull): string {
  if (!profile.bridge) return "";
  const w = U * 1.5;
  const hh = U * 0.5;
  const bowX = Math.max(...hull.map((p) => p.x));
  const cy = (hull[0]!.y + hull[hull.length - 1]!.y) / 2;
  const cut = U * 0.25;
  // Up at the bow, and moved aft a little at a time until the whole block
  // is inside the hull — a long point holds no bridge at its tip.
  for (let back = 0; back < 8; back++) {
    const cx = bowX - U * (1.9 + back * 0.35);
    const block: Point[] = [
      { x: cx - w / 2, y: cy - hh },
      { x: cx + w / 2 - cut, y: cy - hh },
      { x: cx + w / 2, y: cy - hh + cut },
      { x: cx + w / 2, y: cy + hh - cut },
      { x: cx + w / 2 - cut, y: cy + hh },
      { x: cx - w / 2, y: cy + hh },
    ];
    if (!block.every((p) => inside.contains(p))) continue;
    const glass = [-1, 0, 1]
      .map(
        (k) =>
          `<rect class="hull-glass" x="${f(cx + w / 2 - U * 0.55)}" y="${f(cy + k * U * 0.26 - U * 0.06)}" width="${f(U * 0.28)}" height="${f(U * 0.13)}"/>`,
      )
      .join("");
    return `<g class="hull-bridge"><polygon class="hull-plate-lit hull-plate-rimmed" points="${pts(block)}"/>${glass}</g>`;
  }
  return "";
}

/**
 * A place on the profile's side: a point on the top or bottom chain of the
 * first body, and the outward unit normal there. The chains run from the
 * stern plate to the nose; `t` is the fraction of the way along.
 */
interface SideSpot {
  p: Point;
  n: Point;
}

function sideSpot(hull: Loop, t: number, side: -1 | 1): SideSpot {
  const bowX = Math.max(...hull.map((p) => p.x));
  const noseAt = hull.findIndex((p) => p.x === bowX);
  // Top chain: from the stern's top corner to the nose. Bottom chain: from the
  // nose on to the stern's bottom corner, walked back so both run bow-ward.
  const top = hull.slice(0, noseAt + 1);
  const bottom = [...hull.slice(noseAt)].reverse();
  const chain = side < 0 ? top : bottom;
  const x = chain[0]!.x + (bowX - chain[0]!.x) * t;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x) || a.x === b.x) continue;
    const k = (x - a.x) / (b.x - a.x);
    const p = { x, y: a.y + (b.y - a.y) * k };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // The outward normal: up for the top chain, down for the bottom.
    const n = side < 0 ? { x: (b.y - a.y) / len, y: -(b.x - a.x) / len } : { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    return { p, n };
  }
  const p = chain[chain.length - 1]!;
  return { p, n: { x: 0, y: side } };
}

/** Where along the side a detail goes: a hashed fraction, clear of both ends. */
function along(seed: number, salt: number, i: number): number {
  return 0.14 + hash01(seed, salt, i) * 0.66;
}

/** Hatches on the skin band: a square with a seam across it, just inside the side. */
function hatchesOn(hull: Loop, U: number, profile: HullProfile, seed: number, inside: Hull): string {
  if (profile.hatches === 0) return "";
  const r = U * 0.11;
  const out: string[] = [];
  for (let i = 0; i < profile.hatches; i++) {
    const { p, n } = sideSpot(hull, along(seed, 6, i), i % 2 === 0 ? -1 : 1);
    const c = { x: p.x - n.x * U * 0.24, y: p.y - n.y * U * 0.24 };
    if (!inside.holds(c.x - r, c.y - r, r * 2, r * 2)) continue;
    out.push(
      `<g class="hull-hatch" opacity="0.85">`,
      `<rect class="hull-deep hull-deep-rimmed" x="${f(c.x - r)}" y="${f(c.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}"/>`,
      seg({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }),
      `</g>`,
    );
  }
  return out.join("");
}

/** Portholes: pairs of lit slots along the sides, where a hab block keeps its windows. */
function portholesOn(hull: Loop, U: number, profile: HullProfile, seed: number, inside: Hull): string {
  if (profile.ports === 0) return "";
  const w = U * 0.14;
  const h = U * 0.08;
  const out: string[] = [];
  for (let i = 0; i < profile.ports; i++) {
    const { p, n } = sideSpot(hull, along(seed, 7, i), i % 2 === 0 ? -1 : 1);
    const c = { x: p.x - n.x * U * 0.16, y: p.y - n.y * U * 0.16 };
    const t = { x: -n.y, y: n.x };
    for (const k of [-1, 1]) {
      const q = { x: c.x + t.x * U * 0.12 * k, y: c.y + t.y * U * 0.12 * k };
      if (!inside.holds(q.x - w / 2, q.y - h / 2, w, h)) continue;
      out.push(`<rect class="hull-glass" x="${f(q.x - w / 2)}" y="${f(q.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 3)}"/>`);
    }
  }
  return out.join("");
}

// ------------------------------------------------------------- the hull's spans

/** An interval along one axis, `[lo, hi]`. */
type Span = [number, number];

/**
 * The hull as a region: where a vertical or a horizontal line crosses it,
 * and whether a point or a box is in it. Every mark the layer draws is cut to
 * these — a frame is a line from where the hull begins to where it ends at
 * that x, not a line across the bounding box — so nothing is emitted that
 * lies outside the skin, and the clip on the layer has nothing left to do.
 */
export interface Hull {
  atX(x: number): Span[];
  atY(y: number): Span[];
  contains(p: Point): boolean;
  /** Are all four corners of the box inside? */
  holds(x: number, y: number, w: number, h: number): boolean;
}

/** A hull bounded by loops, even-odd: the traced skin, holes as their own loops. */
export function hullOfLoops(loops: readonly Loop[]): Hull {
  const contains = (p: Point): boolean => insideLoops(p, loops);
  return {
    atX: (x) => pairUp(loops.flatMap((loop) => crossingsX(loop, x))),
    atY: (y) => pairUp(loops.flatMap((loop) => crossingsY(loop, y))),
    contains,
    holds: (x, y, w, h) => cornersOf(x, y, w, h).every(contains),
  };
}

/** A hull that is the union of bodies less the union of holes. */
export function hullOfForm(bodies: readonly Loop[], holes: readonly Loop[]): Hull {
  const contains = (p: Point): boolean => bodies.some((b) => insideLoop(p, b)) && !holes.some((h) => insideLoop(p, h));
  const spans = (cross: (loop: Loop) => number[]): Span[] =>
    subtract(merge(bodies.flatMap((b) => pairUp(cross(b)))), merge(holes.flatMap((h) => pairUp(cross(h)))));
  return {
    atX: (x) => spans((loop) => crossingsX(loop, x)),
    atY: (y) => spans((loop) => crossingsY(loop, y)),
    contains,
    holds: (x, y, w, h) => cornersOf(x, y, w, h).every(contains),
  };
}

function cornersOf(x: number, y: number, w: number, h: number): Point[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/** Where a vertical line at `x` crosses the loop's edges: the y of each crossing. */
function crossingsX(loop: Loop, x: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    if (a.x === b.x) continue;
    // Half-open, so a crossing at a vertex is counted once and not twice.
    if (x < Math.min(a.x, b.x) || x >= Math.max(a.x, b.x)) continue;
    out.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
  }
  return out;
}

function crossingsY(loop: Loop, y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    if (a.y === b.y) continue;
    if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
    out.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
  }
  return out;
}

/** Crossings into spans, even-odd: sorted and taken two at a time. */
function pairUp(crossings: number[]): Span[] {
  const sorted = [...crossings].sort((a, b) => a - b);
  const out: Span[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) out.push([sorted[i]!, sorted[i + 1]!]);
  return out;
}

/** The union of spans. */
function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([span[0], span[1]]);
  }
  return out;
}

/** Spans less other spans. */
function subtract(spans: Span[], cuts: Span[]): Span[] {
  let out = spans;
  for (const cut of cuts) {
    const next: Span[] = [];
    for (const span of out) {
      if (cut[1] <= span[0] || cut[0] >= span[1]) {
        next.push(span);
        continue;
      }
      if (cut[0] > span[0]) next.push([span[0], cut[0]]);
      if (cut[1] < span[1]) next.push([cut[1], span[1]]);
    }
    out = next;
  }
  return out;
}

// -------------------------------------------------------------- the outline
// -------------------------------------------------------------- the outline

/**
 * The outline of a set of cells, as closed loops in pixels.
 *
 * Every side of a tiling hexagon with nothing on the far side is a segment;
 * segments are stitched end to end. Each cell's sides are walked clockwise
 * around that cell, and three hexagons meet at every lattice vertex, any two of
 * them neighbours — so the boundary is consistently oriented with the hull
 * always on the right of travel, and a vertex never has more than one way on.
 * A hull with a hole in it comes back as two loops; callers fill `evenodd`.
 */
export function outlineLoops(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  U: number,
): Loop[] {
  const set = new Set(cells.map(key));
  const first = cells[0];
  if (first === undefined) return [];
  const edgeOfDir = edgesByDirection(at, first, U);

  const segs: Array<[Point, Point]> = [];
  for (const cell of cells) {
    const corners = tilingCorners(at(cell), U);
    HEX_DIRS.forEach((d, dir) => {
      if (set.has(key({ q: cell.q + d.q, r: cell.r + d.r }))) return;
      const j = edgeOfDir[dir]!;
      segs.push([corners[j]!, corners[(j + 1) % 6]!]);
    });
  }

  const stamp = (p: Point): string => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const starts = new Map<string, number[]>();
  segs.forEach((s, i) => {
    const k = stamp(s[0]);
    const list = starts.get(k);
    if (list) list.push(i);
    else starts.set(k, [i]);
  });

  const used = new Array<boolean>(segs.length).fill(false);
  const out: Loop[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const seg = segs[i]!;
    const loop: Loop = [seg[0], seg[1]];
    let cur = seg[1];
    for (;;) {
      const next = (starts.get(stamp(cur)) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = true;
      const far = segs[next]![1];
      if (stamp(far) === stamp(loop[0]!)) break;
      loop.push(far);
      cur = far;
    }
    if (loop.length >= 3) out.push(loop);
  }
  return out;
}

/**
 * Straighten a hexagon staircase into hull sides: Douglas–Peucker on a closed
 * loop. Dropping every vertex within `eps` of the chord collapses a zigzag to
 * one straight line and leaves the real corners — a pylon, a bay — alone.
 */
export function simplify(loop: Loop, eps: number): Loop {
  if (loop.length < 4) return loop;
  let start = 0;
  for (let i = 1; i < loop.length; i++) if (loop[i]!.x < loop[start]!.x) start = i;
  const chain = [...loop.slice(start), ...loop.slice(0, start)];
  chain.push(chain[0]!);

  const keep = new Array<boolean>(chain.length).fill(false);
  keep[0] = true;
  keep[chain.length - 1] = true;
  const stack: Array<[number, number]> = [[0, chain.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = away(chain[i]!, chain[a]!, chain[b]!);
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

/**
 * The same loop, `d` pixels further from the hull.
 *
 * Per-vertex normals, not a scale about the centroid — scaling pulls the nose
 * of a long hull in by a tenth of its length while barely moving its sides.
 * The loops `outlineLoops` stitches keep the hull on the right of travel, so
 * "away from the hull" is the left normal for every loop, holes included: the
 * outer loop grows and a hole shrinks, which is what a skin around a mass does.
 */
export function outset(loop: Loop, d: number): Loop {
  return loop.map((p, i) => {
    const prev = loop[(i - 1 + loop.length) % loop.length]!;
    const next = loop[(i + 1) % loop.length]!;
    const n1 = leftNormal(prev, p);
    const n2 = leftNormal(p, next);
    const nx = n1.x + n2.x;
    const ny = n1.y + n2.y;
    const len = Math.hypot(nx, ny) || 1;
    return { x: p.x + (nx / len) * d, y: p.y + (ny / len) * d };
  });
}

/** Loop to an SVG path. */
export function pathOf(loop: Loop): string {
  return loop.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ") + " Z";
}

/** Is the point inside the hull these loops bound, by the even-odd rule? */
export function insideLoops(p: Point, loops: readonly Loop[]): boolean {
  let inside = false;
  for (const loop of loops) if (insideLoop(p, loop)) inside = !inside;
  return inside;
}

function insideLoop(p: Point, poly: Loop): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Twice the signed area: positive when the hull is on the right of travel, in screen coordinates. */
export function signedAreaOf(loop: Loop): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** The loops the skin is drawn from, for a test that wants the geometry rather than the string. */
export function skinLoops(input: Pick<HullInput, "cells" | "at" | "R" | "spacing">): Loop[] {
  const U = input.R * input.spacing;
  return outlineLoops(input.cells, input.at, U).map((loop) =>
    simplify(outset(loop, U * OUTSET), U * SIMPLIFY),
  );
}

// --------------------------------------------------------------- the details

/**
 * Engine pods, drawn under the skin so they tuck into the hull: on the widest
 * column at the stern, reaching a radius past it so the bells stick out where
 * bells belong. A hull too narrow for two gets one on the axis.
 */
function nacelles(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  box: Box,
  aft: -1 | 1,
  sternX: number,
  U: number,
  profile: HullProfile,
  seed: number,
  drawn: Box,
): Drawn {
  if (profile.nacelles === 0) return NOTHING;
  const cols = new Map<number, { x: number; top: number; bottom: number }>();
  for (const cell of cells) {
    const p = at(cell);
    const k = Math.round(p.x * 4) / 4;
    const col = cols.get(k) ?? { x: p.x, top: p.y, bottom: p.y };
    col.top = Math.min(col.top, p.y);
    col.bottom = Math.max(col.bottom, p.y);
    cols.set(k, col);
  }
  // Only columns at the stern itself: a pod seated amidships and reaching past
  // the tail is a pipe laid over the ship, not an engine.
  const reach = Math.max(U * 1.2, (box.maxX - box.minX) * 0.2);
  const stern = [...cols.values()].filter((c) => Math.abs(c.x - sternX) <= reach);
  if (stern.length === 0) return NOTHING;
  const seat = stern.reduce((best, c) => (c.bottom - c.top > best.bottom - best.top ? c : best), stern[0]!);

  // Long enough that the root is buried in the hull: the pod is drawn before
  // the skin, so overlap is what makes it look attached.
  const length = U * profile.podLength * (0.94 + hash01(seed, 1) * 0.12);
  const tip = sternX + aft * U * 0.7;
  const root = tip - aft * length;
  // A pair sits either side of the stern column's middle, as far apart as the
  // column is tall and no further than a radius: on a stern one cell deep the
  // two lie side by side under the skin with only the bells showing apart, and
  // on a stern that runs the whole height of the hull they stay together
  // rather than one at each corner of the ship. One pod goes on the axis.
  const mid = (seat.top + seat.bottom) / 2;
  const spread = Math.min(U * 0.95, Math.max(U * 0.42, (seat.bottom - seat.top) / 2 + U * 0.1));
  const wide = spread > U * 0.6;
  const seats = profile.nacelles === 2 ? [mid - spread, mid + spread] : [mid];
  const w = U * (profile.nacelles === 2 ? (wide ? 0.7 : 0.58) : 0.85);

  return seats
    .map((y): Drawn => {
      const x = Math.min(root, tip);
      const front = x + (aft < 0 ? length : 0);
      const ribs: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const rx = root + (aft * (length * i)) / 4;
        ribs.push(seg({ x: rx, y: y - w / 2 }, { x: rx, y: y + w / 2 }));
      }
      const rect: Point[] = [
        { x, y: y - w / 2 },
        { x: x + length, y: y - w / 2 },
        { x: x + length, y: y + w / 2 },
        { x, y: y + w / 2 },
      ];
      // Bell and flame as straight-edged shapes: clean lines, no gradients.
      const bell: Point[] = [
        { x: tip, y: y - w * 0.5 },
        { x: tip + aft * U * 0.42, y: y - w * 0.72 },
        { x: tip + aft * U * 0.42, y: y + w * 0.72 },
        { x: tip, y: y + w * 0.5 },
      ];
      const flame: Point[] = [
        { x: tip + aft * U * 0.5, y: y - w * 0.42 },
        { x: tip + aft * U * 1.4, y },
        { x: tip + aft * U * 0.5, y: y + w * 0.42 },
      ];
      grow(drawn, [...bell, ...flame, ...rect]);
      const svg = [
        `<g class="hull-pod">`,
        `<rect class="hull-plate" x="${f(x)}" y="${f(y - w / 2)}" width="${f(length)}" height="${f(w)}"/>`,
        `<g class="hull-line" opacity="0.35">${ribs.join("")}</g>`,
        `<line class="hull-line" opacity="0.7" stroke-width="1.6" x1="${f(front)}" y1="${f(y - w / 2)}" x2="${f(front)}" y2="${f(y + w / 2)}"/>`,
        `<polygon class="hull-bell" points="${pts(bell)}"/>`,
        `<polygon class="hull-flame" points="${pts(flame)}"/>`,
        `<line class="hull-line" opacity="0.7" stroke-width="2" x1="${f(tip + aft * U * 0.45)}" y1="${f(y)}" x2="${f(tip + aft * U * 1.25)}" y2="${f(y)}"/>`,
        `</g>`,
      ].join("");
      return { svg, shapes: [rect, bell, flame] };
    })
    .reduce(join, NOTHING);
}

/**
 * A wedge past the bow, rooted under the skin: the one shape that says which
 * way a hull is pointing when the outline itself is a blob.
 */
function nose(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  box: Box,
  aft: -1 | 1,
  bowX: number,
  U: number,
  profile: HullProfile,
  drawn: Box,
): Drawn {
  if (profile.nose <= 0) return NOTHING;
  const fore: -1 | 1 = aft < 0 ? 1 : -1;
  // The cells that make the bow: their spread is the wedge's base.
  const ys = bowCells(cells, at, box, bowX, fore, U).map((p) => p.y);
  if (ys.length === 0) return NOTHING;
  const top = Math.min(...ys) - U * 0.25;
  const bottom = Math.max(...ys) + U * 0.25;
  const mid = (top + bottom) / 2;
  const root = bowX - fore * U * 0.9;
  const tipX = bowX + fore * U * profile.nose;
  const half = Math.min((bottom - top) / 2, U * 1.1);
  const wedge: Point[] = [
    { x: root, y: mid - half },
    { x: bowX + fore * U * 0.1, y: mid - half * 0.8 },
    { x: tipX, y: mid },
    { x: bowX + fore * U * 0.1, y: mid + half * 0.8 },
    { x: root, y: mid + half },
  ];
  grow(drawn, wedge);
  const svg = [
    `<g class="hull-nose">`,
    `<polygon class="hull-plate hull-plate-rimmed" points="${pts(wedge)}"/>`,
    seg({ x: bowX + fore * U * 0.1, y: mid - half * 0.8 }, { x: bowX + fore * U * 0.1, y: mid + half * 0.8 }, "hull-line", 0.5),
    `</g>`,
  ].join("");
  return { svg, shapes: [wedge] };
}

/**
 * Plating: frames across the hull, seams along it, a few panels caught in a
 * different light, a cap at each end and vents amidships — or rings, for a
 * tank. Every line runs from where the hull begins to where it ends on its
 * own row or column (`Hull`), and a vent that would not fit is not drawn.
 */
function plating(hull: Hull, aft: -1 | 1, bowX: number, U: number, profile: HullProfile, seed: number): string {
  const box = boxOfHull(hull);
  if (box === undefined) return "";
  if (profile.plating === "bare") return capsOf(hull, box, aft, bowX, U);
  const out: string[] = [];
  const h = box.maxY - box.minY;
  const w = box.maxX - box.minX;
  const across = (x: number, cls?: string, opacity?: number, width?: number): string =>
    hull.atX(x).map(([lo, hi]) => seg({ x, y: lo }, { x, y: hi }, cls, opacity, width)).join("");
  const along = (y: number): string => hull.atY(y).map(([lo, hi]) => seg({ x: lo, y }, { x: hi, y })).join("");
  if (profile.plating === "frames") {
    const frames: string[] = [];
    const panels: string[] = [];
    const step = U * 1.15;
    let i = 0;
    for (let x = box.minX + step; x < box.maxX; x += step, i++) {
      frames.push(across(x));
      if (hash01(seed, 2, i) < 0.34) panels.push(panel(hull, x, Math.min(x + step, box.maxX)));
    }
    out.push(panels.join(""));
    out.push(`<g class="hull-line" opacity="0.3">${frames.join("")}</g>`);
    const seams = [0.3, 0.7].map((t) => along(box.minY + h * t)).join("");
    out.push(`<g class="hull-line" opacity="0.18">${seams}</g>`);
  } else {
    // Tanks: rings around the hull, close together, and one long seam.
    const rings: string[] = [];
    const step = U * 0.62;
    let i = 0;
    for (let x = box.minX + step * 0.5; x < box.maxX; x += step, i++) {
      rings.push(across(x));
      if (i % 3 === 1) rings.push(across(x + 4));
    }
    out.push(`<g class="hull-line" opacity="0.26">${rings.join("")}</g>`);
    out.push(`<g class="hull-line" opacity="0.2">${along(box.minY + h * 0.5)}</g>`);
  }
  out.push(capsOf(hull, box, aft, bowX, U));

  // Vents and radiators along the middle, where a ship keeps its machinery.
  const vents: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x = box.minX + w * (0.15 + hash01(seed, 3, i) * 0.7);
    const y = box.minY + h * (0.35 + hash01(seed, 4, i) * 0.3);
    const vw = U * (0.4 + hash01(seed, 5, i) * 0.5);
    if (!hull.holds(x, y, vw, U * 0.16)) continue;
    vents.push(`<rect class="hull-deep" opacity="0.5" x="${f(x)}" y="${f(y)}" width="${f(vw)}" height="${f(U * 0.16)}"/>`);
  }
  out.push(vents.join(""));
  return out.join("");
}

/**
 * A panel in a different light between two frames: as tall as the hull is
 * at both of its edges, which on a straight side is the whole side and on a
 * slant the shorter of the two.
 */
function panel(hull: Hull, x0: number, x1: number): string {
  const out: string[] = [];
  for (const [lo0, hi0] of hull.atX(x0)) {
    for (const [lo1, hi1] of hull.atX(x1 - 0.01)) {
      const lo = Math.max(lo0, lo1);
      const hi = Math.min(hi0, hi1);
      if (hi - lo < 1) continue;
      out.push(`<rect class="hull-light" x="${f(x0)}" y="${f(lo)}" width="${f(x1 - x0)}" height="${f(hi - lo)}"/>`);
    }
  }
  return out.join("");
}

/** Bow and stern caps: the end sections, in a slightly different light. */
function capsOf(hull: Hull, box: Box, aft: -1 | 1, bowX: number, U: number): string {
  const capX = bowX + aft * U * 1.7;
  const sternCapX = (aft < 0 ? box.minX : box.maxX) - aft * U * 1.4;
  const across = (x: number, opacity: number): string =>
    hull.atX(x).map(([lo, hi]) => seg({ x, y: lo }, { x, y: hi }, "hull-line", opacity, 1.4)).join("");
  return [
    panel(hull, Math.min(capX, bowX), Math.max(capX, bowX)),
    across(capX, 0.4),
    across(sternCapX, 0.35),
  ].join("");
}

/** The bounding box of a hull, off its own spans; nothing for a hull with no extent. */
function boxOfHull(hull: Hull): Box | undefined {
  // The extent is read off the spans at a fine step: cheap, and exact enough
  // for where the frames start and stop.
  const probe: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let x = -4000; x <= 4000; x += 2) {
    const spans = hull.atX(x);
    if (spans.length === 0) continue;
    probe.minX = Math.min(probe.minX, x);
    probe.maxX = Math.max(probe.maxX, x);
    for (const [lo, hi] of spans) {
      probe.minY = Math.min(probe.minY, lo);
      probe.maxY = Math.max(probe.maxY, hi);
    }
  }
  return Number.isFinite(probe.minX) ? probe : undefined;
}

/**
 * Hatches on the skin band: a square with a seam across it, on the outside of
 * a rim cell, in the band between the hexagon and the skin — the one place on
 * the hull the hexagons never cover.
 */
function hatches(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  U: number,
  profile: HullProfile,
  seed: number,
  hull: Hull,
): string {
  if (profile.hatches === 0) return "";
  const spots = rimSpots(cells, at, U).filter((s) => Math.abs(s.n.y) > 0.4 || Math.abs(s.n.x) > 0.9);
  const picked = pick(spots, profile.hatches, (s) => hash01(seed, 6, s.cell.q, s.cell.r, s.dir));
  const r = U * 0.11;
  return picked
    .filter(({ p }) => hull.holds(p.x - r, p.y - r, r * 2, r * 2))
    .map(({ p }) => [
      `<g class="hull-hatch" opacity="0.85">`,
      `<rect class="hull-deep hull-deep-rimmed" x="${f(p.x - r)}" y="${f(p.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}"/>`,
      seg({ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }),
      `</g>`,
    ].join(""))
    .join("");
}

/** Portholes: small lit slots along the rim, where a hab block keeps its windows. */
function portholes(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  U: number,
  profile: HullProfile,
  seed: number,
  hull: Hull,
): string {
  if (profile.ports === 0) return "";
  const spots = rimSpots(cells, at, U).filter((s) => Math.abs(s.n.y) > 0.4);
  const picked = pick(spots, profile.ports, (s) => hash01(seed, 7, s.cell.q, s.cell.r, s.dir));
  const w = U * 0.14;
  const h = U * 0.08;
  return picked
    .map(({ p, n }) => {
      // Two slots side by side along the edge, which reads as a window row.
      const t = { x: -n.y, y: n.x };
      return [-1, 1]
        .map((k) => {
          const c = { x: p.x + t.x * U * 0.12 * k, y: p.y + t.y * U * 0.12 * k };
          if (!hull.holds(c.x - w / 2, c.y - h / 2, w, h)) return "";
          return `<rect class="hull-glass" x="${f(c.x - w / 2)}" y="${f(c.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 3)}"/>`;
        })
        .join("");
    })
    .join("");
}

/**
 * The bridge: a chamfered block astride the bow plate with three lit windows
 * facing forward. Astride rather than inside, because inside the skin there is
 * a hexagon over everything and nobody would ever see it.
 */
function bridge(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  box: Box,
  aft: -1 | 1,
  bowX: number,
  U: number,
  profile: HullProfile,
  drawn: Box,
): string {
  if (!profile.bridge) return "";
  const fore: -1 | 1 = aft < 0 ? 1 : -1;
  const w = U * 0.95;
  const h = U * 0.62;
  // On the bow cells' own centreline, not the whole hull's: a hull whose bow
  // is off the axis had its bridge floating in open space beside it.
  const cy = bowLine(cells, at, box, bowX, fore, U);
  const back = bowX - fore * U * 0.45;
  const front = back + fore * w;
  const cut = U * 0.16;
  const block: Point[] = [
    { x: back, y: cy - h / 2 },
    { x: front - fore * cut, y: cy - h / 2 },
    { x: front, y: cy - h / 2 + cut },
    { x: front, y: cy + h / 2 - cut },
    { x: front - fore * cut, y: cy + h / 2 },
    { x: back, y: cy + h / 2 },
  ];
  grow(drawn, block);
  const glass = [-1, 0, 1]
    .map((k) => {
      const x = front - fore * U * 0.3;
      return `<rect class="hull-glass" x="${f(Math.min(x, x + fore * U * 0.18))}" y="${f(cy + k * U * 0.17 - U * 0.045)}" width="${f(U * 0.18)}" height="${f(U * 0.09)}"/>`;
    })
    .join("");
  return `<g class="hull-bridge"><polygon class="hull-plate-lit hull-plate-rimmed" points="${pts(block)}"/>${glass}</g>`;
}

// ---------------------------------------------------------------- geometry

/**
 * Which end is aft: the heavy one. Cells in the outer third of the length are
 * counted on each side, and only a tie is settled by the airlock — on the side
 * the tug docks, which is the plate you dock against.
 */
function aftOf(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  box: Box,
  airlock: HexCell | undefined,
  U: number,
): -1 | 1 {
  const band = Math.max((box.maxX - box.minX) * 0.32, U);
  let west = 0;
  let east = 0;
  for (const cell of cells) {
    const x = at(cell).x;
    if (x < box.minX + band) west++;
    if (x > box.maxX - band) east++;
  }
  const tilt = west - east;
  if (Math.abs(tilt) > 1) return tilt > 0 ? -1 : 1;
  const dock = airlock === undefined ? undefined : at(airlock).x;
  if (dock === undefined) return -1;
  return dock < (box.minX + box.maxX) / 2 ? -1 : 1;
}

/** The centres of the cells in the bow's own column, or the nearest one to it. */
function bowCells(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  box: Box,
  bowX: number,
  fore: -1 | 1,
  U: number,
): Point[] {
  const reach = Math.max(U * 1.2, (box.maxX - box.minX) * 0.2);
  const edge = bowX - fore * U * 0.87;
  return cells.map(at).filter((p) => Math.abs(p.x - edge) <= reach);
}

/** The bow's own centreline: the middle of the cells that make it. */
function bowLine(
  cells: readonly HexCell[],
  at: (cell: HexCell) => Point,
  box: Box,
  bowX: number,
  fore: -1 | 1,
  U: number,
): number {
  const ys = bowCells(cells, at, box, bowX, fore, U).map((p) => p.y);
  if (ys.length === 0) return (box.minY + box.maxY) / 2;
  return (Math.min(...ys) + Math.max(...ys)) / 2;
}

/** A place on the rim: an outward-facing side of a cell, and where its middle is on the skin band. */
interface RimSpot {
  cell: HexCell;
  dir: number;
  /** The middle of the band between the drawn hexagon and the skin. */
  p: Point;
  /** Outward unit normal. */
  n: Point;
}

function rimSpots(cells: readonly HexCell[], at: (cell: HexCell) => Point, U: number): RimSpot[] {
  const set = new Set(cells.map(key));
  const out: RimSpot[] = [];
  const first = cells[0];
  if (first === undefined) return out;
  const edgeOfDir = edgesByDirection(at, first, U);
  for (const cell of cells) {
    const c = at(cell);
    const corners = tilingCorners(c, U);
    HEX_DIRS.forEach((d, dir) => {
      if (set.has(key({ q: cell.q + d.q, r: cell.r + d.r }))) return;
      const j = edgeOfDir[dir]!;
      const a = corners[j]!;
      const b = corners[(j + 1) % 6]!;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nx = mid.x - c.x;
      const ny = mid.y - c.y;
      const len = Math.hypot(nx, ny) || 1;
      const n = { x: nx / len, y: ny / len };
      // The band runs from the tiling edge out to the skin; its middle is half
      // the outset past the edge.
      const p = { x: mid.x + n.x * U * OUTSET * 0.5, y: mid.y + n.y * U * OUTSET * 0.5 };
      out.push({ cell, dir, p, n });
    });
  }
  return out;
}

/** The first `n` of a list by a deterministic score — the hash of what each one is. */
function pick<T>(list: readonly T[], n: number, score: (item: T) => number): T[] {
  return [...list]
    .map((item) => ({ item, score: score(item) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((x) => x.item);
}

/** The six corners of a tiling hexagon, clockwise from the top: the renderer's own order. */
export function tilingCorners(c: Point, U: number): Point[] {
  const half = (Math.sqrt(3) / 2) * U;
  return [
    { x: c.x, y: c.y - U },
    { x: c.x + half, y: c.y - U / 2 },
    { x: c.x + half, y: c.y + U / 2 },
    { x: c.x, y: c.y + U },
    { x: c.x - half, y: c.y + U / 2 },
    { x: c.x - half, y: c.y - U / 2 },
  ];
}

/**
 * Which corner-to-corner edge faces each of the six neighbours, worked out
 * numerically from the renderer's own mapping rather than written down: the
 * edge whose midpoint points the way the neighbour's centre does.
 */
function edgesByDirection(at: (cell: HexCell) => Point, sample: HexCell, U: number): number[] {
  const c = at(sample);
  const corners = tilingCorners(c, U);
  return HEX_DIRS.map((d) => {
    const far = at({ q: sample.q + d.q, r: sample.r + d.r });
    const tx = far.x - c.x;
    const ty = far.y - c.y;
    let best = 0;
    let bestDot = -Infinity;
    for (let j = 0; j < 6; j++) {
      const a = corners[j]!;
      const b = corners[(j + 1) % 6]!;
      const dot = ((a.x + b.x) / 2 - c.x) * tx + ((a.y + b.y) / 2 - c.y) * ty;
      if (dot > bestDot) {
        bestDot = dot;
        best = j;
      }
    }
    return best;
  });
}

function leftNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dy / len, y: -dx / len };
}

function away(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function boxOf(points: readonly Point[]): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  grow(box, points);
  return box;
}

function grow(box: Box, points: readonly Point[]): void {
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxY = Math.max(box.maxY, p.y);
  }
}

function key(cell: HexCell): string {
  return `${cell.q},${cell.r}`;
}

// -------------------------------------------------------------------- bits

function seg(p: Point, q: Point, cls?: string, opacity?: number, width?: number): string {
  const c = cls === undefined ? "" : ` class="${cls}"`;
  const o = opacity === undefined ? "" : ` opacity="${opacity}"`;
  const w = width === undefined ? "" : ` stroke-width="${width}"`;
  return `<line${c}${o}${w} x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}"/>`;
}

function pts(list: readonly Point[]): string {
  return list.map((p) => `${f(p.x)},${f(p.y)}`).join(" ");
}

function f(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------- the hash

/** FNV-1a over a string: the ship's id and its cells, into 32 bits. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A number in [0, 1) that depends on the seed and on what is being decided —
 * a salt for the kind of thing, and the coordinates of the thing itself — and
 * on nothing else. Not a stream: there is no order to consume it in, so no
 * detail can move because another detail was added before it.
 */
function hash01(seed: number, ...parts: number[]): number {
  let h = seed >>> 0;
  for (const part of parts) {
    h ^= Math.imul((part | 0) + 0x9e3779b9, 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
