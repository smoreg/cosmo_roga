import {
  RoomDistance,
  Rng,
  TURN_COST,
  isAlive,
  rememberRoom,
  spawnMonsterIn,
  type ActionOffer,
  type DoorFilter,
  type Entity,
  type MonsterKind,
  type Outcome,
  type RoomCommand,
  type RoomGame,
  type RoomId,
  type Ship,
  type System,
} from "@jamrog/engine";
import { specOfShip } from "../content/derelicts.js";
import { MODULES, moduleName, type ModuleId } from "../content/modules.js";
import {
  OBJECTIVE_COUNT,
  objectiveName,
  objectiveSpec,
  type ObjectiveSpec,
} from "../content/objectives.js";
import { t } from "../i18n.js";
import { addWreck, registerDamageVeto } from "../twist/rig.js";
import { raiseAlert } from "./alert.js";
import { rivalState, type RivalState } from "./rivalstate.js";
import { roomList, type ShipSystem } from "./populate.js";
import { shipState } from "./shipstate.js";
import { credit, derelictAboard, spend, voyageRecord, type RivalDeal } from "./voyage.js";

/**
 * The rival: another tug's drone, working the same derelict (design-doc.md,
 * "Конкурент").
 *
 * A racer, not a fighter. It never hunts the drone and never chases it: every
 * turn this system points it at the nearest ship system nobody has raised yet,
 * and it walks there and works. What makes it dangerous is the clock — three
 * systems and the NEUTRALIZE charter is gone, with twenty turns to reach the
 * airlock — and what makes it worth meeting is the two verbs it answers to:
 *
 *  - **rob it.** It carries salvage. A blow knocks one module out onto the
 *    deck; at `FLEE_HP` it breaks off for its own lock and is gone for the
 *    sortie.
 *  - **let it through.** It is a `breacher`: locked and sealed bulkheads take
 *    it three turns and stay `broken` for the rest of the run. Following it is
 *    cheaper than cutting the same door yourself.
 *  - **bargain with it** (G34). Standing in the same compartment, the action
 *    list grows three lines — pay it off, take its money, split the sale — and
 *    whichever is pressed is the hull's for the rest of the voyage. Three
 *    ordinary lines and no third verb: a deal is a decision made where every
 *    other decision aboard is made (design-doc.md, "Ход и действия").
 *
 * A system rather than part of the twist: it hooks the turn cycle, and the rig
 * knows nothing about it. All of its state is the ship's — the rival's progress
 * survives a sortie, which is the whole of the pressure (design-doc.md,
 * "Персистентный дереликт").
 */

/** Its own turns of work per system. Speed 110, so ~27 of the drone's. */
const WORK_TURNS = 30;
/** Hurt this far, it stops racing and runs for its own lock. */
const FLEE_HP = 3;
/** Turns to get out once the rival's tug owns the ship. */
const EVAC_TURNS = 20;
/** Never lands closer to the airlock than this: it starts ahead, not on you. */
const MIN_SPAWN_DOORS = 3;
/** What it is carrying when it arrives, and how much is left of each. */
const LOOT_MODULES = 2;
const LOOT_INTEGRITY: readonly [number, number] = [2, 3];

/**
 * What a bargain costs, and what it pays. One number both ways — the owner's
 * own framing was "I help you for a hundred, or you help me for a hundred", and
 * a hundred credits is two and a half hulls' worth of salvage either way.
 */
const DEAL_PRICE = 100;

/**
 * Steps of alert a system coming up costs, whoever brought it up
 * (`systems/ship.ts`, `ALERT_PER_SYSTEM`). Copied rather than imported: it is
 * that file's number and not an export, and a system raised by the competitor
 * is exactly as loud as one raised by the drone.
 */
const DEAL_ALERT = 2;

/**
 * The three lines, in the order they are offered. The index into this list is
 * what the command carries, off a base no door, wreck or ship system will ever
 * reach — the rule `systems/voyage.ts` states for its own stations.
 */
