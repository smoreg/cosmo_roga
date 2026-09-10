import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RoomGame, Rng, hexLayout, type RoomGameConfig } from "@jamrog/engine";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { DERELICTS, buildDerelict } from "../src/content/derelicts.js";
import { hazardStore, markHazard, type HazardRecord } from "../src/systems/hazardstate.js";
import type { DoorState, SchematicDoor, SchematicInput, SchematicRoom } from "../src/ui/schematic.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";
import { hullArtOf } from "../src/content/hulls-art.js";
import { hexSvgOf } from "../src/ui/web/hex-svg.js";
import { svgOf } from "../src/ui/web/schematic-svg.js";
import { WEB_CSS, WEB_ROOT_CLASS } from "../src/ui/web/styles.js";

/**
 * The owner's contact sheet for the tiles (`docs/tasks/G80-tiles-integration.md`):
 * real compartments off the game's own generator, each drawn twice — with tiles
 * and with the letters they replace — so the picture can be judged by eye
 * without a run, which is the one way a drawing gets judged here.
 *
 * Off by default, exactly as `hullview-sheet.test.ts` is: `SHEET=1 npx vitest
 * run games/salvor/tests/tileview-sheet.test.ts` writes
 * `~/reports/salvor-tileview.html`. Nothing is asserted here; what the drawing
 * must never do is measured in `tiles-view.test.ts`.
 *
 * Everything on the sheet is drawn at the smallest scale the game can put a
 * compartment on screen at — the widest hull any class generates, on the itch
 * viewport — because a tileset judged at any other size tells you nothing
 * (`docs/gui-guides.md`, 6.1).
 */

const OUT = join(homedir(), "reports", "salvor-tileview.html");

function derelictGame(specId: string, seed: number, depth = 3): RoomGame {
  const spec = DERELICTS.find((d) => d.id === specId)!;
  const built = buildDerelict(spec, depth, new Rng(seed), { flags: new Set(), shipIndex: 1 });
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: SALVOR,
    firstShip: () => built.ship,
    firstShipId: "1",
  };
  return new RoomGame({ ...config, seed });
}

/**
 * The compartment matching `want` on a real hull, as the schematic sees it.
 *
 * Searched over seeds rather than pinned to one, because the content tables
 * move under this file — a machine's band, a hazard's budget — and a sheet that
 * named `quarantine/3` and nothing else stopped building the day G83 landed.
 * The class is still named: what the sheet shows has to be the situation it
 * says it is.
 */
function pick(
  specId: string,
  want: (room: SchematicRoom) => boolean,
  before?: (game: RoomGame) => void,
): SchematicRoom {
  for (let seed = 1; seed <= 40; seed++) {
    for (const depth of [3, 5, 1]) {
      const game = derelictGame(specId, seed, depth);
      before?.(game);
      for (const r of game.ship.rooms) {
        game.player.room = r.id;
        game.refreshSight();
        const room = schematicInputOf(game).rooms.find((x) => x.state === "current");
        if (room && want(room)) return room;
      }
    }
  }
  throw new Error(`nothing on ${specId} matched over 40 seeds`);
}

/** The same compartment, moved to the top-left cell so the crop is fixed. */
function alone(room: SchematicRoom): SchematicInput {
  return { rooms: [{ ...room, col: 0, row: 0 }], doors: [], shipLine: "" };
}

const CROP = { x: 104, y: 44, w: 148, h: 100 };

function panel(input: SchematicInput, tiles: boolean, scale: number, crop = CROP): string {
  const svg = svgOf(input, "", tiles);
  return svg
    .replace(/viewBox="0 0 [\d.]+ [\d.]+"/, `viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}"`)
    .replace("<svg ", `<svg width="${Math.round(crop.w * scale)}" height="${Math.round(crop.h * scale)}" `);
}

