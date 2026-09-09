import type { Command } from "@jamrog/engine";
import type { ModuleId } from "../content/modules.js";
import { findSlot, type Rig } from "../twist/rig.js";

/**
 * Everything a key press can mean. `missing` is the one case the sim never
 * hears about: the key names a module that is not in the rack, which costs no
 * turn and only writes a line to the log.
 */
export type UiIntent =
  | { kind: "command"; cmd: Command }
  | { kind: "help" }
  | { kind: "restart" }
  | { kind: "dismiss" }
  | { kind: "missing"; module: ModuleId }
  /** Walk on until something is worth a decision. src/ui/auto.ts owns the rules. */
  | { kind: "explore" }
  /** One turn of autofight: a swing, or a step towards the nearest machine. */
  | { kind: "fight" }
  | { kind: "none" };

/**
 * The shape of a KeyboardEvent this module actually reads. Typing it this way
 * keeps `toIntent` testable without a DOM — the key table is exactly the kind
 * of thing that breaks silently and is not noticed until a voter complains.
 */
export interface KeyLike {
  key: string;
  code?: string;
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
 * vi-keys + arrows + numpad, all three, always. Jam voters play with whatever
 * their hands know; a roguelike that only accepts one scheme loses ratings for
 * no design reason at all.
 */
const MOVES: Record<string, [number, number]> = {
  // vi
  h: [-1, 0], j: [0, 1], k: [0, -1], l: [1, 0],
  y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  // arrows
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  // numpad
  Numpad1: [-1, 1], Numpad2: [0, 1], Numpad3: [1, 1],
  Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad8: [0, -1], Numpad9: [1, -1],
};

/**
 * The top row now selects slots, so `5` no longer waits: only `.`, space and
 * the numpad's own 5 do. One key cannot both brace and fire slot five.
 */
const WAIT_KEYS = new Set([".", " "]);
const WAIT_CODES = new Set(["Numpad5", "Period", "Space"]);

/**
 * Letter keys that fire a module, whichever slot it happens to sit in.
 *
 * SPIKE is `K`, not the `k` of design-doc.md's key table: `k` is vi-north, and
 * the same table gives hjkl to movement two rows higher. One of the two has to
 * give, and it is not movement — a vi player whose north key opens doors has
 * lost the game's controls, while a module keeps its slot number `1`-`6` and
 * loses only a shortcut. Shift keeps the doc's mnemonic.
 */
const MODULE_KEYS: Record<string, ModuleId> = {
  s: "scanner",
  e: "emp",
  w: "welder",
  p: "cell",
  K: "spike",
};

/** How a module is named in a refusal line. Not the panel's own SHOUTED name. */
const MODULE_NOUNS: Record<ModuleId, string> = {
  cutter: "cutter",
  thrusters: "thrusters",
  scanner: "scanner",
  plating: "plating",
  cell: "power cell",
  emp: "EMP",
  welder: "welder",
  laser: "laser",
  spike: "spike",
  emitter: "emitter",
  baffle: "baffle",
};

export function missingModuleLine(module: ModuleId): string {
  return `No ${MODULE_NOUNS[module]} installed.`;
}

/**
 * `rig` is what turns `s` into a slot number. Without it — a run that has not
 * started — module keys simply do nothing.
 */
export function toIntent(e: KeyLike, rig?: Rig): UiIntent {
  // Codes win over keys: the numpad reports `key: "1"`, and `1` is now a slot.
  const move = (e.code !== undefined ? MOVES[e.code] : undefined) ?? MOVES[e.key];
  if (move) return { kind: "command", cmd: { kind: "move", dx: move[0], dy: move[1] } };

  if (WAIT_KEYS.has(e.key) || (e.code !== undefined && WAIT_CODES.has(e.code))) {
    return { kind: "command", cmd: { kind: "wait" } };
  }

  if (e.key.length === 1 && e.key >= "1" && e.key <= "6") {
    return { kind: "command", cmd: { kind: "use", slot: Number(e.key) - 1 } };
  }

  const module = MODULE_KEYS[e.key];
  if (module !== undefined) {
    const slot = rig ? findSlot(rig, module) : null;
    if (slot === null) return { kind: "missing", module };
    return { kind: "command", cmd: { kind: "use", slot } };
  }

  if (e.key === "o") return { kind: "explore" };
  if (e.key === "Tab") return { kind: "fight" };
  if (e.key === "g") return { kind: "command", cmd: { kind: "interact" } };
  if (e.key === ">") return { kind: "command", cmd: { kind: "descend" } };
  if (e.key === "?") return { kind: "help" };
  if (e.key === "Escape") return { kind: "dismiss" };
  if (e.key === "r" && (e.ctrlKey === true || e.metaKey === true)) return { kind: "none" }; // browser reload
  if (e.key === "R") return { kind: "restart" };
  return { kind: "none" };
}

export const KEY_HELP: readonly string[] = [
  "MOVE      hjkl yubn / arrows / numpad",
  "WAIT      . or space   (braces: PLATING)",
  "ATTACK    walk into it",
  "SALVAGE   g   wreck under or beside you",
  "SCANNER   s   pulse: wide sweep, loud",
  "EMP       e   stun adjacent machines",
  "WELDER    w   mend the weakest module",
  "CELL      p   power a bulkhead or console",
  "SPIKE     K   breach a lock, two turns, quiet",
  "EMITTER   1-6 shoot the nearest, range 6",
  "SLOT      1-6 fire that slot directly",
  "DESCEND   >   on the hatch",
  "EXPLORE   o   walk on; stops on anything new",
  "AUTOFIGHT tab close on the nearest machine",
  "HELP      ?   RESTART shift+R  CLOSE esc",
];

/** The one rule the game is built on. Voters read this before they read a wiki. */
export const RULE_HELP: readonly string[] = [
  "A blow lands on the module you just used —",
  "the one marked ◀. Nothing exposed? It hits",
  "PLATING, then CORE. At 0 a module burns out.",
  "A burned module leaves an empty slot, and an",
  "empty slot is the only place salvage fits: g.",
];

/**
 * The title card. Plain text, like the other two blocks the renderer draws,
 * so it can be read by a test that has no DOM.
 *
 * Six lines: the pitch from design-doc.md, the keys, and the one instruction.
 * That first key press is also the gesture a browser wants before it will let
 * anything play sound.
 */
export const TITLE_LINES: readonly string[] = [
  "SALVOR",
  "A repair drone, alone on a dead station.",
  "You have no hit points. You have modules.",
  "Every hit lands on whatever you just used.",
  "arrows/hjkl move · bump attack · g salvage · s scan · o explore · Tab fight · K breach",
  "any key to start",
];
