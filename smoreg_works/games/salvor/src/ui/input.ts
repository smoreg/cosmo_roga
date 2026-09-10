import type { RoomCommand, RoomId } from "@jamrog/engine";
import type { Key } from "../content/i18n/keys.js";
import type { CodexEntry } from "../content/codex.js";
import { moduleName, type ModuleId } from "../content/modules.js";
import { t, tId } from "../i18n.js";
import { findSlotAs, type Rig } from "../twist/rig.js";
import { ACTION_KEYS } from "./actions.js";
import { SCREEN_HEIGHT } from "./theme.js";

/**
 * Everything a key press can mean.
 *
 * The list is the interface now: a number picks a line out of it, and the
 * letters are the handful of verbs that never appear there — brace, hide, the
 * modules, the way out. `hjkl` and the numpad are gone with the grid they moved
 * on (design-doc.md, "Клавиши").
 *
 * The arrows came back in G40, at the owner's request and against that same
 * section, which had left them dead on the grounds that a cursor would be a
 * second way to choose. It is — and after two playtests the first way had not
 * been found at all. What keeps this non-modal is that the cursor is not a
 * mode: `↑`/`↓` move a highlight, `Enter` does the line it is on, the digits
 * still work and take the highlight with them, and there is nothing a player
 * can reach with the cursor that they cannot reach without it.
 */
export type UiIntent =
  /** The line wearing digit `index`, counting from zero: what a key knows. */
  | { kind: "pick"; index: number }
  /**
   * Line `index` of the list as it is drawn, counting from zero: what a mouse
   * knows.
   *
   * A separate intent from `pick`, and the difference is the whole of
   * docs/tug-menu-audit.md, defect 6. A digit names a *key* and the list looks
   * up whichever row is wearing it, because the ten digits are a window that
   * moves; a click names a *row*, and there is nothing to look up. The two
   * agree on the compartment's own list, which is why the mouse borrowed the
   * digit for as long as it did — and part company one level down, where `0` is
   * the way back however few entries the level has. A click on `back` in a list
   * of five sent index 5, the reducer read it as the digit `5`, no row wore it,
   * and the page answered "nothing on that line" and stayed put.
   *
   * It also reaches the eleventh row and everything under it. The page draws
   * those — it scrolls, so it has no reason to hide its own tail — and until
   * now they were the one part of the screen nothing at all could press.
   */
  | { kind: "line"; index: number }
  /** Move the highlight down the list by `delta`, wrapping at both ends. */
  | { kind: "cursor"; delta: number }
  /**
   * Turn the page of the card in front of the board by `delta`: the sideways
   * arrows, and the only thing they do.
   *
   * A separate intent from `cursor` on purpose. The list behind an overlay is
   * not what the player is looking at, and `←`/`→` were dead keys precisely
   * because a second way to move a highlight is a second way to be surprised by
   * where it went (`docs/tasks/G40-tug-clarity.md`). With no card open this
   * still does nothing at all.
   */
  | { kind: "page"; delta: number }
  /** Show where the drone can walk, or put the list back. Never a turn. */
  | { kind: "moves" }
  /** Show the bulkheads of this compartment, or put the list back. Never a turn. */
  | { kind: "doors" }
  /** Weld shut the bulkhead the drone came through: the trap, in one key. */
  | { kind: "seal" }
  /** Do the line the highlight is on. */
  | { kind: "confirm" }
  | { kind: "command"; cmd: RoomCommand }
  /** A module by its letter. The reducer decides what it is aimed at. */
  | { kind: "module"; module: ModuleId; slot: number }
  /** The letter names a module this drone no longer carries: a line, no turn. */
  | { kind: "missing"; module: ModuleId }
  | { kind: "help" }
  /**
   * `i`: what is going on here — the card for whatever the game has just shown
   * and not explained (`content/codex.ts`). Never a turn, and never a step in
   * anything: the owner asked for the standard teaching mode, «хочет — читает,
   * не хочет — не читает».
   */
  | { kind: "codex" }
  /**
   * The message log as a card. `delta` is `1` for further back and `-1` for
   * nearer, which is what `PageUp` and `PageDown` mean everywhere else.
   */
  | { kind: "history"; delta: number }
  /** `L`, on any screen: round the ring of languages. Never a turn. */
  | { kind: "language" }
  | { kind: "restart" }
  | { kind: "dismiss" }
  /** Walk on until something is worth a decision. */
  | { kind: "explore" }
  /** Spend a keycard on a lock in this compartment. */
  | { kind: "keycard" }
  /** `<`: out through the airlock, or the walk to it. Never both at once. */
  | { kind: "exit" }
  /**
   * A compartment on the schematic, clicked. The mouse's only word of its own,
   * and it says exactly what that compartment's row of the move list says —
   * walk there, step there, or open the bulkhead in the way.
   */
  | { kind: "room"; id: RoomId }
  /** One turn of closing in. `melee` never fires the emitter: shift+tab. */
  | { kind: "fight"; melee: boolean }
  | { kind: "none" };

