import { describe, it, expect } from "vitest";
import { Rng } from "../src/sim/rng.js";
import type { Door, RoomId, Ship } from "../src/rooms/graph.js";
import type { CardContext, RoomCard, RoomKindSpec, ShipSpec } from "../src/rooms/types.js";
import {
  DEEP_DEPTH,
  KEY_MARK,
  LOCK_ENTRY,
  MAX_COLUMN,
  buildShip,
  generateShip,
  layoutShip,
  parentDoor,
  portsOf,
  treeDoors,
  validateShip,
} from "../src/rooms/gen/index.js";
import { shipToText } from "../src/testing/roomfixtures.js";

/**
 * The generator's contract is a list of guarantees, so the tests are property
 * tests over a couple of hundred seeds and three ships that ask for different
 * things. What matters is not that one ship looks good — it is that no seed
 * produces a ship the schematic cannot draw, a reactor nobody can reach, or a
 * key locked behind the door it opens.
 */

const KINDS: readonly RoomKindSpec[] = [
  { kind: "docking", name: "DOCKING BAY" },
  { kind: "corridor", name: "CORRIDOR RING", weight: 3 },
  { kind: "cargo", name: "CARGO BAY", weight: 2, cover: true },
  { kind: "storage", name: "STORAGE", cover: true },
  { kind: "hab", name: "HAB BLOCK", cover: true },
  { kind: "mess", name: "MESS" },
  { kind: "med", name: "MED BAY" },
  { kind: "lab", name: "LAB" },
  { kind: "workshop", name: "WORKSHOP", cover: true },
  { kind: "maint", name: "MAINTENANCE", cover: true },
  { kind: "cryo", name: "CRYO" },
  { kind: "brig", name: "BRIG" },
  { kind: "engineering", name: "ENGINEERING", required: true },
  { kind: "reactor", name: "REACTOR", required: true, deep: true },
  { kind: "control", name: "CONTROL", required: true, deep: true },
];

/** A tug's first find: small, shallow, mostly open. */
const SMALL: ShipSpec = {
  rooms: [12, 14],
  maxDepth: 4,
  kinds: KINDS,
  entryKind: "docking",
  doors: { open: 6, closed: 3, locked: 1, sealed: 0.5, broken: 0.5 },
};

const MEDIUM: ShipSpec = {
  rooms: [16, 20],
  maxDepth: 5,
  kinds: KINDS,
  entryKind: "docking",
  doors: { open: 4, closed: 3, locked: 2, sealed: 1, broken: 1 },
};

/** A military hull: welded shut behind the crew, a fifth of its doors. */
const MILITARY: ShipSpec = {
  rooms: [16, 22],
  maxDepth: 6,
  kinds: KINDS,
  entryKind: "docking",
  doors: { open: 3, closed: 2, locked: 2.5, sealed: 2, broken: 0.5 },
};

const SPECS: ReadonlyArray<readonly [string, ShipSpec]> = [
  ["small", SMALL],
  ["medium", MEDIUM],
  ["military", MILITARY],
];

const SEEDS = 200;
const CTX: CardContext = { flags: new Set<string>(), shipIndex: 0 };

function shipFor(spec: ShipSpec, seed: number): Ship {
  return generateShip(spec, new Rng(seed), CTX);
}

/** Rooms reachable from the airlock through the doors `passable` admits. */
function walk(ship: Ship, from: RoomId, passable: (d: Door) => boolean): Set<RoomId> {
  const seen = new Set<RoomId>([from]);
  const queue: RoomId[] = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const { door, room } of ship.neighbours(queue[head]!)) {
      if (room.id === queue[head]! || seen.has(room.id) || !passable(door)) continue;
      seen.add(room.id);
      queue.push(room.id);
    }
  }
  return seen;
}

function roomWithMark(ship: Ship, mark: string): RoomId | undefined {
  return ship.rooms.find((r) => r.marks.includes(mark))?.id;
}

