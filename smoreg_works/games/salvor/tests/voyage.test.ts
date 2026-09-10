import { describe, it, expect } from "vitest";
import { flavourCallsign, flavourLine } from "../src/content/derelicts.js";
import {
  RoomGame,
  replayRooms,
  type RoomCommand,
  type RoomGameConfig,
  type RoomId,
  type System,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { t } from "../src/i18n.js";
import { FREIGHTER, type DerelictSpec } from "../src/content/derelicts.js";
import { tugCallsign, tugOpening, voyageOpening } from "../src/content/hints.js";
import { GHOST, HULLS, SCRAPPER, SPARK, STARTING_CREDITS, hullSlots } from "../src/content/hulls.js";
import { MAX_GRAFT, moduleKind } from "../src/content/modules.js";
import { ALERT, alertState, raiseAlert } from "../src/systems/alert.js";
import { DOORS } from "../src/systems/doors.js";
import { POPULATE, roomList, type Crate, type ShipSystem } from "../src/systems/populate.js";
import { SHIP } from "../src/systems/ship.js";
import { shipState } from "../src/systems/shipstate.js";
import { isTug } from "../src/content/tug.js";
import { TUG, gatedOffers } from "../src/systems/tug.js";
import { OBJECTIVES, OBJECTIVE_COUNT } from "../src/content/objectives.js";
import { startRival } from "../src/systems/rival.js";
import { rivalState } from "../src/systems/rivalstate.js";
import {
  TUG_ID,
  VOYAGE,
  credit,
  currentDerelict,
  modulePrice,
  spend,
  stationTargets,
  voyageOf,
  voyageProgress,
} from "../src/systems/voyage.js";
import { BENCH_CURE_PRICE, virusOf } from "../src/systems/virus.js";
import { capOf, findSlot, rigOf, type Rig } from "../src/twist/rig.js";

/**
 * The voyage: one account, one drone at a time, and the two ways a run ends.
 *
 * Every game here is the real one — same pack, same twist, same systems — with
 * the graph written out, so nothing rides on a lucky seed. What is under test
 * is money: what comes in, what goes out, what a refusal costs, and the two
 * endings (design-doc.md, "Экономика рейса", "Победа").
 */

/** What one of the ship's three systems pays on account (`content/objectives.ts`). */
const ADVANCE = OBJECTIVES[0]!.advance;

/** Three systems in a line, a body, and cargo worth taking home. */
const DERELICT = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r1: docking
  r2: cargo contraband †
  r3: engineering E
  r4: reactor O
`;

/** The same hull with the terminal aboard as well: this one can be sold. */
const WHOLE = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r1: docking
  r2: engineering E
  r3: reactor O
  r4: control T
`;

/**
 * A voyage of exactly these hulls, as a system of its own.
 *
 * A real itinerary is four hulls drawn per seed (`derelictsForVoyage`), and
 * "the last hull of the voyage" and "there is somewhere to fly on to" are the
 * two things half this file is about — so it says which hulls rather than
 * asking a seed. Inside the config is what matters: `replayRooms` builds its
 * own game, and a voyage prepared by hand between two commands would not
 * replay.
 */
function itinerary(...hulls: DerelictSpec[]): System<RoomGame> {
  return {
    name: "test-itinerary",
    onRunStart(game) {
      const voyage = voyageOf(game);
      voyage.derelicts = [...hulls];
      // And the record of the hull already under the tug, which was stamped
      // with whatever the seed drew. Since G73 that is one of five classes
      // rather than always the freighter, so a list replaced without the record
      // is a voyage flying a freighter that sells for a tender's price.
      const first = voyage.state[0];
      if (first) first.spec = hulls[0]!;
    },
  };
}

/** The freighter under the drone, and one more hull to jump to. */
const TWO_HULLS = itinerary(FREIGHTER, FREIGHTER);

/** The freighter under the drone, and nothing after it: selling it wins. */
const ONE_HULL = itinerary(FREIGHTER);

function config(text: string, systems = [POPULATE, DOORS, SHIP, VOYAGE]): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    systems,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  };
}

function gameOn(text: string, seed = 5, systems?: Array<System<RoomGame>>): RoomGame {
  return new RoomGame({ ...config(text, systems), seed });
}

function rig(game: RoomGame): Rig {
  return rigOf(game.player)!;
}

function credits(game: RoomGame): number {
  return voyageOf(game).credits;
}

function loot(game: RoomGame): number {
  return (game.player.data?.loot as number | undefined) ?? 0;
}

function standIn(game: RoomGame, label: string): RoomId {
  const room = game.ship.room(label);
  game.player.room = room.id;
  game.refreshSight();
  return room.id;
}

/** The system standing in a compartment, by the label of the compartment. */
function systemIn(game: RoomGame, label: string): ShipSystem {
  return roomList<ShipSystem>(game.ship.room(label), "systems")[0]!;
}

/** Work a system all the way up, one legal turn after another. */
function raiseIn(game: RoomGame, label: string, turns: number): void {
  standIn(game, label);
  for (let i = 0; i < turns; i++) {
    expect(game.playerCommand({ kind: "act", verb: "work", target: systemIn(game, label).id }).ok).toBe(true);
  }
}

/**
 * Every line the tug can be aimed at, with nothing folded away.
 *
 * `VOYAGE.offerActions` is the answering list, and since G53 four of its verbs
 * are one line each with the modules a level down — so a test that wants
 * `sell PLATING` rather than `sell for good ▸` asks for the targets. Same
 * function the screen's sub-lists are built from, same order.
 */
