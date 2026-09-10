import { describe, expect, it } from "vitest";
import { CALLSIGNS, derelictName, flavourCallsign } from "../src/content/derelicts.js";
import {
  RoomGame,
  Ship,
  TURN_COST,
  layoutFaults,
  replayRooms,
  type ActionOffer,
  type LogLine,
  type RoomCommand,
  type System,
} from "@jamrog/engine";
import { seedRange } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { TUG_CALLSIGNS, tugCallsign } from "../src/content/hints.js";
import { ZONE_KINDS, zoneName } from "../src/content/zones.js";
import { LANGS, setLang, t } from "../src/i18n.js";
import { tugBoard } from "../src/ui/tugboard.js";
import { STARTING_CREDITS, STARTING_HULL } from "../src/content/hulls.js";
import { moduleName } from "../src/content/modules.js";
import { TUG_ID, TUG_KINDS, TUG_ROOMS, isTug, stationName, tugShip } from "../src/content/tug.js";
import { alertState } from "../src/systems/alert.js";
import { TUG, gatedOffers, stationGuide } from "../src/systems/tug.js";
import { VOYAGE } from "../src/systems/voyage.js";
import {
  HOLD_LIMIT,
  currentDerelict,
  stationOffers,
  stationTargets,
  voyageOf,
} from "../src/systems/voyage.js";
import { ACTION_WIDTH, roomActions, tugStands, type Action } from "../src/ui/actions.js";
import { rigOf, findSlot } from "../src/twist/rig.js";
import { PANEL_WIDTH, panelBlocks } from "../src/ui/panel.js";
import { schematicInputOf } from "../src/ui/schematic-input.js";

/**
 * The tug as a menu (docs/tasks/G53-tug-is-a-menu.md).
 *
 * It used to be a ship: four compartments, a table saying which of them each
 * verb belonged to, and a refusal for pressing one anywhere else. The owner
 * played it twice and asked for the opposite — «используй самые обычные меню;
 * это два разных режима игры» — so the table is gone and what is under test is
 * what replaced it: one screen, five groups, ten rows whose numbers do not
 * move, and a hold that finally has something in it.
 *
 * The graph is still four rooms and is still tested as such. Nothing walks it
 * any more, but a `Ship` is what the store, the save file and the schematic
 * know how to hold, and taking it away buys nothing this task was asked for.
 */

/** Every verb the tug has ever offered. Test 6 of the task: none may be lost. */
const ALL_VERBS: readonly string[] = [
  "buy", "charter", "undock", "repair", "clean", "graft", "stow", "fit", "sell", "jump",
];

/** Doors of `tugShip()`, by label. The airlock is 0, the bulkheads 1..3. */
const T1 = 1;
const T2 = 2;
const T3 = 3;

/** No twist: the rack is another task's, and none of the graph tests read it. */
const NONE: System<RoomGame> = { name: "none" };

/** A bare run that starts on the tug, for the questions that are about the graph. */
function onTug(systems: Array<System<RoomGame>> = [TUG], seed = 7): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    twist: NONE,
    systems,
    firstShip: tugShip,
    firstShipId: TUG_ID,
  });
}

function texts(lines: readonly LogLine[]): string[] {
  return lines.map((l) => `${l.turn} ${l.tone} ${l.text}`);
}

const verbOf = (o: ActionOffer<RoomCommand>): string =>
  o.cmd.kind === "act" ? o.cmd.verb : o.cmd.kind;

/** The tug's screen: the ten rows, in the order the player reads them. */
function screen(game: RoomGame): Action[] {
  return roomActions(game);
}

/** The rows of one group's own list, one level down. */
function picks(game: RoomGame, verb: string): Action[] {
  return roomActions(game, verb);
}

/** Slot indices with a module in them. */
function filled(game: RoomGame): number[] {
  const rig = rigOf(game.player)!;
  return rig.slots.flatMap((s, i) => (s ? [i] : []));
}

// ------------------------------------------------------------------ the graph

