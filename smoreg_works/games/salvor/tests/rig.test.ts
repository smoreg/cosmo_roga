import { describe, it, expect } from "vitest";
import {
  Rng,
  RoomGame,
  replayRooms,
  spawnMonsterIn,
  type Entity,
  type RoomCommand,
  type RoomGameConfig,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, KESTREL, SALVOR } from "../src/game.js";
import { SCRAPPER } from "../src/content/hulls.js";
import { MONSTERS } from "../src/content/monsters.js";
import { BARE_CHASSIS, MAX_GRAFT, moduleBurnLine, moduleKind, type ModuleId } from "../src/content/modules.js";
import {
  RIG,
  capOf,
  derivedStats,
  expose,
  exposureFor,
  findSlot,
  graft,
  hostilesIn,
  install,
  makeStartingRig,
  registerHackTarget,
  repair,
  rigOf,
  routeDamage,
  wrecksIn,
  type HackTarget,
  type Rig,
} from "../src/twist/rig.js";

/**
 * A sortie on a hand-drawn ship. The graph is written out so the tests read as
 * pictures instead of as lucky seeds, but the game itself is the real one: same
 * twist, same turn cycle, same content pack the UI plays. Only the machines are
 * placed by hand, so a test about the rack is never about a spawn roll — and
 * the systems are dropped for the same reason, since POPULATE lays an
 * onboarding pile in the first ship of a run whatever the fixture holds.
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

function slotOf(r: Rig, kind: ModuleId): number {
  const i = findSlot(r, kind);
  if (i === null) throw new Error(`no ${kind} in the rack`);
  return i;
}

/** Two compartments and an open door: the smallest ship a fight fits in. */
const PAIR = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking cover
  r2: cargo
`;

/** The same, with the door shut and a locked one beside it. */
const SHUT = `
  TUG -a1- r1
  r1 -(d1)- r2
  r1 -[d2:k1]- r3
  r1: docking
  r2: cargo
  r3: storage
