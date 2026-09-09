import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type Entity, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { ENFORCER, MONSTERS } from "../src/content/monsters.js";
import { contactsWarning, dangerWord } from "../src/systems/contacts.js";

/**
 * The loud half of the contacts block: one line in the log on the turn the
 * drone walks in on something alive, and never on any other turn
 * (docs/tasks/G47-contacts.md).
 *
 * The panel draws the same fact on every frame, which is why it is not enough
 * on its own — the owner walked into a compartment with a machine in it and
 * took hits without noticing ("меня бьют, я игнорю"). What a moving thing on a
 * still screen cannot do, a line that appears exactly once can.
 */

const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r2 -#d6#- r6
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r6: corridor explored
`;

function gameIn(room = "r1"): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed: 7 });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): Entity {
  const kind = id === "enforcer" ? ENFORCER : MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

/** The door out of `r1` into `r2`, which is the walk every test here takes. */
function walkToCargo(game: RoomGame): void {
  game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
}

const said = (game: RoomGame): string[] =>
  game.log.lines.filter((l) => l.key === "log.contacts.here").map((l) => l.text);

describe("walking in on something", () => {
  it("says nothing at all about an empty compartment", () => {
    const game = gameIn();
    walkToCargo(game);
    expect(game.roomOf(game.player).label).toBe("r2");
    expect(said(game)).toEqual([]);
  });

  it("names what is standing there, once, on the turn the drone arrives", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    walkToCargo(game);

    expect(said(game)).toEqual(["In here: security unit 8/8, melee."]);
    // And before the first blow lands, which is the whole point of it: the
    // player is told what is in the room by the step, not by the damage.
    const keys = game.log.lines.map((l) => l.key);
    expect(keys.indexOf("log.contacts.here")).toBeLessThan(keys.indexOf("log.hit.module"));
  });

  it("does not say it again for standing still", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    walkToCargo(game);
    for (let i = 0; i < 5; i++) game.playerCommand({ kind: "wait" });

    expect(said(game)).toHaveLength(1);
  });

  it("says nothing for a machine that is only visible through a door", () => {
    // The line is about the compartment the drone is standing in. What is
    // behind an open door is the panel's business and the schematic's.
    const game = gameIn();
    put(game, "r5", "scout");
    walkToCargo(game);

    expect(game.visible.has(game.ship.room("r5").id)).toBe(true);
    expect(said(game)).toEqual([]);
  });

  it("says it again when the drone leaves and comes back", () => {
    const game = gameIn();
    put(game, "r2", "welder-bot");
    walkToCargo(game);
    game.playerCommand({ kind: "go", door: game.ship.door("d1").id });
    walkToCargo(game);

    expect(said(game)).toHaveLength(2);
  });

  it("costs no turn of its own", () => {
    const quiet = gameIn();
    walkToCargo(quiet);
    const loud = gameIn();
    put(loud, "r2", "security-unit");
    walkToCargo(loud);

    expect(loud.schedule.time).toBe(quiet.schedule.time);
  });

  it("names all of them, in one line", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    put(game, "r2", "jammer");
    walkToCargo(game);

    expect(said(game)).toEqual(["In here: security unit 8/8, melee; jammer 5/5, jams."]);
  });
});

describe("the sentence itself", () => {
  it("is nothing at all in an empty compartment", () => {
    expect(contactsWarning(gameIn())).toBeUndefined();
  });

  it("carries the hit points and the word, in the order the panel lists them", () => {
    const game = gameIn("r2");
    put(game, "r2", "crawler");
    expect(contactsWarning(game)).toBe("In here: crawler 3/3, no scrap.");
  });
});

/**
 * The one word, read off the entity rather than the catalogue — so a ghost and
 * the rival's drone are answered for as well as the table is.
 */
describe("what a machine is dangerous for", () => {
  const kind = (id: string): Entity =>
    spawnMonsterIn(MONSTERS.find((m) => m.id === id)!, 0);

  it("names the swing, the reach, the field, the waste and the stillness", () => {
    expect(dangerWord(kind("security-unit"))).toBe("melee");
    expect(dangerWord(kind("sentry-turret"))).toBe("shoots");
    expect(dangerWord(kind("jammer"))).toBe("jams");
    expect(dangerWord(kind("crawler"))).toBe("no scrap");
    expect(dangerWord(kind("bloom"))).toBe("sits");
  });

  it("calls the hunter a hunter in the compartment, and a shooter a door away", () => {
    // The ENFORCER shoots through a door and comes looking, and which of the
    // two the word says depends on where it is standing. In the room, the
    // hunter: a machine you can walk away from is a different problem from one
    // that follows through what you welded shut. A door away, the reach —
    // because that is the question a bulkhead raises and nothing else on the
    // screen answers it. The owner traded shots with one through an open door
    // and read `hunter` as a promise that it would come to him
    // (docs/owner-queue.md, 1).
    expect(ENFORCER.range).toBe(1);
    expect(dangerWord(spawnMonsterIn(ENFORCER, 0))).toBe("hunter");
    expect(dangerWord(spawnMonsterIn(ENFORCER, 0), true)).toBe("shoots");
  });

  it("keeps the word a door away for everything that cannot reach through one", () => {
    // Only the reach changes places. A jammer behind a bulkhead is still a
    // jammer, and a machine that has to walk still has to walk.
    expect(dangerWord(kind("jammer"), true)).toBe("jams");
    expect(dangerWord(kind("security-unit"), true)).toBe("melee");
    expect(dangerWord(kind("crawler"), true)).toBe("no scrap");
    expect(dangerWord(kind("sentry-turret"), true)).toBe("shoots");
  });

  it("answers for an entity no catalogue row describes", () => {
    const ghost = spawnMonsterIn({ ...MONSTERS[0]!, id: "ghost", name: "ghost", ch: "G" }, 0);
    expect(dangerWord(ghost)).toBe("melee");
  });

  it("gives every machine aboard a word", () => {
    for (const machine of [...MONSTERS, ENFORCER]) {
      expect(dangerWord(spawnMonsterIn(machine, 0)).length, machine.id).toBeGreaterThan(0);
    }
  });
});
