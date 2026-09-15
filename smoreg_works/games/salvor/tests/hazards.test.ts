import { describe, it, expect } from "vitest";
import {
  RoomGame,
  Rng,
  Ship,
  hexLayout,
  spawnMonsterIn,
  type Entity,
  type MonsterKind,
  type RoomCommand,
  type RoomGameConfig,
  type Twist,
} from "@jamrog/engine";
import { BOTS_ROOMS, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { DERELICTS, derelictShip, stampClass, type DerelictSpec } from "../src/content/derelicts.js";
import {
  FROST_PENALTY,
  HAZARDS,
  HAZARD_IDS,
  MINE_DAMAGE,
  MINE_MACHINE_DAMAGE,
  type HazardId,
} from "../src/content/hazards.js";
import { EN } from "../src/content/i18n/en.js";
import { ES } from "../src/content/i18n/es.js";
import { RU } from "../src/content/i18n/ru.js";
import { MODULES, moduleName, type ModuleId } from "../src/content/modules.js";
import { MONSTERS } from "../src/content/monsters.js";
import { TUTORIAL_SPEC } from "../src/content/tutorial.js";
import { TILE_BY_GLYPH } from "../src/tiles/sprites.js";
import { alertState } from "../src/systems/alert.js";
import { hazardLine, placeHazards, signsGiven } from "../src/systems/hazards.js";
import { doorHazard, hazardRecords, hazardsOf, roomHazard } from "../src/systems/hazardstate.js";
import { canSeeDrone } from "../src/systems/sight.js";
import { undock } from "../src/systems/voyage.js";
import { LANGS, setLang, t, tIn } from "../src/i18n.js";
import { applyDerived, findSlot, rigOf } from "../src/twist/rig.js";
import { ACTION_WIDTH, doorStands, roomActions } from "../src/ui/actions.js";
import { initialState } from "../src/ui/appstate.js";
import { dangerAhead, engage, isStop, makeExplorer, makeTraveller, type AutoResult } from "../src/ui/auto.js";
import { panelBlocks } from "../src/ui/panel.js";
import { stateOf, thingsOf } from "../src/ui/contents.js";

/**
 * The hazard framework (docs/tasks/G71-hazard-framework.md), held to its five
 * rules by table: every row of `content/hazards.ts` gets the same seven
 * assertions on readability — the mark in three views, the red line once a
 * sortie, the word in the compartment block, `dangerAhead` after the sign and
 * not before, and `o` stopping a door short — and the three starter hazards
 * get their own mechanics below. The one rule no fixture can prove, "no
 * automatic step ever costs anything", is measured on two hundred real
 * voyages at the bottom: a bot that walks by `o` and never reads a line.
 */

/** Four in a line; the hazard goes on r3 or on the door into it. */
function line(extra: string): string {
  return `
    TUG -a1- r1
    r1 -d1- r2
    r2 -d2- r3
    r3 -d3- r4
    r1: docking explored
    r2: cargo
    r3: hab
    r4: engineering
    ${extra}
  `;
}

/** The fixture line that puts one hazard of the table where the tests expect it. */
function placed(id: HazardId): string {
  return HAZARDS[id].on === "door" ? "d2: trap=mine" : `r3: hab hazard=${id}`;
}

function config(text: string, systems: Array<Twist<RoomGame>> = GAME_CONFIG.systems!): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems,
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  };
}

function gameOn(text: string, seed = 7): RoomGame {
  return new RoomGame({ ...config(text), seed });
}

function go(game: RoomGame, door: string): void {
  expect(game.playerCommand({ kind: "go", door: game.ship.door(door).id }).ok).toBe(true);
}

function alarms(game: RoomGame): Array<{ text: string; key?: string }> {
  return game.log.lines.filter((l) => l.tone === "alarm").map((l) => ({ text: l.text, key: l.key }));
}

/* What a compartment shows, as the box used to spell it. The picture is gone;
   the rule it drew is not, and it is the rule this file is about. */
function box(game: RoomGame, room: string): string {
  const at = game.ship.rooms.find((r) => r.label === room)!;
  const state = stateOf(game, at, game.player.room);
  return thingsOf(game, at, state, game.currentShip.data)
    .map((t: { glyph: string }) => t.glyph)
    .join(" ");
}

function cmdOf(result: AutoResult): RoomCommand {
  if (isStop(result)) throw new Error(`expected a command, got stop: ${result.stop}`);
  return result.cmd;
}

function stopOf(result: AutoResult): { stop: string; door?: number } {
  if (!isStop(result)) throw new Error(`expected a stop, got ${JSON.stringify(result.cmd)}`);
  return result;
}

