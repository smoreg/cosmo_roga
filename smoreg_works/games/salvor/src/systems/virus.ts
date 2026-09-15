import {
  TURN_COST,
  propagateRooms,
  type ActionOffer,
  type Entity,
  type Outcome,
  type RoomCommand,
  type RoomGame,
  type RoomId,
  applyDamage,
  type System,
} from "@jamrog/engine";
import { specOfShip } from "../content/derelicts.js";
import { moduleName, type ModuleId } from "../content/modules.js";
import { DEFAULT_STRAIN, strainName, strainOf, type Strain, type StrainId } from "../content/viruses.js";
import type { Key } from "../content/i18n/keys.js";
import { t } from "../i18n.js";
import { applyDerived, findSlotAs, hitSlot, rigOf, type Rig, type WreckSource } from "../twist/rig.js";
import { takeCredits } from "./purse.js";
import { jobNow, registerJob, sayBrokenOff } from "./jobs.js";

/**
 * The ship's virus, carried home in a part you were greedy for.
 *
 * The risk sits on exactly the action the player wants to take — putting
 * somebody else's module in the rack. What happens then is the hull's to decide:
 * the strains live in `content/viruses.ts` and this file is the clock that ticks
 * whichever one came aboard. Four of them today — one takes away your choice of
 * what to expose, one eats the module it sits in, one bleeds the account, one
 * goes for the core — and adding a fifth is a row in that table, not a change
 * here (`docs/adr/0003-decoupling.md`).
 *
 * Everything here is state on the drone, not on the rack: one virus per drone,
 * naming a slot. That is what makes it survive a module burning out (it does
 * not — the virus goes with it), a sortie ending, and a save round-trip, and it
 * is why nothing in `twist/rig.ts` had to learn the word.
 */

// --------------------------------------------------------------- the numbers

/**
 * The spasm's own clock, kept as named constants because the suite and the
 * balance harness count turns against them. Every strain carries its own pair
 * (`content/viruses.ts`); these two are `SPASM`'s, which is what a hull with no
 * strains of its own gives you.
 */
export const TWITCH_PERIOD = strainOf("spasm").period;
export const SPREAD_TURNS = strainOf("spasm").spread;

/** How loud a twitch is. Heard on the turn it happens; see `addNoise`. */
export const TWITCH_NOISE = 6;

/**
 * Consecutive turns a purge takes by hand.
 *
 * No module at all (G90, the owner): «лечится без модулей, но за время». It
 * used to be two turns of welding, which made the WELDER the whole cure and a
 * drone without one simply carried the thing home — and a player reading the
 * card could not tell why a welder, of all things, was the answer.
 */
export const CURE_TURNS = 6;

/**
 * The same purge with a SPIKE in the rack: half the turns, and the SPIKE is
 * what a blow lands on while it works (`twist/rig.ts`, `actExposure`). The
 * owner again: «ОТМЫЧКА ускоряет лечение».
 */
export const SPIKE_CURE_TURNS = 3;

/** Hands-on work, as loud as searching a body (`systems/doors.ts`). */
const PURGE_NOISE = 2;

/**
 * What the tug charges to clean one (design-doc.md, "Экономика рейса"), and
 * what the hold pays for an infected module. Read by the bench and the hold
 * (G19/G26) when they are wired up; the numbers belong to this mechanic.
 */
export const BENCH_CURE_PRICE = 4;
export const INFECTED_SELL_SHARE = 0.5;

/**
 * Colours are copied from ui/theme.ts on purpose: src/systems must not import
 * the renderer's palette, and a panel line is data either way.
 */
const BAD_FG = "#d96a6a"; // THEME.bad

/** Said once a run, the turn the drone first brings something aboard. */
export const VIRUS_HINT_KEY = "hint.virus";

/** The verb this system owns. Everything else falls through to the next one. */
const CURE_VERB = "cure";

const FAIL = (reason: string): Outcome => ({ ok: false, cost: 0, reason });
const DONE = (): Outcome => ({ ok: true, cost: TURN_COST });

// ---------------------------------------------------------------- the chance

/** design-doc.md, "Вирус", one row at a time. A crate is factory-sealed, a
 * machine is the ship's own, a drone is what is left of somebody who came here
 * to do this job. */
const SOURCE_CHANCE: Record<WreckSource, number> = {
  crate: 0,
  machine: 0.1,
  drone: 0.15,
  ghost: 0.25,
  // A competitor's drone is the same kind of thing as your own wreck: a rack
  // that has been aboard derelicts, not a thing the derelict grew.
  rival: 0.15,
};

