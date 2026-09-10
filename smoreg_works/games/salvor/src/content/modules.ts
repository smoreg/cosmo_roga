/**
 * The eleven modules a drone can carry, as data.
 *
 * Every number here is design-doc.md's "Модули" table: integrity, what a
 * module gives while it is intact, and what the drone is left with once it
 * burns out. Balance passes change this file and nothing else — the twist in
 * src/twist/rig.ts reads these fields and owns none of the values.
 *
 * The numbers came over from tiles to compartments untouched, and two of them
 * are read differently. `sight` used to be a radius in tiles and is now "how
 * many doors deep can I see" (0 or 1), and the EMITTER's `range: 6` used to be
 * six tiles and is now "the next room through an open door" — both are the same
 * fact the table always meant, counted in the unit the ship has.
 *
 * **What the first balance pass moved, and why** (G30): CUTTER 5→7, THRUSTERS
 * 6→8, SCANNER 3→4, PLATING 9→13, CELL 4→5, WELDER 4→5, and the SCRAPPER's own
 * PLATING 11→16 with them.
 *
 * Integrity is the cost of a fight, and on a graph that cost is paid
 * differently from on a grid. A tile floor lets a drone break contact by
 * walking; a ship puts the machine in the compartment the drone has to stand in
 * to do anything at all. Measured on the shipped game: a turn of contact cost
 * about 2.5 integrity and bought about 4.5 damage back, so a rack of 29 points
 * was twelve turns of fighting — against three to five machines that all walk
 * towards the noise, plus whatever the alert sent. Every bot died on its first
 * sortie on 32 of 32 seeds, and no run ever came back to the tug with anything
 * to sell, which is the whole economy never once running.
 *
 * At 46 the same rack is a little over twenty turns of contact, which is a
 * sortie: careful flies three or four of them a voyage instead of one, stands
 * in ten compartments instead of four, and comes home. The shape of the table
 * is untouched — PLATING is still the biggest number by a wide margin, SCANNER
 * and EMP still burn first, and the SCRAPPER's trait is still "more PLATING
 * than the catalogue".
 *
 * **What the third pass moved, and why** (G30 again): CUTTER 7→11, THRUSTERS
 * 8→12, SCANNER 4→8, CELL 5→8. Four modules and not eleven, because these four
 * are the ones a *voyage* ends on rather than a fight:
 *
 *   CUTTER, THRUSTERS, SCANNER — damage, speed and sight, which is the whole of
 *   what a bot can see of its own health (`testing/roombots.ts`, `Kit`) and
 *   what a player watches the ◀ marker over. A sortie ends when two of the
 *   three are gone, and these are also the three the drone's own actions
 *   expose, so they burn whether or not anything is fighting it. Measured on
 *   32 seeds at the halfway numbers 9/10/6: compartments walked 13.5 → 17, and
 *   the first sortie repaid the hull on 75 % of seeds against 63 %.
 *
 *   CELL — the only key the reactor has for the hull every voyage starts in.
 *   It is also what the game spends on a locked bulkhead, a point a door
 *   (`systems/doors.ts`), so a drone that opened three locks on the way in
 *   reached the core with nothing left to bring it up. At 8 the core came
 *   online on 29 of 68 last-hull voyages against 19, which is most of what
 *   took this game's first win.
 *
 * PLATING was measured again in the same pass and left alone: at 16 it buys two
 * compartments and no systems, because what ends a sortie on a deep hull is
 * `burst` and `corrosive`, and PLATING is in neither chain.
 */

import { t, tId } from "../i18n.js";
import type { Key } from "./i18n/keys.js";

export type ModuleId =
  | "cutter"
  | "thrusters"
  | "scanner"
  | "plating"
  | "cell"
  | "emp"
  | "welder"
  | "laser"
  | "spike"
  | "emitter"
  | "baffle"
  | "blade"
  | "shocker"
  | "lattice";

