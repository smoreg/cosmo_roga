import type { Door, DoorId, Room, RoomId, Ship } from "../graph.js";
import { parentDoor } from "./layout.js";

/**
 * The same ship on a honeycomb: one hexagon per compartment, one corridor per
 * door, and every corridor a straight segment between two hexagons that touch.
 *
 * A second drawing of the graph and not a second graph. `layoutShip` puts a
 * ship in columns by depth, which draws well as boxes and wires; this puts it
 * on a triangular lattice, which draws well as a deck plan. Both are pure
 * functions of the same rooms and doors, and neither is allowed an opinion the
 * other does not share — a ship loaded from a save lays out identically, and
 * nothing here touches the rng.
 *
 * ## Why some doors are not corridors
 *
 * Asking for *every* door to join two touching hexagons is asking for a
 * unit-distance embedding of an arbitrary graph in the triangular lattice, and
 * that does not exist in general: a hexagon has six neighbours, and a ship with
 * loops can easily want a seventh, or want two rooms in one cell.
 *
 * So the honeycomb is grown along the **spanning tree** — which a generated
 * ship always has, and which `parentDoor` can read back off a finished ship —
 * and every door is then judged geometrically: cells that touch get a corridor,
 * cells that do not get a link drawn at both ends. That keeps the one rule the
 * map is judged on: a connection the picture cannot draw as a line is still
 * *said*, at both of its ends (`docs/tasks/G49-schematic-honesty.md`). A picture
 * that quietly dropped an edge would be worse than an ugly one.
 *
 * Every compartment gets a cell, always — a hexagon the reader can find beats a
 * name in a footnote, even when the corridor to it has to be a link. The two
 * fixtures that used to wedge (a fan of three subtrees, and generated seed 2)
 * are why placement is not simply "the first free neighbour": a child takes the
 * free neighbour with the most room left around it, so a subtree is given
 * somewhere to grow instead of being walled in by its own sibling.
 *
 * ## Coordinates
 *
 * Axial `q, r` for pointy-top hexagons: two vertical edges east and west, four
 * slanted ones. That is the arrangement in the owner's reference — corridors
 * run level or diagonal and never vertical — and it is why the six directions
 * below are the whole of the geometry. Turning them into pixels is the
 * renderer's business, not this file's.
 */

export interface HexCell {
  q: number;
  r: number;
}

/**
 * How far apart the lattice puts two neighbours, as a multiple of touching.
 *
 * One would pack the hexagons edge to edge — and a corridor between two
 * hexagons that share an edge has nowhere to be: trimmed by the inradius at
 * both ends it comes out exactly zero long, which is why the first honeycomb
 * drew door labels floating in a wall with no corridor under them ("почему тут
 * нет перемещения?"). The renderer scales the pixel basis by this, and the
 * difference is the corridor.
 */
export const HEX_SPACING = 1.34;

/** The six neighbours of a pointy-top hexagon, in the order the growth prefers. */
export const HEX_DIRS: readonly HexCell[] = [
  { q: 1, r: 0 }, // east
  { q: 1, r: -1 }, // north-east
  { q: 0, r: 1 }, // south-east
  { q: 0, r: -1 }, // north-west
  { q: -1, r: 1 }, // south-west
  { q: -1, r: 0 }, // west
];

export interface HexLayout {
  /** Where each compartment sits. A room with no cell is in `offLattice`. */
  readonly cells: ReadonlyMap<RoomId, HexCell>;
  /** Doors drawn as a corridor: both ends placed, and the two cells touch. */
  readonly corridors: ReadonlySet<DoorId>;
  /**
   * Doors that exist and are not corridors. Drawn as a labelled link beside
   * both of their compartments, never dropped.
   */
  readonly links: ReadonlySet<DoorId>;
  /**
   * Compartments the lattice had no free cell for, in room order. Shown in a
   * strip at the edge with the doors that reach them, the same way the terminal
   * schematic shows what its window cannot hold.
   */
  readonly offLattice: readonly RoomId[];
  /**
   * True when every cell lies in the caller's `allowed` set and the picture
   * was worth keeping (`hexLayout`, "the mask"). False for a layout laid out
   * without a mask — asked for none, or given one it could not honour.
   */
  readonly masked: boolean;
}

