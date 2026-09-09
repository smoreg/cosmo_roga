import {
  buildShip,
  type CardContext,
  type DoorState,
  type GeneratedShip,
  type Rng,
  type Ship,
  type ShipSpec,
} from "@jamrog/engine";
import { t, tId } from "../i18n.js";
import { CARDS, CARDS_PER_ROOM, CLASS_FLAG } from "./cards.js";
import type { StrainId } from "./viruses.js";
import { seatCharterMarks } from "./cards-derelicts.js";
import { ENTRY_KIND, zoneKind } from "./zones.js";

/**
 * What a class of derelict is (design-doc.md, "Типы дереликтов").
 *
 * All data: the compartments it is built from, the band of machines aboard, the
 * size of its graph, how its doors start, what it is worth. The engine knows
 * none of it — `shipSpecOf` is the whole translation, and it is a mapping, not
 * a decision. A new class is a `DerelictSpec` and no code at all.
 *
 * Two things the design document's machine column names are deliberately in no
 * band. `r`, the rival's drone, is a machine a competitor brings aboard (G27),
 * and `G`, a ghost, is what a dead drone leaves behind (G18); neither is
 * ordinary population, and a band is only what the hull itself is holding.
 */
export interface DerelictSpec {
  /** Id and the class flag cards see: `class:freighter`. */
  readonly id: string;
  /** English name; the HELM and the log ask `derelictName` for the current one. */
  readonly name: string;
  /** Inclusive compartment count. */
  readonly rooms: [number, number];
  /** Deepest column the schematic will hold for this class. */
  readonly maxDepth: number;
  /** Compartment kinds from `zones.ts`, including the three required ones. */
  readonly kinds: readonly string[];
  /** Machine ids from `content/monsters.ts` legal aboard this class. */
  readonly band: readonly string[];
  /**
   * Virus strains this hull's salvage can be carrying
   * (`content/viruses.ts`). Drawn from when a module goes into the rack; a
   * class that names none carries the plain `spasm`, which is what the design
   * document describes and what every hand-drawn fixture assumes.
   *
   * On the class and not on the module, because a strain is the *ship's* — a
   * quarantine hull rots what you take off it, a smuggler's ledger bleeds you.
   */
  readonly strains?: readonly StrainId[];
  /**
   * Machines aboard when the drone first walks in, inclusive — **the whole
   * ship's budget**, with the ones the deck places counted inside it.
   *
   * One number per ship rather than a chance per compartment, and that is the
   * fix for the defect the v3-core gate found (`docs/tasks/G38-*.md`): a roll
   * per room and a deck that also places machines are two spawners that cannot
   * see each other, and the first freighter came out with twelve to fifteen
   * machines over twelve to fourteen compartments. `systems/populate.ts` is the
   * only thing that spends this: the deck first, wherever the fiction put it,
   * then filler two doors in for whatever is left. `MAX_MACHINES` still caps it
   * (design-doc.md, "Машины": at most eight aboard).
   */
  readonly machines: [number, number];
  /** Alert the ship starts a voyage at. */
  readonly alertStart: number;
  /** Credits for the hull, once every system aboard is online. */
  readonly salePrice: number;
  /** Relative weights per door state. The airlock is placed by rule. */
  readonly doors: Record<Exclude<DoorState, "airlock">, number>;
  /** Chance a plain crew body is carrying a spare keycard. */
  readonly keyChance: number;
  /** Added to the chance that salvage taken aboard is infected. */
  readonly virusBonus: number;
  /**
   * Is another tug always working this class (design-doc.md, "Типы
   * дереликтов": the smuggler and the corsair)? Every other hull draws for one
   * off its own seed — `systems/rival.ts` asks, this only answers.
   *
   * A field of its own and not a row in `band`, because the competitor's drone
   * is not the ship's: a band is what the hull itself is holding, and nothing
   * that reads one may ever roll an `r`.
   */
  readonly rival: boolean;
  /**
   * Words the HELM builds this hull's one-line description out of, in English.
   * What the player reads is the matching row of the language table, found by
   * this hull's id and the word's position — so a translation reorders nothing
   * and a seed draws the same pair whatever language is on.
   */
  readonly flavour: readonly string[];
}

