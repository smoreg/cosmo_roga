import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type { LogLine } from "@jamrog/engine";
import { ENGINE_KEYS } from "../src/ui/logline.js";
import { linesSince, sfxFor, sfxForKey, type SfxId } from "../src/ui/sfx.js";

/**
 * The effect table, read against the events the game actually logs.
 *
 * It used to be a table of English substrings, and this file used to be the
 * price of that: every entry pinned to a sentence, so a reworded line was a
 * silent effect. `LogLine.key` ended that — a line says what it *is* now — so
 * the checks here are about events rather than wording, and the whole file
 * survives a translation without a single edit.
 *
 * The last two describes are what would have caught the old defect: every id in
 * the table has to be reachable from a `log.add` somewhere in the game, and
 * every sound the game ships has to have an entry. Both are read off the
 * source, because a table entry nothing writes is exactly as silent as a
 * rewritten sentence used to be.
 */

const line = (key: string): LogLine => ({ text: "…", turn: 3, tone: "plain", count: 1, key });

describe("every effect has an event that fires it", () => {
  it("cracks when a module burns out", () => {
    expect(sfxForKey("log.module.burn")).toBe("burn");
  });

  it("thumps when a blow lands on a module, and stays quiet with no event at all", () => {
    expect(sfxForKey("log.hit.module")).toBe("hit");
    // The engine writes the core's own line and keys nothing, so it is silent.
    expect(sfxForKey(undefined)).toBeUndefined();
  });

  it("answers a ship system coming online", () => {
    expect(sfxForKey("log.system.online")).toBe("system");
  });

  it("plays the death stinger on losing the drone, and on the rival jumping with it", () => {
    expect(sfxForKey("log.drone.lost")).toBe("dead");
    expect(sfxForKey("log.rival.jumped")).toBe("dead");
  });

  it("plays the payoff when the hull goes under tow", () => {
    expect(sfxForKey("log.hull.tow")).toBe("sold");
  });

  it("raises the alarm for everything that comes for the ship", () => {
    for (const key of [
      "log.alert.hunter",
      "log.alert.busy",
      "log.rival.aboard",
      "log.rival.lost",
      "log.ghost.sighted",
    ]) {
      expect(sfxForKey(key), key).toBe("alert");
    }
  });

  it("discharges on the EMP", () => {
    expect(sfxForKey("log.emp")).toBe("emp");
  });

  it("scrapes on every way of taking a part off a wreck", () => {
    for (const key of ["log.salvage.install", "log.salvage.graft", "log.salvage.mend", "log.bloom.strip"]) {
      expect(sfxForKey(key), key).toBe("salvage");
    }
  });

  it("pings on the sensor pulse", () => {
    expect(sfxForKey("log.pulse")).toBe("pulse");
  });

  it("arcs on every kind of torch work", () => {
    for (const key of [
      "log.weld",
      "log.virus.purge.on",
      "log.door.weld.on",
      "log.door.weld.done",
      "log.door.cut.on",
    ]) {
      expect(sfxForKey(key), key).toBe("weld");
    }
  });

  it("opens on every way through a bulkhead", () => {
    for (const key of ["log.door.key", "log.door.power", "log.door.cut.done", "log.spike.done"]) {
      expect(sfxForKey(key), key).toBe("door");
    }
  });

  it("fires on the drone's own shot, and not as a blow landing on it", () => {
    expect(sfxForKey("log.emitter.hit")).toBe("emitter");
    expect(sfxForKey("log.emitter.hit")).not.toBe("hit");
  });

  it("clatters when a machine comes apart", () => {
    expect(sfxForKey("log.machine.dies")).toBe("machine");
    expect(sfxForKey("log.scrap.drop")).toBe("machine");
    expect(sfxForKey("log.bloom.dies")).toBe("machine");
  });
});

describe("events that are nobody's effect", () => {
  it("stays silent on the opening, on refusals and on quiet turns", () => {
    for (const key of [
      "log.opening",
      "log.alert.calm",
      "log.voyage.home",
      "log.work.break.cut",
      "log.door.close",
      "hint.exposure",
    ]) {
      expect(sfxFor([line(key)]), key).toEqual([]);
    }
  });

  it("stays silent on a line nobody keyed at all", () => {
    expect(sfxFor([{ text: "The scout dies.", turn: 1, tone: "plain", count: 1 }])).toEqual([]);
  });
});

