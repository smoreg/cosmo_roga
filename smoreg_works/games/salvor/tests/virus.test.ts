import { describe, it, expect } from "vitest";
import {
  RoomGame,
  TURN_COST,
  dealDamage,
  replayRooms,
  spawnMonsterIn,
  type Entity,
  type RoomCommand,
  type RoomGameConfig,
  type System,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { FREIGHTER, QUARANTINE, type DerelictSpec } from "../src/content/derelicts.js";
import { moduleKind, type ModuleId } from "../src/content/modules.js";
import { LEASH, LEECH, ROT, SPASM, type StrainId } from "../src/content/viruses.js";
import { addWreck, findSlot, rigOf, type Rig, type WreckSource } from "../src/twist/rig.js";
import { voyageOf } from "../src/systems/voyage.js";
import { t } from "../src/i18n.js";
import { panelBlocks } from "../src/ui/panel.js";
import {
  CURE_TURNS,
  SPREAD_TURNS,
  TWITCH_NOISE,
  TWITCH_PERIOD,
  VIRUS,
  VIRUS_HINT_KEY,
  infectChance,
  tryInfect,
  virusOf,
  type VirusState,
} from "../src/systems/virus.js";

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
 * half of the same stand-in: the starting rack has no WELDER, and a replay can
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
      fitWelder(game);
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

/** The starting rack carries no WELDER; a purge needs one in the empty slot. */
function fitWelder(game: RoomGame): number {
  const r = rig(game);
  const i = r.slots.findIndex((s) => s === null);
  r.slots[i] = { kind: "welder", integrity: moduleKind("welder").integrity };
  return i;
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

  it("goes with the module when that module burns out", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    infect(game, cell);

    rig(game).slots[cell] = null;
    rig(game).scars[cell] = "cell";
    game.playerCommand({ kind: "wait" });
    expect(virusOf(game.player)).toBeUndefined();
    expect(said(game, "The virus goes with the burned module.")).toBe(1);
  });
});

describe("the purge", () => {
  it("takes two turns in a row and leaves the module exactly as damaged", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    fitWelder(game);
    rig(game).slots[cell]!.integrity = 2;
    infect(game, cell);

    const first = game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(first.ok).toBe(true);
    expect(virusOf(game.player)).toBeDefined();
    expect(virus(game).curing?.left).toBe(CURE_TURNS - 1);

    const second = game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(second.ok).toBe(true);
    expect(virusOf(game.player)).toBeUndefined();
    expect(said(game, "The purge takes. Your CELL is clean.")).toBe(1);
    // Two turns bought with time, and nothing else: no integrity comes back.
    expect(rig(game).slots[cell]!.integrity).toBe(2);
  });

  it("is broken off by anything else, and has to start again", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    fitWelder(game);
    infect(game, cell);

    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    game.playerCommand({ kind: "wait" });
    expect(said(game, "You break off the purge.")).toBe(1);
    expect(virus(game).curing).toBeUndefined();

    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(virusOf(game.player)).toBeDefined();
    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(virusOf(game.player)).toBeUndefined();
  });

  it("is refused without a WELDER, and costs no turn", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    infect(game, cell);
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("No WELDER in the rack.");
    expect(game.inputs.length).toBe(turns);
    expect(virusOf(game.player)).toBeDefined();
  });

  it("is refused on a clean module, and on a clean rack", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    fitWelder(game);

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
  it("offers the purge, greyed out until there is a welder to do it with", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    expect(VIRUS.offerActions?.(game)).toEqual([]);

    const cell = slotOf(game, "cell");
    infect(game, cell);
    const greyed = VIRUS.offerActions?.(game) ?? [];
    expect(greyed).toHaveLength(1);
    expect(greyed[0]!.label).toBe(`purge CELL (welder, ${CURE_TURNS} turns)`);
    expect(greyed[0]!.enabled).toBe(false);
    expect(greyed[0]!.why).toBe("No WELDER in the rack.");

    fitWelder(game);
    const offer = (VIRUS.offerActions?.(game) ?? [])[0]!;
    expect(offer.enabled).toBe(true);
    expect(offer.cmd).toEqual({ kind: "act", verb: "cure", slot: cell });
  });

  it("counts the purge down, the same way a system splice does", () => {
    // A bot reading `offerActions` cannot tell a job in progress from a job
    // that never started if the line comes back unchanged — the one thing
    // `systems/ship.ts`'s `work ENGINE (2 turns)` already gets right
    // (docs/tasks/G30-balance-v2.md, "Хуже стало одно…").
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    fitWelder(game);
    infect(game, cell);

    const label = () => (VIRUS.offerActions?.(game) ?? [])[0]!.label;
    expect(label()).toBe(`purge CELL (welder, ${CURE_TURNS} turns)`);

    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(label()).toBe("purge CELL (welder, 1 turn)");

    // Broken off, and the line resets to the full count rather than staying at
    // one: the next purge is a fresh job, not a continuation of the old one.
    game.playerCommand({ kind: "wait" });
    expect(label()).toBe(`purge CELL (welder, ${CURE_TURNS} turns)`);
  });

  it("names the infected module in the panel, in the bad colour", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    expect(VIRUS.panelLines?.(game)).toEqual([]);

    infect(game, slotOf(game, "cell"));
    expect(VIRUS.panelLines?.(game)).toEqual([{ text: "SPASM in CELL", fg: "#d96a6a" }]);
  });

  it("explains itself once a run, however often the rack catches it", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const cell = slotOf(game, "cell");
    fitWelder(game);
    infect(game, cell);
    expect(said(game, t(VIRUS_HINT_KEY))).toBe(1);

    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    infect(game, slotOf(game, "plating"));
    expect(virusOf(game.player)).toBeDefined();
    expect(said(game, t(VIRUS_HINT_KEY))).toBe(1);
  });
});

