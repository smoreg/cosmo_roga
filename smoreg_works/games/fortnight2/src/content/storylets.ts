import type { Vault, VaultContext } from "@jamrog/engine";
import type { ModuleId } from "./modules.js";
import type { Rig } from "../twist/rig.js";

/**
 * The station's storylet deck (design-doc.md, "Storylets").
 *
 * A card is content + a precondition on the run + an effect: a hand-drawn
 * compartment, the zones and the drone state that admit it, and the flags it
 * raises for the cards after it. That is the whole answer to the jam's fourth
 * criterion — the station is built out of what the run has already cost you,
 * so no hand-made level could stand in for it.
 *
 * Tile legend (engine, sim/mapgen/vaults.ts):
 *   '#' wall · '.' floor · '+' door · '%' rubble (walkable) · '|' sealed bulkhead
 *   '?' leave whatever is already there — used on the corners so a card blends
 *       into the sector instead of sitting in it as a box
 *
 * Marker legend (this game, read by src/systems/populate.ts):
 *   'm' one machine of the deck's band
 *   'M' the heaviest machine of the deck's band
 *   'X' a parts crate: the card's module at full integrity, drawn 'X'
 *   'w' scrap: the card's module at integrity 1-2, drawn '%'
 *
 * 'w' rather than '%' for scrap because '%' is already the rubble tile above:
 * a card that wants both decorative rubble and a salvage pile needs two chars.
 *
 * Every card is at most 9x5. A sector is never smaller than 12x8 and stamping
 * happens one tile inside its frame, so a card of that size always fits — which
 * is what makes "deck 1 always has a docking bay" a guarantee and not a hope.
 */

// ------------------------------------------------------------------ helpers

function rigOfCtx(ctx: VaultContext): Rig | undefined {
  return ctx.player?.data?.rig as Rig | undefined;
}

/** Did this module already burn out this run? False before the drone exists. */
export function burned(ctx: VaultContext, kind: ModuleId): boolean {
  return rigOfCtx(ctx)?.burned.includes(kind) ?? false;
}

/** How many slots the drone has nothing in — the room it has for salvage. */
export function emptySlots(ctx: VaultContext): number {
  const rig = rigOfCtx(ctx);
  if (!rig) return 0;
  return rig.slots.reduce((n, s) => (s === null ? n + 1 : n), 0);
}

/** How badly the run has gone so far, in modules lost. */
export function burnedCount(ctx: VaultContext): number {
  return rigOfCtx(ctx)?.burned.length ?? 0;
}

/**
 * Which module a card's 'X' and 'w' markers yield. A card missing from here
 * rolls a random one — a crate in a cargo bay is a lottery, a sensor closet is
 * not.
 */
export const CARD_MODULE: Readonly<Partial<Record<string, ModuleId>>> = {
  "docking bay": "welder",
  "sensor closet": "scanner",
  "charging alcove": "welder",
  "thruster bay": "thrusters",
  "security checkpoint": "cell",
  "quarantine ward": "plating",
  "reactor antechamber": "cell",
  "armory locker": "laser",
  "containment locker": "emp",
};

// -------------------------------------------------------------------- cards

/**
 * Deck 1, always. The onboarding level, taught by construction: one weak
 * machine across the bay and one salvage pile near where the drone lands, so
 * the first two things a player ever does are a fight and a `g`.
 */
const DOCKING_BAY: Vault = {
  name: "docking bay",
  rows: [
    "?##...##?",
    "#....m..#",
    "#.w.....#",
    "#.......#",
    "?##...##?",
  ],
  zones: ["docking"],
  when: (ctx) => ctx.depth === 1,
  weight: 1000,
};

/**
 * Every compartment the station kept stock in — which is every one of them but
 * the two the run pivots on. The docking bay and the reactor each have a card
 * that must be there, and a card that is guaranteed cannot have a rival.
 */
const WORKING_COMPARTMENTS = [
  "cargo", "corridor", "storage", "maintenance", "hab", "mess", "hydroponics",
  "med", "lab", "quarantine", "engineering", "workshop", "armory", "control", "coreaccess",
];

/**
 * The plain one, and the reason no compartment is ever empty of choices: it is
 * what every other card competes against. Worth much more when the rack has
 * room to put its contents.
 */
