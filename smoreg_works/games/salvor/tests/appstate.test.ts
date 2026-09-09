import { describe, it, expect } from "vitest";
import { RoomGame, type RoomGameConfig, type Twist } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { VOYAGE, currentDerelict, voyageOf } from "../src/systems/voyage.js";
import { addWreck, applyDerived, install, rigOf } from "../src/twist/rig.js";
import { ACTION_KEYS, BACK_KEY, roomActions } from "../src/ui/actions.js";
import {
  appReducer,
  crashSummary,
  crashed,
  droneLost,
  firstLine,
  initialState,
  listOf,
  shipSold,
  stoppedAt,
  syncStatus,
  walkEnded,
  type AppState,
} from "../src/ui/appstate.js";
import { helpPages, toIntent, type KeyLike } from "../src/ui/input.js";

/**
 * The overlays and the numbered list, as transitions.
 *
 * Every case below used to be a thing somebody checked by opening the game in
 * a browser and pressing keys — the title taking any key, `?` on the death
 * screen not eating the banner, shift+R out of the error screen. They are all
 * pure functions of (state, key, run) now, so a UI change that loses one of
 * them fails here instead of in front of a voter.
 */

const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
`;

function config(extra: Twist<RoomGame>[] = []): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems: [...(GAME_CONFIG.systems ?? []), ...extra],
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
}

/** The same ship with a compartment two doors off: somewhere worth a walk. */
const DEEP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r5 -d7- r7
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r7: lab explored
`;

function deepRun(seed = 101): RoomGame {
  const game = new RoomGame({
    ...config(),
    firstShip: () => shipFromText(DEEP).ship,
    seed,
  });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  return game;
}

/** A run standing on the tug, where the two halves of the game are different. */
function tugRun(seed = 4): RoomGame {
  const game = newGame(seed);
  game.refreshSight();
  return game;
}

/** A hull whose airlock compartment nothing connects to: no way home at all. */
const CUT_OFF = `
  TUG -a1- r1
  r2 -d4- r5
  r1: docking explored
  r2: cargo cover explored
  r5: hab explored
`;

function cutOffRun(seed = 101): RoomGame {
  const game = new RoomGame({
    ...config(),
    firstShip: () => shipFromText(CUT_OFF).ship,
    seed,
  });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  return game;
}

function newRun(seed = 101, extra: Twist<RoomGame>[] = []): RoomGame {
  const game = new RoomGame({ ...config(extra), seed });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  return game;
}

/**
 * Every module gone and no keycard aboard: what a drone looks like once the
 * ship has taken the rack apart. `DOORS` offers a locked bulkhead nothing at
 * all in that state, which is how a line the player cannot press is reached
 * without stubbing the bulkhead system out.
 */
function stripRack(game: RoomGame): void {
  rigOf(game.player)!.slots.fill(null);
  applyDerived(game.player);
}

const press = (key: string, code?: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ...mods });

/** The digit that presses line `index` of whichever list is showing. */
const digit = (index: number): KeyLike => press(ACTION_KEYS[index]!, `Digit${ACTION_KEYS[index]!}`);

/** One key press, the way `app.ts` makes it: key table first, reducer second. */
function key(state: AppState, e: KeyLike, game: RoomGame): AppState {
  return appReducer(state, toIntent(e, rigOf(game.player)), game);
}

/** A run that has begun: the title is down and nothing is in front of the ship. */
function playing(game: RoomGame): AppState {
  return key(initialState(), press("1", "Digit1"), game);
}

/** What the sim does when the core goes: the flag the overlays read. */
function died(game: RoomGame): void {
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
    const game = newRun();
    for (const e of [press("1", "Digit1"), press("?", "Slash"), press("q", "KeyQ"), press("R", "KeyR")]) {
      const next = key(initialState(), e, game);
      expect(next.overlay, e.key).toBe("none");
      expect(next.effect, e.key).toEqual({ kind: "idle" });
    }
  });

  it("does not spend the player's first move", () => {
    const game = newRun();
    key(initialState(), press("1", "Digit1"), game);
    expect(game.inputs).toEqual([]);
  });
});

describe("picking a line of the list", () => {
  it("hands the shell the command that line names", () => {
    const game = newRun();
    const first = roomActions(game)[0]!;
    expect(first.key).toBe("1");
    expect(key(playing(game), press("1", "Digit1"), game).effect).toEqual({ kind: "command", cmd: first.cmd });
  });

  it("says why a line cannot be pressed, and spends no turn on it", () => {
    const game = newRun();
    // A drone that has spent everything: the fixture's locked bulkhead has no
    // keycard, no CELL, no SPIKE and no CUTTER behind it, so every one of its
    // four methods is a line that cannot be pressed.
    stripRack(game);
    const map = key(playing(game), press("m", "KeyM"), game);
    const lock = roomActions(game, undefined, true).findIndex((a) => a.step !== undefined);
    expect(lock).toBeGreaterThanOrEqual(0);

    const inside = key(map, digit(lock), game);
    const list = roomActions(game, inside.menu, true);
    const shut = list.findIndex((a) => !a.enabled);
    expect(shut).toBeGreaterThanOrEqual(0);

    const next = key(inside, digit(shut), game);
    expect(next.effect).toEqual({ kind: "log", text: list[shut]!.why });
    expect(game.inputs).toEqual([]);
  });

  it("says so when the line is empty rather than sending a command", () => {
    const game = newRun();
    expect(roomActions(game).length).toBeLessThan(9);
    expect(key(playing(game), press("9", "Digit9"), game).effect).toEqual({
      kind: "log",
      text: "Nothing on that line.",
    });
  });
});

