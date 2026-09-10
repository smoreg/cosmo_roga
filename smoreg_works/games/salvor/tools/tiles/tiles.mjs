import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { encodePng } from "./png.mjs";
import { symbolOf } from "./svg.mjs";
import { actors, doorStates, hazards, machines, modules, palette, zones } from "./content.mjs";
import { ACTORS, DOORS, GRID, HAZARDS, MACHINES, MODULES, OVERLAYS, THINGS, ZONES, ZONES_16, ZONE_GRID } from "./sprites.mjs";

/**
 * Builds the tileset in the two forms it is wanted in.
 *
 *   node games/salvor/tools/tiles/tiles.mjs      (or: npm run tiles -w games/salvor)
 *
 * **The one the game can use** is `src/tiles/sprites.ts`: every icon as an SVG
 * `<symbol>` of unit rectangles, filled with `currentColor`, in a TypeScript
 * module. Both graphic views are SVG with a `viewBox` and land on a fractional
 * scale, where a raster sprite loses its grid; and a tile has to be recoloured
 * by what the view knows about the compartment, which CSS cannot do to a PNG.
 * A `.ts` module rather than a file beside the bundle because the build has to
 * run from a `file://` URL inside an itch zip, where `fetch` is blocked — the
 * same reason `ui/web/styles.ts` carries the stylesheet as a string.
 *
 * **The one to look at** is the pair of PNG atlases and `salvor.json`: a
 * reference sheet, painted in the colours the game's own tables declare, for
 * reading the set as a set. Nothing in `src/` imports them.
 *
 * Two sizes, two drawings. 12 is the whole set. 16 is the compartment kinds and
 * only those, drawn again rather than scaled: 16/12 is not whole, so a stretch
 * doubles one column of a symmetrical icon and leaves the rest, and a 12
 * centred in 16 throws away the four pixels that are the reason for the size.
 *
 * Deterministic: masks are data, colours are read out of the game's tables, and
 * `deflate` gets the same bytes, so a second run leaves the tree clean.
 */

const OUT_DIR = fileURLToPath(new URL("../../assets/tiles/", import.meta.url));
const TS_OUT = fileURLToPath(new URL("../../src/tiles/sprites.ts", import.meta.url));
const COLUMNS = 8;

// ------------------------------------------------------------------ colours

const PALETTE = palette();

