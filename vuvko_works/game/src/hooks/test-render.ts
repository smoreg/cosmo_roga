/**
 * Run a hook in a real React tree, with no test library.
 *
 * The project renders components in tests with `createRoot` and `act`; this is
 * the same thing with a component that exists only to call the hook, so a hook
 * can be tested without inventing a component per test file.
 */
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

export function renderHook(use: () => void): { unmount: () => void } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    use();
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    unmount() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}
