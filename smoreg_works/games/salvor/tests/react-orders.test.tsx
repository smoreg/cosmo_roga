// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RoomGame, spawnMonsterIn, type Twist } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { undock } from "../src/systems/voyage.js";
import { Screen } from "../src/ui/react/Screen.js";
import { alertModelOf, boardOf, hullMovedDoor } from "../src/ui/react/model.js";
import { raiseAlert } from "../src/systems/alert.js";
import { isStop, makeExplorer, makeTraveller } from "../src/ui/auto.js";
import { MONSTERS } from "../src/content/monsters.js";

/** The scout, by the id the bestiary files it under. */
const SCOUT = MONSTERS.find((m) => m.id === "scout")!;
import * as FX from "../src/ui/fx/derelict-fx.js";
import { DECK_INK } from "../src/ui/react/board/HexBoard.js";
import { sfx, soundFor, swingOf } from "../src/ui/react/sfx.js";
import { forget, remember, resume, suspended } from "../src/ui/react/suspend.js";
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

describe("the sweep animates a scan and nothing else", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

  /** Compartments the board is drawing as unknown right now. */
  function dark(host: HTMLElement): number {
    return host.querySelectorAll('[data-room][data-knows="undetected"]').length;
  }

  /**
   * A scan is the one action whose entire output is a change in what the board
   * shows, so it is the one action that is nothing but an animation: the
   * compartments it reaches arrive nearest first, inside one budget.
   *
   * And nothing else may do that. The first version of this asked "did two or
   * more compartments become known at once", which is also true of walking
   * through a door with sight down a corridor — and a board that drops to
   * unknown and resolves back reads, on compartments painted with deck art, as
   * the art failing to load rather than as an animation.
   */
  it("holds the far compartments back for a frame, and hands them all over", () => {
    vi.useFakeTimers();
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });
    const before = dark(host);

    /* Through the screen's own control, because the sweep is the screen's
       reaction to the run moving and nothing outside the screen can move it. */
    const rows = Array.from(host.querySelectorAll("div")).filter(
      (d) => d.textContent?.includes("reads two doors out") === true,
    );
    const row = rows[rows.length - 1];
    expect(row, "no scan on the orders").toBeDefined();
    act(() => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The scan has landed in the game — and the board has not caught up yet. */
    expect(boardOf(game).rooms.filter((r) => r.knows === "undetected").length).toBeLessThan(before);
    expect(dark(host), "the sweep is still out").toBe(before);

    act(() => {
      vi.advanceTimersByTime(FX.FRAME * 6);
    });
    expect(dark(host), "and everything it reached has arrived").toBe(
      boardOf(game).rooms.filter((r) => r.knows === "undetected").length,
    );

    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("does not sweep when the drone merely walks", () => {
    vi.useFakeTimers();
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });

    /* Whatever a step reveals is on the board the same frame the step lands. */
    for (let i = 0; i < 6; i++) {
      const door = game.ship.doorsOf(game.roomOf(game.player).id).find((d) => d.state === "open");
      if (door === undefined) break;
      const to = game.ship.other(door, game.roomOf(game.player).id);
      const hex = host.querySelector(`[data-room="${String(to)}"]`);
      if (hex === null) break;
      act(() => {
        hex.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(dark(host)).toBe(boardOf(game).rooms.filter((r) => r.knows === "undetected").length);
    }

    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });
});

describe("what the design asked the screen to say out loud", () => {
  it("prices the virus on the salvage, and says nothing about a sealed crate", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    /* Every wreck the hull holds, priced by whose it was. A crate is the safe,
       boring option and the mechanic is passing it up — so a crate that showed
       a number would be the one thing this must never do. */
    const risks = boardOf(game)
      .rooms.flatMap((r) => r.things)
      .filter((t) => t.risk !== undefined);
    for (const t of risks) {
      expect(t.risk).toBeGreaterThan(0);
      expect(t.risk).toBeLessThanOrEqual(1);
      expect(t.name.startsWith("crate"), t.name).toBe(false);
    }
  });

  it("reads the alert gauge off the ten-rung ladder, not off a five-rung one", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const gauge = alertModelOf(game);
    /* The merge took the ladder from five rungs to ten and the dial kept
       drawing five, so a ship at SCUTTLE showed a full gauge two rungs before
       it was full and the same gauge at the top. */
    expect(gauge.top).toBe(10);
    expect(gauge.word).toBe("QUIET");
    raiseAlert(game, 7);
    expect(alertModelOf(game).level).toBe(7);
    expect(alertModelOf(game).word).not.toBe("QUIET");
    /* The only clock this mechanic has is the way back down. */
    expect(alertModelOf(game).needed).toBeGreaterThan(0);
  });
});

