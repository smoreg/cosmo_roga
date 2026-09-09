import type { Command, Game } from "@jamrog/engine";
import { missingModuleLine, type UiIntent } from "./input.js";

/**
 * What the app is showing and what it wants done about the last key — as data,
 * with no DOM anywhere near it.
 *
 * The overlays are the part of the game a test could never reach before: the
 * title, the help card, the two endings and the error screen used to live in
 * `App` as private fields mutated by a switch over key events, so "`?` on the
 * death screen loses the banner" was a thing a person had to notice in a
 * browser. Here it is a transition between two values, and `app.ts` is what is
 * left once the transitions are gone: listeners, a timer and a renderer.
 */

/** What is drawn in front of the deck, if anything. */
export type Overlay = "none" | "title" | "help" | "dead" | "won" | "crash";

/**
 * What the shell must do about the key the reducer just read. The reducer
 * never touches the game itself: a turn is spent by `app.ts` calling
 * `playerCommand`, which keeps every rule about when a turn is spent in one
 * readable place.
 */
export type AppEffect =
  /** Handled, nothing more to do. The key is still ours: swallow it. */
  | { kind: "idle" }
  /** Not ours. Leave the key to the browser. */
  | { kind: "pass" }
  | { kind: "command"; cmd: Command }
  /** A line for the log, and no turn: a key for a module that is not fitted. */
  | { kind: "log"; text: string }
  /** Start the auto-explore walk. The pacing timer belongs to the shell. */
  | { kind: "explore" }
  /** One turn of autofight. */
  | { kind: "fight" }
  /** Abort a walk in progress. */
  | { kind: "stopAuto" }
  /** New seed, new game. */
  | { kind: "newRun" };

export interface AppState {
  readonly overlay: Overlay;
  /** True while auto-explore is walking. Any key at all ends it. */
  readonly exploring: boolean;
  /** The crash card's body, or undefined while the run is healthy. */
  readonly crash: readonly string[] | undefined;
  /** The last transition's output. Recomputed on every step; never history. */
  readonly effect: AppEffect;
}

const IDLE: AppEffect = { kind: "idle" };
const PASS: AppEffect = { kind: "pass" };

/** A session before its first key: the run exists, the title sits in front of it. */
export function initialState(): AppState {
  return { overlay: "title", exploring: false, crash: undefined, effect: IDLE };
}

/**
 * One key press, as a state transition.
 *
 * `game` is read, never written: the reducer asks it whether the run is over
 * and nothing else. Everything that spends a turn comes back as an effect.
 */
export function appReducer(state: AppState, intent: UiIntent, game: Game): AppState {
  // A broken run takes exactly one key: the one that starts a new one. Every
  // other key would ask the sim a question it has already failed to answer.
  if (state.crash !== undefined) {
    if (intent.kind !== "restart") return withEffect(state, PASS);
    return newRunState();
  }

  // "any key" means any key: the one that starts the run does nothing else, so
  // nobody spends their first move on a keypress they meant as a click. (The
  // shell drops bare modifiers before they ever get here — see `isChord`.)
  if (state.overlay === "title") {
    return { overlay: "none", exploring: false, crash: undefined, effect: IDLE };
  }

  // Any key aborts an explore run, and is swallowed doing it: the key that
  // says "stop" must not also spend the turn the player is stopping for.
  if (state.exploring) {
    return { ...state, exploring: false, effect: { kind: "stopAuto" } };
  }

  switch (intent.kind) {
    case "none":
      return withEffect(state, PASS);
    case "missing":
      return synced({ ...state, effect: { kind: "log", text: missingModuleLine(intent.module) } }, game);
    case "help":
      return synced({ ...state, overlay: state.overlay === "help" ? "none" : "help", effect: IDLE }, game);
    case "dismiss":
      return synced({ ...state, overlay: state.overlay === "help" ? "none" : state.overlay, effect: IDLE }, game);
    case "restart":
      return newRunState();
    case "command":
      // The help card eats the first key that follows it, as it always has.
      if (state.overlay === "help") return synced({ ...state, overlay: "none", effect: IDLE }, game);
      if (game.isOver()) return synced(withEffect(state, IDLE), game);
      return synced({ ...state, effect: { kind: "command", cmd: intent.cmd } }, game);
    case "explore":
      if (state.overlay === "help") return synced({ ...state, overlay: "none", effect: IDLE }, game);
      if (game.isOver()) return synced(withEffect(state, IDLE), game);
      return synced({ ...state, exploring: true, effect: { kind: "explore" } }, game);
    case "fight":
      if (state.overlay === "help") return synced({ ...state, overlay: "none", effect: IDLE }, game);
      if (game.isOver()) return synced(withEffect(state, IDLE), game);
      return synced({ ...state, effect: { kind: "fight" } }, game);
  }
}

/**
 * Re-read the run after a turn has been spent.
 *
 * The ending outranks every overlay except the help card and the error screen,
 * and it has to be re-asserted after every key: opening and closing help on the
 * death screen used to leave the player looking at a dead board with no banner
 * and no hint that shift+R starts a new run.
 */
export function syncStatus(state: AppState, game: Game): AppState {
  return synced(state, game);
}

/** The walk ended on its own: a stop, a refused command, or a run that is over. */
export function walkEnded(state: AppState): AppState {
  return { ...state, exploring: false, effect: IDLE };
}

/**
 * The run is over — not dead, broken. The first failure wins: the exception
 * that broke the renderer must not overwrite the report of the one that broke
 * the turn.
 */
export function crashed(state: AppState, summary: readonly string[]): AppState {
  if (state.crash !== undefined) return state;
  return { overlay: "crash", exploring: false, crash: summary, effect: IDLE };
}

/**
 * The body of the error screen.
 *
 * The seed and the URL are the whole point of it: one pasted line reproduces
 * the run exactly, which is worth more from a jam voter than a stack trace they
 * will not copy. `error` is whatever was thrown — a string, an object, or
 * nothing at all — so this never assumes an `Error`.
 */
export function crashSummary(seed: number, turn: number, url: string, error: unknown): string[] {
  return [`seed ${seed} · turn ${turn}`, "", url, "copy this URL and report it", "", firstLine(error)];
}

/** The headline of an exception, whatever was thrown. Never more than a line. */
export function firstLine(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : stringify(error);
  return text.split("\n")[0]?.trim() || "unknown error";
}

function stringify(error: unknown): string {
  try {
    return String(error);
  } catch {
    // A thrown object with a hostile `toString`. It has said enough.
    return "unknown error";
  }
}

function newRunState(): AppState {
  return { overlay: "none", exploring: false, crash: undefined, effect: { kind: "newRun" } };
}

function withEffect(state: AppState, effect: AppEffect): AppState {
  return { ...state, effect };
}

function synced(state: AppState, game: Game): AppState {
  if (state.crash !== undefined) return state;
  if (state.overlay === "help" || state.overlay === "title") return state;
  const status = game.status;
  if (status === "dead" && state.overlay !== "dead") return { ...state, overlay: "dead" };
  if (status === "won" && state.overlay !== "won") return { ...state, overlay: "won" };
  return state;
}
