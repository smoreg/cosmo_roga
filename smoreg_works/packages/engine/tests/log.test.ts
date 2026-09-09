import { describe, it, expect } from "vitest";
import { MessageLog } from "../src/sim/log.js";
import { Game } from "../src/sim/game.js";
import { perform } from "../src/sim/actions.js";
import { isAlive, type Entity } from "../src/sim/entity.js";
import type { Twist } from "../src/sim/twist.js";
import { spawnMonster } from "../src/content/kinds.js";
import { fromAscii } from "../src/testing/fixtures.js";
import { TEST_CONTENT, TEST_MONSTERS } from "../src/testing/dummycontent.js";

/**
 * What the combat log is allowed to say.
 *
 * Three of these lines shipped wrong to a playtest — "the scout hits You for
 * 0.", "You dies.", "You hits the scout for 3." — and every one of them is a
 * one-character branch away from being right, which is exactly the kind of
 * thing that survives to release unless a test names it.
 */

const DEATH_LINE = "You die. The station keeps what it takes.";

/** No spawns and a death line we can look for: the log is the only subject here. */
const BARE = {
  ...TEST_CONTENT,
  monstersForDepth: () => [],
  monsterBudget: () => 0,
  deathLine: DEATH_LINE,
};

/** A corridor with the player and one grunt nose to nose. */
function duel(twist?: Twist): { game: Game; grunt: Entity } {
  const game = new Game({ seed: 9, content: BARE, twist });
  const f = fromAscii(["#####", "#@g.#", "#####"]);
  game.level = f.level;
  game.player.pos = { ...f.player! };
  const grunt = spawnMonster(TEST_MONSTERS[0]!, f.mark("g"));
  game.entities = [game.player, grunt];
  game.schedule.admit(grunt);
  game.refreshFov();
  return { game, grunt };
}

function lines(game: Game): string[] {
  return game.log.tail(100).map((l) => l.text);
}

/** The grunt swings west, at the player. */
function gruntAttacks(game: Game): void {
  const grunt = game.entities.find((e) => e.id !== game.player.id)!;
  perform(game, grunt, { kind: "attack", dx: -1, dy: 0 });
}

describe("combat log grammar", () => {
  it("puts the player's verb in the second person", () => {
    const { game } = duel();
    perform(game, game.player, { kind: "attack", dx: 1, dy: 0 });

    expect(lines(game)).toContainEqual(expect.stringMatching(/^You hit the grunt for \d+\.$/));
    expect(lines(game).some((l) => l.startsWith("You hits"))).toBe(false);
  });

  it("keeps the third person for everyone else", () => {
    const { game } = duel();
    gruntAttacks(game);

    expect(lines(game)).toContainEqual(expect.stringMatching(/^the grunt hits You for \d+\.$/));
  });

  it("agrees with the label when the player stumbles", () => {
    const { game } = duel();
    game.player.stunned = 1;
    perform(game, game.player, { kind: "move", dx: 0, dy: 1 });

    expect(lines(game)).toContain("You stumble.");
  });
});

describe("a blow a system swallowed", () => {
  /** Eats `take` points before hit points ever see them. */
  const shield = (take: number): Twist => ({
    name: "shield",
    onDamage: (_g, _victim, raw) => Math.max(0, raw - take),
  });

  it("is not reported twice: no `for 0` when the interception was total", () => {
    const { game, grunt } = duel(shield(99));
    grunt.damage = [1, 1, 10];
    gruntAttacks(game);

    expect(lines(game).some((l) => l.includes("hits You"))).toBe(false);
    expect(lines(game).some((l) => l.includes("for 0."))).toBe(false);
    expect(game.player.hp).toBe(game.player.hpMax);
  });

  it("still reports the part that got through", () => {
    const { game, grunt } = duel(shield(6));
    // 1d1+10 through defense 1 is 10 flat, so the arithmetic is the test's,
    // not the dice's: 6 stopped, 4 landed.
    grunt.damage = [1, 1, 10];
    gruntAttacks(game);

    expect(lines(game)).toContain("the grunt hits You for 4.");
  });

  it("leaves an unshielded hit exactly as it was", () => {
    const { game, grunt } = duel();
    grunt.damage = [1, 1, 10];
    gruntAttacks(game);

    expect(lines(game)).toContain("the grunt hits You for 10.");
  });
});

describe("the event key", () => {
  it("is carried through untouched, and is absent when nobody passed one", () => {
    const log = new MessageLog();
    log.add("Puerta d4 se abre.", 1, "good", "log.door.open");
    log.add("Something happened.", 1);

    expect(log.lines[0]!.key).toBe("log.door.open");
    expect(log.lines[1]!.key).toBeUndefined();
  });

  it("folds a repeat of the same event, whatever the wording is made of", () => {
    const log = new MessageLog();
    log.add("The scout dies.", 4, "good", "log.machine.dies");
    log.add("The scout dies.", 4, "good", "log.machine.dies");

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]!.count).toBe(2);
  });

  it("keeps two events apart even when they read the same", () => {
    const log = new MessageLog();
    log.add("You are through.", 7, "good", "log.spike.through");
    log.add("You are through.", 7, "good", "log.cut.through");

    expect(log.lines).toHaveLength(2);
    expect(log.lines.map((l) => l.key)).toEqual(["log.spike.through", "log.cut.through"]);
  });
});

describe("death lines", () => {
  it("says a monster died, once", () => {
    const { game, grunt } = duel();
    for (let i = 0; i < 20 && isAlive(grunt); i++) {
      perform(game, game.player, { kind: "attack", dx: 1, dy: 0 });
    }

    expect(isAlive(grunt)).toBe(false);
    expect(lines(game).filter((l) => l === "the grunt dies.")).toHaveLength(1);
  });

  it("gives the player exactly one ending, and it is the content pack's", () => {
    const { game, grunt } = duel();
    grunt.damage = [1, 1, 99];
    game.player.hp = 1;

    game.playerCommand({ kind: "wait" });

    expect(game.status).toBe("dead");
    expect(lines(game)).not.toContain("You dies.");
    expect(lines(game).filter((l) => l === DEATH_LINE)).toHaveLength(1);
  });
});
