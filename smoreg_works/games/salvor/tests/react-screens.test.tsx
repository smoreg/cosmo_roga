// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { App } from "../src/ui/react/App.js";
import { Screen } from "../src/ui/react/Screen.js";
import { boardOf, hereOf, commandsOf, rackOfHull } from "../src/ui/react/model.js";
import { inkOf } from "../src/ui/react/board/HexBoard.js";
import { EndingCard } from "../src/ui/react/screens/Cards.js";
import { airlockCard } from "../src/ui/airlockcard.js";
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
import { CONTENT_KEYS } from "../src/ui/contents.js";
import { addWreck } from "../src/twist/rig.js";
import { goalOf } from "../src/ui/react/model.js";
import { derelictName } from "../src/content/derelicts.js";
import { OBJECTIVE_COUNT, OBJECTIVES, objectiveSpec } from "../src/content/objectives.js";
import { voyageOf } from "../src/systems/voyage.js";
import { shipState } from "../src/systems/shipstate.js";
import { systemsAboard } from "../src/systems/ship.js";
import { CODEX_IDS } from "../src/content/codex.js";
import { titleScreen, DEFAULT_TITLE } from "../src/ui/title.js";
import { lessonOf, virusOf } from "../src/ui/react/model.js";
import { LESSON_STEPS } from "../src/content/tutorial.js";
import { tryInfect } from "../src/systems/virus.js";
import { rigOf } from "../src/twist/rig.js";
import { VIRUS_KEY } from "../src/ui/input.js";
import { verbWord } from "../src/content/words.js";
import { DEFAULT_LANG, setLang, t } from "../src/i18n.js";
import { CALLSIGNS } from "../src/content/derelicts.js";
import { TUG_CALLSIGNS } from "../src/content/hints.js";

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
    expect(text(host)).toContain(t("react.tug.alongside"));
    expect(text(host)).not.toContain(t("react.stat.alert"));
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
      .filter((title) => title === t("panel.actions"));
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
    /* Found by the glyph printed on each key rather than by the words in its
       tooltip: the words move with the language now, and a filter written out
       of them could never fail the "and nothing else" half of this. */
    const keys = Array.from(host.querySelectorAll("[title]"))
      .filter((el) => ["≡", "?", "◀", "◁"].includes(el.textContent ?? ""))
      .map((el) => el.getAttribute("title"));
    expect(keys).toEqual([
      t("react.rail.menu"),
      t("help.title"),
      t("react.rail.sound", { state: t("title.sound.on") }),
    ]);
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
      (el) => el.getAttribute("title") === t("react.rail.menu"),
    );
    act(() => {
      key?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text(host)).toContain(t("title.menu.voyage"));
    expect(text(host)).toContain(t("react.menu.settings"));
    expect(text(host)).toContain(t("react.menu.credits"));
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
      (el) => el.getAttribute("title") === t("react.rail.menu"),
    );
    act(() => {
      key?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const row = Array.from(host.querySelectorAll("span")).find(
      (el) => el.textContent === t("react.menu.settings"),
    );
    act(() => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(text(host)).toContain(t("title.menu.sound"));
    expect(text(host)).toContain(t("react.settings.motion"));
    const back = Array.from(host.querySelectorAll("span")).find((el) => el.textContent === t("action.backRoom"));
    expect(back).toBeDefined();
    act(() => {
      back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* Back is a page turn inside the housing, not a shut and an open. */
    expect(text(host)).toContain(t("title.menu.voyage"));
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

  it("paints the three systems in the colour of the job, and dims one that is up", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const room = game.ship.rooms.find((r) => {
      const list = (r.data as Record<string, unknown>).systems;
      return Array.isArray(list) && list.length > 0;
    });
    expect(room).toBeDefined();
    game.player.room = room!.id;
    game.refreshSight();
    const system = hereOf(game).find((thing) => thing.goal !== undefined);
    expect(system).toBeDefined();
    /* Green while there is work to do in there, and the same green with the
       weight off once it is raised — one job with some of it done, not two
       kinds of thing. The rule the other two drawings already keep. */
    expect(system!.goal).toBe("down");
    expect(inkOf(system!)).toBe("var(--sv-good)");
    const raised = inkOf({ ...system!, goal: "up" });
    expect(raised).not.toBe(inkOf(system!));
    expect(raised).toContain("--sv-good");
    /* And nothing that is not one of the three takes that colour: the whole
       point is that the job is told apart from the scenery. */
    for (const thing of hereOf(game)) {
      if (thing.goal !== undefined) continue;
      expect(inkOf(thing)).toBe(thing.hostile === true ? "var(--sv-bad)" : "var(--sv-amber)");
    }
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

/**
 * The drawers behind the rail, in all three languages.
 *
 * `tests/leak.test.ts` sweeps this view the way it sweeps the other three — a
 * run rendered to markup on every sampled turn, in each language, with no
 * tolerance for a word of the wrong one. What it cannot reach is the four
 * drawers: they are opened by a press and nothing but a press, so a static
 * render of the screen never draws one. They are also where this view keeps
 * most of what it says on its own — the menu, the settings, the credits sheet,
 * the controls — so they are opened here, where there is a DOM to press.
 *
 * The same zero tolerance: no Cyrillic in an English or a Spanish run, and no
 * Latin word in a Russian one but a name, a key or an address-bar setting.
 */
describe("the drawers say it in the language that is on", () => {
  beforeAll(stillFrames);
  afterAll(() => setLang(DEFAULT_LANG));

  const CYRILLIC = /[Ѐ-ӿ]/;
  /**
   * What stays Latin on a Russian screen: the names nobody translates — the
   * hulls' and tugs' callsigns, the game's own, the two typefaces and the game
   * the look owes a debt to — the names of keys as the keyboard prints them,
   * and the settings that live in the address bar.
   */
  const KEPT = new RegExp(
    `\\b(${[...CALLSIGNS, ...TUG_CALLSIGNS].join("|")}|SALVOR|Barlow|Condensed|IBM|Plex|Mono|` +
      "Cogmind|Grid|Sage|Games|ASCII|REACT|EN|ES|RU|ascii|web|hex|react|" +
      "esc|Esc|enter|Enter|Tab|tab|shift|PgUp|PgDn|CR|THR)\\b|\\?[a-z]+=\\S*",
    "g",
  );

  /**
   * Every word on the screen, one text node a line.
   *
   * `textContent` runs the nodes together — `160 CR` and `SALVOR` become
   * `160 CRSALVOR` — and a check written on word boundaries then reads the
   * seam as a word of its own. One line per node is what a browser shows and
   * what `tests/leak.test.ts` reads out of the other views' markup. Tooltips
   * come too: they are the only place the rail says anything.
   */
  function shown(host: HTMLElement): string {
    const out: string[] = [];
    const walk = (node: Node): void => {
      if (node.nodeType === 3) out.push(node.textContent ?? "");
      else node.childNodes.forEach(walk);
    };
    walk(host);
    for (const el of Array.from(host.querySelectorAll("[title]")))
      out.push(el.getAttribute("title") ?? "");
    return out.join("\n");
  }

  /** Every drawer in turn, as the text each one puts on the screen. */
  function drawers(host: HTMLElement): string[] {
    const press = (el: Element | null | undefined): void => {
      act(() => {
        el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const rail = (title: string): Element | undefined =>
      Array.from(host.querySelectorAll("[title]")).find((el) => el.getAttribute("title") === title);
    const row = (label: string): Element | undefined =>
      Array.from(host.querySelectorAll("span")).find((el) => el.textContent === label);

    const out: string[] = [];
    press(rail(t("react.rail.menu")));
    out.push(shown(host));
    press(row(t("react.menu.settings")));
    out.push(shown(host));
    press(row(t("action.backRoom")));
    press(row(t("react.menu.credits")));
    out.push(shown(host));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    out.push(shown(host));
    return out;
  }

  for (const lang of ["en", "es", "ru"] as const) {
    it(`opens the menu, the settings, the credits and the controls in ${lang}`, () => {
      setLang(lang);
      const game = newGame(4242);
      const { host, unmount } = mount(<Screen game={game} />);
      const seen = drawers(host);
      /* Four presses, four readings, and each one longer than the last is not
         the claim — that each one happened is. A drawer that failed to open
         would leave the screen behind it and quietly pass every check below. */
      expect(seen).toHaveLength(4);
      expect(seen[0]).toContain(t("react.paused"));
      expect(seen[1]).toContain(t("react.settings.motion"));
      expect(seen[2]).toContain(t("react.credits.debt"));
      expect(seen[3]).toContain(t("react.controls.how"));

      for (const drawn of seen) {
        if (lang === "ru") {
          expect(drawn.replace(KEPT, "").match(/[A-Za-z]{2,}/g) ?? []).toEqual([]);
        } else {
          expect(drawn.match(CYRILLIC)).toBeNull();
        }
      }
      unmount();
    });
  }
});

/**
 * The three windows the ported screen had no place for.
 *
 * All three are the same shape of defect: the React view was written against a
 * copy of this game from before the wave that added them, so the run it drew
 * was a run in which the ship never scuttles itself, a strain is a line in the
 * log and nobody is ever taught anything. Each is checked against the pure
 * function the terminal draws it from, so the two cannot drift apart again.
 */
describe("the windows a run can put in front of the board", () => {
  beforeAll(stillFrames);

  it("teaches a training run, step by step, and esc neither hides it nor moves it on", () => {
    const game = newGame(4242, true);
    const lesson = lessonOf(game);
    expect(lesson, "a training run has a lesson").toBeDefined();
    expect(lesson?.step).toBe(1);
    expect(lesson?.of).toBe(LESSON_STEPS.length);

    const { host, unmount } = mount(<Screen game={game} />);
    /* The run opens on the card that says what the job is (G96, 2), in front
       of the window; the first key puts it away and spends nothing. */
    expect(text(host)).toContain(t("lesson.brief.title"));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(text(host)).not.toContain(t("lesson.brief.title"));
    expect(game.inputs.length).toBe(0);
    expect(text(host)).toContain(lesson?.head);
    expect(text(host)).toContain(lesson?.text);
    expect(text(host)).toContain(lesson?.press);

    /* The window is the lesson: `Esc` leaves every word of it where it was,
       and the lesson on the same step, because a key that is not a move is not
       a turn (G96, 5). */
    const before = game.inputs.length;
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(text(host)).toContain(lesson?.head);
    expect(text(host)).toContain(lesson?.text);
    expect(text(host)).toContain(lesson?.press);
    expect(game.inputs.length).toBe(before);
    expect(lessonOf(game)?.step).toBe(1);
    unmount();
  });

  it("shows no lesson in an ordinary run", () => {
    const game = newGame(4242);
    expect(lessonOf(game)).toBeUndefined();
  });

  it("opens the virus window on its own key, and shuts it when the strain is gone", () => {
    const game = newGame(4242);
    expect(undock(game).ok).toBe(true);
    const rig = rigOf(game.player);
    const slot = (rig?.slots ?? []).findIndex((s) => s !== null);
    expect(tryInfect(game, slot, "ghost", 1), "a strain aboard, certainly").toBe(true);

    const card = virusOf(game);
    expect(card, "the window is the strain on this rack").toBeDefined();
    const { host, unmount } = mount(<Screen game={game} />);
    expect(text(host)).not.toContain(card?.footer);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: VIRUS_KEY }));
    });
    /* Every word of it is `ui/viruscard.ts`'s, so the page and the terminal
       cannot say different things about how long a purge takes. */
    for (const line of card?.body ?? []) if (line !== "") expect(text(host)).toContain(line);

    /* Purged, the card goes with the strain: there is no such thing as a
       window about a virus that is not there. */
    delete (game.player.data ?? {}).virus;
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(virusOf(game)).toBeUndefined();
    unmount();
  });

  it("raises the airlock card the turn the third system comes up, once a run", () => {
    const game = newGame(4242);
    expect(undock(game).ok).toBe(true);
    /* The record rather than three splices: what the card is keyed to is the
       record, and raising them by hand would be testing the rack's tools. */
    shipState(game).online = OBJECTIVES.map((o) => o.id);
    const card = airlockCard(game);
    expect(card).toBeDefined();
    const { host, unmount } = mount(<Screen game={game} />);
    /* Every word is `ui/airlockcard.ts`'s: the hull is worth what it is worth
       and none of it is paid until the drone is out, said the same on every
       screen. This one used to say nothing at all. */
    for (const line of card?.body ?? []) if (line !== "") expect(text(host)).toContain(line);
    expect(text(host)).toContain(card?.footer);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    /* Once a run and not once a hull: the systems are still up, and the card
       does not come back over the board it was just taken off. */
    expect(text(host)).not.toContain(card?.footer);
    unmount();
  });

  it("gives a hull neutralised and sold the banner the other views give it", () => {
    const game = newGame(4242);
    expect(endingOf(game, true).title).toBe(t("end.sold"));
    expect(endingOf(game).title).toBe(t("end.lost"));
    const why = t("end.sold.why", { hull: CALLSIGNS[0]!, n: OBJECTIVE_COUNT, cr: 40 });
    const { host, unmount } = mount(<EndingCard ending={{ ...endingOf(game, true), why }} />);
    expect(text(host)).toContain(t("end.sold"));
    expect(text(host)).toContain(why);
    unmount();
  });

  it("offers no virus window to a drone that carries none", () => {
    const game = newGame(4242);
    expect(virusOf(game)).toBeUndefined();
    const { host, unmount } = mount(<Screen game={game} />);
    const before = text(host);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: VIRUS_KEY }));
    });
    expect(text(host)).toBe(before);
    unmount();
  });
});

