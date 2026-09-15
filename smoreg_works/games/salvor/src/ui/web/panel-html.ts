import { t } from "../../i18n.js";
import type { Key } from "../../content/i18n/keys.js";
import type { Action } from "../actions.js";
import { panelColour, slotNumberOf, type PanelLine } from "../panel.js";
import type { KnownHazard } from "../schematic-input.js";
import { THEME } from "../theme.js";
import { esc } from "./schematic-svg.js";
import { varOf } from "./styles.js";

/**
 * The panel down the right-hand side, as HTML.
 *
 * It draws exactly what the terminal draws and decides nothing: the lines arrive
 * already worded, already coloured and already clipped from `panelBlocks`, and
 * the action list arrives from `roomActions`. What changes is only how they are
 * put on a page — the integrity bars become real bars, a numbered line becomes a
 * button that fires the same command its digit does, and the blank rows the
 * terminal parts its blocks with become rules between blocks.
 *
 * That last one is the whole of the layout: `panelBlocks` already separates the
 * contacts from the goal from the charters from the rack with an empty row, so
 * grouping on empty rows recovers the structure the artboards draw without this
 * file knowing what any block *is*. A block added to `panel.ts` tomorrow gets
 * its frame here for free, and a block renamed keeps it — no list of headings
 * to fall out of date, and nothing to translate twice.
 *
 * The split is `panelBlocks(game, [], cursor)`: with no actions handed to it the
 * panel comes back as its own two halves around the `ACTIONS` heading, and the
 * list goes between them as buttons. Nothing here re-implements the layout, and
 * nothing here invents a word.
 */

/**
 * The heading `panelBlocks` puts above the numbered list — the seam this file
 * cuts the panel on.
 *
 * Read from the table per call rather than held as a constant: the heading is
 * `ACCIONES` in Spanish and `ДЕЙСТВИЯ` in Russian, and a hard-coded `ACTIONS`
 * simply never matched there — the seam went missing and every button landed
 * above the compartment instead of under the heading. `panelBlocks` writes this
 * row from the same key, so the two can only agree.
 */
function listHeading(): string {
  return t("panel.actions");
}

/** Runs of the rack's own bar glyphs, which become a bar rather than two letters. */
const BAR_RUN = /[▮▯]+/g;

/**
 * The mark the rack puts on the slot the next blow lands in (`twist/rig.ts`).
 * Not a word in any language, which is why it can be looked for here.
 */
const EXPOSED = "◀";

/**
 * The alert row, and how far up the gauge it is — read the way `listHeading`
 * reads its heading: the row opens with the word `panel.alert` opens with, in
 * whatever language the table is in, and the level is the filled cells of the
 * bar after it. The RIVAL row carries a bar too, which is why the word is
 * checked and not the bar alone.
 */
function alertLevelOf(text: string): number | undefined {
  const prefix = t("panel.alert", { gauge: "" }).trim();
  const row = text.trim();
  if (prefix.length === 0 || !row.startsWith(prefix)) return undefined;
  const bar = /[▮▯]+/.exec(row.slice(prefix.length));
  if (bar === null) return undefined;
  return [...bar[0]].filter((ch) => ch === "▮").length;
}

/**
 * The panel, top to bottom.
 *
 * Two of the arguments are differences between frames rather than facts about
 * one, which is why neither comes out of `panelBlocks`: `flash` is the slots
 * that took a blow on the turn being drawn (`trackFlash` in `panel.ts`), and
 * `lit` is the machines the appearance pulse is flashing on the beat
 * (`ui/pulse.ts`). The terminal renderer draws both off the same two values.
 */
export function htmlOf(
  blocks: readonly PanelLine[],
  foot: readonly PanelLine[],
  actions: readonly Action[],
  cursor: number,
  flash: ReadonlySet<number> = new Set(),
  lit: ReadonlySet<number> = new Set(),
): string {
  const heading = listHeading();
  // The alert is not the panel's on a page: it stands in the corner of the map
  // as a ladder (`cornerHtml`). Taken out before the blocks are grouped, so the
  // stack of counters it stood in closes up behind it rather than keeping a hole.
  const body = blocks.filter((line) => alertLevelOf(line.text) === undefined);
  const groups = ordered(groupsOf(body), heading);
  const out = groups.map(({ kind, lines }) => {
    const rows = lines.map((line, j) => lineHtml(line, flash, lit, j === 0));
    // The list belongs to the block its heading is in, under that heading —
    // which is where `panelBlocks` puts it for the terminal too.
    if (lines.some((line) => line.text.trim() === heading)) rows.push(actionsHtml(actions, cursor));
    // What the block *is*, for the stylesheet to pick a housing by (G91 A).
    // An attribute and not a second class: the class is what every test and
    // every other rule in the sheet already looks the block up by, and a
    // `class="pb pb-rack"` quietly stops being `class="pb"` for all of them.
    return `<section class="pb" data-pb="${kind}">${rows.join("")}</section>`;
  });
  // The key row, pinned to the corner of the panel — the owner's "подсказки по
  // хоткеям всегда снизу справа". Handed in rather than taken off the end of
  // the blocks: on a full panel the terminal leaves no blank row between it and
  // the list, so the two arrive as one block and the list went to the foot with
  // it ("действия не наверху").
  if (foot.length === 0) return out.join("");
  const keys = foot.map((line) => lineHtml(line, flash, lit)).join("");
  return [...out, `<section class="pb foot">${keys}</section>`].join("");
}

