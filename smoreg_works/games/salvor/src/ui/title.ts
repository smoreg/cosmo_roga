import { t } from "../i18n.js";
import type { KeyLike } from "./input.js";

/**
 * The first screen of the game, as data.
 *
 * The old title was three lines of pitch, three numbered words and an "any key"
 * behind them, and the owner did not count it as a start screen at all
 * («отсутствие стартового экрана нормального, который я просил тебя сделать»).
 * What was missing was not decoration: the run's settings — language, view,
 * sound, seed — were reachable only through the URL or through a letter nothing
 * on the screen named, so a voter who opened the page could not choose any of
 * them without reading the source.
 *
 * So this file is the screen's content and nothing about its shape: a name, one
 * line saying what the game is, a menu where every row is a key and what that
 * key does right now, two lines of the controls a first run needs, and the one
 * line saying this is a jam entry. Both renderers read the same value — the
 * terminal lays it out in a frame and columns (`ui/render.ts`, `titleRows`), the
 * page lays it out as panels (`ui/web/screen.ts`) — so the two cannot come to
 * disagree about what the title offers.
 *
 * No DOM, no `Math.random()`, no storage read at import time: the whole of it is
 * a pure function of the settings it is handed, which is what lets
 * `tests/title.test.ts` measure nine screens without a browser.
 */

/** What the menu names besides the run itself. Mirrored into `AppState` by the shell. */
export interface TitleSettings {
  /** Whether the run will have sound. `S` flips it; the row says which. */
  readonly sound: boolean;
  /**
   * The seed of the run waiting behind the title.
   *
   * A run already exists before the first key — the title sits in front of it —
   * so this is a number and never "none": choosing a seed replaces that run
   * rather than configuring a future one.
   */
  readonly seed: number;
}

/** One of the rings a row picks from. */
export interface TitleOption {
  readonly text: string;
  readonly on: boolean;
}

/** One row of the menu: the key, what it does, and what it says right now. */
export interface TitleItem {
  readonly key: string;
  readonly label: string;
  /** The plain answer, where the row has one: the seed, on or off. */
  readonly value?: string;
  /** The ring, where the row cycles one. */
  readonly options?: readonly TitleOption[];
}

export interface TitleScreen {
  readonly name: string;
  readonly tagline: string;
  readonly menuHead: string;
  readonly items: readonly TitleItem[];
  /** What to press to actually start, and the note about ASCII the jam wants. */
  readonly hints: readonly string[];
  readonly keysHead: string;
  /** The controls a first run needs, in two lines and no more. */
  readonly keys: readonly string[];
  /** The jam, the author, the build. One line, at the foot. */
  readonly foot: string;
}

/**
 * Which line of the menu each digit is, counting from zero — the index a `pick`
 * intent carries (`ui/input.ts`). Written here rather than in the reducer
 * because the row and the key it answers to are one fact: a row added above
 * another moves both.
 */
export const TITLE_PICKS = {
  voyage: 0,
  training: 1,
  help: 2,
  seed: 3,
} as const;

/** The keys the four numbered rows wear, in the order the menu draws them. */
const PICK_KEYS = ["1", "2", "3", "4"] as const;

/**
 * The rows of the menu, in the order they are drawn.
 *
 * A list rather than seven `if`s, because a click names a *row* where a digit
 * names a *key* — the same distinction the action list draws (`ui/input.ts`,
 * `line` versus `pick`). The owner plays the graphic view with a mouse, and
 * until G84's second pass the start screen had no `data-line` at all, so for
 * him the screen was legible and inert: rows he could read and not press.
 */
export const TITLE_ROWS = ["voyage", "training", "help", "seed", "sound"] as const;

export type TitleRowKind = (typeof TITLE_ROWS)[number];

/** Which row was clicked, or undefined for an index the menu has no row for. */
export function titleRowAt(index: number): TitleRowKind | undefined {
  return TITLE_ROWS[index];
}

/** Which row a digit presses, or undefined for a digit no row wears. */
export function titleRowOfPick(index: number): TitleRowKind | undefined {
  return index >= 0 && index <= TITLE_PICKS.seed ? TITLE_ROWS[index] : undefined;
}

/** The two rows a letter answers to. `V` already worked on every screen; `S` is new. */
export const SOUND_KEY = "S";

/** Digits a seed may have: `Math.random() * 0xffffffff >>> 0` never needs an eleventh. */
export const SEED_DIGITS = 10;

/**
 * `S`, on any screen: sound on or off.
 *
 * Read before `toIntent` the way `V` and `` ` `` are (`ui/app.ts`), and for the
 * same three reasons — it is never a turn, it has to work on the title before a
 * run has started, and the sim has no business being told about it. The capital
 * is deliberate: `s` is the scanner and a settings key must not cost a module
 * its letter.
 */
export function isSoundKey(e: KeyLike): boolean {
  return e.key === SOUND_KEY && e.ctrlKey !== true && e.metaKey !== true;
}

/** Where the sound choice is kept. A setting, never progress — see .claude/CLAUDE.md. */
export const SOUND_STORAGE_KEY = "salvor.sound";

