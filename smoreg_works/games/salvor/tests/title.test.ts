import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { newGame } from "../src/game.js";
import { TUTORIAL_SEED } from "../src/content/tutorial.js";
import { appReducer, initialState, withSettings, type AppState } from "../src/ui/appstate.js";
import { toIntent, type KeyLike } from "../src/ui/input.js";

import { BUILD_VERSION, DEFAULT_TITLE, SEED_DIGITS, SOUND_STORAGE_KEY, TITLE_PICKS, TITLE_ROWS, isSoundKey, itemText, rememberSound, seedFromUrl, seedOf, seedTyped, storedSound, titleRowAt, titleRowOfPick, titleScreen, type TitleSettings } from "../src/ui/title.js";
import { VIEWS, VIEW_STORAGE_KEY, initialView, isViewKey, nextView, rememberView } from "../src/ui/view.js";

/**
 * The start screen (docs/tasks/G84-title-screen.md).
 *
 * The old title was three lines of pitch and three numbered words, and the
 * owner did not count it as one: «отсутствие стартового экрана нормального,
 * который я просил тебя сделать». What is asserted here is the answer to that —
 * that the screen names every setting it can change, that each key does the one
 * thing its row promises, that a seed typed on it is the seed the run gets, and
 * that none of it costs a turn or leaks between runs.
 *
 * No browser anywhere: the screen is a pure function of the settings it is
 * handed, in both views (`.claude/CLAUDE.md`, "Игру в браузере не тестировать").
 */

const press = (key: string, code?: string): KeyLike => ({ key, code });

const digits = (text: string): KeyLike[] => [...text].map((d) => press(d, `Digit${d}`));

function title(settings: Partial<TitleSettings> = {}): AppState {
  return initialState({ ...DEFAULT_TITLE, ...settings });
}

/** One key press, the way `app.ts` makes it: key table first, reducer second. */
function key(state: AppState, e: KeyLike): AppState {
  return appReducer(state, toIntent(e), newGame(7));
}

/** A run of key presses from the title, in order. */
function keys(state: AppState, ...events: KeyLike[]): AppState {
  return events.reduce(key, state);
}

/** As much of `localStorage` as the settings use, and nothing that persists. */
function store(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

// --------------------------------------------------------------- what it says

describe("the start screen answers the five questions", () => {
  it("names the game and says in one line what it is", () => {
    const screen = titleScreen(DEFAULT_TITLE);
    expect(screen.name).toBe("SALVOR");
    // One line, not a paragraph: the owner's complaint about the old card was
    // that the pitch was three rows of small text nobody reads.
    expect(screen.tagline).not.toContain("\n");
    expect(screen.tagline.length).toBeGreaterThan(20);
  });

  it("gives every row of the menu a key and something it does", () => {
    const items = titleScreen(DEFAULT_TITLE).items;
    expect(items.map((i) => i.key)).toEqual(["1", "2", "3", "4", "V", "S"]);
    for (const item of items) {
      expect(item.label.length, item.key).toBeGreaterThan(0);
      // A row either answers with a value or picks off a ring. Never neither:
      // a row that says nothing about its own state is the old title again.
      expect(item.value !== undefined || item.options !== undefined, item.key).toBe(true);
    }
  });

  it("offers the three views on the screen itself", () => {
    const screen = titleScreen({ ...DEFAULT_TITLE, view: "hex" });
    const view = screen.items.find((i) => i.key === "V")!;
    expect(view.options).toHaveLength(VIEWS.length);
    expect(view.options?.filter((o) => o.on)).toHaveLength(1);
    // The honeycomb is on, so the honeycomb is the marked one.
    expect(view.options?.at(-1)?.on).toBe(true);
  });

  it("says the jam judges expect ASCII, and opens in it", () => {
    expect(titleScreen(DEFAULT_TITLE).hints.join(" ")).toContain("ASCII");
    expect(DEFAULT_TITLE.view).toBe("ascii");
    expect(initialView("", undefined)).toBe("ascii");
  });

  it("names the jam, the author and the build at the foot", () => {
    const foot = titleScreen(DEFAULT_TITLE).foot;
    expect(foot).toContain("Fortnight 2");
    expect(foot).toContain("smoreg");
    expect(foot).toContain(BUILD_VERSION);
  });

  it("keeps the build in step with the manifest", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    expect(BUILD_VERSION).toBe(manifest.version);
  });

  it("puts the controls a first run needs in two lines", () => {
    const rows = titleScreen(DEFAULT_TITLE).keys;
    expect(rows).toHaveLength(2);
    const both = rows.join("  ");
    for (const k of ["?", "m", "o", "Tab", "i", "V"]) expect(both, k).toContain(k);
  });

  it("shows the run's own seed, so a bug report can quote it", () => {
    const row = titleScreen({ ...DEFAULT_TITLE, seed: 4242 }).items[TITLE_PICKS.seed]!;
    expect(row.value).toBe("4242");
  });
});

