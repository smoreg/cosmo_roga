import { LOCK_ENTRY, type CardContext, type RoomCard } from "@jamrog/engine";
import { DERELICT_CARDS } from "./cards-derelicts.js";

/**
 * The derelict's card deck — the storylets of the grid version, with the ASCII
 * vaults taken out (design-doc.md, "Как storylets стали карточками отсеков").
 *
 * A card is still content + a precondition on the run + the flags it raises.
 * What changed is the payload: a compartment has no tiles, so a card hands the
 * generator a list of **marks** and `systems/populate.ts` turns those into
 * machines, wrecks, crates and bodies. That is the whole answer to the jam's
 * fourth criterion — the ship is built out of what this run has already lost,
 * so no hand-drawn level could stand in for it.
 *
 * Mark legend (executed by `systems/populate.ts`, and by nothing else):
 *
 *   m            one machine of this room's depth band
 *   M            the heaviest machine of the band
 *   m:<id>       that exact machine, whatever the band says
 *   X[:<module>] a crate: the module at full integrity; no module = a lottery
 *   %[:<module>] scrap: the module at integrity 1-3
 *   †[:key]      a crew body, searchable; `:key` means it is the one holding one
 *   *            a charter's item      &   a charter console
 *   E · O · T    the ship's engine, core and main terminal
 *   cover · fire · vented               properties of the compartment itself
 *   cargo        a crate of the hull's own freight: credits and nothing else
 *   contraband   the same, undeclared, and worth nearly twice as much
 *
 * The engine reads exactly one of them, `lock-entry`, which is a request to the
 * generator rather than content: lock the door into this room and put its key
 * somewhere the drone can already reach.
 */

/**
 * Module ids, as strings. The same set `content/modules.ts` declares — cards
 * name modules long before the rig exists, and a card deck that imports the rig
 * would make content depend on the twist instead of the other way round. The
 * two lists are checked against each other in G37, when both files are here.
 */
export type ModuleId = string;

/** What an unnamed crate can hold. A cargo bay is a lottery, a closet is not. */
export const SALVAGE_POOL: readonly ModuleId[] = [
  "cutter", "thrusters", "scanner", "plating", "cell", "emp",
  "welder", "laser", "spike", "emitter", "baffle",
];

/**
 * A card that must land wherever it is legal: the docking bay of the first
 * ship, the three system rooms, the last room before the reactor. Absurdly
 * large rather than merely large, because "always" has to survive competing
 * with another pinned card in the same room and still be a certainty on every
 * seed — `cardsPerRoom` is 2, so two pinned cards simply take a slot each.
 */
const PINNED = 1_000_000;

/**
 * The freighter's one bulkhead. The tutorial ship owes the player exactly one
 * locked door and one body with the key in front of it (design-doc.md,
 * "Обучение конструкцией", 4), and this is the card that carries it: a
 * freighter draws no locked doors by weight and has no other lock-entry card in
 * its catalogue, so this weight is what makes "exactly one" a guarantee rather
 * than an average.
 */
const BULKHEAD = 2_000;

/** Flag a ship class raises on its own card context: `class:freighter`. */
export const CLASS_FLAG = "class:";

/** Raised by `systems`/G18 once a drone has died aboard ship number `index`. */
export function deathFlag(shipIndex: number): string {
  return `death:${shipIndex}`;
}

// ------------------------------------------------------------------ helpers

/** The rig, as `twist/rig.ts` keeps it. Absent before the drone exists. */
interface RigView {
  slots: ReadonlyArray<{ kind: ModuleId } | null>;
  burned: readonly ModuleId[];
}

function rigOfCtx(ctx: CardContext): RigView | undefined {
  return ctx.player?.data?.rig as RigView | undefined;
}

/** Did this module already burn out this run? False before the drone exists. */
export function burned(ctx: CardContext, kind: ModuleId): boolean {
  return rigOfCtx(ctx)?.burned.includes(kind) ?? false;
}

/** How many slots the drone has nothing in — the room it has for salvage. */
export function emptySlots(ctx: CardContext): number {
  const rig = rigOfCtx(ctx);
  if (!rig) return 0;
  return rig.slots.reduce((n, s) => (s === null ? n + 1 : n), 0);
}

