import { describe, it, expect } from "vitest";
import {
  Rng,
  RoomDistance,
  RoomGame,
  hexLayout,
  isAlive,
  rememberRoom,
  replayRooms,
  spawnMonsterIn,
  type Door,
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
  runBotOn,
  roomPlay,
  seedRange,
  shipFromText,
} from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { stampClass } from "../src/content/derelicts.js";
import { CROWD, ENFORCER, MONSTERS, type Machine } from "../src/content/monsters.js";
import { TUG_ID, isTug } from "../src/content/tug.js";
import { TUTORIAL_SPEC } from "../src/content/tutorial.js";
import {
  ALERT,
  ARM_TURNS,
  BLOWN,
  CHARGE_LEVEL,
  CHARGE_PERIOD,
  DETONATION_TURNS,
  DOOR_PERIOD,
  FUSE_TURNS,
  HUNTER_LEVEL,
  LOCK_LEVEL,
  MAX_LEVEL,
  PERIOD,
  alertState,
  detonated,
  fuseIn,
  isBlown,
  raiseAlert,
  standDown,
  type AlertState,
} from "../src/systems/alert.js";
import { voyageOf } from "../src/systems/voyage.js";
import { addWreck, hostilesIn, install, rigOf } from "../src/twist/rig.js";
import { t } from "../src/i18n.js";
import { engage, isStop } from "../src/ui/auto.js";
import { cornerHtml, htmlOf } from "../src/ui/web/panel-html.js";

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

/** Walked, with every door left open: the ship has something to shut. */
const OPEN_WALKED = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
  r1: docking explored
  r2: hold explored
  r3: hab explored
  r4: reactor explored
