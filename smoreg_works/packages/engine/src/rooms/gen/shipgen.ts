import type { Rng } from "../../sim/rng.js";
import { Ship, type Door, type DoorState, type Room, type RoomId } from "../graph.js";
import type { CardContext, RoomCard, RoomKindSpec, ShipProblem, ShipSpec } from "../types.js";
import { MAX_COLUMN, layoutFaults, layoutShip, parentDoor, treeDoors } from "./layout.js";
import { DEEP_DEPTH, KEY_MARK, LOCK_ENTRY, reachableWithKeys, validateShip } from "./validate.js";
import { HEX_KEY, hexAround, hexKey, type HexCell } from "./hexlayout.js";

/**
 * The ship generator: a spanning tree of compartments, a handful of loops back,
 * doors by weight, locks by Dormans's rule, and cards on top.
 *
 * None of the three tools the owner pointed at could be imported — a web app
 * with no source, a subscription site with no API, and a set of CC BY-NC images
 * — so what they actually contribute is their vocabulary and their joining
 * rule, and both live in the spec a game hands in. The engine knows no room
 * kind, no mark and no key: it grows a graph that satisfies the guarantees in
 * `validateShip`, and everything that means something is a string it carries.
 *
 * The shape of the loop is `buildLevel`'s, because the reason is the same: a
 * generator that can fail cheaply and retry is worth more than one that tries
 * to be correct by construction and quietly is not.
 */

/** Retries before the generator ships the least-bad attempt. */
export const MAX_SHIP_ATTEMPTS = 14;

/**
 * Loops added back, as a share of the tree's edges.
 *
 * It was `[0.15, 0.25]` and that made a ship a tree with two or three
 * shortcuts: half of every hull had exactly one way back to the airlock, so
 * meeting anything in a corridor meant fighting it, and running — one of the
 * three things the alert and the hunter exist to make you do — was not
 * available. The owner put it plainly: «граф имеет мало циклов и не получается
 * мансить от охраны, ты всегда в тупике» (docs/owner-queue.md, 3).
 *
 * Measured over 200 seeds of each of the seven classes, before and after:
 * compartments with a second way home 57.8 % -> 84.7 % (by depth from the
 * airlock, 72/62/51/32 % -> 93/88/82/65 %), loops a hull 3.13 -> 6.65, dead
 * ends a hull 3.77 -> 1.70, the longest dead-end branch 5 -> 3. Nothing else
 * about the generator moved: the rooms, the cards, the keys and the door states
 * are drawn exactly as before.
 *
 * What it costs is ports. A fifth of compartments now use all four of theirs
 * against one in fifteen before (`MAX_DEGREE`), so the cap is what a further
 * rise would run into first — and that cap is the width of a box on the
 * schematic, not a fact about ships.
 */
const LOOP_SHARE: readonly [number, number] = [0.35, 0.5];

/**
 * The same budget for a lattice hull, asked for larger because less of it can
 * be spent.
 *
 * A free grower may join any two rooms a depth apart; a lattice one may only
 * join cells that touch, and a compact blob's cells have their four ports half
 * used by the tree already. Asked for `LOOP_SHARE` the lattice landed a fifth
 * fewer doors than the hull the balance was measured on — laboratory 16.7
 * against 20.8 — and fewer doors is fewer locks, less loot in front of them,
 * and fewer ways home, which is the complaint the loop share exists to answer.
 * The number is what brings the door count back level; it is not a taste.
 */
const LATTICE_LOOPS: readonly [number, number] = [0.62, 0.82];

/** A room may hang two more off itself, and no more. */
const MAX_CHILDREN = 2;

/** Occupied neighbours past which a lattice cell is no more attractive. */
const COMPACT_CAP = 3;

/** Doors on one room: what the box on the schematic has ports for. */
const MAX_DEGREE = 4;

/** Empty run state, for a ship generated outside a run. */
export const NO_CARD_STATE: CardContext = { flags: new Set<string>(), shipIndex: 0 };

export interface PlacedCard {
  card: RoomCard;
  room: RoomId;
}

