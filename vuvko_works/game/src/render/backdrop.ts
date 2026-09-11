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
import { loadImage } from "./images";

/** What the source artwork is drawn at, and what a bake falls back to. */
const SOURCE_PX_PER_FOOT = 12;
/** A uniform two-square bleed on every side, so neighbours overlap cleanly. */
const DEFAULT_BLEED_FEET = 10;

interface AtlasDescriptor {
  readonly pxPerFoot: number;
  readonly bleedFeet: number;
}

/**
 * How the tiles on disk are actually drawn.
 *
 * What ships is a downscaled bake, not the source artwork, and the two are not
 * the same resolution. Assuming the source's was exactly the bug that made the
 * deck plan shrink to a sixth of its size and look as though it had gone: the
 * only safe number is the one the bake wrote down.
 */
let atlasPromise: Promise<AtlasDescriptor> | null = null;

function describeAtlas(base: string): Promise<AtlasDescriptor> {
  atlasPromise ??= fetch(`${base}atlas.json`, { cache: "force-cache" })
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
      /* No descriptor: the source library is being served directly. */
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
 * How big a tile image is, in the plan's own feet.
 *
 * The arithmetic that broke: read a 2 px/ft bake as though it were the 12 px/ft
 * source and every tile comes out a sixth of its size. Pulled out on its own so
 * it can be checked without a canvas.
 */
export function tileGeometry(
  imageWidthPx: number,
  imageHeightPx: number,
  rotation: number,
  atlas: { pxPerFoot: number; bleedFeet: number },
): TileGeometry {
  const imageWidthFeet = imageWidthPx / atlas.pxPerFoot;
  const imageHeightFeet = imageHeightPx / atlas.pxPerFoot;
  const tileWidthFeet = imageWidthFeet - atlas.bleedFeet * 2;
  const tileHeightFeet = imageHeightFeet - atlas.bleedFeet * 2;
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

    /* The image carries the bleed, so its own footprint is the declared tile
       plus ten feet on every side. The export's x,y is the tile's corner, not
       the bleed's, which is why the centre has to be worked back from it. */
    const geometry = tileGeometry(
      image.naturalWidth,
      image.naturalHeight,
      placement.rotation,
      atlas,
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
