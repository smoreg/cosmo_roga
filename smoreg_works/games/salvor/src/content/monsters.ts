import type { MonsterKind } from "@jamrog/engine";
import { tId } from "../i18n.js";
import type { ModuleId } from "./modules.js";

/**
 * Every enemy here is a machine, so every kill leaves one module worth taking.
 * The engine knows nothing about `salvage`: it carries `MonsterKind` around and
 * the twist looks the extra field up by name when the machine dies.
 */
export interface Machine extends MonsterKind {
  /** Module the wreck yields, at scrap integrity. Omit for a machine with nothing to take. */
  salvage?: ModuleId;
}

/**
 * The four machines a hull class brings and the depth band does not.
 *
 * `weight: 0` is the whole of that: they are in the table, so a card asking for
 * one by id finds it (`m:sentry-turret`, `m:bloom` — `systems/populate.ts`
 * searches the catalogue, and a machine outside it simply does not spawn), and
 * the weighted roll can never produce one. design-doc.md, "Типы дереликтов",
 * puts `t` on a military hull, `j` on a laboratory or a smuggler and `z` `Y`
 * behind quarantine seals only; a shared band would scatter crawlers through
 * the tutorial freighter, which is the opposite of what they are for. Per-hull
 * bands are G25's; until then the deck is what puts these four aboard, and it
 * puts them exactly where the fiction does.
 *
 * Each asks the rack a question the eight below do not. `t` never moves and
 * shoots through the door you left open, so the answer is a turn spent closing
 * it or a way around. `j` turns the rack off while it stands next to you: the
 * one machine that has to be killed before anything else can be spent. `z` is
 * `corrosive` — PLATING is not in its chain — and leaves no module, so a fight
 * with one is pure loss and walking away is the play. `Y` does not fight at
 * all; it hatches, and the clock it starts is the reason to spend the turns.
 *
 * They break the cold palette on purpose: the biology pair is the one warm-
 * green family aboard, because "this is not a machine, plating will not help"
 * has to be readable off the schematic before the first hit lands.
 */
export const SENTRY_TURRET: Machine = {
  id: "sentry-turret", name: "sentry turret", ch: "t", fg: "#2f97b8", hp: 5, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 7, behaviour: "turret", range: 1, sight: 1, minDepth: 2, maxDepth: 6, weight: 0, salvage: "emitter",
};

export const JAMMER: Machine = {
  id: "jammer", name: "jammer", ch: "j", fg: "#c46fbf", hp: 5, damage: [1, 2, 0], defense: 0, speed: 90, fovRadius: 5, behaviour: "coward", sight: 0, minDepth: 2, maxDepth: 6, weight: 0, salvage: "cell",
};

export const CRAWLER: Machine = {
  id: "crawler", name: "crawler", ch: "z", fg: "#8fae4f", hp: 3, damage: [1, 3, 0], defense: 0, speed: 130, fovRadius: 6, behaviour: "pack", tags: ["corrosive"], sight: 0, minDepth: 2, maxDepth: 6, weight: 0,
};

/**
 * The hatchery. `damage` is zeroes rather than a die because it never swings:
 * `static` asks for nothing every turn, and everything it does to the run is
 * done from the outside by `systems/bloom.ts`. Speed 100 is what makes "every
 * six of its turns" read as six of the drone's.
 */
export const BLOOM_KIND: Machine = {
  id: "bloom", name: "bloom", ch: "Y", fg: "#c3d96f", hp: 8, damage: [0, 0, 0], defense: 0, speed: 100, fovRadius: 1, behaviour: "static", sight: 0, minDepth: 2, maxDepth: 6, weight: 0,
};

/**
 * The bestiary of this game — design-doc.md, "Машины". The numbers are v2's;
 * what the move to compartments added is the two columns a graph needs:
 * `sight` (0 sees its own room, 1 also sees the next one through an open door)
 * and `keen` (sees a drone in cover). `fovRadius` stays because `MonsterKind`
 * carries it for the grid game; nothing on a ship reads it.
 *
 * Each machine asks the rack a different question. `c` teaches the loop and is
 * the only thing awake at the docking end: it is the weakest machine in the
 * table and the one that comes looking, which is what makes the first fight
 * happen at all rather than depend on the drone walking into a slow patrol.
 * `m` and `d` take over one door deeper, `S` and `H` force the choice between
 * spending the CUTTER and walking around another way, `w` makes the chase cost
 * THRUSTERS, and the two tagged machines break the routing rule the player just
 * learned: `precise` skips the exposed slot for the weakest one, `burst` skips
 * PLATING entirely.
 *
 * Colours are cold and pairwise separated in lightness as well as in hue: the
 * schematic is read at a glance, and two machines that look alike are two
 * machines the player will misjudge.
 *
 * The four weightless ones go last, and they have to: `kindsForDepth` keeps
 * this order, and both weighted rolls that read it walk the list adding
 * weights, so a zero at the end can never be reached and never shifts which
 * machine a seed picks. `M` (the heaviest of a band) reads the same order and
 * keeps the first of a tie, which is why none of the four out-weighs what its
 * band already had.
 */
