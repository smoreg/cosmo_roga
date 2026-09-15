import type { Door, DoorId, RoomCommand, RoomGame, RoomId } from "@jamrog/engine";
import { doorStateWord } from "../content/words.js";
import { isTug } from "../content/tug.js";
import { t } from "../i18n.js";
import {
  ACTION_KEYS,
  doorStands,
  lessonGateOf,
  roomActions,
  tugOnce,
  tugRowIndex,
  swapStands,
  tugStands,
  waysHere,
  type Action,
  type Level,
} from "./actions.js";
import { DOOR_USE, helpPages, missingModuleLine, type UiIntent } from "./input.js";
import { codexFor, type CodexEntry, type CodexId } from "../content/codex.js";
import type { ModuleId } from "../content/modules.js";
import { codexQueue, readCodex, seenCodex } from "../systems/codex.js";
import { rigOf } from "../twist/rig.js";
import { HISTORY_ROWS, historyPages } from "./logline.js";
import { airlockRoom, dangerAhead, passableForPlayer, safeForPlayer, travelRoute } from "./auto.js";
import { doorLevel, doorWays, doorWaysStand, doorsStand, sealBehind, soleWay } from "./doorlist.js";
import { gateRefuses } from "./lessongate.js";
import { lessonStatus } from "../systems/tutorial.js";
import { briefing } from "./lessoncard.js";
import { isTraining } from "../content/tutorial.js";
import { voyageRecord } from "../systems/voyage.js";
import { systemsUp } from "../systems/shipstate.js";
import { OBJECTIVE_COUNT } from "../content/objectives.js";
import { SCREEN_WIDTH } from "./theme.js";
import { virusOf } from "../systems/virus.js";
import {
  DEFAULT_TITLE,
  seedOf,
  seedTyped,
  TITLE_ROWS,
  titleRowAt,
  titleRowOfPick,
  type TitleRowKind,
  type TitleSettings,
} from "./title.js";

/**
 * What the app is showing and what it wants done about the last key — as data,
 * with no DOM anywhere near it.
 *
 * The overlays are the part of the game a test could never reach before: the
 * title, the help card, the endings and the error screen used to live in `App`
 * as private fields mutated by a switch over key events, so "`?` on the death
 * screen loses the banner" was a thing a person had to notice in a browser.
 * Here it is a transition between two values, and `app.ts` is what is left once
 * the transitions are gone: listeners, a timer and a renderer.
 */

/** What is drawn in front of the schematic, if anything. */
export type Overlay =
  | "none"
  | "title"
  | "help"
  /** What is going on here: the `i` card (docs/tasks/G72-codex.md). */
  | "codex"
  /** The message log, all of it, paged: `PageUp` (docs/tasks/G79-gui-kyzrati.md). */
  | "history"
  | "dead"
  | "won"
  | "lost"
  | "sold"
  /**
   * The virus aboard: which strain, what it does, how to be rid of it
   * (docs/tasks/G90-smoreg-wave.md, C2). Raised by itself on the turn the drone
   * catches one, and by `v` or a click on the panel's virus line. Any key puts
   * it away, and none of that is a turn.
   */
  | "virus"
  /**
   * What the job is, on the first frame of a training run (G96, 2): three
   * sentences before step one. Any key puts it away, and none of that is a
   * turn.
   */
  | "brief"
  /**
   * The third system is up and the hull is worth its price the moment it is
   * under tow — which it is not until the drone is out through the airlock
   * (docs/tasks/G95-smoreg-wave.md, B2). Once a run, raised by itself on the
   * turn the last system starts, and any key puts it away.
   */
  | "airlock"
  | "crash";

/** Overlays that mean the run, or this sortie, is over: they outrank the board. */
const ENDINGS: ReadonlySet<Overlay> = new Set<Overlay>(["dead", "won", "lost", "sold"]);

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
  | { kind: "command"; cmd: RoomCommand }
  /** A line for the log, and no turn: a refused action, a module that burned. */
  | { kind: "log"; text: string }
  /**
   * Start the auto-explore walk. The pacing timer belongs to the shell.
   * `through` is a door the walk stopped at last time and the player has now
   * asked past: the first step takes it (`ui/auto.ts`, `makeExplorer`).
   */
  | { kind: "explore"; through?: DoorId }
  /**
   * Cast off with the training prompts on: the second line of the title menu.
   * The shell owns it because a training run is a *new run* with a flag, and
   * making a run is the shell's job (`app.ts`, `newRun`).
   */
  | { kind: "training" }
  /**
   * Walk to a compartment the player named, a turn at a time, until something
   * is worth a decision (`ui/auto.ts`, `makeTraveller`). The same walk the
   * shell already runs for `o`, pointed at a destination. `through` as for
   * `explore`.
   */
  | { kind: "travel"; to: RoomId; through?: DoorId }
  /** One turn of closing in. `melee` is shift+tab: never spend the emitter. */
  | { kind: "fight"; melee: boolean }
  /** Abort a walk in progress. */
  | { kind: "stopAuto" }
  /** The language changed under the whole screen. Redraw, spend nothing. */
  /**
   * New seed, new voyage.
   *
   * `seed` is the number the start screen was told to use, and undefined for
   * "draw one" — which is what `shift+R` has always meant and what an empty
   * seed row means (G84). The shell owns the drawing because `Math.random()` is
   * not allowed anywhere the rules can see (`.claude/CLAUDE.md`).
   */
  | { kind: "newRun"; seed?: number }
  /**
   * The next drawing round the cycle, and the sound on or off: the two rows of
   * the start screen a letter answers to on the keyboard (`V`, `S`) and a click
   * cannot.
   *
   * Effects rather than reducer state for the same reason the keys are read
   * before `toIntent` at all — both are DOM-layer settings the sim must never
   * be told about — and the shell answers for them (`ui/app.ts`, `cycleView`
   * and `flipSound`). Never a turn.
   */
  | { kind: "sound" };

/**
 * A walk that stopped a door short of something and handed the decision over:
 * what was asked of it, and the door it stopped at.
 *
 * The one thing the screen remembers between two keys about a stop, and the
 * whole of the confirmation rule (docs/tasks/G83-anonymous-blows.md, 3): the
 * same ask again — `o` after `o`, the same compartment off the map, the same
 * box clicked — goes through that door; anything that spends a turn or starts
 * a different walk forgets it. A known hazard still stops every walk a door
 * short, so the fifth rule of the hazards holds (`content/hazards.ts`); what
 * changed is that the second press is an answer rather than the same question.
 */
export interface Warning {
  /** `explore`, or `travel:<room>` — as `askOf` words it. */
  readonly ask: string;
  readonly door: DoorId;
}

