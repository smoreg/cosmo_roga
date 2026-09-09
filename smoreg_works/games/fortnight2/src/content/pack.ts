import type { ContentPack } from "@jamrog/engine";
import { kindsForDepth, monsterBudget } from "./monsters.js";
import { makePlayer } from "./player.js";
import { VAULTS } from "./vaults.js";

/**
 * Everything that makes this a game rather than an engine. One object, handed
 * to `new Game({ seed, content: FORTNIGHT2 })`.
 */
export const FORTNIGHT2: ContentPack = {
  name: "SALVOR",
  maxDepth: 6,
  makePlayer,
  monstersForDepth: kindsForDepth,
  monsterBudget: (depth) => monsterBudget(depth),
  vaults: VAULTS,
  vaultsPerLevel: 0,
  openingLine: "Docking clamps release. The station is dark. You are the only thing still running.",
  winLine: "You drop into the reactor core access and cut the power. The station goes quiet. You win.",
  deathLine: "Core breach. The drone goes dark. The station keeps what it takes.",
};
