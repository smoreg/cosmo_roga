/**
 * What has to be in hand before the game is worth starting.
 *
 * Each step does real work — none of it is a progress bar pretending. The
 * splash before it exists because a browser will not let a page make noise
 * until someone has touched it, so the gesture buys the music as well as the
 * loading screen.
 */

import { MENU_MUSIC, MISSION_MUSIC } from "./audio";

export type StepState = "waiting" | "working" | "done" | "failed";

export interface LoadStep {
  readonly id: string;
  readonly label: string;
  /** What it means if this one fails: the game still runs without it. */
  readonly optional: boolean;
  readonly run: () => Promise<void>;
}

function fetchQuietly(url: string): Promise<void> {
  return fetch(url, { cache: "force-cache" }).then(function check(response) {
    if (!response.ok) throw new Error(`${String(response.status)} for ${url}`);
    /* Draining it is what actually puts it in the cache. */
    return response.blob().then(function done() {
      return undefined;
    });
  });
}

async function loadFonts(): Promise<void> {
  /* The DOM types insist `document.fonts` is always there. It is not: jsdom
     omits it, and so do some older browsers, so this probes rather than
     trusting the declaration. */
  const probe = document as unknown as { fonts?: { ready?: Promise<unknown> } };
  const ready = probe.fonts?.ready;
  if (ready === undefined) return;
  await ready;
}

async function loadMusic(): Promise<void> {
  /* The menu track is the one needed first; one mission track is enough to
     have something ready when a mission starts. */
  const first = MISSION_MUSIC[0];
  await fetchQuietly(MENU_MUSIC.url);
  if (first !== undefined) await fetchQuietly(first.url);
}

async function loadTiles(deckTilePaths: readonly string[]): Promise<void> {
  const base = import.meta.env.BASE_URL;
  await Promise.all(
    deckTilePaths.map(function one(path) {
      return fetchQuietly(`${base}geomorphs/${path.replace(/\.png$/, ".webp")}`);
    }),
  );
}

export function loadingSteps(deckTilePaths: readonly string[]): LoadStep[] {
  return [
    {
      id: "code",
      label: "Rules and renderer",
      optional: false,
      run: function alreadyHere() {
        /* If this is running, the bundle is here. It is listed because a
           loading screen that hides the cheap step lies about the shape. */
        return Promise.resolve();
      },
    },
    { id: "graphics", label: "Typefaces", optional: true, run: loadFonts },
    {
      id: "tiles",
      label: "Deck plans",
      optional: true,
      run: function tiles() {
        return loadTiles(deckTilePaths);
      },
    },
    { id: "music", label: "Music", optional: true, run: loadMusic },
  ];
}