// --------------------------------------------------------- the shape of it

describe("the start screen fits the terminal in every language", () => {

  it("lines the menu's three columns up, whatever the label is", () => {
    const rows = titleScreen(DEFAULT_TITLE).items.map(itemText);
    const at = rows.map((row) => row.indexOf(row.trimStart()[0]!));
    expect(new Set(at).size).toBe(1);
  });
});

// ------------------------------------------------------------------ the mouse

/**
 * The screen with a mouse.
 *
 * The whole reason for G84's second pass: `titleCard` shipped without a single
 * `data-line`, and the page's click handler looks for nothing else
 * (`ui/web/mount.ts`). The owner plays the graphic view with a mouse, so the
 * start screen he was given was legible and inert — seven rows he could read
 * and none he could press.
 */
describe("every row of the menu can be clicked", () => {

  it("does by click exactly what the row's key does", () => {
    const clicks = TITLE_ROWS.map((_, i) => appReducer(title(), { kind: "line", index: i }, newGame(7)));
    expect(clicks[TITLE_ROWS.indexOf("voyage")]!.overlay).toBe("none");
    expect(clicks[TITLE_ROWS.indexOf("training")]!.effect).toEqual({ kind: "training" });
    expect(clicks[TITLE_ROWS.indexOf("help")]!.overlay).toBe("help");
    expect(clicks[TITLE_ROWS.indexOf("seed")]!.seedText).toBe("");
    expect(clicks[TITLE_ROWS.indexOf("view")]!.effect).toEqual({ kind: "view" });
    expect(clicks[TITLE_ROWS.indexOf("sound")]!.effect).toEqual({ kind: "sound" });
  });

  it("does nothing at all on a click that hit no row", () => {
    for (const index of [TITLE_ROWS.length, TITLE_ROWS.length + 3, 99]) {
      const next = appReducer(title(), { kind: "line", index }, newGame(7));
      expect(next.overlay, String(index)).toBe("title");
      expect(next.effect, String(index)).toEqual({ kind: "idle" });
      expect(next.seedText, String(index)).toBeUndefined();
    }
  });

  it("spends no turn on any of them", () => {
    for (let index = 0; index < TITLE_ROWS.length; index++) {
      const game = newGame(7);
      appReducer(title(), { kind: "line", index }, game);
      expect(game.inputs, String(index)).toEqual([]);
      expect(game.schedule.time, String(index)).toBe(0);
    }
  });

  it("leaves the digits to the four rows that wear one", () => {
    // A click reaches all seven; a digit reaches the four that print one, and
    // `5`..`0` go on meaning "any other key casts off" as they always did.
    expect(titleRowOfPick(0)).toBe("voyage");
    expect(titleRowOfPick(3)).toBe("seed");
    expect(titleRowOfPick(4)).toBeUndefined();
    expect(titleRowAt(4)).toBe("view");
    expect(key(title(), press("5", "Digit5")).overlay).toBe("none");
  });

  it("keeps the rows out of the way of the seed being typed", () => {
    const typed = keys(title(), press("4", "Digit4"), ...digits("12"));
    const clicked = appReducer(typed, { kind: "line", index: 0 }, newGame(7));
    // A click while the field is open is swallowed like a stray key: a run
    // must not start from under a half-typed number.
    expect(clicked.overlay).toBe("title");
    expect(clicked.seedText).toBe("12");
  });
});

