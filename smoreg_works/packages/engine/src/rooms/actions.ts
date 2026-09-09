import { Faction, isAlive, type Entity, type EntityId } from "../sim/entity.js";
import type { Outcome } from "../sim/actions.js";
import { attack } from "../sim/combat.js";
import { dealDamage } from "../sim/damage.js";
import type { LogParams } from "../sim/log.js";
import { TURN_COST } from "../sim/schedule.js";
import { walkerOf, type Door, type DoorId, type RoomId } from "./graph.js";
import { canSee } from "./sight.js";
import type { RoomGame } from "./game.js";

/**
 * What a drone can do in a compartment. Six verbs, and the sixth is a door left
 * open for the game: modules, keys, ship systems and consoles are all `act`,
 * claimed by whichever system owns them (`Twist.performCommand`). Keeping them
 * inside the command union — instead of a side channel — is what keeps a voyage
 * replayable from (seed, commands).
 */
export type RoomCommand =
  | { kind: "wait" }
  | { kind: "hide" }
  | { kind: "go"; door: DoorId }
  | { kind: "attack"; target: EntityId }
  | { kind: "leave" }
  | { kind: "act"; verb: string; target?: number; slot?: number };

/**
 * A refusal, or a turn spent — with the event named as well as worded.
 *
 * A refused command writes its `reason` into the log (`RoomGame.playerCommand`)
 * and is therefore a line the player reads, so it needs the same treatment as
 * every other line: an id for whatever reacts to the event, and the values the
 * sentence was built from for whoever rewrites it. `Outcome` itself stays as it
 * is — the grid game is frozen and has no table to rewrite anything with — so
 * the two fields hang off the room half, where a `RoomOutcome` still passes for
 * an `Outcome` anywhere one is asked for.
 */
export interface RoomOutcome extends Outcome {
  key?: string;
  params?: LogParams;
}

const FAIL = (reason: string, key: string, params?: LogParams): RoomOutcome =>
  params === undefined ? { ok: false, cost: 0, reason, key } : { ok: false, cost: 0, reason, key, params };
const DONE = (cost = TURN_COST): Outcome => ({ ok: true, cost });

/** Turns a cutter needs on a locked or sealed door, and how far it carries. */
export const BREACH_TURNS = 3;
export const BREACH_NOISE = 9;

/** Half-cut door, kept as plain data on the actor so it survives a save. */
interface Breach {
  door: DoorId;
  left: number;
}

/** Runs a command for `actor`. Pure w.r.t. rendering: only mutates game state. */
export function perform(game: RoomGame, actor: Entity, cmd: RoomCommand): RoomOutcome {
  const outcome = run(game, actor, cmd);
  if (!outcome.ok) return outcome;

  // Hiding is standing still, so waiting keeps it and anything else gives it
  // away. Cutting is stricter: the three turns have to be consecutive, and
  // `doGo` has already dropped the progress if this was a different door.
  if (cmd.kind !== "wait" && cmd.kind !== "hide") actor.hidden = false;
  if (cmd.kind !== "go") clearBreach(actor);
  return outcome;
}

function run(game: RoomGame, actor: Entity, cmd: RoomCommand): RoomOutcome {
  switch (cmd.kind) {
    case "wait":
      return DONE();

    case "hide":
      return doHide(game, actor);

    case "go":
      return doGo(game, actor, cmd.door);

    case "attack":
      return doAttack(game, actor, cmd.target);

    case "leave":
      return doLeave(game, actor);

    case "act":
      return doCustom(game, actor, cmd);
  }
}

/**
 * A command the engine has no opinion about. Systems are asked in order and the
 * first one to claim it owns the turn; if nobody does, the command is refused
 * and costs nothing — a verb pressed for a module you no longer have must not
 * hand the floor to the machines.
 */
function doCustom(game: RoomGame, actor: Entity, cmd: RoomCommand): RoomOutcome {
  for (const sys of game.systems) {
    const out = sys.performCommand?.(game, actor, cmd);
    if (out) return out;
  }
  return FAIL("Nothing to do.", "engine.fail.nothing");
}

