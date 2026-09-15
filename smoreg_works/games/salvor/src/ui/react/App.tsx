import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { newGame } from "../../game.js";
import type { SalvorGame } from "../../game.js";
import { Menu, type MenuPage, type MenuSettings } from "./screens/Menu.js";
import { Generating } from "./screens/Generating.js";
import { Splash } from "./screens/Splash.js";
import { Screen } from "./Screen.js";
import { BUILD_VERSION } from "../title.js";
import { MENU_MUSIC, missionTrackFor, music } from "./audio.js";
import { sfx } from "./sfx.js";
import {
  rememberMotion,
  rememberVolume,
  setMotion,
  storedMotion,
  storedVolume,
} from "./settings.js";

/**
 * The whole of the game, which is two states: a menu, and a run.
 *
 * The menu is not a screen of its own — it is the game's own chrome with the
 * system drawer open, which is what a player sees after pressing the hamburger
 * mid-run. So arriving and pausing are one picture, and there is nothing to
 * keep in step.
 *
 * The seed is the page's, never the menu's. `?seed=N` reproduces a voyage
 * exactly and is the cheapest bug report there is; without one every new game
 * rolls its own. Neither is shown or editable here: a seed on a menu is an
 * invitation to fish for a good one, which is a different game.
 */
export function App({ seed }: { seed: number }): ReactElement {
  const [started, setStarted] = useState(false);
  const [page, setPage] = useState<MenuPage>("root");
  const [game, setGame] = useState<SalvorGame | null>(null);
  const [running, setRunning] = useState(false);
  /* A voyage that exists but has not been handed over yet: the generating
     screen is up. Held rather than dropped and rebuilt, so what the player
     watches appear is the ship they were given. */
  const [pending, setPending] = useState<SalvorGame | null>(null);
  /* Muting is not a volume of zero: it silences without forgetting where the
     slider was, so unmuting puts it back rather than at nothing. */
  const [muted, setMuted] = useState(false);
  const [settings, setSettings] = useState<MenuSettings>(() => ({
    volume: storedVolume(),
    motion: storedMotion(),
  }));

  /* What was set last session, applied before the first frame is drawn. */
  useEffect(function first() {
    setMotion(storedMotion());
    music.setVolume(storedVolume());
    sfx.setVolume(storedVolume());
  }, []);

  const change = (next: MenuSettings): void => {
    setSettings(next);
    rememberVolume(next.volume);
    rememberMotion(next.motion);
    setMotion(next.motion);
    music.setVolume(next.volume);
    sfx.setVolume(next.volume);
  };

  /* The music follows where the run is: the menu track while the menu is up, a
     mission track chosen by its seed once a voyage starts — so a seed sounds
     the same every time it is played, the rule the board and the drone follow. */
  useEffect(
    function score() {
      if (!started) return;
      /* The track follows the *run*, not the screen. Opening the menu mid-run
         used to start the menu music over the top of it, which is the game
         announcing that you have left when you have only paused: the drone is
         where you left it and so is the score. It changes when a voyage starts
         and when one ends, and at no other time. */
      const run = game ?? pending;
      music.play(run === null ? MENU_MUSIC : missionTrackFor(String(run.seed)));
    },
    [started, game, pending],
  );

  /* The click that starts the audio is also the moment the clips can be
     fetched: before it the browser will not play anything anyway. */
  if (!started)
    return (
      <Splash
        onStart={() => {
          sfx.warm();
          setStarted(true);
        }}
      />
    );

  /* The second between asking for a ship and being aboard one. The voyage is
     already built and waiting — the delay buys the change of place, not the
     work, and it is also the room the music needs to change over. */
  if (pending !== null) {
    return (
      <Generating
        onDone={() => {
          setGame(pending);
          setPending(null);
          setRunning(true);
        }}
      />
    );
  }

  if (running && game !== null) {
    return (
      <Screen
        game={game}
        muted={muted}
        settings={settings}
        onMute={(next) => {
          setMuted(next);
          music.setVolume(next ? 0 : settings.volume);
          sfx.setMuted(next);
        }}
        onSettings={change}
        onMenu={() => setRunning(false)}
        onNewVoyage={() => {
          setGame(null);
          setRunning(false);
        }}
      />
    );
  }

  return (
    <Menu
      page={page}
      canContinue={game !== null}
      settings={settings}
      foot={`build ${BUILD_VERSION}`}
      onPage={setPage}
      onContinue={() => setRunning(true)}
      onNewGame={() => {
        /* A fresh voyage. The page's seed where one was asked for, so a bug
           report reproduces; a new roll otherwise. */
        setPending(newGame(game === null ? seed : (Math.random() * 0xffffffff) >>> 0));
      }}
      onSettings={change}
    />
  );
}
