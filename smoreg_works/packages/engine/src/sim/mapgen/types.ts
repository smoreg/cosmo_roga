import type { Entity } from "../entity.js";
import type { Grid, Point } from "../grid.js";
import type { Tile, RoomRect, Zone } from "../level.js";
import type { Rng } from "../rng.js";
import type { PlacedVault } from "./vaults.js";

export interface BuildContext {
  width: number;
  height: number;
  depth: number;
  rng: Rng;
  /**
   * Run flags raised so far. A storylet's `when` reads them, which is how a
   * deck can be built out of what the run has already done to the player.
   */
  flags: ReadonlySet<string>;
  /** The player, when there is one. Absent on the very first level. */
  player?: Entity;
}

export interface BuildResult {
  tiles: Grid<Tile>;
  /** Rectangular rooms, when the algorithm has a notion of them. */
  rooms: RoomRect[];
  /** Optional hint for where the player should start. */
  entryHint?: Point;
  /**
   * Optional hint for where the stairs down belong. Honoured when it points at
   * plain floor; otherwise the pipeline runs its own farthest-tile search.
   * A zone-graph generator uses it to keep the hatch inside the zone its plan
   * asked for — and off the airlocks, which are walkable but are doorways.
   */
  stairsHint?: Point;
  /** Sectors, for generators that lay the map out as a zone graph. */
  zones?: Zone[];
  /** Vaults the builder stamped itself; the pipeline passes them through. */
  vaults?: PlacedVault[];
  /** Run flags the placed vaults raised. */
  flagsSet?: string[];
}

/**
 * Every generator is a pure function of its context. Same rng state and
 * dimensions in, same map out — that is what makes `?seed=N` reproduce a run
 * and what makes the property tests meaningful.
 */
export interface MapBuilder {
  readonly name: string;
  build(ctx: BuildContext): BuildResult;
}
