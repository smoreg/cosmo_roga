import { describe, it, expect } from "vitest";
import { RoomGame, Rng, replayRooms, type RoomCommand } from "@jamrog/engine";
import { BOTS_ROOMS } from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";

/**
 * Two voyages alive in one process must not touch each other.
 *
 * `tests/replay.test.ts` proves that a recorded voyage replays bit for bit, but
 * it proves it one game at a time — and everything the project leans on says
 * "one game at a time" is not how the code is used. A bug report replayed from
 * `?seed=N` while the run that produced it is still on screen, a save restored
 * beside a live voyage, a harness that presses every offered line in a copy of
 * the run to see what it does (`docs/tasks/G55-playtest-findings.md`): all of
 * them build a second `RoomGame` before the first one is finished.
 *
 * They used to break the first one. Entity ids came from one counter in
 * `sim/entity.ts` that every constructor reset, so the second run handed the
 * first run's next machine an id the first run's player already had — and turn
 * order is ascending id (`sim/schedule.ts`). The counter belongs to the run now
 * (`IdSeq`), and this file is what says so: without it schemes A and C below
 * failed on 100 and 87 of 100 seeds.
 */

// ------------------------------------------------------------------ the world

function stateOf(game: RoomGame): unknown[] {
  const parts: unknown[] = [];
  for (const id of game.ships.ids()) {
    const stored = game.ships.get(id)!;
    const aboard = id === game.shipId;
    parts.push([
      id,
      stored.visits,
      stored.ship.rooms.map((r) => [r.id, r.kind, r.depth, r.explored, r.data]),
      stored.ship.doors.map((d) => [d.id, d.a, d.b, d.state]),
      (aboard ? game.entities : stored.entities).map((e) => [e.id, e.name, e.room, e.hp, e.alive]),
      stored.data,
    ]);
  }
  parts.push(game.shipId, game.status, game.kills, game.schedule.time, [...game.flags]);
  return parts;
}

/**
 * The world, with empty pockets dropped — the same normalisation and the same
 * reason as `replay.test.ts`: a live run has a bot reading the offers every
 * turn and a replay has nobody reading them, and several systems write their
 * record the first time they are asked. Symmetric, so it hides no real
 * difference. The log is left out: a driver that presses a refused key writes a
 * line its own replay never writes.
 */
function worldOf(game: RoomGame): string {
  return JSON.stringify(canonical(stateOf(game)));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "function") continue;
    const clean = canonical(v);
    if (isEmpty(clean)) continue;
    out[k] = clean;
  }
  return out;
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object" || value === null) return false;
  return Object.keys(value).length === 0;
}

// ----------------------------------------------------------------- the driver

interface Runner {
  game: RoomGame;
  bot: (game: RoomGame, rng: Rng) => RoomCommand;
  rng: Rng;
}

function runner(seed: number): Runner {
  return { game: newGame(seed), bot: BOTS_ROOMS.careful!(), rng: new Rng(seed ^ 0x5eed10ad) };
}

/** One command, the harness's way: a refused one costs the bot its turn. */
function press(r: Runner): void {
  if (r.game.isOver()) return;
  if (!r.game.playerCommand(r.bot(r.game, r.rng)).ok) r.game.playerCommand({ kind: "wait" });
}

/** The run and a replay of its own inputs, standing in the same world. */
function replayed(game: RoomGame): string[] {
  return [worldOf(game), worldOf(replayRooms(game.seed, [...game.inputs], GAME_CONFIG))];
}

function bothReplay(a: RoomGame, b: RoomGame): void {
  const [liveA, copyA] = replayed(a);
  expect(copyA, `seed ${a.seed} does not replay`).toBe(liveA);
  const [liveB, copyB] = replayed(b);
  expect(copyB, `seed ${b.seed} does not replay`).toBe(liveB);
}

const SEEDS = 50;
const STEPS = 120;

describe("two voyages in one process", () => {
  it("replay a voyage played interleaved with another, a bot of its own each", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const a = runner(seed);
      const b = runner(seed + 10_000);
      for (let i = 0; i < STEPS; i++) {
        press(a);
        press(b);
      }
      bothReplay(a.game, b.game);
    }
  });

  it("replay when the second voyage is born in the middle of the first", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const a = runner(seed);
      for (let i = 0; i < STEPS / 2; i++) press(a);
      const b = runner(seed + 10_000);
      for (let i = 0; i < STEPS / 2; i++) {
        press(a);
        press(b);
      }
      bothReplay(a.game, b.game);
    }
  });

  /**
   * One bot driving both, which is what a harness does by accident. The bot's
   * own memory is then nonsense — it remembers the other ship's compartments —
   * but nonsense pressed into a game still has to replay, and the game may not
   * notice that anything is sharing anything.
   */
  it("replay when one bot drives both voyages", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const bot = BOTS_ROOMS.careful!();
      const rng = new Rng(seed ^ 0x5eed10ad);
      const a: Runner = { game: newGame(seed), bot, rng };
      const b: Runner = { game: newGame(seed + 10_000), bot, rng };
      for (let i = 0; i < STEPS; i++) {
        press(a);
        press(b);
      }
      bothReplay(a.game, b.game);
    }
  });

  /** The same voyage, played alone and played beside another: one world. */
  it("a voyage plays the same whether or not another is alive beside it", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const alone = runner(seed);
      for (let i = 0; i < STEPS; i++) press(alone);

      const a = runner(seed);
      const b = runner(seed + 10_000);
      for (let i = 0; i < STEPS; i++) {
        press(a);
        press(b);
      }
      expect(worldOf(a.game), `seed ${seed} plays differently in company`).toBe(worldOf(alone.game));
      expect(a.game.inputs, `seed ${seed} is played differently in company`).toEqual(alone.game.inputs);
    }
  });

});
