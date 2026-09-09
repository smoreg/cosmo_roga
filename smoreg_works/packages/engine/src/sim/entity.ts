import type { Point } from "./grid.js";
import type { Status } from "./status.js";
import type { ItemInstance } from "./items.js";

export type EntityId = number;

export const enum Faction {
  Player = 0,
  Monster = 1,
  Neutral = 2,
}

/**
 * Flat struct instead of an ECS: a jam game has ~15 monster kinds, and a plain
 * object is faster to read, faster to serialise and impossible to desync.
 * Optional fields are the "components".
 */
export interface Entity {
  id: EntityId;
  name: string;
  ch: string;
  fg: string;
  pos: Point;
  faction: Faction;

  hp: number;
  hpMax: number;
  /** Damage dice: [count, sides, flat bonus] */
  damage: [number, number, number];
  defense: number;
  /** 100 = normal. 150 = acts 1.5x as often. Feeds the energy scheduler. */
  speed: number;
  fovRadius: number;

  /** Set by the scheduler; do not touch from content code. */
  energy: number;
  alive: boolean;

  /** Simple AI memory: last known player position. */
  target?: Point;
  /** Turns left searching a lost target's last known spot before giving up (hunter behaviour). */
  searchTurns?: number;
  /** Turns the entity stays confused/stunned. */
  stunned?: number;
  /** Ranged attack radius. Undefined = melee only. See MonsterKind.range. */
  range?: number;

  /**
   * Which room this stands in, for graph games (`rooms/`). A plain number
   * rather than `RoomId` so the grid model keeps knowing nothing about ships;
   * `pos` is never read while this is set.
   */
  room?: number;
  /** In cover: unseen by anything without `keen`. Any real action drops it. */
  hidden?: boolean;
  /** Rooms seen: 0 = this one only, 1 = also the next one through an open door. */
  sight?: 0 | 1;
  /** Sees hidden entities. */
  keen?: boolean;
  /** Cuts locked and sealed doors open; the caller charges the turns and the noise. */
  breacher?: boolean;

  /** Blocks movement even when dead (corpses that matter), default false. */
  blocksWhenDead?: boolean;
  /** Arbitrary per-kind tags, used by content and the twist mechanic. */
  tags?: string[];
  /** Name of an AI behaviour from sim/ai/behaviors.ts. Default "brute". */
  behaviour?: string;
  /** Active status effects. See sim/status.ts. */
  statuses?: Status[];
  /** Carried items, capped at INVENTORY_SLOTS. See sim/items.ts. */
  inventory?: ItemInstance[];
  /** Free-form bag for a twist's own per-entity state. Plain data only. */
  data?: Record<string, unknown>;
}

export function isAlive(e: Entity): boolean {
  return e.alive && e.hp > 0;
}

export function blocks(e: Entity): boolean {
  return isAlive(e) || e.blocksWhenDead === true;
}

/**
 * One run's entity numbering, held by the run rather than by this module.
 *
 * `makeEntity` is called from content code, which has no game to ask, so the
 * counter has to be ambient — but a counter shared by every game in the process
 * is not: a second run built while the first is still being played would hand
 * the first run's next machine the id its player already has, and turn order is
 * ascending id (`sim/schedule.ts`). Each game owns a sequence and makes it the
 * current one on the way into anything that can spawn, so two runs in one
 * process number their entities as if each were alone.
 */
export interface IdSeq {
  /** The id the next entity of this run gets. */
  next: number;
}

let nextId = 1;
let active: IdSeq | undefined;

export function newIdSeq(): IdSeq {
  return { next: 1 };
}

/**
 * Number the next entity 1 again, outside any run's sequence. For tests that
 * build a handful of entities without a game around them; a game takes the
 * numbering back the moment it is asked for anything.
 */
export function resetIds(): void {
  active = undefined;
  nextId = 1;
}

/** Draw further ids from `seq`, banking whatever the previous owner reached. */
export function useIds(seq: IdSeq): void {
  if (active === seq) return;
  if (active) active.next = nextId;
  active = seq;
  nextId = seq.next;
}

export function makeEntity(init: Omit<Entity, "id" | "energy" | "alive">): Entity {
  return { ...init, id: nextId++, energy: 0, alive: true };
}
