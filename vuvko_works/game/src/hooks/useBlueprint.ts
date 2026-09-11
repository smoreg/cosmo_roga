import { useEffect, useState } from "react";
import { renderBlueprint } from "../render/backdrop";
import type { DeckMap } from "../core/types";

/**
 * Draws the deck's own artwork into a blueprint underlay, once per deck.
 *
 * Returns null while it is working and null if the tile library is not being
 * served — the map falls back to its schematic backdrop, which needs no
 * assets. A missing tile is a deployment fact, not an error worth a dialog.
 */
export function useBlueprint(deck: DeckMap | null, tilesBaseUrl: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(
    function draw() {
      if (deck === null || tilesBaseUrl === null || deck.plan.length === 0) {
        setUrl(null);
        return;
      }
      const controller = new AbortController();
      let live = true;

      renderBlueprint(deck.plan, deck.sizeFeet, { tilesBaseUrl, signal: controller.signal })
        .then(function keep(result) {
          if (live) setUrl(result);
          return result;
        })
        .catch(function giveUp() {
          if (live) setUrl(null);
        });

      return function stop() {
        live = false;
        controller.abort();
      };
    },
    [deck, tilesBaseUrl],
  );

  return url;
}
