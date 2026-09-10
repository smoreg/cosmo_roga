import { describe, it, expect } from "vitest";
import {
  BEHAVIOURS,
  behaviourByName,
  desireDriven,
  hunter,
  lastKnownRoom,
  rememberRoom,
  type Behaviour,
  type RoomIntent,
  type RoomWorld,
} from "../src/rooms/behaviours.js";
import { Faction, makeEntity, type Entity } from "../src/sim/entity.js";
import { Rng } from "../src/sim/rng.js";
import { applyStatus } from "../src/sim/status.js";
import type { RoomId, Ship } from "../src/rooms/graph.js";
import { shipFromText, type ShipFixture } from "../src/testing/roomfixtures.js";

/**
 * Two ways to the same room: the short one through the closed d4, the long one
 * through d1/d2/d3. Locking a door in the fixture text is how a test asks "and
 * what if it cannot go that way".
 */
const TWO_WAYS = [
  "TUG -a1- r1",
  "r1 -d1- r2 -(d2)- r3",
  "r3 -d3- r4",
  "r1 -(d4)- r5 -(d5)- r4",
];

/** A three room corridor: the drone at one end, room to back away at the other. */
const CORRIDOR = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3
`;

function machine(room: RoomId, extra: Partial<Entity> = {}): Entity {
  return makeEntity({
    name: "unit", ch: "u", fg: "#fff", pos: { x: 0, y: 0 }, faction: Faction.Monster,
    hp: 8, hpMax: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 6, room, ...extra,
  });
}

function drone(room: RoomId, extra: Partial<Entity> = {}): Entity {
  return machine(room, { name: "drone", ch: "@", faction: Faction.Player, sight: 1, ...extra });
}

function world(ship: Ship, player: Entity, ...machines: Entity[]): RoomWorld {
  return { ship, entities: [player, ...machines], player, rng: new Rng(1), noise: new Map(), cache: new Map() };
}

/**
 * Play `turns` turns of one machine, walking it through every door it asks for.
 * The cache is per-turn, so it is dropped between turns exactly as the turn
 * cycle drops it.
 */
function run(w: RoomWorld, self: Entity, act: Behaviour, turns: number): RoomIntent[] {
  const out: RoomIntent[] = [];
  for (let i = 0; i < turns; i++) {
    w.cache?.clear();
    const intent = act(w, self);
    out.push(intent);
    if (intent.kind === "go") self.room = w.ship.other(w.ship.doorAt(intent.door), self.room!);
  }
  return out;
}

function doors(ship: Ship, intents: RoomIntent[]): string[] {
  return intents.map((i) => (i.kind === "go" ? ship.doorAt(i.door).label : i.kind));
}

describe("desire profiles on a graph", () => {
  it("a brute walks the shortest way to the room it was told about", () => {
    const { ship } = shipFromText(TWO_WAYS);
    const player = drone(ship.room("r4").id);
    const self = machine(ship.room("r1").id);
    rememberRoom(self, player.room);

    const intents = run(world(ship, player, self), self, BEHAVIOURS.brute, 4);
    expect(doors(ship, intents)).toEqual(["d4", "d5", "attack", "attack"]);
    expect(self.room).toBe(ship.room("r4").id);
  });

  it("a brute goes the long way round a locked door, and cuts through it as a breacher", () => {
    const { ship } = shipFromText(TWO_WAYS.map((l) => l.replace("-(d4)-", "-[d4:k1]-")));
    const player = drone(ship.room("r4").id);
    const self = machine(ship.room("r1").id);
    rememberRoom(self, player.room);
    expect(doors(ship, run(world(ship, player, self), self, BEHAVIOURS.brute, 4)))
      .toEqual(["d1", "d2", "d3", "attack"]);

    const cutter = machine(ship.room("r1").id, { breacher: true });
    rememberRoom(cutter, player.room);
    expect(doors(ship, run(world(ship, player, cutter), cutter, BEHAVIOURS.brute, 3)))
      .toEqual(["d4", "d5", "attack"]);
  });

  it("a brute waits when every way to the drone is locked", () => {
    const { ship } = shipFromText(
      TWO_WAYS.map((l) => l.replace("-(d4)-", "-[d4:k1]-").replace("-d1-", "-[d1:k1]-")),
    );
    const player = drone(ship.room("r4").id);
    const self = machine(ship.room("r1").id);
    rememberRoom(self, player.room);
    expect(run(world(ship, player, self), self, BEHAVIOURS.brute, 3).map((i) => i.kind))
      .toEqual(["wait", "wait", "wait"]);
  });

  it("a profile is four numbers: the same machine charges or runs on the sign", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r1").id);
    const self = machine(ship.room("r2").id, { sight: 1 });

    // fleeBelow above 1 means "afraid even at full health".
    const timid = desireDriven({ player: 1, fleeBelow: 1.1 });
    expect(timid(world(ship, player, self), self)).toEqual({ kind: "go", door: ship.door("d2").id });

    const eager = desireDriven({ player: 1 });
    expect(eager(world(ship, player, self), self)).toEqual({ kind: "go", door: ship.door("d1").id });
  });

  it("waits with nothing to want, and forgets a trail that has run out", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r3").id);
    const self = machine(ship.room("r1").id, { sight: 0 });
    expect(BEHAVIOURS.brute(world(ship, player, self), self)).toEqual({ kind: "wait" });

    rememberRoom(self, ship.room("r1").id);
    expect(BEHAVIOURS.brute(world(ship, player, self), self)).toEqual({ kind: "wait" });
    expect(lastKnownRoom(self)).toBeUndefined();
  });
});

describe("the door rule", () => {
  it("a brute follows the drone through the door and a coward does not", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r1").id);

    const bully = machine(ship.room("r2").id, { sight: 1 });
    expect(BEHAVIOURS.brute(world(ship, player, bully), bully)).toEqual({ kind: "go", door: ship.door("d1").id });

    const timid = machine(ship.room("r2").id, { sight: 1 });
    expect(BEHAVIOURS.coward(world(ship, player, timid), timid)).toEqual({ kind: "wait" });
    // It wanted to: the same desire with the rule lifted walks straight in.
    const eager = desireDriven({ player: 1, fleeBelow: 0.35 });
    expect(eager(world(ship, player, timid), timid)).toEqual({ kind: "go", door: ship.door("d1").id });
  });

  it("a pack animal waits at the door alone and walks in with a mate", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r1").id);
    const self = machine(ship.room("r2").id, { sight: 1 });
    expect(BEHAVIOURS.pack(world(ship, player, self), self)).toEqual({ kind: "wait" });

    const beside = machine(ship.room("r2").id);
    expect(BEHAVIOURS.pack(world(ship, player, self, beside), self))
      .toEqual({ kind: "go", door: ship.door("d1").id });

    const ahead = machine(ship.room("r1").id);
    expect(BEHAVIOURS.pack(world(ship, player, self, ahead), self))
      .toEqual({ kind: "go", door: ship.door("d1").id });
  });

  it("a mate two rooms away is no company at all", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r1").id);
    const self = machine(ship.room("r2").id, { sight: 1 });
    const far = machine(ship.room("r3").id);
    expect(BEHAVIOURS.pack(world(ship, player, self, far), self)).toEqual({ kind: "wait" });
  });

  it("a skirmisher would rather be cornered than run through the drone's room", () => {
    // The only way out of the dead end r3 is past the drone in r2. The corridor
    // beyond is long enough that the flee map genuinely prefers it.
    const { ship } = shipFromText(`
      TUG -a1- r1
      r3 -d2- r2 -d1- r1
      r1 -e1- c1 -e2- c2 -e3- c3 -e4- c4 -e5- c5 -e6- c6 -e7- c7 -e8- c8
    `);
    const player = drone(ship.room("r2").id);
    const self = machine(ship.room("r3").id, { sight: 1, hp: 2 });

    expect(BEHAVIOURS.skirmisher(world(ship, player, self), self)).toEqual({ kind: "wait" });
    const reckless = desireDriven({ player: -0.4, fleeBelow: 0.5 });
    expect(reckless(world(ship, player, self), self)).toEqual({ kind: "go", door: ship.door("d2").id });
  });
});

describe("coward", () => {
  it("backs away when badly hurt and never comes back while the drone is there", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3 -d3- r4
    `);
    const player = drone(ship.room("r1").id);
    const self = machine(ship.room("r1").id, { hp: 2 });

    const intents = run(world(ship, player, self), self, BEHAVIOURS.coward, 5);
    expect(doors(ship, intents)).toEqual(["d1", "d2", "d3", "wait", "wait"]);
    expect(self.room).toBe(ship.room("r4").id);
  });

  it("stands and fights while healthy", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r2").id);
    const self = machine(ship.room("r2").id);
    expect(BEHAVIOURS.coward(world(ship, player, self), self)).toEqual({ kind: "attack", target: player });
  });
});

