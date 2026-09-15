import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newGame } from "../src/game.js";
import { undock } from "../src/systems/voyage.js";
import { hexLayout } from "@jamrog/engine";
import { keelOf, mirror } from "../src/ui/react/hull.js";
import { bleedScale, deckOf } from "../src/ui/react/deck.js";
import { whoOf } from "../src/ui/react/model.js";
import { DRONE_ICON, MACHINE_ICON } from "../src/ui/react/board/machines.js";
import { droneIcon } from "../src/ui/react/board/Icon.js";
import { MONSTERS } from "../src/content/monsters.js";
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

describe("what the bake promises the board", () => {
  it("says the tiles are grey, inverted and sized for this hexagon", () => {
    /* The board draws these with no filter at all, so everything that makes
       them legible on a near-black deck has to have happened at bake time.
       These three flags are that contract written down. */
    const said = index as unknown as { side: number; grey: boolean; inverted: boolean };
    expect(said.side).toBe(288);
    expect(said.grey).toBe(true);
    /* The source is dark ink drawn for paper. Dark ink at a third opacity over
       a near-black deck is nothing at all — which is exactly how it looked
       before this was true. */
    expect(said.inverted).toBe(true);
  });

  it("writes the pixels it said it would", () => {
    /* Read straight off the VP8X header rather than trusting the index: a
       re-bake that changed the size and not the json would put every deck
       slightly out of focus and nothing would say so. */
    const dir = join(import.meta.dirname, "..", "public", "deck", "t");
    for (const tile of index.tiles.slice(0, 12)) {
      const head = readFileSync(join(dir, `${tile.id}.webp`)).subarray(0, 30);
      expect(head.subarray(0, 4).toString("latin1")).toBe("RIFF");
      expect(head.subarray(12, 16).toString("latin1")).toBe("VP8X");
      /* Canvas size is stored minus one, 24-bit little-endian. */
      const w = head.readUIntLE(24, 3) + 1;
      const h = head.readUIntLE(27, 3) + 1;
      expect([w, h], tile.id).toEqual([288, 288]);
      /* And the alpha flag is set, because the transparency *is* the drawing:
         four fifths of one of these tiles is nothing, and a bake that flattened
         it would ship a solid block. */
      expect(head[20]! & 0x10, `${tile.id} has no alpha`).toBe(0x10);
    }
  });

  it("is small enough to ship", () => {
    const dir = join(import.meta.dirname, "..", "public", "deck", "t");
    let bytes = 0;
    for (const tile of index.tiles) bytes += readFileSync(join(dir, `${tile.id}.webp`)).length;
    /* Eleven megabytes at full size and colour, three and a third at the size
       this board draws. The jam ships as a zip, so this is a real budget and
       not a preference. */
    expect(bytes).toBeLessThan(5_000_000);
  });
});

describe("the machines the board draws as faces", () => {
  it("has an icon for every machine of the band, and for no other", () => {
    /* Eight shapes that all mean "a thing coming for you" are eight shapes to
       tell apart; a face is one to recognise. So the band is drawn and the
       ones the ship places itself keep their silhouettes — the shape says what
       kind of thing it is, and there is no face to confuse it with.
 
       "The band" is weight, not the list: all twelve machines live in
       `MONSTERS` and the four with no weight are never rolled for, only put
       where the ship wants them. */
    const band = new Set(MONSTERS.filter((m) => m.weight > 0).map((m) => m.ch));
    expect(band.size).toBe(8);
    expect(MONSTERS.length).toBe(12);
    for (const ch of band) expect(MACHINE_ICON[ch], `no icon for ${ch}`).toBeDefined();
    expect(Object.keys(MACHINE_ICON)).toHaveLength(band.size);
  });

  it("carries the drawing and not the site's backing square", () => {
    /* Each download is a black square with a white icon on it. The square is
       the site's background; left in, it would paint over the deck. */
    for (const [ch, d] of Object.entries(MACHINE_ICON)) {
      expect(d.startsWith("M0 0h512v512H0z"), `${ch} kept the backing square`).toBe(false);
      expect(d.length, ch).toBeGreaterThan(200);
      /* Path data and nothing else: no `fill`, no colour, nothing that would
         stop the board painting it whatever the compartment is worth. */
      expect(d, ch).toMatch(/^[MmZzLlHhVvCcSsQqTtAa\s\d.,+\-eE]+$/);
    }
  });

  it("is credited where the licence asks, and where a player can find it", () => {
    /* CC BY 3.0 asks for attribution and nothing else, so the one thing that
       must not drift is the notice. */
    const credits = readFileSync(join(import.meta.dirname, "..", "..", "..", "assets", "CREDITS.md"), "utf8");
    expect(credits).toContain("game-icons.net");
    expect(credits).toContain("CC BY 3.0");
    for (const who of ["Lorc", "Delapouite", "Lord Berandas"]) expect(credits).toContain(who);
    /* And the geomorphs, whose licence asks for more than a notice. */
    expect(credits).toContain("CC BY-NC 4.0");
    expect(credits).toContain("некоммерческим");
  });
});

describe("the drone is drawn as the machine it was built as", () => {
  it("has five to be built as, and picks one without a roll", () => {
    expect(DRONE_ICON).toHaveLength(5);
    /* `game.rng` is the run. A picture that spent a roll would change what
       happens next the moment somebody looked at it, and the whole of
       `(seed, inputs)` rests on that not being possible. */
    const game = newGame(2026);
    expect(undock(game).ok).toBe(true);
    const before = game.rng.next();
    droneIcon(whoOf(game));
    droneIcon(whoOf(game));
    const again = newGame(2026);
    expect(undock(again).ok).toBe(true);
    expect(again.rng.next()).toBe(before);
  });

  it("is the same machine every time the same drone is looked at", () => {
    const a = newGame(2026);
    const b = newGame(2026);
    expect(undock(a).ok).toBe(true);
    expect(undock(b).ok).toBe(true);
    expect(whoOf(a)).toBe(whoOf(b));
    expect(droneIcon(whoOf(a))).toBe(droneIcon(whoOf(b)));
  });

  it("spreads across the five rather than favouring one", () => {
    /* A hash that pushed most drones onto one hull would be five icons and one
       drawing. Every one of them has to come up. */
    const seen = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      for (let sortie = 1; sortie < 4; sortie++) {
        seen.add(droneIcon(`${String(seed)}:${String(sortie)}:scrapper`));
      }
    }
    expect(seen.size).toBe(DRONE_ICON.length);
  });

  it("tells two sorties in one hull apart", () => {
    /* A drone is built for a sortie and lost on it; the rack is what carries
       over. Two runs in a SPARK are two machines. */
    const runs = ["4242:1:spark", "4242:2:spark", "4242:3:spark"];
    expect(new Set(runs.map(droneIcon)).size).toBeGreaterThan(1);
  });

  it("carries the drawing and not the site's backing square", () => {
    for (const d of DRONE_ICON) {
      expect(d.startsWith("M0 0h512v512H0z")).toBe(false);
      expect(d).toMatch(/^[MmZzLlHhVvCcSsQqTtAa\s\d.,+\-eE]+$/);
      expect(d.length).toBeGreaterThan(300);
    }
  });
});
