import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { newGame } from "../../game.js";
import type { SalvorGame } from "../../game.js";
import { DEFAULT_TITLE, rememberSound, storedSound } from "../title.js";
import type { TitleSettings } from "../title.js";
import { TitleScreen } from "./screens/Title.js";
import { Screen } from "./Screen.js";
import { HelpCard } from "./screens/Cards.js";
import { helpOf } from "./model.js";
import { Splash } from "./screens/Splash.js";
import { MENU_MUSIC, missionTrackFor, music } from "./audio.js";

/**
 * The whole of the game, which is two states: a menu, and a run.
 *
 * The title sits *in front of* a run rather than configuring a future one —
 * the seed exists before the first key, which is what makes `?seed=N` and the
 * menu the same mechanism. Starting is therefore replacing the game behind the
 * screen, and ending is putting the menu back in front of it.
 */
export function App({ seed }: { seed: number }): ReactElement {
  /* Nothing plays and nothing is fetched until somebody has pressed the door:
     a browser will not let a page make noise before it is touched, and the
     deck art is three megabytes that should not arrive under the first frame
     of the board (`screens/Splash.tsx`). */
  const [started, setStarted] = useState(false);
  const [settings, setSettings] = useState<TitleSettings>({
    ...DEFAULT_TITLE,
    sound: storedSound() ?? DEFAULT_TITLE.sound,
    seed,
  });
  const [game, setGame] = useState<SalvorGame | null>(null);
  const [help, setHelp] = useState(false);
  const [page, setPage] = useState(0);

  /* The music follows where the run is: the menu track until a voyage starts,
     a mission track chosen by its seed after — so a seed sounds the same every
     time it is played, the same rule the board and the drone follow. */
  useEffect(
    function score() {
      if (!started) return;
      if (!settings.sound) {
        music.stop();
        return;
      }
      music.play(game === null ? MENU_MUSIC : missionTrackFor(String(game.seed)));
    },
    [started, settings.sound, game],
  );

  if (!started) return <Splash onStart={() => setStarted(true)} />;

  if (game !== null) {
    return (
      <Screen
        game={game}
        sound={settings.sound}
        onSound={(on) => {
          rememberSound(on);
          setSettings({ ...settings, sound: on });
        }}
        onNewVoyage={() => setGame(null)}
      />
    );
  }

  return (
    <>
      <TitleScreen
        settings={settings}
        onVoyage={(s) => setGame(newGame(s))}
        onTraining={(s) => setGame(newGame(s, true))}
        onHelp={() => {
          setPage(0);
          setHelp(true);
        }}
        onSeed={(s) => setSettings({ ...settings, seed: s })}
        onSound={(on) => {
          rememberSound(on);
          setSettings({ ...settings, sound: on });
        }}
      />
      {help ? <HelpOnTitle page={page} onPage={setPage} onClose={() => setHelp(false)} /> : null}
    </>
  );
}

/**
 * The controls, before there is a run to read them off.
 *
 * `helpOf` wants a game because the list changes with where the drone is
 * standing, so the menu asks about a throwaway one at seed zero. It is read
 * and dropped on the same frame and never advances, which is the one use a
 * game that is not the run may be put to.
 */
function HelpOnTitle({
  page,
  onPage,
  onClose,
}: {
  page: number;
  onPage: (n: number) => void;
  onClose: () => void;
}): ReactElement {
  const help = helpOf(newGame(0));
  return (
    <HelpCard
      pages={help.pages}
      headings={help.headings}
      page={page}
      onPage={onPage}
      onClose={onClose}
    />
  );
}
