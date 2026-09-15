import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
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
