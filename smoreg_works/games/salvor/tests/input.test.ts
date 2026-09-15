import { describe, it, expect } from "vitest";
import { DOOR_USE, isChord, keyHelp, listHelp, missingModuleLine, toIntent, type KeyLike } from "../src/ui/input.js";

import { findSlot, makeStartingRig, type Rig } from "../src/twist/rig.js";

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

  it("aims the blade with c: a relic answers for the cutter it upgrades", () => {
    const armed = rigWithout("cutter");
    armed.slots[5] = { kind: "blade", integrity: 14 };
    expect(toIntent(press("c", "KeyC"), armed)).toEqual({ kind: "module", module: "cutter", slot: 5 });
    // And with both aboard, the cutter itself answers first, as it does everywhere.
    const both = makeStartingRig();
    both.slots[5] = { kind: "blade", integrity: 14 };
    expect(toIntent(press("c", "KeyC"), both)).toEqual({
      kind: "module",
      module: "cutter",
      slot: findSlot(both, "cutter"),
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

  it("opens the bulkheads of the compartment on d, and welds the way back on shift+D", () => {
    // The letters aim at whichever door the rules offer first, which with two
    // bulkheads in a compartment is a guess (`ui/appstate.ts`, `aimed`). `d`
    // names them one row each; `D` is the one move among them worth a key of
    // its own — shut the way you came (docs/tasks/G64-door-hotkeys.md).
    expect(toIntent(press("d", "KeyD"), rig)).toEqual({ kind: "doors" });
    expect(toIntent(press("D", "KeyD", { shiftKey: true }), rig)).toEqual({ kind: "seal" });
  });

  it("gives the two door keys to nothing else on the keyboard", () => {
    // The whole printable row, so a letter that quietly grows a second meaning
    // is caught here rather than by a player who pressed it.
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>.,?/;'[]-=";
    for (const key of letters) {
      const intent = toIntent(press(key), rig);
      expect(intent.kind === "doors", key).toBe(key === "d");
      expect(intent.kind === "seal", key).toBe(key === "D");
    }
  });

  it("has no movement keys left at all", () => {
    // The grid is gone and nothing walks in a direction. `↑`/`↓` are not
    // movement either: since G40 they move a highlight down a list of text.
    // `y` is on that rose too — north-west — which is why the keycard got `a`
    // and not the letter its own name would have asked for. `m` (G48) is no
    // exception: it opens a list of compartments, and which one is still a
    // line to press.
    for (const e of [press("j", "KeyJ"), press("y", "KeyY"), press("n", "KeyN")]) {
      expect(toIntent(e, rig), e.key).toEqual({ kind: "none" });
    }
  });

  it("gives the sideways arrows to the `i` card and to nothing else", () => {
    // They were dead with the grid, and they are not a second way to move the
    // highlight: `page` only does anything with a card in front of the board
    // (`ui/appstate.ts`, G72), so nothing about the list changed.
    expect(toIntent(press("ArrowLeft", "ArrowLeft"), rig)).toEqual({ kind: "page", delta: -1 });
    expect(toIntent(press("ArrowRight", "ArrowRight"), rig)).toEqual({ kind: "page", delta: 1 });
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

  it("reads PageUp and PageDown as the log's own past, in both directions", () => {
    expect(toIntent(press("PageUp", "PageUp"))).toEqual({ kind: "history", delta: 1 });
    expect(toIntent(press("PageDown", "PageDown"))).toEqual({ kind: "history", delta: -1 });
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

  /** `PageUp` had no line on the card until it had a meaning (G79). */
  it("says which key opens the log's own past", () => {
    {
      expect(keyHelp().join("\n")).toContain("PgUp");
      expect(keyHelp().join("\n")).toContain("PgDn");
    }
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
});
