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

/**
 * The drone's own hulls. Five, rolled per drone rather than per class, so two
 * sorties in the same hull are not the same machine — a drone is built for a
 * sortie and lost on it, and the rack is what carries over.
 */
const DRONES = [
  { id: "tracked", author: "delapouite", slug: "tracked-robot" },
  { id: "spider", author: "delapouite", slug: "spider-bot" },
  { id: "curiosity", author: "delapouite", slug: "mars-curiosity" },
  { id: "monowheel", author: "delapouite", slug: "mono-wheel-robot" },
  { id: "mech", author: "delapouite", slug: "battle-mech" },
];

/**
 * One icon, as a path.
 *
 * Two paths come back: the site's black backing square first, the drawing
 * second. The square is not part of the icon and would paint over whatever is
 * under it, so only the last one is kept.
 */
async function pathOf(icon) {
  const url = `https://game-icons.net/icons/ffffff/000000/1x1/${icon.author}/${icon.slug}.svg`;
  const svg = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${String(r.status)}`);
    return r.text();
  });
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  const d = paths.at(-1);
  if (d === undefined || paths.length < 2) throw new Error(`${icon.slug}: unexpected svg shape`);
  return d;
}

/**
 * Salvage. Seven, rolled per pile, because a pile of scrap is a pile of scrap
 * and what is *in* it is what the line beside it says — a shape that promised
 * to name the module would be promising fourteen things with seven drawings.
 */
const LOOT = [
  { id: "arm", author: "lorc", slug: "mechanical-arm" },
  { id: "gear", author: "darkzaitzev", slug: "big-gear" },
  { id: "chip", author: "lorc", slug: "microchip" },
  { id: "disc", author: "delapouite", slug: "compact-disc" },
  { id: "cpu", author: "delapouite", slug: "cpu" },
  { id: "led", author: "delapouite", slug: "led" },
  { id: "cannister", author: "lorc", slug: "cannister" },
];

/** The ones that are always themselves: a crate is a crate, a rack is a rack. */
const FIXED = [
  { id: "crate", author: "delapouite", slug: "wooden-crate" },
  { id: "system", author: "delapouite", slug: "server-rack" },
];

/** The mark on the tab. */
const MARK = { id: "mark", author: "lorc", slug: "metal-scales" };

const rows = [];
const drones = [];
const loot = [];
const fixed = {};
for (const icon of ICONS) {
  const d = await pathOf(icon);
  rows.push({ ...icon, d });
  console.log(`${icon.id.padEnd(16)} ${String(d.length).padStart(5)} chars`);
}
for (const icon of DRONES) {
  const d = await pathOf(icon);
  drones.push({ ...icon, d });
  console.log(`${icon.id.padEnd(16)} ${String(d.length).padStart(5)} chars  · drone`);
}

for (const icon of LOOT) {
  const d = await pathOf(icon);
  loot.push({ ...icon, d });
  console.log(`${icon.id.padEnd(16)} ${String(d.length).padStart(5)} chars  · loot`);
}
for (const icon of FIXED) {
  fixed[icon.id] = { ...icon, d: await pathOf(icon) };
  console.log(`${icon.id.padEnd(16)} ${String(fixed[icon.id].d.length).padStart(5)} chars  · fixed`);
}

/* The favicon is written straight out rather than imported: it is one file the
   page links, not something the bundle ever sees. Amber on the same near-black
   the interface is grounded in, with the corner the panels have. */
const mark = await pathOf(MARK);
writeFileSync(
  join(here, "..", "..", "public", "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <title>Derelict Rogue</title>
  <rect width="512" height="512" rx="80" fill="#0a0d10"/>
  <path d="${mark}" fill="#e0a458"/>
</svg>
`,
);
console.log(`${"favicon".padEnd(16)} ${String(mark.length).padStart(5)} chars  → public/favicon.svg`);

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

/**
 * The drone's own, rolled per drone rather than per class.
 *
 * A drone is built for a sortie and lost on it, and what carries over is the
 * rack — so two sorties in a SPARK are two machines, and looking different is
 * the cheapest way of saying so. Which one a drone gets is decided from its
 * own identity and never from a roll, so it does not change under the player
 * between one frame and the next (\`Icon.tsx\`, \`droneIcon\`).
 */
export const DRONE_ICON: readonly string[] = [
${drones.map((r) => `  /** ${r.author}/${r.slug} */\n  ${JSON.stringify(r.d)},`).join("\n")}
];

/**
 * Salvage, rolled per pile.
 *
 * A pile of scrap is a pile of scrap; what is in it is what the line beside it
 * says. Seven drawings cannot name fourteen modules and should not pretend to,
 * so these vary to be told apart and nothing more.
 */
export const LOOT_ICON: readonly string[] = [
${loot.map((r) => `  /** ${r.author}/${r.slug} */\n  ${JSON.stringify(r.d)},`).join("\n")}
];

/** A crate is a crate and a system is a rack, wherever either of them stands. */
export const CRATE_ICON = ${JSON.stringify(fixed.crate.d)};
export const SYSTEM_ICON = ${JSON.stringify(fixed.system.d)};
`,
);
console.log(`\n→ src/ui/react/board/machines.ts`);
