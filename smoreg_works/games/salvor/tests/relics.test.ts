import { describe, it, expect } from "vitest";
import { RoomGame, type RoomCommand } from "@jamrog/engine";
import { BOTS_ROOMS, roomPlay, runBotOn, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import {
  BLOOM_KIND,
  CRAWLER,
  ENFORCER,
  JAMMER,
  MONSTERS,
  SENTRY_TURRET,
} from "../src/content/monsters.js";
import { MODULES, RELICS, isRelic, moduleKind, type ModuleId } from "../src/content/modules.js";
import { GHOST, type Death } from "../src/systems/ghost.js";
import { stationTargets, voyageOf } from "../src/systems/voyage.js";
import {
  RIG,
  addWreck,
  capOf,
  carriedBy,
  findSlot,
  graft,
  hitSlot,
  install,
  makeStartingRig,
  repair,
  rigOf,
  routeDamage,
  setCarried,
  takeFor,
  wreckSource,
  wrecksIn,
  wrecksOn,
  type Rig,
  type Slot,
} from "../src/twist/rig.js";

/**
 * The four things that make a relic a relic (docs/tasks/G66-unique-modules.md),
 * one describe each, plus the one number the owner will judge them by: how
 * often a voyage ever wears one. He played a build with none and did not miss
 * them; a relic nobody meets is a row in a table.
 *
 * Hand-drawn ships and hand-placed crates for the rules, the real game for the
 * measurement. The systems are dropped for the rules the way `salvage.test.ts`
 * drops them: POPULATE would lay the onboarding pile in the first ship of a run
 * and the door system would offer lines this file is not counting.
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

/** A parts crate holding a relic at its base, the way `populate` lays one. */
function crate(game: RoomGame, label: string, kind: ModuleId): number {
  const wreck = addWreck(game, room(game, label), kind, moduleKind(kind).integrity, "X");
  wreck.source = "crate";
  return wreck.id;
}

function swapOffers(game: RoomGame) {
  return RIG.offerActions!(game).filter((o) => o.cmd.kind === "act" && o.cmd.verb === "swap");
}

function snapshot(r: Rig): string {
  return JSON.stringify(r.slots);
}

const PAIR = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking
  r2: cargo
`;

/** Every machine the game has, wherever its row lives (`content.test.ts`). */
const ALL = [...MONSTERS, SENTRY_TURRET, JAMMER, CRAWLER, BLOOM_KIND, ENFORCER];

// ---------------------------------------------------------------- not for sale

describe("a relic cannot be bought", () => {
  it("is on no dock shelf, on any hull, over forty voyages", () => {
    // The shelf is a literal in `systems/voyage.ts`; what the voyage record
    // holds for each hull is what the dock's list reads, so that is what is
    // checked — the literal by proxy, on every hull a run ties up to.
    for (const seed of seedRange(1, 40)) {
      const voyage = voyageOf(newGame(seed));
      expect(voyage.state.length).toBeGreaterThan(0);
      for (const state of voyage.state) {
        expect((state.stock ?? []).some((id) => isRelic(id as ModuleId)), `seed ${seed}`).toBe(false);
      }
    }
  });

  it("carries no price, so nothing can put one on a shelf by default", () => {
    expect(RELICS).toEqual(["blade", "shocker", "lattice"]);
    for (const id of RELICS) expect(MODULES[id].price, id).toBeUndefined();
  });
});

// ------------------------------------------------------------------ not looted

describe("a relic cannot be looted", () => {
  it("is the salvage of no machine in the bestiary", () => {
    for (const machine of ALL) {
      const drop = machine.salvage;
      expect(drop === undefined || !isRelic(drop), `${machine.id} drops ${drop}`).toBe(true);
    }
  });

  it("comes back only off your own dead drone, worn exactly as it was", () => {
    // The ghost wears the rack the drone died in and lays it on the floor
    // where it fell (`systems/ghost.ts`): a relic in that rack is the one relic
    // a hull ever gives up twice, and it is the run's own.
    const SHIP = `
      TUG -a1- r1
      r1 -d1- r2 -d2- r3 -d3- r4 -d4- r5
      r1: docking
      r2: hold
      r3: corridor
      r4: hab
      r5: engineering
    `;
    const TUG = `
      TUG -a2- t1
      t1: deck
    `;
    const game = new RoomGame({
      ...GAME_CONFIG,
      seed: 7,
      systems: [GHOST],
      content: { ...SALVOR, monsterChance: () => 0 },
      firstShip: () => shipFromText(SHIP).ship,
      firstShipId: "1",
    });
    const worn: Rig = makeStartingRig();
    const slots: Array<Slot | null> = worn.slots.map(() => null);
    slots[0] = { kind: "blade", integrity: 9 };
    slots[1] = { kind: "thrusters", integrity: 4 };
    worn.slots = slots;
    const record: Death = { room: room(game, "r5"), rig: worn, shipId: "1" };
    (game.player.data ??= {}).deaths = [record];

    game.travelTo("tug", { generate: () => shipFromText(TUG).ship });
    game.travelTo("1", { generate: () => shipFromText(SHIP).ship });

    const left = wrecksIn(game, room(game, "r5"));
    const blade = left.find((w) => w.kind === "blade");
    expect(blade).toBeDefined();
    expect(blade!.integrity).toBe(9);
    expect(wreckSource(blade!)).toBe("drone");
  });
});

// ------------------------------------------------------------------ the swap

describe("a relic goes into a full rack by throwing a module out", () => {
  it("takes the slot of the module it upgrades in one press, and that module goes into your arms", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    crate(game, "r1", "blade");
    const r = rig(game);
    const cutter = findSlot(r, "cutter")!;

    const swaps = swapOffers(game);
    expect(swaps).toHaveLength(6);
    expect(swaps[0]!.label).toBe("Q-BLADE for CUTTER");
    expect(swaps.every((o) => o.enabled)).toBe(true);
    // No plain salvage line for it: the rack is full, so the choice *is* the line.
    expect(RIG.offerActions!(game).some((o) => o.cmd.kind === "act" && o.cmd.verb === "salvage")).toBe(false);

    const out = game.playerCommand(swaps[0]!.cmd);
    expect(out.ok).toBe(true);
    expect(r.slots[cutter]!.kind).toBe("blade");
    expect(r.slots[cutter]!.integrity).toBe(MODULES.blade.integrity);
    expect(findSlot(r, "cutter")).toBeNull();
    expect(carriedBy(game.player)).toEqual([{ kind: "cutter", integrity: MODULES.cutter.integrity }]);
    expect(wrecksIn(game, room(game, "r1"))).toHaveLength(0);
    // The blade is the drone's swing now: two dice where the cutter had one.
    expect(game.player.damage).toEqual([2, 6, 0]);
    expect(game.log.tail(5).map((m) => m.text)).toContain(
      "A relic: Q-BLADE. No bench mends it, no dock sells it.",
    );
  });

  it("is a plain salvage into an empty slot, when there is one", () => {
    const game = gameOn(PAIR);
    const id = crate(game, "r1", "lattice");
    expect(takeFor(rig(game), "lattice")).toEqual({ kind: "install" });
    expect(swapOffers(game)).toHaveLength(0);

    expect(game.playerCommand({ kind: "act", verb: "salvage", target: id }).ok).toBe(true);
    expect(findSlot(rig(game), "lattice")).toBe(5);
    expect(findSlot(rig(game), "plating")).not.toBeNull();
    expect(carriedBy(game.player)).toEqual([]);
    // Armour twice over: the lattice's flat point is on the drone at once.
    expect(game.player.defense).toBe(1);
  });

  it("lays the displaced module on the floor when the arms are full, never into nothing", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    setCarried(game.player, [{ kind: "emp", integrity: 1 }, { kind: "spike", integrity: 2 }]);
    crate(game, "r1", "blade");

    expect(game.playerCommand(swapOffers(game)[0]!.cmd).ok).toBe(true);
    expect(carriedBy(game.player)).toHaveLength(2);
    const floor = wrecksIn(game, room(game, "r1"));
    expect(floor.map((w) => w.kind)).toEqual(["cutter"]);
    // The drone's own part is sealed as far as the ship's virus goes.
    expect(wreckSource(floor[0]!)).toBe("crate");
  });

  it("offers a relic with nothing to upgrade against the most worn module first", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    const r = rig(game);
    r.slots[findSlot(r, "scanner")!]!.integrity = 1;
    const id = crate(game, "r1", "shocker");

    expect(takeFor(r, "shocker")).toEqual({ kind: "swap", slot: null });
    const swaps = swapOffers(game);
    expect(swaps[0]!.label).toBe("SHOCKER for SCANNER");
    expect(swaps.map((o) => (o.cmd.kind === "act" ? o.cmd.slot : -1))).toHaveLength(6);

    // Nothing to take it into by itself: `salvage` refuses before the turn.
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: id })).toEqual({
      ok: false, cost: 0, reason: "Full rack. Choose what it replaces.",
    });
    expect(game.inputs).toHaveLength(turns);
  });

  it("refuses a second copy of one already in the rack, and offers to carry it instead", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    r.slots[5] = { kind: "blade", integrity: 14 };
    const id = crate(game, "r1", "blade");

    expect(takeFor(r, "blade")).toEqual({ kind: "no", why: "You already carry a Q-BLADE." });
    const offers = RIG.offerActions!(game);
    const salvage = offers.find((o) => o.cmd.kind === "act" && o.cmd.verb === "salvage" && o.cmd.target === id);
    expect(salvage?.enabled).toBe(false);
    expect(offers.some((o) => o.cmd.kind === "act" && o.cmd.verb === "carry" && o.cmd.target === id)).toBe(true);
  });

  it("swaps only a relic, only into a full rack, and only into a slot that holds something", () => {
    const game = gameOn(PAIR);
    const plain = crate(game, "r1", "laser");
    game.playerCommand({ kind: "wait" });
    const turns = game.inputs.length;

    // An ordinary module against a rack with a free slot is a salvage, not a swap.
    expect(game.playerCommand({ kind: "act", verb: "swap", target: plain, slot: 0 })).toEqual({
      ok: false, cost: 0, reason: "There is a free slot: salvage it instead.",
    });
    fillRack(game);
    expect(game.playerCommand({ kind: "act", verb: "swap", target: plain, slot: 0 })).toEqual({
      ok: false, cost: 0, reason: "No free slot. Something has to burn first.",
    });
    const relic = crate(game, "r1", "blade");
    expect(game.playerCommand({ kind: "act", verb: "swap", target: relic, slot: 99 })).toEqual({
      ok: false, cost: 0, reason: "Empty slot.",
    });
    expect(game.playerCommand({ kind: "act", verb: "swap", target: relic })).toEqual({
      ok: false, cost: 0, reason: "Empty slot.",
    });
    expect(game.inputs).toHaveLength(turns);
  });
});

// ------------------------------------------------------------------ not mended

describe("nothing mends a relic", () => {
  it("is skipped by the welder, by scrap and by the graft, and says so", () => {
    const game = gameOn(PAIR);
    const r = rig(game);
    const blade = 5;
    r.slots[blade] = { kind: "blade", integrity: MODULES.blade.integrity };
    // A welder in the cell's slot, so there is something to weld with.
    r.slots[findSlot(r, "cell")!] = { kind: "welder", integrity: 5 };

    hitSlot(r, blade, 3);
    expect(r.slots[blade]!.integrity).toBe(MODULES.blade.integrity - 3);
    const before = snapshot(r);

    expect(repair(r)).toBeUndefined();
    expect(graft(r, blade)).toBeUndefined();
    expect(snapshot(r)).toBe(before);

    const welder = findSlot(r, "welder")!;
    expect(game.playerCommand({ kind: "act", verb: "use", slot: welder })).toEqual({
      ok: false, cost: 0, reason: "Q-BLADE is a relic. Nothing mends it.",
    });
    expect(snapshot(r)).toBe(before);

    // With an ordinary module also worn, the welder mends that one and the
    // relic stays where the blow left it.
    r.slots[findSlot(r, "scanner")!]!.integrity = 2;
    expect(game.playerCommand({ kind: "act", verb: "use", slot: welder }).ok).toBe(true);
    expect(r.slots[findSlot(r, "scanner")!]!.integrity).toBe(3);
    expect(r.slots[blade]!.integrity).toBe(MODULES.blade.integrity - 3);
  });

  it("is greyed at the tug's bench, and the bench refuses in the same words for no turn and no credits", () => {
    // The list and the command say one thing (the shelf's rule of 9.09): a worn
    // relic keeps its repair and graft lines so the player reads why, the
    // lines cannot be pressed, and pressing the command anyway costs nothing.
    const game = newGame(3);
    const r = rig(game);
    const blade = 5;
    r.slots[blade] = { kind: "blade", integrity: MODULES.blade.integrity - 4 };
    const credits = voyageOf(game).credits;
    const turns = game.inputs.length;
    const why = "Q-BLADE is a relic. Nothing mends it.";

    for (const verb of ["repair", "graft"] as const) {
      const line = stationTargets(game, verb).find((o) => o.cmd.kind === "act" && o.cmd.slot === blade);
      expect(line, verb).toBeDefined();
      expect(line!.enabled, verb).toBe(false);
      expect(line!.why, verb).toBe(why);

      const out = game.playerCommand({ kind: "act", verb, slot: blade });
      expect(out.ok, verb).toBe(false);
      expect(out.cost, verb).toBe(0);
      expect(out.reason, verb).toBe(why);
    }
    expect(game.inputs).toHaveLength(turns);
    expect(voyageOf(game).credits).toBe(credits);
    expect(r.slots[blade]!.integrity).toBe(MODULES.blade.integrity - 4);
    // An ordinary worn module on the same rack is still the bench's to mend.
    r.slots[0]!.integrity = 1;
    const cutter = stationTargets(game, "repair").find((o) => o.cmd.kind === "act" && o.cmd.slot === 0);
    expect(cutter?.enabled).toBe(true);
  });

  it("wears out like any other slot, and burns out of it for good", () => {
    const r = makeStartingRig();
    r.slots[5] = { kind: "lattice", integrity: MODULES.lattice.integrity };
    r.exposed = 5;
    const first = routeDamage(r, 10);
    expect(first.hits[0]).toMatchObject({ slot: 5, kind: "lattice", amount: 10, remaining: 20 });
    expect(capOf(r.slots[5]!)).toBe(MODULES.lattice.integrity);

    const last = routeDamage(r, 20);
    expect(last.hits[0]).toMatchObject({ slot: 5, kind: "lattice", burned: true });
    expect(r.slots[5]).toBeNull();
    expect(r.scars[5]).toBe("lattice");
    expect(r.burned).toContain("lattice");
  });
});

// ------------------------------------------------------------------ charges

describe("a coil keeps its charges off the rack", () => {
  it("through the tug's hold: stowed spent, fitted spent — and the EMP the same", () => {
    // The old EMP loophole, closed in the one place it lived: the hold and the
    // arms remember charges, so taking a coil off and putting it back is not a
    // recharge for the shocker or for anything else that spends them.
    const game = newGame(3);
    const r = rig(game);
    const slot = install(r, "emp", 3)!;
    r.slots[slot]!.charges = 0;

    expect(game.playerCommand({ kind: "act", verb: "stow", slot }).ok).toBe(true);
    const held = voyageOf(game).hold.find((h) => h.kind === "emp");
    expect(held).toEqual({ kind: "emp", integrity: 3, charges: 0 });

    const fit = stationTargets(game, "fit").find((o) => o.label.includes("EMP"))!;
    expect(fit.enabled).toBe(true);
    expect(game.playerCommand(fit.cmd).ok).toBe(true);
    expect(r.slots[findSlot(r, "emp")!]!.charges).toBe(0);
    expect(voyageOf(game).hold.some((h) => h.kind === "emp")).toBe(false);
  });

  it("through the drone's arms and the floor: a swapped-out shocker is as spent as it was", () => {
    const game = gameOn(PAIR);
    fillRack(game);
    const r = rig(game);
    r.slots[5] = { kind: "shocker", integrity: 8, charges: 1 };
    const first = crate(game, "r1", "blade");
    expect(game.playerCommand({ kind: "act", verb: "swap", target: first, slot: 5 }).ok).toBe(true);
    expect(carriedBy(game.player)).toEqual([{ kind: "shocker", integrity: 8, charges: 1 }]);

    // Arms full, the next one lies on the floor with its count on it; picked
    // up again by `salvage`, it comes back onto the rack at that count.
    setCarried(game.player, [{ kind: "emp", integrity: 1 }, { kind: "spike", integrity: 2 }]);
    r.slots[0] = { kind: "shocker", integrity: 8, charges: 2 };
    const second = crate(game, "r1", "lattice");
    expect(game.playerCommand({ kind: "act", verb: "swap", target: second, slot: 0 }).ok).toBe(true);
    const pile = wrecksIn(game, room(game, "r1")).find((w) => w.kind === "shocker")!;
    expect(pile.charges).toBe(2);

    r.slots[1] = null;
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: pile.id }).ok).toBe(true);
    expect(r.slots[1]).toEqual({ kind: "shocker", integrity: 8, charges: 2 });
    // A crate, on the other hand, is factory-sealed: full charges.
    r.slots[1] = null;
    const sealed = crate(game, "r1", "shocker");
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: sealed }).ok).toBe(true);
    expect(r.slots[1]!.charges).toBe(MODULES.shocker.charges);
  });
});

// ------------------------------------------------------------ how often met

describe("how often a careful voyage ever wears one", () => {
  it("puts a relic on the rack in at least fifteen voyages of a hundred", () => {
    // The owner's complaint was not that relics were weak but that he never
    // saw one. Measured on the same bot and the same seeds `winnable.test.ts`
    // counts wins on, and printed so that a balance pass can read it.
    const seeds = seedRange(1, 200);
    let worn = 0;
    let lying = 0;
    let wins = 0;
    for (const seed of seeds) {
      let game: SalvorGame | undefined;
      let wore = false;
      const result = runBotOn(
        BOTS_ROOMS.careful!,
        seed,
        roomPlay({
          maxSteps: 1500,
          make: (s) => {
            game = newGame(s);
            const play = game.playerCommand.bind(game);
            game.playerCommand = (cmd: RoomCommand) => {
              const out = play(cmd);
              if (!wore && rigOf(game!.player)?.slots.some((slot) => slot !== null && isRelic(slot.kind))) {
                wore = true;
              }
              return out;
            };
            return game;
          },
        }),
      );
      if (wore) worn++;
      if (result.status === "won") wins++;
      const left = game!.ships.ids().some((id) => {
        const ship = game!.ships.get(id)!.ship;
        return ship.rooms.some((r) => wrecksOn(ship, r.id).some((w) => isRelic(w.kind)));
      });
      if (!wore && left) lying++;
    }
    console.log(
      `relics   runs=${seeds.length} worn=${((worn / seeds.length) * 100).toFixed(0)}% ` +
        `left lying=${((lying / seeds.length) * 100).toFixed(0)}% wins=${wins}`,
    );
    expect(worn / seeds.length).toBeGreaterThanOrEqual(0.15);
  });
});