const DEALS: readonly RivalDeal[] = ["paid", "sold", "split"];
const DEAL_TARGET = 2300;

/**
 * Copied from ui/theme.ts on purpose: src/systems must not import src/ui —
 * rules never depend on the renderer.
 */
const BAD_FG = "#d96a6a"; // THEME.bad

const NAME = "rival drone";

/** The two refusals a bargain has, worded where every other refusal is. */
const NOT_ENOUGH = "why.credits";
const SPENT = "why.rival.spent";

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

const ABOARD_KEY = "log.rival.aboard";
const GONE_KEY = "log.rival.gone";
const LOST_KEY = "log.rival.lost";
const JUMPED_KEY = "log.rival.jumped";


/**
 * Switch the rival on for the derelict the drone is aboard. The hull's own
 * catalogue entry is what decides — `smuggler` and `corsair` always, the rest
 * on a roll (design-doc.md, "Типы дереликтов").
 */
export function startRival(game: RoomGame, enabled = true): RivalState {
  const fresh: RivalState = { enabled, progress: 0, alive: false, taken: [], rolls: 0 };
  game.currentShip.data.rival = fresh;
  return fresh;
}

/** Chance a hull whose class does not always draw a competitor draws one. */
export const RIVAL_CHANCE = 0.25;

/**
 * Is another tug working this hull? Asked once, the first time the run comes
 * aboard, and the answer is the ship's for the rest of the voyage.
 *
 * Off the ship's own `scheduleSeed` and never off `game.rng`: a roll out of the
 * run's stream would mean that switching the competitor on quietly re-rolls
 * every other draw of the voyage after it — the alert's rule, and for the same
 * reason (`systems/alert.ts`).
 */
function wanted(game: RoomGame): boolean {
  const spec = specOfShip(game.ship);
  if (!spec) return false;
  return spec.rival || new Rng(game.currentShip.scheduleSeed).fork(0).chance(RIVAL_CHANCE);
}

/**
 * The machine itself (design-doc.md, "Машины", row `r`).
 *
 * Built here and not in `content/monsters.ts` for the same reason the ENFORCER
 * is a const rather than a row: no roll ever produces it, and a bestiary the
 * band tables read must never offer it. It carries no `salvage` either — what
 * it drops is what it was carrying, and this file is what drops it.
 *
 * `hunter` is a transport, not a personality: the behaviour walks to
 * `data.targetRoom` and waits there, and this system rewrites that room every
 * turn. That is what makes a racer out of a hunter — it is never pointed at
 * the drone, so it never comes for you.
 */
export function rivalKind(): MonsterKind {
  return {
    id: "rival-drone",
    name: NAME,
    ch: "r",
    // Another tug's paint: the one amber thing aboard, so it is never misread
    // as one of the ship's own machines.
    fg: "#d9a441",
    hp: 7,
    damage: [1, 3, 0],
    defense: 0,
    speed: 110,
    fovRadius: 8,
    behaviour: "hunter",
    sight: 1,
    breacher: true,
    minDepth: 0,
    maxDepth: 99,
    weight: 0,
  };
}

// -------------------------------------------------------------- the drone

/** The rival aboard right now, if its tug still has one here. */
function rivalAboard(game: RoomGame): Entity | undefined {
  return game.entities.find((e) => e.name === NAME && isAlive(e));
}

/**
 * One stream per roll, forked off the ship's own seed rather than drawn from
 * `game.rng` — the same rule the alert follows and for the same reason: a
 * system that spends the run's stream re-rolls everything measured without it,
 * so switching the rival on would silently change every other derelict.
 */
function rivalRng(game: RoomGame, st: RivalState): Rng {
  const rolls = st.rolls ?? 0;
  st.rolls = rolls + 1;
  return new Rng(game.currentShip.scheduleSeed).fork(rolls);
}

/** How the rival walks: a locked or sealed bulkhead is three turns, not a wall. */
function breachFilter(ship: Ship): DoorFilter {
  return (d) => ship.passable(d, { breacher: true });
}