function row(title: string, note: string, input: SchematicInput, scale: number, crop = CROP): string {
  return [
    `<div class="case">`,
    `<div class="case-head"><h3>${title}</h3><p>${note}</p></div>`,
    `<div class="pair">`,
    `<figure><figcaption>тайлы · ?tiles=1</figcaption><div class="${WEB_ROOT_CLASS} sheet">${panel(input, true, scale, crop)}</div></figure>`,
    `<figure><figcaption>глифы · как сейчас</figcaption><div class="${WEB_ROOT_CLASS} sheet">${panel(input, false, scale, crop)}</div></figure>`,
    `</div></div>`,
  ].join("");
}

/**
 * A whole honeycomb, both ways, at its own scale. Not cropped to one cell: the
 * question the honeycomb answers is the shape of the ship, and a single
 * hexagon cannot be judged for that.
 */
function hexRow(specId: string, seed: number, scale: number): string {
  const game = derelictGame(specId, seed, 3);
  // Stood where there is something to see, and every compartment walked so the
  // drawing is a hull that has been explored rather than one dashed cell.
  for (const r of game.ship.rooms) {
    game.player.room = r.id;
    game.refreshSight();
  }
  const art = hullArtOf(game.ship, game.shipId);
  const layout = hexLayout(game.ship, { allowed: art?.mask });
  const draw = (tiles: boolean): string => {
    const svg = hexSvgOf(schematicInputOf(game), layout, "", art, tiles);
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)!;
    return svg.replace(
      "<svg ",
      `<svg width="${Math.round(Number(m[3]) * scale)}" height="${Math.round(Number(m[4]) * scale)}" `,
    );
  };
  return [
    `<div class="case">`,
    `<div class="case-head"><h3>Соты целиком — ${specId}</h3>`,
    `<p>Тайлы поверх сот; корпус, соты, коридоры и метки дверей не сдвинулись ни на единицу. `,
    `Пиктограмма назначения — над именем: где здесь три системы, видно раньше, чем читается слово.</p></div>`,
    `<div class="pair wide">`,
    `<figure><figcaption>тайлы · ?tiles=1</figcaption><div class="${WEB_ROOT_CLASS} sheet">${draw(true)}</div></figure>`,
    `<figure><figcaption>глифы · как сейчас</figcaption><div class="${WEB_ROOT_CLASS} sheet">${draw(false)}</div></figure>`,
    `</div></div>`,
  ].join("");
}

