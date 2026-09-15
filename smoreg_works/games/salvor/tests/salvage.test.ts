import { describe, it, expect } from "vitest";
import { Rng, RoomGame, replayRooms, spawnMonsterIn, type Entity, type RoomCommand } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { MONSTERS, machineByName } from "../src/content/monsters.js";
import { MAX_GRAFT, MODULES, SCRAP_INTEGRITY, moduleKind } from "../src/content/modules.js";
import { DOORS } from "../src/systems/doors.js";
import { buyHull, VOYAGE, voyageOf } from "../src/systems/voyage.js";
import {
  RIG,
  addWreck,
  capOf,
  carriedBy,
  findSlot,
  graft,
  hostilesIn,
  install,
  rigOf,
  takeFor,
  wreckAt,
  wrecksIn,
  type Rig,
} from "../src/twist/rig.js";

/**
 * Salvage on a hand-drawn ship. Same content pack and same twist the UI plays;
 * only the graph is written out, and the machines and the wreckage are placed
 * by hand so a test about wreckage is never about a spawn roll.
 *
 * That is also why the systems are dropped: POPULATE lays the onboarding pile
 * in the first ship of a run whatever its docking bay rolled, and here that is
 * one more wreck in a room the test is counting.
 */
function gameOn(text: string, seed = 7): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    systems: [],
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  });
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

function rig(game: RoomGame): Rig {
  return rigOf(game.player)!;
}

function room(game: RoomGame, label: string): number {
  return game.ship.room(label).id;
}

/** The starting rack has exactly one empty slot; fill it to make the rack full. */
function fillRack(game: RoomGame): void {
  const r = rig(game);
  for (let i = 0; i < r.slots.length; i++) {
    if (!r.slots[i]) r.slots[i] = { kind: "welder", integrity: 3 };
  }
}

/** Swing until the machine in this compartment is scrap. */
function killHere(game: RoomGame, machine: Entity): void {
  for (let i = 0; i < 40 && machine.alive; i++) {
    game.playerCommand({ kind: "attack", target: machine.id });
  }
  expect(machine.alive).toBe(false);
}

const PAIR = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking cover
  r2: cargo
