import type { Entity, RoomGame } from "@jamrog/engine";
import { machineName } from "./content/monsters.js";
import { t } from "./i18n.js";

/**
 * How the game names the things in a compartment when it talks about them.
 *
 * The engine has a `label` of its own and it says `the scout`, which is
 * English grammar wearing the clothes of a helper function: Spanish would need
 * to know the noun's gender and Russian has no article at all. So the article
 * is not a rule here, it is a row of the table — `label.other` is `the {name}`
 * in English and bare `{name}` in the other two — and every sentence that uses
 * one is worded to survive that.
 */

/** `You`, or whatever the machine is called in the language that is on. */
export function entityLabel(game: RoomGame, e: Entity): string {
  return e.id === game.player.id ? t("label.you") : t("label.other", { name: machineName(e.name) });
}

/** The same at the head of a sentence. Safe on any alphabet the game ships. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
