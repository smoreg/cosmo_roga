import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";

/**
 * The second between pressing New game and being aboard.
 *
 * A hull is generated in less time than a frame, so this is not a wait being
 * reported — it is a wait being *made*, and the honest reason is that a screen
 * which changes instantly reads as a screen that did nothing. A second of the
 * machine visibly working is what makes the ship that appears afterwards feel
 * like something that was built rather than something that was already there.
 *
 * The strip under the title is the machine's own noise: scrambled text at a
 * third opacity, filling the width, resolving into more of itself. It says
 * nothing on purpose — a loading screen that prints real sentences invites
 * reading, and there is nothing here to read.
 */
export const GENERATING_MS = 1000;

/**
 * Filler, and the oldest filler there is.
 *
 * Latin rather than words from the game, because the strip is scrambled and
 * half-transparent and a player who catches a real ship name in it will try to
 * read the rest. What is wanted is texture.
 */
const LOREM =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor " +
  "incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis " +
  "nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat " +
  "duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore " +
  "eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt " +
  "in culpa qui officia deserunt mollit anim id est laborum ";

export function Generating({ onDone }: { onDone: () => void }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(
    function resolve() {
      if (ref.current === null) return;
      return reveal(linesOf(ref.current), FX.PRESETS.all);
    },
    [],
  );

  /* The strip keeps resolving for as long as the screen is up: one pass and it
     would settle into readable Latin, which is the one thing it must not be. */
  const strip = useRef<HTMLDivElement>(null);
  useEffect(function churn() {
    let stop: (() => void) | undefined;
    const again = (): void => {
      if (strip.current === null) return;
      stop?.();
      stop = reveal(linesOf(strip.current), { ...FX.PRESETS.all, ticks: 6, tickMs: 60 });
    };
    again();
    const every = setInterval(again, 380);
    return () => {
      clearInterval(every);
      stop?.();
    };
  }, []);

  useEffect(
    function through() {
      const t = window.setTimeout(onDone, GENERATING_MS);
      return () => {
        window.clearTimeout(t);
      };
    },
    [onDone],
  );

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background:
          "radial-gradient(ellipse 70% 62% at 50% 44%, var(--sv-deck) 0%, var(--sv-deep) 76%)",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      <div ref={ref}>
        <div
          data-sc
          style={{
            font: "var(--sv-display)",
            fontSize: 56,
            letterSpacing: "var(--sv-display-track)",
            textTransform: "uppercase",
            color: "var(--sv-amber)",
            lineHeight: 1,
          }}
        >
          Generating
        </div>
      </div>

      {/* One line, the width of the screen, clipped. It does not wrap: a block
          of this would read as a page of text and invite reading. */}
      <div
        ref={strip}
        style={{
          width: "100%",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textAlign: "center",
          opacity: 0.5,
          font: "var(--sv-body)",
          color: "var(--sv-soft)",
          pointerEvents: "none",
        }}
      >
        <div data-sc>{LOREM.repeat(3)}</div>
      </div>
    </div>
  );
}
