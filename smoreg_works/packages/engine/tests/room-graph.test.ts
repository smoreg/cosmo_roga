import { describe, it, expect } from "vitest";
import { Ship, walkerOf, type Door, type Room } from "../src/rooms/graph.js";
import { Faction, makeEntity } from "../src/sim/entity.js";
import { shipFromText } from "../src/testing/roomfixtures.js";

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3
  r2 -[d3:k1]- r4
  r4 -#d4#- r5
  r3 -·d5·- r5
`;

function drone(breacher = false) {
  return makeEntity({
    name: "drone", ch: "@", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Player,
    hp: 10, hpMax: 10, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 6, breacher,
  });
}

function machine(breacher = false) {
  return makeEntity({
    name: "unit", ch: "S", fg: "#f00", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 8, hpMax: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 6, breacher,
  });
}

describe("Ship", () => {
  it("finds rooms and doors by label and refuses the ones it has not got", () => {
    const { ship } = shipFromText(SHIP);
    expect(ship.room("r3").label).toBe("r3");
    expect(ship.door("d3").key).toBe("k1");
    expect(() => ship.room("r9")).toThrow(/no room labelled/);
    expect(() => ship.door("d9")).toThrow(/no door labelled/);
  });

  it("lists the doors of a room and what is on the far side", () => {
    const { ship } = shipFromText(SHIP);
    const r2 = ship.room("r2").id;
    expect(ship.doorsOf(r2).map((d) => d.label)).toEqual(["d1", "d2", "d3"]);
    expect(ship.neighbours(r2).map((n) => n.room.label)).toEqual(["r1", "r3", "r4"]);
    expect(ship.other(ship.door("d1"), r2)).toBe(ship.room("r1").id);
    expect(() => ship.other(ship.door("d4"), r2)).toThrow(/does not touch/);
  });

  it("lets anything through open, closed and broken doors", () => {
    const { ship } = shipFromText(SHIP);
    for (const label of ["d1", "d2", "d5"]) {
      expect(ship.passable(ship.door(label), {})).toBe(true);
      expect(ship.passable(ship.door(label), walkerOf(machine()))).toBe(true);
    }
  });

  it("holds a machine without a cutter at a locked or sealed door", () => {
    const { ship } = shipFromText(SHIP);
    for (const label of ["d3", "d4"]) {
      expect(ship.passable(ship.door(label), walkerOf(machine()))).toBe(false);
      expect(ship.passable(ship.door(label), walkerOf(drone()))).toBe(false);
      expect(ship.passable(ship.door(label), walkerOf(machine(true)))).toBe(true);
      expect(ship.passable(ship.door(label), walkerOf(drone(true)))).toBe(true);
    }
  });

  it("opens the airlock to the player and to nobody else", () => {
    const { ship } = shipFromText(SHIP);
    const a1 = ship.door("a1");
    expect(ship.passable(a1, walkerOf(drone()))).toBe(true);
    expect(ship.passable(a1, walkerOf(machine()))).toBe(false);
    expect(ship.passable(a1, walkerOf(machine(true)))).toBe(false);
    expect(ship.passable(a1, { breacher: true })).toBe(false);
  });

  it("sees through open and broken doors only", () => {
    const { ship } = shipFromText(SHIP);
    expect(ship.seeThrough(ship.door("d1"))).toBe(true);
    expect(ship.seeThrough(ship.door("d5"))).toBe(true);
    expect(ship.seeThrough(ship.door("d2"))).toBe(false);
    expect(ship.seeThrough(ship.door("d3"))).toBe(false);
    expect(ship.seeThrough(ship.door("d4"))).toBe(false);
    expect(ship.seeThrough(ship.door("a1"))).toBe(false);
  });

  it("survives a round trip through JSON", () => {
    const { ship } = shipFromText(SHIP);
    ship.room("r3").data.searched = true;
    const raw = JSON.stringify(ship);

    expect(Object.keys(JSON.parse(raw))).toEqual(["rooms", "doors", "entry"]);
    const back = Ship.rehydrate(JSON.parse(raw));
    expect(back.toJSON()).toEqual(ship.toJSON());
    expect(back.room("r3").data.searched).toBe(true);
    expect(back.doorsOf(back.room("r2").id).map((d) => d.label)).toEqual(["d1", "d2", "d3"]);
  });

  it("insists on dense ids, because everything else indexes by them", () => {
    const room = (id: number, label: string): Room => ({
      id, label, kind: "room", name: "ROOM", depth: 0, col: 0, row: 0,
      cover: false, hazard: "none", explored: false, scanned: false, marks: [], data: {},
    });
    const door = (id: number, a: number, b: number): Door => ({ id, label: `d${id}`, a, b, state: "open" });

    expect(() => new Ship([room(0, "r1"), room(2, "r2")], [], 0)).toThrow(/dense/);
    expect(() => new Ship([room(0, "r1")], [door(1, 0, 0)], 0)).toThrow(/dense/);
    expect(() => new Ship([room(0, "r1")], [door(0, 0, 3)], 0)).toThrow(/do not exist/);
    expect(() => new Ship([room(0, "r1")], [], 4)).toThrow(/is not a room/);
  });

  it("reaches a game through the package entry point, beside the grid model", async () => {
    // A star export that clashes is dropped silently rather than reported, so
    // the aliases in rooms/index.ts are worth one assertion at value level.
    const engine = await import("../src/index.js");
    expect(typeof engine.Ship).toBe("function");
    expect(typeof engine.canSee).toBe("function");
    expect(typeof engine.propagateRooms).toBe("function");
    expect(typeof engine.RoomDistance).toBe("function");
    expect(typeof engine.spawnMonsterIn).toBe("function");
    expect(engine.roomBehaviourByName("brute")).toBe(engine.brute);
    expect(typeof engine.behaviourByName("brute")).toBe("function"); // still the grid one
    expect(engine.ROOM_BEHAVIOURS).not.toBe(engine.BEHAVIOURS);
  });

  it("reads passability straight off an entity", () => {
    const { ship } = shipFromText(SHIP);
    expect(walkerOf(drone())).toEqual({ breacher: false, isPlayer: true });
    expect(walkerOf(machine(true))).toEqual({ breacher: true, isPlayer: false });
    expect(ship.airlock()?.label).toBe("a1");
  });
});
