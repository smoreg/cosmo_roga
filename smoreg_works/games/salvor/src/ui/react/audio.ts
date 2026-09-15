/**
 * Music.
 *
 * A browser will not let a page make noise before someone has touched it,
 * which is why the game opens on a splash you have to click. Everything here
 * assumes that gesture has happened (`screens/Splash.tsx`).
 *
 * Ported whole from the other half of this project, where it was written
 * against these same six files. Two things changed. The paths are relative,
 * because `public/audio` is served beside the bundle and that works from a
 * `file://` URL inside an itch zip as well as from a server. And there is no
 * sound-effect layer: the owner asked for music and nothing else for now, so
 * the game's own `ui/sfx.ts` stays unwired.
 *
 * Both licences are answered for in `public/audio/ATTRIBUTION.md` and on the
 * credits sheet — Eric Matyas asks for a credit wherever the game appears, and
 * the menu track is used by the artist's own permission.
 */

export interface MusicTrack {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly credit: string;
}

/** Used by the artist's own permission; the credit is the condition. */
export const MENU_MUSIC: MusicTrack = {
  id: "menu",
  url: `audio/music/menu-soft-millenium.mp3`,
  title: "Soft Millenium",
  credit: "3D63 — Analog Hack",
};

/** Eric Matyas, soundimage.org. The credit is required wherever the game is. */
export const MISSION_MUSIC: readonly MusicTrack[] = [
  {
    id: "blob",
    url: `audio/music/The-Creeping-Blob_Looping.ogg`,
    title: "The Creeping Blob",
    credit: "Eric Matyas · soundimage.org",
  },
  {
    id: "factory",
    url: `audio/music/Factory-On-Mercury_Looping.ogg`,
    title: "Factory On Mercury",
    credit: "Eric Matyas · soundimage.org",
  },
  {
    id: "eerie",
    url: `audio/music/Eerie-Cyber-World_v001_Looping.ogg`,
    title: "Eerie Cyber World",
    credit: "Eric Matyas · soundimage.org",
  },
  {
    id: "dizzybot",
    url: `audio/music/Dizzybot_Looping.ogg`,
    title: "Dizzybot",
    credit: "Eric Matyas · soundimage.org",
  },
  {
    id: "trouble",
    url: `audio/music/Trouble-on-Mercury_Looping.ogg`,
    title: "Trouble on Mercury",
    credit: "Eric Matyas · soundimage.org",
  },
];

export interface MusicPlayer {
  readonly play: (track: MusicTrack) => void;
  readonly stop: () => void;
  readonly setVolume: (volume: number) => void;
  readonly nowPlaying: () => MusicTrack | null;
  /**
   * What the element is actually set to, not what it was asked for.
   *
   * Two different things, and only one of them can be heard: a volume set
   * before the element exists lives in a variable until something plays. This
   * answers for the element, so a test can hold the chain from the stored
   * setting to the sound rather than trusting the middle of it.
   */
  readonly volumeNow: () => number;
}

/** How long one track takes to get out of the way of the next. */
export const FADE_MS = 500;

/** Slider position to amplitude. Squared, so the middle sounds like a middle. */
function gain(position: number): number {
  return position * position;
}

function createPlayer(): MusicPlayer {
  let element: HTMLAudioElement | null = null;
  let current: MusicTrack | null = null;
  let volume = 0.5;
  let fading: number | undefined;

  function ensure(): HTMLAudioElement | null {
    if (typeof Audio === "undefined") return null;
    element ??= new Audio();
    element.loop = true;
    element.preload = "auto";
    return element;
  }

  /**
   * Turns one track down to nothing over `FADE_MS`, then runs `then`.
   *
   * A cut between two pieces of music is heard as a fault — the ear reads a
   * hard edge as something breaking rather than as something changing. Half a
   * second is enough for the first to have gone and short enough that the
   * second is not late.
   */
  function fade(then: () => void): void {
    if (element === null || element.paused) {
      then();
      return;
    }
    const from = element.volume;
    const started = Date.now();
    clearInterval(fading);
    fading = setInterval(() => {
      const on = Math.min(1, (Date.now() - started) / FADE_MS);
      if (element !== null) element.volume = from * (1 - on);
      if (on < 1) return;
      clearInterval(fading);
      fading = undefined;
      then();
    }, 16) as unknown as number;
  }

  function play(track: MusicTrack): void {
    const audio = ensure();
    if (audio === null) return;
    if (current?.id === track.id && !audio.paused) return;
    /* Something else is playing: wind it down first, then come back here. */
    if (!audio.paused && current !== null) {
      const next = track;
      fade(() => {
        current = null;
        play(next);
      });
      return;
    }
    clearInterval(fading);
    fading = undefined;
    current = track;
    if (!audio.src.endsWith(track.url)) audio.src = track.url;
    audio.volume = gain(volume);
    /* `play()` returns a promise in every current browser, but not in older
       Safari and not in jsdom, so the result is checked before it is used.
       A refusal is normal and not worth an error: the splash exists to get the
       gesture, and the next attempt will be allowed. */
    const started: unknown = audio.play();
    if (started instanceof Promise) {
      void started.catch(function refused() {
        return undefined;
      });
    }
  }

  function stop(): void {
    current = null;
    if (element === null) return;
    element.pause();
  }

  /**
   * Where the slider is, which is not what the element is set to.
   *
   * `HTMLAudioElement.volume` is linear amplitude: a half is six decibels
   * down, which the ear hears as about seven tenths as loud rather than a
   * half. A slider at the middle that sounds nearly as loud as the top is a
   * slider nobody trusts, so the position is squared on the way through —
   * a half of the slider is a quarter of the amplitude, which is what a half
   * sounds like.
   *
   * The curve lives here and not in the settings, because what is stored is
   * where the player put the slider. That is the thing they chose and the
   * thing the interface has to show them again.
   */
  function setVolume(next: number): void {
    volume = Math.min(1, Math.max(0, next));
    if (element !== null) element.volume = gain(volume);
  }

  function nowPlaying(): MusicTrack | null {
    return current;
  }

  function volumeNow(): number {
    return element === null ? gain(volume) : element.volume;
  }

  return { play, stop, setVolume, nowPlaying, volumeNow };
}

/** One player for the page: two tracks at once is never what anyone wants. */
export const music = createPlayer();

/** Pick a mission track, from the mission's own seed so a replay sounds alike. */
export function missionTrackFor(seed: string): MusicTrack {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const index = (hash >>> 0) % MISSION_MUSIC.length;
  const picked = MISSION_MUSIC[index] ?? MISSION_MUSIC[0];
  if (picked === undefined) throw new Error("no mission music defined");
  return picked;
}