describe("stalker", () => {
  const SIDE_ROOMS = `
    TUG -a1- r1
    r1 -d1- r2 -d2- r3
    r1 -d3- r4
  `;

  it("walks towards a noise two doors away that it cannot see", () => {
    const { ship } = shipFromText(SIDE_ROOMS);
    const player = drone(ship.room("r4").id);
    const self = machine(ship.room("r1").id, { sight: 0 });
    const w = world(ship, player, self);
    w.noise = new Map([[ship.room("r3").id, 8]]);

    expect(BEHAVIOURS.stalker(w, self)).toEqual({ kind: "go", door: ship.door("d1").id });
  });

  it("walks towards the drone once it sees it", () => {
    const { ship } = shipFromText(SIDE_ROOMS);
    const player = drone(ship.room("r2").id);
    const self = machine(ship.room("r1").id, { sight: 1 });
    expect(BEHAVIOURS.stalker(world(ship, player, self), self))
      .toEqual({ kind: "go", door: ship.door("d1").id });
    expect(lastKnownRoom(self)).toBe(ship.room("r2").id);
  });
});

describe("hunter", () => {
  const DEEP = `
    TUG -a1- r1
    r1 -d1- r2 -d2- r3 -d3- r4 -d4- r5 -d5- r6
    r6: hold cover
  `;

  it("walks to the last known room, searches it, then gives up and turns brute", () => {
    const { ship } = shipFromText(DEEP);
    const player = drone(ship.room("r6").id, { hidden: true });
    const self = machine(ship.room("r3").id, { sight: 1 });
    rememberRoom(self, ship.room("r5").id);

    const intents = run(world(ship, player, self), self, BEHAVIOURS.hunter, 10);
    expect(doors(ship, intents)).toEqual([
      "d3", "d4", // two rooms to walk
      "wait", "wait", "wait", "wait", "wait", "wait", "wait", // seven turns searching
      "wait", // the eighth is the one it gives up on
    ]);
    expect(self.room).toBe(ship.room("r5").id);
    expect(self.behaviour).toBe("brute");
    expect(lastKnownRoom(self)).toBeUndefined();
    expect(self.searchTurns).toBeUndefined();
  });

  it("is still hunting on the turn before it gives up", () => {
    const { ship } = shipFromText(DEEP);
    const player = drone(ship.room("r6").id, { hidden: true });
    const self = machine(ship.room("r5").id, { sight: 1 });
    rememberRoom(self, self.room!);

    run(world(ship, player, self), self, hunter(8), 7);
    expect(self.behaviour).toBeUndefined();
    expect(lastKnownRoom(self)).toBe(ship.room("r5").id);
  });

  it("moves its goal to a noise it hears while searching", () => {
    const { ship } = shipFromText(DEEP);
    const player = drone(ship.room("r6").id, { hidden: true });
    const self = machine(ship.room("r5").id, { sight: 1, searchTurns: 3 });
    rememberRoom(self, self.room!);
    const w = world(ship, player, self);
    w.noise = new Map([[ship.room("r2").id, 6]]);

    expect(BEHAVIOURS.hunter(w, self)).toEqual({ kind: "go", door: ship.door("d4").id });
    expect(lastKnownRoom(self)).toBe(ship.room("r2").id);
    expect(self.searchTurns).toBeUndefined();
  });

  it("hits what is in its room and shoots the next one with the range", () => {
    const { ship } = shipFromText(DEEP);
    const player = drone(ship.room("r2").id);
    const here = machine(ship.room("r2").id);
    expect(BEHAVIOURS.hunter(world(ship, player, here), here)).toEqual({ kind: "attack", target: player });

    const gunner = machine(ship.room("r1").id, { sight: 1, range: 1 });
    expect(BEHAVIOURS.hunter(world(ship, player, gunner), gunner)).toEqual({ kind: "shoot", target: player });
  });
});

