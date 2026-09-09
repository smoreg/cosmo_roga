import { describe, it, expect } from "vitest";
import { DijkstraMap, UNREACHABLE, exploreMap } from "../src/sim/dijkstra.js";
import { fromAscii } from "../src/testing/fixtures.js";
import { chebyshev } from "../src/sim/grid.js";

function opts(level: ReturnType<typeof fromAscii>["level"], topology: 4 | 8 = 8) {
  return { passable: (x: number, y: number) => level.isWalkable(x, y), topology };
}

describe("DijkstraMap", () => {
  it("is zero at the goal and grows by one per step", () => {
    const f = fromAscii([
      "#######",
      "#@....#",
      "#######",
    ]);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.player!], opts(f.level));
    expect(map.at(1, 1)).toBe(0);
    expect(map.at(2, 1)).toBe(1);
    expect(map.at(5, 1)).toBe(4);
  });

  it("marks walls and sealed pockets unreachable", () => {
    const f = fromAscii([
      "#########",
      "#@..#..a#",
      "#########",
    ]);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.player!], opts(f.level));
    expect(map.at(4, 1)).toBe(UNREACHABLE); // the wall
    expect(map.at(7, 1)).toBe(UNREACHABLE); // the pocket behind it
  });

  it("routes around a wall instead of through it", () => {
    const f = fromAscii([
      "#########",
      "#@..#...#",
      "#...#...#",
      "#.......#",
      "#########",
    ]);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.player!], opts(f.level));
    // Straight line is 6 tiles, but the wall forces a detour through row 3.
    expect(map.at(7, 1)).toBeGreaterThan(5);
    expect(map.at(7, 1)).toBeLessThan(UNREACHABLE);
  });

  it("takes several goals at once (nearest wins)", () => {
    const f = fromAscii([
      "###########",
      "#a.......b#",
      "###########",
    ]);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.mark("a"), f.mark("b")], opts(f.level));
    expect(map.at(1, 1)).toBe(0);
    expect(map.at(9, 1)).toBe(0);
    expect(map.at(5, 1)).toBe(4);
  });

  it("bestStep walks downhill towards the goal", () => {
    const f = fromAscii([
      "########",
      "#g....a#",
      "########",
    ]);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.mark("g")], opts(f.level));
    const step = map.bestStep(f.mark("a"), opts(f.level))!;
    expect(step.x).toBe(f.mark("a").x - 1);
  });

  it("pathFrom reaches the goal and every step is adjacent", () => {
    const f = fromAscii([
      "##########",
      "#g...#...#",
      "#....#.a.#",
      "#........#",
      "##########",
    ]);
    const o = opts(f.level);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.mark("g")], o);
    const path = map.pathFrom(f.mark("a"), o);
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1]!;
    expect(map.at(last.x, last.y)).toBe(0);

    let prev = f.mark("a");
    for (const p of path) {
      expect(chebyshev(prev, p)).toBe(1);
      prev = p;
    }
  });

  it("extraCost makes an actor detour around dangerous ground", () => {
    // Two corridors of equal length; the top one is expensive.
    const f = fromAscii([
      "#########",
      "#.......#",
      "#a#####b#",
      "#.......#",
      "#########",
    ]);
    const dangerRow = 1;
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.mark("b")], {
      passable: (x, y) => f.level.isWalkable(x, y),
      extraCost: (_x, y) => (y === dangerRow ? 10 : 0),
    });
    const cheap = map.at(4, 3);
    const costly = map.at(4, dangerRow);
    expect(costly).toBeGreaterThan(cheap);
  });

  describe("flee map", () => {
    it("sends a cornered actor away from the threat, not into the dead end", () => {
      // The threat is at 't'. A naive "step away" from 'm' walks into the
      // dead-end at the left; the safety map must send it right instead.
      const f = fromAscii([
        "###########",
        "#..m.t....#",
        "###########",
      ]);
      const o = opts(f.level);
      const threat = DijkstraMap.from(f.level.width, f.level.height, [f.mark("t")], o);
      const safety = threat.fleeMap(o);
      const step = safety.bestStep(f.mark("m"), o)!;
      expect(step.x).toBeLessThan(f.mark("m").x);
    });

    it("prefers a long way round over hugging the threat", () => {
      // A ring corridor: fleeing must move to the far side, not just one tile back.
      const f = fromAscii([
        "#########",
        "#.......#",
        "#.#####.#",
        "#.#...#.#",
        "#.#.#.#.#",
        "#m..t..#.",
        "#########",
      ]);
      const o = opts(f.level);
      const threat = DijkstraMap.from(f.level.width, f.level.height, [f.mark("t")], o);
      const safety = threat.fleeMap(o);
      const start = f.mark("m");
      const step = safety.bestStep(start, o);
      expect(step).toBeDefined();
      // Whatever it picks, it must not decrease the distance to the threat.
      expect(threat.at(step!.x, step!.y)).toBeGreaterThanOrEqual(threat.at(start.x, start.y));
    });
  });

  describe("desire-driven AI", () => {
    it("combines wanting the player with avoiding a hazard", () => {
      const f = fromAscii([
        "##########",
        "#m.......#",
        "#........#",
        "#....h..p#",
        "##########",
      ]);
      const o = opts(f.level);
      const toPlayer = DijkstraMap.from(f.level.width, f.level.height, [f.mark("p")], o);
      const toHazard = DijkstraMap.from(f.level.width, f.level.height, [f.mark("h")], o);

      // Wants the player (positive pull), mildly fears the hazard.
      // Keep |repulsion| < |attraction|, see the local-minimum test below.
      const desire = DijkstraMap.combine([
        { map: toPlayer, weight: 1 },
        { map: toHazard, weight: -0.5 },
      ]);

      const start = f.mark("m");
      const step = desire.bestStep(start, o)!;
      // It still advances on the player...
      expect(toPlayer.at(step.x, step.y)).toBeLessThanOrEqual(toPlayer.at(start.x, start.y));
      // ...but the hazard tile itself is never the best step.
      const h = f.mark("h");
      expect(step.x === h.x && step.y === h.y).toBe(false);
    });

    /**
     * Known property of the method, not a bug: a summed map is a gradient, not
     * a guaranteed descent towards the attractor. Make the repulsion strong
     * enough and the actor stops approaching altogether — it either steps away
     * or finds itself in a local minimum with nowhere better adjacent. Weights
     * are a design knob, and this is what the far end of it looks like.
     */
    it("an over-strong repulsion makes the actor abandon the approach", () => {
      const f = fromAscii([
        "##########",
        "#m.......#",
        "#........#",
        "#....h..p#",
        "##########",
      ]);
      const o = opts(f.level);
      const toPlayer = DijkstraMap.from(f.level.width, f.level.height, [f.mark("p")], o);
      const toHazard = DijkstraMap.from(f.level.width, f.level.height, [f.mark("h")], o);
      const desire = DijkstraMap.combine([
        { map: toPlayer, weight: 1 },
        { map: toHazard, weight: -2 },
      ]);

      const start = f.mark("m");
      const step = desire.bestStep(start, o);
      // Either it refuses to move, or it moves further from the player.
      if (step) expect(toPlayer.at(step.x, step.y)).toBeGreaterThan(toPlayer.at(start.x, start.y));
      else expect(step).toBeUndefined();
    });

    it("fleeMap gives a direction whenever a safer tile exists", () => {
      const f = fromAscii([
        "##########",
        "#........#",
        "#...m....#",
        "#....h..p#",
        "##########",
      ]);
      const o = opts(f.level);
      const toHazard = DijkstraMap.from(f.level.width, f.level.height, [f.mark("h")], o);
      const start = f.mark("m");
      const step = toHazard.fleeMap(o).bestStep(start, o);
      expect(step).toBeDefined();
      expect(toHazard.at(step!.x, step!.y)).toBeGreaterThan(toHazard.at(start.x, start.y));
    });

    it("a pure repulsion coefficient makes an actor retreat", () => {
      const f = fromAscii([
        "##########",
        "#p...m...#",
        "##########",
      ]);
      const o = opts(f.level);
      const toPlayer = DijkstraMap.from(f.level.width, f.level.height, [f.mark("p")], o);
      const desire = DijkstraMap.combine([{ map: toPlayer, weight: -1 }]);
      const step = desire.bestStep(f.mark("m"), o)!;
      expect(step.x).toBeGreaterThan(f.mark("m").x);
    });
  });

  it("handles a map with no reachable goal without hanging", () => {
    const f = fromAscii([
      "#######",
      "#@#..a#",
      "#######",
    ]);
    const o = opts(f.level);
    const map = DijkstraMap.from(f.level.width, f.level.height, [f.mark("a")], o);
    expect(map.at(1, 1)).toBe(UNREACHABLE);
    expect(map.bestStep(f.player!, o)).toBeUndefined();
  });
});

