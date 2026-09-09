import { describe, it, expect } from "vitest";
import { RoomGame, replayRooms, type RoomGameConfig } from "../src/rooms/game.js";
import type { RoomCommand } from "../src/rooms/actions.js";
import { Rng } from "../src/sim/rng.js";
import type { LeaveReason, Twist } from "../src/sim/twist.js";
import { isAlive } from "../src/sim/entity.js";
import { spawnMonsterIn } from "../src/content/kinds.js";
import { fuzzOn, describeFailure } from "../src/testing/fuzz.js";
import { runBotOn } from "../src/testing/metrics.js";
import { TEST_ROOM_CONTENT, TEST_ROOM_MONSTERS, testShip } from "../src/testing/dummyship.js";
import { shipFromText } from "../src/testing/roomfixtures.js";

const CONFIG: Omit<RoomGameConfig, "seed"> = { content: TEST_ROOM_CONTENT, firstShip: testShip };

/**
 * The same game with a drone that cannot be killed. A random bot dies in about
 * a hundred turns, and a recording that short says nothing about the hundred
 * after it — so the long tests are played by something that survives them.
 */
const TOUGH: Omit<RoomGameConfig, "seed"> = {
  ...CONFIG,
  content: {
    ...TEST_ROOM_CONTENT,
    makePlayer: () => {
      const drone = TEST_ROOM_CONTENT.makePlayer();
      drone.hp = 9999;
      drone.hpMax = 9999;
      return drone;
    },
  },
};

/**
 * A voyage in miniature: it owns the ending, so leaving through the airlock is
 * a trip to the next derelict rather than the end of the run. It also has to
 * guard against its own hook — `travelTo` announces the departure again, which
 * is the contract every system that claims the outcome lives under.
 */
function voyage(ships: number): Twist<RoomGame> {
  let sortie = 1;
  let moving = false;
  return {
    name: "voyage",
    claimsOutcome: true,
    beforeLevelLeave(game) {
      if (moving) return;
      moving = true;
      sortie++;
      if (sortie > ships) game.finish("won", "The tug pulls away.");
      else game.travelTo(String(sortie), { generate: testShip, reason: "custom" });
      moving = false;
    },
  };
}

/** The fuzzer's idea of a player: every verb, including the ones that refuse. */
function randomRoomCommand(game: RoomGame, rng: Rng): RoomCommand {
  const roll = rng.int(0, 11);
  if (roll === 0) return { kind: "wait" };
  if (roll === 1) return { kind: "hide" };
  if (roll === 2) return { kind: "leave" };
  if (roll === 3) return { kind: "act", verb: "poke", slot: rng.int(0, 3) };
  if (roll === 4) return { kind: "attack", target: rng.int(0, 20) };

  const here = game.roomOf(game.player).id;
  if (roll <= 6) {
    const targets = game.entitiesIn(here).filter((e) => e.id !== game.player.id && isAlive(e));
    if (targets.length > 0) return { kind: "attack", target: rng.pick(targets).id };
  }
  const doors = game.ship.doorsOf(here);
  return doors.length === 0 ? { kind: "wait" } : { kind: "go", door: rng.pick(doors).id };
}

