import type { Door, Entity, RoomGame, RoomId } from "@jamrog/engine";
import { MODULES, moduleName, type ModuleId } from "../content/modules.js";
import { salvageTarget, type Charter } from "../content/charters.js";
import { derelictNameOf, flavourCallsign } from "../content/derelicts.js";
import { machineName } from "../content/monsters.js";
import {
  OBJECTIVE_COUNT,
  OBJECTIVES,
  SYSTEM_GLYPH,
  objectiveName,
  toolName,
  type ObjectiveSpec,
} from "../content/objectives.js";
import { isTug } from "../content/tug.js";
import { roomName, zoneName } from "../content/zones.js";
import { t, tId } from "../i18n.js";
import { codexUnread } from "../systems/codex.js";
import { keysHeld } from "../systems/doors.js";
import { dangerWord } from "../systems/contacts.js";
import { roomList, type ShipSystem } from "../systems/populate.js";
import { objectiveHere, systemsAboard } from "../systems/ship.js";
import { shipState } from "../systems/shipstate.js";
import { virusOf } from "../systems/virus.js";
import { charterDone, derelictAboard, voyageRecord, type DerelictState } from "../systems/voyage.js";
import { doorStateWord } from "../content/words.js";
import { hostilesIn, rigOf } from "../twist/rig.js";
import { clipName, omittedActions, UNKNOWN_ROOM, type Action } from "./actions.js";
import { blowsLastTurn, strikersNear } from "./strikers.js";
import { debugBlock } from "./debug.js";
import { thingsIn, tag } from "./schematic-input.js";
import { LAYOUT, THEME } from "./theme.js";

/**
 * The panel down the right-hand side, as arithmetic.
 *
 * Two jobs, and they are separate on purpose. The systems hand over their own
 * lines already worded and mostly coloured (`panelLines` in twist/rig.ts and in
 * every system that owns a number); `panelBlocks` puts those between the blocks
 * the screen owns — the heading, this compartment, and the numbered list — and
 * `trackFlash` adds the one thing no system can know, which line took a blow on
 * the frame being drawn. That is a difference between two turns rather than a
 * property of either, so it lives here as a value and `render.ts` keeps one.
 *
 * Every line is clipped to `PANEL_WIDTH`: rot.js wraps, and a wrapped line runs
 * off the bottom of the panel and takes the action list with it.
 */

/** Columns the panel text may use: its width minus the gutter column. */
export const PANEL_WIDTH = LAYOUT.sidebarWidth - 1;

/**
 * Rows the panel has. The renderer draws exactly this many and drops the rest
 * on the floor (`ui/render.ts`), which is how the row saying `? help` went
 * missing on the owner's first playtest: it was line thirty-six of thirty-four.
 */
export const PANEL_HEIGHT = LAYOUT.mapHeight;

/** Content lines one compartment gets before the rest are counted instead. */
export const ROOM_LINES = 4;

/**
 * Door lines one compartment gets. Four, because `deg(room) ≤ 4` is a generator
 * invariant, so a compartment never has a fifth to leave out.
 */
export const DOOR_LINES = 4;

/**
 * Machines the contacts block names before it counts the rest instead.
 *
 * Six is more than a ship ever has in sight at once — eight is the whole hull's
 * budget (`MAX_MACHINES`) and they are spread over a dozen compartments — so in
 * practice nothing is ever dropped. It is a ceiling for the pathological frame
 * (a pack of crawlers plus a ghost plus the rival in one room), because the one
 * thing this block may not do is push the action list off the panel.
 */
export const CONTACT_LINES = 6;

/**
 * Numbered lines the list is guaranteed, before anything else on the panel is
 * allowed to keep a row it wanted.
 *
 * Eight, because that is a fight: two machines to hit, the salvage under them
 * and the three doors out — and the door was the line the owner went looking
 * for and could not find (docs/tasks/G40-tug-clarity.md, 7).
 */
const LIST_FLOOR = 8;

/**
 * Rows the mission block may use before it starts giving them back, and the
 * two it never gives up: the goal, and whatever can be done about it here.
 */
export const MISSION_LINES = 6;
const MISSION_FLOOR = 2;

/** A line as a system hands it over: worded, and coloured where it cared. */
export interface PanelLine {
  text: string;
  /** Set only where the system's own colour beats the panel's default. */
  fg?: string;
  /**
   * The machine this line is about, on the contact lines and nowhere else.
   *
   * Only the appearance pulse reads it (`ui/pulse.ts`): a machine that has just
   * come into sight is flashed on the schematic and on its own line at once,
   * and matching the two by entity id is the only way to be sure they are the
   * same machine — the text carries a name that three languages spell three
   * ways and a glyph that a pack of crawlers shares.
   */
  id?: number;
}

/** What the panel remembers between frames. */
export interface Flash {
  /** Integrity per slot as of the last turn drawn. */
  readonly integrity: readonly number[];
  /** Slots that lost integrity on `turn`. */
  readonly slots: ReadonlySet<number>;
  /** The turn the flash belongs to; it clears when the clock moves past it. */
  readonly turn: number;
}

/** Before the first frame: nothing is known, so nothing flashes. */
export const NO_FLASH: Flash = { integrity: [], slots: new Set(), turn: -1 };

/** No machine is flashing, which is the answer on all but a handful of frames. */
const NOBODY: ReadonlySet<number> = new Set();

/**
 * The whole panel, top to bottom: heading, whatever the systems are showing,
 * this compartment, and the numbered list. Blank lines between blocks are part
 * of the layout — the design doc's mock-up is a specification, and reading a
 * rack of six modules against a list of ten actions needs the air.
 */
