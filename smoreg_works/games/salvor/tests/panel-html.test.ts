import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { keyed, roomActions, type Action } from "../src/ui/actions.js";
import { panelBlocks, type PanelLine } from "../src/ui/panel.js";
import { LANGS, setLang, t } from "../src/i18n.js";
import { THEME } from "../src/ui/theme.js";
import type { Key } from "../src/content/i18n/keys.js";
import { cornerHtml, htmlOf, lineHtml } from "../src/ui/web/panel-html.js";
import { MAX_LEVEL } from "../src/systems/alert.js";
import { screenHtml } from "../src/ui/web/screen.js";
import { TOKENS, WEB_CSS } from "../src/ui/web/styles.js";
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
    // Bar one: the alert row, which stands in the corner of the map instead
    // (G89 A3) — and is drawn there word for word.
    const alert = t("panel.alert", { gauge: "" }).trim();
    const said = blocks.filter((line) => line.text.trim().length > 0 && !line.text.startsWith(alert));
    expect(count(html, '<div class="pl')).toBe(said.length);
    expect(html).not.toContain(alert);
    const row = blocks.find((line) => line.text.startsWith(alert))!;
    expect(cornerHtml(undefined, blocks, [])).toContain(row.text.split("▯")[0]!.split("▮")[0]!);
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

  it("says the exposed slot once, in the rack, and puts no badge for it on the map", () => {
    const rack: PanelLine[] = [
      { text: "1 CUTTER   ▮▮▯" },
      { text: "2 THRUSTERS ▮▮▮  ◀", fg: THEME.accent },
    ];
    expect(count(htmlOf(rack, [], [], -1), "THRUSTERS")).toBe(1);
    expect(count(htmlOf(rack, [], [], -1), "is-exposed")).toBe(1);
    // "удар куда и так подсвечено": the corner mark that repeated the row is
    // gone, and so is its rule in the sheet (G89 A4).
    const page = screenHtml(gameIn(), { ...initialState(), overlay: "none" }, new Set());
    expect(page).not.toContain("expose\"");
    expect(WEB_CSS).not.toContain(".web-expose");
  });

  it("colours a rack row's bar by how much of the module is left", () => {
    const tone = (text: string, fg: string = THEME.fg) => lineHtml({ text, fg });
    // Whole, or three quarters and more: the row's own light ink.
    expect(tone("1 CUTTER   ▮▮▮▮")).toContain('class="pl slot"');
    expect(tone("1 CUTTER   ▮▮▮▯")).toContain('class="pl slot"');
    // Under three quarters: the warning colour.
    expect(tone("1 CUTTER   ▮▮▯▯")).toContain('class="pl slot is-worn"');
    // The last point, or the last quarter: red, with a red edge.
    expect(tone("1 CUTTER   ▮▯▯")).toContain('class="pl slot is-low"');
    expect(tone("1 PLATING  ▮▮▯▯▯▯▯▯")).toContain('class="pl slot is-low"');
    // A burned slot has no bar to colour, and is hatched instead.
    expect(tone(`6 ${t("panel.slot.burned")}`, THEME.burned)).toContain('class="pl slot is-burned"');
    // And nothing that is not a rack row takes a tone off its bar.
    expect(lineHtml({ text: "RIVAL ▮▯▯" })).toContain('class="pl"');
    for (const rule of [".pl.slot.is-worn .bar .on", ".pl.slot.is-low .bar .on", ".pl.slot.is-low{", ".pl.slot.is-burned{"]) {
      expect(WEB_CSS, rule).toContain(rule);
    }
    expect(WEB_CSS).toMatch(/\.pl\.slot\.is-burned\{[^}]*repeating-linear-gradient/);
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
    // The rule and the machine's own line are both red (G90 D1); only the hit
    // points carry how much of it is left, and this one is untouched (G79, and
    // `contactTone` in ui/panel.ts).
    expect(html).toContain('style="color:var(--bad)">S security unit <span style="color:var(--good)">8/8</span> melee</div>');
    expect(count(html, "color:var(--bad)")).toBe(2);
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
/**
 * The top-left corner of the map (G89 A3): the codex chip, the alert as a
 * ladder of ten rungs (G90 A), and the hazards the drone knows are aboard.
 */
describe("the corner of the map", () => {
  const gauge = (level: number) => "▮".repeat(level) + "▯".repeat(MAX_LEVEL - level);
  const row = (level: number): PanelLine => ({
    text: level === 0 ? t("panel.alert", { gauge: gauge(0) }) : t("panel.alertStage", { gauge: gauge(level), stage: "X" }),
  });

  it("draws the alert as ten rungs: the passed ones dim, the current one lit, the rest waiting", () => {
    const html = cornerHtml(undefined, [{ text: "1 CUTTER ▮▮" }, row(5)], []);
    expect(html).toContain('<div class="web-ladder is-l5">');
    expect(count(html, '<div class="rung ')).toBe(MAX_LEVEL);
    expect(count(html, '<div class="rung is-past">')).toBe(4);
    expect(count(html, '<div class="rung is-now">')).toBe(1);
    expect(count(html, '<div class="rung is-next">')).toBe(5);
    // The rung the ship is on carries its own word and what it does.
    const now = html.slice(html.indexOf("is-now"));
    expect(now).toContain(t("alert.hunting"));
    expect(now).toContain(t("alert.does.hunting"));
    // Headed by the panel's own row, gauge and all.
    expect(html).toContain('<div class="rung-head">');
    expect(html).toContain('<span class="bar">');
  });

  it("names every rung in the language that is on, inside its two columns", () => {
    const words = [
      "alert.noticed", "alert.searching", "alert.post", "alert.pickets", "alert.hunting",
      "alert.pack", "alert.hunter", "alert.lockdown", "alert.scuttle", "alert.detonation",
    ] as const;
    const does = words.map((w) => w.replace("alert.", "alert.does.") as Key);
    try {
      for (const lang of LANGS) {
        setLang(lang);
        const html = cornerHtml(undefined, [row(MAX_LEVEL)], []);
        for (const key of [...words, ...does]) expect(html, `${lang} ${key}`).toContain(t(key));
        // 76 px of 10 px type for the word, and a short phrase beside it.
        for (const key of words) expect(t(key).length, `${lang} ${key}`).toBeLessThanOrEqual(12);
        for (const key of does) expect(t(key).length, `${lang} ${key}`).toBeLessThanOrEqual(22);
      }
    } finally {
      setLang("en");
    }
  });

  it("is red and blinking from the charges up, and the blink yields to reduced motion", () => {
    expect(cornerHtml(undefined, [row(9)], [])).toContain("web-ladder is-l9");
    expect(cornerHtml(undefined, [row(10)], [])).toContain("web-ladder is-l10");
    expect(WEB_CSS).toMatch(/\.web-ladder\.is-l10 \.rung-head\{[^}]*animation/);
    expect(WEB_CSS).toMatch(/prefers-reduced-motion: reduce\)\{\.web-ladder\.is-l9 \.rung-head,\.web-ladder\.is-l10 \.rung-head\{animation:none/);
  });

  it("lists the hazards it is handed, and keeps the codex chip in the same corner", () => {
    const hazards = [
      { id: "frost", glyph: "❄", name: t("word.hazard.frost"), where: "r6" },
      { id: "mine", glyph: "^", name: t("word.hazard.mine", { door: "d5" }), where: "" },
    ];
    const html = cornerHtml(t("codex.badge", { n: 2 }), [row(1)], hazards);
    expect(html.indexOf('class="web-codex"')).toBeLessThan(html.indexOf('class="web-ladder'));
    expect(count(html, '<div class="hz ')).toBe(2);
    expect(html).toContain('<div class="hz hz-frost"><i>❄</i><span class="w">r6</span>');
    expect(html).toContain(t("word.hazard.mine", { door: "d5" }));
    // Nothing to say, nothing drawn: the corner goes back to being map.
    expect(cornerHtml(undefined, [], [])).toBe("");
  });

  it("puts the alert row in the corner on a real screen and takes it off the panel", () => {
    const game = gameIn();
    const html = screenHtml(game, { ...initialState(), overlay: "none" }, new Set());
    const corner = html.indexOf('<div class="web-corner">');
    const panel = html.indexOf('<div class="web-panel">');
    const alert = t("panel.alert", { gauge: "" }).trim();
    expect(corner).toBeGreaterThanOrEqual(0);
    expect(html.indexOf(alert)).toBeGreaterThan(corner);
    expect(html.slice(panel)).not.toContain(alert);
  });
});

/** Artboard 3a: the grid, the strip, the action rows and what a press feels like. */
describe("the screen by artboard 3a", () => {
  const playing = { ...initialState(), overlay: "none" as const };

  it("lays out the strip, the map over the log, and the panel down the whole right side", () => {
    // The strip across the top is gone: what it said floats over the board as a
    // housing (G91 A), and the band it cost is the board's again. What is left
    // fixed is the log, counted in log lines and not in pixels: seven of them,
    // which is what the terminal shows (`LAYOUT.logHeight`) and what the box
    // has to go on showing now that the type has a 14px floor under it. It
    // still lands inside the itch viewport's 764 (docs/itch-page.md).
    expect(WEB_CSS).toContain("grid-template-rows:minmax(0,1fr) 144px;");
    expect(144 - 10).toBeGreaterThanOrEqual(7 * 14 * 1.35);
    expect(144).toBeLessThan(764 / 2);
    // A rail for the mouse, the board, the panel — and the log across the foot.
    expect(WEB_CSS).toMatch(/grid-template-columns:\d\dpx 1fr clamp\(3\d0px, \d+vw, 4\d0px\);/);
    expect(WEB_CSS).toMatch(/\.web-panel\{grid-column:3; grid-row:1;/);
    expect(WEB_CSS).toMatch(/\.web-log\{grid-column:1 \/ -1; grid-row:2;/);
    // The newest line on the floor of the box, and the key row on the floor of the panel.
    expect(WEB_CSS).toContain(".web-log > div:first-child{margin-top:auto;}");
    expect(WEB_CSS).toMatch(/\.pb\.foot\{[^}]*position:sticky; bottom:0;/);
  });

  it("names the hull large, its class small, and the turn with the seed at the right", () => {
    const game = gameIn("r2", 4242);
    const before = screenHtml(game, playing, new Set());
    // A fixture hull has no callsign: the strip falls back to the panel's heading.
    expect(before).not.toContain('class="cls"');
    game.currentShip.data.name = "KESTREL";
    game.currentShip.data.type = "freighter";
    const html = screenHtml(game, playing, new Set());
    expect(html).toContain('<span class="ship">KESTREL</span>');
    expect(html).toMatch(/<span class="cls">[^<]+ · [^<]+<\/span>/);
    expect(html).toContain(`<span class="turn">${t("panel.turn", { n: game.schedule.time })} · ${t("title.menu.seed")} 4242</span>`);
  });

  it("puts the key, the label and the price on one row, and keeps a dead line's reason readable", () => {
    expect(WEB_CSS).toMatch(/\.act\{[^}]*grid-template-columns:26px minmax\(0,1fr\) auto;/);
    expect(WEB_CSS).toMatch(/\.act \.extra\{grid-column:3;/);
    // The cursor mark sits in the key's own cell now, not hung off the row.
    expect(WEB_CSS).not.toMatch(/\.act \.cursor\{[^}]*position:absolute/);
    // Contrast of the words on a line that cannot be pressed, against the panel.
    for (const rule of [/\.act\.is-off\{color:var\(--([\w-]+)\)/, /\.act\.is-off \.extra\{color:var\(--([\w-]+)\)/]) {
      const token = rule.exec(WEB_CSS)?.[1];
      expect(token, String(rule)).toBeDefined();
      expect(contrast(TOKENS[token!]!, TOKENS["panel-bg"]!), token).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives buttons a visible focus and a press, and compartments a pointer and a hover", () => {
    expect(WEB_CSS).toContain(".act:focus-visible{");
    expect(WEB_CSS).toContain(".act:active{");
    expect(WEB_CSS).toContain(".schematic .room{cursor:pointer;}");
    expect(WEB_CSS).toMatch(/\.schematic \.room:not\(\.is-current\):hover \.room-box\{/);
  });

  it("reddens and shakes the map on the frame a blow landed, and only then", () => {
    const game = gameIn();
    expect(screenHtml(game, playing, new Set())).toContain('<div class="web-map">');
    expect(screenHtml(game, playing, new Set([0]))).toContain('<div class="web-map is-hit">');
    expect(WEB_CSS).toMatch(/\.web-map\.is-hit\{[^}]*box-shadow[^}]*animation/);
    expect(WEB_CSS).toContain("@media (prefers-reduced-motion: reduce){.web-map.is-hit{animation:none;}}");
  });
});

/** WCAG contrast ratio of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

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
    expect(line.extra).toBe("(by hand, 2 turns)");

    const html = htmlOf(blocksOf(game), [], priced, 0);
    expect(html).toContain('<span class="extra">(by hand, 2 turns)</span>');
    const rows = panelBlocks(game, priced, 0).map((l) => l.text);
    expect(rows).toContain("   (by hand, 2 turns)");
  });
});