describe("turret", () => {
  const TURRET_SHIP = `
    TUG -a1- r1
    r1 -d1- r2 -(d2)- r3
    r2 -d3- r4
  `;

  it("never moves, wherever the drone goes, over a hundred turns", () => {
    const { ship } = shipFromText(TURRET_SHIP);
    const player = drone(ship.room("r1").id);
    const self = machine(ship.room("r2").id, { sight: 1, range: 1 });
    const w = world(ship, player, self);
    const rng = new Rng(5);

    for (let turn = 0; turn < 100; turn++) {
      player.room = rng.int(0, ship.size - 1);
      player.hidden = rng.chance(0.3);
      w.cache?.clear();
      expect(BEHAVIOURS.turret(w, self).kind).not.toBe("go");
      expect(self.room).toBe(ship.room("r2").id);
    }
  });

  it("shoots through an open door, but not a closed one and not two doors away", () => {
    const { ship } = shipFromText(TURRET_SHIP);
    const self = machine(ship.room("r2").id, { sight: 1, range: 1 });

    const near = drone(ship.room("r1").id);
    expect(BEHAVIOURS.turret(world(ship, near, self), self)).toEqual({ kind: "shoot", target: near });

    const shut = drone(ship.room("r3").id); // behind the closed d2
    expect(BEHAVIOURS.turret(world(ship, shut, self), self)).toEqual({ kind: "wait" });

    // Two open doors away — r4 to r2 to r1 — is still out of the line of fire.
    const twoAway = drone(ship.room("r1").id);
    const gun = machine(ship.room("r4").id, { sight: 1, range: 1 });
    expect(BEHAVIOURS.turret(world(ship, twoAway, gun), gun)).toEqual({ kind: "wait" });
  });

  it("shoots what is in its own room and waits without a range at all", () => {
    const { ship } = shipFromText(TURRET_SHIP);
    const player = drone(ship.room("r2").id);
    const armed = machine(ship.room("r2").id, { range: 1 });
    expect(BEHAVIOURS.turret(world(ship, player, armed), armed)).toEqual({ kind: "shoot", target: player });

    const unarmed = machine(ship.room("r2").id);
    expect(BEHAVIOURS.turret(world(ship, player, unarmed), unarmed)).toEqual({ kind: "wait" });
  });

  it("holds its fire while stunned, and never staggers off its mount", () => {
    // Every walking behaviour blunders through a door when seized; a turret
    // has no door to blunder through, so a stun is a turn of silence. Without
    // this the one machine a stun is most worth spending on was the one it
    // did nothing to.
    const { ship } = shipFromText(TURRET_SHIP);
    const player = drone(ship.room("r2").id);
    const self = machine(ship.room("r2").id, { range: 1 });
    applyStatus(self, "stun", 2);
    const w = world(ship, player, self);
    expect(BEHAVIOURS.turret(w, self)).toEqual({ kind: "wait" });
    expect(self.room).toBe(ship.room("r2").id);

    self.statuses = [];
    expect(BEHAVIOURS.turret(w, self)).toEqual({ kind: "shoot", target: player });
  });
});

