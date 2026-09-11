/**
 * Drawing the ship under the grid, from the artwork itself.
 *
 * This is `hexmap.html`'s own raster routine, kept: each placement is drawn
 * rotated about its centre with the whole tile image, bleed included, at 12 px
 * to the foot in the source. Reusing it rather than baking the plan offline
 * means one implementation, and it works just as well on a plan a generator
 * produced a moment ago as on one loaded from an export.
 *
 * The result is a *blueprint*, not a blur: the line art stays sharp and the
 * contrast comes out instead, recoloured to a single ink that the renderer
 * lays down at low opacity. Blur would remove exactly the detail worth showing.
 */

import type { TilePlacement } from "../core/types";
import manifest from "../assets/tiles/manifest.json";
import { loadImage } from "./images";

/** A tile's own dimensions: its footprint in feet, its artwork in source px. */
export interface DeclaredTile {
  /** The footprint the tile occupies on the plan, in feet. */
  readonly w: number;
  readonly h: number;
  /** The whole image including bleed, in source pixels. */
  readonly px: readonly [number, number];
}

/**
 * What each tile says it measures, by path.
 *
 * The index the generator lays out from carries every tile's footprint *and*
 * the size of its artwork, so the renderer never has to work either one out
 * from the file it happens to have been handed. Built once, on first use.
 */
let declaredTiles: Map<string, DeclaredTile> | null = null;

function indexTiles(): Map<string, DeclaredTile> {
  const index = new Map<string, DeclaredTile>();
  for (const tile of manifest.tiles) {
    const [wide, tall] = tile.px;
    /* A tile with no recorded artwork size cannot be measured from the index,
       so leave it out and let it fall back rather than record a nonsense. */
    if (wide === undefined || tall === undefined) continue;
    index.set(tile.path, { w: tile.w, h: tile.h, px: [wide, tall] });
  }
  return index;
}

function declaredTile(path: string): DeclaredTile | undefined {
  declaredTiles ??= indexTiles();
  return declaredTiles.get(path);
}

/** What the source artwork is drawn at, and what a bake falls back to. */
const SOURCE_PX_PER_FOOT = 12;
/** A uniform two-square bleed on every side, so neighbours overlap cleanly. */
const DEFAULT_BLEED_FEET = 10;

interface AtlasDescriptor {
  readonly pxPerFoot: number;
  readonly bleedFeet: number;
}

/**
 * How the tiles on disk are actually drawn — the last resort only.
 *
 * Every tile the generator can place is in the index, and the index says how
 * big its artwork is, so this is consulted only for a path that is not. It is
 * kept because a hand-made export may name artwork the shipped index does not
 * carry, and half a plan beats none.
 *
 * The answer is remembered, but a *failure* is not: memoising one meant a
 * single missed fetch — the file not yet baked, a page left open across a
 * rebake — pinned the fallback resolution for the life of the tab, and every
 * tile afterwards drew small however many times the plan was redrawn.
 */
let atlasPromise: Promise<AtlasDescriptor> | null = null;

function describeAtlas(base: string): Promise<AtlasDescriptor> {
  atlasPromise ??= fetch(`${base}atlas.json`, { cache: "no-cache" })
    .then(function read(response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Partial<AtlasDescriptor>>;
    })
    .then(function take(doc): AtlasDescriptor {
      return {
        pxPerFoot: typeof doc.pxPerFoot === "number" ? doc.pxPerFoot : SOURCE_PX_PER_FOOT,
        bleedFeet: typeof doc.bleedFeet === "number" ? doc.bleedFeet : DEFAULT_BLEED_FEET,
      };
    })
    .catch(function unbaked(): AtlasDescriptor {
      /* No descriptor: assume the source library is being served directly,
         and ask again next time rather than living with the guess. */
      atlasPromise = null;
      return { pxPerFoot: SOURCE_PX_PER_FOOT, bleedFeet: DEFAULT_BLEED_FEET };
    });
  return atlasPromise;
}

export interface BlueprintOptions {
  /** Where the tile set is served from, with a trailing slash. */
  readonly tilesBaseUrl: string;
  /** An underlay needs nothing like the source's 12. */
  readonly pxPerFoot?: number;
  readonly ink?: string;
  readonly signal?: AbortSignal;
}

/**
 * Where a tile actually lives.
 *
 * The deck plan names the source artwork, which is PNG. What ships is the
 * downscaled WebP set built by `scripts/bake_tile_atlas.py` — same paths, same
 * folders, different extension.
 */
export function tileUrl(base: string, path: string): string {
  return base + path.replace(/\.png$/i, ".webp");
}

export interface TileGeometry {
  /** The whole image, bleed included, in feet. */
  readonly imageWidthFeet: number;
  readonly imageHeightFeet: number;
  /** The tile's own footprint on the plan, after rotation. */
  readonly footprintWidthFeet: number;
  readonly footprintHeightFeet: number;
}

