import { describe, it, expect } from "vitest";
import { Rng, replay, spawnMonster, type Command, type Entity, type Game } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { BARE_CHASSIS, moduleKind, type ModuleId } from "../src/content/modules.js";
import {
  RIG,
  derivedStats,
  expose,
  findSlot,
  install,
  makeStartingRig,
  repair,
  rigOf,
  routeDamage,
  type Rig,
} from "../src/twist/rig.js";

/**
 * A run on a hand-drawn deck. The map is replaced after the fact so the tests
 * read as pictures instead of as lucky seeds, but the game itself is the real
 * one: same twist, same turn cycle, same `newGame` the UI calls.
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
  game.refreshFov();
  return { game, monsters };
}

function rig(game: Game): Rig {
  return rigOf(game.player)!;
}

/** Force a rack into a known state; the pure functions get tested directly. */
function setRig(game: Game, mutate: (r: Rig) => void): Rig {
  const r = rig(game);
  mutate(r);
  return r;
}

function slotOf(r: Rig, kind: ModuleId): number {
  const i = findSlot(r, kind);
  if (i === null) throw new Error(`no ${kind} in the rack`);
  return i;
}

const ROOM = [
  "#########",
  "#.......#",
  "#.......#",
  "#...@...#",
  "#.......#",
  "#.......#",
  "#########",
];

describe("the starting rack", () => {
  it("holds five modules and one empty slot", () => {
    const r = makeStartingRig();
    expect(r.slots.map((s) => s?.kind ?? null)).toEqual([
      "cutter", "thrusters", "scanner", "plating", "cell", null,
    ]);
    // Full, whatever the table currently says full is.
    expect(r.slots.map((s) => s?.integrity ?? 0)).toEqual(
      r.slots.map((s) => (s ? moduleKind(s.kind).integrity : 0)),
    );
    expect(r.exposed).toBeNull();
    expect(r.burnedCount).toBe(0);
  });

  it("is what the player's stats are computed from", () => {
    const { game } = gameOn(ROOM);
    expect(rig(game).slots.filter(Boolean)).toHaveLength(5);
    const stats = derivedStats(rig(game));
    // The starting rack carries no BAFFLE, so both stealth numbers are zero.
    expect(stats).toEqual({
      speed: 100,
      fovRadius: 8,
      damage: [1, 6, 1],
      noisePenalty: 0,
      machineFovPenalty: 0,
    });
    expect(game.player.speed).toBe(stats.speed);
    expect(game.player.fovRadius).toBe(stats.fovRadius);
    expect(game.player.damage).toEqual(stats.damage);
  });

  it("falls back to the bare chassis with nothing installed", () => {
    const r = makeStartingRig();
    r.slots = r.slots.map(() => null);
    expect(derivedStats(r)).toEqual({
      speed: BARE_CHASSIS.speed,
      fovRadius: BARE_CHASSIS.fovRadius,
      damage: [...BARE_CHASSIS.damage],
      noisePenalty: 0,
      machineFovPenalty: 0,
    });
  });

  it("prefers a laser over a cutter", () => {
    const r = makeStartingRig();
    install(r, "laser", 3);
    expect(derivedStats(r).damage).toEqual([2, 4, 0]);
  });
});

