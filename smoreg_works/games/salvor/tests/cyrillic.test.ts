import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No Russian in a string the English build could say (G96, 10).
 *
 * `tests/leak.test.ts` proves it from the rendered side: bots fly voyages and
 * training runs and every frame is read for Cyrillic. This proves it from the
 * source: every string literal in the game and the engine, outside the Russian
 * table itself, is walked, and a Cyrillic letter in one is a failure with the
 * file and the line. Comments are Russian by house rule — the owner's words are
 * quoted in them all over the code — so the walk knows a comment from a
 * string, a regex from a string, and a `${}` inside a template from the
 * template around it.
 *
 * The two complement each other: a frame the bots never reach is still a
 * literal in a file, and a literal built from pieces is still a frame.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where the game's and the engine's own words live. */
const ROOTS = ["games/salvor/src", "packages/engine/src", "packages/audio/src"];

/** The one file that is Russian on purpose. */
const RUSSIAN_TABLE = "games/salvor/src/content/i18n/ru.ts";

const CYRILLIC = /[Ѐ-ӿ]/;

interface Literal {
  readonly line: number;
  readonly text: string;
}

/** Every `.ts`/`.tsx` file under a directory, in a stable order. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** Characters after which a `/` starts a regular expression rather than divides. */
const BEFORE_REGEX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

/**
 * The string literals of a TypeScript source, with the line each begins on.
 *
 * A small scanner rather than a parser: it knows line and block comments,
 * the three quotes, escapes, regex literals (so a `/"/` does not open a
 * string) and the expressions inside a template, which it scans as code so a
 * quote or a backtick in one neither ends the template nor starts a string of
 * its own. Everything else is skipped a character at a time.
 */
export function literalsOf(source: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  const at = (k: number): string => source[k] ?? "";

  /** The last character that is not whitespace before `k`, for the regex rule. */
  const before = (k: number): string => {
    for (let j = k - 1; j >= 0; j--) {
      const c = source[j]!;
      if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return c;
    }
    return "";
  };

  /** A quoted string or a template from `i`, pushed; leaves `i` after the closing quote. */
  const string = (quote: string): void => {
    const start = line;
    let text = "";
    i++;
    while (i < n && at(i) !== quote) {
      const c = at(i);
      if (c === "\\") {
        text += c + at(i + 1);
        i += 2;
        continue;
      }
      if (quote === "`" && c === "$" && at(i + 1) === "{") {
        // The expression is code: scanned as such, and its own strings are
        // its own literals.
        i += 2;
        code(true);
        continue;
      }
      if (c === "\n") line++;
      text += c;
      i++;
    }
    i++;
    out.push({ line: start, text });
  };

  /** A regex literal from `i`; leaves `i` after the closing slash. */
  const regex = (): void => {
    i++;
    let inClass = false;
    while (i < n) {
      const c = at(i);
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) break;
      else if (c === "\n") break;
      i++;
    }
    i++;
  };

  /**
   * Code from `i`. With `untilBrace` it is the inside of a `${}`, and returns
   * past the `}` that closes it; otherwise it runs to the end of the source.
   */
  const code = (untilBrace: boolean): void => {
    let depth = 0;
    while (i < n) {
      const c = at(i);
      const d = at(i + 1);
      if (c === "\n") {
        line++;
        i++;
      } else if (c === "/" && d === "/") {
        while (i < n && at(i) !== "\n") i++;
      } else if (c === "/" && d === "*") {
        i += 2;
        while (i < n && !(at(i) === "*" && at(i + 1) === "/")) {
          if (at(i) === "\n") line++;
          i++;
        }
        i += 2;
      } else if (c === '"' || c === "'" || c === "`") {
        string(c);
      } else if (c === "/" && (BEFORE_REGEX.has(before(i)) || before(i) === "")) {
        regex();
      } else if (untilBrace && c === "{") {
        depth++;
        i++;
      } else if (untilBrace && c === "}") {
        if (depth === 0) {
          i++;
          return;
        }
        depth--;
        i++;
      } else {
        i++;
      }
    }
  };

  code(false);
  return out;
}

describe("no Cyrillic in a string literal outside the Russian table", () => {
  it("tells a comment from a string, a regex from a string, and code inside a template from the template", () => {
    const sample = [
      `// «комментарий» stays`,
      `/* и блочный тоже: "в кавычках" */`,
      `const a = "plain";`,
      `const b = 'к';`,
      `const c = s.replace(/"/g, "&quot;") + "ещё";`,
      "const d = `<div class=\"${cls ? `x` : \"у\"}\">${\"ю\"}</div>`;",
      `const e = x / y / "z";`,
    ].join("\n");
    const found = literalsOf(sample).filter((l) => CYRILLIC.test(l.text)).map((l) => `${l.line}: ${l.text}`);
    expect(found).toEqual(["4: к", "5: ещё", "6: у", "6: ю"]);
    expect(literalsOf(sample).map((l) => l.text)).toContain("z");
  });

  it("finds none in the game, the engine and the audio package", () => {
    const leaks: string[] = [];
    let files = 0;
    for (const root of ROOTS) {
      for (const path of sources(join(ROOT, root))) {
        const name = relative(ROOT, path);
        if (name === RUSSIAN_TABLE) continue;
        files++;
        for (const literal of literalsOf(readFileSync(path, "utf8"))) {
          if (CYRILLIC.test(literal.text)) leaks.push(`${name}:${literal.line}: ${literal.text.slice(0, 60)}`);
        }
      }
    }
    expect(files).toBeGreaterThan(100);
    expect(leaks, leaks.join("\n")).toEqual([]);
  });
});
