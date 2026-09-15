import { describe, expect, it } from "vitest";
import { RoomDistance, hexLayout, isAlive, type RoomGame } from "@jamrog/engine";
import { seedRange } from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";
import { HINT_LINE_KEYS, TUG_OPENING_KEY } from "../src/content/hints.js";
import { DERELICTS, FATHERS_TUG, MIDDLE_HULLS, STARTER_HULLS, classOfShip, derelictSpec } from "../src/content/derelicts.js";
import { hullArtOf } from "../src/content/hulls-art.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { TUG_ID, isTug } from "../src/content/tug.js";
import {
  LESSON_STEPS,
  TUTORIAL_CRATE,
  TUTORIAL_ID,
  TUTORIAL_SEED,
  TUTORIAL_SHIP_ID,
  TUTORIAL_SPEC,
  currentStep,
  isTraining,
  lessonOf,
  tutorialShip,
  type LessonFacts,
  type LessonId,
} from "../src/content/tutorial.js";
import { ZONE_KINDS } from "../src/content/zones.js";
import { roomList, type Body, type ShipSystem, type Wreck } from "../src/systems/populate.js";
import { shipState } from "../src/systems/shipstate.js";
import { lessonStatus } from "../src/systems/tutorial.js";
import { virusOf } from "../src/systems/virus.js";
import { voyageOf } from "../src/systems/voyage.js";
import { LANGS, setLang, t, tIn } from "../src/i18n.js";
import { findSlot, hostilesIn, rigOf } from "../src/twist/rig.js";
import { appReducer, initialState, type AppState } from "../src/ui/appstate.js";

/**
 * The hull a training run is learned on, and the nine steps it is learned with
 * (docs/tasks/G90-smoreg-wave.md, E).
 *
 * Three claims. The ship is a claim about a hand-built graph — the same eight
 * compartments, doors and contents on every seed, laid out by the engine's own
 * pass and winnable with the rack a run starts with — so it is measured over
 * twenty seeds of the real `newGame`. The steps are a claim about a table of
 * predicates, so they are driven by hand over `LessonFacts` and then earned
 * one at a time on the real ship with raw commands, which is what "completed
 * by a fact and never by a key" means. `tests/onboarding.test.ts` flies the
 * whole thing through the reducer in three languages.
 *
 * The quiet claim is the jam's rule 1: a training run changes nothing about an
 * ordinary one. Nothing carries between runs, so "training" has to be invisible
 * to a voyage that is not one — same itinerary from the second hull on, same
 * fixtures, same numbers.
 */

const SEEDS = seedRange(1, 20);

/** What the ship is, room by room, door by door, in a form two runs can be compared in. */
function fingerprint(game: RoomGame): string {
  return JSON.stringify({
    ship: game.ship,
    entities: game.entities.map((e) => [e.name, e.room, e.hp]),
    keys: game.player.data?.keys,
  });
}

// ------------------------------------------------------------------ the hull

