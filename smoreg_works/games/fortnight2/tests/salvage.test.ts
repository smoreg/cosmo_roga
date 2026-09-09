import { describe, it, expect } from "vitest";
import { Rng, replay, spawnMonster, type Command, type Entity, type Game } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { MONSTERS, machineByName } from "../src/content/monsters.js";
import { MODULES, SCRAP_INTEGRITY, moduleKind } from "../src/content/modules.js";
import {
  RIG,
  addWreck,
  deckOf,
  findSlot,
  rigOf,
  wreckAt,
  type Rig,
} from "../src/twist/rig.js";

/**
 * Salvage on a hand-drawn deck. Same `newGame` the UI calls, so the turn cycle,
 * the alert system and the twist are all the real ones; only the map is drawn.
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

/** The starting rack has exactly one empty slot; fill it to make the rack full. */
function fillRack(game: Game): void {
  const r = rig(game);
  for (let i = 0; i < r.slots.length; i++) {
    if (!r.slots[i]) r.slots[i] = { kind: "welder", integrity: 3 };
  }
}

const ROOM = [
  "#########",
  "#.......#",
  "#.......#",
  "#...@...#",
  "#.......#",
  "#########",
];

const DUEL = ["#####", "#@m.#", "#####"];

/** Swing until the machine next door is scrap. */
function killNeighbour(game: Game, monster: Entity): void {
  for (let i = 0; i < 40 && monster.alive; i++) {
    game.playerCommand({ kind: "attack", dx: monster.pos.x - game.player.pos.x, dy: 0 });
  }
  expect(monster.alive).toBe(false);
}

describe("a dead machine leaves its module on the floor", () => {
  it("drops the wreck named by the bestiary, at the scrap integrity", () => {
    const { game, monsters } = gameOn(DUEL);
    const bot = monsters[0]!;
    const where = { ...bot.pos };
    killNeighbour(game, bot);

    const wreck = wreckAt(game, where)!;
    expect(wreck.kind).toBe(machineByName("maintenance bot")!.salvage);
    expect(wreck.integrity).toBeGreaterThanOrEqual(SCRAP_INTEGRITY[0]);
    expect(wreck.integrity).toBeLessThanOrEqual(SCRAP_INTEGRITY[1]);
    expect(wreck.glyph).toBe("%");
    expect(game.log.tail(20).map((m) => m.text)).toContain("The maintenance bot collapses into scrap.");
  });

  it("shows the pile on the map, and keeps showing it once out of sight", () => {
    const { game } = gameOn(ROOM);
    addWreck(game, { x: 5, y: 3 }, "scanner", 2);
    expect(RIG.overlayGlyphs!(game)).toEqual([
      { x: 5, y: 3, ch: "%", fg: expect.any(String), remembered: true },
    ]);
  });

  it("keeps one wreck per tile: a second machine dying there replaces the first", () => {
    const { game } = gameOn(ROOM);
    const at = { x: 5, y: 3 };
    addWreck(game, at, "scanner", 2);
    addWreck(game, at, "emp", 1, "X");

    expect(deckOf(game).wrecks).toHaveLength(1);
    expect(wreckAt(game, at)).toEqual({ x: 5, y: 3, kind: "emp", integrity: 1, glyph: "X" });
  });
});

