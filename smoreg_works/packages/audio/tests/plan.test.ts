import { describe, it, expect } from "vitest";
import {
  crossfadeGains,
  perceptualGain,
  planTransition,
  secondsPerBar,
  secondsPerBeat,
  secondsPerPhrase,
  secondsToNextBeat,
  type Grid,
} from "../src/plan.js";

const GRID: Grid = { bpm: 120, beatsPerBar: 4, barsPerPhrase: 4 };

describe("musical grid", () => {
  it("converts tempo to seconds", () => {
    expect(secondsPerBeat(GRID)).toBe(0.5);
    expect(secondsPerBar(GRID)).toBe(2);
    expect(secondsPerPhrase(GRID)).toBe(8);
  });
});

describe("planTransition", () => {
  it("waits for the next phrase by default", () => {
    expect(planTransition(GRID, 0).delay).toBe(0);
    expect(planTransition(GRID, 2).delay).toBe(6);
    expect(planTransition(GRID, 7.5).delay).toBeCloseTo(0.5);
  });

  it("waits only for the next bar when urgency is bar", () => {
    // Combat must not wait four bars: that reads as an unresponsive game.
    expect(planTransition(GRID, 2.5, "bar").delay).toBeCloseTo(1.5);
    expect(planTransition(GRID, 2.5, "bar").delay).toBeLessThan(planTransition(GRID, 2.5).delay);
  });

  it("switches instantly when urgency is immediate", () => {
    const t = planTransition(GRID, 3.3, "immediate");
    expect(t.delay).toBe(0);
    expect(t.duration).toBeLessThan(0.2);
  });

  it("never proposes a fade longer than one bar", () => {
    for (const bpm of [60, 90, 120, 174]) {
      const grid: Grid = { bpm, beatsPerBar: 4, barsPerPhrase: 4 };
      const t = planTransition(grid, 1);
      expect(t.duration).toBeLessThanOrEqual(secondsPerBar(grid));
    }
  });

  it("lands exactly on a boundary, never a hair before it", () => {
    for (let elapsed = 0; elapsed < 40; elapsed += 0.37) {
      const { delay } = planTransition(GRID, elapsed);
      const landing = (elapsed + delay) % secondsPerPhrase(GRID);
      expect(Math.min(landing, secondsPerPhrase(GRID) - landing)).toBeLessThan(1e-6);
    }
  });
});

describe("crossfadeGains", () => {
  it("holds constant power through the fade", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const g = crossfadeGains(t);
      expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 6);
    }
  });

  it("starts on the old layer and ends on the new one", () => {
    expect(crossfadeGains(0)).toEqual({ out: 1, in: 0 });
    const end = crossfadeGains(1);
    expect(end.out).toBeCloseTo(0);
    expect(end.in).toBeCloseTo(1);
  });

  it("clamps out-of-range progress", () => {
    expect(crossfadeGains(-5).in).toBe(0);
    expect(crossfadeGains(9).in).toBeCloseTo(1);
  });
});

/**
 * The grid read as a clock rather than as a schedule: what a caller outside the
 * music needs to make something on the screen land on a beat.
 */
describe("secondsToNextBeat", () => {
  it("waits nothing at all when the playhead is on a beat", () => {
    expect(secondsToNextBeat(GRID, 0)).toBe(0);
    expect(secondsToNextBeat(GRID, 4)).toBe(0);
  });

  it("gives the rest of the beat the playhead is inside", () => {
    expect(secondsToNextBeat(GRID, 0.1)).toBeCloseTo(0.4);
    expect(secondsToNextBeat(GRID, 7.25)).toBeCloseTo(0.25);
  });

  it("holds up under a fractional tempo, which is what a real track has", () => {
    const track: Grid = { bpm: 74.9, beatsPerBar: 4, barsPerPhrase: 16 };
    const beat = secondsPerBeat(track);
    expect(secondsToNextBeat(track, beat * 3)).toBeCloseTo(0);
    expect(secondsToNextBeat(track, beat * 3.25)).toBeCloseTo(beat * 0.75);
  });

  it("answers zero rather than a NaN for a playhead it cannot read", () => {
    expect(secondsToNextBeat(GRID, NaN)).toBe(0);
    expect(secondsToNextBeat(GRID, -0.25)).toBeCloseTo(0.25);
  });
});

describe("perceptualGain", () => {
  it("is monotonic and bounded", () => {
    expect(perceptualGain(0)).toBe(0);
    expect(perceptualGain(1)).toBe(1);
    expect(perceptualGain(0.5)).toBeLessThan(0.5);
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const g = perceptualGain(s);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });

  it("clamps out-of-range sliders", () => {
    expect(perceptualGain(-1)).toBe(0);
    expect(perceptualGain(2)).toBe(1);
  });
});
