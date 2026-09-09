import { Faction, makeEntity, type Entity } from "../sim/entity.js";
import type { Point } from "../sim/grid.js";
import type { Vault } from "../sim/mapgen/vaults.js";
import type { Rng } from "../sim/rng.js";

/**
 * A monster archetype. The engine knows this shape; it never knows that a
 * "kobold" exists. Every game ships its own table of these.
 */
export interface MonsterKind {
  id: string;
  name: string;
  ch: string;
  fg: string;
  hp: number;
  damage: [number, number, number];
  defense: number;
  speed: number;
  fovRadius: number;
  /** Behaviour name from sim/ai/behaviors.ts. */
  behaviour: string;
  /** Ranged attack radius, e.g. for the "turret" behaviour. Absent = melee only. */
  range?: number;
  /** Graph games: rooms seen. 0 = its own only, 1 = also the next through an open door. */
  sight?: 0 | 1;
  /** Graph games: sees an entity hiding in cover. */
  keen?: boolean;
  /** Graph games: cuts locked and sealed doors open. */
  breacher?: boolean;
  tags?: string[];
  minDepth: number;
  maxDepth: number;
  weight: number;
}

export function spawnMonster(kind: MonsterKind, pos: Point): Entity {
  return makeEntity({
    name: kind.name,
    ch: kind.ch,
    fg: kind.fg,
    pos: { ...pos },
    faction: Faction.Monster,
    hp: kind.hp,
    hpMax: kind.hp,
    damage: kind.damage,
    defense: kind.defense,
    speed: kind.speed,
    fovRadius: kind.fovRadius,
    behaviour: kind.behaviour,
    range: kind.range,
    tags: kind.tags ? [...kind.tags] : [],
  });
}

/**
 * The same spawn for a graph game: a room instead of a point, plus the three
 * fields the grid engine has no use for. `pos` stays required on `Entity` — the
 * grid model is untouched by v3 — so it is filled with a placeholder that
 * nothing on a ship ever reads.
 */
export function spawnMonsterIn(kind: MonsterKind, room: number): Entity {
  const e = spawnMonster(kind, { x: 0, y: 0 });
  e.room = room;
  e.sight = kind.sight;
  e.keen = kind.keen;
  e.breacher = kind.breacher;
  return e;
}

/**
 * Everything a game must hand the engine to become a game.
 *
 * This is the seam that makes one repository hold several games: `sim/` depends
 * on this interface, never on a particular bestiary. Adding a game means
 * writing a new pack, not forking the engine.
 */
export interface ContentPack {
  /** Shown on the title screen and in the window title. */
  readonly name: string;
  /** How deep the dungeon goes before the player wins. */
  readonly maxDepth: number;

  /** Build the player entity at its starting position. */
  makePlayer(pos: Point): Entity;

  /** Monsters legal at this depth. Return [] for an empty floor. */
  monstersForDepth(depth: number): MonsterKind[];

  /** How many monsters this depth starts with. */
  monsterBudget(depth: number, rng: Rng): number;

  /** Optional hand-drawn rooms available to the generator. */
  vaults?: readonly Vault[];
  /** How many vaults to try to place per level. Default 1. */
  vaultsPerLevel?: number;

  /** Optional: opening line of the run's message log. */
  openingLine?: string;
  /** Optional: the line logged when the last floor is cleared. */
  winLine?: string;
  /** Optional: the line logged when the player dies. */
  deathLine?: string;
}

/**
 * The same contract for a game played on a graph of rooms. Smaller than
 * `ContentPack` because a ship has no tiles: no vaults, no spawn points, no
 * starting position — the player is put in the room holding the airlock.
 *
 * Machines are placed a room at a time rather than from one budget per level:
 * "how deep is this room" is a property of the room, so the roll belongs there.
 */
export interface RoomContentPack {
  /** Shown on the title screen and in the window title. */
  readonly name: string;
  /** Cap on the machines one ship starts with, whatever the rolls say. */
  readonly maxMonsters: number;

  /** Build the player entity. It is placed by the game, not by the pack. */
  makePlayer(): Entity;

  /** Machines legal this deep into a ship. Return [] for an empty band. */
  monstersForDepth(depth: number): MonsterKind[];

  /** Chance that a room this deep starts with one machine in it. */
  monsterChance(depth: number): number;

  /** Optional: opening line of the run's message log. */
  openingLine?: string;
  /** Optional: the line logged when the run is won. */
  winLine?: string;
  /** Optional: the line logged when the player dies. */
  deathLine?: string;
}
