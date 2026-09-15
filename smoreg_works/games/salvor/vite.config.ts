import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base: itch.io serves HTML5 builds from a subdirectory.
export default defineConfig({
  base: "./",
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