/** Put a module in the rack, or take it out, the way a burn-out would. */
function give(game: RoomGame, kind: ModuleId): number {
  const rig = rigOf(game.player)!;
  const empty = rig.slots.findIndex((s) => s === null);
  const slot = empty >= 0 ? empty : rig.slots.length - 1;
  rig.slots[slot] = { kind, integrity: MODULES[kind].integrity };
  applyDerived(game.player);
  return slot;
}

function drop(game: RoomGame, kind: ModuleId): void {
  const rig = rigOf(game.player)!;
  const slot = findSlot(rig, kind);
  if (slot !== null) rig.slots[slot] = null;
  applyDerived(game.player);
}

function integrityOf(game: RoomGame, kind: ModuleId): number {
  const rig = rigOf(game.player)!;
  const slot = findSlot(rig, kind);
  return slot === null ? 0 : rig.slots[slot]!.integrity;
}

/** A machine that walks at the drone the moment it sees it, one door away. */
const HOUND: MonsterKind = {
  id: "hound", name: "hound", ch: "h", fg: "#fff", hp: 9, damage: [1, 2, 0], defense: 0,
  speed: 100, fovRadius: 5, behaviour: "hunter", sight: 1, minDepth: 0, maxDepth: 99, weight: 0,
};

/** And one that never moves at all. */
const HULK: MonsterKind = { ...HOUND, id: "hulk", name: "hulk", speed: 1, behaviour: "static" };

function put(game: RoomGame, room: string, kind: MonsterKind): Entity {
  const machine = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  game.refreshSight();
  return machine;
}

// ------------------------------------------------------------------ the table

describe("the hazard table", () => {
  it("has three starter rows, each a one-column glyph with a level and real counters", () => {
    expect(HAZARD_IDS).toEqual(["frost", "smoke", "mine"]);
    for (const id of HAZARD_IDS) {
      const kind = HAZARDS[id];
      expect(kind.id).toBe(id);
      expect([...kind.glyph]).toHaveLength(1);
      expect([1, 2, 3]).toContain(kind.level);
      for (const module of kind.counters) expect(MODULES[module], `${id}: ${module}`).toBeDefined();
    }
  });

  it("has a red line and a word in three languages, and the line ends in the codex hook", () => {
    for (const id of HAZARD_IDS) {
      const kind = HAZARDS[id];
      for (const table of [EN, ES, RU]) {
        expect(table[kind.tell], `${id} tell`).toMatch(/ \[i\]$/);
        expect(table[kind.word], `${id} word`).toBeTruthy();
      }
    }
  });

  it("is carried by the classes, and every class names only rows that exist", () => {
    const carried = new Set<string>();
    for (const spec of DERELICTS) {
      for (const id of spec.hazards ?? []) {
        expect(HAZARDS[id], `${spec.id} names '${id}'`).toBeDefined();
        carried.add(id);
      }
      if (spec.hazards?.length) expect(spec.threat, `${spec.id} has hazards and no threat`).toBeGreaterThan(0);
    }
    for (const id of HAZARD_IDS) expect(carried.has(id), `${id} is on no class`).toBe(true);
  });
});

// ------------------------------------------------------------ readability

