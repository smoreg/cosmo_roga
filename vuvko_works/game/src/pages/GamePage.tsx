import { useEffect, useMemo, useState } from "react";
import { GameScreen } from "../components/organisms/GameScreen";
import { MissionBriefing } from "../components/organisms/MissionBriefing";
import { OutcomeDialog } from "../components/organisms/OutcomeDialog";
import { liveSpawners } from "../core/topology";
import { describeAll } from "../lib/log";
import { useBlueprint } from "../hooks/useBlueprint";
import { useMissionInput } from "../hooks/useMissionInput";
import { useGameStore } from "../stores/game-store";
import { useUiStore } from "../stores/ui-store";

/**
 * Where the tiles are served from, relative to the page.
 *
 * The downscaled set built by `scripts/bake_tile_atlas.py` lives in public/, so
 * dev and a build load exactly the same files. itch serves a game out of a
 * subdirectory, which is why this is relative and not "/geomorphs/".
 */
const TILES_BASE_URL = `${import.meta.env.BASE_URL}geomorphs/`;

/** Wires the store to the screen. It holds no layout of its own. */
export function GamePage() {
  const store = useGameStore();
  const screen = useUiStore(function pickScreen(ui) {
    return ui.screen;
  });
  const go = useUiStore(function pickGo(ui) {
    return ui.go;
  });
  const { deck, state, dispatch, finishTurn, events, unreachableRooms } = store;
  const { brief, roll, launch, toBriefing, generating, generatorError } = store;
  const input = useMissionInput(deck, state, dispatch);

  /* The ship's own artwork, drawn once per deck. Null until it is ready, and
     null if the tile library is not being served — the map falls back to its
     schematic, which needs no assets. */
  const backdrop = useBlueprint(deck, TILES_BASE_URL);

  /* Roll the first contract on the way in, so the board is never empty. */
  useEffect(
    function rollOnce() {
      if (brief === null) roll();
    },
    [brief, roll],
  );

  const [lastOutcome, setLastOutcome] = useState<"win" | "loss" | null>(null);

  const names = useMemo(
    function buildNames() {
      const map = new Map<number, string>();
      for (const unit of state?.units ?? []) map.set(unit.id, unit.name);
      for (const object of state?.objects ?? []) map.set(object.id, object.name);
      return map;
    },
    [state],
  );

  const lines = useMemo(
    function describe() {
      if (deck === null) return [];
      return describeAll(events, deck, names);
    },
    [events, deck, names],
  );

  function boardIt(): void {
    void launch().then(function aboard() {
      if (useGameStore.getState().deck !== null) go("mission");
      return undefined;
    });
  }

  function nextContract(): void {
    setLastOutcome(state?.outcome ?? null);
    toBriefing();
    go("briefing");
  }

  if (screen === "briefing" || deck === null || state === null) {
    return (
      <MissionBriefing
        brief={brief}
        onRoll={roll}
        onLaunch={boardIt}
        lastOutcome={lastOutcome}
        busy={generating}
        error={generatorError}
      />
    );
  }

  /* How it ended, in the words of the rule that ended it. */
  const detail =
    state.outcome === "win"
      ? liveSpawners(state).length === 0
        ? "Every spawn zone is down. The ship has nothing left to build with."
        : "The nodes are cut and the last of it is dead. What spawn zones remain can never be paid for."
      : "Nothing is coming back to the tug.";

  return (
    <>
      <GameScreen
        deck={deck}
        state={state}
        lines={lines}
        unreachableRooms={unreachableRooms}
        backdropUrl={backdrop ?? undefined}
        selected={input.selected?.at ?? null}
        reachable={input.reachable}
        forceable={input.forceable}
        plan={input.plan}
        pending={input.pending}
        onPick={input.pick}
        onHover={input.hover}
        onChoose={input.choose}
        onClear={input.clear}
        onEndTurn={finishTurn}
      />
      {state.outcome === null ? null : (
        <OutcomeDialog
          outcome={state.outcome}
          turn={state.turn}
          detail={detail}
          onContinue={nextContract}
        />
      )}
    </>
  );
}
