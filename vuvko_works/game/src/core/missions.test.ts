import { describe, expect, it } from "vitest";
import {
  MISSION_TYPES,
  SHIP_PROFILES,
  missionTypeById,
  rollMission,
  shipProfileByCode,
} from "./missions";
import { createRng } from "./rng";

describe("the mission table", () => {
  it("offers the four hulls hexmap.html builds", () => {
    expect(SHIP_PROFILES.map((profile) => profile.code).sort()).toEqual([
      "1-2-1",
      "1-2-3",
      "2-1-2",
      "3-2-1",
    ]);
    for (const profile of SHIP_PROFILES) {
      expect(shipProfileByCode(profile.code)?.name).toBe(profile.name);
    }
    expect(shipProfileByCode("9-9-9")).toBeNull();
  });

  it("has one mission type, and finds it by id", () => {
    expect(MISSION_TYPES).toHaveLength(1);
    expect(missionTypeById("secure")?.name).toBe("Secure the ship");
    expect(missionTypeById("nope")).toBeNull();
  });

  it("rolls something legal, and the same thing from the same seed", () => {
    const first = rollMission(createRng("roll-1"));
    const second = rollMission(createRng("roll-1"));
    expect(second[0]).toEqual(first[0]);

    expect(MISSION_TYPES).toContain(first[0].type);
    expect(SHIP_PROFILES).toContain(first[0].profile);
    expect(first[0].seed).toMatch(/^[0-9A-Z]{1,4}-\d{3}$/);
    /* The generator moved on, so the next roll differs. */
    expect(first[1].cursor).toBeGreaterThan(0);
  });

  it("reaches every hull across many rolls", () => {
    const seen = new Set<string>();
    let rng = createRng("spread");
    for (let i = 0; i < 200; i++) {
      const [brief, next] = rollMission(rng);
      seen.add(brief.profile.code);
      rng = next;
    }
    expect(seen.size).toBe(SHIP_PROFILES.length);
  });
});
