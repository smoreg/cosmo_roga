import { describe, it, expect, afterEach } from "vitest";
import { BOTS_ROOMS, roomPlay, runBotOn, seedRange } from "@jamrog/engine/testing";
import { newGame, type SalvorGame } from "../src/game.js";
import { SHAPES, shipForm } from "../src/content/hullforms.js";
import { isTug } from "../src/content/tug.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import { initialState, type AppState } from "../src/ui/appstate.js";
import { helpPages, keyHelp } from "../src/ui/input.js";
import { endHint, endingBanners, runFigures, runSummary } from "../src/ui/render.js";
import { titleScreen } from "../src/ui/title.js";
import { tugBoard } from "../src/ui/tugboard.js";
import { voyageOf } from "../src/systems/voyage.js";
import { dockHtml } from "../src/ui/web/dock-html.js";
import { WebRenderer } from "../src/ui/web/mount.js";
import { screenHtml } from "../src/ui/web/screen.js";
import { FLYERS, skySvg } from "../src/ui/web/sky.js";
import { WEB_CSS } from "../src/ui/web/styles.js";
import { esc } from "../src/ui/web/xml.js";

/**
 * The festival pass on the graphic view (docs/tasks/G89-festival.md, B): the
 * start screen over a sky with the game's own hulls in it, the tug's board as
 * a dock, the end cards with their numbers set large, and the help card's keys
 * in a column. No browser: every part is a string, and what is measured is
 * that the strings say what the terminal says, in all three languages.
 */

afterEach(() => setLang(DEFAULT_LANG));

const playing: AppState = { ...initialState(), overlay: "none" };

