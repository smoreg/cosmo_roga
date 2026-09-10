import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RoomGame, Rng, hexLayout, type RoomGameConfig } from "@jamrog/engine";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { DERELICTS, buildDerelict, derelictSpec } from "../src/content/derelicts.js";
import { hullArtOf, HULL_ART } from "../src/content/hulls-art.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { hexSvgOf } from "../src/ui/web/hex-svg.js";
import { WEB_CSS } from "../src/ui/web/styles.js";

/**
 * The owner's contact sheet for the drawn hull (`docs/tasks/G81-hull-silhouette.md`):
 * real hulls out of the game's own generator, each drawn twice — with the hull
 * under the honeycomb and without — so the picture can be judged by eye without
 * a run, which is the one way a drawing gets judged here.
 *
 * Off by default, like `RECORD=1` in `replay.test.ts`: `SHEET=1 npx vitest run
 * games/salvor/tests/hullview-sheet.test.ts` writes `~/reports/salvor-hullview.html`.
 * Nothing is asserted; the drawing's invariants are in `hullart.test.ts`.
 */

const OUT = join(homedir(), "reports", "salvor-hullview.html");

/** Class · seed, one row of the sheet each. Every class once, the big ones twice. */
const PICKS: Array<[string, number]> = [
  ["freighter", 7],
  ["barge", 3],
  ["ferry", 5],
  ["probe", 2],
  ["tender", 11],
  ["laboratory", 4],
  ["military", 6],
  ["smuggler", 9],
  ["corsair", 12],
  ["quarantine", 8],
  ["fathers-tug", 5],
  ["fathers-tug", 8],
];

describe("the hull contact sheet", () => {
  it("writes ~/reports/salvor-hullview.html when SHEET=1", () => {
    if (process.env.SHEET !== "1") return;
    const rows = [ownersFrame(), ...PICKS.map(([id, seed]) => row(id, seed))];
    writeFileSync(OUT, page(rows));
  });
});

/**
 * The owner's second screenshot as a row of its own: a quarantine hull of
 * fourteen compartments, three ways — as the production build drew it (the
 * skin traced around the bare honeycomb, G81), as it is drawn now (the deck
 * inside a hull built of cells), and bare.
 */
function ownersFrame(): string {
  const spec = derelictSpec("quarantine")!;
  let seed = 1;
  let built = buildDerelict(spec, 1, new Rng(seed), { flags: new Set(), shipIndex: 1 });
  while (built.ship.rooms.length !== 14) built = buildDerelict(spec, 1, new Rng(++seed), { flags: new Set(), shipIndex: 1 });
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => built.ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  const art = hullArtOf(game.ship, String(seed));
  const input = schematicInputOf(game);
  const banner = `«14» · quarantine`;
  const before = hexSvgOf(input, hexLayout(game.ship), banner, art);
  const layout = hexLayout(game.ship, { allowed: art.mask });
  const after = hexSvgOf(input, layout, banner, art);
  const bare = hexSvgOf(input, hexLayout(game.ship), banner);
  const doors = layout.corridors.size + layout.links.size;
  const share = doors === 0 ? "—" : `${((layout.corridors.size / doors) * 100).toFixed(0)} %`;
  return [
    `<section class="row">`,
    `<h2>кадр владельца: quarantine · сид ${seed} · отсеков 14 · было и стало</h2>`,
    `<div class="pair three">`,
    `<figure><div class="salvor-web">${before}</div><figcaption>было: обвод по сотам (G81, прод)</figcaption></figure>`,
    `<figure><div class="salvor-web">${after}</div><figcaption>стало: корпус из сот, ${layout.masked ? "маска принята" : "маска отклонена"} · коридоров ${share}</figcaption></figure>`,
    `<figure><div class="salvor-web">${bare}</div><figcaption>?hull=0</figcaption></figure>`,
    `</div>`,
    `</section>`,
  ].join("\n");
}

