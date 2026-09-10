import { describe, expect, it } from "vitest";
import {
  KEY_MARK,
  Rng,
  RoomGame,
  validateShip,
  type CardContext,
  type Door,
  type RoomId,
  type Ship,
  type System,
} from "@jamrog/engine";
import { GAME_CONFIG } from "../src/game.js";
import { voyageOf } from "../src/systems/voyage.js";
import { isZoneKind, ZONE_KINDS, ENTRY_KIND } from "../src/content/zones.js";
import { ENFORCER, MONSTERS, machineByName } from "../src/content/monsters.js";
import { FREIGHTER, buildDerelict, derelictShip, shipSpecOf, type DerelictSpec } from "../src/content/derelicts.js";
import {
  BARGE,
  CALLSIGNS,
  DERELICTS,
  CORSAIR,
  FATHERS_TUG,
  FERRY,
  LABORATORY,
  MIDDLE_HULLS,
  MILITARY,
  PROBE,
  QUARANTINE,
  SMUGGLER,
  STARTER_HULLS,
  TENDER,
  derelictSpec,
  derelictsForVoyage,
  flavourLine,
  isStarterHull,
  rollFlavour,
  specOfShip,
} from "../src/content/derelicts.js";

/**
 * The eleven classes of derelict as data (design-doc.md, "Типы дереликтов",
 * and ~/reports/salvor-hazards.html, "Стартовые корабли" for the four hulls a
 * voyage can open on beside the freighter).
 *
 * Two halves. The first is the table itself, written out again so that a
 * changed number is a failing test and not a quiet rebalance — the design
 * document is the specification, and a catalogue that drifts from it is the
 * catalogue that is wrong. The second is what the generator makes of each
 * class: two hundred seeds per hull, every invariant of `validateShip`, and the
 * one guarantee that matters more than any of them — a drone with no cutter can
 * still reach all three of the ship's systems.
 */

const SEEDS = 200;

/**
 * Seeds per hull for the tests that build a whole run rather than a ship.
 *
 * Fewer than the 200 above on purpose: each of these is a `RoomGame`, a
 * generated hull and a populated one, and the property they check — the
 * generator is reached with the right arguments — does not get truer at 200.
 */
const BOARDED_SEEDS = 40;

const NO_RUN: CardContext = { flags: new Set<string>(), shipIndex: 0 };

/** Every machine that exists, the alert's hunter included. */
const MACHINE_IDS = new Set([...MONSTERS.map((m) => m.id), ENFORCER.id]);

/**
 * Which derelict of a voyage each class is, for the cards that ask.
 *
 * A starting hull is the first, the father's tug is the last, and everything
 * else is the middle — and it is the number the deck reads as `shipIndex`, so
 * a class flown at the wrong one is a class tested with the wrong cards aboard:
 * the docking bay and the cargo manifest are pinned to the first ship of a
 * voyage and to nothing else (`content/cards.ts`).
 */
function indexOf(spec: DerelictSpec): number {
  if (isStarterHull(spec)) return 0;
  return spec.id === FATHERS_TUG.id ? 2 : 1;
}

function shipOf(spec: DerelictSpec, seed: number): Ship {
  return derelictShip(spec, indexOf(spec), new Rng(seed), NO_RUN);
}

/**
 * Dormans's rule, walked independently of the engine's own walk: from the
 * airlock, through anything a drone with no cutter can open, picking up keys as
 * it goes. Welds are walls — that is what a weld is — and the airlock leads
 * home rather than on.
 */
function reachWithKeys(ship: Ship): Set<RoomId> {
  const rooms = new Set<RoomId>([ship.entry]);
  const keys = new Set<string>();
  const opens = (d: Door): boolean => {
    if (d.state === "open" || d.state === "closed" || d.state === "broken") return true;
    return d.state === "locked" && d.key !== undefined && keys.has(d.key);
  };

  for (;;) {
    let grew = false;
    for (const id of [...rooms]) {
      for (const mark of ship.roomAt(id).marks) {
        if (mark.startsWith(KEY_MARK) && !keys.has(mark.slice(KEY_MARK.length))) {
          keys.add(mark.slice(KEY_MARK.length));
          grew = true;
        }
      }
      for (const { door, room } of ship.neighbours(id)) {
        if (room.id === id || rooms.has(room.id) || !opens(door)) continue;
        rooms.add(room.id);
        grew = true;
      }
    }
    if (!grew) return rooms;
  }
}

