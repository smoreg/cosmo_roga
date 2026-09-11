import { describe, expect, it } from "vitest";
import { clientToUser } from "./usePanZoom";

/* A tall deck in a wide pane — the shape that made the bug visible. */
const deck = { x: -43, y: -49, width: 285, height: 535 };

describe("mapping the pointer into the viewBox", () => {
  it("centres the content and leaves a margin, as xMidYMid meet does", () => {
    const rect = { left: 0, top: 0, width: 1000, height: 535 };
    /* It fits by height, so there are wide margins left and right. */
    const scale = 535 / 535;
    const marginX = (1000 - 285 * scale) / 2;

    /* The very middle of the element is the middle of the viewBox. */
    const middle = clientToUser(deck, rect, 500, 267.5);
    expect(middle.x).toBeCloseTo(deck.x + deck.width / 2, 6);
    expect(middle.y).toBeCloseTo(deck.y + deck.height / 2, 6);

    /* The left edge of the drawn content, not of the element. */
    const leftEdge = clientToUser(deck, rect, marginX, 0);
    expect(leftEdge.x).toBeCloseTo(deck.x, 6);
  });

  it("is not a stretch: the naive mapping disagrees badly off-centre", () => {
    const rect = { left: 0, top: 0, width: 1000, height: 535 };
    const correct = clientToUser(deck, rect, 700, 200);
    const stretched = {
      x: deck.x + (700 / rect.width) * deck.width,
      y: deck.y + (200 / rect.height) * deck.height,
    };
    /* Far more than a hex width apart, which is how a click landed on the
       wrong compartment entirely. */
    expect(Math.abs(correct.x - stretched.x)).toBeGreaterThan(35);
  });

  it("fits by width when the pane is the narrow one", () => {
    const rect = { left: 0, top: 0, width: 285, height: 900 };
    const marginY = (900 - 535) / 2;
    const top = clientToUser(deck, rect, 0, marginY);
    expect(top.x).toBeCloseTo(deck.x, 6);
    expect(top.y).toBeCloseTo(deck.y, 6);
  });

  it("honours the element's own offset on the page", () => {
    const rect = { left: 120, top: 60, width: 285, height: 535 };
    const corner = clientToUser(deck, rect, 120, 60);
    expect(corner.x).toBeCloseTo(deck.x, 6);
    expect(corner.y).toBeCloseTo(deck.y, 6);
  });

  it("round-trips the centre at any element size", () => {
    for (const [width, height] of [
      [300, 300],
      [1600, 400],
      [400, 1600],
      [285, 535],
    ]) {
      const rect = { left: 0, top: 0, width: width!, height: height! };
      const middle = clientToUser(deck, rect, width! / 2, height! / 2);
      expect(middle.x).toBeCloseTo(deck.x + deck.width / 2, 6);
      expect(middle.y).toBeCloseTo(deck.y + deck.height / 2, 6);
    }
  });

  it("gives back the client point when there is nothing to map onto", () => {
    expect(clientToUser(deck, { left: 0, top: 0, width: 0, height: 0 }, 5, 7)).toEqual({
      x: 5,
      y: 7,
    });
  });
});
