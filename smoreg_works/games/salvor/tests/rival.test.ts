import { describe, it, expect } from "vitest";
import { RoomGame, isAlive, type Entity, type RoomCommand, type System } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { CORSAIR, FREIGHTER, SMUGGLER, type DerelictSpec } from "../src/content/derelicts.js";
import { voyageOf } from "../src/systems/voyage.js";
import { RIVAL, startRival, rivalKind } from "../src/systems/rival.js";
import { rivalState, type RivalState } from "../src/systems/rivalstate.js";
import type { ShipSystem } from "../src/systems/populate.js";
import { addWreck, findSlot, rigOf, wrecksIn } from "../src/twist/rig.js";

/**
 * The rival, on hand-drawn ships rather than on seeds: every question here is
 * "which compartment did it walk to and what did it do there", and both should
 * be readable off five lines of fixture text.
 *
 * The ships are drawn so the other tug's drone lands in exactly one place —
 * `MIN_SPAWN_DOORS` is three, so a four-compartment line has one room deep
 * enough — and the systems are put in by hand, in the shape `systems/populate.ts`
 * writes them, because what the rival races for is a system in a room and not
 * the card that put it there.
 */

/** Four compartments in a line, the last bulkhead locked. Deep end: r4. */
const LOCKED_LINE = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -[d3]- r4
  r1: docking
  r2: cargo
  r3: engineering
  r4: hold
`;

/** The same line with nothing locked, so a walk is a walk. */
const OPEN_LINE = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
  r1: docking
  r2: cargo
  r3: engineering
  r4: reactor
`;

/** The tug: one compartment and the airlock back. */
const TUG = `
  TUG -a2- t1
  t1: deck
`;

const NAME = "rival drone";

function gameOn(text: string, seed = 11): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
    systems: [RIVAL],
  });
}

/**
 * Switch the other tug on and let the system see the ship, exactly as a hull
 * whose spec answers "yes" does: the pocket is written before `onLevelEnter`
 * runs, and the arrival is what puts a drone aboard.
 */
function withRival(game: RoomGame, over: Partial<RivalState> = {}): RivalState {
  const st = Object.assign(startRival(game), over);
  RIVAL.onLevelEnter?.(game, 0);
  return st;
}

function rival(game: RoomGame): Entity | undefined {
  return game.entities.find((e) => e.name === NAME && isAlive(e));
}

/** The rival, or a failure that says so rather than a null dereference. */
function theRival(game: RoomGame): Entity {
  const self = rival(game);
  if (!self) throw new Error("rival.test: no rival aboard");
  return self;
}

function wait(game: RoomGame, turns: number): void {
  for (let i = 0; i < turns; i++) game.playerCommand({ kind: "wait" });
}

/**
 * A system standing in a compartment, in the shape `populate` leaves it. Ids
 * are counted over the whole ship, as `nextShipId` counts them: two systems
 * sharing one is a ship that cannot be built, and a rival that skips a job.
 */
function putSystem(game: RoomGame, room: string, kind: ShipSystem["kind"]): ShipSystem {
  const aboard = game.ship.rooms.reduce((n, r) => n + systemsIn(r.data).length, 0);
  const system: ShipSystem = { id: 1000 + aboard, kind, online: false };
  const data = game.ship.room(room).data as { systems?: ShipSystem[] };
  (data.systems ??= []).push(system);
  return system;
}

function systemsIn(data: Record<string, unknown>): ShipSystem[] {
  return (data as { systems?: ShipSystem[] }).systems ?? [];
}

function roomId(game: RoomGame, label: string): number {
  return game.ship.room(label).id;
}

function logText(game: RoomGame): string {
  return game.log.lines.map((m) => m.text).join("\n");
}

// ------------------------------------------------------------- the machine

describe("the rival is another tug's drone", () => {
  it("is a breacher that walks to a standing order, and no roll ever produces it", () => {
    const kind = rivalKind();
    expect(kind.hp).toBe(7);
    expect(kind.speed).toBe(110);
    expect(kind.sight).toBe(1);
    expect(kind.breacher).toBe(true);
    expect(kind.behaviour).toBe("hunter");
    // Weightless and salvage-free: the bands must never offer it, and what it
    // leaves behind is what it was carrying, not a wreck of its own.
    expect(kind.weight).toBe(0);
    expect("salvage" in kind).toBe(false);
  });

  it("lands deep, carrying two modules, with the nearest system as its errand", () => {
    const game = gameOn(LOCKED_LINE);
    putSystem(game, "r3", "engine");
    const st = withRival(game);

    const self = theRival(game);
    expect(self.room).toBe(roomId(game, "r4"));
    expect(self.data?.targetRoom).toBe(roomId(game, "r3"));
    expect(self.data?.loot).toHaveLength(2);
    expect(st.alive).toBe(true);
    expect(logText(game)).toContain("A rival drone is aboard");
  });
});

