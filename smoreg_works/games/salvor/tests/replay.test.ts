import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RoomDistance, RoomGame, Rng, SAVE_VERSION, decodeRun, encodeRun, isAlive, replayRooms, walkerOf, type DoorFilter, type RoomCommand, type RoomGameConfig, type RoomId, type System } from "@jamrog/engine";
import { BOTS_ROOMS } from "@jamrog/engine/testing";
import { GAME_CONFIG } from "../src/game.js";
import { FREIGHTER } from "../src/content/derelicts.js";
import { TUG_ID, tugRoomKind } from "../src/content/tug.js";
import { gatedOffers } from "../src/systems/tug.js";

import { systemsAboard } from "../src/systems/ship.js";
import { voyageOf } from "../src/systems/voyage.js";
import { rigOf } from "../src/twist/rig.js";

/**
 * Three whole voyages, kept on disk, replayed on every test run.
 *
 * A voyage here is (seed, commands) and nothing else, so replaying one is the
 * strongest determinism check this package can make: if any later edit reaches
 * for `Math.random`, for wall-clock time, or for an iteration order that is not
 * stable, one of these three ends somewhere else and the diff says on which
 * turn. What is compared is not a score but a fingerprint of the whole run —
 * every stored hull's graph, every door state, what lies in every compartment,
 * every machine and ghost aboard, the voyage record and every line of the log.
 *
 * The three are chosen for what outlives a single sortie, which is what this
 * file exists for (`docs/tasks/G33-robustness-v2.md`):
 *
 *   loss   a drone dies, another is bought, the voyage flies on and ends broke
 *   rival  the other tug takes the hull out from under the drone
 *   sale   three systems raised, the hull sold, the voyage won
 *
 * The fixtures are recordings of a bot and a scripted player, but only the
 * *output* is stored — a flat list of commands — so nothing here depends on how
 * either chooses, and a later change to the bots leaves the fixtures alone.
 *
 * WHEN A RULE CHANGES (module numbers, machine stats, the alert, prices), these
 * runs legitimately end differently. Re-record all three with:
 *
 *     RECORD=1 npx vitest run games/salvor/tests/replay.test.ts
 *
 * and commit the new JSON. `codeSha` in each file says which commit produced
 * it, so a mismatch that predates the last balance pass is explainable and one
 * that does not is a bug. Never edit an `expect` block by hand.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

// ------------------------------------------------------------------ configs

/**
 * A voyage of exactly one hull, as a system of its own — the idiom
 * `tests/voyage.test.ts` uses: `replayRooms` builds its own game, so an
 * itinerary arranged by hand between two commands would not replay.
 */
const ONE_HULL: System<RoomGame> = {
  name: "test-itinerary",
  onRunStart(game) {
    voyageOf(game).derelicts = [FREIGHTER];
  },
};

type ConfigName = "shipped" | "one-hull";

const CONFIGS: Record<ConfigName, Omit<RoomGameConfig, "seed">> = {
  /** The game exactly as `newGame` builds it for the browser. */
  shipped: GAME_CONFIG,
  /**
   * The same stack with a one-hull itinerary, so that selling the freighter is
   * the end of the voyage and the recording covers the win as well as the sale.
   *
   * It used to be a hand-drawn four-room hull with the alert left out, because
   * a sale was out of reach on anything else: every system raised is `+2` on
   * the gauge (design-doc.md, "Обезвредить корабль") and the hunter came at 3,
   * so the ENFORCER arrived before the second system was up and took the rack
   * apart. Over 600 seeds nothing — bot or scripted — ever raised a third
   * system, on a generated hull or on a hull with the machines taken out of it
   * altogether.
   *
   * G30 moved the hunter to 4, which leaves the drone the first two systems and
   * sends it for the third, and the fixture is a generated freighter under the
   * whole shipped stack again: 6 of the first 60 seeds now neutralise one in a
   * single sortie. The itinerary is the only thing held still, and it is held
   * still because "sold" and "won" are two different code paths and this
   * recording is the one that walks both.
   */
  "one-hull": { ...GAME_CONFIG, systems: [...GAME_CONFIG.systems!, ONE_HULL] },
};