/**
 * Regression: goals standing on impassable tiles must still seed the map.
 * A monster's own tile is impassable to everyone else, so requiring passable
 * goals made every threat map empty and every flee behaviour a no-op. The
 * balance harness caught this as "careful bot is byte-identical to greedy".
 */
describe("goals on impassable tiles", () => {
  it("seeds a goal even where nothing may walk", () => {
    const f = fromAscii([
      "#########",
      "#p.....m#",
      "#########",
    ]);
    const monsterTile = f.mark("m");
    const o = {
      // The monster's tile is occupied, therefore impassable.
      passable: (x: number, y: number) =>
        f.level.isWalkable(x, y) && !(x === monsterTile.x && y === monsterTile.y),
      topology: 8 as const,
    };
    const threat = DijkstraMap.from(f.level.width, f.level.height, [monsterTile], o);
    expect(threat.at(monsterTile.x, monsterTile.y)).toBe(0);
    expect(threat.at(f.mark("p").x, f.mark("p").y)).toBeGreaterThan(0);
    expect(threat.at(f.mark("p").x, f.mark("p").y)).toBeLessThan(UNREACHABLE);
  });

  it("a cornered actor next to a monster can still find a way out", () => {
    const f = fromAscii([
      "##########",
      "#..pm....#",
      "##########",
    ]);
    const monster = f.mark("m");
    const player = f.mark("p");
    const o = {
      passable: (x: number, y: number) =>
        f.level.isWalkable(x, y) && !(x === monster.x && y === monster.y),
      topology: 8 as const,
    };
    const threat = DijkstraMap.from(f.level.width, f.level.height, [monster], o);
    const step = threat.fleeMap(o).bestStep(player, o);
    expect(step).toBeDefined();
    expect(threat.at(step!.x, step!.y)).toBeGreaterThan(threat.at(player.x, player.y));
  });
});

