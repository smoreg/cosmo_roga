import * as ROT from "rot-js";
import { Grid } from "../grid.js";
import { Tile, type RoomRect, roomCenter } from "../level.js";
import type { BuildContext, BuildResult, MapBuilder } from "./types.js";

export interface RoomsOptions {
  dugPercentage: number;
  roomWidth: [number, number];
  roomHeight: [number, number];
  corridorLength: [number, number];
}

export const ROOMS_DEFAULTS: RoomsOptions = {
  dugPercentage: 0.24,
  roomWidth: [4, 11],
  roomHeight: [3, 7],
  corridorLength: [2, 9],
};

/**
 * Rooms and corridors via rot.js Digger (Mike Anderson's Tyrant algorithm).
 * The most "traditional roguelike"-looking of the four builders, and the one
 * that reads best on a screenshot — which matters, because jam voters see the
 * screenshot first.
 */
export class RoomsBuilder implements MapBuilder {
  readonly name = "rooms";
  private opts: RoomsOptions;

  constructor(opts: Partial<RoomsOptions> = {}) {
    this.opts = { ...ROOMS_DEFAULTS, ...opts };
  }

  build(ctx: BuildContext): BuildResult {
    const { width, height, rng } = ctx;
    // Digger draws from the global ROT.RNG; seed it from our stream so the map
    // stays a pure function of our own seed.
    ROT.RNG.setSeed(rng.int(1, 0x7fffffff));

    const tiles = new Grid<Tile>(width, height, Tile.Wall);
    const digger = new ROT.Map.Digger(width, height, this.opts);
    digger.create((x, y, contents) => {
      tiles.set(x, y, contents === 0 ? Tile.Floor : Tile.Wall);
    });

    const rooms: RoomRect[] = digger.getRooms().map((r) => ({
      x1: r.getLeft(),
      y1: r.getTop(),
      x2: r.getRight(),
      y2: r.getBottom(),
    }));

    for (const r of digger.getRooms()) {
      r.getDoors((dx, dy) => {
        if (tiles.get(dx, dy) === Tile.Floor) tiles.set(dx, dy, Tile.Door);
      });
    }

    return { tiles, rooms, entryHint: rooms.length > 0 ? roomCenter(rooms[0]!) : undefined };
  }
}
