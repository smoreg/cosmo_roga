import { describe, expect, it } from "vitest";
import {
  Rng,
  RoomGame,
  isAlive,
  reachableWithKeys,
  type RoomCommand,
  type RoomGameConfig,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import { BOTS_ROOMS, roomPlay, runBotOn, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { TUTORIAL_ID, TUTORIAL_SEED, TUTORIAL_SPEC, TUTORIAL_STEPS } from "../src/content/tutorial.js";
import {
  HINT_LINE_KEYS,
  ONBOARDING_HINTS,
  saidHint,
  soldLine,
  tugOpening,
} from "../src/content/hints.js";
import { t } from "../src/i18n.js";
import { CHEAPEST_HULL, STARTING_CREDITS } from "../src/content/hulls.js";
import { moduleKind } from "../src/content/modules.js";
import { STARTER_HULLS, classOfShip, flavourCallsign } from "../src/content/derelicts.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { TUG_ID, TUG_ROOMS, isTug } from "../src/content/tug.js";
import { GHOST_HINT_KEY } from "../src/systems/ghost.js";
import { POPULATE, roomList, type Body, type Crate, type ShipSystem, type Wreck } from "../src/systems/populate.js";
import { DOORS } from "../src/systems/doors.js";
import { VOYAGE, cratePrice, currentDerelict, undock, voyageOf } from "../src/systems/voyage.js";
import { RIG, hostilesIn, rigOf, type Rig } from "../src/twist/rig.js";
import { makeExplorer } from "../src/ui/auto.js";
import { roomActions } from "../src/ui/actions.js";
import { appReducer, initialState, type AppState } from "../src/ui/appstate.js";
import { toIntent } from "../src/ui/input.js";

/**
 * Onboarding, measured (`docs/tasks/G32-onboarding-v2.md`).
 *
 * There is no tutorial to test: the game explains itself by what it puts in
 * front of the player and in what order (design-doc.md, "Обучение
 * конструкцией"). That makes every claim in that section a number, and this
 * file is where the numbers are taken — on two hundred seeds of the real game,
 * through `newGame`, the real key table and the real generator.
 *
 * Every percentage is printed as well as asserted. A run of this file is a
 * report on how the first five minutes are going, and a threshold that starts
 * failing should be read next to the number underneath it.
 */

const SEEDS = 200;

/** What a body is worth, from `systems/doors.ts` — its own constant is private. */
const BODY_CREDITS = 3;

/** What raising one of the ship's three systems pays on account. */
const ADVANCE = OBJECTIVES[0]!.advance;

/** The one charter the first hull offers: `SALVAGE · bring home 20 CR`. */
const SALVAGE_TARGET = 20;

/** The second bar of design-doc.md's opening: a second drone costs this. */
const HULL_PRICE = CHEAPEST_HULL.price;

const pct = (n: number, of = SEEDS): string => `${((n / of) * 100).toFixed(1)}%`;

function report(title: string, rows: Record<string, number>): void {
  const line = Object.entries(rows)
    .map(([name, n]) => `${name} ${pct(n)}`)
    .join("  ·  ");
  console.log(`${title}: ${line}`);
}

// --------------------------------------------------------------- the ship

/** Compartments the drone can walk to without opening a lock or a seam. */
function reachableUnlocked(ship: Ship): Set<RoomId> {
  const seen = new Set<RoomId>([ship.entry]);
  const queue: RoomId[] = [ship.entry];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const door of ship.doorsOf(at)) {
      if (door.state === "locked" || door.state === "sealed" || door.state === "airlock") continue;
      const far = ship.other(door, at);
      if (!seen.has(far)) {
        seen.add(far);
        queue.push(far);
      }
    }
  }
  return seen;
}

/**
 * Credits a sortie could carry out of these compartments.
 *
 * Exactly the three things that reach `player.data.loot`, which is what the
 * `SALVAGE` charter counts and what the hold pays for at the airlock: the dead,
 * the crates, and the advance on each system the drone brings up. Salvaged
 * modules are deliberately not in it — those are sold at the HOLD and are
 * credits, not hold.
 */
function lootIn(ship: Ship, rooms: ReadonlySet<RoomId>): number {
  let total = 0;
  for (const room of ship.rooms) {
    if (!rooms.has(room.id)) continue;
    total += roomList<Body>(room, "bodies").length * BODY_CREDITS;
    for (const crate of roomList<Crate>(room, "crates")) total += cratePrice(crate);
    total += roomList<ShipSystem>(room, "systems").length * ADVANCE;
  }
  return total;
}

/** The compartment holding the body with a key on it, if the ship has one. */
function keyRoom(ship: Ship): RoomId | undefined {
  return ship.rooms.find((r) => roomList<Body>(r, "bodies").some((b) => b.key !== undefined))?.id;
}

/** A run standing aboard the first freighter, one `undock` in. */
function aboard(seed: number): RoomGame {
  const game = newGame(seed);
  expect(undock(game).ok, `seed ${seed}`).toBe(true);
  return game;
}

// -------------------------------------------------------- the first key press