/**
 * The first derelict of every voyage: big enough to get lost in, empty enough
 * to learn in. A handful of machines, one bulkhead, and more scrap than
 * modules.
 *
 * Two or three of them over twelve to fourteen compartments — the lower of the
 * two numbers design-doc.md gives this same hull. "Машины" hands a compartment
 * `0.3 + 0.1 × depth` and a ship at most eight, which lands near six once
 * nothing may stand within one door of the airlock; "Обучение конструкцией"
 * says the first freighter of a voyage carries exactly two, because it is the
 * ship the game teaches itself on. Six is the tutorial the v3-core gate
 * measured nobody living through, and G30's pass measured three to five as the
 * same thing more slowly: careful lasted thirty turns a voyage and died on its
 * first sortie on every seed. Both machines are the deck's — the docking bay's
 * scout and the one behind the bulkhead — and the third, where a seed puts one,
 * is what keeps a fourteen-compartment hull from being the same ship twice.
 *
 * Its doors carry neither the 10 % locked nor the 5 % broken of the balance
 * table (design-doc.md, "Числа для первого баланса"). Both are traded for one
 * certainty: the tutorial ship has *exactly* one locked door, placed by the
 * security-checkpoint card with a body holding the key in front of it. Drawn by
 * weight it would be one door on average and none or three on some seeds, and a
 * hole rolled into that same door would leave the player with no lock to learn
 * the keycard on at all.
 */
export const FREIGHTER: DerelictSpec = {
  id: "freighter",
  name: "freighter",
  rooms: [12, 14],
  maxDepth: 4,
  kinds: [
    ENTRY_KIND, "cargo", "storage", "corridor", "maintenance", "lifesupport",
    "engineering", "reactor", "control",
  ],
  band: ["maintenance-bot", "feral-drone", "scout"],
  machines: [2, 3],
  alertStart: 0,
  salePrice: 200,
  doors: { open: 55, closed: 30, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: false,
  flavour: ["bulk hauler", "fission reactor", "ion drive", "ore run", "long haul"],
};

/**
 * Depth a hull of this size can be laid out to. Six columns is the schematic's
 * limit, and the layout takes at most six compartments per column: a 25-room
 * tug needs every one of them, and a 14-room laboratory does not.
 */
const DEEP_HULL = 5;

/**
 * Every `machines` range below is read off design-doc.md, "Машины": a
 * compartment is worth `0.3 + 0.1 × depth` and a ship at most eight, so a
 * fourteen-to-seventeen compartment hull comes to five to seven and anything
 * bigger runs into the ceiling. The freighter is the exception and sits below
 * all of them, because it is the hull the game teaches itself on.
 *
 * First numbers, and nobody has played them: what a class is worth against what
 * it costs to strip is G30's, and the whole voyage curve with it.
 */

/**
 * Cold, plausible, and none of them a joke: the derelict's callsign is the
 * first thing the HELM says about a hull the player has not seen yet.
 */
export const CALLSIGNS: readonly string[] = [
  "KESTREL", "MERIDIAN", "ARGENT", "LODESTAR", "TERMAGANT", "OSPREY",
  "CINDER", "HALLOWAY", "VESPER", "BRIGHT ANCHOR", "SIX OF SWORDS", "PALE HORSE",
];

/**
 * Locked doors and keys on the dead: the laboratory is the hull that teaches
 * the second layer of the route. Its machines are light — a scout, a scrapper,
 * a jammer — and what makes it expensive is that a quarter of its doors want a
 * keycard and every keycard is on a body somebody has to find.
 */
export const LABORATORY: DerelictSpec = {
  id: "laboratory",
  name: "laboratory",
  rooms: [14, 17],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND, "lab", "med", "hydroponics", "storage", "sensors", "cryo",
    "engineering", "reactor", "control",
  ],
  band: ["scout", "scrapper", "welder-bot", "jammer"],
  strains: ["rot", "leech"],
  machines: [5, 7],
  alertStart: 0,
  salePrice: 250,
  doors: { open: 30, closed: 35, locked: 25, sealed: 0, broken: 10 },
  keyChance: 0.35,
  virusBonus: 0,
  rival: false,
  flavour: ["research hull", "isotope reactor", "survey drive", "deep survey", "no manifest"],
};

