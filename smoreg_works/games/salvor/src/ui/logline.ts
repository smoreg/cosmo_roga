import type { LogLine } from "@jamrog/engine";
import type { Key } from "../content/i18n/keys.js";
import { machineName } from "../content/monsters.js";
import { doorStateWord } from "../content/words.js";
import { t, type Params } from "../i18n.js";
import { capitalize } from "../names.js";
import { SCREEN_HEIGHT } from "./theme.js";

/**
 * The lines the engine writes, said in the language that is on.
 *
 * The engine may not know a word of Russian: `packages/` never imports from
 * `games/`, so it has no table to look anything up in and its combat, its doors
 * and its cover were English in every run of the game (docs/tasks/G55, 12-13).
 * Teaching it the words was never an option; what it can do is say *what*
 * happened instead of only *how it is worded* — `LogLine.key` and the values
 * the sentence was built from — and let the game write the sentence.
 *
 * So the English the engine composes is a fallback, not the line: a game with
 * no table prints it as-is, and this one rebuilds the sentence from the key
 * every time the log is drawn. Drawn, rather than added — which is why pressing
 * `L` mid-run translates the lines already on screen instead of leaving a
 * bilingual log behind.
 */

/**
 * Every event the engine names that this game has words for.
 *
 * Written out rather than matched by prefix for two reasons: a key the table
 * has no row for would render as its own English fallback with no warning, and
 * `Key` makes each of these a compile error until all three languages have the
 * row. It is also what tells `tests/i18n.test.ts` these rows are in use — the
 * only place in the game that mentions them is here.
 */
export const ENGINE_KEYS = [
  "engine.hit.you",
  "engine.hit.taken",
  "engine.hit.other",
  "engine.dies",
  "engine.cover.you",
  "engine.cover.other",
  "engine.door.open",
  "engine.door.breached",
  "engine.door.cut.you",
  "engine.door.cut.other",
  "engine.fail.airlock",
  "engine.fail.attack.ally",
  "engine.fail.attack.away",
  "engine.fail.attack.gone",
  "engine.fail.attack.sight",
  "engine.fail.cover",
  "engine.fail.door.elsewhere",
  "engine.fail.door.gone",
  "engine.fail.door.shut",
  "engine.fail.door.size",
  "engine.fail.leave.none",
  "engine.fail.leave.other",
  "engine.fail.nothing",
  "engine.fail.over",
] as const satisfies readonly Key[];

const KNOWN = new Set<string>(ENGINE_KEYS);

/** Parameters naming a machine. The engine passes the id it spawned it under. */
const NAMED = new Set(["actor", "target"]);

/**
 * One line of the log, as the player reads it.
 *
 * A line the game composed itself is already in the language that is on and is
 * handed back untouched: the keys above are the engine's, and nothing else is
 * rebuilt. Values are optional — half the engine's lines are one sentence with
 * no holes in it.
 */
export function logText(line: LogLine): string {
  if (line.key === undefined || !KNOWN.has(line.key)) return line.text;
  return t(line.key as Key, said(line.params ?? {}));
}

/**
 * The engine's values in words: `{ actor: "scout" }` becomes `разведчик` and
 * `Разведчик`.
 *
 * Both cases, because which one a row needs is a fact about the sentence and
 * not about the machine — `{Actor}: попадание` opens a sentence and `Удар:
 * {target}` sits inside one, and neither the engine nor this function can know
 * which of them a translator will write. A row picks the case it needs by the
 * name it asks for.
 */
function said(params: Readonly<Record<string, string | number>>): Params {
  const out: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (NAMED.has(name)) {
      const phrase = t("label.other", { name: machineName(String(value)) });
      out[name] = phrase;
      out[capitalize(name)] = capitalize(phrase);
    } else if (name === "state") {
      out[name] = doorStateWord(String(value) as Parameters<typeof doorStateWord>[0]);
    } else {
      out[name] = value;
    }
  }
  return out;
}

// -------------------------------------------------- how old a line looks

