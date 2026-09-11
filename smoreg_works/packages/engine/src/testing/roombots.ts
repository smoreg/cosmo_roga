import { isAlive, type Entity } from "../sim/entity.js";
import type { ActionOffer } from "../sim/twist.js";
import type { RoomCommand } from "../rooms/actions.js";
import type { RoomGame } from "../rooms/game.js";
import { walkerOf, type Door, type DoorId, type RoomId } from "../rooms/graph.js";
import { RoomDistance, type DoorFilter } from "../rooms/paths.js";
import type { Playable, PlayBot, PlayOptions } from "./metrics.js";

/**
 * The graph twin of `bots.ts`: the same three roles, playing a ship of
 * compartments instead of a floor of tiles.
 *
 *   random   — the fuzz tester: every verb, including the ones that must be
 *              refused, so a refusal is proved to cost nothing
 *   greedy   — a first-time player: walks to the deepest compartment it has
 *              never stood in, hits whatever is in the room, and leaves once
 *              the ship has nothing left to see. The floor of the curve.
 *   careful  — a competent player: spends the game's own verbs when the game
 *              says they are worth a turn — each of them once, never on a
 *              door, and never on the way out until the ship is walked, unless
 *              the ship it came off still had compartments nobody had stood in
 *              — backs out of a room it is losing, and takes cover when told
 *              there is a reason to. The ceiling.
 *
 * A bot knows the engine's six verbs and not one word of any game. Everything a
 * game invents reaches it through `Twist.offerActions` — a label, a command and
 * "you can do this now" — which is why the same three bots can score a
 * derelict, a tug and whatever gets built after them.
 */
export type RoomBot = PlayBot<RoomGame, RoomCommand>;

/**
 * Bots are created per run. Anything a bot remembers (how long it has been
 * backing away, say) must not leak between runs, or the harness stops measuring
 * the game and starts measuring the previous seed.
 */
export type RoomBotFactory = () => RoomBot;

/** No entity ever has this id, so attacking it is always the refusal path. */
const NO_SUCH_ENTITY = -1;

export const randomBot: RoomBot = (game, rng) => {
  const roll = rng.int(0, 11);
  if (roll === 0) return { kind: "wait" };
  if (roll === 1) return { kind: "hide" };
  if (roll === 2) return { kind: "leave" };
  // A verb no system has ever heard of, one turn in twelve. `act` is the door
  // every game's own vocabulary comes through, so the engine has to refuse an
  // unknown one — and a slot that holds nothing — without a roll, without
  // throwing and without handing the floor to the machines.
  if (roll === 3) return { kind: "act", verb: "zzz", slot: rng.int(0, 3) };
  if (roll === 4) {
    // Disabled offers are pressed on purpose: refusing them is the contract.
    const acts = offers(game).filter((o) => o.cmd.kind === "act");
    if (acts.length > 0) return rng.pick(acts).cmd;
  }

  const here = game.roomOf(game.player).id;
  if (roll <= 6) {
    // Corpses, allies and the drone itself included; a made-up id when the
    // room is empty, because "attack nothing" is a refusal worth exercising.
    const targets = game.entitiesIn(here);
    return { kind: "attack", target: targets.length > 0 ? rng.pick(targets).id : NO_SUCH_ENTITY };
  }

  // Every door of this room, including the ones this drone cannot open:
  // walking into a sealed bulkhead must cost nothing.
  const doors = game.ship.doorsOf(here);
  return doors.length === 0 ? { kind: "wait" } : { kind: "go", door: rng.pick(doors).id };
};

export const greedyBot: RoomBot = (game, _rng) => {
  const here = game.roomOf(game.player).id;

  const prey = game.entitiesIn(here).find(enemyOf(game));
  if (prey) return { kind: "attack", target: prey.id };

  const onward = exploreDoor(game, here);
  if (onward) return throughDoor(game, onward);

  return new WayOut().step(game) ?? { kind: "wait" };
};

/**
 * The same bot with one thing to fall back on: when there is nothing to fight
 * and nothing left to sweep, press whatever the game says can be done here.
 *
 * Without it a swept ship is a livelock rather than an ending. `leave` is the
 * only verb the stateless bot has left, and a run that spans several ships
 * comes out of one airlock straight into another: arrive, find nothing to
 * explore, leave, arrive, leave — two commands a turn, for as long as the
 * harness will let it, on sixteen of thirty-two seeds. The only thing that
 * used to end those runs was the world killing the drone.
 *
 * Last, not first: careful spends the game's verbs the moment they are worth a
 * turn, greedy only once it has run out of ship. That order is the whole
 * distance between the two roles.
 */
