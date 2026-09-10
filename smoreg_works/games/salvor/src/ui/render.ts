import * as ROT from "rot-js";
import type { LogLine, RoomGame } from "@jamrog/engine";
import { isTug } from "../content/tug.js";
import { t } from "../i18n.js";
import { rigOf } from "../twist/rig.js";
import { voyageProgress, voyageRecord } from "../systems/voyage.js";
import {
  codexBody,
  codexFooter,
  codexHeading,
  helpFooter,
  helpHeadings,
  helpPages,
  keyHelp,
} from "./input.js";
import {
  DEFAULT_TITLE,
  KEY_W,
  LABEL_W,
  itemMark,
  itemText,
  titleScreen,
  type TitleScreen,
} from "./title.js";
import { HISTORY_ROWS, historyPages, logFades, logText, type LogFade } from "./logline.js";
import {
  NO_FLASH,
  PANEL_WIDTH,
  codexBadge,
  panelBlocks,
  panelColour,
  rackIntegrity,
  trackFlash,
  type Flash,
} from "./panel.js";
import { NOTHING_LIT, type Lit } from "./pulse.js";
import { schematic, type SchematicLine } from "./schematic.js";
import { BANNER_WIDTH, bannerLine, schematicInputOf } from "./schematic-input.js";
import { LAYOUT, SCREEN_HEIGHT, SCREEN_WIDTH, THEME } from "./theme.js";
import { tugBoard } from "./tugboard.js";
import { aimedAt, codexSeen, codexView, listOf, type AppState, type Overlay } from "./appstate.js";

/**
 * The only file in the game that talks to a display.
 *
 * Everything it draws was decided somewhere else and handed over as text:
 * `schematic()` returns lines and colour spans, `panelBlocks()` returns lines,
 * the log is lines. So the renderer has no rules of its own to get wrong, and
 * the rules it draws are all under test without a browser (task G20).
 *
 * It writes cell by cell rather than through rot.js's `%c{}` markup, because
 * the schematic and the panel both carry glyphs a formatter would try to read:
 * `%` is a pile of scrap in this game, and a room holding one must not be able
 * to swallow the rest of its own line.
 */

/**
 * Air between a card's longest line and its frame, and between its first and
 * last line and the frame's own rows. Every overlay is drawn to these, so
 * "does the help card fit on the screen" is arithmetic a test can do.
 */
export const BOX_PAD_X = 6;

/** A card's frame, and the text width left inside it. */
export interface BoxSize {
  readonly width: number;
  readonly height: number;
  /** Columns a line may use before it is clipped. */
  readonly inner: number;
}

function boxFor(lines: readonly string[], extraRows: number): BoxSize {
  const width = lines.reduce((m, s) => Math.max(m, s.length), 0) + BOX_PAD_X;
  return { width, height: lines.length + extraRows, inner: width - 4 };
}

/**
 * Everything the help card shows, in the order it shows it: where you are
 * standing and what to do about it, then the keys, the rule the twist is, what
 * the numbered list is, and what a charter is. One page and no scrolling — a
 * card a voter has to page through is a card they close (design-doc.md,
 * "Обучение конструкцией").
 *
 * The first block is the only one that changes, and it is first because it is
 * the question `?` was pressed to ask.
 */
export function helpBody(onTug: boolean, seen: readonly string[] = []): string[] {
  return helpPages(onTug, seen).flatMap((page, i) => (i === 0 ? page : ["", ...page]));
}

/**
 * The help card: a heading row, a blank one, the tallest page, a blank one, the
 * footer, and the frame.
 *
 * One size for every page, taken from the tallest and the widest of them, so
 * the card does not resize under the reader's hands when `?` turns the page.
 */
export function helpBox(onTug: boolean, seen: readonly string[] = []): BoxSize {
  const pages = helpPages(onTug, seen);
  const rows = pages.reduce((n, page) => Math.max(n, page.length), 0);
  return { ...boxFor(pages.flat(), 0), height: rows + 6 };
}

