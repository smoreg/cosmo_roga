import { describe, expect, it } from "vitest";
import { setDoorState } from "./actions";
import { doorSegments, layoutDeck } from "../render/layout";
import { doorStroke } from "../render/palette";
import { testMission } from "./test/fixtures";
import type { DoorState } from "./types";

function drawnWith(state: DoorState) {
  const { deck, state: base } = testMission();
  const door = deck.doors[0];
  expect(door).toBeDefined();
  const changed = setDoorState(base, door!.id, state);
  const layout = layoutDeck(deck);
  const segment = doorSegments(deck, layout, changed.doorStates).find(
    (candidate) => candidate.doorId === door!.id,
  );
  expect(segment).toBeDefined();
  return segment!;
}

function gapOf(segment: ReturnType<typeof drawnWith>): number {
  /* The distance between the two leaves, as a fraction of the whole span. */
  const [first, second] = segment.leaves;
  if (first === undefined || second === undefined) return 0;
  const whole = Math.hypot(second[1].x - first[0].x, second[1].y - first[0].y);
  const gap = Math.hypot(second[0].x - first[1].x, second[0].y - first[1].y);
  return gap / whole;
}

describe("how a door is drawn", () => {
  it("draws a shut door as one unbroken span, in yellow", () => {
    const closed = drawnWith("closed");
    expect(closed.leaves).toHaveLength(1);
    expect(doorStroke("closed")).toBe("var(--door)");
  });

  it("draws a locked door the same way, but in red", () => {
    const locked = drawnWith("locked");
    expect(locked.leaves).toHaveLength(1);
    expect(doorStroke("locked")).toBe("var(--stamp)");
    /* Red because it is the one you cannot simply walk through. */
    expect(doorStroke("locked")).not.toBe(doorStroke("closed"));
  });

  it("draws an open door as two leaves with the way through between them", () => {
    const open = drawnWith("open");
    expect(open.leaves).toHaveLength(2);
    expect(doorStroke("open")).toBe("var(--door)");
    expect(gapOf(open)).toBeGreaterThan(0.3);
  });

  it("draws a broken door greyer, with a wider gap than an open one", () => {
    const broken = drawnWith("broken");
    const open = drawnWith("open");
    expect(broken.leaves).toHaveLength(2);
    expect(doorStroke("broken")).not.toBe(doorStroke("open"));
    expect(doorStroke("broken")).not.toBe(doorStroke("locked"));
    /* It is a hole, not a door: the gap is bigger. */
    expect(gapOf(broken)).toBeGreaterThan(gapOf(open));
  });

  it("keeps every state on the same span", () => {
    const spans = (["open", "closed", "locked", "broken"] as DoorState[]).map(function ends(state) {
      const segment = drawnWith(state);
      const first = segment.leaves[0]!;
      const last = segment.leaves.at(-1)!;
      return `${first[0].x.toFixed(3)},${first[0].y.toFixed(3)}|${last[1].x.toFixed(3)},${last[1].y.toFixed(3)}`;
    });
    expect(new Set(spans).size).toBe(1);
  });
});
