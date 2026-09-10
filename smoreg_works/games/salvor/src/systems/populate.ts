import {
  KEY_MARK,
  spawnMonsterIn,
  type MonsterKind,
  type Room,
  type RoomGame,
  type System,
} from "@jamrog/engine";
import { CARD_MODULE, SALVAGE_POOL, type ModuleId } from "../content/cards.js";
import { RELIC_CHANCE, RELIC_DEPTH, specOfShip, type DerelictSpec } from "../content/derelicts.js";
import { MODULES, SCRAP_INTEGRITY, type ModuleId as ModuleKindId } from "../content/modules.js";
import { CROWD, MAX_MACHINES, machineAboard } from "../content/monsters.js";
import { SYSTEM_GLYPH } from "../content/objectives.js";
import { isTug } from "../content/tug.js";
import { nextShipId } from "../twist/rig.js";
import { notePost } from "./alert.js";
import { placeHazards } from "./hazards.js";

/**
 * Turns the marks a card left into things standing in a compartment.
 *
 * The generator only ever writes strings: it has no idea what a maintenance bot
 * or a welder is, and must not (`packages/engine/src/rooms/gen/shipgen.ts`).
 * This system is the one place where `m`, `X:scanner`, `†` and `E` become
 * machines, salvage, bodies and the ship's systems — so a new card is a few
 * lines in `content/cards.ts` and nothing else. The legend lives with the
 * cards; this file is the half that executes it.
 *
 * Everything it writes goes into `room.data`, flat and with an id: the drone
 * acts on a compartment's contents by number (`act salvage 2`), and the
 * compartment belongs to the ship, so what is left in it survives a sortie and
 * comes back the same on the next one.
 */

/**
 * A module lying in a compartment, waiting to be stripped. Two shapes in one
 * list, because the rig strips both with the same verb and reads them out of
 * `room.data.wrecks`: `%` scrap off a dead machine at integrity 1-3, and `X` a
 * parts crate holding the module at its base.
 */
export interface Wreck {
  id: number;
  kind: ModuleId;
  integrity: number;
  /** Character the schematic draws it with: `%` scrap, `X` crate. */
  glyph: string;
  /**
   * Written only for a relic crate, which is factory-sealed: the virus reads
   * the source of a pile (`twist/rig.ts`, `WreckSource`), and a pile with none
   * recorded is the ship's own machinery, which a sealed crate is not.
   */
  source?: "crate";
}

/** A crew body: three credits, and sometimes a keycard. */
export interface Body {
  id: number;
  searched: boolean;
  /** Id of the door key on it, when it carries one. */
  key?: string;
}

/**
 * A container worth credits and nothing else. A crate of modules is not one of
 * these — it goes into `wrecks`, where the rig can reach it.
 */
export interface Crate {
  id: number;
  kind: "cargo" | "contraband";
}

/** One of the three systems a derelict is neutralised by. */
export interface ShipSystem {
  id: number;
  kind: "engine" | "core" | "terminal";
  online: boolean;
  /**
   * Character the schematic draws it with (`content/objectives.ts`).
   *
   * On the record rather than looked up from the kind, because the picture
   * reads a compartment's contents as a flat list of things with a glyph on
   * them (`ui/schematic-input.ts`, `asThing`) and knows no word for a system.
   * Until this field existed the systems were the one kind of content that had
   * no glyph, so the three compartments a run is *for* were drawn as empty
   * boxes (docs/owner-queue.md, 4). Optional, because a ship stored by an older
   * build comes back without it.
   */
  glyph?: string;
}

/**
 * A charter's errand: the thing to carry home, or the console to upload from —
 * and what a dead bloom leaves, which no card marks and `systems/bloom.ts` is
 * the only writer of.
 */
export interface RoomItem {
  id: number;
  kind: "charter-item" | "console" | "biomass";
  /**
   * What the errand left behind, kept in the compartment it happened in.
   *
   * A derelict is a place the run walks back into, so "already carried out" and
   * "already uploaded" have to survive a sortie (design-doc.md, "Персистентный
   * дереликт"). Positive evidence and not an absence: a charter that read "the
   * crate is gone" would count itself done on a hull where no crate was ever
   * placed. `turns` is an upload half-finished, dropped by anything else the
   * drone does.
   */
  taken?: boolean;
  uploaded?: boolean;
  turns?: number;
}

