import { describe, it, expect, beforeAll } from "vitest";
import { RoomGame, isAlive, type Entity, type Ship, type System } from "@jamrog/engine";
import {
  describeFailure,
  fuzzOn,
  randomRoomBot,
  seedRange,
  type FuzzFailure,
} from "@jamrog/engine/testing";
import { GAME_CONFIG, newGame } from "../src/game.js";
import { TUG_ID } from "../src/content/tug.js";
import { voyageOf } from "../src/systems/voyage.js";

/**
 * A hundred and fifty thousand commands nobody would ever type, against the
 * real game.
 *
 * The bot presses station verbs out in the derelict, buys hulls it cannot
 * afford, welds doors it is standing behind, attacks entities that do not exist
 * and undocks into ships it has already sold — which is roughly what a jam
 * voter does in their first minute. Anything thrown here would reach them as a
 * dead black page, so this file is the one that decides whether the build is
 * shippable at all.
 *
 * A crash prints `seed` and the command list: `replayRooms(seed, inputs,
 * GAME_CONFIG)` reproduces it exactly and `?seed=N` opens it in the browser.
 * When one turns up, write the pair into `tests/fixtures/crash-<seed>.json` so
 * the repair has a red test to work against.
 *
 * The rest of the file is what a crash-only fuzz cannot see: a run that
 * survived five hundred commands with a negative balance, a machine standing in
 * a compartment of a ship it is not aboard, or a voyage record that no longer
 * survives being written to a save file. None of those throw. All of them are
 * broken games.
 */

const STEPS = 500;

/** One fuzzed run, kept so the invariants can read what it ended as. */
interface Run {
  seed: number;
  game: RoomGame;
}

interface Batch {
  label: string;
  seeds: number[];
  /** Every run, crashed ones included. */
  runs: Run[];
  failures: Array<FuzzFailure<unknown>>;
  /** Runs that ended in one piece. A crashed game is mid-turn; it proves nothing. */
  survivors(): Run[];
}

/**
 * A voyage that cannot go broke, as a system of the run rather than a value
 * poked in afterwards — so the batch below is still a real config and every one
 * of its runs still replays from (seed, inputs).
 *
 * Without it the random bot ends a run in about seventy commands: it loses the
 * drone, buys another, loses that, and the account empties. That is the game
 * working, and it means four fifths of the fuzz budget is never spent. With a
 * floor under the account the same bot keeps going for the whole five hundred —
 * through deaths, purchases, second sorties into a derelict it has already
 * walked, ghosts, and jumps to hulls the first batch never reaches.
 */
const FUNDING_FLOOR = 500;

const FUNDED: System<RoomGame> = {
  name: "test-funding",
  onRunStart: fund,
  afterPlayerTurn: fund,
};

function fund(game: RoomGame): void {
  const voyage = voyageOf(game);
  if (voyage.credits < FUNDING_FLOOR) voyage.credits = FUNDING_FLOOR;
}

function fuzzBatch(label: string, seeds: number[], make: (seed: number) => RoomGame): Batch {
  const runs: Run[] = [];
  const batch: Batch = {
    label,
    seeds,
    runs,
    failures: [],
    survivors: () => {
      const crashed = new Set(batch.failures.map((f) => f.seed));
      return runs.filter((r) => !crashed.has(r.seed));
    },
  };
  batch.failures = fuzzOn({
    seeds,
    steps: STEPS,
    make: (seed) => {
      const game = make(seed);
      runs.push({ seed, game });
      return game;
    },
    bot: randomRoomBot,
  });
  return batch;
}

/** The game exactly as it ships. */
const SHIPPED = fuzzBatch("shipped", seedRange(1, 200), (seed) => newGame(seed));

/** The same game with a floor under the account, so a run lasts all 500 commands. */
const FUNDED_RUNS = fuzzBatch(
  "funded",
  seedRange(900_000, 100),
  (seed) => new RoomGame({ ...GAME_CONFIG, systems: [...(GAME_CONFIG.systems ?? []), FUNDED], seed }),
);

const BATCHES = [SHIPPED, FUNDED_RUNS];

