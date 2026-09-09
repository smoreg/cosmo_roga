import { describe, it, expect } from "vitest";
import { BEHAVIOURS, behaviourByName, desireDriven, hunter, type AiWorld } from "../src/sim/ai/behaviors.js";
import { Faction, makeEntity, resetIds, type Entity } from "../src/sim/entity.js";
import { applyStatus } from "../src/sim/status.js";
import { Rng } from "../src/sim/rng.js";
import { fromAscii } from "../src/testing/fixtures.js";
import { chebyshev } from "../src/sim/grid.js";
import { Grid } from "../src/sim/grid.js";
import { Game } from "../src/sim/game.js";
import { perform } from "../src/sim/actions.js";
import { takeAiTurn } from "../src/sim/ai.js";
import { TEST_CONTENT } from "../src/testing/dummycontent.js";

function mob(name: string, pos: { x: number; y: number }, faction = Faction.Monster, hp = 20): Entity {
  return makeEntity({
    name, ch: name[0]!, fg: "#fff", pos, faction,
    hp, hpMax: hp, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 10,
  });
}

function world(rows: string[]): { w: AiWorld; f: ReturnType<typeof fromAscii>; player: Entity } {
  resetIds();
  const f = fromAscii(rows);
  const player = mob("player", f.player ?? { x: 1, y: 1 }, Faction.Player);
  return {
    f,
    player,
    w: { level: f.level, entities: [player], player, rng: new Rng(1), cache: new Map() },
  };
}