// -------------------------------------------------------------- the errand

describe("the rival races for the systems", () => {
  it("cuts the locked bulkhead in its way, in three turns, and leaves it broken", () => {
    const game = gameOn(LOCKED_LINE);
    putSystem(game, "r3", "engine");
    withRival(game);
    const door = game.ship.door("d3");

    wait(game, 2);
    expect(door.state).toBe("locked");
    expect(theRival(game).room).toBe(roomId(game, "r4"));

    wait(game, 3);
    expect(door.state).toBe("broken");
    expect(theRival(game).room).toBe(roomId(game, "r3"));
  });

  it("leaves the bulkhead broken for the sortie after, and gains a system meanwhile", () => {
    const game = gameOn(LOCKED_LINE);
    putSystem(game, "r3", "engine");
    const st = withRival(game);

    wait(game, 5);
    expect(game.ship.door("d3").state).toBe("broken");

    game.travelTo("tug", { generate: () => shipFromText(TUG).ship, reason: "custom" });
    expect(RIVAL.panelLines?.(game)).toEqual([]);
    game.travelTo("1", {
      generate: () => {
        throw new Error("rival.test: the derelict should still be in the store");
      },
      reason: "custom",
    });

    // The doors it cut stay cut, and the sortie it had to itself is one system.
    expect(game.ship.door("d3").state).toBe("broken");
    expect(st.progress).toBe(1);
    expect(rival(game)).toBeDefined();
  });

  it("takes a system after thirty of its own turns, and moves on to the next", () => {
    const game = gameOn(OPEN_LINE);
    putSystem(game, "r3", "engine");
    putSystem(game, "r4", "core");
    const st = withRival(game);

    // It lands on the core and starts there: the errand is the closest system,
    // and the closest one can be the compartment it is standing in.
    expect(theRival(game).room).toBe(roomId(game, "r4"));
    expect(theRival(game).data?.targetRoom).toBe(roomId(game, "r4"));

    wait(game, 25);
    expect(st.progress).toBe(0);

    wait(game, 20);
    expect(st.progress).toBe(1);
    expect(logText(game)).toContain("The rival brings the CORE online.");
    // One down, and it is already walking to the other one.
    expect(theRival(game).data?.targetRoom).toBe(roomId(game, "r3"));
  });

  it("never works the same system twice, and never one the drone brought online", () => {
    const game = gameOn(OPEN_LINE);
    putSystem(game, "r3", "engine");
    const core = putSystem(game, "r4", "core");
    withRival(game);

    // The drone got to the core first, so the rival leaves the compartment it
    // landed in and walks to the one that is still worth turns.
    core.online = true;
    wait(game, 1);
    expect(theRival(game).data?.targetRoom).toBe(roomId(game, "r3"));
  });

  it("shows what it has taken in the panel", () => {
    const game = gameOn(OPEN_LINE);
    const st = withRival(game);

    expect(RIVAL.panelLines?.(game)).toEqual([{ text: "RIVAL ▯▯▯" }]);
    st.progress = 2;
    expect(RIVAL.panelLines?.(game)).toEqual([{ text: "RIVAL ▮▮▯" }]);
  });
});

// ---------------------------------------------------------------- the loot

