import { describe, it, expect } from "vitest";
import {
  BREACH_NOISE,
  BREACH_TURNS,
  Rng,
  RoomGame,
  performRoom,
  rememberRoom,
  spawnMonsterIn,
  type Entity,
  type RoomCommand,
  type RoomId,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { ENFORCER, MONSTERS } from "../src/content/monsters.js";
import { moduleBurnLine, moduleKind, type ModuleId } from "../src/content/modules.js";
import { DOORS, keysHeld } from "../src/systems/doors.js";
import { roomList, type Body } from "../src/systems/populate.js";
import { SPIKE_TURNS, applyDerived, findSlot, rigOf, type Rig } from "../src/twist/rig.js";

/**
 * Doors on hand-drawn ships: every state the graph has, every way through one,
 * and what each way costs.
 *
 * The game is the real one — same content pack, same twist, same systems the UI
 * plays — because what is being tested is the bargain the player makes, and
 * that bargain is the noise, the exposed module and the turn, not the state
 * change on its own. Only the graph and the rack are written out, so nothing
 * here depends on a lucky seed.
 */

/** Every door state the engine has, hanging off the compartment the drone lands in. */
const SHIP = `
  TUG -a1- r1
  r1 -[d1:k1]- r2
  r1 -d2- r3
  r1 -(d3)- r4
  r1 -#d4#- r5
  r1 -·d5·- r6
  r1: docking † †:key key:k1
  r2: storage
  r3: corridor
  r4: cargo
  r5: reactor
  r6: mess
`;

/** A corridor with one door: the compartment a drone can weld itself into. */
const DEAD_END = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d2- r3
  r1: docking
  r2: cargo
  r3: corridor
`;

/** Two compartments and one door: the trap, drawn as small as it goes. */
const TRAP = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking
  r2: cargo
`;

/** The same shape with a lock at the far end instead of a plain bulkhead. */
const LOCKED_END = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d2:k1]- r3
  r1: docking
  r2: cargo
  r3: corridor