function rgb(hex) {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

// -------------------------------------------------------------- the catalogue

function must(value, what) {
  if (value === undefined) throw new Error(`tiles: no ${what}`);
  return value;
}

/**
 * Every tile the set has, in the order the atlas lays them out.
 *
 * `glyph` is the character the game draws today, and it is what lets a view
 * swap one for the other without a table of its own: it looks the glyph up,
 * finds the symbol, uses it. A tile with no glyph is one the terminal view
 * never had a character for — a compartment's kind, a door's state, a module on
 * the rack — and those are the ones a tiled view can say something new with.
 *
 * `colour` is the atlas's business only. The symbols carry none.
 */
function catalogue() {
  const tiles = [];
  const add = (name, group, label, mask, colour, glyph, mask16, role) =>
    tiles.push({ name, group, label, mask, colour, glyph: glyph ?? null, mask16, role });

  for (const machine of machines()) {
    add(
      `machine.${machine.id}`,
      "machine",
      machine.name,
      must(MACHINES[machine.id], `sprite for machine ${machine.id}`),
      machine.fg,
      machine.ch,
      undefined,
      machine.behaviour,
    );
  }

  for (const actor of actors()) {
    add(`actor.${actor.id}`, "actor", actor.name, must(ACTORS[actor.id], `sprite for actor ${actor.id}`), actor.fg, actor.ch);
  }

  for (const module of modules()) {
    add(
      `module.${module.id}`,
      module.relic ? "relic" : "module",
      module.name,
      must(MODULES[module.id], `sprite for module ${module.id}`),
      module.relic ? PALETTE.bright : PALETTE.fg,
      null,
    );
  }

  const things = [
    ["crate", "ящик", PALETTE.fg, "X"],
    ["scrap", "лом", PALETTE.soft, "%"],
    ["body", "тело", PALETTE.soft, "†"],
    ["keycard", "ключ-карта", PALETTE.fg, null],
    ["vented", "вентилированный отсек", PALETTE.bad, "~"],
    ["system", "система корабля", PALETTE.warn, "+"],
    ["system-online", "система поднята", PALETTE.good, "✓"],
    ["cover", "укрытие", PALETTE.zone, null],
  ];
  for (const [id, label, colour, glyph] of things) {
    add(`thing.${id}`, "thing", label, must(THINGS[id], `sprite for thing ${id}`), colour, glyph);
  }

  for (const state of doorStates()) {
    add(`door.${state}`, "door", state, must(DOORS[state], `sprite for door ${state}`), must(PALETTE[state], `palette colour for door ${state}`), null);
  }

  // The one family with a second drawing: a compartment's kind is read inside
  // its own box, where there is room for sixteen pixels of it.
  for (const zone of zones()) {
    add(
      `zone.${zone.kind}`,
      "zone",
      zone.name,
      must(ZONES[zone.kind], `sprite for compartment ${zone.kind}`),
      PALETTE.zone,
      null,
      must(ZONES_16[zone.kind], `16-grid sprite for compartment ${zone.kind}`),
    );
  }

  // The hazards, in the table's own order and answering to the table's own
  // glyphs: a hazard the game knows and the set does not is a build failure
  // rather than a letter that quietly never became a picture.
  for (const hazard of hazards()) {
    add(
      `hazard.${hazard.id}`,
      "hazard",
      hazard.id,
      must(HAZARDS[hazard.id], `sprite for hazard ${hazard.id}`),
      PALETTE.bad,
      hazard.glyph,
    );
  }

  const overlays = [
    ["damaged", "повреждён", PALETTE.warn, null],
    ["infected", "заражён", PALETTE.bad, "!"],
    ["exposed", "открытый слот", PALETTE.accent, "◀"],
  ];
  for (const [id, label, colour, glyph] of overlays) {
    add(`overlay.${id}`, "overlay", label, must(OVERLAYS[id], `sprite for overlay ${id}`), colour, glyph);
  }

  return tiles;
}

// ----------------------------------------------------------------- checking

/** A mask is square, it is ink and holes only, and it has to draw something. */
function checkMask(name, mask, size) {
  if (mask.length !== size) throw new Error(`tiles: ${name} has ${mask.length} rows, expected ${size}`);
  let ink = 0;
  for (const row of mask) {
    if (row.length !== size) throw new Error(`tiles: ${name} has a row of ${row.length}, expected ${size}`);
    for (const cell of row) {
      // Two states and no third. A shade is invisible at this size and colour
      // belongs to the view — docs/gui-guides.md, §6.2 and §6.4.
      if (cell !== "#" && cell !== ".") throw new Error(`tiles: ${name} uses '${cell}'; a mask is '#' and '.'`);
      if (cell === "#") ink += 1;
    }
  }
  if (ink < 9) throw new Error(`tiles: ${name} is ${ink} pixels — that is not an icon`);
}

// ----------------------------------------------------------------- the atlas

/** One reference atlas: the tiles laid left to right, `COLUMNS` to a row. */
function atlas(tiles, size, maskOf) {
  const drawn = tiles.filter((tile) => maskOf(tile) !== undefined);
  const rows = Math.ceil(drawn.length / COLUMNS);
  const width = COLUMNS * size;
  const height = rows * size;
  const pixels = Buffer.alloc(width * height * 4);

  const rects = new Map();
  drawn.forEach((tile, i) => {
    const ox = (i % COLUMNS) * size;
    const oy = Math.floor(i / COLUMNS) * size;
    rects.set(tile.name, { x: ox, y: oy, w: size, h: size });

    const [r, g, b] = rgb(tile.colour);
    const mask = maskOf(tile);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (mask[y][x] !== "#") continue;
        const at = ((oy + y) * width + ox + x) * 4;
        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
        pixels[at + 3] = 255;
      }
    }
  });

  return { width, height, rows, count: drawn.length, png: encodePng(width, height, pixels), rects };
}

