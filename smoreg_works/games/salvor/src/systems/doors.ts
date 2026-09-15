import {
  BREACH_NOISE,
  BREACH_TURNS,
  RoomDistance,
  TURN_COST,
  type ActionOffer,
  type Door,
  type DoorFilter,
  type DoorId,
  type Entity,
  type Outcome,
  type Room,
  type RoomCommand,
  type RoomGame,
  type System,
} from "@jamrog/engine";
import { FREIGHTER, derelictSpec } from "../content/derelicts.js";
import { DEFUSE_NOISE, DEFUSE_TURNS } from "../content/hazards.js";
import { registerJob, sayBrokenOff } from "./jobs.js";
import { hint } from "../content/hints.js";
import type { Key } from "../content/i18n/keys.js";
import { moduleBurnLine, moduleName, type ModuleId } from "../content/modules.js";
import { isTug } from "../content/tug.js";
import { verbWord } from "../content/words.js";
import { t } from "../i18n.js";
import {
  RIG,
  SPIKE_TURNS,
  applyDerived,
  findSlot,
  findSlotAs,
  registerHackTarget,
  rigOf,
  routeDamage,
  type HackTarget,
  type Rig,
} from "../twist/rig.js";
import { doorHazard, hazardRecords, removeHazard } from "./hazardstate.js";
import { roomList, type Body } from "./populate.js";

/**
 * Doors, and the dead who carried the keys.
 *
 * A bulkhead is the same decision the fight is (design-doc.md, "Дверь"): every
 * way through one spends something and puts something under the next blow. A
 * keycard is silent and there is exactly one of it; the CELL is a turn and a
 * point of its own integrity; the SPIKE is two turns standing still; the CUTTER
 * is three turns the whole ship can hear. Nothing here is a skill check — the
 * lock always opens, the question is what it costs to open it *this* way.
 *
 * The engine owns the states and who may walk through them (`rooms/graph.ts`);
 * this system owns what a drone can do about one, which is the half that knows
 * the words CELL, SPIKE and keycard.
 */

// --------------------------------------------------------------- the numbers

/** design-doc.md, "Шум": how loud each way through a door is. */
const KEY_NOISE = 0;
const CELL_NOISE = 6;
const WELD_NOISE = 5;
const CLOSE_NOISE = 2;
const SEARCH_NOISE = 2;

/** Turns of welding a door takes. Cutting is the engine's `BREACH_TURNS`. */
const WELD_TURNS = 2;

/**
 * Ramming a bulkhead with the chassis: no module, no key, and nothing that
 * burns — only eight turns in a row, every one of them loud enough to be heard
 * across the deck, with the THRUSTERS under every blow that lands meanwhile
 * (`twist/rig.ts`, `VERB_MODULE`). The owner's word for it (G90): a drone is
 * never walled in by a lock or a weld, it is only made to pay for the way out.
 */
const RAM_TURNS = 8;
const RAM_NOISE = 12;

/** Integrity a lock takes out of the CELL that powers it open. */
const CELL_COST = 1;

/** What a crew body is worth, before G26 turns loot into credits. */
const BODY_CREDITS = 3;

/** The verbs this system owns. Everything else falls through to the next one. */
type DoorVerb = "key" | "power" | "spike" | "cut" | "weld" | "close" | "defuse" | "ram";

/**
 * The four ways through a lock, in the order the action list offers them, which
 * is what a drone spends on the first bulkhead it meets: the list hands the
 * number to the first way it can actually do (`ui/actions.ts`, `doorActions`).
 *
 * The card is last because it is the only one of the four that is not a module
 * and does not come back. On a SCRAPPER it is also the only way to raise a
 * terminal — that hull carries no SPIKE (design-doc.md, "Обезвредить корабль")
 * — so a card spent on a lock two compartments in is the third system of that
 * hull, gone. Measured over 200 voyages of the careful bot: the terminal comes
 * up 141 times with the card offered first and 157 with it offered last, and
 * hulls sold a voyage go 0.33 to 0.37.
 *
 * Ahead of it, cheapest first: the CELL is a turn and one of its own points,
 * the SPIKE is two turns and no cost at all, the torch is three turns the whole
 * ship hears. `power` before `cut` and not the other way round is measured too,
 * and it is not close — a SCRAPPER carries both, and putting the torch first
 * costs it seven wins in 200 against nine.
 *
 * The ram is behind even the card: it is always there, so it is what is left
 * when everything else is spent — and a bot reading the list takes the first
 * way it can, which must never be the eight loudest turns of the sortie while
 * a quieter one is in the rack.
 */
