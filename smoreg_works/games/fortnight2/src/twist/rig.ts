import {
  TURN_COST,
  applyStatus,
  candidates,
  chebyshev,
  dealDamage,
  decay,
  effectiveDefense,
  isAlive,
  label,
  type Command,
  type Entity,
  type Game,
  type Outcome,
  type Point,
  type Twist,
} from "@jamrog/engine";
import {
  BARE_CHASSIS,
  HINTS,
  SCRAP_INTEGRITY,
  STARTING_MODULES,
  hitLine,
  moduleKind,
  type ModuleId,
} from "../content/modules.js";
import { machineByName } from "../content/monsters.js";
import { THEME } from "../ui/theme.js";

/**
 * The twist: the drone has no armour, it has abilities, and a blow lands on
 * whatever ability it just used (design-doc.md, "Правило урона").
 *
 * Everything below the twist object is a pure function over `Rig` — no Game,
 * no DOM, no randomness — so the damage routing can be tested a case at a time
 * instead of through a lucky seed.
 */

export const SLOT_COUNT = 6;

/** One installed module. Plain data: it lives in `player.data` and serialises. */
export interface Slot {
  kind: ModuleId;
  integrity: number;
  /** Only for modules that spend charges (EMP). G4 reads it. */
  charges?: number;
}

export interface Rig {
  /** Six slots; null is an empty one, whether it was ever filled or not. */
  slots: Array<Slot | null>;
  /** Slot index the next blow lands on, or null when the chain starts at PLATING. */
  exposed: number | null;
  /** Modules lost this run. Mirrors `burned.length`; the death screen wants a count. */
  burnedCount: number;
  /** Which kinds burned, in order. Storylet preconditions read this (G7). */
  burned: ModuleId[];
  /** Per slot, what burned there last: tells `-- burned --` from `-- empty --`. */
  scars: Array<ModuleId | null>;
  /**
   * Set when the player's own blow landed this turn. The engine reports
   * bump-to-attack as a `move` command, so this is the only way to tell a step
   * from a swing when exposure is decided. Cleared by `expose`.
   */
  bumped: boolean;
}

export interface RigHit {
  slot: number;
  kind: ModuleId;
  amount: number;
  /** Integrity left after the blow; 0 when it burned. */
  remaining: number;
  burned: boolean;
}

export interface DamageRoute {
  hits: RigHit[];
  /** What reached CORE after the rack took its share. */
  toCore: number;
}

export interface DerivedStats {
  speed: number;
  fovRadius: number;
  damage: [number, number, number];
  /** Taken off every noise the drone makes this turn. BAFFLE, or 0. */
  noisePenalty: number;
  /** Taken off the radius at which a machine notices the drone. BAFFLE, or 0. */
  machineFovPenalty: number;
}

export interface RepairResult {
  slot: number;
  kind: ModuleId;
  integrity: number;
  max: number;
}

// ------------------------------------------------------------------ the rack

export function makeStartingRig(): Rig {
  const slots: Array<Slot | null> = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const id = STARTING_MODULES[i];
    slots.push(id ? makeSlot(id, moduleKind(id).integrity) : null);
  }
  return {
    slots,
    exposed: null,
    burnedCount: 0,
    burned: [],
    scars: new Array<ModuleId | null>(SLOT_COUNT).fill(null),
    bumped: false,
  };
}

function makeSlot(kind: ModuleId, integrity: number): Slot {
  const k = moduleKind(kind);
  const slot: Slot = { kind, integrity: clamp(integrity, 1, k.integrity) };
  if (k.charges !== undefined) slot.charges = k.charges;
  return slot;
}

/** Index of the first intact module of this kind, or null. */
export function findSlot(rig: Rig, kind: ModuleId): number | null {
  for (let i = 0; i < rig.slots.length; i++) {
    if (rig.slots[i]?.kind === kind) return i;
  }
  return null;
}

/** Put a salvaged module in the first empty slot. Returns its index. */
export function install(rig: Rig, kind: ModuleId, integrity: number): number | undefined {
  const i = rig.slots.findIndex((s) => s === null);
  if (i < 0) return undefined;
  rig.slots[i] = makeSlot(kind, integrity);
  rig.scars[i] = null;
  return i;
}

/**
 * Mend the most damaged intact module, never past its full integrity.
 * `exclude` keeps the welder from welding itself.
 */