/**
 * How deep a machine catalogue is searched when a mark names one exactly. A
 * band is a function of depth, and `m:scout` means "this machine, wherever it
 * would normally stand" — the tutorial scout is asked for at depth 0, where the
 * band is empty by design.
 */
const DEEPEST_BAND = 8;

/**
 * How far in the budget's own filler is allowed to stand.
 *
 * The compartment behind the airlock door is the first thing a run ever sees,
 * and design-doc.md, "Обучение конструкцией" gives the drone one weak machine
 * from the docking bay card there and nothing else to answer at once. A machine
 * dropped into the next compartment turns that into two fights before the
 * player has salvaged anything, which is what the gate measured. The deck may
 * still put one a door in — behind its bulkhead, where walking in is a decision
 * the player makes — but nothing arrives there by budget alone.
 */
const FILLER_DEPTH = 2;

/** Which system each mark stands for. */
const SYSTEM_MARK: Readonly<Record<string, ShipSystem["kind"]>> = {
  E: "engine",
  O: "core",
  T: "terminal",
};

export const POPULATE: System<RoomGame> = {
  name: "populate",

  /**
   * First entry only. A derelict is a place the run walks back into, so a
   * second sortie finds what the first one left and not a fresh ship's worth of
   * crates — that is what `visits` is for.
   *
   * And derelicts only: the tug is the drone's own hull, and nobody ever left
   * anything lying about in it (`content/tug.ts`).
   */
  onLevelEnter(game) {
    if (isTug(game) || game.currentShip.visits !== 1) return;
    const spec = specOfShip(game.ship);
    for (const room of game.ship.rooms) fill(game, spec, room);
    ensureOnboardingScrap(game);
    // The relic and its guard before the filler: the guard is counted against
    // the class's budget like the deck's own machines are, so a hull with a
    // relic is a hull whose crate is held, not a hull with more aboard.
    placeRelic(game, spec);
    fillToBudget(game, spec);
    // Hazards last and on their own budget (`content/hazards.ts`, rule 5): a
    // machine costs whatever the drone does, a hazard costs only a mistake,
    // so the two never trade against each other.
    placeHazards(game, spec);
  },
};

// ------------------------------------------------------------------- marks

function fill(game: RoomGame, spec: DerelictSpec | undefined, room: Room): void {
  // Bodies a card marked as the one holding a key (`†:key`), by id.
  const holders: number[] = [];
  for (const mark of room.marks) applyMark(game, spec, room, mark, holders);
  // Keys last: the generator wrote `key:k1` into whichever room its rule
  // allowed, and it belongs on a body — the one the card meant, any other one
  // lying there, or a fresh one when nothing did.
  for (const mark of room.marks) {
    if (mark.startsWith(KEY_MARK)) giveKey(game, room, mark.slice(KEY_MARK.length), holders);
  }
}

