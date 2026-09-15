import type { KeyLike } from "./input.js";

/**
 * Which of the two screens is drawn, and where that choice is remembered.
 *
 * The owner asked for both after a live playtest — "сделай переключаемым вью —
 * ASCII и веб красивый" — and the reason both can exist at all is that nothing
 * about the screen lives in a renderer: `schematic()`, `panelBlocks()` and
 * `roomActions()` are pure functions of the game, and a renderer is whatever
 * draws their output. So this file holds the choice and nothing else; no rule of
 * the game is allowed to ask which view is up.
 *
 * Deliberately free of the DOM: the URL arrives as a string and the storage as
 * two methods, so every rule below is testable in the node environment the rest
 * of the suite runs in.
 */

export type View = "ascii" | "web" | "hex" | "react";

/**
 * The cycle, in the order `V` walks it.
 *
 * Four drawings of one game: the terminal the design document specifies to the
 * column, the graph of boxes and wires, the honeycomb deck plan the owner asked
 * for third, and the React screen built on a branch of its own. None of them
 * decides anything — every word and every state on all four comes out of the
 * same pure functions, which is the only reason a fourth could be added beside
 * the others rather than in place of one.
 */
export const VIEWS: readonly View[] = ["ascii", "web", "hex", "react"];

/**
 * What a session with no preference gets.
 *
 * ASCII, because this is a traditional-roguelike jam entry and the terminal
 * screen is the one the design doc specifies to the column. The graphic view is
 * one keystroke away and remembers itself once chosen.
 */
export const DEFAULT_VIEW: View = "ascii";

/** The key that cycles the views. Shifted, so no unshifted verb loses its letter. */
export const VIEW_KEY = "V";

/** Where the choice is kept. A setting, never progress — see .claude/CLAUDE.md. */
export const VIEW_STORAGE_KEY = "salvor.view";

/** The `?view=` parameter, so a link can pin one view for a screenshot or a bug report. */
export const VIEW_PARAM = "view";

/**
 * As much of `localStorage` as this file uses. Injected rather than reached for,
 * because a test has no DOM and a private-mode browser has a `localStorage` that
 * throws on read.
 */
export interface ViewStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isView(value: unknown): value is View {
  return value === "ascii" || value === "web" || value === "hex" || value === "react";
}

/** The press that switches views, and nothing else. `V` is not a chord: shift is spent on it. */
export function isViewKey(e: KeyLike): boolean {
  return e.key === VIEW_KEY && e.ctrlKey !== true && e.metaKey !== true;
}

/** The next view round the cycle. Four of them today; the cycle is what `V` promises. */
export function nextView(view: View): View {
  const i = VIEWS.indexOf(view);
  return VIEWS[(i + 1) % VIEWS.length] ?? DEFAULT_VIEW;
}

/**
 * Which view a session opens in: the URL beats what was remembered, and what was
 * remembered beats the default.
 *
 * The URL wins because that is what a link is for — a bug report or a screenshot
 * pins the view the same way `?seed=` pins the run — and it deliberately does not
 * write itself back to storage: following somebody's link must not change the
 * setting on this machine.
 */
export function initialView(search: string, storage?: ViewStore): View {
  const asked = paramView(search);
  if (asked) return asked;
  const saved = read(storage);
  return saved ?? DEFAULT_VIEW;
}

/** The setting, written back. A storage that refuses is not worth a crash. */
export function rememberView(view: View, storage?: ViewStore): void {
  if (!storage) return;
  try {
    storage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Private mode, a full quota, a browser with site data switched off. The
    // view still works; it simply will not be there next time.
  }
}

function paramView(search: string): View | undefined {
  try {
    const value = new URLSearchParams(search).get(VIEW_PARAM);
    return isView(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function read(storage?: ViewStore): View | undefined {
  if (!storage) return undefined;
  try {
    const value = storage.getItem(VIEW_STORAGE_KEY);
    return isView(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
