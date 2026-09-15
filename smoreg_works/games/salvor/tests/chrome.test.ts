import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { roomActions } from "../src/ui/actions.js";
import { PANEL_WIDTH, panelBlocks, footBlocks } from "../src/ui/panel.js";
import { htmlOf } from "../src/ui/web/panel-html.js";
import { WEB_CSS } from "../src/ui/web/styles.js";

/**
 * The chrome: the material the screen is made of, as opposed to what it says.
 *
 * G91 A took the partner's design system (`vuvko_works/design/salvor-design-system`)
 * and adopted three things out of it — a type scale with a floor under it, a
 * housing for every block, and a motion grid. None of the three is checkable by
 * looking at a screenshot, and all three are the kind of thing that decays one
 * careless rule at a time, which is what this file is for: the floor holds, the
 * housings are picked by what a block *is*, and nothing on the screen moves off
 * the grid.
 */

const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
`;

function gameIn(room = "r2", seed = 7): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): void {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
}

/** The panel of a real game, drawn the way `screenHtml` draws it. */
function panelOf(game: RoomGame, cursor = 0): string {
  const blocks = panelBlocks(game, [], cursor);
  const foot = footBlocks(game);
  const body = blocks.slice(2, blocks.length - foot.length);
  return htmlOf(body, foot, roomActions(game), cursor);
}

/**
 * The sheet cut into `selector { body }` pairs. Enough of a parser for what is
 * asked of it below — the sheet has no nested blocks outside its `@media` ones,
 * and those are opened and closed on lines of their own.
 */
function rules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of WEB_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1]!.trim(), body: m[2]! });
  }
  return out;
}

/**
 * Whether a rule paints the map rather than the chrome. The board is the other
 * agent's (`ui/web/hex-svg.ts` and the honeycomb's section of the sheet) and it
 * is drawn in SVG, where a label's size is a property of the picture and not of
 * the interface: an 11px door id on a hexagon is a mark, not a row to read.
 */
function isBoard(selector: string, body: string): boolean {
  return /\.hexmap|\.schematic|\.sky|@keyframes|:root/.test(selector) || /fill:|stroke:/.test(body);
}

describe("the type scale", () => {
  it("declares five roles and puts none of them under the floor", () => {
    const roles = ["display", "title", "value", "body", "stencil"];
    for (const role of roles) {
      const rule = new RegExp(`--sv-${role}:[^;]*?(\\d+)px`).exec(WEB_CSS);
      expect(rule, role).not.toBeNull();
      expect(Number(rule![1]), role).toBeGreaterThanOrEqual(14);
    }
    // And the scale is a scale: five distinct declarations, not one size wearing
    // five names, which is what the panel had before — 13px doing every job.
    const sizes = roles.map((r) => new RegExp(`--sv-${r}:([^;]*)`).exec(WEB_CSS)![1]!);
    expect(new Set(sizes).size).toBe(5);
  });

  it("sets a role and never a size, anywhere in the chrome", () => {
    const floor = 14;
    for (const { selector, body } of rules()) {
      if (isBoard(selector, body)) continue;
      const size = /font-size:\s*(\d+)px/.exec(body);
      if (size === null) continue;
      // The one carrier: a stability cell holds its terminal glyph so the two
      // views still say the same thing, and draws the cell itself (G91 A).
      if (selector === ".bar i") {
        expect(Number(size[1])).toBe(0);
        continue;
      }
      expect(Number(size[1]), selector).toBeGreaterThanOrEqual(floor);
    }
  });

  it("carries its faces in the zip and reaches no network for them", () => {
    // The build runs from a file:// URL inside an itch zip. His sheet opens on
    // an `@import` of two Google fonts; ours declares the same two families off
    // files the bundler copied beside the page (docs/itch-page.md).
    expect(WEB_CSS).not.toMatch(/@import/);
    expect(WEB_CSS).not.toMatch(/https?:/);
    for (const m of WEB_CSS.matchAll(/url\(([^)]*)\)/g)) expect(m[1], m[0]).not.toContain("//");
    // Six faces: two weights of the condensed, two of the mono, and the mono's
    // Cyrillic beside each of its own.
    expect(WEB_CSS.split("@font-face").length - 1).toBe(6);
    expect(WEB_CSS).toMatch(/unicode-range:U\+0301,U\+0400-045F/);
    // Two stacks, and both end in something the system is certain to have: a
    // glyph neither subset carries still has to come from somewhere monospaced,
    // or the panel's columns stop lining up.
    expect(WEB_CSS).toMatch(/--mono: "IBM Plex Mono",[^;]*monospace;/);
    expect(WEB_CSS).toMatch(/--sv-font-display: "Barlow Condensed", var\(--mono\);/);
    for (const role of ["value", "body", "stencil"]) {
      expect(WEB_CSS, role).toMatch(new RegExp(`--sv-${role}:[^;]*var\\(--mono\\)`));
    }
    // Only the two roles set on a line of their own take the condensed face:
    // Barlow is proportional, and the panel's rows are `white-space:pre`.
    for (const role of ["display", "title"]) {
      expect(WEB_CSS, role).toMatch(new RegExp(`--sv-${role}:[^;]*var\\(--sv-font-display\\)`));
    }
  });

  it("leaves the panel's widest row room inside the narrow end of the panel", () => {
    // A monospace cell is .6em wide on every stack the game can land on, and
    // `panelBlocks` clips every row to `PANEL_WIDTH`. The rack's rows are the
    // deepest nested of them: the panel's own padding, then the housing's, then
    // the row's.
    const narrow = /grid-template-columns:\d+px 1fr clamp\((\d+)px/.exec(WEB_CSS);
    expect(narrow).not.toBeNull();
    const panel = Number(narrow![1]);
    const cell = 14 * 0.6;
    const chrome = 12 * 2 + 11 * 2 + 7 * 2;
    expect(PANEL_WIDTH * cell + chrome).toBeLessThanOrEqual(panel);
    // The rack's rows carry their stability as cells rather than as glyphs, and
    // a cell is wider than the character it replaced. The widest module the
    // panel can print is `PANEL_WIDTH` less the shortest name it can wear.
    const width = Number(/\.bar i\{[^}]*width:(\d+)px/.exec(WEB_CSS)![1]);
    const gap = Number(/\.bar\{[^}]*gap:(\d+)px/.exec(WEB_CSS)![1]);
    const cells = 16;
    expect((PANEL_WIDTH - cells) * cell + cells * (width + gap) + chrome).toBeLessThanOrEqual(panel);
    // And the panel itself never takes more than a third of a 1366 laptop.
    const wide = /grid-template-columns:\d+px 1fr clamp\(\d+px, (\d+)vw/.exec(WEB_CSS);
    expect((Number(wide![1]) / 100) * 1366).toBeLessThan(1366 / 2);
  });
});

describe("the housings", () => {
  it("names every block by what it is, without reading a word of it", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const html = panelOf(game);
    // The rack is the block with slot numbers, the contacts the one with an
    // entity on it, the list the one under the heading. None of the three is
    // found by a word, so none of them needs translating.
    for (const kind of ["rack", "contacts", "acts"]) {
      expect(html, kind).toContain(`data-pb="${kind}"`);
    }
    // And a block nobody classified still gets a housing — the house style.
    expect(html).toContain('data-pb="rest"');
  });

  it("gives every housing it can name a material in the sheet", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const kinds = new Set([...panelOf(game).matchAll(/data-pb="([a-z]+)"/g)].map((m) => m[1]!));
    expect(kinds.size).toBeGreaterThan(1);
    for (const kind of kinds) {
      // `rest` is the default and is drawn by `.pb` itself; the others each
      // change what material the block claims to be made of.
      if (kind === "rest") continue;
      expect(WEB_CSS, kind).toContain(`.pb[data-pb="${kind}"]`);
    }
    // Four materials and no more: past two on one screen the housing stops
    // saying anything, which is the tell the rework exists to remove.
    const materials = [...WEB_CSS.matchAll(/\.pb\[data-pb="([a-z]+)"\]/g)].map((m) => m[1]!);
    expect(new Set(materials).size).toBeLessThanOrEqual(3);
  });

  it("keeps the block a section of class pb, whatever housing it wears", () => {
    // The housing rides an attribute and not a second class on purpose: every
    // other rule in the sheet, and every test in the suite, looks a block up by
    // `class="pb"`, and `class="pb pb-rack"` quietly stops being that.
    const html = panelOf(gameIn());
    expect(html).not.toMatch(/<section class="pb pb-/);
    expect(html).toContain('<section class="pb" data-pb=');
    expect(html).toContain('<section class="pb foot">');
  });

  it("cuts a corner off every housing and drops no shadow inside another", () => {
    // The house style: one clipped corner, scanlines, a cast shadow. The two
    // blocks that are not housings at all — the list and the contacts — give up
    // all three rather than keeping half of each.
    expect(WEB_CSS).toMatch(/\.pb\{[^}]*clip-path:var\(--sv-cut-bl\)/);
    expect(WEB_CSS).toMatch(/\.pb\{[^}]*box-shadow:var\(--sv-cast\)/);
    for (const bare of ["acts", "contacts"]) {
      const rule = new RegExp(`\\.pb\\[data-pb="${bare}"\\]\\{([^}]*)\\}`).exec(WEB_CSS);
      expect(rule, bare).not.toBeNull();
      expect(rule![1], bare).toContain("box-shadow:none");
      expect(rule![1], bare).toContain("clip-path:none");
    }
  });
});

describe("the rack and the list", () => {
  it("reads stability cell by cell rather than as two letters", () => {
    expect(WEB_CSS).toMatch(/\.bar\{[^}]*display:inline-flex/);
    // A cell is a struck mark of its own, lit or spent — not a glyph in a run.
    expect(WEB_CSS).toMatch(/\.bar i\{[^}]*clip-path:polygon/);
    expect(WEB_CSS).toMatch(/\.bar i\{[^}]*background:currentColor/);
    expect(WEB_CSS).toContain(".bar .off{color:var(--line);}");
  });

  it("draws a burned slot as an empty bay and not as a labelled loss", () => {
    const rule = /\.pl\.slot\.is-burned\{([^}]*)\}/.exec(WEB_CSS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("dotted");
    // Nothing red about it: what used to be in the bay is a fact for the log,
    // not a warning that stays on the rack for the rest of the sortie.
    expect(rule![1]).not.toContain("--bad");
    expect(rule![1]).not.toContain("--red-wash");
  });

  it("keeps the exposed slot's three signals, and gives them to nothing else", () => {
    const exposed = /\.pl\.slot\.is-exposed\{([^}]*)\}/.exec(WEB_CSS)![1]!;
    expect(exposed).toContain("var(--amber-wash)");
    expect(exposed).toContain("var(--accent)");
    expect(exposed).toContain("box-shadow:0 0 0 3px");
    // The cursor row takes two of the three — ground and edge — and brackets
    // itself with them rather than filling, so the rack keeps the loudest row.
    const cursor = /\.act\.is-cursor\{([^}]*)\}/.exec(WEB_CSS)![1]!;
    expect(cursor).toContain("inset 3px 0 0 var(--accent)");
    expect(cursor).not.toContain("background:var(--accent)");
  });

  it("stamps the key on a chip, and stamps nothing where there is no key", () => {
    const game = gameIn();
    const actions = roomActions(game, undefined, true);
    const html = htmlOf(panelBlocks(game, [], 0), [], actions, 0);
    const keyed = actions.filter((a) => a.key !== "").length;
    expect(keyed).toBeGreaterThan(0);
    expect(html.split('<span class="kc">').length - 1).toBe(keyed);
    for (const action of actions) {
      if (action.key !== "") expect(html).toContain(`<span class="kc">${action.key}</span>`);
    }
    expect(html).not.toContain('<span class="kc"></span>');
    expect(WEB_CSS).toMatch(/\.act \.kc\{[^}]*font:var\(--sv-stencil\)/);
  });

  it("keeps the keyboard ring inside the plate that would clip it", () => {
    // A housing with a corner cut off clips everything drawn outside its own
    // box, an outline at a positive offset included.
    expect(WEB_CSS).toMatch(/\.act\{[^}]*clip-path:var\(--sv-cut-bl\)/);
    expect(WEB_CSS).toMatch(/\.act:focus-visible\{[^}]*outline-offset:-\d/);
  });

  it("leaves a row that cannot be pressed without a plate to press", () => {
    // G90 D5, said in the material: a dead row is not hardware, and the chip
    // on it is an outline rather than a stamp.
    const off = /\.act\.is-off\{([^}]*)\}/.exec(WEB_CSS)![1]!;
    expect(off).toContain("background:none");
    expect(off).toContain("border-color:transparent");
    expect(WEB_CSS).toMatch(/\.act\.is-off \.kc\{[^}]*dotted/);
  });
});

describe("the motion budget", () => {
  /** Every animation the sheet starts, as `[selector, duration, timing]`. */
  function moving(): { selector: string; shorthand: string }[] {
    const out: { selector: string; shorthand: string }[] = [];
    for (const { selector, body } of rules()) {
      for (const m of body.matchAll(/animation:([^;}]+)/g)) {
        const shorthand = m[1]!.trim();
        if (shorthand.startsWith("none")) continue;
        out.push({ selector, shorthand });
      }
    }
    return out;
  }

  it("holds every state for a whole number of frames, and interpolates none", () => {
    const moves = moving();
    expect(moves.length).toBeGreaterThan(3);
    for (const { selector, shorthand } of moves) {
      // The sky is the world drifting past the start screen rather than a
      // control answering a press: forty seconds of it stepped at a quarter
      // second is a ship that stutters instead of sailing.
      if (selector === ".sky-drift") continue;
      expect(shorthand, selector).toMatch(/steps\(\d+,end\)|var\(--sv-step\)/);
      const frames = /var\(--sv-frame(-\d)?\)/.exec(shorthand);
      expect(frames, `${selector}: ${shorthand}`).not.toBeNull();
    }
  });

  it("puts the frame at 225ms and every other duration on it", () => {
    const frame = Number(/--sv-frame:(\d+)ms/.exec(WEB_CSS)![1]);
    expect(frame).toBe(225);
    for (const m of WEB_CSS.matchAll(/--sv-frame-(\d):(\d+)ms/g)) {
      expect(Number(m[2]), m[0]).toBe(frame * Number(m[1]));
    }
    expect(WEB_CSS).toContain("--sv-step:steps(1,end);");
  });

  it("stops everything for a system that asked for less motion", () => {
    // Each animation is also stopped beside where it is started; this is the
    // sweep that catches the next one added without that rule.
    expect(WEB_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\.salvor-web \*\{animation:none !important;\}\}/);
  });

  it("adds no transition, on a view that rebuilds its frame every key press", () => {
    // `mount.ts` writes the whole screen with `innerHTML` on every key, so a
    // transition has nothing to transition from — the element it would run on
    // was made this frame. Nothing interpolates is not only his rule here; it
    // is the only thing that can be true.
    expect(WEB_CSS).not.toContain("transition:");
  });
});
