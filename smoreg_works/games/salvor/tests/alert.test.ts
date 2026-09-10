import { describe, it, expect } from "vitest";
import {
  Rng,
  RoomDistance,
  RoomGame,
  isAlive,
  rememberRoom,
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
  runBotOn,
  roomPlay,
  seedRange,
  shipFromText,
} from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { CROWD, ENFORCER, MONSTERS, type Machine } from "../src/content/monsters.js";
import { TUG_ID, isTug } from "../src/content/tug.js";
import {
  ALERT,
  DOOR_PERIOD,
  HUNTER_LEVEL,
  MAX_LEVEL,
  SCUTTLE_PERIOD,
  SCUTTLE_WARN,
  alertState,
  raiseAlert,
  standDown,
  type AlertState,
} from "../src/systems/alert.js";
import { addWreck, hostilesIn, install, rigOf } from "../src/twist/rig.js";
import { t } from "../src/i18n.js";
import { engage, isStop } from "../src/ui/auto.js";
import { htmlOf, lineHtml } from "../src/ui/web/panel-html.js";

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

/**
 * The same, one derelict later: the run's first hull is the tutorial and its
 * ladder wakes nothing at two and three, so a test about what those rungs
 * wake has to stand on the second.
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

/** What the rack and the core add up to: the number the vacuum takes from. */
function durability(game: RoomGame): number {
  const rig = rigOf(game.player);
  const rack = rig ? rig.slots.reduce((n, s) => n + (s?.integrity ?? 0), 0) : 0;
  return rack + game.player.hp;
}

function logged(game: RoomGame, text: string): number {
  return game.log.lines.filter((l) => l.text === text).length;
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
    // The first rung of the ladder is the word and nothing else: the ship has
    // noticed, and says so, and that is all a step of the tutorial clock costs.
    expect(machines(game).length, "level one costs the drone nothing").toBe(before);
    expect(logged(game, "Alert: NOTICED.")).toBe(1);
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

  it("a raise at the top of the gauge costs the ship nothing", () => {
    const game = quietShip(LINE, 64064);
    decoyHunter(game, "r4");
    const st = alertState(game);
    raiseAlert(game, 5);
    expect(st.level).toBe(5);
    const before = machines(game).length;

    // The first derelict's own period is 80 turns; the gauge is already full
    // and the ship's hunter is already out, so the due date passes and nothing
    // at all comes of it. Nothing aboard has been walked, so there is nothing
    // to vent either.
    wait(game, 79);
    expect(st.turnsAboard).toBe(79);
    expect(machines(game).length).toBe(before);
  });
});

// ----------------------------------------------------------------- the ladder

