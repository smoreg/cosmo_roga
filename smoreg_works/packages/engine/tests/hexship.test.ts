import { describe, it, expect } from "vitest";
import { generateShip } from "../src/rooms/gen/shipgen.js";
import { validateShip } from "../src/rooms/gen/validate.js";
import { layoutFaults, layoutShip } from "../src/rooms/gen/layout.js";
import { hexAdjacent, hexLayout, hexOf } from "../src/rooms/gen/hexlayout.js";
import { Rng } from "../src/sim/rng.js";
import type { CardContext, ShipSpec } from "../src/rooms/types.js";
import type { Ship } from "../src/rooms/graph.js";

/**
 * A hull grown on the lattice, and the promise that makes the honeycomb worth
 * drawing: **every door joins two compartments that touch, and not every pair
 * that touches has a door.** The owner's rule, both halves.
 */

const KINDS = [
  { kind: "docking", name: "DOCKING BAY" },
  { kind: "cargo", name: "CARGO BAY", weight: 3, cover: true },
  { kind: "storage", name: "STORAGE", weight: 2, cover: true },
  { kind: "hab", name: "HAB BLOCK", weight: 2 },
  { kind: "mess", name: "MESS" },
  { kind: "lab", name: "LAB" },
  { kind: "engineering", name: "ENGINEERING", required: true },
  { kind: "reactor", name: "REACTOR", required: true, deep: true },
  { kind: "control", name: "CONTROL", required: true, deep: true },
];

const LATTICE: ShipSpec = {
  rooms: [14, 20],
  maxDepth: 6,
  kinds: KINDS,
  entryKind: "docking",
  doors: { open: 4, closed: 3, locked: 2, sealed: 1, broken: 1 },
  lattice: true,
};

const CTX: CardContext = { flags: new Set<string>(), shipIndex: 0 };
const SEEDS = 200;

function ship(seed: number): Ship {
  return generateShip(LATTICE, new Rng(seed), CTX);
}

describe("a hull grown on the lattice", () => {
  it("gives every compartment a cell of its own", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = ship(seed);
      const seen = new Set<string>();
      for (const room of s.rooms) {
        const cell = hexOf(room);
        expect(cell, `seed ${seed}: ${room.label} has no cell`).toBeDefined();
        const at = `${cell!.q},${cell!.r}`;
        expect(seen.has(at), `seed ${seed}: two compartments in ${at}`).toBe(false);
        seen.add(at);
      }
    }
  });

  it("joins only compartments that touch — no door is ever a teleport", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = ship(seed);
      for (const door of s.doors) {
        if (door.a === door.b) continue;
        const a = hexOf(s.roomAt(door.a))!;
        const b = hexOf(s.roomAt(door.b))!;
        expect(hexAdjacent(a, b), `seed ${seed}: ${door.label} joins cells that do not touch`).toBe(true);
      }
    }
  });

  it("draws every door as a corridor and never as a link", () => {
    // The whole point of growing on the lattice: the honeycomb has nothing left
    // over to explain. A link here would be a bug in the generator, not in the
    // picture.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const out = hexLayout(ship(seed));
      expect(out.links.size, `seed ${seed}`).toBe(0);
      expect(out.offLattice, `seed ${seed}`).toEqual([]);
    }
  });

  it("leaves walls between neighbours: not every shared edge is a door", () => {
    // The second half of the rule. A hull where every touching pair had a door
    // would be a slab with nothing to work out — and the owner said so before
    // the generator existed: "переходов на ВСЕХ стыках сот друг с другом нет".
    let edges = 0;
    let doors = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = ship(seed);
      const cells = new Map(s.rooms.map((r) => [r.id, hexOf(r)!]));
      for (const u of s.rooms) {
        for (const v of s.rooms) {
          if (v.id <= u.id) continue;
          if (hexAdjacent(cells.get(u.id)!, cells.get(v.id)!)) edges++;
        }
      }
      doors += s.doors.filter((d) => d.a !== d.b).length;
    }
    const share = doors / edges;
    console.log(`doors on ${(share * 100).toFixed(1)}% of the ${edges} shared edges over ${SEEDS} hulls`);
    expect(share).toBeLessThan(0.85);
    expect(share).toBeGreaterThan(0.4);
  });

  it("is still a hull the rest of the game accepts", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = ship(seed);
      expect(validateShip(s, LATTICE), `seed ${seed}`).toEqual([]);
    }
  });

  it("is still a hull the terminal schematic can draw", () => {
    // Six compartments to a depth and four doors to a compartment: the rows in
    // a column and the ports on a box. The honeycomb has no such limits; the
    // ASCII screen is the one the entry is judged in.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = ship(seed);
      layoutShip(s);
      expect(layoutFaults(s), `seed ${seed}`).toEqual([]);
      for (const room of s.rooms) {
        const deg = s.doorsOf(room.id).filter((d) => d.a !== d.b).length;
        expect(deg, `seed ${seed}: ${room.label}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it("is the same hull twice from the same seed", () => {
    for (const seed of [1, 7, 99]) {
      const a = ship(seed);
      const b = ship(seed);
      expect(a.rooms.map((r) => [r.label, r.kind, hexOf(r)])).toEqual(
        b.rooms.map((r) => [r.label, r.kind, hexOf(r)]),
      );
      expect(a.doors).toEqual(b.doors);
    }
  });
});
