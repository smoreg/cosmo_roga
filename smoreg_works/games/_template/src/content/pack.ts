import type { ContentPack } from "@jamrog/engine";
import { kindsForDepth, monsterBudget } from "./monsters.js";
import { makePlayer } from "./player.js";

/** Everything that makes this a game rather than an engine. */
export const CONTENT: ContentPack = {
  name: "__GAME_NAME__",
  maxDepth: 6,
  makePlayer,
  monstersForDepth: kindsForDepth,
  monsterBudget: (depth) => monsterBudget(depth),
  openingLine: "You descend. There is no way back.",
};