describe("exposure follows the last command that resolved", () => {
  it("a swing exposes the cutter", () => {
    const { game } = gameOn(["#####", "#@m.#", "#####"]);
    game.playerCommand({ kind: "attack", dx: 1, dy: 0 });
    expect(rig(game).exposed).toBe(slotOf(rig(game), "cutter"));
  });

  it("a bump-to-attack is a swing, not a step", () => {
    const { game } = gameOn(["#####", "#@m.#", "#####"]);
    game.playerCommand({ kind: "move", dx: 1, dy: 0 });
    expect(rig(game).exposed).toBe(slotOf(rig(game), "cutter"));
  });

  it("a step exposes the thrusters and waiting exposes the plating", () => {
    const { game } = gameOn(ROOM);
    game.playerCommand({ kind: "move", dx: 1, dy: 0 });
    expect(rig(game).exposed).toBe(slotOf(rig(game), "thrusters"));
    game.playerCommand({ kind: "wait" });
    expect(rig(game).exposed).toBe(slotOf(rig(game), "plating"));
  });

  it("a refused move leaves the marker where it was", () => {
    const { game } = gameOn(["###", "#@#", "###"]);
    game.playerCommand({ kind: "wait" });
    const before = rig(game).exposed;
    const out = game.playerCommand({ kind: "move", dx: 1, dy: 0 });
    expect(out.ok).toBe(false);
    expect(rig(game).exposed).toBe(before);
  });

  it("exposes nothing when the module for that command is gone", () => {
    const r = makeStartingRig();
    r.slots[slotOf(r, "thrusters")] = null;
    expect(expose(r, { kind: "move", dx: 1, dy: 0 })).toBeNull();
  });

  it("a ram without a cutter risks the thrusters instead", () => {
    const r = makeStartingRig();
    r.slots[slotOf(r, "cutter")] = null;
    expect(expose(r, { kind: "attack", dx: 1, dy: 0 })).toBe(slotOf(r, "thrusters"));
  });

  it("using a slot exposes that slot, and an empty one exposes nothing", () => {
    const r = makeStartingRig();
    expect(expose(r, { kind: "use", slot: 2 })).toBe(2);
    expect(expose(r, { kind: "use", slot: 5 })).toBeNull();
  });

  it("descending clears the marker: the deck changes under it", () => {
    const r = makeStartingRig();
    expose(r, { kind: "wait" });
    expect(expose(r, { kind: "descend" })).toBeNull();
  });
});

describe("damage routing", () => {
  it("lands on the exposed module and never on the core while it holds", () => {
    const { game, monsters } = gameOn(["#####", "#@m.#", "#####"]);
    game.playerCommand({ kind: "attack", dx: 1, dy: 0 });
    const cutter = slotOf(rig(game), "cutter");

    const toCore = RIG.onDamage!(game, game.player, 2, monsters[0]!);
    expect(toCore).toBe(0);
    expect(rig(game).slots[cutter]!.integrity).toBe(moduleKind("cutter").integrity - 2);
    expect(game.player.hp).toBe(3);
  });

  it("spills past a burned module into the plating", () => {
    const r = makeStartingRig();
    const cutter = slotOf(r, "cutter");
    const plating = slotOf(r, "plating");
    r.slots[cutter]!.integrity = 1;
    r.exposed = cutter;

    const left = moduleKind("plating").integrity - 2;
    const route = routeDamage(r, 3);
    expect(route.toCore).toBe(0);
    expect(r.slots[cutter]).toBeNull();
    expect(r.slots[plating]!.integrity).toBe(left);
    expect(route.hits).toEqual([
      { slot: cutter, kind: "cutter", amount: 1, remaining: 0, burned: true },
      { slot: plating, kind: "plating", amount: 2, remaining: left, burned: false },
    ]);
  });

  it("reaches the core once nothing is exposed and the plating is gone", () => {
    const r = makeStartingRig();
    r.slots[slotOf(r, "plating")] = null;
    r.exposed = null;
    expect(routeDamage(r, 2).toCore).toBe(2);
  });

  it("kills when the core runs out", () => {
    const { game, monsters } = gameOn(["#####", "#@m.#", "#####"]);
    setRig(game, (r) => {
      r.slots = r.slots.map(() => null);
      r.exposed = null;
    });

    RIG.onDamage!(game, game.player, 3, monsters[0]!);
    expect(game.player.hp).toBe(3); // the hook only reports; applyDamage subtracts
    game.player.hp = 0;
    game.player.alive = false;
    game.playerCommand({ kind: "wait" });
    expect(game.status).toBe("dead");
  });

  it("a precise attacker picks the weakest module, ties going to the lower slot", () => {
    const r = makeStartingRig();
    const scanner = slotOf(r, "scanner"); // the weakest module at the start
    r.exposed = slotOf(r, "plating");
    const route = routeDamage(r, 1, ["precise"]);
    expect(route.hits.map((h) => h.slot)).toEqual([scanner]);
    expect(r.slots[scanner]!.integrity).toBe(moduleKind("scanner").integrity - 1);
  });

  it("a burst puts one point in every module and nothing in the core", () => {
    const r = makeStartingRig();
    const before = r.slots.map((s) => s?.integrity ?? null);
    const route = routeDamage(r, 5, ["burst"]);
    expect(route.toCore).toBe(0);
    expect(route.hits).toHaveLength(5);
    expect(r.slots.map((s) => s?.integrity ?? null)).toEqual(before.map((v) => (v === null ? null : v - 1)));
  });

  it("leaves monsters alone: their hit points fall exactly as before", () => {
    const { game, monsters } = gameOn(["#####", "#@m.#", "#####"]);
    const bot = monsters[0]!;
    expect(RIG.onDamage!(game, bot, 3, game.player)).toBe(3);

    const hp = bot.hp;
    game.playerCommand({ kind: "attack", dx: 1, dy: 0 });
    expect(bot.hp).toBeLessThan(hp);
    expect(bot.hp).toBeGreaterThanOrEqual(0);
  });
});

