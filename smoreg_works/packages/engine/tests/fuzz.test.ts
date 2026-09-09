import { describe, it, expect } from "vitest";
import { fuzz } from "../src/testing/fuzz.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";
import { seedRange } from "../src/testing/metrics.js";
import type { Twist } from "../src/sim/twist.js";

describe("fuzz", () => {
  it("finds nothing on dummycontent across many seeds and steps", () => {
    const failures = fuzz({ seeds: seedRange(1, 50), steps: 300, game: { content: TEST_CONTENT } });
    expect(failures).toEqual([]);
  });

  it("catches a system that throws mid-run, one failure per seed", () => {
    // Resets on every run so the count does not leak from the previous seed's
    // Game, which reuses this same Twist instance (`game` is shared across
    // `fuzz`'s seeds, the way a real game config is).
    let calls = 0;
    const boom: Twist = {
      name: "boom",
      onRunStart: () => void (calls = 0),
      afterPlayerTurn: () => {
        calls++;
        if (calls === 10) throw new Error("boom");
      },
    };

    const seeds = seedRange(1, 50);
    const failures = fuzz({ seeds, steps: 300, game: { content: TEST_CONTENT, systems: [boom] } });

    expect(failures).toHaveLength(seeds.length);
    for (const f of failures) {
      expect(f.step).toBe(10);
      expect(f.inputs).toHaveLength(10);
    }
  });
});