/**
 * Everything one generated ship is, beside the graph itself.
 *
 * `Ship` is the flat thing that goes into a save file, so the keys and the
 * flags the cards raised ride out here instead of hanging off it — the same
 * bargain `GeneratedLevel` strikes with `Level`. The keys are also written into
 * the rooms as `key:k1` marks, which is how they survive a save; this list is
 * the convenient view of them.
 */
export interface GeneratedShip {
  ship: Ship;
  /** Flags the placed cards raised; the game folds them into its run flags. */
  flagsSet: string[];
  keys: Array<{ id: string; room: RoomId }>;
  cards: PlacedCard[];
  attempts: number;
  /** Problems that survived every attempt. Empty in the normal case. */
  problems: ShipProblem[];
}

/**
 * One ship, pure in `(spec, rng, ctx)`. The rng is forked per attempt, so the
 * caller's stream is untouched and the same rng twice gives the same ship.
 */
export function generateShip(spec: ShipSpec, rng: Rng, ctx: CardContext = NO_CARD_STATE): Ship {
  return buildShip(spec, rng, ctx).ship;
}

/** As `generateShip`, keeping what the game needs beside the graph. */
export function buildShip(spec: ShipSpec, rng: Rng, ctx: CardContext = NO_CARD_STATE): GeneratedShip {
  let leastBad: GeneratedShip | undefined;

  for (let attempt = 0; attempt < MAX_SHIP_ATTEMPTS; attempt++) {
    const built = assemble(spec, rng.fork(attempt), ctx);
    const problems = validateShip(built.ship, spec);
    const candidate: GeneratedShip = { ...built, attempts: attempt + 1, problems };
    if (problems.length === 0) return candidate;
    if (!leastBad || problems.length < leastBad.problems.length) leastBad = candidate;
  }
  return leastBad!;
}

/** Kind and precondition: `vaultEligible` with the tiles taken out. */
export function cardEligible(card: RoomCard, ctx: CardContext, kind: string): boolean {
  if (card.kinds && !card.kinds.includes(kind)) return false;
  if (card.when && !card.when(ctx)) return false;
  return true;
}

/** Weight after the situational multiplier. Zero means "not this run". */
export function cardWeight(card: RoomCard, ctx: CardContext): number {
  const base = card.weight ?? 1;
  const mult = card.weightWhen ? card.weightWhen(ctx) : 1;
  return Math.max(0, base * mult);
}

/** The work in progress: rooms and doors before they are a `Ship`. */
interface Build {
  spec: ShipSpec;
  rng: Rng;
  ctx: CardContext;
  rooms: Room[];
  doors: Door[];
  /** Rooms this attempt aims for, drawn once from the spec's range. */
  target: number;
  /** Doors per room, kept as we go so the open-node filter stays cheap. */
  deg: number[];
  children: number[];
  /** Kinds not required and not yet used; refilled when the catalogue runs out. */
  fresh: Set<string>;
  /** Required kinds still owed. */
  owed: RoomKindSpec[];
  keys: Array<{ id: string; room: RoomId }>;
  cards: PlacedCard[];
  flagsSet: string[];
}

function assemble(spec: ShipSpec, rng: Rng, ctx: CardContext): Omit<GeneratedShip, "attempts" | "problems"> {
  const b = start(spec, rng, ctx);
  if (spec.lattice === true) {
    growLattice(b);
  } else {
    growTree(b);
    addLoops(b);
  }

  const ship = shipOf(b);
  layoutShip(ship);
  setDoorStates(b, ship);
  placeKeys(b, ship);
  placeCards(b, ship);

  return { ship, flagsSet: b.flagsSet, keys: b.keys, cards: b.cards };
}

