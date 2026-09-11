import { describe, expect, it } from "vitest";
import { parseDeck } from "../deck";
import { buildDeck } from "./build";
import { findContacts } from "./contacts";
import { findRegions } from "./regions";
import { PX_FT } from "./types";
import type { HullPlan, InkMask } from "./types";

const SHIP_FT = 200;
const SIDE = SHIP_FT * PX_FT;

/**
 * A ship drawn by hand: a hull, and one unbroken wall down the middle.
 *
 * The wall has no gap in it on purpose. A doorway drawn open would make the
 * two halves one enclosed space — which is what the flood is *for*, since a
 * body can walk between them — and there would be one room, not two. A door is
 * found by looking *through* a wall thin enough to hold one, so the thickness
 * is the whole variable here.
 */
function twoRoomShip(wallFeet: number): InkMask {
  const ink = new Uint8Array(SIDE * SIDE);
  function paint(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = Math.max(0, y0); y < Math.min(SIDE, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(SIDE, x1); x++) ink[y * SIDE + x] = 1;
    }
  }
  const hull = 6 * PX_FT;
  paint(0, 0, SIDE, hull);
  paint(0, SIDE - hull, SIDE, SIDE);
  paint(0, 0, hull, SIDE);
  paint(SIDE - hull, 0, SIDE, SIDE);

  const mid = Math.round(SIDE / 2);
  const half = Math.round((wallFeet * PX_FT) / 2);
  paint(mid - half, hull, mid + half, SIDE - hull);
  return { w: SIDE, h: SIDE, ink };
}

function onePieceHull(): HullPlan {
  return {
    seed: "hand",
    name: "Test Hull",
    hull: "profile",
    W: SHIP_FT,
    H: SHIP_FT,
    put: [
      {
        tile: {
          path: "Test/hull.png",
          label: "Engineering (Reactor)",
          kind: "core",
          px: [SHIP_FT * 12, SHIP_FT * 12],
          w: SHIP_FT,
          h: SHIP_FT,
          tax: { roles: ["drive", "airlock"] },
        },
        x: 0,
        y: 0,
        w: SHIP_FT,
        h: SHIP_FT,
        cx: SHIP_FT / 2,
        cy: SHIP_FT / 2,
        rot: 0,
      },
    ],
  };
}

describe("the extraction pipeline", () => {
  it("finds the rooms the drawing encloses, and calls the rest vacuum", () => {
    const regions = findRegions(twoRoomShip(2));
    const rooms = regions.sizes.filter(function real(size, index) {
      return index > 1 && size > 0;
    });
    expect(rooms).toHaveLength(2);
    /* Both halves, less the hull and the wall. */
    for (const size of rooms) {
      expect(size / (PX_FT * PX_FT)).toBeGreaterThan(7000);
    }
  });

  it("sees a way between two rooms only where the wall is thin", () => {
    const mask = twoRoomShip(2);
    const regions = findRegions(mask);
    const contacts = findContacts(mask, regions);
    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(contact.a).not.toBe(contact.b);
      /* The one wall runs down the middle of the ship. */
      expect(Math.abs(contact.x - SIDE / 2)).toBeLessThan(4 * PX_FT);
    }
  });

  it("refuses a wall too thick to hold a door", () => {
    /* Ten feet of structure is a hull, a tank, or the space between two hulls.
       The cutoff is what stops any of those becoming a doorway. */
    const mask = twoRoomShip(10);
    const regions = findRegions(mask);
    const rooms = regions.sizes.filter(function real(size, index) {
      return index > 1 && size > 0;
    });
    expect(rooms).toHaveLength(2);
    expect(findContacts(mask, regions)).toHaveLength(0);
  });

  it("produces an export that parseDeck reads like any other", () => {
    const built = buildDeck(onePieceHull(), twoRoomShip(2), 35, "hand-built");
    const raw = built.deck;

    expect(raw.ship.name).toBe("Test Hull");
    expect(raw.ship.ft).toEqual([SHIP_FT, SHIP_FT]);
    expect(raw.hex.feetAcross).toBe(35);
    expect(raw.zones.length).toBeGreaterThanOrEqual(2);
    expect(raw.hexes.length).toBeGreaterThan(4);

    /* The same parser the hand-exported decks go through. */
    const deck = parseDeck(raw);
    expect(deck.cells.size).toBe(raw.hexes.length);
    expect(deck.zones.size).toBe(raw.zones.length);

    /* Rooms are named and typed from the tile beneath them. */
    for (const zone of deck.zones.values()) {
      expect(zone.name.length).toBeGreaterThan(0);
      expect(zone.kind).toBe("drive");
      expect(zone.roles).toContain("drive");
    }

    /* Every door sits on a lattice edge, as the renderer requires. */
    for (const door of deck.doors) {
      expect(deck.cells.has(`${String(door.from.q)},${String(door.from.r)}`)).toBe(true);
      expect(deck.cells.has(`${String(door.to.q)},${String(door.to.r)}`)).toBe(true);
    }

    /* Somewhere to come aboard, since the tile carries an airlock role. */
    const entry = [...deck.zones.values()].filter(function isEntry(zone) {
      return zone.isEntry;
    });
    expect(entry).toHaveLength(1);
  });

  it("is deterministic: the same seed builds the same deck", () => {
    const plan = onePieceHull();
    const first = buildDeck(plan, twoRoomShip(2), 35, "same").deck;
    const second = buildDeck(plan, twoRoomShip(2), 35, "same").deck;
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const other = buildDeck(plan, twoRoomShip(2), 35, "different").deck;
    /* The rooms are the same shape; what they contain is rolled. */
    expect(other.zones.length).toBe(first.zones.length);
  });
});