// ------------------------------------------------------------------- the table

describe("the catalogue of hulls", () => {
  it("holds the eleven classes, the five a voyage opens on first", () => {
    expect(DERELICTS.map((d) => d.id)).toEqual([
      "freighter", "barge", "ferry", "probe", "tender",
      "laboratory", "military", "smuggler", "corsair", "quarantine", "fathers-tug",
    ]);
    expect(DERELICTS[0]).toBe(FREIGHTER);
    expect(STARTER_HULLS.map((d) => d.id)).toEqual([
      "freighter", "barge", "ferry", "probe", "tender",
    ]);
    expect(MIDDLE_HULLS.map((d) => d.id)).toEqual([
      "laboratory", "military", "smuggler", "corsair", "quarantine",
    ]);
    // The two pools never overlap: a hull a voyage opens on is not a hull it
    // draws its middle from, or the same class would be flown twice in a run.
    for (const spec of STARTER_HULLS) expect(MIDDLE_HULLS, spec.id).not.toContain(spec);
    expect(isStarterHull(BARGE)).toBe(true);
    expect(isStarterHull(CORSAIR)).toBe(false);
    expect(derelictSpec("corsair")).toBe(CORSAIR);
    expect(derelictSpec("cruise liner")).toBeUndefined();
  });

  it("is the size, the alert and the price of the table, hull by hull", () => {
    const table: Array<[DerelictSpec, [number, number], number, number]> = [
      // spec              rooms      alert  sale
      [FREIGHTER, [12, 14], 0, 200],
      // The four hulls a voyage can open on instead. None of them starts a
      // sortie with the alert already up: a starting hull is where the rules
      // are learned, and a gauge at one before the drone has done anything is
      // the ship answering a move the player has not made yet.
      [BARGE, [9, 11], 0, 180],
      [FERRY, [8, 10], 0, 200],
      [PROBE, [7, 8], 0, 150],
      [TENDER, [9, 11], 0, 220],
      [LABORATORY, [14, 17], 0, 250],
      [MILITARY, [16, 19], 1, 300],
      [SMUGGLER, [14, 17], 0, 270],
      [CORSAIR, [16, 19], 2, 330],
      [QUARANTINE, [14, 17], 1, 360],
      // The father's tug is not sold: neutralising it wins the run.
      [FATHERS_TUG, [20, 25], 3, 0],
    ];
    for (const [spec, rooms, alert, sale] of table) {
      expect(spec.rooms, spec.id).toEqual(rooms);
      expect(spec.alertStart, spec.id).toBe(alert);
      expect(spec.salePrice, spec.id).toBe(sale);
    }
  });

  it("carries the band of machines the table gives each hull", () => {
    const bands: Record<string, string[]> = {
      // The rival's drone and the ghosts of dead operators are named in the
      // table's machine column and belong to no band: one is brought aboard by
      // a competitor (G27) and the other by a death (G18). A band is only what
      // the hull itself is holding.
      freighter: ["maintenance-bot", "feral-drone", "scout"],
      // Every starting hull names the scout, and it is not decoration: the
      // docking bay card stands one in the compartment the drone lands in on
      // the first ship of any voyage (`content/cards.ts`), and a class whose
      // band left it out would field a machine that is not its own.
      barge: ["maintenance-bot", "scout"],
      ferry: ["maintenance-bot", "scout"],
      probe: ["scout", "feral-drone"],
      tender: ["welder-bot", "scout"],
      laboratory: ["scout", "scrapper", "welder-bot", "jammer"],
      military: ["security-unit", "hauler", "arc-sentinel", "sentry-turret"],
      smuggler: ["feral-drone", "scrapper", "welder-bot", "jammer"],
      corsair: ["security-unit", "scrapper", "arc-sentinel"],
      quarantine: ["crawler", "bloom", "scrapper"],
      "fathers-tug": ["enforcer", "arc-sentinel", "security-unit"],
    };
    for (const spec of DERELICTS) expect([...spec.band], spec.id).toEqual(bands[spec.id]);
  });

  it("names only machines that exist", () => {
    for (const spec of DERELICTS) {
      for (const id of spec.band) expect(MACHINE_IDS, `${spec.id} -> ${id}`).toContain(id);
    }
  });

  it("names only compartments the catalogue has, systems and airlock included", () => {
    for (const spec of DERELICTS) {
      expect(spec.kinds, spec.id).toContain(ENTRY_KIND);
      for (const kind of spec.kinds) expect(isZoneKind(kind), `${spec.id} -> ${kind}`).toBe(true);
      for (const required of ZONE_KINDS.filter((z) => z.required)) {
        expect(spec.kinds, `${spec.id} -> ${required.kind}`).toContain(required.kind);
      }
      expect(new Set(spec.kinds).size, spec.id).toBe(spec.kinds.length);
    }
  });

  it("keeps the door weights of the balance table and of each hull's fiction", () => {
    // design-doc.md, "Числа для первого баланса" gives three of these outright:
    // the military hull, the twenty percent of welds on the quarantine hull,
    // and the freighter's (which G36 traded for exactly one locked door, and
    // documents where it does so).
    expect(MILITARY.doors).toEqual({ open: 25, closed: 45, locked: 15, sealed: 5, broken: 10 });
    expect(QUARANTINE.doors.sealed).toBe(20);
    // Locks are the laboratory's whole difficulty, holes and welds are what
    // boarding left on the corsair, and the tug is all four at once.
    expect(LABORATORY.doors.locked).toBeGreaterThanOrEqual(20);
    expect(CORSAIR.doors.broken).toBeGreaterThanOrEqual(15);
    expect(CORSAIR.doors.sealed).toBeGreaterThanOrEqual(10);
    expect(FATHERS_TUG.doors.locked).toBeGreaterThan(0);
    expect(FATHERS_TUG.doors.sealed).toBeGreaterThan(0);
    expect(SMUGGLER.doors.locked).toBeGreaterThan(0);

    for (const spec of DERELICTS) {
      const weights = Object.values(spec.doors);
      expect(weights.every((w) => w >= 0), spec.id).toBe(true);
      // A hull whose doors are all welds or all holes is not a hull.
      expect(spec.doors.open + spec.doors.closed, spec.id).toBeGreaterThanOrEqual(50);
    }
  });

  it("puts the virus on the quarantine hull and nowhere else", () => {
    for (const spec of DERELICTS) {
      expect(spec.virusBonus, spec.id).toBe(spec.id === "quarantine" ? 0.15 : 0);
      expect(spec.keyChance, spec.id).toBeGreaterThan(0);
      expect(spec.keyChance, spec.id).toBeLessThanOrEqual(1);
    }
    // Boarded hulls are where the crew is, and the crew is where the keys are.
    expect(CORSAIR.keyChance).toBeGreaterThan(FREIGHTER.keyChance);
  });

  it("has depth enough for the compartments it asks for", () => {
    for (const spec of DERELICTS) {
      expect(spec.maxDepth, spec.id).toBeLessThanOrEqual(6);
      // The schematic takes six compartments per column, and the airlock has a
      // column to itself: a hull that cannot be laid out is a hull that is
      // regenerated fourteen times and shipped broken anyway.
      expect(1 + 6 * spec.maxDepth, spec.id).toBeGreaterThanOrEqual(spec.rooms[1]);
    }
  });
});

