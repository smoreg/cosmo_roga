import { Rng } from "../sim/rng.js";
import { Schedule, TURN_COST } from "../sim/schedule.js";
import { MessageLog } from "../sim/log.js";
import { LevelStore, levelSeed, type LevelId } from "../sim/levelstore.js";
import { isAlive, newIdSeq, useIds, type Entity } from "../sim/entity.js";
import { NO_TWIST, type LeaveReason, type TurnHost, type Twist } from "../sim/twist.js";
import { statusLine, tickStatuses } from "../sim/status.js";
import { spawnMonsterIn, type RoomContentPack } from "../content/kinds.js";
import type { Outcome } from "../sim/actions.js";
import type { GameStatus } from "../sim/game.js";
import { label, perform, type RoomCommand, type RoomOutcome } from "./actions.js";
import { runNonPlayerTurns } from "./ai.js";
import { propagateRooms } from "./noise.js";
import { canSee, visibleRooms } from "./sight.js";
import type { Room, RoomId, Ship } from "./graph.js";

/** Used when the content pack does not name the ending itself. */
const DEFAULT_WIN_LINE = "The airlock closes behind you. You are out, and alive.";
const DEFAULT_DEATH_LINE = "The drone goes dark. The ship keeps what it takes.";

/** One derelict of a run, kept so the drone can go back aboard. */
export interface StoredShip {
  ship: Ship;
  /** Everyone who was aboard when the drone left. Never the player. */
  entities: Entity[];
  /**
   * Deterministic per-ship stream seed, derived from the run seed and the id
   * without touching `game.rng`. What the ship did while nobody watched — which
   * doors the machines left open — forks from this and replays the same.
   */
  scheduleSeed: number;
  /** Free-form pocket for the game's own per-ship state. The engine never reads it. */
  data: Record<string, unknown>;
  /** Entries so far, including the one that created the ship. */
  visits: number;
}

export interface ShipTravelSpec {
  /** Builds the ship the first time this run goes there. */
  generate: (rng: Rng) => Ship;
  /** Where the drone lands. Default: the room holding the airlock. */
  entry?: RoomId;
  /** Why the ship being left is being left. Passed to `beforeLevelLeave`. */
  reason?: LeaveReason;
}

export interface RoomGameConfig {
  seed: number;
  /** The game being played. See content/kinds.ts. */
  content: RoomContentPack;
  /** The jam's one twist mechanic. See sim/twist.ts. */
  twist?: Twist<RoomGame>;
  /** Additional independent mechanics, run after the twist on every hook. */
  systems?: Twist<RoomGame>[];
  /** The ship the run starts on. */
  firstShip: (rng: Rng) => Ship;
  /** Its id in the store. Default "1". */
  firstShipId?: LevelId;
}

/**
 * The whole simulation on a graph of compartments. A port of `sim/game.ts`,
 * method for method: the same turn cycle, the same scheduler, the same store of
 * places to walk back into, over a `Ship` instead of a `Level`.
 *
 * Not a subclass of `Game`, and never will be: the two share a turn cycle and
 * nothing else — different worlds, different commands, different distances. The
 * common part is `TurnHost`, which is all a system needs to be written once.
 *
 * No DOM, no timers, no unseeded randomness — so it runs in vitest and replays
 * from (seed, command list).
 */
export class RoomGame implements TurnHost {
  readonly seed: number;
  readonly rng: Rng;
  readonly schedule = new Schedule();
  readonly log = new MessageLog();
  readonly content: RoomContentPack;
  readonly twist: Twist<RoomGame>;
  /** Twist first, then extra systems. Hooks run in this order. */
  readonly systems: readonly Twist<RoomGame>[];

  ship!: Ship;
  /** Which entry of `ships` the drone is aboard. */
  shipId: LevelId = "1";
  /**
   * Every derelict this run has generated, by id. Going back aboard is a real
   * return: the same graph, the same doors as they were left, the same corpses,
   * because nothing is regenerated and nothing is repopulated.
   */
  readonly ships = new LevelStore<StoredShip>();