export const MONSTERS: Machine[] = [
  { id: "maintenance-bot", name: "maintenance bot", ch: "m", fg: "#9aa5b1", hp: 4, damage: [1, 2, 0], defense: 0, speed: 80, fovRadius: 5, behaviour: "brute", sight: 0, minDepth: 2, maxDepth: 3, weight: 10, salvage: "plating" },
  { id: "feral-drone", name: "feral drone", ch: "d", fg: "#4fd0c0", hp: 3, damage: [1, 3, 0], defense: 0, speed: 150, fovRadius: 7, behaviour: "pack", sight: 0, minDepth: 2, maxDepth: 4, weight: 10, salvage: "thrusters" },
  { id: "scout", name: "scout", ch: "c", fg: "#7fb2ff", hp: 3, damage: [1, 2, 0], defense: 0, speed: 120, fovRadius: 10, behaviour: "stalker", sight: 1, keen: true, minDepth: 1, maxDepth: 6, weight: 8, salvage: "scanner" },
  { id: "security-unit", name: "security unit", ch: "S", fg: "#3f6fbf", hp: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 8, behaviour: "brute", sight: 1, minDepth: 2, maxDepth: 6, weight: 8, salvage: "cutter" },
  { id: "welder-bot", name: "welder bot", ch: "w", fg: "#6fbf5f", hp: 6, damage: [1, 3, 0], defense: 0, speed: 90, fovRadius: 6, behaviour: "coward", sight: 0, minDepth: 3, maxDepth: 6, weight: 8, salvage: "welder" },
  { id: "hauler", name: "hauler", ch: "H", fg: "#46587e", hp: 14, damage: [1, 5, 0], defense: 0, speed: 60, fovRadius: 5, behaviour: "brute", sight: 0, minDepth: 4, maxDepth: 6, weight: 4, salvage: "plating" },
  { id: "scrapper", name: "scrapper", ch: "x", fg: "#a98fe0", hp: 6, damage: [1, 3, 0], defense: 0, speed: 110, fovRadius: 8, behaviour: "pack", tags: ["precise"], sight: 1, minDepth: 4, maxDepth: 6, weight: 8, salvage: "emp" },
  { id: "arc-sentinel", name: "arc sentinel", ch: "A", fg: "#d7ecff", hp: 10, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 9, behaviour: "brute", tags: ["burst"], sight: 1, keen: true, minDepth: 5, maxDepth: 6, weight: 3, salvage: "laser" },
  SENTRY_TURRET,
  JAMMER,
  CRAWLER,
  BLOOM_KIND,
];

/**
 * The alert's hunter, and the one machine no roll ever produces: it is aboard
 * only because the ship decided to look for you (design-doc.md, "Тревога,
 * охотники и как спрятаться"). Hence a const of its own rather than a row in
 * the table — `kindsForDepth` must never offer it — and hence bands that cover
 * the whole ship: it arrives where it is sent.
 *
 * `hunter` walks to the compartment the drone was last seen or heard in and
 * searches it; `breacher` makes a locked bulkhead three turns and a shriek
 * rather than a wall; `keen` means cover alone is not enough. The one warm
 * glyph in a cold table, because it is the one thing that is coming for you.
 *
 * G30 took it from 12 hp and 1d4+2 to 10 and 1d3+1. Everything else about it
 * stands: what the pass measured is that the ship *always* sends it on the
 * tutorial hull, because bringing a system online is worth +2 on the gauge and
 * the second one therefore reaches three by the rule. That makes the hunter the
 * price of neutralising the first freighter rather than the answer to a run of
 * bad play, and 1d4+2 `precise` against a starting rack is not a price, it is
 * the end of the voyage: on 32 seeds it took the drone from a full rack to a
 * dead core inside twenty turns. At 1d3+1 the same fight is winnable with a
 * cutter still on the rack and lost without one, which is the decision it is
 * supposed to be asking about.
 *
 * The third pass took the last `+1` off too, and it is the single largest
 * number in this game. `precise` means every point of it lands on the weakest
 * module on the rack, so 2-4 a swing against 1-3 is a third of a rack over one
 * fight. Measured on 32 seeds with nothing else changed: compartments walked
 * 13.5 → 17, the median voyage 127 → 149 turns, what a voyage banks
 * 29.3 → 38.7 CR, and the first sortie's repayment of its hull 63 % → 75 %.
 * What it does not change is what the hunter is for: 10 hp of `precise`
 * `breacher` `keen` is still the one thing aboard that comes looking, opens
 * what the drone welded shut, and finds it in cover.
 */
