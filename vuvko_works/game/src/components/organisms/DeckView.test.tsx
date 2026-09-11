import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DeckView } from "./DeckView";
import { parseDeck } from "../../core/deck";
import type { RawDeckExport } from "../../core/deck";
import { buildMission } from "../../core/mission";
import raw from "../../assets/decks/hollow-tide-35ft.json";

function render() {
  const deck = parseDeck(raw as unknown as RawDeckExport);
  const mission = buildMission(deck, { seed: "view" });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const picked: string[] = [];

  act(() => {
    root.render(
      <DeckView
        deck={deck}
        state={mission.state}
        onPick={(point) =>
          picked.push(`${String(Math.round(point.x))},${String(Math.round(point.y))}`)
        }
      />,
    );
  });
  const svg = host.querySelector("svg");
  if (svg === null) throw new Error("no svg");
  /* jsdom lays nothing out, so the view would read a zero-sized box and refuse
     to pan. Give it the size a browser would report. */
  svg.getBoundingClientRect = function measured() {
    return {
      left: 0,
      top: 0,
      width: 600,
      height: 800,
      right: 600,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  const group = svg.querySelector("g[transform]");
  if (group === null) throw new Error("no transformed group");
  return { host, root, svg, group, picked, deck, mission };
}

function pointer(type: string, init: Record<string, number>): PointerEvent {
  return new PointerEvent(type, { bubbles: true, pointerId: 1, ...init });
}

describe("the map view", () => {
  it("tints every hex with the colour of the room it belongs to", () => {
    const { svg, root, host } = render();
    const hexes = [...svg.querySelectorAll("polygon.hex")];
    expect(hexes.length).toBeGreaterThan(50);

    const fills = new Set(hexes.map((hex) => hex.getAttribute("fill")));
    fills.delete(null);
    /* Not one flat colour, and never transparent: the rooms should read even
       with the blueprint underneath. */
    expect(fills.size).toBeGreaterThan(1);
    expect(fills.has("transparent")).toBe(false);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("blurs the ship's artwork behind the lattice", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "blur" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <DeckView
          deck={deck}
          state={mission.state}
          backdropUrl="data:image/png;base64,iVBORw0KGgo="
        />,
      );
    });

    const image = host.querySelector("image");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("filter")).toMatch(/^url\(#deck-blur/);

    const blur = host.querySelector("feGaussianBlur");
    const deviation = Number(blur?.getAttribute("stdDeviation") ?? "0");
    /* Softened, but nothing like enough to dissolve the plan. */
    expect(deviation).toBeGreaterThan(0);
    expect(deviation).toBeLessThan(deck.feetAcross * 0.15);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("pans on drag, and the drag does not land as a click on a hex", () => {
    const { svg, group, picked, root, host } = render();
    const before = group.getAttribute("transform");

    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      svg.dispatchEvent(pointer("pointermove", { clientX: 180, clientY: 140 }));
      svg.dispatchEvent(pointer("pointerup", { clientX: 180, clientY: 140 }));
    });
    const after = svg.querySelector("g[transform]")?.getAttribute("transform");
    expect(after).not.toBe(before);

    /* A click arriving at the end of that gesture must be swallowed. */
    const hex = svg.querySelector("polygon.hex");
    act(() => {
      hex?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(picked).toEqual([]);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("still passes a plain click through to the hex", () => {
    const { svg, picked, root, host } = render();
    const hex = svg.querySelector("polygon.hex");
    act(() => {
      svg.dispatchEvent(pointer("pointerdown", { clientX: 100, clientY: 100 }));
      svg.dispatchEvent(pointer("pointerup", { clientX: 100, clientY: 100 }));
      hex?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(picked).toHaveLength(1);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("reports the pointer in ship feet, allowing for the letterbox margins", () => {
    /* The deck is tall and the pane is wide, so the drawn content is centred
       with margins. Reading the pointer as if the viewBox stretched to fill
       lands on the wrong compartment entirely. */
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "hover" });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const seen: { x: number; y: number }[] = [];

    act(() => {
      root.render(
        <DeckView
          deck={deck}
          state={mission.state}
          onHover={(point) => {
            if (point !== null) seen.push(point);
          }}
        />,
      );
    });
    const svg = host.querySelector("svg");
    if (svg === null) throw new Error("no svg");
    const rect = { left: 0, top: 0, width: 900, height: 600, right: 900, bottom: 600, x: 0, y: 0 };
    svg.getBoundingClientRect = function measured() {
      return { ...rect, toJSON: () => ({}) };
    };

    const box = svg.getAttribute("viewBox")?.split(" ").map(Number) ?? [];
    const [boxX, boxY, boxW, boxH] = box;

    act(() => {
      svg.dispatchEvent(pointer("pointermove", { clientX: 450, clientY: 300 }));
    });
    const middle = seen.at(-1);
    expect(middle).toBeDefined();
    /* Dead centre of the element is dead centre of the viewBox. */
    expect(middle!.x).toBeCloseTo(boxX! + boxW! / 2, 4);
    expect(middle!.y).toBeCloseTo(boxY! + boxH! / 2, 4);

    /* And a point off to one side is not simply the element fraction. */
    act(() => {
      svg.dispatchEvent(pointer("pointermove", { clientX: 700, clientY: 300 }));
    });
    const offCentre = seen.at(-1);
    const stretched = boxX! + (700 / rect.width) * boxW!;
    expect(Math.abs(offCentre!.x - stretched)).toBeGreaterThan(deck.feetAcross);

    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("zooms from the controls and comes back to fit", () => {
    const { svg, host, root } = render();
    const fit = svg.parentElement?.querySelector(
      'button[aria-label="Reset the view (or double-click the map)"]',
    );
    const zoomIn = svg.parentElement?.querySelector('button[aria-label="Zoom in"]');
    expect(fit).not.toBeNull();
    expect(zoomIn).not.toBeNull();

    const before = svg.querySelector("g[transform]")?.getAttribute("transform");
    act(() => {
      zoomIn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const zoomed = svg.querySelector("g[transform]")?.getAttribute("transform");
    expect(zoomed).not.toBe(before);
    expect(zoomed).toMatch(/scale\(1\.35\)/);

    act(() => {
      fit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(svg.querySelector("g[transform]")?.getAttribute("transform")).toBe(before);

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
