import * as FX from "../fx/derelict-fx.js";
import { motionNow } from "./settings.js";

/**
 * Reveals, at the speed the player asked for.
 *
 * `FX.reveal` and `FX.linesOf` are the library's own, and they are the library's
 * because the contract they fix is the library's: `scrambleReveal` empties a
 * line synchronously and its `cancel` leaves it empty, which under React — where
 * effects are cancelled routinely — means a screen that never comes back. That
 * belongs where every screen built on it can have it (the design system's
 * `INTEGRATION.md`).
 *
 * What is left here is the one thing the library has no business knowing: what
 * this player set the motion to. `instant` skips outright rather than running
 * very fast, because a scramble compressed into nothing is a flicker and a
 * flicker is worse than the still text it was meant to arrive as. `faster` is
 * the same design at twice the speed — the frames still step, they do not
 * linger. The CSS half of the same setting is three custom properties on the
 * root (`settings.ts`, `setMotion`).
 */
export function reveal(nodes: readonly Element[], preset: unknown): () => void {
  const motion = motionNow();
  if (motion === "instant") return FX.reveal(nodes, { ...(preset as object), skip: true });
  if (motion === "normal") return FX.reveal(nodes, preset);
  const p = preset as Record<string, unknown>;
  return FX.reveal(nodes, {
    ...p,
    ...(typeof p.tickMs === "number" ? { tickMs: p.tickMs / 2 } : {}),
    ...(typeof p.stagger === "number" ? { stagger: p.stagger / 2 } : {}),
    ...(typeof p.staggerTotal === "number" ? { staggerTotal: p.staggerTotal / 2 } : {}),
  });
}

/** Every line of a subtree, marked or not. The library's, unchanged. */
export const linesOf = FX.linesOf;
