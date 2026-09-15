import type { Entity, RoomGame } from "@jamrog/engine";
import { t } from "../i18n.js";
import type { Key } from "./i18n/keys.js";
import { HINT_KEYS } from "./modules.js";
import { isTraining } from "./tutorial.js";

/**
 * Everything the game ever says about itself, and the one rule for saying it
 * (design-doc.md, "Обучение конструкцией").
 *
 * There is no tutorial level, no arrow and no modal. What a player is told is
 * five log lines, and each of them is said on the turn the rule behind it first
 * costs them something: a hint read before it matters is a hint nobody
 * remembers. The other lines here are quieter — they answer a situation rather
 * than a rule — and they go through the same door because "once a run" is the
 * only thing every one of them has in common.
 *
 * Two of those quiet ones say what the sortie is *for*: `objective` the first
 * time the drone stands in a compartment with one of the ship's three systems,
 * `payout` the first time it is carrying credits it can be killed with. Both
 * were added after the owner flew two whole derelicts without finding out that
 * neutralising one is what the run is about (docs/owner-queue.md, 4 and 5).
 *
 * The flags live in `player.data.hints` rather than in `game.flags`, and that
 * is deliberate: the player entity is what carries from the tug to a derelict
 * and back, and what a save file round-trips, so a reloaded run does not start
 * explaining itself over again. It is also what makes "once per run" true
 * across a lost drone — the drone dies, the operator does not.
 *
 * The texts sit in `content/` because they are content: the systems that own
 * the moments (`twist/rig.ts`, `systems/doors.ts`, `systems/voyage.ts`) call in
 * here with an id and never carry a string of their own.
 */

/**
 * The five the design doc owes the player, in the order a run meets them:
 * the first blow into a module, the first module lost, the first keycard, the
 * first hold sold, the first drone lost.
 */
export const ONBOARDING_HINTS = ["exposure", "burned", "keycard", "sold", "death"] as const;

/**
 * Every line, by the flag it is remembered under — as keys, not as words.
 *
 * `exposure`, `burned`, `scrap` and `blind` are `content/modules.ts`'s and are
 * re-exported rather than moved: that file is the rack's numbers, it is edited
 * by whoever balances them, and a line that reads "hits land on whatever you
 * last used" belongs next to the rack it describes as much as it belongs here.
 *
 * `sold` is missing on purpose — it is the one line that carries numbers, and
 * `soldLine` below is what fills them in.
 */
export const HINT_LINE_KEYS = {
  ...HINT_KEYS,
  /** The turn the drone first holds a keycard: what the `[ ]` on the schematic means. */
  keycard: "hint.keycard",
  /**
   * The turn the first drone does not come back. The same sentence as
   * `systems/ghost.ts`'s ghost warning, said here because the drone is standing
   * on the tug by then and the ghost's own file has nobody to say it to.
   */
  death: "hint.death",
  /**
   * The first module sold. There is no shop in this game and no buying one
   * back (docs/scope-rules.md), and the owner found that out by selling his
   * cutter and hunting for the line that would return it — so the line says so
   * once, on the sale, and points at the hold, which is the thing he wanted
   * (docs/tasks/G53-tug-is-a-menu.md, 4).
   */
  sell: "hint.sell",
  /**
   * The first shot traded with something that can shoot back. The rule is
   * `exposure`'s — a blow lands on whatever was last used — said again for the
   * one case a player meets it in without ever being in the room: the emitter
   * is the most brittle module on a rack, and a machine with a reach answers
   * from where it stands (docs/owner-queue.md, 1).
   */
  shooting: "hint.shooting",
  /**
   * The turn the drone first stands in a compartment with one of the ship's
   * three systems in it: what the three of them are for, and what raising all
   * of them is worth (`systems/ship.ts`, docs/owner-queue.md, 4).
   */
  objective: "hint.objective",
  /**
   * The turn the drone is first carrying credits: nothing — hold or charter —
   * is paid until it is back out through the airlock (docs/owner-queue.md, 5).
   */
  payout: "hint.payout",
  /**
   * Turn zero: the mouse works. Clicking a numbered line and clicking a box on
   * the schematic have both worked since G84 and G31, and neither was written
   * down anywhere in any of the three languages — while the owner plays with a
   * mouse (docs/tasks/G87-playability.md, 3).
   */
  mouse: "hint.mouse",
} as const satisfies Record<string, Key>;

