import { defineConfig } from "vite";

// itch.io serves an HTML5 build from a subdirectory, so `base` must be relative.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  resolve: {
    // Prefer the engine's TypeScript sources: no build step between editing the
    // engine and seeing the change in the browser.
    conditions: ["development", "import"],
  },
});