describe("the tile contact sheet", () => {
  it("writes ~/reports/salvor-tileview.html when SHEET=1", () => {
    if (process.env.SHEET !== "1") return;
    // The worst scale the game can draw a compartment at: the widest hull any
    // class makes, on the itch viewport. The sheet is drawn at that and not at
    // the comfortable average, because the whole point of the check is the
    // small end (docs/gui-guides.md, 6.1).
    let scale = Infinity;
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 12; seed++) {
        const game = derelictGame(spec.id, seed, 4);
        game.player.room = game.ship.rooms[0]!.id;
        game.refreshSight();
        const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgOf(schematicInputOf(game), ""))!;
        scale = Math.min(scale, 1258 / Number(m[1]), 602 / Number(m[2]));
      }
    }

    const cases: string[] = [];

    cases.push(
      row(
        "Плотный ряд: три машины и ящик",
        "Контрольный кадр Кызрати: не один красивый тайл, а ряд. Машины красные и слева, как и были.",
        alone(pick("military", (r) => (r.hostiles ?? 0) >= 5 && (r.things?.length ?? 0) >= 4)),
        scale,
      ),
    );

    cases.push(
      row(
        "Шесть вещей — потолок ряда",
        "Больше шести не влезает: седьмое становится «+N», чтобы счётчик не вылез за коробку.",
        alone(pick("military", (r) => (r.things?.length ?? 0) === 6)),
        scale,
      ),
    );

    cases.push(
      row(
        "Ящик и лом",
        "То, ради чего летят. Ящик и лом — разные силуэты; буквой X и % они различались только на память.",
        alone(pick("smuggler", (r) => (r.things ?? []).filter((t) => t.glyph === "X").length >= 2 && (r.things ?? []).some((t) => t.glyph === "%"))),
        scale,
      ),
    );

    cases.push(
      row(
        "Система корабля, ради которой рейс",
        "Плюс — работа, которую здесь надо сделать. Пиктограмма слева говорит «реактор» раньше слова.",
        alone(pick("freighter", (r) => r.kind === "reactor" && (r.things ?? []).some((t) => t.glyph === "+"))),
        scale,
      ),
    );

    cases.push(
      row(
        "Поднятая система",
        "Тот же отсек, когда система уже работает: галочка вместо плюса. Данные те же, что читает панель.",
        alone(
          pick(
            "freighter",
            (r) => r.kind === "reactor" && (r.things ?? []).some((t) => t.glyph === "✓"),
            (game) => {
              for (const r of game.ship.rooms) {
                const list = r.data.systems;
                if (Array.isArray(list)) for (const s of list) (s as { online?: boolean }).online = true;
              }
            },
          ),
        ),
        scale,
      ),
    );

    cases.push(
      row(
        "Шлюз: метка остаётся буквами",
        "a1 — имя двери, которое игрок набирает. Тайла у него нет и не будет: он пишется, а не рисуется.",
        alone(pick("freighter", (r) => (r.things ?? []).some((t) => t.glyph === "a1"))),
        scale,
      ),
    );

    cases.push(
      row(
        "Отсек, вскрытый в космос",
        "Тильда среди вещей, а не состояние коробки: свойство отсека либо видно везде, либо его нет.",
        alone(
          pick(
            "freighter",
            (r) => (r.things ?? []).some((t) => t.glyph === "~"),
            (game) => {
              for (const r of game.ship.rooms) if (r.kind === "cargo") r.hazard = "vented";
            },
          ),
        ),
        scale,
      ),
    );

    /** A hazard armed by hand: the placer refuses the first derelict of a
     * voyage and every hull here is one. Same record, same two calls, same
     * drawing the game would make. */
    const armed = (id: "frost" | "smoke" | "mine") => (game: RoomGame) => {
      const store = hazardStore(game);
      if (id === "mine") {
        // `Door.trap` is optional and simply absent until something sets it,
        // unlike `Room.hazard`, which is the string "none".
        const door = game.ship.doors.find((d) => d.a !== d.b && d.trap === undefined);
        if (!door) return;
        const rec: HazardRecord = { id, door: door.id, known: true };
        store.push(rec);
        markHazard(game.ship, rec);
        return;
      }
      const room = game.ship.rooms.find((r) => r.id !== game.ship.entry && r.hazard === "none");
      if (!room) return;
      const rec: HazardRecord = { id, room: room.id, known: true };
      store.push(rec);
      markHazard(game.ship, rec);
    };

    cases.push(
      row(
        "Предмет поручения",
        "Консоль и посылка по чартеру — один знак, разные подписи. Тайла у звёздочки не было до 10.09.",
        alone(
          pick(
            "freighter",
            (r) => (r.things ?? []).some((t) => t.glyph === "*"),
            (game) => {
              // The errand item is placed by a charter at run time, not by the
              // generator, so the sheet puts one where a charter would: the
              // same bucket the schematic reads (`CONTENT_KEYS`).
              const room = game.ship.rooms.find((r) => r.id !== game.ship.entry);
              if (room) room.data.items = [{ id: "console", kind: "console" }];
            },
          ),
        ),
        scale,
      ),
    );

    cases.push(
      row(
        "Опасность: дым",
        "Дым — одна сплошная масса. Отсек, в который не видно ни снаружи, ни изнутри.",
        alone(pick("quarantine", (r) => (r.things ?? []).some((t) => t.glyph === "≈"), armed("smoke"))),
        scale,
      ),
    );

    cases.push(
      row(
        "Опасность: мина на двери",
        "Заряд с четырьмя усами, сплошной внутри — этим он и отличается от мороза, который весь дыра.",
        alone(pick("freighter", (r) => (r.things ?? []).some((t) => t.glyph === "^"), armed("mine"))),
        scale,
      ),
    );

    cases.push(
      row(
        "Опасность: мороз",
        "Четвёртый класс набора. Опасность заполняет клетку целиком — машина носит шасси, вещь стоит в углу.",
        alone(
          pick(
            "quarantine",
            (r) => (r.things ?? []).some((t) => t.glyph === "❄"),
            armed("frost"),
          ),
        ),
        scale,
      ),
    );

    cases.push(
      row(
        "Карантин: выводок",
        "Три машины одного гнезда. Роль различается формой — цвет занят тревогой и различать им нечего.",
        alone(pick("quarantine", (r) => (r.hostiles ?? 0) >= 5)),
        scale,
      ),
    );

    // Doors: the one thing tiles must not touch. Two boxes and a wire, drawn at
    // each of the six states, with the label a text plate in both modes.
    const states: DoorState[] = ["open", "closed", "locked", "sealed", "broken", "airlock"];
    const doors: SchematicDoor[] = [];
    const boxes: SchematicRoom[] = [];
    states.forEach((state, i) => {
      boxes.push(
        { id: i * 2 + 1, label: `r${i * 2 + 1}`, name: "CARGO", kind: "cargo", col: 0, row: i, state: "explored", glyphs: "" },
        { id: i * 2 + 2, label: `r${i * 2 + 2}`, name: "STORAGE", kind: "storage", col: 1, row: i, state: "explored", glyphs: "" },
      );
      doors.push({ id: i + 1, label: `d${i + 1}`, a: i * 2 + 1, b: i * 2 + 2, state, portA: 0, portB: 0 });
    });
    cases.push(
      row(
        "Двери всех шести состояний",
        "Тайлы дверей не касаются вовсе: провод и табличка — те же, метка двери остаётся текстом.",
        { rooms: boxes, doors, shipLine: "" },
        scale,
        { x: 104, y: 44, w: 340, h: 104 * states.length + 40 },
      ),
    );

    cases.push(
      row(
        "Отсек, куда никто не заходил",
        "Пиктограммы нет: назначение — ровно то, чего дрон ещё не знает. Пунктир и точки, как и были.",
        {
          rooms: [{ id: 1, label: "r1", name: "REACTOR", kind: "reactor", col: 0, row: 0, state: "unknown", glyphs: "" }],
          doors: [],
          shipLine: "",
        },
        scale,
      ),
    );

    // ------------------------------------------------------- the honeycomb
    //
    // The third view, drawn at its own worst scale, which is worse than the
    // schematic's: more compartments in one frame and a hull around them.
    let hexScale = Infinity;
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 12; seed++) {
        const game = derelictGame(spec.id, seed, 4);
        game.player.room = game.ship.rooms[0]!.id;
        game.refreshSight();
        const art = hullArtOf(game.ship, game.shipId);
        const svg = hexSvgOf(schematicInputOf(game), hexLayout(game.ship, { allowed: art?.mask }), "", art);
        const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg)!;
        hexScale = Math.min(hexScale, 1258 / Number(m[1]), 602 / Number(m[2]));
      }
    }

    cases.push(hexRow("military", 2, hexScale));
    cases.push(hexRow("quarantine", 3, hexScale));

    const html = PAGE.replace("{{HEXPX}}", (12 * hexScale).toFixed(1))
      .replace("{{HEXSCALE}}", hexScale.toFixed(2))
      .replace("{{SCALE}}", scale.toFixed(2))
      .replace("{{CSS}}", WEB_CSS)
      .replace("{{CASES}}", cases.join("\n"));
    writeFileSync(OUT, html);
  });
});

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тайлы на схеме — контрольный лист</title>
<meta name="description" content="Слева тайлы, справа глифы: одиннадцать настоящих отсеков SALVOR при том масштабе, при котором схема рисуется на itch.">
<meta name="html-report" content="group Личное; tags salvor, игра, тайлы">
<style>
:root{
  --bg:#0a0d10; --panel:#10151a; --sunk:#0d1216; --rule:#2a343c; --dim:#3f4a52;
  --soft:#8f9aa2; --ink:#b9c4cc; --bright:#dfe9f0; --accent:#e0a458;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  --serif: Georgia, "Times New Roman", "PT Serif", serif;
}
*{box-sizing:border-box;}
body{margin:0; background:var(--bg); color:var(--ink); font-family:var(--serif);
  font-size:17px; line-height:1.65;}