// -------------------------------------------------------------- what the keys do

describe("every key of the menu does what its row promises", () => {
  it("casts off on `1`, the space bar and the digits no row wears, and on nothing else", () => {
    for (const e of [press("1", "Digit1"), press(" ", "Space"), press("5", "Digit5")]) {
      const next = key(title(), e);
      expect(next.overlay, e.key).toBe("none");
      expect(next.effect, e.key).toEqual({ kind: "idle" });
    }
    // A letter is not a voyage: a player reaching for one used to be flown out
    // of the dock by it (docs/tasks/G88-polish-by-map.md, B3).
    for (const e of [press("q", "KeyQ"), press("z", "KeyZ"), press("R", "KeyR"), press("Tab"), press("o", "KeyO")]) {
      const next = key(title(), e);
      expect(next.overlay, e.key).toBe("title");
      expect(next.effect, e.key).toEqual({ kind: "idle" });
    }
  });

  /**
   * The four keys "any key casts off" does not include.
   *
   * The arrows and `Enter` are the idiom every other screen of this game keeps,
   * and on the title they fell through into the voyage: a player reaching for
   * the menu with the arrows flew out of the dock. `?` is worse than that — the
   * block of controls on this very screen advertises it — and `Esc` is the key
   * a player presses to back out of nothing at all
   * (docs/tasks/G86-tutorial-and-title.md, 11 and 13).
   */
  it("keeps the arrows, `Enter`, `Esc` and `?` out of the voyage", () => {
    for (const e of [press("ArrowDown"), press("ArrowUp"), press("ArrowLeft"), press("ArrowRight"), press("Escape")]) {
      expect(key(title(), e).overlay, e.key).toBe("title");
    }
    // `Enter` does the lit row, which on a screen nobody has touched is the
    // first one: cast off. That is the row's own promise, not "any key".
    expect(key(title(), press("Enter")).overlay).toBe("none");
    expect(key(title(), press("?")).overlay).toBe("help");
  });

  it("moves the highlight with the arrows and does the lit row on `Enter`", () => {
    const menu = title();
    expect(menu.cursor).toBe(0);
    const down = key(menu, press("ArrowDown"));
    expect(down.cursor).toBe(TITLE_PICKS.training);
    expect(down.effect).toEqual({ kind: "idle" });
    // The lit row is what `Enter` does: the second row is the training run.
    expect(key(down, press("Enter")).effect).toEqual({ kind: "training" });
    // Down to the help row and into the card, with no digit pressed at all.
    expect(keys(menu, press("ArrowDown"), press("ArrowDown"), press("Enter")).overlay).toBe("help");
    // And the ring rows are reachable the same way: the view row is fifth.
    const view = keys(menu, ...Array(TITLE_ROWS.indexOf("view")).fill(press("ArrowDown")));
    expect(view.cursor).toBe(TITLE_ROWS.indexOf("view"));
    expect(key(view, press("Enter")).effect).toEqual({ kind: "view" });
    expect(key(view, press("Enter")).overlay).toBe("title");
  });

  it("wraps the highlight at both ends of the menu", () => {
    expect(key(title(), press("ArrowUp")).cursor).toBe(TITLE_ROWS.length - 1);
    const last = keys(title(), ...Array(TITLE_ROWS.length).fill(press("ArrowDown")));
    expect(last.cursor).toBe(0);
  });

  /**
   * The card opened from the menu comes back to the menu.
   *
   * Every way out of it: `Esc`, the last page of `?`, and any key at all. A
   * player who pressed `3`, read the rules and pressed `Esc` used to end up in
   * the voyage having chosen nothing, with no way back — and the comment over
   * the reducer's title branch promised the opposite
   * (docs/tasks/G86-tutorial-and-title.md, 10).
   */
  it("comes back to the menu from the help card, whichever way it is closed", () => {
    for (const opened of [key(title(), press("3", "Digit3")), key(title(), press("?"))]) {
      expect(opened.overlay).toBe("help");
      expect(opened.titleHelp).toBe(true);
      const closed = key(opened, press("Escape"));
      expect(closed.overlay, "Esc").toBe("title");
      expect(closed.titleHelp).toBe(false);
      // A key that does something puts the card away as well — the card eats
      // the press, as it always has — and it must not cast off on the way.
      expect(key(opened, press("Enter")).overlay, "Enter").toBe("title");
      expect(key(opened, press("m", "KeyM")).overlay, "m").toBe("title");
      // `?` turns the pages and closes on the last one, back onto the menu.
      let paging = opened;
      for (let turn = 0; turn < 12 && paging.overlay === "help"; turn++) paging = key(paging, press("?"));
      expect(paging.overlay, "the last page of ?").toBe("title");
      expect(paging.titleHelp).toBe(false);
      // Through the log's own card too: `PageUp` over the help card and `Esc`
      // used to land in a voyage nobody had started, the flag still set
      // (docs/tasks/G88-polish-by-map.md, B2).
      const history = key(opened, press("PageUp"));
      expect(history.overlay).toBe("history");
      const back = key(history, press("Escape"));
      expect(back.overlay, "PageUp, Esc").toBe("title");
      expect(back.titleHelp).toBe(false);
    }
  });

  it("keeps the card out of the way of a run that opened it", () => {
    // The other half of the same rule: a card opened in a voyage closes onto
    // the board, exactly as it always did.
    const run = { ...title(), overlay: "none" as const };
    const opened = key(run, press("?"));
    expect(opened.overlay).toBe("help");
    expect(opened.titleHelp).toBe(false);
    expect(key(opened, press("Escape")).overlay).toBe("none");
  });

  it("casts off with the prompts on `2`, and opens the help card on `3`", () => {
    expect(key(title(), press("2", "Digit2")).effect).toEqual({ kind: "training" });
    expect(key(title(), press("2", "Digit2")).overlay).toBe("none");
    expect(key(title(), press("3", "Digit3")).overlay).toBe("help");
  });

  it("leaves `V` and `S` to the shell, which is what makes them work here", () => {
    // Both are read before the key table, like the debug overlay: never a turn,
    // never an overlay, and they have to work before a run has started.
    expect(isViewKey(press("V"))).toBe(true);
    expect(isSoundKey(press("S"))).toBe(true);
    expect(isSoundKey(press("s"))).toBe(false);
    expect(isSoundKey({ key: "S", ctrlKey: true })).toBe(false);
  });

  it("cycles the view the way the row reads, left to right", () => {
    let view = VIEWS[0]!;
    for (const expected of [...VIEWS.slice(1), VIEWS[0]!]) {
      view = nextView(view);
      expect(view).toBe(expected);
    }
  });

  it("names the sound the way the row says it, both ways round", () => {
    const on = titleScreen({ ...DEFAULT_TITLE, sound: true }).items.find((i) => i.key === "S");
    const off = titleScreen({ ...DEFAULT_TITLE, sound: false }).items.find((i) => i.key === "S");
    expect(on?.value).not.toBe(off?.value);
    expect(on?.value?.length).toBeGreaterThan(0);
    expect(off?.value?.length).toBeGreaterThan(0);
  });

  it("spends no turn and touches no run, whichever row was pressed", () => {
    for (const e of [press("1", "Digit1"), press("2", "Digit2"), press("3", "Digit3"), press("4", "Digit4")]) {
      const game = newGame(7);
      appReducer(title(), toIntent(e), game);
      expect(game.inputs, e.key).toEqual([]);
      expect(game.schedule.time, e.key).toBe(0);
    }
  });
});

