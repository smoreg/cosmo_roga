import type { LogLine } from "@jamrog/engine";
import type { Key } from "../content/i18n/keys.js";
import { machineName } from "../content/monsters.js";
import { doorStateWord } from "../content/words.js";
import { t, type Params } from "../i18n.js";
import { capitalize } from "../names.js";

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
