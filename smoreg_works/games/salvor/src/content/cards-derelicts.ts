import type { RoomCard, Ship } from "@jamrog/engine";
import { ENTRY_KIND, ZONE_KINDS } from "./zones.js";

/**
 * The cards a charter needs, and nothing else.
 *
 * A charter is chosen on the tug, before the derelict exists (design-doc.md,
 * "Чартеры"): the marks it wants have to be part of the ship the generator then
 * builds, so the only way in is the deck. These are those two cards — the thing
 * to carry home (`*`) and the console to upload from (`&`) — and both are gated
 * on a flag the voyage raises when the charter is taken.
 *
 * The other three cards G25 was written around — `hidden hold`, `spore bloom`
 * and `turret nest` — are already in `content/cards.ts`, placed there by G36
 * with the class gate they needed. Nothing here duplicates them.
 *
 * Kept out of `cards.ts` on purpose: this is a draft, and the whole file is one
 * concatenation away from being merged into the deck (`CARDS.concat(
 * DERELICT_CARDS)`), which is what the integration note in the task file asks
 * for.
 */

/**
 * A charter's errand never lies in the first two compartments of a ship: a
 * marked crate two steps from the airlock is a charter that pays for nothing
 * (design-doc.md, "Чартеры": `depth ≥ 2`).
 */
export const MIN_CHARTER_DEPTH = 2;

/**
 * A card that must land wherever it is legal. Same number as `cards.ts` uses
 * and for the same reason: a charter that did not get its crate aboard is a
 * charter the player cannot finish, so it cannot lose a draw to a crate of
 * spare parts.
 */
const PINNED = 1_000_000;

/** Prefix of every flag a taken charter raises. */
export const CHARTER_FLAG = "charter:";

/** The flag that puts a `RETRIEVE` charter's crate in compartments of `kind`. */
export function retrieveFlag(kind: string): string {
  return `${CHARTER_FLAG}retrieve:${kind}`;
}

/** The flag that puts an `UPLOAD` charter's console in compartments of `kind`. */
export function uploadFlag(kind: string): string {
  return `${CHARTER_FLAG}upload:${kind}`;
}

/**
 * Raised alongside `uploadFlag` whenever an upload charter is live.
 *
 * The card needs the compartment kind in the flag — a console card eligible in
 * every kind is drawn in the first room of the ship, which is the airlock, and
 * the airlock is the one place the charter may not be — so the kind is what the
 * deck reads. This bare flag is for everything that only has to know *whether*
 * the run is uploading: the panel, the action list, the alert's noise.
 */
export const UPLOAD_FLAG = `${CHARTER_FLAG}upload`;

/**
 * Compartments a charter may name: everything but the airlock and the three the
 * ship's own systems own.
 *
 * The systems' rooms are excluded because their cards are pinned already — a
 * reactor draws both its core and its antechamber and has no slot left — and
 * because "go to the reactor" is the `NEUTRALIZE` charter, which every derelict
 * carries anyway.
 */
export const CHARTER_KINDS: readonly string[] = ZONE_KINDS
  .filter((z) => z.kind !== ENTRY_KIND && !z.required)
  .map((z) => z.kind);

/**
 * One card per compartment kind, twice over.
 *
 * A card's `kinds` is static and the generator hands it nothing but the kind of
 * the room it is trying to fill, so "the crate is in the LAB" cannot be one
 * card reading a flag — it is eighteen cards, of which exactly one is eligible
 * on any given run. The cost is a longer library; the alternative is a card
 * that lands wherever it is drawn first, which is the airlock.
 */
function charterCard(kind: string): RoomCard {
  return {
    name: `charter item (${kind})`,
    kinds: [kind],
    weight: PINNED,
    maxPerShip: 1,
    when: (ctx) => ctx.flags.has(retrieveFlag(kind)),
    marks: ["*"],
  };
}

function consoleCard(kind: string): RoomCard {
  return {
    name: `console (${kind})`,
    kinds: [kind],
    weight: PINNED,
    maxPerShip: 1,
    when: (ctx) => ctx.flags.has(uploadFlag(kind)),
    marks: ["&"],
  };
}

/** The two charter cards, for every compartment a charter may name. */
export const DERELICT_CARDS: readonly RoomCard[] = CHARTER_KINDS.flatMap((kind) => [
  charterCard(kind),
  consoleCard(kind),
]);

/**
 * Move a charter's mark out of the shallows, and say when it could not be done.
 *
 * The depth rule is the one guarantee the deck cannot keep on its own. A pinned
 * card is drawn in the first compartment of its kind the generator walks, rooms
 * are walked in the order they were grown, and the tree grows shallow-first —
 * so a pinned card lands in the *shallowest* room of its kind, which is exactly
 * the wrong end of the ship. Nothing in `RoomCard` can say "not there": the
 * generator passes a card the room's kind and never its depth.
 *
 * So the mark is seated afterwards, by moving it to the deepest room of the
 * same kind. Same kind, because `validateShip` checks every mark against the
 * cards that could have left it — a `*` moved into a compartment no charter
 * card names is a ship the validator rejects. Returns the marks it could not
 * seat, which is the caller's cue to generate the ship again.
 */
export function seatCharterMarks(ship: Ship): string[] {
  const stuck: string[] = [];

  for (const mark of ["*", "&"]) {
    for (const room of ship.rooms) {
      if (room.depth >= MIN_CHARTER_DEPTH || !room.marks.includes(mark)) continue;

      const deeper = ship.rooms
        .filter((r) => r.kind === room.kind && r.depth >= MIN_CHARTER_DEPTH)
        .sort((a, b) => b.depth - a.depth || a.id - b.id)[0];
      if (!deeper) {
        stuck.push(mark);
        continue;
      }
      room.marks.splice(room.marks.indexOf(mark), 1);
      deeper.marks.push(mark);
    }
  }
  return stuck;
}
