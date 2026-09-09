import { isAlive, type Entity } from "../sim/entity.js";
import type { Rng } from "../sim/rng.js";
import { actionScrambled } from "../sim/status.js";
import { walkerOf, type DoorId, type RoomId, type Ship } from "./graph.js";
import { loudestRoom } from "./noise.js";
import { RoomDistance, type DoorFilter } from "./paths.js";
import { canSee } from "./sight.js";

/**
 * Machine behaviour on a ship — the graph twin of `sim/ai/behaviors.ts`, ported
 * profile for profile. One distance map per desire, summed with the profile's
 * coefficients, rolled downhill: everything from a plodder to a skittish pack
 * animal stays four numbers in a content table instead of a state machine.
 *
 * What the graph adds is the door rule. A room border is a decision, so which
 * machines walk through a door after the drone is part of the profile too, and
 * retreating through a door is a real move rather than a step backwards.
 */

export interface RoomWorld {
  ship: Ship;
  entities: readonly Entity[];
  player: Entity;
  rng: Rng;
  /** What arrived where, from `propagateRooms`. */
  noise: ReadonlyMap<RoomId, number>;
  /**
   * Per-turn cache of distance maps, keyed by goal. Rebuilding one map per
   * machine per turn is the hottest thing the AI does; sharing them across a
   * turn divides that cost by the machine count.
   */
  cache?: Map<string, RoomDistance>;
}

/**
 * What a machine wants to do. The turn cycle (E18) turns it into a
 * `RoomCommand`; `shoot` becomes an `attack` at range, exactly as on the grid.
 */
export type RoomIntent =
  | { kind: "attack"; target: Entity }
  | { kind: "shoot"; target: Entity }
  | { kind: "go"; door: DoorId }
  | { kind: "wait" };

/**
 * A behaviour is a pure function from world+self to an intent: no mutation of
 * the world, no randomness outside `world.rng`, so a machine's personality is
 * one word in a content table and every one of them is directly testable.
 */
export type Behaviour = (world: RoomWorld, self: Entity) => RoomIntent;

/**
 * Whether this machine walks through a door into the room the drone stands in.
 * `withAllies` needs a mate at one end of that door — either already inside, or
 * standing here with it.
 */
export type FollowRule = "always" | "never" | "withAllies";

/** A machine's personality as numbers, plus the one rule that is not a number. */
export interface RoomDesire {
  /** Pull towards the drone. Negative to keep away. */
  player: number;
  /** Pull towards other machines, for pack animals. */
  allies?: number;
  /** Pull towards the loudest room heard. */
  noise?: number;
  /** Below this HP fraction, run instead of fighting whatever the profile says. */
  fleeBelow?: number;
  /** Doors it will follow the drone through. Default: all of them. */
  follow?: FollowRule;
}

/** How far a machine hears, in doors. Noise has already faded across them. */
const NOISE_RADIUS = 3;

/** Doors this machine treats as walls. A locked door is a wall without a cutter. */
export function passableFor(ship: Ship, self: Entity): DoorFilter {
  const who = walkerOf(self);
  return (d) => ship.passable(d, who);
}

export function cachedMap(world: RoomWorld, key: string, goals: RoomId[], passable: DoorFilter): RoomDistance {
  return cached(world, key, () => RoomDistance.from(world.ship, goals, passable));
}

function cached(world: RoomWorld, key: string, make: () => RoomDistance): RoomDistance {
  const hit = world.cache?.get(key);
  if (hit) return hit;
  const map = make();
  world.cache?.set(key, map);
  return map;
}

/** Blunder through a random door. Used when stunned or confused. */
export function stagger(world: RoomWorld, self: Entity): RoomIntent {
  if (self.room === undefined) return { kind: "wait" };
  const doors = world.ship.doorsOf(self.room).filter(passableFor(world.ship, self));
  if (doors.length === 0) return { kind: "wait" };
  return { kind: "go", door: world.rng.pick(doors).id };
}

/**
 * The general-purpose behaviour: hit what is here, shoot the next room with the
 * range for it, otherwise roll downhill on the sum of the desires. A profile
 * whose `fleeBelow` has tripped runs on a flee map instead, which goes around
 * the ship rather than into the nearest dead end.
 */
