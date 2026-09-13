import { describe, expect, it } from "vitest";
import { BEAT, TEMPO, quicken } from "./tempo";
import { PRESETS } from "../vendor/derelict-fx";

describe("tempo", function suite() {
  it("resolves every reveal three times as finely over the same span", function same() {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const quick = quicken(preset);
      expect(quick.ticks, name).toBe(preset.ticks * TEMPO);
      expect(quick.ticks * quick.tickMs, name).toBeCloseTo(preset.ticks * preset.tickMs, 6);
      /* Starting the second line sooner is a different change. */
      expect(quick.stagger, name).toBe(preset.stagger);
    }
  });

  it("keeps every frame long enough to be seen", function visible() {
    /* Under a display frame the steps stop being steps, which is the one thing
       the library exists to prevent. */
    for (const preset of Object.values(PRESETS)) {
      expect(quicken(preset).tickMs).toBeGreaterThan(1000 / 60);
    }
    expect(BEAT).toBeGreaterThan(1000 / 60);
  });
});
