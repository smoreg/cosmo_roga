import {
  TURN_COST,
  applyStatus,
  canSee,
  dealDamage,
  effectiveDefense,
  isAlive,
  scanRooms,
  type ActionOffer,
  type Entity,
  type Outcome,
  type RoomCommand,
  type RoomGame,
  type RoomId,
  type Ship,
  type Twist,
} from "@jamrog/engine";
import {
  BARE_CHASSIS,
  MAX_GRAFT,
  SCRAP_INTEGRITY,
  SHOCK_STUN_TURNS,
  STARTING_MODULES,
  hitLine,
  isRelic,
  moduleBurnLine,
  moduleKind,
  moduleName,
  type ModuleId,
} from "../content/modules.js";
import { hint } from "../content/hints.js";
import type { Key } from "../content/i18n/keys.js";
import { specOfShip } from "../content/derelicts.js";
import { machineByName, machineName } from "../content/monsters.js";
import { PALETTE } from "../content/palette.js";
import { roomName } from "../content/zones.js";
import { t } from "../i18n.js";
import { capitalize, entityLabel } from "../names.js";
import { jammed } from "../systems/jam.js";
import { tryInfect } from "../systems/virus.js";

/**
 * The twist: the drone has no armour, it has abilities, and a blow lands on
 * whatever ability it just used (design-doc.md, "Твист").
 *
 * The rule did not change when the game moved off tiles — the routing, the
 * spill, the burn-out and the derived stats are the same functions over the
 * same numbers. What changed is only *what a command puts at risk* (the table
 * in "Ход и действия", read by `exposureFor`) and *where wreckage lies*: a
 * compartment holds it now, so it survives the drone leaving and coming back.
 *
 * Everything below the twist object is a pure function over `Rig` — no game, no
 * DOM, no randomness — so the damage routing can be tested a case at a time
 * instead of through a lucky seed.
 */

/**
 * Slots on a rack nobody named a hull for. The hulls carry their own
 * (`HullKind.slots`): six, seven and eight, and the difference is what the
 * price buys.
 */
export const SLOT_COUNT = 6;

/**
 * Columns a rack line may use on the panel: `ui/theme.ts`'s `LAYOUT.sidebarWidth`
 * (29) less the gutter column `ui/panel.ts`'s `PANEL_WIDTH` also takes off. A
 * literal rather than that import, because the rules do not import the
 * renderer (`tests/purity.test.ts`) — `tests/panel.test.ts` and
 * `tests/i18n.test.ts` are what would notice the two drifting apart.
 */
const PANEL_LINE_WIDTH = 28;

/** One installed module. Plain data: it lives in `player.data` and serialises. */
export interface Slot {
  kind: ModuleId;
  integrity: number;
  /** Only for modules that spend charges (EMP). */
  charges?: number;
  /** Integrity grafted on top of the kind's base, 0..MAX_GRAFT. */
  bonus?: number;
  /**
   * This copy's own base integrity, when the hull it came bolted into says it
   * beats the catalogue's (`content/hulls.ts`: a SCRAPPER's PLATING is 11, a
   * GHOST's BAFFLE is 6). Absent = the catalogue's number, which is what
   * everything salvaged aboard is.
   */
  base?: number;
  /** The same for the THRUSTERS' speed: a SPARK's give 120 rather than 100. */
  speed?: number;
}

export interface Rig {
  /** Six slots; null is an empty one, whether it was ever filled or not. */
  slots: Array<Slot | null>;
  /** Slot index the next blow lands on, or null when the chain starts at PLATING. */
  exposed: number | null;
  /** Modules lost this run. Mirrors `burned.length`; the death screen wants a count. */
  burnedCount: number;
  /** Which kinds burned, in order. Card preconditions read this. */
  burned: ModuleId[];
  /** Per slot, what burned there last: tells `-- burned --` from `-- empty --`. */
  scars: Array<ModuleId | null>;
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
  /** Rooms seen: 0 this one only, 1 also the next through an open door. */
  sight: 0 | 1;
  damage: [number, number, number];
  /** Taken off every noise the drone makes this turn. BAFFLE, or 0. */
  noisePenalty: number;
  /** Non-zero while a BAFFLE hides the drone one door out. See systems/sight.ts. */
  machineFovPenalty: number;
  /** Flat armour off every blow: the lattice's one point, or 0. */
  defense: number;
}

export interface RepairResult {
  slot: number;
  kind: ModuleId;
  integrity: number;
  max: number;
}

// ------------------------------------------------------------------ the rack

export function makeStartingRig(size = SLOT_COUNT): Rig {
  return rigFrom(STARTING_MODULES.map((id) => makeSlot(id, moduleKind(id).integrity)), size);
}

/**
 * A rack around a set of modules, padded to `size` slots — the shape every rig
 * has whatever bolted it together. Pure: what goes into the slots is the
 * caller's business (a hull's own rack, `content/hulls.ts`), and this only
 * guarantees the slots, the empty marker and the scars a fresh rack has none of.
 *
 * `size` is the hull's, because that is what the price buys: six slots on a
 * SCRAPPER, eight on a GHOST, and an empty slot is where what the drone finds
 * aboard goes. `SLOT_COUNT` is the default for a rack nobody named a hull for —
 * a fixture, a bare chassis, the drone a test builds by hand.
 */
export function rigFrom(slots: ReadonlyArray<Slot | null>, size = SLOT_COUNT): Rig {
  const room = Math.max(size, slots.length);
  const out: Array<Slot | null> = [];
  for (let i = 0; i < room; i++) out.push(slots[i] ?? null);
  return {
    slots: out,
    exposed: null,
    burnedCount: 0,
    burned: [],
    scars: new Array<ModuleId | null>(room).fill(null),
  };
}

/**
 * `charges` is what this particular copy has left, when whoever is handing it
 * over knows — the hold, the drone's arms, a pile off a rack. Absent means the
 * kind's own count: a crate is full, and so is a machine's scrap.
 */
function makeSlot(kind: ModuleId, integrity: number, charges?: number, base?: number): Slot {
  const k = moduleKind(kind);
  // A hull's own copy of a module is sturdier than the catalogue's (SPARK's
  // CUTTER is 13 against 11), and that ceiling travels with the module: the
  // hold and the drone's arms hand it back with the same `base` it left with.
  // Clamping to the catalogue instead did two bad things at once — it silently
  // shaved points off a module the player had paid for, and it let a slot exist
  // whose integrity was above its own cap, which the rack drew as
  // `"▯".repeat(-2)` and the screen could not survive.
  const cap = Math.max(base ?? k.integrity, k.integrity);
  const slot: Slot = { kind, integrity: clamp(integrity, 1, cap) };
  if (cap !== k.integrity) slot.base = cap;
  if (k.charges !== undefined) slot.charges = charges ?? k.charges;
  return slot;
}

/** Full integrity of this particular module, hull trait and grafting included. */
export function capOf(slot: Slot): number {
  return (slot.base ?? moduleKind(slot.kind).integrity) + (slot.bonus ?? 0);
}

/** Index of the first intact module of this kind, or null. */
export function findSlot(rig: Rig, kind: ModuleId): number | null {
  for (let i = 0; i < rig.slots.length; i++) {
    if (rig.slots[i]?.kind === kind) return i;
  }
  return null;
}

/**
 * The same question asked the way a rule asks it: this kind, or a relic that
 * answers for it (`ModuleKind.countsAs`). A blade is a cutter to a bulkhead
 * and lattice is plating to a blow; neither is a cutter or plating to the
 * scrap that would graft onto one, which is why `findSlot` stays exact.
 */
