import { describe, it, expect, beforeEach } from "vitest";
import { RoomGame, hasStatus, spawnMonsterIn, type Entity } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { saidHint } from "../src/content/hints.js";
import { MONSTERS } from "../src/content/monsters.js";
import { MODULES, moduleBurnLine, moduleKind, type ModuleId } from "../src/content/modules.js";
import {
  SPIKE_TURNS,
  derivedStats,
  findSlot,
  install,
  registerHackTarget,
  rigOf,
  routeDamage,
  wrecksIn,
  type HackTarget,
  type Rig,
} from "../src/twist/rig.js";

/**
 * The active modules, on hand-drawn ships. Every effect is asked for through
 * `game.playerCommand`, so a module that works only when called directly is a
 * module this file fails.
 *
 * The systems are dropped on purpose: what lies in these compartments is
 * written into the fixture, and POPULATE would add the onboarding pile every
 * first ship of a run gets.
 */
function gameOn(text: string, seed = 7): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    systems: [],
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

/** Put a module in the rack and hand back the slot the `use` command needs. */
function fit(game: RoomGame, kind: ModuleId, integrity = 2): number {
  const r = rig(game);
  const existing = findSlot(r, kind);
  if (existing !== null) return existing;
  const i = install(r, kind, integrity);
  if (i === undefined) throw new Error("the rack is full");
  return i;
}

function room(game: RoomGame, label: string): number {
  return game.ship.room(label).id;
}

/** Four compartments in a line: far enough that a pulse stops short of the end. */
const CHAIN = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -(d2)- r3
  r3 -d3- r4
  r1: docking
  r2: cargo
  r3: corridor
  r4: storage
`;

/** Two compartments through an open door. */
const PAIR = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking
  r2: cargo
`;

/** The same two, with the door shut. */
const SHUT = `
  TUG -a1- r1
  r1 -(d1)- r2
  r1: docking
  r2: cargo
`;