describe("a run with a virus in it replays bit for bit", () => {
  it("comes back with the same log, the same rack and the same clock", () => {
    const cfg = configOn(PAIR, [VIRUS, infector("ghost", 0.15)]);
    const game = new RoomGame({ ...cfg, seed: 11 });
    const cell = findSlot(rigOf(game.player)!, "cell")!;
    game.playerCommand({ kind: "act", verb: "fit" });

    // Salvage until one piece of it is carrying something, then live with it
    // for a while and weld it out.
    for (let tries = 0; tries < 40 && !virusOf(game.player); tries++) infect(game, cell);
    expect(virusOf(game.player)).toBeDefined();
    for (let turn = 0; turn < TWITCH_PERIOD + 1; turn++) game.playerCommand({ kind: "wait" });
    expect(said(game, "Your CELL twitches. SPASM picked where the blow lands.")).toBe(1);
    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    game.playerCommand({ kind: "act", verb: "cure", slot: cell });
    expect(virusOf(game.player)).toBeUndefined();

    const inputs: RoomCommand[] = game.inputs.slice();
    const again = replayRooms(11, inputs, cfg);
    expect(again.inputs).toEqual(inputs);
    expect(again.log.lines.map((l) => l.text)).toEqual(game.log.lines.map((l) => l.text));
    expect(rigOf(again.player)).toEqual(rigOf(game.player));
    expect(virusOf(again.player)).toBeUndefined();
  });

  it("replays the clock itself when the rack is the same on both sides", () => {
    const cfg = configOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const script: RoomCommand[] = [
      { kind: "act", verb: "infect", slot: 4 },
      ...Array.from({ length: TWITCH_PERIOD + 3 }, (): RoomCommand => ({ kind: "wait" })),
    ];
    const first = replayRooms(5, script, cfg);
    const second = replayRooms(5, script, cfg);

    expect(virusOf(second.player)).toEqual(virusOf(first.player));
    expect(rigOf(second.player)).toEqual(rigOf(first.player));
    expect(second.log.lines.map((l) => l.text)).toEqual(first.log.lines.map((l) => l.text));
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
describe("salvage, as the way a virus comes aboard", () => {
  /** A hull with one pile of scrap in it and a rack with a slot to spare. */
  const SCRAPYARD = `
    TUG -a1- r1
    r1 -d1- r2
    r1: docking
    r2: workshop
  `;

  function scrapyard(seed: number, source: WreckSource | undefined): RoomGame {
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed,
      systems: [VIRUS],
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(SCRAPYARD).ship,
      firstShipId: "1",
    });
    // An empty slot to pull it into, and something to pull.
    const spare = rig(game).slots.findIndex((s) => s === null);
    expect(spare).toBeGreaterThanOrEqual(0);
    const wreck = addWreck(game, game.player.room!, "welder", 2, source === "crate" ? "X" : "%");
    if (source !== undefined) wreck.source = source;
    return game;
  }

  function salvageHere(game: RoomGame): void {
    expect(game.playerCommand({ kind: "act", verb: "salvage" }).ok).toBe(true);
  }

  it("never infects out of a sealed crate, over a thousand of them", () => {
    let infected = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const game = scrapyard(seed, "crate");
      salvageHere(game);
      if (virusOf(game.player)) infected++;
    }
    expect(infected).toBe(0);
  });

  it("infects out of a ghost's rack about a quarter of the time", () => {
    let infected = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const game = scrapyard(seed, "ghost");
      salvageHere(game);
      if (virusOf(game.player)) infected++;
    }
    expect(infected / 1000).toBeGreaterThan(0.2);
    expect(infected / 1000).toBeLessThan(0.3);
  });

  it("treats a pile nobody recorded as the ship's own machinery", () => {
    let infected = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const game = scrapyard(seed, undefined);
      salvageHere(game);
      if (virusOf(game.player)) infected++;
    }
    expect(infected / 1000).toBeGreaterThan(0.05);
    expect(infected / 1000).toBeLessThan(0.16);
  });

  it("adds the quarantine hull's fifteen points to whatever it was", () => {
    // Through the real generator and the real undock, because the bonus is the
    // hull's own field and nothing but `specOfShip` connects the two.
    let plain = 0;
    let quarantined = 0;
    for (let seed = 1; seed <= 200; seed++) {
      plain += onHull(FREIGHTER, seed) ? 1 : 0;
      quarantined += onHull(QUARANTINE, seed) ? 1 : 0;
    }
    expect(quarantined).toBeGreaterThan(plain);
  });

  /** One drone, one hull of that class, one pile of a ghost's scrap salvaged. */
  function onHull(spec: DerelictSpec, seed: number): boolean {
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed,
      systems: [hullOf(spec), ...(GAME_CONFIG.systems ?? [])],
    });
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    game.entities = [game.player];
    const spare = rig(game).slots.findIndex((s) => s === null);
    if (spare < 0) return false;
    addWreck(game, game.player.room!, "welder", 2).source = "ghost";
    const out = game.playerCommand({ kind: "act", verb: "salvage" });
    return out.ok && virusOf(game.player) !== undefined;
  }

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

  it("marks the module on the panel and welds it clean on the drone's own turn", () => {
    const game = scrapyard(1, "ghost");
    const slot = fitWelder(game);
    tryInfect(game, slot, "ghost", CERTAIN_BONUS);
    expect(virus(game).slot).toBe(slot);

    const marked = panelBlocks(game, []).find((l) => l.text.startsWith(`${slot + 1} `))!;
    expect(marked.text).toContain("!");

    // Welding it is welding: the WELDER is what a blow would land on.
    expect(game.playerCommand({ kind: "act", verb: "cure", slot }).ok).toBe(true);
    expect(rig(game).exposed).toBe(findSlot(rig(game), "welder"));
    expect(game.playerCommand({ kind: "act", verb: "cure", slot }).ok).toBe(true);
    expect(virusOf(game.player)).toBeUndefined();
  });
});

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

  it("takes the module with it when the rot finishes the job", () => {
    const game = gameOn(PAIR, [VIRUS, infector(CERTAIN, CERTAIN_BONUS)]);
    const slot = findSlot(rig(game), "scanner")!;
    const points = rig(game).slots[slot]!.integrity;
    strainOn(game, slot, "rot");

    wait(game, ROT.period * points + 1);
    expect(rig(game).slots[slot]).toBe(null);
    // The burned-module path is the same one a blow takes, so the virus goes
    // with it and the rack carries the scar.
    expect(virusOf(game.player)).toBeUndefined();
    expect(rig(game).scars[slot]).toBe("scanner");
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
