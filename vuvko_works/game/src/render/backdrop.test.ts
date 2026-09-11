import { describe, expect, it } from "vitest";
import { tileGeometry, tileUrl } from "./backdrop";

const SOURCE = { pxPerFoot: 12, bleedFeet: 10 };
const BAKED = { pxPerFoot: 2, bleedFeet: 10 };

/* Three real entries from the tile index: a plain [100x100], a [100x50], and
   the connecting gangway that bleeds seven squares down and two across. */
const SQUARE = { w: 100, h: 100, px: [1440, 1440] as const };
const HALF = { w: 100, h: 50, px: [1440, 840] as const };
const GANGWAY = { w: 100, h: 100, px: [1440, 2040] as const };

describe("sizing a tile in the plan's feet", () => {
  it("reads the source artwork at its own resolution", () => {
    /* A [100x100] tile arrives as 1440 px: 120 ft of image around 100 ft of
       tile, with ten feet of bleed on every side. */
    const geometry = tileGeometry(1440, 1440, 0, SOURCE);
    expect(geometry.imageWidthFeet).toBe(120);
    expect(geometry.footprintWidthFeet).toBe(100);
    expect(geometry.footprintHeightFeet).toBe(100);
  });

  it("reads a downscaled bake at its own resolution, not the source's", () => {
    /* The bug this pins: the same tile baked at 2 px/ft is 240 px. Read as
       12 px/ft it measures 20 ft instead of 120, and the whole deck plan
       draws at a sixth of its size — which looks like it has disappeared. */
    const wrong = tileGeometry(240, 240, 0, SOURCE);
    expect(wrong.imageWidthFeet).toBe(20);

    const right = tileGeometry(240, 240, 0, BAKED);
    expect(right.imageWidthFeet).toBe(120);
    expect(right.footprintWidthFeet).toBe(100);
  });

  it("gives the same feet whatever resolution the bake used", () => {
    for (const pxPerFoot of [12, 6, 3, 2, 1.5, 1]) {
      const geometry = tileGeometry(120 * pxPerFoot, 120 * pxPerFoot, 0, {
        pxPerFoot,
        bleedFeet: 10,
      });
      expect(geometry.imageWidthFeet).toBeCloseTo(120, 6);
      expect(geometry.footprintWidthFeet).toBeCloseTo(100, 6);
    }
  });

  it("swaps the footprint on a quarter turn, and not otherwise", () => {
    /* A [100x50] tile: 120 x 70 ft of image, 100 x 50 ft of tile. */
    const upright = tileGeometry(1440, 840, 0, SOURCE);
    expect(upright.footprintWidthFeet).toBe(100);
    expect(upright.footprintHeightFeet).toBe(50);

    for (const rotation of [90, 270, -90, 450]) {
      const turned = tileGeometry(1440, 840, rotation, SOURCE);
      expect(turned.footprintWidthFeet, `at ${String(rotation)}`).toBe(50);
      expect(turned.footprintHeightFeet, `at ${String(rotation)}`).toBe(100);
    }
    for (const rotation of [180, 360, 0]) {
      const flipped = tileGeometry(1440, 840, rotation, SOURCE);
      expect(flipped.footprintWidthFeet, `at ${String(rotation)}`).toBe(100);
    }
  });
  it("believes the tile's declared size over the image less a fixed bleed", () => {
    /* CB05, the connecting gangway: a 100 x 100 ft tile drawn into a
       120 x 170 ft image, because it bleeds two squares across and seven
       down. Taking ten feet off every side makes it 100 x 150 and puts fifty
       feet of it in the wrong place. An eighth of the library bleeds
       unevenly like this. */
    const guessed = tileGeometry(1440, 2040, 0, SOURCE);
    expect(guessed.footprintHeightFeet).toBe(150);

    const declared = tileGeometry(1440, 2040, 0, SOURCE, GANGWAY);
    expect(declared.imageHeightFeet).toBe(170);
    expect(declared.footprintWidthFeet).toBe(100);
    expect(declared.footprintHeightFeet).toBe(100);
  });

  it("still swaps a declared footprint on a quarter turn", () => {
    const turned = tileGeometry(1440, 840, 90, SOURCE, HALF);
    expect(turned.footprintWidthFeet).toBe(50);
    expect(turned.footprintHeightFeet).toBe(100);
  });

  it("ignores the file's own pixels entirely when the index knows the tile", () => {
    /* The point of reading the index: the answer must not depend on which
       bake was downloaded. Hand it a tile at every resolution the atlas has
       ever been baked at — and one at none of them — and it comes back with
       the same hundred feet each time. Inferring from the pixels in hand is
       what produced a sixth-scale plan, and then a third-scale one. */
    for (const pxPerFoot of [12, 4, 3, 2, 0.5]) {
      const geometry = tileGeometry(120 * pxPerFoot, 120 * pxPerFoot, 0, SOURCE, SQUARE);
      expect(geometry.imageWidthFeet, `baked at ${String(pxPerFoot)}`).toBe(120);
      expect(geometry.footprintWidthFeet, `baked at ${String(pxPerFoot)}`).toBe(100);
    }
  });

  it("falls back to measuring only a tile the index has never heard of", () => {
    const measured = tileGeometry(480, 480, 0, { pxPerFoot: 4, bleedFeet: 10 });
    expect(measured.imageWidthFeet).toBe(120);
    expect(measured.footprintWidthFeet).toBe(100);
  });
});

describe("finding a tile", () => {
  it("asks for the baked webp, not the source png", () => {
    expect(tileUrl("./geomorphs/", "Geomorphs/100x100 End/701 [100x100] Bridge.png")).toBe(
      "./geomorphs/Geomorphs/100x100 End/701 [100x100] Bridge.webp",
    );
  });

  it("leaves anything that is not a png alone", () => {
    expect(tileUrl("./geomorphs/", "a/b.webp")).toBe("./geomorphs/a/b.webp");
  });
});