function spawn(game: RoomGame, st: RivalState): void {
  const rng = rivalRng(game, st);
  const room = pickSpawnRoom(game, rng);
  if (room === undefined) return;

  const self = spawnMonsterIn(rivalKind(), room);
  self.data = { loot: pickLoot(rng), work: 0, lastHp: self.hp };
  game.schedule.admit(self);
  game.entities.push(self);
  st.alive = true;
  point(game, st, self);
  game.log.add(t(ABOARD_KEY), game.schedule.time, "warn", ABOARD_KEY);
}

/**
 * Where the other tug put its drone in: deep, and never within reach of the
 * airlock. It came for the systems, so it starts closer to them than you do.
 */
function pickSpawnRoom(game: RoomGame, rng: Rng): RoomId | undefined {
  const ship = game.ship;
  const map = RoomDistance.from(ship, [ship.entry], breachFilter(ship));
  const deep = ship.rooms.filter((r) => Number.isFinite(map.at(r.id)) && map.at(r.id) >= MIN_SPAWN_DOORS);
  if (deep.length > 0) return rng.pick(deep).id;

  // A hull too small to hold three doors of distance: as far in as it goes.
  let best = 0;
  let rooms: RoomId[] = [];
  for (const room of ship.rooms) {
    const d = map.at(room.id);
    if (!Number.isFinite(d) || d <= 0) continue;
    if (d > best) {
      best = d;
      rooms = [room.id];
    } else if (d === best) {
      rooms.push(room.id);
    }
  }
  return rooms.length > 0 ? rng.pick(rooms) : undefined;
}

const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

/** What it has taken off this hull already. Two modules, half spent. */
function pickLoot(rng: Rng): ModuleId[] {
  const loot: ModuleId[] = [];
  for (let i = 0; i < LOOT_MODULES; i++) loot.push(rng.pick(MODULE_IDS));
  return loot;
}

// -------------------------------------------------------------- its errand

/** A system it is walking to, and the compartment that holds it. */
interface Errand {
  system: ShipSystem;
  room: RoomId;
}

/**
 * The nearest system nobody has up yet — neither the drone (`online`) nor the
 * rival itself. Distance is the rival's own, from where it stands, through the
 * doors it can cut; ties go to the lower room id so a replay never depends on
 * the order the ship was built in.
 */
function nextSystem(game: RoomGame, st: RivalState, self: Entity): Errand | undefined {
  const here = self.room;
  if (here === undefined) return undefined;

  const taken = st.taken ?? [];
  const map = RoomDistance.from(game.ship, [here], breachFilter(game.ship));
  let best: Errand | undefined;
  let bestDistance = Infinity;

  for (const room of game.ship.rooms) {
    const d = map.at(room.id);
    if (!Number.isFinite(d) || d >= bestDistance) continue;
    const system = roomList<ShipSystem>(room, "systems").find((s) => !s.online && !taken.includes(s.id));
    if (!system) continue;
    best = { system, room: room.id };
    bestDistance = d;
  }
  return best;
}

/** Point it at its next errand, or at its own lock when the hull is done with. */
function point(game: RoomGame, st: RivalState, self: Entity): Errand | undefined {
  const errand = nextSystem(game, st, self);
  rememberRoom(self, errand ? errand.room : game.ship.entry);
  return errand;
}

/**
 * One turn of the rival's, after it has taken it.
 *
 * Everything the racer does that is not walking happens here: the standing
 * order it walks to, the count of turns it has spent on a system, and the two
 * ways it stops — hurt, or done.
 */
