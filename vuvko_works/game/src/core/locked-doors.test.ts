import { REFERENCE_HEX_FEET } from "./roster";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./apply";
import { attackWith, moveUnit } from "./commands";
import { intentFor } from "./intent";
import { makeUnit } from "./mission";
import { testMission } from "./test/fixtures";
import { edgeBetween } from "./topology";
import type { Door, GameState } from "./types";

function firstLockedDoor(mission: ReturnType<typeof testMission>): Door {
  const door = mission.deck.doors.find(function locked(candidate) {
    return candidate.initialState === "locked";
  });
  expect(door).toBeDefined();
  if (door === undefined) throw new Error("no locked door on this ship");
  return door;
}

describe("a locked door", () => {
  it("cannot be walked through, the way a shut one can be shouldered", () => {
    const mission = testMission();
    const door = firstLockedDoor(mission);
    const drone = makeUnit("drone", 0, door.from, REFERENCE_HEX_FEET);
    const state: GameState = { ...mission.state, units: [drone] };

    const edge = edgeBetween(mission.deck, state, door.from, door.to);
    expect(edge.doorState).toBe("locked");
    /* Not "needs forcing": forcing is what you do to a shut door. */
    expect(edge.needsForcing).toBe(false);

    const refusal = applyCommand(mission.deck, state, moveUnit(drone.id, door.to));
    expect(refusal.events.map((event) => event.kind)).toEqual(["commandRefused"]);
    expect(refusal.state).toBe(state);
  });

  it("is offered as something to attack instead", () => {
    const mission = testMission();
    const door = firstLockedDoor(mission);
    const drone = makeUnit("drone", 0, door.from, REFERENCE_HEX_FEET);
    const state: GameState = { ...mission.state, units: [drone] };

    const intent = intentFor(mission.deck, state, drone, door.to);
    expect(intent.kind).toBe("attack");
    expect(intent.kind === "attack" && intent.targetDoor?.id).toBe(door.id);
    expect(intent.kind === "attack" && intent.targetUnit).toBeNull();
  });

  it("is cut into a hole on one landed strike, and costs the drone its action", () => {
    const mission = testMission();
    const door = firstLockedDoor(mission);

    /* It has one hit point, so the only question is whether the strike lands.
       Walk the seeds until one does, then check the whole outcome. */
    let opened = false;
    for (let attempt = 0; attempt < 20 && !opened; attempt++) {
      const fresh = testMission({ seed: `cut-${String(attempt)}` });
      const drone = makeUnit("drone", 0, door.from, REFERENCE_HEX_FEET);
      const state: GameState = { ...fresh.state, units: [drone] };
      const result = applyCommand(fresh.deck, state, attackWith(drone.id, 0, door.to));

      const cut = result.events.find((event) => event.kind === "doorCut");
      const after = result.state.units[0];
      expect(after?.hasAttacked).toBe(true);
      expect(after?.movement).toBe(0);
      /* It never answers: a door has no weapon. */
      expect(after?.hp).toBe(12);

      if (cut !== undefined) {
        opened = true;
        expect(result.state.doorStates.get(door.id)).toBe("broken");
        expect(edgeBetween(fresh.deck, result.state, door.from, door.to).doorState).toBe("broken");
      } else {
        expect(result.state.doorStates.get(door.id)).toBe("locked");
      }
    }
    expect(opened).toBe(true);
  });

  it("stays locked against the ship's own units", () => {
    const mission = testMission();
    const door = firstLockedDoor(mission);
    const hostile = makeUnit("hunter", 90, door.from, REFERENCE_HEX_FEET);
    const state: GameState = { ...mission.state, units: [hostile] };
    expect(intentFor(mission.deck, state, hostile, door.to)).toEqual({
      kind: "refused",
      reason: "doorLocked",
    });
  });
});
