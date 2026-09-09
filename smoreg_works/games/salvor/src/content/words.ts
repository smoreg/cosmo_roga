import type { DoorState } from "@jamrog/engine";
import { tId } from "../i18n.js";

/**
 * The handful of single words the screen builds lines out of: what a command
 * does to a door, and what state a door is in.
 *
 * They are one-word rows rather than part of the sentences that use them
 * because the action list is columns, not prose — `go d4  HAB  open` is four
 * fields a player reads down, and a translation that folded the verb into the
 * sentence would lose the column. The width of both halves is what
 * `tests/i18n.test.ts` holds to 25 columns in all three languages.
 */

/** `go`, `cut`, `spike`: the head of an action line. */
export function verbWord(verb: string): string {
  return tId("verb", verb, verb);
}

/** `open`, `locked`, `sealed`: the tail of one. `out` is the airlock's. */
export function doorStateWord(state: DoorState | "out"): string {
  return tId("state", state, state);
}