export function findSlotAs(rig: Rig, kind: ModuleId): number | null {
  const exact = findSlot(rig, kind);
  if (exact !== null) return exact;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (slot && moduleKind(slot.kind).countsAs === kind) return i;
  }
  return null;
}

/** Put a salvaged module in the first empty slot. Returns its index. */
export function install(
  rig: Rig,
  kind: ModuleId,
  integrity: number,
  charges?: number,
  base?: number,
): number | undefined {
  const i = rig.slots.findIndex((s) => s === null);
  if (i < 0) return undefined;
  installAt(rig, i, kind, integrity, charges, base);
  return i;
}

/** Bolt a module into this slot, whatever was there. The swap's half. */
export function installAt(
  rig: Rig,
  i: number,
  kind: ModuleId,
  integrity: number,
  charges?: number,
  base?: number,
): void {
  rig.slots[i] = makeSlot(kind, integrity, charges, base);
  rig.scars[i] = null;
}

/**
 * Take a module out of the rack and hand it back — the bench unbolting one,
 * not a blow burning it out: the slot goes empty rather than scarred, and
 * nothing is added to `burned`. Nothing there = nothing to take.
 */
export function removeSlot(rig: Rig, i: number): Slot | undefined {
  const slot = rig.slots[i];
  if (!slot) return undefined;
  rig.slots[i] = null;
  if (rig.exposed === i) rig.exposed = null;
  return slot;
}

/**
 * Mend the most damaged intact module, never past its own full integrity.
 * `exclude` keeps the welder from welding itself. A relic is never the answer:
 * nothing in the game mends one (`ModuleKind.relic`), so a rack whose only
 * damage is a relic has nothing to repair.
 */
export function repair(rig: Rig, exclude?: number, amount = 1): RepairResult | undefined {
  let best: number | null = null;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (!slot || i === exclude || isRelic(slot.kind)) continue;
    if (slot.integrity >= capOf(slot)) continue;
    if (best === null || slot.integrity < rig.slots[best]!.integrity) best = i;
  }
  if (best === null) return undefined;

  const slot = rig.slots[best]!;
  const max = capOf(slot);
  slot.integrity = Math.min(max, slot.integrity + amount);
  return { slot: best, kind: slot.kind, integrity: slot.integrity, max };
}

/**
 * Graft scrap onto a module already in the rack: one point of ceiling and one
 * of integrity, twice at most (design-doc.md, "Наращивание модулей обломками").
 * Costs no slot, which is what makes a wreck worth taking with a full rack.
 */
export function graft(rig: Rig, slot: number): RepairResult | undefined {
  const s = rig.slots[slot];
  if (!s || isRelic(s.kind) || (s.bonus ?? 0) >= MAX_GRAFT) return undefined;
  s.bonus = (s.bonus ?? 0) + 1;
  s.integrity += 1;
  return { slot, kind: s.kind, integrity: s.integrity, max: capOf(s) };
}

// ------------------------------------------------------------------ exposure

/**
 * What each verb puts under the next blow — design-doc.md, "Действия отсека",
 * one row at a time. Anything not named here is hands-on work (searching a
 * body, taking a charter's package, keying a door open): the drone is standing
 * still with its plating towards the room, which is what PLATING is for.
 */
const VERB_MODULE: Record<string, ModuleId> = {
  close: "thrusters",
  weld: "welder",
  cut: "cutter",
  spike: "spike",
  power: "cell",
  shoot: "emitter",
  // Burning a virus out is welding, and it exposes the welder like any other
  // welding does (`systems/virus.ts`). Without the row the purge would expose
  // the PLATING, which is the one thing a drone standing still is not risking.
  cure: "welder",
};

/**
 * Mark what the last command put at risk. Called only after a command that
 * actually resolved: a refused key costs no turn and moves no marker.
 */
export function expose(game: RoomGame, rig: Rig, cmd: RoomCommand): number | null {
  rig.exposed = exposureFor(game, rig, cmd);
  return rig.exposed;
}

export function exposureFor(game: RoomGame, rig: Rig, cmd: RoomCommand): number | null {
  switch (cmd.kind) {
    case "attack":
      return attackExposure(rig);
    case "go":
      return findSlot(rig, "thrusters");
    case "wait":
    case "hide":
      return findSlot(rig, "plating");
    case "leave":
      // The ship is behind you and the marker goes with it.
      return null;
    case "act":
      return actExposure(game, rig, cmd);
  }
}

function actExposure(game: RoomGame, rig: Rig, cmd: Extract<RoomCommand, { kind: "act" }>): number | null {
  if (cmd.verb === "use") {
    return cmd.slot !== undefined && rig.slots[cmd.slot] ? cmd.slot : null;
  }
  // Work on a ship system exposes whichever tool that system is worked with,
  // and the system is the one that knows (`HackTarget.expose`). A job that
  // finished this turn may already have been retired by its owner, and then
  // this reads as hands-on work — which the last turn of it was anyway.
  if (cmd.verb === "work") {
    const tool = cmd.target === undefined ? undefined : hackTargetAt(game, cmd.target)?.expose;
    return findSlotAs(rig, tool ?? "plating");
  }
  // A swap is the drone picking a crate up with its hands, like a carry.
  if (cmd.verb === "swap") return findSlotAs(rig, "plating");
  return findSlotAs(rig, VERB_MODULE[cmd.verb] ?? "plating");
}

/** Swinging risks the weapon, or the thrusters that carried the ram. */
function attackExposure(rig: Rig): number | null {
  return meleeSlot(rig) ?? findSlot(rig, "thrusters");
}

/**
 * The slot the drone swings with: the best melee weapon in the rack by
 * expected roll, which is the same choice `derivedStats` makes for the dice.
 * A shot is not a swing — the EMITTER carries a range and is never this.
 */
function meleeSlot(rig: Rig): number | null {
  let best: number | null = null;
  let bestRoll = -1;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (!slot) continue;
    const kind = moduleKind(slot.kind);
    if (!kind.attack || (kind.range ?? 0) > 0) continue;
    const roll = expectedRoll(kind.attack);
    if (roll > bestRoll) {
      best = i;
      bestRoll = roll;
    }
  }
  return best;
}

function expectedRoll(a: readonly [number, number, number]): number {
  return (a[0] * (a[1] + 1)) / 2 + a[2];
}

// -------------------------------------------------------------------- damage

/**
 * Where a blow lands: exposed module, then plating, then core, spilling on.
 * `precise` picks the weakest module instead of the exposed one; `burst` puts
 * one point in every intact module and never reaches the core; `corrosive`
 * eats through armour, so PLATING is not in the chain at all.
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
  for (const i of chain(rig, tags)) {
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
function chain(rig: Rig, tags: readonly string[]): number[] {
  const first = tags.includes("precise")
    ? weakestSlot(rig)
    : rig.exposed !== null && rig.slots[rig.exposed]
      ? rig.exposed
      : null;

  const out: number[] = [];
  if (first !== null) out.push(first);
  // Plating, or the lattice standing in for it: armour is whatever counts as
  // armour, to the chain and to the crawler that eats through it alike.
  const plating = findSlotAs(rig, "plating");
  if (plating !== null && !out.includes(plating)) out.push(plating);
  return tags.includes("corrosive") ? out.filter((i) => !isArmour(rig.slots[i])) : out;
}

function isArmour(slot: Slot | null | undefined): boolean {
  if (!slot) return false;
  return slot.kind === "plating" || moduleKind(slot.kind).countsAs === "plating";
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

/**
 * One slot, damaged. Exported because a blow is not the only thing that wears a
 * module down: a virus strain can rot the one it sits in (`systems/virus.ts`),
 * and burning out has to be the same burning out — the scar, the count, the
 * exposed marker let go of — or a module lost to rot would leave the rack in a
 * state nothing else in the game can produce.
 */
