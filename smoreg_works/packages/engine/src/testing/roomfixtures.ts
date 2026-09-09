import { layoutShip } from "../rooms/gen/index.js";
import { Ship, type Door, type DoorState, type Room, type RoomId } from "../rooms/graph.js";

// A fixture is laid out by the generator's own pass, so a hand-written ship and
// a generated one sit on the schematic under exactly the same rules.
export { layoutShip };

/**
 * Build a Ship out of a few lines of text — the graph twin of `fromAscii`, and
 * the same bargain: reproducing a bug stops being a hunt for a seed and becomes
 * four lines anybody can read in a test.
 *
 *   const f = shipFromText(`
 *     TUG -a1- r1
 *     r1 -d1- r2 -(d2)- r3
 *     r2 -[d3:k1]- r4
 *     r1: docking @
 *     r2: cargo m:scout %thrusters:2 †:k1 cover
 *   `);
 *
 * Edge lines chain rooms through doors, one door per `-…-`:
 *
 *   -d4-        open          -(d4)-      closed
 *   -[d4]-      locked        -[d4:k1]-   locked, opened by key "k1"
 *   -#d4#-      sealed        -·d4·-      broken (`-.d4.-` also works)
 *   TUG -a1- r1               the airlock: r1 becomes the entry
 *
 * `TUG` (or `OUT`) is not a room — it is the outside, so the airlock hangs off
 * the entry room alone, exactly as a generated ship has it.
 *
 * Room lines are `id: kind tokens…`. A room named only in an edge line gets the
 * kind "room". Tokens: `@` is the player, `cover` gives it somewhere to hide,
 * `vented` and `hazard:x` set the hazard, `explored` and `scanned` set what has
 * been seen; anything else is a mark, which is what the generator's cards leave
 * behind and what a game turns into things.
 *
 * `depth` is BFS from the entry, through every door whatever its state.
 */
export interface ShipFixture {
  ship: Ship;
  /** Room holding '@', if any. */
  player: RoomId | undefined;
  /** Every mark, in reading order. */
  marks: Array<{ room: RoomId; token: string }>;
  /** The first room carrying this mark. `mark("†")` also finds `†:k1`. */
  mark(token: string): RoomId;
}

const CLOSERS: Record<string, DoorState> = {
  "(": "closed",
  "[": "locked",
  "#": "sealed",
  "·": "broken",
  ".": "broken",
};

const OUTSIDE = new Set(["TUG", "OUT"]);

export function shipFromText(text: string | string[]): ShipFixture {
  const lines = (Array.isArray(text) ? text : text.split("\n"))
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//"));

  const rooms: Room[] = [];
  const doors: Door[] = [];
  const byLabel = new Map<string, Room>();
  const marks: Array<{ room: RoomId; token: string }> = [];
  let player: RoomId | undefined;
  let entry: RoomId | undefined;

  const ensureRoom = (label: string): Room => {
    const hit = byLabel.get(label);
    if (hit) return hit;
    const room: Room = {
      id: rooms.length,
      label,
      kind: "room",
      name: "ROOM",
      depth: 0,
      col: 0,
      row: 0,
      cover: false,
      hazard: "none",
      explored: false,
      scanned: false,
      marks: [],
      data: {},
    };
    rooms.push(room);
    byLabel.set(label, room);
    return room;
  };

  for (const line of lines) {
    const tokens = line.split(/\s+/);
    if (tokens[0]!.endsWith(":")) {
      // Room line: id: kind tokens…
      const room = ensureRoom(tokens[0]!.slice(0, -1));
      const [kind, ...rest] = tokens.slice(1);
      if (kind !== undefined) {
        room.kind = kind;
        room.name = kind.toUpperCase();
      }
      for (const token of rest) {
        if (token === "@") player = room.id;
        else if (token === "cover") room.cover = true;
        else if (token === "explored") room.explored = true;
        else if (token === "scanned") room.scanned = true;
        else if (token === "vented") room.hazard = "vented";
        else if (token.startsWith("hazard:")) room.hazard = token.slice("hazard:".length);
        else {
          room.marks.push(token);
          marks.push({ room: room.id, token });
        }
      }
      continue;
    }

    // Edge line: room -door- room -door- room…
    if (tokens.length < 3 || tokens.length % 2 === 0) {
      throw new Error(`shipFromText: cannot read '${line}'`);
    }
    for (let i = 0; i + 2 < tokens.length; i += 2) {
      const left = tokens[i]!;
      const right = tokens[i + 2]!;
      const spec = parseDoor(tokens[i + 1]!, line);
      const outside = OUTSIDE.has(left.toUpperCase()) || OUTSIDE.has(right.toUpperCase());
      const inside = ensureRoom(OUTSIDE.has(left.toUpperCase()) ? right : left);
      if (outside) {
        // The airlock leads off the ship: both ends are the entry room.
        doors.push({ id: doors.length, label: spec.label, a: inside.id, b: inside.id, state: "airlock" });
        entry = inside.id;
        continue;
      }
      const far = ensureRoom(right);
      const door: Door = { id: doors.length, label: spec.label, a: inside.id, b: far.id, state: spec.state };
      if (spec.key !== undefined) door.key = spec.key;
      doors.push(door);
    }
  }

  if (rooms.length === 0) throw new Error("shipFromText: no rooms");
  const ship = new Ship(rooms, doors, entry ?? 0);
  fillDepths(ship);
  layoutShip(ship);

  return {
    ship,
    player,
    marks,
    mark(token: string): RoomId {
      const hit = marks.find((m) => m.token === token || m.token.startsWith(`${token}:`));
      if (!hit) throw new Error(`shipFromText: no mark '${token}' in fixture`);
      return hit.room;
    },
  };
}

