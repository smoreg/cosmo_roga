/**
 * Contact sheet: silhouettes on one SVG, so the shapes can be judged by eye
 * instead of by metric.
 *
 *     node experiments/hullforms/preview.mjs [seed] [grid|plan|art] [ids] > sheet.svg
 *     rsvg-convert sheet.svg -o sheet.png
 *
 * `grid` is the lattice drawing, `plan` the thin deck plan, `art` the drawn
 * ship. `ids` is an optional comma-separated list of silhouettes — `art` is
 * worth looking at a few at a time and large.
 */

import { SILHOUETTES } from "./silhouettes.mjs";
import { generateDeck } from "./generate.mjs";
import { renderDeck, PALETTE } from "./render.mjs";
import { renderBlueprint } from "./blueprint.mjs";
import { renderHullArt } from "./hullart.mjs";

const seed = Number(process.argv[2] ?? 1);
const mode = process.argv[3] ?? "grid";
const only = process.argv[4] ? new Set(process.argv[4].split(",")) : undefined;

const shown = SILHOUETTES.filter((sil) => only === undefined || only.has(sil.id));
const art = mode === "art";
const COLS = art ? 1 : 4;
const W = art ? 920 : 460;
const H = art ? 430 : 320;
const rows = Math.ceil(shown.length / COLS);

const out = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * W}" height="${rows * H}" ` +
    `viewBox="0 0 ${COLS * W} ${rows * H}">`,
  `<rect width="100%" height="100%" fill="${PALETTE.bg}" />`,
];

shown.forEach((sil, i) => {
  const x = (i % COLS) * W;
  const y = Math.floor(i / COLS) * H;
  const deck = generateDeck(sil, seed);
  const uid = `${sil.id}-${seed}`;
  const drawn = art
    ? renderHullArt(deck, { uid })
    : mode === "plan"
      ? renderBlueprint(deck, { uid })
      : renderDeck(deck, { title: sil.name });
  out.push(drawn.replace("<svg ", `<svg x="${x + 14}" y="${y + 34}" width="${W - 28}" height="${H - 58}" `));
  out.push(
    `<text x="${x + 16}" y="${y + 24}" fill="${PALETTE.text}" font-family="sans-serif" font-size="15">` +
      `${sil.name} · seed ${seed} · ${deck.metrics.rooms} отсеков · ${deck.metrics.doorCount} дверей</text>`,
  );
});

out.push("</svg>");
process.stdout.write(out.join("\n"));