/**
 * The blocks in the order the page wants them, which is not the order the
 * terminal wants them.
 *
 * The sidebar cannot scroll: every block on it is above the fold by
 * construction, and `panelBlocks` spends its whole length deciding which one
 * gives way when there are not enough rows. A page has as many rows as it
 * likes, so the question changes from *what fits* to *what is read first* —
 * and the owner answered it: "сверху состояние, действия и контакты,
 * остальное ниже, оно не так важно, можно прокрутить".
 *
 * So: the rack, then whatever is aboard with you, then the list you press.
 * The goal, the charters, the counters and the doors keep their own order
 * underneath. The key row is not among these at all — it is handed to `htmlOf`
 * separately and pinned to the corner.
 *
 * The three are picked out without reading a word of any of them — a rack row
 * is a row with a slot number, a contact is the only line that carries an
 * entity id, and the list is under the one heading this file already has to
 * know. Nothing here needs translating, and a block reworded upstairs keeps
 * its place.
 *
 * The same three answers name the housing each block is drawn in (G91 A), which
 * is why they are carried out of here rather than thrown away: the sheet picks
 * a material per block by what the block *is* — the rack is hardware, the
 * contacts are a warning, the list is the interface — and a block nobody has
 * classified is a `rest`, in the house style, without a rule to add.
 */
type Housing = "rack" | "contacts" | "acts" | "rest";

function ordered(groups: PanelLine[][], heading: string): { kind: Housing; lines: PanelLine[] }[] {
  const rack = groups.filter((g) => g.some((l) => slotNumberOf(l.text) !== undefined));
  const seen = groups.filter((g) => !rack.includes(g) && g.some((l) => l.id !== undefined));
  const acts = groups.filter(
    (g) => !rack.includes(g) && !seen.includes(g) && g.some((l) => l.text.trim() === heading),
  );
  const rest = groups.filter((g) => !rack.includes(g) && !seen.includes(g) && !acts.includes(g));
  return [
    ...rack.map((lines) => ({ kind: "rack" as const, lines })),
    ...seen.map((lines) => ({ kind: "contacts" as const, lines })),
    ...acts.map((lines) => ({ kind: "acts" as const, lines })),
    ...rest.map((lines) => ({ kind: "rest" as const, lines })),
  ];
}

/**
 * The panel's blocks, as the blank rows between them already say.
 *
 * Runs of empty rows collapse to one parting and lead nothing: a panel whose
 * list is short is padded with blank rows up to the key line (`panelBlocks`),
 * and every one of those would otherwise open a block of its own.
 */
function groupsOf(blocks: readonly PanelLine[]): PanelLine[][] {
  const out: PanelLine[][] = [];
  let group: PanelLine[] = [];
  for (const line of blocks) {
    if (line.text.trim().length === 0) {
      if (group.length > 0) out.push(group);
      group = [];
      continue;
    }
    group.push(line);
  }
  if (group.length > 0) out.push(group);
  return out;
}

/**
 * The ten rungs of the alert, in order: the word the panel shows for each, and
 * what the ship does on it, short. The words are the ladder's own
 * (`systems/alert.ts`, `LADDER`); the second column exists only here.
 */
const RUNGS: ReadonlyArray<readonly [Key, Key]> = [
  ["alert.noticed", "alert.does.noticed"],
  ["alert.searching", "alert.does.searching"],
  ["alert.post", "alert.does.post"],
  ["alert.pickets", "alert.does.pickets"],
  ["alert.hunting", "alert.does.hunting"],
  ["alert.pack", "alert.does.pack"],
  ["alert.hunter", "alert.does.hunter"],
  ["alert.lockdown", "alert.does.lockdown"],
  ["alert.scuttle", "alert.does.scuttle"],
  ["alert.detonation", "alert.does.detonation"],
];