`;

function gameOn(text: string, seed = 3): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
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

function door(game: RoomGame, label: string): number {
  return game.ship.door(label).id;
}

function stateOf(game: RoomGame, label: string): string {
  return game.ship.door(label).state;
}

/** How loud the compartment the drone is standing in was this turn. */
function noiseHere(game: RoomGame): number {
  return game.noise.get(game.roomOf(game.player).id) ?? 0;
}

function exposedKind(game: RoomGame): ModuleId | null {
  const r = rig(game);
  return r.exposed === null ? null : (r.slots[r.exposed]?.kind ?? null);
}

function act(game: RoomGame, verb: string, label: string) {
  return game.playerCommand({ kind: "act", verb, target: door(game, label) });
}

function offers(game: RoomGame) {
  return DOORS.offerActions!(game);
}

function lines(game: RoomGame): string[] {
  return game.log.lines.map((l) => l.text);
}

function keys(game: RoomGame, n: number): void {
  (game.player.data ??= {}).keys = n;
}

/** Put the drone in a named compartment, sight refreshed as a step would. */
function standIn(game: RoomGame, label: string): void {
  game.player.room = game.ship.room(label).id;
  game.refreshSight();
}

// ------------------------------------------------------------------ the keycard

describe("a keycard", () => {
  it("opens the lock, spends the card and makes no sound at all", () => {
    const game = gameOn(SHIP);
    keys(game, 1);

    expect(act(game, "key", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("open");
    expect(keysHeld(game.player)).toBe(0);
    expect(noiseHere(game)).toBe(0);
    // Standing still and working a reader: nothing of the rack is in the way.
    expect(exposedKind(game)).toBe("plating");
    expect(lines(game)).toContain("Keycard: d1 opens.");
  });

  it("costs no turn without a card, and none on a door that is not locked", () => {
    const game = gameOn(SHIP);
    const refused = act(game, "key", "d1");
    expect(refused.ok).toBe(false);
    expect(refused.cost).toBe(0);
    expect(game.inputs).toHaveLength(0);
    expect(stateOf(game, "d1")).toBe("locked");

    keys(game, 1);
    expect(act(game, "key", "d3").ok).toBe(false);
    expect(keysHeld(game.player)).toBe(1);
    expect(game.inputs).toHaveLength(0);
  });
});

// --------------------------------------------------------------------- the cell

describe("the cell", () => {
  it("blows the lock for a point of itself and six of noise", () => {
    const game = gameOn(SHIP);
    const slot = findSlot(rig(game), "cell")!;
    const before = rig(game).slots[slot]!.integrity;

    expect(act(game, "power", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("open");
    expect(rig(game).slots[slot]!.integrity).toBe(before - 1);
    expect(noiseHere(game)).toBe(6);
    expect(exposedKind(game)).toBe("cell");
  });

  it("burns out when the lock takes its last point", () => {
    const game = gameOn(SHIP);
    const slot = findSlot(rig(game), "cell")!;
    rig(game).slots[slot]!.integrity = 1;

    expect(act(game, "power", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("open");
    expect(rig(game).slots[slot]).toBeNull();
    expect(rig(game).burned).toContain("cell");
    expect(lines(game)).toContain(moduleBurnLine("cell"));
  });

  it("is refused on a welded door, where there is no lock to power", () => {
    const game = gameOn(SHIP);
    const slot = findSlot(rig(game), "cell")!;
    const before = rig(game).slots[slot]!.integrity;

    expect(act(game, "power", "d4").ok).toBe(false);
    expect(stateOf(game, "d4")).toBe("sealed");
    expect(rig(game).slots[slot]!.integrity).toBe(before);
    expect(game.inputs).toHaveLength(0);
  });
});

// -------------------------------------------------------------------- the spike

describe("the spike", () => {
  it("takes two turns of standing still, at four noise each", () => {
    const game = gameOn(SHIP);
    give(game, "spike");
    expect(SPIKE_TURNS).toBe(2);

    expect(act(game, "spike", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("locked");
    expect(noiseHere(game)).toBe(4);
    expect(exposedKind(game)).toBe("spike");

    expect(act(game, "spike", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("open");
    expect(exposedKind(game)).toBe("spike");
  });

  it("keeps the work it has done on that door, and picks it up again later", () => {
    const game = gameOn(SHIP);
    give(game, "spike");

    act(game, "spike", "d1");
    game.playerCommand({ kind: "wait" });
    // Unlike cutting, picking a lock is not undone by looking away: the pins
    // the spike has already found stay found.
    expect(act(game, "spike", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("open");
  });

  it("is refused without the module, and on a door with no electronics left", () => {
    const game = gameOn(SHIP);
    expect(act(game, "spike", "d1").ok).toBe(false);
    expect(game.inputs).toHaveLength(0);

    give(game, "spike");
    expect(act(game, "spike", "d4").ok).toBe(false);
    expect(stateOf(game, "d4")).toBe("sealed");
    expect(game.inputs).toHaveLength(0);
  });
});

// ------------------------------------------------------------------- the cutter

describe("the cutter", () => {
  it("takes three turns in a row and leaves a hole, loudly", () => {
    const game = gameOn(SHIP);
    expect(BREACH_TURNS).toBe(3);

    for (let turn = 1; turn <= BREACH_TURNS; turn++) {
      expect(act(game, "cut", "d1").ok, `turn ${turn}`).toBe(true);
      expect(noiseHere(game), `turn ${turn}`).toBe(BREACH_NOISE);
      expect(exposedKind(game), `turn ${turn}`).toBe("cutter");
      expect(stateOf(game, "d1"), `turn ${turn}`).toBe(turn === BREACH_TURNS ? "broken" : "locked");
    }
  });

  it("opens a welded bulkhead too — it is the only thing that does", () => {
    const game = gameOn(SHIP);
    for (let turn = 0; turn < BREACH_TURNS; turn++) act(game, "cut", "d4");
    expect(stateOf(game, "d4")).toBe("broken");
  });

  it("starts again when anything interrupts it", () => {
    const game = gameOn(SHIP);
    act(game, "cut", "d1");
    act(game, "cut", "d1");
    game.playerCommand({ kind: "wait" });
    expect(lines(game)).toContain("You break off the cut.");

    // Two turns of work were spent; the third does not finish what is left.
    act(game, "cut", "d1");
    expect(stateOf(game, "d1")).toBe("locked");
    act(game, "cut", "d1");
    act(game, "cut", "d1");
    expect(stateOf(game, "d1")).toBe("broken");
  });

  it("is broken off by walking out of the compartment", () => {
    const game = gameOn(SHIP);
    act(game, "cut", "d1");
    game.playerCommand({ kind: "go", door: door(game, "d2") });
    expect(lines(game)).toContain("You break off the cut.");
    expect(game.ship.roomAt(game.ship.room("r1").id).data.work).toBeUndefined();
  });

  it("is refused without a cutter, and on a door that is already open", () => {
    const game = gameOn(SHIP);
    drop(game, "cutter");
    expect(act(game, "cut", "d1").ok).toBe(false);
    expect(game.inputs).toHaveLength(0);

    give(game, "cutter");
    expect(act(game, "cut", "d2").ok).toBe(false);
    expect(game.inputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------- the ram

describe("the ram", () => {
  it("takes eight turns in a row at twelve noise, with the thrusters under every blow, and leaves a hole", () => {
    const game = gameOn(SHIP);
    drop(game, "cutter");
    drop(game, "cell");
    expect(keysHeld(game.player)).toBe(0);

    for (let turn = 1; turn <= 8; turn++) {
      expect(act(game, "ram", "d1").ok, `turn ${turn}`).toBe(true);
      expect(noiseHere(game), `turn ${turn}`).toBe(12);
      expect(exposedKind(game), `turn ${turn}`).toBe("thrusters");
      expect(stateOf(game, "d1"), `turn ${turn}`).toBe(turn === 8 ? "broken" : "locked");
    }
    expect(lines(game)).toContain("Ramming d1. 7 more turns.");
    expect(lines(game)).toContain("d1 buckles and gives way.");
  });

  it("opens a welded bulkhead too, with nothing in the rack at all", () => {
    const game = gameOn(SHIP);
    rig(game).slots.fill(null);
    applyDerived(game.player);
    for (let turn = 0; turn < 8; turn++) expect(act(game, "ram", "d4").ok).toBe(true);
    expect(stateOf(game, "d4")).toBe("broken");
  });

  it("starts again when anything interrupts it", () => {
    const game = gameOn(SHIP);
    for (let turn = 0; turn < 7; turn++) act(game, "ram", "d1");
    game.playerCommand({ kind: "wait" });
    expect(lines(game)).toContain("You break off the ramming.");
    act(game, "ram", "d1");
    expect(stateOf(game, "d1")).toBe("locked");
  });

  it("is refused on a door that is open, broken or closed, for no turn", () => {
    const game = gameOn(SHIP);
    for (const label of ["d2", "d3", "d5"]) {
      expect(act(game, "ram", label).ok, label).toBe(false);
    }
    expect(game.inputs).toHaveLength(0);
  });

  it("is the way out of a compartment a weld would otherwise have walled in", () => {
    // G14's livelock, the other way round: the drone behind a sealed door with
    // nothing in the rack used to wait out the harness. Eight turns of the
    // chassis, and it walks home.
    const game = gameOn(`
      TUG -a1- r1
      r1 -#d1#- r2
      r1: docking
      r2: storage
    `);
    rig(game).slots.fill(null);
    applyDerived(game.player);
    standIn(game, "r2");
    for (let turn = 0; turn < 8; turn++) expect(act(game, "ram", "d1").ok).toBe(true);
    expect(game.playerCommand({ kind: "go", door: door(game, "d1") }).ok).toBe(true);
    expect(game.roomOf(game.player).id).toBe(game.ship.room("r1").id);
  });
});

// ------------------------------------------------------------------- the welder

describe("the welder", () => {
  it("seals a door in two turns, at five noise each", () => {
    const game = gameOn(SHIP);
    give(game, "welder");

    expect(act(game, "weld", "d2").ok).toBe(true);
    expect(stateOf(game, "d2")).toBe("open");
    expect(noiseHere(game)).toBe(5);
    expect(exposedKind(game)).toBe("welder");

    expect(act(game, "weld", "d2").ok).toBe(true);
    expect(stateOf(game, "d2")).toBe("sealed");
  });

  it("seals a closed door as well as an open one", () => {
    const game = gameOn(SHIP);
    give(game, "welder");
    act(game, "weld", "d3");
    act(game, "weld", "d3");
    expect(stateOf(game, "d3")).toBe("sealed");
  });

  it("starts again when anything interrupts it", () => {
    const game = gameOn(SHIP);
    give(game, "welder");
    act(game, "weld", "d2");
    game.playerCommand({ kind: "wait" });
    expect(lines(game)).toContain("You break off the weld.");

    act(game, "weld", "d2");
    expect(stateOf(game, "d2")).toBe("open");
    act(game, "weld", "d2");
    expect(stateOf(game, "d2")).toBe("sealed");
  });

  it("is refused without a welder, on a lock, and on a hole", () => {
    const game = gameOn(SHIP);
    expect(act(game, "weld", "d2").ok).toBe(false);

    give(game, "welder");
    expect(act(game, "weld", "d1").ok).toBe(false);
    expect(act(game, "weld", "d5").ok).toBe(false);
    expect(game.inputs).toHaveLength(0);
  });

  /**
   * The one move that ends a run without ending it. A sealed bulkhead never
   * opens again, nothing can reach the drone through one, and there is no
   * `leave` outside the airlock — so a drone that welds the only door of the
   * compartment it is standing in waits there for ever. The random bot walked
   * into it on seed 18 of the balance batch: alive on 3 HP in a corridor
   * behind one welded door for the last four hundred commands of the run.
   */
  it("refuses to seal the last way out of the compartment the drone is in", () => {
    const game = gameOn(DEAD_END);
    give(game, "welder");
    standIn(game, "r3");

    const out = act(game, "weld", "d2");
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(game.inputs).toHaveLength(0);
    expect(stateOf(game, "d2")).toBe("open");

    // Shown on the list all the same, with the reason on it: the bulkhead a
    // drone wants to shut is the one it just came through.
    const line = offers(game).find((o) => o.label === "weld d2")!;
    expect(line.enabled).toBe(false);
    expect(line.why).toBe(out.reason);
  });

  it("seals it once there is a second way out, the airlock included", () => {
    const game = gameOn(DEAD_END);
    give(game, "welder");

    // r2 has two doors: welding one leaves the other.
    standIn(game, "r2");
    expect(act(game, "weld", "d2").ok).toBe(true);
    expect(act(game, "weld", "d2").ok).toBe(true);
    expect(stateOf(game, "d2")).toBe("sealed");

    // r1 has one bulkhead and the airlock, and the airlock is a way out.
    standIn(game, "r1");
    expect(act(game, "weld", "d1").ok).toBe(true);
    expect(act(game, "weld", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("sealed");
  });

  it("counts no lock as a way out, whatever the rack is carrying for it", () => {
    // The guard used to ask the rack, and a rack is a thing that burns: the
    // card is spent by the lock it opens, the CELL a point at a time, the
    // CUTTER in the first fight — and the door welded on the strength of one
    // of them never opens again. The way home may not depend on a tool
    // (`tests/deadends.test.ts`, "a compartment nothing can reach").
    const game = gameOn(LOCKED_END);
    give(game, "welder");
    standIn(game, "r2");

    drop(game, "cutter");
    drop(game, "cell");
    expect(act(game, "weld", "d1").ok).toBe(false);

    keys(game, 1);
    expect(act(game, "weld", "d1").ok).toBe(false);
    give(game, "cell");
    expect(act(game, "weld", "d1").ok).toBe(false);
    expect(stateOf(game, "d1")).toBe("open");
  });
});

// -------------------------------------------------------------------- closing

describe("closing a door", () => {
  it("costs a turn, two noise, and the thrusters", () => {
    const game = gameOn(SHIP);
    expect(act(game, "close", "d2").ok).toBe(true);
    expect(stateOf(game, "d2")).toBe("closed");
    expect(noiseHere(game)).toBe(2);
    expect(exposedKind(game)).toBe("thrusters");
  });

  it("is refused on anything that is not open", () => {
    const game = gameOn(SHIP);
    for (const label of ["d1", "d3", "d4", "d5"]) {
      expect(act(game, "close", label).ok, label).toBe(false);
    }
    expect(game.inputs).toHaveLength(0);
  });
});

// ------------------------------------------------------------------- a mine

describe("a mined door", () => {
  /** The lock the drone lands next to, with a charge on it (`content/hazards.ts`, `mine`). */
  const MINED = `
    TUG -a1- r1
    r1 -[d1:k1]- r2
    r1 -d2- r3
    r1: docking
    r2: storage
    r3: corridor
    d1: trap=mine
    d2: trap=mine
  `;

  it("lists defuse ahead of the five ways through the lock, and ahead of closing an open one", () => {
    const game = gameOn(MINED);
    give(game, "welder");
    const verbs = (label: string): string[] =>
      offers(game)
        .filter((o) => o.cmd.kind === "act" && o.cmd.target === door(game, label))
        .map((o) => (o.cmd.kind === "act" ? o.cmd.verb : ""));
    expect(verbs("d1")).toEqual(["defuse", "power", "spike", "cut", "key", "ram"]);
    expect(verbs("d2")).toEqual(["defuse", "close", "weld"]);
  });

  it("is lifted from either side, whatever the lock says, and drops the job like a weld does", () => {
    const game = gameOn(MINED);
    give(game, "welder");
    expect(act(game, "defuse", "d1").ok).toBe(true);
    expect(noiseHere(game)).toBe(5);
    expect(lines(game)).toContain("You work the welder around the charge on d1.");
    expect(act(game, "defuse", "d1").ok).toBe(true);
    expect(game.ship.door("d1").trap).toBeUndefined();
    expect(stateOf(game, "d1")).toBe("locked");
    expect(lines(game)).toContain("The mine on d1 is dead. Nothing under it now.");

    // A turn spent on anything else starts the two turns over.
    expect(act(game, "defuse", "d2").ok).toBe(true);
    game.playerCommand({ kind: "wait" });
    expect(lines(game)).toContain("You break off the defusing.");
    expect(act(game, "defuse", "d2").ok).toBe(true);
    expect(game.ship.door("d2").trap).toBe("mine");
    expect(act(game, "defuse", "d2").ok).toBe(true);
    expect(game.ship.door("d2").trap).toBeUndefined();
  });

  it("wants the welder, and says so for no turn", () => {
    const game = gameOn(MINED);
    drop(game, "welder");
    const refused = act(game, "defuse", "d1");
    expect(refused.ok).toBe(false);
    expect(refused.cost).toBe(0);
    expect(refused.reason).toBe("No WELDER in the rack.");
    expect(game.inputs).toHaveLength(0);
    expect(offers(game).find((o) => o.cmd.kind === "act" && o.cmd.verb === "defuse")?.enabled).toBe(false);
  });
});

// ---------------------------------------------------------- doors of other rooms

describe("a door the drone is not standing at", () => {
  it("is refused without costing a turn", () => {
    const game = gameOn(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -[d2:k1]- r3
      r1: docking
      r2: cargo
      r3: storage
    `);
    keys(game, 1);
    expect(act(game, "key", "d2").ok).toBe(false);
    expect(game.inputs).toHaveLength(0);
    expect(stateOf(game, "d2")).toBe("locked");
  });
});