export function repair(rig: Rig, exclude?: number, amount = 1): RepairResult | undefined {
  let best: number | null = null;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (!slot || i === exclude) continue;
    if (slot.integrity >= moduleKind(slot.kind).integrity) continue;
    if (best === null || slot.integrity < rig.slots[best]!.integrity) best = i;
  }
  if (best === null) return undefined;

  const slot = rig.slots[best]!;
  const max = moduleKind(slot.kind).integrity;
  slot.integrity = Math.min(max, slot.integrity + amount);
  return { slot: best, kind: slot.kind, integrity: slot.integrity, max };
}

// ------------------------------------------------------------------ exposure

/**
 * Mark what the last command put at risk. Called only after a command that
 * actually resolved: a refused key costs no turn and moves no marker.
 */
export function expose(rig: Rig, cmd: Command): number | null {
  rig.exposed = exposureFor(rig, cmd);
  rig.bumped = false;
  return rig.exposed;
}

function exposureFor(rig: Rig, cmd: Command): number | null {
  switch (cmd.kind) {
    case "attack":
      return attackExposure(rig);
    case "move":
      // A step that resolved into a swing is a swing.
      return rig.bumped ? attackExposure(rig) : findSlot(rig, "thrusters");
    case "wait":
    case "interact":
      return findSlot(rig, "plating");
    case "use":
      return rig.slots[cmd.slot] ? cmd.slot : null;
    case "descend":
      // The deck changes under the marker; nothing is exposed.
      return null;
  }
}

/** Swinging risks the weapon, or the thrusters that carried the ram. */
function attackExposure(rig: Rig): number | null {
  return findSlot(rig, "cutter") ?? findSlot(rig, "laser") ?? findSlot(rig, "thrusters");
}

// -------------------------------------------------------------------- damage

/**
 * Where a blow lands: exposed module, then plating, then core, spilling on.
 * `precise` picks the weakest module instead of the exposed one; `burst` puts
 * one point in every intact module and never reaches the core.
 */
export function routeDamage(rig: Rig, raw: number, tags: readonly string[] = []): DamageRoute {
  const hits: RigHit[] = [];
  if (raw <= 0) return { hits, toCore: 0 };

  if (tags.includes("burst")) {
    for (let i = 0; i < rig.slots.length; i++) {
      if (rig.slots[i]) hits.push(hitSlot(rig, i, 1));
    }
    return { hits, toCore: 0 };
  }

  let left = raw;
  for (const i of tags.includes("precise") ? preciseChain(rig) : normalChain(rig)) {
    if (left <= 0) break;
    const slot = rig.slots[i];
    if (!slot) continue;
    const take = Math.min(left, slot.integrity);
    left -= take;
    hits.push(hitSlot(rig, i, take));
  }
  return { hits, toCore: left };
}

/** The chain is fixed before the first module burns: spill only moves forward. */
function normalChain(rig: Rig): number[] {
  return chainFrom(rig, rig.exposed !== null && rig.slots[rig.exposed] ? rig.exposed : null);
}

function preciseChain(rig: Rig): number[] {
  return chainFrom(rig, weakestSlot(rig));
}

function chainFrom(rig: Rig, first: number | null): number[] {
  const chain: number[] = [];
  if (first !== null) chain.push(first);
  const plating = findSlot(rig, "plating");
  if (plating !== null && !chain.includes(plating)) chain.push(plating);
  return chain;
}

/** Weakest intact module; ties go to the lower slot. */
function weakestSlot(rig: Rig): number | null {
  let best: number | null = null;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (!slot) continue;
    if (best === null || slot.integrity < rig.slots[best]!.integrity) best = i;
  }
  return best;
}

function hitSlot(rig: Rig, i: number, amount: number): RigHit {
  const slot = rig.slots[i]!;
  const kind = slot.kind;
  slot.integrity -= amount;
  const burned = slot.integrity <= 0;
  const remaining = burned ? 0 : slot.integrity;
  if (burned) burnOut(rig, i);
  return { slot: i, kind, amount, remaining, burned };
}

function burnOut(rig: Rig, i: number): void {
  const slot = rig.slots[i]!;
  rig.slots[i] = null;
  rig.scars[i] = slot.kind;
  rig.burned.push(slot.kind);
  rig.burnedCount = rig.burned.length;
  if (rig.exposed === i) rig.exposed = null;
}

