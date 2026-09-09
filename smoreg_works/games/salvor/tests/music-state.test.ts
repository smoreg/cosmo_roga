import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type Entity, type MonsterKind, type RoomGame as Game } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { ENFORCER, MONSTERS } from "../src/content/monsters.js";
import { TUG_ID } from "../src/content/tug.js";
import { rigOf } from "../src/twist/rig.js";
import { BEAT_MS, GRID, musicStateFor, soundEnabled, volumeFor } from "../src/ui/music.js";

/**
 * What the run is doing to the music, on hand-drawn ships rather than on lucky
 * seeds.
 *
 * Every question the rule asks — is there a machine through that door, is the
 * rack down to two, is an ENFORCER out there — is a question about a graph and
 * a rack, so all of it is readable off five lines of fixture text. The point of
 * the rule being a pure function is that this file needs no browser and no
 * audio: what is under test is the decision, not the sound.
 *
 * The decision outlived the five loops it used to pick between. One track plays
 * now (`ui/music.ts`), and the state sets its level instead of its file — so
 * `musicStateFor` is unchanged and every case below still asks exactly what it
 * asked before, with `volumeFor` added underneath for what the answer now does.
 */

/**
 * `r2` is through an open door, `r3` is through a closed one. That pair is the
 * whole visibility half of the rule: a machine in `r2` is a fight starting and
 * a machine in `r3` is not.
 */
const SHIP = `
  TUG -a1- r1
  r1 -d1- r2
  r1 -(d2)- r3
  r1: docking
  r2: hold
  r3: hab
`;

const TUG = `
  TUG -a2- t1
  t1: deck
`;

/** No systems at all: none of them is what decides the music. */
function gameOn(text = SHIP): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed: 11,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
    systems: [],
  });
}

function put(game: Game, room: string, kind: MonsterKind): Entity {
  const machine = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  game.refreshSight();
  return machine;
}

/** Any ordinary machine will do: the rule asks whether one is there, not which. */
function machine(id: string): MonsterKind {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}' in the bestiary`);
  return kind;
}

const SCOUT = machine("scout");

/** Burn the rack down to `left` intact modules, the way three bad turns would. */
function rackDownTo(game: Game, left: number): void {
  const rig = rigOf(game.player);
  if (!rig) throw new Error("the drone has no rack");
  for (let i = rig.slots.length - 1; i >= 0; i--) {
    if (rig.slots.filter((slot) => slot !== null).length <= left) break;
    if (rig.slots[i] !== null) rig.slots[i] = null;
  }
}

describe("which state the run is in", () => {
  it("explores when nothing is looking and nothing is broken", () => {
    expect(musicStateFor(gameOn())).toBe("explore");
  });

  it("fights when a machine is in the compartment", () => {
    const game = gameOn();
    put(game, "r1", SCOUT);
    expect(musicStateFor(game)).toBe("combat");
  });

  it("fights when a machine is visible through an open door", () => {
    const game = gameOn();
    put(game, "r2", SCOUT);
    expect(musicStateFor(game)).toBe("combat");
  });

  it("does not fight a machine behind a closed door", () => {
    const game = gameOn();
    put(game, "r3", SCOUT);
    expect(musicStateFor(game)).toBe("explore");
  });

  it("does not fight a machine that is already dead", () => {
    const game = gameOn();
    const machine = put(game, "r1", SCOUT);
    machine.hp = 0;
    expect(musicStateFor(game)).toBe("explore");
  });

  it("hurts when the core is one hit from gone", () => {
    const game = gameOn();
    game.player.hp = 1;
    expect(musicStateFor(game)).toBe("hurt");
  });

  it("hurts when the rack is down to two modules", () => {
    const game = gameOn();
    rackDownTo(game, 2);
    expect(musicStateFor(game)).toBe("hurt");
  });

  it("does not hurt at three modules and a whole core", () => {
    const game = gameOn();
    rackDownTo(game, 3);
    expect(game.player.hp).toBeGreaterThan(1);
    expect(musicStateFor(game)).toBe("explore");
  });

  it("hunts when an ENFORCER is aboard, wherever it is standing", () => {
    const game = gameOn();
    put(game, "r3", ENFORCER); // behind a closed door: still the hunter's level
    expect(musicStateFor(game)).toBe("hunter");
  });

  it("goes quiet once the drone is back on the tug", () => {
    const game = gameOn();
    expect(musicStateFor(game)).toBe("explore");
    game.travelTo(TUG_ID, { generate: () => shipFromText(TUG).ship, reason: "custom" });
    expect(musicStateFor(game)).toBe("tug");
  });
});

