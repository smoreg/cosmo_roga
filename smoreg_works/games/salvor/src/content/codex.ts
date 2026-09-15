import type { Key } from "./i18n/keys.js";
import type { ModuleId } from "./modules.js";

/**
 * What is happening here, as data: one card per thing aboard that a player can
 * meet without being told what it is.
 *
 * The owner asked for the standard teaching mode and described it exactly:
 * «при обнаружении конкретной проблемы сверху слева значок информации и
 * хоткей; активация открывает окошко, в котором ты можешь почитать, что здесь
 * происходит. Стандартный режим обучения: хочет — читает, не хочет — не
 * читает». So nothing here interrupts a turn, nothing here is a tutorial step,
 * and a run played without ever pressing `i` is the same run.
 *
 * A card is five questions, and they are the five the design report asks of
 * every hazard (`~/reports/salvor-hazards.html`): what this is, which move is
 * the wrong one, what on the rack helps, how it can be turned against the ship
 * if it can, and one line of the world. `modules` is the part the window makes
 * live — the ones actually in the rack are marked, so "what helps" is answered
 * for *this* drone rather than in general.
 *
 * Every field is a `Key`, never a sentence: `Key` is `keyof typeof EN`, so a
 * card written here and forgotten in Spanish or Russian does not compile. That
 * is the same enforcement the rest of the game's words get (`src/i18n.ts`), and
 * it is why this file holds no English at all.
 *
 * Ids are borrowed rather than invented, and that is what keeps the table
 * honest: a strain's id is `content/viruses.ts`'s, a relic's is
 * `content/modules.ts`'s, a machine's is `content/monsters.ts`'s, and a rung of
 * the alarm is `alert-<level>` off the ladder in `systems/alert.ts`. So
 * `tests/codex.test.ts` walks those tables and asks this one for a card,
 * exactly as `tests/content.test.ts` walks them asking for a band — a machine
 * added with no card is a red line rather than a silent hole.
 *
 * An id this table does not know answers `undefined`, and that is legal: the
 * hazards of G71 arrive with ids of their own (`content/hazards.ts`), and until
 * they land the window simply has nothing to say about them.
 *
 * Plain data. No rng, no DOM, nothing from `src/systems` — safe for the rules
 * and the screen alike to import (`tests/purity.test.ts`).
 */

/** What a card is addressed by: an id some other table already owns. */
export type CodexId = string;

export interface CodexEntry {
  readonly id: CodexId;
  /** The name across the top of the window. */
  readonly title: Key;
  /** What this thing is, in a sentence or two. */
  readonly what: Key;
  /** The move that costs, said as a move and not as a warning. */
  readonly wrong: Key;
  /** What to do instead. Read with `modules`, never instead of it. */
  readonly helps: Key;
  /**
   * Modules that answer this, whether or not the drone carries one. The window
   * marks the ones in the rack, so the line reads as advice rather than as a
   * shopping list.
   */
  readonly modules?: readonly ModuleId[];
  /** How it can be turned against the ship, for the ones that can. */
  readonly turn?: Key;
  /** One line of the world. The only line on the card that is not advice. */
  readonly lore: Key;
}

/** The rung of the alarm ladder at `level`, as this table addresses it. */
export function alertCodexId(level: number): CodexId {
  return `alert-${level}`;
}

/**
 * Every card, keyed by the id of the thing it explains.
 *
 * Grouped by where the ids come from rather than alphabetically: the four
 * strains, the five rungs and the vacuum they end in, the three relics, the two
 * drones that are not the ship's, and the machines a player meets without a
 * name for what they do.
 */