function start(spec: ShipSpec, rng: Rng, ctx: CardContext): Build {
  const entry = spec.kinds.find((k) => k.kind === spec.entryKind) ?? {
    kind: spec.entryKind,
    name: spec.entryKind.toUpperCase(),
  };
  const b: Build = {
    spec,
    rng,
    ctx,
    rooms: [makeRoom(0, entry, 0)],
    // The airlock is a loop on the entry: nothing in the engine needs a node
    // for "outside", and every walk over the graph ignores a self-edge.
    doors: [{ id: 0, label: "a1", a: 0, b: 0, state: "airlock" }],
    target: rng.int(spec.rooms[0], spec.rooms[1]),
    deg: [1],
    children: [0],
    fresh: new Set(spec.kinds.filter((k) => !k.required && k.kind !== spec.entryKind).map((k) => k.kind)),
    owed: spec.kinds.filter((k) => k.required && k.kind !== spec.entryKind),
    keys: [],
    cards: [],
    flagsSet: [],
  };
  return b;
}

function shipOf(b: Build): Ship {
  return new Ship(b.rooms, b.doors, 0);
}

/**
 * Grow until the ship is the size it drew, then keep growing while a required
 * kind is still owed — a `deep` one has nowhere to go until the tree reaches
 * depth 3, and a ship without its reactor is worth less than a ship one room
 * over its nominal size.
 */
function growTree(b: Build): void {
  for (let guard = 0; guard < 500; guard++) {
    const short = b.rooms.length < b.target;
    const owed = b.owed.length > 0 && b.rooms.length < b.spec.rooms[1];
    if (!short && !owed) return;
    if (!growOne(b, short)) return;
  }
}

function growOne(b: Build, short: boolean): boolean {
  const pool = b.rooms.filter((r) => canHost(b, r));
  // Nothing deep enough for the reactor yet: dig instead of sprawling.
  const dig = !short || (b.owed.some((k) => k.deep) && !pool.some((r) => r.depth + 1 >= DEEP_DEPTH));

  while (pool.length > 0) {
    const node = pickWeighted(pool, (r) => nodeWeight(b, r, dig), b.rng);
    if (!node) return false;
    const kind = pickKind(b, node.depth + 1, short);
    if (kind && attach(b, node, kind)) return true;
    pool.splice(pool.indexOf(node), 1);
  }
  return false;
}

/**
 * The design brief's weight: the fewer children a room has and the shallower
 * it is, the more often it is chosen — which spreads the ship sideways near the
 * airlock and lets it taper as it goes in. Digging inverts that.
 */
function nodeWeight(b: Build, r: Room, dig: boolean): number {
  if (dig) return r.depth + 1 >= DEEP_DEPTH ? 100 : r.depth + 1;
  return (MAX_CHILDREN + 1 - b.children[r.id]!) * (b.spec.maxDepth - r.depth + 1);
}

function canHost(b: Build, r: Room): boolean {
  return (
    b.children[r.id]! < MAX_CHILDREN &&
    b.deg[r.id]! < MAX_DEGREE &&
    r.depth < b.spec.maxDepth &&
    countAt(b, r.depth + 1) < MAX_COLUMN
  );
}

function countAt(b: Build, depth: number): number {
  let n = 0;
  for (const r of b.rooms) if (r.depth === depth) n++;
  return n;
}

/**
 * What the next room is. A required kind is forced in as the slots run out, and
 * offered before that with the urgency of how many are owed; everything else is
 * drawn by weight from the kinds this ship has not used yet, so a catalogue of
 * twenty types gives twenty different rooms before it repeats one.
 */
function pickKind(b: Build, depth: number, short: boolean): RoomKindSpec | undefined {
  const ready = b.owed.filter((k) => !k.deep || depth >= DEEP_DEPTH);
  const slots = Math.max(1, b.target - b.rooms.length);
  if (ready.length > 0 && (!short || b.owed.length >= slots || b.rng.chance(b.owed.length / slots))) {
    return pickWeighted(ready, (k) => k.weight ?? 1, b.rng);
  }

  let free = b.spec.kinds.filter((k) => b.fresh.has(k.kind));
  if (free.length === 0) {
    for (const k of b.spec.kinds) if (!k.required && k.kind !== b.spec.entryKind) b.fresh.add(k.kind);
    free = b.spec.kinds.filter((k) => b.fresh.has(k.kind));
  }
  const here = free.filter((k) => !k.deep || depth >= DEEP_DEPTH);
  return pickWeighted(here, (k) => k.weight ?? 1, b.rng);
}