/**
 * What a caller may ask of the layout beside the graph.
 *
 * `allowed` is a set of `hexKey` strings: the cells the honeycomb may use and
 * no others. The engine has no idea what shape they make — a game that wants
 * its deck plan inside a drawn hull hands over the hull's cells, and this file
 * sees coordinates. Growth, the fallback placement and the repair pass are all
 * bounded by it; the root goes on its western end, so a mask longer than it is
 * tall is walked end to end the way a ship is.
 */
export interface HexLayoutOptions {
  readonly allowed?: ReadonlySet<string>;
}

/**
 * The share of doors a masked layout must draw as corridors to be kept.
 *
 * Under it the mask is handed back: a picture that says a fifth of its doors
 * in chips is a picture the owner reads as teleports, whatever the hull around
 * it looks like, and the layout without a mask draws every door of a lattice
 * hull. The same number the free layout is held to in
 * `packages/engine/tests/hexlayout.test.ts`.
 */
export const MASK_FLOOR = 0.8;

/**
 * Placements the masked growth may try before giving the tree up to the
 * greedy pass. A bound on work, not on quality: a mask with a third more cells
 * than compartments is placed in a few hundred steps, and one that cannot hold
 * the tree at all is found out here rather than searched to the end.
 */
const SEARCH_BUDGET = 8000;

/** Are these two cells neighbours on the lattice? */
export function hexAdjacent(a: HexCell, b: HexCell): boolean {
  return HEX_DIRS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
}

/** The key a cell is claimed under. Axial coordinates are unique per cell. */
export function hexKey(cell: HexCell): string {
  return `${cell.q},${cell.r}`;
}

const key = hexKey;

/**
 * Where the generator wrote a compartment's cell, when the hull was grown on
 * the lattice in the first place (`ShipSpec.lattice`).
 *
 * On the room and not beside it, because it has to survive a save: a hull the
 * run walks back into a sortie later must draw the same deck. Read defensively
 * — `room.data` round-trips through JSON, so nothing in it is trusted.
 */
export const HEX_KEY = "hex";