/**
 * Shut doors and turrets behind them. The military hull is the one where a door
 * left open is a mistake that shoots back, and the first hull that starts a
 * sortie with the alert already at one.
 */
export const MILITARY: DerelictSpec = {
  id: "military",
  name: "military",
  rooms: [16, 19],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND, "armory", "workshop", "corridor", "brig", "hab",
    "engineering", "reactor", "control",
  ],
  band: ["security-unit", "hauler", "arc-sentinel", "sentry-turret"],
  machines: [6, 8],
  alertStart: 1,
  salePrice: 300,
  doors: { open: 25, closed: 45, locked: 15, sealed: 5, broken: 10 },
  keyChance: 0.3,
  virusBonus: 0,
  rival: false,
  flavour: ["patrol cutter", "shielded reactor", "military drive", "border patrol", "lost with all hands"],
};

/**
 * False holds, worth fourteen credits a crate and locked to the last one. The
 * hull the `hidden hold` card in `cards.ts` was written for, and the one the
 * rival is always working at the same time (G27).
 */
export const SMUGGLER: DerelictSpec = {
  id: "smuggler",
  name: "smuggler",
  rooms: [14, 17],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND, "storage", "maintenance", "hab", "cargo", "escapepods",
    "engineering", "reactor", "control",
  ],
  band: ["feral-drone", "scrapper", "welder-bot", "jammer"],
  strains: ["spasm", "leech"],
  machines: [5, 7],
  alertStart: 0,
  salePrice: 270,
  doors: { open: 40, closed: 35, locked: 15, sealed: 0, broken: 10 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: true,
  flavour: ["fast hauler", "stripped reactor", "smuggler's drive", "no registry", "three false holds"],
};

/**
 * Boarded, and it shows: holes where doors were, welds where the crew tried to
 * stop what came through them. The most bodies of any hull and the most keys on
 * them, and an alert of two before the drone has done anything at all.
 */
export const CORSAIR: DerelictSpec = {
  id: "corsair",
  name: "corsair",
  rooms: [16, 19],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND, "armory", "hab", "cargo", "brig", "mess",
    "engineering", "reactor", "control",
  ],
  band: ["security-unit", "scrapper", "arc-sentinel"],
  strains: ["spasm", "leash"],
  machines: [6, 8],
  alertStart: 2,
  salePrice: 330,
  doors: { open: 25, closed: 30, locked: 10, sealed: 15, broken: 20 },
  keyChance: 0.45,
  virusBonus: 0,
  rival: true,
  flavour: ["raider", "overdriven reactor", "boarding drive", "taken by boarders", "prize crew aboard"],
};

/**
 * Welded shut from the inside, and the reason is still in there. Plating does
 * not help against what walks this hull, nothing it kills leaves a module, and
 * everything carried off it is fifteen percent more likely to be infected —
 * which is why it is also the most valuable hull the voyage can sell.
 */
export const QUARANTINE: DerelictSpec = {
  id: "quarantine",
  name: "quarantine",
  rooms: [14, 17],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND, "quarantine", "med", "hab", "cryo", "lifesupport",
    "engineering", "reactor", "control",
  ],
  band: ["crawler", "bloom", "scrapper"],
  strains: ["spasm", "rot"],
  machines: [5, 7],
  alertStart: 1,
  salePrice: 360,
  doors: { open: 25, closed: 40, locked: 5, sealed: 20, broken: 10 },
  keyChance: 0.2,
  virusBonus: 0.15,
  rival: false,
  flavour: ["medical transport", "shielded reactor", "long-haul drive", "sealed from inside", "no distress call"],
};

