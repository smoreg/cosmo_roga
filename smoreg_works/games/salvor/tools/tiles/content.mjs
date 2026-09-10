import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The game's own tables, read out of the TypeScript sources.
 *
 * A tool cannot import `src/content/*.ts`, and the alternative — typing the
 * palette and thirteen machine colours out again here — is the defect this
 * whole file exists to avoid: two copies of a colour drift, and the atlas is
 * the copy nobody looks at. So the tables are parsed as text, every lookup
 * throws when it finds nothing, and `tests/tiles.test.ts` imports the real
 * modules and compares them against the generated `salvor.json`. A regex that
 * quietly stops matching therefore fails the suite rather than shipping a tile
 * painted in last month's amber.
 *
 * Only flat, literal rows are read: `PALETTE`, `ch`/`fg` off the machine table,
 * the `ModuleId` union, the compartment catalogue and three entity colours.
 * Nothing here evaluates anything.
 */

const src = (path) => readFileSync(fileURLToPath(new URL(`../../src/${path}`, import.meta.url)), "utf8");

function must(value, what) {
  if (value === undefined || value === null) throw new Error(`tiles: ${what} not found in the game's sources`);
  return value;
}

// --------------------------------------------------------------- palette

/**
 * Every hex in `content/palette.ts`, by the key it is written under — the door
 * states included, because their names (`open`, `locked`, …) collide with
 * nothing above them.
 */
export function palette() {
  const text = src("content/palette.ts");
  const out = {};
  for (const [, key, hex] of text.matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)) out[key] = hex;
  if (Object.keys(out).length < 20) throw new Error("tiles: palette.ts parsed to fewer colours than it has");
  return out;
}

// -------------------------------------------------------------- machines

/**
 * Every machine that can stand in a compartment: the catalogue plus the
 * ENFORCER, which no roll produces and the alert still sends.
 */
export function machines() {
  const text = src("content/monsters.ts");
  const rows = new Map();
  // Every machine is one line of fields, so the line that names it also carries
  // its `behaviour` — which is the one thing about a machine a tile can say
  // that a letter never could (docs/tiles-design.md, "class and role before
  // identity"). It is read here and passed through, not interpreted: what a
  // view does with "hunter" is the view's.
  for (const line of text.split("\n")) {
    const found = /id: "([\w-]+)", name: "([^"]+)", ch: "(.)", fg: "(#[0-9a-fA-F]{6})"/.exec(line);
    if (!found) continue;
    const [, id, name, ch, fg] = found;
    rows.set(id, { id, name, ch, fg, behaviour: must(/behaviour: "(\w+)"/.exec(line), `a behaviour for machine ${id}`)[1] });
  }
  if (rows.size < 13) throw new Error(`tiles: monsters.ts parsed to ${rows.size} machines, expected 13`);

  // In the catalogue's own order — the eight a depth band rolls, then the four
  // a hull class brings, then the one only the alert sends. The four weightless
  // machines are declared above the table, so file order is not table order.
  const table = must(/export const MONSTERS: Machine\[\] = \[([\s\S]*?)\n\];/.exec(text), "the MONSTERS table")[1];
  const order = [];
  for (const line of table.split("\n")) {
    const inline = /id: "([\w-]+)"/.exec(line);
    const constant = /^\s*([A-Z][A-Z_]*),\s*$/.exec(line);
    if (inline) order.push(inline[1]);
    else if (constant) order.push(constantId(text, constant[1]));
  }
  order.push("enforcer");

  return order.map((id) => must(rows.get(id), `a row for machine ${id}`));
}

/** The id a `const NAME: Machine = { id: "…" }` declares. */
function constantId(text, constant) {
  const found = new RegExp(`export const ${constant}: Machine = \\{\\s*id: "([\\w-]+)"`).exec(text);
  return found ? found[1] : undefined;
}

// --------------------------------------------------------------- modules

/** The module catalogue: id, display name and whether it is a relic. */
export function modules() {
  const text = src("content/modules.ts");
  const table = must(/export const MODULES[^{]*\{([\s\S]*?)\n\};/.exec(text), "the MODULES table")[1];
  const out = [];
  for (const [, id, body] of table.matchAll(/^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},$/gm)) {
    out.push({
      id,
      name: must(/name: "([^"]+)"/.exec(body), `a name for module ${id}`)[1],
      relic: /relic: true/.test(body),
    });
  }
  if (out.length !== 14) throw new Error(`tiles: modules.ts parsed to ${out.length} modules, expected 14`);
  return out;
}

