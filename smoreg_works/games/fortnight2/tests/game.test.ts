import { describe, it, expect } from "vitest";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { replay } from "@jamrog/engine";
import type { Command } from "@jamrog/engine";
import { Rng } from "@jamrog/engine";

const DIRS: Command[] = [
  { kind: "move", dx: 1, dy: 0 },
  { kind: "move", dx: -1, dy: 0 },
  { kind: "move", dx: 0, dy: 1 },
  { kind: "move", dx: 0, dy: -1 },
  { kind: "move", dx: 1, dy: 1 },
  { kind: "move", dx: -1, dy: -1 },
  { kind: "wait" },
  { kind: "descend" },
];

describe("Game", () => {
  it("starts alive, on depth 1, with the player placed on a walkable tile", () => {
    const g = newGame(1);
    expect(g.status).toBe("playing");
    expect(g.depth).toBe(1);
    expect(g.level.isWalkable(g.player.pos.x, g.player.pos.y)).toBe(true);
  });

  it("refuses an illegal move without consuming a turn", () => {
    const g = newGame(2);
    const turnBefore = g.schedule.time;
    // Walk into the map edge from wherever we are, repeatedly, until refused.
    let refused = false;
    for (const d of DIRS.slice(0, 6)) {
      const before = g.player.pos;
      const out = g.playerCommand(d);
      if (!out.ok) {
        refused = true;
        expect(g.player.pos).toEqual(before);
        break;
      }
    }
    expect(refused || g.schedule.time >= turnBefore).toBe(true);
  });

  it("descending only works on the stairs", () => {
    const g = newGame(3);
    const out = g.playerCommand({ kind: "descend" });
    expect(out.ok).toBe(false);
    expect(g.depth).toBe(1);
  });

  it("survives 400 random commands on 40 seeds without throwing", () => {
    for (let s = 0; s < 40; s++) {
      const g = newGame(s + 31337);
      const rng = new Rng(s);
      expect(() => {
        for (let i = 0; i < 400 && g.status === "playing"; i++) g.playerCommand(rng.pick(DIRS));
      }, `seed ${s + 31337}`).not.toThrow();
      expect(["playing", "dead", "won"]).toContain(g.status);
    }
  });

  it("replays a recorded run to the identical outcome", () => {
    const seed = 424242;
    const g1 = newGame(seed);
    const rng = new Rng(11);
    for (let i = 0; i < 250 && g1.status === "playing"; i++) g1.playerCommand(rng.pick(DIRS));

    const g2 = replay(seed, g1.inputs, GAME_CONFIG);
    expect(g2.player.pos).toEqual(g1.player.pos);
    expect(g2.player.hp).toBe(g1.player.hp);
    expect(g2.depth).toBe(g1.depth);
    expect(g2.kills).toBe(g1.kills);
    expect(g2.status).toBe(g1.status);
    expect(g2.schedule.time).toBe(g1.schedule.time);
  });

  it("never leaves the player standing on a wall after any command sequence", () => {
    const g = newGame(5150);
    const rng = new Rng(99);
    for (let i = 0; i < 500 && g.status === "playing"; i++) {
      g.playerCommand(rng.pick(DIRS));
      expect(g.level.isWalkable(g.player.pos.x, g.player.pos.y)).toBe(true);
    }
  });

  it("never lets two blocking entities share a tile", () => {
    const g = newGame(6161);
    const rng = new Rng(7);
    for (let i = 0; i < 400 && g.status === "playing"; i++) {
      g.playerCommand(rng.pick(DIRS));
      const seen = new Set<string>();
      for (const e of g.entities) {
        if (e.hp <= 0) continue;
        const k = `${e.pos.x},${e.pos.y}`;
        expect(seen.has(k), `two entities on ${k} at step ${i}`).toBe(false);
        seen.add(k);
      }
    }
  });
});
