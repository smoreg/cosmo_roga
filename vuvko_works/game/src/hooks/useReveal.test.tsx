import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useReveal } from "./useReveal";

function Line(props: { readonly text: string }) {
  const ref = useReveal(props.text, "log");
  return <span id="line" ref={ref} />;
}

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    show(text: string) {
      act(() => {
        root.render(<Line text={text} />);
      });
    },
    get text() {
      return host.querySelector("#line")?.textContent ?? null;
    },
    drop() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("revealing text a frame at a time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /* Long enough for any preset to finish: the slowest is `boot` at 900ms of
     stagger and five ticks of 180. */
  function settle(): void {
    act(() => {
      vi.advanceTimersByTime(4000);
    });
  }

  it("writes the first text straight in, rather than animating the page loading", () => {
    const view = mount();
    view.show("Boarded.");
    /* No timers advanced: the first write is not an animation. */
    expect(view.text).toBe("Boarded.");
    view.drop();
  });

  it("leaves the truth behind however the reveal was interrupted", () => {
    /* The property the whole presentation layer rests on: it is droppable. On
       whatever frame an effect was, replacing the text or unmounting leaves the
       element showing what it was last told and never a scrambled fragment —
       because the cleanup writes the text rather than stopping halfway. */
    const view = mount();
    view.show("one");
    settle();
    view.show("two");
    view.show("three");
    settle();
    expect(view.text).toBe("three");
    view.drop();
  });

  it("writes into an element that arrives after the text did", () => {
    /* The case that was broken: a panel appears on selection, so its text is
       computed on a render where there is no element to put it in. A plain ref
       is invisible to the effect's dependencies, so nothing ever wrote to it
       and the row sat blank. */
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Late(props: { readonly open: boolean }) {
      const ref = useReveal("sound", "panel");
      return props.open ? <span id="late" ref={ref} /> : null;
    }
    act(() => {
      root.render(<Late open={false} />);
    });
    act(() => {
      root.render(<Late open />);
    });
    expect(host.querySelector("#late")?.textContent).toBe("sound");
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("survives text arriving faster than a reveal takes", () => {
    const view = mount();
    for (const text of ["a", "b", "c", "d", "e"]) view.show(text);
    settle();
    expect(view.text).toBe("e");
    view.drop();
  });
});
