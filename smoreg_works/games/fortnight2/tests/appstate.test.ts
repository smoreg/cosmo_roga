import { describe, it, expect } from "vitest";
import type { Game } from "@jamrog/engine";
import { newGame } from "../src/game.js";
import { rigOf } from "../src/twist/rig.js";
import {
  appReducer,
  crashSummary,
  crashed,
  firstLine,
  initialState,
  syncStatus,
  walkEnded,
  type AppState,
} from "../src/ui/appstate.js";
import { toIntent, type KeyLike } from "../src/ui/input.js";

/**
 * The overlays, as transitions.
 *
 * Every case below used to be a thing somebody checked by opening the game in
 * a browser and pressing keys — the title taking any key, `?` on the death
 * screen not eating the banner, shift+R out of the error screen. They are all
 * pure functions of (state, key, run) now, so a UI change that loses one of
 * them fails here instead of in front of a voter.
 */

const press = (key: string, code?: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ...mods });

/** One key press, the way `app.ts` makes it: key table first, reducer second. */
function key(state: AppState, e: KeyLike, game: Game): AppState {
  return appReducer(state, toIntent(e, rigOf(game.player)), game);
}

/** A run that has begun: the title is down and nothing is in front of the deck. */
function playing(game: Game): AppState {
  return key(initialState(), press("l", "KeyL"), game);
}

/** What the sim does when the core goes: the flag the overlays read. */
function died(game: Game): void {
  game.player.hp = 0;
  game.status = "dead";
}

describe("the title card", () => {
  it("starts on the title, in front of a run that already exists", () => {
    const state = initialState();
    expect(state.overlay).toBe("title");
    expect(state.crash).toBeUndefined();
    expect(state.exploring).toBe(false);
  });

  it("goes down on any key, and that key does nothing else", () => {
    const game = newGame(101);
    for (const e of [press("l", "KeyL"), press("?", "Slash"), press("q", "KeyQ"), press("R", "KeyR")]) {
      const next = key(initialState(), e, game);
      expect(next.overlay, e.key).toBe("none");
      // No command, no help card, no restart: the first key is spent on the title.
      expect(next.effect, e.key).toEqual({ kind: "idle" });
    }
  });

  it("does not spend the player's first move", () => {
    const game = newGame(101);
    const before = { ...game.player.pos };
    key(initialState(), press("l", "KeyL"), game);
    expect(game.player.pos).toEqual(before);
    expect(game.schedule.time).toBe(0);
  });
});

describe("playing", () => {
  it("hands the shell a command to run, and nothing else", () => {
    const game = newGame(102);
    const next = key(playing(game), press("l", "KeyL"), game);
    expect(next.overlay).toBe("none");
    expect(next.effect).toEqual({ kind: "command", cmd: { kind: "move", dx: 1, dy: 0 } });
  });

  it("asks for a log line, not a turn, when the module is not fitted", () => {
    const game = newGame(102);
    const next = key(playing(game), press("e", "KeyE"), game);
    expect(next.effect).toEqual({ kind: "log", text: "No EMP installed." });
  });

  it("leaves a key it has no use for to the browser", () => {
    const game = newGame(102);
    const next = key(playing(game), press("q", "KeyQ"), game);
    expect(next.effect).toEqual({ kind: "pass" });
    expect(next.overlay).toBe("none");
  });
});

describe("the help card", () => {
  it("opens on ? and closes on the same key", () => {
    const game = newGame(103);
    const open = key(playing(game), press("?", "Slash"), game);
    expect(open.overlay).toBe("help");
    expect(key(open, press("?", "Slash"), game).overlay).toBe("none");
  });

  it("closes on escape", () => {
    const game = newGame(103);
    const open = key(playing(game), press("?", "Slash"), game);
    expect(key(open, press("Escape", "Escape"), game).overlay).toBe("none");
  });

  it("eats the first key that follows it, whatever that key meant", () => {
    const game = newGame(103);
    const open = key(playing(game), press("?", "Slash"), game);
    for (const e of [press("l", "KeyL"), press("o", "KeyO"), press("Tab", "Tab")]) {
      const next = key(open, e, game);
      expect(next.overlay, e.key).toBe("none");
      expect(next.effect, e.key).toEqual({ kind: "idle" });
      expect(next.exploring, e.key).toBe(false);
    }
  });
});

