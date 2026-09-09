import type { Entity } from "./entity.js";
import type { Level } from "./level.js";
import type { GeneratedLevel } from "./mapgen.js";

/**
 * Levels of a run, kept so the player can walk back into one.
 *
 * The engine addresses a level by an opaque string and never parses it: a
 * dungeon that only goes down uses `String(depth)`, a game with several places
 * to be uses whatever it likes. Two rules make the whole thing work:
 *
 *   - the store lives on the Game, never in a module variable, or the next
 *     `new Game` would inherit somebody else's run;
 *   - what comes back out is the same objects that went in, so a level the
 *     player returns to is the map they left, down to the tile.
 */
export type LevelId = string;

export interface StoredLevel {
  level: Level;
  /** Everyone who was standing here when the player left. Never the player. */
  entities: Entity[];
  /**
   * Deterministic per-level stream seed, derived from the run seed and the id
   * without touching `game.rng`. A system that has to re-roll something on a
   * return — what the level did while nobody watched — forks from this and
   * gets the same numbers on a replay.
   */
  scheduleSeed: number;
  /**
   * Free-form pocket for the game's own per-level state: what has been taken,
   * which doors are open. The engine writes it once (empty) and never reads it.
   */
  data: Record<string, unknown>;
  /** What mapgen produced here. Restored into `game.lastGen` on every entry. */
  gen: GeneratedLevel;
  /** Entries so far, including the one that created the level. */
  visits: number;
}

/**
 * Generic in the record, not in the world model: a graph game stores a `Ship`
 * where the dungeon stores a `Level`, and everything else about "walk back into
 * a place you have been" is the same. The default keeps every grid call site
 * spelled `new LevelStore()`.
 */
export class LevelStore<T = StoredLevel> {
  private readonly levels = new Map<LevelId, T>();

  get(id: LevelId): T | undefined {
    return this.levels.get(id);
  }

  put(id: LevelId, stored: T): void {
    this.levels.set(id, stored);
  }

  has(id: LevelId): boolean {
    return this.levels.has(id);
  }

  get size(): number {
    return this.levels.size;
  }

  /** Every id ever generated, in insertion order. */
  ids(): LevelId[] {
    return [...this.levels.keys()];
  }
}

/**
 * FNV-1a over the id, mixed with the run seed. Derived rather than drawn so
 * that adding a level costs no numbers out of `game.rng` — otherwise every
 * recorded run would shift the day a game starts naming its levels differently.
 */
export function levelSeed(runSeed: number, id: LevelId): number {
  let h = (0x811c9dc5 ^ (runSeed >>> 0)) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = (h ^ id.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
