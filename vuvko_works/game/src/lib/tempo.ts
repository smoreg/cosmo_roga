/**
 * How fast a frame is, and how many of them a beat gets.
 *
 * The kit's frame is 225ms, which is deliberately slow: the library's whole
 * rule is that nothing interpolates, and at a coarse frame the steps read as
 * steps rather than as a stutter. Running it three times faster on its own
 * would just make everything finish three times sooner. So the frame gets
 * shorter and the count goes up by the same factor: the same span of time,
 * resolved three times as finely.
 *
 * That trade is exact for anything the library counts frames for — every text
 * reveal takes `ticks` and `tickMs` as parameters, so tripling one and
 * thirding the other is arithmetic. It is exact for movement too, because a
 * hex can simply be held for three frames instead of one; the token still
 * steps tile to tile and nothing lands between them.
 *
 * It is not exact for the two combat effects. Those are fixed sequences of
 * authored states — seven for a hit, five for a shot — and there is no fourth
 * state to put between the third and the fourth that the kit did not draw.
 * Inventing one would be interpolation by another name. So the blow itself
 * runs at the quick frame and lands in a third of the time, and the target's
 * face is then descrambled back over what is left, which is a thing the
 * library does count frames for. Same total window, and the punch arrives
 * sooner inside it.
 */

import { FRAME } from "../vendor/derelict-fx";
import type { Preset } from "../vendor/derelict-fx";

/** How many frames now stand where the kit had one. */
export const TEMPO = 3;

/** The quick frame, in milliseconds. 75 against the kit's 225. */
export const BEAT = FRAME / TEMPO;

/** The same reveal, resolved `TEMPO` times as finely over the same span. */
export function quicken(preset: Preset): Preset {
  return {
    /* Stagger is the gap between elements, not a frame count — it says when a
       line starts, and starting the second line sooner is a different change
       from resolving each line more finely. Left alone. */
    stagger: preset.stagger,
    ticks: preset.ticks * TEMPO,
    tickMs: preset.tickMs / TEMPO,
  };
}

/**
 * What a struck token does while the rest of its beat plays out.
 *
 * Sized to fill the time the quickened blow gives back: a hit is seven frames,
 * so it now ends 7 × (FRAME − BEAT) early, and this covers exactly that.
 */
export const RECOVER: Preset = {
  stagger: 0,
  ticks: Math.round((7 * (FRAME - BEAT)) / BEAT),
  tickMs: BEAT,
};