export function makeGreedyBot(): RoomBot {
  const offers = new OfferMemory();
  const walk = new Walked();
  const out = new WayOut();

  return (game, _rng) => {
    const here = walk.arrive(game);
    offers.arrived(game, here);

    const prey = game.entitiesIn(here).find(enemyOf(game));
    if (prey) return { kind: "attack", target: prey.id };

    const onward = exploreDoor(game, here, walk.seen);
    if (onward) return throughDoor(game, onward);

    // Nothing left to sweep, so nothing is being cut short: every offer here is
    // fair game, the ways off this ship included.
    const offer = offers.take(game, here, true);
    if (offer) {
      out.acted();
      return offer;
    }

    return out.step(game) ?? sweepAgain(game, walk, here);
  };
}

/**
 * Nothing here, nothing new aboard, and no way off: walk the ship again and
 * see what the other compartments are offering this time round.
 */
function sweepAgain(game: RoomGame, walk: Walked, here: RoomId): RoomCommand {
  walk.again(here);
  const onward = exploreDoor(game, here, walk.seen);
  return onward ? throughDoor(game, onward) : { kind: "wait" };
}

/**
 * The compartments the bot has stood in **since it last came aboard this ship**
 * — which is not the same question as `Room.explored`.
 *
 * A derelict is persistent: the map stays drawn once the drone has seen it, and
 * a bot that sweeps by `explored` therefore has nothing to do the second time
 * it walks in. Nothing to do means straight back out of the airlock, and out of
 * the airlock is another ship where there is also nothing to do — two commands
 * a turn between a tug and a hull for as long as the harness will run, on
 * sixteen of thirty-two seeds. A ship musters machines into the rooms you
 * already know while you are away, so walking the known map again is not
 * busywork; it is the trip.
 */
class Walked {
  private ship: string | undefined;
  private rooms = new Set<RoomId>();

  get seen(): ReadonlySet<RoomId> {
    return this.rooms;
  }

  /** Where the drone is, with the count reset if this is a different ship. */
  arrive(game: RoomGame): RoomId {
    if (game.shipId !== this.ship) {
      this.ship = game.shipId;
      this.rooms = new Set();
    }
    const here = game.roomOf(game.player).id;
    this.rooms.add(here);
    return here;
  }

  /**
   * Start the sweep again from this compartment.
   *
   * For the case where a bot has run out of ship, run out of things to do here
   * and cannot get off: whatever it needs is in another compartment. An offer
   * list only ever describes the room the drone is standing in — the bot cannot
   * see that the jump it can afford is two doors away at the helm — so walking
   * the ship again is the only way to find one. Measured: five of two hundred
   * voyages stood at a sold hull's airlock with 239 CR and the price of the
   * jump was 30.
   */
  again(here: RoomId): void {
    this.rooms = new Set([here]);
  }
}

/**
 * How much of each ship the drone has walked, visit by visit.
 *
 * One question, asked of the ship the drone has just come off: did the last
 * trip aboard it stand in a compartment nobody had stood in before? A ship
 * still answering yes has something left on it. Counted off `Room.explored` and
 * nothing else, so it is a fact about a ship rather than about anything a game
 * calls what is in one.
 *
 * "Did it grow" and not "is any of it unexplored", and the difference is the
 * bound. Measured on the shipped game with the stricter reading — never move on
 * while one compartment is unseen — voyages stalled on their first hull: the
 * tug reached the last hull of the itinerary on 3 % of seeds against 16 %, and
 * two runs of thirty-two never reached an ending at all. Some compartments are
 * behind a bulkhead this drone will never open, and `explored` cannot tell
 * those from the ones another trip would find. A trip that finds nothing can.
 */
class Visits {
  private ship: string | undefined;
  private previous: string | undefined;
  private atArrival = 0;
  private latest = 0;
  /** Ships whose last completed visit added a compartment to the count. */
  private grew = new Map<string, boolean>();

  /** Called once a turn, before anything is decided. */
  turn(game: RoomGame): void {
    const count = game.ship.rooms.filter((r) => r.explored).length;
    if (game.shipId !== this.ship) {
      if (this.ship !== undefined) {
        this.grew.set(this.ship, this.latest > this.atArrival);
        this.previous = this.ship;
      }
      this.ship = game.shipId;
      this.atArrival = count;
    }
    this.latest = count;
  }

  /** Did the last visit to the ship the drone came here from find anything new? */
  cameFromGrowing(): boolean {
    return this.previous !== undefined && (this.grew.get(this.previous) ?? false);
  }
}

/**
 * The way off this ship: out through the airlock — the one ending the engine
 * owns, and the cue a voyage system waits for to fly on — or one step towards
 * it. Nothing, when the airlock is underfoot and will not open.
 *
 * That last case is why this is a class and not a function. `atAirlock()` says
 * the drone is standing at one, not that pressing it does anything: a system
 * can refuse — measured, a voyage whose current hull has been sold and taken
 * under tow refuses `undock` until the tug jumps — and a bot that answers "get
 * off this ship" with `leave` every turn then presses a refusal for the rest of
 * the run. Five of two hundred voyages ended that way, each with the price of
 * the jump sitting in the account. A press that leaves the drone on the same
 * ship it was on is the whole of the evidence needed, and the answer is to go
 * and do something else instead.
 */
