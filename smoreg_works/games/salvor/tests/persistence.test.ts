import { describe, it, expect } from "vitest";
import {
  RoomDistance,
  Rng,
  isAlive,
  type DoorFilter,
  type DoorId,
  type DoorState,
  type Entity,
  type Room,
  type RoomCommand,
  type RoomGame,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import { RoomGame as RoomGameClass, type System } from "@jamrog/engine";
import { BOTS_ROOMS, seedRange } from "@jamrog/engine/testing";
import { GAME_CONFIG } from "../src/game.js";
import { TUG_ID, tugRoomKind } from "../src/content/tug.js";
import { gatedOffers } from "../src/systems/tug.js";
import { isGhost } from "../src/systems/ghost.js";
import { voyageOf } from "../src/systems/voyage.js";

/**
 * "Enter, act, leave, enter again" — as a property, over two hundred seeds of
 * the real game.
 *
 * A derelict is the one thing in SALVOR that outlives the drone standing in it
 * (design-doc.md, "Персистентный дереликт"): the graph, the doors as they were
 * left, what was carried out, what was killed, what was raised, and where the
 * last drone died. Every one of those is a `StoredShip` in `RoomGame.ships`
 * that no single-sortie test ever looks at twice, which is exactly the class of
 * state where "it worked when I tried it" is worth nothing.
 *
 * Three snapshots per seed, and every assertion below is a sentence about the
 * change between two of them:
 *
 *   A  the moment the first sortie comes aboard
 *   B  the moment it leaves — by the airlock or in a body bag
 *   C  the moment the next sortie comes aboard the same hull
 *
 * Nothing is held still: `newGame(seed)` is what the browser builds, the hull
 * is whatever the itinerary drew, and the sortie in between is the `careful`
 * bot playing it. A seed the driver cannot get through — the drone died broke,
 * the hull was sold, the way back to the airlock was cut off — is counted and
 * skipped rather than asserted about, and the count itself is a test at the
 * bottom of the file.
 */

const SEEDS = seedRange(1, 200);

/**
 * How long the sortie in between runs, twice over.
 *
 * The two exits out of a derelict are different code — `comeHome` banks the
 * loot, pays the charters and may sell the hull; `loseDrone` empties the rack,
 * writes the death record and hands the next entry a ghost — and both have to
 * leave a ship a run can walk back into. Measured at eighty commands the
 * `careful` bot dies on 198 seeds of 200, so the long pass is the death path
 * and a short one is the airlock path.
 *
 * Eighty stopped being the death path. G30's third pass put four more points
 * of integrity on each of the three modules a sortie ends on, three on the
 * CELL, and took the `+1` off the hunter's die; at eighty commands the body
 * bag then caught 10 trips of 371 — under the fifteen the census at the bottom
 * of this file asks for, which would leave the property below measuring one
 * way out of a derelict rather than two. The long pass is 140 commands for the
 * same reason it was 80: it is where the drone dies. 19 of 367 at that length,
 * with the airlock carrying the other 348. The bar was not moved.
 */
const SORTIE_STEPS = [140, 16] as const;

/** A walk home is a walk: no cutting, no welding, one turn per compartment. */
const WALK_CAP = 60;

/** Reinforcements are posted this many doors from the airlock (`systems/alert.ts`). */
const MIN_SPAWN_DOORS = 2;

/** A ghost rises this far from the wreckage of the drone it was (`systems/ghost.ts`). */
const GHOST_MAX_DOORS = 2;

/**
 * A voyage that cannot go broke, as a system of the run rather than a value
 * poked in afterwards — so every game below is still built from a config and
 * still replays from (seed, inputs).
 *
 * Not a convenience. The property this file measures is about the *ship*, and
 * reaching it a second time means surviving the first sortie's bill: measured
 * on the shipped account, the `careful` bot loses the drone and goes broke on
 * 198 seeds of 200, and the second entry — where reinforcements, trails and
 * ghosts live — never happens at all. With a floor under the account, dying is
 * what it is meant to be here: the way a ghost gets aboard.
 *
 * Nothing else is changed. The alert, the doors, the deck and the store are the
 * shipped ones, and credits appear in none of the assertions below.
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

/**
 * A window onto the ship at the one moment this file is about: the drone is
 * aboard, everything the ship did in its absence has happened, and nothing
 * aboard has moved yet.
 *
 * `RoomGame.playerCommand` runs `onLevelEnter` inside the command, then every
 * `afterPlayerTurn`, and only then gives the floor to the machines — so a
 * system placed at the *head* of the list sees exactly the ship's answer,
 * separated from the arrival turn's own clock. Read from outside instead, the
 * measurements blur by one turn in every direction: the alert has ticked, a
 * fresh reinforcement has already walked a door towards the drone, and the
 * ghost that rose two doors from the wreck is three.
 */
let capture: ((game: RoomGame) => void) | undefined;

const PROBE: System<RoomGame> = {
  name: "test-probe",
  afterPlayerTurn(game) {
    const take = capture;
    capture = undefined;
    take?.(game);
  },
};

function fundedGame(seed: number): RoomGame {
  return new RoomGameClass({
    ...GAME_CONFIG,
    systems: [PROBE, ...(GAME_CONFIG.systems ?? []), FUNDED],
    seed,
  });
}

/**
 * Cast off, and snapshot the hull the clamps let go of — before anything
 * aboard has moved. Undefined when there was nothing to cast off into.
 */
function undockAndSnapshot(game: RoomGame): { shipId: string; snap: Snapshot } | undefined {
  if (!atDock(game)) return undefined;
  const cmd = offerFor(game, "undock");
  if (!cmd) return undefined;

  let taken: { shipId: string; snap: Snapshot } | undefined;
  capture = (g) => {
    taken = { shipId: g.shipId, snap: snapshot(g, g.shipId) };
  };
  const ok = game.playerCommand(cmd).ok;
  capture = undefined;
  return ok ? taken : undefined;
}

// ------------------------------------------------------------------ snapshots

interface EntitySnap {
  id: number;
  name: string;
  room: RoomId | undefined;
  alive: boolean;
  ghost: boolean;
}

/** A drone that died here, and how many modules were still on its rack. */
interface DeathSnap {
  room: RoomId;
  modules: number;
}

interface Snapshot {
  /** Rooms and doors as a graph, with nothing about their state. */
  topology: string;
  doors: Map<DoorId, DoorState>;
  explored: Set<RoomId>;
  /** `${list}:${id}` for everything lying in each compartment. */
  contents: Map<RoomId, Set<string>>;
  entities: EntitySnap[];
  alert: number;
  online: number;
  /** Drones that died aboard, as the voyage records them. */
  deaths: DeathSnap[];
}

function topologyOf(ship: Ship): string {
  const rooms = ship.rooms.map((r) => `${r.id}/${r.kind}/${r.depth}`).join(",");
  const doors = ship.doors.map((d) => `${d.id}:${d.a}-${d.b}`).join(",");
  return `${rooms}|${doors}`;
}

/**
 * Everything lying in one compartment, whatever list it is in.
 *
 * Read generically rather than by name — wrecks, crates, bodies, ship systems,
 * charter errands — because the question is "did what was taken come back", and
 * a list this test has not heard of is exactly where that would go unnoticed.
 */
function contentsOf(room: Room): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(room.data)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "number") {
        out.add(`${key}:${(item as { id: number }).id}`);
      }
    }
  }
  return out;
}

