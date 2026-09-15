import { describe, it, expect } from "vitest";
import {
  RoomDistance,
  RoomGame,
  isAlive,
  spawnMonsterIn,
  walkerOf,
  type ActionOffer,
  type Door,
  type Entity,
  type MonsterKind,
  type RoomCommand,
} from "@jamrog/engine";
import { seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { JAMMER, machineAboard } from "../src/content/monsters.js";
import { CHEAPEST_HULL, HULLS, SCRAPPER, hullName } from "../src/content/hulls.js";
import { isTug } from "../src/content/tug.js";
import type { ModuleId } from "../src/content/modules.js";
import { HUNTER_LEVEL, alertState } from "../src/systems/alert.js";
import { DOORS, keysHeld } from "../src/systems/doors.js";
import { rivalState } from "../src/systems/rivalstate.js";
import { gatedOffers } from "../src/systems/tug.js";
import {
  JUMP_PRICE,
  buyHull,
  currentDerelict,
  graft,
  repair,
  voyageOf,
} from "../src/systems/voyage.js";
import { engage } from "../src/ui/auto.js";
import { applyDerived, findSlot, rigOf, type Rig } from "../src/twist/rig.js";

/**
 * Dead ends: states a run can reach and never leave.
 *
 * A dead end is not a hard fight and not a lost cause — it is a state from
 * which **no sequence of legal commands** reaches a win, a dead drone or the
 * end of the voyage. Under permadeath that is the worst outcome the game has:
 * the run can neither be finished nor abandoned, so the player closes the tab.
 * Nothing else in the suite looks for one, because every other file asks
 * whether a rule works rather than whether the rules together still leave a way
 * out.
 *
 * Two shapes of it, and they need different tools:
 *
 *   aboard  — the drone is walled into a compartment it cannot leave and
 *             nothing aboard can reach. `strandedAboard` decides that off the
 *             graph, the rack and the keyring, so a hand-drawn hull proves it
 *             in five lines and a fuzzed run can be asked the same question.
 *   at home — the tug is tied to a hull that has gone under tow, so `undock` is
 *             refused, and the account has been spent under the price of the
 *             jump. Nothing ends it either: with no sortie there is no drone to
 *             lose, so the account never empties and `endIfBroke` never fires.
 *
 * Only the WELDER can wall a drone in — every other bulkhead a run meets was
 * opened by walking through it and stays open — so `systems/doors.ts` guards
 * that one move, and the two cases below are the ways its first version could
 * still be talked into it: a second door that led nowhere, and a second door
 * the rack could open only until the tool for it burned. What the guard asks
 * now is exactly what `strandedAboard` asks, minus the rack: can the drone
 * still *walk* to the airlock.
 */

// -------------------------------------------------------------- the detector

/** Is this module in the rack, whatever is left of it? */
function carries(rig: Rig | undefined, kind: ModuleId): boolean {
  return rig !== undefined && findSlot(rig, kind) !== null;
}

/**
 * A drone that can neither get out nor be got at.
 *
 * Read off the state rather than searched for by playing: "can this run still
 * end" has three answers aboard a derelict and all three are structural. Either
 * the drone reaches the airlock through doors this rack can open — `leave` ends
 * the sortie — or something alive can walk to the compartment it stands in and
 * eventually kill it, or the ship still has a hunter to send, and a hunter cuts
 * through anything.
 *
 * The last of the three is why the alert is read here at all: an ENFORCER is a
 * `breacher`, so a gauge climbing towards `HUNTER_LEVEL` is a way out. It never
 * climbs, though — a walled-in drone can only wait, waiting is silent, and
 * silence talks the gauge *down* faster than time pushes it up
 * (`systems/alert.ts`: one step per 40 turns aboard against one per 15 quiet
 * ones). So a gauge below the hunter's level is a gauge that stays there.
 */
function strandedAboard(game: RoomGame): boolean {
  if (isTug(game) || game.isOver()) return false;

  const here = game.roomOf(game.player).id;
  const _rig = rigOf(game.player);
  const _keys = keysHeld(game.player);
  const openable = (door: Door): boolean => {
    switch (door.state) {
      case "open":
      case "closed":
      case "broken":
        return true;
      // A lock or a weld is eight turns of the chassis whatever the rack holds
      // (G90 B, `systems/doors.ts`, `ram`): the tools only make it cheaper.
      case "locked":
      case "sealed":
        return true;
      default:
        // The airlock is `leave`, not a door to walk through.
        return false;
    }
  };

  const airlock = game.ship.airlock();
  const home = airlock ? airlock.a : game.ship.entry;
  if (Number.isFinite(RoomDistance.from(game.ship, [here], openable).at(home))) return false;

  for (const e of game.entities) {
    if (e.id === game.player.id || e.room === undefined) continue;
    if (!isAlive(e) || e.faction === game.player.faction) continue;
    const walk = RoomDistance.from(game.ship, [e.room], (d) => game.ship.passable(d, walkerOf(e)));
    if (Number.isFinite(walk.at(here))) return false;
  }

  // The other tug's twenty-turn window ends a sortie on its own, wall or no
  // wall (`systems/rival.ts`, `tickEvac`).
  if (rivalState(game).evac !== undefined) return false;
  return alertState(game).level < HUNTER_LEVEL;
}

// ------------------------------------------------------------------ fixtures

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
function give(game: RoomGame, kind: ModuleId, integrity = 3): void {
  const slots = rig(game).slots;
  const empty = slots.findIndex((s) => s === null);
  slots[empty >= 0 ? empty : slots.length - 1] = { kind, integrity };
  applyDerived(game.player);
}

/** Take a module out of the rack, the way a burn-out would. */
function drop(game: RoomGame, kind: ModuleId): void {
  const slot = findSlot(rig(game), kind);
  if (slot !== null) rig(game).slots[slot] = null;
  applyDerived(game.player);
}

function standIn(game: RoomGame, label: string): void {
  game.player.room = game.ship.room(label).id;
  game.refreshSight();
}

/** The slowest brute in the table: something that can walk, and nothing more. */
const HAULER: MonsterKind = machineAboard("hauler")!;

/** One machine aboard, standing where it is put. */
function put(game: RoomGame, kind: MonsterKind, label: string): Entity {
  const machine = spawnMonsterIn(kind, game.ship.room(label).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  game.refreshSight();
  return machine;
}

function offerLike(game: RoomGame, head: string): ActionOffer<RoomCommand> | undefined {
  return gatedOffers(game).find((o) => o.label.startsWith(head));
}

/** The first line of the jump list: a hull of the next stop and its first contract. */
function jumpOffer(game: RoomGame): ActionOffer<RoomCommand> | undefined {
  return gatedOffers(game).find((o) => o.cmd.kind === "act" && o.cmd.verb === "jump");
}

/** The line the door system puts on the list for one verb on one bulkhead. */
function doorOffer(game: RoomGame, label: string, verb: string): ActionOffer<RoomCommand> | undefined {
  const door = game.ship.door(label).id;
  return DOORS.offerActions!(game).find(
    (o) => o.cmd.kind === "act" && o.cmd.verb === verb && o.cmd.target === door,
  );
}

// -------------------------------------------------------------------- aboard

/**
 * `r2` hangs off the entry behind one door and leads nowhere else, so the state
 * of `d1` alone decides whether a drone standing in it has a way home.
 */
const POCKET = `
  TUG -a1- r1
  r1 -#d1#- r2
  r1: docking
  r2: storage
`;

describe("a compartment nothing can reach", () => {
  it("is an errand and never a dead end: the chassis rams a weld the rack cannot cut", () => {
    // Before G90 B a drone here with no cutter waited out the harness. Now the
    // weld is eight turns of the ram away, and the detector says so — and it is
    // true, not merely declared: the offer is on the list and the door goes.
    const walled = gameOn(POCKET);
    drop(walled, "cutter");
    standIn(walled, "r2");
    expect(strandedAboard(walled)).toBe(false);
    expect(doorOffer(walled, "d1", "ram")?.enabled).toBe(true);
    for (let i = 0; i < 8; i++) {
      expect(walled.playerCommand({ kind: "act", verb: "ram", target: walled.ship.door("d1").id }).ok).toBe(true);
    }
    expect(walled.ship.door("d1").state).toBe("broken");

    const cutter = gameOn(POCKET);
    standIn(cutter, "r2");
    expect(carries(rigOf(cutter.player), "cutter")).toBe(true);
    expect(strandedAboard(cutter)).toBe(false);
  });

  it("is not a dead end while something aboard can still walk to the drone", () => {
    // One machine on the drone's side of the weld: it cannot get out either,
    // but the fight can end, and an ending is all this asks for.
    const game = gameOn(POCKET);
    drop(game, "cutter");
    standIn(game, "r2");
    put(game, HAULER, "r2");
    expect(strandedAboard(game)).toBe(false);
  });

  it("is not a dead end behind a lock the rack still has an answer to", () => {
    const game = gameOn(`
      TUG -a1- r1
      r1 -[d1]- r2
      r1: docking
      r2: storage
    `);
    drop(game, "cutter");
    standIn(game, "r2");
    // A SCRAPPER carries the CELL, and a CELL opens a lock from either side.
    expect(strandedAboard(game)).toBe(false);
    // And with the CELL gone the lock is still eight turns of the chassis.
    drop(game, "cell");
    expect(strandedAboard(game)).toBe(false);
    expect(doorOffer(game, "d1", "ram")?.enabled).toBe(true);
  });

  it("is not something the welder can talk itself into", () => {
    // G14's guard asks "has this compartment another door", and a compartment
    // can have one that leads nowhere. `r2` is a corridor: `d1` is the way
    // home, `d3` opens onto a store cupboard, and welding `d1` used to be legal
    // because `d3` was a door.
    const game = gameOn(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -d3- r4
      r1: docking
      r2: corridor
      r4: storage
    `);
    give(game, "welder", 5);
    standIn(game, "r2");

    const d1 = game.ship.door("d1").id;
    expect(game.playerCommand({ kind: "act", verb: "weld", target: d1 }).ok).toBe(false);
    expect(game.ship.door("d1").state).toBe("open");
    expect(strandedAboard(game)).toBe(false);
  });

  it("is not something a rack that burns can talk itself into either", () => {
    // The second way home is real here — `d2` is a lock, and `r3` comes back
    // round to the airlock — so the guard's question, asked of the rack, said
    // yes: the drone was carrying the CELL that opens it. A rack is a thing
    // that burns, and the CELL is spent a point at a time by that very lock.
    // The way home may not depend on a tool.
    const game = gameOn(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -[d2]- r3
      r3 -d4- r1
      r1: docking
      r2: corridor
      r3: storage
    `);
    drop(game, "cutter");
    give(game, "welder", 5);
    standIn(game, "r2");
    expect(carries(rigOf(game.player), "cell")).toBe(true);

    const d1 = game.ship.door("d1").id;
    expect(game.playerCommand({ kind: "act", verb: "weld", target: d1 }).ok).toBe(false);

    // And the line says so before the key is pressed.
    const weld = doorOffer(game, "d1", "weld");
    expect(weld?.enabled).toBe(false);
    expect(weld?.why).toContain("d1");
  });

  it("still lets the drone shut a bulkhead behind it when home is still open", () => {
    // The guard must not become "no welding": sealing a door that is not the
    // way home is half of what the WELDER is for (design-doc.md, "Дверь", 2).
    const game = gameOn(`
      TUG -a1- r1
      r1 -d1- r2
      r2 -d3- r4
      r1: docking
      r2: corridor
      r4: storage
    `);
    give(game, "welder", 5);
    standIn(game, "r2");

    const d3 = game.ship.door("d3").id;
    expect(doorOffer(game, "d3", "weld")?.enabled).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "weld", target: d3 }).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "weld", target: d3 }).ok).toBe(true);
    expect(game.ship.door("d3").state).toBe("sealed");
    expect(strandedAboard(game)).toBe(false);
  });

  it("never happens to a drone playing the shipped game at random", () => {
    // The generator is already held to "every compartment is reachable with a
    // cutter" (`tests/derelicts.test.ts`, `tests/winnable.test.ts`); this is the
    // other half — what the drone, the machines and the ship's own doors do to
    // that reachability over a few hundred commands of real play.
    const offences: string[] = [];
    let aboard = 0;
    for (const seed of seedRange(1, 40)) {
      const game = newGame(seed);
      const bot = pressAnything(seed);
      let turnsAboard = 0;
      for (let i = 0; i < 300 && !game.isOver(); i++) {
        game.playerCommand(bot(game));
        if (!isTug(game)) turnsAboard++;
        if (strandedAboard(game)) {
          offences.push(`seed ${seed}: walled in after ${game.inputs.length} commands`);
          break;
        }
      }
      if (turnsAboard >= 20) aboard++;
    }
    expect(offences).toEqual([]);
    // And the scan is not walking forty runs that never left the tug: a check
    // that only ever ran on the tug returns false every time by its first line.
    //
    // The bound was `> 20` and the measurement is now 20 of 40, because the tug
    // grew a line that hands a module to the hold for nothing
    // (docs/tasks/G53-tug-is-a-menu.md, 4): a bot that presses at random strips
    // its own drone before it flies and dies sooner out there, so fewer runs
    // spend twenty commands aboard. Lowered to 15 rather than to the
    // measurement — a bound sitting exactly on what was measured is a bound the
    // next change reddens for no reason, and what this line is for is that the
    // scan did not degenerate into forty visits to the tug.
    expect(aboard).toBeGreaterThan(15);
  });
});

