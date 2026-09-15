import { afterAll, describe, expect, it } from "vitest";
import { Rng, type RoomGame } from "@jamrog/engine";
import { BOTS_ROOMS, seedRange } from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";
import { EN } from "../src/content/i18n/en.js";
import { ES } from "../src/content/i18n/es.js";
import { RU } from "../src/content/i18n/ru.js";
import type { Key } from "../src/content/i18n/keys.js";
import { CODEX, CODEX_IDS } from "../src/content/codex.js";
import { CALLSIGNS } from "../src/content/derelicts.js";
import { TUG_CALLSIGNS } from "../src/content/hints.js";
import { TUTORIAL_SEED } from "../src/content/tutorial.js";
import { isTug } from "../src/content/tug.js";
import { DEFAULT_LANG, setLang, t, type Lang } from "../src/i18n.js";
import { roomActions, type Action } from "../src/ui/actions.js";
import { initialState, type AppState, type Overlay } from "../src/ui/appstate.js";
import { codexBody, codexHeading, helpPages } from "../src/ui/input.js";
import { logText } from "../src/ui/logline.js";
import { panelBlocks } from "../src/ui/panel.js";
import { endHint, endingBanners, restartHint, runSummary } from "../src/ui/render.js";
import { schematic } from "../src/ui/schematic.js";
import { bannerLine, schematicInputOf } from "../src/ui/schematic-input.js";
import { titleLines } from "../src/ui/title.js";
import { tugBoard } from "../src/ui/tugboard.js";
import { screenHtml } from "../src/ui/web/index.js";
import { VIEWS } from "../src/ui/view.js";

/**
 * Everything a player can read, in the language they did not ask for
 * (docs/tasks/G89-festival.md, C2).
 *
 * The jam's voters read English, and a Russian word on an English screen is a
 * bug report nobody writes — they close the tab. The tables are typed, so a
 * missing row cannot compile; what can still leak is a string that never went
 * through a table: a literal in a system, a catalogue's fallback, the engine's
 * own English. So the check is made on what is drawn, not on what is written.
 * Bots fly real voyages and training runs, and every frame they pass through is
 * read the way both views read it — the terminal's panel, lists, schematic and
 * log, and the HTML of the graph and the honeycomb with their cards — one line
 * at a time.
 *
 * It found two: the panel's `JAMMED`, a literal in `systems/jam.ts` printed in
 * English on Spanish and Russian screens alike, and the codex titles of the
 * four virus strains, which kept the English strain name inside a Spanish and
 * a Russian title.
 */

afterAll(() => setLang(DEFAULT_LANG));

const SEEDS = seedRange(1, 50);
const BOTS = ["careful", "random"] as const;
const STEPS = 400;
/** Every n-th turn is read in full. */
const EVERY = 25;

const IDLE: AppState = { ...initialState(), overlay: "none" };

interface Swept {
  /** Lines read, repeats included. */
  readonly read: number;
  readonly lines: ReadonlySet<string>;
}

const swept = new Map<Lang, Swept>();

/** One sweep per language, shared by the checks below. */
function sweptIn(lang: Lang): Swept {
  const done = swept.get(lang);
  if (done !== undefined) return done;
  const fresh = sweep(lang);
  swept.set(lang, fresh);
  return fresh;
}

function sweep(lang: Lang): Swept {
  setLang(lang);
  const lines = new Set<string>();
  let read = 0;
  const take = (texts: readonly string[]): void => {
    for (const text of texts) {
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (line.length === 0) continue;
        read++;
        lines.add(line);
      }
    }
  };

  for (const view of VIEWS) {
    for (const sound of [true, false]) {
      const settings = { view, sound, seed: TUTORIAL_SEED };
      take(titleLines(settings));
      take([visible(screenHtml(newGame(1), { ...initialState(settings), overlay: "title" }, new Set()))]);
    }
  }

  for (const training of [false, true]) {
    for (const bot of BOTS) {
      for (const seed of training ? [TUTORIAL_SEED, ...SEEDS] : SEEDS) {
        const play = BOTS_ROOMS[bot]!();
        const game = newGame(seed, training);
        const rng = new Rng(seed ^ 0x5bf03635);
        for (let step = 0; step < STEPS && !game.isOver(); step++) {
          if (step % EVERY === 0) take(frame(game));
          if (!game.playerCommand(play(game, rng)).ok) game.playerCommand({ kind: "wait" });
        }
        take(frame(game));
        take(cards(game));
      }
    }
  }
  return { read, lines };
}

/** One frame: the lists one level down too, the panel, the schematic, both web views, the log. */
function frame(game: RoomGame): string[] {
  const out: string[] = [];
  const lists: Action[][] = [roomActions(game)];
  if (isTug(game)) {
    for (const verb of ["buy", "repair", "graft", "stow", "fit", "sell", "jump"]) lists.push(roomActions(game, verb));
  } else {
    lists.push(roomActions(game, undefined, true));
    for (const door of game.ship.doorsOf(game.roomOf(game.player).id)) lists.push(roomActions(game, door.id));
  }
  for (const list of lists) {
    for (const a of list) out.push(a.label, a.extra ?? "", a.head ?? "", a.why ?? "");
  }
  out.push(...panelBlocks(game, lists[0]!, 0).map((l) => l.text), bannerLine(game));
  if (isTug(game)) out.push(...tugBoard(game));
  out.push(...schematic(schematicInputOf(game)).lines.map((l) => l.text));
  for (const map of ["graph", "hex"] as const) out.push(visible(screenHtml(game, IDLE, new Set(), undefined, map)));
  // `?tiles=1`: pictures in place of letters, each with a `<title>` a hover shows.
  out.push(visible(screenHtml(game, IDLE, new Set(), undefined, "hex", false, true, true)));
  out.push(...game.log.lines.map(logText));
  return out;
}

