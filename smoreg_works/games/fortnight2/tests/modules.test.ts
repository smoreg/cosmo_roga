import { describe, it, expect, beforeEach } from "vitest";
import { hasStatus, spawnMonster, type Entity, type Game, type Point } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { MODULES, moduleKind, type ModuleId } from "../src/content/modules.js";
import {
  SPIKE_TURNS,
  deckOf,
  derivedStats,
  findSlot,
  install,
  registerHackTarget,
  rigOf,
  routeDamage,
  type HackTarget,
  type Rig,
} from "../src/twist/rig.js";

/**
 * The active modules, on hand-drawn decks. Every effect is asked for through
 * `game.playerCommand`, so a module that works only when called directly is a
 * module this file fails.
 */
function gameOn(rows: string[], seed = 7): { game: Game; monsters: Entity[] } {
  const game = newGame(seed);
  const f = fromAscii(rows);
  game.level = f.level;
  game.entities = [game.player];
  game.player.pos = { ...f.player! };
  const monsters: Entity[] = [];
  for (const m of f.marks) {
    const kind = MONSTERS.find((k) => k.ch === m.ch);
    if (!kind) continue;
    const e = spawnMonster(kind, m.pos);
    game.schedule.admit(e);
    game.entities.push(e);
    monsters.push(e);
  }
  deckOf(game).wrecks = [];
  game.refreshFov();
  return { game, monsters };
}

function rig(game: Game): Rig {
  return rigOf(game.player)!;
}

/** Put a module in the rack and hand back the slot the `use` command needs. */
function fit(game: Game, kind: ModuleId, integrity = 2): number {
  const r = rig(game);
  const existing = findSlot(r, kind);
  if (existing !== null) return existing;
  const i = install(r, kind, integrity);
  if (i === undefined) throw new Error("the rack is full");
  return i;
}

/** A long hall: room enough for a pulse to outrun the drone's own eyes. */
function hall(width: number): string[] {
  return ["#".repeat(width), "#@" + ".".repeat(width - 3) + "#", "#".repeat(width)];
}

const ROOM = [
  "#########",
  "#.......#",
  "#.......#",
  "#...@...#",
  "#.......#",
  "#########",
];

describe("the scanner pulse", () => {
  it("maps a radius of 14 the drone cannot see, and nothing at 15", () => {
    // A wall two tiles east stops the FOV; only the pulse gets past it.
    const rows = ["#".repeat(40), "#@" + "#" + ".".repeat(36) + "#", "#".repeat(40)];
    const { game } = gameOn(rows);
    const p = game.player.pos;
    const at = (dx: number): boolean => game.level.explored.get(p.x + dx, p.y) === true;
    expect(at(14)).toBe(false);

    const slot = findSlot(rig(game), "scanner")!;
    const out = game.playerCommand({ kind: "use", slot });
    expect(out.ok).toBe(true);
    expect(at(14)).toBe(true);
    expect(at(15)).toBe(false);
    expect(game.log.tail(20).map((m) => m.text)).toContain("Sensor pulse. The deck lights up on your map.");
  });

  it("remembers the deck without lighting it: the machines stay hidden", () => {
    const rows = ["#".repeat(40), "#@" + "#" + ".".repeat(36) + "#", "#".repeat(40)];
    const { game } = gameOn(rows);
    const p = game.player.pos;
    game.playerCommand({ kind: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.level.explored.get(p.x + 10, p.y)).toBe(true);
    expect(game.level.visible.get(p.x + 10, p.y)).toBe(false);
  });

  it("is loud: the whole deck hears it", () => {
    const { game } = gameOn(hall(30));
    const p = { ...game.player.pos };
    game.playerCommand({ kind: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.noise.get(p.x, p.y)).toBe(8);
  });

  it("exposes the scanner itself", () => {
    const { game } = gameOn(ROOM);
    const slot = findSlot(rig(game), "scanner")!;
    game.playerCommand({ kind: "use", slot });
    expect(rig(game).exposed).toBe(slot);
  });
});

describe("the EMP", () => {
  it("stuns every neighbour and nothing a tile further out", () => {
    const { game, monsters } = gameOn(["######", "#m@.m#", "######"]);
    const [near, far] = monsters as [Entity, Entity];
    const slot = fit(game, "emp");

    const out = game.playerCommand({ kind: "use", slot });
    expect(out.ok).toBe(true);
    expect(hasStatus(near, "stun")).toBe(true);
    expect(hasStatus(far, "stun")).toBe(false);
    expect(rig(game).exposed).toBe(slot);
    expect(rig(game).slots[slot]!.charges).toBe(1);
  });

  it("spends its two charges and then refuses without costing a turn", () => {
    const { game } = gameOn(["####", "#m@#", "####"]);
    const slot = fit(game, "emp");
    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
    expect(rig(game).slots[slot]!.charges).toBe(0);

    const turns = game.inputs.length;
    const energy = game.player.energy;
    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "EMP is spent." });
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
    // The module stays in the rack: a spent EMP is still something to hit.
    expect(rig(game).slots[slot]!.kind).toBe("emp");
  });

  it("keeps its charge when there is nothing in range", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "emp");
    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing in range." });
    expect(rig(game).slots[slot]!.charges).toBe(2);
  });
});