export function desireDriven(profile: RoomDesire): Behaviour {
  return (world, self) => {
    if (actionScrambled(self)) return stagger(world, self);
    const here = self.room;
    if (here === undefined) return { kind: "wait" };

    const player = world.player;
    const spotted = isAlive(player) && canSee(world.ship, self, player);
    if (spotted && player.room !== undefined) rememberRoom(self, player.room);

    const hurt = self.hp / Math.max(1, self.hpMax);
    const fleeing = profile.fleeBelow !== undefined && hurt < profile.fleeBelow;

    if (spotted && !fleeing) {
      if (player.room === here) return { kind: "attack", target: player };
      if ((self.range ?? 0) >= 1) return { kind: "shoot", target: player };
    }

    // Maps are built over doors alone, so every machine of a kind shares them;
    // the chase rule is per-machine and applies to the step, not to the map.
    const passable = passableFor(world.ship, self);
    const step = stepFilter(world, self, profile.follow ?? "always");
    const goal = lastKnownRoom(self);

    if (fleeing) {
      if (goal === undefined) return { kind: "wait" };
      const threat = cachedMap(world, mapKey(goal, self), [goal], passable);
      const safety = cached(world, keyFor(self, `flee:${goal}`), () => threat.flee(passable));
      const door = safety.nextDoor(here, step);
      return door ? { kind: "go", door: door.id } : { kind: "wait" };
    }

    const parts: Array<{ map: RoomDistance; weight: number }> = [];

    if (goal !== undefined && profile.player !== 0) {
      parts.push({ map: cachedMap(world, mapKey(goal, self), [goal], passable), weight: profile.player });
    }

    if (profile.allies) {
      const mates = alliedRooms(world, self);
      if (mates.length > 0) {
        const key = keyFor(self, `allies:${mates.join(",")}`);
        parts.push({ map: cachedMap(world, key, mates, passable), weight: profile.allies });
      }
    }

    if (profile.noise) {
      const heard = loudestRoom(world.ship, world.noise, here, NOISE_RADIUS);
      if (heard !== undefined) {
        parts.push({ map: cachedMap(world, keyFor(self, `noise:${heard}`), [heard], passable), weight: profile.noise });
      }
    }

    if (parts.length === 0) return { kind: "wait" };

    const door = RoomDistance.combine(parts).nextDoor(here, step);
    if (!door) {
      // Nowhere better: drop a trail that has run out rather than stand on it.
      if (goal === here) rememberRoom(self, undefined);
      return { kind: "wait" };
    }
    return { kind: "go", door: door.id };
  };
}

/**
 * Alert hunter: walks to the room the drone was last seen or heard in and, once
 * there with nothing to show for it, searches that room for `memoryTurns` turns
 * before giving up. A given-up hunter rewrites its own `behaviour` field to
 * "brute", so from the next turn on it is a plain plodder with no memory of the
 * chase rather than a hunter waiting forever.
 */
export function hunter(memoryTurns = 8): Behaviour {
  return (world, self) => {
    if (actionScrambled(self)) return stagger(world, self);
    const here = self.room;
    if (here === undefined) return { kind: "wait" };

    const player = world.player;
    const spotted = isAlive(player) && canSee(world.ship, self, player);
    if (spotted && player.room === here) return { kind: "attack", target: player };
    if (spotted && (self.range ?? 0) >= 1) return { kind: "shoot", target: player };

    if (spotted && player.room !== undefined) {
      rememberRoom(self, player.room);
      self.searchTurns = undefined;
    } else {
      // A sound in the room it is already searching is the search itself, so it
      // never resets the countdown; anything further off is a fresh trail.
      const heard = loudestRoom(world.ship, world.noise, here, NOISE_RADIUS);
      if (heard !== undefined && heard !== here) {
        rememberRoom(self, heard);
        self.searchTurns = undefined;
      }
    }

    const goal = lastKnownRoom(self);
    if (goal === undefined) return { kind: "wait" };

    if (goal === here && !spotted) {
      const left = (self.searchTurns ?? memoryTurns) - 1;
      if (left <= 0) {
        self.behaviour = "brute";
        rememberRoom(self, undefined);
        self.searchTurns = undefined;
        return BEHAVIOURS.brute(world, self);
      }
      self.searchTurns = left;
      return { kind: "wait" };
    }

    const passable = passableFor(world.ship, self);
    const map = cachedMap(world, mapKey(goal, self), [goal], passable);
    const door = map.nextDoor(here, passable);
    return door ? { kind: "go", door: door.id } : { kind: "wait" };
  };
}

