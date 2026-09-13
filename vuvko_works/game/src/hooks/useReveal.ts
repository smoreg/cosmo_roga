/**
 * Reveal text the way the machine would: in frames, not in fades.
 *
 * This is the whole of the FX library's contract with the game, and it is
 * deliberately small. `derelict-fx` wants a DOM element with text in it; React
 * wants to own that element's children. So the hook takes a ref, writes the
 * text through the library when the text changes, and gets out of the way —
 * React is never asked to reconcile a half-scrambled string, because the
 * library writes `innerHTML` on an element React has been told is empty.
 *
 * Nothing here can affect the game. The store commits immediately, as it always
 * has; this decides only how a committed fact arrives on screen, and if it is
 * dropped at any instant — reduced motion, unmount, a second event landing
 * mid-reveal — the element is left showing exactly what the store says.
 *
 * See `design/ui-kit/motion.md` §3.2 for why the presentation layer is
 * droppable by construction rather than by discipline.
 */

import { useEffect, useRef } from "react";
import { PRESETS, prefersReducedMotion, setAndReveal } from "../vendor/derelict-fx.js";

export type RevealPreset = keyof typeof PRESETS;

/**
 * Write `text` into the element, revealing it a frame at a time.
 *
 * The first write is silent: a panel that scrambles itself into existence on
 * mount is an animation about the page loading, not about anything that
 * happened, and the essay's rule is no idle motion on data.
 */
export function useReveal(text: string, preset: RevealPreset = "panel") {
  const ref = useRef<HTMLElement | null>(null);
  const shown = useRef<string | null>(null);

  useEffect(
    function reveal() {
      const element = ref.current;
      if (element === null) return;
      if (shown.current === text) return;

      const first = shown.current === null;
      shown.current = text;

      if (first || prefersReducedMotion()) {
        element.textContent = text;
        return;
      }
      /* Write the text before revealing it, so the element is never empty.

         `setAndReveal` holds the element blank through the preset's stagger —
         360ms for the log — and a line of text vanishing and coming back is a
         worse report than one that simply changes. Putting the text in first
         means the reveal scrambles *over* something, and an interrupted one
         leaves a readable line rather than a gap. */
      element.textContent = text;
      const running = setAndReveal([element], [text], PRESETS[preset]);
      return function drop() {
        running.cancel();
        /* Whatever frame it was on, the truth is the text. */
        element.textContent = text;
      };
    },
    [text, preset],
  );

  return ref;
}
