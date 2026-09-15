import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newGame } from "../src/game.js";
import { undock } from "../src/systems/voyage.js";
import { applyDeckIndex } from "../src/ui/react/deckindex.js";
import { boardOf } from "../src/ui/react/model.js";
import type { DeckIndex } from "../src/ui/react/deck.js";

describe("probe", () => {
  it("counts decks", () => {
    const index = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "public", "deck", "deck.json"), "utf8"),
    ) as DeckIndex;
    const game = newGame(2026);
    undock(game);
    const before = boardOf(game).rooms.filter((r) => r.deck?.id !== undefined).length;
    applyDeckIndex(index);
    const after = boardOf(game).rooms.filter((r) => r.deck?.id !== undefined).length;
    const total = boardOf(game).rooms.filter((r) => r.id >= 0).length;
    console.log("rooms", total, "decks before index", before, "after", after);
    expect(true).toBe(true);
  });
});
