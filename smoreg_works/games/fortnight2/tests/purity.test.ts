import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The simulation is not allowed to know what time it is, what the operating
 * system's random number generator says, or that a browser exists.
 *
 * All three of the repo's headline promises rest on that: `?seed=N` reproduces
 * a run for a bug report, the recorded runs in `replay.test.ts` stay recorded,
 * and half the test suite can assert an exact number. One `Math.random()` in a
 * monster's AI silently ends all of it, and nothing else in the suite fails —
 * which is why the check is a grep and not a behaviour.
 *
 * Reading files with `fs` is fine here: this is a test, not the sim.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SIM_DIRS = [
  "packages/engine/src/sim",
  "games/fortnight2/src/content",
  "games/fortnight2/src/twist",
  "games/fortnight2/src/systems",
];

/** What a deterministic, DOM-free simulation may never reach for. */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bMath\s*\.\s*random\b/, why: "use game.rng" },
  { pattern: /\bDate\s*\.\s*now\b/, why: "use game.schedule.time" },
  { pattern: /\bperformance\s*\.\s*now\b/, why: "use game.schedule.time" },
  { pattern: /\bdocument\b/, why: "sim/ has no DOM; render it from data" },
  { pattern: /\bwindow\b/, why: "sim/ has no DOM; the UI owns timers" },
  { pattern: /\blocalStorage\b/, why: "sim/ has no DOM; the UI owns storage" },
  // Node's globals are typed repo-wide so tests can read files. Nothing that
  // ships in the bundle may touch them, and the type checker will not say so.
  { pattern: /\bprocess\s*\./, why: "sim/ runs in a browser too" },
  { pattern: /\brequire\s*\(/, why: "sim/ is ES modules only" },
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
 * rule you cannot write down is worse than one you cannot test.
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

describe("the simulation stays pure", () => {
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
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
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
});