/**
 * Hang a room off `node`, and take it straight back off if the schematic could
 * not draw the result. Checking the layout here rather than at the end is what
 * makes a ship drawable by construction: the generator never has to guess which
 * of twenty rooms made the picture impossible.
 */
function attach(b: Build, node: Room, kind: RoomKindSpec): boolean {
  const room = makeRoom(b.rooms.length, kind, node.depth + 1);
  b.rooms.push(room);
  b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: node.id, b: room.id, state: "open" });
  b.deg.push(1);
  b.children.push(0);

  const trial = shipOf(b);
  layoutShip(trial);
  if (layoutFaults(trial).length > 0) {
    b.rooms.pop();
    b.doors.pop();
    b.deg.pop();
    b.children.pop();
    layoutShip(shipOf(b));
    return false;
  }

  b.deg[node.id]!++;
  b.children[node.id]!++;
  b.fresh.delete(kind.kind);
  b.owed = b.owed.filter((k) => k.kind !== kind.kind);
  return true;
}

// ------------------------------------------------------------- the lattice

/**
 * The same ship, grown on a hexagonal lattice instead of as a free tree.
 *
 * The owner's rule, both halves of it: «связаны только соседние соты, рандомных
 * телепортов нет, но переходов на ВСЕХ стыках сот друг с другом нет». So a
 * compartment is a cell, a door may only join two cells that touch, and a
 * shared edge is a door only sometimes — the walls between neighbours are what
 * is left to read.
 *
 * Two ceilings are kept exactly as the free grower keeps them, and they are not
 * decoration: six compartments at one depth and four doors on one compartment
 * are what the *terminal* schematic can draw — six rows in a column, four ports
 * on a box. The honeycomb has no such limits, but the ASCII screen is the one
 * the jam entry is judged in, and a hull it cannot draw is not worth a prettier
 * deck plan. It is why the lattice grows as a ribbon rather than a slab.
 *
 * Failure is cheap: an attempt that paints itself into a corner comes out short
 * or unbalanced, `validateShip` says so, and `buildShip` forks the rng and tries
 * again. That is the same bargain the free grower strikes.
 */
function growLattice(b: Build): void {
  const cells = new Map<RoomId, HexCell>();
  const taken = new Map<string, RoomId>();
  const home: HexCell = { q: 0, r: 0 };
  cells.set(0, home);
  taken.set(hexKey(home), 0);
  b.rooms[0]!.data[HEX_KEY] = home;

  for (let guard = 0; guard < 500; guard++) {
    const short = b.rooms.length < b.target;
    const owed = b.owed.length > 0 && b.rooms.length < b.spec.rooms[1];
    if (!short && !owed) break;
    if (!growCell(b, cells, taken, short)) break;
  }
  joinNeighbours(b, cells, taken);
}

/** One more cell on the edge of the blob, with the one door that reaches it. */
function growCell(
  b: Build,
  cells: Map<RoomId, HexCell>,
  taken: Map<string, RoomId>,
  short: boolean,
): boolean {
  const spots = frontier(b, cells, taken);
  if (spots.length === 0) return false;
  // Fewer occupied neighbours first, so the hull comes out an irregular ribbon
  // rather than a solid slab — and a slab is also what runs into the six-per-
  // depth ceiling first. Depth breaks the tie the way the free grower does.
  const spot = pickWeighted(spots, (s) => s.weight, b.rng);
  if (!spot) return false;

  const parent = b.rooms[spot.parent]!;
  const kind = pickKind(b, parent.depth + 1, short);
  if (!kind) return false;

  const room = makeRoom(b.rooms.length, kind, parent.depth + 1);
  room.data[HEX_KEY] = spot.cell;
  b.rooms.push(room);
  b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: parent.id, b: room.id, state: "open" });
  b.deg.push(1);
  b.children.push(0);

  const trial = shipOf(b);
  layoutShip(trial);
  if (layoutFaults(trial).length > 0) {
    b.rooms.pop();
    b.doors.pop();
    b.deg.pop();
    b.children.pop();
    layoutShip(shipOf(b));
    return false;
  }

  cells.set(room.id, spot.cell);
  taken.set(hexKey(spot.cell), room.id);
  b.deg[parent.id]!++;
  b.children[parent.id]!++;
  b.fresh.delete(kind.kind);
  b.owed = b.owed.filter((k) => k.kind !== kind.kind);
  return true;
}

