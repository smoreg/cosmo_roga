// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RoomGame, type Twist } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { DOORS } from "../src/systems/doors.js";
import { RIG, findSlot, pulseWait, rigOf, PULSE_COOLDOWN } from "../src/twist/rig.js";
import { commandsOf } from "../src/ui/react/model.js";
import { CoreRack } from "../src/ui/react/meters/Rack.js";
import { Generating, GENERATING_MS } from "../src/ui/react/screens/Generating.js";

/**
 * Three things the player was promised and the engine does not owe them.
 *
 * The scan line, the struck module, and the second before a new ship: none of
 * them is a rule, all three are the view choosing what to show, and all three
 * are exactly the kind of thing that is correct in the model and invisible on
 * screen. So they are checked here, against a real game where there is one.
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const LINE = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3
  r1: docking
  r2: corridor
  r3: armory
`;

function gameOn(systems: Array<Twist<RoomGame>> = [RIG, DOORS]): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed: 7,
    systems,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(LINE).ship,
    firstShipId: "1",
  });
}

function labelsOf(game: RoomGame): string[] {
  return commandsOf(game).map((o) => o.label);
}

describe("the scan is on the orders while a scanner is in the rack", () => {
  it("is offered, and is not one of the engine's numbered actions", () => {
    const game = gameOn();
    const scan = commandsOf(game).find((o) => o.label.startsWith("scan"));
    expect(scan, labelsOf(game).join(" | ")).toBeDefined();
    /* Negative, because it is not a place in the engine's list — putting it in
       that list moved every numbered line in the game, tug included. */
    expect(scan?.index).toBeLessThan(0);
    expect(scan?.index).toBe(-1 - findSlot(rigOf(game.player)!, "scanner")!);
    expect(scan?.enabled).toBe(true);
  });

  it("greys out while it cools, and says how long for", () => {
    const game = gameOn();
    const slot = findSlot(rigOf(game.player)!, "scanner")!;
    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);

    const cooling = commandsOf(game).find((o) => o.index === -1 - slot);
    expect(cooling?.enabled).toBe(false);
    expect(cooling?.why).toMatch(/cooling/);
    expect(pulseWait(game)).toBe(PULSE_COOLDOWN - 1);
  });

  it("comes back, and the wait is the cooldown and not longer", () => {
    const game = gameOn();
    const slot = findSlot(rigOf(game.player)!, "scanner")!;
    game.playerCommand({ kind: "act", verb: "use", slot });
    for (let i = 0; i < PULSE_COOLDOWN; i++) game.playerCommand({ kind: "wait" });

    expect(pulseWait(game)).toBe(0);
    expect(commandsOf(game).find((o) => o.index === -1 - slot)?.enabled).toBe(true);
  });

  it("is not on the tug's orders, where there is nothing to scan", () => {
    /* The reason the line lives in the view at all: a fresh voyage opens
       docked, and the tug's own list must not grow a row. */
    const docked = newGame(4242);
    expect(labelsOf(docked).some((l) => l.startsWith("scan"))).toBe(false);
  });
});

describe("the rack points at the module that was hit", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    /* Motion on: the scramble is the whole subject here. */
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        onchange: null,
        dispatchEvent: () => false,
      }),
    });
  });

  const slots = (armour: number) => [
    { name: "Armour", value: armour, max: 8 },
    { name: "Scanner", value: 6, max: 6 },
  ];

  function nameAt(host: HTMLElement, i: number): string {
    return host.querySelector(`[data-slot="${String(i)}"] [data-sc]`)?.textContent ?? "";
  }

  it("scrambles the struck slot and leaves the others alone", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<CoreRack core={3} coreMax={3} slots={slots(8)} />);
    });
    expect(nameAt(host, 0)).toBe("Armour");

    act(() => {
      root.render(<CoreRack core={3} coreMax={3} slots={slots(5)} />);
    });
    /* Mid-scramble the line is not its own name — that is what the animation
       is. The one that was not hit never moved. */
    expect(nameAt(host, 0)).not.toBe("Armour");
    expect(nameAt(host, 1)).toBe("Scanner");

    act(() => {
      root.unmount();
    });
    /* And cancelling puts it back, rather than leaving a blank rack. */
    host.remove();
  });

  it("says nothing when a number goes up, or holds still", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<CoreRack core={3} coreMax={3} slots={slots(5)} />);
    });
    act(() => {
      root.render(<CoreRack core={3} coreMax={3} slots={slots(8)} />);
    });
    expect(nameAt(host, 0), "a repair is not a hit").toBe("Armour");

    act(() => {
      root.render(<CoreRack core={3} coreMax={3} slots={slots(8)} />);
    });
    expect(nameAt(host, 0)).toBe("Armour");

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});

describe("the generating screen holds the door for a second", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("hands over once, and only after the second is up", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const done = vi.fn();

    act(() => {
      root.render(<Generating onDone={done} />);
    });
    act(() => {
      vi.advanceTimersByTime(GENERATING_MS - 1);
    });
    expect(done).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(done).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("stops churning when it is taken down", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(<Generating onDone={() => undefined} />);
    });
    act(() => {
      root.unmount();
    });
    /* No interval left running: a strip that kept scrambling after the screen
       is gone is a timer nobody owns. */
    expect(vi.getTimerCount()).toBe(0);

    host.remove();
    vi.useRealTimers();
  });
});
