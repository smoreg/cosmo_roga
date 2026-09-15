import { describe, it, expect } from "vitest";
import { RoomGame, type CardContext, type Outcome, type RoomCommand, type RoomId } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { FREIGHTER, derelictShip } from "../src/content/derelicts.js";
import { CHEAPEST_HULL } from "../src/content/hulls.js";
import { moduleKind, type ModuleId } from "../src/content/modules.js";
import { CORE, ENGINE, HANDS_NOISE, OBJECTIVES, TERMINAL } from "../src/content/objectives.js";
import { SHIP, objectiveHere, systemsAboard } from "../src/systems/ship.js";
import { shipState } from "../src/systems/shipstate.js";
import { TUG_ID, VOYAGE, currentDerelict, voyageOf } from "../src/systems/voyage.js";
import { HUNTER_LEVEL, alertState } from "../src/systems/alert.js";
import { DOORS } from "../src/systems/doors.js";
import { POPULATE, roomList, type ShipSystem } from "../src/systems/populate.js";
import { applyDerived, findSlot, rigOf, type Rig } from "../src/twist/rig.js";

/**
 * Neutralising a derelict: three systems, the tools that raise them, and what
 * the airlock means afterwards.
 *
 * The game is the real one — same pack, same twist, same systems — and only the
 * graph and the rack are written out, so nothing here rides on a lucky seed.
 * What is being tested is the bargain: a tool the drone has to carry, turns it
 * has to spend in a row with that tool exposed, and a ship that hears every one
 * of them.
 */

/** A hull drawn before the drone that walks into it: no flags, first of the run. */
const NO_RUN: CardContext = { flags: new Set<string>(), shipIndex: 0 };

/** A freighter with its three systems, one per compartment, in a line. */
const DERELICT = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r1: docking
  r2: engineering E
  r3: reactor O
  r4: control T
`;

/** The same hull with nothing aboard to bring online: the v1 ending. */
const STRIPPED = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking
  r2: cargo
`;

/**
 * A run on a hand-written hull, with the alert left out.
 *
 * Everything else is the real game — same pack, same twist, same door and
 * content systems, and VOYAGE, which owns what an airlock means since G26 and
 * without which `leave` is the engine's own "you got out alive". ALERT is the
 * one thing dropped, because a system coming online sends machines after the
 * drone by design (`raiseAlert`), and a reinforcement walking in to burn the
 * CUTTER halfway through a splice would make every test below a test of the
 * alert. The one test that *is* about the alert builds the whole game instead.
 */
function gameOn(text: string, seed = 5): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    systems: [POPULATE, DOORS, SHIP, VOYAGE],
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  });
}

function rig(game: RoomGame): Rig {
  return rigOf(game.player)!;
}

/** Put a module in the rack: the empty slot if there is one, else the last. */
function give(game: RoomGame, kind: ModuleId, integrity = moduleKind(kind).integrity): number {
  const r = rig(game);
  const empty = r.slots.findIndex((s) => s === null);
  const slot = empty >= 0 ? empty : r.slots.length - 1;
  r.slots[slot] = { kind, integrity };
  applyDerived(game.player);
  return slot;
}

/** Take a module out of the rack, the way a burn-out would. */
function drop(game: RoomGame, kind: ModuleId): void {
  const r = rig(game);
  const slot = findSlot(r, kind);
  if (slot !== null) r.slots[slot] = null;
  applyDerived(game.player);
}

function keys(game: RoomGame, count: number): void {
  (game.player.data ??= {}).keys = count;
}

function keysOf(game: RoomGame): number {
  return (game.player.data?.keys as number | undefined) ?? 0;
}

function loot(game: RoomGame): number {
  return (game.player.data?.loot as number | undefined) ?? 0;
}

/** Stand the drone in a compartment without spending a turn getting there. */
function standIn(game: RoomGame, label: string): RoomId {
  const room = game.ship.room(label);
  game.player.room = room.id;
  game.refreshSight();
  return room.id;
}

/** The system standing in a compartment, by the label of the compartment. */
function systemIn(game: RoomGame, label: string): ShipSystem {
  const found = roomList<ShipSystem>(game.ship.room(label), "systems")[0];
  expect(found, `no system in ${label}`).toBeDefined();
  return found!;
}

