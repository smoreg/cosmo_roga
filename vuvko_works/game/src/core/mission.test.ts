import { describe, expect, it } from "vitest";
import { cellsOfZone } from "./deck";
import { hexKey } from "./hex";
import { isLiveNode, isLiveSpawner } from "./topology";
import { testMission } from "./test/fixtures";
import type { BuiltMission } from "./mission";

function namesOf(mission: BuiltMission, kind: "spawner" | "node"): string[] {
  const out: string[] = [];
  for (const object of mission.state.objects) {
    if (object.kind === kind) out.push(object.name);
  }
  return out.sort();
}

describe("standing up a mission", () => {
  it("builds spawn zones out of the rooms that run the ship", () => {
    /* Read off the taxonomy, not the room's name: this ship has no weapons bay
       at all, and a name-matching rule would have found one spawner. */
    const mission = testMission();
    expect(namesOf(mission, "spawner")).toEqual([
      "Bridge spawner",
      "Engineering 2 spawner",
      "Engineering spawner",
    ]);
    for (const object of mission.state.objects) {
      if (object.kind !== "spawner") continue;
      const zone = mission.deck.zones.get(object.zoneId);
      expect(zone).toBeDefined();
      const roles = zone?.roles ?? [];
      expect(roles.includes("weapon") || roles.includes("command") || roles.includes("drive")).toBe(
        true,
      );
    }
  });

  it("never puts a spawn zone in the compartment you board through", () => {
    const mission = testMission();
    for (const object of mission.state.objects) {
      if (object.kind !== "spawner") continue;
      expect(object.zoneId).not.toBe(mission.deck.entryZoneId);
    }
  });

  it("gives every reachable room over three hexes a node, and skips the rest", () => {
    const mission = testMission();
    expect(mission.report.nodeCount).toBe(6);
    expect(namesOf(mission, "node")).toContain("50-dTon Hangar & Shuttle 2 node");
    for (const object of mission.state.objects) {
      const zone = mission.deck.zones.get(object.zoneId);
      expect(zone).toBeDefined();
      expect(mission.deck.reachableZones.has(object.zoneId)).toBe(true);
    }
  });

  it("never places machinery where it would wall the deck off", () => {
    /* The prototype had exactly this bug: a node on the single hex joining two
       areas made part of the ship unreachable and nothing said so. */
    for (const mission of [testMission()]) {
      const blocked = new Set<string>();
      for (const object of mission.state.objects) blocked.add(hexKey(object.at));

      const playable = [...mission.deck.cells.values()].filter((cell) =>
        mission.deck.reachableZones.has(cell.zoneId),
      );
      const free = playable.filter((cell) => !blocked.has(hexKey(cell.at)));
      const start = free[0];
      expect(start).toBeDefined();

      const seen = new Set<string>([hexKey(start!.at)]);
      const pending = [start!.at];
      while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined) break;
        const neighbours = [
          { q: current.q + 1, r: current.r },
          { q: current.q + 1, r: current.r - 1 },
          { q: current.q, r: current.r + 1 },
          { q: current.q, r: current.r - 1 },
          { q: current.q - 1, r: current.r + 1 },
          { q: current.q - 1, r: current.r },
        ];
        for (const neighbour of neighbours) {
          const key = hexKey(neighbour);
          if (seen.has(key) || blocked.has(key)) continue;
          const cell = mission.deck.cells.get(key);
          if (!cell || !mission.deck.reachableZones.has(cell.zoneId)) continue;
          const sameRoom = mission.deck.cells.get(hexKey(current))?.zoneId === cell.zoneId;
          const hasDoor = mission.deck.doorsByEdge.has(
            hexKey(current) < key ? `${hexKey(current)}|${key}` : `${key}|${hexKey(current)}`,
          );
          if (!sameRoom && !hasDoor) continue;
          seen.add(key);
          pending.push(neighbour);
        }
      }
      expect(seen.size).toBe(free.length);
    }
  });

  it("lands two drones in the boarding compartment", () => {
    const mission = testMission();
    const drones = mission.state.units;
    expect(drones).toHaveLength(2);
    for (const drone of drones) {
      const cell = mission.deck.cells.get(hexKey(drone.at));
      expect(cell?.zoneId).toBe(mission.deck.entryZoneId);
      expect(drone.hp).toBe(12);
      expect(drone.maxMovement).toBe(4);
    }
    expect(cellsOfZone(mission.deck, mission.deck.entryZoneId).length).toBeGreaterThan(2);
  });

  it("reports the rooms it left without a node", () => {
    /* None on this ship; the report exists so a sealed one is never silent. */
    expect(testMission().report.unreachableRooms).toEqual([]);
  });

  it("starts the doors as the generator drew them", () => {
    const mission = testMission();
    for (const door of mission.deck.doors) {
      expect(mission.state.doorStates.get(door.id)).toBe(door.initialState);
    }
    expect([...mission.state.doorStates.values()].filter((s) => s === "locked")).toHaveLength(2);
  });

  it("honours the tuning overrides", () => {
    const mission = testMission({ spawnerHitPoints: 8, nodeHitPoints: 3, incomePerNode: 0.75 });
    expect(mission.state.objects.find(isLiveSpawner)?.maxHp).toBe(8);
    expect(mission.state.objects.find(isLiveNode)?.maxHp).toBe(3);
    expect(mission.state.incomePerNode).toBe(0.75);
  });
});
