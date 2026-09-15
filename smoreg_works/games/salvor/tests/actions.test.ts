import { describe, it, expect } from "vitest";
import {
  Rng,
  RoomGame,
  replayRooms,
  spawnMonsterIn,
  type ActionOffer,
  type Entity,
  type RoomCommand,
  type RoomGameConfig,
  type Twist,
} from "@jamrog/engine";
import { BOTS_ROOMS, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { LANGS, setLang } from "../src/i18n.js";
import { MONSTERS } from "../src/content/monsters.js";
import { DOORS } from "../src/systems/doors.js";
import { shipState } from "../src/systems/shipstate.js";
import { addWreck, applyDerived, findSlot, install, rigOf } from "../src/twist/rig.js";
import {
  ACTION_KEYS,
  ACTION_WIDTH,
  fitLabel,
  MAX_ACTIONS,
  omittedActions,
  roomActions,
  roomLabel,
  swapLevel,
  swapStands,
  waysHere,
  type Action,
} from "../src/ui/actions.js";

/**
 * The numbered list, as text and as a contract.
 *
 * Two things are asserted here and they are not the same thing. The first is
 * the layout of design-doc.md ("Экран"): the mock-up in that document is a
 * specification, so the three door lines it draws are compared byte for byte.
 * The second is the rule the whole screen stands on — a line marked `enabled`
 * is a line `playerCommand` accepts — which is checked the only way a promise
 * about every state can be: on three hundred of them.
 */

/**
 * CARGO as the doc draws it: four doors, one of them locked with its key
 * aboard, one welded shut, and the drone standing in the middle of it.
 */
const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r2 -#d6#- r6
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r6: corridor explored
`;

/**
 * The same ship with two more compartments hung off the HAB BLOCK: one two
 * doors away through nothing but open bulkheads, one behind a lock further
 * along. Between them they are the two kinds of journey there are.
 */
const DEEP = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r2 -#d6#- r6
  r5 -d7- r7
  r5 -[d8:k2]- r8
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r6: corridor explored
  r7: lab explored
  r8: armory explored
`;

function deepGame(room = "r2"): RoomGame {
  const game = new RoomGame({
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems: GAME_CONFIG.systems ?? [],
    firstShip: () => shipFromText(DEEP).ship,
    firstShipId: "1",
    seed: 7,
  });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function config(extra: Twist<RoomGame>[] = [], machines = false): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: machines ? SALVOR : { ...SALVOR, monsterChance: () => 0 },
    systems: [...(GAME_CONFIG.systems ?? []), ...extra],
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
}

/** A game on the fixture, with the drone standing where the doc's mock-up has it. */
function gameIn(room = "r2", extra: Twist<RoomGame>[] = [], seed = 7): RoomGame {
  const game = new RoomGame({ ...config(extra), seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): Entity {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

// -------------------------------------------------------------------- relics

describe("a relic crate against a full rack", () => {
  /** A full rack — the five the drone undocks with and a welder in the sixth. */
  function fullRack(game: RoomGame): void {
    const rig = rigOf(game.player)!;
    for (let i = 0; i < rig.slots.length; i++) if (!rig.slots[i]) rig.slots[i] = { kind: "welder", integrity: 3 };
  }

  function blade(game: RoomGame, room = "r2"): number {
    return addWreck(game, game.ship.room(room).id, "blade", 14, "X").id;
  }

  it("is one line that steps down, worded after the relic, aimed at the slot it upgrades", () => {
    const game = gameIn();
    fullRack(game);
    const id = blade(game);
    const rig = rigOf(game.player)!;

    const list = roomActions(game);
    const swaps = list.filter((a) => a.cmd.kind === "act" && a.cmd.verb === "swap");
    expect(swaps).toHaveLength(1);
    const line = swaps[0]!;
    expect(line.label).toBe("Q-BLADE for … ▸");
    expect(line.step).toBe(swapLevel(id));
    expect(line.enabled).toBe(true);
    // The command on the folded line is the swap the rig would do in one press:
    // a harness reading commands still puts the blade where the cutter was.
    expect(line.cmd).toEqual({ kind: "act", verb: "swap", target: id, slot: findSlot(rig, "cutter") });
    expect(line.label.length).toBeLessThanOrEqual(ACTION_WIDTH);
  });

  it("opens into every slot in the rig's order, with 0 for the way back", () => {
    const game = gameIn();
    fullRack(game);
    const id = blade(game);
    const rig = rigOf(game.player)!;

    const level = roomActions(game).find((a) => a.step === swapLevel(id))!;
    const picks = roomActions(game, level.step!);
    expect(picks.map((a) => a.key)).toEqual(["1", "2", "3", "4", "5", "6", "0"]);
    expect(picks[0]!.label).toBe("Q-BLADE for CUTTER");
    expect(picks[6]!.step).toBe(null);
    // Nothing of the compartment is on it: the same list one level down.
    expect(picks.some((a) => a.label.startsWith("leave"))).toBe(false);
    for (const pick of picks.slice(0, 6)) {
      expect(pick.label.length, pick.label).toBeLessThanOrEqual(ACTION_WIDTH);
      expect(pick.cmd).toMatchObject({ kind: "act", verb: "swap", target: id });
    }

    // Pressing one does the swap, and the level falls away with the crate.
    const scanner = picks.find((a) => a.label.endsWith("SCANNER"))!;
    expect(game.playerCommand(scanner.cmd).ok).toBe(true);
    expect(rig.slots[findSlot(rig, "blade")!]!.kind).toBe("blade");
    expect(findSlot(rig, "scanner")).toBeNull();
    expect(swapStands(game, level.step as string)).toBe(false);
    expect(roomActions(game, level.step!).some((a) => a.step === null)).toBe(false);
  });

  it("is the swap itself when only one module could go, and no level at all", () => {
    const game = gameIn();
    const rig = rigOf(game.player)!;
    rig.slots = [{ kind: "cutter", integrity: 11 }];
    rig.scars = [null];
    const id = blade(game);

    const line = roomActions(game).find((a) => a.cmd.kind === "act" && a.cmd.verb === "swap")!;
    expect(line.label).toBe("Q-BLADE for CUTTER");
    expect(line.step).toBeUndefined();
    expect(swapStands(game, swapLevel(id))).toBe(false);
    expect(game.playerCommand(line.cmd).ok).toBe(true);
    expect(rig.slots[0]!.kind).toBe("blade");
  });

  it("stays inside the ten digits with a crate, a machine and the airlock all on the list", () => {
    const game = gameIn();
    fullRack(game);
    blade(game);
    put(game, "r2", "scout");
    expect(omittedActions(roomActions(game))).toHaveLength(0);
  });
});

/** A stand-in for the bulkhead system (G14): it offers, it never performs. */
function doorSystem(offers: (game: RoomGame) => Array<ActionOffer<RoomCommand>>): Twist<RoomGame> {
  return { name: "test-doors", offerActions: offers };
}

/**
 * A run whose bulkheads are offered by the test rather than by `DOORS`.
 *
 * Which offer takes the number is this file's subject, and the real system
 * offers four methods off the rack the drone happens to be carrying — that is
 * G14's rule and G14 tests it. Leaving both in would test the rack twice and
 * this file's own rule not at all.
 */
function gameOffering(
  offers: (game: RoomGame) => Array<ActionOffer<RoomCommand>>,
  room = "r2",
): RoomGame {
  const systems = [...(GAME_CONFIG.systems ?? []).filter((s) => s !== DOORS), doorSystem(offers)];
  const game = new RoomGame({ ...config(), systems, seed: 7 });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

/**
 * Every module gone and no keycard aboard: the drone the ship has taken apart.
 * `DOORS` offers a locked bulkhead nothing at all in that state, which is the
 * real way to a door line the player cannot press.
 */
function stripRack(game: RoomGame): void {
  rigOf(game.player)!.slots.fill(null);
  applyDerived(game.player);
  game.refreshSight();
}

const labels = (game: RoomGame): string[] => roomActions(game).map((a) => a.label);

describe("what the compartment offers", () => {
  it("orders the list the way the design doc does: attacks, then what lies here", () => {
    const game = gameIn();
    const machine = put(game, "r2", "security-unit");
    const wreck = addWreck(game, game.ship.room("r2").id, "thrusters", 2);

    // The four door rows are the mock-up of design-doc.md, "Экран", back to
    // the byte: what it costs, which door, where it goes, what stands in the
    // way. They came off this list in G48 and a sweep of the shipped game found
    // what that cost — no row of the numbered list was a step through a door,
    // and a player reading only numbers stood in a compartment with a ship
    // system on none of 150 seeds (docs/tasks/G87-playability.md, 1).
    //
    // `close` went the other way, onto `d` with the rest of what can be done
    // *to* a bulkhead (G64): it was 52.7 % of every pressable row, and on
    // 35.7 % of screens it was the whole list. It keeps a row here on the one
    // turn it is a decision — a machine in sight through the door — which the
    // fixture has none of.
    expect(labels(game)).toEqual([
      "attack security unit 8/8",
      "salvage THRUSTERS 2/12",
      "go d1  DOCKING   open",
      "go d4  HAB BLOCK open",
      "open d3 STORAGE   locked",
      // The seam is a choice now too — the torch or the chassis (G90 B).
      "open d6 CORRIDOR  sealed",
    ]);

    const actions = roomActions(game);
    expect(actions[0]!.cmd).toEqual({ kind: "attack", target: machine.id });
    expect(actions[1]!.cmd).toEqual({ kind: "act", verb: "salvage", target: wreck.id });
    expect(actions[2]!.cmd).toEqual({ kind: "go", door: game.ship.door("d1").id });
  });

  it("shuts a bulkhead off the numbered list when something is coming through it", () => {
    // The one case `close` keeps a row of its own for: a machine in sight on
    // the far side is this turn's question, and the answer to a turn may not be
    // behind a key nobody mentioned (docs/tasks/G40-tug-clarity.md, 7).
    const game = gameIn();
    expect(labels(game).some((l) => l.startsWith("close"))).toBe(false);

    put(game, "r5", "security-unit");
    expect(game.visible.has(game.ship.room("r5").id)).toBe(true);
    const shut = roomActions(game).find((a) => a.label === "close d4");
    expect(shut?.cmd).toEqual({ kind: "act", verb: "close", target: game.ship.door("d4").id });
    // And only that door: `d1` leads to an empty DOCKING and stays on `d`.
    expect(labels(game)).not.toContain("close d1");
  });

  it("numbers the first ten and leaves the rest keyless", () => {
    const game = gameIn();
    for (let i = 0; i < 12; i++) addWreck(game, game.ship.room("r2").id, "welder", 2);

    const actions = roomActions(game);
    expect(actions.length).toBeGreaterThan(MAX_ACTIONS);
    expect(actions.slice(0, MAX_ACTIONS).map((a) => a.key)).toEqual([...ACTION_KEYS]);
    expect(actions[0]!.key).toBe("1");
    expect(actions[9]!.key).toBe("0");
    expect(omittedActions(actions).length).toBe(actions.length - MAX_ACTIONS);
    expect(omittedActions(actions).every((a) => a.key === "")).toBe(true);
  });

  it("offers the way out where the airlock is, and only there", () => {
    const home = gameIn("r1");
    const out = roomActions(home).find((a) => a.cmd.kind === "leave");
    expect(out?.label).toBe("leave a1 TUG       out");
    expect(out?.enabled).toBe(true);
    expect(roomActions(gameIn()).some((a) => a.cmd.kind === "leave")).toBe(false);
  });

  it("keeps hiding on its letter rather than spending a number on it", () => {
    // The rig offers `hide` for the bots; the list is not where a player finds
    // it (design-doc.md, "Клавиши" — `h`), and a doubled verb is a longer list.
    const game = gameIn();
    expect(game.systems.flatMap((s) => s.offerActions?.(game) ?? []).some((o) => o.cmd.kind === "hide")).toBe(true);
    expect(roomActions(game).some((a) => a.cmd.kind === "hide")).toBe(false);
  });

  it("offers nothing at all once the run is over", () => {
    const game = gameIn();
    game.status = "dead";
    expect(roomActions(game)).toEqual([]);
  });
});

/**
 * A bulkhead on one line of the map.
 *
 * The doors came off the compartment's own list in G48 and are rows of the map
 * `m` opens: worded after the compartment beyond them, because that is what a
 * player is choosing. What did not change is everything under the line — the
 * ways through a lock, the letters that fire them, and the promise that a line
 * marked pressable is a command the sim takes.
 */
describe("a bulkhead on one line of the map", () => {
  const map = (game: RoomGame): Action[] => roomActions(game, undefined, true);
  const mapped = (game: RoomGame): string[] => map(game).map((a) => a.label);
  const rowFor = (game: RoomGame, head: string): Action =>
    map(game).find((a) => a.label.startsWith(head))!;

  it("writes the columns the map is read down", () => {
    const ship = shipFromText(CARGO).ship;
    expect(roomLabel(ship.room("r4"), "d3 locked")).toBe("STORAGE   r4  d3 locked");
    expect(roomLabel(ship.room("r5"), "1 door")).toBe("HAB BLOCK r5  1 door");
    // The name is what gives way to a long right-hand column, never the number
    // and never the state: `ENGINEERING` is eleven and the column is ten.
    expect(roomLabel(ship.room("r1"), "d1 sealed")).toBe("DOCKING   r1  d1 sealed");
  });

  it("fits the panel's own width, whatever the name and whatever stands in the way", () => {
    const ship = shipFromText(CARGO).ship;
    for (const room of ship.rooms) {
      for (const right of ["1 door", "12 doors", "d10 sealed", "no way"]) {
        const line = roomLabel(room, right);
        expect(line.length, line).toBeLessThanOrEqual(ACTION_WIDTH);
      }
    }
  });

  it("still names a compartment the drone can only see into", () => {
    // The schematic is already drawing HAB's name through the open door; a map
    // that leaves out a box the player can read looks broken.
    const game = gameIn();
    const hab = game.ship.room("r5");
    hab.explored = false;
    hab.scanned = false;
    game.refreshSight();
    expect(game.visible.has(hab.id)).toBe(true);
    expect(mapped(game)).toContain("HAB BLOCK r5  1 door");
  });

  it("hands a shut bulkhead nothing can cut to the chassis, which is always aboard", () => {
    const game = gameIn();
    // Nothing in the rack: `DOORS` offers the welded seam the ram alone
    // (G90 B), so the row is that one way and pressing it is a turn of it.
    stripRack(game);
    const shut = rowFor(game, "CORRIDOR");
    expect(shut.enabled).toBe(true);
    expect(shut.cmd).toEqual({ kind: "act", verb: "ram", target: game.ship.door("d6").id });

    const outcome = game.playerCommand(shut.cmd);
    expect(outcome.ok).toBe(true);
    expect(game.inputs).toHaveLength(1);
  });

  it("makes a bulkhead with more than one answer a choice rather than one of them", () => {
    const game = gameOffering((g) => {
      const door = g.ship.door("d3").id;
      return [
        { label: "unlock", cmd: { kind: "act", verb: "key", target: door }, enabled: true },
        { label: "spike", cmd: { kind: "act", verb: "spike", target: door }, enabled: true },
        { label: "cut", cmd: { kind: "act", verb: "cut", target: door }, enabled: true },
      ];
    });

    const line = rowFor(game, "STORAGE");
    expect(line.label).toBe("STORAGE   r4  d3 locked");
    expect(line.step).toBe(game.ship.door("d3").id);
    expect(line.enabled).toBe(true);
    // Nothing is drawn under it: the three ways are the list one level down,
    // and the row of letters they used to share was clipped to death.
    expect(line.extra).toBeUndefined();
    expect(line.ways?.map((w) => w.verb)).toEqual(["key", "spike", "cut"]);
  });

  it("keeps a bulkhead with one answer as that answer", () => {
    // Stepping into a list to read a single entry is a keystroke spent on
    // nothing: with no torch the welded seam has only the chassis (G90 B), so
    // the ram takes the row.
    const game = gameIn();
    stripRack(game);
    const line = rowFor(game, "CORRIDOR");
    expect(line.label).toBe("CORRIDOR  r6  d6 sealed");
    expect(line.step).toBeUndefined();
    expect(line.cmd).toEqual({ kind: "act", verb: "ram", target: game.ship.door("d6").id });
  });

  /**
   * The keycard is offered last of the four ways through a lock
   * (`systems/doors.ts`, `LOCKED_METHODS`), so it is the last line of that
   * door's list rather than the first — and it keeps a letter of its own so one
   * keystroke still reaches it from anywhere. It reads a card rather than a
   * module, which is why the letter is `a` and not one off the rack.
   */
  it("gives the keycard a letter of its own, so one key still reaches it", () => {
    const game = gameIn();
    (game.player.data ??= {}).keys = 1;

    const line = rowFor(game, "STORAGE");
    expect(line.step).toBe(game.ship.door("d3").id);
    expect(line.ways?.find((w) => w.verb === "key")).toEqual({
      verb: "key",
      letter: "a",
      cmd: { kind: "act", verb: "key", target: game.ship.door("d3").id },
      enabled: true,
    });
  });

  it("hands the ways over as commands, not only as lines of text", () => {
    // Against the real `DOORS`: the drone undocks with a CELL and a CUTTER and
    // no card. `waysHere` is what `appstate.ts` aims a letter at, and a
    // rendered line is not something a reducer can aim.
    const game = gameIn();
    const line = rowFor(game, "STORAGE");
    expect(line.ways?.map((w) => w.verb)).toEqual(["power", "spike", "cut", "key", "ram"]);
    expect(line.ways?.find((w) => w.verb === "cut")).toEqual({
      verb: "cut",
      letter: "c",
      cmd: { kind: "act", verb: "cut", target: game.ship.door("d3").id },
      enabled: true,
    });
    // The keycard is carried with a letter of its own, greyed out while the
    // drone has no card on it, and carrying the reason it is greyed.
    expect(line.ways?.find((w) => w.verb === "key")).toMatchObject({
      letter: "a",
      enabled: false,
      why: "No keycard on the drone.",
    });
    // And the same ways reach the letters without a list at all — for every
    // bulkhead here, including the open ones, because welding one shut is a
    // letter with no line anywhere.
    const lock = game.ship.door("d3").id;
    const aimedAt = (id: number): string[] =>
      waysHere(game)
        .filter((w) => w.cmd.kind === "act" && w.cmd.target === id)
        .map((w) => w.verb);
    expect(aimedAt(lock)).toEqual(["power", "spike", "cut", "key", "ram"]);
    install(rigOf(game.player)!, "welder", 3);
    expect(aimedAt(game.ship.door("d1").id)).toEqual(["weld"]);
  });

  it("takes the first tool that is usable as what the row would do", () => {
    // `cmd` on a choice is still the way the drone would actually spend, so a
    // harness that walks a run off the list and knows nothing about levels gets
    // what it always got.
    const game = gameOffering((g) => {
      const door = g.ship.door("d3").id;
      return [
        { label: "unlock", cmd: { kind: "act", verb: "key", target: door }, enabled: false, why: "No keycard." },
        { label: "spike", cmd: { kind: "act", verb: "spike", target: door }, enabled: true },
      ];
    });
    const line = rowFor(game, "STORAGE");
    expect(line.enabled).toBe(true);
    expect(line.cmd).toEqual({ kind: "act", verb: "spike", target: game.ship.door("d3").id });
  });

  it("still offers the choice when the drone can spend none of it", () => {
    // The lock the rack has no answer for is exactly when the four methods are
    // worth reading: greyed, each with the reason, is the map of what to come
    // back with (design-doc.md, "Обучение конструкцией").
    const game = gameIn();
    stripRack(game);
    const line = rowFor(game, "STORAGE");
    expect(line.step).toBe(game.ship.door("d3").id);
    // The chassis is always one of the ways (G90 B), so the row is pressable
    // and the four module ways are what is greyed.
    expect(line.enabled).toBe(true);
    expect(line.ways?.filter((w) => w.enabled).map((w) => w.verb)).toEqual(["ram"]);
  });

  it("does not read a wreck's id as a way through the door of the same number", () => {
    // `target` is one number for doors, wrecks and ship systems alike: only the
    // verb tells them apart, and getting that wrong turns `salvage` into a key
    // and eats the line the wreck was on. Doors and wrecks are numbered by
    // counters that know nothing of each other, so the collision is arranged
    // here rather than waited for.
    const game = gameIn("r2", [
      doorSystem((g) => [
        {
          label: "salvage WELDER 2/4",
          cmd: { kind: "act", verb: "salvage", target: g.ship.door("d3").id },
          enabled: true,
        },
      ]),
    ]);
    stripRack(game);

    expect(labels(game).filter((l) => l === "salvage WELDER 2/4")).toHaveLength(1);
    expect(mapped(game)).toContain("STORAGE   r4  d3 locked");
    expect(rowFor(game, "STORAGE").step).toBe(game.ship.door("d3").id);
  });
});

describe("the ways through one bulkhead", () => {
  const lock = (game: RoomGame): number => game.ship.door("d3").id;

  it("replaces the list with the methods, in the order the systems offer them", () => {
    const game = gameIn();
    const list = roomActions(game, lock(game));

    expect(list.map((a) => a.label)).toEqual([
      "power   1 turn, noise 6",
      "spike   2 turns, noise 4",
      "cut     3 turns, noise 9",
      "key     1 turn, silent",
      "ram     8 turns, noise 12",
      "back (d3)",
    ]);
    // Nothing of the compartment is left on it: this is the same list, one
    // level down, and not a card drawn over the top of one.
    expect(list.some((a) => a.label.startsWith("attack"))).toBe(false);
    expect(list.some((a) => a.label.startsWith("go "))).toBe(false);
  });

  it("numbers the methods and always leaves 0 for the way back", () => {
    const game = gameIn();
    const list = roomActions(game, lock(game));
    expect(list.map((a) => a.key)).toEqual(["1", "2", "3", "4", "5", "0"]);
    expect(list[5]!.step).toBe(null);
  });

  it("greys what the drone cannot spend, with the reason on it, rather than hiding it", () => {
    const game = gameIn();
    const list = roomActions(game, lock(game));
    // Undocked with a CELL and a CUTTER and no card: two of the four are the
    // drone's, and the other two say what is missing rather than disappearing.
    expect(list.filter((a) => a.enabled).map((a) => a.label.split(" ")[0])).toEqual(["power", "cut", "ram", "back"]);
    expect(list.find((a) => a.label.startsWith("spike"))!.why).toBe("No SPIKE in the rack.");
    expect(list.find((a) => a.label.startsWith("key"))!.why).toBe("No keycard on the drone.");
  });

  it("says what the sim would say when a greyed method is pressed anyway", () => {
    // The promise the whole list stands on, one level down: the list may not
    // invent a refusal, and a refusal is not a turn.
    const game = gameIn();
    for (const method of roomActions(game, lock(game))) {
      if (method.enabled || method.step === null) continue;
      const outcome = game.playerCommand(method.cmd);
      expect(outcome.ok, method.label).toBe(false);
      expect(method.why, method.label).toBe(outcome.reason);
    }
    expect(game.inputs).toEqual([]);
  });

  it("spends the turn the method costs when one of them is pressed", () => {
    const game = gameIn();
    const power = roomActions(game, lock(game)).find((a) => a.label.startsWith("power"))!;
    expect(game.playerCommand(power.cmd).ok).toBe(true);
    expect(game.ship.door("d3").state).toBe("open");
  });

  it("hands the compartment back when the door named is no longer a choice", () => {
    // A lock that has been opened is not a lock, and the list one level down
    // would be a list of nothing. Rather than draw that, the level falls away.
    const game = gameIn();
    game.ship.door("d3").state = "open";
    expect(roomActions(game, lock(game)).map((a) => a.label)).toEqual(labels(game));
    expect(roomActions(game, 999).map((a) => a.label)).toEqual(labels(game));
  });

  it("offers no level at all where the way there is one the drone can walk", () => {
    const game = gameIn();
    const map = roomActions(game, undefined, true);
    // One lock and one seam in the fixture, and both are a choice now — the
    // seam of the torch and the chassis (G90 B) — so two rows step down.
    expect(map.filter((a) => typeof a.step === "number")).toHaveLength(2);
    for (const head of ["DOCKING", "HAB"]) {
      expect(map.find((a) => a.label.startsWith(head))!.step, head).toBeUndefined();
    }
    // The compartment's own list counts the same way, for the same reason: the
    // same lock, and no level under anything the drone can simply walk through.
    const here = roomActions(game);
    expect(here.filter((a) => typeof a.step === "number").map((a) => a.label)).toEqual([
      "open d3 STORAGE   locked",
      "open d6 CORRIDOR  sealed",
    ]);
  });
});

/**
 * The map of where the drone can walk: the level `m` opens
 * (docs/tasks/G48-travel-to-a-room.md).
 *
 * The owner played a sortie and said moving about was awful, then said what he
 * wanted instead: «лучше на движение выбирается любая точка и ты идёшь туда,
 * пока не упрёшься во врага или закрытую дверь». So the level is not doors but
 * destinations — every compartment the drone knows of, nearest first, with what
 * the walk costs and what will end it — and the walking is `ui/auto.ts`'s, the
 * same machinery `o` is built on and with the same stop list.
 *
 * The neighbouring compartment is the ordinary case of that rather than a
 * special one, which is why there is no list of doors any more: a neighbour is
 * a destination one door away.
 */
/**
 * Every line of the list can be reached by something.
 *
 * The ten digits used to sit on the first ten lines full stop, and the cursor
 * could not leave them either — `listLength` counted numbered rows only. A
 * sweep of the shipped game found a line past the tenth on 2.6 % of screens,
 * and among them `work ENGINE`, the objective the whole voyage is for, and a
 * door out of the compartment (docs/tasks/G55-playtest-findings.md, 4).
 */
describe("the ten keys are a window, not the first ten lines", () => {
  /** A compartment with more to do in it than there are digits. */
  function crowded(): RoomGame {
    const game = gameIn("r2");
    for (let i = 0; i < 12; i++) addWreck(game, game.ship.room("r2").id, "welder", 2);
    return game;
  }

  it("puts a digit on every line as the cursor walks the list", () => {
    const game = crowded();
    const all = roomActions(game);
    expect(all.length).toBeGreaterThan(MAX_ACTIONS);

    const reached = new Set<string>();
    for (let cursor = 0; cursor < all.length; cursor++) {
      for (const line of roomActions(game, undefined, false, cursor)) {
        if (line.key !== "") reached.add(line.label);
      }
    }
    expect(reached.size).toBe(new Set(all.map((a) => a.label)).size);
  });

  it("keeps the highlighted line inside the ten, wherever it is", () => {
    const game = crowded();
    const all = roomActions(game);
    for (let cursor = 0; cursor < all.length; cursor++) {
      const shown = roomActions(game, undefined, false, cursor);
      expect(shown[cursor]!.key, `cursor ${cursor}`).not.toBe("");
      // Five rows in while there is list left below it, so the player reads
      // ahead rather than off the bottom; deeper only at the very end, where
      // there is nothing left to scroll to.
      const numbered = shown.filter((a) => a.key !== "");
      const at = numbered.indexOf(shown[cursor]!);
      expect(at, `cursor ${cursor}`).toBeLessThan(MAX_ACTIONS);
      if (cursor + MAX_ACTIONS <= all.length) expect(at, `cursor ${cursor}`).toBeLessThan(6);
    }
  });

  it("gives the way back out its own key one level down, whatever the window", () => {
    const game = crowded();
    const all = roomActions(game);
    for (let cursor = 0; cursor < all.length; cursor++) {
      const shown = roomActions(game, undefined, false, cursor);
      const numbered = shown.filter((a) => a.key !== "");
      expect(new Set(numbered.map((a) => a.key)).size, `cursor ${cursor}`).toBe(numbered.length);
    }
  });
});

describe("the map of where the drone can walk", () => {
  const map = (game: RoomGame): Action[] => roomActions(game, undefined, true);

  it("marks the compartment the run is for", () => {
    // The map averaged 8.2 pressable rows and reached 25, more than five on
    // 71.4 % of screens, and said nothing about which of them was worth the
    // walk (docs/tasks/G87-playability.md, 2). Not `+`: that is the rack's
    // mark of a grafted module on the same panel (docs/tasks/G88-polish-by-map.md, B8).
    const game = gameIn();
    const storage = game.ship.room("r4");
    storage.data.systems = [{ id: 1, kind: "engine", online: false, glyph: "+" }];
    expect(map(game).map((a) => a.label)).toContain("◆STORAGE  r4  d3 locked");
    expect(map(game).some((a) => a.label.startsWith("+"))).toBe(false);

    // It goes when the system does: a mark on a finished errand is a lie.
    shipState(game).online.push("engine");
    expect(map(game).map((a) => a.label)).toContain("STORAGE   r4  d3 locked");
  });

  it("marks a charter's crate and console with the mark the compartment block uses", () => {
    const game = gameIn();
    game.ship.room("r5").data.items = [{ id: 1, kind: "charter-item" }];
    // The mark is paid for out of the name column, which is the one that gives
    // way on this row anyway: `HAB BLOCK` in nine is `HAB`, cut at the word.
    expect(map(game).map((a) => a.label)).toContain("*HAB      r5  1 door");

    // Carried out, and the row stops advertising it.
    game.ship.room("r5").data.items = [{ id: 1, kind: "charter-item", taken: true }];
    expect(map(game).map((a) => a.label)).toContain("HAB BLOCK r5  1 door");
  });

  it("lists the compartments it knows of, nearest first, and the way back", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    addWreck(game, game.ship.room("r2").id, "thrusters", 2);

    expect(map(game).map((a) => a.label)).toEqual([
      "DOCKING   r1  1 door",
      "STORAGE   r4  d3 locked",
      "HAB BLOCK r5  1 door",
      "CORRIDOR  r6  d6 sealed",
      "back",
    ]);
    expect(map(game).map((a) => a.key)).toEqual(["1", "2", "3", "4", "0"]);
    // Nothing of the compartment itself is on it, and the compartment the drone
    // is standing in is not a destination.
    expect(map(game).some((a) => a.label.includes("CARGO"))).toBe(false);
    expect(map(game).some((a) => a.label.startsWith("attack"))).toBe(false);
    // What is on the map and on no other list is the *walk*: the compartment's
    // own rows are single steps through the bulkheads it has (G87), and a route
    // of several doors is what only a destination can express.
    expect(map(deepGame()).some((a) => a.travel !== undefined)).toBe(true);
    expect(roomActions(deepGame()).some((a) => a.travel !== undefined)).toBe(false);
  });

  it("does not name a compartment nobody has seen", () => {
    // A row of `····` is not a destination a player can mean, and twelve of
    // them would take every key the panel has.
    const game = gameIn();
    game.ship.room("r6").explored = false;
    game.ship.room("r6").scanned = false;
    game.refreshSight();
    expect(map(game).some((a) => a.label.startsWith("CORRIDOR"))).toBe(false);
  });

  it("steps through a single open door rather than announcing a journey", () => {
    const game = gameIn();
    const next = map(game).find((a) => a.label.startsWith("DOCKING"))!;
    expect(next.travel).toBeUndefined();
    expect(next.cmd).toEqual({ kind: "go", door: game.ship.door("d1").id });
    expect(game.playerCommand(next.cmd).ok).toBe(true);
  });

  it("sets out for anything further off, and starts by stepping the right way", () => {
    const game = deepGame();
    const far = map(game).find((a) => a.label.startsWith("LAB"))!;
    expect(far.label).toBe("LAB       r7  2 doors");
    expect(far.travel).toBe(game.ship.room("r7").id);
    // The command on the line is the first step of that walk, so anything
    // reading the list as commands still moves towards it.
    expect(far.cmd).toEqual({ kind: "go", door: game.ship.door("d4").id });
    expect(game.playerCommand(far.cmd).ok).toBe(true);
  });

  it("says which bulkhead will stop the walk, and still sets out", () => {
    // The route to the ARMORY is clear as far as the HAB BLOCK and locked after
    // it. The line says so — that is the decision — and pressing it walks up to
    // the lock, where `ui/auto.ts` hands the ship back with the door named.
    const game = deepGame();
    const far = map(game).find((a) => a.label.startsWith("ARMORY"))!;
    expect(far.label).toBe("ARMORY    r8  d8 locked");
    expect(far.travel).toBe(game.ship.room("r8").id);
    expect(far.enabled).toBe(true);
  });

  it("makes a compartment behind the next bulkhead that bulkhead's own choice", () => {
    // The second half of the owner's request — «двинулся в сторону закрытой —
    // предлагает варианты как вскрывать» — and one keystroke rather than two:
    // there is nothing to walk before the question, so the question comes now.
    const game = gameIn();
    const lock = map(game).find((a) => a.label.startsWith("STORAGE"))!;
    expect(lock.step).toBe(game.ship.door("d3").id);
    expect(lock.travel).toBeUndefined();
    expect(lock.ways?.map((w) => w.verb)).toEqual(["power", "spike", "cut", "key", "ram"]);

    expect(roomActions(game, lock.step ?? undefined, true).map((a) => a.label)).toEqual([
      "power   1 turn, noise 6",
      "spike   2 turns, noise 4",
      "cut     3 turns, noise 9",
      "key     1 turn, silent",
      "ram     8 turns, noise 12",
      "back (d3)",
    ]);
  });

  it("greys a compartment nothing can reach, and says so", () => {
    // The airlock is a wall to everything but leaving, so the tug is not a
    // destination — and a hull whose only route is welded shut is the case this
    // exists for.
    const game = gameIn();
    game.ship.door("d1").state = "sealed";
    game.ship.door("d4").state = "sealed";
    game.ship.door("d3").state = "sealed";
    const line = map(game).find((a) => a.label.startsWith("DOCKING"))!;
    expect(line.label).toBe("DOCKING   r1  d1 sealed");
    expect(line.enabled).toBe(true);

    // A compartment on the far side of two seams: the walk can reach the first
    // and the list says which one it will stop at.
    const far = map(game).find((a) => a.label.startsWith("STORAGE"))!;
    expect(far.enabled).toBe(true);
  });

  it("keeps the same number on the same compartment while the drone stands still", () => {
    // The half of the complaint that is arithmetic: on the compartment's own
    // list a door's number moves when a wreck is salvaged, when a machine walks
    // in and whenever a tool burns (`pressableFirst`). Here it is the distance
    // and the room id, and neither of those is in the room.
    const game = gameIn();
    const numbering = (): string[] => map(game).map((a) => `${a.key} ${a.label.slice(0, 9)}`);
    const before = numbering();

    put(game, "r2", "security-unit");
    addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    stripRack(game);

    expect(numbering()).toEqual(before);
    // …while the compartment's own list has moved everything on it: the wreck
    // is a new first line and the burned rack has pushed a refusal to the back.
    expect(labels(game)[0]).toBe("attack security unit 8/8");
  });

  it("costs nothing to be looked at: not one of these lines is a turn by itself", () => {
    const game = gameIn();
    map(game);
    roomActions(game, game.ship.door("d3").id, true);
    expect(game.inputs).toEqual([]);
    expect(game.schedule.time).toBe(0);
  });

  it("promises only commands the sim accepts, over three hundred states", () => {
    // The same promise the compartment's own list is held to, on the level that
    // walks: a line marked pressable is one `playerCommand` takes — the first
    // step of a journey included, because that is what the line's `cmd` is.
    const cfg = config([], true);
    let tried = 0;

    for (let seed = 1; seed <= 300; seed++) {
      const rng = new Rng(seed);
      const base = new RoomGame({ ...cfg, seed });
      for (let step = 0; step < seed % 11 && base.status === "playing"; step++) {
        const options = roomActions(base).filter((a) => a.enabled && a.cmd.kind !== "leave");
        base.playerCommand(options.length === 0 ? { kind: "wait" } : rng.pick(options).cmd);
      }
      if (base.status !== "playing") continue;

      const inputs = [...base.inputs];
      for (const line of roomActions(base, undefined, true)) {
        if (!line.enabled || line.step !== undefined) continue;
        const fresh = replayRooms(seed, inputs, cfg);
        expect(fresh.playerCommand(line.cmd).ok, `seed ${seed}: ${line.label}`).toBe(true);
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(300);
  });

  it("has nothing to offer on the tug, because there is nowhere to walk", () => {
    // `m` used to list the tug's other three compartments. Since G53 there is
    // no walking at home at all — the list is the same wherever the drone
    // stands — so the map is not a level the tug has, and the key that opens it
    // says so instead (`ui/appstate.ts`, `nowhereToWalk`).
    const game = newGame(4);
    expect(map(game).map((a) => a.label)).toEqual(labels(game));
  });
});

/**
 * The other list this file builds: the tug's (docs/tasks/G53-tug-is-a-menu.md).
 *
 * A compartment aboard a derelict lists everything every system offers there,
 * doors included. The tug lists verbs — five groups of them, always the same
 * ten rows — and not one bulkhead, because it has stopped being a place you
 * walk about in.
 */
describe("the same list, on the tug", () => {
  it("is verbs and never doors, and never a way out through the airlock", () => {
    const game = newGame(4);
    const list = labels(game);

    // The order a visit home is spent in: a drone first, casting off last.
    expect(list[0]).toBe("buy a hull ▸");
    // A board with nothing signed on it is the one thing a fresh screen has
    // left undone, so the row that casts off says so instead of naming the
    // hull (docs/tug-menu-audit.md, "what a designer would do", 5).
    expect(list[8]).toBe("cast off — board closes");
    expect(list.some((l) => l.startsWith("go "))).toBe(false);
    expect(list.some((l) => l.startsWith("leave"))).toBe(false);
    // Every verb of the tug is here, on the first screen, with nothing walked to.
    // `hold & shelf` is the row that fits a module, from either place it can
    // come from: the hold, and the three the dock has for sale.
    for (const line of ["cast off", "repair", "graft", "clean", "stow", "hold &", "sell", "choose the first hull"]) {
      expect(list.some((l) => l.startsWith(line)), line).toBe(true);
    }
  });

  it("says the same thing from every compartment, because there is no walking", () => {
    const game = newGame(4);
    const first = labels(game);
    for (const door of [1, 2]) expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
    expect(game.roomOf(game.player).name).toBe("BENCH");
    expect(labels(game)).toEqual(first);
  });

  it("steps into one verb's own modules and back out, without a turn", () => {
    const game = newGame(4);
    const under = roomActions(game, "sell").map((a) => a.label);
    expect(under.length).toBeGreaterThan(2);
    // The verb is the row the list was opened from, so it is not repeated:
    // every line is a module, its wear and what it fetches.
    expect(under.slice(0, -1).every((l) => /^\w+ \d+\/\d+ {2}\d+ CR$/.test(l))).toBe(true);
    expect(under.at(-1)).toBe("back");
    expect(roomActions(game, "sell").at(-1)!.step).toBe(null);
  });
});

/**
 * What the list has to offer with something hostile in reach
 * (docs/tasks/G40-tug-clarity.md, 7).
 *
 * The owner's second playtest stood in ENGINEERING being hit and found neither
 * `attack`, nor `shoot`, nor a way to shut the door. Two of the three were real
 * defects: `close` never survived the door block at all, and a panel that had
 * grown past its thirty-four rows was dropping the bottom of the list on the
 * floor (`ui/panel.ts`, `fitList`).
 */
describe("a machine in reach", () => {
  it("puts attacking it first when it is in the compartment", () => {
    const game = gameIn();
    const machine = put(game, "r2", "security-unit");
    const first = roomActions(game)[0]!;

    expect(first.label).toBe("attack security unit 8/8");
    expect(first.cmd).toEqual({ kind: "attack", target: machine.id });
    expect(first.enabled).toBe(true);
    expect(first.key).toBe("1");
  });

  it("offers the door it is coming through, to shut in its face", () => {
    const game = gameIn();
    put(game, "r5", "scout");
    game.refreshSight();

    const door = game.ship.door("d4");
    const shut = roomActions(game).find((a) => a.label === `close ${door.label}`)!;
    expect(shut).toBeDefined();
    expect(shut.enabled).toBe(true);
    expect(shut.key).not.toBe("");

    // Off the board before the command, so what is measured is the door and not
    // the scout stepping straight back through it on its own turn.
    game.entities = game.entities.filter((e) => e.id === game.player.id);
    // The promise the whole list stands on, on the line that used to be missing.
    expect(game.playerCommand(shut.cmd).ok).toBe(true);
    expect(game.ship.door("d4").state).toBe("closed");
  });

  it("offers the shot when the rack has an EMITTER and the door is open", () => {
    const game = gameIn();
    install(rigOf(game.player)!, "emitter", 3);
    applyDerived(game.player);
    put(game, "r5", "scout");
    game.refreshSight();

    const shot = roomActions(game).find((a) => a.label.startsWith("shoot"))!;
    expect(shot.label).toBe("shoot scout");
    expect(shot.enabled).toBe(true);
    expect(game.playerCommand(shot.cmd).ok).toBe(true);
  });
});

describe("ship systems and consoles come last", () => {
  it("sits at the bottom, whatever order the systems were asked in", () => {
    const game = gameIn("r2", [
      doorSystem(() => [
        { label: "work the engine", cmd: { kind: "act", verb: "work", target: 99 }, enabled: true },
        { label: "take the package", cmd: { kind: "act", verb: "take", target: 98 }, enabled: true },
      ]),
    ]);
    const list = labels(game);
    expect(list.indexOf("take the package")).toBeLessThan(list.indexOf("work the engine"));
    expect(list.indexOf("work the engine")).toBe(list.length - 1);
  });
});

/**
 * The one promise the screen makes: press a number that is offered and the
 * command goes through. Three hundred states, each one a different sortie
 * played by pressing its own list, and every enabled line on every one of them
 * is spent on a rebuilt copy of that exact state.
 */
describe("every offered action is one the sim accepts", () => {
  it("holds over three hundred states", () => {
    const cfg = config([], true);
    let tried = 0;

    for (let seed = 1; seed <= 300; seed++) {
      const rng = new Rng(seed);
      const base = new RoomGame({ ...cfg, seed });
      for (let step = 0; step < seed % 11 && base.status === "playing"; step++) {
        const options = roomActions(base).filter((a) => a.enabled && a.cmd.kind !== "leave");
        base.playerCommand(options.length === 0 ? { kind: "wait" } : rng.pick(options).cmd);
      }
      if (base.status !== "playing") continue;

      const inputs = [...base.inputs];
      roomActions(base).forEach((action, i) => {
        if (!action.enabled) return;
        const fresh = replayRooms(seed, inputs, cfg);
        const same = roomActions(fresh)[i];
        expect(same?.label, `seed ${seed}`).toBe(action.label);
        expect(fresh.playerCommand(same!.cmd).ok, `seed ${seed}: ${action.label}`).toBe(true);
        tried++;
      });

      // The same promise on the level that walks, where the doors live now:
      // every row of the map that says it can be pressed is a command the sim
      // takes — the first step of a journey included.
      roomActions(base, undefined, true).forEach((action) => {
        if (!action.enabled || action.step !== undefined) return;
        const fresh = replayRooms(seed, inputs, cfg);
        expect(fresh.playerCommand(action.cmd).ok, `seed ${seed}: ${action.label}`).toBe(true);
        tried++;
      });

      // And one level under that, where the methods live: every way through a
      // bulkhead that says it can be spent is one the sim takes.
      roomActions(base, undefined, true).forEach((action) => {
        if (action.step === undefined || action.step === null) return;
        for (const method of roomActions(base, action.step, true)) {
          if (!method.enabled || method.step === null) continue;
          const fresh = replayRooms(seed, inputs, cfg);
          expect(fresh.playerCommand(method.cmd).ok, `seed ${seed}: ${method.label}`).toBe(true);
          tried++;
        }
      });
    }

    // A property nobody exercised is a green test that proves nothing.
    expect(tried).toBeGreaterThan(600);
  });
});

// ------------------------------------------------------- twenty-five columns

/**
 * The lines a sweep of real play found over budget, and what they must become.
 *
 * The table is a measurement, not an invention: 56 706 screens of careful play
 * in three languages produced 52 distinct lines longer than `ACTION_WIDTH` and
 * 3 470 sightings of them (G85, 2). The terminal used to `slice` them and the
 * page used to print them whole, so what a player lost first was the end of
 * the line — which is where the facts are.
 */
const OVER: Array<[string, string, string?]> = [
  ["coger caja de carga (8 CR)", "coger caja de carga", "(8 CR)"],
  ["purge EMITTER (welder, 2 turns)", "purge EMITTER", "(welder, 2 turns)"],
  ["purgar EMISOR (soldador, 2)", "purgar EMISOR", "(soldador, 2)"],
  ["\u043f\u0440\u043e\u0436\u0438\u0433: \u0414\u0412\u0418\u0413\u0410\u0422\u0415\u041b\u0418 (\u0441\u0432\u0430\u0440\u043a\u0430)", "\u043f\u0440\u043e\u0436\u0438\u0433: \u0414\u0412\u0418\u0413\u0410\u0422\u0415\u041b\u0418", "(\u0441\u0432\u0430\u0440\u043a\u0430)"],
  ["attack security unit 8/8 #1", "attack security 8/8 #1"],
  ["attack maintenance bot 4/4", "attack maintenance 4/4"],
  ["atacar dron salvaje 3/3 #2", "atacar dron 3/3 #2"],
  ["\u0430\u0442\u0430\u043a\u0430: \u043e\u0434\u0438\u0447\u0430\u043b\u044b\u0439 \u0434\u0440\u043e\u043d 3/3 #1", "\u0430\u0442\u0430\u043a\u0430: \u043e\u0434\u0438\u0447\u0430\u043b\u044b\u0439 3/3 #1"],
  ["\u0430\u0442\u0430\u043a\u0430: \u0434\u0443\u0433\u043e\u0432\u043e\u0439 \u0441\u0442\u0440\u0430\u0436 10/10", "\u0430\u0442\u0430\u043a\u0430: \u0434\u0443\u0433\u043e\u0432\u043e\u0439 10/10"],
  ["desguazar IMPULSORES 12/12", "desguazar IMPULSOR\u2026 12/12"],
];

/** Every figure of a line: hit points, a price, the `#2` that tells twins apart. */
function figures(text: string): string {
  return (text.match(/#?\d+(?:\/\d+)?/g) ?? []).join(" ");
}

describe("a line of the list gives up the least it can to fit", () => {
  it("moves the price down a row, then drops words of the name, then marks the cut", () => {
    for (const [raw, label, extra] of OVER) {
      const fit = fitLabel(raw);
      expect(fit.label, raw).toBe(label);
      expect(fit.extra, raw).toBe(extra);
      expect(fit.label.length, raw).toBeLessThanOrEqual(ACTION_WIDTH);
    }
  });

  it("never loses a figure or a #N, whatever it drops", () => {
    for (const [raw] of OVER) {
      const fit = fitLabel(raw);
      expect(figures(`${fit.label} ${fit.extra ?? ""}`), raw).toBe(figures(raw));
    }
  });

  it("leaves a line that fits exactly as it was", () => {
    for (const text of ["leave a1 TUG       out", "1234567890123456789012345"]) {
      expect(fitLabel(text)).toEqual({ label: text });
    }
  });

  it("says with \u2026 that a line it could not shorten was cut", () => {
    const single = fitLabel("antidisestablishmentarianismistic");
    expect(single.label).toHaveLength(ACTION_WIDTH);
    expect(single.label.endsWith("\u2026")).toBe(true);
  });
});

/**
 * The same, on the game rather than on a table: whatever the bots meet over
 * thirty voyages in three languages, no line of any list is over budget.
 *
 * The table above is the shape of the answer and this is its coverage — a
 * machine named in some language nobody measured, a module bought at a price
 * nobody priced, is a red line here rather than a clipped row on a screenshot.
 */
describe("no line of any list is over budget in real play", () => {
  it("over thirty careful voyages in three languages", () => {
    let lines = 0;
    for (const lang of LANGS) {
      setLang(lang);
      for (const seed of seedRange(1, 30)) {
        const game = newGame(seed);
        const bot = BOTS_ROOMS.careful!();
        const rng = new Rng(seed ^ 0x99);
        let idle = 0;
        for (let step = 0; step < 900 && !game.isOver() && idle < 12; step++) {
          const before = game.inputs.length;
          for (const a of roomActions(game)) {
            expect(a.label.length, `${lang}: \u00ab${a.label}\u00bb`).toBeLessThanOrEqual(ACTION_WIDTH);
            if (a.extra !== undefined) {
              expect(a.extra.length, `${lang}: \u00ab${a.extra}\u00bb`).toBeLessThanOrEqual(ACTION_WIDTH);
            }
            lines++;
          }
          game.playerCommand(bot(game, rng));
          idle = game.inputs.length > before ? 0 : idle + 1;
        }
      }
    }
    setLang("en");
    expect(lines, "the control: lists were drawn at all").toBeGreaterThan(50_000);
  }, 120_000);
});
