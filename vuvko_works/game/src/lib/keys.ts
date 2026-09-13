/**
 * Bind a key handler for as long as an effect lives.
 *
 * Every keyboard binding in the game is the same three lines and the same
 * mistake available in them — removing a different function than was added,
 * which leaks quietly and only shows up as a shortcut firing twice. Written
 * once so the handler that is removed is the handler that was added.
 */
export function bindKeys(onKey: (event: KeyboardEvent) => void): () => void {
  window.addEventListener("keydown", onKey);
  return function unbind() {
    window.removeEventListener("keydown", onKey);
  };
}

/** True where a keystroke belongs to something being typed into. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.isContentEditable);
}
