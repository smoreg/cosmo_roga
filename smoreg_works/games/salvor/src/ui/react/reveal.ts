import * as FX from "../fx/derelict-fx.js";

/**
 * Run a scramble reveal so that cancelling it can never leave a blank screen.
 *
 * `scrambleReveal` empties every line it is given *synchronously* and fills it
 * back in over held frames, and its `cancel` stops the frames and leaves the
 * DOM where they got to. That is the right behaviour for the library — a
 * cancelled animation should not fight whatever cancelled it — and the wrong
 * behaviour for a React effect, which is cancelled routinely: StrictMode runs
 * every effect, cleans it up and runs it again, and a page whose second pass
 * starts from the blanks left by the first is a page that never comes back.
 *
 * So the text is remembered before the reveal starts and put back if the
 * reveal does not finish. The library's own `data-text` is where it is kept,
 * which is also where `scrambleReveal` looks for it, so a second pass over the
 * same lines reads the words rather than the wreckage of the first.
 */
export function reveal(nodes: readonly Element[], preset: unknown): () => void {
  const kept = nodes.map((el) => {
    const node = el as HTMLElement;
    const text = node.dataset.text ?? node.textContent ?? "";
    node.dataset.text = text;
    return { node, text };
  });
  let done = false;
  const running = FX.scrambleReveal(nodes, {
    ...(preset as Record<string, unknown>),
    onDone: () => {
      done = true;
    },
  } as never);
  return () => {
    running.cancel();
    if (done) return;
    for (const { node, text } of kept) node.textContent = text;
  };
}

/**
 * Every line of a subtree, whether it is marked or not.
 *
 * Marked ones win where there are any — a component that says which of its
 * text is a line means it. Where there are none, a leaf is any element whose
 * children are all text, which is the fallback the design system's own
 * `MenuSheet` uses so that a panel growing a row does not need remembering to.
 *
 * A line that has been revealed before counts even while it is blank, which is
 * the whole of why this is a function and not a selector: mid-reveal the DOM
 * says these elements have no text, and a filter that believed it would drop
 * exactly the lines that most need putting back.
 */
export function linesOf(host: Element): Element[] {
  const marked = Array.from(host.querySelectorAll("[data-sc]"));
  if (marked.length > 0) return marked;
  return Array.from(host.querySelectorAll("div,span")).filter((el) => {
    if (!Array.from(el.childNodes).every((n) => n.nodeType === 3)) return false;
    const node = el as HTMLElement;
    if (node.dataset.text !== undefined) return true;
    return (el.textContent ?? "").trim() !== "";
  });
}
