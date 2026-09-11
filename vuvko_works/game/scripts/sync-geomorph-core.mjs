#!/usr/bin/env node
/**
 * Vendors `vuvko_works/geomorph-core.js` into the game.
 *
 * The hull generator is 1100 lines of someone's working code that already has
 * no DOM in it. Porting it would mean maintaining a second copy of an
 * algorithm that is still being changed next door; copying it under a script
 * means the copy can be refreshed with one command and a diff will show what
 * moved.
 *
 * The file is a classic script — it declares things at module scope and
 * exports nothing — so a small shim is appended that hands out the three
 * things the game needs. Nothing above the shim is edited.
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "..", "geomorph-core.js");
const target = join(root, "src/vendor/geomorph-core.js");

const SHIM = `
/* ---------------------------------------------------------------------------
   Appended by scripts/sync-geomorph-core.mjs. Everything above is verbatim.

   The page feeds this module by fetching the manifest and the taxonomy; the
   game already has both as imported JSON, so it hands them over directly.
   --------------------------------------------------------------------------- */

export function setLibrary(tiles, taxonomy) {
  LIB = tiles.map((tile) => {
    const entry = Object.assign({}, tile);
    entry.base = entry.base || "geomorphs/";
    entry.tag = entry.tag || "";
    entry.tons = entry.tons || 0;
    entry.search = (entry.label + " " + entry.path).toLowerCase();
    return entry;
  });
  TAX = taxonomy;
  let matched = 0;
  for (const tile of LIB) {
    if (TAX && TAX[tile.path]) { tile.tax = TAX[tile.path]; matched++; }
  }
  return { tiles: LIB.length, classified: matched };
}

export { buildPools, layout, parseProfile };
`;

async function main() {
  const text = await readFile(source, "utf8");
  await copyFile(source, target).catch(async function write() {
    await writeFile(target, text);
  });
  await writeFile(target, text + SHIM);

  const stamp = join(dirname(target), "SOURCE.md");
  await writeFile(
    stamp,
    [
      "# Vendored",
      "",
      "`geomorph-core.js` is a copy of `vuvko_works/geomorph-core.js`, taken by",
      "`scripts/sync-geomorph-core.mjs`, with an export shim appended at the end.",
      "",
      "**Do not edit it here.** Change the original and run:",
      "",
      "```",
      "npm run sync:core",
      "```",
      "",
      `Last synced from a file of ${String(text.split("\n").length)} lines.`,
      "",
    ].join("\n"),
  );
  process.stdout.write(
    `vendored ${String(text.split("\n").length)} lines -> src/vendor/geomorph-core.js\n`,
  );
}

await main();
