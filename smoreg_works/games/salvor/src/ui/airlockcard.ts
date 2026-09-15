import type { RoomGame } from "@jamrog/engine";
import { derelictName } from "../content/derelicts.js";
import { t } from "../i18n.js";
import { derelictAboard } from "../systems/voyage.js";
import { wrapped } from "./input.js";

/**
 * The card that comes up the moment the third system starts: the hull is worth
 * what it is worth, and not one credit of it is paid until the drone is out
 * through the airlock (G95 B2).
 *
 * The owner: «пусть в первый раз после подъёма всех систем вылетает
 * уведомление, что надо идти на причал и эвакуировать дрон». Everything it says
 * was already said — `log.system.all` on the turn it happens, `panel.goal.out`
 * on the panel for as long as it is true — and he finished a hull without
 * reading either, because a log line is one row of seven that scrolls and the
 * panel row is a state rather than an event. The rule is worth a card once: a
 * neutralised hull with the drone still aboard is the one position in this game
 * where a player can lose everything they have just earned by carrying on.
 *
 * Once a run, not once a hull: the second time the third system comes up the
 * player knows, and a card that comes back is a card that gets dismissed
 * unread (`ui/appstate.ts`, `airlockTold`).
 *
 * Laid out like the virus window and drawn by the same frames — a heading, a
 * body already broken, a footer — so neither view has a word of its own
 * (`ui/render.ts`, `ui/web/screen.ts`).
 */
export interface AirlockCard {
  readonly heading: string;
  readonly body: readonly string[];
  readonly footer: string;
}

/** The card for the hull the drone is standing in, or nothing at home. */
export function airlockCard(game: RoomGame): AirlockCard | undefined {
  const state = derelictAboard(game);
  if (state === undefined) return undefined;
  const price = state.spec.salePrice;
  const worth =
    price > 0
      ? t("airlock.card.worth", { hull: derelictName(state.spec), cr: price })
      : t("airlock.card.worth.bare", { hull: derelictName(state.spec) });
  return {
    heading: t("airlock.card.title"),
    body: [...wrapped(worth), "", ...wrapped(t("airlock.card.paid")), "", ...wrapped(t("airlock.card.press"))],
    footer: t("airlock.card.footer"),
  };
}
