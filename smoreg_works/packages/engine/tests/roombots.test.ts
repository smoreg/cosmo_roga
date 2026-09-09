import { describe, it, expect } from "vitest";
import { RoomGame, type RoomGameConfig } from "../src/rooms/game.js";
import type { RoomCommand } from "../src/rooms/actions.js";
import { spawnMonsterIn } from "../src/content/kinds.js";
import { Rng } from "../src/sim/rng.js";
import { TURN_COST } from "../src/sim/schedule.js";
import type { Twist } from "../src/sim/twist.js";
import { describeFailure, fuzzOn } from "../src/testing/fuzz.js";
import { formatSummary, runBatchOn, runBotOn, seedRange } from "../src/testing/metrics.js";
import { shipFromText } from "../src/testing/roomfixtures.js";
import { TEST_ROOM_CONTENT, TEST_ROOM_MONSTERS, testShip } from "../src/testing/dummyship.js";
import {
  BOTS_ROOMS,
  greedyBot,
  makeCarefulBot,
  makeGreedyBot,
  randomBot,
  roomPlay,
  roomsExplored,
  type RoomBot,
} from "../src/testing/roombots.js";

/** Nothing aboard but the drone: a test about walking should be about walking. */
const QUIET: Omit<RoomGameConfig, "seed"> = {
  content: { ...TEST_ROOM_CONTENT, monsterChance: () => 0 },
  firstShip: testShip,
};

/** A drone that cannot be killed, for the runs that have to last 500 commands. */
const TOUGH: Omit<RoomGameConfig, "seed"> = {
  content: {
    ...TEST_ROOM_CONTENT,
    makePlayer: () => {
      const drone = TEST_ROOM_CONTENT.makePlayer();
      drone.hp = 9999;
      drone.hpMax = 9999;
      return drone;
    },
  },
  firstShip: testShip,
};

/**
 * Two compartments that can only be reached through the locked `d4` — so
 * "everything a bot can get to" and "everything there is" are different
 * numbers, which is the whole point of the pair of tests below.
 */
const LOCKED_WING = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3
  r2 -(d3)- r4
  r3 -[d4:k1]- r5
  r5 -d5- r6
  r1: docking
  r2: cargo
  r3: corridor
  r4: storage
  r5: engine
  r6: reactor
`;

/** Ten rooms in a line: room enough to back away eight times and then some. */
const CORRIDOR = `
  TUG -a1- r1
  r1 -d1- r2 -d2- r3 -d3- r4 -d4- r5 -d5- r6 -d6- r7 -d7- r8 -d8- r9 -d9- r10
  r1: docking
