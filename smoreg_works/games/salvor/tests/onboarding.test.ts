import { describe, expect, it } from "vitest";
import {
  RoomGame,
  reachableWithKeys,
  type RoomCommand,
  type RoomGameConfig,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import { BOTS_ROOMS, roomPlay, runBotOn, seedRange, shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { TUTORIAL_SEED, TUTORIAL_SPEC, TUTORIAL_STEPS } from "../src/content/tutorial.js";
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
import { STARTER_HULLS, flavourCallsign } from "../src/content/derelicts.js";
import { OBJECTIVES } from "../src/content/objectives.js";
import { TUG_ID, TUG_ROOMS } from "../src/content/tug.js";
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
 * The tutorial, flown (docs/tasks/G69-tutorial.md).
 *
 * `tests/tutorial.test.ts` holds the ship and the chain apart from each other —
 * the hull over a hundred draws, the seven lines as a table of predicates. This
 * is the two of them together: a careful bot on the seed a training run starts
 * from, and the log it leaves behind.
 *
 * The log is read through a wrapper rather than off `game.log.lines`, and that
 * is not fussiness: a `MessageLog` keeps the last two hundred lines, a tutorial
 * sortie is longer than that, and the first hints of the run had scrolled out of
 * the array by the time the run ended. Counting them where they are written is
 * the only way to say "exactly once" about a whole run.
 */
function flyTraining(seed: number): {
  game: SalvorGame;
  said: Array<{ id: string; turn: number }>;
} {
  let game: SalvorGame | undefined;
  let said: Array<{ id: string; turn: number }> = [];
  runBotOn(
    BOTS_ROOMS.careful!,
    seed,
    roomPlay({
      maxSteps: 1500,
      make: (s) => {
        const fresh = newGame(s, true);
        const lines: Array<{ id: string; turn: number }> = [];
        const add = fresh.log.add.bind(fresh.log);
        (fresh.log as unknown as { add: typeof add }).add = (text, turn, tone, key, params) => {
          if (typeof key === "string" && key.startsWith(TUTORIAL_PREFIX)) {
            lines.push({ id: key.slice("hint.".length), turn });
          }
          add(text, turn, tone, key, params);
        };
        game = fresh;
        said = lines;
        return fresh;
      },
    }),
  );
  return { game: game!, said };
}

const TUTORIAL_PREFIX = "hint.tutorial.";

describe("the training hull", () => {
  const { game, said } = flyTraining(TUTORIAL_SEED);
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

  it("says them in the order the hull hands them over, one to a turn", () => {
    // The order is a property of the seed and not of the chain: a hull whose
    // bulkhead lies deeper than its engine room says the same seven lines in
    // the order it meets them (`content/tutorial.ts`, `stepDue`). It used to be
    // the table's own order on this seed, which was a fact about the training
    // ship this seed drew rather than about the chain — and G73 drew a
    // different one, because the itinerary the training run replaces its first
    // hull in is now a draw of five and costs the rng one number more.
    //
    // So what is held is the chain's own rule, which was always the point: the
    // first two lines are due on sight and go first, and every other line lands
    // on a turn when its subject is standing in front of the drone.
    expect(said.slice(0, 2).map((l) => l.id)).toEqual(["tutorial.enter", "tutorial.scan"]);
    expect(said[said.length - 1]!.id).toBe("tutorial.sale");
    expect(new Set(said.map((l) => l.id))).toEqual(new Set(TUTORIAL_STEPS.map((s) => s.id)));
    expect(new Set(said.map((l) => l.turn)).size).toBe(said.length);
    for (let i = 1; i < said.length; i++) {
      expect(said[i]!.turn, said[i]!.id).toBeGreaterThan(said[i - 1]!.turn);
    }
  });

  it("says six of the seven whatever the seed, on 24 of them", () => {
    // Six are moments the hull guarantees: aboard, a look around, a machine, a
    // bulkhead, a system, the airlock with something to lose. The seventh is
    // the sale, which is the one line a player has to earn — printed rather
    // than asserted at a hundred percent, because it measures the tutorial.
    let sold = 0;
    for (const seed of seedRange(1, 24)) {
      const run = flyTraining(seed);
      const ids = new Set(run.said.map((l) => l.id));
      for (const step of TUTORIAL_STEPS) {
        if (step.id === "tutorial.sale") continue;
        expect(ids.has(step.id), `seed ${seed}: ${step.id}`).toBe(true);
      }
      if (ids.has("tutorial.sale")) sold++;
    }
    console.log(`training hull neutralised and sold: ${pct(sold, 24)}`);
    expect(sold).toBeGreaterThanOrEqual(10);
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