  entities: Entity[] = [];
  player!: Entity;
  status: GameStatus = "playing";
  kills = 0;
  /** Every player command, in order. Replaying it against `seed` is the run. */
  readonly inputs: RoomCommand[] = [];
  /**
   * Run-wide flags a system can set and the generator can read: "the reactor
   * was breached", "the rival got here first". They outlive a ship, never a
   * run — writing one to storage would be meta-progression, which the jam
   * forbids.
   */
  readonly flags = new Set<string>();

  /**
   * How much noise arrived in each room this turn, from `propagateRooms`.
   * A missing room means silence. Rebuilt every player turn, so it never
   * goes stale.
   */
  noise: ReadonlyMap<RoomId, number> = new Map();
  /** Rooms the drone can see right now. Recomputed after every player turn. */
  visible: ReadonlySet<RoomId> = new Set();

  private pendingNoises: Array<{ room: RoomId; strength: number }> = [];
  /** True once a system says it owns the ending. Frozen for the run. */
  private readonly outcomeClaimed: boolean;
  /** False until the first ship is in place, so `travelTo` can build one. */
  private started = false;
  /**
   * This run's own entity numbering. Claimed on the way into anything that can
   * spawn, so a second run alive in the same process — a replay of a bug
   * report, a bot harness comparing two voyages — numbers its machines from its
   * own sequence and neither run can renumber the other's.
   */
  private readonly ids = newIdSeq();

  constructor(cfg: RoomGameConfig) {
    this.seed = cfg.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.content = cfg.content;
    this.twist = cfg.twist ?? NO_TWIST;
    this.systems = [this.twist, ...(cfg.systems ?? [])];
    this.outcomeClaimed = this.systems.some((s) => s.claimsOutcome === true);

    useIds(this.ids);
    this.travelTo(cfg.firstShipId ?? "1", { generate: cfg.firstShip });
    for (const sys of this.systems) sys.onRunStart?.(this);
    this.log.add(cfg.content.openingLine ?? "The airlock cycles. You are aboard.", 0, "warn");
  }

  // ----------------------------------------------------------------- ship flow

  /**
   * Go aboard the ship called `id`, generating it if this run has never been
   * there and lifting it out of the store if it has. The one way a run changes
   * ship: `leave` is a system's cue to call it, and so is a game's own "fly to
   * the next derelict".
   *
   * There is no `depth` here — depth is a property of a room, not of a ship —
   * so the hooks that want one are given the depth of the room the drone is
   * standing in, which for an arrival is the airlock's.
   */
  travelTo(id: LevelId, spec: ShipTravelSpec): void {
    useIds(this.ids);
    const first = !this.started;
    this.started = true;
    if (!first) {
      for (const sys of this.systems) {
        sys.beforeLevelLeave?.(this, this.roomOf(this.player).depth, spec.reason ?? "airlock");
      }
      this.stash();
    }

    const stored = this.ships.get(id) ?? this.generateInto(id, spec);
    stored.visits++;
    this.shipId = id;
    this.ship = stored.ship;

    if (first) this.player = this.content.makePlayer();
    this.player.room = spec.entry ?? this.ship.entry;
    this.entities = [this.player, ...stored.entities];
    this.schedule.admit(this.player);

    this.noise = new Map();
    this.pendingNoises = [];
    if (stored.visits === 1) this.populate(this.ship);
    for (const sys of this.systems) sys.onLevelEnter?.(this, this.roomOf(this.player).depth);
    this.refreshSight();
  }

  /** The store entry the drone is aboard, for a system's own bookkeeping. */
  get currentShip(): StoredShip {
    return this.ships.get(this.shipId)!;
  }

  /** Put the ship the drone is leaving back in the store, player excluded. */
  private stash(): void {
    const stored = this.currentShip;
    stored.entities = this.entities.filter((e) => e.id !== this.player.id);
  }