/** Render a ship back to text. For eyeballing a failing test's actual ship. */
export function shipToText(ship: Ship): string[] {
  const out = ship.rooms.map((r) => {
    const tokens: string[] = [];
    if (r.cover) tokens.push("cover");
    if (r.hazard === "vented") tokens.push("vented");
    else if (r.hazard !== "none") tokens.push(`hazard:${r.hazard}`);
    if (r.explored) tokens.push("explored");
    if (r.scanned) tokens.push("scanned");
    tokens.push(...r.marks);
    return `${r.label}: ${[r.kind, ...tokens].join(" ")}`;
  });

  // Rooms first, so re-reading the text rebuilds them with the same ids.
  for (const d of ship.doors) {
    const here = ship.roomAt(d.a).label;
    if (d.state === "airlock") {
      out.push(`TUG -${d.label}- ${here}`);
      continue;
    }
    out.push(`${here} ${doorText(d)} ${ship.roomAt(d.b).label}`);
  }
  return out;
}

/** Doors from the entry, whatever their state — the ship's difficulty bands. */
function fillDepths(ship: Ship): void {
  for (const r of ship.rooms) r.depth = 0;
  const seen = new Set<RoomId>([ship.entry]);
  let frontier = [ship.entry];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: RoomId[] = [];
    for (const r of frontier) {
      for (const { room } of ship.neighbours(r)) {
        if (seen.has(room.id)) continue;
        seen.add(room.id);
        room.depth = depth;
        next.push(room.id);
      }
    }
    frontier = next;
  }
}

function parseDoor(token: string, line: string): { label: string; state: DoorState; key?: string } {
  if (!token.startsWith("-") || !token.endsWith("-") || token.length < 3) {
    throw new Error(`shipFromText: '${token}' is not a door in '${line}'`);
  }
  let inner = token.slice(1, -1);
  let state: DoorState = "open";
  const wrapped = CLOSERS[inner[0] ?? ""];
  if (wrapped !== undefined) {
    const closer = inner[0] === "(" ? ")" : inner[0] === "[" ? "]" : inner[0]!;
    if (!inner.endsWith(closer) || inner.length < 3) {
      throw new Error(`shipFromText: '${token}' is not closed in '${line}'`);
    }
    state = wrapped;
    inner = inner.slice(1, -1);
  }
  const [label, key] = inner.split(":");
  if (!label) throw new Error(`shipFromText: door has no label in '${line}'`);
  return key !== undefined ? { label, state, key } : { label, state };
}

function doorText(d: Door): string {
  const body = d.key !== undefined ? `${d.label}:${d.key}` : d.label;
  switch (d.state) {
    case "closed":
      return `-(${body})-`;
    case "locked":
      return `-[${body}]-`;
    case "sealed":
      return `-#${body}#-`;
    case "broken":
      return `-·${body}·-`;
    default:
      return `-${body}-`;
  }
}
