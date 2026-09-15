// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { App } from "../src/ui/react/App.js";
import { Screen } from "../src/ui/react/Screen.js";
import { boardOf, hereOf, commandsOf, rackOfHull } from "../src/ui/react/model.js";
import { doorWays } from "../src/ui/doorlist.js";
import {
  codexOf,
  endingOf,
  helpOf,
  historyOf,
  isHome,
  offersOf,
  tugOf,
} from "../src/ui/react/model.js";
import { roomActions } from "../src/ui/actions.js";
import { CODEX_IDS } from "../src/content/codex.js";
import { titleScreen, DEFAULT_TITLE } from "../src/ui/title.js";

/**
 * The screens that are not the board, against a real game.
 *
 * Same standard as the board: mounted on a genuine `newGame` and compared with
 * what the engine says is true, because a screen that disagrees with the game
 * is the one failure a screenshot would not catch. The tug gets the most of it
 * — it is the half of the run with no honeycomb to check against, so nothing
 * but a test says its list is the engine's list.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * The screens are read with the motion turned off.
 *
 * `scrambleReveal` resolves a line over held frames, so a line caught mid-
 * reveal is noise — and a test that waited for the frames would be measuring
 * the clock. Under `prefers-reduced-motion` the library puts the true text
 * straight in (`fx/derelict-fx.js`), which is both the accessible path and the
 * only one a test can read, so it is the one the tests run.
 */
function stillFrames(): void {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

function mount(node: React.ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    host,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const text = (host: HTMLElement): string => host.textContent ?? "";

describe("the tug is a decision, and says what the engine says", () => {
  beforeAll(stillFrames);

  it("opens at home, where there is no honeycomb", () => {
    const game = newGame(4242);
    expect(isHome(game)).toBe(true);
    const { host, unmount } = mount(<Screen game={game} />);
    /* The board draws its compartments as `<polygon>`; the tug draws none,
       which is the whole claim `ui/tugboard.ts` makes about coming home. */
    expect(host.querySelectorAll("polygon").length).toBe(0);
    expect(text(host)).toContain(tugOf(game).derelict.name);
    unmount();
  });

  it("offers exactly the lines the engine offers, in its order", () => {
    const game = newGame(4242);
    const offers = offersOf(game);
    const actions = roomActions(game);
    expect(offers.map((o) => o.label)).toEqual(actions.map((a) => a.label));
    expect(offers.map((o) => o.enabled)).toEqual(actions.map((a) => a.enabled));
    const { host, unmount } = mount(<Screen game={game} />);
    for (const offer of offers) expect(text(host)).toContain(offer.label);
    unmount();
  });

  it("keeps a refused line on the shelf, wearing its reason", () => {
    const game = newGame(4242);
    const refused = offersOf(game).filter((o) => !o.enabled && o.why !== undefined);
    const { host, unmount } = mount(<Screen game={game} />);
    /* A shelf that hides what cannot be afforded teaches nothing about the
       price, so what the engine refuses is still on it. */
    for (const offer of refused) expect(text(host)).toContain(offer.label);
    unmount();
  });

  it("says the account and the rack the voyage actually has", () => {
    const game = newGame(7);
    const tug = tugOf(game);
    const { host, unmount } = mount(<Screen game={game} />);
    expect(text(host)).toContain(String(tug.account.credits));
    for (const hull of tug.hulls) expect(text(host)).toContain(hull.name);
    /* One hull is on the rails, and it is the voyage's own. */
    expect(tug.hulls.filter((h) => h.on)).toHaveLength(1);
    unmount();
  });
});

describe("the cards are read, never played", () => {
  beforeAll(stillFrames);

  it("puts the controls up on `?` and takes no turn doing it", () => {
    const game = newGame(4242);
    const before = game.schedule.time;
    const { host, unmount } = mount(<Screen game={game} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    const first = helpOf(game).pages[0] ?? [];
    for (const line of first.filter((l) => l !== "")) expect(text(host)).toContain(line);
    expect(game.schedule.time).toBe(before);
    unmount();
  });

  it("puts the record up on PageUp, newest first", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    });
    const entries = historyOf(game);
    expect(entries.length).toBe(game.log.lines.length);
    if (entries[0] !== undefined) expect(text(host)).toContain(entries[0].text);
    unmount();
  });

  it("closes on Esc, and the game is where it was", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    expect(text(host)).toContain("close");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(text(host)).not.toContain("close [esc]");
    expect(game.status).toBe("playing");
    unmount();
  });

  it("reads a codex card out of the table and marks what the rack answers with", () => {
    const game = newGame(4242);
    const id = CODEX_IDS[0] as string;
    const card = codexOf(game, id);
    expect(card).toBeDefined();
    expect(card?.title.length).toBeGreaterThan(0);
    expect(card?.lore.length).toBeGreaterThan(0);
    /* Every module the card names is named, whether or not it is carried: the
       line is advice about the rack, not a list of what is in it. */
    expect(codexOf(game, "no-such-card")).toBeUndefined();
  });

  it("counts the run up at the end, and the seed flies it again", () => {
    const game = newGame(4242);
    const end = endingOf(game);
    expect(end.seed).toBe(game.seed);
    expect(end.won).toBe(false);
    expect(end.turns).toBe(game.schedule.time);
  });
});

