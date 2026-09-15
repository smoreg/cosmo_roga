import { TURN_COST, type ActionOffer, type Entity, type LevelId, type Outcome, type Room, type RoomCommand, type RoomGame, type RoomId, type System } from "@jamrog/engine";
import { buildChartered, derelictName, derelictSpec, flavourCallsign, flavourLine, rollFlavour, stopsForVoyage, type DerelictSpec, type FlavourRoll } from "../content/derelicts.js";
import type { Key } from "../content/i18n/keys.js";
import { t, tId } from "../i18n.js";
import { CHARTER_FLAG } from "../content/cards-derelicts.js";
import { TUTORIAL_SPEC, isTraining } from "../content/tutorial.js";
import { CLAUSES, charterFlags, contractsFor, doneBy, offerCharters, salvageTarget, type Charter, type CharterId, type ClauseId } from "../content/charters.js";
import { TUG_OPENING_KEY, hint, soldLine, tugCallsign, tugOpening, voyageOpening } from "../content/hints.js";
import { TUG_ID, isTug, tugShip } from "../content/tug.js";
import { CHEAPEST_HULL, HULLS, STARTING_CREDITS, STARTING_HULL, hullKind, hullName, hullSlots, hullTrait, type HullId, type HullKind, startingSlots } from "../content/hulls.js";
import { MAX_GRAFT, isRelic, moduleKind, moduleName, type ModuleId } from "../content/modules.js";
import { OBJECTIVE_COUNT, type ObjectiveId } from "../content/objectives.js";
import { MAX_LEVEL, alertState, detonated, raiseAlert } from "./alert.js";
import { rivalState } from "./rivalstate.js";
import { keysHeld } from "./doors.js";
import { roomList, type Crate, type RoomItem } from "./populate.js";
import { shipState } from "./shipstate.js";
import { BENCH_CURE_PRICE, INFECTED_SELL_SHARE, clearVirus, virusOf } from "./virus.js";
import { applyDerived, capOf, graft as graftOn, install, installAt, removeSlot, rigFrom, rigOf, type Rig, type Slot, findSlot, carriedBy, carriedFrom, setCarried } from "../twist/rig.js";

/**
 * The voyage: one account, one drone at a time, and the two ways a run ends.
 *
 * The owner's rule, word for word: no meta-progression — lost a drone, buy
 * another; no money for one, that is the end. So there is exactly one counter
 * (credits), it lives for one run, and nothing about it is ever written to
 * storage. Losing a drone is not the end of anything except the drone: the tug
 * still has an account, and the account is what the game is actually about.
 *
 * This system claims the outcome, which is why it is here and not spread over
 * three files: `leave` stops meaning "you win" and starts meaning "the sortie
 * ended" — and what that costs, pays and leads to (design-doc.md, "Цикл",
 * "Экономика рейса") is one decision made in one place. `systems/ship.ts` still
 * counts the systems the drone brought up; it just no longer says what they are
 * worth.
 *
 * Every station verb is offered wherever the drone stands aboard the tug, and
 * which compartment each one belongs to is `systems/tug.ts`'s to answer. The
 * split is deliberate: prices, refusals and wording are the voyage's, geography
 * is the tug's, and the *state* of a voyage stays testable without a place to
 * stand in.
 */

// --------------------------------------------------------------- the numbers

/**
 * Credits a point of integrity costs at the bench, and the ceiling on one
 * module: **a credit a point, never more than four.**
 *
 * Four credits used to buy one point, so a chewed SCRAPPER rack of fifty-five
 * points cost up to 220 CR to mend against 40 CR for a whole new drone with a
 * whole new rack. The owner: «чиниться дороже, чем купить нового дрона со всеми
 * модулями» — and the balance harness had been saying the same thing in a
 * comment for two passes: "mending is a bad deal at four credits a point
 * against forty for a whole rack… the line is honest and the price is the
 * defect".
 *
 * Now one press mends the module to its own ceiling and the same four credits
 * is the *most* it can cost. Measured, because the acceptance line is thin: at
 * four a point the harness wins 2 voyages of 200, at a credit a point capped at
 * four it wins 3 (`tests/winnable.test.ts`). Flat four a module also wins 2 —
 * the difference is the lightly chewed module mended for one credit instead of
 * four, which is exactly the trip home a voyage lives or dies by.
 */
const REPAIR_PRICE = 1;
const REPAIR_CAP = 4;
const GRAFT_PRICE = 12;
/**
 * Exported because it is the one price the account may never be spent under
 * while the tug is tied to a hull that has gone under tow (`jumpFirst`).
 */
export const JUMP_PRICE = 40;
// Forty and not thirty since G90 F: a hull's one contract pays 30-45 CR where
// a board of them paid 20-30, and the account buys jumps with it. Measured on
// the careful harness with the contracts at their new rates: at thirty the tug
// reached the father's hull on 27 of 32 voyages against a ceiling of 80 %, at
// thirty-five on 26, at forty on 25 — with 4 wins in 200 and 22 hulls sold in
// 32 at every one of the three.
// What cleaning one costs and what an infected module fetches are the virus's
// own numbers (`systems/virus.ts`): the bench only charges them.

/**
 * The incoming column: a module handed in, and what a crate is worth.
 *
 * The per-point term is zero since G41, and the arithmetic is the whole reason.
 * The hold used to pay `4 + 2` a point of integrity, which made the five
 * modules a SCRAPPER comes off the rack with worth 78 CR against the 40 the
 * hull costs — so buying a drone and selling its own rack was a profit, losing
 * a drone paid, and "no drone and not enough for another" (the one way to lose
 * this game) was unreachable. A bot pressing every enabled line in order did
 * exactly that, on every seed.
 *
 * Zero and not a smaller number, because a SCRAPPER's rack is forty points of
 * integrity over five modules: at four credits a module it fetches 20 CR, half
 * of what the hull costs, and one credit a point would put it back over the
 * hull. So a module is worth the same four credits whatever state it is in, and
 * what its integrity is worth is the module itself — a rack is worn, not sold.
 * `tests/voyage.test.ts` holds the 60 % ceiling on all three hulls.
 */
const MODULE_PRICE = 4;
const MODULE_PER_POINT = 0;
const CRATE_PRICE: Readonly<Record<Crate["kind"], number>> = { cargo: 8, contraband: 14 };

/**
 * Modules the tug's hold can keep between drones (design-doc.md, "Буксир").
 *
 * The hold belongs to the tug and not to the drone, so what is in it survives a
 * sortie, a dead drone and the hull bought after it — that is the whole reason
 * it is worth having, and it is why the cap is stated on the voyage record
 * rather than on a rack. `stow` fills it and `fit` empties it; anything else
 * that ever puts a module there (a charter paid in kind, a spare set aside) has
 * to respect this.
 *
 * Six, not three. Three was a hold for a drone that could only ever bring home
 * what it was wearing; now a drone can carry three off a hull on top of a full
 * rack (`CARRY_LIMIT`), and a hold that fills in two trips is a hold that
 * throws away the third.
 */
export const HOLD_LIMIT = 6;

/** Prising a crate open is about as loud as going through a body. */
const TAKE_NOISE = 2;

// The tug's own id and graph are `content/tug.ts`; what a voyage does with it
// is here. Re-exported because everything that reads a voyage — the tests, the
// UI, G19's stations — asks this file which ship the drone is standing on.
export { TUG_ID };

/** The store id of the first derelict, which is the one `RoomGame` starts on. */
const FIRST_DERELICT_ID: LevelId = "1";

/**
 * Where the ids of things that are not aboard a ship start.
 *
 * `target` is one number for doors, wrecks, bodies and ship systems, and a bot
 * reads an offer aimed at a door id as "something can open this door"
 * (`testing/roombots.ts`). A hull on the rack is none of those, and the tug's
 * own airlock is door 0 — so the stations count from a number no ship will ever
 * reach, the way `FIRST_SHIP_ID` does for what lies in a compartment.
 */
const HULL_TARGET = 2000;
const HOLD_TARGET = 2100;

/** Aimed at the dock's shelf: `STOCK_TARGET + i` is the i-th module on it. */
const STOCK_TARGET = 2200;

/**
 * Aimed at a line of a stop's list of hulls and contracts:
 * `CHOICE_TARGET + stop × CHOICE_STRIDE + i` is the i-th line of that stop.
 *
 * The stop is in the number on purpose. A line pressed on one stop and a line
 * in the same place on the next are different bargains, and a command that
 * says which stop it was written for is refused on any other — a recorded press
 * replayed a stop late does not quietly fly somewhere else.
 */
const CHOICE_TARGET = 2300;
const CHOICE_STRIDE = 50;

const NOT_ENOUGH = "why.credits";

/**
 * One drone at a time, and the one sentence that says so.
 *
 * The rack line at the DOCK and the refusal `buyHull` gives are the same row on
 * purpose: the player who reads it greyed out under `SPARK 55 CR` and the
 * player who presses the key anyway are being told the same thing.
 */
const RACK_FULL = "why.rack.hullFull";

const BROKE_KEY = "log.voyage.broke";
const WON_KEY = "log.voyage.won";
const LOST_KEY = "log.drone.lost";
const TO_TUG_KEY = "log.voyage.home";
const UNDOCK_KEY = "log.voyage.undock";

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

/**
 * A line of the tug's list costs a turn, like everything else. Measured, and
 * kept (docs/tasks/G53-tug-is-a-menu.md, 3).
 *
 * The case for making it free is good on paper: nothing lives on the tug
 * (`systems/tug.ts` clears the deck), there is no alert and nothing is walking
 * down a corridor, so a turn spent buying a hull is a counter going up and
 * not a risk taken. It was written, and it does not survive contact with two
 * things.
 *
 * The engine spends `cost || TURN_COST`, so "free" has to be a cost of one —
 * a hundredth of a turn — and a hundredth of a turn is *banked*. A drone that
 * presses a dozen lines at home crosses the airlock with energy left over and
 * takes a move on the derelict before anything aboard it stirs. That is a free
 * hit bought with shopping, and the tug is the one place in the game where a
 * player can do as much of it as they like.
 *
 * And the number it was supposed to buy is not there. Measured over 200 seeds:
 * the median voyage runs 164 turns with the turn charged and 160 without,
 * because a visit home is now two to four lines rather than a dozen — the
 * walking is what the turns were going on, and the walking is gone. What the
 * free version did move was the jam's acceptance line, 7 wins in 200 down to 2
 * (`tests/winnable.test.ts`), through the scheduling above.
 *
 * So the complaint is answered by there being nothing to walk, not by a
 * discount: the tug went from a dozen commands a visit to a handful, and each
 * one of them still ticks the same clock everything else does.
 */
const FREE = DONE;

// ----------------------------------------------------------------- the state

/**
 * The bargain struck with the other tug over one hull (G34, `systems/rival.ts`).
 *
 * A flat string and nothing else, on purpose: it is written into the voyage
 * record, and the record has to survive `JSON.stringify` whole
 * (`tests/persistence.test.ts`). Three of them, from the owner's own list —
 * pay it off, take its money and stand aside, or split what the hull sells for.
 */
export type RivalDeal = "paid" | "sold" | "split";

/**
 * What the voyage remembers about one derelict.
 *
 * `alert` and `online` are snapshots taken the moment the drone left, not a
 * live mirror of the ship's own state: the tug has to print `DERELICT freighter
 * · alert 2 · engine ✓` while standing somewhere else entirely, and the ship
 * that would answer that question is not the one under the drone's feet.
 */
export interface DerelictState {
  spec: DerelictSpec;
  /** Its id in `RoomGame.ships`. */
  shipId: string;
  /** Alert as the last drone left it. */
  alert: number;
  /** Systems up as the last drone left it. */
  online: ObjectiveId[];
  /** Where drones died aboard and what they were carrying. G18 raises ghosts off these. */
  deaths: Array<{ room: RoomId; rig: Rig }>;
  /** How far the competitor got, 0..3. G27 moves it. */
  rivalProgress: number;
  /** True once the hull has been neutralised and taken under tow. */
  sold: boolean;
  /**
   * The three modules the dock has for sale while the tug is tied to this hull.
   *
   * On the hull's record and not on the voyage, so the shelf changes when the
   * tug moves and a player who wants a WELDER has to decide whether it is worth
   * the stay. Optional, because a save written before the shelf existed comes
   * back without one and an empty shelf is a legal shelf.
   *
   * It exists because there was no way to buy a module at all. Credits bought a
   * whole drone, mended one, grafted one and cured one — and could not buy a
   * single module, while the only module that mends another in the field drops
   * off a machine that no class of ship carried (`docs/adr/0003-decoupling.md`).
   * The owner, with four slots burned out and 151 CR on the account: «нет
   * магазина модулей».
   */
  stock?: ModuleId[];
  /**
   * Credits banked out of this hull over every sortie flown to it. What a
   * `SALVAGE` charter counts, and the reason it is per hull and not per trip: a
   * charter is signed against a ship and may be filled over as many trips as
   * the drone survives.
   */
  banked: number;
  /**
   * The draw behind the line the HELM prints for it, as indices: the callsign
   * and two of the class's own words (`content/derelicts.ts`). Kept as numbers
   * so the line is written out in whatever language is on when it is read.
   */
  flavour: FlavourRoll;
  /**
   * The deal struck with the other tug on this hull, if one was. Absent until
   * it is — an optional field is a field a run that never met a competitor
   * does not carry, which is what keeps the recorded voyages of
   * `tests/replay.test.ts` fingerprinting the same record they always did.
   */
  deal?: RivalDeal;
}

