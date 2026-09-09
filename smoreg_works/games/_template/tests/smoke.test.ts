import { describe, it, expect } from "vitest";
import { Game } from "@jamrog/engine";
import { CONTENT } from "../src/content/pack.js";

describe("__GAME_NAME__", () => {
  it("starts a run on walkable ground", () => {
    const game = new Game({ seed: 1, content: CONTENT });
    expect(game.status).toBe("playing");
    expect(game.level.isWalkable(game.player.pos.x, game.player.pos.y)).toBe(true);
  });

  it("survives a hundred random commands", () => {
    const game = new Game({ seed: 2, content: CONTENT });
    expect(() => {
      for (let i = 0; i < 100 && !game.isOver(); i++) game.playerCommand({ kind: "wait" });
    }).not.toThrow();
  });
});