/**
 * The shape of a KeyboardEvent this module actually reads. Typing it this way
 * keeps `toIntent` testable without a DOM — the key table is exactly the kind
 * of thing that breaks silently and is not noticed until a voter complains.
 */
export interface KeyLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Keys that are only half a key press: nothing but a modifier is held down. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

/**
 * A press the game must not read at all: a bare modifier, or a browser chord.
 *
 * It matters most on the title card, where any key starts the run — shift held
 * down before `R` is not "any key", and neither is the ctrl of a ctrl+T the
 * player meant for their browser.
 */
export function isChord(e: KeyLike): boolean {
  return MODIFIER_KEYS.has(e.key) || e.ctrlKey === true || e.metaKey === true;
}

/**
 * `` ` ``: the owner's debug overlay, on or off (`ui/debug.ts`, G68).
 *
 * Read the same way `isViewKey` (`ui/view.ts`) is — before `toIntent`, so the
 * key never becomes a `UiIntent` and never reaches `appReducer`. It has to be
 * decided this early for the same reason `V` is: it is not a turn, has no
 * effect the sim needs to know about, and `appReducer`'s switch over
 * `UiIntent["kind"]` is exhaustive with no default, so a member added there
 * for one DOM-only toggle would demand a case in a file this task does not own.
 */
export function isDebugKey(e: KeyLike): boolean {
  return e.key === "`";
}

/** Brace: wait a turn with the plating towards the room. */
const WAIT_KEYS = new Set([".", " "]);
const WAIT_CODES = new Set(["Period", "Space"]);

/**
 * Letter keys that fire a module, whichever slot it happens to sit in.
 *
 * SPIKE is `K` rather than `k`, and the doc's own table says why: `k` is the
 * key a roguelike player's hand goes to for north, and a game that has no north
 * is better off leaving it dead than making it open doors. The rest are the
 * doc's mnemonics unchanged (design-doc.md, "Клавиши").
 */
const MODULE_KEYS: Record<string, ModuleId> = {
  s: "scanner",
  e: "emp",
  w: "welder",
  p: "cell",
  K: "spike",
  f: "emitter",
  c: "cutter",
};

/**
 * Modules that are also a way through a door, and the verb that spends them on
 * one. A letter aims at the door the action list is already showing (see
 * `appReducer`): with a bulkhead in front of it `p` powers that bulkhead, and
 * with none it does what the module does anywhere else.
 */
export const DOOR_USE: Partial<Record<ModuleId, string>> = {
  cell: "power",
  spike: "spike",
  cutter: "cut",
  welder: "weld",
};

/**
 * How a module is named in a refusal line. Not the panel's own SHOUTED name:
 * `No power cell installed.` reads like a sentence and `No CELL installed.`
 * reads like a system message, and this is the line a player meets by pressing
 * the key of a module that has burned.
 */
export function moduleNoun(module: ModuleId): string {
  return tId("noun", module, moduleName(module).toLowerCase());
}

export function missingModuleLine(module: ModuleId): string {
  return t("why.module.notInstalled", { module: moduleNoun(module) });
}

/**
 * `rig` is what turns `s` into a slot number. Without it — a run that has not
 * started — a module key says the module is missing, which is true.
 */