class WayOut {
  private tried: { ship: string; at: number } | undefined;
  /** The airlock of the ship underfoot has been pressed and did nothing. */
  private blocked = false;
  private ship: string | undefined;

  step(game: RoomGame): RoomCommand | undefined {
    if (game.shipId !== this.ship) {
      this.ship = game.shipId;
      this.blocked = false;
      this.tried = undefined;
    }
    if (this.refused(game)) this.blocked = true;
    if (this.blocked) return undefined;

    if (game.atAirlock()) {
      this.tried = { ship: game.shipId, at: game.inputs.length };
      return { kind: "leave" };
    }
    const here = game.roomOf(game.player).id;
    const back = walkDoors(game);
    const home = RoomDistance.from(game.ship, [game.ship.entry], back).nextDoor(here, back);
    return home ? { kind: "go", door: home.id } : undefined;
  }

  /**
   * The bot did something the game offered, so whatever was holding the airlock
   * shut may not be holding it any more — try it again.
   *
   * Without this the memory would have to be either one turn long, which walks
   * the drone back to a refusing airlock every other turn, or forever, which is
   * a drone that can never undock again.
   */
  acted(): void {
    this.blocked = false;
    this.tried = undefined;
  }

  /** Did the last press of the airlock leave the drone standing where it was? */
  private refused(game: RoomGame): boolean {
    const tried = this.tried;
    if (!tried) return false;
    // A refusal costs the harness one idle command on top of the press itself.
    if (game.inputs.length - tried.at > 2) return false;
    return game.shipId === tried.ship;
  }
}

/** Retreating forever is not skill, it is a livelock: cap it. */
const MAX_CONSECUTIVE_RETREATS = 8;

/** The same for cover: a bot that only ever hides is not careful, it is asleep. */
const MAX_CONSECUTIVE_HIDES = 4;

/**
 * And for a job several turns long: past this many turns in a row on one offer,
 * "the job is still running" and "this offer never goes away" look the same
 * from out here, so the bot stops paying for the difference.
 */
const MAX_JOB_TURNS = 6;

/**
 * What the drone could do the turn it came aboard: how fast it moves and the
 * most one swing of it is worth.
 *
 * Two engine fields, and the only window a bot has onto a game whose real
 * health is somewhere else entirely. A drone whose armour is its own abilities
 * spends them long before a single hit point moves — measured, thirty-two seeds
 * of the shipped game: the careful bot died with its core untouched until the
 * last two turns of every run, because by then the rack that stood in front of
 * it was gone. Speed and damage fall as that happens, so they are what "this is
 * going badly" looks like from out here, without the bot ever learning the word
 * for what it is wearing.
 */
interface Kit {
  hp: number;
  speed: number;
  damage: number;
  sight: number;
}

function kitOf(e: Entity): Kit {
  return {
    hp: e.hp,
    speed: e.speed,
    damage: e.damage[0] * e.damage[1] + e.damage[2],
    sight: e.sight ?? 0,
  };
}

/** How many of the three the drone could do before and cannot now. */
function losses(was: Kit, e: Entity): number {
  const now = kitOf(e);
  return (
    (now.speed < was.speed ? 1 : 0) + (now.damage < was.damage ? 1 : 0) + (now.sight < was.sight ? 1 : 0)
  );
}

/** Anything the drone could do before and cannot now. */
function weaker(was: Kit, e: Entity): boolean {
  return losses(was, e) > 0;
}

/**
 * Is this a different drone from the one the mark was taken off?
 *
 * Hit points going *up* is the tell, and the only one that cannot be anything
 * else: a rack is repaired and salvaged all through a sortie, but a core is
 * never healed, so more of it than there was means a hull came off the rack.
 *
 * Sampling the ship underfoot does not catch it. A voyage can undock, lose the
 * drone and be put back on the tug between two turns of the bot, and the mark
 * then belongs to a drone that no longer exists: measured, the bot read the
 * empty rack it was standing next to as a rack it had ruined, and pressed the
 * airlock with 51 CR and `buy` on the list for the rest of the run.
 */
function replaced(kit: Kit, e: Entity): boolean {
  return e.hp > kit.hp;
}

/**
 * Far enough gone to be worth taking home: hit points off the core, or two of
 * the three things a rack does.
 *
 * One of the three is too soon — measured, the bot then turned for the airlock
 * after the first module of every sortie and saw six compartments of a
 * fourteen-compartment ship, which is a bot that never finds anything. Waiting
 * for the core is too late: by then the rack is gone and so is the walk home.
 *
 * Hit points are read against what came aboard, not against the maximum. A core
 * that never heals is a fair rule for a game to have, and against `hpMax` it
 * means one hit ends every sortie the drone will ever fly: measured, the bot
 * undocked and pressed `leave` on the same turn, sixteen sorties running.
 */