/**
 * How likely this piece of salvage is carrying the virus, hull bonus included
 * (`DerelictSpec.virusBonus`: a quarantine ship adds 0.15).
 *
 * A crate stays at zero whatever the hull adds. That is the contract the crate
 * exists for — it is the safe, boring option the player passes up when they
 * take the scrap instead — and a quarantine ship that poisoned even the sealed
 * crates would leave nothing to pass up.
 */
export function infectChance(source: WreckSource, bonus = 0): number {
  const base = SOURCE_CHANCE[source];
  if (base <= 0) return 0;
  return Math.min(1, Math.max(0, base + bonus));
}

// ----------------------------------------------------------------- the state

export interface VirusState {
  /**
   * Which strain this is (`content/viruses.ts`). Optional, because a save
   * written before strains existed comes back without it, and a virus with no
   * name is the spasm the whole design document is about.
   */
  strain?: StrainId;
  /** Slot it sits in. The module there is the one that twitches. */
  slot: number;
  /**
   * Index in `game.inputs` of the command that put it in this slot, and the
   * whole of the clock: everything below counts turns as `inputs.length - since
   * - 1`, so the turn it came aboard is turn zero and the first full turn of
   * carrying it is turn one.
   */
  since: number;
  /**
   * Player turns the drone has carried it, across every module it has moved
   * through. Nothing in the turn cycle reads it; a bug report and the balance
   * harness count it.
   */
  turns: number;
  /** A purge in progress: turns left, and the command that did the last one. */
  curing?: { left: number; turn: number };
}

/**
 * The virus on this drone, if any. Defensive: `player.data` round-trips through
 * a save, so nothing in it is trusted to be the shape this file wrote.
 */
export function virusOf(player: Entity): VirusState | undefined {
  const raw = player.data?.virus;
  if (typeof raw !== "object" || raw === null) return undefined;
  const v = raw as Partial<VirusState>;
  if (typeof v.slot !== "number" || typeof v.since !== "number" || typeof v.turns !== "number") {
    return undefined;
  }
  // The live object, not a copy: everything below mutates it in place.
  return raw as VirusState;
}

/** How many turns a purge started now would take: a SPIKE halves it. */
export function cureTurns(rig: Rig): number {
  return findSlotAs(rig, "spike") === null ? CURE_TURNS : SPIKE_CURE_TURNS;
}

/**
 * Turns until the strain aboard does its thing again, counting the next turn
 * as one. The clock is `afterPlayerTurn`'s: a beat lands on the turn whose age
 * is a whole number of periods, and the turn it came aboard is age zero.
 */
export function turnsToBeat(game: RoomGame, v: VirusState): number {
  const period = strainOf(v.strain).period;
  const age = Math.max(0, game.inputs.length - v.since - 1);
  return period - (age % period);
}

/** Turns until it crawls into the next module, or undefined for a strain that stays. */
export function turnsToSpread(game: RoomGame, v: VirusState): number | undefined {
  const spread = strainOf(v.strain).spread;
  if (spread <= 0) return undefined;
  const age = Math.max(0, game.inputs.length - v.since - 1);
  return Math.max(1, spread - age);
}

/**
 * Take it off the drone and say which module it was in. The tug's bench calls
 * this after charging for it; in the field the purge is the only way.
 */
export function clearVirus(player: Entity): number | undefined {
  const v = virusOf(player);
  if (!v || !player.data) return undefined;
  delete player.data.virus;
  return v.slot;
}

/**
 * Which strain the hull the drone is standing on carries, drawn from the class's
 * own list (`DerelictSpec.strains`).
 *
 * Drawn from the ship's list and never from all four: a strain is a property of
 * the wreck, so the same hull always threatens the same things and a player can
 * learn what a quarantine ship does to salvage. A hand-drawn fixture and any
 * class that names none give the spasm.
 */
function strainOn(game: RoomGame): Strain {
  const listed = specOfShip(game.ship)?.strains ?? [];
  return strainOf(listed.length === 0 ? DEFAULT_STRAIN : game.rng.pick(listed));
}

/**
 * Roll for the module just put in `slot`, and infect it if the roll says so.
 * Returns whether it took.
 *
 * The call site is salvage: this is the whole of what "installing somebody
 * else's part is a risk" costs the rest of the game. One virus per drone — a
 * rack with one already aboard is not rolled for again, which keeps the clock
 * a single readable thing rather than three overlapping ones.
 */