function applyMark(
  game: RoomGame,
  spec: DerelictSpec | undefined,
  room: Room,
  mark: string,
  holders: number[],
): void {
  const [head, ...rest] = mark.split(":");

  switch (head) {
    case "m":
      spawn(game, room, rest[0] ? machineById(game, rest[0]) : bandPick(game, spec, room.depth));
      return;
    case "M":
      spawn(game, room, heaviest(game, spec, room.depth));
      return;
    case "X": {
      const kind = rest[0] ?? game.rng.pick(SALVAGE_POOL);
      bucket<Wreck>(room, "wrecks").push({
        id: nextShipId(game),
        kind,
        integrity: crateIntegrity(kind),
        glyph: "X",
      });
      return;
    }
    case "%":
      bucket<Wreck>(room, "wrecks").push({
        id: nextShipId(game),
        kind: rest[0] ?? game.rng.pick(SALVAGE_POOL),
        integrity: rest[1] ? Number(rest[1]) : game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]),
        glyph: "%",
      });
      return;
    case "†": {
      const body: Body = { id: nextShipId(game), searched: false };
      bucket<Body>(room, "bodies").push(body);
      if (rest[0] === "key") holders.push(body.id);
      return;
    }
    // The two crates a compartment can hold. `cargo` is what the hull was
    // hauling and `contraband` is what it was not declaring; both are credits
    // and nothing else, and the price of each is the voyage's to name.
    case "cargo":
    case "contraband":
      bucket<Crate>(room, "crates").push({ id: nextShipId(game), kind: head });
      return;
    case "*":
      bucket<RoomItem>(room, "items").push({ id: nextShipId(game), kind: "charter-item" });
      return;
    case "&":
      bucket<RoomItem>(room, "items").push({ id: nextShipId(game), kind: "console" });
      return;
    case "E":
    case "O":
    case "T":
      bucket<ShipSystem>(room, "systems").push({
        id: nextShipId(game),
        kind: SYSTEM_MARK[head]!,
        online: false,
        glyph: SYSTEM_GLYPH,
      });
      return;
    case "cover":
      room.cover = true;
      return;
    case "vented":
      room.hazard = head;
      return;
    default:
      // `key:` is handled after the room is filled, `lock-entry` was the
      // generator's own and is spent. Anything else is a mark from a card this
      // build no longer ships, and a ship with an unknown mark in it is still a
      // ship to play.
      return;
  }
}

/** The key goes on a body: search the dead, or there is no keycard. */
function giveKey(game: RoomGame, room: Room, id: string, holders: readonly number[]): void {
  const bodies = bucket<Body>(room, "bodies");
  const free = bodies.filter((b) => b.key === undefined);
  const body = free.find((b) => holders.includes(b.id)) ?? free[0];
  if (body) body.key = id;
  else bodies.push({ id: nextShipId(game), searched: false, key: id });
}

// ---------------------------------------------------------------- machines

/**
 * What can stand in this compartment: the catalogue at this depth, narrowed to
 * the machines the hull class carries.
 *
 * `DerelictSpec.band` is the second half of the depth band, and until now it
 * was data nothing read — which is how a hauler with fourteen hit points ended
 * up guarding the tutorial freighter's reactor, on a hull design-doc.md, "Типы
 * дереликтов" gives `m` `d` `c` and nothing else. Depth says how deep a machine
 * belongs; the band says whose ship it is aboard, and both have to hold.
 *
 * A ship no class built has no band to narrow by, and the depth catalogue is
 * the whole answer there — a hull drawn by hand in a test holds what the test
 * wrote into it. A class naming an id no catalogue has is caught by
 * `tests/ship-content`; a band that comes out empty at some depth means the
 * class fields nothing that shallow, and the compartment stays empty.
 */
function bandAt(game: RoomGame, spec: DerelictSpec | undefined, depth: number): MonsterKind[] {
  const kinds = game.content.monstersForDepth(depth);
  if (!spec) return kinds;

  const band = kinds.filter((k) => spec.band.includes(k.id));
  // A band may name a machine the depth catalogue never offers — the father's
  // tug names the ENFORCER, which no roll anywhere else produces. Naming it is
  // the class saying it fields one, and the depth window is still its own.
  for (const id of spec.band) {
    if (band.some((k) => k.id === id)) continue;
    const extra = machineAboard(id);
    if (extra && depth >= extra.minDepth && depth <= extra.maxDepth) band.push(extra);
  }
  return band;
}

/**
 * One machine of this compartment's band, by the weights the engine spawner
 * uses — with a floor of one for anything the class named itself.
 *
 * The floor is what makes a band a band. Four machines carry `weight: 0` in the
 * bestiary so that the shared depth roll can never produce them
 * (`content/monsters.ts`), and three classes field exactly those: the military
 * hull's turrets, the quarantine hull's crawlers and blooms. Inside a band the
 * question is already answered — this class holds these machines — so a zero
 * there would mean a quarantine hull whose filler is all scrappers, which is
 * the one thing that hull is not.
 */
