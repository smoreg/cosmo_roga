import { RoomDistance, blockedBy, exploreTarget, type Door, type DoorFilter, type DoorId, type Entity, type Room, type RoomCommand, type RoomGame, type RoomId, type Ship } from "@jamrog/engine";
import { moduleName, type ModuleId } from "../content/modules.js";

import { isTug } from "../content/tug.js";
import { doorStateWord, verbWord } from "../content/words.js";
import { roomName } from "../content/zones.js";
import { t, tId } from "../i18n.js";
import { entityLabel } from "../names.js";
import { alertState, fuseIn } from "../systems/alert.js";
import { keysHeld } from "../systems/doors.js";
import { hazardLine, signsGiven } from "../systems/hazards.js";
import { doorHazard, hazardKnown, hazardRecords, roomHazard } from "../systems/hazardstate.js";
import { jammed } from "../systems/jam.js";
import { roomList, type Body, type Crate, type RoomItem, type ShipSystem, type Wreck } from "../systems/populate.js";
import { findSlot, findSlotAs, hostilesIn, rigOf, shootTarget, type Rig } from "../twist/rig.js";
import { strikersNear } from "./strikers.js";
import { tag } from "./contents.js";

/**
 * Auto-explore and closing in — the two keys that keep a jam voter from quitting
 * in the second compartment, without taking a single decision away from them.
 *
 * `docs/traditional-checklist.md` calls automation that removes a tactical
 * decision an anti-pattern, and it is right. What makes DCSS's `o` legitimate
 * is not that it walks for you, it is that it stops the instant the situation
 * becomes a question: something in sight, something hurting you, the ship waking
 * up. So the interesting half of this file is the stop list, not the pathing —
 * every step it does take is a step whose answer was already "walk on", and
 * every step it refuses to take is handed back to the player.
 *
 * No DOM and no randomness here: the timer that paces the loop lives in
 * `app.ts`, and every command below is a function of the ship as it stands, so
 * a recorded walk replays exactly like a hand-played one.
 */

/**
 * One decision: the next command, or the reason the run stops.
 *
 * A stop may name a bulkhead, and one kind of stop does: a walk that has run
 * into something shut — travel sent at a compartment, and `o` once it has run
 * out of ship it can simply walk into. The screen answers that by opening that
 * door's own list of ways through it (`ui/appstate.ts`, `stoppedAt`), which is
 * the whole of the owner's second sentence — "двинулся в сторону закрытой —
 * предлагает варианты как вскрывать". Nothing here decides to spend a torch; it
 * only says which door the question is about.
 */
export type AutoResult = { cmd: RoomCommand } | { stop: string; door?: DoorId };

export function isStop(result: AutoResult): result is { stop: string } {
  return "stop" in result;
}

/** Milliseconds between auto-explore steps. UI pacing only; the sim never sees it. */
export const AUTO_DELAY_MS = 40;

/**
 * Which doors a walk may use: the three states a drone simply steps through.
 * Locked and sealed are deliberately out — auto-explore does not spend the
 * cutter, and it does not decide for the player that a bulkhead is worth three
 * loud turns. The airlock is out for the same reason: leaving the ship is not
 * exploring it.
 */
export function passableForPlayer(door: Door): boolean {
  return door.state === "open" || door.state === "closed" || door.state === "broken";
}

/**
 * A known hazard on the far side of this door, as the red line says it — or
 * nothing, when there is none or the drone has not been told of it yet.
 *
 * The one question every automatic step asks, and the report's third rule in
 * a sentence: auto-explore's stop list, a walk sent by `m` and `Tab` all read
 * this and none of them takes a step it answers. Known means told from next
 * door or read by a sensor pulse (`systems/hazardstate.ts`, `hazardKnown`);
 * a hazard nobody has been told of is not this function's to reveal.
 */
export function dangerAhead(game: RoomGame, door: Door): string | undefined {
  const here = game.roomOf(game.player).id;
  if (door.a !== here && door.b !== here) return undefined;
  const ship = game.ship;
  const records = hazardRecords(game);
  const trap = doorHazard(ship, records, door.id);
  if (trap && hazardKnown(ship, trap)) return hazardLine(game, trap, here, door);
  const beyond = ship.other(door, here);
  if (beyond === here) return undefined;
  const rec = roomHazard(ship, records, beyond);
  return rec && hazardKnown(ship, rec) ? hazardLine(game, rec, here, door) : undefined;
}

