import {
  distanceField,
  spawnMonster,
  type Game,
  type MonsterKind,
  type Point,
  type System,
} from "@jamrog/engine";
import { kindsForDepth } from "../content/monsters.js";
import { MODULES, moduleKind, type ModuleId, SCRAP_INTEGRITY } from "../content/modules.js";
import { CARD_MODULE } from "../content/storylets.js";
import { addWreck, wreckAt } from "../twist/rig.js";

/**
 * Turns the markers a storylet drew into things standing on the deck.
 *
 * The generator only ever writes letters: it has no idea what a maintenance
 * bot or a welder is, and must not. This system is the one place where the
 * card's `m`, `M`, `X` and `w` become machines and salvage — so a new card is
 * a text block in src/content/storylets.ts and nothing else.
 *
 * Marker legend lives with the cards; this file is the half that executes it.
 */

/** What an unnamed crate can hold. A cargo bay is a lottery, a closet is not. */
const SALVAGE_POOL: readonly ModuleId[] = Object.keys(MODULES) as ModuleId[];
/**
 * Deck 1 must have salvage within a few steps of the airlock the drone comes
 * out of, whatever the docking bay card rolled: pressing `g` in the first ten
 * turns is the whole of the onboarding (design-doc.md, "Онбординг").
 */
const ONBOARDING_REACH = 3;

export const POPULATE: System = {
  name: "populate",

  onLevelEnter(game, depth) {
    for (const placed of game.lastGen.vaults) {
      for (const mark of placed.marks) applyMark(game, depth, placed.vault.name, mark.ch, mark.pos);
    }
    ensureOnboardingScrap(game, depth);
  },
};

// ------------------------------------------------------------------ markers

function applyMark(game: Game, depth: number, card: string, ch: string, pos: Point): void {
  // A later pass may have walled a marker in — sealing an unreachable pocket,
  // for one. Nothing is ever placed where it cannot be reached.
  if (!game.level.isWalkable(pos.x, pos.y)) return;

  switch (ch) {
    case "m":
      spawnAt(game, pos, bandPick(game, depth));
      return;
    case "M":
      spawnAt(game, pos, heaviest(depth));
      return;
    case "X": {
      const kind = cardModule(game, card);
      addWreck(game, pos, kind, moduleKind(kind).integrity, "X");
      return;
    }
    case "w": {
      const kind = cardModule(game, card);
      addWreck(game, pos, kind, game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]), "%");
      return;
    }
    default:
      return;
  }
}

/** The card names its module, or the crate is a lottery. */
function cardModule(game: Game, card: string): ModuleId {
  return CARD_MODULE[card] ?? game.rng.pick(SALVAGE_POOL);
}

/** One machine of this deck's band, by the same weights the engine spawner uses. */
function bandPick(game: Game, depth: number): MonsterKind | undefined {
  const kinds = kindsForDepth(depth);
  if (kinds.length === 0) return undefined;
  const table: Record<string, number> = {};
  for (const k of kinds) table[k.id] = k.weight;
  const id = game.rng.weighted(table);
  return kinds.find((k) => k.id === id);
}

/**
 * The heaviest thing legal this deep, by HP. Ties go to the earlier entry in
 * the bestiary, so a card's `M` is the same machine on the same seed however
 * the table is later reordered around it.
 */
function heaviest(depth: number): MonsterKind | undefined {
  let best: MonsterKind | undefined;
  for (const k of kindsForDepth(depth)) {
    if (!best || k.hp > best.hp) best = k;
  }
  return best;
}

/** Never stack: a marker under something already standing there is simply skipped. */
function spawnAt(game: Game, pos: Point, kind: MonsterKind | undefined): void {
  if (!kind) return;
  if (game.monsterAt(pos.x, pos.y)) return;
  if (game.player.pos.x === pos.x && game.player.pos.y === pos.y) return;

  const machine = spawnMonster(kind, pos);
  game.schedule.admit(machine);
  game.entities.push(machine);
}

// --------------------------------------------------------------- onboarding

function ensureOnboardingScrap(game: Game, depth: number): void {
  if (depth !== 1) return;

  // Walking distance, not chebyshev: a pile behind a wall teaches nothing.
  const dist = distanceField(game.level, game.player.pos);
  const free: Point[] = [];
  let inReach = false;
  dist.forEach((x, y, d) => {
    if (d < 0 || d > ONBOARDING_REACH) return;
    if (wreckAt(game, { x, y })) inReach = true;
    else if (d >= 1) free.push({ x, y });
  });
  if (inReach || free.length === 0) return;

  const kind = CARD_MODULE["docking bay"] ?? "welder";
  const spot = game.rng.pick(free);
  addWreck(game, spot, kind, game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]), "%");
}