// ---------------------------------------------------------------- zones

/** The compartment catalogue, in the order `ZONE_KINDS` lists it. */
export function zones() {
  const text = src("content/zones.ts");
  const entry = must(/export const ENTRY_KIND = "(\w+)"/.exec(text), "ENTRY_KIND")[1];
  const specs = new Map();
  for (const [, kind, name] of text.matchAll(/kind: (?:ENTRY_KIND|"(\w+)"), name: "([^"]+)"/g)) {
    specs.set(kind ?? entry, name);
  }
  const order = must(/export const ZONE_KINDS[^=]*=\s*\[([\s\S]*?)\];/.exec(text), "the ZONE_KINDS list")[1];
  const names = [...order.matchAll(/\b([A-Z][A-Z_]*)\b/g)].map(([, constant]) => constant);
  const byConstant = new Map();
  for (const [, constant, kind] of text.matchAll(/const ([A-Z][A-Z_]*): RoomKindSpec = \{ kind: (?:ENTRY_KIND|"(\w+)")/g)) {
    byConstant.set(constant, kind ?? entry);
  }
  const out = names
    .filter((constant) => byConstant.has(constant))
    .map((constant) => {
      const kind = byConstant.get(constant);
      return { kind, name: must(specs.get(kind), `a name for compartment ${kind}`) };
    });
  if (out.length < 20) throw new Error(`tiles: zones.ts parsed to ${out.length} compartments, expected at least 20`);
  return out;
}

// ---------------------------------------------------------------- actors

/** The drone, the ghost of a dead one and the rival's — three files, three colours. */
export function actors() {
  const player = must(/ch: "@",\s*\n\s*fg: "(#[0-9a-fA-F]{6})"/.exec(src("content/player.ts")), "the drone's colour")[1];
  const ghost = must(/const GHOST_FG = "(#[0-9a-fA-F]{6})"/.exec(src("systems/ghost.ts")), "the ghost's colour")[1];
  const rival = must(
    /ch: "r",[\s\S]{0,400}?fg: "(#[0-9a-fA-F]{6})"/.exec(src("systems/rival.ts")),
    "the rival drone's colour",
  )[1];
  return [
    { id: "drone", name: "drone", ch: "@", fg: player },
    { id: "ghost", name: "ghost", ch: "G", fg: ghost },
    { id: "rival-drone", name: "rival drone", ch: "r", fg: rival },
  ];
}

// ----------------------------------------------------------------- doors

/** The six door states, read off the union the engine declares. */
export function doorStates() {
  const text = readFileSync(
    fileURLToPath(new URL("../../../../packages/engine/src/rooms/graph.ts", import.meta.url)),
    "utf8",
  );
  const union = must(/export type DoorState =([^;]+);/.exec(text), "the DoorState union")[1];
  const out = [...union.matchAll(/"(\w+)"/g)].map(([, state]) => state);
  if (out.length !== 6) throw new Error(`tiles: graph.ts parsed to ${out.length} door states, expected 6`);
  return out;
}

// --------------------------------------------------------------- hazards

/**
 * The hazards a hull can carry, off the game's own table.
 *
 * Read rather than repeated for the reason everything else here is: a hazard
 * added to `content/hazards.ts` with no drawing must fail the build, and a
 * glyph changed there must not leave a tile answering to the old character.
 * `docs/tasks/G83-anonymous-blows.md` put the marks on the map; the tiles
 * follow the marks, not a copy of them.
 */
export function hazards() {
  const text = src("content/hazards.ts");
  const table = must(/export const HAZARDS: Record<HazardId, HazardKind> = \{([\s\S]*?)^\};/m.exec(text), "the HAZARDS table")[1];
  const out = [];
  for (const [, id, glyph] of table.matchAll(/id: "(\w+)", level: \d+, on: "\w+", glyph: "([^"]+)"/g)) {
    out.push({ id, glyph });
  }
  if (out.length === 0) throw new Error("tiles: hazards.ts parsed to no hazards");
  return out;
}