describe("the ladder: every rung once, on the way up", () => {
  it("0 → 5 in one go posts one, sends one, wakes the hunter, and a raise at 5 adds nothing", () => {
    const game = secondShip(OPEN_WALKED, 31337);
    const st = alertState(game);
    const here = game.roomOf(game.player).id;

    raiseAlert(game, 7);
    expect(st.level).toBe(5);
    // Level 2 posts one, level 3 sends one, level 4 is the ENFORCER: three.
    expect(machines(game).length).toBe(3);
    expect(enforcers(game).length).toBe(1);
    const woken = machines(game).filter((m) => m.name !== ENFORCER.name);
    expect(woken.filter((m) => m.data?.targetRoom === here).length, "the one sent at level 3").toBe(1);
    expect(woken.filter((m) => m.data?.targetRoom === undefined).length, "the one posted at level 2").toBe(1);
    for (const m of machines(game)) {
      expect(doorsAway(game.ship, here, m.room!), `${m.name} woke too close`).toBeGreaterThanOrEqual(2);
    }

    // Each rung's line exactly once, and the top of the gauge says what it is.
    for (const word of ["NOTICED", "SEARCHING", "HUNTING", "HUNTER", "SCUTTLE"]) {
      expect(logged(game, `Alert: ${word}.`), word).toBe(1);
    }
    expect(game.log.lines.some((l) => l.text.startsWith(`SCUTTLE: in ${SCUTTLE_WARN} turns`))).toBe(true);

    // Provoked again at the top: nothing new is woken and nothing is said twice.
    const before = machines(game).length;
    raiseAlert(game, 3);
    expect(machines(game).length).toBe(before);
    expect(logged(game, "Alert: SCUTTLE.")).toBe(1);
  });

  it("climbs a rung again only after the gauge has fallen off it", () => {
    const game = secondShip(OPEN_WALKED, 77);
    const st = alertState(game);
    raiseAlert(game, 3);
    expect(machines(game).length).toBe(2);

    // Fifteen quiet turns: the ship stops looking, and the one it sent at
    // three is the ship's to keep. Coming back up to three sends one more —
    // it is a transition, and a transition is answered every time.
    wait(game, 15);
    expect(st.level).toBe(2);
    raiseAlert(game);
    expect(st.level).toBe(3);
    expect(machines(game).length).toBe(3);
  });

  it("wakes nothing at two and three on the run's first derelict, which is the tutorial", () => {
    const first = quietShip(OPEN_WALKED, 78);
    raiseAlert(first, 3);
    expect(machines(first).length, "the word, the doors, and later the hunter — no extra machines").toBe(0);
    expect(logged(first, "Alert: HUNTING.")).toBe(1);
    raiseAlert(first);
    expect(enforcers(first).length, "the hunter still comes").toBe(1);
  });

  it("wakes tougher machines from level four: the hunter carries +1 at four and +2 at five", () => {
    const game = quietShip(LINE, 4004);
    raiseAlert(game, HUNTER_LEVEL);
    const first = enforcers(game)[0]!;
    expect(first.hp).toBe(ENFORCER.hp + 1);
    expect(first.hpMax).toBe(ENFORCER.hp + 1);

    first.hp = 0;
    raiseAlert(game);
    expect(alertState(game).level).toBe(MAX_LEVEL);
    wait(game, 15);
    const second = enforcers(game)[0]!;
    expect(second.hp).toBe(ENFORCER.hp + 2);
    expect(second.hpMax).toBe(ENFORCER.hp + 2);
  });

  it("wakes machines of the compartment's own depth, and skips a depth with nothing in it", () => {
    // Real catalogue, real bands: what wakes two doors into a four-room line is
    // a depth-2 or depth-3 machine and never something from the deep water.
    const game = secondShip(OPEN_WALKED, 909, { monstersForDepth: SALVOR.monstersForDepth });
    decoyHunter(game, "r2");
    raiseAlert(game, 3);
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

describe("from level three the ship shuts doors behind the drone", () => {
  it("closes one open door every ten turns, and never one of the drone's own compartment", () => {
    const game = quietShip(OPEN_WALKED, 3003);
    // A witness, so silence never talks the ship back down under three: a
    // scout one open door out sees the drone. d1 is the drone's own door and
    // the one the ship may never touch, which is what keeps the witness looking.
    put(game, "r2", MONSTERS.find((m) => m.id === "scout")!, { behaviour: "static" });
    raiseAlert(game, 3);
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

  it("at five it locks them — with no key aboard — and never the last free way home", () => {
    const game = quietShip(LOOP, 5005);
    standIn(game, "r4");
    // The witness sits in r3, looking through d3 — the drone's own door.
    put(game, "r3", MONSTERS.find((m) => m.id === "scout")!, { behaviour: "static" });
    decoyHunter(game, "r2");
    raiseAlert(game, 5);

    wait(game, 4 * DOOR_PERIOD);
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

// ---------------------------------------------------------------- the scuttle

describe("at five the ship starts venting its own compartments", () => {
  it("counts twelve turns down and then vents the farthest walked compartment every ten", () => {
    const game = quietShip(WALKED, 6006);
    decoyHunter(game, "r2");
    const posted = put(game, "r4", INERT);
    addWreck(game, game.ship.room("r4").id, "cell", 3);
    raiseAlert(game, 5);
    const st = alertState(game);
    const vented = () => game.ship.rooms.filter((r) => r.hazard === "vented").map((r) => r.label);

    loudWait(game, SCUTTLE_WARN - 1);
    expect(vented(), "the last warning is still running").toEqual([]);
    loudWait(game, 1);
    expect(vented(), "the farthest compartment the drone has walked").toEqual(["r4"]);
    expect(isAlive(posted), "nothing in it survives").toBe(false);
    expect(game.entities.includes(posted)).toBe(false);
    expect(game.ship.room("r4").data.wrecks, "the scrap went out with the air").toEqual([]);
    expect(st.vents).toBe(1);
    expect(logged(game, "The ship vents REACTOR. Everything in it is gone.")).toBe(1);

    loudWait(game, SCUTTLE_PERIOD - 1);
    expect(vented()).toEqual(["r4"]);
    loudWait(game, 1);
    expect(vented(), "then the next farthest, ten turns later").toEqual(["r3", "r4"]);
    // Never the airlock's compartment, never the drone's, never one door out.
    loudWait(game, 3 * SCUTTLE_PERIOD);
    expect(vented()).toEqual(["r3", "r4"]);
  });

  it("costs a drone that walks into a vented compartment every turn it stands there", () => {
    const game = quietShip(WALKED, 6007);
    decoyHunter(game, "r2");
    raiseAlert(game, 5);
    loudWait(game, SCUTTLE_WARN);
    expect(game.ship.room("r4").hazard).toBe("vented");
    // The ship has been locking doors behind the drone meanwhile; that is the
    // block above's business, and here the drone is given the walk.
    for (const door of game.ship.doors) if (door.state === "locked") door.state = "closed";

    walkTo(game, "r4");

    let last = durability(game);
    for (let turn = 0; turn < 3; turn++) {
      wait(game, 1);
      const now = durability(game);
      expect(now, `turn ${turn} in the vacuum`).toBeLessThan(last);
      last = now;
    }
    // Every blow was signed by the vacuum and none by "Something" — and `Tab`,
    // with nothing in sight, says what is hitting the drone rather than that
    // there is no target (docs/tasks/G83-anonymous-blows.md, 1).
    expect(game.log.lines.some((l) => l.key === "log.hit.vent")).toBe(true);
    expect(game.log.lines.some((l) => l.key === "log.hit.module")).toBe(false);
    expect(game.visibleMonsters()).toHaveLength(0);
    const fight = engage(game);
    expect(isStop(fight) ? fight.stop : fight.cmd).toBe(t("why.fight.hazard"));

    // Out again, and it stops: the vacuum is a place, not a status.
    walkTo(game, "r3");
    const outside = durability(game);
    wait(game, 2);
    expect(durability(game)).toBe(outside);
  });

  it("shows the compartment as vented on the schematic and names it on the panel", async () => {
    const { schematicInputOf } = await import("../src/ui/schematic-input.js");
    const { panelBlocks } = await import("../src/ui/panel.js");
    const game = quietShip(WALKED, 6008);
    game.ship.room("r4").hazard = "vented";
    const box = schematicInputOf(game).rooms.find((r) => r.label === "r4")!;
    expect(box.glyphs).toContain("~");

    walkTo(game, "r4");
    const lines = panelBlocks(game, []).map((l) => l.text);
    expect(lines.some((l) => l.includes("no atmosphere"))).toBe(true);
  });
});

// -------------------------------------------------------------- neutralised

describe("a neutralised ship stops answering", () => {
  it("with three systems up the gauge does not move, no door shuts and nothing is vented", () => {
    const game = secondShip(OPEN_WALKED, 7007);
    decoyHunter(game, "r2");
    raiseAlert(game, 3);
    const st = alertState(game);
    game.currentShip.data.ship = { online: ["ENGINE", "CORE", "TERMINAL"] };
    const doors = game.ship.doors.map((d) => d.state);

    loudWait(game, 100);
    expect(st.level).toBe(3);
    expect(game.ship.doors.map((d) => d.state)).toEqual(doors);
    expect(game.ship.rooms.filter((r) => r.hazard === "vented")).toEqual([]);
    // The decoy, the one posted at two and the one sent at three: all still
    // there, and nothing has joined them.
    expect(machines(game).length, "what was awake stays awake, and nothing joins it").toBe(3);
    expect(ALERT.panelLines?.(game)?.[0]?.text).toBe("ALERT ▮▮▮▯▯ OFF");
  });

  it("stands down the moment the ship says so, countdown included", () => {
    const game = quietShip(WALKED, 7008);
    decoyHunter(game, "r2");
    raiseAlert(game, 5);
    expect(ALERT.panelLines?.(game)?.[0]?.text).toBe(`ALERT ▮▮▮▮▮ SCUTTLE IN ${SCUTTLE_WARN}`);

    standDown(game);
    expect(logged(game, "The ship stands down. Neutralised, it stops answering.")).toBe(1);
    expect(ALERT.panelLines?.(game)?.[0]).toEqual({ text: "ALERT ▮▮▮▮▮ OFF" });
    loudWait(game, SCUTTLE_WARN + SCUTTLE_PERIOD);
    expect(game.ship.rooms.filter((r) => r.hazard === "vented")).toEqual([]);
    raiseAlert(game, 2);
    expect(alertState(game).level).toBe(5);
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
      alertState(game).level = 5;
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

  it("shows up in the panel as a line of its own, with the rung's word after the bar", () => {
    const game = quietShip(LOCKED, 35);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▯▯▯▯▯" }]);

    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▯▯▯▯ NOTICED" }]);
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▯▯▯ SEARCHING" }]);

    // Three is where the gauge turns amber and the doors start shutting.
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([{ text: "ALERT ▮▮▮▯▯ HUNTING", fg: "#d9b56a" }]);

    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([
      { text: "ALERT ▮▮▮▮▯ HUNTER", fg: "#d9b56a" },
      { text: "HUNTER aboard", fg: "#d96a6a" },
    ]);

    // The top is a countdown, and it ticks on the panel.
    raiseAlert(game);
    expect(ALERT.panelLines?.(game)).toEqual([
      { text: `ALERT ▮▮▮▮▮ SCUTTLE IN ${SCUTTLE_WARN}`, fg: "#d96a6a" },
      { text: "HUNTER aboard", fg: "#d96a6a" },
    ]);
    loudWait(game, 5);
    expect(ALERT.panelLines?.(game)?.[0]).toEqual({
      text: `ALERT ▮▮▮▮▮ SCUTTLE IN ${SCUTTLE_WARN - 5}`,
      fg: "#d96a6a",
    });
  });

  it("carries its level onto the page as a class, and is lifted above the rack from three", () => {
    const html = (level: number, word: string) =>
      lineHtml({ text: `ALERT ${"▮".repeat(level)}${"▯".repeat(5 - level)} ${word}`.trim() });
    expect(html(0, "")).toContain("web-alert is-l0");
    expect(html(3, "HUNTING")).toContain("web-alert is-l3");
    expect(html(5, "SCUTTLE IN 4")).toContain("web-alert is-l5");
    // The rival's bar is a bar too, and is not the alert.
    expect(lineHtml({ text: "RIVAL ▮▯▯" })).not.toContain("web-alert");

    const page = (text: string) =>
      htmlOf([{ text: "1 CUTTER ▮▮▮▯" }, { text: "" }, { text: "KEYS  0" }, { text }], [], [], 0);
    expect(page("ALERT ▮▮▯▯▯ SEARCHING")).not.toContain("web-alarm");
    const lifted = page("ALERT ▮▮▮▯▯ HUNTING");
    expect(lifted.indexOf("web-alarm is-l3")).toBeGreaterThanOrEqual(0);
    expect(lifted.indexOf("web-alarm"), "first thing on the page").toBeLessThan(lifted.indexOf("CUTTER"));
    expect(page("ALERT ▮▮▮▮▮ SCUTTLE IN 3")).toContain("web-alarm is-l5");
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
  it("survives a trip to the tug and back, and comes back two steps calmer", () => {
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
    expect(st.level, "cycling out through the airlock is two steps, not a reset").toBe(1);
  });

  it("keeps a floor equal to the systems the drone raised", () => {
    const game = quietShip(WALKED, 42);
    decoyHunter(game, "r4");
    raiseAlert(game, 4);
    // What the SHIP system (G17) writes into the same per-ship pocket.
    game.currentShip.data.ship = { online: ["ENGINE", "CORE"] };

    roundTrip(game);
    expect(alertState(game).level, "four less two, on a floor of two").toBe(2);

    alertState(game).level = 5;
    roundTrip(game);
    expect(alertState(game).level, "five less two, over the floor").toBe(3);

    alertState(game).level = 2;
    roundTrip(game);
    expect(alertState(game).level, "never under the floor").toBe(2);
  });

  it("leaving at the top comes back to three and a full muster; dying aboard comes back to two", () => {
    const left = quietShip(WALKED, 43);
    alertState(left).level = 5;
    const before = new Set(left.entities.map((e) => e.id));
    roundTrip(left);
    expect(alertState(left).level).toBe(3);
    // 2 + 2 × 5 is twelve, a hand-drawn hull holds eight, and the two
    // compartments deep enough to muster into hold three each (`CROWD`): the
    // muster is sized by how alarmed the ship was, and capped by what it can
    // hold — and by where it can put it.
    expect(machines(left).filter((e) => !before.has(e.id)).length).toBe(2 * CROWD);

    const died = quietShip(WALKED, 44);
    alertState(died).level = 5;
    // The death hook, exactly as the engine calls it when a machine's blow
    // lands: the voyage moves the operator home afterwards, and here the trip
    // is made by hand.
    died.onDeath(died.player);
    expect(alertState(died).lostDrone).toBe(true);
    roundTrip(died);
    expect(alertState(died).level).toBe(2);
    expect(alertState(died).lostDrone, "spent on the entry, not kept").toBe(false);
  });

  it("reads a corrupted record as zero rather than throwing", () => {
    const game = quietShip(WALKED, 45);
    raiseAlert(game, 2);
    game.currentShip.data.ship = "not a record";
    expect(() => roundTrip(game)).not.toThrow();
    expect(alertState(game).level).toBe(0);
  });

  it("fills in what a record from before the ladder does not have", () => {
    const game = quietShip(WALKED, 46);
    game.currentShip.data.alert = {
      level: 3, turnsAboard: 10, lastNoiseBump: -10, quietTurns: 0, lastHunter: -15, rolls: 2,
    };
    const st = alertState(game);
    expect(st.level, "the gauge is the old record's").toBe(3);
    expect(st.frozen).toBe(false);
    expect(st.scuttleFrom).toBe(-1);
    expect(st.peaks).toBe(0);
    expect(() => wait(game, 20)).not.toThrow();
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
    const fresh = quietShip(WALKED, 47);
    expect(machines(fresh).length).toBe(0);

    // Nothing but the airlock compartment has been walked.
    const blind = quietShip(LINE, 48);
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

    const once = doorStates(49);
    expect(once, "somebody walked through and left a door open").toContain("d1:open");
    expect(doorStates(49), "the same ship did the same thing").toBe(once);
  });
});

// ------------------------------------------------------------- determinism

describe("the alert is deterministic and keeps to itself", () => {
  it("spends none of the run's randomness, so switching it on re-rolls nothing else", () => {
    const game = secondShip(LINE, 61);
    const before = game.rng.state;

    raiseAlert(game, 4);
    expect(machines(game).length, "the ship did wake things, so there was something to roll").toBe(3);
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
    // hunter — with a posted machine and two dispatched ones on the way.
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
      roomPlay({ maxSteps: 1200, make: (seed) => newGame(seed) }),
    );
    expect(summary.stuck, formatSummary(summary)).toBe(0);
  });
});

/**
 * The ladder over two hundred careful voyages, read off every derelict's own
 * record once the voyage is over.
 *
 * Two shares, and both have a floor and a ceiling for a reason. The top of the
 * gauge has to be *reachable* by a bot that never reads the panel, or the
 * scuttle is a rule that exists only in this file — and it has to be rare, or
 * every sortie ends the same way. Venting has to happen at all, and the drone
 * has to walk out of most of the sorties it happens in: a scuttle that kills
 * the drone in the compartment it just vented is an execution, not a warning.
 */
describe("the ladder over 200 careful voyages", () => {
  const tally = { sorties: 0, peaks: 0, ventSorties: 0, ventDeaths: 0 };
  for (const seed of seedRange(1, 200)) {
    let game: SalvorGame | undefined;
    runBotOn(BOTS_ROOMS.careful!, seed, roomPlay({ maxSteps: 1500, make: (s) => (game = newGame(s)) }));
    for (const id of game!.ships.ids()) {
      if (id === TUG_ID) continue;
      const stored = game!.ships.get(id)!;
      const st = stored.data.alert as AlertState | undefined;
      if (st === undefined) continue;
      tally.sorties += stored.visits;
      tally.peaks += st.peaks;
      tally.ventSorties += st.ventSorties;
      tally.ventDeaths += st.ventDeaths;
    }
  }
  const report = JSON.stringify(tally);

  it("reaches the top of the gauge on between 5 and 40 % of sorties", () => {
    const share = tally.peaks / tally.sorties;
    expect(share, report).toBeGreaterThanOrEqual(0.05);
    expect(share, report).toBeLessThanOrEqual(0.4);
  });

  it("vents on at least 1 % of sorties, and the drone survives most of those", () => {
    const share = tally.ventSorties / tally.sorties;
    expect(share, report).toBeGreaterThanOrEqual(0.01);
    expect(tally.ventDeaths / tally.ventSorties, report).toBeLessThan(0.3);
  });
});