/**
 * The run's record as it stands, or nothing — without writing one.
 *
 * `voyageOf` creates a voyage on first read, itinerary and all, and that draw
 * spends `game.rng`. The rival asks about the deal from inside the turn cycle,
 * on ships that may have no voyage at all (the hand-drawn hulls of
 * `tests/rival.test.ts`), so it asks through here: a question must never be
 * the thing that starts a run.
 */
export function voyageRecord(game: RoomGame): Voyage | undefined {
  const raw = game.player.data?.voyage;
  return isVoyage(raw) ? raw : undefined;
}

/** The record of the hull the drone is standing on, if the run has one. */
export function derelictAboard(game: RoomGame): DerelictState | undefined {
  return voyageRecord(game)?.state.find((s) => s.shipId === game.shipId);
}

/** Everything a run is, and nothing that outlives one. */
export interface Voyage {
  credits: number;
  /**
   * Modules the tug keeps for the next drone. At most `HOLD_LIMIT`. A module
   * that spends charges keeps its count through the hold, and a grafted one
   * keeps its graft: stowing a coil and fitting it again is not a recharge,
   * and stowing a grafted module is not a refund (`twist/rig.ts`, `Carried`).
   */
  hold: Array<{ kind: ModuleId; integrity: number; charges?: number; base?: number; bonus?: number }>;
  /** The drone on the rails, or nothing at all — which is half of losing. */
  hull?: HullId;
  /** Keycards the drone is carrying. Written by `systems/doors.ts`, read here. */
  keys: number;
  /** Credits the drone is carrying and has not banked. Lost with the drone. */
  loot: number;
  /** The itinerary. The last one is the father's tug (design-doc.md, "Победа"). */
  derelicts: DerelictSpec[];
  /** Index into `derelicts` the tug is docked to. */
  current: number;
  /** One entry per derelict visited, in itinerary order. */
  state: DerelictState[];
  /** The board at the HELM: charters going for the hull the tug is docked to. */
  offered: Charter[];
  /** The ones signed. Checked at the airlock, paid once. */
  charters: Charter[];
  /** Charters already paid on this hull, so none of them pays twice. */
  paid: CharterId[];
  /** Sorties flown this voyage: every undock, whatever came of it. */
  sortie: number;
  /**
   * Every stop of the itinerary as the hulls on offer there and the contracts
   * each one carries, drawn once with the itinerary (G90 F). `derelicts[i]` is
   * the one chosen, or the first while nothing has been.
   *
   * Optional, and a record without it is still a voyage: a save from before the
   * choice existed has one hull a stop and no contract on any of them
   * (`candidatesAt`).
   */
  stops?: Candidate[][];
  /**
   * True once the hull and contract of the stop the tug is at have been chosen:
   * at the first stop by `berth`, at every other by the `jump` that flew there.
   * A tug moved on by a hull that blew up arrives with nothing chosen.
   */
  berthed?: boolean;
  /** Contracts on this hull a clause has voided. Absent until one is. */
  voided?: CharterId[];
}

/** One hull on a stop's list, by class id, and the contracts it carries. */
export interface Candidate {
  hull: string;
  charters: Charter[];
}

/** A line of a stop's list: a hull, and the contract that line signs — or none. */
export interface ChoiceRow {
  spec: DerelictSpec;
  charter?: Charter;
  /** Is this the first line of its hull? The list prints the hull over it. */
  first: boolean;
}

/**
 * The run's own record, created on first use.
 *
 * In `player.data` rather than in a module variable: a module variable would
 * survive `new RoomGame` and break replay, and the drone's pocket is the one
 * thing that carries from derelict to derelict. `keys` and `loot` are the two
 * numbers three other systems write through `player.data` (a searched body, a
 * system's advance, a stripped bloom), so they are read in here on every access
 * rather than mirrored on every write — one source of truth, refreshed at the
 * only place it is read from.
 */
export function voyageOf(game: RoomGame): Voyage {
  const data = (game.player.data ??= {});
  const raw = data.voyage;
  const voyage = isVoyage(raw) ? raw : fresh(game);
  data.voyage = voyage;
  voyage.keys = keysHeld(game.player);
  voyage.loot = lootHeld(game.player);
  return voyage;
}

/** The pocket round-trips through a save file, so nothing in it is trusted. */
function isVoyage(raw: unknown): raw is Voyage {
  if (typeof raw !== "object" || raw === null) return false;
  const v = raw as Partial<Voyage>;
  return (
    typeof v.credits === "number" &&
    Array.isArray(v.hold) &&
    Array.isArray(v.derelicts) &&
    Array.isArray(v.state) &&
    typeof v.current === "number" &&
    typeof v.sortie === "number"
  );
}

/** Where the contracts of every candidate are drawn from: a fork, so the run's rng spends nothing. */
const CONTRACT_SALT = 0xc0a7;

function fresh(game: RoomGame): Voyage {
  // Three stops, drawn once: two or three starting hulls, two or three of the
  // five in between, and the father's tug (design-doc.md, "Типы дереликтов";
  // G90 F). The first hull of every stop is the one the itinerary has always
  // drawn, out of the same numbers.
  const stops = stopsForVoyage(game.rng);
  const drawn = stops.map((hulls) => hulls[0]!);
  const deal = game.rng.fork(CONTRACT_SALT);
  const offered: Candidate[][] = stops.map((hulls, stop) =>
    hulls.map((spec) => ({ hull: spec.id, charters: contractsFor(spec, stop, deal) })),
  );
  // A training run puts a hull built to be learned on in *front* of them — six
  // compartments, one machine, one bulkhead, three systems (`content/tutorial.ts`,
  // docs/tasks/G69-tutorial.md). The draw above still happens and still costs
  // the rng exactly what it always did, so a seed is the same voyage from the
  // second hull on; the training flag reaches here on the drone itself, because
  // this runs inside the constructor.
  //
  // Added rather than swapped in, which it used to be, and the difference is a
  // starter hull: the training hull sells for 60 CR against the 150–220 of the
  // one it was displacing, so the lesson cost the player the best-paying wreck
  // of the voyage. Measured over 40 careful runs it cost 20.5 CR and left the
  // itinerary a hull short; prepending is the same voyage with a lesson in
  // front of it (docs/tasks/G86-tutorial-and-title.md, 7).
  const training = isTraining(game.player);
  const derelicts = training ? [TUTORIAL_SPEC, ...drawn] : drawn;
  const first = derelicts[0]!;
  return {
    credits: STARTING_CREDITS,
    hold: [],
    hull: STARTING_HULL.id,
    keys: 0,
    loot: 0,
    derelicts,
    current: 0,
    state: [freshDerelict(game, first, game.shipId === TUG_ID ? FIRST_DERELICT_ID : game.shipId)],
    offered: [],
    charters: [],
    paid: [],
    sortie: 0,
    stops: training ? [[{ hull: TUTORIAL_SPEC.id, charters: [] }], ...offered] : offered,
  };
}

function freshDerelict(game: RoomGame, spec: DerelictSpec, shipId: string): DerelictState {
  return {
    spec,
    shipId,
    alert: spec.alertStart,
    online: [],
    deaths: [],
    rivalProgress: 0,
    sold: false,
    banked: 0,
    stock: rollStock(game),
    flavour: rollFlavour(spec, game.rng),
  };
}

/**
 * What the dock has on the shelf, every stay: the three modules a run cannot
 * continue without, and nothing else.
 *
 * The owner picked them and gave the reason in the same breath: «только резак,
 * броня и двигатель, притом дорогие — иначе отсутствие резака дедлочит
 * обезвреживание дереликта». He is right, and it is the only true deadlock in
 * the game: a ship's drive takes a CUTTER or a WELDER and nothing else, so a
 * drone whose cutter burned out and whose account cannot reach a whole new hull
 * has no way to raise a system on any hull, ever. The other two are the same
 * argument one step softer — with the PLATING gone the next blow is at the core,
 * and with the THRUSTERS gone the drone walks at eighty for the rest of the run.
 *
 * Not a shop. `docs/scope-rules.md` forbids one, and what that rule is written
 * against is an interface with a catalogue, quantities and a screen of its own;
 * this is three fixed lines in the list the dock already has, priced above a
 * whole drone on purpose.
 *
 * Three per hull, and a module bought is gone until the tug moves on: the
 * shelf is a way out of a hole, not a supply line.
 */
function rollStock(_game: RoomGame): ModuleId[] {
  return [...SHELF];
}

/**
 * The dock's shelf: three modules, always listed, live only for a module the
 * drone has lost.
 */
function shelfOffers(
  game: RoomGame,
  voyage: Voyage,
  rig: Rig | undefined,
): Array<ActionOffer<RoomCommand>> {
  const out: Array<ActionOffer<RoomCommand>> = [];

    // The shelf belongs to the hull the tug is tied to, and a run being fuzzed
    // can be at neither: read it, never demand it.
    // Always all three, and greyed rather than gone.
    //
    // They used to disappear the moment the drone had one, which is the only
    // state a whole drone is ever in — so a player with a full rack never saw
    // the shelf at all and could not know it existed. The owner, four hours in:
    // «магаз модулей где?».
    //
    // Greyed is not the same as absent, and the difference is what the balance
    // hangs on: a line nobody can press is a line the harness does not press
    // either, and an *enabled* shelf took it from 10 hulls towed of 32 down to
    // 3, because a bot with 45 CR buys whatever is in front of it. So the row
    // is always visible and only ever live for a module the drone has lost.
    const room = voyage.hold.length < HOLD_LIMIT;
    (voyage.state[voyage.current]?.stock ?? []).forEach((id, i) => {
      const price = stockPrice(id);
      const spare = holds(voyage, rig, id);
      // A module is for a drone, and with no drone the answer is a drone: a
      // whole hull with a whole rack is 40 CR against 20 for one CUTTER.
      const noDrone = voyage.hull === undefined;
      const why = noDrone
        ? t("why.stock.noDrone")
        : spare
          ? t("why.stock.spare", { module: moduleName(id) })
          : room
            ? t(NOT_ENOUGH)
            : t("why.hold.full", { n: HOLD_LIMIT });
      out.push(
        offer(
          t("action.order", { module: moduleName(id), price }),
          { kind: "act", verb: "order", target: STOCK_TARGET + i },
          !noDrone && !spare && room && voyage.credits >= price,
          why,
        ),
      );
    });
  return out;
}

/** Is this module already aboard — in the rack, or waiting in the hold? */
function holds(voyage: Voyage, rig: Rig | undefined, id: ModuleId): boolean {
  if (rig !== undefined && findSlot(rig, id) !== null) return true;
  return voyage.hold.some((held) => held.kind === id);
}

/** The three, in the order the dock lists them. */
const SHELF: readonly ModuleId[] = ["cutter", "plating", "thrusters"];

/**
 * What the dock charges — and the ceiling on it is measured, not chosen.
 *
 * The owner asked for these to be dear («притом дорогие»), and dear is what the
 * economy will not carry: a voyage banks about 120 CR and a jump to the next
 * hull costs 30, so every credit on the shelf competes with reaching the
 * father's tug at all. Measured over 200 seeds, the share of voyages that get
 * to the last hull against the price of a CUTTER:
 *
 *   12 CR → 53 %      20 CR → 47 %      25 CR → 38 %      45 CR → 28 %
 *
 * At 25 the harness tows 8 hulls of 32 against the 10 the suite holds it to, and
 * at 30 and above it stops winning three voyages of 200, which is the jam's
 * acceptance line. Twenty is the top of what the run can pay: two thirds of a
 * jump, enough to hurt, and short of the price that quietly ends the voyage two
 * hulls early.
 */
const SHELF_PRICE: Readonly<Record<string, number>> = { cutter: 20, plating: 15, thrusters: 15 };

/** The price of one module on the shelf, as the list prints it. */
export function stockPrice(id: ModuleId): number {
  return SHELF_PRICE[id] ?? moduleKind(id).price ?? 40;
}

/** The derelict the tug is docked to. Every voyage has one. */
export function currentDerelict(game: RoomGame): DerelictState {
  const voyage = voyageOf(game);
  const state = voyage.state[voyage.current];
  if (!state) throw new Error("VOYAGE: the voyage has no derelict to be docked to");
  return state;
}

/** The derelict the drone is standing on, or nothing when it is on the tug. */
function stateOfShip(game: RoomGame): DerelictState | undefined {
  return voyageOf(game).state.find((s) => s.shipId === game.shipId);
}

// ---------------------------------------------------------------- the charters