// --------------------------------------------------------------- the generator

describe("every hull, generated", () => {
  for (const spec of DERELICTS) {
    it(`passes every invariant on ${SEEDS} seeds: ${spec.id}`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const built = buildDerelict(spec, indexOf(spec), new Rng(seed), NO_RUN);
        expect(built.problems, `${spec.id} seed ${seed}`).toEqual([]);
        expect(validateShip(built.ship, shipSpecOf(spec)), `${spec.id} seed ${seed}`).toEqual([]);
        expect(built.ship.size, `${spec.id} seed ${seed}`).toBeGreaterThanOrEqual(spec.rooms[0]);
        expect(built.ship.size, `${spec.id} seed ${seed}`).toBeLessThanOrEqual(spec.rooms[1]);
      }
    });

    it(`lets a drone with no cutter reach all three systems: ${spec.id}`, () => {
      const required = ZONE_KINDS.filter((z) => z.required).map((z) => z.kind);
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipOf(spec, seed);
        const reach = reachWithKeys(ship);
        for (const kind of required) {
          const room = ship.rooms.find((r) => r.kind === kind)!;
          expect(reach.has(room.id), `${spec.id} seed ${seed} ${kind} ${room.label}`).toBe(true);
        }
      }
    });

    it(`stands up nothing outside its own band: ${spec.id}`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const room of shipOf(spec, seed).rooms) {
          for (const mark of room.marks) {
            const [head, id] = mark.split(":");
            if (head !== "m" || id === undefined) continue;
            expect(spec.band, `${spec.id} seed ${seed} ${room.label} ${mark}`).toContain(id);
          }
        }
      }
    });

    // A hazard nobody reads is a lie the design doc tells the player (G43): the
    // engine only ever compares `hazard` to "vented" (noise.ts), so any other
    // value sitting on a room is dead data. Named here rather than imported so
    // that a new hazard with no reader fails this test, not `noise.ts`'s.
    it(`never carries a hazard nothing reads: ${spec.id}`, () => {
      const READABLE_HAZARDS = ["none", "vented"];
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const room of shipOf(spec, seed).rooms) {
          expect(READABLE_HAZARDS, `${spec.id} seed ${seed} ${room.label}`).toContain(room.hazard);
        }
      }
    });
  }

  it("welds and locks enough doors on the hulls that are about doors", () => {
    // The weights are relative, so what is checked is what a player meets: the
    // military and quarantine hulls have to actually produce the welds their
    // BFS is interesting because of, and the laboratory its locks.
    const count = (spec: DerelictSpec, state: string): number => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        n += shipOf(spec, seed).doors.filter((d) => d.state === state).length;
      }
      return n;
    };
    expect(count(QUARANTINE, "sealed")).toBeGreaterThan(20);
    expect(count(MILITARY, "sealed")).toBeGreaterThan(0);
    expect(count(LABORATORY, "locked")).toBeGreaterThan(40);
    expect(count(FREIGHTER, "sealed")).toBe(0);
    // And no hull a voyage opens on welds or holes anything, all five of them:
    // the generator will not lock a door that is already one, and the one
    // locked door is where the keycard for the terminal comes from
    // (`content/cards.ts`, `SUPPLY_LOCKER`).
    for (const spec of STARTER_HULLS) {
      expect(count(spec, "sealed"), spec.id).toBe(0);
      expect(count(spec, "broken"), spec.id).toBe(0);
    }
  });

  it("generates the same hull twice from the same seed", () => {
    for (const spec of DERELICTS) {
      const a = shipOf(spec, 77);
      const b = shipOf(spec, 77);
      expect(JSON.stringify(a.toJSON()), spec.id).toBe(JSON.stringify(b.toJSON()));
    }
  });
});