/**
 * The highlight over the list (docs/tasks/G40-tug-clarity.md, 8).
 *
 * The owner asked for arrows and `Enter` after two playtests in which the
 * numbered list was not found at all. design-doc.md, "Клавиши" had ruled the
 * arrows out on the grounds that a cursor would be a second way to choose. It
 * is, and that is now the point — what keeps it from being a *mode* is
 * everything below: no key waits for another, the digits still do their own
 * lines, and the cursor reaches nothing a digit cannot.
 */
describe("the cursor over the list", () => {
  const up = press("ArrowUp", "ArrowUp");
  const down = press("ArrowDown", "ArrowDown");
  const enter = press("Enter", "Enter");
  const numbered = (game: RoomGame): number => roomActions(game).filter((a) => a.key !== "").length;

  it("starts on the first line and wraps at both ends", () => {
    const game = newRun();
    const list = numbered(game);
    expect(list).toBeGreaterThan(1);

    let state = playing(game);
    expect(state.cursor).toBe(0);

    state = key(state, down, game);
    expect(state.cursor).toBe(1);
    // Nothing was spent moving it: a highlight is not a turn.
    expect(state.effect).toEqual({ kind: "idle" });
    expect(game.inputs).toEqual([]);

    state = key(key(state, up, game), up, game);
    expect(state.cursor).toBe(list - 1);
    expect(key(state, down, game).cursor).toBe(0);
  });

  it("does with Enter exactly what that line's own digit does", () => {
    const game = newRun();
    const second = roomActions(game)[1]!;

    const moved = key(key(playing(game), down, game), enter, game);
    expect(moved.effect).toEqual({ kind: "command", cmd: second.cmd });
    expect(moved.effect).toEqual(key(playing(game), press("2", "Digit2"), game).effect);
  });

  it("lets a digit move the highlight to the line it pressed", () => {
    const game = newRun();
    // Line two is a door to walk through, which is a line and not a level: a
    // digit that opens a bulkhead's own list takes the highlight to the top of
    // that list instead, and is checked where the levels are.
    expect(roomActions(game)[1]!.step).toBeUndefined();
    expect(key(playing(game), press("2", "Digit2"), game).cursor).toBe(1);
  });

  it("says why the line under it cannot be pressed, and spends no turn", () => {
    const game = newRun();
    stripRack(game);
    const map = key(playing(game), press("m", "KeyM"), game);
    const lock = roomActions(game, undefined, true).findIndex((a) => a.step !== undefined);
    expect(lock).toBeGreaterThanOrEqual(0);

    // One level down, on a rack that can spend none of the four methods.
    let state = key(map, digit(lock), game);
    const list = roomActions(game, state.menu, true);
    // The last of the four methods — the keycard, offered behind the modules —
    // so the highlight has somewhere to travel before it answers.
    const shut = list.filter((a) => a.step !== null).length - 1;
    expect(shut).toBeGreaterThan(0);
    expect(list[shut]!.enabled).toBe(false);
    for (let i = 0; i < shut; i++) state = key(state, down, game);
    expect(state.cursor).toBe(shut);

    const next = key(state, enter, game);
    expect(next.effect).toEqual({ kind: "log", text: list[shut]!.why });
    expect(game.inputs).toEqual([]);
  });

  it("goes back to the top when the drone changes compartment", () => {
    const game = newRun();
    // Enough lines under the highlight for it to have somewhere to go: the
    // compartment's own list is short now that the doors are the map's (G48).
    for (let i = 0; i < 2; i++) addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    let state = key(key(playing(game), down, game), down, game);
    expect(state.cursor).toBe(2);

    expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);
    expect(syncStatus(state, game).cursor).toBe(0);
  });

  it("never points past the end of a list that has just got shorter", () => {
    // Salvaging the last wreck in a compartment takes a line out from under the
    // highlight. Without the clamp the next `Enter` would answer "nothing on
    // that line" at a list with plenty still on it.
    const game = newRun();
    addWreck(game, game.ship.room("r2").id, "welder", 2);
    game.refreshSight();

    let state = playing(game);
    for (let i = 0; i < numbered(game) - 1; i++) state = key(state, down, game);
    expect(state.cursor).toBe(numbered(game) - 1);

    const wreck = roomActions(game).find((a) => a.label.startsWith("salvage"))!;
    expect(game.playerCommand(wreck.cmd).ok).toBe(true);
    expect(syncStatus(state, game).cursor).toBeLessThan(numbered(game));
  });

  it("leaves escape alone: it closes cards, it does not move a highlight", () => {
    const game = newRun();
    const state = key(key(playing(game), down, game), press("Escape", "Escape"), game);
    expect(state.cursor).toBe(1);
    expect(state.overlay).toBe("none");
  });
});

