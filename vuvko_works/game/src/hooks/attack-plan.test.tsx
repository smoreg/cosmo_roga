import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMissionInput } from "./useMissionInput";
import type { MissionInput } from "./useMissionInput";
import { deckGeometry, parseDeck } from "../core/deck";
import type { RawDeckExport } from "../core/deck";
import { hexCentre, hexKey, hexNeighbours } from "../core/hex";
import { buildMission } from "../core/mission";
import { intentFor } from "../core/intent";
import { canReachAcross, liveNodes } from "../core/topology";
import type { GameState, Unit } from "../core/types";
import raw from "../assets/decks/hollow-tide-35ft.json";

function probe(state: GameState) {
  const deck = parseDeck(raw as unknown as RawDeckExport);
  const captured: { input: MissionInput | null } = { input: null };
  function Probe() {
    captured.input = useMissionInput(deck, state, function ignore() {
      /* no commands in this test */
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function draw() {
    act(() => {
      root.render(<Probe />);
    });
  }
  draw();
  return {
    deck,
    geometry: deckGeometry(deck),
    draw,
    get input() {
      if (captured.input === null) throw new Error("not mounted");
      return captured.input;
    },
    stop() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("hovering a shut door", () => {
  it("offers to shoulder it open, and says that is the whole move", () => {
    /* The bug this pins: routes deliberately never include forcing a door, so
       for a while a shut door read as an impassable wall. */
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "shut" });
    const door = deck.doors.find((candidate) => candidate.initialState === "closed");
    expect(door).toBeDefined();

    for (const [from, to] of [
      [door!.from, door!.to],
      [door!.to, door!.from],
    ]) {
      const drone: Unit = { ...mission.state.units[0]!, at: from! };
      const state: GameState = { ...mission.state, units: [drone] };
      const harness = probe(state);

      act(() => {
        harness.input.hover(hexCentre(harness.geometry, drone.at));
      });
      harness.draw();
      act(() => {
        harness.input.pick();
      });
      harness.draw();
      expect(harness.input.selected?.id).toBe(drone.id);

      act(() => {
        harness.input.hover(hexCentre(harness.geometry, to!));
      });
      harness.draw();

      const plan = harness.input.plan;
      expect(plan).not.toBeNull();
      expect(plan!.forcesDoor).toBe(true);
      expect(plan!.arrows).toHaveLength(1);
      expect(plan!.arrows[0]?.kind).toBe("move");
      expect(plan!.why).toMatch(/whole move/);
      harness.stop();
    }
  });

  it("will not offer to walk through a locked one", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "shut" });
    const door = deck.doors.find((candidate) => candidate.initialState === "locked");
    expect(door).toBeDefined();

    const drone: Unit = { ...mission.state.units[0]!, at: door!.from };
    const state: GameState = { ...mission.state, units: [drone] };
    const harness = probe(state);
    act(() => {
      harness.input.hover(hexCentre(harness.geometry, drone.at));
    });
    harness.draw();
    act(() => {
      harness.input.pick();
    });
    harness.draw();
    act(() => {
      harness.input.hover(hexCentre(harness.geometry, door!.to));
    });
    harness.draw();

    const plan = harness.input.plan;
    /* Cut it instead: the door itself is the target. */
    expect(plan?.forcesDoor).toBe(false);
    expect(plan?.attackAt).not.toBeNull();
    expect(plan?.arrows.at(-1)?.kind).toBe("attack");
    harness.stop();
  });
});