export function hexOf(room: { data: Record<string, unknown> }): HexCell | undefined {
  const raw = room.data[HEX_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const cell = raw as Partial<HexCell>;
  if (typeof cell.q !== "number" || typeof cell.r !== "number") return undefined;
  return { q: cell.q, r: cell.r };
}

/** Every neighbour of a cell, in the fixed direction order. */
export function hexAround(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

/**
 * The honeycomb of a ship: the cells the generator wrote, or a honeycomb grown
 * from the shallowest compartment outwards along the spanning tree.
 *
 * Given `allowed`, the growth is done again **inside that set of cells** and
 * the generator's own cells are set aside — a game that draws a hull first
 * and wants the deck inside it asks for exactly this. A mask that cannot hold
 * the tree, or one under which too few doors come out corridors
 * (`MASK_FLOOR`), is handed back: the answer is then the layout without a
 * mask, `masked: false`, and the caller draws what it always drew. No ship is
 * ever left without a map.
 *
 * Breadth-first along the spanning tree, so a compartment is placed only once
 * its parent has a cell, and the order within a level is by door id — the same
 * tie-break `layoutShip` uses, and the reason two runs of the same seed draw
 * the same deck.
 *
 * A child takes the free neighbour of its parent with the **most free
 * neighbours of its own**, direction order breaking the tie. That one line is
 * what stopped the layout wedging: taking the first free cell walls a subtree
 * in behind its sibling, and four compartments of generated seed 2 had nowhere
 * to go. Where a parent has no free neighbour at all the child still gets a
 * cell — the nearest free one, by rings outwards — and its own door becomes a
 * link rather than a corridor.
 */
export function hexLayout(ship: Ship, opts: HexLayoutOptions = {}): HexLayout {
  if (opts.allowed !== undefined) {
    const masked = embed(ship, opts.allowed);
    if (masked !== undefined) return masked;
  }
  const stored = latticeCells(ship);
  if (stored !== undefined) return { ...judge(ship, stored), masked: false };
  return embed(ship, undefined)!;
}

/**
 * Grow the honeycomb, free or inside a mask.
 *
 * With no mask this is the layout as it always was, and it always answers.
 * With one, the answer is `undefined` when the mask was not worth keeping:
 * a compartment the mask had no cell for, or fewer than `MASK_FLOOR` of the
 * doors drawn. The caller then lays out without it — nothing here is allowed
 * to leave a ship without a map.
 */
function embed(ship: Ship, allowed: ReadonlySet<string> | undefined): HexLayout | undefined {
  const cells = new Map<RoomId, HexCell>();
  const taken = new Map<string, RoomId>();
  const inMask = allowed === undefined ? undefined : [...allowed].map(parseKey).sort(westward);
  const middle = inMask === undefined ? undefined : centreOf(inMask);

  const roots = ship.rooms
    .filter((room) => parentDoor(ship, room.id) === undefined)
    .sort((a, b) => a.depth - b.depth || a.id - b.id);

  // Every root gets a lane of its own, well clear of the last one. A generated
  // ship has exactly one — the airlock compartment — and a hand-drawn fixture
  // can have several with nothing joining them. Inside a mask there are no
  // lanes to give: a root goes on the western end of the mask, and the next
  // one on the nearest free cell to it.
  // A hull the generator grew on the lattice already has a honeycomb with
  // every door a corridor. If that honeycomb fits inside the mask under some
  // turn or flip of the lattice, it is the answer — nothing grown from
  // scratch draws more doors than the drawing every door was grown for.
  const stored = allowed === undefined ? undefined : latticeCells(ship);
  const fitted = stored === undefined ? undefined : hexFit(stored, allowed!);
  if (fitted !== undefined) for (const [room, at] of fitted) place(room, at);

  let lane = 0;
  for (const root of roots) {
    if (cells.has(root.id)) continue;
    const at = inMask === undefined ? { q: 0, r: lane } : nearestFree(inMask[0] ?? { q: 0, r: 0 });
    if (at === undefined || taken.has(key(at))) continue;
    place(root.id, at);
    if (inMask === undefined || !search(root.id)) grow(root.id);
    lane += ship.rooms.length + 2;
  }

  // A room the tree never reached at all: a fixture with a door pointing at
  // nothing. It still gets a cell of its own rather than vanishing.
  const offLattice: RoomId[] = [];
  for (const room of ship.rooms) {
    if (cells.has(room.id)) continue;
    const free = nearestFree(inMask === undefined ? { q: 0, r: lane } : inMask[0] ?? { q: 0, r: 0 });
    if (free === undefined) offLattice.push(room.id);
    else place(room.id, free);
    lane += 2;
  }

  repair();
  const out = { ...judge(ship, cells), offLattice, masked: inMask !== undefined };
  if (inMask === undefined) return out;
  if (offLattice.length > 0) return undefined;
  const doors = out.corridors.size + out.links.size;
  if (doors > 0 && out.corridors.size / doors < MASK_FLOOR) return undefined;
  return out;

  function place(room: RoomId, at: HexCell): void {
    cells.set(room, at);
    taken.set(key(at), room);
  }

  function unplace(room: RoomId): void {
    const at = cells.get(room);
    if (at === undefined) return;
    taken.delete(key(at));
    cells.delete(room);
  }

  /**
   * Hill-climbing until no single move helps: for every compartment, every free
   * cell beside one of its neighbours, and take the move that draws more doors
   * as corridors than it breaks.
   *
   * Growth along the tree gets every tree door drawn and leaves the loops to
   * luck — 82 % of doors over two hundred hulls. The loops are what the owner
   * saw and would not have: a door drawn as a chip at both ends reads as a
   * teleport, whatever the label says. This pass is what closes the gap; the
   * measurement is in `packages/engine/tests/hexlayout.test.ts`.
   *
   * Deterministic to the last tie: compartments in id order, cells in the fixed
   * direction order, and a move taken only on a strict improvement. A layout
   * that depended on iteration order would break replay.
   */
  function repair(): void {
    const rooms = [...ship.rooms].sort((a, b) => a.id - b.id);
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (const room of rooms) {
        const from = cells.get(room.id);
        if (from === undefined) continue;
        const now = drawn(room.id, from);
        // Only cells beside a compartment this one has a door to: anywhere else
        // cannot improve its own doors, and moving it there would only break
        // somebody else's.
        for (const cell of candidates(room.id)) {
          if (drawn(room.id, cell) <= now) continue;
          taken.delete(key(from));
          place(room.id, cell);
          moved = true;
          break;
        }
      }
      // Inside a mask there is little free room to move into, so two
      // compartments may also trade cells — taken when the pair draws more
      // doors between them than it did. Free of a mask a move always exists
      // where a swap would help, and the pass is left as it was.
      if (inMask !== undefined && swap(rooms)) moved = true;
      if (!moved) return;
    }
  }

  /** One trade of cells between two compartments that draws more doors, or none. */
  function swap(rooms: readonly Room[]): boolean {
    for (let i = 0; i < rooms.length; i++) {
      const a = rooms[i]!.id;
      const atA = cells.get(a);
      if (atA === undefined) continue;
      for (let j = i + 1; j < rooms.length; j++) {
        const b = rooms[j]!.id;
        const atB = cells.get(b);
        if (atB === undefined) continue;
        const before = drawn(a, atA) + drawn(b, atB);
        cells.set(a, atB);
        cells.set(b, atA);
        const after = drawn(a, atB) + drawn(b, atA);
        if (after > before) {
          taken.set(key(atA), b);
          taken.set(key(atB), a);
          return true;
        }
        cells.set(a, atA);
        cells.set(b, atB);
      }
    }
    return false;
  }

  /** How many of this compartment's doors would be corridors from `cell`. */
  function drawn(room: RoomId, cell: HexCell): number {
    let n = 0;
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at !== undefined && hexAdjacent(cell, at)) n++;
    }
    return n;
  }

  /** Free cells beside something this compartment has a door to. */
  function candidates(room: RoomId): HexCell[] {
    const out: HexCell[] = [];
    const seen = new Set<string>();
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === undefined) continue;
      for (const cell of around(at)) {
        if (!free(cell) || seen.has(key(cell))) continue;
        seen.add(key(cell));
        out.push(cell);
      }
    }
    return out;
  }

  /** Nobody in it, and inside the mask when there is one. */
  function free(cell: HexCell): boolean {
    const k = key(cell);
    return !taken.has(k) && (allowed === undefined || allowed.has(k));
  }

  function around(cell: HexCell): HexCell[] {
    return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
  }

  /** How much room a cell leaves for whatever is placed in it to grow into. */
  function breathing(cell: HexCell): number {
    return around(cell).filter(free).length;
  }

  /**
   * How many of this compartment's other doors would become real corridors if
   * it went in this cell — the doors to rooms already placed next door.
   */
  function loopsMet(room: RoomId, cell: HexCell): number {
    let met = 0;
    for (const { door, room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === undefined) continue;
      if (parentDoor(ship, room)?.id === door.id) continue; // the way in, already counted
      if (hexAdjacent(cell, at)) met++;
    }
    return met;
  }

  /**
   * The nearest free cell to `from`. Free of a mask: rings outwards, bounded,
   * because the lattice is infinite. Inside one: the nearest of the mask's own
   * cells, and nothing when it is full.
   */
  function nearestFree(from: HexCell): HexCell | undefined {
    if (free(from)) return from;
    if (inMask !== undefined) {
      let best: HexCell | undefined;
      let bestAt = Infinity;
      for (const cell of inMask) {
        if (!free(cell)) continue;
        const d = distance(from, cell);
        if (d < bestAt) {
          bestAt = d;
          best = cell;
        }
      }
      return best;
    }
    for (let ring = 1; ring <= ship.rooms.length + 2; ring++) {
      for (let dq = -ring; dq <= ring; dq++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== ring) continue;
          const cell = { q: from.q + dq, r: from.r + dr };
          if (free(cell)) return cell;
        }
      }
    }
    return undefined;
  }

  /**
   * Which cells a child may take: the free ones beside its parent, best first.
   *
   * Three things decide the cell, and in this order:
   *
   *   1. does it put the child next to a compartment it already has another
   *      door to? Every loop door landing beside its own room is a corridor
   *      drawn instead of two links written, and loops are the whole reason
   *      the honeycomb has links at all;
   *   2. how much elbow room is left around it, so the subtree has somewhere
   *      to grow and does not wedge behind its sibling;
   *   3. inside a mask, how near the middle of the mask it is — so the deck
   *      fills the body rather than running as a chain along one wall,
   *      which a mask the shape of a ship invites and the owner's frame
   *      showed («шея и лопасти»).
   *
   * The direction order — east, then the diagonals — breaks what is left, so a
   * ship still spreads by depth rather than curling up.
   */
  function seats(child: RoomId, here: HexCell): HexCell[] {
    const score = (cell: HexCell): number =>
      loopsMet(child, cell) * 8 + breathing(cell) * 2 - (middle === undefined ? 0 : distance(cell, middle));
    return around(here).filter(free).sort((a, b) => score(b) - score(a));
  }

  /** Breadth-first from `from`, placing each child on a cell beside its parent. */
  function grow(from: RoomId): void {
    const queue: RoomId[] = [from];
    while (queue.length > 0) {
      const room = queue.shift()!;
      const here = cells.get(room)!;
      for (const child of childrenOf(ship, room)) {
        if (cells.has(child)) continue;
        const at = seats(child, here)[0] ?? nearestFree(here);
        if (at === undefined) continue;
        place(child, at);
        queue.push(child);
      }
    }
  }

  /**
   * The same growth with the right to change its mind: depth-first over the
   * compartments, and when one finds no cell that suits it the placement
   * backs up and seats its predecessors elsewhere.
   *
   * Two rounds. The **strict** round asks every door to be a corridor — a
   * cell for a compartment has to touch every placed compartment it has a
   * door to — which is a subgraph of the lattice looked for inside the mask.
   * A hull grown on the lattice always has one somewhere, and a mask with a
   * third more cells than compartments usually has one too; the search takes
   * the most constrained compartment first, so a wrong turn is found out in a
   * few steps rather than a few thousand. The **loose** round asks only for
   * the tree door and keeps the loops to the same preference the greedy pass
   * has: it is the greedy pass with backtracking, and its first answer is the
   * greedy one whenever the greedy one is complete.
   *
   * Bounded by `SEARCH_BUDGET` per round; false when both run out or no
   * placement exists, and the greedy pass takes over from scratch.
   */
  function search(root: RoomId): boolean {
    return placeAll(root, true) || placeAll(root, false);
  }

  function placeAll(root: RoomId, strict: boolean): boolean {
    const order = strict ? tightestFirst(root) : breadthFirst(root);
    const loops = strict ? 0 : loopDoorsAmong(order, root);
    let budget = SEARCH_BUDGET;
    let best: Map<RoomId, HexCell> | undefined;
    let bestMet = -1;
    step(0, 0);
    for (const room of order) unplace(room);
    if (best === undefined) return false;
    for (const [room, at] of best) place(room, at);
    return true;

    /**
     * Strict: the first complete placement is the answer, every door in it a
     * corridor. Loose: keep going while the budget lasts and remember the
     * placement that met the most loop doors — the first complete one is
     * the greedy one, and the rest of the budget is spent bettering it.
     */
    function step(i: number, met: number): boolean {
      if (i === order.length) {
        if (met > bestMet) {
          bestMet = met;
          best = new Map(order.map((room) => [room, cells.get(room)!]));
        }
        return strict || met >= loops;
      }
      const room = order[i]!;
      for (const at of strict ? fits(room) : seats(room, cells.get(parentOf(room))!)) {
        if (budget-- <= 0) return true;
        const gained = strict ? 0 : loopsMet(room, at);
        place(room, at);
        const done = step(i + 1, met + gained);
        unplace(room);
        if (done) return true;
      }
      return false;
    }
  }

  /** Doors among these compartments (and the root) that are not tree doors: what the loose round can still win. */
  function loopDoorsAmong(order: readonly RoomId[], root: RoomId): number {
    const set = new Set<RoomId>([root, ...order]);
    let n = 0;
    for (const door of ship.doors) {
      if (door.a === door.b || !set.has(door.a) || !set.has(door.b)) continue;
      if (parentDoor(ship, door.a)?.id === door.id || parentDoor(ship, door.b)?.id === door.id) continue;
      n++;
    }
    return n;
  }

  /** Every cell that touches all of this compartment's placed neighbours, roomiest first. */
  function fits(room: RoomId): HexCell[] {
    let out: HexCell[] | undefined;
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === undefined) continue;
      const ring = around(at).filter(free);
      out = out === undefined ? ring : out.filter((c) => ring.some((d) => d.q === c.q && d.r === c.r));
      if (out.length === 0) return out;
    }
    return (out ?? []).sort((a, b) => breathing(b) - breathing(a));
  }

  /** The tree door's other end. */
  function parentOf(room: RoomId): RoomId {
    const door = parentDoor(ship, room)!;
    return door.a === room ? door.b : door.a;
  }

  /** The compartments under `root` in the tree, parents before children, siblings by door id. */
  function breadthFirst(root: RoomId): RoomId[] {
    const out: RoomId[] = [];
    const queue: RoomId[] = [root];
    while (queue.length > 0) {
      const room = queue.shift()!;
      for (const child of childrenOf(ship, room)) {
        if (cells.has(child) || out.includes(child)) continue;
        out.push(child);
        queue.push(child);
      }
    }
    return out;
  }

  /**
   * The compartments reachable from `root`, each after the one with the most
   * doors into what is already ordered — depth and then id breaking ties — so
   * the search meets its tightest constraints first.
   */
  function tightestFirst(root: RoomId): RoomId[] {
    const out: RoomId[] = [];
    const seen = new Set<RoomId>([root]);
    const reach = new Set<RoomId>();
    for (const { room: far } of ship.neighbours(root)) if (far.id !== root) reach.add(far.id);
    while (reach.size > 0) {
      let best: RoomId | undefined;
      let bestAt = -1;
      for (const id of reach) {
        let n = 0;
        for (const { room: far } of ship.neighbours(id)) if (seen.has(far.id)) n++;
        const room = ship.roomAt(id);
        const pick =
          best === undefined ||
          n > bestAt ||
          (n === bestAt && (room.depth < ship.roomAt(best).depth || (room.depth === ship.roomAt(best).depth && id < best)));
        if (pick) {
          best = id;
          bestAt = n;
        }
      }
      const next = best!;
      reach.delete(next);
      seen.add(next);
      out.push(next);
      for (const { room: far } of ship.neighbours(next)) {
        if (!seen.has(far.id) && !cells.has(far.id)) reach.add(far.id);
      }
    }
    return out;
  }
}