const LOCKED_METHODS: readonly DoorVerb[] = ["power", "spike", "cut", "key", "ram"];

/** Which module each method spends, for the line that says why it is greyed. */
const METHOD_MODULE: Readonly<Partial<Record<DoorVerb, ModuleId>>> = {
  power: "cell",
  spike: "spike",
  cut: "cutter",
  weld: "welder",
  defuse: "welder",
};

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

// ------------------------------------------------------------ work in progress

/**
 * A job that takes several turns *in a row*: cutting a bulkhead open, welding
 * one shut. Kept in the compartment it is being done in, because that is what
 * survives a save, and stamped with the command that wrote it — a job resumes
 * only from the turn immediately before, so a drone that walked away and came
 * back starts the cut again.
 */
interface Work {
  verb: "cut" | "weld" | "defuse" | "ram";
  door: DoorId;
  left: number;
  /** Index in `game.inputs` of the command that did this turn of the job. */
  turn: number;
}

/** How long each of the four door jobs takes, for the count the board draws. */
const WORK_TURNS: Readonly<Record<Work["verb"], number>> = {
  cut: BREACH_TURNS,
  weld: WELD_TURNS,
  defuse: DEFUSE_TURNS,
  ram: RAM_TURNS,
};

/**
 * A bulkhead being worked, as the shared job (`systems/jobs.ts`).
 *
 * The door is the target rather than the compartment: a corridor with two
 * locked ends is one room and two jobs, and only one of them is running.
 */
registerJob((game) => {
  const work = workOf(game.roomOf(game.player));
  if (work === undefined) return undefined;
  const of = WORK_TURNS[work.verb];
  return { target: work.door, what: work.verb, done: of - work.left, of };
});

/** Defensive: `room.data` round-trips through a save, so nothing in it is trusted. */
function workOf(room: Room): Work | undefined {
  const raw = room.data.work;
  if (typeof raw !== "object" || raw === null) return undefined;
  const w = raw as Partial<Work>;
  if (w.verb !== "cut" && w.verb !== "weld" && w.verb !== "defuse" && w.verb !== "ram") return undefined;
  if (typeof w.door !== "number" || typeof w.left !== "number" || typeof w.turn !== "number") {
    return undefined;
  }
  return { verb: w.verb, door: w.door, left: w.left, turn: w.turn };
}

/**
 * One more turn of this job, or the first turn of it, and how much is left.
 *
 * `game.inputs.length` is the index this command will take once it resolves, so
 * the job written last turn carries exactly one less.
 */
function advance(game: RoomGame, room: Room, verb: Work["verb"], door: Door, turns: number): number {
  const open = workOf(room);
  const resumed =
    open !== undefined &&
    open.verb === verb &&
    open.door === door.id &&
    open.turn === game.inputs.length - 1;

  const left = (resumed ? open.left : turns) - 1;
  if (left > 0) room.data.work = { verb, door: door.id, left, turn: game.inputs.length };
  else delete room.data.work;
  return left;
}

/**
 * Where the drone was standing when it gave this command — which for a step is
 * the compartment behind it. A job is broken off in the room it was started in,
 * so walking out of a half-cut bulkhead says so.
 */
function roomActedIn(game: RoomGame, cmd: RoomCommand): Room | undefined {
  const here = game.roomOf(game.player);
  if (cmd.kind !== "go") return here;
  const door = game.ship.doors[cmd.door];
  return door ? game.ship.roomAt(game.ship.other(door, here.id)) : undefined;
}

// ------------------------------------------------------------------- the drone

/** Keycards on the drone. One number: a key is a key (design-doc.md, "Дверь"). */
export function keysHeld(player: Entity): number {
  const keys = player.data?.keys;
  return typeof keys === "number" ? keys : 0;
}

function setKeys(player: Entity, keys: number): void {
  (player.data ??= {}).keys = Math.max(0, keys);
}

