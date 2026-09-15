/**
 * Every word the game says, looked up and filled in.
 *
 * It used to be three tables and a language switch. It is one table now — the
 * game says what `content/i18n/en.ts` says, and nothing chooses between
 * languages at runtime because there is nothing to choose between. What is
 * kept is the lookup and the two pieces of formatting the game actually uses:
 * put a value here, and pick a word by a count.
 *
 * Those two are kept rather than inlined at the call sites because neither can
 * be. A plural has to look at a number that is not known until the line is
 * written, and `tId` is addressed by a content id, so what it prints is
 * decided by the catalogue rather than by the code asking. Three hundred-odd
 * fixed strings could become literals; these cannot, and a table that half the
 * game still reads is a table.
 */

import { EN } from "./content/i18n/en.js";
import type { Key } from "./content/i18n/keys.js";

/** Values a line interpolates: `{name}` and the count of a `{n, …}` form. */
export type Params = Readonly<Record<string, string | number>>;

/** What the game says for a key. */
export function t(key: Key, params?: Params): string {
  return fill(EN[key], params);
}

/**
 * A row named by a content id: `tId("machine", "security-unit", …)`.
 *
 * The catalogues — compartments, machines, modules, hulls, derelict classes —
 * are already tables with ids in them, and a second table mapping each id to a
 * key would be the same list twice, kept in step by hand. So the family is
 * addressed by prefix, and a row the catalogue has not got falls back to the
 * word the caller brought.
 */
export function tId(prefix: string, id: string, or: string, params?: Params): string {
  const pattern = (EN as Record<string, string | undefined>)[`${prefix}.${id}`];
  return pattern === undefined ? or : fill(pattern, params);
}

// ------------------------------------------------------------- the mini format

/**
 * `{name}` and `{n, one: door, other: doors}` — the whole syntax, and
 * deliberately no library.
 *
 * ICU message format is a parser, a locale database and a dependency, and this
 * game needs exactly two things out of it. Both fit in twenty lines, both are
 * tested, and neither can pull a megabyte of CLDR into a build. A form may not
 * contain `,`, `:` or a brace — everything the game says is short enough for
 * that to be no loss.
 */
const FIELD = /\{([^{}]+)\}/g;

function fill(pattern: string, params: Params | undefined): string {
  if (!pattern.includes("{")) return pattern;
  return pattern.replace(FIELD, (whole, body: string) => {
    const comma = body.indexOf(",");
    if (comma < 0) {
      const value = params?.[body.trim()];
      return value === undefined ? whole : String(value);
    }
    const count = Number(params?.[body.slice(0, comma).trim()]);
    if (!Number.isFinite(count)) return whole;
    return chooseForm(body.slice(comma + 1), count) ?? whole;
  });
}

/**
 * `one: door, other: doors` → the form this count takes.
 *
 * `#` inside a form is the count itself, the way ICU spells it: forms are not
 * scanned for `{…}` again, so a plural that has to print its own number —
 * `other: # machines seize` — says `#` and gets it filled in here.
 *
 * English is one, or not one. The three-way Russian rule went with the Russian
 * table; if a language ever comes back, it comes back here.
 */
function chooseForm(spec: string, count: number): string | undefined {
  const forms = new Map<string, string>();
  for (const part of spec.split(",")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    forms.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  const want = count === 1 ? "one" : "other";
  const form = forms.get(want) ?? forms.get("other") ?? forms.values().next().value;
  return form === undefined ? undefined : form.replace(/#/g, String(count));
}
