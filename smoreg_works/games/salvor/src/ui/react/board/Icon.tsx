import type { CSSProperties, ReactElement } from "react";
import type { BoardThing } from "./HexBoard.js";
import { MACHINE_BOX, MACHINE_ICON } from "./machines.js";

/**
 * What a thing looks like, once, for everywhere it is drawn.
 *
 * The board drew silhouettes and the compartment's list drew the engine's own
 * letter, so a scout was a red triangle in one place and the letter `c` in the
 * other, and a player had to learn the same catalogue twice. They are two views
 * of one set of things; they get one drawing.
 *
 * ## Shape says what a thing is, not which one it is
 *
 * There are thirteen machines and a shape apiece would be unreadable at
 * fifteen pixels, so the shapes are families — a runner, a support machine, a
 * fighter, something bolted down — and the name in the readout says which. A
 * player learns four silhouettes and reads the rest, which is the trade the
 * whole board is built on.
 */
const RUNNER = "polygon(50% 0,100% 100%,0 100%)";
const SUPPORT = "polygon(50% 0,100% 50%,50% 100%,0 50%)";
const FIGHTER = "polygon(50% 0,100% 35%,82% 100%,18% 100%,0 35%)";
const FIXED = "polygon(50% 8%,93% 30%,93% 74%,50% 96%,7% 74%,7% 30%)";

/** Everything that is not trying to kill you, and what each of them is. */
const CRATE = undefined; // a square, and the only thing drawn as its own box
const SCRAP = "polygon(0 22%,34% 0,72% 14%,100% 46%,78% 100%,28% 92%,8% 62%)";
const SYSTEM = "polygon(0 0,100% 0,100% 72%,62% 72%,62% 100%,38% 100%,38% 72%,0 72%)";
const ONLINE = "polygon(12% 48%,40% 76%,88% 12%,100% 28%,42% 100%,0 62%)";
const BODY = "polygon(38% 0,62% 0,62% 34%,100% 34%,100% 58%,62% 58%,62% 100%,38% 100%,38% 58%,0 58%,0 34%,38% 34%)";
const ROUND = "circle(50%)";

/**
 * The letter the engine uses, turned into a family.
 *
 * Keyed on the glyph because that is what every source of things already
 * carries — a machine's `ch`, a wreck's mark, a bucket's stamp — so nothing
 * had to grow a second field to be drawn.
 */
const HOSTILE: Readonly<Record<string, string>> = {
  c: RUNNER, // scout
  d: SUPPORT, // feral drone
  z: RUNNER, // crawler
  j: SUPPORT, // jammer
  w: SUPPORT, // welder bot
  m: SUPPORT, // maintenance bot
  x: SUPPORT, // scrapper
  t: FIXED, // sentry turret
  Y: FIXED, // bloom
  S: FIGHTER, // security unit
  H: FIGHTER, // hauler
  A: FIGHTER, // arc sentinel
  E: FIGHTER, // enforcer
};

const LOOT: Readonly<Record<string, string | undefined>> = {
  X: CRATE,
  "%": SCRAP,
  "+": SYSTEM,
  "✓": ONLINE,
  "†": BODY,
};

export function shapeOf(thing: { glyph: string; hostile?: true }): string | undefined {
  if (thing.hostile === true) return HOSTILE[thing.glyph] ?? FIGHTER;
  if (thing.glyph in LOOT) return LOOT[thing.glyph];
  return ROUND;
}

/** What a thing is drawn in: a threat is red, everything else is the drone's. */
export function toneOf(thing: { glyph: string; hostile?: true }): string {
  if (thing.hostile === true) return "var(--sv-bad)";
  if (thing.glyph === "✓") return "var(--sv-good)";
  return "var(--sv-amber)";
}

/**
 * One thing, at whatever size the place drawing it has room for.
 *
 * A face where there is one, a silhouette everywhere else. The eight machines
 * of the band are drawn (`machines.ts`) because eight shapes that all mean "a
 * thing that is coming for you" are eight shapes to tell apart, and a face is
 * one to recognise. Everything else — the five machines the ship places
 * itself, and everything that is not a machine at all — keeps its silhouette,
 * which says what kind of thing it is rather than which one.
 *
 * Both are drawn in the same tone and at the same size, so a row of them lines
 * up whichever a thing turns out to be.
 */
export function ThingIcon({
  thing,
  size = 15,
  style,
}: {
  thing: BoardThing;
  size?: number;
  style?: CSSProperties;
}): ReactElement {
  const drawn = thing.hostile === true ? MACHINE_ICON[thing.glyph] : undefined;
  if (drawn !== undefined) {
    return (
      <svg
        viewBox={`0 0 ${String(MACHINE_BOX)} ${String(MACHINE_BOX)}`}
        width={size}
        height={size}
        aria-hidden
        style={{ flex: "none", color: toneOf(thing), display: "block", ...style }}
      >
        <path d={drawn} fill="currentColor" />
      </svg>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        background: toneOf(thing),
        clipPath: shapeOf(thing),
        ...style,
      }}
    />
  );
}
