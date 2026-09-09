import { EN } from "./content/i18n/en.js";
import { ES } from "./content/i18n/es.js";
import { RU } from "./content/i18n/ru.js";
import type { Key, Table } from "./content/i18n/keys.js";

/**
 * Three languages, one table, and no branch anywhere else in the game.
 *
 * The rule the owner asked for is the whole design: nothing outside
 * `content/i18n/` may ask which language is on. A system that wrote
 * `if (lang === "ru")` would be a system every future language has to be
 * merged back into, so the only thing a caller ever does is name what it wants
 * to say — `t("log.door.cut.done", { door })` — and the table answers in
 * whichever language is current. Adding a fourth language is a fourth file and
 * one entry in `LANGS`.
 *
 * `EN` is the source of keys: `Key` is `keyof typeof EN`, and `ES`/`RU` are
 * typed `Record<Key, string>`, so a key added to English and forgotten in
 * Spanish is a compile error rather than a hole a player finds.
 *
 * Nothing here touches the DOM at import time. `t` is called from the systems,
 * which run under vitest with no window at all, and the one function that does
 * reach for `localStorage` guards it and shrugs off a refusal.
 */

export const LANGS = ["en", "es", "ru"] as const;

export type Lang = (typeof LANGS)[number];

/** What a message may be handed: numbers to print, names already in language. */
export type Params = Readonly<Record<string, string | number>>;

const TABLES: Record<Lang, Table> = { en: EN, es: ES, ru: RU };

/** The language a session starts in before anything says otherwise. */
export const DEFAULT_LANG: Lang = "en";

/** The only thing this game keeps between runs — no progress, ever. */
export const LANG_STORAGE_KEY = "salvor.lang";

let current: Lang = DEFAULT_LANG;

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

export function currentLang(): Lang {
  return current;
}

/**
 * Switch, and remember. The write is best-effort: a browser with storage turned
 * off still gets the language it asked for, it just gets English again next
 * time, and that is a better failure than a game that will not start.
 */
export function setLang(lang: Lang): void {
  current = lang;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Private mode, or storage disabled. The language is still set.
  }
}

/** `L`, on any screen: the next language round the ring. */
export function cycleLang(): Lang {
  const next = LANGS[(LANGS.indexOf(current) + 1) % LANGS.length]!;
  setLang(next);
  return next;
}

/**
 * Which language a session opens in: the URL first, then what was remembered.
 *
 * The URL wins so that `?lang=es` in a bug report or a jam comment shows the
 * same screen to whoever opens it, whatever their own last choice was — the
 * same contract `?seed=` already keeps.
 */
export function resolveLang(search: string, stored: string | null): Lang {
  const asked = new URLSearchParams(search).get("lang");
  if (isLang(asked)) return asked;
  if (isLang(stored)) return stored;
  return DEFAULT_LANG;
}

/** The boot path: read the URL and the store, and set the language from them. */
export function initLang(search: string): Lang {
  let stored: string | null = null;
  try {
    if (typeof localStorage !== "undefined") stored = localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    // Same as above: unreadable storage is simply no preference.
  }
  const lang = resolveLang(search, stored);
  setLang(lang);
  return lang;
}

/**
 * One line of the game, in the language that is on.
 *
 * A missing row falls back to English rather than throwing: the types make a
 * missing row impossible to compile, and if one ever gets in anyway a player
 * should read an English sentence, not watch the run die on a turn.
 */
export function t(key: Key, params?: Params): string {
  const pattern = TABLES[current][key] ?? EN[key];
  return fill(pattern, params, current);
}

/**
 * The same, in a language the caller names. For tests, and for the one place
 * that has to print three languages at once: the title's `EN · ES · RU`.
 */
export function tIn(lang: Lang, key: Key, params?: Params): string {
  const pattern = TABLES[lang][key] ?? EN[key];
  return fill(pattern, params, lang);
}

/**
 * A row named by a content id: `tId("machine", "security-unit", …)`.
 *
 * The catalogues — compartments, machines, modules, hulls, derelict classes —
 * are already tables with ids in them, and writing out a second table that
 * maps each id to its key would be the same list twice, kept in step by hand.
 * So the family is addressed by prefix, and `tests/i18n.test.ts` walks each
 * catalogue asserting that every id in it has a row in all three languages —
 * which is the check the type system would have given us, done where the ids
 * actually live.
 *
 * `or` is what a caller shows if a row is missing: always the English content
 * the catalogue already carries, never a key printed at a player.
 */
export function tId(prefix: string, id: string, or: string, params?: Params): string {
  const key = `${prefix}.${id}` as Key;
  const pattern = TABLES[current][key] ?? EN[key];
  return pattern === undefined ? or : fill(pattern, params, current);
}

// ------------------------------------------------------------- the mini format

/**
 * `{name}` and `{n, one: door, other: doors}` — the whole syntax, and
 * deliberately no library.
 *
 * ICU message format is a parser, a locale database and a dependency, and this
 * game needs exactly two things out of it: put a value here, and pick a word by
 * a count. Both fit in thirty lines, both are tested, and neither can pull a
 * megabyte of CLDR into a jam build. A form may not contain `,`, `:` or a
 * brace — everything the game says is short enough for that to be no loss.
 */
const FIELD = /\{([^{}]+)\}/g;

/** Plural categories used by the tables. Russian needs three of them. */
type PluralForm = "one" | "few" | "many" | "other";

/** Tried in this order when a table left the exact category out. */
const FALLBACK: readonly PluralForm[] = ["other", "many", "few", "one"];

function fill(pattern: string, params: Params | undefined, lang: Lang): string {
  if (!pattern.includes("{")) return pattern;
  return pattern.replace(FIELD, (whole, body: string) => {
    const comma = body.indexOf(",");
    if (comma < 0) {
      const value = params?.[body.trim()];
      return value === undefined ? whole : String(value);
    }
    const count = Number(params?.[body.slice(0, comma).trim()]);
    if (!Number.isFinite(count)) return whole;
    return chooseForm(body.slice(comma + 1), pluralForm(lang, count), count) ?? whole;
  });
}

/**
 * `one: дверь, few: двери, many: дверей` → the form for this category.
 *
 * `#` inside a form is the count itself, the way ICU spells it: forms are not
 * scanned for `{…}` again, so a plural that has to print its own number —
 * `other: # machines seize` — says `#` and gets it filled in here.
 */
function chooseForm(spec: string, want: PluralForm, count: number): string | undefined {
  const forms = new Map<string, string>();
  for (const part of spec.split(",")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    forms.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  const picked = forms.get(want) ?? FALLBACK.map((f) => forms.get(f)).find((v) => v !== undefined);
  const form = picked ?? forms.values().next().value;
  return form === undefined ? undefined : form.replace(/#/g, String(count));
}

/**
 * Which form a count takes. English and Spanish agree — one, or not one — and
 * Russian is the usual three: 1 дверь, 2 двери, 5 дверей, and 11–14 back to
 * the third whatever their last digit says.
 */
function pluralForm(lang: Lang, n: number): PluralForm {
  if (lang !== "ru") return n === 1 ? "one" : "other";
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 14) return "many";
  const ones = abs % 10;
  if (ones === 1) return "one";
  if (ones >= 2 && ones <= 4) return "few";
  return "many";
}
