import { describe, it, expect } from "vitest";
import { t } from "../src/i18n.js";
import {
  RoomDistance,
  RoomGame,
  isAlive,
  replayRooms,
  type RoomCommand,
  type RoomGameConfig,
  type RoomId,
  type System,
} from "@jamrog/engine";
import { shipFromText } from "@jamrog/engine/testing";
import { GAME_CONFIG, SALVOR, newGame, type SalvorGame } from "../src/game.js";
import { MODULES, STARTING_MODULES, type ModuleId } from "../src/content/modules.js";
import { makeStartingRig, rigOf, wrecksIn, type Rig, type Slot, wreckSource } from "../src/twist/rig.js";
import { VOYAGE, currentDerelict, voyageOf } from "../src/systems/voyage.js";
import {
  GHOST,
  GHOST_HINT_KEY,
  MAX_GHOSTS,
  bestAttack,
  deathsOf,
  ghostKind,
  ghostRigOf,
  ghostsAboard,
  type Death,
} from "../src/systems/ghost.js";

/**
 * Ghosts on a hand-drawn ship. Every question here is "which compartment" and
 * "which modules", so the graph is written out and the death records are put in
 * by hand: a test about what a dead drone leaves behind should never also be
 * about a spawn roll.
 *
 * The records go in `player.data.deaths` — the address the system reads when
 * there is no voyage yet (G26 is landing in parallel). The `shipId` on each is
 * what keeps a derelict's dead off the tug, and one test below is only about
 * that.
 */

/** Seven compartments in a line: r5 has a clean 1–2 door band around it. */
const SHIP = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4 -d4- r5 -d5- r6 -d6- r7
  r1: docking
  r2: hold
  r3: corridor
  r4: hab
  r5: engineering
  r6: workshop
  r7: reactor
`;

/** The tug: somewhere to come back from. */
const TUG = `
  TUG -a2- t1
  t1: deck
