import { describe, it, expect } from "vitest";
import {
  RoomDistance,
  RoomGame,
  isAlive,
  replayRooms,
  spawnMonsterIn,
  type Entity,
  type MonsterKind,
  type RoomContentPack,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import {
  BOTS_ROOMS,
  formatSummary,
  runBatchOn,
  roomPlay,
  seedRange,
  shipFromText,
} from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { ENFORCER, MONSTERS, type Machine } from "../src/content/monsters.js";
import { ALERT, HUNTER_LEVEL, alertState, raiseAlert } from "../src/systems/alert.js";
import { install, rigOf } from "../src/twist/rig.js";

/**
 * The ship's alert, on hand-drawn ships rather than on seeds: every question
 * here is "how many doors away" and "who is looking", and both should be
 * readable off four lines of fixture text.
 */

/** A straight run of four compartments. Nothing is explored but the airlock. */
const LINE = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
  r1: docking
  r2: hold
  r3: hab
  r4: reactor
`;

/** The same ship, walked once: the alert may muster into r3 and r4. */
const WALKED = `
  TUG -a1- r1
  r1 -(d1)- r2 -(d2)- r3 -(d3)- r4
  r1: docking explored
  r2: hold explored
  r3: hab explored
  r4: reactor explored
`;

/** Somewhere to hide, and a machine one open door away. */
const COVER = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
  r1: docking cover
  r2: hold
  r3: hab
  r4: reactor
`;

/** The tug: one compartment with an airlock, and an alert of its own. */
const TUG = `
  TUG -a2- t1
  t1: deck
`;

/**
 * A machine that never gets a turn — speed 1 against the drone's 100 is one
 * action per hundred, and `static` does nothing with it. Every count below is
 * about how often the ship sends something, not about pathfinding.
 */
const INERT: Machine = {
  id: "inert", name: "inert hulk", ch: "h", fg: "#8b95a0", hp: 1, damage: [1, 1, 0], defense: 0,
  speed: 1, fovRadius: 1, behaviour: "static", sight: 0, minDepth: 0, maxDepth: 99, weight: 10,
};

function gameOn(text: string, seed = 11, over: Partial<RoomContentPack> = {}): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    content: { ...SALVOR, monsterChance: () => 0, ...over },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
    systems: [ALERT],
  });
}

/** The usual ship for a clock test: empty, and whatever wakes up stays put. */
function quietShip(text: string, seed = 11): RoomGame {
  return gameOn(text, seed, { monstersForDepth: () => [INERT] });
}

function wait(game: RoomGame, turns: number): void {
  for (let i = 0; i < turns; i++) game.playerCommand({ kind: "wait" });
}

function put(game: RoomGame, room: string, kind: MonsterKind, over: Partial<Entity> = {}): Entity {
  const e = Object.assign(spawnMonsterIn(kind, game.ship.room(room).id), over);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

/**
 * An inert stand-in for the hunter, so the ship's one-ENFORCER rule turns every
 * later dispatch into an ordinary reinforcement. The clock tests are about how
 * often the ship answers; what the real hunter does once it is walking has its
 * own block below.
 */
function decoyHunter(game: RoomGame, room: string): Entity {
  return put(game, room, { ...INERT, id: ENFORCER.id, name: ENFORCER.name });
}

function machines(game: RoomGame): Entity[] {
  return game.entities.filter((e) => e.id !== game.player.id && isAlive(e));
}

function enforcers(game: RoomGame): Entity[] {
  return machines(game).filter((e) => e.name === ENFORCER.name);
}

function doorsAway(ship: Ship, from: RoomId, to: RoomId): number {
  return RoomDistance.from(ship, [from], (d) => ship.passable(d, { breacher: true })).at(to);
}

// ------------------------------------------------------------------ the clock

describe("the alert is the ship's clock", () => {
  it("raises every 80 turns on the run's first derelict, and brings nothing with it", () => {
    const game = quietShip(LINE, 4242);
    const st = alertState(game);
    const before = machines(game).length;

    wait(game, 79);
    expect(st.turnsAboard).toBe(79);
    expect(st.level).toBe(0);

    wait(game, 1);
    expect(st.level).toBe(1);
    // A step of the gauge is a step towards the hunter and nothing else
    // (design-doc.md, "Тревога, охотники и как спрятаться"). It used to wake a
    // patrol as well — a spawner outside every budget, worth one to six extra
    // machines over a thirty-turn sortie on a hull whose whole population is
    // three to five, which is why no bot could walk out of the tutorial
    // freighter.
    expect(machines(game).length, "levels one and two cost the drone nothing").toBe(before);
  });

  it("raises every 40 turns on every derelict after it", () => {
    const game = quietShip(LINE, 515);
    game.travelTo("2", { generate: () => shipFromText(LINE).ship });
    const st = alertState(game);
    expect(st.level).toBe(0);

    wait(game, 39);
    expect(st.level).toBe(0);

    wait(game, 1);
    expect(st.turnsAboard).toBe(40);
    expect(st.level).toBe(1);
  });

  it("never goes past 5, and the ship's whole answer is one hunter", () => {
    const game = quietShip(LINE, 31337);
    const st = alertState(game);

    raiseAlert(game, 7);
    expect(st.level).toBe(5);
    expect(machines(game).length, "the ENFORCER of level three, and nothing else").toBe(1);
    expect(enforcers(game).length).toBe(1);

    // The top of the gauge is not a spawner of its own either: what level five
    // buys is a hunter replaced every fifteen turns — the hunter's own block
    // below measures that — and a ship that all knows where the drone is.
    wait(game, 30);
    expect(machines(game).length).toBe(1);
  });

  it("a raise at the top of the gauge costs the ship nothing", () => {
    const game = quietShip(LINE, 64064);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 5);
    expect(st.level).toBe(5);
    const before = machines(game).length;

    // The first derelict's own period is 80 turns; the gauge is already full
    // and the ship's hunter is already out, so the due date passes and nothing
    // at all comes of it.
    wait(game, 79);
    expect(st.turnsAboard).toBe(79);
    expect(machines(game).length).toBe(before);
  });
});