describe("the first thing a player ever does", () => {
  /**
   * Title, any key, `2`. Two presses to be aboard a derelict, and the second of
   * them is the line itself rather than a walk to the compartment that carries
   * it (docs/tasks/G53-tug-is-a-menu.md, test 2).
   *
   * The old wording of this test — "in two key presses" with `1` for the DOCK's
   * only line — described a tug you walked: the DOCK's list held nothing but
   * casting off, precisely because the other three stations were three walks
   * away. Now every verb is on one screen, casting off is the second row of the
   * first group, and it is still one press.
   */
  it("casts off in one press of the list, on every seed", () => {
    let worst = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = newGame(seed);
      let state: AppState = initialState();
      let presses = 0;

      const press = (key: string): void => {
        presses++;
        const rig: Rig | undefined = rigOf(game.player) ?? undefined;
        state = appReducer(state, toIntent({ key }, rig), game);
        if (state.effect.kind === "command") {
          expect(game.playerCommand(state.effect.cmd as RoomCommand).ok, `seed ${seed}`).toBe(true);
        }
      };

      expect(state.overlay).toBe("title");
      press("z"); // any key at all clears the title
      expect(state.overlay, `seed ${seed}`).toBe("none");

      // The line, wherever the ten rows put it — and they put it in the same
      // place on every seed, which is the other half of what this holds.
      const list = roomActions(game);
      const off = list.findIndex((a) => a.cmd.kind === "act" && a.cmd.verb === "undock");
      expect(off, `seed ${seed}`).toBe(list.length - 1);
      press(list[off]!.key);

      expect(game.shipId, `seed ${seed}`).not.toBe(TUG_ID);
      expect(presses, `seed ${seed}`).toBeLessThanOrEqual(2);
      worst = Math.max(worst, presses);
    }
    console.log(`first action: ${worst} key presses, worst of ${SEEDS} seeds`);
  });

  it("puts every verb of the tug on the first screen, in one fixed order", () => {
    // What replaced "one pressable line per compartment": there are no
    // compartments to have a line each. Ten rows, always the same ten, and the
    // drone never leaves the room it started in.
    const game = newGame(11);
    const labels = (): string[] => roomActions(game).map((a) => a.label);

    expect(labels()[0]).toBe("buy a hull ▸");
    // The row that casts off comes last and is a checklist of what the visit
    // home has left undone; a fresh board has one thing on it
    // (docs/tug-menu-audit.md, "what a designer would do", 5, and П7).
    expect(labels()[9]).toBe("cast off no job");
    expect(labels().some((l) => l.startsWith("take a charter"))).toBe(true);
    expect(roomActions(game)).toHaveLength(10);
    expect(roomActions(game).every((a) => a.key !== "")).toBe(true);

    // And the same ten from anywhere aboard, because nothing about them is
    // about where the drone is standing.
    for (const door of [1, 2, 3]) expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
    expect(labels()[9]).toBe("cast off no job");

    // The board itself, one level down, and the first line of it is the point
    // of the game: raise three systems and the tug sells the hull whole.
    const board = roomActions(game, "charter").filter((a) => a.cmd.kind === "act" && a.cmd.verb === "charter");
    expect(board.map((a) => a.label)).toEqual(["take NEUTRALIZE (200 CR)", "take SALVAGE (20 CR)"]);

    // With nothing outstanding the row is the hull by its callsign: a voyage
    // can draw two freighters, and the line that flies you to one has to say
    // which (G55, 17).
    expect(game.playerCommand(board[0]!.cmd).ok).toBe(true);
    expect(labels()[9]).toBe(`cast off → ${flavourCallsign(currentDerelict(game).flavour)}`);
  });

  /**
   * The first screen of a run, on every seed: the whole tug on one list, the
   * rack on it from the start, a reason on every dead row, and a log line that
   * says what the screen is for (docs/tasks/G40-tug-clarity.md, 2–4 as G53
   * leaves them).
   */
  it("opens on ten rows, the rack among them and a sentence, on 200 seeds", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = newGame(seed);
      const list = roomActions(game);

      expect(list, `seed ${seed}`).toHaveLength(10);
      expect(list[9]!.label, `seed ${seed}`).toMatch(/^cast off /);
      expect(list[9]!.enabled, `seed ${seed}`).toBe(true);
      // The rack, always: three hulls one level down, the drone on the rails
      // among them (docs/tasks/G40-tug-clarity.md, 3).
      const rack = roomActions(game, "buy");
      expect(rack.filter((a) => a.label.includes("on the rack")), `seed ${seed}`).toHaveLength(1);
      expect(rack.filter((a) => a.label.startsWith("buy ")), `seed ${seed}`).toHaveLength(2);
      for (const line of list.filter((a) => !a.enabled)) {
        expect(line.why, `seed ${seed}: ${line.label}`).toBeTruthy();
      }
      // No second way out, and nothing of the derelict's own verbs.
      expect(list.some((a) => a.cmd.kind === "leave" || a.cmd.kind === "go"), `seed ${seed}`).toBe(false);
      expect(game.log.lines[0]!.text, `seed ${seed}`).toBe(tugOpening());
    }
  });

  it("says the mouse works, once, on the turn nobody has pressed anything yet", () => {
    // Clicking a numbered line and clicking a box on the schematic have both
    // worked for several tasks, and not one line of the game said so in any of
    // the three languages — while the owner plays with a mouse
    // (docs/tasks/G87-playability.md, 3).
    const game = newGame(11);
    const said = (): number => game.log.lines.filter((l) => l.text === t("hint.mouse")).length;
    expect(said()).toBe(1);
    expect(saidHint(game.player, "mouse")).toBe(true);

    // And the opening above it is still the instruction it was: the mouse line
    // is under the three, not among them.
    expect(game.log.lines[0]!.text).toBe(tugOpening());
    expect(game.log.lines.findIndex((l) => l.text === t("hint.mouse"))).toBeGreaterThan(2);

    // Once a run, like every other line that goes through `hint`.
    voyageOf(game).credits = 500;
    game.playerCommand({ kind: "act", verb: "jump" });
    expect(said()).toBe(1);
  });
});