interface Spot {
  cell: HexCell;
  /** The compartment the one door into this cell comes from. */
  parent: RoomId;
  weight: number;
}

/** Free cells beside the blob that a compartment could legally go in. */
function frontier(b: Build, cells: Map<RoomId, HexCell>, taken: Map<string, RoomId>): Spot[] {
  const out = new Map<string, Spot>();
  for (const [id, cell] of cells) {
    const host = b.rooms[id]!;
    if (b.children[id]! >= MAX_CHILDREN || b.deg[id]! >= MAX_DEGREE) continue;
    if (host.depth >= b.spec.maxDepth) continue;
    if (countAt(b, host.depth + 1) >= MAX_COLUMN) continue;
    for (const next of hexAround(cell)) {
      const at = hexKey(next);
      if (taken.has(at)) continue;
      const filled = hexAround(next).filter((c) => taken.has(hexKey(c))).length;
      // Cells that already have neighbours first — a hull that grows compact is
      // a hull whose three systems are a walk apart rather than a hike, and it
      // leaves more shared edges for the walls to be interesting on. The cap is
      // what keeps it from balling up: past three occupied neighbours the
      // preference stops rising, and the blob comes out a thick ribbon instead
      // of a disc. Both halves are measured — `tests/balance.test.ts` reads the
      // median run at 169 turns here against 148 with no cap and 202 with no
      // ceiling on the preference, and the last of those loses the hull the
      // voyage is for.
      //
      // Shallow parents break the tie, the way `nodeWeight` does.
      const weight = (1 + Math.min(filled, COMPACT_CAP)) * (MAX_CHILDREN + 1 - b.children[id]!);
      const seen = out.get(at);
      if (seen === undefined || weight > seen.weight) out.set(at, { cell: next, parent: id, weight });
    }
  }
  return [...out.values()];
}

/**
 * The doors that are not the way in: some of the walls between neighbouring
 * cells, and never all of them.
 *
 * `LOOP_SHARE` is the same budget the free grower spends, so a lattice hull has
 * the same number of ways home as the hull the balance was measured on — the
 * owner's «не получается мансить от охраны» is answered by the count of loops,
 * not by where they are. What changes is that a loop is now always a wall
 * between two compartments that stand next to each other, which is the only
 * kind of loop a honeycomb can draw.
 */
function joinNeighbours(b: Build, cells: Map<RoomId, HexCell>, taken: Map<string, RoomId>): void {
  const tree = b.doors.length - 1;
  const wanted = Math.round(tree * (LATTICE_LOOPS[0] + b.rng.next() * (LATTICE_LOOPS[1] - LATTICE_LOOPS[0])));
  if (wanted <= 0) return;

  const joined = new Set(b.doors.map((d) => pairKey(d.a, d.b)));
  const pairs: Array<[RoomId, RoomId]> = [];
  for (const [id, cell] of cells) {
    for (const next of hexAround(cell)) {
      const far = taken.get(hexKey(next));
      if (far === undefined || far <= id) continue;
      if (joined.has(pairKey(id, far))) continue;
      pairs.push([id, far]);
    }
  }
  b.rng.shuffle(pairs);

  let added = 0;
  for (const [u, v] of pairs) {
    if (added >= wanted) break;
    if (b.deg[u]! >= MAX_DEGREE || b.deg[v]! >= MAX_DEGREE) continue;
    b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: u, b: v, state: "open" });
    // A wall between two cells that touch can join compartments two or three
    // steps apart through the corridors — on a lattice, going round a wall is
    // often longer than going through it — so the door is a real shortcut and
    // every depth behind it changes. Recomputed before the schematic is asked
    // whether it can still draw the result, or the columns would be a lie.
    const depths = deepen(b);
    const trial = shipOf(b);
    layoutShip(trial);
    if (layoutFaults(trial).length > 0) {
      b.doors.pop();
      restore(b, depths);
      continue;
    }
    b.deg[u]!++;
    b.deg[v]!++;
    added++;
  }
  deepen(b);
  layoutShip(shipOf(b));
}