// ------------------------------------------------------------------- the seed

describe("the seed is chosen on the screen, not in the address bar", () => {
  it("opens the row on `4` and says so", () => {
    const next = key(title(), press("4", "Digit4"));
    expect(next.overlay).toBe("title");
    expect(next.seedText).toBe("");
    // The row itself is what announces the mode; there is no other way to know.
    expect(titleScreen(DEFAULT_TITLE, next.seedText).items[TITLE_PICKS.seed]?.value).not.toBe("0");
    expect(titleScreen(DEFAULT_TITLE, next.seedText).hints[0]).toContain("Enter");
  });

  it("takes digits, and asks for exactly the seed that was typed", () => {
    const typed = keys(title(), press("4", "Digit4"), ...digits("31415"));
    expect(typed.seedText).toBe("31415");
    const done = key(typed, press("Enter"));
    expect(done.effect).toEqual({ kind: "newRun", seed: 31415 });
    expect(done.seedText).toBeUndefined();
    expect(done.overlay).toBe("title");
  });

  it("gives that seed the run that seed makes", () => {
    const done = keys(title(), press("4", "Digit4"), ...digits("31415"), press("Enter"));
    const asked = done.effect.kind === "newRun" ? done.effect.seed : undefined;
    expect(asked).toBe(31415);
    const game = newGame(asked!);
    expect(game.seed).toBe(31415);
    // And it is the run `?seed=31415` would have made: same seed, same ship.
    expect(game.ship.rooms.map((r) => r.kind)).toEqual(newGame(31415).ship.rooms.map((r) => r.kind));
  });

  it("rubs a digit out on Backspace and cancels on Esc", () => {
    const typed = keys(title(), press("4", "Digit4"), ...digits("123"));
    expect(key(typed, press("Backspace")).seedText).toBe("12");
    const cancelled = key(typed, press("Escape"));
    expect(cancelled.seedText).toBeUndefined();
    expect(cancelled.effect).toEqual({ kind: "idle" });
    expect(cancelled.overlay).toBe("title");
  });

  it("draws one at random when Enter is pressed on an empty row", () => {
    const done = keys(title(), press("4", "Digit4"), press("Enter"));
    expect(done.effect).toEqual({ kind: "newRun" });
    expect(done.seedText).toBeUndefined();
  });

  it("does not cast off under a stray key while the row is being typed into", () => {
    const typed = keys(title(), press("4", "Digit4"), ...digits("77"));
    for (const e of [press("q", "KeyQ"), press("Tab"), press("o", "KeyO"), press("?")]) {
      const next = key(typed, e);
      expect(next.overlay, e.key).toBe("title");
      expect(next.seedText, e.key).toBe("77");
    }
  });

  /**
   * What the address bar is allowed to mean, in one reading for the whole shell.
   *
   * There were two of them and they disagreed: `main.ts` drew a random number
   * for anything that was not digits, and `ui/app.ts` gave a training run its
   * own hull only when the parameter was *absent*. So `?training=1&seed=abc` —
   * and `seed=`, `seed=-1`, `seed=0x10` — quietly stopped being a tutorial and
   * became a different random ship on every reload
   * (docs/tasks/G86-tutorial-and-title.md, 9).
   */
  it("reads a seed out of the address bar, or says there is none", () => {
    expect(seedFromUrl("?seed=77")).toBe(77);
    expect(seedFromUrl("?seed=0")).toBe(0);
    expect(seedFromUrl("?training=1&seed=4294967295")).toBe(4294967295);
    for (const bad of ["?seed=abc", "?seed=", "?seed=-1", "?seed=0x10", "?seed=1.5", "?training=1", ""]) {
      expect(seedFromUrl(bad), bad).toBeUndefined();
    }
  });

  it("flies the training hull whenever the address bar names no seed it can use", () => {
    // The shell's own decision, written out here because a browser is the one
    // place this game is not tested in: a training run with a seed it cannot
    // read is the training seed, and an ordinary one is whatever was drawn.
    const drawn = 12345;
    const seedFor = (search: string, training: boolean): number =>
      training && seedFromUrl(search) === undefined ? TUTORIAL_SEED : seedFromUrl(search) ?? drawn;
    for (const bad of ["?training=1", "?training=1&seed=abc", "?training=1&seed=", "?training=1&seed=-1", "?training=1&seed=0x10"]) {
      expect(seedFor(bad, true), bad).toBe(TUTORIAL_SEED);
    }
    expect(seedFor("?training=1&seed=77", true)).toBe(77);
    expect(seedFor("?seed=abc", false)).toBe(drawn);
    expect(seedFor("?seed=77", false)).toBe(77);
  });

  it("stops at ten digits and refuses a leading zero", () => {
    expect(seedTyped("1".repeat(SEED_DIGITS), "2")).toBe("1".repeat(SEED_DIGITS));
    expect(seedTyped("", "0")).toBe("");
    expect(seedTyped("1", "0")).toBe("10");
    expect(seedOf("")).toBeUndefined();
    expect(seedOf("4294967295")).toBe(4294967295);
  });
});

