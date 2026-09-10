/**
 * The ship first, the hexagons after.
 *
 * Everything else in this sandbox works the other way round — hexagons are laid
 * out and the hull is traced around them — and that is exactly what the owner
 * rejected: «не надо "обтекать" хексы, просто хексы внутри формы корабля». A
 * hull traced around a honeycomb has hexagon geometry in it, so its sides come
 * out at 30 and 60 degrees, and every ship looks like it was cut from the same
 * lattice. It also cannot have a straight side, which is the first thing a
 * drawn ship has.
 *
 * So here the hull is a shape in its own right: one or more bodies, each a
 * profile of straight sections along the axis, with holes cut back out of them.
 * Then hexagons are dropped in and the ones lying wholly inside the union are
 * kept. Where a hexagon does not fit — the taper of the bow, the corners of the
 * stern — nothing is kept, and the gap stays a gap. That was allowed in as many
 * words: «пустые куски / заваленные пустые пространства это нормально».
 */

import { hexCentre, hexCorners, hexKey, mulberry32, EDGE_OF_DIR, HEX_DIRS } from "./hexgrid.mjs";
import { deckFromCells } from "./generate.mjs";
import { extentOf } from "./shapes.mjs";
import { PALETTE } from "./render.mjs";

// Three levels of tone and no fewer — `PALETTE.bg` under the ship, `PALETTE.hull`
// for its mass, `plate` for anything sitting on that mass. The hull used to be
// filled a shade off the background, which left the ship an outline over
// nothing and swallowed every frame and seam drawn inside it.
const INK = {
  plate: PALETTE.plate,
  plateLit: "#33414d",
  deep: "#080b0e",
  skin: "#8fa8b6",
};

/**
 * How many compartments a size is supposed to come out at.
 *
 * The profile says what shape a ship is; the size says how much of it there is.
 * They are kept apart on purpose: the same list of sections drawn bigger is the
 * same ship with more rooms in it, so twenty shapes and three sizes are twenty
 * numbers and three, not sixty.
 */
export const SIZES = {
  small: [6, 8],
  medium: [10, 14],
  large: [16, 24],
};

/**
 * Hull profiles, in hexagon radii: `[length, top half-height, bottom]` per
 * section, from the stern plate forward, with `bottom` defaulting to `top`.
 * Straight lines between them — so a side is horizontal where two sections
 * share a height and slanted only where the hull actually changes width.
 *
 * The third number buys asymmetry: the belly of a whaler, the flat bottom of a
 * barge, the mouth of a miner's scoop.
 *
 * **`bodies` is what buys a shape at all.** One profile, however many numbers
 * its sections carry, is one convex-ish lump — and twenty of those came out as
 * twenty sausages with engines, which is exactly what the owner said when he
 * put them next to the mask maps: «эти интереснее». What makes the mask maps
 * interesting is that a catamaran is two hulls, a cross is a hull and a
 * cross-piece, a train is three sections and their couplings, and a ring
 * station is a hull with a hole in it. So a class may list several bodies, each
 * a profile of its own with `dx`/`dy` off the spine, and `holes` that are cut
 * back out. Cells are kept inside the union; the outline is the union's border.
 *
 * The rule the sandbox keeps learning: **a silhouette lives on two or three
 * masses of different size**, never on an interesting edge.
 */