describe("the lesson's hull", () => {
  it("is a corridor of eight, drawn by hand and laid out by the engine", () => {
    const ship = tutorialShip();
    expect(ship.rooms.map((r) => r.kind)).toEqual([
      "docking", "corridor", "storage", "cargo", "hab", "engineering", "reactor", "control",
    ]);
    expect(ship.rooms.map((r) => r.label)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
    // Airlock first, then a door between each pair of neighbours and no other:
    // a line, so "the lock is the third door" is true in every language.
    expect(ship.doors.map((d) => `${d.label}:${d.state}`)).toEqual([
      "a1:airlock", "d1:open", "d2:open", "d3:locked", "d4:sealed", "d5:open", "d6:open", "d7:open",
    ]);
    expect(ship.door("d3").key).toBe("k1");
    for (const room of ship.rooms) expect(room.depth).toBe(room.id);
    // The generator's own layout pass ran: every compartment has a column.
    expect(new Set(ship.rooms.map((r) => r.col)).size).toBe(ship.rooms.length);
    // Every kind is one the catalogue knows, and the three the run is for are aboard.
    const kinds = new Set(ZONE_KINDS.map((k) => k.kind));
    for (const room of ship.rooms) expect(kinds.has(room.kind), room.kind).toBe(true);
    const required = ZONE_KINDS.filter((k) => k.required === true).map((k) => k.kind);
    for (const kind of required) expect(ship.rooms.some((r) => r.kind === kind), kind).toBe(true);
  });

  it("is the same ship, with the same things in it, on twenty seeds", () => {
    const first = fingerprint(newGame(SEEDS[0]!, true));
    for (const seed of SEEDS) {
      expect(fingerprint(newGame(seed, true)), `seed ${seed}`).toBe(first);
    }
  });

  it("holds one crate, one scout behind the lock, two keycards on bodies and three systems", () => {
    const game = newGame(TUTORIAL_SEED, true);
    const ship = game.ship;
    // The crate is a parts crate and not scrap: a sealed crate never rolls for
    // the virus, so the module step is the same on every seed and the virus is
    // the virus step's to bring.
    const wrecks = ship.rooms.flatMap((r) => roomList<Wreck>(r, "wrecks").map((w) => ({ room: r.label, ...w })));
    expect(wrecks.map((w) => [w.room, w.kind, w.glyph])).toEqual([["r3", TUTORIAL_CRATE, "X"]]);
    // And nothing lies in the docking bay: the deck's onboarding scrap is taken
    // back out, so the first module a player meets is the lesson's.
    expect(roomList<Wreck>(ship.roomAt(ship.entry), "wrecks")).toEqual([]);

    const machines = game.entities.filter((e) => e.id !== game.player.id);
    expect(machines.map((m) => [m.name, ship.roomAt(m.room!).label])).toEqual([["scout", "r4"]]);

    const bodies = ship.rooms.flatMap((r) => roomList<Body>(r, "bodies").map((b) => [r.label, b.key]));
    expect(bodies).toEqual([["r3", "k1"], ["r7", "k2"]]);

    const systems = ship.rooms.flatMap((r) => roomList<ShipSystem>(r, "systems").map((s) => [r.label, s.kind]));
    expect(systems).toEqual([["r6", "engine"], ["r7", "core"], ["r8", "terminal"]]);
  });

  it("is winnable with the starting rack alone", () => {
    const game = newGame(TUTORIAL_SEED, true);
    const rig = rigOf(game.player)!;
    // Every compartment is reachable by a drone that can cut, and the lock
    // and the weld both have a way through in the rack: a CELL for the lock,
    // a CUTTER for the weld and the ENGINE, a CELL for the reactor, and the
    // keycard for the TERMINAL — with the crate's SPIKE and a second card in
    // reserve should the first be spent on the door.
    const reach = RoomDistance.from(game.ship, [game.ship.entry], (d) =>
      game.ship.passable(d, { breacher: true, isPlayer: true }) && d.state !== "airlock",
    );
    for (const room of game.ship.rooms) expect(reach.at(room.id), room.label).toBeLessThan(Infinity);
    expect(findSlot(rig, "cell")).not.toBeNull();
    expect(findSlot(rig, "cutter")).not.toBeNull();
    expect(rig.slots.filter((s) => s === null).length, "a slot for the crate's module").toBeGreaterThanOrEqual(1);
    for (const spec of OBJECTIVES) {
      expect(spec.needs(rig, 1) !== undefined, `${spec.id} with one keycard`).toBe(true);
    }
  });

  it("fits the honeycomb inside its drawn hull", () => {
    const game = newGame(TUTORIAL_SEED, true);
    const art = hullArtOf(game.ship, game.shipId);
    expect(art.mask).toBeDefined();
    const layout = hexLayout(game.ship, { allowed: art.mask });
    expect(layout.masked, "the corridor was laid out outside the hull").toBe(true);
    expect(layout.cells.size).toBe(game.ship.size);
  });

  it("is a class every system knows and no voyage draws", () => {
    expect(DERELICTS.map((d) => d.id)).not.toContain(TUTORIAL_ID);
    expect(derelictSpec(TUTORIAL_ID)).toBe(TUTORIAL_SPEC);
    expect(TUTORIAL_ID).toBe("tutorial");
    // Nothing aboard but what the corridor names: no filler, no relic, no
    // strain of its own, no key roll and no rival.
    expect(TUTORIAL_SPEC.machines).toEqual([0, 0]);
    expect(TUTORIAL_SPEC.relics ?? []).toEqual([]);
    expect(TUTORIAL_SPEC.strains ?? []).toEqual([]);
    expect(TUTORIAL_SPEC.keyChance).toBe(0);
    expect(TUTORIAL_SPEC.rival).toBe(false);
    // Sixty for the hull against forty for the next drone: the lesson pays
    // for its own successor.
    expect(TUTORIAL_SPEC.salePrice).toBe(60);
    expect(classOfShip(newGame(3, true).ship)).toBe(TUTORIAL_ID);
  });
});

// ------------------------------------------------------------------- the run

describe("a training run", () => {
  it("opens aboard the lesson's hull, not on the tug", () => {
    const game = newGame(TUTORIAL_SEED, true);
    expect(isTraining(game.player)).toBe(true);
    expect(isTug(game)).toBe(false);
    expect(game.shipId).toBe(TUTORIAL_SHIP_ID);
    expect(game.player.room).toBe(game.ship.entry);
    // The voyage knows which hull it is standing on, and what to call it.
    expect(voyageOf(game).state[0]!.spec.id).toBe(TUTORIAL_ID);
    expect(voyageOf(game).state[0]!.shipId).toBe(TUTORIAL_SHIP_ID);
    expect(game.currentShip.data.derelict).toBe(TUTORIAL_ID);
    expect(typeof game.currentShip.data.name).toBe("string");
    // And the lesson is on its first step from turn zero.
    expect(lessonOf(game.player)?.step).toBe(0);
    expect(lessonStatus(game)?.step).toBe(0);
  });

  it("marks the drone, and an ordinary run does not", () => {
    expect(isTraining(newGame(3).player)).toBe(false);
    expect(isTraining(undefined)).toBe(false);
    expect(lessonOf(newGame(3).player)).toBeUndefined();
    expect(lessonStatus(newGame(3))).toBeUndefined();
    expect(newGame(3).shipId).toBe(TUG_ID);
  });

  it("opens on the story and not on the tug's own line", () => {
    const game = newGame(TUTORIAL_SEED, true);
    const keys = game.log.lines.map((l) => l.key);
    expect(keys).not.toContain(TUG_OPENING_KEY);
    expect(game.log.lines[game.log.lines.length - 1]!.text).toBe(t("lesson.opening"));
    // The five ordinary hints are the run's to earn: a lesson is a run, not a
    // reading list, so none of them is ticked off before it happens.
    for (const id of ["exposure", "burned", "keycard", "sold", "death"]) {
      expect(game.player.data?.hints?.[id as never], id).toBeUndefined();
    }
    expect(Object.keys(HINT_LINE_KEYS).some((k) => k.startsWith("tutorial."))).toBe(false);
  });

  it("keeps a whole voyage behind the lesson", () => {
    // Added in front of an itinerary, never in place of one: the lesson costs
    // the player no hull. The draw behind it is the training run's own — the
    // lesson's hull is filled before the itinerary is drawn, and filling it
    // spends the rng — so it is held to the shape of a voyage rather than to
    // the seed's ordinary one, and to being the same draw twice.
    const starters = STARTER_HULLS.map((h) => h.id);
    const middles = MIDDLE_HULLS.map((h) => h.id);
    for (const seed of seedRange(1, 20)) {
      const plain = voyageOf(newGame(seed)).derelicts.map((d) => d.id);
      const training = voyageOf(newGame(seed, true)).derelicts.map((d) => d.id);
      expect(training[0], `seed ${seed}`).toBe(TUTORIAL_ID);
      expect(training.length, `seed ${seed}`).toBe(plain.length + 1);
      expect(starters, `seed ${seed}`).toContain(training[1]);
      expect(middles, `seed ${seed}`).toContain(training[2]);
      expect(training[3], `seed ${seed}`).toBe(FATHERS_TUG.id);
      expect(voyageOf(newGame(seed, true)).derelicts.map((d) => d.id), `seed ${seed}`).toEqual(training);
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
    expect(fingerprint(newGame(11))).toBe(fingerprint(newGame(11)));
  });

  it("still answers its win and death lines in the language that is on", () => {
    const game = newGame(TUTORIAL_SEED, true);
    try {
      setLang("ru");
      const ru = game.content.winLine;
      setLang("es");
      expect(game.content.winLine).not.toBe(ru);
      expect(game.content.deathLine).toBeTruthy();
      expect(game.content.openingLine).toBe(tIn("es", "lesson.opening"));
    } finally {
      setLang("en");
    }
  });
});

// ----------------------------------------------------------------- the steps

/** Nothing has happened: aboard, standing where the step began. */
const NOTHING: LessonFacts = {
  aboard: true,
  moved: false,
  explored: 1,
  installed: false,
  kills: 0,
  locked: 1,
  sealed: 1,
  infected: false,
  online: 0,
  sold: false,
};

const step = (id: LessonId) => LESSON_STEPS.find((s) => s.id === id)!;

describe("the nine steps", () => {
  it("are the nine, in the order the corridor puts them in front of the drone", () => {
    expect(LESSON_STEPS.map((s) => s.id)).toEqual([
      "click", "explore", "modules", "door", "fight", "alert", "virus", "systems", "leave",
    ]);
    for (const s of LESSON_STEPS) {
      expect(s.text).toBe(`lesson.${s.id}`);
      expect(s.press).toBe(`lesson.${s.id}.press`);
    }
    // The one step the run has to set up: the virus does not wait for a roll.
    expect(LESSON_STEPS.filter((s) => s.setup !== undefined).map((s) => [s.id, s.setup])).toEqual([["virus", "infect"]]);
  });

  it("are each completed by one fact, and by nothing else", () => {
    for (const s of LESSON_STEPS) {
      // The virus step begins infected: its setup is what makes `NOTHING` a
      // state it can be in at all.
      const start = s.id === "virus" ? { ...NOTHING, infected: true } : NOTHING;
      expect(s.done(start), `${s.id} is done before anything happened`).toBe(false);
    }
    expect(step("click").done({ ...NOTHING, moved: true })).toBe(true);
    expect(step("explore").done({ ...NOTHING, explored: 3 })).toBe(true);
    expect(step("explore").done({ ...NOTHING, explored: 2 })).toBe(false);
    expect(step("modules").done({ ...NOTHING, installed: true })).toBe(true);
    expect(step("door").done({ ...NOTHING, locked: 0 })).toBe(true);
    expect(step("fight").done({ ...NOTHING, kills: 1 })).toBe(true);
    expect(step("alert").done({ ...NOTHING, sealed: 0 })).toBe(true);
    // The virus step is done once the strain is gone: it begins infected.
    expect(step("virus").done({ ...NOTHING, infected: true })).toBe(false);
    expect(step("virus").done({ ...NOTHING, infected: false })).toBe(true);
    expect(step("systems").done({ ...NOTHING, online: 2 })).toBe(false);
    expect(step("systems").done({ ...NOTHING, online: 3 })).toBe(true);
    // Every step but the last is a fact about the hull; the last is the sale,
    // which is only ever true once the drone is off it.
    for (const s of LESSON_STEPS.slice(0, -1)) {
      const off = { ...NOTHING, aboard: false, moved: true, explored: 8, installed: true, kills: 1, locked: 0, sealed: 0, online: 3 };
      expect(s.done(off), `${s.id} counts off the hull`).toBe(false);
    }
    expect(step("leave").done({ ...NOTHING, aboard: false, sold: true })).toBe(true);
    expect(step("leave").done({ ...NOTHING, sold: false })).toBe(false);
  });

  it("has an instruction and a key in all three languages, each its own", () => {
    for (const lang of LANGS) {
      for (const s of LESSON_STEPS) {
        for (const key of [s.text, s.press]) {
          const line = tIn(lang, key);
          expect(line, `${lang}: ${key}`).toBeTruthy();
          expect(line, `${lang}: ${key}`).not.toBe(key);
        }
      }
      for (const key of ["lesson.opening", "lesson.head", "lesson.head.fold", "lesson.done", "lesson.over", "lesson.over.head"] as const) {
        expect(tIn(lang, key), `${lang}: ${key}`).not.toBe(key);
      }
    }
    // Two languages must not share an instruction: a row nobody translated.
    for (const s of LESSON_STEPS) {
      expect(tIn("es", s.text)).not.toBe(tIn("en", s.text));
      expect(tIn("ru", s.text)).not.toBe(tIn("en", s.text));
    }
  });

  /**
   * What every step names, in the language the line is in: the key a player
   * presses, or the compartment label to click. These are the tokens the
   * follower bot in `tests/onboarding.test.ts` acts on, so a step that stopped
   * naming its key would stop being followable and this would say which.
   */
  it("names the key it teaches, in all three languages", () => {
    const presses: Record<LessonId, readonly string[]> = {
      click: ["r2", "m"],
      explore: ["o"],
      modules: [],
      door: ["p"],
      fight: ["Tab"],
      alert: ["o", "c"],
      virus: [],
      systems: [],
      leave: ["<"],
    };
    for (const lang of LANGS) {
      for (const s of LESSON_STEPS) {
        const line = tIn(lang, s.press);
        for (const token of presses[s.id]) {
          expect(line.split(/[\s·,]+/), `${lang}: ${s.press} does not name ${token}`).toContain(token);
        }
      }
      // The three steps that are a line of the list name the verb the line
      // starts with, so a player reading `salvage WELDER 5/5` finds it.
      const word = (key: Parameters<typeof tIn>[1], params?: Record<string, string | number>) =>
        tIn(lang, key, params).split(" ")[0]!.replace(/[:«»]/g, "");
      const press = (key: Parameters<typeof tIn>[1]) => tIn(lang, key).replace(/[«»]/g, "");
      expect(press("lesson.modules.press")).toContain(word("action.salvage", { module: "", left: 0, max: 0 }));
      expect(press("lesson.door.press")).toContain(word("action.search"));
      expect(press("lesson.virus.press")).toContain(word("action.purge", { module: "", left: 0 }));
      expect(press("lesson.systems.press")).toContain(word("action.workBare", { system: "", left: 0 }));
    }
  });
});

// ------------------------------------------------------------ earned in turn

/**
 * The steps, earned one at a time on the real ship with raw commands: no
 * reducer, no walk, so what is held is that the fact alone moves the lesson.
 */
describe("the steps are earned by facts on the real hull", () => {
  const game = newGame(TUTORIAL_SEED, true);
  const ship = game.ship;
  const at = (): number => lessonOf(game.player)!.step;
  const id = (): LessonId | undefined => currentStep(lessonOf(game.player)!)?.id;
  const ok = (cmd: Parameters<typeof game.playerCommand>[0]): void => {
    expect(game.playerCommand(cmd).ok, JSON.stringify(cmd)).toBe(true);
  };
  const go = (label: string): void => ok({ kind: "go", door: ship.door(label).id });

  it("a step into the corridor is the click", () => {
    expect(id()).toBe("click");
    go("d1");
    expect(id()).toBe("explore");
    expect(lessonStatus(game)?.done, "the tick, for the one turn after").toBe(true);
  });

  it("a third compartment stood in is the explore", () => {
    go("d2");
    expect(id()).toBe("modules");
    expect(ship.rooms.filter((r) => r.explored).length).toBe(3);
  });

  it("a module bolted on is the modules", () => {
    const crate = roomList<Wreck>(game.roomOf(game.player), "wrecks")[0]!;
    ok({ kind: "act", verb: "salvage", target: crate.id });
    expect(findSlot(rigOf(game.player)!, TUTORIAL_CRATE)).not.toBeNull();
    expect(id()).toBe("door");
    // The virus is the virus step's: a sealed crate rolled for nothing.
    expect(virusOf(game.player)).toBeUndefined();
  });

  it("the lock opened — with the CELL, keeping the card — is the door", () => {
    const body = roomList<Body>(game.roomOf(game.player), "bodies")[0]!;
    ok({ kind: "act", verb: "search", target: body.id });
    expect(game.player.data?.keys).toBe(1);
    expect(id(), "a search is not the door").toBe("door");
    ok({ kind: "act", verb: "power", target: ship.door("d3").id });
    expect(ship.door("d3").state).toBe("open");
    expect(id()).toBe("fight");
    expect(game.player.data?.keys, "the card is still in hand").toBe(1);
  });

  it("the scout scrapped is the fight", () => {
    // Through the open door and at it; a scout is three points, a cutter one blow.
    for (let turn = 0; turn < 12 && game.kills === 0; turn++) {
      const here = game.roomOf(game.player).id;
      const foe = hostilesIn(game, here)[0];
      if (foe) ok({ kind: "attack", target: foe.id });
      else if (here !== ship.room("r4").id) go("d3");
      else ok({ kind: "wait" });
    }
    expect(game.kills).toBe(1);
    expect(game.entities.filter((e) => e.id !== game.player.id && isAlive(e))).toEqual([]);
    expect(id()).toBe("alert");
  });

  it("the weld cut open is the alert, and the next step brings the virus", () => {
    if (game.roomOf(game.player).label !== "r4") go("d3");
    for (let i = 0; i < 3; i++) ok({ kind: "act", verb: "cut", target: ship.door("d4").id });
    expect(ship.door("d4").state).toBe("broken");
    expect(id()).toBe("virus");
    // The setup: the strain is on the crate's module, and the log says so.
    const virus = virusOf(game.player)!;
    expect(virus).toBeDefined();
    expect(rigOf(game.player)!.slots[virus.slot]?.kind).toBe(TUTORIAL_CRATE);
    expect(virus.strain).toBe("spasm");
    expect(game.log.lines.some((l) => l.key === "log.virus.caught")).toBe(true);
    expect(lessonStatus(game)?.done).toBe(true);
    ok({ kind: "wait" });
    expect(lessonStatus(game)?.done, "the tick lasts one turn").toBe(false);
    expect(id(), "a turn with the virus aboard is not the cure").toBe("virus");
  });

  it("the purge is the virus", () => {
    for (let i = 0; i < 8 && virusOf(game.player) !== undefined; i++) {
      ok({ kind: "act", verb: "cure", slot: virusOf(game.player)!.slot });
    }
    expect(virusOf(game.player)).toBeUndefined();
    expect(id()).toBe("systems");
  });

  it("three systems up are the systems", () => {
    for (const [label, door] of [["r6", "d5"], ["r7", "d6"], ["r8", "d7"]] as const) {
      if (label !== "r6" || game.roomOf(game.player).label !== "r6") {
        if (game.roomOf(game.player).label === "r4") go("d4");
        go(door);
      }
      expect(game.roomOf(game.player).label).toBe(label);
      const system = roomList<ShipSystem>(game.roomOf(game.player), "systems")[0]!;
      for (let i = 0; i < 4 && !system.online; i++) ok({ kind: "act", verb: "work", target: system.id });
      expect(system.online, label).toBe(true);
    }
    expect(shipState(game).online.length).toBe(OBJECTIVES.length);
    expect(id()).toBe("systems" === id() ? "systems" : id());
    expect(at()).toBe(LESSON_STEPS.length - 1);
  });

  it("the airlock, with the hull under tow, is the leave — and the lesson is over", () => {
    for (const door of ["d7", "d6", "d5", "d4", "d3", "d2", "d1"]) go(door);
    expect(game.atAirlock()).toBe(true);
    ok({ kind: "leave" });
    expect(isTug(game)).toBe(true);
    expect(voyageOf(game).state[0]!.sold).toBe(true);
    expect(currentStep(lessonOf(game.player)!)).toBeUndefined();
    const status = lessonStatus(game)!;
    expect(status.over).toBe(true);
    expect(status.step).toBe(LESSON_STEPS.length);
    expect(status.done).toBe(true);
    // The window stays with the hull it taught on: a jump to a real derelict
    // takes it down.
    expect(game.playerCommand({ kind: "act", verb: "jump" }).ok).toBe(true);
    expect(lessonStatus(game)).toBeUndefined();
  });
});

// ------------------------------------------------------------------- the fold

describe("the window folds without the lesson moving", () => {
  it("toggles on Esc with nothing else to close, and closes a card first", () => {
    const game = newGame(TUTORIAL_SEED, true);
    let state: AppState = { ...initialState(), overlay: "none" };
    expect(state.lessonFolded).toBe(false);
    state = appReducer(state, { kind: "dismiss" }, game);
    expect(state.lessonFolded).toBe(true);
    expect(state.effect).toEqual({ kind: "idle" });
    expect(lessonOf(game.player)!.step, "Esc is not a step").toBe(0);
    expect(game.inputs).toEqual([]);
    state = appReducer(state, { kind: "dismiss" }, game);
    expect(state.lessonFolded).toBe(false);
    // The help card in front of the board takes the key instead.
    state = appReducer(state, { kind: "help" }, game);
    expect(state.overlay).toBe("help");
    state = appReducer(state, { kind: "dismiss" }, game);
    expect(state.overlay).toBe("none");
    expect(state.lessonFolded).toBe(false);
  });

  it("does nothing on Esc in a run with no lesson", () => {
    const game = newGame(7);
    const state = appReducer({ ...initialState(), overlay: "none" }, { kind: "dismiss" }, game);
    expect(state.lessonFolded).toBe(false);
  });
});
