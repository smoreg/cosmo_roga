import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEX_SPACING, MASK_FLOOR, RoomGame, Rng, hexKey, hexLayout, type HexCell, type HexLayout, type RoomGameConfig, type Ship } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { DERELICTS, buildDerelict, derelictSpec, type DerelictSpec } from "../src/content/derelicts.js";
import { TUTORIAL_SPEC } from "../src/content/tutorial.js";
import { HULL_ART, HULL_PROFILES, HULL_SHAPES, hullArtOf, hullProfileOf, type HullArt } from "../src/content/hulls-art.js";
import { COL, SHAPES, hexCentre as unitCentre, mirrored, shipForm, type Polygon } from "../src/content/hullforms.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { HEX_R, hexCentre, hexCorners, hexSvgOf } from "../src/ui/web/hex-svg.js";
import { formLoops, hullLayer, insideForm, insideLoops, outlineLoops, signedAreaOf, skinLoops } from "../src/ui/web/hullart.js";

/**
 * The drawn hull under the honeycomb (`docs/tasks/G81-hull-silhouette.md`),
 * and the honeycomb grown inside it (`docs/tasks/G82-hull-first-layout.md`).
 * Nothing here is about taste — that is the owner's contact sheet
 * (`hullview-sheet.test.ts`). This is about what the picture is allowed to
 * claim: that it is a function of the graph, that the hull is symmetric and
 * built of the cells the deck lies in, that every mark on it is inside its
 * silhouette, that it has no neck and no empty lobe, that it stays under the
 * doors and inside the frame, that a mask the layout refuses falls back to
 * the outline, and that a class the table forgot still draws.
 */

/** Two hundred hulls: every class the catalogue has, eighteen seeds each. */
const SEEDS = 18;

function hulls(): Array<{ spec: DerelictSpec; seed: number; ship: Ship }> {
  const out: Array<{ spec: DerelictSpec; seed: number; ship: Ship }> = [];
  for (const spec of DERELICTS) {
    for (let seed = 1; seed <= SEEDS; seed++) out.push({ spec, seed, ship: generated(spec, seed) });
  }
  return out;
}

function generated(spec: DerelictSpec, seed: number): Ship {
  return buildDerelict(spec, 1, new Rng(seed), { flags: new Set(), shipIndex: 1 }).ship;
}

function gameOn(ship: Ship, seed = 7): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => ship,
    firstShipId: "1",
  };
  return new RoomGame({ ...config, seed });
}

function cellsOf(ship: Ship): HexCell[] {
  return [...hexLayout(ship).cells.values()];
}

/**
 * The picture with the hull, as the game draws it: the hull built for the
 * ship, the honeycomb laid out inside it (`ui/web/screen.ts`, `mapHtml`).
 *
 * One game per ship: a `RoomGame` populates the hull it is handed, so a second
 * game on the same `Ship` object is a second population on top of the first,
 * and the *map* changes under the hull. The hull's own promise is over the
 * same input, which is what `Picture` holds.
 */
interface Picture {
  ship: Ship;
  input: ReturnType<typeof schematicInputOf>;
  art: HullArt;
  layout: HexLayout;
}

function pictureOf(ship: Ship, id = "1"): Picture {
  const game = gameOn(ship);
  const art = hullArtOf(game.ship, id);
  return { ship, input: schematicInputOf(game), art, layout: hexLayout(game.ship, { allowed: art.mask }) };
}

function drawn(picture: Picture, art: HullArt = picture.art): string {
  return hexSvgOf(picture.input, picture.layout, "banner", art);
}

function viewBox(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)"/);
  if (!m) throw new Error("no viewBox");
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** The tiling radius: the unit the hull is measured in, in pixels. */
const U = HEX_R * HEX_SPACING;

/** The subpaths of an SVG path `d`, as polygons. */
function polygonsOf(d: string): Polygon[] {
  return d.split(/\s*Z\s*/).filter((s) => s.trim().length > 0).map((sub) =>
    sub.trim().split(/\s*[ML]\s*/).filter((s) => s.length > 0).map((pair) => {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      return { x: x!, y: y! };
    }),
  );
}