/**
 * Which doors a walk may use *without paying*: the three states a drone steps
 * through, less every door with a known trap on it and every door into a
 * compartment with a known hazard in it — except the one the drone is standing
 * in, which it must always be allowed to leave.
 *
 * `through` is the one door the player has confirmed: a walk that stopped a
 * door short of a hazard and was asked again for the same thing takes that
 * door, whatever is beyond it (`ui/appstate.ts`, `Warning`). The far side is
 * still a hazard and its other doors still walls — the confirmation is for
 * the step in, not for the compartment after it.
 *
 * A filter over the whole ship rather than over the compartment underfoot,
 * because the distance maps a walk plans by are built from the far end, and
 * a door has to be a wall to them from both sides.
 */
export function safeForPlayer(game: RoomGame, through?: DoorId): DoorFilter {
  const ship = game.ship;
  const here = game.roomOf(game.player).id;
  const records = hazardRecords(game);
  if (records.length === 0) return passableForPlayer;
  const risky = (room: RoomId): boolean => {
    if (room === here) return false;
    const rec = roomHazard(ship, records, room);
    return rec !== undefined && hazardKnown(ship, rec);
  };
  return (d) => {
    if (!passableForPlayer(d)) return false;
    if (d.id === through) return true;
    const trap = doorHazard(ship, records, d.id);
    if (trap && hazardKnown(ship, trap)) return false;
    return !risky(d.a) && !risky(d.b);
  };
}

/**
 * The door a confirmed walk may take on its first step, and only then: the
 * one it stopped at, still one of this compartment's, still something a drone
 * simply steps through. Anything else — the drone has moved, the door has
 * been locked meanwhile — and the confirmation is for a question that is no
 * longer being asked.
 */
function confirmedDoor(game: RoomGame, through: DoorId | undefined): Door | undefined {
  if (through === undefined) return undefined;
  const door = game.ship.doors[through];
  if (!door || !passableForPlayer(door)) return undefined;
  const here = game.roomOf(game.player).id;
  return door.a === here || door.b === here ? door : undefined;
}

/** What the compartment looked like at the previous step: "new" against "still there". */
interface Seen {
  room: RoomId;
  /** Ids of everything lying in that compartment. */
  things: Set<number>;
  /** Rig integrity plus CORE: any blow at all lowers this. */
  durability: number;
  alert: number;
  /** Hazards the drone has been told about this sortie (`systems/hazards.ts`, `signsGiven`). */
  signs: Set<string>;
  /** Ids of every machine the drone could see. A machine already in sight is not news. */
  machines: Set<number>;
}

export interface Explorer {
  /** One turn of auto-explore, or the reason to hand control back. */
  step(game: RoomGame): AutoResult;
}

/**
 * An explore run. The state it keeps is exactly the "what changed" snapshot —
 * a stop like "there is salvage here" is not a property of the current turn, it
 * is a difference between two of them.
 *
 * The first step takes the snapshot and reports no changes, which is what the
 * player means by pressing `o`: the crate they are already standing over is not
 * news, the machine that walks in next turn is.
 *
 * What it walks towards is three questions in order, and the order is the
 * owner's (docs/tasks/G59-explore-to-decision.md): the nearest compartment
 * plain walking reaches, then the nearest bulkhead standing between the drone
 * and unexplored ship that this rig can actually open, and only then a word.
 * The middle one is the whole point — a key that answers "everything left is
 * behind d3" and then stands still has told the player where the next decision
 * is and left them to walk to it by hand.
 *
 * `through` is a door the player has already been stopped at and has asked
 * for again — "…press again to go in" taken at its word. The first step of
 * this walk is that door, if it is still the door in front of the drone, and
 * the walk carries on from the far side as any walk does: what is in there
 * stops it exactly as it would anywhere else. The one door, once — a hazard
 * further along is a new question, and gets its own stop.
 */