function nameBeyond(game: RoomGame, door: number): string {
  const here = game.roomOf(game.player).id;
  return game.ship.roomAt(game.ship.other(game.ship.doorAt(door), here)).name;
}

// ------------------------------------------------------- the first derelict

describe("the first freighter, on 200 seeds", () => {
  it("puts the goal and one small job on the board, and 25 CR in the account", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const voyage = voyageOf(newGame(seed));
      expect(voyage.offered.map((c) => c.id), `seed ${seed}`).toEqual(["neutralize", "salvage"]);
      expect(voyage.offered[1]!.payout, `seed ${seed}`).toBe(SALVAGE_TARGET);
      expect(voyage.credits, `seed ${seed}`).toBe(STARTING_CREDITS);
      expect(voyage.hull, `seed ${seed}`).toBeDefined();
    }
  });

  /**
   * The board is only half the fix: a line nobody presses teaches nothing. So
   * the measurement the lead asked for — a player who works down the list signs
   * the goal on the hull that is teaching them the game
   * (docs/review-2026-09-07.md, A1).
   *
   * The careful bot is that player: it reads the list, presses what is enabled
   * and knows no word of the game (`packages/engine/src/testing/roombots.ts`).
   * Sixty steps is the first walk to the HELM and back, which is all this asks.
   */
  it("is what the first key on the board signs, on every one of the 200", () => {
    // The board is only half of it: a line nobody presses teaches nothing. So
    // this reads the list the way the first minute of a run does — the tug is
    // one screen since G53, so the board is one row of it and its own list one
    // level down — and asks what that keystroke signed
    // (docs/review-2026-09-07.md, A1).
    //
    // A player reading the list rather than a bot walking the ship: the bots
    // press what is enabled in the order the answering list has it, so what
    // they measure is their own route and not what the board offers. Their
    // figure for the same change is 157 voyages of 200 signing the goal at some
    // point.
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = newGame(seed);
      const first = roomActions(game, "charter").find((a) => a.enabled && a.cmd.kind === "act");
      expect(first?.label, `seed ${seed}`).toContain(t("charter.name.neutralize"));
      expect(game.playerCommand(first!.cmd).ok, `seed ${seed}`).toBe(true);
      expect(voyageOf(game).charters.map((c) => c.id), `seed ${seed}`).toEqual(["neutralize"]);
    }
  });

  it("lands the drone on scrap, one bulkhead and the key in front of it", () => {
    let scrap = 0;
    let scout = 0;
    let oneLock = 0;
    let keyBefore = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = aboard(seed);
      const ship = game.ship;
      const entry = ship.roomAt(ship.entry);

      // The two glyphs of design-doc.md's second step: `c` to fight and `%` to
      // strip, in the compartment the airlock opens onto.
      if (roomList<Wreck>(entry, "wrecks").some((w) => w.glyph === "%")) scrap++;
      const here = hostilesIn(game, entry.id);
      if (here.length === 1 && here[0]!.ch === "c") scout++;

      // One bulkhead, and the ferry's two: since G73 the first hull of a run is
      // one of five classes, and the ferry's whole lesson is a second gate
      // (`content/derelicts.ts`, `STARTER_HULLS`). What is the same on all
      // five is that every lock has a keycard aboard and the hull opens all the
      // way up to a drone that picks them up as it goes.
      const owed = currentDerelict(game).spec.id === "ferry" ? 2 : 1;
      const locked = ship.doors.filter((d) => d.state === "locked");
      if (locked.length === owed) oneLock++;

      const key = keyRoom(ship);
      if (key !== undefined && reachableWithKeys(ship).rooms.size === ship.size) keyBefore++;
    }

    report("first hull of a voyage", {
      "% scrap where it lands": scrap,
      "one c and nothing else": scout,
      "the bulkheads the class owes": oneLock,
      "key before it": keyBefore,
    });
    expect(scrap).toBe(SEEDS);
    expect(scout).toBe(SEEDS);
    expect(oneLock).toBe(SEEDS);
    expect(keyBefore).toBe(SEEDS);
  });

  it("shows the drone a machine inside its first ten turns", () => {
    // The docking bay card stands one scout in the compartment the drone lands
    // in, so the first fight is the first decision (design-doc.md, "Обучение
    // конструкцией", 2). Walked with the same auto-explore the player has, and
    // it stops the moment something is in sight.
    let met = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const game = aboard(seed);
      const explorer = makeExplorer();
      let seen = false;
      for (let turn = 0; turn < 10 && !seen && game.status === "playing"; turn++) {
        seen = [...game.visible].some((room) => hostilesIn(game, room).length > 0);
        if (seen) break;
        const step = explorer.step(game);
        if ("stop" in step) break;
        game.playerCommand(step.cmd);
      }
      if (seen) met++;
    }
    report("first ten turns", { "a machine in sight": met });
    expect(met / SEEDS).toBeGreaterThanOrEqual(0.95);
  });

  it("carries the charter's twenty credits, and forty within reach", () => {
    // Two readings of the same hull, because the difference between them is
    // the one bulkhead: what a sortie can bank without ever opening it, and
    // what it can bank with the keycard that is always lying in front of it.
    let unlocked = 0;
    let withKey = 0;
    let forty = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const ship = aboard(seed).ship;
      const open = lootIn(ship, reachableUnlocked(ship));
      const all = lootIn(ship, reachableWithKeys(ship).rooms);

      if (open >= SALVAGE_TARGET) unlocked++;
      if (all >= SALVAGE_TARGET) withKey++;
      if (all >= HULL_PRICE) forty++; // 40 CR is a drone off the rack
    }

    report("SALVAGE 20 CR", { "without the lock": unlocked, "with the keycard": withKey });
    report("40 CR aboard", { reachable: forty });
    expect(withKey).toBe(SEEDS);
    expect(forty / SEEDS).toBeGreaterThanOrEqual(0.9);
    expect(unlocked / SEEDS).toBeGreaterThanOrEqual(0.9);
  });
});

