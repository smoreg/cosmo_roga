import { describe, it, expect } from "vitest";
import {
  DOOR_USE,
  charterHelp,
  HELP_ROWS,
  helpFooter,
  helpHeadings,
  helpPages,
  isChord,
  keyHelp,
  listHelp,
  missingModuleLine,
  ruleHelp,
  shipHelp,
  titleLines,
  tugHelp,
  toIntent,
  type KeyLike,
} from "../src/ui/input.js";
import { findSlot, makeStartingRig, type Rig } from "../src/twist/rig.js";
import { TITLE_LAST_ROW, helpBody, helpBox, titleBox } from "../src/ui/render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/ui/theme.js";

/**
 * The key table is the whole interface: every rule in the game is reached
 * through it, and a wrong mapping is invisible until someone plays. So it is
 * asserted key by key, against a plain object rather than a DOM event.
 *
 * What changed with v3 is what is *not* here. There is no movement key: the
 * grid is gone, and with it `hjkl` and the arrows — the numpad survives only
 * because its digits are the same digits the list uses. `k` doing nothing is a
 * test rather than an accident: a roguelike player will press it, and pressing
 * it must not open a bulkhead by surprise (design-doc.md, "Клавиши").
 */

const press = (key: string, code?: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ...mods });

function rigWithout(...kinds: Array<"scanner" | "cell" | "cutter">): Rig {
  const rig = makeStartingRig();
  for (const kind of kinds) {
    const i = findSlot(rig, kind);
    if (i !== null) rig.slots[i] = null;
  }
  return rig;
}