// ------------------------------------------------------------- derived stats

/**
 * The rack is the only source of truth for what the drone can do. Recomputed
 * whenever it changes and written straight onto the entity, so the scheduler
 * and FOV keep reading plain fields and know nothing about modules.
 */
export function derivedStats(rig: Rig): DerivedStats {
  const attack = intact(rig, "laser")?.attack ?? intact(rig, "cutter")?.attack ?? BARE_CHASSIS.damage;
  // A burned BAFFLE is a hole in the rack like any other: the two stealth
  // numbers drop to zero the turn it goes, with nothing to remember them by.
  const baffle = intact(rig, "baffle");
  return {
    speed: intact(rig, "thrusters")?.speed ?? BARE_CHASSIS.speed,
    fovRadius: intact(rig, "scanner")?.fov ?? BARE_CHASSIS.fovRadius,
    damage: [attack[0], attack[1], attack[2]],
    noisePenalty: baffle?.noisePenalty ?? 0,
    machineFovPenalty: baffle?.machineFovPenalty ?? 0,
  };
}

function intact(rig: Rig, kind: ModuleId) {
  return findSlot(rig, kind) === null ? undefined : moduleKind(kind);
}

export function rigOf(entity: Entity): Rig | undefined {
  return entity.data?.rig as Rig | undefined;
}

/**
 * Only the three stats the engine itself reads go onto the entity. The BAFFLE
 * pair stays in `derivedStats`: there is no engine field for "how loud I am"
 * or "how far away I am noticed", and inventing one on the player would make
 * every machine's `fovRadius` a lie that some other system would then read.
 */
export function applyDerived(player: Entity): void {
  const rig = rigOf(player);
  if (!rig) return;
  const stats = derivedStats(rig);
  player.speed = stats.speed;
  player.fovRadius = stats.fovRadius;
  player.damage = stats.damage;
}

// ------------------------------------------------------------- the wreckage

/** Salvage lying on a tile: a dead machine, or an untouched parts crate. */
export interface Wreck {
  x: number;
  y: number;
  kind: ModuleId;
  integrity: number;
  /** `%` for scrap, `X` for a crate. The renderer draws it, nothing else reads it. */
  glyph: string;
}

/**
 * What the current deck has lying on it.
 *
 * Wreckage belongs to the deck, not to the drone, but the player entity is the
 * only thing that survives `enterDepth` and the only thing that serialises —
 * so it is kept there and wiped by both level hooks instead.
 */
export interface Deck {
  wrecks: Wreck[];
}

export function deckOf(game: Game): Deck {
  const data = (game.player.data ??= {});
  const existing = data.deck as Deck | undefined;
  if (existing) return existing;
  const fresh: Deck = { wrecks: [] };
  data.deck = fresh;
  return fresh;
}

/** Drop salvage on a tile. One wreck per tile: a later one replaces the earlier. */
export function addWreck(game: Game, pos: Point, kind: ModuleId, integrity: number, glyph = "%"): Wreck {
  const wreck: Wreck = { x: pos.x, y: pos.y, kind, integrity, glyph };
  const wrecks = deckOf(game).wrecks;
  const i = wrecks.findIndex((w) => w.x === pos.x && w.y === pos.y);
  if (i < 0) wrecks.push(wreck);
  else wrecks[i] = wreck;
  return wreck;
}

export function wreckAt(game: Game, pos: Point): Wreck | undefined {
  return deckOf(game).wrecks.find((w) => w.x === pos.x && w.y === pos.y);
}

function removeWreck(game: Game, wreck: Wreck): void {
  const wrecks = deckOf(game).wrecks;
  const i = wrecks.indexOf(wreck);
  if (i >= 0) wrecks.splice(i, 1);
}

/**
 * Under the drone first, then the neighbours in reading order. Deliberately not
 * a prompt: `g` is one keypress with one meaning, and standing on the pile you
 * want is the cost of choosing between two (design-doc.md, "Клавиши").
 */
function wreckWithinReach(game: Game): Wreck | undefined {
  const p = game.player.pos;
  const here = wreckAt(game, p);
  if (here) return here;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const w = wreckAt(game, { x: p.x + dx, y: p.y + dy });
      if (w) return w;
    }
  }
  return undefined;
}

/**
 * `g`: pull a module out of the wreck and into an empty slot.
 *
 * Returns undefined — "not my command" — when there is nothing to take, so the
 * key costs no turn on a deck full of nothing.
 */
