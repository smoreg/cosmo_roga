/**
 * A stand-in for rot-js.
 *
 * The graphic view imports a handful of plain strings from `ui/render.ts`, and
 * that file opens with `import * as ROT` for the ASCII display it also owns.
 * Nothing on the path we render touches the display, so the dependency is
 * satisfied rather than installed — this half has no business installing into
 * the other one.
 */
export class Display {}
export const RNG = { setSeed() {}, getUniform: () => 0.5 };
export default { Display, RNG };