/** How badly the run has gone so far, in modules lost. */
export function burnedCount(ctx: CardContext): number {
  return rigOfCtx(ctx)?.burned.length ?? 0;
}

/** Is this module in the rack right now, whatever its integrity? */
function carries(ctx: CardContext, kind: ModuleId): boolean {
  return rigOfCtx(ctx)?.slots.some((s) => s?.kind === kind) ?? false;
}

/**
 * Keycards on the drone.
 *
 * The keyring is one number and not a list of cards (`systems/doors.ts`,
 * `keysHeld`): every keycard opens every lock marked for one, so what a card
 * can ask is how many are left, and reading it as a list found none.
 */
function keysHeld(ctx: CardContext): number {
  const keys = ctx.player?.data?.keys;
  return typeof keys === "number" ? keys : 0;
}

/** Is the ship being generated of this class? */
function isClass(ctx: CardContext, id: string): boolean {
  return ctx.flags.has(`${CLASS_FLAG}${id}`);
}

/**
 * What each card's salvage is about. A mark carries its own module now — the
 * generator hands `populate` a list of strings and not a card name — so this is
 * the table those marks are written against, checked both ways by the content
 * test, and it is what `populate` reads for the one pile no card placed: the
 * onboarding scrap in the first docking bay.
 *
 * A card missing from here leaves a lottery: a spare parts crate in a cargo bay
 * is a lottery, a sensor closet is not.
 */
export const CARD_MODULE: Readonly<Partial<Record<string, ModuleId>>> = {
  "docking bay": "welder",
  "sensor closet": "scanner",
  "charging alcove": "welder",
  "thruster bay": "thrusters",
  "quarantine ward": "plating",
  "reactor antechamber": "cell",
  "armory locker": "laser",
  "containment locker": "emp",
  "instrument bay": "scanner",
  "welding bay": "welder",
};

/**
 * Every compartment the crew kept stock in — which is every one of them but the
 * airlock, the corridor ring and the reactor. The first and the last are where
 * the run pivots, and a card that must be there cannot have a rival; a corridor
 * is a way through a ship and never a hold.
 */
const WORKING = [
  "cargo", "storage", "maintenance", "hab", "mess", "hydroponics",
  "med", "lab", "quarantine", "engineering", "workshop", "armory", "control",
  "coreaccess", "lifesupport", "cryo", "sensors", "brig", "escapepods",
];

// -------------------------------------------------------------------- cards

/**
 * The first room of the first ship, always. Onboarding taught by construction:
 * one weak machine and one pile of scrap, so the first two things a player ever
 * does are `1 attack scout` and `2 salvage WELDER`.
 */
const DOCKING_BAY: RoomCard = {
  name: "docking bay",
  kinds: ["docking"],
  when: (ctx) => ctx.shipIndex === 0,
  weight: PINNED,
  maxPerShip: 1,
  marks: ["m:scout", "%:welder"],
};

/**
 * What the hull was hauling, and the first credits a run ever banks. The first
 * ship of a voyage only.
 *
 * A starting hull carries no contraband and its crew is a body or two, so this
 * is the card that makes the first hold a player ever prises open a certainty
 * rather than a draw: two of them, 16 CR, pinned where the onboarding can count
 * on them. The rest of what a hull is carrying is drawn by weight like every
 * other one's (`HOLDS`), and the two together are what make the one charter on
 * the board (`SALVAGE 20 CR`) a job rather than a gamble on whether the ship's
 * systems happen to sit outside its bulkheads.
 *
 * The kinds are every compartment any of the five starting hulls keeps stock in
 * (`STARTER_HULLS`), and not the freighter's four — a ferry has no cargo bay
 * and a probe has no maintenance shop, and either would have opened its voyage
 * with nothing pinned aboard. Nothing about the freighter or the training hull
 * moves for it: neither has a compartment of any of the added kinds, so the
 * card is eligible in exactly the rooms it always was.
 *
 * Pinned, and deliberately not on the corridors: the freighter's single locked
 * door is drawn by `security checkpoint`, which competes for a corridor, and a
 * pinned card in the same room would be the thing that unlocks the ship. The
 * ferry's two gates are kept off these kinds for the same reason
 * (`BOARDING_GATE`).
 */
