import { hexLayout, type LogLine, type RoomGame } from "@jamrog/engine";
import { isTug } from "../../content/tug.js";
import { aimedAt, listOf, type AppState } from "../appstate.js";
import { helpFooter, helpHeadings, helpPages, keyHelp, titleLines } from "../input.js";
import { logText } from "../logline.js";
import { footBlocks, panelBlocks, type PanelLine } from "../panel.js";
import { NOTHING_LIT, type Lit } from "../pulse.js";
import { cardTitles, endHint, endingBanners, restartHint, runSummary } from "../render.js";
import { bannerLine, schematicInputOf } from "../schematic-input.js";
import { THEME } from "../theme.js";
import { tugBoard } from "../tugboard.js";
import { exposeHtml, htmlOf } from "./panel-html.js";
import { hexSvgOf } from "./hex-svg.js";
import { esc, svgOf } from "./schematic-svg.js";
import { WEB_ROOT_CLASS } from "./styles.js";

/**
 * The graphic screen, assembled: the schematic, the panel, the log and whatever
 * card is in front of them.
 *
 * Every word on it comes out of a function the terminal renderer already calls —
 * `bannerLine`, `panelBlocks`, `listOf`, `helpBody`, `TITLE_LINES`,
 * `endingBanners`, `runSummary` — and there is not a string of prose in this
 * file. That is deliberate and load-bearing: the two views must not be able to
 * disagree about what the game says, and a localisation pass has one table to
 * translate rather than two.
 *
 * A string, not a tree: the shell hands the result to `innerHTML` once per
 * frame, which is the whole of the DOM this view needs (`mount.ts`).
 */

/** Log lines the graphic view shows. It scrolls, so it can carry more than seven. */
const LOG_LINES = 14;

/** How many trailing lines stay at full strength; the rest fade into history. */
const LOG_FRESH = 3;

/**
 * Which drawing the map half is: the graph of boxes and wires, or the honeycomb
 * deck plan. Everything else on the screen — the panel, the log, the cards — is
 * the same in both, which is the whole reason a third view cost a file and not
 * a fork.
 */
export type MapKind = "graph" | "hex";

export function screenHtml(
  game: RoomGame,
  state: AppState,
  flash: ReadonlySet<number>,
  lit: Lit = NOTHING_LIT,
  map: MapKind = "graph",
): string {
  const overlay = state.overlay;
  if (overlay === "crash") return card("bad", crashCard(state));
  if (overlay === "title") return card("", titleCard());

  const actions = listOf(game, state);
  const blocks = panelBlocks(game, [], state.cursor);
  // Three parts, and the page is told which is which rather than working it out
  // from the shape: the two rows that name the ship, the key row that has to
  // stay in the corner, and everything between them. Guessing that the last
  // block was the key row put the action list at the foot of the panel the
  // moment the two shared one — which is where the owner found it.
  const foot = footBlocks(game);
  const body = blocks.slice(HEAD_ROWS, blocks.length - foot.length);
  return [
    headHtml(blocks),
    `<div class="web-map">${mapHtml(game, state, lit, map)}</div>`,
    exposeHtml(blocks, flash, lit.ids),
    `<div class="web-panel">${htmlOf(body, foot, actions, state.cursor, flash, lit.ids)}</div>`,
    `<div class="web-log">${logHtml(game.log.tail(LOG_LINES))}</div>`,
    overlayHtml(game, state),
  ].join("");
}

/**
 * The panel's first two rows, which are not about this compartment at all.
 *
 * `panelBlocks` opens with the heading naming the ship and the turn counter
 * under it, in that order and on every screen (`headBlocks` in `ui/panel.ts`).
 * On a sidebar 29 columns wide that is where they have to go; given a page,
 * they belong across the top, where the ship's name has room to be read and
 * where they stop costing the panel two of its rows. Sliced rather than
 * re-worded, so there is still one place either line is written.
 */
const HEAD_ROWS = 2;

function headHtml(blocks: readonly PanelLine[]): string {
  const ship = blocks[0]?.text.trim() ?? "";
  const turn = blocks[1]?.text.trim() ?? "";
  return [
    '<div class="web-head">',
    `<span class="ship">${esc(ship)}</span>`,
    `<span class="turn">${esc(turn)}</span>`,
    "</div>",
  ].join("");
}