export interface AppState {
  readonly overlay: Overlay;
  /** True while auto-explore is walking. Any key at all ends it. */
  readonly exploring: boolean;
  /**
   * What the walk in progress was asked to do, in the words of `Warning.ask`,
   * for the stop that may end it to remember. Undefined between walks.
   */
  readonly ask: string | undefined;
  /** The last stop a walk handed over, until a turn is spent or a different walk starts. */
  readonly warned: Warning | undefined;
  /** The crash card's body, or undefined while the run is healthy. */
  readonly crash: readonly string[] | undefined;
  /**
   * The highlighted line of the action list, counting from zero.
   *
   * Never a mode and never a selection the game waits on: the list is drawn
   * with one line bright, `Enter` does that line, and every digit still does
   * its own and takes the highlight with it (docs/tasks/G40-tug-clarity.md, 8).
   */
  readonly cursor: number;
  /**
   * Which compartment of which ship the cursor belongs to, as `ship:room`.
   *
   * A cursor is a position in a list, and the list is built again from nothing
   * the moment the drone goes through a door: line 3 was `go d4` and is now
   * `attack enforcer`. So the highlight goes back to the top whenever the
   * compartment changes, and this is what notices that it did.
   */
  readonly at: string;
  /**
   * What the list is showing one level down, if it is showing anything: a
   * bulkhead's own ways through it, or a tug verb's own modules.
   *
   * The whole of the one level the list has (`ui/actions.ts`), and the only
   * thing about it the app remembers: a door id, or a verb. It is not a mode —
   * no key waits for another, every letter still does what it does, and the
   * level falls away by itself the moment the door, the verb or the compartment
   * stops matching.
   */
  readonly menu: Level | undefined;
  /**
   * True while the list is showing where the drone can walk rather than what it
   * can do here: the level `m` opens (docs/tasks/G48-travel-to-a-room.md).
   *
   * Above `menu` rather than beside it — a bulkhead is reached out of the map
   * as readily as out of the compartment's own list, and `0` then comes back to
   * whichever of the two it was reached from. That is two levels, and this
   * boolean plus that door id is all either of them is: no mode, no key waiting
   * on another, and both fall away by themselves the moment the drone moves.
   */
  readonly moves: boolean;
  /**
   * True while the list is showing the bulkheads of this compartment rather
   * than what can be done in it: the level `d` opens
   * (docs/tasks/G64-door-hotkeys.md).
   *
   * A sibling of `moves` and never both at once — one is where the drone can
   * go, the other is what is in the way — with the same door level underneath
   * either of them, and the same `0` out of it. Like `moves` it is not a mode
   * and falls away by itself: the drone walks out, or the last bulkhead worth
   * a line stops being one (`ui/doorlist.ts`, `doorsStand`).
   */
  readonly doors: boolean;
  /**
   * Which page of the help card is showing, counting from zero.
   *
   * The card outgrew the screen — thirty-eight lines of body in a forty-two row
   * frame — so every key the game gains was a choice between its own line and
   * somebody else's. It pages now (docs/tasks/G48-travel-to-a-room.md), `?`
   * turns the page and closes on the last, and this is the whole of that.
   */
  readonly helpPage: number;
  /**
   * Which page of the history card is showing, counting back from now.
   *
   * Its own number rather than a second use of `helpPage`, because the two
   * cards page in opposite directions — help runs forwards from its first page
   * and the log runs backwards from its last — and a single counter would have
   * meant one of them counting the wrong way to save a field.
   */
  readonly logPage: number;
  /**
   * The cards the `i` window is paging through, as ids, fixed when it opened.
   *
   * A snapshot rather than a live question, and it has to be: opening a card
   * marks it read, so the list of unread cards changes under the reader's
   * hands. What they opened is what they get to finish reading.
   */
  readonly codex: readonly CodexId[];
  /** Which of them is on the screen, counting from zero. */
  readonly codexAt: number;
  /**
   * The two things a sortie can end with, as the run had them last time this
   * looked: drones lost and hulls taken under tow.
   *
   * Counters and not booleans, because both happen more than once a voyage and
   * what the screen has to notice is the *next* one. They are read off the
   * voyage rather than pushed in by whoever caused them, which is why this
   * works down every path the events have — a drone dying mid-walk, a hull sold
   * at the airlock, a death the harness drives — without any of them knowing
   * the screen exists (docs/tasks/G54-two-ships-confusion.md, 6).
   */
  readonly seen: SortieMarks;
  /**
   * What the start screen's menu says about the view, the sound and the seed
   * (G84).
   *
   * Mirrored here rather than owned here: `V`, `S` and the URL are the shell's,
   * because none of the three is a fact the sim or a save file has any business
   * knowing. What the reducer needs is only that the menu can name them, so the
   * shell writes them in with `withSettings` whenever one changes and the title
   * reads them like any other piece of state.
   */
  readonly settings: TitleSettings;
  /**
   * The help card was opened from the start screen, so closing it goes back
   * there rather than into a run nobody has chosen to start.
   *
   * One boolean rather than a stack of screens, because there is one card and
   * one way into it from the title: `3`, or `?`. Every way out of the card asks
   * this — `Esc`, the last page of `?`, and any key at all — so a player who
   * pressed `3`, read the rules and pressed `Esc` is back on the menu they came
   * from. Before this they were in the voyage, having chosen nothing, with no
   * way back (docs/tasks/G86-tutorial-and-title.md, 10).
   */
  readonly titleHelp: boolean;
  /**
   * The digits typed into the seed row so far, or undefined when it is not
   * being typed into.
   *
   * The one place in the game where a key means a character rather than a verb,
   * and it is deliberately the narrowest mode there is: it exists only on the
   * title, it is announced by the row it is on, `Esc` leaves it and `Enter`
   * ends it. A run cannot start from under it, so nothing about a turn or a
   * replay can reach it.
   */
  readonly seedText: string | undefined;
  /**
   * The compartment under the mouse on the honeycomb, if any: aimed at the way
   * the highlighted line of the list aims, and drawn with the route to it, but
   * never a turn (G90 D4). Set by the page only (`hovered`) and dropped by the
   * next key or click, so a pointer resting on the map cannot outvote the arrows.
   */
  readonly hover?: RoomId | undefined;
  /**
   * Whether this run has already been shown the airlock card.
   *
   * Once a run and not once a hull: the rule it states does not change, and the
   * second telling is a card in the way of a player who already walked out with
   * the money once. Here rather than on the drone because it is about what has
   * been *read*, and because a fresh run is a fresh state (`newRunState`) — a
   * save reloaded mid-hull never sees it twice either, since the marks are read
   * afresh off the game and the edge it is raised on is already behind them.
   */
  readonly airlockTold: boolean;
  /** The last transition's output. Recomputed on every step; never history. */
  readonly effect: AppEffect;
}

/** Drones lost and hulls sold over the voyage so far, and whether the drone is infected. */
export interface SortieMarks {
  readonly lost: number;
  readonly sold: number;
  /**
   * The third thing a turn can raise a card for: the drone carrying a virus it
   * was not carrying the last time this looked (G90). A boolean, because one
   * virus per drone is the rule (`systems/virus.ts`) and what is noticed is the
   * edge from clean to infected, however the last one was got rid of.
   */
  readonly infected: boolean;
  /**
   * Every system of the hull the drone is standing in is up. False at home and
   * on a hull with work left, so the edge into it is the turn the third system
   * starts — the moment the whole price of the hull becomes a thing that can
   * still be lost by staying aboard.
   */
  readonly online: boolean;
}

const NO_MARKS: SortieMarks = { lost: 0, sold: 0, infected: false, online: false };

/**
 * What the run has to show for itself, counted off the voyage record.
 *
 * Read through `voyageRecord`, which never creates one: this is asked on every
 * key, including on ships that have no voyage at all (the hand-drawn hulls of
 * the tests), and a question must never be the thing that starts a run.
 */
function marksOf(game: RoomGame): SortieMarks {
  const infected = virusOf(game.player) !== undefined;
  // Aboard only, and off the ship's own record rather than the voyage's copy of
  // it: the copy is written when the drone leaves (`systems/voyage.ts`,
  // `returnToTug`), which is a turn too late for a card about not leaving yet.
  const online = !isTug(game) && systemsUp(game) >= OBJECTIVE_COUNT;
  const voyage = voyageRecord(game);
  if (!voyage) return { ...NO_MARKS, infected, online };
  return {
    lost: voyage.state.reduce((n, s) => n + s.deaths.length, 0),
    sold: voyage.state.filter((s) => s.sold).length,
    infected,
    online,
  };
}

const IDLE: AppEffect = { kind: "idle" };
const PASS: AppEffect = { kind: "pass" };

/**
 * Leaving the title: the same state whichever line was pressed — and, over a
 * training run that has not moved, the card that says what the job is.
 */
function started(state: AppState, game: RoomGame): AppState {
  return {
    ...state,
    seedText: undefined,
    titleHelp: false,
    overlay: briefing(game) ? "brief" : "none",
    exploring: false,
    ask: undefined,
    warned: undefined,
    crash: undefined,
    cursor: 0,
    at: placeOf(game),
    menu: undefined,
    moves: false,
    doors: false,
    helpPage: 0,
    logPage: 0,
    codex: [],
    codexAt: 0,
    seen: marksOf(game),
    airlockTold: false,
    effect: IDLE,
  };
}

/**
 * A session before its first key: the run exists, the title sits in front of it.
 *
 * `settings` is what the shell resolved off the URL and the store before the
 * first frame — the view, the sound, the seed of the run behind the title. A
 * test that does not care passes nothing and gets the defaults.
 */
export function initialState(settings: TitleSettings = DEFAULT_TITLE): AppState {
  return {
    settings,
    seedText: undefined,
    titleHelp: false,
    overlay: "title",
    exploring: false,
    ask: undefined,
    warned: undefined,
    crash: undefined,
    cursor: 0,
    at: "",
    menu: undefined,
    moves: false,
    doors: false,
    helpPage: 0,
    logPage: 0,
    codex: [],
    codexAt: 0,
    seen: NO_MARKS,
    airlockTold: false,
    effect: IDLE,
  };
}

/**
 * The shell's own three settings, written into the state so the menu can name
 * them. Never a turn and never anything else: `V`, `S` and a new seed each
 * change one field and redraw.
 */
export function withSettings(state: AppState, settings: TitleSettings): AppState {
  return { ...state, settings, effect: IDLE };
}

/** The row a `pick` presses, if any: the four the menu gives a digit to. */
function pickedRow(intent: UiIntent): TitleRowKind | undefined {
  return intent.kind === "pick" ? titleRowOfPick(intent.index) : undefined;
}

/**
 * One row of the start screen, whichever way it was reached.
 *
 * Written once for the digit and the click, so a mouse cannot end up with a
 * menu of its own: the four numbered rows do what their key does, and the three
 * lettered ones hand the shell the setting it owns (`ui/app.ts`).
 */
function titleRow(state: AppState, game: RoomGame, row: TitleRowKind): AppState {
  switch (row) {
    case "voyage":
      return started(state, game);
    case "training":
      return { ...started(state, game), effect: { kind: "training" } };
    case "help":
      // Remembered, so `Esc` and the last page of `?` come back here.
      return { ...state, overlay: "help", helpPage: 0, titleHelp: true, effect: IDLE };
    case "seed":
      return { ...state, seedText: "", effect: IDLE };
    case "sound":
      return { ...state, effect: { kind: "sound" } };
  }
}

/**
 * A key while the seed row is being typed into.
 *
 * The narrowest mode in the game, and the rules are the four a text field has:
 * a digit is a character, `Backspace` rubs one out, `Enter` ends it, `Esc`
 * leaves it as it was. Everything else is swallowed — the whole point of
 * pressing `4` is that the next `q` is not "any key casts off" — and nothing
 * here can spend a turn, because there is no turn to spend in front of a run
 * that has not started.
 */
