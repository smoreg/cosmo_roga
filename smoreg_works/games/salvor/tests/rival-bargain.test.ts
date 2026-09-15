import { t } from "../src/i18n.js";
import { describe, it, expect } from "vitest";
import {
  RoomGame,
  isAlive,
  spawnMonsterIn,
  type Entity,
  type RoomCommand,
  type RoomGameConfig,
  type System,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR } from "../src/game.js";
import { FREIGHTER } from "../src/content/derelicts.js";
import { MONSTERS } from "../src/content/monsters.js";
import { OBJECTIVE_COUNT } from "../src/content/objectives.js";
import { ACTION_WIDTH, roomActions } from "../src/ui/actions.js";
import { PANEL_WIDTH } from "../src/ui/panel.js";
import { alertState } from "../src/systems/alert.js";
import { DOORS } from "../src/systems/doors.js";
import { POPULATE, roomList, type ShipSystem } from "../src/systems/populate.js";
import { RIVAL, startRival } from "../src/systems/rival.js";
import { rivalState, type RivalState } from "../src/systems/rivalstate.js";
import { SHIP } from "../src/systems/ship.js";
import { shipState } from "../src/systems/shipstate.js";
import { VOYAGE, derelictAboard, voyageOf } from "../src/systems/voyage.js";
import { rigOf, wrecksIn } from "../src/twist/rig.js";

/**
 * The bargain with the other tug (G34): three lines of the compartment's own
 * action list, one deal per hull, and what each of the three actually does.
 *
 * Hand-drawn hulls with the real systems on them, the way `tests/voyage.test.ts`
 * works: every question here is about money, about what came online and about
 * what a deal survives, and none of them should depend on a lucky seed. The
 * rival lands in the deep end of the line by construction — `MIN_SPAWN_DOORS`
 * is three, so `r4` is the only compartment far enough in — which is what makes
 * "stand next to it and press `1`" a thing a test can write down.
 */

/** Four compartments in a line, one of the ship's three systems in each of three. */
const HULL = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4
  r1: docking
  r2: engineering E
  r3: reactor O
  r4: control T
`;

/** The tug, for the trip out and back. */
const TUG = `
  TUG -a2- t1
  t1: deck
