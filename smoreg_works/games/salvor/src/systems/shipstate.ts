import type { RoomGame } from "@jamrog/engine";
import type { ObjectiveId, ObjectiveJob } from "../content/objectives.js";

/**
 * What a derelict remembers about being taken apart, and nothing else.
 *
 * A leaf on purpose. Three systems read this record — `systems/ship.ts` writes
 * it, `systems/voyage.ts` prices the hull off it, `systems/rival.ts` races it —
 * and while it lived inside `ship.ts` two of those had to import the whole
 * splicing machinery to read one array, which is what made `ship` and `voyage`
 * import each other (`docs/adr/0003-decoupling.md`).
 */

/** A splice in progress: several turns in a row on one system. */
export interface ShipWork {
  /** `ShipSystem.id` of what is being worked on. */
  id: number;
  /** Turns still to spend. Zero on the turn it comes online. */
  left: number;
  tool: ObjectiveJob["tool"];
}

/** What a derelict remembers about being neutralised. Survives leaving it. */
export interface ShipState {
  /** Systems already up, in the order they came up. */
  online: ObjectiveId[];
  work?: ShipWork;
}

/**
 * The current derelict's state, created on first use.
 *
 * In `StoredShip.data` and not on the drone: a ship half neutralised is the
 * *ship's* condition, and the run walks back into it a sortie later with a
 * different drone (design-doc.md, "Персистентный дереликт"). Read defensively —
 * the pocket round-trips through a save.
 */
export function shipState(game: RoomGame): ShipState {
  const data = game.currentShip.data;
  const raw = data.ship;
  if (typeof raw === "object" && raw !== null && Array.isArray((raw as ShipState).online)) {
    return raw as ShipState;
  }
  const fresh: ShipState = { online: [] };
  data.ship = fresh;
  return fresh;
}