function failing(kit: Kit, e: Entity): boolean {
  return e.hp < kit.hp || losses(kit, e) >= 2;
}

/**
 * Offers already spent during one stay in one compartment.
 *
 * "Worth a turn" needs a bound, because an offer list is written for someone
 * who can read it:
 *
 *   once per stay — an offer still on the list after being pressed is usually
 *   one that undid itself, and pressing it again is a loop rather than a plan.
 *   The exception is the offer pressed last turn, for a few turns: that is a
 *   job several turns long, and breaking one off wastes every turn already
 *   spent on it.
 *
 *   never on a door — what to do with a bulkhead is a routing decision, and
 *   `throughDoor` already makes it on the one door the sweep needs. Taken in
 *   list order instead, the same verbs read as: shut this door, weld it, then
 *   cut it open again, in every compartment, forever.
 *
 *   never a way off, while there is ship left — a verb the drone has once
 *   pressed and found itself on another ship is the end of a visit, and ending
 *   one early skips everything the rest of this ship was offering. Learned, not
 *   told: nothing in a list says where a line leads.
 *
 *   once a run for a line that does not move — pressed, and back word for word,
 *   means the whole of what it did is somewhere out of sight; the second press
 *   is the same bargain as the first.
 */
class OfferMemory {
  private room: string | undefined;
  private spent = new Set<string>();
  /** The one spent last turn, so a job that runs several turns may go on. */
  private running: string | undefined;
  /** Turns in a row already spent on `running`. */
  private jobTurns = 0;
  /** Verbs that cost the drone something, learned the one time each. */
  private harmful = new Set<string>();
  /** Verbs whose line came back word for word, learned the same way. */
  private idle = new Set<string>();
  /** Verbs that put the drone on a different ship: ways off, learned once. */
  private exits = new Set<string>();
  /** The offer pressed last turn, its line, where, when, and what the drone could do. */
  private tried:
    | { key: string; verb: string; label: string; ship: string; where: string; kit: Kit; at: number }
    | undefined;

  /**
   * True when this is a compartment the bot has only just walked into.
   *
   * Named by ship as well as by compartment: a `RoomId` is an index into one
   * ship's own list, so the tug's entry compartment and a derelict's airlock
   * are both zero. Without the ship in the name a bot that undocked from the
   * tug and came back to it never cleared the offers it had spent there — a run
   * that lost its drone then stood at the airlock with 75 CR and `buy` on the
   * list, pressing the airlock, until the harness gave up.
   */
  arrived(game: RoomGame, room: RoomId): boolean {
    const name = `${game.shipId}/${room}`;
    if (name === this.room) return false;
    this.room = name;
    this.spent = new Set();
    this.running = undefined;
    return true;
  }

  /** Whatever else the bot did this turn, it is not the job it was running. */
  broke(): void {
    this.running = undefined;
  }

  /**
   * The next `act` offer worth a turn here, or nothing. Only `act` offers — the
   * engine's six verbs are the bot's own business, and pressing an offered `go`
   * would make it wander.
   */
  take(game: RoomGame, here: RoomId, mayLeave: boolean): RoomCommand | undefined {
    const list = offers(game);
    this.learn(game, list);
    const doors = new Set<DoorId>(game.ship.doorsOf(here).map((d) => d.id));
    const refused = disabled(list);

    // In the list's own order, and that was measured rather than assumed. A
    // list orders itself for a reader who knows what the lines mean — the
    // shipped game's DOCK counts its hulls out cheapest first — so preferring a
    // line this run has never pressed is a way to reach past the cheap one
    // without ever reading a price. Tried on 32 seeds: it is worse, and not
    // marginally. The two hulls the bot then bought carry neither a cutter nor
    // a cell, so a drone in one of them cannot bring a single system online;
    // voyages went from three sorties to two, from 118 turns to 86, and the bot
    // spent the difference travelling to hulls it could do nothing with (63 %
    // reached the last one, against a target of 10-30 %).
    for (const offer of list) {
      const cmd = offer.cmd;
      if (!offer.enabled || cmd.kind !== "act") continue;
      if (cmd.target !== undefined && doors.has(cmd.target)) continue;
      const key = offerKey(cmd);
      if (refused.has(key) || this.harmful.has(cmd.verb) || this.idle.has(cmd.verb)) continue;
      if (!mayLeave && this.exits.has(cmd.verb)) continue;
      const job = key === this.running;
      if (this.spent.has(key) && (!job || this.jobTurns >= MAX_JOB_TURNS)) continue;
      this.spent.add(key);
      this.jobTurns = job ? this.jobTurns + 1 : 1;
      this.running = key;
      this.tried = {
        key,
        verb: cmd.verb,
        label: offer.label,
        ship: game.shipId,
        where: `${game.shipId}/${here}`,
        kit: kitOf(game.player),
        at: game.inputs.length,
      };
      return cmd;
    }
    this.running = undefined;
    return undefined;
  }

