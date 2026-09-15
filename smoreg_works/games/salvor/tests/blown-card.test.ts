import { describe, expect, it } from "vitest";
import { newGame } from "../src/game.js";
import { t } from "../src/i18n.js";
import { endingBanners } from "../src/ui/render.js";

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