.shell{max-width:68rem; margin:0 auto; padding:0 1.5rem 6rem;}
.masthead{border-bottom:1px solid var(--rule); padding:3rem 0 2rem; display:grid; gap:1.1rem;}
.masthead .callsign{font-family:var(--mono); font-size:.72rem; letter-spacing:.22em;
  text-transform:uppercase; color:var(--accent);}
.masthead h1{font-family:var(--mono); font-weight:600; font-size:clamp(1.9rem,5vw,2.9rem);
  line-height:1.1; margin:0; color:var(--bright);}
.masthead p{margin:0; max-width:40rem; color:var(--soft); font-size:1.05rem;}
h2{font-family:var(--mono); font-weight:600; font-size:1.4rem; color:var(--bright);
  margin:3rem 0 1rem;}
h3{font-family:var(--mono); font-weight:600; font-size:1rem; letter-spacing:.01em;
  color:var(--accent); margin:0 0 .35rem;}
p{margin:0 0 1rem; max-width:40rem;}
.case{border-top:1px solid var(--rule); padding:1.8rem 0;}
.case-head p{margin:0; color:var(--soft); font-size:.95rem;}
.pair{display:flex; gap:1.5rem; flex-wrap:wrap; margin-top:1rem; align-items:flex-start;}
.pair.wide{display:grid; grid-template-columns:1fr; gap:2rem;}
figure{margin:0;}
figcaption{font-family:var(--mono); font-size:.7rem; letter-spacing:.16em; text-transform:uppercase;
  color:var(--dim); margin-bottom:.5rem;}
