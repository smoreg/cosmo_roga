import { describe, it, expect } from "vitest";
import { spawnMonster, type Entity, type Game } from "@jamrog/engine";
import { fromAscii } from "@jamrog/engine/testing";
import { newGame } from "../src/game.js";
import { MONSTERS } from "../src/content/monsters.js";
import { RIG, findSlot, rigOf, type Rig } from "../src/twist/rig.js";
import { ALERT, alertState } from "../src/systems/alert.js";
import { THEME } from "../src/ui/theme.js";
import {
  NO_FLASH,
  flashSlots,
  panelColour,
  rackIntegrity,
  slotNumberOf,
  trackFlash,
  type PanelLine,
} from "../src/ui/panel.js";

/**
 * The sidebar, read as text.
 *
 * The panel is the twist's teaching surface: the ◀ marker moving with every
 * command is what tells a player that a blow lands on what they just used, and
 * the ALERT gauge is the only warning that the deck is filling up. Both used to
 * be checked by looking at the screen. Here the lines are what the systems hand
 * over — `panelLines` — and the colouring is `panelColour`, so the whole panel
 * is text plus a hex code and nothing rendered.
 */

function gameOn(rows: string[], seed = 7): { game: Game; monsters: Entity[] } {
  const game = newGame(seed);
  const f = fromAscii(rows);
  game.level = f.level;
  game.entities = [game.player];
  game.player.pos = { ...f.player! };
  const monsters: Entity[] = [];
  for (const m of f.marks) {
    const kind = MONSTERS.find((k) => k.ch === m.ch);
    if (!kind) continue;
    const e = spawnMonster(kind, m.pos);
    game.schedule.admit(e);
    game.entities.push(e);
    monsters.push(e);
  }
  game.refreshFov();
  return { game, monsters };
}

/** An empty room: nothing on the deck can hit the rack while a command is tested. */
const ROOM = ["#######", "#.....#", "#..@..#", "#.....#", "#######"];

function panel(game: Game): PanelLine[] {
  return RIG.panelLines?.(game) ?? [];
}

function alertPanel(game: Game): PanelLine[] {
  return ALERT.panelLines?.(game) ?? [];
}

/** The line the marker is on, without the marker itself being searched for twice. */
function exposedLine(game: Game): PanelLine {
  const line = panel(game).find((l) => l.text.includes("◀"));
  if (!line) throw new Error(`nothing is exposed:\n${panel(game).map((l) => l.text).join("\n")}`);
  return line;
}

function rig(game: Game): Rig {
  return rigOf(game.player)!;
}

describe("the rack panel", () => {
  it("moves the marker onto the module the command just used", () => {
    const { game } = gameOn(ROOM);

    game.playerCommand({ kind: "move", dx: 1, dy: 0 });
    expect(exposedLine(game).text).toContain("THRUSTERS");

    game.playerCommand({ kind: "wait" });
    expect(exposedLine(game).text).toContain("PLATING");

    // Firing a module exposes that module, whichever slot it sits in.
    const scanner = findSlot(rig(game), "scanner")!;
    game.playerCommand({ kind: "use", slot: scanner });
    expect(exposedLine(game).text).toContain("SCANNER");
    expect(slotNumberOf(exposedLine(game).text)).toBe(scanner);
  });

  it("accents the exposed line and leaves the rest of the rack plain", () => {
    const { game } = gameOn(ROOM);
    game.playerCommand({ kind: "move", dx: 1, dy: 0 });

    const lines = panel(game);
    const accented = lines.filter((l) => l.fg === THEME.accent);
    expect(accented).toHaveLength(1);
    expect(accented[0]!.text).toContain("◀");
    expect(panelColour(accented[0]!, new Set())).toBe(THEME.accent);
  });

  it("draws integrity as bars, full ones first", () => {
    const { game } = gameOn(ROOM);
    const slot = findSlot(rig(game), "cutter")!;
    rig(game).slots[slot]!.integrity = 2;

    const line = panel(game).find((l) => l.text.includes("CUTTER"))!;
    // CUTTER is a 4-integrity module: two standing, two gone.
    expect(line.text).toContain("▮▮▯▯");
  });

  it("tells a burned slot from one that was never filled", () => {
    const { game } = gameOn(ROOM);
    const scanner = findSlot(rig(game), "scanner")!;
    rig(game).slots[scanner] = null;
    rig(game).scars[scanner] = "scanner";

    const lines = panel(game);
    const burned = lines.find((l) => l.text.includes("burned"))!;
    expect(burned.text).toBe(`${scanner + 1} -- burned --`);
    expect(burned.fg).toBe(THEME.burned);
    expect(panelColour(burned, new Set())).toBe(THEME.burned);

    // The starting rack has one slot that never held anything: that one is dim,
    // not burned — an empty slot is where salvage goes, and it must read as such.
    const empty = lines.find((l) => l.text.includes("empty"))!;
    expect(empty.fg).toBe(THEME.fgDim);
  });

  it("shows the core above the rack, and reddens it at the last point", () => {
    const { game } = gameOn(ROOM);
    expect(panel(game)[0]!.text).toContain("CORE");
    expect(panel(game)[0]!.fg).toBe(THEME.fg);

    game.player.hp = 1;
    expect(panel(game)[0]!.fg).toBe(THEME.hpLow);
  });
});