describe("pulling a module out of a wreck", () => {
  it("takes the pile under the drone into the empty slot", () => {
    const { game } = gameOn(ROOM);
    addWreck(game, game.player.pos, "welder", 2);
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "interact" });
    expect(out.ok).toBe(true);
    expect(out.cost).toBe(100);
    expect(game.inputs).toHaveLength(turns + 1);
    expect(rig(game).slots[5]).toEqual({ kind: "welder", integrity: 2 });
    expect(deckOf(game).wrecks).toHaveLength(0);
    expect(game.log.tail(20).map((m) => m.text)).toContain(
      `You pull a WELDER (2/${MODULES.welder.integrity}) from the wreck.`,
    );
  });

  it("exposes the plating: your hands are busy, not your weapon", () => {
    const { game } = gameOn(ROOM);
    addWreck(game, game.player.pos, "welder", 2);
    game.playerCommand({ kind: "interact" });
    expect(rig(game).exposed).toBe(findSlot(rig(game), "plating"));
  });

  it("reaches one tile: the neighbouring pile, in reading order", () => {
    const { game } = gameOn(ROOM);
    const p = game.player.pos;
    addWreck(game, { x: p.x + 1, y: p.y }, "emp", 1); // east
    addWreck(game, { x: p.x, y: p.y - 1 }, "laser", 2); // north, earlier in reading order

    expect(game.playerCommand({ kind: "interact" }).ok).toBe(true);
    expect(rig(game).slots[5]!.kind).toBe("laser");
    expect(deckOf(game).wrecks).toHaveLength(1);
  });

  it("restores what the module gives: a salvaged scanner brings the sight back", () => {
    const { game } = gameOn(ROOM);
    const r = rig(game);
    r.slots[findSlot(r, "scanner")!] = null;
    RIG.afterPlayerTurn!(game, { kind: "wait" });
    game.player.fovRadius = 3;

    addWreck(game, game.player.pos, "scanner", 2);
    game.playerCommand({ kind: "interact" });
    expect(game.player.fovRadius).toBe(moduleKind("scanner").fov);
  });

  it("costs no turn when there is nothing to pull apart", () => {
    const { game } = gameOn(ROOM);
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    const energy = game.player.energy;

    const out = game.playerCommand({ kind: "interact" });
    expect(out.ok).toBe(false);
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
  });

  it("costs no turn when the rack is full, and says why", () => {
    const { game } = gameOn(ROOM);
    fillRack(game);
    addWreck(game, game.player.pos, "laser", 2);
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    const energy = game.player.energy;

    const out = game.playerCommand({ kind: "interact" });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe("No free slot. Something has to burn first.");
    expect(game.log.tail(5).map((m) => m.text)).toContain("No free slot. Something has to burn first.");
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
    expect(deckOf(game).wrecks).toHaveLength(1);
  });
});

describe("wreckage belongs to the deck", () => {
  it("does not survive the descent", () => {
    const game = newGame(11);
    // Counting piles no longer works: every deck is generated with salvage of
    // its own (src/systems/populate.ts). What must not survive is this one.
    const dropped = addWreck(game, game.player.pos, "laser", 2);
    expect(deckOf(game).wrecks).toContain(dropped);

    game.descend();
    expect(game.depth).toBe(2);
    expect(deckOf(game).wrecks).not.toContain(dropped);
    expect(rigOf(game.player)!.slots.filter(Boolean)).toHaveLength(5);
  });
});

const FUZZ: Command[] = [
  { kind: "move", dx: 1, dy: 0 },
  { kind: "move", dx: -1, dy: 0 },
  { kind: "move", dx: 0, dy: 1 },
  { kind: "move", dx: 0, dy: -1 },
  { kind: "attack", dx: 1, dy: 0 },
  { kind: "wait" },
  { kind: "descend" },
  { kind: "interact" },
  { kind: "interact" },
];

describe("replay", () => {
  it("reproduces a run that salvaged, bit for bit", () => {
    const seed = 31337;
    const first = newGame(seed);
    const rng = new Rng(9001);
    for (let i = 0; i < 300 && first.status === "playing"; i++) first.playerCommand(rng.pick(FUZZ));

    const again = replay(seed, first.inputs, GAME_CONFIG);
    expect(deckOf(again)).toEqual(deckOf(first));
    expect(rigOf(again.player)).toEqual(rigOf(first.player));
    expect(again.depth).toBe(first.depth);
    expect(again.player.hp).toBe(first.player.hp);
    expect(again.status).toBe(first.status);
    expect(again.schedule.time).toBe(first.schedule.time);
  });
});