  /**
   * The one thing an offer list cannot say: that taking this offer costs you
   * the thing it is about.
   *
   * "Enabled" means the rule allows it, not that it is a good idea, and the
   * shipped game has one that is not: the tug's hold buys a module straight
   * out of the rack, and a rack is worth more than the hull it came on — so a
   * bot pressing every enabled offer in order sold the drone it was about to
   * fly, bought another, sold that one, and made money on every drone it lost.
   * The run then could not end at all.
   *
   * So an offer is tried once and judged by what it did, and what is learned is
   * the **verb**. Per offer it used to be, on the argument that only some lines
   * of a verb are a bad idea — a freighter carried no cargo, so handing modules
   * in was the whole of that game's economy. Measured once the hulls carried
   * cargo and the hold stopped paying more for a rack than a hull cost: a rack
   * is six lines of one verb, one line per slot, so the bot sold all six before
   * the first of them had taught it anything, undocked with nothing bolted on
   * and died in the compartment behind the airlock on thirty of thirty-two
   * seeds. One line of a verb costing the drone something it could do is all
   * the evidence there is going to be; the rest of that verb's lines are the
   * same offer aimed at the next slot.
   *
   * Only in a quiet turn: a module burning under fire is the fight's doing, not
   * the offer's.
   *
   * The second thing learned here is cheaper and has nothing to do with the
   * drone: whether the line moved at all. A list is written for someone who can
   * read it, so a job several turns long counts itself down — `salvage 2/3`,
   * `work ENGINE (2 turns)`, `upload (4 turns)` — and a line that comes back
   * word for word after being pressed is one whose whole effect is somewhere
   * the bot cannot see. Pressing it again is the same bargain again, and the
   * shipped game has one that is quietly ruinous: the bench grows a module's
   * base by one for twelve credits, per module, and the line is unchanged
   * afterwards, so a bot pressing every enabled offer emptied the account on
   * the workbench it walked past and then could not pay the thirty credits for
   * the jump two compartments further on. Measured on 32 seeds: 3.3 of them a
   * voyage, 40 CR, which is a whole hull — and every voyage ended one drone in,
   * on an account too thin to buy the next one.
   *
   * Learned per verb and for the whole run, exactly like the one above it: a
   * bargain that showed nothing the first time shows nothing the second. What
   * it never catches is a verb whose lines differ — the weakest module is a
   * different slot after it is mended, so mending goes on — and that is the
   * distinction worth having.
   */
  private learn(game: RoomGame, list: ReadonlyArray<ActionOffer<RoomCommand>>): void {
    const tried = this.tried;
    this.tried = undefined;
    // Only the turn straight after it. This list is consulted when the bot has
    // nothing else to do, which on a derelict can be many turns of fighting
    // later — and blaming those on the offer taught the bot that buying a drone
    // makes it weaker, after which it stood on the tug with 75 CR pressing the
    // airlock for the rest of the run.
    if (!tried || game.inputs.length - tried.at > 2) return;
    if (game.shipId !== tried.ship) this.exits.add(tried.verb);
    // Only where it was pressed: the same words on another list are another
    // offer. A tug that puts `cast off` in the airlock of every hull it ties up
    // to would otherwise teach the bot, in one press, that casting off shows it
    // nothing — after which the voyage has nowhere to go.
    const here = `${game.shipId}/${game.roomOf(game.player).id}`;
    if (here === tried.where && list.some((o) => o.enabled && sameOffer(o, tried))) {
      this.idle.add(tried.verb);
    }
    if (game.visibleMonsters().length > 0) return;
    if (weaker(tried.kit, game.player)) this.harmful.add(tried.verb);
  }
}

/** The same line, pressing the same command: the list did not move. */
function sameOffer(offer: ActionOffer<RoomCommand>, tried: { key: string; label: string }): boolean {
  return offer.cmd.kind === "act" && offer.label === tried.label && offerKey(offer.cmd) === tried.key;
}

/**
 * One offer, named by the command it presses — verb, and whatever the verb is
 * aimed at.
 *
 * `slot` counts as much as `target` does. Without it every `sell` of a rack is
 * one offer to the memory below, and the six-turn allowance a long job gets
 * turns into six of them pressed in a row.
 */
function offerKey(cmd: RoomCommand & { kind: "act" }): string {
  return `${cmd.verb}/${cmd.target}/${cmd.slot}`;
}