function workOn(game: RoomGame, label: string): Outcome {
  return game.playerCommand({ kind: "act", verb: "work", target: systemIn(game, label).id });
}

/** One turn of the same system with nothing in the rack. */
function forceOn(game: RoomGame, label: string): Outcome {
  return game.playerCommand({ kind: "act", verb: "force", target: systemIn(game, label).id });
}

/** Work a system all the way up, one legal turn after another. */
function raiseIn(game: RoomGame, label: string, turns: number): void {
  standIn(game, label);
  for (let i = 0; i < turns; i++) expect(workOn(game, label).ok, `turn ${i + 1}`).toBe(true);
}

function lastLine(game: RoomGame): string {
  return game.log.lines[game.log.lines.length - 1]?.text ?? "";
}

function lines(game: RoomGame): string[] {
  return game.log.lines.map((m) => m.text);
}

/** How many times a once-a-run line has been said, by the key it carries. */
function said(game: RoomGame, key: string): number {
  return game.log.lines.filter((l) => l.key === key).length;
}

// ------------------------------------------------------------------ the tools

describe("what a system takes to bring up", () => {
  it("refuses the core without a CELL, and the refusal costs no turn", () => {
    const game = gameOn(DERELICT);
    drop(game, "cell");
    standIn(game, "r3");

    const out = workOn(game, "r3");

    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe("Needs a CELL.");
    // Nothing was recorded, so nothing replays and the machines never moved.
    expect(game.inputs).toHaveLength(0);
    expect(shipState(game).online).toEqual([]);
  });

  it("names both tools of a system it cannot work on", () => {
    const game = gameOn(DERELICT);
    drop(game, "cutter");
    standIn(game, "r2");

    expect(workOn(game, "r2").reason).toBe("Needs a CUTTER or a WELDER.");
  });

  it("brings the terminal up with a keycard in one turn, and spends the card", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    standIn(game, "r4");

    expect(workOn(game, "r4").ok).toBe(true);
    expect(keysOf(game)).toBe(0);
    expect(shipState(game).online).toEqual(["terminal"]);
    expect(systemIn(game, "r4").online).toBe(true);
  });

  it("takes two turns of the SPIKE instead, and leaves the SPIKE in the rack", () => {
    const game = gameOn(DERELICT);
    const spike = give(game, "spike");
    standIn(game, "r4");

    expect(workOn(game, "r4").ok).toBe(true);
    expect(shipState(game).online).toEqual([]);
    expect(shipState(game).work).toEqual({ id: systemIn(game, "r4").id, left: 1, tool: "spike" });

    expect(workOn(game, "r4").ok).toBe(true);
    expect(shipState(game).online).toEqual(["terminal"]);
    expect(rig(game).slots[spike]?.kind).toBe("spike");
  });

  it("prefers the SPIKE to the one keycard the drone is carrying", () => {
    const game = gameOn(DERELICT);
    give(game, "spike");
    keys(game, 1);
    standIn(game, "r4");

    expect(workOn(game, "r4").ok).toBe(true);
    expect(keysOf(game)).toBe(1);
    expect(shipState(game).work?.tool).toBe("spike");
  });

  it("takes three turns of the CUTTER on the engine", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");

    expect(workOn(game, "r2").ok).toBe(true);
    expect(workOn(game, "r2").ok).toBe(true);
    expect(shipState(game).online).toEqual([]);
    expect(workOn(game, "r2").ok).toBe(true);
    expect(shipState(game).online).toEqual(["engine"]);
  });

  it("takes a point of the CELL the core was brought up with", () => {
    const game = gameOn(DERELICT);
    const cell = findSlot(rig(game), "cell")!;
    const full = rig(game).slots[cell]!.integrity;

    raiseIn(game, "r3", 2);

    expect(shipState(game).online).toEqual(["core"]);
    expect(rig(game).slots[cell]?.integrity).toBe(full - 1);
  });

  it("refuses a system that is already online, and costs no turn", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    raiseIn(game, "r4", 1);

    const out = workOn(game, "r4");
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(out.reason).toBe("The TERMINAL is already online.");
    expect(shipState(game).online).toEqual(["terminal"]);
  });

  it("refuses a system that is not in this compartment", () => {
    const game = gameOn(DERELICT);
    const far = systemIn(game, "r4").id;
    standIn(game, "r2");

    const out = game.playerCommand({ kind: "act", verb: "work", target: far });
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
  });
});

