import { describe, expect, it } from "vitest";
import { cellAt, cellsOfZone, doorBetween, parseDeck, unreachableZones, zoneOf } from "./deck";
import type { RawDeckExport } from "./deck";

/** The smallest export the parser should accept: two rooms and one door. */
function minimalExport(): RawDeckExport {
  return {
    seed: 12345,
    ship: { name: "Test Hull", ft: [70, 70] },
    hex: { feetAcross: 35 },
    zones: [
      {
        id: 0,
        name: "Fore",
        kind: "command",
        areaSqFt: 100,
        hazard: null,
        entry: true,
        sealed: false,
      },
      {
        id: 1,
        name: "Aft",
        kind: "drive",
        areaSqFt: 100,
        hazard: null,
        entry: false,
        sealed: false,
      },
      {
        id: 2,
        name: "Void",
        kind: "drive",
        areaSqFt: 10,
        hazard: null,
        entry: false,
        sealed: true,
      },
    ],
    hexes: [
      { q: 0, r: 0, zone: 0 },
      { q: 0, r: 1, zone: 1 },
      { q: 1, r: 1, zone: 2 },
    ],
    doors: [
      { id: 0, a: 0, b: 1, state: "open", loop: false, at: [35, 35], from: [0, 0], to: [0, 1] },
      // A door the rasteriser could not place on a lattice edge is dropped.
      { id: 1, a: 0, b: 2, state: "open", loop: true, at: [0, 0], from: null, to: null },
    ],
  };
}

describe("what an export may leave out", () => {
  it("defaults the fields hexmap.html omits when it has nothing to say", () => {
    const deck = parseDeck(minimalExport());
    const fore = deck.zones.get(0);
    expect(fore?.roles).toEqual([]);
    expect(fore?.marks).toEqual([]);
    expect(fore?.sourceTile).toBe("");
    expect(deck.plan).toEqual([]);
    expect(cellAt(deck, { q: 0, r: 0 })?.overlaps).toEqual([0]);
  });

  it("drops a door with no lattice edge rather than inventing one", () => {
    const deck = parseDeck(minimalExport());
    expect(deck.doors).toHaveLength(1);
    expect(deck.doors[0]?.id).toBe(0);
    expect(doorBetween(deck, { q: 0, r: 0 }, { q: 1, r: 1 })).toBeNull();
  });

  it("reads an unknown door state as shut, never as open", () => {
    const raw = minimalExport();
    raw.doors[0] = { ...raw.doors[0]!, state: "welded" };
    expect(parseDeck(raw).doors[0]?.initialState).toBe("closed");

    raw.doors[0] = { ...raw.doors[0], state: "locked" };
    expect(parseDeck(raw).doors[0]?.initialState).toBe("locked");
  });

  it("reports the room no door reaches", () => {
    const deck = parseDeck(minimalExport());
    expect(deck.reachableZones.has(0)).toBe(true);
    expect(deck.reachableZones.has(1)).toBe(true);
    expect(deck.reachableZones.has(2)).toBe(false);
    expect(unreachableZones(deck).map((zone) => zone.name)).toEqual(["Void"]);
  });

  it("falls back to the first room when nothing is marked as the way in", () => {
    const raw = minimalExport();
    raw.zones = raw.zones.map(function notEntry(zone) {
      return { ...zone, entry: false };
    });
    expect(parseDeck(raw).entryZoneId).toBe(0);
  });

  it("refuses an export with no rooms at all", () => {
    const raw = minimalExport();
    raw.zones = [];
    expect(() => parseDeck(raw)).toThrow(/no zones/);
  });

  it("answers about hexes that are not there", () => {
    const deck = parseDeck(minimalExport());
    expect(cellAt(deck, { q: 9, r: 9 })).toBeNull();
    expect(zoneOf(deck, { q: 9, r: 9 })).toBeNull();
    expect(zoneOf(deck, { q: 0, r: 1 })?.name).toBe("Aft");
    expect(cellsOfZone(deck, 99)).toEqual([]);
  });
});