describe("noise raises the alert, but not more than once in ten turns", () => {
  it("a loud compartment counts, a second one three turns later does not", () => {
    const game = quietShip(LINE, 99);
    decoyHunter(game, "r4");
    const st = alertState(game);
    const here = game.roomOf(game.player).id;

    game.makeNoise(here, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsAboard).toBe(1);
    expect(st.level).toBe(1);

    wait(game, 2);
    game.makeNoise(here, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsAboard).toBe(4);
    expect(st.level, "inside the cooldown").toBe(1);

    wait(game, 6);
    game.makeNoise(here, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsAboard).toBe(11);
    expect(st.level, "cooldown expired").toBe(2);
  });

  it("noise under 8 anywhere aboard never counts", () => {
    const game = quietShip(LINE, 1010);
    game.makeNoise(game.roomOf(game.player).id, 7);
    game.playerCommand({ kind: "wait" });
    expect(alertState(game).level).toBe(0);
  });

  it("hears a fight two compartments away, where the drone is not", () => {
    const game = quietShip(LINE, 4711);
    decoyHunter(game, "r4");
    // 9 in r3 arrives in r2 at 8: loud enough, and nowhere near the drone.
    game.makeNoise(game.ship.room("r3").id, 9);
    game.playerCommand({ kind: "wait" });
    expect(alertState(game).level).toBe(1);
  });
});

describe("what the ship sends is dispatched, not dropped on your head", () => {
  it("never closer than two doors, and always told where the drone is", () => {
    for (let s = 0; s < 60; s++) {
      const game = quietShip(LINE, 700000 + s);
      const here = game.roomOf(game.player).id;
      const before = machines(game).length;

      raiseAlert(game, HUNTER_LEVEL);
      const woken = machines(game)[before];
      expect(woken, `seed ${700000 + s}: nothing woke up`).toBeDefined();
      expect(doorsAway(game.ship, here, woken!.room!)).toBeGreaterThanOrEqual(2);
      expect(woken!.data?.targetRoom).toBe(here);
    }
  });

  it("prefers a compartment the drone has already walked", () => {
    // r2 and r3 are both two doors out; only r3 has been stood in.
    for (let s = 0; s < 20; s++) {
      const game = quietShip(
        `
          TUG -a1- r1
          r1 -d1- r2 -d2- r3
          r1 -d3- r4 -d4- r5
          r1: docking
          r3: hab explored
        `,
        3 + s,
      );
      raiseAlert(game, HUNTER_LEVEL);
      const woken = enforcers(game);
      expect(woken.length).toBe(1);
      expect(game.ship.roomAt(woken[0]!.room!).label).toBe("r3");
    }
  });

  it("says where it woke up", () => {
    const game = quietShip(LINE, 2024);
    raiseAlert(game, HUNTER_LEVEL);
    expect(game.log.lines[game.log.lines.length - 1]!.text).toMatch(/^An ENFORCER wakes up in .+\.$/);
  });

  it("skips the dispatch, without throwing, when nowhere aboard is far enough", () => {
    // Every compartment is one door from the drone: there is no safe distance.
    const game = quietShip(
      `
        TUG -a1- r1
        r1 -d1- r2
        r1 -d2- r3
        r1: docking
      `,
      7,
    );
    const before = machines(game).length;
    expect(() => raiseAlert(game, HUNTER_LEVEL)).not.toThrow();
    expect(machines(game).length).toBe(before);
    expect(alertState(game).level, "the gauge still moves").toBe(HUNTER_LEVEL);
  });
});