/**
 * Commands some system in the list says cannot be done right now.
 *
 * The list is a union over systems and two of them may well describe the same
 * command — one that knows the rule and one that does not. A disagreement is
 * settled the safe way: an offer any system marks disabled is not pressed,
 * whatever another copy of it claims. It is worth keeping even now that the one
 * game with two copies of a list has stopped emitting them (the tug used to
 * offer its four stations twice, once gated by compartment and once not, and
 * the ungated copy was how a bot standing at the airlock spent eighteen turns a
 * visit on commands the game then refused): a bot reads a union of lists it did
 * not write, and the safe reading of a disagreement is the same either way.
 */
function disabled(list: ReadonlyArray<ActionOffer<RoomCommand>>): Set<string> {
  const out = new Set<string>();
  for (const o of list) {
    if (!o.enabled && o.cmd.kind === "act") out.add(offerKey(o.cmd));
  }
  return out;
}

export function makeCarefulBot(): RoomBot {
  let retreats = 0;
  let hides = 0;
  const memory = new OfferMemory();
  const walk = new Walked();
  const out = new WayOut();
  const visits = new Visits();
  /** The ship underfoot, and what the drone could do when it stepped onto it. */
  let ship: string | undefined;
  let kit: Kit | undefined;
  /**
   * The sortie has been judged failing, and stays judged until the ship or the
   * drone changes — never a turn at a time.
   *
   * `failing` reads the drone's abilities, and a compartment can take one away
   * for exactly as long as the drone stands in it: measured, a room effect that
   * costs speed made the bot read "I am weaker" inside, turn for the airlock,
   * get its speed back one door out, read "I am fine", turn round and walk back
   * in — for the rest of the run, on the threshold of one compartment. A
   * decision to go home is a decision about the trip, so it is kept until the
   * trip ends: the ship underfoot changes, or a hull comes off the rack
   * (`replaced`). Wins over 200 seeds 8 → 12, and the one run that used to be
   * still walking when the harness gave up now ends.
   */
  let spent = false;

  return (game, _rng) => {
    visits.turn(game);
    const here = walk.arrive(game);
    if (memory.arrived(game, here)) hides = 0;
    /**
     * The ship the drone came off still had something on it, so the way back is
     * worth more than the rest of the ship underfoot: take a way off the moment
     * one is offered, instead of holding it until this ship has been walked.
     *
     * The rule it suspends is the one that keeps a way off for last (below),
     * and suspending it is the point. What that rule cost when it was measured
     * on a tug you had to walk: the bot reached the HELM, bought the jump to
     * the next hull the turn it could afford one, and never came back — so a
     * freighter with two of its three systems up and a 120 CR sale on it was
     * abandoned for a hull the drone had not seen. Hulls sold went from 0.19 a
     * voyage to 0.09 and the systems raised on the first hull from 1.84 to
     * 1.72. Nothing on a numbered list says that moving on throws a sale away;
     * what the bot can see is that it left compartments it had never stood in.
     *
     * It cannot strand the drone. Every way off is still one line of a list,
     * and a line the game refuses is skipped like any other — so a hull that
     * has been sold out from under the tug, whose airlock is shut until the tug
     * flies on, simply leaves the bot walking to the compartment where the
     * flying-on is sold.
     */
    const goBack = visits.cameFromGrowing();
    // Per ship, not per run: a sortie is judged against the drone that undocked
    // for it, so a rack that came back short does not send the next trip
    // straight home again.
    if (game.shipId !== ship) {
      ship = game.shipId;
      kit = kitOf(game.player);
      spent = false;
    }
    if (replaced(kit!, game.player)) {
      kit = kitOf(game.player);
      spent = false;
    }
    spent ||= failing(kit!, game.player);

    const inHere = game.entitiesIn(here).filter(enemyOf(game));
    // The counter resets on a genuine escape — nothing in sight at all — not
    // merely on a turn spent otherwise: resetting per non-retreat turn lets
    // retreat and fight alternate forever, which the harness reports as a stuck
    // run. The grid bot learned this the same way.
    if (game.visibleMonsters().length === 0) retreats = 0;

    // What is standing here is settled before anything else. It used to be the
    // other way round — the game's own verbs first, whatever was in the room —
    // and the shipped game showed what that costs: the bot took a wreck apart
    // and grafted the module on while a scout hit it every turn, and the turns
    // it gave away that way were most of the rack.
    if (inHere.length > 0) {
      memory.broke();
      hides = 0;
      if (spent && retreats < MAX_CONSECUTIVE_RETREATS) {
        // Doors that simply open, never a cut: three turns of sawing with
        // something hitting you is not an escape.
        //
        // Away from here, and not towards the airlock, which was measured and
        // is worse: a retreat aimed at the way out gives up depth every time
        // something walks into the room, and the compartments a voyage is
        // finally won in are the deep ones. Over 200 seeds it lifted what a
        // sortie brings home (78 % of first sorties repaid the hull against
        // 73 %) and took the last hull of the itinerary from four voyages with
        // three systems up to one, and from three wins to none.
        const walk = walkDoors(game);
        const away = RoomDistance.from(game.ship, [here], walk).flee(walk);
        const step = away.nextDoor(here, walk);
        if (step) {
          retreats++;
          return { kind: "go", door: step.id };
        }
        // Cornered: fight.
      }
      return { kind: "attack", target: inHere[0]!.id };
    }

    const onward = exploreDoor(game, here, walk.seen);
    const atExit = game.atAirlock();

    // A sortie is a trip out and back. Once the drone is worth less than it
    // came aboard with, the rest of the ship is somebody else's problem: go to
    // the airlock and out of it, which is the only way anything carried ever
    // becomes anything at all.
    //
    // Ahead of the two below, and that is the whole of it. Behind them the rule
    // never fired: a ship with a wreck to strip, a system to bring up or a
    // corner to hide in always had one more thing on the list, so the bot stood
    // its ground through burned thrusters, a burned cutter and a hunter in the
    // doorway on all thirty-two seeds, and never once reached a second sortie.
    // ...unless the airlock will not open, in which case there is nothing to
    // be gained by pressing it and the list below is where the way on is.
    if (spent) {
      // Standing on the way out is the one moment the offers here are worth the
      // turn they cost: whatever this compartment holds is about to be left
      // behind, and everything carried is only worth something on the far side
      // of the door.
      if (atExit) {
        const last = memory.take(game, here, true);
        if (last) {
          out.acted();
          return last;
        }
      }
      const away = out.step(game);
      if (away) return away;
      if (!atExit) {
        const offer = memory.take(game, here, true);
        if (offer) {
          out.acted();
          return offer;
        }
      }
    } else {
      // The game's own verbs, because they are the ones the engine cannot
      // judge: a keycard never used and a wreck never salvaged leave careful an
      // expensive copy of greedy. An enabled offer has already been declared
      // worth a turn by the system that owns it, so it is spent without
      // second-guessing — except the one kind of offer the bot has learned to
      // recognise: a way off this ship, which waits until there is no ship left
      // to see.
      //
      // What it was worth when it was learned: the shipped game's tug was four
      // compartments and `undock → freighter` was the first enabled line of the
      // first one, so the bot pressed it on turn zero of every visit home and
      // never once stood at the HELM two doors away, where the charters were
      // signed. Measured on 32 seeds: 0.00 charters a voyage, and a voyage that
      // ended on its first hull.
      //
      // The tug stopped being a ship in G53 and this rule stopped protecting
      // the charters with it — a list nobody walks has nothing to hold a way
      // off behind. What holds them now is the order of the tug's own list
      // (`systems/voyage.ts`, `STATION_ORDER`), which is where that argument
      // belongs. The rule itself is untouched and is about derelicts, where it
      // is the difference between a swept hull and a sortie abandoned at the
      // first airlock.
      const offer = memory.take(game, here, goBack || onward === undefined);
      if (offer) {
        out.acted();
        return offer;
      }
    }

    // Cover is only worth a turn when the game says so. `hide` in an empty
    // quiet room is a turn given away, and only the system running the alert
    // knows whether something is coming down the corridor. Capped all the same:
    // a system with cover to offer usually offers it every turn the drone
    // stands there, and a bot that takes it every turn never leaves the room.
    // The cap counts a stay, not a streak: taking an offer used to reset it,
    // and a compartment with cover and anything at all to do in it came out as
    // hide, hide, hide, hide, salvage, hide, hide, hide, hide.
    if (
      hides < MAX_CONSECUTIVE_HIDES &&
      game.roomOf(game.player).cover &&
      offers(game).some((o) => o.enabled && o.cmd.kind === "hide")
    ) {
      hides++;
      return { kind: "hide" };
    }

    if (onward) return throughDoor(game, onward);
    return out.step(game) ?? sweepAgain(game, walk, here);
  };
}