/** The hull layer of a picture, cut out of the document. */
function layerOf(svg: string): string {
  const start = svg.indexOf('<g class="hull-art');
  const end = svg.indexOf('<line class="duct') >= 0 ? svg.indexOf('<line class="duct') : svg.indexOf('<line class="hall-wall');
  return svg.slice(start, end < 0 ? svg.indexOf('<g class="room ') : end);
}

/**
 * Every point of every primitive in an SVG fragment: line ends, rect
 * corners, circle extremes, polygon and path vertices.
 */
function pointsOf(fragment: string): Array<{ x: number; y: number; what: string }> {
  const out: Array<{ x: number; y: number; what: string }> = [];
  const num = (s: string | undefined): number => Number(s);
  for (const m of fragment.matchAll(/<line\b[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) {
    out.push({ x: num(m[1]), y: num(m[2]), what: "line" }, { x: num(m[3]), y: num(m[4]), what: "line" });
  }
  for (const m of fragment.matchAll(/<rect\b([^>]*)\/>/g)) {
    const a = Object.fromEntries([...m[1]!.matchAll(/([a-z]+)="([-\d.]+)"/g)].map((k) => [k[1], num(k[2])]));
    if (a.width === undefined || a.fill !== undefined) continue;
    out.push(
      { x: a.x!, y: a.y!, what: "rect" },
      { x: a.x! + a.width, y: a.y!, what: "rect" },
      { x: a.x! + a.width, y: a.y! + a.height!, what: "rect" },
      { x: a.x!, y: a.y! + a.height!, what: "rect" },
    );
  }
  for (const m of fragment.matchAll(/<circle\b[^>]*cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)) {
    const r = num(m[3]);
    out.push({ x: num(m[1]) - r, y: num(m[2]), what: "circle" }, { x: num(m[1]) + r, y: num(m[2]), what: "circle" });
  }
  for (const m of fragment.matchAll(/<polygon\b[^>]*points="([^"]+)"/g)) {
    for (const pair of m[1]!.trim().split(/\s+/)) {
      const [x, y] = pair.split(",").map(Number);
      out.push({ x: x!, y: y!, what: "polygon" });
    }
  }
  for (const m of fragment.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)) {
    for (const poly of polygonsOf(m[1]!)) for (const p of poly) out.push({ ...p, what: "path" });
  }
  return out;
}

/** Inside the silhouette, or within `slack` pixels of its edge — a stroke's half width. */
function within(p: { x: number; y: number }, silhouette: { bodies: Polygon[]; holes: Polygon[] }, slack: number): boolean {
  if (insideForm(p, silhouette)) return true;
  for (const loop of [...silhouette.bodies, ...silhouette.holes]) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
      if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= slack) return true;
    }
  }
  return false;
}

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r2 -d3- r4
  r1: docking
  r2: cargo
  r3: storage
  r4: hab
