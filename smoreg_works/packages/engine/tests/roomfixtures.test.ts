import { describe, it, expect } from "vitest";
import { shipFromText, shipToText, layoutShip } from "../src/testing/roomfixtures.js";

const SAMPLE = `
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3
  r2 -[d3:k1]- r4
  r1: docking @
  r2: cargo m:scout %thrusters:2 †:k1 cover
`;

describe("shipFromText", () => {
  it("reads rooms, doors and the player out of five lines", () => {
    const f = shipFromText(SAMPLE);
    expect(f.ship.rooms.map((r) => r.label)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(f.ship.doors.map((d) => d.label)).toEqual(["a1", "d1", "d2", "d3"]);
    expect(f.player).toBe(f.ship.room("r1").id);
    expect(f.ship.room("r1").kind).toBe("docking");
    expect(f.ship.room("r2").cover).toBe(true);
    expect(f.ship.room("r2").marks).toEqual(["m:scout", "%thrusters:2", "†:k1"]);
  });

  it("gives a room named only in an edge line the kind 'room'", () => {
    const f = shipFromText("r1 -d1- r9");
    expect(f.ship.room("r9").kind).toBe("room");
    expect(f.ship.room("r9").name).toBe("ROOM");
  });

  it("hangs the airlock off the entry room and lets nothing through it", () => {
    const f = shipFromText(SAMPLE);
    const a1 = f.ship.door("a1");
    expect(a1.state).toBe("airlock");
    expect(f.ship.entry).toBe(f.ship.room("r1").id);
    expect(a1.a).toBe(a1.b); // the outside is not a room
    expect(f.ship.passable(a1, {})).toBe(false);
    expect(f.ship.passable(a1, { isPlayer: true })).toBe(true);
  });

  it("finds a room by its mark, with or without the mark's argument", () => {
    const f = shipFromText(SAMPLE);
    expect(f.mark("†")).toBe(f.ship.room("r2").id);
    expect(f.mark("m:scout")).toBe(f.ship.room("r2").id);
    expect(() => f.mark("Z")).toThrow(/no mark/);
  });

  it("counts depth in doors from the airlock, loops and all", () => {
    // r4 is two doors away down either branch; the loop must not deepen it.
    const f = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r4
      r1 -d3- r3 -d4- r4
      r4 -d5- r5
    `);
    const depth = (label: string) => f.ship.room(label).depth;
    expect([depth("r1"), depth("r2"), depth("r3"), depth("r4"), depth("r5")]).toEqual([0, 1, 1, 2, 3]);
  });

  it("counts depth through shut doors too — a locked room is not further away", () => {
    const f = shipFromText(`
      TUG -a1- r1
      r1 -[d1:k1]- r2 -#d2#- r3
    `);
    expect(f.ship.room("r3").depth).toBe(2);
  });

  it("lays rooms out one column per depth", () => {
    const f = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1 -d2- r3
    `);
    layoutShip(f.ship);
    expect(f.ship.rooms.map((r) => [r.col, r.row])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it("refuses a line it cannot read", () => {
    expect(() => shipFromText("r1 -d1-")).toThrow(/cannot read/);
    expect(() => shipFromText("r1 (d1) r2")).toThrow(/is not a door/);
    expect(() => shipFromText("r1 -(d1- r2")).toThrow(/is not closed/);
    expect(() => shipFromText("")).toThrow(/no rooms/);
  });
});

describe("shipToText", () => {
  it("round-trips all six door states and a key", () => {
    const f = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -(d2)- r3
      r3 -[d3]- r4
      r4 -[d4:k1]- r5
      r5 -#d5#- r6
      r6 -·d6·- r7
      r1: docking cover
      r3: lab vented explored
      r7: hold scanned † *
    `);
    const text = shipToText(f.ship);
    const again = shipFromText(text);

    expect(again.ship.toJSON()).toEqual(f.ship.toJSON());
    expect(f.ship.doors.map((d) => d.state)).toEqual([
      "airlock",
      "open",
      "closed",
      "locked",
      "locked",
      "sealed",
      "broken",
    ]);
    expect(f.ship.door("d4").key).toBe("k1");
    expect(text).toContain("r4 -[d4:k1]- r5");
    expect(text).toContain("TUG -a1- r1");
  });

  it("accepts the ASCII spelling of a broken door", () => {
    const f = shipFromText("r1 -.d1.- r2");
    expect(f.ship.door("d1").state).toBe("broken");
  });

  it("keeps cover, hazard and what has been seen", () => {
    const f = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking cover explored
      r2: lab hazard:fire scanned m
    `);
    const again = shipFromText(shipToText(f.ship));
    expect(again.ship.room("r1").explored).toBe(true);
    expect(again.ship.room("r2").hazard).toBe("fire");
    expect(again.ship.room("r2").scanned).toBe(true);
    expect(again.ship.room("r2").marks).toEqual(["m"]);
  });
});