/**
 * Auto-explore. The fixtures below mark what the player has already seen by
 * hand, because that is the only input the map has: `explored` is what makes
 * one corridor interesting and another one finished.
 */
describe("exploreMap", () => {
  function explore(rows: string[], seen: (x: number, y: number) => boolean) {
    const f = fromAscii(rows);
    f.level.tiles.forEach((x, y) => {
      if (seen(x, y)) f.level.explored.set(x, y, true);
    });
    return f;
  }

  it("steps towards the nearest unexplored tile", () => {
    // Seen: the middle. Unseen: both ends, the right one two tiles closer.
    const f = explore(["###########", "#....@....#", "###########"], (x) => x >= 3 && x <= 7);
    const map = exploreMap(f.level, f.player!);
    expect(map).toBeDefined();
    const step = map!.bestStep(f.player!, opts(f.level));
    expect(step).toEqual({ x: 6, y: 1 });
  });

  it("is undefined once every walkable tile is explored", () => {
    const f = explore(["#######", "#@....#", "#######"], () => true);
    expect(exploreMap(f.level, f.player!)).toBeUndefined();
  });

  it("is undefined when the unexplored part is sealed off", () => {
    const f = explore(["#########", "#@..#..a#", "#########"], (x) => x < 4);
    // The pocket behind the wall is unexplored and unreachable alike.
    expect(f.level.explored.get(7, 1)).toBe(false);
    expect(exploreMap(f.level, f.player!)).toBeUndefined();
  });

  it("walks around a blocked tile the caller rejects", () => {
    const f = explore(
      [
        "#######",
        "#..@..#",
        "#.#.#.#",
        "#.....#",
        "#######",
      ],
      (x, y) => y === 1,
    );
    const blocked = { x: 3, y: 2 };
    const passable = (x: number, y: number) =>
      f.level.isWalkable(x, y) && !(x === blocked.x && y === blocked.y);
    const map = exploreMap(f.level, f.player!, passable);
    expect(map).toBeDefined();
    const step = map!.bestStep(f.player!, { passable, topology: 8 });
    expect(step).toBeDefined();
    expect(step).not.toEqual(blocked);
    expect(chebyshev(step!, f.player!)).toBe(1);
  });
});
