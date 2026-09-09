import { describe, it, expect } from "vitest";
import {
  KEY_HELP,
  RULE_HELP,
  TITLE_LINES,
  isChord,
  missingModuleLine,
  toIntent,
  type KeyLike,
} from "../src/ui/input.js";
import { findSlot, makeStartingRig, type Rig } from "../src/twist/rig.js";
import { HELP_BODY, HELP_BOX, TITLE_BOX, TITLE_LAST_ROW } from "../src/ui/render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/ui/theme.js";

/**
 * The key table is the whole interface: every rule in the game is reached
 * through it, and a wrong mapping is invisible until someone plays. So it is
 * asserted key by key, against a plain object rather than a DOM event.
 */

const press = (key: string, code?: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ...mods });

function rigWithout(...kinds: Array<"scanner" | "emp" | "welder" | "cell">): Rig {
  const rig = makeStartingRig();
  for (const kind of kinds) {
    const i = findSlot(rig, kind);
    if (i !== null) rig.slots[i] = null;
  }
  return rig;
}

describe("key mapping", () => {
  const rig = makeStartingRig();

  it("moves on vi keys, arrows and the numpad alike", () => {
    expect(toIntent(press("h", "KeyH"), rig)).toEqual({ kind: "command", cmd: { kind: "move", dx: -1, dy: 0 } });
    expect(toIntent(press("ArrowUp", "ArrowUp"), rig)).toEqual({ kind: "command", cmd: { kind: "move", dx: 0, dy: -1 } });
    expect(toIntent(press("y", "KeyY"), rig)).toEqual({ kind: "command", cmd: { kind: "move", dx: -1, dy: -1 } });
  });

  it("keeps the numpad moving even though the top row now picks slots", () => {
    expect(toIntent(press("1", "Numpad1"), rig)).toEqual({ kind: "command", cmd: { kind: "move", dx: -1, dy: 1 } });
    expect(toIntent(press("1", "Digit1"), rig)).toEqual({ kind: "command", cmd: { kind: "use", slot: 0 } });
  });

  it("waits on period, space and the numpad's own five", () => {
    for (const e of [press(".", "Period"), press(" ", "Space"), press("5", "Numpad5")]) {
      expect(toIntent(e, rig)).toEqual({ kind: "command", cmd: { kind: "wait" } });
    }
  });

  it("fires a module by letter, whichever slot it sits in", () => {
    const scanner = findSlot(rig, "scanner");
    expect(scanner).not.toBeNull();
    expect(toIntent(press("s", "KeyS"), rig)).toEqual({ kind: "command", cmd: { kind: "use", slot: scanner } });
  });

  it("reports a missing module instead of sending a command", () => {
    expect(toIntent(press("s", "KeyS"), rigWithout("scanner"))).toEqual({ kind: "missing", module: "scanner" });
    // The starting rack has no EMP and no welder at all.
    expect(toIntent(press("e", "KeyE"), rig)).toEqual({ kind: "missing", module: "emp" });
    expect(toIntent(press("w", "KeyW"), rig)).toEqual({ kind: "missing", module: "welder" });
    expect(missingModuleLine("scanner")).toBe("No scanner installed.");
  });

  it("does nothing with module keys before a run has a rack", () => {
    expect(toIntent(press("s", "KeyS"))).toEqual({ kind: "missing", module: "scanner" });
  });

  it("sends the raw slot for the number row, empty or not", () => {
    expect(toIntent(press("6", "Digit6"), rig)).toEqual({ kind: "command", cmd: { kind: "use", slot: 5 } });
    expect(toIntent(press("6", "Digit6"), rigWithout())).toEqual({ kind: "command", cmd: { kind: "use", slot: 5 } });
  });

  it("maps salvage, descent and the meta keys", () => {
    expect(toIntent(press("g", "KeyG"), rig)).toEqual({ kind: "command", cmd: { kind: "interact" } });
    expect(toIntent(press(">", "Comma"), rig)).toEqual({ kind: "command", cmd: { kind: "descend" } });
    expect(toIntent(press("?", "Slash"), rig)).toEqual({ kind: "help" });
    expect(toIntent(press("Escape", "Escape"), rig)).toEqual({ kind: "dismiss" });
    expect(toIntent(press("R", "KeyR"), rig)).toEqual({ kind: "restart" });
  });

  it("maps the two automation keys", () => {
    expect(toIntent(press("o", "KeyO"), rig)).toEqual({ kind: "explore" });
    expect(toIntent(press("Tab", "Tab"), rig)).toEqual({ kind: "fight" });
  });

  it("leaves the browser's own reload alone", () => {
    expect(toIntent(press("r", "KeyR", { metaKey: true }), rig)).toEqual({ kind: "none" });
    expect(toIntent(press("F5", "F5"), rig)).toEqual({ kind: "none" });
  });

  it("documents every key it accepts", () => {
    const help = [...KEY_HELP, ...RULE_HELP].join("\n");
    for (const token of ["hjkl", "g", "s", "e", "w", "p", "1-6", ">", "?", "shift+R", "o", "tab"]) {
      expect(help).toContain(token);
    }
    // The help box is drawn inside a 96-column screen; keep the lines narrow.
    for (const l of [...KEY_HELP, ...RULE_HELP]) expect(l.length).toBeLessThanOrEqual(46);
  });

  it("ignores a modifier held on its own, and every browser chord", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta"]) expect(isChord({ key: k }), k).toBe(true);
    expect(isChord({ key: "t", ctrlKey: true })).toBe(true);
    expect(isChord({ key: "r", metaKey: true })).toBe(true);
    // Shift+R is the restart key, not a chord: shift is spent on the letter.
    expect(isChord({ key: "R", code: "KeyR" })).toBe(false);
    expect(isChord({ key: "l", code: "KeyL" })).toBe(false);
    expect(isChord({ key: "?" })).toBe(false);
  });
});

