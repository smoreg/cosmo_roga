import { AdaptiveMusic, secondsPerBeat, secondsToNextBeat, type Grid } from "@jamrog/audio";
import { canSee, isAlive, type RoomGame } from "@jamrog/engine";
import { isTug } from "../content/tug.js";
import { hunterAboard } from "../systems/alert.js";
import { rigOf } from "../twist/rig.js";
import mainUrl from "../../../../assets/audio/music/main.ogg?url";

/**
 * One track, and what the run does to it.
 *
 * The game shipped five short loops until the owner wrote a piece for it
 * (`Dead Compartment`, ../../music/README.md). One track that goes all the way
 * through beats five thirteen-second loops cross-fading at each other for the
 * same reason a room beats five photographs of it: nothing about it restarts
 * when the game changes its mind, and there is no seam to hear because there is
 * only one.
 *
 * So the state no longer picks a file — it sets the level. `musicStateFor` is
 * unchanged and still the whole rule, still a pure function a test can ask
 * "does a hunter outrank a wound" without a browser; what moved is the answer's
 * consequence, from `LAYERS[state].url` to `VOLUME[state]`. The tug is the
 * quiet place and the hunter is not, and that was always what the per-loop trim
 * was saying.
 */

export type MusicState = "tug" | "explore" | "combat" | "hurt" | "hunter";

/**
 * The track's own grid, and the reason it is written down here at all.
 *
 * Nothing cross-fades any more, so this is no longer about transitions: it is
 * the clock the screen reads to flash in time (`ui/pulse.ts`). `main.ogg` is
 * 51.272 s, cut from the source at a downbeat and 16 bars long — 64 beats of
 * 0.8011 s — so the loop point is a bar line and the beat grid holds across it.
 * `tests/audio-assets.test.ts` measures the file against these numbers.
 *
 * The bpm is fractional because the piece is: rounding it to 75 would put the
 * flash a fifth of a beat out by the end of a loop.
 */
export const GRID: Grid = { bpm: 74.9, beatsPerBar: 4, barsPerPhrase: 16 };

/** One beat of the track, in milliseconds. What the screen flashes to. */
export const BEAT_MS = secondsPerBeat(GRID) * 1000;

/** The core is this low, or the rack this thin, and the music says so. */
const HURT_CORE = 1;
const HURT_MODULES = 2;

/** Under the effects: the music is the room, the effects are what happens in it. */
const MASTER_VOLUME = 0.55;

/** The single voice. Named, because `AdaptiveMusic` addresses layers by name. */
const TRACK = "main";

/**
 * What each state does to the level, on the 0..1 perceptual scale
 * `AdaptiveMusic` takes. These are the five numbers the five loops carried as
 * their own trim, kept exactly: the mix they describe was tuned by ear and none
 * of it was about which file was playing.
 */
const VOLUME: Record<MusicState, number> = {
  tug: 0.7,
  explore: 0.85,
  combat: 1,
  hurt: 0.9,
  hunter: 1,
};

/**
 * How long the level takes to get where the state wants it.
 *
 * Not instant, because a step in loudness on a turn boundary is heard as a
 * fault in the file rather than as the game reacting; not slow, because a
 * machine walking in wants an answer while the player is still looking at it.
 * Two beats is both.
 */
const RAMP_SECONDS = (2 * BEAT_MS) / 1000;

/**
 * What the run sounds like right now.
 *
 * Priority, highest first, and each step of it is a decision rather than an
 * accident:
 *
 * - `tug` beats everything, because the tug is safe by definition — there is
 *   nothing aboard it to fight and nothing hunting you there.
 * - `hunter` beats combat: an ENFORCER aboard is the worst the run gets, and
 *   the track has to be at its loudest for it rather than merely at a fight's.
 * - `combat` beats `hurt`, which is the one that could go either way. A fight
 *   is an event and a wound is a condition; letting the event win means the
 *   music answers what the player just did, and drops back to `hurt` when the
 *   compartment goes quiet — which is when a wound is worth thinking about.
 */