/**
 * A honeycomb turned and shifted until it lies inside the mask — or nothing,
 * when no turn does. What `hexLayout` tries first for a hull the generator
 * grew on the lattice, and what a caller sizing a mask around such a hull
 * asks to know whether the mask is big enough yet.
 *
 * Every mask cell in turn and on each the twelve isometries of the lattice,
 * keeping the placement that sits nearest the middle of the mask — the
 * deck in the body of the ship — and, among those, the earliest: the
 * westernmost root, the identity before any turn. A few thousand membership
 * tests at most.
 */
export function hexFit(stored: ReadonlyMap<RoomId, HexCell>, allowed: ReadonlySet<string>): Map<RoomId, HexCell> | undefined {
  const rooms = [...stored.keys()].sort((a, b) => a - b);
  const root = rooms[0];
  if (root === undefined) return undefined;
  if (rooms.length > allowed.size) return undefined;
  const mask = [...allowed].map(parseKey).sort(westward);
  const middle = centreOf(mask);
  const turned = ISOMETRIES.map((turn) => new Map(rooms.map((id) => [id, turn(stored.get(id)!)] as const)));
  let best: { cells: ReadonlyMap<RoomId, HexCell>; dq: number; dr: number; off: number } | undefined;
  for (const target of mask) {
    for (const cells of turned) {
      const origin = cells.get(root)!;
      const dq = target.q - origin.q;
      const dr = target.r - origin.r;
      let fits = true;
      let sx = 0;
      let sy = 0;
      for (const cell of cells.values()) {
        const at = { q: cell.q + dq, r: cell.r + dr };
        if (!allowed.has(key(at))) {
          fits = false;
          break;
        }
        sx += 2 * at.q + at.r;
        sy += at.r;
      }
      if (!fits) continue;
      // The placement whose middle lies nearest the mask's: the deck in the
      // body of the ship, not piled against one end. Ties go to the earliest
      // — the westernmost root, the identity before any turn.
      const off = Math.hypot(sx / rooms.length - middle.x, ((sy / rooms.length - middle.y) * 3) / 2);
      if (best === undefined || off < best.off - 1e-9) best = { cells, dq, dr, off };
    }
  }
  if (best === undefined) return undefined;
  const { cells, dq, dr } = best;
  return new Map(rooms.map((id) => {
    const cell = cells.get(id)!;
    return [id, { q: cell.q + dq, r: cell.r + dr }];
  }));
}

