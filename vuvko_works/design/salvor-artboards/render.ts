/**
 * SALVOR's own screens, written out as standalone pages.
 *
 * The point is a set of artboards that can be reworked in Claude Design, and
 * the one rule they have to obey is the one `docs/tasks/G61-web-design.md`
 * recorded when artboards were used here before: markup with words baked into
 * it must never become a second source of truth beside `t()`. So this runs in
 * the only safe direction — code to picture. Every screen below is produced by
 * calling the game's own `screenHtml`, the same function `ui/web/mount.ts`
 * writes into the document, with the game's own CSS. Nothing is retyped, so
 * nothing can drift, and no file in `smoreg_works/` is touched to make it.
 */
import { newGame } from "../../../smoreg_works/games/salvor/src/game.js";
import {
  initialState,
  listOf,
  type AppState,
} from "../../../smoreg_works/games/salvor/src/ui/appstate.js";
import type { RoomGame } from "../../../smoreg_works/packages/engine/src/index.js";
import { NO_FLASH } from "../../../smoreg_works/games/salvor/src/ui/panel.js";
import { NOTHING_LIT } from "../../../smoreg_works/games/salvor/src/ui/pulse.js";
import { screenHtml, type MapKind } from "../../../smoreg_works/games/salvor/src/ui/web/screen.js";
import { WEB_CSS, WEB_ROOT_CLASS } from "../../../smoreg_works/games/salvor/src/ui/web/styles.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "pages");

/**
 * A few turns in, so the boards show a ship rather than an airlock.
 *
 * The moves come from `listOf`, which is the list the player is actually
 * offered, so this walks the game exactly as a pair of hands would rather than
 * reaching past the UI into the rules.
 */
function walk(game: RoomGame, state: AppState, steps: number): void {
  for (let step = 0; step < steps; step++) {
    const offered = listOf(game, state).filter(function usable(action) {
      return action.enabled;
    });
    /* A voyage opens at the tug, where there is nowhere to walk — the ship is
       reached by casting off, and until that is done every board is the hub. */
    const casting = offered.find(function leaving(action) {
      return /cast off/i.test(action.label);
    });
    const going = offered.find(function open(action) {
      return action.cmd.kind === "go";
    });
    const next = going ?? casting;
    game.playerCommand(next === undefined ? { kind: "wait" } : next.cmd);
  }
}

interface Board {
  readonly file: string;
  readonly title: string;
  /** What a designer should look at here, in one line. */
  readonly note: string;
  /** Which section of the Design System pane the card lands in. */
  readonly group: string;
  readonly map: MapKind;
  readonly state: (base: AppState) => AppState;
  /** How far in this board is. Zero is the moment of boarding. */
  readonly steps: number;
}

const SEED = "artboard-1";

const BOARDS: readonly Board[] = [
  {
    file: "01-title",
    group: "Screens",
    title: "Title",
    note: "Seven keyed rows, every one clickable. The whole start of the game.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "title" }),
    steps: 0,
  },
  {
    file: "02-tug",
    group: "Screens",
    title: "The tug",
    note: "The hub between runs. Rack left, actions right, no map at all.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "none" }),
    steps: 0,
  },
  {
    file: "03-derelict-graph",
    group: "Screens",
    title: "Aboard — graph map",
    note: "The default view. Map left, panel right, log along the bottom.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "none" }),
    steps: 14,
  },
  {
    file: "04-derelict-hex",
    group: "Screens",
    title: "Aboard — honeycomb",
    note: "The same screen with the hex map and the drawn hull under it.",
    map: "hex",
    state: (base) => ({ ...base, overlay: "none" }),
    steps: 14,
  },
  {
    file: "05-help",
    group: "Cards",
    title: "Help card",
    note: "A text card over the screen. Sized by column arithmetic today.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "help" }),
    steps: 14,
  },
  {
    file: "06-codex",
    group: "Cards",
    title: "Codex",
    note: "The reference card. Left list, right body.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "codex" }),
    steps: 14,
  },
  {
    file: "07-history",
    group: "Cards",
    title: "Log history",
    note: "The log opened full. Compare with the kit's expanding drawer.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "history" }),
    steps: 14,
  },
  {
    file: "08-lost",
    group: "Cards",
    title: "Ending — lost",
    note: "An ending banner and a run summary.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "lost" }),
    steps: 14,
  },
];

/** One page, standing on its own: no fonts to fetch, no script, no network. */
function page(board: Board, body: string): string {
  return [
    /* The pane reads its card index off the first line of each page. It sits
       ahead of the doctype by the tool's contract, so the page is served in
       quirks mode; everything below sets its own box model and lays out with
       grid, and the screenshots are identical either way. */
    `<!-- @dsCard group="${board.group}" -->`,
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>SALVOR — ${board.title}</title>`,
    `<style>${WEB_CSS}</style>`,
    "<style>html,body{margin:0;background:#05080d;}</style>",
    "</head><body>",
    `<div class="${WEB_ROOT_CLASS}">${body}</div>`,
    "</body></html>",
  ].join("\n");
}

mkdirSync(out, { recursive: true });

const index: string[] = [];
for (const board of BOARDS) {
  const game = newGame(SEED, false);
  const base = initialState({ view: "web", sound: false, seed: game.seed });
  walk(game, { ...base, overlay: "none" }, board.steps);
  const state = board.state(base);
  const body = screenHtml(game, state, NO_FLASH.slots, NOTHING_LIT, board.map, false, true, false);
  writeFileSync(join(out, `${board.file}.html`), page(board, body), "utf8");
  index.push(`${board.file}.html — ${board.title}: ${board.note}`);
  console.log(`wrote ${board.file}.html  (${String(body.length)} bytes of markup)`);
}
writeFileSync(join(out, "INDEX.txt"), `${index.join("\n")}\n`, "utf8");
