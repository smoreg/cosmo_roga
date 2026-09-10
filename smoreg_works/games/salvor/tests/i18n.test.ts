import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  RoomGame,
  replayRooms,
  spawnMonsterIn,
  type LogLine,
  type RoomCommand,
  type RoomGameConfig,
} from "@jamrog/engine";
import { BOTS_ROOMS, roomPlay, runBotOn, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { EN } from "../src/content/i18n/en.js";
import { ES } from "../src/content/i18n/es.js";
import { RU } from "../src/content/i18n/ru.js";
import type { Key } from "../src/content/i18n/keys.js";
import { MODULES, moduleName, type ModuleId } from "../src/content/modules.js";
import { MONSTERS, ENFORCER, machineName } from "../src/content/monsters.js";
import { ZONE_KINDS, zoneName } from "../src/content/zones.js";
import { HULLS, hullName, hullTrait } from "../src/content/hulls.js";
import { DERELICTS, derelictName, flavourLine, rollFlavour } from "../src/content/derelicts.js";
import { OBJECTIVES, objectiveName, objectiveShort } from "../src/content/objectives.js";
import { TUG_KINDS, isTug, stationName } from "../src/content/tug.js";
import { doorStateWord, verbWord } from "../src/content/words.js";
import {
  DEFAULT_LANG,
  LANGS,
  currentLang,
  cycleLang,
  resolveLang,
  setLang,
  t,
  tIn,
  type Lang,
} from "../src/i18n.js";
import { addWreck, capOf, graft, install, rigOf } from "../src/twist/rig.js";
import { ACTION_WIDTH, roomActions, roomLabel } from "../src/ui/actions.js";
import { PANEL_WIDTH, contactsBlock, panelBlocks } from "../src/ui/panel.js";
import { BANNER_WIDTH, bannerLine } from "../src/ui/schematic-input.js";
import { htmlOf, screenHtml } from "../src/ui/web/index.js";
import { initialState } from "../src/ui/appstate.js";
import { charterHelp, keyHelp, listHelp, ruleHelp } from "../src/ui/input.js";
import { DEFAULT_TITLE, titleLines, titleScreen } from "../src/ui/title.js";
import { ENGINE_KEYS, logText } from "../src/ui/logline.js";
import { BOX_PAD_X, helpBody, helpBox, titleBox } from "../src/ui/render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/ui/theme.js";

/**
 * Three languages, one table, and the four things that can go wrong with that.
 *
 * A row missing in Spanish is a compile error, so it is not what this file is
 * for. What it is for is everything the type system cannot see: a row nothing
 * uses, a sentence left in English inside a system, a translation two columns
 * too wide for the panel it is drawn in, and a language switch that changes the
 * *game* rather than the words on top of it.
 */

const TABLES: Record<Lang, Record<string, string>> = { en: EN, es: ES, ru: RU };

/** A session with nothing in front of the board, for the overlay tests. */
const IDLE_STATE = { ...initialState(), overlay: "none" as const };

afterEach(() => setLang(DEFAULT_LANG));

// ------------------------------------------------------------- the three tables

describe("the three tables", () => {
  it("answers for every key English has, in every language, with something to read", () => {
    for (const lang of LANGS) {
      for (const key of Object.keys(EN)) {
        const row = TABLES[lang][key];
        expect(row, `${lang}: ${key}`).toBeTypeOf("string");
        expect(row!.trim().length, `${lang}: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("has no rows English does not have", () => {
    for (const lang of LANGS) {
      for (const key of Object.keys(TABLES[lang])) {
        expect(Object.hasOwn(EN, key), `${lang}: ${key} is not an English key`).toBe(true);
      }
    }
  });

  it("names no value English does not hand it", () => {
    // A `{credits}` in Russian where English says `{cr}` is a row that prints
    // a brace at a player, and nothing else would ever notice.
    for (const lang of LANGS) {
      if (lang === "en") continue;
      for (const key of Object.keys(EN) as Key[]) {
        for (const field of fields(TABLES[lang][key]!)) {
          expect(fields(EN[key]), `${lang}: ${key} names {${field}}`).toContain(field);
        }
      }
    }
  });

  it("translates every row: nothing but a name is left in English", () => {
    // Names, glyph rows and the format itself are shared on purpose; anything
    // else identical in all three is a row somebody forgot.
    const shared = (Object.keys(EN) as Key[]).filter(
      (k) => EN[k] === ES[k] && EN[k] === RU[k] && /[a-z]{4}/.test(EN[k].replace(/\{[^}]*\}/g, "")),
    );
    expect(shared).toEqual([]);
  });
});

/** The `{name}` fields of a pattern, plural selectors included. */
function fields(pattern: string): string[] {
  return [...pattern.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!.split(",")[0]!.trim());
}

// --------------------------------------------------------------- the catalogues

describe("every catalogue id has a row", () => {
  const ids = (): Array<[string, string]> => [
    ...Object.keys(MODULES).map((id) => ["module." + id, id] as [string, string]),
    ...Object.keys(MODULES).map((id) => ["burn." + id, id] as [string, string]),
    ...Object.keys(MODULES).map((id) => ["noun." + id, id] as [string, string]),
    ...[...MONSTERS, ENFORCER].map((m) => ["machine." + m.id, m.id] as [string, string]),
    ...ZONE_KINDS.map((z) => ["room." + z.kind, z.kind] as [string, string]),
    ...TUG_KINDS.map((k) => ["room." + k, k] as [string, string]),
    ...HULLS.map((h) => ["hull." + h.id, h.id] as [string, string]),
    ...HULLS.map((h) => ["trait." + h.id, h.id] as [string, string]),
    ...DERELICTS.map((d) => ["derelict." + d.id, d.id] as [string, string]),
    ...OBJECTIVES.map((o) => ["system." + o.id, o.id] as [string, string]),
    ...OBJECTIVES.map((o) => ["system.short." + o.id, o.id] as [string, string]),
    ...OBJECTIVES.map((o) => ["log.system.online." + o.id, o.id] as [string, string]),
    ...DERELICTS.flatMap((d) =>
      d.flavour.map((_, i) => [`flavour.${d.id}.${i}`, d.id] as [string, string]),
    ),
  ];

  it("in all three languages, for every module, machine, compartment and hull", () => {
    for (const [key, id] of ids()) {
      for (const lang of LANGS) {
        expect(TABLES[lang][key], `${lang}: ${id}`).toBeTypeOf("string");
      }
    }
  });

  it("and the accessors read them rather than the catalogue's own English", () => {
    setLang("ru");
    expect(moduleName("cutter")).toBe(RU["module.cutter"]);
    expect(machineName("security unit")).toBe(RU["machine.security-unit"]);
    expect(zoneName("cargo")).toBe(RU["room.cargo"]);
    expect(stationName("bench")).toBe(RU["room.bench"]);
    expect(hullName(HULLS[0]!)).toBe(RU["hull.scrapper"]);
    expect(hullTrait(HULLS[0]!)).toBe(RU["trait.scrapper"]);
    expect(derelictName(DERELICTS[0]!)).toBe(RU["derelict.freighter"]);
    expect(objectiveName(OBJECTIVES[0]!)).toBe(RU["system.engine"]);
    expect(objectiveShort(OBJECTIVES[0]!)).toBe(RU["system.short.engine"]);
    expect(verbWord("cut")).toBe(RU["verb.cut"]);
    expect(doorStateWord("sealed")).toBe(RU["state.sealed"]);
  });

  it("keeps a machine's catalogue name as its identity, whatever the language is", () => {
    // `machineByName` is how a spawned entity finds its row, so translating the
    // field itself would take the bestiary apart.
    setLang("es");
    expect(MONSTERS[0]!.name).toBe("maintenance bot");
    expect(machineName("maintenance bot")).toBe(ES["machine.maintenance-bot"]);
  });
});

// ------------------------------------------------------ the mini message format

describe("the message format", () => {
  it("fills a name in, and leaves an unknown field alone rather than printing empty", () => {
    expect(t("panel.turn", { n: 41 })).toBe("turn 41");
    expect(t("panel.turn")).toBe("turn {n}");
  });

  it("counts in English and Spanish by one and not-one", () => {
    expect(t("stop.airlock.away", { n: 1 })).toBe("The airlock is 1 door back.");
    expect(t("stop.airlock.away", { n: 4 })).toBe("The airlock is 4 doors back.");
    setLang("es");
    expect(t("ship.rooms", { n: 1 })).toBe("1 sala");
    expect(t("ship.rooms", { n: 9 })).toBe("9 salas");
  });

  it("counts in Russian by one, few and many — 11 to 14 included", () => {
    setLang("ru");
    const rooms = (n: number): string => t("ship.rooms", { n });
    expect(rooms(1)).toBe("1 отсек");
    expect(rooms(2)).toBe("2 отсека");
    expect(rooms(5)).toBe("5 отсеков");
    expect(rooms(11)).toBe("11 отсеков");
    expect(rooms(14)).toBe("14 отсеков");
    expect(rooms(21)).toBe("21 отсек");
    expect(rooms(22)).toBe("22 отсека");
    expect(rooms(25)).toBe("25 отсеков");
  });

  it("puts the count into the form itself where a language needs it", () => {
    expect(t("log.emp", { n: 1, left: 1 })).toContain("One machine seizes");
    expect(t("log.emp", { n: 3, left: 0 })).toContain("3 machines seize");
  });

  it("agrees the verb with the count when `o` says how much ship is left", () => {
    // The Russian line carries its own verb inside each plural form, because
    // «осталось 1 отсек» is what a single count would otherwise print
    // (docs/tasks/G59-explore-to-decision.md).
    setLang("ru");
    const left = (n: number): string => t("stop.noFurther", { hull: "VESPER", n });
    expect(left(1)).toBe("VESPER: дальше не пройти, остался 1 отсек.");
    expect(left(3)).toBe("VESPER: дальше не пройти, осталось 3 отсека.");
    expect(left(7)).toBe("VESPER: дальше не пройти, осталось 7 отсеков.");
    expect(t("stop.noFurther.tool", { hull: "VESPER", n: 7, tool: moduleName("cutter") })).toBe(
      "VESPER: дальше не пройти, осталось 7 отсеков — нужен РЕЗАК.",
    );
  });
});

// ------------------------------------------------------------- choosing one

describe("choosing a language", () => {
  it("takes the URL first, then what was remembered, then English", () => {
    expect(resolveLang("?lang=es", null)).toBe("es");
    expect(resolveLang("?seed=4&lang=ru", "es")).toBe("ru");
    expect(resolveLang("?seed=4", "ru")).toBe("ru");
    expect(resolveLang("", null)).toBe("en");
    expect(resolveLang("?lang=klingon", null)).toBe("en");
  });

  it("gives `?lang=es` and pressing the key the same screen", () => {
    setLang(resolveLang("?lang=es", null));
    const fromUrl = titleLines();
    setLang("en");
    cycleLang();
    expect(currentLang()).toBe("es");
    expect(titleLines()).toEqual(fromUrl);
  });

  it("cycles round the ring and comes back", () => {
    setLang("en");
    expect([cycleLang(), cycleLang(), cycleLang()]).toEqual(["es", "ru", "en"]);
  });

  it("shows the ring on the start screen, in codes nobody translates", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const row = titleScreen(DEFAULT_TITLE).items.find((item) => item.key === "L");
      expect(row?.options?.map((o) => o.text)).toEqual(["EN", "ES", "RU"]);
      expect(row?.options?.filter((o) => o.on).map((o) => o.text)).toEqual([lang.toUpperCase()]);
      expect(row!.label.length + BOX_PAD_X).toBeLessThanOrEqual(titleBox().width);
    }
  });
});

// --------------------------------------------------------------- what changes

const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -[d3:k1]- r4
  r2 -d4- r5
  r2 -#d6#- r6
  r1: docking explored
  r2: cargo cover explored
  r4: storage scanned
  r5: hab explored
  r6: corridor explored
`;

function config(): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
}

/** A compartment with something of everything in it: rack, machines, wreckage. */
function aboard(room = "r2"): RoomGame {
  const game = new RoomGame({ ...config(), seed: 7 });
  game.player.room = game.ship.room(room).id;
  const rig = rigOf(game.player)!;
  install(rig, "emitter", 3);
  for (let i = 0; i < rig.slots.length; i++) {
    graft(rig, i);
    graft(rig, i);
    const slot = rig.slots[i];
    if (slot) slot.integrity = capOf(slot);
  }
  rig.exposed = 0;
  for (const id of ["security-unit", "maintenance-bot", "welder-bot"]) {
    const kind = MONSTERS.find((m) => m.id === id)!;
    const e = spawnMonsterIn(kind, game.ship.room(room).id);
    game.schedule.admit(e);
    game.entities.push(e);
  }
  for (const kind of ["thrusters", "welder", "laser"] as ModuleId[]) {
    addWreck(game, game.ship.room(room).id, kind, 2);
  }
  game.refreshSight();
  return game;
}

/** Every screen the widths have to hold on: the derelict, and all four stations. */
function states(): RoomGame[] {
  const out = [aboard("r2"), aboard("r1"), aboard("r5")];
  for (const room of ["r1", "r2", "r3", "r4"]) {
    const game = newGame(11);
    game.player.room = game.ship.room(room).id;
    game.refreshSight();
    out.push(game);
  }
  return out;
}

describe("the widths hold in all three languages", () => {
  it("keeps every panel line inside the panel", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of states()) {
        for (const line of panelBlocks(game, roomActions(game))) {
          expect(line.text.length, `${lang}: ${line.text}`).toBeLessThanOrEqual(PANEL_WIDTH);
        }
      }
    }
  });

  /**
   * The contacts line is the tightest row on the panel: a glyph, a name, the
   * hit points, the door to shut and one word for what the machine does, inside
   * twenty-eight columns and in three languages (G47). It clips the name when
   * it has to, so what this holds to is the rule that nothing wraps — a wrapped
   * line runs off the bottom of the panel and takes the action list with it.
   */
  it("keeps a contacts line inside the panel for every machine, here and next door", () => {
    const aboard = [...MONSTERS, ENFORCER];
    for (const lang of LANGS) {
      setLang(lang);
      for (const kind of aboard) {
        for (const room of ["r2", "r5"]) {
          const game = new RoomGame({ ...config(), seed: 7 });
          game.player.room = game.ship.room("r2").id;
          const machine = spawnMonsterIn(kind, game.ship.room(room).id);
          game.schedule.admit(machine);
          game.entities.push(machine);
          game.refreshSight();
          const block = contactsBlock(game);
          for (const line of block) {
            expect(line.text.length, `${lang}: ${line.text}`).toBeLessThanOrEqual(PANEL_WIDTH);
          }
          // The glyph and the hit points are never what gives way: they are how
          // the machine is found on the schematic and how the fight is judged,
          // and neither is guessable from the rest of the line. The rule above
          // them is the block's own heading and carries neither.
          expect(block).toHaveLength(2);
          expect(block[1]!.text, `${lang}: ${block[1]!.text}`).toContain(
            `${machine.hp}/${machine.hpMax}`,
          );
          expect(block[1]!.text.startsWith(`${machine.ch} `), block[1]!.text).toBe(true);
        }
      }
    }
  });

  it("keeps a module name inside the rack's own column", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const id of Object.keys(MODULES) as ModuleId[]) {
        expect(moduleName(id).length, `${lang}: ${moduleName(id)}`).toBeLessThanOrEqual(10);
      }
    }
  });

  /**
   * The box on the schematic is seven columns wide and clips what does not fit
   * (`ui/schematic.ts`, `INNER`), so what a player reads is a compartment's
   * first seven columns and never more. Two compartments that agree on those
   * seven are one box drawn twice — and the pair it happened to was the worst
   * one available: the derelict's DOCKING and the tug's own DOCK were both
   * `ДОК`, on the one picture whose job is to say which ship you are standing
   * on. Same for CARGO BAY against the tug's HOLD, and CONTROL against HELM.
   */
  it("gives every compartment its own seven columns on the schematic", () => {
    const BOX = 7;
    for (const lang of LANGS) {
      setLang(lang);
      const names = [...ZONE_KINDS.map((z) => zoneName(z.kind)), ...TUG_KINDS.map(stationName)];
      const boxes = names.map((name) => name.slice(0, BOX));
      expect(new Set(boxes).size, `${lang}: ${boxes.join(" · ")}`).toBe(boxes.length);
    }
  });

  it("keeps every compartment of the map inside the twenty-five columns", () => {
    // The four fields of a map row, each with the longest thing that can be in
    // it: a compartment name in this language, its `rN`, and either a distance
    // or the bulkhead that will stop the walk. The name is the field that gives
    // way, so a language that runs long loses letters of the name and never the
    // number or the state.
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of states()) {
        const rights = [
          ...[1, 2, 5, 11].map((n) => t("dist.doors", { n })),
          t("dist.none"),
          ...(["locked", "sealed", "closed", "out"] as const).map((st) => `d10 ${doorStateWord(st)}`),
        ];
        for (const room of game.ship.rooms) {
          for (const right of rights) {
            const label = roomLabel(room, right);
            expect(label.length, `${lang}: ${label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          }
        }
      }
    }
  });

  /**
   * The map `m` opens, and the methods under it — two levels, both of them
   * numbered lines in the same twenty-five columns as everything else
   * (docs/tasks/G48-travel-to-a-room.md).
   *
   * Three fields on a compartment's line and a language may run long in any of
   * them: the name, how far it is in doors, and which bulkhead will stop the
   * walk. The name is the one that gives way, and this is what says so.
   */
  it("keeps the map of the ship inside the column, in all three languages", () => {
    let backs = 0;
    const aboardStates = states().filter((g) => !isTug(g));
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of aboardStates) {
        for (const line of roomActions(game, undefined, true)) {
          expect(line.label.length, `${lang}: ${line.label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          if (line.step === null) backs++;
          if (typeof line.step !== "number") continue;
          for (const way of roomActions(game, line.step, true)) {
            expect(way.label.length, `${lang}: ${way.label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          }
        }
        for (const drawn of panelBlocks(game, roomActions(game, undefined, true))) {
          expect(drawn.text.length, `${lang}: ${drawn.text}`).toBeLessThanOrEqual(PANEL_WIDTH);
        }
      }
    }
    // Every hull state has doors, so every one of them has the line back out of
    // them. The tug has no map at all since G53 — nothing to walk to.
    expect(backs).toBe(LANGS.length * aboardStates.length);
  });

  /**
   * The tug's own two levels: the ten rows and the modules under any of them
   * (docs/tasks/G53-tug-is-a-menu.md). Five group headings as well, because
   * they are drawn in the same twenty-eight columns as everything else.
   */
  it("keeps the tug's groups and their modules inside the column", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of states().filter(isTug)) {
        for (const line of roomActions(game)) {
          expect(line.label.length, `${lang}: ${line.label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          if (line.head !== undefined) {
            expect(line.head.length, `${lang}: ${line.head}`).toBeLessThanOrEqual(PANEL_WIDTH);
          }
          if (typeof line.step !== "string") continue;
          for (const pick of roomActions(game, line.step)) {
            expect(pick.label.length, `${lang}: ${pick.label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          }
        }
      }
    }
  });

  /**
   * The list one level down (docs/tasks/G46-nested-actions.md). It is two
   * columns of its own — the method's word, then what spending it costs — and
   * the second is where a language runs out of room: `3 turnos, ruido 9` is
   * seventeen of the twenty-five and leaves nothing over. Held on the same
   * twenty-five as everything else, and in the panel it is drawn in.
   */
  it("keeps a bulkhead's own list inside the column, in all three languages", () => {
    let locks = 0;
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of states()) {
        for (const line of roomActions(game, undefined, true)) {
          if (typeof line.step !== "number") continue;
          locks++;
          expect(line.label.length, `${lang}: ${line.label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          for (const way of roomActions(game, line.step, true)) {
            expect(way.label.length, `${lang}: ${way.label}`).toBeLessThanOrEqual(ACTION_WIDTH);
          }
          for (const drawn of panelBlocks(game, roomActions(game, line.step, true))) {
            expect(drawn.text.length, `${lang}: ${drawn.text}`).toBeLessThanOrEqual(PANEL_WIDTH);
          }
        }
      }
    }
    // A width nobody measured is a green test about nothing.
    expect(locks).toBeGreaterThanOrEqual(LANGS.length);
  });

  /**
   * Everything else on the list is free-form, and some English lines are over
   * the column already (`work ENGINE (CUTTER, 3 turns)`). So the rule the other
   * two are held to is the one that matters: never longer than the column, and
   * never longer than the English line they replace.
   */
  it("makes no action line longer than the English one it stands in for", () => {
    const english = states().map((game) => roomActions(game).map((a) => a.label));
    for (const lang of LANGS) {
      if (lang === "en") continue;
      setLang(lang);
      states().forEach((game, i) => {
        roomActions(game).forEach((action, j) => {
          const cap = Math.max(ACTION_WIDTH, english[i]![j]!.length);
          expect(action.label.length, `${lang}: ${action.label}`).toBeLessThanOrEqual(cap);
        });
      });
    }
  });

  it("keeps the board at the HELM inside the column, the whole-voyage line included", () => {
    // `NEUTRALIZE` is on every board, the first hull's included since it is the
    // one line that says what the run is for — but the price it draws there is
    // a number, and the longest line the board can draw is the same charter
    // paying with the whole voyage. That hull is the last of an itinerary, so
    // no fresh run reaches it: it is checked by hand instead.
    const english = ["salvage", "retrieve", "upload", "neutralize"].map((id) =>
      tIn("en", "action.charter", { charter: tIn("en", `charter.name.${id}` as Key), price: "the voyage" }),
    );
    for (const lang of LANGS) {
      ["salvage", "retrieve", "upload", "neutralize"].forEach((id, i) => {
        for (const price of [tIn(lang, "word.cr", { n: 30 }), tIn(lang, "word.theVoyage")]) {
          const label = tIn(lang, "action.charter", {
            charter: tIn(lang, `charter.name.${id}` as Key),
            price,
          });
          expect(label.length, `${lang}: ${label}`).toBeLessThanOrEqual(
            Math.max(ACTION_WIDTH, english[i]!.length),
          );
        }
      });
    }
  });

  /**
   * The bench's own line, checked by hand for the same reason the board at the
   * HELM is: no state a fresh run reaches draws the longest one. It is drawn
   * only when something in the rack is under its ceiling, and it names the
   * module — so the widest it can be is the longest module name of the three
   * languages carrying a two-digit integrity over a two-digit ceiling.
   *
   * This is also why the line carries no price. Twenty-five columns hold
   * `reparar IMPULSORES 13/14` with one to spare and nothing after it, and what
   * the line has to say is which module the money went into and how much of it
   * came back — the bench charges the same four credits either way
   * (`systems/voyage.ts`, `REPAIR_PRICE`), and the refusal says so when the
   * account is short.
   */
  it("keeps the bench's repair line inside the column, on the longest module of each language", () => {
    for (const lang of LANGS) {
      const widest = (Object.keys(MODULES) as ModuleId[])
        .map((id) => tIn(lang, `module.${id}` as Key))
        .reduce((a, b) => (b.length > a.length ? b : a));
      const label = tIn(lang, "action.repair", { module: widest, left: 13, max: 14 });
      expect(label.length, `${lang}: ${label}`).toBeLessThanOrEqual(ACTION_WIDTH);
    }
  });

  it("keeps the help card and the title card on the screen", () => {
    for (const lang of LANGS) {
      setLang(lang);
      // Both first paragraphs: the card is written twice and only one of the
      // two is ever the tallest (`ui/input.ts`, `tugHelp`/`shipHelp`).
      for (const onTug of [true, false]) {
        const help = helpBox(onTug);
        expect(help.width, `${lang} tug ${onTug}`).toBeLessThanOrEqual(SCREEN_WIDTH);
        expect(help.height, `${lang} tug ${onTug}`).toBeLessThanOrEqual(SCREEN_HEIGHT);
        for (const line of helpBody(onTug)) {
          expect(line.length, `${lang}: ${line}`).toBeLessThanOrEqual(help.inner);
        }
      }
      const title = titleBox();
      expect(title.width, lang).toBeLessThanOrEqual(SCREEN_WIDTH);
      for (const line of titleLines()) expect(line.length, `${lang}: ${line}`).toBeLessThanOrEqual(title.inner);
    }
  });

  /**
   * The line across the top of the schematic, which is the one place a player
   * is told which of the two ships they are standing on (G40, 9). It is clipped
   * rather than wrapped, so a translation that runs long loses the alert off
   * the end of it rather than pushing the picture about.
   */
  it("keeps the banner inside the schematic's own width", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of states()) {
        const line = bannerLine(game);
        expect(line.length, `${lang}: ${line}`).toBeLessThanOrEqual(BANNER_WIDTH);
        expect(line, `${lang}: banner clipped`).not.toContain("…");
      }
    }
  });
});

describe("pressing the key changes the words and nothing else", () => {
  it("puts the panel, the title and the help card into Russian", () => {
    const game = aboard();
    setLang("ru");
    const panel = panelBlocks(game, roomActions(game)).map((l) => l.text).join("\n");
    expect(panel).toContain(RU["panel.actions"]);
    expect(panel).toContain(RU["room.cargo"]);
    expect(panel).toContain(RU["module.plating"]);
    expect(panel).not.toContain("ACTIONS");

    const title = titleLines();
    expect(title).toContain(RU["title.name"]);
    expect(title).toContain(RU["title.tagline"]);
    expect(title).toContain(RU["title.start"]);
    expect(title).toContain(RU["title.keys.1"]);
    expect(title.join("\n")).toContain(RU["title.menu.voyage"]);
    for (const block of [keyHelp(), ruleHelp(), listHelp(), charterHelp()]) {
      expect(block.join("\n")).toMatch(/[А-Яа-яЁё]/);
    }
  });

  it("says the same sentence three ways, and keeps the numbers in it", () => {
    const said = LANGS.map((lang) => tIn(lang, "log.hit.module", {
      source: "The scout",
      module: "PLATING",
      left: 2,
      max: 9,
    }));
    expect(new Set(said).size).toBe(3);
    for (const line of said) expect(line, line).toContain("2/9");
  });

  it("leaves the commands and the run alone: same seed, same voyage, any language", () => {
    const script: RoomCommand[] = [
      { kind: "act", verb: "charter", target: 2200 },
      { kind: "act", verb: "undock" },
      { kind: "wait" },
      { kind: "wait" },
      { kind: "act", verb: "use", slot: 2 },
      { kind: "wait" },
    ];

    const runs = LANGS.map((lang) => {
      setLang(lang);
      const game = newGame(31);
      for (const cmd of script) game.playerCommand(cmd);
      return game;
    });

    const shape = (game: RoomGame): string =>
      JSON.stringify({
        inputs: game.inputs,
        turn: game.schedule.time,
        status: game.status,
        room: game.player.room,
        hp: game.player.hp,
        rooms: game.ship.rooms.map((r) => [r.kind, r.explored, r.scanned]),
        doors: game.ship.doors.map((d) => [d.label, d.state]),
        entities: game.entities.map((e) => [e.name, e.room, e.hp]),
        keys: game.log.lines.map((l) => l.key ?? ""),
      });

    expect(shape(runs[1]!)).toBe(shape(runs[0]!));
    expect(shape(runs[2]!)).toBe(shape(runs[0]!));
    // Only the wording moved: the three logs read differently.
    const text = runs.map((g) => g.log.lines.map((l) => l.text).join("\n"));
    expect(new Set(text).size).toBe(3);
  });

  it("replays bit for bit inside whichever language is on", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = newGame(52);
      for (const cmd of [{ kind: "wait" }, { kind: "wait" }, { kind: "wait" }] as RoomCommand[]) {
        game.playerCommand(cmd);
      }
      const again = replayRooms(52, [...game.inputs], GAME_CONFIG);
      expect(again.inputs, lang).toEqual(game.inputs);
      expect(again.log.lines.map((l) => l.text), lang).toEqual(game.log.lines.map((l) => l.text));
      expect(again.log.lines.map((l) => l.key), lang).toEqual(game.log.lines.map((l) => l.key));
    }
  });

  it("draws the HELM's own line from the roll rather than from a frozen sentence", () => {
    const spec = DERELICTS[0]!;
    const roll = rollFlavour(spec, new (class {
      private n = 0;
      int(lo: number, hi: number): number {
        this.n += 1;
        return lo + (this.n % (hi - lo + 1));
      }
    })() as never);
    setLang("en");
    const english = flavourLine(spec, roll);
    setLang("ru");
    const russian = flavourLine(spec, roll);
    expect(russian).not.toBe(english);
    // The callsign is a proper noun and stays put in both.
    expect(russian.split(" · ")[0]).toBe(english.split(" · ")[0]);
  });
});

// ------------------------------------------------------- the graphic view

/**
 * The second view draws the same words.
 *
 * `ui/web/**` has no vocabulary of its own — it takes `panelBlocks`,
 * `roomActions`, `helpBody` and `titleLines` and puts them in HTML — so the
 * only way it can come out in the wrong language is by *comparing* against one.
 * It did: the seam it cuts the panel on was the literal `"ACTIONS"`, which
 * matches nothing in Spanish or Russian, and every action button landed above
 * the compartment instead of under its heading.
 */
describe("the graphic view says what the terminal says", () => {
  it("puts the panel and the buttons into the language that is on", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = aboard();
      const actions = roomActions(game);
      const html = htmlOf(panelBlocks(game, [], 0), [], actions, 0);

      expect(html, lang).toContain(TABLES[lang]["panel.actions"]!);
      expect(html, lang).toContain(TABLES[lang]["module.plating"]!);
      // Every numbered line is a button, and its label is the translated one.
      for (const action of actions.filter((a) => a.key !== "")) {
        expect(html, `${lang}: ${action.label}`).toContain(escapeHtml(action.label));
      }
    }
  });

  it("cuts the panel at the heading in every language, not at the English one", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = aboard();
      const html = htmlOf(panelBlocks(game, [], 0), [], roomActions(game), 0);
      // The buttons come after the heading and before whatever follows it.
      const heading = html.indexOf(TABLES[lang]["panel.actions"]!);
      const buttons = html.indexOf('data-line="0"');
      expect(heading, lang).toBeGreaterThanOrEqual(0);
      expect(buttons, lang).toBeGreaterThan(heading);
    }
  });

  it("draws the whole screen in Russian, cards included", () => {
    setLang("ru");
    const game = aboard();
    const help = screenHtml(game, { ...IDLE_STATE, overlay: "help" }, new Set());
    expect(help).toContain(RU["help.title"]);
    expect(help).toMatch(/[А-Яа-яЁё]/);

    const dead = screenHtml(game, { ...IDLE_STATE, overlay: "dead" }, new Set());
    expect(dead).toContain(RU["end.dead"]);
    expect(dead).toContain(RU["end.again"]);
  });
});