export interface ModuleKind {
  readonly id: ModuleId;
  /**
   * The English name, always upper case — and the fallback nobody should ever
   * see. What a player reads is `moduleName(id)`, which is this row of the
   * language table; the field stays because the catalogue has to be readable
   * on its own by whoever balances it.
   */
  readonly name: string;
  /** Full integrity: how much damage it soaks before it burns out. */
  readonly integrity: number;
  /**
   * What the dock charges for one, new (`systems/voyage.ts`, the shelf).
   *
   * Not derived from integrity, because integrity is not worth: a SPIKE is
   * three points and the only thing that raises a terminal without a keycard,
   * and a PLATING is thirteen points of nothing but soak. Absent means the
   * catalogue's default — a module nobody priced is still buyable rather than
   * silently missing from the shelf.
   */
  readonly price?: number;
  /** Which key spends it. The twist implements the effects; this is the label. */
  readonly active?: string;
  /**
   * Attack dice. For a melee module the best triple in the rack becomes the
   * drone's bump damage; for the EMITTER it is what one shot rolls, read by
   * the twist and deliberately outside `derivedStats` — a shot is a command,
   * not a stat.
   */
  readonly attack?: readonly [number, number, number];
  /** How far the shot carries. 6 on a ship reads as "the next room". */
  readonly range?: number;
  /** Movement speed while intact. */
  readonly speed?: number;
  /** Rooms seen while intact: 1 = also the next one through an open door. */
  readonly sight?: 0 | 1;
  /** Starting charges for a module that spends them. */
  readonly charges?: number;
  /** Taken off the noise every action of the drone makes. */
  readonly noisePenalty?: number;
  /** Taken off how far a machine notices the drone: one door, and cover holds. */
  readonly machineFovPenalty?: number;
  /** Flat armour: taken off every blow that lands on the drone while intact. */
  readonly defense?: number;
  /**
   * A relic (design-doc.md, "Модули", G66): found in one guarded crate deep in
   * a hull and nowhere else. Four things follow, each held by a test in
   * `tests/relics.test.ts` — the dock never stocks one, no machine drops one,
   * it goes into a full rack by throwing another module out (`twist/rig.ts`,
   * `takeFor`), and nothing mends it: not the welder, not scrap, not the bench.
   * It wears out like any other slot, and that is its price.
   */
  readonly relic?: true;
  /**
   * The ordinary module this one is a better copy of. A relic with one is
   * offered into *that* slot first, taken in one press, and the module it
   * replaces goes into the drone's arms rather than into nothing.
   */
  readonly upgrades?: ModuleId;
  /**
   * The ordinary module this one answers for wherever the rules ask "is there
   * a X in the rack": a blade cuts bulkheads the way a cutter does, lattice
   * takes the plating's place in the damage chain. `findSlotAs` reads it.
   */
  readonly countsAs?: ModuleId;
}

/**
 * What is left when nothing in the rack provides the stat.
 *
 * The speed matters more than it looks. THRUSTERS are exposed on every step and
 * the drone steps four turns out of five, so they burn in every single run the
 * harness plays — and at half speed every machine aboard then acts twice per
 * drone turn. That is not a setback, it is the run ending slowly.
 */
export const BARE_CHASSIS = {
  speed: 80,
  sight: 0 as 0 | 1,
  // Ramming, once the CUTTER is gone. At 1d1 a bare drone needed fourteen
  // swings to bring down a hauler and took fourteen swings back; the CUTTER is
  // still twice this and the choice of when to spend it is still the game.
  damage: [1, 3, 0] as readonly [number, number, number],
} as const;

export const MODULES: Record<ModuleId, ModuleKind> = {
  cutter: {
    id: "cutter", name: "CUTTER", integrity: 11, price: 30,
    attack: [1, 6, 1],
  },
  thrusters: {
    id: "thrusters", name: "THRUSTERS", integrity: 12, price: 30,
    speed: 100,
  },
  scanner: {
    id: "scanner", name: "SCANNER", integrity: 8, price: 25,
    active: "s", sight: 1,
  },
  /**
   * The chain's second link, and the only one every blow passes through. It and
   * the exposed module are the whole of the drone's armour: SCANNER and CELL
   * are never exposed by a bot that only walks and swings, so in 24 of 30
   * diagnostic deaths the drone died with those two at full integrity. What
   * cannot be spent cannot save the run — so the two links that can carry it.
   */
  plating: {
    id: "plating", name: "PLATING", integrity: 13, price: 35,
  },
  cell: {
    id: "cell", name: "CELL", integrity: 8, price: 20,
    active: "p",
  },
  emp: {
    id: "emp", name: "EMP", integrity: 3, price: 25,
    active: "e", charges: 2,
  },
  welder: {
    id: "welder", name: "WELDER", integrity: 5, price: 40,
    active: "w",
  },
  laser: {
    id: "laser", name: "LASER", integrity: 4, price: 45,
    attack: [2, 4, 0],
  },
  /**
   * The three verbs a drone can have besides walking and swinging: open what
   * is locked, hit what is a room away, be missed by what is looking. None of
   * them is a bigger number — a hull is told apart by which of these it
   * carries, not by how much integrity it starts with.
   */
  spike: {
    id: "spike", name: "SPIKE", integrity: 3, price: 20,
    active: "K",
  },
  emitter: {
    id: "emitter", name: "EMITTER", integrity: 3, price: 35,
    // `range: 6` is the tile number from v2, and on a ship it reads as "the
    // next room through an open door" — the twist checks line of sight, not
    // this figure, so the two can never disagree by one.
    active: "f", attack: [1, 4, 1], range: 6,
  },
  baffle: {
    id: "baffle", name: "BAFFLE", integrity: 4, price: 25,
    noisePenalty: 3, machineFovPenalty: 3,
  },
  /**
   * The three relics (G66). No `price`: a relic is not on any shelf, and the
   * dock's default price is never asked for one — the tug's list reads
   * `relic` before it reads a price.
   *
   * The blade is the cutter's better copy: two dice where the cutter has one,
   * and it opens a bulkhead the way a cutter does (`countsAs`). The shocker is
   * an EMP with a third charge and a shorter stun that the numbered list fires,
   * because letters are the catalogue's and a relic has none. The lattice is
   * plating twice over, and the one flat point of armour in the game.
   */
  blade: {
    id: "blade", name: "Q-BLADE", integrity: 14,
    attack: [2, 6, 0], range: 0,
    relic: true, upgrades: "cutter", countsAs: "cutter",
  },
  shocker: {
    id: "shocker", name: "SHOCKER", integrity: 8,
    // Fired from the numbered list, so the label is the list's and not a key.
    active: "#", charges: 3,
    relic: true,
  },
  lattice: {
    id: "lattice", name: "LATTICE", integrity: 30, defense: 1,
    relic: true, upgrades: "plating", countsAs: "plating",
  },
};