// ------------------------------------------------------------- turns in a row

describe("turns in a row", () => {
  it("exposes the tool on every turn of the job", () => {
    const game = gameOn(DERELICT);
    const spike = give(game, "spike");
    standIn(game, "r4");

    workOn(game, "r4");
    expect(rig(game).exposed).toBe(spike);
    workOn(game, "r4");
    expect(rig(game).exposed).toBe(spike);
  });

  it("exposes the PLATING when the job is the keycard: hands-on work", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    standIn(game, "r4");

    workOn(game, "r4");
    expect(rig(game).exposed).toBe(findSlot(rig(game), "plating"));
  });

  it("makes the table's noise every turn of the job", () => {
    const game = gameOn(DERELICT);
    give(game, "spike");
    const room = standIn(game, "r4");

    workOn(game, "r4");
    expect(game.noise.get(room)).toBe(TERMINAL.jobs[0]!.noise);
  });

  it("drops the job the turn anything else happens, and starts it over", () => {
    const game = gameOn(DERELICT);
    give(game, "spike");
    standIn(game, "r4");

    workOn(game, "r4");
    expect(shipState(game).work?.left).toBe(1);

    game.playerCommand({ kind: "wait" });
    expect(lastLine(game)).toBe("You break off the splice. 1 of 2 turns, gone.");
    expect(shipState(game).work).toBeUndefined();

    // And the next turn of it is the first turn again, not the last.
    expect(workOn(game, "r4").ok).toBe(true);
    expect(shipState(game).online).toEqual([]);
    expect(shipState(game).work?.left).toBe(1);
  });

  it("does not call a finished job broken off", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    raiseIn(game, "r4", 1);

    expect(lines(game).some((l) => l.startsWith("You break off the splice"))).toBe(false);
    expect(shipState(game).work).toBeUndefined();
  });
});

// ------------------------------------------------------------- bare-handed

/**
 * The slow way (G94): every system can be raised with nothing in the rack, and
 * the price is the turns and the noise. The twin of the door the chassis rams
 * open (`systems/doors.ts`), for the same reason — a drone is never stuck in
 * front of the one thing that would finish the hull.
 */