function doHide(game: RoomGame, actor: Entity): RoomOutcome {
  const room = game.roomOf(actor);
  if (!room.cover) return FAIL("There is nothing to hide behind here.", "engine.fail.cover");
  actor.hidden = true;
  if (game.visible.has(room.id)) {
    game.log.add(
      `${label(game, actor)} ${verb(game, actor, "slip")} into cover.`,
      game.schedule.time,
      "good",
      ...subject(game, actor, "engine.cover"),
    );
  }
  return DONE();
}

/**
 * One door, one turn. A closed door opens on the way through; a locked or
 * sealed one only opens for a cutter, and then it is three turns of noise
 * rather than a step — which is the whole reason a locked door is a decision.
 */
function doGo(game: RoomGame, actor: Entity, id: DoorId): RoomOutcome {
  const here = game.roomOf(actor).id;
  const door = game.ship.doors[id];
  if (!door) return FAIL("There is no such door.", "engine.fail.door.gone");
  if (door.a !== here && door.b !== here) {
    return FAIL(`The ${door.label} door is not in this room.`, "engine.fail.door.elsewhere", { door: door.label });
  }

  if (door.state === "airlock") {
    return actor.faction === Faction.Player
      ? FAIL("That is the airlock. Use `leave` to go back to the tug.", "engine.fail.airlock")
      : FAIL(`${label(game, actor)} cannot fit through ${door.label}.`, "engine.fail.door.size", {
          actor: actor.name,
          door: door.label,
        });
  }
  if (!game.ship.passable(door, walkerOf(actor))) {
    return FAIL(`The ${door.label} door is ${door.state}.`, "engine.fail.door.shut", {
      door: door.label,
      state: door.state,
    });
  }

  if (door.state === "locked" || door.state === "sealed") {
    // `passable` let it through, so this actor is a breacher.
    const left = advanceBreach(actor, door);
    game.makeNoise(here, BREACH_NOISE);
    if (left > 0) {
      logHere(
        game,
        here,
        `${label(game, actor)} ${verb(game, actor, "cut")} at ${door.label}.`,
        "warn",
        ...subject(game, actor, "engine.door.cut", { door: door.label }),
      );
      return DONE();
    }
    door.state = "broken";
    logHere(game, here, `${door.label} gives way with a shriek.`, "bad", "engine.door.breached", {
      door: door.label,
    });
  } else if (door.state === "closed") {
    door.state = "open";
    logHere(game, here, `The door ${door.label} slides open.`, "plain", "engine.door.open", { door: door.label });
  }

  clearBreach(actor);
  actor.room = game.ship.other(door, here);
  return DONE();
}

/**
 * Melee is "here", a shot is "next room through an open door". Both are this
 * one command: the target's id already says which, and only range and line of
 * sight decide whether it is legal — the same table for a drone and a machine.
 */
function doAttack(game: RoomGame, actor: Entity, target: EntityId): RoomOutcome {
  const victim = game.entities.find((e) => e.id === target);
  if (!victim || !isAlive(victim)) return FAIL("Nothing to attack there.", "engine.fail.attack.gone");
  if (victim.faction === actor.faction) return FAIL("You will not strike an ally.", "engine.fail.attack.ally");
  if (victim.room !== actor.room) {
    if ((actor.range ?? 0) < 1) {
      return FAIL(`${label(game, victim)} is not in this room.`, "engine.fail.attack.away", { target: victim.name });
    }
    if (!canSee(game.ship, actor, victim)) {
      return FAIL(`${label(game, victim)} is not in the line of fire.`, "engine.fail.attack.sight", {
        target: victim.name,
      });
    }
  }

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
      ...blow(game, actor, victim, res.damage),
    );
  }
  if (res.killed) {
    // The player's ending is written by the content pack, in `playerCommand`.
    if (victim.id !== game.player.id) {
      game.log.add(`${label(game, victim)} dies.`, game.schedule.time, tone, "engine.dies", { target: victim.name });
    }
    game.onDeath(victim);
  }
  return DONE();
}

