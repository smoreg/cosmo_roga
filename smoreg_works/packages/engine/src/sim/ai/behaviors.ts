import { chebyshev, type Point } from "../grid.js";
import type { Entity } from "../entity.js";
import { isAlive } from "../entity.js";
import type { Level } from "../level.js";
import type { Rng } from "../rng.js";
import { DijkstraMap, type DijkstraOptions } from "../dijkstra.js";
import { hasLos } from "../fov.js";
import { actionScrambled, effectiveFov } from "../status.js";

export type Intent =
  | { kind: "attack"; target: Entity }
  | { kind: "shoot"; target: Entity }
  | { kind: "step"; to: Point }
  | { kind: "wait" };

export interface AiWorld {
  level: Level;
  entities: readonly Entity[];
  player: Entity;
  rng: Rng;
  /** Optional noise field; behaviours use it to investigate sounds. */
  noise?: { get(x: number, y: number): number | undefined };
  /**
   * Per-turn cache of Dijkstra maps, keyed by goal. Rebuilding one map per
   * monster per turn is the single hottest thing the AI does; sharing them
   * across a turn took the AI cost down by roughly the monster count.
   */
  cache?: Map<string, DijkstraMap>;
}

/**
 * Maps are built over walls only, so every monster can share them. Occupancy
 * is applied later, in bestStep, where it is per-actor and cheap.
 */
function terrainOnly(world: AiWorld): DijkstraOptions {
  return { passable: (x, y) => world.level.isWalkable(x, y), topology: 8 };
}

function cachedMap(world: AiWorld, key: string, goals: Point[]): DijkstraMap {
  const cache = world.cache;
  const hit = cache?.get(key);
  if (hit) return hit;
  const map = DijkstraMap.from(world.level.width, world.level.height, goals, terrainOnly(world));
  cache?.set(key, map);
  return map;
}

/**
 * A behaviour is a pure function from world+self to an intent. No mutation, no
 * randomness beyond `world.rng`, so every one of them is directly testable and
 * a monster's personality is a one-word field in its content table.
 */
export type Behaviour = (world: AiWorld, self: Entity) => Intent;

export interface DesireProfile {
  /** Pull towards the player. Negative to avoid. */
  player: number;
  /** Pull towards other monsters, for pack animals. */
  allies?: number;
  /** Pull towards the loudest heard tile. */
  noise?: number;
  /** Below this HP fraction, switch to fleeing regardless of the profile. */
  fleeBelow?: number;
}

function passableFor(world: AiWorld, self: Entity): DijkstraOptions {
  return {
    passable: (x, y) => {
      if (!world.level.isWalkable(x, y)) return false;
      const other = world.entities.find((e) => isAlive(e) && e.pos.x === x && e.pos.y === y);
      return other === undefined || other.id === self.id || other.id === world.player.id;
    },
    topology: 8,
  };
}

function adjacentEnemy(world: AiWorld, self: Entity): Entity | undefined {
  return world.entities.find(
    (e) => isAlive(e) && e.faction !== self.faction && chebyshev(e.pos, self.pos) === 1,
  );
}

function canSee(world: AiWorld, self: Entity, target: Point): boolean {
  const r = effectiveFov(self);
  return chebyshev(self.pos, target) <= r && hasLos(world.level, self.pos, target, r);
}

/** Stagger in a random direction. Used when stunned or confused. */
export function scrambled(world: AiWorld, self: Entity): Intent {
  const dirs = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  const d = world.rng.pick(dirs);
  const to = { x: self.pos.x + d.x, y: self.pos.y + d.y };
  if (!world.level.isWalkable(to.x, to.y)) return { kind: "wait" };
  return { kind: "step", to };
}

/**
 * The general-purpose behaviour: build one Dijkstra map per desire, sum them
 * with the profile's coefficients, roll downhill. Everything from a dumb brute
 * to a skittish pack hunter is a different set of four numbers.
 */
export function desireDriven(profile: DesireProfile): Behaviour {
  return (world, self) => {
    if (actionScrambled(self)) return scrambled(world, self);

    const enemy = adjacentEnemy(world, self);
    const hurt = self.hp / Math.max(1, self.hpMax);
    const fleeing = profile.fleeBelow !== undefined && hurt < profile.fleeBelow;

    if (enemy && !fleeing) return { kind: "attack", target: enemy };

    const opts = passableFor(world, self);

    if (canSee(world, self, world.player.pos)) self.target = { ...world.player.pos };
    const goal = self.target;

    if (fleeing && goal) {
      const threat = cachedMap(world, `threat:${goal.x},${goal.y}`, [goal]);
      const safety = cachedMap2(world, `flee:${goal.x},${goal.y}`, () => threat.fleeMap(terrainOnly(world)));
      const step = safety.bestStep(self.pos, opts);
      return step ? { kind: "step", to: step } : { kind: "wait" };
    }

    const parts: Array<{ map: DijkstraMap; weight: number }> = [];

    if (goal && profile.player !== 0) {
      parts.push({ map: cachedMap(world, `goal:${goal.x},${goal.y}`, [goal]), weight: profile.player });
    }

    if (profile.allies) {
      const mates = world.entities
        .filter((e) => isAlive(e) && e.id !== self.id && e.faction === self.faction)
        .map((e) => e.pos);
      if (mates.length > 0) {
        const key = `allies:${mates.map((m) => `${m.x},${m.y}`).join(";")}`;
        parts.push({ map: cachedMap(world, key, mates), weight: profile.allies });
      }
    }

    if (profile.noise && world.noise) {
      const heard = loudestHeard(world, self, 12);
      if (heard) parts.push({ map: cachedMap(world, `noise:${heard.x},${heard.y}`, [heard]), weight: profile.noise });
    }

    if (parts.length === 0) return { kind: "wait" };

    const desire = DijkstraMap.combine(parts);
    const step = desire.bestStep(self.pos, opts);
    if (!step) {
      // Nowhere better: forget a stale goal so the monster does not freeze.
      if (goal && self.pos.x === goal.x && self.pos.y === goal.y) self.target = undefined;
      return { kind: "wait" };
    }
    return { kind: "step", to: step };
  };
}