function typingSeed(state: AppState, intent: UiIntent): AppState {
  if (intent.kind === "dismiss") return { ...state, seedText: undefined, effect: IDLE };
  if (intent.kind === "erase") {
    return { ...state, seedText: state.seedText!.slice(0, -1), effect: IDLE };
  }
  if (intent.kind === "confirm") {
    const seed = seedOf(state.seedText!);
    // An empty field is the random option: `Enter` on it draws a ship rather
    // than doing nothing, so "another one, whichever" needs no key of its own.
    return { ...state, seedText: undefined, effect: { kind: "newRun", ...(seed === undefined ? {} : { seed }) } };
  }
  if (intent.kind === "pick") {
    const digit = ACTION_KEYS[intent.index];
    if (digit === undefined) return withEffect(state, IDLE);
    return { ...state, seedText: seedTyped(state.seedText!, digit), effect: IDLE };
  }
  return withEffect(state, IDLE);
}

/**
 * The list as the player is looking at it: the compartment, its doors, or one
 * of those doors.
 */
export function listOf(game: RoomGame, state: AppState): Action[] {
  return listFor(game, state.menu, state.moves, state.doors, state.cursor);
}

/**
 * The three lists there are, and which one a level names: the compartment's own
 * doings, where the drone can walk, the bulkheads of this compartment — and,
 * under any of them, the one bulkhead whose own ways through it are showing.
 *
 * The door level is dispatched here rather than inside `roomActions` for one
 * reason, and it is a rule of this repo rather than a preference: `ui/doorlist.ts`
 * is built out of `ui/actions.ts`, so `ui/actions.ts` asking it for a list would
 * close an import cycle (`.claude/CLAUDE.md`, "Как добавить контент"). Every
 * renderer already reads the list through `listOf`, so nothing else changes.
 */
function listFor(
  game: RoomGame,
  menu: Level | undefined,
  moves: boolean,
  doors: boolean,
  cursor = 0,
): Action[] {
  if (doors) {
    if (menu === undefined) return doorLevel(game, cursor);
    // A bulkhead reached off `d` can be one the drone could walk through, and
    // those have ways of their own the map's sublist never has to know about.
    if (typeof menu !== "string") return doorWays(game, menu, cursor) ?? doorLevel(game, cursor);
  }
  return roomActions(game, menu, moves, cursor);
}

/**
 * The compartment the highlighted line points at, if it points at one.
 *
 * The map's half of choosing where to walk: `m` opens the list of compartments,
 * the arrows move the highlight, and the box the highlight belongs to lights up
 * on the schematic — so the choice is made looking at the ship rather than at a
 * column of names ("после m направление куда идём выбираем на карте", and
 * "на m надо подсвечивать в какой блок идём" — the owner).
 *
 * Undefined on every list that is not the map, which is most of them: a row
 * that does not point at a compartment lights nothing, rather than leaving the
 * last lit box behind as a lie.
 */
export function aimedAt(game: RoomGame, state: AppState): RoomId | undefined {
  return state.hover ?? listOf(game, state)[state.cursor]?.leadsTo;
}

/** What the map is pointed at: the compartment, and the doors of the walk there. */
export interface MapAim {
  readonly room: RoomId | undefined;
  readonly route: ReadonlySet<DoorId>;
}

const NO_ROUTE: ReadonlySet<DoorId> = new Set();

/**
 * The aim, with the way to it: the doors a walk there would take, in the order
 * `travelRoute` plans them — round a known hazard before through one, as the
 * walk itself does (`ui/auto.ts`, `makeTraveller`). The owner could not tell
 * where a click would take the drone («движение не очевидно»); the honeycomb
 * draws these doors amber and the destination dashed (G90 D4).
 */
export function mapAim(game: RoomGame, state: AppState): MapAim {
  const room = aimedAt(game, state);
  const here = game.player.room;
  if (room === undefined || here === undefined || room === here) return { room, route: NO_ROUTE };
  if (isTug(game) || game.status !== "playing") return { room, route: NO_ROUTE };
  const doors = travelRoute(game.ship, here, room, safeForPlayer(game)) ?? [];
  return { room, route: new Set(doors.map((d) => d.id)) };
}

/**
 * The pointer came to rest on a compartment of the honeycomb, or left one.
 * Nothing but the aim changes, and nothing is asked of the run; in front of a
 * card there is no map to aim at.
 */
export function hovered(state: AppState, room: RoomId | undefined): AppState {
  const next = state.overlay === "none" ? room : undefined;
  return state.hover === next ? state : { ...state, hover: next };
}

/**
 * The line a digit or a click names.
 *
 * Position and digit are the same thing on the compartment's own list and part
 * company everywhere else — one level down `0` is the way back however few
 * entries there are, and past the tenth row there is no digit at all. So they
 * are two intents: a click carries the position (`ui/web/panel-html.ts`,
 * `data-line`), a key carries the digit and `lineFor` looks up who is wearing
 * it.
 */
function lineAt(list: readonly Action[], index: number): Action | undefined {
  return list[index];
}

/** The line a digit names: whichever row is wearing that key right now. */
function lineFor(list: readonly Action[], digit: number): number {
  const key = ACTION_KEYS[digit];
  return key === undefined ? -1 : list.findIndex((a) => a.key === key);
}

/** Where the drone is standing, in the one string the cursor is pinned to. */
function placeOf(game: RoomGame): string {
  return `${game.shipId}:${game.player.room ?? "?"}`;
}

/** The highlight, moved and wrapped. An empty list keeps it at the top. */
function moved(cursor: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((cursor + delta) % length) + length) % length;
}

/**
 * The highlight on a list of actions, moved to the next row that can be
 * pressed — past every greyed one, which `Enter` could only refuse (G90 D5).
 * A list with nothing pressable on it moves row by row, as it always did, and
 * the page draws that cursor dim rather than amber.
 */
function movedOn(list: readonly Action[], cursor: number, delta: number): number {
  const length = list.length;
  if (length <= 0) return 0;
  if (!list.some((a) => a.enabled)) return moved(cursor, delta, length);
  let at = cursor;
  for (let i = 0; i < length; i++) {
    at = moved(at, delta, length);
    if (list[at]!.enabled) return at;
  }
  return cursor;
}

/**
 * The first pressable row at or after `cursor`, wrapping round: where a reset
 * to the top, a clamp or a list that changed under the highlight puts it.
 * The row itself when nothing on the list can be pressed.
 */
function pressableFrom(list: readonly Action[], cursor: number): number {
  const length = list.length;
  if (length <= 0) return 0;
  const from = Math.min(Math.max(cursor, 0), length - 1);
  for (let i = 0; i < length; i++) {
    const at = (from + i) % length;
    if (list[at]!.enabled) return at;
  }
  return from;
}

/**
 * One key press, as a state transition.
 *
 * `game` is read, never written: the reducer asks it what can be done here and
 * whether the run is over, and nothing else. Everything that spends a turn
 * comes back as an effect.
 */
export function appReducer(state: AppState, intent: UiIntent, game: RoomGame): AppState {
  // Every key and every click drops the pointer's aim: whatever the player
  // just did is what the map should be pointing at now.
  const next = reduce(state, intent, game);
  return next.hover === undefined ? next : { ...next, hover: undefined };
}

