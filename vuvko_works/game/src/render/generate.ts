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

  const plan = layout({
    seed: options.seed,
    hull: "profile",
    profile: options.profile,
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

  const mask = await rasterise(plan, {
    tilesBaseUrl: options.tilesBaseUrl,
    signal: options.signal,
  });

  return buildDeck(plan, mask, options.hexFeet ?? 35, options.seed).deck;
}
