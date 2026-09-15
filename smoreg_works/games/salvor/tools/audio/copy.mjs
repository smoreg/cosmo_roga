/**
 * The music, brought over from the other half of the project.
 *
 *   node tools/audio/copy.mjs [path to vuvko_works]
 *
 * Six tracks and twenty-three megabytes. They are already committed once in
 * this repository, under `vuvko_works/game/public/audio/music`, so a second
 * copy here would be the same twenty-three megabytes in the same repository
 * twice. What is committed is this script; what it writes is gitignored, the
 * same arrangement the deck art has.
 *
 * A tree without them builds and runs: the splash counts the music step done
 * on an error as readily as on a load, and a silent game is a game.
 *
 * ## Licences
 *
 * Five are Eric Matyas's, from soundimage.org, and his terms ask for a credit
 * wherever the game appears — it is on the credits sheet and in
 * `public/audio/ATTRIBUTION.md`, which travels with the files into the build.
 * **His terms have changed over the years: re-read them before any release.**
 *
 * The sixth is 3D63's "Soft Millenium", used by the artist's own permission for
 * this game, on the same condition. That file records what is still owed to it:
 * a verbatim copy of the grant, with its medium and its date.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const salvor = join(here, "..", "..");
const source = process.argv[2] ?? join(salvor, "..", "..", "..", "vuvko_works");
const from = join(source, "game", "public", "audio");

if (!existsSync(join(from, "music"))) {
  console.error(`no music at ${join(from, "music")}\nusage: node tools/audio/copy.mjs [path to vuvko_works]`);
  process.exit(1);
}

const to = join(salvor, "public", "audio");
mkdirSync(join(to, "music"), { recursive: true });

let bytes = 0;
let n = 0;
for (const name of readdirSync(join(from, "music"))) {
  if (!/\.(ogg|mp3)$/.test(name)) continue;
  copyFileSync(join(from, "music", name), join(to, "music", name));
  bytes += statSync(join(to, "music", name)).size;
  n++;
}

/* The notice travels with the files, always. A build that carried the music
   and left this behind would be using both licences and answering for neither. */
copyFileSync(join(from, "ATTRIBUTION.md"), join(to, "ATTRIBUTION.md"));

console.log(`${String(n)} tracks, ${(bytes / 1e6).toFixed(1)} MB → public/audio/`);
