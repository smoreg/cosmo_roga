/**
 * Bundle `verify-ship.ts` against the other half's sources and run it.
 *
 * `smoreg_works` has no `node_modules` and installing into it is not this
 * half's business, so the two things its sources expect are supplied here
 * instead: the `@jamrog/engine` specifier is pointed at the package's own
 * entry, since that half ships raw TypeScript and has no build step, and
 * `rot-js` is stubbed because nothing on the path we render draws a display.
 * The `.js` specifiers are rewritten to the `.ts` files they mean, which is
 * what a bundler with `moduleResolution: bundler` does and esbuild alone does
 * not.
 */
/* esbuild lives in this half's game, which is the only workspace with
   installed dependencies; addressed directly rather than by bare specifier. */
const { build } = await import(
  new URL("../../game/node_modules/esbuild/lib/main.js", import.meta.url).href
);
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const salvor = resolve(here, "../../../smoreg_works");

const resolveTs = {
  name: "ts-behind-js",
  setup(builder) {
    builder.onResolve({ filter: /^rot-js$/ }, () => ({ path: join(here, "rot-js-stub.js") }));
    builder.onResolve({ filter: /^@jamrog\/engine$/ }, () => ({
      path: join(salvor, "packages/engine/src/index.ts"),
    }));
    builder.onResolve({ filter: /^@jamrog\/audio$/ }, () => ({
      path: join(salvor, "packages/audio/src/index.ts"),
    }));
    /* Vite turns `?url` into a hashed path at build time. Nothing here plays a
       sound, so the import is answered with the path it asked for. */
    builder.onResolve({ filter: /\?url$/ }, (args) => ({
      path: args.path,
      namespace: "asset-url",
    }));
    builder.onLoad({ filter: /.*/, namespace: "asset-url" }, (args) => ({
      contents: `export default ${JSON.stringify(args.path.replace(/\?url$/, ""))};`,
      loader: "js",
    }));
    builder.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind === "entry-point") return null;
      const asked = resolve(args.resolveDir, args.path);
      const asTs = `${asked.slice(0, -3)}.ts`;
      return existsSync(asTs) ? { path: asTs } : null;
    });
  },
};

const bundle = join(here, ".verify.mjs");
await build({
  entryPoints: [join(here, "verify-ship.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: bundle,
  plugins: [resolveTs],
  logLevel: "warning",
});
await import(pathToFileURL(bundle).href);
