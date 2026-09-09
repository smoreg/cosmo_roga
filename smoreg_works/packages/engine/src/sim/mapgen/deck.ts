import { DIRS4, DIRS8, Grid, type Point } from "../grid.js";
import { Tile, TILES, roomCenter, type RoomRect, type Zone } from "../level.js";
import type { Rng } from "../rng.js";
import { removeDeadEndsInRect } from "./postprocess.js";
import { connectRegionsInRect, inRect, regionsInRect, tunnelToFloor } from "./regions.js";
import type { BuildContext, BuildResult, MapBuilder } from "./types.js";
import type { PlacedVault, Vault } from "./vaults.js";
import { placeVaultsInZones } from "./storylets.js";

/**
 * Deck generator: the map is a graph of zones first and a tile grid second.
 *
 * A BSP partition cuts the deck into sectors that tile the map exactly and
 * never overlap. Each sector owns the wall line on the sides where it is the
 * upper/left neighbour, so between any two sectors there is exactly one solid
 * line — and the only holes ever cut into it are the airlocks this builder
 * places, one per graph edge. That is what makes "two zones are connected only
 * through an airlock" a structural property rather than a hopeful one.
 *
 * The engine stays ignorant of what a zone means: `kind`, `name` and the
 * interior style arrive as data in the `DeckPlan` the game hands over.
 *
 * Maps from here are already connected, so they must be built with
 * `connect: false` — a stray `connectRegions` would tunnel straight through a
 * zone wall and quietly repair exactly the bug the tests are here to catch.
 */

export type InteriorStyle = "rooms" | "open" | "cluttered";

/**
 * How much of a sector its interior is allowed to fill. This is a readability
 * dial, not a difficulty one: on ASCII without tiles a packed sector reads as
 * noise, so most sectors want air between their corridors and only a few want
 * to feel cramped.
 */
export type ZoneDensity = "sparse" | "normal" | "dense";

export interface ZoneKindSpec {
  /** Content id, e.g. "cargo". Never interpreted here. */
  kind: string;
  /** Label, e.g. "CARGO BAY". */
  name: string;
  interior: InteriorStyle;
  weight?: number;
  /** Preferred sector size share, 1 = average. Reactor wants 1.5, a closet 0.6. */
  size?: number;
  /** How tightly the interior packs the sector. Default "normal". */
  density?: ZoneDensity;
}

export interface DeckPlan {
  /** Catalog for this depth; the builder picks `count` of them. */
  zones: readonly ZoneKindSpec[];
  /** Sectors per deck. Default [4, 7]. */
  count?: [min: number, max: number];
  /** Edges beyond the spanning tree. Default 1..2. */
  extraEdges?: number;
  /** Which zone kind must hold the entry / the stairs, when it matters. */
  entryIn?: string;
  stairsIn?: string;
  /** Storylet library, offered to every sector of this deck. */
  vaults?: readonly Vault[];
  /** How many cards to try per sector. Default 1. */
  vaultsPerZone?: number;
  /**
   * Corner sectors turned into solid hull instead of a zone, 0–2. Default 0.
   * The deck then has a silhouette rather than being a filled rectangle. The
   * builder partitions `count + hullCutouts` sectors and drops the cutouts, so
   * `count` still says how many zones come out — and a cutout that would break
   * the zone graph in two is skipped rather than shipped.
   */
  hullCutouts?: number;
  /**
   * What to cut into a graph edge. `isTreeEdge` is true for the spanning tree
   * — the edges that make every zone reachable — and false for the loops on
   * top of it, which a game may seal with something the player has to open.
   * Default: an airlock either way.
   */
  edgeTile?: (isTreeEdge: boolean) => Tile;
}

/** Everything the adjacency pass needs of a sector: where it is, what it may carve. */
interface Slab {
  rect: RoomRect;
  floor: RoomRect;
}

/** Sector rects include the wall lines the sector owns; `floor` is what may be carved. */
interface Sector extends Slab {
  id: number;
  spec: ZoneKindSpec;
  rooms: RoomRect[];
}

interface Node {
  rect: RoomRect;
  /** True when the wall on that side is this rect's own last row/column. */
  ownLeft: boolean;
  ownRight: boolean;
  ownTop: boolean;
  ownBottom: boolean;
}

interface Adjacency {
  a: number;
  b: number;
  /** "h" = the sectors sit side by side, so the airlock's flanks are left/right. */
  axis: "h" | "v";
  /** Wall tiles that can become the airlock: floor of both sectors flanks them. */
  spots: Point[];
  /** Shared wall length; the plan asks for >= 3 before calling it a doorway. */
  span: number;
}

/** An adjacency the graph kept, and whether it is a spanning-tree edge. */
interface ChosenEdge {
  edge: Adjacency;
  tree: boolean;
}

const MIN_SECTOR_W = 12;
const MIN_SECTOR_H = 8;
const DEFAULT_COUNT: [number, number] = [4, 7];
/** Interior retries before falling back to the trivially connected `open` style. */
const INTERIOR_ATTEMPTS = 5;
/** Above this width a sector gets two-tile corridors: one-tile ones read as cracks. */
const WIDE_SECTOR = 20;
/** Sectors that survive a hull cutout. Below this a deck stops being a graph. */
const MIN_SECTORS_AFTER_CUTOUT = 3;