describe("arriving on a ship", () => {
  it("puts the drone in the airlock room and marks it stood in", () => {
    const game = new RoomGame({ seed: 3, ...CONFIG });
    expect(game.player.room).toBe(game.ship.entry);
    expect(game.roomOf(game.player).explored).toBe(true);
    expect(game.visible.has(game.ship.entry)).toBe(true);
    expect(game.shipId).toBe("1");
    expect(game.ships.ids()).toEqual(["1"]);
    expect(game.currentShip.visits).toBe(1);
  });

  it("sees the next room through an open door and no further", () => {
    const { ship } = shipFromText(`
      TUG -a1- r1
      r1 -d1- r2 -d2- r3
      r1 -(d3)- r4
      r1: docking
    `);
    const game = new RoomGame({ seed: 3, content: TEST_ROOM_CONTENT, firstShip: () => ship });
    const labels = [...game.visible].map((r) => ship.roomAt(r).label).sort();
    expect(labels).toEqual(["r1", "r2"]);
  });

  it("populates rooms below the cap, and never the airlock room", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const game = new RoomGame({ seed, ...CONFIG });
      const machines = game.entities.filter((e) => e.id !== game.player.id);
      expect(machines.length).toBeLessThanOrEqual(TEST_ROOM_CONTENT.maxMonsters);
      for (const m of machines) {
        expect(game.roomOf(m).depth, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("fills what the chance says and stops at the cap", () => {
    const crowded = { ...TEST_ROOM_CONTENT, monsterChance: () => 1, maxMonsters: 2 };
    const game = new RoomGame({ seed: 8, content: crowded, firstShip: testShip });
    const machines = game.entities.filter((e) => e.id !== game.player.id);

    expect(machines.length).toBe(2);
    expect(new Set(machines.map((m) => m.room)).size, "one machine to a room").toBe(2);
    const named = TEST_ROOM_MONSTERS.map((k) => k.name);
    for (const m of machines) expect(named, "machines come from the pack's own table").toContain(m.name);
  });

  it("walking marks the room explored", () => {
    const game = new RoomGame({ seed: 11, ...CONFIG });
    const door = game.ship.doorsOf(game.ship.entry).find((d) => d.state === "open")!;
    const beyond = game.ship.other(door, game.ship.entry);
    expect(game.ship.roomAt(beyond).explored).toBe(false);
    game.playerCommand({ kind: "go", door: door.id });
    expect(game.ship.roomAt(beyond).explored).toBe(true);
  });
});

describe("going back aboard", () => {
  it("gives back the same ship, down to the machines and their energy", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const game = new RoomGame({ seed, twist: voyage(99), ...CONFIG });
      const ship = game.ship;

      for (let i = 0; i < 5; i++) game.playerCommand({ kind: "wait" });
      const deep = ship.rooms[ship.size - 1]!;
      deep.explored = true;
      deep.data.looted = true;
      game.currentShip.data.alert = 3;

      const before = game.entities
        .filter((e) => e.id !== game.player.id)
        .map((e) => ({ id: e.id, room: e.room, energy: e.energy, hp: e.hp }));

      game.travelTo("2", { generate: testShip, reason: "custom" });
      game.travelTo("1", { generate: testShip, reason: "custom" });

      expect(game.ship, `seed ${seed}`).toBe(ship);
      expect(game.currentShip.visits).toBe(2);
      expect(deep.explored).toBe(true);
      expect(deep.data.looted).toBe(true);
      expect(game.currentShip.data.alert).toBe(3);

      const after = game.entities
        .filter((e) => e.id !== game.player.id)
        .map((e) => ({ id: e.id, room: e.room, energy: e.energy, hp: e.hp }));
      expect(after, `seed ${seed}`).toEqual(before);
      expect(game.player.room).toBe(ship.entry);
    }
  });

  it("does not repopulate a ship it has seen before", () => {
    const game = new RoomGame({ seed: 42, twist: voyage(99), ...CONFIG });
    const machines = game.entities.length;
    game.travelTo("2", { generate: testShip, reason: "custom" });
    game.travelTo("1", { generate: testShip, reason: "custom" });
    expect(game.entities.length).toBe(machines);
  });

  it("keeps a cut door cut, and a stash of ships apart", () => {
    const game = new RoomGame({ seed: 5, twist: voyage(99), ...CONFIG });
    const door = game.ship.doorsOf(game.ship.entry)[0]!;
    door.state = "broken";

    game.travelTo("2", { generate: testShip, reason: "custom" });
    expect(game.ships.size).toBe(2);
    expect(game.ship).not.toBe(game.ships.get("1")!.ship);

    game.travelTo("1", { generate: testShip, reason: "custom" });
    expect(door.state).toBe("broken");
  });
});

describe("leaving", () => {
  it("is the whole game when no system claims the ending", () => {
    const game = new RoomGame({ seed: 9, ...CONFIG });
    const out = game.playerCommand({ kind: "leave" });
    expect(out.ok).toBe(true);
    expect(game.status).toBe("won");
  });

  it("is only an announcement when one does", () => {
    const seen: LeaveReason[] = [];
    const game = new RoomGame({
      seed: 9,
      ...CONFIG,
      twist: { name: "spy", claimsOutcome: true, beforeLevelLeave: (_g, _d, reason) => void seen.push(reason) },
    });

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(seen).toEqual(["airlock"]);
    expect(game.status).toBe("playing");
  });

  it("hands a claiming system the next ship, once", () => {
    const game = new RoomGame({ seed: 4, twist: voyage(2), ...CONFIG });
    game.playerCommand({ kind: "leave" });
    expect(game.shipId).toBe("2");
    expect(game.status).toBe("playing");

    game.playerCommand({ kind: "leave" });
    expect(game.status).toBe("won");
  });
});

describe("replay", () => {
  it("reproduces 300 random commands exactly", () => {
    for (const seed of [1, 17, 404, 20260903]) {
      // A long voyage: the run has to survive the whole recording, or the test
      // would be measuring how quickly a random bot walks out of an airlock.
      const live = new RoomGame({ seed, twist: voyage(60), ...TOUGH });
      const rng = new Rng(seed ^ 0x5bf03635);
      for (let i = 0; i < 300 && !live.isOver(); i++) {
        const out = live.playerCommand(randomRoomCommand(live, rng));
        if (!out.ok) live.playerCommand({ kind: "wait" });
      }
      expect(live.inputs.length, `seed ${seed} barely played`).toBeGreaterThan(200);

      const again = replayRooms(seed, live.inputs, { ...TOUGH, twist: voyage(60) });
      expect(again.status, `seed ${seed}`).toBe(live.status);
      expect(again.inputs.length).toBe(live.inputs.length);
      expect(again.schedule.time).toBe(live.schedule.time);
      expect(again.player.room).toBe(live.player.room);
      expect(again.shipId).toBe(live.shipId);
      expect(again.player.hp).toBe(live.player.hp);
      expect(again.kills).toBe(live.kills);
    }
  });
});

describe("the whole turn cycle under random input", () => {
  it("survives 50 runs of 300 commands without throwing", () => {
    const failures = fuzzOn({
      seeds: Array.from({ length: 50 }, (_v, i) => 1000 + i),
      steps: 300,
      make: (seed) => new RoomGame({ seed, twist: voyage(60), ...CONFIG }),
      bot: randomRoomCommand,
    });
    expect(failures.map(describeFailure)).toEqual([]);
  });

  it("survives them again with a drone that cannot die, ship after ship", () => {
    const failures = fuzzOn({
      seeds: Array.from({ length: 50 }, (_v, i) => 2000 + i),
      steps: 300,
      make: (seed) => new RoomGame({ seed, twist: voyage(60), ...TOUGH }),
      bot: randomRoomCommand,
    });
    expect(failures.map(describeFailure)).toEqual([]);
  });

  it("is measurable by the same harness the grid game uses", () => {
    const result = runBotOn(() => randomRoomCommand, 77, {
      maxSteps: 300,
      make: (seed) => new RoomGame({ seed, twist: voyage(60), ...CONFIG }),
      progress: (game: RoomGame) => game.ships.size,
    });
    expect(result.seed).toBe(77);
    expect(result.turns).toBeGreaterThan(0);
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(["won", "dead", "stuck"]).toContain(result.status);
  });
});

describe("the package entry point", () => {
  it("carries the turn cycle out beside the grid one", async () => {
    // A star export that clashes is dropped silently rather than reported, so
    // the aliases in rooms/index.ts are worth one assertion at value level.
    const engine = await import("../src/index.js");
    expect(typeof engine.RoomGame).toBe("function");
    expect(typeof engine.replayRooms).toBe("function");
    expect(typeof engine.performRoom).toBe("function");
    expect(typeof engine.takeRoomAiTurn).toBe("function");
    expect(typeof engine.runNonPlayerRoomTurns).toBe("function");
    expect(engine.BREACH_TURNS).toBe(3);
    expect(engine.performRoom).not.toBe(engine.perform); // still the grid one
    expect(engine.roomLabel).not.toBe(engine.label);
    expect(engine.SAVE_VERSION).toBe(3);

    // The graph behaviours travel out under the same rule.
    expect(typeof engine.roomDesireDriven).toBe("function");
    expect(typeof engine.roomHunter).toBe("function");
    expect(engine.roomTurret).not.toBe(engine.turret);
    expect(engine.ROOM_BEHAVIOURS.brute).toBe(engine.brute);

    const testing = await import("../src/testing/index.js");
    expect(typeof testing.testShip).toBe("function");
    expect(typeof testing.fuzzOn).toBe("function");
    expect(typeof testing.runBotOn).toBe("function");
    expect(testing.TEST_ROOM_CONTENT.name).toBe("engine test derelict");
  });
});

describe("the run ending", () => {
  it("says the content pack's death line and takes no further commands", () => {
    const game = new RoomGame({
      seed: 6,
      content: { ...TEST_ROOM_CONTENT, monsterChance: () => 0, deathLine: "The drone goes quiet." },
      firstShip: () => shipFromText("TUG -a1- r1\nr1 -d1- r2\nr1: docking").ship,
    });
    const killer = spawnMonsterIn({ ...TEST_ROOM_MONSTERS[0]!, damage: [4, 6, 6] }, game.ship.entry);
    game.entities.push(killer);
    game.schedule.admit(killer);
    game.player.hp = 1;

    expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    expect(game.status).toBe("dead");
    expect(game.log.lines.at(-1)!.text).toBe("The drone goes quiet.");

    const after = game.playerCommand({ kind: "wait" });
    expect(after.ok).toBe(false);
    expect(after.reason).toMatch(/run is over/);
  });
});
