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
  type AppState,
} from "../src/ui/appstate.js";
import { LAYOUT, SCREEN_WIDTH } from "../src/ui/theme.js";
import { screenHtml } from "../src/ui/web/screen.js";
import { WEB_CSS } from "../src/ui/web/styles.js";

/**
 * The lesson's window (docs/tasks/G90-smoreg-wave.md, E3): what it says, that
 * it fits both screens in three languages, that it folds and unfolds without
 * moving the lesson, and that an ordinary run never sees it.
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
    const view = lessonView(onStep(0), PLAYING)!;
    expect(view.head).toBe(t("lesson.head", { n: 1, of: LESSON_STEPS.length }));
    expect(view.press).toBe(t(LESSON_STEPS[0]!.press));
    expect(view.lines).toEqual([t(LESSON_STEPS[0]!.text)]);
    expect(view.fold).toBe(t("lesson.head.fold"));
    expect(view.done).toBe(false);
    expect(view.over).toBe(false);
    expect(view.folded).toBe(false);
    expect(lessonView(newGame(7), PLAYING)).toBeUndefined();
    expect(lessonRows(newGame(7), PLAYING)).toEqual([]);
  });

  it("carries the tick on the turn after a step closed, and the closing line once over", () => {
    const ticked = lessonView(onStep(3, true), PLAYING)!;
    expect(ticked.done).toBe(true);
    expect(lessonRows(onStep(3, true), PLAYING)[0]).toContain(t("lesson.done"));
    expect(lessonRows(onStep(3), PLAYING)[0]).not.toContain(t("lesson.done"));

    const over = lessonView(onStep(LESSON_STEPS.length), PLAYING)!;
    expect(over.over).toBe(true);
    expect(over.head).toBe(t("lesson.over.head"));
    expect(over.press).toBe("");
    expect(over.lines).toEqual([t("lesson.over")]);
  });

  it("keeps only the head while folded", () => {
    const folded = { ...PLAYING, lessonFolded: true };
    const view = lessonView(onStep(2), folded)!;
    expect(view.folded).toBe(true);
    expect(view.lines).toEqual([]);
    expect(view.head).toBe(t("lesson.head", { n: 3, of: LESSON_STEPS.length }));
    expect(lessonRows(onStep(2), folded)).toHaveLength(1);
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
          const rows = lessonRows(onStep(k, done), PLAYING);
          expect(rows.length, `${lang}: step ${k}`).toBeGreaterThanOrEqual(1);
          expect(rows.length, `${lang}: step ${k}`).toBeLessThanOrEqual(LESSON_ROWS);
          for (const row of rows) {
            expect(row.length, `${lang}: step ${k}: ${row}`).toBeLessThanOrEqual(LESSON_WIDTH);
          }
          // Nothing of the instruction was lost to the row cap: the rows
          // hold every word of it.
          const view = lessonView(onStep(k, done), PLAYING)!;
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
    expect(html).toContain(t("lesson.head.fold"));
    // Over the map's bottom-left corner — the top-left is the alert's — and
    // in the map's own cell, so it can never cover the panel or the log.
    expect(html.indexOf('class="web-lesson')).toBeLessThan(html.indexOf('<div class="web-panel">'));
    expect(WEB_CSS).toMatch(/\.web-lesson\{grid-column:1; grid-row:2; align-self:end; justify-self:start;/);
    expect(WEB_CSS).toMatch(/\.web-corner\{grid-column:1; grid-row:2; align-self:start;/);
    expect(WEB_CSS).toMatch(/\.web-lesson\{[^}]*pointer-events:none/);
  });

  it("folds to its head, ticks once done, and is gone from an ordinary run", () => {
    const game = onStep(1);
    const folded = screenHtml(game, { ...PLAYING, lessonFolded: true }, new Set());
    expect(folded).toContain('<div class="web-lesson is-folded">');
    expect(folded).not.toContain('<div class="li">');
    expect(folded).toContain(t("lesson.head", { n: 2, of: LESSON_STEPS.length }));

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

describe("Esc folds the window and skips nothing", () => {
  it("toggles the fold with nothing else open, closes a level first, and never moves the step", () => {
    const game = onStep(2);
    let state = appReducer(PLAYING, { kind: "dismiss" }, game);
    expect(state.lessonFolded).toBe(true);
    expect(state.effect).toEqual({ kind: "idle" });
    expect(lessonOf(game.player)!.step).toBe(2);
    expect(game.inputs).toEqual([]);
    state = appReducer(state, { kind: "dismiss" }, game);
    expect(state.lessonFolded).toBe(false);

    // With the map's list up, Esc closes it and leaves the fold alone.
    state = appReducer(state, { kind: "moves" }, game);
    expect(state.moves).toBe(true);
    state = appReducer(state, { kind: "dismiss" }, game);
    expect(state.moves).toBe(false);
    expect(state.lessonFolded).toBe(false);
    // And the fold survives a turn: it is the screen's, not the run's.
    state = { ...state, lessonFolded: true };
    state = appReducer(state, { kind: "command", cmd: { kind: "wait" } }, game);
    expect(state.lessonFolded).toBe(true);
    expect(lessonOf(game.player)!.step).toBe(2);
  });

  it("starts unfolded on every screen a run begins on", () => {
    expect(initialState().lessonFolded).toBe(false);
    const started = appReducer(initialState(), { kind: "pick", index: 0 }, newGame(7));
    expect(started.lessonFolded).toBe(false);
    const again = appReducer(PLAYING, { kind: "restart" }, newGame(7));
    expect(again.lessonFolded).toBe(false);
  });
});
