/**
 * The machine icons, fetched and turned into one module. **Generated.**
 *
 *   node tools/machines/fetch.mjs
 *
 * Eight of the thirteen machines wear a drawn icon rather than a silhouette,
 * because eight shapes that all mean "a thing that is coming for you" are
 * eight shapes to tell apart and a face is one to recognise. They come from
 * game-icons.net under **CC BY 3.0**, which is attribution and nothing else —
 * the notice is in `assets/CREDITS.md` and on the game's own credits sheet.
 *
 * What is kept is the path and the licence, not the file. Each download is a
 * black square with a white icon on it; the square is the site's background
 * and goes, and the icon is re-drawn in `currentColor` so a machine is
 * whatever colour the board says it is that frame. Same reason the pixel
 * tileset is `<rect>`s and not a PNG (`src/tiles/sprites.ts`).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Machine glyph → who drew it and what it is called there. */
const ICONS = [
  { ch: "c", id: "scout", author: "lorc", slug: "android-mask" },
  { ch: "d", id: "feral-drone", author: "lorc", slug: "trap-mask" },
  { ch: "H", id: "hauler", author: "delapouite", slug: "soul-vessel" },
  { ch: "S", id: "security-unit", author: "delapouite", slug: "cyborg-face" },
  { ch: "x", id: "scrapper", author: "delapouite", slug: "robot-antennas" },
  { ch: "m", id: "maintenance-bot", author: "lord-berandas", slug: "artificial-intelligence" },
  { ch: "w", id: "welder-bot", author: "lorc", slug: "doctor-face" },
  { ch: "A", id: "arc-sentinel", author: "delapouite", slug: "mecha-mask" },
];

const rows = [];
for (const icon of ICONS) {
  const url = `https://game-icons.net/icons/ffffff/000000/1x1/${icon.author}/${icon.slug}.svg`;
  const svg = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${String(r.status)}`);
    return r.text();
  });
  /* Two paths: the site's black backing square first, the icon second. The
     square is not part of the drawing and would paint over the deck. */
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  const d = paths.at(-1);
  if (d === undefined || paths.length < 2) throw new Error(`${icon.slug}: unexpected svg shape`);
  rows.push({ ...icon, d });
  console.log(`${icon.id.padEnd(16)} ${String(d.length).padStart(5)} chars`);
}

const body = rows
  .map(
    (r) =>
      `  /** ${r.id} — ${r.author}/${r.slug} */\n  ${JSON.stringify(r.ch)}: ${JSON.stringify(r.d)},`,
  )
  .join("\n");

mkdirSync(join(here, "..", "..", "src", "ui", "react", "board"), { recursive: true });
writeFileSync(
  join(here, "..", "..", "src", "ui", "react", "board", "machines.ts"),
  `/**
 * What each machine looks like. **Generated — do not edit.**
 *
 *   node tools/machines/fetch.mjs
 *
 * Eight drawn icons, one per machine of the band, keyed by the letter the
 * engine already carries. The other five machines — the turret, the jammer,
 * the crawler, the bloom, the enforcer — and everything that is not a machine
 * keep the silhouettes in \`Icon.tsx\`: a face says *which one*, and a
 * silhouette says *what kind of thing*, and the board needs both.
 *
 * From game-icons.net under CC BY 3.0. The notice is in \`assets/CREDITS.md\`
 * and on the game's own credits sheet; the licence asks for attribution and
 * nothing more. Each is drawn in \`currentColor\`, so a machine is whatever
 * colour the board says it is on that frame.
 */

/** The box every one of these is drawn in. */
export const MACHINE_BOX = 512;

export const MACHINE_ICON: Readonly<Record<string, string>> = {
${body}
};
`,
);
console.log(`\n→ src/ui/react/board/machines.ts`);