// ------------------------------------------------------------- the action list

describe("what the compartment offers", () => {
  it("names every way through a lock, and puts the card behind the modules", () => {
    const game = gameOn(SHIP);
    give(game, "spike");
    keys(game, 1);

    const locked = offers(game).filter((o) => o.cmd.kind === "act" && o.cmd.verb !== "search" && o.cmd.target === door(game, "d1"));
    expect(locked.map((o) => o.label)).toEqual(["power d1", "spike d1", "cut d1", "key d1", "ram d1"]);
    expect(locked.every((o) => o.enabled)).toBe(true);
  });

  /**
   * The order is a rule and not a presentation, which is why it has a test of
   * its own: whoever reads this list takes the first thing on it that can be
   * done. The action list hands the number to the first enabled way
   * (`ui/actions.ts`, `doorActions`) and a bot picks the same one
   * (`testing/roombots.ts`, `throughDoor`), so a card offered ahead of a module
   * is a card spent on the first lock of every hull — and on a SCRAPPER, which
   * carries no SPIKE, that card was the only way to raise the terminal.
   */
  it("offers a drone that carries everything the cell first and the card last", () => {
    const game = gameOn(SHIP);
    give(game, "spike");
    keys(game, 2);

    const ways = offers(game).filter(
      (o) => o.enabled && o.cmd.kind === "act" && o.cmd.target === door(game, "d1"),
    );
    expect(ways[0]!.label).toBe("power d1");
    // The card is the last thing spent, and the chassis — which spends
    // nothing and is always there — is behind even that (G90 B).
    expect(ways[ways.length - 2]!.label).toBe("key d1");
    expect(ways[ways.length - 1]!.label).toBe("ram d1");

    // And the card is still one press away for a player who wants the silence:
    // it is offered, it is enabled, and it opens the bulkhead.
    expect(act(game, "key", "d1").ok).toBe(true);
    expect(stateOf(game, "d1")).toBe("open");
    expect(keysHeld(game.player)).toBe(1);
  });

  it("falls through to the card when the modules are gone, with the chassis behind it", () => {
    // The one case where the card is the first enabled line, and the case the
    // ordering must not break: nothing else in the rack opens this lock, and
    // the ram is behind the card so that the silent way is the one taken.
    const game = gameOn(SHIP);
    drop(game, "cutter");
    drop(game, "cell");
    keys(game, 1);

    const ways = offers(game).filter(
      (o) => o.enabled && o.cmd.kind === "act" && o.cmd.target === door(game, "d1"),
    );
    expect(ways.map((o) => o.label)).toEqual(["key d1", "ram d1"]);
  });

  it("greys out every module way for a drone carrying nothing, says why, and leaves it the ram", () => {
    const game = gameOn(SHIP);
    drop(game, "cutter");
    drop(game, "cell");

    const locked = offers(game).filter((o) => o.cmd.kind === "act" && o.cmd.verb !== "search" && o.cmd.target === door(game, "d1"));
    expect(locked).toHaveLength(5);
    const greyed = locked.filter((o) => !o.enabled);
    expect(greyed.map((o) => o.label)).toEqual(["power d1", "spike d1", "cut d1", "key d1"]);
    for (const o of greyed) expect(o.why, o.label).toBeTruthy();
    expect(locked.filter((o) => o.enabled).map((o) => o.label)).toEqual(["ram d1"]);
  });

  it("offers a welded door the ram alone without a cutter, and the torch ahead of it with one", () => {
    const game = gameOn(SHIP);
    drop(game, "cutter");
    // The GHOST chassis: no cutter, so a sealed bulkhead used to be a wall.
    // It is a decision now — eight loud turns of the chassis — and nothing else.
    const ways = (): string[] =>
      offers(game)
        .filter((o) => o.cmd.kind === "act" && o.cmd.verb !== "search" && o.cmd.target === door(game, "d4"))
        .map((o) => o.label);
    expect(ways()).toEqual(["ram d4"]);

    give(game, "cutter");
    expect(ways()).toEqual(["cut d4", "ram d4"]);
  });

  it("offers closing and welding on what is open, and nothing on a hole", () => {
    const game = gameOn(SHIP);
    give(game, "welder");
    const labels = (label: string): string[] =>
      offers(game)
        .filter((o) => o.cmd.kind === "act" && o.cmd.verb !== "search" && o.cmd.target === door(game, label))
        .map((o) => o.label);

    expect(labels("d2")).toEqual(["close d2", "weld d2"]);
    expect(labels("d3")).toEqual(["weld d3"]);
    expect(labels("d5")).toEqual([]);

    drop(game, "welder");
    expect(labels("d2")).toEqual(["close d2"]);
    expect(labels("d3")).toEqual([]);
  });

  it("never offers the airlock", () => {
    const game = gameOn(SHIP);
    const airlock = game.ship.airlock()!;
    expect(offers(game).some((o) => o.cmd.kind === "act" && o.cmd.verb !== "search" && o.cmd.target === airlock.id)).toBe(false);
  });
});

