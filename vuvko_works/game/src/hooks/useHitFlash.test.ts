import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "./test-render";
import { useHitFlash } from "./useHitFlash";
import { strikeLanded } from "../core/events";
import type { GameEvent } from "../core/events";

function token(id: number): SVGGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "g");
  element.dataset.unit = String(id);
  document.body.append(element);
  return element;
}

describe("a strike lands and the token says so", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("leaves the token exactly as the renderer drew it once it is done", () => {
    /* The property the whole presentation layer rests on. An effect may write
       what it likes while it runs; when it stops, for any reason, what is on
       screen must be what the store says and nothing else. */
    const hit = token(3);
    const run = renderHook(() => {
      useHitFlash([strikeLanded(1, 3, false, 4, 8)]);
    });
    vi.advanceTimersByTime(2000);
    expect(hit.style.opacity).toBe("");
    run.unmount();
    expect(hit.style.opacity).toBe("");
  });

  it("cleans up even when dropped mid-flash", () => {
    const hit = token(7);
    const run = renderHook(() => {
      useHitFlash([strikeLanded(1, 7, false, 2, 5)]);
    });
    vi.advanceTimersByTime(140);
    run.unmount();
    expect(hit.style.opacity).toBe("");
  });

  it("does nothing for a beat with no strikes in it", () => {
    const quiet = token(1);
    renderHook(() => {
      useHitFlash([] as readonly GameEvent[]);
    });
    vi.advanceTimersByTime(2000);
    expect(quiet.style.opacity).toBe("");
  });

  it("ignores a strike on machinery, which has no token", () => {
    const unit = token(2);
    renderHook(() => {
      useHitFlash([strikeLanded(1, 2, true, 3, 3)]);
    });
    vi.advanceTimersByTime(2000);
    expect(unit.style.opacity).toBe("");
  });
});
