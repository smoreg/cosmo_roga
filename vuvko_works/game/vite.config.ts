import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The commit this build came from, or "unknown" outside a checkout. */
function buildHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash()),
  },
});
