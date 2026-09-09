import { describe, it, expect } from "vitest";
import {
  RoomGame,
  replayRooms,
  spawnMonsterIn,
  type Entity,
  type RoomCommand,
  type RoomGameConfig,
  type Twist,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, KESTREL, SALVOR, newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { alertState } from "../src/systems/alert.js";
import { addWreck, applyDerived, findSlot, install, rigOf } from "../src/twist/rig.js";
import { waysHere } from "../src/ui/actions.js";
import {
  engage,
  isStop,
  makeExplorer,
  makeTraveller,
  passableForPlayer,
  travelRoute,
  type AutoResult,
} from "../src/ui/auto.js";

/**
 * Auto-explore is only allowed to exist because of where it stops, so that is
 * what most of this file is: one test per reason to hand the ship back. The
 * ships are hand-drawn — a stop condition asserted through a lucky seed is a
 * stop condition nobody can read six days later.
 *
 * Where a stop is about something *not* happening — no reinforcement waking up,
 * no crate appearing under the drone — the run is built with an explicit
 * `systems` list, so the test says which mechanics are in the room with it
 * instead of inheriting whatever the game config happens to carry that week.
 */

/** Four compartments in a line, the far half of them never walked. */
const HULL = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r3 -d3- r4
  r1: docking explored
  r2: cargo cover explored
  r3: hab
  r4: engineering
`;

/** Two unexplored compartments, one of them a door closer than the other. */
const FORK = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r1 -d3- r4
  r1: docking explored
  r2: cargo explored
  r3: hab
  r4: storage
`;

/**
 * Everything walkable already walked, and one compartment left behind whatever
 * bulkhead the caller draws: the ship auto-explore has to make a decision about
 * (docs/tasks/G59-explore-to-decision.md).
 */
const SHUT = (door: string): string => `
  TUG -a1- r1
  r1 -d1- r2
  ${door}
  r1: docking explored
  r2: cargo explored
  r4: storage
`;

/** Everything walkable already walked: the airlock is the only place left to go. */
const SWEPT = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r1: docking explored
  r2: cargo explored
  r3: hab explored
`;

function config(ship: string, systems: Array<Twist<RoomGame>> = []): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems,
    firstShip: () => shipFromText(ship).ship,
    firstShipId: "1",
  };
}

/** A run on a drawn ship, with the drone put where the test wants it. */
function gameOn(ship: string, room = "r1", systems: Array<Twist<RoomGame>> = [], seed = 7): RoomGame {
  const game = new RoomGame({ ...config(ship, systems), seed });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): Entity {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const machine = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  game.refreshSight();
  return machine;
}

function cmdOf(result: AutoResult): RoomCommand {
  if (isStop(result)) throw new Error(`expected a command, got stop: ${result.stop}`);
  return result.cmd;
}

function stopOf(result: AutoResult): string {
  if (!isStop(result)) throw new Error(`expected a stop, got ${JSON.stringify(result.cmd)}`);
  return result.stop;
}

function door(game: RoomGame, label: string): RoomCommand {
  return { kind: "go", door: game.ship.door(label).id };
}

/** A rack with nothing in it that opens a bulkhead, and no keycard either. */
function stripTools(game: RoomGame): void {
  const rig = rigOf(game.player)!;
  for (const kind of ["cell", "spike", "cutter"] as const) {
    const slot = findSlot(rig, kind);
    if (slot !== null) rig.slots[slot] = null;
  }
  applyDerived(game.player);
  game.player.data = { ...game.player.data, keys: 0 };
}

/** Slot the next blow would land on, which is the whole of the twist. */
function exposed(game: RoomGame): string | undefined {
  const rig = rigOf(game.player)!;
  return rig.exposed === null ? undefined : rig.slots[rig.exposed]?.kind;
}

describe("which doors a walk may use", () => {
  it("steps through what opens on its own and never through a lock", () => {
    const states = { open: true, closed: true, broken: true, locked: false, sealed: false, airlock: false };
    for (const [state, allowed] of Object.entries(states)) {
      expect(passableForPlayer({ id: 0, label: "d1", a: 0, b: 1, state } as never), state).toBe(allowed);
    }
  });
});

describe("auto-explore", () => {
  it("walks towards the compartment it has not seen", () => {
    const game = gameOn(HULL, "r2");
    expect(game.ship.room("r3").explored).toBe(false);
    expect(cmdOf(makeExplorer().step(game))).toEqual(door(game, "d2"));
  });

  it("takes the nearer of two unexplored compartments", () => {
    // r4 is one door away, r3 is two. Both are unseen; only distance decides.
    const game = gameOn(FORK, "r1");
    expect(cmdOf(makeExplorer().step(game))).toEqual(door(game, "d3"));
  });

  it("stops the moment a living machine is in sight", () => {
    const game = gameOn(HULL, "r2");
    const machine = put(game, "r3", "scrapper");
    expect(stopOf(makeExplorer().step(game))).toBe("You see the scrapper in HAB BLOCK.");

    // A dead machine is scenery: the walk ends for other reasons, not for it.
    machine.hp = 0;
    game.reapDead();
    game.refreshSight();
    expect(isStop(makeExplorer().step(game))).toBe(false);
  });

  it("names the compartment the drone is standing in as readily as the next one", () => {
    const game = gameOn(HULL, "r2");
    put(game, "r2", "scout");
    expect(stopOf(makeExplorer().step(game))).toBe("You see the scout in CARGO BAY.");
  });

  it("stops when something is lying here that was not a moment ago", () => {
    const game = gameOn(HULL, "r2");
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    game.roomOf(game.player).data.wrecks = [{ id: 1, kind: "emp", integrity: 2, glyph: "X" }];
    expect(stopOf(explorer.step(game))).toBe("Something here: a parts crate.");

    // ...and it does not stop twice for the same crate.
    expect(isStop(explorer.step(game))).toBe(false);
  });

  it("names whatever a compartment turned out to hold", () => {
    const cases: Array<[string, unknown, string]> = [
      ["wrecks", { id: 1, kind: "emp", integrity: 2, glyph: "X" }, "a parts crate"],
      ["wrecks", { id: 1, kind: "emp", integrity: 2, glyph: "%" }, "scrap"],
      ["bodies", { id: 1, searched: false }, "a crew body"],
      ["crates", { id: 1, kind: "contraband" }, "a contraband crate"],
      ["crates", { id: 1, kind: "cargo" }, "a cargo crate"],
      ["items", { id: 1, kind: "charter-item" }, "a charter package"],
      ["items", { id: 1, kind: "console" }, "a console"],
      ["systems", { id: 1, kind: "core", online: false }, "the core"],
    ];
    for (const [bucket, entry, noun] of cases) {
      const game = gameOn(HULL, "r2");
      const explorer = makeExplorer();
      expect(isStop(explorer.step(game)), noun).toBe(false);
      game.roomOf(game.player).data[bucket] = [entry];
      expect(stopOf(explorer.step(game)), noun).toBe(`Something here: ${noun}.`);
    }
  });

  it("stops on walking into a compartment with anything in it at all", () => {
    // The stop that matters most: what is new is not the crate, it is the room.
    const game = gameOn(HULL, "r2");
    game.ship.room("r3").data.bodies = [{ id: 4, searched: false }];
    const explorer = makeExplorer();

    const step = cmdOf(explorer.step(game));
    expect(step).toEqual(door(game, "d2"));
    expect(game.playerCommand(step).ok).toBe(true);
    expect(stopOf(explorer.step(game))).toBe("Something here: a crew body.");
  });

  it("stops on any damage at all, wherever it landed", () => {
    const game = gameOn(HULL, "r2");
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    rigOf(game.player)!.slots.find((s) => s !== null)!.integrity -= 1;
    expect(stopOf(explorer.step(game))).toBe("Something is hitting you.");
  });

  it("stops on a blow that went straight to the core", () => {
    const game = gameOn(HULL, "r2");
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    game.player.hp -= 1;
    expect(stopOf(explorer.step(game))).toBe("Something is hitting you.");
  });

  it("stops when the ship's alert goes up a step", () => {
    const game = gameOn(HULL, "r2");
    const explorer = makeExplorer();
    expect(isStop(explorer.step(game))).toBe(false);

    alertState(game).level += 1;
    expect(stopOf(explorer.step(game))).toBe("Alert rising.");
  });

  it("stops at the bulkhead the rest of the ship is behind, and hands it over", () => {
    for (const [text, state] of [
      ["r2 -[d3:k1]- r4", "locked"],
      ["r2 -#d3#- r4", "sealed"],
    ] as const) {
      const game = gameOn(SHUT(text), "r2");
      // The drone is carrying a CUTTER and could cut it: auto-explore names the
      // bulkhead and hands the question over, it does not spend three loud
      // turns on the player's behalf.
      expect(findSlot(rigOf(game.player)!, "cutter")).not.toBeNull();
      const result = makeExplorer().step(game);
      expect(stopOf(result)).toBe(`The way on is shut: d3 (${state}).`);
      expect(isStop(result) ? result.door : undefined).toBe(game.ship.door("d3").id);
      expect(game.inputs).toEqual([]);
    }
  });

  it("walks across the ship to the nearest bulkhead it can open", () => {
    // Nothing unexplored is reachable by plain walking, so the walk stops being
    // "explore what is free" and becomes "take me to the next decision".
    const game = gameOn(SHUT("r2 -[d3:k1]- r4"), "r1");
    const explorer = makeExplorer();
    const step = cmdOf(explorer.step(game));
    expect(step).toEqual(door(game, "d1"));
    expect(game.playerCommand(step).ok).toBe(true);
    expect(stopOf(explorer.step(game))).toBe("The way on is shut: d3 (locked).");
  });

  it("takes the nearer of two bulkheads it could open", () => {
    const game = gameOn(
      `
        TUG -a1- r1
        r1 -d1- r2
        r1 -[d2:k1]- r3
        r2 -[d3:k1]- r4
        r1: docking explored
        r2: cargo explored
        r3: hab
        r4: storage
      `,
      "r1",
    );
    expect(stopOf(makeExplorer().step(game))).toBe("The way on is shut: d2 (locked).");
  });

  it("says the sortie is over rather than walking at a lock it cannot open", () => {
    const game = gameOn(SHUT("r2 -[d3:k1]- r4"), "r2");
    stripTools(game);
    expect(stopOf(makeExplorer().step(game))).toBe("DERELICT: no way further in, 1 room left unexplored.");
    expect(game.inputs).toEqual([]);
  });

  it("counts a keycard as a way through a lock and nothing at all through a seam", () => {
    const locked = gameOn(SHUT("r2 -[d3:k1]- r4"), "r2");
    stripTools(locked);
    locked.player.data = { ...locked.player.data, keys: 1 };
    expect(stopOf(makeExplorer().step(locked))).toBe("The way on is shut: d3 (locked).");

    const sealed = gameOn(SHUT("r2 -#d3#- r4"), "r2");
    stripTools(sealed);
    sealed.player.data = { ...sealed.player.data, keys: 1 };
    expect(stopOf(makeExplorer().step(sealed))).toBe("DERELICT: no way further in, 1 room left unexplored.");
  });

  it("reads a bulkhead the same way its own list of ways does", () => {
    // The one place the rig is asked about a door it is not standing at, so it
    // is the one place that could drift from `systems/doors.ts`.
    for (const text of ["r2 -[d3:k1]- r4", "r2 -#d3#- r4"]) {
      for (const strip of [false, true]) {
        // The doors system has to be in the room: its offers are the other half
        // of the comparison.
        const game = gameOn(SHUT(text), "r2", GAME_CONFIG.systems as Array<Twist<RoomGame>>);
        if (strip) stripTools(game);
        const d3 = game.ship.door("d3");
        const offered = waysHere(game).some((w) => w.enabled && w.cmd.kind === "act" && w.cmd.target === d3.id);
        const walked = !stopOf(makeExplorer().step(game)).startsWith("DERELICT");
        expect(walked, `${text} ${strip ? "bare" : "kitted"}`).toBe(offered);
      }
    }
  });

  it("steps through a shut door that is merely closed instead of asking about it", () => {
    // A closed bulkhead costs exactly what a step costs (`rooms/actions.ts`,
    // `doGo` opens and walks in one turn), so it is never a question.
    const game = gameOn(SHUT("r2 -(d3)- r4"), "r2");
    expect(cmdOf(makeExplorer().step(game))).toEqual(door(game, "d3"));
  });

  it("has nothing to explore aboard the tug, and spends nothing saying so", () => {
    const game = newGame(7);
    expect(stopOf(makeExplorer().step(game))).toBe("This is your tug, not a derelict: nothing here to explore.");
    expect(game.inputs).toEqual([]);
  });

  it("names the hull by the callsign the voyage tagged it with", () => {
    const game = gameOn(SWEPT, "r1");
    game.currentShip.data.name = "VESPER";
    expect(stopOf(makeExplorer().step(game))).toBe("VESPER explored. You are standing at the airlock.");
  });

  it("takes one step towards the airlock when the ship is swept, then stops", () => {
    const game = gameOn(SWEPT, "r3");
    const explorer = makeExplorer();

    const step = cmdOf(explorer.step(game));
    expect(step).toEqual(door(game, "d2"));
    expect(game.playerCommand(step).ok).toBe(true);
    expect(stopOf(explorer.step(game))).toBe("DERELICT explored. The airlock is 1 door back.");
  });

  it("counts the way back in doors, and says so when it is standing on it", () => {
    const two = gameOn(SWEPT, "r3");
    const explorer = makeExplorer();
    explorer.step(two);
    expect(stopOf(explorer.step(two))).toBe("DERELICT explored. The airlock is 2 doors back.");

    const home = gameOn(SWEPT, "r1");
    expect(stopOf(makeExplorer().step(home))).toBe("DERELICT explored. You are standing at the airlock.");
  });

  it("hands the ship back the moment the run ends under it", () => {
    const game = gameOn(SWEPT, "r3");
    game.status = "dead";
    expect(stopOf(makeExplorer().step(game))).toBe("The run is over.");
  });

  it("never asks for a command the ship refuses, on a dozen generated ships", () => {
    // Both keys played against real derelicts, the way a voter would: walk, and
    // when the walk hands the ship back, deal with whatever stopped it and walk
    // on. A run stalls when neither key has anything left to do — a bulkhead
    // wants a tool — and that is where this test lets go: it is about the
    // commands the two keys issue, not about how a lock is opened.
    let taken = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const game = newGame(seed);
      // A run starts at home since G19, and home is four compartments the drone
      // has always known. The derelict is one command away.
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok, `seed ${seed}`).toBe(true);
      let explorer = makeExplorer();
      let stalls = 0;
      for (let i = 0; i < 300 && !game.isOver() && stalls < 3; i++) {
        const before = game.inputs.length;
        const result = explorer.step(game);
        if (isStop(result)) {
          explorer = makeExplorer();
          const fight = engage(game, "best");
          if (!isStop(fight)) expect(game.playerCommand(fight.cmd).ok, `seed ${seed}`).toBe(true);
        } else {
          expect(game.playerCommand(result.cmd).ok, `seed ${seed}`).toBe(true);
        }
        if (game.inputs.length > before) {
          stalls = 0;
          taken++;
        } else stalls++;
      }
    }
    expect(taken).toBeGreaterThan(80);
  });

  it("replays bit for bit: the commands it issues are ordinary player input", () => {
    const seed = 20260904;
    const cfg = config(KESTREL, GAME_CONFIG.systems as Array<Twist<RoomGame>>);
    const game = new RoomGame({ ...cfg, seed });

    const cmds = walkAll(game);
    expect(cmds.length).toBeGreaterThan(5);

    const again = replayRooms(seed, cmds, cfg);
    expect(again.roomOf(again.player).label).toBe(game.roomOf(game.player).label);
    expect(again.player.hp).toBe(game.player.hp);
    expect(again.schedule.time).toBe(game.schedule.time);
    expect(again.inputs).toEqual(game.inputs);
    expect(again.log.tail(50)).toEqual(game.log.tail(50));

    // And the decision itself is a function of state: same ship, same walk.
    expect(walkAll(new RoomGame({ ...cfg, seed }))).toEqual(cmds);
  });
});

/** Explore until the ship has nothing reachable left, pressing `o` again at every stop. */
function walkAll(game: RoomGame): RoomCommand[] {
  const cmds: RoomCommand[] = [];
  let explorer = makeExplorer();
  for (let i = 0; i < 80 && cmds.length < 40; i++) {
    const result = explorer.step(game);
    if (isStop(result)) {
      if (result.door !== undefined || result.stop.includes("no way further")) break;
      explorer = makeExplorer();
      continue;
    }
    cmds.push(result.cmd);
    expect(game.playerCommand(result.cmd).ok).toBe(true);
  }
  return cmds;
}

/**
 * Closing in, and the owner's rule it is written from: shoot, or hit what is
 * here, or take one step towards what you know about. Which of the three it
 * picks is which module the ship's answer lands on, so every case below checks
 * the command and the exposure it leaves behind.
 */
describe("engage", () => {
  /** Two compartments through an open door: `here` and `next` in the same test. */
  const RANGE = `
    TUG -a1- r1
    r1 -d1- r2
    r1: docking explored
    r2: hab explored
  `;

  function withEmitter(game: RoomGame): void {
    install(rigOf(game.player)!, "emitter", 3);
    applyDerived(game.player);
  }

  /** A GHOST: a rack with no melee weapon in it at all, only a chassis to ram with. */
  function stripMelee(game: RoomGame): void {
    const rig = rigOf(game.player)!;
    for (const kind of ["cutter", "laser"] as const) {
      const slot = findSlot(rig, kind);
      if (slot !== null) rig.slots[slot] = null;
    }
    applyDerived(game.player);
  }

  it("shoots a machine through an open door when the emitter is intact", () => {
    const game = gameOn(RANGE, "r1");
    withEmitter(game);
    put(game, "r2", "scout");
    expect(cmdOf(engage(game, "best"))).toEqual({ kind: "act", verb: "shoot" });
  });

  it("closes in instead when there is no emitter to shoot with", () => {
    const game = gameOn(RANGE, "r1");
    put(game, "r2", "scout");
    expect(cmdOf(engage(game, "best"))).toEqual(door(game, "d1"));
  });

  it("hits what is in the compartment, by the order the list shows it", () => {
    const game = gameOn(RANGE, "r1");
    const first = put(game, "r1", "scout");
    put(game, "r1", "welder-bot");
    expect(cmdOf(engage(game, "best"))).toEqual({ kind: "attack", target: first.id });
  });

  it("shift+tab closes in even when the shot is there", () => {
    const game = gameOn(RANGE, "r1");
    withEmitter(game);
    put(game, "r2", "scout");
    expect(cmdOf(engage(game, "melee"))).toEqual(door(game, "d1"));
  });

  it("shoots on shift+tab all the same when the rack has nothing to swing", () => {
    // GHOST carries no cutter and no laser (design-doc.md, "Корпуса"), so
    // "never shoot" would leave it with nothing to do but ram.
    const game = gameOn(RANGE, "r1");
    withEmitter(game);
    stripMelee(game);
    put(game, "r2", "scout");
    expect(cmdOf(engage(game, "melee"))).toEqual({ kind: "act", verb: "shoot" });
  });

  it("walks towards a machine a sensor pulse left on the schematic", () => {
    const game = gameOn(
      `
        TUG -a1- r1
        r1 -(d1)- r2
        r1: docking explored
        r2: hab scanned
      `,
      "r1",
    );
    // A shut door: nothing is visible, and the snapshot is all the drone has.
    expect(game.visibleMonsters()).toHaveLength(0);
    game.ship.room("r2").data.snapshot = "c";
    expect(cmdOf(engage(game, "best"))).toEqual(door(game, "d1"));
  });

  it("reads salvage in a snapshot as salvage, not as something to walk at", () => {
    const game = gameOn(
      `
        TUG -a1- r1
        r1 -(d1)- r2
        r1: docking explored
        r2: hab scanned
      `,
      "r1",
    );
    game.ship.room("r2").data.snapshot = "% X";
    expect(stopOf(engage(game, "best"))).toBe("No target in sight.");
  });

  it("refuses without spending a turn when nothing is known about", () => {
    const game = gameOn(RANGE, "r1");
    expect(stopOf(engage(game, "best"))).toBe("No target in sight.");
    expect(stopOf(engage(game, "melee"))).toBe("No target in sight.");
    expect(game.inputs).toEqual([]);
  });

  it("says so rather than walking into a bulkhead it cannot open", () => {
    const game = gameOn(
      `
        TUG -a1- r1
        r1 -#d1#- r2
        r1: docking explored
        r2: hab scanned
      `,
      "r1",
    );
    game.ship.room("r2").data.snapshot = "c";
    expect(stopOf(engage(game, "best"))).toBe("No way through.");
  });

  it("has nothing to say once the run is over", () => {
    const game = gameOn(RANGE, "r1");
    put(game, "r1", "scout");
    game.status = "dead";
    expect(stopOf(engage(game, "best"))).toBe("The run is over.");
  });

  it("exposes the emitter on a tab shot and the cutter on a shift+tab swing", () => {
    const shot = gameOn(RANGE, "r1");
    withEmitter(shot);
    put(shot, "r2", "scout");
    expect(shot.playerCommand(cmdOf(engage(shot, "best"))).ok).toBe(true);
    expect(exposed(shot)).toBe("emitter");

    const swing = gameOn(RANGE, "r1");
    withEmitter(swing);
    put(swing, "r1", "scout");
    expect(swing.playerCommand(cmdOf(engage(swing, "melee"))).ok).toBe(true);
    expect(exposed(swing)).toBe("cutter");
  });

  it("exposes the thrusters on the step shift+tab takes to get there", () => {
    const game = gameOn(RANGE, "r1");
    withEmitter(game);
    put(game, "r2", "scout");
    expect(game.playerCommand(cmdOf(engage(game, "melee"))).ok).toBe(true);
    expect(exposed(game)).toBe("thrusters");
  });
});

/**
 * Travel: the same walk, pointed at a compartment the player named
 * (docs/tasks/G48-travel-to-a-room.md).
 *
 * It is `o`'s machinery and `o`'s stop list — there is one copy of both — so
 * what is asserted here is only what travel adds: it goes the right way, it
 * knows when it has arrived, and it stops in front of anything shut and says
 * which bulkhead, so the screen can offer the ways through it.
 */
describe("travel", () => {
  /** Four in a line with the far pair behind a lock, and a way round it. */
  const ROUTES = `
    TUG -a1- r1
    r1 -d1- r2
    r2 -d2- r3
    r1 -[d3:k1]- r3
    r3 -d4- r4
    r1: docking explored
    r2: cargo explored
    r3: hab explored
    r4: engineering explored
  `;

  /** A compartment reachable only by opening something. */
  const BEHIND = `
    TUG -a1- r1
    r1 -d1- r2
    r2 -[d2:k1]- r3
    r1: docking explored
    r2: cargo explored
    r3: hab explored
  `;

  it("walks one door at a time towards where it was sent", () => {
    const game = gameOn(ROUTES, "r1");
    const walk = makeTraveller(game.ship.room("r4").id);

    expect(cmdOf(walk.step(game))).toEqual(door(game, "d1"));
    expect(game.playerCommand(door(game, "d1")).ok).toBe(true);
    expect(cmdOf(walk.step(game))).toEqual(door(game, "d2"));
    expect(game.playerCommand(door(game, "d2")).ok).toBe(true);
    expect(cmdOf(walk.step(game))).toEqual(door(game, "d4"));
  });

  it("goes the long way round rather than spending a torch on the short one", () => {
    // Two doors through the CARGO BAY, one through the lock. A walk cannot ask
    // whether the lock is worth it, so it does not decide that it is.
    const game = gameOn(ROUTES, "r1");
    expect(cmdOf(makeTraveller(game.ship.room("r3").id).step(game))).toEqual(door(game, "d1"));
    expect(travelRoute(game.ship, game.ship.room("r1").id, game.ship.room("r3").id)?.map((d) => d.label)).toEqual([
      "d1",
      "d2",
    ]);
  });

  it("says so when it arrives, and spends nothing saying it", () => {
    const game = gameOn(ROUTES, "r2");
    const walk = makeTraveller(game.ship.room("r3").id);
    walk.step(game);
    expect(game.playerCommand(door(game, "d2")).ok).toBe(true);
    expect(stopOf(walk.step(game))).toBe("You reach HAB BLOCK.");
    expect(game.inputs).toHaveLength(1);
  });

  it("stops in front of a bulkhead it cannot walk through, and names it", () => {
    // The whole of the owner's second sentence: the walk does not refuse and it
    // does not spend anything, it stops where the question is and hands the
    // question over.
    const game = gameOn(BEHIND, "r2");
    const result = makeTraveller(game.ship.room("r3").id).step(game);
    expect(stopOf(result)).toBe("The way on is shut: d2 (locked).");
    expect(isStop(result) ? result.door : undefined).toBe(game.ship.door("d2").id);
    expect(game.inputs).toEqual([]);
  });

  it("walks up to a bulkhead that is further off before it asks", () => {
    const game = gameOn(BEHIND, "r1");
    const walk = makeTraveller(game.ship.room("r3").id);
    expect(cmdOf(walk.step(game))).toEqual(door(game, "d1"));
    expect(game.playerCommand(door(game, "d1")).ok).toBe(true);
    expect(stopOf(walk.step(game))).toBe("The way on is shut: d2 (locked).");
  });

  it("hands the ship back the moment a machine is in sight, as `o` does", () => {
    const game = gameOn(ROUTES, "r1");
    put(game, "r2", "scout");
    expect(stopOf(makeTraveller(game.ship.room("r4").id).step(game))).toContain("scout");
    expect(game.inputs).toEqual([]);
  });

  it("stops on anything lying in a compartment it has just walked into", () => {
    // The stop list is `o`'s, whole: travel is not a way to walk past the
    // salvage the walk exists to find.
    const game = gameOn(ROUTES, "r1");
    addWreck(game, game.ship.room("r2").id, "thrusters", 2);
    const walk = makeTraveller(game.ship.room("r4").id);
    expect(cmdOf(walk.step(game))).toEqual(door(game, "d1"));
    expect(game.playerCommand(door(game, "d1")).ok).toBe(true);
    expect(stopOf(walk.step(game))).toContain("scrap");
  });

  it("stops rather than looping when nothing joins the two compartments", () => {
    // A hull in two halves. Sealed is not this case — the walk goes up to a
    // seam and asks — so the ship has to be genuinely cut in two, which is what
    // `travelRoute` returning nothing means.
    const split = `
      TUG -a1- r1
      r2 -d4- r3
      r1: docking explored
      r2: cargo explored
      r3: hab explored
    `;
    const game = gameOn(split, "r2");
    expect(travelRoute(game.ship, game.ship.room("r2").id, game.ship.room("r1").id)).toBeUndefined();
    expect(stopOf(makeTraveller(game.ship.room("r1").id).step(game))).toBe("No way through.");
    expect(game.inputs).toEqual([]);
    // Standing on the goal is a route of no doors, not a missing one.
    expect(travelRoute(game.ship, game.ship.room("r2").id, game.ship.room("r2").id)).toEqual([]);
  });

  it("replays bit for bit: a walk is ordinary turns and nothing else", () => {
    const game = gameOn(ROUTES, "r1");
    const walk = makeTraveller(game.ship.room("r4").id);
    for (let i = 0; i < 3; i++) {
      const next = walk.step(game);
      if (isStop(next)) break;
      expect(game.playerCommand(next.cmd).ok).toBe(true);
    }
    const again = replayRooms(game.seed, game.inputs, config(ROUTES));
    expect(again.roomOf(again.player).id).toBe(game.roomOf(game.player).id);
    expect(again.schedule.time).toBe(game.schedule.time);
  });
});
