import { t, tId } from "../i18n.js";
import { moduleName, type ModuleId } from "./modules.js";
import type { Rig } from "../twist/rig.js";

/**
 * The three systems a derelict is neutralised by, as data (design-doc.md,
 * "Обезвредить корабль").
 *
 * One table, three rows: which compartment the system stands in, what it is
 * worked with, how many turns of it, how loud, what the log says and what the
 * charter pays on account. `systems/ship.ts` executes this and holds no number
 * of its own, so a balance pass is this file and nothing else.
 *
 * The type import above is erased at build time on purpose: content describes
 * the ship, it does not reach into the rack. Whether a module is aboard is one
 * `some` over the slots, the same shape `content/cards.ts` reads a rig with.
 */

export type ObjectiveId = "engine" | "core" | "terminal";

/** The mark the generator's cards leave for each system (`systems/populate.ts`). */
export type ObjectiveMark = "E" | "O" | "T";

/**
 * The character a system is drawn with in its box on the schematic.
 *
 * One character for all three, and deliberately not a letter. Every machine in
 * the bestiary is a letter (`content/monsters.ts`), and the ENFORCER's letter
 * was `E` — the same `E` the engine used to carry, which is how the owner's
 * fifth playtest read a red `E` in a compartment as the engine and walked into
 * the machine instead (docs/owner-queue.md, 4). A mark that is not a letter
 * cannot be misread as one, and which of the three systems a box holds is
 * something the compartment's own name and the panel's objective block already
 * say — the picture only has to answer "there is one in here".
 */
export const SYSTEM_GLYPH = "+";

/**
 * One way of raising a system: the thing it is worked with, for how long, and
 * how much of the ship hears it.
 *
 * A row of the table rather than a field of the spec, because the terminal has
 * two of them — a SPIKE for two turns, or a keycard for one and the card is
 * gone — and every other number about a system follows from which one the drone
 * can actually do.
 */
export interface ObjectiveJob {
  /** The module the work exposes, or the keycard, which exposes PLATING. */
  readonly tool: ModuleId | "key";
  /** Player turns in a row. Any other command breaks the job off. */
  readonly turns: number;
  /** Noise made on each of those turns. */
  readonly noise: number;
}

export interface ObjectiveSpec {
  readonly id: ObjectiveId;
  /** The mark a card writes for it; `systems/populate.ts` turns it into a system. */
  readonly mark: ObjectiveMark;
  /** Compartment kind it stands in (`content/zones.ts`). */
  readonly kind: string;
  /** English name in the log and in the action list. Screen: `objectiveName`. */
  readonly name: string;
  /** English of the panel's short form: `engine ✓ core · term ·`. */
  readonly short: string;
  /** Every way of raising it, in the order the drone should spend them. */
  readonly jobs: readonly ObjectiveJob[];
  /** The first job this drone can do right now, or nothing it can do. */
  needs(rig: Rig | undefined, keys: number): ObjectiveJob | undefined;
  /** Credits the charter pays on account for it. */
  readonly advance: number;
}

/** Credits per system. The rest of the charter is paid when the drone gets out. */
const ADVANCE = 15;

/** Is this module in the rack, whatever is left of it? */
function carries(rig: Rig | undefined, tool: ModuleId | "key"): boolean {
  return rig !== undefined && rig.slots.some((s) => s?.kind === tool);
}

/**
 * The first job the drone can pay for. A module has to be in the rack; the
 * keycard has to be on the drone.
 */
function firstAffordable(
  jobs: readonly ObjectiveJob[],
  rig: Rig | undefined,
  keys: number,
): ObjectiveJob | undefined {
  return jobs.find((job) => (job.tool === "key" ? keys > 0 : carries(rig, job.tool)));
}

/** A row of the table. `needs` is the same question for all three of them. */
function spec(s: Omit<ObjectiveSpec, "needs" | "advance">): ObjectiveSpec {
  return { ...s, advance: ADVANCE, needs: (rig, keys) => firstAffordable(s.jobs, rig, keys) };
}

/** The ion drive: a torch job, three turns, and the loudest thing aboard. */
export const ENGINE: ObjectiveSpec = spec({
  id: "engine",
  mark: "E",
  kind: "engineering",
  name: "ENGINE",
  short: "engine",
  jobs: [
    { tool: "cutter", turns: 3, noise: 8 },
    { tool: "welder", turns: 3, noise: 8 },
  ],
});

/** The reactor: two turns of a CELL, and the CELL is a point poorer for it. */
export const CORE: ObjectiveSpec = spec({
  id: "core",
  mark: "O",
  kind: "reactor",
  name: "CORE",
  short: "core",
  jobs: [{ tool: "cell", turns: 2, noise: 6 }],
});

/**
 * The main terminal: the SPIKE first, the keycard second.
 *
 * The card is a turn quicker and silent, and that is exactly why it is second —
 * it is also the only thing that opens a locked bulkhead without spending a
 * module, and there is one of it. The SPIKE comes back out of the terminal.
 */
export const TERMINAL: ObjectiveSpec = spec({
  id: "terminal",
  mark: "T",
  kind: "control",
  name: "TERMINAL",
  short: "term",
  jobs: [
    { tool: "spike", turns: 2, noise: 4 },
    { tool: "key", turns: 1, noise: 0 },
  ],
});

/** All three, in the order the panel prints them. */
export const OBJECTIVES: readonly ObjectiveSpec[] = [ENGINE, CORE, TERMINAL];

/** How many systems a derelict has to have online to be neutralised. */
export const OBJECTIVE_COUNT = OBJECTIVES.length;

/** The spec for a system standing in a compartment, by the kind `populate` gave it. */
export function objectiveSpec(id: string): ObjectiveSpec | undefined {
  return OBJECTIVES.find((o) => o.id === id);
}

/**
 * What a tool is called in the action list: modules by the name the panel uses,
 * the keycard by the only word the player has ever seen for it.
 */
export function toolName(tool: ModuleId | "key"): string {
  return tool === "key" ? t("word.keycard") : moduleName(tool);
}

/** What the log and the action list call one of the ship's three systems. */
export function objectiveName(o: ObjectiveSpec): string {
  return tId("system", o.id, o.name);
}

/** The panel's short form of it: `engine ✓ core · term ·`, four columns each. */
export function objectiveShort(o: ObjectiveSpec): string {
  return tId("system.short", o.id, o.short);
}

/** Said the turn it comes online, and the loudest good news a sortie gets. */
export function objectiveOnlineLine(o: ObjectiveSpec): string {
  return tId("log.system.online", o.id, o.name);
}

/** Which module a job puts under the next blow. A keycard is hands-on: PLATING. */
export function toolExposes(tool: ModuleId | "key"): ModuleId {
  return tool === "key" ? "plating" : tool;
}

/** Why a system cannot be worked on: `Needs a SPIKE or a keycard.` */
export function needsLine(o: ObjectiveSpec): string {
  const names = o.jobs.map((job) => t("word.a", { name: toolName(job.tool) }));
  const last = names[names.length - 1]!;
  const wanted =
    names.length === 1 ? last : t("word.or", { first: names.slice(0, -1).join(", "), last });
  return t("why.system.needs", { tools: wanted });
}
