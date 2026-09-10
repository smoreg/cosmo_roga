import { afterEach, describe, expect, it } from "vitest";
import { RoomGame, type LogLine, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame } from "../src/game.js";
import { CODEX, CODEX_IDS, alertCodexId, codexFor } from "../src/content/codex.js";
import { HAZARD_IDS } from "../src/content/hazards.js";
import { EN } from "../src/content/i18n/en.js";
import { ES } from "../src/content/i18n/es.js";
import { RU } from "../src/content/i18n/ru.js";
import { MODULES, RELICS, type ModuleId } from "../src/content/modules.js";
import { BLOOM_KIND, CRAWLER, JAMMER, SENTRY_TURRET } from "../src/content/monsters.js";
import { STRAINS } from "../src/content/viruses.js";
import { DEFAULT_LANG, LANGS, setLang, t, type Lang } from "../src/i18n.js";
import { MAX_LEVEL, alertState } from "../src/systems/alert.js";
import {
  alarmCodexId,
  codexQueue,
  codexUnread,
  noticeCodex,
  readCodex,
  seenCodex,
  unreadCodex,
} from "../src/systems/codex.js";
import { install, rigOf } from "../src/twist/rig.js";
import { appReducer, codexSeen, codexView, initialState, type AppState } from "../src/ui/appstate.js";
import { screenHtml } from "../src/ui/web/index.js";
import { codexBadge } from "../src/ui/panel.js";
import { CODEX_WIDTH, codexBody, codexFooter, codexHeading, helpPages, toIntent } from "../src/ui/input.js";
import { BOX_PAD_X, codexBox, helpBox } from "../src/ui/render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/ui/theme.js";
import { PANEL_WIDTH } from "../src/ui/panel.js";

/**
 * The `i` window: what the run has shown, what has been read, and the badge
 * that counts the difference (G72).
 *
 * Three separable things, and they are tested separately because they fail
 * separately. The table is content — a card missing for a strain or a rung is a
 * hole a player finds and nothing else would. The register is a rule — shown
 * once, read once, no turn spent, nothing in the log. The window is a pair of
 * pure functions over an `AppState`, which is how every other overlay in this
 * game is tested and why none of this needs a browser (`.claude/CLAUDE.md`).
 */

const TABLES: Record<Lang, Record<string, string>> = { en: EN, es: ES, ru: RU };

afterEach(() => setLang(DEFAULT_LANG));

/** A hand-drawn hull, so nothing here depends on which seed drew what. */
const CARGO = `
  TUG -a1- r1
  r1 -d1- r2
  r2 -d4- r5
  r1: docking explored
  r2: cargo cover explored
  r5: hab explored
`;

function config(): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
}

function run(seed = 7): RoomGame {
  const game = new RoomGame({ ...config(), seed });
  game.player.room = game.ship.room("r2").id;
  game.refreshSight();
  return game;
}

/** A session with nothing in front of the board: the state every key starts from. */
function idle(): AppState {
  return { ...initialState(), overlay: "none" };
}

function press(state: AppState, key: string, game: RoomGame): AppState {
  return appReducer(state, toIntent({ key }, rigOf(game.player)), game);
}

// ------------------------------------------------------------------ the table