export const BOTS_ROOMS: Record<string, RoomBotFactory> = {
  random: () => randomBot,
  greedy: makeGreedyBot,
  careful: makeCarefulBot,
};

/** Compartments the drone has stood in: the default score of a sortie. */
export function roomsExplored(game: RoomGame): number {
  return game.ship.rooms.filter((r) => r.explored).length;
}

export interface RoomPlayOptions {
  make(seed: number): RoomGame;
  maxSteps?: number;
  progress?(game: RoomGame): number;
  metrics?(game: RoomGame): Record<string, number>;
}

/**
 * `PlayOptions` for a ship run — where the graph model meets `Playable`.
 *
 * `RoomGame` scores nothing by itself, on purpose: how far a sortie got is the
 * harness's question, not the turn cycle's, and a game that grows an answer of
 * its own (credits, ships sold) implements `progress()` and `metrics()` rather
 * than teaching the engine to count them.
 *
 * Which is why the game's own answer is asked for before the default one. A run
 * that spans several ships — out of a derelict, onto a tug, on to the next hull
 * — is scored by `roomsExplored` at whatever the drone happens to be standing
 * on when it ends, and one room of tug is not how far a voyage got. Order: what
 * the caller asked for, then what the game says, then the ship underfoot.
 */
export function roomPlay(opts: RoomPlayOptions): PlayOptions<RoomGame, RoomCommand> {
  return {
    make: opts.make,
    maxSteps: opts.maxSteps,
    progress: opts.progress ?? ((game) => ownProgress(game) ?? roomsExplored(game)),
    metrics: opts.metrics,
    idle: { kind: "wait" },
  };
}