  private generateInto(id: LevelId, spec: ShipTravelSpec): StoredShip {
    const stored: StoredShip = {
      ship: spec.generate(this.rng),
      entities: [],
      scheduleSeed: levelSeed(this.seed, id),
      data: {},
      visits: 0,
    };
    this.ships.put(id, stored);
    return stored;
  }

  /**
   * One roll per room rather than one budget per ship: how dangerous a room is
   * follows from how far in it lies, and the cap is what keeps a big ship from
   * being a wall of machines.
   */
  private populate(ship: Ship): void {
    let placed = 0;

    for (const room of ship.rooms) {
      if (placed >= this.content.maxMonsters) return;
      if (room.depth < 1) continue;
      if (!this.rng.chance(this.content.monsterChance(room.depth))) continue;

      const kinds = this.content.monstersForDepth(room.depth);
      if (kinds.length === 0) continue;
      const table: Record<string, number> = {};
      for (const k of kinds) table[k.id] = k.weight;
      const id = this.rng.weighted(table);
      const kind = kinds.find((k) => k.id === id);
      if (!kind) continue;

      const m = spawnMonsterIn(kind, room.id);
      this.schedule.admit(m);
      this.entities.push(m);
      placed++;
    }
  }

  /**
   * Out through the airlock. With a system that claims the outcome this only
   * announces the departure — where it leads and whether the run is over are
   * that system's calls, made from `beforeLevelLeave`. With none, getting out
   * alive is the whole game and the engine says so.
   */
  leave(reason: LeaveReason = "airlock"): void {
    useIds(this.ids);
    if (this.outcomeClaimed) {
      for (const sys of this.systems) sys.beforeLevelLeave?.(this, this.roomOf(this.player).depth, reason);
      return;
    }
    this.finish("won", this.content.winLine ?? DEFAULT_WIN_LINE);
  }

  /**
   * End the run with the game's own words. The only way a game finishes one:
   * setting `status` by hand skips the line the player is owed.
   */
  finish(status: "won" | "dead", line: string): void {
    if (this.status !== "playing") return;
    this.status = status;
    this.log.add(line, this.schedule.time, status === "won" ? "good" : "bad");
  }

  // ---------------------------------------------------------------- turn cycle

  /**
   * The single entry point the UI calls. Returns the outcome so the UI can
   * distinguish "illegal, say why" from "turn taken, redraw".
   */
  playerCommand(cmd: RoomCommand): RoomOutcome {
    useIds(this.ids);
    if (this.status !== "playing") {
      return { ok: false, cost: 0, reason: "The run is over.", key: "engine.fail.over" };
    }

    const ready = this.schedule.next(this.entities);
    if (ready && ready.id !== this.player.id) {
      // Should not happen: the UI only asks on the player's turn. Catch up.
      runNonPlayerTurns(this);
    }

    const tick = tickStatuses(this.player, this.rng);
    if (tick.hpDelta < 0) this.log.add(`You take ${-tick.hpDelta} from your afflictions.`, this.schedule.time, "bad");
    for (const msg of tick.messages) this.log.add(`Your ${msg}.`, this.schedule.time, "plain");
    if (!isAlive(this.player)) {
      this.status = "dead";
      this.log.add(this.content.deathLine ?? DEFAULT_DEATH_LINE, this.schedule.time, "bad");
      return { ok: true, cost: 0 };
    }

    const outcome = perform(this, this.player, cmd);
    if (!outcome.ok) {
      // The reason is a line the player reads, so it carries its key and its
      // values through to the log the same way an event line does.
      if (outcome.reason) {
        this.log.add(outcome.reason, this.schedule.time, "warn", outcome.key, outcome.params);
      }
      return outcome;
    }

    this.inputs.push(cmd);
    this.schedule.spend(this.player, outcome.cost || TURN_COST);
    this.makeNoise(this.roomOf(this.player).id, commandNoise(cmd));
    this.settleNoise();
    for (const sys of this.systems) sys.afterPlayerTurn?.(this, cmd);
    this.reapDead();
    this.refreshSight();

    if (this.status === "playing" && isAlive(this.player)) {
      runNonPlayerTurns(this);
      this.reapDead();
      this.refreshSight();
    }

    if (!isAlive(this.player) && this.status === "playing") {
      this.status = "dead";
      this.log.add(this.content.deathLine ?? DEFAULT_DEATH_LINE, this.schedule.time, "bad");
    }
    return outcome;
  }