export const ENFORCER: Machine = {
  id: "enforcer", name: "enforcer", ch: "E", fg: "#d9705a", hp: 10, damage: [1, 3, 0], defense: 0, speed: 120, fovRadius: 8, behaviour: "hunter", range: 1, tags: ["precise"], sight: 1, keen: true, breacher: true, minDepth: 0, maxDepth: 99, weight: 0, salvage: "emitter",
};

/** Everything that can be aboard, including what only the alert sends. */
const ABOARD: readonly Machine[] = [...MONSTERS, ENFORCER];

/** Machines legal this deep into a ship. Depth is doors from the airlock. */
export function kindsForDepth(depth: number): MonsterKind[] {
  return MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth);
}

/**
 * The kind behind a spawned entity. An entity only carries its name, and that
 * is enough: names are unique in the table above.
 */
export function machineByName(name: string): Machine | undefined {
  return ABOARD.find((m) => m.name === name);
}

/**
 * What the screen calls a machine.
 *
 * `MonsterKind.name` is an identity in this game — `machineByName` is how a
 * spawned entity finds its row, and the engine carries the name around inside
 * `Entity` — so the catalogue's English stays put and the display goes through
 * here. A name the catalogue does not know comes back unchanged: the rival's
 * drone and a sortie's ghost are named by the systems that make them.
 */
export function machineName(name: string): string {
  const kind = machineByName(name);
  if (kind !== undefined) return tId("machine", kind.id, kind.name);
  // A machine the catalogue never held: the rival's drone and a sortie's ghost
  // are spawned by their own systems and named there. They still get a row,
  // found under the name with its spaces closed up — `machine.rival-drone`.
  return tId("machine", name.replace(/ /g, "-"), name);
}

/**
 * The same, by id — and it answers for the machines no depth band offers.
 *
 * `kindsForDepth` is the roll, and the ENFORCER is deliberately outside it: it
 * is aboard because the ship sent it. The father's tug is the one hull whose
 * own band names it (design-doc.md, "Типы дереликтов"), so this is how
 * `systems/populate.ts` finds one without making it rollable anywhere else.
 */
export function machineAboard(id: string): Machine | undefined {
  return ABOARD.find((m) => m.id === id);
}

/**
 * The engine's own per-compartment roll, switched off — and it has to be a
 * function that answers zero rather than a missing one, because
 * `RoomContentPack` requires the field.
 *
 * `RoomGame.populate()` runs before a single card mark has been executed, so it
 * cannot know how many machines the deck is about to place: a chance per room
 * and a deck that also places machines are two spawners that never see each
 * other, and they add up. That is the defect the v3-core gate measured
 * (`docs/tasks/G38-*.md`) — twelve to fifteen machines over twelve to fourteen
 * compartments on the tutorial freighter, three of them one door from the
 * airlock. There is one budget per ship now, `DerelictSpec.machines`, and
 * `systems/populate.ts` is the only thing that spends it.
 *
 * `0.3 + 0.1 × depth` is not lost: it is what the freighter's budget was chosen
 * against, and design-doc.md, "Машины" still describes the shape the filler
 * gives a ship — shallow compartments empty, deep ones held.
 */
export function monsterChance(): number {
  return 0;
}

/**
 * The ceiling no class's budget may cross, whatever its own numbers say
 * (design-doc.md, "Машины": at most eight aboard). Still handed to the pack as
 * `maxMonsters`, where it now guards nothing — the engine places none — and
 * still what clamps `DerelictSpec.machines` in `systems/populate.ts`.
 */
export const MAX_MACHINES = 8;

/**
 * The most machines one compartment holds: never a fourth where three stand.
 * The muster between sorties, the ladder's wakes, the hunter and a machine
 * walking in all stop at it — the fourth waits in the next compartment — so
 * a fight is a doorway and not a pile, and the contacts block is never a
 * list of seven (docs/tasks/G83-anonymous-blows.md, 4). One number, read by
 * `systems/populate.ts` and `systems/alert.ts`.
 */
export const CROWD = 3;
