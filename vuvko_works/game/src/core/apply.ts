/**
 * The reducer. Commands in, a new state and a list of events out.
 *
 * Nothing here mutates what it was given. That is what makes a match
 * reproducible from `{ seed, commands }`, lets the renderer animate from the
 * event list rather than diffing state, and lets tests assert on what happened
 * rather than on what things ended up looking like.
 */

import { attackFrom, moveUnitTo, refused } from "./actions";
import type { Applied } from "./actions";
import type { Command } from "./commands";
import { turnBegan } from "./events";
import type { GameEvent } from "./events";
import { runShipTurn } from "./ship-turn";
import type { DeckMap, GameState, Unit } from "./types";

export type { Applied } from "./actions";

function readyDrones(state: GameState): Unit[] {
  return state.units.map(function readyDrone(unit: Unit): Unit {
    if (unit.side !== "drone") return unit;
    return { ...unit, movement: unit.maxMovement, hasAttacked: false };
  });
}

function endTurn(deck: DeckMap, state: GameState): Applied {
  if (state.outcome !== null) return refused(state, "the mission is over");

  const ship = runShipTurn(deck, state);
  if (ship.state.outcome !== null) return ship;

  const next: GameState = {
    ...ship.state,
    units: readyDrones(ship.state),
    turn: ship.state.turn + 1,
    side: "drone",
  };
  return { state: next, events: [...ship.events, turnBegan(next.turn, "drone")] };
}

export function applyCommand(deck: DeckMap, state: GameState, command: Command): Applied {
  if (state.outcome !== null) return refused(state, "the mission is over");
  switch (command.kind) {
    case "moveUnit":
      return moveUnitTo(deck, state, command.unitId, command.to);
    case "attackWith":
      return attackFrom(deck, state, command.attackerId, command.weaponIndex, command.target);
    case "endTurn":
      return endTurn(deck, state);
  }
}

/** Fold a whole command list, which is how a replay works. */
export function applyAll(deck: DeckMap, state: GameState, commands: readonly Command[]): Applied {
  let current = state;
  const events: GameEvent[] = [];
  for (const command of commands) {
    const step = applyCommand(deck, current, command);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}