/**
 * The `i` card, sized the way the help card is: a heading row, a blank one, the
 * body, a blank one, the footer, and the frame.
 *
 * The same six rows of furniture and the same padding, because it is the same
 * window — the owner asked for the card to be "тот же оверлей, что справка на
 * `?`", and a second card with a frame of its own would be a second thing to
 * keep on the screen when the screen grows.
 */
export function codexBox(heading: string, body: readonly string[], footer: string): BoxSize {
  const lines = [heading, ...body, footer];
  return { ...boxFor(lines, 0), height: body.length + 6 };
}

/** What a row of the terminal's title is, so the renderer can colour it. */
export type TitleRole = "name" | "tagline" | "head" | "menu" | "hint" | "keys" | "foot" | "blank";

export interface TitleRow {
  readonly role: TitleRole;
  readonly text: string;
  /**
   * The option a ring row is currently on — `RU`, `honeycomb` — so the frame
   * can light it without knowing what a language or a view is.
   */
  readonly mark?: string;
}

const BLANK: TitleRow = { role: "blank", text: "" };

/**
 * The title screen, laid out for a terminal: a frame, a name in block letters,
 * and a menu in columns (`ui/title.ts` decides what it says).
 *
 * Rows rather than a draw call, for the same reason the schematic and the panel
 * are rows: the layout is then arithmetic a test can do, so "does the Spanish
 * menu fit ninety-five columns" is a number and not a screenshot.
 */
export function titleRows(screen: TitleScreen): TitleRow[] {
  const body: TitleRow[] = [
    ...nameBanner(screen.name).map((text) => ({ role: "name" as const, text })),
    BLANK,
    { role: "tagline", text: screen.tagline },
    BLANK,
    { role: "head", text: screen.menuHead },
    ...screen.items.map((item) => ({ role: "menu" as const, text: itemText(item), mark: itemMark(item) })),
    BLANK,
    ...screen.hints.map((text) => ({ role: "hint" as const, text })),
    BLANK,
    { role: "head", text: screen.keysHead },
    ...screen.keys.map((text) => ({ role: "keys" as const, text })),
    BLANK,
    { role: "foot", text: screen.foot },
  ];
  // The two headings rule off to whatever the widest row turned out to be, so
  // a long translation widens the frame instead of poking out of it.
  const width = body.reduce((m, row) => Math.max(m, row.text.length), 0);
  return body.map((row) => (row.role === "head" ? { ...row, text: ruledOff(row.text, width) } : row));
}

function ruledOff(head: string, width: number): string {
  const dashes = width - head.length - 1;
  return dashes > 0 ? `${head} ${"─".repeat(dashes)}` : head;
}

/** The title's frame, measured off its own rows. One row of air top and bottom. */
export function titleBox(screen: TitleScreen = titleScreen(DEFAULT_TITLE)): BoxSize {
  return boxFor(titleRows(screen).map((row) => row.text), 2);
}

/** Rows that sit in the middle of the frame rather than against its left pad. */
const CENTRED: ReadonlySet<TitleRole> = new Set<TitleRole>(["name", "tagline", "foot"]);

function titleColour(role: TitleRole): string {
  if (role === "name" || role === "hint") return THEME.accent;
  if (role === "head") return THEME.zone;
  if (role === "keys") return THEME.soft;
  if (role === "foot") return THEME.fgDim;
  return THEME.fg;
}

/**
 * `SALVOR` in block letters, five rows tall.
 *
 * The owner asked for the name «крупно», and a terminal has one way to be
 * large: spend rows on it. A name with a letter this table has no block for
 * falls back to the plain string — the game is called SALVOR in all three
 * languages (`content/i18n`), and a fourth that renames it should get a small
 * title rather than a broken one.
 */
export function nameBanner(name: string): string[] {
  const glyphs = [...name.toUpperCase()].map((ch) => BLOCK_LETTERS[ch]);
  if (glyphs.some((g) => g === undefined)) return [name];
  const rows: string[] = [];
  for (let y = 0; y < BLOCK_HEIGHT; y++) rows.push(glyphs.map((g) => g![y]!).join(" "));
  return rows;
}

const BLOCK_HEIGHT = 5;