/**
 * The one level the list has (docs/tasks/G46-nested-actions.md).
 *
 * A lock is four decisions and the list used to show one of them, with the
 * other three on letters and no word about what any of them cost. So the door
 * became a choice: pressing it swaps the list for that bulkhead's methods, and
 * `0` swaps it back. Everything below is what keeps that from being a mode —
 * going down costs no turn, coming back costs no turn, the digits and the
 * letters go on doing their own work, and nothing waits for anything.
 */
describe("one level down, into a bulkhead", () => {
  const enter = press("Enter", "Enter");
  const esc = press("Escape", "Escape");

  /**
   * The state with the fixture's lock open one level, and the door it is on.
   * Reached through the map since G48 — the compartment's own list has no door
   * lines left — which changes how the level is entered and nothing under it.
   */
  function inside(game: RoomGame): AppState {
    const map = key(playing(game), press("m", "KeyM"), game);
    const lock = roomActions(game, undefined, true).findIndex((a) => a.step !== undefined);
    expect(lock).toBeGreaterThanOrEqual(0);
    const state = key(map, digit(lock), game);
    expect(state.menu).toBe(roomActions(game, undefined, true)[lock]!.step);
    return state;
  }

  it("swaps the list for the door's own methods, and spends nothing doing it", () => {
    const game = newRun();
    const state = inside(game);

    expect(state.effect).toEqual({ kind: "idle" });
    expect(game.inputs).toEqual([]);
    expect(roomActions(game, state.menu).map((a) => a.label)).toEqual([
      "power   1 turn, noise 6",
      "spike   2 turns, noise 4",
      "cut     3 turns, noise 9",
      "key     1 turn, silent",
      "back (d3)",
    ]);
    // The highlight starts at the top of the list it is now looking at.
    expect(state.cursor).toBe(0);
  });

  it("spends the turn the method costs, and only when the method is pressed", () => {
    const game = newRun();
    const state = inside(game);
    const power = roomActions(game, state.menu).findIndex((a) => a.label.startsWith("power"));

    const next = key(state, digit(power), game);
    expect(next.effect).toEqual({
      kind: "command",
      cmd: { kind: "act", verb: "power", target: game.ship.door("d3").id },
    });
  });

  it("comes back on 0, on escape, and on nothing else being a turn", () => {
    const game = newRun();
    const state = inside(game);
    for (const back of [press(BACK_KEY, "Digit0"), esc]) {
      const out = key(state, back, game);
      expect(out.menu, back.key).toBeUndefined();
      expect(out.cursor, back.key).toBe(0);
      expect(out.effect, back.key).toEqual({ kind: "idle" });
      expect(game.inputs, back.key).toEqual([]);
    }
  });

  it("comes back by itself when the lock is no longer a lock", () => {
    // The way through is a turn like any other, and the level it was chosen
    // from is gone the moment it lands: nothing is left to choose between.
    const game = newRun();
    const state = inside(game);
    expect(game.playerCommand({ kind: "act", verb: "power", target: game.ship.door("d3").id }).ok).toBe(true);
    expect(game.ship.door("d3").state).toBe("open");
    expect(syncStatus(state, game).menu).toBeUndefined();
  });

  it("comes back by itself when the drone walks out of the compartment", () => {
    const game = newRun();
    const state = inside(game);
    expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);
    expect(syncStatus(state, game).menu).toBeUndefined();
  });

  it("moves the highlight over the methods and does the one it is on", () => {
    const game = newRun();
    let state = inside(game);
    state = key(state, press("ArrowDown", "ArrowDown"), game);
    state = key(state, press("ArrowDown", "ArrowDown"), game);
    expect(state.cursor).toBe(2);

    const list = roomActions(game, state.menu);
    expect(key(state, enter, game).effect).toEqual({ kind: "command", cmd: list[2]!.cmd });
  });

  it("puts the highlight on the way back, which is still not a turn", () => {
    const game = newRun();
    let state = inside(game);
    state = key(state, press("ArrowUp", "ArrowUp"), game);
    expect(roomActions(game, state.menu)[state.cursor]!.step).toBe(null);

    const out = key(state, enter, game);
    expect(out.menu).toBeUndefined();
    expect(out.effect).toEqual({ kind: "idle" });
    expect(game.inputs).toEqual([]);
  });

  it("leaves the letters doing what they did, one level down or not", () => {
    // The short way round for whoever has learned them: `p` is the cell on the
    // bulkhead in front of the drone, from either level and without a walk
    // through the list.
    const game = newRun();
    const cell = { kind: "command", cmd: { kind: "act", verb: "power", target: game.ship.door("d3").id } };
    expect(key(playing(game), press("p", "KeyP"), game).effect).toEqual(cell);
    expect(key(inside(game), press("p", "KeyP"), game).effect).toEqual(cell);
  });
});

/**
 * Two levels, `m` at the top of them, and `<` as the shortcut through both
 * (docs/tasks/G48-travel-to-a-room.md).
 *
 * The owner played a sortie and said moving about was awful, then said what he
 * wanted: «лучше на движение выбирается любая точка и ты идёшь туда, пока не
 * упрёшься во врага или закрытую дверь», and «на манер `o` и `<` должно вести
 * к выходу». So `m` is a list of destinations, picking one is a walk that stops
 * itself, and a walk that runs into something shut opens that bulkhead's own
 * ways through it — the second half of the same request.
 *
 * Everything below is what keeps two levels from being a mode: going down costs
 * no turn, coming back costs no turn, `0` and `Esc` peel off exactly one level,
 * the letters go on working from either, and arriving anywhere takes the whole
 * thing away by itself.
 */