/** What the last session chose, or undefined if it never said. */
export function storedSound(store?: ViewStore): boolean | undefined {
  if (!store) return undefined;
  try {
    const value = store.getItem(SOUND_STORAGE_KEY);
    if (value === "on") return true;
    if (value === "off") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/** The choice, written back. A storage that refuses is not worth a crash. */
export function rememberSound(on: boolean, store?: ViewStore): void {
  if (!store) return;
  try {
    store.setItem(SOUND_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode, a full quota, site data switched off. The sound still
    // follows the key; it simply will not be there next time.
  }
}

/**
 * The build the foot line names.
 *
 * A literal rather than an import of `package.json`, because a bundler that
 * inlines JSON is one more thing to configure in a jam — and
 * `tests/title.test.ts` reads the manifest off disk and asserts the two agree,
 * so it cannot drift silently.
 */
/** The slice of `localStorage` the settings use, so a test can hand in its own. */
export interface ViewStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BUILD_VERSION = "0.1.0";

/**
 * The whole screen, in whichever language is on.
 *
 * `typing` is the digits entered for a seed so far, or undefined when the seed
 * row is not being edited — the one piece of the title that is state rather
 * than setting, which is why it arrives separately (`ui/appstate.ts`).
 */
export function titleScreen(settings: TitleSettings, typing?: string): TitleScreen {
  return {
    name: t("title.name"),
    tagline: t("title.tagline"),
    menuHead: t("title.menu.head"),
    items: [
      { key: PICK_KEYS[0], label: t("title.menu.voyage"), value: t("title.menu.voyage.at") },
      { key: PICK_KEYS[1], label: t("title.menu.training"), value: t("title.menu.training.at") },
      { key: PICK_KEYS[2], label: t("title.menu.help"), value: t("title.menu.help.at") },
      { key: PICK_KEYS[3], label: t("title.menu.seed"), value: seedValue(settings.seed, typing) },
      { key: SOUND_KEY, label: t("title.menu.sound"), value: t(settings.sound ? "title.sound.on" : "title.sound.off") },
    ],
    hints: [
      typing === undefined ? t("title.start") : t("title.seed.typing", { seed: settings.seed }),
    ],
    keysHead: t("title.keys.head"),
    keys: [t("title.keys.1"), t("title.keys.2")],
    foot: t("title.foot", { version: BUILD_VERSION }),
  };
}

/**
 * Every line of the title as plain text, in the order it is read.
 *
 * What the width checks measure and what a language test compares: one flat
 * list, so "does the Spanish title fit the terminal" is arithmetic rather than
 * a walk over a tree of panels.
 */
export function titleLines(settings: TitleSettings = DEFAULT_TITLE, typing?: string): string[] {
  const screen = titleScreen(settings, typing);
  return [
    screen.name,
    screen.tagline,
    screen.menuHead,
    ...screen.items.map(itemText),
    ...screen.hints,
    screen.keysHead,
    ...screen.keys,
    screen.foot,
  ];
}

/** One menu row as the terminal writes it: the key, the label, the answer. */
export function itemText(item: TitleItem): string {
  return `${item.key.padEnd(KEY_W)}${item.label.padEnd(LABEL_W)}${itemValue(item)}`;
}

/** The right-hand column of a row: its plain value, or its ring written out. */
export function itemValue(item: TitleItem): string {
  if (item.options) return item.options.map((o) => o.text).join(RING_SEP);
  return item.value ?? "";
}

/** The option a ring row is currently on, for a renderer that wants to light it. */
export function itemMark(item: TitleItem): string | undefined {
  return item.options?.find((o) => o.on)?.text;
}

/** Columns the key glyph and the label take before the answer starts. */
export const KEY_W = 4;
export const LABEL_W = 22;
const RING_SEP = " · ";

/** What a session with nothing chosen would show. Only the width tests use it. */
export const DEFAULT_TITLE: TitleSettings = { sound: true, seed: 0 };

function seedValue(seed: number, typing?: string): string {
  if (typing === undefined) return String(seed);
  return typing.length === 0 ? t("title.seed.empty") : `${typing}_`;
}

/**
 * The digits so far plus one more, or the same string when there is no room.
 *
 * Clamping here rather than in the reducer keeps the whole of "what a seed may
 * look like" in one file: ten digits, and no leading zero worth carrying.
 */
export function seedTyped(typing: string, digit: string): string {
  if (typing.length >= SEED_DIGITS) return typing;
  if (typing.length === 0 && digit === "0") return typing;
  return typing + digit;
}

/**
 * The seed the address bar asks for, or undefined when it asks for nothing the
 * game can fly.
 *
 * One reading of `?seed=` for the whole shell, because there were two and they
 * disagreed: `main.ts` drew a random number for anything that was not digits,
 * and `ui/app.ts` gave a training run its own hull only when the parameter was
 * *absent*. Between them, `?training=1&seed=abc` — and `seed=`, `seed=-1`,
 * `seed=0x10` — quietly stopped being a tutorial and became a different random
 * ship on every reload (docs/tasks/G86-tutorial-and-title.md, 9).
 *
 * Digits only, and the same rule the seed row types under
 * (`SEED_DIGITS`): a number a player can read off the screen and type back in.
 */
export function seedFromUrl(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("seed");
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value >>> 0 : undefined;
}

/**
 * The number a typed seed means, or undefined for "draw one at random".
 *
 * An empty field is the random option and is the reason `Enter` on it is not a
 * no-op: the title has to be able to say "another ship, whichever" without a
 * key of its own.
 */
export function seedOf(typing: string): number | undefined {
  if (typing.length === 0) return undefined;
  const value = Number(typing);
  return Number.isFinite(value) ? value >>> 0 : undefined;
}