function steer(game: RoomGame, st: RivalState, self: Entity): void {
  // The engine's hunter gives up after eight turns of standing on its goal and
  // rewrites itself into a plain brute. This one stands on its goal for thirty
  // turns on purpose, so the countdown is wiped every turn it is alive.
  self.searchTurns = undefined;

  const here = self.room;
  if (here === undefined) return;

  if (self.hp <= FLEE_HP) {
    if (here === game.ship.entry) {
      depart(game, st, self);
      return;
    }
    work(self, 0);
    rememberRoom(self, game.ship.entry);
    return;
  }

  const errand = point(game, st, self);
  if (!errand || here !== errand.room) {
    // Interrupted or still walking: a job is thirty turns in one compartment.
    work(self, 0);
    return;
  }

  const done = work(self) + 1;
  if (done < WORK_TURNS) {
    work(self, done);
    return;
  }
  takeSystem(game, st, self, errand.system);
}

/** A system comes up for the other tug, and one third of the charter is gone. */
function takeSystem(game: RoomGame, st: RivalState, self: Entity, system: ShipSystem): void {
  work(self, 0);
  const spec = objectiveSpec(system.kind);

  // A split sale is a hull worked in common: what the other tug's drone brings
  // up is the drone's own, and the price of that is half of what the hull
  // fetches (`systems/voyage.ts`, `comeHome`). It is the whole of the deal —
  // the competitor stops being a clock and starts being a second pair of hands.
  if (dealOf(game) === "split" && spec !== undefined) {
    raiseFor(game, system, spec);
    point(game, st, self);
    return;
  }

  (st.taken ??= []).push(system.id);
  game.log.add(
    t("log.rival.system", { system: spec === undefined ? t("word.system") : objectiveName(spec) }),
    game.schedule.time,
    "bad",
    "log.rival.system",
  );

  const before = st.progress;
  st.progress = Math.min(OBJECTIVE_COUNT, st.progress + 1);
  if (st.progress > before && st.progress >= OBJECTIVE_COUNT) loseTheShip(game, st);
  point(game, st, self);
}

/** Out through its own lock, with whatever it still carries. Back next sortie. */
function depart(game: RoomGame, st: RivalState, self: Entity): void {
  st.alive = false;
  game.entities = game.entities.filter((e) => e.id !== self.id);
  game.log.add(t(GONE_KEY), game.schedule.time, "good", GONE_KEY);
}

// ---------------------------------------------------------------- the loot

function lootOf(self: Entity): ModuleId[] {
  const raw = self.data?.loot;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is ModuleId => typeof x === "string" && x in MODULES);
}

/** Turns of the current job, kept on the entity so it survives being stored. */
function work(self: Entity, set?: number): number {
  const data = (self.data ??= {});
  if (set !== undefined) data.work = set;
  return typeof data.work === "number" ? data.work : 0;
}

/**
 * A blow knocks one module out of its rack and onto the deck — the "rob it"
 * half of the encounter. One per turn, because one blow is one turn.
 */
function dropOne(game: RoomGame, self: Entity): void {
  const loot = lootOf(self);
  const kind = loot.shift();
  if (kind === undefined || self.room === undefined) return;
  (self.data ??= {}).loot = loot;
  drop(game, self.room, kind);
}

/** Killed outright: everything it was carrying stays on this deck. */
function dropAll(game: RoomGame, self: Entity): void {
  const loot = lootOf(self);
  if (self.room === undefined) return;
  (self.data ??= {}).loot = [];
  for (const kind of loot) drop(game, self.room, kind);
}

function drop(game: RoomGame, room: RoomId, kind: ModuleId): void {
  const st = rivalState(game);
  const wreck = addWreck(game, room, kind, rivalRng(game, st).int(LOOT_INTEGRITY[0], LOOT_INTEGRITY[1]));
  // Where it came from, for the bargain (G34): a rival's loot is not the same
  // thing as a machine's scrap, though it is salvaged the same way.
  wreck.source = "rival";
  const module = moduleName(kind).toLowerCase();
  game.log.add(
    t("log.rival.drops", { article: article(module), module }),
    game.schedule.time,
    "good",
    "log.rival.drops",
  );
}

/**
 * `a` or `an`, for the one language that needs one. The other two tables have
 * no `{article}` in this line at all, so the value is simply never read.
 */
function article(word: string): string {
  return "aeiou".includes(word[0] ?? "") ? "an" : "a";
}