describe("the map, the walk and the way out", () => {
  const move = press("m", "KeyM");
  const out = press("<", "Comma", { shiftKey: true });
  const enter = press("Enter", "Enter");
  const esc = press("Escape", "Escape");

  /** The state with the map showing. */
  function mapping(game: RoomGame): AppState {
    const state = key(playing(game), move, game);
    expect(state.moves).toBe(true);
    return state;
  }

  /** The line of the map that names a compartment, by the first word of it. */
  function lineFor(game: RoomGame, state: AppState, head: string): number {
    const at = listOf(game, state).findIndex((a) => a.label.startsWith(head));
    expect(at, head).toBeGreaterThanOrEqual(0);
    return at;
  }

  /** Two levels down: the map, then the compartment behind the fixture's lock. */
  function atLock(game: RoomGame): AppState {
    const state = mapping(game);
    const next = key(state, digit(lineFor(game, state, "STORAGE")), game);
    expect(next.menu).toBe(game.ship.door("d3").id);
    return next;
  }

  it("swaps the list for the map, and spends nothing doing it", () => {
    const game = newRun();
    const state = mapping(game);

    expect(state.menu).toBeUndefined();
    expect(state.cursor).toBe(0);
    expect(state.effect).toEqual({ kind: "idle" });
    expect(game.inputs).toEqual([]);
    expect(listOf(game, state).map((a) => a.label)).toEqual([
      "DOCKING   r1  1 door",
      "STORAGE   r4  d3 locked",
      "HAB BLOCK r5  1 door",
      "back",
    ]);
  });

  it("steps through a single door rather than starting a walk", () => {
    const game = newRun();
    const state = mapping(game);
    const next = key(state, digit(lineFor(game, state, "DOCKING")), game);
    expect(next.effect).toEqual({ kind: "command", cmd: { kind: "go", door: game.ship.door("d1").id } });
    expect(next.exploring).toBe(false);
  });

  it("sets out for anything further off, and any key stops the walk", () => {
    const game = deepRun();
    const state = mapping(game);
    const far = key(state, digit(lineFor(game, state, "LAB")), game);

    expect(far.effect).toEqual({ kind: "travel", to: game.ship.room("r7").id });
    // A walk raises the flag that makes the next key stop it — the same flag
    // `o` raises, and the same reason: the key that says "stop" must not also
    // spend the turn the player is stopping for.
    expect(far.exploring).toBe(true);
    expect(key(far, press("q", "KeyQ"), game).effect).toEqual({ kind: "stopAuto" });
    expect(game.inputs).toEqual([]);
  });

  it("offers the ways through a bulkhead the walk would run into", () => {
    const game = newRun();
    const state = atLock(game);

    expect(state.moves).toBe(true);
    expect(state.effect).toEqual({ kind: "idle" });
    expect(game.inputs).toEqual([]);
    expect(listOf(game, state).map((a) => a.label)).toEqual([
      "power   1 turn, noise 6",
      "spike   2 turns, noise 4",
      "cut     3 turns, noise 9",
      "key     1 turn, silent",
      "back (d3)",
    ]);
  });

  it("opens the same ways when a walk is what ran into the bulkhead", () => {
    // `ui/auto.ts` stops the walk and names the door; this is the transition
    // the shell makes of that, and the level it lands on is the map, so `0`
    // goes back to choosing where to go.
    const game = newRun();
    const state = stoppedAt(walkEnded(mapping(game)), game, game.ship.door("d3").id);
    expect(state.menu).toBe(game.ship.door("d3").id);
    expect(state.moves).toBe(true);
    expect(listOf(game, state)[0]!.label).toBe("power   1 turn, noise 6");

    // A door that is not a question — open, or not in this compartment — leaves
    // the screen exactly as it was.
    expect(stoppedAt(state, game, game.ship.door("d1").id)).toBe(state);
  });

  it("comes back one level at a time, on 0 and on escape alike", () => {
    const game = newRun();
    for (const back of [press(BACK_KEY, "Digit0"), esc]) {
      const inner = key(atLock(game), back, game);
      expect(inner.menu, back.key).toBeUndefined();
      expect(inner.moves, back.key).toBe(true);
      expect(inner.cursor, back.key).toBe(0);

      const outer = key(inner, back, game);
      expect(outer.moves, back.key).toBe(false);
      expect(outer.effect, back.key).toEqual({ kind: "idle" });
      expect(game.inputs, back.key).toEqual([]);
    }
  });

  it("closes on a second m, from either level", () => {
    const game = newRun();
    expect(key(mapping(game), move, game).moves).toBe(false);
    const closed = key(atLock(game), move, game);
    expect(closed.moves).toBe(false);
    expect(closed.menu).toBeUndefined();
    expect(game.inputs).toEqual([]);
  });

  it("falls away by itself once the drone is somewhere else", () => {
    const game = newRun();
    const state = atLock(game);
    expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);

    const after = syncStatus(state, game);
    expect(after.moves).toBe(false);
    expect(after.menu).toBeUndefined();
  });

  it("keeps the map when a lock is opened from inside it", () => {
    // The method is the turn; the drone has not moved, so the map it was
    // reading is still the map in front of it — with one more way through now.
    const game = newRun();
    const state = atLock(game);
    expect(game.playerCommand({ kind: "act", verb: "power", target: game.ship.door("d3").id }).ok).toBe(true);

    const after = syncStatus(state, game);
    expect(after.moves).toBe(true);
    expect(after.menu).toBeUndefined();
    expect(listOf(game, after).map((a) => a.label)).toContain("STORAGE   r4  1 door");
  });

  it("moves the highlight over the map and does the line it is on", () => {
    const game = newRun();
    let state = key(mapping(game), press("ArrowDown", "ArrowDown"), game);
    expect(state.cursor).toBe(1);
    expect(key(state, enter, game).menu).toBe(game.ship.door("d3").id);

    state = key(mapping(game), press("ArrowUp", "ArrowUp"), game);
    expect(listOf(game, state)[state.cursor]!.step).toBe(null);
    expect(key(state, enter, game).moves).toBe(false);
    expect(game.inputs).toEqual([]);
  });

  it("leaves the letters and the meta keys doing what they did", () => {
    const game = newRun();
    const cell = { kind: "command", cmd: { kind: "act", verb: "power", target: game.ship.door("d3").id } };
    expect(key(mapping(game), press("p", "KeyP"), game).effect).toEqual(cell);
    expect(key(atLock(game), press("p", "KeyP"), game).effect).toEqual(cell);
    expect(key(mapping(game), press("?", "Slash"), game).overlay).toBe("help");
  });

  it("is not a turn on a run that is over, and not a turn on the title", () => {
    const game = newRun();
    died(game);
    expect(key(playing(game), move, game).moves).toBe(false);
    expect(appReducer(initialState(), toIntent(move), game).moves).toBe(false);
    expect(game.inputs).toEqual([]);
  });

  /**
   * `<` is one key for one intention, and where the drone stands decides what
   * it costs (the owner: «на манер `o` и `<` должно вести к выходу»).
   */
  describe("the way out", () => {
    it("walks to the airlock from anywhere aboard", () => {
      const game = newRun();
      expect(key(playing(game), out, game).effect).toEqual({
        kind: "travel",
        to: game.ship.room("r1").id,
      });
    });

    it("casts off when the drone is already standing at it", () => {
      const game = newRun();
      expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);
      expect(game.atAirlock()).toBe(true);
      expect(key(playing(game), out, game).effect).toEqual({ kind: "command", cmd: { kind: "leave" } });
    });

    it("still sets out when the way home is shut, because the walk asks at the door", () => {
      // Sealed is not "no way home", it is "one bulkhead and a torch away from
      // home". The walk goes as far as it can and hands over the door's own
      // ways through it — which says what is missing, where a flat refusal
      // would only say that something is.
      const game = newRun();
      game.ship.door("d1").state = "sealed";
      expect(key(playing(game), out, game).effect).toEqual({
        kind: "travel",
        to: game.ship.room("r1").id,
      });
      expect(game.inputs).toEqual([]);
    });

    it("says so on the tug rather than handing the sim a refusal", () => {
      // The tug is not a hull to get out of: casting off is a numbered line of
      // its own list, and since G53 there is nothing to walk to at home either.
      // So `<` answers in the words that point at the list, instead of the
      // sim's own sentence about airlocks.
      const game = tugRun();
      expect(key(playing(game), out, game).effect).toEqual({
        kind: "log",
        text: "Nowhere to walk on the tug: it is all on the list.",
      });
      expect(game.inputs).toEqual([]);
    });

    it("says why rather than nothing when there is no way home at all, and spends no turn", () => {
      const game = cutOffRun();
      expect(key(playing(game), out, game).effect).toEqual({
        kind: "log",
        text: "There is no way back to the airlock.",
      });
      expect(game.inputs).toEqual([]);
      // And the map says the same thing about that compartment, in its own
      // column, rather than leaving it off.
      const state = key(playing(game), move, game);
      const line = listOf(game, state).find((a) => a.label.startsWith("DOCKING"))!;
      expect(line.label).toBe("DOCKING   r1  no way");
      expect(line.enabled).toBe(false);
      expect(line.why).toBe("No route to DOCKING.");
    });
  });
});

