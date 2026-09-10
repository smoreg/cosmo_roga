import {
  isAlive,
  type ActionOffer,
  type Door,
  type DoorId,
  type Entity,
  type RoomCommand,
  type Room,
  type RoomGame,
  type RoomId,
  type Ship,
} from "@jamrog/engine";
import { moduleName } from "../content/modules.js";
import { machineName } from "../content/monsters.js";
import { isTug } from "../content/tug.js";
import { verbWord, doorStateWord } from "../content/words.js";
import { roomName } from "../content/zones.js";
import type { Key } from "../content/i18n/keys.js";
import { t, tId } from "../i18n.js";
import { gatedOffers } from "../systems/tug.js";
import { pickLabel, stationTargets, voyageRecord } from "../systems/voyage.js";
import { wreckAt } from "../twist/rig.js";
import { dangerAhead, passableForPlayer, travelRoute } from "./auto.js";

/**
 * The numbered action list: "выбираем что делать текстом" (design-doc.md, "Ход
 * и действия"), as a pure function of the game.
 *
 * This is the second pillar of the screen beside the schematic, and the only
 * place a player's `5` becomes a command. It is built here rather than in the
 * renderer for the reason every rule in this repo lives outside the DOM: the
 * order of the blocks, what a locked door offers and whether an entry is
 * pressable at all are game rules, and a rule nobody can test is a rule that
 * quietly stops holding.
 *
 * The list never lies in the one direction that matters: an entry marked
 * `enabled` is one `playerCommand` accepts. A disabled one is still shown —
 * a locked door the drone cannot open yet is information, not noise — and
 * pressing it costs no turn and prints `why`.
 *
 * The list has one level under it, and only one: a locked bulkhead. A lock has
 * four answers, and the list used to number the first one the drone could do
 * and hang the rest off letters under it — three ways a player had to already
 * know, one of which had no room left for its own word, and not a syllable
 * about what any of them cost. So that line stopped being an action and became
 * a choice: pressing `open d3` replaces the list with the four methods of that
 * bulkhead, priced, and `0` puts it back (docs/tasks/G46-nested-actions.md).
 *
 * It is the same list, in the same place, one level down — not a window over
 * it. A modal screen is the one thing design-doc.md, "Явно НЕ входит в игру"
 * rules out by name, and non-modality is a line of the genre checklist the jam
 * is judged against.
 *
 * Walking has a level of its own above that one (`m`,
 * docs/tasks/G48-travel-to-a-room.md). Moving about is the commonest thing
 * anybody does aboard a hull, and its number was a different number every turn:
 * the owner's fourth playtest had to read down a list of wreckage, bodies and
 * consoles to find the line that walks, and then press one such line per door.
 * So `m` swaps the list for the compartments the drone knows of, nearest first,
 * and picking one walks there a turn at a time until the ship raises a question
 * (`ui/auto.ts`, `makeTraveller`). A bulkhead that is shut is one of those
 * questions, and the answer is its own list of ways through it — the second
 * half of the same complaint ("двинулся в сторону закрытой — предлагает
 * варианты"). The doors stay on the compartment's own list as well: `m` is a
 * short way about the ship, not the only one.
 */

/**
 * What the list can step one level into: a bulkhead of this compartment, or a
 * verb of the tug.
 */
export type Level = DoorId | string;

export interface Action {
  /** "1".."9", "0", or "" for anything past the tenth. */
  key: string;
  label: string;
  cmd: RoomCommand;
  enabled: boolean;
  /** Why it cannot be pressed. Shown in the log when it is pressed anyway. */
  why?: string;
  /**
   * A second row under the line. Nothing sets it since the letters under a
   * locked door became that door's own list; both renderers still draw it, so
   * it stays as the panel's contract rather than being deleted out from under
   * them.
   */
  extra?: string;
  /**
   * A heading printed above this line: the group it opens, on the tug's list.
   *
   * A property of the row rather than a row of its own, and that is the whole
   * of why the grouping cost nothing. A heading with a key would take one of
   * the ten; a heading without one would be counted as a line the panel could
   * not fit (`omittedActions`), and the cursor would stop on furniture. This
   * way every list is still one `Action` per pressable line, and a renderer
   * that has never heard of groups draws the same list it always did.
   */
  head?: string;
  /** The ways through this door as data, for whoever fires one of the letters. */
  ways?: readonly DoorWay[];
  /**
   * A line that moves the list rather than the world: what it steps into, or
   * `null` for the line back out. Neither is a turn, and `appReducer` reads
   * this before it reads `cmd`.
   *
   * A `DoorId` is a bulkhead and its ways through; a string is a verb of the
   * tug and the modules it could be aimed at. One level, one field and one key
   * to leave it, whichever of the two is open — the tug's groups are not a
   * second mechanism, they are the one G46 built, pointed at a rack instead of
   * a lock (docs/tasks/G53-tug-is-a-menu.md, 1а).
   */
  step?: Level | null;
  /**
   * A line that walks: the compartment the drone sets out for. The walk is
   * turns — one `go` at a time, stopping at the first thing worth a decision
   * (`ui/auto.ts`, `makeTraveller`) — and `cmd` is its first step, so anything
   * that reads this list as commands and knows nothing about walks still moves
   * in the right direction.
   */
  travel?: RoomId;
  /**
   * The compartment this line points at, walk or single step, reachable or not.
   * Read by the screen and by nothing else: the box the cursor is aiming at is
   * lit on the schematic, so `m` says where a line goes on the map and not only
   * in words ("на m надо подсвечивать в какой блок идём" — the owner).
   *
   * Separate from `travel`, which is a command and means "walk there over
   * several turns". One open door away is deliberately not a walk, and making
   * the map able to point at it must not turn it into one.
   */
  leadsTo?: RoomId;
}

/**
 * One method that opens this door.
 *
 * The letters are a control, not a caption: pressing `K` at a locked bulkhead
 * has to reach the same turn its number would (`ui/appstate.ts`, `aimed`), and
 * a rendered string is not something a reducer can aim. So the ways are kept as
 * what they are — commands — and the door's own list is only how they are drawn.
 */
