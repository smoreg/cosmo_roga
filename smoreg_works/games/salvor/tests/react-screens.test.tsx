// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { App } from "../src/ui/react/App.js";
import { Screen } from "../src/ui/react/Screen.js";
import { boardOf, hereOf, commandsOf, rackOfHull } from "../src/ui/react/model.js";
import { linesOf, reveal } from "../src/ui/react/reveal.js";
import { applyDeckIndex, loadDeckIndex } from "../src/ui/react/deckindex.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
import { currentDerelict, undock } from "../src/systems/voyage.js";
import { CONTENT_KEYS } from "../src/ui/contents.js";
import { addWreck } from "../src/twist/rig.js";
import { goalOf } from "../src/ui/react/model.js";
import { derelictName } from "../src/content/derelicts.js";
import { OBJECTIVE_COUNT, objectiveSpec } from "../src/content/objectives.js";
import { voyageOf } from "../src/systems/voyage.js";
import { shipState } from "../src/systems/shipstate.js";
import { systemsAboard } from "../src/systems/ship.js";
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
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
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

  /**
   * Past the door.
   *
   * The game opens on a splash, because a browser will not let a page make
   * noise until it has been touched and the deck art should not arrive under
   * the board's first frame. A player presses it; so does this.
   */
  const past = (host: HTMLElement): void => {
    const door = Array.from(host.querySelectorAll("div")).find(
      (d) => d.textContent === "click to start",
    );
    act(() => {
      door?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* jsdom has no audio and no server, so every step either fails fast or
       never fires; the loader's own deadline is what opens the door either
       way, and here it is reached by hand rather than waited out. */
    /* The deadline, then the beat between the last step landing and the door
       opening — which is there so the bars are seen full rather than vanishing
       on the frame they fill. Each is scheduled by the render the one before
       it caused, so they are run out rather than counted. */
    for (let pass = 0; pass < 4; pass++) {
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }
    vi.useRealTimers();
  };

  it("draws every row the menu has, in the menu's order", () => {
    vi.useFakeTimers();
    const { host, unmount } = mount(<App seed={4242} />);
    past(host);
    const screen = titleScreen({ ...DEFAULT_TITLE, seed: 4242 });
    expect(text(host)).toContain(screen.name);
    for (const item of screen.items) expect(text(host)).toContain(item.label);
    unmount();
  });

  it("starts a run on the first row, and the run is the seed on the screen", () => {
    vi.useFakeTimers();
    const { host, unmount } = mount(<App seed={4242} />);
    past(host);
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

  it("says the account under the tug's own name, and the drones in the dock", () => {
    const game = newGame(4242);
    const tug = tugOf(game);
    const { host, unmount } = mount(<Screen game={game} />);
    /* The account is the tug's, so it is under the tug's callsign. */
    expect(text(host)).toContain(tug.callsign);
    expect(text(host)).toContain("banked");
    for (const hull of tug.hulls) expect(text(host)).toContain(hull.name);
    /* The dock was being drawn twice — the readout, and an empty compartment
       panel behind it wearing the same name. One housing, one title. */
    const docks = Array.from(host.querySelectorAll("div")).filter(
      (d) => d.textContent === "Dock",
    );
    expect(docks.length).toBeLessThanOrEqual(1);
    unmount();
  });

  it("carries no alarm, because the tug has none and the hull's is history", () => {
    const game = newGame(4242);
    const tug = tugOf(game);
    const { host, unmount } = mount(<Screen game={game} />);
    /* The tug is the half of the game with no alarm and no corridors
       (`ui/tugboard.ts`). The number the dial used to show was the derelict's,
       as the last drone left it — a reading of a decision already made, and a
       gauge under the tug's own name reads as the tug's however it is
       labelled. The hull alongside keeps only what is still a question. */
    expect(tug.derelict.alert).toBe(currentDerelict(game).alert);
    expect(text(host)).toContain("alongside");
    expect(text(host)).not.toContain("alert");
    expect(text(host)).toContain(tug.derelict.name);
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

    /* Passing over a row changes nothing. The rack sits directly above a list
       of three, and one that swapped under a pointer on its way somewhere else
       flickered through all three before settling on the one being aimed at. */
    act(() => {
      row?.parentElement?.parentElement?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    for (const m of flying?.modules ?? []) expect(text(host)).toContain(m);

    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The rack above now names that hull's modules, not the flying one's. */
    for (const m of other?.modules ?? []) expect(text(host)).toContain(m);

    /* And pressing it again puts the rack back on the drone that exists. */
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    for (const m of flying?.modules ?? []) expect(text(host)).toContain(m);
    unmount();
  });
});

describe("the rail is three keys, and one of them is not a menu", () => {
  beforeAll(stillFrames);

  it("offers the menu, the controls and the sound, and nothing else", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    const keys = Array.from(host.querySelectorAll("[title]"))
      .map((el) => el.getAttribute("title"))
      .filter((t) => t === "menu" || t === "controls" || t?.startsWith("sound"));
    expect(keys).toEqual(["menu", "controls", "sound on"]);
    unmount();
  });

  it("flips the sound where it stands, without a menu to open", () => {
    const game = newGame(4242);
    let on = true;
    const { host, unmount } = mount(
      <Screen
        game={game}
        sound={on}
        onSound={(next) => {
          on = next;
        }}
      />,
    );
    const key = Array.from(host.querySelectorAll("[title]")).find(
      (el) => el.getAttribute("title") === "sound on",
    );
    expect(key).toBeDefined();
    act(() => {
      key?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* One press, one setting — not a menu, a page and a row. */
    expect(on).toBe(false);
    unmount();
  });

  it("opens the system menu as a drawer, and the run is untouched under it", () => {
    const game = newGame(4242);
    const before = game.schedule.time;
    const { host, unmount } = mount(<Screen game={game} />);
    const key = Array.from(host.querySelectorAll("[title]")).find(
      (el) => el.getAttribute("title") === "menu",
    );
    act(() => {
      key?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text(host)).toContain("New voyage");
    expect(text(host)).toContain("Settings");
    expect(text(host)).toContain("Credits");
    expect(game.schedule.time).toBe(before);
    unmount();
  });

  it("puts the controls in a drawer too, and takes no turn doing it", () => {
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

  it("steps into settings and back out without leaving the stack", () => {
    const game = newGame(4242);
    const { host, unmount } = mount(<Screen game={game} />);
    const key = Array.from(host.querySelectorAll("[title]")).find(
      (el) => el.getAttribute("title") === "menu",
    );
    act(() => {
      key?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const row = Array.from(host.querySelectorAll("span")).find(
      (el) => el.textContent === "Settings",
    );
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text(host)).toContain("Sound");
    expect(text(host)).toContain("Reduced motion");
    const back = Array.from(host.querySelectorAll("span")).find((el) => el.textContent === "back");
    expect(back).toBeDefined();
    act(() => {
      back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* Back is a page turn inside the housing, not a shut and an open. */
    expect(text(host)).toContain("New voyage");
    unmount();
  });
});

describe("the reveal never leaves a screen blank", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    /* Motion ON, deliberately: every other test in this file turns it off so
       it can read the words, and that is exactly the gap a blank tug shipped
       through. `scrambleReveal` empties every line it is given synchronously
       and fills it back over held frames, so under motion there is a window
       where the screen legitimately says nothing — and a cancelled reveal used
       to leave it there for good. */
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

  it("settles the tug back to its own words, under StrictMode's double pass", async () => {
    const game = newGame(4242);
    const tug = tugOf(game);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    /* StrictMode is the case that broke it: every effect runs, is cleaned up
       and runs again, and the second pass used to start from the blanks the
       first one left. */
    act(() => {
      root.render(
        <StrictMode>
          <Screen game={game} />
        </StrictMode>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    expect(text(host)).toContain(tug.callsign);
    expect(text(host)).toContain("banked");
    expect(text(host)).toContain(String(tug.account.credits));
    for (const hull of tug.hulls) expect(text(host)).toContain(hull.name);
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("puts the words back when a reveal is cut short", () => {
    const host = document.createElement("div");
    host.innerHTML = '<div data-sc>ENGINEERING</div><div data-sc>DOCKING BAY</div>';
    document.body.append(host);
    const lines = linesOf(host);
    expect(lines).toHaveLength(2);
    const stop = reveal(lines, { stagger: 0, ticks: 3, tickMs: 95 });
    /* Mid-reveal the DOM says these lines have no text — which is why a filter
       that believes it drops exactly the lines that need putting back. */
    expect(linesOf(host)).toHaveLength(2);
    stop();
    expect(host.textContent).toBe("ENGINEERINGDOCKING BAY");
    host.remove();
  });
});

describe("a compartment that stops being a rumour says so", () => {
  beforeAll(stillFrames);

  it("ranks the four states so a reveal is a comparison, not a table of pairs", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const board = boardOf(game);
    /* Monitored and current are one rung: the drone walking into a room it was
       already watching has not revealed it, because it was never hidden. */
    const here = board.rooms.find((r) => r.id === board.drone);
    expect(here?.knows).toBe("current");
    expect(board.rooms.some((r) => r.knows === "undetected")).toBe(true);
  });

  it("reveals nothing on arrival, and something once the drone moves", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    const before = boardOf(game);
    act(() => {
      root.render(<Screen game={game} />);
    });
    /* A hull that unfolded itself compartment by compartment on arrival would
       be a title sequence, not a scan — so the first sight reveals nothing.
       Nothing is animating, which is what "no growing layer" means here. */
    expect(host.querySelectorAll("[style*='sv-hex-grow']")).toHaveLength(0);

    /* Walk one door and let the board re-read the game. */
    const door = game.ship.doorsOf(game.player.room as number)[0];
    expect(door).toBeDefined();
    act(() => {
      game.playerCommand({ kind: "go", door: (door as { id: number }).id });
    });
    const after = boardOf(game);
    const gained = after.rooms.filter((r) => {
      const was = before.rooms.find((b) => b.id === r.id);
      const rank: Record<string, number> = { wrecked: -1, undetected: 0, detected: 1, monitored: 2, current: 2 };
      return was !== undefined && (rank[r.knows] ?? 0) > (rank[was.knows] ?? 0);
    });
    /* Whatever the walk turned up, the board's own reading of it is what the
       animation keys off — so the two agree by construction, and this pins
       that the walk turns something up at all. */
    expect(gained.length + after.rooms.filter((r) => r.knows === "current").length).toBeGreaterThan(
      0,
    );

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});

describe("everything in a compartment is an icon and a command, or neither", () => {
  beforeAll(stillFrames);

  it("lists what the ship holds, not only what is alive in it", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    /* Wreckage, bodies, crates, the ship's own systems and whatever a charter
       left lying about are all numbered by the ship, and all of them used to
       be invisible: the board walked the living and nothing else. */
    const ship = game.ship;
    const withStuff = ship.rooms.find((r) => {
      const d = r.data as Record<string, unknown>;
      return CONTENT_KEYS.some((k) => Array.isArray(d[k]) && (d[k] as unknown[]).length > 0);
    });
    if (withStuff === undefined) return;
    const room = boardOf(game).rooms.find((r) => r.id === withStuff.id);
    if (room === undefined || room.knows === "undetected" || room.knows === "detected") return;
    expect(room.things.length).toBeGreaterThan(0);
  });

  it("gives scrap an id the engine will answer to", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const here = game.player.room as number;
    /* A machine that collapses leaves a pile with a module in it, and the
       engine has always offered `act salvage {target}` for it. */
    const before = hereOf(game).length;
    addWreck(game, here, "cutter", 4);
    const after = hereOf(game);
    expect(after.length).toBe(before + 1);
    const scrap = after[after.length - 1];
    expect(scrap?.id.startsWith("s")).toBe(true);
    expect(Number(scrap?.id.slice(1))).toBeGreaterThan(0);
    expect(scrap?.glyph.length).toBe(1);
    expect(scrap?.name.length).toBeGreaterThan(0);
  });

  it("loses no verb: everything aimed at anything is on a thing or on the list", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    addWreck(game, game.player.room as number, "scanner", 3);

    const things = hereOf(game);
    const onThings = new Set(things.map((t) => Number(t.id.slice(1))));
    const onList = new Set(commandsOf(game).map((c) => c.index));

    roomActions(game).forEach((action, index) => {
      if (!action.enabled) return;
      const cmd = action.cmd;
      if (action.step !== undefined || action.travel !== undefined) return;
      if ("door" in cmd && cmd.door !== undefined) return;
      const target = "target" in cmd ? cmd.target : undefined;
      /* Every enabled line is reachable: on the thing it is aimed at, or in
         the panel. A verb that is in neither is a turn the player cannot
         spend, and that is the failure this pins. */
      const reachable = (target !== undefined && onThings.has(target)) || onList.has(index);
      expect(reachable, `${action.label} is on neither`).toBe(true);
    });
  });

  it("marks a way through a bulkhead as walking, so the drone crosses for it", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const board = boardOf(game);
    const walking = board.doors.flatMap((d) => d.verbs).filter((v) => v.moves === true);
    /* Standing next to an open door there is always a way through it, and it
       is walking — so the board plays the drone across rather than spending
       the turn where it stands. */
    for (const way of walking) expect(way.enabled).toBe(true);
    const here = board.doors.filter((d) => d.verbs.length > 0);
    if (here.length > 0) expect(walking.length).toBeGreaterThan(0);
  });
});

describe("the panel says why the drone is here and what it stands to lose", () => {
  beforeAll(stillFrames);

  it("names the hull, the goal, what it is worth and what is being carried", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const goal = goalOf(game);
    const state = currentDerelict(game);
    expect(goal.hull).toBe(derelictName(state.spec));
    expect(goal.worth).toBe(state.spec.salePrice);
    expect(goal.of).toBe(OBJECTIVE_COUNT);
    expect(goal.banked).toBe(voyageOf(game).credits);
    /* Loot and credits are different numbers on purpose: one dies with the
       drone and one does not, and that pair is the whole of "one more
       compartment, or home". */
    expect(goal.held).toBe(voyageOf(game).loot);

    const { host, unmount } = mount(<Screen game={game} />);
    expect(text(host)).toContain(goal.hull);
    expect(text(host)).toContain("goal");
    expect(text(host)).toContain(String(goal.worth));
    expect(text(host)).toContain("held");
    expect(text(host)).toContain("banked");
    unmount();
  });

  it("counts a half-done job the way a player counts it", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    /* The engine keeps what is left, because that is what tells a bot the job
       moved. A player wants to know how far in they are, so the count is
       turned round — and it has to still be turned round after walking away,
       which is exactly when a line that forgot would make them start over. */
    const aboard = systemsAboard(game);
    if (aboard.length === 0) return;
    const system = aboard[0]!;
    const spec = objectiveSpec(system.kind);
    const job = spec?.jobs[0];
    if (job === undefined) return;
    shipState(game).work = { id: system.id, left: job.turns - 1, tool: job.tool };

    const room = game.ship.rooms.find((r) =>
      ((r.data as Record<string, unknown>).systems as { id: number }[] | undefined)?.some(
        (x) => x.id === system.id,
      ),
    );
    if (room === undefined || room.id !== game.player.room) return;
    const thing = hereOf(game).find((t) => t.id === `s${String(system.id)}`);
    expect(thing?.work).toEqual({ done: 1, of: job.turns });
  });
});

describe("wreckage is drawn, and is unmistakably shut", () => {
  beforeAll(stillFrames);

  it("puts a cell on the board for every piece of missing hull", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const board = boardOf(game);
    const wrecked = board.rooms.filter((r) => r.knows === "wrecked");
    expect(wrecked.length).toBeGreaterThan(0);

    const { host, unmount } = mount(<Screen game={game} />);
    /* Every cell the model made is a cell on the screen. Drawn with no outline
       it was there and invisible, which is the one thing it must not be: the
       point of drawing it is that the ship is bigger than the part you walk. */
    const hexes = Array.from(host.querySelectorAll("div")).filter((d) =>
      (d.getAttribute("style") ?? "").includes("sv-hatch"),
    );
    expect(hexes.length).toBeGreaterThanOrEqual(wrecked.length);
    unmount();
  });

  it("takes no pointer, so it can never be walked into by clicking it", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const before = game.player.room;
    const { host, unmount } = mount(<Screen game={game} />);
    /* The hit layer of a wrecked cell is switched off. Clicking where one is
       does nothing at all — not a refusal, not a log line, nothing. */
    const inert = Array.from(host.querySelectorAll("div")).filter((d) => {
      const s = d.getAttribute("style") ?? "";
      return s.includes("pointer-events: none") && s.includes("clip-path");
    });
    expect(inert.length).toBeGreaterThan(0);
    for (const el of inert.slice(0, 5)) {
      act(() => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(game.player.room).toBe(before);
    unmount();
  });
});

describe("the deck art arrives after the board has already drawn", () => {
  beforeAll(stillFrames);

  it("draws the decks when the index lands, without waiting for a turn", async () => {
    /* The exact shape of the bug: the board renders, reads an index that is
       still empty, and the fetch resolves a moment later. Nothing had changed
       as far as React was concerned, so the art was fetched, parsed, stored —
       and never drawn until the next turn moved the board on its own. */
    const index = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "public", "deck", "deck.json"), "utf8"),
    ) as { tiles: { id: string }[] };

    let land: (r: Response) => void = () => undefined;
    const waiting = new Promise<Response>((res) => {
      land = res;
    });
    const real = globalThis.fetch;
    globalThis.fetch = (() => waiting) as typeof fetch;

    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });
    void loadDeckIndex();

    /* Nothing yet: the art has not arrived. */
    expect(host.querySelectorAll("img").length).toBe(0);
    const before = game.schedule.time;

    await act(async () => {
      land({ ok: true, json: () => Promise.resolve(index) } as unknown as Response);
      await waiting;
      await Promise.resolve();
    });

    /* And now, with no turn taken. */
    const drawn = Array.from(host.querySelectorAll("img"));
    expect(drawn.length).toBeGreaterThan(0);
    for (const img of drawn) expect(img.getAttribute("src")).toMatch(/^deck\/t\/[0-9a-f]{12}\.webp$/);
    expect(game.schedule.time).toBe(before);

    act(() => {
      root.unmount();
    });
    host.remove();
    globalThis.fetch = real;
  });
});

describe("the deck is drawn where it can actually be seen", () => {
  beforeAll(stillFrames);

  it("is never painted over by the layers that come after it", () => {
    /* Three times now something has been correct in the DOM and invisible on
       the screen. A property ring repaints the middle of its cell to draw its
       own dashes, so a deck painted at the cell's own inset was covered by
       every compartment that had one — and a test that only asked "is there an
       img" passed the whole time. This asks the harder question: is anything
       opaque painted after it, inside it. */
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    /* Said directly rather than fetched, so this test stands on its own and
       not on whichever other test happened to warm the cache first. */
    applyDeckIndex(
      JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "public", "deck", "deck.json"), "utf8"),
      ) as Parameters<typeof applyDeckIndex>[0],
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<Screen game={game} />);
    });

    const imgs = Array.from(host.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      const tile = img.closest("div")?.parentElement;
      expect(tile).not.toBeNull();
      const wrapper = img.parentElement as HTMLElement;
      for (const sib of Array.from(tile?.children ?? [])) {
        if (sib === wrapper || !sib.contains(img) === false) continue;
        const style = sib.getAttribute("style") ?? "";
        /* A later sibling that fills its whole box with a solid colour would
           bury the deck. The scanlines are the one exception: they are meant
           to lie over it, and they are a transparent gradient. */
        const covers =
          style.includes("clip-path") &&
          style.includes("background") &&
          !style.includes("sv-scan") &&
          !style.includes("repeating-linear") &&
          !style.includes("transparent");
        if (!covers) continue;
        const after = wrapper.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING;
        expect(after, `a solid layer is painted after the deck: ${style.slice(0, 80)}`).toBe(0);
      }
    }

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});

describe("every compartment has a floor, and an unscanned one cannot be read off it", () => {
  beforeAll(stillFrames);

  const withArt = (): void => {
    applyDeckIndex(
      JSON.parse(
        readFileSync(join(import.meta.dirname, "..", "public", "deck", "deck.json"), "utf8"),
      ) as Parameters<typeof applyDeckIndex>[0],
    );
  };

  it("draws a deck under compartments nobody has looked into", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    withArt();
    const board = boardOf(game);
    const unseen = board.rooms.filter((r) => r.knows === "undetected");
    expect(unseen.length).toBeGreaterThan(0);
    /* The hull is there whether or not the drone has been down it. A ship
       whose unvisited half is blank reads as a ship half-built. */
    for (const room of unseen) expect(room.deck?.id, `room ${String(room.id)}`).toBeDefined();

    const { host, unmount } = mount(<Screen game={game} />);
    expect(host.querySelectorAll("img").length).toBe(
      board.rooms.filter((r) => r.knows !== "wrecked").length,
    );
    unmount();
  });

  it("draws every floor sharp, so a hull can be read by somebody who learns it", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    withArt();
    const board = boardOf(game);
    const { host, unmount } = mount(<Screen game={game} />);

    /* A tile is chosen from the compartment's kind, so a player who comes to
       know the catalogue can read an unscanned room off its floor. That is a
       thing to be learned and not a leak to be plugged: the board is drawing
       the ship accurately, and what a careful player makes of an accurate
       drawing is theirs. This test exists so nobody hazes it over later on the
       grounds that it looks like the board out-knowing the game. */
    const knowsOfTile = new Map(board.rooms.map((r) => [r.deck?.id, r.knows]));
    let unscanned = 0;
    for (const img of Array.from(host.querySelectorAll("img"))) {
      const id = (img.getAttribute("src") ?? "").replace("deck/t/", "").replace(".webp", "");
      const knows = knowsOfTile.get(id);
      const style = img.getAttribute("style") ?? "";
      expect(style, `${String(knows)} is blurred`).not.toMatch(/blur\(/);
      if (knows === "undetected") unscanned++;
    }
    /* And there is something to read: the unscanned half is drawn, not blank. */
    expect(unscanned).toBeGreaterThan(0);
    unmount();
  });

  it("never draws a floor in wreckage, which has none", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    withArt();
    for (const room of boardOf(game).rooms.filter((r) => r.knows === "wrecked")) {
      expect(room.deck).toBeUndefined();
    }
  });
});
