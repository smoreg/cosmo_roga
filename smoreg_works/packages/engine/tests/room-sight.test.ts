import { describe, it, expect } from "vitest";
import { canSee, scanRooms, visibleRooms } from "../src/rooms/sight.js";
import { behaviourByName, brute, type RoomWorld } from "../src/rooms/behaviours.js";
import { Faction, makeEntity, type Entity } from "../src/sim/entity.js";
import { Rng } from "../src/sim/rng.js";
import { applyStatus } from "../src/sim/status.js";
import type { Ship } from "../src/rooms/graph.js";
import { shipFromText } from "../src/testing/roomfixtures.js";

const SHIP = `
  TUG -a1- r1
  r1 -d1- r2 -(d2)- r3
  r1 -·d3·- r4
  r4 -d4- r5
`;

function actor(room: number, extra: Partial<Entity> = {}): Entity {
  return makeEntity({
    name: "unit", ch: "u", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 8, hpMax: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 6, room, ...extra,
  });
}

describe("visibleRooms", () => {
  it("sees its own room and nothing else at sight 0", () => {
    const { ship } = shipFromText(SHIP);
    const seen = visibleRooms(ship, ship.room("r1").id, 0);
    expect([...seen]).toEqual([ship.room("r1").id]);
  });

  it("sees through open and broken doors, not through a closed one", () => {
    const { ship } = shipFromText(SHIP);
    const seen = labels(ship, visibleRooms(ship, ship.room("r2").id, 1));
    expect(seen).toEqual(["r1", "r2"]); // r3 is behind the closed d2
  });

  it("does not see out of the airlock", () => {
    const { ship } = shipFromText(SHIP);
    expect(labels(ship, visibleRooms(ship, ship.room("r1").id, 1))).toEqual(["r1", "r2", "r4"]);
  });

  it("reaches further when asked for more depth", () => {
    const { ship } = shipFromText(SHIP);
    expect(labels(ship, visibleRooms(ship, ship.room("r1").id, 2))).toEqual(["r1", "r2", "r4", "r5"]);
  });
});