export function hitSlot(rig: Rig, i: number, amount: number): RigHit {
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
 * and the sight model keep reading plain fields and know nothing about modules.
 */
export function derivedStats(rig: Rig): DerivedStats {
  // The best swing in the rack by expected roll — laser over cutter, blade
  // over both — and the chassis's ram once nothing that cuts is left.
  const weapon = meleeSlot(rig);
  const attack = weapon === null ? BARE_CHASSIS.damage : moduleKind(rig.slots[weapon]!.kind).attack!;
  // A burned BAFFLE is a hole in the rack like any other: the two stealth
  // numbers drop to zero the turn it goes, with nothing to remember them by.
  const baffle = intact(rig, "baffle");
  // Speed is the one derived number a hull may beat the catalogue on (a SPARK's
  // THRUSTERS give 120), so it is read off the slot first and off the kind
  // second — the same order `capOf` reads integrity in.
  const thrusters = slotWith(rig, "thrusters");
  let defense = 0;
  for (const slot of rig.slots) if (slot) defense += moduleKind(slot.kind).defense ?? 0;
  return {
    speed: thrusters?.speed ?? intact(rig, "thrusters")?.speed ?? BARE_CHASSIS.speed,
    sight: intact(rig, "scanner")?.sight ?? BARE_CHASSIS.sight,
    damage: [attack[0], attack[1], attack[2]],
    noisePenalty: baffle?.noisePenalty ?? 0,
    machineFovPenalty: baffle?.machineFovPenalty ?? 0,
    defense,
  };
}

function intact(rig: Rig, kind: ModuleId) {
  return findSlot(rig, kind) === null ? undefined : moduleKind(kind);
}

/** The slot holding this kind, for the numbers a hull's own copy may beat. */
function slotWith(rig: Rig, kind: ModuleId): Slot | undefined {
  const i = findSlot(rig, kind);
  return i === null ? undefined : (rig.slots[i] ?? undefined);
}

export function rigOf(entity: Entity): Rig | undefined {
  return entity.data?.rig as Rig | undefined;
}

/**
 * Only the four stats the engine itself reads go onto the entity. The BAFFLE
 * pair stays in `derivedStats`: there is no engine field for "how loud I am" or
 * "how far away I am noticed", and inventing one on the player would make every
 * machine's own `sight` a lie that some other system would then read.
 */
export function applyDerived(player: Entity): void {
  const rig = rigOf(player);
  if (!rig) return;
  const stats = derivedStats(rig);
  player.speed = stats.speed;
  player.sight = stats.sight;
  player.damage = stats.damage;
  player.defense = stats.defense;
}

// ------------------------------------------------------------- the wreckage

/**
 * Salvage lying in a compartment: a dead machine, a parts crate, the modules
 * off a drone that did not make it out.
 *
 * Wreckage belongs to the room, not to the drone — `room.data.wrecks`, keyed by
 * an id unique to the ship. That is the whole difference from the grid version,
 * and it is the one the player feels: what you leave in CARGO is still in CARGO
 * when you come back aboard next sortie, because the ship is what the run
 * keeps (`StoredShip`), not the deck you happened to be standing on.
 */
/**
 * Where a pile of salvage came from.
 *
 * The rig itself does not care — a module is a module — but two systems built
 * on top of it do, and they have to agree: `systems/ghost.ts` writes it when a
 * dead drone's rack goes on the floor, `systems/rival.ts` when a competitor
 * drops one, and `systems/virus.ts` reads it to decide how likely the thing is
 * to be carrying the ship's virus (design-doc.md, "Вирус"). One declaration
 * here, because a wreck is the rig's own type.
 */
export type WreckSource = "crate" | "machine" | "drone" | "ghost" | "rival";

export interface Wreck {
  /** Unique on this ship; what `act salvage {target}` names. */
  id: number;
  kind: ModuleId;
  integrity: number;
  /** `%` for scrap, `X` for a crate. The schematic draws it, nothing else reads it. */
  glyph: string;
  /** Whose it was, when anything recorded it. Absent = the ship's own scrap. */
  source?: WreckSource;
  /**
   * Charges left in a pile that once was on a rack (a dead drone's coil, a
   * module swapped out onto the floor). Absent = the kind's own count, which a
   * factory crate and a machine's scrap are.
   */
  charges?: number;
}

/**
 * Whose rack this pile was. Defensive: a wreck round-trips through a save with
 * no types at all, and a pile nobody recorded is the ship's own machinery.
 */
export function wreckSource(wreck: Wreck): WreckSource {
  const raw = wreck.source;
  return raw === "drone" || raw === "ghost" || raw === "rival" || raw === "crate"
    ? raw
    : "machine";
}

/** Everything lying in one compartment. Live array: pushing to it adds a pile. */
export function wrecksIn(game: RoomGame, room: RoomId): Wreck[] {
  return wrecksOn(game.ship, room);
}

/**
 * The same, on a hull the drone is not standing on.
 *
 * Wreckage belongs to the compartment and not to the run, which is what lets
 * the tug draw the derelict it is tied to as the last drone left it
 * (`ui/schematic-input.ts`).
 */
export function wrecksOn(ship: Ship, room: RoomId): Wreck[] {
  const data = ship.roomAt(room).data;
  const existing = data.wrecks as Wreck[] | undefined;
  if (existing) return existing;
  const fresh: Wreck[] = [];
  data.wrecks = fresh;
  return fresh;
}

/**
 * Where a ship's own ids start, clear of the doors.
 *
 * `act spike 3` names a door by `Door.id` and `act salvage 3` names a wreck by
 * this counter, and both go through the same `{target}` field — so a ship with
 * three doors and three crates had two things answering to 3, and whichever
 * source `hackTargetAt` asked first won. Nothing aboard has a thousand doors.
 */
const FIRST_SHIP_ID = 1000;

/**
 * The next id for anything this ship holds. Shared with the content system that
 * fills a fresh derelict, so a wreck, a crate and a crew body never collide —
 * one counter per ship, kept in the store entry that survives leaving.
 */
export function nextShipId(game: RoomGame): number {
  const data = game.currentShip.data;
  const next = typeof data.nextId === "number" ? data.nextId : FIRST_SHIP_ID;
  data.nextId = next + 1;
  return next;
}

/** Drop salvage in a room. Piles do not merge: two machines leave two wrecks. */
export function addWreck(
  game: RoomGame,
  room: RoomId,
  kind: ModuleId,
  integrity: number,
  glyph = "%",
  charges?: number,
): Wreck {
  const wreck: Wreck = { id: nextShipId(game), kind, integrity, glyph };
  // Left off for a pile nobody counted — a factory crate, a machine's scrap —
  // and the kind's own full count is what those are worth. Given, it is what
  // this copy has left, and laying a coil down never refilled it.
  if (charges !== undefined) wreck.charges = charges;
  wrecksIn(game, room).push(wreck);
  return wreck;
}

export function wreckAt(game: RoomGame, room: RoomId, id: number): Wreck | undefined {
  return wrecksIn(game, room).find((w) => w.id === id);
}

function removeWreck(game: RoomGame, room: RoomId, wreck: Wreck): void {
  const wrecks = wrecksIn(game, room);
  const i = wrecks.indexOf(wreck);
  if (i >= 0) wrecks.splice(i, 1);
}

/**
 * What taking this wreck apart would do to the rack, before a turn is spent.
 *
 * `swap` is a relic's answer to a full rack: it goes in by throwing another
 * module out (`swapIn`). `slot` is the one it would take in a single press —
 * the module it is a better copy of (`ModuleKind.upgrades`), when that module
 * is in the rack — or null when the player has to say which.
 */
export type Take =
  | { kind: "graft"; slot: number }
  | { kind: "mend"; slot: number }
  | { kind: "install" }
  | { kind: "swap"; slot: number | null }
  | { kind: "no"; why: string };

/**
 * Salvage asks the rack, not the player: a module you do not carry goes into an
 * empty slot, one you already carry is grafted onto — a point of ceiling and a
 * point back, no slot needed — until it is `MAX_GRAFT` over base, after which
 * the scrap is just a repair. A module already at that ceiling and whole has
 * nothing left to take: it refuses on its own, before a second copy is ever
 * considered for an empty slot elsewhere. Only past that does a full rack with
 * nothing it carries refuse instead — and either way the refusal comes before
 * the turn, so the key stays free.
 *
 * A relic is grafted onto nothing and mended by nothing: a second copy of one
 * already in the rack is refused outright, which is also what makes it a pile
 * worth carrying home. And a full rack does not refuse a relic — it asks which
 * module to throw out for it.
 */
export function takeFor(rig: Rig, kind: ModuleId): Take {
  const relic = isRelic(kind);
  const slot = findSlot(rig, kind);
  if (slot !== null) {
    if (relic) return { kind: "no", why: t("why.relic.have", { module: moduleName(kind) }) };
    const s = rig.slots[slot]!;
    if ((s.bonus ?? 0) < MAX_GRAFT) return { kind: "graft", slot };
    if (s.integrity < capOf(s)) return { kind: "mend", slot };
    return { kind: "no", why: t("why.graft.full") };
  }
  if (rig.slots.some((s) => s === null)) return { kind: "install" };
  if (relic) {
    const upgrades = moduleKind(kind).upgrades;
    return { kind: "swap", slot: upgrades === undefined ? null : findSlot(rig, upgrades) };
  }
  return { kind: "no", why: t("why.rack.burnFirst") };
}

/**
 * The slots a relic could take a full rack by, in the order the list offers
 * them: the module it upgrades first, then the rest worst-first — the module
 * nearest to burning out is the one a fresh relic most naturally replaces.
 * Ties go to the lower slot, so the order is the same on every frame.
 */
export function swapSlots(rig: Rig, kind: ModuleId): number[] {
  const take = takeFor(rig, kind);
  if (take.kind !== "swap") return [];
  const rest = rig.slots
    .flatMap((slot, i) => (slot && i !== take.slot ? [{ i, left: slot.integrity }] : []))
    .sort((a, b) => a.left - b.left || a.i - b.i)
    .map((s) => s.i);
  return take.slot === null ? rest : [take.slot, ...rest];
}

/**
 * What the drone can carry off a hull without bolting it on, and where it goes.
 *
 * The half of salvage that was missing. Until this, a module found aboard was
 * either installed on the spot or left where it lay — so the only thing that
 * ever reached the tug was what the drone was wearing when it walked out, and a
 * drone that died took everything with it. The owner asked for it plainly
 * («утаскиваем с собой») and the balance harness proved it is load-bearing: a
 * bought hull with no rack tows 2 hulls of 32 against 10, because there is no
 * way to build the next drone out of the last one's finds.
 *
 * Carried and not held: it is on the *drone*, so it is lost with the drone. The
 * hold is the tug's and survives; the walk home is the risk.
 *
 * Two, and the number is measured rather than chosen. Every armful is a turn
 * spent not fighting, not walking and not raising a system, and the balance
 * harness reads that straight off: at three the voyage arrives at the father's
 * hull armed 9 times of 32 against the 10 it managed before carrying existed,
 * at two it manages 10 again (`tests/balance.test.ts`). Two is also enough for
 * what the mechanic is for — the CUTTER and the WELDER are one armful.
 */
export const CARRY_LIMIT = 2;

export interface Carried {
  kind: ModuleId;
  integrity: number;
  /**
   * The ceiling this particular copy has, when a hull gave it a better one than
   * the catalogue. Carried so that a module does not lose points by being put
   * down and picked up again — and so that a slot never comes back with more
   * integrity than cap, which used to break the rack's own drawing.
   */
  base?: number;
  /**
   * Charges left, for a module that spends them. Carried along so that taking
   * a coil off the rack and putting it back is not a recharge — a spent EMP in
   * the arms is a spent EMP on the rails.
   */
  charges?: number;
}

/** One armful, with its charges when the thing has any. */
export function carriedFrom(
  kind: ModuleId,
  integrity: number,
  charges?: number,
  base?: number,
): Carried {
  const out: Carried = { kind, integrity };
  if (base !== undefined && base !== moduleKind(kind).integrity) out.base = base;
  if (charges !== undefined) out.charges = charges;
  return out;
}

/** What the drone is carrying, read defensively — it round-trips through a save. */
export function carriedBy(player: Entity): Carried[] {
  const raw = player.data?.carry;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is Carried =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Carried).kind === "string" &&
      typeof (item as Carried).integrity === "number",
  );
}

