import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../assets/tiles/manifest.json";
import deckExport from "../assets/decks/hollow-tide-35ft.json";

const ATLAS = "public/geomorphs";
const descriptorPath = join(ATLAS, "atlas.json");

/** Width and height out of a WebP header, without decoding the image. */
function webpSize(bytes: Buffer): [number, number] | null {
  if (bytes.toString("ascii", 0, 4) !== "RIFF") return null;
  const format = bytes.toString("ascii", 12, 16);
  if (format === "VP8X") {
    return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  }
  if (format === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  if (format === "VP8 ") {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  return null;
}

describe("the baked tile atlas", () => {
  it.skipIf(!existsSync(descriptorPath))("is drawn at the resolution its descriptor claims", () => {
    /* The descriptor is the only thing standing between a rebake at a new
         resolution and a deck plan that silently draws at the wrong size. */
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
      pxPerFoot: number;
      bleedFeet: number;
    };
    expect(descriptor.pxPerFoot).toBeGreaterThan(0);
    expect(descriptor.bleedFeet).toBe(10);

    const paths = [...new Set(deckExport.plan.map((placement) => placement.path))];
    let checked = 0;
    for (const path of paths) {
      const file = join(ATLAS, path.replace(/\.png$/i, ".webp"));
      if (!existsSync(file)) continue;
      const size = webpSize(readFileSync(file));
      if (size === null) continue;

      /* A tile's name states its footprint; the image is that plus bleed. */
      const named = /\[(\d+)x(\d+)\]/.exec(path);
      if (named === null) continue;
      const expectedWidth = (Number(named[1]) + descriptor.bleedFeet * 2) * descriptor.pxPerFoot;
      expect(Math.abs(size[0] - expectedWidth), `${path} width`).toBeLessThanOrEqual(2);
      checked++;
    }
    expect(checked, "no atlas tiles were checked").toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(descriptorPath))("is a faithful scaling of what the index records", () => {
    /* The renderer works a tile's size out from the index — `px / 12` — and
       never from the file it downloaded, so nothing on disk can put the plan
       at the wrong scale again. That only holds while the bake really is the
       index's artwork scaled by one number, which is what this checks. */
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as { pxPerFoot: number };
    const ratio = descriptor.pxPerFoot / 12;

    let checked = 0;
    for (const tile of manifest.tiles) {
      const file = join(ATLAS, tile.path.replace(/\.png$/i, ".webp"));
      if (!existsSync(file)) continue;
      const size = webpSize(readFileSync(file));
      const [wide, tall] = tile.px;
      if (size === null || wide === undefined || tall === undefined) continue;
      expect(Math.abs(size[0] - wide * ratio), `${tile.path} width`).toBeLessThanOrEqual(1);
      expect(Math.abs(size[1] - tall * ratio), `${tile.path} height`).toBeLessThanOrEqual(1);
      checked++;
    }
    expect(checked, "no atlas tiles were checked").toBeGreaterThan(0);
  });

  it("records the artwork size of every tile the generator can place", () => {
    /* The fallback that measures the downloaded file exists for a hand-made
       export naming artwork the shipped index does not carry. It must never
       be what a *generated* ship relies on, and it is not: the generator can
       only place what the index describes. */
    const missing = manifest.tiles.filter(function unmeasured(tile) {
      return tile.px.length !== 2 || tile.px[0] === undefined || tile.w === undefined;
    });
    expect(missing.map((tile) => tile.path)).toEqual([]);
  });
});