export function makeExplorer(through?: DoorId): Explorer {
  const watch = makeWatch();
  let walkedBack = false;
  let confirmed = through;

  return {
    step(game: RoomGame): AutoResult {
      // The tug is four stations the drone has known since before the run: it
      // has nothing to explore, and pretending otherwise is where 5013 frames
      // of "ship explored" came from (docs/tasks/G55-playtest-findings.md).
      if (isTug(game)) return { stop: t("stop.tug") };

      // The confirmation is spent on the first call whatever comes of it: a
      // walk that stopped for a machine, or went somewhere else first, has
      // answered a different question.
      const pass = confirmedDoor(game, confirmed);
      confirmed = undefined;

      const interrupt = watch(game);
      if (interrupt) return interrupt;
      if (pass) return { cmd: { kind: "go", door: pass.id } };

      const room = game.roomOf(game.player);
      const safe = safeForPlayer(game);
      const onwards = exploreTarget(game.ship, room.id, safe);
      if (onwards) return { cmd: { kind: "go", door: onwards.id } };

      // Nothing is walkable for free any more, but something may still stand
      // between here and the rest of the ship — a lock the rack can open, or a
      // hazard the drone has been told about: walk up to it and hand over the
      // question, which is what the screen turns into that bulkhead's own list
      // of ways through it (`ui/appstate.ts`, `stoppedAt`).
      const gate = nearestGate(game, room.id, safe);
      if (gate?.step) return { cmd: { kind: "go", door: gate.step.id } };
      if (gate) return { ...gateStop(game, gate.door), door: gate.door.id };

      // Out of moves. Which of the two things that means is the difference
      // between a sortie that is finished and one that needs a tool, so the
      // line says which, and names the hull it is talking about (G54 §5).
      const left = game.ship.rooms.filter((r) => !r.explored).length;
      if (left > 0) {
        // A bulkhead still in the way is one a CUTTER opens — locked or welded,
        // there is no third kind — and the walk only reaches this line with no
        // cutter aboard. The dock sells one (`systems/voyage.ts`, `SHELF`), so
        // the line that ends the sortie says what to come back with rather than
        // only that it ended. Nothing joins the two halves of the hull at all
        // is the other case, and no tool answers that one.
        const hull = hullName(game);
        return blockedBy(game.ship, room.id).length > 0
          ? { stop: t("stop.noFurther.tool", { hull, n: left, tool: moduleName("cutter") }) }
          : { stop: t("stop.noFurther", { hull, n: left }) };
      }

      // Nothing unseen left to reach: point the drone at the way out, take a
      // single step towards it, and give the ship back to the player.
      const home = RoomDistance.from(game.ship, [airlockRoom(game.ship)], safe);
      const where = t("stop.explored", { hull: hullName(game), back: airlockLine(home.at(room.id)) });
      if (walkedBack) return { stop: where };
      const back = home.nextDoor(room.id, safe);
      if (!back) return { stop: where };
      walkedBack = true;
      return { cmd: { kind: "go", door: back.id } };
    },
  };
}

/** A shut bulkhead worth walking to, and the next step of the walk to it. */
interface Gate {
  door: Door;
  /** Undefined when the drone is already standing at that bulkhead. */
  step?: Door;
}

/**
 * The nearest door that alone stands between the drone and unexplored ship
 * and is worth walking to — the second of auto-explore's three questions.
 *
 * Two kinds of door qualify. A lock or a seam the rack can open: a lock
 * nobody aboard can pick is not a destination, it is a wall, and walking
 * three compartments to read four greyed-out lines is worse than being told
 * the sortie is over. And a door the free walk refused for a hazard — a known
 * trap on it, or a known hazard in the compartment beyond it — which plain
 * walking would take: that is the report's rule that automation stops a door
 * short and hands the decision over, and the door is where the decision is.
 *
 * Nearest by doors from here over the free walk, ties to the lower door id,
 * so a seed walks the same way twice.
 */
function nearestGate(game: RoomGame, here: RoomId, safe: DoorFilter): Gate | undefined {
  const ship = game.ship;
  const away = RoomDistance.from(ship, [here], safe);
  const reached = (room: RoomId): boolean => Number.isFinite(away.at(room));

  let best: { door: Door; inside: RoomId; dist: number } | undefined;
  for (const d of ship.doors) {
    if (d.a === d.b || safe(d)) continue;
    const inside = reached(d.a) ? d.a : reached(d.b) ? d.b : undefined;
    if (inside === undefined) continue;
    const beyond = ship.other(d, inside);
    // Some other route already covers the far side.
    if (reached(beyond)) continue;
    if (!passableForPlayer(d) && !canBreach(game, d)) continue;
    if (!unexploredBehind(ship, beyond)) continue;
    const dist = away.at(inside);
    if (!best || dist < best.dist || (dist === best.dist && d.id < best.door.id)) best = { door: d, inside, dist };
  }
  if (!best) return undefined;

  if (best.inside === here) return { door: best.door };
  const step = RoomDistance.from(ship, [best.inside], safe).nextDoor(here, safe);
  return step ? { door: best.door, step } : undefined;
}