// ------------------------------------------------------------------ the voyage

describe("the derelicts of one voyage", () => {
  it("opens on a starting hull, ends on the father's tug, and draws the middle", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const voyage = derelictsForVoyage(new Rng(seed));
      expect(voyage, `seed ${seed}`).toHaveLength(3);
      expect(STARTER_HULLS, `seed ${seed}`).toContain(voyage[0]!);
      expect(voyage[2], `seed ${seed}`).toBe(FATHERS_TUG);
      expect(MIDDLE_HULLS, `seed ${seed}`).toContain(voyage[1]!);
    }
  });

  it("draws every one of the five starting hulls over a run of seeds", () => {
    // The whole of G73: the first ship of a run used to be the freighter on
    // every seed, and the first ship is the one that decides whether the game
    // is understood at all. Each class has to be reachable, and none of them
    // may crowd the others out — a pool where one hull comes up nine times in
    // ten is the old behaviour with extra rows in it.
    const seen = new Map<string, number>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const id = derelictsForVoyage(new Rng(seed))[0]!.id;
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual(STARTER_HULLS.map((d) => d.id).sort());
    for (const spec of STARTER_HULLS) {
      const share = (seen.get(spec.id) ?? 0) / SEEDS;
      expect(share, `${spec.id}: ${(share * 100).toFixed(0)} % of ${SEEDS} seeds`).toBeGreaterThan(0.1);
      expect(share, `${spec.id}: ${(share * 100).toFixed(0)} % of ${SEEDS} seeds`).toBeLessThan(0.35);
    }
  });

  it("never opens on the training hull, which is nobody's itinerary", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      expect(derelictsForVoyage(new Rng(seed))[0]!.id, `seed ${seed}`).not.toBe("tutorial");
    }
  });

  it("offers every hull of the middle catalogue over a run of seeds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      seen.add(derelictsForVoyage(new Rng(seed))[1]!.id);
    }
    expect([...seen].sort()).toEqual(MIDDLE_HULLS.map((d) => d.id).sort());
  });

  it("leaves the middle of a seed where it always was", () => {
    // The starting hull is drawn after the middle is shuffled, so the rng
    // stream up to that point is the one every measured number in this game was
    // taken on: a seed keeps the second hull it has always had, and only the
    // ship in front of it is new.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const shuffled = new Rng(seed).shuffle([...MIDDLE_HULLS])[0]!;
      expect(derelictsForVoyage(new Rng(seed))[1], `seed ${seed}`).toBe(shuffled);
    }
  });

  it("draws the same voyage from the same seed", () => {
    const a = derelictsForVoyage(new Rng(9)).map((d) => d.id);
    const b = derelictsForVoyage(new Rng(9)).map((d) => d.id);
    expect(a).toEqual(b);
  });
});

