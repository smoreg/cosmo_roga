import { Faction, type Entity } from "../sim/entity.js";

/**
 * The second world model of the engine: a ship is a graph of compartments and
 * doors, not a grid of tiles. An actor stands in exactly one room; "how far" is
 * a number of doors. Everything the grid engine gets from `Level` — distances,
 * noise, visibility — has a twin here that walks an adjacency list instead.
 *
 * The engine knows no word of any game: `kind`, `name`, `hazard` and the card
 * `marks` are strings it carries and never reads (the one exception is the
 * hazard `"vented"`, which noise has to understand). A locked door names its
 * key by a string id, a trapped door names its trap the same way; what a key
 * or a trap *is* belongs to the game.
 */

export type RoomId = number;
export type DoorId = number;

/**
 * `locked` needs a key, `sealed` is welded shut (no electronics left to pick),
 * `broken` is a hole that can never be closed again, `airlock` is the way off
 * the ship and no machine ever fits through it.
 */
export type DoorState = "open" | "closed" | "locked" | "sealed" | "broken" | "airlock";

export interface Room {
  id: RoomId;
  /** Label on the schematic: "r3". */
  label: string;
  /** Content-defined type and display name. Never read by the engine. */
  kind: string;
  name: string;
  /** Doors away from the entry; the difficulty band of everything inside. */
  depth: number;
  /** Place on the schematic. Filled by the generator's layout pass. */
  col: number;
  row: number;
  /** Crates, torn plating: somewhere to hide. */
  cover: boolean;
  /** Content-defined; the engine only ever compares it to "vented". */
  hazard: string;
  /**
   * No line of sight in or out of it. Set by the game on a compartment it has
   * filled with something that blinds — smoke, darkness — and read by
   * `rooms/sight.ts` alone; what it is called is the game's business, the way
   * `hazard` is. Optional, so a ship stored by an older build comes back as it
   * was.
   */
  opaque?: boolean;
  /** Stood here / seen by a sensor pulse. */
  explored: boolean;
  scanned: boolean;
  /** What the generator's cards left here. The game turns them into things. */
  marks: string[];
  /** The game's own per-room state. The engine writes it once and never reads it. */
  data: Record<string, unknown>;
}

export interface Door {
  id: DoorId;
  /** Label on the schematic: "d4", "a1". */
  label: string;
  a: RoomId;
  b: RoomId;
  state: DoorState;
  /** Id of the key that opens it, when `locked`. A string; the game owns its meaning. */
  key?: string;
  /**
   * Something waiting on the door for whoever goes through it. A string the
   * game owns the meaning of, exactly as `key` is: the engine carries it and
   * never reads it.
   */
  trap?: string;
}

/** The passability facts about an actor — all `Ship.passable` ever reads. */
export interface Walker {
  breacher?: boolean;
  isPlayer?: boolean;
}

/** Flat form of a ship, which is exactly what `JSON.stringify(ship)` produces. */
export interface ShipData {
  rooms: Room[];
  doors: Door[];
  entry: RoomId;
}

/**
 * A ship: rooms, doors, and the room holding the airlock.
 *
 * Plain data plus methods, deliberately. A ship goes into `LevelStore` and out
 * to a save file, so nothing inside may be a closure or a Map of functions:
 * `Ship.rehydrate(JSON.parse(JSON.stringify(ship)))` has to give back the same
 * ship. The adjacency index is derived, private, and left out of `toJSON`.
 *
 * Ids are dense: `rooms[i].id === i` and `doors[i].id === i`. The constructor
 * enforces it, so every consumer can index by id instead of searching, which is
 * what makes one distance map per machine per turn cheap.
 */
export class Ship {
  readonly rooms: Room[];
  readonly doors: Door[];
  readonly entry: RoomId;

  /** Door ids per room. Derived from `doors`; never serialised. */
  private readonly adj: DoorId[][];