/**
 * Out through the airlock. Where that leads is not the engine's call: a game
 * with a system that claims the outcome gets told it happened and decides,
 * and one without keeps the plain "you got out alive" ending.
 */
function doLeave(game: RoomGame, actor: Entity): RoomOutcome {
  if (actor.id !== game.player.id) return FAIL("Only the player may leave the ship.", "engine.fail.leave.other");
  const airlock = game.ship.doorsOf(game.roomOf(actor).id).find((d) => d.state === "airlock");
  if (!airlock) return FAIL("There is no airlock here.", "engine.fail.leave.none");
  game.leave();
  return DONE();
}

function advanceBreach(actor: Entity, door: Door): number {
  const open = readBreach(actor);
  const left = open && open.door === door.id ? open.left - 1 : BREACH_TURNS - 1;
  if (!actor.data) actor.data = {};
  actor.data.breaching = { door: door.id, left };
  return left;
}

/** Defensive: the bag round-trips through a save, so nothing here may be trusted. */
export function readBreach(actor: Entity): Breach | undefined {
  const raw = actor.data?.breaching;
  if (typeof raw !== "object" || raw === null) return undefined;
  const b = raw as Partial<Breach>;
  if (typeof b.door !== "number" || typeof b.left !== "number") return undefined;
  return { door: b.door, left: b.left };
}

function clearBreach(actor: Entity): void {
  if (actor.data) delete actor.data.breaching;
}

function logHere(
  game: RoomGame,
  room: RoomId,
  text: string,
  tone: "plain" | "good" | "bad" | "warn",
  key: string,
  params?: LogParams,
): void {
  if (game.visible.has(room)) game.log.add(text, game.schedule.time, tone, key, params);
}

/**
 * The key and the values for a line about somebody doing something.
 *
 * `label` and `verb` split second person from third, and a translation has to
 * split the same way — Russian has no article to hide the difference in, and
 * the drone's own line wants no name in it at all. So the split is in the key:
 * `engine.cover.you` against `engine.cover.other`, and only the second carries
 * an `actor`. The name it carries is `Entity.name`, the id the content pack
 * spawned the machine under, never a phrase — naming it in words is the
 * caller's job, and the engine has no words but English.
 */
function subject(game: RoomGame, actor: Entity, key: string, rest?: LogParams): [string, LogParams] {
  return actor.id === game.player.id
    ? [`${key}.you`, { ...rest }]
    : [`${key}.other`, { ...rest, actor: actor.name }];
}

/**
 * A blow, as three keys rather than one: who swung decides the whole sentence,
 * and in two of the three cases one of the two parties is the player and wants
 * no name printed for them.
 *
 * The two lines aimed at something other than the player carry what is left of
 * it as well as what came off. Damage alone does not answer the question the
 * line is read for — finish it or walk away — and a player who cannot answer it
 * reads a fair exchange as a broken one: the owner traded shots with a ten
 * point machine, took it to three, and had no way to know
 * (docs/owner-queue.md, 1). The third line is a blow landing on the drone, and
 * its remainder is the drone's core: the rack's own line already says which
 * module took it and what is left of that, which is the number that decides
 * anything.
 */
function blow(game: RoomGame, actor: Entity, victim: Entity, amount: number): [string, LogParams] {
  const left = { hp: Math.max(0, victim.hp), max: victim.hpMax };
  if (actor.id === game.player.id) return ["engine.hit.you", { target: victim.name, amount, ...left }];
  if (victim.id === game.player.id) return ["engine.hit.taken", { actor: actor.name, amount }];
  return ["engine.hit.other", { actor: actor.name, target: victim.name, amount, ...left }];
}

export function label(game: RoomGame, e: Entity): string {
  return e.id === game.player.id ? "You" : `the ${e.name}`;
}

/**
 * `label` is second person for the player and third for everything else, so
 * the verb has to agree with it: "You cut", but "the enforcer cuts".
 */
export function verb(game: RoomGame, actor: Entity, base: string): string {
  return actor.id === game.player.id ? base : `${base}s`;
}