`;

/**
 * A game in one system: it hands out the single thing the engine cannot invent
 * — a way through a locked door — and says so through `offerActions`, which is
 * the only channel a bot has. The bot never learns the word "key".
 */
const KEYRING: Twist<RoomGame> = {
  name: "keyring",
  offerActions: (game) =>
    game.ship
      .doorsOf(game.roomOf(game.player).id)
      .filter((d) => d.state === "locked")
      .map((d) => ({ label: `unlock ${d.label}`, cmd: { kind: "act", verb: "key", target: d.id }, enabled: true })),
  performCommand: (game, _actor, cmd) => {
    if (cmd.kind !== "act" || cmd.verb !== "key") return undefined;
    const door = cmd.target === undefined ? undefined : game.ship.doors[cmd.target];
    if (!door || door.state !== "locked") return { ok: false, cost: 0, reason: "Nothing to unlock." };
    door.state = "open";
    return { ok: true, cost: TURN_COST };
  },
};

/** An alert system with one thing to say: now is a good moment to be unseen. */
const HIDE_ADVICE: Twist<RoomGame> = {
  name: "alert",
  offerActions: () => [{ label: "hide", cmd: { kind: "hide" }, enabled: true }],
};

/**
 * A game whose offer list never runs out: a verb for every door of the room and
 * one for the room itself, all legal, all back on the list the turn after they
 * are pressed.
 *
 * The shape a real one has — shut a bulkhead, weld it, tidy what is lying there
 * — and the shape that turns "press what the game offers" into a loop: a bot
 * with no memory welds a door, cuts it open and welds it again until the run
 * times out, three compartments from anything worth doing.
 */
const BUSYWORK: Twist<RoomGame> = {
  name: "busywork",
  offerActions: (game) => [
    ...game.ship.doorsOf(game.roomOf(game.player).id).map((d) => ({
      label: `weld ${d.label}`,
      cmd: { kind: "act" as const, verb: "weld", target: d.id },
      enabled: true,
    })),
    { label: "tidy up", cmd: { kind: "act" as const, verb: "tidy" }, enabled: true },
  ],
  performCommand: (_game, _actor, cmd) =>
    cmd.kind === "act" && (cmd.verb === "weld" || cmd.verb === "tidy")
      ? { ok: true, cost: TURN_COST }
      : undefined,
};

/** A job that takes several turns in a row and then stops being offered. */
function splicing(turns: number): Twist<RoomGame> {
  let left = turns;
  return {
    name: "splice",
    offerActions: () =>
      left > 0
        ? [{ label: `splice (${left})`, cmd: { kind: "act" as const, verb: "splice" }, enabled: true }]
        : [],
    performCommand: (_game, _actor, cmd) => {
      if (cmd.kind !== "act" || cmd.verb !== "splice") return undefined;
      left--;
      return { ok: true, cost: TURN_COST };
    },
  };
}

/**
 * A voyage in miniature, as in `room-game.test.ts`: it claims the outcome, so
 * an airlock leads to the next derelict instead of ending the run. Without one,
 * a bot that presses `leave` stops the recording on turn three.
 */
function voyage(ships: number): Twist<RoomGame> {
  let sortie = 1;
  let moving = false;
  return {
    name: "voyage",
    claimsOutcome: true,
    beforeLevelLeave(game) {
      if (moving) return;
      moving = true;
      sortie++;
      if (sortie > ships) game.finish("won", "The tug pulls away.");
      else game.travelTo(String(sortie), { generate: testShip, reason: "custom" });
      moving = false;
    },
  };
}

/** Drive a bot by hand the way `runBotOn` does, and keep what it pressed. */
function play(bot: RoomBot, game: RoomGame, turns: number, rng = new Rng(7)): RoomCommand[] {
  const pressed: RoomCommand[] = [];
  while (!game.isOver() && game.inputs.length < turns) {
    const cmd = bot(game, rng);
    pressed.push(cmd);
    if (!game.playerCommand(cmd).ok) game.playerCommand({ kind: "wait" });
  }
  return pressed;
}

function exploredLabels(game: RoomGame): string[] {
  return game.ship.rooms.filter((r) => r.explored).map((r) => r.label);
}

/** Ten open compartments in a line: a sweep with nothing in its way. */
function busy(): Omit<RoomGameConfig, "seed"> {
  return { content: QUIET.content, firstShip: () => shipFromText(CORRIDOR).ship };
}

function longestRun(cmds: RoomCommand[], pred: (c: RoomCommand) => boolean): number {
  let best = 0;
  let run = 0;
  for (const c of cmds) {
    run = pred(c) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

describe("greedy sweeps a ship", () => {
  it("stands in every compartment of the test ship inside 60 turns, then leaves", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const game = new RoomGame({ seed, ...QUIET });
      play(greedyBot, game, 60);

      expect(roomsExplored(game), `seed ${seed}`).toBe(game.ship.size);
      expect(game.status, `seed ${seed}: an explored ship is a finished sortie`).toBe("won");
    }
  });

  it("gets everything the locked door does not hide, and stops there", () => {
    const game = new RoomGame({ seed: 3, content: QUIET.content, firstShip: () => shipFromText(LOCKED_WING).ship });
    play(greedyBot, game, 60);

    expect(exploredLabels(game)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(game.inputs.length).toBeLessThanOrEqual(60);
  });

  it("gets the rest as soon as a system offers a way through", () => {
    const game = new RoomGame({
      seed: 3,
      content: QUIET.content,
      firstShip: () => shipFromText(LOCKED_WING).ship,
      twist: KEYRING,
    });
    const pressed = play(greedyBot, game, 60);

    expect(exploredLabels(game)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(game.inputs.length).toBeLessThanOrEqual(60);
    expect(
      pressed.filter((c) => c.kind === "act"),
      "it pressed the offer rather than walking into a locked door",
    ).toHaveLength(1);
  });
});

describe("an offer that costs the drone something", () => {
  /**
   * A hold that buys the drone's own rack: four lines of one verb, one per
   * slot, each of them taking away something the drone was flying with — and
   * one line of another verb that costs it nothing.
   *
   * The shape the shipped game has, and the one the bot used to fall for: it
   * pressed all four lines of the first verb before the first of them had
   * taught it anything, because what it remembered was the line and not the
   * verb.
   */
  const HOLD: Twist<RoomGame> = {
    name: "hold",
    offerActions: () => [
      ...[0, 1, 2, 3].map((slot) => ({
        label: `sell ${slot}`,
        cmd: { kind: "act" as const, verb: "sell", slot },
        enabled: true,
      })),
      { label: "tidy up", cmd: { kind: "act" as const, verb: "tidy" }, enabled: true },
    ],
    performCommand: (game, _actor, cmd) => {
      if (cmd.kind !== "act") return undefined;
      if (cmd.verb === "sell") {
        game.player.speed = Math.max(10, game.player.speed - 20);
        return { ok: true, cost: TURN_COST };
      }
      return cmd.verb === "tidy" ? { ok: true, cost: TURN_COST } : undefined;
    },
  };

  it("is pressed once, and the rest of that verb's lines are left alone", () => {
    const game = new RoomGame({
      seed: 11,
      content: QUIET.content,
      firstShip: () => shipFromText("TUG -a1- r1\nr1: docking").ship,
      twist: HOLD,
    });

    // The bot with a memory: `greedyBot` is the stateless one and remembers
    // nothing at all, so it is not the thing this is about.
    const acts = play(makeGreedyBot(), game, 20).filter((c) => c.kind === "act");

    expect(acts.filter((c) => c.kind === "act" && c.verb === "sell")).toHaveLength(1);
    expect(
      acts.some((c) => c.kind === "act" && c.verb === "tidy"),
      "a verb that cost the drone nothing is still worth a turn",
    ).toBe(true);
  });
});

describe("random presses everything, legal or not", () => {
  it("survives 50 runs of 500 commands without throwing", () => {
    const failures = fuzzOn({
      seeds: seedRange(3000, 50),
      steps: 500,
      make: (seed) => new RoomGame({ seed, twist: voyage(999), ...TOUGH }),
      bot: randomBot,
    });
    expect(failures.map(describeFailure)).toEqual([]);
  });

  it("gets refused, and a refusal costs neither a turn nor a line of the recording", () => {
    const game = new RoomGame({ seed: 4242, twist: voyage(999), ...TOUGH });
    const rng = new Rng(4242 ^ 0x5bf03635);
    let refused = 0;

    for (let i = 0; i < 500 && !game.isOver(); i++) {
      const before = game.inputs.length;
      const out = game.playerCommand(randomBot(game, rng));
      if (out.ok) continue;
      refused++;
      expect(out.cost, "a refusal is free").toBe(0);
      expect(game.inputs.length, "a refused command was recorded anyway").toBe(before);
      game.playerCommand({ kind: "wait" });
    }

    expect(refused, "nothing illegal was ever offered").toBeGreaterThan(0);
    expect(game.isOver(), "the run has to survive the whole recording").toBe(false);
  });

  it("really does offer a verb nobody owns and a door that does not open", () => {
    // A locked door and a sealed one, both in the room the drone starts in:
    // one gives the systems something to offer, the other gives `go` something
    // it cannot walk through.
    const game = new RoomGame({
      seed: 99,
      content: QUIET.content,
      firstShip: () => shipFromText("TUG -a1- r1\nr1 -[d1:k1]- r2\nr1 -#d2#- r3\nr1: docking").ship,
      twist: KEYRING,
    });
    const rng = new Rng(99);
    const rolled = Array.from({ length: 600 }, () => randomBot(game, rng));

    expect(rolled.some((c) => c.kind === "act" && c.verb === "zzz")).toBe(true);
    expect(rolled.some((c) => c.kind === "act" && c.verb === "key")).toBe(true);
    expect(
      rolled.some((c) => c.kind === "go" && !game.ship.passable(game.ship.doorAt(c.door), { isPlayer: true })),
      "every door of the room, not only the ones that open",
    ).toBe(true);
    expect(rolled.some((c) => c.kind === "hide")).toBe(true);
    expect(rolled.some((c) => c.kind === "leave")).toBe(true);
  });
});

describe("careful backs off, but not forever", () => {
  it("retreats eight times in a row at most, then turns and fights", () => {
    const game = new RoomGame({
      seed: 5,
      content: {
        ...TEST_ROOM_CONTENT,
        monsterChance: () => 0,
        makePlayer: () => {
          const drone = TEST_ROOM_CONTENT.makePlayer();
          drone.hp = 3000;
          drone.hpMax = 9999;
          return drone;
        },
      },
      firstShip: () => shipFromText(CORRIDOR).ship,
    });
    // Unkillable and it can see through a door, so the pressure never lets up
    // and the counter is never reset by an escape that actually worked.
    const hulk = spawnMonsterIn({ ...TEST_ROOM_MONSTERS[0]!, hp: 9999, sight: 1 }, game.ship.entry);
    game.entities.push(hulk);
    game.schedule.admit(hulk);

    const pressed = play(makeCarefulBot(), game, 40);

    // The first decision is a swing: "losing" is measured against the drone
    // that came aboard rather than against its maximum, so the bot has to be
    // hit once before it knows. Then it gives ground eight times, and after
    // that it turns and fights whatever else happens.
    expect(pressed[0]!.kind).toBe("attack");
    expect(longestRun(pressed, (c) => c.kind === "go")).toBe(8);
    const last = pressed.map((c) => c.kind).lastIndexOf("go");
    expect(pressed.slice(last + 1).every((c) => c.kind === "attack")).toBe(true);
    expect(pressed.length - last, "and does not go back to giving ground").toBeGreaterThan(20);
  });

  it("presses an offer whose line never moves once a run, not six times a compartment", () => {
    // `tidy up` reads the same before and after it is pressed, so from out here
    // its whole effect is somewhere the bot cannot see it — and pressing it
    // again is the same bargain again. It used to be worth six turns a
    // compartment, on the argument that an offer still on the list may be a job
    // still running; a job says so by counting itself down (the test below),
    // and the shipped game's twelve-credit graft does not.
    const game = new RoomGame({ seed: 5, ...busy(), twist: BUSYWORK });
    const pressed = play(makeCarefulBot(), game, 200);

    expect(pressed.some((c) => c.kind === "act" && c.verb === "tidy"), "it never took the offer").toBe(true);
    expect(
      longestRun(pressed, (c) => c.kind === "act" && c.verb === "tidy"),
      "an offer still on the list is not a reason to press it again",
    ).toBe(1);
    expect(roomsExplored(game), "and the sweep still happened").toBe(game.ship.size);
    expect(game.status, "an explored ship is a finished sortie").toBe("won");
  });

  it("does not take it again in the next compartment either", () => {
    // Ten compartments in a line with `tidy up` on the list in every one of
    // them, and the whole sweep is worth one press: a bargain that showed
    // nothing the first time shows nothing the second, which is the same thing
    // the bot decides about a verb that cost it something.
    const game = new RoomGame({ seed: 5, ...busy(), twist: BUSYWORK });
    const pressed = play(makeCarefulBot(), game, 200);

    expect(pressed.filter((c) => c.kind === "act" && c.verb === "tidy")).toHaveLength(1);
    expect(roomsExplored(game), "and the sweep still happened").toBe(game.ship.size);
  });

  it("leaves the doors of the room to the sweep, whatever the game offers to do with them", () => {
    // Every door of this ship already opens, so nothing about the route can
    // excuse a door verb: pressing one is the bot welding a bulkhead in passing.
    const game = new RoomGame({ seed: 5, ...busy(), twist: BUSYWORK });
    const pressed = play(makeCarefulBot(), game, 200);

    expect(pressed.filter((c) => c.kind === "act" && c.verb === "weld")).toEqual([]);
  });

  it("keeps a job running for as long as its line counts itself down", () => {
    const game = new RoomGame({ seed: 5, ...busy(), twist: splicing(3) });
    const pressed = play(makeCarefulBot(), game, 10);

    // `splice (3)`, `splice (2)`, `splice (1)` — the line moves every turn, so
    // the job is worth going on with; an offer that reads the same afterwards
    // is not (the test above).
    expect(pressed.slice(0, 3)).toEqual([
      { kind: "act", verb: "splice" },
      { kind: "act", verb: "splice" },
      { kind: "act", verb: "splice" },
    ]);
    expect(pressed[3]!.kind, "and gets on with the sortie once the job is done").toBe("go");
  });

  it("takes cover when there is cover and a system says it is worth a turn", () => {
    const ship = () => shipFromText("TUG -a1- r1\nr1 -d1- r2\nr1: docking cover").ship;
    const advised = new RoomGame({ seed: 2, content: QUIET.content, firstShip: ship, twist: HIDE_ADVICE });
    const alone = new RoomGame({ seed: 2, content: QUIET.content, firstShip: ship });
    const rng = new Rng(1);

    expect(makeCarefulBot()(advised, rng)).toEqual({ kind: "hide" });
    expect(makeCarefulBot()(alone, rng).kind, "cover alone is not a reason").toBe("go");
  });

  it("does not spend the whole sortie in cover, however long the advice stands", () => {
    // The advice never expires here, which is what a real alert system does
    // while the drone stands in a compartment with somewhere to hide.
    const game = new RoomGame({
      seed: 2,
      content: QUIET.content,
      firstShip: () => shipFromText("TUG -a1- r1\nr1 -d1- r2\nr1: docking cover").ship,
      twist: HIDE_ADVICE,
    });
    const pressed = play(makeCarefulBot(), game, 30);

    expect(longestRun(pressed, (c) => c.kind === "hide")).toBe(4);
    expect(exploredLabels(game), "and walks out of the room it was hiding in").toEqual(["r1", "r2"]);
  });

  it("does not hide with a machine in the room, even when told to", () => {
    const game = new RoomGame({
      seed: 2,
      content: QUIET.content,
      firstShip: () => shipFromText("TUG -a1- r1\nr1 -d1- r2\nr1: docking cover").ship,
      twist: HIDE_ADVICE,
    });
    const grunt = spawnMonsterIn(TEST_ROOM_MONSTERS[0]!, game.ship.entry);
    game.entities.push(grunt);
    game.schedule.admit(grunt);

    expect(makeCarefulBot()(game, new Rng(1))).toEqual({ kind: "attack", target: grunt.id });
  });
});

describe("an offer that is a way off the ship", () => {
  /**
   * The shipped game's tug in miniature: three compartments in a line, and in
   * the first of them a button that casts off. What the voyage is here for is
   * two doors further on.
   *
   * The shape that cost the shipped game every charter it ever signed:
   * `undock → freighter` is the DOCK's first enabled line, so the bot pressed
   * it on turn zero of every visit home and never once stood at the HELM, where
   * the charters are taken and the next hull is bought. Measured over 32 seeds:
   * 0.00 charters a voyage, and every voyage over on its first hull.
   *
   * Nothing here says which line is the way off — the bot presses it, notices
   * that the ship underfoot changed, and remembers the verb.
   */
  const DECK = `
    TUG -a1- r1
    r1 -d1- r2 -d2- r3
    r1: docking
    r3: control
  `;

  function deck(pressed: Array<[string, number]>): Twist<RoomGame> {
    let sortie = 1;
    return {
      name: "deck",
      claimsOutcome: true,
      offerActions: (game) => {
        const kind = game.roomOf(game.player).kind;
        if (kind === "docking") {
          return [{ label: "cast off", cmd: { kind: "act", verb: "cast" }, enabled: true }];
        }
        if (kind === "control") {
          return [{ label: "sign the charter", cmd: { kind: "act", verb: "sign" }, enabled: true }];
        }
        return [];
      },
      performCommand: (game, _actor, cmd) => {
        if (cmd.kind !== "act" || (cmd.verb !== "cast" && cmd.verb !== "sign")) return undefined;
        pressed.push([cmd.verb, roomsExplored(game)]);
        // Casting off is what it says: the drone is on another ship afterwards,
        // and coming back is another `travelTo` on the same two decks.
        if (cmd.verb === "cast") {
          sortie++;
          game.travelTo(sortie % 2 === 0 ? "out" : String(sortie), {
            generate: () => shipFromText(DECK).ship,
            reason: "custom",
          });
        }
        return { ok: true, cost: TURN_COST };
      },
    };
  }

  it("is pressed once before the bot knows, and after that it waits for the sweep", () => {
    const acts: Array<[string, number]> = [];
    const game = new RoomGame({
      seed: 5,
      content: QUIET.content,
      firstShip: () => shipFromText(DECK).ship,
      twist: deck(acts),
    });
    play(makeCarefulBot(), game, 120);

    // The first press is the lesson: nothing on the list says where a line
    // leads, so the bot finds out the way anyone does.
    expect(acts[0]![0], "the first press is the button under its feet").toBe("cast");
    // From then on the deck is walked first, and the charter two doors away is
    // signed before the drone is cast off again.
    expect(acts.slice(1, 3).map(([verb]) => verb)).toEqual(["sign", "cast"]);
    expect(acts[2]![1], "and by then there was nothing left to see").toBe(game.ship.size);
  });

  it("is still pressed when the sweep has nothing left to give", () => {
    // The other half of the same rule: a way off that waits forever is a bot
    // that never leaves. One compartment, one line, and it is taken.
    const acts: Array<[string, number]> = [];
    const game = new RoomGame({
      seed: 5,
      content: QUIET.content,
      firstShip: () => shipFromText("TUG -a1- r1\nr1: docking").ship,
      twist: deck(acts),
    });
    play(makeCarefulBot(), game, 40);

    expect(acts.filter(([verb]) => verb === "cast").length, "it cast off, again and again")
      .toBeGreaterThan(3);
  });

  /**
   * One thing lying in the airlock compartment, dropped there partway through
   * the sortie so that the bot meets it on the way home rather than on the way
   * in — which is the only moment the rule below is about.
   */
  function crate(): { twist: Twist<RoomGame>; drop(): void } {
    let there = false;
    let taken = false;
    return {
      drop: () => {
        there = true;
      },
      twist: {
        name: "crate",
        offerActions: (game) =>
          there && !taken && game.roomOf(game.player).kind === "docking"
            ? [{ label: "grab the crate", cmd: { kind: "act", verb: "grab" }, enabled: true }]
            : [],
        performCommand: (_game, _actor, cmd) => {
          if (cmd.kind !== "act" || cmd.verb !== "grab") return undefined;
          taken = true;
          return { ok: true, cost: TURN_COST };
        },
      },
    };
  }

  /**
   * The same three-compartment deck, plus the hull it casts off to — and this
   * time both are real ships in the store, so `Room.explored` on each of them
   * survives the trip and says how much of it anybody has stood in.
   */
  const HULL = `
    TUG -a1- h1
    h1 -e1- h2
    h1: docking
  `;

  function ferry(pressed: string[]): Twist<RoomGame> {
    return {
      name: "ferry",
      claimsOutcome: true,
      offerActions: (game) => {
        const kind = game.roomOf(game.player).kind;
        if (kind === "docking") {
          return [{ label: "cast off", cmd: { kind: "act", verb: "cast" }, enabled: true }];
        }
        if (kind === "control") {
          return [{ label: "buy the next hull", cmd: { kind: "act", verb: "route" }, enabled: true }];
        }
        return [];
      },
      performCommand: (game, _actor, cmd) => {
        if (cmd.kind !== "act" || (cmd.verb !== "cast" && cmd.verb !== "route")) return undefined;
        pressed.push(cmd.verb);
        if (cmd.verb === "cast") {
          const to = game.shipId === "deck" ? "hull" : "deck";
          game.travelTo(to, {
            generate: () => shipFromText(to === "hull" ? HULL : DECK).ship,
            reason: "custom",
          });
        }
        return { ok: true, cost: TURN_COST };
      },
    };
  }

  it("goes back to a ship whose last visit found something, before anything else here", () => {
    // The rule the shipped game cost 0.29 hulls a voyage to learn. `route` is
    // two doors from the airlock and `cast off` is underfoot, and a bot that
    // walks the deck first presses `route` the turn it can — which on the
    // shipped tug buys the jump to the next derelict and leaves the half
    // stripped one behind with its systems standing and its sale unpaid.
    //
    // What the bot can see is not the sale. It is that the last trip aboard
    // that hull stood in a compartment nobody had stood in before, so there is
    // more of it — and while that is true, the way off is taken as soon as it
    // is offered rather than after the deck has been walked.
    //
    // Two compartments in the hull, so the second trip finds nothing new and
    // the hold on `route` comes off by itself. That is the whole bound: a ship
    // that stops answering is finished, and a compartment behind a bulkhead
    // this drone will never open never makes it unfinished forever.
    const acts: string[] = [];
    const game = new RoomGame({
      seed: 5,
      content: QUIET.content,
      firstShipId: "deck",
      firstShip: () => shipFromText(DECK).ship,
      twist: ferry(acts),
    });
    play(makeCarefulBot(), game, 120);

    // cast (the lesson: nothing said where that line led) · cast home off a
    // hull that turned up two new compartments · cast straight back out, with
    // `route` two doors away untouched · cast home off a hull that turned up
    // nothing · and only now the deck is walked and the next hull bought.
    expect(acts.slice(0, 5)).toEqual(["cast", "cast", "cast", "cast", "route"]);
  });

  it("does not stop a sortie that has gone wrong emptying the airlock first", () => {
    const wreckage = crate();
    const game = new RoomGame({
      seed: 5,
      content: QUIET.content,
      firstShip: () => shipFromText("TUG -a1- r1\nr1 -d1- r2\nr1: docking").ship,
      twist: wreckage.twist,
    });
    const bot = makeCarefulBot();
    const rng = new Rng(1);

    game.playerCommand(bot(game, rng));
    wreckage.drop();
    // The drone is worth less than it came aboard with, so the rest of the ship
    // is somebody else's problem: it turns for the airlock.
    game.player.hp -= 2;
    const home = bot(game, rng);
    expect(home.kind, "spent, and on its way out").toBe("go");
    game.playerCommand(home);

    // And the crate underfoot is worth the one turn: everything carried is only
    // worth something on the far side of that door.
    const last = bot(game, rng);
    expect(last, "the way out is where the last turn is spent").toEqual({ kind: "act", verb: "grab" });
    game.playerCommand(last);
    expect(bot(game, rng), "and then the door").toEqual({ kind: "leave" });
  });
});

describe("the numbers a balance pass is read by", () => {
  it("scores a sortie by the compartments stood in", () => {
    const result = runBotOn(
      () => greedyBot,
      5,
      roomPlay({ make: (seed) => new RoomGame({ seed, ...QUIET }) }),
    );

    expect(result.progress).toBe(6);
    expect(result.depth, "the grid game's name for the same number").toBe(result.progress);
    expect(result.status).toBe("won");
    expect(result.extra).toEqual({});
  });

  it("takes progress and the extra counters from the game when it has them", () => {
    const make = (seed: number) => {
      const game = new RoomGame({ seed, ...QUIET });
      return Object.assign(game, {
        progress: () => roomsExplored(game),
        metrics: () => ({ doorsOpen: game.ship.doors.filter((d) => d.state === "open").length }),
      });
    };

    const result = runBotOn(() => greedyBot, 5, { make });
    expect(result.progress).toBe(6);
    expect(result.extra.doorsOpen).toBeGreaterThan(0);
  });

  it("is the same run twice for the same seed, bot by bot", () => {
    const opts = () =>
      roomPlay({
        maxSteps: 300,
        make: (seed: number) => new RoomGame({ seed, twist: voyage(60), ...TOUGH }),
        progress: (game) => game.ships.size,
      });

    for (const [name, factory] of Object.entries(BOTS_ROOMS)) {
      const a = runBotOn(factory, 77, opts());
      const b = runBotOn(factory, 77, opts());
      expect(b, name).toEqual(a);
    }

    const seeds = seedRange(1, 8);
    const first = runBatchOn("careful", BOTS_ROOMS.careful!, seeds, opts());
    expect(runBatchOn("careful", BOTS_ROOMS.careful!, seeds, opts())).toEqual(first);
    expect(formatSummary(first)).toContain("medProgress=");
  });

  it("never goes backwards while greedy is sweeping", () => {
    const game = new RoomGame({ seed: 31, ...QUIET });
    const rng = new Rng(31);
    let last = 0;

    while (!game.isOver() && game.inputs.length < 60) {
      if (!game.playerCommand(greedyBot(game, rng)).ok) game.playerCommand({ kind: "wait" });
      const now = roomsExplored(game);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBe(game.ship.size);
  });
});

describe("the three roles", () => {
  it("come out of the testing entry point under names the grid bots do not own", async () => {
    const testing = await import("../src/testing/index.js");

    expect(Object.keys(testing.BOTS_ROOMS).sort()).toEqual(["careful", "greedy", "random"]);
    expect(testing.greedyRoomBot).toBe(greedyBot);
    expect(testing.greedyRoomBot).not.toBe(testing.greedyBot);
    expect(typeof testing.makeCarefulRoomBot).toBe("function");
    expect(typeof testing.roomPlay).toBe("function");
  });

  it("each build a fresh bot, so nothing leaks between runs", () => {
    for (const [name, factory] of Object.entries(BOTS_ROOMS)) {
      expect(typeof factory(), name).toBe("function");
    }
    expect(BOTS_ROOMS.careful!()).not.toBe(BOTS_ROOMS.careful!());
  });
});