`;

/** A loop, so the ship can lock a door without walling anybody in. */
const LOOP = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
  r2 -d4- r4
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

/** The ten words of the ladder, as the English log prints them. */
const WORDS = ["NOTICED", "SEARCHING", "POST", "PICKETS", "HUNTING", "PACK", "ENFORCER", "LOCKDOWN", "SCUTTLE", "DETONATION"];

/**
 * A machine that never gets a turn — speed 1 against the drone's 100 is one
 * action per hundred, and `static` does nothing with it. Every count below is
 * about how often the ship sends something, not about pathfinding.
 */
const INERT: Machine = {
  id: "inert", name: "inert hulk", ch: "h", fg: "#8b95a0", hp: 1, damage: [1, 1, 0], defense: 0,
  speed: 1, fovRadius: 1, behaviour: "static", sight: 0, minDepth: 0, maxDepth: 99, weight: 10,
};

function gameOn(text: string, seed = 11, over: Partial<RoomContentPack> = {}, training = false): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    content: { ...SALVOR, monsterChance: () => 0, ...over },
    firstShip: () => {
      const ship = shipFromText(text).ship;
      if (training) stampClass(ship, TUTORIAL_SPEC);
      return ship;
    },
    firstShipId: "1",
    systems: [ALERT],
  });
}

/** The usual ship for a clock test: empty, and whatever wakes up stays put. */
function quietShip(text: string, seed = 11): RoomGame {
  return gameOn(text, seed, { monstersForDepth: () => [INERT] });
}

/**
 * The same, as a training run: the first hull is stamped as the tutorial's,
 * so the one after it is the hull the game is learned on (`isFirstShip`).
 */
function trainingShip(text: string, seed = 11): RoomGame {
  return gameOn(text, seed, { monstersForDepth: () => [INERT] }, true);
}

/**
 * The same, one derelict later: the run's first hull is the tutorial and its
 * ladder wakes nothing on the posting and sending rungs, so a test about what
 * those rungs wake has to stand on the second.
 */
function secondShip(text: string, seed = 11, over: Partial<RoomContentPack> = {}): RoomGame {
  const game = gameOn(text, seed, { monstersForDepth: () => [INERT], ...over });
  game.travelTo("2", { generate: () => shipFromText(text).ship });
  return game;
}

function wait(game: RoomGame, turns: number): void {
  for (let i = 0; i < turns; i++) game.playerCommand({ kind: "wait" });
}

/**
 * Turns that are not quiet: a sound in the drone's own compartment every turn,
 * under the threshold that raises the gauge and over the one that resets the
 * silence — so the level stays where the test put it.
 */
function loudWait(game: RoomGame, turns: number): void {
  for (let i = 0; i < turns; i++) {
    game.makeNoise(game.roomOf(game.player).id, 6);
    game.playerCommand({ kind: "wait" });
  }
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

/** Stand the drone somewhere other than the airlock. */
function standIn(game: RoomGame, room: string): void {
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
}

/** Walk to a compartment one door at a time, opening what is shut on the way. */
function walkTo(game: RoomGame, room: string): void {
  const goal = game.ship.room(room).id;
  const walk = (d: { state: string }) => game.ship.passable(d as never, {});
  for (let guard = 0; guard < 40 && game.roomOf(game.player).id !== goal; guard++) {
    const door = RoomDistance.from(game.ship, [goal], walk).nextDoor(game.roomOf(game.player).id, walk);
    if (!door) throw new Error(`no way from ${game.roomOf(game.player).label} to ${room}`);
    game.playerCommand({ kind: "go", door: door.id });
  }
  expect(game.roomOf(game.player).label).toBe(room);
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

/** What the rack and the core add up to: the number a blast takes from. */
function durability(game: RoomGame): number {
  const rig = rigOf(game.player);
  const rack = rig ? rig.slots.reduce((n, s) => n + (s?.integrity ?? 0), 0) : 0;
  return rack + game.player.hp;
}

function logged(game: RoomGame, text: string): number {
  return game.log.lines.filter((l) => l.text === text).length;
}

function blown(game: RoomGame): string[] {
  return game.ship.rooms.filter((r) => isBlown(r)).map((r) => r.label);
}

const GAUGE = (level: number) => "▮".repeat(level) + "▯".repeat(MAX_LEVEL - level);

// ------------------------------------------------------------------ the clock

describe("the alert is the ship's clock", () => {
  it("raises every 40 turns on the run's first derelict, and brings nothing with it", () => {
    const game = quietShip(LINE, 4242);
    const st = alertState(game);
    const before = machines(game).length;

    wait(game, 39);
    expect(st.turnsAboard).toBe(39);
    expect(st.level).toBe(0);

    wait(game, 1);
    expect(st.level).toBe(1);
    // The first rung of the ladder is the word and nothing else: the ship has
    // noticed, and says so, and that is all a step of the tutorial clock costs.
    expect(machines(game).length, "level one costs the drone nothing").toBe(before);
    expect(logged(game, "Alert: NOTICED.")).toBe(1);
  });

  it("raises every 20 turns on every derelict after it", () => {
    const game = quietShip(LINE, 515);
    game.travelTo("2", { generate: () => shipFromText(LINE).ship });
    const st = alertState(game);
    expect(st.level).toBe(0);

    wait(game, 19);
    expect(st.level).toBe(0);

    wait(game, 1);
    expect(st.turnsAboard).toBe(20);
    expect(st.level).toBe(1);
  });

  it("keeps the 40-turn clock for the hull after the training one, and hurries on the one after that", () => {
    // The training hull stands in front of the itinerary and used to take the
    // slow clock with it, so the first real hull of a training run ran on the
    // fast one (docs/tasks/G88-polish-by-map.md, A2).
    const game = trainingShip(LINE, 4243);
    game.travelTo("2", { generate: () => shipFromText(LINE).ship });
    const second = alertState(game);
    wait(game, 39);
    expect(second.level, "the hull after the tutorial is the run's first").toBe(0);
    wait(game, 1);
    expect(second.level).toBe(1);

    game.travelTo("3", { generate: () => shipFromText(LINE).ship });
    const third = alertState(game);
    wait(game, PERIOD);
    expect(third.level, "the one after it runs on the ordinary clock").toBe(1);
  });

  it("a raise on a rung that wakes nothing costs the ship nothing", () => {
    const game = quietShip(LINE, 64064);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, LOCK_LEVEL);
    expect(st.level).toBe(LOCK_LEVEL);
    const before = machines(game).length;

    // The first derelict's own period is 40 turns; the ship's hunter is
    // already out, so the replacement clock passes and nothing comes of it.
    wait(game, 39);
    expect(st.turnsAboard).toBe(39);
    expect(machines(game).length).toBe(before);
  });
});

// ----------------------------------------------------------------- the ladder

describe("the ladder: every rung once, on the way up", () => {
  it("0 → 10 in one go posts two, sends two, wakes the hunter, and a raise at the top adds nothing", () => {
    const game = secondShip(OPEN_WALKED, 31337);
    const st = alertState(game);
    const here = game.roomOf(game.player).id;

    raiseAlert(game, 12, true);
    expect(st.level).toBe(MAX_LEVEL);
    // Three and four post one each, five and six send one each, seven is the
    // ENFORCER: five.
    expect(machines(game).length).toBe(5);
    expect(enforcers(game).length).toBe(1);
    const woken = machines(game).filter((m) => m.name !== ENFORCER.name);
    expect(woken.filter((m) => m.data?.targetRoom === here).length, "the two sent at five and six").toBe(2);
    expect(woken.filter((m) => m.data?.targetRoom === undefined).length, "the two posted at three and four").toBe(2);
    for (const m of machines(game)) {
      expect(doorsAway(game.ship, here, m.room!), `${m.name} woke too close`).toBeGreaterThanOrEqual(2);
    }

    // Each rung's line exactly once, and the top of the gauge says what it is.
    for (const word of WORDS) expect(logged(game, `Alert: ${word}.`), word).toBe(1);
    expect(st.fuses.length, "nine sets its first charge at once").toBe(1);
    expect(game.log.lines.some((l) => l.text.startsWith(`DETONATION: ${DETONATION_TURNS} turns`))).toBe(true);

    // Provoked again at the top: nothing new is woken and nothing is said twice.
    const before = machines(game).length;
    raiseAlert(game, 3, true);
    expect(machines(game).length).toBe(before);
    expect(logged(game, "Alert: DETONATION.")).toBe(1);
  });

  it("nine is as far as noise or a raised system take it; only the clock takes it to ten", () => {
    const game = secondShip(OPEN_WALKED, 31338);
    const st = alertState(game);
    raiseAlert(game, 12);
    expect(st.level, "provoked, the ship stops at the charges").toBe(CHARGE_LEVEL);
    expect(logged(game, "Alert: DETONATION.")).toBe(0);
    loudWait(game, ARM_TURNS - 1);
    expect(st.level, "two periods of charges first").toBe(CHARGE_LEVEL);
    loudWait(game, 1);
    expect(st.level, "then the ship arms itself").toBe(MAX_LEVEL);
    expect(logged(game, "Alert: DETONATION.")).toBe(1);
  });

  it("climbs a rung again only after the gauge has fallen off it", () => {
    const game = secondShip(OPEN_WALKED, 77);
    const st = alertState(game);
    raiseAlert(game, 3);
    expect(machines(game).length).toBe(1);

    // Eight quiet turns: the ship stops looking, and the one it posted at
    // three is the ship's to keep. Coming back up to three posts one more —
    // it is a transition, and a transition is answered every time.
    wait(game, 8);
    expect(st.level).toBe(2);
    raiseAlert(game);
    expect(st.level).toBe(3);
    expect(machines(game).length).toBe(2);
  });

  it("wakes nothing on the posting and sending rungs of the run's first derelict, which is the tutorial", () => {
    const first = quietShip(OPEN_WALKED, 78);
    raiseAlert(first, HUNTER_LEVEL - 1);
    expect(machines(first).length, "the word, the doors, and later the hunter — no extra machines").toBe(0);
    expect(logged(first, "Alert: PACK.")).toBe(1);
    raiseAlert(first);
    expect(enforcers(first).length, "the hunter still comes").toBe(1);
  });

  it("wakes nothing on those rungs on the hull after the training one either", () => {
    const game = trainingShip(OPEN_WALKED, 79);
    game.travelTo("2", { generate: () => shipFromText(OPEN_WALKED).ship });
    raiseAlert(game, HUNTER_LEVEL - 1);
    expect(machines(game).length, "the first real hull of a training run is the first hull").toBe(0);
    expect(logged(game, "Alert: PACK.")).toBe(1);
  });

  it("never sends the hunter after the drone on the training hull", () => {
    // Six compartments and one scout, built to be learned on
    // (`content/tutorial.ts`): the ENFORCER on it is a lesson nobody asked for.
    const game = trainingShip(OPEN_WALKED, 80);
    raiseAlert(game, LOCK_LEVEL);
    expect(alertState(game).level).toBe(LOCK_LEVEL);
    expect(enforcers(game).length, "not on the rung the hunter comes on").toBe(0);
    // Nor when the lockdown would replace one: sixteen turns, held loud so
    // the gauge stays up there.
    loudWait(game, 16);
    expect(enforcers(game).length, "not from the lockdown either").toBe(0);

    // The hull after it is an ordinary hull as far as the hunter is concerned.
    game.travelTo("2", { generate: () => shipFromText(OPEN_WALKED).ship });
    raiseAlert(game, HUNTER_LEVEL);
    expect(enforcers(game).length).toBe(1);
  });

  it("wakes tougher machines from the lockdown: the hunter carries +0 at seven and +1 at eight", () => {
    const game = quietShip(LINE, 4004);
    raiseAlert(game, HUNTER_LEVEL);
    const first = enforcers(game)[0]!;
    expect(first.hp).toBe(ENFORCER.hp);
    expect(first.hpMax).toBe(ENFORCER.hp);

    first.hp = 0;
    raiseAlert(game);
    expect(alertState(game).level).toBe(LOCK_LEVEL);
    wait(game, 15);
    const second = enforcers(game)[0]!;
    expect(second.hp).toBe(ENFORCER.hp + 1);
    expect(second.hpMax).toBe(ENFORCER.hp + 1);
  });

  it("wakes machines of the compartment's own depth, and skips a depth with nothing in it", () => {
    // Real catalogue, real bands: what wakes two doors into a four-room line is
    // a depth-2 or depth-3 machine and never something from the deep water.
    const game = secondShip(OPEN_WALKED, 909, { monstersForDepth: SALVOR.monstersForDepth });
    decoyHunter(game, "r2");
    raiseAlert(game, 4);
    const woken = machines(game).filter((m) => m.name !== ENFORCER.name);
    expect(woken.length).toBe(2);
    for (const m of woken) {
      const depth = game.ship.roomAt(m.room!).depth;
      const kind = MONSTERS.find((k) => k.name === m.name)!;
      expect(depth, m.name).toBeGreaterThanOrEqual(kind.minDepth);
      expect(depth, m.name).toBeLessThanOrEqual(kind.maxDepth);
    }
  });
});

// ------------------------------------------------------------------ the doors

describe("from level five the ship shuts doors behind the drone", () => {
  it("closes one open door every ten turns, and never one of the drone's own compartment", () => {
    const game = quietShip(OPEN_WALKED, 3003);
    // A witness, so silence never talks the ship back down under five: a
    // scout one open door out sees the drone. d1 is the drone's own door and
    // the one the ship may never touch, which is what keeps the witness looking.
    put(game, "r2", MONSTERS.find((m) => m.id === "scout")!, { behaviour: "static" });
    raiseAlert(game, 5);
    const closed = () => game.ship.doors.filter((d) => d.state === "closed").map((d) => d.label);

    wait(game, DOOR_PERIOD - 1);
    expect(closed(), "not yet").toEqual([]);
    wait(game, 1);
    expect(closed().length, "one door, on the tenth turn").toBe(1);
    wait(game, 2 * DOOR_PERIOD);
    expect(closed().length, "three periods, two doors that were not the drone's").toBe(2);
    expect(game.ship.door("d1").state, "the drone's own door stays open").toBe("open");
    expect(game.log.lines.filter((l) => /^The ship shuts d\d+ behind you\.$/.test(l.text)).length).toBe(2);
  });

  it("at eight it locks them — with no key aboard — and never the last free way home", () => {
    const game = quietShip(LOOP, 5005);
    standIn(game, "r4");
    // The witness sits in r3, looking through d3 — the drone's own door.
    put(game, "r3", MONSTERS.find((m) => m.id === "scout")!, { behaviour: "static" });
    decoyHunter(game, "r2");
    raiseAlert(game, LOCK_LEVEL);

    wait(game, 3 * DOOR_PERIOD);
    const locked = game.ship.doors.filter((d) => d.state === "locked");
    expect(locked.length, "d2 can be locked, d1 cannot: it is the loop's last free way home").toBe(1);
    expect(locked[0]!.label).toBe("d2");
    expect(locked[0]!.key, "no card for it anywhere aboard").toBeUndefined();

    const here = game.roomOf(game.player).id;
    const bare = RoomDistance.from(game.ship, [game.ship.entry], (d) => game.ship.passable(d, {}));
    expect(Number.isFinite(bare.at(here)), "still a route the drone can walk with nothing").toBe(true);
    // And with a CELL, a SPIKE or a torch the lock is three turns and not a wall.
    expect(Number.isFinite(doorsAway(game.ship, here, game.ship.entry))).toBe(true);
  });
});

// ---------------------------------------------------------------- the charges

describe("at nine the ship starts blowing its own compartments up", () => {
  it("sets a charge on the rung, counts the fuse down, and the compartment goes up at zero", () => {
    const game = quietShip(WALKED, 6006);
    decoyHunter(game, "r2");
    const posted = put(game, "r4", INERT);
    // The scrap in r3 is something the drone came for: r3 is never charged,
    // and r2 is not either, because losing r2 would cut r1 off from r3.
    addWreck(game, game.ship.room("r3").id, "cell", 3);
    raiseAlert(game, CHARGE_LEVEL);
    const st = alertState(game);
    const r4 = game.ship.room("r4").id;

    expect(st.fuses.map((f) => game.ship.roomAt(f.room).label), "the one compartment it may take").toEqual(["r4"]);
    expect(fuseIn(game, r4)).toBe(FUSE_TURNS);
    expect(logged(game, `Charge set: REACTOR, ${FUSE_TURNS} turns.`)).toBe(1);
    expect(ALERT.panelLines?.(game)?.map((l) => l.text)).toContain(`CHARGE r4 · ${FUSE_TURNS}`);

    loudWait(game, FUSE_TURNS - 1);
    expect(fuseIn(game, r4), "the fuse burns a turn a turn").toBe(1);
    expect(logged(game, "Charge in REACTOR: 1.")).toBe(1);
    expect(blown(game), "not yet").toEqual([]);

    loudWait(game, 1);
    expect(blown(game)).toEqual(["r4"]);
    expect(fuseIn(game, r4)).toBeUndefined();
    expect(isAlive(posted), "nothing in it survives").toBe(false);
    expect(game.entities.includes(posted)).toBe(false);
    expect(game.ship.door("d3").state, "sealed behind it").toBe("sealed");
    expect(st.blasts).toBe(1);
    expect(logged(game, "REACTOR blows up: nothing left.")).toBe(1);

    // The next charge is due eight turns after the first, and there is
    // nowhere it may go: r3 holds the scrap, r2 is the only way to it.
    loudWait(game, CHARGE_PERIOD);
    expect(st.fuses, "never a compartment worth keeping, never one that cuts the drone off").toEqual([]);
    expect(blown(game)).toEqual(["r4"]);

    // Take the scrap away and the ship has something to blow again: the
    // period ran out while it had nowhere to go, so the next turn is enough.
    (game.ship.room("r3").data.wrecks as unknown[]).length = 0;
    loudWait(game, 1);
    expect(st.fuses.length).toBe(1);
  });

  it("never picks the drone's compartment or the airlock's, never a ship system, never the only way to one", () => {
    const fused = (game: RoomGame) => alertState(game).fuses.map((f) => game.ship.roomAt(f.room).label);
    for (let s = 0; s < 20; s++) {
      // r1 is the airlock's, r2 the drone's, r4 holds a reactor that is still
      // down, and r3 is the only way to r4: nowhere at all.
      const walled = quietShip(OPEN_WALKED, 6100 + s);
      decoyHunter(walled, "r4");
      standIn(walled, "r2");
      (walled.ship.room("r4").data as Record<string, unknown>).systems = [{ id: 1, kind: "core", online: false }];
      raiseAlert(walled, CHARGE_LEVEL);
      expect(fused(walled), `seed ${6100 + s}`).toEqual([]);

      // The reactor in r3 instead, and the leaf beyond it is the one place left.
      const leaf = quietShip(OPEN_WALKED, 6200 + s);
      decoyHunter(leaf, "r4");
      standIn(leaf, "r2");
      (leaf.ship.room("r3").data as Record<string, unknown>).systems = [{ id: 1, kind: "core", online: false }];
      raiseAlert(leaf, CHARGE_LEVEL);
      expect(fused(leaf), `seed ${6200 + s}`).toEqual(["r4"]);
      // ...and raising the reactor does not hand r3 over: a compartment the
      // drone has just started a system in must not then go up under it.
      (leaf.ship.room("r3").data as { systems: Array<{ online: boolean }> }).systems[0]!.online = true;
      loudWait(leaf, CHARGE_PERIOD);
      expect(blown(leaf), `seed ${6200 + s}`).toEqual(["r4"]);
      expect(fused(leaf), `seed ${6200 + s}`).toEqual([]);
    }
  });

  it("blows a compartment out rather than sealing it when the blasts before it made it the only way", () => {
    // Two ways from the airlock to a reactor still down, r2 and r3, and a
    // charge burning in each — the state seed 43 reached through a gauge
    // that fell off nine and climbed back (every climb sets a charge), or an
    // old save. Each charge was safe when set; by the time the second goes
    // off, the first has sealed the other route. Neither blast may seal.
    const game = quietShip(
      `
        TUG -a1- r1
        r1 -d1- r2 -d2- r4
        r1 -d3- r3 -d4- r4
        r1: docking explored
        r2: hold explored
        r3: hab explored
        r4: reactor explored
      `,
      6010,
    );
    decoyHunter(game, "r4");
    (game.ship.room("r4").data as Record<string, unknown>).systems = [{ id: 1, kind: "core", online: false }];
    raiseAlert(game, CHARGE_LEVEL);
    const st = alertState(game);
    const r2 = game.ship.room("r2").id;
    const r3 = game.ship.room("r3").id;
    st.fuses = [
      { room: r2, at: st.turnsAboard + 2 },
      { room: r3, at: st.turnsAboard + 4 },
    ];
    const reactorReachable = () => {
      const bare = RoomDistance.from(game.ship, [game.ship.entry], (d) => game.ship.passable(d, {}));
      return Number.isFinite(bare.at(game.ship.room("r4").id));
    };

    loudWait(game, 2);
    expect(blown(game)).toEqual(["r2"]);
    // r3's charge is still burning, so r2 is not sealed: with r3 counted as
    // gone, sealing r2 would have cut the drone off from the reactor.
    expect(game.ship.door("d1").state).toBe("broken");
    expect(game.ship.door("d2").state).toBe("broken");
    expect(reactorReachable(), "after the first blast").toBe(true);

    loudWait(game, 2);
    expect(blown(game)).toEqual(["r2", "r3"]);
    // Now r2 is a wreck the drone walks through, so r3 may be sealed.
    expect(game.ship.door("d3").state).toBe("sealed");
    expect(game.ship.door("d4").state).toBe("sealed");
    expect(reactorReachable(), "after the second blast").toBe(true);
  });

  it("kills a drone that stayed, and blows the doors out rather than sealing the wreck in", () => {
    const game = quietShip(WALKED, 6007);
    decoyHunter(game, "r2");
    addWreck(game, game.ship.room("r3").id, "cell", 3);
    raiseAlert(game, CHARGE_LEVEL);
    const r4 = game.ship.room("r4").id;
    expect(fuseIn(game, r4)).toBe(FUSE_TURNS);

    walkTo(game, "r4");
    // `Tab`, with nothing in sight, says what is about to hit the drone rather
    // than that there is no target (docs/tasks/G83-anonymous-blows.md, 1).
    expect(game.visibleMonsters()).toHaveLength(0);
    const fight = engage(game);
    expect(isStop(fight) ? fight.stop : fight.cmd).toBe(t("why.fight.hazard"));

    while (fuseIn(game, r4) !== undefined) wait(game, 1);
    expect(blown(game)).toEqual(["r4"]);
    // A compartment going up around the drone is the end of it: the rack does
    // not stand between the drone and a charge the way it stands between the
    // drone and a blow.
    expect(isAlive(game.player), "the charge went off under it").toBe(false);
    expect(game.log.lines.some((l) => l.key === "log.alert.blast.you")).toBe(true);
    expect(alertState(game).blastDeaths).toBe(1);
    expect(game.ship.door("d3").state, "blown out, not sealed: the wreck is walkable").toBe("broken");
  });

  it("shows the fuse on the schematic, and the wreck afterwards, and names both on the panel", async () => {
    const { schematicInputOf } = await import("../src/ui/schematic-input.js");
    const { panelBlocks } = await import("../src/ui/panel.js");
    const game = quietShip(WALKED, 6008);
    decoyHunter(game, "r2");
    addWreck(game, game.ship.room("r3").id, "cell", 3);
    raiseAlert(game, CHARGE_LEVEL);
    const box = () => schematicInputOf(game).rooms.find((r) => r.label === "r4")!;
    expect(box().charge).toBe(FUSE_TURNS);
    expect(box().hazard).toBeUndefined();

    loudWait(game, FUSE_TURNS);
    expect(box().charge).toBeUndefined();
    expect(box().glyphs).toContain("~");
    expect(box().hazard).toEqual({ id: BLOWN, word: t("word.blown") });

    for (const door of game.ship.doors) if (door.state === "sealed" || door.state === "locked") door.state = "closed";
    walkTo(game, "r4");
    const lines = panelBlocks(game, []).map((l) => l.text);
    expect(lines.some((l) => l.includes(t("word.blown")))).toBe(true);
  });

  it("carries the fuse onto the honeycomb as a red number, and the wreck as a tinted cell", async () => {
    const { hexSvgOf } = await import("../src/ui/web/hex-svg.js");
    const { schematicInputOf } = await import("../src/ui/schematic-input.js");
    const game = quietShip(WALKED, 6009);
    decoyHunter(game, "r2");
    addWreck(game, game.ship.room("r3").id, "cell", 3);
    raiseAlert(game, CHARGE_LEVEL);
    const svg = () => hexSvgOf(schematicInputOf(game), hexLayout(game.ship));
    expect(svg()).toContain(`class="fuse-count"`);
    expect(svg()).toContain("is-fused");
    loudWait(game, FUSE_TURNS);
    expect(svg()).not.toContain("is-fused");
    expect(svg()).toContain("hz-blown");
  });
});

// ------------------------------------------------------------- the detonation

describe("at ten the ship blows itself up", () => {
  it("counts three turns down on the panel and then takes everything aboard with it", () => {
    const game = quietShip(WALKED, 6500);
    const decoy = decoyHunter(game, "r2");
    raiseAlert(game, MAX_LEVEL, true);
    expect(ALERT.panelLines?.(game)?.[0]).toEqual({
      text: `ALERT ${GAUGE(MAX_LEVEL)} BOOM IN ${DETONATION_TURNS}`,
      fg: "#d96a6a",
    });

    loudWait(game, DETONATION_TURNS - 1);
    expect(ALERT.panelLines?.(game)?.[0]?.text).toBe(`ALERT ${GAUGE(MAX_LEVEL)} BOOM IN 1`);
    expect(alertState(game).detonated).toBe(false);

    loudWait(game, 1);
    expect(alertState(game).detonated).toBe(true);
    expect(detonated(game)).toBe(true);
    expect(isAlive(decoy), "nothing aboard survives").toBe(false);
    expect(logged(game, "The ship detonates.")).toBe(1);
    expect(game.ship.rooms.every((r) => isBlown(r))).toBe(true);
    // No voyage in this fixture: the engine's own death is what is left.
    expect(game.isOver()).toBe(true);
  });

  it("stops counting when the gauge falls off the top, and starts again from a fresh climb", () => {
    const game = quietShip(WALKED, 6501);
    decoyHunter(game, "r2");
    raiseAlert(game, MAX_LEVEL, true);
    const st = alertState(game);
    st.level = MAX_LEVEL - 1;
    // Off the top, by hand: the countdown is a thing of the top rung.
    expect(ALERT.panelLines?.(game)?.[0]?.text).toBe(`ALERT ${GAUGE(9)} SCUTTLE`);
    wait(game, DETONATION_TURNS + 1);
    expect(st.detonated).toBe(false);
  });

  it("takes the hull off the itinerary: the drone is lost and the tug moves on for nothing", () => {
    const game = newGame(77);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    const voyage = voyageOf(game);
    const was = voyage.current;
    const credits = voyage.credits;
    const hull = voyage.state[was]!.shipId;

    raiseAlert(game, MAX_LEVEL, true);
    for (let i = 0; i < DETONATION_TURNS && !isTug(game); i++) game.playerCommand({ kind: "wait" });

    expect(isTug(game), "the operator is home").toBe(true);
    expect(detonated(game, hull)).toBe(true);
    expect(voyage.hull, "the drone did not come back").toBeUndefined();
    expect(voyage.current, "the next hull, without a jump being paid for").toBe(was + 1);
    expect(voyage.credits, "nothing was charged for the crossing").toBe(credits);
    expect(game.log.lines.some((l) => l.key === "log.voyage.blown")).toBe(true);
    expect(game.log.lines.some((l) => l.key === "log.jump")).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok, "no drone to send").toBe(false);
  });

  it("ends the voyage when the last hull is the one that goes", () => {
    const game = newGame(78);
    const voyage = voyageOf(game);
    // Jump straight to the father's tug: every jump paid for out of thin air.
    while (voyage.current < voyage.derelicts.length - 1) {
      voyage.credits += 1000;
      // And every hull on the way stamped as under tow: a hull still out there
      // holds the tug (`jumpHeld`).
      voyage.state[voyage.current]!.sold = true;
      expect(game.playerCommand({ kind: "act", verb: "jump" }).ok).toBe(true);
    }
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    raiseAlert(game, MAX_LEVEL, true);
    for (let i = 0; i < DETONATION_TURNS && !game.isOver(); i++) game.playerCommand({ kind: "wait" });
    expect(game.isOver()).toBe(true);
    expect(game.status).toBe("dead");
    expect(game.log.lines.some((l) => l.key === "log.voyage.blownLast")).toBe(true);
  });
});

// -------------------------------------------------------------- neutralised

describe("a neutralised ship stops answering", () => {
  it("with three systems up the gauge does not move, no door shuts and nothing is charged", () => {
    const game = secondShip(OPEN_WALKED, 7007);
    decoyHunter(game, "r2");
    raiseAlert(game, 5);
    const st = alertState(game);
    game.currentShip.data.ship = { online: ["ENGINE", "CORE", "TERMINAL"] };
    const doors = game.ship.doors.map((d) => d.state);

    loudWait(game, 100);
    expect(st.level).toBe(5);
    expect(game.ship.doors.map((d) => d.state)).toEqual(doors);
    expect(blown(game)).toEqual([]);
    // The decoy, the two posted and the one sent: all still there, and
    // nothing has joined them.
    expect(machines(game).length, "what was awake stays awake, and nothing joins it").toBe(4);
    expect(ALERT.panelLines?.(game)?.[0]?.text).toBe(`ALERT ${GAUGE(5)} OFF`);
  });

  it("stands down the moment the ship says so, charges and countdown included", () => {
    const game = quietShip(WALKED, 7008);
    decoyHunter(game, "r2");
    raiseAlert(game, MAX_LEVEL, true);
    expect(alertState(game).fuses.length).toBe(1);
    expect(ALERT.panelLines?.(game)?.[0]?.text).toBe(`ALERT ${GAUGE(MAX_LEVEL)} BOOM IN ${DETONATION_TURNS}`);

    standDown(game);
    expect(logged(game, "Ship neutralised: it stops answering.")).toBe(1);
    expect(ALERT.panelLines?.(game)?.[0]).toEqual({ text: `ALERT ${GAUGE(MAX_LEVEL)} OFF` });
    expect(alertState(game).fuses, "disarmed").toEqual([]);
    loudWait(game, DETONATION_TURNS + FUSE_TURNS);
    expect(blown(game)).toEqual([]);
    expect(alertState(game).detonated).toBe(false);
    raiseAlert(game, 2, true);
    expect(alertState(game).level).toBe(MAX_LEVEL);
  });
});

describe("noise raises the alert, but not more than once in five turns", () => {
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

    wait(game, 1);
    game.makeNoise(here, 9);
    game.playerCommand({ kind: "wait" });
    expect(st.turnsAboard).toBe(6);
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
  it("never closer than two doors, and the hunter is always told where the drone is", () => {
    for (let s = 0; s < 60; s++) {
      const game = quietShip(LINE, 700000 + s);
      const here = game.roomOf(game.player).id;

      raiseAlert(game, HUNTER_LEVEL);
      const hunter = enforcers(game)[0];
      expect(hunter, `seed ${700000 + s}: no hunter woke up`).toBeDefined();
      expect(hunter!.data?.targetRoom).toBe(here);
      for (const woken of machines(game)) {
        expect(doorsAway(game.ship, here, woken.room!), woken.name).toBeGreaterThanOrEqual(2);
      }
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

// ------------------------------------------------------------- the crowd

/**
 * Never a fourth machine where three stand (docs/tasks/G83-anonymous-blows.md,
 * 4): the owner met six in one compartment and a seventh in sight. Every way
 * a machine arrives stops at `CROWD` — woken, mustered, dispatched, walking
 * in — and the last of those is the one that makes it a corridor fight: the
 * fourth still comes, and waits at the door.
 */
describe("no compartment holds more than CROWD machines", () => {
  /** Most machines standing in any one compartment. */
  function crowdedTo(game: RoomGame): number {
    return Math.max(0, ...game.ship.rooms.map((r) => hostilesIn(game, r.id).length));
  }

  it("wakes the ladder's machines somewhere else when the near compartment is full", () => {
    // r3 and r4 are the only compartments two doors from the drone; r3 is full.
    for (let s = 0; s < 40; s++) {
      const game = secondShip(WALKED, 8000 + s);
      for (let i = 0; i < CROWD; i++) put(game, "r3", INERT);
      raiseAlert(game, HUNTER_LEVEL);
      expect(crowdedTo(game), `seed ${8000 + s}`).toBeLessThanOrEqual(CROWD);
      expect(machines(game).length).toBeGreaterThan(CROWD);
      for (const m of machines(game).filter((e) => e.name !== INERT.name)) {
        expect(game.ship.roomAt(m.room!).label, m.name).toBe("r4");
      }
    }
  });

  it("wakes nothing at all when every compartment far enough is full", () => {
    const game = secondShip(WALKED, 8100);
    for (const room of ["r3", "r4"]) for (let i = 0; i < CROWD; i++) put(game, room, INERT);
    const before = machines(game).length;
    expect(() => raiseAlert(game, HUNTER_LEVEL)).not.toThrow();
    expect(machines(game).length).toBe(before);
    expect(alertState(game).level, "the gauge still moves").toBe(HUNTER_LEVEL);
  });

  it("musters three to a compartment and stops when the walked ship is full", () => {
    for (let s = 0; s < 60; s++) {
      const game = quietShip(WALKED, 8200 + s);
      alertState(game).level = MAX_LEVEL;
      roundTrip(game);
      expect(crowdedTo(game), `seed ${8200 + s}`).toBe(CROWD);
      expect(machines(game).length).toBe(2 * CROWD);
    }
  });

  it("holds a machine at the door of a full compartment until one of the three comes out", () => {
    // A hunter in r3, sent at the drone in r1, must cross r2 — which is full.
    const game = quietShip(OPEN_WALKED, 8300);
    for (let i = 0; i < CROWD; i++) put(game, "r2", INERT);
    const hound: Machine = { ...INERT, id: "hound", name: "hound", speed: 100, behaviour: "hunter", sight: 1 };
    const hunter = put(game, "r3", hound);
    rememberRoom(hunter, game.roomOf(game.player).id);

    for (let turn = 0; turn < 6; turn++) {
      wait(game, 1);
      expect(game.ship.roomAt(hunter.room!).label, `turn ${turn}`).toBe("r3");
      expect(hostilesIn(game, game.ship.room("r2").id).length).toBe(CROWD);
    }

    // One of the three dies: the door is open again, and the hunter comes through.
    const inert = hostilesIn(game, game.ship.room("r2").id)[0]!;
    inert.hp = 0;
    inert.alive = false;
    game.reapDead();
    wait(game, 1);
    expect(game.ship.roomAt(hunter.room!).label).toBe("r2");
  });

  it("holds a hunter born after this round's stamp: it does not walk into a full compartment on its first move", () => {
    // Seed 70, turn 352 on a live run: the hunter was dispatched inside
    // `afterPlayerTurn`, after the round's posts were stamped, and acted in
    // the same round with no "where from" — so nothing held it at the door.
    // The ladder raises at the top of the alert's own hook, which is exactly
    // that moment; r2 is full, and the hunter has to cross it to reach r1.
    for (let s = 0; s < 30; s++) {
      const game = secondShip(OPEN_WALKED, 8400 + s);
      for (let i = 0; i < CROWD; i++) put(game, "r2", INERT);
      const st = alertState(game);
      st.level = HUNTER_LEVEL - 1;
      st.turnsAboard = PERIOD - 1;
      // A slow drone — iced, or on a burned drive — gives the machines two
      // rounds to its one, which is what let the hunter move in the round it
      // was born in.
      game.player.speed = 50;
      wait(game, 1);
      const hunter = enforcers(game)[0];
      expect(hunter, `seed ${8400 + s}: no hunter woke up`).toBeDefined();
      for (let turn = 0; turn < 6; turn++) {
        expect(crowdedTo(game), `seed ${8400 + s}, turn ${turn}`).toBeLessThanOrEqual(CROWD);
        expect(game.ship.roomAt(hunter!.room!).label, `seed ${8400 + s}, turn ${turn}`).not.toBe("r2");
        wait(game, 1);
      }
    }
  });

  it("holds on two hundred careful voyages, whatever the ladder and the muster do", () => {
    let peak = 0;
    let full = 0;
    for (const seed of seedRange(1, 200)) {
      const game = newGame(seed);
      const bot = BOTS_ROOMS.careful!();
      const rng = new Rng(seed ^ 0x83);
      let idle = 0;
      for (let step = 0; step < 800 && !game.isOver() && idle < 12; step++) {
        const before = game.inputs.length;
        game.playerCommand(bot(game, rng));
        idle = game.inputs.length > before ? 0 : idle + 1;
        if (isTug(game)) continue;
        const most = crowdedTo(game);
        peak = Math.max(peak, most);
        if (most === CROWD) full++;
        expect(most, `seed ${seed}, turn ${game.schedule.time}`).toBeLessThanOrEqual(CROWD);
      }
    }
    expect(peak).toBe(CROWD);
    expect(full, "the control: the ceiling was reached at all").toBeGreaterThan(0);
  });
});

// ------------------------------------------------------- silence and cover

describe("silence talks the ship down", () => {
  it("eight quiet turns cost the ship one level", () => {
    const game = quietShip(LINE, 21);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);

    wait(game, 7);
    expect(st.level).toBe(3);
    wait(game, 1);
    expect(st.level).toBe(2);
    expect(game.log.lines.some((l) => l.text === "The ship stops looking for you.")).toBe(true);
  });

  it("one noisy turn on the seventh puts the count back to zero", () => {
    const game = quietShip(LINE, 22);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);

    wait(game, 6);
    game.makeNoise(game.roomOf(game.player).id, 6);
    game.playerCommand({ kind: "wait" });
    expect(st.quietTurns).toBe(0);

    wait(game, 7);
    expect(st.level, "the count started again").toBe(3);
    wait(game, 1);
    expect(st.level).toBe(2);
  });

  it("four turns are enough in cover", () => {
    const game = quietShip(COVER, 23);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 3);

    expect(game.playerCommand({ kind: "hide" }).ok).toBe(true);
    expect(game.player.hidden).toBe(true);
    wait(game, 2);
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

    wait(game, 8);
    expect(st.level).toBe(2);
  });

  it("never goes below zero, and says nothing when there is nothing to say", () => {
    const game = quietShip(LINE, 26);
    wait(game, 30);
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

describe("at seven the ship sends an ENFORCER", () => {
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
    // report (`log.hit.module`) and one that reaches the core is the engine's.
    // Twelve turns of 1d3+1 no longer get through a full rack, which is the
    // point of the pass that raised it. Asked by key rather than by wording,
    // which is what the log's lines get rewritten for (G97).
    const blows = new Set(["log.hit.module", "engine.hit.taken"]);
    expect(
      game.log.lines.some((l) => l.key !== undefined && blows.has(l.key) && /enforcer/i.test(l.text)),
    ).toBe(true);
  });

  it("from the lockdown a dead hunter is replaced fifteen turns later", () => {
    const game = quietShip(LOCKED, 33);
    raiseAlert(game, LOCK_LEVEL);
    const first = enforcers(game)[0]!;
    expect(alertState(game).level).toBe(LOCK_LEVEL);

    first.hp = 0;
    expect(enforcers(game).length).toBe(0);

    // Held loud: eight quiet turns would talk the ship off the lockdown.
    loudWait(game, 14);
    expect(enforcers(game).length, "the ship's own clock, not the next raise").toBe(0);
    loudWait(game, 1);
    expect(enforcers(game).length).toBe(1);
  });

  it("from the lockdown everything aboard is told where the drone is", () => {
    const game = quietShip(LINE, 34);
    decoyHunter(game, "r4");
    const posted = put(game, "r4", INERT);
    expect(posted.data?.targetRoom, "a machine posted by hand knows nothing").toBeUndefined();

    raiseAlert(game, LOCK_LEVEL - 1);
    loudWait(game, 14);
    expect(posted.data?.targetRoom, "seven is not the standing order").toBeUndefined();

    raiseAlert(game);
    loudWait(game, 1);
    expect(posted.data?.targetRoom).toBe(game.roomOf(game.player).id);
  });

  it("shows up in the panel as a line of its own, with the rung's word after the bar", () => {
    const game = quietShip(LOCKED, 35);
    // Scrap in r2: the one charge the ship sets at nine can only go to r3.
    addWreck(game, game.ship.room("r2").id, "cell", 3);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: `ALERT ${GAUGE(0)}` }]);

    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: `ALERT ${GAUGE(1)} NOTICED` }]);
    raiseAlert(game, 3);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: `ALERT ${GAUGE(4)} PICKETS` }]);

    // Five is where the gauge turns amber and the doors start shutting.
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: `ALERT ${GAUGE(5)} HUNTING`, fg: "#d9b56a" }]);

    raiseAlert(game, 2);
    expect(ALERT.panelLines?.(game)).toEqual([
      { text: `ALERT ${GAUGE(7)} ENFORCER`, fg: "#d9b56a" },
      { text: "ENFORCER still aboard", fg: "#d96a6a" },
    ]);

    // Nine is red, and every fuse burning is a line under it.
    raiseAlert(game, 2);
    expect(ALERT.panelLines?.(game)).toEqual([
      { text: `ALERT ${GAUGE(9)} SCUTTLE`, fg: "#d96a6a" },
      { text: "ENFORCER still aboard", fg: "#d96a6a" },
      { text: `CHARGE r3 · ${FUSE_TURNS}`, fg: "#d96a6a" },
    ]);

    // The top is a countdown, and it ticks on the panel.
    raiseAlert(game, 1, true);
    expect(ALERT.panelLines?.(game)?.[0]).toEqual({
      text: `ALERT ${GAUGE(10)} BOOM IN ${DETONATION_TURNS}`,
      fg: "#d96a6a",
    });
    loudWait(game, 1);
    expect(ALERT.panelLines?.(game)?.[0]).toEqual({
      text: `ALERT ${GAUGE(10)} BOOM IN ${DETONATION_TURNS - 1}`,
      fg: "#d96a6a",
    });
  });

  it("carries its level onto the page as the ladder in the map's corner, and leaves the panel", () => {
    const rows = (text: string) => [{ text: "1 CUTTER ▮▮▮▯" }, { text: "" }, { text: "KEYS  0" }, { text }];
    const corner = (text: string) => cornerHtml(undefined, rows(text), []);
    expect(corner(`ALERT ${GAUGE(0)}`)).toContain("web-ladder is-l0");
    expect(corner(`ALERT ${GAUGE(5)} HUNTING`)).toContain("web-ladder is-l5");
    expect(corner(`ALERT ${GAUGE(10)} BOOM IN 2`)).toContain("web-ladder is-l10");
    // The countdown is the row's own words, and the row heads the ladder.
    expect(corner(`ALERT ${GAUGE(10)} BOOM IN 2`)).toContain("BOOM IN 2");
    // The rival's bar is a bar too, and is not the alert.
    expect(cornerHtml(undefined, [{ text: "RIVAL ▮▯▯" }], [])).toBe("");

    // On the page the panel's stack closes up behind it.
    const page = htmlOf(rows(`ALERT ${GAUGE(5)} HUNTING`), [], [], 0);
    expect(page).not.toContain("ALERT");
    expect(page).toContain("KEYS  0");
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
  it("survives a trip to the tug and back, and comes back four steps calmer", () => {
    const game = quietShip(WALKED, 41);
    decoyHunter(game, "r4");
    raiseAlert(game, 6);
    wait(game, 5);
    const aboard = alertState(game).turnsAboard;

    game.travelTo("tug", { generate: () => shipFromText(TUG).ship });
    expect(alertState(game).level, "the tug has a gauge of its own").toBe(0);
    expect(alertState(game).turnsAboard).toBe(0);

    game.travelTo("1", { generate: () => shipFromText(WALKED).ship });
    const st = alertState(game);
    expect(st.turnsAboard, "the ship remembers how long you were aboard").toBe(aboard);
    expect(st.level, "cycling out through the airlock is four steps, not a reset").toBe(2);
  });

  it("keeps a floor equal to the systems the drone raised", () => {
    const game = quietShip(WALKED, 42);
    decoyHunter(game, "r4");
    raiseAlert(game, LOCK_LEVEL);
    // What the SHIP system (G17) writes into the same per-ship pocket.
    game.currentShip.data.ship = { online: ["ENGINE", "CORE"] };

    roundTrip(game);
    expect(alertState(game).level, "eight less four, on a floor of two").toBe(4);

    alertState(game).level = MAX_LEVEL;
    roundTrip(game);
    expect(alertState(game).level, "ten less four, over the floor").toBe(6);

    alertState(game).level = 2;
    roundTrip(game);
    expect(alertState(game).level, "never under the floor").toBe(2);
  });

  it("leaving at the top comes back to six and a full muster; dying aboard comes back to four", () => {
    const left = quietShip(WALKED, 43);
    alertState(left).level = MAX_LEVEL;
    const before = new Set(left.entities.map((e) => e.id));
    roundTrip(left);
    expect(alertState(left).level).toBe(6);
    // 2 + 10 is twelve, a hand-drawn hull holds eight, and the two
    // compartments deep enough to muster into hold three each (`CROWD`): the
    // muster is sized by how alarmed the ship was, and capped by what it can
    // hold — and by where it can put it.
    expect(machines(left).filter((e) => !before.has(e.id)).length).toBe(2 * CROWD);

    const died = quietShip(WALKED, 44);
    alertState(died).level = MAX_LEVEL;
    // The death hook, exactly as the engine calls it when a machine's blow
    // lands: the voyage moves the operator home afterwards, and here the trip
    // is made by hand.
    died.onDeath(died.player);
    expect(alertState(died).lostDrone).toBe(true);
    roundTrip(died);
    expect(alertState(died).level).toBe(4);
    expect(alertState(died).lostDrone, "spent on the entry, not kept").toBe(false);
  });

  it("disarms the charges that were burning when the drone left, countdown included", () => {
    const game = quietShip(WALKED, 45);
    decoyHunter(game, "r2");
    addWreck(game, game.ship.room("r3").id, "cell", 3);
    raiseAlert(game, MAX_LEVEL, true);
    expect(alertState(game).fuses.length).toBe(1);
    expect(alertState(game).detonateAt).toBeGreaterThanOrEqual(0);
    roundTrip(game);
    expect(alertState(game).fuses).toEqual([]);
    expect(alertState(game).detonateAt).toBe(-1);
    expect(blown(game), "a hull is the same place the second time").toEqual([]);
  });

  it("reads a corrupted record as zero rather than throwing", () => {
    const game = quietShip(WALKED, 46);
    raiseAlert(game, 2);
    game.currentShip.data.ship = "not a record";
    expect(() => roundTrip(game)).not.toThrow();
    expect(alertState(game).level).toBe(0);
  });

  it("fills in what a record from before the ladder does not have, and clamps a five-rung level", () => {
    const game = quietShip(WALKED, 47);
    game.currentShip.data.alert = {
      level: 3, turnsAboard: 10, lastNoiseBump: -10, quietTurns: 0, lastHunter: -15, rolls: 2,
    };
    const st = alertState(game);
    expect(st.level, "the gauge is the old record's").toBe(3);
    expect(st.frozen).toBe(false);
    expect(st.armAt).toBe(-1);
    expect(st.detonateAt).toBe(-1);
    expect(st.fuses).toEqual([]);
    expect(st.peaks).toBe(0);
    expect(() => wait(game, 20)).not.toThrow();
  });

  it("musters 2 + alert machines, all of them in explored compartments two doors from the airlock", () => {
    for (let s = 0; s < 200; s++) {
      const game = quietShip(WALKED, 5000 + s);
      const entry = game.ship.entry;
      alertState(game).level = 4;
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
    const fresh = quietShip(WALKED, 48);
    expect(machines(fresh).length).toBe(0);

    // Nothing but the airlock compartment has been walked.
    const blind = quietShip(LINE, 49);
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

    const once = doorStates(50);
    expect(once, "somebody walked through and left a door open").toContain("d1:open");
    expect(doorStates(50), "the same ship did the same thing").toBe(once);
  });
});

// ------------------------------------------------------------- determinism

describe("the alert is deterministic and keeps to itself", () => {
  it("spends none of the run's randomness, so switching it on re-rolls nothing else", () => {
    const game = secondShip(LINE, 61);
    const before = game.rng.state;

    raiseAlert(game, 4);
    expect(machines(game).length, "the ship did wake things, so there was something to roll").toBe(2);
    expect(game.rng.state, "the alert rolls on the ship's own stream").toBe(before);
  });

  it("replays bit for bit from the seed and the commands", () => {
    const cfg = {
      ...GAME_CONFIG,
      // One hulk per compartment, so the drone has something to be loud about:
      // time alone can no longer fill the gauge — eight quiet turns take a
      // level off and the clock only puts one on every forty — so noise is the
      // only way up, which is the alert working as designed.
      content: { ...SALVOR, monsterChance: () => 1, monstersForDepth: () => [INERT] },
      // Eight compartments: the gauge wants seven fights to reach the hunter
      // and a hulk only dies once.
      firstShip: () =>
        shipFromText(`
          TUG -a1- r1
          r1 -d1- r2 -d2- r3 -d3- r4 -d4- r5 -d5- r6 -d6- r7 -d7- r8
          r1: docking
          r2: hold
          r3: hab
          r4: reactor
          r5: control
          r6: hold
          r7: hab
          r8: control
        `).ship,
      firstShipId: "1",
      systems: [ALERT],
    };
    const seed = 62;

    // Seven fights, five quiet turns apart: seven raises, and the seventh is
    // the hunter.
    const first = new RoomGame({ ...cfg, seed });
    for (const label of ["d1", "d2", "d3", "d4", "d5", "d6", "d7"]) {
      first.playerCommand({ kind: "go", door: first.ship.door(label).id });
      const prey = first.entitiesIn(first.roomOf(first.player).id).find((e) => e.id !== first.player.id);
      if (prey) first.playerCommand({ kind: "attack", target: prey.id });
      wait(first, 5);
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
    expect(again.ship.doors.map((d) => d.state)).toEqual(first.ship.doors.map((d) => d.state));
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
      roomPlay({ maxSteps: 3000, make: (seed) => newGame(seed) }),
    );
    expect(summary.stuck, formatSummary(summary)).toBe(0);
  });
});

/**
 * A door the drone walks through with nothing in its hands — the ship's own
 * rule for a door it may not lock (`lockable`) and for a compartment it may
 * not blow (`cutsOff`). A blast seals the compartment's doors, which is a
 * wall bare-handed and three turns of cutting otherwise, exactly like a lock
 * the ship turned or a bulkhead the drone welded; a blown compartment whose
 * doors were blown *out* is a wreck the drone walks through.
 */
function walkable(ship: Ship): (d: Door) => boolean {
  return (d) => ship.passable(d, { isPlayer: true });
}

/**
 * The doors' own business on this step: a door outside the compartments that
 * blew went locked or sealed — the ship turned a lock, the drone welded a
 * bulkhead — and that, not the blast, is what closed a route.
 */
function doorsMoved(ship: Ship, before: readonly string[], blownNow: ReadonlySet<RoomId>): boolean {
  return ship.doors.some(
    (d, i) =>
      before[i] !== d.state &&
      (d.state === "locked" || d.state === "sealed") &&
      !blownNow.has(d.a) &&
      !blownNow.has(d.b),
  );
}

/** The airlock and every compartment holding a system that is still down. */
function goals(game: RoomGame): RoomId[] {
  const down = game.ship.rooms.filter((r) => {
    const systems = (r.data as { systems?: unknown }).systems;
    return Array.isArray(systems) && systems.some((s) => (s as { online?: unknown }).online !== true);
  });
  return [game.ship.entry, ...down.map((r) => r.id)];
}

/**
 * The ladder over two hundred careful voyages, read off every derelict's own
 * record once the voyage is over — and the one promise the charges make,
 * checked on every blast of every one of them.
 *
 * Two shares, and both have a floor and a ceiling for a reason. The charges
 * have to be *reachable* by a bot that never reads the panel, or the scuttle
 * is a rule that exists only in this file — and they have to be rare, or every
 * sortie ends the same way. Compartments have to go up at all, and the drone
 * has to walk out of most of the sorties it happens in: a charge that kills
 * the drone in the compartment it stood in is an execution, not a warning.
 */
describe("the ladder over 200 careful voyages", () => {
  const tally = { sorties: 0, peaks: 0, blasts: 0, blastDeaths: 0, detonations: 0, cutOff: 0 };
  for (const seed of seedRange(1, 200)) {
    let game: SalvorGame | undefined;
    const bot = BOTS_ROOMS.careful!();
    const rng = new Rng(seed ^ 0x90);
    game = newGame(seed);
    let idle = 0;
    for (let step = 0; step < 1500 && !game.isOver() && idle < 12; step++) {
      // A fuse about to reach zero: what the drone can reach now is what it
      // must still reach after the blast, bare-handed and with a cutter.
      const armed = !isTug(game) && alertState(game).fuses.some((f) => f.at - alertState(game).turnsAboard <= 1);
      // Bare-handed, the way the ship judges it; a turn the doors moved on
      // as well — a lock the ship turned, a bulkhead the drone welded — is
      // the doors' business and is left to their own tests.
      const had = armed
        ? (() => {
            const here = game!.roomOf(game!.player).id;
            const map = RoomDistance.from(game!.ship, [here], walkable(game!.ship));
            return goals(game!).filter((g) => Number.isFinite(map.at(g)));
          })()
        : [];
      const doorsBefore = armed ? game.ship.doors.map((d) => d.state) : [];
      const blownBefore = new Set(armed ? game.ship.rooms.filter(isBlown).map((r) => r.id) : []);
      const blastsBefore = armed ? alertState(game).blasts : 0;
      const shipBefore = game.shipId;
      const hereBefore = armed ? game.roomOf(game.player).id : -1;
      const before = game.inputs.length;
      game.playerCommand(bot(game, rng));
      idle = game.inputs.length > before ? 0 : idle + 1;
      if (!armed || isTug(game) || game.shipId !== shipBefore || alertState(game).blasts === blastsBefore) continue;
      const here = game.roomOf(game.player).id;
      // A drone that stepped through a lock with its tools on the same turn
      // has a different bare-handed map for reasons that are not the blast's.
      const blownNow = new Set(game.ship.rooms.filter((r) => isBlown(r) && !blownBefore.has(r.id)).map((r) => r.id));
      if (here !== hereBefore || isBlown(game.roomOf(game.player))) continue;
      if (doorsMoved(game.ship, doorsBefore, blownNow)) continue;
      const map = RoomDistance.from(game.ship, [here], walkable(game.ship));
      for (const g of had) if (!Number.isFinite(map.at(g))) tally.cutOff++;
    }
    for (const id of game.ships.ids()) {
      if (id === TUG_ID) continue;
      const stored = game.ships.get(id)!;
      const st = stored.data.alert as AlertState | undefined;
      if (st === undefined) continue;
      tally.sorties += stored.visits;
      tally.peaks += st.peaks;
      tally.blasts += st.blasts;
      tally.blastDeaths += st.blastDeaths;
      tally.detonations += st.detonated ? 1 : 0;
    }
  }
  const report = JSON.stringify(tally);

  it("reaches the charges on between 5 and 40 % of sorties", () => {
    const share = tally.peaks / tally.sorties;
    expect(share, report).toBeGreaterThanOrEqual(0.05);
    expect(share, report).toBeLessThanOrEqual(0.4);
  });

  it("blows compartments up at all, and the drone survives most of the ones it stood in", () => {
    expect(tally.blasts, report).toBeGreaterThan(0);
    expect(tally.blastDeaths / tally.blasts, report).toBeLessThan(0.3);
  });

  it("never cuts the drone off from the airlock or from a system still down", () => {
    expect(tally.cutOff, report).toBe(0);
  });
});