export function panelBlocks(
  game: RoomGame,
  actions: readonly Action[],
  cursor = -1,
): PanelLine[] {
  const foot = footBlocks(game, actions.some((a) => a.step === null));
  // Rows the list is owed: what it is guaranteed, or what it actually has to
  // draw when that is less. Measured rather than assumed, because the blocks
  // above it pay for the difference — a compartment with four things to do in
  // it used to hand eight rows to a list that wanted five and print `… 3 more
  // doors` under a panel with three blank rows on it.
  //
  // At home the list is owed all of itself. Its ten rows are the same ten in
  // the same order on every visit and cast off and the jump are the last two,
  // so eight guaranteed rows hid exactly those two under `… 2 more` on 34 % of
  // screens at home (docs/tasks/G88-polish-by-map.md, B7). And the count under
  // it too, when a verb no group claims makes an eleventh line.
  const need = isTug(game)
    ? listHeight(actions) + (omittedActions(actions).length > 0 ? 1 : 0)
    : Math.min(LIST_FLOOR, listHeight(actions));
  const fits = (rows: readonly PanelLine[]): boolean =>
    PANEL_HEIGHT - rows.length - foot.length >= need;
  // The compartment's own content is what gives way when the panel is short of
  // rows: every line of it is a line of the action list said differently
  // (`roomBlock`), so trimming it costs nothing and keeps the list — which is
  // the interface — from being cut down to two entries and a count.
  let head = headBlocks(game, ROOM_LINES, CONTACT_LINES, DOOR_LINES, MISSION_LINES);
  for (let allow = ROOM_LINES - 1; allow >= 0; allow--) {
    if (fits(head)) break;
    head = headBlocks(game, allow, CONTACT_LINES, DOOR_LINES, MISSION_LINES);
  }
  // Then the doors, down to one and a count. They pay after the contents and
  // before the contacts: where a door leads is what the compartment block is
  // now for (docs/tasks/G49-schematic-honesty.md), but it is still something
  // the numbered list says again in its own words, and a machine in the room
  // with you is not.
  for (let allow = DOOR_LINES - 1; allow >= 1; allow--) {
    if (fits(head)) break;
    head = headBlocks(game, 0, CONTACT_LINES, allow, MISSION_LINES);
  }
  // Then the charters and the three marks, down to the goal and the system
  // standing in this compartment. They pay after the compartment and its doors
  // — both of those are the numbered list said a second way — and before the
  // contacts, which are neither said twice nor about next week.
  //
  // Before either of them, though, the air between the blocks. The three marks
  // take two rows since they are full words, and a blank row outranking them
  // hid the goal's addresses on more screens than the no-tool line ever did
  // (docs/tasks/G88-polish-by-map.md, B4 and B5).
  const airless = (rows: readonly PanelLine[]): boolean =>
    fits(squeezeAir(rows, PANEL_HEIGHT - foot.length - need));
  for (let allow = MISSION_LINES - 1; allow >= MISSION_FLOOR; allow--) {
    if (airless(head)) break;
    head = headBlocks(game, 0, CONTACT_LINES, 1, allow);
  }
  // Only then the contacts, and only the ones a door away: this is the block
  // that got moved to the top precisely because it must not be missable, so it
  // pays after everything else already has, and a machine standing in the
  // compartment is never what it pays with. Hiding one of those behind a count
  // is the whole defect the block exists to answer.
  const floor = Math.max(1, Math.min(contactsHere(game), CONTACT_LINES));
  for (let allow = CONTACT_LINES - 1; allow >= floor; allow--) {
    if (airless(head)) break;
    head = headBlocks(game, 0, allow, 1, MISSION_FLOOR);
  }
  // The air between the blocks, taken once the list's own repetitions have
  // gone and before the goal or a contact would. A blank row belongs to the layout and a numbered
  // line belongs to the interface, and until this the layout won — on 3.4 % of
  // turns aboard (1 657 of 48 691, and 1 395 of those with a machine in the
  // compartment) the panel drew `ACTIONS`, then a count, and not one line of
  // the list. What it hid on seed 4 was `close d7`: the door the enforcer was
  // shooting through (G85, 0).
  head = squeezeAir(head, PANEL_HEIGHT - foot.length - need);
  // At home, then the charters the tug has signed, a row each: every one of
  // them is said again aboard, under the goal, and here they stood between
  // the list and its last two rows, the two that leave (B7).
  if (isTug(game)) head = squeezeAir(head, PANEL_HEIGHT - foot.length - need, (l) => /^[✓·] /.test(l.text));

  const { rows, omitted } = fitList(actions, PANEL_HEIGHT - head.length - foot.length, cursor);
  const out = [...head, ...rows];
  if (omitted > 0 && out.length < PANEL_HEIGHT - foot.length) {
    // The arrows are named only where they lead somewhere. They slide the ten
    // digits along a longer list (`ui/actions.ts`, `windowStart`), so they
    // reach a line that never got a key — and move nothing at all on a list
    // that has a digit on every line and simply ran out of rows. Every one of
    // the 5 236 turns in 200 careful voyages that still ends in a count is
    // that second kind, and the line used to promise the keys anyway.
    const reachable = omittedActions(actions).length > 0;
    const said = t(reachable ? "panel.more.arrows" : "panel.more", { n: Math.min(omitted, 99) });
    out.push({ text: clip(said), fg: THEME.fgDim });
  }
  // The keys go on the panel's last rows, always — the owner's words are
  // "подсказки по хоткеям всегда снизу справа" (docs/tasks/G48-travel-to-a-room.md).
  // Before this they simply followed the list, so in a quiet compartment they
  // sat halfway up the sidebar and moved every time the list grew or shrank; a
  // row that moves is a row a player has to find again. Blank rows are cheap
  // and a fixed corner is not.
  while (out.length < PANEL_HEIGHT - foot.length) out.push({ text: "" });
  out.push(...foot);
  // A screen whose systems have grown taller than the panel still has to end
  // on the row that says `? help`: it is the one line a lost player is looking
  // for, and losing it is how this whole task started.
  if (out.length <= PANEL_HEIGHT) return out;
  return [...out.slice(0, PANEL_HEIGHT - foot.length), ...foot];
}

/**
 * Everything above the numbered list: the heading, the contacts, the systems,
 * this compartment.
 */
function headBlocks(
  game: RoomGame,
  allow: number,
  contacts: number,
  doors: number,
  mission: number,
): PanelLine[] {
  const out: PanelLine[] = [];
  const push = (text: string, fg?: string): void => {
    out.push(fg === undefined ? { text: clip(text) } : { text: clip(text), fg });
  };

  push(heading(game), THEME.accent);
  push(t("panel.turn", { n: game.schedule.time }), THEME.fgDim);

  // Contacts before the rack, and a rule across the panel over them.
  //
  // In G40 this block sat between the counters and the compartment, headed by
  // the word `CONTACTS` in the accent colour, and it was missable: the owner's
  // third playtest walked into a compartment with a machine in it and took
  // hits without working out where they were coming from ("меня бьют, я
  // игнорю"). Two rows below the fold of a player's attention is nowhere, and
  // amber on a panel where the exposed module, the compartment name and every
  // other heading are also amber is not a signal.
  //
  // So: the second thing on the panel, under the turn counter, with a red rule
  // that changes the shape of the whole sidebar the moment something is aboard
  // with you. Everything below it shifts down by the height of the block, which
  // is the point — peripheral vision reads the change, not the words.
  const seen = contactsBlock(game, contacts);
  if (seen.length > 0) {
    out.push({ text: "" });
    out.push(...seen);
  }

  // What the sortie is *for*, immediately under it and above everything the
  // counters say. Same reasoning as the contacts block one paragraph up: a
  // player reads the top of the panel, and the run's own goal spent the whole
  // of G17 at the bottom of it as four abbreviations
  // (docs/owner-queue.md, 4 and 5).
  const goal = missionBlock(game, mission);
  if (goal.length > 0) {
    out.push({ text: "" });
    out.push(...goal);
  }

  // Credits, keys, the alert and the charters are numbers other systems own,
  // and they arrive the same way the rack does: through `panelLines`. Nothing
  // here invents a counter, which is why a system can be merged without this
  // file changing at all.
  // The one line this file adds to somebody else's: `5 CELL ▮▮ !`. The rack is
  // the twist's to word and the virus is another system's to own, and neither
  // may reach into the other — but the row a player reads is one row
  // (design-doc.md, "Вирус").
  const sick = virusOf(game.player)?.slot;
  // Air between the blocks that need it and none between the blocks that do
  // not. `KEYS 0`, `ALERT ▯▯▯▯▯`, `RIVAL ▯▯▯` and `CREDITS 25` are one line
  // each and read perfectly well as a stack of counters; giving each of them a
  // blank line of its own spent five rows on nothing, and rows are what the
  // action list ran out of once CONTACTS arrived (G40, 7).
  let paragraph = true;
  for (const sys of game.systems) {
    const lines = sys.panelLines?.(game) ?? [];
    if (lines.length === 0) continue;
    if (lines.length > 1 || paragraph) out.push({ text: "" });
    paragraph = lines.length > 1;
    for (const line of lines) {
      const infected = sick !== undefined && slotNumberOf(line.text) === sick;
      const text = clip(infected ? `${line.text} !` : line.text);
      if (infected) out.push({ text, fg: THEME.bad });
      else out.push(line.fg === undefined ? { text } : { text, fg: line.fg });
    }
  }

  // The compartment, and a blank row above it only when there is one. At home
  // there is not: the tug has no compartment a player ever meets (`roomBlock`).
  const room = roomBlock(game, allow, doors);
  if (room.length > 0) {
    out.push({ text: "" });
    for (const line of room) push(line.text, line.fg);
  }

  out.push({ text: "" });
  push(t("panel.actions"), THEME.accent);
  return out;
}

