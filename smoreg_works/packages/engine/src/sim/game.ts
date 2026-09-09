import { Rng } from "./rng.js";
import { Grid, type Point } from "./grid.js";
import { Level, Tile } from "./level.js";
import { Schedule, TURN_COST } from "./schedule.js";
import { MessageLog } from "./log.js";
import { computeFov } from "./fov.js";
import {
  generateLevel,
  spawnSpots,
  DEFAULT_MAPGEN,
  type GeneratedLevel,
  type MapBuilder,
  type MapgenOptions,
} from "./mapgen.js";
import { LevelStore, levelSeed, type LevelId, type StoredLevel } from "./levelstore.js";
import { type Entity, isAlive, newIdSeq, useIds } from "./entity.js";
import { perform, entityAt, label, type Command, type Outcome } from "./actions.js";
import { runNonPlayerTurns } from "./ai.js";
import { spawnMonster, type ContentPack } from "../content/kinds.js";
import { NO_TWIST, type LeaveReason, type Twist } from "./twist.js";
import { effectiveFov, tickStatuses, statusLine } from "./status.js";
import { propagate } from "./propagate.js";

export type GameStatus = "playing" | "dead" | "won";

/**
 * Where to put the player on arrival: the level's own entry point, or its
 * stairs — which is where somebody who came back up would be standing.
 */
export type ArrivalPoint = "entry" | "stairs";

export interface TravelSpec {
  /** Depth of the destination. Only meaningful for a level being generated. */
  depth: number;
  /** Generator for a level being made now. Falls back to the game's mapgen. */
  builder?: MapBuilder;
  /** Where the player lands. Default "entry". */
  entry?: ArrivalPoint;
  /** Why the current level is being left. Passed to `beforeLevelLeave`. */
  reason?: LeaveReason;
}

/** Used when the content pack does not name the ending itself. */
const DEFAULT_WIN_LINE = "You break through the last floor and out into the light. You win.";
const DEFAULT_DEATH_LINE = "You die. The temple keeps what it takes.";

export interface GameConfig {
  seed: number;
  /** The game being played. See content/kinds.ts. */
  content: ContentPack;
  mapgen?: MapgenOptions;
  /** Overrides the content pack's own maxDepth. Mostly for tests. */
  maxDepth?: number;
  /** The jam's one twist mechanic. See sim/twist.ts. */
  twist?: Twist;
  /** Additional independent mechanics, run after the twist on every hook. */
  systems?: Twist[];
}

/**
 * The whole simulation. No DOM, no rot.js Display, no timers — so it runs in
 * vitest and can be replayed from (seed, command list).
 */
export class Game {
  readonly seed: number;
  readonly rng: Rng;
  readonly schedule = new Schedule();
  readonly log = new MessageLog();
  readonly maxDepth: number;
  readonly content: ContentPack;
  readonly twist: Twist;
  /** Twist first, then extra systems. Hooks run in this order. */
  readonly systems: readonly Twist[];
  private readonly mapgenOpts: MapgenOptions;

  level!: Level;
  entities: Entity[] = [];
  /**
   * How loud each tile was this turn. Monsters with a sound-driven behaviour
   * read it; a twist mechanic can read it too. Rebuilt every player turn from
   * the noises made during it, so it never goes stale.
   */
  noiseField!: Grid<number>;
  private pendingNoises: Array<{ pos: Point; strength: number }> = [];
  player!: Entity;
  depth = 0;
  status: GameStatus = "playing";
  kills = 0;
  /** Every player command, in order. Replaying it against `seed` reproduces the run. */
  readonly inputs: Command[] = [];
  /**
   * Run-wide flags a twist can set and mapgen can read: "the scanner burned
   * out", "the ward was opened". They outlive a level, never a run — writing
   * one to storage would be meta-progression, which the jam forbids.
   */
  readonly flags = new Set<string>();
  /**
   * What mapgen produced for the current depth. A game reads `lastGen.vaults`
   * in `onLevelEnter` to populate the markers its storylets drew.
   */
  lastGen!: GeneratedLevel;
  /**
   * Every level this run has generated, by id. A run that only goes down never
   * looks at it; one that can walk back into a place it has been reads the same
   * map, the same explored tiles and the same corpses out of it.
   */
  readonly levels = new LevelStore();
  /** Which entry of `levels` the player is standing in. Default `String(depth)`. */
  levelId: LevelId = "1";
  /** True once a system says it owns the ending. Frozen for the run. */
  private readonly outcomeClaimed: boolean;
  /**
   * This run's own entity numbering. See `sim/entity.ts`: the counter is
   * ambient because content code creates entities, so a run has to claim it
   * before anything spawns or a second run in the process renumbers this one.
   */
  private readonly ids = newIdSeq();
  /** False until the first level is in place, so `travelTo` can build one. */
  private started = false;