describe("what outranks what", () => {
  it("keeps the tug the quiet place even with a hunter standing on it", () => {
    const game = gameOn();
    game.travelTo(TUG_ID, { generate: () => shipFromText(TUG).ship, reason: "custom" });
    put(game, "t1", ENFORCER);
    expect(musicStateFor(game)).toBe("tug");
  });

  it("lets the hunter outrank an ordinary fight", () => {
    const game = gameOn();
    put(game, "r1", SCOUT);
    put(game, "r1", ENFORCER);
    expect(musicStateFor(game)).toBe("hunter");
  });

  it("lets a fight outrank a wound, and hands the wound back afterwards", () => {
    const game = gameOn();
    game.player.hp = 1;
    const machine = put(game, "r1", SCOUT);
    expect(musicStateFor(game)).toBe("combat");

    machine.hp = 0;
    expect(musicStateFor(game)).toBe("hurt");
  });

  it("reaches all five states from one run's worth of situations", () => {
    const seen = new Set<string>();
    const explore = gameOn();
    seen.add(musicStateFor(explore));

    const hurt = gameOn();
    hurt.player.hp = 1;
    seen.add(musicStateFor(hurt));

    const combat = gameOn();
    put(combat, "r1", SCOUT);
    seen.add(musicStateFor(combat));

    const hunter = gameOn();
    put(hunter, "r1", ENFORCER);
    seen.add(musicStateFor(hunter));

    const tug = gameOn();
    tug.travelTo(TUG_ID, { generate: () => shipFromText(TUG).ship, reason: "custom" });
    seen.add(musicStateFor(tug));

    expect([...seen].sort()).toEqual(["combat", "explore", "hunter", "hurt", "tug"]);
  });
});

describe("what the state does to the level", () => {
  /**
   * The five numbers are the trims the five loops carried, kept to the digit:
   * the mix they describe was tuned by ear, and none of it was ever about which
   * file was playing.
   */
  it("keeps the tug under exploring and a fight over both", () => {
    expect(volumeFor("tug")).toBeLessThan(volumeFor("explore"));
    expect(volumeFor("explore")).toBeLessThan(volumeFor("hurt"));
    expect(volumeFor("hurt")).toBeLessThan(volumeFor("combat"));
    expect(volumeFor("hunter")).toBe(volumeFor("combat"));
  });

  it("gives every state a level inside the range the player has", () => {
    for (const state of ["tug", "explore", "combat", "hurt", "hunter"] as const) {
      expect(volumeFor(state)).toBeGreaterThan(0);
      expect(volumeFor(state)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the grid the track is played on", () => {
  /**
   * `main.ogg` is a 16-bar cut of the owner's track, so a phrase of this grid
   * and the loop point are the same instant and the beat survives the wrap.
   * Nothing cross-fades any more; what reads these numbers is the screen, which
   * flashes on the beat (`ui/pulse.ts`). tests/audio-assets.test.ts checks the
   * file on disk against them.
   */
  it("keeps the grid the track was cut against", () => {
    expect(GRID).toEqual({ bpm: 74.9, beatsPerBar: 4, barsPerPhrase: 16 });
  });

  it("makes a phrase exactly the length of the loop on disk", () => {
    const phrase = (60 / GRID.bpm) * GRID.beatsPerBar * GRID.barsPerPhrase;
    expect(phrase).toBeCloseTo(51.27, 1);
  });

  it("publishes the beat the screen flashes to, in milliseconds", () => {
    expect(BEAT_MS).toBeCloseTo(801.07, 1);
  });
});

describe("turning the sound off", () => {
  it("plays by default, and for anything that is not an off switch", () => {
    expect(soundEnabled("")).toBe(true);
    expect(soundEnabled("?seed=7")).toBe(true);
    expect(soundEnabled("?sound=on")).toBe(true);
  });

  it("stays quiet for the three spellings a player would try", () => {
    expect(soundEnabled("?sound=off")).toBe(false);
    expect(soundEnabled("?sound=0")).toBe(false);
    expect(soundEnabled("?sound=false")).toBe(false);
    expect(soundEnabled("?seed=7&sound=off")).toBe(false);
  });
});
