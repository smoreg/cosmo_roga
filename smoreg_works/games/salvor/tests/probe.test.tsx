// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { newGame } from "../src/game.js";
import { undock } from "../src/systems/voyage.js";
import { applyDeckIndex } from "../src/ui/react/deckindex.js";
import { Screen } from "../src/ui/react/Screen.js";
import type { DeckIndex } from "../src/ui/react/deck.js";
declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

describe("probe", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", { writable: true, value: (q: string) => ({ matches: true, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, onchange: null, dispatchEvent: () => false }) });
  });
  it("dumps a hex", () => {
    applyDeckIndex(JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "deck", "deck.json"), "utf8")) as DeckIndex);
    const game = newGame(2026);
    undock(game);
    const host = document.createElement("div");
    document.body.append(host);
    act(() => { createRoot(host).render(<Screen game={game} />); });
    const imgs = host.querySelectorAll("img");
    console.log("IMGS", imgs.length);
    const img = imgs[0] as HTMLImageElement | undefined;
    if (img) {
      console.log("SRC", img.getAttribute("src"));
      console.log("IMGSTYLE", img.getAttribute("style"));
      const hex = img.closest("[data-room]") as HTMLElement;
      console.log("HEX children, in paint order:");
      const walk = (el: Element, d: number) => {
        for (const c of Array.from(el.children)) {
          const st = (c as HTMLElement).getAttribute("style") ?? "";
          const bg = /background[^;]*/.exec(st)?.[0] ?? "";
          const z = /z-index[^;]*/.exec(st)?.[0] ?? "";
          const inset = /inset[^;]*/.exec(st)?.[0] ?? "";
          console.log(" ".repeat(d) + c.tagName + " | " + inset + " | " + bg + " | " + z);
          if (d < 2) walk(c, d + 1);
        }
      };
      walk(hex, 0);
    }
    expect(true).toBe(true);
  });
});
