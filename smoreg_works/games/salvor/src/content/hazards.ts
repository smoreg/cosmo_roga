import type { Key } from "./i18n/keys.js";
import type { ModuleId } from "./modules.js";

/**
 * What can lie in wait on a derelict besides its machines (design report
 * `~/reports/salvor-hazards.html`, "Что такое опасность").
 *
 * A hazard is the static half of a hostile ship: put there when the hull is
 * first boarded, marked on the schematic once the drone knows about it, and
 * only ever costing a *mistake* — the alert prints defenders whatever you do,
 * a hazard stands still until you do the one wrong thing next to it. Five
 * rules follow, and the framework (`systems/hazards.ts`, `ui/auto.ts`) is what
 * makes every row here obey them:
 *
 *   1. it never strikes on the turn it is learned about — a line in the log
 *      and a mark on the map come from the compartment *next* to it;
 *   2. no automatic step (`o`, a walk sent by `m`, `Tab`) ever takes the step
 *      that would cost something;
 *   3. it is marked in all three views, said in red when first met, named in
 *      the compartment block, and it stops auto-explore a door short;
 *   4. it is one row here, one system, and a class of hull carries a list of
 *      them and a budget (`DerelictSpec.hazards`, `threat`);
 *   5. played right it costs nothing, so its budget is on top of the machines'
 *      and never instead of them.
 *
 * **A row is data.** What a hazard *does* is code in `systems/hazards.ts` (or in
 * `systems/doors.ts` for a trap on a door), keyed by the id; what a class of
 * hull carries is its own list. Three rows to start with — two light ones on a
 * compartment and one on a door — as the proof of the framework; the catalogue
 * in the report is the queue behind them (G74–G78).
 */

export type HazardId = "frost" | "smoke" | "mine";

/** Budget points: light, medium, heavy (the report's "Баланс: бюджет угроз"). */
export type HazardLevel = 1 | 2 | 3;

/** Where a hazard sits. A crate hazard is the volatile cargo of G75 and has no placer yet. */
export type HazardSite = "room" | "door" | "crate";

export interface HazardKind {
  readonly id: HazardId;
  readonly level: HazardLevel;
  readonly on: HazardSite;
  /** The mark in a compartment's box, in all three views, once the hazard is known. */
  readonly glyph: string;
  /** Modules that answer it: for the codex card and for the greyed lines. */
  readonly counters: readonly ModuleId[];
  /** The red line said from the compartment next door. Ends in ` [i]`, the codex's hook (G72). */
  readonly tell: Key;
  /** The word in the compartment block and on the map's legend. */
  readonly word: Key;
  /** Nobody sees into or out of the compartment (`Room.opaque` in the engine). */
  readonly opaque?: true;
  /** Somewhere to hide, whatever the compartment kind says. */
  readonly cover?: true;
}

/**
 * Speed the THRUSTERS lose in an iced compartment. Off the drone's derived
 * speed, so a bare chassis suffers as well; the number is a balance knob and
 * lives here with the others.
 */
export const FROST_PENALTY = 20;

/** No hazard slows the drone below this: a drone that never acts is not a hazard, it is a wall. */
export const FROST_FLOOR = 20;

/** What a mine does to the module the step exposed, and to a machine that trips it first. */
export const MINE_DAMAGE = 3;
export const MINE_MACHINE_DAMAGE = 4;

/** Turns of welder work that lift a mine off a door, and how loud they are. */
export const DEFUSE_TURNS = 2;
export const DEFUSE_NOISE = 5;

/** Noise of warming a compartment with the CELL: a heater, not a door blown open. */
export const HEAT_NOISE = 3;

/** Hazards a hull may carry at most, whatever the budget says: the placer's own guard. */
export const MAX_HAZARDS_ABOARD = 6;

export const HAZARDS: Record<HazardId, HazardKind> = {
  /**
   * Ice on everything. Standing in it the THRUSTERS lose `FROST_PENALTY`, so a
   * fight in here is a fight the machines get extra turns in; walking through
   * costs nothing. One point of the CELL warms the compartment for the rest
   * of the sortie (`heat` in `systems/hazards.ts`).
   */
  frost: {
    id: "frost", level: 1, on: "room", glyph: "❄",
    counters: ["cell", "thrusters"],
    tell: "log.hazard.tell.frost", word: "word.hazard.frost",
  },
  /**
   * Smoke to the bulkheads. Nobody sees in or out — the drone's SCANNER
   * shows nothing past the door and no machine spots the drone through it, so
   * the EMITTER and the turret are both blind and the blade and the shocker
   * are not. It is also the best cover on the ship, so the room gets `cover`.
   */
  smoke: {
    id: "smoke", level: 1, on: "room", glyph: "≈",
    counters: ["blade", "shocker", "cutter"],
    tell: "log.hazard.tell.smoke", word: "word.hazard.smoke",
    opaque: true, cover: true,
  },
  /**
   * A charge on the door. The first one through it — drone or machine — takes
   * the blast; for the drone that is `MINE_DAMAGE` into the module the step
   * exposed and one rung of the alert. The WELDER lifts it in `DEFUSE_TURNS`
   * (`systems/doors.ts`), and a machine walked into it first lifts it for you.
   */
  mine: {
    id: "mine", level: 2, on: "door", glyph: "^",
    counters: ["welder", "plating"],
    tell: "log.hazard.tell.mine", word: "word.hazard.mine",
  },
};

export const HAZARD_IDS: readonly HazardId[] = Object.keys(HAZARDS) as HazardId[];

export function isHazardId(id: unknown): id is HazardId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(HAZARDS, id);
}

/** The row for an id, or nothing for a string no row owns — a save can carry anything. */
export function hazardKind(id: string): HazardKind | undefined {
  return isHazardId(id) ? HAZARDS[id] : undefined;
}
