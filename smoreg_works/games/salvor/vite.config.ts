import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base: itch.io serves HTML5 builds from a subdirectory.
export default defineConfig({
  base: "./",
  // React is the view. It was the fourth of four when this line was written on
  // the other branch; the terminal, the graph and the hand-written DOM screen
  // went with the merge that brought it here.
  plugins: [react()],
  build: { target: "es2020", assetsInlineLimit: 0, sourcemap: false },
  resolve: { conditions: ["development", "import"] },
  // Audio lives in the monorepo's shared assets/, two levels up, and
  // src/ui/{music,sfx}.ts import it by path so the bundler hashes and copies it
  // like any other asset. The build works that out on its own; the dev server
  // refuses to serve outside its root unless told, and telling it beats relying
  // on it inferring the workspace.
  server: { fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
});
