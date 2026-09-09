import { describe, it, expect } from "vitest";
import { replay, spawnMonster, type Command, type Entity, type Game } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { addWreck, rigOf } from "../src/twist/rig.js";
import { alertState } from "../src/systems/alert.js";
import { exploreStep, fightStep, isStop, makeExplorer, type AutoResult } from "../src/ui/auto.js";

/**
 * Auto-explore is only allowed to exist because of where it stops, so that is
 * what this file is: one test per reason to hand the deck back. The maps are
 * hand-drawn — a stop condition asserted through a lucky seed is a stop
 * condition nobody can read six days later.
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

function cmdOf(result: AutoResult): Command {
  if (isStop(result)) throw new Error(`expected a command, got stop: ${result.stop}`);
  return result.cmd;
}

function stopOf(result: AutoResult): string {
  if (!isStop(result)) throw new Error(`expected a stop, got ${JSON.stringify(result.cmd)}`);
  return result.stop;
}

/** An open corridor the drone has already seen end to end. Nothing left to do. */
const SWEPT = ["#######", "#@...>#", "#######"];

describe("auto-explore", () => {
  it("walks towards the part of the deck it has not seen", () => {
    // The lower corridor is around a corner: FOV cannot reach it from the start.
    const { game } = gameOn([
      "##########",
      "#@.......#",
      "########.#",
      "#........#",
      "##########",
    ]);
    expect(game.level.explored.get(2, 3)).toBe(false);
    expect(cmdOf(exploreStep(game))).toEqual({ kind: "move", dx: 1, dy: 0 });
  });

  it("stops the moment a living machine is in sight", () => {
    const { game, monsters } = gameOn(["#########", "#@.....m#", "#########"]);
    expect(stopOf(exploreStep(game))).toBe("You see the maintenance bot.");

    // A dead machine is scenery: the walk ends for other reasons, not for it.
    monsters[0]!.hp = 0;
    game.reapDead();
    expect(stopOf(exploreStep(game))).not.toContain("You see");
  });

  it("stops when salvage it had not seen comes into view", () => {
    const { game } = gameOn([
      "##########",
      "#@.......#",
      "########.#",
      "#........#",
      "##########",
    ]);
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    addWreck(game, { x: 4, y: 1 }, "plating", 2);
    expect(stopOf(explorer.step(game))).toBe("Something here: scrap.");

    // ...and it does not stop twice for the same pile.
    expect(isStop(explorer.step(game))).toBe(false);
  });

  it("names a crate as a crate", () => {
    const { game } = gameOn([
      "##########",
      "#@.......#",
      "########.#",
      "#........#",
      "##########",
    ]);
    const explorer = makeExplorer();
    explorer.step(game);
    addWreck(game, { x: 4, y: 1 }, "emp", 2, "X");
    expect(stopOf(explorer.step(game))).toBe("Something here: a parts crate.");
  });

  it("stops on an airlock or a hatch that has just come into view", () => {
    for (const [glyph, line] of [
      ["=", "An airlock is in sight."],
      [">", "The hatch is in sight."],
    ] as const) {
      const { game } = gameOn(["#########", `#@....${glyph}.#`, "#########"]);
      const explorer = makeExplorer();
      // Hide it for the first step only: the stop is about the change.
      game.level.visible.set(6, 1, false);
      explorer.step(game);
      game.level.visible.set(6, 1, true);
      expect(stopOf(explorer.step(game))).toBe(line);
    }
  });

  it("stops on any damage at all, wherever it landed", () => {
    const { game } = gameOn([
      "##########",
      "#@.......#",
      "########.#",
      "#........#",
      "##########",
    ]);
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    const rig = rigOf(game.player)!;
    const slot = rig.slots.find((s) => s !== null)!;
    slot.integrity -= 1;
    expect(stopOf(explorer.step(game))).toBe("Something is hitting you.");
  });

  it("stops when the deck alert goes up a step", () => {
    const { game } = gameOn([
      "##########",
      "#@.......#",
      "########.#",
      "#........#",
      "##########",
    ]);
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    alertState(game).level += 1;
    expect(stopOf(explorer.step(game))).toBe("Alert rising.");
  });

  it("takes one step towards the hatch when the deck is swept, then stops", () => {
    const { game } = gameOn(SWEPT);
    const explorer = makeExplorer();
    expect(cmdOf(explorer.step(game))).toEqual({ kind: "move", dx: 1, dy: 0 });
    expect(stopOf(explorer.step(game))).toBe("Deck explored. The hatch is east.");
  });

  it("points at the hatch whichever way it lies", () => {
    const decks: Array<[string, string[]]> = [
      ["east", SWEPT],
      ["west", ["#######", "#>...@#", "#######"]],
      ["north", ["###", "#>#", "#.#", "#.#", "#@#", "###"]],
      ["south", ["###", "#@#", "#.#", "#.#", "#>#", "###"]],
    ];
    for (const [bearing, rows] of decks) {
      const { game } = gameOn(rows);
      const explorer = makeExplorer();
      // One step towards it, and then the deck is handed back with a bearing.
      expect(isStop(explorer.step(game)), bearing).toBe(false);
      expect(stopOf(explorer.step(game))).toBe(`Deck explored. The hatch is ${bearing}.`);
    }
  });

  it("hands the deck back the moment the run ends under it", () => {
    const { game } = gameOn(SWEPT);
    const explorer = makeExplorer();
    game.status = "dead";
    expect(stopOf(explorer.step(game))).toBe("The run is over.");
    expect(stopOf(exploreStep(game))).toBe("The run is over.");
  });

  it("says so plainly when there is no hatch to point at", () => {
    const { game } = gameOn(["#######", "#@....#", "#######"]);
    expect(stopOf(exploreStep(game))).toBe("Nothing left to explore.");
  });

  it("never asks for a command that is not a legal move", () => {
    const game = newGame(1234);
    const explorer = makeExplorer();
    for (let i = 0; i < 60; i++) {
      const result = explorer.step(game);
      if (isStop(result)) break;
      const outcome = game.playerCommand(result.cmd);
      expect(outcome.ok).toBe(true);
    }
  });

  it("replays bit for bit: the commands it issues are ordinary player input", () => {
    const seed = 20260903;
    const game = newGame(seed);
    const explorer = makeExplorer();
    const cmds: Command[] = [];
    for (let i = 0; i < 40; i++) {
      const result = explorer.step(game);
      if (isStop(result)) break;
      cmds.push(result.cmd);
      game.playerCommand(result.cmd);
    }
    expect(cmds.length).toBeGreaterThan(0);

    const again = replay(seed, cmds, GAME_CONFIG);
    expect(again.player.pos).toEqual(game.player.pos);
    expect(again.player.hp).toBe(game.player.hp);
    expect(again.schedule.time).toBe(game.schedule.time);
    expect(again.log.tail(50)).toEqual(game.log.tail(50));

    // And the decision itself is a function of state: same seed, same walk.
    const twin = newGame(seed);
    const twinExplorer = makeExplorer();
    const twinCmds: Command[] = [];
    for (let i = 0; i < cmds.length; i++) {
      const result = twinExplorer.step(twin);
      if (isStop(result)) break;
      twinCmds.push(result.cmd);
      twin.playerCommand(result.cmd);
    }
    expect(twinCmds).toEqual(cmds);
  });
});