describe("the rival can be robbed", () => {
  /** Put it in reach and out of danger of dying to one blow. */
  function inReach(game: RoomGame): Entity {
    const self = theRival(game);
    self.room = game.roomOf(game.player).id;
    self.hp = 20;
    self.hpMax = 20;
    self.data!.lastHp = 20;
    game.refreshSight();
    return self;
  }

  it("drops exactly one module per blow, where it is standing", () => {
    const game = gameOn(OPEN_LINE);
    putSystem(game, "r3", "engine");
    withRival(game);
    const self = inReach(game);
    const here = game.roomOf(game.player).id;

    game.playerCommand({ kind: "attack", target: self.id });
    expect(wrecksIn(game, here)).toHaveLength(1);
    expect(self.data?.loot).toHaveLength(1);
    expect(logText(game)).toContain("The rival drops ");

    game.playerCommand({ kind: "attack", target: self.id });
    expect(wrecksIn(game, here)).toHaveLength(2);
    expect(self.data?.loot).toHaveLength(0);

    // Nothing left to shake out of it, however long the fight goes on.
    game.playerCommand({ kind: "attack", target: self.id });
    expect(wrecksIn(game, here)).toHaveLength(2);
  });

  it("marks what it dropped as a rival's, and leaves it salvageable", () => {
    const game = gameOn(OPEN_LINE);
    withRival(game);
    const self = inReach(game);
    const here = game.roomOf(game.player).id;

    game.playerCommand({ kind: "attack", target: self.id });
    const wreck = wrecksIn(game, here)[0]!;
    expect(wreck.integrity).toBeGreaterThanOrEqual(2);
    expect(wreck.integrity).toBeLessThanOrEqual(3);
    expect((wreck as { source?: string }).source).toBe("rival");
  });

  it("hands over a coil as spent as the rest of its haul, not a full one", () => {
    const game = gameOn(OPEN_LINE);
    withRival(game);
    const self = inReach(game);
    const here = game.roomOf(game.player).id;
    // Its haul, said out loud: the one module in this game that spends charges,
    // and the relic that spends three of them.
    self.data!.loot = ["emp", "shocker"];

    game.playerCommand({ kind: "attack", target: self.id });
    game.playerCommand({ kind: "attack", target: self.id });
    const piles = wrecksIn(game, here);
    expect(piles.map((w) => w.kind)).toEqual(["emp", "shocker"]);
    // Half of two and half of three: an EMP off the competitor is one shot,
    // and it used to be two — a free full magazine, the most valuable thing
    // there is (G85, 4).
    expect(piles.map((w) => w.charges)).toEqual([1, 1]);
  });

  it("puts a coil on the rack with the charges the pile had, nought included", () => {
    const game = gameOn(OPEN_LINE);
    withRival(game);
    const here = game.roomOf(game.player).id;
    const rig = rigOf(game.player)!;
    // The empty EMP the task names, laid down where the drone stands: what
    // `addWreck` is now told, and what salvaging it has to give back.
    const empty = addWreck(game, here, "emp", 3, "%", 0);
    expect(empty.charges).toBe(0);

    expect(game.playerCommand({ kind: "act", verb: "salvage", target: empty.id }).ok).toBe(true);
    expect(findSlot(rig, "emp")).not.toBeNull();
    expect(rig.slots[findSlot(rig, "emp")!]!.charges).toBe(0);
  });

  it("leaves everything it carried when it is killed outright", () => {
    const game = gameOn(OPEN_LINE);
    const st = withRival(game);
    const self = inReach(game);
    const here = game.roomOf(game.player).id;

    self.hp = 1;
    game.playerCommand({ kind: "attack", target: self.id });
    expect(isAlive(self)).toBe(false);
    expect(wrecksIn(game, here)).toHaveLength(2);
    expect(st.alive).toBe(false);
  });

  it("breaks off at three hit points and is gone for the rest of the sortie", () => {
    const game = gameOn(OPEN_LINE);
    putSystem(game, "r3", "engine");
    const st = withRival(game);
    const self = theRival(game);
    self.hp = 3;

    wait(game, 1);
    expect(self.data?.targetRoom).toBe(game.ship.entry);

    wait(game, 10);
    expect(rival(game)).toBeUndefined();
    expect(st.alive).toBe(false);
    expect(logText(game)).toContain("The rival breaks off and runs for its own lock.");

    // Its tug does not send another one until the next sortie.
    wait(game, 20);
    expect(rival(game)).toBeUndefined();
  });
});

// ----------------------------------------------------------- the countdown

describe("three systems and the ship is not yours", () => {
  /** A hull whose only system is where the rival lands: it never comes for you. */
  function busyRival(seed = 11): RoomGame {
    const game = gameOn(OPEN_LINE, seed);
    putSystem(game, "r4", "core");
    return game;
  }

  it("opens a window of twenty turns, said once", () => {
    const game = busyRival();
    const st = withRival(game, { progress: 2 });

    expect(st.evac).toBeUndefined();
    st.progress = 3;
    RIVAL.onLevelEnter?.(game, 0);
    expect(st.evac).toBe(20);
    expect(logText(game)).toContain("Another tug has the ship. You have twenty turns.");
    expect(RIVAL.panelLines?.(game)).toContainEqual({ text: "EVAC 20", fg: "#d96a6a" });
  });

  it("takes the drone with the ship when the window runs out", () => {
    const game = busyRival();
    const st = withRival(game, { progress: 3 });

    wait(game, 19);
    expect(st.evac).toBe(1);
    expect(game.status).toBe("playing");

    wait(game, 1);
    expect(st.evac).toBe(0);
    expect(isAlive(game.player)).toBe(false);
    expect(game.status).toBe("dead");
    expect(logText(game)).toContain("The rival's tug jumps with the ship. Your drone goes with it.");
  });

  it("is survived by leaving through the airlock", () => {
    const game = busyRival();
    withRival(game, { progress: 3 });

    wait(game, 10);
    game.playerCommand({ kind: "leave" });
    expect(game.status).toBe("won");
    expect(isAlive(game.player)).toBe(true);

    wait(game, 20);
    expect(isAlive(game.player)).toBe(true);
  });
});

