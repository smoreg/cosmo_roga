import type { Game } from "@jamrog/engine";

/**
 * Minimal shell. Copy games/fortnight2/src/ui for a full renderer with a
 * sidebar, message log, status effects and overlays.
 */
export class App {
  constructor(mount: HTMLElement, makeGame: () => Game) {
    const game = makeGame();
    mount.textContent = `${game.content.name}: depth ${game.depth}. Replace src/ui with a real renderer.`;
  }
}
