import { useCallback, useMemo } from "react";
import { CreditsScreen } from "../components/organisms/CreditsScreen";
import { LoadingScreen } from "../components/organisms/LoadingScreen";
import { SettingsScreen } from "../components/organisms/SettingsScreen";
import { SplashScreen } from "../components/organisms/SplashScreen";
import { TitleScreen } from "../components/organisms/TitleScreen";
import { useLoader } from "../hooks/useLoader";
import { useMusic } from "../hooks/useMusic";
import { useGameStore } from "../stores/game-store";
import type { GameStore } from "../stores/game-store";
import { useSettingsStore } from "../stores/settings-store";
import { useUiStore } from "../stores/ui-store";
import type { UiStore } from "../stores/ui-store";
import { BuildStamp } from "../components/atoms/BuildStamp";
import { GamePage } from "./GamePage";
import deckExport from "../assets/decks/hollow-tide-35ft.json";

/** The tiles the opening deck needs, so the loader fetches something real. */
function openingTilePaths(): string[] {
  const plan = (deckExport as { plan?: { path: string }[] }).plan ?? [];
  return [
    ...new Set(
      plan.map(function path(placement) {
        return placement.path;
      }),
    ),
  ];
}

/* Selectors live here rather than inline, so each one is written once. */
function selectScreen(store: UiStore) {
  return store.screen;
}
function selectGo(store: UiStore) {
  return store.go;
}
function selectOpenSettings(store: UiStore) {
  return store.openSettings;
}
function selectOpenCredits(store: UiStore) {
  return store.openCredits;
}
function selectCloseOverlay(store: UiStore) {
  return store.closeOverlay;
}
function selectBrief(store: GameStore) {
  return store.brief;
}
function selectRoll(store: GameStore) {
  return store.roll;
}

export function App() {
  const screen = useUiStore(selectScreen);
  const go = useUiStore(selectGo);
  const openSettings = useUiStore(selectOpenSettings);
  const openCredits = useUiStore(selectOpenCredits);
  const closeOverlay = useUiStore(selectCloseOverlay);

  const brief = useGameStore(selectBrief);
  const roll = useGameStore(selectRoll);

  const settings = useSettingsStore();

  const tiles = useMemo(function tilesOnce() {
    return openingTilePaths();
  }, []);
  const loader = useLoader(tiles, screen === "loading");

  useMusic(screen, screen === "mission" ? (brief?.seed ?? null) : null);

  const proceed = useCallback(
    function fromSplash() {
      go("loading");
    },
    [go],
  );

  const toTitle = useCallback(
    function fromLoading() {
      go("title");
    },
    [go],
  );

  const newGame = useCallback(
    function fromTitle() {
      roll();
      go("briefing");
    },
    [roll, go],
  );

  return (
    <>
      {pick()}
      <BuildStamp />
    </>
  );

  function pick() {
    switch (screen) {
      case "splash":
        return <SplashScreen onProceed={proceed} />;
      case "loading":
        return (
          <LoadingScreen
            steps={loader.steps}
            fraction={loader.fraction}
            done={loader.done}
            onContinue={toTitle}
          />
        );
      case "title":
        return (
          <TitleScreen onNewGame={newGame} onSettings={openSettings} onCredits={openCredits} />
        );
      case "settings":
        return (
          <SettingsScreen
            volume={settings.volume}
            muted={settings.muted}
            onVolume={settings.setVolume}
            onMuted={settings.setMuted}
            onBack={closeOverlay}
          />
        );
      case "credits":
        return <CreditsScreen onBack={closeOverlay} />;
      case "briefing":
      case "mission":
        return <GamePage />;
    }
  }
}