/**
 * Did the drone hit it this turn? Nothing aboard heals, so hp only falls.
 *
 * Never once a deal is struck. Robbing it and bargaining with it are the two
 * halves of the same encounter and the hull only gets one of them: a drone that
 * pays a hundred credits and then shakes the haul back out of the thing it paid
 * has not made a decision (G34). The blow still lands and can still kill it —
 * what is off is the salvage, not the fight.
 */
function robbed(game: RoomGame, self: Entity): void {
  const data = (self.data ??= {});
  const seen = typeof data.lastHp === "number" ? data.lastHp : self.hp;
  if (self.hp < seen && dealOf(game) === undefined) dropOne(game, self);
  data.lastHp = self.hp;
}

// ------------------------------------------------------------- the bargain

/** The deal struck on the hull under the drone, if one was (G34). */
function dealOf(game: RoomGame): RivalDeal | undefined {
  return derelictAboard(game)?.deal;
}

/** What the account holds, read without starting a voyage (`voyageRecord`). */
function creditsOf(game: RoomGame): number {
  return voyageRecord(game)?.credits ?? 0;
}

/** A rival within talking distance, on a hull nobody has struck a deal on. */
interface Across {
  self: Entity;
  st: RivalState;
  state: { deal?: RivalDeal };
}

/**
 * Is there anything to bargain over right now?
 *
 * Three conditions and all of them are the player's to read off the screen: the
 * other tug's drone is aboard, it is in this compartment, and no deal has been
 * struck on this hull yet. A hull with a deal never offers a second one — the
 * owner's list has three outcomes on it, not a market.
 */
function across(game: RoomGame): Across | undefined {
  if (game.status !== "playing") return undefined;
  const st = rivalState(game);
  if (!st.enabled) return undefined;

  const self = rivalAboard(game);
  if (!self || self.room === undefined || self.room !== game.player.room) return undefined;

  const state = derelictAboard(game);
  if (!state || state.deal !== undefined) return undefined;
  return { self, st, state };
}

/**
 * The three lines, always all three, in the owner's own order.
 *
 * A line nobody can press is still shown and still costs no turn when it is
 * (`ui/actions.ts`): what the drone cannot afford is information, and a list
 * that hides the hundred-credit offer from a drone with ninety is a list that
 * never taught anyone what the competitor was for.
 */
function bargainOffers(game: RoomGame): Array<ActionOffer<RoomCommand>> {
  const met = across(game);
  if (!met) return [];

  const errand = nextSystem(game, met.st, met.self);
  return [
    deal(0, t("action.rival.payoff", { price: DEAL_PRICE }), creditsOf(game) >= DEAL_PRICE, t(NOT_ENOUGH)),
    deal(1, t("action.rival.aside", { price: DEAL_PRICE }), errand !== undefined, t(SPENT)),
    deal(2, t("action.rival.split"), true),
  ];
}

function deal(i: number, label: string, enabled: boolean, why?: string): ActionOffer<RoomCommand> {
  const offer: ActionOffer<RoomCommand> = {
    label,
    cmd: { kind: "act", verb: "bargain", target: DEAL_TARGET + i },
    enabled,
  };
  if (!enabled && why !== undefined) offer.why = why;
  return offer;
}

/**
 * `act bargain {i}`: one of the three, struck once and for this hull.
 *
 * Every refusal is `cost: 0` — a bargain the drone cannot afford must not hand
 * the floor to a compartment full of machines (design-doc.md, "Ход и действия",
 * and the rule `systems/voyage.ts` states for its own stations).
 */
function strike(game: RoomGame, target: number | undefined): Outcome {
  const wanted = DEALS[(target ?? DEAL_TARGET) - DEAL_TARGET];
  if (wanted === undefined) return FAIL(t("why.line.none"));

  const met = across(game);
  if (!met) return FAIL(t(dealOf(game) === undefined ? "why.rival.notHere" : "why.rival.dealt"));

  switch (wanted) {
    case "paid":
      return payOff(game, met);
    case "sold":
      return standAside(game, met);
    case "split":
      return splitTheSale(game, met);
  }
}