describe("the scanner pulse", () => {
  it("reads two doors deep and not a room further", () => {
    const game = gameOn(CHAIN);
    const scanned = (label: string): boolean => game.ship.room(label).scanned;
    expect(scanned("r3")).toBe(false);

    const out = game.playerCommand({ kind: "act", verb: "use", slot: findSlot(rig(game), "scanner")! });
    expect(out.ok).toBe(true);
    expect([scanned("r1"), scanned("r2"), scanned("r3")]).toEqual([true, true, true]);
    expect(scanned("r4")).toBe(false);
    expect(game.log.tail(20).map((m) => m.text)).toContain(
      "Sensor pulse. Two doors of ship come back on the schematic.",
    );
  });

  it("goes through a shut door: it reads the ship, it does not look at it", () => {
    const game = gameOn(SHUT);
    game.playerCommand({ kind: "act", verb: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.ship.room("r2").scanned).toBe(true);
    // Scanned is not seen: the drone still cannot see past a closed door.
    expect(game.visible.has(room(game, "r2"))).toBe(false);
  });

  it("leaves a snapshot of what stood there, not a live feed", () => {
    const game = gameOn(CHAIN);
    const machine = put(game, "r3", "security-unit");
    game.playerCommand({ kind: "act", verb: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.ship.room("r3").data.snapshot).toBe("S");

    machine.room = room(game, "r4");
    expect(game.ship.room("r3").data.snapshot).toBe("S");
  });

  it("is loud: the whole ship hears it", () => {
    const game = gameOn(CHAIN);
    game.playerCommand({ kind: "act", verb: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.noise.get(room(game, "r1"))).toBe(8);
    expect(game.noise.get(room(game, "r2"))).toBe(7);
  });

  it("exposes the scanner itself", () => {
    const game = gameOn(CHAIN);
    const slot = findSlot(rig(game), "scanner")!;
    game.playerCommand({ kind: "act", verb: "use", slot });
    expect(rig(game).exposed).toBe(slot);
  });
});

describe("the EMP", () => {
  it("stuns everything in this compartment and nothing through the door", () => {
    const game = gameOn(PAIR);
    const near = put(game, "r1", "maintenance-bot");
    const far = put(game, "r2", "maintenance-bot");
    const slot = fit(game, "emp");

    const out = game.playerCommand({ kind: "act", verb: "use", slot });
    expect(out.ok).toBe(true);
    expect(hasStatus(near, "stun")).toBe(true);
    expect(hasStatus(far, "stun")).toBe(false);
    expect(rig(game).exposed).toBe(slot);
    expect(rig(game).slots[slot]!.charges).toBe(1);
    expect(game.noise.get(room(game, "r1"))).toBe(6);
  });

  it("spends its two charges and then refuses without costing a turn", () => {
    const game = gameOn(PAIR);
    put(game, "r1", "hauler");
    const slot = fit(game, "emp");
    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    expect(rig(game).slots[slot]!.charges).toBe(0);

    const turns = game.inputs.length;
    const energy = game.player.energy;
    const out = game.playerCommand({ kind: "act", verb: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "EMP is spent." });
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
    // The module stays in the rack: a spent EMP is still something to hit.
    expect(rig(game).slots[slot]!.kind).toBe("emp");
  });

  it("keeps its charge when the compartment is empty", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "emp");
    const out = game.playerCommand({ kind: "act", verb: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing in range." });
    expect(rig(game).slots[slot]!.charges).toBe(2);
  });
});

describe("the welder", () => {
  it("mends the most damaged other module, one point at a time", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "welder", 3);
    const r = rig(game);
    const cutter = findSlot(r, "cutter")!;
    const thrusters = findSlot(r, "thrusters")!;
    r.slots[cutter]!.integrity = 1;
    r.slots[thrusters]!.integrity = 2;

    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    expect(r.slots[cutter]!.integrity).toBe(2);
    expect(r.slots[thrusters]!.integrity).toBe(2);
    expect(game.log.tail(20).map((m) => m.text)).toContain(
      `You weld the CUTTER back to 2/${MODULES.cutter.integrity}.`,
    );
    expect(r.exposed).toBe(slot);
    expect(game.noise.get(room(game, "r1"))).toBe(5);
  });

  it("never welds itself", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "welder", 1);
    const r = rig(game);
    for (const s of r.slots) if (s && s.kind !== "welder") s.integrity = 99;

    const out = game.playerCommand({ kind: "act", verb: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing to repair." });
    expect(r.slots[slot]!.integrity).toBe(1);
  });

  it("never takes a module past the integrity its kind allows", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "welder", 3);
    const r = rig(game);
    const scanner = findSlot(r, "scanner")!;
    const full = MODULES.scanner.integrity;
    r.slots[scanner]!.integrity = full - 1; // the only damaged module

    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    expect(r.slots[scanner]!.integrity).toBe(full);
    const out = game.playerCommand({ kind: "act", verb: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing to repair." });
  });
});

describe("a key with nothing behind it", () => {
  it("refuses a passive module, an empty slot and a slot that is not there", () => {
    const game = gameOn(PAIR);
    const turns = game.inputs.length;
    const passive = findSlot(rig(game), "plating")!;

    expect(game.playerCommand({ kind: "act", verb: "use", slot: passive }).reason).toBe(
      "That module has no active use.",
    );
    expect(game.playerCommand({ kind: "act", verb: "use", slot: 5 }).reason).toBe("Empty slot.");
    expect(game.playerCommand({ kind: "act", verb: "use", slot: 99 }).reason).toBe("Empty slot.");
    expect(game.playerCommand({ kind: "act", verb: "use" }).reason).toBe("Empty slot.");
    expect(game.inputs).toHaveLength(turns);
  });

  it("refuses a burned module: the marker does not move onto a hole", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    const scanner = findSlot(r, "scanner")!;
    game.playerCommand({ kind: "wait" });
    const marker = r.exposed;
    r.slots[scanner] = null;

    expect(game.playerCommand({ kind: "act", verb: "use", slot: scanner }).ok).toBe(false);
    expect(r.exposed).toBe(marker);
  });
});

// ------------------------------------------------------------------ the spike

/**
 * The one thing the SPIKE can open in this file.
 *
 * `hackTargetAt` is a registry with no entries in the shipped game — locked
 * bulkheads (G14) and ship systems (G17) fill it later — so the tests below
 * register the provider those two will write, and prove the whole path works
 * before either exists.
 */
let breachable: { id: number; target: HackTarget } | undefined;

registerHackTarget((_game, target) =>
  breachable && breachable.id === target ? breachable.target : undefined,
);

beforeEach(() => {
  breachable = undefined;
});

/** A locked hatch under a known id, and a flag it flips when it opens. */
function lock(id: number): { opened: boolean } {
  const state = { opened: false };
  breachable = {
    id,
    target: {
      name: "hatch",
      turnsLeft: SPIKE_TURNS,
      expose: "spike",
      breach() {
        state.opened = true;
      },
    },
  };
  return state;
}