function salvage(game: Game): Outcome | undefined {
  const rig = rigOf(game.player);
  if (!rig) return undefined;
  const wreck = wreckWithinReach(game);
  if (!wreck) return undefined;

  const slot = install(rig, wreck.kind, wreck.integrity);
  if (slot === undefined) return { ok: false, cost: 0, reason: "No free slot. Something has to burn first." };

  removeWreck(game, wreck);
  applyDerived(game.player);
  const kind = moduleKind(wreck.kind);
  game.log.add(
    `You pull a ${kind.name} (${rig.slots[slot]!.integrity}/${kind.integrity}) from the wreck.`,
    game.schedule.time,
    "good",
  );
  return { ok: true, cost: TURN_COST };
}

// -------------------------------------------------------- the active modules

/** Numbers from design-doc.md, "Что игрок делает клавишами". */
const PULSE_RADIUS = 14;
const PULSE_NOISE = 8;
const EMP_RADIUS = 1;
const EMP_STUN_TURNS = 3;
const EMP_NOISE = 6;
const WELD_NOISE = 5;
const SPIKE_NOISE = 4;
const EMITTER_NOISE = 7;

// ------------------------------------------------------------------ breaching

/**
 * Something a SPIKE can cut its way into: a locked bulkhead (G14), a ship
 * system or a terminal (G17).
 *
 * Work in progress is the target's own state, not the rig's — `hackTargetAt`
 * hands back the same live object every turn until it opens, and whoever owns
 * it is responsible for keeping `turnsLeft` somewhere that survives a save
 * (`player.data`, the way this file keeps the rack).
 */
/**
 * What a breach costs in player turns, for the providers to start their
 * targets at. A keycard is the shortcut that costs one instead (G14).
 */
export const SPIKE_TURNS = 2;

export interface HackTarget {
  /** How the log names it: `You spike the main terminal open.` */
  readonly name: string;
  /** Player turns of spiking still to spend. Reaches 0 exactly once. */
  turnsLeft: number;
  /** Everything the breach changes. Called on the turn `turnsLeft` hits 0. */
  breach(game: Game): void;
}

/** Asked about one tile; returns a target only if this provider owns it. */
export type HackTargetSource = (game: Game, pos: Point) => HackTarget | undefined;

const HACK_SOURCES: HackTargetSource[] = [];

/**
 * Register what the SPIKE can open. Called at import time by the content that
 * owns the thing — locks, ship systems — so this file never learns their names.
 */
export function registerHackTarget(source: HackTargetSource): void {
  HACK_SOURCES.push(source);
}

/**
 * What is breachable on this tile, if anything. First provider wins.
 *
 * Today nothing registers, so the SPIKE always refuses and costs no turn: the
 * module is finished, the things worth breaching are not built yet.
 */
export function hackTargetAt(game: Game, pos: Point): HackTarget | undefined {
  for (const source of HACK_SOURCES) {
    const target = source(game, pos);
    if (target) return target;
  }
  return undefined;
}

/** Under the drone first, then the neighbours in reading order — as with `g`. */
function hackTargetWithinReach(game: Game): HackTarget | undefined {
  const p = game.player.pos;
  const here = hackTargetAt(game, p);
  if (here) return here;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const t = hackTargetAt(game, { x: p.x + dx, y: p.y + dy });
      if (t) return t;
    }
  }
  return undefined;
}

/** `s`, `e`, `w`: what the slot holds decides what the key does. */
function useModule(game: Game, cmd: Extract<Command, { kind: "use" }>): Outcome {
  const rig = rigOf(game.player);
  const slot = rig?.slots[cmd.slot];
  if (!rig || !slot) return { ok: false, cost: 0, reason: "Empty slot." };

  switch (slot.kind) {
    case "scanner":
      return pulse(game);
    case "emp":
      return dischargeEmp(game, slot);
    case "welder":
      return weld(game, rig, cmd.slot);
    case "spike":
      return breach(game);
    case "emitter":
      return shoot(game, slot);
    default:
      return { ok: false, cost: 0, reason: "That module has no active use." };
  }
}

/**
 * `K`: work the SPIKE into whatever is locked under or beside the drone.
 *
 * Two turns of it, and both of them expose the SPIKE — that is the whole cost
 * of opening a door without a key: standing still, twice, next to something
 * that may be walking towards you.
 */