/**
 * The middle of a set of cells, in lattice pixels scaled so that a column is
 * one unit: `x = 2q + r`, `y = r`. Not a cell — a point the cells are
 * measured from.
 */
function centreOf(cells: readonly HexCell[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const cell of cells) {
    x += 2 * cell.q + cell.r;
    y += cell.r;
  }
  return { x: x / cells.length, y: y / cells.length };
}

/**
 * The twelve ways to lay the lattice over itself: six turns of sixty degrees,
 * and the same six after a flip across the axis. In cube coordinates a turn
 * is a cyclic shift with a sign, and a flip swaps two of the three.
 */
const ISOMETRIES: ReadonlyArray<(c: HexCell) => HexCell> = (() => {
  const turn = (c: HexCell): HexCell => ({ q: -c.r, r: c.q + c.r });
  const flip = (c: HexCell): HexCell => ({ q: c.q + c.r, r: -c.r });
  const out: Array<(c: HexCell) => HexCell> = [];
  for (const flipped of [false, true]) {
    for (let k = 0; k < 6; k++) {
      out.push((c) => {
        let at = flipped ? flip(c) : c;
        for (let i = 0; i < k; i++) at = turn(at);
        return at;
      });
    }
  }
  return out;
})();

/**
 * The fewest rows a set of cells spans under any turn or flip of the lattice:
 * how thick the honeycomb is across, at its thinnest. A mask has to be at
 * least this many rows tall somewhere for `hexFit` to have a chance, which
 * is what a caller building a hull around a generated deck wants to know.
 */
