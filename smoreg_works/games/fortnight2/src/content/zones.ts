import type { DeckPlan, Rng, ZoneKindSpec } from "@jamrog/engine";
import { STORYLETS } from "./storylets.js";

/**
 * What each deck of the station is made of (design-doc.md, "Палубы, зоны, шлюзы").
 *
 * The engine's `DeckBuilder` knows nothing about a docking bay or a reactor: it
 * asks this module for a `DeckPlan` and lays out whatever catalog comes back.
 * Everything that makes a deck feel like a place — which compartments exist,
 * how their interiors are drawn, where the drone arrives and where the hatch
 * is — is data here and nowhere else.
 */

/** A borrowed compartment is a guest on the deck, not its theme. */
const BORROWED_WEIGHT = 0.5;
/**
 * Deck 1 is where a player learns to read the station, so every compartment on
 * it is drawn at its airiest — including the ones borrowed from deck 2, which
 * are packed holds everywhere else.
 */
const AIRY_DECK = 1;
/** Corner compartments turned into hull, so a deck has a shape on the schematic. */
const HULL_CUTOUTS: [min: number, max: number] = [1, 2];
/**
 * How many compartments to take from each neighbouring deck. Two, because the
 * builder rolls up to six sectors and falls back to repeating a kind when the
 * catalog runs dry — and a deck schematic reading `CARGO ─ CARGO` is a worse
 * answer than a cargo bay that leaked one deck up.
 */
const BORROWED_PER_NEIGHBOUR = 2;
/** Sectors per deck. Below 4 a deck stops being a graph; above 6 it turns to soup. */
const DECK_SECTORS: [number, number] = [4, 6];

const DOCKING: ZoneKindSpec = { kind: "docking", name: "DOCKING BAY", interior: "open", size: 1.2, density: "sparse" };
const CARGO: ZoneKindSpec = { kind: "cargo", name: "CARGO BAY", interior: "open", size: 1.3, density: "sparse" };
const CORRIDOR: ZoneKindSpec = { kind: "corridor", name: "CORRIDOR RING", interior: "open", size: 0.8, density: "sparse" };
const STORAGE: ZoneKindSpec = { kind: "storage", name: "STORAGE", interior: "cluttered", density: "dense" };
const MAINTENANCE: ZoneKindSpec = { kind: "maintenance", name: "MAINTENANCE", interior: "cluttered", density: "dense" };
const HAB: ZoneKindSpec = { kind: "hab", name: "HAB BLOCK", interior: "rooms", density: "normal" };
const MESS: ZoneKindSpec = { kind: "mess", name: "MESS", interior: "rooms", size: 0.9, density: "normal" };
const HYDROPONICS: ZoneKindSpec = { kind: "hydroponics", name: "HYDROPONICS", interior: "open", density: "normal" };
const MED: ZoneKindSpec = { kind: "med", name: "MED BAY", interior: "rooms", density: "normal" };
const LAB: ZoneKindSpec = { kind: "lab", name: "LAB", interior: "rooms", density: "normal" };
const QUARANTINE: ZoneKindSpec = { kind: "quarantine", name: "QUARANTINE", interior: "rooms", size: 0.8, density: "normal" };
const ENGINEERING: ZoneKindSpec = { kind: "engineering", name: "ENGINEERING", interior: "cluttered", size: 1.2, density: "dense" };
const WORKSHOP: ZoneKindSpec = { kind: "workshop", name: "WORKSHOP", interior: "cluttered", density: "dense" };
const ARMORY: ZoneKindSpec = { kind: "armory", name: "ARMORY", interior: "cluttered", size: 0.8, density: "dense" };
const REACTOR: ZoneKindSpec = { kind: "reactor", name: "REACTOR", interior: "open", size: 1.5, density: "sparse" };
const CONTROL: ZoneKindSpec = { kind: "control", name: "CONTROL", interior: "rooms", density: "normal" };
const CORE_ACCESS: ZoneKindSpec = { kind: "coreaccess", name: "CORE ACCESS", interior: "rooms", size: 0.9, density: "normal" };

/** Every zone kind the station knows, for content that wants to enumerate them. */
export const ZONE_KINDS: readonly ZoneKindSpec[] = [
  DOCKING, CARGO, CORRIDOR, STORAGE, MAINTENANCE, HAB, MESS, HYDROPONICS,
  MED, LAB, QUARANTINE, ENGINEERING, WORKSHOP, ARMORY, REACTOR, CONTROL, CORE_ACCESS,
];

export interface DeckSpec {
  /** Label used by the deck schematic and by the log. */
  readonly theme: string;
  readonly zones: readonly ZoneKindSpec[];
  /** Zone kind the drone arrives in. */
  readonly entry: string;
  /** Zone kind the hatch down belongs to. */
  readonly stairs: string;
}

/**
 * The six decks, in descent order. Entry and hatch sit in different zones on
 * purpose: crossing at least one airlock is the smallest unit of "the deck was
 * a route, not a room".
 */
export const DECKS: readonly DeckSpec[] = [
  { theme: "Docking ring", zones: [DOCKING, CARGO, CORRIDOR], entry: "docking", stairs: "corridor" },
  { theme: "Cargo decks", zones: [CARGO, STORAGE, MAINTENANCE], entry: "cargo", stairs: "maintenance" },
  { theme: "Habitat", zones: [HAB, MESS, HYDROPONICS], entry: "hab", stairs: "hydroponics" },
  { theme: "Medical", zones: [MED, LAB, QUARANTINE], entry: "med", stairs: "lab" },
  { theme: "Engineering", zones: [ENGINEERING, WORKSHOP, ARMORY], entry: "engineering", stairs: "workshop" },
  // Deck 6: the hatch in the reactor is the win condition, so it is pinned.
  { theme: "Reactor", zones: [REACTOR, CONTROL, CORE_ACCESS], entry: "control", stairs: "reactor" },
];

function deckSpec(depth: number): DeckSpec {
  return DECKS[Math.max(1, Math.min(DECKS.length, depth)) - 1]!;
}

/**
 * The plan for one deck: its own three compartments plus one borrowed from the
 * deck above and one from the deck below.
 *
 * The borrowed pair is what keeps the station reading as one structure rather
 * than six unrelated tilesets — and it is also what stops the builder from
 * having to repeat a kind when it rolls six sectors.
 */
export function deckPlan(depth: number, rng: Rng): DeckPlan {
  const deck = deckSpec(depth);
  const zones: ZoneKindSpec[] = [...deck.zones];

  for (const side of [depth - 1, depth + 1]) {
    const neighbour = deckSpec(side);
    if (neighbour === deck) continue;
    const pool = neighbour.zones.filter((z) => !zones.some((c) => c.kind === z.kind));
    for (let i = 0; i < BORROWED_PER_NEIGHBOUR && pool.length > 0; i++) {
      const picked = rng.pick(pool);
      pool.splice(pool.indexOf(picked), 1);
      zones.push({ ...picked, weight: BORROWED_WEIGHT });
    }
  }

  return {
    zones: depth <= AIRY_DECK ? zones.map((z) => ({ ...z, density: "sparse" as const })) : zones,
    count: DECK_SECTORS,
    hullCutouts: rng.int(HULL_CUTOUTS[0], HULL_CUTOUTS[1]),
    entryIn: deck.entry,
    stairsIn: deck.stairs,
    vaults: STORYLETS,
    vaultsPerZone: 1,
  };
}