function reduce(state: AppState, intent: UiIntent, game: RoomGame): AppState {
  if (state.crash !== undefined) {
    if (intent.kind !== "restart") return withEffect(state, PASS);
    return newRunState(state);
  }

  // The start screen: a menu where every row is a key. `1` casts off, `2` casts
  // off with the training prompts on, `3` opens the help card and comes back,
  // `4` types a seed; the space bar and the digits no row wears cast off too,
  // and nothing else does (docs/tasks/G88-polish-by-map.md, B3). (`L`, `V`, `S`
  // and `` ` `` never reach here: the shell reads them first, and bare
  // modifiers are dropped by `isChord`.)
  if (state.overlay === "title") {
    if (state.seedText !== undefined) return typingSeed(state, intent);
    // A digit names a key and a click names a row, and on this screen the two
    // reach further apart than they do in the action list: four rows wear a
    // digit, seven can be clicked. `L`, `V` and `S` are the other three, and
    // the mouse has no way to press a letter.
    const row = intent.kind === "line" ? titleRowAt(intent.index) : pickedRow(intent);
    if (row !== undefined) return titleRow(state, game, row);
    // A click that landed on no row at all changes nothing. It must not cast
    // off: "any key starts" is a promise about the keyboard, and a mouse that
    // began a run by missing a menu line would be the opposite of one.
    if (intent.kind === "line") return withEffect(state, IDLE);
    // The idiom every other screen of this game keeps: the arrows move the
    // highlight, `Enter` does the line it is on. The title was the one screen
    // where it was off — the arrows and `Enter` fell through into "any key
    // casts off", so a player looking for the menu flew out of the dock instead
    // and the menu had no highlight to look for (G86, 11).
    if (intent.kind === "cursor") {
      return { ...state, cursor: moved(state.cursor, intent.delta, TITLE_ROWS.length), effect: IDLE };
    }
    if (intent.kind === "confirm") {
      const lit = titleRowAt(state.cursor);
      return lit === undefined ? withEffect(state, IDLE) : titleRow(state, game, lit);
    }
    // `?` is the key the block of controls on this very screen advertises, and
    // it used to cast off (G86, 13). The sideways arrows and `Esc` are the
    // other three keys excluded from "any key starts": a player reaching for
    // the highlight, or backing out of nothing, has not asked for a voyage.
    if (intent.kind === "help") return titleRow(state, game, "help");
    // What still casts off without a row of its own: the digits no row wears,
    // and the space bar. Every other key used to as well, which is how a player
    // reaching for a letter found themselves in a voyage nobody had chosen.
    // (`.` shares the space bar's intent and comes along with it.)
    const go = intent.kind === "pick" || (intent.kind === "command" && intent.cmd.kind === "wait");
    // Whatever the run has already done, the first key is not the moment to
    // announce it: the title sits in front of a voyage that has not started.
    return go ? started(state, game) : withEffect(state, IDLE);
  }

  // A sortie's own ending is a card and not a mode: any key at all puts it
  // away and spends nothing, exactly as the title does. It is never the end of
  // the run — the tug buys another drone if the account can carry one — so it
  // must not sit on the screen the way `dead` and `won` do.
  if (state.overlay === "lost" || state.overlay === "sold") {
    return synced({ ...state, overlay: "none", effect: IDLE }, game);
  }
  // The virus window, the lesson's opening card and the airlock card are the
  // same kind of card: read, and any key — `Esc`, the `v` that opened one, a
  // click — puts it away without doing anything else.
  if (state.overlay === "virus" || state.overlay === "brief" || state.overlay === "airlock") {
    return synced({ ...state, overlay: "none", effect: IDLE }, game);
  }

  // Any key aborts an explore run, and is swallowed doing it: the key that
  // says "stop" must not also spend the turn the player is stopping for.
  if (state.exploring) {
    return { ...state, exploring: false, effect: { kind: "stopAuto" } };
  }

  switch (intent.kind) {
    case "none":
    // `Backspace` is only ever a character rubbed out of the seed row, and
    // that row lives on the title, which never reaches this switch. Off the
    // title the key belongs to the browser, exactly as it always did.
    case "erase":
      return withEffect(state, PASS);
    case "missing":
      return synced({ ...state, effect: { kind: "log", text: missingModuleLine(intent.module) } }, game);
    case "help":
      return synced(helpTurned(state, game), game);
    case "codex": {
      // The card is in front of the board like the help card, so it takes the
      // same first question: the run being over outranks it, and a card already
      // open is closed by the key that would open one.
      const stop = stopped(state, game);
      if (stop) return stop;
      return synced(codexOpened(state, game), game);
    }
    case "history":
      return synced(historyTurned(state, game, intent.delta), game);
    case "virus": {
      const stop = stopped(state, game);
      if (stop) return stop;
      return synced(virusOpened(state, game), game);
    }
    case "dismiss":
      // Escape closes what is in front of the board first, and then takes the
      // list back up a level: the two are never on the screen at once, so one
      // key is enough for both and neither of them is a turn.
      if (state.overlay === "help") return synced(helpClosed(state), game);
      if (state.overlay === "codex") return synced(codexClosed(state), game);
      if (state.overlay === "history") return synced(closedHistory(state), game);
      if (state.menu !== undefined || state.moves || state.doors) return upALevel(state, game);
      // With nothing in front of the board and no level to leave, the key does
      // nothing. The lesson's window used to fold on it; the window is the
      // lesson, and hiding it taught nothing (G96, 5).
      return synced({ ...state, effect: IDLE }, game);
    case "restart":
      return newRunState(state);
    case "page":
      // The sideways arrows, which do one thing and only in front of a card.
      // Anywhere else they are the dead keys they have always been, and the
      // browser is welcome to them.
      if (state.overlay === "codex") return codexTurned(state, game, intent.delta);
      return withEffect(state, PASS);
    case "cursor":
      // With a card open the arrows turn its page instead of moving the
      // highlight: the list behind it is not what the player is looking at, and
      // a highlight that moved under a window is a highlight that has moved by
      // the time the window closes.
      if (state.overlay === "codex") return codexTurned(state, game, intent.delta);
      // No turn and no effect: moving the highlight is the one thing in this
      // game that costs nothing at all.
      return synced(
        {
          ...state,
          cursor: movedOn(listFor(game, state.menu, state.moves, state.doors), state.cursor, intent.delta),
          effect: IDLE,
        },
        game,
      );
    case "moves": {
      // Where the drone can walk, or back out of it. Neither is a turn,
      // and one key does both: `m` is the way in and the way out of a level
      // that exists to save keystrokes, so it must not cost one to leave.
      //
      // `stopped` first, as every other key that changes the board does: the
      // help card eats the press that closes it, and a run that is over has no
      // doors to list.
      const stop = stopped(state, game);
      if (stop) return stop;
      if (isTug(game)) return nowhereToWalk(state, game);
      return synced(
        { ...state, moves: !state.moves, doors: false, menu: undefined, cursor: 0, effect: IDLE },
        game,
      );
    }
    case "doors": {
      // The bulkheads of this compartment, or back out of them: one key both
      // ways, as `m` is for the map, and neither way is a turn.
      const stop = stopped(state, game);
      if (stop) return stop;
      if (isTug(game)) return nowhereToWalk(state, game);
      if (state.doors) {
        return synced({ ...state, doors: false, menu: undefined, cursor: 0, effect: IDLE }, game);
      }
      // One bulkhead with one way through it is not a list. Opening a level to
      // read a single line and then press it is the keystroke this level exists
      // to save — the rule `tugRow` and `doorRow` already keep.
      const only = soleWay(game);
      if (only !== undefined) return act(state, game, () => ({ kind: "command", cmd: only.cmd }));
      if (!doorsStand(game)) {
        return synced({ ...state, effect: { kind: "log", text: t("why.door.noneHere") } }, game);
      }
      return synced({ ...state, doors: true, moves: false, menu: undefined, cursor: 0, effect: IDLE }, game);
    }
    case "seal": {
      // Shut the way you came. The rules own every refusal and every turn it
      // costs (`ui/doorlist.ts`, `sealBehind`); this only decides that a hull
      // is what the key is about.
      const stop = stopped(state, game);
      if (stop) return stop;
      if (isTug(game)) return nowhereToWalk(state, game);
      return act(state, game, () => {
        const sealing = sealBehind(game);
        return sealing.ok ? { kind: "command", cmd: sealing.cmd } : { kind: "log", text: sealing.why };
      });
    }
    case "confirm":
      return chosen(state, game, state.cursor);
    case "pick": {
      // The digit does the line and leaves the highlight on it, so pressing a
      // number and then `Enter` twice is not two different things. Which line
      // wears which digit depends on where the window is (`windowStart`), so
      // the digit is looked up rather than counted from the top — and a digit
      // no line is wearing falls through to `chosen`, which says so and spends
      // nothing, exactly as it did when the tenth line was the last there was.
      const stop = stopped(state, game);
      if (stop) return stop;
      const at = lineFor(listOf(game, state), intent.index);
      return at < 0 ? chosen(state, game, -1) : chosen({ ...state, cursor: at }, game, at);
    }
    case "line": {
      // A click names the row it landed on, and there is nothing to look up:
      // the mouse can see the list. It takes the highlight with it, exactly as
      // a digit does, so a click and then `Enter` is not two different things.
      const stop = stopped(state, game);
      if (stop) return stop;
      const list = listOf(game, state);
      // A click on a row the frame no longer has — the page redrew between the
      // press and the release — is not the player asking for anything.
      if (intent.index < 0 || intent.index >= list.length) return withEffect(state, PASS);
      return chosen({ ...state, cursor: intent.index }, game, intent.index);
    }
    case "room": {
      const stop = stopped(state, game);
      if (stop) return stop;
      return roomClicked(state, game, intent.id);
    }
    case "door": {
      const stop = stopped(state, game);
      if (stop) return stop;
      return doorClicked(state, game, intent.id);
    }
    case "module":
      return act(state, game, () => ({ kind: "command", cmd: aimed(game, intent.module, intent.slot) }));
    case "exit":
      return act(state, game, () => leaving(game), true);
    case "keycard":
      return act(state, game, () => {
        const cmd = keycardHere(game);
        return cmd ? { kind: "command", cmd } : { kind: "log", text: t("why.door.noKeycardHere") };
      });
    case "command":
      return act(state, game, () => ({ kind: "command", cmd: intent.cmd }));
    // The card in front of the board eats these as it eats every other key
    // (`stopped`); at home the answer used to be written behind a card that
    // stayed open.
    case "explore":
      return stopped(state, game) ?? (isTug(game) ? nowhereToWalk(state, game) : act(state, game, () => ({ kind: "explore" }), true));
    case "fight":
      return stopped(state, game) ?? (isTug(game) ? nowhereToWalk(state, game) : act(state, game, () => ({ kind: "fight", melee: intent.melee })));
  }
}

/**
 * A box on the map, clicked.
 *
 * Mostly that box's line of the move list, pressed — which is what keeps the
 * mouse from being a second set of rules: one open door away it steps, further
 * away it walks, and with a bulkhead in the way it opens that bulkhead's own
 * list of methods, exactly as the row does. A neighbour nobody has been in is
 * still the far side of one of this compartment's doors, and that door's row is
 * what the click presses (docs/tasks/G88-polish-by-map.md, B1).
 *
 * The rest used to do nothing at all (G90 D3): the box underfoot opens its own
 * list at the top, and a box nobody has named is walked towards — to the last
 * compartment on the way there the drone can name, or through the first door
 * on the way when it can name none — and a box with no way to it says so.
 */