const CARGO_MANIFEST: RoomCard = {
  name: "cargo manifest",
  kinds: ["cargo", "storage", "lifesupport", "maintenance", "hab", "workshop", "sensors"],
  when: (ctx) => ctx.shipIndex === 0,
  weight: PINNED,
  maxPerShip: 2,
  marks: ["cargo"],
};

/**
 * What every hull of the voyage was carrying, one card per class.
 *
 * This is the income of a sortie, and until G41 there was none: `X` is a crate
 * of *modules*, `contraband` belongs to the smuggler alone, and the only plain
 * `cargo` in the deck was `cargo manifest` on the first ship of a voyage. So
 * every hull after the freighter paid a drone three credits a body and whatever
 * its wrecks fetched at the tug, against 40 CR for the next drone — measured by
 * G30: a rack came home with 20-37 CR and the first sortie repaid its hull on
 * none of 32 seeds.
 *
 * Two rules the table below is built on:
 *
 *   **By class, on that class's own compartments.** A card is what a hull was
 *   for — ore in a freighter's containers, ammunition on a patrol cutter,
 *   somebody else's cargo in a corsair's holds — so the deck still says
 *   something about the ship it is drawing rather than sprinkling crates.
 *
 *   **In front of the locks.** The count that matters is what a drone can carry
 *   out without a keycard (`tests/ship-content.test.ts`): a laboratory locks a
 *   quarter of its doors, so cargo that only sits behind them is cargo the first
 *   sortie of a voyage never sees.
 */
const HOLDS: ReadonlyArray<{
  /** Class flag this hold belongs to, and its name in the deck. */
  readonly hull: string;
  readonly name: string;
  readonly kinds: readonly string[];
  /** Compartments of that kind it may fill. One crate — 8 CR — in each. */
  readonly maxPerShip: number;
  /**
   * Crates in each of them, and whether the card is pinned there.
   *
   * Both are for the four small hulls a voyage can open on and nothing else. A
   * nine-compartment barge and a six-compartment probe have a third of the card
   * slots a freighter has, so a hold drawn by weight lands on them a third as
   * often — which is how the same deck that pays a freighter 48 CR in front of
   * its locks paid a probe 24, against a threshold of 30 that
   * `tests/ship-content.test.ts` holds every class to. A pinned hold of two
   * crates is the floor those hulls need; everything above it is still drawn.
   */
  readonly crates?: number;
  readonly pinned?: boolean;
}> = [
  // The bulk hauler: containers, and the run's first lesson that a hold is
  // money. Two apiece rather than three, because `cargo manifest` is already
  // pinned to two of its compartments.
  { hull: "freighter", name: "container stack", kinds: ["cargo", "storage"], maxPerShip: 2 },
  { hull: "freighter", name: "ore drums", kinds: ["maintenance", "lifesupport", "corridor"], maxPerShip: 2 },
  // The four other hulls a voyage can open on. Each is smaller than the
  // freighter and has fewer card slots to be paid in, so each holds more per
  // slot: what `tests/ship-content.test.ts` measures is credits in front of the
  // locks, and a nine-compartment hull reaches the same band as a fourteen-
  // compartment one only by being denser.
  { hull: "barge", name: "container line", kinds: ["cargo"], maxPerShip: 1, crates: 2, pinned: true },
  { hull: "barge", name: "deck cargo", kinds: ["storage", "maintenance", "corridor"], maxPerShip: 2 },
  { hull: "ferry", name: "passenger baggage", kinds: ["cargo"], maxPerShip: 1, crates: 2, pinned: true },
  // Behind the two gates, which is the whole of what a ferry teaches: the
  // freight worth carrying is on the far side of a door with a key on a body.
  { hull: "ferry", name: "galley stores", kinds: ["mess", "cryo"], maxPerShip: 2 },
  { hull: "probe", name: "sample canisters", kinds: ["sensors"], maxPerShip: 1, crates: 2, pinned: true },
  { hull: "probe", name: "instrument cases", kinds: ["sensors", "storage"], maxPerShip: 2 },
  { hull: "tender", name: "parts pallets", kinds: ["workshop"], maxPerShip: 1, crates: 2, pinned: true },
  { hull: "tender", name: "yard stock", kinds: ["maintenance", "storage", "corridor"], maxPerShip: 2 },
  // The research hull: what it was carrying is what it was studying.
  { hull: "laboratory", name: "sample crates", kinds: ["lab", "med", "cryo"], maxPerShip: 3 },
  { hull: "laboratory", name: "supply cache", kinds: ["storage", "sensors", "hydroponics"], maxPerShip: 3 },
  // The patrol cutter: ordnance and rations, and both are worth carrying home.
  { hull: "military", name: "ammunition pallets", kinds: ["armory", "workshop"], maxPerShip: 3 },
  { hull: "military", name: "ration store", kinds: ["hab", "brig", "corridor"], maxPerShip: 3 },
  // The smuggler declares none of it. The false holds are `hidden hold` and
  // stay locked; this is the freight on the manifest.
  { hull: "smuggler", name: "unlisted freight", kinds: ["cargo", "storage"], maxPerShip: 3 },
  { hull: "smuggler", name: "transit crates", kinds: ["maintenance", "hab", "escapepods"], maxPerShip: 3 },
  // The raider: somebody else's cargo, stacked where the prize crew left it.
  { hull: "corsair", name: "prize goods", kinds: ["cargo", "hab", "mess"], maxPerShip: 3 },
  { hull: "corsair", name: "plunder pile", kinds: ["armory", "brig"], maxPerShip: 3 },
  // The medical transport: stores nobody was ever going to unload.
  { hull: "quarantine", name: "medical stores", kinds: ["med", "quarantine", "lifesupport"], maxPerShip: 3 },
  { hull: "quarantine", name: "sealed pallets", kinds: ["cryo", "hab"], maxPerShip: 3 },
  // The father's tug: eleven years of somebody else's salvage, still racked.
  { hull: "fathers-tug", name: "salvage lot", kinds: ["workshop", "hab", "cryo"], maxPerShip: 3 },
  { hull: "fathers-tug", name: "stripped racks", kinds: ["sensors", "coreaccess"], maxPerShip: 3 },
];

