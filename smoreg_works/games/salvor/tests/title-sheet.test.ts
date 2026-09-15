import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { newGame } from "../src/game.js";
import { LANGS, setLang, type Lang } from "../src/i18n.js";
import { initialState } from "../src/ui/appstate.js";
import { titleBox, titleRows, type TitleRole, type TitleRow } from "../src/ui/render.js";
import { KEY_W, LABEL_W, titleScreen } from "../src/ui/title.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH, THEME } from "../src/ui/theme.js";
import { VIEWS, type View } from "../src/ui/view.js";
import { screenHtml } from "../src/ui/web/screen.js";
import { skySvg } from "../src/ui/web/sky.js";
import { WEB_CSS } from "../src/ui/web/styles.js";

/**
 * The owner's contact sheet for the start screen (`docs/tasks/G84-title-screen.md`):
 * nine frames — the three views by the three languages — drawn out of the game's
 * own functions rather than mocked up, so the screen can be judged by eye
 * without opening a browser.
 *
 * Off by default, like the hull and tile sheets: `SHEET=1 npx vitest run
 * games/salvor/tests/title-sheet.test.ts` writes `~/reports/salvor-title.html`.
 * Nothing is asserted here; the screen's invariants are in `title.test.ts`.
 */

const OUT = join(homedir(), "reports", "salvor-title.html");

/** The seed the frames show. A real one, so the row reads as it does in a run. */
const SEED = 31415;

const LANG_NAMES: Record<Lang, string> = { en: "английский", es: "испанский", ru: "русский" };

const VIEW_NAMES: Record<View, string> = {
  ascii: "ASCII · терминал (по умолчанию, его ждут судьи)",
  web: "веб · панели",
  hex: "соты",
  // Стартовый экран у React-вью общий с остальными — его рисует оболочка
  // (`ui/app.ts`), и кадр ниже честно её, с подсвеченной четвёртой строкой.
  react: "React · стартовый экран оболочки, строка подсвечена",
};

describe("the start screen contact sheet", () => {
  it("writes ~/reports/salvor-title.html when SHEET=1", () => {
    if (process.env.SHEET !== "1") return;
    const rows = VIEWS.map((view) => viewRow(view));
    setLang("en");
    writeFileSync(OUT, page(rows));
  });
});

/** One view, all three languages side by side. */
function viewRow(view: View): string {
  const frames = LANGS.map((lang) => {
    setLang(lang);
    return [
      "<figure>",
      view === "ascii" ? asciiFrame(view) : webFrame(view),
      `<figcaption>${VIEW_NAMES[view]} · ${LANG_NAMES[lang]}</figcaption>`,
      "</figure>",
    ].join("");
  });
  return [
    `<section class="row">`,
    `<h2>${VIEW_NAMES[view]}</h2>`,
    `<div class="pair three">${frames.join("")}</div>`,
    `</section>`,
  ].join("");
}

/**
 * The terminal frame, cell for cell.
 *
 * The rows and the frame come out of `titleRows` and `titleBox`; what is
 * repeated here is the six lines of arithmetic `Renderer.drawTitle` does with
 * them — centre the box, one row of air, three columns of pad — because
 * `rot.js` draws to a canvas and a canvas is not a thing a node test can put
 * on a page.
 */
function asciiFrame(view: View): string {
  const screen = titleScreen({ view, sound: true, seed: SEED });
  const rows = titleRows(screen);
  const { width: w, height: h } = titleBox(screen);
  const x0 = (SCREEN_WIDTH - w) >> 1;
  const y0 = (SCREEN_HEIGHT - h) >> 1;
  const out: string[] = [];
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const inBox = y >= y0 && y < y0 + h;
    if (!inBox) {
      out.push("");
      continue;
    }
    const edge = y === y0 || y === y0 + h - 1;
    if (edge) {
      out.push(span(THEME.fgDim, " ".repeat(x0) + "·".repeat(w)));
      continue;
    }
    const row = rows[y - y0 - 1];
    const plain = row === undefined || row.role === "blank" ? "" : laidOut(row, w - 6);
    const body = row === undefined ? "" : rowHtml(row, w - 6);
    // The frame is a rectangle in the game — `Renderer.box` fills all four
    // edges — so the right one is drawn here too, padded off the plain text.
    const tail = " ".repeat(Math.max(0, w - 4 - plain.length)) + "·";
    out.push(span(THEME.fgDim, " ".repeat(x0) + "·") + "  " + body + span(THEME.fgDim, tail));
  }
  return `<pre class="ascii">${out.join("\n")}</pre>`;
}

/** The row with its centring pad, as the frame sees it: for measuring only. */
function laidOut(row: TitleRow, w: number): string {
  return padOf(row, w) + row.text;
}

function padOf(row: TitleRow, w: number): string {
  return CENTRED.has(row.role) ? " ".repeat(Math.max(0, (w - row.text.length) >> 1)) : "";
}

function rowHtml(row: TitleRow, w: number): string {
  if (row.role === "blank") return "";
  const pad = padOf(row, w);
  const colour = ROLE_COLOURS[row.role];
  if (row.role === "menu") {
    const rest = markUp(row, row.text.slice(1));
    return pad + span(THEME.accent, row.text.slice(0, 1)) + rest;
  }
  return pad + span(colour, esc(row.text));
}