beforeAll(() => {
  // The two batches are built at import time so every test below reads the same
  // hundred and fifty thousand commands instead of paying for them again. This
  // hook only reports what they came to.
  for (const b of BATCHES) {
    const runs = b.survivors();
    const accepted = runs.reduce((n, { game }) => n + game.inputs.length, 0);
    const boarded = runs.filter(({ game }) => game.ships.ids().some((id) => id !== TUG_ID));
    console.log(
      `fuzz ${b.label.padEnd(8)} seeds=${b.seeds.length} steps=${STEPS} ` +
        `accepted=${accepted} boarded=${boarded.length} ` +
        `ended=${runs.filter(({ game }) => game.isOver()).length} crashed=${b.failures.length}`,
    );
  }
}, 300_000);

/** Every id in a ship's graph, for "this entity is somewhere that exists". */
function roomIds(ship: Ship): Set<number> {
  return new Set(ship.rooms.map((r) => r.id));
}

function describeEntity(e: Entity): string {
  return `${e.name}#${e.id} in room ${String(e.room)}`;
}

/** The run's record as it stands, read structurally so a missing one stays missing. */
function record(game: RoomGame): Record<string, unknown> | undefined {
  const raw = game.player.data?.voyage;
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
}

/**
 * A deep copy with every function-valued field dropped — what `JSON.stringify`
 * does to one, so the two sides of the round trip can be compared on their data
 * alone. Everything else is copied as it stands, `NaN` and `Infinity` included,
 * which is what makes the comparison catch them.
 *
 * Nothing in the record has behaviour to drop today, and the test below is what
 * keeps that true. The dropping stays here so that a record which grows a method
 * fails on that test — a sentence about the record — rather than here, as an
 * unreadable diff of two voyages.
 */
function asData(value: unknown): unknown {
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) return value.map(asData);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "function") continue;
    out[k] = asData(v);
  }
  return out;
}

