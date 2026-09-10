import { describe, expect, it } from "vitest";
import { Rng, RoomDistance, RoomGame, reachableWithKeys, type Ship } from "@jamrog/engine";
import { seedRange } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { HINT_LINE_KEYS, saidHint } from "../src/content/hints.js";
import { DERELICTS, STARTER_HULLS, buildChartered } from "../src/content/derelicts.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { ZONE_KINDS } from "../src/content/zones.js";
import { machineAboard } from "../src/content/monsters.js";
import {
  TUTORIAL_ID,
  TUTORIAL_SEED,
  TUTORIAL_SPEC,
  TUTORIAL_STEPS,
  isTraining,
  stepDue,
  type TutorialSituation,
} from "../src/content/tutorial.js";
import { POPULATE, roomList, type Body, type ShipSystem } from "../src/systems/populate.js";
import { voyageOf } from "../src/systems/voyage.js";
import { LANGS, setLang, tIn } from "../src/i18n.js";

/**
 * The hull a training run is taught on, and the seven lines it is taught with
 * (docs/tasks/G69-tutorial.md).
 *
 * Two claims, and they need different kinds of proof. The ship is a claim about
 * the generator — six or seven compartments, one machine at the airlock, one
 * locked bulkhead with its key in front of it, three systems, a way home — so
 * it is measured over a hundred draws of the real thing. The chain is a claim
 * about a table of predicates, so it is driven by hand here and by a careful
 * bot in `tests/onboarding.test.ts`, which is where the run of a whole tutorial
 * is flown.
 *
 * The third claim is the quiet one and it is the jam's rule 1: a training run
 * changes nothing about an ordinary one. Nothing carries between runs, so
 * "training" has to be invisible to a voyage that is not one — same itinerary
 * from the second hull on, same fixtures, same numbers.
 */

const SEEDS = seedRange(1, 100);

/** The hull as a sortie draws it: charter flags are empty on the first ship. */
function tutorialShip(seed: number): Ship {
  return buildChartered(TUTORIAL_SPEC, 0, new Rng(seed), { flags: new Set(), shipIndex: 0 }).ship;
}

/** The same hull with the deck's marks turned into machines, bodies and systems. */
function populated(seed: number): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    systems: [POPULATE],
    // The engine's own per-room roll is off, so what is aboard is the class's
    // budget and the deck's — which is the thing being measured.
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: (rng) => buildChartered(TUTORIAL_SPEC, 0, rng, { flags: new Set(), shipIndex: 0 }).ship,
    firstShipId: "1",
  });
}

// ------------------------------------------------------------------ the hull