function bandPick(game: RoomGame, spec: DerelictSpec | undefined, depth: number): MonsterKind | undefined {
  const kinds = bandAt(game, spec, depth);
  if (kinds.length === 0) return undefined;

  const table: Record<string, number> = {};
  for (const k of kinds) table[k.id] = spec ? Math.max(1, k.weight) : k.weight;
  const id = game.rng.weighted(table);
  return kinds.find((k) => k.id === id);
}

/**
 * The heaviest thing this class fields this deep, by HP. Ties go to the earlier
 * entry in the bestiary, so a card's `M` is the same machine on the same seed
 * however the table is later reordered around it.
 */
function heaviest(game: RoomGame, spec: DerelictSpec | undefined, depth: number): MonsterKind | undefined {
  let best: MonsterKind | undefined;
  for (const k of bandAt(game, spec, depth)) {
    if (!best || k.hp > best.hp) best = k;
  }
  return best;
}

// ------------------------------------------------------------------ budget

/**
 * Tops the ship up to the one machine budget its class has
 * (`DerelictSpec.machines`), the deck's own machines counted first.
 *
 * The deck places where the fiction says — a scout in the docking bay, two
 * behind the bulkhead, one on each of the three systems — and it is authored,
 * capped per ship and the same on every seed. What is left of the budget is
 * spread over compartments the deck left empty, two doors in or deeper, in an
 * order the run's own rng shuffles: which rooms are held is a fact about this
 * seed, and one the drone can only learn by opening doors.
 *
 * The budget is rolled whatever the deck did, so the stream stays the same
 * length on every seed; a deck that already filled it simply spends nothing.
 * A ship no class built has no budget and gets no filler at all.
 */
function fillToBudget(game: RoomGame, spec: DerelictSpec | undefined): void {
  if (!spec) return;
  const target = Math.min(game.rng.int(spec.machines[0], spec.machines[1]), MAX_MACHINES);
  const empty = game.ship.rooms.filter((r) => r.depth >= FILLER_DEPTH && !holdsMachine(game, r));
  game.rng.shuffle(empty);

  let aboard = machinesAboard(game);
  for (const room of empty) {
    if (aboard >= target) return;
    const kind = bandPick(game, spec, room.depth);
    if (!kind) continue;
    spawn(game, room, kind);
    aboard++;
  }
}

/** Machines on the ship right now. Everything aboard but the drone is one. */
function machinesAboard(game: RoomGame): number {
  return game.entities.filter((e) => e.id !== game.player.id).length;
}

function holdsMachine(game: RoomGame, room: Room): boolean {
  return game.entitiesIn(room.id).some((e) => e.id !== game.player.id);
}

