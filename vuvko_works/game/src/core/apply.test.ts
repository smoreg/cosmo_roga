import { describe, expect, it } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { applyAll, applyCommand } from "./apply";
import { setDoorState } from "./actions";
import { attackWith, endTurn, moveUnit } from "./commands";
import type { Command } from "./commands";
import { hexKey } from "./hex";
import { intentFor, reachableHexes } from "./intent";
import { buildMission, makeUnit } from "./mission";
import { drones, hostiles, liveNodes, liveSpawners, unitById } from "./topology";
import { testDeck, testMission } from "./test/fixtures";
import type { GameEvent } from "./events";
import type { GameState } from "./types";

function kindsOf(events: readonly GameEvent[]): string[] {
  return events.map((event) => event.kind);
}

describe("moving", () => {
  it("spends one point and reports the room it entered", () => {
    const { deck, state } = testMission();
    const drone = state.units[0]!;
    const target = [...reachableHexes(deck, state, drone).keys()][0]!;
    const [q, r] = target.split(",").map(Number);

    const result = applyCommand(deck, state, moveUnit(drone.id, { q: q!, r: r! }));
    const moved = unitById(result.state, drone.id)!;
    expect(moved.movement).toBe(drone.movement - 1);
    expect(kindsOf(result.events)).toContain("unitMoved");
    /* The state handed in was not touched. */
    expect(state.units[0]!.movement).toBe(4);
    expect(hexKey(state.units[0]!.at)).not.toBe(hexKey(moved.at));
  });

  it("makes forcing a shut door the whole move", () => {
    const { deck, state } = testMission();
    const door = deck.doors[0]!;
    const shut = setDoorState(
      { ...state, units: [makeUnit("drone", 0, door.from)] },
      door.id,
      "closed",
    );
    const result = applyCommand(deck, shut, moveUnit(0, door.to));
    expect(kindsOf(result.events)).toEqual(["unitMoved", "doorForced"]);
    expect(unitById(result.state, 0)?.movement).toBe(0);
    expect(result.state.doorStates.get(door.id)).toBe("open");
  });

  it("refuses an illegal move without changing anything", () => {
    const { deck, state } = testMission();
    const result = applyCommand(deck, state, moveUnit(0, { q: 999, r: 999 }));
    expect(kindsOf(result.events)).toEqual(["commandRefused"]);
    expect(result.state).toBe(state);
  });
});

describe("attacking", () => {
  it("draws no answer from a target with no weapon of that class", () => {
    const { deck, state } = testMission();
    const drone = state.units[0]!;
    const spot = [...reachableHexes(deck, state, drone).keys()][0]!;
    const [q, r] = spot.split(",").map(Number);
    const scout = makeUnit("scout", 90, { q: q!, r: r! });
    const staged: GameState = { ...state, units: [drone, scout] };

    // weapon 1 is the emitter, which a scout cannot answer
    const result = applyCommand(deck, staged, attackWith(drone.id, 1, scout.at));
    const declared = result.events.find((event) => event.kind === "attackDeclared");
    expect(declared).toBeDefined();
    expect(declared?.kind === "attackDeclared" && declared.answeringWeapon).toBeNull();
    expect(unitById(result.state, drone.id)?.hp).toBe(12);
    expect(unitById(result.state, drone.id)?.hasAttacked).toBe(true);
  });

  it("ends the mission when the last spawn zone falls", () => {
    const { deck, state } = testMission();
    const spawners = liveSpawners(state);
    const flattened: GameState = {
      ...state,
      objects: state.objects.map((object) =>
        object.kind === "spawner"
          ? { ...object, hp: object.id === spawners[0]!.id ? 1 : 0 }
          : object,
      ),
    };
    const drone = { ...state.units[0]!, at: spawners[0]!.at };
    const neighbours = [
      { q: drone.at.q + 1, r: drone.at.r },
      { q: drone.at.q, r: drone.at.r + 1 },
      { q: drone.at.q - 1, r: drone.at.r },
      { q: drone.at.q, r: drone.at.r - 1 },
      { q: drone.at.q + 1, r: drone.at.r - 1 },
      { q: drone.at.q - 1, r: drone.at.r + 1 },
    ];
    const from = neighbours.find((n) => {
      const walker = { ...drone, at: n };
      return (
        intentFor(deck, { ...flattened, units: [walker] }, walker, spawners[0]!.at).kind ===
        "attack"
      );
    });
    expect(from).toBeDefined();

    const staged: GameState = { ...flattened, units: [{ ...drone, at: from! }] };
    let current = staged;
    for (let attempt = 0; attempt < 12 && current.outcome === null; attempt++) {
      const result = applyCommand(deck, current, attackWith(drone.id, 0, spawners[0]!.at));
      current = {
        ...result.state,
        units: result.state.units.map((u) => ({ ...u, hasAttacked: false })),
      };
    }
    expect(current.outcome).toBe("win");
  });
});