describe.each(HAZARD_IDS)("%s is readable", (id) => {
  const kind = HAZARDS[id];
  /** The compartments whose box carries the mark: the hazard's own, or both ends of the mined door. */
  const marked = kind.on === "door" ? ["r2", "r3"] : ["r3"];

  it("is unknown until the drone stands next to it, then said once in red and marked", () => {
    const game = gameOn(line(placed(id)));
    expect(alarms(game)).toEqual([]);
    for (const room of marked) expect(box(game, room), `${room} before`).not.toContain(kind.glyph);
    expect(dangerAhead(game, game.ship.door("d1"))).toBeUndefined();

    go(game, "d1");
    const said = alarms(game);
    expect(said).toHaveLength(1);
    expect(said[0]!.key).toBe(kind.tell);
    expect(said[0]!.text).toMatch(/ \[i\]$/);
    expect(said[0]!.text).toBe(t(kind.tell, { door: "d2", room: kind.on === "door" ? "HAB BLOCK" : "HAB BLOCK" }));
    expect(signsGiven(game)).toHaveLength(1);
    for (const room of marked) expect(box(game, room), `${room} after`).toContain(kind.glyph);
  });

  it("is what dangerAhead answers for the door into it, in the words of the red line", () => {
    const game = gameOn(line(placed(id)));
    go(game, "d1");
    const d2 = game.ship.door("d2");
    expect(dangerAhead(game, d2)).toBe(alarms(game)[0]!.text);
    // The door behind the drone leads to nothing dangerous.
    expect(dangerAhead(game, game.ship.door("d1"))).toBeUndefined();
  });

  it("names itself in the compartment block", () => {
    const game = gameOn(line(placed(id)));
    go(game, "d1");
    if (kind.on !== "door") go(game, "d2");
    const lines = panelBlocks(game, []).map((l) => l.text);
    const word = t(kind.word, { door: "d2" });
    expect(lines.some((l) => l.includes(word)), lines.join("\n")).toBe(true);
  });

  it("is said once a sortie, however often the drone comes back past it", () => {
    const game = gameOn(line(placed(id)));
    go(game, "d1");
    go(game, "d1");
    go(game, "d1");
    expect(alarms(game)).toHaveLength(1);
  });

  it("stops auto-explore on the sign, then a door short of it, and hands that door over", () => {
    const game = gameOn(line(placed(id)));
    const first = makeExplorer();
    expect(cmdOf(first.step(game))).toEqual({ kind: "go", door: game.ship.door("d1").id });
    go(game, "d1");
    // The step just earned a red line: the walk stops on it, as it does on a machine.
    const sign = stopOf(first.step(game));
    expect(sign.stop).toBe(t("stop.hazard", { what: alarms(game)[0]!.text }));
    expect(sign.door).toBeUndefined();

    // Pressed again, the walk has nowhere free to go and names the door — and
    // says what the next press does (docs/tasks/G83-anonymous-blows.md, 3).
    const again = stopOf(makeExplorer().step(game));
    expect(again.door).toBe(game.ship.door("d2").id);
    expect(again.stop).toBe(t("stop.hazard.again", { what: dangerAhead(game, game.ship.door("d2")) ?? "" }));
    expect(game.roomOf(game.player).label).toBe("r2");
    expect(game.inputs).toHaveLength(1);

    // And the door's own list opens with the step in, so the second press is a `go`.
    expect(doorStands(game, game.ship.door("d2").id)).toBe(true);
    const list = roomActions(game, game.ship.door("d2").id);
    expect(list[0]!.cmd).toEqual({ kind: "go", door: game.ship.door("d2").id });
    expect(list[list.length - 1]!.step).toBeNull();
    for (const action of list) expect(action.label.length, action.label).toBeLessThanOrEqual(ACTION_WIDTH);
  });

  it("is known from a sensor pulse without a sign", () => {
    const game = gameOn(line(placed(id)));
    for (const room of marked) game.ship.room(room).scanned = true;
    expect(alarms(game)).toEqual([]);
    for (const room of marked) expect(box(game, room)).toContain(kind.glyph);
  });
});

// ------------------------------------------------------------------ the mine

/**
 * The red line points at the map (docs/tasks/G83-anonymous-blows.md, 7): for
 * the turn it is said, the door and the compartment it names are lit as the
 * move list's destination is, in every view that draws that; a command spent
 * puts the light out, a stop or a list does not.
 */
describe("the red line lights what it names", () => {

  it("gives every hazard a mark of its own, and none that a machine or a thing already wears", () => {
    const marks = HAZARD_IDS.map((id) => HAZARDS[id].glyph);
    expect(new Set(marks).size).toBe(marks.length);
    for (const id of HAZARD_IDS) {
      const mark = HAZARDS[id].glyph;
      expect(MONSTERS.some((m) => m.ch === mark), `${mark} is a machine's letter`).toBe(false);
      // The mark answers to a tile now — the set gained the three hazards in
      // G80 — so what this asks is no longer "does anything claim it" but
      // "does the right thing claim it". A mark colliding with a crate's or a
      // machine's drawing is the failure it was written for, and still is.
      expect(TILE_BY_GLYPH[mark], `${mark} draws as somebody else's tile`).toBe(`hazard.${id}`);
    }
  });
});