// ------------------------------------------------------- the hull without one

describe("a hull the other tug never came to", () => {
  it("has no rival and no panel line, on any seed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const game = gameOn(OPEN_LINE, seed);
      putSystem(game, "r3", "engine");
      wait(game, 5);
      expect(rival(game)).toBeUndefined();
      // The pocket exists — the question is asked once, on the way aboard —
      // and the answer for a hull no class built is no.
      expect(rivalState(game).enabled).toBe(false);
      expect(RIVAL.panelLines?.(game)).toEqual([]);
    }
  });

  it("stays that way when the rival is switched off by name", () => {
    const game = gameOn(OPEN_LINE);
    startRival(game, false);
    RIVAL.onLevelEnter?.(game, 0);
    wait(game, 30);
    expect(rival(game)).toBeUndefined();
    expect(rivalState(game).progress).toBe(0);
  });
});

// ------------------------------------------------------------- determinism

describe("the rival is orthogonal to the run's own randomness", () => {
  it("spawns without spending game.rng", () => {
    const game = gameOn(OPEN_LINE);
    putSystem(game, "r3", "engine");
    const before = game.rng.state;

    withRival(game);
    expect(rival(game)).toBeDefined();
    expect(game.rng.state).toBe(before);
  });

  /** One run's worth of everything a replay has to reproduce. */
  function signature(seed: number, cmds: RoomCommand[]): string {
    const game = gameOn(OPEN_LINE, seed);
    putSystem(game, "r3", "engine");
    putSystem(game, "r4", "core");
    const st = withRival(game);
    for (const cmd of cmds) {
      if (game.status !== "playing") break;
      game.playerCommand(cmd);
    }
    const self = rival(game);
    return [
      logText(game),
      `progress=${st.progress}`,
      `room=${self?.room ?? "gone"}`,
      `loot=${JSON.stringify(self?.data?.loot ?? [])}`,
      `doors=${game.ship.doors.map((d) => d.state).join(",")}`,
    ].join("\n");
  }

  it("replays bit for bit from the same seed and the same commands", () => {
    const cmds: RoomCommand[] = Array.from({ length: 60 }, () => ({ kind: "wait" }) as RoomCommand);
    for (const seed of [1, 7, 4242]) {
      expect(signature(seed, cmds)).toBe(signature(seed, cmds));
    }
  });
});

// ------------------------------------------------------- which hulls have one

/**
 * Where `enabled` comes from, through the door the run uses.
 *
 * The hull's class knows the answer (`DerelictSpec.rival`) and the pocket it
 * goes in only exists once the drone is standing on the ship, so the question
 * is asked on the way aboard. Nothing above can see that: every ship in this
 * file is drawn by hand and belongs to no class at all.
 */
describe("which hulls another tug is working", () => {
  function hullOf(spec: DerelictSpec): System<RoomGame> {
    return {
      name: "test-hull",
      onRunStart(game) {
        const voyage = voyageOf(game);
        voyage.derelicts = [spec];
        voyage.state[0]!.spec = spec;
      },
    };
  }

  /** How many of these seeds put a competitor on this class of hull. */
  function share(spec: DerelictSpec, seeds = 80): number {
    let on = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const game = new RoomGame({
        ...GAME_CONFIG,
        seed,
        systems: [hullOf(spec), ...(GAME_CONFIG.systems ?? [])],
      });
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      if (rivalState(game).enabled) on++;
    }
    return on / seeds;
  }

  it("always on the smuggler and the corsair", () => {
    expect(share(SMUGGLER, 20)).toBe(1);
    expect(share(CORSAIR, 20)).toBe(1);
  });

  it("about a quarter of the time on everything else", () => {
    const rest = share(FREIGHTER);
    expect(rest).toBeGreaterThan(0.1);
    expect(rest).toBeLessThan(0.45);
  });

  it("asks once and keeps the answer for the rest of the voyage", () => {
    // The roll is off the ship's own seed, so it cannot change under a sortie
    // and cannot re-roll the run's stream by being asked (`systems/alert.ts`).
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed: 3,
      systems: [hullOf(SMUGGLER), ...(GAME_CONFIG.systems ?? [])],
    });
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    rivalState(game).progress = 2;

    game.player.room = game.ship.entry;
    game.refreshSight();
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

    // Back aboard, one system further on: the between-sortie step, not a reset.
    expect(rivalState(game).enabled).toBe(true);
    expect(rivalState(game).progress).toBe(3);
  });

  it("wears the design document's own glyph", () => {
    expect(rivalKind().ch).toBe("r");
  });
});