describe("hovering something a drone can hit", () => {
  it("offers the attack when the drone is already beside a node, with no movement left", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "beside" });
    const node = liveNodes(mission.state)[0];
    expect(node).toBeDefined();

    /* Stand the drone next to the node, across an edge it can actually reach
       over, and spend all its movement. */
    const beside = hexNeighbours(node!.at).find(function usable(at) {
      if (!deck.cells.has(hexKey(at))) return false;
      if (mission.state.objects.some((object) => hexKey(object.at) === hexKey(at))) return false;
      return canReachAcross(deck, mission.state, at, node!.at);
    });
    expect(beside).toBeDefined();

    for (const movement of [4, 1, 0]) {
      const drone: Unit = { ...mission.state.units[0]!, at: beside!, movement };
      const state: GameState = { ...mission.state, units: [drone] };

      /* The rules say this is legal — attacking never needs movement. */
      expect(intentFor(deck, state, drone, node!.at).kind).toBe("attack");

      const harness = probe(state);
      act(() => {
        harness.input.pick();
      });
      harness.draw();
      act(() => {
        harness.input.hover(hexCentre(harness.geometry, drone.at));
      });
      harness.draw();
      act(() => {
        harness.input.pick();
      });
      harness.draw();
      expect(harness.input.selected?.id).toBe(drone.id);

      act(() => {
        harness.input.hover(hexCentre(harness.geometry, node!.at));
      });
      harness.draw();

      const plan = harness.input.plan;
      expect(plan, `movement ${String(movement)}: no plan at all`).not.toBeNull();
      expect(plan!.attackAt, `movement ${String(movement)}: attack not offered`).not.toBeNull();
      expect(plan!.arrows.at(-1)?.kind).toBe("attack");
      harness.stop();
    }
  });

  it("offers the attack on a spawn zone the same way", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "spawner" });
    const spawner = mission.state.objects.find((object) => object.kind === "spawner");
    expect(spawner).toBeDefined();

    const beside = hexNeighbours(spawner!.at).find(function usable(at) {
      if (!deck.cells.has(hexKey(at))) return false;
      if (mission.state.objects.some((object) => hexKey(object.at) === hexKey(at))) return false;
      return canReachAcross(deck, mission.state, at, spawner!.at);
    });
    expect(beside).toBeDefined();

    const drone: Unit = { ...mission.state.units[0]!, at: beside!, movement: 0 };
    const state: GameState = { ...mission.state, units: [drone] };
    const harness = probe(state);

    act(() => {
      harness.input.hover(hexCentre(harness.geometry, drone.at));
    });
    harness.draw();
    act(() => {
      harness.input.pick();
    });
    harness.draw();
    act(() => {
      harness.input.hover(hexCentre(harness.geometry, spawner!.at));
    });
    harness.draw();

    expect(harness.input.plan?.attackAt).not.toBeNull();
    harness.stop();
  });
});

describe("the highlight and the arrows agree", () => {
  it("marks every hex the plan would actually take the drone to", () => {
    /* The bug this pins: routes exclude forcing a door, so a hex beyond a shut
       one was offered by the arrows and never tinted — the map contradicting
       itself. */
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "shut" });
    const drone = mission.state.units[0]!;
    const state: GameState = { ...mission.state, units: [drone] };
    const harness = probe(state);

    act(() => {
      harness.input.hover(hexCentre(harness.geometry, drone.at));
    });
    harness.draw();
    act(() => {
      harness.input.pick();
    });
    harness.draw();

    const reachable = harness.input.reachable;
    const forceable = harness.input.forceable;
    expect(forceable.size).toBeGreaterThan(0);

    /* Nothing is claimed twice, and forcing is never just walking. */
    for (const key of forceable) expect(reachable.has(key)).toBe(false);

    /* Every hex the plan will move the drone onto is marked one way or the
       other — never silently unavailable. */
    let checkedForce = 0;
    for (const key of forceable) {
      const [q, r] = key.split(",").map(Number);
      act(() => {
        harness.input.hover(hexCentre(harness.geometry, { q: q!, r: r! }));
      });
      harness.draw();
      const plan = harness.input.plan;
      expect(plan, `no plan for ${key}`).not.toBeNull();
      expect(plan!.forcesDoor, `${key} should be offered by forcing`).toBe(true);
      expect(hexKey(plan!.arrows.at(-1)!.to)).toBe(key);
      checkedForce++;
    }
    expect(checkedForce).toBeGreaterThan(0);
    harness.stop();
  });
});