// -------------------------------------------------------------- the mission

/**
 * What this sortie is for: the hull's price, the three systems and how far they
 * are, what can be done about the one in this compartment, and the charters
 * signed for it.
 *
 * The block the owner's fifth playtest asked for by not asking for it: he flew
 * two derelicts end to end and said "я изучил два корабля, но так и не ясно,
 * как их обезвредить/продать целиком" (docs/owner-queue.md, 4 and 5). Everything
 * needed was on the screen and none of it was legible — the goal was a row of
 * abbreviations after the counters (`SHIP  engine · core · term ·`), the price
 * was never printed at all, the line that raises a system only appeared in the
 * one compartment and sorted last when the drone had no tool for it, and a
 * charter said what it wanted once, in a log line that scrolled away.
 *
 * On the tug it is one line: what the hull tied up outside is worth. The rest
 * of what the tug knows about it — class, alert, systems up, what has been
 * signed for it — is the tug's own to state (`systems/voyage.ts`, `panelLines`),
 * and two blocks saying it twice on one screen is how G54's confusion started.
 * The price is the one thing neither of them was saying.
 */
export function missionBlock(game: RoomGame, allow = MISSION_LINES): PanelLine[] {
  const goal: PanelLine[] = goalLines(game);
  // At home, one line: what the hull outside is worth. Nothing at all once it
  // is taken — the tug's own lines say `under tow` in the same breath as the
  // hull's name (`systems/voyage.ts`), and a second row saying it again is the
  // kind of doubling G54 is about.
  if (isTug(game)) return dockedDerelict(game)?.sold === true ? [] : goal.slice(0, 1);
  const aboard = systemsAboard(game);
  if (aboard.length === 0) return [];
  // The three marks answer "how far along am I" and nothing else, so once they
  // are all ✓ they are a row of the panel spent on a question nobody is asking
  // any more. The two lines above them say what to do instead.
  // All three up, and nothing else: the goal saying "nothing aboard raises it"
  // is two lines too, and it is exactly when the marks are still being read
  // (docs/tasks/G88-polish-by-map.md, B4).
  const systems: PanelLine[] = shipState(game).online.length >= OBJECTIVE_COUNT
    ? []
    : systemsLines(game, aboard.map((s) => s.kind)).map((text) => ({ text: clip(text) }));

  // The system in this compartment, whether or not the rack can pay for it.
  const found = objectiveHere(game);
  const here: PanelLine[] = [];
  if (found) {
    const text = t("panel.goal.work", {
      mark: SYSTEM_GLYPH,
      system: objectiveName(found.spec),
      tool: toolName(found.job.tool),
      left: found.left,
    });
    here.push({ text: clip(text), fg: found.doable ? THEME.fg : THEME.fgDim });
  }

  // What gives way, in order: the charters, which are the strategy and not this
  // turn; then the three marks, whose state the goal line still implies; never
  // the goal itself, and never the system standing in this compartment, because
  // that one is the only thing here that can be acted on right now.
  const rows = [...goal, ...systems, ...here, ...charterBlock(game)];
  if (rows.length <= allow) return rows;
  const short = [...goal, ...systems, ...here];
  if (short.length <= allow) return short;
  const floor = [...goal, ...(here.length > 0 ? here : systems)];
  return floor.length <= allow ? floor : goal.slice(0, Math.max(allow, MISSION_FLOOR));
}

/**
 * The goal, in whichever of its three states this hull is in.
 *
 * The third one is why this block was reopened. The owner raised all three
 * systems of a freighter, looked at `СИСТ. прив ✓ ядро ✓ терм ✓` and wrote «всё
 * ещё не ясно, как оживить грузовик»: he had *finished*, and the panel was
 * still showing him a checklist. A checklist that has filled up says nothing
 * about what to do next — so when the third system comes up the block stops
 * being one and becomes an instruction with the key on it, and once the hull is
 * under tow it says that instead.
 */
function goalLines(game: RoomGame): PanelLine[] {
  const state = derelictAboard(game) ?? dockedDerelict(game);
  const price = state?.spec.salePrice ?? 0;
  // Aboard, which systems are up is the ship's own record and not the voyage's:
  // the voyage copies them when the drone leaves (`systems/voyage.ts`,
  // `returnToTug`), so reading its copy would say nothing on the very turn the
  // third one comes up — the turn this line exists for.
  const up = isTug(game) ? (state?.online.length ?? 0) : shipState(game).online.length;
  if (state?.sold === true) return [{ text: clip(t("panel.goal.towed")), fg: THEME.good }];
  if (state !== undefined && up >= OBJECTIVE_COUNT) {
    return [
      { text: clip(t("panel.goal.done", { cr: price })), fg: THEME.good },
      { text: clip(t("panel.goal.out")), fg: THEME.good },
    ];
  }
  // Nothing in the rack raises anything still standing: the run's goal has
  // stopped being a goal, and the block says so instead of repeating a price.
  //
  // A sweep of the shipped game found the drone in this state on 24 % of turns
  // aboard, in stretches of a median 25 turns and a worst of 483, and no line
  // of the screen said a word about it (docs/tasks/G87-playability.md, 2). The
  // way out is the second line, because "leave and come back with a tool" is
  // the whole of what is left to do. Which tool, for which system, is a row
  // each under it — `TERMINAL: SPIKE/keycard` — because the greyed row that
  // said so stood only in that system's own compartment
  // (docs/tasks/G88-polish-by-map.md, B4). Those rows are what to come back
  // with, and `<` is on the row of letters at the foot, so the `< out` line
  // this block used to end on gives its row to the three marks instead: with
  // all three systems stuck, the block is exactly the six rows it may use.
  const stuck = isTug(game) ? [] : unraisable(game);
  if (stuck.length > 0) {
    return [
      { text: clip(t("panel.goal.noTool")), fg: THEME.bad },
      ...stuck.map((o) => ({ text: clip(`${objectiveName(o)}: ${o.jobs.map((j) => toolName(j.tool)).join("/")}`) })),
    ];
  }
  const text = price > 0 ? t("panel.goal", { cr: price }) : t("panel.goal.bare");
  return [{ text: clip(text), fg: THEME.accent }];
}

