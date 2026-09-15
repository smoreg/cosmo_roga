import { hexLayout, type HexLayout, type LogLine, type RoomGame, type Ship } from "@jamrog/engine";
import { derelictNameOf } from "../../content/derelicts.js";
import { isTug } from "../../content/tug.js";
import type { Key } from "../../content/i18n/keys.js";
import { t } from "../../i18n.js";
import { codexSeen, codexView, lessonView, listOf, mapAim, type AppState } from "../appstate.js";
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
import { HISTORY_ROWS, blastLineOf, historyPages, logFades, logText, opensTurn } from "../logline.js";
import { codexBadge, debugBlockLines, footBlocks, panelBlocks, type PanelLine } from "../panel.js";
import { NOTHING_LIT, type Lit } from "../pulse.js";
import {
  cardTitles,
  endHint,
  endingBanners,
  historyFooter,
  latestAlarm,
  restartHint,
  runFigures,
  type RunFigures,
} from "../render.js";
import { hazardsAboard, schematicInputOf, tag } from "../schematic-input.js";
import { THEME } from "../theme.js";
import { cornerHtml, debugHtml, htmlOf } from "./panel-html.js";
import { hullArtOf } from "../../content/hulls-art.js";
import { virusCard } from "../viruscard.js";
import { hexSvgOf } from "./hex-svg.js";
import { esc, svgOf } from "./schematic-svg.js";
import { WEB_ROOT_CLASS } from "./styles.js";
import { dockHtml } from "./dock-html.js";

/**
 * The graphic screen, assembled: the schematic, the panel, the log and whatever
 * card is in front of them.
 *
 * Every word on it comes out of a function the terminal renderer already calls —
 * `panelBlocks`, `listOf`, `helpPages`, `titleScreen`,
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
  // The frame the drone took a blow on: the map's edge goes red and, for anyone
  // who has not asked for less motion, the map shakes once. Aboard only — a
  // module swapped at the tug's bench is a lower number and not a blow.
  const hit = flash.size > 0 && !isTug(game) ? " is-hit" : "";
  // The frame a compartment — or the whole ship — went up on: a white flash
  // and a harder shake, over whatever the map shows now (`systems/alert.ts`).
  const boom = blastThisTurn(game) ? " is-boom" : "";
  return [
    headHtml(game, blocks),
    `<div class="web-map${hit}${boom}">${mapHtml(game, state, lit, map, hull, tiles)}</div>`,
    // Laid over the map's top-left corner: the codex chip (G72), the alert as
    // a ladder and the hazards the drone knows of (G89 A3). The exposed slot is
    // not repeated there — the rack's amber row and the map's own marks say
    // where the next blow goes.
    cornerHtml(codexBadge(game), blocks, hazardsAboard(game)),
    // The lesson's window, over the map's bottom-left corner — the top-left is
    // the alert's (G90 E3). Empty in every run that is not a training one.
    lessonHtml(game, state),
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

function headHtml(game: RoomGame, blocks: readonly PanelLine[]): string {
  // Aboard a named hull the strip says the name large and the class small
  // (3a); the panel's heading packs both into 29 columns with the game's name
  // in front, and is what the strip falls back to at home and on a fixture.
  const name = isTug(game) ? undefined : tag(game, "name");
  const ship = name ?? blocks[0]?.text.trim() ?? "";
  const kind =
    name === undefined
      ? []
      : [derelictNameOf(tag(game, "type")), t("panel.sortie", { n: game.currentShip.visits })];
  // The seed beside the turn: the one number a bug report needs, and the
  // start screen's own word for it.
  const turn = [blocks[1]?.text.trim() ?? "", `${t("title.menu.seed")} ${game.seed}`];
  const cls = kind.filter((part) => part !== undefined).join(" · ");
  return [
    '<div class="web-head">',
    `<span class="ship">${esc(ship)}</span>`,
    cls.length === 0 ? "" : `<span class="cls">${esc(cls)}</span>`,
    `<span class="turn">${esc(turn.join(" · "))}</span>`,
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
  if (isTug(game)) return dockHtml(game);
  // No banner in the drawing: the strip above names the hull and the corner
  // carries its alert, and a banner under the corner box was covered by it.
  const aim = mapAim(game, state);
  const input = schematicInputOf(game, lit.rooms, aim.room, aim.route);
  // The hull under the honeycomb is dressed by the ship's own class stamp and
  // seeded by its store id (G81), and the honeycomb is grown inside the hull's
  // own profile (G82): the cells that fit the profile are the mask the layout
  // is held to. `?hull=0` hands over nothing — no hull and no mask — and the
  // drawing is then what it was before there was a hull.
  if (map === "hex") {
    const art = hull ? hullArtOf(game.ship, game.shipId) : undefined;
    return hexSvgOf(input, layoutOf(game.ship, art?.mask), "", art, tiles);
  }
  // `?tiles=1` is a modifier on whichever drawing is up, not a view of its own:
  // `V` keeps walking the same three (docs/tiles-design.md, 3).
  return svgOf(input, "", tiles);
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

// ------------------------------------------------------------- the lesson (G90 E)

/**
 * The lesson's window: not a card in front of the board but a box in a corner
 * of the map, the way the alert's ladder is, and every word of it out of
 * `lessonView`. The head row carries the tick on the frame a step just closed,
 * the step, the key to press and the fold hint; the instruction sits under it
 * and is gone while the window is folded (`Esc`). The box takes no clicks, so
 * the compartment under it is still pressable.
 */