function entitySnap(e: Entity): EntitySnap {
  return { id: e.id, name: e.name, room: e.room, alive: isAlive(e), ghost: isGhost(e) };
}

/** A number out of a per-ship pocket that may not exist yet. */
function pocketNumber(data: Record<string, unknown>, key: string, field: string): number {
  const raw = data[key];
  if (typeof raw !== "object" || raw === null) return 0;
  const value = (raw as Record<string, unknown>)[field];
  if (typeof value === "number") return value;
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Where the voyage says drones have died aboard this hull, and how much rack
 * each of them was wearing. Read structurally: the record round-trips through a
 * save file, and a test that trusts its shape is a test that would not notice
 * the day it stops having one.
 */
function deathRecords(game: RoomGame, shipId: string): DeathSnap[] {
  const voyage = game.player.data?.voyage as { state?: unknown } | undefined;
  const states = voyage?.state;
  if (!Array.isArray(states)) return [];
  const here = states.find(
    (s) => typeof s === "object" && s !== null && (s as { shipId?: unknown }).shipId === shipId,
  ) as { deaths?: unknown } | undefined;
  if (!Array.isArray(here?.deaths)) return [];

  const out: DeathSnap[] = [];
  for (const raw of here.deaths) {
    if (typeof raw !== "object" || raw === null) continue;
    const death = raw as { room?: unknown; rig?: { slots?: unknown } };
    if (typeof death.room !== "number") continue;
    const slots = death.rig?.slots;
    out.push({ room: death.room, modules: Array.isArray(slots) ? slots.filter(Boolean).length : 0 });
  }
  return out;
}

/**
 * The stored hull as it stands. Entities come from the live list when the drone
 * is aboard and from the store when it is not: `travelTo` stashes them on the
 * way out, so the store's copy is a sortie stale until then.
 */
function snapshot(game: RoomGame, shipId: string): Snapshot {
  const stored = game.ships.get(shipId)!;
  const ship = stored.ship;
  const aboard = game.shipId === shipId;
  const entities = (aboard ? game.entities : stored.entities).filter((e) => e.id !== game.player.id);

  return {
    topology: topologyOf(ship),
    doors: new Map(ship.doors.map((d) => [d.id, d.state] as const)),
    explored: new Set(ship.rooms.filter((r) => r.explored).map((r) => r.id)),
    contents: new Map(ship.rooms.map((r) => [r.id, contentsOf(r)] as const)),
    entities: entities.map(entitySnap),
    alert: pocketNumber(stored.data, "alert", "level"),
    online: pocketNumber(stored.data, "ship", "online"),
    deaths: deathRecords(game, shipId),
  };
}

// --------------------------------------------------------------- the driver

/** Every offer of every system, gated by the station the drone is standing in. */
function offerFor(game: RoomGame, verb: string): RoomCommand | undefined {
  const offer = gatedOffers(game).find(
    (o) => o.enabled && o.cmd.kind === "act" && o.cmd.verb === verb,
  );
  return offer?.cmd;
}

/** Doors a drone walks through without a tool and without a turn spent cutting. */
function walkable(game: RoomGame): DoorFilter {
  return (d) => d.state !== "airlock" && game.ship.passable(d, {});
}

/** Walk to `goal` one open door at a time. False if the way is shut or the run ends. */
function walkTo(game: RoomGame, goal: RoomId): boolean {
  const shipId = game.shipId;
  for (let i = 0; i < WALK_CAP; i++) {
    if (game.roomOf(game.player).id === goal) return true;
    if (game.isOver() || game.shipId !== shipId) return false;
    const walk = walkable(game);
    const door = RoomDistance.from(game.ship, [goal], walk).nextDoor(
      game.roomOf(game.player).id,
      walk,
    );
    if (!door) return false;
    if (!game.playerCommand({ kind: "go", door: door.id }).ok) return false;
  }
  return false;
}

/** The compartment the airlock hangs off — where `leave` is the only way it is. */
function airlockRoom(ship: Ship): RoomId | undefined {
  const door = ship.doors.find((d) => d.state === "airlock");
  return door?.a;
}

/** Stand in the DOCK, which is where a hull is bought and the clamps let go. */
function atDock(game: RoomGame): boolean {
  const dock = game.ship.rooms.find((r) => tugRoomKind(r.kind) === "dock");
  return dock !== undefined && walkTo(game, dock.id);
}

/** Press a station verb, walking to the station that owns it first. */
function station(game: RoomGame, verb: string): boolean {
  if (!atDock(game)) return false;
  const cmd = offerFor(game, verb);
  return cmd !== undefined && game.playerCommand(cmd).ok;
}

/** Why a seed was skipped, for the census at the bottom of the file. */
type Skip =
  | "no first sortie"
  | "the run ended"
  | "the way back was shut"
  | "no drone and no money"
  | "no second sortie";

interface Trip {
  seed: number;
  game: RoomGame;
  shipId: string;
  a: Snapshot;
  b: Snapshot;
  c: Snapshot;
  /** True when the drone did not come back from the first sortie. */
  died: boolean;
}

/**
 * One voyage, driven to the second entry into its first derelict.
 *
 * The sortie in the middle is the `careful` bot — the competent player, and the
 * only bot that spends the game's own verbs, so it is the one that takes crates,
 * cuts bulkheads and raises systems. What it does is not asserted about; it is
 * what makes the two entries differ at all.
 */
function trip(seed: number, steps: number): Trip | Skip {
  const game = fundedGame(seed);
  const first = undockAndSnapshot(game);
  if (!first) return "no first sortie";

  const { shipId, snap: a } = first;

  const bot = BOTS_ROOMS.careful!();
  const rng = new Rng(seed ^ 0x5a1_0a2b);
  for (let i = 0; i < steps && game.shipId === shipId && !game.isOver(); i++) {
    // A refused command costs the bot a turn instead of looping on it, exactly
    // as the fuzz harness does.
    if (!game.playerCommand(bot(game, rng)).ok) game.playerCommand({ kind: "wait" });
  }

  const died = game.shipId === TUG_ID && !game.isOver() && aboardNothing(game);
  if (game.shipId === shipId) {
    // Still out there: walk back to the airlock and cycle it. This is the one
    // command sequence the test supplies rather than the bot, and it is the
    // plain player one — no cutting, no welding, one open door at a time.
    const lock = airlockRoom(game.ship);
    if (lock === undefined || !walkTo(game, lock)) {
      return game.isOver() ? "the run ended" : "the way back was shut";
    }
    if (!game.playerCommand({ kind: "leave" }).ok) return "the way back was shut";
  }
  if (game.isOver()) return "the run ended";
  if (game.shipId !== TUG_ID) return "the way back was shut";

  const b = snapshot(game, shipId);

  if (aboardNothing(game) && !station(game, "buy")) return "no drone and no money";
  const second = undockAndSnapshot(game);
  if (!second || second.shipId !== shipId) return "no second sortie";

  return { seed, game, shipId, a, b, c: second.snap, died };
}

/** No drone on the rails: the voyage says so, and the station list shows it. */
function aboardNothing(game: RoomGame): boolean {
  const voyage = game.player.data?.voyage as { hull?: unknown } | undefined;
  return voyage !== undefined && voyage.hull === undefined;
}

const results = SORTIE_STEPS.flatMap((steps) => SEEDS.map((seed) => trip(seed, steps)));
const trips = results.filter((r): r is Trip => typeof r !== "string");
const skips = results.filter((r): r is Skip => typeof r === "string");

/** One line per failing seed, capped: two hundred of them is not a message. */
function report(offences: string[]): string[] {
  return offences.slice(0, 8);
}

// ------------------------------------------------------------------- the ship

describe("a derelict is the same place the second time", () => {
  it("brings back the same graph, room for room and door for door", () => {
    // The strongest of the lot and the cheapest to break: `travelTo` lifts the
    // hull out of the store instead of generating it, so a regeneration on the
    // way back in shows up here as every seed at once.
    const offences = trips
      .filter((t) => t.b.topology !== t.c.topology)
      .map((t) => `seed ${t.seed}: the graph changed between sorties`);

    expect(report(offences)).toEqual([]);
  });

  it("keeps every compartment the last sortie walked into explored", () => {
    const offences: string[] = [];
    for (const t of trips) {
      for (const room of t.b.explored) {
        if (!t.c.explored.has(room)) offences.push(`seed ${t.seed}: room ${room} is unexplored again`);
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("never hands back what a sortie carried out", () => {
    // The half of "persistent" a player actually feels: a crate prised open, a
    // body searched and a wreck stripped are gone, and coming back does not
    // restock the ship. Measured against A rather than B, so it is the taking
    // that is checked and not merely the storing.
    const offences: string[] = [];
    for (const t of trips) {
      for (const [room, before] of t.a.contents) {
        const left = t.b.contents.get(room) ?? new Set<string>();
        const now = t.c.contents.get(room) ?? new Set<string>();
        for (const item of before) {
          if (!left.has(item) && now.has(item)) {
            offences.push(`seed ${t.seed}: ${item} came back to room ${room}`);
          }
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("never loses what the last sortie left lying about", () => {
    // The other direction, and the one that would make a run unwinnable in
    // silence: the rack a dead drone dropped, the wreck of a machine killed at
    // the far end, the marked crate of a charter — all of it has to be there.
    const offences: string[] = [];
    for (const t of trips) {
      for (const [room, left] of t.b.contents) {
        const now = t.c.contents.get(room) ?? new Set<string>();
        for (const item of left) {
          if (!now.has(item)) offences.push(`seed ${t.seed}: ${item} vanished from room ${room}`);
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("never brings a machine back to life", () => {
    const dead = (snap: Snapshot): Set<number> =>
      new Set(snap.entities.filter((e) => !e.alive).map((e) => e.id));
    const offences: string[] = [];

    for (const t of trips) {
      // Everything that was aboard at A and is not alive at B: killed, or
      // reaped out of the list altogether. Either way it stays that way.
      const gone = new Set<number>();
      const aliveAtB = new Set(t.b.entities.filter((e) => e.alive).map((e) => e.id));
      for (const e of t.a.entities) {
        if (e.alive && !aliveAtB.has(e.id)) gone.add(e.id);
      }
      for (const id of dead(t.b)) gone.add(id);

      for (const e of t.c.entities) {
        if (e.alive && gone.has(e.id)) {
          offences.push(`seed ${t.seed}: ${e.name}#${e.id} is walking again`);
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });
});

// ------------------------------------------------------------------ the doors

/**
 * What may happen to a bulkhead while nobody is aboard, and nothing else.
 *
 * The only writer between two sorties is the trail a mustered machine leaves
 * behind it (`systems/alert.ts`, `leaveTrail`): a closed door it walked through
 * and did not shut. Everything else is the design's two promises — what was
 * opened stays open, what was welded stays welded (design-doc.md, "Персистентный
 * дереликт").
 */
const DOOR_MAY_BECOME: Readonly<Record<DoorState, readonly DoorState[]>> = {
  open: ["open"],
  broken: ["broken"],
  closed: ["closed", "open"],
  locked: ["locked"],
  sealed: ["sealed"],
  airlock: ["airlock"],
};

describe("the doors are as the last drone left them", () => {
  it("changes no bulkhead except a closed one a machine walked through", () => {
    const offences: string[] = [];
    for (const t of trips) {
      for (const [id, before] of t.b.doors) {
        const after = t.c.doors.get(id);
        if (after === undefined) {
          offences.push(`seed ${t.seed}: door ${id} is gone`);
        } else if (!DOOR_MAY_BECOME[before].includes(after)) {
          offences.push(`seed ${t.seed}: door ${id} went ${before} -> ${after}`);
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("never re-locks a bulkhead a sortie opened, and never unwelds one it sealed", () => {
    // The same rule said the way the design says it, and against A rather than
    // B: cutting a locked door open and welding one shut are both turns the
    // player paid for, and both have to still be paid for on the way back in.
    const offences: string[] = [];
    for (const t of trips) {
      for (const [id, first] of t.a.doors) {
        const left = t.b.doors.get(id)!;
        const now = t.c.doors.get(id)!;
        const opened = first !== "open" && first !== "broken" && (left === "open" || left === "broken");
        if (opened && now !== "open" && now !== "broken") {
          offences.push(`seed ${t.seed}: door ${id} was cut open and is ${now} again`);
        }
        if (left === "sealed" && now !== "sealed") {
          offences.push(`seed ${t.seed}: door ${id} was welded and is ${now} now`);
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });
});

// ------------------------------------------------------- what the ship did

describe("the ship answers between two sorties", () => {
  it("settles the alert to the number of systems the drone raised", () => {
    // design-doc.md, "Персистентный дереликт": the gauge falls to a floor equal
    // to the systems brought online, and nothing raises it while nobody is
    // aboard. Exact rather than bounded, because the snapshot is taken before
    // the arrival turn's own clock has ticked (see `PROBE`).
    const offences: string[] = [];
    for (const t of trips) {
      const floor = Math.min(t.b.alert, t.b.online);
      if (t.c.alert !== floor) {
        offences.push(
          `seed ${t.seed}: left at ${t.b.alert} with ${t.b.online} systems up, came back to ` +
            `${t.c.alert} and not ${floor}`,
        );
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("musters only into compartments already walked, two doors in or more", () => {
    // The rule that makes reinforcement a clock and not an ambush. Ghosts are
    // not reinforcements — they rise off the wreckage, one or two doors from
    // where the drone died (`systems/ghost.ts`) — and neither is the other
    // tug's drone, which comes in through its own lock (`systems/rival.ts`).
    const offences: string[] = [];

    for (const t of trips) {
      const known = new Set(t.b.entities.map((e) => e.id));
      const ship = t.game.ships.get(t.shipId)!.ship;
      // The doors as they stood when the ship mustered, not as they stand now.
      // A posted machine leaves a trail on its way in and some of the closed
      // doors it walks through stay open behind it (`systems/alert.ts`,
      // `leaveTrail`), so the way home can be shorter afterwards than the rule
      // measured — and with hulls carrying six or seven loops instead of two or
      // three there are far more shortcuts for a trail to open
      // (docs/owner-queue.md, 3). What is under test is where the ship put the
      // thing, which is what the rule promises.
      const before = t.b.doors;
      const walk: DoorFilter = (d) => ship.passable({ ...d, state: before.get(d.id) ?? d.state }, {});
      const fromEntry = RoomDistance.from(ship, [ship.entry], walk);

      for (const e of t.c.entities) {
        if (known.has(e.id) || e.ghost || e.name === "rival drone" || e.room === undefined) continue;
        if (!t.b.explored.has(e.room)) {
          offences.push(`seed ${t.seed}: ${e.name}#${e.id} mustered into unexplored room ${e.room}`);
        }
        if (fromEntry.at(e.room) < MIN_SPAWN_DOORS) {
          offences.push(
            `seed ${t.seed}: ${e.name}#${e.id} mustered ${fromEntry.at(e.room)} doors from the airlock`,
          );
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });
});

// ----------------------------------------------------------------- the dead

describe("a drone that died is still aboard", () => {
  it("leaves its wreckage in the compartment it died in", () => {
    // The rack is recoverable, and where it is recoverable from is the whole
    // deal the design makes with the player: the compartment it happened in,
    // not the airlock and not the ghost's. A drone whose rack had already
    // burned out leaves nothing, and that is the record saying so — which is
    // why the count comes off the death record rather than being assumed.
    const offences: string[] = [];
    for (const t of trips) {
      for (const death of t.c.deaths) {
        if (death.modules === 0) continue;
        const wrecks = [...(t.c.contents.get(death.room) ?? [])].filter((s) => s.startsWith("wrecks:"));
        if (wrecks.length === 0) {
          offences.push(
            `seed ${t.seed}: a drone with ${death.modules} modules died in room ${death.room} and left nothing`,
          );
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("raises its ghost within two doors of the wreckage", () => {
    const offences: string[] = [];
    for (const t of trips) {
      const ghosts = t.c.entities.filter((e) => e.ghost && e.alive);
      if (ghosts.length === 0) continue;
      if (t.c.deaths.length === 0) {
        offences.push(`seed ${t.seed}: ${ghosts.length} ghost(s) aboard and no death recorded`);
        continue;
      }
      const ship = t.game.ships.get(t.shipId)!.ship;
      const walk: DoorFilter = (d) => ship.passable(d, {});
      const fromDeaths = RoomDistance.from(ship, t.c.deaths.map((d) => d.room), walk);
      for (const ghost of ghosts) {
        if (ghost.room === undefined || fromDeaths.at(ghost.room) > GHOST_MAX_DOORS) {
          offences.push(
            `seed ${t.seed}: ghost#${ghost.id} rose ${fromDeaths.at(ghost.room!)} doors from any wreck`,
          );
        }
      }
    }
    expect(report(offences)).toEqual([]);
  });

  it("never forgets a death once it has happened", () => {
    const offences = trips
      .filter((t) => t.c.deaths.length < t.b.deaths.length)
      .map((t) => `seed ${t.seed}: ${t.b.deaths.length} deaths became ${t.c.deaths.length}`);
    expect(report(offences)).toEqual([]);
  });
});

// ------------------------------------------------------ the record of the run

/**
 * The voyage record, as a save file would have to carry it.
 *
 * Everything above is about a *ship* in `RoomGame.ships`; this is about the one
 * thing that outlives every ship — `player.data.voyage`: the account, the hold,
 * the itinerary, the charters signed and what has been paid for. SALVOR ships
 * no save file (design-doc.md, "Явно НЕ входит"), and a run is reproduced from
 * `(seed, inputs)` instead — but that promise is only half kept if the record a
 * replay rebuilds could not be written down at all.
 *
 * Measured here rather than in `fuzz.test.ts` because these voyages have been
 * somewhere: a hull boarded twice, drones lost, charters signed and filled.
 */
describe("the run's record is data a save could carry", () => {
  it("survives a JSON round trip with nothing lost or changed", () => {
    const offences: string[] = [];

    for (const t of trips) {
      const voyage = recordOf(t.game);
      if (voyage === undefined) {
        offences.push(`seed ${t.seed}: no voyage record at all`);
        continue;
      }
      let text: string;
      try {
        text = JSON.stringify(voyage);
      } catch (error) {
        offences.push(`seed ${t.seed}: not serialisable — ${String(error)}`);
        continue;
      }
      // `toEqual` and not `toStrictEqual`: a field written as `undefined` —
      // `hull`, once the drone is lost — is simply absent after the trip, and
      // absent is what it means. `NaN` against `null` still fails, which is the
      // failure worth catching.
      try {
        expect(JSON.parse(text)).toEqual(voyage);
      } catch {
        offences.push(`seed ${t.seed}: changed on a JSON round trip\n${text.slice(0, 300)}`);
      }
    }

    expect(report(offences)).toEqual([]);
  });

  it("holds no functions anywhere in it, charters included", () => {
    // A charter used to carry its own `done` predicate, which is a field
    // `JSON.stringify` drops without a word: a restored voyage would have held
    // jobs that could never be counted as filled. `content/charters.ts` answers
    // that with a table now (`doneBy`), and this is the guard on it — for the
    // charters and for whatever the record grows later.
    const found = new Set<string>();
    let boards = 0;

    for (const t of trips) {
      const voyage = recordOf(t.game);
      for (const path of functionsIn(voyage)) found.add(path);
      boards += chartersIn(voyage);
    }

    expect([...found].sort()).toEqual([]);
    // And the scan is walking records that actually have charters in them.
    expect(boards).toBeGreaterThan(0);
  });
});

/** The run's record as it stands, read structurally so a missing one stays missing. */
function recordOf(game: RoomGame): Record<string, unknown> | undefined {
  const raw = game.player.data?.voyage;
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
}

/** Paths holding a function, with array indices collapsed: two charters read as one place. */
function functionsIn(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((v) => functionsIn(v, `${path}[]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => functionsIn(v, path === "" ? k : `${path}.${k}`));
}

/** Jobs on the board plus jobs signed: what makes a record worth scanning. */
function chartersIn(voyage: Record<string, unknown> | undefined): number {
  return [voyage?.offered, voyage?.charters].reduce<number>(
    (n, list) => n + (Array.isArray(list) ? list.length : 0),
    0,
  );
}

// -------------------------------------------------------------- the census

describe("the property is measured on enough voyages to mean something", () => {
  it("gets most seeds through two entries into one derelict", () => {
    const census: Record<string, number> = {};
    for (const s of skips) census[s] = (census[s] ?? 0) + 1;
    const died = trips.filter((t) => t.died).length;
    console.log(
      `persistence  voyages=${results.length} trips=${trips.length} ` +
        `died=${died} home=${trips.length - died} skipped=${JSON.stringify(census)}`,
    );

    expect(trips.length / results.length).toBeGreaterThan(0.6);
  });

  it("measures both ways out of a derelict", () => {
    // The airlock and the body bag are different code on the way out, and both
    // have to leave a hull the next sortie can walk into. Neither pass alone
    // proves that.
    //
    // The two are not the even split they were. G30's balance pass is a pass
    // about surviving a sortie, and it worked twice over: the body bag went
    // from most of these voyages to 23 of 394 when the cost of a fight came
    // down, and to 18 of 387 when the hunter moved off the first system the
    // drone brings online. What this guard needs is "enough of each to be a
    // sample", not "half" — fifteen is that, and under it the property below is
    // measuring one way out of a derelict rather than two.
    const died = trips.filter((t) => t.died).length;
    expect(died, `only ${died} of ${trips.length} trips ended in the body bag`).toBeGreaterThan(15);
    expect(trips.length - died).toBeGreaterThan(SEEDS.length / 2);
  });

  it("measures voyages where the sortie actually changed the ship", () => {
    // Every assertion above passes on a sortie that walked in and straight out
    // again. This is the guard that the property has something to be a property
    // of: doors moved, things were taken, machines died.
    const changed = trips.filter((t) => {
      const doors = [...t.a.doors].some(([id, state]) => t.b.doors.get(id) !== state);
      const taken = [...t.a.contents].some(([room, before]) => {
        const left = t.b.contents.get(room) ?? new Set<string>();
        return [...before].some((item) => !left.has(item));
      });
      return doors || taken;
    });
    expect(changed.length / Math.max(1, trips.length)).toBeGreaterThan(0.5);
  });

  it("reaches the between-sortie machinery at all", () => {
    // Reinforcements, ghosts and trails only exist on a second entry, and a
    // property that never triggers any of them is a property about nothing.
    const mustered = trips.filter((t) => t.c.entities.length > t.b.entities.length);
    expect(mustered.length).toBeGreaterThan(0);
  });
});
