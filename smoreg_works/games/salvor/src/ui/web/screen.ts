import { hexLayout, type HexLayout, type LogLine, type RoomGame, type Ship } from "@jamrog/engine";
import { isTug } from "../../content/tug.js";
import { aimedAt, codexSeen, codexView, listOf, type AppState } from "../appstate.js";
import {
  codexBody,
  codexFooter,
  codexHeading,
  helpFooter,
  helpHeadings,
  helpPages,
  keyHelp,
} from "../input.js";
import { titleScreen, type TitleItem } from "../title.js";
import { HISTORY_ROWS, historyPages, logFades, logText, opensTurn } from "../logline.js";
import { codexBadge, debugBlockLines, footBlocks, panelBlocks, type PanelLine } from "../panel.js";
import { NOTHING_LIT, type Lit } from "../pulse.js";
import { cardTitles, endHint, endingBanners, historyFooter, latestAlarm, restartHint, runSummary } from "../render.js";
import { bannerLine, schematicInputOf } from "../schematic-input.js";
import { THEME } from "../theme.js";
import { tugBoard } from "../tugboard.js";
import { codexHtml, debugHtml, exposeHtml, htmlOf } from "./panel-html.js";
import { hullArtOf } from "../../content/hulls-art.js";
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

// Which lines stay at full strength is decided by the turn they were written
// on and not by their place in the tail (`ui/logline.ts`, `logFades`). The
// count that used to live here was three, in this file and in the terminal
// renderer, and three is not a unit of anything the game does.

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
  debug = false,
  hull = true,
  tiles = false,
): string {
  const overlay = state.overlay;
  if (overlay === "crash") return card("bad", crashCard(state));
  if (overlay === "title") return card("title", titleCard(state));

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
    `<div class="web-map">${mapHtml(game, state, lit, map, hull, tiles)}</div>`,
    // The two marks laid over the map: what the next blow lands on, bottom
    // left, and what there is to read about, top left (G72).
    codexHtml(codexBadge(game)),
    exposeHtml(blocks, flash, lit.ids),
    `<div class="web-panel">${htmlOf(body, foot, actions, state.cursor, flash, lit.ids)}</div>`,
    `<div class="web-log">${logHtml(game.log.tail(LOG_LINES))}</div>`,
    // The debug overlay (G68): the owner's flag, drawn under the log and
    // nowhere else — `debugHtml` already answers "" when it is off.
    debugHtml(debugBlockLines(game, debug)),
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
function mapHtml(
  game: RoomGame,
  state: AppState,
  lit: Lit,
  map: MapKind,
  hull: boolean,
  tiles: boolean,
): string {
  if (isTug(game)) return `<pre class="web-board">${tugBoard(game).map(esc).join("\n")}</pre>`;
  const input = schematicInputOf(game, lit.rooms, aimedAt(game, state));
  // The hull under the honeycomb is dressed by the ship's own class stamp and
  // seeded by its store id (G81), and the honeycomb is grown inside the hull's
  // own profile (G82): the cells that fit the profile are the mask the layout
  // is held to. `?hull=0` hands over nothing — no hull and no mask — and the
  // drawing is then what it was before there was a hull.
  if (map === "hex") {
    const art = hull ? hullArtOf(game.ship, game.shipId) : undefined;
    return hexSvgOf(input, layoutOf(game.ship, art?.mask), bannerLine(game), art, tiles);
  }
  // `?tiles=1` is a modifier on whichever drawing is up, not a view of its own:
  // `V` keeps walking the same three (docs/tiles-design.md, 3).
  return svgOf(input, bannerLine(game), tiles);
}

/**
 * The honeycomb of a ship, kept between frames.
 *
 * `hexLayout` is a pure function of the graph and the mask, and the graph of
 * a ship never changes once it is built — so the answer is the same on every
 * frame and is worked out once. Free of a mask it was always cheap; inside
 * one it is a search, and a search per frame is not a price a keypress
 * should pay. Keyed by the ship object itself, so two ships that happen to
 * share a store id in a test cannot be given each other's deck.
 */
const LAYOUTS = new WeakMap<Ship, { mask: ReadonlySet<string> | undefined; layout: HexLayout }>();

function layoutOf(ship: Ship, mask: ReadonlySet<string> | undefined): HexLayout {
  const kept = LAYOUTS.get(ship);
  if (kept !== undefined && kept.mask === mask) return kept.layout;
  const layout = hexLayout(ship, { allowed: mask });
  LAYOUTS.set(ship, { mask, layout });
  return layout;
}

/** The class the root element carries. Exported so the shell and the CSS agree. */
export { WEB_ROOT_CLASS };

// -------------------------------------------------------------------- the log

/**
 * The tail, newest last. An alarm line never fades, and the newest of them
 * carries `live` — the whole row on a red ground, as the terminal draws it
 * (`ui/render.ts`, `drawLog`); the honeycomb shares this very HTML.
 */
function logHtml(lines: readonly LogLine[]): string {
  const fades = logFades(lines);
  const alarm = latestAlarm(lines);
  return lines
    .map((line, i) => {
      const fade = fades[i]!;
      const faded = fade === "fresh" ? "" : ` ${fade}`;
      // The newest alarm line is the loud one: the whole row on a red ground,
      // as the terminal draws it (`ui/render.ts`, `drawLog`). Older alarms keep
      // their red ink — `logFades` never fades the tone — and lose the ground.
      const live = line.tone === "alarm" && i === alarm ? " live" : "";
      // Air where one turn ends and the next begins — four pixels, which the
      // terminal cannot spend and a page can. It is the same statement the
      // fading makes, in the one channel a colour-blind reader still has.
      const gap = opensTurn(lines, i) ? " turn-gap" : "";
      const repeat = line.count > 1 ? ` (x${line.count})` : "";
      return `<div class="${line.tone}${faded}${live}${gap}">${esc(logText(line) + repeat)}</div>`;
    })
    .join("");
}

// --------------------------------------------------------------- the overlays

function overlayHtml(game: RoomGame, state: AppState): string {
  if (state.overlay === "help") return card("", helpCard(game, state.helpPage));
  if (state.overlay === "codex") return card("", codexCard(game, state));
  if (state.overlay === "history") return card("", historyCard(game, state.logPage));
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
 * The start screen, as panels.
 *
 * The same value the terminal lays out in a frame and columns (`ui/title.ts`),
 * given the one thing a page has that a grid does not: type sizes and a table.
 * The name is large because a heading can be, the menu is a real three-column
 * table so the keys line up without padding, and the ring rows mark what they
 * are on with a class rather than with a bright cell. Not one word of it is
 * written here — every string came out of `titleScreen` (G84).
 */
function titleCard(state: AppState): string[] {
  const screen = titleScreen(state.settings, state.seedText);
  return [
    `<div class="title-name">${esc(screen.name)}</div>`,
    `<div class="title-tag">${esc(screen.tagline)}</div>`,
    `<div class="head">${esc(screen.menuHead)}</div>`,
    `<div class="title-menu">${screen.items.map((item, i) => titleItemHtml(item, i, state.cursor)).join("")}</div>`,
    ...screen.hints.map((line) => `<div class="hint">${esc(line)}</div>`),
    `<div class="head">${esc(screen.keysHead)}</div>`,
    ...screen.keys.map((line) => `<div class="keys">${esc(line)}</div>`),
    `<div class="title-foot">${esc(screen.foot)}</div>`,
  ];
}

/**
 * One row of the menu, and the one attribute that makes the screen usable with
 * a mouse.
 *
 * `data-line` is what the page's click handler looks for (`ui/web/mount.ts`),
 * and the start screen shipped without it: the owner plays the graphic view
 * with a mouse, so for him there was no start screen at all — seven rows he
 * could read and none he could press. The index is the row's place in the menu,
 * never the digit it wears, which is exactly the distinction the action list
 * already draws (`ui/input.ts`, `line` versus `pick`): three of these rows wear
 * a letter and no digit at all.
 */
function titleItemHtml(item: TitleItem, index: number, cursor: number): string {
  // The highlight the arrows move and `Enter` does, drawn the way the action
  // list draws its own (`ui/web/panel-html.ts`, `is-cursor`): the start screen
  // was the one screen with no lit line at all (G86, 11).
  const lit = index === cursor ? " is-cursor" : "";
  return [
    `<div class="title-row${lit}" data-line="${index}">`,
    `<span class="title-key">${esc(item.key)}</span>`,
    `<span class="title-label">${esc(item.label)}</span>`,
    `<span class="title-value">${titleValueHtml(item)}</span>`,
    `</div>`,
  ].join("");
}

function titleValueHtml(item: TitleItem): string {
  if (!item.options) return esc(item.value ?? "");
  return item.options
    .map((o) => `<span class="${o.on ? "title-on" : "title-off"}">${esc(o.text)}</span>`)
    .join(`<span class="title-off"> · </span>`);
}

/**
 * The help card. `helpBody` is the whole of it, and the three colours are the
 * three the terminal uses: a heading, the key table, and prose.
 */
function helpCard(game: RoomGame, page: number): string[] {
  const headings = helpHeadings();
  const keys = keyHelp();
  const pages = helpPages(isTug(game), codexSeen(game));
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

/**
 * The `i` card: what is going on here, in the same three colours the help card
 * uses and out of the same two functions the terminal draws it from.
 */
function codexCard(game: RoomGame, state: AppState): string[] {
  const view = codexView(game, state);
  if (view === undefined) return [];
  const body = codexBody(view.entry, view.fitted).map((line) =>
    line.length === 0 ? "<div class=\"prose\">&nbsp;</div>" : `<div class="prose">${esc(line)}</div>`,
  );
  return [
    `<div class="h">${esc(codexHeading(view.entry))}</div>`,
    ...body,
    `<div class="hint">${esc(codexFooter(view.page, view.pages))}</div>`,
  ];
}

/**
 * The message log as a card: the same pages the terminal draws, in the same
 * order, so `PageUp` shows one screen and not two different ones.
 */
function historyCard(game: RoomGame, page: number): string[] {
  const pages = historyPages(game.log.lines, HISTORY_ROWS);
  const at = Math.min(page, pages.length - 1);
  const body = (pages[at] ?? []).map((line) => `<div class="keys">${esc(line)}</div>`);
  return [
    `<div class="h">${esc(cardTitles().history)}</div>`,
    ...body,
    `<div class="prose">${esc(historyFooter(at, pages.length))}</div>`,
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