const TUG_VERBS: readonly string[] = [
  "buy", "charter", "undock", "repair", "clean", "graft", "stow", "fit", "sell", "jump",
];

/**
 * Verbs whose lines drop the verb, because on the screen the row above them is
 * the verb. A test naming one needs both halves, so it is written back in.
 */
const VERBLESS: ReadonlySet<string> = new Set(["repair", "graft", "stow", "fit", "sell"]);

function offers(game: RoomGame) {
  if (!isTug(game)) return VOYAGE.offerActions!(game);
  return TUG_VERBS.flatMap((verb) =>
    stationTargets(game, verb).map((o) =>
      VERBLESS.has(verb) ? { ...o, label: `${verb} ${o.label}` } : o,
    ),
  );
}

function offerLike(game: RoomGame, prefix: string) {
  return offers(game).find((o) => o.label.startsWith(prefix));
}

function press(game: RoomGame, prefix: string) {
  const offer = offerLike(game, prefix);
  expect(offer, `no offer starting with '${prefix}' in [${offers(game).map((o) => o.label).join(", ")}]`)
    .toBeDefined();
  return game.playerCommand(offer!.cmd as RoomCommand);
}

function lines(game: RoomGame): string[] {
  return game.log.lines.map((m) => m.text);
}

// ------------------------------------------------------------ the first lines

/**
 * What the log says before anything has happened.
 *
 * The owner's first playtest stood in the DOCK with the whole screen in front
 * of them and asked what was going on, so the run opens on an instruction and
 * not on a ship's name: which compartment does what, then who you are and how
 * far out this goes, then the board at the HELM (docs/tasks/G40-tug-clarity.md,
 * 4).
 */
describe("the first thing the log says", () => {
  it("says what the tug is for, then who you are, then what is out there", () => {
    const seed = 20260904;
    const game = newGame(seed);
    const opening = lines(game).slice(0, 3);

    expect(opening[0]).toBe(tugOpening());
    expect(opening[0]).toContain("Press ?");
    expect(opening[1]).toBe(voyageOpening(tugCallsign(seed), voyageOf(game).derelicts.length));
    expect(opening[1]).toContain("father's tug");
    const state = currentDerelict(game);
    expect(opening[2]).toBe(`The board at the HELM: ${flavourLine(state.spec, state.flavour)}.`);
  });

  it("says them once a run and not again on every jump", () => {
    const game = gameOn(DERELICT, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    VOYAGE.beforeLevelLeave!(game, 0, "airlock");
    voyageOf(game).credits = 500;
    expect(press(game, "jump").ok).toBe(true);

    expect(lines(game).filter((l) => l === tugOpening())).toHaveLength(1);
    expect(lines(game).filter((l) => l.startsWith("The board at the HELM:"))).toHaveLength(2);
  });
});

// ------------------------------------------------------------------- income

describe("what a sortie is worth", () => {
  it("starts the voyage on one SCRAPPER and 25 CR", () => {
    const game = gameOn(DERELICT);
    const voyage = voyageOf(game);

    expect(voyage.credits).toBe(STARTING_CREDITS);
    expect(voyage.hull).toBe("scrapper");
    expect(voyage.sortie).toBe(0);
    expect(rig(game).slots.filter((s) => s !== null)).toHaveLength(SCRAPPER.modules.length);
  });

  it("pays 4 CR for a module, whatever state it is in", () => {
    expect(modulePrice({ kind: "cutter", integrity: 1 })).toBe(4);
    expect(modulePrice({ kind: "cutter", integrity: 3 })).toBe(4);
    expect(modulePrice({ kind: "plating", integrity: 13 })).toBe(4);
  });

  it("never pays more than three fifths of a hull for the rack it comes with", () => {
    // The defect this closes: at `4 + 2` a point the SCRAPPER's five modules
    // fetched 78 CR and the hull cost 40, so buying a drone and stripping it
    // was a profit and the run could not be lost (G41). Read on all three
    // hulls, because it is the cheap one whose rack is the biggest share of it:
    // 20 CR of 40 for the SCRAPPER, 20 of 55 and 20 of 70 for the other two.
    for (const hull of HULLS) {
      const rack = hullSlots(hull).reduce((cr, slot) => cr + modulePrice(slot), 0);
      const where = `${hull.name}: rack ${rack} CR against ${hull.price} CR`;
      expect(rack, where).toBeLessThanOrEqual(hull.price * 0.6);
    }
  });

  it("puts a module handed in at the hold straight into the account", () => {
    const game = gameOn(DERELICT);
    VOYAGE.beforeLevelLeave!(game, 0, "airlock");
    expect(game.shipId).toBe(TUG_ID);

    const slot = findSlot(rig(game), "cutter")!;
    rig(game).slots[slot]!.integrity = 3;
    const before = credits(game);

    expect(press(game, "sell CUTTER").ok).toBe(true);
    expect(credits(game)).toBe(before + 4);
    expect(rig(game).slots[slot]).toBeNull();
  });

  it("loads a cargo crate for 8 CR and a contraband one for 14", () => {
    const game = gameOn(DERELICT);
    const room = standIn(game, "r2");
    (game.ship.roomAt(room).data.crates as Crate[]).push({ id: 9001, kind: "cargo" });

    expect(press(game, "take contraband crate").ok).toBe(true);
    expect(loot(game)).toBe(14);
    expect(press(game, "take cargo crate").ok).toBe(true);
    expect(loot(game)).toBe(14 + 8);
    expect(roomList<Crate>(game.ship.roomAt(room), "crates")).toHaveLength(0);

    // Not money until the drone is out: the hold is what dying costs.
    expect(credits(game)).toBe(STARTING_CREDITS);
  });

  it("pays 3 CR for a crew body, banked at the airlock with everything else", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    expect(game.playerCommand({ kind: "act", verb: "search" }).ok).toBe(true);
    expect(loot(game)).toBe(3);

    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(credits(game)).toBe(STARTING_CREDITS + 3);
    expect(loot(game)).toBe(0);
    expect(lines(game)).toContain(`The hold is emptied: +3 CR. ${STARTING_CREDITS + 3} CR.`);
  });
});