/**
 * The tug ties on to a hull: a board of two or three charters at the HELM, and
 * the line that says what the hull is.
 *
 * Called once per hull of the itinerary — at the start of the run and on every
 * `jump` — and never on the way home from a sortie. A board that redrew itself
 * every time the drone came back would be a slot machine, and the charters have
 * to exist *before* the ship does: a `RETRIEVE` crate is put aboard by the deck
 * when the hull is generated (design-doc.md, "Чартеры").
 */
function dock(game: RoomGame): void {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);

  clearCharterFlags(game);
  // The board this used to draw is gone: a hull's contracts are chosen with the
  // hull itself, on the stop's list (`rowsAt`), one a ship. It is still rolled
  // and thrown away, so that one seed stays one voyage: the ships, machines and
  // keycards of a run come out of the numbers after this draw, and a run that
  // takes the first line of every list is the run the seed has always been.
  offerCharters(state.spec, game.rng);
  voyage.offered = [];
  voyage.charters = [];
  voyage.paid = [];
  delete voyage.voided;
  game.log.add(
    t("log.helm.board", { flavour: flavourLine(state.spec, state.flavour) }),
    game.schedule.time,
    "plain",
    "log.helm.board",
  );
  dockedTo(game);
}

/**
 * Charter flags are the run's, and a run outlives a hull: the crate the
 * laboratory owed is not owed by the corsair after it. Dropped on every dock,
 * which is the only moment a new hull can still be generated.
 */
function clearCharterFlags(game: RoomGame): void {
  for (const flag of [...game.flags]) {
    if (flag.startsWith(CHARTER_FLAG)) game.flags.delete(flag);
  }
}

/** Has anything been aboard this hull yet? Signing ends when the hull exists. */
function boarded(game: RoomGame): boolean {
  return game.ships.get(currentDerelict(game).shipId) !== undefined;
}

// ------------------------------------------------------------------ the stops

/**
 * The hulls on offer at one stop, resolved to classes this build knows.
 *
 * A record that does not line up with its own itinerary — a save from before
 * the choice, a test that set `derelicts` by hand — is one hull and no
 * contract, which is exactly what such a voyage always was.
 */
function candidatesAt(voyage: Voyage, stop: number): Array<{ spec: DerelictSpec; charters: Charter[] }> {
  const here = voyage.derelicts[stop];
  if (!here) return [];
  const listed = voyage.stops?.length === voyage.derelicts.length ? (voyage.stops[stop] ?? []) : [];
  const known = listed.flatMap((c) => {
    const spec = typeof c?.hull === "string" ? derelictSpec(c.hull) : undefined;
    return spec === undefined ? [] : [{ spec, charters: Array.isArray(c.charters) ? c.charters : [] }];
  });
  return known.some((c) => c.spec.id === here.id) ? known : [{ spec: here, charters: [] }];
}

/**
 * One stop's list, line by line: each hull's contracts, plain first, then the
 * line that flies there with none. A line is a hull and a contract together —
 * choosing it signs that contract and only that one (G90 F, 3).
 */
export function rowsAt(voyage: Voyage, stop: number): ChoiceRow[] {
  return candidatesAt(voyage, stop).flatMap(({ spec, charters }) => [
    ...charters.map((charter, i) => ({ spec, charter, first: i === 0 })),
    { spec, first: charters.length === 0 },
  ]);
}

/**
 * Is this stop's choice still open? A voyage starts tied to the first hull on
 * its list — and a tug a blown hull moved on arrives tied to the next stop's
 * first — and until something has been aboard it the player may take another
 * hull of the stop, and a contract with it, once.
 */
export function berthOpen(game: RoomGame): boolean {
  const voyage = voyageOf(game);
  return voyage.berthed !== true && !boarded(game) && !currentDerelict(game).sold;
}

/** The stop a list of `verb` is about: the first one while it is open, the next one after. */
function stopOf(game: RoomGame, verb: string): number | undefined {
  const voyage = voyageOf(game);
  if (verb === "berth") return berthOpen(game) ? voyage.current : undefined;
  if (verb !== "jump" || berthOpen(game)) return undefined;
  return voyage.derelicts[voyage.current + 1] === undefined ? undefined : voyage.current + 1;
}

/** Which line of which stop a command is aimed at, or nothing for one written elsewhere. */
function rowOf(game: RoomGame, stop: number, target: number | undefined): ChoiceRow | undefined {
  const rows = rowsAt(voyageOf(game), stop);
  // A bare command is the first hull with no contract: what a voyage flew to
  // before there was a list, and what an old recording presses.
  if (target === undefined) return rows.find((r) => r.charter === undefined) ?? rows[0];
  const at = target - CHOICE_TARGET - stop * CHOICE_STRIDE;
  return at >= 0 && at < CHOICE_STRIDE ? rows[at] : undefined;
}

/**
 * `act berth {line}`: the hull and contract of the stop the tug is at, chosen
 * before anything has been aboard. Another hull of the stop replaces the one
 * the tug is tied to; the same hull keeps everything it had.
 */
export function berth(game: RoomGame, target?: number): Outcome {
  const voyage = voyageOf(game);
  if (!berthOpen(game)) return FAIL(t("why.berth.closed", { hull: derelictName(currentDerelict(game).spec) }));
  const stop = voyage.current;
  const row = rowOf(game, stop, target);
  if (!row) return FAIL(t("why.choice.none"));

  if (row.spec.id !== voyage.derelicts[stop]!.id) {
    voyage.derelicts[stop] = row.spec;
    voyage.state[stop] = freshDerelict(game, row.spec, voyage.state[stop]!.shipId);
    dock(game);
  }
  voyage.berthed = true;
  sign(game, row.charter);
  return FREE();
}

/**
 * The contract a stop leads with: the first line of its first hull. A tug that
 * arrives somewhere without a choice — the start of a voyage, or moved on by a
 * hull that blew up — is signed for it, and the stop's list stays open to take
 * another line until something has been aboard.
 */
function leadingCharter(voyage: Voyage, stop: number): Charter | undefined {
  const here = voyage.derelicts[stop];
  return rowsAt(voyage, stop).find((r) => r.spec.id === here?.id)?.charter;
}

/** The one contract of this hull, or none — said either way. */
function sign(game: RoomGame, charter: Charter | undefined): void {
  const voyage = voyageOf(game);
  clearCharterFlags(game);
  voyage.charters = charter === undefined ? [] : [charter];
  voyage.paid = [];
  delete voyage.voided;
  if (charter === undefined) {
    game.log.add(t("log.charter.none"), game.schedule.time, "plain", "log.charter.none");
    return;
  }
  for (const flag of charterFlags([charter])) game.flags.add(flag);
  game.log.add(t("log.charter.signed", { charter: charter.text }), game.schedule.time, "good", "log.charter.signed");
}

// ---------------------------------------------------------------- the clauses

/**
 * Rungs a `hot` hull is already up when the drone first walks in: two of the
 * five, four of the ten — the part of the ladder where the ship is listening
 * and has not yet started shutting doors.
 */
export const HOT_STEPS = Math.round((MAX_LEVEL * 2) / 5);

/** The rung that voids a `quiet` contract: three of five, six of ten. */
export const QUIET_AT = Math.ceil((MAX_LEVEL * 3) / 5);

/** The contract on this hull with this clause, while it can still be paid. */
function openClause(game: RoomGame, clause: ClauseId): Charter | undefined {
  const voyage = voyageOf(game);
  return voyage.charters.find(
    (c) => c.clause === clause && !voyage.paid.includes(c.id) && !(voyage.voided ?? []).includes(c.id),
  );
}

/** A contract its clause has broken: never paid, and said once, with why. */
function voidCharter(game: RoomGame, charter: Charter): void {
  const voyage = voyageOf(game);
  (voyage.voided ??= []).push(charter.id);
  const clause = charter.clause ?? CLAUSES[0]!;
  game.log.add(
    tId("log.charter.void", clause, "", { charter: charterName(charter), n: QUIET_AT }),
    game.schedule.time,
    "bad",
    `log.charter.void.${clause}`,
  );
}

/** A `quiet` contract dies the turn the gauge of its hull reaches `QUIET_AT`. */
function checkQuiet(game: RoomGame): void {
  if (isTug(game) || stateOfShip(game) !== voyageOf(game).state[voyageOf(game).current]) return;
  const quiet = openClause(game, "quiet");
  if (quiet && alertState(game).level >= QUIET_AT) voidCharter(game, quiet);
}

/** Has this contract been voided on this hull? */
export function charterVoided(game: RoomGame, charter: Charter): boolean {
  return (voyageOf(game).voided ?? []).includes(charter.id);
}

/** What the board, the log and the panel call a charter: one shouted word. */
function charterName(charter: Charter): string {
  return tId("charter.name", charter.id, charter.id.toUpperCase());
}

/** The one word, and the clause's word after it when the contract carries one. */
export function charterTag(charter: Charter): string {
  const name = charterName(charter);
  return charter.clause === undefined
    ? name
    : t("charter.tag", { charter: name, clause: tId("charter.clause", charter.clause, charter.clause) });
}

/** A line of a stop's list: the contract and what it pays, or the hull with none. */
function choiceLabel(row: ChoiceRow): string {
  return row.charter === undefined
    ? t("action.choice.none", { hull: derelictName(row.spec) })
    : t("action.choice", { charter: charterTag(row.charter), cr: row.charter.payout });
}

/**
 * The hull printed over its own lines of a stop's list, aligned with
 * `stationTargets(verb)`: its name, how many compartments and what it sells for.
 * Nothing on the lines that are not a hull's first.
 */
export function choiceHeads(game: RoomGame, verb: string): Array<string | undefined> {
  const stop = stopOf(game, verb);
  if (stop === undefined) return [];
  return rowsAt(voyageOf(game), stop).map((row) =>
    row.first
      ? t("choice.head", {
          hull: derelictName(row.spec),
          rooms: `${row.spec.rooms[0]}-${row.spec.rooms[1]}`,
          cr: row.spec.salePrice,
        })
      : undefined,
  );
}

/**
 * What the tug's jump row is called. While the first stop is open it is the
 * choice of the first hull; after that, where a jump goes.
 *
 * It used to name the sale a jump walked away from — `drop 1/3, sale 120 CR` —
 * because that was the one thing the list below it could not say
 * (docs/problem-map-2026-09-11.md). There is no such jump any more: a hull
 * with anything still on it holds the tug until it is dealt with (`jumpHeld`),
 * and the greyed line says why instead.
 */
export function jumpRowLabel(game: RoomGame): string {
  if (berthOpen(game)) return t(voyageOf(game).current === 0 ? "action.pick.berth" : "action.pick.berthHere");
  return t("action.pick.jump", { price: JUMP_PRICE });
}

/** The stop a jump flies to now, and its hulls, for the board. Nothing past the last. */
export function nextStop(game: RoomGame): { stop: number; hulls: Array<{ spec: DerelictSpec; charters: Charter[] }> } | undefined {
  const voyage = voyageOf(game);
  const stop = stopOf(game, "berth") ?? stopOf(game, "jump");
  return stop === undefined ? undefined : { stop, hulls: candidatesAt(voyage, stop) };
}

/**
 * The charters this sortie filled, paid once each.
 *
 * `NEUTRALIZE` is not paid here: what it is worth is the hull itself, credited
 * a few lines later when the ship goes under tow (design-doc.md, "Чартеры": its
 * payout *is* the sale). Everything else pays on the way out through `a1` and
 * never on a drone that died with the job done.
 */
function payCharters(game: RoomGame, state: DerelictState): void {
  const voyage = voyageOf(game);
  const home = { loot: state.banked, online: state.online };

  for (const charter of voyage.charters) {
    if (charter.id === "neutralize" || voyage.paid.includes(charter.id)) continue;
    if ((voyage.voided ?? []).includes(charter.id)) continue;
    if (!doneBy(charter.id, home, game.ship, state.spec)) {
      // Said here, with what is missing: most signed charters never pay, and
      // until this line nothing on the screen ever said one had not
      // (docs/tasks/G87-playability.md, "Мелочи").
      const missed = tId("log.charter.missed", charter.id, "", {
        charter: charterName(charter),
        have: home.loot,
        need: salvageTarget(state.spec),
      });
      if (missed) game.log.add(missed, game.schedule.time, "warn", `log.charter.missed.${charter.id}`);
      // One trip, and this was it.
      if (charter.clause === "trip") voidCharter(game, charter);
      continue;
    }
    voyage.paid.push(charter.id);
    credit(game, charter.payout, t("log.charter.filled", { charter: charterName(charter) }));
  }
}

/** Has this charter been filled, as of the last time the drone came home? */
export function charterDone(game: RoomGame, charter: Charter): boolean {
  return charter.id === "neutralize"
    ? currentDerelict(game).sold
    : voyageOf(game).paid.includes(charter.id);
}

// ------------------------------------------------------------------ the purse

/** Credits the drone is carrying: the pocket every system aboard pays into. */
function lootHeld(player: Entity): number {
  const loot = player.data?.loot;
  return typeof loot === "number" ? loot : 0;
}