describe("every card the tables ask for exists", () => {
  /**
   * The ids other tables own, and this one has to answer for. The list is built
   * from those tables rather than written out, which is the whole point: a
   * fifth strain or a sixth rung is a red line here on the day it is added.
   */
  const owed = (): Array<[string, string]> => [
    ...STRAINS.map((s) => [s.id, "strain"] as [string, string]),
    ...Array.from({ length: MAX_LEVEL }, (_, i) => [alertCodexId(i + 1), "alert rung"] as [string, string]),
    ["vented", "hazard"],
    ...HAZARD_IDS.map((id) => [id, "hazard"] as [string, string]),
    ...RELICS.map((id) => [id, "relic"] as [string, string]),
    ...[SENTRY_TURRET, JAMMER, BLOOM_KIND, CRAWLER].map((m) => [m.id, "machine"] as [string, string]),
    ["ghost", "drone"],
    ["rival", "drone"],
  ];

  it("has a card for every strain, rung, relic and machine of the ship's defence", () => {
    for (const [id, what] of owed()) {
      expect(codexFor(id), `${what} ${id} has no card`).toBeDefined();
    }
  });

  it("says all of it in three languages, with nothing left blank", () => {
    for (const id of CODEX_IDS) {
      const entry = codexFor(id)!;
      const keys = [entry.title, entry.what, entry.wrong, entry.helps, entry.lore];
      if (entry.turn !== undefined) keys.push(entry.turn);
      for (const lang of LANGS) {
        for (const key of keys) {
          const row = TABLES[lang][key];
          expect(row, `${lang}: ${key}`).toBeTypeOf("string");
          expect(row!.trim().length, `${lang}: ${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("names only modules the catalogue has", () => {
    for (const id of CODEX_IDS) {
      for (const module of codexFor(id)!.modules ?? []) {
        expect(Object.hasOwn(MODULES, module), `${id}: no module '${module}'`).toBe(true);
      }
    }
  });

  it("files each card under its own id", () => {
    for (const [key, entry] of Object.entries(CODEX)) expect(entry.id).toBe(key);
  });

  it("answers nothing for an id it does not know, rather than throwing", () => {
    // The hazards of G74–G78 arrive with ids of their own. Until they land —
    // and for any id a future table invents — the window has nothing to say
    // and must say exactly that.
    expect(codexFor("lava")).toBeUndefined();
    expect(codexFor(undefined)).toBeUndefined();
  });
});

// --------------------------------------------------------------- the register

describe("the register writes a thing down once", () => {
  it("counts a card the first time and never again", () => {
    const game = run();
    expect(noticeCodex(game, "spasm")).toBe(true);
    expect(noticeCodex(game, "spasm")).toBe(false);
    expect(unreadCodex(game)).toEqual(["spasm"]);
    expect(seenCodex(game)).toEqual(["spasm"]);
  });

  it("puts no number on the badge for an id with no card", () => {
    const game = run();
    expect(noticeCodex(game, "lava")).toBe(false);
    expect(codexUnread(game)).toBe(0);
    expect(codexBadge(game)).toBeUndefined();
  });

  it("takes a card off the badge when it is read, and keeps it in the list", () => {
    const game = run();
    noticeCodex(game, "spasm");
    noticeCodex(game, "ghost");
    expect(codexUnread(game)).toBe(2);
    readCodex(game, "spasm");
    expect(codexUnread(game)).toBe(1);
    expect(unreadCodex(game)).toEqual(["ghost"]);
    expect(seenCodex(game)).toEqual(["spasm", "ghost"]);
  });

  it("notices what the turn put in front of the drone, and spends no turn on it", () => {
    const game = run();
    const rig = rigOf(game.player)!;
    install(rig, "blade", 14);
    alertState(game).level = 2;
    const before = game.schedule.time;
    const lines = game.log.tail(50).length;

    game.playerCommand({ kind: "wait" });

    expect(seenCodex(game)).toContain("blade");
    expect(seenCodex(game)).toContain(alertCodexId(2));
    // A turn was spent by `wait` and by nothing this system did; the register
    // adds no line to the log at all, which is what keeps it out of the way.
    expect(game.schedule.time).toBeGreaterThan(before);
    expect(game.log.tail(50).length).toBe(lines);
  });

  it("survives a save and starts a new run empty", () => {
    const game = run();
    noticeCodex(game, "spasm");
    noticeCodex(game, "ghost");
    readCodex(game, "spasm");

    const saved = JSON.parse(JSON.stringify(game.player.data)) as Record<string, unknown>;
    const restored = run();
    restored.player.data = saved;
    expect(seenCodex(restored)).toEqual(["spasm", "ghost"]);
    expect(unreadCodex(restored)).toEqual(["ghost"]);

    // Nothing crosses a run: the jam forbids meta-progression, and a codex that
    // remembered would be exactly that however gently it was worded.
    expect(seenCodex(newGame(11))).toEqual([]);
  });

  it("shrugs off a pocket a save came back with the wrong shape", () => {
    const game = run();
    game.player.data!.codex = { seen: "yes" };
    expect(() => noticeCodex(game, "spasm")).not.toThrow();
    expect(seenCodex(game)).toEqual(["spasm"]);
  });
});

// ------------------------------------------------------------------ the alarm

/**
 * The red line's own card. G71 writes the line with the tone `alarm` and the
 * key `log.hazard.tell.<id>`; the tone is not in the engine's union yet, so the
 * cast here is the whole of this file's dependency on that task — and the id is
 * one this table already has, so the wiring is proved without waiting for it.
 */
function alarmLine(game: RoomGame, key: string): void {
  game.log.add("…", game.schedule.time, "alarm" as LogLine["tone"], key);
}

describe("the last line of the log decides which card `i` opens", () => {
  it("opens the hazard's own card rather than the oldest unread one", () => {
    const game = run();
    noticeCodex(game, "spasm");
    alarmLine(game, "log.hazard.tell.vented");

    expect(alarmCodexId(game)).toBe("vented");
    expect(codexQueue(game)[0]).toBe("vented");
    const state = press(idle(), "i", game);
    expect(state.overlay).toBe("codex");
    expect(codexView(game, state)?.entry.id).toBe("vented");
  });

  it("reads the key and not the wording, and ignores every other tone", () => {
    const game = run();
    game.log.add("…", game.schedule.time, "warn", "log.hazard.tell.vented");
    expect(alarmCodexId(game)).toBeUndefined();

    alarmLine(game, "log.door.cut.done");
    expect(alarmCodexId(game)).toBeUndefined();

    alarmLine(game, "log.hazard.tell.nothing-like-this");
    expect(alarmCodexId(game)).toBeUndefined();
  });
});

// ----------------------------------------------------------------- the window

describe("the `i` window", () => {
  it("is the key `i`, and nothing else claims it", () => {
    expect(toIntent({ key: "i" })).toEqual({ kind: "codex" });
  });

  it("opens on the first unread card, reads it, and closes on esc", () => {
    const game = run();
    noticeCodex(game, "spasm");
    noticeCodex(game, "ghost");

    const open = press(idle(), "i", game);
    expect(open.overlay).toBe("codex");
    expect(codexView(game, open)?.entry.id).toBe("spasm");
    // Read on the frame it is shown: the badge and the card never disagree.
    expect(codexUnread(game)).toBe(1);

    const shut = press(open, "Escape", game);
    expect(shut.overlay).toBe("none");
    expect(shut.codex).toEqual([]);
  });

  it("spends no turn and writes no line, whichever way it is used", () => {
    const game = run();
    noticeCodex(game, "spasm");
    noticeCodex(game, "ghost");
    const turn = game.schedule.time;
    const lines = game.log.tail(50).length;

    let state = press(idle(), "i", game);
    state = press(state, "ArrowRight", game);
    state = press(state, "ArrowLeft", game);
    state = press(state, "Escape", game);

    expect(state.effect).toEqual({ kind: "idle" });
    expect(game.schedule.time).toBe(turn);
    expect(game.log.tail(50).length).toBe(lines);
  });

  it("pages with the arrows, wrapping, and reads what it lands on", () => {
    const game = run();
    noticeCodex(game, "spasm");
    noticeCodex(game, "ghost");

    let state = press(idle(), "i", game);
    state = press(state, "ArrowRight", game);
    expect(codexView(game, state)?.entry.id).toBe("ghost");
    expect(codexUnread(game)).toBe(0);
    // The list the window opened with is a snapshot: reading everything on it
    // does not take the pages out from under the reader.
    state = press(state, "ArrowRight", game);
    expect(codexView(game, state)?.entry.id).toBe("spasm");
    state = press(state, "ArrowLeft", game);
    expect(codexView(game, state)?.entry.id).toBe("ghost");
  });

  it("closes on the same key that opened it", () => {
    const game = run();
    noticeCodex(game, "spasm");
    const open = press(idle(), "i", game);
    expect(press(open, "i", game).overlay).toBe("none");
  });

  it("opens the help card when there is nothing unread, with the list in it", () => {
    const game = run();
    noticeCodex(game, "spasm");
    readCodex(game, "spasm");

    const state = press(idle(), "i", game);
    expect(state.overlay).toBe("help");
    expect(codexSeen(game)).toEqual([t("codex.spasm.title")]);
    expect(helpPages(false, codexSeen(game)).flat()).toContain(` ${t("codex.spasm.title")}`);
  });

  it("leaves the help card without the block on a run that has met nothing", () => {
    expect(helpPages(false).flat()).not.toContain(t("help.codex.head"));
  });

  it("does not come up over a run that is already over", () => {
    const game = run();
    noticeCodex(game, "spasm");
    game.finish("dead", t("log.death"));
    expect(press(idle(), "i", game).overlay).not.toBe("codex");
  });

  it("marks the modules the drone is actually carrying", () => {
    const game = run();
    const rig = rigOf(game.player)!;
    install(rig, "welder", 5);
    noticeCodex(game, "spasm");
    const view = codexView(game, press(idle(), "i", game))!;
    expect(view.fitted.has("welder")).toBe(true);

    const helps = codexBody(view.entry, view.fitted).find((line) => line.includes(t("codex.label.helps")))!;
    expect(helps).toContain(t("codex.fitted"));
    const bare = codexBody(view.entry, new Set<ModuleId>()).find((line) =>
      line.includes(t("codex.label.helps")),
    )!;
    expect(bare).not.toContain(t("codex.fitted"));
  });
});

// ------------------------------------------------------------------ the badge

describe("the badge in the corner", () => {
  it("counts the unread and disappears at zero", () => {
    const game = run();
    expect(codexBadge(game)).toBeUndefined();
    noticeCodex(game, "spasm");
    noticeCodex(game, "ghost");
    expect(codexBadge(game)).toBe(t("codex.badge", { n: 2 }));
    readCodex(game, "spasm");
    expect(codexBadge(game)).toBe(t("codex.badge", { n: 1 }));
    readCodex(game, "ghost");
    expect(codexBadge(game)).toBeUndefined();
  });

  it("is on the page, and gone from it when there is nothing to read", () => {
    const game = run();
    const state = idle();
    expect(screenHtml(game, state, new Set())).not.toContain("web-codex");
    noticeCodex(game, "spasm");
    expect(screenHtml(game, state, new Set())).toContain("web-codex");
    expect(screenHtml(game, state, new Set())).toContain(codexBadge(game)!);
  });

  it("puts the card on the page when the window is open", () => {
    const game = run();
    noticeCodex(game, "spasm");
    const state = press(idle(), "i", game);
    const html = screenHtml(game, state, new Set());
    expect(html).toContain(t("codex.spasm.title"));
    expect(html).toContain(t("codex.label.wrong"));
  });
});

// ----------------------------------------------------------------- the widths

describe("the window fits, in all three languages", () => {
  it("wraps every card inside its own column", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const id of CODEX_IDS) {
        const entry = codexFor(id)!;
        for (const fitted of [new Set<ModuleId>(), new Set<ModuleId>(entry.modules ?? [])]) {
          for (const line of codexBody(entry, fitted)) {
            expect(line.length, `${lang}: ${id}: ${line}`).toBeLessThanOrEqual(CODEX_WIDTH);
          }
        }
      }
    }
  });

  it("keeps the frame on the screen, and the whole card inside it", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const id of CODEX_IDS) {
        const entry = codexFor(id)!;
        const fitted = new Set<ModuleId>(entry.modules ?? []);
        const heading = codexHeading(entry);
        const body = codexBody(entry, fitted);
        const footer = codexFooter(0, CODEX_IDS.length);
        const box = codexBox(heading, body, footer);
        expect(box.width, `${lang}: ${id}`).toBeLessThanOrEqual(SCREEN_WIDTH);
        expect(box.height, `${lang}: ${id}`).toBeLessThanOrEqual(SCREEN_HEIGHT);
        for (const line of [heading, ...body, footer]) {
          expect(line.length, `${lang}: ${id}: ${line}`).toBeLessThanOrEqual(box.inner);
        }
      }
    }
  });

  it("keeps a title short enough for the panel's own column", () => {
    // The titles are the list at the foot of the help card, and the narrowest
    // column any of them could ever be asked to sit in is the panel's.
    for (const lang of LANGS) {
      setLang(lang);
      for (const id of CODEX_IDS) {
        const title = t(codexFor(id)!.title);
        expect(title.length, `${lang}: ${title}`).toBeLessThanOrEqual(PANEL_WIDTH);
      }
    }
  });

  it("keeps the help card on the screen with everything this table can add", () => {
    const everything = CODEX_IDS.map((id) => t(codexFor(id)!.title));
    for (const lang of LANGS) {
      setLang(lang);
      const seen = CODEX_IDS.map((id) => t(codexFor(id)!.title));
      for (const onTug of [true, false]) {
        const box = helpBox(onTug, seen);
        expect(box.width, `${lang} tug ${onTug}`).toBeLessThanOrEqual(SCREEN_WIDTH);
        expect(box.height, `${lang} tug ${onTug}`).toBeLessThanOrEqual(SCREEN_HEIGHT);
        for (const line of helpPages(onTug, seen).flat()) {
          expect(line.length, `${lang}: ${line}`).toBeLessThanOrEqual(box.inner);
        }
      }
    }
    expect(everything.length).toBe(CODEX_IDS.length);
    expect(BOX_PAD_X).toBeGreaterThan(0);
  });
});