function cachedMap2(world: AiWorld, key: string, make: () => DijkstraMap): DijkstraMap {
  const hit = world.cache?.get(key);
  if (hit) return hit;
  const map = make();
  world.cache?.set(key, map);
  return map;
}

function loudestHeard(world: AiWorld, self: Entity, radius: number): Point | undefined {
  if (!world.noise) return undefined;
  let best: Point | undefined;
  let bestV = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = self.pos.x + dx;
      const y = self.pos.y + dy;
      const v = world.noise.get(x, y) ?? 0;
      if (v > bestV) {
        bestV = v;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Alert hunter: walks to the target's last known position — seen or heard —
 * and, once there with nothing to show for it, spends `memoryTurns` searching
 * the neighbourhood before giving up. A given-up hunter rewrites its own
 * `behaviour` field to "brute", so from the next turn on it is a plain plodder
 * with no memory of the chase, not a hunter stuck waiting forever.
 */
export function hunter(memoryTurns = 8): Behaviour {
  return (world, self) => {
    if (actionScrambled(self)) return scrambled(world, self);

    const enemy = adjacentEnemy(world, self);
    if (enemy) return { kind: "attack", target: enemy };

    const spotted = canSee(world, self, world.player.pos);
    if (spotted) {
      self.target = { ...world.player.pos };
      self.searchTurns = undefined;
    } else {
      const heard = loudestHeard(world, self, 12);
      if (heard) {
        self.target = heard;
        self.searchTurns = undefined;
      }
    }

    const goal = self.target;
    if (!goal) return { kind: "wait" };

    const atGoal = self.pos.x === goal.x && self.pos.y === goal.y;
    if (atGoal && !spotted) {
      const left = (self.searchTurns ?? memoryTurns) - 1;
      if (left <= 0) {
        // Gives up: forgets the trail and becomes a plain brute from here on.
        self.behaviour = "brute";
        self.target = undefined;
        self.searchTurns = undefined;
        return BEHAVIOURS.brute(world, self);
      }
      self.searchTurns = left;
      return scrambled(world, self);
    }

    const opts = passableFor(world, self);
    const map = cachedMap(world, `goal:${goal.x},${goal.y}`, [goal]);
    const step = map.bestStep(self.pos, opts);
    return step ? { kind: "step", to: step } : { kind: "wait" };
  };
}

/**
 * Never moves. Fires on the player when in range and in a straight line,
 * otherwise waits — never closes the distance, never retreats.
 */
export const turret: Behaviour = (world, self) => {
  const range = self.range ?? 0;
  if (range <= 0) return { kind: "wait" };
  if (chebyshev(self.pos, world.player.pos) > range) return { kind: "wait" };
  if (!hasLos(world.level, self.pos, world.player.pos, range)) return { kind: "wait" };
  return { kind: "shoot", target: world.player };
};

/**
 * Never moves and never attacks. Exists purely as a body a game hook can act
 * on from the outside (see `afterActorTurn`) — the engine has no idea what a
 * "static" monster is for.
 */
const staticBehaviour: Behaviour = () => ({ kind: "wait" });

/** Named presets. A monster's `behaviour` field is one of these strings. */
export const BEHAVIOURS = {
  /** Walks straight at the player and never gives up. */
  brute: desireDriven({ player: 1 }),
  /** Runs once badly hurt. */
  coward: desireDriven({ player: 1, fleeBelow: 0.35 }),
  /** Stays with the group; dangerous in numbers, timid alone. */
  pack: desireDriven({ player: 1, allies: 0.4, fleeBelow: 0.25 }),
  /** Hunts by sound rather than sight. */
  stalker: desireDriven({ player: 0.6, noise: 1.2 }),
  /** Keeps its distance; for casters and archers. */
  skirmisher: desireDriven({ player: -0.4, fleeBelow: 0.5 }),
  /** Walks to the last known player position, then searches before giving up. */
  hunter: hunter(),
  /** Stationary; shoots the player in range and line of sight. */
  turret,
  /** Stationary; does nothing on its own. */
  static: staticBehaviour,
} satisfies Record<string, Behaviour>;

export type BehaviourName = keyof typeof BEHAVIOURS;

export function behaviourByName(name: string | undefined): Behaviour {
  if (name && name in BEHAVIOURS) return BEHAVIOURS[name as BehaviourName];
  return BEHAVIOURS.brute;
}
