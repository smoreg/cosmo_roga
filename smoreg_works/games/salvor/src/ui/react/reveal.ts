import * as FX from "../fx/derelict-fx.js";

/**
 * Reveals that cannot leave a blank screen, re-exported from the library.
 *
 * These used to live here, written when the game found that `scrambleReveal`
 * empties a line synchronously and its `cancel` leaves it empty — which under
 * React's StrictMode meant a second effect pass starting from the blanks the
 * first one left, and a whole screen coming up empty.
 *
 * They now live in `derelict-fx.js`, because it is the library's own contract
 * that breaks and every screen built on it has the same hole. The design
 * system carries them (`vuvko_works/design/salvor-design-system`,
 * `INTEGRATION.md`), and this file is what is left of the fix on this side: a
 * name for the two of them, so the view keeps importing from one place.
 */
export const reveal = FX.reveal;
export const linesOf = FX.linesOf;