function setLoot(player: Entity, amount: number): void {
  (player.data ??= {}).loot = Math.max(0, amount);
}

function setKeys(player: Entity, keys: number): void {
  (player.data ??= {}).keys = Math.max(0, keys);
}

/** Money in, with the line that says where from. Never silent: it is the score. */
export function credit(game: RoomGame, amount: number, why: string, key = "log.credit"): void {
  if (amount <= 0) return;
  const voyage = voyageOf(game);
  voyage.credits += amount;
  game.log.add(
    t("log.credit", { why, amount, total: voyage.credits }),
    game.schedule.time,
    "good",
    key,
  );
}

/**
 * Money out. `false` means it was not there — and the caller must then refuse
 * without costing a turn, which is the whole reason this returns a boolean
 * instead of throwing: a station that eats a turn for a purchase the player
 * could not afford is a station that kills runs by accident.
 */
export function spend(game: RoomGame, amount: number): boolean {
  const voyage = voyageOf(game);
  if (voyage.credits < amount) return false;
  voyage.credits -= amount;
  return true;
}

/**
 * The sentence a station says when the money is there but spoken for, or
 * nothing at all when it is not.
 *
 * A hull that has gone under tow cannot be undocked into (`undock` refuses on
 * `state.sold`), so the one thing left to do at this tug is the 30 CR jump.
 * Every other station verb is a way of spending that 30 CR on a drone with
 * nowhere to fly it, and handing the rack back in does not raise it again — six
 * modules at `MODULE_PRICE` apiece is 24. A tug that spent its way under the
 * jump price is therefore a run that can neither go on nor end: with no sortie
 * there is no drone to lose, so the account never empties and `endIfBroke`
 * never fires. The player is left pressing keys at four compartments that all
 * say no.
 *
 * So the jump is kept back rather than the run being given a third ending: a
 * sale always clears the price several times over (120 CR at the cheapest, 60
 * on a split), which means the money is only ever lost at the bench — and the
 * bench is where it is now refused.
 *
 * With a line of its own, not `undock`'s. The two facts sit next to each other
 * and are not the same one: "the hull is under tow" is why there is nowhere to
 * fly *to*, and this is why the bench is greyed while the account plainly has
 * money on it. A player reading the first under a greyed `repair` would go
 * looking for the wrong thing.
 */
function jumpFirst(game: RoomGame): string | undefined {
  const voyage = voyageOf(game);
  const state = voyage.state[voyage.current];
  if (state?.sold !== true || !voyage.derelicts[voyage.current + 1]) return undefined;
  return t("why.jump.first", { price: JUMP_PRICE });
}

/**
 * The sentence the jump row says while the hull the tug is tied to is still
 * out there, or nothing once it is not.
 *
 * The owner's rule, word for word: «прыжок до разбора или самоуничтожения
 * дереликта ЗАБЛОЧЕН». A hull is done with in one of three ways — taken under
 * tow (`sold`), blown up under the drone at the top of the alert ladder
 * (`systems/alert.ts`, `detonated`), or taken by the other tug (`comeHome`,
 * `taken`) — and until one of them the tug stays. Before this the jump was
 * open the moment the account held 40 CR, and that is what it cost: a hull
 * with two systems up and a 120 CR sale on it left for a hull the drone had
 * not seen, and the tug at the father's hull with nothing to fly
 * (`testing/roombots.ts`, `goBack`, for what a bot had to learn about it).
 *
 * A hull nobody has boarded holds the tug too: the way to change one's mind
 * about a stop is `berth`, open exactly until something has been aboard. And
 * it never traps a run — with a drone on the rails `undock` is open for as
 * long as the hull is not sold, and with none the account either buys one or
 * the run is already over (`endIfBroke`, and the cheapest hull is the price of
 * a jump).
 */
function jumpHeld(game: RoomGame): string | undefined {
  const state = currentDerelict(game);
  if (dealtWith(game, state)) return undefined;
  return t("why.jump.held", { hull: derelictName(state.spec) });
}

/** Is this hull done with: under tow, blown, or on the other tug's line? */
function dealtWith(game: RoomGame, state: DerelictState): boolean {
  if (state.sold || detonated(game, state.shipId)) return true;
  return state.deal === undefined && state.rivalProgress >= OBJECTIVE_COUNT;
}

/** Can the account pay this without eating the jump it may still need? */
function affordable(game: RoomGame, price: number): boolean {
  const held = jumpFirst(game) === undefined ? 0 : JUMP_PRICE;
  return voyageOf(game).credits - held >= price;
}

/** Why a station would refuse this price: spoken for, or simply not there. */
function whyNot(game: RoomGame, price: number): string {
  return affordable(game, price) ? t(NOT_ENOUGH) : (jumpFirst(game) ?? t(NOT_ENOUGH));
}

/**
 * Money out of a station's till: the reason it refused, or nothing at all.
 *
 * Every purchase at the tug goes through here rather than through `spend`, so
 * the jump is kept back in one place. `jump` itself is the exception and calls
 * `spend` directly — it is the thing being kept back for.
 */
function charge(game: RoomGame, price: number): string | undefined {
  if (!affordable(game, price)) return whyNot(game, price);
  return spend(game, price) ? undefined : t(NOT_ENOUGH);
}

/**
 * What a module is worth handed in: four credits, and nothing for the points of
 * integrity on it (`MODULE_PRICE`, `MODULE_PER_POINT`). The shape of the sum is
 * design-doc.md's and stays here as the one knob a balance pass turns.
 */
export function modulePrice(slot: Slot): number {
  return MODULE_PRICE + MODULE_PER_POINT * Math.max(0, slot.integrity - 1);
}

/** What a crate is worth: cargo 8, contraband 14. */
export function cratePrice(crate: Crate): number {
  return CRATE_PRICE[crate.kind] ?? CRATE_PRICE.cargo;
}

// ------------------------------------------------------------------ the drone

/**
 * Bolt a hull's own rack onto the drone and make it the one on the rails.
 *
 * A bought hull still comes with the five modules, and the owner asked for the
 * opposite — «покупной дрон приходит без модулей, надо ставить что принесёт
 * дрон с дереликта». It was built and measured and taken back out, because the
 * loop it needs does not exist yet: a drone cannot carry salvage home, so the
 * only bridge between one drone and the next is a hold of three. Over 32
 * voyages a bare chassis gives 2 hulls towed against 10, a median run of 99
 * turns against 222, and a quarter of the runs reaching the father's tug
 * against a half — because the second drone has no CUTTER and a ship's drive
 * takes nothing else. Empty hulls are the right design and they come after
 * carrying salvage home, not before (`docs/owner-queue.md`).
 */
function fitHull(game: RoomGame, hull: HullKind, stocked = false): void {
  const voyage = voyageOf(game);
  voyage.hull = hull.id;
  const data = (game.player.data ??= {});
  data.rig = rigFrom(stocked ? startingSlots() : hullSlots(hull), hull.slots);
  // The chassis, not the rack: a dearer drone is more room and more life, and
  // both are bolted on here because a hull is a purchase and not a mechanic.
  game.player.hpMax = hull.core;
  game.player.hp = hull.core;
  // Whatever the last drone was carrying, it was carrying: a fresh rack has no
  // infected slot, and a record pointing into the old one would twitch a module
  // this drone never installed.
  clearVirus(game.player);
  game.player.hp = game.player.hpMax;
  autoFit(game);
  applyDerived(game.player);
  game.refreshSight();
}

/**
 * Every empty slot filled from the hold, best first, the moment a hull goes on
 * the rails.
 *
 * The garage button the owner asked for («кнопка автоустановка модулей нужна в
 * гараже»), and the thing that makes a bare chassis playable at all: a drone
 * bought empty beside a hold with a CUTTER in it should not need six presses to
 * become a drone. Bolting it on at the moment of purchase is the same rule with
 * no button — there is no moment between buying a hull and wanting it fitted.
 *
 * Sturdiest first, so a hold with two CUTTERs puts the whole one on the rails.
 */
function autoFit(game: RoomGame): void {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  if (!rig || voyage.hold.length === 0) return;
  const order = [...voyage.hold].sort((a, b) => b.integrity - a.integrity);
  const fitted: typeof order = [];
  for (const held of order) {
    const slot = rig.slots.findIndex((s) => s === null);
    if (slot < 0) break;
    // The module as the hold kept it, integrity and charges alike: a coil
    // comes out with the count it went in with, never recharged.
    // Built by the rack's own hand rather than here: a slot assembled by this
    // file went in unclamped and without its `base`, so a hull's sturdier copy
    // came back as integrity above its own cap — and the rack drew that as a
    // negative repeat count and took the screen down with it (found by the
    // swarm on seed 7, step 115).
    installAt(rig, slot, held.kind, held.integrity, held.charges, held.base, held.bonus);
    fitted.push(held);
  }
  if (fitted.length === 0) return;
  voyage.hold = voyage.hold.filter((held) => !fitted.includes(held));
  game.log.add(
    t("log.hold.fitted", { n: fitted.length }),
    game.schedule.time,
    "good",
    "log.hold.fitted",
  );
}

/**
 * `act buy {hull}`: a drone off the rack.
 *
 * Only with the rails empty — a voyage flies one drone at a time, and buying a
 * second would be a way of carrying two racks, which is the one thing the
 * twist must never allow.
 */
export function buyHull(game: RoomGame, id: HullId): Outcome {
  const voyage = voyageOf(game);
  if (voyage.hull !== undefined) return FAIL(t(RACK_FULL));

  const hull = hullKind(id);
  if (!hull) return FAIL(t("why.hull.none"));
  const no = charge(game, hull.price);
  if (no !== undefined) return FAIL(no);

  fitHull(game, hull);
  game.log.add(
    t("log.hull.bought", { hull: hullName(hull), trait: hullTrait(hull), credits: voyage.credits }),
    game.schedule.time,
    "good",
    "log.hull.bought",
  );
  return FREE();
}

/**
 * `act repair {slot}`: a module mended whole, a credit a point.
 *
 * Whole and not a point at a time. A point a press was twelve presses and
 * twelve log lines to mend one THRUSTERS, and the arithmetic on top of it made
 * the bench dearer than the rack it was mending (see `REPAIR_PRICE`).
 */
export function repair(game: RoomGame, slot: number): Outcome {
  const module = slotAt(game, slot);
  if (!module) return FAIL(t("why.slot.empty"));
  // A relic is mended by nothing, the bench included (`content/modules.ts`, `relic`).
  if (isRelic(module.kind)) return FAIL(t("why.relic.noRepair", { module: moduleName(module.kind) }));
  if (module.integrity >= capOf(module)) return FAIL(t("why.module.whole", { module: moduleName(module.kind) }));
  const no = charge(game, repairPrice(module));
  if (no !== undefined) return FAIL(no);

  module.integrity = capOf(module);
  applyDerived(game.player);
  game.log.add(
    t("log.bench.repair", { module: moduleName(module.kind), left: module.integrity, max: capOf(module) }),
    game.schedule.time,
    "good",
    "log.bench.repair",
  );
  return FREE();
}

/**
 * `act graft {slot}`: a point of ceiling as well as a point of integrity, 12 CR.
 *
 * The ceiling is the rack's own rule (`twist/rig.ts`, `MAX_GRAFT`): two over
 * whatever this hull's copy of the module is worth, and no sequence of purchases
 * gets past it — which is what keeps money from turning into a bigger number.
 */
export function graft(game: RoomGame, slot: number): Outcome {
  const module = slotAt(game, slot);
  if (!module) return FAIL(t("why.slot.empty"));
  const rig = rigOf(game.player)!;
  if (isRelic(module.kind)) return FAIL(t("why.relic.noRepair", { module: moduleName(module.kind) }));
  if (!canGraft(module)) return FAIL(t("why.module.grafted", { module: moduleName(module.kind) }));
  const no = charge(game, GRAFT_PRICE);
  if (no !== undefined) return FAIL(no);

  const done = graftOn(rig, slot)!;
  applyDerived(game.player);
  game.log.add(
    t("log.bench.graft", { module: moduleName(done.kind), left: done.integrity, max: done.max }),
    game.schedule.time,
    "good",
    "log.bench.graft",
  );
  return FREE();
}

/**
 * `act clean {slot}`: the bench burns the ship's virus out of a module.
 *
 * What a virus is and how it is purged in the field belongs to
 * `systems/virus.ts`; the tug's half of it is money — its price, charged before
 * anything is cleared, and refused without a turn when there is nothing to
 * clean.
 */
export function clean(game: RoomGame, slot: number): Outcome {
  const module = slotAt(game, slot);
  if (!module) return FAIL(t("why.slot.empty"));
  if (infectedSlot(game) !== slot) return FAIL(t("why.module.clean", { module: moduleName(module.kind) }));
  const no = charge(game, BENCH_CURE_PRICE);
  if (no !== undefined) return FAIL(no);

  clearVirus(game.player);
  game.log.add(
    t("log.bench.clean", { module: moduleName(module.kind) }),
    game.schedule.time,
    "good",
    "log.bench.clean",
  );
  return FREE();
}

