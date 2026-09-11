/**
 * Drawing a hull plan into an ink mask.
 *
 * The only stage of map generation that needs a canvas: everything downstream
 * works on the mask this produces, which is why the rest of the pipeline lives
 * in `core/` and can be tested without a browser.
 */

import { ALPHA, PX_FT, isArchitecture } from "../core/mapgen/types";
import type { HullPlan, InkMask, Placement } from "../core/mapgen/types";
import { tileUrl } from "./backdrop";
import { loadImage } from "./images";

const SIDES = ["n", "e", "s", "w"] as const;
type Side = (typeof SIDES)[number];

/** Is another tile laid against this side of this one? */
function touching(tiles: readonly Placement[], subject: Placement, side: Side): boolean {
  for (const other of tiles) {
    if (other === subject) continue;
    const overlapX =
      Math.min(subject.x + subject.w, other.x + other.w) - Math.max(subject.x, other.x);
    const overlapY =
      Math.min(subject.y + subject.h, other.y + other.h) - Math.max(subject.y, other.y);
    if (side === "n" && overlapX > 0 && other.y + other.h === subject.y) return true;
    if (side === "s" && overlapX > 0 && other.y === subject.y + subject.h) return true;
    if (side === "w" && overlapY > 0 && other.x + other.w === subject.x) return true;
    if (side === "e" && overlapY > 0 && other.x === subject.x + subject.w) return true;
  }
  return false;
}

export interface RasterOptions {
  readonly tilesBaseUrl: string;
  readonly signal?: AbortSignal | undefined;
}

export async function rasterise(plan: HullPlan, options: RasterOptions): Promise<InkMask> {
  const w = Math.round(plan.W * PX_FT);
  const h = Math.round(plan.H * PX_FT);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("no 2d context");

  const tiles = plan.put.filter(isArchitecture);

  for (const placement of tiles) {
    const image = await loadImage(
      tileUrl(options.tilesBaseUrl, placement.tile.path),
      options.signal,
    );
    const iw = (placement.tile.px[0] / 12) * PX_FT;
    const ih = (placement.tile.px[1] / 12) * PX_FT;
    context.save();
    context.translate(placement.cx * PX_FT, placement.cy * PX_FT);
    if (placement.rot !== 0) context.rotate((placement.rot * Math.PI) / 180);
    context.drawImage(image, -iw / 2, -ih / 2, iw, ih);
    context.restore();
  }

  const data = context.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let i = 0, p = 3; i < ink.length; i++, p += 4) ink[i] = (data[p] ?? 0) > ALPHA ? 1 : 0;

  sealDanglingEdges(ink, w, tiles);
  return { w, h, ink };
}

/**
 * Close the connections that lead nowhere, and only those.
 *
 * A geomorph carries corridor stubs at its edges — openings drawn to meet the
 * tile next door — and where there is no tile next door they are holes the
 * vacuum pours through, so the compartments come out as space. Sealing the
 * whole outline would be wrong the other way: a wing or a fuel wedge is drawn
 * inset in its box, and the blank part of that box really is space.
 *
 * The taxonomy already knows which is which, having read each tile's edges cell
 * by cell: `#` where structure reaches the boundary, `.` where the hull has
 * curved away. Seal the `#` cells, leave the `.` cells open.
 */
function sealDanglingEdges(ink: Uint8Array, w: number, tiles: readonly Placement[]): void {
  for (const placement of tiles) {
    const edges = placement.tile.tax?.edge;
    if (edges === undefined) continue;

    const turns = ((placement.rot || 0) / 90) % 4;
    const x0 = Math.round(placement.x * PX_FT);
    const x1 = Math.round((placement.x + placement.w) * PX_FT);
    const y0 = Math.round(placement.y * PX_FT);
    const y1 = Math.round((placement.y + placement.h) * PX_FT);

    for (let j = 0; j < 4; j++) {
      const side = SIDES[j];
      if (side === undefined || touching(tiles, placement, side)) continue;
      const own = SIDES[(j - turns + 4) % 4];
      if (own === undefined) continue;

      /* Stored west to east along the top and north to south down the sides;
         read clockwise so a rotation is a shift and nothing has to be flipped. */
      const stored = edges[own] ?? "";
      /* Read clockwise, so two of the four sides arrive backwards. */
      const profile = own === "s" || own === "w" ? reverseProfile(stored) : stored;
      if (profile.length === 0) continue;

      const along = side === "n" || side === "s" ? x1 - x0 : y1 - y0;
      for (let c = 0; c < profile.length; c++) {
        if (profile[c] === ".") continue;
        const from = Math.round((c / profile.length) * along);
        const to = Math.round(((c + 1) / profile.length) * along);
        for (let t = from; t < to; t++) {
          const u = side === "s" || side === "w" ? along - 1 - t : t;
          for (let d = 0; d < 2; d++) {
            const index =
              side === "n"
                ? (y0 + d) * w + (x0 + u)
                : side === "s"
                  ? (y1 - 1 - d) * w + (x0 + u)
                  : side === "w"
                    ? (y0 + u) * w + (x0 + d)
                    : (y0 + u) * w + (x1 - 1 - d);
            if (index >= 0 && index < ink.length) ink[index] = 1;
          }
        }
      }
    }
  }
}

/** These hold only `#` and `.`, but a loop says so without relying on it. */
function reverseProfile(profile: string): string {
  let out = "";
  for (let i = profile.length - 1; i >= 0; i--) out += profile.charAt(i);
  return out;
}
