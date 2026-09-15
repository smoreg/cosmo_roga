import { describe, expect, it } from "vitest";
import { newGame } from "../src/game.js";
import { derelictName } from "../src/content/derelicts.js";
import { OBJECTIVE_COUNT, OBJECTIVES } from "../src/content/objectives.js";
import { DEFAULT_LANG, LANGS, setLang, t } from "../src/i18n.js";
import { currentDerelict } from "../src/systems/voyage.js";
import { endingBanners } from "../src/ui/render.js";
import { SCREEN_WIDTH } from "../src/ui/theme.js";

describe("the card after a detonation", () => {
  it("says the hull blew up and why, instead of an empty account or a bare DRONE LOST", () => {
    const game = newGame(7);
    expect(endingBanners(game).dead?.title).toBe(t("end.dead"));
    const why = t("log.voyage.blownLast", { hull: "KESTREL" });
    game.log.add(why, game.schedule.time, "bad", "log.voyage.blownLast");
    expect(endingBanners(game).dead).toMatchObject({ title: t("end.blown"), why });
    expect(endingBanners(game).lost).toMatchObject({ title: t("end.blown"), why });
  });

  it("forgets an old detonation once a later turn has been written", () => {
    const game = newGame(7);
    game.log.add(t("log.voyage.blown", { hull: "KESTREL" }), game.schedule.time, "bad", "log.voyage.blown");
    game.log.add("later", game.schedule.time + 100, "plain");
    expect(endingBanners(game).lost?.title).toBe(t("end.lost"));
  });
});

/**
 * The card at the end of every derelict (docs/tasks/G95-smoreg-wave.md, B3).
 *
 * The owner asked for its words: «ДЕРЕЛИКТ ОБЕЗВРЕЖЕН И ПРОДАН — надпись в конце
 * каждого дереликта». It used to be `SHIP SOLD` over the voyage's running
 * figures, and it said neither which hull nor what it paid — on the one screen
 * a sortie ends on.
 */
describe("the card at the end of a derelict", () => {
  it("names the hull and what it paid, in the words the goal is stated in", () => {
    const game = newGame(4);
    const state = currentDerelict(game);
    state.online = OBJECTIVES.map((o) => o.id);
    state.sold = true;

    const card = endingBanners(game).sold!;
    expect(card.title).toBe(t("end.sold"));
    expect(card.why).toBe(
      t("end.sold.why", {
        hull: derelictName(state.spec),
        n: OBJECTIVE_COUNT,
        cr: state.spec.salePrice,
      }),
    );
    expect(card.why).toContain(derelictName(state.spec));
    expect(card.why).toContain(String(state.spec.salePrice));
  });

  it("halves the sum when the sale was split with the other tug", () => {
    const game = newGame(4);
    const state = currentDerelict(game);
    state.sold = true;
    state.deal = "split";
    expect(endingBanners(game).sold?.why).toContain(String(Math.floor(state.spec.salePrice / 2)));
  });

  it("is the same card in all three languages, and fits the screen", () => {
    const game = newGame(4);
    currentDerelict(game).sold = true;
    for (const lang of LANGS) {
      setLang(lang);
      const card = endingBanners(game).sold!;
      const words = `${card.title}\n${card.why ?? ""}`;
      expect(card.why, lang).toBeTruthy();
      expect(card.title.length, lang).toBeLessThanOrEqual(SCREEN_WIDTH - 6);
      expect((card.why ?? "").length, lang).toBeLessThanOrEqual(SCREEN_WIDTH - 6);
      if (lang !== "ru") expect(words, lang).not.toMatch(/[А-Яа-яЁё]/);
    }
    setLang(DEFAULT_LANG);
  });

  it("says the two words alone when there is no voyage to read a hull off", () => {
    expect(endingBanners().sold).toMatchObject({ title: t("end.sold") });
    expect(endingBanners().sold?.why).toBeUndefined();
  });
});