export const CLASSES = {
  // --- малые: 6–8 отсеков ------------------------------------------------
  needle: {
    name: "Игла-разведчик",
    size: "small",
    stern: 1.2,
    sections: [
      [1.2, 1.4],
      [3.0, 1.5],
      [3.0, 1.4],
      [2.4, 1.1],
      [1.6, 0.6],
      [0.8, 0.15],
    ],
  },
  wedge: {
    name: "Челнок-клин",
    size: "small",
    stern: 2.6,
    sections: [
      [1.2, 2.6],
      [2.2, 2.2],
      [2.2, 1.7],
      [1.8, 1.1],
      [1.0, 0.4],
    ],
  },
  hammerboat: {
    name: "Катер-молот",
    size: "small",
    stern: 2.4,
    sections: [
      [1.4, 2.4],
      [1.4, 2.4],
      [1.0, 1.0],
      [3.0, 0.7],
      [1.2, 0.5],
      [0.6, 0.2],
    ],
  },
  teardrop: {
    name: "Зонд-капля",
    size: "small",
    stern: 1.0,
    sections: [
      [1.0, 1.8],
      [1.8, 2.3],
      [2.0, 2.2],
      [1.8, 1.6],
      [1.2, 0.8],
      [0.6, 0.2],
    ],
  },
  outrigger: {
    name: "Катер с балансиром",
    size: "small",
    bodies: [
      {
        stern: 1.6,
        sections: [
          [1.2, 1.8],
          [3.0, 1.9],
          [2.4, 1.6],
          [1.4, 0.9],
          [0.8, 0.25],
        ],
      },
      { dx: 1.4, dy: -2.6, stern: 1.2, sections: [[4.2, 1.4], [1.2, 0.5]] },
    ],
  },
  forkboat: {
    name: "Развозчик-вилка",
    size: "small",
    bodies: [
      { stern: 1.5, sections: [[1.2, 1.6], [3.2, 1.8], [1.2, 1.8]], blunt: true },
      { dx: 4.0, dy: -1.7, stern: 1.5, sections: [[3.0, 1.5], [1.0, 0.4]] },
      { dx: 4.0, dy: 1.7, stern: 1.5, sections: [[3.0, 1.5], [1.0, 0.4]] },
    ],
  },

  // --- средние: 10–14 отсеков --------------------------------------------
  tug: {
    name: "Буксир-молот",
    size: "medium",
    stern: 3.2,
    sections: [
      [1.4, 3.6],
      [2.8, 3.6],
      [1.6, 2.0],
      [5.0, 1.1],
      [3.0, 1.1],
      [1.6, 1.1],
      [1.0, 0.7],
    ],
  },
  cruiser: {
    name: "Крейсер-стрела",
    size: "medium",
    stern: 3.4,
    sections: [
      [1.4, 3.6],
      [2.6, 3.2],
      [3.2, 2.6],
      [3.6, 2.0],
      [3.0, 1.3],
      [2.0, 0.6],
      [1.2, 0.18],
    ],
  },
  harpoon: {
    name: "Корвет-гарпун",
    size: "medium",
    stern: 2.2,
    sections: [
      [1.2, 2.8],
      [2.0, 3.0],
      [1.6, 1.6],
      [4.0, 1.2],
      [3.0, 1.0],
      [1.6, 0.5],
      [0.9, 0.15],
    ],
  },
  whale: {
    name: "Китобой",
    size: "medium",
    stern: 2.0,
    sections: [
      [1.4, 2.2, 2.6],
      [2.6, 2.4, 3.4],
      [3.0, 2.4, 3.4],
      [2.6, 2.0, 2.4],
      [2.0, 1.4, 1.4],
      [1.2, 0.6, 0.6],
    ],
  },
  spindle: {
    name: "Курьер-веретено",
    size: "medium",
    stern: 0.9,
    sections: [
      [1.6, 1.8],
      [2.4, 2.6],
      [3.0, 2.6],
      [2.6, 2.0],
      [2.0, 1.2],
      [1.2, 0.4],
    ],
  },
  cross: {
    name: "Госпиталь-крест",
    size: "medium",
    bodies: [
      {
        stern: 1.7,
        sections: [
          [1.4, 1.8],
          [3.0, 1.9],
          [3.0, 1.9],
          [2.2, 1.6],
          [1.2, 0.5],
        ],
      },
      { dx: 3.4, dy: 0, stern: 4.4, sections: [[2.8, 4.4]], blunt: true },
    ],
  },
  trident: {
    name: "Трезубец",
    size: "medium",
    bodies: [
      { stern: 2.6, sections: [[1.2, 2.8], [3.2, 3.0], [1.4, 3.0]], blunt: true },
      { dx: 5.0, dy: 0, stern: 1.3, sections: [[4.2, 1.3], [1.2, 0.4]] },
      { dx: 4.6, dy: -2.4, stern: 1.3, sections: [[3.6, 1.3], [1.0, 0.35]] },
      { dx: 4.6, dy: 2.4, stern: 1.3, sections: [[3.6, 1.3], [1.0, 0.35]] },
    ],
  },

  // --- большие: 16–24 отсека ---------------------------------------------
  tanker: {
    name: "Танкер-сигара",
    size: "large",
    stern: 1.7,
    sections: [
      [1.6, 2.4],
      [3.4, 3.2],
      [4.2, 3.2],
      [3.2, 2.9],
      [2.4, 1.9],
      [1.6, 0.9],
      [0.9, 0.25],
    ],
  },
  bargetrain: {
    name: "Балкер-состав",
    size: "large",
    bodies: [
      { stern: 2.6, sections: [[1.0, 2.8], [3.0, 2.8]], blunt: true },
      { dx: 3.6, dy: 0, stern: 1.1, sections: [[1.6, 1.1]], blunt: true },
      { dx: 4.8, dy: 0, stern: 2.8, sections: [[3.4, 2.8]], blunt: true },
      { dx: 7.9, dy: 0, stern: 1.1, sections: [[1.6, 1.1]], blunt: true },
      { dx: 9.1, dy: 0, stern: 2.8, sections: [[3.0, 2.8], [1.4, 2.0], [0.9, 0.5]] },
    ],
  },
  drydock: {
    name: "Стапель-лестница",
    size: "large",
    stern: 3.2,
    sections: [
      [2.4, 3.2, 3.2],
      [0.5, 3.2, 1.5],
      [2.8, 3.2, 1.5],
      [0.5, 3.2, 3.2],
      [2.6, 3.2, 3.2],
      [1.8, 2.4, 2.4],
      [1.0, 0.8, 0.8],
    ],
  },
  dreadnought: {
    name: "Дредноут-клин",
    size: "large",
    stern: 4.2,
    sections: [
      [1.6, 4.4],
      [3.0, 4.0],
      [3.4, 3.4],
      [3.4, 2.6],
      [2.8, 1.8],
      [1.8, 0.9],
      [1.0, 0.2],
    ],
  },
  scoop: {
    name: "Рудокоп-ковш",
    size: "large",
    stern: 2.4,
    sections: [
      [1.4, 2.8, 2.4],
      [3.0, 3.0, 2.4],
      [0.5, 3.0, 3.8],
      [3.4, 3.0, 3.8],
      [2.2, 2.4, 2.6],
      [1.6, 1.4, 1.4],
      [0.9, 0.4, 0.4],
    ],
  },
  catamaran: {
    name: "Катамаран",
    size: "large",
    bodies: [
      {
        dy: -3.0,
        stern: 1.5,
        sections: [
          [1.4, 1.6],
          [3.6, 1.8],
          [3.6, 1.8],
          [2.6, 1.5],
          [1.6, 0.9],
          [0.8, 0.25],
        ],
      },
      {
        dy: 3.0,
        stern: 1.5,
        sections: [
          [1.4, 1.6],
          [3.6, 1.8],
          [3.6, 1.8],
          [2.6, 1.5],
          [1.6, 0.9],
          [0.8, 0.25],
        ],
      },
      { dx: 3.6, dy: 0, stern: 3.6, sections: [[3.4, 3.6]], blunt: true },
    ],
  },
  ringstation: {
    name: "Кольцевая станция",
    size: "large",
    bodies: [
      {
        stern: 4.4,
        sections: [
          [1.6, 4.9],
          [3.4, 5.1],
          [3.4, 5.1],
          [1.6, 4.7],
          [1.0, 3.6],
        ],
        blunt: true,
      },
    ],
    holes: [{ dx: 2.4, dy: 0, stern: 2.5, sections: [[1.2, 2.7], [2.6, 2.7], [1.2, 2.3]], blunt: true }],
  },
};