/** Put it back: the list is the drone's, and an empty one is no list at all. */
export function setCarried(player: Entity, carry: readonly Carried[]): void {
  const data = (player.data ??= {});
  if (carry.length === 0) delete data.carry;
  else data.carry = [...carry];
}

/** Take everything the drone is carrying, and leave it carrying nothing. */
export function unloadCarried(player: Entity): Carried[] {
  const carry = carriedBy(player);
  setCarried(player, []);
  return carry;
}

/**
 * `act carry {wreck}`: a module off the pile and into the drone's arms.
 *
 * It costs the turn installing one costs and makes the same noise, and it
 * exposes nothing — the drone is not using a module, it is picking one up.
 */
function carryWreck(game: RoomGame, target: number | undefined): Outcome {
  const here = game.roomOf(game.player).id;
  const wrecks = wrecksIn(game, here);
  const wreck = target === undefined ? wrecks[0] : wrecks.find((w) => w.id === target);
  if (!wreck) return FAIL(t("why.salvage.none"));
  const carrying = carriedBy(game.player);
  if (carrying.length >= CARRY_LIMIT) return FAIL(t("why.carry.full", { n: CARRY_LIMIT }));

  setCarried(game.player, [...carrying, carriedFrom(wreck.kind, wreck.integrity, wreck.charges)]);
  removeWreck(game, here, wreck);
  game.makeNoise(here, SALVAGE_NOISE);
  const kind = moduleKind(wreck.kind);
  game.log.add(
    t("log.carry.take", {
      module: moduleName(kind.id),
      left: wreck.integrity,
      max: kind.integrity,
      n: carrying.length + 1,
      limit: CARRY_LIMIT,
    }),
    game.schedule.time,
    "good",
    "log.carry.take",
  );
  return DONE();
}

/**
 * `act salvage {target}`: pull a module out of the named wreck.
 *
 * By id, not by "the first pile in reading order": on a graph there is no
 * reading order, and the numbered action list already puts the choice in front
 * of the player (design-doc.md, "Действия отсека").
 */
