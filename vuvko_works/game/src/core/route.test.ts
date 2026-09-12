import { REFERENCE_HEX_FEET } from "./roster";
import { describe, expect, it } from "vitest";
import { hexDistance, hexKey } from "./hex";
import { intentFor, reachFrom, reachableHexes, routeTo } from "./intent";
import { makeUnit } from "./mission";
import { testMission } from "./test/fixtures";
import type { GameState } from "./types";

describe("routes", () => {
  it("walks back a real chain of single steps", () => {
    const { deck, state } = testMission();
    const drone = state.units[0];
    expect(drone).toBeDefined();

    const reach = reachableHexes(deck, state, drone!);
    let checked = 0;
    for (const key of reach.keys()) {
      const [q, r] = key.split(",").map(Number);
      const to = { q: q!, r: r! };
      const route = routeTo(deck, state, drone!, to);
      expect(route).not.toBeNull();
      expect(hexKey(route!.at(-1)!)).toBe(key);

      /* Every step is to a neighbour, and every one of them is legal. */
      let cursor = drone!;
      for (const step of route!) {
        expect(hexDistance(cursor.at, step)).toBe(1);
        const probe = { ...cursor, at: cursor.at, movement: cursor.movement };
        expect(intentFor(deck, state, probe, step).kind).toBe("move");
        cursor = { ...cursor, at: step, movement: cursor.movement - 1 };
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("never costs more steps than the drone has movement", () => {
    const { deck, state } = testMission();
    const drone = state.units[0];
    for (const key of reachableHexes(deck, state, drone!).keys()) {
      const [q, r] = key.split(",").map(Number);
      const route = routeTo(deck, state, drone!, { q: q!, r: r! });
      expect(route!.length).toBeLessThanOrEqual(drone!.movement);
    }
  });

  it("takes the shortest legal chain, not merely a legal one", () => {
    const { deck, state } = testMission();
    const drone = state.units[0];
    const reached = reachFrom(deck, state, drone!);
    for (const [key, entry] of reached) {
      if (entry.from === null) continue;
      const [q, r] = key.split(",").map(Number);
      const route = routeTo(deck, state, drone!, { q: q!, r: r! });
      /* Movement left plus steps taken always accounts for the full budget. */
      expect(route!.length + entry.left).toBe(drone!.movement);
    }
  });

  it("refuses a hex it cannot reach this turn", () => {
    const { deck, state } = testMission();
    const drone = state.units[0];
    expect(routeTo(deck, state, drone!, { q: 99, r: 99 })).toBeNull();
  });

  it("stops where a zone of control holds it, and routes no further", () => {
    const { deck, state } = testMission();
    const drone = state.units[0]!;
    const reach = [...reachableHexes(deck, state, drone).keys()];
    const [q, r] = reach[0]!.split(",").map(Number);
    const blocker = makeUnit("sentinel", 90, { q: q!, r: r! }, REFERENCE_HEX_FEET);
    const watched: GameState = { ...state, units: [...state.units, blocker] };

    const after = reachFrom(deck, watched, drone);
    for (const [key, entry] of after) {
      if (entry.from === null) continue;
      const [hq, hr] = key.split(",").map(Number);
      const held = hexDistance({ q: hq!, r: hr! }, blocker.at) === 1;
      /* A hex in its reach may be entered but never stepped out of. */
      if (!held) continue;
      for (const [otherKey, other] of after) {
        if (other.from === null) continue;
        if (hexKey(other.from) === key) {
          throw new Error(`routed out of ${key} into ${otherKey} while held`);
        }
      }
    }
    expect(after.size).toBeGreaterThan(0);
  });
});