/**
 * A bot that presses whatever the game offers, and walks through whatever door
 * it can find when it does not.
 *
 * `randomRoomBot` would do the same job; this one is written out because the run
 * has to be stepped a command at a time — the check above looks at the state
 * *between* two commands, and `fuzzOn` only hands back the runs that threw. Its
 * stream is its own for the same reason: drawing from `game.rng` would make the
 * bot part of the game it is measuring.
 */
function pressAnything(seed: number): (game: RoomGame) => RoomCommand {
  let n = (seed * 2654435761) & 0x7fffffff;
  const next = (max: number): number => {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    return n % max;
  };
  return (game) => {
    const roll = next(10);
    if (roll === 0) return { kind: "wait" };
    if (roll === 1) return { kind: "leave" };
    if (roll <= 6) {
      const offers = gatedOffers(game);
      if (offers.length > 0) return offers[next(offers.length)]!.cmd;
    }
    const doors = game.ship.doorsOf(game.roomOf(game.player).id);
    return doors.length === 0 ? { kind: "wait" } : { kind: "go", door: doors[next(doors.length)]!.id };
  };
}

// ---------------------------------------------------------------------- home

/** Where the stations are on the tug's four-compartment line (`content/tug.ts`). */
const BENCH = "r3";
const HELM = "r4";