/**
 * A hundred credits and the other tug's drone is off this hull — with its haul
 * left where it stood, which is what makes the price payable: two modules on
 * the deck against a competitor that stops taking systems.
 */
function payOff(game: RoomGame, met: Across): Outcome {
  if (!spend(game, DEAL_PRICE)) return FAIL(t(NOT_ENOUGH));
  // Dropped before the deal is written down: what a deal switches off is the
  // salvage a *blow* shakes out (`robbed`), and this is the same haul handed
  // over rather than knocked loose.
  dropAll(game, met.self);
  met.state.deal = "paid";
  game.log.add(t("log.rival.deal.paid"), game.schedule.time, "good", "log.rival.deal.paid");
  depart(game, met.st, met.self);
  return DONE();
}

/**
 * It pays, and it brings one system up to show it means it.
 *
 * `NEUTRALIZE` stays the drone's — a hull with a deal on it is never taken out
 * from under the run, whatever the gauge reads (`systems/voyage.ts`,
 * `comeHome`). What it costs is the noise of a system coming up and the ones
 * the competitor goes on taking for itself afterwards: the charter is still
 * yours and the ship is no longer only yours to finish.
 */
function standAside(game: RoomGame, met: Across): Outcome {
  const errand = nextSystem(game, met.st, met.self);
  const spec = errand ? objectiveSpec(errand.system.kind) : undefined;
  if (!errand || !spec) return FAIL(t(SPENT));

  met.state.deal = "sold";
  credit(game, DEAL_PRICE, t("log.rival.deal.sold"), "log.rival.deal.sold");
  raiseFor(game, errand.system, spec);
  point(game, met.st, met.self);
  return DONE();
}

/** Half the hull, and a competitor that brings systems up on the drone's account. */
function splitTheSale(game: RoomGame, met: Across): Outcome {
  met.state.deal = "split";
  game.log.add(t("log.rival.deal.split"), game.schedule.time, "good", "log.rival.deal.split");
  point(game, met.st, met.self);
  return DONE();
}

/**
 * A system comes up and it counts as the drone's: the compartment's own flag,
 * the ship's record of what is online, and the noise of it.
 *
 * The fifteen-credit advance a charter pays for a system is deliberately not
 * paid here (`systems/ship.ts`, `raise`). The advance is for work the drone
 * did; what this deal pays is the hundred credits on the line, and paying both
 * would make standing aside better than working the hull.
 */
function raiseFor(game: RoomGame, system: ShipSystem, spec: ObjectiveSpec): void {
  system.online = true;
  const online = shipState(game).online;
  if (!online.includes(spec.id)) online.push(spec.id);
  raiseAlert(game, DEAL_ALERT);
  game.log.add(
    t("log.rival.raises", { system: objectiveName(spec) }),
    game.schedule.time,
    "good",
    "log.rival.raises",
  );
}

/**
 * The truce: while a deal stands, the other tug's drone does this one no harm.
 *
 * Registered with the rig rather than answered from this system's own
 * `onDamage`, and that is the whole of why the seam exists: the twist is the
 * first hook `dealDamage` asks, so a blow waved off any later has already been
 * routed into the rack and printed at the player. A hundred credits paid and
 * the rig melting anyway is worse than no bargain at all.
 *
 * One-sided on purpose. The drone may still break the bargain and swing back;
 * it simply shakes no salvage out of what it paid for (`robbed`).
 */
registerDamageVeto((game, source) => source?.name === NAME && dealOf(game) !== undefined);

/** The word the panel shows for a deal: `DEAL split`. */
function dealWord(deal: RivalDeal): string {
  return deal === "paid" ? t("word.deal.paid") : deal === "sold" ? t("word.deal.sold") : t("word.deal.split");
}

// ------------------------------------------------------------ the countdown