`;

describe("the hull is a pure function of the graph", () => {
  it("draws the same string twice over one ship, and over a ship built twice from one seed", () => {
    const picture = pictureOf(generated(DERELICTS[0]!, 7));
    expect(drawn(picture)).toBe(drawn(picture));
    const again = pictureOf(generated(DERELICTS[0]!, 7));
    expect(drawn(again)).toBe(drawn(picture));
  });

  it("changes with the ship's id, and with nothing else", () => {
    const ship = generated(DERELICTS[0]!, 7);
    const one = pictureOf(ship, "1");
    const two = pictureOf(ship, "2");
    expect(drawn(one)).not.toBe(drawn(two));
    // Same id, same cells, same class: neither the shape nor the rivets move
    // between frames — and the built hull is the same object each time.
    expect(hullArtOf(ship, "1")).toBe(one.art);
    expect(drawn(one, { ...one.art })).toBe(drawn(one));
  });

  it("reaches for no clock, no OS randomness and no DOM", () => {
    // `purity.test.ts` scans the rules and `src/content`, not `src/ui/web`;
    // the same list is held against the renderer, which promises to be a
    // function (`hexlayout.test.ts` makes the same promise for the layout).
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of [join("ui", "web", "hullart.ts"), join("content", "hullforms.ts")]) {
      const source = readFileSync(join(here, "..", "src", file), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const pattern of [/\bMath\s*\.\s*random\b/, /\bDate\s*\.\s*now\b/, /\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/]) {
        expect(code, `${file}: ${pattern.source}`).not.toMatch(pattern);
      }
    }
  });
});

describe("the hull is built of cells, symmetric about its keel", () => {
  it("mirrors every cell across the axis, on every shape at every size", () => {
    for (const kind of Object.keys(SHAPES) as Array<keyof typeof SHAPES>) {
      for (const size of [3, 5, 8, 12]) {
        for (const half of [0, 1, 2, 3]) {
          const form = shipForm(kind, 99, size, half);
          const keys = new Set(form.cells.map(hexKey));
          for (const cell of form.cells) {
            expect(keys.has(hexKey(mirrored(cell))), `${kind} size ${size} half ${half}: ${hexKey(cell)}`).toBe(true);
          }
          // One block: every cell reaches every other through the cells.
          expect(connected(form.cells), `${kind} size ${size} half ${half} falls apart`).toBe(true);
        }
      }
    }
  });

  it("holds every one of its cells inside its own polygons, and the mask is exactly those cells", () => {
    for (const { spec, seed, ship } of hulls()) {
      const { art } = pictureOf(ship);
      const form = art.form!;
      const loops = formLoops(form, U);
      expect(art.mask!.size, `${spec.id} seed ${seed}`).toBe(form.cells.length);
      for (const cell of form.cells) {
        expect(art.mask!.has(hexKey(cell))).toBe(true);
        for (const corner of hexCorners(hexCentre(cell))) {
          expect(insideForm(corner, loops), `${spec.id} seed ${seed} cell ${hexKey(cell)}`).toBe(true);
        }
      }
    }
  });

  it("measures the hull on the very lattice the renderer draws", () => {
    // The hull is in tiling radii; the renderer's pixel centre of a cell
    // must be the hull's unit centre times that radius, or the mask and
    // the picture would be two different lattices.
    for (const cell of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -4, r: 5 }, { q: 7, r: 7 }]) {
      const px = hexCentre(cell);
      const unit = unitCentre(cell, U);
      expect(px.x).toBeCloseTo(unit.x, 6);
      expect(px.y).toBeCloseTo(unit.y, 6);
    }
  });
});

describe("the honeycomb grown inside the hull", () => {
  it("keeps every cell inside the hull and draws most doors as corridors, on 200 hulls", () => {
    // The task's line: every cell in the mask, corridors at MASK_FLOOR or
    // better, and the mask kept on at least nine hulls in ten — under that
    // the mask is decoration, not a layout.
    let kept = 0;
    let corridors = 0;
    let doors = 0;
    for (const { spec, seed, ship } of hulls()) {
      const { art, layout } = pictureOf(ship);
      corridors += layout.corridors.size;
      doors += layout.corridors.size + layout.links.size;
      if (!layout.masked) continue;
      kept++;
      expect(layout.offLattice, `${spec.id} seed ${seed}`).toEqual([]);
      for (const cell of layout.cells.values()) {
        expect(art.mask!.has(hexKey(cell)), `${spec.id} seed ${seed} ${hexKey(cell)}`).toBe(true);
      }
      const share = layout.corridors.size / (layout.corridors.size + layout.links.size);
      expect(share, `${spec.id} seed ${seed}`).toBeGreaterThanOrEqual(MASK_FLOOR);
    }
    console.log(`mask kept on ${kept} of 200 hulls; corridors ${((corridors / doors) * 100).toFixed(1)}% of ${doors} doors`);
    expect(kept / 200).toBeGreaterThanOrEqual(0.9);
  });

  it("fills the body: the median hull is at least three fifths compartments, over 200 hulls", () => {
    // The owner's frame had a deck strung along one wall of a hull that was
    // mostly empty. Cells over compartments is the number that says so.
    const shares: number[] = [];
    for (const { ship } of hulls()) {
      const { art, layout } = pictureOf(ship);
      if (!layout.masked) continue;
      shares.push(layout.cells.size / art.mask!.size);
    }
    shares.sort((a, b) => a - b);
    const median = shares[Math.floor(shares.length / 2)]!;
    console.log(`compartments over hull cells: median ${(median * 100).toFixed(0)}%, least ${(shares[0]! * 100).toFixed(0)}%`);
    expect(median).toBeGreaterThanOrEqual(0.6);
  });
});

describe("the hull drawn over its cells", () => {
  it("has no neck and no empty lobe: at most 35 % of it is not under a cell, and it is never thinner than 1.5 R", () => {
    for (const { spec, seed, ship } of hulls()) {
      const picture = pictureOf(ship);
      if (!picture.layout.masked) continue;
      const where = `${spec.id} seed ${seed}`;
      const form = picture.art.form!;
      const loops = formLoops(form, U);

      // Uncovered: of the points inside the hull's polygons, the share not
      // under any of the tiling hexagons the hull is built of — sampled on a
      // grid an eighth of a radius apart. The slants, the belts at the ends
      // of the sections and the bow are what is left over.
      const keys = new Set(form.cells.map(hexKey));
      const all = loops.bodies.flat();
      const box = {
        minX: Math.min(...all.map((p) => p.x)),
        maxX: Math.max(...all.map((p) => p.x)),
        minY: Math.min(...all.map((p) => p.y)),
        maxY: Math.max(...all.map((p) => p.y)),
      };
      let inside = 0;
      let covered = 0;
      for (let x = box.minX; x <= box.maxX; x += U / 8) {
        for (let y = box.minY; y <= box.maxY; y += U / 8) {
          const p = { x, y };
          if (!insideForm(p, loops)) continue;
          inside++;
          if (keys.has(hexKey(cellAt(p)))) covered++;
        }
      }
      const uncovered = 1 - covered / inside;
      expect(uncovered, `${where}: ${(uncovered * 100).toFixed(0)}% of the hull is not under a cell`).toBeLessThanOrEqual(0.35);

      // Thickness: at every column between the stern plate and the last
      // cell, some body stands at least 1.5 R tall — no neck, no coupling a
      // corridor could not run through. The point of the bow is the one
      // place a hull may taper.
      const sternX = Math.min(...loops.bodies.flat().map((p) => p.x));
      const lastCol = Math.max(...form.cells.map((c) => (c.q + c.r / 2) * COL * U + (COL / 2) * U));
      for (let x = sternX + 1; x < lastCol; x += U * 0.25) {
        let height = 0;
        for (const body of loops.bodies) {
          const ys = crossingsAt(body, x);
          if (ys.length >= 2) height = Math.max(height, Math.max(...ys) - Math.min(...ys));
        }
        expect(height, `${where}: ${height.toFixed(0)}px thick at x=${x.toFixed(0)}`).toBeGreaterThanOrEqual(HEX_R * 1.5);
      }
    }
  });

  it("keeps every mark inside the silhouette it is clipped to, on 200 hulls", () => {
    // The owner's frame had a mast and a seam floating outside the skin. The
    // layer is clipped to its silhouette — the hull and its pods — and every
    // primitive it emits is inside that silhouette or on its edge, so the
    // clip has nothing left to cut.
    let checked = 0;
    for (const { spec, seed, ship } of hulls()) {
      const picture = pictureOf(ship);
      const svg = drawn(picture);
      const layer = layerOf(svg);
      const clip = layer.match(/<clipPath id="hull-clip-[^"]+"><path d="([^"]+)"/);
      expect(clip, `${spec.id} seed ${seed}: no clip`).not.toBeNull();
      const polys = polygonsOf(clip![1]!);
      const silhouette = {
        bodies: polys.filter((p) => signedAreaOf(p) > 0),
        holes: polys.filter((p) => signedAreaOf(p) < 0),
      };
      const body = layer.slice(layer.indexOf("</defs>"));
      for (const p of pointsOf(body)) {
        checked++;
        expect(within(p, silhouette, 2.5), `${spec.id} seed ${seed}: a ${p.what} point at ${p.x},${p.y} is outside the hull`).toBe(true);
      }
    }
    console.log(`${checked} points of hull marks checked against their silhouettes`);
  });

  it("draws straight sides from the cells, pods aft and the bridge forward", () => {
    for (const { spec, seed, ship } of hulls()) {
      const picture = pictureOf(ship);
      if (!picture.layout.masked) continue;
      const svg = drawn(picture);
      const where = `${spec.id} seed ${seed}`;
      expect(svg, where).toContain('class="hull-art hull-profile"');
      const loops = formLoops(picture.art.form!, U);
      // No side shorter than half a drawn radius: the polygon is sections
      // and slants, never a hexagon's staircase.
      for (const loop of loops.bodies) {
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i]!;
          const b = loop[(i + 1) % loop.length]!;
          expect(Math.hypot(b.x - a.x, b.y - a.y), where).toBeGreaterThanOrEqual(HEX_R * 0.5);
        }
      }
      // Pods end at the stern plate (x = 0) or under it; the bridge sits in the bow.
      const bowX = Math.max(...loops.bodies[0]!.map((p) => p.x));
      for (const m of svg.matchAll(/<g class="hull-pod"><rect class="hull-plate" x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"/g)) {
        expect(Number(m[1]) + Number(m[2]), where).toBeLessThanOrEqual(U * 0.5);
      }
      if (picture.art.profile!.bridge) {
        const bridge = svg.match(/<g class="hull-bridge"><polygon class="hull-plate-lit hull-plate-rimmed" points="([^"]+)"/);
        expect(bridge, where).not.toBeNull();
        const xs = bridge![1]!.split(" ").map((pair) => Number(pair.split(",")[0]));
        expect(Math.max(...xs), where).toBeGreaterThan(bowX - U * 5);
      }
    }
  });

  it("falls back to the outline around the cells when the layout refuses the mask", () => {
    // A mask three cells big cannot hold a hull; the layout hands it back
    // and the picture is the G81 one — a skin traced around the cells, no
    // profile class on the layer, and never a missing hull.
    const ship = generated(DERELICTS[0]!, 4);
    const game = gameOn(ship);
    const art = hullArtOf(game.ship, "1");
    const tiny = new Set([hexKey({ q: 0, r: 0 }), hexKey({ q: 1, r: 0 }), hexKey({ q: 2, r: 0 })]);
    const layout = hexLayout(game.ship, { allowed: tiny });
    expect(layout.masked).toBe(false);
    expect(layout).toEqual(hexLayout(game.ship));
    const svg = hexSvgOf(schematicInputOf(game), layout, "banner", { ...art, mask: tiny });
    expect(svg).toContain('<g class="hull-art">');
    expect(svg).not.toContain("hull-profile");
    expect(svg).toContain('class="hull-skin"');
    const loops = skinLoops({ cells: [...layout.cells.values()], at: hexCentre, R: HEX_R, spacing: HEX_SPACING });
    for (const cell of layout.cells.values()) {
      for (const corner of hexCorners(hexCentre(cell))) expect(insideLoops(corner, loops)).toBe(true);
    }
  });

  it("gives two seeds of one class two ships of that class, not two different ships", () => {
    const a = shipForm("tug", 1, 8, 2);
    const b = shipForm("tug", 2, 8, 2);
    expect(a.hull.length).toBe(b.hull.length);
    expect(Math.abs(a.cells.length - b.cells.length)).toBeLessThanOrEqual(Math.ceil(a.cells.length * 0.25));
    expect(a).toEqual(shipForm("tug", 1, 8, 2));
  });
});

describe("the owner's frame: a quarantine hull of fourteen compartments", () => {
  it("comes out symmetric, filled and clipped where it came out in lobes", () => {
    // The second screenshot (`docs/tasks/G82-hull-first-layout.md`): a
    // quarantine hull of fourteen compartments, drawn as two bubbles on a
    // neck with marks floating outside. The same class at the same size,
    // held to everything above.
    const spec = derelictSpec("quarantine")!;
    let seed = 1;
    while (generated(spec, seed).rooms.length !== 14) seed++;
    const picture = pictureOf(generated(spec, seed));
    expect(picture.ship.rooms.length).toBe(14);
    expect(picture.layout.masked).toBe(true);
    const form = picture.art.form!;
    const keys = new Set(form.cells.map(hexKey));
    for (const cell of form.cells) expect(keys.has(hexKey(mirrored(cell)))).toBe(true);
    expect(picture.layout.cells.size / picture.art.mask!.size).toBeGreaterThanOrEqual(0.5);
    const svg = drawn(picture);
    expect(svg).toContain("hull-profile");
    expect(svg).not.toContain("hull-mast");
  });
});

describe("the skin traced around the cells, the fallback", () => {
  it("holds all six corners of every drawn hexagon inside the skin, on 200 hulls", () => {
    const misses: string[] = [];
    for (const { spec, seed, ship } of hulls()) {
      const cells = cellsOf(ship);
      const loops = skinLoops({ cells, at: hexCentre, R: HEX_R, spacing: HEX_SPACING });
      for (const cell of cells) {
        for (const corner of hexCorners(hexCentre(cell))) {
          if (!insideLoops(corner, loops)) misses.push(`${spec.id} seed ${seed} cell ${cell.q},${cell.r}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("is one connected outline around a generated hull: holes are holes, never a second ship", () => {
    for (const { spec, seed, ship } of hulls()) {
      const loops = skinLoops({ cells: cellsOf(ship), at: hexCentre, R: HEX_R, spacing: HEX_SPACING });
      // The hull is on the right of travel, which in screen coordinates is a
      // positive area; a hole runs the other way round.
      const outer = loops.filter((loop) => signedAreaOf(loop) > 0);
      expect(outer.length, `${spec.id} seed ${seed}`).toBe(1);
    }
  });

  it("traces a hole in a ring rather than filling it", () => {
    // Six cells around an empty one: two loops, the inner one running the
    // other way. `evenodd` then leaves the middle open.
    const ring: HexCell[] = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: -1, r: 1 }, { q: -1, r: 0 },
    ];
    const loops = outlineLoops(ring, hexCentre, HEX_R * HEX_SPACING);
    expect(loops).toHaveLength(2);
    expect(loops.filter((loop) => signedAreaOf(loop) > 0)).toHaveLength(1);
    expect(loops.filter((loop) => signedAreaOf(loop) < 0)).toHaveLength(1);
    expect(insideLoops(hexCentre({ q: 0, r: 0 }), loops)).toBe(false);
    expect(insideLoops(hexCentre({ q: 1, r: 0 }), loops)).toBe(true);
  });
});

