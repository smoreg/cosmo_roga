import { describe, it, expect } from "vitest";
import { RoomGame, spawnMonsterIn, type Entity, type RoomGameConfig } from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { debugBlock, debugLines } from "../src/ui/debug.js";
import { isDebugKey } from "../src/ui/input.js";
import { panelBlocks } from "../src/ui/panel.js";
import { debugHtml, htmlOf } from "../src/ui/web/panel-html.js";

/**
 * The owner's debug overlay (G68): a pure read of the running game, off
 * unless the flag is on, and never a turn — so what is tested is exactly
 * that, and never anything the overlay's own words happen to say today.
 */

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

function gameIn(room = "r2"): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(CARGO).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed: 7 });
  game.player.room = game.ship.room(room).id;
  game.refreshSight();
  return game;
}

function put(game: RoomGame, room: string, id: string): Entity {
  const kind = MONSTERS.find((m) => m.id === id);
  if (!kind) throw new Error(`no machine '${id}'`);
  const e = spawnMonsterIn(kind, game.ship.room(room).id);
  game.schedule.admit(e);
  game.entities.push(e);
  game.refreshSight();
  return e;
}

describe("debugLines", () => {
  it("names every machine aboard, its compartment and its distance", () => {
    const game = gameIn();
    put(game, "r2", "security-unit"); // same room as the drone: distance 0
    put(game, "r5", "welder-bot"); // one open door away: distance 1

    const lines = debugLines(game);
    const security = lines.find((l) => l.includes("security unit"));
    const welder = lines.find((l) => l.includes("welder bot"));

    expect(security).toBeDefined();
    expect(security).toContain("room=r2");
    expect(security).toContain("behaviour=brute");
    expect(security).toContain("dist=0");

    expect(welder).toBeDefined();
    expect(welder).toContain("room=r5");
    expect(welder).toContain("behaviour=coward");
    expect(welder).toContain("dist=1");
  });

  it("still says something about a quiet ship: the alert, an empty muster and the rest", () => {
    const game = gameIn();
    const lines = debugLines(game);
    expect(lines.some((l) => l.startsWith("ALERT"))).toBe(true);
    expect(lines).toContain("MACHINES none");
    expect(lines.some((l) => l.startsWith("DRONE"))).toBe(true);
    expect(lines.some((l) => l.startsWith("RIVAL"))).toBe(true);
    expect(lines.some((l) => l.startsWith("VIRUS"))).toBe(true);
    expect(lines.some((l) => l.startsWith("RELICS"))).toBe(true);
  });

  it("spends no turn and writes no line of the log", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const inputsBefore = game.inputs.length;
    const logBefore = game.log.lines.length;
    const hpBefore = game.player.hp;
    debugLines(game);
    expect(game.inputs.length).toBe(inputsBefore);
    expect(game.log.lines.length).toBe(logBefore);
    expect(game.player.hp).toBe(hpBefore);
  });
});

describe("debugBlock", () => {
  it("is debugLines when the flag is on, and nothing when it is off", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    expect(debugBlock(game, true)).toEqual(debugLines(game));
    expect(debugBlock(game, false)).toEqual([]);
  });
});

describe("`` ` `` toggles the overlay", () => {
  it("is the debug key and nothing else on the keyboard is", () => {
    expect(isDebugKey({ key: "`" })).toBe(true);
    expect(isDebugKey({ key: "a" })).toBe(false);
    expect(isDebugKey({ key: "?" })).toBe(false);
  });
});

describe("the web panel", () => {
  it("carries the overlay's block when the flag is on, and none of it when it is off", () => {
    const game = gameIn();
    put(game, "r2", "security-unit");
    const blocks = panelBlocks(game, [], 0);

    const on = debugHtml([{ text: debugLines(game)[0]!, fg: "#8a8f98" }]);
    expect(on).toContain("web-debug");
    expect(on).toContain("ALERT");

    const off = debugHtml([]);
    expect(off).toBe("");

    // And the ordinary panel itself never carries the overlay's own words —
    // the two sections are handed to the page separately.
    const panelHtml = htmlOf(blocks, [], [], -1);
    expect(panelHtml).not.toContain("web-debug");
  });
});
