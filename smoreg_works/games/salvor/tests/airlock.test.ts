import { describe, expect, it } from "vitest";
import type { RoomGame } from "@jamrog/engine";
import { newGame } from "../src/game.js";

import { OBJECTIVES } from "../src/content/objectives.js";

import { shipState } from "../src/systems/shipstate.js";

import { rigOf } from "../src/twist/rig.js";
import { airlockCard } from "../src/ui/airlockcard.js";
import { appReducer, initialState, syncStatus, type AppState } from "../src/ui/appstate.js";
import { toIntent } from "../src/ui/input.js";

/**
 * The airlock card (docs/tasks/G95-smoreg-wave.md, B2): the turn the third
 * system starts, the game says once — in a card and not in the log's seventh
 * row — that the hull is paid for on the way out and not before.
 *
 * The owner asked for it after finishing hulls and wondering where the money
 * was: «пусть в первый раз после подъёма всех систем вылетает уведомление, что
 * надо идти на причал и эвакуировать дрон».
 */

/** A run with the drone aboard the first hull of its voyage. */
function aboard(seed = 4): RoomGame {
  const game = newGame(seed);
  expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
  return game;
}

/** The title down and nothing in front of the board. */
function playing(game: RoomGame): AppState {
  return syncStatus({ ...initialState(), overlay: "none" }, game);
}

function key(state: AppState, k: string, game: RoomGame): AppState {
  return appReducer(state, toIntent({ key: k }, rigOf(game.player)), game);
}

/**
 * The last system comes up, as the ship's own record rather than through three
 * splices: what the card is keyed to is the record, and a test that raised them
 * by hand would be testing the tools in the rack.
 */
function startAll(game: RoomGame): void {
  shipState(game).online = OBJECTIVES.map((o) => o.id);
}

function stopAll(game: RoomGame): void {
  shipState(game).online = [];
}

describe("the card that says the money is outside", () => {
  it("comes up the turn the last system starts, and any key puts it away", () => {
    const game = aboard();
    let state = playing(game);
    expect(state.overlay, "nothing in front of a hull with work left").toBe("none");

    startAll(game);
    state = syncStatus(state, game);
    expect(state.overlay).toBe("airlock");
    expect(state.airlockTold).toBe(true);

    const before = game.inputs.length;
    state = key(state, "x", game);
    expect(state.overlay).toBe("none");
    expect(state.effect.kind, "reading a card is not a turn").not.toBe("command");
    expect(game.inputs.length).toBe(before);
  });

  it("is said once a run, however many hulls are finished", () => {
    const game = aboard();
    let state = playing(game);
    startAll(game);
    state = syncStatus(state, game);
    expect(state.overlay).toBe("airlock");
    state = key(state, "Escape", game);

    // Home, and aboard the next hull: the same fact, a player who has already
    // read it, and no card.
    stopAll(game);
    state = syncStatus(state, game);
    startAll(game);
    state = syncStatus(state, game);
    expect(state.overlay, "the second telling is a card in the way").toBe("none");
  });

  it("never lands on top of a card already being read", () => {
    const game = aboard();
    let state = playing(game);
    state = key(state, "?", game);
    expect(state.overlay).toBe("help");

    startAll(game);
    state = syncStatus(state, game);
    expect(state.overlay, "the help card stays up").toBe("help");
    expect(state.airlockTold, "and the card is still owed").toBe(false);
  });

  it("says nothing on a training run, where the lesson's own window says it", () => {
    // The last two steps of the lesson are this card in other words, and the
    // window they are in is already on the screen (`content/hints.ts`,
    // `LESSON_SAYS`, for the same rule about the same two facts).
    // A training run opens aboard the lesson's own hull (`src/game.ts`).
    const game = newGame(4, true);
    let state = playing(game);
    startAll(game);
    state = syncStatus(state, game);
    expect(state.overlay).toBe("none");
    expect(state.airlockTold, "ticked off with the silence, so it stays quiet").toBe(true);
  });

  it("says nothing at home, where there is no hull to be aboard of", () => {
    const game = newGame(4);
    expect(airlockCard(game)).toBeUndefined();
  });
});
