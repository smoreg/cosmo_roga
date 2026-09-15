import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The graph simulation is not allowed to know what time it is, what the
 * operating system's random number generator says, or that a browser exists.
 *
 * Everything this package promises rests on that: `?seed=N` reproduces a run
 * for a bug report, the recorded voyages in `replay.test.ts` stay recorded, the
 * persistence property in `persistence.test.ts` can compare two entries into
 * one derelict, and half the suite can assert an exact number. One
 * `Math.random()` in a machine's behaviour silently ends all of it, and nothing
 * else in the suite fails — which is why the check is a scan and not a
 * behaviour.
 *
 * `games/fortnight2/tests/purity.test.ts` does the same for the grid game and
 * `packages/engine/src/sim`. The two lists are disjoint on purpose: a game's
 * own test names the directories that game's rules live in, so deleting a game
 * takes its scan with it.
 *
 * Reading files with `fs` is fine here: this is a test, not the sim.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The turn cycle on the graph, and every rule SALVOR writes on top of it. */
const SIM_DIRS = [
  "packages/engine/src/rooms",
  "games/salvor/src/content",
  "games/salvor/src/twist",
  "games/salvor/src/systems",
];

/** What a deterministic, DOM-free simulation may never reach for. */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bMath\s*\.\s*random\b/, why: "use game.rng" },
  { pattern: /\bDate\s*\.\s*now\b/, why: "use game.schedule.time" },
  { pattern: /\bperformance\s*\.\s*now\b/, why: "use game.schedule.time" },
  { pattern: /\bdocument\b/, why: "rules have no DOM; render them from data" },
  { pattern: /\bwindow\b/, why: "rules have no DOM; the UI owns timers" },
  { pattern: /\blocalStorage\b/, why: "rules have no DOM; the UI owns storage" },
  // Node's globals are typed repo-wide so tests can read files. Nothing that
  // ships in the bundle may touch them, and the type checker will not say so.
  { pattern: /\bprocess\s*\./, why: "the rules run in a browser too" },
  { pattern: /\brequire\s*\(/, why: "the rules are ES modules only" },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/**
 * Blank out comments, keeping line breaks so line numbers still line up.
 *
 * Without this the check fails on the doc comment that states the rule — and a
 * rule you cannot write down is worse than one you cannot test. Three files
 * under scan say "window", "process" or "Date.now" in prose today.
 */
function code(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (two === "/*") {
      while (i < source.length && source.slice(i, i + 2) !== "*/") { out += source[i] === "\n" ? "\n" : " "; i++; }
      out += "  ";
      i += 2;
      continue;
    }
    const ch = source[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      // Strings are code, not prose: copy them through, escapes included.
      out += ch;
      i++;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") { out += source[i]; i++; }
        if (i < source.length) { out += source[i]; i++; }
      }
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

describe("the graph simulation stays pure", () => {
  it("reaches for no clock, no OS randomness and no DOM", () => {
    const offences: string[] = [];

    for (const dir of SIM_DIRS) {
      for (const file of tsFiles(join(ROOT, dir))) {
        const lines = code(readFileSync(file, "utf8")).split("\n");
        lines.forEach((line, n) => {
          for (const { pattern, why } of FORBIDDEN) {
            if (pattern.test(line)) {
              offences.push(`${relative(ROOT, file)}:${n + 1}: ${pattern.source} — ${why}\n    ${line.trim()}`);
            }
          }
        });
      }
    }

    expect(offences, `\n${offences.join("\n")}\n`).toEqual([]);
  });

  it("is actually looking at the files it claims to", () => {
    // A scanner that silently walks an empty tree passes forever. Guard it.
    const counts = SIM_DIRS.map((d) => tsFiles(join(ROOT, d)).length);
    expect(counts.every((n) => n > 0), `empty source dirs: ${SIM_DIRS.filter((_d, i) => counts[i] === 0)}`).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(25);
  });

  it("still catches a violation the comment stripper might hide", () => {
    const sample = code([
      "// Math.random() in a comment is fine.",
      "/* and Date.now() in a block comment too */",
      "const roll = Math.random();",
    ].join("\n")).split("\n");

    expect(sample.filter((l) => /\bMath\s*\.\s*random\b/.test(l))).toEqual(["const roll = Math.random();"]);
    expect(sample.some((l) => /\bDate\s*\.\s*now\b/.test(l))).toBe(false);
  });

  it("the rules never import the renderer", () => {
    // The other half of the same boundary, and the one a scan is the only way
    // to keep: `src/content` and `src/systems` reading `src/ui` type-checks
    // perfectly and makes every rule below depend on how it is drawn.
    //
    // No exception left for `ui/theme.ts`: the colours it re-exports for the
    // renderer now live as data in `content/palette.ts`, which is what a rule
    // that needs one imports instead (`twist/rig.ts`, `systems/alert.ts`).
    const RENDERER = /from\s+["'][^"']*\bui\//;
    const offences: string[] = [];
    for (const dir of ["games/salvor/src/content", "games/salvor/src/systems", "games/salvor/src/twist"]) {
      for (const file of tsFiles(join(ROOT, dir))) {
        const source = code(readFileSync(file, "utf8"));
        if (RENDERER.test(source)) offences.push(relative(ROOT, file));
      }
    }
    expect(offences).toEqual([]);
  });
});

// ------------------------------------------------- and speaks no English of its own

/**
 * The other thing SALVOR's rules may not contain: a sentence.
 *
 * Every word the player reads comes out of `src/content/i18n` through `t()`
 * (`docs/tasks/G39-i18n.md`), so a string literal with a space and a letter in
 * it, anywhere in the rules or the screen, is a line one third of the players
 * would read in the wrong language. The scan is here rather than in
 * `i18n.test.ts` for the same reason the two above are: it is a rule about what
 * the source may contain, and nothing else in the suite would ever notice.
 *
 * `src/content/i18n` is the table itself and is not scanned. `src/ui` is,
 * although the task only asked for the rules: it is where half the words are
 * drawn, and it costs three entries on the list below.
 */
const WORDED_DIRS = [
  "games/salvor/src/systems",
  "games/salvor/src/twist",
  "games/salvor/src/content",
  "games/salvor/src/ui",
];

/**
 * Literals the scan lets through, each for a stated reason. Anything not on
 * this list and not covered by a rule below is a sentence somebody left behind.
 */
const ALLOWED_TEXT = new Set([
  // A card id the deck indexes by; `content/cards.ts` holds the same string.
  "docking bay",
  // The competitor's drone is spawned by its own system and named there; the
  // screen reads it through `machineName`, which has a row for it.
  "rival drone",
  // The language row on the title card. The tags after it are ISO codes and
  // are the one thing on the screen that must read the same in all three.
  "L  ",
  // Font stacks and CSS class lists: the graphic view's own vocabulary is
  // markup, and every word it shows comes from the terminal view's functions.
  "ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace",
  "DejaVu Sans Mono",
  // The two faces the graphic view is set in, vendored into `assets/fonts` and
  // declared by `@font-face` (G91 A). A family name is what a font calls
  // itself: the same string in every language, and matched on by the browser
  // rather than read by a player (`assets/CREDITS.md`).
  "Barlow Condensed",
  "IBM Plex Mono",
  "glyph hostile",
  // A media query, which is CSS the app asks a question with rather than
  // anything the player reads: whether this browser wants less motion, which
  // decides whether the appearance pulse blinks or merely colours (`ui/pulse.ts`).
  "(prefers-reduced-motion: reduce)",
  "card ",
  " (x)",
  // `.replace(/</g, "…")` read as a string by a line-based scanner.
  "/g, ",
  // Callsigns are proper nouns: a hull is called the same thing in every
  // language, the way `SALVOR` is (`src/content/i18n/README.md`). Both lists:
  // the derelicts' in `content/derelicts.ts` and the tug's in `content/hints.ts`.
  "BRIGHT ANCHOR",
  "SIX OF SWORDS",
  "PALE HORSE",
  "DEAD RECKONING",
  "LONG WINTER",
  "SALT DRIFTER",
  "COLD LANTERN",
  "GREY HARROW",
  "LAST FERRY",
  "IRON WIDOW",
  "STILL HARBOUR",
]);

/**
 * One line of a catalogue is allowed to hold English: the `name` a machine is
 * identified by, the `trait` and `flavour` rows that are the table's fallback,
 * and an id used as an object key. Every one of those has a companion check in
 * `i18n.test.ts` proving all three languages answer for it.
 */
function allowedText(line: string, quoted: string, stripped: string): boolean {
  if (ALLOWED_TEXT.has(quoted) || ALLOWED_TEXT.has(stripped)) return true;
  // Markup is not prose. The graphic view (G42) is built out of HTML and SVG
  // and draws the very lines the terminal view builds — `panelBlocks`,
  // `helpBody`, `titleLines`, `bannerLine` — so a tag, an attribute or a path
  // is structure, and the words inside it came through `t()` upstream.
  if (/[<>]/.test(stripped) || /\w="/.test(stripped)) return true;
  if (/^[\s\dMLCZ.,+-]+$/.test(stripped)) return true;
  if (/\bthrow new Error\(/.test(line)) return true;
  const escaped = quoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`"${escaped}"\\s*:`).test(line)) return true;
  return /\b(name|trait|flavour)\s*:/.test(line);
}

describe("nothing but the tables speaks English", () => {
  it("finds no sentence left in a system, in the twist, in the content or on the screen", () => {
    const found: string[] = [];
    for (const dir of WORDED_DIRS) {
      for (const file of tsFiles(join(ROOT, dir))) {
        if (relative(ROOT, file).includes(join("content", "i18n"))) continue;
        // The debug overlay (G68): a diagnostic panel for whoever is running
        // the build, not game text a player reads, so it is deliberately
        // plain English and outside `t()` — see the file's own doc comment.
        if (relative(ROOT, file) === join("games", "salvor", "src", "ui", "debug.ts")) continue;
        // The crash guard (10.09): the browser's own `Script error.` is a
        // literal it compares against, and its two console lines are read in a
        // devtools panel, never on the screen. Neither is game text.
        if (relative(ROOT, file) === join("games", "salvor", "src", "ui", "crashguard.ts")) continue;
        code(readFileSync(file, "utf8"))
          .split("\n")
          .forEach((line, i) => {
            // A console line is read in devtools by whoever runs the build,
            // never by a player: diagnostics, not game text.
            if (/^\s*console\.(warn|error|log|info)\(/.test(line)) return;
            for (const m of line.matchAll(/"[^"\n]*"|`[^`\n]*`/g)) {
              // What is left of a literal once the interpolations are out of it.
              const text = m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, "");
              if (!/[A-Za-z]/.test(text) || !/ /.test(text)) continue;
              if (allowedText(line, m[0].slice(1, -1), text)) continue;
              found.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]}`);
            }
          });
      }
    }
    expect(found).toEqual([]);
  });
});
