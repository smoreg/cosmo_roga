import { describe, expect, it } from "vitest";
import { newGame } from "../src/game.js";
import { undock } from "../src/systems/voyage.js";
import { keelOf, mirror, wreckage } from "../src/ui/react/hull.js";
import { boardOf } from "../src/ui/react/model.js";
import { seedRange } from "@jamrog/engine/testing";

/**
 * A ship is the same on both sides of its keel.
 *
 * `hexLayout` lays out a graph and does it well; a graph grown along its
 * spanning tree simply is not a hull. The picture is made symmetric by drawing
 * the cells the ship no longer has — and because that is pure geometry, it can
 * be held to exactly rather than looked at.
 */
describe("the mirror is exact", () => {
  it("is its own inverse, whatever the keel", () => {
    for (const k of [-3, -1, 0, 1, 4]) {
      for (const q of [-4, 0, 3]) {
        for (const r of [-5, -1, 0, 2, 6]) {
          const there = mirror({ q, r }, k);
          const back = mirror(there, k);
          expect(back).toEqual({ q, r });
        }
      }
    }
  });

  it("keeps a cell's place along the ship, and only swaps its side", () => {
    /* `q + r/2` is how far along the hull a cell sits. The reflection has to
       leave that alone or the ship bends — which is the whole reason the
       identity is `q' = q + (r - k)` and not something with a rounding in it. */
    for (const k of [0, 2]) {
      for (const q of [-3, 0, 5]) {
        for (const r of [-4, 1, 3]) {
          const there = mirror({ q, r }, k);
          /* q + r/2 is how far along the hull a cell is, and the reflection
             must not move it: q' + r'/2 = (q + r - k) + (2k - r)/2 = q + r/2. */
          expect(there.q + there.r / 2).toBe(q + r / 2);
          expect(Number.isInteger(there.q)).toBe(true);
          expect(Number.isInteger(there.r)).toBe(true);
        }
      }
    }
  });

  it("leaves a hull that is already symmetric completely alone", () => {
    /* Three rows about r=0, each row's reflection already present. */
    const cells = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 1, r: -1 },
      { q: 2, r: -1 },
    ];
    expect(keelOf(cells)).toBe(0);
    expect(wreckage(cells, 0)).toEqual([]);
  });

  it("fills exactly the opposite numbers that are missing, and no more", () => {
    const cells = [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: 3, r: 2 },
    ];
    const keel = keelOf(cells);
    const made = wreckage(cells, keel);
    const all = new Set([...cells, ...made].map((c) => `${String(c.q)},${String(c.r)}`));
    /* Every cell now has its opposite number, wreckage included — otherwise
       the filling would itself be lopsided. */
    for (const c of [...cells, ...made]) {
      const t = mirror(c, keel);
      expect(all.has(`${String(t.q)},${String(t.r)}`), `${String(c.q)},${String(c.r)}`).toBe(true);
    }
    /* And nothing was invented that was already there. */
    const taken = new Set(cells.map((c) => `${String(c.q)},${String(c.r)}`));
    for (const m of made) expect(taken.has(`${String(m.q)},${String(m.r)}`)).toBe(false);
  });

  it("picks the keel that needs the least made up", () => {
    /* Everything sits on r=1 except one cell, so r=1 is the cheap keel and
       any other row would have to invent most of the ship. */
    const cells = [
      { q: 0, r: 1 },
      { q: 1, r: 1 },
      { q: 2, r: 1 },
      { q: 3, r: 1 },
      { q: 0, r: 2 },
    ];
    expect(keelOf(cells)).toBe(1);
    expect(wreckage(cells, 1)).toHaveLength(1);
  });

  it("is stable: the same cells give the same wreckage in the same order", () => {
    const cells = [
      { q: 2, r: 3 },
      { q: 0, r: 0 },
      { q: 1, r: -2 },
      { q: 4, r: 1 },
    ];
    const once = wreckage(cells, keelOf(cells));
    const again = wreckage([...cells].reverse(), keelOf([...cells].reverse()));
    expect(again).toEqual(once);
  });
});

describe("the hull a real ship draws", () => {
  it("comes out symmetric about its keel, over thirty voyages", () => {
    for (const seed of seedRange(1, 30)) {
      const game = newGame(seed);
      if (!undock(game).ok) continue;
      const board = boardOf(game);
      const cells = new Set(board.rooms.map((r) => `${String(r.q)},${String(r.r)}`));
      const keel = keelOf(board.rooms);
      for (const room of board.rooms) {
        const t = mirror(room, keel);
        expect(cells.has(`${String(t.q)},${String(t.r)}`), `seed ${String(seed)}`).toBe(true);
      }
    }
  }, 60_000);

  it("never walks into wreckage, and never counts it as a compartment", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const board = boardOf(game);
    const wrecked = board.rooms.filter((r) => r.knows === "wrecked");
    const real = board.rooms.filter((r) => r.knows !== "wrecked");
    /* The ship's own compartments are all still there and all still real. */
    expect(real.length).toBe(game.ship.rooms.length);
    for (const w of wrecked) {
      /* Negative ids, so nothing that indexes by room id can collide with one. */
      expect(w.id).toBeLessThan(0);
      expect(w.things).toEqual([]);
      expect(w.name).toBe("");
    }
    /* And no corridor ever touches one. */
    const dead = new Set(wrecked.map((w) => w.id));
    for (const door of board.doors) {
      expect(dead.has(door.a)).toBe(false);
      expect(dead.has(door.b)).toBe(false);
    }
  });
});