interface DensityTuning {
  /** Share of its slot a room may fill, before the one-tile margin. */
  roomFill: [min: number, max: number];
  /** Rooms per sector. */
  roomCount: [min: number, max: number];
  /** Wall chance the cellular pass starts from. */
  clutter: number;
  /** Pillar clusters in an open sector. */
  pillars: [min: number, max: number];
}

/**
 * The three dials, tuned so that even `dense` leaves a sector legible. The
 * numbers are asserted from the outside in `readability.test.ts` (wall share of
 * a `rooms` sector, width of the walkable components of a `cluttered` one) —
 * change them there and here together.
 */
const DENSITY: Record<ZoneDensity, DensityTuning> = {
  // `roomFill` is per axis, so the share of a slot a room covers is its square:
  // 0.55 across means a room on a third of its slot and two thirds of air.
  sparse: { roomFill: [0.52, 0.62], roomCount: [2, 3], clutter: 0.4, pillars: [1, 3] },
  normal: { roomFill: [0.6, 0.7], roomCount: [2, 4], clutter: 0.43, pillars: [2, 4] },
  dense: { roomFill: [0.68, 0.8], roomCount: [3, 5], clutter: 0.46, pillars: [3, 5] },
};

function tuningOf(spec: ZoneKindSpec): DensityTuning {
  return DENSITY[spec.density ?? "normal"];
}

export class DeckBuilder implements MapBuilder {
  readonly name = "deck";
  private readonly planForDepth: (depth: number, rng: Rng) => DeckPlan;

  constructor(planForDepth: (depth: number, rng: Rng) => DeckPlan) {
    this.planForDepth = planForDepth;
  }

  build(ctx: BuildContext): BuildResult {
    const { width, height, depth, rng } = ctx;
    const plan = this.planForDepth(depth, rng.fork(0x51ec + depth));
    if (plan.zones.length === 0) throw new Error("DeckBuilder: plan has an empty zone catalog");

    const layoutRng = rng.fork(0x1a70);
    const [lo, hi] = plan.count ?? DEFAULT_COUNT;
    const cutouts = Math.max(0, Math.min(2, Math.trunc(plan.hullCutouts ?? 0)));
    const wanted = layoutRng.int(Math.max(1, lo), Math.max(1, hi));
    const nodes = cutHull(partition(width, height, wanted + cutouts, layoutRng), cutouts, layoutRng);
    const specs = chooseKinds(plan, nodes.length, rng.fork(0x2b1d));
    const sectors = assignSectors(nodes, specs);

    const tiles = new Grid<Tile>(width, height, Tile.Wall);
    for (const s of sectors) carveInterior(tiles, s, rng.fork(0x3c00 + s.id * 977));

    const zones: Zone[] = sectors.map((s) => ({
      id: s.id,
      kind: s.spec.kind,
      name: s.spec.name,
      rect: s.rect,
      airlocks: [],
    }));

    // Storylets go in before the airlocks: a card lives one tile inside its
    // sector's frame, and the airlock candidates are frame tiles, so the two
    // passes cannot collide whichever order they run in — but placing first
    // means the airlock digger already sees the card's walls.
    const cards = placeStorylets(tiles, sectors, plan, ctx, rng.fork(0x6f31));

    const adjacencies = findAdjacencies(sectors);
    const edges = chooseEdges(sectors.length, adjacencies, plan.extraEdges, rng.fork(0x4d11));
    cutAirlocks(tiles, sectors, zones, edges, plan.edgeTile ?? ALWAYS_AIRLOCK, rng.fork(0x5e22));

    const entryZone = pickNamedZone(sectors, plan.entryIn) ?? sectors[0]!;
    const entryHint = interiorSpot(tiles, entryZone.floor);

    const rooms: RoomRect[] = [];
    for (const s of sectors) rooms.push(...s.rooms);

    const stairsZone = plan.stairsIn ? pickNamedZone(sectors, plan.stairsIn) : undefined;
    const stairsHint = stairsZone && entryHint ? farthestFloorIn(tiles, entryHint, stairsZone.rect) : undefined;

    // Last, so the hints above still see the deck as plain floor.
    if (entryHint) cutOuterAirlock(tiles, entryHint, entryZone.floor, rng.fork(0x7a91));

    return { tiles, rooms, zones, entryHint, stairsHint, vaults: cards.vaults, flagsSet: cards.flagsSet };
  }
}

/** Offer the plan's storylet library to every sector, if it has one. */
function placeStorylets(
  tiles: Grid<Tile>,
  sectors: Sector[],
  plan: DeckPlan,
  ctx: BuildContext,
  rng: Rng,
): { vaults: PlacedVault[]; flagsSet: string[] } {
  const library = plan.vaults ?? [];
  const perZone = plan.vaultsPerZone ?? 1;
  if (library.length === 0 || perZone <= 0) return { vaults: [], flagsSet: [] };

  return placeVaultsInZones(
    tiles,
    sectors.map((s) => ({ id: s.id, kind: s.spec.kind, rect: s.rect, floor: s.floor })),
    library,
    { depth: ctx.depth, flags: ctx.flags, player: ctx.player },
    rng,
    perZone,
  );
}