// ------------------------------------------------------- the starting hulls

/**
 * What the four hulls beside the freighter promise, on 200 seeds each.
 *
 * Each of them exists to teach one thing outright, and each of those lessons is
 * a structural fact of the ship rather than a line of prose: the barge has more
 * scrap aboard than a rack has slots, the ferry has two locked doors with the
 * keys on the dead in front of them, the probe is small and the tender is full
 * of modules. A class whose lesson only holds on some seeds is a class that
 * teaches nothing, so all four are held to their promise on every seed.
 */
describe("what a starting hull promises", () => {
  const marksOf = (ship: Ship): string[] => ship.rooms.flatMap((r) => r.marks);

  it("stands nothing but a scout in the compartment the drone lands in", () => {
    // The onboarding is one weak machine and one pile of scrap, whatever hull
    // the voyage opened on (design-doc.md, "Обучение конструкцией", 2).
    for (const spec of STARTER_HULLS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipOf(spec, seed);
        const entry = ship.roomAt(ship.entry);
        expect(entry.marks, `${spec.id} seed ${seed}`).toContain("m:scout");
        expect(entry.marks, `${spec.id} seed ${seed}`).toContain("%:welder");
        expect(spec.band, spec.id).toContain("scout");
      }
    }
  });

  it("hides no relic and carries no strain on any of the five", () => {
    // Both are things a voyage meets once it has something to lose. A guarded
    // crate on the first hull of a run is a fight the player has no rack for,
    // and a strain is a clock nobody has been taught to read yet.
    for (const spec of STARTER_HULLS) {
      expect(spec.relics ?? [], spec.id).toEqual([]);
      expect(spec.strains ?? [], spec.id).toEqual([]);
      expect(spec.virusBonus, spec.id).toBe(0);
      expect(spec.rival, spec.id).toBe(false);
      expect(spec.alertStart, spec.id).toBe(0);
    }
  });

  it("keeps every one of them to one, two or three machines", () => {
    for (const spec of STARTER_HULLS) {
      expect(spec.machines[0], spec.id).toBeGreaterThanOrEqual(1);
      expect(spec.machines[1], spec.id).toBeLessThanOrEqual(3);
    }
  });

  it("gives the barge more scrap than a rack can carry home", () => {
    // The drone that flies the first sortie has six slots and comes out of the
    // yard with five modules already in them (`content/hulls.ts`), so what it
    // can carry off a hull is one pile and whatever it decides to throw away.
    // Measured over 200 seeds: five piles at worst and eleven at the median,
    // against the freighter's three and four — which is the whole class.
    const piles = (spec: DerelictSpec): number[] => {
      const out: number[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        out.push(marksOf(shipOf(spec, seed)).filter((m) => m === "%" || m.startsWith("%:")).length);
      }
      return out.sort((a, b) => a - b);
    };
    const barge = piles(BARGE);
    const freighter = piles(FREIGHTER);
    expect(barge[0], `poorest barge: ${barge[0]} piles`).toBeGreaterThanOrEqual(4);
    expect(barge[SEEDS >> 1]!, `barge median ${barge[SEEDS >> 1]}`).toBeGreaterThanOrEqual(
      2 * freighter[SEEDS >> 1]!,
    );
  });

  it("gives the ferry exactly two locked doors, with both keys on the dead in front of them", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = shipOf(FERRY, seed);
      const where = `ferry seed ${seed}`;
      const locked = ship.doors.filter((d) => d.state === "locked");
      expect(locked.length, where).toBe(2);

      // Each key lies in a compartment the drone can reach without opening
      // either of them, and `systems/populate.ts` lays a key on a body — the
      // one the card marked, or one it makes for it. Two doors, two keys, and
      // nothing aboard needs a cutter.
      const keys = locked.map((d) => d.key);
      expect(new Set(keys).size, where).toBe(2);
      for (const key of keys) {
        expect(key, where).toBeDefined();
        const holder = ship.rooms.find((r) => r.marks.includes(`${KEY_MARK}${key}`));
        expect(holder, `${where} key ${key}`).toBeDefined();
        expect(reachWithKeys(ship).has(holder!.id), `${where} key ${key}`).toBe(true);
      }
      expect(reachWithKeys(ship).size, where).toBe(ship.size);
      expect(ship.doors.filter((d) => d.state === "sealed"), where).toHaveLength(0);
    }
  });

  it("puts modules rather than credits in the tender's scrap", () => {
    // A yard tender is where a rack that came off a bad sortie is made whole,
    // and the welder bot that is still working it is what makes taking them a
    // decision rather than a walk.
    let bare = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const marks = marksOf(shipOf(TENDER, seed));
      const salvage = marks.filter((m) => m === "%" || m === "X" || m.startsWith("%:") || m.startsWith("X:"));
      if (salvage.length < 4) bare++;
      expect(marks, `tender seed ${seed}`).toContain("m:welder-bot");
    }
    expect(bare, `${bare} of ${SEEDS} tenders held fewer than four piles`).toBe(0);
  });

  it("keeps the probe small enough to strip in one sortie", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = shipOf(PROBE, seed);
      expect(ship.size, `probe seed ${seed}`).toBeLessThanOrEqual(8);
      expect(ship.doors.filter((d) => d.state === "sealed"), `probe seed ${seed}`).toHaveLength(0);
    }
  });

  it("leaves a keycard aboard every one of them, because the terminal wants one", () => {
    // The main terminal is raised with a SPIKE or a keycard, the drone leaves
    // the yard with neither, and a SPIKE is one face of an eleven-way lottery
    // (`content/objectives.ts`, `content/cards.ts`). So a starting hull with no
    // lock aboard is a starting hull that cannot be neutralised — measured, and
    // written up on `SUPPLY_LOCKER`.
    for (const spec of STARTER_HULLS) {
      const owed = spec.id === "ferry" ? 2 : 1;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const ship = shipOf(spec, seed);
        const locked = ship.doors.filter((d) => d.state === "locked");
        expect(locked.length, `${spec.id} seed ${seed}`).toBe(owed);
        for (const door of locked) {
          const holder = ship.rooms.find((r) => r.marks.includes(`${KEY_MARK}${door.key}`));
          expect(holder, `${spec.id} seed ${seed} ${door.label}`).toBeDefined();
        }
      }
    }
  });
});

