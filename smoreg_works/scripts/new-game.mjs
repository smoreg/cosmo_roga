#!/usr/bin/env node
/**
 * Scaffold a new game from games/_template.
 *
 *   npm run new-game -- <id> ["Display Name"]
 *
 * Copies the template, substitutes the placeholders, and reminds you to run
 * `npm install` so the workspace link is created.
 */
import { cp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , rawId, rawName] = process.argv;

if (!rawId) {
  console.error("usage: npm run new-game -- <id> [\"Display Name\"]");
  process.exit(1);
}

const id = rawId.trim();
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`invalid id "${id}": use lowercase letters, digits and dashes, starting with a letter`);
  process.exit(1);
}

const name = (rawName ?? id).trim();
const target = join(root, "games", id);

if (existsSync(target)) {
  console.error(`games/${id} already exists — pick another id or delete it first`);
  process.exit(1);
}

await cp(join(root, "games", "_template"), target, { recursive: true });

async function substitute(dir) {
  for (const entry of await readdir(dir)) {
    const path = join(dir, entry);
    if ((await stat(path)).isDirectory()) {
      await substitute(path);
      continue;
    }
    const text = await readFile(path, "utf8");
    const replaced = text.replaceAll("__GAME_ID__", id).replaceAll("__GAME_NAME__", name);
    if (replaced !== text) await writeFile(path, replaced);
  }
}
await substitute(target);

console.log(`created games/${id} ("${name}")

next:
  npm install                    # links the workspace
  npm run dev -w games/${id}     # start it
  npm test                       # the new game's smoke tests run too`);