describe("raising a system with nothing in the rack", () => {
  it("is dearer than any tool, in turns and in noise, on all three", () => {
    for (const spec of OBJECTIVES) {
      const turns = Math.max(...spec.jobs.map((j) => j.turns));
      const noise = Math.max(...spec.jobs.map((j) => j.noise));
      expect(spec.hands.tool).toBe("hands");
      expect(spec.hands.turns, `${spec.id}: turns`).toBeGreaterThan(turns);
      expect(spec.hands.noise, `${spec.id}: noise`).toBeGreaterThan(noise);
      expect(spec.hands.noise).toBe(HANDS_NOISE);
    }
  });

  it("offers the slow way only where the tool is missing", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    expect(SHIP.offerActions!(game).map((o) => o.label)).toEqual(["work ENGINE: CUTTER 3"]);

    // A keycard is a tool too: with one on the drone the terminal has one row.
    keys(game, 1);
    standIn(game, "r4");
    expect(SHIP.offerActions!(game).map((o) => o.label)).toEqual(["work TERMINAL: keycard 1"]);

    keys(game, 0);
    expect(SHIP.offerActions!(game).map((o) => o.label)).toEqual([
      "work TERMINAL: SPIKE 2",
      "work TERMINAL: HANDS 12",
    ]);
  });

  it("brings the engine up by hand, one loud turn after another, with the PLATING under every blow", () => {
    const game = gameOn(DERELICT);
    drop(game, "cutter");
    drop(game, "welder");
    const room = standIn(game, "r2");
    const id = systemIn(game, "r2").id;

    for (let turn = 1; turn <= ENGINE.hands.turns; turn++) {
      expect(forceOn(game, "r2").ok, `turn ${turn}`).toBe(true);
      expect(game.noise.get(room), `turn ${turn}`).toBe(HANDS_NOISE);
      expect(rig(game).exposed, `turn ${turn}`).toBe(findSlot(rig(game), "plating"));
      if (turn < ENGINE.hands.turns) {
        expect(shipState(game).work).toEqual({ id, left: ENGINE.hands.turns - turn, tool: "hands" });
        expect(shipState(game).online).toEqual([]);
        // By key and not the last line: the first turn in the compartment
        // is also the turn the run says what the three systems are for.
        const work = game.log.lines.filter((l) => l.key === "log.system.work").at(-1)?.text;
        expect(work).toBe(
          `ENGINE by hand, loud. ${ENGINE.hands.turns - turn} more ${ENGINE.hands.turns - turn === 1 ? "turn" : "turns"}.`,
        );
      }
    }
    expect(shipState(game).online).toEqual(["engine"]);
    expect(shipState(game).work).toBeUndefined();
    expect(systemIn(game, "r2").online).toBe(true);
    expect(lines(game)).toContain("ENGINE ONLINE. The ship notices.");
  });

  it("is a hull that answers: the ship hears the work before the system is up", () => {
    // The whole game this time, alert included. Twelve turns at the ram's
    // noise climb the gauge on their own, and the system coming up on top of
    // them puts the ship at the rung it sends its hunter from.
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed: 5,
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(DERELICT).ship,
      firstShipId: "1",
    });
    standIn(game, "r4");
    for (let turn = 1; turn < TERMINAL.hands.turns; turn++) {
      expect(forceOn(game, "r4").ok, `turn ${turn}`).toBe(true);
    }
    const heard = alertState(game).level;
    expect(heard, "the noise alone climbed the gauge").toBeGreaterThanOrEqual(2);
    expect(shipState(game).online).toEqual([]);

    expect(forceOn(game, "r4").ok).toBe(true);
    expect(shipState(game).online).toEqual(["terminal"]);
    expect(alertState(game).level).toBe(heard + 4);
    expect(alertState(game).level).toBeGreaterThanOrEqual(HUNTER_LEVEL);
  });

  it("spends no CELL on a reactor raised by hand, and no keycard on a terminal", () => {
    const game = gameOn(DERELICT);
    const cell = findSlot(rig(game), "cell")!;
    const full = rig(game).slots[cell]!.integrity;
    keys(game, 1);

    standIn(game, "r3");
    for (let turn = 0; turn < CORE.hands.turns; turn++) expect(forceOn(game, "r3").ok).toBe(true);
    expect(shipState(game).online).toEqual(["core"]);
    expect(rig(game).slots[cell]?.integrity).toBe(full);

    standIn(game, "r4");
    for (let turn = 0; turn < TERMINAL.hands.turns; turn++) expect(forceOn(game, "r4").ok).toBe(true);
    expect(shipState(game).online).toEqual(["core", "terminal"]);
    expect(keysOf(game)).toBe(1);
  });

  it("is dropped the turn anything else happens, and starts over, exactly like a splice", () => {
    const game = gameOn(DERELICT);
    drop(game, "cell");
    standIn(game, "r3");

    forceOn(game, "r3");
    expect(shipState(game).work?.left).toBe(CORE.hands.turns - 1);

    game.playerCommand({ kind: "wait" });
    expect(lastLine(game)).toBe("You break off the splice. 1 of 12 turns, gone.");
    expect(shipState(game).work).toBeUndefined();

    expect(forceOn(game, "r3").ok).toBe(true);
    expect(shipState(game).work?.left).toBe(CORE.hands.turns - 1);
  });

  it("counts down on the row and on the panel while it runs", () => {
    const game = gameOn(DERELICT);
    drop(game, "cell");
    standIn(game, "r3");
    expect(objectiveHere(game)).toMatchObject({ doable: false, left: 2 });

    forceOn(game, "r3");
    // The greyed tool row steps aside while the job runs: a dozen turns of
    // "needs a CELL" under the row being pressed is a lesson already taken,
    // on a list with a budget.
    expect(SHIP.offerActions!(game).map((o) => o.label)).toEqual([`work REACTOR: HANDS ${CORE.hands.turns - 1}`]);
    const here = objectiveHere(game)!;
    expect(here.job.tool).toBe("hands");
    expect(here.doable).toBe(true);
    expect(here.left).toBe(CORE.hands.turns - 1);
  });

  it("refuses by hand exactly what it refuses with a tool: no system here, or one already up", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r1");
    const none = game.playerCommand({ kind: "act", verb: "force", target: systemIn(game, "r2").id });
    expect(none.ok).toBe(false);
    expect(none.cost).toBe(0);

    keys(game, 1);
    raiseIn(game, "r4", 1);
    const up = forceOn(game, "r4");
    expect(up.ok).toBe(false);
    expect(up.cost).toBe(0);
    expect(up.reason).toBe("The TERMINAL is already online.");
  });
});