describe("the module letters", () => {
  it("fires the module where there is nothing to aim it at", () => {
    const game = newRun();
    const slot = rigOf(game.player)!.slots.findIndex((s) => s?.kind === "scanner");
    expect(key(playing(game), press("s", "KeyS"), game).effect).toEqual({
      kind: "command",
      cmd: { kind: "act", verb: "use", slot },
    });
  });

  it("aims at the bulkhead the list is already showing", () => {
    // The letters printed under a locked door have to reach the same turn the
    // number above them does, or the row is decoration.
    const game = newRun(101, [
      {
        name: "test-doors",
        offerActions: (g) => [
          {
            label: "spike",
            cmd: { kind: "act", verb: "spike", target: g.ship.door("d3").id },
            enabled: true,
          },
        ],
      },
    ]);
    // A system offers the spike because the rack has one; the letter only ever
    // appears under a door for a module the drone is carrying.
    install(rigOf(game.player)!, "spike", 3);
    expect(key(playing(game), press("K", "KeyK", { shiftKey: true }), game).effect).toEqual({
      kind: "command",
      cmd: { kind: "act", verb: "spike", target: game.ship.door("d3").id },
    });
  });

  it("reaches a method the number did not take, with nothing stubbed at all", () => {
    // The real lock: four methods, one number. The drone carries a CELL, so the
    // row for the compartment behind it would spend `power`, and the SPIKE is
    // one of the letters — which is the whole case `waysHere` exists for, and
    // the one the reducer used to miss.
    const game = newRun();
    install(rigOf(game.player)!, "spike", 3);
    const line = roomActions(game, undefined, true).find((a) => a.label.startsWith("STORAGE"))!;
    expect(line.cmd).toEqual({ kind: "act", verb: "power", target: game.ship.door("d3").id });
    expect(key(playing(game), press("K", "KeyK", { shiftKey: true }), game).effect).toEqual({
      kind: "command",
      cmd: { kind: "act", verb: "spike", target: game.ship.door("d3").id },
    });
  });

  /**
   * The keycard's own letter. It is not a module, so it cannot ride
   * `MODULE_KEYS` — and it is offered last of the four ways through a lock
   * (`systems/doors.ts`, `LOCKED_METHODS`), so on a drone that still carries a
   * CELL it never takes the number either.
   */
  it("spends a keycard on the lock the list is showing, without it taking the number", () => {
    const game = newRun();
    (game.player.data ??= {}).keys = 1;

    // The card is one of the ways the player has, and it is not the numbered
    // one: the drone undocks with a CELL, and `power` is offered ahead of it.
    const line = roomActions(game, undefined, true).find((a) => a.label.startsWith("STORAGE"))!;
    expect(line.cmd, "the card took the number").toEqual({
      kind: "act",
      verb: "power",
      target: game.ship.door("d3").id,
    });
    expect(line.ways?.find((w) => w.verb === "key")).toMatchObject({ letter: "a", enabled: true });

    const effect = key(playing(game), press("a", "KeyA"), game).effect;
    expect(effect).toEqual({
      kind: "command",
      cmd: { kind: "act", verb: "key", target: game.ship.door("d3").id },
    });

    // And the turn it asks for is the one that opens the bulkhead and spends
    // the card, which is the half a stubbed effect would never catch.
    expect(effect.kind).toBe("command");
    if (effect.kind !== "command") return;
    expect(game.playerCommand(effect.cmd).ok).toBe(true);
    expect(game.ship.door("d3").state).toBe("open");
    expect(game.player.data?.keys).toBe(0);
  });

  it("says so rather than spending a turn when there is no lock a card would open", () => {
    const game = newRun();
    (game.player.data ??= {}).keys = 1;
    game.player.room = game.ship.room("r5").id;
    game.refreshSight();
    expect(key(playing(game), press("a", "KeyA"), game).effect).toEqual({
      kind: "log",
      text: "No lock here a keycard would open.",
    });
  });

  it("asks for a log line, not a turn, when the module is not fitted", () => {
    const game = newRun();
    expect(key(playing(game), press("e", "KeyE"), game).effect).toEqual({ kind: "log", text: "No EMP installed." });
  });

  it("leaves a key it has no use for to the browser", () => {
    const game = newRun();
    const next = key(playing(game), press("q", "KeyQ"), game);
    expect(next.effect).toEqual({ kind: "pass" });
    expect(next.overlay).toBe("none");
  });
});