/**
 * The last ship of the voyage and the only one that is not for sale: neutralise
 * the father's tug and the run is won (design-doc.md, "Победа"). Hence a sale
 * price of zero — every other hull is a number of credits, and this one is the
 * end of the game, so a price on it would be a number nothing ever pays.
 *
 * Twenty-five compartments deep, an alert of three before the airlock closes,
 * and a band with no light machine in it at all.
 *
 * Five or six machines rather than seven or eight, and one locked or welded
 * bulkhead in twenty rather than three in ten (G30's third pass). It is the
 * only hull whose numbers that pass touched and it is what took this game's
 * first win. Over 200 seeds, with every other number of the pass in place:
 * five or six machines behind three locked bulkheads in twenty buys 3 wins and
 * behind one in twenty buys 7, against 0 before. The head count is what
 * decides and the bulkheads double it — at six or seven machines it is 1 win,
 * at five to seven it is 2, and taking the arc sentinel out of the band while
 * leaving the count alone is also 2. Nine of the 68 voyages that reach this
 * hull now bring all three systems online, and seven of those get out through
 * the airlock alive, which is what a win is.
 *
 * Still the heaviest ship of any itinerary, by everything except that count:
 * nothing else starts a sortie at alert three, nothing else names an ENFORCER
 * in its band, nothing else is twenty-five compartments, and nothing else
 * raises a ghost of every drone lost aboard it. What the old numbers made it
 * was not hard but arithmetically shut — 45 voyages of 200 reached it, 9
 * brought two systems up and none brought three — and a finale nobody
 * finishes is a finale nobody has seen.
 */
export const FATHERS_TUG: DerelictSpec = {
  id: "fathers-tug",
  name: "father's tug",
  rooms: [20, 25],
  maxDepth: 6,
  kinds: [
    ENTRY_KIND, "workshop", "hab", "coreaccess", "cryo", "sensors",
    "engineering", "reactor", "control",
  ],
  band: ["enforcer", "arc-sentinel", "security-unit"],
  strains: ["spasm", "leash", "rot"],
  machines: [5, 6],
  alertStart: 3,
  salePrice: 0,
  doors: { open: 25, closed: 45, locked: 5, sealed: 5, broken: 20 },
  keyChance: 0.3,
  virusBonus: 0,
  rival: false,
  flavour: ["salvage tug", "fission reactor", "ion drive", "your father's callsign", "missing eleven years"],
};

/** Every class of hull this build knows, the tutorial freighter first. */
export const DERELICTS: readonly DerelictSpec[] = [
  FREIGHTER, LABORATORY, MILITARY, SMUGGLER, CORSAIR, QUARANTINE, FATHERS_TUG,
];

/**
 * The five hulls a voyage draws its middle from. The freighter is always first
 * and the father's tug is always last, so neither is ever drawn.
 */
export const MIDDLE_HULLS: readonly DerelictSpec[] = [
  LABORATORY, MILITARY, SMUGGLER, CORSAIR, QUARANTINE,
];

/** A class by id, or undefined for a hull this build does not know. */
export function derelictSpec(id: string): DerelictSpec | undefined {
  return DERELICTS.find((d) => d.id === id);
}

/**
 * Which hull the drone is standing in, read off the ship's own stamp — the one
 * question a system can ask about a derelict it did not build, and the way
 * `systems/populate.ts` knows which band and which budget of machines a ship
 * is owed. Nothing for a hull no class built, which a fixture drawn by hand is.
 */
export function specOfShip(ship: Ship): DerelictSpec | undefined {
  const id = classOfShip(ship);
  return id === undefined ? undefined : derelictSpec(id);
}

/**
 * The three derelicts of one voyage: the freighter that teaches the game, one
 * hull out of five, and the father's tug (design-doc.md, "Типы дереликтов",
 * "Рейс").
 *
 * Drawn once, at the start of the run, so the player can be told where the
 * voyage ends before deciding how much of the second hull to strip.
 *
 * Three and not the document's four, which is the first line of its own risk
 * table for a voyage that does not reach its end ("дереликтов в рейсе до
 * трёх"). Measured after G30's pass: with four hulls the careful bot got the
 * tug to the father's hull on 6 % of seeds against the 10-30 % the balance
 * numbers ask for, and with three it gets there on 13 %. The middle of an
 * itinerary is the part that repeats — two hulls out of the same five, drawn
 * the same way — so it is the part that costs least to lose.
 */
export function derelictsForVoyage(rng: Rng): DerelictSpec[] {
  const pool = rng.shuffle([...MIDDLE_HULLS]);
  return [FREIGHTER, pool[0]!, FATHERS_TUG];
}

