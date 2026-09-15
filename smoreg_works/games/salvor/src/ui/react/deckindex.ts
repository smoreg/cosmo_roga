import type { DeckIndex } from "./deck.js";

/**
 * The baked tile index, fetched once and remembered.
 *
 * A module-level cache and a bare `fetch`, because the index is a fact about
 * the build rather than about the run: it never changes while the page is
 * open, every board wants the same copy, and a board asked to draw before it
 * arrives simply draws without it. That is the whole error handling — a hull
 * with no deck art is the flat board this game already had, which is why
 * nothing here throws and nothing retries.
 *
 * `public/deck` is served beside the bundle, so this works from a `file://`
 * URL inside an itch zip as well as from a server.
 */
let index: DeckIndex | null = null;
let asked = false;

export function deckIndex(): DeckIndex | null {
  return index;
}

/** Ask for it. Safe to call repeatedly; the second call does nothing. */
export function loadDeckIndex(): Promise<void> {
  if (asked) return Promise.resolve();
  asked = true;
  if (typeof fetch !== "function") return Promise.resolve();
  return fetch("deck/deck.json")
    .then((r) => (r.ok ? (r.json() as Promise<DeckIndex>) : null))
    .then((got) => {
      if (got !== null) index = got;
    })
    .catch(() => undefined);
}

/** Where a baked tile is served from. */
export function tileUrl(id: string): string {
  return `deck/t/${id}.webp`;
}