// ------------------------------------------------------------------ the purse

describe("credits that are not there", () => {
  it("refuses to spend what the account does not hold, and changes nothing", () => {
    const game = gameOn(DERELICT);
    expect(spend(game, STARTING_CREDITS + 1)).toBe(false);
    expect(credits(game)).toBe(STARTING_CREDITS);
    expect(spend(game, STARTING_CREDITS)).toBe(true);
    expect(credits(game)).toBe(0);
  });

  it("never spends a turn on a station that says no, in any of the four", () => {
    // The property the numbered list stands on, on the tug: a line that says
    // `enabled` is one `playerCommand` takes, and a greyed one is refused
    // without a turn, whatever the account holds and whichever compartment the
    // drone is standing in. One fresh tug per line, because a station changes
    // the rack the next line was written against.
    //
    // With TUG in the list and read through `gatedOffers`, which is what the
    // panel and the bots see: the station a verb belongs to is half of what
    // makes a line legal, and a list built without it says `sell` can be
    // pressed in the DOCK (G41).
    const SHIPWIDE = [POPULATE, TUG, DOORS, SHIP, VOYAGE];
    const atTheTug = (purse: number, hull: boolean, walk: number): RoomGame => {
      const game = gameOn(DERELICT, 5, SHIPWIDE);
      VOYAGE.beforeLevelLeave!(game, 0, "airlock");
      // The walk comes first, and the state after it: an empty rack and an
      // account under the price of a hull is the end of the run, and a run that
      // has ended answers nothing.
      for (let door = 1; door <= walk; door++) {
        expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
      }
      const voyage = voyageOf(game);
      voyage.credits = purse;
      if (!hull) voyage.hull = undefined;
      else rig(game).slots[findSlot(rig(game), "cutter")!]!.integrity = 1;
      return game;
    };

    for (const purse of [0, 4, 12, 30, 39, 40, 200]) {
      for (const hull of [true, false]) {
        // DOCK, HOLD, BENCH, HELM: the drone walks one bulkhead further each
        // time, and every line of every station is pressed where it stands.
        for (let walk = 0; walk < 4; walk++) {
          const listed = gatedOffers(atTheTug(purse, hull, walk));
          for (let i = 0; i < listed.length; i++) {
            const game = atTheTug(purse, hull, walk);
            const offer = gatedOffers(game)[i]!;
            const where = game.roomOf(game.player).name;
            const inputs = game.inputs.length;
            const out = game.playerCommand(offer.cmd as RoomCommand);
            expect(out.ok, `${purse} CR in the ${where}: ${offer.label}`).toBe(offer.enabled);
            if (!offer.enabled) {
              expect(out.cost).toBe(0);
              expect(game.inputs).toHaveLength(inputs);
              // Whatever it says, the list and the refusal say the same thing.
              expect(offer.why).toBe(out.reason);
              expect(credits(game)).toBe(purse);
            }
          }
        }
      }
    }
  });

  it("prints each station line once, and answers every greyed one in its own words", () => {
    // G41's third defect, as the shortest test of it: TUG used to re-emit every
    // other system's offers, so the join over the systems came back with each
    // station line twice — once gated by compartment and once raw. The raw copy
    // was enabled, which is how a bot standing in the DOCK sold the rack it was
    // about to fly with (`testing/roombots.ts`, `disabled`).
    const game = newGame(4);
    const labels = gatedOffers(game).map((o) => o.label);

    expect(labels).toHaveLength(new Set(labels).size);
    for (const offer of gatedOffers(game)) {
      if (offer.enabled) continue;
      expect(game.playerCommand(offer.cmd as RoomCommand).reason, offer.label).toBe(offer.why);
    }
  });

  it("says why a station is greyed out and leaves the account alone", () => {
    const game = gameOn(DERELICT);
    VOYAGE.beforeLevelLeave!(game, 0, "airlock");
    voyageOf(game).credits = 3;
    rig(game).slots[findSlot(rig(game), "cutter")!]!.integrity = 1;

    const out = press(game, "repair ");
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe("Not enough credits.");
    expect(credits(game)).toBe(3);
  });
});

// ------------------------------------------------------------------- the rack

