import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Panel } from "../chrome/Panel.js";
import { linesOf, reveal } from "../reveal.js";
import * as FX from "../../fx/derelict-fx.js";
import { deckIndex, loadDeckIndex, tileUrl } from "../deckindex.js";
import { MENU_MUSIC, music } from "../audio.js";

/**
 * The door the game opens through, and the two things it is for.
 *
 * A browser will not let a page make noise until somebody has touched it, so
 * there has to be a touch. And the deck art is three megabytes of plating that
 * arrives after the first paint — on a fast machine nobody notices, and on an
 * itch page served cold the board draws flat for a moment and then fills in,
 * which reads as a bug rather than as loading.
 *
 * One press answers both. The press is the gesture the audio needs, and what
 * follows it is the wait, made visible: the index, then the tiles it names,
 * then the first track. Nothing here is decoration — each line is a thing that
 * has to arrive before the game looks like itself.
 */
type Stage = "waiting" | "loading" | "ready";

/**
 * How long the door waits before opening anyway.
 *
 * Long enough for three megabytes on a slow connection, short enough that a
 * file which is simply not there — a bad path in a zip, a CDN that refuses —
 * costs a pause and not the game.
 */
const LOAD_DEADLINE = 12_000;

interface Step {
  label: string;
  done: number;
  of: number;
}

const STENCIL = {
  font: "var(--sv-stencil)",
  letterSpacing: "var(--sv-stencil-track)",
  textTransform: "uppercase",
} as const;

/**
 * Fetch every tile, reporting as they land.
 *
 * `Image` rather than `fetch`, because what is wanted is the *decoded* picture
 * in the browser's own cache — a fetch would warm the network cache and leave
 * the first draw to decode three megabytes at once. A tile that fails is
 * counted as done: a hull missing one section of plating is a smaller problem
 * than a loading screen that never finishes.
 *
 * Cancelling stops the *counting* and never the loading. Clearing `src` was
 * the obvious way to abort and is the wrong one twice over: the point of this
 * is to fill the cache, so a tile abandoned a frame before the board asks for
 * it is work thrown away — and an empty `src` is read by browsers as the
 * document's own url, which turns two hundred and fifty-nine aborts into two
 * hundred and fifty-nine requests for the page.
 */
function preloadTiles(ids: readonly string[], onStep: (done: number) => void): () => void {
  let live = true;
  let done = 0;
  for (const id of ids) {
    const img = new Image();
    const tick = (): void => {
      if (!live) return;
      done++;
      onStep(done);
    };
    img.onload = tick;
    img.onerror = tick;
    img.src = tileUrl(id);
  }
  return () => {
    live = false;
  };
}

