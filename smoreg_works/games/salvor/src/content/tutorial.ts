import { Ship, layoutShip, type Door, type Entity, type Room, type RoomId } from "@jamrog/engine";
import type { DerelictSpec } from "./derelicts.js";
import type { Key } from "./i18n/keys.js";
import { ENTRY_KIND, zoneKind } from "./zones.js";

/**
 * The hull the game teaches itself on, and the nine steps it teaches with
 * (docs/tasks/G90-smoreg-wave.md, E).
 *
 * The story is the owner's: once, the hero linked to a drone left aboard an
 * abandoned hull and pulled it out of there. That pulling-out is the lesson —
 * the run opens with the drone already aboard, the last step is the airlock —
 * and the title's second row is "remember the first drone".
 *
 * Two things are data here and nothing else. The **ship** is drawn by hand and
 * is the same ship in every run on every seed: eight compartments in a line,
 * each one built to hold exactly one lesson, so that the owner can say "the
 * lock is the third door" and be right. The **steps** are a table: each one
 * names the line the window shows, what to press, and the fact in the game that
 * counts it done. A step is never completed by a key press — it is completed by
 * the world being in the state the step asked for, which is what lets a player
 * who already knows the game race through it, and a player who does not take
 * their time.
 *
 * None of this reaches the engine, and none of it reaches a system directly:
 * the predicates are written over `LessonFacts`, a flat record
 * `systems/tutorial.ts` reads off the running game. That file is the only one
 * that knows how a game answers each question; this one only asks them. The
 * split is the same one the old chain kept, and it is what keeps this file out
 * of the import loop `content/derelicts.ts → content/tutorial.ts → systems/*`
 * would otherwise close (docs/adr/0003-decoupling.md).
 */

/**
 * The class id, and the flag the deck sees as `class:tutorial`.
 *
 * Still a class, although no generator ever draws it: `systems/populate.ts`
 * reads the class off the ship to turn its marks into things, `systems/alert.ts`
 * keeps the slow clock and holds the hunter back on it, and `content/cards.ts`
 * names the string literally — so the id stays what those files expect.
 */
export const TUTORIAL_ID = "tutorial";

/**
 * The seed a training run flies on when nothing in the URL says otherwise
 * (`ui/app.ts`).
 *
 * The lesson's own hull no longer depends on it — `tutorialShip` is the same
 * ship on any seed — but the voyage behind the lesson still does: the hulls
 * that follow the training one are drawn like any other itinerary, and a fixed
 * seed keeps a training run one reportable thing rather than a lesson followed
 * by a lottery. `?seed=` still wins.
 */
export const TUTORIAL_SEED = 20260909;

/** The store id the training run's first ship — the lesson's hull — is kept under. */
export const TUTORIAL_SHIP_ID = "1";

/**
 * The teaching hull, as a class.
 *
 * The numbers are the ones a hand-built ship still needs: a band of one, so
 * the `m:scout` mark resolves to the one weak machine the fight is about; a
 * budget of none, so the filler puts nothing else aboard; no key roll, no
 * relic, no strain of its own, no rival. Sixty credits, because the next drone
 * is forty (`content/hulls.ts`) and a lesson flown to the end pays for its
 * successor. Everything about the *shape* of the ship is `tutorialShip`.
 *
 * Deliberately **not** in `DERELICTS`: it is never drawn into an ordinary
 * itinerary, and no balance number moves because it exists.
 */