function roomClicked(state: AppState, game: RoomGame, id: RoomId): AppState {
  if (isTug(game)) return withEffect(state, PASS);
  const here = game.roomOf(game.player).id;
  if (id === here) {
    return synced({ ...state, moves: false, doors: false, menu: undefined, cursor: 0, effect: IDLE }, game);
  }
  const map = roomActions(game, undefined, true);
  const at = map.findIndex((line) => line.leadsTo === id);
  if (at >= 0) return chosen({ ...state, moves: true, doors: false, menu: undefined, cursor: at }, game, at);
  const own = roomActions(game).findIndex((line) => line.leadsTo === id);
  if (own >= 0) return chosen({ ...state, moves: false, doors: false, menu: undefined, cursor: own }, game, own);

  const room = game.ship.rooms[id];
  const route = room === undefined ? undefined : travelRoute(game.ship, here, id);
  if (room === undefined || route === undefined || route.length === 0) {
    const label = room?.label ?? String(id);
    return synced({ ...state, effect: { kind: "log", text: t("why.room.noRoute", { room: label }) } }, game);
  }
  const toward = lastNamed(game, here, route);
  if (toward !== undefined) return roomClicked(state, game, toward);
  // The first door on the way leads somewhere nobody has named either: its row.
  const first = game.ship.other(route[0]!, here);
  const step = roomActions(game).findIndex((line) => line.leadsTo === first);
  if (step >= 0) return chosen({ ...state, moves: false, doors: false, menu: undefined, cursor: step }, game, step);
  return synced({ ...state, effect: { kind: "log", text: t("why.room.noRoute", { room: room.label }) } }, game);
}

/**
 * The furthest compartment along a route that the drone could name, walking
 * out from here and stopping at the first it could not: the move list has a
 * row for exactly those (`ui/actions.ts`, `known`), so the click lands on one.
 */
function lastNamed(game: RoomGame, here: RoomId, route: readonly Door[]): RoomId | undefined {
  let at = here;
  let last: RoomId | undefined;
  for (const door of route) {
    at = game.ship.other(door, at);
    const room = game.ship.roomAt(at);
    if (!(room.explored || room.scanned || game.visible.has(at))) break;
    last = at;
  }
  return last;
}

/**
 * A door on the honeycomb, clicked — its corridor, its tag or a link's chip.
 *
 * One of this compartment's: the list goes to that door's own row, on `d`
 * when the doors have a list and on the compartment's own list otherwise, and
 * a row that cannot be pressed also says why — the highlight does not rest on
 * a greyed row, so the line is the answer. A door elsewhere is the nearer of
 * its two compartments, clicked. Never a turn by itself.
 */
function doorClicked(state: AppState, game: RoomGame, id: DoorId): AppState {
  if (isTug(game)) return withEffect(state, PASS);
  const door = game.ship.doors[id];
  if (door === undefined) return withEffect(state, PASS);
  const here = game.roomOf(game.player).id;
  if (door.a !== here && door.b !== here) {
    const far = (room: RoomId): number => travelRoute(game.ship, here, room)?.length ?? Number.POSITIVE_INFINITY;
    return roomClicked(state, game, far(door.a) <= far(door.b) ? door.a : door.b);
  }
  const onRow = (doors: boolean, list: readonly Action[], at: number): AppState => {
    const row = list[at]!;
    const effect: AppEffect = row.enabled ? IDLE : { kind: "log", text: row.why ?? t("why.notHere") };
    return synced({ ...state, doors, moves: false, menu: undefined, cursor: at, effect }, game);
  };
  if (doorsStand(game)) {
    const list = doorLevel(game);
    const at = list.findIndex((row) => aboutDoor(row, door));
    if (at >= 0) return onRow(true, list, at);
  }
  const list = roomActions(game);
  const at = list.findIndex((row) => aboutDoor(row, door));
  if (at >= 0) return onRow(false, list, at);
  const why = t("why.door.state", { door: door.label, state: doorStateWord(door.state) });
  return synced({ ...state, effect: { kind: "log", text: why } }, game);
}

/** Is this row about that door: its step, its way through, or the airlock's `leave`? */
function aboutDoor(row: Action, door: Door): boolean {
  if (row.step === door.id) return true;
  const cmd = row.cmd;
  if (cmd.kind === "go") return cmd.door === door.id;
  if (cmd.kind === "leave") return door.state === "airlock";
  return cmd.kind === "act" && cmd.target === door.id && row.ways !== undefined;
}

/**
 * `?`, which opens the card, turns its page, and closes it on the last one.
 *
 * One key for all three because there is no room for a second: every letter on
 * the keyboard that a roguelike player might press has a meaning already or is
 * deliberately dead (`ui/input.ts`), and the card itself says which of the
 * three the next `?` will do (`helpFooter`).
 */
function helpTurned(state: AppState, game: RoomGame): AppState {
  if (state.overlay !== "help") return { ...state, overlay: "help", helpPage: 0, effect: IDLE };
  const pages = helpPages(isTug(game), codexSeen(game)).length;
  if (state.helpPage + 1 < pages) return { ...state, helpPage: state.helpPage + 1, effect: IDLE };
  return helpClosed(state);
}

/**
 * The card, put away — onto whatever was behind it.
 *
 * Which is the board in a run and the start screen when that is where it was
 * opened from. Written once and asked by all three ways out, because the bug
 * was three separate `overlay: "none"`s and a comment promising otherwise
 * (docs/tasks/G86-tutorial-and-title.md, 10).
 */
function helpClosed(state: AppState): AppState {
  return {
    ...state,
    overlay: state.titleHelp ? "title" : "none",
    helpPage: 0,
    titleHelp: false,
    effect: IDLE,
  };
}

// -------------------------------------------------- what is going on here (G72)

/**
 * `i`, which opens the card for whatever the run has just shown and not
 * explained (`content/codex.ts`, `systems/codex.ts`).
 *
 * The one place the reducer writes to the run rather than reading it, and it is
 * deliberate: what has been read is per-run state that has to survive a save
 * (`player.data.codex`), and marking it here is what makes the badge go down on
 * the same frame the card comes up. It spends no turn, writes no line and
 * touches nothing the rules read, so the contract this file keeps — the sim
 * moves only through an effect — is untouched.
 *
 * With nothing waiting the key still does something, and what it does is the
 * help card: that is where the list of everything this voyage has shown lives
 * once the badge has stopped counting it (`ui/input.ts`, `helpBlocks`).
 */
function codexOpened(state: AppState, game: RoomGame): AppState {
  const queue = codexQueue(game);
  if (queue.length === 0) return { ...state, overlay: "help", helpPage: 0, effect: IDLE };
  const first = queue[0]!;
  readCodex(game, first);
  return { ...state, overlay: "codex", codex: queue, codexAt: 0, effect: IDLE };
}

/** The arrows, over the cards this window opened with. Wraps at both ends. */
function codexTurned(state: AppState, game: RoomGame, delta: number): AppState {
  const cards = state.codex;
  if (cards.length === 0) return synced(codexClosed(state), game);
  const at = moved(state.codexAt, delta, cards.length);
  readCodex(game, cards[at]!);
  return synced({ ...state, codexAt: at, effect: IDLE }, game);
}

/**
 * `v`: the virus window, or one line saying there is nothing to show.
 *
 * A line rather than silence for the same reason every refused key gets one:
 * a key that does nothing teaches nothing, and a clean rack is the answer.
 */
function virusOpened(state: AppState, game: RoomGame): AppState {
  if (virusOf(game.player) === undefined) return { ...state, effect: { kind: "log", text: t("why.virus.none") } };
  return { ...state, overlay: "virus", exploring: false, effect: IDLE };
}

/** Put it away, and drop the snapshot with it: the next `i` asks again. */
function codexClosed(state: AppState): AppState {
  return { ...state, overlay: "none", codex: [], codexAt: 0, effect: IDLE };
}

/**
 * Everything this voyage has shown, by name, for the block at the foot of the
 * help card. Already in the language that is on, because the card is redrawn
 * whenever `L` changes it.
 */
export function codexSeen(game: RoomGame): string[] {
  return seenCodex(game)
    .map((id) => codexFor(id))
    .filter((entry): entry is CodexEntry => entry !== undefined)
    .map((entry) => t(entry.title));
}

/** What the `i` window is showing, or nothing when it is not open. */
export interface CodexView {
  readonly entry: CodexEntry;
  /** Modules in the rack right now: the ones the card marks as answers to hand. */
  readonly fitted: ReadonlySet<ModuleId>;
  readonly page: number;
  readonly pages: number;
}

/**
 * The card, for whichever view is drawing it.
 *
 * Both renderers ask this and neither decides anything: the terminal draws it
 * in a frame of dots and the page draws it in a `card` div, and the words,
 * their order and their line breaks are the same either way — the rule this
 * game keeps everywhere else about the two views (`ui/web/screen.ts`).
 */
export function codexView(game: RoomGame, state: AppState): CodexView | undefined {
  if (state.overlay !== "codex") return undefined;
  const entry = codexFor(state.codex[state.codexAt]);
  if (entry === undefined) return undefined;
  const rig = rigOf(game.player);
  const fitted = new Set<ModuleId>();
  for (const slot of rig?.slots ?? []) if (slot !== null) fitted.add(slot.kind);
  return { entry, fitted, page: state.codexAt, pages: state.codex.length };
}

/**
 * `PageUp` and `PageDown`: the log's own past, opened and paged
 * (docs/gui-guides.md, "Что применить", B).
 *
 * `PageUp` opens the card and then walks back through it a screen at a time;
 * `PageDown` walks towards now and is not a way in — a key that means "later"
 * cannot open a card at the latest thing there is, and left to the browser it
 * still scrolls the page a voter is reading the game on.
 *
 * Neither is ever a turn, and neither clamps at a page that does not exist:
 * paging past the top of a log holds at the top, which is what every reader
 * expects and what keeps the card from going blank in a run with two lines in
 * it. Closing it is `Esc`, or any key that does something else.
 */