describe("the line the HELM prints", () => {
  it("reads callsign, class, and two of the hull's own words, in that order", () => {
    for (const spec of DERELICTS) {
      for (let seed = 1; seed <= 50; seed++) {
        const parts = flavourLine(spec, rollFlavour(spec, new Rng(seed))).split(" · ");
        expect(parts, `${spec.id} seed ${seed}`).toHaveLength(4);
        expect(CALLSIGNS, `${spec.id} seed ${seed}`).toContain(parts[0]);
        expect(parts[1], `${spec.id} seed ${seed}`).toBe(spec.name);
        expect(spec.flavour, `${spec.id} seed ${seed}`).toContain(parts[2]);
        expect(spec.flavour, `${spec.id} seed ${seed}`).toContain(parts[3]);
        expect(parts[2], `${spec.id} seed ${seed}`).not.toBe(parts[3]);
        // Order is the list's, which is what makes the pair read as a registry
        // entry: hull, then reactor, then drive, then how it ended up here.
        expect(spec.flavour.indexOf(parts[2]!)).toBeLessThan(spec.flavour.indexOf(parts[3]!));
      }
    }
  });

  it("says the same thing about the same hull on the same seed", () => {
    const roll = rollFlavour(FATHERS_TUG, new Rng(4));
    expect(roll).toEqual(rollFlavour(FATHERS_TUG, new Rng(4)));
    expect(flavourLine(FATHERS_TUG, roll)).toBe(flavourLine(FATHERS_TUG, roll));
  });
});