/**
 * How hard a hold competes for the compartment it is drawn in.
 *
 * The one number that sets what a sortie is worth, and it is read against
 * `PICKED_CLEAN`'s twelve: a hold takes about a quarter of the draws it is
 * eligible for, which comes to five or six crates on a hull — 40-56 CR aboard
 * and a median of 36-48 in front of the locks. Turning it turns the whole
 * economy: `tests/ship-content.test.ts` holds both ends of that range, and
 * `tests/winnable.test.ts` holds what it is for — the first sortie of a voyage
 * repays the hull that flew it.
 */
const HOLD_WEIGHT = 5;

/** The holds, as cards: crates of freight, eligible on their own hull only. */
const HOLD_CARDS: readonly RoomCard[] = HOLDS.map((hold) => ({
  name: hold.name,
  kinds: hold.kinds,
  weight: hold.pinned === true ? PINNED : HOLD_WEIGHT,
  maxPerShip: hold.maxPerShip,
  when: (ctx: CardContext) => isClass(ctx, hold.hull),
  marks: new Array<string>(hold.crates ?? 1).fill("cargo"),
}));

/**
 * The plain one: whatever the ship was carrying, in a crate. It is what every
 * other card competes against, and it is worth much more when the rack has room
 * to put its contents. Capped, so a ship cannot be all crates.
 */
const SPARE_PARTS_CRATE: RoomCard = {
  name: "spare parts crate",
  kinds: WORKING,
  weight: 3,
  maxPerShip: 3,
  weightWhen: (ctx) => (emptySlots(ctx) >= 2 ? 3 : 1),
  marks: ["X"],
};

/** The ship answering a burned-out scanner with the one thing that fixes it. */
const SENSOR_CLOSET: RoomCard = {
  name: "sensor closet",
  kinds: ["maintenance", "lab", "control", "sensors"],
  weightWhen: (ctx) => (burned(ctx, "scanner") ? 7 : 1),
  marks: ["X:scanner", "%:scanner"],
};

