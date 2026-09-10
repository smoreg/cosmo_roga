import { describe, it, expect } from "vitest";
import { ownFailure } from "../src/ui/crashguard.js";

/**
 * The crash card belongs to the game's own failures. A browser extension that
 * throws into the page must not end a healthy run — the owner met exactly that
 * on 10.09: `evaluating 'e.useCache'`, a property no file in this repository
 * has ever carried.
 */
const HERE = "https://smoreg.dev";

describe("whose error the crash card answers for", () => {
  it("owns a failure in a file served beside the page", () => {
    expect(ownFailure({ filename: `${HERE}/salvor/assets/index-abc.js` }, HERE)).toBe(true);
    expect(ownFailure({ filename: "index-abc.js" }, HERE)).toBe(true);
  });

  it("disowns every browser extension", () => {
    for (const file of [
      "safari-extension://1234/injected.js",
      "chrome-extension://abcd/content.js",
      "moz-extension://abcd/content.js",
    ]) {
      expect(ownFailure({ filename: file }, HERE), file).toBe(false);
    }
  });

  it("disowns a foreign site's script", () => {
    expect(ownFailure({ filename: "https://cdn.example.com/tracker.js" }, HERE)).toBe(false);
  });

  it("reads the stack when the event names no file", () => {
    const mine = `TypeError: x\n    at hexSvgOf (${HERE}/salvor/assets/index-abc.js:2:3)`;
    const theirs = "TypeError: undefined is not an object\n    at safari-extension://a/b.js:1:1";
    expect(ownFailure({ stack: mine }, HERE)).toBe(true);
    expect(ownFailure({ stack: theirs }, HERE)).toBe(false);
  });

  it("disowns the masked cross-origin error and owns a bare one", () => {
    expect(ownFailure({ message: "Script error." }, HERE)).toBe(false);
    expect(ownFailure({ message: "Cannot read properties of undefined" }, HERE)).toBe(true);
    expect(ownFailure({}, HERE)).toBe(true);
  });
});