// ------------------------------------------------------------------ drivers

function offerFor(game: RoomGame, verb: string): RoomCommand | undefined {
  return gatedOffers(game).find((o) => o.enabled && o.cmd.kind === "act" && o.cmd.verb === verb)?.cmd;
}

/** Where this drone may walk, cutting included. Never out through the airlock. */
function route(game: RoomGame): DoorFilter {
  const who = walkerOf(game.player);
  return (d) => d.state !== "airlock" && game.ship.passable(d, who);
}

/** One step towards `goal`. False when the way is shut or the command is refused. */
function step(game: RoomGame, goal: RoomId): boolean {
  const walk = route(game);
  const door = RoomDistance.from(game.ship, [goal], walk).nextDoor(game.roomOf(game.player).id, walk);
  return door !== undefined && game.playerCommand({ kind: "go", door: door.id }).ok;
}

/** Stand in the DOCK: where a hull is bought and where the clamps let go. */
function atDock(game: RoomGame): boolean {
  const dock = game.ship.rooms.find((r) => tugRoomKind(r.kind) === "dock");
  if (!dock) return false;
  for (let i = 0; i < 8 && game.roomOf(game.player).id !== dock.id; i++) {
    if (!step(game, dock.id)) return false;
  }
  return game.roomOf(game.player).id === dock.id;
}

/** The compartment the airlock hangs off. */
function airlockRoom(game: RoomGame): RoomId | undefined {
  return game.ship.doors.find((d) => d.state === "airlock")?.a;
}

/** Buy a hull if there is none, then cast off. */
function undock(game: RoomGame): boolean {
  if (!atDock(game)) return false;
  if (voyageOf(game).hull === undefined) {
    const buy = offerFor(game, "buy");
    if (!buy || !game.playerCommand(buy).ok) return false;
  }
  const cmd = offerFor(game, "undock");
  return cmd !== undefined && game.playerCommand(cmd).ok && game.shipId !== TUG_ID;
}

/** The competent player, as the harness plays it. */
function playCareful(game: RoomGame, seed: number, steps: number): void {
  const bot = BOTS_ROOMS.careful!();
  const rng = new Rng(seed ^ 0x5eed10ad);
  for (let i = 0; i < steps && !game.isOver(); i++) {
    // A refused command costs the bot a turn instead of looping on it, exactly
    // as the fuzz harness does.
    if (!game.playerCommand(bot(game, rng)).ok) game.playerCommand({ kind: "wait" });
  }
}

/**
 * Cycle the airlock a few times and then play it out. Every entry is a sortie
 * the other tug's drone has been working through, so four of them hand it the
 * hull (design-doc.md, "Конкурент": `+1` between sorties).
 */
function playRival(game: RoomGame, seed: number): void {
  for (let i = 0; i < 4 && !game.isOver(); i++) {
    if (!undock(game)) break;
    if (!game.playerCommand({ kind: "leave" }).ok) break;
  }
  playCareful(game, seed, 400);
}

/**
 * Raise all three systems and walk out with them: the play the whole economy
 * is built around. Spends whatever the compartment offers on the way — the
 * body in the docking bay is where the terminal's keycard comes from.
 */
