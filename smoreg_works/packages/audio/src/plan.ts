/**
 * Transition planning, kept free of the Web Audio API so it can be tested.
 *
 * The rules come from the composing-music skill's adaptive-music section:
 * never change tempo between states, always switch on a musical boundary, and
 * cross-fade with equal power rather than linearly — a linear fade dips in
 * loudness in the middle and reads as a gap.
 */

export interface Grid {
  /** Beats per minute. Shared by every state: tempo must not change. */
  bpm: number;
  /** Beats per bar. */
  beatsPerBar: number;
  /** Switch only on this boundary. 1 = every bar, 4 = every four bars. */
  barsPerPhrase: number;
}

export interface Transition {
  /** Seconds to wait before the switch starts. */
  delay: number;
  /** Seconds the cross-fade lasts. */
  duration: number;
}

export function secondsPerBeat(grid: Grid): number {
  return 60 / grid.bpm;
}

export function secondsPerBar(grid: Grid): number {
  return secondsPerBeat(grid) * grid.beatsPerBar;
}

export function secondsPerPhrase(grid: Grid): number {
  return secondsPerBar(grid) * grid.barsPerPhrase;
}

/**
 * When to switch, given how long the current loop has been playing.
 *
 * `urgency` picks the boundary: "phrase" waits for the next phrase (musical,
 * used for exploration ↔ safety), "bar" waits for the next bar (used for
 * combat, where a four-bar wait feels unresponsive), "immediate" switches now
 * and accepts the seam (death, win).
 */
export function planTransition(
  grid: Grid,
  elapsed: number,
  urgency: "phrase" | "bar" | "immediate" = "phrase",
): Transition {
  if (urgency === "immediate") return { delay: 0, duration: 0.08 };

  const unit = urgency === "bar" ? secondsPerBar(grid) : secondsPerPhrase(grid);
  const into = elapsed % unit;
  // Landing exactly on the boundary is fine; a hair before it is not, because
  // the fade would start in the old phrase and finish in the new one.
  const delay = into < 1e-9 ? 0 : unit - into;
  return { delay, duration: Math.min(secondsPerBar(grid), 1.5) };
}

/**
 * Seconds from here to the next beat, given where the playhead is.
 *
 * The one thing a caller outside the music needs from the grid: anything the
 * screen does "in time" — a flash, a shake, a counter ticking over — has to be
 * scheduled against the track rather than against the moment the game decided
 * to do it, and the track's own clock is its playhead. Landing exactly on a
 * beat waits zero rather than a whole one.
 */
export function secondsToNextBeat(grid: Grid, position: number): number {
  const beat = secondsPerBeat(grid);
  if (!Number.isFinite(position) || beat <= 0) return 0;
  const into = ((position % beat) + beat) % beat;
  return into < 1e-9 ? 0 : beat - into;
}

/**
 * Equal-power cross-fade gains at progress t ∈ [0, 1].
 * Sum of squares stays 1, so perceived loudness holds steady through the fade.
 */
export function crossfadeGains(t: number): { out: number; in: number } {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    out: Math.cos((clamped * Math.PI) / 2),
    in: Math.sin((clamped * Math.PI) / 2),
  };
}

/**
 * Strudel's `gain` is exponential: 0.26 is "barely audible", not "quieter".
 * Convert a plain 0..1 slider into something that behaves like a volume knob.
 */
export function perceptualGain(slider: number): number {
  const clamped = Math.min(1, Math.max(0, slider));
  return clamped ** 2.5;
}