export interface DoorWay {
  verb: string;
  /** The key that fires it, or "" for a method with no letter of its own. */
  letter: string;
  cmd: RoomCommand;
  enabled: boolean;
  /** Why this one cannot be spent: the module that burned, the card that is gone. */
  why?: string;
}

/** The keys of the list, in order. Ten entries, because `0` follows `9`. */
export const ACTION_KEYS = "1234567890";

export const MAX_ACTIONS = ACTION_KEYS.length;

/**
 * The key that goes back up a level. It is the last of the ten rather than a
 * letter of its own so that the way out of a door's list is a line of that
 * list, numbered like every other — no key a player has to be told about.
 */
export const BACK_KEY = "0";

/** Columns one action may use: the panel's width minus its ` N ` prefix. */
export const ACTION_WIDTH = 25;

/**
 * A compartment the drone has neither entered nor swept: the schematic's own
 * mark. The panel's block of doors says it about the far side of a shut one
 * (`ui/panel.ts`, `farRoomName`); the map never has to, because a compartment
 * with no name is not a destination anybody can pick out of a list.
 */
export const UNKNOWN_ROOM = "····";

/**
 * Verbs a system aims at a door, and the letter that fires each one. The map is
 * what tells a door offer from an offer about something lying on the floor:
 * `target` is one number for doors, wrecks and ship systems alike, so matching
 * on the id alone would read `salvage 3` as a way through `d3`.
 *
 * The keycard is the one entry here that is not a module, and it has a letter
 * all the same. It is offered last of the four (`systems/doors.ts`,
 * `LOCKED_METHODS`), so it is almost never the way that takes the number — and
 * a method with no letter and no number is a method the player does not have.
 */
const DOOR_VERBS: Record<string, string> = {
  key: "a",
  power: "p",
  spike: "K",
  cut: "c",
  weld: "w",
  // Lifting a mine off a door (`systems/doors.ts`): a way of dealing with the
  // door, listed with the ways through it and reached by number only — `w`
  // is the weld, and one letter cannot mean two turns.
  defuse: "",
};

/**
 * Offers that belong after the doors: shutting one, then the ship's own systems
 * and consoles.
 *
 * `close` is here and deliberately not in `DOOR_VERBS`, and the difference is a
 * defect the list carried until G40. A door verb is a *way through* a door, so
 * the door block folds it into that door's one line — and a door already open
 * takes the plain `go` line, which meant every `close` `systems/doors.ts`
 * offered was silently swallowed and no bulkhead could ever be shut. Closing
 * one on something that is shooting through it is not a way through it; it is
 * its own decision and it gets its own line (docs/tasks/G40-tug-clarity.md, 7).
 */
const LATE_VERBS = new Set(["close", "work", "upload"]);

/** How the door block is ordered: what costs nothing, then what costs a tool. */
const DOOR_RANK: Record<string, number> = {
  open: 0,
  broken: 0,
  closed: 0,
  locked: 1,
  sealed: 2,
  airlock: 3,
};

/**
 * Everything that can be done in this compartment, in the order design-doc.md
 * fixes: attacks, then what lies in the room, then the doors, then the ship's
 * own systems. Ten of them get a key; the rest are handed back keyless for the
 * panel to count.
 *
 * `menu` is the one bulkhead whose own methods are showing instead, and `moves`
 * says whether the list under it is the compartment's own or the map of where
 * the drone can walk. Between them they are the whole of the list's state — a
 * boolean and a door id, held by `AppState` and handed back here. A door that
 * has since been opened, or walked away from, is no longer a choice, and the
 * level it was chosen from comes back without anyone having to notice.
 */
export function roomActions(game: RoomGame, menu?: Level, moves = false, cursor = 0): Action[] {
  if (game.status !== "playing") return [];
  // The tug is not a ship you walk about in any more, so neither level above
  // the list exists there: `m` has nowhere to go and the four compartments have
  // no doors worth a line (docs/tasks/G53-tug-is-a-menu.md).
  if (isTug(game)) {
    const verb = typeof menu === "string" ? menu : undefined;
    return keyed((verb !== undefined && tugPicks(game, verb)) || tugActions(game), cursor);
  }
  const list = moves ? travelActions(game) : hereActions(game);
  if (menu === undefined) return keyed(list, cursor);
  // A string level aboard a derelict is a relic's swap: which module it throws
  // out of a full rack. The tug's verbs never reach here (`tugPicks`).
  if (typeof menu === "string") return keyed(swapPicks(game, menu) ?? list, cursor);
  return keyed(doorMethods(game, menu) ?? list, cursor);
}

/**
 * Where the ten numbered rows start, so that the highlighted one is always one
 * of them and always drawn.
 *
 * The eleventh line and everything under it used to be unreachable by anything
 * at all: no digit, no letter, and not the cursor either, because the cursor's
 * own length counted numbered rows only. A sweep of the shipped game found one
 * on 2.6 % of screens, and among them `work ENGINE` — the objective the whole
 * voyage is for — and `go d14`, a door out of the compartment
 * (docs/tasks/G55-playtest-findings.md, 4). The list is now a window over the
 * whole thing, moved by the arrows.
 *
 * The window is late enough to hold the cursor and no later, and the cursor
 * sits at most `EDGE` rows into it — which is what keeps it drawn when the
 * panel has fewer than ten rows to give the list (`ui/panel.ts`, `LIST_FLOOR`
 * guarantees eight).
 */
function windowStart(cursor: number, length: number, limit: number): number {
  if (length <= limit) return 0;
  const last = length - limit;
  return Math.max(0, Math.min(cursor <= EDGE ? 0 : cursor - EDGE, last));
}

/** How far into the ten rows the highlight is allowed to sit before they move. */
const EDGE = 4;

// ---------------------------------------------------------------- the tug