function breach(game: Game): Outcome {
  const target = hackTargetWithinReach(game);
  if (!target) return { ok: false, cost: 0, reason: "Nothing to breach here." };

  target.turnsLeft = Math.max(0, target.turnsLeft - 1);
  game.makeNoise(game.player.pos, SPIKE_NOISE);

  if (target.turnsLeft > 0) {
    game.log.add(`You work the SPIKE into the ${target.name}.`, game.schedule.time, "plain");
    return { ok: true, cost: TURN_COST };
  }

  target.breach(game);
  game.log.add(`The ${target.name} gives. You are through.`, game.schedule.time, "good");
  return { ok: true, cost: TURN_COST };
}

/**
 * EMITTER: one shot at the nearest machine in range, no cursor and no mode.
 *
 * Nearest, not chosen: design-doc.md rules out a targeting cursor, and the
 * choice the game wants from the player is not *which* machine but *whether*
 * to fire at all — a shot exposes the EMITTER and is louder than a fight.
 */
function shoot(game: Game, slot: Slot): Outcome {
  const kind = moduleKind(slot.kind);
  const range = kind.range ?? 1;
  const dice = kind.attack ?? BARE_CHASSIS.damage;

  const target = candidates(
    { level: game.level, entities: game.entities, self: game.player },
    { kind: "ranged", range },
  )[0];
  // Out of range, out of sight or behind a wall are one refusal: `candidates`
  // already applies all three, and none of them should cost a turn.
  if (!target) return { ok: false, cost: 0, reason: "Nothing in range." };

  const raw = game.rng.roll(dice[0], dice[1]) + dice[2];
  const res = dealDamage(game, target, Math.max(1, raw - effectiveDefense(target)), game.player);
  game.makeNoise(game.player.pos, EMITTER_NOISE);
  game.log.add(`Your EMITTER hits ${label(game, target)} for ${res.toHp}.`, game.schedule.time, "good");
  if (res.killed) {
    game.log.add(`${capitalize(label(game, target))} dies.`, game.schedule.time, "good");
    game.onDeath(target);
  }
  return { ok: true, cost: TURN_COST };
}

/**
 * Sensor pulse: the map remembers a square of deck, walls included, but nothing
 * becomes *visible* — FOV is untouched, so the pulse tells you the shape of the
 * deck and never where the machines are. And it is loud enough to raise the alert.
 */
function pulse(game: Game): Outcome {
  const p = game.player.pos;
  for (let y = p.y - PULSE_RADIUS; y <= p.y + PULSE_RADIUS; y++) {
    for (let x = p.x - PULSE_RADIUS; x <= p.x + PULSE_RADIUS; x++) {
      // Grid.set drops out-of-bounds writes, so no clamping is needed here.
      game.level.explored.set(x, y, true);
    }
  }
  game.makeNoise(p, PULSE_NOISE);
  game.log.add("Sensor pulse. The deck lights up on your map.", game.schedule.time, "warn");
  return { ok: true, cost: TURN_COST };
}

/** EMP: three turns of stun on everything adjacent, twice per module. */
function dischargeEmp(game: Game, slot: Slot): Outcome {
  if ((slot.charges ?? 0) <= 0) return { ok: false, cost: 0, reason: "EMP is spent." };

  const targets = game.entities.filter(
    (e) =>
      e.id !== game.player.id &&
      e.faction !== game.player.faction &&
      isAlive(e) &&
      chebyshev(e.pos, game.player.pos) <= EMP_RADIUS,
  );
  // A charge is too scarce to spend on empty air; the key stays free instead.
  if (targets.length === 0) return { ok: false, cost: 0, reason: "Nothing in range." };

  for (const m of targets) applyStatus(m, "stun", EMP_STUN_TURNS);
  slot.charges = (slot.charges ?? 0) - 1;
  game.makeNoise(game.player.pos, EMP_NOISE);
  game.log.add(
    `The coil discharges. ${targets.length === 1 ? "One machine seizes" : `${targets.length} machines seize`} up. ${slot.charges} left.`,
    game.schedule.time,
    "good",
  );
  return { ok: true, cost: TURN_COST };
}