// ----------------------------------------------------------------- the hints

/** How many times a line was said, counting the log's own `(x2)` folding. */
function said(game: RoomGame, text: string): number {
  return game.log.lines.filter((l) => l.text === text).reduce((n, l) => n + l.count, 0);
}

/** Where in the log a line stands, so "right after this one" is testable. */
function indexOf(game: RoomGame, text: string): number {
  return game.log.lines.findIndex((l) => l.text === text);
}

/** The turn a line was said on, or nothing when it never was. */
function saidOn(game: RoomGame, text: string): number | undefined {
  return game.log.lines.find((l) => l.text === text)?.turn;
}

describe("the five hints", () => {
  it("says each of them once a run, and nothing else claims to be one", () => {
    expect([...ONBOARDING_HINTS]).toEqual(["exposure", "burned", "keycard", "sold", "death"]);
    // The ghost's own file names the line it is about; this is the one place it
    // is said, and the two must not drift apart.
    expect(HINT_LINE_KEYS.death).toBe(GHOST_HINT_KEY);
  });

  it("says the exposure rule the turn the first blow lands on a module", () => {
    const game = aboard(5);
    const rig = rigOf(game.player)!;
    expect(said(game, t(HINT_LINE_KEYS.exposure))).toBe(0);

    rig.exposed = rig.slots.findIndex((s) => s?.kind === "plating");
    RIG.onDamage!(game, game.player, 1, undefined);

    expect(said(game, t(HINT_LINE_KEYS.exposure))).toBe(1);
    expect(saidOn(game, t(HINT_LINE_KEYS.exposure))).toBe(game.schedule.time);
    expect(saidHint(game.player, "exposure")).toBe(true);

    // Every blow after it lands the same way and says nothing.
    RIG.onDamage!(game, game.player, 1, undefined);
    RIG.onDamage!(game, game.player, 1, undefined);
    expect(said(game, t(HINT_LINE_KEYS.exposure))).toBe(1);
  });

  it("says what a burned module costs the turn the first one goes", () => {
    const game = aboard(5);
    const rig = rigOf(game.player)!;
    expect(said(game, t(HINT_LINE_KEYS.burned))).toBe(0);

    rig.exposed = rig.slots.findIndex((s) => s?.kind === "scanner");
    RIG.onDamage!(game, game.player, moduleKind("scanner").integrity, undefined);
    expect(said(game, t(HINT_LINE_KEYS.burned))).toBe(1);

    rig.exposed = rig.slots.findIndex((s) => s?.kind === "cutter");
    RIG.onDamage!(game, game.player, moduleKind("cutter").integrity, undefined);
    expect(said(game, t(HINT_LINE_KEYS.burned))).toBe(1);
  });

  it("says what a keycard is the turn the drone first holds one", () => {
    const game = onBodies();
    const bodies = roomList<Body>(game.roomOf(game.player), "bodies");
    const body = bodies.find((b) => b.key !== undefined)!;
    expect(body, "the fixture's key never landed on a body").toBeDefined();

    expect(game.playerCommand({ kind: "act", verb: "search", target: body.id }).ok).toBe(true);
    expect(said(game, t(HINT_LINE_KEYS.keycard))).toBe(1);
    // In its own turn means: on the same line of the log as the thing that
    // earned it, and right after it — not the turn the world has moved on to
    // by the time the command is over.
    const found = `You go through the body: ${BODY_CREDITS} CR and a keycard.`;
    expect(saidOn(game, t(HINT_LINE_KEYS.keycard))).toBe(saidOn(game, found));
    expect(indexOf(game, t(HINT_LINE_KEYS.keycard))).toBe(indexOf(game, found) + 1);

    // A second keycard is a second keycard and not a second lesson.
    const another = bodies.find((b) => b !== body)!;
    another.key = body.key;
    expect(game.playerCommand({ kind: "act", verb: "search", target: another.id }).ok).toBe(true);
    expect(said(game, t(HINT_LINE_KEYS.keycard))).toBe(1);
  });

  it("prices the next drone against the first hold, the turn the first one sells", () => {
    const game = aboard(9);

    // A sortie that came back with nothing says nothing: the number in the line
    // is the lesson, and `Hold sold for 0 CR` teaches the wrong one.
    game.player.room = game.ship.entry;
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(said(game, soldLine(0, HULL_PRICE))).toBe(0);
    expect(undock(game).ok).toBe(true);

    (game.player.data ??= {}).loot = 24;
    game.player.room = game.ship.entry;

    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(game.shipId).toBe(TUG_ID);
    expect(said(game, soldLine(24, HULL_PRICE))).toBe(1);
    // Straight after the line that banked it, so the two read as one sentence:
    // `The hold is emptied: +24 CR. 49 CR.` / `Hold sold for 24 CR. Hulls cost 40.`
    const banked = `The hold is emptied: +24 CR. ${STARTING_CREDITS + 24} CR.`;
    expect(indexOf(game, soldLine(24, HULL_PRICE))).toBe(indexOf(game, banked) + 1);
    expect(soldLine(24, HULL_PRICE)).toBe(`Hold sold for 24 CR. Hulls cost ${HULL_PRICE}.`);

    // Home again with a different hold: the arithmetic is the player's now.
    expect(undock(game).ok).toBe(true);
    (game.player.data ??= {}).loot = 8;
    game.player.room = game.ship.entry;
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(said(game, soldLine(8, HULL_PRICE))).toBe(0);
    expect(said(game, soldLine(24, HULL_PRICE))).toBe(1);
  });

  it("warns what is left aboard the turn the first drone does not come back", () => {
    const game = aboard(13);
    expect(said(game, t(HINT_LINE_KEYS.death))).toBe(0);
    // Enough on the account for another drone: a voyage that cannot buy one is
    // over on the spot, and what is under test is the line, not the ending.
    voyageOf(game).credits = 200;

    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);

    expect(said(game, t(HINT_LINE_KEYS.death))).toBe(1);
    expect(saidOn(game, t(HINT_LINE_KEYS.death))).toBe(game.schedule.time);
    expect(voyageOf(game).hull).toBeUndefined();

    // A second drone, a second death, and no second lesson.
    expect(game.playerCommand({ kind: "act", verb: "buy", target: 2000 }).ok).toBe(true);
    expect(undock(game).ok).toBe(true);
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);
    expect(said(game, t(HINT_LINE_KEYS.death))).toBe(1);
  });

  it("keeps every hint said exactly once over a whole voyage of sorties", () => {
    // The flags live on the player, so what proves it is a run that crosses the
    // airlock several times: the drone that dies is not the thing that
    // remembers (`content/hints.ts`).
    const game = aboard(21);
    const rig = rigOf(game.player)!;
    rig.exposed = rig.slots.findIndex((s) => s?.kind === "plating");
    RIG.onDamage!(game, game.player, 1, undefined);
    game.player.room = game.ship.entry;
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);

    for (const id of [...ONBOARDING_HINTS, "objective", "payout"] as const) {
      if (id === "sold") continue; // carries a number; counted above
      expect(said(game, t(HINT_LINE_KEYS[id])), id).toBeLessThanOrEqual(1);
    }
    expect(said(game, t(HINT_LINE_KEYS.exposure))).toBe(1);
    expect(said(game, t(HINT_LINE_KEYS.death))).toBe(1);
  });
});