describe("a bulkhead that changes says so", () => {
  it("knows the hull shut it from the log's own key, not from the sentence", () => {
    const game = gameOn();
    expect(hullMovedDoor(game)).toBe(false);
    /* The key is the event; the sentence is for the player and gets rewritten.
       A door the drone threw itself must never raise the mark — it is the mark
       for "nothing told you this happened". */
    game.log.add("You pull d1 shut.", game.schedule.time, "plain", "log.door.close");
    expect(hullMovedDoor(game)).toBe(false);
    game.log.add("The ship shuts d1 behind you.", game.schedule.time, "bad", "log.alert.door");
    expect(hullMovedDoor(game)).toBe(true);
    /* And it is this turn's news only. */
    game.playerCommand({ kind: "wait" });
    expect(hullMovedDoor(game)).toBe(false);
  });
});

describe("the sound never breaks the press it decorates", () => {
  /**
   * The bug this exists for, found by two other tests going red at once: under
   * a headless DOM `HTMLMediaElement.play()` throws synchronously rather than
   * rejecting, and the throw came out of the click handler the sound was
   * decorating — so a scan and a menu row simply stopped working the moment
   * they were given a click sound.
   */
  it("swallows a media element that cannot play", () => {
    expect(() => {
      sfx.setVolume(1);
      sfx.click();
      sfx.play("step");
      sfx.warm();
    }).not.toThrow();
  });

  it("names the drone's swing off the same rack the rig swings with", () => {
    const game = gameOn();
    /* A starting rack has a CUTTER, which is a swing and not a shot. */
    expect(swingOf(game)).toBe("melee");
    /* And what hits the drone is never what the drone is holding. */
    expect(soundFor("log.hit.module", game)).toBe("incoming");
    expect(soundFor("log.emitter.hit", game)).toBe("emitter");
    expect(soundFor("engine.hit.you", game)).toBe(swingOf(game));
    /* Almost everything is silent, which is the point of having seven. */
    expect(soundFor("log.credit", game)).toBeUndefined();
    expect(soundFor(undefined, game)).toBeUndefined();
  });
});

describe("walking away from something standing next to you", () => {
  const SHIP = `
    TUG -a1- r1
    r1 -d1- r2 -d2- r3
    r1: docking
    r2: corridor
    r3: armory
  `;

  function aboard(): RoomGame {
    return new RoomGame({
      ...GAME_CONFIG,
      seed: 7,
      systems: [RIG, DOORS],
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(SHIP).ship,
      firstShipId: "1",
    });
  }

  /**
   * The bug: the stop list was asked before a single step was taken, and it
   * answered "there is a machine in sight" about the machine in the drone's
   * own compartment. So naming a destination moved the drone not at all — and
   * a drone sharing a compartment with a scout could not walk out of it, which
   * is the one moment you most want to.
   */
  it("lets travel take the first step past a machine in the same compartment", () => {
    const game = aboard();
    const scout = spawnMonsterIn(SCOUT, game.roomOf(game.player).id);
    game.schedule.admit(scout);
    game.entities.push(scout);
    game.refreshSight();

    const step = makeTraveller(game.ship.room("r3").id).step(game);
    expect(isStop(step), "travel refused to leave the compartment").toBe(false);
  });

  it("still hands the ship back for one a compartment away", () => {
    const game = aboard();
    const scout = spawnMonsterIn(SCOUT, game.ship.room("r2").id);
    game.schedule.admit(scout);
    game.entities.push(scout);
    game.refreshSight();

    expect(isStop(makeTraveller(game.ship.room("r3").id).step(game))).toBe(true);
  });

  it("does not give auto-explore the same exemption", () => {
    /* Explore means "keep going while nothing needs me", and a machine an
       arm's length away needs you. Measured, not argued: without the stop the
       careful bot walks past the fight and dies of it. */
    const game = aboard();
    const scout = spawnMonsterIn(SCOUT, game.roomOf(game.player).id);
    game.schedule.admit(scout);
    game.entities.push(scout);
    game.refreshSight();

    expect(isStop(makeExplorer().step(game))).toBe(true);
  });
});