describe("static", () => {
  it("never moves and never attacks, even with the drone in the room", () => {
    const { ship } = shipFromText(CORRIDOR);
    const player = drone(ship.room("r1").id);
    const self = machine(ship.room("r1").id);
    expect(BEHAVIOURS.static(world(ship, player, self), self)).toEqual({ kind: "wait" });
  });
});

describe("hiding", () => {
  it("a keen machine finds the drone under the crates and a blind one does not", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking cover
    `);
    const player = drone(ship.room("r1").id, { hidden: true });

    const keen = machine(ship.room("r1").id, { keen: true });
    expect(BEHAVIOURS.brute(world(ship, player, keen), keen)).toEqual({ kind: "attack", target: player });

    const blind = machine(ship.room("r1").id);
    expect(BEHAVIOURS.brute(world(ship, player, blind), blind)).toEqual({ kind: "wait" });
    expect(lastKnownRoom(blind)).toBeUndefined();
  });
});

describe("behaviourByName", () => {
  it("knows every preset and falls back to the brute", () => {
    for (const name of Object.keys(BEHAVIOURS)) {
      expect(behaviourByName(name)).toBe(BEHAVIOURS[name as keyof typeof BEHAVIOURS]);
    }
    expect(behaviourByName("no-such-profile")).toBe(BEHAVIOURS.brute);
    expect(behaviourByName(undefined)).toBe(BEHAVIOURS.brute);
  });
});

/**
 * The invariants every profile owes the turn cycle, on ships nobody wrote by
 * hand: a machine never asks for a door it cannot use, never asks for one that
 * is not on its own room, and never swings at something it is not standing with.
 */
describe("intent invariants over random ships", () => {
  const NAMES = Object.keys(BEHAVIOURS) as Array<keyof typeof BEHAVIOURS>;
  const NEVER_FOLLOWS = new Set(["coward", "skirmisher"]);
  const NEVER_MOVES = new Set(["turret", "static"]);
  const DOOR_STYLES = ["-d%-", "-(d%)-", "-[d%:k1]-", "-#d%#-", "-·d%·-"];

  function randomShip(rng: Rng): ShipFixture {
    const size = rng.int(3, 8);
    const lines = ["TUG -a1- r1"];
    let door = 0;
    const edge = (a: number, b: number): string => {
      door += 1;
      return `r${a} ${DOOR_STYLES[rng.int(0, DOOR_STYLES.length - 1)]!.replace("%", String(door))} r${b}`;
    };
    for (let i = 2; i <= size; i++) lines.push(edge(rng.int(1, i - 1), i));
    for (let extra = rng.int(0, 3); extra > 0; extra--) {
      const a = rng.int(1, size);
      const b = rng.int(1, size);
      if (a !== b) lines.push(edge(a, b));
    }
    if (rng.chance(0.5)) lines.push(`r${rng.int(1, size)}: hold cover`);
    return shipFromText(lines);
  }

  it("holds for every profile on 200 seeds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new Rng(seed);
      const { ship } = randomShip(rng);
      const last = ship.size - 1;
      const player = drone(rng.int(0, last), { hidden: rng.chance(0.3) });
      const mates = Array.from({ length: rng.int(0, 2) }, () => machine(rng.int(0, last)));
      const noise = new Map([[rng.int(0, last), rng.int(1, 9)]]);
      const spec = {
        room: rng.int(0, last),
        goal: rng.int(0, last),
        hp: rng.int(1, 8),
        sight: (rng.chance(0.5) ? 1 : 0) as 0 | 1,
        keen: rng.chance(0.3),
        range: rng.chance(0.3) ? 1 : 0,
        breacher: rng.chance(0.2),
      };

      for (const name of NAMES) {
        const self = machine(spec.room, {
          hp: spec.hp, sight: spec.sight, keen: spec.keen, range: spec.range, breacher: spec.breacher,
        });
        rememberRoom(self, spec.goal);
        const w: RoomWorld = {
          ship, entities: [player, self, ...mates], player, rng: new Rng(seed), noise, cache: new Map(),
        };
        const intent = BEHAVIOURS[name](w, self);
        const where = `${name} on seed ${seed}`;

        if (intent.kind === "go") {
          expect(NEVER_MOVES.has(name), `${where} moved`).toBe(false);
          const d = ship.doorAt(intent.door);
          expect(ship.passable(d, { breacher: spec.breacher, isPlayer: false }), `${where} used ${d.label}`).toBe(true);
          expect(d.a === spec.room || d.b === spec.room, `${where} used a door it does not touch`).toBe(true);
          const to = ship.other(d, spec.room);
          expect(to, `${where} went nowhere`).not.toBe(spec.room);
          if (NEVER_FOLLOWS.has(name)) {
            expect(to, `${where} followed the drone through a door`).not.toBe(player.room);
          }
        }

        if (intent.kind === "attack") {
          expect(intent.target.room, `${where} hit another room`).toBe(spec.room);
          expect(intent.target.hidden !== true || spec.keen, `${where} hit what it cannot see`).toBe(true);
        }

        if (intent.kind === "shoot") {
          expect(spec.range >= 1, `${where} shot without a range`).toBe(true);
          const room = intent.target.room!;
          const inLine = room === spec.room
            || ship.doorsOf(spec.room).some((d) => ship.seeThrough(d) && ship.other(d, spec.room) === room);
          expect(inLine, `${where} shot through a wall`).toBe(true);
        }
      }
    }
  });
});