  constructor(cfg: GameConfig) {
    this.seed = cfg.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.content = cfg.content;
    this.maxDepth = cfg.maxDepth ?? cfg.content.maxDepth;
    this.mapgenOpts = cfg.mapgen ?? DEFAULT_MAPGEN;
    this.twist = cfg.twist ?? NO_TWIST;
    this.systems = [this.twist, ...(cfg.systems ?? [])];
    this.outcomeClaimed = this.systems.some((s) => s.claimsOutcome === true);

    useIds(this.ids);
    this.travelTo("1", { depth: 1 });
    for (const sys of this.systems) sys.onRunStart?.(this);
    this.log.add(cfg.content.openingLine ?? "You descend. There is no way back.", 0, "warn");
  }

  // ---------------------------------------------------------------- level flow

  /**
   * Go to the level called `id`, generating it if this run has never been
   * there and lifting it out of the store if it has. The one way a run changes
   * level: `descend` is a wrapper over it, and so is a game's own "fly home".
   *
   * Returning is a real return — same tiles, same explored map, same corpses,
   * same energy in every actor that was left behind — because nothing is
   * regenerated and nothing is repopulated on a level that already exists.
   */
  travelTo(id: LevelId, spec: TravelSpec): void {
    useIds(this.ids);
    const first = !this.started;
    this.started = true;
    if (!first) {
      for (const sys of this.systems) sys.beforeLevelLeave?.(this, this.depth, spec.reason ?? "stairs");
      this.stash();
    }

    const stored = this.levels.get(id) ?? this.generateInto(id, spec);
    stored.visits++;
    this.levelId = id;
    this.lastGen = stored.gen;
    this.level = stored.level;
    this.depth = spec.depth;

    if (first) this.player = this.content.makePlayer(stored.gen.entry);
    this.player.pos = { ...(spec.entry === "stairs" ? stored.gen.stairs : stored.gen.entry) };
    this.entities = [this.player, ...stored.entities];
    this.schedule.admit(this.player);

    this.noiseField = new Grid<number>(this.level.width, this.level.height, 0);
    this.pendingNoises = [];
    if (stored.visits === 1) this.populate(spec.depth);
    for (const sys of this.systems) sys.onLevelEnter?.(this, spec.depth);
    this.refreshFov();
  }

  /** The store entry the player is standing in, for a system's own bookkeeping. */
  get currentLevel(): StoredLevel {
    return this.levels.get(this.levelId)!;
  }

  /** Put the level the player is leaving back in the store, player excluded. */
  private stash(): void {
    const stored = this.currentLevel;
    stored.entities = this.entities.filter((e) => e.id !== this.player.id);
  }

  private generateInto(id: LevelId, spec: TravelSpec): StoredLevel {
    const gen = generateLevel(spec.depth, this.rng, {
      ...this.mapgenOpts,
      builder: spec.builder ?? this.mapgenOpts.builder,
      vaults: this.mapgenOpts.vaults ?? this.content.vaults,
      vaultCount: this.mapgenOpts.vaultCount ?? this.content.vaultsPerLevel ?? 1,
      // Storylets read the run state, so the generator gets it.
      flags: this.flags,
      player: this.player,
    });
    // Cards placed on this deck raise their flags for every deck after it.
    for (const f of gen.flagsSet) this.flags.add(f);

    const stored: StoredLevel = {
      level: gen.level,
      entities: [],
      scheduleSeed: levelSeed(this.seed, id),
      data: {},
      gen,
      visits: 0,
    };
    this.levels.put(id, stored);
    return stored;
  }

  private populate(depth: number): void {
    const kinds = this.content.monstersForDepth(depth);
    if (kinds.length === 0) return;

    const spots = this.rng.shuffle(spawnSpots(this.level, this.player.pos, 8));
    const budget = this.content.monsterBudget(depth, this.rng);

    const table: Record<string, number> = {};
    for (const k of kinds) table[k.id] = k.weight;

    for (let i = 0; i < budget && i < spots.length; i++) {
      const id = this.rng.weighted(table);
      const kind = kinds.find((k) => k.id === id);
      if (!kind) continue;
      const m = spawnMonster(kind, spots[i]!);
      this.schedule.admit(m);
      this.entities.push(m);
    }
  }

