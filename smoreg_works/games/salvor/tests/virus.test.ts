import { describe, it, expect } from "vitest";
import { RoomGame, TURN_COST, dealDamage, spawnMonsterIn, type Entity, type RoomGameConfig, type System } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";

import { moduleKind, type ModuleId } from "../src/content/modules.js";
import { LEASH, LEECH, ROT, SPASM, type StrainId } from "../src/content/viruses.js";
import { findSlot, rigOf, type Rig, type WreckSource } from "../src/twist/rig.js";
import { voyageOf } from "../src/systems/voyage.js";

import { CURE_TURNS, SPIKE_CURE_TURNS, SPREAD_TURNS, TWITCH_NOISE, TWITCH_PERIOD, VIRUS, harmLine, infectChance, tryInfect, turnsToBeat, turnsToSpread, virusHint, type VirusState, virusOf } from "../src/systems/virus.js";

/**
 * The virus on a hand-drawn ship. Same twist and same content pack the UI
 * plays; only the graph is written out and the machines are placed by hand, so
 * a test about a twitching module is never about a spawn roll.
 *
 * The rest of the systems are dropped for the reason the rig's own tests drop
 * them: POPULATE lays an onboarding pile in the first ship of a run whatever
 * the fixture holds, and ALERT would answer the noise this file is measuring.
 */
function gameOn(text: string, systems: Array<System<RoomGame>>, seed = 7): RoomGame {
  return new RoomGame({ ...configOn(text, systems), seed });
}

function configOn(text: string, systems: Array<System<RoomGame>>): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    systems,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  };
}

/**
 * Where `salvage` will call `tryInfect` once the rig is wired up.
 *
 * Standing in for that call site as a verb of its own keeps every test below on
 * the real turn cycle — a command, a turn spent, a roll out of the run's own
 * stream — while the twist stays untouched by this task. `fit` is the other
 * half of the same stand-in: the starting rack has no SPIKE, and a replay can
 * only match if the module got there through a command rather than by hand.
 */
function infector(source: WreckSource, bonus = 0): System<RoomGame> {
  return {
    name: "test-infector",
    performCommand(game, actor, cmd) {
      if (actor.id !== game.player.id || cmd.kind !== "act") return undefined;
      if (cmd.verb === "infect") {
        tryInfect(game, cmd.slot ?? 0, source, bonus);
        return { ok: true, cost: TURN_COST };
      }
      if (cmd.verb !== "fit") return undefined;
      fitSpike(game);
      return { ok: true, cost: TURN_COST };
    },
  };
}

/** A source that always takes, for the tests that are about what happens after. */
const CERTAIN: WreckSource = "ghost";
const CERTAIN_BONUS = 1;

function rig(game: RoomGame): Rig {
  return rigOf(game.player)!;
}

function virus(game: RoomGame): VirusState {
  const v = virusOf(game.player);
  if (!v) throw new Error("the drone is not infected");
  return v;
}

function slotOf(game: RoomGame, kind: ModuleId): number {
  const i = findSlot(rig(game), kind);
  if (i === null) throw new Error(`no ${kind} in the rack`);
  return i;
}

/** A module of this kind in the first empty slot. */
function fit(game: RoomGame, kind: ModuleId): number {
  const r = rig(game);
  const i = r.slots.findIndex((s) => s === null);
  r.slots[i] = { kind, integrity: moduleKind(kind).integrity };
  return i;
}

