import { crossfadeGains, perceptualGain, planTransition, type Grid } from "./plan.js";

/**
 * Adaptive music: one track per game state, all at the same tempo, switched on
 * a musical boundary with an equal-power cross-fade.
 *
 * Deliberately built on plain `Audio` elements rather than the Web Audio API:
 * a jam needs "music that changes when a monster appears", not a mixing desk,
 * and every browser autoplay quirk is already solved for `<audio>`.
 *
 * Every method is safe to call when the files are missing, when the browser
 * blocks autoplay, or when there is no DOM at all — the game must never break
 * because a sound did not load.
 */

export interface Layer {
  /** State name, e.g. "explore", "combat", "boss", "hurt". */
  state: string;
  /** URL of a seamless loop, ideally .ogg. */
  url: string;
  /** Per-layer trim, 0..1 on a perceptual scale. Default 1. */
  volume?: number;
}

export interface AdaptiveMusicOptions {
  grid: Grid;
  layers: Layer[];
  /** Master volume, 0..1 perceptual. */
  volume?: number;
  /** Set false to leave the player silent (a settings toggle). */
  enabled?: boolean;
}

interface Voice {
  layer: Layer;
  el: HTMLAudioElement;
}

/** How often a cross-fade or a volume ramp writes a new gain. */
const RAMP_STEP_MS = 40;

export class AdaptiveMusic {
  private readonly grid: Grid;
  private readonly voices = new Map<string, Voice>();
  private current: string | undefined;
  private master: number;
  private enabled: boolean;
  private startedAt = 0;
  private fade: number | undefined;
  private ramp: number | undefined;
  private available: boolean;

  constructor(opts: AdaptiveMusicOptions) {
    this.grid = opts.grid;
    this.master = opts.volume ?? 0.8;
    this.enabled = opts.enabled ?? true;
    this.available = typeof Audio !== "undefined";

    if (!this.available) return;
    for (const layer of opts.layers) {
      try {
        const el = new Audio(layer.url);
        el.loop = true;
        el.preload = "auto";
        el.volume = 0;
        this.voices.set(layer.state, { layer, el });
      } catch {
        // A layer that cannot be constructed is simply absent.
      }
    }
  }

  get state(): string | undefined {
    return this.current;
  }

  /**
   * Where the playing loop's head is, in seconds, or undefined when there is
   * nothing to read it off.
   *
   * The track is the only honest clock the screen has: a flash meant to land on
   * a beat has to be scheduled against the audio's own playhead, because that
   * is the thing the ear is following. Undefined is a real answer and not a
   * failure — no files, autoplay refused, sound switched off — and a caller
   * that gets it should fall back to the grid rather than pretend.
   */
  get position(): number | undefined {
    const voice = this.current ? this.voices.get(this.current) : undefined;
    if (!voice) return undefined;
    try {
      return voice.el.paused ? undefined : voice.el.currentTime;
    } catch {
      return undefined;
    }
  }

  /**
   * Start, or switch to, a state. Must be called from a user gesture the first
   * time — browsers block autoplay otherwise, and the failure is silent.
   */
  async to(state: string, urgency: "phrase" | "bar" | "immediate" = "phrase"): Promise<void> {
    if (!this.available || !this.enabled) return;
    if (state === this.current) return;

    const next = this.voices.get(state);
    if (!next) return; // unknown state: keep playing whatever is playing

    const previous = this.current ? this.voices.get(this.current) : undefined;
    this.current = state;

    const elapsed = previous ? (Date.now() - this.startedAt) / 1000 : 0;
    const plan = planTransition(this.grid, elapsed, previous ? urgency : "immediate");

    const begin = async () => {
      try {
        next.el.currentTime = 0;
        await next.el.play();
      } catch {
        return; // autoplay blocked; try again on the next user gesture
      }
      if (!previous) this.startedAt = Date.now();
      this.runFade(previous, next, plan.duration);
    };

    if (plan.delay <= 0) await begin();
    else window.setTimeout(begin, plan.delay * 1000);
  }

  /** A one-shot accent over the music: a level-up, a boss reveal. */
  stinger(url: string, volume = 0.9): void {
    if (!this.available || !this.enabled) return;
    try {
      const el = new Audio(url);
      el.volume = perceptualGain(volume * this.master);
      void el.play().catch(() => undefined);
    } catch {
      // ignore
    }
  }

  /**
   * The master trim, optionally slid into place over `seconds` rather than set.
   *
   * A game that mixes with the master — one loop whose loudness is the state,
   * rather than five loops picked by it — changes this on a turn boundary, and
   * a step change there is heard as a fault in the file. The ramp is the same
   * forty-millisecond ticker the cross-fade uses and is equally disposable: a
   * second call replaces the first from wherever it had got to.
   */
  setVolume(volume: number, seconds = 0): void {
    const target = Math.min(1, Math.max(0, volume));
    if (this.ramp !== undefined) window.clearInterval(this.ramp);
    this.ramp = undefined;
    if (!this.available || seconds <= 0) {
      this.master = target;
      this.applyMaster();
      return;
    }

    const from = this.master;
    const startedAt = Date.now();
    this.ramp = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / (seconds * 1000));
      this.master = from + (target - from) * t;
      this.applyMaster();
      if (t >= 1 && this.ramp !== undefined) {
        window.clearInterval(this.ramp);
        this.ramp = undefined;
      }
    }, RAMP_STEP_MS);
  }

  private applyMaster(): void {
    const voice = this.current ? this.voices.get(this.current) : undefined;
    if (!voice) return;
    try {
      voice.el.volume = this.gainFor(voice, 1);
    } catch {
      // A detached element, or a browser that refuses the write. Nothing to do.
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  stop(): void {
    if (this.fade !== undefined) window.clearInterval(this.fade);
    if (this.ramp !== undefined) window.clearInterval(this.ramp);
    this.fade = undefined;
    this.ramp = undefined;
    for (const voice of this.voices.values()) {
      try {
        voice.el.pause();
        voice.el.volume = 0;
      } catch {
        // ignore
      }
    }
    this.current = undefined;
  }

  private runFade(from: Voice | undefined, to: Voice, duration: number): void {
    if (this.fade !== undefined) window.clearInterval(this.fade);
    if (duration <= 0) {
      to.el.volume = this.gainFor(to, 1);
      if (from) from.el.pause();
      return;
    }

    const startedAt = Date.now();
    this.fade = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / (duration * 1000));
      const gains = crossfadeGains(t);
      to.el.volume = this.gainFor(to, gains.in);
      if (from) from.el.volume = this.gainFor(from, gains.out);
      if (t >= 1) {
        if (this.fade !== undefined) window.clearInterval(this.fade);
        this.fade = undefined;
        if (from) from.el.pause();
      }
    }, RAMP_STEP_MS);
  }

  private gainFor(voice: Voice, factor: number): number {
    return perceptualGain((voice.layer.volume ?? 1) * this.master) * factor;
  }
}