describe("buying a drone", () => {
  /** A tug with an empty rail and money on the account. */
  function atTheDock(purse: number, seed = 5): RoomGame {
    const game = gameOn(DERELICT, seed);
    VOYAGE.beforeLevelLeave!(game, 0, "airlock");
    const voyage = voyageOf(game);
    voyage.hull = undefined;
    voyage.credits = purse;
    return game;
  }

  it("sells each hull for exactly its price, with exactly its rack", () => {
    for (const hull of HULLS) {
      const game = atTheDock(500);
      expect(press(game, `buy ${hull.name}`).ok).toBe(true);

      expect(credits(game)).toBe(500 - hull.price);
      expect(voyageOf(game).hull).toBe(hull.id);
      expect(rig(game).slots.slice(0, hull.modules.length)).toEqual(hullSlots(hull));
      // The cheap hull leaves its sixth slot empty — the second resource the
      // design document calls it — and the two above it spend theirs on the
      // SPIKE. That is the trade the ladder is built on: a dearer drone does
      // more out of the box and has nowhere to put a find.
      expect(rig(game).slots[5]).toEqual(hull.modules[5] === undefined ? null : hullSlots(hull)[5]);
    }
  });

  it("is a ladder: every rung is more room, more life and no less of anything", () => {
    // The owner's rule — «дорогие дроны имеют больше слотов и чуть больше ядра»
    // — as an assertion rather than a comment. The ladder runs on the chassis,
    // so nothing a cheaper hull has may be missing from a dearer one and every
    // number that matters may only go up.
    for (let i = 1; i < HULLS.length; i++) {
      const under = HULLS[i - 1]!;
      const over = HULLS[i]!;
      expect(over.price, `${over.id} costs no more than ${under.id}`).toBeGreaterThan(under.price);
      expect(over.slots, `${over.id} has no more slots`).toBeGreaterThan(under.slots);
      expect(over.core, `${over.id} has no more core`).toBeGreaterThan(under.core);
      for (const id of under.modules) {
        expect(over.modules, `${over.id} is missing ${id}`).toContain(id);
      }
      for (const slot of hullSlots(over)) {
        const below = hullSlots(under).find((s) => s.kind === slot.kind);
        if (below) expect(slot.integrity, `${over.id}: ${slot.kind}`).toBeGreaterThanOrEqual(below.integrity);
      }
      expect(over.speed ?? 100).toBeGreaterThanOrEqual(under.speed ?? 100);
    }
  });

  it("gives each rung the thing the price is for", () => {
    const scrapper = atTheDock(500);
    press(scrapper, "buy SCRAPPER");
    expect(capOf(rig(scrapper).slots[findSlot(rig(scrapper), "plating")!]!)).toBe(SCRAPPER.base!.plating);
    // Two systems of three on its own: a terminal wants the SPIKE it has not
    // got, or the one keycard.
    expect(rig(scrapper).slots).toHaveLength(6);
    expect(scrapper.player.hpMax).toBe(3);

    const spark = atTheDock(500);
    press(spark, "buy SPARK");
    expect(spark.player.speed).toBe(120);
    expect(rig(spark).slots).toHaveLength(7);
    expect(spark.player.hpMax).toBe(4);
    expect(capOf(rig(spark).slots[findSlot(rig(spark), "plating")!]!)).toBeGreaterThan(
      moduleKind("plating").integrity,
    );

    const ghost = atTheDock(500);
    press(ghost, "buy GHOST");
    expect(ghost.player.speed).toBe(140);
    expect(rig(ghost).slots).toHaveLength(8);
    expect(ghost.player.hpMax).toBe(5);
    expect(capOf(rig(ghost).slots[findSlot(rig(ghost), "plating")!]!)).toBe(24);
  });

  /**
   * The rack is on the list from the first screen of the run, whether or not
   * anything can be bought off it (docs/tasks/G40-tug-clarity.md, 3).
   *
   * Until G40 the three hulls appeared only once the drone was dead, which is
   * to say the choice between them was shown at the one moment it had already
   * been made for you. Selling only when the rail is empty is still the rule —
   * it is `enabled` that says so now, not the presence of the line.
   */
  it("keeps all three on the rack, and sells only while the rail is empty", () => {
    const empty = atTheDock(500);
    expect(offers(empty).slice(0, 3).map((o) => o.label)).toEqual([
      "buy SCRAPPER 40 CR",
      "buy SPARK 90 CR",
      "buy GHOST 160 CR",
    ]);
    expect(offers(empty).slice(0, 3).every((o) => o.enabled)).toBe(true);
    expect(offerLike(empty, "cast off")).toBeUndefined();

    press(empty, "buy SPARK");
    expect(offers(empty).slice(0, 3).map((o) => o.label)).toEqual([
      "buy SCRAPPER 40 CR",
      "SPARK — on the rack",
      "buy GHOST 160 CR",
    ]);
    expect(offers(empty).slice(0, 3).some((o) => o.enabled)).toBe(false);
    for (const line of offers(empty).slice(0, 3)) expect(line.why).toBe("The rack is full.");
    expect(offerLike(empty, "cast off")?.enabled).toBe(true);

    const out = press(empty, "sell PLATING");
    expect(out.ok).toBe(true);
    expect(SPARK.price).toBe(90);
  });

  it("greys out what the account cannot carry", () => {
    // Ninety-one credits: the middle rung is affordable and the top one is not,
    // which is the whole shape of the ladder on one screen.
    const game = atTheDock(91);
    expect(offerLike(game, "buy SCRAPPER")!.enabled).toBe(true);
    expect(offerLike(game, "buy SPARK")!.enabled).toBe(true);
    expect(offerLike(game, "buy GHOST")!.enabled).toBe(false);
    expect(offerLike(game, "buy GHOST")!.why).toBe("Not enough credits.");
    expect(GHOST.price).toBe(160);
  });

  it("refuses a second drone in the same words the rack line carries", () => {
    // The list may not invent a refusal the sim would not give, and the rack is
    // three lines of exactly that refusal for most of a run.
    const game = atTheDock(500);
    press(game, "buy SCRAPPER");

    const line = offerLike(game, "buy SPARK")!;
    expect(line.enabled).toBe(false);
    const out = game.playerCommand(line.cmd as RoomCommand);
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe(line.why);
    expect(credits(game)).toBe(500 - SCRAPPER.price);
  });
});

