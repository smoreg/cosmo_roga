import { defineConfig } from "vite";

// Relative base: itch.io serves HTML5 builds from a subdirectory.
export default defineConfig({
  base: "./",
  build: { target: "es2020", assetsInlineLimit: 0, sourcemap: false },
  resolve: { conditions: ["development", "import"] },
});