/** Credits picked up off the dead: the drone's own pocket, banked into the purse when the hold is emptied. */
function addLoot(player: Entity, amount: number): void {
  const data = (player.data ??= {});
  data.loot = (typeof data.loot === "number" ? data.loot : 0) + amount;
}

/**
 * Is this module in the rack, whatever is left of it — or a relic that answers
 * for it (`twist/rig.ts`, `findSlotAs`)? A blade cuts a bulkhead the way a
 * cutter does, and the door does not ask which.
 */
function carries(rig: Rig | undefined, kind: ModuleId): boolean {
  return rig !== undefined && findSlotAs(rig, kind) !== null;
}

// -------------------------------------------------------------------- the ship

/** A door of the compartment the drone is standing in. The airlock is `leave`'s. */
function doorHere(game: RoomGame, target: number | undefined): Door | undefined {
  if (target === undefined) return undefined;
  const door = game.ship.doors[target];
  if (!door || door.state === "airlock") return undefined;
  const here = game.roomOf(game.player).id;
  return door.a === here || door.b === here ? door : undefined;
}

/**
 * How often a plain crew body is carrying a spare keycard: the hull class's own
 * number. Which class this derelict is belongs to the voyage (G25) and rides in
 * the ship's own pocket; until something writes one there, every hull of a run
 * is the freighter the game starts on.
 */
function keyChance(game: RoomGame): number {
  const id = game.currentShip.data.derelict;
  const spec = typeof id === "string" ? derelictSpec(id) : undefined;
  return (spec ?? FREIGHTER).keyChance;
}

/**
 * Turns of SPIKE work already spent on each door, by door id.
 *
 * On the ship rather than in a room, because a half-picked lock is the door's
 * state and not the drone's: a bulkhead worked on from one side is the same
 * bulkhead from the other, and the ship is what a run walks back into.
 */
function spikeWork(game: RoomGame): Record<string, number> {
  const data = game.currentShip.data;
  const existing = data.spiked;
  if (typeof existing === "object" && existing !== null) return existing as Record<string, number>;
  const fresh: Record<string, number> = {};
  data.spiked = fresh;
  return fresh;
}

/**
 * A locked bulkhead, as something a SPIKE can be worked into.
 *
 * The rig owns what a SPIKE *is* — two turns, four noise, the module exposed
 * the whole time — and knows no word for a door; this is the other half of that
 * bargain (`twist/rig.ts`, `HackTarget`). `turnsLeft` is an accessor pair over
 * the ship's pocket so the work survives being interrupted and saved, which the
 * contract asks of whoever owns the target.
 */
function doorHack(game: RoomGame, door: Door): HackTarget {
  const work = spikeWork(game);
  const id = String(door.id);
  return {
    name: t("word.bulkhead", { door: door.label }),
    expose: "spike",
    get turnsLeft(): number {
      const left = work[id];
      return typeof left === "number" ? left : SPIKE_TURNS;
    },
    set turnsLeft(left: number) {
      work[id] = left;
    },
    breach(): void {
      door.state = "open";
      delete work[id];
    },
  };
}

// The rig asks every source about a target id; ours answers for a locked door
// of the compartment the drone is in, and for nothing else.
registerHackTarget((game, target) => {
  const door = doorHere(game, target);
  return door && door.state === "locked" ? doorHack(game, door) : undefined;
});

// ------------------------------------------------------------------ the methods

/** The keycard: a turn, a card, no noise at all. */
function openWithKey(game: RoomGame, door: Door): Outcome {
  if (door.state !== "locked") return FAIL(t("why.door.notLocked", { door: door.label }));
  const keys = keysHeld(game.player);
  if (keys <= 0) return FAIL(t("why.door.noKeycard"));

  setKeys(game.player, keys - 1);
  door.state = "open";
  game.makeNoise(game.roomOf(game.player).id, KEY_NOISE);
  game.log.add(
    t("log.door.key", { door: door.label }),
    game.schedule.time,
    "good",
    "log.door.key",
  );
  return DONE();
}

