import type { MonsterKind } from "@jamrog/engine";

/** The bestiary. Difficulty tuning happens here, never in the engine. */
export const MONSTERS: MonsterKind[] = [
  { id: "rat",  name: "rat",  ch: "r", fg: "#8b7355", hp: 3, damage: [1, 3, 0], defense: 0, speed: 120, fovRadius: 5, behaviour: "stalker", minDepth: 1, maxDepth: 3, weight: 10 },
  { id: "thug", name: "thug", ch: "t", fg: "#7fa050", hp: 8, damage: [1, 5, 0], defense: 0, speed: 100, fovRadius: 7, behaviour: "brute",   minDepth: 1, maxDepth: 6, weight: 8 },
];

export function kindsForDepth(depth: number): MonsterKind[] {
  return MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth);
}

export function monsterBudget(depth: number): number {
  return 4 + Math.floor(depth * 1.5);
}