describe("the training hull is a hull like any other", () => {
  it("is never drawn into an ordinary itinerary", () => {
    // Out of `DERELICTS` on purpose: no voyage can roll it, no balance number
    // moves because it exists, and `tests/content.test.ts`'s sweep over the
    // classes is about the seven a player can actually be sent to.
    expect(DERELICTS.map((d) => d.id)).not.toContain(TUTORIAL_ID);
    expect(TUTORIAL_SPEC.id).toBe(TUTORIAL_ID);
    // The literal `content/cards.ts` pins the bulkhead card on. The card cannot
    // import this file without closing a loop (docs/adr/0003-decoupling.md), so
    // this is what holds the two ends of the string together.
    expect(TUTORIAL_ID).toBe("tutorial");
  });

  it("passes the checks every class of hull has to pass", () => {
    const kinds = new Set(ZONE_KINDS.map((k) => k.kind));
    for (const kind of TUTORIAL_SPEC.kinds) {
      expect(kinds.has(kind), `no compartment kind '${kind}'`).toBe(true);
    }
    for (const id of TUTORIAL_SPEC.band) {
      expect(machineAboard(id) !== undefined, `no machine '${id}'`).toBe(true);
    }
    // A hull with fewer than three system compartments is a hull the run cannot
    // get past — a tutorial that cannot be finished teaches the wrong thing.
    const required = ZONE_KINDS.filter((k) => k.required === true).map((k) => k.kind);
    expect(required.length).toBe(OBJECTIVES.length);
    for (const kind of required) {
      expect(TUTORIAL_SPEC.kinds.includes(kind), `no ${kind}`).toBe(true);
    }
    // Nothing to hide and nothing to catch: the one ship whose contents are all
    // decisions carries no relic crate and no strain of its own.
    expect(TUTORIAL_SPEC.relics ?? []).toEqual([]);
    expect(TUTORIAL_SPEC.strains ?? []).toEqual([]);
    // Sixty for the hull against forty for the next drone: the tutorial pays
    // for its own successor, which is the sentence the last hint says.
    expect(TUTORIAL_SPEC.salePrice).toBe(60);
    expect(TUTORIAL_SPEC.alertStart).toBe(0);
    expect(TUTORIAL_SPEC.machines).toEqual([1, 1]);
  });

  it("draws six or seven compartments with nothing the validator objects to", () => {
    for (const seed of SEEDS) {
      const built = buildChartered(TUTORIAL_SPEC, 0, new Rng(seed), {
        flags: new Set(),
        shipIndex: 0,
      });
      expect(built.problems, `seed ${seed}`).toEqual([]);
      expect(built.ship.rooms.length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      expect(built.ship.rooms.length, `seed ${seed}`).toBeLessThanOrEqual(7);
    }
  });

  it("locks exactly one bulkhead, on every seed, with its key in front of it", () => {
    // The one guarantee the deck is pinned for: drawn by weight this would be
    // one door on average and none or three on some seeds, and a tutorial with
    // no lock has no keycard lesson at all (`content/cards.ts`, `BULKHEAD`).
    for (const seed of SEEDS) {
      const ship = tutorialShip(seed);
      const locked = ship.doors.filter((d) => d.state === "locked");
      expect(locked.length, `seed ${seed}`).toBe(1);
      const key = locked[0]!.key;
      expect(key, `seed ${seed}: a lock with no key`).toBeDefined();
      // In front of it: the compartment holding the card is one the drone can
      // stand in before the door is open.
      const reach = reachableWithKeys(ship).rooms;
      const held = ship.rooms.filter((r) => r.marks.includes(`key:${key!}`));
      expect(held.length, `seed ${seed}`).toBe(1);
      expect(reach.has(held[0]!.id), `seed ${seed}: the key is behind its own door`).toBe(true);
    }
  });

  it("keeps one of each system compartment and a way to all three", () => {
    for (const seed of SEEDS) {
      const ship = tutorialShip(seed);
      for (const kind of ["engineering", "reactor", "control"]) {
        expect(ship.rooms.filter((r) => r.kind === kind).length, `seed ${seed}: ${kind}`).toBe(1);
      }
      // What a drone that can cut may reach: every compartment, and so the way
      // back out of every compartment as well.
      const map = RoomDistance.from(ship, [ship.entry], (d) =>
        ship.passable(d, { breacher: true, isPlayer: true }) && d.state !== "airlock",
      );
      for (const room of ship.rooms) {
        expect(map.at(room.id), `seed ${seed}: ${room.label} is cut off`).toBeLessThan(Infinity);
      }
    }
  });

  it("puts one machine at the airlock, the key on a body, and three systems aboard", () => {
    let atMost = 0;
    for (const seed of seedRange(1, 40)) {
      const game = populated(seed);
      const machines = game.entities.filter((e) => e.id !== game.player.id);
      // The docking bay's own scout: the first thing a run ever meets, and the
      // reason the first two presses are `attack` and `salvage`.
      const entry = game.ship.roomAt(game.ship.entry);
      expect(game.entitiesIn(entry.id).filter((e) => e.id !== game.player.id).length, `seed ${seed}`).toBe(1);
      // The band is one machine wide, so nothing aboard is heavier than a scout
      // — the bulkhead's guard included.
      for (const m of machines) expect(m.name, `seed ${seed}`).toBe("scout");
      // Two by construction — the airlock's and the bulkhead's — and a third
      // only where the armoury card lands on the engineering compartment.
      expect(machines.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(machines.length, `seed ${seed}`).toBeLessThanOrEqual(3);
      atMost = Math.max(atMost, machines.length);

      const systems = game.ship.rooms.flatMap((r) => roomList<ShipSystem>(r, "systems"));
      expect(systems.map((s) => s.kind).sort(), `seed ${seed}`).toEqual(["core", "engine", "terminal"]);

      const keys = game.ship.rooms.flatMap((r) => roomList<Body>(r, "bodies")).filter((b) => b.key !== undefined);
      expect(keys.length, `seed ${seed}: the keycard is not on a body`).toBe(1);
    }
    expect(atMost).toBeLessThanOrEqual(3);
  });
});

// ----------------------------------------------------------------- the chain

/** Nothing has happened yet: the drone is standing on the tug. */
const NOTHING: TutorialSituation = {
  aboard: false,
  turnsAboard: 0,
  contact: false,
  lockedDoor: false,
  system: false,
  atAirlock: false,
  carrying: false,
  sold: false,
};

const said = (...ids: string[]) => (id: string) => ids.includes(id);
const none = () => false;

describe("the seven lines", () => {
  it("has a row in the hint table for every step, and only keys the game owns", () => {
    for (const step of TUTORIAL_STEPS) {
      expect(HINT_LINE_KEYS[step.id as keyof typeof HINT_LINE_KEYS], step.id).toBe(
        `hint.${step.id}`,
      );
    }
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      "tutorial.enter",
      "tutorial.scan",
      "tutorial.contact",
      "tutorial.door",
      "tutorial.system",
      "tutorial.airlock",
      "tutorial.sale",
    ]);
  });

  it("says nothing at all on the tug", () => {
    expect(stepDue(NOTHING, none)).toBeUndefined();
  });

  it("says one line a turn, the table's first when two are owed at once", () => {
    // Aboard, with something in sight and a lock in the wall: three lines are
    // owed and the earliest of them goes first, so the player reads the ship in
    // the order the table lays it out rather than all at once.
    const busy = { ...NOTHING, aboard: true, turnsAboard: 3, contact: true, lockedDoor: true };
    expect(stepDue(busy, none)?.id).toBe("tutorial.enter");
    expect(stepDue(busy, said("tutorial.enter"))?.id).toBe("tutorial.scan");
    expect(stepDue(busy, said("tutorial.enter", "tutorial.scan"))?.id).toBe("tutorial.contact");
  });

  it("lets a line whose moment has not come stand out of the way", () => {
    // Measured, not assumed: on the tutorial seed the drone stands in a system
    // compartment twenty turns before it ever meets the bulkhead. A chain that
    // waited for the lock said nothing for the rest of that run.
    const inSystem = { ...NOTHING, aboard: true, turnsAboard: 9, system: true };
    expect(stepDue(inSystem, said("tutorial.enter", "tutorial.scan", "tutorial.contact"))?.id).toBe(
      "tutorial.system",
    );
  });

  it("says the airlock line only with something aboard to lose", () => {
    const before = said("tutorial.enter", "tutorial.scan", "tutorial.contact", "tutorial.door", "tutorial.system");
    const empty = { ...NOTHING, aboard: true, turnsAboard: 20, atAirlock: true };
    expect(stepDue(empty, before)).toBeUndefined();
    expect(stepDue({ ...empty, carrying: true }, before)?.id).toBe("tutorial.airlock");
  });

  it("says the last line off the ship, when the hull is under tow", () => {
    const before = (id: string) => id !== "tutorial.sale";
    expect(stepDue({ ...NOTHING, sold: false }, before)).toBeUndefined();
    expect(stepDue({ ...NOTHING, sold: true }, before)?.id).toBe("tutorial.sale");
  });

  it("has every line in all three languages", () => {
    const keys = [
      ...TUTORIAL_STEPS.map((s) => `hint.${s.id}`),
      "hint.training",
      "derelict.tutorial",
      ...TUTORIAL_SPEC.flavour.map((_, i) => `flavour.${TUTORIAL_ID}.${i}`),
    ] as const;
    for (const lang of LANGS) {
      for (const key of keys) {
        const line = tIn(lang, key as never);
        expect(line, `${lang}: ${key}`).toBeTruthy();
        expect(line, `${lang}: ${key}`).not.toBe(key);
      }
    }
    // The flavour line reads `{callsign} · {hull} · {first} · {second}`, so a
    // first word equal to the class's own name would print it twice.
    expect(TUTORIAL_SPEC.flavour[0]).not.toBe(TUTORIAL_SPEC.name);
  });
});