/**
 * The systems still standing aboard when every one of them is beyond what the
 * drone is carrying, and none when any of them is not.
 *
 * The rack's own question, asked of the systems rather than of the rack: a
 * spec's `needs` is what decides it (`content/objectives.ts`), so a module
 * added to the game is answered here without a word being written.
 */
function unraisable(game: RoomGame): ObjectiveSpec[] {
  const online = shipState(game).online;
  const left = OBJECTIVES.filter(
    (o) => !online.includes(o.id) && systemsAboard(game).some((s) => s.kind === o.id),
  );
  const rig = rigOf(game.player);
  const keys = keysHeld(game.player);
  return left.every((o) => o.needs(rig, keys) === undefined) ? left : [];
}

/** The hull the tug is tied to, without writing a voyage on a run that has none. */
function dockedDerelict(game: RoomGame): DerelictState | undefined {
  const voyage = voyageRecord(game);
  return voyage?.state[voyage.current];
}

/**
 * `✓ENGINE ·CORE ·TERMINAL r7`: the three of them, which are up, and where the
 * ones that are not are standing.
 *
 * The room is the half the owner was missing. Every system is drawn with the
 * same `+` in its box (`SYSTEM_GLYPH`), so a hull with all three found still
 * showed three identical marks and no way to tell which was which — "как понять
 * где терминал?", asked with the whole ship swept and two systems already up.
 * A compartment id costs three columns and answers it outright.
 *
 * Only for a compartment the drone has actually been in or swept: naming the
 * room of a system nobody has found yet would hand over the map.
 *
 * Full names always, over two rows when one will not hold them. The
 * four-letter forms the row fell back to are exactly what the owner could not
 * read: `?прив ·реак r16` is not a word, a state or an instruction.
 *
 * A system nobody has found is said in words, `not found: TERMINAL`. `?` was
 * the third mark G87 added so that "not found" stopped reading as "found, and
 * not telling you where" — and on 56.5 % of screens it was still a glyph a
 * player had to be told the meaning of (docs/tasks/G88-polish-by-map.md, B5).
 */
function systemsLines(game: RoomGame, kinds: readonly string[]): string[] {
  const online = shipState(game).online;
  const where = systemRooms(game);
  const specs = OBJECTIVES.filter((o) => kinds.includes(o.id));
  const lost = specs.filter((o) => !online.includes(o.id) && !where.has(o.id));
  const tokens = specs
    .filter((o) => !lost.includes(o))
    .map((o) => (online.includes(o.id) ? `✓${objectiveName(o)}` : `·${objectiveName(o)} ${where.get(o.id)}`));
  // The words and the names as one piece where a row holds them, so the label
  // never hangs off the end of the row above its own names.
  const names = lost.map(objectiveName);
  const whole = [t("panel.systems.lost"), ...names].join(" ");
  if (lost.length > 0) tokens.push(...(whole.length <= PANEL_WIDTH ? [whole] : [t("panel.systems.lost"), ...names]));
  return wrapped(tokens, " ");
}

/** Which compartment each system stands in, of the ones the drone has seen. */
function systemRooms(game: RoomGame): Map<string, string> {
  const out = new Map<string, string>();
  for (const room of game.ship.rooms) {
    if (room.explored !== true && room.scanned !== true) continue;
    for (const sys of roomList<ShipSystem>(room, "systems")) {
      if (!out.has(sys.kind)) out.set(sys.kind, room.label);
    }
  }
  return out;
}

/**
 * The charters signed for this hull, with what each of them still wants.
 *
 * `NEUTRALIZE` is not among them: it is the two lines above, where the goal of
 * the run belongs. Standing in the same list as the errands is what made it
 * read as a fourth errand, which is half of why the owner never chased it
 * (docs/owner-queue.md, 5).
 *
 * `SALVAGE` counts what the drone would bank by leaving right now — what is
 * already home plus what it is carrying — because that is the number the
 * decision to turn back is made on. It is also why `hint.payout` exists: the
 * second half of that sum is only real if the drone gets out.
 */
function charterBlock(game: RoomGame): PanelLine[] {
  const voyage = voyageRecord(game);
  const state = derelictAboard(game);
  if (!voyage || !state) return [];
  const signed = voyage.charters.filter((c) => c.id !== "neutralize");
  if (signed.length === 0) return [];

  const out: PanelLine[] = [{ text: clip(t("panel.charters")), fg: THEME.accent }];
  for (const charter of signed) {
    const done = charterDone(game, charter);
    out.push({
      text: clip(charterLine(charter, done, state.banked + voyage.loot, state.spec)),
      fg: done ? THEME.fgDim : THEME.fg,
    });
  }
  return out;
}

/** `· SALVAGE 12/20 CR`, `· RETRIEVE · MED BAY`, `✓ UPLOAD`. */
function charterLine(
  charter: Charter,
  done: boolean,
  loot: number,
  spec: Parameters<typeof salvageTarget>[0],
): string {
  const parts = { mark: done ? "✓" : "·", name: tId("charter.name", charter.id, charter.id) };
  if (done) return t("panel.charter.plain", parts);
  if (charter.id === "salvage") {
    const need = salvageTarget(spec);
    return t("panel.charter.loot", { ...parts, have: Math.min(loot, need), need });
  }
  const kind = charter.target?.kind;
  return kind === undefined
    ? t("panel.charter.plain", parts)
    : t("panel.charter.where", { ...parts, room: zoneName(kind) });
}

// ------------------------------------------------------------- the contacts

/**
 * A rule the width of the panel, labelled and counted — the one line here that
 * is allowed to shout.
 *
 * A ruled bar rather than a heading because a word in a column of words is a
 * word: `CONTACTS` in the accent colour sat among `CARGO BAY r2`, `ACTIONS` and
 * the exposed module's arrow, all of them amber, and it was read as furniture.
 * A rule has a shape, and the shape is what peripheral vision picks up.
 */
function contactsBar(label: string, fg: string): PanelLine {
  const rule = "═".repeat(Math.max(0, PANEL_WIDTH - label.length - 4));
  return { text: clip(`══ ${label} ${rule}`), fg };
}