/**
 * Three systems to the other tug: the charter is gone and so is the ship.
 *
 * Never on a hull with a deal on it. That is the one promise all three of them
 * make — the competitor may go on working, but it has stopped racing you for
 * the claim, so the twenty-turn window never opens (G34).
 */
function loseTheShip(game: RoomGame, st: RivalState): void {
  if (dealOf(game) !== undefined) return;
  st.evac = EVAC_TURNS;
  game.log.add(t(LOST_KEY), game.schedule.time, "bad", LOST_KEY);
}

/**
 * The twenty turns. Running out is not a fight lost — the derelict undocks with
 * the drone still inside it, which is a death like any other: the systems that
 * own the ending are told, exactly as a blow that killed the drone would.
 */
function tickEvac(game: RoomGame, st: RivalState): void {
  if (st.evac === undefined || st.evac <= 0) return;
  st.evac--;
  if (st.evac > 0) return;

  game.player.hp = 0;
  game.player.alive = false;
  game.log.add(t(JUMPED_KEY), game.schedule.time, "bad", JUMPED_KEY);
  game.onDeath(game.player);
}

// -------------------------------------------------------------- the system

export const RIVAL: System<RoomGame> = {
  name: "rival",

  /**
   * The other tug's drone is put aboard once per sortie, and what it did while
   * nobody was watching is one more system (design-doc.md, "Персистентный
   * дереликт"): the pressure is the same whether the last one was killed,
   * driven off, or simply left alone.
   */
  onLevelEnter(game) {
    // The question is asked here rather than by whoever generated the hull:
    // `StoredShip.data` only exists once the run is standing on the ship, and
    // this is the first moment anything can write into it.
    const st = game.currentShip.data.rival === undefined
      ? startRival(game, wanted(game))
      : rivalState(game);
    if (!st.enabled) return;
    if (game.currentShip.visits > 1) st.progress = Math.min(OBJECTIVE_COUNT, st.progress + 1);
    if (!rivalAboard(game)) spawn(game, st);
    if (st.progress >= OBJECTIVE_COUNT) loseTheShip(game, st);
  },

  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    const st = rivalState(game);
    if (!st.enabled) return;

    const self = rivalAboard(game);
    if (self) robbed(game, self);
    tickEvac(game, st);
  },

  afterActorTurn(game, actor) {
    if (game.status !== "playing" || actor.name !== NAME || !isAlive(actor)) return;
    const st = rivalState(game);
    if (!st.enabled) return;
    steer(game, st, actor);
  },

  /** The bargain, as three lines of the compartment's own list (G34). */
  offerActions(game) {
    return bargainOffers(game);
  },

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== "bargain") return undefined;
    return strike(game, cmd.target);
  },

  /**
   * Killed outright: everything it carried stays on this deck — unless a deal
   * was struck over it, in which case there is nothing left to shake out
   * (`robbed`). Killing the drone you paid is still allowed; it just pays
   * nothing.
   */
  onDeath(game, victim) {
    if (victim.name !== NAME) return;
    if (dealOf(game) === undefined) dropAll(game, victim);
    rivalState(game).alive = false;
  },

  panelLines(game) {
    const st = rivalState(game);
    if (!st.enabled) return [];

    const progress = Math.min(OBJECTIVE_COUNT, Math.max(0, st.progress));
    const gauge = "▮".repeat(progress) + "▯".repeat(OBJECTIVE_COUNT - progress);
    const bar = t("panel.rival", { gauge });
    const lines: Array<{ text: string; fg?: string }> = [{ text: bar }];
    // What was agreed, under the gauge that says how far the other tug got:
    // the deal is the reason the gauge has stopped mattering, and a player who
    // struck one two sorties ago has nowhere else to read it (G34, 5).
    const struck = dealOf(game);
    if (struck !== undefined) lines.push({ text: t("panel.deal", { deal: dealWord(struck) }) });
    if (st.evac !== undefined) lines.push({ text: t("panel.evac", { n: st.evac }), fg: BAD_FG });
    return lines;
  },
};