describe("a mine on a door", () => {
  it("blows on the first one through, into the module the step exposed, and raises the alert", () => {
    const game = gameOn(line("d2: trap=mine"));
    go(game, "d1");
    const before = integrityOf(game, "thrusters");
    const alert = alertState(game).level;
    go(game, "d2");
    expect(integrityOf(game, "thrusters")).toBe(before - MINE_DAMAGE);
    expect(alertState(game).level).toBe(alert + 1);
    expect(game.ship.door("d2").trap).toBeUndefined();
    expect(hazardRecords(game)).toEqual([]);
    expect(game.log.lines.some((l) => l.key === "log.hazard.mine.hit")).toBe(true);

    // Gone for good: the way back costs nothing.
    go(game, "d2");
    expect(integrityOf(game, "thrusters")).toBe(before - MINE_DAMAGE);
    expect(alertState(game).level).toBe(alert + 1);
  });

  it("signs the blow as the mine's and never as something's, in every language", () => {
    // `Something hits your PLATING` read as an invisible machine on a live
    // run (docs/tasks/G83-anonymous-blows.md, 1): a blow nothing dealt is
    // signed by what owned it.
    for (const lang of LANGS) {
      setLang(lang);
      const game = gameOn(line("d2: trap=mine"));
      go(game, "d1");
      go(game, "d2");
      const hit = game.log.lines.find((l) => l.key === "log.hit.mine");
      expect(hit, lang).toBeDefined();
      expect(hit!.text).toBe(
        tIn(lang, "log.hit.mine", {
          module: moduleName("thrusters"),
          left: integrityOf(game, "thrusters"),
          max: MODULES.thrusters.integrity,
        }),
      );
      expect(game.log.lines.some((l) => l.key === "log.hit.module"), `${lang}: signed by nobody`).toBe(false);
    }
    setLang("en");
  });

  it("goes off under a machine that comes through first, and the drone walks in unhurt", () => {
    const game = gameOn(line("d2: trap=mine"));
    go(game, "d1");
    const hound = put(game, "r3", HOUND);
    const before = integrityOf(game, "thrusters");
    for (let i = 0; i < 3 && hound.room !== game.roomOf(game.player).id; i++) {
      game.playerCommand({ kind: "wait" });
    }
    expect(hound.room).toBe(game.ship.room("r2").id);
    expect(hound.hp).toBe(HOUND.hp - MINE_MACHINE_DAMAGE);
    expect(game.ship.door("d2").trap).toBeUndefined();
    expect(game.log.lines.some((l) => l.key === "log.hazard.mine.machine")).toBe(true);
    expect(integrityOf(game, "thrusters")).toBe(before);
  });

  it("is lifted by the welder in two turns, and only in a row", () => {
    const game = gameOn(line("d2: trap=mine"));
    give(game, "welder");
    go(game, "d1");
    const d2 = game.ship.door("d2").id;
    expect(game.playerCommand({ kind: "act", verb: "defuse", target: d2 }).ok).toBe(true);
    expect(game.ship.door("d2").trap).toBe("mine");
    // Anything else drops the job.
    game.playerCommand({ kind: "wait" });
    expect(game.log.lines.some((l) => l.text === t("log.work.break.defuse"))).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "defuse", target: d2 }).ok).toBe(true);
    expect(game.ship.door("d2").trap).toBe("mine");
    expect(game.playerCommand({ kind: "act", verb: "defuse", target: d2 }).ok).toBe(true);
    expect(game.ship.door("d2").trap).toBeUndefined();
    expect(hazardRecords(game)).toEqual([]);
    expect(game.log.lines.some((l) => l.key === "log.door.defuse.done")).toBe(true);

    const before = integrityOf(game, "thrusters");
    go(game, "d2");
    expect(integrityOf(game, "thrusters")).toBe(before);
  });

  it("is offered as defuse with the welder and greyed without, on the door's own list", () => {
    const game = gameOn(line("d2: trap=mine"));
    go(game, "d1");
    const d2 = game.ship.door("d2").id;
    const without = roomActions(game, d2);
    const greyed = without.find((a) => a.cmd.kind === "act" && a.cmd.verb === "defuse");
    expect(greyed?.enabled).toBe(false);
    expect(greyed?.why).toContain("WELDER");
    expect(game.playerCommand({ kind: "act", verb: "defuse", target: d2 })).toMatchObject({ ok: false, cost: 0 });

    give(game, "welder");
    const with_ = roomActions(game, d2).find((a) => a.cmd.kind === "act" && a.cmd.verb === "defuse");
    expect(with_?.enabled).toBe(true);
    for (const action of roomActions(game, d2)) {
      expect(action.label.length, action.label).toBeLessThanOrEqual(ACTION_WIDTH);
    }
  });

  it("refuses to defuse a door with nothing on it, for no turn", () => {
    const game = gameOn(line("d2: trap=mine"));
    give(game, "welder");
    go(game, "d1");
    const out = game.playerCommand({ kind: "act", verb: "defuse", target: game.ship.door("d1").id });
    expect(out).toMatchObject({ ok: false, cost: 0, reason: t("why.door.noTrap", { door: "d1" }) });
  });
});

// ----------------------------------------------------------------- the frost