/**
 * Everything alive and hostile the drone can see, one line each.
 *
 * The block the owner's second playtest asked for (docs/tasks/G40-tug-clarity.md,
 * 7) and the third one made loud (docs/tasks/G47-contacts.md). What G40 put on
 * the line was where the machine is; what the third playtest showed missing is
 * why it matters — the drone was being hit and the panel said `enforcer 10/10`
 * with no hint that this one opens welded doors and comes looking. So the line
 * carries the glyph, the name, the hit points, the door to shut on it, and one
 * word for what it does to a rack.
 *
 * Nothing at all when there is nothing to say: the row that used to read `no
 * contacts` was two rows (heading and answer) spent on silence, on a panel
 * whose scarcest thing is rows. The block's absence is now the answer, and the
 * absence is legible because its presence is a red rule.
 *
 * Two groups, each under its own rule, because one rule could not carry both
 * counts honestly: `ENEMY IN HERE: 2` over three lines reads as a panel that
 * cannot count, and `CONTACTS: 3` over a machine standing next to you is the
 * loud half of the message thrown away to fix the arithmetic. Each rule counts
 * exactly the lines beneath it, so both stay true. The second rule costs a row
 * only when both groups exist at once, which is the rarer of the three states.
 */
export function contactsBlock(game: RoomGame, allow = CONTACT_LINES): PanelLine[] {
  const here = game.roomOf(game.player).id;
  const blows = blowsLastTurn(game);
  const found = contactsOf(game, here);
  const shown = found.slice(0, Math.max(1, allow));
  if (shown.length === 0) return [];

  const rows = (group: typeof shown, inRoom: boolean): PanelLine[] =>
    group.flatMap(({ machine, door }) => {
      const line: PanelLine = {
        text: contactLine(machine, inRoom ? undefined : (door?.label ?? "→")),
        fg: contactTone(machine.hp, machine.hpMax),
        id: machine.id,
      };
      // What it did to the drone on the turn just gone, on a line of its own:
      // `E enforcer 10/10 hunter` is already twenty-three of the panel's columns.
      const blow = blows.find((b) => b.subject.includes(machineName(machine.name).toLowerCase()));
      return blow ? [line, { text: clip(`   ${blow.what}`), fg: THEME.bad }] : [line];
    });

  // The rules count what is there, not the rows under them: the number over
  // the compartment is the number on the schematic's badge, read off the same
  // list (`hostilesIn`), and the two may never disagree — the owner read `6`
  // on the panel and `7` on the map of one compartment and asked which was
  // lying (docs/tasks/G83-anonymous-blows.md, 4). Rows the block has no room
  // for are counted again under it, so the arithmetic still closes.
  const inRoom = shown.filter((c) => c.room === here);
  const beyond = shown.filter((c) => c.room !== here);
  const out: PanelLine[] = [];
  if (inRoom.length > 0) {
    const n = found.filter((c) => c.room === here).length;
    out.push(contactsBar(t("panel.contacts.here", { n }), THEME.bad));
    out.push(...rows(inRoom, true));
  }
  if (beyond.length > 0) {
    const n = found.filter((c) => c.room !== here).length;
    out.push(contactsBar(t("panel.contacts.near", { n }), THEME.warn));
    out.push(...rows(beyond, false));
  }

  if (found.length > shown.length) {
    const line = t("panel.contactsMore", { n: found.length - shown.length });
    out.push({ text: clip(line), fg: THEME.fgDim });
  }
  return out;
}

/** How many of the machines in sight are standing in the drone's compartment. */
function contactsHere(game: RoomGame): number {
  const room = game.roomOf(game.player).id;
  return contactsOf(game, room).filter((c) => c.room === room).length;
}

/**
 * The machines in sight, this compartment first and the neighbours after it.
 *
 * `game.visible` is the whole of the rule about what may be listed: a machine
 * behind a shut bulkhead is not in it, so it is not a contact — the panel may
 * not know something the schematic is not drawing.
 */
function contactsOf(
  game: RoomGame,
  here: RoomId,
): Array<{ machine: Entity; room: RoomId; door?: Door }> {
  const doors = game.ship.doorsOf(here);
  const rooms = [here, ...[...game.visible].filter((id) => id !== here).sort((a, b) => a - b)];
  const seen = rooms.flatMap((room) =>
    hostilesIn(game, room).map((machine) => {
      const door = doors.find((d) => d.a !== d.b && game.ship.other(d, here) === room);
      return door ? { machine, room, door } : { machine, room };
    }),
  );
  return [...seen, ...strikersNear(game, here)];
}


/**
 * `E enforcer 10/10 hunter`, inside the panel's twenty-eight columns — and
 * `c scout 3/3 d4 shoots` for one that is still a door away.
 *
 * No door label means the machine is standing in the compartment: that reading
 * is what the red rule over the block and the red line itself are for, and
 * spelling `HERE` out again cost five of the columns the danger word now has.
 * The compartment next door lost its name for the same five columns — which
 * door to shut is the decision, and the schematic is already drawing what is
 * behind it.
 *
 * The name is what gives way when it will not all fit. The glyph is how the
 * machine is found on the schematic, the hit points are the number the fight
 * turns on and the word is why the fight goes the way it does; none of the
 * three is guessable from the rest of the line the way half a name is.
 */
/**
 * A contact's colour, by how much of the machine is left.
 *
 * Kyzrati's one way of saying "this one you can finish and that one you cannot"
 * without making anybody read a number: robots run green to red on remaining
 * integrity, and the same three colours mean the same three things everywhere
 * on his screen (docs/gui-guides.md, "Что применить", D). Untouched is green,
 * hurt is the reading colour, half gone is amber, a quarter left is red.
 *
 * It takes the channel the two groups used to share — a line in the room was
 * red and a line a door away amber — and the groups did not lose anything by
 * it: each is already under a rule the full width of the panel that names it
 * and counts it, in those same two colours. That rule is a shape, which is what
 * peripheral vision reads; the line under it is words, which is what the eye
 * reads, and the words `5/10` and this colour now say one thing rather than
 * two. Nothing is coloured that is not also written (docs/gui-guides.md, §4.5).
 */
export function contactTone(hp: number, hpMax: number): string {
  if (hpMax <= 0 || hp >= hpMax) return THEME.hpFull;
  const share = hp / hpMax;
  if (share > 0.5) return THEME.fg;
  if (share > 0.25) return THEME.warn;
  return THEME.hpLow;
}

function contactLine(machine: Entity, door: string | undefined): string {
  const hp = `${machine.hp}/${machine.hpMax}`;
  const place = door === undefined ? "" : ` ${door}`;
  // A door away, the word answers "can it reach me from there" rather than
  // "what does it do to a rack" (`systems/contacts.ts`, `dangerWord`).
  const tail = `${place} ${dangerWord(machine, door !== undefined)}`;
  const room = PANEL_WIDTH - 3 - hp.length - tail.length;
  const name = clipName(machineName(machine.name), Math.max(3, room));
  return clip(`${machine.ch} ${name} ${hp}${tail}`);
}



/**
 * Everything below the numbered list, and the reason the list is what gets
 * shortened: the row of letters is the thing a player who is lost reads, so it
 * is laid out first and the list is given what is left
 * (docs/tasks/G40-tug-clarity.md, 5).
 *
 * It used to carry the map of the tug above the letters — four rows saying
 * which compartment sold and which mended. There are no compartments to map
 * since G53 and `stationGuide` hands back nothing; the call goes with the
 * concept.
 */
