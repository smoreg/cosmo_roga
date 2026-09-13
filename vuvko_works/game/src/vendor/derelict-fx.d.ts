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