// ---------------------------------------------------------------- partition

/**
 * Guillotine BSP down to `count` leaves. Ownership of each cut line goes to the
 * left/top child, so neighbouring sectors are separated by exactly one wall and
 * their rects still tile the map without overlapping.
 */
function partition(width: number, height: number, count: number, rng: Rng): Node[] {
  const leaves: Node[] = [
    { rect: { x1: 0, y1: 0, x2: width - 1, y2: height - 1 }, ownLeft: true, ownRight: true, ownTop: true, ownBottom: true },
  ];

  while (leaves.length < count) {
    let best = -1;
    let bestArea = 0;
    for (let i = 0; i < leaves.length; i++) {
      const n = leaves[i]!;
      if (!splittable(n)) continue;
      const area = (n.rect.x2 - n.rect.x1 + 1) * (n.rect.y2 - n.rect.y1 + 1);
      if (area > bestArea) {
        bestArea = area;
        best = i;
      }
    }
    if (best < 0) break;
    const parts = splitNode(leaves[best]!, rng);
    if (!parts) break;
    leaves.splice(best, 1, parts[0], parts[1]);
  }

  return leaves;
}

function splittable(n: Node): boolean {
  return n.rect.x2 - n.rect.x1 + 1 >= MIN_SECTOR_W * 2 || n.rect.y2 - n.rect.y1 + 1 >= MIN_SECTOR_H * 2;
}

function splitNode(n: Node, rng: Rng): [Node, Node] | undefined {
  const w = n.rect.x2 - n.rect.x1 + 1;
  const h = n.rect.y2 - n.rect.y1 + 1;
  const canV = w >= MIN_SECTOR_W * 2;
  const canH = h >= MIN_SECTOR_H * 2;
  if (!canV && !canH) return undefined;
  // Split whichever axis has more slack, so sectors stay roughly proportional.
  const vertical = canV && (!canH || w / MIN_SECTOR_W >= h / MIN_SECTOR_H);

  if (vertical) {
    const cut = n.rect.x1 + rng.int(MIN_SECTOR_W - 1, w - MIN_SECTOR_W - 1);
    return [
      { rect: { ...n.rect, x2: cut }, ownLeft: n.ownLeft, ownRight: true, ownTop: n.ownTop, ownBottom: n.ownBottom },
      { rect: { ...n.rect, x1: cut + 1 }, ownLeft: false, ownRight: n.ownRight, ownTop: n.ownTop, ownBottom: n.ownBottom },
    ];
  }
  const cut = n.rect.y1 + rng.int(MIN_SECTOR_H - 1, h - MIN_SECTOR_H - 1);
  return [
    { rect: { ...n.rect, y2: cut }, ownLeft: n.ownLeft, ownRight: n.ownRight, ownTop: n.ownTop, ownBottom: true },
    { rect: { ...n.rect, y1: cut + 1 }, ownLeft: n.ownLeft, ownRight: n.ownRight, ownTop: false, ownBottom: n.ownBottom },
  ];
}

function floorOf(n: Node): RoomRect {
  return {
    x1: n.rect.x1 + (n.ownLeft ? 1 : 0),
    y1: n.rect.y1 + (n.ownTop ? 1 : 0),
    x2: n.rect.x2 - (n.ownRight ? 1 : 0),
    y2: n.rect.y2 - (n.ownBottom ? 1 : 0),
  };
}

/**
 * Drop up to `count` corner leaves, so the deck reads as a hull with a shape
 * instead of a filled rectangle. A dropped leaf is never carved and never
 * becomes a zone, so it stays the solid wall the grid started as.
 *
 * The smallest corners go first — losing a big sector would cost the deck a
 * room to fight in — and any cut that would leave the zone graph in two pieces
 * is refused. A hull with a hole in the middle of the route is not a silhouette,
 * it is a broken deck.
 */
function cutHull(nodes: Node[], count: number, rng: Rng): Node[] {
  const budget = Math.min(count, nodes.length - MIN_SECTORS_AFTER_CUTOUT);
  if (budget <= 0) return nodes;

  const x1 = Math.min(...nodes.map((n) => n.rect.x1));
  const y1 = Math.min(...nodes.map((n) => n.rect.y1));
  const x2 = Math.max(...nodes.map((n) => n.rect.x2));
  const y2 = Math.max(...nodes.map((n) => n.rect.y2));
  const isCorner = (n: Node): boolean =>
    (n.rect.x1 === x1 || n.rect.x2 === x2) && (n.rect.y1 === y1 || n.rect.y2 === y2);

  const candidates = nodes.filter(isCorner);
  rng.shuffle(candidates);
  candidates.sort((a, b) => areaOf(a.rect) - areaOf(b.rect));

  let kept = nodes;
  let cuts = 0;
  for (const c of candidates) {
    if (cuts >= budget) break;
    const rest = kept.filter((n) => n !== c);
    if (rest.length < MIN_SECTORS_AFTER_CUTOUT || !adjacencyConnected(rest)) continue;
    kept = rest;
    cuts++;
  }
  return kept;
}

function areaOf(r: RoomRect): number {
  return (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1);
}