describe("the bench", () => {
  function atTheBench(purse = 500): RoomGame {
    const game = gameOn(DERELICT);
    VOYAGE.beforeLevelLeave!(game, 0, "airlock");
    voyageOf(game).credits = purse;
    return game;
  }

  it("mends a module whole, a credit a point and never more than four", () => {
    // A point a press at 4 CR made the bench dearer than the rack it mended: a
    // chewed SCRAPPER is fifty-five points, which is 220 CR against 40 for a
    // whole new drone («чиниться дороже, чем купить нового дрона»). One press,
    // one credit a point.
    const game = atTheBench();
    const slot = findSlot(rig(game), "scanner")!;
    rig(game).slots[slot]!.integrity = 1;
    const cap = capOf(rig(game).slots[slot]!);

    expect(press(game, "repair ").ok).toBe(true);
    expect(rig(game).slots[slot]!.integrity).toBe(cap);
    expect(credits(game)).toBe(500 - 4);

    for (let i = 0; i < 10; i++) {
      const offer = offerLike(game, "repair ");
      if (!offer) break;
      game.playerCommand(offer.cmd as RoomCommand);
    }
    for (const s of rig(game).slots) {
      if (s) expect(s.integrity).toBe(capOf(s));
    }
  });

  /**
   * The bench is pressed one point at a time, so the line has to move one point
   * at a time. It read `repair weakest +1 (4 CR)` however many times it was
   * pressed, which is the shape of an offer whose whole effect is somewhere the
   * reader cannot see: a bot learns that in one press and stops
   * (`testing/roombots.ts`, `OfferMemory`), and a player is told neither which
   * module the money went into nor how much of it came back.
   */
  it("names the module it is about to mend and what mending it costs", () => {
    const game = atTheBench();
    const slot = findSlot(rig(game), "scanner")!;
    const cap = capOf(rig(game).slots[slot]!);
    rig(game).slots[slot]!.integrity = 1;

    // The price is the new information: it is what the module is short, and it
    // is what tells a player whether to mend this one or buy a whole drone.
    expect(offerLike(game, "repair ")!.label).toBe("repair SCANNER 4 CR");
    expect(press(game, "repair ").ok).toBe(true);
    // Mended whole, so the line moves to whatever is worst now.
    expect(offerLike(game, "repair SCANNER")).toBeUndefined();
  });

  it("hands the line to the next module once this one is no longer the worst", () => {
    const game = atTheBench();
    for (const s of rig(game).slots) if (s) s.integrity = capOf(s);
    const scanner = findSlot(rig(game), "scanner")!;
    const cell = findSlot(rig(game), "cell")!;
    rig(game).slots[scanner]!.integrity = 2;
    rig(game).slots[cell]!.integrity = 3;

    // The worst first, mended whole in one press, and then the line is about
    // the next worst.
    expect(offerLike(game, "repair ")!.label).toBe("repair SCANNER 4 CR");
    expect(press(game, "repair ").ok).toBe(true);
    expect(offerLike(game, "repair ")!.label).toBe("repair CELL 4 CR");
    expect(press(game, "repair ").ok).toBe(true);
    expect(offerLike(game, "repair ")).toBeUndefined();
  });

  it("never grafts a module more than two over its own base, whatever the order", () => {
    const game = atTheBench();
    const slot = findSlot(rig(game), "plating")!;
    const base = SCRAPPER.base!.plating!; // the SCRAPPER's own PLATING, not the catalogue's

    for (let i = 0; i < 6; i++) {
      const offer = offerLike(game, "graft PLATING");
      const out = offer ? game.playerCommand(offer.cmd as RoomCommand) : undefined;
      if (out && !out.ok) expect(out.cost).toBe(0);
      expect(capOf(rig(game).slots[slot]!)).toBeLessThanOrEqual(base + MAX_GRAFT);
    }

    expect(capOf(rig(game).slots[slot]!)).toBe(base + MAX_GRAFT);
    expect(credits(game)).toBe(500 - 2 * 12);
    expect(offerLike(game, "graft PLATING")).toBeUndefined();
  });

  it("fits a module out of the hold into the empty slot and keeps the hold short", () => {
    const game = atTheBench();
    const voyage = voyageOf(game);
    voyage.hold.push({ kind: "spike", integrity: 2 });

    expect(press(game, "fit SPIKE").ok).toBe(true);
    expect(findSlot(rig(game), "spike")).not.toBeNull();
    expect(voyage.hold).toHaveLength(0);
    expect(offerLike(game, "fit ")).toBeUndefined();
  });

  it("refuses to fit anything into a full rack, without a turn", () => {
    const game = atTheBench();
    const voyage = voyageOf(game);
    voyage.hold.push({ kind: "spike", integrity: 2 }, { kind: "laser", integrity: 2 });

    expect(press(game, "fit SPIKE").ok).toBe(true);
    const offer = offerLike(game, "fit LASER")!;
    expect(offer.enabled).toBe(false);
    const out = game.playerCommand(offer.cmd as RoomCommand);
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
  });

  it("burns the ship's virus out of a module for what the virus costs", () => {
    const game = atTheBench(20);
    const slot = findSlot(rig(game), "cutter")!;
    (game.player.data ??= {}).virus = { slot, since: 0, turns: 0 };

    expect(press(game, "clean CUTTER").ok).toBe(true);
    expect(credits(game)).toBe(20 - BENCH_CURE_PRICE);
    expect(virusOf(game.player)).toBeUndefined();

    // And with nothing to clean it is not on the list, and not a turn either.
    expect(offerLike(game, "clean ")).toBeUndefined();
    const out = game.playerCommand({ kind: "act", verb: "clean", slot });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
  });

  it("pays half for an infected module and takes the virus with it", () => {
    const game = atTheBench();
    const slot = findSlot(rig(game), "plating")!;
    rig(game).slots[slot]!.integrity = 5;
    (game.player.data ??= {}).virus = { slot, since: 0, turns: 0 };
    const before = credits(game);

    // Half of the four a clean module fetches, and never under one credit.
    expect(offerLike(game, "sell PLATING")!.label).toBe("sell PLATING 5/16  2 CR");
    expect(press(game, "sell PLATING").ok).toBe(true);
    expect(credits(game)).toBe(before + 2);
    expect(virusOf(game.player)).toBeUndefined();
  });

  it("gives a drone off the rack a clean rack", () => {
    const game = atTheBench();
    (game.player.data ??= {}).virus = { slot: 0, since: 0, turns: 0 };
    voyageOf(game).hull = undefined;

    expect(press(game, "buy SCRAPPER").ok).toBe(true);
    expect(virusOf(game.player)).toBeUndefined();
  });

  it("keeps every station off the derelict: out here they are refusals", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    expect(offers(game).every((o) => o.label.startsWith("take"))).toBe(true);

    const out = game.playerCommand({ kind: "act", verb: "buy", target: 2000 });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe("That is a job for the tug, not for out here.");
  });
});

