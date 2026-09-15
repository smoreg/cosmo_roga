import { describe, expect, it } from "vitest";
import { MODULES, moduleName } from "../src/content/modules.js";
import type { ModuleId } from "../src/content/modules.js";
import { DERELICTS, derelictName } from "../src/content/derelicts.js";
import { t } from "../src/i18n.js";

/**
 * The fourth view is not a character grid, so a long word wraps rather than
 * clipping — except in the few places the design nails a box to a number.
 *
 * Those are the ones worth a test. Everything else in `src/ui/react` is a flex
 * row of text with no fixed height and no `nowrap` over a sentence: a Russian
 * word that does not fit takes a second line inside its housing, which is
 * ugly at worst. A fixed column is different — the text runs out of the box
 * and over whatever is beside it, and nothing says so.
 *
 * The widths are arithmetic and not measured: this repo does not open a
 * browser (.claude/CLAUDE.md), and it does not need to. Both faces are known
 * and vendored (`assets/fonts`), the monospaced one has one advance, and the
 * tracking is a constant in `styles.css`. What this asserts is the bound the
 * box was chosen for, in all three languages — which is the thing that would
 * silently stop being true when somebody adds a module or a language.
 *
 * The frame is the owner's, 1366×768: a 46px rail, a 420px readout down the
 * right, and what is left in the middle.
 */

/** `--sv-stencil` is `600 14px/1 'IBM Plex Mono'`, and a mono advance is .6em. */
const MONO = 14 * 0.6;

/** One character of a stencil label, tracking included. */
const stencil = (track: number): number => MONO + 14 * track;

/** `--sv-stencil-track`, and the .14em the narrower columns are set in. */
const TRACK = 0.22;
const TRACK_TIGHT = 0.14;

/** How wide a run of characters is drawn in a stencil column. */
function drawn(text: string, track: number): number {
  return text.length * stencil(track);
}

describe("the fourth view's fixed columns hold in all three languages", () => {
  /**
   * The rack's name column (`meters/Rack.tsx`, `LABEL`).
   *
   * It is fixed so the meters beside it start at the same x — two modules can
   * only be compared by eye if their marks line up. At 78px it cut `THRUSTERS`
   * in English, so it is 112.
   */
  it("names every module inside the rack's column", () => {
    const BOX = 112;
    {
      for (const id of Object.keys(MODULES) as ModuleId[]) {
        const name = moduleName(id);
        expect(drawn(name, TRACK_TIGHT), `${name}`).toBeLessThanOrEqual(BOX);
      }
    }
  });

  /**
   * The ending card's caption column (`screens/Cards.tsx`).
   *
   * Fixed for the same reason — the five figures are read down a column, so
   * the numbers have to line up — and at 120 it ran `HULLS SOLD` in Spanish
   * (`CASCOS VENDIDOS`) and Russian (`ПРОДАНО КОРПУСОВ`) into the figure.
   */
  it("captions every figure of a finished run inside its column", () => {
    const BOX = 200;
    const captions = [
      "title.menu.seed",
      "end.fig.turns",
      "end.fig.sorties",
      "end.fig.sold",
      "end.fig.cr",
    ] as const;
    {
      for (const key of captions) {
        const caption = t(key).toUpperCase();
        expect(drawn(caption, TRACK), `${caption}`).toBeLessThanOrEqual(BOX);
      }
    }
  });

  /**
   * The goal panel's four stat rows (`Screen.tsx`, `Stat`).
   *
   * 300px of panel, 28 of padding, the alert dial and its gap, and the figure
   * on the right: what is left is the label's, and it is the one row on the
   * board that cannot grow sideways.
   */
  it("labels every reading of the goal panel inside what the dial leaves it", () => {
    const PANEL = 300;
    const PAD = 28;
    const DIAL = 58;
    const GAP = 18 + 8;
    /* The widest figure a run can put there: five digits of salvage and the
       unit, set in the body face. */
    const FIGURE = t("word.cr", { n: 99999 }).length * MONO;
    const BOX = PANEL - PAD - DIAL - GAP - FIGURE;
    const labels = [
      "react.stat.systems",
      "react.stat.keys",
      "react.stat.held",
      "react.stat.banked",
    ] as const;
    {
      for (const key of labels) {
        const label = t(key).toUpperCase();
        expect(drawn(label, TRACK), `${label}`).toBeLessThanOrEqual(BOX);
      }
    }
  });

  /**
   * The goal panel's own header: the hull's name, and which sortie this is.
   *
   * A panel header is one row and does not wrap, so a class name that does not
   * fit pushes the sortie off the strip. The title is set in Barlow Condensed
   * at 24px; a condensed capital averages about .45em, and the track adds
   * `--sv-title-track`.
   */
  it("fits the hull and the sortie on the goal panel's strip", () => {
    const PANEL = 300;
    /* The strip's own padding, the gap between the two, and the block at the
       end of it (`chrome/Panel.tsx`). */
    const CHROME = 24 + 9 + 8;
    const title = (text: string): number => text.length * (24 * 0.45 + 24 * 0.06);
    {
      const sortie = drawn(t("panel.sortie", { n: 9 }).toUpperCase(), TRACK);
      for (const spec of DERELICTS) {
        const name = derelictName(spec).toUpperCase();
        expect(title(name) + sortie + CHROME, `${name}`).toBeLessThanOrEqual(PANEL);
      }
    }
  });

  /**
   * And the arithmetic itself, so a green run means something.
   *
   * A bound that nobody can fail is a test about nothing: this is what the
   * boxes above were sized against, and it is what changes if the face or the
   * tracking ever does.
   */
  it("measures a stencil column the way the stylesheet sets one", () => {
    expect(MONO).toBeCloseTo(8.4);
    expect(stencil(TRACK)).toBeCloseTo(11.48);
    expect(stencil(TRACK_TIGHT)).toBeCloseTo(10.36);
    // Ten characters is what `tests/i18n.test.ts` holds a module name to, and
    // the rack's column is the reason.
    expect(Math.floor(112 / stencil(TRACK_TIGHT))).toBe(10);
  });
});
