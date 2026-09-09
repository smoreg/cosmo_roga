import { describe, it, expect } from "vitest";
import {
  KEY_MARK,
  LOCK_ENTRY,
  RoomGame,
  Rng,
  reachableWithKeys,
  validateShip,
  type CardContext,
  type Door,
  type Entity,
  type MonsterKind,
  type Room,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import { TEST_ROOM_CONTENT, makeTestDrone, shipFromText } from "@jamrog/engine/testing";
import { ZONE_KINDS, zoneKind, isZoneKind, ENTRY_KIND } from "../src/content/zones.js";
import { CARDS, CARDS_PER_ROOM, CARD_MODULE, CLASS_FLAG, SALVAGE_POOL } from "../src/content/cards.js";
import {
  DERELICTS,
  FATHERS_TUG,
  buildChartered,
  specOfShip,
  type DerelictSpec,
} from "../src/content/derelicts.js";
import { MODULES, type ModuleId } from "../src/content/modules.js";
import { SYSTEM_GLYPH } from "../src/content/objectives.js";
import {
  FREIGHTER,
  buildDerelict,
  derelictShip,
  shipSpecOf,
} from "../src/content/derelicts.js";
import { MAX_MACHINES, MONSTERS, machineByName } from "../src/content/monsters.js";
import { SALVOR } from "../src/game.js";
import { cratePrice } from "../src/systems/voyage.js";
import {
  POPULATE,
  roomList,
  type Body,
  type Crate,
  type RoomItem,
  type ShipSystem,
  type Wreck,
} from "../src/systems/populate.js";

/**
 * The content half of a derelict: a catalogue of compartments, a deck of cards,
 * and the system that turns what the generator left into things to act on.
 *
 * The generator's own guarantees are tested in the engine; what is tested here
 * is that this game's data satisfies them — that every card names a compartment
 * that exists, that the first freighter of a voyage is the ship the onboarding
 * assumes (one locked door, a key in front of it, scrap where the drone lands),
 * and that a mark becomes exactly one thing exactly once.
 */

const SEEDS = 200;
const FREQUENCY_SEEDS = 300;

const NO_RUN: CardContext = { flags: new Set<string>(), shipIndex: 0 };

/** The engine's own bestiary, with its random spawns switched off: what a test
 * counts should be what the marks put there and nothing else. */
const QUIET = { ...TEST_ROOM_CONTENT, monsterChance: () => 0 };

/** The tutorial machine, by the id the docking bay card asks for. */
const SCOUT: MonsterKind = {
  id: "scout", name: "scout", ch: "c", fg: "#7fb2ff", hp: 3, damage: [1, 2, 0],
  defense: 0, speed: 120, fovRadius: 10, behaviour: "brute", sight: 1,
  minDepth: 0, maxDepth: 99, weight: 8,
};

/**
 * A band with something in it at every depth, the airlock included. What
 * `m`, `M` and `m:scout` become is `content/monsters.ts`, which is G35's; what
 * this file has to prove is that every machine mark becomes exactly one
 * machine, and for that the catalogue only has to answer.
 */
const FULL_BAND = {
  ...QUIET,
  monstersForDepth: (depth: number) => [...TEST_ROOM_CONTENT.monstersForDepth(depth), SCOUT],
};

function freighter(seed: number): Ship {
  return derelictShip(FREIGHTER, 0, new Rng(seed), NO_RUN);
}

/** A drone whose rig the cards can read. */
function droneWith(burned: string[], filled: number): Entity {
  const drone = makeTestDrone();
  const slots: Array<{ kind: string } | null> = [];
  for (let i = 0; i < 6; i++) slots.push(i < filled ? { kind: "plating" } : null);
  drone.data = { rig: { slots, burned } };
  return drone;
}

/** Rooms reachable from the airlock without opening anything that needs a key. */
function reachableUnlocked(ship: Ship): Set<RoomId> {
  const seen = new Set<RoomId>([ship.entry]);
  const queue: RoomId[] = [ship.entry];
  const open = (d: Door): boolean => d.state === "open" || d.state === "closed" || d.state === "broken";
  for (let head = 0; head < queue.length; head++) {
    for (const { door, room } of ship.neighbours(queue[head]!)) {
      if (room.id === queue[head]! || seen.has(room.id) || !open(door)) continue;
      seen.add(room.id);
      queue.push(room.id);
    }
  }
  return seen;
}

function marksOf(ship: Ship): string[] {
  return ship.rooms.flatMap((r) => r.marks);
}

/** A game on a hand-written ship, with the marks turned into things. */
function gameOn(text: string, seed = 1): RoomGame {
  return new RoomGame({
    seed,
    content: QUIET,
    systems: [POPULATE],
    firstShip: () => shipFromText(text).ship,
  });
}

function roomOf(game: RoomGame, label: string): Room {
  return game.ship.room(label);
}

function machinesIn(game: RoomGame, label: string): number {
  const room = roomOf(game, label);
  return game.entitiesIn(room.id).filter((e) => e.id !== game.player.id).length;
}

// --------------------------------------------------------------- the deck

describe("the card deck", () => {
  it("names only compartments the catalogue has", () => {
    for (const card of CARDS) {
      for (const kind of card.kinds ?? []) {
        expect(isZoneKind(kind), `${card.name} -> ${kind}`).toBe(true);
      }
    }
  });

  it("names only modules the drone can carry", () => {
    for (const card of CARDS) {
      for (const mark of card.marks) {
        const [head, module] = mark.split(":");
        if (head !== "X" && head !== "%") continue;
        if (module === undefined) continue;
        expect(SALVAGE_POOL, `${card.name} -> ${mark}`).toContain(module);
      }
    }
  });

  it("agrees with CARD_MODULE both ways", () => {
    for (const card of CARDS) {
      const salvage = card.marks
        .map((m) => m.split(":"))
        .filter(([head]) => head === "X" || head === "%")
        .map(([, module]) => module);
      const named = CARD_MODULE[card.name];

      if (named === undefined) {
        // A card the table does not mention leaves a lottery or no salvage.
        expect(salvage.every((m) => m === undefined), card.name).toBe(true);
        continue;
      }
      expect(salvage.length, card.name).toBeGreaterThan(0);
      for (const module of salvage) expect(module, card.name).toBe(named);
    }
  });

  it("gives every 'always' card room to land beside the other one", () => {
    // Two pinned cards may share a compartment (a reactor holds both its core
    // and its antechamber), and each needs a slot of its own.
    expect(CARDS_PER_ROOM).toBeGreaterThanOrEqual(2);
  });

  it("caps every card that raises a run flag", () => {
    for (const card of CARDS) {
      if (!card.sets || card.sets.length === 0) continue;
      expect(card.maxPerShip, card.name).toBe(1);
    }
  });

  it("reads the drone's keyring the way the drone keeps it", () => {
    // One number, not a list of cards (`systems/doors.ts`, `keysHeld`). Read as
    // a list it was always zero, and the one card that asks for a keycard could
    // never come up on a drone that had nothing else the lock wanted.
    const hold = CARDS.find((c) => c.name === "hidden hold")!;
    const smuggler = (keys: unknown): CardContext => {
      const drone = makeTestDrone();
      drone.data = { rig: { slots: [null], burned: [] }, keys };
      return { flags: new Set([`${CLASS_FLAG}smuggler`]), player: drone, shipIndex: 1 };
    };
    expect(hold.when!(smuggler(0))).toBe(false);
    expect(hold.when!(smuggler(1))).toBe(true);
  });
});

describe("the compartment catalogue", () => {
  it("holds twenty-two kinds, each named once", () => {
    expect(ZONE_KINDS).toHaveLength(22);
    expect(new Set(ZONE_KINDS.map((z) => z.kind)).size).toBe(22);
  });

  it("requires the three systems' compartments and keeps two of them deep", () => {
    expect(ZONE_KINDS.filter((z) => z.required).map((z) => z.kind)).toEqual([
      "engineering", "reactor", "control",
    ]);
    expect(ZONE_KINDS.filter((z) => z.deep).map((z) => z.kind)).toEqual(["reactor", "control"]);
  });

  it("offers cover in the six compartments that have something to hide behind", () => {
    expect(ZONE_KINDS.filter((z) => z.cover).map((z) => z.kind).sort()).toEqual([
      "armory", "cargo", "hydroponics", "maintenance", "storage", "workshop",
    ]);
  });

  it("refuses a compartment it does not know", () => {
    expect(() => zoneKind("galley")).toThrow();
  });
});

// ------------------------------------------------------------ the freighter

describe("the first freighter of a voyage", () => {
  it("is built out of the catalogue, systems included", () => {
    for (const kind of FREIGHTER.kinds) expect(isZoneKind(kind), kind).toBe(true);
    for (const required of ZONE_KINDS.filter((z) => z.required)) {
      expect(FREIGHTER.kinds, required.kind).toContain(required.kind);
    }
    expect(shipSpecOf(FREIGHTER).kinds.map((k) => k.kind)).toEqual([...FREIGHTER.kinds]);
    expect(shipSpecOf(FREIGHTER).entryKind).toBe(ENTRY_KIND);
  });

  it("passes every invariant on 200 seeds", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const built = buildDerelict(FREIGHTER, 0, new Rng(seed), NO_RUN);
      expect(built.problems, `seed ${seed}`).toEqual([]);
      expect(validateShip(built.ship, shipSpecOf(FREIGHTER)), `seed ${seed}`).toEqual([]);
      expect(built.ship.size, `seed ${seed}`).toBeGreaterThanOrEqual(FREIGHTER.rooms[0]);
      expect(built.ship.size, `seed ${seed}`).toBeLessThanOrEqual(FREIGHTER.rooms[1]);
    }
  });

  it("lands the drone in a docking bay at depth 0", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = freighter(seed);
      const entry = ship.roomAt(ship.entry);
      expect(entry.kind, `seed ${seed}`).toBe(ENTRY_KIND);
      expect(entry.depth, `seed ${seed}`).toBe(0);
      expect(ship.rooms.filter((r) => r.kind === ENTRY_KIND), `seed ${seed}`).toHaveLength(1);
    }
  });

  it("has exactly one locked door, with its key on the near side of it", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = freighter(seed);
      const locked = ship.doors.filter((d) => d.state === "locked");
      expect(locked.length, `seed ${seed}`).toBe(1);

      const key = locked[0]!.key;
      expect(key, `seed ${seed}`).toBeDefined();
      const holder = ship.rooms.find((r) => r.marks.includes(`${KEY_MARK}${key}`));
      expect(holder, `seed ${seed}`).toBeDefined();
      expect(reachableUnlocked(ship).has(holder!.id), `seed ${seed}`).toBe(true);
      expect(reachableWithKeys(ship).rooms.size, `seed ${seed}`).toBe(ship.size);
    }
  });

  it("leaves scrap in the room the drone lands in", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = freighter(seed);
      const entry = ship.roomAt(ship.entry);
      expect(entry.marks, `seed ${seed}`).toContain("%:welder");
      expect(entry.marks, `seed ${seed}`).toContain("m:scout");
    }
  });

  it("carries exactly one engine, one core and one terminal", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const marks = marksOf(freighter(seed));
      for (const mark of ["E", "O", "T"]) {
        expect(marks.filter((m) => m === mark).length, `seed ${seed} mark ${mark}`).toBe(1);
      }
      expect(marks.filter((m) => m === LOCK_ENTRY).length, `seed ${seed}`).toBe(1);
    }
  });

  it("keeps its docking bay for the first ship of the voyage only", () => {
    const later = derelictShip(FREIGHTER, 1, new Rng(7), NO_RUN);
    expect(later.roomAt(later.entry).marks).not.toContain("m:scout");
  });

  it("generates the same ship from the same seed", () => {
    const a = freighter(42);
    const b = freighter(42);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });
});