describe("a turn's worth of lines", () => {
  it("plays a crack once however many modules burned", () => {
    expect(sfxFor([line("log.module.burn"), line("log.module.burn")])).toEqual(["burn"]);
  });

  it("keeps the order the lines came in", () => {
    expect(
      sfxFor([line("log.hit.module"), line("log.module.burn"), line("log.machine.dies")]),
    ).toEqual(["hit", "burn", "machine"]);
  });

  it("stops at three, because a fourth is noise and not information", () => {
    const played = sfxFor([
      line("log.hit.module"),
      line("log.module.burn"),
      line("log.machine.dies"),
      line("log.pulse"),
      line("log.door.key"),
    ]);
    expect(played).toHaveLength(3);
    expect(played).not.toContain("pulse");
  });

  it("plays nothing for a turn that said nothing", () => {
    expect(sfxFor([])).toEqual([]);
  });
});

// ------------------------------------------------- the table against the game

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Every event key the game hands to `MessageLog.add`, read off the source. */
function loggedKeys(): Set<string> {
  const out = new Set<string>();
  for (const file of sources(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/log\.add\([\s\S]{0,400}?"((?:log|hint)\.[\w.]+)",?\s*\)/g)) {
      out.add(m[1]!);
    }
    // A key chosen in a branch and logged a few lines later (`twist/rig.ts`).
    for (const m of src.matchAll(/\bkey = "(log\.[\w.]+)";/g)) out.add(m[1]!);
    // A blow signed by whatever owned it: `blamedOn("log.hit.vent", …)` is the
    // line `RIG.onDamage` writes for it (`twist/rig.ts`).
    for (const m of src.matchAll(/\bblamedOn\(\s*"(log\.[\w.]+)"/g)) out.add(m[1]!);
    // `credit()` in systems/voyage.ts logs under the event it is paying for.
    for (const m of src.matchAll(/credit\([\s\S]{0,200}?,\s*"(log\.[\w.]+)"\s*\)/g)) {
      out.add(m[1]!);
    }
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/const\s+([A-Z][A-Z0-9_]*_KEY)\s*=\s*"([\w.]+)";/g)) {
      consts.set(m[1]!, m[2]!);
    }
    for (const m of src.matchAll(/log\.add\([\s\S]{0,300}?,\s*([A-Z][A-Z0-9_]*_KEY),?\s*\)/g)) {
      const key = consts.get(m[1]!);
      if (key !== undefined) out.add(key);
    }
  }
  // `hint()` keys its line with the flag it remembers it by, built at runtime.
  for (const flag of [
    "exposure", "burned", "scrap", "blind", "keycard", "death", "sold", "virus",
    "sell", "objective", "payout", "shooting",
  ]) {
    out.add(`hint.${flag}`);
  }
  // The engine writes to the same log and keys its lines too (combat, doors,
  // cover). Its source is not scanned — this game's list of the keys it knows
  // how to say is `ENGINE_KEYS`, and `tests/i18n.test.ts` is what holds that
  // list to the ones a real run actually produces.
  for (const key of ENGINE_KEYS) out.add(key);
  return out;
}

/** Every key the sound table listens for, read off the table's own source. */
function tableKeys(): string[] {
  const src = readFileSync(join(SRC, "ui", "sfx.ts"), "utf8");
  const body = src.slice(src.indexOf("const SOUNDS"), src.indexOf("/** Never more than this"));
  return [...body.matchAll(/"([\w.]+)":\s*"(\w+)"/g)].map((m) => m[1]!);
}

describe("the table and the game agree", () => {
  it("listens for nothing the game never logs", () => {
    const logged = loggedKeys();
    for (const key of tableKeys()) {
      expect(logged.has(key), `${key} is in the sound table but nothing logs it`).toBe(true);
    }
  });

  it("has an entry for every sound the game ships", () => {
    const ids = new Set<SfxId>(tableKeys().map((k) => sfxForKey(k)).filter(Boolean) as SfxId[]);
    for (const id of [
      "burn", "hit", "salvage", "pulse", "emp", "weld", "alert",
      "door", "emitter", "machine", "system", "dead", "sold",
    ] as const) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});

describe("keeping up with the log", () => {
  const log = [line("a"), line("b"), line("c")];

  it("hands back everything after the last line already heard", () => {
    expect(linesSince(log, 0)).toHaveLength(3);
    expect(linesSince(log, 2)).toEqual([log[2]]);
    expect(linesSince(log, 3)).toEqual([]);
  });

  /**
   * `MessageLog` drops its oldest line when full and folds a line repeated in
   * one turn into a counter, so the count it reports can fall as well as rise.
   * Neither may throw and neither may replay a line the player already heard.
   */
  it("survives a log that shrank under it, and one it fell behind on", () => {
    expect(linesSince(log, 99)).toEqual([]);
    expect(linesSince(log, -4)).toHaveLength(3);
    expect(linesSince([], 7)).toEqual([]);
  });
});
