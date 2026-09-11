import type { Entity } from "@jamrog/engine";
import type { DerelictSpec } from "./derelicts.js";
import type { HintId } from "./hints.js";
import { ENTRY_KIND } from "./zones.js";

/**
 * The hull the game teaches itself on, and the seven lines it teaches with
 * (docs/tasks/G69-tutorial.md).
 *
 * Until now "training" meant the ordinary first freighter with every one-shot
 * line said up front, on the turn the run opened. That is a wall of text before
 * anything has happened, on a twelve-to-fourteen compartment ship drawn by the
 * same generator as every other — the player is told five rules and then handed
 * a hull big enough to lose all five in.
 *
 * A separate tutorial is a separate *ship*: six or seven compartments, one
 * machine at the airlock, one locked bulkhead with its keycard on a body in
 * front of it, the three systems the run is actually about, and a price on the
 * hull that pays for the next drone. Nothing about it is scripted — it is a
 * `DerelictSpec` like the other seven, drawn by the same generator, populated
 * by the same deck — so what a player learns on it is true of every hull after
 * it. That is the whole design (design-doc.md, "Обучение конструкцией"): the
 * order the game explains itself in is the order the ship puts things in front
 * of you.
 *
 * All data, and none of it reaches the engine: `TUTORIAL_STEPS` says *when* a
 * line is owed as a predicate over a situation, and `systems/tutorial.ts` is
 * what builds a situation out of a running game. Content describes; the system
 * looks.
 */

/**
 * The class id, and the flag the deck sees as `class:tutorial`.
 *
 * `content/cards.ts` names this string literally, in `security checkpoint`'s
 * weight: pinning the one locked bulkhead is what makes the door lesson a
 * certainty rather than a draw, and the card cannot import it from here — the
 * deck is what `content/derelicts.ts` is built out of, and a spec that imported
 * the deck back would close the loop this codebase pays for cycles with
 * (docs/adr/0003-decoupling.md). `tests/tutorial.test.ts` holds the two ends
 * of that literal together.
 */
export const TUTORIAL_ID = "tutorial";

/**
 * The seed a training run flies on when nothing in the URL says otherwise
 * (`ui/app.ts`).
 *
 * A tutorial that is a different ship every time is not a tutorial — the point
 * of a hull built to teach is that it teaches the same lesson to the next
 * player, and that the owner can say "the bulkhead is two doors in" and be
 * right. The seed is the whole mechanism: the ship comes out of `generateShip`
 * like every other, and it is the run's own number that makes it the same one
 * twice. `?seed=` still wins, so a training run is as reportable as any other.
 */
export const TUTORIAL_SEED = 20260909;

/**
 * The teaching hull.
 *
 * Every field is a lesson or the absence of one:
 *
 *   **Six or seven compartments, depth four.** Small enough to hold in the head
 *   and still deep enough for the two `deep` systems the generator will not put
 *   near an airlock — a tutorial the player cannot get lost in, on a graph
 *   shaped exactly like the ones that follow.
 *
 *   **One band, one machine.** `scout` alone: three hit points, the weakest
 *   thing in the bestiary, and the one machine whose depth window reaches the
 *   airlock. The budget is one, which the docking bay's own card spends, and
 *   the second scout the bulkhead card posts is behind the lock — so the first
 *   fight is unavoidable and the second one is a choice.
 *
 *   **Three systems.** Not one. A hull the drone cannot neutralise is a hull
 *   the run cannot get past (`tests/content.test.ts`), and the lesson the
 *   tutorial exists for is "raise all three and the tug takes the hull" — you
 *   cannot teach that on a ship where it is not true.
 *
 *   **No lock weight and no relic.** The only locked door aboard is the
 *   checkpoint card's, which comes with its key by construction; a second one
 *   rolled by weight would make "the key is on a body in front of it" a thing
 *   that is usually true. A relic would be a guarded crate and a fourth machine
 *   on the one ship whose contents are all decisions (`DerelictSpec.relics`).
 *
 *   **Sixty credits.** The next drone is forty (`content/hulls.ts`), so a
 *   tutorial flown to the end pays for its successor and leaves change — and
 *   the player reads the sentence the economy is made of once, with numbers
 *   that work out, before the voyage starts charging for mistakes.
 *
 * Deliberately **not** in `DERELICTS`: it is never drawn into an ordinary
 * itinerary, it is not one of the five hulls a voyage picks its middle from,
 * and no balance number moves because it exists.
 */
