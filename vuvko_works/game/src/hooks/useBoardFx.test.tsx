import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useBoardFx } from "./useBoardFx";
import type { GameEvent } from "../core/events";
import type { Axial, Point } from "../core/hex";
import type { Weapon } from "../core/types";

const KNIFE: Weapon = { name: "welder", weaponClass: "melee", damage: 3, strikes: 1 };

const BLOW: GameEvent[] = [
  {
    kind: "attackDeclared",
    attackerId: 0,
    targetId: 1,
    targetIsObject: false,
    weapon: KNIFE,
    answeringWeapon: null,
  },
  {
    kind: "strikeLanded",
    sourceId: 0,
    targetId: 1,
    targetIsObject: false,
    damage: 3,
    remaining: 9,
  },
];

/* The hook wants a real <svg> to query, which React cannot own — the effects
   write into these elements directly. So the test builds one and hands it in. */
function makeBoard(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const mark of ["data-fx-flyer", "data-fx-edge", "data-fx-damage"]) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
    el.setAttribute(mark, "");
    svg.append(el);
  }
  for (const id of [0, 1]) {
    const token = document.createElementNS("http://www.w3.org/2000/svg", "g");
    token.setAttribute("data-unit", String(id));
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(id * 10));
    dot.setAttribute("cy", "0");
    token.append(dot);
    const glyph = document.createElementNS("http://www.w3.org/2000/svg", "text");
    glyph.setAttribute("data-glyph", String(id));
    token.append(glyph);
    svg.append(token);
  }
  document.body.append(svg);
  return svg;
}

function centreOf(at: Axial): Point {
  return { x: at.q, y: at.r };
}

afterEach(function tidy() {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("useBoardFx", function suite() {
  it("plays a beat once, however often the board around it changes", function once() {
    const svg = makeBoard();
    const faceOf = vi.fn(function describe() {
      return { label: "D1", colour: "var(--drone)" };
    });

    function Harness(props: { readonly unit: number }) {
      useBoardFx({ root: svg, batch: BLOW, centreOf, unit: props.unit, faceOf });
      return null;
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(function first() {
      root.render(<Harness unit={1} />);
    });
    const after = faceOf.mock.calls.length;
    expect(after).toBeGreaterThan(0);

    /* The board changes on every command, and the store publishes the batch a
       microtask later — so there is always a render where the geometry has
       moved on and the batch has not. It must not replay. */
    act(function again() {
      root.render(<Harness unit={2} />);
    });
    act(function andAgain() {
      root.render(<Harness unit={3} />);
    });
    expect(faceOf.mock.calls.length).toBe(after);

    act(function stop() {
      root.unmount();
    });
  });
});
