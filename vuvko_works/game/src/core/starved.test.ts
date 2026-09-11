import { describe, expect, it } from "vitest";
import { applyCommand } from "./apply";
import { canStillBuild, checkOutcome } from "./actions";
import { endTurn } from "./commands";
import { profileOf } from "./roster";
import { isHostile, isLiveNode, isLiveSpawner, liveSpawners } from "./topology";
import { testMission } from "./test/fixtures";
import type { GameState, MapObject } from "./types";

function cutAllNodes(state: GameState): GameState {
  const objects: MapObject[] = state.objects.map(function cut(object) {
    return object.kind === "node" ? { ...object, hp: 0 } : object;
  });
  return { ...state, objects };
}

describe("a ship with nothing left to build with", () => {
  it("still counts as able while a single node is paying", () => {
    const { state } = testMission();
    expect(state.pool).toBe(0);
    /* Broke right now, but the nodes will get it there. */
    expect(canStillBuild(state)).toBe(true);
  });

  it("is finished once the nodes are cut and the pool is short", () => {
    const { state } = testMission();
    const starved = { ...cutAllNodes(state), pool: 0 };
    expect(starved.objects.filter(isLiveNode)).toHaveLength(0);
    expect(liveSpawners(starved).length).toBeGreaterThan(0);
    expect(canStillBuild(starved)).toBe(false);
  });

  it("is not finished if the frozen pool still affords the cheapest thing", () => {
    const { state } = testMission();
    let cheapest = Infinity;
    for (const type of ["scout", "sentinel", "hunter"] as const) {
      cheapest = Math.min(cheapest, profileOf(type).cost);
    }
    const funded = { ...cutAllNodes(state), pool: cheapest };
    expect(canStillBuild(funded)).toBe(true);

    const short = { ...cutAllNodes(state), pool: cheapest - 0.5 };
    expect(canStillBuild(short)).toBe(false);
  });

  it("wins when the last hostile falls and nothing can replace it", () => {
    const { state } = testMission();
    const starved: GameState = {
      ...cutAllNodes(state),
      pool: 0,
      units: state.units.filter(function drones(unit) {
        return unit.side === "drone";
      }),
    };
    expect(starved.units.filter(isHostile)).toHaveLength(0);
    expect(liveSpawners(starved).length).toBeGreaterThan(0);

    const settled = checkOutcome(starved);
    expect(settled.state.outcome).toBe("win");
    expect(settled.events.map((event) => event.kind)).toEqual(["missionEnded"]);
  });

  it("does not win while a hostile is still aboard", () => {
    const { deck, state } = testMission();
    /* Let the ship build something, then starve it. */
    const afterTurn = applyCommand(deck, state, endTurn()).state;
    expect(afterTurn.units.filter(isHostile).length).toBeGreaterThan(0);

    const starved = { ...cutAllNodes(afterTurn), pool: 0 };
    expect(canStillBuild(starved)).toBe(false);
    expect(checkOutcome(starved).state.outcome).toBeNull();
  });

  it("still wins the plain way, by levelling every spawn zone", () => {
    const { state } = testMission();
    const flattened: GameState = {
      ...state,
      objects: state.objects.map(function down(object) {
        return object.kind === "spawner" ? { ...object, hp: 0 } : object;
      }),
    };
    expect(flattened.objects.filter(isLiveSpawner)).toHaveLength(0);
    expect(checkOutcome(flattened).state.outcome).toBe("win");
  });

  it("loses first: both drones gone beats anything else", () => {
    const { state } = testMission();
    const wiped: GameState = {
      ...cutAllNodes(state),
      pool: 0,
      units: state.units.map(function kill(unit) {
        return { ...unit, hp: 0 };
      }),
    };
    expect(checkOutcome(wiped).state.outcome).toBe("loss");
  });
});