/**
 * Is there unexplored ship on the far side of a door, counting from the
 * compartment it opens into and walking on through whatever simply opens?
 * The hazards are not counted here on purpose: what is behind a mined door is
 * behind it whether or not the drone has been told about the mine.
 */
function unexploredBehind(ship: Ship, from: RoomId): boolean {
  const seen = new Set<RoomId>([from]);
  const stack = [from];
  while (stack.length > 0) {
    const room = stack.pop()!;
    if (!ship.roomAt(room).explored) return true;
    for (const { door, room: beyond } of ship.neighbours(room)) {
      const next = beyond.id;
      if (next === room || seen.has(next) || !passableForPlayer(door)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

/**
 * What a walk says when it stops at a door: the hazard beyond it in the words
 * of the red line, or the state of the bulkhead. A mined lock is a hazard
 * first — the lock has four answers of its own on the list that opens.
 *
 * The hazard line ends by saying what the next press does, because the owner
 * pressed `o` eight times at one smoke-filled compartment and read the same
 * stop eight times (docs/tasks/G83-anonymous-blows.md, 3): a stop the player
 * cannot get past is not a warning, it is a wall. The screen remembers the
 * door (`ui/appstate.ts`, `Warning`), and the same ask again walks through.
 */
function gateStop(game: RoomGame, door: Door): { stop: string } {
  const danger = dangerAhead(game, door);
  if (danger !== undefined) {
    // A hazard behind a lock is a hazard first, and the second press opens
    // the lock's own ways rather than stepping through: the line must not
    // promise a step the door will not give.
    const key = passableForPlayer(door) ? "stop.hazard.again" : "stop.hazard";
    return { stop: t(key, { what: danger }) };
  }

  // What opens it, and which of that is aboard: the owner pressed `o` five
  // times at one lock and read `d1 (locked)` five times, with nothing in the
  // line to say what the lock wanted (docs/tasks/G83-anonymous-blows.md, 2).
  const tools = toolsFor(game, door);
  const shut = { door: door.label, state: doorStateWord(door.state) };
  if (tools.all.length === 0) return { stop: t("stop.shut", shut) };
  const ways = tools.all.join(", ");
  if (tools.held.length === 0) return { stop: t("stop.shut.none", { ...shut, ways }) };
  return { stop: t("stop.shut.ways", { ...shut, ways, have: tools.held.join(", ") }) };
}

/**
 * What opens that bulkhead, in the order the door's own list offers it
 * (`systems/doors.ts`, `LOCKED_METHODS`), and which of it this rack holds
 * right now. A lock has five answers and a welded seam has two, and the last
 * of either is the chassis itself, which is always aboard; anything else a
 * drone simply walks through and has no answers at all.
 *
 * The same question `systems/doors.ts` answers for the compartment the drone
 * is standing in, asked about a door several compartments off — which is what
 * lets a walk treat a lock as somewhere to go rather than as the end of the
 * ship, and what the stop line names when it gets there.
 */
function toolsFor(game: RoomGame, door: Door): { all: string[]; held: string[] } {
  const rig = rigOf(game.player);
  const carries = (kind: ModuleId): boolean => rig !== undefined && findSlotAs(rig, kind) !== null;
  const tools: Array<[string, boolean]> =
    door.state === "sealed"
      ? [
          [moduleName("cutter"), carries("cutter")],
          [verbWord("ram"), true],
        ]
      : door.state === "locked"
        ? [
            [moduleName("cell"), carries("cell")],
            [moduleName("spike"), carries("spike")],
            [moduleName("cutter"), carries("cutter")],
            [t("word.keycard"), keysHeld(game.player) > 0],
            [verbWord("ram"), true],
          ]
        : [];
  return {
    all: tools.map(([name]) => name),
    held: tools.filter(([, held]) => held).map(([name]) => name),
  };
}

/** Has this rack anything that opens that bulkhead, right now? A rack with nothing is why `o` says the sortie is over. */
function canBreach(game: RoomGame, door: Door): boolean {
  return toolsFor(game, door).held.length > 0;
}

/**
 * Which hull the walk is talking about: the callsign the voyage tagged the ship
 * with, or the plain word when a fixture never tagged one.
 *
 * The owner read `Корабль изучен.` standing aboard the tug and had no way to
 * tell which of the two ships on screen it meant (G54 §5). The callsign is the
 * name every other line of the screen already uses for it.
 */
function hullName(game: RoomGame): string {
  return tag(game, "name") ?? t("word.derelict").toUpperCase();
}

/**
 * The stop list, as one function of the run, shared by every walk there is.
 *
 * It is the interesting half of this file (see the header), so there is exactly
 * one copy of it: a machine in sight, a blow taken, the ship waking up, or
 * something lying in the compartment the walk has just entered. A second walk
 * with its own nearly-identical list would be two definitions of "something
 * happened", and the one that drifted would be the one nobody was reading.
 *
 * The closure is the snapshot: half of these are differences between two turns
 * rather than facts about one, and the first call only records — the crate the
 * drone is already standing over is not news.
 */
function makeWatch(leaving = false): (game: RoomGame) => { stop: string } | undefined {
  let before: Seen | undefined;

  return (game: RoomGame) => {
    if (game.isOver()) return { stop: t("stop.over") };

    const room = game.roomOf(game.player);
    const things = thingsIn(room);
    const signs = signsGiven(game);
    const seen = [...game.visibleMonsters()];
    const now: Seen = {
      room: room.id,
      things: new Set(things.map((t) => t.id)),
      durability: durability(game),
      alert: alertState(game).level,
      signs: new Set(signs),
      /* Everything in sight, plus everything sharing this compartment: the
         two differ only on the first call, which is exactly where it counts. */
      machines: new Set(seen.map((m) => m.id)),
    };
    const last = before;
    before = now;

    /*
     * A machine that has just come into sight.
     *
     * On the first call — the moment the key is pressed — anything already in
     * sight is news and hands the ship back. That is `o`'s whole contract and
     * it is why this check runs before the rest of the list, which works the
     * other way round: the crate the drone is already standing over is not
     * news, but a machine is.
     *
     * `leaving` is the one exception, and it belongs to travel alone. A walk
     * begun beside a scout used to return a stop before a single step was
     * taken: pressing a compartment on the board moved the drone not at all
     * while the route ring sat there as though it had, and a drone sharing a
     * compartment with a machine could not walk away from it — which is the
     * one moment you most want to. Naming a destination means "go there", and
     * the thing you are standing next to is what you are trying to leave.
     *
     * `o` does not get it, and that is not an oversight. Explore means "keep
     * going while nothing needs me", and a machine an arm's length away needs
     * you; without the stop the careful bot walks past the fight it should
     * have taken and dies of it, which is how this came back measured rather
     * than argued (`tests/hazards.test.ts`, the two hundred voyages).
     */
    const woke = seen.find((m) =>
      last === undefined ? !(leaving && m.room === room.id) : !last.machines.has(m.id),
    );
    if (woke !== undefined) {
      return {
        stop: t("stop.machine", {
          machine: entityLabel(game, woke),
          room: roomName(game.roomOf(woke)),
        }),
      };
    }

    if (!last) return undefined;

    // A red line the step just earned is the stop the whole hazard design is
    // for: the sign comes a compartment early, and the walk stops on it the
    // way it stops on a machine, so the step after it is the player's. Not
    // the compartment underfoot, though: a hazard the drone has just walked
    // into on purpose counts as told without a line (`systems/hazards.ts`,
    // `tell`), and the block under the schematic is already saying the word.
    const sign = signs.find((s) => !last.signs.has(s) && !standingIn(s, room.id));
    if (sign !== undefined) return { stop: t("stop.hazard", { what: newestSign(game, sign) }) };
    if (now.durability < last.durability) return { stop: t("stop.hit") };
    if (now.alert > last.alert) return { stop: t("stop.alert") };
    // A compartment the walk has just entered was never snapshotted, so
    // everything in it is new — which is the case the stop exists for.
    const fresh = things.find((t) => last.room !== room.id || !last.things.has(t.id));
    return fresh ? { stop: t("stop.thing", { thing: fresh.noun }) } : undefined;
  };
}

/**
 * The red line for a sign just given, read back off the record it names —
 * the same words the log has, so the stop and the line are one sentence
 * twice rather than two sentences about one thing.
 */
function newestSign(game: RoomGame, sign: string): string {
  const here = game.roomOf(game.player).id;
  const [id, room, door] = signParts(sign);
  const rec = hazardRecords(game).find(
    (r) => r.id === id && String(r.room ?? "-") === room && String(r.door ?? "-") === door,
  );
  const line = rec === undefined ? undefined : hazardLine(game, rec, here);
  return line ?? t("word.derelict");
}

/** Is this sign the compartment the drone is standing in? Door traps never are. */
function standingIn(sign: string, here: RoomId): boolean {
  return signParts(sign)[1] === String(here);
}

/** `id:room:door` as `signsGiven` writes it, with `-` for the half a record has not got. */
function signParts(sign: string): [string, string, string] {
  const [id = "", room = "-", door = "-"] = sign.split(":");
  return [id, room, door];
}

/**
 * Travel: walk to a compartment the player named, and stop at the first thing
 * worth a decision (docs/tasks/G48-travel-to-a-room.md).
 *
 * The owner's rule, word for word: «лучше на движение выбирается любая точка и
 * ты идёшь туда, пока не упрёшься во врага или закрытую дверь». It is DCSS's
 * travel command and it earns its place the same way `o` does — every step it
 * takes is a step whose answer was already "walk on", and it hands the ship
 * back the moment that stops being true. Nothing is free: each step is an
 * ordinary `go`, the world moves between them, and a route that has become
 * impossible mid-walk simply stops.
 *
 * Three ways it can end that `o` has no equivalent for: arriving, running
 * into something shut, and coming up to a hazard the drone knows about. The
 * last two name the door, and the screen answers by opening that bulkhead's
 * own list of ways through it — for a hazard, the step in and whatever lifts
 * it — so "the second press goes on" is the `go` line of that list. Opening
 * a bulkhead does *not* resume the walk — three turns with a torch is long
 * enough for the ship to have become a different ship, and a drone that then
 * wandered on by itself would be the automation the genre checklist forbids.
 *
 * `through` is the door the same walk stopped at last time and the player has
 * asked past (`makeExplorer` says the rest): the first step may take it, and
 * only the first.
 */
export function makeTraveller(goal: RoomId, through?: DoorId): Explorer {
  const watch = makeWatch(true);
  let confirmed = through;

  return {
    step(game: RoomGame): AutoResult {
      const pass = confirmedDoor(game, confirmed);
      confirmed = undefined;

      const interrupt = watch(game);
      if (interrupt) return interrupt;

      const room = game.roomOf(game.player);
      if (room.id === goal) return { stop: t("stop.arrived", { room: roomName(room) }) };

      const route = travelRoute(game.ship, room.id, goal, safeForPlayer(game, pass?.id));
      const next = route?.[0];
      if (!next) return { stop: t("stop.noWay") };
      if (!passableForPlayer(next) || (next.id !== pass?.id && dangerAhead(game, next) !== undefined)) {
        return { ...gateStop(game, next), door: next.id };
      }
      return { cmd: { kind: "go", door: next.id } };
    },
  };
}

/**
 * Doors a walk may use once the drone is willing to open what is in the way:
 * everything but the airlock, because leaving the ship is not moving about
 * inside it.
 *
 * This is what makes a locked bulkhead a *destination* rather than a wall. The
 * route through it is planned, walked up to and then handed to the player as a
 * question — which is the difference between "STORAGE is behind d3 (locked)"
 * and a list that simply does not mention STORAGE.
 */
export function breachable(door: Door): boolean {
  return door.state !== "airlock";
}

/**
 * The doors between here and there, in order, or undefined when there is no
 * route at all.
 *
 * A clear route wins whenever one exists, even a longer one: a player who can
 * walk round a lock would rather walk than spend a torch, and the walk cannot
 * ask. Only when plain walking cannot reach the compartment does the route go
 * through something shut — and then the first shut door on it is the thing the
 * list names and the walk stops at.
 *
 * `safe` narrows the clear route further, to doors that cost nothing at all:
 * with it, a way round a known hazard is taken before the way through one,
 * which is the report's "обход по петле предлагается первым". Without it the
 * route is the plain one, which is all `<` at the airlock needs.
 */
export function travelRoute(ship: Ship, from: RoomId, goal: RoomId, safe?: DoorFilter): Door[] | undefined {
  const tiers: DoorFilter[] = safe ? [safe, passableForPlayer, breachable] : [passableForPlayer, breachable];
  let map: RoomDistance | undefined;
  let filter: DoorFilter = breachable;
  for (const tier of tiers) {
    const candidate = RoomDistance.from(ship, [goal], tier);
    if (!Number.isFinite(candidate.at(from))) continue;
    map = candidate;
    filter = tier;
    break;
  }
  if (map === undefined) return undefined;

  const out: Door[] = [];
  let at = from;
  // The ship is finite and every step strictly descends the map, so this ends;
  // the bound is belt and braces against a map and a filter that disagree.
  while (at !== goal && out.length <= ship.size) {
    const door = map.nextDoor(at, filter);
    if (!door) return undefined;
    out.push(door);
    at = ship.other(door, at);
  }
  return at === goal ? out : undefined;
}

/**
 * One turn of closing in — the owner's rule, word for word (design-doc.md,
 * "`Tab` — сблизиться и ударить"): shoot if the shot is there, hit what is in
 * the compartment, otherwise take one step towards the nearest machine you know
 * of. Never "fight until one of us dies" — that is the version that decides the
 * fight for the player, and it is the version the checklist forbids.
 *
 * `melee` is shift+tab, and it is a second key rather than a mode because the
 * choice it makes is *which module to expose*: a shot risks the EMITTER, a swing
 * risks the CUTTER, a step risks the THRUSTERS. A rack with no melee weapon at
 * all — GHOST — has nothing to choose between, so it shoots either way.
 *
 * Every branch has to hand back a command the game will accept. One press is
 * one turn, and a press that cannot be a turn has to say so — a key that keeps
 * answering with a refusal is a key the player has lost, and with a jammer
 * standing in the compartment it would be lost for exactly as long as the one
 * machine that caused it is alive.
 */
export function engage(game: RoomGame, mode: "best" | "melee" = "best"): AutoResult {
  if (game.isOver()) return { stop: t("stop.over") };

  const here = game.roomOf(game.player).id;
  const rig = rigOf(game.player);
  // A jammer in the room switches the active modules off before the turn is
  // spent (`systems/jam.ts`), the EMITTER among them, so the shot is not on
  // offer — closing in is. Which is also the right answer: the jammer is in
  // this compartment, and hitting it is what turns the rack back on.
  const emitter = rig !== undefined && findSlot(rig, "emitter") !== null && !jammed(game);
  if (emitter && (mode === "best" || !hasMelee(rig!)) && shootTarget(game)) {
    return { cmd: { kind: "act", verb: "shoot" } };
  }

  const inRoom = hostilesIn(game, here);
  if (inRoom[0]) return { cmd: { kind: "attack", target: inRoom[0].id } };

  const known = knownMachineRooms(game, here);
  if (known.length === 0) return { stop: hazardHitting(game) ?? t("stop.noTarget") };

  // The step towards it, and never into something the drone has been told
  // about: a known hazard on the only way there is a decision, not a step,
  // and the key says so instead of taking it (`content/hazards.ts`, rule 2).
  const safe = safeForPlayer(game);
  const towards = RoomDistance.from(game.ship, known, safe).nextDoor(here, safe);
  if (towards) return { cmd: { kind: "go", door: towards.id } };
  const plain = RoomDistance.from(game.ship, known, passableForPlayer).nextDoor(here, passableForPlayer);
  return plain ? { stop: t("why.auto.hazard") } : { stop: t("stop.noWay") };
}

/**
 * What is about to hit the drone when no machine is: the charge the ship set
 * in the compartment it is standing in (`systems/alert.ts`, the scuttle).
 * `Tab` used to answer "No target in sight" to a drone the ship itself was
 * taking apart, and the owner read an invisible machine into it
 * (docs/tasks/G83-anonymous-blows.md, 1): the honest answer is what is doing
 * the hitting, and what to do about it.
 */
function hazardHitting(game: RoomGame): string | undefined {
  return fuseIn(game, game.roomOf(game.player).id) !== undefined ? t("why.fight.hazard") : undefined;
}

// ------------------------------------------------------------------ the ship

/**
 * Machines the drone can see, the one it would meet first at the head of the
 * list. The id tie-break is what keeps two machines at equal range from making
 * the same seed play out two ways.
 */
function nearestVisible(game: RoomGame): Entity | undefined {
  const here = game.roomOf(game.player).id;
  const rank = (e: Entity): number => (e.room === here ? 0 : 1);
  return [...game.visibleMonsters()].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0];
}

/**
 * Compartments where the drone knows a machine stands: the ones it can see into
 * right now, and the ones a sensor pulse left a snapshot of. The snapshot is a
 * memory and may be stale — that is the model, not a bug (design-doc.md, "Что
 * видит игрок"), and one press of `Tab` is one turn, so a ghost costs a step.
 */
function knownMachineRooms(game: RoomGame, here: RoomId): RoomId[] {
  const rooms = new Set<RoomId>();
  for (const m of game.visibleMonsters()) {
    if (m.room !== undefined && m.room !== here) rooms.add(m.room);
  }
  // And whatever shot the drone through a shut door this turn. Without this,
  // a drone whose SCANNER has burned answers every press of Tab with `no
  // targets in sight` while an enforcer takes it apart from the next
  // compartment (`strikersNear` in ui/panel.ts). Being shot tells you where
  // from; the key has to be able to act on that.
  for (const { room } of strikersNear(game, here)) rooms.add(room);
  for (const room of game.ship.rooms) {
    if (room.id !== here && snapshotHasMachine(room)) rooms.add(room.id);
  }
  return [...rooms].sort((a, b) => a - b);
}

/** Glyphs a pulse snapshot uses for things rather than for machines. */
const SALVAGE_GLYPHS = new Set(["%", "X"]);

/** The pocket round-trips through a save file, so nothing in it may be trusted. */
function snapshotHasMachine(room: Room): boolean {
  const raw = room.data.snapshot;
  if (typeof raw !== "string") return false;
  return raw.split(" ").some((glyph) => glyph.length > 0 && !SALVAGE_GLYPHS.has(glyph));
}

/** The compartment the airlock hangs off — where a finished sortie walks back to. */
export function airlockRoom(ship: Ship): RoomId {
  const airlock = ship.airlock();
  return airlock ? airlock.a : ship.entry;
}

/** How the walk reports the way out. A ship with no route left says so plainly. */
function airlockLine(doors: number): string {
  if (!Number.isFinite(doors)) return t("stop.airlock.none");
  if (doors === 0) return t("stop.airlock.here");
  return t("stop.airlock.away", { n: doors });
}

/** One thing lying in a compartment: its id, and what the log calls it. */
interface Thing {
  id: number;
  noun: string;
}

/**
 * Everything a compartment holds besides its doors — wreckage, bodies, cargo,
 * a charter's errand, one of the ship's own systems (design-doc.md,
 * "Автоисследование `o`"). Read through `roomList`, which never writes an empty
 * bucket into a room: a walk that looks at the ship must not change it.
 */
function thingsIn(room: Room): Thing[] {
  const out: Thing[] = [];
  for (const w of roomList<Wreck>(room, "wrecks")) {
    out.push({ id: w.id, noun: w.glyph === "X" ? t("thing.partsCrate") : t("thing.scrap") });
  }
  for (const b of roomList<Body>(room, "bodies")) {
    out.push({ id: b.id, noun: t("thing.body") });
  }
  for (const c of roomList<Crate>(room, "crates")) {
    out.push({ id: c.id, noun: c.kind === "contraband" ? t("thing.contraband") : t("thing.cargo") });
  }
  for (const i of roomList<RoomItem>(room, "items")) {
    out.push({ id: i.id, noun: i.kind === "console" ? t("thing.console") : t("thing.package") });
  }
  for (const s of roomList<ShipSystem>(room, "systems")) {
    out.push({ id: s.id, noun: tId("thing.system", s.kind, s.kind) });
  }
  return out;
}

/**
 * A rack that can swing at something. Everything else rams, and GHOST only
 * rams. A relic that answers for the cutter — the blade — is a swing too.
 */
function hasMelee(rig: Rig): boolean {
  return findSlotAs(rig, "cutter") !== null || findSlot(rig, "laser") !== null;
}

/**
 * Everything a blow can take: the rack plus CORE. One number, because
 * auto-explore does not care what was hit, only that something was.
 */
function durability(game: RoomGame): number {
  const rig = rigOf(game.player);
  const slots = rig ? rig.slots.reduce((sum, s) => sum + (s?.integrity ?? 0), 0) : 0;
  return slots + game.player.hp;
}
