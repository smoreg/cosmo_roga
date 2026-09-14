/**
 * Does the other half accept what `roomgen.html` makes?
 *
 * The page validates its own output, but a page checking its own homework is
 * not evidence. This runs the exported `ShipData` through SALVOR's real
 * `Ship.rehydrate` and its real `validateShip`, against a spec built from that
 * game's own compartment table — so "usable in smoreg's game" is a result
 * rather than a claim. Nothing in that half is modified to run it.
 */
import { Ship } from "../../../smoreg_works/packages/engine/src/rooms/graph.js";
import { validateShip } from "../../../smoreg_works/packages/engine/src/rooms/gen/validate.js";
import { layoutShip } from "../../../smoreg_works/packages/engine/src/rooms/gen/layout.js";
import { hexOf } from "../../../smoreg_works/packages/engine/src/rooms/gen/hexlayout.js";
import { ZONE_KINDS, ENTRY_KIND } from "../../../smoreg_works/games/salvor/src/content/zones.js";
import type { ShipSpec } from "../../../smoreg_works/packages/engine/src/rooms/types.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? ".";
const spec: ShipSpec = {
  rooms: [8, 40],
  maxDepth: 12,
  kinds: ZONE_KINDS,
  entryKind: ENTRY_KIND,
  doors: { open: 4, closed: 3, locked: 1, sealed: 1, broken: 1 },
  hex: true,
};

let bad = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  let ship: Ship;
  try {
    ship = Ship.rehydrate(data);
  } catch (problem) {
    console.log(`${file}: REHYDRATE FAILED — ${String(problem)}`);
    bad++;
    continue;
  }
  /* `col`/`row` are the terminal schematic, not the honeycomb, and they have
     their own rules — column is depth, a door spans one column, no side takes
     two doors leaving the same way. That is a whole layout algorithm and it is
     already written, so the page does not carry a second copy of it: it emits
     the graph and the lattice cells, and this runs the game's own pass, which
     is exactly what that generator does after building a hull. */
  layoutShip(ship);
  const problems = validateShip(ship, spec);
  const celled = ship.rooms.filter((room) => hexOf(room) !== undefined).length;
  const line = `${file.padEnd(26)} ${String(ship.size).padStart(3)} rooms  ${String(ship.doors.length).padStart(3)} doors  ${String(celled).padStart(3)}/${ship.size} celled`;
  if (problems.length === 0) console.log(`${line}  clean`);
  else {
    bad++;
    console.log(`${line}  ${problems.map((p) => `${p.code}: ${p.detail}`).join(" | ")}`);
  }
}
console.log(bad === 0 ? "\nAll ships pass SALVOR's own validator." : `\n${String(bad)} ship(s) refused.`);