/** Two bodies in the compartment the drone stands in, one of them with a key. */
const BODIES = `
  TUG -a1- r1
  r1 -[d1:k1]- r2
  r1: docking † †:key key:k1
  r2: cargo
`;

function onBodies(): RoomGame {
  const config: Omit<RoomGameConfig, "seed"> = {
    ...GAME_CONFIG,
    systems: [POPULATE, DOORS, VOYAGE],
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(BODIES).ship,
    firstShipId: "1",
  };
  const game = new RoomGame({ ...config, seed: 4 });
  game.player.room = game.ship.room("r1").id;
  game.refreshSight();
  return game;
}

// ------------------------------------------------------- the training hull

/**
 * The tutorial, flown (docs/tasks/G69-tutorial.md, G86).
 *
 * `tests/tutorial.test.ts` holds the ship and the chain apart from each other —
 * the hull over a hundred draws, the seven lines as a table of predicates. This
 * is the two of them together: three bots on the seeds a training run starts
 * from, and the log they leave behind.
 *
 * The log is read through a wrapper rather than off `game.log.lines`, and that
 * is not fussiness: a `MessageLog` keeps the last two hundred lines, a tutorial
 * sortie is longer than that, and the first hints of the run had scrolled out of
 * the array by the time the run ended. Counting them where they are written is
 * the only way to say "exactly once" about a whole run — and it is also the only
 * moment at which the *situation* behind a line can be read, which is what the
 * corpse check below needs.
 *
 * Driven by hand rather than through `runBotOn`, for the same reason
 * `winnable.test.ts` drives the first sortie by hand: this measures things that
 * happen mid-run — what the drone was standing in front of, what the turn
 * already said — and the harness hands back one row per run.
 */