  constructor(rooms: Room[], doors: Door[], entry: RoomId) {
    rooms.forEach((r, i) => {
      if (r.id !== i) throw new Error(`Ship: room ids must be dense, rooms[${i}].id === ${r.id}`);
    });
    doors.forEach((d, i) => {
      if (d.id !== i) throw new Error(`Ship: door ids must be dense, doors[${i}].id === ${d.id}`);
    });
    if (rooms[entry] === undefined) throw new Error(`Ship: entry ${entry} is not a room`);

    this.rooms = rooms;
    this.doors = doors;
    this.entry = entry;
    this.adj = rooms.map(() => []);
    for (const d of doors) {
      if (rooms[d.a] === undefined || rooms[d.b] === undefined) {
        throw new Error(`Ship: door ${d.label} joins rooms that do not exist`);
      }
      this.adj[d.a]!.push(d.id);
      // The airlock leads off the ship, so its far endpoint is the entry room
      // itself (a === b). Nothing in the engine needs a node for "outside", and
      // a self-edge is quietly ignored by every walk over `neighbours`.
      if (d.b !== d.a) this.adj[d.b]!.push(d.id);
    }
  }

  /** Rebuild from the flat form — a save file, or a structuredClone. */
  static rehydrate(data: ShipData): Ship {
    return new Ship(data.rooms, data.doors, data.entry);
  }

  toJSON(): ShipData {
    return { rooms: this.rooms, doors: this.doors, entry: this.entry };
  }

  get size(): number {
    return this.rooms.length;
  }

  roomAt(r: RoomId): Room {
    const room = this.rooms[r];
    if (!room) throw new Error(`Ship: no room ${r}`);
    return room;
  }

  doorAt(d: DoorId): Door {
    const door = this.doors[d];
    if (!door) throw new Error(`Ship: no door ${d}`);
    return door;
  }

  doorsOf(r: RoomId): Door[] {
    const ids = this.adj[r];
    if (!ids) throw new Error(`Ship: no room ${r}`);
    return ids.map((id) => this.doors[id]!);
  }

  /** Every door of `r` with the room it leads to. Passability is not consulted. */
  neighbours(r: RoomId): Array<{ door: Door; room: Room }> {
    return this.doorsOf(r).map((door) => ({ door, room: this.roomAt(this.other(door, r)) }));
  }

  /** The far end of `d` seen from `r`. The airlock's far end is `r` itself. */
  other(d: Door, r: RoomId): RoomId {
    if (d.a === r) return d.b;
    if (d.b === r) return d.a;
    throw new Error(`Ship: door ${d.label} does not touch room ${r}`);
  }

  /**
   * May `who` walk through it? A `breacher` cuts locked and sealed doors open;
   * the caller charges the turns and the noise for that. The airlock is the
   * player's way out and a wall to everything else.
   */
  passable(d: Door, who: Walker): boolean {
    switch (d.state) {
      case "open":
      case "closed":
      case "broken":
        return true;
      case "locked":
      case "sealed":
        return who.breacher === true;
      case "airlock":
        return who.isPlayer === true;
    }
  }

  /** Line of sight and line of fire both stop at anything but a hole. */
  seeThrough(d: Door): boolean {
    return d.state === "open" || d.state === "broken";
  }

  door(label: string): Door {
    const d = this.doors.find((x) => x.label === label);
    if (!d) throw new Error(`Ship: no door labelled '${label}'`);
    return d;
  }

  room(label: string): Room {
    const r = this.rooms.find((x) => x.label === label);
    if (!r) throw new Error(`Ship: no room labelled '${label}'`);
    return r;
  }

  /** The airlock, when the ship has one. */
  airlock(): Door | undefined {
    return this.doors.find((d) => d.state === "airlock");
  }
}

/**
 * What `passable` needs to know about an entity. Spelled out here so no caller
 * has to remember that "the player may use the airlock and nobody else may".
 */
export function walkerOf(e: Entity): Walker {
  return { breacher: e.breacher === true, isPlayer: e.faction === Faction.Player };
}
