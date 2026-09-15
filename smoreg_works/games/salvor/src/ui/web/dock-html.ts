import type { RoomGame } from "@jamrog/engine";
import { HULLS } from "../../content/hulls.js";
import { t } from "../../i18n.js";
import { MAX_LEVEL } from "../../systems/alert.js";
import { currentDerelict, voyageOf } from "../../systems/voyage.js";
import { tugBoard } from "../tugboard.js";
import { esc } from "./xml.js";

/**
 * The tug's board as a page: what stands where the schematic does while the
 * drone is home (artboard 3c, docs/tasks/G89-festival.md, B2).
 *
 * The same lines the terminal prints (`tugBoard`), and not a word more than one:
 * the credits on hand, which the board leaves to the panel and the page puts
 * under the prices they are read against. The board already comes in groups
 * parted by a blank line — the tug and what it is tied to, that hull's state,
 * the rack, the mode — so the page takes the groups as they are and gives each
 * its own shape: a strip, a framed block, rows with an edge, a foot.
 */
export function dockHtml(game: RoomGame): string {
  const groups = groupsOf(tugBoard(game));
  const [head = [], hull = [], rack = []] = groups;
  // The stop's hulls stand between the rack and the mode line when there is a
  // jump to choose; the mode line is always last.
  const mode = groups.length > 3 ? groups[groups.length - 1]! : [];
  const next = groups.length > 4 ? groups[3]! : [];
  const [rackHead = "", ...hulls] = rack;
  const [nextHead = "", ...stops] = next;
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  // The hull's alert as an edge, from five up — the rungs where the ship
  // starts answering, coloured the way the panel colours them.
  const level = Math.min(state.alert, MAX_LEVEL);
  return [
    `<div class="dock">`,
    `<div class="dock-head"><span class="dock-tug">${esc(head.join(" "))}</span>`,
    `<span class="dock-mode">${esc(mode.join(" "))}</span></div>`,
    `<div class="dock-hull is-l${level}">`,
    ...hull.map((line, i) => `<div class="${lineClass(i, state.sold)}">${esc(line)}</div>`),
    `</div>`,
    `<div class="dock-rack"><div class="dock-rack-head">${esc(rackHead.trim())}</div>`,
    ...hulls.map((line, i) => rowHtml(line, HULLS[i]?.id === voyage.hull)),
    `</div>`,
    ...(next.length === 0
      ? []
      : [
          `<div class="dock-rack dock-next"><div class="dock-rack-head">${esc(nextHead.trim())}</div>`,
          ...stops.map((line) => `<div class="dock-line">${esc(line.trim())}</div>`),
          `</div>`,
        ]),
    `<div class="dock-cash">${esc(t("panel.credits", { n: voyage.credits }))}</div>`,
    `</div>`,
  ].join("");
}

/** The board's lines, cut at its blank ones. */
function groupsOf(lines: readonly string[]): string[][] {
  const out: string[][] = [[]];
  for (const line of lines) {
    if (line.trim().length === 0) out.push([]);
    else out[out.length - 1]!.push(line);
  }
  return out;
}

/** The hull's name, then what it is worth — green once it is under tow — then the sorties. */
function lineClass(index: number, sold: boolean): string {
  if (index === 0) return "dock-name";
  if (index === 1) return sold ? "dock-worth is-sold" : "dock-worth";
  return "dock-line";
}

/**
 * One hull on the rack as a row of columns. The board sets name, price and
 * trait apart with two spaces in every language (`board.hull`), which is the
 * seam the columns are cut on; the drone's own hull has two parts, and its
 * second spans the rest of the row.
 */
function rowHtml(line: string, yours: boolean): string {
  const cells = line.trim().split(/\s{2,}/);
  const cls = yours ? "dock-row is-yours" : "dock-row";
  return `<div class="${cls}">${cells.map((cell) => `<span>${esc(cell)}</span>`).join("")}</div>`;
}