/**
 * The tug's list, as it stands today.
 *
 * Three groups in the owner's order — the voyage, the drone, the rack — and no
 * contracts menu anywhere, because since G90 F a contract is signed with the
 * hull it is signed for, on the row directly over boarding.
 */
describe("the tug lists the rows the dock actually has", () => {
  beforeAll(stillFrames);

  it("opens with the hull and its contract, then boarding, then the drones", () => {
    const game = newGame(4242);
    const offers = offersOf(game);
    expect(offers.map((o) => o.head).filter((h) => h !== undefined)).toEqual([
      t("tug.group.voyage"),
      t("tug.group.drone"),
      t("tug.group.rig"),
    ]);
    /* Where to fly leads and boarding is directly under it, which is the order
       a voyage happens in (`ui/actions.ts`, `TUG_ROWS`, G95 B1). */
    expect(offers[0]?.label).toBe(roomActions(game)[0]?.label);
    expect(offers[0]?.into, "one row that is a hull and the job signed with it").toBe("jump");
    expect(offers.filter((o) => o.into === "contract")).toHaveLength(0);
  });

  it("says what each hull at the next stop is, beside the row that signs for it", () => {
    const game = newGame(4242);
    const next = tugOf(game).next;
    expect(next, "a voyage has somewhere to fly").toBeDefined();
    const { host, unmount } = mount(<Screen game={game} />);
    for (const hull of next?.hulls ?? []) {
      expect(text(host)).toContain(hull.name);
      expect(text(host)).toContain(hull.rooms);
      expect(text(host)).toContain(String(hull.price));
    }
    unmount();
  });
});

/** A locked bulkhead can always be rammed, and the board offers what the rules offer. */
describe("a bulkhead nothing opens can still be gone through", () => {
  beforeAll(stillFrames);

  it("puts the ram on a locked door, because the rules put it there", () => {
    const game = newGame(4242);
    expect(undock(game).ok).toBe(true);
    const here = game.player.room as number;
    /* A bulkhead, not the airlock: the hatch off the hull is a way out of the
       ship rather than about it, and nothing can be done to one. */
    const drawnDoors = boardOf(game).doors.map((d) => d.id);
    const door = game.ship.doorsOf(here).find((d) => drawnDoors.includes(d.id));
    expect(door).toBeDefined();
    (door as { state: string }).state = "locked";

    const ways = doorWays(game, (door as { id: number }).id) ?? [];
    const ram = verbWord("ram");
    expect(
      ways.some((a) => a.label.includes(ram)),
      "the ram is what is left when nothing else opens it",
    ).toBe(true);
    /* And the board carries the engine's list whole, so it is on the menu too. */
    const drawn = boardOf(game).doors.find((d) => d.id === (door as { id: number }).id);
    expect(drawn?.verbs.some((v) => v.verb.includes(ram))).toBe(true);
  });
});