// ------------------------------------------------------- the module the game uses

/**
 * The SVG id a tile takes. Overlays get `ov-` of their own, because they are a
 * second layer over a tile and never one of the set; the 16-grid compartments
 * get `z16-`, because they are a different drawing of the same name.
 */
function idOf(name) {
  if (name.startsWith("overlay.")) return `ov-${name.slice("overlay.".length)}`;
  return `tile-${name.replace(/\./g, "-")}`;
}

const zoneIdOf = (name) => `z16-${name.slice("zone.".length)}`;

function tsModule(tiles) {
  const symbols = tiles.map((tile) => symbolOf(idOf(tile.name), tile.mask));
  const zoneSymbols = tiles.filter((tile) => tile.mask16).map((tile) => symbolOf(zoneIdOf(tile.name), tile.mask16));

  const names = tiles.map((tile) => `  | "${tile.name}"`).join("\n");
  const ids = tiles.map((tile) => `  "${tile.name}": "${idOf(tile.name)}",`).join("\n");
  const zoneIds = tiles
    .filter((tile) => tile.mask16)
    .map((tile) => `  "${tile.name}": "${zoneIdOf(tile.name)}",`)
    .join("\n");
  const roles = tiles
    .filter((tile) => tile.role !== undefined)
    .map((tile) => `  "${tile.name}": "${tile.role}",`)
    .join("\n");
  const byGlyph = tiles
    .filter((tile) => tile.glyph !== null)
    .map((tile) => `  ${JSON.stringify(tile.glyph)}: "${tile.name}",`)
    .join("\n");

  return `/**
 * The pixel tileset, as SVG symbols. **Generated — do not edit.**
 *
 *   npm run tiles -w games/salvor
 *
 * Shapes live in \`games/salvor/tools/tiles/sprites.mjs\` as twelve-by-twelve
 * masks of '#' and '.'; this file is what the generator makes of them. Every
 * symbol is unit \`<rect>\`s filled with \`currentColor\` and carries no colour of
 * its own, so the view paints a tile with whatever the compartment's state is
 * worth and a fractional scale costs nothing — which a PNG could not do on
 * either count.
 *
 * It is a module rather than a file beside the bundle because the build has to
 * run from a \`file://\` URL inside an itch zip, where \`fetch\` is blocked. Same
 * reason \`ui/web/styles.ts\` carries the stylesheet as a string.
 *
 * Drop \`TILE_DEFS\` into an \`<svg>\` once, then reference a tile by id:
 *
 *     \`<use href="#\${TILE_IDS["machine.scout"]}" x="0" y="0" width="12" height="12"/>\`
 *
 * Nothing here decides anything. Which tile is drawn where, at what size and in
 * what colour is the view's, and a glyph with no tile is drawn as the letter it
 * always was — the mark vocabulary is open at the bottom (\`content/cards.ts\`
 * takes any \`marks\` entry), so there is deliberately no placeholder tile.
 */

/** The grid the whole set is drawn on. */
export const TILE_GRID = 12;

/** The grid the compartment kinds have a second, separate drawing on. */
export const ZONE_GRID = ${ZONE_GRID};

export type TileName =
${names};

/** Every symbol in the set, ready to go inside one \`<svg><defs>\`. */
export const TILE_DEFS = ${JSON.stringify(symbols.join(""))};

/** The compartment kinds again at ${ZONE_GRID}, for the box on the schematic. */
export const ZONE_DEFS = ${JSON.stringify(zoneSymbols.join(""))};

/** The id each tile's symbol takes. Never build one of these by hand. */
export const TILE_IDS: Readonly<Record<TileName, string>> = {
${ids}
};

/** The same for the ${ZONE_GRID}-grid compartments. */
export const ZONE_IDS: Readonly<Record<string, string>> = {
${zoneIds}
};

/**
 * The character the terminal view draws, to the tile that replaces it. A glyph
 * missing from here has no tile and stays a letter.
 */
export const TILE_BY_GLYPH: Readonly<Record<string, TileName>> = {
${byGlyph}
};

/**
 * What each machine does, straight off its row in \`content/monsters.ts\`.
 *
 * A tile can say this and a letter cannot, which is most of the argument for
 * having tiles at all: thirteen letters are thirteen things to memorise, while
 * "it stands still and shoots" is a shape. Whether the view groups by it, tints
 * by it or ignores it is the view's business — this is the table, not a policy.
 */
export const MACHINE_ROLES: Readonly<Record<string, string>> = {
${roles}
};

/** Every tile, in the order the set is laid out. */
export const TILE_NAMES: readonly TileName[] = Object.keys(TILE_IDS) as TileName[];
`;
}