`;

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

  it("is what the drone's stats are computed from", () => {
    const game = gameOn(PAIR);
    expect(rig(game).slots.filter(Boolean)).toHaveLength(5);
    const stats = derivedStats(rig(game));
    // The starting rack carries no BAFFLE, so both stealth numbers are zero.
    expect(stats).toEqual({
      speed: 100,
      sight: 1,
      damage: [1, 6, 1],
      noisePenalty: 0,
      machineFovPenalty: 0,
    });
    expect(game.player.speed).toBe(stats.speed);
    expect(game.player.sight).toBe(stats.sight);
    expect(game.player.damage).toEqual(stats.damage);
  });

  it("falls back to the bare chassis with nothing installed", () => {
    const r = makeStartingRig();
    r.slots = r.slots.map(() => null);
    expect(derivedStats(r)).toEqual({
      speed: BARE_CHASSIS.speed,
      sight: BARE_CHASSIS.sight,
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

// --------------------------------------------------------- the exposure table

/**
 * A ship system the drone works with a CELL — the reactor, in the language of
 * G17. The rig must not know that word, so the tool comes back with the target.
 */
let job: HackTarget | undefined;
const JOB_ID = 4242;

registerHackTarget((_game, target) => (target === JOB_ID ? job : undefined));

/** Every row of design-doc.md, "Действия отсека", in the order it is written. */
const TABLE: Array<{ row: string; cmd: RoomCommand; module: ModuleId | null }> = [
  { row: "attack a machine", cmd: { kind: "attack", target: 1 }, module: "cutter" },
  { row: "shoot", cmd: { kind: "act", verb: "shoot" }, module: "emitter" },
  { row: "go through a door", cmd: { kind: "go", door: 0 }, module: "thrusters" },
  { row: "close a door", cmd: { kind: "act", verb: "close", target: 0 }, module: "thrusters" },
  { row: "weld a door shut", cmd: { kind: "act", verb: "weld", target: 0 }, module: "welder" },
  { row: "open with a keycard", cmd: { kind: "act", verb: "key", target: 0 }, module: "plating" },
  { row: "power a door with the cell", cmd: { kind: "act", verb: "power", target: 0 }, module: "cell" },
  { row: "spike a door", cmd: { kind: "act", verb: "spike", target: 0 }, module: "spike" },
  { row: "cut a door", cmd: { kind: "act", verb: "cut", target: 0 }, module: "cutter" },
  { row: "salvage a wreck", cmd: { kind: "act", verb: "salvage", target: 1 }, module: "plating" },
  { row: "search a body", cmd: { kind: "act", verb: "search", target: 1 }, module: "plating" },
  { row: "work a ship system", cmd: { kind: "act", verb: "work", target: JOB_ID }, module: "cell" },
  { row: "upload at a console", cmd: { kind: "act", verb: "upload" }, module: "plating" },
  { row: "take a charter's package", cmd: { kind: "act", verb: "take", target: 1 }, module: "plating" },
  { row: "wait", cmd: { kind: "wait" }, module: "plating" },
  { row: "hide", cmd: { kind: "hide" }, module: "plating" },
  { row: "leave for the tug", cmd: { kind: "leave" }, module: null },
];

describe("what a command puts under the next blow", () => {
  it.each(TABLE)("$row exposes the module the table names", ({ cmd, module }) => {
    const game = gameOn(PAIR);
    const r = rig(game);
    // The rack has six slots and the table names eight modules, so the row's
    // own module goes into the empty one: what is being tested is the table,
    // not what happens when the module is missing.
    if (module !== null && findSlot(r, module) === null) {
      r.slots[5] = { kind: module, integrity: moduleKind(module).integrity };
    }
    job = { name: "reactor", turnsLeft: 2, expose: "cell", breach() {} };

    const want = module === null ? null : slotOf(r, module);
    expect(exposureFor(game, r, cmd)).toBe(want);
  });

  it("treats a job with no tool of its own, and a job already done, as hands-on work", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    const plating = slotOf(r, "plating");

    job = { name: "console", turnsLeft: 5, breach() {} };
    expect(exposureFor(game, r, { kind: "act", verb: "work", target: JOB_ID })).toBe(plating);
    // The owner retired the target the turn it finished; the marker still lands.
    job = undefined;
    expect(exposureFor(game, r, { kind: "act", verb: "work", target: JOB_ID })).toBe(plating);
  });

  it("exposes nothing when the tool a job wants has burned", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    job = { name: "reactor", turnsLeft: 2, expose: "cell", breach() {} };
    r.slots[slotOf(r, "cell")] = null;
    expect(exposureFor(game, r, { kind: "act", verb: "work", target: JOB_ID })).toBeNull();
  });

  it("exposes nothing when the module for that command is gone", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    r.slots[slotOf(r, "thrusters")] = null;
    r.slots[slotOf(r, "plating")] = null;
    expect(expose(game, r, { kind: "go", door: 0 })).toBeNull();
  });

  it("a ram without a cutter risks the thrusters instead", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    r.slots[slotOf(r, "cutter")] = null;
    expect(exposureFor(game, r, { kind: "attack", target: 1 })).toBe(slotOf(r, "thrusters"));
  });

  it("using a slot exposes that slot, and an empty one exposes nothing", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    expect(exposureFor(game, r, { kind: "act", verb: "use", slot: 2 })).toBe(2);
    expect(exposureFor(game, r, { kind: "act", verb: "use", slot: 5 })).toBeNull();
    expect(exposureFor(game, r, { kind: "act", verb: "use" })).toBeNull();
  });
});

describe("the marker moves only when a turn is spent", () => {
  it("a swing exposes the cutter and a step exposes the thrusters", () => {
    const game = gameOn(PAIR);
    const bot = put(game, "r1", "maintenance-bot");

    expect(game.playerCommand({ kind: "attack", target: bot.id }).ok).toBe(true);
    expect(rig(game).exposed).toBe(slotOf(rig(game), "cutter"));

    expect(game.playerCommand({ kind: "go", door: game.ship.door("d1").id }).ok).toBe(true);
    expect(rig(game).exposed).toBe(slotOf(rig(game), "thrusters"));
  });

  it("waiting and hiding both expose the plating", () => {
    const game = gameOn(PAIR);
    game.playerCommand({ kind: "wait" });
    expect(rig(game).exposed).toBe(slotOf(rig(game), "plating"));

    const marker = rig(game).exposed;
    rig(game).exposed = null;
    expect(game.playerCommand({ kind: "hide" }).ok).toBe(true);
    expect(rig(game).exposed).toBe(marker);
  });

  it("a refused command leaves the marker where it was", () => {
    const game = gameOn(SHUT);
    game.playerCommand({ kind: "wait" });
    const before = rig(game).exposed;
    const turns = game.inputs.length;

    expect(game.playerCommand({ kind: "go", door: game.ship.door("d2").id }).ok).toBe(false);
    expect(game.playerCommand({ kind: "attack", target: 9999 }).ok).toBe(false);
    expect(game.playerCommand({ kind: "hide" }).ok).toBe(false);
    expect(rig(game).exposed).toBe(before);
    expect(game.inputs).toHaveLength(turns);
  });

  it("leaving clears it: the ship is behind you", () => {
    const game = gameOn(PAIR);
    game.playerCommand({ kind: "wait" });
    expect(rig(game).exposed).not.toBeNull();

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(rig(game).exposed).toBeNull();
    expect(game.status).toBe("won");
  });
});

// -------------------------------------------------------------------- damage

describe("damage routing", () => {
  it("lands on the exposed module and never on the core while it holds", () => {
    const game = gameOn(PAIR);
    const bot = put(game, "r1", "maintenance-bot");
    game.playerCommand({ kind: "attack", target: bot.id });
    const cutter = slotOf(rig(game), "cutter");
    const left = rig(game).slots[cutter]!.integrity;

    const toCore = RIG.onDamage!(game, game.player, 2, bot);
    expect(toCore).toBe(0);
    expect(rig(game).slots[cutter]!.integrity).toBe(left - 2);
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
    const game = gameOn(PAIR);
    const r = rig(game);
    r.slots = r.slots.map(() => null);
    r.exposed = null;

    RIG.onDamage!(game, game.player, 3, undefined);
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

  it("corrosive eats the exposed module while the plating is whole", () => {
    const r = makeStartingRig();
    const cutter = slotOf(r, "cutter");
    const plating = slotOf(r, "plating");
    r.exposed = cutter;

    const route = routeDamage(r, 2, ["corrosive"]);
    expect(route.hits.map((h) => h.slot)).toEqual([cutter]);
    expect(r.slots[plating]!.integrity).toBe(moduleKind("plating").integrity);
    expect(route.toCore).toBe(0);
  });

  it("corrosive goes straight to the core with nothing exposed: armour is not in the chain", () => {
    const r = makeStartingRig();
    r.exposed = null;
    const route = routeDamage(r, 3, ["corrosive"]);
    expect(route.hits).toEqual([]);
    expect(route.toCore).toBe(3);
    expect(r.slots[slotOf(r, "plating")]!.integrity).toBe(moduleKind("plating").integrity);
  });

  it("corrosive skips the plating even when the plating is what was exposed", () => {
    const r = makeStartingRig();
    r.exposed = slotOf(r, "plating");
    expect(routeDamage(r, 2, ["corrosive"]).toCore).toBe(2);
  });

  it("leaves machines alone: their hit points fall exactly as before", () => {
    const game = gameOn(PAIR);
    const bot = put(game, "r1", "maintenance-bot");
    expect(RIG.onDamage!(game, bot, 3, game.player)).toBe(3);

    const hp = bot.hp;
    game.playerCommand({ kind: "attack", target: bot.id });
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

  it("losing the scanner ends the ship at this bulkhead", () => {
    const game = gameOn(PAIR);
    expect(game.visible.size).toBe(2);

    rig(game).exposed = slotOf(rig(game), "scanner");
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, undefined);
    game.refreshSight();

    expect(game.player.sight).toBe(0);
    expect([...game.visible]).toEqual([game.ship.room("r1").id]);
  });

  it("losing the thrusters slows the drone: the ship gets more turns than it does", () => {
    const game = gameOn(PAIR);
    // One command to settle the energy pool, then measure four turns of it.
    game.playerCommand({ kind: "wait" });
    const beats = (n: number): number => {
      const before = game.schedule.time;
      for (let i = 0; i < n; i++) game.playerCommand({ kind: "wait" });
      return game.schedule.time - before;
    };
    expect(beats(4)).toBe(4);

    rig(game).exposed = slotOf(rig(game), "thrusters");
    RIG.onDamage!(game, game.player, moduleKind("thrusters").integrity, undefined);
    expect(game.player.speed).toBe(BARE_CHASSIS.speed);

    expect(BARE_CHASSIS.speed).toBeLessThan(moduleKind("thrusters").speed!);
    expect(beats(4)).toBeGreaterThan(4);
  });

  it("losing the cutter drops the drone to ramming", () => {
    const game = gameOn(PAIR);
    rig(game).exposed = slotOf(rig(game), "cutter");
    RIG.onDamage!(game, game.player, moduleKind("cutter").integrity, undefined);
    expect(game.player.damage).toEqual([...BARE_CHASSIS.damage]);
  });

  it("says so in the log, once per module", () => {
    const game = gameOn(PAIR);
    const bot = put(game, "r1", "maintenance-bot");
    rig(game).exposed = slotOf(rig(game), "scanner");
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, bot);

    const lines = game.log.tail(20).map((m) => m.text);
    expect(lines).toContain(`The maintenance bot hits your SCANNER (0/${moduleKind("scanner").integrity}).`);
    expect(lines).toContain(moduleBurnLine("scanner"));
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

  it("repairs a grafted module up to its raised ceiling", () => {
    const r = makeStartingRig();
    const cutter = slotOf(r, "cutter");
    graft(r, cutter);
    graft(r, cutter);
    const base = moduleKind("cutter").integrity;
    expect(capOf(r.slots[cutter]!)).toBe(base + 2);

    r.slots[cutter]!.integrity = base;
    expect(repair(r)!.max).toBe(base + 2);
    expect(r.slots[cutter]!.integrity).toBe(base + 1);
  });
});

// --------------------------------------------------------------------- panel

describe("the panel", () => {
  it("shows the core, every slot, and which one is under fire", () => {
    const game = gameOn(PAIR);
    game.playerCommand({ kind: "wait" });
    const lines = RIG.panelLines!(game).map((l) => l.text);

    expect(lines[0]).toBe("CORE  ●●●");
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe(`1 CUTTER    ${"▮".repeat(moduleKind("cutter").integrity)}`);
    expect(lines[4]).toContain("◀"); // plating, exposed by waiting
    expect(lines[6]).toBe("6 -- empty --");
  });

  it("marks a burned slot apart from an empty one", () => {
    const game = gameOn(PAIR);
    rig(game).exposed = slotOf(rig(game), "scanner");
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, undefined);
    const lines = RIG.panelLines!(game);
    expect(lines[3]!.text).toBe("3 -- burned --");
    expect(lines[3]!.fg).not.toBe(lines[6]!.fg);
  });

  it("marks a grafted module with a plus and a longer bar", () => {
    const game = gameOn(PAIR);
    const cutter = slotOf(rig(game), "cutter");
    graft(rig(game), cutter);
    const line = RIG.panelLines!(game)[cutter + 1]!.text;
    expect(line).toBe(`1 CUTTER    ${"▮".repeat(moduleKind("cutter").integrity + 1)}+`);
    expect(line.length).toBeLessThanOrEqual(28);
  });

  it("marks a module grafted to the ceiling with one plus per point", () => {
    const game = gameOn(PAIR);
    const cutter = slotOf(rig(game), "cutter");
    graft(rig(game), cutter);
    graft(rig(game), cutter);
    const line = RIG.panelLines!(game)[cutter + 1]!.text;
    expect(line).toBe(`1 CUTTER    ${"▮".repeat(moduleKind("cutter").integrity + MAX_GRAFT)}++`);
    expect(line.length).toBeLessThanOrEqual(28);
  });

  it("shortens the bar rather than drop a plus or the exposed arrow", () => {
    // The SCRAPPER's own PLATING already beats the catalogue (`content/hulls.ts`);
    // fully grafted and exposed, its bar alone would run the panel past its
    // 28 columns. The pluses and the arrow are the two marks worth more than a
    // pip of a bar this long, so they are what survives.
    const game = gameOn(PAIR);
    const plating = slotOf(rig(game), "plating");
    const base = SCRAPPER.base!.plating!;
    rig(game).slots[plating] = { kind: "plating", integrity: base, base };
    graft(rig(game), plating);
    graft(rig(game), plating);
    rig(game).exposed = plating;

    const line = RIG.panelLines!(game)[plating + 1]!.text;
    expect(line.length).toBeLessThanOrEqual(28);
    expect(line).toContain("++");
    expect(line.endsWith("  ◀")).toBe(true);
    expect(line.startsWith("4 PLATING   ")).toBe(true);
  });
});

// -------------------------------------------------------------------- replay

/** The fuzzer's idea of a player: every verb of the rig, and the ones that refuse. */
function randomCommand(game: RoomGame, rng: Rng): RoomCommand {
  const here = game.roomOf(game.player).id;
  const roll = rng.int(0, 9);
  if (roll === 0) return { kind: "wait" };
  if (roll === 1) return { kind: "hide" };
  if (roll === 2) return { kind: "act", verb: "use", slot: rng.int(0, 5) };
  if (roll === 3) {
    const wrecks = wrecksIn(game, here);
    return wrecks.length === 0
      ? { kind: "act", verb: "salvage" }
      : { kind: "act", verb: "salvage", target: rng.pick(wrecks).id };
  }
  if (roll === 4) return { kind: "act", verb: "shoot" };
  if (roll <= 6) {
    const foes = hostilesIn(game, here);
    if (foes.length > 0) return { kind: "attack", target: rng.pick(foes).id };
  }
  const doors = game.ship.doorsOf(here).filter((d) => d.state !== "airlock");
  return doors.length === 0 ? { kind: "wait" } : { kind: "go", door: rng.pick(doors).id };
}

/**
 * The whole game, on the hand-drawn freighter: every system a run has, and a
 * graph two hundred random commands can be spent on. A generated ship puts a
 * machine in the docking bay by card, and a drone pressing keys at random dies
 * to it in five turns — which proves nothing about a replay.
 *
 * The core is oversized for the same reason, and only here: a core no fight can
 * breach inside two hundred commands. A stock drone pressing keys at random
 * dies around the twentieth — the alert has dispatched by then and machines are
 * walking — so the run under test would be twenty commands long and "the replay
 * agreed" would mean the two agreed about a death. Surviving is what buys the
 * two hundred commands the assertions are about, and buying it outright rather
 * than by a lucky seed is what stops this test being re-tuned by hand every
 * time a system joins `GAME_CONFIG`, which has already happened twice.
 *
 * Nothing else is softened. The rack still takes every blow, modules still burn
 * out, and `hp` still moves — so the rig, the hit points and the clock all
 * remain real things for the replay to disagree about.
 */
const UNBREACHABLE_CORE = 10000;

const KESTREL_RUN: Omit<RoomGameConfig, "seed"> = {
  ...GAME_CONFIG,
  firstShip: () => shipFromText(KESTREL).ship,
  firstShipId: "1",
  content: {
    ...SALVOR,
    makePlayer: () => {
      const drone = SALVOR.makePlayer();
      drone.hp = UNBREACHABLE_CORE;
      drone.hpMax = UNBREACHABLE_CORE;
      return drone;
    },
  },
};

describe("replay", () => {
  it("reproduces the rack bit for bit after 200 random commands", () => {
    const seed = 90210;
    const first = new RoomGame({ ...KESTREL_RUN, seed });
    const rng = new Rng(4242);
    for (let i = 0; i < 200 && first.status === "playing"; i++) {
      first.playerCommand(randomCommand(first, rng));
    }
    expect(first.inputs.length).toBeGreaterThan(50);

    const again = replayRooms(seed, [...first.inputs], KESTREL_RUN);
    expect(rigOf(again.player)).toEqual(rigOf(first.player));
    expect(again.player.hp).toBe(first.player.hp);
    expect(again.player.speed).toBe(first.player.speed);
    expect(again.status).toBe(first.status);
    expect(again.schedule.time).toBe(first.schedule.time);
  });

  it("an unclaimed verb costs no turn", () => {
    const game = gameOn(PAIR);
    game.playerCommand({ kind: "wait" });
    const marker = rig(game).exposed;
    const energy = game.player.energy;
    const turns = game.inputs.length;

    expect(game.playerCommand({ kind: "act", verb: "meditate" }).ok).toBe(false);
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
    expect(rig(game).exposed).toBe(marker);
  });
});