/**
 * The two blocks of text the game draws in a frame. Both are written here in
 * src/ui/input.ts and laid out in src/ui/render.ts, so a line added to either
 * can quietly outgrow its box or push the last one off the bottom — which is
 * exactly the kind of thing that is only ever noticed on someone else's screen.
 */
describe("the cards fit their frames", () => {
  it("keeps the help card on the screen", () => {
    expect(HELP_BOX.width).toBeLessThanOrEqual(SCREEN_WIDTH);
    expect(HELP_BOX.height).toBeLessThanOrEqual(SCREEN_HEIGHT);
  });

  it("keeps every help line inside the frame", () => {
    for (const line of HELP_BODY) expect(line.length, line).toBeLessThanOrEqual(HELP_BOX.inner);
    expect(HELP_BODY).toEqual([...KEY_HELP, "", ...RULE_HELP]);
  });

  it("leaves the help card a row for its heading and one for its bottom edge", () => {
    // The heading is on row 1 and the body starts on row 3; the last row of the
    // frame is its edge, so the body has to end before it.
    expect(3 + HELP_BODY.length).toBeLessThanOrEqual(HELP_BOX.height - 1);
  });

  it("keeps the title card on the screen, whole", () => {
    expect(TITLE_BOX.width).toBeLessThanOrEqual(SCREEN_WIDTH);
    expect(TITLE_BOX.height).toBeLessThanOrEqual(SCREEN_HEIGHT);
    for (const line of TITLE_LINES) expect(line.length, line).toBeLessThanOrEqual(TITLE_BOX.inner);
  });

  it("has a row inside the frame for each of the six title lines", () => {
    // The lines are spread out rather than stacked, so the last of them sits
    // well below `TITLE_LINES.length` — and still above the bottom edge.
    expect(TITLE_LINES.length).toBeLessThanOrEqual(TITLE_BOX.height - 2);
    expect(TITLE_LAST_ROW).toBeLessThanOrEqual(TITLE_BOX.height - 2);
    expect(TITLE_LAST_ROW).toBeGreaterThanOrEqual(TITLE_LINES.length - 1);
  });
});
