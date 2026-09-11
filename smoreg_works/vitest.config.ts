import { defineConfig } from "vitest/config";

/**
 * One test run across the whole monorepo. Engine tests prove the reusable
 * parts; each game's tests prove that game's content and balance.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "games/*/tests/**/*.test.ts"],
    // _template is a scaffold, not a game: its files still hold placeholders.
    // fortnight2 is frozen (jam entry nobody touches) and its suite eats a third
    // of the run; salvor is the live game.
    exclude: ["**/node_modules/**", "games/_template/**", "games/fortnight2/**"],
  },
});
