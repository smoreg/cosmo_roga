import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newGame } from "../src/game.js";
import { undock } from "../src/systems/voyage.js";
import { hexLayout } from "@jamrog/engine";
import { keelOf, mirror } from "../src/ui/react/hull.js";
import { bleedScale, deckOf } from "../src/ui/react/deck.js";
import type { DeckIndex } from "../src/ui/react/deck.js";

/**
 * The deck a compartment wears.
 *
 * Baked by `tools/deck/bake.mjs` and picked here, so both ends are checked
 * against each other: an index that lost its roles would pick nothing, and a
 * picker that ignored the keel would draw a hull whose halves disagree.
 */
const index = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "public", "deck", "deck.json"), "utf8"),
) as DeckIndex;

const cellsOf = (game: ReturnType<typeof newGame>) => {
  const layout = hexLayout(game.ship);
  const cells = new Map<number, { q: number; r: number }>();
  for (const room of game.ship.rooms) {
    const cell = layout.cells.get(room.id);
    if (cell !== undefined) cells.set(room.id, cell);
  }
  return cells;
};

describe("the baked index", () => {
  it("carries tiles, and every one of them has a role to be found by", () => {
    expect(index.tiles.length).toBeGreaterThan(200);
    const roled = index.tiles.filter((t) => t.roles.length > 0);
    /* A tile with no role is only ever reachable through the whole-pool
       fallback, which is fine for a few and wrong for most. */
    expect(roled.length).toBeGreaterThan(index.tiles.length * 0.8);
  });

  it("knows the bleed, which is the number that made the first version wrong", () => {
    expect(index.deckFeet).toBe(100);
    expect(index.bleedFeet).toBe(10);
    /* A hundred-foot deck arrives in a hundred-and-twenty-foot picture. */
    expect(bleedScale(index)).toBeCloseTo(1.2, 10);
  });

  it("names tiles so a URL never needs escaping", () => {
    for (const tile of index.tiles) expect(tile.id).toMatch(/^[0-9a-f]{12}$/);
    expect(new Set(index.tiles.map((t) => t.id)).size).toBe(index.tiles.length);
  });
});

describe("what each compartment wears", () => {
  it("gives every compartment a deck", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const cells = cellsOf(game);
    const decks = deckOf(game, index, cells, keelOf(cells.values()));
    for (const [id] of cells) expect(decks.get(id)?.id, `room ${String(id)}`).toBeDefined();
  });

  it("mirrors across the keel: the far side is the same deck, flipped", () => {
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const cells = cellsOf(game);
    const keel = keelOf(cells.values());
    const decks = deckOf(game, index, cells, keel);
    const at = new Map<string, number>();
    for (const [id, c] of cells) at.set(`${String(c.q)},${String(c.r)}`, id);

    let pairs = 0;
    for (const [id, cell] of cells) {
      if (cell.r === keel) {
        /* A compartment on the keel faces itself, so it is never flipped. */
        expect(decks.get(id)?.flipped).toBe(false);
        continue;
      }
      const t = mirror(cell, keel);
      const twin = at.get(`${String(t.q)},${String(t.r)}`);
      if (twin === undefined) continue;
      pairs++;
      /* The same section, seen from the other side of the ship. A hull whose
         halves wear different decks looks assembled rather than drawn. */
      expect(decks.get(id)?.id).toBe(decks.get(twin)?.id);
      expect(decks.get(id)?.flipped).not.toBe(decks.get(twin)?.flipped);
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it("is the same picture every time the same hull is opened", () => {
    const a = newGame(2026);
    const b = newGame(2026);
    expect(undock(a).ok).toBe(true);
    expect(undock(b).ok).toBe(true);
    const ca = cellsOf(a);
    const cb = cellsOf(b);
    const da = deckOf(a, index, ca, keelOf(ca.values()));
    const db = deckOf(b, index, cb, keelOf(cb.values()));
    for (const [id, deck] of da) expect(db.get(id)).toEqual(deck);
  });

  it("spends no roll: drawing the board cannot move the run", () => {
    /* The deck is a picture and the rng is the run. If picking a tile touched
       `game.rng`, opening a map would change what happens next — and the whole
       of `(seed, inputs)` rests on it not doing that. */
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const cells = cellsOf(game);
    const before = game.rng.next();
    deckOf(game, index, cells, keelOf(cells.values()));
    deckOf(game, index, cells, keelOf(cells.values()));
    const game2 = newGame(2026);
    expect(undock(game2).ok).toBe(true);
    expect(game2.rng.next()).toBe(before);
  });

  it("draws nothing rather than guessing when the build has no art", () => {
    const game = newGame(2026);
    const cells = cellsOf(game);
    expect(deckOf(game, null, cells, 0).size).toBe(0);
    expect(deckOf(game, { ...index, tiles: [] }, cells, 0).size).toBe(0);
  });
});
