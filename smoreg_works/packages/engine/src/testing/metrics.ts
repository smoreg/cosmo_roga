import { Game, type GameConfig, type GameStatus } from "../sim/game.js";
import { Rng } from "../sim/rng.js";
import type { Entity } from "../sim/entity.js";
import type { Outcome } from "../sim/actions.js";
import type { Schedule } from "../sim/schedule.js";
import type { BotFactory } from "./bots.js";

/**
 * What the harness needs of a game: press a command, say whether the run is
 * over, and carry the counters a run is scored by. Both world models satisfy
 * it — the grid `Game` and the graph `RoomGame` — so bots, batches and the
 * fuzzer are written once and the game they play is a parameter.
 */
export interface Playable<C = unknown> {
  readonly status: GameStatus;
  readonly inputs: readonly C[];
  readonly schedule: Schedule;
  readonly player: Entity;
  readonly kills: number;
  playerCommand(cmd: C): Outcome;
  isOver(): boolean;

  /**
   * How far this run got, in whatever unit the game scores itself by: depth on
   * the grid, compartments cleared or ships sold on a voyage. Optional because
   * a world model is not obliged to have an opinion — `PlayOptions.progress`
   * answers for the ones that do not.
   */
  progress?(): number;
  /**
   * Whatever else the game counts, straight into `RunResult.extra`: credits,
   * hulls lost, doors cut. The harness never reads a key, it only carries them
   * out to whoever is reading the batch.
   */
  metrics?(): Record<string, number>;
}

/** A bot for a particular game: same shape as `Bot`, without naming `Game`. */
export type PlayBot<P, C> = (game: P, rng: Rng) => C;

export interface PlayOptions<P, C> {
  maxSteps?: number;
  /** Build the run for this seed. */
  make(seed: number): P;
  /**
   * How far the run got, for `RunResult.progress`. Overrides the game's own
   * `progress()` when both exist — the batch knows what it is measuring, the
   * game only knows what it can count. Neither = 0.
   */
  progress?(game: P): number;
  /** The same, for `RunResult.extra`. Overrides `Playable.metrics()`. */
  metrics?(game: P): Record<string, number>;
  /** The command that costs a turn and does nothing. Default `{ kind: "wait" }`. */
  idle?: C;
}

/** Both command unions spell doing nothing the same way. */
const IDLE = { kind: "wait" } as const;

export interface RunResult {
  seed: number;
  status: "won" | "dead" | "stuck";
  /** How far the run got, in the game's own unit. */
  progress: number;
  /** The grid game's name for `progress`, and the same number. */
  depth: number;
  turns: number;
  kills: number;
  hpLeft: number;
  steps: number;
  /** What the game counts for itself. Empty when it counts nothing. */
  extra: Record<string, number>;
}

export interface BatchSummary {
  bot: string;
  runs: number;
  wins: number;
  deaths: number;
  stuck: number;
  winRate: number;
  /** Median of `RunResult.progress` — the one number a balance pass is read by. */
  medianProgress: number;
  medianDepth: number;
  meanDepth: number;
  medianTurns: number;
  depthHistogram: Record<number, number>;
}

export interface RunOptions {
  maxSteps?: number;
  /** Which game to play. Required: the engine has no default content. */
  game: Omit<GameConfig, "seed">;
}

/** Play one full run with a bot and report how it ended. */
export function runBotOn<C, P extends Playable<C>>(
  factory: () => PlayBot<P, C>,
  seed: number,
  opts: PlayOptions<P, C>,
): RunResult {
  const maxSteps = opts.maxSteps ?? 4000;
  const bot = factory();
  const game = opts.make(seed);
  const idle = (opts.idle ?? IDLE) as C;
  const rng = new Rng(seed ^ 0x5bf03635);
  let steps = 0;

  while (!game.isOver() && steps < maxSteps) {
    const cmd = bot(game, rng);
    const out = game.playerCommand(cmd);
    // A refused command must still cost the bot something, or an illegal move
    // it keeps choosing turns into an infinite loop that looks like a hang.
    if (!out.ok) game.playerCommand(idle);
    steps++;
  }

  const status = game.status === "won" ? "won" : game.status === "dead" ? "dead" : "stuck";
  const progress = opts.progress?.(game) ?? game.progress?.() ?? 0;
  return {
    seed,
    status,
    progress,
    depth: progress,
    turns: game.schedule.time,
    kills: game.kills,
    hpLeft: game.player.hp,
    steps,
    extra: opts.metrics?.(game) ?? game.metrics?.() ?? {},
  };
}

/** The grid game's own call: build a `Game` from a config and score by depth. */
export function runBot(factory: BotFactory, seed: number, opts: RunOptions): RunResult {
  return runBotOn(factory, seed, {
    maxSteps: opts.maxSteps,
    make: (s) => new Game({ ...opts.game, seed: s }),
    progress: (g) => g.depth,
  });
}

/**
 * The balance harness: run a bot across many seeds and reduce to numbers a
 * human can act on. Day 12 of the jam is "run this, read the median depth,
 * change one number in content/, run it again".
 */
export function runBatchOn<C, P extends Playable<C>>(
  name: string,
  factory: () => PlayBot<P, C>,
  seeds: number[],
  opts: PlayOptions<P, C>,
): BatchSummary {
  return summarise(name, seeds.map((s) => runBotOn(factory, s, opts)));
}

export function runBatch(name: string, factory: BotFactory, seeds: number[], opts: RunOptions): BatchSummary {
  return summarise(name, seeds.map((s) => runBot(factory, s, opts)));
}

function summarise(name: string, results: RunResult[]): BatchSummary {
  const depths = results.map((r) => r.progress).sort((a, b) => a - b);
  const turns = results.map((r) => r.turns).sort((a, b) => a - b);

  const histogram: Record<number, number> = {};
  for (const r of results) histogram[r.progress] = (histogram[r.progress] ?? 0) + 1;

  const wins = results.filter((r) => r.status === "won").length;
  return {
    bot: name,
    runs: results.length,
    wins,
    deaths: results.filter((r) => r.status === "dead").length,
    stuck: results.filter((r) => r.status === "stuck").length,
    winRate: results.length === 0 ? 0 : wins / results.length,
    medianProgress: median(depths),
    medianDepth: median(depths),
    meanDepth: depths.reduce((a, b) => a + b, 0) / Math.max(1, depths.length),
    medianTurns: median(turns),
    depthHistogram: histogram,
  };
}

/** One line per bot, for a console table during balance passes. */
export function formatSummary(s: BatchSummary): string {
  const hist = Object.keys(s.depthHistogram)
    .map(Number)
    .sort((a, b) => a - b)
    .map((d) => `${d}:${s.depthHistogram[d]}`)
    .join(" ");
  return (
    `${s.bot.padEnd(8)} runs=${String(s.runs).padStart(3)} ` +
    `win=${(s.winRate * 100).toFixed(0).padStart(3)}% ` +
    `medProgress=${s.medianProgress.toFixed(1)} medTurns=${String(s.medianTurns).padStart(4)} ` +
    `stuck=${s.stuck} | ${hist}`
  );
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function seedRange(from: number, count: number): number[] {
  return Array.from({ length: count }, (_v, i) => from + i);
}
