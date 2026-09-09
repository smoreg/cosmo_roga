import { describe, it, expect } from "vitest";
import { RoomDistance, blockedBy, exploreTarget } from "../src/rooms/paths.js";
import type { Door, Ship } from "../src/rooms/graph.js";
import { shipFromText } from "../src/testing/roomfixtures.js";

/** The plain walking rule: shut doors stop you, cutters and airlocks aside. */
const walk = (ship: Ship) => (d: Door) => ship.passable(d, {});
const cut = (ship: Ship) => (d: Door) => ship.passable(d, { breacher: true });

const CHAIN = `
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3
`;

describe("RoomDistance", () => {
  it("counts doors from the goal", () => {
    const { ship } = shipFromText(CHAIN);
    const map = RoomDistance.from(ship, [ship.room("r1").id], walk(ship));
    expect(map.at(ship.room("r1").id)).toBe(0);
    expect(map.at(ship.room("r2").id)).toBe(1);
    expect(map.at(ship.room("r3").id)).toBe(2);
    expect(map.toText()).toBe("r1:0 r2:1 r3:2");
  });

  it("walks downhill and stops at the goal", () => {
    const { ship } = shipFromText(CHAIN);
    const map = RoomDistance.from(ship, [ship.room("r1").id], walk(ship));
    expect(map.nextDoor(ship.room("r3").id, walk(ship))?.label).toBe("d2");
    expect(map.nextDoor(ship.room("r2").id, walk(ship))?.label).toBe("d1");
    expect(map.nextDoor(ship.room("r1").id, walk(ship))).toBeUndefined();
  });

  it("takes the lower door id when two ways down are equally good", () => {
    // r2 and r3 both sit one door from r4 and one door from r1.
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d3- r4
      r1 -d2- r3 -d4- r4
    `);
    const map = RoomDistance.from(ship, [ship.room("r4").id], walk(ship));
    expect(map.at(ship.room("r2").id)).toBe(1);
    expect(map.at(ship.room("r3").id)).toBe(1);
    expect(map.nextDoor(ship.room("r1").id, walk(ship))?.label).toBe("d1");
  });

  it("is Infinity behind a door this walker cannot open", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -[d1:k1]- r2
    `);
    const from = [ship.room("r1").id];
    expect(RoomDistance.from(ship, from, walk(ship)).at(ship.room("r2").id)).toBe(Infinity);
    expect(RoomDistance.from(ship, from, cut(ship)).at(ship.room("r2").id)).toBe(1);
  });

  it("seeds a goal even when nothing can walk to it", () => {
    // "How far to the machines" has to work when every door to them is welded.
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -#d1#- r2
    `);
    const map = RoomDistance.from(ship, [ship.room("r2").id], walk(ship));
    expect(map.at(ship.room("r2").id)).toBe(0);
    expect(map.at(ship.room("r1").id)).toBe(Infinity);
  });

  it("flees away from the threat instead of into a dead end", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3 -d3- r4
    `);
    const threat = RoomDistance.from(ship, [ship.room("r1").id], walk(ship));
    const safety = threat.flee(walk(ship));

    expect(safety.at(ship.room("r2").id)).toBeGreaterThan(safety.at(ship.room("r4").id));
    expect(safety.nextDoor(ship.room("r2").id, walk(ship))?.label).toBe("d2");
    expect(safety.nextDoor(ship.room("r4").id, walk(ship))).toBeUndefined();
  });

  it("sums desires with weights: towards the player, away from the pack", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3 -d3- r4
    `);
    const player = RoomDistance.from(ship, [ship.room("r1").id], walk(ship));
    const ally = RoomDistance.from(ship, [ship.room("r3").id], walk(ship));
    const desire = RoomDistance.combine([
      { map: player, weight: 1 },
      { map: ally, weight: -0.5 },
    ]);

    const v = (label: string) => desire.at(ship.room(label).id);
    expect(v("r1")).toBeCloseTo(-1);
    expect(v("r2")).toBeCloseTo(0.5);
    expect(v("r3")).toBeCloseTo(2);
    expect(v("r4")).toBeCloseTo(2.5);
    expect(desire.nextDoor(ship.room("r2").id, walk(ship))?.label).toBe("d1");
  });

  it("keeps a room unreachable when any one part cannot reach it", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1 -#d2#- r3
    `);
    const near = RoomDistance.from(ship, [ship.room("r1").id], walk(ship));
    const far = RoomDistance.from(ship, [ship.room("r3").id], walk(ship));
    const both = RoomDistance.combine([{ map: near, weight: 1 }, { map: far, weight: 1 }]);
    expect(both.at(ship.room("r2").id)).toBe(Infinity);
    expect(() => RoomDistance.combine([])).toThrow(/no parts/);
  });
});

describe("exploreTarget", () => {
  it("points at the door towards the nearest room never stood in", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3
      r1 -d3- r4
      r1: docking explored
      r2: cargo explored
      r4: hold explored
    `);
    expect(exploreTarget(ship, ship.room("r1").id, walk(ship))?.label).toBe("d1");
    expect(exploreTarget(ship, ship.room("r2").id, walk(ship))?.label).toBe("d2");
  });

  it("gives up when the ship is explored", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking explored
      r2: cargo explored
    `);
    expect(exploreTarget(ship, ship.room("r1").id, walk(ship))).toBeUndefined();
  });

  it("gives up when what is left is behind a locked door", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -[d1:k1]- r2
      r1: docking explored
    `);
    expect(exploreTarget(ship, ship.room("r1").id, walk(ship))).toBeUndefined();
    expect(exploreTarget(ship, ship.room("r1").id, cut(ship))?.label).toBe("d1");
  });
});

describe("blockedBy", () => {
  it("names the locked door and only it", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -[d2:k1]- r3
      r2 -#d3#- r4
      r1: docking explored
      r2: cargo explored
      r4: void explored
    `);
    expect(blockedBy(ship, ship.room("r1").id).map((d) => d.label)).toEqual(["d2"]);
  });

  it("says nothing while auto-explore can still reach something", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -[d2:k1]- r3
      r1: docking explored
    `);
    expect(blockedBy(ship, ship.room("r1").id)).toEqual([]);
  });

  it("ignores a shut door that only leads somewhere already reachable", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1 -#d2#- r2
      r2 -[d3:k1]- r3
      r1: docking explored
      r2: cargo explored
    `);
    expect(blockedBy(ship, ship.room("r1").id).map((d) => d.label)).toEqual(["d3"]);
  });

  it("does not call the airlock a way further in", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -[d1:k1]- r2
      r1: docking explored
    `);
    expect(blockedBy(ship, ship.room("r1").id).map((d) => d.label)).toEqual(["d1"]);
  });
});