`;

describe("a dead machine leaves its module in the compartment", () => {
  it("drops the wreck named by the bestiary, at the scrap integrity", () => {
    const game = gameOn(PAIR);
    const bot = put(game, "r1", "maintenance-bot");
    killHere(game, bot);

    const wrecks = wrecksIn(game, room(game, "r1"));
    expect(wrecks).toHaveLength(1);
    const wreck = wrecks[0]!;
    expect(wreck.kind).toBe(machineByName("maintenance bot")!.salvage);
    expect(wreck.integrity).toBeGreaterThanOrEqual(SCRAP_INTEGRITY[0]);
    expect(wreck.integrity).toBeLessThanOrEqual(SCRAP_INTEGRITY[1]);
    expect(wreck.glyph).toBe("%");
    expect(wreck.id).toBeGreaterThan(0);
    expect(game.log.tail(20).map((m) => m.text)).toContain(
      "Maintenance bot dies. Scrap: PLATING.",
    );
  });

  it("leaves it where the machine stood, not where the drone did", () => {
    const game = gameOn(PAIR);
    const target = put(game, "r2", "feral-drone");
    target.hp = 1;
    install(rig(game), "emitter", 3);

    game.playerCommand({ kind: "act", verb: "shoot" });
    expect(wrecksIn(game, room(game, "r2"))).toHaveLength(1);
    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(0);
  });

  it("keeps piles apart: two machines dying here leave two wrecks with two ids", () => {
    const game = gameOn(PAIR);
    const first = addWreck(game, room(game, "r1"), "scanner", 2);
    const second = addWreck(game, room(game, "r1"), "emp", 1, "X");

    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(2);
    expect(second.id).not.toBe(first.id);
    expect(wreckAt(game, room(game, "r1"), second.id)).toEqual({
      id: second.id, kind: "emp", integrity: 1, glyph: "X",
    });
  });
});

describe("taking a wreck apart", () => {
  it("puts a module the rack does not carry into the empty slot", () => {
    const game = gameOn(PAIR);
    const wreck = addWreck(game, room(game, "r1"), "welder", 2);
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id });
    expect(out.ok).toBe(true);
    expect(out.cost).toBe(100);
    expect(game.inputs).toHaveLength(turns + 1);
    expect(rig(game).slots[5]).toEqual({ kind: "welder", integrity: 2 });
    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(0);
    expect(game.log.tail(20).map((m) => m.text)).toContain(
      `WELDER 2/${MODULES.welder.integrity} off the wreck.`,
    );
  });

  it("exposes the plating and is heard two rooms off: your hands are busy", () => {
    const game = gameOn(PAIR);
    const wreck = addWreck(game, room(game, "r1"), "welder", 2);
    game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id });
    expect(rig(game).exposed).toBe(findSlot(rig(game), "plating"));
    expect(game.noise.get(room(game, "r1"))).toBe(2);
  });

  it("takes the wreck the command names, not the first one lying there", () => {
    const game = gameOn(PAIR);
    addWreck(game, room(game, "r1"), "emp", 1);
    const wanted = addWreck(game, room(game, "r1"), "laser", 2);

    expect(game.playerCommand({ kind: "act", verb: "salvage", target: wanted.id }).ok).toBe(true);
    expect(rig(game).slots[5]!.kind).toBe("laser");
    expect(wrecksIn(game, room(game, "r1")).map((w) => w.kind)).toEqual(["emp"]);
  });

  it("refuses a wreck in another compartment, and costs no turn", () => {
    const game = gameOn(PAIR);
    const far = addWreck(game, room(game, "r2"), "welder", 2);
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "act", verb: "salvage", target: far.id });
    expect(out).toEqual({ ok: false, cost: 0, reason: "There is nothing to take apart here." });
    expect(game.inputs).toHaveLength(turns);
    expect(wrecksIn(game, room(game, "r2"))).toHaveLength(1);
  });

  it("restores what the module gives: a salvaged scanner brings the sight back", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    r.slots[findSlot(r, "scanner")!] = null;
    game.player.sight = 0;
    game.playerCommand({ kind: "wait" });

    const wreck = addWreck(game, room(game, "r1"), "scanner", 2);
    game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id });
    expect(game.player.sight).toBe(1);
  });

  it("costs no turn when the rack is full and the module is nothing it carries", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    for (const s of rig(game).slots) if (s) s.bonus = MAX_GRAFT;
    const wreck = addWreck(game, room(game, "r1"), "laser", 2);
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    const energy = game.player.energy;

    const out = game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id });
    expect(out).toEqual({ ok: false, cost: 0, reason: "No free slot. Something has to burn first." });
    expect(game.log.tail(5).map((m) => m.text)).toContain("No free slot. Something has to burn first.");
    expect(game.inputs).toHaveLength(turns);
    expect(game.player.energy).toBe(energy);
    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(1);
  });
});

describe("grafting: scrap on a module the rack already carries", () => {
  it("needs no slot and raises both the ceiling and the integrity", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    const cutter = findSlot(rig(game), "cutter")!;
    const base = moduleKind("cutter").integrity;
    rig(game).slots[cutter]!.integrity = base - 2;
    const wreck = addWreck(game, room(game, "r1"), "cutter", 2);

    expect(game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id }).ok).toBe(true);
    const slot = rig(game).slots[cutter]!;
    expect(slot.bonus).toBe(1);
    expect(capOf(slot)).toBe(base + 1);
    expect(slot.integrity).toBe(base - 1);
    expect(game.log.tail(5).map((m) => m.text)).toContain(
      `Grafted: CUTTER ${base - 1}/${base + 1}.`,
    );
  });

  it("stops at two over base and turns into a plain repair after that", () => {
    const game = gameOn(PAIR);
    const cutter = findSlot(rig(game), "cutter")!;
    const base = moduleKind("cutter").integrity;

    for (let i = 0; i < MAX_GRAFT; i++) {
      const wreck = addWreck(game, room(game, "r1"), "cutter", 2);
      expect(game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id }).ok).toBe(true);
    }
    expect(capOf(rig(game).slots[cutter]!)).toBe(base + MAX_GRAFT);
    expect(rig(game).slots[cutter]!.integrity).toBe(base + MAX_GRAFT);

    rig(game).slots[cutter]!.integrity = base;
    const third = addWreck(game, room(game, "r1"), "cutter", 3);
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: third.id }).ok).toBe(true);
    expect(capOf(rig(game).slots[cutter]!)).toBe(base + MAX_GRAFT);
    expect(rig(game).slots[cutter]!.integrity).toBe(base + 1);
    expect(game.log.tail(5).map((m) => m.text)).toContain(
      `Scrap into CUTTER: ${base + 1}/${base + MAX_GRAFT}.`,
    );
  });

  it("says the same thing before the turn as it does after it", () => {
    const r = rig(gameOn(PAIR));
    expect(takeFor(r, "cutter").kind).toBe("graft");
    expect(takeFor(r, "welder").kind).toBe("install");
    install(r, "welder", 2);
    expect(takeFor(r, "laser")).toEqual({ kind: "no", why: "No free slot. Something has to burn first." });
  });

  it("refuses, before the turn, a module already whole at the graft ceiling", () => {
    const r = rig(gameOn(PAIR));
    const cutter = findSlot(r, "cutter")!;
    graft(r, cutter);
    graft(r, cutter);
    expect(takeFor(r, "cutter")).toEqual({ kind: "no", why: "Nothing left to graft." });
  });

  it("three salvages of the same kind: a point, a second point, then nothing left", () => {
    const game = gameOn(PAIR);
    const cutter = findSlot(rig(game), "cutter")!;
    const base = moduleKind("cutter").integrity;

    const first = addWreck(game, room(game, "r1"), "cutter", 2);
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: first.id }).ok).toBe(true);
    expect(rig(game).slots[cutter]).toEqual({ kind: "cutter", integrity: base + 1, bonus: 1 });

    const second = addWreck(game, room(game, "r1"), "cutter", 2);
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: second.id }).ok).toBe(true);
    expect(rig(game).slots[cutter]).toEqual({ kind: "cutter", integrity: base + 2, bonus: 2 });

    // Whole, and already at the ceiling: a third wreck of the same kind does
    // nothing to it, and does not fall back to bolting a second CUTTER into
    // the rack's one empty slot either.
    const before = { ...rig(game).slots[cutter]! };
    const turns = game.inputs.length;
    const third = addWreck(game, room(game, "r1"), "cutter", 3);

    const out = game.playerCommand({ kind: "act", verb: "salvage", target: third.id });
    expect(out).toEqual({ ok: false, cost: 0, reason: "Nothing left to graft." });
    expect(game.inputs).toHaveLength(turns);
    expect(rig(game).slots[cutter]).toEqual(before);
    expect(rig(game).slots[5]).toBeNull();
    expect(wrecksIn(game, room(game, "r1"))).toEqual([third]);
  });
});

describe("grafting outlives a sortie, and dies with the drone", () => {
  it("keeps a graft through a trip to another ship and back", () => {
    const game = gameOn(PAIR);
    const cutter = findSlot(rig(game), "cutter")!;
    graft(rig(game), cutter);
    graft(rig(game), cutter);
    const grafted = { ...rig(game).slots[cutter]! };
    expect(grafted).toEqual({ kind: "cutter", integrity: moduleKind("cutter").integrity + MAX_GRAFT, bonus: MAX_GRAFT });

    // Design-doc.md, "Наращивание модулей обломками": "Наращённое живёт, пока
    // живёт дрон." The rack is the drone's own, not the ship's, so a sortie
    // that leaves this hull and comes back to it — same drone throughout —
    // changes nothing about what is bolted to it.
    game.travelTo("2", { generate: () => shipFromText(PAIR).ship, reason: "custom" });
    game.travelTo("1", { generate: () => shipFromText(PAIR).ship, reason: "custom" });
    expect(rig(game).slots[cutter]).toEqual(grafted);
  });

  it("is gone the moment the drone is: a fresh hull off the rails carries no graft", () => {
    const game = gameOn(PAIR);
    const cutter = findSlot(rig(game), "cutter")!;
    graft(rig(game), cutter);
    graft(rig(game), cutter);
    voyageOf(game).credits = 100;

    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);
    expect(rig(game).slots.every((s) => s === null)).toBe(true);

    expect(buyHull(game, "scrapper").ok).toBe(true);
    const fresh = rig(game).slots[findSlot(rig(game), "cutter")!]!;
    expect(fresh.bonus ?? 0).toBe(0);
    expect(fresh.integrity).toBe(moduleKind("cutter").integrity);
  });
});

describe("wreckage belongs to the ship", () => {
  it("is still there when the drone comes back aboard", () => {
    const game = gameOn(PAIR);
    const wreck = addWreck(game, room(game, "r1"), "laser", 2);

    game.travelTo("2", { generate: () => shipFromText(PAIR).ship, reason: "custom" });
    expect(wrecksIn(game, game.roomOf(game.player).id)).toHaveLength(0);

    game.travelTo("1", { generate: () => shipFromText(PAIR).ship, reason: "custom" });
    expect(wrecksIn(game, room(game, "r1"))).toEqual([wreck]);
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: wreck.id }).ok).toBe(true);
  });

  it("numbers every pile once per ship", () => {
    const game = gameOn(PAIR);
    const ids = [
      addWreck(game, room(game, "r1"), "laser", 2).id,
      addWreck(game, room(game, "r2"), "emp", 1).id,
      addWreck(game, room(game, "r2"), "spike", 1).id,
    ];
    expect(new Set(ids).size).toBe(3);
  });
});

// ------------------------------------------------------------ the action list

describe("the numbered action list", () => {
  it("names every machine here, then what lies in the room, then cover", () => {
    const game = gameOn(PAIR);
    const bot = put(game, "r1", "maintenance-bot");
    const wreck = addWreck(game, room(game, "r1"), "thrusters", 2);

    const offers = RIG.offerActions!(game);
    expect(offers.map((o) => o.label)).toEqual([
      "attack maintenance bot 4/4",
      "salvage THRUSTERS 2/12",
      // Cover is only worth offering with nothing in the room to see it.
      ...[],
    ]);
    expect(offers[0]!.cmd).toEqual({ kind: "attack", target: bot.id });
    expect(offers[1]!.cmd).toEqual({ kind: "act", verb: "salvage", target: wreck.id });

    bot.alive = false;
    expect(RIG.offerActions!(game).map((o) => o.label)).toEqual(["salvage THRUSTERS 2/12", "hide"]);
  });

  it("offers the shot only with an emitter and something to shoot", () => {
    const game = gameOn(PAIR);
    expect(RIG.offerActions!(game).some((o) => o.label.startsWith("shoot"))).toBe(false);

    const target = put(game, "r2", "security-unit");
    install(rig(game), "emitter", 3);
    expect(RIG.offerActions!(game).map((o) => o.label)).toContain("shoot security unit");

    target.alive = false;
    expect(RIG.offerActions!(game).some((o) => o.label.startsWith("shoot"))).toBe(false);
  });

  it("greys out salvage the rack cannot take, and says why", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    for (const s of rig(game).slots) if (s) s.bonus = MAX_GRAFT;
    addWreck(game, room(game, "r1"), "laser", 2);

    const offer = RIG.offerActions!(game).find((o) => o.label.startsWith("salvage"))!;
    expect(offer.enabled).toBe(false);
    expect(offer.why).toBe("No free slot. Something has to burn first.");
  });

  it("greys out salvage of a module already whole at the ceiling, and says why", () => {
    const game = gameOn(PAIR);
    const cutter = findSlot(rig(game), "cutter")!;
    graft(rig(game), cutter);
    graft(rig(game), cutter);
    addWreck(game, room(game, "r1"), "cutter", 2);

    const offer = RIG.offerActions!(game).find((o) => o.label.startsWith("salvage"))!;
    expect(offer.enabled).toBe(false);
    expect(offer.why).toBe("Nothing left to graft.");
  });

  it("does not offer cover to a drone something is already looking at", () => {
    const game = gameOn(PAIR);
    expect(RIG.offerActions!(game).map((o) => o.label)).toContain("hide");
    put(game, "r1", "scout");
    expect(RIG.offerActions!(game).map((o) => o.label)).not.toContain("hide");
  });

  /**
   * The one property the list must have: it is the truth. A number a player
   * presses does what the line says, and a greyed-out line refuses without
   * taking the turn — otherwise the bots (E14) measure a different game from
   * the one a human plays.
   */
  it("offers exactly what the game accepts, over a thousand states", () => {
    let enabled = 0;
    let refused = 0;

    // Twice over: once with the rack the drone undocks with, and once with a
    // rack that is full and grafted to the ceiling, where every wreck on the
    // ship is a line the player may not press.
    for (const stuffed of [false, true]) {
      for (let seed = 0; seed < 20; seed++) {
        const game = newGame(seed);
        // Nothing lies about at home: a run starts on the tug since G19, and
        // the rack has nothing to take apart until the drone is aboard a hull.
        expect(game.playerCommand({ kind: "act", verb: "undock" }).ok, `seed ${seed}`).toBe(true);
        const rng = new Rng(seed * 31 + 7);
        if (stuffed) {
          fillRack(game);
          for (const s of rig(game).slots) if (s) s.bonus = MAX_GRAFT;
        }

        for (let step = 0; step < 40 && game.status === "playing"; step++) {
          const offers = RIG.offerActions!(game);

          for (const offer of offers.filter((o) => !o.enabled)) {
            const turns = game.inputs.length;
            const out = game.playerCommand(offer.cmd);
            expect(out.ok, `${offer.label} on seed ${seed}`).toBe(false);
            expect(out.cost).toBe(0);
            expect(game.inputs).toHaveLength(turns);
            expect(offer.why).toBeTruthy();
            refused++;
          }

          const live = offers.filter((o) => o.enabled);
          if (live.length === 0) {
            game.playerCommand(randomCommand(game, rng));
            continue;
          }
          const pick = rng.pick(live);
          const out = game.playerCommand(pick.cmd);
          expect(out.ok, `${pick.label} on seed ${seed}`).toBe(true);
          enabled++;
        }
      }
    }

    expect(enabled).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------- relics

describe("a relic against a full rack", () => {
  /** A blade in a crate, at its base, the way `populate` lays one. */
  function bladeCrate(game: RoomGame, label: string): number {
    const wreck = addWreck(game, room(game, label), "blade", MODULES.blade.integrity, "X");
    wreck.source = "crate";
    return wreck.id;
  }

  it("is six lines of one verb, the cutter first, and one press does the swap", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    const id = bladeCrate(game, "r1");
    const r = rig(game);

    const swaps = RIG.offerActions!(game).filter((o) => o.cmd.kind === "act" && o.cmd.verb === "swap");
    expect(swaps).toHaveLength(6);
    expect(swaps[0]!.label).toBe("Q-BLADE for CUTTER");
    expect(swaps[0]!.cmd).toEqual({ kind: "act", verb: "swap", target: id, slot: findSlot(r, "cutter") });
    // Every line is aimed at a different slot, and every slot is on the list.
    const slots = swaps.map((o) => (o.cmd.kind === "act" ? o.cmd.slot : undefined)).sort();
    expect(slots).toEqual([0, 1, 2, 3, 4, 5]);

    const cutter = findSlot(r, "cutter")!;
    const turns = game.inputs.length;
    expect(game.playerCommand(swaps[0]!.cmd).ok).toBe(true);
    expect(game.inputs).toHaveLength(turns + 1);
    expect(r.slots[cutter]!.kind).toBe("blade");
    expect(carriedBy(game.player)).toEqual([{ kind: "cutter", integrity: MODULES.cutter.integrity }]);
    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(0);
    // Picking a crate up is hands-on work: the plating is what was risked.
    expect(r.exposed).toBe(findSlot(r, "plating"));
    expect(game.log.tail(5).map((m) => m.text)).toContain("Q-BLADE in, CUTTER out and into your arms.");
  });

  it("is a cutter to a welded bulkhead", () => {
    // `systems/doors.ts` asks the rack whether it carries a cutter; the blade
    // answers for one (`findSlotAs`), so the one door a drone without a cutter
    // cannot pass is a door a blade opens.
    const SEALED = `
      TUG -a1- r1
      r1 -#d1#- r2
      r1: docking
      r2: cargo
    `;
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed: 7,
      systems: [DOORS],
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(SEALED).ship,
      firstShipId: "1",
    });
    const r = rig(game);
    const door = game.ship.door("d1").id;
    const cut = () =>
      DOORS.offerActions!(game).find(
        (o) => o.cmd.kind === "act" && o.cmd.verb === "cut" && o.cmd.target === door,
      );

    r.slots[findSlot(r, "cutter")!] = null;
    expect(cut()).toBeUndefined();
    expect(game.playerCommand({ kind: "act", verb: "cut", target: door }).ok).toBe(false);

    r.slots[0] = { kind: "blade", integrity: MODULES.blade.integrity };
    expect(cut()?.enabled).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "cut", target: door }).ok).toBe(true);
    // And it is the blade that was put under the next blow, not a cutter that is not there.
    expect(r.exposed).toBe(0);
  });
});

// -------------------------------------------------------------------- replay

function randomCommand(game: RoomGame, rng: Rng): RoomCommand {
  const here = game.roomOf(game.player).id;
  const roll = rng.int(0, 8);
  if (roll === 0) return { kind: "wait" };
  if (roll === 1) return { kind: "hide" };
  if (roll === 2) return { kind: "act", verb: "use", slot: rng.int(0, 5) };
  if (roll === 3) {
    const wrecks = wrecksIn(game, here);
    return wrecks.length === 0
      ? { kind: "act", verb: "salvage" }
      : { kind: "act", verb: "salvage", target: rng.pick(wrecks).id };
  }
  if (roll <= 5) {
    const foes = hostilesIn(game, here);
    if (foes.length > 0) return { kind: "attack", target: rng.pick(foes).id };
  }
  const doors = game.ship.doorsOf(here).filter((d) => d.state !== "airlock");
  return doors.length === 0 ? { kind: "wait" } : { kind: "go", door: rng.pick(doors).id };
}

describe("replay", () => {
  it("reproduces a sortie that salvaged, ship and rack alike", () => {
    const seed = 31337;
    const first = newGame(seed);
    const rng = new Rng(9001);
    for (let i = 0; i < 300 && first.status === "playing"; i++) {
      first.playerCommand(randomCommand(first, rng));
    }

    const again = replayRooms(seed, [...first.inputs], GAME_CONFIG);
    expect(rigOf(again.player)).toEqual(rigOf(first.player));
    // Every pile, every id, every door the sortie left open.
    expect(again.ship.toJSON()).toEqual(first.ship.toJSON());
    expect(again.player.hp).toBe(first.player.hp);
    expect(again.status).toBe(first.status);
    expect(again.schedule.time).toBe(first.schedule.time);
  });
});