/**
 * Every compartment's depth, recomputed as its distance from the airlock in
 * doors, and the depths as they were before — so a door that turns out to be
 * undrawable can be taken back whole.
 *
 * The free grower never needs this: it joins only rooms a depth apart, and such
 * a door shortens no path. The lattice has no such luxury.
 */
function deepen(b: Build): number[] {
  const was = b.rooms.map((r) => r.depth);
  const reach: number[] = b.rooms.map(() => Infinity);
  reach[0] = 0;
  const queue: RoomId[] = [0];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head]!;
    for (const door of b.doors) {
      if (door.a === door.b) continue;
      const far = door.a === here ? door.b : door.b === here ? door.a : undefined;
      if (far === undefined || reach[far]! <= reach[here]! + 1) continue;
      reach[far] = reach[here]! + 1;
      queue.push(far);
    }
  }
  for (const room of b.rooms) {
    const at = reach[room.id]!;
    if (Number.isFinite(at)) room.depth = at;
  }
  return was;
}

function restore(b: Build, depths: readonly number[]): void {
  for (const room of b.rooms) room.depth = depths[room.id] ?? room.depth;
}

/**
 * Loops: 35-50% of the tree's edges added back between rooms that stand next to
 * each other on the schematic. They are what makes the ship a place to move
 * through rather than a corridor to walk down — a second way round a welded
 * door, a way to be flanked, a way to break off a fight — and the port rules
 * are what keeps them drawable.
 */
function addLoops(b: Build): void {
  const tree = b.doors.length - 1;
  const wanted = Math.round(tree * (LOOP_SHARE[0] + b.rng.next() * (LOOP_SHARE[1] - LOOP_SHARE[0])));
  if (wanted <= 0) return;

  const joined = new Set(b.doors.map((d) => pairKey(d.a, d.b)));
  const pairs: Array<[Room, Room]> = [];
  for (const u of b.rooms) {
    for (const v of b.rooms) {
      if (v.id <= u.id) continue;
      if (Math.abs(u.depth - v.depth) > 1) continue;
      if (joined.has(pairKey(u.id, v.id))) continue;
      pairs.push(u.depth <= v.depth ? [u, v] : [v, u]);
    }
  }
  b.rng.shuffle(pairs);

  let added = 0;
  for (const [u, v] of pairs) {
    if (added >= wanted) break;
    if (b.deg[u.id]! >= MAX_DEGREE || b.deg[v.id]! >= MAX_DEGREE) continue;
    b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: u.id, b: v.id, state: "open" });
    // A loop never moves a room: the layout hangs off the tree, whose doors
    // all carry lower ids. So this only asks whether the ports still work out.
    const trial = shipOf(b);
    layoutShip(trial);
    if (layoutFaults(trial).length > 0) {
      b.doors.pop();
      continue;
    }
    b.deg[u.id]!++;
    b.deg[v.id]!++;
    added++;
  }
}

/**
 * A state per door from the spec's weights, drawn from the states that door is
 * allowed to hold: `locked` belongs to the tree, so a key always lies on this
 * side of it, and `sealed` belongs to the loops, so a weld costs a detour and
 * never a room. Drawing from the allowed subset rather than rolling and then
 * correcting keeps the spec's proportions between the states that remain.
 */
function setDoorStates(b: Build, ship: Ship): void {
  const tree = treeDoors(ship);
  for (const d of b.doors) {
    if (d.state === "airlock") continue;
    d.state = rollDoor(b, tree.has(d.id));
  }
}

function rollDoor(b: Build, onTree: boolean): DoorState {
  const table: Record<string, number> = {};
  for (const [state, weight] of Object.entries(b.spec.doors)) {
    if (weight <= 0) continue;
    if (state === "locked" && !onTree) continue;
    if (state === "sealed" && onTree) continue;
    table[state] = weight;
  }
  if (Object.keys(table).length === 0) return "closed";
  return b.rng.weighted(table) as DoorState;
}