function salvage(game: RoomGame, target: number | undefined): Outcome {
  const rig = rigOf(game.player);
  if (!rig) return FAIL(t("why.salvage.noRig"));
  const here = game.roomOf(game.player).id;
  const wrecks = wrecksIn(game, here);
  const wreck = target === undefined ? wrecks[0] : wrecks.find((w) => w.id === target);
  if (!wreck) return FAIL(t("why.salvage.none"));

  const take = takeFor(rig, wreck.kind);
  const kind = moduleKind(wreck.kind);
  let line: string;
  let key: Key;
  let installed: number | undefined;
  switch (take.kind) {
    case "no":
      return FAIL(take.why);
    // A relic into a full rack: in one press where the rack holds the module
    // it upgrades, otherwise the list's own `swap` lines say which slot.
    case "swap":
      if (take.slot === null) return FAIL(t("why.relic.pick"));
      return swapIn(game, rig, wreck, take.slot);
    case "graft": {
      const done = graft(rig, take.slot)!;
      key = "log.salvage.graft";
      line = t(key, { module: moduleName(kind.id), left: done.integrity, max: done.max });
      break;
    }
    case "mend": {
      const slot = rig.slots[take.slot]!;
      slot.integrity = Math.min(capOf(slot), slot.integrity + 1);
      key = "log.salvage.mend";
      line = t(key, { module: moduleName(kind.id), left: slot.integrity, max: capOf(slot) });
      break;
    }
    case "install": {
      const slot = install(rig, wreck.kind, wreck.integrity, wreck.charges)!;
      key = "log.salvage.install";
      line = t(key, {
        module: moduleName(kind.id),
        left: rig.slots[slot]!.integrity,
        max: kind.integrity,
      });
      installed = slot;
      break;
    }
  }

  removeWreck(game, here, wreck);
  applyDerived(game.player);
  game.makeNoise(here, SALVAGE_NOISE);
  game.log.add(line, game.schedule.time, "good", key);
  // Somebody else's part, bolted into the rack: the one moment the ship's
  // virus can come aboard (design-doc.md, "Вирус"). Only a fresh install —
  // grafting and mending work the metal into a module already in the rack.
  if (installed !== undefined) {
    relicLine(game, wreck.kind);
    tryInfect(game, installed, wreckSource(wreck), specOfShip(game.ship)?.virusBonus ?? 0);
  }
  return DONE();
}

/**
 * `act swap {wreck} {slot}`: a relic into a full rack, the module in that slot
 * out. Only a relic swaps — an ordinary module into a full rack is the refusal
 * it always was — and only into a full rack: with a slot free the relic goes
 * in by `salvage` like anything else, and nothing is thrown out for it.
 */
function swapFor(game: RoomGame, target: number | undefined, slot: number | undefined): Outcome {
  const rig = rigOf(game.player);
  if (!rig) return FAIL(t("why.salvage.noRig"));
  const here = game.roomOf(game.player).id;
  const wreck = target === undefined ? undefined : wreckAt(game, here, target);
  if (!wreck) return FAIL(t("why.salvage.none"));

  const take = takeFor(rig, wreck.kind);
  if (take.kind === "no") return FAIL(take.why);
  if (take.kind !== "swap") return FAIL(t("why.swap.free"));
  if (slot === undefined || !rig.slots[slot]) return FAIL(t("why.rig.emptySlot"));
  return swapIn(game, rig, wreck, slot);
}

/**
 * The swap itself. What comes out goes into the drone's arms
 * (`carryWreck`, `CARRY_LIMIT`) and, with the arms full, onto the floor of
 * this compartment as a pile the drone can pick up again — never into
 * nothing. A relic is worth a slot and the module it displaces is still worth
 * the walk home.
 */
function swapIn(game: RoomGame, rig: Rig, wreck: Wreck, slot: number): Outcome {
  const here = game.roomOf(game.player).id;
  const out = removeSlot(rig, slot)!;
  const carrying = carriedBy(game.player);
  let key: Key;
  if (carrying.length < CARRY_LIMIT) {
    setCarried(game.player, [...carrying, carriedFrom(out.kind, out.integrity, out.charges, out.base)]);
    key = "log.swap.carried";
  } else {
    // The drone's own part, laid down: sealed as far as the ship's virus is
    // concerned, because it never was the ship's — and with whatever charges
    // it had left, because laying a coil down is not recharging it.
    const pile = addWreck(game, here, out.kind, out.integrity, "%", out.charges);
    pile.source = "crate";
    key = "log.swap.dropped";
  }
  installAt(rig, slot, wreck.kind, wreck.integrity, wreck.charges);
  removeWreck(game, here, wreck);
  applyDerived(game.player);
  game.makeNoise(here, SALVAGE_NOISE);
  game.log.add(
    t(key, { module: moduleName(wreck.kind), old: moduleName(out.kind) }),
    game.schedule.time,
    "good",
    key,
  );
  relicLine(game, wreck.kind);
  tryInfect(game, slot, wreckSource(wreck), specOfShip(game.ship)?.virusBonus ?? 0);
  return DONE();
}

/**
 * Said the turn a relic goes into the rack, every time: the one place the
 * player is told what makes it different, and a relic is rare enough that
 * once a sortie is not a line that wears out.
 */
function relicLine(game: RoomGame, kind: ModuleId): void {
  if (!isRelic(kind)) return;
  game.log.add(
    t("log.relic.take", { module: moduleName(kind) }),
    game.schedule.time,
    "warn",
    "log.relic.take",
  );
}

// -------------------------------------------------------- the active modules

/** Numbers from design-doc.md, "Шум" and "Модули". */
const PULSE_DOORS = 2;
const PULSE_NOISE = 8;
const EMP_STUN_TURNS = 3;
const EMP_NOISE = 6;
const WELD_NOISE = 5;
const SPIKE_NOISE = 4;
const EMITTER_NOISE = 7;
const SALVAGE_NOISE = 2;

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

/**
 * What a jammed rack says back — one line for every module, because it is the
 * rack that is off and not the module that is broken.
 */
const JAMMED_KEY = "why.jammed";

// ------------------------------------------------------------------ breaching

/**
 * Something a SPIKE can work its way into, or a job that takes several turns:
 * a locked bulkhead (G14), a ship system or a terminal (G17).
 *
 * Work in progress is the target's own state, not the rig's — `hackTargetAt`
 * hands back the same live object every turn until it opens, and whoever owns
 * it is responsible for keeping `turnsLeft` somewhere that survives a save
 * (`room.data`, the way this file keeps wreckage).
 */
export const SPIKE_TURNS = 2;

export interface HackTarget {
  /** How the log names it: `You spike the main terminal open.` */
  readonly name: string;
  /** Player turns of work still to spend. Reaches 0 exactly once. */
  turnsLeft: number;
  /**
   * Which module the work exposes while it lasts. Absent = hands-on, PLATING.
   * Only the owner knows: a reactor is worked with a CELL and a door is cut
   * with a CUTTER, and the twist must not learn either word.
   */
  readonly expose?: ModuleId;
  /** Everything the breach changes. Called on the turn `turnsLeft` hits 0. */
  breach(game: RoomGame): void;
}

/** Asked about one thing in the room, by its id; answers only if it owns it. */
export type HackTargetSource = (game: RoomGame, target: number) => HackTarget | undefined;

const HACK_SOURCES: HackTargetSource[] = [];

/**
 * Register what a SPIKE — or a multi-turn job — can be worked into. Called at
 * import time by the content that owns the thing, so this file never learns
 * its name.
 */
export function registerHackTarget(source: HackTargetSource): void {
  HACK_SOURCES.push(source);
}

