import { afterEach, describe, expect, it } from "vitest";
import { RoomGame, TURN_COST, type RoomGameConfig, type System } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { moduleKind, type ModuleId } from "../src/content/modules.js";
import { STRAINS, type StrainId } from "../src/content/viruses.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import { CURE_TURNS, SPIKE_CURE_TURNS, tryInfect, virusOf } from "../src/systems/virus.js";
import { findSlot, rigOf } from "../src/twist/rig.js";
import { appReducer, initialState, syncStatus, type AppState } from "../src/ui/appstate.js";
import { CODEX_WIDTH, VIRUS_KEY, toIntent, type KeyLike } from "../src/ui/input.js";
import { panelBlocks } from "../src/ui/panel.js";
import { codexBox } from "../src/ui/render.js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../src/ui/theme.js";
import { virusCard } from "../src/ui/viruscard.js";
import { htmlOf, screenHtml } from "../src/ui/web/index.js";

/**
 * The virus window (docs/tasks/G90-smoreg-wave.md, C2): raised by the turn that
 * brings a virus aboard, opened on demand by `v` or a click on the panel's
 * virus line, put away by any key — and never a turn. Pure transitions and
 * pure text, as every other card in this game is tested.
 */

afterEach(() => setLang(DEFAULT_LANG));

const PAIR = `
  TUG -a1- r1
  r1 -d1- r2
  r1: docking explored
  r2: cargo explored
`;

/** `act infect {slot}`: a virus, certainly, on the real turn cycle. */
const INFECTOR: System<RoomGame> = {
  name: "test-infector",
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== "infect") return undefined;
    tryInfect(game, cmd.slot ?? 0, "ghost", 1);
    return { ok: true, cost: TURN_COST };
  },
};

function config(): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    systems: [...(GAME_CONFIG.systems ?? []), INFECTOR],
    firstShip: () => shipFromText(PAIR).ship,
    firstShipId: "1",
  };
}

function run(seed = 7): RoomGame {
  const game = new RoomGame({ ...config(), seed });
  game.player.room = game.ship.room("r1").id;
  game.refreshSight();
  return game;
}

const press = (key: string): KeyLike => ({ key });

function key(state: AppState, k: string, game: RoomGame): AppState {
  return appReducer(state, toIntent(press(k), rigOf(game.player)), game);
}

/** The title down and nothing in front of the board. */
function playing(game: RoomGame): AppState {
  return syncStatus({ ...initialState(), overlay: "none" }, game);
}

function slotOf(game: RoomGame, kind: ModuleId): number {
  const i = findSlot(rigOf(game.player)!, kind);
  if (i === null) throw new Error(`no ${kind}`);
  return i;
}

function infect(game: RoomGame, kind: ModuleId = "cell", strain?: StrainId): void {
  expect(game.playerCommand({ kind: "act", verb: "infect", slot: slotOf(game, kind) }).ok).toBe(true);
  if (strain !== undefined) virusOf(game.player)!.strain = strain;
}

function fitSpike(game: RoomGame): void {
  const rig = rigOf(game.player)!;
  const i = rig.slots.findIndex((s) => s === null);
  rig.slots[i] = { kind: "spike", integrity: moduleKind("spike").integrity };
}

describe("the virus window, as a card", () => {
  it("opens by itself on the turn the drone catches one", () => {
    const game = run();
    let state = playing(game);
    game.playerCommand({ kind: "wait" });
    state = syncStatus(state, game);
    expect(state.overlay).toBe("none");

    infect(game);
    state = syncStatus(state, game);
    expect(state.overlay).toBe("virus");
  });

  it("is put away by any key, spending nothing", () => {
    const game = run();
    let state = playing(game);
    infect(game);
    state = syncStatus(state, game);
    const turns = game.inputs.length;

    for (const k of ["1", "o", "Escape", VIRUS_KEY, "."]) {
      const next = key(state, k, game);
      expect(next.overlay, k).toBe("none");
      expect(next.effect, k).toEqual({ kind: "idle" });
    }
    expect(game.inputs.length).toBe(turns);
  });

  it("does not come back by itself for the virus it already showed", () => {
    const game = run();
    let state = syncStatus(playing(game), game);
    infect(game);
    state = key(syncStatus(state, game), "Escape", game);
    for (let n = 0; n < 5; n++) {
      game.playerCommand({ kind: "wait" });
      state = syncStatus(state, game);
      expect(state.overlay).toBe("none");
    }
  });

  it("opens on `v`, and on a clean rack says so in a line instead", () => {
    const game = run();
    const clean = key(playing(game), VIRUS_KEY, game);
    expect(clean.overlay).toBe("none");
    expect(clean.effect).toEqual({ kind: "log", text: t("why.virus.none") });

    let state = playing(game);
    infect(game);
    state = key(syncStatus(state, game), "Escape", game);
    const turns = game.inputs.length;
    state = key(state, VIRUS_KEY, game);
    expect(state.overlay).toBe("virus");
    expect(game.inputs.length).toBe(turns);
  });

  it("comes up again for the next virus, once the last one is purged", () => {
    const game = run();
    let state = playing(game);
    infect(game);
    state = key(syncStatus(state, game), "Escape", game);
    const cell = slotOf(game, "cell");
    for (let n = 0; n < CURE_TURNS; n++) {
      expect(game.playerCommand({ kind: "act", verb: "cure", slot: cell }).ok).toBe(true);
      state = syncStatus(state, game);
    }
    expect(virusOf(game.player)).toBeUndefined();

    infect(game, "plating");
    expect(syncStatus(state, game).overlay).toBe("virus");
  });

  it("gives way to the run ending", () => {
    const game = run();
    const state = playing(game);
    infect(game);
    game.player.hp = 0;
    game.status = "dead";
    expect(syncStatus(state, game).overlay).toBe("dead");
  });
});

