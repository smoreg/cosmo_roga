import type { RoomGame, RoomId } from "@jamrog/engine";
import { mirror } from "./hull.js";
import type { Cell } from "./hull.js";

/**
 * What a compartment's deck looks like.
 *
 * The board draws one hundred-foot section per compartment, and the art for it
 * comes out of the geomorph library baked into `public/deck`
 * (`tools/deck/bake.mjs`). What is picked is decided here, and only two things
 * decide it: what kind of compartment it is, and which side of the keel it is
 * on.
 *
 * ## Why role and not edge-matching
 *
 * The generator this came from (`vuvko_works/roomgen.html`) scores a tile
 * against its four edges: plating where the hull faces space, an opening where
 * a door is owed, spill only where there is somewhere to spill. All of that is
 * about a square lattice, and the board is a honeycomb — the hexagon clips the
 * tile's own edges away before they are ever seen. So the part of that work
 * which transfers is the part about the *middle* of a tile: a reactor deck
 * should look like machinery and a hab block should look like bunks.
 *
 * The other part that transfers is the mirror, and it is the one that makes a
 * hull read as drawn rather than assembled: the far side of the keel wears the
 * same tile as the near side, flipped.
 */

export interface DeckIndex {
  pxPerFoot: number;
  deckFeet: number;
  bleedFeet: number;
  tiles: Array<{ id: string; roles: string[]; label: string; set: string }>;
}

/**
 * What kind of deck a compartment is, in the archive's own vocabulary.
 *
 * Ten roles cover two hundred and fifty-nine tiles, and every compartment kind
 * the game has answers to one of them. A kind with no row falls through to the
 * whole pool rather than to a default tile — a wrong deck that varies reads as
 * a ship, and the same wrong deck nine times reads as a bug.
 */
const ROLE: Readonly<Record<string, string>> = {
  docking: "airlock",
  cargo: "bay",
  storage: "bay",
  corridor: "service",
  maintenance: "service",
  workshop: "service",
  lifesupport: "service",
  quarantine: "service",
  hab: "quarters",
  mess: "quarters",
  cryo: "quarters",
  med: "quarters",
  hydroponics: "green",
  armory: "weapon",
  reactor: "fuel",
  engineering: "drive",
  control: "command",
  sensors: "command",
  lab: "command",
  coreaccess: "vertical",
};

/** One tile per compartment, and whether it is worn the right way round. */
export interface Deck {
  /** The baked tile's file id, or undefined where nothing was picked. */
  id?: string;
  /** True on the far side of the keel: the same tile, flipped across it. */
  flipped: boolean;
}

/**
 * A number from a string, stable across runs and machines.
 *
 * Not `game.rng`: the deck is a picture and the rng is the run. Drawing the
 * board must never consume a roll, or the same inputs would stop replaying the
 * same way the moment somebody opened a map (`.claude/CLAUDE.md`).
 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Which tile each compartment wears.
 *
 * Seeded on the hull and the compartment, so a ship looks the same every time
 * it is opened and two hulls in one voyage do not look like one another.
 * Mirrored compartments are decided once, by the one nearer the keel, and the
 * far one is told to flip.
 */
export function deckOf(
  game: RoomGame,
  index: DeckIndex | null,
  cells: ReadonlyMap<RoomId, Cell>,
  keel: number,
): Map<RoomId, Deck> {
  const out = new Map<RoomId, Deck>();
  if (index === null || index.tiles.length === 0) return out;

  const byRole = new Map<string, string[]>();
  for (const tile of index.tiles) {
    for (const role of tile.roles) {
      const pool = byRole.get(role) ?? [];
      pool.push(tile.id);
      byRole.set(role, pool);
    }
  }
  const every = index.tiles.map((t) => t.id);

  /* Who is opposite whom. A cell on the keel faces itself and is never
     flipped; everywhere else the near side decides for both. */
  const at = new Map<string, RoomId>();
  for (const [id, cell] of cells) at.set(`${String(cell.q)},${String(cell.r)}`, id);

  const decided = new Map<RoomId, string>();
  const near = [...cells.entries()].sort(
    (a, b) => Math.abs(a[1].r - keel) - Math.abs(b[1].r - keel) || a[0] - b[0],
  );

  for (const [id, cell] of near) {
    if (decided.has(id)) continue;
    const room = game.ship.rooms[id];
    const kind = typeof room?.kind === "string" ? room.kind : "";
    const pool = byRole.get(ROLE[kind] ?? "") ?? every;
    const pick = pool[Math.floor(hash(`${String(game.seed)}:${game.shipId}:${String(id)}`) * pool.length)];
    if (pick === undefined) continue;
    decided.set(id, pick);
    out.set(id, { id: pick, flipped: false });

    /* And its opposite number, wearing the same deck the other way round. */
    if (cell.r === keel) continue;
    const twin = mirror(cell, keel);
    const other = at.get(`${String(twin.q)},${String(twin.r)}`);
    if (other === undefined || decided.has(other)) continue;
    decided.set(other, pick);
    out.set(other, { id: pick, flipped: true });
  }
  return out;
}

/**
 * How much bigger than the deck the file is.
 *
 * Two squares of bleed on every side, so a hundred-foot deck arrives in a
 * hundred-and-twenty-foot picture. Drawing the whole file leaves a tenth of
 * the hexagon empty all the way round, which is the gap that made the first
 * version of this look like coasters rather than a ship.
 */
export function bleedScale(index: DeckIndex): number {
  return (index.deckFeet + 2 * index.bleedFeet) / index.deckFeet;
}
