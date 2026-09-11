import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { keyed, roomActions, type Action } from "../src/ui/actions.js";
import { panelBlocks, type PanelLine } from "../src/ui/panel.js";
import { t } from "../src/i18n.js";
import { THEME } from "../src/ui/theme.js";
import { exposeHtml, htmlOf, lineHtml } from "../src/ui/web/panel-html.js";
import { screenHtml } from "../src/ui/web/screen.js";
import { initialState } from "../src/ui/appstate.js";
import { HISTORY_ROWS } from "../src/ui/logline.js";

/**
 * The panel as HTML. It draws what `panelBlocks` and `roomActions` decided and
 * decides nothing, so what is tested here is exactly that: every action is a
 * button, every button carries the index its digit carries, and no string that
 * came out of a content card can close a tag.
 */

const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r2 -#d6#- r6
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r6: corridor explored
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

/** The panel the web view actually asks for: its two halves, and no list between them. */
function blocksOf(game: RoomGame, cursor = 0): PanelLine[] {
  return panelBlocks(game, [], cursor);
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("the HTML panel", () => {
  it("gives every action a button carrying its position in the list", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const actions = roomActions(game);
    const html = htmlOf(blocksOf(game), [], actions, 0);

    expect(count(html, "<button")).toBe(actions.length);
    actions.forEach((action, i) => {
      expect(html, action.label).toContain(`data-line="${i}"`);
      expect(html, action.label).toContain(action.label);
    });
    // The position, never the digit: the ten digits are a window over the list
    // and a click has nothing to look up (docs/tug-menu-audit.md, defect 6).
    actions.forEach((action) => {
      if (action.key !== "") expect(html).toContain(`>${action.key}</span>`);
    });
  });

  it("marks the line the cursor is on, and only that line", () => {
    const game = gameIn();
    // The map, because it is the longer of the two lists: the compartment's own
    // has had its doors taken off it (G48).
    const actions = roomActions(game, undefined, true);
    const html = htmlOf(blocksOf(game, 2), [], actions, 2);
    expect(count(html, "is-cursor")).toBe(1);
    expect(count(html, '<span class="cursor">▸</span>')).toBe(1);
    expect(html).toContain(`<button type="button" class="act is-cursor" data-line="2">`);
  });

  it("greys a line that cannot be pressed but leaves it pressable", () => {
    const shut: Action = {
      key: "2",
      label: "go d6  CORRIDOR  sealed",
      cmd: { kind: "go", door: 6 },
      enabled: false,
      why: "The d6 door is sealed.",
    };
    const open: Action = { key: "1", label: "go d1  DOCKING   open", cmd: { kind: "go", door: 1 }, enabled: true };
    const html = htmlOf([{ text: "ACTIONS" }], [], [open, shut], -1);
    expect(html).toContain('class="act is-off" data-line="1"');
    expect(html).toContain('class="act" data-line="0"');
    // No `disabled`: pressing it prints why, exactly as its digit does.
    expect(html).not.toContain("disabled");
  });

  it("prints the other ways through a door under its own line", () => {
    const game = gameIn();
    const actions = roomActions(game);
    const withWays = actions.filter((a) => a.extra !== undefined);
    const html = htmlOf(blocksOf(game), [], actions, 0);
    expect(count(html, '<span class="extra">')).toBe(withWays.length);
    for (const a of withWays) expect(html).toContain(a.extra!);
  });

  it("puts the list where the panel's own heading says it goes", () => {
    const game = gameIn();
    const html = htmlOf(blocksOf(game), [], roomActions(game), 0);
    const heading = html.indexOf("ACTIONS");
    const list = html.indexOf('<div class="acts">');
    const foot = html.indexOf("? help");
    expect(heading).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(heading);
    expect(foot).toBeGreaterThan(list);
  });

  it("draws every line the panel handed over, and nothing more", () => {
    const game = gameIn();
    const blocks = blocksOf(game);
    const html = htmlOf(blocks, [], [], 0);
    // A blank row is not a line here, it is the parting between two blocks —
    // the panel draws it as a rule and the page gets its height back.
    const said = blocks.filter((line) => line.text.trim().length > 0);
    expect(count(html, '<div class="pl')).toBe(said.length);
    for (const line of said) {
      if (!/[▮▯&<>"]/.test(line.text)) expect(html, line.text).toContain(line.text);
    }
  });

  it("parts the panel into the blocks its blank rows already named", () => {
    const game = gameIn();
    const html = htmlOf(blocksOf(game), [{ text: "o explore  ? help" }], [], 0);
    // Every block is a section, and the last one is the key row: it is the
    // corner of the screen the owner asked never to move, and the stylesheet
    // pins it by that name.
    expect(count(html, '<section class="pb"')).toBeGreaterThan(1);
    expect(count(html, '<section class="pb foot"')).toBe(1);
    expect(html.lastIndexOf('class="pb foot"')).toBeGreaterThan(html.lastIndexOf('class="pb"'));
    // And it is the key row that is pinned there, never the action list: the
    // two arrive as one block on a full panel, and reading the last block as
    // the foot sent the list to the bottom of the screen with it.
    expect(html).toContain('<section class="pb foot">');
    expect(html.indexOf('class="pb foot"')).toBeGreaterThan(html.indexOf("<button"));
    // Runs of blank rows lead nothing: a short list is padded up to the key
    // line, and every one of those rows would otherwise open a block.
    expect(html).not.toContain('<section class="pb"></section>');
  });

  it("says the exposed slot a second time, as a mark of its own", () => {
    const rack: PanelLine[] = [
      { text: "1 CUTTER   ▮▮▯" },
      { text: "2 THRUSTERS ▮▮▮  ◀", fg: THEME.accent },
    ];
    // Once as its own row in the rack, once in the corner of the map: the one
    // duplication on the screen, and the reason it is here is that the question
    // this view is judged on is what the next blow lands in.
    expect(count(htmlOf(rack, [], [], -1), "THRUSTERS")).toBe(1);
    expect(count(htmlOf(rack, [], [], -1), "is-exposed")).toBe(1);
    const mark = exposeHtml(rack, new Set(), new Set());
    expect(mark).toContain("THRUSTERS");
    expect(mark).toContain(t("panel.nextHit"));
    // Nothing exposed, nothing said twice.
    expect(exposeHtml([{ text: "1 CUTTER   ▮▮▯" }], new Set(), new Set())).toBe("");
  });

  it("turns the rack's own glyphs into a bar with a spent half", () => {
    const html = lineHtml({ text: "1 CUTTER   ▮▮▯", fg: THEME.fg });
    expect(html).toContain('<span class="bar">');
    expect(count(html, '<i class="on">▮</i>')).toBe(2);
    expect(count(html, '<i class="off">▯</i>')).toBe(1);
    expect(html).toContain("1 CUTTER   ");
  });

  it("flashes the slot that took the blow", () => {
    const hurt = new Set([2]);
    expect(lineHtml({ text: "3 SCANNER  ▮▮" }, hurt)).toContain('class="pl slot hit"');
    expect(lineHtml({ text: "4 PLATING  ▮▮" }, hurt)).toContain('class="pl slot"');
    // Red beats whatever the system asked for: the blow is the only thing on
    // the panel that is a difference between two turns.
    expect(lineHtml({ text: "3 SCANNER  ▮▮", fg: THEME.fg }, hurt)).toContain("color:var(--bad)");
  });

  it("keeps the colour the panel chose, as the token that holds it", () => {
    expect(lineHtml({ text: "SALVOR  tug", fg: THEME.accent })).toContain("color:var(--accent)");
    expect(lineHtml({ text: "… 2 more in sight", fg: THEME.fgDim })).toContain("color:var(--fg-dim)");
    expect(lineHtml({ text: "plain" })).toContain("color:var(--fg)");
    // A colour no token holds still reaches the page, rather than being dropped.
    expect(lineHtml({ text: "odd", fg: "#123456" })).toContain("color:#123456");
  });

  it("carries the contacts bar onto the page in the red the panel chose", () => {
    // The web view is a second renderer of the same lines, so the block the
    // owner must not be able to miss has to be just as loud here (G47).
    const game = gameIn();
    put(game, "r2", "security-unit");
    const html = htmlOf(blocksOf(game), [], [], 0);

    expect(html).toContain("══ ENEMY IN HERE: 1 ");
    expect(html).toContain("S security unit 8/8 melee");
    // The rule is the loud half and stays red; the line under it now carries
    // how much of the machine is left, and this one is untouched (G79, and
    // `contactTone` in ui/panel.ts).
    expect(count(html, "color:var(--bad)")).toBe(1);
    expect(count(html, "color:var(--good)")).toBe(1);
  });

  it("escapes everything that came out of a content card", () => {
    const action: Action = {
      key: "1",
      label: 'salvage <b>"X"</b> & co',
      cmd: { kind: "wait" },
      enabled: true,
      extra: "c cut & <weld>",
    };
    const html = htmlOf([{ text: "ACTIONS" }, { text: '† & "x" <y>' }], [], [action], 0);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp; co");
    expect(html).toContain("&lt;weld&gt;");
    expect(html).toContain("&quot;x&quot;");
  });

  it("draws a panel with no list at all", () => {
    expect(htmlOf([], [], [], 0)).toBe("");
    expect(htmlOf([{ text: "SALVOR" }], [], [], 0)).toContain("SALVOR");
    expect(htmlOf([{ text: "SALVOR" }], [], [], 0)).not.toContain('<div class="acts">');
  });
});

/**
 * The log on the page: which lines are bright, and where one turn ends.
 *
 * The rule itself is `logFades` and is tested on its own (tests/logline.test.ts).
 * What is checked here is the wiring — that the page carries the three states
 * as classes the stylesheet has rules for, and not the old count of three.
 */
describe("the log on the page", () => {
  const playing = { ...initialState(), overlay: "none" as const };

  it("carries this turn bright, the last one soft and the rest dim", () => {
    const game = gameIn();
    game.log.add("an old thing", 4);
    game.log.add("the turn before", 5);
    game.log.add("you fire", 6);
    game.log.add("the shot lands", 6);
    game.log.add("something moves behind d4", 6);
    const html = screenHtml(game, playing, new Set());

    // Five lines and three of them on the newest turn: under the old rule the
    // first of those three was already grey. The gap marks each turn boundary,
    // which is the same statement without a colour.
    expect(html).toContain('<div class="plain old turn-gap">an old thing</div>');
    expect(html).toContain('<div class="plain recent turn-gap">the turn before</div>');
    expect(html).toContain('<div class="plain turn-gap">you fire</div>');
    expect(html).toContain('<div class="plain">the shot lands</div>');
    expect(html).toContain('<div class="plain">something moves behind d4</div>');
  });

  it("draws the history card on the page as well as in the terminal", () => {
    const game = gameIn();
    for (let i = 0; i < HISTORY_ROWS + 3; i++) game.log.add(`line ${i}`, i);
    const html = screenHtml(game, { ...playing, overlay: "history", logPage: 1 }, new Set());

    expect(html).toContain(t("log.title"));
    // Page 1 is a screen further back: the oldest lines, and a footer saying
    // which of how many. The log itself is still drawn behind the card, so the
    // card's own rows are what is read here.
    expect(html).toContain('<div class="keys">line 0</div>');
    expect(html).not.toContain(`<div class="keys">line ${HISTORY_ROWS + 2}</div>`);
    expect(html).toContain("2/2");
  });
});

// ------------------------------------------------- the two views say the same

/**
 * The rule of this repo that G85 found broken: two views never word the same
 * thing differently.
 *
 * `attack security unit 8/8 #1` is twenty-seven columns in a list that has
 * twenty-five. The terminal used to `slice` it and lose the `#1` — the only
 * thing telling it from the line above it — while the page printed it whole,
 * so the two screens disagreed about what the player was choosing between.
 * Both now draw the one line `fitLabel` made, and this is what proves it.
 */
describe("the page and the terminal draw the same line", () => {
  it("shortens twins the same way in both, and neither prints the long form", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r2", "security-unit");
    const actions = roomActions(game);

    const twins = actions.filter((a) => a.cmd.kind === "attack");
    expect(twins.map((a) => a.label)).toEqual(["attack security 8/8 #1", "attack security 8/8 #2"]);

    const html = htmlOf(blocksOf(game), [], actions, 0);
    const rows = panelBlocks(game, actions, 0).map((l) => l.text);
    for (const line of twins) {
      expect(html).toContain(`<span class="label">${line.label}</span>`);
      expect(rows.some((r) => r.includes(line.label))).toBe(true);
    }
    // The block above the list still names the machine in full — it has the
    // columns for it. What may not survive anywhere is the line that was over
    // budget, in either view.
    expect(html).not.toContain("attack security unit");
    expect(rows.some((r) => r.includes("attack security unit"))).toBe(false);
  });

  it("puts the price on the row under the line, in both views", () => {
    const game = gameIn();
    const priced = keyed([
      { key: "", label: t("action.purge", { module: "THRUSTERS", left: 2 }), cmd: { kind: "wait" }, enabled: true },
    ]);
    const line = priced[0]!;
    expect(line.label).toBe("purge THRUSTERS");
    expect(line.extra).toBe("(welder, 2 turns)");

    const html = htmlOf(blocksOf(game), [], priced, 0);
    expect(html).toContain('<span class="extra">(welder, 2 turns)</span>');
    const rows = panelBlocks(game, priced, 0).map((l) => l.text);
    expect(rows).toContain("   (welder, 2 turns)");
  });
});