describe("what the window says", () => {
  it("names the strain and the module, what it does with its numbers, and every cure", () => {
    const game = run();
    infect(game, "cell");
    const card = virusCard(game)!;
    expect(card.heading).toBe("[v] SPASM VIRUS IN YOUR CELL");
    const text = card.body.map((l) => l.trim()).join(" ");
    expect(text).toContain("every 8 turns it exposes your CELL");
    expect(text).toContain("Next time in 8 turns.");
    expect(text).toContain("In 20 turns it crawls into the next module.");
    expect(text).toContain(`${CURE_TURNS} turns in a row by hand`);
    expect(text).toContain(`${SPIKE_CURE_TURNS} turns, and the SPIKE takes the blows`);
    expect(text).toContain("4 CR");
    expect(text).toContain("sell the module for half, or stow it");
    expect(text).not.toMatch(/weld/i);
    expect(card.footer).toBe("any key closes");
  });

  it("counts down with the run, marks a SPIKE in the rack, and shows a purge under way", () => {
    const game = run();
    infect(game, "cell", "leash");
    game.playerCommand({ kind: "wait" });
    fitSpike(game);
    game.playerCommand({ kind: "act", verb: "cure", slot: slotOf(game, "cell") });
    const text = virusCard(game)!.body.map((l) => l.trim()).join(" ");
    expect(text).toContain("every 18 turns it takes 1 off the core");
    expect(text).toContain("Next time in 16 turns.");
    expect(text).toContain("It never leaves this module.");
    expect(text).toContain(t("codex.fitted"));
    expect(text).toContain(`Purging now: ${SPIKE_CURE_TURNS - 1} turns left.`);
  });

  it("is empty on a clean drone", () => {
    expect(virusCard(run())).toBeUndefined();
  });

  it("fits the card frame in every language, for every strain", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const strain of STRAINS) {
        const game = run();
        infect(game, "thrusters", strain.id);
        fitSpike(game);
        const card = virusCard(game)!;
        for (const line of card.body) expect(line.length, `${lang} ${line}`).toBeLessThanOrEqual(CODEX_WIDTH);
        const box = codexBox(card.heading, card.body, card.footer);
        expect(box.width, `${lang} ${strain.id}`).toBeLessThanOrEqual(SCREEN_WIDTH);
        expect(box.height, `${lang} ${strain.id}`).toBeLessThanOrEqual(SCREEN_HEIGHT);
        const all = [card.heading, ...card.body, card.footer].join("\n");
        if (lang !== "ru") expect(all, lang).not.toMatch(/[А-Яа-яЁё]/);
        else expect(all.replace(/\bCR\b|\[v\]/g, "")).not.toMatch(/[A-Za-z]{2}/);
      }
    }
  });
});

describe("the panel's virus line", () => {
  it("leads with its key in the terminal and is a thing to click on the page", () => {
    const game = run();
    infect(game, "cell");
    const blocks = panelBlocks(game, []);
    const line = blocks.find((l) => l.press !== undefined)!;
    expect(line.text).toBe("v SPASM: exposes every 8");
    expect(line.press).toBe(VIRUS_KEY);
    expect(htmlOf(blocks, [], [], 0)).toContain(`data-key="${VIRUS_KEY}"`);
  });

  it("presses `v`, which is the window and nothing else", () => {
    expect(toIntent(press("v"))).toEqual({ kind: "virus" });
    expect(toIntent(press("V")).kind).not.toBe("virus");
  });

  it("draws the window on the page in front of the board", () => {
    const game = run();
    infect(game, "cell");
    const html = screenHtml(game, { ...initialState(), overlay: "virus" }, new Set());
    expect(html).toContain("SPASM VIRUS IN YOUR CELL");
    expect(html).toContain('class="card bad"');
  });
});