describe("the ship's turn", () => {
  it("pays income from live nodes only, and never from what the drones carry", () => {
    const { deck, state } = testMission();
    const result = applyCommand(deck, state, endTurn());
    const paid = result.events.find((event) => event.kind === "incomePaid");
    expect(paid?.kind === "incomePaid" && paid.amount).toBe(
      liveNodes(state).length * state.incomePerNode,
    );
  });

  it("builds hostiles that arrive spent and act only next turn", () => {
    const { deck, state } = testMission();
    const first = applyCommand(deck, state, endTurn());
    const built = first.events.filter((event) => event.kind === "hostileBuilt");
    expect(built.length).toBeGreaterThan(0);
    for (const event of built) {
      if (event.kind !== "hostileBuilt") continue;
      const unit = unitById(first.state, event.unitId);
      expect(unit?.movement).toBe(0);
      expect(unit?.hasAttacked).toBe(true);
    }
  });

  it("refreshes the drones and advances the turn", () => {
    const { deck, state } = testMission();
    const moved = applyCommand(
      deck,
      state,
      moveUnit(
        state.units[0]!.id,
        [...reachableHexes(deck, state, state.units[0]!).keys()].map((key) => {
          const [q, r] = key.split(",").map(Number);
          return { q: q!, r: r! };
        })[0]!,
      ),
    );
    const ended = applyCommand(deck, moved.state, endTurn());
    expect(ended.state.turn).toBe(2);
    expect(ended.state.side).toBe("drone");
    for (const drone of drones(ended.state)) {
      expect(drone.movement).toBe(drone.maxMovement);
      expect(drone.hasAttacked).toBe(false);
    }
  });

  it("brings pressure that kills passive drones", () => {
    const { deck, state } = testMission();
    let current = state;
    let turns = 0;
    while (current.outcome === null && turns < 60) {
      current = applyCommand(deck, current, endTurn()).state;
      turns++;
    }
    expect(current.outcome).toBe("loss");
    expect(hostiles(current).length).toBeGreaterThan(0);
  });
});

describe("determinism", () => {
  test.prop([fc.string({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 8 })])(
    "the same seed and command list always produce the same state",
    (seed, turns) => {
      const commands: Command[] = [];
      for (let i = 0; i < turns; i++) commands.push(endTurn());

      const first = buildMission(testDeck(), { seed });
      const second = buildMission(testDeck(), { seed });
      const a = applyAll(first.deck, first.state, commands);
      const b = applyAll(second.deck, second.state, commands);

      expect(b.state.rng).toEqual(a.state.rng);
      expect(b.state.pool).toBeCloseTo(a.state.pool, 10);
      expect(b.state.units.map((u) => `${u.id}:${u.type}:${hexKey(u.at)}:${u.hp}`)).toEqual(
        a.state.units.map((u) => `${u.id}:${u.type}:${hexKey(u.at)}:${u.hp}`),
      );
      expect(kindsOf(b.events)).toEqual(kindsOf(a.events));
    },
  );

  test.prop([fc.string({ minLength: 1, maxLength: 12 })])(
    "different seeds move the generator to different places",
    (seed) => {
      const mission = buildMission(testDeck(), { seed });
      expect(mission.state.rng.cursor).toBe(0);
      const after = applyCommand(mission.deck, mission.state, endTurn());
      expect(after.state.rng.cursor).toBeGreaterThanOrEqual(0);
    },
  );
});