/** Welder: the run's only way back up, one point at a time, never on itself. */
function weld(game: Game, rig: Rig, self: number): Outcome {
  const mend = repair(rig, self);
  if (!mend) return { ok: false, cost: 0, reason: "Nothing to repair." };

  game.makeNoise(game.player.pos, WELD_NOISE);
  game.log.add(
    `You weld the ${moduleKind(mend.kind).name} back to ${mend.integrity}/${mend.max}.`,
    game.schedule.time,
    "good",
  );
  return { ok: true, cost: TURN_COST };
}

// ---------------------------------------------------------------- the twist

export const RIG: Twist = {
  name: "rig",

  onRunStart(game) {
    game.player.data = { ...(game.player.data ?? {}), rig: makeStartingRig(), hints: {} };
    applyDerived(game.player);
  },

  onLevelEnter(game) {
    deckOf(game).wrecks = [];
  },

  /** Wreckage is the deck's, not the drone's: what you leave behind is gone. */
  beforeLevelLeave(game) {
    deckOf(game).wrecks = [];
  },

  onDeath(game, victim) {
    if (victim.id === game.player.id) return;
    const kind = machineByName(victim.name)?.salvage;
    if (!kind) return;
    addWreck(game, victim.pos, kind, game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]));
    game.log.add(`The ${victim.name} collapses into scrap.`, game.schedule.time, "plain");
  },

  afterPlayerTurn(game, cmd) {
    const rig = rigOf(game.player);
    if (!rig) return;
    expose(rig, cmd);
    muffle(game, rig);

    // The two rules the deck teaches by putting them in front of the drone
    // rather than by taking something away.
    if (wreckWithinReach(game)) hint(game, "scrap", HINTS.scrap);
    if (findSlot(rig, "scanner") === null) hint(game, "blind", HINTS.blind);
  },

  onDamage(game, victim, amount, source) {
    if (victim.id !== game.player.id) {
      // Remember that the swing connected, so a bump reads as an attack.
      if (source?.id === game.player.id) {
        const rig = rigOf(game.player);
        if (rig) rig.bumped = true;
      }
      return amount;
    }

    const rig = rigOf(game.player);
    if (!rig) return amount;

    const route = routeDamage(rig, amount, source?.tags ?? []);
    const who = capitalize(source ? label(game, source) : "Something");
    let burned = false;
    for (const hit of route.hits) {
      const kind = moduleKind(hit.kind);
      game.log.add(hitLine(who, kind, hit.remaining), game.schedule.time, "bad");
      if (hit.burned) {
        game.log.add(kind.burnLine, game.schedule.time, "bad");
        burned = true;
      }
    }
    if (burned) applyDerived(game.player);

    if (route.hits.length > 0) hint(game, "exposure", HINTS.exposure);
    if (burned) hint(game, "burned", HINTS.burned);
    return route.toCore;
  },

  panelLines(game) {
    const player = game.player;
    const lines = [{ text: `CORE  ${dots(player.hp, player.hpMax)}`, fg: coreColour(player) }];
    const rig = rigOf(player);
    if (!rig) return lines;

    for (let i = 0; i < rig.slots.length; i++) {
      const slot = rig.slots[i];
      if (!slot) {
        const burned = rig.scars[i] !== null;
        lines.push({
          text: `${i + 1} ${burned ? "-- burned --" : "-- empty --"}`,
          fg: burned ? THEME.burned : THEME.fgDim,
        });
        continue;
      }
      const kind = moduleKind(slot.kind);
      const bars = "▮".repeat(slot.integrity) + "▯".repeat(kind.integrity - slot.integrity);
      const exposed = rig.exposed === i;
      lines.push({
        text: `${i + 1} ${kind.name.padEnd(10)}${bars}${exposed ? "  ◀" : ""}`,
        fg: exposed ? THEME.accent : THEME.fg,
      });
    }
    return lines;
  },

  /**
   * The two verbs the engine leaves to the game: `g` takes a module out of a
   * wreck, `s`/`e`/`w` spend one that is already in the rack. Anything else —
   * and anyone but the player — falls through to the next system.
   */
  performCommand(game: Game, actor: Entity, cmd: Command): Outcome | undefined {
    if (actor.id !== game.player.id) return undefined;
    if (cmd.kind === "interact") return salvage(game);
    if (cmd.kind === "use") return useModule(game, cmd);
    return undefined;
  },

  /**
   * What a competent player does with `g`, `e` and `w`, spelled out for the
   * balance bots — which otherwise measure a drone that never repairs and never
   * picks anything up (packages/engine/src/sim/twist.ts, `botHints`).
   *
   * SCANNER is deliberately never offered: its pulse is exactly as loud as the
   * alert's threshold, so a bot that mapped the deck every turn would be
   * measuring the alert instead of the rack.
   */
  botHints(game) {
    const rig = rigOf(game.player);
    if (!rig) return { interactWorthIt: false, useSlots: [] };

    const adjacent = machinesWithin(game, EMP_RADIUS);
    const useSlots: number[] = [];

    // Two machines already in reach is what a charge is for; one is a fight.
    const emp = findSlot(rig, "emp");
    if (emp !== null && adjacent >= 2 && (rig.slots[emp]!.charges ?? 0) > 0) useSlots.push(emp);

    // Welding is five points of noise and a turn not spent moving: only with
    // nothing in sight, and only when there is something left to mend.
    const welder = findSlot(rig, "welder");
    if (welder !== null && visibleMachines(game) === 0 && repairable(rig, welder)) useSlots.push(welder);

    // Salvage is free integrity, but not with something swinging at you: the
    // turn spent bent over the wreck exposes PLATING.
    const interactWorthIt =
      adjacent === 0 && rig.slots.some((s) => s === null) && wreckWithinReach(game) !== undefined;

    return { interactWorthIt, useSlots };
  },

  overlayGlyphs(game) {
    // Remembered: a pile you walked past is worth walking back to.
    return deckOf(game).wrecks.map((w) => ({
      x: w.x,
      y: w.y,
      ch: w.glyph,
      fg: THEME.accent,
      remembered: true,
    }));
  },
};

