/**
 * A strike lands, and the token it landed on says so.
 *
 * The first board effect, and deliberately the smallest one that is real. It
 * uses the FX library's sequencer — `frames`, the primitive every other effect
 * is built from — rather than `impact` or `edgeBurst`, which want an attacker
 * element, an edge element and a damage readout laid out as absolutely
 * positioned HTML. The deck is SVG and has none of those. Reaching for an
 * effect whose shape does not fit and bending the DOM to suit it is how a kit
 * ends up owning a renderer; taking its rhythm and its constant is how it ends
 * up serving one.
 *
 * Four frames of 225ms, the library's own `FRAME`, so this beats in time with
 * the text reveals rather than beside them.
 *
 * Nothing here can affect the game. It reads the events of the last dispatch
 * and writes one presentational attribute on an element React does not own the
 * attribute of; dropped at any moment the token is left as the store draws it.
 */

import { useEffect } from "react";
import { FRAME, frames, prefersReducedMotion } from "../vendor/derelict-fx.js";
import type { GameEvent } from "../core/events";

/** How a token looks while it is being hit, worst first. */
const HURT = ["1", "0.35", "1", "0.55"];

export function useHitFlash(batch: readonly GameEvent[]): void {
  useEffect(
    function flash() {
      if (batch.length === 0 || prefersReducedMotion()) return;

      /* Who took something this beat, and how many times. A unit struck twice
         in one exchange flashes once: the beat is the exchange, not the die. */
      const struck = new Set<number>();
      for (const event of batch) {
        if (event.kind === "strikeLanded" && !event.targetIsObject) struck.add(event.targetId);
      }
      if (struck.size === 0) return;

      const running = struck.size === 0 ? null : playFlash([...struck]);
      return function drop() {
        running?.cancel();
        /* However far it got, leave every token as the renderer drew it. */
        for (const id of struck) tokenFor(id)?.style.removeProperty("opacity");
      };
    },
    [batch],
  );
}

function tokenFor(id: number): SVGGElement | null {
  return document.querySelector<SVGGElement>(`[data-unit="${String(id)}"]`);
}

function playFlash(ids: readonly number[]): { cancel: () => void } {
  const steps = HURT.map(function step(opacity) {
    return function paint(): void {
      for (const id of ids) tokenFor(id)?.style.setProperty("opacity", opacity);
    };
  });
  return frames([...steps], {
    frame: FRAME * 0.6,
    onDone() {
      for (const id of ids) tokenFor(id)?.style.removeProperty("opacity");
    },
  });
}
