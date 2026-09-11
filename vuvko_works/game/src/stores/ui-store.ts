import { create } from "zustand";

/**
 * Where the player is, at the level above a mission.
 *
 * `splash` exists for a mechanical reason, not a decorative one: a browser
 * will not let a page make noise until someone has touched it, so the game
 * needs one gesture before it can load or play anything.
 */
export type Screen =
  "splash" | "loading" | "title" | "settings" | "credits" | "briefing" | "mission";

export interface UiStore {
  screen: Screen;
  /** Where Settings should return to. */
  returnTo: Screen;
  go: (screen: Screen) => void;
  openSettings: () => void;
  openCredits: () => void;
  /** Back to wherever settings or credits were opened from. */
  closeOverlay: () => void;
}

/** Where to return to: never another overlay, or Back would bounce. */
function anchor(store: UiStore): Screen {
  const { screen, returnTo } = store;
  return screen === "settings" || screen === "credits" ? returnTo : screen;
}

export const useUiStore = create<UiStore>(function createUi(set, get) {
  return {
    screen: "splash",
    returnTo: "title",

    go(screen) {
      set({ screen });
    },

    openSettings() {
      set({ screen: "settings", returnTo: anchor(get()) });
    },

    openCredits() {
      set({ screen: "credits", returnTo: anchor(get()) });
    },

    closeOverlay() {
      set({ screen: get().returnTo });
    },
  };
});