// ------------------------------------------------------------------ the machines

describe("a machine and a welded bulkhead", () => {
  it("cannot get through it, and can once the drone has cut it open", () => {
    const game = gameOn(SHIP);
    const kind = MONSTERS.find((m) => m.id === "maintenance-bot")!;
    const bot: Entity = spawnMonsterIn(kind, game.ship.room("r5").id);
    game.schedule.admit(bot);
    game.entities.push(bot);
    expect(bot.breacher).toBeFalsy();

    const d4 = door(game, "d4");
    expect(performRoom(game, bot, { kind: "go", door: d4 }).ok).toBe(false);
    expect(bot.room).toBe(game.ship.room("r5").id);

    for (let turn = 0; turn < BREACH_TURNS; turn++) act(game, "cut", "d4");
    expect(stateOf(game, "d4")).toBe("broken");
    expect(performRoom(game, bot, { kind: "go", door: d4 }).ok).toBe(true);
    expect(bot.room).toBe(game.ship.room("r1").id);
  });
});

// --------------------------------------------------------------- the ship keeps

describe("what the drone did to the doors", () => {
  it("is still done after a sortie somewhere else and back", () => {
    const game = gameOn(SHIP);
    give(game, "welder");
    keys(game, 1);

    act(game, "key", "d1");
    act(game, "weld", "d2");
    act(game, "weld", "d2");
    expect([stateOf(game, "d1"), stateOf(game, "d2")]).toEqual(["open", "sealed"]);

    const other = `
      TUG -a2- s1
      s1 -e1- s2
      s1: docking
      s2: cargo
    `;
    game.travelTo("2", { generate: () => shipFromText(other).ship });
    game.travelTo("1", { generate: () => shipFromText(SHIP).ship });

    expect(game.currentShip.visits).toBe(2);
    expect([stateOf(game, "d1"), stateOf(game, "d2")]).toEqual(["open", "sealed"]);
    expect(stateOf(game, "d4")).toBe("sealed");
  });
});