// ------------------------------------------------------- silence and cover

describe("silence talks the ship down", () => {
  it("fifteen quiet turns cost the ship one level", () => {
    const game = quietShip(LINE, 21);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);

    wait(game, 14);
    expect(st.level).toBe(3);
    wait(game, 1);
    expect(st.level).toBe(2);
    expect(game.log.lines.some((l) => l.text === "The ship stops looking for you.")).toBe(true);
  });

  it("one noisy turn on the fourteenth puts the count back to zero", () => {
    const game = quietShip(LINE, 22);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);

    wait(game, 13);
    game.makeNoise(game.roomOf(game.player).id, 6);
    game.playerCommand({ kind: "wait" });
    expect(st.quietTurns).toBe(0);

    wait(game, 14);
    expect(st.level, "the count started again").toBe(3);
    wait(game, 1);
    expect(st.level).toBe(2);
  });

  it("eight turns are enough in cover", () => {
    const game = quietShip(COVER, 23);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);

    expect(game.playerCommand({ kind: "hide" }).ok).toBe(true);
    expect(game.player.hidden).toBe(true);
    wait(game, 6);
    expect(st.level).toBe(3);
    wait(game, 1);
    expect(st.level, "the hide itself was the first quiet turn").toBe(2);
  });

  it("a machine that can see the drone keeps the count at zero", () => {
    const game = quietShip(COVER, 24);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);
    // A scout sees one compartment out and sees through cover; nailed down so
    // this measures being watched, not being chased.
    put(game, "r2", MONSTERS.find((m) => m.id === "scout")!, { behaviour: "static" });

    wait(game, 20);
    expect(st.quietTurns).toBe(0);
    expect(st.level).toBe(3);
  });

  it("a BAFFLE makes the machine next door stop counting as a witness", () => {
    const game = quietShip(COVER, 25);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);
    put(game, "r2", MONSTERS.find((m) => m.id === "scout")!, { behaviour: "static" });

    const slot = install(rigOf(game.player)!, "baffle", 4);
    expect(slot, "the rack had no room for a BAFFLE").not.toBeUndefined();

    wait(game, 15);
    expect(st.level).toBe(2);
  });

  it("never goes below zero, and says nothing when there is nothing to say", () => {
    const game = quietShip(LINE, 26);
    wait(game, 60);
    expect(alertState(game).level).toBe(0);
    expect(game.log.lines.some((l) => l.text === "The ship stops looking for you.")).toBe(false);
  });
});

// ---------------------------------------------------------------- the hunter

/** A drone in r1, a locked bulkhead between it and the far end of the ship. */
const LOCKED = `
  TUG -a1- r1
  r1 -d1- r2 -[d2:k1]- r3
  r1: docking
  r2: hold explored
  r3: reactor explored
`;