`;

const NAME = "rival drone";

/** What a bargain costs and pays (`systems/rival.ts`, `DEAL_PRICE`). */
const PRICE = 100;

/** Enough on the account that a hundred credits is a decision, not a wall. */
const FUNDED = 250;

/** A voyage of one freighter: the sale price is a known number, and it ends the run. */
const ONE_HULL: System<RoomGame> = {
  name: "test-itinerary",
  onRunStart(game) {
    voyageOf(game).derelicts = [FREIGHTER];
    voyageOf(game).state[0]!.spec = FREIGHTER;
  },
};

function config(): Omit<RoomGameConfig, "seed"> {
  return {
    ...GAME_CONFIG,
    // RIVAL after POPULATE (it reads the systems POPULATE puts aboard) and
    // before SHIP, exactly as `src/game.ts` orders them.
    systems: [ONE_HULL, POPULATE, DOORS, RIVAL, SHIP, VOYAGE],
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(HULL).ship,
    firstShipId: "1",
  };
}

/**
 * A hull with the other tug's drone aboard and the drone standing next to it,
 * which is the only situation the three lines exist in.
 */
function met(seed = 11, over: Partial<RivalState> = {}): { game: RoomGame; self: Entity } {
  const game = new RoomGame({ ...config(), seed });
  voyageOf(game).credits = FUNDED;
  // The terminal takes a SPIKE and the starting rack has none, so the drone
  // could not otherwise finish a hull by hand (`tests/voyage.test.ts` fits the
  // same one for the same reason).
  rigOf(game.player)!.slots[5] = { kind: "spike", integrity: 3 };
  Object.assign(startRival(game), over);
  RIVAL.onLevelEnter?.(game, 0);

  const self = rival(game);
  game.player.room = self.room;
  game.refreshSight();
  return { game, self };
}

function rival(game: RoomGame): Entity {
  const self = game.entities.find((e) => e.name === NAME && isAlive(e));
  if (!self) throw new Error("rival-bargain.test: no rival aboard");
  return self;
}

function gone(game: RoomGame): boolean {
  return !game.entities.some((e) => e.name === NAME && isAlive(e));
}

/** The three lines as the compartment offers them, in order. */
function bargains(game: RoomGame) {
  return RIVAL.offerActions?.(game) ?? [];
}

/** Press one of the three by index, whatever the rest of the list looks like. */
function strike(game: RoomGame, i: number) {
  const offer = bargains(game)[i];
  expect(offer, `no bargain line ${i}`).toBeDefined();
  return game.playerCommand(offer!.cmd as RoomCommand);
}

function credits(game: RoomGame): number {
  return voyageOf(game).credits;
}

function deal(game: RoomGame): string | undefined {
  return derelictAboard(game)?.deal;
}

function logText(game: RoomGame): string {
  return game.log.lines.map((m) => m.text).join("\n");
}

/** Walk the drone to a compartment without spending turns getting there. */
function standIn(game: RoomGame, label: string): void {
  game.player.room = game.ship.room(label).id;
  game.refreshSight();
}

/** The system standing in a compartment, by the label of the compartment. */
function systemIn(game: RoomGame, label: string): ShipSystem {
  return roomList<ShipSystem>(game.ship.room(label), "systems")[0]!;
}

/**
 * Work a system all the way up, one legal turn after another.
 *
 * Aimed at the system by id, and that matters: a splice has to be several turns
 * of the *same* command in a row, and an untargeted `work` is a different
 * command every turn (`systems/ship.ts`, `afterPlayerTurn`).
 */
function raiseIn(game: RoomGame, label: string, turns: number): void {
  standIn(game, label);
  const target = systemIn(game, label).id;
  for (let i = 0; i < turns; i++) {
    expect(game.playerCommand({ kind: "act", verb: "work", target }).ok, label).toBe(true);
  }
}

/** Points of integrity left on the drone's rack, over every slot of it. */
function integrity(game: RoomGame): number {
  return rigOf(game.player)!.slots.reduce((n, slot) => n + (slot ? slot.integrity : 0), 0);
}

/** The three of `HULL`, in the order they stand and the turns each takes. */
const WHOLE_HULL: ReadonlyArray<readonly [string, number]> = [["r2", 3], ["r3", 2], ["r4", 2]];

// ------------------------------------------------------------- the three lines

describe("the three lines of the bargain", () => {
  it("are offered only in the compartment the rival is standing in", () => {
    const { game } = met();
    expect(bargains(game)).toHaveLength(3);

    standIn(game, "r1");
    expect(bargains(game)).toEqual([]);
  });

  it("are gone the moment a deal is struck, and never come back", () => {
    const { game } = met();
    expect(strike(game, 2).ok).toBe(true);
    expect(bargains(game)).toEqual([]);

    // And pressing the line anyway is a refusal that costs nothing.
    const again = game.playerCommand({ kind: "act", verb: "bargain", target: 2300 });
    expect(again.ok).toBe(false);
    expect(again.cost).toBe(0);
  });

  it("stand in the compartment's own numbered list, alongside everything else", () => {
    const { game } = met();
    const labels = roomActions(game).map((a) => a.label);
    expect(labels).toContain("pay off RIVAL (100 CR)");
    expect(labels).toContain("leave: RIVAL pays 100 CR");
    expect(labels).toContain("give RIVAL half the sale");
  });

  it("are offered on no hull the other tug never came to", () => {
    const game = new RoomGame({ ...config(), seed: 11 });
    startRival(game, false);
    RIVAL.onLevelEnter?.(game, 0);
    expect(bargains(game)).toEqual([]);
  });
});

// ------------------------------------------------------------------- pay off

describe("pay the rival off", () => {
  it("costs a hundred credits, clears it off the hull and leaves its haul behind", () => {
    const { game, self } = met();
    const here = self.room!;
    const carried = (self.data!.loot as string[]).length;
    expect(carried).toBe(2);

    expect(strike(game, 0).ok).toBe(true);
    expect(credits(game)).toBe(FUNDED - PRICE);
    expect(deal(game)).toBe("paid");
    expect(gone(game)).toBe(true);
    expect(rivalState(game).alive).toBe(false);
    expect(wrecksIn(game, here)).toHaveLength(carried);
    expect(logText(game)).toContain("The rival takes the credits and goes.");
  });

  it("is refused without a turn when the account cannot carry it", () => {
    const { game } = met();
    // One turn first, so the clock is standing on the drone: `playerCommand`
    // catches the machines up before it reads the command, and a refusal
    // measured off a schedule that had not reached the drone yet would be
    // measuring the catch-up.
    expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    voyageOf(game).credits = PRICE - 1;

    const line = bargains(game)[0]!;
    expect(line.enabled).toBe(false);
    expect(line.why).toBe("Not enough credits.");

    const time = game.schedule.time;
    const turns = game.inputs.length;
    const out = game.playerCommand(line.cmd as RoomCommand);
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(credits(game)).toBe(PRICE - 1);
    expect(game.schedule.time).toBe(time);
    expect(game.inputs.length).toBe(turns);
    expect(deal(game)).toBeUndefined();
    expect(gone(game)).toBe(false);
  });
});

// --------------------------------------------------------------- stand aside

describe("take the rival's money", () => {
  it("pays a hundred, brings one system up for the drone and wakes the ship", () => {
    const { game } = met();
    const alert = alertState(game).level;

    expect(strike(game, 1).ok).toBe(true);
    expect(credits(game)).toBe(FUNDED + PRICE);
    expect(deal(game)).toBe("sold");
    expect(shipState(game).online).toHaveLength(1);
    expect(alertState(game).level).toBe(alert + 2);
    expect(logText(game)).toContain("online for you");
  });

  it("keeps NEUTRALIZE, however far the other tug gets afterwards", () => {
    const { game } = met();
    expect(strike(game, 1).ok).toBe(true);

    // The gauge fills all the way and the twenty-turn window never opens: a
    // hull with a deal on it is not one the other tug is racing you for.
    const st = rivalState(game);
    st.progress = OBJECTIVE_COUNT;
    RIVAL.onLevelEnter?.(game, 0);
    expect(st.evac).toBeUndefined();
    expect(logText(game)).not.toContain("Another tug has the ship");
  });

  it("is refused without a turn when there is nothing left for it to bring up", () => {
    const { game } = met();
    for (const room of game.ship.rooms) {
      for (const system of (room.data.systems as Array<{ online: boolean }> | undefined) ?? []) {
        system.online = true;
      }
    }
    const turns = game.inputs.length;

    const line = bargains(game)[1]!;
    expect(line.enabled).toBe(false);

    const out = game.playerCommand(line.cmd as RoomCommand);
    expect(out.ok).toBe(false);
    expect(out.cost).toBe(0);
    expect(game.inputs.length).toBe(turns);
    expect(credits(game)).toBe(FUNDED);
  });
});

// ----------------------------------------------------------------- the split

describe("split the sale", () => {
  it("halves what the hull fetches, and the line says why", () => {
    const { game } = met();
    expect(strike(game, 2).ok).toBe(true);
    expect(deal(game)).toBe("split");

    for (const [room, turns] of WHOLE_HULL) raiseIn(game, room, turns);
    expect(shipState(game).online).toHaveLength(OBJECTIVE_COUNT);

    const before = credits(game);
    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);

    expect(credits(game) - before).toBe(Math.floor(FREIGHTER.salePrice / 2));
    expect(logText(game)).toContain("the sale split:");
  });

  it("pays the whole price on a hull nobody struck a deal over", () => {
    const { game } = met();
    for (const [room, turns] of WHOLE_HULL) raiseIn(game, room, turns);

    const before = credits(game);
    standIn(game, "r1");
    expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    expect(credits(game) - before).toBe(FREIGHTER.salePrice);
  });

  it("makes the systems the rival brings up the drone's own", () => {
    const { game, self } = met();
    expect(strike(game, 2).ok).toBe(true);
    // Out of its compartment first: it is a racer and not a friend, and thirty
    // turns of standing next to it is thirty turns of being hit.
    standIn(game, "r1");

    // Thirty of its own turns on the compartment it landed in.
    for (let i = 0; i < 45 && shipState(game).online.length === 0; i++) {
      expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    }
    expect(shipState(game).online).toHaveLength(1);
    // And nothing of it went to the other tug's own gauge.
    expect(rivalState(game).progress).toBe(0);
    expect(isAlive(self)).toBe(true);
  });
});

// ------------------------------------------------------------ what a deal is

describe("a deal is the hull's, not the sortie's", () => {
  it("survives leaving for the tug and coming back aboard", () => {
    const { game } = met();
    expect(strike(game, 2).ok).toBe(true);

    game.travelTo("tug", { generate: () => shipFromText(TUG).ship, reason: "custom" });
    expect(deal(game)).toBeUndefined();

    game.travelTo("1", {
      generate: () => {
        throw new Error("rival-bargain.test: the derelict should still be in the store");
      },
      reason: "custom",
    });
    expect(deal(game)).toBe("split");
  });

  it("is flat data a save file could carry", () => {
    const { game } = met();
    expect(strike(game, 1).ok).toBe(true);

    const voyage = voyageOf(game);
    const text = JSON.stringify(voyage);
    expect(JSON.parse(text)).toEqual(voyage);
    expect(JSON.parse(text).state[0].deal).toBe("sold");
  });

  it("writes nothing at all into the record until one is struck", () => {
    const { game } = met();
    expect("deal" in (derelictAboard(game) as object)).toBe(false);
  });

  it("shows on the panel under the gauge, for as long as it stands", () => {
    const { game } = met();
    expect(RIVAL.panelLines?.(game)?.map((l) => l.text)).toEqual(["RIVAL ▯▯▯"]);

    expect(strike(game, 2).ok).toBe(true);
    expect(RIVAL.panelLines?.(game)?.map((l) => l.text)).toContain("DEAL  split");
  });
});

// ------------------------------------------------------------- the truce

/**
 * A deal that leaves the other tug's drone still swinging is a promise the game
 * does not keep: `split` says it works with you and `sold` says it stands
 * aside, and either way a hundred credits changed hands.
 *
 * Measured on the rack rather than on hit points, because that is where a blow
 * actually goes: the twist routes it into the module last used and the PLATING
 * catches the rest (`twist/rig.ts`), so a drone standing next to a competitor
 * loses integrity long before it loses a core. The veto is registered with the
 * rig for exactly that reason — the twist is the first hook `dealDamage` asks,
 * and anything later is asked after the rack has already paid.
 */
describe("a deal is a truce", () => {
  it("costs the drone nothing to stand in the compartment it struck one in", () => {
    const { game } = met();
    expect(strike(game, 2).ok).toBe(true);
    const rack = integrity(game);
    const hp = game.player.hp;

    for (let i = 0; i < 15; i++) expect(game.playerCommand({ kind: "wait" }).ok).toBe(true);
    expect(integrity(game)).toBe(rack);
    expect(game.player.hp).toBe(hp);
    expect(logText(game)).not.toContain("The rival drone hits");
  });

  it("costs it the rack with no deal struck — which is the control", () => {
    const { game } = met();
    const rack = integrity(game);

    for (let i = 0; i < 15; i++) {
      if (!isAlive(game.player)) break;
      game.playerCommand({ kind: "wait" });
    }
    expect(integrity(game)).toBeLessThan(rack);
  });

  it("is the rival's alone: everything else aboard hits as hard as ever", () => {
    const { game } = met();
    expect(strike(game, 2).ok).toBe(true);

    // A machine put in the drone's own compartment, with the deal standing.
    const machine = spawnMonsterIn(MONSTERS.find((m) => m.id === "security-unit")!, game.player.room!);
    game.schedule.admit(machine);
    game.entities.push(machine);
    game.refreshSight();

    const rack = integrity(game);
    for (let i = 0; i < 10; i++) {
      if (!isAlive(game.player)) break;
      game.playerCommand({ kind: "wait" });
    }
    expect(integrity(game)).toBeLessThan(rack);
    expect(logText(game)).toContain("The security unit hits your");
    // And still not one blow from the thing that was paid.
    expect(logText(game)).not.toContain("The rival drone hits");
  });
});

// -------------------------------------------------------------- and the loot

describe("a rival with a deal is not robbed", () => {
  /** Put it in reach and out of danger of dying to one blow. */
  function inReach(game: RoomGame, self: Entity): void {
    self.hp = 20;
    self.hpMax = 20;
    self.data!.lastHp = 20;
    game.refreshSight();
  }

  it("drops nothing when the drone hits it after shaking on one", () => {
    const { game, self } = met();
    const here = self.room!;
    expect(strike(game, 2).ok).toBe(true);
    inReach(game, self);

    game.playerCommand({ kind: "attack", target: self.id });
    expect(self.hp).toBeLessThan(20);
    expect(wrecksIn(game, here)).toHaveLength(0);
    expect((self.data!.loot as string[]).length).toBe(2);
  });

  it("drops nothing when it is killed outright afterwards", () => {
    const { game, self } = met();
    const here = self.room!;
    expect(strike(game, 2).ok).toBe(true);
    inReach(game, self);

    self.hp = 1;
    game.playerCommand({ kind: "attack", target: self.id });
    expect(isAlive(self)).toBe(false);
    expect(wrecksIn(game, here)).toHaveLength(0);
  });

  it("still drops on a hull nobody struck a deal over", () => {
    const { game, self } = met();
    const here = self.room!;
    inReach(game, self);

    game.playerCommand({ kind: "attack", target: self.id });
    expect(wrecksIn(game, here)).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ the width

describe("the bargain fits the action column in all three languages", () => {
  it("keeps every one of the three lines inside twenty-five columns", () => {
    {
      for (const [key, params] of [
        ["action.rival.payoff", { price: PRICE }],
        ["action.rival.aside", { price: PRICE }],
        ["action.rival.split", undefined],
      ] as const) {
        const label = t(key, params);
        expect(label.length, `${label}`).toBeLessThanOrEqual(ACTION_WIDTH);
      }
    }
  });

  it("keeps the panel's own line inside the panel", () => {
    {
      for (const word of ["word.deal.paid", "word.deal.sold", "word.deal.split"] as const) {
        const line = t("panel.deal", { deal: t(word) });
        expect(line.length, `${line}`).toBeLessThanOrEqual(PANEL_WIDTH);
      }
    }
  });
});