describe("frost", () => {
  it("slows the drone while it stands in the ice and not a turn longer", () => {
    const game = gameOn(line("r3: hab hazard=frost"));
    const base = game.player.speed;
    go(game, "d1");
    expect(game.player.speed).toBe(base);
    go(game, "d2");
    expect(game.player.speed).toBe(base - FROST_PENALTY);
    game.playerCommand({ kind: "wait" });
    expect(game.player.speed).toBe(base - FROST_PENALTY);
    go(game, "d3");
    expect(game.player.speed).toBe(base);
  });

  it("is warmed by a point of the CELL for the rest of the sortie", () => {
    const game = gameOn(line("r3: hab hazard=frost"));
    const base = game.player.speed;
    go(game, "d1");
    go(game, "d2");
    const r3 = game.ship.room("r3").id;
    const offered = () => roomActions(game).find((a) => a.cmd.kind === "act" && a.cmd.verb === "heat");
    expect(offered()?.enabled).toBe(true);
    expect(offered()?.label).toContain("r3");

    const cell = integrityOf(game, "cell");
    expect(game.playerCommand({ kind: "act", verb: "heat", target: r3 }).ok).toBe(true);
    expect(integrityOf(game, "cell")).toBe(cell - 1);
    expect(game.player.speed).toBe(base);
    expect(game.log.lines.some((l) => l.key === "log.hazard.heat")).toBe(true);
    expect(offered()).toBeUndefined();

    // Warm stays warm: back out and in again, no ice.
    go(game, "d2");
    go(game, "d2");
    expect(game.player.speed).toBe(base);
    const again = game.playerCommand({ kind: "act", verb: "heat", target: r3 });
    expect(again).toMatchObject({ ok: false, cost: 0 });
  });

  it("cannot be warmed without a CELL, from another compartment, or where there is no ice", () => {
    const game = gameOn(line("r3: hab hazard=frost"));
    go(game, "d1");
    const r3 = game.ship.room("r3").id;
    expect(game.playerCommand({ kind: "act", verb: "heat", target: r3 })).toMatchObject({
      ok: false, cost: 0, reason: t("why.hazard.noFrost"),
    });
    go(game, "d2");
    drop(game, "cell");
    const greyed = roomActions(game).find((a) => a.cmd.kind === "act" && a.cmd.verb === "heat");
    expect(greyed?.enabled).toBe(false);
    expect(game.playerCommand({ kind: "act", verb: "heat", target: r3 })).toMatchObject({ ok: false, cost: 0 });
    expect(game.inputs).toHaveLength(2);
  });
});

// ----------------------------------------------------------------- the smoke