function lessonHtml(game: RoomGame, state: AppState): string {
  const view = lessonView(game, state);
  if (view === undefined) return "";
  const classes = ["web-lesson"];
  if (view.folded) classes.push("is-folded");
  if (view.done) classes.push("is-done");
  if (view.over) classes.push("is-over");
  return [
    `<div class="${classes.join(" ")}">`,
    `<div class="lh">`,
    view.done ? `<span class="ok">${esc(t("lesson.done"))}</span>` : "",
    `<span class="n">${esc(view.head)}</span>`,
    view.press.length === 0 ? "" : `<span class="k">${esc(view.press)}</span>`,
    `<span class="f">${esc(view.fold)}</span>`,
    `</div>`,
    ...view.lines.map((line) => `<div class="li">${esc(line)}</div>`),
    `</div>`,
  ].join("");
}

// --------------------------------------------------------------- the overlays

function overlayHtml(game: RoomGame, state: AppState): string {
  if (state.overlay === "help") return card("", helpCard(game, state.helpPage));
  if (state.overlay === "codex") return card("", codexCard(game, state));
  if (state.overlay === "virus") return card("bad", virusCardHtml(game));
  if (state.overlay === "history") return card("", historyCard(game, state.logPage));
  const ending = endingBanners(game)[state.overlay];
  if (!ending) return "";
  const tone = ending.fg === THEME.good ? "good" : "bad";
  const figures = runFigures(game);
  return card(tone, [
    `<div class="end">`,
    `<div class="h">${esc(ending.title)}</div>`,
    ...(ending.why === undefined ? [] : [`<div class="sub">${esc(ending.why)}</div>`]),
    // The run's numbers, each large under its own caption: the five
    // `end.summary` writes in one line for the terminal (artboard 1f).
    `<div class="end-figures">${FIGURES.map(([key, caption]) => figureHtml(t(caption), figures[key])).join("")}</div>`,
    `<div class="hint">${esc(endHint(state.overlay))}</div>`,
    `</div>`,
  ]);
}

/** The captions, in the order `end.summary` says the numbers. */
const FIGURES = [
  ["cr", "end.fig.cr"],
  ["sold", "end.fig.sold"],
  ["rooms", "end.fig.rooms"],
  ["turns", "end.fig.turns"],
  ["kills", "end.fig.kills"],
  ["burned", "end.fig.burned"],
] as const satisfies ReadonlyArray<readonly [keyof RunFigures, Key]>;

function figureHtml(caption: string, value: number): string {
  return `<div class="end-figure"><span class="end-caption">${esc(caption)}</span><span class="end-value">${value}</span></div>`;
}