/** The CELL: a turn, a point of the module, and a bang the deck over hears. */
function powerOpen(game: RoomGame, door: Door): Outcome {
  if (door.state !== "locked") return FAIL(t("why.door.notLocked", { door: door.label }));
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "cell") : null;
  if (!rig || slot === null) return FAIL(missing("power"));

  door.state = "open";
  game.makeNoise(game.roomOf(game.player).id, CELL_NOISE);
  game.log.add(t("log.door.power", { door: door.label }), game.schedule.time, "good", "log.door.power");
  spendCell(game, rig, slot);
  return DONE();
}

/**
 * The charge a lock costs, taken out of the CELL itself.
 *
 * Routed through the rig's own damage path rather than by subtracting one:
 * what happens when a module runs out — the empty slot, the scar, the line the
 * player reads — has exactly one implementation, and it is `routeDamage`'s.
 * `corrosive` is what keeps PLATING out of the chain, because a module spending
 * itself is not a blow the armour can take.
 */
function spendCell(game: RoomGame, rig: Rig, slot: number): void {
  rig.exposed = slot;
  for (const hit of routeDamage(rig, CELL_COST, ["corrosive"]).hits) {
    if (hit.burned) game.log.add(moduleBurnLine(hit.kind), game.schedule.time, "bad", "log.module.burn");
  }
  applyDerived(game.player);
}

/**
 * The SPIKE, handed straight to the rig.
 *
 * `act spike {door}` and pressing `K` at the same bulkhead are the same two
 * turns of work, so they are the same code: this checks that the door is worth
 * spiking and the rack has the module, and the rig does the rest.
 */
function spikeOpen(game: RoomGame, door: Door): Outcome {
  if (door.state !== "locked") return FAIL(t("why.door.noLock", { door: door.label }));
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "spike") : null;
  if (!rig || slot === null) return FAIL(missing("spike"));

  const cmd: RoomCommand = { kind: "act", verb: "use", slot, target: door.id };
  return RIG.performCommand?.(game, game.player, cmd) ?? FAIL(t("why.breach.nothing"));
}

/** The CUTTER: three turns in a row, nine noise each, and a hole that stays. */
function cutOpen(game: RoomGame, room: Room, door: Door): Outcome {
  if (door.state !== "locked" && door.state !== "sealed") {
    return FAIL(t("why.door.noCut", { door: door.label }));
  }
  const rig = rigOf(game.player);
  if (!carries(rig, "cutter")) return FAIL(missing("cut"));

  const left = advance(game, room, "cut", door, BREACH_TURNS);
  game.makeNoise(room.id, BREACH_NOISE);
  if (left > 0) {
    game.log.add(
      t("log.door.cut.on", { door: door.label, left }),
      game.schedule.time,
      "warn",
      "log.door.cut.on",
    );
    return DONE();
  }

  door.state = "broken";
  game.log.add(t("log.door.cut.done", { door: door.label }), game.schedule.time, "good", "log.door.cut.done");
  return DONE();
}

/**
 * The chassis: eight turns in a row, twelve noise each, and a hole that stays.
 *
 * The one way through a lock or a weld that asks for nothing the drone might
 * have lost, which is exactly why it costs the most of anything on the list:
 * eight turns is longer than the cutter and the spike put together, and twelve
 * is louder than anything else a drone does. The blows that land meanwhile go
 * into the THRUSTERS doing the ramming, the way a step's do.
 */
function ramOpen(game: RoomGame, room: Room, door: Door): Outcome {
  if (door.state !== "locked" && door.state !== "sealed") {
    return FAIL(t("why.door.noRam", { door: door.label }));
  }

  const left = advance(game, room, "ram", door, RAM_TURNS);
  game.makeNoise(room.id, RAM_NOISE);
  if (left > 0) {
    game.log.add(
      t("log.door.ram.on", { door: door.label, left }),
      game.schedule.time,
      "warn",
      "log.door.ram.on",
    );
    return DONE();
  }

  door.state = "broken";
  game.log.add(t("log.door.ram.done", { door: door.label }), game.schedule.time, "good", "log.door.ram.done");
  return DONE();
}