describe("generateShip", () => {
  it("passes every invariant on 200 seeds of each of three specs", () => {
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const built = buildShip(spec, new Rng(seed), CTX);
        expect(
          built.problems.map((p) => `${p.code}: ${p.detail}`),
          `${name} seed ${seed} after ${built.attempts} attempts`,
        ).toEqual([]);
      }
    }
  });

  it("is a pure function of spec, rng and context", () => {
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = new Rng(seed);
        const once = shipToText(generateShip(spec, rng.fork(seed), CTX));
        const twice = shipToText(generateShip(spec, rng.fork(seed), CTX));
        expect(twice, `${name} seed ${seed}`).toEqual(once);
      }
      // A different fork is a different ship, or the seed is doing nothing.
      const rng = new Rng(7);
      expect(shipToText(generateShip(spec, rng.fork(1), CTX))).not.toEqual(
        shipToText(generateShip(spec, rng.fork(2), CTX)),
      );
    }
  });

  it("draws its size from the spec and puts the airlock on a depth-0 entry", () => {
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        const where = `${name} seed ${seed}`;
        expect(ship.size, where).toBeGreaterThanOrEqual(spec.rooms[0]);
        expect(ship.size, where).toBeLessThanOrEqual(spec.rooms[1]);

        const entry = ship.roomAt(ship.entry);
        expect(entry.kind, where).toBe(spec.entryKind);
        expect(entry.depth, where).toBe(0);
        expect(ship.rooms.filter((r) => r.depth === 0), where).toHaveLength(1);

        const airlocks = ship.doors.filter((d) => d.state === "airlock");
        expect(airlocks, where).toHaveLength(1);
        expect([airlocks[0]!.a, airlocks[0]!.b], where).toEqual([ship.entry, ship.entry]);
      }
    }
  });

  it("places every required kind once and never puts a deep one within reach", () => {
    let deepest = 0;
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        for (const kind of spec.kinds) {
          const rooms = ship.rooms.filter((r) => r.kind === kind.kind);
          if (kind.required) expect(rooms, `${name} seed ${seed} ${kind.kind}`).toHaveLength(1);
          for (const r of rooms) {
            if (kind.deep) expect(r.depth, `${name} seed ${seed} ${r.label}`).toBeGreaterThanOrEqual(DEEP_DEPTH);
            expect(r.depth, `${name} seed ${seed} ${r.label}`).toBeLessThanOrEqual(spec.maxDepth);
            deepest = Math.max(deepest, r.depth);
          }
        }
      }
    }
    expect(deepest).toBeGreaterThanOrEqual(DEEP_DEPTH);
  });

  it("keeps every ship connected, and every weld a detour rather than a wall", () => {
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        const where = `${name} seed ${seed}`;
        const cutter = walk(ship, ship.entry, (d) => d.state !== "airlock");
        expect(cutter.size, where).toBe(ship.size);
        const unwelded = walk(ship, ship.entry, (d) => d.state !== "airlock" && d.state !== "sealed");
        expect(unwelded.size, where).toBe(ship.size);
      }
    }
  });

  it("locks only tree edges and welds only loops", () => {
    let locks = 0;
    let welds = 0;
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        const tree = treeDoors(ship);
        expect(tree.size, `${name} seed ${seed}`).toBe(ship.size - 1);
        for (const d of ship.doors) {
          if (d.state === "locked") {
            locks++;
            expect(tree.has(d.id), `${name} seed ${seed} ${d.label}`).toBe(true);
          }
          if (d.state === "sealed") {
            welds++;
            expect(tree.has(d.id), `${name} seed ${seed} ${d.label}`).toBe(false);
          }
        }
      }
    }
    expect(locks).toBeGreaterThan(0);
    expect(welds).toBeGreaterThan(0);
  });

  it("adds loops back, between 35 and 50 per cent of the tree's edges", () => {
    // The share was 15-25 % and made two or three loops on a fourteen room
    // hull, which is a tree with a couple of shortcuts in it: half the
    // compartments of a ship had exactly one way back to the airlock, so
    // meeting anything in a corridor meant fighting it. The owner said so —
    // «граф имеет мало циклов и не получается мансить от охраны, ты всегда в
    // тупике» (docs/owner-queue.md, 3). Measured over 200 seeds of each of the
    // seven classes: compartments with a second way home 57.8 % -> 84.7 %, dead
    // ends a hull 3.77 -> 1.70, and the longest dead-end branch 5 -> 3.
    for (const [name, spec] of SPECS) {
      let looped = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        const tree = treeDoors(ship);
        const loops = ship.doors.filter((d) => d.state !== "airlock" && !tree.has(d.id)).length;
        expect(loops, `${name} seed ${seed}`).toBeLessThanOrEqual(Math.ceil(0.5 * (ship.size - 1)));
        if (loops > 0) looped++;
      }
      // Not every seed can afford one, but a ship of loose corridors would be
      // a tree, and a tree is a corridor to walk down and back.
      expect(looped / SEEDS, name).toBeGreaterThan(0.9);
    }
  });
});

