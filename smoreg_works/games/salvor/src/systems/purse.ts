import type { RoomGame } from "@jamrog/engine";

/**
 * The run's credits, and nothing else about the run.
 *
 * A narrow view of one field of one record. `systems/voyage.ts` owns that
 * record and does the bookkeeping that comes with money — the log line, the
 * score, the loss condition — and anything that merely needs *the number* reads
 * it here instead of importing the account.
 *
 * The file exists because of a load-order failure, and the failure is worth
 * writing down. `systems/virus.ts` grew a strain that skims credits, so it
 * imported `spend` from `systems/voyage.ts`; that closed a loop —
 * `voyage → doors → rig → virus → voyage` — and `systems/doors.ts` registers a
 * hack target at module scope, which under ESM ran before its own import had
 * been initialised. The whole suite went down with
 * `registerHackTarget is not a function`. Nothing was wrong with the feature:
 * a cycle that had been merely untidy for weeks became a crash the moment one
 * more edge closed it (`docs/adr/0003-decoupling.md`).
 *
 * So: one field, one file, no imports but the engine's types.
 */

/** What is on the account right now. Zero before a run has one. */
export function creditsOf(game: RoomGame): number {
  const purse = read(game);
  return purse === undefined ? 0 : purse.credits;
}

/**
 * Take up to `want` credits and say how many were actually taken.
 *
 * Down to nothing and never below it: an account that could go negative would
 * end the run through a door nothing else in the game opens.
 */
export function takeCredits(game: RoomGame, want: number): number {
  const purse = read(game);
  if (purse === undefined || want <= 0) return 0;
  const took = Math.min(want, purse.credits);
  purse.credits -= took;
  return took;
}

/**
 * The live record, or nothing at all. Defensive: `player.data` round-trips
 * through a save file, so the shape written there is not trusted.
 */
function read(game: RoomGame): { credits: number } | undefined {
  const raw = game.player.data?.voyage;
  if (typeof raw !== "object" || raw === null) return undefined;
  const purse = raw as { credits?: unknown };
  return typeof purse.credits === "number" ? (purse as { credits: number }) : undefined;
}