function playSale(game: RoomGame, _seed: number): void {
  const spent = new Map<string, Set<string>>();

  for (let n = 0; n < 400 && !game.isOver(); n++) {
    if (game.shipId === TUG_ID) {
      if (!undock(game)) return;
      continue;
    }

    const here = game.roomOf(game.player).id;
    const foe = game
      .entitiesIn(here)
      .find((e) => e.id !== game.player.id && isAlive(e) && e.faction !== game.player.faction);
    if (foe) {
      if (!game.playerCommand({ kind: "attack", target: foe.id }).ok) {
        game.playerCommand({ kind: "wait" });
      }
      continue;
    }

    const down = systemsAboard(game).filter((s) => !s.online);
    const lock = airlockRoom(game);
    if (down.length === 0 && lock !== undefined) {
      if (here === lock) {
        game.playerCommand({ kind: "leave" });
        continue;
      }
      if (step(game, lock)) continue;
    }

    // Anything the compartment offers that is not a bulkhead and not the work
    // itself: a body searched, a wreck stripped, a crate prised open.
    const doors = new Set(game.ship.doorsOf(here).map((d) => d.id));
    const key = `${game.shipId}/${here}`;
    const done = spent.get(key) ?? new Set<string>();
    spent.set(key, done);
    const extra = gatedOffers(game).find((o) => {
      if (!o.enabled || o.cmd.kind !== "act" || o.cmd.verb === "work") return false;
      if (o.cmd.target !== undefined && doors.has(o.cmd.target)) return false;
      return !done.has(`${o.cmd.verb}/${o.cmd.target}/${o.cmd.slot}`);
    });
    if (extra && extra.cmd.kind === "act") {
      done.add(`${extra.cmd.verb}/${extra.cmd.target}/${extra.cmd.slot}`);
      if (!game.playerCommand(extra.cmd).ok) game.playerCommand({ kind: "wait" });
      continue;
    }

    const work = gatedOffers(game).find((o) => o.enabled && o.cmd.kind === "act" && o.cmd.verb === "work");
    if (work) {
      if (!game.playerCommand(work.cmd).ok) game.playerCommand({ kind: "wait" });
      continue;
    }

    const walk = route(game);
    const goals = game.ship.rooms
      .filter((r) => (r.data.systems as Array<{ online?: boolean }> | undefined)?.some((s) => !s.online))
      .map((r) => r.id);
    const door = goals.length === 0 ? undefined : RoomDistance.from(game.ship, goals, walk).nextDoor(here, walk);
    if (!door) return;
    if (!game.playerCommand({ kind: "go", door: door.id }).ok) game.playerCommand({ kind: "wait" });
  }
}

// ---------------------------------------------------------------- scenarios

interface Scenario {
  /** The fixture's file name, `voyage-<name>.json`. */
  name: string;
  seed: number;
  config: ConfigName;
  play(game: RoomGame, seed: number): void;
}

const SCENARIOS: Scenario[] = [
  // Found by scanning for a `careful` voyage that loses a drone and buys
  // another (`SCAN=1`, the block at the foot of this file). It was seed 511 when
  // three of the first two thousand seeds did it; on lattice hulls the first
  // five all do, which is itself worth knowing — a hull whose compartments are
  // a walk apart is a hull a drone comes back from often enough to buy the
  // next one.
  { name: "loss", seed: 1, config: "shipped", play: (g, s) => playCareful(g, s, 1200) },
  { name: "rival", seed: 7, config: "shipped", play: playRival },
  // The first seed on which the scripted driver neutralises a generated
  // freighter without help. It was 12, then 3, and is 5 since the hulls moved
  // onto the lattice — the driver walks by the shortest route it can see, so
  // every change to the shape of a hull moves which seeds it can finish.
  // `SCAN=1` finds the next one; do that rather than lower the assertion.
  { name: "sale", seed: 5, config: "one-hull", play: playSale },
];

// -------------------------------------------------------------- the outcome

/** What the run came to, in the numbers a person reads a voyage by. */
interface RunOutcome {
  status: string;
  /** Sorties flown, hulls in the store, credits banked. */
  sortie: number;
  ships: number;
  credits: number;
  /** Drones lost, hulls sold, charters paid, machines killed. */
  deaths: number;
  sold: number;
  charters: number;
  kills: number;
  turns: number;
  /** The rack the run ended on: which modules survived and which burned. */
  rig: unknown;
}

