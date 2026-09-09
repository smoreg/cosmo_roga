import { tId } from "../i18n.js";

/**
 * The strains of the ship's virus, as data.
 *
 * One virus with one behaviour was the whole mechanic until the owner asked for
 * a family of them: «я хочу разные вирусы с разными эффектами — что-то с
 * деньгами, что-то пытается захватить дрона, что-то ослабляет его». So a strain
 * is a row here, and `systems/virus.ts` is the machine that ticks whichever one
 * came aboard.
 *
 * The split is deliberate and it is where the extensibility lives:
 *
 *   a **strain** is data — a name, a clock, whether it crawls, and one effect
 *   with its number. Adding one is a row in this file, a name in three
 *   languages, and the strain's id on the ship classes that carry it. No code.
 *
 *   an **effect** is a verb the system knows how to perform. Four of them, and
 *   a fifth costs a row in `StrainBeat` and one case in the system's `beat`.
 *   That is the honest boundary: a new *kind* of harm is code, a new *strain*
 *   is not.
 *
 * Which strain a hull carries is the hull's own business
 * (`DerelictSpec.strains`), not a blind draw: a quarantine ship rots what you
 * take off it, a smuggler's ledger bleeds you, a corsair's leash goes for the
 * drone. A class that names none carries `spasm`, which is the virus the design
 * document describes and the one every fixture in the suite assumes.
 *
 * Plain data. No DOM, no rng, nothing from `src/systems` — safe for the twist
 * and the rules to import (`tests/purity.test.ts`).
 */

export type StrainId = "spasm" | "rot" | "leech" | "leash";

/**
 * What one beat of a strain does.
 *
 * A tagged union rather than a callback, so a strain stays readable as a table
 * and `content/` keeps importing nothing. Every number is per beat.
 */
export type StrainBeat =
  /**
   * The module twitches and is EXPOSED this turn whatever the drone did, so the
   * next blow lands where the ship chose. The original, and still the nastiest:
   * it does not damage anything, it takes away the one decision the twist is
   * built on (design-doc.md, "Вирус").
   */
  | { readonly kind: "expose" }
  /** Integrity off the module it sits in. It can burn the module out. */
  | { readonly kind: "wear"; readonly points: number }
  /** Credits off the run's account, down to nothing. */
  | { readonly kind: "skim"; readonly credits: number }
  /** A point off the drone's core, which is three points and never healed. */
  | { readonly kind: "core"; readonly points: number };

export interface Strain {
  readonly id: StrainId;
  /** English name, upper case. The panel and the log ask `strainName`. */
  readonly name: string;
  /** Turns between beats. The turn it comes aboard is turn zero. */
  readonly period: number;
  /**
   * Turns uncured before it crawls into the next intact module. Zero means it
   * stays where it was installed — a strain that eats one module has nothing to
   * gain by moving, and a strain that goes for the core does not care which
   * module it is sitting in.
   */
  readonly spread: number;
  readonly beat: StrainBeat;
}

/**
 * The spasm: eight turns, then the module is exposed whatever you did, and it
 * crawls after twenty. Every number is the design document's, and it is the
 * default for any hull that names no strain of its own.
 */
export const SPASM: Strain = {
  id: "spasm",
  name: "SPASM",
  period: 8,
  spread: 20,
  beat: { kind: "expose" },
};

/**
 * Rot: it eats the module it lives in, a point at a time, and never moves. The
 * cheapest strain to survive and the most expensive to ignore — left alone it
 * burns the module out, and a burned module takes the rot with it, which is a
 * real if costly way to be rid of it.
 */
export const ROT: Strain = {
  id: "rot",
  name: "ROT",
  period: 5,
  spread: 0,
  beat: { kind: "wear", points: 1 },
};

/**
 * The leech: it reads the account rather than the rack. Nothing about the drone
 * changes, and the run gets poorer every dozen turns — which makes it the one
 * strain that punishes *taking your time*, and the only thing in the game that
 * spends credits without asking.
 */
export const LEECH: Strain = {
  id: "leech",
  name: "LEECH",
  period: 12,
  spread: 0,
  beat: { kind: "skim", credits: 5 },
};

/**
 * The leash: it goes for the drone itself. Three beats is three of the core's
 * three points, so a leash uncured is a dead drone on a clock — the one strain
 * you drop everything for, and the reason the WELDER is worth a slot.
 *
 * Eighteen turns a beat, which is over fifty for the whole drone: long enough
 * that a sortie can be finished and a bench reached, short enough that it can
 * never be forgotten. It was twelve, and at twelve the balance harness lost the
 * father's hull outright (`tests/balance.test.ts`, "arrives with something").
 */
export const LEASH: Strain = {
  id: "leash",
  name: "LEASH",
  period: 18,
  spread: 0,
  beat: { kind: "core", points: 1 },
};

/** In no particular order: nothing reads this as a sequence. */
export const STRAINS: readonly Strain[] = [SPASM, ROT, LEECH, LEASH];

/** What a hull with no strains of its own carries. */
export const DEFAULT_STRAIN: StrainId = SPASM.id;

export function strainOf(id: string | undefined): Strain {
  return STRAINS.find((s) => s.id === id) ?? SPASM;
}

/** What the panel and the log call it: `strain.rot`, falling back to English. */
export function strainName(strain: Strain): string {
  return tId("strain", strain.id, strain.name);
}