export function footBlocks(game: RoomGame, nested = false): PanelLine[] {
  return letterRows(game, nested).map((line) => ({ text: clip(line), fg: THEME.fgDim }));
}

/**
 * The head inside `want` rows, paid for with the blank rows between its blocks,
 * nearest the list first. Blanks only: every block above has already been
 * offered the chance to shorten itself, and what is left of them is what the
 * panel may not lose.
 */
function squeezeAir(
  head: readonly PanelLine[],
  want: number,
  gives = (line: PanelLine): boolean => line.text === "",
): PanelLine[] {
  const out = [...head];
  for (let i = out.length - 1; i >= 0 && out.length > want; i--) {
    if (gives(out[i]!)) out.splice(i, 1);
  }
  return out;
}

/** Rows the whole list would take if nothing were in its way, headings and all. */
function listHeight(actions: readonly Action[]): number {
  return actions
    .filter((a) => a.key !== "")
    .reduce((n, a) => n + rowsOf(a), 0);
}

/** How many rows one line of the list draws: itself, a heading, a second row. */
function rowsOf(action: Action): number {
  return 1 + (action.head === undefined ? 0 : 1) + (action.extra === undefined ? 0 : 1);
}

/**
 * As many of the numbered lines as there are rows for, and how many were left
 * out — the ones the list itself could not number, plus the ones that did not
 * fit. A line and the row of letters under it are one entry: half a bulkhead is
 * worse than none of it.
 */
function fitList(
  actions: readonly Action[],
  budget: number,
  cursor: number,
): { rows: PanelLine[]; omitted: number } {
  // The cursor is a position in the whole list; the panel only ever draws the
  // ten the digits are on, so the highlight is found by index in the original
  // rather than by counting the ones that were kept.
  const groups = actions
    .filter((a) => a.key !== "")
    .map((a) => {
      const at = actions.indexOf(a);
      // The highlight beats both the pressable colour and the greyed one: a
      // line the cursor is on is the line `Enter` will do, whether or not it
      // will do anything (docs/tasks/G40-tug-clarity.md, 8).
      const fg = at === cursor ? THEME.accent : a.enabled ? THEME.fg : THEME.fgDim;
      const rows: PanelLine[] = [];
      // The group this line opens, on a row of its own above it. A property of
      // the line rather than a line of its own, so the ten keys, the cursor and
      // the "there is more of it" count are all untouched by the grouping
      // (`ui/actions.ts`, `Action.head`).
      if (a.head !== undefined) rows.push({ text: clip(a.head), fg: THEME.accent });
      rows.push({ text: clip(`${at === cursor ? "▸" : " "}${a.key} ${a.label}`), fg });
      if (a.extra !== undefined) rows.push({ text: clip(`   ${a.extra}`), fg: THEME.zone });
      return rows;
    });

  const keyless = omittedActions(actions).length;
  const height = groups.reduce((n, g) => n + g.length, 0);
  if (keyless === 0 && height <= budget) return { rows: groups.flat(), omitted: 0 };

  // One row goes to the count itself, so the list never eats the line that says
  // there is more of it — unless that row is the only one the list has, in
  // which case the count goes and the line stays. `… 6 more` over nothing is
  // the panel naming an interface and then refusing to draw it.
  const first = groups[0]?.length ?? 0;
  const room = budget - 1 >= first ? budget - 1 : Math.max(0, Math.min(budget, first));
  const rows: PanelLine[] = [];
  let kept = 0;
  for (const group of groups) {
    if (rows.length + group.length > room) break;
    rows.push(...group);
    kept++;
  }
  return { rows, omitted: keyless + (groups.length - kept) };
}

/**
 * `SALVOR  freighter  sortie 2` — what ship this is and how often it was tried.
 * On the tug: `SALVOR  tug → freighter`, because the first question the screen
 * has to answer is which of the two ships the player is standing on.
 *
 * The arrow rather than the task's `docked · freighter` for the one reason the
 * panel never argues with: `SALVOR  tug  docked · freighter` is thirty-one
 * columns and the panel has twenty-eight.
 */
function heading(game: RoomGame): string {
  if (isTug(game)) {
    const docked = hullWord(game, dockedDerelict(game), derelictNameOf(tag(game, "docked")));
    return docked === undefined ? t("panel.head.tug") : t("panel.head.tugTo", { hull: docked });
  }
  const named = hullWord(game, derelictAboard(game), derelictNameOf(tag(game, "type")));
  const parts = [
    t("title.name"),
    named ?? t("word.derelict"),
    t("panel.sortie", { n: game.currentShip.visits }),
  ];
  return parts.join("  ");
}

/**
 * What to call the hull on the heading: its callsign where the column has room
 * for it, its class where it has not.
 *
 * The callsign, because a voyage is four hulls and three of them can be
 * freighters: `SALVOR  freighter  sortie 2` names none of them, and the same
 * word did for all of them in the heading and in the list alike
 * (docs/tasks/G55-playtest-findings.md). The class stays as the fallback rather
 * than a clipped callsign — `BRIGHT ANCH` is a hull nobody has heard of.
 */
function hullWord(
  game: RoomGame,
  state: DerelictState | undefined,
  fallback: string | undefined,
): string | undefined {
  if (state === undefined) return fallback;
  const callsign = flavourCallsign(state.flavour);
  const rest = isTug(game)
    ? t("panel.head.tugTo", { hull: "" }).length
    : t("title.name").length + 2 + t("panel.sortie", { n: game.currentShip.visits }).length + 2;
  return callsign.length + rest <= PANEL_WIDTH ? callsign : fallback;
}

/**
 * This compartment: its name, where each of its doors goes, and what is lying
 * in it.
 *
 * The doors used to be `doors d11 d13` — the labels and nothing else. The
 * owner's fourth playtest stood in a repair bay with that line on the panel and
 * asked whether there was a way straight through to the hold, and the screen
 * could not answer: the schematic had not drawn `d13` at all and the panel had
 * named it without saying where it went (docs/tasks/G49-schematic-honesty.md).
 * A door label is an index into a picture; the compartment on the other side is
 * the fact the player is deciding on.
 *
 * They are listed even when the schematic could only reference one of them —
 * the picture may run short of columns, the panel may not.
 *
 * What is *standing* in it stopped being listed here in G40: machines are
 * CONTACTS' business, and the two blocks deliberately do not overlap. A machine
 * listed twice on a twenty-eight column panel cost a row the action list needed
 * and said less the second time — no `HERE`, no last blow, and nothing about
 * the compartment next door.
 */
