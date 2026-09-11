import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