export function toIntent(e: KeyLike, rig?: Rig): UiIntent {
  const pick = ACTION_KEYS.indexOf(e.key);
  if (e.key.length === 1 && pick >= 0) return { kind: "pick", index: pick };

  if (WAIT_KEYS.has(e.key) || (e.code !== undefined && WAIT_CODES.has(e.code))) {
    return { kind: "command", cmd: { kind: "wait" } };
  }
  if (e.key === "h") return { kind: "command", cmd: { kind: "hide" } };
  // `m` for move: where the drone can walk, as a list of compartments
  // (docs/tasks/G48-travel-to-a-room.md). Walking is the commonest thing
  // anybody does aboard a hull and it had no key at all — only a number among
  // the wreckage and the bodies, and a different number every turn.
  //
  // The letter is free and outside the rose this file keeps dead: `m` is not on
  // `hjkl`/`yubn`, and it is not a module. It is deliberately not a direction —
  // there are none on a graph — it names a destination, and one press opens the
  // list while the next, or `Esc`, or `0`, puts the compartment back.
  if (e.key === "m") return { kind: "moves" };
  // `d` for the doors, and `D` for the one thing worth its own key among them
  // (docs/tasks/G64-door-hotkeys.md). Both letters were free, and neither is on
  // the `hjkl`/`yubn` rose this file keeps dead.
  //
  // A compartment has up to four bulkheads and the letters aim at one of them —
  // whichever the rules offer first, which with two doors in the room is a
  // guess (`ui/appstate.ts`, `aimed`). `d` names them instead: one row each,
  // what state it is in, what can be done to it. `D` is the shortest way to say
  // the move the list is for — shut the way you came, and whatever was
  // following you is out of the run unless it can cut.
  if (e.key === "d") return { kind: "doors" };
  if (e.key === "D") return { kind: "seal" };
  // `<` is "get out", and where the drone is standing decides what that costs:
  // at the airlock it casts off, anywhere else it walks there and stops at the
  // first thing worth a decision (docs/tasks/G48-travel-to-a-room.md). One key,
  // because "leave" and "head for the exit" are one intention.
  if (e.key === "<") return { kind: "exit" };
  // The keycard has a letter of its own because it is not a module and cannot
  // borrow one: the action list numbers the first way through a lock it can do
  // and letters the rest, and the card is offered last on purpose
  // (`systems/doors.ts`, `LOCKED_METHODS`). Without a letter the one method
  // that is silent and costs no integrity would be unreachable whenever the
  // rack still carries a cell or a torch.
  //
  // `a` for access, and not the `y` a card would otherwise want: `y` is
  // north-west under a roguelike player's hand, and this file leaves the whole
  // `hjkl`/`yubn` rose dead for the same reason it gave the SPIKE `K` rather
  // than `k` (design-doc.md, "Клавиши").
  if (e.key === "a") return { kind: "keycard" };

  const module = MODULE_KEYS[e.key];
  if (module !== undefined) {
    // Or a relic that answers for it: `c` aims the blade the way it aims a cutter.
    const slot = rig ? findSlotAs(rig, module) : null;
    return slot === null ? { kind: "missing", module } : { kind: "module", module, slot };
  }

  // The cursor over the numbered list. `Enter` is the only key in the game that
  // does whatever the screen is pointing at rather than a verb of its own.
  if (e.key === "ArrowUp") return { kind: "cursor", delta: -1 };
  if (e.key === "ArrowDown") return { kind: "cursor", delta: 1 };
  // The sideways pair, which the grid left dead and the `i` card claims: they
  // turn its page and touch nothing else on any screen (G72).
  if (e.key === "ArrowLeft") return { kind: "page", delta: -1 };
  if (e.key === "ArrowRight") return { kind: "page", delta: 1 };
  if (e.key === "Enter") return { kind: "confirm" };

  // `l` was a direction on a grid this game no longer has, so both cases of it
  // are free for the one control that works on every screen there is.
  if (e.key === "l" || e.key === "L") return { kind: "language" };
  if (e.key === "o") return { kind: "explore" };
  if (e.key === "Tab") return { kind: "fight", melee: e.shiftKey === true };
  if (e.key === "?") return { kind: "help" };
  // `i` for information, and it was free: it is not on the `hjkl`/`yubn` rose
  // this file keeps dead, and it is not a module letter (`MODULE_KEYS`). One
  // press opens the card the badge in the corner is counting, the arrows page
  // through the rest, and `esc` — or the same key again — puts it away.
  if (e.key === "i") return { kind: "codex" };
  // `PageUp` into the log's own past, `PageDown` back towards now. Both keys
  // were dead, the log keeps two hundred lines and the screen shows seven of
  // them, and the view that starts is the one with no scrollbar at all
  // (docs/gui-guides.md, §5, "Lookback").
  if (e.key === "PageUp") return { kind: "history", delta: 1 };
  if (e.key === "PageDown") return { kind: "history", delta: -1 };
  if (e.key === "Escape") return { kind: "dismiss" };
  if (e.key === "r" && (e.ctrlKey === true || e.metaKey === true)) return { kind: "none" }; // browser reload
  if (e.key === "R") return { kind: "restart" };
  return { kind: "none" };
}