  /**
   * What the drone can see, and what it has stood in. Without a sensor that is
   * this room and nothing else — the blindness that makes walking through a
   * door a decision.
   */
  refreshSight(): void {
    const room = this.roomOf(this.player);
    room.explored = true;
    this.visible = visibleRooms(this.ship, room.id, this.player.sight ?? 0);
  }

  /** Register a sound. Louder carries further; shut doors swallow it. */
  makeNoise(room: RoomId, strength: number): void {
    this.pendingNoises.push({ room, strength });
  }

  private settleNoise(): void {
    this.noise = propagateRooms(this.ship, this.pendingNoises);
    this.pendingNoises = [];
  }

  onDeath(victim: Entity): void {
    if (victim.id !== this.player.id) this.kills++;
    for (const sys of this.systems) sys.onDeath?.(this, victim);
  }

  /** Called by the AI loop after each non-player actor has acted. */
  notifyActorTurn(actor: Entity): void {
    for (const sys of this.systems) sys.afterActorTurn?.(this, actor);
  }

  /** Drop corpses from the entity list, unless they still block. */
  reapDead(): void {
    this.entities = this.entities.filter((e) => isAlive(e) || e.blocksWhenDead === true || e.id === this.player.id);
  }

  // ------------------------------------------------------------------- queries

  /** The room an entity stands in. Everything aboard is in exactly one. */
  roomOf(e: Entity): Room {
    if (e.room === undefined) throw new Error(`RoomGame: ${e.name} is not aboard a ship`);
    return this.ship.roomAt(e.room);
  }

  entitiesIn(r: RoomId): Entity[] {
    return this.entities.filter((e) => e.room === r);
  }

  /** Machines the drone can see: this room, and the next one through a hole. */
  visibleMonsters(): Entity[] {
    return this.entities.filter((e) => e.id !== this.player.id && isAlive(e) && canSee(this.ship, this.player, e));
  }

  isOver(): boolean {
    return this.status !== "playing";
  }

  /** Standing in the room the airlock hangs off. */
  atAirlock(): boolean {
    return this.ship.doorsOf(this.roomOf(this.player).id).some((d) => d.state === "airlock");
  }

  describe(e: Entity): string {
    const statuses = statusLine(e);
    return `${label(this, e)} (${e.hp}/${e.hpMax})${statuses ? ` [${statuses}]` : ""}`;
  }
}

/**
 * Walking is quiet, fighting is not. This is the whole sound model.
 *
 * A game's own verbs are silent here on purpose: only the system that handles
 * one knows whether it was a cutting torch or a keycard, so it calls
 * `makeNoise` itself. Cutting a door is the exception the engine does own, and
 * it shouts from `perform`.
 */
function commandNoise(cmd: RoomCommand): number {
  switch (cmd.kind) {
    case "attack":
      return 9;
    case "go":
      return 3;
    default:
      return 0;
  }
}

/** Replay a recorded voyage. Used by tests and by bug reports from players. */
export function replayRooms(seed: number, cmds: RoomCommand[], cfg: Omit<RoomGameConfig, "seed">): RoomGame {
  const game = new RoomGame({ ...cfg, seed });
  for (const c of cmds) {
    if (game.status !== "playing") break;
    game.playerCommand(c);
  }
  return game;
}