  /**
   * Take the way out from under the player's feet. `reason` says which one it
   * was: the stairs further in, or the airlock back out.
   *
   * With a system that claims the outcome, this only announces the departure —
   * where it leads and whether the run is over are that system's calls, made
   * from `beforeLevelLeave`. With none, the engine keeps the plain dungeon
   * behaviour it always had: one deeper, and the bottom is the win.
   */
  descend(reason: LeaveReason = "stairs"): void {
    useIds(this.ids);
    if (this.outcomeClaimed) {
      for (const sys of this.systems) sys.beforeLevelLeave?.(this, this.depth, reason);
      return;
    }
    if (this.depth >= this.maxDepth) {
      this.finish("won", this.content.winLine ?? DEFAULT_WIN_LINE);
      return;
    }
    this.log.add(`You descend to depth ${this.depth + 1}.`, this.schedule.time, "warn");
    this.travelTo(String(this.depth + 1), { depth: this.depth + 1, reason });
  }

  /**
   * End the run with the game's own words. The only way a game finishes one:
   * setting `status` by hand skips the line the player is owed, and the engine
   * has no idea what "the tug is paid off" means.
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
  playerCommand(cmd: Command): Outcome {
    useIds(this.ids);
    if (this.status !== "playing") return { ok: false, cost: 0, reason: "The run is over." };

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
      if (outcome.reason) this.log.add(outcome.reason, this.schedule.time, "warn");
      return outcome;
    }

    this.inputs.push(cmd);
    this.schedule.spend(this.player, outcome.cost || TURN_COST);
    this.makeNoise(this.player.pos, commandNoise(cmd));
    this.settleNoise();
    for (const sys of this.systems) sys.afterPlayerTurn?.(this, cmd);
    this.reapDead();
    this.refreshFov();

    if (this.status === "playing" && isAlive(this.player)) {
      runNonPlayerTurns(this);
      this.reapDead();
      this.refreshFov();
    }

    if (!isAlive(this.player) && this.status === "playing") {
      this.status = "dead";
      this.log.add(this.content.deathLine ?? DEFAULT_DEATH_LINE, this.schedule.time, "bad");
    }
    return outcome;
  }

  refreshFov(): void {
    computeFov(this.level, this.player.pos, effectiveFov(this.player));
  }

  /** Read-only view of this turn's noise, for AI behaviours. */
  get noise(): { get(x: number, y: number): number | undefined } {
    return this.noiseField;
  }

  /** Register a sound. Louder carries further; walls stop it entirely. */
  makeNoise(pos: Point, strength: number): void {
    this.pendingNoises.push({ pos: { ...pos }, strength });
  }

  private settleNoise(): void {
    this.noiseField = propagate(this.level.width, this.level.height, this.pendingNoises, {
      passable: (x, y) => this.level.isWalkable(x, y),
    });
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
    // The scheduler reads the live entity list on every call, so dropping a
    // corpse here is enough — no separate deregistration step.
    this.entities = this.entities.filter((e) => isAlive(e) || e.blocksWhenDead === true || e.id === this.player.id);
  }

  // ------------------------------------------------------------------- queries

  monsterAt(x: number, y: number): Entity | undefined {
    return entityAt(this, x, y);
  }

  visibleMonsters(): Entity[] {
    return this.entities.filter(
      (e) => e.id !== this.player.id && isAlive(e) && this.level.visible.get(e.pos.x, e.pos.y) === true,
    );
  }

  isOver(): boolean {
    return this.status !== "playing";
  }

  onStairs(): boolean {
    return this.level.tiles.get(this.player.pos.x, this.player.pos.y) === Tile.StairsDown;
  }

  /** Standing on the way off the level, as opposed to further into it. */
  onAirlockOut(): boolean {
    return this.level.tiles.get(this.player.pos.x, this.player.pos.y) === Tile.AirlockOut;
  }

  describe(e: Entity): string {
    const statuses = statusLine(e);
    return `${label(this, e)} (${e.hp}/${e.hpMax})${statuses ? ` [${statuses}]` : ""}`;
  }
}

/**
 * Moving is quiet, fighting is not. This is the whole sound model.
 *
 * A game's own commands are silent here on purpose: only the system that
 * handles one knows whether it was a welding torch or a thought, so it calls
 * `makeNoise` itself.
 */
function commandNoise(cmd: Command): number {
  switch (cmd.kind) {
    case "attack":
      return 9;
    case "move":
    case "descend":
      return 3;
    default:
      return 0;
  }
}

/** Replay a recorded run. Used by tests and by bug reports from players. */
export function replay(seed: number, cmds: Command[], cfg: Omit<GameConfig, "seed">): Game {
  const game = new Game({ ...cfg, seed });
  for (const c of cmds) {
    if (game.status !== "playing") break;
    game.playerCommand(c);
  }
  return game;
}