/**
 * The BAFFLE, applied in one place: this turn's noise, three tiles quieter.
 *
 * Subtracting from the settled field is not an approximation of a quieter
 * source, it is the same field — `propagate` loses one point per tile, so a
 * source of 8 reads 8-d at distance d and taking 3 off every tile is exactly
 * a source of 5. And the drone is the only thing on the deck that makes any:
 * the engine's own noise is the player's command (sim/game.ts `commandNoise`)
 * and the other three sources are the modules above.
 *
 * It runs before ALERT.afterPlayerTurn because the twist is systems[0], which
 * is what makes the muffled field the one the alert hears.
 */
function muffle(game: Game, rig: Rig): void {
  const penalty = derivedStats(rig).noisePenalty;
  if (penalty > 0) decay(game.noiseField, penalty);
}

// ----------------------------------------------------------- reading the deck

function machinesWithin(game: Game, radius: number): number {
  return game.entities.filter(
    (e) =>
      e.id !== game.player.id &&
      e.faction !== game.player.faction &&
      isAlive(e) &&
      chebyshev(e.pos, game.player.pos) <= radius,
  ).length;
}

function visibleMachines(game: Game): number {
  return game.entities.filter(
    (e) =>
      e.id !== game.player.id &&
      e.faction !== game.player.faction &&
      isAlive(e) &&
      game.level.visible.get(e.pos.x, e.pos.y) === true,
  ).length;
}

/** Is there anything the welder could mend, other than itself? */
function repairable(rig: Rig, self: number): boolean {
  return rig.slots.some(
    (s, i) => s !== null && i !== self && s.integrity < moduleKind(s.kind).integrity,
  );
}

// -------------------------------------------------------------------- pieces

/**
 * One onboarding line, said once per run.
 *
 * The flags live on the player rather than in `game.flags` for the same reason
 * the rack does: the player entity is what carries between decks and what
 * serialises, so a reloaded run does not start explaining itself again.
 */
function hint(game: Game, flag: string, text: string): void {
  const said = hintsOf(game.player);
  if (said[flag] === true) return;
  said[flag] = true;
  game.log.add(text, game.schedule.time, "warn");
}

function hintsOf(player: Entity): Record<string, boolean> {
  const data = (player.data ??= {});
  const existing = data.hints as Record<string, boolean> | undefined;
  if (existing) return existing;
  const fresh: Record<string, boolean> = {};
  data.hints = fresh;
  return fresh;
}

function coreColour(player: Entity): string {
  return player.hp <= 1 ? THEME.hpLow : THEME.fg;
}

function dots(hp: number, max: number): string {
  return "●".repeat(Math.max(0, hp)) + "○".repeat(Math.max(0, max - hp));
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
