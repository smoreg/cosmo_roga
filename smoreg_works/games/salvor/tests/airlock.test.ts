import { afterEach, describe, expect, it } from "vitest";
import type { RoomGame } from "@jamrog/engine";
import { newGame } from "../src/game.js";
import { derelictName } from "../src/content/derelicts.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import { shipState } from "../src/systems/shipstate.js";
import { derelictAboard } from "../src/systems/voyage.js";
import { rigOf } from "../src/twist/rig.js";
import { airlockCard } from "../src/ui/airlockcard.js";
import { appReducer, initialState, syncStatus, type AppState } from "../src/ui/appstate.js";
import { CODEX_WIDTH, toIntent } from "../src/ui/input.js";
import { codexBox } from "../src/ui/render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/ui/theme.js";
import { screenHtml } from "../src/ui/web/index.js";

/**
 * The airlock card (docs/tasks/G95-smoreg-wave.md, B2): the turn the third
 * system starts, the game says once — in a card and not in the log's seventh
 * row — that the hull is paid for on the way out and not before.
 *
 * The owner asked for it after finishing hulls and wondering where the money
 * was: «пусть в первый раз после подъёма всех систем вылетает уведомление, что
 * надо идти на причал и эвакуировать дрон».
 */

afterEach(() => setLang(DEFAULT_LANG));

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

  it("names the hull, what it is worth and the key that leaves, in all three languages", () => {
    const game = aboard();
    startAll(game);
    const state = derelictAboard(game)!;
    for (const lang of LANGS) {
      setLang(lang);
      const card = airlockCard(game)!;
      expect(card, lang).toBeDefined();
      const all = [card.heading, ...card.body, card.footer].join("\n");
      expect(all, lang).toContain(derelictName(state.spec));
      expect(all, lang).toContain(String(state.spec.salePrice));
      expect(all, lang).toContain("<");
      expect(all, lang).toContain(t("airlock.card.footer"));
      // The frame the two views draw it in fits the terminal, line by line.
      for (const line of card.body) expect(line.length, `${lang}: ${line}`).toBeLessThanOrEqual(CODEX_WIDTH);
      const box = codexBox(card.heading, card.body, card.footer);
      expect(box.width, lang).toBeLessThanOrEqual(SCREEN_WIDTH);
      expect(box.height, lang).toBeLessThanOrEqual(SCREEN_HEIGHT);
      if (lang !== "ru") expect(all, lang).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it("is a card on the page, with a footer the mouse can close it by", () => {
    const game = aboard();
    let state = playing(game);
    startAll(game);
    state = syncStatus(state, game);
    const html = screenHtml(game, state, new Set());
    expect(html).toContain('class="card good"');
    expect(html).toContain(t("airlock.card.title"));
    expect(html).toContain(`<div class="hint" data-key="Escape">`);
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