interface ReplayFixture {
  version: number;
  seed: number;
  config: ConfigName;
  inputs: RoomCommand[];
  expect: RunOutcome;
  /**
   * A hash of everything the run left behind — every stored hull's graph, its
   * doors, what lies in its compartments, who is aboard it, the per-ship
   * pockets, the voyage record and the whole log. The numbers above are what a
   * diff can be read by; this is what makes the check bit-for-bit.
   */
  fingerprint: string;
  /** Commit the recording was made at. See the header. */
  codeSha: string;
}

function outcomeOf(game: RoomGame): RunOutcome {
  const voyage = voyageOf(game);
  return {
    status: game.status,
    sortie: voyage.sortie,
    ships: game.ships.ids().length,
    credits: voyage.credits,
    deaths: voyage.state.reduce((n, s) => n + s.deaths.length, 0),
    sold: voyage.state.filter((s) => s.sold).length,
    charters: voyage.paid.length,
    kills: game.kills,
    turns: game.schedule.time,
    rig: JSON.parse(JSON.stringify(rigOf(game.player) ?? null)),
  };
}

/**
 * Everything the run is, as one string.
 *
 * Ships in store order, rooms and doors in graph order, entities in list order
 * — all of them deterministic given the same commands, which is the whole point
 * of hashing them. Functions drop out through `JSON.stringify`, which is how
 * the charter predicates on the voyage record stay out of it.
 */
function fingerprint(game: RoomGame): string {
  return fnv1a(JSON.stringify([canonical(stateOf(game)), game.log.lines.map((l) => l.text)]));
}

/**
 * Drop empty pockets before hashing.
 *
 * `room.data.items = []` and no `items` key at all are the same compartment,
 * and which of the two a run ends with depends on whether anything ever *read*
 * the action list there: several systems create their record the first time
 * they are asked a question — `roomListIn` writes the empty list
 * (`systems/populate.ts`), `shipState` writes `{online: []}`
 * (`systems/ship.ts`). A live run has a bot reading the offers every turn and a
 * replay has nobody reading them at all, so without this the two disagree on
 * every compartment and on nothing that matters.
 *
 * Symmetric, so it cannot hide a real difference: anything with a value in it
 * survives on both sides.
 */
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

/**
 * The same, with the log left out — which is what a live run and its replay can
 * be compared on.
 *
 * A refused command writes its reason into the log and is not recorded in
 * `RoomGame.inputs`, so a driver that ever presses a key the game says no to
 * ends with more lines than its own replay. Everything the *world* is, is
 * below; the log is compared where it can be, between two replays.
 */
function stateHash(game: RoomGame): string {
  return fnv1a(JSON.stringify(canonical(stateOf(game))));
}

function stateOf(game: RoomGame): unknown[] {
  const parts: unknown[] = [];
  for (const id of game.ships.ids()) {
    const stored = game.ships.get(id)!;
    const aboard = id === game.shipId;
    parts.push([
      id,
      stored.visits,
      stored.scheduleSeed,
      stored.ship.entry,
      stored.ship.rooms.map((r) => [r.id, r.kind, r.depth, r.explored, r.scanned, r.marks, r.data]),
      stored.ship.doors.map((d) => [d.id, d.a, d.b, d.state, d.key ?? null]),
      (aboard ? game.entities : stored.entities).map((e) => [e.id, e.name, e.room, e.hp, e.hpMax, e.alive, e.data]),
      stored.data,
    ]);
  }
  parts.push(game.shipId, game.status, game.kills, game.schedule.time, [...game.flags]);
  parts.push(game.player.data);
  return parts;
}