/** What is breachable under that id, if anything. First provider wins. */
export function hackTargetAt(game: RoomGame, target: number): HackTarget | undefined {
  for (const source of HACK_SOURCES) {
    const hit = source(game, target);
    if (hit) return hit;
  }
  return undefined;
}

/** Asked of every blow at the drone: does this one land at all? */
export type DamageVeto = (game: RoomGame, source: Entity | undefined) => boolean;

const DAMAGE_VETOES: DamageVeto[] = [];

/**
 * Register a rule that stops a blow before it is routed anywhere.
 *
 * The seam exists because the twist is `systems[0]` and therefore the first
 * hook `dealDamage` asks: a system further down the list that wants a blow not
 * to happen is asked too late — the rack has taken it and the log has said so.
 * So the question is asked here, at the top of the routing, by whoever owns the
 * reason. This file never learns what the reason is (`registerHackTarget`, and
 * for the same reason).
 */
export function registerDamageVeto(veto: DamageVeto): void {
  DAMAGE_VETOES.push(veto);
}

/** Does anything say this blow does not land? First refusal is enough. */
function vetoed(game: RoomGame, source: Entity | undefined): boolean {
  return DAMAGE_VETOES.some((veto) => veto(game, source));
}

/**
 * The line a blow with no source is signed by, for as long as one is being
 * dealt. `dealDamage` hands `onDamage` no source for the ship's own vacuum or
 * for a mine, and the log used to sign those "Something" — which the owner
 * read as an invisible machine and answered with `Tab`
 * (docs/tasks/G83-anonymous-blows.md, 1). Set for the length of one call and
 * never stored: nothing about it reaches a save or a replay, so this is the
 * one variable at module level here that is not a registry.
 */
let BLOW_CAUSE: Key | undefined;

/**
 * Deal a blow on behalf of something that is not an entity, and have the log
 * say what it was: `cause` is the row `onDamage` writes instead of
 * `log.hit.module`, with the same `module`, `left` and `max`. The system that
 * owns the blow names it; this file never learns what the causes are.
 */
export function blamedOn<T>(cause: Key, blow: () => T): T {
  const outer = BLOW_CAUSE;
  BLOW_CAUSE = cause;
  try {
    return blow();
  } finally {
    BLOW_CAUSE = outer;
  }
}

/** `s`, `e`, `w`, `K`, `f`: what the slot holds decides what the key does. */
function useModule(game: RoomGame, cmd: Extract<RoomCommand, { kind: "act" }>): Outcome {
  const rig = rigOf(game.player);
  const index = cmd.slot;
  const slot = rig && index !== undefined ? rig.slots[index] : undefined;
  if (!rig || !slot || index === undefined) return FAIL(t("why.rig.emptySlot"));

  switch (slot.kind) {
    case "scanner":
      return pulse(game);
    case "emp":
      return discharge(game, slot, EMP_STUN_TURNS);
    case "shocker":
      return discharge(game, slot, SHOCK_STUN_TURNS);
    case "welder":
      return weld(game, rig, index);
    case "spike":
      return breach(game, cmd.target);
    case "emitter":
      return shoot(game, slot);
    default:
      return FAIL(t("why.module.passive"));
  }
}

/**
 * `K`: work the SPIKE into whatever the command names.
 *
 * Two turns of it, and both of them expose the SPIKE — that is the whole cost
 * of opening a door without a key: standing still, twice, next to something
 * that may be walking towards you.
 */
function breach(game: RoomGame, target: number | undefined): Outcome {
  const hit = target === undefined ? undefined : hackTargetAt(game, target);
  if (!hit) return FAIL(t("why.breach.nothing"));

  hit.turnsLeft = Math.max(0, hit.turnsLeft - 1);
  game.makeNoise(game.roomOf(game.player).id, SPIKE_NOISE);

  if (hit.turnsLeft > 0) {
    game.log.add(
      t("log.spike.on", { spike: moduleName("spike"), target: hit.name }),
      game.schedule.time,
      "plain",
      "log.spike.on",
    );
    return DONE();
  }

  hit.breach(game);
  game.log.add(t("log.spike.done", { target: hit.name }), game.schedule.time, "good", "log.spike.done");
  return DONE();
}

/**
 * EMITTER: one shot at the nearest machine in sight, no cursor and no mode.
 *
 * Nearest, not chosen: design-doc.md rules out a targeting cursor, and the
 * choice the game wants is not *which* machine but *whether* to fire at all —
 * a shot exposes the EMITTER and is louder than a fight.
 */
function shoot(game: RoomGame, slot: Slot): Outcome {
  const kind = moduleKind(slot.kind);
  const dice = kind.attack ?? BARE_CHASSIS.damage;
  const target = shootTarget(game);
  // Nothing here, nothing through the door, or the door is shut: one refusal,
  // and none of the three should cost a turn.
  if (!target) return FAIL(t("why.shoot.none"));

  const raw = game.rng.roll(dice[0], dice[1]) + dice[2];
  const res = dealDamage(game, target, Math.max(1, raw - effectiveDefense(target)), game.player);
  game.makeNoise(game.roomOf(game.player).id, EMITTER_NOISE);
  // What came off and what is left of it. The remainder is half the line: the
  // owner traded shots with a ten point machine, took it to three, and read the
  // exchange as broken because nothing on the screen said how close he was to
  // finishing it (docs/owner-queue.md, 1).
  const hit = t("log.emitter.hit", {
    emitter: moduleName("emitter"),
    target: entityLabel(game, target),
    n: res.toHp,
    hp: Math.max(0, target.hp),
    max: target.hpMax,
  });
  game.log.add(
    hit,
    game.schedule.time,
    "good",
    "log.emitter.hit",
  );
  if (res.killed) {
    game.log.add(
      t("log.machine.dies", { target: capitalize(entityLabel(game, target)) }),
      game.schedule.time,
      "good",
      "log.machine.dies",
    );
    game.onDeath(target);
    return DONE();
  }
  // The first shot at something that can shoot back, and only that one.
  //
  // `hint.exposure` says a blow lands on whatever the drone last used, which is
  // true of the emitter as much as of anything — but a player reads that as a
  // rule about melee, because until this moment every exchange has been in the
  // room. It is worst here: the EMITTER is the most brittle thing on a rack,
  // and a machine with a reach answers from where it stands, so the trade is
  // the emitter against a full machine. The owner made it, lost the emitter and
  // read the machine's staying put as a fault: «он не подходит»
  // (docs/owner-queue.md, 1).
  if ((target.range ?? 0) >= 1) hint(game, "shooting");
  return DONE();
}

/** This room first, then whatever the drone can see through an open door. */
export function shootTarget(game: RoomGame): Entity | undefined {
  const here = game.roomOf(game.player).id;
  const foes = game.entities.filter((e) => e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e));
  return foes.find((e) => e.room === here) ?? foes.find((e) => canSee(game.ship, game.player, e));
}

/**
 * Sensor pulse: two doors of ship come back on the schematic — through shut
 * bulkheads as well, because a pulse reads structure rather than looking at it.
 * What it shows is a snapshot, not a live feed: the machines are where they
 * were when it went off, and it is loud enough to raise the alert.
 */