/** Would these leaves still form one zone graph, walls and airlock spots aside? */
function adjacencyConnected(nodes: Node[]): boolean {
  const slabs = nodes.map((n) => ({ rect: n.rect, floor: floorOf(n) }));
  const parent = slabs.map((_s, i) => i);
  const find = (x: number): number => (parent[x]! === x ? x : (parent[x] = find(parent[x]!)));
  let merged = 0;
  for (const adj of findAdjacencies(slabs)) {
    const ra = find(adj.a);
    const rb = find(adj.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    merged++;
  }
  return merged === slabs.length - 1;
}

// ------------------------------------------------------------- zone choice

/**
 * Pick which kinds appear on this deck. Kinds named by `entryIn`/`stairsIn` are
 * seeded first: a plan that demands the stairs in the reactor gets a reactor.
 */
function chooseKinds(plan: DeckPlan, count: number, rng: Rng): ZoneKindSpec[] {
  const chosen: ZoneKindSpec[] = [];
  for (const wanted of [plan.entryIn, plan.stairsIn]) {
    if (!wanted) continue;
    const spec = plan.zones.find((z) => z.kind === wanted);
    if (spec && !chosen.includes(spec)) chosen.push(spec);
  }

  const pool = plan.zones.filter((z) => !chosen.includes(z));
  while (chosen.length < count && pool.length > 0) {
    chosen.push(takeWeighted(pool, rng));
  }
  // Catalog exhausted: repeats are allowed rather than leaving a sector nameless.
  while (chosen.length < count) chosen.push(weightedPick(plan.zones, rng));
  return chosen.slice(0, count);
}

function takeWeighted(pool: ZoneKindSpec[], rng: Rng): ZoneKindSpec {
  const picked = weightedPick(pool, rng);
  pool.splice(pool.indexOf(picked), 1);
  return picked;
}

function weightedPick(pool: readonly ZoneKindSpec[], rng: Rng): ZoneKindSpec {
  let total = 0;
  for (const z of pool) total += Math.max(0, z.weight ?? 1);
  let r = rng.next() * total;
  for (const z of pool) {
    r -= Math.max(0, z.weight ?? 1);
    if (r <= 0) return z;
  }
  return pool[pool.length - 1]!;
}

/** Biggest sector to the kind that asked for the biggest `size`. */
function assignSectors(nodes: Node[], specs: ZoneKindSpec[]): Sector[] {
  const order = nodes
    .map((n, i) => ({ n, i, area: (n.rect.x2 - n.rect.x1 + 1) * (n.rect.y2 - n.rect.y1 + 1) }))
    .sort((a, b) => b.area - a.area || a.i - b.i);
  const wanted = specs.map((s, i) => ({ s, i })).sort((a, b) => (b.s.size ?? 1) - (a.s.size ?? 1) || a.i - b.i);

  const sectors: Sector[] = new Array(nodes.length);
  for (let k = 0; k < order.length; k++) {
    const { n, i } = order[k]!;
    sectors[i] = { id: i, rect: n.rect, floor: floorOf(n), spec: wanted[k]!.s, rooms: [] };
  }
  return sectors;
}

function pickNamedZone(sectors: Sector[], kind: string | undefined): Sector | undefined {
  if (!kind) return undefined;
  return sectors.find((s) => s.spec.kind === kind);
}

// ---------------------------------------------------------------- interiors

/**
 * Draw a sector's interior and guarantee it comes out as a single region. A
 * sector split in two would need a second airlock to be reachable, which is
 * precisely the hole the isolation invariant forbids — so on repeated failure
 * we fall back to `open`, which cannot fail.
 */
function carveInterior(tiles: Grid<Tile>, s: Sector, rng: Rng): void {
  const area = areaOf(s.floor);
  const tuning = tuningOf(s.spec);
  for (let attempt = 0; attempt < INTERIOR_ATTEMPTS; attempt++) {
    fillRect(tiles, s.floor, Tile.Wall);
    s.rooms = drawInterior(tiles, s.floor, s.spec.interior, tuning, rng.fork(attempt * 7919 + 13));
    const regions = regionsInRect(tiles, s.floor);
    if (regions.length === 1 && regions[0]!.length >= Math.max(12, area * 0.2)) return;
  }
  fillRect(tiles, s.floor, Tile.Wall);
  s.rooms = drawFallback(tiles, s.floor, s.spec.interior, rng.fork(0x0fed));
}

/**
 * Last resort when five interiors in a row came out in pieces. A hall is the
 * one shape that cannot fail, but handing a hall to every style would make a
 * failed `rooms` sector the most open room on the deck — so anything else gets
 * one centred compartment: trivially a single region, and still a compartment.
 */
function drawFallback(tiles: Grid<Tile>, floor: RoomRect, style: InteriorStyle, rng: Rng): RoomRect[] {
  if (style === "open") return drawOpen(tiles, floor, DENSITY.sparse, rng);
  const w = floor.x2 - floor.x1 + 1;
  const h = floor.y2 - floor.y1 + 1;
  const rw = Math.max(2, Math.floor(w * 0.6));
  const rh = Math.max(2, Math.floor(h * 0.6));
  const x1 = floor.x1 + ((w - rw) >> 1);
  const y1 = floor.y1 + ((h - rh) >> 1);
  const room: RoomRect = { x1, y1, x2: x1 + rw - 1, y2: y1 + rh - 1 };
  fillRect(tiles, room, Tile.Floor);
  return [room];
}

function drawInterior(
  tiles: Grid<Tile>,
  floor: RoomRect,
  style: InteriorStyle,
  tuning: DensityTuning,
  rng: Rng,
): RoomRect[] {
  switch (style) {
    case "open": return drawOpen(tiles, floor, tuning, rng);
    case "rooms": return drawRooms(tiles, floor, tuning, rng);
    case "cluttered": return drawCluttered(tiles, floor, tuning, rng);
  }
}

/**
 * A hangar: open ground with a few pillars, kept clear of the walls. Pillars
 * come in 2×2 blocks — a scatter of single tiles reads as dirt on the screen,
 * a block reads as a thing standing there.
 */
function drawOpen(tiles: Grid<Tile>, floor: RoomRect, tuning: DensityTuning, rng: Rng): RoomRect[] {
  fillRect(tiles, floor, Tile.Floor);
  const wanted = rng.int(tuning.pillars[0], tuning.pillars[1]);
  let placed = 0;
  for (let tries = 0; tries < wanted * 8 && placed < wanted; tries++) {
    const w = 2;
    const h = rng.chance(0.25) ? 3 : 2;
    if (floor.x2 - 1 - w < floor.x1 + 2 || floor.y2 - 1 - h < floor.y1 + 2) break;
    const x = rng.int(floor.x1 + 2, floor.x2 - 1 - w);
    const y = rng.int(floor.y1 + 2, floor.y2 - 1 - h);
    // The halo keeps pillars from touching each other or the walls, so the
    // floor around them always stays walkable.
    if (!allFloor(tiles, x - 1, y - 1, x + w, y + h)) continue;
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) tiles.set(px, py, Tile.Wall);
    }
    placed++;
  }
  return [{ ...floor }];
}

