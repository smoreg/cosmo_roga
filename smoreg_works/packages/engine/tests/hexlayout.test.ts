import { describe, it, expect } from "vitest";
import { hexAdjacent, hexLayout, type HexLayout } from "../src/rooms/gen/hexlayout.js";
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