function historyTurned(state: AppState, game: RoomGame, delta: number): AppState {
  if (state.overlay !== "history") {
    if (delta < 0) return withEffect(state, PASS);
    return { ...state, overlay: "history", logPage: 0, effect: IDLE };
  }
  const pages = historyPages(game.log.lines, HISTORY_ROWS).length;
  const at = Math.min(Math.max(state.logPage + delta, 0), pages - 1);
  return { ...state, logPage: at, effect: IDLE };
}

/**
 * The history card, put away. Never a turn: it never spent one to open.
 *
 * Onto the start screen when that is where the help card it replaced was
 * opened from: `3`, `PageUp`, `Esc` used to land in a voyage nobody had
 * started, with `titleHelp` still set (docs/tasks/G88-polish-by-map.md, B2).
 */
function closedHistory(state: AppState): AppState {
  return { ...state, overlay: state.titleHelp ? "title" : "none", titleHelp: false, logPage: 0, effect: IDLE };
}

/**
 * The answer the tug gives to every key that belongs to the other mode: `m`,
 * `o`, `Tab` and `<`.
 *
 * Not silence, and not a turn. The two halves of this game are played with
 * different keys — aboard a hull walking is the game, at home there is nowhere
 * to walk and nothing to fight (docs/tasks/G53-tug-is-a-menu.md, 2) — and a key
 * that does nothing at all teaches nothing about which half you are in. One
 * line in the log says it and points at the list.
 */
function nowhereToWalk(state: AppState, game: RoomGame): AppState {
  return synced({ ...state, effect: { kind: "log", text: t("why.tug.noWalk") } }, game);
}

/**
 * The two keys that never reach the game: the one the help card eats, and any
 * of them once the run is over.
 */
function stopped(state: AppState, game: RoomGame): AppState | undefined {
  if (state.overlay === "help") return synced(helpClosed(state), game);
  // The `i` card behaves exactly as the help card does: it is in front of the
  // board, so the key that puts it away is any key at all, and that key does
  // nothing else. Which also makes `i` its own way out.
  if (state.overlay === "codex") return synced(codexClosed(state), game);
  if (state.overlay === "history") return synced(closedHistory(state), game);
  if (game.isOver()) return synced(withEffect(state, IDLE), game);
  return undefined;
}

/**
 * A line of the list, chosen by its digit, by the mouse or by `Enter`.
 *
 * Three things can be on that line and only one of them is a turn: a bulkhead
 * that steps the list into its own methods, the line back out of them, and
 * everything else. The two that move the list are read first and cost nothing —
 * the turn is spent by the method the player picks once they are looking at it,
 * which is the whole point of the level existing.
 */
function chosen(state: AppState, game: RoomGame, index: number): AppState {
  const stop = stopped(state, game);
  if (stop) return stop;

  const line = lineAt(listOf(game, state), index);
  if (line?.step === null) return upALevel(state, game);
  if (line?.step !== undefined && line.step !== null) {
    return synced({ ...state, menu: line.step, cursor: 0, effect: IDLE }, game);
  }
  // A group that asks one question is answered by the line that is about to be
  // spent, so the list it came out of goes with it and the highlight lands back
  // on the row that opened it. Only when the line is one the game will take: a
  // refusal costs no turn, and a level that shuts on a greyed line takes the
  // reasons with it (`TugRow.once`).
  const closing = line?.enabled === true && tugOnce(state.menu);
  const from = closing
    ? { ...state, menu: undefined, cursor: leftBehind(state, state.at, undefined) }
    : state;
  return act(from, game, () => picked(line), true);
}

/**
 * One level back up, and exactly one: out of a bulkhead's methods to whichever
 * list that bulkhead was reached from, and out of the map to the compartment's
 * own list. Never a turn, and never an overlay.
 *
 * The order is what makes `0` and `Esc` mean the same thing twice. A player who
 * pressed `m` and then a locked door is two levels deep, and coming back up in
 * one keystroke would drop the map they were reading — so the level that
 * falls away is always the innermost one there is.
 */
function upALevel(state: AppState, game: RoomGame): AppState {
  if (state.menu !== undefined) {
    const cursor = leftBehind(state, state.at, undefined);
    return synced({ ...state, menu: undefined, cursor, effect: IDLE }, game);
  }
  return synced({ ...state, moves: false, doors: false, cursor: 0, effect: IDLE }, game);
}

/**
 * Anything that wants the game to move. The help card eats the first key that
 * follows it, as it always has, and a run that is over spends no more turns.
 */
function act(state: AppState, game: RoomGame, effect: () => AppEffect, exploring = false): AppState {
  const stop = stopped(state, game);
  if (stop) return stop;
  const asked = effect();
  // The lesson's gate (G96, 1): a key that would spend a turn on something the
  // open step is not about prints the step's own line instead, and spends
  // nothing — the same refusal a greyed row gives when it is pressed.
  const refused = lessonRefusal(game, asked);
  if (refused !== undefined) return synced({ ...state, effect: { kind: "log", text: refused } }, game);
  // A walk whose first and only door is into a known hazard is answered here,
  // not by a walk: see `hazardAsked`.
  if (asked.kind === "travel") {
    const hazard = hazardStep(game, asked.to);
    if (hazard !== undefined) return hazardAsked(state, game, askOf(asked), hazard);
  }
  // Only a real walk raises the flag: a refused pick is not the start of one.
  const walking = exploring && (asked.kind === "explore" || asked.kind === "travel");
  const ask = walking ? askOf(asked) : undefined;

  // The same walk asked for twice at the same door is the confirmation
  // (`Warning`). Through something the drone simply steps over — a hazard —
  // the walk sets out with that door allowed; at something shut it is the
  // door's own list of ways that answers, not the same line again, and the
  // list opens with no walk and no turn. Whatever this key did, the warning
  // is spent: a turn, a walk, or a different walk all mean a different board.
  const warned = state.warned;
  if (walking && warned !== undefined && warned.ask === ask) {
    const door = game.ship.doors[warned.door];
    if (door !== undefined && passableForPlayer(door)) {
      const next = { ...asked, through: door.id } as AppEffect;
      return synced({ ...state, exploring: true, ask, warned: undefined, effect: next }, game);
    }
    if (door !== undefined && doorStands(game, door.id)) {
      return synced(
        { ...state, moves: true, doors: false, menu: door.id, cursor: 0, warned: undefined, effect: IDLE },
        game,
      );
    }
  }
  return synced({ ...state, exploring: walking, ask, warned: undefined, effect: asked }, game);
}

/**
 * What the lesson's gate says to an effect that would move the world: a walk
 * of either kind is the `walk` move, closing in is `attack`, a command is
 * whatever `moveOf` calls it. Nothing in an ordinary run, and nothing for an
 * effect that spends no turn.
 */
function lessonRefusal(game: RoomGame, effect: AppEffect): string | undefined {
  const gate = lessonGateOf(game);
  if (gate === undefined) return undefined;
  if (effect.kind === "explore" || effect.kind === "travel") return gateRefuses(gate, game, { kind: "go", door: 0 });
  if (effect.kind === "fight") return gateRefuses(gate, game, { kind: "attack", target: 0 });
  if (effect.kind === "command") return gateRefuses(gate, game, effect.cmd);
  return undefined;
}

/**
 * The door into a known hazard, when a walk to `to` would take it as its one
 * and only step — the neighbour itself filled with smoke or frost, or a mined
 * door with no way round — and the red line about it.
 */
function hazardStep(game: RoomGame, to: RoomId): { door: Door; line: string } | undefined {
  const here = game.roomOf(game.player).id;
  const route = travelRoute(game.ship, here, to, safeForPlayer(game));
  const door = route?.length === 1 ? route[0] : undefined;
  if (door === undefined || !passableForPlayer(door)) return undefined;
  const line = dangerAhead(game, door);
  return line === undefined ? undefined : { door, line };
}

/**
 * A click, a row or a digit asking to step into a known hazard one door away.
 *
 * This was the hazard click that "worked badly" (G90 D3). It started a walk,
 * and a walk's first question is whether a machine is in sight
 * (`ui/auto.ts`, `makeWatch`): with one anywhere in view every click on the
 * smoke answered «You see …» and stopped before the door, the stop named no
 * door, so no confirmation was ever remembered and the second click was the
 * same question again — for as long as the machine stayed in sight. Without
 * a machine the first click did stop at the door and ask, but only in the log:
 * the map lit nothing.
 *
 * Now the question is asked without walking: the red line, the door's own list
 * of ways with the step in on top, and the compartment lit on the map through
 * that list's rows. The same ask again is the step itself — a `go`, which no
 * machine in sight can stop.
 */
function hazardAsked(state: AppState, game: RoomGame, ask: string, hazard: { door: Door; line: string }): AppState {
  const { door, line } = hazard;
  const warned = state.warned;
  if (warned !== undefined && warned.ask === ask && warned.door === door.id) {
    const go: AppEffect = { kind: "command", cmd: { kind: "go", door: door.id } };
    return synced({ ...state, exploring: false, ask: undefined, warned: undefined, effect: go }, game);
  }
  const told: AppEffect = { kind: "log", text: t("stop.hazard.again", { what: line }) };
  return synced(
    {
      ...state,
      exploring: false,
      ask: undefined,
      warned: { ask, door: door.id },
      moves: true,
      doors: false,
      menu: door.id,
      cursor: 0,
      effect: told,
    },
    game,
  );
}

