/**
 * What a player has set, and where it is kept.
 *
 * Three things, and none of them is progress: the jam forbids carrying
 * anything between runs and a volume is not a run (`.claude/CLAUDE.md`). They
 * follow the pattern the sound flag already had — a key each, read
 * defensively, written where it is allowed. A storage that refuses is not
 * worth a crash: private mode, a full quota and site data switched off are all
 * ordinary, and the setting simply will not be there next time.
 */

/** The slice of `localStorage` these use, so a test can hand in its own. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function store(given?: Store): Store | undefined {
  if (given !== undefined) return given;
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string, given?: Store): string | null {
  const s = store(given);
  if (s === undefined) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string, given?: Store): void {
  const s = store(given);
  if (s === undefined) return;
  try {
    s.setItem(key, value);
  } catch {
    // See the note at the top: a refusal costs the setting and nothing else.
  }
}

// ----------------------------------------------------------------- the volume

export const VOLUME_KEY = "salvor.volume";

/** Halfway. Loud enough to be music, quiet enough to be left alone. */
export const DEFAULT_VOLUME = 0.5;

export function storedVolume(given?: Store): number {
  const raw = read(VOLUME_KEY, given);
  if (raw === null) return DEFAULT_VOLUME;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME;
}

export function rememberVolume(volume: number, given?: Store): void {
  write(VOLUME_KEY, String(Math.min(1, Math.max(0, volume))), given);
}

// ----------------------------------------------------------------- the motion

/**
 * How fast the interface moves.
 *
 * `normal` is the system as designed: one frame of 225ms, held. `faster` is
 * the same design at twice the speed, which is what somebody on their fourth
 * voyage wants — the frames still step, they simply do not linger. `instant`
 * is no animation at all, for anyone who finds motion unpleasant or who is
 * reading a board rather than watching one.
 *
 * Three settings and not a slider, because these are three different answers
 * and not three points on one scale: the last of them turns the system off.
 */
export type Motion = "instant" | "faster" | "normal";

export const MOTION_KEY = "salvor.motion";
export const DEFAULT_MOTION: Motion = "normal";

/** The frame every held step in the system is a multiple of, at `normal`. */
export const BASE_FRAME = 225;

/** What one held frame lasts at each setting. Zero is the off switch. */
export const FRAME_MS: Readonly<Record<Motion, number>> = {
  instant: 0,
  faster: BASE_FRAME / 2,
  normal: BASE_FRAME,
};

export function isMotion(value: unknown): value is Motion {
  return value === "instant" || value === "faster" || value === "normal";
}

export function storedMotion(given?: Store): Motion {
  const raw = read(MOTION_KEY, given);
  return isMotion(raw) ? raw : DEFAULT_MOTION;
}

export function rememberMotion(motion: Motion, given?: Store): void {
  write(MOTION_KEY, motion, given);
}

// --------------------------------------------------------------- in the page

let motion: Motion = DEFAULT_MOTION;

/** What the whole interface is currently moving at. */
export function motionNow(): Motion {
  return motion;
}

/**
 * Set it, everywhere at once.
 *
 * The CSS half is three custom properties on the root, because every keyframe
 * in this system is written against `--sv-frame` and its two multiples — so
 * one write here is every border, every reveal ring and every slide. The
 * scramble half is read by `reveal()` off `motionNow()`, since the library
 * takes its timings as numbers rather than from the document.
 *
 * At `instant` the frames go to zero and the reveals are skipped outright
 * rather than run very fast: a scramble compressed into nothing is a flicker,
 * and a flicker is worse than the still text it was meant to arrive as.
 */
export function setMotion(next: Motion): void {
  motion = next;
  if (typeof document === "undefined") return;
  const ms = FRAME_MS[next];
  const root = document.documentElement.style;
  root.setProperty("--sv-frame", `${String(ms)}ms`);
  root.setProperty("--sv-frame-2", `${String(ms * 2)}ms`);
  root.setProperty("--sv-frame-3", `${String(ms * 3)}ms`);
}