describe("near the top of the gauge the ship sends an ENFORCER", () => {
  it("exactly one, two doors out, and never a second one", () => {
    const game = quietShip(LOCKED, 31);
    const here = game.roomOf(game.player).id;

    raiseAlert(game, HUNTER_LEVEL - 1);
    expect(enforcers(game).length, "not yet: the ship is only annoyed").toBe(0);

    raiseAlert(game);
    const hunters = enforcers(game);
    expect(hunters.length).toBe(1);
    expect(doorsAway(game.ship, here, hunters[0]!.room!)).toBeGreaterThanOrEqual(2);
    expect(hunters[0]!.data?.targetRoom).toBe(here);
    expect(game.log.lines.some((l) => l.text.startsWith("An ENFORCER wakes up in "))).toBe(true);

    raiseAlert(game, 2);
    expect(enforcers(game).length, "one hunter aboard at a time").toBe(1);
  });

  it("walks to the drone and cuts the locked bulkhead on the way", () => {
    const game = quietShip(LOCKED, 32);
    raiseAlert(game, HUNTER_LEVEL);
    const hunter = enforcers(game)[0]!;
    expect(game.ship.roomAt(hunter.room!).label, "the only compartment two doors out").toBe("r3");

    for (let turn = 0; turn < 12 && !game.isOver(); turn++) game.playerCommand({ kind: "wait" });

    expect(game.ship.door("d2").state, "three turns of cutting leave a hole").toBe("broken");
    // It carries a gun, so it stops one door short and shoots through the hole
    // it just made rather than walking in.
    expect(doorsAway(game.ship, game.player.room!, hunter.room!)).toBeLessThanOrEqual(1);
    // Either line will do: a blow that lands in the rack is the twist's to
    // report (`The enforcer hits your PLATING (12/16).`) and one that reaches
    // the core is the engine's. Twelve turns of 1d3+1 no longer get through a
    // full rack, which is the point of the pass that raised it.
    expect(game.log.lines.some((l) => /enforcer hits/i.test(l.text))).toBe(true);
  });

  it("at level five a dead hunter is replaced fifteen turns later", () => {
    const game = quietShip(LOCKED, 33);
    raiseAlert(game, 5);
    const first = enforcers(game)[0]!;
    expect(alertState(game).level).toBe(5);

    first.hp = 0;
    expect(enforcers(game).length).toBe(0);

    wait(game, 14);
    expect(enforcers(game).length, "the ship's own clock, not the next raise").toBe(0);
    wait(game, 1);
    expect(enforcers(game).length).toBe(1);
  });

  it("at level five everything aboard is told where the drone is", () => {
    const game = quietShip(LINE, 34);
    decoyHunter(game, "r4");
    const posted = put(game, "r4", INERT);
    expect(posted.data?.targetRoom, "a machine posted by hand knows nothing").toBeUndefined();

    raiseAlert(game, 4);
    wait(game, 14);
    expect(posted.data?.targetRoom, "level four is not the standing order").toBeUndefined();

    raiseAlert(game);
    wait(game, 1);
    expect(posted.data?.targetRoom).toBe(game.roomOf(game.player).id);
  });

  it("shows up in the panel as a line of its own", () => {
    const game = quietShip(LOCKED, 35);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▯▯▯▯▯" }]);

    raiseAlert(game, 2);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▯▯▯" }]);

    // Three is where the gauge turns amber and four is where the hunter comes:
    // the warning and the thing it warns about are one step apart on purpose.
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▮▯▯", fg: "#d9b56a" }]);

    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([
      { text: "ALERT ▮▮▮▮▯", fg: "#d9b56a" },
      { text: "HUNTER aboard", fg: "#d96a6a" },
    ]);

    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([
      { text: "ALERT ▮▮▮▮▮", fg: "#d96a6a" },
      { text: "HUNTER aboard", fg: "#d96a6a" },
    ]);
  });
});

// ------------------------------------------------------- between two sorties

/** Walk out to the tug and back aboard, which is what a sortie is. */
function roundTrip(game: RoomGame): void {
  game.travelTo("tug", { generate: () => shipFromText(TUG).ship });
  game.travelTo("1", {
    generate: () => {
      throw new Error("the derelict must come back out of the store, not be regenerated");
    },
  });
}