describe("the help card", () => {
  it("opens on ?, turns its pages on the same key, and closes on the last", () => {
    // The card outgrew the screen, so it pages (G48). One key does all three
    // and the card's own footer says which the next press will do.
    const game = newRun(103);
    const pages = helpPages(false).length;
    expect(pages).toBeGreaterThan(1);

    let state = key(playing(game), press("?", "Slash"), game);
    expect(state.overlay).toBe("help");
    expect(state.helpPage).toBe(0);
    for (let i = 1; i < pages; i++) {
      state = key(state, press("?", "Slash"), game);
      expect(state.overlay, `page ${i}`).toBe("help");
      expect(state.helpPage, `page ${i}`).toBe(i);
    }
    const closed = key(state, press("?", "Slash"), game);
    expect(closed.overlay).toBe("none");
    expect(closed.helpPage).toBe(0);
    // Escape closes it from any page at all, and forgets the page.
    expect(key(state, press("Escape", "Escape"), game).overlay).toBe("none");
    expect(key(state, press("Escape", "Escape"), game).helpPage).toBe(0);
    expect(game.inputs).toEqual([]);
  });

  it("closes on escape", () => {
    const game = newRun(103);
    const open = key(playing(game), press("?", "Slash"), game);
    expect(key(open, press("Escape", "Escape"), game).overlay).toBe("none");
  });

  it("eats the first key that follows it, whatever that key meant", () => {
    const game = newRun(103);
    const open = key(playing(game), press("?", "Slash"), game);
    for (const e of [press("1", "Digit1"), press("o", "KeyO"), press("Tab", "Tab"), press("s", "KeyS")]) {
      const next = key(open, e, game);
      expect(next.overlay, e.key).toBe("none");
      expect(next.effect, e.key).toEqual({ kind: "idle" });
      expect(next.exploring, e.key).toBe(false);
    }
  });
});