describe("the welder", () => {
  it("mends the most damaged other module, one point at a time", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "welder", 3);
    const r = rig(game);
    const cutter = findSlot(r, "cutter")!;
    const thrusters = findSlot(r, "thrusters")!;
    r.slots[cutter]!.integrity = 1;
    r.slots[thrusters]!.integrity = 2;

    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
    expect(r.slots[cutter]!.integrity).toBe(2);
    expect(r.slots[thrusters]!.integrity).toBe(2);
    expect(game.log.tail(20).map((m) => m.text)).toContain(
      `You weld the CUTTER back to 2/${MODULES.cutter.integrity}.`,
    );
    expect(r.exposed).toBe(slot);
  });

  it("never welds itself", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "welder", 1);
    const r = rig(game);
    for (const s of r.slots) if (s && s.kind !== "welder") s.integrity = 99;

    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing to repair." });
    expect(r.slots[slot]!.integrity).toBe(1);
  });

  it("never takes a module past the integrity its kind allows", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "welder", 3);
    const r = rig(game);
    const scanner = findSlot(r, "scanner")!;
    const full = MODULES.scanner.integrity;
    r.slots[scanner]!.integrity = full - 1; // the only damaged module

    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
    expect(r.slots[scanner]!.integrity).toBe(full);
    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing to repair." });
  });

  it("is heard, but not as far as the pulse", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "welder", 3);
    const p: Point = { ...game.player.pos };
    rig(game).slots[findSlot(rig(game), "cutter")!]!.integrity = 1;

    game.playerCommand({ kind: "use", slot });
    expect(game.noise.get(p.x, p.y)).toBe(5);
  });
});

