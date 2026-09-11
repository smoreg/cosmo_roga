import { useEffect } from "react";
import { MENU_MUSIC, missionTrackFor, music } from "../lib/audio";
import { useSettingsStore } from "../stores/settings-store";
import type { Screen } from "../stores/ui-store";

/**
 * One track at a time, chosen by where the player is.
 *
 * Everything outside a mission shares the menu loop, so moving between the
 * title and settings does not restart it. A mission's track is picked from its
 * own seed, which means replaying a seed sounds the same as it did.
 */
export function useMusic(screen: Screen, missionSeed: string | null): void {
  const volume = useSettingsStore(function pick(store) {
    return store.volume;
  });
  const muted = useSettingsStore(function pickMuted(store) {
    return store.muted;
  });

  useEffect(
    function follow() {
      music.setVolume(muted ? 0 : volume);
    },
    [volume, muted],
  );

  useEffect(
    function choose() {
      /* Nothing before the splash: the browser would refuse it anyway. */
      if (screen === "splash") return;
      if (screen === "mission" && missionSeed !== null) {
        music.play(missionTrackFor(missionSeed));
        return;
      }
      music.play(MENU_MUSIC);
    },
    [screen, missionSeed],
  );
}