/**
 * The top-left corner of the map: the codex chip, the alert as a ladder, and
 * the hazards the drone knows are aboard (docs/tasks/G89-festival.md, A3).
 *
 * The alert used to be a counter in the panel's stack and, from three up, a
 * framed row lifted over the rack. As a ladder it answers the question the row
 * could not — what comes next, and what it will do — while the row itself
 * heads it word for word, gauge, countdown and all, so the corner and the
 * terminal still say one thing. Passed rungs go dim, the one the ship is on
 * takes the gauge's colour, and the rest wait in between.
 *
 * Every word is handed in or looked up: the row out of `panelBlocks`, the
 * badge out of `codexBadge`, the hazards out of `hazardsAboard`. Empty when all
 * three are — which is the tug.
 */
export function cornerHtml(
  badge: string | undefined,
  blocks: readonly PanelLine[],
  hazards: readonly KnownHazard[],
): string {
  const chip = badge === undefined ? "" : `<div class="web-codex">${esc(badge)}</div>`;
  const row = blocks.find((line) => alertLevelOf(line.text) !== undefined);
  const level = row === undefined ? 0 : (alertLevelOf(row.text) ?? 0);
  const ladder =
    row === undefined
      ? []
      : [
          `<div class="rung-head">${bars(row.text.trim())}</div>`,
          ...RUNGS.map(([word, does], i) => {
            const at = i + 1;
            const state = at < level ? "is-past" : at === level ? "is-now" : "is-next";
            return [
              `<div class="rung ${state}">`,
              `<i>${at <= level ? "▮" : "▯"}</i>`,
              `<span class="w">${esc(t(word))}</span>`,
              `<span class="do">${esc(t(does))}</span>`,
              "</div>",
            ].join("");
          }),
        ];
  const aboard = hazards.map((h) =>
    [
      `<div class="hz hz-${h.id}">`,
      `<i>${esc(h.glyph)}</i>`,
      `<span class="w">${esc(h.where)}</span>`,
      `<span class="do">${esc(h.name)}</span>`,
      "</div>",
    ].join(""),
  );
  if (chip.length === 0 && ladder.length === 0 && aboard.length === 0) return "";
  const hazardRows = aboard.length === 0 ? "" : `<div class="hz-list">${aboard.join("")}</div>`;
  const box =
    ladder.length === 0 && aboard.length === 0
      ? ""
      : `<div class="web-ladder is-l${level}">${ladder.join("")}${hazardRows}</div>`;
  return `<div class="web-corner">${chip}${box}</div>`;
}

/**
 * One line of the panel, in the colour the panel picked for it.
 *
 * `panelColour` is the authority — it already knows that a system's own colour
 * beats the default, that `burned` is its own grey and that a slot which just
 * took a hit is red — so this reads the answer rather than the rules.
 *
 * `first` says the line opens its block, which is the only thing this file
 * needs in order to draw a heading as a heading: a block's first row in the
 * accent colour is a title in every language, and no row further down is.
 */
export function lineHtml(
  line: PanelLine,
  flash: ReadonlySet<number> = new Set(),
  lit: ReadonlySet<number> = new Set(),
  first = false,
): string {
  const slot = slotNumberOf(line.text);
  const hit = slot !== undefined && flash.has(slot);
  const colour = varOf(panelColour(line, flash, lit));
  const classes = ["pl"];
  if (first && line.fg === THEME.accent) classes.push("h");
  if (slot !== undefined) classes.push("slot", ...slotTone(line));
  if (line.text.includes(EXPOSED)) classes.push("is-exposed");
  if (hit) classes.push("hit");
  // A line that stands for a key is pressed by clicking it (`mount.ts`).
  const press = line.press === undefined ? "" : ` data-key="${esc(line.press)}"`;
  if (press.length > 0) classes.push("is-press");
  return `<div class="${classes.join(" ")}"${press} style="color:${colour}">${toned(line, lit)}</div>`;
}

/**
 * The line's text with its own coloured run, when it has one and is not
 * flashing: a contact's hit points in the colour of what is left (G90 D1).
 */
function toned(line: PanelLine, lit: ReadonlySet<number>): string {
  const tone = line.tone;
  if (tone === undefined || (line.id !== undefined && lit.has(line.id))) return bars(line.text);
  const { text } = line;
  return [
    bars(text.slice(0, tone.from)),
    `<span style="color:${varOf(tone.fg)}">${bars(text.slice(tone.from, tone.to))}</span>`,
    bars(text.slice(tone.to)),
  ].join("");
}