/** A welder: the run's only field repair, so it turns up once things burn. */
const CHARGING_ALCOVE: RoomCard = {
  name: "charging alcove",
  kinds: ["hab", "mess", "engineering", "workshop"],
  weightWhen: (ctx) => (burnedCount(ctx) >= 1 ? 3 : 1),
  marks: ["X:welder", "%:welder"],
};

/**
 * The starting hulls whose bulkheads are their own, and the one whose living
 * quarters are, by id.
 *
 * Literals, like `tutorial` below and for the same reason: this file is what
 * `content/derelicts.ts` is built out of, and a deck that imported a ship class
 * would close the loop ADR 0003 exists to keep open (docs/adr/0003-decoupling.md).
 * `tests/content.test.ts` holds these strings against the classes they name.
 */
const OWN_BULKHEADS = ["barge", "ferry", "probe", "tender"];
const FERRY = "ferry";

/**
 * The heaviest thing this hull fields, behind a bulkhead. The freighter's one
 * locked door.
 *
 * One machine and not two: the room this card lands in is often a system room,
 * which already has a guard of its own, and three machines in one compartment
 * is a fight the drone cannot walk out of. Behind the lock it is a fight the
 * player chooses; three of them is a wall.
 */
const SECURITY_CHECKPOINT: RoomCard = {
  name: "security checkpoint",
  kinds: ["corridor", "control", "armory", "engineering"],
  weight: 2,
  maxPerShip: 1,
  // Pinned on the two hulls whose one bulkhead is a promise rather than a draw:
  // the freighter a voyage opens on, and the training hull a training run opens
  // on instead (`content/tutorial.ts`, `TUTORIAL_ID`). The id is a literal here
  // and not an import, because a card that imported a ship class would close
  // the one loop `zones → cards → derelicts` exists to keep open
  // (docs/adr/0003-decoupling.md); `tests/tutorial.test.ts` holds the two ends
  // of the string together.
  weightWhen: (ctx) => (isClass(ctx, "freighter") || isClass(ctx, "tutorial") ? BULKHEAD : 1),
  // And off the four other hulls a voyage can open on entirely. Each of them
  // states its own door plan — the ferry's two gates, the barge's and the
  // probe's open runs, the tender's welds — and each carries one or two
  // machines all told, so a lock nobody promised with the heaviest machine of
  // the band behind it is both a lesson the hull is not teaching and a third of
  // its head count (`content/derelicts.ts`, `STARTER_HULLS`).
  when: (ctx) => !OWN_BULKHEADS.some((id) => isClass(ctx, id)),
  marks: ["M", LOCK_ENTRY],
};

/** The set piece of a medical hull. What it raises steers the lockers deeper. */
const QUARANTINE_WARD: RoomCard = {
  name: "quarantine ward",
  kinds: ["quarantine", "med"],
  weight: 4,
  maxPerShip: 1,
  sets: ["quarantine"],
  marks: ["M", "X:plating"],
};

/**
 * The reactor's own stock: two cells off the racks, and the second pinned card
 * every core room draws.
 *
 * It used to stand a machine here too. The core room is already guarded by
 * `core room`'s own, and a reactor holding two of them made the compartment the
 * whole run is aimed at the one compartment a drone with three CORE points
 * cannot enter.
 */
const REACTOR_ANTECHAMBER: RoomCard = {
  name: "reactor antechamber",
  kinds: ["reactor"],
  weight: PINNED,
  maxPerShip: 1,
  marks: ["%:cell", "%:cell"],
};

/** A stripped drone bay. Speed is the first thing a run misses. */
const THRUSTER_BAY: RoomCard = {
  name: "thruster bay",
  // The docking bay of the first ship is the tutorial and stays small, so this
  // one waits inside the ship rather than competing for the room the drone
  // lands in.
  kinds: ["maintenance", "workshop"],
  weightWhen: (ctx) => (burned(ctx, "thrusters") ? 4 : 1),
  marks: ["%:thrusters", "%:thrusters", "X:thrusters"],
};

