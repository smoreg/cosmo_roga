/**
 * Types for the vendored `derelict-fx.js`.
 *
 * Hand-written and deliberately narrower than the library: only the surface the
 * game actually calls is declared, so an effect nobody drives cannot be reached
 * by accident and every addition is a decision. The library is untouched — see
 * `FX-SOURCE.md`.
 */

/** Every effect returns this and signals completion only through `onDone`. */
export interface Running {
  cancel: () => void;
}

/** `stagger` between elements, `ticks` frames each, `tickMs` per frame. */
export interface Preset {
  readonly stagger: number;
  readonly ticks: number;
  readonly tickMs: number;
}

export const FRAME: number;

export const PRESETS: {
  readonly hover: Preset;
  readonly panel: Preset;
  readonly panelEdge: Preset;
  readonly value: Preset;
  readonly log: Preset;
  readonly name: Preset;
  readonly menu: Preset;
  readonly boot: Preset;
};

export function prefersReducedMotion(): boolean;

/** Reveal the text already in the elements. */
export function scrambleReveal(els: ArrayLike<Element>, preset?: Preset): Running;

/** Put new text in the elements and reveal it. */
export function setAndReveal(
  els: ArrayLike<Element>,
  texts: readonly string[],
  preset?: Preset,
): Running;

/** Run `steps` callbacks, one per frame. */
export function frames(
  steps: readonly (() => void)[],
  options?: { frame?: number; delay?: number; onDone?: () => void; skip?: boolean },
): Running;

/** Remove any ghosts a cancelled token effect left behind. */
export function clearGhosts(root?: ParentNode): void;

/** Where a token sits after a step. Interpreted only by `place`. */
export type WakePos = Readonly<Record<string, number | string | undefined>>;

export interface WakeOptions {
  /** Writes a position onto the element. Override it to leave the DOM's own
   *  coordinate system — ours is SVG user units, not CSS pixels. */
  place?: (el: Element, pos: WakePos) => void;
  frame?: number;
  ghostMs?: number;
  /** The face the token wears once it stops scrambling. */
  label?: string;
  ghostOpacity?: number;
  scrambleFace?: boolean;
  onDone?: () => void;
  skip?: boolean;
}

export function wake(
  el: Element | null,
  path: readonly WakePos[],
  options?: WakeOptions,
): { cancel: () => void };

export interface ImpactOptions {
  attacker?: Element | null;
  target?: Element | null;
  edge?: Element | null;
  damageEl?: Element | null;
  damage?: string;
  frame?: number;
  hurtOpacity?: number;
  /** The face the target is put back into. Read off the element when absent,
   *  which is wrong once the element is mid-scramble — so pass it. */
  targetLabel?: string;
  onDone?: () => void;
  skip?: boolean;
}

export function impact(options?: ImpactOptions): { cancel: () => void };

export interface EdgeBurstOptions {
  target?: Element | null;
  edge?: Element | null;
  damageEl?: Element | null;
  damage?: string;
  frame?: number;
  hurtOpacity?: number;
  onDone?: () => void;
  skip?: boolean;
}

export function edgeBurst(options?: EdgeBurstOptions): { cancel: () => void };
