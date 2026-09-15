import type { Entity, RoomGame, System } from "@jamrog/engine";
import { classOfShip, flavourCallsign } from "../content/derelicts.js";
import { TUG_OPENING_KEY } from "../content/hints.js";
import type { Key } from "../content/i18n/keys.js";
import { moduleName } from "../content/modules.js";
import { isTug } from "../content/tug.js";
import {
  LESSON_STEPS,
  TUTORIAL_CRATE,
  TUTORIAL_ID,
  currentStep,
  isTraining,
  lessonOf,
  setLesson,
  type LessonFacts,
  type LessonMove,
  type LessonSetup,
  type LessonState,
} from "../content/tutorial.js";
import { DEFAULT_STRAIN, strainName, strainOf } from "../content/viruses.js";
import { t } from "../i18n.js";
import { findSlot, findSlotAs, rigOf } from "../twist/rig.js";
import { shipState } from "./shipstate.js";
import { virusOf, type VirusState } from "./virus.js";
import { derelictAboard, voyageRecord } from "./voyage.js";

/**
 * The lesson's clock: which step the drone is on, and the turn it moves to the
 * next (docs/tasks/G90-smoreg-wave.md, E).
 *
 * Inert in every other run. An ordinary voyage builds this system like all the
 * others and it returns on its first line — no roll, no log, no state written —
 * so the recordings in `tests/fixtures/voyage-*.json` and every balance number
 * are the same with it in the list as they were without it.
 *
 * What it does is read: every turn it answers the ten questions of
 * `LessonFacts` off the running game and asks the current step whether it is
 * done. One step a turn, never two, so that the window gets one frame to say
 * "done" before it says the next thing. The order, the words and the facts are
 * all `content/tutorial.ts`'s; this file holds no text and decides no order.
 *
 * Two things it does on its own account, both because the run opens aboard the
 * lesson's hull rather than on the tug (the owner: the lesson *is* getting the
 * first drone out). The tug's opening line, written by the voyage before this
 * system runs, describes four compartments the drone is not standing in, and
 * is taken back out; and the onboarding scrap the deck lays in the docking bay
 * of a run's first ship is taken back out too, because the lesson's hull lays
 * out its own salvage — one crate, two doors in, on the step that is about it.
 */

export const TUTORIAL: System<RoomGame> = {
  name: "tutorial",

  onRunStart(game) {
    if (!isTraining(game.player)) return;
    setLesson(game.player, fresh(game));
    nameTheHull(game);
    dropTugOpening(game);
  },

  onLevelEnter(game) {
    if (!isTraining(game.player) || !onTutorialHull(game) || game.currentShip.visits !== 1) return;
    // `systems/populate.ts` ran before this hook: on the first ship of a run
    // it drops a pile of scrap where the drone lands. The lesson's own crate
    // is the module step, and a second module lying under the drone on turn
    // zero would teach it a step early.
    delete game.ship.roomAt(game.ship.entry).data.wrecks;
    // And the hull's machine sleeps until the fight step wakes it (G96, 3):
    // a stalker that heard the torch on the lock walked in on the door
    // lesson, and the fight was over before its own step came up.
    for (const machine of machinesOf(game)) {
      (machine.data ??= {})[DOZING_KEY] = machine.behaviour ?? "brute";
      machine.behaviour = SLEEPING;
    }
  },

  afterPlayerTurn(game) {
    if (game.status !== "playing" || !isTraining(game.player)) return;
    const state = lessonOf(game.player);
    if (state === undefined) return;
    const step = currentStep(state);
    if (step === undefined || !step.done(facts(game, state))) return;
    advance(game, state);
  },
};

// ---------------------------------------------------------------- the lesson

/** Is the drone standing on the hull the lesson is about? */
function onTutorialHull(game: RoomGame): boolean {
  return !isTug(game) && classOfShip(game.ship) === TUTORIAL_ID;
}

/** Turn zero: the first step, measured from where the drone wakes up. */
function fresh(game: RoomGame): LessonState {
  return { step: 0, room: game.player.room ?? game.ship.entry, slots: filled(game), doneAt: -1 };
}

/** Modules in the rack right now, for the `installed` fact. */
function filled(game: RoomGame): number {
  return rigOf(game.player)?.slots.filter((s) => s !== null).length ?? 0;
}

/**
 * The twelve questions, answered off the game as it stands after this turn.
 *
 * Nothing is remembered here; the two facts that are differences rather than
 * states — the drone moved, the rack grew — are differences against what the
 * record wrote down when the step began.
 */
function facts(game: RoomGame, state: LessonState): LessonFacts {
  const aboard = onTutorialHull(game);
  const doors = aboard ? game.ship.doors : [];
  return {
    aboard,
    moved: aboard && game.player.room !== state.room,
    // The compartment underfoot counts: the engine marks it explored only
    // after every system has had its turn, and a step that noticed the walk a
    // turn late would still be saying "press o" over `You reach STORAGE.`
    explored: aboard ? game.ship.rooms.filter((r) => r.explored || r.id === game.player.room).length : 0,
    installed: filled(game) > state.slots,
    scanned: aboard ? game.ship.rooms.filter((r) => r.scanned).length : 0,
    scanner: (() => {
      const rig = rigOf(game.player);
      return rig !== undefined && findSlotAs(rig, "scanner") !== null;
    })(),
    kills: game.kills,
    locked: doors.filter((d) => d.state === "locked").length,
    sealed: doors.filter((d) => d.state === "sealed").length,
    infected: virusOf(game.player) !== undefined,
    online: aboard ? shipState(game).online.length : 0,
    sold: voyageRecord(game)?.state.some((s) => s.spec.id === TUTORIAL_ID && s.sold) === true,
  };
}