/**
 * The window: the ship's schematic, or the tug's board when the drone is home.
 *
 * The same choice the terminal renderer makes (`ui/render.ts`), and it has to
 * be the same one: the graphic view is another drawing of the same pure
 * functions, and a view that showed the derelict's map while the panel and the
 * list talked about the tug would be the two-ships confusion this task is named
 * after, in the half of the game the owner plays screenshots in.
 */
function mapHtml(game: RoomGame, state: AppState, lit: Lit, map: MapKind): string {
  if (isTug(game)) return `<pre class="web-board">${tugBoard(game).map(esc).join("\n")}</pre>`;
  const input = schematicInputOf(game, lit.rooms, aimedAt(game, state));
  if (map === "hex") return hexSvgOf(input, hexLayout(game.ship), bannerLine(game));
  return svgOf(input, bannerLine(game));
}

/** The class the root element carries. Exported so the shell and the CSS agree. */
export { WEB_ROOT_CLASS };

// -------------------------------------------------------------------- the log

function logHtml(lines: readonly LogLine[]): string {
  return lines
    .map((line, i) => {
      const faded = i < lines.length - LOG_FRESH ? " faded" : "";
      const repeat = line.count > 1 ? ` (x${line.count})` : "";
      return `<div class="${line.tone}${faded}">${esc(logText(line) + repeat)}</div>`;
    })
    .join("");
}

// --------------------------------------------------------------- the overlays

function overlayHtml(game: RoomGame, state: AppState): string {
  if (state.overlay === "help") return card("", helpCard(game, state.helpPage));
  const ending = endingBanners()[state.overlay];
  if (!ending) return "";
  const tone = ending.fg === THEME.good ? "good" : "bad";
  return card(tone, [
    `<div class="h">${esc(ending.title)}</div>`,
    ...(ending.why === undefined ? [] : [`<div class="sub">${esc(ending.why)}</div>`]),
    `<div class="sub">${esc(runSummary(game))}</div>`,
    `<div class="hint">${esc(endHint(state.overlay))}</div>`,
  ]);
}

/**
 * The title card: the same six lines the terminal spreads over twelve rows, in
 * the same order and with the same air between them.
 */
function titleCard(): string[] {
  const [name, ...rest] = titleLines();
  const pitch = rest.slice(0, 3).map((line) => `<div class="prose">${esc(line)}</div>`);
  return [
    `<div class="h">${esc(name ?? "")}</div>`,
    ...pitch,
    `<div class="sub">${esc(rest[3] ?? "")}</div>`,
    `<div class="hint">${esc(rest[4] ?? "")}</div>`,
  ];
}

/**
 * The help card. `helpBody` is the whole of it, and the three colours are the
 * three the terminal uses: a heading, the key table, and prose.
 */
function helpCard(game: RoomGame, page: number): string[] {
  const headings = helpHeadings();
  const keys = keyHelp();
  const pages = helpPages(isTug(game));
  const body = (pages[Math.min(page, pages.length - 1)] ?? []).map((line) => {
    const cls = headings.includes(line) ? "head" : keys.includes(line) ? "keys" : "prose";
    return `<div class="${cls}">${esc(line)}</div>`;
  });
  return [
    `<div class="h">${esc(cardTitles().help)}</div>`,
    ...body,
    `<div class="prose">${esc(helpFooter(page, pages.length))}</div>`,
  ];
}

/** The error screen: the seed and the URL, which are the whole point of it. */
function crashCard(state: AppState): string[] {
  const body = (state.crash ?? []).map((line) => `<div class="prose">${esc(line)}</div>`);
  return [`<div class="h">${esc(cardTitles().crash)}</div>`, ...body, hint()];
}

function hint(): string {
  return `<div class="hint">${esc(restartHint())}</div>`;
}

function card(tone: string, body: readonly string[]): string {
  const cls = tone.length > 0 ? `card ${tone}` : "card";
  return `<div class="web-over"><div class="${cls}">${body.join("")}</div></div>`;
}
