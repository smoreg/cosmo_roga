/**
 * What has to be true of a build before it is uploaded.
 *
 * itch serves an HTML5 build out of a subdirectory and, for a downloadable
 * one, straight off the filesystem — so every url the page asks for has to be
 * relative. One absolute path is a game that runs perfectly here and shows a
 * blank page there, and nothing in a test catches it, because a test never
 * loads the page.
 *
 * So this reads the build rather than the source: the assets the html points
 * at, the deck the board fetches, the music the splash waits on.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
const fail = [];
const ok = (what) => console.log(`  ok    ${what}`);

const html = readFileSync(join(dist, "index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (url.startsWith("http") || url.startsWith("data:")) continue;
  if (url.startsWith("/")) fail.push(`index.html points at an absolute path: ${url}`);
  const on = join(dist, url.replace(/^\.\//, ""));
  if (!existsSync(on)) fail.push(`index.html points at a missing file: ${url}`);
}
if (fail.length === 0) ok("every url in index.html is relative and present");

/* The deck: the board fetches the index by a relative path and then every tile
   the index names. A manifest that survived and a tile folder that did not is
   the exact shape of a build that looks right and draws flat. */
const deck = join(dist, "deck", "deck.json");
if (!existsSync(deck)) fail.push("no deck/deck.json — the board will draw flat");
else {
  const index = JSON.parse(readFileSync(deck, "utf8"));
  const missing = index.tiles.filter((t) => !existsSync(join(dist, "deck", "t", `${t.id}.webp`)));
  if (missing.length > 0) fail.push(`${missing.length} of ${index.tiles.length} deck tiles are missing`);
  else ok(`${index.tiles.length} deck tiles, all present`);
}

/* The music the splash holds the door for. */
const music = join(dist, "audio", "music");
if (!existsSync(music)) fail.push("no audio/music — the game will be silent");
else {
  const tracks = readdirSync(music).filter((f) => f.endsWith(".ogg") || f.endsWith(".mp3"));
  if (tracks.length === 0) fail.push("audio/music is empty");
  else ok(`${tracks.length} tracks`);
}

/* And the notices both sets of art are used under. */
for (const notice of [join(dist, "deck", "LICENCE.md"), join(dist, "audio", "ATTRIBUTION.md")]) {
  if (!existsSync(notice)) fail.push(`the build is missing ${notice.replace(dist, "dist")}`);
}
if (fail.length === 0) ok("both licence notices travel with the files");

const size = readdirSync(dist, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .reduce((n, e) => n + statSync(join(e.parentPath ?? e.path, e.name)).size, 0);
console.log(`  size  ${(size / 1e6).toFixed(1)} MB unpacked`);

if (fail.length > 0) {
  console.error(`\n${fail.length} problem(s) with this build:`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
