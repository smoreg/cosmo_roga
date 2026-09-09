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
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { DOORS } from "../src/systems/doors.js";
import { addWreck, applyDerived, install, rigOf } from "../src/twist/rig.js";
import {
  ACTION_KEYS,
  ACTION_WIDTH,
  MAX_ACTIONS,
  omittedActions,
  roomActions,
  roomLabel,
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

    // No doors at all: every one of them is a row of the map since G48, worded
    // after the compartment it leads to and saying how far. What is left here
    // is what happens *in* this compartment — and `close d1`, which is not a
    // way through a bulkhead but a decision about one, and which was silently
    // swallowed before G40 (the owner's second playtest could not shut a door
    // on an ENFORCER).
    expect(labels(game)).toEqual([
      "attack security unit 8/8",
      "salvage THRUSTERS 2/12",
      "close d1",
      "close d4",
    ]);

    const actions = roomActions(game);
    expect(actions[0]!.cmd).toEqual({ kind: "attack", target: machine.id });
    expect(actions[1]!.cmd).toEqual({ kind: "act", verb: "salvage", target: wreck.id });
    expect(actions[2]!.cmd).toEqual({ kind: "act", verb: "close", target: game.ship.door("d1").id });
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

  it("refuses a shut bulkhead in the engine's own words, and costs no turn", () => {
    const game = gameIn();
    // Nothing in the rack: `DOORS` offers the welded seam no method at all —
    // only a torch cuts one — which is when the row falls back to the refusal.
    stripRack(game);
    const shut = rowFor(game, "CORRIDOR");
    expect(shut.enabled).toBe(false);

    const outcome = game.playerCommand(shut.cmd);
    expect(outcome.ok).toBe(false);
    // The map may not invent a refusal the sim would not give.
    expect(shut.why).toBe(outcome.reason);
    // A refused command is not a turn: it never reaches the recorded voyage.
    expect(game.inputs).toEqual([]);
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
    // nothing: the welded seam has only the torch, so the torch takes the row.
    const game = gameIn();
    const line = rowFor(game, "CORRIDOR");
    expect(line.label).toBe("CORRIDOR  r6  d6 sealed");
    expect(line.step).toBeUndefined();
    expect(line.cmd).toEqual({ kind: "act", verb: "cut", target: game.ship.door("d6").id });
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
    expect(line.ways?.map((w) => w.verb)).toEqual(["power", "spike", "cut", "key"]);
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
    expect(aimedAt(lock)).toEqual(["power", "spike", "cut", "key"]);
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
    expect(line.enabled).toBe(false);
    expect(line.ways?.every((w) => !w.enabled)).toBe(true);
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
    expect(list.map((a) => a.key)).toEqual(["1", "2", "3", "4", "0"]);
    expect(list[4]!.step).toBe(null);
  });

  it("greys what the drone cannot spend, with the reason on it, rather than hiding it", () => {
    const game = gameIn();
    const list = roomActions(game, lock(game));
    // Undocked with a CELL and a CUTTER and no card: two of the four are the
    // drone's, and the other two say what is missing rather than disappearing.
    expect(list.filter((a) => a.enabled).map((a) => a.label.split(" ")[0])).toEqual(["power", "cut", "back"]);
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
    // One lock in the fixture, so one row that steps down; the welded seam has
    // a single answer and wears it, and the compartment's own list has no door
    // rows left to carry a level at all.
    expect(map.filter((a) => typeof a.step === "number")).toHaveLength(1);
    for (const head of ["DOCKING", "HAB", "CORRIDOR"]) {
      expect(map.find((a) => a.label.startsWith(head))!.step, head).toBeUndefined();
    }
    expect(roomActions(game).some((a) => a.step !== undefined)).toBe(false);
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
    // …and the compartment's own list has no doors on it at all: they were the
    // same four rows said twice on a twenty-eight column panel, and the map is
    // where they are said better (G48).
    expect(labels(game).some((l) => l.startsWith("go "))).toBe(false);
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
    expect(lock.ways?.map((w) => w.verb)).toEqual(["power", "spike", "cut", "key"]);

    expect(roomActions(game, lock.step ?? undefined, true).map((a) => a.label)).toEqual([
      "power   1 turn, noise 6",
      "spike   2 turns, noise 4",
      "cut     3 turns, noise 9",
      "key     1 turn, silent",
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

    expect(list[0]).toMatch(/^cast off → /);
    expect(list[1]).toBe("buy a hull ▸");
    expect(list.some((l) => l.startsWith("go "))).toBe(false);
    expect(list.some((l) => l.startsWith("leave"))).toBe(false);
    // Every verb of the tug is here, on the first screen, with nothing walked to.
    for (const line of ["cast off", "repair", "graft", "clean", "stow", "fit", "sell", "take", "jump"]) {
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
