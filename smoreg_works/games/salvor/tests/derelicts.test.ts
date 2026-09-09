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
  CALLSIGNS,
  DERELICTS,
  CORSAIR,
  FATHERS_TUG,
  LABORATORY,
  MIDDLE_HULLS,
  MILITARY,
  QUARANTINE,
  SMUGGLER,
  derelictSpec,
  derelictsForVoyage,
  flavourLine,
  rollFlavour,
  specOfShip,
} from "../src/content/derelicts.js";

/**
 * The seven classes of derelict as data (design-doc.md, "Типы дереликтов").
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

/** Which derelict of a voyage each class is, for the cards that ask. */
const INDEX_OF = new Map(DERELICTS.map((d, i) => [d.id, i]));

function shipOf(spec: DerelictSpec, seed: number): Ship {
  return derelictShip(spec, INDEX_OF.get(spec.id)!, new Rng(seed), NO_RUN);
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
  it("holds the seven classes of the design document, the freighter first", () => {
    expect(DERELICTS.map((d) => d.id)).toEqual([
      "freighter", "laboratory", "military", "smuggler", "corsair", "quarantine", "fathers-tug",
    ]);
    expect(DERELICTS[0]).toBe(FREIGHTER);
    expect(MIDDLE_HULLS.map((d) => d.id)).toEqual([
      "laboratory", "military", "smuggler", "corsair", "quarantine",
    ]);
    expect(derelictSpec("corsair")).toBe(CORSAIR);
    expect(derelictSpec("cruise liner")).toBeUndefined();
  });

  it("is the size, the alert and the price of the table, hull by hull", () => {
    const table: Array<[DerelictSpec, [number, number], number, number]> = [
      // spec              rooms      alert  sale
      [FREIGHTER, [12, 14], 0, 200],
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
        const built = buildDerelict(spec, INDEX_OF.get(spec.id)!, new Rng(seed), NO_RUN);
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
  it("teaches on a freighter, ends on the father's tug, and draws the middle", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const voyage = derelictsForVoyage(new Rng(seed));
      expect(voyage, `seed ${seed}`).toHaveLength(3);
      expect(voyage[0], `seed ${seed}`).toBe(FREIGHTER);
      expect(voyage[2], `seed ${seed}`).toBe(FATHERS_TUG);
      expect(MIDDLE_HULLS, `seed ${seed}`).toContain(voyage[1]!);
    }
  });

  it("offers every hull of the middle catalogue over a run of seeds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      seen.add(derelictsForVoyage(new Rng(seed))[1]!.id);
    }
    expect([...seen].sort()).toEqual(MIDDLE_HULLS.map((d) => d.id).sort());
  });

  it("draws the same voyage from the same seed", () => {
    const a = derelictsForVoyage(new Rng(9)).map((d) => d.id);
    const b = derelictsForVoyage(new Rng(9)).map((d) => d.id);
    expect(a).toEqual(b);
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
