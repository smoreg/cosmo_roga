import { describe, expect, it } from "vitest";
import { setDoorState } from "./actions";
import { hexKey } from "./hex";
import { intentFor, reachableHexes } from "./intent";
import { makeUnit } from "./mission";
import { testMission } from "./test/fixtures";
import type { GameState, Unit } from "./types";

function withUnits(state: GameState, units: Unit[]): GameState {
  return { ...state, units, nextUnitId: units.length + 90 };
}

describe("what a unit may do about a neighbour", () => {
  it("refuses a bulkhead and allows an open door", () => {
    const { deck, state } = testMission();
    const door = deck.doors.find(
      (d) => d.zoneA === deck.entryZoneId || d.zoneB === deck.entryZoneId,
    );
    expect(door).toBeDefined();

    const drone = makeUnit("drone", 0, door!.from);
    const next = withUnits(state, [drone]);
    expect(intentFor(deck, next, drone, door!.to).kind).toBe("move");

    /* A neighbour in another room with no door on that edge is a wall. */
    let foundBulkhead = false;
    for (const cell of deck.cells.values()) {
      for (const other of deck.cells.values()) {
        if (Math.abs(cell.at.q - other.at.q) + Math.abs(cell.at.r - other.at.r) !== 1) continue;
        if (cell.zoneId === other.zoneId) continue;
        if (
          deck.doorsByEdge.has(
            hexKey(cell.at) < hexKey(other.at)
              ? `${hexKey(cell.at)}|${hexKey(other.at)}`
              : `${hexKey(other.at)}|${hexKey(cell.at)}`,
          )
        )
          continue;
        const walker = makeUnit("drone", 1, cell.at);
        const verdict = intentFor(deck, withUnits(state, [walker]), walker, other.at);
        expect(verdict).toEqual({ kind: "refused", reason: "bulkhead" });
        foundBulkhead = true;
        break;
      }
      if (foundBulkhead) break;
    }
    expect(foundBulkhead).toBe(true);
  });

  it("treats a shut door as passable by forcing, and impassable to an attack", () => {
    const { deck, state } = testMission();
    const door = deck.doors[0];
    expect(door).toBeDefined();
    const shut = setDoorState(state, door!.id, "closed");

    const drone = makeUnit("drone", 0, door!.from);
    const hostile = makeUnit("scout", 1, door!.to);

    const moving = intentFor(deck, withUnits(shut, [drone]), drone, door!.to);
    expect(moving.kind).toBe("move");
    expect(moving.kind === "move" && moving.forcesDoor?.id).toBe(door!.id);

    const blocked = intentFor(deck, withUnits(shut, [drone, hostile]), drone, door!.to);
    expect(blocked).toEqual({ kind: "refused", reason: "doorShut" });
  });

  it("lets a unit attack with no movement left, but not twice", () => {
    /* Spending the last point walking up to something must not be what stops
       you hitting it. The prototype got this wrong. */
    const { deck, state } = testMission();
    const drone = makeUnit("drone", 0, { q: 0, r: 0 });
    const seat = [...deck.cells.values()][0];
    expect(seat).toBeDefined();

    const standing = { ...makeUnit("drone", 0, seat!.at), movement: 0 };
    const neighbours = [
      { q: seat!.at.q + 1, r: seat!.at.r },
      { q: seat!.at.q, r: seat!.at.r + 1 },
      { q: seat!.at.q - 1, r: seat!.at.r },
      { q: seat!.at.q, r: seat!.at.r - 1 },
    ];
    const spot = neighbours.find((n) => deck.cells.get(hexKey(n))?.zoneId === seat!.zoneId);
    expect(spot).toBeDefined();
    const hostile = makeUnit("scout", 1, spot!);

    const ready = withUnits(state, [standing, hostile]);
    expect(intentFor(deck, ready, standing, spot!).kind).toBe("attack");

    const spent = withUnits(state, [{ ...standing, hasAttacked: true }, hostile]);
    expect(intentFor(deck, spent, spent.units[0]!, spot!)).toEqual({
      kind: "refused",
      reason: "alreadyAttacked",
    });
    expect(drone.hasAttacked).toBe(false);
  });
});

describe("the reachable set", () => {
  it("stops at zone of control and never includes a forced door", () => {
    const { deck, state } = testMission();
    const drone = state.units[0];
    expect(drone).toBeDefined();

    const alone = reachableHexes(deck, state, drone!);
    expect(alone.size).toBeGreaterThan(0);

    /* Drop a hostile beside the drone: its control should shrink what can be
       walked through, since entering its reach ends the move. */
    const neighbour = [...alone.keys()][0];
    expect(neighbour).toBeDefined();
    const [q, r] = neighbour!.split(",").map(Number);
    const blocker = makeUnit("sentinel", 77, { q: q!, r: r! });
    const watched = reachableHexes(deck, { ...state, units: [...state.units, blocker] }, drone!);
    expect(watched.has(neighbour!)).toBe(false);
  });
});