describe("the hull stays under the map", () => {
  it("comes first in the document, and nothing of it comes after the first corridor or door", () => {
    for (const { ship } of hulls().slice(0, 40)) {
      const svg = drawn(pictureOf(ship));
      const hull = svg.indexOf('<g class="hull-art');
      expect(hull).toBeGreaterThan(-1);
      // Straight after the opening tag: nothing is drawn before it.
      expect(svg.indexOf(">") + 1).toBe(hull);
      // The layer closes with its wash and the map begins: no amber mark can
      // be under a plate, because every plate was drawn before every mark.
      const map = Math.min(
        ...['<line class="duct', '<line class="hall-wall', '<g class="room ', '<g class="door']
          .map((s) => svg.indexOf(s))
          .filter((i) => i >= 0),
      );
      expect(map).toBeGreaterThan(hull);
      expect(svg.slice(map)).not.toContain("hull-");
    }
  });

  it("draws every corridor and every door exactly as it did without the hull", () => {
    // Same layout in both, the one grown inside the hull: what the hull
    // adds is the layer under the map, and nothing on the map itself.
    const { input, art, layout } = pictureOf(generated(DERELICTS[0]!, 3));
    const bare = hexSvgOf(input, layout, "banner");
    const withHull = hexSvgOf(input, layout, "banner", art);
    // Everything after the hull layer is the old drawing, byte for byte, save
    // the frame around it and the two captions pinned to that frame's corners.
    const tail = (svg: string): string =>
      svg.slice(svg.indexOf('<line class="hall-wall')).replace(/<text class="(banner|ship-line)"[^<]*<\/text>/g, "");
    expect(withHull).toContain('<line class="hall-wall');
    expect(tail(withHull)).toBe(tail(bare));
  });
});

