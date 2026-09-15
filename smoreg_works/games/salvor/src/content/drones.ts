/**
 * What a drone is called.
 *
 * A name, a tag and two digits: `NADIA KJ-07`. The name is a person's, because
 * a tug crew names its machines after people and because "the drone" is not
 * something anyone mourns — a run that loses `NADIA KJ-07` in a reactor has
 * lost a thing with a name on it, which is the whole of why this exists.
 *
 * The tag is the yard the chassis came out of, and the number is the one the
 * yard stamped on it. Neither means anything mechanically and both are said
 * everywhere the drone is: on the board, on the dock's shelf, over its rack.
 *
 * Derived rather than rolled. A drone's name has to be the same before it
 * undocks and after, and it must not cost a turn of the rng — a run is
 * `(seed, inputs)` and a name that consumed a roll would move every draw after
 * it, which is a hundred tests' worth of difference for a cosmetic string.
 */

/**
 * The yards. Five, because five is enough for two drones in one voyage to be
 * told apart and few enough to become familiar.
 */
export const DRONE_TAGS = ["DS", "KJ", "MR", "AL", "AM"] as const;

/**
 * The names themselves.
 *
 * Short, sayable, and from no one place: the crews that work hulks like these
 * are not from one. Kept to names that read at a glance in a stencil face,
 * which is what rules out the long ones rather than any thought about where
 * they come from.
 */
export const DRONE_NAMES: readonly string[] = [
  "ADA", "AMARA", "ANNIKA", "BASRA", "BENEDIKT", "BRIGID",
  "CASIMIR", "CLARA", "DALIA", "DESMOND", "EDITH", "ELIAS",
  "FARIDA", "FELIX", "GRETA", "HALIMA", "HANNE", "IDRIS",
  "INGRID", "ISOLDE", "JUNO", "KAMALA", "KESTREL", "LASZLO",
  "LEILA", "LUCIA", "MAGDA", "MARIUS", "MATEO", "NADIA",
  "NIAMH", "NORA", "OKSANA", "OMAR", "PETRA", "RAFAEL",
  "ROSA", "SANAA", "SIGRID", "SOREN", "TAMAS", "TERESA",
  "THEA", "TOMAS", "URSULA", "VESNA", "WILDA", "YUSRA",
  "ZARA", "ZOLTAN",
];

/**
 * A number from a string, and always the same one.
 *
 * The same walk the board uses for everything that has to look like itself
 * without being allowed to change what happens next (`ui/react/board/Icon.tsx`).
 */
function bucket(key: string, of: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % of;
}

/**
 * `NADIA KJ-07`, from whatever identifies the drone.
 *
 * Three draws off one key rather than one, so a voyage that builds two drones
 * in a row does not get two names one letter apart: the key is salted per part
 * and the parts move independently.
 */
export function droneName(key: string): string {
  const name = DRONE_NAMES[bucket(`${key}:name`, DRONE_NAMES.length)] as string;
  const tag = DRONE_TAGS[bucket(`${key}:tag`, DRONE_TAGS.length)] as string;
  /* Two digits, and a leading nought where it needs one: a yard stamps `07`
     and not `7`, and a column of them lines up. */
  const num = String(bucket(`${key}:num`, 100)).padStart(2, "0");
  return `${name} ${tag}-${num}`;
}