/**
 * How worn a rack row is, as the class its bar is coloured by: nothing while
 * three quarters or more is left, `is-worn` below that, `is-low` on the last
 * point or the last quarter — the same quarter `contactTone` turns a machine
 * red at, so red means one thing on both halves of the panel. A burned slot has
 * no bar and gets its hatching instead.
 */
function slotTone(line: PanelLine): string[] {
  if (line.fg === THEME.burned) return ["is-burned"];
  const run = /[▮▯]+/.exec(line.text)?.[0] ?? "";
  const on = [...run].filter((ch) => ch === "▮").length;
  const total = [...run].length;
  if (total === 0 || on === total) return [];
  if (on <= 1 || on / total <= 0.25) return ["is-low"];
  return on / total < 0.75 ? ["is-worn"] : [];
}

/**
 * The rack's integrity, drawn as what it is. `▮▮▮▯▯` is already a bar in the
 * terminal; here the spent half of it is dimmed instead of being the same ink as
 * the rest, which is the one thing a character cell could never do.
 */
function bars(text: string): string {
  let out = "";
  let at = 0;
  for (const run of text.matchAll(BAR_RUN)) {
    const start = run.index;
    out += esc(text.slice(at, start));
    out += `<span class="bar">${[...run[0]]
      .map((ch) => `<i class="${ch === "▮" ? "on" : "off"}">${ch}</i>`)
      .join("")}</span>`;
    at = start + run[0].length;
  }
  return out + esc(text.slice(at));
}

/**
 * The numbered list as buttons.
 *
 * A click is the row: `data-line` is the index into the list as it is drawn,
 * and `{ kind: "line", index }` carries it to the reducer, which does that row.
 * It used to carry the same number as `{ kind: "pick" }`, which is a *digit* —
 * true on the compartment's own list and false one level down, where `0` is the
 * way back however few entries there are. A click on `back` in a list of five
 * sent 5, no row wore that digit, and the page said "nothing on that line" and
 * stayed inside the level (docs/tug-menu-audit.md, defect 6). A line that
 * cannot be pressed stays pressable for the same reason its digit does —
 * pressing it prints why, and costs no turn.
 *
 * Every entry gets a button, including the ones past the tenth that the terminal
 * can only count: the panel scrolls here, and a list that scrolls has no reason
 * to hide its own tail.
 */
/**
 * The debug overlay (G68), drawn as its own section under the log — never
 * inside `htmlOf`'s grouped blocks, so it cannot be mistaken for one of them
 * or picked up by `ordered()`. Empty input means the flag is off: the section
 * is left out of the page entirely rather than rendered blank, which is what
 * `tests/debug.test.ts` checks for.
 */
export function debugHtml(lines: readonly PanelLine[]): string {
  if (lines.length === 0) return "";
  const rows = lines.map((line) => lineHtml(line)).join("");
  return `<section class="pb web-debug">${rows}</section>`;
}

function actionsHtml(actions: readonly Action[], cursor: number): string {
  if (actions.length === 0) return "";
  const rows = actions.map((action, i) => {
    // The group this line opens. The terminal has drawn these since G53; the
    // page dropped them, so the dock read as ten unrelated verbs — which is
    // what the owner was looking at when he asked for the list to be grouped.
    const head = action.head === undefined ? "" : `<div class="pl h">${esc(action.head)}</div>`;
    const classes = ["act"];
    if (i === cursor) classes.push("is-cursor");
    if (!action.enabled) classes.push("is-off");
    const extra = action.extra === undefined ? "" : `<span class="extra">${esc(action.extra)}</span>`;
    const mark = i === cursor ? '<span class="cursor">▸</span>' : "";
    // A row past the tenth wears no digit at all (`keyed`), and an empty chip
    // is a stamp of nothing: the cell keeps the cursor's place and no more.
    const chip = action.key.length === 0 ? "" : `<span class="kc">${esc(action.key)}</span>`;
    return [
      head,
      `<button type="button" class="${classes.join(" ")}" data-line="${i}">`,
      // The key on a chip of its own inside the cursor's cell (G91 A): the
      // stamp is what the eye is looking for on a keyed list, and it cannot be
      // the cell itself — the cursor mark shares it, and a chip around both
      // would stamp a mark that is not a key.
      `<span class="key">${mark}${chip}</span>`,
      `<span class="label">${esc(action.label)}</span>`,
      extra,
      "</button>",
    ].join("");
  });
  return `<div class="acts">${rows.join("")}</div>`;
}
