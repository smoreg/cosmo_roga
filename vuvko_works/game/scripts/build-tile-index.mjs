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

  const tiles = manifest.tiles.filter(function known(tile) {
    return Object.prototype.hasOwnProperty.call(classified, tile.path);
  });

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
    `${String(tiles.length)} of ${String(manifest.tiles.length)} tiles kept  ` +
      `manifest ${(a / 1e6).toFixed(2)} MB, taxonomy ${(b / 1e6).toFixed(2)} MB\n`,
  );
}

await main();