function roomBlock(game: RoomGame, allow = ROOM_LINES, doors = DOOR_LINES): PanelLine[] {
  // Nothing at home. The tug has compartments in its graph and a player never
  // meets one: nothing walks between them, no line names them, and `ДОК r1`
  // over `a1 → БУКСИР` next to a list of verbs was the clearest case of the
  // two ships reading as one (docs/tasks/G54-two-ships-confusion.md). What the
  // tug is and what it is tied to is drawn where the schematic goes
  // (`ui/tugboard.ts`), and the rows this frees go to the list.
  if (isTug(game)) return [];
  const room = game.roomOf(game.player);
  // Down to its last row the block goes back to what it was before G49: the
  // door labels on the heading itself, costing nothing. One row that names
  // every door beats one that names none of them and counts them instead, and
  // the numbered list is still saying where each of them leads.
  const parts = { room: roomName(room), label: room.label };
  const out: PanelLine[] =
    doors >= 2 ?
      [{ text: t("panel.room", parts), fg: THEME.accent }, ...doorBlock(game, room.id, doors)]
    : [{ text: t("panel.roomDoors", { ...parts, doors: doorLabels(game, room.id, parts) }), fg: THEME.accent }];

  // What is lying about, and only as much of it as the block is allowed. Every
  // one of these is also a line of the action list — `% scrap WELDER 1/4` is
  // `salvage WELDER 1/4` — so when the panel is short of rows this is the block
  // that gives them up, and the list it was repeating is the one that keeps them.
  // The ship's own systems are drawn in their box on the schematic and spelled
  // out in the mission block, which is where the price, the tool and the turns
  // are — so listing them a third time here would spend a row of a
  // twenty-eight column panel on `+ +`: a system's record carries a glyph and
  // no name a language could translate (`systems/populate.ts`).
  const content = thingsIn(game, room.id)
    .filter((t) => t.glyph !== SYSTEM_GLYPH)
    .map((t) => ({ text: contentLine(t.glyph, t.name, "") }));
  if (allow <= 0) return out;
  if (content.length <= allow) return [...out, ...content];
  return [
    ...out,
    ...content.slice(0, allow - 1),
    { text: ` ${t("panel.roomMore", { n: content.length - (allow - 1) })}`, fg: THEME.fgDim },
  ];
}

/**
 * `d7 d10 +2`: the labels that fit on the compartment's own row, and a count of
 * the ones that did not.
 *
 * The count is the whole point. Written out and clipped to the panel's width,
 * this row printed `ТРЮМ r8  двери d7 d10 d13 d1` — and `d1` was a real door of
 * that same ship, four compartments away: the bot sweep caught it on 6.6 % of
 * screens, in every language (docs/tasks/G55-playtest-findings.md, 5). A label
 * cut in half is not a shorter label, it is a different door, and this file's
 * own rule is that the picture may stay silent where the panel may not lie.
 */
function doorLabels(game: RoomGame, here: RoomId, parts: { room: string; label: string }): string {
  const labels = doorsOut(game, here).map((d) => d.label);
  // What the row costs before any label: the compartment, its `rN` and the word
  // for doors, measured through the sentence itself rather than guessed at, so
  // a language with a longer word for them fits fewer labels — and never fewer
  // characters of one.
  const spent = t("panel.roomDoors", { ...parts, doors: "" }).length;
  const kept: string[] = [];
  for (const label of labels) {
    const rest = labels.length - kept.length - 1;
    const tail = rest > 0 ? ` +${rest}` : "";
    const width = spent + kept.join(" ").length + (kept.length > 0 ? 1 : 0) + label.length + tail.length;
    if (width > PANEL_WIDTH) break;
    kept.push(label);
  }
  const left = labels.length - kept.length;
  return left > 0 ? [...kept, `+${left}`].join(" ") : kept.join(" ");
}

/**
 * Every door out of here, and the last of them replaced by a count when the
 * panel has run out of rows.
 */
function doorBlock(game: RoomGame, here: RoomId, allow: number): PanelLine[] {
  const doors = doorsOut(game, here);
  // Labels padded to the widest of them, so the arrows line up and the block
  // reads as three columns rather than as four sentences of different lengths.
  const width = doors.reduce((n, d) => Math.max(n, d.label.length), 0);
  const lines = doors.map((d) => ({ text: doorLine(game, here, d, width), fg: THEME.zone }));
  if (lines.length <= allow) return lines;
  return [
    ...lines.slice(0, allow - 1),
    { text: clip(` ${t("panel.doorMore", { n: lines.length - (allow - 1) })}`), fg: THEME.fgDim },
  ];
}

/** The compartment's doors, the airlock's self-edge counted once. */
function doorsOut(game: RoomGame, here: RoomId): Door[] {
  return game.ship.doorsOf(here).filter((d) => d.a !== d.b || d.state === "airlock");
}

/**
 * ` d13 → STORAGE      locked` — the door, the compartment behind it, and what
 * stands in the way, in the same three columns the action list uses.
 *
 * The name is what gives way to the state word rather than the other way round,
 * for the reason `labelOf` gives: `locked` is the word the decision turns on. A
 * compartment nobody has been in or scanned is `····`, which is the same thing
 * its box on the schematic says.
 */
function doorLine(game: RoomGame, here: RoomId, door: Door, width: number): string {
  const state = doorStateWord(door.state === "airlock" ? "out" : door.state);
  const label = door.label.padEnd(width);
  const room = PANEL_WIDTH - 2 - label.length - 3 - state.length;
  // At a word, never mid-syllable: the same rule the contacts block and the
  // travel list keep (docs/tasks/G55-playtest-findings.md, 8).
  const name = clipName(farRoomName(game, door, here), Math.max(2, room));
  const text = ` ${t("panel.doorTo", { door: label, room: name })}`;
  return clip(clipTo(text, PANEL_WIDTH - state.length - 1).padEnd(PANEL_WIDTH - state.length) + state);
}

/** What is on the other side, as much of it as the drone has any right to know. */
function farRoomName(game: RoomGame, door: Door, here: RoomId): string {
  if (door.state === "airlock") return t("word.tug");
  const far = game.ship.roomAt(game.ship.other(door, here));
  return far.explored || far.scanned || game.visible.has(far.id) ? roomName(far) : UNKNOWN_ROOM;
}

/** ` S security unit    8/8`: glyph, name, and the number that decides the fight. */
function contentLine(glyph: string, name: string, right: string): string {
  const width = PANEL_WIDTH - 3 - right.length;
  const text = clipTo(name, width - (right.length > 0 ? 1 : 0));
  return ` ${glyph} ${right.length > 0 ? text.padEnd(width) : text}${right}`;
}


/**
 * The verbs that never take a number. Two rows rather than the mock-up's one,
 * because a compartment with cover *and* the airlock in it would push the last
 * of them off the panel — and the row that says how to leave is the one a lost
 * player is looking for.
 */
