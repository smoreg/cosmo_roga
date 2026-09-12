#!/usr/bin/env node
/**
 * Writes the metadata the hull generator needs, trimmed to what can ship.
 *
 * The full manifest is 7252 tiles and 2.2 MB, and describes artwork the game
 * does not carry. The generator can only place tiles the taxonomy classified,
 * and only those are in the baked atlas, so the index is cut to that
 * intersection. This is metadata — sizes, folders, edge profiles — and no
 * artwork, which is why it can be committed when the tiles cannot.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const shared = resolve(root, "..");
const out = join(root, "src/assets/tiles");

/** Only the fields the generator and the renderer actually read. */
function trimTile(tile) {
  return {
    path: tile.path,
    set: tile.set,
    kind: tile.kind,
    code: tile.code,
    label: tile.label,
    w: tile.w,
    h: tile.h,
    px: tile.px,
    bleed: tile.bleed,
    mirror: tile.mirror,
    tag: tile.tag,
    tons: tile.tons,
    overlay: tile.overlay,
  };
}

async function main() {
  const manifestPath = join(shared, "geomorphs/geomorphs.manifest.json");
  try {
    await stat(manifestPath);
  } catch {
    console.error(
      `No manifest at ${manifestPath}.\n` +
        "It is written by fetch_geomorphs.py alongside the artwork:\n" +
        "    cd .. && python3 fetch_geomorphs.py",
    );
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const taxonomy = JSON.parse(await readFile(join(shared, "tiles.taxonomy.json"), "utf8"));
  const classified = taxonomy.tiles;

  /* Fuel intakes and scoops are hull plumbing, not rooms. The archive draws
     them as corner pieces, so the fit test happily puts an intake scoop in the
     middle of a deck; excluding them by name is cruder than a taxonomy rule and
     considerably more reliable. */
  const isFuelPlumbing = function plumbing(tile) {
    return /intake|scoop/i.test(tile.path);
  };

  const bases = manifest.tiles.filter(function known(tile) {
    return (
      !tile.overlay &&
      !isFuelPlumbing(tile) &&
      Object.prototype.hasOwnProperty.call(classified, tile.path)
    );
  });

  /* Overlays are what a room is furnished with.

     The base tile is very nearly empty — E510 "Cargo Bay" is a blank shell at
     15% ink — and its crates, its bunks and its bay doors are separate images
     drawn over it, keyed by the same code. Shipping only the bases, which is
     what this script used to do, is why generated decks read as large empty
     compartments. They are: the furniture was never downloaded.

     An overlay carries no geometry of its own, so it is never classified and
     never placed on its own. It ships when the base it belongs to ships. */
  /* Same folder and same index, not merely the same index. Codes repeat across
     directories — 66 of 977 do — so keying on the code alone would ship an
     E700 "Pointed Nose" overlay against the "Rounded Nose" base filed under the
     same number, and the generator would happily draw it there. */
  const overlayKey = function key(tile) {
    return `${tile.path.slice(0, tile.path.lastIndexOf("/"))}|${tile.code}${tile.mirror ? "|m" : ""}`;
  };
  const shipped = new Set(bases.map(overlayKey));
  const overlays = manifest.tiles.filter(function furniture(tile) {
    return (
      tile.overlay === true &&
      typeof tile.code === "string" &&
      tile.code !== "" &&
      !isFuelPlumbing(tile) &&
      shipped.has(overlayKey(tile))
    );
  });

  const tiles = [...bases, ...overlays];

  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify({
      pxPerSquare: manifest.pxPerSquare,
      feetPerSquare: manifest.feetPerSquare,
      tiles: tiles.map(trimTile),
    }),
  );
  await writeFile(join(out, "taxonomy.json"), JSON.stringify(taxonomy));

  const size = async function sizeOf(name) {
    return (await stat(join(out, name))).size;
  };
  const a = await size("manifest.json");
  const b = await size("taxonomy.json");
  process.stdout.write(
    `${String(bases.length)} base tiles + ${String(overlays.length)} overlays ` +
      `of ${String(manifest.tiles.length)}  ` +
      `manifest ${(a / 1e6).toFixed(2)} MB, taxonomy ${(b / 1e6).toFixed(2)} MB\n`,
  );
}

await main();