describe("the endings", () => {
  it("raises the banner as soon as the run is over", () => {
    const game = newGame(104);
    const state = playing(game);
    died(game);
    expect(syncStatus(state, game).overlay).toBe("dead");
  });

  it("shows the win banner on a won run", () => {
    const game = newGame(104);
    const state = playing(game);
    game.status = "won";
    expect(syncStatus(state, game).overlay).toBe("won");
  });

  it("keeps the banner when help is opened and closed on top of it", () => {
    const game = newGame(104);
    died(game);
    const dead = syncStatus(playing(game), game);
    expect(dead.overlay).toBe("dead");

    const help = key(dead, press("?", "Slash"), game);
    expect(help.overlay).toBe("help");

    const back = key(help, press("Escape", "Escape"), game);
    expect(back.overlay).toBe("dead");
    expect(key(help, press("?", "Slash"), game).overlay).toBe("dead");
  });

  it("spends no more turns once the run is over", () => {
    const game = newGame(104);
    died(game);
    const dead = syncStatus(playing(game), game);
    for (const e of [press("l", "KeyL"), press("o", "KeyO"), press("Tab", "Tab")]) {
      const next = key(dead, e, game);
      expect(next.effect, e.key).toEqual({ kind: "idle" });
      expect(next.overlay, e.key).toBe("dead");
    }
  });

  it("starts a new run on shift+R", () => {
    const game = newGame(104);
    died(game);
    const dead = syncStatus(playing(game), game);
    const next = key(dead, press("R", "KeyR"), game);
    expect(next.effect).toEqual({ kind: "newRun" });
    expect(next.overlay).toBe("none");
    expect(next.crash).toBeUndefined();
  });
});

describe("auto-explore", () => {
  it("asks the shell to start walking", () => {
    const game = newGame(105);
    const next = key(playing(game), press("o", "KeyO"), game);
    expect(next.exploring).toBe(true);
    expect(next.effect).toEqual({ kind: "explore" });
  });

  it("stops on any key, and that key spends no turn", () => {
    const game = newGame(105);
    const walking = key(playing(game), press("o", "KeyO"), game);
    for (const e of [press("l", "KeyL"), press("?", "Slash"), press("q", "KeyQ")]) {
      const next = key(walking, e, game);
      expect(next.exploring, e.key).toBe(false);
      expect(next.effect, e.key).toEqual({ kind: "stopAuto" });
      expect(next.overlay, e.key).toBe("none");
    }
  });

  it("clears the walking flag when the walk ends by itself", () => {
    const game = newGame(105);
    const walking = key(playing(game), press("o", "KeyO"), game);
    expect(walkEnded(walking).exploring).toBe(false);
  });

  it("takes one autofight turn per press", () => {
    const game = newGame(105);
    const next = key(playing(game), press("Tab", "Tab"), game);
    expect(next.effect).toEqual({ kind: "fight" });
    expect(next.exploring).toBe(false);
  });
});

describe("the error screen", () => {
  const summary = (): string[] => crashSummary(4242, 17, "http://localhost/?seed=4242", new Error("boom"));

  it("says the seed, the turn, the URL and the first line of the error", () => {
    const lines = summary();
    expect(lines[0]).toBe("seed 4242 · turn 17");
    expect(lines[2]).toBe("http://localhost/?seed=4242");
    expect(lines[3]).toBe("copy this URL and report it");
    expect(lines[5]).toBe("Error: boom");
  });

  it("keeps the error to one line, however many the exception had", () => {
    const lines = crashSummary(1, 2, "u", new Error("first\nsecond\nthird"));
    expect(lines[5]).toBe("Error: first");
  });

  it("survives anything that is not an Error", () => {
    expect(firstLine("just a string")).toBe("just a string");
    expect(firstLine({ toString: () => "an object with something to say" })).toBe("an object with something to say");
    expect(firstLine(undefined)).toBe("undefined");
    expect(firstLine(null)).toBe("null");
    // Nothing usable at all still leaves a line on the screen.
    expect(firstLine("")).toBe("unknown error");
    expect(firstLine({ toString: () => "" })).toBe("unknown error");
    expect(
      firstLine({
        toString(): string {
          throw new Error("hostile");
        },
      }),
    ).toBe("unknown error");
    expect(crashSummary(1, 2, "u", "plain")).toHaveLength(6);
  });

  it("takes exactly one key: the one that starts a new run", () => {
    const game = newGame(106);
    const broken = crashed(playing(game), summary());
    expect(broken.overlay).toBe("crash");

    for (const e of [press("l", "KeyL"), press("?", "Slash"), press("o", "KeyO"), press("Escape", "Escape")]) {
      const next = key(broken, e, game);
      expect(next.effect, e.key).toEqual({ kind: "pass" });
      expect(next.overlay, e.key).toBe("crash");
      expect(next.crash, e.key).toBeDefined();
    }

    const restarted = key(broken, press("R", "KeyR"), game);
    expect(restarted.effect).toEqual({ kind: "newRun" });
    expect(restarted.crash).toBeUndefined();
    expect(restarted.overlay).toBe("none");
    expect(restarted.exploring).toBe(false);
  });

  it("reports the first failure, not the one it caused", () => {
    const game = newGame(106);
    const broken = crashed(playing(game), summary());
    const again = crashed(broken, crashSummary(1, 1, "u", new Error("while drawing the error screen")));
    expect(again).toBe(broken);
    expect(again.crash?.[5]).toBe("Error: boom");
  });

  it("outranks the ending: a broken run does not get a death banner", () => {
    const game = newGame(106);
    const broken = crashed(playing(game), summary());
    died(game);
    expect(syncStatus(broken, game).overlay).toBe("crash");
  });

  it("stops a walk in progress", () => {
    const game = newGame(106);
    const walking = key(playing(game), press("o", "KeyO"), game);
    expect(crashed(walking, summary()).exploring).toBe(false);
  });
});