export const CODEX: Readonly<Record<CodexId, CodexEntry>> = {
  // ------------------------------------------------ the virus (content/viruses.ts)

  // A purge needs no module; the SPIKE is the one that halves it (G90). The
  // live window behind `v` says the same with this drone's own numbers.
  spasm: {
    id: "spasm",
    title: "codex.spasm.title",
    what: "codex.spasm.what",
    wrong: "codex.spasm.wrong",
    helps: "codex.spasm.helps",
    modules: ["spike"],
    lore: "codex.spasm.lore",
  },
  rot: {
    id: "rot",
    title: "codex.rot.title",
    what: "codex.rot.what",
    wrong: "codex.rot.wrong",
    helps: "codex.rot.helps",
    modules: ["spike"],
    turn: "codex.rot.turn",
    lore: "codex.rot.lore",
  },
  leech: {
    id: "leech",
    title: "codex.leech.title",
    what: "codex.leech.what",
    wrong: "codex.leech.wrong",
    helps: "codex.leech.helps",
    modules: ["spike"],
    lore: "codex.leech.lore",
  },
  leash: {
    id: "leash",
    title: "codex.leash.title",
    what: "codex.leash.what",
    wrong: "codex.leash.wrong",
    helps: "codex.leash.helps",
    modules: ["spike"],
    lore: "codex.leash.lore",
  },

  // ------------------------------------------- the ladder (systems/alert.ts)

  "alert-1": {
    id: "alert-1",
    title: "codex.alert-1.title",
    what: "codex.alert-1.what",
    wrong: "codex.alert-1.wrong",
    helps: "codex.alert-1.helps",
    modules: ["baffle"],
    lore: "codex.alert-1.lore",
  },
  "alert-2": {
    id: "alert-2",
    title: "codex.alert-2.title",
    what: "codex.alert-2.what",
    wrong: "codex.alert-2.wrong",
    helps: "codex.alert-2.helps",
    modules: ["scanner"],
    lore: "codex.alert-2.lore",
  },
  "alert-3": {
    id: "alert-3",
    title: "codex.alert-3.title",
    what: "codex.alert-3.what",
    wrong: "codex.alert-3.wrong",
    helps: "codex.alert-3.helps",
    modules: ["scanner", "welder"],
    lore: "codex.alert-3.lore",
  },
  "alert-4": {
    id: "alert-4",
    title: "codex.alert-4.title",
    what: "codex.alert-4.what",
    wrong: "codex.alert-4.wrong",
    helps: "codex.alert-4.helps",
    modules: ["welder", "scanner"],
    lore: "codex.alert-4.lore",
  },
  "alert-5": {
    id: "alert-5",
    title: "codex.alert-5.title",
    what: "codex.alert-5.what",
    wrong: "codex.alert-5.wrong",
    helps: "codex.alert-5.helps",
    modules: ["welder", "thrusters"],
    turn: "codex.alert-5.turn",
    lore: "codex.alert-5.lore",
  },
  "alert-6": {
    id: "alert-6",
    title: "codex.alert-6.title",
    what: "codex.alert-6.what",
    wrong: "codex.alert-6.wrong",
    helps: "codex.alert-6.helps",
    modules: ["welder", "thrusters"],
    lore: "codex.alert-6.lore",
  },
  "alert-7": {
    id: "alert-7",
    title: "codex.alert-7.title",
    what: "codex.alert-7.what",
    wrong: "codex.alert-7.wrong",
    helps: "codex.alert-7.helps",
    modules: ["cutter", "blade", "emp", "shocker"],
    turn: "codex.alert-7.turn",
    lore: "codex.alert-7.lore",
  },
  "alert-8": {
    id: "alert-8",
    title: "codex.alert-8.title",
    what: "codex.alert-8.what",
    wrong: "codex.alert-8.wrong",
    helps: "codex.alert-8.helps",
    modules: ["cutter", "cell", "spike"],
    turn: "codex.alert-8.turn",
    lore: "codex.alert-8.lore",
  },
  "alert-9": {
    id: "alert-9",
    title: "codex.alert-9.title",
    what: "codex.alert-9.what",
    wrong: "codex.alert-9.wrong",
    helps: "codex.alert-9.helps",
    modules: ["thrusters", "scanner"],
    turn: "codex.alert-9.turn",
    lore: "codex.alert-9.lore",
  },
  "alert-10": {
    id: "alert-10",
    title: "codex.alert-10.title",
    what: "codex.alert-10.what",
    wrong: "codex.alert-10.wrong",
    helps: "codex.alert-10.helps",
    modules: ["thrusters"],
    turn: "codex.alert-10.turn",
    lore: "codex.alert-10.lore",
  },
  blown: {
    id: "blown",
    title: "codex.blown.title",
    what: "codex.blown.what",
    wrong: "codex.blown.wrong",
    helps: "codex.blown.helps",
    modules: ["cutter", "thrusters"],
    lore: "codex.blown.lore",
  },

  // ------------------------------------------ the relics (content/modules.ts)

  blade: {
    id: "blade",
    title: "codex.blade.title",
    what: "codex.blade.what",
    wrong: "codex.blade.wrong",
    helps: "codex.blade.helps",
    modules: ["blade"],
    lore: "codex.blade.lore",
  },
  shocker: {
    id: "shocker",
    title: "codex.shocker.title",
    what: "codex.shocker.what",
    wrong: "codex.shocker.wrong",
    helps: "codex.shocker.helps",
    modules: ["shocker"],
    lore: "codex.shocker.lore",
  },
  lattice: {
    id: "lattice",
    title: "codex.lattice.title",
    what: "codex.lattice.what",
    wrong: "codex.lattice.wrong",
    helps: "codex.lattice.helps",
    modules: ["lattice"],
    lore: "codex.lattice.lore",
  },

  // --------------------------- the two drones that are not the ship's own

  ghost: {
    id: "ghost",
    title: "codex.ghost.title",
    what: "codex.ghost.what",
    wrong: "codex.ghost.wrong",
    helps: "codex.ghost.helps",
    turn: "codex.ghost.turn",
    lore: "codex.ghost.lore",
  },
  rival: {
    id: "rival",
    title: "codex.rival.title",
    what: "codex.rival.what",
    wrong: "codex.rival.wrong",
    helps: "codex.rival.helps",
    turn: "codex.rival.turn",
    lore: "codex.rival.lore",
  },

  // ---------------------------------------- the machines (content/monsters.ts)

  "sentry-turret": {
    id: "sentry-turret",
    title: "codex.sentry-turret.title",
    what: "codex.sentry-turret.what",
    wrong: "codex.sentry-turret.wrong",
    helps: "codex.sentry-turret.helps",
    modules: ["emp", "shocker"],
    lore: "codex.sentry-turret.lore",
  },
  jammer: {
    id: "jammer",
    title: "codex.jammer.title",
    what: "codex.jammer.what",
    wrong: "codex.jammer.wrong",
    helps: "codex.jammer.helps",
    modules: ["blade"],
    lore: "codex.jammer.lore",
  },
  bloom: {
    id: "bloom",
    title: "codex.bloom.title",
    what: "codex.bloom.what",
    wrong: "codex.bloom.wrong",
    helps: "codex.bloom.helps",
    turn: "codex.bloom.turn",
    lore: "codex.bloom.lore",
  },
  crawler: {
    id: "crawler",
    title: "codex.crawler.title",
    what: "codex.crawler.what",
    wrong: "codex.crawler.wrong",
    helps: "codex.crawler.helps",
    lore: "codex.crawler.lore",
  },
  scout: {
    id: "scout",
    title: "codex.scout.title",
    what: "codex.scout.what",
    wrong: "codex.scout.wrong",
    helps: "codex.scout.helps",
    modules: ["emitter"],
    lore: "codex.scout.lore",
  },
  // The three that kill most often (docs/problem-map-2026-09-11.md): the
  // alarm's hunter, the guard every hull carries, and the deep hulls' pack.
  // What they do is plain enough; what the player gets wrong is not.
  enforcer: {
    id: "enforcer",
    title: "codex.enforcer.title",
    what: "codex.enforcer.what",
    wrong: "codex.enforcer.wrong",
    helps: "codex.enforcer.helps",
    modules: ["cutter", "blade", "emp", "shocker"],
    lore: "codex.enforcer.lore",
  },
  "security-unit": {
    id: "security-unit",
    title: "codex.security-unit.title",
    what: "codex.security-unit.what",
    wrong: "codex.security-unit.wrong",
    helps: "codex.security-unit.helps",
    modules: ["cutter", "welder"],
    lore: "codex.security-unit.lore",
  },
  scrapper: {
    id: "scrapper",
    title: "codex.scrapper.title",
    what: "codex.scrapper.what",
    wrong: "codex.scrapper.wrong",
    helps: "codex.scrapper.helps",
    modules: ["emp"],
    lore: "codex.scrapper.lore",
  },

  // ------------------------------------------ the hazards (content/hazards.ts)
  //
  // Addressed by the hazard's own id, which is what the red line's key
  // carries (`log.hazard.tell.<id>`, `systems/hazards.ts`) — so `i` after a
  // red line opens the card for that very hazard. `modules` mirrors the row's
  // `counters`, written out so this file stays a table of nothing but keys.

  frost: {
    id: "frost",
    title: "codex.frost.title",
    what: "codex.frost.what",
    wrong: "codex.frost.wrong",
    helps: "codex.frost.helps",
    modules: ["cell", "thrusters"],
    lore: "codex.frost.lore",
  },
  smoke: {
    id: "smoke",
    title: "codex.smoke.title",
    what: "codex.smoke.what",
    wrong: "codex.smoke.wrong",
    helps: "codex.smoke.helps",
    modules: ["blade", "shocker", "cutter"],
    turn: "codex.smoke.turn",
    lore: "codex.smoke.lore",
  },
  mine: {
    id: "mine",
    title: "codex.mine.title",
    what: "codex.mine.what",
    wrong: "codex.mine.wrong",
    helps: "codex.mine.helps",
    modules: ["welder", "plating"],
    turn: "codex.mine.turn",
    lore: "codex.mine.lore",
  },
};

/** Every id this table has a card for, in table order. */
export const CODEX_IDS: readonly CodexId[] = Object.keys(CODEX);

/**
 * The card for an id, or nothing at all.
 *
 * Nothing is a legal answer and always will be: the alarm carries ids from
 * tables this one does not have to know about, and a window that threw at an
 * unknown one would make every new hazard a crash rather than a silence.
 */
export function codexFor(id: string | undefined): CodexEntry | undefined {
  if (id === undefined) return undefined;
  return Object.hasOwn(CODEX, id) ? CODEX[id] : undefined;
}