// ------------------------------------------------------------------- the hold

/**
 * What a hull is carrying, in credits, on 200 seeds of each of the seven
 * classes.
 *
 * The whole of G41's first defect: until it, `X` was a crate of *modules*,
 * `contraband` belonged to the smuggler alone and the only plain `cargo` in the
 * deck was pinned to the first ship of a voyage — so a hull's entire income was
 * three credits a body against 40 CR for the next drone, and G30 measured the
 * first sortie repaying its hull on none of 32 seeds.
 *
 * Counted in front of the locks, which is the half that matters: a laboratory
 * locks a quarter of its doors, and freight only behind them is freight a drone
 * that has not found a keycard yet never sees.
 */
describe("what a hull is carrying", () => {
  /** Where in the itinerary a class is flown: the freighter first, the tug last. */
  function indexOf(spec: DerelictSpec): number {
    return spec.id === FREIGHTER.id ? 0 : spec.id === FATHERS_TUG.id ? 2 : 1;
  }

  /** Credits of freight lying in these compartments, at the tug's own prices. */
  function freight(ship: Ship, rooms: ReadonlySet<RoomId>): number {
    let cr = 0;
    for (const room of ship.rooms) {
      if (!rooms.has(room.id)) continue;
      for (const mark of room.marks) {
        if (mark === "cargo" || mark === "contraband") cr += cratePrice({ id: 0, kind: mark });
      }
    }
    return cr;
  }

  interface Carried {
    /** In front of every lock: what a drone with no keycard can reach. */
    unlocked: number[];
    /** With the keycards the ship itself leaves in reach, and no cutting. */
    keyed: number[];
  }

  /** One sweep of 200 × 7 hulls, read by the three thresholds below. */
  const carried = new Map<string, Carried>();
  for (const spec of DERELICTS) {
    const out: Carried = { unlocked: [], keyed: [] };
    const index = indexOf(spec);
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = buildChartered(spec, index, new Rng(seed), { flags: new Set(), shipIndex: index }).ship;
      out.unlocked.push(freight(ship, reachableUnlocked(ship)));
      out.keyed.push(freight(ship, reachableWithKeys(ship).rooms));
    }
    carried.set(spec.id, out);
  }

  const median = (v: readonly number[]): number => {
    const s = [...v].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
  };
  const share = (v: readonly number[], least: number): number =>
    v.filter((cr) => cr >= least).length / v.length;

  /** The floor of the band, and what the sortie is measured against. */
  const FLOOR = 30;

  it("leaves 30-50 CR of it in front of the locks, on every class", () => {
    // Both ends are the threshold. Under the first the sortie cannot repay the
    // hull that flew it; over the second a voyage is funded by walking into the
    // first four compartments of anything, and how deep to go stops being a
    // decision (design-doc.md, "Экономика рейса"). Measured: a median of 36 CR
    // on the military hull, 40 on five of them and 48 on the freighter, which
    // is the one hull with a pinned manifest as well as its own holds.
    for (const spec of DERELICTS) {
      const { unlocked } = carried.get(spec.id)!;
      const where = `${spec.id}: median ${median(unlocked)} CR unlocked`;
      expect(median(unlocked), where).toBeGreaterThanOrEqual(30);
      expect(median(unlocked), where).toBeLessThanOrEqual(50);
    }
  });

  it("keeps most seeds of every class inside that band and not just the median", () => {
    // Measured: 65-93 % of seeds by class. The ones under it are hulls whose
    // locked bulkhead came out at the root of the tree — a laboratory can put
    // a quarter of itself behind one door — and the line below is what answers
    // for those.
    for (const spec of DERELICTS) {
      const { unlocked } = carried.get(spec.id)!;
      const where = `${spec.id}: ${(share(unlocked, FLOOR) * 100).toFixed(0)} % of seeds ≥ ${FLOOR} CR`;
      expect(share(unlocked, FLOOR), where).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("puts the rest of it behind doors whose keys are aboard", () => {
    // The same hulls read by a drone with no cutter that picks up whatever
    // keycards the ship left in reach: 99-100 % of seeds by class carry at
    // least 30 CR, the median is 48, and the poorest seed of any class is 24.
    for (const spec of DERELICTS) {
      const { keyed } = carried.get(spec.id)!;
      const where = `${spec.id}: min ${Math.min(...keyed)} CR, median ${median(keyed)} CR with keys`;
      expect(share(keyed, FLOOR), where).toBeGreaterThanOrEqual(0.95);
      expect(Math.min(...keyed), where).toBeGreaterThanOrEqual(24);
    }
  });
});

// -------------------------------------------------------------------- marks

const FIXTURE = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3
  r2 -d3- r4
  r1: docking %:welder X:scanner m:grunt m:nothing-like-this
  r2: cargo m M † †:key key:k1 * &
  r3: engineering E cover vented
  r4: reactor O contraband %:cell:2
`;

describe("marks becoming things", () => {
  it("puts exactly what the marks asked for in each compartment", () => {
    const game = gameOn(FIXTURE);

    const entry = roomOf(game, "r1");
    // Scrap and a parts crate lie in the same list: the rig strips both with
    // the same verb, and only the glyph and the integrity tell them apart.
    const salvage = roomList<Wreck>(entry, "wrecks");
    expect(salvage).toHaveLength(2);
    expect(salvage[0]).toMatchObject({ kind: "welder", glyph: "%" });
    expect(salvage[0]!.integrity).toBeLessThanOrEqual(3);
    expect(salvage[1]).toMatchObject({
      kind: "scanner",
      glyph: "X",
      integrity: MODULES.scanner.integrity,
    });
    expect(roomList<Crate>(entry, "crates")).toHaveLength(0);

    const hold = roomOf(game, "r2");
    expect(roomList<Body>(hold, "bodies")).toHaveLength(2);
    expect(roomList<RoomItem>(hold, "items").map((i) => i.kind)).toEqual(["charter-item", "console"]);

    const engineering = roomOf(game, "r3");
    expect(roomList<ShipSystem>(engineering, "systems")).toEqual([
      { id: expect.any(Number), kind: "engine", online: false, glyph: SYSTEM_GLYPH },
    ]);
    expect(engineering.cover).toBe(true);
    expect(engineering.hazard).toBe("vented");

    const reactor = roomOf(game, "r4");
    expect(roomList<ShipSystem>(reactor, "systems")[0]!.kind).toBe("core");
    expect(roomList<Crate>(reactor, "crates")[0]!.kind).toBe("contraband");
    expect(roomList<Wreck>(reactor, "wrecks")[0]).toMatchObject({ kind: "cell", integrity: 2 });
  });

  it("spawns one machine per machine mark, and nothing for a machine it has never heard of", () => {
    const game = gameOn(FIXTURE);
    // r1 is at depth 0, where the band is empty: `m:grunt` is the tutorial's
    // "this machine, wherever it normally stands".
    expect(machinesIn(game, "r1")).toBe(1);
    expect(machinesIn(game, "r2")).toBe(2);
    expect(machinesIn(game, "r3")).toBe(0);
  });

  it("hands the key to the body the card marked, and never to two of them", () => {
    const game = gameOn(FIXTURE);
    const bodies = roomList<Body>(roomOf(game, "r2"), "bodies");
    const holders = bodies.filter((b) => b.key !== undefined);
    expect(holders).toHaveLength(1);
    expect(holders[0]!.key).toBe("k1");
    // `†:key` is the second body of the room, and the one the card meant.
    expect(holders[0]!.id).toBe(bodies[1]!.id);
  });

  it("makes a body for a key that landed in a room with no dead in it", () => {
    const game = gameOn(`
      TUG -a1- r1
      r1 -d1- r2
      r1: docking
      r2: storage key:k9
    `);
    const bodies = roomList<Body>(roomOf(game, "r2"), "bodies");
    expect(bodies).toEqual([{ id: expect.any(Number), searched: false, key: "k9" }]);
  });

  it("numbers everything on the ship uniquely", () => {
    const game = gameOn(FIXTURE);
    const ids = game.ship.rooms.flatMap((room) => [
      ...roomList<Wreck>(room, "wrecks"),
      ...roomList<Crate>(room, "crates"),
      ...roomList<Body>(room, "bodies"),
      ...roomList<ShipSystem>(room, "systems"),
      ...roomList<RoomItem>(room, "items"),
    ].map((thing) => thing.id));

    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
    // And clear of the doors: `act spike {target}` and `act salvage {target}`
    // read the same number, so a crate that shared an id with a bulkhead would
    // be a coin toss over which one the command meant.
    const doors = game.ship.doors.map((d) => d.id);
    for (const id of ids) expect(doors).not.toContain(id);
  });

  it("does not fill a compartment twice when the drone comes back aboard", () => {
    const game = gameOn(FIXTURE);
    const before = JSON.stringify(game.ship.rooms.map((r) => r.data));
    const machines = game.entities.length;

    game.travelTo("2", { generate: () => shipFromText(FIXTURE).ship });
    game.travelTo("1", { generate: () => shipFromText(FIXTURE).ship });

    expect(game.currentShip.visits).toBe(2);
    expect(JSON.stringify(game.ship.rooms.map((r) => r.data))).toBe(before);
    expect(game.entities.length).toBe(machines);
  });
});

describe("a whole freighter, populated", () => {
  it("holds exactly what its marks asked for, compartment by compartment", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = new RoomGame({
        seed,
        content: FULL_BAND,
        systems: [POPULATE],
        firstShip: (rng) => derelictShip(FREIGHTER, 0, rng, NO_RUN),
      });

      for (const room of game.ship.rooms) {
        const heads = room.marks.map((m) => m.split(":")[0]!);
        const count = (head: string): number => heads.filter((h) => h === head).length;
        const where = `seed ${seed} ${room.label} [${room.marks.join(" ")}]`;

        const salvageMarks = count("%") + count("X");
        // The entry room is the one place something arrives without a mark:
        // the onboarding pile, when the docking bay card left none.
        const extraScrap = room.id === game.ship.entry && salvageMarks === 0 ? 1 : 0;

        expect(roomList<Wreck>(room, "wrecks").length, `${where} wrecks`).toBe(
          salvageMarks + extraScrap,
        );
        // Both crate marks: what the hull was hauling and what it was not
        // declaring (`cargo manifest`, `hidden hold`).
        expect(roomList<Crate>(room, "crates").length, `${where} crates`).toBe(
          count("cargo") + count("contraband"),
        );
        expect(roomList<ShipSystem>(room, "systems").length, `${where} systems`).toBe(
          count("E") + count("O") + count("T"),
        );
        expect(roomList<RoomItem>(room, "items").length, `${where} items`).toBe(
          count("*") + count("&"),
        );
        // A key that lands where nobody died brings its own body with it.
        expect(roomList<Body>(room, "bodies").length, `${where} bodies`).toBe(
          Math.max(count("†"), count("key")),
        );
        // Machines are the one thing a compartment can hold that no card put
        // there: the ship's budget tops the deck up (`DerelictSpec.machines`).
        // A compartment the deck did mark holds exactly what it asked for, and
        // one it did not holds at most a single machine of the budget's.
        const machineMarks = count("m") + count("M");
        const machines = game.entitiesIn(room.id).filter((e) => e.id !== game.player.id).length;
        if (machineMarks > 0) {
          expect(machines, `${where} machines`).toBe(machineMarks);
        } else {
          expect(machines, `${where} machines`).toBeLessThanOrEqual(1);
          // And never in the airlock compartment or the one next door: the
          // budget starts two doors in (design-doc.md, "Обучение конструкцией").
          if (machines > 0) expect(room.depth, `${where} filler depth`).toBeGreaterThanOrEqual(2);
        }

        for (const wreck of roomList<Wreck>(room, "wrecks")) {
          expect(SALVAGE_POOL, where).toContain(wreck.kind);
          expect(["%", "X"], where).toContain(wreck.glyph);
          expect(wreck.integrity, where).toBeGreaterThanOrEqual(1);
          // Scrap is worn; a crate is the module's own base, whatever the
          // catalogue says that is.
          expect(wreck.integrity, where).toBeLessThanOrEqual(
            wreck.glyph === "%" ? 3 : MODULES[wreck.kind as ModuleId].integrity,
          );
        }
        for (const crate of roomList<Crate>(room, "crates")) {
          expect(["cargo", "contraband"], where).toContain(crate.kind);
        }
      }
    }
  });

  it("stands up its three systems and the scrap the onboarding needs", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const game = new RoomGame({
        seed,
        content: QUIET,
        systems: [POPULATE],
        firstShip: (rng) => derelictShip(FREIGHTER, 0, rng, NO_RUN),
      });

      const systems = game.ship.rooms.flatMap((r) => roomList<ShipSystem>(r, "systems"));
      expect(systems.map((s) => s.kind).sort(), `seed ${seed}`).toEqual(["core", "engine", "terminal"]);
      expect(systems.every((s) => !s.online), `seed ${seed}`).toBe(true);

      const entry = game.ship.roomAt(game.ship.entry);
      expect(roomList<Wreck>(entry, "wrecks").length, `seed ${seed}`).toBeGreaterThan(0);

      const bodies = game.ship.rooms.flatMap((r) => roomList<Body>(r, "bodies"));
      const locked = game.ship.doors.filter((d) => d.state === "locked");
      expect(bodies.filter((b) => b.key === locked[0]!.key), `seed ${seed}`).toHaveLength(1);
    }
  });
});

// ------------------------------------------------------- one budget of machines

/**
 * The defect the v3-core gate found and what stops it coming back: the deck and
 * the engine's own per-room roll were two spawners that could not see each
 * other, and a freighter came out holding twelve to fifteen machines over
 * twelve to fourteen compartments (`docs/tasks/G38-gate-v3-core.md`). There is
 * one budget per hull class now, and everything that puts a machine aboard
 * spends it.
 */
describe("the machines a hull class carries", () => {
  /** The shipped bestiary and the shipped deck, with nothing else running. */
  function populated(seed: number): RoomGame {
    return new RoomGame({
      seed,
      content: SALVOR,
      systems: [POPULATE],
      firstShip: (rng) => derelictShip(FREIGHTER, 0, rng, NO_RUN),
    });
  }

  function machinesAboard(game: RoomGame): Entity[] {
    return game.entities.filter((e) => e.id !== game.player.id);
  }

  it("names machines the bestiary has, in every class's band", () => {
    // `enforcer` is the standing exception, and the father's tug is the only
    // band that names it: it is not in `MONSTERS` and no roll may produce it —
    // the ship's alert is what sends one (`content/monsters.ts`, `ENFORCER`).
    for (const spec of DERELICTS) {
      for (const id of spec.band.filter((b) => b !== "enforcer")) {
        expect(MONSTERS.map((m) => m.id), `${spec.id} -> ${id}`).toContain(id);
      }
    }
  });

  it("keeps every class's budget inside the ceiling one ship may hold", () => {
    for (const spec of DERELICTS) {
      const [min, max] = spec.machines;
      expect(min, spec.id).toBeGreaterThanOrEqual(0);
      expect(min, spec.id).toBeLessThanOrEqual(max);
      expect(max, spec.id).toBeLessThanOrEqual(MAX_MACHINES);
    }
  });

  it("leaves the engine nothing to roll: the pack's own chance is zero", () => {
    // `RoomGame.populate()` runs before a single card mark has been executed,
    // so a chance per compartment cannot know what the deck is about to place.
    // The budget is the game's to spend, and this is how the engine is told so.
    for (let depth = 0; depth <= 8; depth++) expect(SALVOR.monsterChance(depth)).toBe(0);
  });

  it("never asks the deck for more machines than the budget allows", () => {
    // The deck is authored and capped per ship, so it can be checked on its own,
    // and it has to be: the budget tops a ship up and never takes anything away,
    // so a deck that outgrew it would quietly become the ceiling. Both cards
    // that place several machines at once are `maxPerShip` for this reason.
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = buildChartered(spec, 1, new Rng(seed), NO_RUN).ship;
        const marks = marksOf(ship).filter((m) => m === "m" || m === "M" || m.startsWith("m:"));
        expect(marks.length, `${spec.id} seed ${seed} [${marks.join(" ")}]`)
          .toBeLessThanOrEqual(spec.machines[1]);
      }
    }
  });

  it("puts as many aboard as the class says, and no more", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const machines = machinesAboard(populated(seed)).length;
      expect(machines, `seed ${seed}`).toBeGreaterThanOrEqual(FREIGHTER.machines[0]);
      expect(machines, `seed ${seed}`).toBeLessThanOrEqual(FREIGHTER.machines[1]);
    }
  });

  it("fields only what the freighter's band holds", () => {
    // design-doc.md, "Типы дереликтов" gives the freighter `m` `d` `c`. Before
    // the band was read, `M` on this hull was a security unit at depth two and
    // a hauler with fourteen hit points at depth four.
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const machine of machinesAboard(populated(seed))) {
        const kind = MONSTERS.find((m) => m.name === machine.name);
        expect(FREIGHTER.band, `seed ${seed} ${machine.name}`).toContain(kind?.id);
      }
    }
  });

  it("stands one weak machine in the docking bay and nothing else that near", () => {
    // The onboarding is one scout and one pile of scrap in the room the drone
    // lands in (design-doc.md, "Обучение конструкцией", 2). Whatever else the
    // budget buys starts two doors in, so the first fight is one fight.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = populated(seed);
      const entry = game.ship.roomAt(game.ship.entry);
      const first = machinesAboard(game).filter((m) => m.room === entry.id);
      expect(first.map((m) => m.name), `seed ${seed}`).toEqual(["scout"]);

      // One door in, only a card may stand something — and on a freighter the
      // one card that does puts it behind the ship's single locked bulkhead.
      for (const room of game.ship.rooms.filter((r) => r.depth === 1)) {
        const held = machinesAboard(game).filter((m) => m.room === room.id).length;
        const marked = room.marks.filter((m) => m === "m" || m === "M").length;
        expect(held, `seed ${seed} ${room.label} [${room.marks.join(" ")}]`).toBe(marked);
      }
    }
  });

  it("gives every hull of the voyage its own band and its own budget", () => {
    // The six classes G25 added come through `buildChartered`, a second builder
    // of ships: a hull it handed back without a class stamp would be a hull
    // with no band and no budget, and the whole voyage after the freighter
    // would be populated by the deck alone.
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 10; seed++) {
        const game = new RoomGame({
          seed,
          content: SALVOR,
          systems: [POPULATE],
          firstShip: (rng) => buildChartered(spec, spec.id === FREIGHTER.id ? 0 : 1, rng, NO_RUN).ship,
        });
        const where = `${spec.id} seed ${seed}`;

        expect(specOfShip(game.ship)?.id, where).toBe(spec.id);
        const machines = machinesAboard(game);
        expect(machines.length, where).toBeGreaterThanOrEqual(spec.machines[0]);
        expect(machines.length, where).toBeLessThanOrEqual(spec.machines[1]);

        for (const machine of machines) {
          // By name over everything that can be aboard, not over the depth
          // catalogue: the father's tug fields the ENFORCER, and no roll
          // anywhere produces one (`content/monsters.ts`).
          const kind = machineByName(machine.name);
          expect(spec.band, `${where} ${machine.name}`).toContain(kind?.id);
        }
      }
    }
  });

  it("gives a hull nobody built no class, and so no band and no budget", () => {
    // A ship drawn by hand in a test is not a derelict of any class: what it
    // holds is what its own text asked for, and the budget never adds to it.
    const drawn = shipFromText(FIXTURE).ship;
    expect(specOfShip(drawn)).toBeUndefined();
    expect(specOfShip(freighter(3))?.id).toBe("freighter");

    const game = gameOn(FIXTURE);
    const marks = game.ship.rooms.flatMap((r) => r.marks).filter((m) => m === "m" || m === "M" || m.startsWith("m:"));
    // `m:nothing-like-this` names a machine no build has, and spawns none.
    expect(machinesAboard(game).length).toBe(marks.length - 1);
  });
});

// -------------------------------------------------------- the ship answering

describe("a ship built out of what the run has cost", () => {
  it("offers the sensor closet far more often once the scanner has burned", () => {
    const closets = (drone: Entity): { ships: number; total: number } => {
      let ships = 0;
      let total = 0;
      for (let seed = 1; seed <= FREQUENCY_SEEDS; seed++) {
        const ctx: CardContext = { flags: new Set<string>(), player: drone, shipIndex: 0 };
        const placed = buildDerelict(FREIGHTER, 0, new Rng(seed), ctx).cards
          .filter((c) => c.card.name === "sensor closet").length;
        if (placed > 0) ships++;
        total += placed;
      }
      return { ships, total };
    };

    const intact = closets(droneWith([], 5));
    const burnedOut = closets(droneWith(["scanner"], 5));

    expect(burnedOut.ships / FREQUENCY_SEEDS).toBeGreaterThanOrEqual(0.6);
    expect(burnedOut.ships).toBeGreaterThan(intact.ships);
    // The weight is x7, and it has to show as more than a rounding difference:
    // a ship answering a burned scanner is the fourth criterion, not flavour.
    expect(burnedOut.total).toBeGreaterThan(intact.total * 2);
  });

  it("draws a compartment that was already stripped rather than filling every one", () => {
    const built = buildDerelict(FREIGHTER, 0, new Rng(11), NO_RUN);
    const clean = built.cards.filter((c) => c.card.name === "picked clean").length;
    expect(clean).toBeGreaterThan(built.ship.size / 2);
  });
});
