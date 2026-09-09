import { Faction, makeEntity, type Entity } from "../sim/entity.js";
import type { Point } from "../sim/grid.js";
import type { ContentPack, MonsterKind } from "../content/kinds.js";

/**
 * A content pack for engine tests. Deliberately dull: three monsters with round
 * numbers, so a failing engine test points at the engine and not at whichever
 * game happened to be imported.
 *
 * Games must never ship this — it exists so `packages/engine` has no dependency
 * on anything in `games/`.
 */
export const TEST_MONSTERS: MonsterKind[] = [
  { id: "grunt",  name: "grunt",  ch: "g", fg: "#888", hp: 6,  damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 6, behaviour: "brute",  minDepth: 1, maxDepth: 99, weight: 10 },
  { id: "runner", name: "runner", ch: "r", fg: "#8a8", hp: 4,  damage: [1, 3, 0], defense: 0, speed: 150, fovRadius: 8, behaviour: "pack",   minDepth: 2, maxDepth: 99, weight: 5 },
  { id: "brick",  name: "brick",  ch: "B", fg: "#a86", hp: 20, damage: [1, 6, 1], defense: 2, speed: 70,  fovRadius: 5, behaviour: "brute",  minDepth: 3, maxDepth: 99, weight: 3 },
];

export function makeTestPlayer(pos: Point): Entity {
  return makeEntity({
    name: "you", ch: "@", fg: "#fff", pos: { ...pos }, faction: Faction.Player,
    hp: 20, hpMax: 20, damage: [1, 6, 1], defense: 1, speed: 100, fovRadius: 8, tags: [],
  });
}

export const TEST_CONTENT: ContentPack = {
  name: "engine test dungeon",
  maxDepth: 8,
  makePlayer: makeTestPlayer,
  monstersForDepth: (depth) => TEST_MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth),
  monsterBudget: (depth) => 4 + depth,
  openingLine: "Test run begins.",
};
