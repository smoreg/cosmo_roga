/**
 * Bake the deck tiles the game actually draws.
 *
 * The geomorph library is 634 MB and 7,252 files. A jam build cannot carry
 * that and does not need to: the board draws one hundred-foot section per
 * compartment, so the only tiles worth shipping are the hundred-foot ones
 * whose plating is read off the artwork rather than guessed from a folder
 * name. That is 259 files and about eleven megabytes.
 *
 *   node tools/deck/bake.mjs [path to vuvko_works]
 *
 * Reads the downscaled set prepared for the other half of this project —
 * already 4 px/ft webp with a ten-foot bleed — and writes what is kept into
 * `public/deck/`, with an index and the licence beside it. Run it again and it
 * overwrites; nothing here is edited by hand.
 *
 * ## Why they come out inverted
 *
 * These are line art: four fifths of a tile is transparent and the ink is the
 * content. The ink is *dark* — median luminance about forty-five — which is
 * correct for the paper they were drawn for and useless here, because this
 * board is near-black. Dark ink at a third opacity over a near-black deck is
 * nothing at all, which is exactly how it looked.
 *
 * So the ink is inverted once, here, rather than by a filter on every frame:
 * the asset that ships is light line art on transparent, which is what a dark
 * interface needs. The alpha is the drawing and is kept.
 *
 * ## Why they come out smaller and grey
 *
 * They are a hexagon's background. The board draws a section at 118 px across
 * a 1.2 scale, so 142 css px, so 288 on a display that doubles — which is
 * exactly what is written, and anything beyond it is detail nobody can be
 * shown. They are drawn through `grayscale(1)` as well, at a third opacity,
 * under scanlines: the colour in the source is three quarters of the file and
 * none of it reaches the screen.
 *
 * Eleven megabytes to two and a half, and the difference is invisible at the
 * size it is drawn. If the board ever zooms, this is the number that has to go
 * up with it.
 *
 * The art is CC BY-NC (`public/deck/LICENCE.md`). That is a decision about the
 * whole project and not about this script: anything built with these tiles has
 * to stay non-commercial.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const salvor = join(here, "..", "..");
const source = process.argv[2] ?? join(salvor, "..", "..", "..", "vuvko_works");

const taxonomy = join(source, "game", "src", "assets", "tiles", "taxonomy.json");
const tiles = join(source, "game", "public", "geomorphs");
if (!existsSync(taxonomy)) {
  console.error(`no taxonomy at ${taxonomy}\nusage: node tools/deck/bake.mjs [path to vuvko_works]`);
  process.exit(1);
}

const tax = JSON.parse(readFileSync(taxonomy, "utf8")).tiles;
const out = join(salvor, "public", "deck");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "t"), { recursive: true });

/* A short, flat name per tile. The archive's own paths carry brackets, commas
   and spaces, and a URL that needs escaping is a URL that will be got wrong
   once. The hash is of the path, so a tile keeps its name across a re-bake. */
const name = (path) => createHash("sha1").update(path).digest("hex").slice(0, 12);

/**
 * 288 px because that is 118 px of hexagon, times the 1.2 the bleed costs,
 * times a display that doubles. Grey because the board draws these through
 * `grayscale(1)` and nothing of the colour ever arrives.
 */
const SIDE = 288;
const QUALITY = 60;
/** The alpha *is* the line art, so it is compressed gently. */
const ALPHA_QUALITY = 60;

const index = [];
let bytes = 0;
let warned = false;
for (const [path, tile] of Object.entries(tax)) {
  const ft = tile.ft ?? [];
  /* One compartment is one section is one hundred feet square. Anything else
     would have to be cut or stretched to sit under a hexagon. */
  if (ft[0] !== 100 || ft[1] !== 100) continue;
  /* Plating guessed from a folder name is not plating: a tile may only claim a
     side faces space when the hull curve is drawn on it. */
  if (tile.source === "folder") continue;
  const src = join(tiles, `${path.slice(0, -4)}.webp`);
  if (!existsSync(src)) continue;
  const id = name(path);
  const dst = join(out, "t", `${id}.webp`);
  /* ImageMagick rather than a dependency: this runs on a workstation to make a
     build artifact, never in CI and never at install time, so a tool somebody
     has to have installed is cheaper than a package everybody has to carry. */
  try {
    execFileSync(
      "magick",
      [
        src,
        "-colorspace", "Gray",
        /* Only the colour. `-negate` on its own inverts the alpha too, and an
           inverted alpha turns eighty-five per cent transparent line art into
           eighty-five per cent solid block. */
        "-channel", "RGB", "-negate", "+channel",
        "-resize", `${String(SIDE)}x${String(SIDE)}`,
        "-strip",
        "-quality", String(QUALITY),
        "-define", `webp:alpha-quality=${String(ALPHA_QUALITY)}`,
        dst,
      ],
      { stdio: "pipe" },
    );
  } catch {
    if (!warned) {
      console.warn("magick not found or failed — copying tiles at full size and colour");
      warned = true;
    }
    cpSync(src, dst);
  }
  bytes += statSync(dst).size;
  index.push({ id, roles: tile.roles ?? [], label: tile.label ?? "", set: tile.set ?? "" });
}

writeFileSync(
  join(out, "deck.json"),
  `${JSON.stringify(
    {
      note: "Generated by tools/deck/bake.mjs. Do not edit.",
      pxPerFoot: SIDE / 120,
      deckFeet: 100,
      bleedFeet: 10,
      side: SIDE,
      grey: true,
      /* Light ink on transparent: inverted at bake time, not at draw time. */
      inverted: true,
      tiles: index.sort((a, b) => (a.id < b.id ? -1 : 1)),
    },
    null,
    1,
  )}\n`,
);

const licence = join(tiles, "LICENCE.md");
if (existsSync(licence)) cpSync(licence, join(out, "LICENCE.md"));

console.log(`${String(index.length)} tiles, ${(bytes / 1e6).toFixed(1)} MB → public/deck/`);
