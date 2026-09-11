import { describe, expect, it } from "vitest";
import { previewHull } from "../render/generate";
import { SHIP_PROFILES } from "../core/missions";

/** A hull's identity for comparison: what it is made of and where. */
function shapeOf(profile: string, seed: string): string {
  const hull = previewHull(profile, seed);
  return `${String(hull.widthFeet)}x${String(hull.heightFeet)}:${String(hull.tiles)}`;
}

describe("rolling a hull", () => {
  it("builds a different ship for every seed, on every profile", () => {
    /* The point of rolling a profile is that the same profile is not the same
       ship. If this ever collapses, every contract of a given shape becomes
       the same mission. */
    for (const profile of SHIP_PROFILES) {
      const names = new Set<string>();
      const shapes = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const seed = `roll-${String(i)}`;
        names.add(previewHull(profile.code, seed).name);
        shapes.add(shapeOf(profile.code, seed));
      }
      /* Half the names are built from two words and half from three, and the
         two-word form draws on a much smaller pool — so collisions are
         commoner than the full count of combinations suggests. Twenty
         distinct in thirty is variety; it is a floor, not a target. */
      expect(names.size, `${profile.code} names`).toBeGreaterThanOrEqual(20);
      /* Size and section count alone should separate most of them. */
      expect(shapes.size, `${profile.code} shapes`).toBeGreaterThan(1);
    }
  });

  it("builds the same ship twice from the same seed", () => {
    /* Boarding runs the layout again, so the briefing would be lying if this
       were not true. */
    for (const profile of SHIP_PROFILES) {
      const first = previewHull(profile.code, "steady");
      const second = previewHull(profile.code, "steady");
      expect(second).toEqual(first);
    }
  });

  it("names every ship it builds", () => {
    for (const profile of SHIP_PROFILES) {
      const hull = previewHull(profile.code, `name-${profile.code}`);
      expect(hull.name.length).toBeGreaterThan(3);
      /* "Something — Class", as the generator writes them. */
      expect(hull.name).toContain("—");
      expect(hull.name).not.toContain("承");
      expect(hull.tiles).toBeGreaterThan(0);
      expect(hull.widthFeet).toBeGreaterThan(0);
      expect(hull.heightFeet).toBeGreaterThan(0);
    }
  });

  it("gives the four profiles genuinely different fleets", () => {
    /* Profiles are hull shapes, so the same seed on two of them should not
       come out the same ship. */
    const seen = new Map<string, string>();
    for (const profile of SHIP_PROFILES) {
      const hull = previewHull(profile.code, "shared-seed");
      const previous = seen.get(hull.name);
      expect(previous, `${profile.code} duplicates ${String(previous)}`).toBeUndefined();
      seen.set(hull.name, profile.code);
    }
  });
});
