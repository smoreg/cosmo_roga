import type { RoomCommand, RoomGame } from "@jamrog/engine";
import type { LessonMove } from "../content/tutorial.js";
import { t } from "../i18n.js";
import { lessonAllows } from "../systems/tutorial.js";
import { virusOf } from "../systems/virus.js";
import { findSlotAs, hostilesIn, rigOf } from "../twist/rig.js";
import { passableForPlayer } from "./auto.js";

/**
 * The lesson's gate: while a step is open, the screen lets through the moves
 * that step is about and refuses the rest (G96, 1 — the owner: «обучение
 * блокируй всё, кроме того, что надо сделать по обучению»).
 *
 * A screen rule and not a sim rule, on purpose. `playerCommand` still accepts
 * every command it always did, so a bot, a replay and a fixture see the same
 * game; what changes is that a training run's list greys the rows the step is
 * not about — with the same `why` machinery every greyed row already has — and
 * a key that would spend a turn on something else prints that reason instead.
 * Nothing that cannot hurt the player is a move: cards, lists, the highlight
 * and the language key never come here.
 *
 * The one rule that keeps this from walling the drone in: the gate only closes
 * when something the step allows can actually be done. A fight step with no
 * machine in sight, a scan step on a rack whose scanner has burned — the
 * caller says what stands, and with none of the step's moves standing the gate
 * stays open and the lesson waits for its fact like it always did.
 */
export interface LessonGate {
  readonly allows: ReadonlySet<LessonMove>;
  /** The refusal, worded once: `The lesson first: Tab.` */
  readonly why: string;
}

/**
 * The gate as it stands this turn, or nothing when nothing is gated. `stands`
 * answers whether a move can be made right now; `ui/actions.ts` supplies it
 * from the compartment's own list, which is the one thing this file may not
 * read for itself without closing an import loop.
 */
export function lessonGate(game: RoomGame, stands: (move: LessonMove) => boolean): LessonGate | undefined {
  const step = lessonAllows(game);
  if (step === undefined) return undefined;
  if (!step.allows.some(stands)) return undefined;
  return { allows: new Set(step.allows), why: t("why.lesson", { press: t(step.press) }) };
}

/** Why the gate refuses this command, or nothing when it lets it through. */
export function gateRefuses(gate: LessonGate | undefined, game: RoomGame, cmd: RoomCommand): string | undefined {
  if (gate === undefined) return undefined;
  const move = moveOf(game, cmd);
  return move !== undefined && gate.allows.has(move) ? undefined : gate.why;
}

/** Verbs that are spent on a bulkhead: the move is the door's state, not the verb. */
const DOOR_VERBS: ReadonlySet<string> = new Set(["power", "spike", "key", "ram", "cut", "weld", "defuse", "close"]);

/**
 * A command in the lesson's vocabulary, or nothing for a command no step ever
 * allows — waiting, hiding, welding a door shut, firing a module the lesson
 * does not teach.
 */
export function moveOf(game: RoomGame, cmd: RoomCommand): LessonMove | undefined {
  switch (cmd.kind) {
    case "go":
      return "walk";
    case "leave":
      return "leave";
    case "attack":
      return "attack";
    case "act": {
      const verb = cmd.verb;
      if (verb === "salvage") return "salvage";
      if (verb === "search") return "search";
      if (verb === "cure") return "purge";
      if (verb === "work") return "work";
      if (verb === "shoot") return "attack";
      if (verb === "use") {
        // The spike on a lock is `use` with the door as its target; anything
        // else aimed at a door is the door's; a bare `use` is the module's.
        if (cmd.target !== undefined) return doorMove(game, cmd.target);
        const rig = rigOf(game.player);
        const kind = cmd.slot === undefined ? undefined : rig?.slots[cmd.slot]?.kind;
        return kind === "scanner" ? "scan" : undefined;
      }
      if (DOOR_VERBS.has(verb) && cmd.target !== undefined) return doorMove(game, cmd.target);
      return undefined;
    }
    default:
      return undefined;
  }
}

function doorMove(game: RoomGame, id: number): LessonMove | undefined {
  const door = game.ship.doors[id];
  if (door?.state === "locked") return "open";
  if (door?.state === "sealed") return "cut";
  return undefined;
}

/**
 * The moves that need no list to be answered: a door to walk through, a
 * machine to close with, a scanner to fire, a strain to purge. The rest — a
 * crate, a body, a system, a way through a bulkhead — are rows of the
 * compartment's list, and the caller answers for those.
 */
export function moveStandsBare(game: RoomGame, move: LessonMove): boolean | undefined {
  const here = game.roomOf(game.player).id;
  switch (move) {
    case "walk":
    case "leave":
      return game.ship.doorsOf(here).some(passableForPlayer) || game.atAirlock();
    case "attack":
      return hostilesIn(game, here).length > 0 || [...game.visible].some((room) => hostilesIn(game, room).length > 0);
    case "scan": {
      const rig = rigOf(game.player);
      return rig !== undefined && findSlotAs(rig, "scanner") !== null;
    }
    case "purge":
      return virusOf(game.player) !== undefined;
    default:
      return undefined;
  }
}
