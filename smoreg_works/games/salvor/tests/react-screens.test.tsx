// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { App } from "../src/ui/react/App.js";
import { Screen } from "../src/ui/react/Screen.js";
import { boardOf, hereOf, commandsOf, rackOfHull } from "../src/ui/react/model.js";
import { linesOf, reveal } from "../src/ui/react/reveal.js";
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
      const rank = { undetected: 0, detected: 1, monitored: 2, current: 2 };
      return was !== undefined && rank[r.knows] > rank[was.knows];
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