// -------------------------------------------------------------- losing a drone

describe("losing a drone", () => {
  function aboard(): RoomGame {
    const game = gameOn(DERELICT, 5, [POPULATE, DOORS, ALERT, SHIP, VOYAGE]);
    voyageOf(game).credits = 100;
    return game;
  }

  it("keeps the wreck, the keys and the loot aboard, and the alert where it was", () => {
    const game = aboard();
    const room = standIn(game, "r3");
    (game.player.data ??= {}).keys = 2;
    (game.player.data ??= {}).loot = 40;
    raiseAlert(game, 3);
    const alert = alertState(game).level;
    const state = currentDerelict(game);

    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);

    expect(voyageOf(game).hull).toBeUndefined();
    expect(voyageOf(game).keys).toBe(0);
    expect(voyageOf(game).loot).toBe(0);
    expect(rig(game).slots.every((s) => s === null)).toBe(true);
    expect(state.deaths).toHaveLength(1);
    expect(state.deaths[0]!.room).toBe(room);
    expect(state.deaths[0]!.rig.slots.some((s) => s?.kind === "plating")).toBe(true);
    expect(state.alert).toBe(alert);
    expect(game.shipId).toBe(TUG_ID);
    expect(game.status).toBe("playing");
  });

  it("does not calm the ship down: the gauge it left is the gauge it kept", () => {
    // Killing a drone is not something a derelict relaxes after. What the ship
    // does between two sorties is the alert's own rule (`systems/alert.ts`);
    // dying does not touch the gauge on the way out.
    const game = aboard();
    standIn(game, "r3");
    raiseAlert(game, 2);
    const alert = alertState(game).level;
    expect(alert).toBe(2);

    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);

    const stored = game.ships.get("1")!.data.alert as { level: number };
    expect(stored.level).toBe(alert);
    expect(currentDerelict(game).alert).toBe(alert);
  });

  it("says what the panel has to say about an empty rail", () => {
    const game = aboard();
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);

    // What the tug is tied to and the state it is in used to be here too, and
    // is now drawn where the schematic goes (`ui/tugboard.ts`) — printing it in
    // both places cost the two rows the ten-row list needed (G53).
    expect(VOYAGE.panelLines!(game).map((l) => l.text)).toEqual([
      "CREDITS 100",
      // Not `DRONE LOST`: that is the card the run puts up when a drone dies
      // (`end.lost`), and this is the counter that stays up until another one
      // is bought (docs/tasks/G55-playtest-findings.md, 18).
      "NO DRONE ON THE RAILS",
      "CHEAPEST HULL 40",
    ]);
  });

  it("ends the voyage with no drone and 39 CR, and not with 40", () => {
    const short = aboard();
    voyageOf(short).credits = 39;
    short.player.hp = 0;
    VOYAGE.onDeath!(short, short.player);

    expect(short.status).toBe("dead");
    expect(lines(short)).toContain("The rack is empty and so is the account. Voyage over.");

    const enough = aboard();
    voyageOf(enough).credits = 40;
    enough.player.hp = 0;
    VOYAGE.onDeath!(enough, enough.player);

    expect(enough.status).toBe("playing");
    expect(offerLike(enough, "buy SCRAPPER")!.enabled).toBe(true);
    expect(enough.playerCommand({ kind: "wait" }).ok).toBe(true);
    expect(enough.status).toBe("playing");
  });

  it("ends it the moment the account drops under the cheapest hull", () => {
    const game = aboard();
    voyageOf(game).credits = 69;
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);
    expect(game.status).toBe("playing");

    // Nothing to fly, and the tug just spent its last on getting there.
    voyageOf(game).credits = 39;
    expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    expect(game.status).toBe("dead");
  });
});

// --------------------------------------------------------------- selling a hull

