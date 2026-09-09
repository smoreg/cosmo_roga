import { describe, it, expect } from "vitest";
import { Game } from "../src/sim/game.js";
import { Tile } from "../src/sim/level.js";
import type { Twist } from "../src/sim/twist.js";
import type { Point } from "../src/sim/grid.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";

const EMPTY_FLOOR = { ...TEST_CONTENT, monstersForDepth: () => [], monsterBudget: () => 0 };

/** Walk the player onto the stairs and take them. Levels are always connected. */
function goDown(game: Game): void {
  let stairs: Point | undefined;
  game.level.tiles.forEach((x, y, t) => {
    if (t === Tile.StairsDown) stairs = { x, y };
  });
  game.player.pos = { ...stairs! };
  const out = game.playerCommand({ kind: "descend" });
  expect(out.ok).toBe(true);
}

describe("panel lines", () => {
  it("are collected twist first, then the systems, in order", () => {
    const speaker = (name: string): Twist => ({
      name,
      panelLines: () => [{ text: `${name} 1` }, { text: `${name} 2`, fg: "#e0a458" }],
    });
    const game = new Game({
      seed: 1,
      content: EMPTY_FLOOR,
      twist: speaker("twist"),
      systems: [{ name: "quiet" }, speaker("alert")],
    });

    const lines = game.systems.flatMap((sys) => sys.panelLines?.(game) ?? []);
    expect(lines.map((l) => l.text)).toEqual(["twist 1", "twist 2", "alert 1", "alert 2"]);
    expect(lines[1]!.fg).toBe("#e0a458");
  });

  it("leaves statusLine working for a twist that has only one line to say", () => {
    const game = new Game({ seed: 1, content: EMPTY_FLOOR, twist: { name: "t", statusLine: () => "ALERT 2" } });
    expect(game.systems.map((s) => s.statusLine?.(game)).filter(Boolean)).toEqual(["ALERT 2"]);
  });
});

describe("level transitions", () => {
  it("calls beforeLevelLeave once per descent, before the next level is entered", () => {
    const calls: string[] = [];
    const spy: Twist = {
      name: "spy",
      beforeLevelLeave: (_g, depth) => void calls.push(`leave ${depth}`),
      onLevelEnter: (_g, depth) => void calls.push(`enter ${depth}`),
    };
    const game = new Game({ seed: 11, content: EMPTY_FLOOR, twist: spy });

    goDown(game);
    expect(game.depth).toBe(2);
    expect(calls).toEqual(["enter 1", "leave 1", "enter 2"]);
  });

  it("does not announce a departure on the winning descent", () => {
    const calls: string[] = [];
    const spy: Twist = { name: "spy", beforeLevelLeave: (_g, depth) => void calls.push(`leave ${depth}`) };
    const game = new Game({ seed: 11, content: EMPTY_FLOOR, maxDepth: 1, twist: spy });

    goDown(game);
    expect(game.status).toBe("won");
    expect(calls).toEqual([]);
  });
});

describe("run state", () => {
  it("starts with no flags and keeps them across a descent", () => {
    const game = new Game({ seed: 12, content: EMPTY_FLOOR });
    expect(game.flags.size).toBe(0);

    game.flags.add("found-sensors");
    goDown(game);
    expect(game.flags.has("found-sensors")).toBe(true);
  });

  it("carries entity.data down the stairs: the player is the same object", () => {
    const game = new Game({ seed: 13, content: EMPTY_FLOOR });
    const before = game.player;
    game.player.data = { rig: { burned: ["scanner"] } };

    goDown(game);
    expect(game.player).toBe(before);
    expect(game.player.data).toEqual({ rig: { burned: ["scanner"] } });
  });
});

describe("ending lines", () => {
  it("uses the content pack's win line, and the engine's when there is none", () => {
    const own = new Game({ seed: 14, content: { ...EMPTY_FLOOR, maxDepth: 1, winLine: "The station goes quiet." } });
    goDown(own);
    expect(own.log.lines.at(-1)!.text).toBe("The station goes quiet.");

    const plain = new Game({ seed: 14, content: { ...EMPTY_FLOOR, maxDepth: 1 } });
    goDown(plain);
    expect(plain.log.lines.at(-1)!.text).toContain("You win.");
  });

  it("uses the content pack's death line", () => {
    const game = new Game({ seed: 15, content: { ...EMPTY_FLOOR, deathLine: "The drone stops." } });
    // Nothing on an empty floor can kill the drone, so end it the way a twist
    // that burned the last module would: hit points to zero, then a turn.
    game.player.hp = 0;
    game.playerCommand({ kind: "wait" });

    expect(game.status).toBe("dead");
    expect(game.log.lines.at(-1)!.text).toBe("The drone stops.");
  });
});
