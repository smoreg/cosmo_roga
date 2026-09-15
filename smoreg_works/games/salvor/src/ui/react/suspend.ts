import { SAVE_VERSION, decodeRun, encodeRun, type RoomCommand, type RoomGame } from "@jamrog/engine";
import { newGame, type SalvorGame } from "../../game.js";

/**
 * The run in progress, kept across a reload.
 *
 * A run *is* `(seed, inputs)` — that is the whole of this engine's determinism
 * and the reason `tests/replay.test.ts` can hold three recorded voyages to a
 * fingerprint. So a save is those two things and nothing else: no state is
 * written, nothing can be hand-edited into an advantage, and a save that fails
 * to replay is simply a save that is thrown away.
 *
 * ## This is not meta-progression
 *
 * The jam's fourth rule (`.claude/CLAUDE.md`) is that nothing carries between
 * runs and that `localStorage` holds settings and never progress, and this
 * obeys it in the way that matters: what is kept is *this* run, not anything
 * earned in a previous one. Closing the tab in the middle of a sortie and
 * coming back to it is the same run, and it is deleted the moment the run ends
 * — a death or a win leaves nothing behind but the menu.
 *
 * ## Why the reload was silent
 *
 * There was no save at all: `Continue` was greyed unless a game object was
 * already in memory, so it was only ever the button for a menu opened
 * mid-sortie. A player who reloaded lost the voyage without being told, which
 * is the one thing permadeath must never be confused with.
 */
const KEY = "derelict-rogue:run";

/** The slice of `localStorage` this uses, so a test can hand in its own. */
type Slice = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): Slice | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    /* A browser set to block site data throws on the accessor itself. */
    return undefined;
  }
}

/**
 * Write the run down.
 *
 * Called after every command rather than at a checkpoint, because a roguelike
 * has no checkpoints and the whole record is a few kilobytes of JSON: a walk
 * of two hundred turns is two hundred short objects. Failure is silent and
 * harmless — a full or blocked store means the tab is the only copy, which is
 * exactly where this started.
 */
export function remember(game: RoomGame): void {
  const slice = store();
  if (slice === undefined) return;
  if (game.status !== "playing") {
    forget();
    return;
  }
  try {
    slice.setItem(
      KEY,
      encodeRun<RoomCommand>({
        version: SAVE_VERSION,
        seed: game.seed,
        inputs: game.inputs as RoomCommand[],
      }),
    );
  } catch {
    /* No room, or no permission. The run continues; only the copy is lost. */
  }
}

/** Throw the run away. A finished run leaves nothing behind. */
export function forget(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* nothing to do about it, and nothing depends on it */
  }
}

/** Is there something to come back to? Cheap: no replay, just a decode. */
export function suspended(): boolean {
  const raw = read();
  return raw !== undefined && raw.inputs.length > 0;
}

function read(): { seed: number; inputs: RoomCommand[] } | undefined {
  const slice = store();
  if (slice === undefined) return undefined;
  let text: string | null = null;
  try {
    text = slice.getItem(KEY);
  } catch {
    return undefined;
  }
  if (text === null) return undefined;
  const got = decodeRun<RoomCommand>(text);
  /* A save from an older build decodes to `ok: false` and is dropped rather
     than replayed into a game that does not mean the same thing any more. */
  if (!got.ok || got.record === undefined) {
    forget();
    return undefined;
  }
  return { seed: got.record.seed, inputs: got.record.inputs };
}

/**
 * Play the run back into a live game.
 *
 * `undefined` where there is nothing to resume or where the replay does not
 * end in a playable run — a save recorded against rules that have since
 * changed replays to some other ending, and handing that to the player as
 * "continue" would be worse than losing it.
 */
export function resume(): SalvorGame | undefined {
  const saved = read();
  if (saved === undefined) return undefined;
  try {
    const game = newGame(saved.seed);
    for (const cmd of saved.inputs) {
      if (game.status !== "playing") break;
      game.playerCommand(cmd);
    }
    if (game.status !== "playing") {
      forget();
      return undefined;
    }
    return game;
  } catch {
    forget();
    return undefined;
  }
}