/** The best weapon in the game, with the reason it is still there. */
const ARMORY_LOCKER: RoomCard = {
  name: "armory locker",
  kinds: ["armory", "engineering"],
  weight: 3,
  maxPerShip: 1,
  sets: ["armed"],
  marks: ["X:laser", "M"],
};

/** The ward pays off here — quarantine stock, still sealed. */
const CONTAINMENT_LOCKER: RoomCard = {
  name: "containment locker",
  kinds: ["control", "coreaccess", "lab"],
  maxPerShip: 1,
  weightWhen: (ctx) => (ctx.flags.has("quarantine") ? 4 : 1),
  marks: ["X:emp", "%:emp"],
};

/**
 * Where the crew was when it stopped being a crew. One of them has a key.
 *
 * Off the ferry, and only the ferry: that hull promises exactly two locked
 * doors and places both itself (`BOARDING_GATE`, `MUSTER_POINT`), and a third
 * drawn by weight would make the two that were promised indistinguishable from
 * a draw. Every other hull with living quarters still draws this one.
 */
const CREW_QUARTERS: RoomCard = {
  name: "crew quarters",
  kinds: ["hab", "cryo", "mess"],
  weight: 2,
  maxPerShip: 1,
  when: (ctx) => !isClass(ctx, FERRY),
  marks: ["†", "†", "†:key", LOCK_ENTRY],
};

// ------------------------------------------- what the four starting hulls are

/**
 * The barge's holds, restrained and stacked: two piles of scrap in a
 * compartment, up to four compartments of them.
 *
 * Eight piles on a nine-compartment hull, against six slots on the rack the
 * drone flew out in — which is the whole lesson of the class. A sortie aboard a
 * barge ends when there is nowhere left to put anything, and what the player
 * learns is that the question was never "is the ship empty" but "what is worth
 * a slot" (`content/derelicts.ts`, `BARGE`).
 */
const STACKED_SCRAP: RoomCard = {
  name: "stacked scrap",
  kinds: ["cargo", "storage", "maintenance", "corridor"],
  // Over `PICKED_CLEAN`'s twelve, which is the only weight in this deck that
  // means anything: a barge that drew a stripped compartment more often than a
  // stacked one would be a barge with less aboard than the hull it replaced.
  weight: 14,
  maxPerShip: 4,
  when: (ctx) => isClass(ctx, "barge"),
  marks: ["%", "%"],
};

/**
 * The ferry's two bulkheads, one apiece and each pinned to a compartment kind
 * the hull has exactly one of, so that "two doors, two keys" is a fact about
 * the class rather than a draw.
 *
 * Two cards and not one card twice: `maxPerShip` is what caps a card, and one
 * card capped at two lands in the two shallowest compartments it is eligible
 * in — which on an eight-compartment hull is wherever the freight is. Split in
 * two, each gate takes the one compartment of its own kind, and the hull's
 * cargo bay and hab block stay in front of the locks where the manifest can be
 * reached without a keycard.
 *
 * `LOCK_ENTRY` is a request to the generator and not content: it locks the tree
 * door into this compartment and puts the key in a compartment the drone can
 * already stand in, where `systems/populate.ts` lays it on a body — the one on
 * the card, or one it makes. So the keycard is on the dead by construction, and
 * that is what a ferry teaches.
 */
const BOARDING_GATE: RoomCard = {
  name: "boarding gate",
  kinds: ["mess"],
  weight: PINNED,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, FERRY),
  marks: ["†", LOCK_ENTRY],
};

const MUSTER_POINT: RoomCard = {
  name: "muster point",
  kinds: ["cryo"],
  weight: PINNED,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, FERRY),
  marks: ["†", "†", LOCK_ENTRY],
};