/**
 * `act sell {slot}`: a module out of the rack and gone for good.
 *
 * An infected one fetches half, which is the third way out of a virus and the
 * only one that pays: cure it for 4 CR, purge it by hand for six turns in the field, or
 * take what somebody else's problem is worth.
 *
 * Gone for good is the whole of what this line had to start saying. There is no
 * shop in this game and there is not going to be one (docs/scope-rules.md), so
 * a sold module is not coming back — and until G53 the Russian log line for it
 * read «Сдано в трюм», the hold, which is where a module goes when it is
 * *kept*. The owner sold his cutter, read that, and spent the rest of the run
 * looking for the line that buys it back: «я продал резак и не понимаю, как
 * купить его обратно». Both halves of that are fixed here — the line is honest
 * in all three languages, and `stow` is the thing he was actually looking for.
 */
export function sellSlot(game: RoomGame, slot: number): Outcome {
  const rig = rigOf(game.player);
  const module = slotAt(game, slot);
  if (!rig || !module) return FAIL(t("why.slot.empty"));

  const sick = infectedSlot(game) === slot;
  const price = sellPrice(module, sick);
  removeSlot(rig, slot);
  if (sick) clearVirus(game.player);
  applyDerived(game.player);
  const module_ = moduleName(module.kind);
  credit(game, price, sick ? t("log.hold.sell.sick", { module: module_ }) : t("log.hold.sell", { module: module_ }));
  // Once a run, on the first sale, and after it rather than before: the rule is
  // that a hint is said on the turn the rule behind it first costs something
  // (`content/hints.ts`). One module is what that lesson is allowed to cost.
  hint(game, "sell");
  return FREE();
}

/** What a module fetches: half of it when it carries the virus. */
export function sellPrice(slot: Slot, sick = false): number {
  const price = modulePrice(slot);
  return sick ? Math.max(1, Math.floor(price * INFECTED_SELL_SHARE)) : price;
}

/**
 * `act stow {slot}`: a module off the rack and into the tug's hold, whole and
 * for nothing.
 *
 * The half of the hold that was written and unreachable. `HOLD_LIMIT` has been
 * three since G19 and `fitFromHold` has been correct for as long, but nothing
 * in the game ever *put* anything in `voyage.hold` — so the line that fits one
 * back could not appear, the cap capped nothing, and the only thing the player
 * could do with a module they did not want to fly with was sell it
 * (docs/tasks/G53-tug-is-a-menu.md, 4).
 *
 * Free, and deliberately so. Moving a module between your own rack and your own
 * hold is not a transaction — there is nobody to pay — and charging for it
 * would make selling the cheaper way to change a rack, which is the exact
 * mistake this exists to undo. What it costs is the slot in the hold: three,
 * shared with whatever else a voyage ever puts there.
 */
export function stowSlot(game: RoomGame, slot: number): Outcome {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  const module = slotAt(game, slot);
  if (!rig || !module) return FAIL(t("why.slot.empty"));
  if (voyage.hold.length >= HOLD_LIMIT) return FAIL(t("why.hold.full", { n: HOLD_LIMIT }));
  // Never the last one. A rack with nothing in it is a drone that can walk and
  // swing and do nothing else, and stowing does not even pay for the next hull
  // the way selling does — so this is the one line of the tug that would let a
  // player quietly build a drone with no game in it.
  if (fullSlots(rig) <= 1) return FAIL(t("why.rig.last"));

  // A stowed module keeps its integrity, its charges and its graft: what the
  // hold holds is the module, and the bench's points were paid for the module.
  // They used to stay on the rails — the hold did not carry `bonus` — so a
  // grafted 12/12 came back out as 11/11 while the log still said 12
  // (docs/tasks/G88-polish-by-map.md, A3).
  const max = capOf(module);
  removeSlot(rig, slot);
  // The virus is the rack's, not the module's, and a rack with a hole in it is
  // not carrying one: handing the sick module to the hold would put the mark on
  // whatever moves up into the slot.
  if (infectedSlot(game) === slot) clearVirus(game.player);
  voyage.hold.push(carriedFrom(module.kind, module.integrity, module.charges, module.base, module.bonus));
  applyDerived(game.player);
  game.log.add(
    t("log.hold.stow", { module: moduleName(module.kind), integrity: module.integrity, max }),
    game.schedule.time,
    "good",
    "log.hold.stow",
  );
  return FREE();
}

/**
 * `act order {i}`: the i-th module off the dock's shelf, paid for, into the
 * tug's hold.
 *
 * Into the hold and never straight onto the drone, and that is the answer to
 * the owner's other question — «не понял, как таскать модули к себе не
 * экипируя, чтобы потом переодевать». Buying puts the thing in the hold, and
 * `fit` takes it out: one place where modules wait, reached by the verb that
 * fills it. Nobody has to be told the hold exists if the shop is its front door.
 *
 * The shelf keeps what was taken off it: a module bought is a module gone, so a
 * stay cannot be milked for three WELDERs.
 */
function buyModule(game: RoomGame, index: number): Outcome {
  const voyage = voyageOf(game);
  const state = voyage.state[voyage.current];
  const shelf = state?.stock ?? [];
  const id = shelf[index];
  if (id === undefined) return FAIL(t("why.stock.none"));
  // The same refusals, in the same order, as the greyed line gives
  // (`shelfOffers`): the list and the command must say one thing.
  if (voyage.hull === undefined) return FAIL(t("why.stock.noDrone"));
  if (holds(voyage, rigOf(game.player), id)) {
    return FAIL(t("why.stock.spare", { module: moduleName(id) }));
  }
  if (voyage.hold.length >= HOLD_LIMIT) return FAIL(t("why.hold.full", { n: HOLD_LIMIT }));
  const price = stockPrice(id);
  if (!spend(game, price)) return FAIL(t(NOT_ENOUGH));

  shelf.splice(index, 1);
  if (state) state.stock = shelf;
  const kind = moduleKind(id);
  voyage.hold.push({ kind: id, integrity: kind.integrity });
  game.log.add(
    t("log.stock.buy", { module: moduleName(id), price, credits: voyage.credits }),
    game.schedule.time,
    "good",
    "log.stock.buy",
  );
  return FREE();
}

/** `act fit {i}`: a module out of the tug's hold and into an empty slot. */
export function fitFromHold(game: RoomGame, i: number): Outcome {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  const held = voyage.hold[i];
  if (!rig || voyage.hull === undefined) return FAIL(t("why.hold.noDrone"));
  if (!held) return FAIL(t("why.hold.none"));

  const slot = install(rig, held.kind, held.integrity, held.charges, held.base, held.bonus);
  if (slot === undefined) return FAIL(t("why.rack.full"));

  voyage.hold.splice(i, 1);
  applyDerived(game.player);
  // The number on the rails, not the number in the hold: the rack clamps what
  // it is handed, and a line that repeats the hold's figure is a line that
  // can lie about what was just bolted on.
  const fitted = rig.slots[slot]!;
  game.log.add(
    t("log.hold.fit", { module: moduleName(fitted.kind), integrity: fitted.integrity, slot: slot + 1 }),
    game.schedule.time,
    "good",
    "log.hold.fit",
  );
  return FREE();
}

/**
 * Can this module take another graft? The rack's own ceiling, asked before the
 * money changes hands: two points over whatever this hull's copy of the module
 * is worth, whether they were bought or scavenged.
 */
function canGraft(slot: Slot): boolean {
  return (slot.bonus ?? 0) < MAX_GRAFT;
}

function slotAt(game: RoomGame, slot: number): Slot | undefined {
  const rig = rigOf(game.player);
  return rig ? (rig.slots[slot] ?? undefined) : undefined;
}

/** How many modules are on the rails right now. */
function fullSlots(rig: Rig): number {
  return rig.slots.filter((s) => s !== null).length;
}

/** Which slot the drone's one virus is sitting in, if it has one at all. */
function infectedSlot(game: RoomGame): number | undefined {
  return virusOf(game.player)?.slot;
}

// ------------------------------------------------------------------- the tug

/**
 * Which hull the tug is tied to, written on the tug's own store entry.
 *
 * The schematic is what reads it: standing at the airlock, the window shows the
 * derelict as the last drone left it rather than the four rooms of home
 * (design-doc.md, "Буксир"). A store id rather than the state itself, because
 * the pocket round-trips through a save and a drawing has to survive one.
 */
function dockedTo(game: RoomGame): void {
  if (!isTug(game)) return;
  game.currentShip.data.from = currentDerelict(game).shipId;
  // What the heading and the line under the schematic call the hull on the
  // other side of `a1`. A tag rather than a lookup, because the store entry of
  // that hull does not exist until something has undocked into it, and the
  // first screen of a run is exactly the case where it has not.
  game.currentShip.data.docked = currentDerelict(game).spec.id;
  // Its callsign as well as its class, for the banner across the top of the
  // schematic. Off the same line the HELM prints, so the board and the banner
  // never disagree about what the tug is tied to.
  game.currentShip.data.dockedName = flavourCallsign(currentDerelict(game).flavour);
}

/**
 * Out of the derelict, with the derelict left exactly as it stands.
 *
 * `custom` is this file travelling: answering it in `beforeLevelLeave` would be
 * an endless round trip through `travelTo`.
 */
export function returnToTug(game: RoomGame, reason: "airlock" | "death"): void {
  if (!isTug(game)) snapshot(game);
  if (reason === "airlock") {
    unload(game);
    game.log.add(t(TO_TUG_KEY), game.schedule.time, "warn", TO_TUG_KEY);
  }
  game.travelTo(TUG_ID, { generate: tugShip, reason: "custom" });
  dockedTo(game);
}

/**
 * What the drone walked out with, into the hold.
 *
 * Only through the airlock. A drone that does not come back does not deliver —
 * the modules it was carrying are on it, and they go where it goes, which is
 * the whole of what makes the walk home a decision (`CARRY_LIMIT`,
 * `twist/rig.ts`). What will not fit stays on the drone and rides out the next
 * sortie with it rather than evaporating at the door.
 */
function unload(game: RoomGame): void {
  const carried = carriedBy(game.player);
  if (carried.length === 0) return;
  const voyage = voyageOf(game);
  const room = Math.max(0, HOLD_LIMIT - voyage.hold.length);
  if (room === 0) return;
  const landed = carried.slice(0, room);
  voyage.hold.push(...landed.map((c) => carriedFrom(c.kind, c.integrity, c.charges, c.base, c.bonus)));
  setCarried(game.player, carried.slice(room));
  game.log.add(
    t("log.carry.home", { n: landed.length }),
    game.schedule.time,
    "good",
    "log.carry.home",
  );
}

/** What the tug knows about the hull it is docked to, as of this moment. */
function snapshot(game: RoomGame): void {
  const state = stateOfShip(game);
  if (!state) return;
  state.online = [...shipState(game).online];
  state.alert = alertState(game).level;
  state.rivalProgress = rivalState(game).progress;
}

/**
 * `act undock`, and the airlock of the tug: back aboard the current derelict,
 * generating it the first time the voyage goes there.
 *
 * One sortie is one of these, whatever comes of it — which is the number the
 * balance harness reads a voyage by.
 */
export function undock(game: RoomGame): Outcome {
  const voyage = voyageOf(game);
  if (!isTug(game)) return FAIL(t("why.undock.aboard"));
  if (voyage.hull === undefined) return FAIL(t("why.undock.noDrone"));

  const state = currentDerelict(game);
  if (state.sold) return FAIL(t("why.undock.sold", { hull: derelictName(state.spec) }));

  const index = voyage.current;
  const first = !boarded(game);
  voyage.sortie++;
  game.log.add(t(UNDOCK_KEY), game.schedule.time, "warn", UNDOCK_KEY);
  game.travelTo(state.shipId, {
    // The charters signed at the HELM are flags on the run by now, so the deck
    // puts their marks aboard as it draws the hull (`content/derelicts.ts`).
    generate: (rng) =>
      buildChartered(state.spec, index, rng, { flags: game.flags, shipIndex: index }).ship,
    reason: "custom",
  });
  // What the heading and the caption call this hull. Both fields have been read
  // by the screen since G31 and set by nobody, which is why every derelict a
  // player has ever boarded introduced itself as `SALVOR  derelict  sortie 1`
  // over `DERELICT · 13 rooms · 1 seen`. The callsign is the head of the line
  // the HELM already prints for it, so the board and the ship agree on a name.
  game.currentShip.data.derelict = state.spec.id;
  game.currentShip.data.name = flavourCallsign(state.flavour);
  game.currentShip.data.type = state.spec.id;
  // A hot hull is awake before the drone is through the airlock, once: the
  // gauge a contract put up is the ship's from then on, and falls like any other.
  const hot = first ? openClause(game, "hot") : undefined;
  if (hot) {
    game.log.add(t("log.charter.hot", { charter: charterName(hot), n: HOT_STEPS }), game.schedule.time, "warn", "log.charter.hot");
    raiseAlert(game, HOT_STEPS);
  }
  return FREE();
}

