import { t } from "../../i18n.js";
import type { Action } from "../actions.js";
import { panelColour, slotNumberOf, type PanelLine } from "../panel.js";
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
 * From this level the alert row leaves the counters and stands at the top of
 * the panel, above the rack: the ladder is shutting doors from three up
 * (`systems/alert.ts`, `DOOR_LEVEL`), and a row that changes the shape of the
 * page is read where a row in a stack of counters is not.
 */
const LIFT_ALERT_FROM = 3;

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
  // The alert, lifted out of the counters and put first once the ship is
  // shutting doors. Taken out of the blocks before they are grouped, so the
  // stack it stood in closes up behind it rather than keeping a hole.
  const alarm = blocks.find((line) => (alertLevelOf(line.text) ?? 0) >= LIFT_ALERT_FROM);
  const body = alarm === undefined ? blocks : blocks.filter((line) => line !== alarm);
  const groups = ordered(groupsOf(body), heading);
  const out = groups.map((group) => {
    const rows = group.map((line, j) => lineHtml(line, flash, lit, j === 0));
    // The list belongs to the block its heading is in, under that heading —
    // which is where `panelBlocks` puts it for the terminal too.
    if (group.some((line) => line.text.trim() === heading)) rows.push(actionsHtml(actions, cursor));
    return `<section class="pb">${rows.join("")}</section>`;
  });
  if (alarm !== undefined) {
    const level = alertLevelOf(alarm.text) ?? 0;
    out.unshift(`<section class="pb web-alarm is-l${level}">${lineHtml(alarm, flash, lit)}</section>`);
  }
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
 */
function ordered(groups: PanelLine[][], heading: string): PanelLine[][] {
  const rack = groups.filter((g) => g.some((l) => slotNumberOf(l.text) !== undefined));
  const seen = groups.filter((g) => !rack.includes(g) && g.some((l) => l.id !== undefined));
  const acts = groups.filter(
    (g) => !rack.includes(g) && !seen.includes(g) && g.some((l) => l.text.trim() === heading),
  );
  const rest = groups.filter((g) => !rack.includes(g) && !seen.includes(g) && !acts.includes(g));
  return [...rack, ...seen, ...acts, ...rest];
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
 * The exposed slot, said a second time — as a badge in the bottom-left corner
 * of the map, out of the panel entirely.
 *
 * The one duplication on the screen. The artboards put it at the top of the
 * panel in 22px type; the owner played that and asked for the opposite —
 * "следующий удар мелким значком снизу слева" — which is the better call for
 * the reason the artboards themselves give: the rack row is already the single
 * loudest thing in the panel, and a second shout beside it was two shouts. A
 * small mark where the eye rests between turns says the same thing and costs
 * the panel nothing.
 *
 * The row is reprinted rather than picked apart — the module's name, its bar
 * and its integrity are already worded and already in the right language, and
 * a parser here would be a second place for them to be got wrong.
 */
export function exposeHtml(
  blocks: readonly PanelLine[],
  flash: ReadonlySet<number>,
  lit: ReadonlySet<number>,
): string {
  const row = blocks.find((line) => line.text.includes(EXPOSED));
  if (row === undefined) return "";
  const slot = slotNumberOf(row.text);
  const hit = slot !== undefined && flash.has(slot);
  return [
    `<div class="web-expose"><div class="expose${hit ? " hit" : ""}">`,
    `<span class="lbl">${esc(t("panel.nextHit"))}</span>`,
    `<div class="row">${bars(row.text.trim())}</div>`,
    "</div></div>",
  ].join("");
}

/**
 * `[i] 2` in the top-left corner of the map, where the terminal puts it.
 *
 * A sibling of `web-expose` rather than something inside the schematic: both
 * are marks laid over the map at opposite corners, and the grid places them by
 * the same two properties. The look is written inline because the sheet
 * (`ui/web/styles.ts`) belongs to another task in this wave — everything it
 * uses is an existing custom property, so the badge changes colour with the
 * rest of the page and nothing has to be kept in step in two files.
 *
 * Empty when there is nothing unread: the corner goes back to being map.
 */
export function codexHtml(badge: string | undefined): string {
  if (badge === undefined) return "";
  const place = `style="grid-column:1;grid-row:2;align-self:start;justify-self:start;margin:8px 0 0 12px;z-index:2;pointer-events:none"`;
  const chip = `style="border:1px solid var(--accent);background:var(--amber-wash);border-radius:2px;padding:2px 8px;color:var(--accent);font-size:12px;font-weight:600;letter-spacing:.06em"`;
  return `<div class="web-codex" ${place}><div ${chip}>${esc(badge)}</div></div>`;
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
  if (slot !== undefined) classes.push("slot");
  if (line.text.includes(EXPOSED)) classes.push("is-exposed");
  if (hit) classes.push("hit");
  // The alert row carries its level as a class, so the sheet can colour the
  // ladder: nothing below three, amber at three and four, red and blinking at
  // the top (`styles.ts`, `.web-alert`).
  const alert = alertLevelOf(line.text);
  if (alert !== undefined) classes.push("web-alert", `is-l${alert}`);
  return `<div class="${classes.join(" ")}" style="color:${colour}">${bars(line.text)}</div>`;
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
    return [
      head,
      `<button type="button" class="${classes.join(" ")}" data-line="${i}">`,
      `<span class="key">${mark}${esc(action.key)}</span>`,
      `<span class="label">${esc(action.label)}</span>`,
      extra,
      "</button>",
    ].join("");
  });
  return `<div class="acts">${rows.join("")}</div>`;
}