describe("selling a derelict", () => {
  it("banks the sale price when the third system is up and the drone is out", () => {
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    rig(game).slots[5] = { kind: "spike", integrity: 3 };
    const start = credits(game);
    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);
    expect(shipState(game).online).toHaveLength(3);
    // The advances are on account already: each was paid the turn its system
    // came up, aboard the hull and not at the airlock (G41).
    expect(credits(game)).toBe(start + 3 * ADVANCE);

    const before = credits(game);
    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(currentDerelict(game).sold).toBe(true);
    expect(credits(game)).toBe(before + FREIGHTER.salePrice);
    expect(game.status).toBe("playing");
    expect(game.shipId).toBe(TUG_ID);
    // And the sale is what pays for the next hull of the itinerary — on the
    // one list, with no compartment to walk to for it (G53).
    expect(offerLike(game, "jump")!.enabled).toBe(true);
  });

  it("will not undock into a hull that is already under tow", () => {
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    rig(game).slots[5] = { kind: "spike", integrity: 3 };
    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);
    standIn(game, "r1");
    game.playerCommand({ kind: "leave" });

    const out = press(game, "cast off");
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);

    expect(press(game, "jump").ok).toBe(true);
    expect(voyageOf(game).current).toBe(1);
    expect(press(game, "cast off").ok).toBe(true);
    expect(game.shipId).toBe("2");
  });

  it("wins the run on the last hull of the itinerary", () => {
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, ONE_HULL]);
    rig(game).slots[5] = { kind: "spike", integrity: 3 };
    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);

    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(game.status).toBe("won");
    expect(lines(game)).toContain("The tug answers on your father's callsign. You take it home. You win.");
    expect(credits(game)).toBe(STARTING_CREDITS + 3 * ADVANCE + FREIGHTER.salePrice);
  });

  it("does not sell a hull another tug already took, and does not win on one", () => {
    // Three systems raised and the drone out alive, on a ship the competitor
    // finished first: the charter is gone with the hull (design-doc.md,
    // "Конкурент"), and only what the errands were worth is left.
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, ONE_HULL]);
    startRival(game, true);
    rivalState(game).progress = OBJECTIVE_COUNT;
    rig(game).slots[5] = { kind: "spike", integrity: 3 };
    const start = credits(game);
    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);

    standIn(game, "r1");
    const before = credits(game);
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(game.status).toBe("playing");
    expect(currentDerelict(game).sold).toBe(false);
    // The advances the three systems paid are the run's, banked as each came
    // up; the sale is what the competitor took.
    expect(before).toBe(start + 3 * ADVANCE);
    expect(credits(game)).toBe(before);
    expect(currentDerelict(game).rivalProgress).toBe(OBJECTIVE_COUNT);
  });

  it("sends a half-neutralised hull back to the tug, with the sortie counted", () => {
    const game = gameOn(WHOLE);
    raiseIn(game, "r2", 3);
    standIn(game, "r1");

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.status).toBe("playing");
    expect(game.shipId).toBe(TUG_ID);
    expect(currentDerelict(game).online).toEqual(["engine"]);
    expect(currentDerelict(game).sold).toBe(false);

    expect(press(game, "cast off").ok).toBe(true);
    expect(game.shipId).toBe("1");
    expect(voyageOf(game).sortie).toBe(1);
    expect(shipState(game).online).toEqual(["engine"]);
  });

  it("charges 30 CR for the jump and refuses the last hull's one", () => {
    const game = gameOn(DERELICT, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    VOYAGE.beforeLevelLeave!(game, 0, "airlock");
    voyageOf(game).credits = 61;

    expect(press(game, "jump").ok).toBe(true);
    expect(credits(game)).toBe(31);
    expect(voyageOf(game).current).toBe(1);

    // Nowhere further: the last hull of the itinerary is the end of the line.
    expect(offerLike(game, "jump")).toBeUndefined();
    const out = game.playerCommand({ kind: "act", verb: "jump" });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
  });
});

describe("the warning a jump would drop the hull", () => {
  /** A turn spent at home, which is where the warning is now said (G53). */
  function atHome(game: RoomGame): void {
    expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
  }

  it("says so at home, once for the stay, when there is a system to lose", () => {
    // It used to wait for the drone to stand at the HELM, two bulkheads from
    // the airlock. There is no HELM to stand at any more, and the warning is
    // better for it: the jump is on the same screen as everything else, so the
    // first turn a player can press it is the first turn they read this.
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    raiseIn(game, "r2", 3);
    standIn(game, "r1");

    const state = currentDerelict(game);
    const warn = t("log.jump.warn", { hull: flavourCallsign(state.flavour), up: 1, of: OBJECTIVE_COUNT });
    expect(lines(game)).not.toContain(warn);

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe(TUG_ID);
    atHome(game);
    expect(lines(game).filter((l) => l === warn)).toHaveLength(1);

    // Still at home, still one system up: the second turn does not repeat it.
    atHome(game);
    expect(lines(game).filter((l) => l === warn)).toHaveLength(1);
  });

  it("says nothing with no system raised", () => {
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    atHome(game);
    expect(lines(game).some((l) => l.includes("systems online"))).toBe(false);
  });

  it("says nothing once the hull is already sold", () => {
    const game = gameOn(WHOLE, 5, [POPULATE, DOORS, SHIP, VOYAGE, TWO_HULLS]);
    rig(game).slots[5] = { kind: "spike", integrity: 3 };
    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);
    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(currentDerelict(game).sold).toBe(true);

    atHome(game);
    expect(lines(game).some((l) => l.includes("systems online"))).toBe(false);
  });
});

// -------------------------------------------------------------------- the run

