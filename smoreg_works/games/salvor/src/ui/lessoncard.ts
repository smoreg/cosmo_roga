import type { RoomGame } from "@jamrog/engine";
import { t } from "../i18n.js";
import { lessonStatus } from "../systems/tutorial.js";
import { wrapped } from "./viruscard.js";

/**
 * The card a training run opens on, before the first step (G96, 2): what the
 * job is. The owner, after playing the lesson: «вначале окошко, что мы тут
 * вообще делаем — обезвреживаем дереликт, чтобы продать». Three sentences —
 * a dead hull, three systems to bring up and an airlock to walk out of, a tug
 * that tows and sells — which is the whole game, and which was said nowhere.
 *
 * Laid out like the `i` card and the virus window and drawn by the same
 * frames: a heading, a body already broken to the card's width, a footer.
 * Every word is the tables'; this file only decides the order and the breaks.
 */
export interface LessonBrief {
  readonly heading: string;
  readonly body: readonly string[];
  readonly footer: string;
}

export function lessonBrief(): LessonBrief {
  return {
    heading: t("lesson.brief.title"),
    body: [...wrapped(t("lesson.brief.hull")), "", ...wrapped(t("lesson.brief.job")), "", ...wrapped(t("lesson.brief.pay"))],
    footer: t("lesson.brief.footer"),
  };
}

/**
 * Is this the moment for the card: a training run on its first step with
 * nothing pressed yet. A fact about the run and not about the screen, so the
 * terminal, the page and the React screen agree on it, and a reloaded lesson
 * that has already moved does not open on it again.
 */
export function briefing(game: RoomGame): boolean {
  const status = lessonStatus(game);
  return status !== undefined && !status.over && status.step === 0 && game.inputs.length === 0;
}