/** Short, stable, and enough to tell two runs apart. Not a security hash. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// --------------------------------------------------------------- the files

function fixturePath(name: string): string {
  return join(FIXTURES, `voyage-${name}.json`);
}

function loadFixture(name: string): ReplayFixture {
  return JSON.parse(readFileSync(fixturePath(name), "utf8")) as ReplayFixture;
}

function codeSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function recordFixture(scenario: Scenario): ReplayFixture {
  const cfg = CONFIGS[scenario.config];
  const live = new RoomGame({ ...cfg, seed: scenario.seed });
  scenario.play(live, scenario.seed);
  const inputs = [...live.inputs];

  // The recording is only worth keeping if it reproduces itself: a live run and
  // its replay that disagree mean the sim reads something it should not — or
  // that a refused command changed the world, which `RoomGame.inputs` cannot
  // record and a replay therefore cannot repeat.
  const replayed = replayRooms(scenario.seed, inputs, cfg);
  const [a, b] = [outcomeOf(live), outcomeOf(replayed)];
  if (JSON.stringify(a) !== JSON.stringify(b) || stateHash(live) !== stateHash(replayed)) {
    throw new Error(
      `${scenario.name}: the live run and its replay disagree\n` +
        `live:   ${JSON.stringify(a)} ${stateHash(live)}\n` +
        `replay: ${JSON.stringify(b)} ${stateHash(replayed)}`,
    );
  }

  const fixture: ReplayFixture = {
    version: SAVE_VERSION,
    seed: scenario.seed,
    config: scenario.config,
    inputs,
    expect: a,
    fingerprint: fingerprint(replayed),
    codeSha: codeSha(),
  };
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(fixturePath(scenario.name), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

// --------------------------------------------------------------- the tests

describe("recorded voyages", () => {
  if (process.env.RECORD === "1") {
    it("re-records all three fixtures", () => {
      const written = SCENARIOS.map(recordFixture);
      for (const [i, fixture] of written.entries()) {
        console.log(
          `${SCENARIOS[i]!.name.padEnd(6)} seed=${fixture.seed} config=${fixture.config} ` +
            `inputs=${fixture.inputs.length} ${fixture.fingerprint} ${JSON.stringify(fixture.expect)}`,
        );
      }
      expect(written.map((f) => f.inputs.length > 0)).toEqual(SCENARIOS.map(() => true));
    }, 300_000);
    return;
  }

  for (const scenario of SCENARIOS) {
    it(`replays the ${scenario.name} voyage to the same ending`, () => {
      const fixture = loadFixture(scenario.name);
      expect(fixture.seed, "fixture is for another seed").toBe(scenario.seed);
      expect(fixture.config, "fixture is for another config").toBe(scenario.config);

      // Through the save format the game itself uses: a fixture that no longer
      // decodes is a save file that no longer loads, and players have those.
      const decoded = decodeRun<RoomCommand>(
        encodeRun({ version: fixture.version, seed: fixture.seed, inputs: fixture.inputs }),
      );
      expect(decoded.ok, decoded.reason ?? "").toBe(true);

      const game = replayRooms(fixture.seed, decoded.record!.inputs, CONFIGS[scenario.config]);
      expect(outcomeOf(game)).toEqual(fixture.expect);
      expect(fingerprint(game), "the run ended in a different state").toBe(fixture.fingerprint);
    }, 60_000);
  }

  it("two replays of one recording are the same run", () => {
    const fixture = loadFixture(SCENARIOS[0]!.name);
    const cfg = CONFIGS[fixture.config];
    const once = replayRooms(fixture.seed, fixture.inputs, cfg);
    const twice = replayRooms(fixture.seed, fixture.inputs, cfg);
    expect(fingerprint(twice)).toBe(fingerprint(once));
    expect(twice.log.lines.map((l) => l.text)).toEqual(once.log.lines.map((l) => l.text));
  }, 60_000);

  it("records between them a death, a purchase, a hull lost and a hull sold", () => {
    // The fixtures are only worth their runtime if they still cover the three
    // things they were chosen for. A balance pass that quietly turns the loss
    // voyage into a win leaves three green tests measuring nothing.
    const by = new Map(SCENARIOS.map((s) => [s.name, loadFixture(s.name).expect]));
    const loss = by.get("loss")!;
    expect(loss.deaths, "the loss voyage stopped losing drones").toBeGreaterThan(0);
    expect(loss.sortie, "the loss voyage stopped buying a second hull").toBeGreaterThan(1);

    const sale = by.get("sale")!;
    expect(sale.sold, "the sale voyage stopped selling the hull").toBe(1);
    expect(sale.status, "the last hull of an itinerary sold is a win").toBe("won");

    // The rival's take is not in `RunOutcome` — it is a per-ship pocket — so it
    // is read off the replay itself.
    const fixture = loadFixture("rival");
    const game = replayRooms(fixture.seed, fixture.inputs, CONFIGS[fixture.config]);
    const progress = game.ships.ids().map((id) => {
      const pocket = game.ships.get(id)?.data.rival as { progress?: number } | undefined;
      return typeof pocket?.progress === "number" ? pocket.progress : 0;
    });
    expect(Math.max(0, ...progress), "the other tug stopped taking the hull").toBeGreaterThanOrEqual(3);
  }, 60_000);
});

// ------------------------------------------------------------ corrupt saves

/**
 * A save that is not a save.
 *
 * SALVOR ships no "continue later" (design-doc.md, "Явно НЕ входит"), so the
 * only thing that ever arrives in this format today is a recording pasted into
 * a bug report — which is exactly the input that is neither trusted nor
 * validated by anybody. Every case below has to come back as a refusal rather
 * than as a half-loaded run, and the game has to start a fresh voyage on top of
 * one without a word.
 */