describe("a key with nothing behind it", () => {
  it("refuses a passive module, an empty slot and a slot that is not there", () => {
    const { game } = gameOn(ROOM);
    const turns = game.inputs.length;
    const passive = findSlot(rig(game), "plating")!;

    expect(game.playerCommand({ kind: "use", slot: passive }).reason).toBe("That module has no active use.");
    expect(game.playerCommand({ kind: "use", slot: 5 }).reason).toBe("Empty slot.");
    expect(game.playerCommand({ kind: "use", slot: 99 }).reason).toBe("Empty slot.");
    expect(game.inputs).toHaveLength(turns);
  });

  it("refuses a burned module: the marker does not move onto a hole", () => {
    const { game } = gameOn(ROOM);
    const r = rig(game);
    const scanner = findSlot(r, "scanner")!;
    game.playerCommand({ kind: "wait" });
    const marker = r.exposed;
    r.slots[scanner] = null;

    expect(game.playerCommand({ kind: "use", slot: scanner }).ok).toBe(false);
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
let breachable: { pos: Point; target: HackTarget } | undefined;

registerHackTarget((_game, pos) =>
  breachable && breachable.pos.x === pos.x && breachable.pos.y === pos.y ? breachable.target : undefined,
);

beforeEach(() => {
  breachable = undefined;
});

/** A locked hatch at an offset from the drone, and a flag it flips when it opens. */
function lock(game: Game, dx: number, dy: number): { opened: boolean } {
  const state = { opened: false };
  breachable = {
    pos: { x: game.player.pos.x + dx, y: game.player.pos.y + dy },
    target: {
      name: "hatch",
      turnsLeft: SPIKE_TURNS,
      breach() {
        state.opened = true;
      },
    },
  };
  return state;
}

describe("the spike", () => {
  it("refuses where there is nothing locked, and costs no turn", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "spike");
    // One real turn first: the scheduler hands out energy on the way in, so a
    // refusal is only readable as "no turn spent" against a settled clock.
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    const energy = game.player.energy;

    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing to breach here." });
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
  });

  it("takes two turns, and opens on the second one", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "spike");
    const hatch = lock(game, 1, 0);

    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
    expect(hatch.opened).toBe(false);
    expect(game.log.tail(5).map((m) => m.text)).toContain("You work the SPIKE into the hatch.");

    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
    expect(hatch.opened).toBe(true);
    expect(game.log.tail(5).map((m) => m.text)).toContain("The hatch gives. You are through.");
  });

  it("reaches the tile under the drone as well as its neighbours", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "spike");
    lock(game, 0, 0);
    expect(game.playerCommand({ kind: "use", slot }).ok).toBe(true);
  });

  it("is quieter than a fight: four", () => {
    const { game } = gameOn(hall(30));
    const slot = fit(game, "spike");
    const p: Point = { ...game.player.pos };
    lock(game, 1, 0);

    game.playerCommand({ kind: "use", slot });
    expect(game.noise.get(p.x, p.y)).toBe(4);
  });

  it("exposes the spike itself", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "spike");
    lock(game, 1, 0);
    game.playerCommand({ kind: "use", slot });
    expect(rig(game).exposed).toBe(slot);
  });
});

// ---------------------------------------------------------------- the emitter

/** A machine `dist` tiles east of the drone, down a corridor with nothing in it. */
function corridor(dist: number, ch = "S"): string[] {
  const inner = ".".repeat(dist - 1);
  return ["#".repeat(dist + 3), `#@${inner}${ch}#`, "#".repeat(dist + 3)];
}

describe("the emitter", () => {
  it("shoots the machine six tiles away", () => {
    const { game, monsters } = gameOn(corridor(6));
    const [target] = monsters as [Entity];
    const before = target.hp;
    const slot = fit(game, "emitter");

    const out = game.playerCommand({ kind: "use", slot });
    expect(out.ok).toBe(true);
    // 1d4+1 against defense 0: between two and five, never nothing.
    expect(before - target.hp).toBeGreaterThanOrEqual(2);
    expect(before - target.hp).toBeLessThanOrEqual(5);
  });

  it("refuses at seven tiles, without costing a turn", () => {
    const { game } = gameOn(corridor(7));
    const slot = fit(game, "emitter");
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing in range." });
    expect(game.inputs).toHaveLength(turns);
  });

  it("refuses through a wall: the shot needs the line, not the distance", () => {
    // Three tiles away and behind the corridor's own wall.
    const { game, monsters } = gameOn(["#####", "#@..#", "###.#", "#..S#", "#####"]);
    expect(monsters).toHaveLength(1);
    const slot = fit(game, "emitter");
    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing in range." });
  });

  it("is louder than a fight: seven", () => {
    const { game } = gameOn(corridor(6));
    const p: Point = { ...game.player.pos };
    const slot = fit(game, "emitter");
    game.playerCommand({ kind: "use", slot });
    expect(game.noise.get(p.x, p.y)).toBe(7);
  });

  it("exposes the emitter, not the cutter", () => {
    const { game } = gameOn(corridor(6));
    const slot = fit(game, "emitter");
    game.playerCommand({ kind: "use", slot });
    expect(rig(game).exposed).toBe(slot);
    expect(rig(game).exposed).not.toBe(findSlot(rig(game), "cutter"));
  });

  it("leaves scrap when the shot kills: a kill is a kill", () => {
    const { game, monsters } = gameOn(corridor(6));
    const [target] = monsters as [Entity];
    target.hp = 1;
    const slot = fit(game, "emitter");

    game.playerCommand({ kind: "use", slot });
    expect(target.alive).toBe(false);
    expect(deckOf(game).wrecks).toHaveLength(1);
  });
});