/** A machine by id, whatever band it belongs to. Absent = this build has none. */
function machineById(game: RoomGame, id: string): MonsterKind | undefined {
  for (let depth = 0; depth <= DEEPEST_BAND; depth++) {
    const hit = game.content.monstersForDepth(depth).find((k) => k.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * One machine into a compartment, unless the compartment is already as full
 * as a compartment gets (`CROWD`): a deck that puts four marks in one box is
 * three machines, and the fourth is simply not there — the budget is a
 * ceiling, not a promise.
 */
function spawn(game: RoomGame, room: Room, kind: MonsterKind | undefined): void {
  if (!kind || crowded(game, room)) return;
  const machine = spawnMonsterIn(kind, room.id);
  notePost(machine);
  game.schedule.admit(machine);
  game.entities.push(machine);
}

/** Does this compartment already hold as many machines as one may? */
function crowded(game: RoomGame, room: Room): boolean {
  return game.entitiesIn(room.id).filter((e) => e.id !== game.player.id).length >= CROWD;
}

// ------------------------------------------------------------------ relics

/**
 * One relic crate a hull, and the machine standing over it.
 *
 * The crate is a parts crate like any other — `X`, the module at its base,
 * stripped with the same verb — and what tells the player it is worth a fight
 * is where it is and what is with it: never nearer than `RELIC_DEPTH` doors,
 * never in a compartment the run has to enter anyway for a system, and with
 * one machine of the band spawned into that compartment before the budget's
 * filler runs, so that the compartment is held whatever the shuffle would have
 * done with it. The sensor pulse names the crate when it reads the room
 * (`twist/rig.ts`, `pulse`), so a scan is how a relic is found on purpose
 * rather than walked into.
 *
 * The guard is one of the class's machines, not one over them: it is placed
 * ahead of the filler and counted by it, and it is skipped only on a hull the
 * deck alone has already filled to the class's ceiling. A ship's head count is
 * a fact of its class (`DerelictSpec.machines`, held by `tests/ship-content`),
 * and a relic changes where the machines stand, not how many there are.
 *
 * A hull that names no relic draws nothing and rolls nothing. A hull that
 * names one draws `RELIC_CHANCE` exactly once, so a seed's stream is the same
 * length whether the crate came up or not. Exported and handed the class as an
 * argument so a test can put a relic on a hand-drawn ship stamped as any class
 * and count what changed.
 */
export function placeRelic(game: RoomGame, spec: DerelictSpec | undefined): Room | undefined {
  const relics = spec?.relics ?? [];
  if (!spec || relics.length === 0) return undefined;
  if (!game.rng.chance(RELIC_CHANCE)) return undefined;

  const kind = game.rng.pick(relics);
  const entry = game.ship.entry;
  const rooms = game.ship.rooms.filter(
    (r) => r.id !== entry && r.depth >= RELIC_DEPTH && roomList<ShipSystem>(r, "systems").length === 0,
  );
  if (rooms.length === 0) return undefined;

  const room = game.rng.pick(rooms);
  bucket<Wreck>(room, "wrecks").push({
    id: nextShipId(game),
    kind,
    integrity: crateIntegrity(kind),
    glyph: "X",
    source: "crate",
  });
  if (machinesAboard(game) < Math.min(spec.machines[1], MAX_MACHINES)) {
    spawn(game, room, bandPick(game, spec, room.depth) ?? heaviest(game, spec, DEEPEST_BAND));
  }
  return room;
}

// -------------------------------------------------------------- onboarding

/**
 * The first derelict of a voyage always has salvage in the room the drone lands
 * in, whatever the docking bay card rolled: pressing the number next to
 * `salvage WELDER` in the first few turns is the whole of the onboarding
 * (design-doc.md, "Обучение конструкцией", 2).
 */
function ensureOnboardingScrap(game: RoomGame): void {
  if (game.ships.size !== 1) return;

  const room = game.ship.roomAt(game.ship.entry);
  if (roomList<Wreck>(room, "wrecks").length > 0) return;

  bucket<Wreck>(room, "wrecks").push({
    id: nextShipId(game),
    kind: CARD_MODULE["docking bay"] ?? "welder",
    integrity: game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]),
    glyph: "%",
  });
}

// ------------------------------------------------------------------- store

/**
 * What a parts crate holds: the module at its **base** integrity, read off the
 * one table that has the number (`content/modules.ts`). A mark naming a module
 * this build has no entry for comes from a deck it no longer ships, and is
 * worth what scrap is worth rather than nothing at all.
 *
 * Ids come from `nextShipId`: the same counter the rig draws from, so a crate,
 * a body and the wreck a machine leaves when it dies can never collide — and
 * `act salvage 4` means the same thing on the second sortie as on the first.
 */
function crateIntegrity(kind: string): number {
  return MODULES[kind as ModuleKindId]?.integrity ?? SCRAP_INTEGRITY[1];
}

/** The named list in a room, created on first use. */
function bucket<T>(room: Room, key: string): T[] {
  const data = room.data as Record<string, T[] | undefined>;
  const list = data[key] ?? [];
  data[key] = list;
  return list;
}

/** The named list, without writing an empty one into a room that has none. */
export function roomList<T>(room: Room, key: string): readonly T[] {
  return (room.data as Record<string, T[] | undefined>)[key] ?? [];
}
