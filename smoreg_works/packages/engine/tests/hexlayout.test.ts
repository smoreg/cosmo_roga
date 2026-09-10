import { describe, it, expect } from "vitest";
import {
  MASK_FLOOR,
  hexAdjacent,
  hexFit,
  hexKey,
  hexLayout,
  type HexCell,
  type HexLayout,
} from "../src/rooms/gen/hexlayout.js";
import { shipFromText } from "../src/testing/roomfixtures.js";
import { generateShip } from "../src/rooms/gen/shipgen.js";
import { Rng } from "../src/sim/rng.js";
import type { Ship } from "../src/rooms/graph.js";
import type { CardContext, ShipSpec } from "../src/rooms/types.js";

/**
 * The honeycomb layout, judged by the two things a deck plan has to be: planar
 * and honest. Nothing here is about how it looks — that is the renderer's — and
 * everything is about what the picture is allowed to claim.
 */

const CHAIN = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r1: docking
  r2: cargo
  r3: storage
  r4: reactor
`;

/** One room with three children: the shape a greedy placement could wedge. */
const FAN = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -d2- r3
  r1 -d3- r4
  r2 -d4- r5
  r3 -d5- r6
  r4 -d6- r7
  r1: docking
  r2: cargo
  r3: storage
  r4: hab
  r5: mess
  r6: lab
  r7: med
`;

/** A loop: the door that closes it is the one no tree can draw as a corridor. */
const LOOP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r4 -d4- r1
  r1: docking
  r2: cargo
  r3: storage
  r4: hab
