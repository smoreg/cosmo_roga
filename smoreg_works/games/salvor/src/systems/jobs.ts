import type { RoomGame } from "@jamrog/engine";
import { t, tId } from "../i18n.js";

/**
 * Work that takes several player turns in a row, as one idea.
 *
 * Four things in this game are the same mechanic: a splice into one of the
 * ship's systems, a torch through a bulkhead, a welder through a strain, and
 * five turns at a console with the whole hull listening. Each is "stand here
 * and keep pressing the same key; anything else and you start again", and each
 * was written separately — four state shapes, four break-off lines, and only
 * one of the four that the board could draw.
 *
 * The result was the upload: a five-turn job with a countdown in the log and
 * nothing anywhere else. A player could not tell it from a verb that takes a
 * turn, which is the one thing a multi-turn job must never look like.
 *
 * This is the seam, and deliberately nothing but a seam. Each system keeps its
 * own record — where the count lives is its business, and moving those would
 * move a dozen recorded replays — and answers one question about it here. What
 * the view, the action list and the log then share is a single shape, so a
 * fifth job is a `registerJob` call and is drawn, counted and broken off like
 * the other four without anybody remembering to.
 *
 * Pure: a list of functions and a fold over it. No rng, no DOM, no state of
 * its own.
 */

/** One job, as anything that has to draw or announce it needs it. */
export interface Job {
  /**
   * The board thing being worked — a system, a door, a console — by the id the
   * board knows it under, or `undefined` for a job on the drone itself.
   *
   * This is what lets a compartment draw the pips on the right chip rather than
   * on whatever happens to be in the room.
   */
  readonly target?: number;
  /** Which of the four this is, as an id: `splice`, `cut`, `purge`, `upload`. */
  readonly what: string;
  /** Turns spent. Counted up, because that is the half a player wants. */
  readonly done: number;
  /** Turns the whole job takes. */
  readonly of: number;
}

type JobSource = (game: RoomGame) => Job | undefined;

const sources: JobSource[] = [];

/**
 * Teach the game about a kind of job.
 *
 * Called at module scope by the system that owns the work, the way
 * `registerHackTarget` is. Registering twice is harmless and registering from a
 * system that is not in this run's list simply never answers.
 */
export function registerJob(source: JobSource): void {
  sources.push(source);
}

/**
 * The job in progress, if there is one.
 *
 * One at a time is not a limitation imposed here — it falls out of the rule
 * every one of them already obeys: a turn spent on anything else drops the
 * others. So the first source that answers is the answer.
 */
export function jobNow(game: RoomGame): Job | undefined {
  for (const source of sources) {
    const job = source(game);
    if (job !== undefined && job.done > 0 && job.done < job.of) return job;
  }
  return undefined;
}

/** The job being done on one particular thing, for the chip that draws it. */
export function jobOn(game: RoomGame, target: number): Job | undefined {
  const job = jobNow(game);
  return job !== undefined && job.target === target ? job : undefined;
}

/** Testing seam: drop every registration. Never called by the game. */
export function forgetJobs(): void {
  sources.length = 0;
}

/**
 * One line for a job dropped where it stood, whichever job it was.
 *
 * There were six of these — cut, weld, defuse, ram, splice, purge — plus a
 * seventh for the console that did not even use the word, and every one of
 * them said the same thing in a slightly different way and none of them said
 * what it had cost. A player who has just lost four turns of a five turn
 * upload is owed the four, and "you step away from the console" is not it.
 *
 * `warn`, because nothing is damaged and nothing is coming: what happened is
 * that time was spent for nothing, which is exactly what the middle tone is
 * for.
 */
export function sayBrokenOff(game: RoomGame, what: string, done: number, of: number): void {
  game.log.add(
    t("log.work.break", { job: jobWord(what), done, of }),
    game.schedule.time,
    "warn",
    "log.work.break",
  );
}

/** What a job is called mid-sentence: `the cut`, `the upload`, `the splice`. */
export function jobWord(what: string): string {
  return tId("job", what, what);
}