describe("key mapping", () => {
  const rig = makeStartingRig();

  it("picks a line of the list with the top row, nine and then zero", () => {
    expect(toIntent(press("1", "Digit1"), rig)).toEqual({ kind: "pick", index: 0 });
    expect(toIntent(press("9", "Digit9"), rig)).toEqual({ kind: "pick", index: 8 });
    expect(toIntent(press("0", "Digit0"), rig)).toEqual({ kind: "pick", index: 9 });
  });

  it("braces on period and space, and hides on h", () => {
    for (const e of [press(".", "Period"), press(" ", "Space")]) {
      expect(toIntent(e, rig), e.key).toEqual({ kind: "command", cmd: { kind: "wait" } });
    }
    expect(toIntent(press("h", "KeyH"), rig)).toEqual({ kind: "command", cmd: { kind: "hide" } });
  });

  it("makes < one key for getting out, wherever the drone is standing", () => {
    // At the airlock it casts off; anywhere else it walks there and stops at
    // the first thing worth a decision (G48). The reducer decides which, since
    // only it can see where the drone is — the key table names the intention.
    expect(toIntent(press("<", "Comma", { shiftKey: true }), rig)).toEqual({ kind: "exit" });
  });

  it("fires a module by letter, whichever slot it sits in", () => {
    const scanner = findSlot(rig, "scanner");
    expect(scanner).not.toBeNull();
    expect(toIntent(press("s", "KeyS"), rig)).toEqual({ kind: "module", module: "scanner", slot: scanner });
    expect(toIntent(press("p", "KeyP"), rig)).toEqual({ kind: "module", module: "cell", slot: findSlot(rig, "cell") });
    expect(toIntent(press("c", "KeyC"), rig)).toEqual({
      kind: "module",
      module: "cutter",
      slot: findSlot(rig, "cutter"),
    });
  });

  it("puts SPIKE on shift and leaves the bare k dead", () => {
    // `k` is a roguelike player's north. This game has no north, and a key that
    // used to move must not now breach a lock.
    expect(toIntent(press("K", "KeyK", { shiftKey: true }), rig)).toEqual({ kind: "missing", module: "spike" });
    expect(toIntent(press("k", "KeyK"), rig)).toEqual({ kind: "none" });
  });

  it("reports a missing module instead of sending a command", () => {
    expect(toIntent(press("s", "KeyS"), rigWithout("scanner"))).toEqual({ kind: "missing", module: "scanner" });
    // The starting rack has no EMP, no welder and no emitter at all.
    expect(toIntent(press("e", "KeyE"), rig)).toEqual({ kind: "missing", module: "emp" });
    expect(toIntent(press("w", "KeyW"), rig)).toEqual({ kind: "missing", module: "welder" });
    expect(toIntent(press("f", "KeyF"), rig)).toEqual({ kind: "missing", module: "emitter" });
    expect(missingModuleLine("scanner")).toBe("No scanner installed.");
  });

  it("does nothing with module keys before a run has a rack", () => {
    expect(toIntent(press("s", "KeyS"))).toEqual({ kind: "missing", module: "scanner" });
  });

  it("closes in on tab, and stays in melee on shift+tab", () => {
    expect(toIntent(press("Tab", "Tab"), rig)).toEqual({ kind: "fight", melee: false });
    expect(toIntent(press("Tab", "Tab", { shiftKey: true }), rig)).toEqual({ kind: "fight", melee: true });
  });

  it("gives the keycard a letter, because it is not a module and cannot borrow one", () => {
    // Every other way through a lock is a module and rides `MODULE_KEYS`. The
    // card is not, it is offered last of the four (`systems/doors.ts`,
    // `LOCKED_METHODS`), and a way with neither a number nor a letter is one
    // the player does not have.
    expect(toIntent(press("a", "KeyA"), rig)).toEqual({ kind: "keycard" });
  });

  it("maps the automation and the meta keys", () => {
    expect(toIntent(press("o", "KeyO"), rig)).toEqual({ kind: "explore" });
    expect(toIntent(press("?", "Slash"), rig)).toEqual({ kind: "help" });
    expect(toIntent(press("Escape", "Escape"), rig)).toEqual({ kind: "dismiss" });
    expect(toIntent(press("R", "KeyR"), rig)).toEqual({ kind: "restart" });
  });

  it("opens the map of the ship on m, and leaves the shifted one dead", () => {
    // Walking is the commonest thing there is and had no key of its own: the
    // number that walks sat among the salvage and moved every turn (G48). `m`
    // is not a direction — there are none on a graph — it lists the
    // compartments to walk to, so one press opens it and the next puts it back.
    expect(toIntent(press("m", "KeyM"), rig)).toEqual({ kind: "moves" });
    expect(toIntent(press("M", "KeyM", { shiftKey: true }), rig)).toEqual({ kind: "none" });
  });

  it("has no movement keys left at all", () => {
    // The grid is gone and nothing walks in a direction. `↑`/`↓` are not
    // movement either: since G40 they move a highlight down a list of text,
    // which is why the two sideways arrows stay as dead as `hjkl`. `y` is on
    // that rose too — north-west — which is why the keycard got `a` and not
    // the letter its own name would have asked for. `m` (G48) is no exception:
    // it opens a list of compartments, and which one is still a line to press.
    for (const e of [
      press("ArrowLeft", "ArrowLeft"),
      press("ArrowRight", "ArrowRight"),
      press("j", "KeyJ"),
      press("y", "KeyY"),
      press("n", "KeyN"),
    ]) {
      expect(toIntent(e, rig), e.key).toEqual({ kind: "none" });
    }
  });

  it("gives both cases of l to the language ring, on every screen there is", () => {
    // `l` was north-east on a grid this game does not have; it is the one key
    // that has to work on the title and on the error card as well
    // (`docs/tasks/G39-i18n.md`).
    expect(toIntent(press("l", "KeyL"), rig)).toEqual({ kind: "language" });
    expect(toIntent(press("L", "KeyL", { shiftKey: true }), rig)).toEqual({ kind: "language" });
  });

  it("gives the arrows and enter to the list, and nothing else", () => {
    expect(toIntent(press("ArrowUp", "ArrowUp"), rig)).toEqual({ kind: "cursor", delta: -1 });
    expect(toIntent(press("ArrowDown", "ArrowDown"), rig)).toEqual({ kind: "cursor", delta: 1 });
    expect(toIntent(press("Enter", "Enter"), rig)).toEqual({ kind: "confirm" });
  });

  it("lets the numpad pick lines, since it no longer moves anything", () => {
    expect(toIntent(press("5", "Numpad5"), rig)).toEqual({ kind: "pick", index: 4 });
  });

  it("leaves the browser's own reload alone", () => {
    expect(toIntent(press("r", "KeyR", { metaKey: true }), rig)).toEqual({ kind: "none" });
    expect(toIntent(press("F5", "F5"), rig)).toEqual({ kind: "none" });
  });

  it("names a door verb for every module that opens one", () => {
    // The letters printed under a bulkhead have to reach a command, and this
    // map is the only thing that says which (see `appReducer`).
    expect(DOOR_USE).toEqual({ cell: "power", spike: "spike", cutter: "cut", welder: "weld" });
  });

  it("documents every key it accepts", () => {
    const help = [...keyHelp(), ...ruleHelp()].join("\n");
    const keys = ["1-9", "0", ".", "h", "m", "<", "o", "tab", "s", "e", "w", "p", "K", "f", "c", "?", "shift+R"];
    for (const token of [...keys, "up/down", "enter", "L"]) {
      expect(help, token).toContain(token);
    }
    // Every line of the card, keys and prose alike, inside one column: the
    // frame is drawn to the longest of them (`boxFor`), and a card much wider
    // than half the screen stops reading as a card.
    for (const onTug of [true, false]) {
      for (const l of helpBody(onTug)) expect(l.length, l).toBeLessThanOrEqual(54);
    }
  });

  it("ignores a modifier held on its own, and every browser chord", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta"]) expect(isChord({ key: k }), k).toBe(true);
    expect(isChord({ key: "t", ctrlKey: true })).toBe(true);
    expect(isChord({ key: "r", metaKey: true })).toBe(true);
    // Shift+R is the restart key and shift+tab is melee: shift is spent on the
    // key, not held before it.
    expect(isChord({ key: "R", code: "KeyR", shiftKey: true })).toBe(false);
    expect(isChord({ key: "Tab", code: "Tab", shiftKey: true })).toBe(false);
    expect(isChord({ key: "?" })).toBe(false);
  });
});

