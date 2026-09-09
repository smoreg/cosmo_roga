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
 * What the hauler was hauling, and the first credits a run ever banks. The
 * first ship of a voyage only.
 *
 * The freighter carries no contraband and its crew is one body, so this is the
 * card that makes the first hold a player ever prises open a certainty rather
 * than a draw: two of them, 16 CR, pinned where the tutorial can count on them.
 * The rest of what a freighter is carrying is drawn by weight like every other
 * hull's (`HOLDS`), and the two together are what make the one charter on the
 * board (`SALVAGE 20 CR`) a job rather than a gamble on whether the ship's
 * systems happen to sit outside its one bulkhead.
 *
 * Pinned, and deliberately not on the corridors: the freighter's single locked
 * door is drawn by `security checkpoint`, which competes for a corridor, and a
 * pinned card in the same room would be the thing that unlocks the ship.
 */
const CARGO_MANIFEST: RoomCard = {
  name: "cargo manifest",
  kinds: ["cargo", "storage", "lifesupport", "maintenance"],
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
}> = [
  // The bulk hauler: containers, and the run's first lesson that a hold is
  // money. Two apiece rather than three, because `cargo manifest` is already
  // pinned to two of its compartments.
  { hull: "freighter", name: "container stack", kinds: ["cargo", "storage"], maxPerShip: 2 },
  { hull: "freighter", name: "ore drums", kinds: ["maintenance", "lifesupport", "corridor"], maxPerShip: 2 },
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

/** The holds, as cards: one crate of freight, eligible on their own hull only. */
const HOLD_CARDS: readonly RoomCard[] = HOLDS.map((hold) => ({
  name: hold.name,
  kinds: hold.kinds,
  weight: HOLD_WEIGHT,
  maxPerShip: hold.maxPerShip,
  when: (ctx: CardContext) => isClass(ctx, hold.hull),
  marks: ["cargo"],
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
  weightWhen: (ctx) => (isClass(ctx, "freighter") ? BULKHEAD : 1),
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

/** Where the crew was when it stopped being a crew. One of them has a key. */
const CREW_QUARTERS: RoomCard = {
  name: "crew quarters",
  kinds: ["hab", "cryo", "mess"],
  weight: 2,
  maxPerShip: 1,
  marks: ["†", "†", "†:key", LOCK_ENTRY],
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
 * so is whatever is wearing it now. Unreachable until G18 raises the flag.
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