/**
 * The tug's list: five groups named after what they do, in an order that never
 * changes, and one line per verb however many modules that verb could be aimed
 * at (docs/tasks/G53-tug-is-a-menu.md).
 *
 * The owner's words, after two live runs: «на буксире безумно неудобно, ты
 * ходишь криво по собственным отсекам и в них нажимаешь какую-то херню;
 * используй самые обычные меню; это два разных режима игры». And, looking at a
 * HOLD whose whole list was six lines of `sell MODULE (4 CR)`: «на выбор только
 * продавать себя — ты ебнулся?»
 *
 * Three rules answer both, and they are the whole of this block.
 *
 * **The groups are verbs, not compartments.** `DOCK`, `HOLD`, `BENCH`, `HELM`
 * were the inside of a ship talking; nothing about the word BENCH says a module
 * is mended there, and the owner had to walk into all four to find out.
 *
 * **One verb is one line.** A rack of six put six copies of `sell` on a
 * twenty-eight column panel and pushed everything else behind `… 2 more`. The
 * modules go one level down — the machinery a locked bulkhead has used since
 * G46 — where there is room to print the integrity the choice actually turns
 * on.
 *
 * **The ten rows are always the same ten, in the same order.** Not "as many as
 * apply": a line that disappears when it has nothing to do renumbers every line
 * under it, and half of what made the tug unusable was that its numbers moved
 * between two presses. So a verb with nothing to aim at is a greyed row saying
 * why, which is also the only way a player ever learns the hold exists.
 */
interface TugRow {
  /** The group this row opens, printed above it. */
  head?: Key;
  verb: string;
  /**
   * What the row is called when it is not naming one module. Only for the rows
   * that never nest: the rest take the wording of their own folded line, which
   * `systems/voyage.ts` owns along with the price on it.
   */
  label?: Key;
  /** True for a verb aimed at several things, whose own list is one level down. */
  nest?: true;
  /** Why the row is dead when the verb has nothing to be aimed at. */
  empty: Key;
  /**
   * A second verb whose offers are drawn on this row too.
   *
   * One row, two verbs: the dock's shelf (`order`) rides on the hold's row
   * (`fit`), because everything that puts a module on the drone belongs in one
   * place and the panel at home has ten numbered lines and no eleventh.
   */
  also?: string;
}

/**
 * The dock's list, in groups, in the order a visit home is spent.
 *
 * The owner asked for the grouping after playing it flat: "проанализируй,
 * разбей на группы действий — тип смена точки, десант, отсек с дронами,
 * контракты, и в каждом отделе свои вещи". The groups were already here and had
 * been since G53; what he was looking at was the graphic view, which drew the
 * lines and dropped their headings (`ui/web/panel-html.ts`). Both halves are
 * fixed — the headings render, and the voyage is two groups, because moving the
 * tug to the next hull is not signing a charter for the one it is tied to.
 *
 * **Casting off is last.** It led the list until now, and the cost of that is
 * measured rather than argued: `STATION_ORDER` in `systems/voyage.ts` reads the
 * same verbs for the bots and has cast off in the middle of them, over a
 * comment recording what happened when it did not — charters fell 1.81 → 0.41 a
 * voyage, `lastHull` 44 % → 16 %, the itinerary unfunded behind a drone that
 * had already flown. A player reads top to bottom, and the first line they read
 * was the one that ends the visit. It is also the one press that cannot be
 * taken back, and the highlight went home to it every time a group's list fell
 * away (docs/tug-menu-audit.md, defects 2 and 8).
 *
 * **Four headings over ten lines, not six.** Two came off. `DRONE` stood over
 * one row that already says `buy a hull`, and a heading that repeats its only
 * line is a row of the panel spent on nothing. `SELL` joined `RIG`: stowing,
 * fitting and selling are three things done to the same rack, and reading them
 * as one group is how a player finds out that what they take off can also be
 * put back. That is two rows of the panel returned — at home it was exactly
 * full, sixteen of sixteen, and the next line anything added would have pushed
 * the last group off the screen entirely.
 */
const TUG_ROWS: readonly TugRow[] = [
  { verb: "buy", nest: true, empty: "why.hull.none" },
  { head: "tug.group.repair", verb: "repair", nest: true, empty: "why.rig.whole" },
  { verb: "graft", nest: true, empty: "why.rig.grafted" },
  { verb: "clean", label: "action.dead.clean", empty: "why.rig.clean" },
  { head: "tug.group.rig", verb: "stow", nest: true, empty: "why.rig.empty" },
  // One row for every way a module gets onto the drone: the ones already in the
  // hold, and the three the dock has for sale. It is one row and not two
  // because at home the terminal panel is exactly full — ten numbered lines and
  // the headings over them is what fits — and because it is the better answer
  // anyway: the owner could not find the hold at all («не понял, как таскать
  // модули к себе не экипируя»), and a shelf whose front door is the hold
  // explains both at once.
  { verb: "fit", also: "order", nest: true, empty: "why.hold.shelf" },
  { verb: "sell", nest: true, empty: "why.rig.empty" },
  { head: "tug.group.voyage", verb: "charter", nest: true, empty: "why.charter.gone" },
  { head: "tug.group.jump", verb: "jump", label: "action.dead.jump", empty: "why.jump.last" },
  { verb: "undock", label: "action.dead.undock", empty: "why.tug.noDrone" },
];

/**
 * Everything one row of the tug is about: its own verb's offers, and the
 * second verb's behind them if the row carries one.
 *
 * One function because there used to be two, and they disagreed. The row was
 * built from both verbs and the list under it from `row.verb` alone, so the
 * dock's shelf — which rides on the hold's row and has no row of its own —
 * was on no screen in any state of the game. The owner spent four hours
 * looking for it: «магаз модулей где?» (docs/tug-menu-audit.md, defect 4).
 *
 * `own` is handed back beside the whole list because a greyed row has to say
 * why it is grey, and the answer belongs to the verb the row is named after.
 */
function rowTargets(
  game: RoomGame,
  row: TugRow,
): { own: Array<ActionOffer<RoomCommand>>; all: Array<ActionOffer<RoomCommand>> } {
  const own = stationTargets(game, row.verb);
  const also = row.also === undefined ? [] : stationTargets(game, row.also);
  return { own, all: [...own, ...also] };
}