describe("AI behaviours", () => {
  it("attacks when the player is adjacent", () => {
    const { w, f, player } = world(["#####", "#@m.#", "#####"]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    const intent = BEHAVIOURS.brute(w, m);
    expect(intent.kind).toBe("attack");
    if (intent.kind === "attack") expect(intent.target.id).toBe(player.id);
  });

  it("a brute closes the distance when it can see the player", () => {
    const { w, f, player } = world(["##########", "#@......m#", "##########"]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    const intent = BEHAVIOURS.brute(w, m);
    expect(intent.kind).toBe("step");
    if (intent.kind === "step") expect(chebyshev(intent.to, player.pos)).toBeLessThan(chebyshev(m.pos, player.pos));
  });

  it("waits when it has never seen anything", () => {
    const { w, f, player } = world(["#########", "#@..#..m#", "#########"]);
    const m = mob("m", f.mark("m"));
    m.fovRadius = 3;
    w.entities = [player, m];
    expect(BEHAVIOURS.brute(w, m).kind).toBe("wait");
  });

  it("remembers the last seen position after losing sight", () => {
    const { w, f, player } = world(["##########", "#@......m#", "##########"]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    BEHAVIOURS.brute(w, m);
    expect(m.target).toEqual(player.pos);

    // Player teleports away; the monster still walks to the remembered spot.
    player.pos = { x: 1, y: 1 };
    m.fovRadius = 1;
    const intent = BEHAVIOURS.brute(w, m);
    expect(intent.kind).toBe("step");
  });

  it("a coward runs once badly hurt", () => {
    // Room to retreat into: a monster already in the safest corner correctly
    // waits instead, which is covered by the next test.
    const { w, f, player } = world(["############", "#@..m......#", "############"]);
    const m = mob("m", f.mark("m"));
    m.hp = 2; // 10% of max
    w.entities = [player, m];
    const intent = BEHAVIOURS.coward(w, m);
    expect(intent.kind).toBe("step");
    if (intent.kind === "step") {
      expect(chebyshev(intent.to, player.pos)).toBeGreaterThan(chebyshev(m.pos, player.pos));
    }
  });

  it("a cornered coward stops fleeing rather than running into the threat", () => {
    // Dead end: the monster is already as far from the player as the map allows.
    const { w, f, player } = world(["##########", "#@......m#", "##########"]);
    const m = mob("m", f.mark("m"));
    m.hp = 2;
    w.entities = [player, m];
    expect(BEHAVIOURS.coward(w, m).kind).toBe("wait");
  });

  it("a healthy coward still advances", () => {
    const { w, f, player } = world(["##########", "#@......m#", "##########"]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    const intent = BEHAVIOURS.coward(w, m);
    if (intent.kind === "step") expect(chebyshev(intent.to, player.pos)).toBeLessThan(chebyshev(m.pos, player.pos));
  });

  it("a skirmisher keeps its distance instead of closing", () => {
    const { w, f, player } = world([
      "##########",
      "#@..m....#",
      "##########",
    ]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    const intent = BEHAVIOURS.skirmisher(w, m);
    if (intent.kind === "step") {
      expect(chebyshev(intent.to, player.pos)).toBeGreaterThanOrEqual(chebyshev(m.pos, player.pos));
    }
  });

  it("a stalker walks towards a noise it cannot see", () => {
    const f = fromAscii([
      "###########",
      "#....#....#",
      "#.m..#..@.#",
      "#....#....#",
      "#.........#",
      "###########",
    ]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const m = mob("m", f.mark("m"));
    m.fovRadius = 2; // cannot see the player
    const noise = new Grid<number>(f.level.width, f.level.height, 0);
    noise.set(4, 4, 8); // a sound to the south-east

    const w: AiWorld = {
      level: f.level, entities: [player, m], player, rng: new Rng(2),
      noise, cache: new Map(),
    };
    const intent = BEHAVIOURS.stalker(w, m);
    expect(intent.kind).toBe("step");
  });

  it("a stunned monster staggers instead of acting", () => {
    const { w, f, player } = world(["##########", "#@m......#", "##########"]);
    const m = mob("m", f.mark("m"));
    applyStatus(m, "stun", 3);
    w.entities = [player, m];
    const intent = BEHAVIOURS.brute(w, m);
    expect(intent.kind).not.toBe("attack");
  });

  it("pack animals prefer to stay with their group", () => {
    const f = fromAscii([
      "############",
      "#@.......m.#",
      "#..........#",
      "#........mm#",
      "############",
    ]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const loner = mob("loner", f.marks[0]!.pos);
    const mates = f.marks.slice(1).map((mk, i) => mob(`mate${i}`, mk.pos));
    const w: AiWorld = {
      level: f.level, entities: [player, loner, ...mates], player, rng: new Rng(3), cache: new Map(),
    };
    const intent = BEHAVIOURS.pack(w, loner);
    expect(intent.kind).toBe("step");
  });

  it("behaviourByName falls back to brute for unknown names", () => {
    expect(behaviourByName("nonsense")).toBe(BEHAVIOURS.brute);
    expect(behaviourByName(undefined)).toBe(BEHAVIOURS.brute);
    expect(behaviourByName("coward")).toBe(BEHAVIOURS.coward);
  });

  it("a custom profile is just four numbers", () => {
    const { w, f, player } = world(["############", "#@..m......#", "############"]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    // fleeBelow above 1 means "afraid even at full health".
    const timid = desireDriven({ player: 1, fleeBelow: 1.1 });
    const intent = timid(w, m);
    expect(intent.kind).toBe("step");
    if (intent.kind === "step") {
      expect(chebyshev(intent.to, player.pos)).toBeGreaterThan(chebyshev(m.pos, player.pos));
    }

    // The same monster with the opposite sign charges instead.
    const eager = desireDriven({ player: 1 });
    const charge = eager(w, m);
    if (charge.kind === "step") {
      expect(chebyshev(charge.to, player.pos)).toBeLessThan(chebyshev(m.pos, player.pos));
    }
  });

  it("never returns a step into a wall", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 200; i++) {
      const f = fromAscii([
        "##########",
        "#@..##...#",
        "#...##.m.#",
        "#........#",
        "##########",
      ]);
      resetIds();
      const player = mob("player", f.player!, Faction.Player);
      const m = mob("m", f.mark("m"));
      m.hp = rng.int(1, 20);
      const w: AiWorld = { level: f.level, entities: [player, m], player, rng, cache: new Map() };
      for (const name of Object.keys(BEHAVIOURS) as Array<keyof typeof BEHAVIOURS>) {
        const intent = BEHAVIOURS[name](w, m);
        if (intent.kind === "step") {
          expect(f.level.isWalkable(intent.to.x, intent.to.y), `${name} stepped into a wall`).toBe(true);
          expect(chebyshev(intent.to, m.pos)).toBe(1);
        }
      }
    }
  });
});

describe("hunter", () => {
  it("walks to the last known position after losing sight, like a brute", () => {
    const { w, f, player } = world(["##########", "#@......m#", "##########"]);
    const m = mob("m", f.mark("m"));
    w.entities = [player, m];
    BEHAVIOURS.hunter(w, m);
    expect(m.target).toEqual(player.pos);

    // Player teleports away; the hunter still walks to the remembered spot.
    player.pos = { x: 1, y: 1 };
    m.fovRadius = 1;
    const intent = BEHAVIOURS.hunter(w, m);
    expect(intent.kind).toBe("step");
  });

  it("updates its target from a heard noise, not just from sight", () => {
    const f = fromAscii(["###########", "#....#....#", "#.m..#..@.#", "#....#....#", "###########"]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const m = mob("m", f.mark("m"));
    m.fovRadius = 2; // walled off, cannot see the player
    const noise = new Grid<number>(f.level.width, f.level.height, 0);
    noise.set(4, 4, 8);
    const w: AiWorld = { level: f.level, entities: [player, m], player, rng: new Rng(2), noise, cache: new Map() };

    BEHAVIOURS.hunter(w, m);
    expect(m.target).toEqual({ x: 4, y: 4 });
  });

  it("searches memoryTurns turns at the last known spot, then gives up and becomes a brute", () => {
    // A wall blocks sight entirely, so the hunter can never re-spot the player
    // no matter how many turns pass — it has to rely purely on the countdown.
    const f = fromAscii(["##########", "#@..#....m#", "##########"]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const m = mob("m", f.mark("m"));
    m.target = { ...m.pos }; // already standing on the remembered spot
    const w: AiWorld = { level: f.level, entities: [player, m], player, rng: new Rng(1), cache: new Map() };

    const search = hunter(8);
    for (let turn = 1; turn <= 7; turn++) {
      const intent = search(w, m);
      expect(m.behaviour, `still hunting on turn ${turn}`).toBeUndefined();
      expect(["step", "wait"]).toContain(intent.kind);
    }

    const gaveUp = search(w, m);
    expect(m.behaviour).toBe("brute");
    expect(m.target).toBeUndefined();
    expect(gaveUp.kind).toBe("wait"); // brute with no target and no sight of the player
  });

  it("never wanders further than a step while searching, on 200 seeds", () => {
    const rng = new Rng(11);
    for (let i = 0; i < 200; i++) {
      const f = fromAscii(["##########", "#@..##...#", "#...##.m.#", "#........#", "##########"]);
      resetIds();
      const player = mob("player", f.player!, Faction.Player);
      const m = mob("m", f.mark("m"));
      m.target = { ...m.pos };
      const w: AiWorld = { level: f.level, entities: [player, m], player, rng, cache: new Map() };
      const intent = hunter(8)(w, m);
      if (intent.kind === "step") {
        expect(f.level.isWalkable(intent.to.x, intent.to.y)).toBe(true);
        expect(chebyshev(intent.to, m.pos)).toBe(1);
      }
    }
  });
});

describe("turret", () => {
  it("never moves, whether or not the player is in range", () => {
    const rng = new Rng(5);
    const f = fromAscii(["################", "#t..............#", "################"]);
    resetIds();
    const player = mob("player", { x: 1, y: 1 }, Faction.Player);
    const t = mob("t", f.mark("t"));
    t.range = 6;
    const w: AiWorld = { level: f.level, entities: [player, t], player, rng, cache: new Map() };

    for (let i = 0; i < 100; i++) {
      player.pos = { x: rng.int(1, f.level.width - 2), y: 1 };
      const intent = BEHAVIOURS.turret(w, t);
      expect(intent.kind).not.toBe("step");
    }
  });

  it("shoots the player at exactly its range, with a clear line", () => {
    const f = fromAscii(["#########", "#t.....@#", "#########"]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const t = mob("t", f.mark("t"));
    t.range = 6;
    const w: AiWorld = { level: f.level, entities: [player, t], player, rng: new Rng(1), cache: new Map() };

    const intent = BEHAVIOURS.turret(w, t);
    expect(intent).toEqual({ kind: "shoot", target: player });
  });

  it("does not shoot beyond its range", () => {
    const f = fromAscii(["##########", "#t......@#", "##########"]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const t = mob("t", f.mark("t"));
    t.range = 6; // distance here is 7
    const w: AiWorld = { level: f.level, entities: [player, t], player, rng: new Rng(1), cache: new Map() };

    expect(BEHAVIOURS.turret(w, t).kind).toBe("wait");
  });

  it("does not shoot through a wall, even within range", () => {
    const f = fromAscii(["#########", "#t..#..@#", "#########"]);
    resetIds();
    const player = mob("player", f.player!, Faction.Player);
    const t = mob("t", f.mark("t"));
    t.range = 6;
    const w: AiWorld = { level: f.level, entities: [player, t], player, rng: new Rng(1), cache: new Map() };

    expect(BEHAVIOURS.turret(w, t).kind).toBe("wait");
  });

  it("waits without a range set at all", () => {
    const { w, f, player } = world(["#####", "#t@.#", "#####"]);
    const t = mob("t", f.mark("t"));
    w.entities = [player, t];
    expect(BEHAVIOURS.turret(w, t).kind).toBe("wait");
  });
});

describe("static", () => {
  it("never moves and never attacks, even with the player adjacent", () => {
    const { w, f, player } = world(["#####", "#@s.#", "#####"]);
    const s = mob("s", f.mark("s"));
    w.entities = [player, s];
    expect(BEHAVIOURS.static(w, s)).toEqual({ kind: "wait" });
  });
});

describe("a turret's shot end to end", () => {
  // The "shoot" Intent shares the wire-level "attack" Command with melee (see
  // ai.ts:toCommand) — doAttack already routes every hit through dealDamage,
  // so a ranged hit needs no command of its own. What is genuinely new is the
  // legality gate, and that lives in the turret Behaviour itself (see the
  // `turret` describe block above): it only ever emits "shoot" once range and
  // line of sight are already satisfied, so an illegal shot is never even
  // attempted — this test only has to check the legal case reaches hit points.
  it("a legal shot travels Intent -> Command -> dealDamage and lands", () => {
    const game = new Game({
      seed: 7,
      content: { ...TEST_CONTENT, monstersForDepth: () => [], monsterBudget: () => 0 },
    });
    const f = fromAscii(["#########", "#t.....@#", "#########"]);
    game.level = f.level;
    game.player.pos = { ...f.player! };
    const shooter = mob("shooter", f.mark("t"), Faction.Monster);
    shooter.behaviour = "turret";
    shooter.range = 6;
    game.entities = [game.player, shooter];
    const before = game.player.hp;

    const cmd = takeAiTurn(game, shooter);
    expect(cmd).toEqual({ kind: "attack", dx: 6, dy: 0 });

    const out = perform(game, shooter, cmd);
    expect(out.ok).toBe(true);
    expect(game.player.hp).toBeLessThan(before);
  });
});