/** Shallowest first, so a key for a deep door may lie behind a shallow one. */
function placeKeys(b: Build, ship: Ship): void {
  const locked = ship.doors
    .filter((d) => d.state === "locked")
    .sort((x, y) => doorDepth(ship, x) - doorDepth(ship, y) || x.id - y.id);

  for (const door of locked) {
    if (!keyFor(b, ship, door)) door.state = "closed";
  }
}

/**
 * Dormans: the key lies in a room the drone can already stand in.
 *
 * Naming the key on the door before looking is what makes that true for free —
 * with no room carrying `key:k3` yet, this door is shut to the walk that
 * decides where the key may go, and so is every other locked door whose key is
 * still unplaced. What comes back is exactly the region on this side.
 */
function keyFor(b: Build, ship: Ship, door: Door): boolean {
  const id = `k${b.keys.length + 1}`;
  door.key = id;

  const candidates = [...reachableWithKeys(ship).rooms].sort((x, y) => x - y);
  if (candidates.length === 0) {
    delete door.key;
    return false;
  }
  const room = ship.roomAt(b.rng.pick(candidates));
  room.marks.push(`${KEY_MARK}${id}`);
  b.keys.push({ id, room: room.id });
  return true;
}

/**
 * Cards, by the storylet rules the grid version already ran on: kind, `when`,
 * weight, `weightWhen`, `sets`, `maxPerShip`. What lands is a list of marks the
 * engine does not read — except `lock-entry`, which is a request to the
 * generator rather than content, and so is executed here.
 */
function placeCards(b: Build, ship: Ship): void {
  const library = b.spec.cards ?? [];
  if (library.length === 0) return;
  const per = b.spec.cardsPerRoom ?? 1;
  const used = new Map<string, number>();

  for (const room of ship.rooms) {
    const here = new Set<string>();
    for (let i = 0; i < per; i++) {
      const table: Record<string, number> = {};
      for (const card of library) {
        if (here.has(card.name)) continue;
        if ((used.get(card.name) ?? 0) >= (card.maxPerShip ?? Infinity)) continue;
        if (!cardEligible(card, b.ctx, room.kind)) continue;
        const weight = cardWeight(card, b.ctx);
        if (weight > 0) table[card.name] = weight;
      }
      if (Object.keys(table).length === 0) break;

      const name = b.rng.weighted(table);
      const card = library.find((c) => c.name === name)!;
      here.add(name);
      used.set(name, (used.get(name) ?? 0) + 1);
      room.marks.push(...card.marks);
      for (const flag of card.sets ?? []) {
        if (!b.flagsSet.includes(flag)) b.flagsSet.push(flag);
      }
      b.cards.push({ card, room: room.id });
      if (card.marks.includes(LOCK_ENTRY)) lockEntry(b, ship, room.id);
    }
  }
}

/** Lock the tree door into a room, keyed by the same rule as every other lock. */
function lockEntry(b: Build, ship: Ship, room: RoomId): void {
  const door = parentDoor(ship, room);
  // Nothing to lock on the entry room; a hole or a weld is nobody's lock again.
  if (!door || (door.state !== "open" && door.state !== "closed")) return;

  const was = door.state;
  door.state = "locked";
  if (!keyFor(b, ship, door)) door.state = was;
}

function doorDepth(ship: Ship, d: Door): number {
  return Math.max(ship.roomAt(d.a).depth, ship.roomAt(d.b).depth);
}

function pairKey(a: RoomId, b: RoomId): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function makeRoom(id: number, kind: RoomKindSpec, depth: number): Room {
  return {
    id,
    label: `r${id + 1}`,
    kind: kind.kind,
    name: kind.name,
    depth,
    col: depth,
    row: 0,
    cover: kind.cover === true,
    hazard: "none",
    explored: false,
    scanned: false,
    marks: [],
    data: {},
  };
}

function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rng: Rng): T | undefined {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return undefined;

  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