/**
 * Five rows of five columns per letter, and only the letters the name needs.
 *
 * A full alphabet would be forty rows of art nothing draws; the fallback above
 * is what covers everything else.
 */
const BLOCK_LETTERS: Record<string, readonly string[] | undefined> = {
  S: ["█████", "█    ", "█████", "    █", "█████"],
  A: ["█████", "█   █", "█████", "█   █", "█   █"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  O: ["█████", "█   █", "█   █", "█   █", "█████"],
  R: ["█████", "█   █", "█████", "█  █ ", "█   █"],
  " ": ["     ", "     ", "     ", "     ", "     "],
};

/**
 * The four endings, as the word written across the screen, the sentence under
 * it and the colour both are set in.
 *
 * One table rather than four literals at the call site because the graphic view
 * (G42) draws the same four banners, and both have to say the same words — in
 * whichever language is on, which is why it is read per frame.
 *
 * Two of the four were lying, and a sweep of 869 lost runs found every one of
 * them saying so (docs/tasks/G55-playtest-findings.md, 1 and 2). `dead` said
 * CORE BREACH: the drone's core does not end a run at all, and the one
 * `finish("dead")` in the game is the account going under the price of a hull
 * (`systems/voyage.ts`, `endIfBroke`) — so every loss in the game was announced
 * as something that had not happened. `won` said OUT WITH THE HOLD, which is
 * one sortie coming home; winning is the father's tug under tow, the end of the
 * voyage, and it now says that. `why` is the sentence neither of them had.
 */
export function endingBanners(): Partial<Record<Overlay, { title: string; fg: string; why?: string }>> {
  return {
    dead: { title: t("end.dead"), fg: THEME.bad, why: t("end.dead.why") },
    lost: { title: t("end.lost"), fg: THEME.bad },
    won: { title: t("end.won"), fg: THEME.good, why: t("end.won.why") },
    sold: { title: t("end.sold"), fg: THEME.good },
  };
}

/** The one line under a run that is over, and under the error card. */
export function restartHint(): string {
  return t("end.again");
}

/**
 * Overlays that end the run. The other two cards — a hull under tow, a drone
 * that did not come back — are things that happen *during* one, and telling
 * them apart is the whole of this set.
 *
 * They were not told apart, and the owner pressed what the card told him to:
 * selling a hull raised a green banner, the run's own figures and the line
 * `shift+R for a new run`, which is how a success in the middle of a voyage
 * came to read as the end of it ("почему новая сессия везде, даже после победы
 * в получение корабля").
 */
const RUN_OVER: ReadonlySet<Overlay> = new Set<Overlay>(["dead", "won"]);

/** What to press: a new run when this one is over, any key when it is not. */
export function endHint(overlay: Overlay): string {
  return RUN_OVER.has(overlay) ? t("end.again") : t("end.go");
}

/** The two cards that are not an ending, by the word across the top of each. */
export function cardTitles(): { help: string; crash: string; history: string } {
  return { help: t("help.title"), crash: t("crash.title"), history: t("log.title") };
}

/**
 * A log line's colour once its age is taken into account.
 *
 * Three steps and not two, because the middle one is the point: `soft` is the
 * turn just gone, still legible and plainly not now, and `fgDim` is everything
 * the player has had time to read. The terminal has no other way to say it —
 * there are no spare rows for the blank line the graphic view puts between
 * turns.
 */
function fadedTo(colour: string, fade: LogFade): string {
  if (fade === "fresh") return colour;
  return fade === "recent" ? THEME.soft : THEME.fgDim;
}

/**
 * The history card's frame: as much of the screen as it can have.
 *
 * Fixed rather than measured off the lines it holds, unlike every other card
 * here. The log is whatever the run wrote into it, so a box that fitted itself
 * to the text would change width on every page and between one run and the
 * next; a player paging back through forty lines is reading a column, and a
 * column that moves is one they have to find again.
 */
export function historyBox(): BoxSize {
  const width = SCREEN_WIDTH - 4;
  return { width, height: HISTORY_ROWS + 6, inner: width - 4 };
}

/** The line under the history card: which page, and which key turns it. */
export function historyFooter(page: number, pages: number): string {
  return t("log.page", { n: page + 1, of: pages });
}

/** Where the panel starts: one column of gutter past the schematic. */
const PANEL_X = LAYOUT.mapWidth + 1;

export class Renderer {
  readonly display: ROT.Display;

  /**
   * The panel's memory between frames, so a module that just took a blow can
   * flash. Kept here and not in the rig: which frame a line turns red is a
   * rendering question, and the sim must not grow a concept of frames.
   */
  private flash: Flash = NO_FLASH;

  constructor(mount: HTMLElement, fontSize: number = LAYOUT.fontSize) {
    this.display = new ROT.Display({
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
      fontSize,
      fontFamily: "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
      forceSquareRatio: true,
      bg: THEME.bg,
      fg: THEME.fg,
    });
    const container = this.display.getContainer();
    if (container) mount.appendChild(container);
  }

  /**
   * `lit` is what the appearance pulse is flashing on this frame and nothing
   * else about the run (`ui/pulse.ts`). It is a parameter rather than something
   * this class remembers because it is timed to the music rather than to the
   * turn: the app owns the clock, both renderers only paint what it resolved.
   */
  draw(game: RoomGame, state: AppState, lit: Lit = NOTHING_LIT): void {
    const overlay = state.overlay;
    // First, and without touching the game: whatever broke may well be the
    // ship, the panel or the rig, and the one frame that has to render is this
    // one. An error screen that throws is worse than no error screen.
    if (overlay === "crash" && state.crash) {
      this.display.clear();
      this.drawCrash(state.crash);
      return;
    }
    this.flash = trackFlash(this.flash, rackIntegrity(game.player), game.schedule.time);
    this.display.clear();
    // The title is the whole screen: a derelict nobody has boarded yet.
    if (overlay === "title") {
      this.drawTitle(state);
      return;
    }
    if (isTug(game)) this.drawBoard(game);
    else this.drawSchematic(game, state, lit);
    this.drawPanel(game, state, lit);
    this.drawLog(game);
    if (overlay === "help") this.drawHelp(game, state.helpPage);
    if (overlay === "codex") this.drawCodex(game, state);
    if (overlay === "history") this.drawHistory(game, state.logPage);
    const ending = endingBanners()[overlay];
    if (ending) this.drawBanner(ending.title, ending.why, runSummary(game), ending.fg, endHint(overlay));
  }

  /**
   * The ship, as `ui/schematic.ts` drew it: text plus runs of colour, with the
   * banner written across its empty top row.
   *
   * Row zero belongs to nothing else — the boxes start at row one
   * (design-doc.md, "Экран": `y = 1 + 5·row`) — and the banner stops short of
   * the hull line down the right edge. So it is the one thing that could be
   * added to this screen without taking a row away from something.
   */
  private drawSchematic(game: RoomGame, state: AppState, lit: Lit): void {
    const { lines } = schematic(schematicInputOf(game, lit.rooms, aimedAt(game, state)));
    lines.forEach((line, y) => {
      if (y >= LAYOUT.mapHeight) return;
      this.putSpans(y, line);
    });
    const gap = this.drawBadge(game);
    this.putLine(gap, 0, clamp(bannerLine(game), BANNER_WIDTH - gap), THEME.accent);
  }

  /**
   * `[i] 2` in the top-left corner of the map, and how many columns it took.
   *
   * The corner is the owner's — «сверху слева значок информации и хоткей» — and
   * row zero is the one row on this screen that belongs to nothing: the boxes
   * start at row one (design-doc.md, "Экран"). The banner shares the row and
   * moves right by whatever the badge used, so the two can never overprint each
   * other and neither of them costs the picture a line.
   *
   * Nothing drawn and no columns taken when the run has nothing unread, which
   * is what keeps a quiet sortie's screen exactly as it was.
   */
  private drawBadge(game: RoomGame): number {
    const badge = codexBadge(game);
    if (badge === undefined) return 0;
    this.putLine(0, 0, badge, THEME.warn);
    return badge.length + 1;
  }

  /**
   * The tug's own window: no boxes, no doors, no drone anywhere on it
   * (`ui/tugboard.ts`). Two rows down from the top so the first line of it
   * lands where the banner's does aboard a hull, and the eye finds the same
   * answer in the same place either way.
   */
  private drawBoard(game: RoomGame): void {
    // The badge stands in the same corner at home as it does aboard a hull: a
    // relic bought at the dock and a strain the bench has not cleaned are both
    // things to read about, and both are read standing here.
    const gap = this.drawBadge(game);
    tugBoard(game).forEach((line, i) => {
      const y = i;
      if (y >= LAYOUT.mapHeight) return;
      const fg = i === 0 ? THEME.accent : line.startsWith(" ") ? THEME.fg : THEME.zone;
      const x = i === 0 ? gap : 0;
      this.putLine(x, y, clamp(line, LAYOUT.mapWidth - x), fg);
    });
  }

  private putSpans(y: number, line: SchematicLine): void {
    const colours = new Array<string>(line.text.length).fill(THEME.fgDim);
    for (const span of line.spans ?? []) {
      for (let x = span.from; x < span.to && x < colours.length; x++) colours[x] = span.fg;
    }
    for (let x = 0; x < line.text.length && x < LAYOUT.mapWidth; x++) {
      const ch = line.text[x]!;
      if (ch !== " ") this.display.draw(x, y, ch, colours[x]!, null);
    }
  }

  private drawPanel(game: RoomGame, state: AppState, lit: Lit): void {
    // `listOf` is the two levels the list has: where the drone can walk, or
    // one bulkhead's own methods, instead of the compartment's own actions.
    // Same block, same rows, same renderer — that is what keeps both of them
    // out of a window.
    const lines = panelBlocks(game, listOf(game, state), state.cursor);
    lines.forEach((line, y) => {
      if (y >= LAYOUT.mapHeight) return;
      this.putLine(PANEL_X, y, line.text, panelColour(line, this.flash.slots, lit.ids));
    });
  }

  private drawLog(game: RoomGame): void {
    const y0 = LAYOUT.mapHeight + 1;
    for (let x = 0; x < SCREEN_WIDTH; x++) this.display.draw(x, LAYOUT.mapHeight, "─", THEME.fgDim, null);

    const lines = game.log.tail(LAYOUT.logHeight);
    // Which lines are still bright is a question about turns, not about how
    // many lines happen to be on the screen (`ui/logline.ts`, `logFades`).
    const fades = logFades(lines);
    const alarm = latestAlarm(lines);
    lines.forEach((l, i) => {
      const suffix = l.count > 1 ? ` (x${l.count})` : "";
      const text = clamp(`${logText(l)}${suffix}`, SCREEN_WIDTH - 2);
      // The alarm tone: the whole row on a red ground for the newest one, and
      // red ink that never fades for the ones before it — a danger the
      // player has not read must not grey out with the turn
      // (`packages/engine/src/sim/log.ts`). Read means a newer alarm, or the
      // codex key (docs/tasks/G72-codex.md); this only draws.
      if (l.tone === "alarm") {
        if (i === alarm) this.putLine(1, y0 + i, text.padEnd(SCREEN_WIDTH - 2), THEME.bright, THEME.bad);
        else this.putLine(1, y0 + i, text, THEME.bad);
        return;
      }
      const colour =
        l.tone === "good" ? THEME.good : l.tone === "bad" ? THEME.bad : l.tone === "warn" ? THEME.warn : THEME.fg;
      const fade = fadedTo(colour, fades[i]!);
      this.putLine(1, y0 + i, text, fade);
    });
  }

  /**
   * The start screen, on an otherwise empty terminal.
   *
   * A loop over `titleRows` rather than a row-by-row script, because the screen
   * is now a menu and a menu is a list: a row added to `ui/title.ts` appears
   * here without this file being told, and the frame measures itself off
   * whatever the rows came out as (G84).
   */
  private drawTitle(state: AppState): void {
    const screen = titleScreen(state.settings, state.seedText);
    const rows = titleRows(screen);
    const { width: w, height: h } = titleBox(screen);
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);
    rows.forEach((row, i) => this.drawTitleRow(row, x0 + 3, y0 + 1 + i, w - 6));
  }

  /**
   * One row of the start screen: its own colour, its key glyph in the accent,
   * and the ring option it is on lit up.
   *
   * The mark is found in the row's own text rather than measured out, so the
   * one thing this method knows about a language or a view is that it is a
   * string somewhere to the right of the label column.
   */
  private drawTitleRow(row: TitleRow, x: number, y: number, w: number): void {
    if (row.role === "blank") return;
    const at = CENTRED.has(row.role) ? x + ((w - row.text.length) >> 1) : x;
    this.putLine(at, y, row.text, titleColour(row.role));
    if (row.role === "menu") this.putLine(at, y, row.text.slice(0, 1), THEME.accent);
    if (row.mark === undefined) return;
    const found = row.text.indexOf(row.mark, KEY_W + LABEL_W);
    if (found >= 0) this.putLine(at + found, y, row.mark, THEME.bright);
  }

  private drawHelp(game: RoomGame, page: number): void {
    const onTug = isTug(game);
    const seen = codexSeen(game);
    const pages = helpPages(onTug, seen);
    const body = pages[Math.min(page, pages.length - 1)] ?? [];
    const { width: w, height: h, inner } = helpBox(onTug, seen);
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);
    this.putLine(x0 + 2, y0 + 1, cardTitles().help, THEME.accent);
    // The footer sits on the card's last row whatever the page holds, for the
    // reason the panel's own keys do: a row that moves is a row to find again.
    this.putLine(x0 + 2, y0 + h - 2, clamp(helpFooter(page, pages.length), inner), THEME.fgDim);
    body.forEach((s, i) => {
      // Blocks of prose around the keys, each with its own heading: where you
      // are, the rule, the list, the contract. The heading is the line a reader
      // scans for; the key table is the one block set in the reading colour.
      const fg = helpHeadings().includes(s)
        ? THEME.accent
        : keyHelp().includes(s)
          ? THEME.fg
          : THEME.zone;
      this.putLine(x0 + 2, y0 + 3 + i, clamp(s, inner), fg);
    });
  }

  /**
   * What is going on here, in a card in front of the board.
   *
   * Every word of it was decided in `ui/input.ts` and every line was already
   * broken there, so this only puts the text in a frame — the same contract
   * the rest of this file keeps.
   */
  private drawCodex(game: RoomGame, state: AppState): void {
    const view = codexView(game, state);
    if (view === undefined) return;
    const heading = codexHeading(view.entry);
    const body = codexBody(view.entry, view.fitted);
    const footer = codexFooter(view.page, view.pages);
    const { width: w, height: h, inner } = codexBox(heading, body, footer);
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);
    this.putLine(x0 + 2, y0 + 1, clamp(heading, inner), THEME.accent);
    this.putLine(x0 + 2, y0 + h - 2, clamp(footer, inner), THEME.fgDim);
    body.forEach((line, i) => {
      this.putLine(x0 + 2, y0 + 3 + i, clamp(line, inner), THEME.fg);
    });
  }

  /**
   * The message log, all of it, as a card the same machinery draws the help
   * card with — the overlay was already there, and history is a page of text
   * (docs/gui-guides.md, "Что применить", B).
   *
   * The newest page first, so the card opens where the log itself is standing.
   */
  private drawHistory(game: RoomGame, page: number): void {
    const pages = historyPages(game.log.lines, HISTORY_ROWS);
    const at = Math.min(page, pages.length - 1);
    const body = pages[at] ?? [];
    const { width: w, height: h, inner } = historyBox();
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);
    this.putLine(x0 + 2, y0 + 1, cardTitles().history, THEME.accent);
    this.putLine(x0 + 2, y0 + h - 2, clamp(historyFooter(at, pages.length), inner), THEME.fgDim);
    // Every line in one colour: the card is read as a transcript, and the tone
    // of a line thirty turns back is no longer news about anything.
    body.forEach((s, i) => this.putLine(x0 + 2, y0 + 3 + i, clamp(s, inner), THEME.fg));
  }

  private drawBanner(
    title: string,
    why: string | undefined,
    sub: string,
    colour: string,
    hint: string,
  ): void {
    const body = why === undefined ? [sub] : [why, sub];
    const w = Math.max(title.length, hint.length, ...body.map((s) => s.length)) + 6;
    const h = body.length + 6;
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);
    this.putLine(x0 + 3, y0 + 1, title, colour);
    body.forEach((line, i) => {
      this.putLine(x0 + 3, y0 + 3 + i, line, i === body.length - 1 ? THEME.fg : colour);
    });
    this.putLine(x0 + 3, y0 + h - 2, hint, THEME.fgDim);
  }

  /**
   * The run hit an exception. The screen's only job now is to get the seed
   * back to whoever can fix it, so the URL is the biggest thing on it — a
   * voter who can paste one line is worth more than a stack trace they cannot.
   */
  private drawCrash(body: readonly string[]): void {
    const title = cardTitles().crash;
    const hint = restartHint();
    // The URL and the error line are the two that can run long: clamp the box
    // to the screen first, then the text to the box.
    const w = Math.min(SCREEN_WIDTH - 4, Math.max(title.length, hint.length, ...body.map((s) => s.length)) + 6);
    const inner = w - 6;
    const h = body.length + 6;
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);

    this.putLine(x0 + 3, y0 + 1, title, THEME.bad);
    body.forEach((line, i) => {
      // The two lines that tell the player what to do get the bright colour;
      // the error text itself is for the report, not for them.
      const fg = i === 3 ? THEME.accent : i === 5 ? THEME.fgDim : THEME.fg;
      this.putLine(x0 + 3, y0 + 3 + i, clamp(line, inner), fg);
    });
    this.putLine(x0 + 3, y0 + h - 2, hint, THEME.fgDim);
  }

  private box(x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const edge = y === y0 || y === y0 + h - 1 || x === x0 || x === x0 + w - 1;
        this.display.draw(x, y, edge ? "·" : " ", THEME.fgDim, THEME.panelBg);
      }
    }
  }

  /** One row of text, cell by cell: no markup, so no glyph can be read as one. */
  private putLine(x0: number, y: number, text: string, fg: string, bg: string | null = null): void {
    for (let i = 0; i < text.length; i++) {
      const x = x0 + i;
      if (x >= SCREEN_WIDTH) return;
      this.display.draw(x, y, text[i]!, fg, bg);
    }
  }
}