/**
 * The line the HELM prints for a hull the drone has not boarded yet:
 * `KESTREL · freighter · fission reactor · ion drive`.
 *
 * Two words out of the class's own list, kept in the order the list has them —
 * the lists read hull, reactor, drive, history — so a pair always comes out
 * reading like a registry entry rather than a shuffled bag of nouns. This is
 * the whole of what the two generator sites the owner pointed at contribute
 * (design-doc.md, "Что нашлось по ссылкам владельца"): the shape of the line,
 * with our own words in it.
 */
export interface FlavourRoll {
  /** Index into `CALLSIGNS`. */
  readonly callsign: number;
  /** Indices into this class's own `flavour`, in the order the list has them. */
  readonly first: number;
  readonly second: number;
}

/**
 * The draw, kept as three numbers rather than as a finished sentence.
 *
 * A rolled line is stored on the voyage and read again every frame, so writing
 * it out once would pin the HELM to whichever language was on when the tug tied
 * on. Three indices survive a save, survive `L`, and cost the rng exactly what
 * the old draw cost it — `Rng.pick` is `int(0, n - 1)` — so a seed is the same
 * voyage it was before this file learned about languages.
 */
export function rollFlavour(spec: DerelictSpec, rng: Rng): FlavourRoll {
  const words = spec.flavour;
  const callsign = rng.int(0, CALLSIGNS.length - 1);
  const first = rng.int(0, words.length - 2);
  const second = rng.int(first + 1, words.length - 1);
  return { callsign, first, second };
}

/** What this class of hull is called. */
export function derelictName(spec: DerelictSpec): string {
  return tId("derelict", spec.id, spec.name);
}

/**
 * The same for a class id left on a ship's store entry.
 *
 * The stores keep the id and never the name: a name written into `ship.data`
 * when the tug ties on would be pinned to whichever language was on that turn,
 * and the banner across the schematic is read every frame after it.
 */
export function derelictNameOf(id: string | undefined): string | undefined {
  const spec = id === undefined ? undefined : derelictSpec(id);
  return spec === undefined ? undefined : derelictName(spec);
}

/** The callsign of a rolled flavour line, for the banner and the ship's tag. */
export function flavourCallsign(roll: FlavourRoll): string {
  const i = Math.min(Math.max(0, Math.trunc(roll.callsign)), CALLSIGNS.length - 1);
  return CALLSIGNS[i]!;
}

/** One of this class's flavour words. Indices come out of a save: never trusted. */
function flavourWord(spec: DerelictSpec, i: number): string {
  const at = Math.min(Math.max(0, Math.trunc(i)), spec.flavour.length - 1);
  return tId("flavour", `${spec.id}.${at}`, spec.flavour[at] ?? spec.name);
}

/** `KESTREL · freighter · fission reactor · ion drive`, in the language that is on. */
export function flavourLine(spec: DerelictSpec, roll: FlavourRoll): string {
  const i = Math.min(Math.max(0, Math.trunc(roll.callsign)), CALLSIGNS.length - 1);
  return t("derelict.flavour", {
    callsign: CALLSIGNS[i]!,
    hull: derelictName(spec),
    first: flavourWord(spec, roll.first),
    second: flavourWord(spec, roll.second),
  });
}

/**
 * Generations attempted before a ship with an unseatable charter mark is kept.
 *
 * Six, because the case is a hull on which *every* compartment of the charter's
 * kind ended up within one door of the airlock, and each attempt is an
 * independent draw of the tree.
 */
export const CHARTER_ATTEMPTS = 6;

/**
 * One derelict of a voyage, as the run itself generates it: `buildDerelict`
 * with the charter marks seated at `depth ≥ 2` before the ship is handed back,
 * and the hull drawn again when they could not be.
 *
 * The charter's crate two steps from the airlock is a charter that pays for
 * nothing, and the deck alone cannot prevent it — a card is told the kind of
 * the room it is filling and never its depth (`cards-derelicts.ts`,
 * `seatCharterMarks`). `buildDerelict` is the plain draw, which is what a test
 * about the deck wants; everything a voyage boards comes through here.
 */