const SPARE_PARTS_CRATE: Vault = {
  name: "spare parts crate",
  rows: [
    "?#####?",
    "#..X..#",
    "+.....+",
    "#.....#",
    "?#####?",
  ],
  zones: WORKING_COMPARTMENTS,
  weight: 3,
  // The one card allowed to repeat on a deck. Anything capped at one per level
  // stops being competition for the rest of the deck the moment it is spent,
  // and a deck where the last compartments have no real choice left is a deck
  // whose storylets stopped reacting to the run.
  maxPerLevel: 3,
  weightWhen: (ctx) => (emptySlots(ctx) >= 2 ? 3 : 1),
};

/** The station answering a burned-out scanner with the one thing that fixes it. */
const SENSOR_CLOSET: Vault = {
  name: "sensor closet",
  rows: [
    "?#####?",
    "#.X...#",
    "#...w.#",
    "#.....#",
    "?##+##?",
  ],
  zones: ["maintenance", "lab", "control", "corridor"],
  minDepth: 2,
  weightWhen: (ctx) => (burned(ctx, "scanner") ? 7 : 1),
};

/** A welder: the run's only way back up, so it turns up once things start burning. */
const CHARGING_ALCOVE: Vault = {
  name: "charging alcove",
  rows: [
    "?#####?",
    "#..X..#",
    "#.w...#",
    "#.....#",
    "?##.##?",
  ],
  zones: ["hab", "mess", "engineering", "workshop"],
  minDepth: 3,
  weightWhen: (ctx) => (burnedCount(ctx) >= 1 ? 3 : 1),
};

/**
 * Two heavy machines and a bulkhead panel. The panel is decor until the CELL
 * can cut it: the sector repair pass may carve it open, and nothing here
 * depends on it staying shut.
 */
const SECURITY_CHECKPOINT: Vault = {
  name: "security checkpoint",
  rows: [
    "?#######?",
    "#..M....#",
    "+...|...+",
    "#....M..#",
    "?#######?",
  ],
  zones: ["corridor", "control", "armory", "engineering"],
  minDepth: 2,
  weight: 2,
};

/** Deck 4's set piece. What it raises steers the lockers deeper down. */
const QUARANTINE_WARD: Vault = {
  name: "quarantine ward",
  rows: [
    "?#####?",
    "#.M.X.#",
    "#.....#",
    "#.....#",
    "?#+#+#?",
  ],
  zones: ["quarantine", "med"],
  minDepth: 4,
  weight: 4,
  sets: ["quarantine"],
};

/** Deck 6, always: the last room before the hatch, and something standing in it. */
const REACTOR_ANTECHAMBER: Vault = {
  name: "reactor antechamber",
  rows: [
    "?#######?",
    "#%.....%#",
    "+...M...+",
    "#%.....%#",
    "?#######?",
  ],
  zones: ["reactor"],
  minDepth: 6,
  when: (ctx) => ctx.depth === 6,
  weight: 1000,
};

/** Ours: a stripped drone bay. Speed is the first thing a run misses. */
const THRUSTER_BAY: Vault = {
  name: "thruster bay",
  rows: [
    "?#####?",
    "#w...w#",
    "#..X..#",
    "#.....#",
    "?##.##?",
  ],
  zones: ["docking", "maintenance", "workshop"],
  minDepth: 2,
  weightWhen: (ctx) => (burned(ctx, "thrusters") ? 4 : 1),
};

/** Ours: the best weapon in the game, with the reason it is still there. */
const ARMORY_LOCKER: Vault = {
  name: "armory locker",
  rows: [
    "?#####?",
    "#..X..#",
    "#.....#",
    "#.M...#",
    "?##.##?",
  ],
  zones: ["armory", "engineering"],
  minDepth: 5,
  weight: 3,
  sets: ["armed"],
};

/** Ours: the deck-4 ward pays off here — quarantine stock, still sealed. */
const CONTAINMENT_LOCKER: Vault = {
  name: "containment locker",
  rows: [
    "?#####?",
    "#.X.w.#",
    "#.....#",
    "+.....#",
    "?#####?",
  ],
  zones: ["control", "coreaccess", "lab"],
  minDepth: 5,
  weightWhen: (ctx) => (ctx.flags.has("quarantine") ? 4 : 1),
};

/** The library handed to every sector of every deck. */
export const STORYLETS: readonly Vault[] = [
  DOCKING_BAY,
  SPARE_PARTS_CRATE,
  SENSOR_CLOSET,
  CHARGING_ALCOVE,
  SECURITY_CHECKPOINT,
  QUARANTINE_WARD,
  REACTOR_ANTECHAMBER,
  THRUSTER_BAY,
  ARMORY_LOCKER,
  CONTAINMENT_LOCKER,
];
