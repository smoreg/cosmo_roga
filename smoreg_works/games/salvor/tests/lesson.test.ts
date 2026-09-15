import { describe, expect, it } from "vitest";
import { newGame } from "../src/game.js";
import { LESSON_STEPS, TUTORIAL_SEED, lessonOf } from "../src/content/tutorial.js";
import { t } from "../src/i18n.js";
import { LESSON_ROWS, LESSON_WIDTH, appReducer, initialState, lessonRows, lessonView, runBegun, type AppState } from "../src/ui/appstate.js";

import { briefing } from "../src/ui/lessoncard.js";
import { LAYOUT, SCREEN_WIDTH } from "../src/ui/theme.js";

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
    {
      for (let k = 0; k <= LESSON_STEPS.length; k++) {
        for (const done of [false, true]) {
          const rows = lessonRows(onStep(k, done));
          expect(rows.length, `step ${k}`).toBeGreaterThanOrEqual(1);
          expect(rows.length, `step ${k}`).toBeLessThanOrEqual(LESSON_ROWS);
          for (const row of rows) {
            expect(row.length, `step ${k}: ${row}`).toBeLessThanOrEqual(LESSON_WIDTH);
          }
          // Nothing of the instruction was lost to the row cap: the rows
          // hold every word of it.
          const view = lessonView(onStep(k, done))!;
          const words = view.lines.join(" ").split(" ").filter((w) => w.length > 0);
          const shown = rows.slice(1).join(" ").split(" ").filter((w) => w.length > 0);
          expect(shown, `step ${k} was cut`).toEqual(words);
        }
      }
    }
  });

  it("keeps the opening line inside the log too", () => {
    {
      expect(t("lesson.opening").length).toBeLessThanOrEqual(LESSON_WIDTH);
    }
  });
});

// ------------------------------------------------------------------ the page

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
});