/**
 * With this door welded shut, can the drone still walk to the airlock?
 *
 * Two words in that sentence are the whole rule, and G14's first version of
 * this guard had neither. **Walk** — through bulkheads that need nothing spent
 * on them: open, closed, or already a hole. **Airlock** — not "another door",
 * which is what it used to ask: a compartment can perfectly well have a second
 * door into a store cupboard, and welding the way home was legal because the
 * cupboard existed.
 *
 * Asking the graph rather than the rack is the other half. A way out the drone
 * can take *now* — a lock it is carrying the CELL for, a weld it can cut — is
 * not a way out it will still have later: the CELL is spent a point at a time
 * by that very lock, the CUTTER burns in the first fight, and the door welded
 * on the strength of either of them never opens again. The rule has to hold for
 * every rack the drone might have by then, and the only rack it is safe to
 * assume is none at all.
 *
 * What that costs is a legitimate move: a drone with a keycard may not weld the
 * door home and let itself out through the lock beside it. It is a fair price
 * for the one move in the game that ends a run without ending it, and the
 * drone can always weld the door it is not standing behind.
 */
function stillLeadsHome(game: RoomGame, room: Room, sealing: Door): boolean {
  const airlock = game.ship.airlock();
  const home = airlock ? airlock.a : game.ship.entry;
  const walkable: DoorFilter = (door) =>
    door.id !== sealing.id &&
    (door.state === "open" || door.state === "closed" || door.state === "broken");
  return Number.isFinite(RoomDistance.from(game.ship, [room.id], walkable).at(home));
}

/**
 * The WELDER: two turns, and a door nothing aboard opens again — except the
 * last way out of the compartment the drone is standing in.
 *
 * Sealing that one is the one move in the game that ends a run without ending
 * it: the bulkhead never opens again (design-doc.md, "Дверь"), nothing can
 * reach the drone to kill it, and `leave` is the airlock's verb and not a
 * compartment's. Found by the random bot on seed 18 of the balance batch — a
 * drone alive on 3 HP in a corridor behind one welded door, waiting out the
 * harness — and it is a livelock a player can walk into with two keystrokes.
 * So the list does not offer it and the command refuses it, in the compartment
 * being sealed and nowhere else: welding the far side of a room shuts a door
 * on nobody.
 */
function weldShut(game: RoomGame, room: Room, door: Door): Outcome {
  if (door.state !== "open" && door.state !== "closed") {
    return FAIL(t("why.door.noWeld", { door: door.label }));
  }
  const rig = rigOf(game.player);
  if (!carries(rig, "welder")) return FAIL(missing("weld"));
  if (!stillLeadsHome(game, room, door)) return FAIL(t("why.door.wallsIn", { door: door.label }));

  const left = advance(game, room, "weld", door, WELD_TURNS);
  game.makeNoise(room.id, WELD_NOISE);
  if (left > 0) {
    game.log.add(t("log.door.weld.on", { door: door.label }), game.schedule.time, "plain", "log.door.weld.on");
    return DONE();
  }

  door.state = "sealed";
  game.log.add(t("log.door.weld.done", { door: door.label }), game.schedule.time, "good", "log.door.weld.done");
  return DONE();
}

/**
 * The WELDER on a mine: two turns in a row, like a weld, and the door is a
 * door again (`content/hazards.ts`, `mine`). The charge is on the door and not
 * on a side of it, so it is lifted from whichever compartment the drone is in
 * — and whether the door is open, shut or locked, since the lock is a separate
 * question with its own four answers.
 */
function defuseMine(game: RoomGame, room: Room, door: Door): Outcome {
  const rec = doorHazard(game.ship, hazardRecords(game), door.id);
  if (rec?.id !== "mine") return FAIL(t("why.door.noTrap", { door: door.label }));
  const rig = rigOf(game.player);
  if (!carries(rig, "welder")) return FAIL(missing("defuse"));

  const left = advance(game, room, "defuse", door, DEFUSE_TURNS);
  game.makeNoise(room.id, DEFUSE_NOISE);
  if (left > 0) {
    game.log.add(t("log.door.defuse.on", { door: door.label }), game.schedule.time, "plain", "log.door.defuse.on");
    return DONE();
  }

  removeHazard(game, rec);
  game.log.add(t("log.door.defuse.done", { door: door.label }), game.schedule.time, "good", "log.door.defuse.done");
  return DONE();
}

