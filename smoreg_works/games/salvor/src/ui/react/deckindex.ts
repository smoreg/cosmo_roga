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

/**
 * Bumped when the index lands, and watched by the board.
 *
 * Without this the art was fetched, parsed, stored — and never drawn, because
 * nothing had changed as far as React was concerned. The board had already
 * read `deckIndex()` while it was still null and would not read it again until
 * a turn was taken, so the decks appeared on the first move and not on load.
 * That is the whole bug, and a version nobody subscribes to is how it hid.
 */
let version = 0;
const watching = new Set<() => void>();

export function deckIndex(): DeckIndex | null {
  return index;
}

/** For `useSyncExternalStore`: changes exactly once, when the art arrives. */
export function deckVersion(): number {
  return version;
}

export function watchDeck(fn: () => void): () => void {
  watching.add(fn);
  return () => {
    watching.delete(fn);
  };
}

/** Ask for it. Safe to call repeatedly; the second call does nothing. */
export function loadDeckIndex(): Promise<void> {
  if (asked) return Promise.resolve();
  asked = true;
  if (typeof fetch !== "function") return Promise.resolve();
  return fetch("deck/deck.json")
    .then((r) => (r.ok ? (r.json() as Promise<DeckIndex>) : null))
    .then((got) => {
      if (got === null) return;
      index = got;
      version++;
      for (const fn of watching) fn();
    })
    .catch(() => undefined);
}

/** Where a baked tile is served from. */
export function tileUrl(id: string): string {
  return `deck/t/${id}.webp`;
}
