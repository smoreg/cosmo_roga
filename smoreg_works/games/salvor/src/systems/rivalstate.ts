import type { RoomGame } from "@jamrog/engine";

/**
 * What a derelict remembers about the competing tug, and nothing else.
 *
 * A leaf, for the same reason `systems/shipstate.ts` is one: `systems/voyage.ts`
 * has to know whether the hull is already spoken for before it pays for it, and
 * importing the whole racing system to read one number is what made `rival` and
 * `voyage` import each other (`docs/adr/0003-decoupling.md`).
 */

/**
 * What a derelict remembers about the other tug. Lives in `StoredShip.data`,
 * so a sortie later the rival is where it got to and not back at the airlock.
 */
export interface RivalState {
  /** Is another tug working this hull at all? The hull's spec decides. */
  enabled: boolean;
  /** Systems it has taken: `RIVAL ▮▮▯`, and at OBJECTIVE_COUNT the charter is gone. */
  progress: number;
  /** Is its drone aboard right now? False once it has run for its lock. */
  alive?: boolean;
  /** Turns left to reach the airlock, once the ship is no longer up for grabs. */
  evac?: number;
  /** Ids of the systems it has raised, so it never works one twice. */
  taken?: number[];
  /** How many times it has rolled for this ship. See `rivalRng`. */
  rolls?: number;
}

/**
 * The other tug's state on this derelict, or a disabled stand-in.
 *
 * A hull nobody switched the rival on for gets no pocket written into it: the
 * spec that decides `enabled` runs before this system does, and an
 * `{enabled: false}` written here first would be a record to overwrite rather
 * than a question already answered. Read defensively either way — the pocket
 * round-trips through a save file.
 */
export function rivalState(game: RoomGame): RivalState {
  const raw = game.currentShip.data.rival;
  if (!isState(raw)) return { enabled: false, progress: 0, alive: false, taken: [], rolls: 0 };
  raw.taken ??= [];
  raw.rolls ??= 0;
  return raw;
}

function isState(raw: unknown): raw is RivalState {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Partial<RivalState>;
  return typeof s.enabled === "boolean" && typeof s.progress === "number";
}
