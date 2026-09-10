import { describe, it, expect } from "vitest";
import { canSee, visibleRooms, scanRooms } from "../src/rooms/sight.js";
import { MessageLog } from "../src/sim/log.js";
import { Faction, makeEntity, type Entity } from "../src/sim/entity.js";
import { shipFromText, shipToText } from "../src/testing/roomfixtures.js";

/**
 * The three things the engine grew for a game's hazards, and none of them a
 * word of any game: a trap on a door (`Door.trap`), a room nobody sees into or
 * out of (`Room.opaque`), and a tone of log line that is drawn on a red ground
 * (`alarm`). The fixture DSL spells all three, so a test about a mined door is
 * four lines anybody can read.
 */

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r1: docking @
  r3: cargo hazard=fire
  r5: hab hazard=smoke opaque cover
  d3: trap=mine
  d2: broken
`;

function actor(room: number, extra: Partial<Entity> = {}): Entity {
  return makeEntity({
    name: "unit", ch: "u", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 8, hpMax: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 6, room, ...extra,
  });
}

describe("the fixture DSL spells hazards", () => {
  it("reads hazard=, opaque and a door line with trap= off the text", () => {
    const f = shipFromText(SHIP);
    expect(f.ship.room("r3").hazard).toBe("fire");
    expect(f.ship.room("r5").hazard).toBe("smoke");
    expect(f.ship.room("r5").opaque).toBe(true);
    expect(f.ship.room("r5").cover).toBe(true);
    expect(f.ship.room("r2").opaque).toBeUndefined();
    expect(f.ship.door("d3").trap).toBe("mine");
    expect(f.ship.door("d3").key).toBe("k1");
    expect(f.ship.door("d3").state).toBe("locked");
    // A door line may re-state the door, and does so after the edge declared it.
    expect(f.ship.door("d2").state).toBe("broken");
    expect(f.ship.door("d2").trap).toBeUndefined();
  });

  it("still reads the colon spelling, and never takes a room line for a door line", () => {
    const f = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r2: lab hazard:fire
    `);
    expect(f.ship.room("r2").hazard).toBe("fire");
    // A label no door carries is a room, however it is spelled.
    const g = shipFromText("d1: cargo\nd1 -d9- r2");
    expect(g.ship.room("d1").kind).toBe("cargo");
  });

  it("refuses a door token it cannot read", () => {
    expect(() => shipFromText("r1 -d1- r2\nd1: mined")).toThrow(/not a door token/);
    expect(() => shipFromText("r1 -d1- r2\nd1: trap=")).toThrow(/not a door token/);
  });

  it("round-trips a trap, an opaque room and a hazard through shipToText", () => {
    const f = shipFromText(SHIP);
    const text = shipToText(f.ship);
    expect(text).toContain("d3: trap=mine");
    expect(text.some((l) => l.startsWith("r5: hab") && l.includes("hazard=smoke") && l.includes("opaque"))).toBe(
      true,
    );
    const again = shipFromText(text);
    expect(again.ship.toJSON()).toEqual(f.ship.toJSON());
  });
});

describe("an opaque room is a wall to sight", () => {
  it("is not seen into from the next room, whatever the door", () => {
    const { ship } = shipFromText(SHIP);
    const r2 = ship.room("r2").id;
    // d4 is open: r5 would be visible if it were not opaque. r1 and r3 still
    // are — a hazard that does not blind is no wall to sight.
    const seen = [...visibleRooms(ship, r2, 1)].map((id) => ship.roomAt(id).label).sort();
    expect(seen).toEqual(["r1", "r2", "r3"]);
  });

  it("shows nothing but itself from inside, and a pulse reads through it all the same", () => {
    const { ship } = shipFromText(SHIP);
    const r5 = ship.room("r5").id;
    expect([...visibleRooms(ship, r5, 2)]).toEqual([r5]);
    expect(scanRooms(ship, r5, 1).size).toBe(2);
  });

  it("blinds both parties across the door, and neither inside the room", () => {
    const { ship } = shipFromText(SHIP);
    const r2 = ship.room("r2").id;
    const r5 = ship.room("r5").id;
    const outside = actor(r2, { sight: 1 });
    const inside = actor(r5, { sight: 1 });
    expect(canSee(ship, outside, inside)).toBe(false);
    expect(canSee(ship, inside, outside)).toBe(false);
    expect(canSee(ship, inside, actor(r5))).toBe(true);
    // A room that is not opaque is seen through the same open door as before.
    expect(canSee(ship, outside, actor(ship.room("r1").id))).toBe(true);
  });
});

describe("the alarm tone", () => {
  it("is a tone like the other four, folded and kept the same way", () => {
    const log = new MessageLog();
    log.add("DANGER", 1, "alarm", "game.danger");
    log.add("DANGER", 1, "alarm", "game.danger");
    expect(log.lines).toEqual([{ text: "DANGER", turn: 1, tone: "alarm", count: 2, key: "game.danger" }]);
  });
});