function tugActions(game: RoomGame): Action[] {
  const rows = TUG_ROWS.map((row) => {
    const { own, all } = rowTargets(game, row);
    const line = tugRow(game, row, all, own);
    return row.head === undefined ? line : { ...line, head: t(row.head) };
  });
  // Anything the five groups do not claim still gets a line. Nothing offers one
  // today, but a system added later must not go missing off the one screen it
  // would show on, and a list that silently drops a verb is exactly the defect
  // the "no line was lost in the move" test exists to catch.
  //
  // Except a bulkhead. `systems/doors.ts` offers `close` for every door of the
  // compartment and the tug has three, and shutting one is a decision about
  // something coming through it — nothing is ever aboard the tug
  // (`systems/tug.ts`, `onLevelEnter`), so all a player could wall off is
  // themselves.
  const claimed = new Set(TUG_ROWS.flatMap((r) => (r.also === undefined ? [r.verb] : [r.verb, r.also])));
  const rest = gatedOffers(game)
    .filter((o) => !claimed.has(verbOf(o) ?? "") && !aboutADoor(o))
    .map(fromOffer);
  return [...rows, ...rest];
}

/**
 * One row of the tug: the verb, and what pressing it does about the modules
 * behind it.
 *
 * A group steps down a level, however few things are under it, and `cmd` is
 * still the first thing it would have done — so anything reading this list as
 * plain commands gets what it always got.
 *
 * It used to become that one thing when only one was left, on the argument a
 * bulkhead with one tool makes: stepping into a list to read a single entry is
 * a keystroke spent on nothing. A bulkhead can afford it because its list is
 * about that bulkhead; the tug's ten rows are a menu, and a menu's fourth row
 * meaning "open the repairs" on one screen and "mend the BATTERY, 4 CR" on the
 * next is the defect, not the keystroke. `8` was the worst of them: the list of
 * sales while the rack had two modules in it, and the sale of the last one —
 * for good, with the word "for good" living on the group's label and so absent
 * from the line that did it (docs/tug-menu-audit.md, defect 3).
 *
 * With none at all it is still a row, greyed, saying why. That is the half of
 * the rule that keeps the ten numbers still — and the only way a player ever
 * finds out the hold exists before they have put something in it.
 */
function tugRow(
  game: RoomGame,
  row: TugRow,
  offers: ReadonlyArray<ActionOffer<RoomCommand>>,
  own: ReadonlyArray<ActionOffer<RoomCommand>>,
): Action {
  const label = (row.label === undefined ? pickLabel(row.verb) : t(row.label)) ?? row.verb;
  if (offers.length === 0) {
    const line = raw(label, tugDead(row.verb), false);
    line.why = t(noDrone(game) ? "why.tug.noDrone" : row.empty);
    return line;
  }
  if (row.nest !== true) return fromOffer(offers[0]!);

  const open = offers.find((o) => o.enabled);
  const line: Action = {
    key: "",
    label,
    cmd: (open ?? offers[0]!).cmd,
    // `enabled` keeps its old promise — there is something under this line the
    // drone can spend right now — and a greyed one still steps into its list,
    // because `appReducer` reads `step` before it reads `enabled`. That is the
    // same bargain a locked bulkhead with no tool for it strikes (`doorMenu`):
    // the moment a player most needs to read what a thing would cost is the
    // moment they cannot pay for it.
    enabled: open !== undefined,
    step: row.verb,
  };
  // The sentence under a dead row belongs to the verb the row is named after.
  // It used to be the first offer of the whole list, and on the one row that
  // carries two verbs that was the shelf's: `fit from the hold ▸ (The drone
  // already carries a CUTTER)`, printed over a hold that had never held
  // anything (docs/tug-menu-audit.md, defect 5). With nothing of its own to
  // say, the row says what it is for instead.
  if (open === undefined) line.why = own[0]?.why ?? t(row.empty);
  return line;
}

/**
 * The list one level down: every module this verb could be aimed at, then out.
 *
 * One target is enough to keep it. The threshold used to be two, and it was
 * the right answer to a question this function is not the one being asked:
 * whether stepping *into* a list is worth a keystroke. It is also the answer
 * every caller got, including `tugStands`, which asks after every single
 * action whether the level the player is standing in is still a question.
 *
 * That is the owner's complaint word for word — «нельзя взять все контракты,
 * после 2 из 3 выкинет на основное меню». Signing a charter takes it off the
 * board, the board falls to one, the level is declared dead under the player's
 * hands and the highlight goes home, to the row that casts off. The same thing
 * happened on the fourth of five repairs, the fourth of five sales and the
 * fourth of five stows, none of which he had got round to writing down.
 *
 * Whether a group is worth stepping into is decided where it belongs, on the
 * row itself (`tugRow`).
 */
function tugPicks(game: RoomGame, verb: string): Action[] | undefined {
  const row = TUG_ROWS.find((r) => r.verb === verb);
  if (!row || row.nest !== true) return undefined;
  const offers = rowTargets(game, row).all;
  if (offers.length === 0) return undefined;
  return [...offers.map(fromOffer), backToRoom()];
}

/** Is that verb's own list still standing? The level falls away when it is not. */
export function tugStands(game: RoomGame, verb: string): boolean {
  return isTug(game) && tugPicks(game, verb) !== undefined;
}

/**
 * Which of the ten rows a verb is, so a level that closes lands back on the row
 * it opened from rather than at the top of the list.
 *
 * `-1` for anything the tug has no row for, which is the caller's cue to leave
 * the highlight where it puts it by default.
 */
export function tugRowIndex(verb: string): number {
  return TUG_ROWS.findIndex((r) => r.verb === verb);
}

/** Is this offer about a bulkhead — a way through one, or shutting one? */
function aboutADoor(offer: ActionOffer<RoomCommand>): boolean {
  const verb = verbOf(offer) ?? "";
  return verb === "close" || DOOR_VERBS[verb] !== undefined;
}

/** No drone on the rails: the one reason that outranks every other refusal. */
function noDrone(game: RoomGame): boolean {
  return voyageRecord(game)?.hull === undefined;
}

