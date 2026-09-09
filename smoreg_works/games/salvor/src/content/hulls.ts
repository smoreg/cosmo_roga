import { tId } from "../i18n.js";
import { STARTING_MODULES, moduleKind, type ModuleId } from "./modules.js";
import type { Slot } from "../twist/rig.js";

/**
 * The three drones a voyage can buy, as data (design-doc.md, "Три корпуса
 * дрона").
 *
 * A **ladder**, not three side-grades. The owner's words: «давай более дорогие
 * дроны лучше, а не разные классы — иначе деньги не несут смысла и после
 * первого корабля надо сразу лететь на третий», and the review had already
 * measured the same thing from the other end: the bot bought the cheapest hull
 * 434 times out of 434, because a SPARK could raise none of a ship's three
 * systems and a GHOST only one.
 *
 * The ladder runs on the **chassis**, not on the tools: every hull comes off the
 * rails with the same five modules, and what the price buys is *room and life* —
 * more slots for what the drone brings home, and a point or two more core. The
 * owner settled it in one line: «дорогие дроны имеют больше слотов и чуть
 * больше ядра, всё вроде складывается».
 *
 * That is the better axis for this game and not only the cheaper one. A slot is
 * where salvage goes, so a dearer drone is worth exactly as much as the ship you
 * are standing on has to give — and the core is the twist's own clock: three
 * mistakes on a SCRAPPER, five on a GHOST, never healed on either.
 *
 * The type import is erased at build time: this file describes what a drone is
 * sold as, it does not reach into the rack. Bolting the slots together is
 * `systems/voyage.ts`, which is the half that owns the account they are paid
 * for out of.
 */

export type HullId = "scrapper" | "spark" | "ghost";

export interface HullKind {
  readonly id: HullId;
  /** English name, upper case. The screen asks `hullName`; this is its fallback. */
  readonly name: string;
  /** Credits off the account. Nothing about a hull is ever paid twice. */
  readonly price: number;
  /** The five it comes with. The sixth slot is empty: it is the second resource. */
  readonly modules: readonly ModuleId[];
  /** Integrity this hull's own copy of a module has, where it beats the catalogue. */
  readonly base?: Readonly<Partial<Record<ModuleId, number>>>;
  /** Speed this hull's THRUSTERS give, where it beats the catalogue's 100. */
  readonly speed?: number;
  /**
   * Slots on the rack. The five a hull comes with fill the first of them; the
   * rest are empty, and empty slots are the second resource — where what the
   * drone finds aboard a hull goes (design-doc.md, "Стойка").
   */
  readonly slots: number;
  /** Core points. Never healed, and three mistakes used to be every drone. */
  readonly core: number;
  /** English of the one line that says what makes it different: see `hullTrait`. */
  readonly trait: string;
}

/**
 * The cheap one, and the one every voyage starts with.
 *
 * Its rack is `STARTING_MODULES` (`content/modules.ts`) rather than the
 * design-doc's WELDER: the rack a run starts with and the rack 40 CR buys have
 * to be the same one, and the SCANNER is what the rest of the game — the
 * schematic, the letters, the auto-explore — is written against. Swapping the
 * SCANNER for the WELDER is this one line, and the day it happens the drone
 * starts blind on purpose.
 *
 * Its PLATING keeps the two points over the catalogue the design document gives
 * it; both numbers moved together in G30's pass (9→13 and 11→16), for the
 * reason written out in `content/modules.ts`.
 *
 * The price is the document's 40. It used to be the wrong way round against
 * the rack — the hold paid `4 + 2` a point, so five stock modules sold for 78 CR
 * and a run that kept losing drones kept making money. G41 closed that: the
 * hold pays a flat 4 CR a module whatever its integrity (`MODULE_PER_POINT = 0`
 * in `systems/voyage.ts`), the rack is 20 CR against a 40 CR hull, and the loss
 * condition is reachable again. Nothing about this price needs fixing.
 */
