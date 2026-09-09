import {
  TURN_COST,
  isAlive,
  spawnMonsterIn,
  type ActionOffer,
  type Entity,
  type Outcome,
  type Room,
  type RoomCommand,
  type RoomGame,
  type System,
} from "@jamrog/engine";
import { BLOOM_KIND, CRAWLER } from "../content/monsters.js";
import { t } from "../i18n.js";
import { nextShipId } from "../twist/rig.js";
import { type RoomItem } from "./populate.js";

/**
 * The hatchery, and the one clock aboard that is not the alert (design-doc.md,
 * "Машины", `Y`).
 *
 * A bloom does nothing to the drone directly — its behaviour is `static`, so it
 * asks for `wait` every turn and the engine happily gives it one. Everything it
 * costs is charged from out here, which is exactly what `static` is for: the
 * engine has no idea what a hatchery is, and a machine that spawns machines is
 * a rule of this game rather than a behaviour of that one.
 *
 * What it puts in front of the player is a subtraction. Crawlers are
 * `corrosive` and leave no module, so every one of them is turns and integrity
 * spent for nothing; the bloom is eight HP that never hits back and pays two
 * credits. Killing the bloom is therefore always right and never urgent, which
 * is the decision — walk past it and it is still hatching when you come back
 * through, kill it now and the four already out are still between you and the
 * door.
 */

/** Turns of the bloom's own between hatchings. Its speed makes those the drone's. */
const HATCH_PERIOD = 6;
/** Living crawlers one bloom may have out at once. */
const MAX_BROOD = 4;
/** Credits a dead bloom is worth, stripped. design-doc.md's biomass. */
const BIOMASS_CREDITS = 2;
/** Stripping is quiet work, the same as going through a body. */
const STRIP_NOISE = 2;

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

// ------------------------------------------------------------------ hatching

/** Living crawlers this bloom has put out. Dead ones are already off the list. */
function brood(game: RoomGame, hatchery: Entity): Entity[] {
  return game.entities.filter((e) => isAlive(e) && e.data?.hatchedBy === hatchery.id);
}

/**
 * One crawler, in the bloom's own compartment.
 *
 * It carries the id of what hatched it, so the cap is per bloom and not per
 * ship: two blooms are twice the pressure, and a room cleared of crawlers is a
 * room the bloom standing in it can fill again.
 */
function hatch(game: RoomGame, hatchery: Entity, room: number): void {
  const crawler = spawnMonsterIn(CRAWLER, room);
  (crawler.data ??= {}).hatchedBy = hatchery.id;
  game.schedule.admit(crawler);
  game.entities.push(crawler);
  if (game.visible.has(room)) {
    game.log.add(t("log.bloom.hatch"), game.schedule.time, "bad", "log.bloom.hatch");
  }
}

// ------------------------------------------------------------------- biomass

/** The room's own item list, created on first use. `populate.ts` fills the rest. */
function itemsIn(room: Room): RoomItem[] {
  const data = room.data as Record<string, RoomItem[] | undefined>;
  const list = data.items ?? [];
  data.items = list;
  return list;
}

function biomassIn(room: Room): RoomItem[] {
  return itemsIn(room).filter((it) => it.kind === "biomass");
}

/** Credits picked up aboard. Same pocket the bodies and the systems pay into. */
function addLoot(player: Entity, amount: number): void {
  const data = (player.data ??= {});
  data.loot = (typeof data.loot === "number" ? data.loot : 0) + amount;
}

/**
 * `act strip {target}`: take the dead bloom apart for what biology is worth.
 *
 * Its own verb rather than the rig's `salvage`, because the two answer
 * different questions: `salvage` asks the rack what a module would do for it,
 * and biomass is never a module — design-doc.md is explicit that biology drops
 * nothing to install. The rig claims every `salvage` it is handed (a refusal is
 * still a claim), so sharing the verb would mean rewriting that refusal; a
 * second verb costs the player one word in a list they are already reading.
 */
function strip(game: RoomGame, target: number | undefined): Outcome {
  const room = game.roomOf(game.player);
  const items = itemsIn(room);
  const i = items.findIndex(
    (it) => it.kind === "biomass" && (target === undefined || it.id === target),
  );
  if (i < 0) return FAIL(t("why.biomass.none"));

  items.splice(i, 1);
  addLoot(game.player, BIOMASS_CREDITS);
  game.makeNoise(room.id, STRIP_NOISE);
  game.log.add(
    t("log.bloom.strip", { cr: BIOMASS_CREDITS }),
    game.schedule.time,
    "good",
    "log.bloom.strip",
  );
  return DONE();
}

// -------------------------------------------------------------- the system

export const BLOOM: System<RoomGame> = {
  name: "bloom",

  /**
   * The hatchery's clock. Counted in the bloom's own turns and kept on the
   * bloom — `actor.data` rides the entity through a save and through a sortie
   * ashore, so a hatchery half-way to its next crawler is still half-way there
   * when the drone cycles back aboard.
   */
  afterActorTurn(game, actor) {
    if (actor.name !== BLOOM_KIND.name || !isAlive(actor) || actor.room === undefined) return;

    const data = (actor.data ??= {});
    const turns = (typeof data.hatchTurns === "number" ? data.hatchTurns : 0) + 1;
    data.hatchTurns = turns;

    if (turns % HATCH_PERIOD !== 0) return;
    // The cap is on what is alive, not on what has ever been hatched: clearing
    // the brood is worth doing, and it is worth doing again.
    if (brood(game, actor).length >= MAX_BROOD) return;
    hatch(game, actor, actor.room);
  },

  /**
   * A dead bloom leaves biomass and not scrap. The rig drops a module for every
   * machine whose bestiary row names one (`RIG.onDeath`), and neither of the
   * two biology rows does — so the compartment gets this instead, and the
   * player who cleared the nest gets paid for it.
   */
  onDeath(game, victim) {
    if (victim.name !== BLOOM_KIND.name || victim.room === undefined) return;
    itemsIn(game.ship.roomAt(victim.room)).push({ id: nextShipId(game), kind: "biomass" });
    game.log.add(t("log.bloom.dies"), game.schedule.time, "plain", "log.bloom.dies");
  },

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== "strip") return undefined;
    return strip(game, cmd.target);
  },

  offerActions(game) {
    const offers: Array<ActionOffer<RoomCommand>> = [];
    if (game.status !== "playing") return offers;

    for (const it of biomassIn(game.roomOf(game.player))) {
      offers.push({
        label: t("action.strip", { cr: BIOMASS_CREDITS }),
        cmd: { kind: "act", verb: "strip", target: it.id },
        enabled: true,
      });
    }
    return offers;
  },
};