/**
 * One hull, in pixels. Deterministic from `(class, seed)`: the sections keep
 * their shape and take a tenth either way, so two seeds of one class are two
 * ships of that class and not two different ships.
 */
export function shipForm(kind, seed, R, scale = 1.45) {
  // `scale` is the hull's size in hexagons, not its size on screen: a bigger
  // hull at the same hexagon radius simply holds more compartments. Six-corner
  // fitting costs a border band of about one hexagon all round, so a hull drawn
  // at 1.0 came out with six rooms in it.
  const spec = CLASSES[kind];
  const rng = mulberry32((seed * 40503) >>> 0);
  const jitter = () => 0.9 + rng() * 0.2;

  const parts = spec.bodies ?? [spec];
  const bodies = parts.map((part) => bodyOf(part, R, scale, jitter));
  const holes = (spec.holes ?? []).map((part) => bodyOf(part, R, scale, jitter));

  // Engines go on **every body that starts at the stern plate**, which is the
  // difference between a catamaran and a catamaran with one engine. A prong, a
  // coupling or a cross-piece starts further forward and gets none.
  const pods = parts.flatMap((part, i) => ((part.dx ?? 0) === 0 ? podsOf(bodies[i], R, rng) : []));

  // The first body is the hull proper: the bridge sits near its nose.
  const hull = bodies[0];
  const sternHalf = Math.abs(hull[0].y);
  const all = bodies.flat();
  const length = Math.max(...all.map((p) => p.x));
  const halfMax = Math.max(...all.map((p) => Math.abs(p.y)));
  return { kind, name: spec.name, size: spec.size, seed, hull, bodies, holes, pods, R, length, sternHalf, halfMax };
}

