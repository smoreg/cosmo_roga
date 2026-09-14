// ../../../smoreg_works/packages/engine/src/rooms/graph.ts
var Ship = class _Ship {
  rooms;
  doors;
  entry;
  /** Door ids per room. Derived from `doors`; never serialised. */
  adj;
  constructor(rooms, doors, entry) {
    rooms.forEach((r, i) => {
      if (r.id !== i) throw new Error(`Ship: room ids must be dense, rooms[${i}].id === ${r.id}`);
    });
    doors.forEach((d, i) => {
      if (d.id !== i) throw new Error(`Ship: door ids must be dense, doors[${i}].id === ${d.id}`);
    });
    if (rooms[entry] === void 0) throw new Error(`Ship: entry ${entry} is not a room`);
    this.rooms = rooms;
    this.doors = doors;
    this.entry = entry;
    this.adj = rooms.map(() => []);
    for (const d of doors) {
      if (rooms[d.a] === void 0 || rooms[d.b] === void 0) {
        throw new Error(`Ship: door ${d.label} joins rooms that do not exist`);
      }
      this.adj[d.a].push(d.id);
      if (d.b !== d.a) this.adj[d.b].push(d.id);
    }
  }
  /** Rebuild from the flat form — a save file, or a structuredClone. */
  static rehydrate(data) {
    return new _Ship(data.rooms, data.doors, data.entry);
  }
  toJSON() {
    return { rooms: this.rooms, doors: this.doors, entry: this.entry };
  }
  get size() {
    return this.rooms.length;
  }
  roomAt(r) {
    const room = this.rooms[r];
    if (!room) throw new Error(`Ship: no room ${r}`);
    return room;
  }
  doorAt(d) {
    const door = this.doors[d];
    if (!door) throw new Error(`Ship: no door ${d}`);
    return door;
  }
  doorsOf(r) {
    const ids = this.adj[r];
    if (!ids) throw new Error(`Ship: no room ${r}`);
    return ids.map((id) => this.doors[id]);
  }
  /** Every door of `r` with the room it leads to. Passability is not consulted. */
  neighbours(r) {
    return this.doorsOf(r).map((door) => ({ door, room: this.roomAt(this.other(door, r)) }));
  }
  /** The far end of `d` seen from `r`. The airlock's far end is `r` itself. */
  other(d, r) {
    if (d.a === r) return d.b;
    if (d.b === r) return d.a;
    throw new Error(`Ship: door ${d.label} does not touch room ${r}`);
  }
  /**
   * May `who` walk through it? A `breacher` cuts locked and sealed doors open;
   * the caller charges the turns and the noise for that. The airlock is the
   * player's way out and a wall to everything else.
   */
  passable(d, who) {
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
  seeThrough(d) {
    return d.state === "open" || d.state === "broken";
  }
  door(label) {
    const d = this.doors.find((x) => x.label === label);
    if (!d) throw new Error(`Ship: no door labelled '${label}'`);
    return d;
  }
  room(label) {
    const r = this.rooms.find((x) => x.label === label);
    if (!r) throw new Error(`Ship: no room labelled '${label}'`);
    return r;
  }
  /** The airlock, when the ship has one. */
  airlock() {
    return this.doors.find((d) => d.state === "airlock");
  }
};

// ../../../smoreg_works/packages/engine/src/rooms/gen/layout.ts
var MAX_COLUMN = 6;
function parentDoor(ship, r) {
  const room = ship.roomAt(r);
  if (room.depth === 0) return void 0;
  let best;
  for (const { door, room: far } of ship.neighbours(r)) {
    if (far.id === r) continue;
    if (far.depth !== room.depth - 1) continue;
    if (!best || door.id < best.id) best = door;
  }
  return best;
}
function treeDoors(ship) {
  const out = /* @__PURE__ */ new Set();
  for (const r of ship.rooms) {
    const door = parentDoor(ship, r.id);
    if (door) out.add(door.id);
  }
  return out;
}
function layoutShip(ship) {
  const columns = /* @__PURE__ */ new Map();
  for (const r of ship.rooms) {
    r.col = r.depth;
    r.row = 0;
    const list = columns.get(r.col);
    if (list) list.push(r);
    else columns.set(r.col, [r]);
  }
  for (const col of [...columns.keys()].sort((a, b) => a - b)) {
    const here = columns.get(col);
    const kids = /* @__PURE__ */ new Map();
    const loose = [];
    for (const r of here) {
      const door = parentDoor(ship, r.id);
      const parent = door ? ship.roomAt(ship.other(door, r.id)) : void 0;
      if (!parent || parent.col !== col - 1) {
        loose.push(r);
        continue;
      }
      const list = kids.get(parent.id);
      if (list) list.push(r);
      else kids.set(parent.id, [r]);
    }
    const taken = /* @__PURE__ */ new Set();
    const parents = [...kids.keys()].map((id) => ship.roomAt(id)).sort((a, b) => a.row - b.row || a.id - b.id);
    for (const p of parents) {
      const first = kids.get(p.id)[0];
      first.row = freeAt(taken, p.row);
      taken.add(first.row);
    }
    for (const p of parents) {
      for (const kid of kids.get(p.id).slice(1)) {
        kid.row = freeBelow(taken, p.row) ?? freeAbove(taken, p.row) ?? freeAt(taken, p.row);
        taken.add(kid.row);
      }
    }
    for (const r of loose) {
      r.row = freeAt(taken, 0);
      taken.add(r.row);
    }
  }
}
function portsOf(ship, r) {
  const room = ship.roomAt(r);
  const out = /* @__PURE__ */ new Map();
  for (const door of ship.doorsOf(r)) {
    const id = ship.other(door, r);
    const far = ship.roomAt(id);
    const side = id === r ? "left" : far.col > room.col ? "right" : far.col < room.col ? "left" : far.row > room.row ? "down" : "up";
    const use = { door, dy: id === r ? 0 : far.row - room.row };
    const list = out.get(side);
    if (list) list.push(use);
    else out.set(side, [use]);
  }
  return out;
}
function layoutFaults(ship) {
  const out = [];
  const cells = /* @__PURE__ */ new Map();
  const perColumn = /* @__PURE__ */ new Map();
  for (const r of ship.rooms) {
    const cell = `${r.col},${r.row}`;
    const hit = cells.get(cell);
    if (hit !== void 0) out.push(`${r.label} and ${ship.roomAt(hit).label} share cell ${cell}`);
    cells.set(cell, r.id);
    if (r.col !== r.depth) out.push(`${r.label} is in column ${r.col} at depth ${r.depth}`);
    if (r.row < 0 || r.row >= MAX_COLUMN) out.push(`${r.label} sits on row ${r.row}, outside the visible band`);
    perColumn.set(r.col, (perColumn.get(r.col) ?? 0) + 1);
  }
  for (const [col, n] of perColumn) {
    if (n > MAX_COLUMN) out.push(`column ${col} holds ${n} rooms`);
  }
  for (const r of ship.rooms) {
    for (const [side, uses] of portsOf(ship, r.id)) {
      if (uses.length > 2) {
        out.push(`${r.label} has ${uses.length} doors on its ${side} side`);
        continue;
      }
      const [a, b] = uses;
      if (a && b && Math.sign(a.dy) === Math.sign(b.dy)) {
        out.push(`${r.label}: ${a.door.label} and ${b.door.label} leave its ${side} side the same way`);
      }
    }
  }
  for (const d of ship.doors) {
    if (d.a === d.b) continue;
    const a = ship.roomAt(d.a);
    const b = ship.roomAt(d.b);
    const dc = Math.abs(a.col - b.col);
    if (dc > 1) out.push(`${d.label} spans ${dc} columns`);
    else if (dc === 0 && Math.abs(a.row - b.row) !== 1) {
      out.push(`${d.label} joins ${a.label} and ${b.label} across ${Math.abs(a.row - b.row)} rows of one column`);
    }
  }
  return out;
}
function freeAt(taken, from) {
  const start = Math.max(0, from);
  if (!taken.has(start)) return start;
  for (let step = 1; step <= MAX_COLUMN; step++) {
    const down = start + step;
    if (down < MAX_COLUMN && !taken.has(down)) return down;
    const up = start - step;
    if (up >= 0 && !taken.has(up)) return up;
  }
  for (let row = MAX_COLUMN; ; row++) {
    if (!taken.has(row)) return row;
  }
}
function freeBelow(taken, from) {
  for (let row = Math.max(0, from) + 1; row < MAX_COLUMN; row++) {
    if (!taken.has(row)) return row;
  }
  return void 0;
}
function freeAbove(taken, from) {
  for (let row = Math.min(MAX_COLUMN, from) - 1; row >= 0; row--) {
    if (!taken.has(row)) return row;
  }
  return void 0;
}

// ../../../smoreg_works/packages/engine/src/rooms/gen/validate.ts
var DEEP_DEPTH = 3;
var KEY_MARK = "key:";
function reachableWithKeys(ship) {
  const rooms = /* @__PURE__ */ new Set([ship.entry]);
  const keys = /* @__PURE__ */ new Set();
  for (; ; ) {
    let grew = false;
    for (const r of rooms) {
      for (const mark of ship.roomAt(r).marks) {
        if (!mark.startsWith(KEY_MARK)) continue;
        const id = mark.slice(KEY_MARK.length);
        if (keys.has(id)) continue;
        keys.add(id);
        grew = true;
      }
    }
    for (const r of [...rooms]) {
      for (const { door, room } of ship.neighbours(r)) {
        if (room.id === r || rooms.has(room.id)) continue;
        if (!openable(door, keys)) continue;
        rooms.add(room.id);
        grew = true;
      }
    }
    if (!grew) return { rooms, keys };
  }
}
function validateShip(ship, spec2) {
  const out = [];
  const say = (code, detail) => {
    out.push({ code, detail });
  };
  if (ship.size < spec2.rooms[0] || ship.size > spec2.rooms[1]) {
    say("size", `${ship.size} rooms, spec asks for ${spec2.rooms[0]}..${spec2.rooms[1]}`);
  }
  const airlocks = ship.doors.filter((d) => d.state === "airlock");
  if (airlocks.length !== 1) say("airlock", `${airlocks.length} airlocks, expected exactly one`);
  const airlock = airlocks[0];
  if (airlock && (airlock.a !== ship.entry || airlock.b !== ship.entry)) {
    say("airlock", `${airlock.label} does not hang off the entry room`);
  }
  const entry = ship.roomAt(ship.entry);
  if (entry.depth !== 0) say("entry", `entry ${entry.label} is at depth ${entry.depth}`);
  if (entry.kind !== spec2.entryKind) {
    say("entry", `entry ${entry.label} is a ${entry.kind}, not a ${spec2.entryKind}`);
  }
  const cut = walk(ship, (d) => d.state !== "airlock");
  if (cut.size !== ship.size) {
    say("disconnected", `${ship.size - cut.size} rooms unreachable even with a cutter`);
  }
  const counts = /* @__PURE__ */ new Map();
  for (const r of ship.rooms) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  for (const k of spec2.kinds) {
    if (k.required && (counts.get(k.kind) ?? 0) !== 1) {
      say("required", `${k.kind} appears ${counts.get(k.kind) ?? 0} times, expected once`);
    }
    if (!k.deep) continue;
    for (const r of ship.rooms) {
      if (r.kind === k.kind && r.depth < DEEP_DEPTH) {
        say("deep", `${r.label} (${k.kind}) sits at depth ${r.depth}`);
      }
    }
  }
  const reach = reachableWithKeys(ship);
  for (const k of spec2.kinds) {
    if (!k.required) continue;
    for (const r of ship.rooms) {
      if (r.kind === k.kind && !reach.rooms.has(r.id)) {
        say("required-unreachable", `${r.label} (${k.kind}) needs a cutter or a key from behind a door`);
      }
    }
  }
  const placed = /* @__PURE__ */ new Set();
  for (const r of ship.rooms) {
    for (const mark of r.marks) {
      if (!mark.startsWith(KEY_MARK)) continue;
      const id = mark.slice(KEY_MARK.length);
      if (placed.has(id)) say("key", `key ${id} lies in more than one room`);
      placed.add(id);
      if (!ship.doors.some((d) => d.state === "locked" && d.key === id)) {
        say("key", `key ${id} in ${r.label} opens nothing`);
      }
    }
  }
  for (const d of ship.doors) {
    if (d.state !== "locked") continue;
    if (d.key === void 0) {
      say("key", `${d.label} is locked and names no key`);
      continue;
    }
    if (!placed.has(d.key)) say("key", `key ${d.key} for ${d.label} was never placed`);
    else if (!reach.keys.has(d.key)) say("key", `key ${d.key} lies behind ${d.label}, the door it opens`);
  }
  const tree = treeDoors(ship);
  for (const d of ship.doors) {
    if (d.state === "locked" && !tree.has(d.id)) say("locked-loop", `${d.label} is locked but is a loop`);
    if (d.state === "sealed" && tree.has(d.id)) say("sealed-tree", `${d.label} is welded shut across a tree edge`);
  }
  const unwelded = walk(ship, (d) => d.state !== "airlock" && d.state !== "sealed");
  if (unwelded.size !== ship.size) {
    say("sealed-cuts", `welded doors cut ${ship.size - unwelded.size} rooms off the ship`);
  }
  for (const r of ship.rooms) {
    const deg = ship.doorsOf(r.id).length;
    if (deg > 4) say("degree", `${r.label} has ${deg} doors`);
    if (r.depth > spec2.maxDepth) say("depth", `${r.label} is at depth ${r.depth}, spec allows ${spec2.maxDepth}`);
  }
  for (const fault of layoutFaults(ship)) say("layout", fault);
  const library = spec2.cards ?? [];
  if (library.length > 0) {
    for (const r of ship.rooms) {
      for (const mark of r.marks) {
        if (mark.startsWith(KEY_MARK)) continue;
        const fits = library.some(
          (c) => c.marks.includes(mark) && (!c.kinds || c.kinds.includes(r.kind))
        );
        if (!fits) say("card", `${r.label} (${r.kind}) carries '${mark}', which no card may leave there`);
      }
    }
  }
  return out;
}
function openable(d, keys) {
  switch (d.state) {
    case "open":
    case "closed":
    case "broken":
      return true;
    case "locked":
      return d.key !== void 0 && keys.has(d.key);
    default:
      return false;
  }
}
function walk(ship, passable) {
  const seen = /* @__PURE__ */ new Set([ship.entry]);
  const queue = [ship.entry];
  for (let head = 0; head < queue.length; head++) {
    for (const { door, room } of ship.neighbours(queue[head])) {
      if (room.id === queue[head] || seen.has(room.id) || !passable(door)) continue;
      seen.add(room.id);
      queue.push(room.id);
    }
  }
  return seen;
}

// ../../../smoreg_works/packages/engine/src/rooms/gen/hexlayout.ts
var HEX_KEY = "hex";
function hexOf(room) {
  const raw = room.data[HEX_KEY];
  if (typeof raw !== "object" || raw === null) return void 0;
  const cell = raw;
  if (typeof cell.q !== "number" || typeof cell.r !== "number") return void 0;
  return { q: cell.q, r: cell.r };
}
var ISOMETRIES = (() => {
  const turn = (c) => ({ q: -c.r, r: c.q + c.r });
  const flip = (c) => ({ q: c.q + c.r, r: -c.r });
  const out = [];
  for (const flipped of [false, true]) {
    for (let k = 0; k < 6; k++) {
      out.push((c) => {
        let at = flipped ? flip(c) : c;
        for (let i = 0; i < k; i++) at = turn(at);
        return at;
      });
    }
  }
  return out;
})();

// ../../../smoreg_works/games/salvor/src/content/zones.ts
var ENTRY_KIND = "docking";
var DOCKING = { kind: ENTRY_KIND, name: "DOCKING BAY" };
var CARGO = { kind: "cargo", name: "CARGO BAY", weight: 2, cover: true };
var CORRIDOR = { kind: "corridor", name: "CORRIDOR RING", weight: 3 };
var STORAGE = { kind: "storage", name: "STORAGE", weight: 2, cover: true };
var MAINTENANCE = { kind: "maintenance", name: "MAINTENANCE", weight: 2, cover: true };
var HAB = { kind: "hab", name: "HAB BLOCK", weight: 2 };
var MESS = { kind: "mess", name: "MESS" };
var HYDROPONICS = { kind: "hydroponics", name: "HYDROPONICS", cover: true };
var MED = { kind: "med", name: "MED BAY" };
var LAB = { kind: "lab", name: "LAB" };
var QUARANTINE = { kind: "quarantine", name: "QUARANTINE" };
var ENGINEERING = { kind: "engineering", name: "ENGINEERING", required: true };
var WORKSHOP = { kind: "workshop", name: "WORKSHOP", cover: true };
var ARMORY = { kind: "armory", name: "ARMORY", cover: true };
var REACTOR = { kind: "reactor", name: "REACTOR", required: true, deep: true };
var CONTROL = { kind: "control", name: "CONTROL", required: true, deep: true };
var CORE_ACCESS = { kind: "coreaccess", name: "CORE ACCESS" };
var LIFE_SUPPORT = { kind: "lifesupport", name: "LIFE SUPPORT" };
var CRYO = { kind: "cryo", name: "CRYO" };
var SENSORS = { kind: "sensors", name: "SENSOR BAY" };
var BRIG = { kind: "brig", name: "BRIG" };
var ESCAPE_PODS = { kind: "escapepods", name: "ESCAPE PODS" };
var ZONE_KINDS = [
  DOCKING,
  CARGO,
  CORRIDOR,
  STORAGE,
  MAINTENANCE,
  HAB,
  MESS,
  HYDROPONICS,
  MED,
  LAB,
  QUARANTINE,
  ENGINEERING,
  WORKSHOP,
  ARMORY,
  REACTOR,
  CONTROL,
  CORE_ACCESS,
  LIFE_SUPPORT,
  CRYO,
  SENSORS,
  BRIG,
  ESCAPE_PODS
];
var BY_KIND = new Map(ZONE_KINDS.map((z) => [z.kind, z]));

// verify-ship.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
var dir = process.argv[2] ?? ".";
var spec = {
  rooms: [8, 40],
  maxDepth: 12,
  kinds: ZONE_KINDS,
  entryKind: ENTRY_KIND,
  doors: { open: 4, closed: 3, locked: 1, sealed: 1, broken: 1 },
  hex: true
};
var bad = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
  let ship;
  try {
    ship = Ship.rehydrate(data);
  } catch (problem) {
    console.log(`${file}: REHYDRATE FAILED \u2014 ${String(problem)}`);
    bad++;
    continue;
  }
  layoutShip(ship);
  const problems = validateShip(ship, spec);
  const celled = ship.rooms.filter((room) => hexOf(room) !== void 0).length;
  const line = `${file.padEnd(26)} ${String(ship.size).padStart(3)} rooms  ${String(ship.doors.length).padStart(3)} doors  ${String(celled).padStart(3)}/${ship.size} celled`;
  if (problems.length === 0) console.log(`${line}  clean`);
  else {
    bad++;
    console.log(`${line}  ${problems.map((p) => `${p.code}: ${p.detail}`).join(" | ")}`);
  }
}
console.log(bad === 0 ? "\nAll ships pass SALVOR's own validator." : `
${String(bad)} ship(s) refused.`);