describe("burning a module changes what the drone can do", () => {
  it("a burned module empties its slot and is counted", () => {
    const r = makeStartingRig();
    const scanner = slotOf(r, "scanner");
    r.exposed = scanner;
    routeDamage(r, moduleKind("scanner").integrity);
    expect(r.slots[scanner]).toBeNull();
    expect(r.burned).toEqual(["scanner"]);
    expect(r.burnedCount).toBe(1);
    expect(r.scars[scanner]).toBe("scanner");
    expect(r.exposed).toBeNull();
  });

  it("losing the scanner shrinks the sight radius and the visible map with it", () => {
    const { game } = gameOn([
      "###################",
      "#.................#",
      "#.................#",
      "#.................#",
      "#.................#",
      "#.................#",
      "#.................#",
      "#........@........#",
      "#.................#",
      "#.................#",
      "#.................#",
      "#.................#",
      "#.................#",
      "#.................#",
      "###################",
    ]);
    const seen = () => {
      let n = 0;
      game.level.visible.forEach((_x, _y, v) => { if (v) n++; });
      return n;
    };
    const before = seen();

    setRig(game, (r) => { r.exposed = slotOf(r, "scanner"); });
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, undefined);
    game.refreshFov();

    expect(game.player.fovRadius).toBe(BARE_CHASSIS.fovRadius);
    expect(seen()).toBeLessThan(before);
  });

  it("losing the thrusters slows the drone: the deck gets more turns than it does", () => {
    const { game } = gameOn(ROOM);
    // One command to settle the energy pool, then measure four turns of it.
    game.playerCommand({ kind: "wait" });
    const beats = (n: number) => {
      const before = game.schedule.time;
      for (let i = 0; i < n; i++) game.playerCommand({ kind: "wait" });
      return game.schedule.time - before;
    };
    expect(beats(4)).toBe(4);

    setRig(game, (r) => { r.exposed = slotOf(r, "thrusters"); });
    RIG.onDamage!(game, game.player, moduleKind("thrusters").integrity, undefined);
    expect(game.player.speed).toBe(BARE_CHASSIS.speed);

    // Every machine on the deck now gets more beats than the drone does. How
    // many more is a balance number (content/modules.ts); that there are more
    // is the rule.
    expect(BARE_CHASSIS.speed).toBeLessThan(moduleKind("thrusters").speed!);
    expect(beats(4)).toBeGreaterThan(4);
  });

  it("losing the cutter drops the drone to ramming", () => {
    const { game } = gameOn(ROOM);
    setRig(game, (r) => { r.exposed = slotOf(r, "cutter"); });
    RIG.onDamage!(game, game.player, moduleKind("cutter").integrity, undefined);
    expect(game.player.damage).toEqual([...BARE_CHASSIS.damage]);
  });

  it("says so in the log, once per module", () => {
    const { game, monsters } = gameOn(["#####", "#@m.#", "#####"]);
    setRig(game, (r) => { r.exposed = slotOf(r, "scanner"); });
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, monsters[0]!);

    const lines = game.log.tail(20).map((m) => m.text);
    expect(lines).toContain(`The maintenance bot hits your SCANNER (0/${moduleKind("scanner").integrity}).`);
    expect(lines).toContain(moduleKind("scanner").burnLine);
  });
});