describe("a corrupt save never reaches the ship", () => {
  const good = (): string => {
    const fixture = loadFixture("rival");
    return encodeRun({ version: fixture.version, seed: fixture.seed, inputs: fixture.inputs });
  };

  const corruptions: Array<{ why: string; text: string }> = [
    { why: "truncated in the middle of a command", text: good().slice(0, Math.floor(good().length / 2)) },
    { why: "truncated to nothing", text: "" },
    { why: "a bare string", text: '"a save, honest"' },
    { why: "null", text: "null" },
    { why: "an array", text: "[1, 2, 3]" },
    { why: "no seed", text: JSON.stringify({ version: SAVE_VERSION, inputs: [] }) },
    { why: "a seed that is not a number", text: JSON.stringify({ version: SAVE_VERSION, seed: "7", inputs: [] }) },
    { why: "a seed that is not finite", text: `{"version":${SAVE_VERSION},"seed":null,"inputs":[]}` },
    { why: "inputs that are not a list", text: JSON.stringify({ version: SAVE_VERSION, seed: 7, inputs: {} }) },
    { why: "a version from another build", text: JSON.stringify({ version: SAVE_VERSION + 1, seed: 7, inputs: [] }) },
    {
      why: "a command of an unknown kind",
      text: JSON.stringify({ version: SAVE_VERSION, seed: 7, inputs: [{ kind: "undock" }] }),
    },
    {
      why: "a `go` through a door that is not a number",
      text: JSON.stringify({ version: SAVE_VERSION, seed: 7, inputs: [{ kind: "go", door: "d1" }] }),
    },
    {
      why: "an `act` with no verb",
      text: JSON.stringify({ version: SAVE_VERSION, seed: 7, inputs: [{ kind: "act", target: 3 }] }),
    },
    {
      why: "a voyage record glued on where a command belongs",
      text: JSON.stringify({ version: SAVE_VERSION, seed: 7, inputs: [{ credits: 99_999, hull: "ghost" }] }),
    },
  ];

  for (const { why, text } of corruptions) {
    it(`refuses a save ${why}`, () => {
      const decoded = decodeRun<RoomCommand>(text);
      expect(decoded.ok, `accepted: ${text.slice(0, 80)}`).toBe(false);
      expect(decoded.reason, "a refusal has to say why").toBeTruthy();
      expect(decoded.record).toBeUndefined();

      // And the game goes on: a refused save is a new voyage, not a dead page.
      const game = new RoomGame({ ...GAME_CONFIG, seed: 7 });
      expect(() => playCareful(game, 7, 40)).not.toThrow();
      expect(game.ships.ids().length).toBeGreaterThan(0);
    });
  }

  it("cannot smuggle state in beside the commands", () => {
    // The format is (seed, commands) and nothing else, which is what makes a
    // save unable to desync from the code — and, here, unable to hand the run
    // an account it did not earn. A doctored `voyage` is simply not read.
    const fixture = loadFixture("rival");
    const doctored = JSON.stringify({
      version: fixture.version,
      seed: fixture.seed,
      inputs: fixture.inputs,
      voyage: { credits: 99_999, hull: "ghost", state: "nonsense" },
      summary: { depth: Number.NaN },
    });

    const decoded = decodeRun<RoomCommand>(doctored);
    expect(decoded.ok, decoded.reason ?? "").toBe(true);
    expect(Object.keys(decoded.record!).sort()).toEqual(["inputs", "seed", "summary", "version"]);

    const game = replayRooms(fixture.seed, decoded.record!.inputs, CONFIGS[fixture.config]);
    expect(fingerprint(game)).toBe(fixture.fingerprint);
  }, 60_000);

  it("plays on with a voyage record that is not a voyage", () => {
    // The other half of the same question, and the one that can actually happen
    // today: `voyageOf` re-reads `player.data.voyage` through a type guard on
    // every access, so whatever is in that pocket, the next command must still
    // be answered (`systems/voyage.ts`, `isVoyage`).
    for (const junk of [undefined, null, "gone", 7, [], {}, { credits: "lots" }]) {
      const game = new RoomGame({ ...GAME_CONFIG, seed: 12 });
      (game.player.data ??= {}).voyage = junk;

      expect(() => playCareful(game, 12, 40), JSON.stringify(junk ?? null)).not.toThrow();

      const voyage = game.player.data.voyage as { credits?: unknown } | undefined;
      expect(typeof voyage?.credits, JSON.stringify(junk ?? null)).toBe("number");
      expect(Number.isFinite(voyage!.credits as number)).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ the scan

/**
 * Which seeds still cover what the fixtures were chosen for.
 *
 * `SCAN=1` and nothing else runs. Kept in the file rather than in a script
 * because it needs the same drivers and the same configs the fixtures were
 * recorded with — a scan that plays a different game finds seeds that do not
 * reproduce.
 */
if (process.env.SCAN === "1") {
  describe("scan", () => {
    it("finds seeds for the three scenarios", () => {
      const found: Record<string, number[]> = { loss: [], sale: [], rival: [] };
      for (let seed = 1; seed <= 600; seed++) {
        const loss = new RoomGame({ ...CONFIGS.shipped, seed });
        playCareful(loss, seed, 1200);
        const l = outcomeOf(loss);
        if (l.deaths > 0 && l.sortie > 1 && found.loss!.length < 5) found.loss!.push(seed);

        const sale = new RoomGame({ ...CONFIGS["one-hull"], seed });
        playSale(sale, seed);
        const t = outcomeOf(sale);
        if (t.sold === 1 && t.status === "won" && found.sale!.length < 5) found.sale!.push(seed);
      }
      for (let seed = 1; seed <= 200; seed++) {
        const game = new RoomGame({ ...CONFIGS.shipped, seed });
        playRival(game, seed);
        const took = game.ships.ids().some((id) => {
          const pocket = game.ships.get(id)?.data.rival as { progress?: number } | undefined;
          return (pocket?.progress ?? 0) >= 3;
        });
        if (took && found.rival!.length < 5) found.rival!.push(seed);
      }
      console.log("loss ", found.loss!.join(" "));
      console.log("sale ", found.sale!.join(" "));
      console.log("rival", found.rival!.join(" "));
    }, 600_000);
  });
}
