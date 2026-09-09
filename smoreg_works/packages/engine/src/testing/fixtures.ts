import { Level, Tile, TILES } from "../sim/level.js";
import type { Point } from "../sim/grid.js";

/**
 * Build a Level out of an ASCII drawing. This is the single highest-leverage
 * test tool in the repo: it turns "reproduce the bug" from a hunt for a seed
 * into drawing eight characters, and it makes every combat / AI / FOV test
 * readable at a glance.
 *
 *   const f = fromAscii([
 *     "#####",
 *     "#@.r#",
 *     "#####",
 *   ]);
 *
 * Legend:
 *   '#' wall     '.' floor    '>' stairs down    '+' door    '%' rubble
 *   '=' airlock  '|' sealed bulkhead   '<' outer airlock
 *   '@' player spawn (floor)
 *   any other letter: a marker on floor, collected into `marks`
 */
export interface Fixture {
  level: Level;
  /** Position of '@', if present. */
  player: Point | undefined;
  /** Position of '>', if present. */
  stairs: Point | undefined;
  /** Every other letter, in reading order: [char, position]. */
  marks: Array<{ ch: string; pos: Point }>;
  /** Look up the first mark with this char. */
  mark(ch: string): Point;
}

const TILE_CHARS: Record<string, Tile> = {
  "#": Tile.Wall,
  ".": Tile.Floor,
  ">": Tile.StairsDown,
  "+": Tile.Door,
  "%": Tile.Rubble,
  "=": Tile.Airlock,
  "|": Tile.Bulkhead,
  "<": Tile.AirlockOut,
  " ": Tile.Wall,
};

export function fromAscii(rows: string[], depth = 1): Fixture {
  if (rows.length === 0) throw new Error("fromAscii: empty map");
  const width = Math.max(...rows.map((r) => r.length));
  const level = new Level(depth, width, rows.length);

  let player: Point | undefined;
  let stairs: Point | undefined;
  const marks: Array<{ ch: string; pos: Point }> = [];

  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? "#";
      const tile = TILE_CHARS[ch];
      if (tile !== undefined) {
        level.tiles.set(x, y, tile);
        if (ch === ">") stairs = { x, y };
        continue;
      }
      // Anything else is an entity marker standing on floor.
      level.tiles.set(x, y, Tile.Floor);
      if (ch === "@") player = { x, y };
      else marks.push({ ch, pos: { x, y } });
    }
  });

  return {
    level,
    player,
    stairs,
    marks,
    mark(ch: string): Point {
      const m = marks.find((k) => k.ch === ch);
      if (!m) throw new Error(`fromAscii: no marker '${ch}' in fixture`);
      return m.pos;
    },
  };
}

/** Render a Level back to ASCII. For eyeballing a failing test's actual output. */
export function toAscii(level: Level, overlay?: Map<string, string>): string[] {
  const out: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = "";
    for (let x = 0; x < level.width; x++) {
      const over = overlay?.get(`${x},${y}`);
      if (over) {
        row += over;
        continue;
      }
      // Straight from TILES, so a new tile round-trips through fromAscii for free.
      row += TILES[level.tiles.at(x, y)].ch;
    }
    out.push(row);
  }
  return out;
}

/** Render what is currently visible: '.' seen floor, ' ' unseen, '#' seen wall. */
export function visibilityToAscii(level: Level): string[] {
  const out: string[] = [];
  for (let y = 0; y < level.height; y++) {
    let row = "";
    for (let x = 0; x < level.width; x++) {
      if (!level.visible.at(x, y)) row += " ";
      else row += level.isTransparent(x, y) ? "." : "#";
    }
    out.push(row);
  }
  return out;
}

/** An open box with walls, for tests that only need somewhere to stand. */
export function openRoom(width: number, height: number, depth = 1): Level {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    if (y === 0 || y === height - 1) rows.push("#".repeat(width));
    else rows.push("#" + ".".repeat(width - 2) + "#");
  }
  return fromAscii(rows, depth).level;
}