export function musicStateFor(game: RoomGame): MusicState {
  if (isTug(game)) return "tug";
  if (hunterAboard(game)) return "hunter";
  if (machineInSight(game)) return "combat";
  if (wounded(game)) return "hurt";
  return "explore";
}

/** How loud the track plays in a state, before the master trim. */
export function volumeFor(state: MusicState): number {
  return VOLUME[state];
}

/** A machine in this compartment, or one visible through an open door. */
function machineInSight(game: RoomGame): boolean {
  const here = game.roomOf(game.player).id;
  return game.entities.some(
    (e) =>
      e.id !== game.player.id &&
      e.faction !== game.player.faction &&
      isAlive(e) &&
      (e.room === here || canSee(game.ship, game.player, e)),
  );
}

/** One hit from gone, or down to a rack that cannot finish a ship. */
function wounded(game: RoomGame): boolean {
  if (game.player.hp <= HURT_CORE) return true;
  const rig = rigOf(game.player);
  return rig !== undefined && rig.slots.filter((slot) => slot !== null).length <= HURT_MODULES;
}

/**
 * Sound off, from the URL: `?sound=off`.
 *
 * A jam voter who does not want the music has one alternative, and it is
 * closing the tab. There is no key for it because the keyboard belongs to the
 * game — every letter is already a module or a direction — so it lives where a
 * seed already lives.
 */
export function soundEnabled(search: string): boolean {
  const value = new URLSearchParams(search).get("sound");
  return value !== "off" && value !== "0" && value !== "false";
}

/**
 * The track, the level the run is playing it at, and the beat the screen
 * flashes to.
 *
 * Every method is safe to call with no file, no `Audio` and no permission to
 * play: `AdaptiveMusic` swallows all three, and a run must never break because
 * a loop did not load.
 */
export class SalvorMusic {
  private readonly music: AdaptiveMusic;
  private started = false;
  private state: MusicState | undefined;

  constructor(enabled: boolean) {
    this.music = new AdaptiveMusic({
      grid: GRID,
      layers: [{ state: TRACK, url: mainUrl, volume: 1 }],
      volume: MASTER_VOLUME,
      enabled,
    });
  }

  /**
   * Start playing, from inside a user gesture.
   *
   * Browsers block audio that no one asked for, silently, so the first key of
   * the session is the only chance the music gets — which is why the title card
   * exists rather than dropping the player straight into the airlock. Calling
   * this again is free: once started, it is `update` that does the work.
   */
  begin(game: RoomGame): void {
    if (this.started) return;
    this.started = true;
    this.state = musicStateFor(game);
    this.music.setVolume(MASTER_VOLUME * volumeFor(this.state));
    void this.music.to(TRACK, "immediate");
  }

  /** After a turn. A state that has not changed costs nothing. */
  update(game: RoomGame): void {
    if (!this.started) return;
    const state = musicStateFor(game);
    if (state === this.state) return;
    this.state = state;
    this.music.setVolume(MASTER_VOLUME * volumeFor(state), RAMP_SECONDS);
  }

  /**
   * Sound on or off, from the start screen's own row (`S`, G84).
   *
   * Re-enabling has to ask for the track again: `begin` fires once per session
   * and did nothing the first time if the sound was off, so without this the
   * key would turn the volume up on silence.
   */
  setEnabled(on: boolean): void {
    this.music.setEnabled(on);
    if (on && this.started) void this.music.to(TRACK, "immediate");
  }

  /**
   * Milliseconds from now to the track's next beat, or undefined when there is
   * no track playing to ask.
   *
   * Undefined is what `?sound=off` and a blocked autoplay both look like from
   * here, and the caller is expected to carry on without a clock rather than
   * invent one (`ui/pulse.ts`).
   */
  untilBeat(): number | undefined {
    const position = this.music.position;
    return position === undefined ? undefined : secondsToNextBeat(GRID, position) * 1000;
  }
}
