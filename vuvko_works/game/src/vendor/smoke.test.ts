import { describe, expect, it } from "vitest";
import { buildPools, layout, setLibrary } from "./geomorph-core.js";
import manifest from "../assets/tiles/manifest.json";
import taxonomy from "../assets/tiles/taxonomy.json";

describe("the vendored hull generator", () => {
  it("runs with no DOM at all", () => {
    const bases = manifest.tiles.filter((tile) => !tile.overlay);
    const overlays = manifest.tiles.filter((tile) => tile.overlay);

    const loaded = setLibrary(manifest.tiles, taxonomy.tiles);
    expect(loaded.tiles).toBe(manifest.tiles.length);
    /* Only bases carry geometry, so only bases are classified. Overlays ride
       on a base's code and are never placed or measured on their own. */
    expect(loaded.classified).toBe(bases.length);
    expect(overlays.length).toBeGreaterThan(0);

    /* An overlay may only be drawn on the tile it was authored for: same
       folder, same index. Codes repeat across directories, so the folder is
       part of the identity — without it an E700 "Pointed Nose" overlay pairs
       with the "Rounded Nose" base filed under the same number. */
    const identity = (path: string, code: string, mirror: boolean) =>
      `${path.slice(0, path.lastIndexOf("/"))}|${code}${mirror ? "|m" : ""}`;
    const baseIdentities = new Set(
      bases.map((tile) => identity(tile.path, tile.code, tile.mirror)),
    );
    for (const overlay of overlays) {
      expect(
        baseIdentities.has(identity(overlay.path, overlay.code, overlay.mirror)),
        overlay.path,
      ).toBe(true);
    }

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
        vehic: true,
        overlayChance: 1,
      });
      // eslint-disable-next-line no-console
      console.log(
        `${profile}: ${String(plan.W)}x${String(plan.H)} ft, ${String(plan.put.length)} placements, "${plan.name}"`,
      );
      expect(plan.put.length).toBeGreaterThan(0);
      /* Every placed overlay must sit exactly on a base placed before it. */
      const placedBases = new Set<string>();
      for (const placement of plan.put) {
        if (placement.tile.overlay) {
          expect(placedBases.has(`${String(placement.x)},${String(placement.y)}`)).toBe(true);
        } else {
          placedBases.add(`${String(placement.x)},${String(placement.y)}`);
        }
      }
      /* Fuel plumbing is excluded from the index; nothing should place one. */
      for (const placement of plan.put) {
        expect(/intake|scoop/i.test(placement.tile.path), placement.tile.path).toBe(false);
      }
      expect(plan.W).toBeGreaterThan(0);
      expect(plan.H).toBeGreaterThan(0);
    }
  });
});