// ---------------------------------------------------------------------- bodies

describe("the dead of the crew", () => {
  it("hand over three credits and the keycard they were carrying", () => {
    const game = gameOn(SHIP);
    const body = roomList<Body>(game.roomOf(game.player), "bodies").find((b) => b.key !== undefined)!;

    expect(game.playerCommand({ kind: "act", verb: "search", target: body.id }).ok).toBe(true);
    expect(game.player.data!.loot).toBe(3);
    expect(keysHeld(game.player)).toBe(1);
    expect(noiseHere(game)).toBe(2);
    expect(exposedKind(game)).toBe("plating");
    expect(lines(game)).toContain("A keycard. Doors marked [ ] read it.");
  });

  it("says the keycard line once a run", () => {
    const game = gameOn(SHIP);
    const bodies = roomList<Body>(game.roomOf(game.player), "bodies");
    for (const b of bodies) game.playerCommand({ kind: "act", verb: "search", target: b.id });
    const hint = lines(game).filter((l) => l === "A keycard. Doors marked [ ] read it.");
    expect(hint).toHaveLength(1);
  });

  it("have nothing left the second time", () => {
    const game = gameOn(SHIP);
    const body = roomList<Body>(game.roomOf(game.player), "bodies")[0]!;
    game.playerCommand({ kind: "act", verb: "search", target: body.id });
    const loot = game.player.data!.loot;
    const held = keysHeld(game.player);

    const again = game.playerCommand({ kind: "act", verb: "search", target: body.id });
    expect(again.ok).toBe(false);
    expect(again.cost).toBe(0);
    expect(game.player.data!.loot).toBe(loot);
    expect(keysHeld(game.player)).toBe(held);
    expect(game.inputs).toHaveLength(1);
  });

  it("drops the marked key on every seed, whatever the hull's chance says", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const game = gameOn(SHIP, seed);
      const body = roomList<Body>(game.roomOf(game.player), "bodies").find((b) => b.key !== undefined)!;
      game.playerCommand({ kind: "act", verb: "search", target: body.id });
      expect(keysHeld(game.player), `seed ${seed}`).toBe(1);
    }
  });

  it("is offered until it has been gone through, and never after", () => {
    const game = gameOn(SHIP);
    const searchOffers = (): number => offers(game).filter((o) => o.label === "search crew body").length;
    expect(searchOffers()).toBe(2);

    for (const b of roomList<Body>(game.roomOf(game.player), "bodies")) {
      game.playerCommand({ kind: "act", verb: "search", target: b.id });
    }
    expect(searchOffers()).toBe(0);
  });
});