/** What `esc` in `ui/web/schematic-svg.ts` does to a label before it is written. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ------------------------------------------------- every row earns its place

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("the table carries nothing nobody asks for", () => {
  it("uses every row it holds", () => {
    // Two ways a row is reached: named outright, or by the prefix of a family
    // `tId` looks an id up in (`room.`, `machine.`, `flavour.`). A row that is
    // neither is a line the game stopped saying and nobody deleted.
    const used = new Set<string>();
    const prefixes = new Set<string>();
    for (const file of sources(SRC)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/"([a-z][\w]*(?:\.[\w-]+)+)"/g)) used.add(m[1]!);
      for (const m of src.matchAll(/\btId\(\s*"([^"]+)"/g)) prefixes.add(m[1]!);
    }
    const orphans = Object.keys(EN).filter(
      (key) => !used.has(key) && ![...prefixes].some((p) => key.startsWith(`${p}.`)),
    );
    expect(orphans).toEqual([]);
  });
});

// ------------------------------------------------- the lines the engine writes

/**
 * What may still be Latin in a Russian log, and nothing else may be.
 *
 * Door and compartment labels (`d3`, `a1`, `r5`), the credit mark, and the
 * callsigns — which are names of ships and stay in one alphabet on purpose
 * (design-doc.md, "Языки"). Everything else in a Russian run has to be
 * Russian, including the lines the engine wrote, which is what this block is
 * here for.
 */