describe("the rack as a spare-parts rack", () => {
  it("installs into the first empty slot and refuses when full", () => {
    const r = makeStartingRig();
    expect(install(r, "welder", 2)).toBe(5);
    expect(r.slots[5]).toEqual({ kind: "welder", integrity: 2 });
    expect(install(r, "emp", 2)).toBeUndefined();
  });

  it("gives a module its charges and never more integrity than the table allows", () => {
    const r = makeStartingRig();
    const i = install(r, "emp", 99)!;
    expect(r.slots[i]).toEqual({
      kind: "emp",
      integrity: moduleKind("emp").integrity,
      charges: moduleKind("emp").charges,
    });
  });

  it("repairs the most damaged other module, capped at full", () => {
    const r = makeStartingRig();
    const cutter = slotOf(r, "cutter");
    r.slots[cutter]!.integrity = 2;
    expect(repair(r, slotOf(r, "scanner"))).toEqual({
      slot: cutter,
      kind: "cutter",
      integrity: 3,
      max: moduleKind("cutter").integrity,
    });
  });

  it("repairs nothing when everything is whole", () => {
    expect(repair(makeStartingRig())).toBeUndefined();
  });
});

const FUZZ: Command[] = [
  { kind: "move", dx: 1, dy: 0 },
  { kind: "move", dx: -1, dy: 0 },
  { kind: "move", dx: 0, dy: 1 },
  { kind: "move", dx: 0, dy: -1 },
  { kind: "move", dx: 1, dy: 1 },
  { kind: "move", dx: -1, dy: -1 },
  { kind: "attack", dx: 1, dy: 0 },
  { kind: "wait" },
  { kind: "descend" },
  { kind: "interact" },
  { kind: "use", slot: 0 },
  { kind: "use", slot: 5 },
];

describe("replay", () => {
  it("reproduces the rack bit for bit after 200 random commands", () => {
    const seed = 90210;
    const first = newGame(seed);
    const rng = new Rng(4242);
    for (let i = 0; i < 200 && first.status === "playing"; i++) first.playerCommand(rng.pick(FUZZ));

    const again = replay(seed, first.inputs, GAME_CONFIG);
    expect(rigOf(again.player)).toEqual(rigOf(first.player));
    expect(again.player.hp).toBe(first.player.hp);
    expect(again.player.speed).toBe(first.player.speed);
    expect(again.status).toBe(first.status);
    expect(again.schedule.time).toBe(first.schedule.time);
  });

  it("an unclaimed use or interact costs no turn", () => {
    const { game } = gameOn(ROOM);
    game.playerCommand({ kind: "wait" });
    const marker = rig(game).exposed;
    const energy = game.player.energy;

    expect(game.playerCommand({ kind: "use", slot: 0 }).ok).toBe(false);
    expect(game.playerCommand({ kind: "interact" }).ok).toBe(false);
    // Refused commands are not recorded, cost no energy and move no marker.
    expect(game.inputs).toHaveLength(1);
    expect(game.player.energy).toBe(energy);
    expect(rig(game).exposed).toBe(marker);
  });
});

describe("the panel", () => {
  it("shows the core, every slot, and which one is under fire", () => {
    const { game } = gameOn(ROOM);
    game.playerCommand({ kind: "wait" });
    const lines = RIG.panelLines!(game).map((l) => l.text);

    expect(lines[0]).toBe("CORE  ●●●");
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe(`1 CUTTER    ${"▮".repeat(moduleKind("cutter").integrity)}`);
    expect(lines[4]).toContain("◀"); // plating, exposed by waiting
    expect(lines[6]).toBe("6 -- empty --");
  });

  it("marks a burned slot apart from an empty one", () => {
    const { game } = gameOn(ROOM);
    setRig(game, (r) => { r.exposed = slotOf(r, "scanner"); });
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, undefined);
    const lines = RIG.panelLines!(game);
    expect(lines[3]!.text).toBe("3 -- burned --");
    expect(lines[3]!.fg).not.toBe(lines[6]!.fg);
  });
});