describe("autofight", () => {
  it("swings at an adjacent machine", () => {
    const { game } = gameOn(["#####", "#@m.#", "#####"]);
    expect(cmdOf(fightStep(game))).toEqual({ kind: "attack", dx: 1, dy: 0 });
  });

  it("takes exactly one step towards the nearest visible machine", () => {
    const { game, monsters } = gameOn(["#########", "#@.....m#", "#########"]);
    const cmd = cmdOf(fightStep(game));
    expect(cmd).toEqual({ kind: "move", dx: 1, dy: 0 });
    // One step, not a charge: the next call is the player's decision again.
    game.playerCommand(cmd);
    expect(Math.abs(game.player.pos.x - monsters[0]!.pos.x)).toBeGreaterThan(1);
  });

  it("prefers the nearer of two machines", () => {
    const { game, monsters } = gameOn(["##########", "#..@....m#", "#m.......#", "##########"]);
    const near = monsters.find((m) => m.pos.y === 2)!;
    const cmd = cmdOf(fightStep(game));
    expect(cmd.kind).toBe("move");
    if (cmd.kind !== "move") throw new Error("unreachable");
    expect(game.player.pos.x + cmd.dx).toBe(near.pos.x + 1);
    expect(game.player.pos.y + cmd.dy).toBe(near.pos.y);
  });

  it("refuses without spending a turn when nothing is in sight", () => {
    const { game } = gameOn(["#######", "#@....#", "#######"]);
    const before = game.inputs.length;
    expect(stopOf(fightStep(game))).toBe("No target in sight.");
    expect(game.inputs.length).toBe(before);
  });

  it("ignores a machine it cannot see", () => {
    // The bot is behind a sealed bulkhead: out of sight, out of the fight.
    const { game } = gameOn(["#######", "#@..|m#", "#######"]);
    expect(stopOf(fightStep(game))).toBe("No target in sight.");
  });

  it("refuses a machine there is no route to", () => {
    // Two corridors that never meet. Nothing in the game lights the far one
    // today — the sensor pulse maps the deck without making it visible — so
    // sight is forced here: the branch exists so that the day something does
    // show a machine through a wall, autofight says so instead of walking the
    // drone into it.
    const { game, monsters } = gameOn([
      "#########",
      "#@......#",
      "#########",
      "#......m#",
      "#########",
    ]);
    const target = monsters[0]!;
    game.level.visible.set(target.pos.x, target.pos.y, true);
    expect(stopOf(fightStep(game))).toBe("No way through.");
  });

  it("has nothing to say once the run is over", () => {
    const { game } = gameOn(["#####", "#@m.#", "#####"]);
    game.status = "dead";
    expect(stopOf(fightStep(game))).toBe("The run is over.");
  });
});