/** Closing one: a turn, and the ship hears three points less of everything. */
function closeDoor(game: RoomGame, door: Door): Outcome {
  if (door.state !== "open") return FAIL(t("why.door.notOpen", { door: door.label }));
  door.state = "closed";
  game.makeNoise(game.roomOf(game.player).id, CLOSE_NOISE);
  game.log.add(t("log.door.close", { door: door.label }), game.schedule.time, "plain", "log.door.close");
  return DONE();
}

// --------------------------------------------------------------------- bodies

/**
 * A crew body: three credits, and the keycard the ship's own dead were carrying
 * when it happened.
 *
 * The key is what makes searching a decision rather than a chore — a body in
 * front of the one locked bulkhead of the tutorial freighter always has one
 * (the generator marked it), and any other body is a roll of the hull's
 * `keyChance`. Searched once is searched for good: the compartment keeps the
 * body, so a second sortie does not re-loot the same corpse.
 */
function searchBody(game: RoomGame, target: number | undefined): Outcome {
  const room = game.roomOf(game.player);
  const bodies = roomList<Body>(room, "bodies");
  const body = target === undefined ? bodies.find((b) => !b.searched) : bodies.find((b) => b.id === target);
  if (!body) return FAIL(t("why.body.none"));
  if (body.searched) return FAIL(t("why.body.searched"));

  body.searched = true;
  addLoot(game.player, BODY_CREDITS);
  const key = body.key !== undefined || game.rng.chance(keyChance(game));
  if (key) setKeys(game.player, keysHeld(game.player) + 1);

  game.makeNoise(room.id, SEARCH_NOISE);
  game.log.add(
    key ? t("log.body.key", { cr: BODY_CREDITS }) : t("log.body.plain", { cr: BODY_CREDITS }),
    game.schedule.time,
    "good",
    "log.body.search",
  );
  if (key) hint(game, "keycard");
  return DONE();
}

// ------------------------------------------------------------- the action list

function offer(verb: DoorVerb, door: Door, enabled: boolean, why?: string): ActionOffer<RoomCommand> {
  const out: ActionOffer<RoomCommand> = {
    label: `${verbWord(verb)} ${door.label}`,
    cmd: { kind: "act", verb, target: door.id },
    enabled,
  };
  if (!enabled && why !== undefined) out.why = why;
  return out;
}

function missing(verb: DoorVerb): string {
  const kind = METHOD_MODULE[verb];
  // The keycard is the one method that is not a module: it is carried, spent
  // and gone, which is exactly why it is the last thing the list offers.
  return kind === undefined ? t("why.door.noKeycard") : t("why.module.missing", { module: moduleName(kind) });
}

/**
 * Every way through this door, in `LOCKED_METHODS` order: the cell, the spike,
 * the torch, and the card behind all three, because the card is the one that
 * does not come back and the one a terminal wants.
 *
 * A locked bulkhead lists all four whether the drone can spend them or not:
 * "what opens a lock" is something the game teaches by showing it greyed out
 * next to the door that needs it (design-doc.md, "Обучение конструкцией").
 * Everything else lists only what can actually be done — a sealed door has one
 * answer and a drone with no CUTTER has none, and a line it may never press is
 * noise rather than a lesson.
 */
/**
 * Welding, greyed out rather than dropped when it would wall the drone in: the
 * bulkhead the drone came through is exactly the one it wants to shut behind
 * it, so the line is worth showing with the reason on it.
 */
function weldOffer(game: RoomGame, door: Door): ActionOffer<RoomCommand> {
  return stillLeadsHome(game, game.roomOf(game.player), door)
    ? offer("weld", door, true)
    : offer("weld", door, false, t("why.door.wallsIn", { door: door.label }));
}

