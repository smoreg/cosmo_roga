import { describe, it, expect } from "vitest";
import type { Point } from "@jamrog/engine";
import { describeFailure, fuzz, seedRange } from "@jamrog/engine/testing";
import { GAME_CONFIG } from "../src/game.js";

/**
 * A hundred thousand commands nobody would ever type, against the real game.
 *
 * The bot presses keys for modules it does not own, descends where there is no
 * hatch and walks into walls, which is exactly what a jam voter does in their
 * first minute. Anything thrown here would reach them as a dead black page, so
 * this test is the one that decides whether the build is shippable at all.
 *
 * A failure prints `seed` and the command list: `replay(seed, inputs,
 * GAME_CONFIG)` reproduces it exactly, and `?seed=N` opens it in the browser.
 */
describe("the whole game under random input", () => {
  it("survives 200 runs of 500 commands without throwing", () => {
    const seeds = seedRange(900000, 200);
    const failures = fuzz({ seeds, steps: 500, game: GAME_CONFIG });

    for (const f of failures) console.error(describeFailure(f));
    // The first stack in full: the one-liners above say which seeds, this says why.
    const detail = failures.length === 0 ? "" : `\n\nfirst failure:\n${failures[0]!.error}`;
    expect(failures.map(describeFailure), `${failures.length}/${seeds.length} seeds crashed${detail}`).toEqual([]);
  }, 300_000);

  /**
   * A random player dies on deck 1 in about twenty turns, so the run above
   * barely leaves the docking bay. The same bot with a core it cannot lose
   * spends all 500 commands: it descends, fires modules at nothing, walks the
   * reactor, and wins. That is where the code the first case never reaches
   * lives, and the twist is untouched — only the core is.
   */
  it("survives them again with a player that cannot die, all six decks deep", () => {
    // Half the seeds of the first case: every one of these runs the full 500
    // commands, so this is already the more expensive half of the file.
    const seeds = seedRange(700000, 100);
    const content = {
      ...GAME_CONFIG.content,
      makePlayer: (pos: Point) => {
        const p = GAME_CONFIG.content.makePlayer(pos);
        p.hp = 9999;
        p.hpMax = 9999;
        return p;
      },
    };
    const failures = fuzz({ seeds, steps: 500, game: { ...GAME_CONFIG, content } });

    for (const f of failures) console.error(describeFailure(f));
    const detail = failures.length === 0 ? "" : `\n\nfirst failure:\n${failures[0]!.error}`;
    expect(failures.map(describeFailure), `${failures.length}/${seeds.length} seeds crashed${detail}`).toEqual([]);
  }, 300_000);
});