// ------------------------------------------------------- the hull a run boards

/**
 * The same invariants, through the door the game actually uses.
 *
 * Everything above builds hulls by calling the generator. A run does not: it
 * undocks, and the ship is drawn inside `travelTo` against the run's own flags
 * and the charters signed at the HELM (`systems/voyage.ts`). One misplaced
 * argument there and every hull after the freighter is a different ship from
 * the one this file has been checking.
 */
describe("every hull, boarded", () => {
  /**
   * A voyage of the tutorial freighter and then this hull, with the fare for
   * the jump already in the account.
   *
   * Second and not first, because the first hull of any voyage is the one the
   * game teaches itself on: the docking bay card stands a scout aboard it
   * whatever class it is (`content/cards.ts`, `shipIndex === 0`), and that
   * scout is not the hull's own band.
   */
  function secondHull(spec: DerelictSpec): System<RoomGame> {
    return {
      name: "test-hull",
      onRunStart(game) {
        const voyage = voyageOf(game);
        voyage.derelicts = [FREIGHTER, spec];
        voyage.credits = 1000;
      },
    };
  }

  function boarded(spec: DerelictSpec, seed: number): RoomGame {
    const where = `${spec.id} seed ${seed}`;
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed,
      systems: [secondHull(spec), ...(GAME_CONFIG.systems ?? [])],
    });
    // Down the tug to the HELM, out to the next hull, back to the airlock.
    for (const door of [1, 2, 3]) expect(game.playerCommand({ kind: "go", door }).ok, where).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "jump" }).ok, where).toBe(true);
    for (const door of [3, 2, 1]) expect(game.playerCommand({ kind: "go", door }).ok, where).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok, where).toBe(true);
    return game;
  }

  for (const spec of DERELICTS) {
    it(`comes off the airlock whole on ${BOARDED_SEEDS} seeds: ${spec.id}`, () => {
      for (let seed = 1; seed <= BOARDED_SEEDS; seed++) {
        const game = boarded(spec, seed);
        const where = `${spec.id} seed ${seed}`;

        expect(game.shipId, where).toBe("2");
        expect(validateShip(game.ship, shipSpecOf(spec)), where).toEqual([]);
        expect(game.ship.size, where).toBeGreaterThanOrEqual(spec.rooms[0]);
        expect(game.ship.size, where).toBeLessThanOrEqual(spec.rooms[1]);
        expect(specOfShip(game.ship)?.id, where).toBe(spec.id);
        expect(reachWithKeys(game.ship).size, where).toBeGreaterThan(1);

        // Nothing outside the class's own band ever stands up on it. The
        // competitor's drone is the exception and not a hole: it belongs to
        // another tug, and a band is only what this hull is holding
        // (`systems/rival.ts`).
        for (const machine of game.entities) {
          if (machine.id === game.player.id || machine.name === "rival drone") continue;
          expect(spec.band, `${where} ${machine.name}`).toContain(machineByName(machine.name)?.id);
        }
      }
    });
  }

  it("gives the father's tug the ENFORCER no other hull can roll", () => {
    let enforcers = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const game = boarded(FATHERS_TUG, seed);
      enforcers += game.entities.filter((e) => e.name === ENFORCER.name).length;
    }
    expect(enforcers).toBeGreaterThan(0);
  });

  it("puts a crawler and a bloom aboard the quarantine hull, which no roll would", () => {
    // Both carry `weight: 0` so the shared depth band can never produce one;
    // inside a class's own band the weight is a floor of one, which is the
    // whole reason a quarantine hull feels like biology (`systems/populate.ts`).
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const machine of boarded(QUARANTINE, seed).entities) seen.add(machine.name);
    }
    expect(seen).toContain("crawler");
    expect(seen).toContain("bloom");
  });
});