describe("the endings", () => {
  it("raises the banner as soon as the run is over", () => {
    const game = newRun(104);
    const state = playing(game);
    died(game);
    expect(syncStatus(state, game).overlay).toBe("dead");
  });

  it("shows the win banner on a won run", () => {
    const game = newRun(104);
    const state = playing(game);
    game.status = "won";
    expect(syncStatus(state, game).overlay).toBe("won");
  });

  it("keeps the banner when help is opened and closed on top of it", () => {
    const game = newRun(104);
    died(game);
    const dead = syncStatus(playing(game), game);
    expect(dead.overlay).toBe("dead");

    const help = key(dead, press("?", "Slash"), game);
    expect(help.overlay).toBe("help");
    expect(key(help, press("Escape", "Escape"), game).overlay).toBe("dead");
    // `?` turns the page rather than closing, so the banner comes back on the
    // press after the last one — and on any other key, as it always did.
    let last = help;
    for (let i = 1; i < helpPages(false).length; i++) last = key(last, press("?", "Slash"), game);
    expect(key(last, press("?", "Slash"), game).overlay).toBe("dead");
    expect(key(help, press("1", "Digit1"), game).overlay).toBe("dead");
  });

  it("spends no more turns once the run is over", () => {
    const game = newRun(104);
    died(game);
    const dead = syncStatus(playing(game), game);
    for (const e of [press("1", "Digit1"), press("o", "KeyO"), press("Tab", "Tab")]) {
      const next = key(dead, e, game);
      expect(next.effect, e.key).toEqual({ kind: "idle" });
      expect(next.overlay, e.key).toBe("dead");
    }
  });

  it("starts a new run on shift+R", () => {
    const game = newRun(104);
    died(game);
    const dead = syncStatus(playing(game), game);
    const next = key(dead, press("R", "KeyR"), game);
    expect(next.effect).toEqual({ kind: "newRun" });
    expect(next.overlay).toBe("none");
    expect(next.crash).toBeUndefined();
  });

  /**
   * The two biggest things that happen to a voyage, on the screen at last
   * (docs/tasks/G54-two-ships-confusion.md, 6).
   *
   * `droneLost` and `shipSold` were written in G26, covered by the test below
   * this one, and called by nothing: the drone died out there and the player
   * found themselves standing on the tug with one line of a scrolling log to
   * explain it. A sweep of the shipped game counted 386 screens over 220 seeds
   * where a pressed `go d9 CARGO` ended at home with nothing said at all.
   */
  describe("a sortie's own ending", () => {
    /**
     * The real game, on the tug, with a drone on the rails and an account that
     * can buy the next one — which is the whole difference between this card
     * and the one that ends the run.
     */
    function voyage(seed = 4): SalvorGame {
      const game = newGame(seed);
      voyageOf(game).credits = 200;
      return game;
    }

    it("raises the card when the drone does not come back", () => {
      const game = voyage();
      let state = playing(game);
      expect(state.overlay).toBe("none");
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

      game.player.hp = 0;
      VOYAGE.onDeath!(game, game.player);
      state = syncStatus(state, game);
      expect(state.overlay).toBe("lost");
      expect(state.exploring).toBe(false);
    });

    it("closes on any key at all, and spends no turn doing it", () => {
      const game = voyage();
      let state = syncStatus(playing(game), game);
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      game.player.hp = 0;
      VOYAGE.onDeath!(game, game.player);
      state = syncStatus(state, game);
      expect(state.overlay).toBe("lost");

      for (const e of [press("1", "Digit1"), press("o", "KeyO"), press("Escape", "Escape")]) {
        const next = key(state, e, game);
        expect(next.overlay, e.key).toBe("none");
        expect(next.effect, e.key).toEqual({ kind: "idle" });
      }
      expect(game.inputs.filter((c) => c.kind === "act")).toHaveLength(1);
    });

    it("says nothing twice: the same loss is one card", () => {
      const game = voyage();
      let state = syncStatus(playing(game), game);
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      game.player.hp = 0;
      VOYAGE.onDeath!(game, game.player);

      state = syncStatus(state, game);
      expect(state.overlay).toBe("lost");
      state = key(state, press("1", "Digit1"), game);
      expect(state.overlay).toBe("none");
      expect(syncStatus(state, game).overlay).toBe("none");
    });

    it("raises the other card when a hull goes under tow", () => {
      const game = voyage();
      const state = syncStatus(playing(game), game);
      currentDerelict(game).sold = true;
      expect(syncStatus(state, game).overlay).toBe("sold");
    });

    it("gives way to the run ending: no drone and no money is not a sortie", () => {
      const game = voyage();
      const state = syncStatus(playing(game), game);
      voyageOf(game).credits = 0;
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      game.player.hp = 0;
      VOYAGE.onDeath!(game, game.player);

      expect(game.status).toBe("dead");
      expect(syncStatus(state, game).overlay).toBe("dead");
    });
  });

  it("holds a sortie's own ending until the voyage says otherwise", () => {
    // `lost` and `sold` belong to the economy (G26); the transitions exist here
    // so the screen in front of them is a value like every other overlay.
    const game = newRun(104);
    const lost = droneLost(playing(game));
    expect(lost.overlay).toBe("lost");
    expect(syncStatus(lost, game).overlay).toBe("lost");
    expect(shipSold(playing(game)).overlay).toBe("sold");
    // Broken outranks both: the run is not in a state to be summarised.
    expect(droneLost(crashed(playing(game), ["boom"])).overlay).toBe("crash");
  });
});

