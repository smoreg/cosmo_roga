import { isAlive, type Entity } from "../sim/entity.js";
import { tickStatuses } from "../sim/status.js";
import { perform, type RoomCommand } from "./actions.js";
import { behaviourByName, type RoomIntent, type RoomWorld } from "./behaviours.js";
import type { RoomDistance } from "./paths.js";
import type { RoomGame } from "./game.js";

/**
 * The bridge between behaviours (pure, testable, in rooms/behaviours.ts) and
 * the turn loop — the graph twin of `sim/ai.ts`, and just as thin: all the
 * intelligence lives in the behaviour, this only turns an intent into a command
 * and charges the actor for it.
 */
export function takeAiTurn(game: RoomGame, actor: Entity, cache?: Map<string, RoomDistance>): RoomCommand {
  const world: RoomWorld = {
    ship: game.ship,
    entities: game.entities,
    player: game.player,
    rng: game.rng,
    noise: game.noise,
    cache,
  };
  return toCommand(behaviourByName(actor.behaviour)(world, actor));
}

function toCommand(intent: RoomIntent): RoomCommand {
  switch (intent.kind) {
    // Melee and a shot share one wire command: the target's id says where it
    // stands, and `perform` does not care which of the two this was. The
    // behaviour is what enforces range and line of sight for a "shoot" — only
    // ever emitting one that is already legal.
    case "attack":
    case "shoot":
      return { kind: "attack", target: intent.target.id };
    case "go":
      return { kind: "go", door: intent.door };
    case "wait":
      return { kind: "wait" };
  }
}

/** Drive every non-player actor until it is the player's turn again. */
export function runNonPlayerTurns(game: RoomGame): void {
  // The player does not move while machines act, so pathing goals are stable
  // for the whole batch and every map can be computed once.
  const cache = new Map<string, RoomDistance>();

  for (let guard = 0; guard < 5000; guard++) {
    const actor = game.schedule.next(game.entities);
    if (!actor) return;
    if (actor.id === game.player.id) return;

    // Statuses resolve before the actor acts: poison can kill it mid-approach.
    const tick = tickStatuses(actor, game.rng);
    for (const msg of tick.messages) {
      if (actor.room !== undefined && game.visible.has(actor.room)) {
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
    // A refused AI action still costs a turn, otherwise a stuck machine spins forever.
    game.schedule.spend(actor, outcome.ok ? outcome.cost : 100);

    game.notifyActorTurn(actor);
    game.reapDead();
    if (!isAlive(game.player)) return;
  }
  throw new Error("runNonPlayerTurns: the player never got a turn back (AI livelock)");
}