describe("the spike", () => {
  it("refuses where there is nothing locked, and costs no turn", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "spike");
    // One real turn first: the scheduler hands out energy on the way in, so a
    // refusal is only readable as "no turn spent" against a settled clock.
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    const energy = game.player.energy;

    expect(game.playerCommand({ kind: "act", verb: "use", slot, target: 77 })).toEqual({
      ok: false, cost: 0, reason: "Nothing to breach here.",
    });
    expect(game.playerCommand({ kind: "act", verb: "use", slot })).toEqual({
      ok: false, cost: 0, reason: "Nothing to breach here.",
    });
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
  });

  it("takes two turns, and opens on the second one", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "spike");
    const hatch = lock(12);

    expect(game.playerCommand({ kind: "act", verb: "use", slot, target: 12 }).ok).toBe(true);
    expect(hatch.opened).toBe(false);
    expect(game.log.tail(5).map((m) => m.text)).toContain("You work the SPIKE into the hatch.");

    expect(game.playerCommand({ kind: "act", verb: "use", slot, target: 12 }).ok).toBe(true);
    expect(hatch.opened).toBe(true);
    expect(game.log.tail(5).map((m) => m.text)).toContain("The hatch gives. You are through.");
  });

  it("is quieter than a fight: four, and it exposes the spike", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "spike");
    lock(12);

    game.playerCommand({ kind: "act", verb: "use", slot, target: 12 });
    expect(game.noise.get(room(game, "r1"))).toBe(4);
    expect(rig(game).exposed).toBe(slot);
  });
});

// ---------------------------------------------------------------- the emitter