/**
 * `act jump`: the tug flies to the next hull of the itinerary, 40 CR.
 *
 * The tug moves, not the drone — the next derelict is generated the first time
 * something undocks into it. Neutralising the hull left behind used not to be
 * compulsory (design-doc.md, "Типы дереликтов"); since G92 the hull holds the
 * tug until it is under tow, blown, or the other tug's (`jumpHeld`).
 */
export function jump(game: RoomGame, target?: number): Outcome {
  const voyage = voyageOf(game);
  if (!isTug(game)) return FAIL(t("why.jump.aboard"));

  const next = voyage.current + 1;
  if (!voyage.derelicts[next]) return FAIL(t("why.jump.last"));
  const held = jumpHeld(game);
  if (held !== undefined) return FAIL(held);
  const row = rowOf(game, next, target);
  if (!row) return FAIL(t("why.choice.none"));
  if (!spend(game, JUMP_PRICE)) return FAIL(t(NOT_ENOUGH));
  moveOn(game, next, row.spec, row.charter);
  voyage.berthed = true;
  return FREE();
}

/**
 * The tug moves to stop `next` of the itinerary: to the hull and contract on
 * the line `jump` was pressed on, or — forced by a hull that is gone — to the
 * stop's first hull with no contract.
 */
function moveOn(game: RoomGame, next: number, spec: DerelictSpec, charter?: Charter): void {
  const voyage = voyageOf(game);
  // A contract is signed against one hull, so one signed here and not filled
  // is gone the moment the tug moves: named, rather than just dropped.
  const dropped = voyage.charters.filter((c) => !charterDone(game, c)).map(charterName);
  if (dropped.length > 0) {
    game.log.add(t("log.jump.left", { charters: dropped.join(", ") }), game.schedule.time, "warn", "log.jump.left");
  }

  voyage.current = next;
  voyage.derelicts[next] = spec;
  delete voyage.berthed;
  if (!voyage.state[next]) voyage.state[next] = freshDerelict(game, spec, String(next + 1));
  game.log.add(
    t("log.jump", { hull: derelictName(spec), credits: voyage.credits }),
    game.schedule.time,
    "warn",
    "log.jump",
  );
  dock(game);
  sign(game, charter);
}

/**
 * The hull blew itself up under the drone (`systems/alert.ts`, `detonate`):
 * it is off the itinerary. There is nothing left to be docked to, so the tug
 * moves on to the next hull for nothing — and if that was the last one, the
 * father's tug is gone and the voyage with it.
 */
function hullGone(game: RoomGame, state: DerelictState | undefined): void {
  const voyage = voyageOf(game);
  const hull = state === undefined ? "" : derelictName(state.spec);
  const next = voyage.current + 1;
  const spec = voyage.derelicts[next];
  if (spec === undefined || (state !== undefined && isLastHull(voyage, state))) {
    game.log.add(t("log.voyage.blownLast", { hull }), game.schedule.time, "bad", "log.voyage.blownLast");
    game.finish("dead", t("log.voyage.blownLast", { hull }));
    return;
  }
  game.log.add(t("log.voyage.blown", { hull }), game.schedule.time, "bad", "log.voyage.blown");
  moveOn(game, next, spec, leadingCharter(voyage, next));
}

// -------------------------------------------------------------- the crossings

/**
 * A sortie that ended at the airlock: what the drone carried is money, what it
 * raised may be a sale, and the derelict is still out there either way.
 */
function comeHome(game: RoomGame): void {
  const voyage = voyageOf(game);
  const state = stateOfShip(game);
  snapshot(game);

  const carried = lootHeld(game.player);
  if (carried > 0) {
    setLoot(game.player, 0);
    if (state) state.banked += carried;
    credit(game, carried, t("log.hold.emptied"));
    // The first hold that is worth anything explains the economy by being
    // sold: what it came to against what the next drone costs. Once, and then
    // never again — after this the player is doing the arithmetic themselves.
    // A sortie that came back empty has not earned the lesson yet: the number
    // in the line is the whole of it.
    hint(game, "sold", soldLine(carried, CHEAPEST_HULL.price));
  }
  // A charter is filled when the drone got out with it filled, and the airlock
  // is the only moment that is ever true (design-doc.md, "Чартеры").
  if (state) {
    checkQuiet(game);
    payCharters(game, state);
  }

  // Three systems and the drone out alive — unless another tug got all three
  // first, in which case the hull is theirs and the charter is gone with it
  // (design-doc.md, "Конкурент"). The small charters above are still paid: what
  // the competitor takes is the ship, not the errands.
  //
  // A hull with a deal on it is never taken out from under the drone, whichever
  // of the three was struck: a bargain is a claim, and the other tug stopped
  // racing you for this one the moment it took the money (G34).
  const taken = state?.deal === undefined && rivalState(game).progress >= OBJECTIVE_COUNT;
  // Out through the airlock with all three up and no money for it: said at the
  // airlock, because the line that explained it (`log.rival.lost`) was written
  // the turn the other tug finished and is twenty turns up the log by now. The
  // owner did the whole job and read nothing — "выход после полной активации не
  // продаёт второй корабль".
  if (state && taken && state.online.length >= OBJECTIVE_COUNT && !state.sold) {
    game.log.add(t("log.hull.taken", { hull: derelictName(state.spec) }), game.schedule.time, "bad");
  }
  const neutralised = state !== undefined && !taken && state.online.length >= OBJECTIVE_COUNT;
  if (state && neutralised && !state.sold) {
    state.sold = true;
    // Half, if the sale was split. The line says so as well as the number does:
    // a payout half what the class is worth, with nothing naming why, reads as
    // a bug on the one screen the player has (G34, `split the sale`).
    //
    // The sentence changes and the *event* does not: a hull going under tow is
    // one thing that happens, it makes one sound, and `tests/sfx.test.ts` reads
    // that key off this call.
    const split = state.deal === "split";
    const price = split ? Math.floor(state.spec.salePrice / 2) : state.spec.salePrice;
    const line = t(split ? "log.hull.tow.split" : "log.hull.tow", { hull: derelictName(state.spec) });
    credit(game, price, line, "log.hull.tow");
    // The last hull of the itinerary is the father's tug, and taking that one
    // is the whole voyage (design-doc.md, "Победа") — which is why it is the
    // one hull with no price on it: nothing ever pays for it.
    if (isLastHull(voyage, state)) {
      game.finish("won", t(WON_KEY));
      return;
    }
  }

  returnToTug(game, "airlock");
}

/**
 * By position, not by class: an itinerary may well hold two freighters, and
 * only one of them is the last thing this voyage will ever dock to.
 */
function isLastHull(voyage: Voyage, state: DerelictState): boolean {
  return voyage.state.indexOf(state) === voyage.derelicts.length - 1;
}

/**
 * The drone did not come back.
 *
 * Everything it was carrying stays aboard: the rack, the keycards, the loot it
 * had not banked, and its wreckage in the compartment it died in — which is
 * what G18 raises a ghost off. The ship's alert does *not* fall: killing a drone
 * is not something a derelict calms down after. The run itself goes on for
 * exactly as long as the account can carry another hull.
 */
function loseDrone(game: RoomGame): void {
  const voyage = voyageOf(game);
  const state = stateOfShip(game);
  const rig = rigOf(game.player);
  if (state && game.player.room !== undefined) {
    state.deaths.push({ room: game.player.room, rig: rig ?? rigFrom([]) });
  }

  voyage.hull = undefined;
  // A one-trip contract does not survive the trip.
  if (state === voyage.state[voyage.current]) {
    const trip = openClause(game, "trip");
    if (trip) voidCharter(game, trip);
  }
  dropCharterCargo(game);
  setKeys(game.player, 0);
  setLoot(game.player, 0);
  clearVirus(game.player);
  (game.player.data ??= {}).rig = rigFrom([]);
  // The operator is not the drone: the core that went dark was the machine's,
  // and the entity the engine drives is the person watching the schematic. Both
  // fields, because `isAlive` reads both — hit points alone would leave the run
  // ending on the engine's own "the drone goes dark" a few lines later.
  game.player.alive = true;
  game.player.hp = game.player.hpMax;
  applyDerived(game.player);
  game.log.add(t(LOST_KEY), game.schedule.time, "bad", LOST_KEY);
  // What the ship does with a dead drone is the one rule nobody would guess:
  // the rack is still aboard, and something is going to be wearing it
  // (`systems/ghost.ts`, `GHOST_HINT`). Said here rather than there, because by
  // the time a ghost is on its feet the operator is standing on the tug.
  hint(game, "death");

  // Read before the crossing: it is the derelict's own record, and after
  // `returnToTug` the ship underfoot is the tug.
  const gone = detonated(game);
  returnToTug(game, "death");
  if (gone) hullGone(game, state);
  endIfBroke(game);
}

/** The second of the two ways a run ends: no drone, and not enough for one. */
function endIfBroke(game: RoomGame): void {
  const voyage = voyageOf(game);
  if (voyage.hull === undefined && voyage.credits < CHEAPEST_HULL.price) {
    game.finish("dead", t(BROKE_KEY));
  }
}

// ------------------------------------------------------------ what lies about

/**
 * `act take {crate}`: a crate of cargo, or of something the crew was not
 * declaring. Credits and nothing else — a crate of *modules* is `X` and the rig
 * strips it (`twist/rig.ts`), and the two are different things in a compartment
 * because they are different decisions: one costs a slot, one costs nothing but
 * a turn and the noise of prising it open.
 *
 * What the drone picks up is not money yet. It becomes money at the airlock, so
 * dying with a full hold is losing every credit of it.
 */
function take(game: RoomGame, target: number | undefined): Outcome {
  const room = game.roomOf(game.player);
  const crates = roomList<Crate>(room, "crates");
  const crate = target === undefined ? crates[0] : crates.find((c) => c.id === target);
  if (!crate) return takeCargo(game, room, target);

  const price = cratePrice(crate);
  removeCrate(game, room, crate);
  setLoot(game.player, lootHeld(game.player) + price);
  game.makeNoise(room.id, TAKE_NOISE);
  game.log.add(
    t("log.crate.open", { crate: crateName(crate), cr: price }),
    game.schedule.time,
    "good",
    "log.crate.open",
  );
  return DONE();
}

function removeCrate(game: RoomGame, room: Room, crate: Crate): void {
  const data = room.data as Record<string, Crate[] | undefined>;
  const crates = data.crates;
  if (!crates) return;
  const i = crates.indexOf(crate);
  if (i >= 0) crates.splice(i, 1);
}

function crateName(crate: Crate): string {
  return crate.kind === "contraband" ? t("crate.contraband") : t("crate.cargo");
}

// ------------------------------------------------------------ charter errands

/** Turns at a console, and how far the noise of it carries (design-doc.md). */
const UPLOAD_TURNS = 5;
const UPLOAD_NOISE = 6;

/** The charter items lying in one compartment, whatever state they are in. */
function itemsIn(room: Room, kind: RoomItem["kind"]): RoomItem[] {
  return [...roomList<RoomItem>(room, "items")].filter((i) => i.kind === kind);
}

function itemAt(room: Room, kind: RoomItem["kind"], target: number | undefined): RoomItem | undefined {
  const here = itemsIn(room, kind);
  return target === undefined ? here[0] : here.find((i) => i.id === target);
}

/**
 * `act take {item}`: the marked crate a `RETRIEVE` charter is paying for.
 *
 * The crate stays where it is and is stamped `taken` instead of being removed:
 * a derelict is a place the run walks back into, and "somebody already carried
 * this out" has to survive the sortie (`systems/populate.ts`, `RoomItem`). It
 * is worth no credits of its own — the charter is the payment.
 */
function takeCargo(game: RoomGame, room: Room, target: number | undefined): Outcome {
  const item = itemAt(room, "charter-item", target);
  if (!item) return FAIL(t("why.cargo.none"));
  if (item.taken) return FAIL(t("why.cargo.carrying"));

  item.taken = true;
  game.makeNoise(room.id, TAKE_NOISE);
  game.log.add(t("log.cargo.take"), game.schedule.time, "good", "log.cargo.take");
  return DONE();
}

/**
 * `act upload {console}`: five turns in a row at a console, six noise a turn.
 *
 * The loudest thing a small charter asks for and the only one with no tool in
 * it: what it costs is standing still in one compartment while the ship listens
 * (design-doc.md, "Чартеры"). Anything else the drone does drops the count —
 * `afterPlayerTurn` is where that happens, the way a splice is broken off
 * (`systems/ship.ts`).
 */
function upload(game: RoomGame, target: number | undefined): Outcome {
  const room = game.roomOf(game.player);
  const console = itemAt(room, "console", target);
  if (!console) return FAIL(t("why.console.none"));
  if (console.uploaded) return FAIL(t("why.console.done"));

  const left = UPLOAD_TURNS - ((console.turns ?? 0) + 1);
  game.makeNoise(room.id, UPLOAD_NOISE);
  if (left <= 0) {
    delete console.turns;
    console.uploaded = true;
    game.log.add(t("log.upload.done"), game.schedule.time, "good", "log.upload.done");
    return DONE();
  }

  console.turns = (console.turns ?? 0) + 1;
  game.log.add(t("log.upload.on", { left }), game.schedule.time, "plain", "log.upload.on");
  return DONE();
}