// ------------------------------------------------------- what a system is worth

describe("a system coming online", () => {
  it("pays the advance into the account and says so, once per system", () => {
    // On account, and not into the hold the drone is carrying: design-doc.md
    // calls it an advance, and G41 made the word true. What the drone has in
    // its hold is untouched by a system coming up.
    const game = gameOn(DERELICT);
    keys(game, 1);
    const account = voyageOf(game).credits;
    const purse = loot(game);

    raiseIn(game, "r4", 1);
    expect(voyageOf(game).credits).toBe(account + TERMINAL.advance);
    expect(loot(game)).toBe(purse);
    expect(lines(game)).toContain("TERMINAL ONLINE. The ship notices.");
    expect(lines(game)).toContain(
      `Charter advance: +${TERMINAL.advance} CR. ${voyageOf(game).credits} CR.`,
    );

    raiseIn(game, "r2", 3);
    expect(voyageOf(game).credits).toBe(account + TERMINAL.advance * 2);
    expect(loot(game)).toBe(purse);
  });

  it("wakes the ship by four rungs, through the alert the game actually runs", () => {
    // The whole system list this time, ALERT included. The keycard job is the
    // one that makes no noise at all (`TERMINAL.jobs`), so the four steps on
    // the gauge are the system coming up and nothing else.
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed: 5,
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(DERELICT).ship,
      firstShipId: "1",
    });
    keys(game, 1);
    const before = alertState(game).level;

    standIn(game, "r4");
    expect(game.playerCommand({ kind: "act", verb: "work", target: systemIn(game, "r4").id }).ok).toBe(true);

    // Four rungs of the ten-rung ladder: design-doc.md's +2 of five (G90 A).
    expect(alertState(game).level).toBe(before + 4);
  });

  /**
   * The line between the last system and the money.
   *
   * The owner flew two derelicts and never worked out that raising three
   * systems is what sells a hull (docs/owner-queue.md, 4), and the log is where
   * that connection was missing: `TERMINAL ONLINE` said exactly what the first
   * two systems said, and the price arrived silently at the airlock.
   */
  it("says what the third system is worth, on the turn it comes up", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);

    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    expect(lines(game).some((l) => l.startsWith("All three started"))).toBe(false);

    raiseIn(game, "r4", 1);
    const said = lines(game).filter((l) => l.startsWith("All three started"));
    expect(said).toHaveLength(1);
    // The sum is the hull's own price, and the sentence says where to take it.
    expect(said[0]).toContain(`+${currentDerelict(game).spec.salePrice} CR`);
    expect(said[0]).toContain("airlock");
    // With the key on it: `<` leaves from any compartment aboard (G48), so the
    // line between the work and the money is one keystroke long.
    expect(said[0]).toContain("`<`");

    // In the order it happened: the system comes up, the ship stands down for
    // it, and the sale is the conclusion of both. "The ship stands down" used
    // to be printed a line above the system that made it stand down (G88, A4).
    const all = lines(game);
    const online = all.indexOf("TERMINAL ONLINE. The ship notices.");
    const down = all.findIndex((l) => l.startsWith("Ship neutralised"));
    const paid = all.indexOf(said[0]!);
    expect(online, "the third system is said").toBeGreaterThanOrEqual(0);
    expect(down, "the stand-down is said").toBeGreaterThan(online);
    expect(paid).toBeGreaterThan(down);
  });

  it("has no panel line of its own: the goal is the panel's to place", () => {
    // `SHIP  engine · core · term ·` sat in the tail of the counters and the
    // owner read two whole derelicts past it. Where the run's goal goes on the
    // screen is a layout decision (`ui/panel.ts`, `missionBlock`), and this
    // system hands over the facts instead of a row.
    expect(SHIP.panelLines).toBeUndefined();
  });

  it("hands the panel the system in this compartment, tool or no tool", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r1");
    expect(objectiveHere(game)).toBeUndefined();

    standIn(game, "r3");
    expect(objectiveHere(game)).toMatchObject({ doable: true, left: 2 });
    expect(objectiveHere(game)!.spec.id).toBe("core");

    // The whole point of the block: with nothing in the rack for it, the
    // compartment still says there is something here to do.
    drop(game, "cell");
    expect(objectiveHere(game)).toMatchObject({ doable: false, left: 2 });

    // And nothing once it is up.
    give(game, "cell");
    raiseIn(game, "r3", 2);
    expect(objectiveHere(game)).toBeUndefined();
  });

  it("counts the splice down for the panel while it runs", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    expect(objectiveHere(game)!.left).toBe(3);
    workOn(game, "r2");
    expect(objectiveHere(game)!.left).toBe(2);
  });

  it("says nothing about a compartment on a hull with no systems aboard", () => {
    const game = gameOn(STRIPPED);
    expect(systemsAboard(game)).toEqual([]);
    expect(objectiveHere(game)).toBeUndefined();
  });
});