/**
 * Cabins: a miniature BSP with a corridor chain, so connectivity is structural.
 *
 * Every room is inset one tile inside its slot, which is what turns the seam
 * between two neighbouring rooms from one wall line into two: at that width a
 * wall reads as a wall instead of as a smudge between two floors.
 */
function drawRooms(tiles: Grid<Tile>, floor: RoomRect, tuning: DensityTuning, rng: Rng): RoomRect[] {
  const target = rng.int(tuning.roomCount[0], tuning.roomCount[1]);
  const leaves: RoomRect[] = [{ ...floor }];
  while (leaves.length < target) {
    let best = -1;
    let bestArea = 0;
    for (let i = 0; i < leaves.length; i++) {
      const r = leaves[i]!;
      const w = r.x2 - r.x1 + 1;
      const h = r.y2 - r.y1 + 1;
      if (w < 10 && h < 8) continue;
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = i;
      }
    }
    if (best < 0) break;
    const r = leaves[best]!;
    const w = r.x2 - r.x1 + 1;
    const h = r.y2 - r.y1 + 1;
    if (w >= 10 && (h < 8 || w >= h)) {
      const cut = r.x1 + rng.int(4, w - 6);
      leaves.splice(best, 1, { ...r, x2: cut }, { ...r, x1: cut + 1 });
    } else {
      const cut = r.y1 + rng.int(3, h - 5);
      leaves.splice(best, 1, { ...r, y2: cut }, { ...r, y1: cut + 1 });
    }
  }

  const [fillLo, fillHi] = tuning.roomFill;
  const rooms: RoomRect[] = [];
  for (const leaf of leaves) {
    // Shrink the slot by one on every side first: the margin is the air.
    const slot: RoomRect = { x1: leaf.x1 + 1, y1: leaf.y1 + 1, x2: leaf.x2 - 1, y2: leaf.y2 - 1 };
    const w = slot.x2 - slot.x1 + 1;
    const h = slot.y2 - slot.y1 + 1;
    if (w < 2 || h < 2) continue;
    const rw = clamp(Math.floor(w * (fillLo + rng.next() * (fillHi - fillLo))), 2, w);
    const rh = clamp(Math.floor(h * (fillLo + rng.next() * (fillHi - fillLo))), 2, h);
    const rx = slot.x1 + rng.int(0, w - rw);
    const ry = slot.y1 + rng.int(0, h - rh);
    const room: RoomRect = { x1: rx, y1: ry, x2: rx + rw - 1, y2: ry + rh - 1 };
    fillRect(tiles, room, Tile.Floor);
    rooms.push(room);
  }

  // A one-tile corridor across a hall-sized sector reads as a crack in the
  // floor; two tiles reads as a passage someone walks down.
  const width = floor.x2 - floor.x1 + 1 > WIDE_SECTOR ? 2 : 1;
  for (let i = 1; i < rooms.length; i++) {
    corridor(tiles, floor, roomCenter(rooms[i - 1]!), roomCenter(rooms[i]!), width);
  }
  return rooms;
}

/**
 * A packed hold: cellular automata, then reconnected inside the sector only.
 * The cave then loses its lone pillars and its one-tile stubs — both are the
 * texture that makes a cluttered sector unreadable rather than cluttered.
 */
