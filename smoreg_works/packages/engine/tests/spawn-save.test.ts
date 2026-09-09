import { describe, it, expect } from "vitest";
import { SpawnTable, curve, band } from "../src/sim/spawn.js";
import { decodeRun, encodeRun, saveRun, loadRun, clearRun, SAVE_VERSION, type RunRecord, type StorageLike } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";
import { Game, replay } from "../src/sim/game.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";
import type { Command } from "../src/sim/actions.js";

describe("SpawnTable", () => {
  const table = new SpawnTable<string>([
    { value: "rat", weight: 10, minDepth: 1, maxDepth: 3 },
    { value: "orc", weight: 5, minDepth: 3, maxDepth: 8 },
    { value: "troll", weight: 1, minDepth: 6, maxDepth: 10 },
  ]);

  it("only offers entries legal for the depth", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 200; i++) expect(table.pick(1, rng)).toBe("rat");
    for (let i = 0; i < 200; i++) expect(["orc", "troll"]).toContain(table.pick(7, rng)!);
  });

  it("returns undefined when nothing fits", () => {
    expect(table.pick(99, new Rng(1))).toBeUndefined();
  });

  it("respects relative weights", () => {
    const rng = new Rng(2);
    let rats = 0;
    for (let i = 0; i < 4000; i++) if (table.pick(3, rng) === "rat") rats++;
    expect(rats / 4000).toBeGreaterThan(0.6); // 10 vs 5
    expect(rats / 4000).toBeLessThan(0.73);
  });

  it("distribution sums to one and matches the weights", () => {
    const dist = table.distribution(3);
    expect(dist.reduce((s, d) => s + d.p, 0)).toBeCloseTo(1);
    const rat = dist.find((d) => d.value === "rat")!;
    expect(rat.p).toBeCloseTo(10 / 15);
  });

  it("weightAt shapes a band so a monster peaks mid-range", () => {
    const banded = new SpawnTable<string>([
      { value: "mid", weight: 10, minDepth: 1, maxDepth: 9, weightAt: band(3, 7) },
      { value: "flat", weight: 1, minDepth: 1, maxDepth: 9 },
    ]);
    const pAt = (d: number) => banded.distribution(d).find((x) => x.value === "mid")?.p ?? 0;
    expect(pAt(5)).toBeGreaterThan(pAt(3));
    expect(pAt(1)).toBe(0);
    expect(pAt(9)).toBe(0);
  });

  it("pickMany returns the requested count", () => {
    expect(table.pickMany(3, 12, new Rng(4)).length).toBe(12);
  });
});

describe("curve", () => {
  it("grows with depth and honours the ceiling", () => {
    expect(curve(1, { base: 5, perDepth: 2 })).toBe(5);
    expect(curve(4, { base: 5, perDepth: 2 })).toBe(11);
    expect(curve(40, { base: 5, perDepth: 2, max: 20 })).toBe(20);
  });

  it("jitter stays within the requested spread", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const v = curve(5, { base: 10, perDepth: 0, jitter: 0.2 }, rng);
      expect(v).toBeGreaterThanOrEqual(8);
      expect(v).toBeLessThanOrEqual(12);
    }
  });

  it("never goes negative", () => {
    expect(curve(1, { base: 0, perDepth: -5 })).toBe(0);
  });
});

describe("run records", () => {
  const record: RunRecord = { version: SAVE_VERSION, seed: 1234, inputs: [{ kind: "move", dx: 1, dy: 0 }, { kind: "wait" }] };

  it("round-trips through encode/decode", () => {
    const back = decodeRun(encodeRun(record));
    expect(back.ok).toBe(true);
    expect(back.record).toEqual(record);
  });

  it("rejects junk without throwing", () => {
    for (const junk of ["", "{", "null", "[]", '{"seed":1}', '{"seed":"x","inputs":[]}']) {
      const res = decodeRun(junk);
      expect(res.ok).toBe(false);
      expect(typeof res.reason).toBe("string");
    }
  });

  it("rejects a save from an older version", () => {
    const old = JSON.stringify({ ...record, version: SAVE_VERSION - 1 });
    expect(decodeRun(old).ok).toBe(false);
  });

  it("rejects unknown commands in the input list", () => {
    const bad = JSON.stringify({ ...record, inputs: [{ kind: "fly" }] });
    expect(decodeRun(bad).ok).toBe(false);
  });

  it("a stored run replays to the same outcome", () => {
    const seed = 909090;
    const game = new Game({ seed, content: TEST_CONTENT });
    const rng = new Rng(3);
    const dirs: Command[] = [
      { kind: "move", dx: 1, dy: 0 }, { kind: "move", dx: 0, dy: 1 },
      { kind: "move", dx: -1, dy: 0 }, { kind: "move", dx: 0, dy: -1 }, { kind: "wait" },
    ];
    for (let i = 0; i < 200 && !game.isOver(); i++) game.playerCommand(rng.pick(dirs));

    const stored = decodeRun(encodeRun({ version: SAVE_VERSION, seed, inputs: game.inputs })).record!;
    const restored = replay(stored.seed, stored.inputs, { content: TEST_CONTENT });
    expect(restored.player.pos).toEqual(game.player.pos);
    expect(restored.player.hp).toBe(game.player.hp);
    expect(restored.schedule.time).toBe(game.schedule.time);
  });

  describe("storage", () => {
    function memoryStorage(): StorageLike & { data: Map<string, string> } {
      const data = new Map<string, string>();
      return {
        data,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
      };
    }

    it("saves, loads and clears", () => {
      const s = memoryStorage();
      expect(loadRun(s).ok).toBe(false);
      saveRun(s, record);
      expect(loadRun(s).record).toEqual(record);
      clearRun(s);
      expect(loadRun(s).ok).toBe(false);
    });

    it("survives a storage that throws on every call", () => {
      const hostile: StorageLike = {
        getItem() { throw new Error("blocked"); },
        setItem() { throw new Error("blocked"); },
        removeItem() { throw new Error("blocked"); },
      };
      expect(() => saveRun(hostile, record)).not.toThrow();
      expect(loadRun(hostile).ok).toBe(false);
      expect(() => clearRun(hostile)).not.toThrow();
    });
  });
});