export function tryInfect(game: RoomGame, slot: number, source: WreckSource, bonus = 0): boolean {
  const rig = rigOf(game.player);
  if (!rig || !rig.slots[slot]) return false;
  if (virusOf(game.player)) return false;

  const chance = infectChance(source, bonus);
  // A sealed crate never touches the rng at all, so a run that only ever opens
  // crates rolls the same stream as one played before this system existed.
  if (chance <= 0 || !game.rng.chance(chance)) return false;

  const data = (game.player.data ??= {});
  // Called from inside the command that installs the module, so `inputs.length`
  // is the index that command is about to take — turn zero of the clock.
  const strain = strainOn(game);
  const state: VirusState = { strain: strain.id, slot, since: game.inputs.length, turns: 0 };
  data.virus = state;
  game.log.add(
    t("log.virus.caught", { module: nameOf(rig, slot), virus: strainName(strain) }),
    game.schedule.time,
    "bad",
    "log.virus.caught",
  );
  hintOnce(game, "virus", virusHint());
  return true;
}

// ------------------------------------------------------------------ the tick

/**
 * One beat of whatever strain is aboard.
 *
 * Every beat is loud — the compartment hears it — and every beat says one line.
 * The four cases are the whole vocabulary of harm this mechanic has; a fifth
 * kind of harm is a row in `StrainBeat` and a case here, and a fifth *strain*
 * is neither (`content/viruses.ts`).
 */
function beat(game: RoomGame, rig: Rig, v: VirusState, strain: Strain): void {
  addNoise(game, game.roomOf(game.player).id, TWITCH_NOISE);
  const module = nameOf(rig, v.slot);
  const virus = strainName(strain);

  switch (strain.beat.kind) {
    case "expose":
      // Setting `rig.exposed` works because the twist is `systems[0]`: it has
      // already marked what the command put at risk, and everything that reads
      // the marker (`routeDamage`, and so every machine acting after this hook)
      // reads it after. The virus overrules the player's own choice, which is
      // the whole of this strain.
      rig.exposed = v.slot;
      say(game, "log.virus.twitch", { module, virus });
      return;

    case "wear": {
      // The same wearing-out a blow does, scar and burn-out included: a module
      // lost to rot must leave the rack in a state the rest of the game already
      // knows how to read (`hitSlot`, twist/rig.ts).
      const hit = hitSlot(rig, v.slot, strain.beat.points);
      applyDerived(game.player);
      if (hit.burned) say(game, "log.virus.rot.burned", { module, virus });
      else say(game, "log.virus.rot", { module, virus, left: hit.remaining });
      return;
    }

    case "skim": {
      // Through `systems/purse.ts` and not through the account: importing
      // `systems/voyage.ts` here closes a cycle that takes the whole build
      // down at module-load time. The reason is written out in that file.
      const took = takeCredits(game, strain.beat.credits);
      if (took > 0) say(game, "log.virus.skim", { virus, amount: took });
      else say(game, "log.virus.skim.empty", { virus });
      return;
    }

    case "core":
      // Straight at the core, past the rack: three points and never healed, so
      // a leash left alone is a dead drone on a clock. `applyDamage` rather
      // than `dealDamage` on purpose — the rack does not get to intercept a
      // thing that is already inside the drone.
      applyDamage(game.player, strain.beat.points);
      say(game, "log.virus.core", { virus, left: Math.max(0, game.player.hp) });
      return;
  }
}

/** One line, keyed so the sound table and the tests can find it. */
function say(game: RoomGame, key: Key, params: Record<string, string | number>): void {
  game.log.add(t(key, params), game.schedule.time, "bad", key);
}

/**
 * A sound heard on the turn it is made.
 *
 * `makeNoise` queues a source for the *next* settle, which is one turn too late
 * for a spasm the machines standing in the room are about to act on: the field
 * was settled before `afterPlayerTurn` ran and the AI reads it immediately
 * after. So the source is propagated and merged into the settled field, the way
 * `RIG.muffle` edits it — the loudest per room, never a sum, which is
 * `propagateRooms`' own rule for two sources at once.
 *
 * Deliberately not muffled by a BAFFLE. The module dampens the noise of what
 * the drone *does*, and a twitch is not something the drone did — that it gives
 * away a quiet hull is the point of carrying a virus at all.
 */