function doorOffers(game: RoomGame, rig: Rig | undefined, door: Door): Array<ActionOffer<RoomCommand>> {
  const has: Record<DoorVerb, boolean> = {
    key: keysHeld(game.player) > 0,
    power: carries(rig, "cell"),
    spike: carries(rig, "spike"),
    cut: carries(rig, "cutter"),
    weld: carries(rig, "welder"),
    defuse: carries(rig, "welder"),
    close: true,
    ram: true,
  };

  // The mine first, whatever else the door is: it is the thing that goes off
  // on the way through, and the drone standing next to it has been told
  // (`systems/hazards.ts`, the sign), so the line is never a leak.
  const mine =
    doorHazard(game.ship, hazardRecords(game), door.id)?.id === "mine"
      ? [offer("defuse", door, has.defuse, missing("defuse"))]
      : [];

  switch (door.state) {
    case "locked":
      return [...mine, ...LOCKED_METHODS.map((verb) => offer(verb, door, has[verb], missing(verb)))];
    // A weld has two answers now, and the torch stays ahead of the chassis
    // for the same reason the card does on a lock: three loud turns are
    // cheaper than eight louder ones, and the first enabled line is the one
    // that gets taken.
    case "sealed":
      return has.cut ? [offer("cut", door, true), offer("ram", door, true)] : [offer("ram", door, true)];
    case "open":
      return has.weld
        ? [...mine, offer("close", door, true), weldOffer(game, door)]
        : [...mine, offer("close", door, true)];
    case "closed":
      return has.weld ? [...mine, weldOffer(game, door)] : mine;
    case "broken":
      return mine;
    default:
      return [];
  }
}

// ---------------------------------------------------------------- the system

export const DOORS: System<RoomGame> = {
  name: "doors",

  onRunStart(game) {
    const data = (game.player.data ??= {});
    if (typeof data.keys !== "number") data.keys = 0;
    if (typeof data.loot !== "number") data.loot = 0;
  },

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act") return undefined;
    if (cmd.verb === "search") return searchBody(game, cmd.target);

    const verb = cmd.verb;
    if (!isDoorVerb(verb)) return undefined;

    const door = doorHere(game, cmd.target);
    if (!door) return FAIL(t("why.door.notHere"));

    const room = game.roomOf(game.player);
    switch (verb) {
      case "key":
        return openWithKey(game, door);
      case "power":
        return powerOpen(game, door);
      case "spike":
        return spikeOpen(game, door);
      case "cut":
        return cutOpen(game, room, door);
      case "weld":
        return weldShut(game, room, door);
      case "defuse":
        return defuseMine(game, room, door);
      case "close":
        return closeDoor(game, door);
      case "ram":
        return ramOpen(game, room, door);
    }
  },

  /**
   * Cutting and welding have to be consecutive: anything else the drone does —
   * a step, a swing, a turn spent waiting — drops the job where it stands.
   * Refused commands never reach here, so a key pressed for a module that
   * burned does not cost the cut.
   */
  afterPlayerTurn(game, cmd) {
    // Leaving takes the drone off the ship the job is on; the stamp on the work
    // is already old enough that nothing can resume it.
    if (cmd.kind === "leave") return;
    const room = roomActedIn(game, cmd);
    if (!room) return;

    const work = workOf(room);
    if (!work || work.turn === game.inputs.length - 1) return;
    delete room.data.work;
    sayBrokenOff(game, work.verb, WORK_TURNS[work.verb] - work.left, WORK_TURNS[work.verb]);
  },

  offerActions(game) {
    const offers: Array<ActionOffer<RoomCommand>> = [];
    if (game.status !== "playing") return offers;

    const room = game.roomOf(game.player);
    const rig = rigOf(game.player);
    // What lies in the compartment before what leads out of it, which is the
    // order design-doc.md, "Действия отсека" numbers them in.
    for (const body of roomList<Body>(room, "bodies")) {
      if (body.searched) continue;
      offers.push({
        label: t("action.search"),
        cmd: { kind: "act", verb: "search", target: body.id },
        enabled: true,
      });
    }
    for (const door of game.ship.doorsOf(room.id)) {
      offers.push(...doorOffers(game, rig, door));
    }
    return offers;
  },

  // Aboard a hull, and only there. A keycard comes off a body and opens a
  // bulkhead of the ship it was found on; the tug has three doors, nothing ever
  // locks them and nothing is ever aboard to search. So at home the counter is
  // a row of the panel spent saying `KEYS 0` for ever — «что за ключи в
  // бункере?» (G92 B3), and the one row the tug's list can least afford.
  panelLines(game) {
    return isTug(game) ? [] : [{ text: t("panel.keys", { n: keysHeld(game.player) }) }];
  },
};

function isDoorVerb(verb: string): verb is DoorVerb {
  return (
    verb === "key" || verb === "power" || verb === "spike" ||
    verb === "cut" || verb === "weld" || verb === "close" || verb === "defuse" || verb === "ram"
  );
}