export const TUTORIAL_SPEC: DerelictSpec = {
  id: TUTORIAL_ID,
  name: "training hull",
  rooms: [6, 7],
  maxDepth: 4,
  kinds: [ENTRY_KIND, "cargo", "corridor", "storage", "engineering", "reactor", "control"],
  band: ["scout"],
  machines: [1, 1],
  alertStart: 0,
  salePrice: 60,
  doors: { open: 55, closed: 30, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: false,
  flavour: ["yard tender", "banked reactor", "tug drive", "shakedown run", "no crew aboard"],
};

// ------------------------------------------------------------ the training flag

/** Where the drone remembers that this run is the training one. */
const TRAINING_KEY = "training";

/**
 * Mark this drone as a training run's.
 *
 * On the player entity, and set by `makePlayer` before the run's first hook
 * fires, because the itinerary is drawn inside the constructor: `systems/
 * voyage.ts` asks this the first time anything reads the voyage record, which
 * is `VOYAGE.onRunStart`, which is earlier than any caller of `newGame` can
 * reach. The player's pocket is also what round-trips through a save file, so
 * a reloaded training run is still one.
 */
export function markTraining(drone: Entity): Entity {
  drone.data = { ...(drone.data ?? {}), [TRAINING_KEY]: true };
  return drone;
}

/** Is this a training run? Read defensively: it comes back out of JSON. */
export function isTraining(drone: Entity | undefined): boolean {
  return drone?.data?.[TRAINING_KEY] === true;
}

// -------------------------------------------------------------- the seven lines

/**
 * Everything the chain is allowed to look at, in one flat record.
 *
 * A shape and not a `RoomGame`, so this file needs no engine, no voyage and no
 * rack: the steps are a table of predicates a test can drive by hand, and
 * `systems/tutorial.ts` is the one place that knows how a running game answers
 * each of these questions.
 */
export interface TutorialSituation {
  /** The drone is aboard the training hull — not on the tug, not on a later one. */
  readonly aboard: boolean;
  /** Player turns spent aboard it, counting the boarding turn as zero. */
  readonly turnsAboard: number;
  /** Something that is not the drone stands in a compartment the drone can see. */
  readonly contact: boolean;
  /**
   * Blows were traded this turn, whoever landed them: the fight the machine
   * lesson is about, on the screen.
   */
  readonly fighting: boolean;
  /** A locked bulkhead leads out of the compartment the drone is standing in. */
  readonly lockedDoor: boolean;
  /** One of the ship's three systems is in this compartment. */
  readonly system: boolean;
  /** The drone is standing in the airlock compartment. */
  readonly atAirlock: boolean;
  /** There is something to lose by dying: credits carried, or a system raised. */
  readonly carrying: boolean;
  /**
   * The drone is home: back on the tug after a sortie aboard the training hull.
   *
   * Not "the hull was sold", which is what this used to be. The sale is the one
   * moment of the chain a player has to *earn*, and measured over a hundred and
   * twenty runs it is earned by 70 % of careful bots, 4 % of greedy ones and no
   * random one at all — so the single line that says the lesson is over was the
   * line three runs in four never heard. Coming back through the airlock is the
   * same event one step earlier and it happens whether the hull went under tow
   * or not (docs/tasks/G86-tutorial-and-title.md, 8).
   */
  readonly home: boolean;
}

/** One line of the chain: what it is remembered under, and when it is owed. */
export interface TutorialStep {
  /** The hint flag, and the log key: `hint.tutorial.enter`. */
  readonly id: HintId;
  /** True the first turn this line is worth reading. */
  due(at: TutorialSituation): boolean;
  /**
   * This line does not wait for a turn of its own: it may share one with
   * another hint rather than hold until the log is quiet.
   *
   * Three of the seven, for two different reasons. `contact` and `door` are
   * moments that pass — a machine is usually dead the turn after it is seen,
   * and the one locked bulkhead is open a turn or two after the drone reaches
   * it — and `enter` is the line that says which keys do anything at all, so a
   * player reading the log for the first time needs it on the turn they board
   * and not on the first quiet turn after it.
   *
   * The other four can always be said later — standing in a system
   * compartment, standing in the airlock, standing on the tug, and the scanner
   * — so they wait, which is what keeps the log from teaching three things at
   * once (`content/hints.ts`, `quietTurn`).
   *
   * It is also what keeps the priority honest: a line that waits must not take
   * the quiet turn a passing moment needed. `enter` used to, and the bulkhead
   * lesson went from 100 % of greedy runs to 37 % because of it.
   */
  readonly urgent?: boolean;
}

/**
 * The chain, in the order a turn that owes two lines decides between them —
 * which is a priority and not a script.
 *
 * A step whose moment has not come is skipped rather than blocking: a hull
 * whose bulkhead lies four doors in hands the drone a system compartment long
 * before it hands it a lock, and a chain that refused to say anything until the
 * lock had been met said nothing for the rest of the run. What the table
 * decides is which line goes first when two are owed at once, and every line is
 * still said once, still on a turn when its subject is in front of the drone
 * (design-doc.md, "Обучение конструкцией").
 *
 * The order is **the moment that passes first**, and that was measured. It used
 * to read `enter → scan → contact → …`, with the scanner second because that is
 * the order the lessons were written in — and the scanner's moment never passes
 * while a machine's does. The docking bay hands the drone a scout on the turn it
 * boards, the fight is the turn after, and the line explaining what a fight
 * costs waited behind the scanner: in **none of 120 careful runs and none of 120
 * greedy ones** did the machine lesson land before the first blow. The bulkhead
 * paid worse — the drone stands in front of the one locked door for a turn or
 * two and then opens it, and the lesson that door exists for was said in 32 %
 * of the greedy runs that stood there (docs/tasks/G86-tutorial-and-title.md,
 * 3 and 4).
 *
 * So `enter` first, because "you are aboard, here is how you act" is what a
 * player needs before the ship can teach anything at all; then the four lessons
 * the ship stages, in the order it stages them; then the sale; and `scan` last,
 * because it is the one line that can always be said next turn.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  { id: "tutorial.enter", due: (at) => at.aboard, urgent: true },
  { id: "tutorial.contact", due: (at) => at.aboard && (at.contact || at.fighting), urgent: true },
  { id: "tutorial.door", due: (at) => at.aboard && at.lockedDoor, urgent: true },
  { id: "tutorial.system", due: (at) => at.aboard && at.system },
  { id: "tutorial.airlock", due: (at) => at.aboard && at.atAirlock && at.carrying },
  { id: "tutorial.sale", due: (at) => at.home },
  { id: "tutorial.scan", due: (at) => at.aboard && at.turnsAboard >= 1 },
];

/**
 * The line the chain owes right now, or nothing.
 *
 * Pure, and the whole of the chain's logic: the first step of the table that
 * has not been said and whose moment has come. One at a time — a turn that
 * satisfies two of them says the earlier one and leaves the other for the next
 * turn, because two lessons in one log entry is one lesson read. `said` is
 * asked rather than passed as a set so the caller can hand it the flags that
 * live on the drone.
 *
 * `crowded` is the caller saying that something else has already spoken this
 * turn (`content/hints.ts`, `quietTurn`): then only an `urgent` line is worth a
 * second entry in the log, and the rest wait. It is a parameter rather than a
 * rule of its own so that the whole decision stays one pure function a test can
 * drive by hand.
 */
export function stepDue(
  at: TutorialSituation,
  said: (id: HintId) => boolean,
  crowded = false,
): TutorialStep | undefined {
  return TUTORIAL_STEPS.find(
    (step) => !said(step.id) && (!crowded || step.urgent === true) && step.due(at),
  );
}
