import type { RoomCommand, RoomId } from "@jamrog/engine";
import type { Key } from "../content/i18n/keys.js";
import { moduleName, type ModuleId } from "../content/modules.js";
import { t, tId } from "../i18n.js";
import { findSlot, type Rig } from "../twist/rig.js";
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
  /** Line `index` of the action list, counting from zero. */
  | { kind: "pick"; index: number }
  /** Move the highlight down the list by `delta`, wrapping at both ends. */
  | { kind: "cursor"; delta: number }
  /** Show where the drone can walk, or put the list back. Never a turn. */
  | { kind: "moves" }
  /** Do the line the highlight is on. */
  | { kind: "confirm" }
  | { kind: "command"; cmd: RoomCommand }
  /** A module by its letter. The reducer decides what it is aimed at. */
  | { kind: "module"; module: ModuleId; slot: number }
  /** The letter names a module this drone no longer carries: a line, no turn. */
  | { kind: "missing"; module: ModuleId }
  | { kind: "help" }
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
    const slot = rig ? findSlot(rig, module) : null;
    return slot === null ? { kind: "missing", module } : { kind: "module", module, slot };
  }

  // The cursor over the numbered list. `Enter` is the only key in the game that
  // does whatever the screen is pointing at rather than a verb of its own.
  if (e.key === "ArrowUp") return { kind: "cursor", delta: -1 };
  if (e.key === "ArrowDown") return { kind: "cursor", delta: 1 };
  if (e.key === "Enter") return { kind: "confirm" };

  // `l` was a direction on a grid this game no longer has, so both cases of it
  // are free for the one control that works on every screen there is.
  if (e.key === "l" || e.key === "L") return { kind: "language" };
  if (e.key === "o") return { kind: "explore" };
  if (e.key === "Tab") return { kind: "fight", melee: e.shiftKey === true };
  if (e.key === "?") return { kind: "help" };
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

export function ruleHelp(): string[] {
  return RULE_KEYS.map((k) => t(k));
}

export function listHelp(): string[] {
  return LIST_KEYS.map((k) => t(k));
}

export function charterHelp(): string[] {
  return CHARTER_KEYS.map((k) => t(k));
}

/**
 * The card's five blocks, in the order they are read: where you are and what to
 * do about it, the keys, the rule the twist is, what the numbered list is, and
 * what a charter is.
 */
function helpBlocks(onTug: boolean): string[][] {
  return [onTug ? tugHelp() : shipHelp(), keyHelp(), ruleHelp(), listHelp(), charterHelp()];
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
export function helpPages(onTug: boolean): string[][] {
  const blocks = helpBlocks(onTug);
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