const MAX_STEPS = 1500;

/** A blow, whoever landed it: the engine's own line and the rack's wording of it. */
const isBlow = (key: string): boolean => key.startsWith("engine.hit.") || key.startsWith("log.hit.");

interface ChainLine {
  readonly id: string;
  readonly turn: number;
  /** Something alive was in sight when the line was written. */
  readonly inSight: boolean;
  /** Blows had been traded on that turn when the line was written. */
  readonly fighting: boolean;
}

interface TrainingRun {
  readonly game: SalvorGame;
  /** The chain's own lines, in the order they were said. */
  readonly said: ChainLine[];
  /** Every hint of the run, the chain's and the ordinary ones alike. */
  readonly hints: Array<{ key: string; turn: number; afterAlarm: boolean }>;
  /** The turn the first blow of the run landed, either way round. */
  firstBlow: number | undefined;
  /** The drone stood in a compartment with a locked bulkhead aboard the hull. */
  stoodAtLock: boolean;
}

function flyTraining(seed: number, bot: keyof typeof BOTS_ROOMS = "careful"): TrainingRun {
  const play = BOTS_ROOMS[bot]!();
  const game = newGame(seed, true);
  // The harness's own stream for the bot, so a hand-driven run and a
  // `runBotOn` one make the same decisions (`testing/metrics.ts`).
  const rng = new Rng(seed ^ 0x5bf03635);
  const run: TrainingRun = {
    game,
    said: [],
    hints: [],
    firstBlow: undefined,
    stoodAtLock: false,
  };

  const add = game.log.add.bind(game.log);
  (game.log as unknown as { add: typeof add }).add = (text, turn, tone, key, params) => {
    if (typeof key === "string") {
      if (run.firstBlow === undefined && isBlow(key)) run.firstBlow = turn;
      if (key.startsWith("hint.")) {
        run.hints.push({
          key,
          turn,
          afterAlarm: game.log.lines.some((l) => l.turn === turn && l.tone === "alarm"),
        });
      }
      if (key.startsWith(TUTORIAL_PREFIX)) {
        run.said.push({
          id: key.slice("hint.".length),
          turn,
          inSight: game.entities.some(
            (e) => e.id !== game.player.id && isAlive(e) && e.room !== undefined && game.visible.has(e.room),
          ),
          fighting: game.log.lines.some((l) => l.turn === turn && isBlow(l.key ?? "")),
        });
      }
    }
    add(text, turn, tone, key, params);
  };

  for (let step = 0; step < MAX_STEPS && !game.isOver(); step++) {
    const out = game.playerCommand(play(game, rng));
    // The harness charges an idle turn for a refusal; without it a bot that
    // keeps pressing a refused verb never moves and never measures anything.
    if (!out.ok) game.playerCommand({ kind: "wait" });
    if (!isTug(game) && classOfShip(game.ship) === TUTORIAL_ID) {
      const here = game.roomOf(game.player).id;
      if (game.ship.doorsOf(here).some((d) => d.state === "locked")) run.stoodAtLock = true;
    }
  }
  return run;
}

const TUTORIAL_PREFIX = "hint.tutorial.";

/** The three roles, on two dozen seeds each: the ceiling, the floor and the fuzzer. */
const CHAIN_BOTS = ["careful", "greedy", "random"] as const;
const CHAIN_SEEDS = seedRange(1, 24);