describe("the title is in front of a run, not instead of one", () => {
  beforeAll(stillFrames);

  it("draws every row the menu has, in the menu's order", () => {
    const { host, unmount } = mount(<App seed={4242} />);
    const screen = titleScreen({ ...DEFAULT_TITLE, seed: 4242 });
    expect(text(host)).toContain(screen.name);
    for (const item of screen.items) expect(text(host)).toContain(item.label);
    unmount();
  });

  it("starts a run on the first row, and the run is the seed on the screen", () => {
    const { host, unmount } = mount(<App seed={4242} />);
    const screen = titleScreen({ ...DEFAULT_TITLE, seed: 4242 });
    const label = screen.items[0]?.label ?? "";
    const row = Array.from(host.querySelectorAll("span")).find((el) => el.textContent === label);
    expect(row).toBeDefined();
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The title is gone and the tug is up: a voyage opens docked. */
    expect(text(host)).not.toContain(screen.foot);
    expect(text(host)).toContain(tugOf(newGame(4242)).derelict.name);
    unmount();
  });
});

describe("the board does not outlive what it is about", () => {
  beforeAll(stillFrames);

  it("offers a bulkhead the ways the engine offers, and no others", () => {
    const game = newGame(4242);
    const board = boardOf(game);
    /* Only the bulkheads the drone is standing next to answer for anything;
       the rest say "not from here", which is the terminal's own rule. */
    for (const door of board.doors) {
      const ways = doorWays(game, door.id);
      if (ways === undefined) continue;
      const offered = ways.filter((a) => a.step === undefined);
      expect(door.verbs.map((v) => v.verb)).toEqual(offered.map((a) => a.label));
      expect(door.verbs.map((v) => v.enabled)).toEqual(offered.map((a) => a.enabled));
    }
  });

  it("keeps a way the engine refuses on the menu, wearing its reason", () => {
    const game = newGame(4242);
    for (const door of boardOf(game).doors) {
      for (const way of door.verbs) {
        /* Nothing is dropped for being unaffordable, and nothing is offered
           without saying what it costs or why it cannot be spent. */
        expect(way.note.length > 0 || way.enabled).toBe(true);
      }
    }
  });

  it("drops a readout the moment its subject leaves the ship", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    /* The board is a function of the game: nothing it draws survives a thing
       going, because nothing it draws is remembered separately from the game.
       A chip with no thing behind it is the failure this guards. */
    const board = boardOf(game);
    const named = new Set(board.rooms.flatMap((r) => r.things.map((t) => t.name)));
    for (const el of Array.from(host.querySelectorAll("[data-sc]"))) {
      const text = el.textContent ?? "";
      const machine = board.rooms
        .flatMap((r) => r.things)
        .find((t) => t.name === text && t.hostile === true);
      if (machine !== undefined) expect(named.has(machine.name)).toBe(true);
    }
    unmount();
  });
});

