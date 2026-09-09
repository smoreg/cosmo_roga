import { describe, it, expect } from "vitest";
import { spawnMonster, type Entity, type Game } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { MIN_MACHINE_FOV } from "../src/content/modules.js";
import { canSeeDrone, machineSight } from "../src/systems/sight.js";
import { deckOf, findSlot, install, rigOf, routeDamage, type Rig } from "../src/twist/rig.js";

/**
 * The other half of the BAFFLE: not "can the drone see", which the engine
 * answers, but "is the drone noticed", which only the game can — because only
 * the game knows what is in the rack.
 *
 * Every case here is a hand-drawn deck rather than a seed: the question is
 * geometry plus one number, and both should be readable at a glance.
 */
function gameOn(rows: string[]): { game: Game; machines: Entity[] } {
  const game = newGame(11);
  const f = fromAscii(rows);
  game.level = f.level;
  game.entities = [game.player];
  game.player.pos = { ...f.player! };
  const machines: Entity[] = [];
  for (const m of f.marks) {
    const kind = MONSTERS.find((k) => k.ch === m.ch);
    if (!kind) continue;
    const e = spawnMonster(kind, m.pos);
    game.schedule.admit(e);
    game.entities.push(e);
    machines.push(e);
  }
  deckOf(game).wrecks = [];
  game.refreshFov();
  return { game, machines };
}

function rig(game: Game): Rig {
  return rigOf(game.player)!;
}

/** The BAFFLE, in the rack's one empty slot. */
function baffle(game: Game, integrity = 4): number {
  const i = install(rig(game), "baffle", integrity);
  if (i === undefined) throw new Error("the rack is full");
  return i;
}

/** A security unit (sight 8) `dist` tiles east, down an empty corridor. */
function corridor(dist: number): string[] {
  return ["#".repeat(dist + 3), `#@${".".repeat(dist - 1)}S#`, "#".repeat(dist + 3)];
}

describe("what a machine can see", () => {
  it("sees the drone inside its own radius and not a tile beyond it", () => {
    const near = gameOn(corridor(8));
    expect(canSeeDrone(near.game, near.machines[0]!)).toBe(true);

    const far = gameOn(corridor(9));
    expect(canSeeDrone(far.game, far.machines[0]!)).toBe(false);
  });

  it("does not see through a wall it is standing behind", () => {
    // Two tiles apart in a straight line, with the corridor wall between them.
    const { game, machines } = gameOn(["#####", "#@..#", "###.#", "#..S#", "#####"]);
    const machine = machines[0]!;
    expect(machineSight(game, machine)).toBeGreaterThanOrEqual(3);
    expect(canSeeDrone(game, machine)).toBe(false);
  });

  it("sees nothing once it is dead", () => {
    const { game, machines } = gameOn(corridor(3));
    const machine = machines[0]!;
    expect(canSeeDrone(game, machine)).toBe(true);
    machine.alive = false;
    expect(canSeeDrone(game, machine)).toBe(false);
  });
});

describe("the baffle, seen from the machine's side", () => {
  it("takes three tiles off the radius: seen at eight becomes unseen", () => {
    const { game, machines } = gameOn(corridor(8));
    const machine = machines[0]!;
    expect(canSeeDrone(game, machine)).toBe(true);

    baffle(game);
    expect(machineSight(game, machine)).toBe(5);
    expect(canSeeDrone(game, machine)).toBe(false);
  });

  it("shortens the range, it does not hide the drone standing next to it", () => {
    const { game, machines } = gameOn(corridor(1));
    baffle(game);
    expect(canSeeDrone(game, machines[0]!)).toBe(true);
  });

  it("never takes a machine below the floor", () => {
    const { game, machines } = gameOn(corridor(2));
    const machine = machines[0]!;
    // A machine that barely looks at all: three minus three is not zero here.
    machine.fovRadius = 3;
    baffle(game);
    expect(machineSight(game, machine)).toBe(MIN_MACHINE_FOV);
    expect(canSeeDrone(game, machine)).toBe(true);
  });

  it("gives the tiles back the turn it burns out", () => {
    const { game, machines } = gameOn(corridor(8));
    const machine = machines[0]!;
    const slot = baffle(game);
    expect(canSeeDrone(game, machine)).toBe(false);

    const r = rig(game);
    r.exposed = slot;
    routeDamage(r, 4);
    expect(r.slots[slot]).toBeNull();
    expect(machineSight(game, machine)).toBe(8);
    expect(canSeeDrone(game, machine)).toBe(true);
  });

  it("leaves the machine's own field alone: nothing is written to the deck", () => {
    const { game, machines } = gameOn(corridor(8));
    const machine = machines[0]!;
    baffle(game);
    canSeeDrone(game, machine);
    // The penalty lives in the question, not in the machine. A reinforcement
    // spawned while the BAFFLE was up must not keep it after the module burns.
    expect(machine.fovRadius).toBe(8);
    expect(findSlot(rig(game), "baffle")).not.toBeNull();
  });
});
