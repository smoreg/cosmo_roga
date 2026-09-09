import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The page the build wraps around the game.
 *
 * Nothing here runs the bundler — a jam is no place to spend a minute of test
 * time on `vite build`. What it checks is the half that breaks silently: a
 * missing favicon is a 404 in every voter's console, and a link written as an
 * absolute path works on localhost and breaks on itch.io, which serves the
 * build from a subdirectory.
 */

const game = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const read = (path: string): string => readFileSync(game(path), "utf8");

describe("the page around the game", () => {
  it("ships a favicon and points at it", () => {
    const icon = read("public/favicon.svg");
    expect(icon).toContain("<svg");
    expect(icon).toContain("</svg>");

    const html = read("index.html");
    expect(html).toMatch(/<link[^>]+rel="icon"[^>]*>/);
    expect(html).toContain('href="./favicon.svg"');
  });

  it("keeps every asset path relative", () => {
    // `base: "./"` in vite.config.ts rewrites what the bundler emits; the tags
    // this file writes by hand are the ones nothing rewrites.
    const html = read("index.html");
    for (const href of html.match(/(?:href|src)="([^"]+)"/g) ?? []) {
      if (href.includes('="/src/')) continue; // The dev entry point; the build replaces it.
      expect(href, href).not.toMatch(/="\//);
    }
  });

  it("names the game in the tab and mounts it where main.ts looks", () => {
    const html = read("index.html");
    expect(html).toContain("<title>SALVOR</title>");
    expect(html).toContain('id="game"');
    expect(read("src/main.ts")).toContain('getElementById("game")');
  });
});
