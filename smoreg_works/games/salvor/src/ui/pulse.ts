import type { Entity, RoomGame, RoomId } from "@jamrog/engine";
import { hostilesIn } from "../twist/rig.js";
import { BEAT_MS } from "./music.js";

/**
 * A machine the drone could not see last frame can see it now — and the screen
 * says so, on the beat.
 *
 * The owner asked for one effect and only one: «визуальные эффекты ток для
 * появления врагов». So nothing else in the game flashes — not a blow, not a
 * step, not a door — and the whole of what "appearance" means is one line
 * below: the set of machines in sight changed, and something is in it that was
 * not in it before. That covers the four ways it can happen without the file
 * having to enumerate them — the drone walks in on one, one walks in on the
 * drone, a door opens on one, the alert sends one — because all four are the
 * same fact about two consecutive frames.
 *
 * Time, and nothing about the game, is what makes this a *pulse*. It is
 * scheduled against the track's playhead rather than against the moment the
 * turn resolved (`ui/music.ts`, `untilBeat`), so the flash lands on a beat and
 * lasts a whole number of them; a flash a fifth of a beat early reads as the
 * screen glitching rather than as the music and the picture agreeing. With no
 * clock to read — `?sound=off`, or autoplay refused — it runs on the grid's own
 * beat from now, which is the same length and simply not in phase with
 * anything.
 *
 * Deliberately DOM-free and clock-free: `now` arrives as a number and the beat
 * arrives as a number, so every rule here is testable in the node environment
 * the rest of the suite runs in, and neither renderer owns a copy of it. What
 * the two views do differ on is paint — a terminal cell's colour, an SVG class
 * — and that is all they differ on.
 */

/** Beats a pulse lasts. Two: long enough to read, short enough not to nag. */
export const PULSE_BEATS = 2;

/** Blinks per beat. One, on the beat, off the off-beat. */
const BLINKS_PER_BEAT = 2;

/** A machine in sight, reduced to the two things the screen paints it by. */
export interface Sighted {
  readonly id: number;
  readonly room: RoomId;
}

/** What the screen reads the beat off, and what the browser has asked of it. */
export interface PulseClock {
  /** One beat of the track, in milliseconds. */
  readonly beatMs: number;
  /** Milliseconds to the next beat, or undefined when nothing is playing. */
  readonly untilBeat: number | undefined;
  /** `prefers-reduced-motion`: colour, held, with nothing blinking. */
  readonly steady: boolean;
}

/** What the screen remembers between frames. */
export interface Pulse {
  /**
   * Machines in sight as of the last frame. Undefined before the first one:
   * a run whose opening frame has a machine on it has not had one *appear*,
   * and seeding the set is what stops the title card flashing at nobody.
   */
  readonly seen: ReadonlySet<number> | undefined;
  /** Machines the pulse is for, and the compartments they turned up in. */
  readonly ids: ReadonlySet<number>;
  readonly rooms: ReadonlySet<RoomId>;
  /** Milliseconds, on the caller's clock: when the flash starts and ends. */
  readonly from: number;
  readonly to: number;
  /** One beat, so the blink can divide on it without asking the music again. */
  readonly beatMs: number;
  /** False under `prefers-reduced-motion`: the colour holds instead. */
  readonly blink: boolean;
}

/** Before the first frame: nothing seen, so nothing can have appeared. */
export const NO_PULSE: Pulse = {
  seen: undefined,
  ids: new Set(),
  rooms: new Set(),
  from: 0,
  to: 0,
  beatMs: BEAT_MS,
  blink: true,
};

/** What a frame paints red. Empty between pulses, which is nearly always. */
export interface Lit {
  readonly ids: ReadonlySet<number>;
  readonly rooms: ReadonlySet<RoomId>;
}

export const NOTHING_LIT: Lit = { ids: new Set(), rooms: new Set() };

/**
 * Every hostile machine the drone can see, by id and compartment.
 *
 * The same rule the contacts block lists by (`ui/panel.ts`, `contactsOf`):
 * `game.visible` is the whole of what may be counted, so the pulse can never
 * light a compartment the schematic is drawing as unknown or a line the panel
 * is not printing.
 */
export function machinesInSight(game: RoomGame): Sighted[] {
  const here = game.roomOf(game.player).id;
  const rooms = [here, ...[...game.visible].filter((id) => id !== here)];
  return rooms.flatMap((room) => hostilesIn(game, room).map(sighted));
}

function sighted(machine: Entity): Sighted {
  return { id: machine.id, room: machine.room ?? -1 };
}

/**
 * The screen one frame on.
 *
 * A machine that has just come into sight starts a pulse; one already in sight
 * does not, however long it stands there, and neither does one going out of
 * sight. A pulse already running is left alone rather than restarted — two
 * machines stepping through the same door on the same turn are one event as far
 * as the eye is concerned — and only its set of subjects grows.
 */
export function trackPulse(
  prev: Pulse,
  machines: readonly Sighted[],
  now: number,
  clock: PulseClock,
): Pulse {
  const before = prev.seen;
  const seen = new Set(machines.map((m) => m.id));
  if (before === undefined) return { ...prev, seen };

  const fresh = machines.filter((m) => !before.has(m.id));
  if (fresh.length === 0) return { ...prev, seen };

  const running = now < prev.to;
  const from = running ? prev.from : now + (clock.steady ? 0 : (clock.untilBeat ?? 0));
  const beats = clock.steady ? 1 : PULSE_BEATS;
  return {
    seen,
    ids: new Set([...(running ? prev.ids : []), ...fresh.map((m) => m.id)]),
    rooms: new Set([...(running ? prev.rooms : []), ...fresh.map((m) => m.room)]),
    from,
    to: running ? prev.to : from + beats * clock.beatMs,
    beatMs: clock.beatMs,
    blink: !clock.steady,
  };
}

/**
 * What is red on the frame being drawn.
 *
 * Outside the window, nothing — which is the answer on all but a handful of
 * frames in a run. Inside it, everything the pulse is for, on the first half of
 * each beat and not on the second: that is the blink, and it is a blink rather
 * than a two-beat block of colour so that the thing reads as timed to something
 * rather than merely as being red for a while.
 */
export function litNow(pulse: Pulse, now: number): Lit {
  if (now < pulse.from || now >= pulse.to) return NOTHING_LIT;
  if (!pulse.blink) return { ids: pulse.ids, rooms: pulse.rooms };
  const half = pulse.beatMs / BLINKS_PER_BEAT;
  const on = half > 0 && Math.floor((now - pulse.from) / half) % 2 === 0;
  return on ? { ids: pulse.ids, rooms: pulse.rooms } : NOTHING_LIT;
}

/**
 * When the screen next has to redraw itself for the pulse's sake, or undefined
 * when it does not.
 *
 * Undefined is the whole of what `prefers-reduced-motion` costs: no timer is
 * ever scheduled for a steady pulse, so the colour goes on with the frame the
 * appearance was noticed on and comes off with the next frame the game draws
 * for its own reasons. Nothing on the screen moves without a key press.
 */
export function nextPulseFrame(pulse: Pulse, now: number): number | undefined {
  if (!pulse.blink || now >= pulse.to) return undefined;
  if (now < pulse.from) return pulse.from;
  const half = pulse.beatMs / BLINKS_PER_BEAT;
  if (half <= 0) return pulse.to;
  const next = pulse.from + (Math.floor((now - pulse.from) / half) + 1) * half;
  return Math.min(next, pulse.to);
}