/**
 * The command on a row that cannot be pressed. Never sent — `picked` reads
 * `enabled` first — and an `act` no system claims all the same, which the
 * engine refuses without spending a turn.
 */
function tugDead(verb: string): RoomCommand {
  return { kind: "act", verb: `no-${verb}` };
}

/**
 * Where the drone can walk: one line per compartment it knows of, nearest
 * first (docs/tasks/G48-travel-to-a-room.md).
 *
 * The owner asked for a destination rather than a direction — «на движение
 * выбирается любая точка и ты идёшь туда, пока не упрёшься во врага или
 * закрытую дверь» — and that is the whole difference between this list and the
 * doors it replaced. A door is a step; a compartment is an intention, and the
 * walk that carries it out stops itself the moment the ship raises a question
 * (`ui/auto.ts`, `makeTraveller`).
 *
 * Three things about the line. It is the *known* ship only: a compartment
 * nobody has seen has no name to pick out of a list, and twelve rows of `····`
 * would take every key the panel has. It says how far in doors, because that
 * is the cost, and what will stop the walk when the way is not clear, because
 * that is the decision. And it is ordered by that distance with the room id
 * breaking ties, so the same compartment keeps the same number for as long as
 * the drone stands still.
 *
 * The neighbouring compartment is the ordinary case of all this rather than a
 * special one: distance 1, and pressing it walks a single door. A neighbour
 * behind something shut is the door's own list of ways through it, one level
 * further down, exactly as it is on the compartment's own list.
 */
function travelActions(game: RoomGame): Action[] {
  const { here, forDoors } = situation(game);
  const rows = known(game, here)
    .map((room) => ({ room, route: travelRoute(game.ship, here, room.id) }))
    .sort((a, b) => reach(a.route) - reach(b.route) || a.room.id - b.room.id)
    .map(({ room, route }) => travelRow(room, route, forDoors));
  return [...rows, backToRoom()];
}

/** Compartments the drone could name: stood in, swept by a pulse, or in sight. */
function known(game: RoomGame, here: RoomId): Room[] {
  return game.ship.rooms.filter(
    (r) => r.id !== here && (r.explored || r.scanned || game.visible.has(r.id)),
  );
}

/** How far, for sorting. No route at all sorts last and keeps its own order. */
function reach(route: readonly Door[] | undefined): number {
  return route === undefined ? Number.POSITIVE_INFINITY : route.length;
}

/**
 * One compartment as a line of that list: `STORAGE   r4  3 doors`, or
 * `STORAGE   r4  d3 locked` when something on the way is shut.
 *
 * What the line *does* follows the route rather than the compartment. A clear
 * road is a walk; a road that is shut at the very first door is that door's own
 * choice of tools, because walking nowhere and then asking is a keystroke spent
 * on nothing; a road shut further along is still a walk, and the walk will stop
 * there and ask. No route at all is a line that cannot be pressed and says so —
 * a compartment the drone cannot reach is information, not noise.
 */
function travelRow(
  room: Room,
  route: Door[] | undefined,
  offers: ReadonlyArray<ActionOffer<RoomCommand>>,
): Action {
  const shut = route?.find((d) => !passableForPlayer(d));
  const right = route === undefined
    ? t("dist.none")
    : shut
      ? `${shut.label} ${doorStateWord(shut.state)}`
      : t("dist.doors", { n: route.length });
  const label = roomLabel(room, right);

  // Every row of this list points at a compartment, whatever it does when it is
  // pressed — including the one that cannot be walked to at all. Where the
  // cursor is aiming is a fact about the row, not about whether it works.
  const at = { leadsTo: room.id };
  if (route === undefined || route[0] === undefined) {
    const line = raw(label, { kind: "act", verb: "back" }, false);
    line.why = t("why.room.noRoute", { room: roomName(room) });
    return { ...line, ...at };
  }
  if (shut === route[0]) {
    return { ...doorRow(shut, waysOf(offers, shut.id), () => label), label, ...at };
  }
  // One open door and nothing beyond it: the step itself, not a walk that would
  // announce its own arrival a tenth of a second later.
  if (route.length === 1) return { ...raw(label, { kind: "go", door: route[0].id }, true), ...at };
  return { ...raw(label, { kind: "go", door: route[0].id }, true), travel: room.id, ...at };
}

/**
 * `STORAGE   r4  3 doors`: what it is called, which box on the schematic, and
 * what the walk costs — or what will end it.
 *
 * Fixed columns for the same reason the door line has them: the player reads
 * down them. The name is what gives way when a language runs long, because the
 * compartment is also named on the schematic and the number is not.
 *
 * It gives way at a word, not at a column. `MAINTENANCE` cut to nine columns is
 * `MAINTENAN`, and a sweep of the shipped game found one of those on 48 % of
 * English screens (docs/tasks/G55-playtest-findings.md, 8): a word cut short
 * reads as a width, but a word cut mid-syllable reads as a typo, and a typo
 * makes the screen look broken rather than tight. `clipName` is the rule the
 * contacts block has used since G47, and there is one of it.
 */
export function roomLabel(room: Room, right: string): string {
  const label = pad(room.label, LABEL_W);
  const width = Math.min(ROOM_W, Math.max(2, ACTION_WIDTH - label.length - right.length));
  return pad(clipName(roomName(room), width - 1), width) + label + right;
}

/** The compartment's own actions, in the doc's order and without their keys. */
function hereActions(game: RoomGame): Action[] {
  const { here, offers, doors, forDoors } = situation(game);

  const shots = offers.filter((o) => verbOf(o) === "shoot");
  const late = offers.filter((o) => LATE_VERBS.has(verbOf(o) ?? ""));
  const swaps = offers.filter((o) => verbOf(o) === "swap");
  const spent = new Set([...shots, ...forDoors, ...late, ...swaps]);

  const out: Action[] = [
    // Attacks come off the entity list rather than off the offers: hitting what
    // is in the room is the engine's own verb, and it stays on the list even if
    // a game one day stops advertising it.
    ...attackRows(machinesIn(game, here)),
    ...shots.map(fromOffer),
    // A relic against a full rack: one line per crate, its slots one level down.
    ...swapRows(game, here, swaps),
    // Anything lying about: wreckage, crates, bodies, a charter's package.
    // `hide` and `wait` are deliberately dropped — they are letters, not
    // numbers, and a list that repeats the letter row is a list nobody reads.
    ...offers.filter((o) => !spent.has(o) && o.cmd.kind === "act").map(fromOffer),
    ...airlockRow(doors),
    ...late.map(fromOffer),
  ];

  return pressableFirst(out);
}

