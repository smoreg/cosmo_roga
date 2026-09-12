import { REFERENCE_HEX_FEET } from "./roster";
import { describe, expect, it } from "vitest";
import { setDoorState } from "./actions";
import {
  canReachAcross,
  doorStateOf,
  drones,
  edgeBetween,
  enemyExertingControl,
  hostiles,
  isAlive,
  isDrone,
  isHostile,
  isLiveNode,
  isLiveSpawner,
  isOccupied,
  liveNodes,
  liveSpawners,
  objectAt,
  objectById,
  unitAt,
  unitById,
} from "./topology";
import { makeUnit } from "./mission";
import { testMission } from "./test/fixtures";
import type { GameState } from "./types";

describe("edges", () => {
  it("names why a pair is not joined", () => {
    const { deck, state } = testMission();
    const anywhere = [...deck.cells.values()][0]!.at;
    expect(edgeBetween(deck, state, anywhere, { q: 999, r: 999 }).blockedBy).toBe("offMap");
    const far = [...deck.cells.values()].find((c) => Math.abs(c.at.q - anywhere.q) > 2);
    expect(edgeBetween(deck, state, anywhere, far!.at).blockedBy).toBe("notAdjacent");
  });

  it("reports a shut door as joined but needing forcing, and blocks reach across it", () => {
    const { deck, state } = testMission();
    const door = deck.doors[0]!;
    expect(doorStateOf(state, door)).toBe("open");
    expect(canReachAcross(deck, state, door.from, door.to)).toBe(true);

    const shut = setDoorState(state, door.id, "closed");
    const edge = edgeBetween(deck, shut, door.from, door.to);
    expect(edge.joined).toBe(true);
    expect(edge.needsForcing).toBe(true);
    expect(doorStateOf(shut, door)).toBe("closed");
    expect(canReachAcross(deck, shut, door.from, door.to)).toBe(false);
  });
});

describe("occupancy", () => {
  it("finds units and objects, and ignores the dead", () => {
    const { state } = testMission();
    const drone = state.units[0]!;
    expect(unitAt(state, drone.at)?.id).toBe(drone.id);
    expect(unitById(state, drone.id)?.id).toBe(drone.id);
    expect(unitById(state, 4242)).toBeNull();
    expect(isOccupied(state, drone.at)).toBe(true);

    const node = liveNodes(state)[0]!;
    expect(objectAt(state, node.at)?.id).toBe(node.id);
    expect(objectById(state, node.id)?.id).toBe(node.id);
    expect(objectById(state, 4242)).toBeNull();

    const dead: GameState = {
      ...state,
      units: state.units.map((unit) => ({ ...unit, hp: 0 })),
      objects: state.objects.map((object) => ({ ...object, hp: 0 })),
    };
    expect(unitAt(dead, drone.at)).toBeNull();
    expect(objectAt(dead, node.at)).toBeNull();
    expect(isOccupied(dead, node.at)).toBe(false);
  });

  it("sorts the sides", () => {
    const { state } = testMission();
    const scout = makeUnit("scout", 90, { q: 500, r: 500 }, REFERENCE_HEX_FEET);
    const staged: GameState = { ...state, units: [...state.units, scout] };
    expect(drones(staged)).toHaveLength(2);
    expect(hostiles(staged)).toHaveLength(1);
    expect(isDrone(staged.units[0]!)).toBe(true);
    expect(isHostile(scout)).toBe(true);
    expect(isAlive(scout)).toBe(true);
    expect(isAlive({ ...scout, hp: 0 })).toBe(false);
    expect(liveSpawners(staged).every(isLiveSpawner)).toBe(true);
    expect(liveNodes(staged).every(isLiveNode)).toBe(true);
  });
});

describe("zone of control", () => {
  it("is exerted through an open door but not through a shut one or a wall", () => {
    const { deck, state } = testMission();
    const door = deck.doors[0]!;
    const hostile = makeUnit("sentinel", 90, door.to, REFERENCE_HEX_FEET);
    const staged: GameState = { ...state, units: [hostile] };

    expect(enemyExertingControl(deck, staged, "drone", door.from)?.id).toBe(hostile.id);

    const shut = setDoorState(staged, door.id, "closed");
    expect(enemyExertingControl(deck, shut, "drone", door.from)).toBeNull();

    /* Its own side is never held by it. */
    expect(enemyExertingControl(deck, staged, "ship", door.from)).toBeNull();
  });

  it("is not exerted at range", () => {
    const { deck, state } = testMission();
    const drone = state.units[0]!;
    expect(enemyExertingControl(deck, state, "drone", drone.at)).toBeNull();
  });
});