export function buildChartered(
  d: DerelictSpec,
  index: number,
  rng: Rng,
  ctx: CardContext,
): GeneratedShip {
  const flags = new Set(ctx.flags);
  flags.add(`${CLASS_FLAG}${d.id}`);
  const spec = shipSpecOf(d);

  let last: GeneratedShip | undefined;
  for (let attempt = 0; attempt < CHARTER_ATTEMPTS; attempt++) {
    const built = buildShip(spec, rng.fork(attempt), { ...ctx, flags, shipIndex: index });
    stampClass(built.ship, d);
    last = built;
    if (built.problems.length === 0 && seatCharterMarks(built.ship).length === 0) return built;
  }
  return last!;
}

/** Where a built derelict remembers which class it was built from. */
const SPEC_KEY = "derelict";

/**
 * The class id stamped on this ship, or nothing for a ship no class built.
 *
 * The stamp is written by whoever built the hull into the airlock
 * compartment's `data`, which is the one pocket that travels with a ship: a
 * `Ship` has no bag of its own, `StoredShip.data` belongs to whoever put it in
 * the store, and a system holding a `RoomGame` has to be able to ask "whose
 * hull is this" long after the generator has gone. Every derelict has exactly
 * one entry compartment, so there is exactly one place to look.
 *
 * An id and not a `DerelictSpec`, because this file knows one class and the
 * voyage knows seven: `content/derelict-catalog.ts` is where the two lists meet
 * and where `specOfShip` turns this back into a hull.
 *
 * "Nothing" is a real answer and not a gap: a hull drawn by hand in a test is
 * not a derelict of any class, and the things that follow from a class — the
 * band of machines aboard, the budget of them — are then not this ship's to
 * have. Whatever the test wrote into the fixture is all there is.
 */
export function classOfShip(ship: Ship): string | undefined {
  const id = ship.roomAt(ship.entry).data[SPEC_KEY];
  return typeof id === "string" ? id : undefined;
}

/**
 * Write that stamp. Every builder that hands back a hull of a known class owes
 * this call — a ship that skips it is a ship with no band and no budget of
 * machines, which is a ship the population system leaves as the generator left
 * it.
 */
export function stampClass(ship: Ship, d: DerelictSpec): void {
  ship.roomAt(ship.entry).data[SPEC_KEY] = d.id;
}

/** The generator's input for one class: kinds resolved, deck attached. */
export function shipSpecOf(d: DerelictSpec): ShipSpec {
  return {
    rooms: d.rooms,
    maxDepth: d.maxDepth,
    kinds: d.kinds.map(zoneKind),
    entryKind: ENTRY_KIND,
    doors: d.doors,
    cards: CARDS,
    cardsPerRoom: CARDS_PER_ROOM,
    // Every hull of this game is a honeycomb: a compartment is a cell, a door
    // only ever joins two cells that touch, and a shared edge is a door only
    // sometimes (`ShipSpec.lattice`). The owner's rule for the third view, and
    // the only way that view has nothing left over to explain.
    lattice: true,
  };
}

/**
 * One derelict, generated. `index` is which ship of the voyage it is, counting
 * from 0, and it reaches the cards as `shipIndex` — which is how "the docking
 * bay of the *first* ship is the tutorial" is a precondition and not a special
 * case in the generator.
 *
 * The class is handed to the cards as a flag, so a card that belongs to one
 * hull (`hidden hold`, `spore bloom`, `turret nest`) is one `when` line rather
 * than a per-class deck.
 */
export function buildDerelict(
  d: DerelictSpec,
  index: number,
  rng: Rng,
  ctx: CardContext,
): GeneratedShip {
  const flags = new Set(ctx.flags);
  flags.add(`${CLASS_FLAG}${d.id}`);
  const built = buildShip(shipSpecOf(d), rng, { ...ctx, flags, shipIndex: index });
  stampClass(built.ship, d);
  return built;
}

/**
 * The ship alone, which is what `RoomGame`'s `firstShip` and `travelTo` want.
 * Callers that also need the flags the cards raised — the voyage does, once
 * `quarantine` and `armed` have to outlive one hull — use `buildDerelict`.
 */
export function derelictShip(d: DerelictSpec, index: number, rng: Rng, ctx: CardContext): Ship {
  return buildDerelict(d, index, rng, ctx).ship;
}