describe("the tug's graph", () => {
  it("is four compartments in a line, all doors open, the airlock on the DOCK", () => {
    const ship = tugShip();

    expect(ship.rooms.map((r) => r.name)).toEqual([...TUG_ROOMS]);
    expect(ship.rooms.map((r) => r.kind)).toEqual(["dock", "hold", "bench", "helm"]);
    expect(ship.rooms.map((r) => r.depth)).toEqual([0, 1, 2, 3]);
    expect(ship.rooms.every((r) => !r.cover)).toBe(true);
    expect(ship.entry).toBe(0);

    const airlock = ship.airlock();
    expect(airlock?.label).toBe("a1");
    expect(airlock?.a).toBe(0);
    expect(airlock?.b).toBe(0);

    const bulkheads = ship.doors.filter((d) => d.state !== "airlock");
    expect(bulkheads.map((d) => d.label)).toEqual(["t1", "t2", "t3"]);
    expect(bulkheads.every((d) => d.state === "open")).toBe(true);
    expect(bulkheads.map((d) => [d.a, d.b])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("lays out in one row, one column per compartment, and the schematic can draw it", () => {
    const ship = tugShip();

    expect(ship.rooms.map((r) => r.col)).toEqual([0, 1, 2, 3]);
    expect(ship.rooms.map((r) => r.row)).toEqual([0, 0, 0, 0]);
    expect(layoutFaults(ship)).toEqual([]);
  });

  it("survives a save: JSON out, the same ship back", () => {
    const ship = tugShip();
    const back = Ship.rehydrate(JSON.parse(JSON.stringify(ship)) as ReturnType<Ship["toJSON"]>);

    expect(back.toJSON()).toEqual(ship.toJSON());
    expect(back.airlock()?.label).toBe("a1");
    expect(back.neighbours(1).map((n) => n.room.name)).toEqual(["DOCK", "BENCH"]);
  });

  it("is built without a generator and reads the same every time", () => {
    expect(tugShip().toJSON()).toEqual(tugShip().toJSON());
  });

  it("would be full of machines without the system that clears it", () => {
    // Three of the tug's four compartments are deep enough for a machine, and a
    // pack that rolls per compartment would fill them. SALVOR does not roll:
    // machines are one budget per derelict class, spent by
    // `systems/populate.ts`, and the tug is not a derelict. So the control asks
    // for the roll itself — without it the test below would pass on a graph
    // nothing was ever going to spawn in.
    const rolled = new RoomGame({
      ...GAME_CONFIG,
      seed: 7,
      twist: NONE,
      systems: [NONE],
      content: { ...SALVOR, monsterChance: () => 1 },
      firstShip: tugShip,
      firstShipId: TUG_ID,
    });

    expect(rolled.entities.length).toBeGreaterThan(1);
  });

  it("has nothing aboard, and grows nothing over two hundred turns", () => {
    const game = onTug();

    for (let turn = 0; turn < 200; turn++) {
      game.playerCommand(turn % 8 < 4 ? { kind: "wait" } : { kind: "go", door: T1 });
      expect(game.entities, `turn ${turn}`).toHaveLength(1);
    }
    expect(game.status).toBe("playing");
    expect(game.kills).toBe(0);
  });

  it("keeps no counters and no map of its own", () => {
    // Both were G40's answer to a tug you had to walk: a row of compartment
    // names among the counters, then a four-row guide at the foot of the panel
    // saying which of them sold and which mended. There is nothing left for
    // either to point at — every verb is on the one list — and `stationGuide`
    // stays only until `ui/panel.ts` stops calling it (G54).
    const game = onTug();
    expect(TUG.panelLines).toBeUndefined();
    expect(TUG.offerActions).toBeUndefined();
    expect(TUG.performCommand).toBeUndefined();
    expect(stationGuide(game)).toEqual([]);
  });
});

// -------------------------------------------------------------- the one screen

describe("the tug is one screen", () => {
  it("puts every station on the first list, with no walking, on 200 seeds", () => {
    // Task test 1. Not "the verbs exist somewhere" — the verbs are on the list
    // the player is looking at the moment the run opens, in the fixed order,
    // and the drone has not moved.
    for (const seed of seedRange(1, 200)) {
      const game = newGame(seed);
      const labels = screen(game).map((a) => a.label);
      expect(labels, `seed ${seed}`).toHaveLength(ALL_VERBS.length);
      expect(game.roomOf(game.player).name, `seed ${seed}`).toBe("DOCK");
      // The four groups, in the order a visit home is spent, each heading its
      // own first row. Moving the tug to the next hull has a heading of its own
      // since the eighth playtest: it is not signing a charter for the hull
      // alongside, and reading it under `VOYAGE` with the charters is what hid
      // it. `DRONE` and `SELL` have none: one stood over a row that already
      // says `buy a hull`, the other over three things done to the same rack
      // (docs/tug-menu-audit.md, П7).
      expect(screen(game).flatMap((a) => (a.head === undefined ? [] : [a.head])), `seed ${seed}`)
        .toEqual(["REPAIR", "RIG", "CHARTERS", "NEXT HULL"]);
      // Casting off is the last of them and wears no heading: it is the one
      // press of the screen that cannot be taken back.
      expect(screen(game)[9]!.cmd, `seed ${seed}`).toMatchObject({ verb: "undock" });
    }
  });

  it("is ten rows the numbers of which never move", () => {
    // Task test 3, and half of what made the old tug unusable: a line that
    // vanishes when it has nothing to do renumbers every line under it.
    const game = newGame(4);
    const numbers = (): string[] => screen(game).map((a) => `${a.key} ${a.label}`);
    const first = numbers();
    expect(numbers()).toEqual(first);
    expect(first.map((s) => s.slice(0, 1))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);

    // A purchase does not reorder the board, and neither does spending the rack
    // down to nothing.
    const before = screen(game).map((a) => a.key);
    voyageOf(game).credits = 500;
    for (const slot of filled(game)) game.playerCommand({ kind: "act", verb: "sell", slot });
    expect(screen(game).map((a) => a.key)).toEqual(before);
  });

  it("greys out what cannot be done and always says why", () => {
    // Task test 4: a dead row is information, and a dead row with no sentence
    // on it is the thing the player asks the screen about and gets nothing.
    const cases = [
      ["a full rack and no money", (g: RoomGame) => (voyageOf(g).credits = 0)],
      ["no drone at all", (g: RoomGame) => (voyageOf(g).hull = undefined)],
      ["a hull under tow", (g: RoomGame) => (currentDerelict(g).sold = true)],
    ] as const;

    for (const [what, set] of cases) {
      const game = newGame(4);
      set(game);
      const rows = screen(game);
      expect(rows.length, what).toBe(ALL_VERBS.length);
      for (const row of rows) {
        if (row.enabled) continue;
        expect(row.why, `${what}: ${row.label}`).toBeTruthy();
      }
    }
  });

  it("folds a verb aimed at several modules into one line and a list under it", () => {
    // Task test 1а, and the owner's own frame: «на выбор только продавать себя
    // — ты ебнулся?», said at a station whose whole list was six copies of
    // `sell MODULE (4 CR)`.
    const game = newGame(4);
    const sell = screen(game).find((a) => a.step === "sell")!;
    expect(sell.label).toBe("sell for good ▸");
    expect(sell.enabled).toBe(true);

    const under = picks(game, "sell");
    expect(under).toHaveLength(filled(game).length + 1);
    // Every module, with the state the choice turns on, and the way back out.
    // The verb is not repeated on the line: the row above it is the verb.
    expect(under[0]!.label).toMatch(/^\w+ \d+\/\d+ {2}\d+ CR$/);
    expect(under[under.length - 1]!.step).toBe(null);
    expect(under[under.length - 1]!.key).toBe("0");
  });

  it("keeps one copy of every line, on the screen and on the answering list", () => {
    // Task test 6, the one that catches a station forgotten in the move. The
    // two lists are different shapes on purpose — the screen folds six sells
    // into one row — but neither may hold a verb the other has never heard of,
    // which is the defect G41 spent a pass on.
    for (const seed of seedRange(1, 40)) {
      const game = newGame(seed);
      const flat = new Set(gatedOffers(game).map(verbOf));
      const shown = new Set(
        screen(game).map((a) =>
          typeof a.step === "string"
            ? a.step
            : a.cmd.kind === "act"
              ? a.cmd.verb.replace(/^no-/, "")
              : a.cmd.kind,
        ),
      );
      expect([...shown].sort(), `seed ${seed}`).toEqual([...ALL_VERBS].sort());

      // Reachable, not merely on a row: the dock's shelf has no row of its own
      // — it rides on the hold's, because everything that puts a module on the
      // drone belongs in one place and the panel at home has ten numbered lines
      // and no eleventh. This used to be written as an exception for `order`,
      // and the exception was the hole the shelf fell through: it was on no
      // screen in any state, and the test stayed green (docs/tug-menu-audit.md,
      // defect 4).
      const reachable = new Set(shown);
      for (const row of screen(game)) {
        if (typeof row.step !== "string") continue;
        for (const pick of picks(game, row.step)) {
          if (pick.cmd.kind === "act") reachable.add(pick.cmd.verb);
        }
      }
      // `close` is the one line the tug drops on purpose: nothing is ever
      // aboard to shut a bulkhead on, so all it walls off is the player.
      for (const verb of flat) {
        if (verb === "close") continue;
        expect(reachable.has(verb), `${verb} on seed ${seed}`).toBe(true);
      }
    }
  });

  it("is the same list from every compartment, because there is no walking", () => {
    // Nothing takes the drone out of the DOCK any more, but the rules must not
    // depend on that: the list is a function of the voyage, not of the room.
    const game = newGame(4);
    const first = screen(game).map((a) => a.label);
    for (const door of [T1, T2, T3]) {
      game.playerCommand({ kind: "go", door });
      expect(screen(game).map((a) => a.label), game.roomOf(game.player).name).toEqual(first);
    }
  });
});

// ------------------------------------------------------------- the group holds

/**
 * A group's own list outlives every target but the last
 * (docs/tug-menu-audit.md, defect 1 — the owner's complaint word for word:
 * «нельзя взять все контракты, после 2 из 3 выкинет на основное меню»).
 *
 * The threshold that decided it was written for a different question — whether
 * stepping into a list of one is worth the keystroke — and `tugStands` asked it
 * after every action to find out whether the level the player was standing in
 * still existed. Two targets left meant a level; one meant the screen went home
 * on its own, with the highlight on the row that casts off.
 */
describe("a group's list stands while it has a target", () => {
  /** A third charter on the board: no first hull ever draws one, all 60 seeds. */
  function thirdCharter(game: RoomGame): void {
    voyageOf(game).offered.push({ id: "salvage", text: "haul the lot home", payout: 33 });
  }

  it("signs every charter on the board without leaving the group", () => {
    const game = newGame(4);
    thirdCharter(game);

    for (const left of [3, 2, 1]) {
      expect(picks(game, "charter"), `${left} on the board`).toHaveLength(left + 1);
      expect(tugStands(game, "charter"), `${left} on the board`).toBe(true);
      const sign = picks(game, "charter")[0]!;
      expect(sign.enabled, sign.label).toBe(true);
      expect(game.playerCommand(sign.cmd).ok).toBe(true);
    }

    expect(voyageOf(game).charters).toHaveLength(3);
    expect(voyageOf(game).offered).toHaveLength(0);
    // Only an empty board closes the level, and then it closes onto the group's
    // own row rather than a step short of it.
    expect(tugStands(game, "charter")).toBe(false);
  });

  it("mends every damaged module without leaving the group, paying for each", () => {
    const game = newGame(4);
    const rig = rigOf(game.player)!;
    const slots = filled(game);
    for (const slot of slots) rig.slots[slot]!.integrity = 1;
    voyageOf(game).credits = 500;

    let credits = voyageOf(game).credits;
    for (let left = slots.length; left > 0; left--) {
      expect(picks(game, "repair"), `${left} damaged`).toHaveLength(left + 1);
      expect(tugStands(game, "repair"), `${left} damaged`).toBe(true);
      const mend = picks(game, "repair")[0]!;
      expect(game.playerCommand(mend.cmd).ok).toBe(true);
      expect(voyageOf(game).credits, mend.label).toBeLessThan(credits);
      credits = voyageOf(game).credits;
    }

    expect(tugStands(game, "repair")).toBe(false);
    expect(stationTargets(game, "repair")).toHaveLength(0);
  });

  it("opens a group as a list even when one target is left in it", () => {
    // Defect 3 of the audit. The row used to become the last thing under it,
    // so `8` was the list of sales on one screen and, on the next, the sale of
    // the last module — for good, with the word "for good" left behind on the
    // group's label.
    const game = newGame(4);
    const slots = filled(game);
    for (const slot of slots.slice(0, -1)) {
      expect(game.playerCommand({ kind: "act", verb: "sell", slot }).ok).toBe(true);
    }
    expect(filled(game)).toHaveLength(1);

    const sell = screen(game).find((a) => a.step === "sell")!;
    expect(sell.label, "still the group's own word").toBe("sell for good ▸");
    expect(sell.enabled).toBe(true);

    const under = picks(game, "sell");
    expect(under).toHaveLength(2);
    expect(under[0]!.label).toMatch(/^\w+ \d+\/\d+ {2}\d+ CR$/);
    expect(under[1]!.step).toBe(null);
    expect(under[1]!.key).toBe("0");
  });

  it("puts the dock's shelf in the list the hold's row opens, with its own reasons", () => {
    // Defects 4 and 5 of the audit, and the owner's other complaint: «магаз
    // модулей где?». The row was built from both verbs and the list under it
    // from one, so the shelf was on no screen in any state of the game — and
    // the row's greyed sentence was the shelf's first line, printed over a hold
    // that had never held anything.
    const game = newGame(4);
    expect(voyageOf(game).hold, "a fresh run holds nothing").toHaveLength(0);

    const row = screen(game).find((a) => a.step === "fit")!;
    expect(row.label).toBe("hold & shelf ▸");
    expect(row.enabled, "a whole drone needs none of the three").toBe(false);
    expect(row.why, "its own verb's, and the hold has nothing to say").toBe(
      "Nothing in the hold, nothing to take off the shelf.",
    );

    const under = picks(game, "fit");
    expect(under.map((a) => a.label)).toEqual([
      "buy CUTTER 20 CR",
      "buy PLATING 15 CR",
      "buy THRUSTERS 15 CR",
      "back",
    ]);
    // Every shelf line is dead for a reason of its own, and says it.
    for (const line of under.slice(0, -1)) {
      expect(line.enabled, line.label).toBe(false);
      expect(line.why, line.label).toMatch(/^The drone already carries a \w+\.$/);
    }
  });
});

// --------------------------------------------------------------- casting off

/**
 * The one row of the tug that cannot be taken back says what the visit home
 * has left undone (docs/tug-menu-audit.md, "what a designer would do", 5).
 *
 * Not a confirmation: a modal screen is the one thing design-doc.md rules out
 * by name. A line, read before it is pressed — and the price of both entries on
 * it is already measured in `systems/voyage.ts` (`STATION_ORDER`): charters
 * left unsigned behind a drone that has flown cost 1.81 → 0.41 a voyage.
 */
describe("the row that casts off", () => {
  const castOff = (game: RoomGame): string => stationTargets(game, "undock")[0]!.label;

  it("lists what is left undone, and names the hull when nothing is", () => {
    const game = newGame(4);
    const rig = rigOf(game.player)!;
    const slots = filled(game);

    // A board with nothing signed on it is the whole of a fresh screen's debt.
    expect(voyageOf(game).charters).toHaveLength(0);
    expect(castOff(game)).toBe("cast off no job");

    rig.slots[slots[0]!]!.integrity = 1;
    rig.slots[slots[1]!]!.integrity = 1;
    expect(castOff(game)).toBe("cast off 2 dmg, no job");

    expect(game.playerCommand(picks(game, "charter")[0]!.cmd).ok).toBe(true);
    expect(castOff(game)).toBe("cast off 2 dmg");

    voyageOf(game).credits = 500;
    while (stationTargets(game, "repair").length > 0) {
      expect(game.playerCommand(stationTargets(game, "repair")[0]!.cmd).ok).toBe(true);
    }
    expect(castOff(game)).toBe(`cast off → ${flavourCallsign(currentDerelict(game).flavour)}`);
  });

  it("holds the column in all three languages with everything outstanding", () => {
    // The callsign gives way to the checklist rather than sharing the row with
    // it, and this is why: twenty-five columns, and the longest callsign is
    // thirteen of them.
    const game = newGame(4);
    const rig = rigOf(game.player)!;
    for (const slot of filled(game)) rig.slots[slot]!.integrity = 1;

    try {
      for (const lang of LANGS) {
        setLang(lang);
        const label = castOff(game);
        expect(label, lang).toContain(t("undock.left.charter"));
        expect(label.length, `${lang}: ${label}`).toBeLessThanOrEqual(ACTION_WIDTH);
      }
    } finally {
      setLang("en");
    }
  });
});

// -------------------------------------------------------------------- the hold

describe("the hold", () => {
  /** Stow the module in `slot` and hand back what the hold ended up with. */
  function stow(game: RoomGame, slot: number): ReturnType<typeof voyageOf>["hold"] {
    expect(game.playerCommand({ kind: "act", verb: "stow", slot }).ok).toBe(true);
    return voyageOf(game).hold;
  }

  it("takes a module off the rack whole and puts it back the same", () => {
    // Task test 5. `voyage.hold` was written, capped and read from before this
    // task and never once filled: nothing in the game put a module there, so
    // `fitFromHold` was unreachable code and `HOLD_LIMIT` capped nothing.
    const game = newGame(4);
    const rig = rigOf(game.player)!;
    const slot = filled(game)[0]!;
    const kind = rig.slots[slot]!.kind;
    rig.slots[slot]!.integrity = 3;
    const credits = voyageOf(game).credits;

    expect(stow(game, slot)).toEqual([{ kind, integrity: 3 }]);
    expect(rig.slots[slot]).toBe(null);
    expect(voyageOf(game).credits, "stowing is free").toBe(credits);

    expect(game.playerCommand({ kind: "act", verb: "fit", target: 2100 }).ok).toBe(true);
    expect(voyageOf(game).hold).toEqual([]);
    expect(rig.slots.find((s) => s?.kind === kind)?.integrity).toBe(3);
  });

  it("holds its limit and refuses the next, with the reason on the line", () => {
    // Filled by hand rather than by stowing: the hold takes six now and a rack
    // carries five, and stowing may never empty the rack — so the limit cannot
    // be reached from the rack alone. What the hold fills from is the drone
    // walking home with its arms full (`CARRY_LIMIT`, twist/rig.ts).
    const game = newGame(4);
    const slots = filled(game);
    voyageOf(game).hold = Array.from({ length: HOLD_LIMIT }, () => ({
      kind: "cell" as const,
      integrity: 3,
    }));

    const out = game.playerCommand({ kind: "act", verb: "stow", slot: slots[0]! });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(voyageOf(game).hold).toHaveLength(HOLD_LIMIT);

    const row = screen(game).find((a) => a.step === "stow" || a.cmd.kind === "act")!;
    const stowRow = screen(game).find((a) => a.label.startsWith("stow"))!;
    expect(stowRow.enabled).toBe(false);
    expect(stowRow.why).toBe(`The hold already holds ${HOLD_LIMIT}. Fit one back first.`);
    expect(row).toBeDefined();
  });

  it("belongs to the tug: it survives a sortie and a drone that does not come back", () => {
    const game = newGame(4);
    const rig = rigOf(game.player)!;
    const slot = filled(game)[0]!;
    const kind = rig.slots[slot]!.kind;
    stow(game, slot);

    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    expect(voyageOf(game).hold).toEqual([{ kind, integrity: rig.slots[slot]?.integrity ?? expect.anything() }]);

    // The drone dies out there. The hold is the tug's, so it is still full.
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);
    expect(voyageOf(game).hull).toBeUndefined();
    expect(voyageOf(game).hold.map((h) => h.kind)).toEqual([kind]);
  });

  it("says a sale is for good, and says it once in the log as well", () => {
    // The defect behind the owner's «я продал резак и не понимаю, как купить
    // его обратно»: the Russian line read «Сдано в трюм» — handed to the hold —
    // for a module that was gone for ever.
    const game = newGame(4);
    const slot = filled(game)[0]!;
    const module = moduleName(rigOf(game.player)!.slots[slot]!.kind);

    expect(game.playerCommand({ kind: "act", verb: "sell", slot }).ok).toBe(true);
    expect(voyageOf(game).hold, "a sale is not a stow").toEqual([]);

    const said = game.log.lines.map((l) => l.text);
    expect(said.some((s) => s.startsWith(`Sold for good — ${module}:`))).toBe(true);
    expect(said.filter((s) => s.startsWith("Sold for good: nobody sells modules back"))).toHaveLength(1);

    // Once a run: the second sale is a decision the player has already been
    // told the price of.
    game.playerCommand({ kind: "act", verb: "sell", slot: filled(game)[0]! });
    expect(
      game.log.lines.filter((l) => l.key === "hint.sell"),
      "the warning is said once",
    ).toHaveLength(1);
  });

  it("shows the shelf always and opens it only on what the drone has lost", () => {
    // Always visible, because a shelf that vanishes the moment the drone is
    // whole is a shelf nobody knows exists — the owner played four hours and
    // asked «магаз модулей где?». Never live while the drone is whole, because
    // an enabled line is one a bot presses for 20 CR that a jump needed.
    const game = newGame(4);
    const shelf = stationTargets(game, "order");
    expect(shelf.map((o) => o.label)).toEqual([
      "buy CUTTER 20 CR",
      "buy PLATING 15 CR",
      "buy THRUSTERS 15 CR",
    ]);
    expect(shelf.every((o) => !o.enabled)).toBe(true);
    expect(shelf[0]!.why).toBe("The drone already carries a CUTTER.");
  });

  it("opens the shelf on exactly what burned out", () => {
    const game = newGame(4);
    voyageOf(game).credits = 500;
    const rack = rigOf(game.player)!;
    const cutter = findSlot(rack, "cutter")!;
    rack.slots[cutter] = null;

    const shelf = stationTargets(game, "order");
    expect(shelf.map((o) => o.label)).toEqual([
      "buy CUTTER 20 CR",
      "buy PLATING 15 CR",
      "buy THRUSTERS 15 CR",
    ]);
    // Only the one it lost is live; the other two say why not.
    expect(shelf.map((o) => o.enabled)).toEqual([true, false, false]);

    // Bought into the hold — which is how a player finds the hold at all — and
    // gone off the shelf until the tug moves on.
    expect(game.playerCommand(shelf[0]!.cmd as RoomCommand).ok).toBe(true);
    expect(voyageOf(game).hold.map((h) => h.kind)).toEqual(["cutter"]);
    // Bought and gone: the line stays on the list and stops being live.
    expect(stationTargets(game, "order").every((o) => !o.enabled)).toBe(true);
    expect(voyageOf(game).credits).toBe(480);
  });

  it("sells nothing at all while the rail is empty", () => {
    // With no drone the answer is a drone: a whole hull with a whole rack is
    // 40 CR against 20 for one CUTTER.
    const game = newGame(4);
    voyageOf(game).credits = 500;
    voyageOf(game).hull = undefined;
    const shelf = stationTargets(game, "order");
    expect(shelf).toHaveLength(3);
    expect(shelf.every((o) => !o.enabled)).toBe(true);
    expect(shelf[0]!.why).toBe("Nothing on the rails to fit it to.");
  });
});

// ------------------------------------------------------------- the two names

/**
 * The tug and the hull it is tied to never answer to the same name
 * (docs/tasks/G54-two-ships-confusion.md, 4).
 *
 * The owner's second run opened on `ТВОЙ БУКСИР «BRIGHT ANCHOR» · пришвартован:
 * BRIGHT ANCHOR`, and from there no line of the screen could be read as being
 * about one ship rather than the other. Both names came out of a list, and four
 * of the eight the tug drew from were in the derelicts' list too.
 */
describe("the tug and the hull have different names", () => {
  /** Every word of a callsign, so `IRON KESTREL` beside `KESTREL` is caught. */
  const words = (name: string): string[] => name.split(" ");

  it("shares not one word between the two lists", () => {
    const theirs = new Set(CALLSIGNS.flatMap(words));
    for (const tug of TUG_CALLSIGNS) {
      expect(CALLSIGNS, tug).not.toContain(tug);
      for (const word of words(tug)) expect(theirs.has(word), `${tug}: ${word}`).toBe(false);
    }
  });

  it("gives no seed of 500 a tug named after a hull of its own voyage", () => {
    for (const seed of seedRange(1, 500)) {
      const name = tugCallsign(seed);
      expect(CALLSIGNS, `seed ${seed}`).not.toContain(name);
    }
  });

  it("says both names on the first screen, and they read as two ships", () => {
    for (const seed of seedRange(1, 200)) {
      const game = newGame(seed);
      const tug = tugCallsign(seed);
      const hull = flavourCallsign(currentDerelict(game).flavour);
      expect(tug, `seed ${seed}`).not.toBe(hull);
      const board = tugBoard(game);
      expect(board[0], `seed ${seed}`).toContain(tug);
      expect(board[0], `seed ${seed}`).toContain(hull);
    }
  });
});

// -------------------------------------------------------------- one ship each

/**
 * On the tug, nothing on the screen names a compartment of the derelict as
 * somewhere the drone is standing
 * (docs/tasks/G54-two-ships-confusion.md, 1 and 3).
 */
describe("one screen, one ship", () => {
  it("names no derelict compartment at home, on 200 seeds", () => {
    // Every compartment name the catalogue has, which is what the derelict's
    // own blocks would print. `DOCK`, `HOLD`, `BENCH` and `HELM` are on it as
    // the tug's four rooms: those are the collision the task is named after,
    // and none of them may reach the screen either.
    const names = new Set(
      [...ZONE_KINDS.map((z) => zoneName(z.kind)), ...TUG_KINDS.map(stationName)].map((n) => n.trim()),
    );
    for (const seed of seedRange(1, 200)) {
      const game = newGame(seed);
      const lines = [...tugBoard(game), ...panelBlocks(game, roomActions(game)).map((l) => l.text)];
      for (const line of lines) {
        // Whole words: a callsign may perfectly well hold `BRIG` inside
        // `BRIGHT ANCHOR`, and that is a name of a ship, not of a room.
        for (const word of line.split(/[^\p{L}]+/u)) {
          expect(names.has(word), `seed ${seed}: ${line} holds ${word}`).toBe(false);
        }
      }
    }
  });

  it("heads with the tug and never with the word for a derelict", () => {
    const game = newGame(4);
    const head = panelBlocks(game, roomActions(game))[0]!.text;
    expect(head.startsWith(t("panel.head.tug"))).toBe(true);
    expect(head).not.toContain(t("word.derelict"));
  });
});

// ------------------------------------------------------------------ two modes

describe("the two halves of the game are told apart", () => {
  it("offers nothing of the derelict at home and nothing of the tug aboard", () => {
    // Task test 7. Aboard: no station verb. At home: nothing to hide behind, no
    // bulkhead to shut, no wreck to strip, and nothing to walk to.
    for (const seed of seedRange(1, 60)) {
      const game = newGame(seed);
      const home = screen(game).map((a) => a.cmd.kind === "act" ? a.cmd.verb : a.cmd.kind);
      for (const verb of ["hide", "close", "salvage", "search", "work", "go", "leave", "attack"]) {
        expect(home, `seed ${seed}`).not.toContain(verb);
      }

      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      const aboard = new Set(gatedOffers(game).map(verbOf));
      for (const verb of ALL_VERBS) expect(aboard.has(verb), `${verb} on seed ${seed}`).toBe(false);
    }
  });

  it("refuses a station verb out on a hull, without a turn", () => {
    const game = newGame(4);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    const before = game.schedule.time;

    const out = game.playerCommand({ kind: "act", verb: "sell", slot: 0 });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe("That is a job for the tug, not for out here.");
    expect(game.schedule.time).toBe(before);
  });
});

// ----------------------------------------------------------------- the replay

describe("a visit to the tug", () => {
  it("replays bit for bit", () => {
    const seed = 20260904;
    const game = newGame(seed);
    const slot = filled(game)[0]!;
    game.playerCommand({ kind: "act", verb: "stow", slot });
    game.playerCommand({ kind: "act", verb: "sell", slot: filled(game)[0]! });
    game.playerCommand({ kind: "act", verb: "fit", target: 2100 });
    game.playerCommand({ kind: "act", verb: "undock" });
    game.playerCommand({ kind: "leave" });

    const again = replayRooms(seed, [...game.inputs], GAME_CONFIG);

    expect(again.inputs).toEqual(game.inputs);
    expect(again.shipId).toBe(game.shipId);
    expect(voyageOf(again).credits).toBe(voyageOf(game).credits);
    expect(voyageOf(again).hold).toEqual(voyageOf(game).hold);
    expect(again.ship.toJSON()).toEqual(game.ship.toJSON());
    expect(texts(again.log.lines)).toEqual(texts(game.log.lines));
  });

  it("records only what was accepted, so a refusal never enters the replay", () => {
    const game = newGame(4);
    voyageOf(game).credits = 0;
    game.playerCommand({ kind: "act", verb: "repair", slot: 0 });
    game.playerCommand({ kind: "act", verb: "sell", slot: filled(game)[0]! });

    expect(game.inputs.map((c) => (c.kind === "act" ? c.verb : c.kind))).toEqual(["sell"]);
  });
});

// ------------------------------------------------------------ the whole game

describe("a run, as it starts", () => {
  function undock(game: RoomGame): void {
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
  }

  it("begins on the tug, with a drone on the rails and 25 CR", () => {
    const game = newGame(4);

    expect(game.shipId).toBe(TUG_ID);
    expect(isTug(game)).toBe(true);
    expect(game.entities).toHaveLength(1);

    const voyage = voyageOf(game);
    expect(voyage.credits).toBe(STARTING_CREDITS);
    expect(voyage.hull).toBe(STARTING_HULL.id);
    expect(voyage.sortie).toBe(0);
  });

  it("grows nothing and hears nothing over two hundred turns at home", () => {
    const game = newGame(9);

    for (let turn = 0; turn < 200; turn++) game.playerCommand({ kind: "wait" });

    expect(game.status).toBe("playing");
    expect(game.entities).toHaveLength(1);
    expect(alertState(game).level).toBe(0);
  });

  it("generates the first derelict on the first undock, and keeps it", () => {
    const game = newGame(4);
    expect(game.ships.get("1")).toBeUndefined();

    undock(game);
    expect(game.shipId).toBe("1");
    expect(voyageOf(game).sortie).toBe(1);
    const hull = game.ship;
    expect(hull.rooms.length).toBeGreaterThan(4);

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe(TUG_ID);

    undock(game);
    expect(game.ship).toBe(hull);
    expect(voyageOf(game).sortie).toBe(2);
  });

  it("costs a turn a line, like everything else in the game", () => {
    // The decision written up in `systems/voyage.ts`: free was measured and
    // gave back four turns of a 164-turn voyage while costing five of the
    // seven wins in 200 that `tests/winnable.test.ts` holds.
    const game = newGame(4);
    const before = game.schedule.time;
    expect(game.playerCommand({ kind: "act", verb: "stow", slot: filled(game)[0]! }).cost).toBe(TURN_COST);
    expect(game.schedule.time).toBeGreaterThan(before);
  });

  it("says tug over the tug and names the derelict over the derelict", () => {
    const game = newGame(4);
    const head = (g: RoomGame): string => panelBlocks(g, roomActions(g))[0]!.text;

    // The hull by its callsign: a voyage is four of them and three can be
    // freighters (docs/tasks/G55-playtest-findings.md).
    expect(head(game)).toBe(`SALVOR  tug → ${flavourCallsign(currentDerelict(game).flavour)}`);
    expect(schematicInputOf(game).shipLine).toBe(
      `${tugCallsign(4)} · your tug · docked to ${derelictName(currentDerelict(game).spec)}`,
    );
    expect(head(game).length).toBeLessThanOrEqual(PANEL_WIDTH);

    undock(game);
    expect(head(game)).toBe(`SALVOR  ${flavourCallsign(currentDerelict(game).flavour)}  sortie 1`);
    expect(head(game)).not.toContain("tug");
    const line = schematicInputOf(game).shipLine;
    expect(line).not.toContain("your tug");
    expect(line.startsWith(flavourCallsign(currentDerelict(game).flavour)!)).toBe(true);
  });

  it("gives the tug a callsign off the seed, the same one every replay", () => {
    expect(tugCallsign(4)).toBe(tugCallsign(4));
    expect(new Set(Array.from({ length: 40 }, (_, i) => tugCallsign(i))).size).toBeGreaterThan(1);
    expect(TUG_CALLSIGNS).toContain(tugCallsign(20260904));
  });

  it("prices every folded line the same as the line it folds", () => {
    // The two lists are built out of one function, and this is what says so:
    // whatever `stationTargets` prices, `stationOffers` refuses or allows on
    // exactly the same terms.
    for (const seed of seedRange(1, 40)) {
      const game = newGame(seed);
      voyageOf(game).credits = seed % 40;
      for (const verb of [...ALL_VERBS, "order"]) {
        const targets = stationTargets(game, verb);
        const flat = stationOffers(game).filter((o) => verbOf(o) === verb);
        expect(flat.length > 0, `${verb} on seed ${seed}`).toBe(targets.length > 0);
        if (targets.length === 0) continue;
        expect(flat.some((o) => o.enabled), `${verb} on seed ${seed}`).toBe(
          targets.some((o) => o.enabled),
        );
      }
    }
  });
});