/**
 * The two blocks of text the game draws in a frame. Both are written in
 * src/ui/input.ts and laid out in src/ui/render.ts, so a line added to either
 * can quietly outgrow its box or push the last one off the bottom — which is
 * exactly the kind of thing that is only ever noticed on someone else's screen.
 */
describe("the cards fit their frames", () => {
  it("keeps the help card on the screen, wherever it is opened", () => {
    for (const onTug of [true, false]) {
      expect(helpBox(onTug).width, `tug ${onTug}`).toBeLessThanOrEqual(SCREEN_WIDTH);
      expect(helpBox(onTug).height, `tug ${onTug}`).toBeLessThanOrEqual(SCREEN_HEIGHT);
    }
  });

  it("keeps every help line inside the frame", () => {
    for (const onTug of [true, false]) {
      for (const line of helpBody(onTug)) {
        expect(line.length, line).toBeLessThanOrEqual(helpBox(onTug).inner);
      }
    }
    expect(helpBody(true)).toEqual([
      ...tugHelp(),
      "",
      ...keyHelp(),
      "",
      ...ruleHelp(),
      "",
      ...listHelp(),
      "",
      ...charterHelp(),
    ]);
    expect(helpBody(false).slice(0, shipHelp().length)).toEqual(shipHelp());
    expect(helpBody(false).slice(shipHelp().length)).toEqual(helpBody(true).slice(tugHelp().length));
  });

  /**
   * The question `?` is pressed to ask, answered before anything else on the
   * card and answered differently in the two places a player can be lost
   * (docs/tasks/G40-tug-clarity.md, 6).
   */
  it("leads with where you are standing, and says something different in each", () => {
    expect(helpBody(true)[0]).toBe(tugHelp()[0]);
    expect(helpBody(false)[0]).toBe(shipHelp()[0]);

    // The tug's paragraph names what it does, not the compartments it used to
    // be spread over: since G53 there are no compartments to name (DOCK, HOLD,
    // BENCH, HELM are gone from the screen and from this card with them).
    const tug = helpBody(true).slice(0, tugHelp().length).join(" ");
    expect(tug).toContain("tug");
    for (const verb of ["buy", "stow", "sell", "charter", "cast off"]) expect(tug, verb).toContain(verb);
    for (const station of ["DOCK", "HOLD", "BENCH", "HELM"]) expect(tug, station).not.toContain(station);

    const ship = helpBody(false).slice(0, shipHelp().length).join(" ");
    expect(ship).toContain("derelict");
    expect(ship).toContain("airlock");
    // The tug's own paragraph must not be the one a player reads aboard a hull.
    expect(ship).not.toContain("stow");
  });

  /**
   * One page, four blocks: the keys, the rule the twist is, what the numbered
   * list is, and what a charter is (`docs/tasks/G32-onboarding-v2.md`, 4). A
   * voter presses `?` once and closes it again — anything the card does not
   * answer in that one screen it does not answer at all.
   */
  it("answers the three questions the screen cannot", () => {
    const card = helpBody(false).join("\n");
    expect(card).toContain("EXPOSED");
    expect(card).toContain("◀");
    expect(card).toContain("ACTIONS");
    expect(card).toContain("CHARTERS");
    expect(card).toContain("SALVAGE");
    expect(card).toContain("NEUTRALIZE");
    // Each block leads with the heading the renderer sets in the bright colour.
    for (const heading of helpHeadings()) {
      expect([...helpBody(true), ...helpBody(false)]).toContain(heading);
    }
    expect(helpHeadings()).toEqual([
      tugHelp()[0],
      shipHelp()[0],
      ruleHelp()[0],
      listHelp()[0],
      charterHelp()[0],
    ]);
  });

  /**
   * The card describes the screen the player is looking at, or it is worse than
   * no card. Until G46 it promised letters under a door; the ways through a
   * bulkhead are that bulkhead's own list now, and `0` is the way out of it.
   */
  it("says how a locked door is opened now that its ways are a list of their own", () => {
    const list = listHelp().join("\n");
    expect(list).toContain("0");
    expect(list.toLowerCase()).not.toContain("letters under");
  });

  it("leaves every page a row for its heading, its footer and its bottom edge", () => {
    for (const onTug of [true, false]) {
      for (const page of helpPages(onTug)) {
        expect(3 + page.length, `tug ${onTug}`).toBeLessThanOrEqual(helpBox(onTug).height - 3);
      }
    }
  });

  /**
   * The card used to be exactly as tall as the screen, so every key the game
   * gained was a choice between its own line and somebody else's — G48 spent
   * that choice once, folding two rows together to fit `m` in. Pages end the
   * arithmetic: the rule is a per-page ceiling with air over it, and a card
   * that outgrows one page grows another instead of losing a line.
   */
  it("pages the card rather than filling the screen with it", () => {
    for (const onTug of [true, false]) {
      const pages = helpPages(onTug);
      expect(pages.length, `tug ${onTug}`).toBeGreaterThan(0);
      expect(helpBox(onTug).height, `tug ${onTug}`).toBeLessThanOrEqual(SCREEN_HEIGHT - 4);
      for (const page of pages) {
        expect(page.length, `tug ${onTug}`).toBeLessThanOrEqual(HELP_ROWS);
        // No page opens on a blank row: the cut is between blocks, never inside
        // one, so a heading never ends up on the page before its own lines.
        expect(page[0], `tug ${onTug}`).not.toBe("");
        expect(helpHeadings(), `tug ${onTug}`).toContain(page[0]);
      }
      // Every line of the card is on exactly one page, in the order it was in.
      expect(pages.flat().filter((l) => l !== "")).toEqual(helpBody(onTug).filter((l) => l !== ""));
    }
  });

  it("says on every page which one it is and what the next ? will do", () => {
    const pages = helpPages(false).length;
    expect(helpFooter(0, pages)).toContain(`1/${pages}`);
    expect(helpFooter(pages - 1, pages)).toContain(`${pages}/${pages}`);
    // The last page says the key closes; the others say it turns the page.
    expect(helpFooter(0, pages)).not.toBe(helpFooter(pages - 1, pages));
    for (let i = 0; i < pages; i++) {
      expect(helpFooter(i, pages).length, helpFooter(i, pages)).toBeLessThanOrEqual(helpBox(false).inner);
    }
  });

  it("keeps the title card on the screen, whole", () => {
    expect(titleBox().width).toBeLessThanOrEqual(SCREEN_WIDTH);
    expect(titleBox().height).toBeLessThanOrEqual(SCREEN_HEIGHT);
    for (const line of titleLines()) expect(line.length, line).toBeLessThanOrEqual(titleBox().inner);
  });

  it("has a row inside the frame for each of the six title lines", () => {
    expect(titleLines()).toHaveLength(6);
    expect(titleLines().length).toBeLessThanOrEqual(titleBox().height - 2);
    expect(TITLE_LAST_ROW).toBeLessThanOrEqual(titleBox().height - 2);
    expect(TITLE_LAST_ROW).toBeGreaterThanOrEqual(titleLines().length - 1);
  });

  it("says what the game is on the title, in the doc's own words", () => {
    const pitch = titleLines().join(" ");
    expect(pitch).toContain("modules");
    // The title is a menu of three and an "any key" behind it. It is the one
    // screen a player meets before they can read anything, so the three lines
    // have to be numbered and the keys that are *not* a choice — the language
    // and the view — must not read as ones that also start the run.
    expect(pitch).toContain("1 NEW VOYAGE");
    expect(pitch).toContain("2 TRAINING");
    expect(pitch).toContain("3 HELP");
    expect(pitch).toContain("any other key casts off");
    expect(pitch).toContain("L language");
    // The three lines of design-doc.md's "Питч": a tug, a drone with no hit
    // points, and the loop that follows from it — the hit that burns what you
    // used, and buying the next drone.
    expect(pitch).toContain("tug");
    expect(pitch).toContain("no hit points");
    expect(pitch).toContain("burns what you just used");
    expect(pitch).toContain("Buy the next one");
    // And the help is one of the three, so nobody has to press `?` to find `?`.
  });
});
