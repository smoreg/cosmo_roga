import * as ROT from "rot-js";
import { TILES, Tile, isAlive, STATUS, statusesOf, type Game, type Zone } from "@jamrog/engine";
import { rigOf } from "../twist/rig.js";
import { THEME, LAYOUT, SCREEN_WIDTH, SCREEN_HEIGHT } from "./theme.js";
import { KEY_HELP, RULE_HELP, TITLE_LINES } from "./input.js";
import { deckMapLines } from "./deckmap.js";
import { NO_FLASH, panelColour, rackIntegrity, trackFlash, type Flash } from "./panel.js";
import type { AppState } from "./appstate.js";

/** Columns the sidebar text may use: its width minus the gutter column. */
const PANEL_WIDTH = LAYOUT.sidebarWidth - 1;

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

/** Everything the help card shows, in the order it shows it. */
export const HELP_BODY: readonly string[] = [...KEY_HELP, "", ...RULE_HELP];

/** The help card: a heading row, a blank one, the body, and the frame. */
export const HELP_BOX: BoxSize = boxFor(HELP_BODY, 4);

/**
 * The title card. Its height is fixed rather than counted: the six lines are
 * spread over ten rows with air between them (see `drawTitle`).
 */
export const TITLE_BOX: BoxSize = { ...boxFor(TITLE_LINES, 0), height: 12 };

/** The last row of the title frame a line is written on. */
export const TITLE_LAST_ROW = 10;

export class Renderer {
  readonly display: ROT.Display;

  /**
   * The panel's memory between frames, so a module that just took a blow can
   * flash. Kept here and not in the rig: which frame a line turns red is a
   * rendering question, and sim/ must not grow a concept of frames.
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

  draw(game: Game, state: AppState): void {
    const overlay = state.overlay;
    // First, and without touching the game: whatever broke may well be the
    // deck, the panel or the rig, and the one frame that has to render is this
    // one. An error screen that throws is worse than no error screen.
    if (overlay === "crash" && state.crash) {
      this.display.clear();
      this.drawCrash(state.crash);
      return;
    }
    this.flash = trackFlash(this.flash, rackIntegrity(game.player), game.schedule.time);
    this.display.clear();
    // The title is the whole screen: a station nobody has walked into yet.
    if (overlay === "title") {
      this.drawTitle();
      return;
    }
    this.drawMap(game);
    this.drawZoneLabels(game);
    this.drawTwistOverlay(game);
    this.drawEntities(game);
    this.drawSidebar(game);
    this.drawLog(game);
    if (overlay === "help") this.drawHelp();
    if (overlay === "dead") this.drawBanner("CORE BREACH", runSummary(game), THEME.bad);
    if (overlay === "won") this.drawBanner("STATION SILENCED", runSummary(game), THEME.good);
  }

  private drawMap(game: Game): void {
    const { level } = game;
    for (let y = 0; y < LAYOUT.mapHeight; y++) {
      for (let x = 0; x < LAYOUT.mapWidth; x++) {
        if (!level.tiles.inBounds(x, y)) continue;
        const visible = level.visible.at(x, y);
        const explored = level.explored.at(x, y);
        if (!visible && !explored) continue;

        const tile = level.tiles.at(x, y);
        const def = TILES[tile];
        if (visible) this.display.draw(x, y, def.ch, tileColour(tile, def.fg), def.bg);
        else this.display.draw(x, y, def.ch, THEME.memoryFg, THEME.memoryBg);
      }
    }
  }

  /**
   * A zone's name written into its own top wall. The sidebar schematic says
   * what the deck is made of; this says which of those sectors you are
   * standing in without spending a panel line on it.
   */
  private drawZoneLabels(game: Game): void {
    for (const zone of game.level.zones) {
      if (!zoneExplored(game, zone)) continue;
      const x = zone.rect.x1 + 1;
      const y = zone.rect.y1;
      if (y < 0 || y >= LAYOUT.mapHeight || x >= LAYOUT.mapWidth) continue;
      const room = Math.min(zone.rect.x2 - x, LAYOUT.mapWidth - 1 - x);
      if (room < 3) continue;
      this.display.drawText(x, y, `%c{${THEME.zone}}${zone.name}`, room);
    }
  }