/**
 * The start screen, over the sky.
 *
 * The same value the terminal lays out in a frame and columns (`ui/title.ts`),
 * laid out the way artboard 1a draws it: the name large on the left, the line
 * saying what the game is under it, the menu as framed rows with the key in a
 * chip, the build in the bottom left corner and the controls in the bottom
 * right. The ships behind it are not in this string — they fly on a layer the
 * shell keeps between frames (`ui/web/sky.ts`, `mount.ts`). Not one word of it
 * is written here — every string came out of `titleScreen` (G84); the terminal's
 * `MENU` heading is left to the terminal, where it rules off a column the page
 * frames instead.
 */
function titleCard(state: AppState): string[] {
  const screen = titleScreen(state.settings, state.seedText);
  return [
    `<div class="title-main">`,
    `<div class="title-name">${esc(screen.name)}</div>`,
    `<div class="title-tag">${esc(screen.tagline)}</div>`,
    `<div class="title-menu">${screen.items.map((item, i) => titleItemHtml(item, i, state.cursor)).join("")}</div>`,
    ...screen.hints.map((line) => `<div class="hint">${esc(line)}</div>`),
    `</div>`,
    `<div class="title-bottom">`,
    `<div class="title-foot">${esc(screen.foot)}</div>`,
    `<div class="title-keys"><div class="head">${esc(screen.keysHead)}</div>`,
    ...screen.keys.map((line) => `<div class="keys">${esc(line)}</div>`),
    `</div></div>`,
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
 * The help card. `helpPages` is the whole of it, and the three colours are the
 * three the terminal uses: a heading, the key table, and prose.
 */
function helpCard(game: RoomGame, page: number): string[] {
  const headings = helpHeadings();
  const keys = keyHelp();
  const pages = helpPages(isTug(game), codexSeen(game));
  const body = (pages[Math.min(page, pages.length - 1)] ?? []).map((line) => {
    if (keys.includes(line)) return `<div class="keys">${keyLineHtml(line)}</div>`;
    return `<div class="${headings.includes(line) ? "head" : "prose"}">${esc(line)}</div>`;
  });
  return [
    `<div class="h">${esc(cardTitles().help)}</div>`,
    ...body,
    `<div class="prose">${esc(helpFooter(page, pages.length))}</div>`,
  ];
}

/**
 * One row of the key table with its key in the accent, so the keys read down
 * the card as a column (artboard 1g).
 *
 * The row is `keyHelp`'s — the name padded to its column, a space, then the
 * key and, two spaces on, what it does — and every character of it is kept, so
 * the page and the terminal still break the card into the same pages. A row
 * that does not have that shape is drawn plain rather than cut wrongly.
 */
function keyLineHtml(line: string): string {
  const m = /^(\S.*?\s)(\S.*?)(\s{2,}.*)$/.exec(line);
  if (!m) return esc(line);
  return `${esc(m[1]!)}<span class="press">${esc(m[2]!)}</span>${esc(m[3]!)}`;
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
 * The virus window, laid out as the `i` card is and in the bad tone the panel's
 * virus line is drawn in: the words and their breaks are `ui/viruscard.ts`'s.
 */
function virusCardHtml(game: RoomGame): string[] {
  const view = virusCard(game);
  if (view === undefined) return [];
  const body = view.body.map((line) =>
    line.length === 0 ? "<div class=\"prose\">&nbsp;</div>" : `<div class="prose">${esc(line)}</div>`,
  );
  return [
    `<div class="h">${esc(view.heading)}</div>`,
    ...body,
    `<div class="hint">${esc(view.footer)}</div>`,
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
  // The title is not a card over the board but the whole screen: its ground
  // is left clear so the sky behind it shows (`ui/web/mount.ts`).
  const over = tone === "title" ? "web-over is-title" : "web-over";
  return `<div class="${over}"><div class="${cls}">${body.join("")}</div></div>`;
}

function blastThisTurn(game: RoomGame): boolean {
  return blastLineOf(game) !== undefined;
}