function pulse(game: RoomGame): Outcome {
  const here = game.roomOf(game.player).id;
  const found: string[] = [];
  for (const id of scanRooms(game.ship, here, PULSE_DOORS)) {
    const room = game.ship.roomAt(id);
    // A relic crate is named the first time a pulse reads its compartment:
    // that is how a player learns there is something aboard worth the guard
    // standing over it, and why a scan is worth the noise.
    if (!room.scanned && id !== here && wrecksIn(game, id).some((w) => isRelic(w.kind))) {
      found.push(roomName(room));
    }
    room.scanned = true;
    room.data.snapshot = snapshotOf(game, id);
  }
  game.makeNoise(here, PULSE_NOISE);
  game.log.add(t("log.pulse"), game.schedule.time, "warn", "log.pulse");
  for (const room of found) {
    game.log.add(t("log.relic.seen", { room }), game.schedule.time, "warn", "log.relic.seen");
  }
  return DONE();
}

/** Glyphs of what stands in a room: machines first, then salvage. */
export function snapshotOf(game: RoomGame, room: RoomId): string {
  const machines = game.entities.filter((e) => e.room === room && e.id !== game.player.id && isAlive(e));
  return [...machines.map((m) => m.ch), ...wrecksIn(game, room).map((w) => w.glyph)].join(" ");
}

/**
 * EMP and SHOCKER: `turns` of stun on everything in this compartment, one
 * charge a press. The status is the engine's own and every behaviour on the
 * graph reads it (`actionScrambled`), which is what makes a stunned machine a
 * machine that blunders instead of biting.
 */
function discharge(game: RoomGame, slot: Slot, turns: number): Outcome {
  if ((slot.charges ?? 0) <= 0) return FAIL(t("why.emp.spent", { emp: moduleName(slot.kind) }));

  const targets = hostilesIn(game, game.roomOf(game.player).id);
  // A charge is too scarce to spend on empty air; the key stays free instead.
  if (targets.length === 0) return FAIL(t("why.emp.none"));

  for (const m of targets) applyStatus(m, "stun", turns);
  slot.charges = (slot.charges ?? 0) - 1;
  game.makeNoise(game.roomOf(game.player).id, EMP_NOISE);
  let key: Key;
  if (slot.kind === "shocker") key = "log.shock";
  else key = "log.emp";
  game.log.add(
    t(key, { module: moduleName(slot.kind), n: targets.length, left: slot.charges }),
    game.schedule.time,
    "good",
    key,
  );
  return DONE();
}

/** Welder: the run's only way back up, one point at a time, never on itself. */
function weld(game: RoomGame, rig: Rig, self: number): Outcome {
  const mend = repair(rig, self);
  // Nothing to mend — and if what is worn is a relic, say that it is the
  // relic and not the welder: nothing in the game mends one.
  if (!mend) {
    const relic = rig.slots.find((s) => s && isRelic(s.kind) && s.integrity < capOf(s));
    if (relic) return FAIL(t("why.relic.noRepair", { module: moduleName(relic.kind) }));
    return FAIL(t("why.repair.none"));
  }

  game.makeNoise(game.roomOf(game.player).id, WELD_NOISE);
  game.log.add(
    t("log.weld", { module: moduleName(mend.kind), left: mend.integrity, max: mend.max }),
    game.schedule.time,
    "good",
    "log.weld",
  );
  return DONE();
}

// ---------------------------------------------------------------- the twist

