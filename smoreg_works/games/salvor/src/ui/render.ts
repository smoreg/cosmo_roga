import * as ROT from "rot-js";
import type { RoomGame } from "@jamrog/engine";
import { isTug } from "../content/tug.js";
import { LANGS, currentLang, t } from "../i18n.js";
import { rigOf } from "../twist/rig.js";
import { voyageProgress, voyageRecord } from "../systems/voyage.js";
import { helpFooter, helpHeadings, helpPages, keyHelp, titleLines } from "./input.js";
import { logText } from "./logline.js";
import {
  NO_FLASH,
  PANEL_WIDTH,
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
import { aimedAt, listOf, type AppState, type Overlay } from "./appstate.js";

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
export function helpBody(onTug: boolean): string[] {
  return helpPages(onTug).flatMap((page, i) => (i === 0 ? page : ["", ...page]));
}

/**
 * The help card: a heading row, a blank one, the tallest page, a blank one, the
 * footer, and the frame.
 *
 * One size for every page, taken from the tallest and the widest of them, so
 * the card does not resize under the reader's hands when `?` turns the page.
 */
export function helpBox(onTug: boolean): BoxSize {
  const pages = helpPages(onTug);
  const rows = pages.reduce((n, page) => Math.max(n, page.length), 0);
  return { ...boxFor(pages.flat(), 0), height: rows + 6 };
}

/**
 * The title card. Its height is fixed rather than counted: the six lines are
 * spread over twelve rows with air between them (see `drawTitle`).
 */
export function titleBox(): BoxSize {
  return { ...boxFor(titleLines(), 0), height: 12 };
}

/** The row of the title frame the language ring is written on. */
export const TITLE_LANG_ROW = 9;

/** The last row of the title frame a line is written on. */
export const TITLE_LAST_ROW = 10;

/** `L  EN · ES · RU`, and the prefix before it. Language-neutral by design. */
export const LANG_PREFIX = "L  ";

export function langRow(): string {
  return LANG_PREFIX + LANGS.map((l) => l.toUpperCase()).join(" · ");
}

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
export function cardTitles(): { help: string; crash: string } {
  return { help: t("help.title"), crash: t("crash.title") };
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
      this.drawTitle();
      return;
    }
    if (isTug(game)) this.drawBoard(game);
    else this.drawSchematic(game, state, lit);
    this.drawPanel(game, state, lit);
    this.drawLog(game);
    if (overlay === "help") this.drawHelp(game, state.helpPage);
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
    this.putLine(0, 0, clamp(bannerLine(game), BANNER_WIDTH), THEME.accent);
  }

  /**
   * The tug's own window: no boxes, no doors, no drone anywhere on it
   * (`ui/tugboard.ts`). Two rows down from the top so the first line of it
   * lands where the banner's does aboard a hull, and the eye finds the same
   * answer in the same place either way.
   */
  private drawBoard(game: RoomGame): void {
    tugBoard(game).forEach((line, i) => {
      const y = i;
      if (y >= LAYOUT.mapHeight) return;
      const fg = i === 0 ? THEME.accent : line.startsWith(" ") ? THEME.fg : THEME.zone;
      this.putLine(0, y, clamp(line, LAYOUT.mapWidth), fg);
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
    lines.forEach((l, i) => {
      const colour =
        l.tone === "good" ? THEME.good : l.tone === "bad" ? THEME.bad : l.tone === "warn" ? THEME.warn : THEME.fg;
      const fade = i < lines.length - 3 ? THEME.fgDim : colour;
      const suffix = l.count > 1 ? ` (x${l.count})` : "";
      this.putLine(1, y0 + i, clamp(`${logText(l)}${suffix}`, SCREEN_WIDTH - 2), fade);
    });
  }

  /**
   * The title card, centred on an empty screen.
   *
   * The layout is written out row by row rather than looped, because the six
   * lines are not a list: the name, the pitch and the prompt each want their
   * own colour and their own air around them (src/ui/input.ts, TITLE_LINES).
   */
  private drawTitle(): void {
    const lines = titleLines();
    const { width: w, height: h } = titleBox();
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);

    const centred = (row: number, text: string, fg: string): void => {
      this.putLine(x0 + ((w - text.length) >> 1), y0 + row, text, fg);
    };
    centred(2, lines[0]!, THEME.accent);
    centred(4, lines[1]!, THEME.fg);
    centred(5, lines[2]!, THEME.fg);
    centred(6, lines[3]!, THEME.fg);
    centred(8, lines[4]!, THEME.zone);
    this.drawLangRow(x0 + ((w - langRow().length) >> 1), y0 + TITLE_LANG_ROW);
    centred(TITLE_LAST_ROW, lines[5]!, THEME.accent);
  }

  /**
   * `L  EN · ES · RU`, with the one that is on lit up.
   *
   * The tags are the ISO codes and are never translated: a player looking for
   * their own language is looking for the two letters they already know, and a
   * row that renamed itself would be a row they cannot find from the outside.
   */
  private drawLangRow(x0: number, y: number): void {
    this.putLine(x0, y, LANG_PREFIX, THEME.fgDim);
    let x = x0 + LANG_PREFIX.length;
    LANGS.forEach((lang, i) => {
      if (i > 0) {
        this.putLine(x, y, " · ", THEME.fgDim);
        x += 3;
      }
      const tag = lang.toUpperCase();
      this.putLine(x, y, tag, lang === currentLang() ? THEME.accent : THEME.fgDim);
      x += tag.length;
    });
  }

  private drawHelp(game: RoomGame, page: number): void {
    const onTug = isTug(game);
    const pages = helpPages(onTug);
    const body = pages[Math.min(page, pages.length - 1)] ?? [];
    const { width: w, height: h, inner } = helpBox(onTug);
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
  private putLine(x0: number, y: number, text: string, fg: string): void {
    for (let i = 0; i < text.length; i++) {
      const x = x0 + i;
      if (x >= SCREEN_WIDTH) return;
      this.display.draw(x, y, text[i]!, fg, null);
    }
  }
}

/** One line, one row: a line longer than its box would run over the frame. */
function clamp(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
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
