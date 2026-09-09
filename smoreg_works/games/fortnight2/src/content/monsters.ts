import type { MonsterKind } from "@jamrog/engine";
import type { ModuleId } from "./modules.js";

/**
 * Every enemy here is a machine, so every kill leaves one module worth taking.
 * The engine knows nothing about `salvage`: it carries `MonsterKind` around and
 * the twist looks the extra field up by name when the machine dies.
 */
export interface Machine extends MonsterKind {
  /** Module the wreck yields, at integrity 1–2. Omit for a machine with nothing to take. */
  salvage?: ModuleId;
}

/**
 * The bestiary of this game — design-doc.md, "Машины (враги) и что с них
 * снимается". Everything about difficulty pacing lives here; tuning must never
 * require touching the engine.
 *
 * Each machine asks the rack a different question. `c` teaches the loop and is
 * the only thing awake on deck 1: it is the weakest machine in the table and
 * the one that comes looking, which is what makes the first fight happen at
 * all rather than depend on the player walking into a slow patrol. `m` and `d`
 * take over from deck 2, `S` and `H` force the choice between spending the
 * CUTTER and walking around, `w` makes the chase cost THRUSTERS, and the two
 * tagged machines break the routing rule the player just learned: `precise`
 * skips the exposed slot for the weakest one, `burst` skips PLATING entirely.
 *
 * Colours are cold and pairwise separated in lightness as well as in hue: the
 * map is read at a glance, and two machines that look alike are two machines
 * the player will misjudge.
 */
export const MONSTERS: Machine[] = [
  { id: "maintenance-bot", name: "maintenance bot", ch: "m", fg: "#9aa5b1", hp: 4, damage: [1, 2, 0], defense: 0, speed: 80, fovRadius: 5, behaviour: "brute", minDepth: 2, maxDepth: 3, weight: 10, salvage: "plating" },
  { id: "feral-drone", name: "feral drone", ch: "d", fg: "#4fd0c0", hp: 3, damage: [1, 3, 0], defense: 0, speed: 150, fovRadius: 7, behaviour: "pack", minDepth: 2, maxDepth: 4, weight: 10, salvage: "thrusters" },
  { id: "scout", name: "scout", ch: "c", fg: "#7fb2ff", hp: 3, damage: [1, 2, 0], defense: 0, speed: 120, fovRadius: 10, behaviour: "stalker", minDepth: 1, maxDepth: 6, weight: 8, salvage: "scanner" },
  { id: "security-unit", name: "security unit", ch: "S", fg: "#3f6fbf", hp: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 8, behaviour: "brute", minDepth: 2, maxDepth: 6, weight: 8, salvage: "cutter" },
  { id: "welder-bot", name: "welder bot", ch: "w", fg: "#6fbf5f", hp: 6, damage: [1, 3, 0], defense: 0, speed: 90, fovRadius: 6, behaviour: "coward", minDepth: 3, maxDepth: 6, weight: 8, salvage: "welder" },
  { id: "hauler", name: "hauler", ch: "H", fg: "#46587e", hp: 14, damage: [1, 5, 0], defense: 0, speed: 60, fovRadius: 5, behaviour: "brute", minDepth: 4, maxDepth: 6, weight: 4, salvage: "plating" },
  { id: "scrapper", name: "scrapper", ch: "x", fg: "#a98fe0", hp: 6, damage: [1, 3, 0], defense: 0, speed: 110, fovRadius: 8, behaviour: "pack", tags: ["precise"], minDepth: 4, maxDepth: 6, weight: 8, salvage: "emp" },
  { id: "arc-sentinel", name: "arc sentinel", ch: "A", fg: "#d7ecff", hp: 10, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 9, behaviour: "brute", tags: ["burst"], minDepth: 5, maxDepth: 6, weight: 3, salvage: "laser" },
];

export function kindsForDepth(depth: number): MonsterKind[] {
  return MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth);
}

/**
 * The kind behind a spawned entity. An entity only carries its name, and that
 * is enough: names are unique in the table above.
 */
export function machineByName(name: string): Machine | undefined {
  return MONSTERS.find((m) => m.name === name);
}

/**
 * How many machines a deck of this depth starts with, before the alert sends
 * reinforcements.
 *
 * design-doc.md says `4 + depth * 1.5`, which is 13 machines on deck 6 against
 * a rack that absorbs about eight blows: the balance harness never once got a
 * drone off deck 5. `3 + depth`, capped at eight, keeps the shape — every deck
 * busier than the last — at a density the drone can actually walk through.
 *
 * Deck 1 is the exception and stays far under the formula: one machine on top
 * of the one the docking bay card always stamps (src/content/storylets.ts), so
 * the deck the player learns on holds two scouts and nothing else.
 *
 * That is the whole of design-doc.md's "одна слабая m": the docking ring is
 * where a wreck first turns out to be a spare part, and a player still reading
 * the panel cannot learn that while being cornered. The alert at half speed
 * (80 turns, src/systems/alert.ts) is the other half of the same decision.
 */
export function monsterBudget(depth: number): number {
  if (depth === 1) return 1;
  return Math.min(3 + depth, 8);
}