/** The step is done: the next one begins now, and does whatever it does first. */
function advance(game: RoomGame, state: LessonState): void {
  state.step++;
  state.room = game.player.room ?? state.room;
  state.slots = filled(game);
  state.doneAt = game.inputs.length;
  const next = currentStep(state);
  if (next?.setup !== undefined) SETUPS[next.setup](game);
}

/** The behaviour a sleeping machine wears, and where its own is kept meanwhile. */
const SLEEPING = "static";
const DOZING_KEY = "dozing";

/** Every machine aboard the hull underfoot, dead ones included. */
function machinesOf(game: RoomGame): Entity[] {
  return game.entities.filter((e) => e.id !== game.player.id && e.room !== undefined);
}

/**
 * What each named setup does. The virus step puts the strain on the module the
 * crate handed over, in the record `systems/virus.ts` reads, and says the line
 * that file would have said had the deck's roll come up — so the clock, the
 * panel row and the cure are the ordinary ones from here on. The fight step
 * gives the sleeping machine its own behaviour back, so that from its next
 * turn it is the stalker the catalogue says it is.
 */
const SETUPS: Readonly<Record<LessonSetup, (game: RoomGame) => void>> = {
  wake(game) {
    for (const machine of machinesOf(game)) {
      const own = machine.data?.[DOZING_KEY];
      if (typeof own !== "string") continue;
      machine.behaviour = own;
      delete machine.data![DOZING_KEY];
    }
  },
  infect(game) {
    const rig = rigOf(game.player);
    if (rig === undefined || virusOf(game.player) !== undefined) return;
    const slot = findSlot(rig, TUTORIAL_CRATE) ?? rig.slots.findIndex((s) => s !== null);
    const module = rig.slots[slot];
    if (slot < 0 || !module) return;
    const strain = strainOf(DEFAULT_STRAIN);
    // `since` is the index of the command that carried it aboard: this hook
    // runs after the command was recorded, so that is the last one.
    const virus: VirusState = { strain: strain.id, slot, since: game.inputs.length - 1, turns: 0 };
    (game.player.data ??= {}).virus = virus;
    game.log.add(
      t("log.virus.caught", { module: moduleName(module.kind), virus: strainName(strain) }),
      game.schedule.time,
      "bad",
      "log.virus.caught",
    );
  },
};

// ------------------------------------------------------------- the opening

/**
 * What the heading and the banner call the lesson's hull. `undock` writes
 * these when a sortie boards a hull; a run that opens aboard one never
 * undocked into it, so the voyage's own tags are written here from the same
 * record the HELM's line reads.
 */
function nameTheHull(game: RoomGame): void {
  const state = derelictAboard(game);
  if (state === undefined) return;
  game.currentShip.data.name = flavourCallsign(state.flavour);
  game.currentShip.data.type = state.spec.id;
}

/** The tug's own opening, said by the voyage to a drone that is not on the tug. */
function dropTugOpening(game: RoomGame): void {
  const lines = game.log.lines;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.key === TUG_OPENING_KEY) lines.splice(i, 1);
  }
}

// ------------------------------------------------------------- for the screen

/** What the window shows: the step, its two lines, and whether one just closed. */
export interface LessonStatus {
  /** Index of the current step, counting from zero; `of` once the lesson is over. */
  readonly step: number;
  readonly of: number;
  /** The instruction and the key, or nothing once the lesson is over. */
  readonly text: Key | undefined;
  readonly press: Key | undefined;
  /** A step completed on this very turn: the frame that says "done". */
  readonly done: boolean;
  /** Every step is behind the drone. */
  readonly over: boolean;
}

/**
 * The lesson as the screen should show it, or nothing when there is no window
 * to draw: an ordinary run, or a training run that has jumped on to a real
 * hull — the lesson stays with the hull it was learned on.
 */
export function lessonStatus(game: RoomGame): LessonStatus | undefined {
  if (!isTraining(game.player)) return undefined;
  const state = lessonOf(game.player);
  if (state === undefined) return undefined;
  const voyage = voyageRecord(game);
  if (voyage !== undefined && voyage.current !== 0) return undefined;
  const step = currentStep(state);
  return {
    step: state.step,
    of: LESSON_STEPS.length,
    text: step?.text,
    press: step?.press,
    done: state.doneAt >= 0 && state.doneAt === game.inputs.length,
    over: step === undefined,
  };
}

/** The moves the open step lets through, and the key line the refusal names. */
export interface LessonAllowance {
  readonly allows: readonly LessonMove[];
  readonly press: Key;
}

/**
 * What the lesson lets the drone do right now (G96, 1), or nothing when there
 * is no step open: an ordinary run, a lesson that is over, or a training run
 * that has moved on to a real hull. Nothing gated is the default, so every
 * caller in an ordinary run gets `undefined` and changes nothing.
 */
export function lessonAllows(game: RoomGame): LessonAllowance | undefined {
  const status = lessonStatus(game);
  if (status === undefined || status.over) return undefined;
  const step = LESSON_STEPS[status.step];
  if (step === undefined) return undefined;
  return { allows: step.allows, press: step.press };
}