.sheet{background:var(--sunk); border:1px solid var(--rule); border-radius:4px; padding:6px;}
.rule{font-family:var(--mono); font-size:.9rem; color:var(--soft); background:var(--panel);
  border-left:2px solid var(--accent); padding:.9rem 1.1rem; max-width:40rem; margin:0 0 1rem;}
{{CSS}}
/* The view's own stylesheet above expects a full screen; here each drawing is a
   card on a page. Everything after this line only undoes that. */
.salvor-web.sheet{position:static; inset:auto; display:inline-block; grid-template:none;
  width:auto; height:auto; overflow:visible; font-size:13px;}
.salvor-web.sheet .schematic{width:auto; height:auto;}
</style>
</head>
<body>
<div class="shell">
<header class="masthead">
  <div class="callsign">SALVOR · G80</div>
  <h1>Тайлы на схеме</h1>
  <p>Слева — тайлы, справа — то же самое сегодняшними буквами. Отсеки настоящие: взяты
  с кораблей, которые генерирует игра. Масштаб <strong>{{SCALE}}×</strong> — самый мелкий,
  какой игра даёт: самый широкий корпус на вьюпорте itch. На обычном корабле всё это крупнее
  примерно в полтора раза. <strong>Ничего не увеличено.</strong></p>
</header>
<p class="rule">Правило одно: <strong>тайл подменяет глиф и никогда не подменяет слово.</strong>
Имя отсека, <code>rN</code> и метки дверей остаются текстом, панель по-прежнему называет всё
словами, а знак, которого нет в наборе, рисуется буквой — байт в байт как сейчас.</p>
{{CASES}}
<h2>Соты</h2>
<p class="rule">Сотовый вид — самый тесный из трёх: больше отсеков в кадре и корпус вокруг них.
Худший масштаб там <strong>{{HEXSCALE}}×</strong> — это <strong>{{HEXPX}} CSS px</strong> на тайл,
поэтому в соте он 12 единиц, а не 16. Ниже порога, за которым тайл читается медленнее буквы, —
но <strong>глиф, который он заменяет, там ещё мельче</strong>: <code>font-size:12</code> с
разрядкой в пятую долю em.</p>

<h2>Что включает</h2>
<p><code>?tiles=1</code> в адресе. Это модификатор поверх рисунка, а не четвёртый вид:
<code>V</code> по-прежнему ходит по трём. В терминальном виде флаг игнорируется.</p>
<p>Пересобрать: <code>SHEET=1 npx vitest run games/salvor/tests/tileview-sheet.test.ts</code>.</p>
</div>
</body>
</html>
`;
