import { describe, it, expect } from "vitest";
import { Game, replay } from "../src/sim/game.js";
import { decodeRun, encodeRun, SAVE_VERSION } from "../src/sim/save.js";
import type { Command, Outcome } from "../src/sim/actions.js";
import { TURN_COST } from "../src/sim/schedule.js";
import type { Twist } from "../src/sim/twist.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";

const EMPTY_FLOOR = { ...TEST_CONTENT, monstersForDepth: () => [], monsterBudget: () => 0 };

/** A system that claims `use`/`interact` and reports what it was handed. */
function handler(name: string, seen: Command[], cost = 100): Twist {
  return {
    name,
    performCommand: (_g, _actor, cmd): Outcome | undefined => {
      if (cmd.kind !== "use" && cmd.kind !== "interact") return undefined;
      seen.push(cmd);
      return { ok: true, cost };
    },
  };
}

describe("custom commands", () => {
  it("refuses a command nobody claims and does not spend the turn", () => {
    const game = new Game({ seed: 3, content: EMPTY_FLOOR });

    const out = game.playerCommand({ kind: "use", slot: 0 });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("Nothing to do.");
    expect(game.inputs).toEqual([]);
    // Still the ready actor: nothing was charged, so the world did not move.
    expect(game.player.energy).toBeGreaterThanOrEqual(TURN_COST);

    const time = game.schedule.time;
    expect(game.playerCommand({ kind: "interact" }).ok).toBe(false);
    expect(game.schedule.time).toBe(time);
    expect(game.inputs).toEqual([]);
  });

  it("spends the turn and records the input when a system claims it", () => {
    const seen: Command[] = [];
    const game = new Game({ seed: 3, content: EMPTY_FLOOR, twist: handler("rig", seen) });
    const time = game.schedule.time;

    const cmd: Command = { kind: "use", slot: 2, target: { x: 4, y: 5 } };
    const out = game.playerCommand(cmd);
    expect(out).toEqual({ ok: true, cost: 100 });
    expect(seen).toEqual([cmd]);
    expect(game.inputs).toEqual([cmd]);
    expect(game.schedule.time).toBeGreaterThan(time);
  });

  it("asks systems in order and stops at the first one that claims", () => {
    const seen: Command[] = [];
    const passes: Twist = { name: "passes", performCommand: () => undefined };
    const game = new Game({
      seed: 3,
      content: EMPTY_FLOOR,
      twist: passes,
      systems: [handler("second", seen), handler("third", [])],
    });

    expect(game.playerCommand({ kind: "interact" }).ok).toBe(true);
    expect(seen).toEqual([{ kind: "interact" }]);
  });

  it("a claimed command is silent unless its system says otherwise", () => {
    const seen: Command[] = [];
    const game = new Game({ seed: 3, content: EMPTY_FLOOR, twist: handler("rig", seen) });

    game.playerCommand({ kind: "interact" });
    expect(game.noise.get(game.player.pos.x, game.player.pos.y)).toBe(0);
  });

  it("the known commands still cost and sound the same", () => {
    const game = new Game({ seed: 3, content: EMPTY_FLOOR });
    expect(game.playerCommand({ kind: "wait" })).toEqual({ ok: true, cost: TURN_COST });
    expect(game.noise.get(game.player.pos.x, game.player.pos.y)).toBe(0);

    const dirs: Command[] = [
      { kind: "move", dx: 1, dy: 0 }, { kind: "move", dx: -1, dy: 0 },
      { kind: "move", dx: 0, dy: 1 }, { kind: "move", dx: 0, dy: -1 },
    ];
    const step = dirs.find((d) => game.playerCommand(d).ok)!;
    expect(step, "nowhere to step from the entry tile").toBeDefined();
    expect(game.noise.get(game.player.pos.x, game.player.pos.y)).toBe(3);
  });

  it("replays a run that mixes custom commands with moves", () => {
    const cmds: Command[] = [
      { kind: "use", slot: 1 },
      { kind: "interact" },
      { kind: "move", dx: 1, dy: 0 },
      { kind: "use", slot: 0, target: { x: 2, y: 2 } },
      { kind: "wait" },
      { kind: "move", dx: 0, dy: 1 },
    ];
    const cfg = () => ({ content: EMPTY_FLOOR, twist: handler("rig", []) });

    const live = replay(4242, cmds, cfg());
    const again = replay(4242, cmds, cfg());
    expect(again.player.pos).toEqual(live.player.pos);
    expect(again.schedule.time).toBe(live.schedule.time);
    expect(again.inputs).toEqual(live.inputs);
  });
});

describe("saved custom commands", () => {
  it("round-trips use and interact", () => {
    const inputs: Command[] = [
      { kind: "interact" },
      { kind: "use", slot: 0 },
      { kind: "use", slot: 3, target: { x: 1, y: 2 } },
    ];
    const back = decodeRun(encodeRun({ version: SAVE_VERSION, seed: 5, inputs }));
    expect(back.ok).toBe(true);
    expect(back.record!.inputs).toEqual(inputs);
  });

  it("rejects a malformed slot", () => {
    for (const bad of [{ slot: -1 }, { slot: "a" }, { slot: 1.5 }, {}]) {
      const text = JSON.stringify({ version: SAVE_VERSION, seed: 5, inputs: [{ kind: "use", ...bad }] });
      expect(decodeRun(text).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects a malformed target", () => {
    const text = JSON.stringify({ version: SAVE_VERSION, seed: 5, inputs: [{ kind: "use", slot: 0, target: { x: 1 } }] });
    expect(decodeRun(text).ok).toBe(false);
  });
});