  private drawEntities(game: Game): void {
    for (const e of game.entities) {
      if (e.id === game.player.id) continue;
      if (!isAlive(e)) continue;
      if (!game.level.visible.get(e.pos.x, e.pos.y)) continue;
      if (e.pos.x >= LAYOUT.mapWidth || e.pos.y >= LAYOUT.mapHeight) continue;
      this.display.draw(e.pos.x, e.pos.y, e.ch, e.fg, null);
    }
    const p = game.player;
    if (isAlive(p)) this.display.draw(p.pos.x, p.pos.y, p.ch, p.fg, null);
  }

  /** The twist draws itself through data, so sim/ stays DOM-free. */
  private drawTwistOverlay(game: Game): void {
    const glyphs = game.systems.flatMap((sys) => sys.overlayGlyphs?.(game) ?? []);
    if (glyphs.length === 0) return;
    for (const g of glyphs) {
      if (g.x >= LAYOUT.mapWidth || g.y >= LAYOUT.mapHeight) continue;
      if (game.level.visible.get(g.x, g.y)) {
        this.display.draw(g.x, g.y, g.ch, g.fg, null);
      } else if (g.remembered === true && game.level.explored.get(g.x, g.y) === true) {
        // Wreckage worth walking back to: dimmed, but still on the map.
        this.display.draw(g.x, g.y, g.ch, THEME.fgDim, null);
      }
    }
  }

  private drawSidebar(game: Game): void {
    const x0 = LAYOUT.mapWidth + 1;
    let y = 0;
    const line = (s: string) => this.display.drawText(x0, y++, s, PANEL_WIDTH);

    line(`%c{${THEME.accent}}SALVOR  %c{${THEME.fg}}deck ${game.depth}/${game.maxDepth}`);
    line(`%c{${THEME.fgDim}}turn ${game.schedule.time}`);
    y++;

    for (const sys of game.systems) {
      const panel = sys.panelLines?.(game) ?? [];
      if (panel.length === 0) continue;
      for (const l of panel) line(`%c{${panelColour(l, this.flash.slots)}}${l.text}`);
      y++;
    }

    const active = statusesOf(game.player).filter((st) => st.turns > 0);
    if (active.length > 0) {
      for (const st of active) {
        const def = STATUS[st.kind];
        const colour = def.tone === "good" ? THEME.good : THEME.bad;
        line(`%c{${colour}}${def.name} ${st.turns}`);
      }
      y++;
    }

    const deck = deckMapLines(game.level, game.player.pos);
    if (deck.length > 0) {
      line(`%c{${THEME.accent}}DECK`);
      for (const l of deck) line(`%c{${l.fg ?? THEME.zone}}${l.text}`);
      y++;
    }

    const seen = game.visibleMonsters().slice(0, 6);
    line(`%c{${THEME.accent}}IN SIGHT`);
    if (seen.length === 0) line(`%c{${THEME.fgDim}}nothing`);
    for (const m of seen) line(`%c{${m.fg}}${m.ch} %c{}${m.name} ${m.hp}`);

    y = SCREEN_HEIGHT - LAYOUT.logHeight - 3;
    if (game.onStairs()) this.display.drawText(x0, y, `%c{${THEME.accent}}> hatch here`, PANEL_WIDTH);
    this.display.drawText(x0, SCREEN_HEIGHT - LAYOUT.logHeight - 2, `%c{${THEME.fgDim}}? help`, PANEL_WIDTH);
  }