/** Tags out, entities back: what a reader of the page sees of a fragment. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

// ------------------------------------------------------------------ the sky

describe("the sky behind the start screen", () => {
  it("is the same sky every time: seeded, never rolled", () => {
    expect(skySvg()).toBe(skySvg());
    expect(skySvg().match(/class="sky-star"/g)).toHaveLength(210);
  });

  it("flies a harpoon, a hammer and a whale, built by the game's own hull forms", () => {
    expect(FLYERS.map((f) => f.kind)).toEqual(["harpoon", "hammerboat", "whale"]);
    const sky = skySvg();
    const ships = sky.split('<g class="sky-ship').slice(1);
    expect(ships).toHaveLength(3);
    ships.forEach((ship, i) => {
      const flyer = FLYERS[i]!;
      const form = shipForm(flyer.kind, flyer.seed, 6, 2);
      expect(SHAPES[flyer.kind]).toBeDefined();
      // One skin per body the profile has, one bell per pod, one hexagon per cell.
      expect(ship.match(/class="sky-skin"/g), flyer.kind).toHaveLength(form.bodies.length);
      expect(ship.match(/class="sky-bell"/g), flyer.kind).toHaveLength(form.pods.length);
      const cells = /class="sky-cells" d="([^"]*)"/.exec(ship)![1]!;
      expect(cells.match(/M/g), flyer.kind).toHaveLength(form.cells.length);
      // Placed and turned where the flyer says, and drifting on a group inside that.
      expect(ship).toContain(`translate(${flyer.x} ${flyer.y}) rotate(${flyer.heading})`);
      expect(ship).toContain(`class="sky-drift" style="animation-duration:${flyer.period}s`);
    });
  });

  it("says nothing: not a letter of it is text", () => {
    expect(text(skySvg()).trim()).toBe("");
  });

  it("drifts, and holds still for anyone who asked for less motion", () => {
    expect(WEB_CSS).toMatch(/\.sky-drift\{animation:salvor-drift /);
    expect(WEB_CSS).toContain("@keyframes salvor-drift");
    expect(WEB_CSS).toContain("@media (prefers-reduced-motion: reduce){.sky-drift{animation:none;}}");
  });
});

// ---------------------------------------------------- the layer that keeps it

/** As much of an element as `WebRenderer` touches, counting writes to `innerHTML`. */
class FakeElement {
  className = "";
  hidden = false;
  writes = 0;
  readonly children: FakeElement[] = [];
  private html = "";
  constructor(readonly ownerDocument: FakeDocument) {}
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(value: string) {
    this.html = value;
    this.writes++;
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  addEventListener(): void {}
  querySelector(): null {
    return null;
  }
  set textContent(_value: string) {}
}

class FakeDocument {
  readonly head = new FakeElement(this);
  createElement(): FakeElement {
    return new FakeElement(this);
  }
}

describe("the sky is a layer the frames do not rewrite", () => {
  it("is built once, shown on the title only, and every frame writes past it", () => {
    const doc = new FakeDocument();
    const mount = new FakeElement(doc);
    const renderer = new WebRenderer(mount as unknown as HTMLElement, () => {}, () => {});
    const root = mount.children[0]!;
    const [sky, frame] = root.children;
    expect(sky!.className).toBe("web-sky");
    expect(frame!.className).toBe("web-frame");
    expect(sky!.innerHTML).toBe(skySvg());

    const game = newGame(3);
    renderer.draw(game, initialState());
    expect(sky!.hidden).toBe(false);
    renderer.draw(game, { ...initialState(), cursor: 2 });
    renderer.draw(game, playing);
    expect(sky!.hidden).toBe(true);
    renderer.draw(game, initialState());
    expect(sky!.hidden).toBe(false);

    // Four frames went into the frame; the sky was written the once.
    expect(sky!.writes).toBe(1);
    expect(frame!.writes).toBe(4);
    expect(frame!.innerHTML).toBe(screenHtml(game, initialState(), new Set()));
    expect(WEB_CSS).toContain(".web-frame{display:contents;}");
  });
});

// ------------------------------------------------------------ the start screen

describe("the start screen, laid out as artboard 1a", () => {
  it("leaves its ground clear for the sky and frames every row with its key in a chip", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = newGame(11);
      const html = screenHtml(game, { ...initialState(), cursor: 1 }, new Set());
      const screen = titleScreen(initialState().settings);
      expect(html, lang).toContain('<div class="web-over is-title"><div class="card title">');
      for (const item of screen.items) {
        expect(html, `${lang} ${item.key}`).toContain(`<span class="title-key">${esc(item.key)}</span>`);
      }
      // The build at the foot and the controls beside it, in the bottom strip.
      const bottom = html.slice(html.indexOf('<div class="title-bottom">'));
      expect(bottom, lang).toContain(esc(screen.foot));
      expect(bottom, lang).toContain(esc(screen.keysHead));
      for (const line of screen.keys) expect(bottom, lang).toContain(esc(line));
      // The rows are the menu the game has, and no more.
      expect(html.match(/class="title-row/g), lang).toHaveLength(screen.items.length);
    }
  });

  it("keeps every other card on its dimmed ground", () => {
    const html = screenHtml(newGame(11), { ...playing, overlay: "help" }, new Set());
    expect(html).toContain('<div class="web-over"><div class="card">');
  });
});

// -------------------------------------------------------------------- the dock

/** Ships that went out and came back, as well as ones that never left. */
function tugsToCheck(): SalvorGame[] {
  const out: SalvorGame[] = seedRange(1, 30).map((seed) => newGame(seed));
  for (const seed of seedRange(1, 20)) {
    let game: SalvorGame | undefined;
    runBotOn(BOTS_ROOMS.careful!, seed, roomPlay({ maxSteps: 300, make: (s) => (game = newGame(s)) }));
    if (game !== undefined && isTug(game)) out.push(game);
  }
  return out;
}

describe("the dock says what the tug's board says", () => {
  const games = tugsToCheck();

  it("draws the dock where the schematic goes, and not the old block of text", () => {
    const html = screenHtml(games[0]!, playing, new Set());
    expect(html).toContain('<div class="dock">');
    expect(html).not.toContain("web-board");
  });

  it("carries every line of the board, in every language, on tugs fresh and flown", () => {
    for (const lang of LANGS) {
      setLang(lang);
      for (const game of games) {
        const html = dockHtml(game);
        const seen = text(html);
        for (const line of tugBoard(game)) {
          // A rack row is cut into its columns; every other line stands whole.
          for (const part of line.trim().split(/\s{2,}/)) {
            if (part.length > 0) expect(seen, `${lang} seed ${game.seed}: ${part}`).toContain(part);
          }
        }
        expect(html, `${lang} seed ${game.seed}`).toContain(esc(t("panel.credits", { n: voyageOf(game).credits })));
      }
    }
  });

  it("marks the drone's own hull on the rack, and only that one", () => {
    for (const game of games) {
      const rows = [...dockHtml(game).matchAll(/<div class="dock-row( is-yours)?">(.*?)<\/div>/g)];
      expect(rows, `seed ${game.seed}`).toHaveLength(3);
      const yours = rows.filter((r) => r[1] !== undefined);
      expect(yours, `seed ${game.seed}`).toHaveLength(voyageOf(game).hull === undefined ? 0 : 1);
    }
  });

  it("cuts a rack row into name, price and trait", () => {
    const game = games[0]!;
    const other = [...dockHtml(game).matchAll(/<div class="dock-row">(.*?)<\/div>/g)][0]![1]!;
    expect(other.match(/<span>/g)).toHaveLength(3);
  });
});

// ----------------------------------------------------------------- the endings

describe("the end cards set the run's numbers large", () => {
  it("says the title, the reason, five captioned numbers and what to press, in every language", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = newGame(5);
      for (const [overlay, ending] of Object.entries(endingBanners())) {
        const state = { ...playing, overlay } as AppState;
        const html = screenHtml(game, state, new Set());
        expect(html, `${lang} ${overlay}`).toContain(esc(ending!.title));
        if (ending!.why !== undefined) expect(html, `${lang} ${overlay}`).toContain(esc(ending!.why));
        expect(html, `${lang} ${overlay}`).toContain(esc(endHint(state.overlay)));
        const figures = runFigures(game);
        const cells = [...html.matchAll(/<span class="end-caption">(.*?)<\/span><span class="end-value">(\d+)<\/span>/g)];
        expect(cells.map((c) => text(c[1]!)), lang).toEqual([
          t("end.fig.cr"),
          t("end.fig.sold"),
          t("end.fig.rooms"),
          t("end.fig.turns"),
          t("end.fig.kills"),
          t("end.fig.burned"),
        ]);
        expect(cells.map((c) => Number(c[2])), lang).toEqual([
          figures.cr,
          figures.sold,
          figures.rooms,
          figures.turns,
          figures.kills,
          figures.burned,
        ]);
      }
    }
  });

  it("leaves the terminal's summary line word for word", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = newGame(9);
      expect(runSummary(game)).toBe(t("end.summary", runFigures(game)));
    }
  });
});

// ------------------------------------------------------------------- the help

describe("the help card lights its keys", () => {
  it("puts each key of the table in the accent and keeps every character and page", () => {
    for (const lang of LANGS) {
      setLang(lang);
      const game = newGame(2);
      const keys = keyHelp();
      const pages = helpPages(true);
      pages.forEach((page, at) => {
        const html = screenHtml(game, { ...playing, overlay: "help", helpPage: at }, new Set());
        for (const line of page.filter((l) => keys.includes(l))) {
          const row = `<div class="keys">`;
          const found = html.split(row).slice(1).map((r) => r.slice(0, r.indexOf("</div>")));
          const match = found.find((r) => text(r) === line);
          expect(match, `${lang} p${at}: ${line}`).toBeDefined();
          expect(match!.match(/<span class="press">/g), `${lang}: ${line}`).toHaveLength(1);
        }
      });
    }
  });
});
