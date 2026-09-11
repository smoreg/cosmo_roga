// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import storybook from "eslint-plugin-storybook";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier/flat";
import house from "./eslint-rules/index.js";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "storybook-static",
      "coverage",
      "node_modules",
      "public",
      /* Vendored verbatim from vuvko_works/geomorph-core.js. It is someone
         else's code in someone else's style; linting it would only invite
         edits that the next sync would throw away. */
      "src/vendor/geomorph-core.js",
    ],
  },

  js.configs.recommended,

  /* Type-aware rules, scoped to TS only. Linting config files with type
     information is the usual cause of a slow lint, so they get the untyped
     fallback below instead. */
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { house },
    rules: {
      /* The rules engine is one big set of discriminated unions. This is the
         highest-value rule in the list: a new event or command kind becomes a
         compile-time error at every place that switches on it. */
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: true },
      ],
      /* With noUncheckedIndexedAccess on, `!` is the tempting way to silence the
         new `undefined` instead of handling it. This closes that door. */
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],

      /* `verbatimModuleSyntax` in tsconfig already enforces `import type`, so
         consistent-type-imports is deliberately NOT enabled — the two
         double-report on the same import. */

      /* The lambda policy. Logic is written as named function declarations;
         arrows are for short inline callbacks doing something not already
         named. A lambda that wraps an existing function is an error, and so is
         one whose body has been written out somewhere else already. */
      "func-style": ["error", "declaration", { allowArrowFunctions: false }],
      "house/no-wrapper-lambda": "error",
      "house/no-duplicate-lambda": ["error", { minNodes: 4 }],
      "prefer-arrow-callback": "off",

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  { files: ["**/*.{js,cjs,mjs}"], extends: [tseslint.configs.disableTypeChecked] },

  /* The architectural boundary. src/core is the rules engine: pure, seeded and
     replayable. If it can reach the DOM or a component it stops being any of
     those, so the import graph is enforced rather than described. */
  {
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "core", pattern: "src/core/**" },
        { type: "stores", pattern: "src/stores/**" },
        { type: "hooks", pattern: "src/hooks/**" },
        { type: "render", pattern: "src/render/**" },
        { type: "atoms", pattern: "src/components/atoms/**" },
        { type: "molecules", pattern: "src/components/molecules/**" },
        { type: "organisms", pattern: "src/components/organisms/**" },
        { type: "pages", pattern: "src/pages/**" },
        { type: "app", pattern: "src/*" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: [{ element: { type: "core" } }],
              disallow: [
                { to: { element: { type: "stores" } } },
                { to: { element: { type: "hooks" } } },
                { to: { element: { type: "render" } } },
                { to: { element: { type: "atoms" } } },
                { to: { element: { type: "molecules" } } },
                { to: { element: { type: "organisms" } } },
                { to: { element: { type: "pages" } } },
                { to: { element: { type: "app" } } },
              ],
              message:
                "src/core is the rules engine: pure, seeded, replayable. It may not reach outward.",
            },
            {
              from: [{ element: { type: "render" } }],
              disallow: [
                { to: { element: { type: "atoms" } } },
                { to: { element: { type: "molecules" } } },
                { to: { element: { type: "organisms" } } },
                { to: { element: { type: "pages" } } },
                { to: { element: { type: "stores" } } },
              ],
              message: "The map renderer draws; it does not know about React components or stores.",
            },
            {
              from: [{ element: { type: "atoms" } }],
              disallow: [
                { to: { element: { type: "molecules" } } },
                { to: { element: { type: "organisms" } } },
                { to: { element: { type: "pages" } } },
              ],
              message: "An atom is a single element: it cannot reach up the tree.",
            },
            {
              from: [{ element: { type: "molecules" } }],
              disallow: [
                { to: { element: { type: "organisms" } } },
                { to: { element: { type: "pages" } } },
              ],
              message: "A molecule composes atoms, not organisms.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "src/core is pure: no DOM." },
        { name: "document", message: "src/core is pure: no DOM." },
        { name: "navigator", message: "src/core is pure: no DOM." },
        { name: "localStorage", message: "src/core is pure: no DOM." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react-dom/*", "zustand", "zustand/*"],
              message: "src/core must stay free of React and of stores.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["src/components/**/*.tsx", "src/pages/**/*.tsx", "src/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs["recommended-latest"].rules },
  },

  ...storybook.configs["flat/recommended"],

  /* Tests and stories repeat small shapes on purpose; fixtures are clearer
     spelled out than factored into helpers. */
  {
    files: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.stories.tsx",
      "src/stories/**",
      "tests/**",
    ],
    rules: {
      "house/no-duplicate-lambda": "off",
      "func-style": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  {
    files: ["*.config.ts", "*.config.js", ".storybook/**", "eslint-rules/**", "scripts/**"],
    languageOptions: { globals: globals.node },
    rules: { "func-style": "off", "house/no-duplicate-lambda": "off" },
  },

  /* Last: turns off everything that would argue with Prettier. */
  prettier,
);
