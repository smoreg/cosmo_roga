import { describe, expect, it } from "vitest";
import { buildPools, layout, setLibrary } from "./geomorph-core.js";
import manifest from "../assets/tiles/manifest.json";
import taxonomy from "../assets/tiles/taxonomy.json";

describe("the vendored hull generator", () => {
  it("runs with no DOM at all", () => {
    const loaded = setLibrary(manifest.tiles, taxonomy.tiles);
    expect(loaded.tiles).toBe(1789);
    expect(loaded.classified).toBe(1789);

    buildPools("all");

    for (const profile of ["1-2-1", "1-2-3", "2-1-2", "3-2-1"]) {
      const plan = layout({
        seed: `probe-${profile}`,
        hull: "profile" as const,
        profile,
        beam: 2,
        rows: 4,
        sets: "all",
        family: "",
        rim: "none",
        symmetric: "soft",
        q: "",
        spin: false,
        mega: true,
        vehic: false,
      });
      // eslint-disable-next-line no-console
      console.log(
        `${profile}: ${String(plan.W)}x${String(plan.H)} ft, ${String(plan.put.length)} placements, "${plan.name}"`,
      );
      expect(plan.put.length).toBeGreaterThan(0);
      expect(plan.W).toBeGreaterThan(0);
      expect(plan.H).toBeGreaterThan(0);
    }
  });
});