// ------------------------------------------------------------ what it teaches

/**
 * The two rules a sortie turns on that nothing on the screen used to state
 * (docs/owner-queue.md, 4 and 5). Both are said once per run, in the log, on
 * the turn they first matter — the rule every onboarding line in this game is
 * held to (design-doc.md, "Обучение конструкцией").
 */
describe("the two lines that say what a sortie is for", () => {
  it("says what the three systems are for, the first time the drone stands on one", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r1");
    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.objective")).toBe(0);

    standIn(game, "r2");
    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.objective")).toBe(1);

    // Once a run, whatever else the drone walks into.
    standIn(game, "r3");
    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.objective")).toBe(1);
  });

  it("keeps quiet about a system already online", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    raiseIn(game, "r4", 1);
    expect(said(game, "hint.objective")).toBe(0);
  });

  it("says that nothing is paid until the drone is out, the turn it first carries credits", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r1");
    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.payout")).toBe(0);

    (game.player.data ??= {}).loot = 8;
    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.payout")).toBe(1);

    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.payout")).toBe(1);
  });

  it("says neither of them on the tug", () => {
    // The tug has no systems and no derelict record under it, and a rule said
    // where it cannot be acted on is a rule nobody connects to anything.
    const game = gameOn(DERELICT);
    (game.player.data ??= {}).loot = 8;
    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe(TUG_ID);

    game.playerCommand({ kind: "wait" });
    expect(said(game, "hint.objective")).toBe(0);
  });
});

// ------------------------------------------------------------- what leaving is

describe("the airlock", () => {
  it("takes the hull under tow when all three answer to the drone", () => {
    // Selling a hull is not winning a run: the voyage is four of them, and only
    // the last is the father's tug (`systems/voyage.ts`, design-doc.md,
    // "Победа"). What the third system buys here is the sale.
    const game = gameOn(DERELICT);
    give(game, "spike");
    raiseIn(game, "r2", 3);
    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);
    expect(shipState(game).online).toHaveLength(3);

    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(game.status).toBe("playing");
    expect(game.shipId).toBe(TUG_ID);
    expect(currentDerelict(game).sold).toBe(true);
  });

  it("sends a sortie off a hull with nothing aboard back to the tug", () => {
    // The v1 ending — "you got out alive, you win" — is gone with G26: a hull
    // with nothing to bring online is a hull worth nothing, not a victory.
    const game = gameOn(STRIPPED);
    expect(systemsAboard(game)).toEqual([]);

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.status).toBe("playing");
    expect(game.shipId).toBe(TUG_ID);
  });

  it("puts a half-neutralised derelict behind the drone and the tug in front", () => {
    const game = gameOn(DERELICT);
    raiseIn(game, "r2", 3);
    standIn(game, "r1");

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.status).toBe("playing");
    expect(game.shipId).toBe(TUG_ID);
    // Home is four compartments and the airlock that joins them to the hull
    // just left (`content/tug.ts`).
    expect(game.ship.rooms).toHaveLength(4);
    expect(game.ship.doors).toHaveLength(4);
    expect(SHIP.offerActions!(game)).toEqual([]);
  });

  it("takes the same derelict back, with the systems it left standing", () => {
    const game = gameOn(DERELICT);
    raiseIn(game, "r2", 3);
    standIn(game, "r1");
    game.playerCommand({ kind: "leave" });

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe("1");
    expect(game.currentShip.visits).toBe(2);
    expect(shipState(game).online).toEqual(["engine"]);
    expect(systemIn(game, "r2").online).toBe(true);
    expect(game.roomOf(game.player).id).toBe(game.ship.entry);
  });

  it("sells the neutralised ship after a sortie in between", () => {
    const game = gameOn(DERELICT);
    give(game, "spike");
    raiseIn(game, "r2", 3);
    standIn(game, "r1");
    game.playerCommand({ kind: "leave" });
    game.playerCommand({ kind: "leave" });

    raiseIn(game, "r3", 2);
    raiseIn(game, "r4", 2);
    standIn(game, "r1");
    game.playerCommand({ kind: "leave" });

    expect(currentDerelict(game).sold).toBe(true);
  });

  it("leaves a half-cut splice behind rather than resuming it next sortie", () => {
    const game = gameOn(DERELICT);
    give(game, "spike");
    standIn(game, "r4");
    workOn(game, "r4");
    expect(shipState(game).work?.left).toBe(1);

    standIn(game, "r1");
    game.playerCommand({ kind: "leave" });
    game.playerCommand({ kind: "leave" });

    expect(shipState(game).work).toBeUndefined();
  });
});