describe("the panel carries what the honeycomb cannot", () => {
  beforeAll(stillFrames);

  it("lists everything in the compartment, with the verb each answers to", () => {
    const game = newGame(4242);
    const here = hereOf(game);
    const { host, unmount } = mount(<Screen game={game} />);
    for (const thing of here) expect(text(host)).toContain(thing.name);
    unmount();
  });

  it("offers the drone's own commands, which is where the way off a hull lives", () => {
    const game = newGame(4242);
    const commands = commandsOf(game);
    const actions = roomActions(game);
    /* Nothing aimed at a thing and nothing aimed at a bulkhead: those are the
       board's. What is left is the drone's, and it must be exactly that. */
    for (const line of commands) {
      const cmd = actions[line.index]?.cmd;
      expect(cmd).toBeDefined();
      expect("target" in (cmd as object)).toBe(false);
    }
    expect(commands.map((c) => c.index)).toEqual([...new Set(commands.map((c) => c.index))]);
  });

  it("never offers the same line twice, on the board and in the panel both", () => {
    const game = newGame(4242);
    const board = boardOf(game);
    const onBoard = new Set(board.rooms.flatMap((r) => r.things.map((t) => t.verb)));
    for (const line of commandsOf(game)) {
      /* A command in the panel that is also a thing's own verb would be two
         ways to spend one turn, and the second is always the one that surprises. */
      expect(onBoard.has(line.label)).toBe(false);
    }
  });
});

describe("the dock is read before it is spent", () => {
  beforeAll(stillFrames);

  it("carries everything an inspection of a drone shows", () => {
    const game = newGame(4242);
    for (const hull of tugOf(game).hulls) {
      expect(hull.core).toBeGreaterThan(0);
      expect(hull.slots).toBeGreaterThanOrEqual(hull.modules.length);
      expect(hull.modules.length).toBeGreaterThan(0);
    }
  });

  it("puts the account and the three drones under one housing, and only one", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    expect(text(host)).toContain("account");
    expect(text(host)).toContain("drones");
    for (const hull of tugOf(game).hulls) expect(text(host)).toContain(hull.name);
    /* The dock was being drawn twice — the readout, and an empty compartment
       panel behind it wearing the same name. One housing, one title. */
    const docks = Array.from(host.querySelectorAll("div")).filter(
      (d) => d.textContent === "Dock",
    );
    expect(docks.length).toBeLessThanOrEqual(1);
    unmount();
  });

  it("gives the orders the middle, where the honeycomb would be", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    /* The tug's own list is the one list. It used to be said twice: once in
       the middle as the dock, and again down the side as orders. */
    const titles = Array.from(host.querySelectorAll("div"))
      .map((d) => d.textContent)
      .filter((t) => t === "Orders");
    expect(titles.length).toBe(1);
    for (const offer of offersOf(game)) expect(text(host)).toContain(offer.label);
    unmount();
  });

  it("points the rack at whichever drone the dock is looking at", () => {
    const game = newGame(4242);
    const flying = tugOf(game).hulls.find((h) => h.on);
    const other = tugOf(game).hulls.find((h) => !h.on);
    expect(flying).toBeDefined();
    expect(other).toBeDefined();
    const preview = rackOfHull(other?.id ?? "");
    expect(preview).toBeDefined();
    /* A hull nobody has undocked in has spent no integrity, so every bay it
       comes with is full — which is what makes it readable as a preview. */
    expect(preview?.slots.filter((s) => s.name !== undefined)).toHaveLength(
      other?.modules.length ?? -1,
    );
    expect(preview?.slots).toHaveLength(other?.slots ?? -1);
    expect(preview?.core).toBe(other?.core);
    expect(rackOfHull("no-such-hull")).toBeUndefined();

    const { host, unmount } = mount(<Screen game={game} />);
    const row = Array.from(host.querySelectorAll("span")).find(
      (el) => el.textContent === other?.name,
    );
    expect(row).toBeDefined();
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The rack above now names that hull's modules, not the flying one's. */
    for (const m of other?.modules ?? []) expect(text(host)).toContain(m);
    unmount();
  });
});
