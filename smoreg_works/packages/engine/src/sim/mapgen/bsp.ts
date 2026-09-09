import { Grid, type Point } from "../grid.js";
import { Tile, type RoomRect, roomCenter } from "../level.js";
import type { Rng } from "../rng.js";
import { carveCorridor } from "./postprocess.js";
import type { BuildContext, BuildResult, MapBuilder } from "./types.js";

export interface BspOptions {
  /** Stop splitting a node smaller than this. */
  minLeaf: number;
  /** Recursion depth cap; also caps room count at 2^depth. */
  maxDepth: number;
  /** How much of a leaf the room fills, 0..1. Lower = more corridor. */
  roomFill: [number, number];
}

export const BSP_DEFAULTS: BspOptions = {
  minLeaf: 7,
  maxDepth: 5,
  roomFill: [0.55, 0.95],
};

interface Node {
  x: number;
  y: number;
  w: number;
  h: number;
  left?: Node;
  right?: Node;
  room?: RoomRect;
}

/**
 * Binary space partitioning. The generator to reach for when the level needs a
 * predictable room count and no overlaps — the opposite trade-off from caves.
 * Connectivity is structural: every split joins its two halves, so the result
 * is a tree and therefore always connected.
 */
export class BspBuilder implements MapBuilder {
  readonly name = "bsp";
  private opts: BspOptions;

  constructor(opts: Partial<BspOptions> = {}) {
    this.opts = { ...BSP_DEFAULTS, ...opts };
  }

  build(ctx: BuildContext): BuildResult {
    const { width, height, rng } = ctx;
    const tiles = new Grid<Tile>(width, height, Tile.Wall);

    const root: Node = { x: 1, y: 1, w: width - 2, h: height - 2 };
    this.split(root, 0, rng);

    const rooms: RoomRect[] = [];
    this.carveRooms(root, tiles, rng, rooms);
    this.joinRooms(root, tiles);

    return { tiles, rooms, entryHint: rooms.length > 0 ? roomCenter(rooms[0]!) : undefined };
  }

  private split(node: Node, depth: number, rng: Rng): void {
    if (depth >= this.opts.maxDepth) return;
    const canH = node.h >= this.opts.minLeaf * 2;
    const canV = node.w >= this.opts.minLeaf * 2;
    if (!canH && !canV) return;

    // Split the longer axis, so rooms stay roughly square.
    const horizontal = canH && (!canV || node.h > node.w);
    if (horizontal) {
      const cut = rng.int(this.opts.minLeaf, node.h - this.opts.minLeaf);
      node.left = { x: node.x, y: node.y, w: node.w, h: cut };
      node.right = { x: node.x, y: node.y + cut, w: node.w, h: node.h - cut };
    } else {
      const cut = rng.int(this.opts.minLeaf, node.w - this.opts.minLeaf);
      node.left = { x: node.x, y: node.y, w: cut, h: node.h };
      node.right = { x: node.x + cut, y: node.y, w: node.w - cut, h: node.h };
    }
    this.split(node.left, depth + 1, rng);
    this.split(node.right, depth + 1, rng);
  }

  private carveRooms(node: Node, tiles: Grid<Tile>, rng: Rng, out: RoomRect[]): void {
    if (node.left && node.right) {
      this.carveRooms(node.left, tiles, rng, out);
      this.carveRooms(node.right, tiles, rng, out);
      return;
    }
    const [lo, hi] = this.opts.roomFill;
    const rw = Math.max(3, Math.floor(node.w * (lo + rng.next() * (hi - lo))));
    const rh = Math.max(3, Math.floor(node.h * (lo + rng.next() * (hi - lo))));
    const rx = node.x + rng.int(0, Math.max(0, node.w - rw));
    const ry = node.y + rng.int(0, Math.max(0, node.h - rh));

    const room: RoomRect = { x1: rx, y1: ry, x2: rx + rw - 1, y2: ry + rh - 1 };
    for (let y = room.y1; y <= room.y2; y++) {
      for (let x = room.x1; x <= room.x2; x++) {
        if (x <= 0 || y <= 0 || x >= tiles.width - 1 || y >= tiles.height - 1) continue;
        tiles.set(x, y, Tile.Floor);
      }
    }
    node.room = room;
    out.push(room);
  }

  private joinRooms(node: Node, tiles: Grid<Tile>): Point | undefined {
    if (node.room) return roomCenter(node.room);
    if (!node.left || !node.right) return undefined;
    const a = this.joinRooms(node.left, tiles);
    const b = this.joinRooms(node.right, tiles);
    if (a && b) carveCorridor(tiles, a, b);
    return a ?? b;
  }
}
