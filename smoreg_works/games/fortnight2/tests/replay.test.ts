import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Rng, SAVE_VERSION, decodeRun, encodeRun, replay, type Command, type Game } from "@jamrog/engine";
import { BOTS } from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { rigOf } from "../src/twist/rig.js";

/**
 * Three whole runs, kept on disk, replayed on every test run.
 *
 * A saved game here is (seed, commands) and nothing else, so replaying one is
 * the strongest determinism check the repo can make: if any later edit reaches
 * for `Math.random`, for wall-clock time, or for iteration order that is not
 * stable, one of these three ends somewhere else and the diff says exactly
 * which turn it happened on.
 *
 * The fixtures are recordings of the `careful` bot, but only its *output* is
 * stored — a flat list of commands — so nothing here depends on how the bot
 * chooses, and a later change to the bot leaves the fixtures alone.
 *
 * WHEN A RULE CHANGES (module numbers, monster stats, the alert system), these
 * runs legitimately end differently. Re-record all three with:
 *
 *     RECORD=1 npx vitest run games/fortnight2/tests/replay.test.ts
 *
 * and commit the new JSON. `codeSha` in each file says which commit produced
 * it, so a mismatch that predates the last balance change is explainable and
 * one that does not is a bug. Never edit an `expect` block by hand.
 */

const SEEDS = [20260901, 20260908, 20260915];
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
/** Long enough for a `careful` run to end on its own; a cap, not a target. */
const MAX_STEPS = 3000;

/** What the run came to. Everything here is a pure function of (seed, inputs). */
interface RunOutcome {
  status: string;
  depth: number;
  time: number;
  kills: number;
  /** The whole rack: which modules survived, which burned, and where. */
  rig: unknown;
}

interface ReplayFixture {
  version: number;
  seed: number;
  inputs: Command[];
  expect: RunOutcome;
  /** Commit the recording was made at. See the header. */
  codeSha: string;
}

function outcomeOf(game: Game): RunOutcome {
  return {
    status: game.status,
    depth: game.depth,
    time: game.schedule.time,
    kills: game.kills,
    rig: JSON.parse(JSON.stringify(rigOf(game.player) ?? null)),
  };
}

/** Play one run with the competent bot and keep the commands it landed. */
function play(seed: number): Game {
  const game = newGame(seed);
  const bot = BOTS.careful!();
  const rng = new Rng(seed ^ 0x5eed10ad);
  for (let i = 0; i < MAX_STEPS && !game.isOver(); i++) {
    // A refused command costs the bot a turn instead of looping forever on it,
    // exactly as the fuzz harness does.
    if (!game.playerCommand(bot(game, rng)).ok) game.playerCommand({ kind: "wait" });
  }
  return game;
}

function fixturePath(seed: number): string {
  return join(FIXTURES, `replay-${seed}.json`);
}

function codeSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function recordFixture(seed: number): void {
  const live = play(seed);
  const inputs = [...live.inputs];
  // The recording is only worth keeping if it reproduces itself: a live run
  // and its replay that disagree mean the sim reads something it should not.
  const replayed = replay(seed, inputs, GAME_CONFIG);
  const [a, b] = [outcomeOf(live), outcomeOf(replayed)];
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`seed ${seed}: the live run and its replay disagree\nlive:   ${JSON.stringify(a)}\nreplay: ${JSON.stringify(b)}`);
  }

  const fixture: ReplayFixture = { version: SAVE_VERSION, seed, inputs, expect: a, codeSha: codeSha() };
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(fixturePath(seed), `${JSON.stringify(fixture, null, 2)}\n`);
}

function loadFixture(seed: number): ReplayFixture {
  return JSON.parse(readFileSync(fixturePath(seed), "utf8")) as ReplayFixture;
}

describe("recorded runs", () => {
  if (process.env.RECORD === "1") {
    it("re-records all three fixtures", () => {
      for (const seed of SEEDS) recordFixture(seed);
      expect(SEEDS.map(loadFixture).map((f) => f.inputs.length > 0)).toEqual([true, true, true]);
    }, 120_000);
    return;
  }

  for (const seed of SEEDS) {
    it(`replays seed ${seed} to the same ending`, () => {
      const fixture = loadFixture(seed);
      expect(fixture.seed, "fixture is for another seed").toBe(seed);

      // Through the save format the game itself uses: a fixture that no longer
      // decodes is a save file that no longer loads, and players have those.
      const decoded = decodeRun(encodeRun({ version: fixture.version, seed, inputs: fixture.inputs }));
      expect(decoded.ok, decoded.reason ?? "").toBe(true);

      const game = replay(seed, decoded.record!.inputs, GAME_CONFIG);
      expect(outcomeOf(game)).toEqual(fixture.expect);
    }, 60_000);
  }

  it("two replays of the same recording are the same run", () => {
    const fixture = loadFixture(SEEDS[0]!);
    const once = replay(fixture.seed, fixture.inputs, GAME_CONFIG);
    const twice = replay(fixture.seed, fixture.inputs, GAME_CONFIG);
    expect(outcomeOf(twice)).toEqual(outcomeOf(once));
    expect(twice.player.pos).toEqual(once.player.pos);
    expect(twice.log.lines.map((l) => l.text)).toEqual(once.log.lines.map((l) => l.text));
  }, 60_000);
});
