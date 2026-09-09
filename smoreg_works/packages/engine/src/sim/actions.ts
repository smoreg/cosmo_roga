import type { Point } from "./grid.js";
import { samePoint } from "./grid.js";
import { Tile } from "./level.js";
import { type Entity, blocks, isAlive } from "./entity.js";
import { attack } from "./combat.js";
import { dealDamage } from "./damage.js";
import { TURN_COST } from "./schedule.js";
import type { Game } from "./game.js";

/**
 * `use` and `interact` are the two doors left open for a game's own verbs: the
 * engine carries them through the turn cycle and the save file, and a system
 * decides what they mean. Keeping them in the Command union — instead of a
 * side channel — is what keeps a run replayable from (seed, commands).
 */
export type Command =
  | { kind: "move"; dx: number; dy: number }
  | { kind: "wait" }
  | { kind: "descend" }
  | { kind: "attack"; dx: number; dy: number }
  | { kind: "use"; slot: number; target?: Point }
  | { kind: "interact" };

export interface Outcome {
  /** false = illegal move, the turn is NOT consumed and the UI should say why. */
  ok: boolean;
  /** Energy spent. TURN_COST for a normal action. */
  cost: number;
  /** Reason for a refusal, shown in the log. */
  reason?: string;
}

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (cost = TURN_COST): Outcome => ({ ok: true, cost });

export function entityAt(game: Game, x: number, y: number): Entity | undefined {
  return game.entities.find((e) => blocks(e) && e.pos.x === x && e.pos.y === y);
}

/** Runs a command for `actor`. Pure w.r.t. rendering: only mutates game state. */
export function perform(game: Game, actor: Entity, cmd: Command): Outcome {
  switch (cmd.kind) {
    case "wait":
      return DONE();

    case "descend":
      return doDescend(game, actor);

    case "move":
      return doMove(game, actor, cmd.dx, cmd.dy);

    case "attack":
      return doAttack(game, actor, { x: actor.pos.x + cmd.dx, y: actor.pos.y + cmd.dy });

    case "use":
    case "interact":
      return doCustom(game, actor, cmd);
  }
}

/**
 * A command the engine has no opinion about. Systems are asked in order and
 * the first one to claim it owns the turn; if nobody does, the command is
 * refused and costs nothing — a key pressed for a module you no longer have
 * must not hand the floor to the monsters.
 */
function doCustom(game: Game, actor: Entity, cmd: Command): Outcome {
  for (const sys of game.systems) {
    const out = sys.performCommand?.(game, actor, cmd);
    if (out) return out;
  }
  return FAIL("Nothing to do.");
}

function doMove(game: Game, actor: Entity, dx: number, dy: number): Outcome {
  if (dx === 0 && dy === 0) return DONE();

  if (actor.stunned && actor.stunned > 0) {
    actor.stunned--;
    const dir = game.rng.pick([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]);
    dx = dir.x;
    dy = dir.y;
    game.log.add(`${label(game, actor)} ${verb(game, actor, "stumble")}.`, game.schedule.time, "warn");
  }

  const target = { x: actor.pos.x + dx, y: actor.pos.y + dy };

  const occupant = entityAt(game, target.x, target.y);
  if (occupant && occupant.id !== actor.id) {
    // Bump-to-attack: the classic. Never a wasted keypress.
    if (occupant.faction !== actor.faction) return doAttack(game, actor, target);
    return FAIL(`${label(game, occupant)} is in the way.`);
  }

  if (!game.level.tiles.inBounds(target.x, target.y)) return FAIL("The edge of the world.");
  if (!game.level.isWalkable(target.x, target.y)) {
    const def = game.level.def(target.x, target.y);
    return FAIL(`A ${def?.name ?? "wall"} blocks the way.`);
  }

  actor.pos = target;
  return DONE();
}

function doAttack(game: Game, actor: Entity, target: Point): Outcome {
  const victim = entityAt(game, target.x, target.y);
  if (!victim || !isAlive(victim)) return FAIL("Nothing to attack there.");
  if (victim.faction === actor.faction) return FAIL("You will not strike an ally.");

  // Damage goes through the game so the systems get their say before hit points.
  const res = attack(actor, victim, game.rng, (v, raw) => dealDamage(game, v, raw, actor));
  const tone = actor.id === game.player.id ? "good" : "bad";
  // A blow a system swallowed whole is that system's story to tell: printing
  // `the scout hits You for 0.` above its own `The scout hits your THRUSTERS
  // (2/3).` is the same event twice, and the engine's half carries no number.
  // With nothing in the way (intercepted === 0) the line reads as it always has.
  if (res.damage > 0 || res.intercepted === 0) {
    game.log.add(
      `${label(game, actor)} ${verb(game, actor, "hit")} ${label(game, victim)} for ${res.damage}.`,
      game.schedule.time,
      tone,
    );
  }
  if (res.killed) {
    // The player's ending is written by the content pack, in `playerCommand`.
    // Saying "You dies." here as well would announce it twice, badly.
    if (victim.id !== game.player.id) {
      game.log.add(`${label(game, victim)} dies.`, game.schedule.time, tone);
    }
    game.onDeath(victim);
  }
  return DONE();
}

/**
 * One key, two exits. The stairs go further in and the outer airlock goes back
 * out; which one the player is standing on is all the engine knows about the
 * difference, and it hands that on as the reason for leaving.
 */
function doDescend(game: Game, actor: Entity): Outcome {
  if (actor.id !== game.player.id) return FAIL("Only the player may descend.");
  const here = game.level.tiles.get(actor.pos.x, actor.pos.y);
  if (here !== Tile.StairsDown && here !== Tile.AirlockOut) {
    return FAIL("There are no stairs here.");
  }
  game.descend(here === Tile.AirlockOut ? "airlock" : "stairs");
  return DONE();
}

export function label(game: Game, e: Entity): string {
  return e.id === game.player.id ? "You" : `the ${e.name}`;
}

/**
 * `label` is second person for the player and third for everything else, so
 * the verb has to agree with it: "You hit", but "the scout hits".
 */
export function verb(game: Game, actor: Entity, base: string): string {
  return actor.id === game.player.id ? base : `${base}s`;
}

export function isAdjacent(a: Point, b: Point): boolean {
  if (samePoint(a, b)) return false;
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}