function drawCluttered(tiles: Grid<Tile>, floor: RoomRect, tuning: DensityTuning, rng: Rng): RoomRect[] {
  for (let y = floor.y1; y <= floor.y2; y++) {
    for (let x = floor.x1; x <= floor.x2; x++) {
      tiles.set(x, y, rng.chance(tuning.clutter) ? Tile.Wall : Tile.Floor);
    }
  }
  for (let gen = 0; gen < 4; gen++) {
    const next: Tile[] = [];
    for (let y = floor.y1; y <= floor.y2; y++) {
      for (let x = floor.x1; x <= floor.x2; x++) {
        let walls = 0;
        for (const d of DIRS8) {
          const nx = x + d.x;
          const ny = y + d.y;
          // Outside the sector counts as wall: the frame must stay solid.
          if (nx < floor.x1 || nx > floor.x2 || ny < floor.y1 || ny > floor.y2) walls++;
          else if (tiles.at(nx, ny) === Tile.Wall) walls++;
        }
        const isWall = tiles.at(x, y) === Tile.Wall;
        next.push((isWall ? walls >= 4 : walls >= 5) ? Tile.Wall : Tile.Floor);
      }
    }
    let i = 0;
    for (let y = floor.y1; y <= floor.y2; y++) {
      for (let x = floor.x1; x <= floor.x2; x++) tiles.set(x, y, next[i++]!);
    }
  }
  smoothPillars(tiles, floor);
  connectRegionsInRect(tiles, floor);
  widenThreads(tiles, floor);
  removeDeadEndsInRect(tiles, floor);
  // Trimming stubs can strand what the tunnels had just joined back on; the
  // second pass costs nothing on a cave that was already one piece.
  connectRegionsInRect(tiles, floor);
  return [];
}

/**
 * Widen the one-tile threads a cellular cave is full of, until nearly every
 * walkable tile sits in some 2x2 block of floor. Width is what the eye reads:
 * a two-tile passage is a passage, a one-tile one is a hairline that the
 * player has to trace tile by tile.
 *
 * Only tiles inside `floor` are ever opened, so the sector's frame — and with
 * it the "zones touch only through airlocks" invariant — is untouched.
 */
function widenThreads(tiles: Grid<Tile>, floor: RoomRect, passes = 2): void {
  const blocked = (x: number, y: number): boolean =>
    x < floor.x1 || x > floor.x2 || y < floor.y1 || y > floor.y2 || !TILES[tiles.at(x, y)].walkable;
  const inBlock = (x: number, y: number): boolean =>
    CORNERS.some(([ox, oy]) => !blocked(x + ox, y + oy) && !blocked(x + ox + 1, y + oy)
      && !blocked(x + ox, y + oy + 1) && !blocked(x + ox + 1, y + oy + 1));

  for (let pass = 0; pass < passes; pass++) {
    let opened = 0;
    for (let y = floor.y1; y <= floor.y2; y++) {
      for (let x = floor.x1; x <= floor.x2; x++) {
        if (blocked(x, y) || inBlock(x, y)) continue;
        // Of the four blocks this tile could belong to, complete the cheapest
        // one — and only if every tile it needs is ours to carve.
        let best: Point[] | undefined;
        for (const [ox, oy] of CORNERS) {
          const missing: Point[] = [];
          let carveable = true;
          for (const [dx, dy] of CORNERS_OF_BLOCK) {
            const px = x + ox + dx;
            const py = y + oy + dy;
            if (px < floor.x1 || px > floor.x2 || py < floor.y1 || py > floor.y2) {
              carveable = false;
              break;
            }
            if (blocked(px, py)) missing.push({ x: px, y: py });
          }
          if (!carveable) continue;
          if (!best || missing.length < best.length) best = missing;
        }
        if (!best || best.length === 0) continue;
        for (const p of best) tiles.set(p.x, p.y, Tile.Floor);
        opened += best.length;
      }
    }
    if (opened === 0) return;
  }
}

/** Offsets of the four cells of a 2x2 block from its top-left corner. */
const CORNERS_OF_BLOCK: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** Top-left corners of the four 2x2 blocks a tile can belong to. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [[0, 0], [-1, 0], [0, -1], [-1, -1]];

/**
 * Open every wall tile that is an island in the floor. One-tile pillars are
 * what turns a cave into static: they cost the player nothing to walk around
 * and they hide the tiles that do matter.
 */
function smoothPillars(tiles: Grid<Tile>, floor: RoomRect): void {
  const lone: Point[] = [];
  for (let y = floor.y1; y <= floor.y2; y++) {
    for (let x = floor.x1; x <= floor.x2; x++) {
      if (TILES[tiles.at(x, y)].walkable) continue;
      let walls = 0;
      for (const d of DIRS8) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < floor.x1 || nx > floor.x2 || ny < floor.y1 || ny > floor.y2) walls++;
        else if (!TILES[tiles.at(nx, ny)].walkable) walls++;
      }
      if (walls <= 1) lone.push({ x, y });
    }
  }
  for (const p of lone) tiles.set(p.x, p.y, Tile.Floor);
}

// -------------------------------------------------------------- zone graph

/**
 * Two sectors are neighbours when their rects touch along a wall of at least
 * three tiles. `spots` are the wall tiles an airlock may occupy: exactly those
 * with carve-able floor of both sectors on either side.
 */