describe("what the harness reads a voyage by", () => {
  it("counts credits, hulls sold, drones lost and sorties flown", () => {
    const game = newGame(11);
    expect(game.metrics()).toEqual({
      credits: STARTING_CREDITS,
      shipsSold: 0,
      dronesLost: 0,
      sortie: 0,
    });

    credit(game, 5, "Test:");
    // A drone is lost aboard a derelict and nowhere else: the tug is where the
    // loss is counted, not where it happens (design-doc.md, "Экономика рейса").
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    expect(game.metrics().sortie).toBe(1);

    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);
    expect(game.metrics().dronesLost).toBe(1);
    expect(game.metrics().credits).toBe(STARTING_CREDITS + 5);
  });

  it("scores the derelicts it swept, not the tug it ends on", () => {
    // The harness counts the ship underfoot when a game has no opinion of its
    // own, and a voyage ends every run on the tug: without this, a swept
    // freighter and a drone that never undocked score the same one room.
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    standIn(game, "r3");
    expect(voyageProgress(game)).toBe(3);

    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe(TUG_ID);
    expect(voyageProgress(game)).toBe(3);
  });
});

// ------------------------------------------------------------------- replay

describe("a voyage replays bit for bit", () => {
  /** A hull with cargo to load and something aboard that kills drones. */
  const RUN = `
    TUG -a1- r1
    r1 -d1- r2
    r2 -d2- r3
    r1: docking
    r2: cargo contraband contraband contraband contraband contraband
    r3: engineering E m:security-unit
  `;

  const SYSTEMS = [POPULATE, DOORS, ALERT, SHIP, VOYAGE, TWO_HULLS];

  /** Everything a run is, as one comparable value. */
  function snapshot(game: RoomGame) {
    const voyage = voyageOf(game);
    return {
      status: game.status,
      shipId: game.shipId,
      turn: game.schedule.time,
      credits: voyage.credits,
      hull: voyage.hull,
      sortie: voyage.sortie,
      current: voyage.current,
      sold: voyage.state.map((s) => s.sold),
      deaths: voyage.state.map((s) => s.deaths.length),
      rack: rig(game).slots.map((s) => (s ? `${s.kind}/${s.integrity}` : "-")),
      room: game.roomOf(game.player).label,
      log: game.log.lines.map((l) => l.text),
      inputs: game.inputs.length,
    };
  }

  it("replays a purchase, a death and a jump from the seed and the commands", () => {
    const seed = 23;
    const cfg = {
      ...GAME_CONFIG,
      systems: SYSTEMS,
      // Only what the fixture itself put aboard: the run has to end in the
      // death this test scripts, not in whichever machine a seed rolled.
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(RUN).ship,
      firstShipId: "1",
    };
    const game = new RoomGame({ ...cfg, seed });
    const script: RoomCommand[] = [];
    const play = (cmd: RoomCommand): boolean => {
      const out = game.playerCommand(cmd);
      if (out.ok) script.push(cmd);
      return out.ok;
    };
    const door = (label: string): number => game.ship.door(label).id;

    // One sortie for the cargo: five crates out through the airlock.
    expect(play({ kind: "go", door: door("d1") })).toBe(true);
    for (let i = 0; i < 5; i++) expect(play({ kind: "act", verb: "take" })).toBe(true);
    expect(play({ kind: "go", door: door("d1") })).toBe(true);
    expect(play({ kind: "leave" })).toBe(true);
    expect(game.shipId).toBe(TUG_ID);
    expect(voyageOf(game).credits).toBe(STARTING_CREDITS + 5 * 14);

    // Money on the bench: every chewed module mended, and a CELL sold off. One
    // press a module now, not one press a point, so the loop stops when there
    // is nothing left to mend rather than after a fixed four.
    for (let i = 0; i < 4; i++) {
      const mend = offerLike(game, "repair ");
      if (!mend) break;
      expect(play(mend.cmd as RoomCommand)).toBe(true);
    }
    expect(play(offerLike(game, "sell CELL")!.cmd as RoomCommand)).toBe(true);

    // A second sortie that does not come back: stand in front of the security
    // unit and wait until the rack is gone.
    expect(play({ kind: "act", verb: "undock" })).toBe(true);
    expect(play({ kind: "go", door: door("d1") })).toBe(true);
    expect(play({ kind: "go", door: door("d2") })).toBe(true);
    for (let i = 0; i < 30 && voyageOf(game).hull !== undefined; i++) play({ kind: "wait" });
    expect(voyageOf(game).hull).toBeUndefined();
    expect(game.status).toBe("playing");

    // A drone off the rack, and the tug burns for the next hull.
    expect(play({ kind: "act", verb: "buy", target: 2000 })).toBe(true);
    expect(play({ kind: "act", verb: "jump" })).toBe(true);
    expect(play({ kind: "act", verb: "undock" })).toBe(true);
    expect(game.shipId).toBe("2");

    // And ten sorties that go one compartment in and turn straight around,
    // which is the cheapest way to make the airlock cross itself often enough
    // for a replay to have something to get wrong.
    for (let i = 0; i < 10; i++) {
      expect(play({ kind: "leave" })).toBe(true);
      expect(play({ kind: "act", verb: "undock" })).toBe(true);
    }

    expect(script.length).toBeGreaterThanOrEqual(40);
    expect(voyageOf(game).state[0]!.deaths).toHaveLength(1);

    const replayed = replayRooms(seed, script, cfg);
    expect(snapshot(replayed)).toEqual(snapshot(game));
    expect(replayed.inputs).toEqual(script);
  });
});