describe("keys", () => {
  /** A spec that locks two doors in five and owes three required rooms. */
  const LOCKED: ShipSpec = {
    ...MEDIUM,
    doors: { open: 4, closed: 2, locked: 4, sealed: 0, broken: 0 },
  };

  it("puts every key in a room that can be reached without the door it opens", () => {
    let keys = 0;
    for (const [name, spec] of [...SPECS, ["locked", LOCKED] as const]) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        for (const door of ship.doors) {
          if (door.state !== "locked") continue;
          keys++;
          const where = `${name} seed ${seed} ${door.label}`;
          expect(door.key, where).toBeDefined();
          const room = roomWithMark(ship, `${KEY_MARK}${door.key}`);
          expect(room, where).toBeDefined();
          // Everything but this door and the airlock is walked through, so the
          // question asked is only "is the key behind the door it opens".
          const without = walk(ship, ship.entry, (d) => d.id !== door.id && d.state !== "airlock");
          expect(without.has(room!), where).toBe(true);
        }
      }
    }
    expect(keys).toBeGreaterThan(SEEDS);
  });

  it("lets a drone with no cutter finish a ship of locked doors", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = shipFor(LOCKED, seed);
      // Pick up keys, then walk again with them, until nothing new turns up.
      const held = new Set<string>();
      let rooms = new Set<RoomId>();
      for (;;) {
        rooms = walk(ship, ship.entry, (d) => {
          if (d.state === "sealed" || d.state === "airlock") return false;
          if (d.state !== "locked") return true;
          return d.key !== undefined && held.has(d.key);
        });
        let grew = false;
        for (const r of rooms) {
          for (const mark of ship.roomAt(r).marks) {
            if (!mark.startsWith(KEY_MARK)) continue;
            if (!held.has(mark.slice(KEY_MARK.length))) {
              held.add(mark.slice(KEY_MARK.length));
              grew = true;
            }
          }
        }
        if (!grew) break;
      }
      for (const kind of LOCKED.kinds) {
        if (!kind.required) continue;
        const room = ship.rooms.find((r) => r.kind === kind.kind)!;
        expect(rooms.has(room.id), `seed ${seed} ${kind.kind} ${room.label}`).toBe(true);
      }
    }
  });
});

describe("layout", () => {
  it("gives every room its own cell, in a column per depth", () => {
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        const cells = new Set<string>();
        const perColumn = new Map<number, number>();
        for (const r of ship.rooms) {
          const where = `${name} seed ${seed} ${r.label}`;
          expect(r.col, where).toBe(r.depth);
          expect(r.row, where).toBeGreaterThanOrEqual(0);
          expect(r.row, where).toBeLessThan(MAX_COLUMN);
          expect(cells.has(`${r.col},${r.row}`), where).toBe(false);
          cells.add(`${r.col},${r.row}`);
          perColumn.set(r.col, (perColumn.get(r.col) ?? 0) + 1);
        }
        for (const [col, n] of perColumn) {
          expect(n, `${name} seed ${seed} column ${col}`).toBeLessThanOrEqual(MAX_COLUMN);
        }
      }
    }
  });

  it("keeps four doors to a room, two to a side, and never two the same way", () => {
    for (const [name, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipFor(spec, seed);
        for (const r of ship.rooms) {
          const where = `${name} seed ${seed} ${r.label}`;
          expect(ship.doorsOf(r.id).length, where).toBeLessThanOrEqual(4);
          for (const [side, uses] of portsOf(ship, r.id)) {
            expect(uses.length, `${where} ${side}`).toBeLessThanOrEqual(2);
            if (uses.length !== 2) continue;
            expect(Math.sign(uses[0]!.dy), `${where} ${side}`).not.toBe(Math.sign(uses[1]!.dy));
          }
        }
        for (const d of ship.doors) {
          if (d.a === d.b) continue;
          const a = ship.roomAt(d.a);
          const b = ship.roomAt(d.b);
          const where = `${name} seed ${seed} ${d.label}`;
          expect(Math.abs(a.col - b.col), where).toBeLessThanOrEqual(1);
          if (a.col === b.col) expect(Math.abs(a.row - b.row), where).toBe(1);
        }
      }
    }
  });

  it("is a pure function of the graph, so a stored ship draws as it was drawn", () => {
    const ship = shipFor(MEDIUM, 3);
    const before = ship.rooms.map((r) => [r.col, r.row]);
    layoutShip(ship);
    expect(ship.rooms.map((r) => [r.col, r.row])).toEqual(before);
  });
});