describe("the plating is drawn where it can be seen", () => {
  /**
   * The bug this pins: the ink was a third and a fifth, and the art is thin
   * light line work on mostly-transparent ground — so a compartment nobody had
   * been in drew its floor at about six per cent of a pale line over the
   * darkest colour in the palette, which is nothing at all. Three screenshots
   * of "I don't see the tiles" were this number, not the assets, not the
   * fetch, and not the paint order — all three of which had already been fixed
   * and tested.
   */
  it("keeps every state above the floor where a pale line stops reading", () => {
    const ink = DECK_INK as Record<string, number>;
    for (const state of ["current", "monitored", "detected", "undetected"]) {
      expect(ink[state], `${state} is too faint to read`).toBeGreaterThanOrEqual(0.35);
    }
    /* And the order still says what has been established: the floor underfoot
       is the one the drone has actually stood on. */
    expect(ink.current).toBeGreaterThan(ink.monitored!);
    expect(ink.monitored).toBeGreaterThan(ink.detected!);
    expect(ink.detected).toBeGreaterThan(ink.undetected!);
    /* Hull is not a floor. */
    expect(ink.wrecked).toBe(0);
  });
});

describe("a run survives the tab closing", () => {
  /** A localStorage that exists only for this test. */
  function slate(): void {
    const kept = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => kept.get(k) ?? null,
        setItem: (k: string, v: string) => kept.set(k, v),
        removeItem: (k: string) => kept.delete(k),
      },
    });
  }

  /**
   * What was wrong: there was no save at all. `Continue` was lit only while a
   * game object was still in memory, so it was the button for a menu opened
   * mid-sortie and nothing else — reload the page and the voyage was gone with
   * no word said, which is the one thing permadeath must never be confused
   * with.
   */
  it("comes back to the same ship, the same turn and the same rack", () => {
    slate();
    forget();
    expect(suspended()).toBe(false);

    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    for (let i = 0; i < 6; i++) game.playerCommand({ kind: "wait" });
    remember(game);
    expect(suspended()).toBe(true);

    const back = resume();
    expect(back, "the save would not replay").toBeDefined();
    /* A run is (seed, inputs), so "the same run" is not a resemblance: it is
       the same seed, the same commands and therefore the same everything. */
    expect(back!.seed).toBe(game.seed);
    expect(back!.inputs.length).toBe(game.inputs.length);
    expect(back!.player.room).toBe(game.player.room);
    expect(back!.player.hp).toBe(game.player.hp);
    expect(back!.schedule.time).toBe(game.schedule.time);
  });

  it("keeps nothing once the run is over", () => {
    slate();
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    game.playerCommand({ kind: "wait" });
    remember(game);
    expect(suspended()).toBe(true);

    /* A finished run leaves the menu and nothing else — this is a suspend, not
       meta-progression, and the difference is that it does not outlive the
       run it belongs to. */
    game.finish("dead", "Core breach.");
    remember(game);
    expect(suspended()).toBe(false);
    expect(resume()).toBeUndefined();
  });

  it("throws away a save it cannot read rather than opening it", () => {
    slate();
    localStorage.setItem("derelict-rogue:run", "{not json");
    expect(suspended()).toBe(false);
    localStorage.setItem("derelict-rogue:run", JSON.stringify({ version: 1, seed: 1, inputs: [] }));
    expect(suspended(), "a save from an older build is not this game").toBe(false);
  });
});

describe("the drone mark is where the drone is", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

  /**
   * Two bugs the owner hit in one screenshot, both from the board animating
   * the *planned* route and handing the turn to the game only when it landed:
   * the mark walked the whole way while the drone walked as far as the rules
   * let it, and the animation wrote its own label into the face — which is a
   * drawing, so the drone became a diamond for the rest of the run.
   */
  it("hands the walk to the game rather than playing it first", () => {
    vi.useFakeTimers();
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });

    const from = game.player.room;
    const door = game.ship
      .doorsOf(game.roomOf(game.player).id)
      .find((d) => d.state !== "airlock" && d.state !== "sealed" && d.state !== "locked");
    expect(door, "no way out of the docking bay").toBeDefined();
    const to = game.ship.other(door!, from!);
    const hex = host.querySelector(`[data-room="${String(to)}"]`);
    expect(hex).not.toBeNull();

    act(() => {
      hex!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The first step is spent on the press, not after an animation. */
    expect(game.player.room, "the drone did not move").toBe(to);

    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it("keeps the drone's own face rather than a glyph", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });

    const face = host.querySelector("[data-fx-face]");
    expect(face).not.toBeNull();
    /* A drawing, not a character: the move animation used to write its label
       into this node, and `textContent` takes the drawing with it. */
    expect(face!.querySelector("svg"), "the drone's face is not a drawing").not.toBeNull();
    expect(face!.textContent).not.toBe("◆");

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