/** Jobs on the board and jobs signed: what makes a record worth scanning. */
function charterCount(voyage: Record<string, unknown> | undefined): number {
  const lists = [voyage?.offered, voyage?.charters];
  return lists.reduce<number>((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

/**
 * Paths in the record that hold a function, with array indices collapsed, so
 * two charters on the board report as one place and not as two.
 */
function behaviourIn(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((v) => behaviourIn(v, `${path}[]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => behaviourIn(v, path === "" ? k : `${path}.${k}`));
}

describe.each(BATCHES)("the whole game under random input ($label)", (batch: Batch) => {
  it("survives every run without throwing", () => {
    for (const f of batch.failures) console.error(describeFailure(f));
    // The first stack in full: the one-liners above say which seeds, this says why.
    const detail = batch.failures.length === 0 ? "" : `\n\nfirst failure:\n${batch.failures[0]!.error}`;
    expect(
      batch.failures.map(describeFailure),
      `${batch.failures.length}/${batch.seeds.length} seeds crashed${detail}`,
    ).toEqual([]);
  }, 300_000);

  it("never lets the account go negative or become a non-number", () => {
    // Two different bugs with one symptom. A negative balance means something
    // charged without checking (`spend` returned false and the caller pressed
    // on); `NaN` means a price came out of a record that was not there, and it
    // is silent — `NaN >= price` is false, so the game simply refuses every
    // purchase for ever and the player cannot tell why.
    const broken = batch
      .survivors()
      .map(({ seed, game }) => ({ seed, credits: record(game)?.credits }))
      .filter((r) => typeof r.credits !== "number" || !Number.isFinite(r.credits) || r.credits < 0);

    expect(broken).toEqual([]);
  });

  it("leaves every entity standing in a compartment of the ship it is on", () => {
    // `roomOf` throws on an entity with no compartment, so this is half a crash
    // check — but only half: an entity whose `room` is a compartment of the
    // *previous* derelict resolves to whatever room happens to carry that id on
    // this one, and the run goes on with a machine in the wrong place.
    const offences: string[] = [];

    for (const { seed, game } of batch.survivors()) {
      const here = roomIds(game.ship);
      for (const e of game.entities) {
        if (e.room === undefined || !here.has(e.room)) {
          offences.push(`seed ${seed}: aboard ${game.shipId}, ${describeEntity(e)}`);
        }
      }
      // And the ships the run is not standing on. Their entities were stashed
      // by `travelTo`, so a wrong compartment here comes back to life the next
      // time the drone undocks into that hull.
      for (const id of game.ships.ids()) {
        const stored = game.ships.get(id);
        if (!stored || id === game.shipId) continue;
        const ids = roomIds(stored.ship);
        for (const e of stored.entities) {
          if (e.room === undefined || !ids.has(e.room)) {
            offences.push(`seed ${seed}: stored ship ${id}, ${describeEntity(e)}`);
          }
        }
      }
    }

    expect(offences.slice(0, 10)).toEqual([]);
  });

  it("keeps the voyage record something a save file could hold", () => {
    // The run's whole memory — credits, itinerary, charters, deaths, the hold —
    // lives in `player.data.voyage`, and `voyageOf` re-reads it through a type
    // guard precisely because it is meant to round-trip through JSON. A `NaN`
    // credit, an `Infinity` price, a `Set` or a cycle all survive in memory and
    // all lose their meaning on the way out, without ever throwing.
    const offences: string[] = [];

    for (const { seed, game } of batch.survivors()) {
      const voyage = record(game);
      if (voyage === undefined) {
        offences.push(`seed ${seed}: no voyage record at all`);
        continue;
      }
      let text: string;
      try {
        text = JSON.stringify(voyage);
      } catch (error) {
        offences.push(`seed ${seed}: not serialisable — ${String(error)}`);
        continue;
      }
      try {
        // Compared against a structural copy of the record, and `toEqual`
        // rather than `toStrictEqual`: a field written as `undefined` (`hull`,
        // once a drone is lost) is absent after a round trip, and absent is
        // exactly what it means. Everything else has to match, `NaN` against
        // `null` included.
        expect(JSON.parse(text)).toEqual(asData(voyage));
      } catch {
        offences.push(`seed ${seed}: changed on a JSON round trip\n${text.slice(0, 400)}`);
      }
    }

    expect(offences.slice(0, 5)).toEqual([]);
  });

  it("carries no behaviour anywhere: the record is data all the way down", () => {
    // There used to be one exception here — `Charter.done`, a predicate on a
    // record that lives in `player.data.voyage` — and it was a landmine under
    // any save file: a voyage read back from JSON would have held charters
    // that could no longer answer whether they were filled, and `payCharters`
    // asks exactly that. It is a table in `content/charters.ts` now (`doneBy`),
    // looked up by `charter.id`, so this list is empty and stays empty.
    const found = new Set<string>();
    let boards = 0;
    for (const { game } of batch.survivors()) {
      const voyage = record(game);
      for (const path of behaviourIn(voyage)) found.add(path);
      if (charterCount(voyage) > 0) boards++;
    }
    expect([...found].sort()).toEqual([]);
    // And the scan is not silently walking empty records: a voyage has a board.
    expect(boards).toBeGreaterThan(0);
  });

  it("is fuzzing the game and not an empty shell", () => {
    // Every guard above passes trivially on runs that never got anywhere.
    // What this catches is a `make` that stopped building the real thing, or a
    // refusal early in the cycle that leaves every run on the tug pressing
    // `buy`. The bar is low for the shipped batch on purpose — a random player
    // really does die that fast — and high for the funded one, which exists
    // precisely to spend its whole budget.
    const runs = batch.survivors();
    expect(batch.runs).toHaveLength(batch.seeds.length);

    const accepted = runs.reduce((n, { game }) => n + game.inputs.length, 0);
    const boarded = runs.filter(({ game }) => game.ships.ids().some((id) => id !== TUG_ID));
    expect(boarded.length / Math.max(1, runs.length)).toBeGreaterThan(0.5);
    expect(runs.filter(({ game }) => isAlive(game.player)).length).toBeGreaterThan(0);

    const floor = batch === FUNDED_RUNS ? STEPS * 0.5 : 10;
    expect(accepted / Math.max(1, runs.length)).toBeGreaterThan(floor);
  });
});
