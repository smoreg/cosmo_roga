/** Deterministic mission states, so a story shows a real position. */

import { applyCommand } from "../core/apply";
import { endTurn } from "../core/commands";
import { parseDeck } from "../core/deck";
import type { RawDeckExport } from "../core/deck";
import type { GameEvent } from "../core/events";
import { buildMission } from "../core/mission";
import type { DeckMap, GameState, MissionSettings } from "../core/types";
import { describeAll } from "../lib/log";
import type { LogLine } from "../lib/log";
import raw from "../assets/decks/hollow-tide-35ft.json";

export interface Scene {
  readonly deck: DeckMap;
  readonly state: GameState;
  readonly lines: readonly LogLine[];
  readonly unreachableRooms: readonly string[];
}

function nameMap(state: GameState): Map<number, string> {
  const names = new Map<number, string>();
  for (const unit of state.units) names.set(unit.id, unit.name);
  for (const object of state.objects) names.set(object.id, object.name);
  return names;
}

export function scene(turns: number, overrides?: Partial<MissionSettings>): Scene {
  const deck = parseDeck(raw as unknown as RawDeckExport);
  const mission = buildMission(deck, { seed: "storybook", ...overrides });

  let state = mission.state;
  const events: GameEvent[] = [];
  for (let i = 0; i < turns; i++) {
    if (state.outcome !== null) break;
    const result = applyCommand(deck, state, endTurn());
    state = result.state;
    events.push(...result.events);
  }

  return {
    deck,
    state,
    lines: describeAll(events, deck, nameMap(state)),
    unreachableRooms: mission.report.unreachableRooms,
  };
}