// ------------------------------------------------------------ contact sheet

const GROUPS = [
  ["machine", "Машины", "Цвет — поле <code>fg</code> из <code>content/monsters.ts</code>, и он живёт только здесь, на листе. Сам тайл цвета не носит."],
  ["actor", "Дрон и те, кто носит его силуэт", "Призрак — это контур дрона с вынутой серединой: он и есть мёртвый дрон."],
  ["module", "Модули", "Инструменты рига. Иконка — глагол модуля, а не коробка с буквой."],
  ["relic", "Реликвии", "Общий знак 2×2 в углу — блок, а не янтарь: цвет в арте запрещён, реликвию отличает форма."],
  ["thing", "Что лежит в отсеке", ""],
  ["door", "Двери", "Одна коробка, шесть створок."],
  ["zone", "Виды отсеков", "Единственная группа с двумя рисунками: 12 для схемы в тесноте, 16 — заново нарисованный, для бокса отсека."],
  ["overlay", "Оверлеи", "Не тайлы, а второй слой поверх тайла, с собственным префиксом <code>ov-</code>."],
];

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function contactSheet(tiles, big, small) {
  const atlases = [
    ["12", small],
    ["16", big],
  ];
  const backgrounds = atlases
    .map(
      ([size, built]) => `--atlas-${size}: url("data:image/png;base64,${built.png.toString("base64")}");
  --atlas-${size}-w: ${built.width * 4}px;
  --atlas-${size}-h: ${built.height * 4}px;`,
    )
    .join("\n  ");

  const chip = (tile, size, built) => {
    const rect = built.rects.get(tile.name);
    if (rect === undefined) return "";
    return `<div class="chip s${size}" style="background-position:-${rect.x * 4}px -${rect.y * 4}px"></div>`;
  };

  const sections = GROUPS.map(([group, title, note]) => {
    const list = tiles.filter((tile) => tile.group === group);
    const cells = list
      .map((tile) => {
        const chips = `${chip(tile, "12", small)}${chip(tile, "16", big)}`;
        const glyph = tile.glyph === null ? '<span class="none">нет глифа</span>' : `<span class="glyph">${escapeHtml(tile.glyph)}</span>`;
        return `<figure class="tile">
  <div class="chips">${chips}</div>
  <figcaption>
    <b>${escapeHtml(tile.name)}</b>
    <span class="label">${escapeHtml(tile.label)}</span>
    <span class="meta">${glyph}<span class="swatch" style="background:${tile.colour}"></span><code>${tile.colour}</code></span>
  </figcaption>
</figure>`;
      })
      .join("\n");
    return `<section>
<h2>${escapeHtml(title)} <span class="count">${list.length}</span></h2>
${note ? `<p class="note">${note}</p>` : ""}
<div class="grid">
${cells}
</div>
</section>`;
  }).join("\n");

  // The check the guide asks for (§6.10): a crowded compartment at 100 %, which
  // is where tiles either stay apart or merge into a smear. Drawn from the same
  // atlas, unscaled, so what is on the screen is what the game would draw.
  const crowd = [
    "machine.security-unit",
    "machine.crawler",
    "machine.enforcer",
    "thing.scrap",
    "thing.body",
    "thing.system",
    "actor.drone",
  ];
  const crowdRow = (size, built, scale) =>
    crowd
      .map((name) => {
        const rect = built.rects.get(name);
        if (rect === undefined) return "";
        const px = Number(size) * scale;
        return `<i style="width:${px}px;height:${px}px;background-image:var(--atlas-${size});background-size:${built.width * scale}px ${built.height * scale}px;background-position:-${rect.x * scale}px -${rect.y * scale}px"></i>`;
      })
      .join("");

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SALVOR — пиксельные тайлы</title>
<meta name="description" content="Контактный лист сгенерированного тайлсета SALVOR: ${tiles.length} иконок на сетке 12×12, отсеки ещё и на 16×16, в 4× увеличении и при 100 %.">
<style>
:root {
  --bg:#e8ecee; --panel:#f6f8f9; --sunk:#dee4e7; --line:#ccd5d9; --rule:#b6c2c8;
  --dim:#8b9aa3; --soft:#4f5d66; --ink:#1b242a; --bright:#000c13; --accent:#8a5410;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  --serif: Georgia, "Times New Roman", "PT Serif", serif;
  /* Тайлы всегда лежат на корпусе игры, в любой теме: набор нарисован под тёмный фон. */
  --hull:#0a0d10;
  ${backgrounds}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#0a0d10; --panel:#10151a; --sunk:#0d1216; --line:#1d242a; --rule:#2a343c;
    --dim:#3f4a52; --soft:#8f9aa2; --ink:#b9c4cc; --bright:#dfe9f0; --accent:#e0a458;
  }
}
:root[data-theme="dark"] {
  --bg:#0a0d10; --panel:#10151a; --sunk:#0d1216; --line:#1d242a; --rule:#2a343c;
  --dim:#3f4a52; --soft:#8f9aa2; --ink:#b9c4cc; --bright:#dfe9f0; --accent:#e0a458;
}
:root[data-theme="light"] {
  --bg:#e8ecee; --panel:#f6f8f9; --sunk:#dee4e7; --line:#ccd5d9; --rule:#b6c2c8;
  --dim:#8b9aa3; --soft:#4f5d66; --ink:#1b242a; --bright:#000c13; --accent:#8a5410;
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font-family:var(--serif); font-size:16px; line-height:1.6; }
.shell { max-width:74rem; margin:0 auto; padding:0 1.5rem 6rem; }
header { border-bottom:1px solid var(--rule); padding:3rem 0 1.75rem; display:grid; gap:.9rem; }
.callsign { font-family:var(--mono); font-size:.72rem; letter-spacing:.22em; text-transform:uppercase; color:var(--accent); }
h1 { font-family:var(--mono); font-weight:600; font-size:clamp(1.7rem,4vw,2.5rem); margin:0; color:var(--bright); letter-spacing:-.01em; }
header p { margin:0; max-width:44rem; color:var(--soft); }
h2 { font-family:var(--mono); font-size:1.05rem; font-weight:600; color:var(--bright); margin:2.75rem 0 .35rem; letter-spacing:.02em; }
.count { font-family:var(--mono); font-size:.78rem; color:var(--dim); font-weight:400; }
.note { margin:0 0 1.1rem; color:var(--soft); font-size:.92rem; max-width:44rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(11.5rem,1fr)); gap:.75rem; }
.tile { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:.7rem; display:grid; gap:.6rem; }
.chips { display:flex; gap:.5rem; align-items:flex-end; background:var(--hull); border:1px solid var(--line); border-radius:2px; padding:.55rem; justify-content:center; min-height:62px; }
.chip { image-rendering:pixelated; background-repeat:no-repeat; }
.s12 { width:48px; height:48px; background-image:var(--atlas-12); background-size:var(--atlas-12-w) var(--atlas-12-h); }
.s16 { width:64px; height:64px; background-image:var(--atlas-16); background-size:var(--atlas-16-w) var(--atlas-16-h); }
figcaption { display:grid; gap:.15rem; font-family:var(--mono); font-size:.72rem; }
figcaption b { color:var(--bright); font-weight:600; }
.label { color:var(--soft); font-family:var(--serif); font-size:.82rem; }
.meta { display:flex; align-items:center; gap:.4rem; color:var(--dim); }
.glyph { color:var(--accent); font-weight:700; min-width:1ch; }
.none { color:var(--dim); font-size:.68rem; }
.swatch { width:.7rem; height:.7rem; border-radius:2px; border:1px solid var(--line); display:inline-block; }
code { font-family:var(--mono); font-size:.68rem; }
.crowd { background:var(--hull); border:1px solid var(--line); border-radius:3px; padding:1rem 1.1rem; display:grid; gap:.85rem; }
.crowd .row { display:flex; align-items:center; gap:2px; }
.crowd .row.spaced { gap:6px; }
.crowd i { display:block; image-rendering:pixelated; background-repeat:no-repeat; }
.crowd .cap { font-family:var(--mono); font-size:.68rem; color:var(--dim); letter-spacing:.06em; }
.crowd .today { font-family:var(--mono); font-size:14px; letter-spacing:.16em; gap:8px; }
.crowd .today b { color:#d96a6a; font-weight:700; }
.crowd .today u { color:#8f9aa2; text-decoration:none; }
.toggle { position:fixed; top:1rem; right:1rem; font-family:var(--mono); font-size:.7rem; letter-spacing:.1em; text-transform:uppercase; background:var(--panel); color:var(--soft); border:1px solid var(--rule); border-radius:2px; padding:.4rem .7rem; cursor:pointer; }
footer { margin-top:3.5rem; padding-top:1.25rem; border-top:1px solid var(--rule); color:var(--dim); font-size:.85rem; }
footer code { color:var(--soft); }
</style>
</head>
<body>
<button class="toggle" id="theme">тема</button>
<div class="shell">
<header>
  <div class="callsign">SALVOR · G70</div>
  <h1>Пиксельные тайлы вместо ASCII</h1>
  <p>Весь словарь игры — <b>${tiles.length}</b> иконок из масок «есть пиксель / нет пикселя». Ни полутона, ни цвета внутри арта: цвет несёт состояние и принадлежит виду, а полутон на 12 пикселях не виден. Слева каждый тайл в 12, у отсеков рядом второй, отдельно нарисованный, в 16. Показано в 4× на корпусном фоне игры.</p>
</header>

<section>
<h2>Проверка теснотой <span class="count">100 %</span></h2>
<p class="note">Один и тот же отсек: охранник, ползун, каратель, лом, труп, система и дрон. Сверху — как его рисует игра сегодня, ниже — тайлами при 100 %. Красивый одиночный тайл ничего не значит, если в куче они сливаются (<code>docs/gui-guides.md</code>, §6.10), поэтому смотреть надо на эту полосу, а не на увеличенные карточки ниже.</p>
<div class="crowd">
  <div class="cap">сегодня · тот же отсек на схеме</div>
  <div class="row today"><b>S</b><b>z</b><b>E</b><u>%</u><u>†</u><u>+</u><u>@</u></div>
  <div class="cap">12 · вплотную</div>
  <div class="row">${crowdRow("12", small, 1)}</div>
  <div class="cap">12 · с зазором</div>
  <div class="row spaced">${crowdRow("12", small, 1)}</div>
  <div class="cap">12 · 200 %, как читается на схеме itch</div>
  <div class="row spaced">${crowdRow("12", small, 2)}</div>
</div>
<p class="note" style="margin-top:1.1rem">Наверху все три машины одного красного, и это не недосмотр: цвет на схеме несёт тревогу, а не опознание — пока глифы красились цветом состояния отсека, коробка с карателем не отличалась от коробки с ящиком (<code>drawBox</code> в <code>ui/schematic.ts</code>). Канал занят по делу, и тринадцать цветов из <code>content/monsters.ts</code> в него уже не влезут. Свободна форма — она и внизу. Цвета на карточках дальше по странице взяты из таблицы, а не с экрана.</p>
</section>

${sections}
<footer>
  Перегенерировать: <code>npm run tiles -w games/salvor</code>. Формы — <code>games/salvor/tools/tiles/sprites.mjs</code>. То, что читает игра, — <code>games/salvor/src/tiles/sprites.ts</code>: те же маски как SVG-символы на <code>currentColor</code>. Атласы и этот лист — только чтобы смотреть.
</footer>
</div>
<script>
(function () {
  var button = document.getElementById("theme");
  var saved = null;
  try { saved = localStorage.getItem("salvor-tiles-theme"); } catch (e) { saved = null; }
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  button.addEventListener("click", function () {
    var dark = matchMedia("(prefers-color-scheme: dark)").matches;
    var now = document.documentElement.getAttribute("data-theme") || (dark ? "dark" : "light");
    var next = now === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("salvor-tiles-theme", next); } catch (e) { /* private window */ }
  });
})();
</script>
</body>
</html>
`;
}

// -------------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback) => {
    const at = argv.indexOf(name);
    return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
  };
  const outDir = resolve(flag("--out", OUT_DIR));
  const tsOut = resolve(flag("--ts", TS_OUT));
  const contactPath = resolve(flag("--contact", join(homedir(), "reports", "salvor-tiles.html")));

  const tiles = catalogue();
  const seen = new Set();
  for (const tile of tiles) {
    if (seen.has(tile.name)) throw new Error(`tiles: two tiles called ${tile.name}`);
    seen.add(tile.name);
    checkMask(tile.name, tile.mask, GRID);
    if (tile.mask16) checkMask(`${tile.name} at ${ZONE_GRID}`, tile.mask16, ZONE_GRID);
  }

  const small = atlas(tiles, GRID, (tile) => tile.mask);
  const big = atlas(tiles, ZONE_GRID, (tile) => tile.mask16);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `salvor-${GRID}.png`), small.png);
  writeFileSync(join(outDir, `salvor-${ZONE_GRID}.png`), big.png);

  const index = {
    generator: "games/salvor/tools/tiles/tiles.mjs",
    module: "games/salvor/src/tiles/sprites.ts",
    grid: GRID,
    columns: COLUMNS,
    count: tiles.length,
    sizes: {
      [GRID]: { image: `salvor-${GRID}.png`, tile: GRID, width: small.width, height: small.height, rows: small.rows, count: small.count, holds: "every tile" },
      [ZONE_GRID]: { image: `salvor-${ZONE_GRID}.png`, tile: ZONE_GRID, width: big.width, height: big.height, rows: big.rows, count: big.count, holds: "compartment kinds, drawn again" },
    },
    tiles: Object.fromEntries(
      tiles.map((tile) => {
        const rects = { [GRID]: small.rects.get(tile.name) };
        const at16 = big.rects.get(tile.name);
        if (at16 !== undefined) rects[ZONE_GRID] = at16;
        return [
          tile.name,
          {
            group: tile.group,
            label: tile.label,
            glyph: tile.glyph,
            colour: tile.colour,
            ...(tile.role ? { role: tile.role } : {}),
            symbol: idOf(tile.name),
            rects,
          },
        ];
      }),
    ),
  };
  writeFileSync(join(outDir, "salvor.json"), `${JSON.stringify(index, null, 2)}\n`);

  mkdirSync(dirname(tsOut), { recursive: true });
  writeFileSync(tsOut, tsModule(tiles));

  mkdirSync(dirname(contactPath), { recursive: true });
  writeFileSync(contactPath, contactSheet(tiles, big, small));

  process.stdout.write(
    `tiles: ${tiles.length} icons\n` +
      `  ${tsOut} (${(tsModule(tiles).length / 1024).toFixed(1)} kB of symbols)\n` +
      `  ${outDir} — salvor-${GRID}.png ${small.width}×${small.height} (${small.count}), salvor-${ZONE_GRID}.png ${big.width}×${big.height} (${big.count})\n` +
      `  ${contactPath}\n`,
  );
}

main();
