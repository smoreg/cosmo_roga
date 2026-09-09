import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type Entity } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { baffled, canSeeDrone } from "../src/systems/sight.js";
import { findSlot, install, rigOf, routeDamage, type Rig } from "../src/twist/rig.js";

/**
 * The other half of the BAFFLE: not "can the drone see", which the engine
 * answers, but "is the drone noticed", which only the game can — because only
 * the game knows what is in the rack.
 *
 * Every case here is a hand-drawn ship rather than a seed: the question is two
 * compartments, one door and one module, and all three should be readable at a
 * glance.
 */
function gameOn(text: string, seed = 11): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  });
}

function put(game: RoomGame, room: string, id: string): Entity {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

function rig(game: RoomGame): Rig {
  return rigOf(game.player)!;
}

/** The BAFFLE, in the rack's one empty slot. */
function baffle(game: RoomGame, integrity = 4): number {
  const i = install(rig(game), "baffle", integrity);
  if (i === undefined) throw new Error("the rack is full");
  return i;
}

/** The drone in r1 with cover, a machine through an open door in r2. */
const OPEN = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking cover
  r2: cargo
`;

const SHUT = `
  TUG -a1- r1
  r1 -(d1)- r2
  r1: docking cover
  r2: cargo
`;

describe("what a machine can see", () => {
  it("always sees a drone standing in its own compartment", () => {
    const game = gameOn(OPEN);
    // The hauler is the blindest thing aboard: sight 0, and it still sees this.
    expect(canSeeDrone(game, put(game, "r1", "hauler"))).toBe(true);
  });

  it("sees through an open door only with sight of its own", () => {
    const game = gameOn(OPEN);
    expect(canSeeDrone(game, put(game, "r2", "security-unit"))).toBe(true);
    expect(canSeeDrone(game, put(game, "r2", "hauler"))).toBe(false);
  });

  it("sees nothing through a closed door", () => {
    const game = gameOn(SHUT);
    expect(canSeeDrone(game, put(game, "r2", "security-unit"))).toBe(false);
  });

  it("sees nothing once it is dead", () => {
    const game = gameOn(OPEN);
    const machine = put(game, "r1", "security-unit");
    expect(canSeeDrone(game, machine)).toBe(true);
    machine.alive = false;
    expect(canSeeDrone(game, machine)).toBe(false);
  });

  it("loses a drone in cover unless it is keen", () => {
    const game = gameOn(OPEN);
    const blunt = put(game, "r1", "security-unit");
    const keen = put(game, "r1", "scout");
    expect(game.playerCommand({ kind: "hide" }).ok).toBe(true);
    expect(game.player.hidden).toBe(true);

    expect(canSeeDrone(game, blunt)).toBe(false);
    expect(canSeeDrone(game, keen)).toBe(true);
  });
});

describe("the baffle, seen from the machine's side", () => {
  it("closes the door on a machine one room away", () => {
    const game = gameOn(OPEN);
    const machine = put(game, "r2", "security-unit");
    expect(canSeeDrone(game, machine)).toBe(true);

    baffle(game);
    expect(baffled(game)).toBe(true);
    expect(canSeeDrone(game, machine)).toBe(false);
  });

  it("shortens the range, it does not hide a drone in the same room", () => {
    const game = gameOn(OPEN);
    const machine = put(game, "r1", "security-unit");
    baffle(game);
    expect(canSeeDrone(game, machine)).toBe(true);
  });

  it("hides a drone in cover even from something keen", () => {
    const game = gameOn(OPEN);
    const keen = put(game, "r1", "scout");
    game.playerCommand({ kind: "hide" });
    expect(canSeeDrone(game, keen)).toBe(true);

    baffle(game);
    expect(canSeeDrone(game, keen)).toBe(false);
  });

  it("gives the door back the turn it burns out", () => {
    const game = gameOn(OPEN);
    const machine = put(game, "r2", "security-unit");
    const slot = baffle(game);
    expect(canSeeDrone(game, machine)).toBe(false);

    const r = rig(game);
    r.exposed = slot;
    routeDamage(r, 4);
    expect(r.slots[slot]).toBeNull();
    expect(baffled(game)).toBe(false);
    expect(canSeeDrone(game, machine)).toBe(true);
  });

  it("leaves the machine's own fields alone: nothing is written to the ship", () => {
    const game = gameOn(OPEN);
    const machine = put(game, "r2", "security-unit");
    baffle(game);
    canSeeDrone(game, machine);
    // The penalty lives in the question, not in the machine. A reinforcement
    // woken while the BAFFLE was up must not keep it after the module burns.
    expect(machine.sight).toBe(1);
    expect(machine.keen).toBeUndefined();
    expect(findSlot(rig(game), "baffle")).not.toBeNull();
  });
});