/** One line, one row: a line longer than its box would run over the frame. */
function clamp(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
}

/**
 * Index of the newest alarm line in a tail, or -1: the one still on its red
 * ground. Shared with the graphic view, so the two cannot disagree about which
 * line is the loud one.
 */
export function latestAlarm(lines: readonly LogLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.tone === "alarm") return i;
  return -1;
}

/**
 * What the *voyage* amounted to, in the one line every ending shows.
 *
 * Compartments over every derelict the run ever boarded, not the ship under the
 * drone's feet. A run ends standing on the tug — the account is what ends it —
 * so the old reading printed the tug's own four compartments on 840 of 869 lost
 * runs, whatever the voyage had actually swept
 * (docs/tasks/G55-playtest-findings.md, 3). `voyageProgress` is the same count
 * the balance harness scores a run by, and skipping the tug is the whole of
 * what it does differently.
 */
export function runSummary(game: RoomGame): string {
  const burned = rigOf(game.player)?.burnedCount ?? 0;
  // Credits first, because it is the number the run is scored on and the one
  // the card was missing: the owner sold a hull, read `14 compartments · 120
  // turns · 10 machines · 8 modules burned` and asked "п прибыли сколько?".
  // Banked only — what the drone is still carrying is not earned until it is
  // out, which is the whole of the `hint.payout` rule.
  return t("end.summary", {
    cr: voyageRecord(game)?.credits ?? 0,
    rooms: voyageProgress(game),
    turns: game.schedule.time,
    kills: game.kills,
    burned,
  });
}