export const RIG: Twist<RoomGame> = {
  name: "rig",

  onRunStart(game) {
    game.player.data = { ...(game.player.data ?? {}), rig: makeStartingRig(), hints: {} };
    applyDerived(game.player);
    // The rack decides what the drone can see, and the arrival already asked.
    game.refreshSight();
  },

  onDeath(game, victim) {
    if (victim.id === game.player.id || victim.room === undefined) return;
    const kind = machineByName(victim.name)?.salvage;
    if (!kind) return;
    addWreck(game, victim.room, kind, game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]));
    game.log.add(
      t("log.scrap.drop", { machine: machineName(victim.name), module: moduleName(kind) }),
      game.schedule.time,
      "plain",
      "log.scrap.drop",
    );
  },

  afterPlayerTurn(game, cmd) {
    const rig = rigOf(game.player);
    if (!rig) return;
    expose(game, rig, cmd);
    muffle(game, rig);

    // The two rules the ship teaches by putting them in front of the drone
    // rather than by taking something away.
    if (wrecksIn(game, game.roomOf(game.player).id).length > 0) hint(game, "scrap");
    if (findSlot(rig, "scanner") === null) hint(game, "blind");
  },

  onDamage(game, victim, amount, source) {
    if (victim.id !== game.player.id) return amount;
    // Before anything is routed, logged or burned: a blow somebody vetoed is a
    // blow that did not happen (`registerDamageVeto`).
    if (vetoed(game, source)) return 0;

    const rig = rigOf(game.player);
    if (!rig) return amount;

    const route = routeDamage(rig, amount, source?.tags ?? []);
    // A blow nothing dealt is signed by whatever owned it (`blamedOn`), and
    // only when nothing did is it "Something" — a case nothing aboard makes.
    const cause = source === undefined ? BLOW_CAUSE : undefined;
    const who = capitalize(source ? entityLabel(game, source) : t("label.something"));
    let burned = false;
    for (const hit of route.hits) {
      const kind = moduleKind(hit.kind);
      const slot = rig.slots[hit.slot];
      const max = slot && slot.kind === hit.kind ? capOf(slot) : kind.integrity;
      const line =
        cause === undefined
          ? hitLine(who, kind, hit.remaining, max)
          : t(cause, { module: moduleName(kind.id), left: hit.remaining, max });
      game.log.add(line, game.schedule.time, "bad", cause ?? "log.hit.module");
      if (hit.burned) {
        game.log.add(moduleBurnLine(kind.id), game.schedule.time, "bad", "log.module.burn");
        burned = true;
      }
    }
    if (burned) applyDerived(game.player);

    if (route.hits.length > 0) hint(game, "exposure");
    if (burned) hint(game, "burned");
    return route.toCore;
  },

  panelLines(game) {
    const player = game.player;
    const lines = [{ text: t("panel.core", { dots: dots(player.hp, player.hpMax) }), fg: coreColour(player) }];
    const rig = rigOf(player);
    if (!rig) return lines;

    for (let i = 0; i < rig.slots.length; i++) {
      const slot = rig.slots[i];
      if (!slot) {
        const burned = rig.scars[i] !== null;
        lines.push({
          text: `${i + 1} ${burned ? t("panel.slot.burned") : t("panel.slot.empty")}`,
          fg: burned ? PALETTE.burned : PALETTE.fgDim,
        });
        continue;
      }
      const kind = moduleKind(slot.kind);
      const max = capOf(slot);
      const bars = "▮".repeat(slot.integrity) + "▯".repeat(max - slot.integrity);
      const exposed = rig.exposed === i;
      // One `+` per point grafted on (`MAX_GRAFT` at most: `++`), and the
      // exposed arrow after it — both worth more than a pip of the bar, so on
      // a rack whose bar alone would run the panel over its width (a hull's
      // own PLATING beats the catalogue by enough that a full graft can), it
      // is the bar that gives, never the marks either side of it.
      const prefix = `${i + 1} ${moduleName(kind.id).padEnd(10)}`;
      const suffix = `${"+".repeat(slot.bonus ?? 0)}${exposed ? "  ◀" : ""}`;
      const room = Math.max(0, PANEL_LINE_WIDTH - prefix.length - suffix.length);
      const shownBars = bars.length > room ? bars.slice(0, room) : bars;
      lines.push({
        text: `${prefix}${shownBars}${suffix}`,
        fg: exposed ? PALETTE.accent : PALETTE.fg,
      });
    }
    return lines;
  },

  /**
   * The verbs the engine leaves to the game. Three of them are the rig's:
   * `salvage` takes a wreck apart, `use` spends a module already in the rack,
   * `shoot` is the same shot on its own key. Anything else — and anyone but
   * the player — falls through to the next system.
   */
  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act") return undefined;
    // A jammer in the compartment (systems/jam.ts) kills the two verbs that
    // spend a module — including the SPIKE the door system hands back here.
    // Refused before the turn: standing next to a jammer is punishment enough
    // without also losing the turn to a key that did nothing.
    if ((cmd.verb === "use" || cmd.verb === "shoot") && jammed(game)) return FAIL(t(JAMMED_KEY));
    switch (cmd.verb) {
      case "carry":
        return carryWreck(game, cmd.target);
      case "salvage":
        return salvage(game, cmd.target);
      case "swap":
        return swapFor(game, cmd.target, cmd.slot);
      case "use":
        return useModule(game, cmd);
      case "shoot": {
        const rig = rigOf(game.player);
        const slot = rig ? findSlot(rig, "emitter") : null;
        if (!rig || slot === null) return FAIL(t("why.module.missing", { module: moduleName("emitter") }));
        return shoot(game, rig.slots[slot]!);
      }
      default:
        return undefined;
    }
  },

  /**
   * What can be done in this compartment, numbered — and the only way the UI
   * and the bots ever learn about the rig's verbs. Order is design-doc.md's:
   * attacks first, then what lies in the room.
   *
   * An offer that says `enabled` is one `playerCommand` accepts; a disabled one
   * is refused without costing a turn. Nothing else may be true of this list,
   * because a player reading a number and a bot picking one must get the same
   * game.
   */
  offerActions(game) {
    const offers: Array<ActionOffer<RoomCommand>> = [];
    const rig = rigOf(game.player);
    if (!rig || game.status !== "playing") return offers;

    const here = game.roomOf(game.player).id;
    const foes = hostilesIn(game, here);
    for (const m of foes) {
      offers.push({
        // The hit points are on the line because two of the same machine in
        // one compartment are otherwise two identical lines aimed at different
        // things (docs/tasks/G55-playtest-findings.md, 11).
        label: t("action.attack", { target: machineName(m.name), hp: m.hp, max: m.hpMax }),
        cmd: { kind: "attack", target: m.id },
        enabled: true,
      });
    }

    if (findSlot(rig, "emitter") !== null) {
      const target = shootTarget(game);
      if (target) {
        offers.push({
          label: t("action.shoot", { target: machineName(target.name) }),
          cmd: { kind: "act", verb: "shoot" },
          enabled: true,
        });
      }
    }

    // A relic that fires — the SHOCKER — has no letter of its own (letters are
    // `ui/input.ts`'s and name the catalogue), so it is a numbered line, and
    // only while there is something in the compartment to fire it at: the
    // same rule the EMITTER's shot follows.
    if (foes.length > 0) {
      for (let i = 0; i < rig.slots.length; i++) {
        const slot = rig.slots[i];
        if (!slot || !isRelic(slot.kind) || moduleKind(slot.kind).active === undefined) continue;
        const spent = (slot.charges ?? 0) <= 0;
        const blocked = jammed(game);
        const offer: ActionOffer<RoomCommand> = {
          label: t("action.discharge", { module: moduleName(slot.kind), n: slot.charges ?? 0 }),
          cmd: { kind: "act", verb: "use", slot: i },
          enabled: !spent && !blocked,
        };
        if (blocked) offer.why = t(JAMMED_KEY);
        else if (spent) offer.why = t("why.emp.spent", { emp: moduleName(slot.kind) });
        offers.push(offer);
      }
    }

    const carrying = carriedBy(game.player).length;
    for (const w of wrecksIn(game, here)) {
      const kind = moduleKind(w.kind);
      const take = takeFor(rig, w.kind);
      // A relic against a full rack is not one line but one per module it
      // could throw out, the one it upgrades first (`swapSlots`): the choice
      // is the player's, and a list is how this game puts a choice in front
      // of them (design-doc.md, "Действия отсека").
      if (take.kind === "swap") {
        for (const i of swapSlots(rig, w.kind)) {
          offers.push({
            label: t("action.swap", { module: moduleName(kind.id), old: moduleName(rig.slots[i]!.kind) }),
            cmd: { kind: "act", verb: "swap", target: w.id, slot: i },
            enabled: true,
          });
        }
        continue;
      }
      const offer: ActionOffer<RoomCommand> = {
        label: t("action.salvage", { module: moduleName(kind.id), left: w.integrity, max: kind.integrity }),
        cmd: { kind: "act", verb: "salvage", target: w.id },
        enabled: take.kind !== "no",
      };
      if (take.kind === "no") offer.why = take.why;
      offers.push(offer);
      // And the other half: take it without bolting it on — offered on exactly
      // the piles worth the walk home. Two gates, and both are measured.
      //
      // A module this rack can use should be *used*, so `carry` waits until
      // `salvage` has nothing to offer. And of the two ways salvage refuses,
      // only one is worth carrying: a kind the rack does not have at all, which
      // it cannot take because every slot is full. The other refusal is "you
      // already have a whole one of these" — a duplicate, and duplicates are
      // what a bot fills its arms with while the voyage runs out of turns.
      //
      // Both lines on every pile: 8 hulls towed of 32. Gated on the refusal
      // alone: 9. Gated on the refusal and the kind: 10, which is where it was
      // before any of this (`tests/balance.test.ts`, armed arrivals).
      if (take.kind !== "no") continue;
      const full = carrying >= CARRY_LIMIT;
      const carryOffer: ActionOffer<RoomCommand> = {
        label: t("action.carry", { module: moduleName(kind.id), left: w.integrity, max: kind.integrity }),
        cmd: { kind: "act", verb: "carry", target: w.id },
        enabled: !full,
      };
      if (full) carryOffer.why = t("why.carry.full", { n: CARRY_LIMIT });
      offers.push(carryOffer);
    }

    // Hiding with something already looking at you is not hiding.
    if (game.roomOf(game.player).cover && foes.length === 0) {
      offers.push({ label: t("action.hide"), cmd: { kind: "hide" }, enabled: true });
    }
    return offers;
  },
};

/**
 * The BAFFLE, applied in one place: this turn's noise, three quieter.
 *
 * Subtracting from the settled field is not an approximation of a quieter
 * source, it is the same field — `propagateRooms` loses at least one point per
 * door, so a source of 8 reads 8-d at distance d and taking 3 off every room is
 * exactly a source of 5. And the drone is the only thing aboard that makes any
 * noise the alert listens to.
 *
 * It runs before ALERT.afterPlayerTurn because the twist is systems[0], which
 * is what makes the muffled field the one the alert hears.
 */
function muffle(game: RoomGame, rig: Rig): void {
  const penalty = derivedStats(rig).noisePenalty;
  if (penalty <= 0) return;
  const quiet = new Map<RoomId, number>();
  for (const [room, strength] of game.noise) {
    const left = strength - penalty;
    if (left > 0) quiet.set(room, left);
  }
  game.noise = quiet;
}

// ---------------------------------------------------------- reading the ship

export function hostilesIn(game: RoomGame, room: RoomId): Entity[] {
  return game.entities.filter(
    (e) => e.room === room && e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e),
  );
}

// -------------------------------------------------------------------- pieces

function coreColour(player: Entity): string {
  return player.hp <= 1 ? PALETTE.hpLow : PALETTE.fg;
}

function dots(hp: number, max: number): string {
  return "●".repeat(Math.max(0, hp)) + "○".repeat(Math.max(0, max - hp));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