function row(classId: string, seed: number): string {
  const spec = derelictSpec(classId);
  if (spec === undefined) throw new Error(`no class ${classId}`);
  const built = buildDerelict(spec, 1, new Rng(seed), { flags: new Set(), shipIndex: 1 });
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => built.ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  // The left picture is grown inside the hull's own profile (G82) when the
  // layout can honour it; the right one is the honeycomb as it was.
  const art = hullArtOf(game.ship, String(seed));
  const layout = hexLayout(game.ship, { allowed: art.mask });
  const bareLayout = hexLayout(game.ship);
  const input = schematicInputOf(game);
  const banner = `«${String(built.ship.rooms.length)}» · ${classId}`;
  const withHull = hexSvgOf(input, layout, banner, art);
  const bare = hexSvgOf(input, bareLayout, banner);
  const profile = HULL_ART[classId] ?? "—";
  const form = art.form === undefined ? "—" : `${art.form.kind} · киль ${art.form.size} · ряды ±${art.form.half} · сот ${art.mask?.size ?? 0}`;
  const kept = layout.masked ? "маска принята" : "маска отклонена, обвод по сотам";
  const doors = layout.corridors.size + layout.links.size;
  const share = doors === 0 ? "—" : `${((layout.corridors.size / doors) * 100).toFixed(0)} %`;
  const size = (svg: string): string => {
    const m = svg.match(/viewBox="[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)"/);
    return m ? `${m[1]} × ${m[2]}` : "";
  };
  return [
    `<section class="row">`,
    `<h2>${classId} · сид ${seed} · отсеков ${built.ship.rooms.length} · профиль <code>${profile}</code> · форма <code>${form}</code></h2>`,
    `<div class="pair">`,
    `<figure><div class="salvor-web">${withHull}</div><figcaption>с корпусом · ${kept} · коридоров ${share} · viewBox ${size(withHull)}</figcaption></figure>`,
    `<figure><div class="salvor-web">${bare}</div><figcaption>?hull=0 · viewBox ${size(bare)}</figcaption></figure>`,
    `</div>`,
    `</section>`,
  ].join("\n");
}

function page(rows: string[]): string {
  const classes = DERELICTS.map((d) => `<code>${d.id}</code> → <code>${HULL_ART[d.id] ?? "обвод без деталей"}</code>`).join(" · ");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SALVOR · корпус под сотами</title>
<style>
${WEB_CSS}
:root{color-scheme:dark;}
body{margin:0; background:#0a0d10; color:#b9c4cc; font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:14px; line-height:1.5;}
.shell{max-width:1500px; margin:0 auto; padding:2rem 1.5rem 5rem;}
header{border-bottom:1px solid #2a343c; padding:0 0 1.5rem; margin-bottom:1.5rem;}
header .callsign{font-size:.72rem; letter-spacing:.22em; text-transform:uppercase; color:#e0a458; margin:0 0 .6rem;}
header h1{margin:0 0 .8rem; color:#dfe9f0; font-size:1.9rem; font-weight:600;}
header p{max-width:52rem; color:#8f9aa2; margin:.4rem 0;}
header p strong{color:#b9c4cc; font-weight:400;}
code{color:#dfe9f0; font-size:.92em;}
.row{padding:1.4rem 0 .4rem; border-top:1px solid #1d242a;}
.row h2{font-size:1rem; font-weight:600; color:#e0a458; margin:0 0 .8rem; letter-spacing:.02em;}
.pair{display:grid; grid-template-columns:1fr 1fr; gap:1rem;}
.pair.three{grid-template-columns:1fr 1fr 1fr;}
@media (max-width:900px){.pair{grid-template-columns:1fr;}}
figure{margin:0; background:radial-gradient(120% 90% at 30% 20%, #0f1519 0%, #0a0d10 70%); border:1px solid #1d242a; padding:.5rem;}
figcaption{color:#8f9aa2; font-size:.78rem; padding:.4rem .2rem 0; letter-spacing:.06em;}
/* The game's own stylesheet, minus the full-screen shell it wraps the page in. */
.salvor-web{position:static; inset:auto; display:block; height:auto; overflow:visible; background:none; font-size:inherit;}
.salvor-web .schematic{width:100%; height:auto; max-height:560px; display:block;}
</style>
</head>
<body>
<div class="shell">
<header>
<p class="callsign">SALVOR · G82 · сотовый вид</p>
<h1>Корпус первым, соты внутри</h1>
<p>Каждый корабль — из генератора игры; граф отсеков и дверей тот же, что в забеге. Слева <code>?view=hex</code>, как в игре: корпус <strong>выложен из сот</strong> симметрично относительно киля — класс задаёт пропорции секций, сид сдвигает границы на соту, — деку разложили внутри него, а рисунок корабля повторяет эту фигуру: прямые борта по секциям, скосы на уступах, гондолы на кормовой плите, рубка в носу; всё, что нарисовано, обрезано силуэтом. Справа — <code>?hull=0</code>, байт в байт прежний рисунок. Если маска не вмещает дерево или коридоров выходит меньше 80 %, раскладка откатывается на прежнюю и корпус обводится по сотам — подпись под картинкой говорит, что случилось.</p>
<p>Янтарь — только у дверей и шлюза. Всё, что на корпусе, — сталь и темнее. Профиль на класс: ${classes}.</p>
<p>Пересобрать: <code>SHEET=1 npx vitest run games/salvor/tests/hullview-sheet.test.ts</code>.</p>
</header>
${rows.join("\n")}
</div>
</body>
</html>
`;
}
