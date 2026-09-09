import type { Entity } from "../sim/entity.js";
import type { DoorState } from "./graph.js";

/**
 * The contract between a game's ship catalogue and the generator (E20). Types
 * only: a game writes its data against these long before there is a generator
 * to consume them, and the generator never grows a table of its own.
 */

/** One entry of a game's room catalogue. `kind` is the string rooms carry. */
export interface RoomKindSpec {
  kind: string;
  name: string;
  /** Relative frequency. Default 1. */
  weight?: number;
  /** Rooms of this kind offer somewhere to hide. */
  cover?: boolean;
  /** Must appear exactly once on every ship. */
  required?: boolean;
  /** Never placed shallower than the spec's deep threshold. */
  deep?: boolean;
}

/**
 * A room card: the storylet of the graph model. Same preconditions, same
 * weights, same flags as `sim/mapgen/storylets.ts` — only the payload changed
 * from an ASCII vault to a list of marks, because rooms have no tiles.
 */
export interface RoomCard {
  name: string;
  /** Room kinds this card may land in. Absent = any kind. */
  kinds?: readonly string[];
  /** Precondition on the run so far. */
  when?(ctx: CardContext): boolean;
  /** Base weight. Default 1. */
  weight?: number;
  /** Situational weight, multiplying `weight`. Default 1. */
  weightWhen?(ctx: CardContext): number;
  /** Flags this card raises once placed. */
  sets?: readonly string[];
  /** Cap per ship. Absent = no cap. */
  maxPerShip?: number;
  /** What lands in the room. Strings; the game decides what they mean. */
  marks: readonly string[];
}

/** What a card may ask about the run when deciding whether it fits. */
export interface CardContext {
  flags: ReadonlySet<string>;
  player?: Entity;
  /** Which ship of the run this is, counting from 0. */
  shipIndex: number;
}

/** Everything the generator needs to build one ship. */
export interface ShipSpec {
  /** Inclusive room count range. */
  rooms: [number, number];
  maxDepth: number;
  kinds: readonly RoomKindSpec[];
  /** Kind of the room that holds the airlock. */
  entryKind: string;
  /** Relative weights per door state. The airlock is placed by rule, not weight. */
  doors: Record<Exclude<DoorState, "airlock">, number>;
  cards?: readonly RoomCard[];
  /** Cards attempted per room. Default 1. */
  cardsPerRoom?: number;
  /**
   * Build the hull on a hexagonal lattice: every compartment is a cell, and a
   * door may only join two cells that touch (`gen/hexlayout.ts`).
   *
   * The owner's rule for the honeycomb view, in his own words: «связаны только
   * соседние соты, рандомных телепортов нет, но переходов на ВСЕХ стыках сот
   * друг с другом нет». Both halves matter — a door is always between
   * neighbours, and a shared edge is not always a door. The first is what makes
   * the honeycomb drawable with no leftovers; the second is what leaves the
   * topology something to read.
   *
   * Off by default: `games/fortnight2` is frozen, and every hand-drawn fixture
   * in the suite is a graph that was never on a lattice.
   */
  lattice?: boolean;
}

/**
 * One reason a generated ship was rejected. `code` is a string rather than a
 * union so a new invariant is one line in the validator, and the detail is
 * what a failing test prints.
 */
export interface ShipProblem {
  code: string;
  detail: string;
}

/**
 * Audit name for `ShipProblem`. Kept because `validateShip` is specified as
 * returning `Problem[]`; the grid validator already owns the bare name at the
 * package entry point, so only the prefixed one is re-exported from there.
 */
export type Problem = ShipProblem;
