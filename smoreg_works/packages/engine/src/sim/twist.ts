import type { Entity } from "./entity.js";
import type { Command, Outcome } from "./actions.js";
import type { RoomCommand } from "../rooms/actions.js";
import type { Game, GameStatus } from "./game.js";
import type { Rng } from "./rng.js";
import type { MessageLog } from "./log.js";
import type { Schedule } from "./schedule.js";

/**
 * Extension point for game mechanics that hook into the turn cycle.
 *
 * Deliberately empty before the jam: the rules allow reusable code up front but
 * require game-specific content to be made inside the two weeks. This file is
 * the seam, not the mechanic — on day 1 of the jam the twist gets exactly one
 * implementation and nothing else in sim/ needs to change.
 *
 * A Game takes a list of these (`twist` plus `systems`), the way prism's
 * SystemManager wraps every action with before/after callbacks from any number
 * of systems. The main mechanic is just the first one in the list; smaller
 * independent mechanics — a hunger clock, reinforcements, a scoring rule — go
 * alongside it instead of being welded into game.ts.
 *
 * Every hook is optional. All of them run inside the turn cycle, so they must
 * stay deterministic: use `game.rng`, never Math.random, never Date.now.
 */
/**
 * How the player left a level: further in, back out through the airlock, or by
 * a route the game invented for itself (a ship jumping to the next derelict).
 */
export type LeaveReason = "stairs" | "airlock" | "custom";

/**
 * The part of a game every system may count on, whichever world model it runs:
 * the grid `Game` and the graph `RoomGame` have different levels, different
 * commands and no common ancestor, but they keep the same turn cycle around
 * them. Systems are written against the concrete host (`Twist<RoomGame>`); this
 * is what the engine itself needs when it does not care which one it has.
 */
export interface TurnHost {
  readonly rng: Rng;
  readonly log: MessageLog;
  readonly schedule: Schedule;
  /** Twist first, then the extra systems. Hooks run in this order. */
  readonly systems: readonly Twist<TurnHost>[];
  player: Entity;
  entities: Entity[];
  status: GameStatus;
  kills: number;
  /** Every player command, in order. Replaying it against the seed is the run. */
  readonly inputs: readonly unknown[];
  readonly flags: Set<string>;
  finish(status: "won" | "dead", line: string): void;
}

/**
 * The command a host records — `Command` on the grid, `RoomCommand` on a ship.
 * Read off `inputs` rather than passed as a second type parameter, so a system
 * is spelled `Twist<RoomGame>` and gets the right command union for free.
 */
export type CommandOf<G> = G extends { readonly inputs: ReadonlyArray<infer C> } ? C : never;

/**
 * One line of the numbered action list: what can be done here, whether it can
 * be done now, and the command that does it.
 */
export interface ActionOffer<C = Command | RoomCommand> {
  label: string;
  cmd: C;
  enabled: boolean;
  /** Why it is greyed out. Shown next to a disabled offer. */
  why?: string;
}

export interface Twist<G extends TurnHost = Game> {
  readonly name: string;

  /**
   * "I decide where a departure leads and when the run ends."
   *
   * With one of these in the list the engine stops walking to the next depth
   * on its own and stops declaring victory at the bottom: `beforeLevelLeave`
   * is the system's cue to call `travelTo` or `finish`. Without one, a run is
   * the plain dungeon it always was.
   */
  readonly claimsOutcome?: boolean;

  /** Called once when a run starts. */
  onRunStart?(game: G): void;

  /** Called after a new level is generated and populated. */
  onLevelEnter?(game: G, depth: number): void;

  /**
   * Called on the level being left, before the next one is generated. The last
   * chance to read or clear anything tied to `depth` — a pressure gauge, a
   * trail of wreckage — while it still exists.
   *
   * `reason` says which exit was taken. A system that claims the outcome does
   * the whole transition from here: nothing happens after it returns.
   */
  beforeLevelLeave?(game: G, depth: number, reason: LeaveReason): void;

  /** Called after the player's command resolved and cost its energy. */
  afterPlayerTurn?(game: G, cmd: CommandOf<G>): void;

  /** Called after each non-player actor acted. */
  afterActorTurn?(game: G, actor: Entity): void;

  /**
   * Handle a command the engine does not know (`use`, `interact`). Return
   * undefined to say "not mine"; the next system is asked. If nobody claims
   * it, the command is refused and the turn is not spent.
   */
  performCommand?(game: G, actor: Entity, cmd: CommandOf<G>): Outcome | undefined;

  /**
   * What can be done right now, for a UI that lists actions by number.
   * Advisory; refused offers cost no turn.
   *
   * The engine can only ever offer its own verbs — walk through that door, hit
   * that machine. Everything a game invents lives behind `act`, so the list a
   * player reads is mostly this hook: the system that owns a verb is the only
   * one that knows whether it is worth a turn here, and what to call it.
   */
  offerActions?(game: G): Array<ActionOffer<CommandOf<G>>>;

  /** Called when any entity dies, before it is reaped. */
  onDeath?(game: G, victim: Entity): void;

  /**
   * Intercept damage before it reaches hit points. Return how much still goes
   * to `victim.hp`. Runs for every system in order; each sees what the
   * previous one let through. Absent = everything goes through.
   */
  onDamage?(game: G, victim: Entity, amount: number, source: Entity | undefined): number;

  /**
   * Extra glyphs to draw on top of the map, e.g. the echo's trail.
   * UI-facing but data-only, so sim stays DOM-free.
   *
   * `remembered: true` asks the renderer to keep drawing the glyph, dimmed, on
   * a tile the player has explored but cannot currently see — for things worth
   * walking back to.
   */
  overlayGlyphs?(game: G): Array<{ x: number; y: number; ch: string; fg: string; remembered?: boolean }>;

  /**
   * What a bot cannot work out on its own: which of the game's own verbs are
   * worth a turn right now.
   *
   * The engine has no idea what `interact` or `use` do — that is the point of
   * `performCommand` — so a testing bot either never presses those keys or
   * presses them at random, and the balance harness then measures a player who
   * ignores half the game. This hook is the game telling the bot "yes, this
   * one, now": `interactWorthIt` for `interact`, `useSlots` for slots worth
   * spending, best first.
   *
   * Advisory, and read only by `testing/bots.ts`. Nothing in the turn cycle may
   * depend on it, or the bots would be measuring a different game from the one
   * a human plays.
   */
  botHints?(game: G): { interactWorthIt: boolean; useSlots: number[] };

  /** One line for the sidebar: the twist's current state, if it has one. */
  statusLine?(game: G): string | undefined;

  /**
   * Several sidebar lines, drawn in system order. Preferred over statusLine
   * once the twist has real state to show — a rack of modules, a pressure
   * gauge — rather than one summary string.
   */
  panelLines?(game: G): Array<{ text: string; fg?: string }>;
}

/** No twist. Replace on day 1 of the jam. Host-agnostic: it hooks nothing. */
export const NO_TWIST: Twist<TurnHost> = { name: "none" };

/** A system is the same shape; the name distinguishes intent, not structure. */
export type System<G extends TurnHost = Game> = Twist<G>;