describe("the training hull", () => {
  const run = flyTraining(TUTORIAL_SEED);
  const { game, said } = run;
  const state = voyageOf(game).state[0]!;

  it("is the first hull of the itinerary, and the tug takes it", () => {
    expect(state.spec.id).toBe(TUTORIAL_SPEC.id);
    expect(state.online.length).toBe(OBJECTIVES.length);
    expect(state.sold).toBe(true);
    // One drone, one sortie's worth of lessons: the tutorial seed is picked so
    // that a careful bot finishes the hull without losing a drone on it.
    expect(state.deaths).toEqual([]);
  });

  it("says all seven of its lines, each exactly once", () => {
    const ids = said.map((l) => l.id);
    expect(new Set(ids).size).toBe(TUTORIAL_STEPS.length);
    for (const step of TUTORIAL_STEPS) {
      expect(ids.filter((id) => id === step.id).length, step.id).toBe(1);
    }
  });

  it("says them in the order the hull hands them over", () => {
    // The order is a property of the seed and not of the chain: a hull whose
    // bulkhead lies deeper than its engine room says the same seven lines in
    // the order it meets them (`content/tutorial.ts`, `stepDue`).
    //
    // So what is held is the chain's own rule. The first line is the one that
    // says which keys do anything at all, the last is the one that says the
    // lesson is over, and every line in between lands on a turn when its
    // subject is in front of the drone. Two lines may share a turn — the
    // boarding turn hands over three subjects at once — and never more (G86).
    expect(said[0]!.id).toBe("tutorial.enter");
    expect(said[said.length - 1]!.id).toBe("tutorial.sale");
    expect(new Set(said.map((l) => l.id))).toEqual(new Set(TUTORIAL_STEPS.map((s) => s.id)));
    for (let i = 1; i < said.length; i++) {
      expect(said[i]!.turn, said[i]!.id).toBeGreaterThanOrEqual(said[i - 1]!.turn);
    }
  });

  /**
   * The machine lesson, on the fight it is about.
   *
   * It used to arrive after it: the chain was a queue with the scanner second,
   * the docking bay hands the drone a scout on the turn it boards and the scout
   * is dead by the next player turn, so the line explaining what a fight costs
   * came twenty and thirty turns later — in 0 of 120 careful runs and 0 of 120
   * greedy ones did it land at the fight (docs/tasks/G86-tutorial-and-title.md,
   * 3). What fixed it is the priority order plus one clause: a fight on the
   * screen counts as the subject being in front of the player, so the lesson
   * lands on the turn of the blow rather than on the turn the machine happens
   * to still be alive.
   */
  it("says the machine lesson on the turn of the first blow, or the one after", () => {
    for (const bot of CHAIN_BOTS) {
      const runs = CHAIN_SEEDS.map((seed) => flyTraining(seed, bot));
      const fought = runs.filter((r) => r.firstBlow !== undefined);
      const onTime = fought.filter((r) => {
        const line = r.said.find((l) => l.id === "tutorial.contact");
        return line !== undefined && line.turn <= r.firstBlow! + 1;
      });
      const share = fought.length === 0 ? 1 : onTime.length / fought.length;
      console.log(`${bot}: machine lesson at the first fight ${onTime.length}/${fought.length}`);
      // Taken: 100 % careful, 100 % greedy, 88 % of the fuzzer's runs over 120
      // seeds. The fuzzer is the floor — it presses `leave` at random, so some
      // of its runs are off the hull before the chain has said anything at all.
      expect(share, `${bot}: the machine lesson is late`).toBeGreaterThanOrEqual(bot === "random" ? 0.75 : 0.95);
    }
  });

  /**
   * And never over a body.
   *
   * The engine keeps the dead in the entity list — that is what makes a corpse
   * something to salvage — and the predicate did not ask whether what it could
   * see was alive, so 34 of 120 runs said "a machine, and here is what a fight
   * costs" at a compartment holding nothing but the scout the drone had already
   * beaten (G86, 2).
   */
  it("never says the machine lesson at a corpse", () => {
    for (const bot of CHAIN_BOTS) {
      for (const r of CHAIN_SEEDS.map((seed) => flyTraining(seed, bot))) {
        for (const line of r.said) {
          if (line.id !== "tutorial.contact") continue;
          expect(
            line.inSight || line.fighting,
            `${bot}: the machine lesson was said with nothing alive in sight and no blow struck`,
          ).toBe(true);
        }
      }
    }
  });

  /**
   * The bulkhead lesson, on the ship whose one locked door is the reason it has
   * a keycard at all.
   *
   * Measured before: careful 100 %, greedy 30 %, random 88 % of the runs that
   * stood in front of it (G86, 4). What was in the way was the queue — the
   * scanner line and the boarding line both outranked it, and a drone stands in
   * front of that door for a turn or two before it opens it.
   */
  it("says the bulkhead lesson to nearly every drone that stands at one", () => {
    for (const bot of CHAIN_BOTS) {
      const runs = CHAIN_SEEDS.map((seed) => flyTraining(seed, bot));
      const stood = runs.filter((r) => r.stoodAtLock);
      const told = stood.filter((r) => r.said.some((l) => l.id === "tutorial.door"));
      const share = stood.length === 0 ? 1 : told.length / stood.length;
      console.log(`${bot}: bulkhead lesson ${told.length}/${stood.length}`);
      expect(share, `${bot}: the bulkhead lesson is missed`).toBeGreaterThanOrEqual(0.9);
    }
  });

  /**
   * The line that says the lesson is over, on the way home rather than on a
   * sale.
   *
   * It used to wait for the hull to go under tow, which is the one moment of the
   * chain a player has to earn: 70 % of careful runs earned it, 4 % of greedy
   * ones and no random one at all (G86, 8). Coming back through the airlock is
   * the same event one step earlier and it happens either way.
   */
  it("says the last line to nearly every drone that comes home", () => {
    for (const bot of CHAIN_BOTS) {
      const runs = CHAIN_SEEDS.map((seed) => flyTraining(seed, bot));
      const told = runs.filter((r) => r.said.some((l) => l.id === "tutorial.sale"));
      console.log(`${bot}: lesson-over line ${told.length}/${runs.length}`);
      // The fuzzer is the floor again: a drone that dies out there with no
      // money for another never comes home, and there is no line for that.
      expect(
        told.length / runs.length,
        `${bot}: the lesson-over line is missed`,
      ).toBeGreaterThanOrEqual(bot === "random" ? 0.5 : 0.95);
    }
  });

  /**
   * What a turn may teach, which is two rows of seven and never three.
   *
   * 279 of 1308 turns used to carry two hints or more, and 415 hints shared
   * their turn with a blow, a death or the alarm (G86, 6). The budget is
   * `content/hints.ts`, `turnRoom`; what is held here is the promise it makes,
   * on the runs that say the most: whenever the chain speaks, its turn carries
   * at most two hints in total, and never one the alarm has already claimed.
   */
  it("teaches at most two lines in a turn, and nothing over the alarm", () => {
    for (const bot of CHAIN_BOTS) {
      const runs = CHAIN_SEEDS.map((seed) => flyTraining(seed, bot));
      let crowded = 0;
      let turns = 0;
      for (const r of runs) {
        const byTurn = new Map<number, number>();
        for (const h of r.hints) byTurn.set(h.turn, (byTurn.get(h.turn) ?? 0) + 1);
        for (const n of byTurn.values()) {
          turns++;
          if (n >= 2) crowded++;
        }
        for (const line of r.said) {
          expect(byTurn.get(line.turn) ?? 0, `${bot}: three hints on turn ${line.turn}`).toBeLessThanOrEqual(2);
        }
        for (const h of r.hints) {
          if (!h.key.startsWith(TUTORIAL_PREFIX)) continue;
          expect(h.afterAlarm, `${bot}: ${h.key} was said over the alarm`).toBe(false);
        }
      }
      console.log(`${bot}: turns carrying two hints ${crowded}/${turns}`);
    }
  });

  /**
   * And the chain owns the two topics it shares with the ordinary lines.
   *
   * `hint.objective` is `tutorial.system` in other words, `hint.payout` is
   * `tutorial.airlock` in other words, and 94 and 88 of 120 training runs heard
   * both of each (G86, 5). In a training run the chain says them, in the
   * compartment they are about, and the ordinary twin stays silent for the rest
   * of the voyage (`content/hints.ts`, `CHAIN_SAYS`).
   */
  it("never says the two ordinary lines the chain already carries", () => {
    for (const bot of CHAIN_BOTS) {
      for (const r of CHAIN_SEEDS.map((seed) => flyTraining(seed, bot))) {
        const twins = r.hints.filter((h) => h.key === "hint.objective" || h.key === "hint.payout");
        expect(twins.map((h) => h.key), `${bot}: said twice`).toEqual([]);
      }
    }
  });

  it("costs the player no hull, and leaves the account no worse", () => {
    // The training hull used to displace the first wreck of the itinerary, and
    // that wreck sells for 150–220 against the training hull's 60: over 40
    // careful runs the lesson cost 4 CR of the 20 the voyage ends with, and a
    // hull of the four it flies (G86, 7). Added in front of them instead.
    const money = (training: boolean): number =>
      seedRange(1, 24).reduce((sum, seed) => {
        const play = BOTS_ROOMS.careful!();
        const game = newGame(seed, training);
        const rng = new Rng(seed ^ 0x5bf03635);
        for (let step = 0; step < MAX_STEPS && !game.isOver(); step++) {
          if (!game.playerCommand(play(game, rng)).ok) game.playerCommand({ kind: "wait" });
        }
        return sum + voyageOf(game).credits;
      }, 0) / 24;

    const taught = money(true);
    const plain = money(false);
    console.log(`careful/24: ${taught.toFixed(1)} CR after the lesson, ${plain.toFixed(1)} CR without it`);
    expect(taught, "the lesson costs the player money").toBeGreaterThanOrEqual(plain * 0.9);
  });

  it("says six of the seven whatever the seed, on 24 of them", () => {
    // Six are moments the hull guarantees: aboard, a machine, a bulkhead, a
    // system, the airlock with something to lose, and the scanner. The seventh
    // is the way home, which is the one line a player has to get back for.
    let home = 0;
    for (const seed of CHAIN_SEEDS) {
      const ids = new Set(flyTraining(seed).said.map((l) => l.id));
      for (const step of TUTORIAL_STEPS) {
        if (step.id === "tutorial.sale") continue;
        expect(ids.has(step.id), `seed ${seed}: ${step.id}`).toBe(true);
      }
      if (ids.has("tutorial.sale")) home++;
    }
    console.log(`training hull flown to the end and back: ${pct(home, 24)}`);
    expect(home).toBeGreaterThanOrEqual(20);
  });

  it("leaves an ordinary run opening on a hull of the voyage's own", () => {
    // The one thing a training run may never do (jam rule 1): change the run
    // that is not one. Same first hull, same charter board, same credits — and
    // since G73 that first hull is whichever of the five the seed drew, never
    // the training one (`content/derelicts.ts`, `STARTER_HULLS`).
    const plain = newGame(TUTORIAL_SEED);
    expect(STARTER_HULLS.map((h) => h.id)).toContain(voyageOf(plain).derelicts[0]!.id);
    expect(voyageOf(plain).credits).toBe(STARTING_CREDITS);
  });
});