/**
 * The first paragraph of the help card, and the only one written twice.
 *
 * `?` is what a lost player presses, and the two places they can be lost in are
 * different games: four compartments that spend money, and a dead ship that
 * takes it back. Both blocks answer the same two questions in the same order —
 * where am I, what do I do next — because that is the order the owner asked
 * them in on the first playtest (docs/tasks/G40-tug-clarity.md, 6).
 */
const TUG_KEYS = ["help.where.tug.head", "help.where.tug.1", "help.where.tug.2"] as const satisfies readonly Key[];

const SHIP_KEYS = [
  "help.where.ship.head",
  "help.where.ship.1",
  "help.where.ship.2",
  // The one mark on the schematic that is not a label: what `⌂` is, said in
  // the block a player reads while standing in the ship it hangs off.
  "help.where.ship.3",
] as const satisfies readonly Key[];

export function tugHelp(): string[] {
  return TUG_KEYS.map((k) => t(k));
}

export function shipHelp(): string[] {
  return SHIP_KEYS.map((k) => t(k));
}

/**
 * The keys table, as pairs: the name column and the line that explains it.
 *
 * Two rows rather than one string, because the name column is a column — the
 * card is read down it — and a translation that folded the two together would
 * be one that has to count spaces. The module rows take their names from the
 * rack itself, so the letter a player reads here and the word on the panel can
 * never come out as two different names for one module.
 */
const NAME_W = 10;

const KEY_ROWS = [
  ["help.name.act", "help.key.act"],
  ["help.name.pick", "help.key.pick"],
  ["help.name.brace", "help.key.brace"],
  ["help.name.hide", "help.key.hide"],
  ["help.name.move", "help.key.move"],
  ["help.name.doors", "help.key.doors"],
  ["help.name.seal", "help.key.seal"],
  ["help.name.explore", "help.key.explore"],
  ["help.name.engage", "help.key.engage"],
  ["module.scanner", "help.key.scanner"],
  ["module.emp", "help.key.emp"],
  ["module.welder", "help.key.welder"],
  ["module.cell", "help.key.cell"],
  ["module.spike", "help.key.spike"],
  ["module.emitter", "help.key.emitter"],
  ["module.cutter", "help.key.cutter"],
  ["help.name.keycard", "help.key.keycard"],
  ["help.name.codex", "help.key.codex"],
  ["help.name.log", "help.key.log"],
  ["help.name.help", "help.key.help"],
] as const satisfies ReadonlyArray<readonly [Key, Key]>;

export function keyHelp(): string[] {
  // The gutter is spelled out rather than folded into `NAME_W`, because a name
  // may fill the column exactly — Russian «СБЛИЗИТЬСЯ» is ten of ten — and
  // `padEnd` then adds nothing, running the name into the keys beside it.
  return KEY_ROWS.map(([name, text]) => `${t(name).padEnd(NAME_W)} ${t(text)}`);
}

/** The one rule the game is built on. Voters read this before they read a wiki. */
const RULE_KEYS = [
  "help.rule.head", "help.rule.1", "help.rule.2", "help.rule.3", "help.rule.4", "help.rule.5",
] as const satisfies readonly Key[];

/**
 * What the numbered lines on the right are. Obvious once you have pressed one,
 * and the thing a voter is most likely to sit and stare at for five seconds
 * before they do.
 */
const LIST_KEYS = [
  "help.list.head", "help.list.1", "help.list.2", "help.list.3",
] as const satisfies readonly Key[];

/**
 * The tug's half of the game. It is four rooms and a list, so the only word
 * that needs explaining is the one on the contract.
 */
const CHARTER_KEYS = [
  "help.charter.head", "help.charter.1", "help.charter.2", "help.charter.3", "help.charter.4",
] as const satisfies readonly Key[];

