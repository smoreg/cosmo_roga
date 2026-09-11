import { parseDeck } from "../deck";
import type { RawDeckExport } from "../deck";
import { buildMission } from "../mission";
import type { BuiltMission } from "../mission";
import type { DeckMap, MissionSettings } from "../types";
import raw from "./deck.json";

/** Hollow Tide — Barque, as `hexmap.html` exported it. */
export function testDeck(): DeckMap {
  return parseDeck(raw as unknown as RawDeckExport);
}

export function testMission(overrides?: Partial<MissionSettings>): BuiltMission {
  return buildMission(testDeck(), overrides);
}