/** What a run ends on and what a player opens: help, codex, history, the four endings. */
function cards(game: RoomGame): string[] {
  const out: string[] = [];
  for (const overlay of ["help", "history", "dead", "won", "lost", "sold"] as Overlay[]) {
    out.push(visible(screenHtml(game, { ...IDLE, overlay }, new Set())));
  }
  const seen = CODEX_IDS.map((id) => t(CODEX[id]!.title));
  for (const onTug of [true, false]) out.push(...helpPages(onTug, seen).flat());
  for (const id of CODEX_IDS) out.push(codexHeading(CODEX[id]!), ...codexBody(CODEX[id]!, new Set()));
  for (const [overlay, e] of Object.entries(endingBanners())) {
    out.push(e!.title, e!.why ?? "", endHint(overlay as Overlay));
  }
  out.push(runSummary(game), restartHint());
  return out;
}

/** The text a browser shows for a fragment: every tag a line break, entities decoded. */
function visible(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "\n")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Words Spanish shares with English on purpose: the same word in both
 * (`REACTOR`, `TERMINAL`, `RIVAL`, `SENSOR`, `base`), the shortenings a panel
 * column keeps (`LAB`, `EVAC`, `reac`), and the names nobody translates
 * (`SALVOR`, `ASCII`). Anything else identical to English is a row somebody
 * forgot. (`SENSOR` is English only once the schematic's seven columns have cut
 * `SENSOR BAY` down to it.)
 */
const SHARED_WORDS = /\b(REACTOR|TERMINAL|RIVAL|SENSOR|LAB|EVAC|SALVOR|ASCII|base|reac)\b/g;

/**
 * What is never translated and so may stand alone on a line of its own: the
 * hulls' and tugs' callsigns, which are names (design-doc.md, "Языки"), and the
 * names of keys as the keyboard prints them.
 */
const NAMES = new RegExp(
  `\\b(${[...CALLSIGNS, ...TUG_CALLSIGNS].join("|")}|shift|tab|PgUp|PgDn|esc|enter)\\b`,
  "g",
);

/** A line or a row that still reads as English once numbers, labels, names and shared words are gone. */
function reads(text: string): boolean {
  const bare = text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\b[a-z]\d+\b|\bCR\b/g, "")
    .replace(NAMES, "")
    .replace(SHARED_WORDS, "");
  return /[A-Za-z]{3}/.test(bare);
}

describe("no Russian on an English or a Spanish screen", () => {
  for (const lang of ["en", "es"] as const) {
    it(`reads ${SEEDS.length} voyages and ${SEEDS.length + 1} training runs in ${lang}, and finds no Cyrillic`, () => {
      const { read, lines } = sweptIn(lang);
      const cyrillic = [...lines].filter((l) => CYRILLIC.test(l));
      console.log(`${lang}: ${read} lines read, ${lines.size} distinct, ${cyrillic.length} with Cyrillic`);
      expect(read).toBeGreaterThan(500_000);
      expect(cyrillic).toEqual([]);
    }, 300_000);
  }
});

describe("nothing left in English on a Spanish or a Russian screen", () => {
  it("draws no line in Spanish or Russian that an English run draws word for word", () => {
    // The engine's own English, a fallback name, a literal in a system: each
    // reads identically in both runs, because the runs are the same run — the
    // language changes the words and nothing else (`tests/i18n.test.ts`).
    const english = sweptIn("en").lines;
    for (const lang of ["es", "ru"] as const) {
      const shared = [...sweptIn(lang).lines].filter((l) => english.has(l) && reads(l));
      console.log(`${lang}: ${shared.length} lines identical to the English run`);
      expect(shared, lang).toEqual([]);
    }
  }, 300_000);

  /**
   * And no English word inside a Russian line: a line can be Russian and still
   * carry one, which the check above cannot see. It found the codex titles of
   * the four strains — `ВИРУС SPASM` over a panel that calls it `СУДОРОГА`.
   * What may stay Latin: names, keys, the language codes, the door and
   * compartment labels, the credit mark, the address-bar settings and the view
   * names typed into them, and the jam's own credit line.
   */
  it("prints no English word on a Russian screen but a name or a key", () => {
    const latin = [...sweptIn("ru").lines].filter((l) =>
      /[A-Za-z]{2}/.test(
        l
          .replace(NAMES, "")
          .replace(/\b[a-z]\d+\b|\bCR\b|\?[a-z]+=\S*|\[i\]/g, "")
          .replace(/\b(SALVOR|ASCII|EN|ES|RU|web|hex|Tab|Enter|roguetemple's|Fortnight|smoreg)\b/g, ""),
      ),
    );
    expect(latin).toEqual([]);
  }, 300_000);

  it("has no row in Spanish or Russian that is the English one word for word", () => {
    const tables = { es: ES, ru: RU };
    for (const lang of ["es", "ru"] as const) {
      const same = (Object.keys(EN) as Key[]).filter((k) => tables[lang][k] === EN[k] && reads(EN[k]));
      expect(same, lang).toEqual([]);
    }
  });
});
