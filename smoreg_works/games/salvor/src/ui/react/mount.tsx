import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { RoomGame } from "@jamrog/engine";
import { App } from "./App.js";
import { Screen } from "./Screen.js";
import "./styles.css";

/**
 * The React view's only contact with the page: one element, one root.
 *
 * Everything above it is a function of the game, which is why this file is the
 * one part of the view no test covers and why it is kept short enough to read
 * in full.
 */
export function mountReact(host: HTMLElement, seed: number): () => void {
  const root = createRoot(host);
  root.render(
    <StrictMode>
      <App seed={seed} />
    </StrictMode>,
  );
  return () => root.unmount();
}

/**
 * The same screen, over a run the shell already owns.
 *
 * `mountReact` above makes its own game, which is what a page whose only view
 * is this one wants. This repo has four (`ui/view.ts`) and `V` walks between
 * them mid-run, so the React screen cannot be allowed a second game: the
 * terminal and the honeycomb would go on drawing the first one and the same key
 * would move two different voyages. So the shell keeps the game and hands it
 * over, exactly as it hands it to the other two renderers.
 *
 * `StrictMode` is deliberately not here. It double-invokes render, and this
 * screen is read off a mutable engine object rather than off props — under the
 * double call the second read can see a turn the first did not.
 */
export interface ScreenRoot {
  draw(game: RoomGame, sound: boolean): void;
  unmount(): void;
}

export function mountScreen(
  host: HTMLElement,
  onSound: (on: boolean) => void,
  onNewVoyage: () => void,
): ScreenRoot {
  const root: Root = createRoot(host);
  return {
    draw(game, sound) {
      root.render(<Screen game={game} sound={sound} onSound={onSound} onNewVoyage={onNewVoyage} />);
    },
    unmount() {
      root.unmount();
    },
  };
}