/** The words a `Warning` remembers a walk by: what, and where to. */
function askOf(effect: AppEffect): string {
  return effect.kind === "travel" ? `travel:${effect.to}` : effect.kind;
}

/**
 * A number off the list. A line that cannot be pressed says why and costs
 * nothing — the same contract the engine keeps for a refused command, kept one
 * step earlier so the machines never get the floor for a mistyped digit.
 */
function picked(action: Action | undefined): AppEffect {
  if (!action) return { kind: "log", text: t("why.line.none") };
  if (!action.enabled) return { kind: "log", text: action.why ?? t("why.notHere") };
  // A destination rather than a command: the walk spends the turns, one at a
  // time, and `cmd` is only its first step for whoever is not walking.
  if (action.travel !== undefined) return { kind: "travel", to: action.travel };
  return { kind: "command", cmd: action.cmd };
}

/**
 * A module letter, aimed. With a bulkhead in front of the drone that this
 * module could open, the letter is that method — pressing `p` at a locked door
 * is the same turn as picking `power` out of that door's own list, one keystroke
 * instead of two. With nothing to aim at, the module simply does what it does.
 *
 * This is what the letters are for now that the doors are not lines of the
 * compartment's list at all: the short way round for a player who has learned
 * them, from any level and without walking through a list to get there
 * (`ui/actions.ts`, `waysHere`).
 */
function aimed(game: RoomGame, module: string, slot: number): RoomCommand {
  const verb = DOOR_USE[module as keyof typeof DOOR_USE];
  if (verb !== undefined) {
    const way = waysHere(game).find((w) => w.enabled && w.verb === verb);
    if (way) return way.cmd;
  }
  return { kind: "act", verb: "use", slot };
}

/**
 * `<`, which is one key for one intention with two halves: get out.
 *
 * Standing at the airlock it casts off, as it always has. Anywhere else aboard
 * a hull it walks there, by the same machinery a chosen compartment uses and
 * with the same stops — the owner asked for it in one line, «на манер `o` и `<`
 * должно вести к выходу», and it is DCSS's own reading: travel to the commonest
 * destination there is, on the key already named after it.
 *
 * A hull with no way back says so and spends nothing. That refusal is worth a
 * line of its own rather than the walk's generic one: the drone is not lost, it
 * is walled in, and the difference is what the player has to solve.
 */
function leaving(game: RoomGame): AppEffect {
  // The tug is not a hull to get out of: casting off is `undock`, a numbered
  // line of its own list, and `<` says so rather than handing the sim a `leave`
  // it will refuse in words about airlocks.
  if (isTug(game)) return { kind: "log", text: t("why.tug.noWalk") };
  if (game.atAirlock()) return { kind: "command", cmd: { kind: "leave" } };
  const home = airlockRoom(game.ship);
  if (game.roomOf(game.player).id === home) return { kind: "command", cmd: { kind: "leave" } };
  // The tug has an airlock of its own and casting off is `undock`, a numbered
  // line: `leave` is refused there for no turn, which is what it did before.
  if (travelRoute(game.ship, game.roomOf(game.player).id, home) === undefined) {
    return { kind: "log", text: t("stop.airlock.none") };
  }
  return { kind: "travel", to: home };
}

/**
 * A walk that ran into something shut: the list drops into that bulkhead's own
 * ways through it, and the player decides whether the destination is worth a
 * torch (docs/tasks/G48-travel-to-a-room.md).
 *
 * The door is always one of this compartment's — the walk stops *before*
 * stepping through it — so the level it opens is the same one a number on the
 * compartment's list opens, and `0` comes back the same way.
 *
 * And the stop is remembered (`Warning`): the same ask again at this door is
 * the player's answer to it. Remembered whether or not the door has a list —
 * a lock with nothing aboard to open it has none, and the second press then
 * simply asks the walk again, which says the same thing and is right to.
 */
export function stoppedAt(state: AppState, game: RoomGame, door: DoorId): AppState {
  const warned: Warning | undefined = state.ask === undefined ? undefined : { ask: state.ask, door };
  const stands = doorStands(game, door);
  if (warned === undefined && !stands) return state;
  const told = { ...state, ask: undefined, warned };
  if (!stands) return told;
  return { ...told, moves: true, doors: false, menu: door, cursor: 0 };
}

/**
 * The keycard, aimed the way a module letter is: at whichever lock in this
 * compartment the list is already offering it for.
 *
 * It needs a letter of its own because it is not a module — `MODULE_KEYS` has
 * nothing to hang it on — and it is offered last of the four ways through a
 * lock (`systems/doors.ts`, `LOCKED_METHODS`), so on a drone that still carries
 * a cell or a torch it is the last line of that door's list rather than the
 * first. One key still reaches it from the compartment.
 */
function keycardHere(game: RoomGame): RoomCommand | undefined {
  return waysHere(game).find((w) => w.enabled && w.verb === "key")?.cmd;
}

/**
 * Re-read the run after a turn has been spent.
 *
 * The ending outranks every overlay except the help card and the error screen,
 * and it has to be re-asserted after every key: opening and closing help on the
 * death screen used to leave the player looking at a dead ship with no banner
 * and no hint that shift+R starts a new run.
 */
export function syncStatus(state: AppState, game: RoomGame): AppState {
  return synced(state, game);
}

/** The walk ended on its own: a stop, a refused command, or a run that is over. */
/**
 * A run the shell has just built, in place of the one the reducer was looking
 * at: over a training run the card that says what the job is comes up first
 * (G96, 2). The reducer cannot raise it itself — the row that asks for a
 * training run is answered by the shell, which builds the game after the
 * reducer has returned — so the shell asks here once the run exists.
 */
export function runBegun(state: AppState, game: RoomGame): AppState {
  return briefing(game) && state.overlay === "none" ? { ...state, overlay: "brief" } : state;
}

export function walkEnded(state: AppState): AppState {
  return { ...state, exploring: false, effect: IDLE };
}

function ending(state: AppState, overlay: Overlay): AppState {
  if (state.crash !== undefined) return state;
  return { ...state, overlay, exploring: false, effect: IDLE };
}

/**
 * The run is over — not dead, broken. The first failure wins: the exception
 * that broke the renderer must not overwrite the report of the one that broke
 * the turn.
 */
export function crashed(state: AppState, summary: readonly string[]): AppState {
  if (state.crash !== undefined) return state;
  return { ...state, overlay: "crash", exploring: false, crash: summary, effect: IDLE };
}

/**
 * The body of the error screen.
 *
 * The seed and the URL are the whole point of it: one pasted line reproduces
 * the run exactly, which is worth more from a jam voter than a stack trace they
 * will not copy. `error` is whatever was thrown — a string, an object, or
 * nothing at all — so this never assumes an `Error`.
 *
 * The sortie and the hull sit on that first line beside the seed because a
 * voyage is several ships long and a seed alone does not say which one broke:
 * "sortie 7 · hull 2/4" is the difference between a bug in the first freighter
 * and a bug in coming back to a hull that has already killed you once — the
 * class of failure `tests/persistence.test.ts` exists for, and the one a bug
 * report cannot be reproduced from without the count.
 */
export function crashSummary(game: RoomGame, url: string, error: unknown): string[] {
  return [
    t("crash.seed", { seed: game.seed, voyage: voyageLine(game), turn: game.schedule.time }),
    "",
    url,
    t("crash.report"),
    "",
    firstLine(error),
  ];
}

/**
 * `sortie 7 · hull 2/4`, off the run's own record.
 *
 * Read structurally rather than through `systems/voyage.ts`: this card is drawn
 * when the rules have already thrown, so it must not call back into the system
 * that threw — and `voyageOf` would helpfully *create* a record where the
 * missing one is the very thing worth reporting. Anything absent or the wrong
 * shape drops out of the line instead of taking the screen down with it.
 */
function voyageLine(game: RoomGame): string {
  const raw = (game.player as { data?: Record<string, unknown> } | undefined)?.data?.voyage;
  if (typeof raw !== "object" || raw === null) return t("crash.sortie", { n: "?" });

  const voyage = raw as { sortie?: unknown; current?: unknown; derelicts?: unknown };
  const parts = [t("crash.sortie", { n: typeof voyage.sortie === "number" ? voyage.sortie : "?" })];
  // One-based: the player counts the hull the tug is tied to as the first.
  if (typeof voyage.current === "number") {
    const n = voyage.current + 1;
    const hulls = Array.isArray(voyage.derelicts) ? voyage.derelicts.length : undefined;
    parts.push(hulls === undefined ? t("crash.hull", { n }) : t("crash.hullOf", { n, of: hulls }));
  }
  return parts.join(" · ");
}

/** The headline of an exception, whatever was thrown. Never more than a line. */
export function firstLine(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : stringify(error);
  return text.split("\n")[0]?.trim() || t("crash.unknown");
}

function stringify(error: unknown): string {
  try {
    return String(error);
  } catch {
    // A thrown object with a hostile `toString`. It has said enough.
    return t("crash.unknown");
  }
}

/**
 * The highlight after the world has moved: home to the top in a new
 * compartment, and never past the end of a list that has just got shorter.
 *
 * Both halves are the same rule — the cursor points at a line, and a line it no
 * longer points at is a line `Enter` must not fire. Salvaging the last wreck in
 * a room shortens the list under the highlight, and without the clamp the next
 * `Enter` would say "nothing on that line" at a list with plenty on it.
 */