/**
 * What both levels are built out of: where the drone stands, what the systems
 * are offering there, and which of those offers is aimed at a door of this
 * compartment.
 *
 * One function because the two lists must agree about all four. A door the
 * compartment's list calls locked and the map calls open would be two
 * screens describing one ship, and `AppState` steps from one to the other on
 * the strength of a door id being on both.
 */
function situation(game: RoomGame): {
  here: RoomId;
  offers: ReadonlyArray<ActionOffer<RoomCommand>>;
  doors: readonly Door[];
  forDoors: ReadonlyArray<ActionOffer<RoomCommand>>;
} {
  const here = game.roomOf(game.player).id;
  // Every system's list, joined. Only ever asked aboard a derelict: the tug has
  // a list of its own now and never comes through here (`tugActions`).
  const offers = gatedOffers(game);
  const doors = game.ship.doorsOf(here);
  const doorIds = new Set(doors.map((d) => d.id));
  return { here, offers, doors, forDoors: offers.filter((o) => doorOffer(o, doorIds)) };
}

/**
 * The ten keys, handed out down the list.
 *
 * One level down the last of them is spoken for: `0` is the way back, whatever
 * it would otherwise have numbered. Nothing offers nine ways through one door
 * (`systems/doors.ts`, `LOCKED_METHODS` offers four), so no method loses its
 * number to that.
 */
export function keyed(actions: readonly Action[], cursor = 0): Action[] {
  // One level down `0` is spoken for, so the window is nine wide rather than
  // ten — and the window has to know that, or the tenth line of a sub-list is
  // the unreachable one all over again.
  const nested = actions.some((a) => a.step === null);
  const limit = nested ? MAX_ACTIONS - 1 : MAX_ACTIONS;
  const from = windowStart(cursor, actions.filter((a) => a.step !== null).length, limit);
  let at = 0;
  return actions.map((a) => {
    if (a.step === null) return { ...a, key: BACK_KEY };
    const i = at++;
    const on = i - from;
    return on >= 0 && on < limit ? { ...a, key: ACTION_KEYS[on]! } : a;
  });
}

/**
 * Ten keys, and a line nobody can press must never take one from a line that
 * can. Stable, so the order above survives inside each half.
 *
 * The DOCK is what this exists for. The rack sits at the top of the voyage's
 * own list and is three refusals for as long as there is a drone on the rails;
 * without this rule they would take the first three keys and push `undock` —
 * the only thing a new player should press — down to the fourth. Aboard a
 * derelict it changes almost nothing: what is unpressable there is a bulkhead
 * with no tool for it, and those already sort last among the doors.
 */
function pressableFirst(actions: readonly Action[]): Action[] {
  return [...actions.filter((a) => a.enabled), ...actions.filter((a) => !a.enabled)];
}

/** The entries the list could not fit: no key, and the panel says how many. */
export function omittedActions(actions: readonly Action[]): Action[] {
  return actions.filter((a) => a.key === "");
}

/**
 * `leave a1 TUG       out` — the airlock, in the same four columns every line
 * of the list has ever used: what it costs, which door, where it goes, what
 * stands in the way.
 *
 * The only door still worded this way. Every other one is a row of the map now
 * and is worded after the compartment beyond it (`roomLabel`), which is the
 * whole point of the map: a destination reads as a place, not as a hinge.
 */
function airlockLabel(door: Door): string {
  const head = pad(`${verbWord("leave")} ${door.label}`, VERB_W);
  const state = doorStateWord("out");
  const width = Math.min(NAME_W, Math.max(2, ACTION_WIDTH - head.length - state.length));
  return head + pad(clip(t("word.tug"), width - 1), width) + state;
}

// -------------------------------------------------------------------- doors

/**
 * The airlock, and it is the only door left on the compartment's own list.
 *
 * Every other door came off it when walking became a destination
 * (docs/tasks/G48-travel-to-a-room.md): the map `m` opens says where each one
 * leads, how far and what stands in the way, so the same four bulkheads listed
 * twice on a twenty-eight column panel were four rows taken from the salvage,
 * the bodies and the ship's own systems — which have nowhere else to be.
 *
 * The airlock stays because it is not a way about the ship but a way out of it:
 * the map does not carry it, `leave` is not `go`, and the row that says how to
 * go home is the one a lost player looks for (docs/tasks/G40-tug-clarity.md).
 */
function airlockRow(doors: readonly Door[]): Action[] {
  const airlock = doors.find((d) => d.state === "airlock");
  if (!airlock) return [];
  return [raw(airlockLabel(airlock), { kind: "leave" }, true)];
}

/**
 * Every way through every bulkhead of this compartment, in the order the doors
 * themselves are in: what the letters aim at (`ui/appstate.ts`, `aimed`).
 *
 * The letters need a source of their own now that the doors are not lines of
 * the compartment's list any more. This is that source, and it is the same
 * offers the map's rows and the sublist are built from, so `p` at a locked
 * bulkhead is the same turn as picking `power` out of that bulkhead's own list.
 * Doors the drone can already walk through are in it too: welding one shut is a
 * verb with a letter and no line anywhere, and it was reached this way before.
 */
export function waysHere(game: RoomGame): DoorWay[] {
  const { doors, forDoors } = situation(game);
  return [...doors]
    .sort((a, b) => rank(a) - rank(b) || a.id - b.id)
    .flatMap((door) => waysOf(forDoors, door.id));
}

/**
 * What a shut bulkhead does, on whichever line names it: its own list of ways
 * when there is more than one, that one way when there is one, and the sim's
 * own refusal when there is none.
 *
 * `name` is how the caller words it, and it is a function of the verb because
 * the verb is not known until the ways are counted. The map words its rows
 * after the compartment beyond the door and ignores it; nothing else calls
 * this, which is what is left of the door block.
 */
