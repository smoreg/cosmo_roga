import type { RoomGame } from "@jamrog/engine";
import { moduleKind } from "../../content/modules.js";
import { rigOf } from "../../twist/rig.js";

/**
 * Seven noises, and what makes each of them.
 *
 * Deliberately few. A sound on every line is a sound on no line — the ear
 * stops separating them and the whole layer becomes texture. So: the drone
 * moving, the drone swinging or firing (four, one per weapon, because which
 * weapon is in the rack is a thing the player chose and should be able to
 * hear), something shooting back, and a click for anything the hand presses.
 *
 * The three that come out of the *game* are read off the log, which is already
 * the one place that lists everything a turn did — an event bus the sim
 * published to would be a second copy of that list, free to drift from the
 * first, and it would mean touching `sim/` to add a sound. What is read is
 * `LogLine.key`, never the wording: the key is what a line *is*, and a
 * rewritten sentence must not silence an effect.
 *
 * The click is not a game event at all and is called directly. It is the one
 * sound that has to answer within a frame of the press, because its whole job
 * is to say "the machine got that" before the machine has done anything.
 */
export type SfxId = "click" | "step" | "melee" | "blade" | "laser" | "emitter" | "incoming";

/** Where a baked effect is served from. Relative, like every other asset. */
function url(id: SfxId): string {
  return `audio/sfx/${id}.ogg`;
}

/**
 * How loud an effect is against the music.
 *
 * Under it, on purpose. The music is a bed and is meant to be ignorable; an
 * effect is an answer to something the player just did and only has to be
 * noticed. At parity the laser walks over the track every time it fires.
 */
const CUT = 0.55;

/**
 * Same curve the music uses: the slider squared, so the middle of the slider
 * sounds like the middle rather than like most of the way up.
 */
function gain(position: number): number {
  return position * position * CUT;
}

/**
 * The clips, decoded once and cloned per play.
 *
 * An `Audio` element can only be playing once, and two machines hitting in one
 * turn is the ordinary case — so each play gets a clone of a warm element.
 * Cloning copies the decoded buffer, so this costs nothing after the first.
 */
const warm = new Map<SfxId, HTMLAudioElement>();
let volume = 0.5;
let on = true;

function element(id: SfxId): HTMLAudioElement | null {
  if (typeof Audio !== "function") return null;
  const have = warm.get(id);
  if (have !== undefined) return have;
  try {
    const made = new Audio(url(id));
    made.preload = "auto";
    warm.set(id, made);
    return made;
  } catch {
    return null;
  }
}

export const sfx = {
  /** Fetch every clip, so the first press is not the first download. */
  warm(): void {
    for (const id of ["click", "step", "melee", "blade", "laser", "emitter", "incoming"] as SfxId[]) {
      try {
        element(id)?.load();
      } catch {
        /* a clip that will not fetch is a quieter game, not a broken one */
      }
    }
  },

  setVolume(position: number): void {
    volume = position;
  },

  /** Muting silences without forgetting where the slider was. */
  setMuted(muted: boolean): void {
    on = !muted;
  },

  play(id: SfxId): void {
    if (!on || volume <= 0) return;
    const base = element(id);
    if (base === null) return;
    /*
     * Nothing here may ever reach the caller.
     *
     * `play()` rejects before the first gesture — that is the ordinary case,
     * not a bug — and under a headless DOM it *throws* instead, synchronously,
     * which is worse: the throw comes out of the click handler the sound was
     * decorating and takes the command with it. Two tests caught exactly that,
     * a scan and a menu row that stopped working the moment they got a click
     * sound. A decoration must not be able to break the thing it decorates.
     */
    try {
      const clip = base.cloneNode(true) as HTMLAudioElement;
      clip.volume = Math.max(0, Math.min(1, gain(volume)));
      const started = clip.play() as Promise<void> | undefined;
      if (started !== undefined) void started.catch(() => undefined);
    } catch {
      /* silent, and the press still lands */
    }
  },

  /** The one that answers the hand rather than the game. */
  click(): void {
    this.play("click");
  },
};

/**
 * Which noise the drone makes when it swings.
 *
 * The rig picks the best melee weapon in the rack by expected roll and so does
 * this, by asking the same question of the same table — the alternative is a
 * second opinion about which module is the weapon, and the day the two
 * disagree the player hears a cutter while a Q-BLADE lands.
 */
export function swingOf(game: RoomGame): SfxId {
  const rig = rigOf(game.player);
  if (rig === undefined) return "melee";
  let best: SfxId = "melee";
  let bestRoll = -1;
  for (const slot of rig.slots) {
    if (slot === null) continue;
    const kind = moduleKind(slot.kind);
    if (kind.attack === undefined || (kind.range ?? 0) > 0) continue;
    const roll = kind.attack[0] * (kind.attack[1] + 1) * 0.5 + kind.attack[2];
    if (roll <= bestRoll) continue;
    bestRoll = roll;
    best = slot.kind === "blade" ? "blade" : slot.kind === "laser" ? "laser" : "melee";
  }
  return best;
}

/**
 * What a line sounds like, by the event it reports.
 *
 * `undefined` for almost everything, which is the point. The drone's own swing
 * is resolved against the rack rather than named here, because one key covers
 * every weapon.
 */
export function soundFor(key: string | undefined, game: RoomGame): SfxId | undefined {
  switch (key) {
    case "engine.hit.you":
      return swingOf(game);
    case "log.emitter.hit":
      return "emitter";
    case "engine.hit.taken":
    case "log.hit.module":
    case "log.hit.module.burn":
    case "log.hit.mine":
    case "log.shot.stray":
      return "incoming";
    default:
      return undefined;
  }
}