/** The ring option this row is on, lit the way the renderer lights it. */
function markUp(row: TitleRow, text: string): string {
  const colour = ROLE_COLOURS[row.role];
  if (row.mark === undefined) return span(colour, esc(text));
  // The offset is measured off the whole row, and `text` has lost its first
  // character to the key glyph — the same column the renderer starts at.
  const at = row.text.indexOf(row.mark, KEY_W + LABEL_W) - 1;
  if (at < 0) return span(colour, esc(text));
  return [
    span(colour, esc(text.slice(0, at))),
    span(THEME.bright, esc(row.mark)),
    span(colour, esc(text.slice(at + row.mark.length))),
  ].join("");
}

const CENTRED: ReadonlySet<TitleRole> = new Set<TitleRole>(["name", "tagline", "foot"]);

const ROLE_COLOURS: Record<TitleRole, string> = {
  name: THEME.accent,
  tagline: THEME.fg,
  head: THEME.zone,
  menu: THEME.fg,
  hint: THEME.accent,
  keys: THEME.soft,
  foot: THEME.fgDim,
  blank: THEME.fg,
};

/** The page's own frame: the real `screenHtml`, title overlay and all. */
function webFrame(view: View): string {
  const game = newGame(SEED);
  const state = initialState({ view, sound: true, seed: SEED });
  const map = view === "hex" ? "hex" : "graph";
  // The sky is the shell's layer (`ui/web/mount.ts`), not part of the frame's string.
  return `<div class="salvor-web"><div class="web-sky">${skySvg()}</div>${screenHtml(game, state, new Set(), undefined, map)}</div>`;
}

function span(colour: string, text: string): string {
  return `<span style="color:${colour}">${text}</span>`;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function page(rows: readonly string[]): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SALVOR · стартовый экран</title>
<style>
${WEB_CSS}
:root{color-scheme:dark;}
body{margin:0; background:#0a0d10; color:#c8d2d8;
  font-family:ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif; line-height:1.5;}
.shell{max-width:110rem; margin:0 auto; padding:2rem 1.5rem 4rem;}
header{padding-bottom:1.2rem;}
.callsign{color:#e0a458; letter-spacing:.22em; font-size:.72rem; text-transform:uppercase; margin:0 0 .6rem;}
h1{font-size:1.5rem; font-weight:600; margin:0 0 .6rem; color:#e6eef3;}
header p{max-width:56rem; color:#8f9aa2; margin:.4rem 0;}
header p strong{color:#b9c4cc; font-weight:400;}
code{color:#dfe9f0; font-size:.92em;}
.row{padding:1.4rem 0 .4rem; border-top:1px solid #1d242a;}
.row h2{font-size:1rem; font-weight:600; color:#e0a458; margin:0 0 .8rem; letter-spacing:.02em;}
.pair.three{display:grid; grid-template-columns:1fr 1fr 1fr; gap:1rem;}
@media (max-width:1200px){.pair.three{grid-template-columns:1fr;}}
figure{margin:0; background:#0a0d10; border:1px solid #1d242a; padding:.5rem; overflow-x:auto;}
figcaption{color:#8f9aa2; font-size:.78rem; padding:.5rem .2rem 0; letter-spacing:.04em;}
pre.ascii{margin:0; font-family:ui-monospace,'DejaVu Sans Mono',Menlo,Consolas,monospace;
  font-size:8px; line-height:1.08; white-space:pre; background:#0a0d10;}
/* The game's own stylesheet, minus the full-screen shell it wraps the page in. */
.salvor-web{position:relative; inset:auto; display:block; height:auto; min-height:34rem;
  overflow:hidden; background:#0a0d10; font-size:12px;}
.salvor-web .web-over{position:relative; inset:auto; background:none; padding:0; min-height:34rem;}
.salvor-web .card{max-height:none;}
</style>
</head>
<body>
<div class="shell">
<header>
<p class="callsign">SALVOR · G84 · стартовый экран</p>
<h1>Девять кадров: три вида × три языка</h1>
<p>Каждый кадр — вывод функций игры, не мокап. Терминальный ряд собран из
<code>titleRows</code> и <code>titleBox</code> и разложен в сетку 95 × 42 той же арифметикой, что в
<code>Renderer.drawTitle</code>; два веб-ряда — настоящий <code>screenHtml</code> с настоящим
<code>WEB_CSS</code>.</p>
<p>Что проверять глазами: <strong>название крупно</strong>, под ним одна строка о чём игра;
в меню <strong>каждая строка — клавиша и её нынешнее значение</strong> (рейс, обучение, справка,
сид, язык, вид, звук); ярким в строке-кольце помечено то, на чём она стоит сейчас —
поэтому в первом ряду светится <code>ASCII</code>, во втором «панели», в третьем «соты»;
внизу — джем, автор и версия сборки. Сид показан настоящий (${SEED}) — на титуле он вводится
клавишей <code>4</code> и <code>Enter</code>.</p>
<p>Мышь: в двух веб-рядах у каждой строки меню есть <code>data-line</code> — тот же путь, которым
кликаются строки списка действий, — поэтому <strong>наведи курсор на строку прямо здесь</strong>:
она подсветится, как в игре. Кликнуть на листе нечего (это статическая страница), в игре клик
исполняет строку. Терминальный ряд мышью не управляется и не должен.</p>
<p>Пересобрать: <code>SHEET=1 npx vitest run games/salvor/tests/title-sheet.test.ts</code>.</p>
</header>
${rows.join("\n")}
</div>
</body>
</html>
`;
}