// ----------------------------------------------------------------- the panel

describe("the panel", () => {
  it("counts the keyring", () => {
    const game = gameOn(SHIP);
    expect(DOORS.panelLines!(game).map((l) => l.text)).toEqual(["KEYS  0"]);
    keys(game, 2);
    expect(DOORS.panelLines!(game).map((l) => l.text)).toEqual(["KEYS  2"]);
  });
});

// -------------------------------------------------------------------- property

/** A random legal-looking command, for the turns between the offers. */
function randomCommand(game: RoomGame, rng: Rng): RoomCommand {
  const here: RoomId = game.roomOf(game.player).id;
  const roll = rng.int(0, 3);
  if (roll === 0) return { kind: "wait" };
  const doors = game.ship.doorsOf(here).filter((d) => d.state !== "airlock");
  return doors.length === 0 ? { kind: "wait" } : { kind: "go", door: rng.pick(doors).id };
}

describe("the offers and the game agree", () => {
  /**
   * The contract every action list stands on: what it says can be done, the
   * game accepts; what it greys out, the game refuses without taking a turn.
   * A player reading a number and a bot picking one (E14) must get the same
   * game, and both of them only ever see this list.
   */
  it("over three hundred states of a ship full of doors", () => {
    let states = 0;
    let enabled = 0;
    let refused = 0;

    for (let seed = 1; seed <= 30; seed++) {
      const game = gameOn(SHIP, seed);
      const rng = new Rng(seed * 977 + 13);

      // A different drone every seed: keys or no keys, and a rack that carries
      // some of the four modules a door can be opened or shut with.
      keys(game, rng.int(0, 1));
      for (const kind of ["cutter", "cell", "spike", "welder"] as const) {
        if (rng.chance(0.5)) give(game, kind);
        else drop(game, kind);
      }

      for (let step = 0; step < 15 && game.status === "playing"; step++) {
        const list = offers(game);
        states++;

        for (const offer of list.filter((o) => !o.enabled)) {
          const turns = game.inputs.length;
          const out = game.playerCommand(offer.cmd);
          expect(out.ok, `${offer.label} on seed ${seed}`).toBe(false);
          expect(out.cost, offer.label).toBe(0);
          expect(game.inputs, offer.label).toHaveLength(turns);
          expect(offer.why, offer.label).toBeTruthy();
          refused++;
        }

        const live = list.filter((o) => o.enabled);
        if (live.length === 0) {
          game.playerCommand(randomCommand(game, rng));
          continue;
        }
        const pick = rng.pick(live);
        expect(game.playerCommand(pick.cmd).ok, `${pick.label} on seed ${seed}`).toBe(true);
        enabled++;
      }
    }

    expect(states).toBeGreaterThanOrEqual(300);
    expect(enabled).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(50);
  });
});