describe("smoke", () => {
  it("blinds both sides of the door and is cover inside", () => {
    const game = gameOn(line("r3: hab hazard=smoke"));
    give(game, "scanner");
    go(game, "d1");
    const hulk = put(game, "r3", HULK);
    expect(game.visible.has(game.ship.room("r3").id)).toBe(false);
    expect(game.visibleMonsters()).toEqual([]);
    expect(canSeeDrone(game, hulk)).toBe(false);
    expect(game.ship.room("r3").cover).toBe(true);
    expect(game.ship.room("r3").opaque).toBe(true);

    go(game, "d2");
    expect([...game.visible]).toEqual([game.ship.room("r3").id]);
    expect(game.visibleMonsters().map((m) => m.id)).toEqual([hulk.id]);
    expect(game.playerCommand({ kind: "hide" }).ok).toBe(true);
  });

  it("keeps Tab out: a machine known to stand in the smoke is not walked at", () => {
    const game = gameOn(line("r3: hab hazard=smoke"));
    go(game, "d1");
    game.ship.room("r3").scanned = true;
    game.ship.room("r3").data.snapshot = "h";
    expect(stopOf(engage(game, "best")).stop).toBe(t("why.auto.hazard"));
    expect(game.inputs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- the walks

describe("the walks and a known hazard", () => {
  /** A loop round the hazard, and a compartment past it. */
  const LOOP = `
    TUG -a1- r1
    r1 -d1- r2
    r2 -d2- r3
    r3 -d3- r4
    r2 -d4- r4
    r1: docking explored
    r2: cargo explored
    r3: hab hazard=frost
    r4: engineering explored
  `;

  it("sends a travel walk round the hazard when there is a way round", () => {
    const game = gameOn(LOOP);
    go(game, "d1");
    const walk = makeTraveller(game.ship.room("r4").id);
    expect(cmdOf(walk.step(game))).toEqual({ kind: "go", door: game.ship.door("d4").id });
  });

  it("stops a travel walk a door short when the hazard is the only way, and goes on after the step in", () => {
    const game = gameOn(line("r3: hab hazard=frost"));
    go(game, "d1");
    const stop = stopOf(makeTraveller(game.ship.room("r4").id).step(game));
    expect(stop.door).toBe(game.ship.door("d2").id);
    expect(stop.stop).toContain(t("stop.hazard", { what: "" }).replace("{what}", "").trim());
    expect(game.inputs).toHaveLength(1);
    // The player takes the step: the next walk carries on out of the ice.
    go(game, "d2");
    expect(cmdOf(makeTraveller(game.ship.room("r4").id).step(game))).toEqual({
      kind: "go", door: game.ship.door("d3").id,
    });
  });

  it("explores everything free first and only then walks up to the hazard", () => {
    const fork = `
      TUG -a1- r1
      r1 -d1- r2
      r2 -d2- r3
      r1 -d4- r5
      r1: docking explored
      r2: cargo
      r3: hab hazard=smoke
      r5: storage
    `;
    const game = gameOn(fork);
    // `o`, pressed again at every stop that names no door, the way a player
    // leaning on the key plays it. The smoke is next to r2, the nearest
    // compartment; the walk still sweeps r5 before it comes back to ask.
    const doors: string[] = [];
    let explorer = makeExplorer();
    let stop: { stop: string; door?: number } | undefined;
    for (let i = 0; i < 40 && stop === undefined; i++) {
      const next = explorer.step(game);
      if (!isStop(next)) {
        if (next.cmd.kind === "go") doors.push(game.ship.doorAt(next.cmd.door).label);
        expect(game.playerCommand(next.cmd).ok).toBe(true);
      } else if (next.door !== undefined) stop = next;
      else explorer = makeExplorer();
    }
    expect(stop?.door).toBe(game.ship.door("d2").id);
    expect(doors).not.toContain("d2");
    expect(game.ship.room("r2").explored).toBe(true);
    expect(game.ship.room("r5").explored).toBe(true);
    expect(game.ship.room("r3").explored).toBe(false);
    expect(game.roomOf(game.player).label).toBe("r2");
  });

  it("lets the drone walk out of a hazard it is standing in", () => {
    const game = gameOn(line("r3: hab hazard=frost"));
    go(game, "d1");
    go(game, "d2");
    expect(cmdOf(makeExplorer().step(game))).toEqual({ kind: "go", door: game.ship.door("d3").id });
  });
});

/**
 * The second press goes in (docs/tasks/G83-anonymous-blows.md, 3). The walk
 * still stops a door short every time it is asked afresh — the fifth rule is
 * measured below — but a walk handed the door it stopped at takes it, once,
 * and carries on from the far side as any walk does.
 */
describe("a walk the player has confirmed", () => {
  it("takes the door it was stopped at, then explores on from inside", () => {
    const game = gameOn(line("r3: hab hazard=smoke"));
    go(game, "d1");
    const d2 = game.ship.door("d2").id;
    expect(stopOf(makeExplorer().step(game)).door).toBe(d2);

    const walk = makeExplorer(d2);
    expect(cmdOf(walk.step(game))).toEqual({ kind: "go", door: d2 });
    go(game, "d2");
    // In the smoke now, and told of it without a line: not a stop, and the
    // next compartment is free to walk to.
    expect(cmdOf(walk.step(game))).toEqual({ kind: "go", door: game.ship.door("d3").id });
  });

  it("carries a travel walk through, and only through that one door", () => {
    const game = gameOn(line("r3: hab hazard=smoke"));
    go(game, "d1");
    const d2 = game.ship.door("d2").id;
    const goal = game.ship.room("r4").id;
    expect(stopOf(makeTraveller(goal).step(game)).door).toBe(d2);

    const walk = makeTraveller(goal, d2);
    expect(cmdOf(walk.step(game))).toEqual({ kind: "go", door: d2 });
    go(game, "d2");
    expect(cmdOf(walk.step(game))).toEqual({ kind: "go", door: game.ship.door("d3").id });
  });

  it("ignores a door that is not in front of the drone, or not one it can step through", () => {
    const game = gameOn(line("r3: hab hazard=smoke"));
    go(game, "d1");
    const d3 = game.ship.door("d3").id;
    // d3 is a compartment away: the confirmation is for a question that is not being asked.
    expect(stopOf(makeExplorer(d3).step(game)).door).toBe(game.ship.door("d2").id);
    // And a lock is still a lock: the walk stops at it, names it, and says
    // nothing about a second press — the lock's own list is what that opens.
    game.ship.door("d2").state = "locked";
    const stop = stopOf(makeExplorer(game.ship.door("d2").id).step(game));
    expect(stop.door).toBe(game.ship.door("d2").id);
    expect(stop.stop).toBe(t("stop.hazard", { what: dangerAhead(game, game.ship.door("d2")) ?? "" }));
    expect(game.inputs).toHaveLength(1);
  });

  it("spends the confirmation on the first step, whatever that step was", () => {
    const fork = `
      TUG -a1- r1
      r1 -d1- r2
      r2 -d2- r3
      r2 -d4- r5
      r1: docking explored
      r2: cargo
      r3: hab hazard=smoke
      r5: storage
    `;
    const game = gameOn(fork);
    go(game, "d1");
    const d2 = game.ship.door("d2").id;
    // Something in sight is a stop before anything else: the walk never sets out.
    const machine = put(game, "r5", HULK);
    const walk = makeExplorer(d2);
    expect(isStop(walk.step(game))).toBe(true);
    machine.hp = 0;
    game.reapDead();
    game.refreshSight();
    // Asked again, the same walk has forgotten the door: it stops short of it.
    expect(cmdOf(walk.step(game))).toEqual({ kind: "go", door: game.ship.door("d4").id });
  });
});

// ------------------------------------------------------------------- budget

describe("the placer", () => {
  const ctx = { flags: new Set<string>(), shipIndex: 1 };

  /** A run whose second ship is a hull of this class, populated on boarding. */
  function second(spec: DerelictSpec, seed: number): RoomGame {
    const game = gameOn(line(""), seed);
    game.travelTo("2", { generate: (rng) => derelictShip(spec, 1, rng, ctx) });
    return game;
  }

  it("spends no more than the class's threat, only from its list, and never by the airlock", () => {
    for (const spec of DERELICTS) {
      let placedOn = 0;
      for (const seed of seedRange(1, 40)) {
        const game = second(spec, seed);
        const records = hazardRecords(game);
        const levels = records.reduce((n, r) => n + HAZARDS[r.id].level, 0);
        expect(levels, `${spec.id} seed ${seed}`).toBeLessThanOrEqual(spec.threat ?? 0);
        for (const rec of records) {
          expect(spec.hazards ?? [], `${spec.id} seed ${seed}`).toContain(rec.id);
          if (rec.room !== undefined) {
            expect(rec.room).not.toBe(game.ship.entry);
            expect(roomHazard(game.ship, records, rec.room)).toBe(rec);
          }
          if (rec.door !== undefined) {
            const door = game.ship.doorAt(rec.door);
            expect(door.a).not.toBe(game.ship.entry);
            expect(door.b).not.toBe(game.ship.entry);
            expect(door.state).not.toBe("airlock");
            expect(door.state).not.toBe("sealed");
            expect(doorHazard(game.ship, records, rec.door)).toBe(rec);
          }
        }
        if (records.length > 0) placedOn++;
      }
      if ((spec.hazards?.length ?? 0) > 0) {
        expect(placedOn, `${spec.id} carries a hazard on too few seeds`).toBeGreaterThanOrEqual(36);
      } else {
        expect(placedOn, `${spec.id} names no hazard and got one`).toBe(0);
      }
    }
  });

  it("leaves the first derelict of a voyage clean, whatever its class", () => {
    for (const seed of seedRange(1, 30)) {
      const game = newGame(seed);
      expect(undock(game).ok, `seed ${seed}`).toBe(true);
      expect(hazardRecords(game), `seed ${seed}`).toEqual([]);
    }
    const armed = DERELICTS.find((d) => (d.hazards?.length ?? 0) > 0)!;
    for (const seed of seedRange(1, 10)) {
      const game = new RoomGame({
        ...config(""),
        seed,
        firstShip: (rng) => derelictShip(armed, 0, rng, ctx),
      });
      expect(hazardRecords(game), `${armed.id} seed ${seed}`).toEqual([]);
      expect(placeHazards(game, armed)).toEqual([]);
    }
  });

  it("leaves the hull after the training one clean as well, and arms the one after that", () => {
    // A training run's first real hull is its first hull: the training hull
    // used to take the clean deck with it (docs/tasks/G88-polish-by-map.md, A2).
    const armed = DERELICTS.find((d) => (d.hazards?.length ?? 0) > 0)!;
    let armedOn = 0;
    for (const seed of seedRange(1, 20)) {
      const game = new RoomGame({
        ...config(line("")),
        seed,
        firstShip: () => {
          const ship = shipFromText(line("")).ship;
          stampClass(ship, TUTORIAL_SPEC);
          return ship;
        },
      });
      game.travelTo("2", { generate: (rng) => derelictShip(armed, 1, rng, ctx) });
      expect(hazardRecords(game), `${armed.id} after the tutorial, seed ${seed}`).toEqual([]);
      game.travelTo("3", { generate: (rng) => derelictShip(armed, 2, rng, ctx) });
      if (hazardRecords(game).length > 0) armedOn++;
    }
    expect(armedOn, "the third hull of a training run is an ordinary hull").toBeGreaterThan(0);
  });

  it("survives a save: the record, the trap and the opaque room all round-trip", () => {
    const game = gameOn(line("r3: hab hazard=smoke\n    d3: trap=mine"));
    go(game, "d1");
    const stored = JSON.parse(JSON.stringify(game.currentShip));
    expect(hazardsOf(stored.data)).toEqual(hazardRecords(game));
    const ship = Ship.rehydrate(stored.ship);
    expect(ship.door("d3").trap).toBe("mine");
    expect(ship.room("r3").opaque).toBe(true);
    expect(ship.room("r3").hazard).toBe("smoke");
  });

  it("reads nothing it does not trust out of the pocket", () => {
    const junk = [null, 4, { id: "lava", room: 1, known: true }, { id: "mine", door: 1, known: true }, { id: "frost" }];
    expect(hazardsOf({ hazards: junk })).toEqual([{ id: "mine", door: 1, known: true }]);
    expect(hazardsOf({})).toEqual([]);
  });
});

// ------------------------------------------------------------------ the line

describe("the red line", () => {

  it("says the stop in the words of the line, in every language", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = gameOn(line("d2: trap=mine"));
      go(game, "d1");
      const said = alarms(game)[0]!.text;
      expect(said).toBe(tIn(lang, "log.hazard.tell.mine", { door: "d2", room: tIn(lang, "room.hab" as never) }));
      expect(stopOf(makeExplorer().step(game)).stop).toBe(tIn(lang, "stop.hazard.again", { what: said }));
      const rec = hazardRecords(game)[0]!;
      expect(hazardLine(game, rec, game.roomOf(game.player).id)).toBe(said);
    }
    setLang("en");
  });
});

// ---------------------------------------------------------- the fifth rule

/**
 * "No automatic step ever costs anything", on two hundred real voyages.
 *
 * The careful bot plays, but every turn `o` has a step to offer is taken from
 * `o` — and `Tab` from `Tab` when a machine is in sight — so the walk is the
 * one a player who leans on the key gets. What is counted is every automatic
 * `go` whose door is mined or leads into a compartment with a hazard in it,
 * known to the drone or not: the sign is meant to make the unknown case
 * impossible, and the count is the proof that it does on hulls the generator
 * drew. The bot's own steps are counted too, as the control: a bot that
 * reads no lines walks into plenty, so the hazards were there to walk into.
 */
describe("no automatic step costs anything", () => {
  it("over two hundred careful voyages walked by o and Tab", () => {
    let auto = 0;
    let manual = 0;
    let signs = 0;
    for (const seed of seedRange(1, 200)) {
      const game = newGame(seed);
      const bot = BOTS_ROOMS.careful!();
      const rng = new Rng(seed ^ 0x4a5);
      let explorer = makeExplorer();
      let idle = 0;
      for (let step = 0; step < 800 && !game.isOver() && idle < 12; step++) {
        const before = game.inputs.length;
        let cmd: RoomCommand;
        let automatic = true;
        const walked = explorer.step(game);
        if (!isStop(walked)) cmd = walked.cmd;
        else {
          explorer = makeExplorer();
          const fight = game.visibleMonsters().length > 0 ? engage(game, "best") : undefined;
          if (fight !== undefined && !isStop(fight)) cmd = fight.cmd;
          else {
            cmd = bot(game, rng);
            automatic = false;
          }
        }
        const costs = cmd.kind === "go" && costly(game, cmd.door);
        if (costs && automatic) auto++;
        if (costs && !automatic) manual++;
        game.playerCommand(cmd);
        idle = game.inputs.length > before ? 0 : idle + 1;
      }
      signs += game.ships.ids().reduce((n, id) => n + hazardsOf(game.ships.get(id)!.data).filter((r) => r.known).length, 0);
    }
    expect(auto, "automatic steps that walked into a hazard").toBe(0);
    expect(manual, "the control: a bot that reads nothing must have walked into some").toBeGreaterThan(0);
    expect(signs, "the control: hazards were met at all").toBeGreaterThan(0);
  });
});

/** Is this door, from where the drone stands, mined or the way into a hazard? */
function costly(game: RoomGame, doorId: number): boolean {
  const door = game.ship.doors[doorId];
  if (!door) return false;
  const here = game.roomOf(game.player).id;
  if (door.a !== here && door.b !== here) return false;
  const records = hazardRecords(game);
  if (doorHazard(game.ship, records, door.id) !== undefined) return true;
  const beyond = game.ship.other(door, here);
  return beyond !== here && roomHazard(game.ship, records, beyond) !== undefined;
}
