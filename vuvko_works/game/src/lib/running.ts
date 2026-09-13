import type { Running } from "../vendor/derelict-fx";

/**
 * The cleanup nearly every effect in here needs.
 *
 * An FX handle is cancelled and nothing else: the effects commit no state, so
 * dropping one mid-flight only means the board stops pretending and shows what
 * the store already says. Written once because it is the same three words
 * everywhere, and a cleanup that differs by accident is a leak.
 */
export function cancelOn(running: Running): () => void {
  return function drop() {
    running.cancel();
  };
}
