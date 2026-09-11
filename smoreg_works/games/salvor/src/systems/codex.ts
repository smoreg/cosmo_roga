import type { Entity, RoomGame, System } from "@jamrog/engine";
import { alertCodexId, codexFor, type CodexId } from "../content/codex.js";
import { isRelic } from "../content/modules.js";
import { machineByName } from "../content/monsters.js";
import { rigOf } from "../twist/rig.js";
import { alertState } from "./alert.js";
import { GHOST_NAME } from "./ghost.js";
import { signThisTurn } from "./hazards.js";
import { rivalKind } from "./rival.js";
import { virusOf } from "./virus.js";

/**
 * What the run has already shown the player, and which of it has been read.
 *
 * The register behind the `[i]` badge. Every turn it asks the same question of
 * the state the other systems have just finished writing — is there anything in
 * front of the drone that the run has not shown before — and writes down the
 * ids it finds. Nothing else: no turn is spent, no line goes to the log, and
 * the drone does not know this file exists. That is the owner's «хочет —
 * читает, не хочет — не читает» expressed as a rule.
 *
 * Per run and nothing but per run. The register lives in `player.data`, so it
 * survives the walk home, the next derelict and a save file, and it dies with
 * the voyage — a new run starts with the badge showing everything as new again.
 * That is the jam's fourth rule (`.claude/CLAUDE.md`): nothing carries between
 * runs, and a codex that remembered would be meta-progression however gently it
 * was worded.
 *
 * It observes and never decides, which is why it can be last in the list of
 * systems: whatever the alarm, the virus and the voyage did this turn is
 * already done by the time this looks.
 */

/** The pocket, as it is written. `player.data.codex` round-trips through a save. */
interface CodexRecord {
  /** Everything shown this run, in the order it was first shown. */
  seen: CodexId[];
  /** The part of `seen` the player has not opened yet: what the badge counts. */
  unread: CodexId[];
}

/**
 * The live record, made on demand.
 *
 * Defensive about every field: the pocket comes back out of a save file, and a
 * codex that trusted it would take the run down over a screen decoration.
 */
function record(game: RoomGame): CodexRecord {
  const data = game.player.data;
  if (data === undefined) return { seen: [], unread: [] };
  const raw = data.codex;
  if (isRecord(raw)) return raw;
  const fresh: CodexRecord = { seen: [], unread: [] };
  data.codex = fresh;
  return fresh;
}

function isRecord(raw: unknown): raw is CodexRecord {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Partial<CodexRecord>;
  return Array.isArray(r.seen) && Array.isArray(r.unread);
}

/**
 * The run has shown this thing. The first time it says so; every time after
 * that it says nothing at all, which is the whole contract of the badge.
 *
 * An id with no card is dropped here rather than at the window: a hazard that
 * has not been written up yet must not be able to put a number on the badge
 * that opens nothing.
 */
export function noticeCodex(game: RoomGame, id: string | undefined): boolean {
  const card = codexFor(id);
  if (card === undefined) return false;
  const known = record(game);
  if (known.seen.includes(card.id)) return false;
  known.seen.push(card.id);
  known.unread.push(card.id);
  return true;
}

/** The player has read this card: off the badge, still in the help card. */
export function readCodex(game: RoomGame, id: CodexId): void {
  const known = record(game);
  const at = known.unread.indexOf(id);
  if (at >= 0) known.unread.splice(at, 1);
}

/** Cards waiting to be read, oldest first. */
export function unreadCodex(game: RoomGame): CodexId[] {
  return [...record(game).unread];
}

/** Everything the run has shown, read or not, in the order it happened. */
export function seenCodex(game: RoomGame): CodexId[] {
  return [...record(game).seen];
}

/** The number on the badge. Zero means no badge at all. */
export function codexUnread(game: RoomGame): number {
  return record(game).unread.length;
}

/**
 * The hazard this player turn warned about, if it warned about one.
 *
 * This is the whole of the connection between the red line and the key: the
 * line ends in `[i]`, and `i` opens the card for *that* hazard rather than the
 * oldest unread one. Asked of the hazard's own record rather than of the log,
 * because contacts and the rival run after hazards: their line — a machine
 * walking in, the rival coming aboard — is the last line of the log while the
 * red line is still the one asking for `i`, and it used to steal the key.
 */
