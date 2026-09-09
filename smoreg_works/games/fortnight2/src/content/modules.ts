/**
 * The eleven modules a drone can carry, as data.
 *
 * Every number here is design-doc.md's "Модули" table: integrity, what a
 * module gives while it is intact, and what the drone is left with once it
 * burns out. Balance passes change this file and nothing else — the twist in
 * src/twist/rig.ts reads these fields and owns none of the values.
 */

export type ModuleId =
  | "cutter"
  | "thrusters"
  | "scanner"
  | "plating"
  | "cell"
  | "emp"
  | "welder"
  | "laser"
  | "spike"
  | "emitter"
  | "baffle";

export interface ModuleKind {
  readonly id: ModuleId;
  /** Shown in the panel and in the log, always upper case. */
  readonly name: string;
  /** Full integrity: how much damage it soaks before it burns out. */
  readonly integrity: number;
  /** One-line description of what it does while intact. Panel and help text. */
  readonly passive?: string;
  /** Which key spends it. G4 implements the effects; this is the label. */
  readonly active?: string;
  /**
   * Attack dice. For a melee module the best triple in the rack becomes the
   * drone's bump damage; for the EMITTER it is what one shot rolls, read by
   * the twist and deliberately outside `derivedStats` — a shot is a command,
   * not a stat.
   */
  readonly attack?: readonly [number, number, number];
  /** How far the shot carries, in tiles. Only for a module that fires. */
  readonly range?: number;
  /** Movement speed while intact. */
  readonly speed?: number;
  /** Sight radius while intact. */
  readonly fov?: number;
  /** Starting charges for a module that spends them. */
  readonly charges?: number;
  /** Tiles taken off the noise every action of the drone makes. */
  readonly noisePenalty?: number;
  /** Tiles taken off the radius at which a machine notices the drone. */
  readonly machineFovPenalty?: number;
  /** Said once, the turn this module burns out. */
  readonly burnLine: string;
}

/**
 * What is left when nothing in the rack provides the stat.
 *
 * The speed matters more than it looks. THRUSTERS are exposed on every step and
 * the drone steps four turns out of five, so they burn in every single run the
 * harness plays — and at half speed every machine on the deck then acts twice
 * per drone turn. That is not a setback, it is the run ending slowly: careful
 * gained a whole deck (mean 3.80 -> 4.00) from this one number.
 */
export const BARE_CHASSIS = {
  speed: 80,
  fovRadius: 3,
  // Ramming, once the CUTTER is gone. At 1d1 a bare drone needed fourteen
  // swings to bring down a hauler and took fourteen swings back; the CUTTER is
  // still twice this and the choice of when to spend it is still the game.
  damage: [1, 3, 0] as readonly [number, number, number],
} as const;

export const MODULES: Record<ModuleId, ModuleKind> = {
  cutter: {
    id: "cutter", name: "CUTTER", integrity: 5,
    passive: "bump attack 1d6+1", attack: [1, 6, 1],
    burnLine: "Your CUTTER burns out. You are down to ramming.",
  },
  thrusters: {
    id: "thrusters", name: "THRUSTERS", integrity: 6,
    passive: "speed 100", speed: 100,
    burnLine: "Your THRUSTERS burn out. You crawl on manipulators.",
  },
  scanner: {
    id: "scanner", name: "SCANNER", integrity: 3,
    passive: "sight 8", active: "s", fov: 8,
    burnLine: "Your SCANNER burns out. The deck goes dark.",
  },
  /**
   * The chain's second link, and the only one every blow passes through. It and
   * the exposed module are the whole of the drone's armour: SCANNER and CELL
   * are never exposed by a bot that only walks and swings, so in 24 of 30
   * diagnostic deaths the drone died with those two at full integrity. What
   * cannot be spent cannot save the run — so the two links that can carry it.
   */
  plating: {
    id: "plating", name: "PLATING", integrity: 9,
    passive: "takes what nothing else does",
    burnLine: "Your PLATING burns out. Nothing stands between the next hit and your core.",
  },
  cell: {
    id: "cell", name: "CELL", integrity: 4,
    active: "p",
    burnLine: "Your CELL burns out. Bulkheads will have to be cut.",
  },
  emp: {
    id: "emp", name: "EMP", integrity: 3,
    active: "e", charges: 2,
    burnLine: "Your EMP burns out. The charge dies in the coil.",
  },
  welder: {
    id: "welder", name: "WELDER", integrity: 4,
    active: "w",
    burnLine: "Your WELDER burns out. No more field repairs.",
  },
  laser: {
    id: "laser", name: "LASER", integrity: 4,
    passive: "attack 2d4, replaces the cutter", attack: [2, 4, 0],
    burnLine: "Your LASER burns out. The lens goes cloudy and dead.",
  },
  /**
   * The three verbs a drone can have besides walking and swinging: open what
   * is locked, hit what is far, be missed by what is looking. None of them is
   * a bigger number — a hull (G26) is told apart by which of these it carries,
   * not by how much integrity it starts with.
   */
  spike: {
    id: "spike", name: "SPIKE", integrity: 3,
    active: "K",
    burnLine: "Your SPIKE burns out. What is locked stays locked.",
  },
  emitter: {
    id: "emitter", name: "EMITTER", integrity: 3,
    passive: "shot 1d4+1 at range 6", active: "1-6", attack: [1, 4, 1], range: 6,
    burnLine: "Your EMITTER burns out. Everything is in reach again, the hard way.",
  },
  baffle: {
    id: "baffle", name: "BAFFLE", integrity: 4,
    passive: "noise -3, machine sight -3",
    noisePenalty: 3, machineFovPenalty: 3,
    burnLine: "Your BAFFLE burns out. The deck can hear you again.",
  },
};

/**
 * However quiet the drone gets, a machine standing next to it still has eyes.
 * Without this floor a BAFFLE plus a low-sighted hauler is invisibility, and
 * the module is meant to buy distance, not immunity (design-doc.md, "Модули":
 * "минимум 2").
 */
export const MIN_MACHINE_FOV = 2;

/**
 * How much integrity a module pulled out of a wreck still has. Never full:
 * salvage keeps the rack alive, it never restores it.
 */
export const SCRAP_INTEGRITY: readonly [number, number] = [1, 3];

/** The rack the drone undocks with: five modules and one empty slot. */
export const STARTING_MODULES: readonly ModuleId[] = ["cutter", "thrusters", "scanner", "plating", "cell"];

export function moduleKind(id: ModuleId): ModuleKind {
  return MODULES[id];
}

/**
 * Onboarding by log line, said once per run (design-doc.md, "Онбординг").
 * The panel teaches the rest by moving the ◀ marker every turn.
 *
 * One line per rule, each said the turn that rule first costs the player
 * something: a hint read before it matters is a hint nobody remembers.
 */
export const HINTS = {
  /** The first time a blow lands on a module instead of the core. */
  exposure: "Hits land on whatever you last used.",
  /** The first module lost, when a slot stops being an ability. */
  burned: "A burned module is gone. Its slot is empty now.",
  /** The first turn salvage is within reach of `g`. */
  scrap: "Scrap. Press g to salvage a module into an empty slot.",
  /** The first turn the rack has no scanner: sight drops to the bare chassis. */
  blind: "Without a scanner you see three tiles. Find one.",
} as const;

/** `The security unit hits your CUTTER (2/4).` */
export function hitLine(source: string, kind: ModuleKind, left: number): string {
  return `${source} hits your ${kind.name} (${left}/${kind.integrity}).`;
}
