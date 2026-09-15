/**
 * Types for the vendored `derelict-fx.js`.
 *
 * Hand-written, and deliberately complete rather than narrow: this is the only
 * animation the game has, so a function nobody has declared is a function
 * nobody can reach. The library itself is untouched — see `SOURCE.md`.
 */

/** Every effect returns this. `cancel()` stops it and leaves the DOM as it is. */
export interface Running {
  cancel: () => void;
}

/** `stagger` between elements, `ticks` frames each, `tickMs` per frame. */
export interface Preset {
  readonly stagger?: number;
  /**
   * A budget for the whole list rather than a gap per row, so a reveal takes
   * the same wall-clock time whether it has three rows or thirty.
   */
  readonly staggerTotal?: number;
  /** Lines per stagger slot: `block: 5` makes a thirty-line sheet cost six. */
  readonly block?: number;
  readonly ticks?: number;
  readonly tickMs?: number;
}

export const FRAME: number;
export const BLOCK_CHARS: string;
export const TOKEN_CHARS: string;
export const SCRAMBLE_CHARS: string;

export const PRESETS: {
  readonly hover: Preset;
  readonly panel: Preset;
  readonly panelEdge: Preset;
  readonly value: Preset;
  readonly log: Preset;
  readonly name: Preset;
  readonly menu: Preset;
  readonly boot: Preset;
  readonly list: Preset;
  readonly sheet: Preset;
  readonly all: Preset;
};

export function randomScramble(length: number, chars?: string): string;
export function scrambleLike(text: string): string;
export function prefersReducedMotion(): boolean;

export interface FramesOptions {
  frame?: number;
  delay?: number;
  onDone?: () => void;
  skip?: boolean;
}
export function frames(steps: Array<() => void>, options?: FramesOptions): Running;

export interface RevealOptions extends Preset {
  chars?: string | null;
  dim?: number;
  blockChance?: number;
  onDone?: () => void;
  skip?: boolean;
}
export function scrambleReveal(
  els: ArrayLike<Element> | Iterable<Element> | null | undefined,
  options?: RevealOptions,
): Running;
export function setAndReveal(
  els: ArrayLike<Element> | Iterable<Element> | null | undefined,
  texts: readonly string[],
  preset?: Preset,
): Running;

export interface ArriveOptions {
  frame?: number;
  color?: string;
  mid?: string | null;
  onDone?: () => void;
  skip?: boolean;
}
export function arrive(
  els: ArrayLike<Element> | Iterable<Element> | null | undefined,
  options?: ArriveOptions,
): Running;

/** Where a token sits after a step. Only `place` reads it. */
export type Pos = Readonly<Record<string, number | string | undefined>>;

export interface MoveOptions {
  /** Writes a position onto the element. The default sets `style.left/top`. */
  place?: (el: Element, pos: Pos) => void;
  frame?: number;
  /**
   * The child carrying the readable face, for a token that is a drawing rather
   * than a text node. Mark it `data-fx-face` so ghosts find it too. The host
   * moves; only the face scrambles.
   */
  faceEl?: Element | null;
  label?: string | null;
  chars?: string;
  onDone?: () => void;
  skip?: boolean;
}

export interface WakeOptions extends MoveOptions {
  ghostMs?: number;
  scrambleFace?: boolean;
  ghostOpacity?: number;
  stripAttrs?: readonly string[];
}
export function wake(el: Element | null, path: readonly Pos[], options?: WakeOptions): Running;
export function blink(
  el: Element | null,
  to: Pos,
  options?: MoveOptions & { flickers?: number },
): Running;
export function teleport(el: Element | null, to: Pos, options?: MoveOptions): Running;
export function steppedTransit(
  el: Element | null,
  path: readonly Pos[],
  options?: MoveOptions,
): Running;

export interface ImpactOptions {
  attacker?: Element | null;
  target?: Element | null;
  edge?: Element | null;
  damageEl?: Element | null;
  damage?: string;
  frame?: number;
  chars?: string;
  strikeGlyph?: string;
  flashColor?: string;
  hurtOpacity?: number;
  /** The face to put the target back into; read off the element when absent. */
  targetLabel?: string;
  onDone?: () => void;
  skip?: boolean;
}
export function impact(options?: ImpactOptions): Running;
export function edgeBurst(options?: Omit<ImpactOptions, "attacker" | "strikeGlyph">): Running;
export function exchange(
  options?: ImpactOptions & { counterDamage?: string; counterColor?: string },
): Running;

export function hitStop(ms?: number, options?: { onResume?: () => void }): Running;
export function clearGhosts(root?: ParentNode): void;
