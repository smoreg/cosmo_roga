import { describe, expect, it } from "vitest";
import { deckGeometry } from "./deck";
import { hexCentre, hexCorners } from "./hex";
import { testDeck } from "./test/fixtures";

describe("the lattice against the deck plan", () => {
  it("stands column zero on the keel, as hexmap.html builds it", () => {
    for (const deck of [testDeck()]) {
      const geometry = deckGeometry(deck);
      const [shipWidth] = deck.sizeFeet;
      expect(geometry.originX).toBeCloseTo(shipWidth / 2, 10);
      expect(geometry.originY).toBe(0);
      /* Hex (0, 0) is the bow, on the centreline. */
      expect(hexCentre(geometry, { q: 0, r: 0 })).toEqual({ x: shipWidth / 2, y: 0 });
    }
  });

  it("keeps every hex inside the ship the artwork drew", () => {
    /* If this drifts, the blueprint underneath lands somewhere else entirely —
       which is exactly what a wrong origin looks like. */
    for (const deck of [testDeck()]) {
      const geometry = deckGeometry(deck);
      const [shipWidth, shipHeight] = deck.sizeFeet;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const cell of deck.cells.values()) {
        for (const corner of hexCorners(geometry, cell.at)) {
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        }
      }
      const slack = deck.feetAcross;
      expect(minX).toBeGreaterThan(-slack);
      expect(maxX).toBeLessThan(shipWidth + slack);
      expect(minY).toBeGreaterThan(-slack);
      expect(maxY).toBeLessThan(shipHeight + slack);
      /* And it should actually use the width, not huddle in one corner. */
      expect(maxX - minX).toBeGreaterThan(shipWidth * 0.6);
    }
  });
});