/** Is this kind a relic? The one question four rules ask of the table. */
export function isRelic(id: ModuleId): boolean {
  return MODULES[id].relic === true;
}

/** Every relic the catalogue has, in table order. */
export const RELICS: readonly ModuleId[] = (Object.keys(MODULES) as ModuleId[]).filter(isRelic);

/**
 * Turns a machine stays seized after the shocker fires. Shorter than the EMP's
 * three, because the shocker has a charge more and never needs an empty slot.
 */
export const SHOCK_STUN_TURNS = 2;

/**
 * However quiet the drone gets, a machine standing in the same compartment
 * still has eyes. Without this floor a BAFFLE would be invisibility, and the
 * module is meant to buy a door of distance, not immunity.
 */
export const MIN_MACHINE_FOV = 2;

/**
 * How much integrity a module pulled out of a wreck still has. Never full:
 * salvage keeps the rack alive, it never restores it.
 */
export const SCRAP_INTEGRITY: readonly [number, number] = [1, 3];

/** How far past its base integrity grafting can take a module. */
export const MAX_GRAFT = 2;

/** The rack the drone undocks with: five modules and one empty slot. */
export const STARTING_MODULES: readonly ModuleId[] = ["cutter", "thrusters", "scanner", "plating", "cell"];

export function moduleKind(id: ModuleId): ModuleKind {
  return MODULES[id];
}

/**
 * What the panel, the log and the action list call a module.
 *
 * Ten characters is the column the rack is drawn in (`twist/rig.ts`), so no
 * translation of a module may be longer than that — a test holds every name in
 * all three languages to it.
 */
export function moduleName(id: ModuleId): string {
  return tId("module", id, MODULES[id].name);
}

/**
 * Said once, the turn this module burns out. One line per module, and each of
 * them names what the drone has just stopped being able to do — a burn-out is
 * the loudest thing that happens to a run, and "SCANNER: 0" is not a sentence
 * anybody feels.
 */
export function moduleBurnLine(id: ModuleId): string {
  return tId("burn", id, MODULES[id].name);
}

/**
 * Onboarding by log line, said once per run (design-doc.md, "Онбординг").
 * The panel teaches the rest by moving the ◀ marker every turn.
 *
 * One line per rule, each said the turn that rule first costs the player
 * something: a hint read before it matters is a hint nobody remembers.
 */
export const HINT_KEYS = {
  /** The first time a blow lands on a module instead of the core. */
  exposure: "hint.exposure",
  /** The first module lost, when a slot stops being an ability. */
  burned: "hint.burned",
  /** The first turn there is salvage in the room. */
  scrap: "hint.scrap",
  /** The first turn the rack has no scanner: the ship ends at this bulkhead. */
  blind: "hint.blind",
} as const satisfies Record<string, Key>;

/** `The security unit hits your CUTTER (2/4).` */
export function hitLine(source: string, kind: ModuleKind, left: number, max: number): string {
  return t("log.hit.module", { source, module: moduleName(kind.id), left, max });
}
