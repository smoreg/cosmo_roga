/**
 * The one place the reducer is driven from.
 *
 * The store holds a mission and the events it has produced. It never decides
 * anything about the rules — it dispatches a command and keeps what comes
 * back, which is why the whole match can be replayed from `seed` plus
 * `history`.
 */

import { create } from "zustand";
import { applyAll, applyCommand } from "../core/apply";
import { attackWith, endTurn, moveUnit } from "../core/commands";
import type { Command } from "../core/commands";
import { parseDeck } from "../core/deck";
import type { RawDeckExport } from "../core/deck";
import type { GameEvent } from "../core/events";
import type { Axial } from "../core/hex";
import { buildMission } from "../core/mission";
import { generateDeck, previewHull } from "../render/generate";
import type { HullPreview } from "../render/generate";
import { rollMission } from "../core/missions";
import type { MissionBrief } from "../core/missions";
import { createRng } from "../core/rng";
import type { RngState } from "../core/rng";
import type { MissionSettings } from "../core/types";
import type { DeckMap, GameState } from "../core/types";

export interface GameStore {
  /** What was rolled for this mission, shown on the briefing and after. */
  brief: MissionBrief | null;
  /** The ship that seed builds, known before boarding it. */
  hull: HullPreview | null;
  /** Advances with every roll, so two missions are never the same. */
  roller: RngState;
  deck: DeckMap | null;
  state: GameState | null;
  settings: MissionSettings | null;
  /** Every command applied, in order — the save format, and what undo replays. */
  history: Command[];
  /**
   * How many commands can no longer be taken back.
   *
   * See `design/ui-kit/undo.md`. A command seals when applying it told the
   * player something they did not already know — a die was rolled, or
   * something was revealed. Everything before this index stands.
   */
  sealed: number;
  /** What `start` was given, so undo can rebuild the opening position. */
  opening: { raw: RawDeckExport; overrides?: Partial<MissionSettings> } | null;
  events: GameEvent[];
  /**
   * Just what the last dispatch produced.
   *
   * `events` is the whole mission and feeds the log; this is the beat the
   * presentation layer animates. One field, replaced not appended, so nothing
   * has to diff a growing array to find out what just happened.
   */
  lastBatch: GameEvent[];
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
  /** Take back the last command, where it revealed nothing. */
  undo: () => void;
  canUndo: () => boolean;
}

/**
 * The events that end an action's reversibility.
 *
 * A roll is the obvious one: replaying a command that consumed the generator
 * would consume a different number, which is re-rolling, which is the cheat the
 * whole rule exists to prevent. Revealing is the other, and the deck has no fog
 * today — so the list is short and is expected to grow, and lives here in one
 * place rather than as a condition spread through the reducer.
 */
const SEALING: ReadonlySet<GameEvent["kind"]> = new Set([
  "attackDeclared",
  "strikeLanded",
  "turnBegan",
]);

function sealsTheTurn(events: readonly GameEvent[]): boolean {
  return events.some(function tells(event) {
    return SEALING.has(event.kind);
  });
}

/** Laying the tiles out is cheap; it is drawing them that is not. */
function previewOf(brief: MissionBrief): HullPreview | null {
  try {
    return previewHull(brief.profile.code, brief.seed);
  } catch {
    /* Without the tile index there is no hull to describe, and the briefing
       simply says less. Boarding will report the real reason. */
    return null;
  }
}

export const useGameStore = create<GameStore>(function createStore(set, get) {
  function dispatch(command: Command): void {
    const { deck, state } = get();
    if (deck === null || state === null) return;
    const result = applyCommand(deck, state, command);
    const history = [...get().history, command];
    set({
      state: result.state,
      history,
      /* Everything up to and including a revealing command is final. */
      sealed: sealsTheTurn(result.events) ? history.length : get().sealed,
      events: [...get().events, ...result.events],
      lastBatch: [...result.events],
    });
  }

  return {
    hull: null,
    generating: false,
    generatorError: null,
    brief: null,
    roller: createRng(String(Date.now())),
    deck: null,
    state: null,
    settings: null,
    history: [],
    sealed: 0,
    opening: null,
    lastBatch: [],
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
        opening: overrides === undefined ? { raw } : { raw, overrides },
        history: [],
        sealed: 0,
        events: [],
        lastBatch: [],
        unreachableRooms: mission.report.unreachableRooms,
        nudgedPlacements: mission.report.nudgedPlacements,
      });
    },

    dispatch,

    canUndo() {
      return get().history.length > get().sealed;
    },

    /**
     * Take the last command back by not having applied it.
     *
     * There is no inverse operation to write and no snapshot to keep: the
     * reducer is pure and a match is reproducible from its opening plus its
     * command list, so undo truncates the list and replays. That also means
     * there is no second implementation of the rules that can drift from the
     * first, which is the reason this is worth having at all.
     */
    undo() {
      const { history, sealed, opening } = get();
      if (history.length <= sealed || opening === null) return;
      const kept = history.slice(0, -1);
      const deck = parseDeck(opening.raw);
      const mission = buildMission(deck, opening.overrides);
      const replayed = applyAll(mission.deck, mission.state, kept);
      set({
        deck: mission.deck,
        state: replayed.state,
        history: kept,
        events: [...replayed.events],
        /* An undo is not a beat: nothing happened, something un-happened. */
        lastBatch: [],
      });
    },

    roll() {
      const [brief, next] = rollMission(get().roller);
      set({ brief, roller: next, hull: previewOf(brief), generatorError: null });
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
        hull: previewOf(brief),
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
