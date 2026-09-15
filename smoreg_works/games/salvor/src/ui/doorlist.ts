import type { Door, DoorId, RoomCommand, RoomGame } from "@jamrog/engine";
import { moduleName } from "../content/modules.js";
import { isTug } from "../content/tug.js";
import { gatedOffers } from "../systems/tug.js";
import { doorStateWord, verbWord } from "../content/words.js";
import { t } from "../i18n.js";
import {
  ACTION_WIDTH,
  backAction,
  backToRoom,
  clipName,
  doorMenu,
  farName,
  gated,
  keyed,
  lessonGateOf,
  methodAction,
  pad,
  waysHere,
  type Action,
  type DoorWay,
} from "./actions.js";

/**
 * The bulkheads of this compartment, as a list of their own: the level `d`
 * opens (docs/tasks/G64-door-hotkeys.md).
 *
 * Doors came off the compartment's own list when walking became a destination
 * (G48): the map `m` opens says where each one leads and what stands in the
 * way, and four bulkheads listed twice on a twenty-eight column panel were four
 * rows taken from the salvage and the ship's systems. What went with them is
 * everything a player might want to do to a door rather than through it —
 * shutting one on something that is shooting, welding one shut behind the drone
 * — which was left reachable only by a letter aimed at whichever door the rules
 * happened to offer first (`ui/appstate.ts`, `aimed`). With two bulkheads in a
 * compartment that letter is a guess.
 *
 * So `d` is the doors, one row each, in door order, saying what state each one
 * is in and what pressing it would do. It is the same machinery the map and the
 * tug already use: a row with one way through it does that way, a row with
 * several steps down into them (G46), and a row with none is greyed with the
 * reason on it. No modal window, no mode — `0` and `Esc` come back, and the
 * level falls away by itself the moment the drone leaves the compartment.
 *
 * The rows are ordered by door id and by nothing else. The map orders by
 * distance and the compartment's own list floats what can be pressed to the
 * top; both are right for what they are, and both would be wrong here — a
 * player who welds `d1` shut must not find that `d3` has taken its number,
 * because the number is the whole of what a numbered list promises.
 */

/** What `d` would do with no list at all, or why it will not. */
export type Sealing = { ok: true; cmd: RoomCommand } | { ok: false; why: string };

/**
 * The list `d` shows: a row per bulkhead of this compartment, then the way out.
 *
 * The airlock is not one of them. It is not a way about the ship but a way out
 * of it, it has a line of its own on the compartment's list (`ui/actions.ts`,
 * `airlockRow`) and a key of its own in `<`, and nothing can be done to it: the
 * rules offer no verb for a hull's own hatch.
 */
export function doorLevel(game: RoomGame, cursor = 0): Action[] {
  return keyed([...gated(game, lessonGateOf(game), doorRows(game)), backToRoom()], cursor);
}

/**
 * The list one level down: every way with this bulkhead, priced, and the line
 * back out to the doors.
 *
 * It is G46's sublist with one difference, and the difference is why it is here
 * rather than in `roomActions`: that one is only ever asked about a door the
 * drone cannot walk through (`doorMethods`), because it is reached off the map,
 * where an open door is a road and not a question. Reached off `d` an open door
 * is very much a question — shut it, or weld it — so this level is the one that
 * knows about doors the drone could simply walk through.
 *
 * Nothing is hidden and nothing is reordered: the ways stand in the order the
 * systems offer them, and one the drone cannot spend is greyed with the reason
 * on it rather than dropped.
 */
export function doorWays(game: RoomGame, id: DoorId, cursor = 0): Action[] | undefined {
  const door = doorsHere(game).find((d) => d.id === id);
  if (door === undefined) return undefined;
  const ways = waysOf(game, door);
  if (ways.length < 2) return undefined;
  // The step through is worded as the `d` level words its rows — verb, door,
  // what is behind it, what state it is in — because that is what it is: the
  // same line the row would be if walking were the only answer. The methods
  // after it are priced, as methods are.
  const lines = ways.map((way) => (way.verb === "go" ? { ...methodAction(way), label: doorLabel(game, door, "go") } : methodAction(way)));
  return keyed([...gated(game, lessonGateOf(game), lines), backAction(door)], cursor);
}

/** Is that bulkhead's own list of ways still standing? */
export function doorWaysStand(game: RoomGame, id: DoorId): boolean {
  return doorWays(game, id) !== undefined;
}

/**
 * Is the level still a question? It stops being one when nothing in this
 * compartment has a bulkhead the rules will say anything about — the drone
 * walked out, or cut the last one open.
 *
 * A door with ways nobody can spend still counts. A lock the drone has no tool
 * for is precisely the thing a player needs to read: "what opens this" is
 * taught by showing it greyed next to the door that needs it (design-doc.md,
 * "Обучение конструкцией").
 */