describe("the drone dying", () => {
  it("leaves the derelict as it was raised, and keeps what it was paid for", () => {
    // What a dead drone costs is G26's call, not this system's: the ship keeps
    // the system it was given, and the account keeps the advance that system
    // paid. Before G41 the advance was in the drone's hold and died with it,
    // which is why bringing a reactor up and not coming back was worth nothing.
    const game = gameOn(DERELICT);
    keys(game, 1);
    raiseIn(game, "r4", 1);
    const account = voyageOf(game).credits;

    game.player.hp = 1;
    VOYAGE.onDeath!(game, game.player);

    expect(voyageOf(game).hull).toBeUndefined();
    expect(voyageOf(game).credits).toBe(account);
    const stored = game.ships.get("1")!.data.ship as { online: string[] };
    expect(stored.online).toEqual(["terminal"]);
  });

  it("ends the run only when the account cannot buy another hull", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    raiseIn(game, "r4", 1);

    voyageOf(game).credits = CHEAPEST_HULL.price - 1;
    game.player.hp = 1;
    VOYAGE.onDeath!(game, game.player);

    expect(game.status).toBe("dead");
  });
});

// ------------------------------------------------------------ the action list

describe("what the compartment offers", () => {
  it("names the tool and the turns it takes", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    expect(SHIP.offerActions!(game)).toEqual([
      { label: "work ENGINE: CUTTER 3", cmd: { kind: "act", verb: "work", target: systemIn(game, "r2").id }, enabled: true },
    ]);
  });

  it("counts down the turns left while the job is running", () => {
    const game = gameOn(DERELICT);
    standIn(game, "r2");
    workOn(game, "r2");
    expect(SHIP.offerActions!(game)[0]!.label).toBe("work ENGINE: CUTTER 2");
  });

  it("greys out a system the drone has no tool for, says which it wants, and offers the slow way under it", () => {
    const game = gameOn(DERELICT);
    drop(game, "cutter");
    standIn(game, "r2");

    expect(SHIP.offerActions!(game)).toEqual([
      {
        label: "work ENGINE: CUTTER 3",
        cmd: { kind: "act", verb: "work", target: systemIn(game, "r2").id },
        enabled: false,
        why: "Needs a CUTTER or a WELDER.",
      },
      {
        label: "work ENGINE: HANDS 15",
        cmd: { kind: "act", verb: "force", target: systemIn(game, "r2").id },
        enabled: true,
      },
    ]);
  });

  it("stops offering a system once it is online", () => {
    const game = gameOn(DERELICT);
    keys(game, 1);
    raiseIn(game, "r4", 1);
    expect(SHIP.offerActions!(game)).toEqual([]);
  });

  it("offers exactly what the game accepts, in every rack a drone can have", () => {
    // The property the numbered list stands on: a line that says `enabled` is
    // one `playerCommand` takes, and a greyed one is refused without a turn.
    const racks: Array<{ carry: ModuleId[]; keys: number }> = [
      { carry: [], keys: 0 },
      { carry: ["cutter"], keys: 0 },
      { carry: ["welder"], keys: 0 },
      { carry: ["cell"], keys: 0 },
      { carry: ["spike"], keys: 0 },
      { carry: [], keys: 1 },
      { carry: ["cutter", "cell", "spike"], keys: 1 },
    ];

    for (const rack of racks) {
      for (const room of ["r2", "r3", "r4"]) {
        const game = gameOn(DERELICT);
        for (const kind of ["cutter", "thrusters", "scanner", "cell", "welder", "spike"] as ModuleId[]) {
          drop(game, kind);
        }
        for (const kind of rack.carry) give(game, kind);
        keys(game, rack.keys);
        standIn(game, room);

        for (const offer of SHIP.offerActions!(game)) {
          const before = game.inputs.length;
          const out = game.playerCommand(offer.cmd as RoomCommand);
          expect(out.ok, `${room} ${offer.label} ${JSON.stringify(rack)}`).toBe(offer.enabled);
          if (!offer.enabled) {
            expect(out.cost).toBe(0);
            expect(game.inputs.length).toBe(before);
            expect(offer.why).toBeDefined();
          }
        }
      }
    }
  });

  it("offers every system aboard, one compartment at a time", () => {
    const game = gameOn(DERELICT);
    give(game, "spike");
    const seen: string[] = [];
    for (const room of ["r2", "r3", "r4"]) {
      standIn(game, room);
      for (const offer of SHIP.offerActions!(game)) seen.push(offer.label.split(" ")[1]!.replace(":", ""));
    }
    expect(seen).toEqual(OBJECTIVES.map((o) => o.name));
  });
});

