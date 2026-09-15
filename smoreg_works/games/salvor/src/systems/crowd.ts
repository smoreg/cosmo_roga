import { dealDamage, isAlive, type Entity, type RoomGame, type System } from "@jamrog/engine";
import { t } from "../i18n.js";
import { capitalize, entityLabel } from "../names.js";
import { hostilesIn, registerDamageVeto } from "../twist/rig.js";

/**
 * A crowded fight, two rules of it (G90, the owner's word): the machines in
 * the drone's compartment do not all land a blow in one turn, and a shot
 * fired at the drone from the next compartment can find one of them instead.
 *
 * Both are answered at the rig's damage seam (`twist/rig.ts`,
 * `registerDamageVeto`) rather than in the engine, which is where the blow is
 * already known to be aimed at the drone and where the engine has no word for
 * a machine. A vetoed blow is a blow that did not happen: the machine spent
 * its turn, nothing was routed into the rack, and the engine prints no `0`
 * for it (`rooms/actions.ts`, `intercepted`).
 */

/**
 * Blows that land on the drone from its own compartment in one turn: two, and
 * a third on a coin. Rolled once a turn, when the first of them arrives, so a
 * turn with one machine in the room never spends the roll.
 */
export const CROWD_BLOWS = 2;
export const CROWD_EXTRA_CHANCE = 0.5;

/**
 * A shot from the next compartment, with k machines standing beside the drone,
 * finds one of them with chance k/(k+1) and never more than this: half the
 * shots at most, so a turret behind a crowd is still a turret.
 */
export const STRAY_CAP = 0.5;

/**
 * This turn's count, on the drone. Stamped with the player turn it belongs
 * to (`game.inputs.length`, which grows once per command the machines then
 * answer), so a count left over from an earlier turn is discarded on sight —
 * the veto is registered for every game, including one built with a system
 * list this file's own hook is not on, and a stale count there would hold
 * every blow back for the rest of the run.
 */
interface CrowdTurn {
  turn: number;
  cap: number;
  hits: number;
}

function crowdTurn(game: RoomGame): CrowdTurn {
  const data = (game.player.data ??= {});
  const raw = data.crowd as Partial<CrowdTurn> | undefined;
  const turn = game.inputs.length;
  if (raw && raw.turn === turn && typeof raw.cap === "number" && typeof raw.hits === "number") {
    return raw as CrowdTurn;
  }
  const fresh: CrowdTurn = { turn, cap: CROWD_BLOWS + (game.rng.chance(CROWD_EXTRA_CHANCE) ? 1 : 0), hits: 0 };
  data.crowd = fresh;
  return fresh;
}

/** The chance a shot past k bystanders hits one of them (`STRAY_CAP` at most). */
export function strayChance(k: number): number {
  return k <= 0 ? 0 : Math.min(k / (k + 1), STRAY_CAP);
}

/**
 * A shot from another compartment, and whether it went into a machine beside
 * the drone instead. The shooter itself is never the bystander, and the
 * number that would have reached the rack is the number the machine takes.
 */
function strayShot(game: RoomGame, source: Entity, amount: number): boolean {
  const here = game.roomOf(game.player).id;
  const bystanders = hostilesIn(game, here).filter((e) => e.id !== source.id);
  if (bystanders.length === 0 || !game.rng.chance(strayChance(bystanders.length))) return false;

  const victim = game.rng.pick(bystanders);
  const res = dealDamage(game, victim, amount, source);
  game.log.add(
    t("log.shot.stray", {
      Actor: capitalize(entityLabel(game, source)),
      target: entityLabel(game, victim),
      amount: res.toHp,
      hp: Math.max(0, victim.hp),
      max: victim.hpMax,
    }),
    game.schedule.time,
    "good",
    "log.shot.stray",
  );
  if (res.killed) {
    game.log.add(
      t("log.machine.dies", { target: capitalize(entityLabel(game, victim)) }),
      game.schedule.time,
      "good",
      "log.machine.dies",
    );
    game.onDeath(victim);
  }
  return true;
}

// Asked of every blow at the drone, before the rack sees it. A blow from the
// drone's own compartment counts against this turn's cap; one from another
// compartment is a shot, and may find a bystander. Anything without a live
// hostile source — the ship's vacuum, a mine — is nobody's turn and passes.
registerDamageVeto((game, source, amount) => {
  if (!source || source.room === undefined || !isAlive(source)) return false;
  if (source.faction === game.player.faction) return false;
  if (source.room !== game.roomOf(game.player).id) return strayShot(game, source, amount);

  const turn = crowdTurn(game);
  if (turn.hits < turn.cap) {
    turn.hits += 1;
    return false;
  }
  game.log.add(
    t("log.crowd.hold", { Actor: capitalize(entityLabel(game, source)) }),
    game.schedule.time,
    "plain",
    "log.crowd.hold",
  );
  return true;
});

export const CROWD: System<RoomGame> = {
  name: "crowd",

  /**
   * Tidy the count away once the machines have answered the turn. The stamp
   * on it already makes a stale one harmless; this keeps a save from carrying
   * a dead record, and is all the system itself does — the rules above are
   * wired at import.
   */
  afterPlayerTurn(game) {
    if (game.player.data) delete game.player.data.crowd;
  },
};
