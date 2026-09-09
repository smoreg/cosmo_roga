import type { Command } from "./actions.js";
import type { RoomCommand } from "../rooms/actions.js";

/** 3: the graph commands (`go`, `hide`, `leave`, `act`) joined the union. */
export const SAVE_VERSION = 3;

/** Everything the engine knows how to record. One save format, two worlds. */
export type SavedCommand = Command | RoomCommand;

/**
 * A run is stored as (seed, list of commands), never as a heap of game state.
 *
 * Consequences, all of them good for a jam:
 *   - a save is a few hundred bytes and cannot desync from the code
 *   - a bug report is one string the player can paste
 *   - the same format is the replay format and the test fixture format
 *
 * The cost is that a save only loads against a build whose simulation still
 * produces the same results, which is why SAVE_VERSION exists: bump it whenever
 * a rule change would make old recordings replay differently.
 */
export interface RunRecord<C extends SavedCommand = Command> {
  version: number;
  seed: number;
  inputs: C[];
  /** Free-form, for the death screen: depth, kills, turns. */
  summary?: Record<string, number | string>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function encodeRun<C extends SavedCommand>(record: RunRecord<C>): string {
  return JSON.stringify(record);
}

export interface DecodeResult<C extends SavedCommand = Command> {
  ok: boolean;
  record?: RunRecord<C>;
  reason?: string;
}

/**
 * Parse defensively: a corrupt save must never crash the title screen.
 *
 * Every command either world records is accepted; which of the two a save
 * belongs to is the caller's business, and the type parameter is where it says
 * so. No version number could tell them apart — a grid save handed to a graph
 * game is a list of moves for a map that does not exist, and the game that
 * wrote it is the game that has to read it.
 */
export function decodeRun<C extends SavedCommand = Command>(text: string): DecodeResult<C> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "not an object" };

  const obj = raw as Partial<RunRecord<C>>;
  if (typeof obj.seed !== "number" || !Number.isFinite(obj.seed)) return { ok: false, reason: "missing seed" };
  if (!Array.isArray(obj.inputs)) return { ok: false, reason: "missing inputs" };
  if (obj.version !== SAVE_VERSION) {
    return { ok: false, reason: `save version ${obj.version} != ${SAVE_VERSION}` };
  }
  for (const cmd of obj.inputs) {
    if (!isCommand(cmd)) return { ok: false, reason: "unrecognised command in inputs" };
  }
  return { ok: true, record: { version: SAVE_VERSION, seed: obj.seed >>> 0, inputs: obj.inputs, summary: obj.summary } };
}

function isCommand(v: unknown): v is SavedCommand {
  if (typeof v !== "object" || v === null) return false;
  const c = v as { kind?: unknown; dx?: unknown; dy?: unknown; slot?: unknown; target?: unknown; door?: unknown; verb?: unknown };
  switch (c.kind) {
    case "wait":
    case "descend":
    case "interact":
    case "hide":
    case "leave":
      return true;
    case "move":
      return typeof c.dx === "number" && typeof c.dy === "number";
    case "attack":
      // Two worlds, one word: the grid aims by offset, a ship by entity id.
      return (typeof c.dx === "number" && typeof c.dy === "number") || Number.isInteger(c.target);
    case "use":
      return Number.isInteger(c.slot) && (c.slot as number) >= 0 && isPointOrAbsent(c.target);
    case "go":
      return Number.isInteger(c.door);
    case "act":
      return typeof c.verb === "string" && isIntOrAbsent(c.target) && isIntOrAbsent(c.slot);
    default:
      return false;
  }
}

function isIntOrAbsent(v: unknown): boolean {
  return v === undefined || Number.isInteger(v);
}

function isPointOrAbsent(v: unknown): boolean {
  if (v === undefined) return true;
  if (typeof v !== "object" || v === null) return false;
  const p = v as { x?: unknown; y?: unknown };
  return typeof p.x === "number" && typeof p.y === "number";
}

const KEY = "jamrog1.run";

/**
 * Persist the CURRENT run only. This is a "close the tab and come back" save,
 * not progression: the jam forbids meta-progression, so the caller must call
 * clearRun() on death and must never store anything that outlives a run.
 */
export function saveRun<C extends SavedCommand>(storage: StorageLike, record: RunRecord<C>): void {
  try {
    storage.setItem(KEY, encodeRun(record));
  } catch {
    // Private browsing, full quota: a failed save must never break the game.
  }
}

export function loadRun<C extends SavedCommand = Command>(storage: StorageLike): DecodeResult<C> {
  let text: string | null = null;
  try {
    text = storage.getItem(KEY);
  } catch {
    return { ok: false, reason: "storage unavailable" };
  }
  if (text === null) return { ok: false, reason: "no save" };
  return decodeRun(text);
}

export function clearRun(storage: StorageLike): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // ignore
  }
}