function letterRows(game: RoomGame, nested: boolean): string[] {
  // At home none of them do anything: there is nowhere to walk, nothing to
  // brace against, no cover and nothing to fight (docs/tasks/G53-tug-is-a-menu.md,
  // 2). A row of keys that answer with a refusal is a row that teaches the
  // wrong half of the game. And `0 back` only one level down: at the top `0`
  // is the tenth row, cast off, and the foot named a second thing for the same
  // key on 64.9 % of screens at home (docs/tasks/G88-polish-by-map.md, B6).
  if (isTug(game)) return [t(nested ? "panel.letters.tug" : "panel.letters.tugTop")];
  // `m` leads, because walking is the commonest thing anybody does and the row
  // of letters is where a player looks for a key they have not found yet
  // (docs/tasks/G48-travel-to-a-room.md).
  // `d` next to `m` because they are the two halves of one question — where to
  // go, and what is in the way (docs/tasks/G64-door-hotkeys.md). The row is
  // where a player looks for a key they have not found yet, and welding a door
  // shut behind the drone is the one move in the game that ends a chase.
  const first = [t("panel.letter.move"), t("panel.letter.doors"), t("panel.letter.brace")];
  if (game.roomOf(game.player).cover) first.push(t("panel.letter.hide"));
  // Aboard a hull `<` is always the way out — at the airlock it casts off, and
  // anywhere else it walks there (docs/tasks/G48-travel-to-a-room.md), so the
  // row that a lost player reads no longer waits until they have already found
  // their way home. The tug's own airlock is not a way out of anything:
  // casting off there is `undock`, a numbered line, and two keys for one thing
  // is one key too many.
  if (!isTug(game)) first.push(t("panel.letter.leave"));
  return [...wrapped(first), t("panel.letters")];
}

/**
 * Tokens two spaces apart, broken into as few rows as the panel's own width
 * allows.
 *
 * Counted rather than written out as one string per case, because there are
 * three languages and four of these tokens: Russian's `m идти  . упор  h укрыт
 * < выход` is thirty-two columns of a twenty-eight column panel, and a row that
 * long is a row rot.js wraps — which pushes the line saying `? help` off the
 * bottom, the exact defect G40 existed to fix.
 */
function wrapped(tokens: readonly string[], gap = "  "): string[] {
  const rows: string[] = [];
  for (const token of tokens) {
    const last = rows.length - 1;
    const row = rows[last];
    if (row !== undefined && row.length + gap.length + token.length <= PANEL_WIDTH) rows[last] = `${row}${gap}${token}`;
    else rows.push(token);
  }
  return rows;
}

// ---------------------------------------------------------------- the flash

/**
 * Slots whose integrity fell between two frames. A slot the panel has never
 * seen before cannot have dropped — that is a rack being filled in, not a hit —
 * so the first frame of a run flashes nothing.
 */
export function flashSlots(prev: readonly number[], next: readonly number[]): Set<number> {
  const hurt = new Set<number>();
  for (let i = 0; i < next.length; i++) {
    const before = prev[i];
    if (before !== undefined && next[i]! < before) hurt.add(i);
  }
  return hurt;
}

/**
 * The panel one frame on. A blow starts a flash and pins it to its turn; the
 * flash then survives every redraw of that turn — a help card opened and closed
 * on the turn a module was hit must not swallow the only signal that it was —
 * and goes out when the clock moves.
 */
export function trackFlash(prev: Flash, integrity: readonly number[], turn: number): Flash {
  const hurt = flashSlots(prev.integrity, integrity);
  if (hurt.size > 0) return { integrity, slots: hurt, turn };
  if (turn !== prev.turn) return { integrity, slots: new Set(), turn: prev.turn };
  return { integrity, slots: prev.slots, turn: prev.turn };
}

/** Integrity per slot, in slot order. An empty slot counts as zero, not absent. */
export function rackIntegrity(player: Entity): number[] {
  const rig = rigOf(player);
  return rig ? rig.slots.map((s) => s?.integrity ?? 0) : [];
}

/**
 * The system decided the colour; the panel only fills in what it left blank,
 * and overrides two lines that are about this instant rather than about the
 * run: a module that took a blow this turn, and a machine that has just come
 * into sight and is flashing on the beat (`ui/pulse.ts`).
 *
 * A contact standing in the drone's own compartment is already `bad`, so the
 * pulse changes nothing on its line and the flashing box on the schematic is
 * what carries the signal for it. A contact a door away is `warn`, and that one
 * turns red along with its compartment — which is the case the effect is for,
 * because it is the one the player has not looked at yet.
 */
export function panelColour(
  line: PanelLine,
  flash: ReadonlySet<number>,
  lit: ReadonlySet<number> = NOBODY,
): string {
  const slot = slotNumberOf(line.text);
  if (slot !== undefined && flash.has(slot)) return THEME.bad;
  if (line.id !== undefined && lit.has(line.id)) return THEME.bad;
  if (line.fg !== undefined) return line.fg;
  if (line.text.includes("◀")) return THEME.accent;
  if (line.text.includes("burned")) return THEME.burned;
  return THEME.fg;
}

/** Slot index behind a panel line like `3 SCANNER ▮▮`, or undefined for other lines. */
export function slotNumberOf(text: string): number | undefined {
  const n = Number(text.slice(0, 1));
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : undefined;
}

/**
 * The debug overlay (G68), as the panel's own line shape: `debugBlock`
 * already decided whether anything is said at all, so an empty array here
 * means the flag is off and nothing is drawn, in either view.
 *
 * Not clipped to `PANEL_WIDTH`: unlike the sidebar blocks this draws the
 * full screen wide, under the log, so a line naming a machine's room,
 * behaviour and distance in one breath is not forced to wrap.
 */
export function debugBlockLines(game: RoomGame, enabled: boolean): PanelLine[] {
  return debugBlock(game, enabled).map((text) => ({ text: clipTo(text, DEBUG_LINE_WIDTH), fg: THEME.fgDim }));
}

/** Long enough that a machine's whole line survives; short enough to stop a runaway list name. */
const DEBUG_LINE_WIDTH = 160;

function clip(text: string): string {
  return clipTo(text, PANEL_WIDTH);
}

/**
 * A row of the sidebar in its columns, and the mark when it did not fit.
 *
 * The `slice` used to be silent, so `2 attack security unit 8/8 #1` came out
 * as a whole-looking line that had quietly lost the `#1` — the one thing
 * telling it from the line above. Lines of the list are fitted before either
 * view sees them (`ui/actions.ts`, `fitLabel`), so what reaches here is the
 * blocks; this is the backstop, and it is not allowed to be quiet.
 */
function clipTo(text: string, width: number): string {
  if (text.length <= width) return text;
  return width <= 1 ? text.slice(0, Math.max(0, width)) : `${text.slice(0, width - 1)}\u2026`;
}

/**
 * `[i] 2`: the badge in the top-left corner of the map, and the count of cards
 * the run has shown and the player has not opened (`systems/codex.ts`).
 *
 * Nothing at all when there is nothing to read, which is most of a careful
 * sortie. That is the whole of the owner's teaching mode: a mark that appears
 * when there is something new to say, says how much of it there is, and goes
 * away when it has been said — «хочет — читает, не хочет — не читает».
 *
 * Here rather than in either renderer because both draw it, and the two views
 * are never allowed to word the same thing twice (`ui/web/screen.ts`).
 */
export function codexBadge(game: RoomGame): string | undefined {
  const unread = codexUnread(game);
  return unread === 0 ? undefined : t("codex.badge", { n: unread });
}
