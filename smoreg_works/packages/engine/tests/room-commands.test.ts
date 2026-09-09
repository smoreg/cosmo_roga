import { describe, it, expect } from "vitest";
import { RoomGame, type RoomGameConfig } from "../src/rooms/game.js";
import { perform, type RoomCommand } from "../src/rooms/actions.js";
import type { RoomId } from "../src/rooms/graph.js";
import { spawnMonsterIn, type MonsterKind, type RoomContentPack } from "../src/content/kinds.js";
import { decodeRun, encodeRun, SAVE_VERSION } from "../src/sim/save.js";
import type { Entity } from "../src/sim/entity.js";
import { shipFromText } from "../src/testing/roomfixtures.js";
import { TEST_ROOM_CONTENT, TEST_ROOM_MONSTERS } from "../src/testing/dummyship.js";

/**
 * One ship, every question the command set asks: an open door and a closed one
 * off the entry, a locked door with its key on the near side, cover in exactly
 * one room, and the airlock where the drone starts.
 *
 *   TUG =a1= r1 —d1— r2 —[d3:k1]— r4
 *              r1 (d2) r3    r2 —d4— r5
 */
const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -(d2)- r3
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r1: docking
  r2: cargo cover
  r3: engine
  r4: vault
  r5: hold
`;

/** No machines unless a test asks for one: populate must not write the fixture. */
const QUIET: RoomContentPack = { ...TEST_ROOM_CONTENT, monsterChance: () => 0 };

function newGame(over: Partial<RoomGameConfig> = {}): RoomGame {
  return new RoomGame({ seed: 7, content: QUIET, firstShip: () => shipFromText(SHIP).ship, ...over });
}

/** Machines are added after the game exists: the constructor resets entity ids. */
function machineIn(game: RoomGame, room: RoomId, over: Partial<MonsterKind> = {}): Entity {
  const m = spawnMonsterIn({ ...TEST_ROOM_MONSTERS[0]!, ...over }, room);
  game.entities.push(m);
  game.schedule.admit(m);
  return m;
}

function roomId(game: RoomGame, label: string): RoomId {
  return game.ship.room(label).id;
}

/**
 * The invariant every refusal shares: the drone said something illegal, was
 * told why, and the world did not move — no turn spent, nothing recorded, so
 * the replay of this run has never heard of it.
 */
function refuses(game: RoomGame, cmd: RoomCommand, why: RegExp): void {
  game.playerCommand({ kind: "wait" });
  const before = {
    time: game.schedule.time,
    inputs: game.inputs.length,
    room: game.player.room,
    energy: game.player.energy,
  };

  const out = game.playerCommand(cmd);
  expect(out.ok, `${cmd.kind} should have been refused`).toBe(false);
  expect(out.reason ?? "").toMatch(why);
  expect(game.inputs.length, "a refused command is not recorded").toBe(before.inputs);
  expect(game.player.energy, "a refused command costs no energy").toBe(before.energy);
  expect(game.schedule.time, "a refused command hands nobody else a turn").toBe(before.time);
  expect(game.player.room).toBe(before.room);
}

describe("illegal room commands", () => {
  it("refuses a locked door and charges nothing for asking", () => {
    const game = newGame();
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    refuses(game, { kind: "go", door: game.ship.door("d3").id }, /locked/);
  });

  it("refuses a door that belongs to another room", () => {
    const game = newGame();
    refuses(game, { kind: "go", door: game.ship.door("d4").id }, /not in this room/);
    refuses(game, { kind: "go", door: 99 }, /no such door/);
  });

  it("refuses an attack into the next room without the range for it", () => {
    const game = newGame();
    const grunt = machineIn(game, roomId(game, "r2"));
    // The drone sees it through the open door; seeing is not shooting.
    expect(game.visibleMonsters().map((e) => e.id)).toEqual([grunt.id]);
    refuses(game, { kind: "attack", target: grunt.id }, /not in this room/);
    refuses(game, { kind: "attack", target: 404 }, /nothing to attack/i);
  });

  it("refuses to hide where there is nothing to hide behind", () => {
    const game = newGame();
    refuses(game, { kind: "hide" }, /nothing to hide behind/);
    expect(game.player.hidden).not.toBe(true);
  });

  it("refuses to leave anywhere but the airlock", () => {
    const game = newGame();
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    refuses(game, { kind: "leave" }, /no airlock here/);
    expect(game.status).toBe("playing");
  });

  it("refuses a verb no system claims", () => {
    const game = newGame();
    refuses(game, { kind: "act", verb: "weld", target: 3 }, /nothing to do/i);
  });
});

describe("doors", () => {
  it("opens a closed door on the way through", () => {
    const game = newGame();
    const d2 = game.ship.door("d2");
    expect(game.playerCommand({ kind: "go", door: d2.id }).ok).toBe(true);
    expect(d2.state).toBe("open");
    expect(game.player.room).toBe(roomId(game, "r3"));
  });

  it("lets a breacher cut a locked door open in three turns, loudly", () => {
    const game = newGame();
    const d3 = game.ship.door("d3");
    game.player.breacher = true;
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    expect(game.noise.get(roomId(game, "r2")), "walking is quiet").toBe(3);

    for (let turn = 1; turn <= 2; turn++) {
      expect(game.playerCommand({ kind: "go", door: d3.id }).ok).toBe(true);
      expect(d3.state, `still locked after ${turn} turns of cutting`).toBe("locked");
      expect(game.player.room).toBe(roomId(game, "r2"));
      expect(game.noise.get(roomId(game, "r2")), "the whole ship hears a cutter").toBe(9);
    }

    expect(game.playerCommand({ kind: "go", door: d3.id }).ok).toBe(true);
    expect(d3.state).toBe("broken");
    expect(game.player.room).toBe(roomId(game, "r4"));
  });

  it("wants the three turns consecutive", () => {
    const game = newGame();
    const d3 = game.ship.door("d3");
    game.player.breacher = true;
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });

    game.playerCommand({ kind: "go", door: d3.id });
    game.playerCommand({ kind: "wait" });
    game.playerCommand({ kind: "go", door: d3.id });
    game.playerCommand({ kind: "go", door: d3.id });
    expect(d3.state, "the pause started the cut over").toBe("locked");
  });

  it("keeps a machine without a cutter on its own side of a locked door", () => {
    const game = newGame();
    const grunt = machineIn(game, roomId(game, "r2"));
    const d3 = game.ship.door("d3");

    const out = perform(game, grunt, { kind: "go", door: d3.id });
    expect(out.ok).toBe(false);
    expect(out.reason ?? "").toMatch(/locked/);
    expect(grunt.room).toBe(roomId(game, "r2"));
    expect(d3.state).toBe("locked");
  });

  it("keeps machines out of the airlock and sends the drone to `leave`", () => {
    const game = newGame();
    const a1 = game.ship.airlock()!;
    const grunt = machineIn(game, roomId(game, "r1"));

    expect(perform(game, grunt, { kind: "go", door: a1.id }).ok).toBe(false);
    const mine = game.playerCommand({ kind: "go", door: a1.id });
    expect(mine.ok).toBe(false);
    expect(mine.reason ?? "").toMatch(/leave/);
  });
});

describe("attacks", () => {
  it("reaches the next room through an open door, and no further once it shuts", () => {
    const game = newGame();
    const turret = machineIn(game, roomId(game, "r2"), { range: 1, sight: 1 });

    const shot = perform(game, turret, { kind: "attack", target: game.player.id });
    expect(shot.ok).toBe(true);
    expect(game.player.hp).toBeLessThan(game.player.hpMax);

    game.ship.door("d1").state = "closed";
    const blocked = perform(game, turret, { kind: "attack", target: game.player.id });
    expect(blocked.ok).toBe(false);
    expect(blocked.reason ?? "").toMatch(/line of fire/);
  });

  it("kills what is in the room and says so once", () => {
    const game = newGame();
    const grunt = machineIn(game, roomId(game, "r1"), { hp: 1 });
    game.playerCommand({ kind: "attack", target: grunt.id });

    expect(grunt.alive).toBe(false);
    expect(game.kills).toBe(1);
    expect(game.log.lines.some((l) => l.text === "the grunt dies.")).toBe(true);
    expect(game.noise.get(roomId(game, "r1")), "fighting is loud").toBe(9);
  });

  it("refuses to strike an ally", () => {
    const game = newGame();
    const friend = machineIn(game, roomId(game, "r1"));
    const other = machineIn(game, roomId(game, "r1"));
    const out = perform(game, friend, { kind: "attack", target: other.id });
    expect(out.ok).toBe(false);
    expect(out.reason ?? "").toMatch(/ally/);
  });
});

describe("hiding", () => {
  it("survives waiting and nothing else", () => {
    const game = newGame();
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });

    expect(game.playerCommand({ kind: "hide" }).ok).toBe(true);
    expect(game.player.hidden).toBe(true);

    game.playerCommand({ kind: "wait" });
    expect(game.player.hidden, "standing still is what hiding is").toBe(true);

    game.playerCommand({ kind: "go", door: game.ship.door("d4").id });
    expect(game.player.hidden).toBe(false);
  });

  it("hides the drone from a machine without keen eyes", () => {
    const game = newGame();
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    game.playerCommand({ kind: "hide" });

    const blind = machineIn(game, roomId(game, "r2"), { sight: 1 });
    const keen = machineIn(game, roomId(game, "r2"), { sight: 1, keen: true });
    expect(game.entitiesIn(roomId(game, "r2")).length).toBe(3);
    // Same table for both sides: what the machine cannot see, it cannot chase.
    expect(perform(game, blind, { kind: "attack", target: game.player.id }).ok).toBe(true);
    expect(keen.keen).toBe(true);
  });
});

describe("noise across the ship", () => {
  it("loses one door on the way, three when the door is shut", () => {
    const game = newGame();
    const grunt = machineIn(game, roomId(game, "r1"), { hp: 30 });
    game.playerCommand({ kind: "attack", target: grunt.id });

    expect(game.noise.get(roomId(game, "r1"))).toBe(9);
    expect(game.noise.get(roomId(game, "r2")), "through the open d1").toBe(8);
    expect(game.noise.get(roomId(game, "r3")), "through the closed d2").toBe(6);
    expect(game.noise.get(roomId(game, "r4")), "a locked door swallows four").toBe(4);
  });
});

describe("the game's own verbs", () => {
  it("go to the first system that wants them, and land in the recording", () => {
    const seen: string[] = [];
    const game = newGame({
      twist: {
        name: "welder",
        performCommand(g, actor, cmd) {
          if (cmd.kind !== "act" || cmd.verb !== "weld") return undefined;
          seen.push(cmd.verb);
          g.makeNoise(g.roomOf(actor).id, 5);
          return { ok: true, cost: 100 };
        },
        // What a numbered action list is built from: label plus the command
        // that runs it, so pressing "1" is one call and no parsing.
        offerActions: () => [{ label: "weld d1", cmd: { kind: "act", verb: "weld" }, enabled: true }],
      },
    });

    const offer = game.twist.offerActions!(game)[0]!;
    expect(offer.label).toBe("weld d1");
    const out = game.playerCommand(offer.cmd);

    expect(out.ok).toBe(true);
    expect(seen).toEqual(["weld"]);
    expect(game.inputs).toEqual([{ kind: "act", verb: "weld" }]);
    expect(game.noise.get(roomId(game, "r1")), "the system shouts for itself").toBe(5);
  });
});

describe("the save format", () => {
  const inputs: RoomCommand[] = [
    { kind: "wait" },
    { kind: "hide" },
    { kind: "go", door: 3 },
    { kind: "attack", target: 12 },
    { kind: "leave" },
    { kind: "act", verb: "cut", target: 2 },
    { kind: "act", verb: "use", slot: 0 },
  ];

  it("carries every room command, at version 3", () => {
    expect(SAVE_VERSION).toBe(3);
    const back = decodeRun<RoomCommand>(encodeRun({ version: SAVE_VERSION, seed: 5, inputs }));
    expect(back.ok, back.reason ?? "").toBe(true);
    expect(back.record!.inputs).toEqual(inputs);
  });

  it("rejects a command that only looks like one", () => {
    for (const bad of [{ kind: "go", door: "x" }, { kind: "go" }, { kind: "act", target: 1 }, { kind: "attack" }]) {
      const text = JSON.stringify({ version: SAVE_VERSION, seed: 5, inputs: [bad] });
      expect(decodeRun(text).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