describe("the alert belongs to the ship, not to the drone", () => {
  it("survives a trip to the tug and back, and settles to the systems brought online", () => {
    const game = quietShip(WALKED, 41);
    decoyHunter(game, "r4");
    raiseAlert(game, 3);
    wait(game, 5);
    const aboard = alertState(game).turnsAboard;

    game.travelTo("tug", { generate: () => shipFromText(TUG).ship });
    expect(alertState(game).level, "the tug has a gauge of its own").toBe(0);
    expect(alertState(game).turnsAboard).toBe(0);

    game.travelTo("1", { generate: () => shipFromText(WALKED).ship });
    const st = alertState(game);
    expect(st.turnsAboard, "the ship remembers how long you were aboard").toBe(aboard);
    expect(st.level, "nothing was brought online, so the ship calmed down").toBe(0);
  });

  it("keeps a floor equal to the systems the drone raised", () => {
    const game = quietShip(WALKED, 42);
    decoyHunter(game, "r4");
    raiseAlert(game, 4);
    // What the SHIP system (G17) writes into the same per-ship pocket.
    game.currentShip.data.ship = { online: ["ENGINE", "CORE"] };

    roundTrip(game);
    expect(alertState(game).level).toBe(2);
  });

  it("reads a corrupted record as zero rather than throwing", () => {
    const game = quietShip(WALKED, 43);
    raiseAlert(game, 2);
    game.currentShip.data.ship = "not a record";
    expect(() => roundTrip(game)).not.toThrow();
    expect(alertState(game).level).toBe(0);
  });

  it("musters 2 + 2 × alert machines, all of them in explored compartments two doors from the airlock", () => {
    for (let s = 0; s < 200; s++) {
      const game = quietShip(WALKED, 5000 + s);
      const entry = game.ship.entry;
      alertState(game).level = 2;
      const before = new Set(game.entities.map((e) => e.id));

      roundTrip(game);
      const arrived = machines(game).filter((e) => !before.has(e.id));
      expect(arrived.length, `seed ${5000 + s}`).toBe(6);
      for (const m of arrived) {
        const room = game.ship.roomAt(m.room!);
        expect(room.explored, `seed ${5000 + s}: ${room.label} was never walked`).toBe(true);
        expect(doorsAway(game.ship, entry, room.id)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("musters nothing on the first entry, and nothing when nowhere is both explored and deep", () => {
    const fresh = quietShip(WALKED, 44);
    expect(machines(fresh).length).toBe(0);

    // Nothing but the airlock compartment has been walked.
    const blind = quietShip(LINE, 45);
    alertState(blind).level = 3;
    roundTrip(blind);
    expect(machines(blind).length).toBe(0);
  });

  it("leaves a trail of doors the machines did not close, the same one on the same seed", () => {
    const doorStates = (seed: number): string => {
      const game = quietShip(WALKED, seed);
      alertState(game).level = 2;
      roundTrip(game);
      return game.ship.doors.map((d) => `${d.label}:${d.state}`).join(" ");
    };

    const once = doorStates(46);
    expect(once, "somebody walked through and left a door open").toContain("d1:open");
    expect(doorStates(46), "the same ship did the same thing").toBe(once);
  });
});

// ------------------------------------------------------------- determinism

describe("the alert is deterministic and keeps to itself", () => {
  it("spends none of the run's randomness, so switching it on re-rolls nothing else", () => {
    const game = quietShip(LINE, 61);
    const before = game.rng.state;

    raiseAlert(game, 4);
    expect(machines(game).length, "the ship did dispatch, so there was something to roll").toBe(1);
    expect(game.rng.state, "the alert rolls on the ship's own stream").toBe(before);
  });

  it("replays bit for bit from the seed and the commands", () => {
    const cfg = {
      ...GAME_CONFIG,
      // One hulk per compartment, so the drone has something to be loud about:
      // time alone can no longer fill the gauge — fifteen quiet turns take a
      // level off and the clock only puts one on every forty — so noise is the
      // only way up, which is the alert working as designed.
      content: { ...SALVOR, monsterChance: () => 1, monstersForDepth: () => [INERT] },
      // Five compartments rather than four: the gauge wants four fights to
      // reach the hunter and a hulk only dies once.
      firstShip: () =>
        shipFromText(`
          TUG -a1- r1
          r1 -d1- r2 -d2- r3 -d3- r4 -d4- r5
          r1: docking
          r2: hold
          r3: hab
          r4: reactor
          r5: control
        `).ship,
      firstShipId: "1",
      systems: [ALERT],
    };
    const seed = 62;

    // Four fights, ten quiet turns apart: four raises, and the fourth is the
    // hunter — the only dispatch a raise makes.
    const first = new RoomGame({ ...cfg, seed });
    for (const label of ["d1", "d2", "d3", "d4"]) {
      first.playerCommand({ kind: "go", door: first.ship.door(label).id });
      const prey = first.entitiesIn(first.roomOf(first.player).id).find((e) => e.id !== first.player.id);
      if (prey) first.playerCommand({ kind: "attack", target: prey.id });
      wait(first, 10);
    }
    expect(
      first.log.lines.some((l) => l.text.startsWith("An ENFORCER wakes up")),
      "a run that never raised the alert proves nothing about it",
    ).toBe(true);

    const again = replayRooms(seed, [...first.inputs], cfg);
    expect(alertState(again)).toEqual(alertState(first));
    expect(again.entities.map((e) => `${e.name}@${e.room}`)).toEqual(
      first.entities.map((e) => `${e.name}@${e.room}`),
    );
  });
});

// ------------------------------------------------------------------ the game

describe("a whole run with the alert running", () => {
  /**
   * The gap this whole system exists to close, measured: with `systems: []` the
   * careful bot runs out of steps on 26 of these 32 seeds — it backs off, waits
   * and never has to decide anything, which is "infinite kiting is locally
   * optimal" in one number. With the alert aboard every one of them ends.
   */
  it("careful never gets stuck on 32 seeds", () => {
    const summary = runBatchOn(
      "careful",
      BOTS_ROOMS.careful!,
      seedRange(1, 32),
      roomPlay({ maxSteps: 1200, make: (seed) => newGame(seed) }),
    );
    expect(summary.stuck, formatSummary(summary)).toBe(0);
  });
});
