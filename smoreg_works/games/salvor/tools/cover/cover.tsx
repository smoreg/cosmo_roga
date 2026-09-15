import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { newGame } from "../../src/game.js";
import { undock } from "../../src/systems/voyage.js";
import { boardOf } from "../../src/ui/react/model.js";
import { HexBoard } from "../../src/ui/react/board/HexBoard.js";
import { loadDeckIndex } from "../../src/ui/react/deckindex.js";
import "../../src/ui/react/styles.css";

/**
 * The itch.io cover plate, rendered out of the game rather than drawn.
 *
 *   npm run dev -w games/salvor, then /cover.html
 *   node tools/cover/shoot.mjs   — screenshots it to assets/cover.png
 *
 * 630×500 is itch's own size, and the plate is exactly that here so the
 * screenshot needs no cropping and the border is eight real pixels rather than
 * eight scaled ones.
 *
 * The hull is a real hull from a real seed with its compartments opened, so
 * what is on the cover is what a player gets: the same honeycomb, the same
 * plating, the same rings. A cover drawn by hand would be a promise the game
 * has to keep, and this one keeps itself.
 */

/**
 * The seed the cover is cut from — `?seed=N` to try another.
 *
 * A hull is a graph grown from a seed, so which ship is on the plate is a
 * number and not a drawing. Wide and shallow reads best: the title band lies
 * across the middle of the plate, and a tall hull spends half of itself behind
 * it.
 */
const SEED = Number(new URLSearchParams(window.location.search).get("seed") ?? 4131);

/** Amber frame, and air. The hull is scaled to what is left. */
const MARGIN = 44;

/**
 * How much of that the hull is allowed to take, and where it sits in it.
 *
 * The title band crosses the plate, and at a full fit it lands squarely on a
 * row of compartment labels and slices them in half — which is the one thing a
 * cover cannot do, because a half-word reads as a rendering fault rather than
 * as a design. Backing the hull off and dropping it a little puts whole rows
 * above the band and whole rows below it.
 */
const FILL = 0.88;
const LIFT = 14;

/**
 * How much room the board is given before it is scaled down.
 *
 * The board clips at its own box — it is a panned viewport, and that is right
 * for a game where the hull is bigger than the window. Given the plate's own
 * 630×500 it cropped the hull *before* anything here could scale it, and no
 * amount of fitting brings back a row the board has already cut off. So it is
 * handed a sheet far larger than the plate, draws the whole ship on it, and
 * the sheet is what gets scaled down.
 */
const SHEET_W = 1800;
const SHEET_H = 1500;

