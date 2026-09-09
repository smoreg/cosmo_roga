import { isAlive, type Entity } from "./entity.js";
import { perform, type Command } from "./actions.js";
import { behaviourByName, type AiWorld, type Intent } from "./ai/behaviors.js";
import type { DijkstraMap } from "./dijkstra.js";
import { tickStatuses } from "./status.js";
import type { Game } from "./game.js";

/**
 * The bridge between behaviours (pure, testable, in sim/ai/) and the turn loop.
 * All the intelligence lives in the behaviour; this file only translates an
 * intent into a Command and charges the actor for it.
 */
export function takeAiTurn(game: Game, actor: Entity, cache?: Map<string, DijkstraMap>): Command {
  const world: AiWorld = {
    level: game.level,
    entities: game.entities,
    player: game.player,
    rng: game.rng,
    noise: game.noise,
    cache,
  };
  return toCommand(actor, behaviourByName(actor.behaviour)(world, actor));
}

function toCommand(actor: Entity, intent: Intent): Command {
  switch (intent.kind) {
    // Ranged and melee share one wire command: dx/dy already carries the
    // target's actual position, adjacent or not, and doAttack does not care
    // which. The Behaviour is what enforces range and line of sight for a
    // "shoot" — only ever emitting one that is already legal.
    case "attack":
    case "shoot":
      return { kind: "attack", dx: intent.target.pos.x - actor.pos.x, dy: intent.target.pos.y - actor.pos.y };
    case "step":
      return { kind: "move", dx: intent.to.x - actor.pos.x, dy: intent.to.y - actor.pos.y };
    case "wait":
      return { kind: "wait" };
  }
}

/** Drive every non-player actor until it is the player's turn again. */
export function runNonPlayerTurns(game: Game): void {
  // The player does not move while monsters act, so pathing goals are stable
  // for the whole batch and every map can be computed once.
  const cache = new Map<string, DijkstraMap>();

  for (let guard = 0; guard < 5000; guard++) {
    const actor = game.schedule.next(game.entities);
    if (!actor) return;
    if (actor.id === game.player.id) return;

    // Statuses resolve before the actor acts: poison can kill it mid-approach.
    const tick = tickStatuses(actor, game.rng);
    for (const msg of tick.messages) {
      if (game.level.visible.get(actor.pos.x, actor.pos.y)) {
        game.log.add(`The ${actor.name}'s ${msg}.`, game.schedule.time, "plain");
      }
    }
    if (!isAlive(actor)) {
      game.onDeath(actor);
      game.reapDead();
      continue;
    }

    const cmd = takeAiTurn(game, actor, cache);
    const outcome = perform(game, actor, cmd);
    // A refused AI action still costs a turn, otherwise a stuck monster spins forever.
    game.schedule.spend(actor, outcome.ok ? outcome.cost : 100);

    game.notifyActorTurn(actor);
    game.reapDead();
    if (!isAlive(game.player)) return;
  }
  throw new Error("runNonPlayerTurns: the player never got a turn back (AI livelock)");
}
