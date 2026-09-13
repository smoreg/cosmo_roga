import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";

/* The palette, as `index.css` defines it. Kept here by hand rather than parsed:
   a test that reads the stylesheet passes when someone deletes the token. */
const VOID = "#0e1a2e";
const PANEL = "#0c1526";
const INK = "#d7e3f6";
const INK_TEXT = "#c7d0d0";
const DIM = "#8296b4";
const RULE = "#2b3f5e";
const DRONE = "#5fb8d9";
const SHIP = "#cf6a5a";
const NODE = "#5fbf9b";
const DOOR = "#e8c15a";

/** WCAG AA: 4.5 for body text, 3 for large text and interface furniture. */
const TEXT = 4.5;
const LARGE = 3;

describe("the palette can be read", () => {
  it("sets body text well past AA on both grounds", () => {
    expect(contrast(INK_TEXT, VOID)).toBeGreaterThan(TEXT);
    expect(contrast(INK_TEXT, PANEL)).toBeGreaterThan(TEXT);
    expect(contrast(INK, VOID)).toBeGreaterThan(TEXT);
  });

  it("keeps the quiet colour readable, which is where a dark theme usually fails", () => {
    /* `--dim` is labels, timestamps and the log's furniture — small text, so it
       owes the full 4.5 and not the large-text 3. */
    expect(contrast(DIM, VOID)).toBeGreaterThan(TEXT);
    expect(contrast(DIM, PANEL)).toBeGreaterThan(TEXT);
  });

  it("gives every role colour enough contrast to be a status, not a hint", () => {
    /* These carry meaning — whose unit, what machinery, which door — so they
       are interface furniture at minimum and owe 3. */
    for (const [name, colour] of [
      ["drone", DRONE],
      ["ship", SHIP],
      ["node", NODE],
      ["door", DOOR],
    ] as const) {
      expect(contrast(colour, VOID), `${name} on the ground`).toBeGreaterThan(LARGE);
    }
  });

  it("does not ask a rule to be read, only seen", () => {
    /* `--rule` is a one-pixel border. It is deliberately below text contrast
       and this records that as a decision rather than an oversight: nothing is
       ever written in it. */
    expect(contrast(RULE, VOID)).toBeLessThan(LARGE);
  });
});