export const TUTORIAL_SPEC: DerelictSpec = {
  id: TUTORIAL_ID,
  name: "training hull",
  rooms: [8, 8],
  maxDepth: 7,
  kinds: [ENTRY_KIND, "corridor", "storage", "cargo", "hab", "engineering", "reactor", "control"],
  band: ["scout"],
  machines: [0, 0],
  alertStart: 0,
  salePrice: 60,
  doors: { open: 100, closed: 0, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0,
  virusBonus: 0,
  rival: false,
  flavour: ["yard tender", "banked reactor", "tug drive", "shakedown run", "no crew aboard"],
};

// ------------------------------------------------------------------- the ship

/**
 * One compartment of the corridor: what it is, and what the deck would have
 * left in it. The marks are the same strings the generator's cards write, and
 * `systems/populate.ts` turns them into things exactly as it does for a drawn
 * hull — so the lesson's crate, body, machine and systems are the ordinary
 * kind, not a special case.
 */
interface Cabin {
  readonly kind: string;
  readonly marks: readonly string[];
  readonly cover?: boolean;
}

/**
 * The module the crate in STORAGE holds. A SPIKE, because it is the one module
 * the lesson meets twice more: it halves the purge on the virus step and it is
 * what the TERMINAL takes, so the keycard stays a keycard.
 */
export const TUTORIAL_CRATE = "spike";

/**
 * The corridor, airlock first, in the order the lesson meets it:
 *
 *   r1 DOCKING      the drone wakes here                            → click r2
 *   r2 CORRIDOR     one door in                                     → o
 *   r3 STORAGE      a parts crate (SPIKE), a body with a keycard    → salvage (the virus); purge; s; search, open d3
 *   r4 CARGO        one scout behind the locked door d3, cover      → Tab
 *   r5 HAB          behind the welded door d4                       → cut it: the alert
 *   r6 ENGINEERING  the ENGINE                                      ┐
 *   r7 REACTOR      the reactor, and a spare keycard on a body      │ work all three
 *   r8 CONTROL      the TERMINAL                                    ┘
 *
 * The machine stands behind the *lock* and not behind a closed door, and that
 * was measured: a scout is a stalker, it walks towards whatever it hears, and
 * behind a closed door it was in STORAGE two turns into the run, before the
 * crate had been touched. A lock is the one door a machine cannot walk
 * through, so the fight is met on the step that is about it — which puts the
 * door lesson one step ahead of the fight rather than one behind.
 *
 * And it *sleeps* until that step opens (G96, 3). The owner opened the lock
 * with the torch, the scout heard it and walked in on the door lesson, and
 * the fight was over before its step came up — so the machine is stood down
 * the moment the drone comes aboard (`systems/tutorial.ts`, `onLevelEnter`)
 * and woken by the fight step's own setup: the lock opening is what wakes it,
 * which is the one order that lets the door lesson finish and gives the fight
 * a cause the window can name.
 *
 * The spare card in the reactor is a safety net and not a lesson: a player who
 * spends the first card on the lock, against the window's advice, still finds
 * the one the TERMINAL wants before reaching it, so the hull is winnable
 * whichever way through the lock was taken.
 */
const CABINS: readonly Cabin[] = [
  { kind: ENTRY_KIND, marks: [] },
  { kind: "corridor", marks: [] },
  { kind: "storage", marks: [`X:${TUTORIAL_CRATE}`, "†:key", "key:k1"], cover: true },
  { kind: "cargo", marks: ["m:scout"], cover: true },
  { kind: "hab", marks: [] },
  { kind: "engineering", marks: ["E"] },
  { kind: "reactor", marks: ["O", "†:key", "key:k2"] },
  { kind: "control", marks: ["T"] },
];

/** The doors between them, airlock first: state, and the key a lock wants. */
const HATCHES: ReadonlyArray<{ state: Door["state"]; key?: string }> = [
  { state: "airlock" },
  { state: "open" },
  { state: "open" },
  { state: "locked", key: "k1" },
  { state: "sealed" },
  { state: "open" },
  { state: "open" },
  { state: "open" },
];

/**
 * The lesson's hull, built.
 *
 * By hand and with the constructor, the way `content/tug.ts` builds the tug:
 * fixed content must not pull `@jamrog/engine/testing` into a bundle. Pure and
 * rng-free — the same eight compartments, the same doors, the same marks on any
 * seed — and laid out by the generator's own pass, so it sits on the schematic
 * under the same rules as a drawn ship. Depth is the door count from the
 * airlock, which on a line is the index.
 *
 * Not stamped with its class here: that is `content/derelicts.ts`'s stamp, and
 * a value import of it from this file would close the loop that file's `KNOWN`
 * list opens. `game.ts` stamps it as it hands it to the run.
 */
export function tutorialShip(): Ship {
  const rooms: Room[] = CABINS.map((cabin, i) => ({
    id: i,
    label: `r${i + 1}`,
    kind: cabin.kind,
    name: zoneKind(cabin.kind).name,
    depth: i,
    col: i,
    row: 0,
    cover: cabin.cover === true,
    hazard: "none",
    explored: false,
    scanned: false,
    marks: [...cabin.marks],
    data: {},
  }));
  const doors: Door[] = HATCHES.map((hatch, i) => {
    const door: Door = {
      id: i,
      label: i === 0 ? "a1" : `d${i}`,
      a: i === 0 ? 0 : i - 1,
      b: i === 0 ? 0 : i,
      state: hatch.state,
    };
    if (hatch.key !== undefined) door.key = hatch.key;
    return door;
  });
  const ship = new Ship(rooms, doors, 0);
  layoutShip(ship);
  return ship;
}

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

// ------------------------------------------------------------------ the steps

/**
 * Everything a step is allowed to ask, in one flat record.
 *
 * A shape and not a `RoomGame`, for the reason given at the top of the file:
 * the steps are a table of predicates a test can drive by hand, and
 * `systems/tutorial.ts` is the one place that knows how a running game answers
 * each of these questions. Every field is a fact about *now*; the two that
 * compare against the moment the step began (`moved`, `installed`) are compared
 * there, against what `LessonState` remembered.
 */
export interface LessonFacts {
  /** The drone stands on the lesson's hull — not on the tug, not on a later one. */
  readonly aboard: boolean;
  /** The drone has left the compartment the step began in. */
  readonly moved: boolean;
  /** Compartments of the hull the drone has stood in. */
  readonly explored: number;
  /** The rack holds more modules than it did when the step began. */
  readonly installed: boolean;
  /** Compartments a sensor pulse has read. */
  readonly scanned: number;
  /** The rack carries a scanner that still works. */
  readonly scanner: boolean;
  /** Machines the drone has scrapped this run. */
  readonly kills: number;
  /** Locked bulkheads still aboard. */
  readonly locked: number;
  /** Welded bulkheads still aboard. */
  readonly sealed: number;
  /** The drone is carrying the ship's virus. */
  readonly infected: boolean;
  /** Systems of the hull online. */
  readonly online: number;
  /** The hull has gone under tow: the drone is out, and the lesson is over. */
  readonly sold: boolean;
}

/**
 * Something the run does on the turn a step begins.
 *
 * A name rather than a function, because doing it takes the systems — the
 * virus lives in `systems/virus.ts`'s record on the drone — and this file
 * cannot import them. `systems/tutorial.ts` owns the table that performs each
 * one. Two today: the virus step does not wait for a roll the deck might never
 * make, it puts the strain on the module the crate handed over; and the fight
 * step wakes the hull's one machine, which has slept since the drone came
 * aboard so that no earlier step is interrupted by it (G96, 3).
 */
export type LessonSetup = "infect" | "wake";

/**
 * What a step lets the drone do while it is open (G96, 1).
 *
 * The owner, after playing the lesson: «обучение блокируй всё, кроме того, что
 * надо сделать по обучению». So every step names the moves it is about, in a
 * vocabulary of ten words, and the screen refuses the rest — greyed rows with a
 * reason, keys that print the same reason and spend no turn. Reading a card,
 * moving the highlight, opening a list: none of those is a move, so none of
 * them is ever refused. The words are the lesson's, not the engine's:
 * `ui/lessongate.ts` is what knows which command is which word, and it is also
 * what opens the gate again when nothing a step allows can be done — a lesson
 * that walled the drone in would be worse than one that let it wander.
 */
export type LessonMove =
  /** Through a door: a click, `o`, `m` and a line, `<` on the way to the airlock. */
  | "walk"
  /** The salvage line on a crate or a wreck. */
  | "salvage"
  /** The purge line, on the module the virus is in. */
  | "purge"
  /** `s`: the sensor pulse. */
  | "scan"
  /** The search line on a body. */
  | "search"
  /** Any way through a locked bulkhead: the cell, the card, the spike, the torch, the ram. */
  | "open"
  /** `Tab`, or the attack line: a blow, or the step towards one. */
  | "attack"
  /** Any way through a welded bulkhead: the torch or the ram. */
  | "cut"
  /** The work line on a system. */
  | "work"
  /** `<` at the airlock: out. */
  | "leave";

export type LessonId =
  | "click"
  | "explore"
  | "modules"
  | "virus"
  | "scan"
  | "door"
  | "fight"
  | "alert"
  | "systems"
  | "leave";

/** One step of the lesson: what the window says, what to press, when it is done. */
export interface LessonStep {
  readonly id: LessonId;
  /** The instruction: `lesson.click`. */
  readonly text: Key;
  /** The key or the line, short: `lesson.click.press`. */
  readonly press: Key;
  /** The fact that counts the step done. Asked every turn while the step is current. */
  done(at: LessonFacts): boolean;
  /** The moves the screen lets through while this step is open; everything else is refused. */
  readonly allows: readonly LessonMove[];
  /** What the run does the turn this step becomes current, if anything. */
  readonly setup?: LessonSetup;
}

/**
 * The ten, in the order the corridor puts them in front of the drone
 * (docs/tasks/G90-smoreg-wave.md, E2, with the door and the fight swapped —
 * see `CABINS` — and the virus and the scan moved up by G96). Every one is completed by the fact it names and by nothing
 * else: a player who clicks the far end of the ship at step one has done
 * steps one and two, and the window says so a turn apart.
 *
 * The alert step is the welded door rather than the gauge itself, and that is
 * measured rather than chosen: the fight one door back is already loud enough
 * to climb the ladder, and the noise rule's own cooldown then swallows the
 * torch's three turns as often as not. What the step can promise is the loud
 * work — three turns the whole ship hears, or eight — and the text says what
 * the ladder does with it, in words that stay true once the ladder has ten
 * rungs.
 */
export const LESSON_STEPS: readonly LessonStep[] = [
  { id: "click", text: "lesson.click", press: "lesson.click.press", done: (at) => at.aboard && at.moved, allows: ["walk"] },
  {
    id: "explore",
    text: "lesson.explore",
    press: "lesson.explore.press",
    done: (at) => at.aboard && at.explored >= 3,
    allows: ["walk"],
  },
  {
    id: "modules",
    text: "lesson.modules",
    press: "lesson.modules.press",
    done: (at) => at.aboard && at.installed,
    allows: ["salvage"],
  },
  // Straight after the install, because the install is what causes it (G96,
  // 4): the setup runs inside the very command that bolted the SPIKE on, so
  // the log reads `salvaged`, then `the scrap carries something`, and the
  // rule the step teaches — salvage carries the ship's virus — is the one the
  // player just watched happen. It used to come after the weld, and the owner
  // read it as random: «я резал дверь и поймал вирус?»
  {
    id: "virus",
    text: "lesson.virus",
    press: "lesson.virus.press",
    done: (at) => at.aboard && !at.infected,
    allows: ["purge"],
    setup: "infect",
  },
  // Before the lock, because that is where a pulse earns its turn (G96, 8):
  // it reads through the shut bulkhead, so the player sees the machine in
  // CARGO before opening on it. Done on the first pulse — or on a rack whose
  // scanner has burned, which is a step the lesson cannot teach and must not
  // wait for.
  {
    id: "scan",
    text: "lesson.scan",
    press: "lesson.scan.press",
    done: (at) => at.aboard && (at.scanned >= 1 || !at.scanner),
    allows: ["scan"],
  },
  {
    id: "door",
    text: "lesson.door",
    press: "lesson.door.press",
    done: (at) => at.aboard && at.locked === 0,
    allows: ["search", "open"],
  },
  {
    id: "fight",
    text: "lesson.fight",
    press: "lesson.fight.press",
    done: (at) => at.aboard && at.kills >= 1,
    allows: ["attack"],
    setup: "wake",
  },
  // The weld is one compartment on from wherever the fight ended, so the walk
  // to it is part of the step.
  {
    id: "alert",
    text: "lesson.alert",
    press: "lesson.alert.press",
    done: (at) => at.aboard && at.sealed === 0,
    allows: ["walk", "cut"],
  },
  {
    id: "systems",
    text: "lesson.systems",
    press: "lesson.systems.press",
    done: (at) => at.aboard && at.online >= 3,
    allows: ["walk", "work"],
  },
  { id: "leave", text: "lesson.leave", press: "lesson.leave.press", done: (at) => at.sold, allows: ["walk", "leave"] },
];

// ------------------------------------------------------------------ the state

/**
 * Where the lesson has got to, on the drone.
 *
 * On the player entity for the reason the hint flags are: it carries from the
 * hull to the tug and round-trips through a save, so a reloaded lesson picks
 * up at the step it was on. `room` and `slots` are what the two comparing facts
 * are compared against; `doneAt` is when the last step completed, which is how
 * the window knows to say "done" for exactly one turn.
 */
export interface LessonState {
  /** Index into `LESSON_STEPS`; equal to its length once the lesson is over. */
  step: number;
  /** Where the drone stood when the step began. */
  room: RoomId;
  /** Modules in the rack when the step began. */
  slots: number;
  /**
   * How many commands the run had taken when the last step completed, or -1
   * when none has. The command count and not the clock: the schedule has moved
   * on by the time a frame is drawn, and the count stands still until the next
   * key — which is exactly the one turn the window says "done" for.
   */
  doneAt: number;
}

const LESSON_KEY = "lesson";

/** The lesson's record, or nothing on a drone that is not learning. Defensive: it comes out of JSON. */
export function lessonOf(drone: Entity | undefined): LessonState | undefined {
  const raw = drone?.data?.[LESSON_KEY];
  if (typeof raw !== "object" || raw === null) return undefined;
  const s = raw as Partial<LessonState>;
  if (typeof s.step !== "number" || typeof s.room !== "number" || typeof s.slots !== "number") return undefined;
  if (typeof s.doneAt !== "number") return undefined;
  return raw as LessonState;
}

/** Write the record. The one writer is `systems/tutorial.ts`. */
export function setLesson(drone: Entity, state: LessonState): void {
  (drone.data ??= {})[LESSON_KEY] = state;
}

/** The step the record is on, or nothing once the lesson is over. */
export function currentStep(state: LessonState): LessonStep | undefined {
  return LESSON_STEPS[state.step];
}