function withCursor(state: AppState, game: RoomGame): AppState {
  const at = placeOf(game);
  // Neither level outlives nothing: a door that opened is not a lock any more,
  // and a compartment the drone has left takes its bulkheads and its doors with
  // it. So the way back up is every key that changes either — the ones the task
  // asked for by name and the ones nobody thought to name. That is also what
  // makes walking somewhere off the map feel like one keystroke:
  // the step lands in another compartment and the level is simply gone.
  const moves = at === state.at && state.moves;
  const doors = at === state.at && state.doors && doorsStand(game);
  const menu = at === state.at && state.menu !== undefined && levelStands(game, state.menu, doors)
    ? state.menu
    : undefined;
  const next =
    at !== state.at || menu !== state.menu || moves !== state.moves || doors !== state.doors
      ? { ...state, cursor: leftBehind(state, at, menu), at, menu, moves, doors }
      : state;
  // Whichever way it got here — home to the top, back onto a tug row, clamped
  // under a list that got shorter, or a digit pressed on a greyed row — the
  // highlight rests on a row `Enter` can do, when the list has one (G90 D5).
  const cursor = pressableFrom(listFor(game, menu, moves, doors), next.cursor);
  return cursor === next.cursor ? next : { ...next, cursor };
}

/**
 * Where the highlight goes when a tug group closes under it: back onto the row
 * that group opened from.
 *
 * The top of the list is where it used to go, and that was the expensive half
 * of the tug's oldest defect. Mending the last damaged module empties the
 * repairs, the level falls away, and the highlight landed on row one — which
 * until this wave was `cast off`, so the fifth `Enter` of "mend everything"
 * flew the drone out with a charter unsigned and no way back
 * (docs/tug-menu-audit.md, defects 1 and 2). Casting off is last now, so the
 * stray `Enter` is no longer fatal; landing where you were still beats landing
 * at the top, and it is the same answer whether the group emptied itself or the
 * player pressed `0`.
 *
 * Only for a tug verb. A bulkhead's level belongs to the compartment list,
 * which renumbers itself as the ship changes, so there is no row to go back to.
 */
function leftBehind(state: AppState, at: string, menu: Level | undefined): number {
  if (at !== state.at || menu !== undefined || typeof state.menu !== "string") return 0;
  return Math.max(0, tugRowIndex(state.menu));
}

/**
 * Is the level the list is one step inside still a question? Door or verb.
 *
 * Which of the two lists a door's own level came out of decides what keeps it
 * standing: off the map it is a bulkhead in the way (`doorStands`), off `d` it
 * is a bulkhead with more than one thing to do to it (`doorWaysStand`), and a
 * door the drone has just opened is still the second while it is no longer the
 * first.
 */
function levelStands(game: RoomGame, menu: Level, doors: boolean): boolean {
  // A string is a verb of the tug at home and a relic's swap aboard a hull.
  if (typeof menu === "string") return isTug(game) ? tugStands(game, menu) : swapStands(game, menu);
  return doors ? doorWaysStand(game, menu) : doorStands(game, menu);
}

/**
 * `shift+R`: a fresh run, from any screen.
 *
 * The settings come across because they are not the run: a player who chose
 * Spanish, the honeycomb and no sound has not asked for any of that back when
 * they ask for another ship. The seed is the exception and is corrected by the
 * shell, which is the only thing that knows what the new one turned out to be.
 */
function newRunState(state: AppState): AppState {
  return {
    settings: state.settings,
    seedText: undefined,
    titleHelp: false,
    overlay: "none",
    exploring: false,
    ask: undefined,
    warned: undefined,
    crash: undefined,
    cursor: 0,
    at: "",
    menu: undefined,
    moves: false,
    doors: false,
    helpPage: 0,
    logPage: 0,
    codex: [],
    codexAt: 0,
    seen: NO_MARKS,
    airlockTold: false,
    effect: { kind: "newRun" },
  };
}

function withEffect(state: AppState, effect: AppEffect): AppState {
  return { ...state, effect };
}

function synced(state: AppState, game: RoomGame): AppState {
  if (state.crash !== undefined) return state;
  state = withCursor(state, game);
  if (state.overlay === "help" || state.overlay === "history" || state.overlay === "title") return state;
  // Same rule for the `i` card: nothing behind it may overwrite what is in
  // front of the board while the player is reading (G72).
  if (state.overlay === "codex") return state;

  // The two biggest things that happen to a voyage, noticed here rather than
  // announced from the rules. Both used to be a single line of a log that
  // scrolls: the drone died out there and the player was standing on the tug
  // with no idea why, which is the whole of «после смерти дрона я уже не
  // понимаю, что происходит» and of the 386 screens a sweep found where a
  // pressed `go d9 CARGO` ended up at home with nothing said
  // (docs/tasks/G54-two-ships-confusion.md, 6).
  const marks = marksOf(game);
  const raised = raisedBy(state.seen, marks);
  state = { ...state, seen: marks };

  const status = game.status;
  // The run ending outranks the sortie ending: no drone and no money for one is
  // not "the drone did not come back", it is the last thing that will happen.
  if (status === "dead" && state.overlay !== "dead") return { ...state, overlay: "dead" };
  if (status === "won" && state.overlay !== "won") return { ...state, overlay: "won" };
  // The virus window only ever lands on a clear board: a card already in front
  // of it is what the player is reading, and the infection is on the panel.
  if (raised === "virus") return state.overlay === "none" ? ending(state, raised) : state;
  // The same rule for the airlock card, with one more: it is shown once a run,
  // and the flag is set when it is *shown* rather than when it is earned — a
  // card that never reached the screen has told nobody anything.
  if (raised === "airlock") {
    if (state.airlockTold || state.overlay !== "none") return state;
    // Silent for a training run, and ticked off with the silence: the lesson's
    // last two steps are this card in other words, in a window that is already
    // on the screen, and the rule against saying one thing twice is the one
    // `content/hints.ts` keeps for `objective` and `payout` (`LESSON_SAYS`).
    if (isTraining(game.player)) return { ...state, airlockTold: true };
    return { ...ending(state, raised), airlockTold: true };
  }
  if (raised !== undefined) return ending(state, raised);
  // A sortie's own ending stands until a key puts it away (`appReducer`).
  if (ENDINGS.has(state.overlay) && state.overlay !== "dead" && state.overlay !== "won") return state;
  return state;
}

/**
 * Which card this key earned, if either: a drone that did not come back, or a
 * hull under tow. The sale wins a tie — losing the drone that sold the ship is
 * the price of the better news, and the better news is what a player wants the
 * card to say.
 */
function raisedBy(was: SortieMarks, now: SortieMarks): Overlay | undefined {
  if (now.sold > was.sold) return "sold";
  if (now.lost > was.lost) return "lost";
  // Last, so a sortie's ending outranks it: the drone that caught something on
  // the turn it was lost is not the news.
  if (now.infected && !was.infected) return "virus";
  // And after that: a hull finished by a drone that then died on the way out is
  // a loss, and the card about the way out would be reading it the news.
  if (now.online && !was.online) return "airlock";
  return undefined;
}

// ------------------------------------------------------------ the lesson (G90 E)

/**
 * The lesson's window, as either renderer draws it: the head, what to press,
 * and the instruction under them.
 *
 * Everything on it is decided here and worded in `content/i18n`; the page puts
 * it in a card over a corner of the map and the terminal puts it on the rows
 * above the log, and neither adds a word (`ui/web/screen.ts`, `ui/render.ts`).
 * `done` is the one frame after a step completed, which is the whole of the
 * "short done, then the next step" the task asks for: the step the run is on
 * is already the next one, and the head carries the tick for one turn.
 */
export interface LessonView {
  /** `LESSON 4/9`, or the head of the closing line. */
  readonly head: string;
  /** The key or the line to press; empty once the lesson is over. */
  readonly press: string;
  /** The instruction, or the closing line. */
  readonly lines: readonly string[];
  readonly done: boolean;
  readonly over: boolean;
}

export function lessonView(game: RoomGame): LessonView | undefined {
  const status = lessonStatus(game);
  if (status === undefined) return undefined;
  if (status.over || status.text === undefined || status.press === undefined) {
    return { head: t("lesson.over.head"), press: "", lines: [t("lesson.over")], done: status.done, over: true };
  }
  return {
    head: t("lesson.head", { n: status.step + 1, of: status.of }),
    press: t(status.press),
    lines: [t(status.text)],
    done: status.done,
    over: false,
  };
}

/** Columns a lesson row may use on the terminal: the log's own width. */
export const LESSON_WIDTH = SCREEN_WIDTH - 2;

/** Rows the terminal gives the window, at most: the head and two of instruction. */
export const LESSON_ROWS = 3;

/**
 * The window as rows for the terminal: the head line — the tick for a step
 * just done, the step, the key — and the instruction wrapped to the log's
 * width under it. Empty in a run that has no lesson.
 */
export function lessonRows(game: RoomGame): string[] {
  const view = lessonView(game);
  if (view === undefined) return [];
  const head = [view.done ? t("lesson.done") : "", view.head, view.press]
    .filter((part) => part.length > 0)
    .join(HEAD_SEP);
  return [head, ...view.lines.flatMap((line) => wrapTo(line, LESSON_WIDTH))].slice(0, LESSON_ROWS);
}

const HEAD_SEP = " · ";

/** One line broken on spaces to `width` columns; a word longer than that stands alone. */
function wrapTo(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line.length > 0) out.push(line);
  return out;
}