describe("the frame", () => {
  it("still fits the itch viewport on every hull the bare honeycomb fits, and keeps the hexagons legible, over 200 hulls", () => {
    // 1718 × 764 is the itch frame (docs/itch-page.md). The bare honeycomb
    // already runs taller than that on the tallest father's-tug seeds, and
    // the picture scales to fit whatever the frame is; what the hull owes is
    // to push no hull over the line that was under it.
    //
    // G81 also held the hull to a growth budget over the bare frame — eight
    // radii along the axis for the pods, three across for a mast — because
    // it drew around the same cells. Here the cells are laid out again
    // inside a ship-shaped hull, which is longer than the compact honeycomb
    // by design, so growth is measured where it costs the reader: the
    // radius a hexagon comes out at once the picture is fitted to the map
    // pane (about 1258 × 602 of the itch frame). The hull may not shrink
    // the hexagons below three quarters of what the bare picture gives.
    const pane = { w: 1258, h: 602 };
    const onScreen = (v: { w: number; h: number }): number => HEX_R * Math.min(pane.w / v.w, pane.h / v.h, 1);
    let worst = 1;
    for (const { spec, seed, ship } of hulls()) {
      const picture = pictureOf(ship);
      const bare = viewBox(hexSvgOf(picture.input, hexLayout(picture.ship), "banner"));
      const hull = viewBox(drawn(picture));
      expect(hull.w, `${spec.id} seed ${seed}`).toBeLessThanOrEqual(1718);
      if (bare.h <= 764) expect(hull.h, `${spec.id} seed ${seed}`).toBeLessThanOrEqual(764);
      const ratio = onScreen(hull) / onScreen(bare);
      worst = Math.min(worst, ratio);
      expect(ratio, `${spec.id} seed ${seed}: hexagons ${onScreen(hull).toFixed(0)}px against ${onScreen(bare).toFixed(0)}px bare`).toBeGreaterThanOrEqual(0.75);
    }
    console.log(`hexagons on screen at worst ${(worst * 100).toFixed(0)}% of the bare picture's`);
  });
});