// ------------------------------------------------------------- what is remembered

describe("the screen remembers settings and never remembers progress", () => {
  it("brings the view and the sound back next session", () => {
    const kept = store();
    rememberView("hex", kept);
    rememberSound(false, kept);
    expect(kept.getItem(VIEW_STORAGE_KEY)).toBe("hex");
    expect(initialView("", kept)).toBe("hex");
    expect(storedSound(kept)).toBe(false);
  });

  it("lets the URL beat what was remembered, and does not write itself back", () => {
    const kept = store();
    rememberView("hex", kept);
    expect(initialView("?view=ascii", kept)).toBe("ascii");
    expect(kept.getItem(VIEW_STORAGE_KEY)).toBe("hex");
  });

  it("keeps nothing but settings: no seed, no run, no progress", () => {
    const kept = store();
    rememberView("web", kept);
    rememberSound(true, kept);
    const written = [VIEW_STORAGE_KEY, SOUND_STORAGE_KEY];
    // The jam forbids meta-progression outright (.claude/CLAUDE.md), so the
    // whole of what a session may leave behind is named here: two settings.
    expect(written.every((k) => k.startsWith("salvor."))).toBe(true);
    expect(kept.getItem("salvor.seed")).toBeNull();
    expect(kept.getItem("salvor.voyage")).toBeNull();
    expect(kept.getItem("salvor.progress")).toBeNull();
  });

  it("shrugs off a storage that throws rather than losing the screen", () => {
    const hostile = {
      getItem(): string | null {
        throw new Error("blocked");
      },
      setItem(): void {
        throw new Error("blocked");
      },
    };
    expect(storedSound(hostile)).toBeUndefined();
    expect(() => rememberSound(true, hostile)).not.toThrow();
    expect(storedSound(undefined)).toBeUndefined();
  });

  it("carries the settings across a new run, and the run itself never comes back", () => {
    const chosen: TitleSettings = { view: "hex", sound: false, seed: 99 };
    const state = withSettings(title(), chosen);
    expect(state.settings).toEqual(chosen);
    // `shift+R` in a run: another ship, the same choices about the screen. (On
    // the menu itself it is a letter like any other and stays put.)
    const again = appReducer({ ...state, overlay: "none" }, toIntent(press("R", "KeyR")), newGame(7));
    expect(again.effect).toEqual({ kind: "newRun" });
    expect(again.overlay).toBe("none");
    expect(again.settings.view).toBe("hex");
    expect(again.settings.sound).toBe(false);
    expect(again.seedText).toBeUndefined();
  });

  it("leaves the screen with nothing typed into it once the run starts", () => {
    const typed = keys(title(), press("4", "Digit4"), ...digits("55"));
    expect(key(typed, press("Escape")).seedText).toBeUndefined();
    expect(key(title(), press("1", "Digit1")).seedText).toBeUndefined();
  });

});