describe("the emitter", () => {
  it("shoots the machine in the next compartment through an open door", () => {
    const game = gameOn(PAIR);
    const target = put(game, "r2", "security-unit");
    const before = target.hp;
    const slot = fit(game, "emitter");

    const out = game.playerCommand({ kind: "act", verb: "use", slot });
    expect(out.ok).toBe(true);
    // 1d4+1 against defense 0: between two and five, never nothing.
    expect(before - target.hp).toBeGreaterThanOrEqual(2);
    expect(before - target.hp).toBeLessThanOrEqual(5);
    expect(game.noise.get(room(game, "r1"))).toBe(7);
  });

  it("says what is left of the target, not only what came off", () => {
    // Damage alone does not answer the question the line is read for. The owner
    // took a ten point machine to three over two shots and read the exchange as
    // broken, because nothing on the screen said how close he was
    // (docs/owner-queue.md, 1).
    const game = gameOn(PAIR);
    const target = put(game, "r2", "security-unit");
    const slot = fit(game, "emitter");

    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    const line = game.log.lines.find((l) => l.key === "log.emitter.hit")!;
    expect(line.text).toContain(`(${target.hp}/${target.hpMax})`);
  });

  it("warns once, the first time it trades shots with something that shoots back", () => {
    // The rule is `exposure`'s said again for the one case a player meets it in
    // without ever being in the room: the answer lands on the emitter, and a
    // machine with a reach answers from where it stands.
    const game = gameOn(PAIR);
    const target = put(game, "r2", "sentry-turret");
    target.hp = 99;
    const slot = fit(game, "emitter");

    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    expect(saidHint(game.player, "shooting")).toBe(true);
    const said = (): number => game.log.lines.filter((l) => l.key === "hint.shooting").length;
    expect(said()).toBe(1);
    game.playerCommand({ kind: "act", verb: "use", slot });
    expect(said()).toBe(1);
  });

  it("says nothing about the answer when the target cannot give one", () => {
    const game = gameOn(PAIR);
    const target = put(game, "r2", "security-unit");
    target.hp = 99;
    const slot = fit(game, "emitter");

    expect(game.playerCommand({ kind: "act", verb: "use", slot }).ok).toBe(true);
    expect(saidHint(game.player, "shooting")).toBe(false);
  });

  it("refuses through a closed door, without costing a turn", () => {
    const game = gameOn(SHUT);
    put(game, "r2", "security-unit");
    const slot = fit(game, "emitter");
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    const energy = game.player.energy;

    expect(game.playerCommand({ kind: "act", verb: "use", slot })).toEqual({
      ok: false, cost: 0, reason: "Nothing in the line of fire.",
    });
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
  });

  it("takes what is in this compartment first", () => {
    const game = gameOn(PAIR);
    const near = put(game, "r1", "maintenance-bot");
    const far = put(game, "r2", "hauler");
    const slot = fit(game, "emitter");

    game.playerCommand({ kind: "act", verb: "use", slot });
    expect(near.hp).toBeLessThan(near.hpMax);
    expect(far.hp).toBe(far.hpMax);
  });

  it("answers to its own key as well as to its slot", () => {
    const game = gameOn(PAIR);
    const target = put(game, "r2", "security-unit");
    const slot = fit(game, "emitter");

    expect(game.playerCommand({ kind: "act", verb: "shoot" }).ok).toBe(true);
    expect(target.hp).toBeLessThan(target.hpMax);
    expect(rig(game).exposed).toBe(slot);
    expect(rig(game).exposed).not.toBe(findSlot(rig(game), "cutter"));
  });

  it("refuses the key with no emitter in the rack, and costs no turn", () => {
    const game = gameOn(PAIR);
    put(game, "r2", "security-unit");
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;

    expect(game.playerCommand({ kind: "act", verb: "shoot" })).toEqual({
      ok: false, cost: 0, reason: "No EMITTER in the rack.",
    });
    expect(game.inputs).toHaveLength(turns);
  });

  it("leaves scrap where the machine stood when the shot kills", () => {
    const game = gameOn(PAIR);
    const target = put(game, "r2", "feral-drone");
    target.hp = 1;
    fit(game, "emitter");

    game.playerCommand({ kind: "act", verb: "shoot" });
    expect(target.alive).toBe(false);
    expect(wrecksIn(game, room(game, "r2")).map((w) => w.kind)).toEqual(["thrusters"]);
    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- the baffle

describe("the baffle", () => {
  it("takes three off the noise of a step", () => {
    const loud = gameOn(PAIR);
    loud.playerCommand({ kind: "go", door: loud.ship.door("d1").id });
    expect(loud.noise.get(room(loud, "r2"))).toBe(3);

    const quiet = gameOn(PAIR);
    fit(quiet, "baffle");
    quiet.playerCommand({ kind: "go", door: quiet.ship.door("d1").id });
    expect(quiet.noise.get(room(quiet, "r2"))).toBeUndefined();
  });

  it("takes three off the pulse as well: it muffles the drone, not one key", () => {
    const game = gameOn(CHAIN);
    fit(game, "baffle");
    game.playerCommand({ kind: "act", verb: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.noise.get(room(game, "r1"))).toBe(5);
  });

  it("has no active use of its own", () => {
    const game = gameOn(PAIR);
    const slot = fit(game, "baffle");
    expect(game.playerCommand({ kind: "act", verb: "use", slot })).toEqual({
      ok: false, cost: 0, reason: "That module has no active use.",
    });
  });
});

// ------------------------------------------------------- the rack, three wider

describe("the module table", () => {
  it("carries the numbers design-doc.md's table asks for", () => {
    expect(MODULES.spike.integrity).toBe(3);
    expect(MODULES.emitter.integrity).toBe(3);
    expect(MODULES.emitter.attack).toEqual([1, 4, 1]);
    expect(MODULES.emitter.range).toBe(6);
    expect(MODULES.baffle.integrity).toBe(4);
    expect(MODULES.baffle.noisePenalty).toBe(3);
    expect(MODULES.baffle.machineFovPenalty).toBe(3);
    // The two numbers the graph reads differently: one door of sight, and the
    // speed a drone without thrusters is left with.
    expect(MODULES.scanner.sight).toBe(1);
    expect(MODULES.thrusters.speed).toBe(100);
  });

  it("installs every kind into the rack and burns each out with its own line", () => {
    for (const id of Object.keys(MODULES) as ModuleId[]) {
      const game = gameOn(PAIR);
      const r = rig(game);
      r.slots = r.slots.map(() => null);
      const slot = install(r, id, moduleKind(id).integrity)!;
      r.exposed = slot;

      const route = routeDamage(r, moduleKind(id).integrity);
      expect(route.hits[0]).toMatchObject({ slot, kind: id, burned: true });
      expect(r.slots[slot]).toBeNull();
      expect(r.scars[slot]).toBe(id);
      expect(r.burned).toContain(id);
      expect(moduleBurnLine(id)).toMatch(/^Your [A-Z]+ burns? out\./);
    }
  });

  it("gives the baffle's two derived stats, and takes them back when it burns", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    expect(derivedStats(r).noisePenalty).toBe(0);
    expect(derivedStats(r).machineFovPenalty).toBe(0);

    const slot = fit(game, "baffle", 4);
    expect(derivedStats(r).noisePenalty).toBe(3);
    expect(derivedStats(r).machineFovPenalty).toBe(3);

    r.exposed = slot;
    routeDamage(r, 4);
    expect(derivedStats(r).noisePenalty).toBe(0);
    expect(derivedStats(r).machineFovPenalty).toBe(0);
  });

  it("leaves speed, sight and bump damage exactly where they were", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    const before = derivedStats(r);
    fit(game, "emitter", 3);
    const after = derivedStats(r);
    // The EMITTER's dice are its shot, not the drone's swing.
    expect(after.damage).toEqual(before.damage);
    expect(after.speed).toBe(before.speed);
    expect(after.sight).toBe(before.sight);
  });
});