describe("scanRooms", () => {
  it("reads through any door, two rooms out and no further", () => {
    const { ship } = shipFromText(SHIP);
    const pulse = labels(ship, scanRooms(ship, ship.room("r2").id, 2));
    expect(pulse).toEqual(["r1", "r2", "r3", "r4"]); // r5 is three doors away
  });

  it("reads through locked and welded doors alike", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -[d1:k1]- r2
      r1 -#d2#- r3
    `);
    expect(labels(ship, scanRooms(ship, ship.room("r1").id, 1))).toEqual(["r1", "r2", "r3"]);
  });
});

describe("canSee", () => {
  const cases: Array<{ what: string; room: "same" | "next"; hidden: boolean; keen: boolean; sight: 0 | 1; seen: boolean }> = [
    { what: "in the open, same room", room: "same", hidden: false, keen: false, sight: 0, seen: true },
    { what: "hiding, same room", room: "same", hidden: true, keen: false, sight: 0, seen: false },
    { what: "hiding from something keen", room: "same", hidden: true, keen: true, sight: 0, seen: true },
    { what: "next room, blind", room: "next", hidden: false, keen: false, sight: 0, seen: false },
    { what: "next room, sighted", room: "next", hidden: false, keen: false, sight: 1, seen: true },
    { what: "next room, hiding", room: "next", hidden: true, keen: false, sight: 1, seen: false },
    { what: "next room, hiding from something keen", room: "next", hidden: true, keen: true, sight: 1, seen: true },
  ];

  for (const c of cases) {
    it(`${c.seen ? "sees" : "misses"} a drone ${c.what}`, () => {
      const { ship } = shipFromText(SHIP);
      const viewer = actor(ship.room("r1").id, { sight: c.sight, keen: c.keen });
      const target = actor(c.room === "same" ? ship.room("r1").id : ship.room("r2").id, { hidden: c.hidden });
      expect(canSee(ship, viewer, target)).toBe(c.seen);
    });
  }

  it("stops at a closed door and at two rooms", () => {
    const { ship } = shipFromText(SHIP);
    const viewer = actor(ship.room("r2").id, { sight: 1 });
    expect(canSee(ship, viewer, actor(ship.room("r3").id))).toBe(false); // closed d2
    expect(canSee(ship, viewer, actor(ship.room("r4").id))).toBe(false); // two doors
  });

  it("sees nothing when either side is not on the ship", () => {
    const { ship } = shipFromText(SHIP);
    const viewer = actor(ship.room("r1").id, { sight: 1 });
    expect(canSee(ship, viewer, actor(ship.room("r1").id, { room: undefined }))).toBe(false);
    expect(canSee(ship, actor(ship.room("r1").id, { room: undefined }), viewer)).toBe(false);
  });
});

/**
 * The behaviour skeleton. The family of profiles is E19; what the turn cycle
 * needs today is one machine that closes and hits.
 */
describe("brute", () => {
  function world(ship: Ship, player: Entity, self: Entity): RoomWorld {
    return { ship, entities: [player, self], player, rng: new Rng(1), noise: new Map(), cache: new Map() };
  }

  it("hits what is in its room", () => {
    const { ship } = shipFromText(SHIP);
    const player = actor(ship.room("r1").id, { faction: Faction.Player });
    const self = actor(ship.room("r1").id);
    expect(brute(world(ship, player, self), self)).toEqual({ kind: "attack", target: player });
  });

  it("shoots the next room when it has the range", () => {
    const { ship } = shipFromText(SHIP);
    const player = actor(ship.room("r2").id, { faction: Faction.Player });
    const self = actor(ship.room("r1").id, { sight: 1, range: 1 });
    expect(brute(world(ship, player, self), self)).toEqual({ kind: "shoot", target: player });
  });

  it("walks towards the room it last saw the drone in", () => {
    const { ship } = shipFromText(SHIP);
    const player = actor(ship.room("r2").id, { faction: Faction.Player });
    const self = actor(ship.room("r1").id, { sight: 1 });
    const w = world(ship, player, self);

    expect(brute(w, self)).toEqual({ kind: "go", door: ship.door("d1").id });
    // Out of sight, still remembered: it keeps walking to where the drone was.
    player.room = ship.room("r5").id;
    expect(brute(w, self)).toEqual({ kind: "go", door: ship.door("d1").id });
  });

  it("waits when it has never seen anything and when the trail runs out", () => {
    const { ship } = shipFromText(SHIP);
    const player = actor(ship.room("r5").id, { faction: Faction.Player });
    const self = actor(ship.room("r1").id);
    const w = world(ship, player, self);
    expect(brute(w, self)).toEqual({ kind: "wait" });

    self.data = { targetRoom: ship.room("r1").id };
    expect(brute(w, self)).toEqual({ kind: "wait" });
    expect(self.data.targetRoom).toBeUndefined();
  });

  it("never steps through a door it cannot open", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -[d1:k1]- r2
    `);
    const player = actor(ship.room("r2").id, { faction: Faction.Player });
    const self = actor(ship.room("r1").id, { sight: 1 });
    self.data = { targetRoom: player.room };
    expect(brute(world(ship, player, self), self)).toEqual({ kind: "wait" });

    self.breacher = true;
    expect(brute(world(ship, player, self), self)).toEqual({ kind: "go", door: ship.door("d1").id });
  });

  it("blunders through a random door while stunned", () => {
    const { ship } = shipFromText(SHIP);
    const player = actor(ship.room("r5").id, { faction: Faction.Player });
    const self = actor(ship.room("r1").id);
    applyStatus(self, "stun", 3, 1);

    const intent = brute(world(ship, player, self), self);
    expect(intent.kind).toBe("go");
    if (intent.kind === "go") {
      expect(ship.passable(ship.doorAt(intent.door), { isPlayer: false })).toBe(true);
    }
  });

  it("falls back to the brute when a name is unknown", () => {
    expect(behaviourByName("no-such-profile")).toBe(brute);
    expect(behaviourByName(undefined)).toBe(brute);
    expect(behaviourByName("brute")).toBe(brute);
  });
});

function labels(ship: Ship, rooms: Set<number>): string[] {
  return [...rooms].map((r) => ship.roomAt(r).label).sort();
}