// ------------------------------------------------------- on a generated hull

describe("a freighter the generator built", () => {
  /**
   * The real first derelict of a run, emptied of machines: what is under test
   * here is the generator's three systems and the work on them, and a scout
   * that walks in and burns the CELL is a different test on a different seed.
   */
  function freighter(seed: number): RoomGame {
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed,
      systems: [POPULATE, DOORS, SHIP, VOYAGE],
      content: { ...SALVOR, monsterChance: () => 0 },
      // A run starts on the tug since G19. This file is about the derelict, so
      // the sortie begins aboard one and the tug is only what `leave` leads to.
      firstShip: (rng) => derelictShip(FREIGHTER, 0, rng, NO_RUN),
      firstShipId: "1",
    });
    game.entities = [game.player];
    return game;
  }

  it("stands its three systems where their specs say, and answers to their tools", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const game = freighter(seed);
      give(game, "spike");
      const aboard = systemsAboard(game);
      expect(aboard.map((s) => s.kind).sort(), `seed ${seed}`).toEqual(["core", "engine", "terminal"]);

      for (const spec of OBJECTIVES) {
        const room = game.ship.rooms.find((r) =>
          roomList<ShipSystem>(r, "systems").some((s) => s.kind === spec.id),
        )!;
        expect(room.kind, `seed ${seed} ${spec.id}`).toBe(spec.kind);

        const system = roomList<ShipSystem>(room, "systems").find((s) => s.kind === spec.id)!;
        game.player.room = room.id;
        game.refreshSight();
        const job = spec.needs(rigOf(game.player), 0)!;
        for (let turn = 0; turn < job.turns; turn++) {
          const out = game.playerCommand({ kind: "act", verb: "work", target: system.id });
          expect(out.ok, `seed ${seed} ${spec.id} turn ${turn + 1}`).toBe(true);
        }
      }

      expect(shipState(game).online).toHaveLength(3);
      game.player.room = game.ship.entry;
      game.refreshSight();
      expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
      expect(currentDerelict(game).sold, `seed ${seed}`).toBe(true);
    }
  });

  it("sends a sortie that raised nothing back out to the tug and in again", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const game = freighter(seed);
      game.player.room = game.ship.entry;
      game.refreshSight();

      expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
      expect(game.status, `seed ${seed}`).toBe("playing");
      expect(game.shipId).toBe(TUG_ID);

      expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
      expect(game.shipId).toBe("1");
      expect(systemsAboard(game)).toHaveLength(3);
    }
  });
});
