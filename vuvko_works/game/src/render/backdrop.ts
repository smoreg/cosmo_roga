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

/** The source artwork is drawn at 60 px to a 5 ft square. */
const SOURCE_PX_PER_FOOT = 12;
/** A uniform two-square bleed on every side, so neighbours overlap cleanly. */
const BLEED_FEET = 10;

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

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sizeFeet[0] * pxPerFoot);
  canvas.height = Math.round(sizeFeet[1] * pxPerFoot);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");

  for (const placement of plan) {
    const image = await loadImage(tileUrl(options.tilesBaseUrl, placement.path), options.signal);
    if (options.signal?.aborted === true) throw new Error("aborted");

    /* The image carries the bleed, so its own footprint is the declared tile
       plus ten feet on every side. The export's x,y is the tile's corner, not
       the bleed's, which is why the centre has to be worked back from it. */
    const imageWidthFeet = image.naturalWidth / SOURCE_PX_PER_FOOT;
    const imageHeightFeet = image.naturalHeight / SOURCE_PX_PER_FOOT;
    const tileWidthFeet = imageWidthFeet - BLEED_FEET * 2;
    const tileHeightFeet = imageHeightFeet - BLEED_FEET * 2;

    const turned = isQuarterTurned(placement.rotation);
    const footprintWidth = turned ? tileHeightFeet : tileWidthFeet;
    const footprintHeight = turned ? tileWidthFeet : tileHeightFeet;

    const centreX = (placement.x + footprintWidth / 2) * pxPerFoot;
    const centreY = (placement.y + footprintHeight / 2) * pxPerFoot;

    context.save();
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
