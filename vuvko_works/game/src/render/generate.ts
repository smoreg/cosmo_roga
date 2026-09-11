/**
 * Making a ship that has never existed before.
 *
 * Three stages, each of which already worked on its own: the vendored hull
 * generator lays tiles out into a plan, the rasteriser draws that plan into an
 * ink mask, and the extraction reads rooms, doors and a lattice off the mask.
 * What comes out is the same export `hexmap.html` writes by hand, so nothing
 * downstream can tell the difference.
 */

import { buildDeck } from "../core/mapgen/build";
import type { RawDeckExport } from "../core/deck";
import { buildPools, layout, setLibrary } from "../vendor/geomorph-core.js";
import manifest from "../assets/tiles/manifest.json";
import taxonomy from "../assets/tiles/taxonomy.json";
import { rasterise } from "./rasterise";

let libraryLoaded = false;

/** The tile index only has to be handed over once per page. */
export function ensureLibrary(): void {
  if (libraryLoaded) return;
  setLibrary(manifest.tiles, taxonomy.tiles);
  buildPools("all");
  libraryLoaded = true;
}

export interface HullPreview {
  readonly name: string;
  readonly widthFeet: number;
  readonly heightFeet: number;
  readonly tiles: number;
}

/**
 * What ship this seed would build, without drawing a pixel of it.
 *
 * Laying tiles out is fast and needs no canvas; it is rasterising them that
 * costs. So the briefing can name the ship it is offering — and name it
 * correctly, because boarding runs the same layout from the same seed and gets
 * the same hull.
 */
export function previewHull(profile: string, seed: string): HullPreview {
  ensureLibrary();
  const plan = hullFor(profile, seed);
  return {
    name: plan.name,
    widthFeet: plan.W,
    heightFeet: plan.H,
    tiles: plan.put.length,
  };
}

/**
 * The seed the hull is actually laid out from.
 *
 * The generator draws the ship's name last, from a stream the seed alone
 * decides — so two profiles that happen to consume the same number of draws
 * come out as the same ship. `1-2-3` and `3-2-1` are mirror images of each
 * other and do exactly that. Mixing the profile into the seed separates them,
 * and costs nothing: the same contract still builds the same ship every time.
 */
export function hullSeed(profile: string, seed: string): string {
  return `${seed}:${profile}`;
}

function hullFor(profile: string, seed: string) {
  return layout({
    seed: hullSeed(profile, seed),
    hull: "profile",
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
}

export interface GenerateOptions {
  /** One of the four hull profiles: "1-2-1", "1-2-3", "2-1-2", "3-2-1". */
  readonly profile: string;
  readonly seed: string;
  readonly hexFeet?: number;
  readonly tilesBaseUrl: string;
  readonly signal?: AbortSignal | undefined;
}

export async function generateDeck(options: GenerateOptions): Promise<RawDeckExport> {
  ensureLibrary();

  const plan = hullFor(options.profile, options.seed);

  const mask = await rasterise(plan, {
    tilesBaseUrl: options.tilesBaseUrl,
    signal: options.signal,
  });

  return buildDeck(plan, mask, options.hexFeet ?? 35, options.seed).deck;
}