/** Every console aboard with an upload half-finished. Usually none. */
function openUploads(game: RoomGame): RoomItem[] {
  return game.ship.rooms.flatMap((room) => itemsIn(room, "console").filter((i) => (i.turns ?? 0) > 0));
}

/**
 * A drone that dies is carrying whatever it lifted: the marked crate goes back
 * on the floor, in the compartment the drone died in.
 *
 * Without this the errand pays itself — `taken` belongs to the ship, so the
 * next drone would walk out of the airlock and collect for a job a dead one
 * did. An upload is not undone the same way: the data is off the ship already.
 */
function dropCharterCargo(game: RoomGame): void {
  const room = game.player.room;
  if (isTug(game) || room === undefined) return;

  for (const from of game.ship.rooms) {
    for (const item of itemsIn(from, "charter-item")) {
      if (!item.taken) continue;
      delete item.taken;
      if (from.id === room) continue;
      moveItem(from, game.ship.roomAt(room), item);
    }
  }
}

function moveItem(from: Room, to: Room, item: RoomItem): void {
  const list = from.data.items as RoomItem[] | undefined;
  if (!list) return;
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
  const into = (to.data.items as RoomItem[] | undefined) ?? [];
  into.push(item);
  to.data.items = into;
}

// ------------------------------------------------------------- the action list

/**
 * Everything the tug offers, one line per verb: the answering list.
 *
 * This is what a bot presses out of, what a key with no number left on it still
 * reaches, and what `tests/deadends.test.ts` reads a dead end off. It is not
 * what the player looks at — that is the same verbs grouped and headed, with
 * the modules one level down (`ui/actions.ts`, `tugActions`) — but the two are
 * built out of one function, `stationTargets`, so neither can grow a line the
 * other has never heard of. That is the failure G41 spent a pass on: the tug
 * used to emit its stations twice, once gated by compartment and once raw, and
 * a bot pressed the copy the game then refused.
 *
 * One line per verb, and the four that could be aimed at any module in the rack
 * are one line here rather than six. It is the same shape the bench has always
 * had — `repair` names the module it would mend and there has only ever been
 * one of it — and it is what the screen does too. What it costs the harness is
 * nothing worth having: a rack is six copies of one bargain, and pressing the
 * second after the first has taught you something is not a decision
 * (`testing/roombots.ts` learns per verb for exactly that reason).
 *
 * The rack and the board keep a line each, and they are not an inconsistency.
 * Three hulls at three prices are three different bargains, not one aimed six
 * ways, and the same is true of a board of charters — collapsing those would
 * make the *first* press teach a bot that the rest showed it nothing.
 *
 * The order is arranged for the bots and for nobody else: they press enabled
 * offers in list order, and the reader sees five fixed groups that owe nothing
 * to this. The argument for it sits at `undock`, which is the line that moved.
 */
export function stationOffers(game: RoomGame): Array<ActionOffer<RoomCommand>> {
  const out: Array<ActionOffer<RoomCommand>> = [];
  for (const verb of STATION_ORDER) {
    const lines = stationTargets(game, verb);
    if (lines.length === 0) continue;
    out.push(...(COLLAPSED.has(verb) ? [collapse(verb, lines)] : lines));
  }
  return out;
}

/**
 * The order the answering list is built in, which is the order a bot spends a
 * visit home in: get a drone, take the work, fly, and spend what is left over
 * on the way back.
 *
 * `undock` is the line that moved when the four compartments became one list.
 * It used to sit second, because a voyage whose drone never gets aboard is not
 * the game being measured; what kept the board from being skipped anyway was
 * the geography — casting off was two compartments from signing, so a bot that
 * walked the tug reached the charters first. With the walk gone, so was that.
 * Both failures were measured on 32 seeds: cast off ahead of the board and
 * charters fall 1.81 → 0.41 a voyage with the itinerary unfunded behind them
 * (`lastHull` 44 % → 16 %); cast off after the bench and the account is spent
 * on a rack the drone has not flown yet (`banked` 49.3 → 27.8, hulls sold
 * 0.44 → 0.16). Sign, fly, then spend.
 */
const STATION_ORDER: readonly string[] = [
  "buy", "berth", "undock", "repair", "clean", "graft", "stow", "order", "fit", "sell", "jump",
];

/**
 * Verbs whose per-module lines are one line on the answering list — the same
 * five the screen folds. Every one of them is a bargain a rack holds six copies
 * of, and pressing the second after the first has taught you something is not a
 * decision.
 */
// `order` is not among them: the shelf's three lines are three different
// modules at three different prices, and a bot that only ever sees one of them
// is a bot that never buys the WELDER.
const COLLAPSED: ReadonlySet<string> = new Set(["repair", "graft", "stow", "fit", "sell"]);

/**
 * Several lines of one verb as the single line a bot reads: the first of them
 * that can be pressed, worded for the verb rather than for the module.
 *
 * The wording is the whole point of collapsing rather than simply taking the
 * first: a line that comes back word for word after being pressed is the one
 * signal the harness has that a bargain showed it nothing, and a per-module
 * label moves every time the rack does.
 */
function collapse(verb: string, lines: ReadonlyArray<ActionOffer<RoomCommand>>): ActionOffer<RoomCommand> {
  const open = lines.find((o) => o.enabled);
  const pick = open ?? lines[0]!;
  return offer(t(PICK_LABEL[verb]!, { price: PICK_PRICE[verb] ?? 0 }), pick.cmd, open !== undefined, pick.why);
}

/** What the one line is called, and the price it names. `ui/actions.ts` uses both. */
const PICK_LABEL: Record<string, Key> = {
  buy: "action.pick.buy",
  repair: "action.pick.repair",
  graft: "action.pick.graft",
  stow: "action.pick.stow",
  fit: "action.pick.fit",
  sell: "action.pick.sell",
  berth: "action.pick.berth",
};

const PICK_PRICE: Record<string, number> = { graft: GRAFT_PRICE };

/** A credit for every point the module is short, and never more than four. */
function repairPrice(slot: Slot): number {
  return Math.min(Math.max(1, capOf(slot) - slot.integrity) * REPAIR_PRICE, REPAIR_CAP);
}

/** The label of the one line a verb shows when its modules are folded away. */
export function pickLabel(verb: string): string | undefined {
  const key = PICK_LABEL[verb];
  return key === undefined ? undefined : t(key, { price: PICK_PRICE[verb] ?? 0 });
}

/**
 * Everything one verb of the tug could be aimed at, in a fixed order: the
 * hulls on the rack, the modules in the rack, the modules in the hold, the
 * charters on the board.
 *
 * The one place any of these lines is worded, priced or refused. Both lists the
 * game has are built from it — the flat one above and the grouped one the
 * player reads — so a module that can be stowed is a module the sub-list shows,
 * with the same price on it and the same sentence when it cannot be pressed.
 *
 * The order inside a verb is the rack's own and never sorted: a slot keeps its
 * place in its own list for as long as the module is in it, which is what makes
 * the digit for `SCANNER` the same digit between two presses
 * (docs/tasks/G53-tug-is-a-menu.md, 1а).
 */
/**
 * What a visit home has left undone, in the order it costs the run: the line
 * that casts off, read before it is pressed.
 *
 * The tug is a menu with no confirmations in it — a modal screen is the one
 * thing design-doc.md rules out by name — and casting off is the one row on it
 * that cannot be taken back. So the row says what is not done rather than
 * asking whether you meant it. The cost of both entries is measured and
 * already written down here: charters unsigned behind a drone that has flown
 * cost 1.81 → 0.41 a voyage (`STATION_ORDER`), and a rack under its ceiling is
 * the whole of what the first sortie is survived on.
 *
 * It is a note and not the name. The row used to be worded out of this list —
 * `вылет 4 битых`, which the owner read off the live build and called what it
 * is: «корявое имя» (G92 B2). What a row of a menu is called may not change
 * with the state of the rack; the checklist is what the row has to *say*, so it
 * goes in brackets after the name, where `fitLabel` puts it on its own row
 * under the line the moment the two together are over twenty-five columns.
 *
 * The callsign is off the row for the same reason it was only ever on it
 * conditionally: a tug row is twenty-five columns (`ACTION_WIDTH`) and the
 * longest callsign is thirteen of them. The hull is named twice more on the
 * same screen — on the banner and on the panel — and what is undone is named
 * nowhere else.
 */
function castOffLeft(game: RoomGame, rig: Rig | undefined): string[] {
  const out: string[] = [];
  const hurt = rig === undefined ? 0 : damaged(rig).length;
  if (hurt > 0) out.push(t("undock.left.damaged", { n: hurt }));
  // Only while there is one to sign: a board the drone has cleared is not a
  // thing left undone, and neither is one that never had anything on it.
  // Alone in the brackets there is room to say what casting off does to the
  // board; beside the damage there is not, and the short word stands in for it.
  if (berthOpen(game)) {
    out.push(t(hurt > 0 ? "undock.left.charter" : "undock.left.board"));
  }
  return out;
}

export function stationTargets(game: RoomGame, verb: string): Array<ActionOffer<RoomCommand>> {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  const out: Array<ActionOffer<RoomCommand>> = [];

  // The rack, always. A list that only shows hulls once the drone is dead
  // teaches the choice at the moment it is no longer a choice — so the three
  // are on it from the first screen of the run, the one that is already bought
  // reading as what it is (docs/tasks/G40-tug-clarity.md, 3).
  if (verb === "buy") {
    HULLS.forEach((hull, i) => {
      const cmd: RoomCommand = { kind: "act", verb: "buy", target: HULL_TARGET + i };
      if (voyage.hull === hull.id) {
        out.push(offer(t("action.hull.onRack", { hull: hullName(hull) }), cmd, false, t(RACK_FULL)));
        return;
      }
      const full = voyage.hull !== undefined;
      out.push(
        offer(
          t("action.buy", { hull: hullName(hull), price: hull.price }),
          cmd,
          !full && affordable(game, hull.price),
          full ? t(RACK_FULL) : whyNot(game, hull.price),
        ),
      );
    });
    return out;
  }

  // A stop's list: every hull of it, and every contract each carries, one line
  // a pair. The first stop's list is open until something has been aboard; after
  // that the list is the next stop's, and every line of it is a jump.
  if (verb === "berth" || verb === "jump") {
    const stop = stopOf(game, verb);
    if (stop === undefined) return out;
    // Held before it is priced: a greyed line has one sentence, and "the hull
    // is still out there" is the one that says what to do about it.
    const held = verb === "jump" ? jumpHeld(game) : undefined;
    const paid = verb === "berth" || voyage.credits >= JUMP_PRICE;
    rowsAt(voyage, stop).forEach((row, i) => {
      out.push(
        offer(
          choiceLabel(row),
          { kind: "act", verb, target: CHOICE_TARGET + stop * CHOICE_STRIDE + i },
          held === undefined && paid,
          held ?? t(NOT_ENOUGH),
        ),
      );
    });
    return out;
  }

  // The shelf is the one list a drone need not exist for: with the rails empty
  // it still says what the dock sells and why the lines are grey, which is how
  // a player finds out it is there at all.
  if (verb === "order") return shelfOffers(game, voyage, rig);

  if (voyage.hull === undefined) return out;

  // The row says what it does — go aboard the derelict — and the checklist of
  // what the visit home left undone rides after it in brackets (`castOffLeft`).
  // The refusal keeps the callsign: a voyage draws three of these and two of
  // them can be freighters, so a sentence about "the freighter" names a ship the
  // player cannot tell from the last one
  // (docs/tasks/G55-playtest-findings.md, 17).
  if (verb === "undock") {
    const state = currentDerelict(game);
    const hull = flavourCallsign(state.flavour);
    const left = castOffLeft(game, rig);
    out.push(
      offer(
        left.length === 0 ? t("action.undock") : t("action.undock.todo", { left: left.join(", ") }),
        { kind: "act", verb: "undock" },
        !state.sold,
        t("why.undock.tow", { hull }),
      ),
    );
    return out;
  }

  if (!rig) return out;
  const sick = infectedSlot(game);

  // Everything the bench could mend, worst first — the order the money should
  // be spent in, and the order the line the answering list folds them into
  // aims at. Until G53 there was only ever one of these, the worst, because
  // there was nowhere to put a choice; now the choice is the group's own list
  // and the *default* is still the worst.
  if (verb === "repair") {
    damaged(rig).forEach(({ slot, i }) => {
      const price = repairPrice(slot);
      // A worn relic keeps its line, greyed: the list and the command say the
      // same thing (`repair` refuses in these words), and a player has to be
      // able to read why the bench will not touch it.
      const relic = isRelic(slot.kind);
      out.push(
        offer(
          t("action.repair", {
            module: moduleName(slot.kind),
            left: slot.integrity,
            max: capOf(slot),
            price,
          }),
          { kind: "act", verb: "repair", slot: i },
          !relic && affordable(game, price),
          relic ? t("why.relic.noRepair", { module: moduleName(slot.kind) }) : whyNot(game, price),
        ),
      );
    });
    return out;
  }

  if (verb === "clean") {
    const module = sick === undefined ? undefined : rig.slots[sick];
    if (sick !== undefined && module) {
      out.push(
        offer(
          t("action.clean", { module: moduleName(module.kind), price: BENCH_CURE_PRICE }),
          { kind: "act", verb: "clean", slot: sick },
          affordable(game, BENCH_CURE_PRICE),
          whyNot(game, BENCH_CURE_PRICE),
        ),
      );
    }
    return out;
  }

  if (verb === "graft") {
    rig.slots.forEach((slot, i) => {
      if (!slot || !canGraft(slot)) return;
      // A relic is on the list and greyed, in the words `graft` refuses with.
      const relic = isRelic(slot.kind);
      out.push(
        offer(
          // What grafting gives rather than what the module is worth today: at
          // the bench the decision is about the ceiling, since wear is mended
          // for 4 CR and comes back next sortie while a point of base never
          // does.
          t("action.graft", { module: moduleName(slot.kind), price: GRAFT_PRICE }),
          { kind: "act", verb: "graft", slot: i },
          !relic && affordable(game, GRAFT_PRICE),
          relic ? t("why.relic.noRepair", { module: moduleName(slot.kind) }) : whyNot(game, GRAFT_PRICE),
        ),
      );
    });
    return out;
  }

  // Off the rack and into the tug's own hold: free, whole, and the answer to
  // the question the owner could not find one for — how do I keep a module I am
  // not flying with?
  if (verb === "stow") {
    const last = fullSlots(rig) <= 1;
    const room = voyage.hold.length < HOLD_LIMIT;
    rig.slots.forEach((slot, i) => {
      if (!slot) return;
      out.push(
        offer(
          t("action.stow", { module: moduleName(slot.kind), left: slot.integrity, max: capOf(slot) }),
          { kind: "act", verb: "stow", slot: i },
          room && !last,
          last ? t("why.rig.last") : t("why.hold.full", { n: HOLD_LIMIT }),
        ),
      );
    });
    return out;
  }

  if (verb === "fit") {
    voyage.hold.forEach((held, i) => {
      out.push(
        offer(
          t("action.fit", { module: moduleName(held.kind), integrity: held.integrity, max: capOf(held) }),
          { kind: "act", verb: "fit", target: HOLD_TARGET + i },
          rig.slots.some((s) => s === null),
          t("why.rack.full"),
        ),
      );
    });
    return out;
  }

  // The dock's shelf: three modules for sale, bought into the hold. Its own
  // verb, drawn on the `fit` row (`TugRow.also`, ui/actions.ts) — everything
  // that puts a module on the drone belongs in one place, and the panel at home
  // has no eleventh row to give it.

  if (verb === "sell") {
    rig.slots.forEach((slot, i) => {
      if (!slot) return;
      out.push(
        offer(
          t("action.sell", {
            module: moduleName(slot.kind),
            left: slot.integrity,
            max: capOf(slot),
            price: sellPrice(slot, sick === i),
          }),
          { kind: "act", verb: "sell", slot: i },
          true,
        ),
      );
    });
  }
  return out;
}