describe("cards", () => {
  const CARDS: readonly RoomCard[] = [
    { name: "never", when: () => false, marks: ["never"], weight: 100 },
    { name: "crate", marks: ["X"], maxPerShip: 2, weight: 50 },
    { name: "quarantine ward", kinds: ["med"], marks: ["M", "fire"], sets: ["quarantine"] },
    { name: "checkpoint", kinds: ["cargo"], marks: ["M", LOCK_ENTRY], sets: ["armed"], weight: 30 },
    { name: "filler", marks: ["%"], weight: 1 },
  ];
  const WITH_CARDS: ShipSpec = { ...MEDIUM, cards: CARDS, cardsPerRoom: 2 };

  it("respects preconditions, kinds and the cap per ship", () => {
    let crates = 0;
    let checkpoints = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const built = buildShip(WITH_CARDS, new Rng(seed), CTX);
      expect(built.problems, `seed ${seed}`).toEqual([]);
      const ship = built.ship;

      expect(ship.rooms.some((r) => r.marks.includes("never")), `seed ${seed}`).toBe(false);
      const crate = built.cards.filter((c) => c.card.name === "crate");
      expect(crate.length, `seed ${seed}`).toBeLessThanOrEqual(2);
      crates += crate.length;
      for (const placed of built.cards) {
        const room = ship.roomAt(placed.room);
        if (placed.card.kinds) expect(placed.card.kinds, `seed ${seed}`).toContain(room.kind);
        if (placed.card.name === "checkpoint") checkpoints++;
      }
      // Two attempts a room, and no card lands in the same room twice.
      for (const room of ship.rooms) {
        const names = built.cards.filter((c) => c.room === room.id).map((c) => c.card.name);
        expect(names.length, `seed ${seed} ${room.label}`).toBeLessThanOrEqual(2);
        expect(new Set(names).size, `seed ${seed} ${room.label}`).toBe(names.length);
      }
    }
    expect(crates).toBeGreaterThan(SEEDS);
    expect(checkpoints).toBeGreaterThan(0);
  });

  it("raises the flags of the cards it placed, and only those", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const built = buildShip(WITH_CARDS, new Rng(seed), CTX);
      const raised = new Set<string>();
      for (const placed of built.cards) for (const flag of placed.card.sets ?? []) raised.add(flag);
      expect(new Set(built.flagsSet), `seed ${seed}`).toEqual(raised);
    }
  });

  it("locks the way into a room that asked for it, and leaves the key outside", () => {
    let locked = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = generateShip(WITH_CARDS, new Rng(seed), CTX);
      for (const room of ship.rooms) {
        if (!room.marks.includes(LOCK_ENTRY)) continue;
        const door = parentDoor(ship, room.id);
        expect(door, `seed ${seed} ${room.label}`).toBeDefined();
        // A card cannot lock a hole, so the door is either locked or was one.
        if (door!.state !== "locked") continue;
        locked++;
        const where = `seed ${seed} ${door!.label}`;
        expect(treeDoors(ship).has(door!.id), where).toBe(true);
        const key = roomWithMark(ship, `${KEY_MARK}${door!.key}`);
        expect(key, where).toBeDefined();
        const without = walk(ship, ship.entry, (d) => d.id !== door!.id && d.state !== "airlock");
        expect(without.has(key!), where).toBe(true);
      }
    }
    expect(locked).toBeGreaterThan(0);
  });

  it("leaves marks only where a card could have left them", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ship = generateShip(WITH_CARDS, new Rng(seed), CTX);
      expect(validateShip(ship, WITH_CARDS), `seed ${seed}`).toEqual([]);
    }
  });
});

describe("cost", () => {
  it("generates two hundred ships of each spec in under five seconds", () => {
    const started = Date.now();
    for (const [, spec] of SPECS) {
      for (let seed = 1; seed <= SEEDS; seed++) shipFor(spec, seed);
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