export function alarmCodexId(game: RoomGame): CodexId | undefined {
  const id = signThisTurn(game);
  return id !== undefined && codexFor(id) !== undefined ? id : undefined;
}

/**
 * The cards `i` opens, in the order it pages through them.
 *
 * The alarm's own card first when there is one — that is the point of the red
 * line ending in `[i]` — and then everything else the run has shown and the
 * player has not read. With nothing unread at all the list is empty and the key
 * opens the help card instead (`ui/appstate.ts`).
 */
export function codexQueue(game: RoomGame): CodexId[] {
  const alarm = alarmCodexId(game);
  const unread = unreadCodex(game);
  if (alarm === undefined) return unread;
  return [alarm, ...unread.filter((id) => id !== alarm)];
}

// ---------------------------------------------------------------- the watching

/**
 * Everything the turn may have put in front of the drone.
 *
 * Read off state rather than pushed in by whoever caused it, for the reason
 * `ui/appstate.ts` reads the voyage the same way: there are a dozen paths to a
 * relic being in the rack — bought, grafted, taken off a wreck, swapped at the
 * dock — and a card that needed each of them to remember to announce itself is
 * a card that is missing on the path nobody thought of.
 */
function watch(game: RoomGame): void {
  noticeAlert(game);
  noticeVented(game);
  noticeVirus(game);
  noticeRelics(game);
  noticeContacts(game);
  noticeCodex(game, alarmCodexId(game));
}

/** The rung the ship is standing on. Every rung climbed gets its own card. */
function noticeAlert(game: RoomGame): void {
  const level = alertState(game).level;
  if (level > 0) noticeCodex(game, alertCodexId(level));
}

/**
 * Vacuum, once the drone can see it is there.
 *
 * Explored or scanned only: a compartment the ship has vented on the far side
 * of the hull is not something the run has shown anybody yet, and the badge is
 * a promise that something on this screen is worth reading.
 */
function noticeVented(game: RoomGame): void {
  const vented = game.ship.rooms.some((r) => r.hazard === "vented" && (r.explored || r.scanned));
  if (vented) noticeCodex(game, "vented");
}

/** Whatever strain is aboard, by the id `content/viruses.ts` gave it. */
function noticeVirus(game: RoomGame): void {
  const virus = virusOf(game.player);
  if (virus === undefined) return;
  noticeCodex(game, virus.strain ?? "spasm");
}

/** A relic in the rack. Three of them exist and each is its own card. */
function noticeRelics(game: RoomGame): void {
  const rig = rigOf(game.player);
  if (rig === undefined) return;
  for (const slot of rig.slots) {
    if (slot !== null && isRelic(slot.kind)) noticeCodex(game, slot.kind);
  }
}

/** What is standing in the drone's own compartment, by whatever it is. */
function noticeContacts(game: RoomGame): void {
  const here = game.roomOf(game.player).id;
  const rival = rivalKind().name;
  for (const e of game.entities) {
    if (e.room !== here || e.id === game.player.id) continue;
    if (e.faction === game.player.faction) continue;
    noticeCodex(game, contactCodexId(e, rival));
  }
}

/**
 * The card an entity in the room belongs to.
 *
 * The catalogue answers for the ship's own machines; the two that are not the
 * ship's are named by the systems that spawn them and are matched by name, the
 * way `dangerWord` matches them (`systems/contacts.ts`). A machine with no card
 * — the maintenance bot, the hauler — answers nothing and puts no number on the
 * badge, which is deliberate: a card per machine would be a bestiary, and what
 * the owner asked for is an answer to "what is going on here".
 */
function contactCodexId(e: Entity, rivalName: string): CodexId | undefined {
  if (e.name === GHOST_NAME) return "ghost";
  // The rival's drone: spawned by its own system, named there, and filed under
  // the shorter id the rest of the game calls it by.
  if (e.name === rivalName) return "rival";
  return machineByName(e.name)?.id;
}

/**
 * Last of every system, and it has to be: what it writes down is the turn as it
 * finally stands, after the voyage has moved the drone and the alarm has
 * climbed. It changes nothing, so nothing downstream can depend on it.
 */
export const CODEX_SYSTEM: System<RoomGame> = {
  name: "codex",

  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    watch(game);
  },
};