export type HintId = keyof typeof HINT_LINE_KEYS | "sold";

// ------------------------------------------------------------- the first lines

/**
 * The first thing the log ever says, and it is not flavour.
 *
 * The owner's first playtest stood in the DOCK and asked "where is the tug?
 * where do I pick a drone? what is happening?" — with the screen already
 * showing all three. Nothing was missing except a sentence saying which of the
 * four compartments does what, so this is that sentence, said once at the top
 * of the run where a player is still reading (design-doc.md, "Обучение
 * конструкцией").
 */
export const TUG_OPENING_KEY = "log.opening.tug";

/** The line itself, in whichever language is on. */
export function tugOpening(): string {
  return t(TUG_OPENING_KEY);
}

/**
 * Callsigns a tug flies under. Picked by the run's own seed rather than by a
 * draw off `game.rng`: a name is not content the generator has to balance, and
 * spending an rng call on one would move every ship, machine and keycard of
 * every seed that ever existed.
 *
 * **Shares not one word with `CALLSIGNS`**, the list the derelicts of a voyage
 * draw from, and `tests/tug.test.ts` holds it. Four of these used to: the
 * owner's second run opened on `ТВОЙ БУКСИР «BRIGHT ANCHOR» · пришвартован:
 * BRIGHT ANCHOR` and he could not tell which of the two ships any line was
 * about (docs/tasks/G54-two-ships-confusion.md, 4). Made disjoint here rather
 * than by drawing around the itinerary, because the itinerary's own names are
 * rolled one hull at a time, at the jump — so at the moment the tug is first
 * named, most of them do not exist yet. Two lists that cannot collide need no
 * draw, survive a replay, and cannot come apart later: `IRON KESTREL` beside a
 * `KESTREL` is the same confusion one word further on, so the rule is words and
 * not whole names.
 */
export const TUG_CALLSIGNS: readonly string[] = [
  "DEAD RECKONING",
  "LONG WINTER",
  "SALT DRIFTER",
  "COLD LANTERN",
  "GREY HARROW",
  "LAST FERRY",
  "IRON WIDOW",
  "STILL HARBOUR",
];

/** The tug's own name this run. Pure in the seed, so a replay flies the same hull. */
export function tugCallsign(seed: number): string {
  const i = Math.abs(Math.trunc(seed)) % TUG_CALLSIGNS.length;
  return TUG_CALLSIGNS[i]!;
}

/**
 * The second line of a run: who you are and how far out the voyage goes.
 *
 * The last hull of the itinerary is the father's tug and taking it is the whole
 * game (design-doc.md, "Победа"), so it is said on turn zero rather than found
 * three jumps later.
 */
export function voyageOpening(callsign: string, hulls: number): string {
  return t("log.opening.voyage", { callsign, hulls });
}

/**
 * The first return through the airlock, and the whole economy in one line: what
 * the hold was worth against what the next drone costs (design-doc.md,
 * "Обучение конструкцией", 5). After this the player counts for themselves.
 */
export function soldLine(credits: number, hullPrice: number): string {
  return t("hint.sold", { credits, hullPrice });
}

/**
 * Ordinary lines the lesson says itself, in its own window.
 *
 * `objective` is the systems step in other words and `payout` is the airlock
 * step in other words (`content/tutorial.ts`, `LESSON_STEPS`), and a training
 * run used to hear both of each: 94 and 88 of 120 runs heard the same rule
 * twice, often a turn apart, which is how a player learns that the log repeats
 * itself rather than that the rule matters (docs/tasks/G86-tutorial-and-title.md, 5).
 *
 * Silent for the whole of a training run rather than only while the lesson is
 * on, because the two lines are one topic and the window is the one that says
 * it in the compartment it is about. The flag is ticked with the silence, so
 * the twin does not reappear on the second hull of the same voyage.
 */
const LESSON_SAYS: ReadonlySet<HintId> = new Set<HintId>(["objective", "payout"]);

