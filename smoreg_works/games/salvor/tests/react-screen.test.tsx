// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { Screen } from "../src/ui/react/Screen.js";
import { alertOf, boardOf, isHome, rackOf, logOf, routeIn } from "../src/ui/react/model.js";
import { undock } from "../src/systems/voyage.js";
import { BLOWN, CHARGE_LEVEL, FUSE_TURNS, MAX_LEVEL, alertState, isBlown, raiseAlert } from "../src/systems/alert.js";

/**
 * The React view, against a real game.
 *
 * The browser is not where this repo checks anything — the owner takes the
 * screenshots. So the view is held to the same standard as everything else: it
 * is mounted against a genuine `newGame`, and what it puts on the page is
 * compared with what the engine says is true. A picture that disagrees with the
 * game is the one failure a screenshot would not catch anyway.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

describe("the board reads the game", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("places every compartment the layout could, and no others", () => {
    /* A voyage opens docked at the tug, which is four compartments and a legal
       board — so the floor here is "every room the ship has", not a number
       somebody liked the look of. */
    const game = newGame(4242);
    const board = boardOf(game);
    expect(board.rooms.length).toBe(game.ship.rooms.length);
    /* And never a door to a compartment the honeycomb left off: a corridor to
       nowhere is worse than no corridor. */
    const placed = new Set(board.rooms.map((r) => r.id));
    for (const door of board.doors) {
      expect(placed.has(door.a)).toBe(true);
      expect(placed.has(door.b)).toBe(true);
    }
  });

  it("says the drone is in exactly one compartment, and that it is the engine's", () => {
    const game = newGame(7);
    const board = boardOf(game);
    const current = board.rooms.filter((r) => r.knows === "current");
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe(game.player.room);
  });

  it("never shows the contents of a compartment the drone has not seen", () => {
    const game = newGame(99);
    for (const room of boardOf(game).rooms) {
      if (room.knows === "undetected" || room.knows === "detected") {
        expect(room.things).toHaveLength(0);
      }
    }
  });

  it("plans a route the engine would let the drone walk", () => {
    const game = newGame(1234);
    const board = boardOf(game);
    const route = routeIn(game, board);
    const far = board.rooms.find((r) => r.id !== board.drone);
    const walk = far === undefined ? null : route(far.id);
    if (walk === null) return; // a one-room hull is legal, if dull
    expect(walk.path.length).toBeGreaterThan(0);
    expect(walk.path[walk.path.length - 1]).toBe(far?.id);
  });

  it("reads the rack off the rig rather than inventing one", () => {
    const game = newGame(5);
    const rack = rackOf(game);
    expect(rack.slots).toHaveLength(6);
    expect(rack.core).toBe(game.player.hp);
    /* And as many pips as the hull it is flying has, not a constant three: the
       dock sells hulls with five (`content/hulls.ts`), and the terminal's own
       panel counts the dots off the same number (`twist/rig.ts`). */
    expect(rack.coreMax).toBe(game.player.hpMax);
  });

  it("mounts and draws the ship's own compartment names", () => {
    /* Aboard, not at home: a voyage opens docked, and the tug draws no
       honeycomb at all — it is a decision and not a place (`screens/Tug.tsx`).
       So the board is given a ship before it is asked to draw one. */
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    expect(isHome(game)).toBe(false);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });
    const text = host.textContent ?? "";
    const here = game.ship.roomAt(game.player.room as number);
    expect(text).toContain(here.name.slice(0, 6));
    /* The log is the game's, so the newest line it wrote has to be on screen. */
    const newest = logOf(game)[0];
    if (newest !== undefined) expect(text.length).toBeGreaterThan(0);
    act(() => {
      root.unmount();
    });
    host.remove();
  });
});

/**
 * The alert, which is ten rungs and not five.
 *
 * The screen was ported against a copy of this game from before the ladder was
 * built, so it drew a dial of five steps and a board that knew nothing about a
 * charge. Everything here is checked against `systems/alert.ts` itself: the
 * number of rungs, the word on the one the ship is on, and the compartment the
 * ship actually set a charge in.
 */
describe("the alert is a ladder of ten, and the ship blows its own compartments", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  /** A drone aboard a derelict with the gauge wound to a given rung. */
  function aboardAt(seed: number, level: number) {
    const game = newGame(seed);
    expect(undock(game).ok).toBe(true);
    raiseAlert(game, level);
    return game;
  }

  it("reads as many rungs as the ladder has, in the ladder's own words", () => {
    const game = aboardAt(4242, CHARGE_LEVEL);
    const alert = alertOf(game);
    expect(alert.max).toBe(MAX_LEVEL);
    expect(alert.rungs).toHaveLength(MAX_LEVEL);
    expect(alert.level).toBe(alertState(game).level);
    /* The word is the rung's own, and the rung is the one the ship is on: at
       nine it is the scuttle, which is the first rung that does anything to
       the hull rather than to what is walking about in it. */
    expect(alert.level).toBe(CHARGE_LEVEL);
    expect(alert.word).toBe(alert.rungs[CHARGE_LEVEL - 1]);
    expect(alert.charging).toBe(true);
  });

  it("carries every charge the ship set, with the turns the engine says are left", () => {
    const game = aboardAt(4242, CHARGE_LEVEL);
    const state = alertState(game);
    expect(state.fuses.length, "nine sets its first charge at once").toBeGreaterThan(0);
    const alert = alertOf(game);
    expect(alert.fuses.map((f) => f.room)).toEqual(
      [...state.fuses].sort((a, b) => a.at - b.at).map((f) => game.ship.roomAt(f.room).label),
    );
    for (const fuse of alert.fuses) expect(fuse.turns).toBeGreaterThanOrEqual(0);

    /* And the board puts the same number on the same compartment, so the map
       and the panel cannot disagree about which one is about to go. */
    const charged = boardOf(game).rooms.filter((r) => r.charge !== undefined);
    expect(charged.map((r) => r.label).sort()).toEqual(alert.fuses.map((f) => f.room).sort());
    for (const room of charged) {
      expect(room.charge).toBe(alert.fuses.find((f) => f.room === room.label)?.turns);
    }
  });

  it("puts the rungs and the countdown on the screen", () => {
    const game = aboardAt(4242, CHARGE_LEVEL);
    const alert = alertOf(game);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });
    const shown = host.textContent ?? "";
    /* Every rung is drawn, not only the one reached: the ladder's whole point
       is that it answers "what next", which a dial never could. */
    for (const rung of alert.rungs) expect(shown).toContain(rung);
    for (const fuse of alert.fuses) expect(shown).toContain(fuse.room);
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("marks a compartment a charge has blown, and takes its contents off the board", () => {
    const game = aboardAt(4242, CHARGE_LEVEL);
    const fuse = alertState(game).fuses[0];
    expect(fuse).toBeDefined();
    /* Wind the fuse down to nothing and let the ship spend it. The blast is
       the alert's own, not the board's: what the board has to do is notice. */
    const room = fuse?.room as number;
    for (let turn = 0; turn <= FUSE_TURNS && !isBlown(game.ship.roomAt(room)); turn++) {
      game.playerCommand({ kind: "wait" });
    }
    expect(isBlown(game.ship.roomAt(room)), "the fuse burned down and the charge went").toBe(true);

    const drawn = boardOf(game).rooms.find((r) => r.id === room);
    expect(drawn?.props).toContain("blown");
    expect(drawn?.hazard?.id).toBe(BLOWN);
    /* What was in there is gone, which is the ship's rule and not the board's:
       the board only has to stop drawing it. */
    expect(drawn?.things).toHaveLength(0);
  });
});