/** The starting rack carries no SPIKE; the fast purge needs one in the empty slot. */
function fitSpike(game: RoomGame): number {
  return fit(game, "spike");
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

function infect(game: RoomGame, slot: number): void {
  game.playerCommand({ kind: "act", verb: "infect", slot });
}

function said(game: RoomGame, text: string): number {
  return game.log.lines.filter((l) => l.text === text).length;
}

function room(game: RoomGame, label: string): number {
  return game.ship.room(label).id;
}

/** Two compartments and an open door: enough for a sound to lose a point. */
const PAIR = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking
  r2: cargo
`;

/** The same, welded shut: whatever is in r2 stays in r2. */
const SEALED = `
  TUG -a1- r1
  r1 -#d1#- r2
  r1: docking
  r2: cargo
`;

describe("what salvage is worth risking", () => {
  it("prices each source out of the design doc", () => {
    expect(infectChance("machine")).toBeCloseTo(0.1);
    expect(infectChance("drone")).toBeCloseTo(0.15);
    expect(infectChance("ghost")).toBeCloseTo(0.25);
    // A rival is somebody else's rack, which is the same kind of thing as your
    // own wreck rather than something the ship grew.
    expect(infectChance("rival")).toBeCloseTo(0.15);
  });

  it("adds the hull's own bonus: a ghost on a quarantine ship is 40 %", () => {
    expect(infectChance("ghost", 0.15)).toBeCloseTo(0.4);
    expect(infectChance("machine", 0.15)).toBeCloseTo(0.25);
    expect(infectChance("ghost", 1)).toBe(1);
  });

  it("never touches a sealed crate, whatever the hull adds", () => {
    expect(infectChance("crate")).toBe(0);
    expect(infectChance("crate", 0.15)).toBe(0);
  });

  it("a thousand crates leave the rack clean", () => {
    const game = gameOn(PAIR, [VIRUS]);
    const slot = slotOf(game, "cutter");
    let caught = 0;
    for (let i = 0; i < 1000; i++) {
      delete game.player.data!.virus;
      if (tryInfect(game, slot, "crate")) caught++;
    }
    expect(caught).toBe(0);
  });

  it("a thousand ghosts on a quarantine ship land within five points of 40 %", () => {
    const game = gameOn(PAIR, [VIRUS]);
    const slot = slotOf(game, "cutter");
    let caught = 0;
    for (let i = 0; i < 1000; i++) {
      delete game.player.data!.virus;
      if (tryInfect(game, slot, "ghost", 0.15)) caught++;
    }
    expect(caught / 1000).toBeGreaterThan(0.35);
    expect(caught / 1000).toBeLessThan(0.45);
  });

  it("carries one virus at a time: an infected rack is not rolled for again", () => {
    const game = gameOn(PAIR, [VIRUS]);
    const cutter = slotOf(game, "cutter");
    expect(tryInfect(game, cutter, CERTAIN, CERTAIN_BONUS)).toBe(true);
    expect(tryInfect(game, slotOf(game, "cell"), CERTAIN, CERTAIN_BONUS)).toBe(false);
    expect(virus(game).slot).toBe(cutter);
  });

  it("says so once, and names the module", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    infect(game, cell);
    expect(virus(game).slot).toBe(cell);
    expect(said(game, "The scrap carries something. SPASM in your CELL.")).toBe(1);
  });
});

describe("the twitch", () => {
  it("comes on the eighth turn and puts its own module under the blow", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    const plating = slotOf(game, "plating");
    infect(game, cell);

    for (let turn = 1; turn <= TWITCH_PERIOD; turn++) {
      game.playerCommand({ kind: "wait" });
      // Waiting is what the twist marks PLATING for; the virus overrules it
      // only on its own turn.
      expect(rig(game).exposed).toBe(turn === TWITCH_PERIOD ? cell : plating);
    }
    expect(said(game, "Your CELL twitches. SPASM picked where the blow lands.")).toBe(1);
  });

  it("does it whatever the drone was doing", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    const thrusters = slotOf(game, "thrusters");
    const door = game.ship.doorsOf(room(game, "r1")).find((d) => d.state === "open")!;
    infect(game, cell);

    for (let turn = 1; turn <= TWITCH_PERIOD; turn++) {
      game.playerCommand({ kind: "go", door: door.id });
      expect(rig(game).exposed).toBe(turn === TWITCH_PERIOD ? cell : thrusters);
    }
  });

  it("keeps its beat: every eighth turn, not once", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    infect(game, slotOf(game, "cell"));
    // Two beats, and short of the twenty turns that would move it on.
    for (let turn = 1; turn <= TWITCH_PERIOD * 2; turn++) game.playerCommand({ kind: "wait" });
    expect(said(game, "Your CELL twitches. SPASM picked where the blow lands.")).toBe(2);
    expect(virus(game).turns).toBe(TWITCH_PERIOD * 2);
  });

  it("is what a machine's blow lands on, through the twist's own routing", () => {
    // Sealed, so the machine is a source for the blow and never a second one:
    // this test is about where damage goes, not about who threw it.
    const game = gameOn(SEALED, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    const plating = slotOf(game, "plating");
    const machine = put(game, "r2", "maintenance-bot");
    infect(game, cell);
    for (let turn = 1; turn < TWITCH_PERIOD; turn++) game.playerCommand({ kind: "wait" });

    const before = rig(game).slots[cell]!.integrity;
    const armour = rig(game).slots[plating]!.integrity;
    game.playerCommand({ kind: "wait" });
    dealDamage(game, game.player, 2, machine);
    // Waiting marks PLATING; on this one turn the virus marked the CELL, and
    // the chain starts where the marker is.
    expect(rig(game).slots[cell]!.integrity).toBe(before - 2);
    expect(rig(game).slots[plating]!.integrity).toBe(armour);
  });

  it("is heard six rooms-worth loud, on the turn it happens", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    infect(game, slotOf(game, "cell"));
    for (let turn = 1; turn < TWITCH_PERIOD; turn++) {
      game.playerCommand({ kind: "wait" });
      expect(game.noise.get(room(game, "r1")) ?? 0).toBe(0);
    }

    game.playerCommand({ kind: "wait" });
    expect(game.noise.get(room(game, "r1"))).toBe(TWITCH_NOISE);
    // One open door costs a point, which is `propagateRooms`' own rule.
    expect(game.noise.get(room(game, "r2"))).toBe(TWITCH_NOISE - 1);
  });
});

describe("what it does if nobody cleans it", () => {
  it("crawls into the next intact module after twenty turns, skipping the gaps", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const r = rig(game);
    const cell = slotOf(game, "cell");
    const cutter = slotOf(game, "cutter");
    const thrusters = slotOf(game, "thrusters");
    // Slot 5 was never filled and the CUTTER burned: the two the virus has to
    // step over on its way round the rack.
    r.slots[cutter] = null;
    r.scars[cutter] = "cutter";

    infect(game, cell);
    for (let turn = 1; turn < SPREAD_TURNS; turn++) {
      game.playerCommand({ kind: "wait" });
      expect(virus(game).slot).toBe(cell);
    }

    game.playerCommand({ kind: "wait" });
    expect(virus(game).slot).toBe(thrusters);
    expect(said(game, "The virus leaves your CELL for your THRUSTERS.")).toBe(1);
  });

  it("restarts its beat in the module it moved into", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    infect(game, slotOf(game, "cell"));
    for (let turn = 1; turn <= SPREAD_TURNS; turn++) game.playerCommand({ kind: "wait" });

    const moved = virus(game).slot;
    for (let turn = 1; turn < TWITCH_PERIOD; turn++) game.playerCommand({ kind: "wait" });
    expect(said(game, "Your CUTTER twitches. SPASM picked where the blow lands.")).toBe(0);
    game.playerCommand({ kind: "wait" });
    expect(said(game, "Your CUTTER twitches. SPASM picked where the blow lands.")).toBe(1);
    expect(virus(game).slot).toBe(moved);
  });

  it("stays put when there is nothing else left in the rack", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const r = rig(game);
    const cell = slotOf(game, "cell");
    for (let i = 0; i < r.slots.length; i++) if (i !== cell) r.slots[i] = null;

    infect(game, cell);
    for (let turn = 1; turn <= SPREAD_TURNS + 2; turn++) game.playerCommand({ kind: "wait" });
    expect(virus(game).slot).toBe(cell);
  });
});

describe("the purge", () => {

  it("by hand is hands-on work: the PLATING, and never a WELDER, is what a blow finds", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    fit(game, "welder");
    infect(game, cell);

    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(rig(game).exposed).toBe(slotOf(game, "plating"));
  });

  it("is quiet: two points of noise a turn, where the welding it replaced was five", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    infect(game, cell);
    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    game.playerCommand({ kind: "wait" });
    // `makeNoise` is heard on the next settle, which the wait is.
    expect(game.noise.get(room(game, "r1")) ?? 0).toBeLessThanOrEqual(2);
  });

  it("is refused on a clean module, and on a clean rack", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");

    expect(game.playerCommand({ kind: "act", verb: "cure", slot: cell }).reason).toBe(
      "Nothing in the rack is infected.",
    );
    infect(game, cell);
    expect(game.playerCommand({ kind: "act", verb: "cure", slot: slotOf(game, "plating") }).reason).toBe(
      "That module is clean.",
    );
  });
});

describe("what the player is told", () => {
  it("offers the purge whenever the drone is infected, by hand or with a SPIKE", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    expect(VIRUS.offerActions?.(game)).toEqual([]);

    const cell = slotOf(game, "cell");
    infect(game, cell);
    const bare = VIRUS.offerActions?.(game) ?? [];
    expect(bare).toHaveLength(1);
    expect(bare[0]!.label).toBe(`purge CELL (by hand, ${CURE_TURNS} turns)`);
    expect(bare[0]!.enabled).toBe(true);
    expect(bare[0]!.cmd).toEqual({ kind: "act", verb: "cure", slot: cell });

    fitSpike(game);
    const fast = (VIRUS.offerActions?.(game) ?? [])[0]!;
    expect(fast.label).toBe(`purge CELL (SPIKE, ${SPIKE_CURE_TURNS} turns)`);
    expect(fast.enabled).toBe(true);
  });

  it("never mentions a WELDER, in any language the offer or the hint is read in", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    infect(game, slotOf(game, "cell"));
    const label = (VIRUS.offerActions?.(game) ?? [])[0]!.label;
    expect(label).not.toMatch(/weld/i);
    expect(virusHint()).not.toMatch(/weld/i);
    expect(virusHint()).toContain(`${CURE_TURNS} turns, ${SPIKE_CURE_TURNS} with a SPIKE`);
  });

  it("counts the purge down, the same way a system splice does", () => {
    // A bot reading `offerActions` cannot tell a job in progress from a job
    // that never started if the line comes back unchanged — the one thing
    // `systems/ship.ts`'s `work ENGINE (2 turns)` already gets right
    // (docs/tasks/G30-balance-v2.md, "Хуже стало одно…").
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    infect(game, cell);

    const label = () => (VIRUS.offerActions?.(game) ?? [])[0]!.label;
    expect(label()).toBe(`purge CELL (by hand, ${CURE_TURNS} turns)`);

    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(label()).toBe(`purge CELL (by hand, ${CURE_TURNS - 1} turns)`);

    // Broken off, and the line resets to the full count rather than staying
    // where it was: the next purge is a fresh job, not a continuation.
    game.playerCommand({ kind: "wait" });
    expect(label()).toBe(`purge CELL (by hand, ${CURE_TURNS} turns)`);
  });

  it("says what it does in the panel, with its number, in the bad colour", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    expect(VIRUS.panelLines?.(game)).toEqual([]);

    infect(game, slotOf(game, "cell"));
    expect(VIRUS.panelLines?.(game)).toEqual([{ text: "v SPASM: exposes every 8", fg: "#d96a6a" }]);
    expect(harmLine(ROT)).toBe("v ROT: -1 integrity every 5");
    expect(harmLine(LEECH)).toBe("v LEECH: -5 CR every 12");
    expect(harmLine(LEASH)).toBe("v LEASH: -1 core every 18");
  });

  it("counts to its next beat and to its crawl the way the tick does", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    infect(game, slotOf(game, "cell"));
    expect(turnsToBeat(game, virus(game))).toBe(TWITCH_PERIOD);
    expect(turnsToSpread(game, virus(game))).toBe(SPREAD_TURNS);
    wait(game, TWITCH_PERIOD - 1);
    expect(turnsToBeat(game, virus(game))).toBe(1);
    wait(game, 1);
    expect(said(game, "Your CELL twitches. SPASM picked where the blow lands.")).toBe(1);
    expect(turnsToBeat(game, virus(game))).toBe(TWITCH_PERIOD);
    expect(turnsToSpread(game, virus(game))).toBe(SPREAD_TURNS - TWITCH_PERIOD);
    virus(game).strain = "rot";
    expect(turnsToSpread(game, virus(game))).toBeUndefined();
  });
});

// ------------------------------------------------------------ the real thing

/**
 * The one call site the mechanic hangs off, wired up: salvage.
 *
 * Everything above stands in for it with a verb of its own, so that the clock,
 * the twitch and the purge can be tested a case at a time. This is the part
 * that cannot be: a module really pulled out of a real wreck, on a hull whose
 * class says how likely the thing is to be carrying something.
 */

// ------------------------------------------------------------------ strains

/**
 * Put a named strain on the drone. The strain a hull carries is the hull's own
 * (`DerelictSpec.strains`) and a hand-drawn fixture has no hull, so it comes
 * out `spasm` — which is what every test above is about. These four are about
 * the other three, so the strain is written on after the fact rather than
 * fished for with a seed.
 */
function strainOn(game: RoomGame, slot: number, id: StrainId): void {
  infect(game, slot);
  virus(game).strain = id;
}

/** Turns of standing still. Nothing else in the fixture moves. */
function wait(game: RoomGame, turns: number): void {
  for (let n = 0; n < turns; n++) game.playerCommand({ kind: "wait" });
}

describe("the strains", () => {
  it("rots the module it sits in, a point at a beat", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const slot = findSlot(rig(game), "plating")!;
    const before = rig(game).slots[slot]!.integrity;
    strainOn(game, slot, "rot");

    wait(game, ROT.period);
    expect(rig(game).slots[slot]!.integrity).toBe(before - 1);
    // And it never moves: a strain eating one module has nowhere better to be.
    wait(game, SPASM.spread);
    expect(virus(game).slot).toBe(slot);
  });

  it("skims the account and never takes it below nothing", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    voyageOf(game).credits = 12;
    strainOn(game, findSlot(rig(game), "plating")!, "leech");

    wait(game, LEECH.period);
    expect(voyageOf(game).credits).toBe(12 - 5);
    wait(game, LEECH.period);
    expect(voyageOf(game).credits).toBe(2);
    // Two more beats with two credits on the account: it takes the two and
    // then finds nothing, rather than running the account negative.
    wait(game, LEECH.period * 2);
    expect(voyageOf(game).credits).toBe(0);
  });

  it("goes for the core, and three beats is a drone", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const full = game.player.hp;
    expect(full).toBe(3);
    strainOn(game, findSlot(rig(game), "plating")!, "leash");

    wait(game, LEASH.period);
    expect(game.player.hp).toBe(full - 1);
    // Straight at the core: the rack is untouched, which is what makes this the
    // one strain a purge is worth dropping everything for.
    expect(rig(game).burnedCount).toBe(0);

    wait(game, LEASH.period * 2);
    expect(game.player.hp).toBe(0);
    expect(game.player.alive).toBe(false);
  });
});