describe("the catalogue", () => {
  it("dresses every class of derelict, and the training hull", () => {
    for (const spec of [...DERELICTS, TUTORIAL_SPEC]) {
      const id = HULL_ART[spec.id];
      expect(id, `${spec.id} has no profile`).toBeDefined();
      expect(HULL_PROFILES[id!], `${spec.id} → ${id} is not a profile`).toBeDefined();
    }
  });

  it("names only classes that exist", () => {
    const known = new Set([...DERELICTS, TUTORIAL_SPEC].map((d) => d.id));
    for (const id of Object.keys(HULL_ART)) expect(known.has(id), `${id} is no class`).toBe(true);
  });

  it("names a shape for every profile, and the shape is one the table of shapes has", () => {
    for (const [id, profile] of Object.entries(HULL_PROFILES)) {
      expect(HULL_SHAPES[profile.form], `${id} → ${profile.form}`).toBeDefined();
    }
  });

  it("draws a bare skin and nothing on it for a hull no class built", () => {
    // A fixture drawn by hand carries no class stamp; the picture still has a
    // hull, and never a crash.
    const ship = shipFromText(SHIP).ship;
    expect(hullProfileOf(undefined)).toBeUndefined();
    const art = hullArtOf(ship, "fixture");
    expect(art.profile).toBeUndefined();
    expect(art.form).toBeUndefined();
    const svg = drawn(pictureOf(ship), art);
    expect(svg).toContain('class="hull-skin"');
    expect(svg).not.toContain("hull-pod");
    expect(svg).not.toContain("hull-bridge");
    expect(svg).not.toContain("hull-profile");
  });

  it("never throws on an empty layout", () => {
    const layer = hullLayer({
      cells: [],
      airlock: undefined,
      at: hexCentre,
      R: HEX_R,
      spacing: HEX_SPACING,
      art: { profile: undefined, seed: "x", form: undefined, mask: undefined },
    });
    expect(layer.svg).toBe("");
  });
});

// ---------------------------------------------------------------- helpers

/** Where a vertical line at `x` crosses the polygon's edges. */
function crossingsAt(loop: Polygon, x: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    if (a.x === b.x) continue;
    if (x < Math.min(a.x, b.x) || x >= Math.max(a.x, b.x)) continue;
    out.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
  }
  return out;
}

/** The tiling cell a pixel lies in: axial from pixels, rounded in cube coordinates. */
function cellAt(p: { x: number; y: number }): HexCell {
  const q = ((Math.sqrt(3) / 3) * p.x - p.y / 3) / U;
  const r = ((2 / 3) * p.y) / U;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** Do the cells hang together as one block, neighbour to neighbour? */
function connected(cells: readonly HexCell[]): boolean {
  if (cells.length === 0) return true;
  const keys = new Set(cells.map(hexKey));
  const seen = new Set<string>([hexKey(cells[0]!)]);
  const queue = [cells[0]!];
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const [dq, dr] of [[1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0]] as const) {
      const n = { q: c.q + dq, r: c.r + dr };
      const k = hexKey(n);
      if (!keys.has(k) || seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen.size === keys.size;
}