/**
 * Never moves. Fires on the drone in its own room or through an open door,
 * otherwise waits — never closes the distance, never retreats.
 */
export const turret: Behaviour = (world, self) => {
  if ((self.range ?? 0) < 1) return { kind: "wait" };
  const player = world.player;
  if (!isAlive(player) || !canSee(world.ship, self, player)) return { kind: "wait" };
  return { kind: "shoot", target: player };
};

/**
 * Never moves and never attacks. Exists purely as a body a game hook can act on
 * from the outside — the engine has no idea what a "static" machine is for.
 */
const staticBehaviour: Behaviour = () => ({ kind: "wait" });

/**
 * Doors this machine may step through this turn: passable, and not into the
 * drone's room when the profile says it does not follow.
 */
function stepFilter(world: RoomWorld, self: Entity, follow: FollowRule): DoorFilter {
  const base = passableFor(world.ship, self);
  const here = self.room;
  const drone = world.player.room;
  if (follow === "always" || here === undefined || drone === undefined || drone === here) return base;
  if (follow === "withAllies" && hasMateAt(world, self, drone)) return base;
  return (d) => base(d) && world.ship.other(d, here) !== drone;
}

/** A mate in `room` or standing here: enough for a pack animal to press on. */
function hasMateAt(world: RoomWorld, self: Entity, room: RoomId): boolean {
  return world.entities.some(
    (e) =>
      isAlive(e) &&
      e.id !== self.id &&
      e.faction === self.faction &&
      (e.room === room || e.room === self.room),
  );
}

/** Rooms holding this machine's living mates, deduplicated so the key is stable. */
function alliedRooms(world: RoomWorld, self: Entity): RoomId[] {
  const rooms = new Set<RoomId>();
  for (const e of world.entities) {
    if (!isAlive(e) || e.id === self.id || e.faction !== self.faction || e.room === undefined) continue;
    rooms.add(e.room);
  }
  return [...rooms].sort((a, b) => a - b);
}

/** Cache key for a goal map. Breachers walk a different ship to everyone else. */
export function mapKey(goal: RoomId, self: Entity): string {
  return keyFor(self, `goal:${goal}`);
}

function keyFor(self: Entity, key: string): string {
  return self.breacher === true ? `${key}:breach` : key;
}

/** The last room this machine saw its target in. Plain data, so it serialises. */
export function lastKnownRoom(self: Entity): RoomId | undefined {
  const v = self.data?.targetRoom;
  return typeof v === "number" ? v : undefined;
}

export function rememberRoom(self: Entity, room: RoomId | undefined): void {
  if (!self.data) self.data = {};
  if (room === undefined) delete self.data.targetRoom;
  else self.data.targetRoom = room;
}

/** Walks at the drone and never gives up; goes through any door to reach it. */
export const brute: Behaviour = desireDriven({ player: 1 });

/** Named presets. A machine's `behaviour` field is one of these strings. */
export const BEHAVIOURS = {
  brute,
  /** Runs once badly hurt, and never walks in after the drone. */
  coward: desireDriven({ player: 1, fleeBelow: 0.35, follow: "never" }),
  /** Dangerous in numbers, timid alone: through the door only with a mate. */
  pack: desireDriven({ player: 1, allies: 0.4, fleeBelow: 0.25, follow: "withAllies" }),
  /** Hunts by sound rather than sight. */
  stalker: desireDriven({ player: 0.6, noise: 1.2 }),
  /** Keeps its distance; for the ones that shoot. */
  skirmisher: desireDriven({ player: -0.4, fleeBelow: 0.5, follow: "never" }),
  /** Walks to the last known room, then searches it before giving up. */
  hunter: hunter(),
  /** Stationary; shoots the drone here or through an open door. */
  turret,
  /** Stationary; does nothing on its own. */
  static: staticBehaviour,
} satisfies Record<string, Behaviour>;

export type BehaviourName = keyof typeof BEHAVIOURS;

export function behaviourByName(name: string | undefined): Behaviour {
  if (name && name in BEHAVIOURS) return BEHAVIOURS[name as BehaviourName];
  return BEHAVIOURS.brute;
}