export function Splash({ onStart }: { onStart: () => void }): ReactElement {
  const [stage, setStage] = useState<Stage>("waiting");
  const [steps, setSteps] = useState<Step[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(
    function resolve() {
      if (ref.current === null) return;
      return reveal(linesOf(ref.current), FX.PRESETS.all);
    },
    [stage],
  );

  useEffect(
    function load() {
      if (stage !== "loading") return;
      let live = true;
      let stopTiles: (() => void) | undefined;

      const set = (i: number, patch: Partial<Step>): void => {
        if (!live) return;
        setSteps((was) => was.map((s, n) => (n === i ? { ...s, ...patch } : s)));
      };

      setSteps([
        { label: "manifest", done: 0, of: 1 },
        { label: "deck plating", done: 0, of: 1 },
        { label: "music", done: 0, of: 1 },
      ]);

      void loadDeckIndex().then(() => {
        if (!live) return;
        const index = deckIndex();
        set(0, { done: 1 });
        const ids = index === null ? [] : index.tiles.map((t) => t.id);
        set(1, { of: Math.max(1, ids.length) });
        if (ids.length === 0) set(1, { done: 1 });
        else stopTiles = preloadTiles(ids, (done) => set(1, { done }));
      });

      /* The menu track, which is also the one the press just bought the right
         to play. Counted done either way: a run with no music is a run. */
      const audio = new Audio();
      audio.preload = "auto";
      const heard = (): void => set(2, { done: 1 });
      audio.oncanplaythrough = heard;
      audio.onerror = heard;
      audio.src = MENU_MUSIC.url;

      /* And a deadline, because a loading screen that waits forever on a file
         that is never coming is a locked door. Whatever has not arrived by now
         is not worth holding the game for: the board draws without its plating
         and the run is silent, both of which are recoverable and neither of
         which is a page that never opens. */
      const deadline = window.setTimeout(function giveUp() {
        if (!live) return;
        setSteps((was) => was.map((step) => ({ ...step, done: step.of })));
      }, LOAD_DEADLINE);

      return () => {
        live = false;
        stopTiles?.();
        window.clearTimeout(deadline);
      };
    },
    [stage],
  );

  /* Through when every step is. Held here rather than in the loader so a step
     added later is counted without anything else being told about it. */
  useEffect(
    function through() {
      if (stage !== "loading" || steps.length === 0) return;
      if (steps.every((s) => s.done >= s.of)) setStage("ready");
    },
    [stage, steps],
  );

  /* And the beat before the door opens, in an effect of its own.
     It was in the one above, where setting the stage re-ran the effect and the
     cleanup cancelled the very timer it had just scheduled — so the bars
     filled, the stencil said `aboard`, and nothing ever happened. The beat is
     there so the bars are seen full rather than vanishing on the frame they
     fill. */
  useEffect(
    function open() {
      if (stage !== "ready") return;
      const t = window.setTimeout(onStart, 260);
      return () => {
        window.clearTimeout(t);
      };
    },
    [stage, onStart],
  );

  const begin = (): void => {
    /* The gesture, spent immediately: a browser grants it to the handler and
       not to whatever happens two seconds later. */
    music.play(MENU_MUSIC);
    setStage("loading");
  };

  return (
    <div
      onClick={stage === "waiting" ? begin : undefined}
      onKeyDown={stage === "waiting" ? begin : undefined}
      tabIndex={stage === "waiting" ? 0 : -1}
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(ellipse 70% 62% at 50% 44%, var(--sv-deck) 0%, var(--sv-deep) 76%)",
        cursor: stage === "waiting" ? "pointer" : "default",
        userSelect: "none",
        outline: "none",
      }}
    >
      <div ref={ref} style={{ width: 460, maxWidth: "92vw" }}>
        <div
          data-sc
          style={{
            font: "var(--sv-display)",
            fontSize: 60,
            letterSpacing: "var(--sv-display-track)",
            textTransform: "uppercase",
            color: "var(--sv-amber)",
            lineHeight: 1,
          }}
        >
          Derelict Rogue
        </div>

        {stage === "waiting" ? (
          /* The name and the way in, and nothing else. A door does not need a
             panel around it or a sentence under it, and it does not blink:
             there is one thing on this screen, so nothing has to compete for
             the eye — a mark that flashes when it is the only mark reads as a
             fault rather than as an invitation. */
          <div
            style={{
              marginTop: 26,
              padding: "12px 0",
              textAlign: "center",
              clipPath: "var(--sv-cut-bl)",
              background: "var(--sv-amber)",
              color: "var(--sv-knock)",
              font: "var(--sv-display)",
              fontSize: 26,
              letterSpacing: "var(--sv-display-track)",
              textTransform: "uppercase",
            }}
          >
            click to start
          </div>
        ) : (
          <div style={{ marginTop: 26 }}>
            <Panel title="Loading" stencil={stage === "ready" ? "aboard" : "hold"}>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {steps.map((s) => (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 104, flex: "none", ...STENCIL, color: "var(--sv-soft)" }}>
                      {s.label}
                    </span>
                    {/* The bar is the count, struck the way every other meter in
                        this game is struck. Twenty marks whatever the total, so
                        three hundred tiles and one manifest read alike. */}
                    <span style={{ display: "flex", gap: 1, flex: 1, minWidth: 0 }}>
                      {Array.from({ length: 20 }, (_, i) => (
                        <span
                          key={i}
                          style={{
                            flex: 1,
                            height: 10,
                            background:
                              i < Math.round((s.done / Math.max(1, s.of)) * 20)
                                ? "var(--sv-amber)"
                                : "var(--sv-plate-lit)",
                          }}
                        />
                      ))}
                    </span>
                    <span style={{ width: 54, textAlign: "right", ...STENCIL, color: "var(--sv-ink)" }}>
                      {s.done >= s.of ? "ok" : `${String(Math.round((s.done / Math.max(1, s.of)) * 100))}%`}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