/**
 * One onboarding line, said once per run and never again. True when the line
 * went into the log, so a caller with two of them to offer can stop at the
 * first (`systems/ship.ts`, `sayTheRules`).
 *
 * `text` is only ever passed for `sold`, which is the one line with a number in
 * it; everything else reads its own row out of the table above, so a caller
 * cannot put words in the game's mouth by accident.
 */
export function hint(game: RoomGame, id: HintId, text?: string): boolean {
  const key: Key | undefined = id === "sold" ? undefined : HINT_LINE_KEYS[id];
  const line = text ?? (key === undefined ? undefined : t(key));
  if (line === undefined) return false;
  const said = hintsOf(game.player);
  if (said[id] === true) return false;
  // Ticked off rather than merely skipped: the lesson owns this topic for the
  // rest of the run, hulls after the training one included.
  if (LESSON_SAYS.has(id) && isTraining(game.player)) {
    said[id] = true;
    return false;
  }
  said[id] = true;
  game.log.add(line, game.schedule.time, "warn", `hint.${id}`);
  return true;
}

/**
 * How much room this turn has left for a lesson, and whether anything has
 * already spoken in it.
 *
 * The log is seven rows (`ui/theme.ts`, `LAYOUT.logHeight`) and it does not
 * stretch: 365 of 1639 turns that said anything at all said two things or
 * three, and 415 hints shared their turn with a blow, a death or the alarm
 * (docs/tasks/G86-tutorial-and-title.md, 6). So a lesson asks the turn what is
 * left of it before taking a row:
 *
 *   `left`   rows a hint may still use — two a turn, and none at all over the
 *            alarm, which is a red row that does not fade and owns its turn.
 *   `taken`  something has already been said: another hint, or a blow the drone
 *            took, its own `log.hit.*` wording included. A lesson that can be
 *            said next turn waits; one whose moment is now does not
 *            (`content/tutorial.ts`, `TutorialStep.urgent`).
 *
 * Two rather than one, and that number was measured rather than chosen. The
 * boarding turn of the training hull hands the drone the numbered list, a
 * machine in the compartment and — on most seeds — the locked bulkhead, all at
 * once, and the machine is dead by the next turn: with one row a turn the
 * lesson about fighting was said after the fight or not at all, in 0 of 120
 * runs, and reversing the order only moved the loss onto the bulkhead
 * (15 %). Two rows is the smallest budget that teaches both.
 *
 * A blow the drone *lands*, and a machine dying, are deliberately not counted
 * as speech: the turn a machine is first in sight is usually the turn the fight
 * starts and the turn it ends.
 *
 * Asked only where the question is re-asked every turn, so nothing is lost by
 * waiting. A one-shot line fired by the event that owns it never comes through
 * here: it would have nowhere to come back from.
 */
export interface TurnRoom {
  readonly left: number;
  readonly taken: boolean;
}

/** Hints one turn may carry, the teaching and the nudges together. */
const HINTS_PER_TURN = 2;

export function turnRoom(game: RoomGame): TurnRoom {
  const lines = game.log.lines;
  const now = game.schedule.time;
  let hints = 0;
  let taken = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.turn !== now) break;
    if (line.tone === "alarm") return { left: 0, taken: true };
    const key = line.key ?? "";
    if (key.startsWith("hint.")) {
      hints++;
      taken = true;
    } else if (key === "engine.hit.taken" || key.startsWith("log.hit.")) {
      taken = true;
    }
  }
  return { left: Math.max(0, HINTS_PER_TURN - hints), taken };
}

/** Has this line been said this run? What the tests and the systems both ask. */
export function saidHint(player: Entity, id: string): boolean {
  return hintsOf(player)[id] === true;
}

/**
 * The bag of flags, created on first use. Read defensively: it comes back out
 * of a save file, where it is whatever JSON made of it.
 */
function hintsOf(player: Entity): Record<string, boolean> {
  const data = (player.data ??= {});
  const existing = data.hints as Record<string, boolean> | undefined;
  if (existing) return existing;
  const fresh: Record<string, boolean> = {};
  data.hints = fresh;
  return fresh;
}