/**
 * The five settings that live in the address bar and nowhere else.
 *
 * They all worked before this block existed and none of them was written down
 * outside the source: a voter who wants the music off, or a bug report worth
 * reproducing, had no way to find out that either was possible. Kyzrati's rule
 * for the options that sit outside the menu is that the help card is where a
 * player finds them (docs/gui-guides.md, "Что применить", C).
 *
 * Written as the query strings themselves rather than described, because that
 * is what has to be typed, and a description of a URL is a URL the reader now
 * has to guess.
 */
const URL_KEYS = [
  "help.url.head", "help.url.seed", "help.url.view", "help.url.sound", "help.url.training", "help.url.debug",
] as const satisfies readonly Key[];

export function ruleHelp(): string[] {
  return RULE_KEYS.map((k) => t(k));
}

export function urlHelp(): string[] {
  return URL_KEYS.map((k) => t(k));
}

export function listHelp(): string[] {
  return LIST_KEYS.map((k) => t(k));
}

export function charterHelp(): string[] {
  return CHARTER_KEYS.map((k) => t(k));
}

/**
 * The card's blocks, in the order they are read: where you are and what to do
 * about it, the keys, the rule the twist is, what the numbered list is, what a
 * charter is, the settings that live in the URL — and, last, everything this
 * voyage has already shown you.
 *
 * The URL block is next to last on purpose. It is the only one that is not
 * about the run in front of the reader, and a player pressing `?` in the middle
 * of a fight must not meet it first.
 *
 * `seen` is the titles of the cards `i` has to offer, already in the language
 * that is on (`ui/appstate.ts`, `codexSeen`). It is a block rather than a card
 * of its own because it is the answer to the same question `?` was pressed to
 * ask, one page further on: a player who read a card and wants it again has
 * nowhere else to look, and the badge is gone by then by design.
 *
 * Absent on a run that has met nothing, which is most of the first sortie: an
 * empty heading is a promise the card cannot keep.
 */
function helpBlocks(onTug: boolean, seen: readonly string[]): string[][] {
  const blocks = [
    onTug ? tugHelp() : shipHelp(),
    keyHelp(),
    ruleHelp(),
    listHelp(),
    charterHelp(),
    urlHelp(),
  ];
  if (seen.length > 0) blocks.push([t("help.codex.head"), ...seen.map((title) => ` ${title}`)]);
  return blocks;
}

/**
 * Rows a page of the help card may use for its body.
 *
 * Eight less than the screen, and the eight are the point: the frame, the
 * heading, the footer and four rows of air. The card used to be exactly as tall
 * as the screen — thirty-eight lines of body in a forty-two row frame — so
 * every key added to the game came down to a choice between the new line and an
 * old one, and G48 already spent that choice once by folding two rows together
 * to fit `m` in. A card that pages has no such arithmetic.
 */
export const HELP_ROWS = SCREEN_HEIGHT - 8;

/**
 * The card, cut into pages at block boundaries — never mid-block, because a
 * heading on one page and its lines on the next is worse than either.
 *
 * As few pages as the rows allow, and then balanced: with five blocks and two
 * pages the cut goes where the two halves are closest in height, so the second
 * page is a page and not an orphan line. The cap is walked upwards from the
 * ideal rather than computed, because five blocks is nothing to search and the
 * arithmetic that would replace the loop is arithmetic somebody has to read.
 */
export function helpPages(onTug: boolean, seen: readonly string[] = []): string[][] {
  const blocks = helpBlocks(onTug, seen);
  const total = blocks.reduce((n, b) => n + b.length, 0) + blocks.length - 1;
  const want = Math.max(1, Math.ceil(total / HELP_ROWS));
  for (let cap = Math.ceil(total / want); cap <= HELP_ROWS; cap++) {
    const pages = packed(blocks, cap);
    if (pages.length <= want) return pages;
  }
  return packed(blocks, HELP_ROWS);
}

/** Blocks laid into pages of at most `cap` rows, a blank row between them. */
function packed(blocks: readonly string[][], cap: number): string[][] {
  const pages: string[][] = [];
  for (const block of blocks) {
    const last = pages[pages.length - 1];
    if (last !== undefined && last.length + 1 + block.length <= cap) last.push("", ...block);
    else pages.push([...block]);
  }
  return pages;
}

/**
 * The line under every page: which page this is, and that `?` turns it. The
 * last page says `?` closes instead, because a key that means "next" on four
 * pages and "close" on the fifth has to say which it is doing.
 */