/**
 * The one locked bulkhead of the barge, the probe and the tender, with the
 * keycard on a body in front of it.
 *
 * Not decoration and not a lesson: it is the only way the third system comes
 * up. The main terminal is raised with a SPIKE or a keycard
 * (`content/objectives.ts`, `TERMINAL`), the drone leaves the yard with neither
 * — its rack is CUTTER, THRUSTERS, SCANNER, PLATING, CELL — and a SPIKE only
 * turns up as one face of the eleven-way lottery a plain crate is. So a hull
 * that locks nothing hands out no keycards, and a hull that hands out no
 * keycards cannot be neutralised, cannot be towed and cannot be sold.
 *
 * It was measured before it existed. Over 64 careful voyages apiece, the three
 * hulls with no lock aboard brought a mean of 1.9 systems online and sold 0.00,
 * 0.02 and 0.02 hulls; the freighter, whose `security checkpoint` has always
 * carried a key, brought up 2.34 and sold 0.56, and the ferry, which has two
 * gates and the most keys of the pool, 2.55 and 0.66. The third system was not
 * hard on those hulls — it was arithmetically shut, which is the same defect
 * design-doc.md records for the father's tug and G30 closed there.
 *
 * A card of its own rather than `security checkpoint`, because that one also
 * stands the heaviest machine of the band behind its door, and these three
 * hulls hold one or two machines in total (`content/derelicts.ts`).
 * `storage` is the compartment all three have and the ferry has not — the ferry
 * states its own doors and needs no fourth.
 */
const SUPPLY_LOCKER: RoomCard = {
  name: "supply locker",
  kinds: ["storage"],
  // Pinned and not merely heavy. `BULKHEAD` is what makes the freighter's one
  // door a near-certainty, and a near-certainty is the wrong shape here: the
  // seeds it misses are not slightly poorer hulls, they are hulls whose third
  // system cannot be raised at all.
  weight: PINNED,
  maxPerShip: 1,
  when: (ctx) => ["barge", "probe", "tender"].some((id) => isClass(ctx, id)),
  marks: ["†", "†:key", LOCK_ENTRY],
};

/**
 * The probe's one instrument bay: the SCANNER that reads a compartment through
 * a door, in the hull whose machines see further than the drone does.
 *
 * `cover` with it, because the answer this class asks for is a shut door and
 * something to stand behind rather than a fight — and a hull that asks the
 * question without offering the answer anywhere aboard is a hull that only
 * punishes.
 */
const INSTRUMENT_BAY: RoomCard = {
  name: "instrument bay",
  kinds: ["sensors"],
  weight: 8,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "probe"),
  marks: ["X:scanner", "cover"],
};

/** The tender's own trade, still on the bench: a welder and the scrap of one. */
const WELDING_BAY: RoomCard = {
  name: "welding bay",
  kinds: ["workshop", "maintenance"],
  weight: BULKHEAD,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "tender"),
  marks: ["m:welder-bot", "%:welder"],
};

/**
 * And the racks around it. A crate and a pile of scrap apiece, drawn from the
 * lottery: a yard tender is where a rack that came off a bad sortie is made
 * whole again, and what it is holding is modules rather than credits.
 */
const SPARES_RACK: RoomCard = {
  name: "spares rack",
  kinds: ["workshop", "maintenance", "storage"],
  weight: 7,
  maxPerShip: 3,
  when: (ctx) => isClass(ctx, "tender"),
  marks: ["X", "%"],
};

/** A smuggler's false hold: locked, and worth the trouble of opening. */
const HIDDEN_HOLD: RoomCard = {
  name: "hidden hold",
  kinds: ["storage", "cargo"],
  weight: 3,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "smuggler") && (carries(ctx, "cell") || keysHeld(ctx) > 0),
  marks: ["contraband", "contraband", LOCK_ENTRY],
};

/**
 * Biology, on the hull where biology got out. Three machines in one
 * compartment, and one such compartment per hull: a ship's machines are one
 * budget (`DerelictSpec.machines`), and a card worth three of it that could
 * land four times over is a quarantine hull with twelve things aboard and no
 * room left for the budget to decide anything.
 */
const SPORE_BLOOM: RoomCard = {
  name: "spore bloom",
  kinds: ["quarantine", "hydroponics"],
  weight: 3,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "quarantine"),
  marks: ["m:bloom", "m:crawler", "m:crawler", "cover"],
};