describe("the alert gauge", () => {
  it("fills as the station wakes up", () => {
    const { game } = gameOn(ROOM);
    expect(alertPanel(game)[0]!.text).toBe("ALERT ▯▯▯▯▯");

    alertState(game).level = 2;
    expect(alertPanel(game)[0]!.text).toBe("ALERT ▮▮▯▯▯");
  });

  it("stays plain while it is quiet, warns in the middle and reddens at the top", () => {
    const { game } = gameOn(ROOM);

    for (const [level, colour] of [
      [0, undefined],
      [2, undefined],
      [3, THEME.warn],
      [4, THEME.warn],
      [5, THEME.bad],
    ] as const) {
      alertState(game).level = level;
      const line = alertPanel(game)[0]!;
      expect(line.fg, `alert ${level}`).toBe(colour);
      expect(panelColour(line, new Set()), `alert ${level}`).toBe(colour ?? THEME.fg);
    }
  });
});

describe("the damage flash", () => {
  it("marks the slots that lost integrity between two frames", () => {
    expect([...flashSlots([4, 3, 2], [4, 2, 2])]).toEqual([1]);
    expect([...flashSlots([4, 3, 2], [3, 2, 2])]).toEqual([0, 1]);
    expect([...flashSlots([4, 3, 2], [4, 3, 2])]).toEqual([]);
    // Repairs and salvage are not blows.
    expect([...flashSlots([4, 0, 2], [4, 3, 2])]).toEqual([]);
    // A rack the panel has not seen before flashes nothing: that is a run
    // starting, not five modules being hit at once.
    expect([...flashSlots([], [4, 3, 2])]).toEqual([]);
  });

  it("reads the rack straight off the player", () => {
    const { game } = gameOn(ROOM);
    const before = rackIntegrity(game.player);
    const cutter = findSlot(rig(game), "cutter")!;
    rig(game).slots[cutter]!.integrity -= 1;

    expect([...flashSlots(before, rackIntegrity(game.player))]).toEqual([cutter]);
  });

  it("holds the flash for its own turn and drops it on the next one", () => {
    const hit = trackFlash(trackFlash(NO_FLASH, [4, 3], 10), [3, 3], 11);
    expect([...hit.slots]).toEqual([0]);
    expect(hit.turn).toBe(11);

    // Redrawn on the same turn — a help card opened and closed — it still shows.
    const again = trackFlash(hit, [3, 3], 11);
    expect([...again.slots]).toEqual([0]);

    // A turn later it is gone, and stays gone.
    const later = trackFlash(again, [3, 3], 12);
    expect([...later.slots]).toEqual([]);
    expect([...trackFlash(later, [3, 3], 13).slots]).toEqual([]);
  });

  it("beats every other colour on the line it is on", () => {
    const exposed: PanelLine = { text: "2 THRUSTERS ▮▮▯  ◀", fg: THEME.accent };
    expect(panelColour(exposed, new Set([1]))).toBe(THEME.bad);
    expect(panelColour(exposed, new Set([0]))).toBe(THEME.accent);

    // A line that is not a slot cannot flash, whatever the set says.
    expect(panelColour({ text: "CORE  ▮▮▮" }, new Set([0, 1, 2]))).toBe(THEME.fg);
    expect(slotNumberOf("CORE  ▮▮▮")).toBeUndefined();
    expect(slotNumberOf("3 SCANNER ▮▮")).toBe(2);
  });
});
