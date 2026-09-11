import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  test: {
    projects: [
      {
        /* The rules engine: pure, no DOM, deterministic. */
        test: {
          name: "core",
          environment: "node",
          include: ["src/core/**/*.test.ts", "src/vendor/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "components",
          environment: "jsdom",
          include: [
            "src/components/**/*.test.tsx",
            "src/stores/**/*.test.ts",
            "src/pages/**/*.test.tsx",
            "src/hooks/**/*.test.tsx",
            "src/hooks/**/*.test.ts",
          ],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**"],
      exclude: ["src/**/*.stories.tsx", "src/main.tsx", "src/**/*.d.ts"],
      thresholds: {
        lines: 60,
        branches: 55,
        /* The core is pure and cheap to test exhaustively, and a bug there is a
           gameplay bug. It is held to a different standard than React chrome. */
        "src/core/**": { lines: 90, branches: 85, functions: 90, statements: 90 },
      },
    },
  },
});
