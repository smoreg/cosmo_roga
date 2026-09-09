import { describe, it, expect } from "vitest";
import { DOOR_LOSS, doorLoss, loudestRoom, propagateRooms } from "../src/rooms/noise.js";
import { shipFromText } from "../src/testing/roomfixtures.js";

const CHAIN = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
`;

describe("propagateRooms", () => {
  it("loses one at every open door, and never gains", () => {
    const { ship } = shipFromText(CHAIN);
    const heard = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 9 }]);
    const at = (label: string) => heard.get(ship.room(label).id) ?? 0;

    expect([at("r1"), at("r2"), at("r3"), at("r4")]).toEqual([9, 8, 7, 6]);
  });

  it("charges 3 for a closed door and 4 for a locked or welded one", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -(d1)- r2
      r1 -[d2:k1]- r3
      r1 -#d3#- r4
      r1 -·d4·- r5
    `);
    const heard = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 9 }]);
    const at = (label: string) => heard.get(ship.room(label).id) ?? 0;

    expect(at("r2")).toBe(6);
    expect(at("r3")).toBe(5);
    expect(at("r4")).toBe(5);
    expect(at("r5")).toBe(8);
  });

  it("stops dead at the airlock", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
    `);
    // The tug is not a room, so the only thing to check is that the door the
    // player leaves by leaks nothing: turn d1 into a second airlock and listen.
    ship.door("d1").state = "airlock";
    const heard = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 9 }]);
    expect(heard.get(ship.room("r2").id) ?? 0).toBe(0);
    expect(DOOR_LOSS.airlock).toBe(Infinity);
  });

  it("dies out rather than going negative", () => {
    const { ship } = shipFromText(CHAIN);
    const heard = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 2 }]);
    expect(heard.get(ship.room("r2").id)).toBe(1);
    expect(heard.has(ship.room("r3").id)).toBe(false);
    expect(heard.get(ship.room("r3").id) ?? 0).toBe(0);
  });

  it("lets a vented room hear, and passes nothing on through it", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3
      r2: void vented
    `);
    const heard = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 9 }]);
    expect(heard.get(ship.room("r2").id)).toBe(8);
    expect(heard.get(ship.room("r3").id) ?? 0).toBe(0);
  });

  it("lets a vented source be heard nowhere", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking vented
    `);
    const heard = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 9 }]);
    expect(heard.get(ship.room("r1").id)).toBe(9);
    expect(heard.get(ship.room("r2").id) ?? 0).toBe(0);
  });

  it("takes the loudest of two sources, never their sum", () => {
    const { ship } = shipFromText(CHAIN);
    const heard = propagateRooms(ship, [
      { room: ship.room("r1").id, strength: 6 },
      { room: ship.room("r4").id, strength: 9 },
    ]);
    const at = (label: string) => heard.get(ship.room(label).id) ?? 0;

    expect(at("r1")).toBe(6); // 6 here, 6 arriving from r4: not 12
    expect(at("r2")).toBe(7); // the loud one three doors away beats the quiet neighbour
    expect(at("r3")).toBe(8);
    expect(at("r4")).toBe(9);
  });

  it("takes a loss table of the caller's own", () => {
    const { ship } = shipFromText(CHAIN);
    const muffled = propagateRooms(ship, [{ room: ship.room("r1").id, strength: 9 }], (d) => doorLoss(d) + 3);
    expect(muffled.get(ship.room("r2").id)).toBe(5);
    expect(muffled.get(ship.room("r3").id)).toBe(1);
  });

  it("ignores silence and rooms that are not there", () => {
    const { ship } = shipFromText(CHAIN);
    expect(propagateRooms(ship, [{ room: ship.room("r1").id, strength: 0 }]).size).toBe(0);
    expect(propagateRooms(ship, [{ room: 99, strength: 9 }]).size).toBe(0);
    expect(propagateRooms(ship, []).size).toBe(0);
  });
});

describe("loudestRoom", () => {
  it("finds the loudest room within earshot and nothing beyond it", () => {
    const { ship } = shipFromText(CHAIN);
    const heard = propagateRooms(ship, [{ room: ship.room("r4").id, strength: 9 }]);
    expect(loudestRoom(ship, heard, ship.room("r1").id, 3)).toBe(ship.room("r4").id);
    expect(loudestRoom(ship, heard, ship.room("r1").id, 1)).toBe(ship.room("r2").id);
    expect(loudestRoom(ship, new Map(), ship.room("r1").id, 3)).toBeUndefined();
  });
});