// And `[i]`, which is a key and not a word: the codex's hook on every red
// hazard line (`content/hazards.ts`, `tell`; docs/tasks/G72-codex.md).
const LATIN_ALLOWED = /\b[a-z]\d+\b|\bCR\b|\b[A-Z][A-Z' ]*[A-Z]\b|\b[A-Z]\b|\[i\]/g;

describe("the engine speaks the language the game is in", () => {
  /**
   * Combat, doors and cover are the engine's to write and it has no table:
   * before G57 a Russian run read `the scout hits You for 2.` on 28 % of its
   * turns (docs/tasks/G55, 12-14). The engine names the event and hands over
   * the values now, and `ui/logline.ts` says it — so this is the check that no
   * line of a real run comes out in English.
   */
  it("leaves no English in a Russian run, over a hundred seeds and three bots", () => {
    setLang("ru");
    const offenders = new Map<string, string>();
    const keysSeen = new Set<string>();

    for (const bot of ["careful", "greedy", "random"]) {
      for (const seed of seedRange(1, 100)) {
        let game: SalvorGame | undefined;
        runBotOn(
          BOTS_ROOMS[bot]!,
          seed,
          roomPlay({ maxSteps: 400, make: (s) => (game = newGame(s)) }),
        );
        for (const line of game!.log.lines) {
          const text = logText(line);
          if (line.key !== undefined) keysSeen.add(line.key);
          if (/[A-Za-z]/.test(text.replace(LATIN_ALLOWED, ""))) {
            offenders.set(line.key ?? text, `${line.key ?? "-"}: ${text}`);
          }
        }
      }
    }

    expect([...offenders.values()]).toEqual([]);
    // A sweep that logged no combat at all would pass the check above while
    // proving nothing, so the run has to have produced the lines it is about.
    expect(keysSeen.has("engine.hit.you"), "no blow was struck in 300 runs").toBe(true);
    expect(keysSeen.has("engine.dies"), "nothing died in 300 runs").toBe(true);
    expect(keysSeen.has("engine.door.open"), "no door was opened in 300 runs").toBe(true);
  });

  it("has a row for every event those runs produced", () => {
    setLang("ru");
    const unknown = new Set<string>();
    for (const seed of seedRange(1, 60)) {
      let game: SalvorGame | undefined;
      runBotOn(
        BOTS_ROOMS.careful!,
        seed,
        roomPlay({ maxSteps: 400, make: (s) => (game = newGame(s)) }),
      );
      for (const line of game!.log.lines) {
        if (line.key?.startsWith("engine.") && !ENGINE_KEYS.includes(line.key as never)) {
          unknown.add(line.key);
        }
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("says the same event in three languages and changes nothing else", () => {
    // The line is rebuilt when it is drawn, not when it is added, so pressing
    // `L` translates what is already on screen. `text` — what the engine wrote
    // — is the same in all three, which is why a replay fingerprint does not
    // move when a player switches language.
    //
    // The English row is no longer the engine's own sentence word for word: it
    // says what is left of the target as well, and the engine has no business
    // knowing that a player needs that number (docs/owner-queue.md, 1). What is
    // held here is that it still opens on the sentence the engine composed —
    // the fallback a game with no table would print — and only adds to it.
    const game = aboard();
    const foe = game.entities.find((e) => e.id !== game.player.id)!;
    let blow: LogLine | undefined;
    for (let i = 0; i < 12 && blow === undefined; i++) {
      game.playerCommand({ kind: "attack", target: foe.id });
      blow = game.log.lines.find((l) => l.key === "engine.hit.you");
    }
    expect(blow, "the drone's blow was not logged").toBeDefined();

    const said = new Map<Lang, string>();
    for (const lang of LANGS) {
      setLang(lang);
      said.set(lang, logText(blow!));
    }
    expect(said.get("en")!.startsWith(blow!.text.slice(0, -1))).toBe(true);
    expect(said.get("en")).toMatch(/\(\d+\/\d+\)\.$/);
    expect(said.get("ru")).toMatch(/[А-Яа-яЁё]/);
    expect(new Set(said.values()).size, "three languages, three sentences").toBe(3);
  });
});
