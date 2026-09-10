/**
 * Whose error is this?
 *
 * The page listens on `window` for anything the guards miss, which is right for
 * our own code and wrong for everybody else's: a browser extension injected
 * into the page throws into the same handler, and the player gets the crash
 * card for a run that is perfectly healthy. The owner hit exactly that —
 * `TypeError: undefined is not an object (evaluating 'e.useCache')`, a property
 * name that appears nowhere in the bundle or in anything it ships.
 *
 * So the card is shown for a failure that can be traced to our own script, and
 * a passer-by is logged and ignored. Traced means: the event names a file on
 * this origin, or the error's stack does. Anything from an extension scheme
 * (`safari-extension://`, `chrome-extension://`, `moz-extension://`) is theirs;
 * a cross-origin script the browser has masked down to `Script error.` with no
 * file is theirs too, because ours is never masked — it is same-origin.
 *
 * When there is nothing to go on at all — no file, no stack — the failure is
 * treated as ours. A crash we cannot place is still a crash, and a silent game
 * that has stopped obeying its own rules is worse than a card too many.
 */

/** Schemes a browser gives its own extensions. None of them is us. */
const FOREIGN = ["-extension://", "extensions::", "moz-extension://"];

/** What the two `window` events carry, as much of it as either one has. */
export interface Failure {
  readonly filename?: string;
  readonly message?: string;
  readonly stack?: string;
}

export function ownFailure(failure: Failure, origin: string): boolean {
  const file = failure.filename ?? "";
  if (file.length > 0) return sameOrigin(file, origin);

  const stack = failure.stack ?? "";
  if (stack.length > 0) {
    if (stack.includes(origin)) return true;
    return !FOREIGN.some((scheme) => stack.includes(scheme));
  }

  // `Script error.` with no file and no stack is the browser refusing to say
  // anything about a cross-origin script. Ours is served beside the page.
  return failure.message !== "Script error." && failure.message !== "Script error";
}

function sameOrigin(file: string, origin: string): boolean {
  if (FOREIGN.some((scheme) => file.includes(scheme))) return false;
  if (file.startsWith(origin)) return true;
  // A relative file name can only be resolved against this page.
  return !file.includes("://");
}