function offer(
  label: string,
  cmd: RoomCommand,
  enabled: boolean,
  why?: string,
): ActionOffer<RoomCommand> {
  const out: ActionOffer<RoomCommand> = { label, cmd, enabled };
  if (!enabled && why !== undefined) out.why = why;
  return out;
}

/**
 * Every module the bench could mend, worst first, ties to the lower slot.
 *
 * The order is what the folded line inherits: the bench mends whichever module
 * is worst, which is what it has always done, and is now the head of a list
 * rather than the whole of it.
 */
function damaged(rig: Rig): Array<{ slot: Slot; i: number }> {
  return rig.slots
    .flatMap((slot, i) => (slot && slot.integrity < capOf(slot) ? [{ slot, i }] : []))
    .sort((a, b) => a.slot.integrity - b.slot.integrity || a.i - b.i);
}

// ----------------------------------------------------------------- the system

export const VOYAGE: System<RoomGame> = {
  name: "voyage",

  /**
   * Where a departure leads, and when a run is over. Both belong to whoever
   * owns the account: getting out of a derelict is worth what it is worth, and
   * a drone is only lost for good once there is nothing left to buy another.
   */
  claimsOutcome: true,

  onRunStart(game) {
    const voyage = voyageOf(game);
    // The twist built a rack of its own before this ran (`RIG.onRunStart`);
    // the voyage is what says which hull that rack belongs to, so it fits the
    // starting hull over it and the two can never drift apart.
    const hull = hullKind(voyage.hull ?? STARTING_HULL.id) ?? STARTING_HULL;
    fitHull(game, hull, true);
    const state = voyage.state[voyage.current];
    if (state && !isTug(game)) game.currentShip.data.derelict = state.spec.id;
    // Two lines before the flavour, and in this order: what the four
    // compartments are for, then who you are and how far out this goes. `dock`
    // says the third — the board at the HELM — so a run opens on an
    // instruction rather than on a ship's name nobody has a use for yet.
    game.log.add(tugOpening(), game.schedule.time, "warn", TUG_OPENING_KEY);
    game.log.add(
      voyageOpening(tugCallsign(game.seed), voyage.derelicts.length),
      game.schedule.time,
      "plain",
      "log.opening.voyage",
    );
    dock(game);
    if (berthOpen(game)) sign(game, leadingCharter(voyage, voyage.current));
    // And, under the three, that the mouse works — which no line of the game
    // said in any language while the owner played with one
    // (docs/tasks/G87-playability.md, 3). Last of the opening, so the three
    // lines above it stay the instruction they are; once, because `hint` is the
    // once-a-run door every such line goes through.
    hint(game, "mouse");
  },

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act") return undefined;

    // What lies in a compartment is loaded aboard the derelict; everything else
    // here is a station, and a station only answers on the tug.
    if (cmd.verb === "take") return take(game, cmd.target);
    if (cmd.verb === "upload") return upload(game, cmd.target);
    if (!isStationVerb(cmd.verb)) return undefined;
    if (!isTug(game)) return FAIL(t("why.tug.only"));

    switch (cmd.verb) {
      case "buy": {
        const hull = HULLS[(cmd.target ?? HULL_TARGET) - HULL_TARGET];
        return hull ? buyHull(game, hull.id) : FAIL(t("why.hull.none"));
      }
      case "repair":
        return repair(game, cmd.slot ?? -1);
      case "graft":
        return graft(game, cmd.slot ?? -1);
      case "clean":
        return clean(game, cmd.slot ?? -1);
      case "sell":
        return sellSlot(game, cmd.slot ?? -1);
      case "stow":
        return stowSlot(game, cmd.slot ?? -1);
      case "order":
        return buyModule(game, (cmd.target ?? STOCK_TARGET) - STOCK_TARGET);
      case "fit":
        return fitFromHold(game, (cmd.target ?? HOLD_TARGET) - HOLD_TARGET);
      case "undock":
        return undock(game);
      case "jump":
        return jump(game, cmd.target);
      case "berth":
        return berth(game, cmd.target);
    }
  },

  /**
   * The airlock, on both sides of it. Out of a derelict it ends a sortie; out
   * of the tug it starts one, which is what `undock` is — so the key that says
   * "leave" means the same thing wherever the drone is standing.
   */
  beforeLevelLeave(game, _depth, reason) {
    if (reason !== "airlock" || game.status !== "playing") return;
    if (isTug(game)) {
      undock(game);
      return;
    }
    comeHome(game);
  },

  /** A drone dying is not the run ending. Being unable to buy another one is. */
  onDeath(game, victim) {
    if (victim.id !== game.player.id || game.status !== "playing") return;
    loseDrone(game);
  },

  /**
   * An upload has to be five turns *in a row*: anything else the drone does
   * drops it where it stands, the way a splice is broken off
   * (`systems/ship.ts`). The count lives on the console, so a broken-off upload
   * survives leaving the ship as what it is — nothing.
   */
  afterPlayerTurn(game, cmd) {
    for (const console of openUploads(game)) {
      if (cmd.kind === "act" && cmd.verb === "upload" && (cmd.target ?? console.id) === console.id) continue;
      delete console.turns;
      game.log.add(t("log.console.away"), game.schedule.time, "warn", "log.console.away");
    }
    checkQuiet(game);
    endIfBroke(game);
  },

  offerActions(game) {
    if (game.status !== "playing") return [];
    // The stations, each line once, and each one answered for by the
    // compartment the drone is standing in — the geography is
    // `systems/tug.ts`'s, and this is the list it is applied to (G41).
    if (isTug(game)) return stationOffers(game);

    const room = game.roomOf(game.player);
    const offers: Array<ActionOffer<RoomCommand>> = [];
    for (const crate of roomList<Crate>(room, "crates")) {
      offers.push(
        offer(
          t("action.take", { crate: crateName(crate), cr: cratePrice(crate) }),
          { kind: "act", verb: "take", target: crate.id },
          true,
        ),
      );
    }
    // The two charter errands, in the compartments the deck put them in.
    for (const item of itemsIn(room, "charter-item")) {
      if (item.taken) continue;
      offers.push(offer(t("action.takeMarked"), { kind: "act", verb: "take", target: item.id }, true));
    }
    for (const item of itemsIn(room, "console")) {
      if (item.uploaded) continue;
      const left = UPLOAD_TURNS - (item.turns ?? 0);
      offers.push(
        offer(
          t("action.upload", { left }),
          { kind: "act", verb: "upload", target: item.id },
          true,
        ),
      );
    }
    return offers;
  },

  panelLines(game) {
    const voyage = voyageOf(game);
    const lines = [{ text: t("panel.credits", { n: voyage.credits }) }];
    if (voyage.loot > 0) lines.push({ text: t("panel.hold", { n: voyage.loot }) });
    if (voyage.hull === undefined) {
      lines.push({ text: t("panel.droneLost") });
      lines.push({ text: t("panel.cheapest", { n: CHEAPEST_HULL.price }) });
    }
    // At home the panel says what the tug has signed for and nothing else. What
    // it knows about the hull it is tied to — class, alert, systems up — is
    // drawn where the schematic goes (`ui/tugboard.ts`), and printing it in
    // both places cost the two rows the ten-row list needed. Aboard, the
    // schematic and the ship's own line say all of it already.
    if (isTug(game)) {
      // `NEUTRALIZE` is not one of these, at home any more than aboard: raising
      // the three systems is the goal of the run, and standing it in a list of
      // errands is what made the owner read it as a fourth errand
      // (docs/owner-queue.md, 5). What it is worth and how far it has got is
      // the board's own line, where the schematic goes (`ui/tugboard.ts`).
      for (const charter of voyage.charters) {
        if (charter.id === "neutralize") continue;
        const mark = charterDone(game, charter) ? "✓" : charterVoided(game, charter) ? "✗" : "·";
        lines.push({ text: `${mark} ${charterTag(charter)}` });
      }
    }
    return lines;
  },
};

/** Verbs the stations own. Everything else falls through to the next system. */
type StationVerb =
  | "buy" | "repair" | "graft" | "clean" | "sell" | "stow" | "fit" | "order"
  | "undock" | "jump" | "berth";

function isStationVerb(verb: string): verb is StationVerb {
  return (
    verb === "buy" || verb === "repair" || verb === "graft" || verb === "clean" ||
    verb === "sell" || verb === "stow" || verb === "fit" || verb === "order" || verb === "undock" ||
    verb === "jump" || verb === "berth"
  );
}

/**
 * How far a voyage got, in the unit a run is read by: compartments of a
 * *derelict* the drone has stood in, over every hull of the voyage.
 *
 * Not the ship under its feet, which is what the harness counts when a game has
 * no opinion (`testing/roombots.ts`, `roomsExplored`). Since G26 the airlock
 * leads to the tug rather than to an ending, so a run that swept a fourteen-
 * compartment freighter and walked home finishes standing in a tug — and scored
 * the tug. The tug is skipped here for the same reason it is not a dungeon:
 * nobody explores the room they bought the drone in.
 */
export function voyageProgress(game: RoomGame): number {
  let seen = 0;
  for (const id of game.ships.ids()) {
    if (id === TUG_ID) continue;
    seen += game.ships.get(id)?.ship.rooms.filter((r) => r.explored).length ?? 0;
  }
  return seen;
}

/**
 * What the harness scores a voyage by (`Playable.metrics`, E14). Derived, not
 * counted: a second counter for something the record already knows is a second
 * thing to keep in step.
 */
export function voyageMetrics(game: RoomGame): Record<string, number> {
  const voyage = voyageOf(game);
  return {
    credits: voyage.credits,
    shipsSold: voyage.state.filter((s) => s.sold).length,
    dronesLost: voyage.state.reduce((n, s) => n + s.deaths.length, 0),
    sortie: voyage.sortie,
  };
}