/**
 * The tug, tied to a hull that has just gone under tow.
 *
 * The sale is written in rather than played out: what is under test is the
 * account afterwards, and the sale itself is `tests/voyage.test.ts`'s.
 */
function towed(credits: number, seed = 4): RoomGame {
  const game = newGame(seed);
  currentDerelict(game).sold = true;
  voyageOf(game).credits = credits;
  // A rack off the rails is whole, and a whole rack gives the bench nothing to
  // charge for. One dented module is what makes `repair` a line at all.
  rig(game).slots[0]!.integrity = 1;
  applyDerived(game.player);
  return game;
}

describe("the tug tied to a hull under tow", () => {
  it("keeps the price of the jump back from every station that spends", () => {
    // Thirty-three credits: enough for the bench eight times over, and three
    // short of the repair that would leave the tug on this hull for good.
    // `undock` is refused because the hull is gone, so the jump is the only way
    // on — and handing the rack in does not raise the 30 CR back, six modules
    // at four credits apiece.
    const game = towed(33);
    expect(repair(game, 0).ok).toBe(false);
    expect(graft(game, 0).ok).toBe(false);
    expect(voyageOf(game).credits).toBe(33);

    // And the sentence says what to do rather than lying about the balance:
    // there is money, it is simply spoken for.
    expect(repair(game, 0).reason).toBe(`The ${JUMP_PRICE} CR jump comes first.`);
  });

  it("says the same thing on the greyed line as on the key", () => {
    const game = towed(JUMP_PRICE + 3);
    standIn(game, BENCH);
    const bench = offerLike(game, "repair");
    expect(bench?.enabled).toBe(false);
    expect(bench?.why).toBe(`The ${JUMP_PRICE} CR jump comes first.`);

    // The jump itself is never the line that is held back.
    standIn(game, HELM);
    expect(jumpOffer(game)?.enabled).toBe(true);
  });

  it("refuses a hull the account cannot both buy and fly away from", () => {
    const game = towed(SCRAPPER.price + JUMP_PRICE - 1);
    voyageOf(game).hull = undefined;
    expect(offerLike(game, `buy ${hullName(SCRAPPER)}`)?.enabled).toBe(false);
    expect(buyHull(game, SCRAPPER.id).ok).toBe(false);
    expect(voyageOf(game).credits).toBe(SCRAPPER.price + JUMP_PRICE - 1);

    // With the jump paid for on top of the hull, the drone is bought as usual.
    voyageOf(game).credits = SCRAPPER.price + JUMP_PRICE;
    expect(buyHull(game, SCRAPPER.id).ok).toBe(true);
    expect(voyageOf(game).credits).toBe(JUMP_PRICE);
  });

  it("leaves the run somewhere to go after every station has been pressed", () => {
    // The shape of the dead end, driven: buy what can be bought, mend and graft
    // and sell until the list has nothing enabled left on it, and the jump is
    // still affordable at the end of it.
    const game = towed(200);
    voyageOf(game).hull = undefined;
    for (let i = 0; i < 300 && !game.isOver(); i++) {
      const offer = spendable(game);
      if (!offer) break;
      expect(game.playerCommand(offer.cmd).ok).toBe(true);
    }
    if (game.isOver()) return;
    expect(voyageOf(game).credits).toBeGreaterThanOrEqual(JUMP_PRICE);
    standIn(game, HELM);
    expect(jumpOffer(game)?.enabled).toBe(true);
  });

  it("still ends the run when the account is under the cheapest hull", () => {
    // The rule the reserve must not stand in front of: no drone and no money
    // for one is the voyage's own ending (design-doc.md, "Экономика рейса").
    const game = towed(CHEAPEST_HULL.price - 1);
    voyageOf(game).hull = undefined;
    expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    expect(game.status).toBe("dead");
  });

  it("holds nothing back on a hull that is still there to be flown into", () => {
    const game = newGame(4);
    voyageOf(game).credits = 34;
    expect(repair(game, 0).ok || graft(game, 0).ok).toBe(true);
  });
});

