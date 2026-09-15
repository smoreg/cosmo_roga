import type { AppEffect, AppState, Overlay } from "./appstate.js";

/**
 * The interface's own voice: a blip for every press the game itself does not
 * answer (docs/tasks/G89-festival.md, D2).
 *
 * The thirteen effects are events aboard a ship and hang off the log
 * (`ui/sfx.ts`). None of them can say "the highlight moved", "that line is
 * off" or "the card is open" — and until this file those presses made no sound
 * at all, so a refused key and a key the page never received sounded the same.
 *
 * Synthesised rather than recorded: a blip is one oscillator and one envelope,
 * shorter than a beat of the track, and the build gains no files for it. Both
 * halves that decide anything are pure and under test — which blip a press
 * earns (`blipFor`) and what each blip is (`BLIPS`) — and the player at the
 * bottom only puts a row of the table through WebAudio.
 *
 * Three rules keep it from becoming noise. One blip a press at most. None on
 * top of a game sound: a turn that already cracked, clanged or hissed has been
 * answered. And none from the walk's own steps — the shell asks for a blip only
 * where a press or a click arrives (`ui/app.ts`, `apply`), never from the timer.
 */

export type BlipId = "tick" | "step" | "accept" | "back" | "refuse" | "open" | "close" | "toggle";

/** One blip: a waveform gliding between two pitches under a pluck of an envelope. */
export interface Blip {
  readonly wave: "sine" | "triangle" | "square";
  /** Pitch at the start and at the end of the blip, in Hz. Equal for a flat tone. */
  readonly from: number;
  readonly to: number;
  /** Whole length, attack included, in milliseconds. */
  readonly ms: number;
  /** Rise to the peak. The rest of `ms` is an exponential fall to silence. */
  readonly attackMs: number;
  /** Peak gain, linear 0..1 — kept under `UI_MAX_GAIN`, which is under the effects. */
  readonly gain: number;
}

/**
 * The loudest a blip may be. Effects play at `SFX_VOLUME` (`ui/sfx.ts`) from files mastered
 * near full scale; a synthesised tone at a tenth of full scale sits some twenty
 * decibels under them, which is where an interface belongs — heard when the
 * room is quiet, gone under anything that happens in it.
 */
export const UI_MAX_GAIN = 0.1;

/**
 * What each blip is.
 *
 * The shape carries the meaning, so a player learns it without being told:
 * up is yes (`accept`, `open`), down is back (`back`, `close`), a low buzz is
 * no (`refuse`), and the highlight moving is the smallest, highest, shortest
 * sound here (`tick`). `step` is the turn that made no sound of its own — a
 * step through an open door, a brace — low and soft, because it can come
 * every turn.
 */
export const BLIPS: Readonly<Record<BlipId, Blip>> = {
  tick: { wave: "sine", from: 1760, to: 1760, ms: 24, attackMs: 2, gain: 0.03 },
  step: { wave: "triangle", from: 392, to: 330, ms: 45, attackMs: 3, gain: 0.045 },
  accept: { wave: "triangle", from: 660, to: 990, ms: 70, attackMs: 4, gain: 0.07 },
  back: { wave: "triangle", from: 880, to: 587, ms: 70, attackMs: 4, gain: 0.06 },
  refuse: { wave: "square", from: 196, to: 147, ms: 120, attackMs: 3, gain: 0.04 },
  open: { wave: "sine", from: 523, to: 784, ms: 100, attackMs: 6, gain: 0.08 },
  close: { wave: "sine", from: 784, to: 523, ms: 100, attackMs: 6, gain: 0.07 },
  toggle: { wave: "triangle", from: 988, to: 1318, ms: 60, attackMs: 3, gain: 0.06 },
};

/** What running the press's effect did to the run. */
export type Turn = "spent" | "refused" | "none";

/** One press, as the shell saw it through: before, after, and what the run did. */
export interface Press {
  readonly before: AppState;
  readonly after: AppState;
  /** What the reducer asked for. `after.effect` may already be reset by the shell. */
  readonly effect: AppEffect;
  readonly turn: Turn;
  /** A game effect played for this press (`ui/sfx.ts`). */
  readonly sounded: boolean;
}

const CARDS: ReadonlySet<Overlay> = new Set<Overlay>(["help", "codex", "history", "virus"]);
const ENDINGS: ReadonlySet<Overlay> = new Set<Overlay>(["dead", "won", "lost", "sold"]);

/** How far down the list is: the compartment, a list opened off it, a door's own ways. */
function depth(state: AppState): number {
  return (state.moves || state.doors ? 1 : 0) + (state.menu !== undefined ? 1 : 0);
}