/**
 * A corridor a military crew did not intend anyone to walk down. Two of them at
 * most: a turret is a door you cannot use, and a hull where every corridor is
 * one is a hull with no route through it — and, like the spore bloom, it spends
 * a budget the rest of the ship is drawn from.
 */
const TURRET_NEST: RoomCard = {
  name: "turret nest",
  kinds: ["corridor", "armory"],
  weight: 3,
  maxPerShip: 2,
  when: (ctx) => isClass(ctx, "military"),
  marks: ["m:sentry-turret", "cover"],
};

/**
 * The three systems, one per required compartment. Pinned, because "neutralise
 * the ship" is the win condition and a ship whose terminal never got placed is
 * a ship that cannot be finished (design-doc.md, "Обезвредить корабль").
 */
const ENGINE_ROOM: RoomCard = {
  name: "engine room",
  kinds: ["engineering"],
  weight: PINNED,
  maxPerShip: 1,
  marks: ["E"],
};

const CORE_ROOM: RoomCard = {
  name: "core room",
  kinds: ["reactor"],
  weight: PINNED,
  maxPerShip: 1,
  marks: ["O"],
};

const BRIDGE: RoomCard = {
  name: "bridge",
  kinds: ["control"],
  weight: PINNED,
  maxPerShip: 1,
  marks: ["T"],
};

/**
 * Where the last drone died, on a ship that already killed one. The ship is not
 * a place the run visits twice unchanged: the rack you lost is lying in it, and
 * so is whatever is wearing it now. Unreachable: nothing sets `deathFlag` —
 * G18 shipped the same idea through `systems/ghost.ts`'s own death records
 * instead.
 */
const DRONE_WRECK: RoomCard = {
  name: "wreck of your drone",
  weight: 5,
  maxPerShip: 1,
  when: (ctx) => ctx.flags.has(deathFlag(ctx.shipIndex)),
  marks: ["%", "%", "m:ghost"],
};

/**
 * Somebody got here first. The card that leaves nothing, and the reason the
 * deck is a choice at all: two cards are drawn per compartment, so without an
 * outcome that costs a draw and yields nothing, every eligible card lands on
 * every ship and a `weightWhen` of seven means the same as a weight of one.
 * With it, a burned-out scanner visibly changes what the ship is holding —
 * which is the whole point of building the ship out of the run.
 */
const PICKED_CLEAN: RoomCard = {
  name: "picked clean",
  weight: 12,
  marks: [],
};

/** The deck handed to every compartment of every ship. */
export const CARDS: readonly RoomCard[] = [
  PICKED_CLEAN,
  DOCKING_BAY,
  CARGO_MANIFEST,
  SPARE_PARTS_CRATE,
  SENSOR_CLOSET,
  CHARGING_ALCOVE,
  SECURITY_CHECKPOINT,
  QUARANTINE_WARD,
  REACTOR_ANTECHAMBER,
  THRUSTER_BAY,
  ARMORY_LOCKER,
  CONTAINMENT_LOCKER,
  CREW_QUARTERS,
  HIDDEN_HOLD,
  SPORE_BLOOM,
  TURRET_NEST,
  // The set pieces of the four hulls a voyage can open on beside the freighter.
  STACKED_SCRAP,
  SUPPLY_LOCKER,
  BOARDING_GATE,
  MUSTER_POINT,
  INSTRUMENT_BAY,
  WELDING_BAY,
  SPARES_RACK,
  ENGINE_ROOM,
  CORE_ROOM,
  BRIDGE,
  DRONE_WRECK,
  // What each class was carrying: the crates a sortie is paid in.
  ...HOLD_CARDS,
  // The charter cards: one pair per compartment kind a charter may name, each
  // eligible only while the run is carrying that charter
  // (`content/cards-derelicts.ts`). In the one deck rather than folded into a
  // hull's own — a card whose `when` is false costs a draw and nothing else.
  ...DERELICT_CARDS,
];

/**
 * Cards attempted per compartment. Two rather than one, and that is a rule the
 * deck is built on: a room where the only pinned card is also the only eligible
 * one would leave nothing for the system card, and every "always" guarantee
 * above would become a coin flip.
 */
export const CARDS_PER_ROOM = 2;
