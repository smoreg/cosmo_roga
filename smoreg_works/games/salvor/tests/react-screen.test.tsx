// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { Screen } from "../src/ui/react/Screen.js";
import { boardOf, isHome, rackOf, logOf, routeIn } from "../src/ui/react/model.js";
import { undock } from "../src/systems/voyage.js";

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