/**
 * The blip a press earns, or none.
 *
 * In order, and the order is the rule: a refusal outranks everything, because
 * "no" is the one answer a player must never miss; a spent turn is answered by
 * the game when it has anything to say and by `step` when it has not; the
 * settings, the walk being stopped and a new run have a blip each; then what
 * changed on the screen — a card, the title, a level of the list, the page, the
 * highlight. A press that changed nothing makes no sound.
 */
export function blipFor(press: Press): BlipId | undefined {
  const { before, after, effect, turn, sounded } = press;
  if (effect.kind === "log" || turn === "refused") return "refuse";
  if (turn === "spent") return sounded ? undefined : "step";
  if (sounded) return undefined;

  switch (effect.kind) {
    case "sound":
      return "toggle";
    case "stopAuto":
      return "back";
    case "newRun":
    case "training":
      return "accept";
    default:
      break;
  }

  if (before.overlay !== after.overlay) {
    // An ending is announced by its stinger, never by the interface.
    if (ENDINGS.has(after.overlay)) return undefined;
    // A card replacing another is a card opening: `PageUp` over the help card.
    if (CARDS.has(after.overlay)) return "open";
    if (CARDS.has(before.overlay) || ENDINGS.has(before.overlay)) return "close";
    // The title going down: the voyage has been chosen.
    if (before.overlay === "title") return "accept";
    return undefined;
  }
  if (
    before.helpPage !== after.helpPage ||
    before.logPage !== after.logPage ||
    before.codexAt !== after.codexAt
  ) {
    return "tick";
  }

  if (before.seedText !== after.seedText) {
    if (before.seedText === undefined) return "accept";
    if (after.seedText === undefined) return "back";
    return "tick";
  }

  const deeper = depth(after) - depth(before);
  if (deeper > 0) return "accept";
  if (deeper < 0) return "back";
  // The same depth but another level: `m` after `d`, or a door after a door.
  if (before.moves !== after.moves || before.doors !== after.doors || before.menu !== after.menu) {
    return "accept";
  }
  if (before.cursor !== after.cursor) return "tick";
  return undefined;
}

// ----------------------------------------------------------------- the player

/** The part of an `AudioContext` a blip needs. Narrow, so a test can hand in a fake. */
export interface BlipContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  readonly state: AudioContextState;
  resume(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

/** An exponential ramp cannot reach zero. This is silence for every ear. */
const SILENCE = 0.0001;

/** The same blip again inside this is a held key repeating, and is not played. */
export const REPEAT_GAP_MS = 45;

/**
 * The browser's own `AudioContext`, or undefined where there is none — an old
 * WebKit names it with a prefix, and a test or a locked-down embedding has
 * neither.
 */
function browserContext(): BlipContext | undefined {
  const scope = globalThis as {
    AudioContext?: new () => BlipContext;
    webkitAudioContext?: new () => BlipContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor === undefined ? undefined : new Ctor();
}

/**
 * Blips, through WebAudio.
 *
 * The context is made on the first blip rather than in the constructor: a
 * browser only lets one start inside a user gesture, and every blip is asked
 * for from inside one (`ui/app.ts`). Before that nothing exists, so nothing can
 * sound over the title before the first key. Every failure — no WebAudio, a
 * context the browser refuses, a node that throws — is silence, and is tried
 * once rather than on every press.
 *
 * `S` and `?sound=off` switch it with the music and the effects: the shell
 * passes the same flag to all three.
 */
export class UiSound {
  private context: BlipContext | undefined;
  private unavailable = false;
  private enabled: boolean;
  private readonly last = new Map<BlipId, number>();

  constructor(
    enabled: boolean,
    private readonly makeContext: () => BlipContext | undefined = browserContext,
  ) {
    this.enabled = enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  play(id: BlipId | undefined): void {
    if (id === undefined || !this.enabled) return;
    const ctx = this.ready();
    if (ctx === undefined) return;
    try {
      const now = ctx.currentTime;
      const previous = this.last.get(id);
      if (previous !== undefined && (now - previous) * 1000 < REPEAT_GAP_MS) return;
      this.last.set(id, now);
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);

      const blip = BLIPS[id];
      const end = now + blip.ms / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = blip.wave;
      osc.frequency.setValueAtTime(blip.from, now);
      if (blip.to !== blip.from) osc.frequency.exponentialRampToValueAtTime(blip.to, end);
      gain.gain.setValueAtTime(SILENCE, now);
      gain.gain.linearRampToValueAtTime(blip.gain, now + blip.attackMs / 1000);
      gain.gain.exponentialRampToValueAtTime(SILENCE, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(end);
    } catch {
      // A node the browser would not build. The press still happened.
    }
  }

  private ready(): BlipContext | undefined {
    if (this.context !== undefined || this.unavailable) return this.context;
    try {
      this.context = this.makeContext();
    } catch {
      this.context = undefined;
    }
    this.unavailable = this.context === undefined;
    return this.context;
  }
}
