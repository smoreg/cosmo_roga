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
/**
 * The request in flight, if one is.
 *
 * It used to be a bare `asked` flag, which meant a load that *failed* could
 * never be tried again: the splash asks once on the way in, and if that came
 * back empty the board had no way of ever getting its plating. Now a second
 * caller joins the first if it is still going, and starts a fresh one if the
 * last came to nothing.
 */
let flight: Promise<void> | null = null;

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

/**
 * Adopt an index, from wherever it came.
 *
 * Separate from the fetch because getting the bytes and taking them up are two
 * different things, and only one of them needs a network: a test that wants a
 * board with decks on it says so directly instead of standing a server up, and
 * does not have to be run after some other test that happened to warm the
 * cache.
 */
export function applyDeckIndex(got: DeckIndex): void {
  index = got;
  version++;
  for (const fn of watching) fn();
}

export function watchDeck(fn: () => void): () => void {
  watching.add(fn);
  return () => {
    watching.delete(fn);
  };
}

/**
 * Ask for it.
 *
 * Safe to call repeatedly: once it has arrived this is free, while it is on
 * its way the second caller waits on the first, and after a failure the next
 * caller tries again.
 */
export function loadDeckIndex(): Promise<void> {
  if (index !== null) return Promise.resolve();
  if (flight !== null) return flight;
  if (typeof fetch !== "function") return Promise.resolve();
  flight = fetch("deck/deck.json")
    .then((r) => (r.ok ? (r.json() as Promise<DeckIndex>) : null))
    .then((got) => {
      if (got !== null) applyDeckIndex(got);
    })
    .catch(() => undefined)
    .finally(() => {
      flight = null;
    });
  return flight;
}

/** Where a baked tile is served from. */
export function tileUrl(id: string): string {
  return `deck/t/${id}.webp`;
}