/**
 * One body of a hull, as a closed polygon.
 *
 * `dx`/`dy` move it off the spine, which is the whole point of having more than
 * one: a catamaran is two of these side by side, a trident is a stem and three
 * prongs, a barge train is three sections and the couplings between them.
 */
function bodyOf(part, R, scale, jitter) {
  const k = R * scale;
  const dx = (part.dx ?? 0) * k;
  const dy = (part.dy ?? 0) * k;
  const sternTop = Array.isArray(part.stern) ? part.stern[0] : part.stern;
  const sternBottom = Array.isArray(part.stern) ? part.stern[1] : part.stern;

  const top = [];
  const bottom = [];
  let x = 0;
  top.push({ x, y: -sternTop * k * jitter() });
  bottom.push({ x, y: sternBottom * k * jitter() });
  for (const [len, height, under] of part.sections) {
    x += len * k * jitter();
    top.push({ x, y: -height * k * jitter() });
    bottom.push({ x, y: (under ?? height) * k * jitter() });
  }
  // Top and bottom share their x positions, so the two sides always meet at the
  // stern plate and at the nose however far apart their heights run. A body
  // ending on a blunt face rather than a point just keeps its last two corners.
  const nose = part.blunt === true ? [] : [{ x, y: 0 }];
  return [...top, ...nose, ...[...bottom].reverse()].map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * The scale at which a class comes out at the compartment count its size asks
 * for, found by halving the interval.
 *
 * Rooms grow with the area of the hull and the profile is fixed, so the count
 * rises monotonically with scale and eight steps land inside a band three rooms
 * wide. Doing it by hand would mean twenty numbers to retune every time the
 * hexagon radius or the compartment size changed; this way the data says
 * «large» and the number follows.
 */
export function fitScale(kind, seed, R) {
  const [lo, hi] = SIZES[CLASSES[kind].size];
  const want = (lo + hi) / 2;
  let a = 0.6;
  let b = 3.4;
  let best = { scale: 1.45, rooms: 0 };
  for (let i = 0; i < 9; i++) {
    const scale = (a + b) / 2;
    const rooms = roomsAt(kind, seed, R, scale);
    if (Math.abs(rooms - want) < Math.abs(best.rooms - want)) best = { scale, rooms };
    if (rooms < want) a = scale;
    else b = scale;
  }
  return best.scale;
}

function roomsAt(kind, seed, R, scale) {
  const form = shipForm(kind, seed, R, scale);
  const cells = cellsInside(form);
  if (cells.length === 0) return 0;
  return deckFromCells(cells, seed).compartments.length;
}

/**
 * Engine pods on the stern plate: two, above and below the axis, unless the
 * stern is too narrow to hold them apart.
 */
function podsOf(body, R, rng) {
  // The stern plate is the body's own first and last corner, so a hull sitting
  // off the spine gets its engines on itself rather than on the axis.
  const top = body[0];
  const bottom = body[body.length - 1];
  const half = (bottom.y - top.y) / 2;
  const mid = (bottom.y + top.y) / 2;
  const w = R * 0.95;
  const len = R * (2.2 + rng() * 0.8);
  const seats = half >= R * 1.5 ? [mid - half + w * 0.55, mid + half - w * 0.55] : [mid];
  return seats.map((y) => ({ x: top.x - len, y: y - w / 2, w: len + R * 0.4, h: w }));
}

/**
 * The hexagons that fit inside the hull: **all six corners in**, not just the
 * centre. Keeping a hexagon by its centre leaves half of it hanging over the
 * side, and the map spills out of the ship. Six corners means the grid stops a
 * little short of the plating and the bow taper holds nothing at all — which is
 * the point: the gaps are allowed to be gaps.
 */
export function cellsInside(form) {
  const R = form.R;
  const out = [];
  const maxQ = Math.ceil(form.length / (Math.sqrt(3) * R)) + 3;
  const maxR = Math.ceil((form.halfMax * 2) / (1.5 * R)) + 3;
  // A corner counts as inside if **any** body holds it and **no** hole does:
  // that is the union of the bodies, which is what a hull of several sections
  // is. Testing the first body alone would drop every outrigger and prong.
  const held = (p) => form.bodies.some((b) => inside(p, b)) && !form.holes.some((h) => inside(p, h));
  for (let r = -maxR; r <= maxR; r++) {
    for (let q = -maxQ; q <= maxQ * 2; q++) {
      const c = hexCentre({ q, r });
      const p = { x: c.x * R, y: c.y * R };
      const fits = hexCorners({ q, r }).every((corner) => held({ x: corner.x * R, y: corner.y * R }));
      if (!fits) continue;
      out.push({ q, r, keel: Math.abs(p.y) < R * 0.9, airlock: false });
    }
  }
  if (out.length > 0) {
    // The airlock goes on the aftmost cell: that is the plate you dock against.
    const stern = out.reduce((best, c) => (hexCentre(c).x < hexCentre(best).x ? c : best), out[0]);
    stern.airlock = true;
    stern.keel = false;
  }
  return out;
}

function inside(p, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Draw it: the hull as a picture, then the hexagons inside it.
 *
 * The two layers do not negotiate. The hull is the shape from `shipForm`, drawn
 * with its own straight lines; the hexagons are the ones that fitted, drawn as
 * the grid they are, walls between compartments heavier than seams inside one.
 */
export function renderShip(form, deck, { uid = "ship" } = {}) {
  const R = form.R;
  const rng = mulberry32((form.seed * 2654435761) >>> 0);
  // Every body is filled in turn and the holes are painted back out, so the
  // fill is the union without any polygon arithmetic.
  //
  // The **outline** is the part that needs care. Stroking each body whole drew
  // the cross-piece of a cross and the coupling of a train straight through the
  // hull, and the ship read as a box laid over a box. So a body's outline is
  // masked by the other bodies: what falls inside a neighbour is not on the
  // union's boundary and is not drawn. Holes are punched back into the mask,
  // because an edge running along a hole *is* boundary. Masks rather than a
  // union: the geometry stays five polygons, and the picture stays exact.
  const skins = form.bodies.map(path);
  const holes = form.holes.map(path);
  const clip = [...skins, ...holes].join(" ");
  const span = bandOf(form, R);

  const defs = [`<clipPath id="skin-${uid}"><path d="${clip}" fill-rule="evenodd" /></clipPath>`];
  skins.forEach((_, i) => {
    const others = skins.filter((__, j) => j !== i);
    if (others.length === 0 && holes.length === 0) return;
    defs.push(
      `<mask id="rim-${uid}-${i}" maskUnits="userSpaceOnUse" ` +
        `x="${f(span.x)}" y="${f(span.y)}" width="${f(span.w)}" height="${f(span.h)}">` +
        `<rect x="${f(span.x)}" y="${f(span.y)}" width="${f(span.w)}" height="${f(span.h)}" fill="#fff" />` +
        others.map((d) => `<path d="${d}" fill="#000" />`).join("") +
        holes.map((d) => `<path d="${d}" fill="#fff" />`).join("") +
        `</mask>`,
    );
  });

  const body = [];
  for (const pod of form.pods) body.push(podOf(pod, R));
  for (const skin of skins) body.push(`<path d="${skin}" fill="${PALETTE.hull}" />`);
  body.push(`<g clip-path="url(#skin-${uid})">${plating(form, R, rng)}</g>`);
  for (const hole of holes) body.push(`<path d="${hole}" fill="${PALETTE.bg}" />`);
  skins.forEach((skin, i) => {
    const mask = skins.length > 1 || holes.length > 0 ? ` mask="url(#rim-${uid}-${i})"` : "";
    body.push(`<g${mask}><path d="${skin}" fill="none" stroke="${INK.skin}" stroke-width="3" stroke-linejoin="miter" />` +
      `<path d="${skin}" fill="none" stroke="${PALETTE.bg}" stroke-width="1" stroke-linejoin="miter" /></g>`);
  });
  for (const hole of holes) {
    body.push(`<path d="${hole}" fill="none" stroke="${INK.skin}" stroke-width="3" stroke-linejoin="miter" />`);
    body.push(`<path d="${hole}" fill="none" stroke="${PALETTE.bg}" stroke-width="1" stroke-linejoin="miter" />`);
  }
  body.push(`<g clip-path="url(#skin-${uid})">${bridge(form, R)}</g>`);
  body.push(hexes(deck, R));

  // The frame is measured off what is actually drawn. The bells and the flame
  // reach four and a half radii past the stern plate, and a frame guessed at
  // three and a bit cut them off on every ship here.
  const drawn = extentOf(body.join("\n"));
  const pad = R * 0.5;

  return [
    `<svg viewBox="${f(drawn.minX - pad)} ${f(drawn.minY - pad)} ` +
      `${f(drawn.maxX - drawn.minX + pad * 2)} ${f(drawn.maxY - drawn.minY + pad * 2)}" ` +
      `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(form.name)}">`,
    `<defs>${defs.join("")}</defs>`,
    ...body,
    "</svg>",
  ].join("\n");
}

/**
 * A rectangle comfortably around the whole hull, for the outline masks.
 *
 * Measured off the polygons rather than off the drawing, because the masks have
 * to exist before there is a drawing to measure.
 */
function bandOf(form, R) {
  const all = [...form.bodies, ...form.holes].flat();
  const minX = Math.min(...all.map((p) => p.x)) - R * 4;
  const maxX = Math.max(...all.map((p) => p.x)) + R * 4;
  const minY = Math.min(...all.map((p) => p.y)) - R * 4;
  const maxY = Math.max(...all.map((p) => p.y)) + R * 4;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** A pod: square body, trapezoid bell, a wedge of flame. */
function podOf(pod, R) {
  const y = pod.y + pod.h / 2;
  const bell = [
    [pod.x, y - pod.h * 0.5],
    [pod.x - R * 0.42, y - pod.h * 0.72],
    [pod.x - R * 0.42, y + pod.h * 0.72],
    [pod.x, y + pod.h * 0.5],
  ];
  const flame = [
    [pod.x - R * 0.5, y - pod.h * 0.4],
    [pod.x - R * 1.5, y],
    [pod.x - R * 0.5, y + pod.h * 0.4],
  ];
  const ribs = [1, 2]
    .map((i) => {
      const rx = pod.x + (pod.w * i) / 3;
      return `<line x1="${f(rx)}" y1="${f(pod.y)}" x2="${f(rx)}" y2="${f(pod.y + pod.h)}" />`;
    })
    .join("");
  return (
    `<g><rect x="${f(pod.x)}" y="${f(pod.y)}" width="${f(pod.w)}" height="${f(pod.h)}" ` +
    `fill="${INK.plate}" stroke="${INK.skin}" stroke-width="2" />` +
    `<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.35">${ribs}</g>` +
    `<polygon points="${pts(bell)}" fill="${INK.deep}" stroke="${INK.skin}" stroke-width="1.6" />` +
    // Amber is reserved for doors and the airlock — the marks that mean «a
    // decision is required here». An exhaust is not one of them.
    `<polygon points="${pts(flame)}" fill="${PALETTE.steel}" opacity="0.22" />` +
    `<line x1="${f(pod.x - R * 0.5)}" y1="${f(y)}" x2="${f(pod.x - R * 1.35)}" y2="${f(y)}" ` +
    `stroke="${PALETTE.steel}" stroke-width="2" opacity="0.7" /></g>`
  );
}

/** Frames, seams, a spine lane, hatches and portholes. All straight edges. */
function plating(form, R, rng) {
  const out = [];
  const h = form.halfMax + R * 0.5;
  const frames = [];
  for (let x = R * 1.1; x < form.length; x += R * 1.3) {
    frames.push(`<line x1="${f(x)}" y1="${f(-h)}" x2="${f(x)}" y2="${f(h)}" />`);
  }
  out.push(`<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.28">${frames.join("")}</g>`);
  out.push(
    `<rect x="0" y="${f(-R * 0.55)}" width="${f(form.length)}" height="${f(R * 1.1)}" ` +
      `fill="${PALETTE.steel}" opacity="0.07" />` +
      `<line x1="0" y1="${f(-R * 0.55)}" x2="${f(form.length)}" y2="${f(-R * 0.55)}" stroke="${PALETTE.steel}" stroke-width="1" opacity="0.3" />` +
      `<line x1="0" y1="${f(R * 0.55)}" x2="${f(form.length)}" y2="${f(R * 0.55)}" stroke="${PALETTE.steel}" stroke-width="1" opacity="0.3" />`,
  );

  const bits = [];
  for (let i = 0; i < 7; i++) {
    const x = R * (1 + rng() * (form.length / R - 2));
    const y = (rng() < 0.5 ? -1 : 1) * R * (0.9 + rng() * 1.4);
    bits.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(R * (0.35 + rng() * 0.4))}" height="${f(R * 0.14)}" ` +
        `fill="${INK.deep}" opacity="0.55" />`,
    );
  }
  out.push(bits.join(""));
  return out.join("");
}

/**
 * The bridge: a chamfered block up at the bow, three lit windows forward.
 *
 * Placed on the **first body's** nose and on that body's own centreline, not on
 * the axis at the ship's longest point. On a catamaran the axis at the bow is
 * the gap between the two hulls, and the bridge hung there in open space.
 */
function bridge(form, R) {
  const hull = form.hull;
  const w = R * 1.8;
  const hh = R * 0.6;
  const bowX = Math.max(...hull.map((p) => p.x));
  const cy = (hull[0].y + hull[hull.length - 1].y) / 2;
  const cx = bowX - R * 2.6;
  const body = [
    [cx - w / 2, cy - hh],
    [cx + w / 2 - R * 0.3, cy - hh],
    [cx + w / 2, cy - hh + R * 0.3],
    [cx + w / 2, cy + hh - R * 0.3],
    [cx + w / 2 - R * 0.3, cy + hh],
    [cx - w / 2, cy + hh],
  ];
  const glass = [-1, 0, 1]
    .map(
      (k) =>
        `<rect x="${f(cx + w / 2 - R * 0.62)}" y="${f(cy + k * R * 0.3 - R * 0.07)}" width="${f(R * 0.32)}" ` +
        `height="${f(R * 0.15)}" fill="${PALETTE.steel}" opacity="0.9" />`,
    )
    .join("");
  return `<g><polygon points="${pts(body)}" fill="${INK.plateLit}" stroke="${INK.skin}" stroke-width="1.8" />${glass}</g>`;
}

/** The hexagons that fitted, drawn as the grid: seams, walls, doors, airlock. */
function hexes(deck, R) {
  const byKey = new Map(deck.cells.map((c) => [hexKey(c), c]));
  const doorWalls = new Set();
  for (const door of deck.doors) {
    const { cell, dir } = door.wall;
    doorWalls.add(`${hexKey(cell)}|${dir}`);
  }

  const seams = [];
  const walls = [];
  const doors = [];
  for (const cell of deck.cells) {
    const corners = hexCorners(cell).map((p) => ({ x: p.x * R, y: p.y * R }));
    for (let j = 0; j < 6; j++) {
      const a = corners[j];
      const b = corners[(j + 1) % 6];
      const dir = DIR_OF_EDGE[j];
      const far = byKey.get(hexKey({ q: cell.q + STEP[dir].q, r: cell.r + STEP[dir].r }));
      if (far === undefined) {
        walls.push(seg(a, b));
        continue;
      }
      if (hexKey(cell) > hexKey(far)) continue;
      if (far.comp === cell.comp) {
        seams.push(seg(a, b));
        continue;
      }
      if (doorWalls.has(`${hexKey(cell)}|${dir}`) || doorWalls.has(`${hexKey(far)}|${5 - dir}`)) {
        doors.push(seg(mix(a, b, 0.26), mix(a, b, 0.74)));
        walls.push(seg(a, mix(a, b, 0.26)));
        walls.push(seg(mix(a, b, 0.74), b));
        continue;
      }
      walls.push(seg(a, b));
    }
  }

  const marks = deck.compartments
    .map((comp) => {
      const pts2 = comp.cells.map((c) => hexCentre(c));
      const p = {
        x: (pts2.reduce((s, q) => s + q.x, 0) / pts2.length) * R,
        y: (pts2.reduce((s, q) => s + q.y, 0) / pts2.length) * R,
      };
      return comp.airlock
        ? `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(R * 0.2)}" fill="${PALETTE.bg}" fill-opacity="0.8" ` +
            `stroke="${PALETTE.accent}" stroke-width="2" /><circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(R * 0.07)}" fill="${PALETTE.accent}" />`
        : `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(R * 0.07)}" fill="${PALETTE.text}" opacity="0.5" />`;
    })
    .join("");

  return (
    `<g stroke="${PALETTE.steel}" stroke-width="1" opacity="0.3">${seams.join("")}</g>` +
    `<g stroke="${PALETTE.text}" stroke-width="1.7" opacity="0.6" stroke-linecap="round">${walls.join("")}</g>` +
    `<g stroke="${PALETTE.accent}" stroke-width="3" opacity="0.95" stroke-linecap="round">${doors.join("")}</g>` +
    marks
  );
}

/** Which neighbour corner pair `j` faces: `EDGE_OF_DIR`, inverted rather than retyped. */
const STEP = HEX_DIRS;
const DIR_OF_EDGE = (() => {
  const out = new Array(6).fill(0);
  EDGE_OF_DIR.forEach((edge, dir) => {
    out[edge] = dir;
  });
  return out;
})();

function path(poly) {
  return poly.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ") + " Z";
}

function pts(list) {
  return list.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
}

function seg(p, q) {
  return `<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}" />`;
}

function mix(p, q, t) {
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

function f(n) {
  return Math.round(n * 10) / 10;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