function addNoise(game: RoomGame, room: RoomId, strength: number): void {
  const heard = propagateRooms(game.ship, [{ room, strength }]);
  const merged = new Map(game.noise);
  for (const [id, level] of heard) {
    if (level > (merged.get(id) ?? 0)) merged.set(id, level);
  }
  game.noise = merged;
}

/**
 * Twenty turns uncured and it moves on, round the rack, skipping the slots that
 * burned out. A rack with nothing else intact keeps it where it is: there is
 * nowhere to go, and the clock simply keeps trying.
 */
function spread(game: RoomGame, rig: Rig, v: VirusState): void {
  const next = nextIntact(rig, v.slot);
  if (next === undefined) return;

  const from = nameOf(rig, v.slot);
  v.slot = next;
  // Called from `afterPlayerTurn`, where the command that carried it across is
  // already recorded: one back is that command's own index, which is turn zero
  // in the new slot exactly as it was in the old one.
  v.since = game.inputs.length - 1;
  delete v.curing;
  game.log.add(
    t("log.virus.moves", { from, to: nameOf(rig, next) }),
    game.schedule.time,
    "bad",
    "log.virus.moves",
  );
}

/** The next filled slot after `from`, going round; undefined if it is the only one. */
function nextIntact(rig: Rig, from: number): number | undefined {
  for (let step = 1; step < rig.slots.length; step++) {
    const i = (from + step) % rig.slots.length;
    if (rig.slots[i]) return i;
  }
  return undefined;
}

// ----------------------------------------------------------------- the purge

/**
 * `act cure {slot}`: six turns in a row by hand, three with a SPIKE, and the
 * virus is gone.
 *
 * It mends nothing — the module comes out of it exactly as damaged as it went
 * in — so a purge is turns bought with nothing but time, which is the price
 * the mechanic is meant to charge. Nothing in the rack is required: a drone
 * that cannot afford the turns has the bench, the hold and the sale.
 */
function purge(game: RoomGame, slot: number | undefined): Outcome {
  const rig = rigOf(game.player);
  const v = rig ? virusOf(game.player) : undefined;
  if (!rig || !v || !rig.slots[v.slot]) return FAIL(t("why.virus.none"));
  if (slot !== undefined && slot !== v.slot) return FAIL(t("why.virus.clean"));

  const left = advance(game, v, cureTurns(rig));
  game.makeNoise(game.roomOf(game.player).id, PURGE_NOISE);
  if (left > 0) {
    game.log.add(
      t("log.virus.purge.on", { module: nameOf(rig, v.slot), left }),
      game.schedule.time,
      "plain",
      "log.virus.purge.on",
    );
    return DONE();
  }

  const name = nameOf(rig, v.slot);
  clearVirus(game.player);
  game.log.add(t("log.virus.purge.done", { module: name }), game.schedule.time, "good", "log.virus.purge.done");
  return DONE();
}

/**
 * One more turn of the purge, or the first turn of it, and how many are left.
 *
 * Stamped with the index this command will take, so the job resumes only from
 * the turn immediately before it — the same rule cutting and welding a door go
 * by (`systems/doors.ts`), and the one that makes a purge its turns *in a row*.
 */
function advance(game: RoomGame, v: VirusState, total: number): number {
  const resumed = v.curing !== undefined && v.curing.turn === game.inputs.length - 1;
  const left = (resumed ? v.curing!.left : total) - 1;
  if (left > 0) v.curing = { left, turn: game.inputs.length };
  else delete v.curing;
  return left;
}

/**
 * A purge, as the shared job (`systems/jobs.ts`).
 *
 * No target: this is work on the drone's own rack, not on anything standing in
 * the compartment, so it draws on the rack and nowhere on the board. The total
 * is asked of the rig every time rather than remembered, because fitting a
 * SPIKE halves it mid-purge and the bar must not lie about what is left.
 */
registerJob((game) => {
  const rig = rigOf(game.player);
  const v = rig === undefined ? undefined : virusOf(game.player);
  if (rig === undefined || v?.curing === undefined) return undefined;
  const of = cureTurns(rig);
  return { what: "purge", done: Math.max(0, of - v.curing.left), of };
});

/** Anything but another turn of purging drops the job where it stands. */
function breakOff(game: RoomGame, v: VirusState): void {
  if (v.curing === undefined || v.curing.turn === game.inputs.length - 1) return;
  const was = jobNow(game);
  delete v.curing;
  if (was !== undefined) sayBrokenOff(game, was.what, was.done, was.of);
}