function Cover(): ReactElement {
  /*
   * Where the hull actually is, measured rather than worked out.
   *
   * The board centres its own bounding box, and that box counts the wreckage —
   * hull the ship no longer has, drawn faint — so a lopsided hulk sits well off
   * the middle of the plate. Rather than re-deriving the honeycomb's geometry
   * here (a second copy of it, free to drift from the first), the drawn cells
   * are measured once after they are on the page and the whole board is nudged
   * so what a reader sees as the ship is centred on what a reader sees as the
   * plate.
   */
  const frame = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ x: 0, y: 0, s: 1 });
  useLayoutEffect(function centre() {
    /*
     * Measured more than once on purpose.
     *
     * The board pans itself and the deck art lands over the network, so the
     * first layout after mount is not the layout the shutter sees. Three
     * passes over the first second, each one measuring the *unscaled* cells —
     * which is why the fit is recomputed from scratch rather than adjusted.
     */
    const passes = [0, 250, 900].map((at) => window.setTimeout(measure, at));
    return () => {
      for (const t of passes) window.clearTimeout(t);
    };

    function measure(): void {
    const box = frame.current;
    if (box === null) return;
    /* Compartments only. Wreckage is hull the ship no longer has, drawn faint
       and negative-numbered — it belongs in the picture but it must not decide
       where the picture is centred, or a lopsided hulk pushes the ship you can
       actually walk off the bottom of the plate. */
    const cells = [...box.querySelectorAll("[data-room]")].filter(
      (c) => !(c.getAttribute("data-room") ?? "").startsWith("-"),
    );
    if (cells.length === 0) return;
    const plate = box.parentElement;
    if (plate === null) return;
    const was = box.style.transform;
    box.style.transform = "none";
    /* The plate is what the hull has to fit; the sheet is only where it is
       drawn, and it is deliberately much bigger than the plate. */
    const b = plate.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
    }
    /* Whatever hex size the board was given, the hull is scaled to the plate
       and then centred on it — so changing the seed cannot put half a ship off
       the edge, and a small hull fills the plate as readily as a big one.
       `scale` first, `translate` second, which is how CSS composes them. */
    box.style.transform = was;
    const s = Math.min(
      (b.width - MARGIN * 2) / (x1 - x0),
      (b.height - MARGIN * 2) / (y1 - y0),
    );
    setFit({
      s: s * FILL,
      x: Math.round(-s * FILL * ((x0 + x1) / 2 - (b.left + b.right) / 2)),
      y: Math.round(-s * FILL * ((y0 + y1) / 2 - (b.top + b.bottom) / 2)) + LIFT,
    });
    }
  }, []);

  const game = newGame(SEED);
  undock(game);
  /* Open the hull. A cover is a picture of the ship, not of what one drone has
     managed to see of it — the fog is the game's subject and not the poster's. */
  for (const room of game.ship.rooms) {
    room.explored = true;
    room.scanned = true;
  }
  game.refreshSight();
  const board = boardOf(game);

  return (
    <div
      style={{
        position: "relative",
        width: 630,
        height: 500,
        overflow: "hidden",
        background:
          "radial-gradient(ellipse 72% 66% at 50% 46%, var(--sv-deck) 0%, var(--sv-deep) 78%)",
        /* The border is drawn inside the plate, so the file is 630×500 and the
           amber is part of the picture rather than something around it. */
      }}
    >
      <div
        ref={frame}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: SHEET_W,
          height: SHEET_H,
          marginLeft: -SHEET_W / 2,
          marginTop: -SHEET_H / 2,
          transform: `translate(${String(fit.x)}px, ${String(fit.y)}px) scale(${String(fit.s)})`,
          transformOrigin: "center",
        }}
      >
        {/* No drone. A cover is a picture of the ship, and the mark is a piece
            of interface: it points at where you are, and on a plate nobody is
            anywhere yet. The compartment it was in keeps its amber, which is
            the focal point the mark was borrowing anyway. */}
        <HexBoard rooms={board.rooms} doors={board.doors} drone={null} size={104} />
      </div>

      {/* The scanlines the whole interface wears, over the board and under the
          title, so the plate reads as the same screen. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--sv-scan)",
          pointerEvents: "none",
        }}
      />

      {/* A band behind the words rather than a shadow: this system has no
          blur in it, and a title floating over a busy hull is unreadable. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          /* Opaque. A half-transparent band over a hull full of plating and
             labels is two pictures fighting, and the one that loses is the
             title — which is the one thing on a cover that has to survive
             being seen at thumbnail size. */
          background: "var(--sv-knock)",
          borderTop: "2px solid var(--sv-amber)",
          borderBottom: "2px solid var(--sv-amber)",
          padding: "12px 0 16px",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            font: "var(--sv-display)",
            fontSize: 113,
            lineHeight: 0.82,
            letterSpacing: "var(--sv-display-track)",
            textTransform: "uppercase",
            color: "var(--sv-amber)",
          }}
        >
          Derelict Rogue
        </div>
      </div>

      {/* The frame, drawn last and over everything. As a border on the plate
          it was the board's to overrun: `overflow` clips a child at the border
          box, not at the padding box, so the hull ran straight over the top
          eight pixels of amber. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: "8px solid var(--sv-amber)",
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

const host = document.getElementById("plate");
if (host === null) throw new Error("#plate missing from cover.html");
void loadDeckIndex().then(() => {
  createRoot(host).render(
    <StrictMode>
      <Cover />
    </StrictMode>,
  );
});