export function hexThickness(cells: Iterable<HexCell>): number {
  const list = [...cells];
  if (list.length === 0) return 0;
  let best = Infinity;
  for (const turn of ISOMETRIES) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const cell of list) {
      const r = turn(cell).r;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    best = Math.min(best, hi - lo + 1);
  }
  return best;
}

/** Hex distance: the longest of the three axial differences. */
function distance(a: HexCell, b: HexCell | { x: number; y: number }): number {
  if ("q" in b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }
  // To a point between cells (`centreOf`): in the same column-and-row units.
  return Math.hypot((2 * a.q + a.r - b.x) / 2, ((a.r - b.y) * 3) / 4);
}

/**
 * West to east, for the root of a masked layout: by the pixel column a
 * pointy-top cell sits in (`q + r / 2`, doubled to stay in integers), the row
 * nearest the top breaking the tie. The westernmost cell of a hull is its
 * stern plate, which is where the airlock is docked against.
 */
function westward(a: HexCell, b: HexCell): number {
  return 2 * a.q + a.r - (2 * b.q + b.r) || a.r - b.r;
}

/** `hexKey` read back. A key the set holds that is not one is skipped by the caller's own sort. */
function parseKey(k: string): HexCell {
  const [q, r] = k.split(",").map(Number);
  return { q: q ?? 0, r: r ?? 0 };
}