export function doorsStand(game: RoomGame): boolean {
  if (isTug(game) || game.status !== "playing") return false;
  return doorsHere(game).some((door) => waysOf(game, door).length > 0);
}

/**
 * One bulkhead, one way through it — the case that must not cost a keystroke.
 *
 * A corridor behind a single welded seam with a torch on the rack is `d` and
 * nothing else; making the player read a list of one line and then press it is
 * the defect `tugRow` and `doorRow` already avoid, and this is the same rule in
 * the same words. A door the drone can walk through is never this case: the
 * step through is always one of its ways (`passing`), so it is always a list.
 */
export function soleWay(game: RoomGame): DoorWay | undefined {
  if (isTug(game) || game.status !== "playing") return undefined;
  const doors = doorsHere(game);
  const only = doors.length === 1 ? doors[0] : undefined;
  if (only === undefined) return undefined;
  const ways = waysOf(game, only);
  return ways.length === 1 && ways[0]!.enabled ? ways[0] : undefined;
}

/**
 * `D`: the bulkhead the drone came through, welded shut behind it.
 *
 * This is the trap the whole key exists for. A machine that is not a breacher
 * never opens a sealed door (`Ship.passable`), so a compartment with one way in
 * and a seam across it is a machine that is out of the run — the owner's own
 * words for what he wanted the key for: «сгенеренный робот в заваренной комнате
 * не выберется». The ENFORCER is the answer to it and the one machine that has
 * one: it is a `breacher`, it cuts, and it arrives.
 *
 * Every refusal here is the rules' own, in the rules' own words, and none of
 * them spends a turn. The welding offer is what carries them: `systems/doors.ts`
 * has already decided whether this door can be welded at all, whether the rack
 * carries the torch, and whether sealing it would wall the drone in
 * (`stillLeadsHome`) — asking the offer rather than re-deciding is what keeps
 * the key and the numbered line the same move.
 */
export function sealBehind(game: RoomGame): Sealing {
  const door = doorBehind(game);
  if (door === undefined) return { ok: false, why: t("why.door.notBehind") };

  const weld = waysOf(game, door).find((w) => w.verb === "weld");
  if (weld === undefined) {
    // The rules offer welding on an open or a closed bulkhead and on no other,
    // and only with the torch aboard (`doorOffers`). So the offer being absent
    // is one of exactly two facts, and both are worth the player's while.
    return { ok: false, why: weldable(door) ? missingWelder() : t("why.door.noWeld", { door: door.label }) };
  }
  if (!weld.enabled) return { ok: false, why: weld.why ?? t("why.door.wallsIn", { door: door.label }) };
  return { ok: true, cmd: weld.cmd };
}

/**
 * The bulkhead the drone walked through to get here, off the run's own record
 * of what was pressed.
 *
 * `game.inputs` holds the commands that were accepted, in order, because a run
 * replays out of it — so the last `go` in it is the last door the drone went
 * through, and no system has to keep a note of its own to say so.
 *
 * The scan stops where the drone stopped being aboard this hull: `leave` is the
 * airlock and `undock` is the next sortie, and a door id from the ship before
 * this one would name a perfectly real bulkhead of the ship after it.
 */
export function doorBehind(game: RoomGame): Door | undefined {
  if (isTug(game)) return undefined;
  const here = game.roomOf(game.player).id;
  for (let i = game.inputs.length - 1; i >= 0; i--) {
    const cmd = game.inputs[i]!;
    if (cmd.kind === "leave") return undefined;
    if (cmd.kind === "act" && (cmd.verb === "undock" || cmd.verb === "jump")) return undefined;
    if (cmd.kind !== "go") continue;
    const door = game.ship.doors[cmd.door];
    // Still a door of this compartment, or the drone has walked on since.
    if (!door || (door.a !== here && door.b !== here)) return undefined;
    return door;
  }
  return undefined;
}

/** What the rules will weld: the two states `doorOffers` puts the torch on. */
function weldable(door: Door): boolean {
  return door.state === "open" || door.state === "closed";
}

/**
 * The line a missing torch earns, in the words the action list would have used
 * for the same refusal (`systems/doors.ts`, `missing`). One refusal, one
 * wording, however it was reached.
 */
function missingWelder(): string {
  return t("why.module.missing", { module: moduleName("welder") });
}

/** Every bulkhead of this compartment, in door order. The airlock is not one. */
function doorsHere(game: RoomGame): Door[] {
  const here = game.roomOf(game.player).id;
  return [...game.ship.doorsOf(here)]
    .filter((door) => door.state !== "airlock")
    .sort((a, b) => a.id - b.id);
}

function doorRows(game: RoomGame): Action[] {
  const ways = waysHere(game);
  return doorsHere(game).map((door) => doorRow(game, door, waysOf(game, door, ways)));
}

