/**
 * Sanity sweep over the sandbox: every silhouette, thirty seeds.
 *
 * Not a vitest file on purpose — nothing here may join the repo's test run
 * (`npm test` is other people's, and this folder is scratch). Run it by hand:
 *
 *     node experiments/hullforms/check.mjs
 */

import { SILHOUETTES } from "./silhouettes.mjs";
import { faults, generateDeck, MAX_DOORS } from "./generate.mjs";

const SEEDS = 30;
const rows = [];
let broken = 0;

for (const sil of SILHOUETTES) {
  const stat = { rooms: [], doors: [], deep: [], wide: [], over: 0, loops: [] };
  for (let seed = 1; seed <= SEEDS; seed++) {
    const deck = generateDeck(sil, seed);
    const bad = faults(deck);
    if (bad.length > 0) {
      broken++;
      console.log(`FAIL ${sil.id} seed ${seed}: ${bad.join("; ")}`);
    }
    // Determinism: the same pair must give the same deck, byte for byte.
    if (digest(deck) !== digest(generateDeck(sil, seed))) {
      broken++;
      console.log(`FAIL ${sil.id} seed ${seed}: not deterministic`);
    }
    const m = deck.metrics;
    stat.rooms.push(m.rooms);
    stat.doors.push(m.doorCount);
    stat.deep.push(m.maxDepth);
    stat.wide.push(m.widestDepth);
    stat.loops.push(m.loops);
    if (m.overDoorCap > 0) stat.over++;
  }
  rows.push({ id: sil.id, ...stat });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  `\n${pad("silhouette", 18)} ${pad("cells", 6)} ${pad("rooms", 9)} ${pad("doors", 9)} ${pad("loops", 8)} ${pad("depth", 8)} ${pad("widest", 8)} over4`,
);
for (const row of rows) {
  const sil = SILHOUETTES.find((s) => s.id === row.id);
  const cells = generateDeck(sil, 1).metrics.cells;
  console.log(
    `${pad(row.id, 18)} ${pad(cells, 6)} ${pad(range(row.rooms), 9)} ${pad(range(row.doors), 9)} ` +
      `${pad(range(row.loops), 8)} ${pad(range(row.deep), 8)} ${pad(range(row.wide), 8)} ${row.over}`,
  );
}
console.log(`\n${broken === 0 ? "все проверки прошли" : `${broken} провалов`}; предел дверей ${MAX_DOORS}`);

function range(xs) {
  return `${Math.min(...xs)}-${Math.max(...xs)}`;
}

function digest(deck) {
  return JSON.stringify({
    comps: deck.compartments.map((c) => c.cells.map((x) => `${x.q},${x.r}`).sort()),
    doors: deck.doors.map((d) => `${d.a}-${d.b}@${d.wall.cell.q},${d.wall.cell.r},${d.wall.dir}`),
  });
}
