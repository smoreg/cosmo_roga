import { afterAll, describe, expect, it } from "vitest";
import { newGame } from "../src/game.js";
import { LESSON_STEPS, TUTORIAL_SEED, lessonOf } from "../src/content/tutorial.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import {
  LESSON_ROWS,
  LESSON_WIDTH,
  appReducer,
  initialState,
  lessonRows,
  lessonView,
  runBegun,
  type AppState,
} from "../src/ui/appstate.js";
import { CODEX_WIDTH } from "../src/ui/input.js";
import { briefing, lessonBrief } from "../src/ui/lessoncard.js";
import { LAYOUT, SCREEN_WIDTH } from "../src/ui/theme.js";
import { screenHtml } from "../src/ui/web/screen.js";
import { WEB_CSS } from "../src/ui/web/styles.js";

/**
 * The lesson's window (docs/tasks/G90-smoreg-wave.md, E3): what it says, that
 * it fits both screens in three languages, that `Esc` leaves it alone — the
 * window is the lesson, and it no longer folds (G96, 5) — and that an ordinary
 * run never sees it.
 *
 * Every line the window shows comes out of `lessonView`, and both renderers
 * draw that value — the page as a card over the map's bottom-left corner, the
 * terminal as rows above the log — so what is measured here is measured for
 * both. No browser: the page is a string and the terminal's rows are strings
 * (`.claude/CLAUDE.md`, "Игру в браузере не тестировать").
 */

afterAll(() => setLang(DEFAULT_LANG));

const PLAYING: AppState = { ...initialState(), overlay: "none" };

/** A training run with the window on step `k`, the tick up when `done`. */
function onStep(k: number, done = false) {
  const game = newGame(TUTORIAL_SEED, true);
  const lesson = lessonOf(game.player)!;
  lesson.step = k;
  lesson.doneAt = done ? game.inputs.length : -1;
  return game;
}

// ----------------------------------------------------------------- the words

describe("what the window says", () => {
  it("says the step, the key and the instruction, and nothing in an ordinary run", () => {
    const view = lessonView(onStep(0))!;
    expect(view.head).toBe(t("lesson.head", { n: 1, of: LESSON_STEPS.length }));
    expect(view.press).toBe(t(LESSON_STEPS[0]!.press));
    expect(view.lines).toEqual([t(LESSON_STEPS[0]!.text)]);
    expect(view.done).toBe(false);
    expect(view.over).toBe(false);
    expect(lessonView(newGame(7))).toBeUndefined();
    expect(lessonRows(newGame(7))).toEqual([]);
  });

  it("carries the tick on the turn after a step closed, and the closing line once over", () => {
    const ticked = lessonView(onStep(3, true))!;
    expect(ticked.done).toBe(true);
    expect(lessonRows(onStep(3, true))[0]).toContain(t("lesson.done"));
    expect(lessonRows(onStep(3))[0]).not.toContain(t("lesson.done"));

    const over = lessonView(onStep(LESSON_STEPS.length))!;
    expect(over.over).toBe(true);
    expect(over.head).toBe(t("lesson.over.head"));
    expect(over.press).toBe("");
    expect(over.lines).toEqual([t("lesson.over")]);
  });

});

// ---------------------------------------------------------------- the widths

describe("the window fits", () => {
  it("keeps every row inside the log's width and three rows tall, in all three languages", () => {
    expect(LESSON_WIDTH).toBe(SCREEN_WIDTH - 2);
    // The log keeps at least four of its seven rows under the window.
    expect(LESSON_ROWS + 4).toBeLessThanOrEqual(LAYOUT.logHeight);
    for (const lang of LANGS) {
      setLang(lang);
      for (let k = 0; k <= LESSON_STEPS.length; k++) {
        for (const done of [false, true]) {
          const rows = lessonRows(onStep(k, done));
          expect(rows.length, `${lang}: step ${k}`).toBeGreaterThanOrEqual(1);
          expect(rows.length, `${lang}: step ${k}`).toBeLessThanOrEqual(LESSON_ROWS);
          for (const row of rows) {
            expect(row.length, `${lang}: step ${k}: ${row}`).toBeLessThanOrEqual(LESSON_WIDTH);
          }
          // Nothing of the instruction was lost to the row cap: the rows
          // hold every word of it.
          const view = lessonView(onStep(k, done))!;
          const words = view.lines.join(" ").split(" ").filter((w) => w.length > 0);
          const shown = rows.slice(1).join(" ").split(" ").filter((w) => w.length > 0);
          expect(shown, `${lang}: step ${k} was cut`).toEqual(words);
        }
      }
    }
  });

  it("keeps the opening line inside the log too", () => {
    for (const lang of LANGS) {
      setLang(lang);
      expect(t("lesson.opening").length, lang).toBeLessThanOrEqual(LESSON_WIDTH);
    }
  });
});

// ------------------------------------------------------------------ the page