function doorRow(door: Door, ways: readonly DoorWay[], name: (verb: string) => string): Action {
  if (ways.length > 1) return doorMenu(door, name("open"), ways);

  const opener = ways.find((w) => w.enabled);
  if (!opener) {
    // Mirrors the refusal in rooms/actions.ts, `doGo`. A test presses the door
    // and compares the two, so the wording cannot drift apart.
    const line = raw(name("go"), { kind: "go", door: door.id }, false);
    line.why = t("why.door.state", { door: door.label, state: doorStateWord(door.state) });
    return ways.length === 0 ? line : { ...line, ways };
  }
  return { key: "", label: name(opener.verb), cmd: opener.cmd, enabled: true, ways };
}

/**
 * A bulkhead with more than one answer, as one line of the map.
 *
 * `enabled` is still the old promise — there is a way through this door the
 * drone can spend right now — and `cmd` is still that way, so anything that
 * reads the list as commands and knows nothing about levels (a harness walking
 * a run off it) gets exactly what it used to. What changed is that pressing the
 * line goes down a level instead, which is why the greyed one is pressable too:
 * a lock the drone has no tool for is precisely when a player needs to read the
 * four methods and what each would have cost.
 */
export function doorMenu(door: Door, label: string, ways: readonly DoorWay[]): Action {
  const opener = ways.find((w) => w.enabled);
  return {
    key: "",
    label,
    cmd: (opener ?? ways[0]!).cmd,
    enabled: opener !== undefined,
    ways,
    step: door.id,
  };
}

/**
 * The list one level down: every way through this bulkhead with its price, and
 * the line back out.
 *
 * Nothing is hidden here and nothing is reordered. The methods stand in the
 * order the systems offer them — cheapest first, the card last
 * (`systems/doors.ts`, `LOCKED_METHODS`) — so the digit for the cell is the
 * same digit at every lock of the run, and one the drone cannot spend is greyed
 * with the reason on it rather than dropped: "what opens a lock" is something
 * this game teaches by showing it next to the door that needs it.
 */
function doorMethods(game: RoomGame, id: DoorId): Action[] | undefined {
  const { doors, forDoors } = situation(game);
  const door = doors.find((d) => d.id === id);
  if (!door || door.state === "airlock") return undefined;
  if (game.ship.passable(door, { isPlayer: true })) {
    // A door the drone could simply walk through is a question only when the
    // drone has been told what is on the other side of it (`ui/auto.ts`,
    // `dangerAhead`): then the list is the step in, worded as the plain `go`
    // it is, and whatever lifts the hazard — which is how a walk that stopped
    // a door short hands the decision over (docs/tasks/G71-hazard-framework.md).
    if (dangerAhead(game, door) === undefined) return undefined;
    const through: DoorWay = { verb: "go", letter: "", cmd: { kind: "go", door: door.id }, enabled: true };
    return [methodAction(through), ...waysOf(forDoors, id).map(methodAction), backAction(door)];
  }
  const ways = waysOf(forDoors, id);
  if (ways.length === 0) return undefined;
  return [...ways.map(methodAction), backAction(door)];
}

/** Is that bulkhead still one of this compartment's, and still a question? */
export function doorStands(game: RoomGame, id: DoorId): boolean {
  return doorMethods(game, id) !== undefined;
}

// ------------------------------------------------------------------- relics

/** The level a relic's swap opens: `swap:<wreck id>`, one per crate. */
const SWAP_LEVEL = "swap:";

export function swapLevel(wreck: number): string {
  return `${SWAP_LEVEL}${wreck}`;
}

function swapWreck(level: string): number | undefined {
  if (!level.startsWith(SWAP_LEVEL)) return undefined;
  const id = Number(level.slice(SWAP_LEVEL.length));
  return Number.isInteger(id) ? id : undefined;
}

/**
 * A relic against a full rack, folded: one line per crate, and the module it
 * throws out chosen one level down (`twist/rig.ts`, `swapSlots`).
 *
 * The rig offers one `swap` per slot, which is six lines on a list of ten
 * digits — a list with no room left for the door. Folded, the line keeps the
 * old promise: `cmd` is the first swap, the slot of the module the relic
 * upgrades, so a harness reading commands presses what it always pressed. With
 * exactly one module to throw out there is no choice to step into and the line
 * is that swap — the rule a bulkhead with one tool follows (`doorRow`).
 */
function swapRows(game: RoomGame, here: RoomId, swaps: ReadonlyArray<ActionOffer<RoomCommand>>): Action[] {
  const byCrate = new Map<number, Array<ActionOffer<RoomCommand>>>();
  for (const o of swaps) {
    const id = o.cmd.kind === "act" ? o.cmd.target : undefined;
    if (id === undefined) continue;
    const list = byCrate.get(id) ?? [];
    list.push(o);
    byCrate.set(id, list);
  }
  const out: Action[] = [];
  for (const [id, group] of byCrate) {
    if (group.length === 1) {
      out.push(fromOffer(group[0]!));
      continue;
    }
    const wreck = wreckAt(game, here, id);
    const first = group[0]!;
    out.push({
      key: "",
      label: wreck ? t("action.swapMenu", { module: moduleName(wreck.kind) }) : first.label,
      cmd: first.cmd,
      enabled: group.some((o) => o.enabled),
      step: swapLevel(id),
    });
  }
  return out;
}

/** The list one level down: every slot the relic could take, and the way back. */
function swapPicks(game: RoomGame, level: string): Action[] | undefined {
  const id = swapWreck(level);
  if (id === undefined) return undefined;
  const group = gatedOffers(game).filter(
    (o) => o.cmd.kind === "act" && o.cmd.verb === "swap" && o.cmd.target === id,
  );
  if (group.length < 2) return undefined;
  return [...group.map(fromOffer), backToRoom()];
}