  private drawLog(game: Game): void {
    const y0 = LAYOUT.mapHeight + 1;
    for (let x = 0; x < SCREEN_WIDTH; x++) this.display.draw(x, LAYOUT.mapHeight, "─", THEME.fgDim, null);

    const lines = game.log.tail(LAYOUT.logHeight);
    lines.forEach((l, i) => {
      const color =
        l.tone === "good" ? THEME.good : l.tone === "bad" ? THEME.bad : l.tone === "warn" ? THEME.warn : THEME.fg;
      const fade = i < lines.length - 3 ? THEME.fgDim : color;
      const suffix = l.count > 1 ? ` (x${l.count})` : "";
      this.display.drawText(1, y0 + i, `%c{${fade}}${l.text}${suffix}`, SCREEN_WIDTH - 2);
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
    const { width: w, height: h } = TITLE_BOX;
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);

    const centred = (row: number, text: string, fg: string) => {
      this.display.drawText(x0 + ((w - text.length) >> 1), y0 + row, `%c{${fg}}${text}`, w);
    };
    centred(2, TITLE_LINES[0]!, THEME.accent);
    centred(4, TITLE_LINES[1]!, THEME.fg);
    centred(5, TITLE_LINES[2]!, THEME.fg);
    centred(6, TITLE_LINES[3]!, THEME.fg);
    centred(8, TITLE_LINES[4]!, THEME.zone);
    centred(TITLE_LAST_ROW, TITLE_LINES[5]!, THEME.accent);
  }

  private drawHelp(): void {
    const { width: w, height: h, inner } = HELP_BOX;
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);
    this.display.drawText(x0 + 2, y0 + 1, `%c{${THEME.accent}}CONTROLS`, inner);
    HELP_BODY.forEach((s, i) => {
      const fg = i > KEY_HELP.length ? THEME.zone : THEME.fg;
      this.display.drawText(x0 + 2, y0 + 3 + i, `%c{${fg}}${s}`, inner);
    });
  }

  private drawBanner(title: string, sub: string, color: string): void {
    const hint = "shift+R for a new run";
    const w = Math.max(title.length, sub.length, hint.length) + 6;
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT >> 1) - 4;
    this.box(x0, y0, w, 7);
    this.display.drawText(x0 + 3, y0 + 1, `%c{${color}}${title}`, w - 4);
    this.display.drawText(x0 + 3, y0 + 3, `%c{${THEME.fg}}${sub}`, w - 4);
    this.display.drawText(x0 + 3, y0 + 5, `%c{${THEME.fgDim}}${hint}`, w - 4);
  }

  /**
   * The run hit an exception. The screen's only job now is to get the seed
   * back to whoever can fix it, so the URL is the biggest thing on it — a
   * voter who can paste one line is worth more than a stack trace they cannot.
   */
  private drawCrash(body: readonly string[]): void {
    const title = "SOMETHING BROKE";
    const hint = "shift+R for a new run";
    // The URL and the error line are the two that can run long: clamp the box
    // to the screen first, then the text to the box.
    const w = Math.min(SCREEN_WIDTH - 4, Math.max(title.length, hint.length, ...body.map((s) => s.length)) + 6);
    const inner = w - 6;
    const h = body.length + 6;
    const x0 = (SCREEN_WIDTH - w) >> 1;
    const y0 = (SCREEN_HEIGHT - h) >> 1;
    this.box(x0, y0, w, h);

    this.display.drawText(x0 + 3, y0 + 1, `%c{${THEME.bad}}${title}`, inner);
    body.forEach((line, i) => {
      // The two lines that tell the player what to do get the bright colour;
      // the error text itself is for the report, not for them.
      const fg = i === 3 ? THEME.accent : i === 5 ? THEME.fgDim : THEME.fg;
      this.display.drawText(x0 + 3, y0 + 3 + i, `%c{${fg}}${clamp(line, inner)}`, inner);
    });
    this.display.drawText(x0 + 3, y0 + h - 2, `%c{${THEME.fgDim}}${hint}`, inner);
  }

  private box(x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const edge = y === y0 || y === y0 + h - 1 || x === x0 || x === x0 + w - 1;
        this.display.draw(x, y, edge ? "·" : " ", THEME.fgDim, THEME.panelBg);
      }
    }
  }
}

/** One line, one row: rot.js wraps, and a wrapped line runs out of its box. */
function clamp(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(1, width - 1))}…`;
}

/** What the run amounted to, in the one line both endings show. */
function runSummary(game: Game): string {
  const burned = rigOf(game.player)?.burnedCount ?? 0;
  return `deck ${game.depth} · ${game.schedule.time} turns · ${game.kills} machines scrapped · ${burned} modules burned`;
}

/** Airlocks and bulkheads are structure, not decoration: the theme owns their colour. */
function tileColour(tile: Tile, fallback: string): string {
  if (tile === Tile.Airlock) return THEME.airlock;
  if (tile === Tile.Bulkhead) return THEME.bulkhead;
  return fallback;
}

function zoneExplored(game: Game, zone: Zone): boolean {
  const { x1, y1, x2, y2 } = zone.rect;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (game.level.explored.get(x, y) === true) return true;
    }
  }
  return false;
}