// ------------------------------------------------------------------- the run

describe("a training run", () => {
  it("marks the drone, and an ordinary run does not", () => {
    expect(isTraining(newGame(3, true).player)).toBe(true);
    expect(isTraining(newGame(3).player)).toBe(false);
    expect(isTraining(undefined)).toBe(false);
  });

  it("opens on the training hull and keeps the rest of the itinerary", () => {
    for (const seed of seedRange(1, 20)) {
      const plain = voyageOf(newGame(seed)).derelicts.map((d) => d.id);
      const training = voyageOf(newGame(seed, true)).derelicts.map((d) => d.id);
      // One of the five hulls a voyage opens on, whichever this seed drew
      // (`content/derelicts.ts`, `STARTER_HULLS`) — and never the training one.
      expect(STARTER_HULLS.map((h) => h.id), `seed ${seed}`).toContain(plain[0]);
      expect(training[0], `seed ${seed}`).toBe(TUTORIAL_ID);
      // The draw above the swap is the same draw: one seed is one voyage from
      // the second hull on, whichever way the run was started.
      expect(training.slice(1), `seed ${seed}`).toEqual(plain.slice(1));
    }
  });

  it("leaves an ordinary run bit for bit what it was", () => {
    // Rule 1 of the jam: nothing carries between runs. Training is a content
    // pack and a flag on one drone, so a run built after one is the run it
    // would have been had the training run never existed.
    const before = voyageOf(newGame(11));
    newGame(11, true);
    const after = voyageOf(newGame(11));
    expect(after.derelicts.map((d) => d.id)).toEqual(before.derelicts.map((d) => d.id));
    expect(after.credits).toBe(before.credits);
    expect(after.offered.map((c) => c.id)).toEqual(before.offered.map((c) => c.id));
  });

  it("says its opening line and marks nothing as read", () => {
    const game = newGame(TUTORIAL_SEED, true);
    expect(game.log.lines.some((l) => l.key === "hint.training")).toBe(true);
    // The five ordinary hints are the run's to earn: a training hull is a run,
    // not a reading list, so none of them is ticked off before it happens.
    for (const id of ["exposure", "burned", "keycard", "sold", "death"]) {
      expect(saidHint(game.player, id), id).toBe(false);
    }
  });

  it("still answers its win and death lines in the language that is on", () => {
    // The training pack is built on `SALVOR` as a prototype and not spread from
    // it: three of those fields are getters, and a spread would freeze all
    // three to whichever language was on when the run was made.
    const game = newGame(TUTORIAL_SEED, true);
    try {
      setLang("ru");
      const ru = game.content.winLine;
      setLang("es");
      expect(game.content.winLine).not.toBe(ru);
      expect(game.content.deathLine).toBeTruthy();
    } finally {
      setLang("en");
    }
  });
});