/** Is that crate still here, and still a choice? The level falls away when not. */
export function swapStands(game: RoomGame, level: string): boolean {
  return !isTug(game) && swapPicks(game, level) !== undefined;
}

export function methodAction(way: DoorWay): Action {
  const out = raw(methodLabel(way.verb), way.cmd, way.enabled);
  if (way.why !== undefined) out.why = way.why;
  return out;
}

/**
 * `spike   2 turns, noise 4`: the method, then what spending it costs.
 *
 * Turns and noise, and no third field: what the CELL takes out of its own
 * integrity and the fact that a card does not come back are true, and there is
 * no language of the three that fits them into twenty-five columns beside the
 * rest. Both are already on the screen — the rack draws the CELL's bar, the
 * panel counts the keycards — and the two numbers here are the ones the choice
 * actually turns on.
 */
function methodLabel(verb: string): string {
  const cost = tId("cost", verb, "");
  return cost === "" ? verbWord(verb) : pad(verbWord(verb), METHOD_W) + cost;
}

/**
 * The way out of the map, back to everything else this compartment can do. No
 * door is named on it because none is chosen yet — that is the whole difference
 * between this line and `backAction`, which sits one level further down and has
 * a bulkhead to name.
 */
export function backToRoom(): Action {
  return {
    key: "",
    label: t("action.backRoom"),
    // Never sent: `appReducer` reads `step` before it reads `cmd`. It is still
    // an `act` no system claims, which the engine refuses for no turn, so the
    // one line that must never cost anything cannot.
    cmd: { kind: "act", verb: "back" },
    enabled: true,
    step: null,
  };
}

export function backAction(door: Door): Action {
  return {
    key: "",
    // The bulkhead is named here and nowhere else on this list: one level down
    // there is no heading to say which door these four belong to.
    label: t("action.back", { door: door.label }),
    // Never sent — `appReducer` reads `step` first. It is an `act` no system
    // claims all the same, which the engine refuses for no turn, so the one
    // line of the list that must never cost anything cannot.
    cmd: { kind: "act", verb: "back" },
    enabled: true,
    step: null,
  };
}

/**
 * The tools that would open this door, as commands for the reducer and as the
 * letters that fire them from the compartment's own list.
 */
function waysOf(offers: ReadonlyArray<ActionOffer<RoomCommand>>, door: DoorId): DoorWay[] {
  return offers
    .filter((o) => o.cmd.kind === "act" && o.cmd.target === door)
    .map((o) => {
      const way: DoorWay = {
        verb: verbOf(o) ?? "",
        letter: DOOR_VERBS[verbOf(o) ?? ""] ?? "",
        cmd: o.cmd,
        enabled: o.enabled,
      };
      if (o.why !== undefined) way.why = o.why;
      return way;
    });
}

function rank(door: Door): number {
  return DOOR_RANK[door.state] ?? 1;
}

// -------------------------------------------------------------------- pieces

/** Columns for `go d4`, and for the compartment it leads to. */
const VERB_W = 7;
const NAME_W = 10;

/** Columns on the travel list: the compartment's name, then its `rN`. */
const ROOM_W = 10;
const LABEL_W = 4;

/** Columns for the method's own word, one level down. The price follows it. */
const METHOD_W = 8;

/**
 * One line per machine standing here, and no two of them alike.
 *
 * Two scouts in one compartment used to be `1 attack scout` and `2 attack
 * scout`, aimed at different entities and reading as the same line — 4.4 % of
 * screens in a sweep of the shipped game
 * (docs/tasks/G55-playtest-findings.md, 11). What tells them apart is what the
 * choice is about: the one on three hit points is the one to finish. Where even
 * that matches, the line takes a tag, because two identical lines that do
 * different things is the one thing a numbered list may never be.
 */
function attackRows(machines: readonly Entity[]): Action[] {
  const rows = machines.map((m) =>
    raw(
      t("action.attack", { target: machineName(m.name), hp: m.hp, max: m.hpMax }),
      { kind: "attack", target: m.id },
      true,
    ),
  );
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const n = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, n);
    const twins = rows.filter((r) => r.label === row.label).length;
    return twins > 1 ? { ...row, label: `${row.label} #${n}` } : row;
  });
}

function machinesIn(game: RoomGame, room: RoomId): Entity[] {
  return game.entities.filter(
    (e) => e.room === room && e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e),
  );
}

function fromOffer(offer: ActionOffer<RoomCommand>): Action {
  const action = raw(offer.label, offer.cmd, offer.enabled);
  if (offer.why !== undefined) action.why = offer.why;
  return action;
}

function raw(label: string, cmd: RoomCommand, enabled: boolean): Action {
  return { key: "", label, cmd, enabled };
}

function verbOf(offer: ActionOffer<RoomCommand>): string | undefined {
  return offer.cmd.kind === "act" ? offer.cmd.verb : undefined;
}

function doorOffer(offer: ActionOffer<RoomCommand>, doors: ReadonlySet<number>): boolean {
  const verb = verbOf(offer);
  if (verb === undefined || DOOR_VERBS[verb] === undefined) return false;
  const target = offer.cmd.kind === "act" ? offer.cmd.target : undefined;
  return target !== undefined && doors.has(target);
}

/** Pads to a column, and always leaves at least the one space between fields. */
export function pad(text: string, width: number): string {
  return text.length < width ? text.padEnd(width) : `${text} `;
}

/**
 * A name cut to a width, at a word if there is one to cut at.
 *
 * `sentry turret` in twelve columns is `sentry`, not `sentry turre`. The
 * difference is what the cut is read as: a word cut short reads as a width — the
 * action list has said `cut d6 КОРИДО sealed` since G39 and nobody has ever
 * misread it — but a cut that leaves a whole word and half of the next one reads
 * as a typo, and a typo makes the panel look wrong rather than tight.
 *
 * A single word too long for the column is still cut through, because there is
 * nothing else to do with it: `hauler` in three columns has to be `hau`.
 */
export function clipName(name: string, width: number): string {
  if (name.length <= width) return name;
  const word = name.lastIndexOf(" ", width);
  return word > 0 ? name.slice(0, word) : clip(name, width);
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(0, width));
}
