import type { Entity } from "@jamrog/engine";
import { rigOf } from "../twist/rig.js";
import { THEME } from "./theme.js";

/**
 * The rack panel, as arithmetic.
 *
 * The systems hand the sidebar their lines already worded and mostly coloured
 * (`panelLines` in src/twist/rig.ts and src/systems/alert.ts); what is left is
 * the one thing the renderer knows and they do not — which line took a blow on
 * the frame being drawn. That is a difference between two turns rather than a
 * property of either, so it lives here as a value, and `render.ts` keeps one of
 * these and draws it.
 */

/** A line as a system hands it over: worded, and coloured where it cared. */
export interface PanelLine {
  text: string;
  /** Set only where the system's own colour beats the panel's default. */
  fg?: string;
}

/** What the panel remembers between frames. */
export interface Flash {
  /** Integrity per slot as of the last turn drawn. */
  readonly integrity: readonly number[];
  /** Slots that lost integrity on `turn`. */
  readonly slots: ReadonlySet<number>;
  /** The turn the flash belongs to; it clears when the clock moves past it. */
  readonly turn: number;
}

/** Before the first frame: nothing is known, so nothing flashes. */
export const NO_FLASH: Flash = { integrity: [], slots: new Set(), turn: -1 };

/**
 * Slots whose integrity fell between two frames. A slot the panel has never
 * seen before cannot have dropped — that is a rack being filled in, not a hit —
 * so the first frame of a run flashes nothing.
 */
export function flashSlots(prev: readonly number[], next: readonly number[]): Set<number> {
  const hurt = new Set<number>();
  for (let i = 0; i < next.length; i++) {
    const before = prev[i];
    if (before !== undefined && next[i]! < before) hurt.add(i);
  }
  return hurt;
}

/**
 * The panel one frame on. A blow starts a flash and pins it to its turn; the
 * flash then survives every redraw of that turn — a help card opened and closed
 * on the turn a module was hit must not swallow the only signal that it was —
 * and goes out when the clock moves.
 */
export function trackFlash(prev: Flash, integrity: readonly number[], turn: number): Flash {
  const hurt = flashSlots(prev.integrity, integrity);
  if (hurt.size > 0) return { integrity, slots: hurt, turn };
  if (turn !== prev.turn) return { integrity, slots: new Set(), turn: prev.turn };
  return { integrity, slots: prev.slots, turn: prev.turn };
}

/** Integrity per slot, in slot order. An empty slot counts as zero, not absent. */
export function rackIntegrity(player: Entity): number[] {
  const rig = rigOf(player);
  return rig ? rig.slots.map((s) => s?.integrity ?? 0) : [];
}

/**
 * The system decided the colour; the panel only fills in what it left blank,
 * and overrides a module that took a blow this turn.
 */
export function panelColour(line: PanelLine, flash: ReadonlySet<number>): string {
  const slot = slotNumberOf(line.text);
  if (slot !== undefined && flash.has(slot)) return THEME.bad;
  if (line.fg !== undefined) return line.fg;
  if (line.text.includes("◀")) return THEME.accent;
  if (line.text.includes("burned")) return THEME.burned;
  return THEME.fg;
}

/** Slot index behind a panel line like `3 SCANNER ▮▮`, or undefined for other lines. */
export function slotNumberOf(text: string): number | undefined {
  const n = Number(text.slice(0, 1));
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : undefined;
}
