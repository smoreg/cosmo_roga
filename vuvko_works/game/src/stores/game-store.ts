/**
 * The one place the reducer is driven from.
 *
 * The store holds a mission and the events it has produced. It never decides
 * anything about the rules — it dispatches a command and keeps what comes
 * back, which is why the whole match can be replayed from `seed` plus
 * `history`.
 */

import { create } from "zustand";
import { applyCommand } from "../core/apply";
import { attackWith, endTurn, moveUnit } from "../core/commands";
import type { Command } from "../core/commands";
import { parseDeck } from "../core/deck";
import type { RawDeckExport } from "../core/deck";
import type { GameEvent } from "../core/events";
import type { Axial } from "../core/hex";
import { buildMission } from "../core/mission";
import { generateDeck } from "../render/generate";
import { rollMission } from "../core/missions";
import type { MissionBrief } from "../core/missions";
import { createRng } from "../core/rng";
import type { RngState } from "../core/rng";
import type { MissionSettings } from "../core/types";
import type { DeckMap, GameState } from "../core/types";

export interface GameStore {
  /** What was rolled for this mission, shown on the briefing and after. */
  brief: MissionBrief | null;
  /** Advances with every roll, so two missions are never the same. */
  roller: RngState;
  deck: DeckMap | null;
  state: GameState | null;
  settings: MissionSettings | null;
  /** Every command applied, in order — the save format. */
  history: Command[];
  events: GameEvent[];
  unreachableRooms: readonly string[];
  nudgedPlacements: number;

  /** Roll a mission type and a hull, and show the briefing. */
  roll: () => void;
  /** True while a hull is being generated. */
  generating: boolean;
  /** What went wrong generating, if anything. */
  generatorError: string | null;
  /** Generate the rolled hull and begin the mission. */
  launch: (overrides?: Partial<MissionSettings>) => Promise<void>;
  /** Back to the briefing, rolling the next one. */
  toBriefing: () => void;
  start: (raw: RawDeckExport, overrides?: Partial<MissionSettings>) => void;
  dispatch: (command: Command) => void;
  move: (unitId: number, to: Axial) => void;
  attack: (attackerId: number, weaponIndex: number, target: Axial) => void;
  finishTurn: () => void;
}

export const useGameStore = create<GameStore>(function createStore(set, get) {
  function dispatch(command: Command): void {
    const { deck, state } = get();
    if (deck === null || state === null) return;
    const result = applyCommand(deck, state, command);
    set({
      state: result.state,
      history: [...get().history, command],
      events: [...get().events, ...result.events],
    });
  }

  return {
    generating: false,
    generatorError: null,
    brief: null,
    roller: createRng(String(Date.now())),
    deck: null,
    state: null,
    settings: null,
    history: [],
    events: [],
    unreachableRooms: [],
    nudgedPlacements: 0,

    start(raw, overrides) {
      const deck = parseDeck(raw);
      const mission = buildMission(deck, overrides);
      set({
        deck: mission.deck,
        state: mission.state,
        settings: mission.settings,
        history: [],
        events: [],
        unreachableRooms: mission.report.unreachableRooms,
        nudgedPlacements: mission.report.nudgedPlacements,
      });
    },

    dispatch,

    roll() {
      const [brief, next] = rollMission(get().roller);
      set({ brief, roller: next });
    },

    async launch(overrides) {
      const brief = get().brief;
      if (brief === null) return;
      set({ generating: true, generatorError: null });
      try {
        const raw = await generateDeck({
          profile: brief.profile.code,
          seed: brief.seed,
          tilesBaseUrl: `${import.meta.env.BASE_URL}geomorphs/`,
        });
        get().start(raw, { seed: brief.seed, ...overrides });
        set({ generating: false });
      } catch (problem) {
        /* A hull that will not build is worth saying out loud rather than
           dropping the player into a mission they did not ask for. */
        const reason = problem instanceof Error ? problem.message : "the hull would not build";
        set({ generating: false, generatorError: reason });
      }
    },

    toBriefing() {
      const [brief, next] = rollMission(get().roller);
      set({
        brief,
        roller: next,
        deck: null,
        state: null,
        events: [],
        history: [],
      });
    },

    move(unitId, to) {
      dispatch(moveUnit(unitId, to));
    },

    attack(attackerId, weaponIndex, target) {
      dispatch(attackWith(attackerId, weaponIndex, target));
    },

    finishTurn() {
      dispatch(endTurn());
    },
  };
});