describe("the page's card", () => {
  it("draws the window over the map with the step, the key and the instruction", () => {
    const game = onStep(1);
    const html = screenHtml(game, PLAYING, new Set());
    expect(html).toContain('<div class="web-lesson">');
    expect(html).toContain(t("lesson.head", { n: 2, of: LESSON_STEPS.length }));
    expect(html).toContain(t(LESSON_STEPS[1]!.press));
    expect(html).toContain(t(LESSON_STEPS[1]!.text));
    // No fold hint and nothing to fold: the window is the lesson (G96, 5).
    expect(html).not.toContain('class="f"');
    expect(html).not.toContain("esc");
    // Over the map's bottom-left corner — the top-left is the alert's — and
    // in the map's own cell, so it can never cover the panel or the log.
    expect(html.indexOf('class="web-lesson')).toBeLessThan(html.indexOf('<div class="web-panel">'));
    expect(WEB_CSS).toMatch(/\.web-lesson\{grid-column:2; grid-row:1; align-self:end; justify-self:start;/);
    expect(WEB_CSS).toMatch(/\.web-corner\{grid-column:2; grid-row:1; align-self:start;/);
    expect(WEB_CSS).toMatch(/\.web-lesson\{[^}]*pointer-events:none/);
  });

  it("ticks once done, and is gone from an ordinary run", () => {
    const done = screenHtml(onStep(1, true), PLAYING, new Set());
    expect(done).toContain('<div class="web-lesson is-done">');
    expect(done).toContain(t("lesson.done"));

    const over = screenHtml(onStep(LESSON_STEPS.length), PLAYING, new Set());
    expect(over).toContain("is-over");
    expect(over).toContain(t("lesson.over"));

    expect(screenHtml(newGame(7), PLAYING, new Set())).not.toContain("web-lesson");
  });
});

// ------------------------------------------------------------------- the key

describe("Esc leaves the window alone and skips nothing", () => {
  it("does nothing with nothing else open, closes a level first, and never moves the step", () => {
    const game = onStep(2);
    let state = appReducer(PLAYING, { kind: "dismiss" }, game);
    expect(state.effect).toEqual({ kind: "idle" });
    expect(state.overlay).toBe("none");
    expect(lessonOf(game.player)!.step).toBe(2);
    expect(game.inputs).toEqual([]);
    // The window is drawn whole before and after: nothing about it is the screen's to hide.
    expect(lessonRows(game)).toEqual(lessonRows(game));
    expect(lessonView(game)!.lines).toEqual([t(LESSON_STEPS[2]!.text)]);

    // With the map's list up, Esc closes it, and only it.
    state = appReducer(state, { kind: "moves" }, game);
    expect(state.moves).toBe(true);
    state = appReducer(state, { kind: "dismiss" }, game);
    expect(state.moves).toBe(false);
    expect(lessonOf(game.player)!.step).toBe(2);
    expect(lessonView(game)!.lines).toEqual([t(LESSON_STEPS[2]!.text)]);
  });
});

// ------------------------------------------------------------------ the brief

/**
 * The card before the first step (G96, 2): what the job is, said once, on the
 * first frame of a training run and never again. A card like the virus window
 * — any key puts it away and spends nothing — and one an ordinary run never
 * sees.
 */
describe("the card before the first step", () => {
  it("opens over a training run that has not moved, and any key puts it away without a turn", () => {
    const game = newGame(TUTORIAL_SEED, true);
    expect(briefing(game)).toBe(true);
    // Off the title, over a training run: the card.
    let state = appReducer(initialState(), { kind: "pick", index: 0 }, game);
    expect(state.overlay).toBe("brief");
    // The shell builds the run after the reducer has answered, and asks then.
    expect(runBegun({ ...initialState(), overlay: "none" }, game).overlay).toBe("brief");
    expect(runBegun({ ...initialState(), overlay: "none" }, newGame(7)).overlay).toBe("none");
    // Any key: away, and nothing spent — not even the walk the key asked for.
    state = appReducer(state, { kind: "explore" }, game);
    expect(state.overlay).toBe("none");
    expect(state.effect).toEqual({ kind: "idle" });
    expect(game.inputs).toEqual([]);
    // The first frame only: a run that has moved does not open on it again.
    expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);
    expect(briefing(game)).toBe(false);
    expect(runBegun({ ...state, overlay: "none" }, game).overlay).toBe("none");
    // An ordinary run never sees it.
    expect(appReducer(initialState(), { kind: "pick", index: 0 }, newGame(7)).overlay).toBe("none");
    expect(briefing(newGame(7))).toBe(false);
  });

  it("says the job in three sentences that fit the card, in all three languages", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const card = lessonBrief();
      expect(card.heading, lang).toBe(t("lesson.brief.title"));
      expect(card.footer, lang).toBe(t("lesson.brief.footer"));
      // Three paragraphs, two blank lines between them, every row inside the frame.
      expect(card.body.filter((line) => line === ""), lang).toHaveLength(2);
      for (const line of card.body) expect(line.length, `${lang}: ${line}`).toBeLessThanOrEqual(CODEX_WIDTH);
      const words = [t("lesson.brief.hull"), t("lesson.brief.job"), t("lesson.brief.pay")].join(" ").split(" ");
      expect(card.body.join(" ").split(" ").filter((w) => w.length > 0), lang).toEqual(words);
      // And the page draws it as a card in front of the board.
      const html = screenHtml(onStep(0), { ...PLAYING, overlay: "brief" }, new Set());
      expect(html, lang).toContain(t("lesson.brief.title"));
      expect(html, lang).toContain(t("lesson.brief.footer"));
      expect(html, lang).toContain('class="web-over"');
    }
  });
});
