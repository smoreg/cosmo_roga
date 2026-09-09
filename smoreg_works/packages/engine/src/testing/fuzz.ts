import { Game, type GameConfig } from "../sim/game.js";
import { Rng } from "../sim/rng.js";
import type { Command } from "../sim/actions.js";
import { randomBot } from "./bots.js";
import type { Playable, PlayBot } from "./metrics.js";

export interface FuzzOptions {
  seeds: number[];
  steps: number;
  /** Which game to fuzz. Required: the engine has no default content. */
  game: Omit<GameConfig, "seed">;
}

/** The same, for any game: build it, and say what a random command looks like. */
export interface FuzzPlayOptions<P, C> {
  seeds: number[];
  steps: number;
  make(seed: number): P;
  bot: PlayBot<P, C>;
  /** The command that costs a turn and does nothing. Default `{ kind: "wait" }`. */
  idle?: C;
}

export interface FuzzFailure<C = Command> {
  seed: number;
  /** Number of commands `playerCommand` had already accepted when it threw. */
  step: number;
  /** `game.inputs` at the moment of the crash, for a replay. */
  inputs: C[];
  error: string;
}

const IDLE = { kind: "wait" } as const;

/**
 * Random commands through the real turn cycle, one run per seed. Anything
 * thrown is caught, recorded with enough to replay it, and the next seed
 * starts clean — one crash must not hide the rest.
 */
export function fuzzOn<C, P extends Playable<C>>(opts: FuzzPlayOptions<P, C>): Array<FuzzFailure<C>> {
  const failures: Array<FuzzFailure<C>> = [];
  const idle = (opts.idle ?? IDLE) as C;

  for (const seed of opts.seeds) {
    const game = opts.make(seed);
    const rng = new Rng(seed ^ 0x5bf03635);

    try {
      for (let i = 0; i < opts.steps && !game.isOver(); i++) {
        const cmd = opts.bot(game, rng);
        const out = game.playerCommand(cmd);
        // A refused command must still cost the bot something, or the fuzzer
        // keeps offering it the same illegal move forever.
        if (!out.ok) game.playerCommand(idle);
      }
    } catch (error) {
      failures.push({
        seed,
        step: game.inputs.length,
        inputs: [...game.inputs],
        error: String((error as Error)?.stack ?? error),
      });
    }
  }

  return failures;
}

/** The grid game's own call: a `Game` per seed, driven by the random bot. */
export function fuzz(opts: FuzzOptions): FuzzFailure[] {
  return fuzzOn({
    seeds: opts.seeds,
    steps: opts.steps,
    make: (seed) => new Game({ ...opts.game, seed }),
    bot: randomBot,
  });
}

/** One line for the console: which seed, how far in, and what broke. */
export function describeFailure<C>(f: FuzzFailure<C>): string {
  return `seed=${f.seed} step=${f.step} inputs=${f.inputs.length}: ${f.error.split("\n")[0]}`;
}