// ----------------------------------------------------------------- the baffle

describe("the baffle", () => {
  it("takes three off the noise of a step", () => {
    const { game } = gameOn(hall(30));
    const loud = { ...game.player.pos, x: game.player.pos.x + 1 };
    game.playerCommand({ kind: "move", dx: 1, dy: 0 });
    expect(game.noise.get(loud.x, loud.y)).toBe(3);

    const quiet = gameOn(hall(30));
    fit(quiet.game, "baffle");
    quiet.game.playerCommand({ kind: "move", dx: 1, dy: 0 });
    expect(quiet.game.noise.get(loud.x, loud.y)).toBe(0);
  });

  it("takes three off the pulse as well: it muffles the drone, not one key", () => {
    const { game } = gameOn(hall(30));
    const p: Point = { ...game.player.pos };
    fit(game, "baffle");
    game.playerCommand({ kind: "use", slot: findSlot(rig(game), "scanner")! });
    expect(game.noise.get(p.x, p.y)).toBe(5);
  });

  it("has no active use of its own", () => {
    const { game } = gameOn(ROOM);
    const slot = fit(game, "baffle");
    const out = game.playerCommand({ kind: "use", slot });
    expect(out).toEqual({ ok: false, cost: 0, reason: "That module has no active use." });
  });
});

// ------------------------------------------------------- the rack, three wider

describe("the three new modules", () => {
  it("carry the numbers design-doc.md's table asks for", () => {
    expect(MODULES.spike.integrity).toBe(3);
    expect(MODULES.emitter.integrity).toBe(3);
    expect(MODULES.emitter.attack).toEqual([1, 4, 1]);
    expect(MODULES.emitter.range).toBe(6);
    expect(MODULES.baffle.integrity).toBe(4);
    expect(MODULES.baffle.noisePenalty).toBe(3);
    expect(MODULES.baffle.machineFovPenalty).toBe(3);
  });

  it("install into the rack and burn out of it, each with its own line", () => {
    for (const id of ["spike", "emitter", "baffle"] as const) {
      const { game } = gameOn(ROOM);
      const slot = fit(game, id, moduleKind(id).integrity);
      const r = rig(game);
      r.exposed = slot;

      const route = routeDamage(r, moduleKind(id).integrity);
      expect(route.hits[0]).toMatchObject({ slot, kind: id, burned: true });
      expect(r.slots[slot]).toBeNull();
      expect(r.scars[slot]).toBe(id);
      expect(r.burned).toContain(id);
      expect(moduleKind(id).burnLine).toMatch(/^Your (SPIKE|EMITTER|BAFFLE) burns out\./);
    }
  });

  it("give the baffle's two derived stats, and take them back when it burns", () => {
    const { game } = gameOn(ROOM);
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

  it("leave speed, sight and bump damage exactly where they were", () => {
    const { game } = gameOn(ROOM);
    const r = rig(game);
    const before = derivedStats(r);
    fit(game, "emitter", 3);
    const after = derivedStats(r);
    // The EMITTER's dice are its shot, not the drone's swing.
    expect(after.damage).toEqual(before.damage);
    expect(after.speed).toBe(before.speed);
    expect(after.fovRadius).toBe(before.fovRadius);
  });
});