// ---------------------------------------------------------------- the system

export const VIRUS: System<RoomGame> = {
  name: "virus",

  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    const rig = rigOf(game.player);
    const v = rig ? virusOf(game.player) : undefined;
    if (!rig || !v) return;

    breakOff(game, v);

    // The module it lived in burned out: whatever hit it took the virus with
    // it. Burning your own infected module is a real, expensive way out.
    if (!rig.slots[v.slot]) {
      clearVirus(game.player);
      game.log.add(t("log.virus.burned"), game.schedule.time, "good", "log.virus.burned");
      return;
    }

    // The turn the module went in is turn zero: a part cannot twitch on the
    // turn it is still being bolted on.
    const age = game.inputs.length - v.since - 1;
    if (age <= 0) return;

    const strain = strainOf(v.strain);
    v.turns++;
    if (age % strain.period === 0) beat(game, rig, v, strain);
    // A strain that eats one module or goes for the core has nothing to gain by
    // moving, and says so with `spread: 0`.
    if (strain.spread > 0 && age >= strain.spread) spread(game, rig, v);
  },

  performCommand(game, actor, cmd): Outcome | undefined {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== CURE_VERB) return undefined;
    return purge(game, cmd.slot);
  },

  offerActions(game) {
    const offers: Array<ActionOffer<RoomCommand>> = [];
    if (game.status !== "playing") return offers;
    const rig = rigOf(game.player);
    const v = rig ? virusOf(game.player) : undefined;
    if (!rig || !v || !rig.slots[v.slot]) return offers;

    // Counted down the same way `work ENGINE (2 turns)` counts itself down
    // (`systems/ship.ts`): a purge is the only multi-turn job that used to print
    // a constant, and a bot reading "the line came back unchanged" as "nothing
    // happened" pressed it forever instead of once
    // (docs/tasks/G30-balance-v2.md, "Хуже стало одно…").
    //
    // Always enabled: nothing in the rack is required any more, and the price
    // in brackets says which of the two speeds this drone gets.
    const left = v.curing?.left ?? cureTurns(rig);
    const module = nameOf(rig, v.slot);
    const label =
      findSlotAs(rig, "spike") === null
        ? t("action.purge", { module, left })
        : t("action.purge.spike", { module, left, spike: moduleName("spike") });
    offers.push({ label, cmd: { kind: "act", verb: CURE_VERB, slot: v.slot }, enabled: true });
    return offers;
  },

  panelLines(game) {
    const rig = rigOf(game.player);
    const v = rig ? virusOf(game.player) : undefined;
    if (!rig || !v || !rig.slots[v.slot]) return [];
    return [{ text: harmLine(strainOf(v.strain)), fg: BAD_FG }];
  },
};

/**
 * The panel's one line about it: the strain and what it does, with its number,
 * in 28 columns — «SPASM in CELL» said where it was and nothing about why that
 * was bad (G90). Which module is the rack's own `!` two blocks up; the window
 * behind `v` says the rest.
 */
export function harmLine(strain: Strain): string {
  const virus = strainName(strain);
  const period = strain.period;
  const beat = strain.beat;
  switch (beat.kind) {
    case "expose":
      return t("panel.virus.expose", { virus, period });
    case "wear":
      return t("panel.virus.wear", { virus, period, points: beat.points });
    case "skim":
      return t("panel.virus.skim", { virus, period, credits: beat.credits });
    case "core":
      return t("panel.virus.core", { virus, period, points: beat.points });
  }
}

// -------------------------------------------------------------------- pieces

/** What the panel and the log call the module in that slot. */
export function nameOf(rig: Rig, slot: number): string {
  const kind: ModuleId | undefined = rig.slots[slot]?.kind;
  return kind === undefined ? t("word.module") : moduleName(kind);
}

/** The onboarding line, with the purge's two speeds filled in from the numbers above. */
export function virusHint(): string {
  return t(VIRUS_HINT_KEY, { turns: CURE_TURNS, fast: SPIKE_CURE_TURNS, spike: moduleName("spike") });
}

/** One onboarding line, said once per run. Same bag of flags the rig writes. */
function hintOnce(game: RoomGame, flag: string, text: string): void {
  const data = (game.player.data ??= {});
  const said = (data.hints as Record<string, boolean> | undefined) ?? {};
  data.hints = said;
  if (said[flag] === true) return;
  said[flag] = true;
  game.log.add(text, game.schedule.time, "warn");
}