/**
 * Everything the rules will do to one bulkhead, in the order they offer it.
 *
 * Shutting a door is here and is not one of the ways *through* one, which is
 * why it has to be fetched separately: `waysHere` carries what opens a door,
 * because that is what the module letters aim at, and the compartment's own
 * list has always given `close` a line of its own (`ui/actions.ts`,
 * `LATE_VERBS`). On this level the difference does not exist — a door is a
 * thing to be dealt with, and shutting one is the commonest way of dealing with
 * it, so it leads, exactly as `doorOffers` lists it.
 */
function waysOf(game: RoomGame, door: Door, all?: readonly DoorWay[]): DoorWay[] {
  return [...passing(game, door), ...shutting(game, door.id), ...waysFor(all ?? waysHere(game), door.id)];
}

/**
 * The step through a door the drone can simply walk through — open, closed,
 * broken — as the first way with it, ahead of shutting or welding it.
 *
 * The rules offer no verb for walking, because walking is `go` and a closed
 * door opens on the way through (`rooms/actions.ts`, `doGo`); so off `d` a
 * closed door used to have exactly one way, and that way was welding it shut
 * for good — «почему на d я не могу просто открыть дверь?»
 * (docs/tasks/G83-anonymous-blows.md, 6). The list reads the same for all
 * three states now: through, then what else can be done to it.
 */
function passing(game: RoomGame, door: Door): DoorWay[] {
  if (!game.ship.passable(door, { isPlayer: true })) return [];
  return [{ verb: "go", letter: "", cmd: { kind: "go", door: door.id }, enabled: true }];
}

/** The `close` offer for one bulkhead, worded as a way like any other. */
function shutting(game: RoomGame, door: DoorId): DoorWay[] {
  return gatedOffers(game)
    .filter((o) => o.cmd.kind === "act" && o.cmd.verb === "close" && o.cmd.target === door)
    .map((o) => {
      // No letter: `close` never had one, and the row it is on is reached by
      // its number or by the cursor like every other line of the list.
      const way: DoorWay = { verb: "close", letter: "", cmd: o.cmd, enabled: o.enabled };
      if (o.why !== undefined) way.why = o.why;
      return way;
    });
}

/** The ways aimed at one bulkhead. `target` is what tells a door offer apart. */
function waysFor(ways: readonly DoorWay[], door: DoorId): DoorWay[] {
  return ways.filter((w) => w.cmd.kind === "act" && w.cmd.target === door);
}

/**
 * One bulkhead as a row: what pressing it does, which door, what is behind it,
 * and what state it is in.
 *
 * The verb is on the row only when pressing the row spends it. With several
 * ways the row is a choice and the verbs are one level down, where there is
 * room to print what each one costs; putting one of them on the row would be
 * the list saying `open d3` about a door it is going to offer four answers for.
 */
function doorRow(game: RoomGame, door: Door, ways: readonly DoorWay[]): Action {
  const at = { leadsTo: game.ship.other(door, game.roomOf(game.player).id) };
  if (ways.length > 1) return { ...doorMenu(door, doorLabel(game, door, ""), ways), ...at };

  const only = ways[0];
  if (only === undefined) {
    // The same refusal the compartment's own list gives for a bulkhead nothing
    // can be done about (`ui/actions.ts`, `doorRow`), so the wording of "that
    // door is sealed" cannot drift into two.
    const line: Action = {
      key: "",
      label: doorLabel(game, door, ""),
      cmd: { kind: "go", door: door.id },
      enabled: false,
      why: t("why.door.state", { door: door.label, state: doorStateWord(door.state) }),
    };
    return { ...line, ...at };
  }

  const line: Action = {
    key: "",
    label: doorLabel(game, door, only.verb),
    cmd: only.cmd,
    enabled: only.enabled,
    ways,
  };
  if (only.why !== undefined) line.why = only.why;
  return { ...line, ...at };
}

/**
 * `close d1  HAB BLOCK  open` — the four columns every line of this list has
 * ever had: what it costs, which door, where it goes, what stands in the way.
 *
 * The compartment's name is what gives way when a language runs long, and it
 * gives way at a word (`clipName`): the schematic names it too, and a name cut
 * mid-syllable reads as a typo rather than as a width
 * (docs/tasks/G55-playtest-findings.md, 8).
 */
function doorLabel(game: RoomGame, door: Door, verb: string): string {
  const head = pad(verb === "" ? door.label : `${verbWord(verb)} ${door.label}`, VERB_W);
  const state = doorStateWord(door.state);
  const width = Math.min(NAME_W, Math.max(2, ACTION_WIDTH - head.length - state.length));
  return head + pad(clipName(farName(game, door), width - 1), width) + state;
}

/** Columns for `close d1`, and for the compartment behind the door. */
const VERB_W = 8;
const NAME_W = 10;