/**
 * How far back a log line is, counted in turns rather than in lines.
 *
 * `fresh` is everything that happened on the newest turn the log holds,
 * `recent` the turn before it, `old` the rest.
 */
export type LogFade = "fresh" | "recent" | "old";

/**
 * The tone a line the engine may not know about yet.
 *
 * `alarm` is G71's, and this file has to survive both sides of that merge: a
 * `LogLine["tone"]` without the member makes `line.tone === "alarm"` a
 * comparison TypeScript refuses to compile, so the word is held as a plain
 * string and the union is widened to meet it. When the member lands the
 * comparison keeps meaning what it means now.
 */
const ALARM: string = "alarm";

/**
 * Which lines are still bright, decided by the turn they were written on.
 *
 * The count used to be three, in both renderers, and three is not a unit of
 * anything: a turn where the drone fired, was answered, heard something and
 * watched the alert climb writes five lines, and two of them were grey before
 * the player had read them (docs/gui-guides.md, "Что применить", A). A turn is
 * the unit the player acts in, so a turn is what the fading counts — every line
 * of the newest one at full strength, the one before it half, everything older
 * out of the way.
 *
 * Ranked by distinct turn rather than by `turn - 1`, because "the previous
 * turn" means the previous turn that said anything: a run where nothing
 * happened for six turns must not push the last thing that did into the dark.
 *
 * An `alarm` line never fades at all. It is the one tone the game raises to
 * interrupt, and a raised alert is still true three turns later.
 */
export function logFades(lines: readonly LogLine[]): LogFade[] {
  const turns = [...new Set(lines.map((line) => line.turn))].sort((a, b) => b - a);
  const rank = new Map(turns.map((turn, i) => [turn, i] as const));
  return lines.map((line) => {
    if (line.tone === ALARM) return "fresh";
    const at = rank.get(line.turn) ?? 0;
    return at === 0 ? "fresh" : at === 1 ? "recent" : "old";
  });
}

/** True where a line opens a turn the line above it did not belong to. */
export function opensTurn(lines: readonly LogLine[], i: number): boolean {
  const before = lines[i - 1];
  return before !== undefined && before.turn !== lines[i]!.turn;
}

// ------------------------------------------------------------ the history

/**
 * Lines the history card can reach: the whole of what `MessageLog` keeps.
 *
 * The log holds 200 and the screen shows seven of them, so 193 lines of a run
 * were unreachable the moment they scrolled — the ASCII view, which is the one
 * that starts, had no history at all (docs/gui-guides.md, §5, "Lookback").
 */
export const HISTORY_LINES = 200;

/**
 * Rows of the history card that hold log lines.
 *
 * The same arithmetic the help card does — eight rows to the frame, the title,
 * the footer and the air around them (`HELP_ROWS`) — and it lives here rather
 * than beside the drawing it sizes, because the reducer has to know how many
 * pages there are to page through and `ui/render.ts` already imports the
 * reducer. A screen fact in the file that owns the lines is a plain import; the
 * other way round is a cycle, and under ESM a cycle is a crash waiting for one
 * more edge (.claude/CLAUDE.md, "Как добавить контент").
 */
export const HISTORY_ROWS = SCREEN_HEIGHT - 8;

/**
 * The log as a card, cut into pages with the newest first.
 *
 * Page 0 is the bottom of the log, which is where a player who just pressed
 * `PageUp` is looking, and every page after it is further back. Cut from the
 * end for that reason: a remainder belongs on the oldest page, where nobody is
 * counting rows, and not on the one that has to line up with the log itself.
 */
export function historyPages(lines: readonly LogLine[], rows: number): string[][] {
  const text = lines
    .slice(Math.max(0, lines.length - HISTORY_LINES))
    .map((line) => logText(line) + (line.count > 1 ? ` (x${line.count})` : ""));
  if (text.length === 0) return [[t("log.empty")]];
  const size = Math.max(1, rows);
  const pages: string[][] = [];
  for (let end = text.length; end > 0; end -= size) {
    pages.push(text.slice(Math.max(0, end - size), end));
  }
  return pages;
}