/**
 * How big a tile is, in the plan's own feet.
 *
 * Both numbers come from the tile index, and neither is measured off the file
 * that happened to be downloaded. That is the whole point: what ships is a
 * downscaled bake, the bake resolution has already changed twice, and every
 * time the renderer inferred feet from the pixels in hand it got them wrong —
 * once by a factor of six, once by three. The index records the artwork in
 * *source* pixels, and the source resolution is a fact about the index rather
 * than about anything on disk, so `px / 12` is the image's size in feet at
 * every bake resolution there will ever be, including none at all.
 *
 * The footprint is likewise declared, not derived. It is not the image less a
 * fixed bleed: an eighth of the library bleeds unevenly, and one connecting
 * gangway carries thirty-five feet of overhang down and ten across, so taking
 * ten off all round puts that tile fifty feet out.
 *
 * Only a tile the index has never heard of falls back to measuring, and that
 * is the one case where there is nothing better to do.
 */
export function tileGeometry(
  imageWidthPx: number,
  imageHeightPx: number,
  rotation: number,
  atlas: { pxPerFoot: number; bleedFeet: number },
  declared?: DeclaredTile,
): TileGeometry {
  const imageWidthFeet =
    declared === undefined ? imageWidthPx / atlas.pxPerFoot : declared.px[0] / SOURCE_PX_PER_FOOT;
  const imageHeightFeet =
    declared === undefined ? imageHeightPx / atlas.pxPerFoot : declared.px[1] / SOURCE_PX_PER_FOOT;
  const tileWidthFeet = declared?.w ?? imageWidthFeet - atlas.bleedFeet * 2;
  const tileHeightFeet = declared?.h ?? imageHeightFeet - atlas.bleedFeet * 2;
  const turned = isQuarterTurned(rotation);
  return {
    imageWidthFeet,
    imageHeightFeet,
    footprintWidthFeet: turned ? tileHeightFeet : tileWidthFeet,
    footprintHeightFeet: turned ? tileWidthFeet : tileHeightFeet,
  };
}

/** Quarter turns swap a tile's footprint; anything else leaves it alone. */
function isQuarterTurned(rotation: number): boolean {
  const turned = ((rotation % 360) + 360) % 360;
  return turned === 90 || turned === 270;
}

export async function renderBlueprint(
  plan: readonly TilePlacement[],
  sizeFeet: readonly [number, number],
  options: BlueprintOptions,
): Promise<string> {
  const pxPerFoot = options.pxPerFoot ?? 3;
  const ink = options.ink ?? "#7ab0d6";

  const atlas = await describeAtlas(options.tilesBaseUrl);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sizeFeet[0] * pxPerFoot);
  canvas.height = Math.round(sizeFeet[1] * pxPerFoot);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  for (const placement of plan) {
    const image = await loadImage(tileUrl(options.tilesBaseUrl, placement.path), options.signal);
    if (options.signal?.aborted === true) throw new Error("aborted");

    /* The image carries the bleed, and the bleed is symmetric about each axis
       even where it is not the usual ten feet — so whatever the overhang, the
       image is centred on the tile. The export's x,y is the tile's corner,
       which is why the centre has to be worked back from it. */
    const geometry = tileGeometry(
      image.naturalWidth,
      image.naturalHeight,
      placement.rotation,
      atlas,
      declaredTile(placement.path),
    );
    const { imageWidthFeet, imageHeightFeet } = geometry;

    /* Clip each tile to its own footprint before drawing it.

       The bleed exists so a tile's artwork runs past its edge and meets its
       neighbour's — which means neighbours draw the same strip of ship twice.
       Painted one over the other, two antialiased edges do not overlay, they
       accumulate: a half-covered pixel over a half-covered pixel comes out
       three-quarters covered, and the join reads as a denser band once the
       whole thing is flattened to one ink. Measured on one plan, that is 0.4%
       of the image sitting up to a third of an alpha step too dark, and most
       of it along tile boundaries.

       Clipping to the footprint drops the duplicate strip entirely, so there
       is nothing to accumulate. The edges are snapped to whole pixels so two
       neighbours cannot leave a hairline between them either. */
    const left = Math.round(placement.x * pxPerFoot);
    const top = Math.round(placement.y * pxPerFoot);
    const right = Math.round((placement.x + geometry.footprintWidthFeet) * pxPerFoot);
    const bottom = Math.round((placement.y + geometry.footprintHeightFeet) * pxPerFoot);

    const centreX = (left + right) / 2;
    const centreY = (top + bottom) / 2;

    context.save();
    context.beginPath();
    context.rect(left, top, right - left, bottom - top);
    context.clip();
    context.translate(centreX, centreY);
    if (placement.rotation !== 0) context.rotate((placement.rotation * Math.PI) / 180);
    context.drawImage(
      image,
      (-imageWidthFeet / 2) * pxPerFoot,
      (-imageHeightFeet / 2) * pxPerFoot,
      imageWidthFeet * pxPerFoot,
      imageHeightFeet * pxPerFoot,
    );
    context.restore();
  }

  /* One ink, with the artwork's own line weight kept in the alpha channel.
     Monochrome is what stops the underlay arguing with the unit colours. */
  context.globalCompositeOperation = "source-in";
  context.fillStyle = ink;
  context.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png");
}