export const SCRAPPER: HullKind = {
  id: "scrapper",
  name: "SCRAPPER",
  price: 40,
  modules: STARTING_MODULES,
  base: { plating: 16 },
  slots: 6,
  core: 3,
  trait: "6 slots, core 3",
};

/**
 * The middle rung: the same five modules, two points sturdier apiece, quicker,
 * a seventh slot and a fourth point of core.
 */
export const SPARK: HullKind = {
  id: "spark",
  name: "SPARK",
  price: 90,
  modules: STARTING_MODULES,
  base: { cutter: 13, thrusters: 14, scanner: 10, plating: 18, cell: 10 },
  speed: 120,
  slots: 7,
  core: 4,
  trait: "7 slots, core 4",
};

/**
 * The top rung: eight slots, five points of core, and every module five points
 * sturdier than the catalogue.
 *
 * A hundred and sixty against forty is four cheap drones, and that is meant to
 * be a real question on the second hull: one that lasts and carries what it
 * finds, or three that do not.
 */
export const GHOST: HullKind = {
  id: "ghost",
  name: "GHOST",
  price: 160,
  modules: STARTING_MODULES,
  base: { cutter: 16, thrusters: 17, scanner: 13, plating: 24, cell: 13 },
  speed: 140,
  slots: 8,
  core: 5,
  trait: "8 slots, core 5",
};

/** In the order the DOCK lists them: cheapest first. */
export const HULLS: readonly HullKind[] = [SCRAPPER, SPARK, GHOST];

/** What a voyage undocks with, and what it starts the account at. */
export const STARTING_HULL: HullKind = SCRAPPER;
export const STARTING_CREDITS = 25;

/**
 * The cheapest hull on the rack: the number the run is over below, and the
 * one the panel prints once the drone is gone.
 */
export const CHEAPEST_HULL: HullKind = HULLS.reduce((a, b) => (b.price < a.price ? b : a));

export function hullKind(id: string): HullKind | undefined {
  return HULLS.find((h) => h.id === id);
}

/**
 * What the DOCK calls a hull. Short on purpose in every language: the line it
 * appears in is `buy SCRAPPER (40 CR)` and the action list is 25 columns.
 */
export function hullName(hull: HullKind): string {
  return tId("hull", hull.id, hull.name);
}

/** The one line that says what makes this hull different. */
export function hullTrait(hull: HullKind): string {
  return tId("trait", hull.id, hull.trait);
}

/**
 * The rack a hull comes off the rails with: five modules at full integrity,
 * carrying whatever this hull's own copies are worth. Plain data, so the
 * catalogue never has to import the twist.
 */
/**
 * The rack the voyage's first drone is given.
 *
 * The one rack in the game that is not bought. Every hull off the rails is a
 * bare chassis — «покупной дрон приходит без модулей, надо ставить что принесёт
 * дрон с дереликта» — but a run has to start somewhere, and it starts with the
 * five modules the whole game is written against, carrying the SCRAPPER's own
 * PLATING rather than the catalogue's.
 */
export function startingSlots(): Slot[] {
  return slotsOf(STARTING_MODULES, { plating: 16 });
}

export function hullSlots(hull: HullKind): Slot[] {
  return slotsOf(hull.modules, hull.base, hull.speed);
}

/** Modules as slots, carrying whatever this rack's own copies are worth. */
function slotsOf(
  modules: readonly ModuleId[],
  base?: Readonly<Partial<Record<ModuleId, number>>>,
  speed?: number,
): Slot[] {
  return modules.map((id) => {
    const kind = moduleKind(id);
    const cap = base?.[id] ?? kind.integrity;
    const slot: Slot = { kind: id, integrity: cap };
    if (cap !== kind.integrity) slot.base = cap;
    if (kind.charges !== undefined) slot.charges = kind.charges;
    if (id === "thrusters" && speed !== undefined) slot.speed = speed;
    return slot;
  });
}
