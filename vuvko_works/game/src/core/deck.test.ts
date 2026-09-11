import { describe, expect, it } from "vitest";
import { cellsOfZone, doorBetween, unreachableZones, zoneOf } from "./deck";
import { testDeck } from "./test/fixtures";

describe("parsing a hexmap export", () => {
  it("reads the ship the generator drew", () => {
    const deck = testDeck();
    expect(deck.name).toBe("Hollow Tide — Barque");
    expect(deck.sizeFeet).toEqual([200, 500]);
    expect(deck.feetAcross).toBe(35);
    expect(deck.cells.size).toBe(73);
    expect(deck.doors).toHaveLength(20);
    expect(deck.plan).toHaveLength(11);
  });

  it("puts every door on a real, adjacent lattice edge", () => {
    const deck = testDeck();
    for (const door of deck.doors) {
      expect(zoneOf(deck, door.from)).not.toBeNull();
      expect(zoneOf(deck, door.to)).not.toBeNull();
      expect(doorBetween(deck, door.from, door.to)?.id).toBe(door.id);
      expect(doorBetween(deck, door.to, door.from)?.id).toBe(door.id);
    }
  });

  it("keeps the state the generator drew, rather than flinging everything open", () => {
    const deck = testDeck();
    const counts = new Map<string, number>();
    for (const door of deck.doors) {
      counts.set(door.initialState, (counts.get(door.initialState) ?? 0) + 1);
    }
    expect(counts.get("open")).toBe(14);
    expect(counts.get("closed")).toBe(4);
    expect(counts.get("locked")).toBe(2);
  });

  it("marks the boarding compartment", () => {
    const deck = testDeck();
    expect(deck.zones.get(deck.entryZoneId)?.name).toBe("50-dTon Hangar & Shuttle 2");
    expect(cellsOfZone(deck, deck.entryZoneId).length).toBeGreaterThan(2);
  });

  it("finds every room walkable on this ship, and says so", () => {
    /* Nothing is sealed here. The check matters anyway: a room the generator
       left without a door must be reported, never quietly given one. */
    const deck = testDeck();
    expect(unreachableZones(deck)).toEqual([]);
    for (const zone of deck.zones.values()) {
      if (cellsOfZone(deck, zone.id).length === 0) continue;
      expect(deck.reachableZones.has(zone.id)).toBe(true);
    }
  });

  it("ignores zones the lattice gave no hexes", () => {
    const deck = testDeck();
    const empty = [...deck.zones.values()].filter(
      (zone) => cellsOfZone(deck, zone.id).length === 0,
    );
    expect(empty.length).toBeGreaterThan(0);
  });
});