`;

const SHIP_ID = "1";
const TUG_ID = "tug";
const RACK_SIZE = STARTING_MODULES.length;

function gameOn(text: string, seed = 7): RoomGame {
  return new RoomGame({
    ...GAME_CONFIG,
    seed,
    systems: [GHOST],
    content: { ...SALVOR, monsterChance: () => 0 },
    firstShip: () => shipFromText(text).ship,
    firstShipId: "1",
  });
}

/** Out through the airlock and back aboard: the only way a ghost ever rises. */
function sortie(game: RoomGame): void {
  game.travelTo(TUG_ID, { generate: () => shipFromText(TUG).ship });
  game.travelTo(SHIP_ID, { generate: () => shipFromText(SHIP).ship });
}

function died(game: RoomGame, label: string, rig: Rig = makeStartingRig()): Death {
  const record: Death = { room: game.ship.room(label).id, rig, shipId: SHIP_ID };
  const data = (game.player.data ??= {});
  const list = (data.deaths as Death[] | undefined) ?? [];
  list.push(record);
  data.deaths = list;
  return record;
}

function doorsAway(game: RoomGame, from: RoomId, to: RoomId): number {
  return RoomDistance.from(game.ship, [from], (d) => game.ship.passable(d, {})).at(to);
}

function room(game: RoomGame, label: string): RoomId {
  return game.ship.room(label).id;
}

function kindsIn(game: RoomGame, at: RoomId): string[] {
  return wrecksIn(game, at)
    .map((w) => w.kind as string)
    .sort();
}

/** A rack holding exactly these, at full integrity. */
function rigWith(kinds: readonly ModuleId[]): Rig {
  const rig = makeStartingRig();
  const slots: Array<Slot | null> = rig.slots.map(() => null);
  kinds.forEach((kind, i) => {
    slots[i] = { kind, integrity: MODULES[kind].integrity };
  });
  rig.slots = slots;
  return rig;
}

// ------------------------------------------------------------ what it leaves

describe("a dead drone leaves its rack and something wearing one like it", () => {
  it("lays one wreck per module where it died, and stands a ghost one or two doors off", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    sortie(game);

    const r5 = room(game, "r5");
    expect(kindsIn(game, r5)).toEqual([...STARTING_MODULES].sort());
    expect(wrecksIn(game, r5).every((w) => w.glyph === "%")).toBe(true);
    expect(wrecksIn(game, r5).every((w) => wreckSource(w) === "drone")).toBe(true);

    const ghosts = ghostsAboard(game);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.ch).toBe("G");

    const away = doorsAway(game, r5, ghosts[0]!.room!);
    expect(away).toBeGreaterThanOrEqual(1);
    expect(away).toBeLessThanOrEqual(2);
  });

  it("answers a record once, however many times the run comes back aboard", () => {
    const game = gameOn(SHIP);
    const record = died(game, "r5");
    sortie(game);
    expect(record.ghostSpawned).toBe(true);

    sortie(game);
    sortie(game);
    expect(ghostsAboard(game)).toHaveLength(1);
    expect(wrecksIn(game, room(game, "r5"))).toHaveLength(RACK_SIZE);
  });

  it("does not raise a derelict's dead on the tug", () => {
    const game = gameOn(SHIP);
    died(game, "r5");

    game.travelTo(TUG_ID, { generate: () => shipFromText(TUG).ship });
    expect(deathsOf(game)).toHaveLength(0);
    expect(ghostsAboard(game)).toHaveLength(0);
    expect(wrecksIn(game, game.ship.entry)).toHaveLength(0);
  });
});

// -------------------------------------------------------------- the machine

describe("a ghost is the rack it wears", () => {
  it("has four hit points and one more per module", () => {
    expect(ghostKind(makeStartingRig()).hp).toBe(4 + RACK_SIZE);
    expect(ghostKind(rigWith(["cutter", "plating"])).hp).toBe(6);
    expect(ghostKind(rigWith([])).hp).toBe(4);
  });

  it("swings the best attack in the rack, and rams without one", () => {
    expect(bestAttack(makeStartingRig())).toEqual([...MODULES.cutter.attack!]);
    expect(bestAttack(rigWith(["cutter", "laser"]))).toEqual([...MODULES.laser.attack!]);
    expect(bestAttack(rigWith(["emitter"]))).toEqual([...MODULES.emitter.attack!]);
    expect(bestAttack(rigWith(["plating", "scanner"]))).toEqual([1, 1, 0]);
  });

  it("spawns with the numbers its kind says", () => {
    const game = gameOn(SHIP);
    const rig = rigWith(["laser", "thrusters", "plating"]);
    died(game, "r5", rig);
    sortie(game);

    const ghost = ghostsAboard(game)[0]!;
    expect(ghost.hp).toBe(7);
    expect(ghost.hpMax).toBe(7);
    expect(ghost.damage).toEqual([...MODULES.laser.attack!]);
    expect(ghost.speed).toBe(100);
    expect(ghost.sight).toBe(1);
    expect(ghost.behaviour).toBe("brute");
    expect(ghostRigOf(ghost)?.slots.filter((s) => s !== null)).toHaveLength(3);
  });

  it("drops the whole rack when it is killed, marked as the ghost's", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    sortie(game);

    const ghost = ghostsAboard(game)[0]!;
    const where = ghost.room!;
    const before = wrecksIn(game, where).length;

    ghost.hp = 1;
    game.player.room = where;
    game.refreshSight();
    expect(game.playerCommand({ kind: "attack", target: ghost.id }).ok).toBe(true);
    expect(isAlive(ghost)).toBe(false);

    const dropped = wrecksIn(game, where).slice(before);
    expect(dropped.map((w) => w.kind as string).sort()).toEqual([...STARTING_MODULES].sort());
    expect(dropped.every((w) => wreckSource(w) === "ghost")).toBe(true);
  });

  it("says its one line the turn it is first seen, and never again", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    sortie(game);

    const ghost = ghostsAboard(game)[0]!;
    game.player.room = ghost.room!;
    game.refreshSight();
    game.playerCommand({ kind: "wait" });
    game.playerCommand({ kind: "wait" });

    const said = game.log.lines.filter((l) => l.text === "Something with your callsign is moving in there.");
    expect(said).toHaveLength(1);
    expect((game.player.data!.hints as Record<string, boolean>).ghost).toBe(true);
  });
});

// ----------------------------------------------------------------- the cap

describe("a derelict holds two ghosts", () => {
  it("feeds a third death to the oldest one instead of raising a third", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    died(game, "r3");
    sortie(game);

    const ghosts = ghostsAboard(game);
    expect(ghosts).toHaveLength(MAX_GHOSTS);
    const oldest = ghosts[0]!;
    const hp = oldest.hp;
    const hpMax = oldest.hpMax;

    died(game, "r7");
    sortie(game);

    expect(ghostsAboard(game)).toHaveLength(MAX_GHOSTS);
    expect(oldest.hp).toBe(hp + 2);
    expect(oldest.hpMax).toBe(hpMax + 2);
    // The cap is on the machines, not on the salvage: the third rack is still
    // lying where the third drone died.
    expect(wrecksIn(game, room(game, "r7"))).toHaveLength(RACK_SIZE);
  });

  it("raises a new one once a ghost is dead", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    died(game, "r3");
    sortie(game);

    const ghosts = ghostsAboard(game);
    for (const g of ghosts) {
      g.hp = 0;
      g.alive = false;
    }
    game.reapDead();

    died(game, "r7");
    sortie(game);
    expect(ghostsAboard(game)).toHaveLength(1);
  });
});

// ------------------------------------------------------ the compartment keeps

describe("the wreckage belongs to the compartment", () => {
  it("survives a sortie, and what was taken does not come back", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    sortie(game);

    const r5 = room(game, "r5");
    expect(wrecksIn(game, r5)).toHaveLength(RACK_SIZE);

    game.player.room = r5;
    game.refreshSight();
    const taken = wrecksIn(game, r5)[0]!;
    expect(game.playerCommand({ kind: "act", verb: "salvage", target: taken.id }).ok).toBe(true);
    expect(wrecksIn(game, r5)).toHaveLength(RACK_SIZE - 1);

    sortie(game);
    const left = wrecksIn(game, room(game, "r5"));
    expect(left).toHaveLength(RACK_SIZE - 1);
    expect(left.some((w) => w.id === taken.id)).toBe(false);
  });

  it("gives every piece an id of its own", () => {
    const game = gameOn(SHIP);
    died(game, "r5");
    died(game, "r3");
    sortie(game);

    const ids = [...wrecksIn(game, room(game, "r5")), ...wrecksIn(game, room(game, "r3"))].map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// -------------------------------------------------------------- the replay

/** Seeds one death record before GHOST reads it, so a replay rebuilds the ship. */
function seedDeaths(at: RoomId): System<RoomGame> {
  return {
    name: "seed-deaths",
    onLevelEnter(game) {
      const data = (game.player.data ??= {});
      if (data.deaths === undefined) {
        data.deaths = [{ room: at, rig: makeStartingRig(), shipId: SHIP_ID } satisfies Death];
      }
    },
  };
}

function snapshot(game: RoomGame): string {
  const who = game.entities.map((e) => `${e.name}@${e.room}:${e.hp}/${e.hpMax}`);
  const what = game.ship.rooms.flatMap((r) =>
    wrecksIn(game, r.id).map((w) => `${r.label}/${w.id}/${w.kind}/${w.integrity}/${wreckSource(w) ?? "-"}`),
  );
  const said = game.log.lines.map((l) => `${l.turn}:${l.text}`);
  // The run's own stream last: two games that spent it differently are two
  // different games however alike their ships look.
  return [...who, ...what, ...said, `rng:${game.rng.next()}`].join("|");
}

describe("raising a ghost is off the ship's seed, not the run's", () => {
  it("leaves game.rng exactly where a run with no deaths leaves it", () => {
    const haunted = gameOn(SHIP, 4242);
    died(haunted, "r5");
    sortie(haunted);

    const clean = gameOn(SHIP, 4242);
    sortie(clean);

    expect(ghostsAboard(haunted)).toHaveLength(1);
    expect(ghostsAboard(clean)).toHaveLength(0);
    expect(haunted.rng.next()).toBe(clean.rng.next());
  });

  it("replays bit for bit", () => {
    const fixture = shipFromText(SHIP).ship;
    const at = fixture.room("r5").id;
    const cfg: Omit<RoomGameConfig, "seed"> = {
      ...GAME_CONFIG,
      content: { ...SALVOR, monsterChance: () => 0 },
      systems: [seedDeaths(at), GHOST],
      firstShip: () => shipFromText(SHIP).ship,
      firstShipId: "1",
    };
    const cmds: RoomCommand[] = [
      { kind: "go", door: fixture.door("d1").id },
      { kind: "go", door: fixture.door("d2").id },
      { kind: "go", door: fixture.door("d3").id },
      { kind: "go", door: fixture.door("d4").id },
      { kind: "wait" },
      { kind: "wait" },
      { kind: "wait" },
      { kind: "wait" },
    ];

    const first = replayRooms(1234, cmds, cfg);
    // The ghost is up on the first entry here: `seedDeaths` runs ahead of GHOST
    // in the same `onLevelEnter`, which is what makes the run replayable at all.
    expect(ghostsAboard(first).length + first.kills).toBeGreaterThan(0);
    expect(snapshot(replayRooms(1234, cmds, cfg))).toBe(snapshot(first));
  });
});

// ------------------------------------------------------------- the onboarding

describe("the hint the tug shows at the first death", () => {
  it("names the row the hint table says it once a run", () => {
    expect(GHOST_HINT_KEY).toBe("hint.death");
    expect(t(GHOST_HINT_KEY)).toBe("Your drone is still in there. It will not be friendly.");
  });
});

// ------------------------------------------------------------ the whole game

/**
 * The same mechanic through the run's own machinery: a drone that really died,
 * a record the voyage really wrote, and a sortie that really came back.
 *
 * Everything above puts the death records in by hand, at the address the system
 * falls back to. This is the one that proves the address the game uses —
 * `voyage.state[…].deaths`, keyed by the hull the death happened on — is the
 * one `deathsOf` reads.
 */
describe("a drone lost on a real voyage", () => {
  /**
   * A run already aboard the first derelict, with nothing else alive on it and
   * an account that can afford the next drone.
   *
   * The account matters: a voyage that cannot buy a hull is over the moment the
   * drone dies (`systems/voyage.ts`), and a run that ended has no next sortie
   * for a ghost to rise on.
   */
  function sortieOne(seed: number): SalvorGame {
    const game = newGame(seed);
    voyageOf(game).credits = 200;
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
    game.entities = [game.player];
    return game;
  }

  /** Kill the drone where it stands, the way a machine's last blow does. */
  function die(game: SalvorGame): RoomId {
    const where = game.player.room!;
    game.player.hp = 0;
    VOYAGE.onDeath!(game, game.player);
    expect(game.shipId).toBe("tug");
    return where;
  }

  it("writes the death where the ghost system reads it", () => {
    const game = sortieOne(6);
    const rack = rigOf(game.player)!.slots.filter((s) => s !== null).length;
    const grave = die(game);

    const state = currentDerelict(game);
    expect(state.deaths).toHaveLength(1);
    expect(state.deaths[0]!.room).toBe(grave);
    expect(state.deaths[0]!.rig.slots.filter((s) => s !== null)).toHaveLength(rack);
  });

  it("leaves the rack on the floor and one ghost near it, on the next sortie", () => {
    const game = sortieOne(6);
    const rack = rigOf(game.player)!.slots.filter((s): s is Slot => s !== null).map((s) => s.kind);
    const grave = die(game);

    // A drone off the rack, and back aboard the same hull.
    expect(game.playerCommand({ kind: "act", verb: "buy", target: 2000 }).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

    // By source, because the drone died in the compartment it landed in, and
    // the docking bay of a first freighter always has scrap of its own.
    const dropped = wrecksIn(game, grave).filter((w) => wreckSource(w) === "drone");
    expect(dropped.map((w) => w.kind as string).sort()).toEqual([...rack].sort());

    // One ghost, wearing the rack that was lost. Where it *stood up* is the
    // hand-drawn test above: `undock` costs a turn, so by the time the command
    // returns the thing has already walked at whatever it can see.
    const ghosts = ghostsAboard(game);
    expect(ghosts).toHaveLength(1);
    expect(ghostRigOf(ghosts[0]!)?.slots.filter((s) => s !== null)).toHaveLength(rack.length);
  });

  it("raises it once however many times the run comes back", () => {
    const game = sortieOne(6);
    die(game);
    expect(game.playerCommand({ kind: "act", verb: "buy", target: 2000 }).ok).toBe(true);

    for (let sortie = 0; sortie < 3; sortie++) {
      expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);
      expect(ghostsAboard(game)).toHaveLength(1);
      game.player.room = game.ship.entry;
      game.refreshSight();
      expect(game.playerCommand({ kind: "leave" }).ok).toBe(true);
    }
  });

  it("keeps the dead of one hull off the next one", () => {
    const game = sortieOne(6);
    die(game);
    expect(game.playerCommand({ kind: "act", verb: "buy", target: 2000 }).ok).toBe(true);

    // To the HELM, on to the next hull, and back out to the airlock.
    for (const door of [1, 2, 3]) expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "jump" }).ok).toBe(true);
    for (const door of [3, 2, 1]) expect(game.playerCommand({ kind: "go", door }).ok).toBe(true);
    expect(game.playerCommand({ kind: "act", verb: "undock" }).ok).toBe(true);

    expect(game.shipId).toBe("2");
    expect(ghostsAboard(game)).toEqual([]);
    expect(deathsOf(game)).toEqual([]);
  });
});