describe("auto-explore", () => {
  it("asks the shell to start walking", () => {
    const game = newRun(105);
    const next = key(playing(game), press("o", "KeyO"), game);
    expect(next.exploring).toBe(true);
    expect(next.effect).toEqual({ kind: "explore" });
  });

  it("stops on any key, and that key spends no turn", () => {
    const game = newRun(105);
    const walking = key(playing(game), press("o", "KeyO"), game);
    for (const e of [press("1", "Digit1"), press("?", "Slash"), press("q", "KeyQ")]) {
      const next = key(walking, e, game);
      expect(next.exploring, e.key).toBe(false);
      expect(next.effect, e.key).toEqual({ kind: "stopAuto" });
      expect(next.overlay, e.key).toBe("none");
    }
  });

  it("clears the walking flag when the walk ends by itself", () => {
    const game = newRun(105);
    const walking = key(playing(game), press("o", "KeyO"), game);
    expect(walkEnded(walking).exploring).toBe(false);
  });

  it("takes one closing-in turn per press, in either mode", () => {
    const game = newRun(105);
    expect(key(playing(game), press("Tab", "Tab"), game).effect).toEqual({ kind: "fight", melee: false });
    const melee = key(playing(game), press("Tab", "Tab", { shiftKey: true }), game);
    expect(melee.effect).toEqual({ kind: "fight", melee: true });
    expect(melee.exploring).toBe(false);
  });
});

describe("the error screen", () => {
  /** A broken run, on its fourth sortie into the second hull of four. */
  function broke(seed = 4242): RoomGame {
    const game = newRun(seed);
    const voyage = (game.player.data ??= {}).voyage as Record<string, unknown> | undefined;
    if (voyage) {
      voyage.sortie = 4;
      voyage.current = 1;
      voyage.derelicts = [{}, {}, {}, {}];
    }
    return game;
  }

  const summary = (): string[] => crashSummary(broke(), "http://localhost/?seed=4242", new Error("boom"));

  it("says the seed, the sortie, the hull, the turn, the URL and the error", () => {
    // A voyage is several ships long, so the seed alone does not say which one
    // broke. `?seed=4242` reproduces the run; the sortie and the hull say how
    // far into it to look.
    const lines = summary();
    expect(lines[0]).toBe("seed 4242 · sortie 4 · hull 2/4 · turn 0");
    expect(lines[2]).toBe("http://localhost/?seed=4242");
    expect(lines[3]).toBe("copy this URL and report it");
    expect(lines[5]).toBe("Error: boom");
  });

  it("still names the seed when the voyage record is the thing that broke", () => {
    // This card is drawn after the rules have already thrown, so it may not
    // assume a record is there, or that what is there is a record.
    for (const junk of [undefined, null, "gone", 7, [], {}]) {
      const game = newRun(11);
      (game.player.data ??= {}).voyage = junk;
      const line = crashSummary(game, "u", new Error("boom"))[0]!;
      expect(line, JSON.stringify(junk ?? null)).toContain("seed 11");
      expect(line, JSON.stringify(junk ?? null)).toContain("turn 0");
    }
  });

  it("keeps the error to one line, however many the exception had", () => {
    expect(crashSummary(broke(1), "u", new Error("first\nsecond\nthird"))[5]).toBe("Error: first");
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
    expect(crashSummary(broke(1), "u", "plain")).toHaveLength(6);
  });

  it("takes exactly one key: the one that starts a new run", () => {
    const game = newRun(106);
    const broken = crashed(playing(game), summary());
    expect(broken.overlay).toBe("crash");

    for (const e of [press("1", "Digit1"), press("?", "Slash"), press("o", "KeyO"), press("Escape", "Escape")]) {
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
    const game = newRun(106);
    const broken = crashed(playing(game), summary());
    const again = crashed(broken, crashSummary(game, "u", new Error("while drawing the error screen")));
    expect(again).toBe(broken);
    expect(again.crash?.[5]).toBe("Error: boom");
  });

  it("outranks the ending: a broken run does not get a death banner", () => {
    const game = newRun(106);
    const broken = crashed(playing(game), summary());
    died(game);
    expect(syncStatus(broken, game).overlay).toBe("crash");
  });

  it("stops a walk in progress", () => {
    const game = newRun(106);
    const walking = key(playing(game), press("o", "KeyO"), game);
    expect(crashed(walking, summary()).exploring).toBe(false);
  });
});

describe("a key press never touches the game itself", () => {
  it("leaves the run exactly where it was, whatever was pressed", () => {
    const game = newRun(107);
    addWreck(game, game.ship.room("r2").id, "welder", 2);
    const before = JSON.stringify({ inputs: game.inputs, status: game.status, hp: game.player.hp });

    let state = playing(game);
    for (const e of [press("1", "Digit1"), press("K", "KeyK"), press("?", "Slash"), press("0", "Digit0")]) {
      state = key(state, e, game);
    }
    expect(JSON.stringify({ inputs: game.inputs, status: game.status, hp: game.player.hp })).toBe(before);
  });
});