function findAdjacencies(sectors: readonly Slab[]): Adjacency[] {
  const out: Adjacency[] = [];
  for (let i = 0; i < sectors.length; i++) {
    for (let j = i + 1; j < sectors.length; j++) {
      const a = sectors[i]!;
      const b = sectors[j]!;
      const link = horizontalLink(a, b) ?? horizontalLink(b, a) ?? verticalLink(a, b) ?? verticalLink(b, a);
      if (!link) continue;
      out.push({ a: i, b: j, axis: link.axis, spots: link.spots, span: link.span });
    }
  }
  return out;
}

function score(tiles: Grid<Tile>, p: Point): number {
  let open = 0;
  for (const d of DIRS4) {
    const t = tiles.get(p.x + d.x, p.y + d.y);
    if (t !== undefined && TILES[t].walkable) open++;
  }
  return open;
}

/** `a` left of `b`: the wall is `a`'s own last column. */
function horizontalLink(a: Slab, b: Slab): { axis: "h"; spots: Point[]; span: number } | undefined {
  if (a.rect.x2 + 1 !== b.rect.x1) return undefined;
  const lo = Math.max(a.rect.y1, b.rect.y1);
  const hi = Math.min(a.rect.y2, b.rect.y2);
  if (hi < lo) return undefined;
  const wall = a.rect.x2;
  if (a.floor.x2 !== wall - 1 || b.floor.x1 !== wall + 1) return undefined;

  const spots: Point[] = [];
  for (let y = Math.max(a.floor.y1, b.floor.y1); y <= Math.min(a.floor.y2, b.floor.y2); y++) {
    spots.push({ x: wall, y });
  }
  return spots.length > 0 ? { axis: "h", spots, span: hi - lo + 1 } : undefined;
}

/** `a` above `b`: the wall is `a`'s own last row. */
function verticalLink(a: Slab, b: Slab): { axis: "v"; spots: Point[]; span: number } | undefined {
  if (a.rect.y2 + 1 !== b.rect.y1) return undefined;
  const lo = Math.max(a.rect.x1, b.rect.x1);
  const hi = Math.min(a.rect.x2, b.rect.x2);
  if (hi < lo) return undefined;
  const wall = a.rect.y2;
  if (a.floor.y2 !== wall - 1 || b.floor.y1 !== wall + 1) return undefined;

  const spots: Point[] = [];
  for (let x = Math.max(a.floor.x1, b.floor.x1); x <= Math.min(a.floor.x2, b.floor.x2); x++) {
    spots.push({ x, y: wall });
  }
  return spots.length > 0 ? { axis: "v", spots, span: hi - lo + 1 } : undefined;
}

/**
 * Random-weight spanning tree plus a couple of loops. The tree is what makes
 * every zone reachable; the loops are what stop a deck from being a corridor
 * with no route choices.
 */
function chooseEdges(count: number, adjacencies: Adjacency[], extra: number | undefined, rng: Rng): ChosenEdge[] {
  // A short wall is a last resort: preferred edges sort first.
  const ranked = adjacencies
    .map((adj) => ({ adj, w: rng.next() + (adj.span >= 3 ? 0 : 10) }))
    .sort((p, q) => p.w - q.w);

  const parent: number[] = new Array(count).fill(0).map((_v, i) => i);
  const find = (x: number): number => (parent[x]! === x ? x : (parent[x] = find(parent[x]!)));

  const chosen: ChosenEdge[] = [];
  const rest: Adjacency[] = [];
  for (const { adj } of ranked) {
    const ra = find(adj.a);
    const rb = find(adj.b);
    if (ra === rb) rest.push(adj);
    else {
      parent[ra] = rb;
      chosen.push({ edge: adj, tree: true });
    }
  }
  if (chosen.length !== count - 1) {
    throw new Error(`DeckBuilder: sector adjacency graph is disconnected (${chosen.length + 1} components)`);
  }

  const wanted = extra ?? rng.int(1, 2);
  rng.shuffle(rest);
  for (let i = 0; i < wanted && i < rest.length; i++) chosen.push({ edge: rest[i]!, tree: false });
  return chosen;
}

/** The default for `DeckPlan.edgeTile`: every graph edge is a plain airlock. */
const ALWAYS_AIRLOCK = (): Tile => Tile.Airlock;

/** How far the way out may be from the way in, in steps. */
const OUTER_AIRLOCK_RADIUS = 3;

/**
 * The way off the deck, next to the way onto it.
 *
 * Plain floor only, so it can never land on an inner airlock, and inside the
 * entry zone's own floor, so leaving never means crossing the ship first. If
 * the arrival point has no floor near it at all, it becomes the exit itself:
 * a deck the player cannot leave is worse than one they leave from underfoot.
 */
function cutOuterAirlock(tiles: Grid<Tile>, from: Point, bounds: RoomRect, rng: Rng): void {
  const dist = new Grid<number>(tiles.width, tiles.height, -1);
  dist.set(from.x, from.y, 0);
  const queue: Point[] = [from];
  let head = 0;
  const candidates: Point[] = [];
  let bestD = Infinity;

  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist.at(cur.x, cur.y);
    if (d > 0 && d <= bestD && tiles.at(cur.x, cur.y) === Tile.Floor) {
      if (d < bestD) {
        bestD = d;
        candidates.length = 0;
      }
      candidates.push(cur);
    }
    if (d >= OUTER_AIRLOCK_RADIUS) continue;
    for (const dir of DIRS4) {
      const n = { x: cur.x + dir.x, y: cur.y + dir.y };
      if (!inRect(bounds, n) || dist.at(n.x, n.y) !== -1) continue;
      if (!TILES[tiles.at(n.x, n.y)].walkable) continue;
      dist.set(n.x, n.y, d + 1);
      queue.push(n);
    }
  }

  const at = candidates.length > 0 ? rng.pick(candidates) : from;
  tiles.set(at.x, at.y, Tile.AirlockOut);
}