/**
 * The move the whole `D` key exists for (docs/tasks/G64-door-hotkeys.md): a
 * machine on the far side of a welded seam is a machine that is out of the run.
 *
 * It is a rule and not an accident — `Ship.passable` lets nothing but a
 * `breacher` through `sealed` — so it is worth a test that plays it out rather
 * than one that asks the graph. Sixty turns is well past anything a machine
 * could be waiting for: the ENFORCER cuts through in three.
 */
describe("a machine welded into a compartment", () => {
  /** A hunting machine, told where the drone is so that it will come if it can. */
  function hunter(game: RoomGame, kind: typeof ENFORCER, room: string): Entity {
    const bot = spawnMonsterIn(kind, game.ship.room(room).id);
    game.schedule.admit(bot);
    game.entities.push(bot);
    rememberRoom(bot, game.ship.room("r1").id);
    game.refreshSight();
    return bot;
  }

  /** The drone welds the one door of the compartment it is standing in. */
  function sealItIn(game: RoomGame): void {
    give(game, "welder");
    for (let turn = 0; turn < 2; turn++) act(game, "weld", "d1");
    expect(stateOf(game, "d1")).toBe("sealed");
  }

  it("never gets out, however long the drone waits", () => {
    const game = gameOn(TRAP);
    const bot = hunter(game, MONSTERS.find((m) => m.id === "maintenance-bot")!, "r2");
    expect(bot.breacher).toBeFalsy();
    sealItIn(game);

    const cargo = game.ship.room("r2").id;
    for (let turn = 0; turn < 60; turn++) {
      game.playerCommand({ kind: "wait" });
      expect(bot.room, `turn ${turn}`).toBe(cargo);
    }
    expect(stateOf(game, "d1")).toBe("sealed");
    expect(game.status).toBe("playing");
  });

  it("gets out if it is the ENFORCER, because cutting is what a breacher does", () => {
    // Not a bug and not an oversight: the ship's own hunter is the answer to
    // the trap, and the price of using one is that the alert can send it.
    const game = gameOn(TRAP);
    const bot = hunter(game, ENFORCER, "r2");
    expect(bot.breacher).toBe(true);
    sealItIn(game);

    const docking = game.ship.room("r1").id;
    let arrived = false;
    for (let turn = 0; turn < 60 && !arrived && game.status === "playing"; turn++) {
      game.playerCommand({ kind: "wait" });
      arrived = bot.room === docking;
    }
    expect(arrived).toBe(true);
    expect(stateOf(game, "d1")).toBe("broken");
  });
});