/** An enabled station line that costs credits, wherever the drone is standing. */
function spendable(game: RoomGame): ActionOffer<RoomCommand> | undefined {
  for (const station of [BENCH, HELM, "r1", "r2"]) {
    standIn(game, station);
    const offer = gatedOffers(game).find(
      (o) =>
        o.enabled &&
        o.cmd.kind === "act" &&
        o.cmd.verb !== "jump" &&
        o.cmd.verb !== "undock" &&
        o.cmd.verb !== "berth",
    );
    if (offer) return offer;
  }
  return undefined;
}

// ----------------------------------------------------------------- closing in

describe("closing in with the rack jammed", () => {
  const ROOM = `
    TUG -a1- r1
    r1 -d1- r2
    r1: docking
    r2: storage
  `;

  it("swings at the jammer instead of pressing a shot the field refuses", () => {
    // A rack with an EMITTER makes `Tab` shoot — and a jammer in the
    // compartment refuses every module verb before the turn is spent
    // (`systems/jam.ts`). The key would then do nothing at all, for ever, with
    // the one machine that causes it standing in the room.
    const game = gameOn(ROOM);
    give(game, "emitter");
    const jammer = put(game, JAMMER, "r1");

    expect(engage(game, "best")).toEqual({ cmd: { kind: "attack", target: jammer.id } });
    expect(game.playerCommand({ kind: "attack", target: jammer.id }).ok).toBe(true);
  });

  it("still shoots when nothing is jamming the rack", () => {
    const game = gameOn(ROOM);
    give(game, "emitter");
    put(game, HAULER, "r1");
    expect(engage(game, "best")).toEqual({ cmd: { kind: "act", verb: "shoot" } });
  });

  it("never hands back a command the game refuses, on any hull", () => {
    // The contract `Tab` lives by: one press is one turn, and a press that
    // cannot be a turn says so instead of costing the player a key. GHOST is
    // the case that matters — no melee weapon at all, so it shoots in both
    // modes, and both of them are jammed.
    for (const hull of HULLS) {
      const game = gameOn(ROOM);
      game.player.data!.rig = rackOf(hull.id);
      applyDerived(game.player);
      put(game, JAMMER, "r1");
      for (const mode of ["best", "melee"] as const) {
        const result = engage(game, mode);
        if ("stop" in result) continue;
        expect(game.playerCommand(result.cmd).ok, `${hull.name} ${mode}`).toBe(true);
      }
    }
  });
});

/** A hull's own rack, bought at a tug with money enough not to refuse. */
function rackOf(id: (typeof HULLS)[number]["id"]): Rig {
  const game = newGame(11);
  voyageOf(game).hull = undefined;
  voyageOf(game).credits = 500;
  expect(buyHull(game, id).ok).toBe(true);
  return rigOf(game.player)!;
}