/**
 * One airlock tile per edge. When no spot has floor on both sides already, dig
 * a single cell into each sector and tunnel it back to that sector's own floor
 * — the tunnel never leaves the sector, so no second passage is ever created.
 */
function cutAirlocks(
  tiles: Grid<Tile>,
  sectors: Sector[],
  zones: Zone[],
  chosen: ChosenEdge[],
  edgeTile: (isTreeEdge: boolean) => Tile,
  rng: Rng,
): void {
  for (const { edge, tree } of chosen) {
    const a = sectors[edge.a]!;
    const b = sectors[edge.b]!;
    // Spots with floor on both sides need no digging; pick among those first.
    const best = Math.max(...edge.spots.map((p) => score(tiles, p)));
    const at = rng.pick(edge.spots.filter((p) => score(tiles, p) === best));

    const sides: Point[] = edge.axis === "h"
      ? [{ x: at.x - 1, y: at.y }, { x: at.x + 1, y: at.y }]
      : [{ x: at.x, y: at.y - 1 }, { x: at.x, y: at.y + 1 }];

    for (const side of sides) {
      const owner = inRect(a.floor, side) ? a : b;
      if (!TILES[tiles.at(side.x, side.y)].walkable) {
        tiles.set(side.x, side.y, Tile.Floor);
        tunnelToFloor(tiles, owner.floor, side);
      }
    }
    tiles.set(at.x, at.y, edgeTile(tree));
    zones[edge.a]!.airlocks.push({ x: at.x, y: at.y });
    zones[edge.b]!.airlocks.push({ x: at.x, y: at.y });
  }
}

// ------------------------------------------------------------------ helpers

function fillRect(tiles: Grid<Tile>, r: RoomRect, t: Tile): void {
  for (let y = r.y1; y <= r.y2; y++) {
    for (let x = r.x1; x <= r.x2; x++) tiles.set(x, y, t);
  }
}

function allFloor(tiles: Grid<Tile>, x1: number, y1: number, x2: number, y2: number): boolean {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (tiles.get(x, y) !== Tile.Floor) return false;
    }
  }
  return true;
}

/**
 * L-shaped tunnel that never leaves `bounds`. `width` 2 digs a second lane
 * beside the first, on whichever side stays inside the bounds.
 */
function corridor(tiles: Grid<Tile>, bounds: RoomRect, from: Point, to: Point, width = 1): void {
  let x = from.x;
  let y = from.y;
  const open = (px: number, py: number) => {
    if (inRect(bounds, { x: px, y: py }) && !TILES[tiles.at(px, py)].walkable) tiles.set(px, py, Tile.Floor);
  };
  const dig = (ox: number, oy: number) => {
    open(x, y);
    if (width > 1) open(x + ox, y + oy);
  };

  const sideY = y + 1 <= bounds.y2 ? 1 : -1;
  dig(0, sideY);
  while (x !== to.x) {
    x += Math.sign(to.x - x);
    dig(0, sideY);
  }
  const sideX = x + 1 <= bounds.x2 ? 1 : -1;
  while (y !== to.y) {
    y += Math.sign(to.y - y);
    dig(sideX, 0);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A walkable tile near the middle of `rect`, for the player's arrival. */
function interiorSpot(tiles: Grid<Tile>, rect: RoomRect): Point | undefined {
  const cx = (rect.x1 + rect.x2) >> 1;
  const cy = (rect.y1 + rect.y2) >> 1;
  let best: Point | undefined;
  let bestD = Infinity;
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1; x <= rect.x2; x++) {
      if (tiles.at(x, y) !== Tile.Floor) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Farthest plain floor tile inside `rect`, by walking distance from `from`.
 * Plain floor only: an airlock is walkable, and a hatch cut into one would sit
 * in the doorway of two zones at once.
 */
function farthestFloorIn(tiles: Grid<Tile>, from: Point, rect: RoomRect): Point | undefined {
  const dist = new Grid<number>(tiles.width, tiles.height, -1);
  dist.set(from.x, from.y, 0);
  const queue: Point[] = [from];
  let head = 0;
  let best: Point | undefined;
  let bestD = -1;

  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist.at(cur.x, cur.y);
    if (d > bestD && tiles.at(cur.x, cur.y) === Tile.Floor && inRect(rect, cur)) {
      bestD = d;
      best = cur;
    }
    for (const dir of DIRS4) {
      const nx = cur.x + dir.x;
      const ny = cur.y + dir.y;
      if (!tiles.inBounds(nx, ny) || dist.at(nx, ny) !== -1) continue;
      if (!TILES[tiles.at(nx, ny)].walkable) continue;
      dist.set(nx, ny, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  return best;
}