export function helpFooter(page: number, pages: number): string {
  const at = { n: page + 1, of: pages };
  return page + 1 < pages ? t("help.page.more", at) : t("help.page.last", at);
}

/** Lines the help card sets in the bright colour: the first of each block. */
export function helpHeadings(): string[] {
  return [
    t(TUG_KEYS[0]),
    t(SHIP_KEYS[0]),
    t(RULE_KEYS[0]),
    t(LIST_KEYS[0]),
    t(CHARTER_KEYS[0]),
    t(URL_KEYS[0]),
    t("help.codex.head"),
  ];
}

/**
 * The title card. Plain text, like the other blocks the renderer draws, so it
 * can be read by a test that has no DOM.
 *
 * Six lines: the name, the three of the pitch (design-doc.md, "Питч"), the
 * keys, and the one instruction. The pitch carries the loop as well as the
 * twist — a drone that burns is half the game, buying the next one is the other
 * half — because a voter who bounces off the title card never sees either.
 * That first key press is also the gesture a browser wants before it will let
 * anything play sound.
 */
const TITLE_KEYS = [
  "title.name", "title.pitch.1", "title.pitch.2", "title.pitch.3", "title.keys", "title.start",
] as const satisfies readonly Key[];

export function titleLines(): string[] {
  return TITLE_KEYS.map((k) => t(k));
}

// ------------------------------------------------ what is going on here (G72)

/**
 * Columns the `i` card wraps its prose to.
 *
 * Wide enough for a sentence to read as a sentence and narrow enough that the
 * frame around it still lands inside the terminal's ninety-five columns with
 * the padding `ui/render.ts` puts on every card. The lines are wrapped here
 * rather than in either renderer, so the graphic view and the terminal view
 * break them in the same places and `tests/codex.test.ts` can measure one and
 * mean both.
 */
export const CODEX_WIDTH = 52;

/**
 * The mark the badge and the card share, and the one glyph on the screen that
 * says which key this window belongs to. Not a word in any language, which is
 * why it is written once here rather than three times in the tables.
 */
const CARD_MARK = "[i]";

/** The name across the top of the card, with the key that opened it. */
export function codexHeading(entry: CodexEntry): string {
  return `${CARD_MARK} ${t(entry.title)}`;
}

/**
 * The body of the card: what this is, the move that costs, what answers it,
 * how to turn it if it can be turned, and one line of the world.
 *
 * `fitted` is the modules actually in the rack. It is the whole reason the
 * `helps` line is worth reading rather than skipping: the same card tells a
 * drone that carries a welder that it has the answer already, and one that does
 * not what it is looking for.
 */
export function codexBody(entry: CodexEntry, fitted: ReadonlySet<ModuleId>): string[] {
  const out = [...wrapped(t(entry.what))];
  out.push("");
  out.push(...wrapped(`${t("codex.label.wrong")} ${t(entry.wrong)}`));
  out.push(...wrapped(`${t("codex.label.helps")} ${helpsLine(entry, fitted)}`));
  if (entry.turn !== undefined) out.push(...wrapped(`${t("codex.label.turn")} ${t(entry.turn)}`));
  out.push("");
  out.push(...wrapped(t(entry.lore)));
  return out;
}

/** The modules that answer this, the ones in the rack marked, then the prose. */
function helpsLine(entry: CodexEntry, fitted: ReadonlySet<ModuleId>): string {
  const modules = (entry.modules ?? []).map((id) =>
    fitted.has(id) ? `${moduleName(id)} ${t("codex.fitted")}` : moduleName(id),
  );
  const prose = t(entry.helps);
  return modules.length === 0 ? prose : `${modules.join(", ")}. ${prose}`;
}

/**
 * The line under the card: which of them this is, and that the arrows turn the
 * page. A single card says only how to close, for the reason `helpFooter` does
 * — a key named as "next" with nothing next to go to is a key that lies.
 */
export function codexFooter(page: number, pages: number): string {
  const at = { n: page + 1, of: pages };
  return pages > 1 ? t("codex.footer.more", at) : t("codex.footer.last", at);
}

/** One line broken to `CODEX_WIDTH`, on spaces. A blank line stays a blank line. */
function wrapped(text: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= CODEX_WIDTH) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
  return out;
}