/** Rooms hanging off this one in the spanning tree, by door id. */
function childrenOf(ship: Ship, room: RoomId): RoomId[] {
  const out: Array<{ id: RoomId; door: Door }> = [];
  for (const { door, room: far } of ship.neighbours(room)) {
    if (far.id === room) continue;
    const parent = parentDoor(ship, far.id);
    if (parent?.id === door.id) out.push({ id: far.id, door });
  }
  return out.sort((a, b) => a.door.id - b.door.id).map((x) => x.id);
}


/**
 * The cells the generator wrote, if it wrote them for every compartment.
 *
 * All or nothing on purpose: half a stored lattice and half a guessed one would
 * put two compartments in one cell, and a picture with two names in one hexagon
 * is worse than a picture with a link in it.
 */
function latticeCells(ship: Ship): Map<RoomId, HexCell> | undefined {
  const out = new Map<RoomId, HexCell>();
  const taken = new Set<string>();
  for (const room of ship.rooms) {
    const cell = hexOf(room);
    if (cell === undefined || taken.has(hexKey(cell))) return undefined;
    taken.add(hexKey(cell));
    out.set(room.id, cell);
  }
  return out.size === ship.rooms.length ? out : undefined;
}

/**
 * Sort the doors into the ones the picture can draw and the ones it can only
 * name. Geometry and nothing else: a hull grown on the lattice has no links at
 * all, and one embedded after the fact has whatever it has.
 */
function judge(ship: Ship, cells: ReadonlyMap<RoomId, HexCell>): HexLayout {
  const corridors = new Set<DoorId>();
  const links = new Set<DoorId>();
  for (const door of ship.doors) {
    if (door.a === door.b) continue; // the airlock's self-edge is not a corridor
    const a = cells.get(door.a);
    const b = cells.get(door.b);
    if (a && b && hexAdjacent(a, b)) corridors.add(door.id);
    else links.add(door.id);
  }
  return { cells, corridors, links, offLattice: [], masked: false };
}
