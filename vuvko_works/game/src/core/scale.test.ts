import { describe, expect, it } from "vitest";
import { hexArea } from "./hex";
import { makeUnit } from "./mission";
import { REFERENCE_HEX_FEET, movementHexes, profileOf } from "./roster";

/**
 * What the hex size is allowed to change, and what it is not.
 *
 * Attacks are adjacent-only, so the hex is weapon reach and shrinking it is a
 * real change to the game: a room stops being a place you occupy and becomes
 * one you manoeuvre inside. What it must *not* quietly change is how far a
 * turn gets you or how much floor is worth a node — those were tuned as a
 * distance and an area, and if they are left as step counts then halving the
 * hex silently thirds the pace and triples the ship's income.
 */
describe("what a turn is worth at different hex sizes", () => {
  it("keeps a turn the same distance, whatever the lattice", () => {
    const drone = profileOf("drone");
    expect(movementHexes(drone, REFERENCE_HEX_FEET)).toBe(4);
    expect(movementHexes(drone, 20)).toBe(7);

    for (const feetAcross of [35, 25, 20, 15, 10]) {
      const covered = movementHexes(drone, feetAcross) * feetAcross;
      expect(Math.abs(covered - drone.movementFeet), `at ${String(feetAcross)} ft`).toBeLessThan(
        feetAcross,
      );
    }
  });

  it("never leaves anything unable to move", () => {
    /* A hex wider than a whole turn's walk still has to be worth one step. */
    expect(movementHexes(profileOf("scout"), 500)).toBe(1);
  });

  it("gives a unit the steps the deck it was built for deserves", () => {
    const at = { q: 0, r: 0 };
    expect(makeUnit("drone", 0, at, REFERENCE_HEX_FEET).maxMovement).toBe(4);
    expect(makeUnit("drone", 0, at, 20).maxMovement).toBe(7);
  });
});

describe("how much floor a hex stands for", () => {
  it("measures a hexagon across the flats", () => {
    /* A 35 ft hex covers a bit over a thousand square feet — a compartment,
       not a cupboard, which is why four of them was the bar for a node. */
    expect(hexArea(35)).toBeCloseTo(1061, 0);
    expect(hexArea(20)).toBeCloseTo(346, 0);
  });

  it("shrinks with the square, so the bar in hexes has to grow with it", () => {
    /* Three 20 ft hexes to one 35 ft hex, near enough: the same room is worth
       a node at either size only because the threshold is converted. */
    expect(hexArea(35) / hexArea(20)).toBeCloseTo(3.06, 2);
  });
});
