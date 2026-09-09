import { describe, it, expect } from "vitest";
import {
  RoomGame,
  isAlive,
  rememberRoom,
  spawnMonsterIn,
  type Entity,
  type Twist,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { BLOOM_KIND, CRAWLER, ENFORCER, JAMMER, MONSTERS, SENTRY_TURRET } from "../src/content/monsters.js";
import { moduleKind, type ModuleId } from "../src/content/modules.js";
import { BLOOM } from "../src/systems/bloom.js";
import { DOORS } from "../src/systems/doors.js";
import { JAM, jammed } from "../src/systems/jam.js";
import { roomList, type RoomItem } from "../src/systems/populate.js";
import { capOf, findSlot, rigOf, wrecksIn, type Rig } from "../src/twist/rig.js";

/**
 * The four machines a hull class brings: the turret that never moves, the
 * jammer that turns the rack off, the crawler that eats through armour and the
 * bloom that keeps making more of them.
 *
 * Hand-drawn ships and hand-placed machines throughout, and the systems named
 * one at a time: every question below is "who can see whom through which door",
 * and none of it should depend on a spawn roll or on the alert waking something
 * up in the middle of the count.
 */

/** Three compartments in a row, every door open. */
const LINE = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3
  r1: docking
  r2: corridor
  r3: armory
`;

/** The same, with the first door already shut. */
const SHUT = `
  TUG -a1- r1
  r1 -(d1)- r2 -d2- r3
  r1: docking
  r2: corridor
  r3: armory
`;

/** Somewhere the brood cannot follow: a sealed bulkhead is a wall without a cutter. */
const SEALED = `
  TUG -a1- r1
  r1 -#d1#- r2
  r1: docking
  r2: quarantine
`;

function gameOn(text: string, systems: Array<Twist<RoomGame>> = [], seed = 7): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    systems,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  });
}

function put(game: RoomGame, room: string, kind = SENTRY_TURRET): Entity {
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

function wait(game: RoomGame, turns: number): void {
  for (let i = 0; i < turns; i++) game.playerCommand({ kind: "wait" });
}

function rig(game: RoomGame): Rig {
  return rigOf(game.player)!;
}

/** What is left of one module, by kind. Zero once it has burned out. */
function left(game: RoomGame, kind: ModuleId): number {
  const r = rig(game);
  const i = findSlot(r, kind);
  return i === null ? 0 : r.slots[i]!.integrity;
}

/** Everything the drone still has: hit points plus every point in the rack. */
function intact(game: RoomGame): number {
  return game.player.hp + rig(game).slots.reduce((sum, s) => sum + (s?.integrity ?? 0), 0);
}

function loot(game: RoomGame): number {
  const v = game.player.data?.loot;
  return typeof v === "number" ? v : 0;
}

function doorId(game: RoomGame, label: string): number {
  const door = game.ship.doors.find((d) => d.label === label);
  if (!door) throw new Error(`no door '${label}'`);
  return door.id;
}

// ------------------------------------------------------------------- turret

describe("the sentry turret holds one door and nothing else", () => {
  it("never moves, even ordered at a drone it cannot reach", () => {
    const game = gameOn(LINE);
    const turret = put(game, "r3");
    // The standing order the alert hands a reinforcement: walk to that room.
    // Everything else aboard obeys it; this one has no verb for it.
    rememberRoom(turret, game.roomOf(game.player).id);
    const post = turret.room;

    wait(game, 100);

    expect(turret.room).toBe(post);
    expect(game.player.hp, "two doors is out of its reach as well").toBe(game.player.hpMax);
  });

  it("is the only thing given that order that stays put: a brute walks it", () => {
    const game = gameOn(LINE);
    const brute = put(game, "r3", MONSTERS.find((m) => m.id === "security-unit")!);
    rememberRoom(brute, game.roomOf(game.player).id);

    wait(game, 20);

    expect(brute.room, "the fixture allows walking; the turret simply does not").not.toBe(
      game.ship.room("r3").id,
    );
  });

  it("shoots into the next compartment through an open door", () => {
    const game = gameOn(LINE);
    put(game, "r2");
    const before = intact(game);

    wait(game, 2);

    expect(intact(game)).toBeLessThan(before);
    expect(game.log.lines.some((l) => l.text.includes("PLATING"))).toBe(true);
  });

  it("does not shoot through a closed one", () => {
    const game = gameOn(SHUT);
    put(game, "r2");
    const before = intact(game);

    wait(game, 20);

    expect(intact(game)).toBe(before);
  });

  it("stops the moment the drone pulls the door shut", () => {
    const game = gameOn(LINE, [DOORS]);
    put(game, "r2");

    const before = intact(game);
    wait(game, 2);
    const hurt = intact(game);
    expect(hurt).toBeLessThan(before);

    const out = game.playerCommand({ kind: "act", verb: "close", target: doorId(game, "d1") });
    expect(out.ok).toBe(true);

    wait(game, 20);
    expect(intact(game), "a shut door cuts the line of fire in both directions").toBe(hurt);
  });
});

// ------------------------------------------------------------------- jammer

describe("the jammer switches the rack off while it stands next to you", () => {
  const scanner = (game: RoomGame): number => findSlot(rig(game), "scanner")!;

  it("refuses `use` without costing the turn", () => {
    const game = gameOn(LINE, [JAM]);
    put(game, "r1", JAMMER);
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "act", verb: "use", slot: scanner(game) });

    expect(out).toEqual({ ok: false, cost: 0, reason: "Static. Nothing responds." });
    expect(game.inputs).toHaveLength(turns);
    expect(jammed(game)).toBe(true);
  });

  it("says so on the panel, and only while it is standing there", () => {
    const game = gameOn(LINE, [JAM]);
    expect(JAM.panelLines?.(game)).toEqual([]);

    const jammer = put(game, "r1", JAMMER);
    expect(JAM.panelLines?.(game)?.map((l) => l.text)).toEqual(["JAMMED"]);

    jammer.hp = 0;
    expect(JAM.panelLines?.(game)).toEqual([]);
  });

  it("does nothing from the next compartment", () => {
    const game = gameOn(LINE, [JAM]);
    put(game, "r2", JAMMER);

    expect(jammed(game)).toBe(false);
    expect(game.playerCommand({ kind: "act", verb: "use", slot: scanner(game) }).ok).toBe(true);
  });

  it("does nothing once it is dead", () => {
    const game = gameOn(LINE, [JAM]);
    const jammer = put(game, "r1", JAMMER);
    jammer.hp = 0;

    expect(jammed(game)).toBe(false);
    expect(game.playerCommand({ kind: "act", verb: "use", slot: scanner(game) }).ok).toBe(true);
  });
});

// ------------------------------------------------------------------ crawler

describe("the crawler eats through armour rather than around it", () => {
  it("is tagged for it in the bestiary", () => {
    expect(CRAWLER.tags).toContain("corrosive");
    expect(CRAWLER.salvage, "biology leaves no module").toBeUndefined();
  });

  it("puts the whole blow into the exposed module and never touches an intact PLATING", () => {
    const game = gameOn(LINE);
    put(game, "r2", CRAWLER);
    const plating = capOf(rig(game).slots[findSlot(rig(game), "plating")!]!);

    // Walking through the door exposes THRUSTERS, and puts the drone in reach.
    game.playerCommand({ kind: "go", door: doorId(game, "d1") });

    expect(left(game, "thrusters")).toBeLessThan(moduleKind("thrusters").integrity);
    expect(left(game, "plating"), "PLATING is not in a corrosive chain at all").toBe(plating);
  });
});

// -------------------------------------------------------------------- bloom

describe("the bloom is a clock that hatches", () => {
  /** Crawlers this bloom has put out and that are still alive. */
  const brood = (game: RoomGame, hatchery: Entity): Entity[] =>
    game.entities.filter((e) => isAlive(e) && e.data?.hatchedBy === hatchery.id);

  it("hatches one crawler every six of its turns", () => {
    const game = gameOn(SEALED, [BLOOM]);
    const bloom = put(game, "r2", BLOOM_KIND);

    wait(game, 5);
    expect(brood(game, bloom)).toHaveLength(0);

    wait(game, 1);
    expect(brood(game, bloom)).toHaveLength(1);
    expect(brood(game, bloom)[0]!.name).toBe(CRAWLER.name);
    expect(brood(game, bloom)[0]!.room).toBe(bloom.room);
  });

  it("never has more than four of them out at once", () => {
    const game = gameOn(SEALED, [BLOOM]);
    const bloom = put(game, "r2", BLOOM_KIND);

    wait(game, 24);
    expect(brood(game, bloom)).toHaveLength(4);

    wait(game, 60);
    expect(brood(game, bloom), "the cap is the cap, not the pace").toHaveLength(4);
  });

  it("fills the nest back up once the brood is thinned", () => {
    const game = gameOn(SEALED, [BLOOM]);
    const bloom = put(game, "r2", BLOOM_KIND);
    wait(game, 24);

    for (const c of brood(game, bloom)) c.hp = 0;
    game.reapDead();
    expect(brood(game, bloom)).toHaveLength(0);

    wait(game, 6);
    expect(brood(game, bloom)).toHaveLength(1);
  });

  it("stops hatching when it dies", () => {
    const game = gameOn(SEALED, [BLOOM]);
    const bloom = put(game, "r2", BLOOM_KIND);
    wait(game, 6);
    expect(brood(game, bloom)).toHaveLength(1);

    bloom.hp = 0;
    game.reapDead();

    wait(game, 30);
    expect(brood(game, bloom), "a dead hatchery is a corpse, not a slow one").toHaveLength(1);
  });
});

describe("a dead bloom pays in biomass and in nothing else", () => {
  /** The drone standing on the bloom, one blow from killing it. */
  function nest(): { game: RoomGame; bloom: Entity } {
    const game = gameOn(SEALED, [BLOOM]);
    const bloom = put(game, "r1", BLOOM_KIND);
    bloom.hp = 1;
    return { game, bloom };
  }

  it("leaves biomass in the compartment and not one module", () => {
    const { game, bloom } = nest();

    game.playerCommand({ kind: "attack", target: bloom.id });

    const room = game.roomOf(game.player);
    expect(roomList<RoomItem>(room, "items").map((i) => i.kind)).toEqual(["biomass"]);
    expect(wrecksIn(game, room.id), "biology drops nothing to bolt on").toHaveLength(0);
  });

  it("is worth two credits, stripped, and costs the turn", () => {
    const { game, bloom } = nest();
    game.playerCommand({ kind: "attack", target: bloom.id });
    const slots = rig(game).slots.filter(Boolean).length;
    const turns = game.inputs.length;
    const room = game.roomOf(game.player);
    const biomass = roomList<RoomItem>(room, "items")[0]!;

    const out = game.playerCommand({ kind: "act", verb: "strip", target: biomass.id });

    expect(out.ok).toBe(true);
    expect(out.cost).toBeGreaterThan(0);
    expect(game.inputs).toHaveLength(turns + 1);
    expect(loot(game)).toBe(2);
    expect(rig(game).slots.filter(Boolean), "still nothing to bolt on").toHaveLength(slots);
    expect(roomList<RoomItem>(room, "items")).toHaveLength(0);
  });

  it("offers the strip by number, and only where biomass is lying", () => {
    const { game, bloom } = nest();
    expect(BLOOM.offerActions?.(game)).toEqual([]);

    game.playerCommand({ kind: "attack", target: bloom.id });

    expect(BLOOM.offerActions?.(game)?.map((o) => o.label)).toEqual(["strip biomass (2 CR)"]);
  });

  it("refuses a strip where there is none, and costs nothing", () => {
    const game = gameOn(SEALED, [BLOOM]);
    const turns = game.inputs.length;

    const out = game.playerCommand({ kind: "act", verb: "strip" });

    expect(out).toEqual({ ok: false, cost: 0, reason: "There is no biomass here." });
    expect(game.inputs).toHaveLength(turns);
  });
});

// ------------------------------------------------------------------- glyphs

describe("the bestiary reads off the schematic", () => {
  /** What `systems/populate.ts` draws in a compartment that is not a machine. */
  const ITEM_GLYPHS = ["%", "X", "†", "*", "&", "E", "O", "T", '"'];

  it("gives every machine its own character", () => {
    const chars = [...MONSTERS, ENFORCER].map((m) => m.ch);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("keeps the four new ones clear of the item glyphs", () => {
    // ENFORCER's `E` is the standing exception: it shares the engine's mark and
    // predates this table (G23). Nothing new may add a second collision.
    for (const machine of [SENTRY_TURRET, JAMMER, CRAWLER, BLOOM_KIND]) {
      expect(ITEM_GLYPHS, machine.name).not.toContain(machine.ch);
    }
  });

  it("keeps the four out of every band roll, so only a card can place them", () => {
    for (const machine of [SENTRY_TURRET, JAMMER, CRAWLER, BLOOM_KIND]) {
      expect(machine.weight, machine.name).toBe(0);
    }
  });
});