`;

function layoutOf(text: string): { ship: Ship; out: HexLayout } {
  const ship = shipFromText(text).ship;
  return { ship, out: hexLayout(ship) };
}

/** A generated hull, so the invariants are not tested on fixtures alone. */
const SPEC: ShipSpec = {
  rooms: [14, 20],
  maxDepth: 5,
  entryKind: "docking",
  kinds: [
    { kind: "docking", name: "DOCKING BAY" },
    { kind: "cargo", name: "CARGO BAY", weight: 3 },
    { kind: "storage", name: "STORAGE", weight: 2 },
    { kind: "hab", name: "HAB BLOCK", weight: 2 },
    { kind: "engineering", name: "ENGINEERING", required: true },
    { kind: "reactor", name: "REACTOR", required: true, deep: true },
    { kind: "control", name: "CONTROL", required: true, deep: true },
  ],
  doors: { open: 4, closed: 3, locked: 2, sealed: 1, broken: 1 },
};

const CTX: CardContext = { flags: new Set<string>(), shipIndex: 0 };

function generated(seed: number): Ship {
  return generateShip(SPEC, new Rng(seed), CTX);
}

/** The same spec grown on the lattice: the hull the game actually ships. */
const LATTICE: ShipSpec = { ...SPEC, lattice: true };

function onLattice(seed: number): Ship {
  return generateShip(LATTICE, new Rng(seed), CTX);
}

/** A block of cells `w` wide and `h` tall, odd rows shifted half a cell east, as a mask. */
function block(w: number, h: number, dq = 0, dr = 0): Set<string> {
  const out = new Set<string>();
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) out.add(hexKey({ q: c - ((r - (r & 1)) >> 1) + dq, r: r + dr }));
  }
  return out;
}

function share(out: HexLayout): number {
  const doors = out.corridors.size + out.links.size;
  return doors === 0 ? 1 : out.corridors.size / doors;
}

describe("the honeycomb layout", () => {
  it("puts one compartment in a cell and never two", () => {
    for (const text of [CHAIN, FAN, LOOP]) {
      const { out } = layoutOf(text);
      const seen = new Set<string>();
      for (const cell of out.cells.values()) {
        const at = `${cell.q},${cell.r}`;
        expect(seen.has(at), at).toBe(false);
        seen.add(at);
      }
    }
  });

  it("draws a corridor only between hexagons that touch", () => {
    for (const text of [CHAIN, FAN, LOOP]) {
      const { ship, out } = layoutOf(text);
      for (const id of out.corridors) {
        const door = ship.doors.find((d) => d.id === id)!;
        const a = out.cells.get(door.a)!;
        const b = out.cells.get(door.b)!;
        expect(hexAdjacent(a, b), door.label).toBe(true);
      }
    }
  });

  it("accounts for every door, as a corridor or as a link", () => {
    // The one rule the picture is judged on: a connection it cannot draw as a
    // line is still said, at both ends. A door in neither set is a door the
    // map has quietly dropped.
    for (const text of [CHAIN, FAN, LOOP]) {
      const { ship, out } = layoutOf(text);
      for (const door of ship.doors) {
        if (door.a === door.b) continue;
        const drawn = out.corridors.has(door.id);
        const said = out.links.has(door.id);
        expect(drawn !== said, `${door.label}: drawn=${drawn} said=${said}`).toBe(true);
      }
    }
  });

  it("accounts for every compartment, in a cell or in the strip", () => {
    for (const text of [CHAIN, FAN, LOOP]) {
      const { ship, out } = layoutOf(text);
      for (const room of ship.rooms) {
        const placed = out.cells.has(room.id);
        const listed = out.offLattice.includes(room.id);
        expect(placed !== listed, room.name).toBe(true);
      }
    }
  });

  it("places the whole spanning tree, on a hundred generated hulls", () => {
    // The tree is what the honeycomb is grown along, and a hexagon gives one of
    // its six neighbours back to its parent — so the three children a generated
    // ship can hang off one compartment always fit. If this ever goes red the
    // greedy growth needs backtracking, not a looser test.
    for (let seed = 1; seed <= 100; seed++) {
      const ship = generated(seed);
      const out = hexLayout(ship);
      expect(out.offLattice, `seed ${seed}`).toEqual([]);
      expect(out.cells.size, `seed ${seed}`).toBe(ship.rooms.length);
    }
  });

  it("draws almost every door as a real corridor", () => {
    // The quality number, and the reason the placement heuristic exists at all.
    // A layout that is merely honest can be honest about everything and draw
    // nothing; this is the line that says the picture is worth looking at.
    let corridors = 0;
    let doors = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const out = hexLayout(generated(seed));
      corridors += out.corridors.size;
      doors += out.corridors.size + out.links.size;
    }
    const share = corridors / doors;
    console.log(`corridors ${(share * 100).toFixed(1)}% of ${doors} doors over 200 hulls`);
    expect(share).toBeGreaterThanOrEqual(0.8);
  });

  it("is a pure function of the graph", () => {
    // Twice over the same ship, and over a second ship built from the same
    // seed: the drawing may not depend on when it was asked for.
    const ship = generated(7);
    expect(hexLayout(ship)).toEqual(hexLayout(ship));
    expect([...hexLayout(generated(7)).cells]).toEqual([...hexLayout(generated(7)).cells]);
  });

  it("draws most of a loop and says the rest", () => {
    const { out } = layoutOf(LOOP);
    // Four rooms in a ring: three sides of it are the tree and one is the loop
    // door. On the lattice the ring may well close — three steps out and one
    // back is a legal hexagon walk — so this asserts the accounting, not luck.
    expect(out.corridors.size + out.links.size).toBe(4);
    expect(out.offLattice).toEqual([]);
  });
});

describe("the honeycomb inside a mask", () => {
  it("lays every hull it keeps entirely inside the mask, with every door said and most drawn", () => {
    // A block with room to spare: what a game hands over when it wants the
    // deck inside a drawn hull. Where the mask is kept, every cell is in it,
    // every compartment has a cell, and at least MASK_FLOOR of the doors are
    // corridors — the promise the flag makes. Where it is not kept, the
    // answer is the layout without it.
    let kept = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const ship = onLattice(seed);
      const allowed = block(Math.ceil(ship.rooms.length / 3) + 2, 7);
      const out = hexLayout(ship, { allowed });
      for (const door of ship.doors) {
        if (door.a === door.b) continue;
        expect(out.corridors.has(door.id) !== out.links.has(door.id), `seed ${seed} ${door.label}`).toBe(true);
      }
      if (!out.masked) {
        expect(out).toEqual(hexLayout(ship));
        continue;
      }
      kept++;
      expect(out.offLattice, `seed ${seed}`).toEqual([]);
      expect(out.cells.size, `seed ${seed}`).toBe(ship.rooms.length);
      for (const cell of out.cells.values()) expect(allowed.has(hexKey(cell)), `seed ${seed} ${hexKey(cell)}`).toBe(true);
      expect(share(out), `seed ${seed}`).toBeGreaterThanOrEqual(MASK_FLOOR);
    }
    console.log(`mask kept on ${kept} of 100 lattice hulls`);
    expect(kept).toBeGreaterThanOrEqual(90);
  });

  it("keeps the generator's own honeycomb, turned to fit, when the mask holds it", () => {
    // A hull grown on the lattice has every door a corridor already; inside
    // a mask that holds that honeycomb under some turn of the lattice, the
    // layout is that honeycomb — turned, shifted, and with no link in it.
    for (let seed = 1; seed <= 30; seed++) {
      const ship = onLattice(seed);
      const own = hexLayout(ship);
      // The mask: the honeycomb flipped across the axis and pushed east,
      // plus a ring of spare cells — so the identity does not fit but a flip does.
      const allowed = new Set<string>();
      for (const cell of own.cells.values()) {
        const at = { q: cell.q + cell.r + 40, r: -cell.r };
        allowed.add(hexKey(at));
        allowed.add(hexKey({ q: at.q + 1, r: at.r }));
      }
      const out = hexLayout(ship, { allowed });
      expect(out.masked, `seed ${seed}`).toBe(true);
      expect(out.links.size, `seed ${seed}`).toBe(0);
      expect(out.corridors.size, `seed ${seed}`).toBe(own.corridors.size);
      for (const cell of out.cells.values()) expect(allowed.has(hexKey(cell))).toBe(true);
    }
  });

  it("hands the mask back when it cannot hold every compartment", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ship = onLattice(seed);
      const tight = block(ship.rooms.length - 1, 1);
      const out = hexLayout(ship, { allowed: tight });
      expect(out.masked, `seed ${seed}`).toBe(false);
      expect(out).toEqual(hexLayout(ship));
    }
  });

  it("hands the mask back when too few doors would come out corridors", () => {
    // A fan of three subtrees on a single line of cells: the tree cannot be
    // drawn there — a cell on a line has two neighbours, and the parent is
    // one of them — so most doors would be links, and the mask is refused.
    const ship = shipFromText(FAN).ship;
    const line = block(ship.rooms.length * 3, 1);
    const out = hexLayout(ship, { allowed: line });
    expect(out.masked).toBe(false);
    expect(out).toEqual(hexLayout(ship));
  });

  it("is a pure function of the graph and the mask, however the mask was written", () => {
    const ship = onLattice(5);
    const allowed = block(9, 7);
    const backwards = new Set([...allowed].reverse());
    const shuffled = new Set([...allowed].sort());
    const out = hexLayout(ship, { allowed });
    expect(hexLayout(ship, { allowed })).toEqual(out);
    expect(hexLayout(ship, { allowed: backwards })).toEqual(out);
    expect(hexLayout(ship, { allowed: shuffled })).toEqual(out);
    expect(hexLayout(onLattice(5), { allowed })).toEqual(out);
  });

  it("answers masked: false, and the layout it always gave, when asked for none", () => {
    for (const text of [CHAIN, FAN, LOOP]) expect(layoutOf(text).out.masked).toBe(false);
    for (let seed = 1; seed <= 10; seed++) {
      const out = hexLayout(onLattice(seed));
      expect(out.masked).toBe(false);
      expect(out.links.size).toBe(0);
    }
  });

  it("puts the root on the western end of the mask, and only inside it", () => {
    // The stern is where a ship is docked against: a mask longer than it is
    // tall is walked from its west end. The root is the shallowest room.
    for (let seed = 1; seed <= 20; seed++) {
      const ship = onLattice(seed);
      const allowed = block(ship.rooms.length, 3, 100, 50);
      const out = hexLayout(ship, { allowed });
      if (!out.masked) continue;
      const root = ship.rooms.find((room) => room.depth === 0)!;
      const at = out.cells.get(root.id)!;
      const west = Math.min(...[...out.cells.values()].map((c) => 2 * c.q + c.r));
      expect(2 * at.q + at.r - west, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("turning a honeycomb into a mask", () => {
  const bent: ReadonlyMap<number, HexCell> = new Map([
    [0, { q: 0, r: 0 }],
    [1, { q: 1, r: 0 }],
    [2, { q: 2, r: 0 }],
    [3, { q: 2, r: -1 }],
  ]);

  it("finds a placement under a flip when no turn alone fits", () => {
    // The shape bent the other way, moved off: only a flip lands it.
    const allowed = new Set([hexKey({ q: 10, r: 5 }), hexKey({ q: 11, r: 5 }), hexKey({ q: 12, r: 5 }), hexKey({ q: 11, r: 6 })]);
    const fit = hexFit(bent, allowed);
    expect(fit).toBeDefined();
    for (const cell of fit!.values()) expect(allowed.has(hexKey(cell))).toBe(true);
    for (const [a, b] of [[0, 1], [1, 2], [2, 3]]) {
      expect(hexAdjacent(fit!.get(a!)!, fit!.get(b!)!)).toBe(true);
    }
  });

  it("keeps the bearing of a honeycomb that fits as it stands, and answers nothing when none does", () => {
    const asIs = new Set([...bent.values()].map((c) => hexKey({ q: c.q + 3, r: c.r + 2 })));
    const fit = hexFit(bent, asIs)!;
    expect(fit.get(0)).toEqual({ q: 3, r: 2 });
    expect(fit.get(3)).toEqual({ q: 5, r: 1 });
    expect(hexFit(bent, new Set([hexKey({ q: 0, r: 0 }), hexKey({ q: 1, r: 0 }), hexKey({ q: 2, r: 0 })]))).toBeUndefined();
  });
});