/**
 * What the game scores itself at, if it scores itself at all. `RoomGame` does
 * not implement `Playable.progress` — the cast is the whole of the question:
 * did whoever built this run bolt an answer onto it?
 */
function ownProgress(game: RoomGame): number | undefined {
  return (game as Partial<Playable<RoomCommand>>).progress?.();
}

/**
 * Everything the systems say can be done here, in system order. The bot's one
 * channel of knowledge about the game it is playing: the engine's own verbs it
 * works out for itself, and every word a game invented sits behind `act`,
 * labelled and enabled by whoever owns it.
 */
function offers(game: RoomGame): Array<ActionOffer<RoomCommand>> {
  return game.systems.flatMap((s) => s.offerActions?.(game) ?? []);
}

function enemyOf(game: RoomGame): (e: Entity) => boolean {
  return (e) => e.id !== game.player.id && isAlive(e) && e.faction !== game.player.faction;
}

/**
 * The next step of a sweep: head for the deepest compartment never stood in,
 * and fall back to the nearest one when the deep end turns out to be behind a
 * door this drone cannot open. Without the fallback one locked bulkhead is the
 * end of exploring rather than the end of one route.
 */
function exploreDoor(game: RoomGame, here: RoomId, seen?: ReadonlySet<RoomId>): Door | undefined {
  const unexplored = game.ship.rooms.filter((r) => (seen ? !seen.has(r.id) : !r.explored));
  if (unexplored.length === 0) return undefined;

  const passable = routeDoors(game);
  const deepest = Math.max(...unexplored.map((r) => r.depth));
  const goals = unexplored.filter((r) => r.depth === deepest).map((r) => r.id);
  let map = RoomDistance.from(game.ship, goals, passable);
  if (!Number.isFinite(map.at(here))) {
    map = RoomDistance.from(game.ship, unexplored.map((r) => r.id), passable);
  }
  return Number.isFinite(map.at(here)) ? map.nextDoor(here, passable) : undefined;
}

/**
 * One step through `door`. A locked or sealed one is a decision rather than a
 * step: whichever system aimed an enabled offer at this door has already said
 * it is worth the turn, and plain `go` — three turns of cutting, if this drone
 * carries something that cuts — is what is left when nothing did.
 */
function throughDoor(game: RoomGame, door: Door): RoomCommand {
  if (door.state === "locked" || door.state === "sealed") {
    const opener = offers(game).find((o) => o.enabled && o.cmd.kind === "act" && o.cmd.target === door.id);
    if (opener) return opener.cmd;
  }
  return { kind: "go", door: door.id };
}

/**
 * Where a route may go: what this drone can walk through — a cutter makes a
 * locked door walkable, at three turns and a lot of noise — plus every shut
 * door some system says it can open right now. That offer is the whole of the
 * bot's knowledge about keys: it never learns what one is, only that something
 * aimed at this door is enabled.
 *
 * `target` is one number for doors, items and ship systems alike, so the shut
 * set is what keeps a salvage offer from being read as a key. Advisory either
 * way: a wrong guess costs a refused command, never a turn.
 */
function routeDoors(game: RoomGame): DoorFilter {
  const who = walkerOf(game.player);
  const shut = new Set<DoorId>(
    game.ship.doors.filter((d) => d.state === "locked" || d.state === "sealed").map((d) => d.id),
  );
  const openable = new Set<DoorId>();
  for (const o of offers(game)) {
    if (!o.enabled || o.cmd.kind !== "act") continue;
    const target = o.cmd.target;
    if (target !== undefined && shut.has(target)) openable.add(target);
  }
  // The airlock is a way off the ship, not a way further into it.
  return (d) => d.state !== "airlock" && (game.ship.passable(d, who) || openable.has(d.id));
}

/** Doors anyone can walk through, this turn, without tools. */
function walkDoors(game: RoomGame): DoorFilter {
  return (d) => game.ship.passable(d, {});
}
