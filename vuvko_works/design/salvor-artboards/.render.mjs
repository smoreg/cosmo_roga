// ../../../smoreg_works/packages/engine/src/sim/grid.ts
var DIRS8 = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 }
];
var DIRS4 = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 }
];
function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
var Grid = class _Grid {
  width;
  height;
  cells;
  constructor(width, height, fill3) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(fill3);
  }
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  get(x, y) {
    if (!this.inBounds(x, y)) return void 0;
    return this.cells[y * this.width + x];
  }
  /** Unsafe getter for hot loops; caller guarantees bounds. */
  at(x, y) {
    return this.cells[y * this.width + x];
  }
  set(x, y, v) {
    if (!this.inBounds(x, y)) return;
    this.cells[y * this.width + x] = v;
  }
  fill(v) {
    this.cells.fill(v);
  }
  forEach(fn) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) fn(x, y, this.cells[y * this.width + x]);
    }
  }
  clone() {
    const g = new _Grid(this.width, this.height, this.cells[0]);
    g.cells = this.cells.slice();
    return g;
  }
};

// ../../../smoreg_works/packages/engine/src/sim/rng.ts
var Rng = class _Rng {
  s;
  constructor(seed) {
    this.s = seed >>> 0;
  }
  static fromString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return new _Rng(h >>> 0);
  }
  /** Serialisable state. */
  get state() {
    return this.s;
  }
  set state(v) {
    this.s = v >>> 0;
  }
  /** [0, 1) */
  next() {
    this.s = this.s + 1831565813 >>> 0;
    let t2 = this.s;
    t2 = Math.imul(t2 ^ t2 >>> 15, t2 | 1);
    t2 ^= t2 + Math.imul(t2 ^ t2 >>> 7, t2 | 61);
    return ((t2 ^ t2 >>> 14) >>> 0) / 4294967296;
  }
  /** [lo, hi] inclusive */
  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  /** true with probability p */
  chance(p) {
    return this.next() < p;
  }
  /** 1..sides */
  die(sides) {
    return this.int(1, sides);
  }
  /** n dice of `sides`, e.g. roll(2, 6) == 2d6 */
  roll(n, sides) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.die(sides);
    return sum;
  }
  pick(arr) {
    if (arr.length === 0) throw new Error("Rng.pick: empty array");
    return arr[this.int(0, arr.length - 1)];
  }
  /** Fisher-Yates, in place, returns the same array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = arr[i];
      arr[i] = arr[j];
      arr[j] = a;
    }
    return arr;
  }
  /** Weighted pick: {orc: 3, troll: 1} -> "orc" 75% of the time. */
  weighted(table) {
    const keys = Object.keys(table);
    let total = 0;
    for (const k of keys) total += table[k];
    let r = this.next() * total;
    for (const k of keys) {
      r -= table[k];
      if (r <= 0) return k;
    }
    return keys[keys.length - 1];
  }
  /** Derive an independent stream (for per-level generation). */
  fork(salt) {
    return new _Rng((Math.imul(this.s ^ salt, 2654435761) ^ 2654435769) >>> 0);
  }
};

// ../../../smoreg_works/packages/engine/src/sim/entity.ts
function isAlive(e) {
  return e.alive && e.hp > 0;
}
var nextId = 1;
var active;
function newIdSeq() {
  return { next: 1 };
}
function useIds(seq) {
  if (active === seq) return;
  if (active) active.next = nextId;
  active = seq;
  nextId = seq.next;
}
function makeEntity(init) {
  return { ...init, id: nextId++, energy: 0, alive: true };
}

// ../../../smoreg_works/packages/engine/src/sim/shadowcast.ts
function shadowcast(ox, oy, opts) {
  opts.reveal(ox, oy);
  for (const q of [0, 1, 2, 3]) scanQuadrant(ox, oy, q, opts);
}
function transform(ox, oy, q, depth, col) {
  switch (q) {
    case 0:
      return [ox + col, oy - depth];
    // north
    case 1:
      return [ox + depth, oy + col];
    // east
    case 2:
      return [ox + col, oy + depth];
    // south
    case 3:
      return [ox - depth, oy + col];
  }
}
function scanQuadrant(ox, oy, q, opts) {
  const inRange = makeRangeTest(opts);
  const stack = [{ depth: 1, start: { num: -1, den: 1 }, end: { num: 1, den: 1 } }];
  while (stack.length > 0) {
    const row = stack.pop();
    if (row.depth > opts.radius) continue;
    let prevWasWall;
    const minCol = roundTiesUp(row.depth, row.start);
    const maxCol = roundTiesDown(row.depth, row.end);
    for (let col = minCol; col <= maxCol; col++) {
      const [x, y] = transform(ox, oy, q, row.depth, col);
      const wall = !opts.transparent(x, y);
      if (wall || isSymmetric(row, col)) {
        if (inRange(row.depth, col)) opts.reveal(x, y);
      }
      if (prevWasWall === true && !wall) {
        row.start = slope(row.depth, col);
      }
      if (prevWasWall === false && wall) {
        stack.push({ depth: row.depth + 1, start: { ...row.start }, end: slope(row.depth, col) });
      }
      prevWasWall = wall;
    }
    if (prevWasWall === false) {
      stack.push({ depth: row.depth + 1, start: { ...row.start }, end: { ...row.end } });
    }
  }
}
function makeRangeTest(opts) {
  if (opts.metric === "chebyshev") {
    return (depth, col) => Math.max(depth, Math.abs(col)) <= opts.radius;
  }
  const r2 = opts.radius * opts.radius;
  return (depth, col) => depth * depth + col * col <= r2 + opts.radius;
}
function slope(depth, col) {
  return { num: 2 * col - 1, den: 2 * depth };
}
function isSymmetric(row, col) {
  return col * row.start.den >= row.depth * row.start.num && col * row.end.den <= row.depth * row.end.num;
}
function roundTiesUp(depth, f2) {
  return Math.floor((2 * depth * f2.num + f2.den) / (2 * f2.den));
}
function roundTiesDown(depth, f2) {
  return -Math.floor(-(2 * depth * f2.num - f2.den) / (2 * f2.den));
}
function lineOfSight(from, to, transparent, radius) {
  let found = false;
  shadowcast(from.x, from.y, {
    transparent,
    radius,
    reveal: (x, y) => {
      if (x === to.x && y === to.y) found = true;
    }
  });
  return found;
}

// ../../../smoreg_works/packages/engine/src/sim/fov.ts
function hasLos(level, from, to, maxRange) {
  return lineOfSight(from, to, (x, y) => level.isTransparent(x, y), maxRange);
}

// ../../../smoreg_works/packages/engine/src/sim/dijkstra.ts
var UNREACHABLE = Infinity;
var DijkstraMap = class _DijkstraMap {
  values;
  constructor(values) {
    this.values = values;
  }
  get width() {
    return this.values.width;
  }
  get height() {
    return this.values.height;
  }
  at(x, y) {
    return this.values.get(x, y) ?? UNREACHABLE;
  }
  /**
   * Distance map from a set of goal tiles. Unit step cost plus `extraCost`.
   *
   * A goal is seeded even when `passable` rejects it. That matters more than it
   * sounds: the tile a monster stands on is not passable to anyone else, so
   * requiring passable goals made every "distance to the monsters" map come out
   * empty, and every flee behaviour silently degrade into standing still.
   * Spreading still obeys `passable`; only the seed is exempt.
   */
  static from(width, height, goals, opts) {
    const values = new Grid(width, height, UNREACHABLE);
    for (const g of goals) {
      if (values.inBounds(g.x, g.y)) values.set(g.x, g.y, 0);
    }
    relax(values, opts);
    return new _DijkstraMap(values);
  }
  /** Wrap an already-computed grid (used by combine/flee). */
  static fromValues(values) {
    return new _DijkstraMap(values);
  }
  /**
   * Safety map: negate and rescale the source map, then re-relax. An actor
   * rolling downhill on the result runs away *around corners* instead of into
   * the nearest dead end — the classic problem with "step away from the player".
   *
   * The 1.2 multiplier is Brogue's: >1 makes fleeing worth more than the
   * distance it costs, so a monster will accept a detour to gain safety.
   */
  fleeMap(opts, multiplier = -1.2) {
    const values = new Grid(this.width, this.height, UNREACHABLE);
    this.values.forEach((x, y, v) => {
      if (v === UNREACHABLE) return;
      values.set(x, y, v * multiplier);
    });
    relax(values, opts);
    return new _DijkstraMap(values);
  }
  /**
   * Weighted sum of several maps. Positive coefficient = "want to be near",
   * negative = "want to be far". Unreachable tiles stay unreachable.
   *
   * Caveat worth knowing before it costs a day of debugging: a summed map is a
   * gradient, not a guaranteed-descending field. If a repulsion coefficient
   * outweighs the attractions, the actor's own tile can become a local minimum
   * and bestStep() returns undefined — correctly, there is nowhere better
   * adjacent. Keep |repulsion| < |attraction| for "approach but avoid", and use
   * fleeMap() when an actor genuinely has to escape. Covered by tests.
   */
  static combine(parts) {
    if (parts.length === 0) throw new Error("DijkstraMap.combine: no parts");
    const first = parts[0].map;
    const values = new Grid(first.width, first.height, UNREACHABLE);
    for (let y = 0; y < first.height; y++) {
      for (let x = 0; x < first.width; x++) {
        let sum = 0;
        let ok = true;
        for (const p of parts) {
          const v = p.map.at(x, y);
          if (v === UNREACHABLE) {
            ok = false;
            break;
          }
          sum += v * p.weight;
        }
        if (ok) values.set(x, y, sum);
      }
    }
    return new _DijkstraMap(values);
  }
  /**
   * The neighbouring tile with the lowest value (or highest, if `uphill`).
   * Returns undefined when standing still is already the best option, so the
   * caller can decide whether that means "wait" or "attack".
   */
  bestStep(from, opts, uphill = false) {
    const dirs = opts.topology === 4 ? DIRS4 : DIRS8;
    const here3 = this.at(from.x, from.y);
    let best;
    let bestV = here3;
    for (const d of dirs) {
      const nx = from.x + d.x;
      const ny = from.y + d.y;
      if (!this.values.inBounds(nx, ny)) continue;
      if (!opts.passable(nx, ny)) continue;
      const v = this.at(nx, ny);
      if (v === UNREACHABLE) continue;
      const better = uphill ? v > bestV : v < bestV;
      if (better) {
        bestV = v;
        best = { x: nx, y: ny };
      }
    }
    return best;
  }
  /** Full path by walking downhill. Empty when the goal is unreachable. */
  pathFrom(from, opts, maxLen = 500) {
    const path = [];
    let cur = from;
    for (let i = 0; i < maxLen; i++) {
      const step = this.bestStep(cur, opts);
      if (!step) break;
      path.push(step);
      if (this.at(step.x, step.y) === 0) break;
      cur = step;
    }
    return path;
  }
  /** Debug view: two-digit values, '##' impassable, '..' unreachable. */
  toAscii() {
    const out2 = [];
    for (let y = 0; y < this.height; y++) {
      let row = "";
      for (let x = 0; x < this.width; x++) {
        const v = this.at(x, y);
        row += v === UNREACHABLE ? " .." : String(Math.round(v)).padStart(3, " ");
      }
      out2.push(row);
    }
    return out2;
  }
};
function relax(values, opts) {
  const dirs = opts.topology === 4 ? DIRS4 : DIRS8;
  const extra = opts.extraCost;
  const heap = new MinHeap(values.width * values.height);
  values.forEach((x, y, v) => {
    if (v !== UNREACHABLE) heap.push(v, x, y);
  });
  while (heap.size > 0) {
    const node = heap.pop();
    if (node.value > values.at(node.x, node.y)) continue;
    const cost = 1 + (extra ? extra(node.x, node.y) : 0);
    for (const d of dirs) {
      const nx = node.x + d.x;
      const ny = node.y + d.y;
      if (!values.inBounds(nx, ny)) continue;
      if (!opts.passable(nx, ny)) continue;
      const candidate = node.value + cost;
      if (candidate < values.at(nx, ny)) {
        values.set(nx, ny, candidate);
        heap.push(candidate, nx, ny);
      }
    }
  }
}
var MinHeap = class {
  vals;
  xs;
  ys;
  size = 0;
  constructor(capacity) {
    const cap = Math.max(16, capacity);
    this.vals = new Float64Array(cap);
    this.xs = new Int32Array(cap);
    this.ys = new Int32Array(cap);
  }
  push(value, x, y) {
    if (this.size === this.vals.length) this.grow();
    let i = this.size++;
    this.vals[i] = value;
    this.xs[i] = x;
    this.ys[i] = y;
    while (i > 0) {
      const parent = i - 1 >> 1;
      if (this.vals[parent] <= this.vals[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop() {
    if (this.size === 0) return void 0;
    const top = { value: this.vals[0], x: this.xs[0], y: this.ys[0] };
    this.size--;
    if (this.size > 0) {
      this.vals[0] = this.vals[this.size];
      this.xs[0] = this.xs[this.size];
      this.ys[0] = this.ys[this.size];
      let i = 0;
      for (; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.size && this.vals[l] < this.vals[smallest]) smallest = l;
        if (r < this.size && this.vals[r] < this.vals[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
  swap(a, b) {
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
    const x = this.xs[a];
    this.xs[a] = this.xs[b];
    this.xs[b] = x;
    const y = this.ys[a];
    this.ys[a] = this.ys[b];
    this.ys[b] = y;
  }
  grow() {
    const cap = this.vals.length * 2;
    const vals = new Float64Array(cap);
    vals.set(this.vals);
    this.vals = vals;
    const xs = new Int32Array(cap);
    xs.set(this.xs);
    this.xs = xs;
    const ys = new Int32Array(cap);
    ys.set(this.ys);
    this.ys = ys;
  }
};

// ../../../smoreg_works/packages/engine/src/sim/mapgen/vaults.ts
var TILE_CHARS = {
  "#": 0 /* Wall */,
  ".": 1 /* Floor */,
  ">": 2 /* StairsDown */,
  "+": 3 /* Door */,
  "%": 4 /* Rubble */,
  "=": 5 /* Airlock */,
  "|": 6 /* Bulkhead */,
  "<": 7 /* AirlockOut */
};

// ../../../smoreg_works/packages/engine/src/sim/status.ts
var STATUS = {
  poison: { name: "poisoned", tone: "bad", tickDamage: 1 },
  burn: { name: "burning", tone: "bad", tickDamage: 2 },
  stun: { name: "stunned", tone: "bad", scramblesAction: true },
  slow: { name: "slowed", tone: "bad", modifiers: { speed: { mul: 0.5 } }, opposes: "haste" },
  haste: { name: "hastened", tone: "good", modifiers: { speed: { mul: 2 } }, opposes: "slow" },
  blind: { name: "blinded", tone: "bad", modifiers: { fovRadius: { mul: 0.15 } } },
  shield: { name: "shielded", tone: "good", absorbs: true },
  regen: { name: "regenerating", tone: "good", tickDamage: -1 },
  confuse: { name: "confused", tone: "bad", scramblesAction: true }
};
function statusesOf(e) {
  if (!e.statuses) e.statuses = [];
  return e.statuses;
}
function applyStatus(e, kind, turns, magnitude = 1) {
  const list = statusesOf(e);
  const def = STATUS[kind];
  if (def.opposes) {
    const other = list.find((s) => s.kind === def.opposes && s.turns > 0);
    if (other) {
      other.turns = 0;
      return { applied: false, cancelled: def.opposes, message: `${STATUS[def.opposes].name} wears off` };
    }
  }
  const existing = list.find((s) => s.kind === kind && s.turns > 0);
  if (existing) {
    existing.turns = Math.max(existing.turns, turns);
    existing.magnitude = Math.max(existing.magnitude, magnitude);
    return { applied: true, message: `${def.name} (extended)` };
  }
  list.push({ kind, turns, magnitude });
  return { applied: true, message: def.name };
}
function tickStatuses(e, _rng) {
  const result = { hpDelta: 0, expired: [], messages: [] };
  const list = statusesOf(e);
  for (const s of list) {
    if (s.turns <= 0) continue;
    const def = STATUS[s.kind];
    if (def.tickDamage) {
      const delta = -def.tickDamage * s.magnitude;
      result.hpDelta += delta;
    }
    s.turns--;
    if (s.turns <= 0) {
      result.expired.push(s.kind);
      result.messages.push(`${def.name} wears off`);
    }
  }
  e.statuses = list.filter((s) => s.turns > 0);
  if (result.hpDelta !== 0) {
    e.hp = Math.max(0, Math.min(e.hpMax, e.hp + result.hpDelta));
    if (e.hp === 0) e.alive = false;
  }
  return result;
}
var BASE_STAT = {
  speed: (e) => e.speed,
  fovRadius: (e) => e.fovRadius,
  defense: (e) => e.defense,
  damageBonus: (e) => e.damage[2]
};
var STAT_FLOOR = { speed: 1, fovRadius: 1, defense: 0, damageBonus: -99 };
function modifiedStat(e, stat) {
  let value = BASE_STAT[stat](e);
  let add = 0;
  for (const s of statusesOf(e)) {
    if (s.turns <= 0) continue;
    const mod = STATUS[s.kind].modifiers?.[stat];
    if (!mod) continue;
    if (mod.mul !== void 0) value *= mod.mul;
    if (mod.add !== void 0) add += mod.add * s.magnitude;
  }
  return Math.max(STAT_FLOOR[stat], Math.round(value + add));
}
function effectiveSpeed(e) {
  return modifiedStat(e, "speed");
}
function effectiveFov(e) {
  return modifiedStat(e, "fovRadius");
}
function effectiveDefense(e) {
  return modifiedStat(e, "defense");
}
function actionScrambled(e) {
  return statusesOf(e).some((s) => s.turns > 0 && STATUS[s.kind].scramblesAction === true);
}
function absorbDamage(e, amount) {
  let remaining = amount;
  let absorbed = 0;
  for (const s of statusesOf(e)) {
    if (s.turns <= 0 || !STATUS[s.kind].absorbs) continue;
    const take2 = Math.min(s.magnitude, remaining);
    s.magnitude -= take2;
    remaining -= take2;
    absorbed += take2;
    if (s.magnitude <= 0) s.turns = 0;
    if (remaining <= 0) break;
  }
  e.statuses = statusesOf(e).filter((s) => s.turns > 0);
  return { toHp: remaining, absorbed };
}
function statusLine(e) {
  return statusesOf(e).filter((s) => s.turns > 0).map((s) => `${STATUS[s.kind].name} ${s.turns}`).join(", ");
}

// ../../../smoreg_works/packages/engine/src/sim/schedule.ts
var TURN_COST = 100;
var Schedule = class {
  /** Whole game turns elapsed (one beat of a speed-100 actor). */
  time = 0;
  /**
   * Returns the next actor that may act, adding energy as needed.
   * `actors` is read every call, so entities may die or spawn mid-turn.
   */
  next(actors) {
    const living = actors.filter(isAlive);
    if (living.length === 0) return void 0;
    for (let guard = 0; guard < 1e3; guard++) {
      const ready = living.filter((e) => e.energy >= TURN_COST).sort((a, b) => a.id - b.id);
      if (ready.length > 0) return ready[0];
      for (const e of living) e.energy += effectiveSpeed(e);
      this.time++;
    }
    throw new Error("Schedule.next: no actor became ready in 1000 beats (all speeds zero?)");
  }
  /** Charge an actor for an action. cost 100 = one normal turn. */
  spend(actor, cost = TURN_COST) {
    actor.energy -= cost;
  }
  /** New actors start ready-ish so they do not get a free double turn. */
  admit(actor) {
    actor.energy = 0;
  }
};

// ../../../smoreg_works/packages/engine/src/sim/damage.ts
function dealDamage(host, victim, raw2, source) {
  let remaining = raw2;
  for (const sys of host.systems) {
    if (!sys.onDamage) continue;
    const left = sys.onDamage(host, victim, remaining, source);
    remaining = Number.isFinite(left) ? Math.max(0, left) : remaining;
  }
  return applyDamage(victim, remaining, raw2 - remaining);
}
function applyDamage(victim, raw2, intercepted = 0) {
  const { toHp, absorbed } = absorbDamage(victim, raw2);
  victim.hp -= toHp;
  const killed = victim.hp <= 0;
  if (killed) {
    victim.hp = 0;
    victim.alive = false;
  }
  return { toHp, absorbed, intercepted, killed };
}

// ../../../smoreg_works/packages/engine/src/sim/combat.ts
function attack(attacker, defender, rng, sink) {
  const [n, sides] = attacker.damage;
  const raw2 = rng.roll(n, sides) + modifiedStat(attacker, "damageBonus");
  const afterArmour = Math.max(1, raw2 - effectiveDefense(defender));
  const res = sink ? sink(defender, afterArmour) : applyDamage(defender, afterArmour);
  return { hit: true, damage: res.toHp, absorbed: res.absorbed, intercepted: res.intercepted, killed: res.killed };
}

// ../../../smoreg_works/packages/engine/src/sim/ai/behaviors.ts
function terrainOnly(world) {
  return { passable: (x, y) => world.level.isWalkable(x, y), topology: 8 };
}
function cachedMap(world, key3, goals) {
  const cache = world.cache;
  const hit = cache?.get(key3);
  if (hit) return hit;
  const map = DijkstraMap.from(world.level.width, world.level.height, goals, terrainOnly(world));
  cache?.set(key3, map);
  return map;
}
function passableFor(world, self) {
  return {
    passable: (x, y) => {
      if (!world.level.isWalkable(x, y)) return false;
      const other = world.entities.find((e) => isAlive(e) && e.pos.x === x && e.pos.y === y);
      return other === void 0 || other.id === self.id || other.id === world.player.id;
    },
    topology: 8
  };
}
function adjacentEnemy(world, self) {
  return world.entities.find(
    (e) => isAlive(e) && e.faction !== self.faction && chebyshev(e.pos, self.pos) === 1
  );
}
function canSee(world, self, target) {
  const r = effectiveFov(self);
  return chebyshev(self.pos, target) <= r && hasLos(world.level, self.pos, target, r);
}
function scrambled(world, self) {
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 }
  ];
  const d = world.rng.pick(dirs);
  const to = { x: self.pos.x + d.x, y: self.pos.y + d.y };
  if (!world.level.isWalkable(to.x, to.y)) return { kind: "wait" };
  return { kind: "step", to };
}
function desireDriven(profile) {
  return (world, self) => {
    if (actionScrambled(self)) return scrambled(world, self);
    const enemy = adjacentEnemy(world, self);
    const hurt = self.hp / Math.max(1, self.hpMax);
    const fleeing = profile.fleeBelow !== void 0 && hurt < profile.fleeBelow;
    if (enemy && !fleeing) return { kind: "attack", target: enemy };
    const opts = passableFor(world, self);
    if (canSee(world, self, world.player.pos)) self.target = { ...world.player.pos };
    const goal = self.target;
    if (fleeing && goal) {
      const threat3 = cachedMap(world, `threat:${goal.x},${goal.y}`, [goal]);
      const safety = cachedMap2(world, `flee:${goal.x},${goal.y}`, () => threat3.fleeMap(terrainOnly(world)));
      const step2 = safety.bestStep(self.pos, opts);
      return step2 ? { kind: "step", to: step2 } : { kind: "wait" };
    }
    const parts = [];
    if (goal && profile.player !== 0) {
      parts.push({ map: cachedMap(world, `goal:${goal.x},${goal.y}`, [goal]), weight: profile.player });
    }
    if (profile.allies) {
      const mates = world.entities.filter((e) => isAlive(e) && e.id !== self.id && e.faction === self.faction).map((e) => e.pos);
      if (mates.length > 0) {
        const key3 = `allies:${mates.map((m) => `${m.x},${m.y}`).join(";")}`;
        parts.push({ map: cachedMap(world, key3, mates), weight: profile.allies });
      }
    }
    if (profile.noise && world.noise) {
      const heard = loudestHeard(world, self, 12);
      if (heard) parts.push({ map: cachedMap(world, `noise:${heard.x},${heard.y}`, [heard]), weight: profile.noise });
    }
    if (parts.length === 0) return { kind: "wait" };
    const desire = DijkstraMap.combine(parts);
    const step = desire.bestStep(self.pos, opts);
    if (!step) {
      if (goal && self.pos.x === goal.x && self.pos.y === goal.y) self.target = void 0;
      return { kind: "wait" };
    }
    return { kind: "step", to: step };
  };
}
function cachedMap2(world, key3, make) {
  const hit = world.cache?.get(key3);
  if (hit) return hit;
  const map = make();
  world.cache?.set(key3, map);
  return map;
}
function loudestHeard(world, self, radius) {
  if (!world.noise) return void 0;
  let best;
  let bestV = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = self.pos.x + dx;
      const y = self.pos.y + dy;
      const v = world.noise.get(x, y) ?? 0;
      if (v > bestV) {
        bestV = v;
        best = { x, y };
      }
    }
  }
  return best;
}
function hunter(memoryTurns = 8) {
  return (world, self) => {
    if (actionScrambled(self)) return scrambled(world, self);
    const enemy = adjacentEnemy(world, self);
    if (enemy) return { kind: "attack", target: enemy };
    const spotted = canSee(world, self, world.player.pos);
    if (spotted) {
      self.target = { ...world.player.pos };
      self.searchTurns = void 0;
    } else {
      const heard = loudestHeard(world, self, 12);
      if (heard) {
        self.target = heard;
        self.searchTurns = void 0;
      }
    }
    const goal = self.target;
    if (!goal) return { kind: "wait" };
    const atGoal = self.pos.x === goal.x && self.pos.y === goal.y;
    if (atGoal && !spotted) {
      const left = (self.searchTurns ?? memoryTurns) - 1;
      if (left <= 0) {
        self.behaviour = "brute";
        self.target = void 0;
        self.searchTurns = void 0;
        return BEHAVIOURS.brute(world, self);
      }
      self.searchTurns = left;
      return scrambled(world, self);
    }
    const opts = passableFor(world, self);
    const map = cachedMap(world, `goal:${goal.x},${goal.y}`, [goal]);
    const step = map.bestStep(self.pos, opts);
    return step ? { kind: "step", to: step } : { kind: "wait" };
  };
}
var turret = (world, self) => {
  const range = self.range ?? 0;
  if (range <= 0) return { kind: "wait" };
  if (chebyshev(self.pos, world.player.pos) > range) return { kind: "wait" };
  if (!hasLos(world.level, self.pos, world.player.pos, range)) return { kind: "wait" };
  return { kind: "shoot", target: world.player };
};
var staticBehaviour = () => ({ kind: "wait" });
var BEHAVIOURS = {
  /** Walks straight at the player and never gives up. */
  brute: desireDriven({ player: 1 }),
  /** Runs once badly hurt. */
  coward: desireDriven({ player: 1, fleeBelow: 0.35 }),
  /** Stays with the group; dangerous in numbers, timid alone. */
  pack: desireDriven({ player: 1, allies: 0.4, fleeBelow: 0.25 }),
  /** Hunts by sound rather than sight. */
  stalker: desireDriven({ player: 0.6, noise: 1.2 }),
  /** Keeps its distance; for casters and archers. */
  skirmisher: desireDriven({ player: -0.4, fleeBelow: 0.5 }),
  /** Walks to the last known player position, then searches before giving up. */
  hunter: hunter(),
  /** Stationary; shoots the player in range and line of sight. */
  turret,
  /** Stationary; does nothing on its own. */
  static: staticBehaviour
};

// ../../../smoreg_works/packages/engine/src/sim/log.ts
var MessageLog = class {
  lines = [];
  max;
  constructor(max = 200) {
    this.max = max;
  }
  add(text3, turn, tone = "plain", key3, params) {
    const last = this.lines[this.lines.length - 1];
    if (last && last.text === text3 && last.turn === turn && last.key === key3) {
      last.count++;
      return;
    }
    const line2 = { text: text3, turn, tone, count: 1 };
    if (key3 !== void 0) line2.key = key3;
    if (params !== void 0) line2.params = params;
    this.lines.push(line2);
    if (this.lines.length > this.max) this.lines.shift();
  }
  tail(n) {
    return this.lines.slice(Math.max(0, this.lines.length - n));
  }
};

// ../../../smoreg_works/packages/engine/src/sim/twist.ts
var NO_TWIST = { name: "none" };

// ../../../smoreg_works/packages/engine/src/sim/levelstore.ts
var LevelStore = class {
  levels = /* @__PURE__ */ new Map();
  get(id) {
    return this.levels.get(id);
  }
  put(id, stored) {
    this.levels.set(id, stored);
  }
  has(id) {
    return this.levels.has(id);
  }
  get size() {
    return this.levels.size;
  }
  /** Every id ever generated, in insertion order. */
  ids() {
    return [...this.levels.keys()];
  }
};
function levelSeed(runSeed, id) {
  let h = (2166136261 ^ runSeed >>> 0) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = (h ^ id.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ../../../smoreg_works/packages/engine/src/content/kinds.ts
function spawnMonster(kind, pos) {
  return makeEntity({
    name: kind.name,
    ch: kind.ch,
    fg: kind.fg,
    pos: { ...pos },
    faction: 1 /* Monster */,
    hp: kind.hp,
    hpMax: kind.hp,
    damage: kind.damage,
    defense: kind.defense,
    speed: kind.speed,
    fovRadius: kind.fovRadius,
    behaviour: kind.behaviour,
    range: kind.range,
    tags: kind.tags ? [...kind.tags] : []
  });
}
function spawnMonsterIn(kind, room) {
  const e = spawnMonster(kind, { x: 0, y: 0 });
  e.room = room;
  e.sight = kind.sight;
  e.keen = kind.keen;
  e.breacher = kind.breacher;
  return e;
}

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
  door(label3) {
    const d = this.doors.find((x) => x.label === label3);
    if (!d) throw new Error(`Ship: no door labelled '${label3}'`);
    return d;
  }
  room(label3) {
    const r = this.rooms.find((x) => x.label === label3);
    if (!r) throw new Error(`Ship: no room labelled '${label3}'`);
    return r;
  }
  /** The airlock, when the ship has one. */
  airlock() {
    return this.doors.find((d) => d.state === "airlock");
  }
};
function walkerOf(e) {
  return { breacher: e.breacher === true, isPlayer: e.faction === 0 /* Player */ };
}

// ../../../smoreg_works/packages/engine/src/rooms/paths.ts
var UNREACHABLE2 = Infinity;
var RoomDistance = class _RoomDistance {
  ship;
  values;
  constructor(ship, values) {
    this.ship = ship;
    this.values = values;
  }
  /**
   * Distance map from a set of goal rooms.
   *
   * Goals are seeded whether or not anything can be walked through to reach
   * them: the map "how far to the machines" has to be built from the rooms the
   * machines stand in, even when every door to them is welded shut.
   */
  static from(ship, goals, passable) {
    const values = new Array(ship.size).fill(UNREACHABLE2);
    for (const g of goals) {
      if (values[g] !== void 0) values[g] = 0;
    }
    relax2(ship, values, passable);
    return new _RoomDistance(ship, values);
  }
  /** Wrap already-computed values (used by flee/combine). */
  static wrap(ship, values) {
    return new _RoomDistance(ship, values);
  }
  at(r) {
    return this.values[r] ?? UNREACHABLE2;
  }
  /**
   * The door to step through to get closer: the neighbour with the lowest
   * value, ties broken by the lower door id so a replay never depends on the
   * order rooms happened to be built in.
   *
   * Undefined means standing still is already the best move — the caller
   * decides whether that is "wait" or "attack what is here".
   */
  nextDoor(from, passable) {
    let best;
    let bestV = this.at(from);
    for (const d of this.ship.doorsOf(from)) {
      if (!passable(d)) continue;
      const to = this.ship.other(d, from);
      if (to === from) continue;
      const v = this.at(to);
      if (v < bestV || best !== void 0 && v === bestV && d.id < best.id) {
        bestV = v;
        best = d;
      }
    }
    return best;
  }
  /**
   * Safety map: negate, rescale, rescan. Rolling downhill on the result runs
   * away *around the ship* instead of into the nearest dead end. The 1.2 is
   * Brogue's — above 1, so a detour that gains distance is worth its cost.
   */
  flee(passable, multiplier = -1.2) {
    const values = this.values.map((v) => v === UNREACHABLE2 ? UNREACHABLE2 : v * multiplier);
    relax2(this.ship, values, passable);
    return _RoomDistance.wrap(this.ship, values);
  }
  /**
   * Weighted sum. Positive weight = "want to be near", negative = "want to be
   * far", unreachable stays unreachable. The same caveat as on the grid: a sum
   * is a gradient, not a guaranteed descent, so keep |repulsion| below
   * |attraction| and use `flee` when something genuinely has to escape.
   */
  static combine(parts) {
    if (parts.length === 0) throw new Error("RoomDistance.combine: no parts");
    const ship = parts[0].map.ship;
    const values = new Array(ship.size).fill(UNREACHABLE2);
    for (let r = 0; r < ship.size; r++) {
      let sum = 0;
      let ok = true;
      for (const p of parts) {
        const v = p.map.at(r);
        if (v === UNREACHABLE2) {
          ok = false;
          break;
        }
        sum += v * p.weight;
      }
      if (ok) values[r] = sum;
    }
    return _RoomDistance.wrap(ship, values);
  }
  /** Debug view: "r1:0 r2:1 r3:.". For eyeballing a failing test. */
  toText() {
    return this.ship.rooms.map((r) => `${r.label}:${this.at(r.id) === UNREACHABLE2 ? "." : Math.round(this.at(r.id))}`).join(" ");
  }
};
function relax2(ship, values, passable) {
  const settled = new Array(ship.size).fill(false);
  for (; ; ) {
    let cur = -1;
    let curV = UNREACHABLE2;
    for (let r = 0; r < values.length; r++) {
      if (!settled[r] && values[r] < curV) {
        curV = values[r];
        cur = r;
      }
    }
    if (cur < 0) break;
    settled[cur] = true;
    for (const d of ship.doorsOf(cur)) {
      if (!passable(d)) continue;
      const to = ship.other(d, cur);
      const candidate = curV + 1;
      if (candidate < values[to]) values[to] = candidate;
    }
  }
}

// ../../../smoreg_works/packages/engine/src/rooms/noise.ts
var DOOR_LOSS = {
  open: 1,
  broken: 1,
  closed: 3,
  locked: 4,
  sealed: 4,
  airlock: Infinity
};
function doorLoss(d) {
  return DOOR_LOSS[d.state];
}
function propagateRooms(ship, sources, loss = doorLoss) {
  const heard = /* @__PURE__ */ new Map();
  const queue = [...sources].filter((s) => s.strength > 0 && ship.rooms[s.room] !== void 0).sort((a, b) => b.strength - a.strength).map((s) => s.room);
  for (const s of sources) {
    if (ship.rooms[s.room] === void 0 || s.strength <= 0) continue;
    if (s.strength > (heard.get(s.room) ?? 0)) heard.set(s.room, s.strength);
  }
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    const here3 = heard.get(from) ?? 0;
    if (here3 <= 0) continue;
    if (ship.roomAt(from).hazard === "vented") continue;
    for (const d of ship.doorsOf(from)) {
      const to = ship.other(d, from);
      if (to === from) continue;
      const next = here3 - loss(d);
      if (next <= 0) continue;
      if (next <= (heard.get(to) ?? 0)) continue;
      heard.set(to, next);
      queue.push(to);
    }
  }
  return heard;
}
function loudestRoom(ship, noise, from, radius) {
  let best;
  let bestV = 0;
  const seen = /* @__PURE__ */ new Set([from]);
  let frontier2 = [from];
  for (let step = 0; step <= radius; step++) {
    for (const r of frontier2) {
      const v = noise.get(r) ?? 0;
      if (v > bestV) {
        bestV = v;
        best = r;
      }
    }
    const next = [];
    for (const r of frontier2) {
      for (const { door, room } of ship.neighbours(r)) {
        if (door.state === "airlock" || seen.has(room.id)) continue;
        seen.add(room.id);
        next.push(room.id);
      }
    }
    frontier2 = next;
  }
  return best;
}

// ../../../smoreg_works/packages/engine/src/rooms/sight.ts
function visibleRooms(ship, from, depth) {
  if (opaque(ship, from)) return /* @__PURE__ */ new Set([from]);
  return spread(ship, from, depth, (d, to) => ship.seeThrough(d) && !opaque(ship, to));
}
function scanRooms(ship, from, depth) {
  return spread(ship, from, depth, () => true);
}
function opaque(ship, room) {
  return ship.roomAt(room).opaque === true;
}
function canSee2(ship, viewer, target) {
  const from = viewer.room;
  const to = target.room;
  if (from === void 0 || to === void 0) return false;
  if (target.hidden === true && viewer.keen !== true) return false;
  if (from === to) return true;
  if ((viewer.sight ?? 0) < 1) return false;
  return visibleRooms(ship, from, 1).has(to);
}
function spread(ship, from, depth, through) {
  const seen = /* @__PURE__ */ new Set([from]);
  let frontier2 = [from];
  for (let step = 0; step < depth; step++) {
    const next = [];
    for (const r of frontier2) {
      for (const d of ship.doorsOf(r)) {
        const to = ship.other(d, r);
        if (to === r || seen.has(to)) continue;
        if (!through(d, to)) continue;
        seen.add(to);
        next.push(to);
      }
    }
    if (next.length === 0) break;
    frontier2 = next;
  }
  return seen;
}

// ../../../smoreg_works/packages/engine/src/rooms/actions.ts
var FAIL = (reason, key3, params) => params === void 0 ? { ok: false, cost: 0, reason, key: key3 } : { ok: false, cost: 0, reason, key: key3, params };
var DONE = (cost = TURN_COST) => ({ ok: true, cost });
var BREACH_TURNS = 3;
var BREACH_NOISE = 9;
function perform2(game, actor, cmd) {
  const outcome = run(game, actor, cmd);
  if (!outcome.ok) return outcome;
  if (cmd.kind !== "wait" && cmd.kind !== "hide") actor.hidden = false;
  if (cmd.kind !== "go") clearBreach(actor);
  return outcome;
}
function run(game, actor, cmd) {
  switch (cmd.kind) {
    case "wait":
      return DONE();
    case "hide":
      return doHide(game, actor);
    case "go":
      return doGo(game, actor, cmd.door);
    case "attack":
      return doAttack(game, actor, cmd.target);
    case "leave":
      return doLeave(game, actor);
    case "act":
      return doCustom(game, actor, cmd);
  }
}
function doCustom(game, actor, cmd) {
  for (const sys of game.systems) {
    const out2 = sys.performCommand?.(game, actor, cmd);
    if (out2) return out2;
  }
  return FAIL("Nothing to do.", "engine.fail.nothing");
}
function doHide(game, actor) {
  const room = game.roomOf(actor);
  if (!room.cover) return FAIL("There is nothing to hide behind here.", "engine.fail.cover");
  actor.hidden = true;
  if (game.visible.has(room.id)) {
    game.log.add(
      `${label2(game, actor)} ${verb(game, actor, "slip")} into cover.`,
      game.schedule.time,
      "good",
      ...subject(game, actor, "engine.cover")
    );
  }
  return DONE();
}
function doGo(game, actor, id) {
  const here3 = game.roomOf(actor).id;
  const door = game.ship.doors[id];
  if (!door) return FAIL("There is no such door.", "engine.fail.door.gone");
  if (door.a !== here3 && door.b !== here3) {
    return FAIL(`The ${door.label} door is not in this room.`, "engine.fail.door.elsewhere", { door: door.label });
  }
  if (door.state === "airlock") {
    return actor.faction === 0 /* Player */ ? FAIL("That is the airlock. Use `leave` to go back to the tug.", "engine.fail.airlock") : FAIL(`${label2(game, actor)} cannot fit through ${door.label}.`, "engine.fail.door.size", {
      actor: actor.name,
      door: door.label
    });
  }
  if (!game.ship.passable(door, walkerOf(actor))) {
    return FAIL(`The ${door.label} door is ${door.state}.`, "engine.fail.door.shut", {
      door: door.label,
      state: door.state
    });
  }
  if (door.state === "locked" || door.state === "sealed") {
    const left = advanceBreach(actor, door);
    game.makeNoise(here3, BREACH_NOISE);
    if (left > 0) {
      logHere(
        game,
        here3,
        `${label2(game, actor)} ${verb(game, actor, "cut")} at ${door.label}.`,
        "warn",
        ...subject(game, actor, "engine.door.cut", { door: door.label })
      );
      return DONE();
    }
    door.state = "broken";
    logHere(game, here3, `${door.label} gives way with a shriek.`, "bad", "engine.door.breached", {
      door: door.label
    });
  } else if (door.state === "closed") {
    door.state = "open";
    logHere(game, here3, `The door ${door.label} slides open.`, "plain", "engine.door.open", { door: door.label });
  }
  clearBreach(actor);
  actor.room = game.ship.other(door, here3);
  return DONE();
}
function doAttack(game, actor, target) {
  const victim = game.entities.find((e) => e.id === target);
  if (!victim || !isAlive(victim)) return FAIL("Nothing to attack there.", "engine.fail.attack.gone");
  if (victim.faction === actor.faction) return FAIL("You will not strike an ally.", "engine.fail.attack.ally");
  if (victim.room !== actor.room) {
    if ((actor.range ?? 0) < 1) {
      return FAIL(`${label2(game, victim)} is not in this room.`, "engine.fail.attack.away", { target: victim.name });
    }
    if (!canSee2(game.ship, actor, victim)) {
      return FAIL(`${label2(game, victim)} is not in the line of fire.`, "engine.fail.attack.sight", {
        target: victim.name
      });
    }
  }
  const res = attack(actor, victim, game.rng, (v, raw2) => dealDamage(game, v, raw2, actor));
  const tone = actor.id === game.player.id ? "good" : "bad";
  if (res.damage > 0 || res.intercepted === 0) {
    game.log.add(
      `${label2(game, actor)} ${verb(game, actor, "hit")} ${label2(game, victim)} for ${res.damage}.`,
      game.schedule.time,
      tone,
      ...blow(game, actor, victim, res.damage)
    );
  }
  if (res.killed) {
    if (victim.id !== game.player.id) {
      game.log.add(`${label2(game, victim)} dies.`, game.schedule.time, tone, "engine.dies", { target: victim.name });
    }
    game.onDeath(victim);
  }
  return DONE();
}
function doLeave(game, actor) {
  if (actor.id !== game.player.id) return FAIL("Only the player may leave the ship.", "engine.fail.leave.other");
  const airlock = game.ship.doorsOf(game.roomOf(actor).id).find((d) => d.state === "airlock");
  if (!airlock) return FAIL("There is no airlock here.", "engine.fail.leave.none");
  game.leave();
  return DONE();
}
function advanceBreach(actor, door) {
  const open = readBreach(actor);
  const left = open && open.door === door.id ? open.left - 1 : BREACH_TURNS - 1;
  if (!actor.data) actor.data = {};
  actor.data.breaching = { door: door.id, left };
  return left;
}
function readBreach(actor) {
  const raw2 = actor.data?.breaching;
  if (typeof raw2 !== "object" || raw2 === null) return void 0;
  const b = raw2;
  if (typeof b.door !== "number" || typeof b.left !== "number") return void 0;
  return { door: b.door, left: b.left };
}
function clearBreach(actor) {
  if (actor.data) delete actor.data.breaching;
}
function logHere(game, room, text3, tone, key3, params) {
  if (game.visible.has(room)) game.log.add(text3, game.schedule.time, tone, key3, params);
}
function subject(game, actor, key3, rest) {
  return actor.id === game.player.id ? [`${key3}.you`, { ...rest }] : [`${key3}.other`, { ...rest, actor: actor.name }];
}
function blow(game, actor, victim, amount) {
  const left = { hp: Math.max(0, victim.hp), max: victim.hpMax };
  if (actor.id === game.player.id) return ["engine.hit.you", { target: victim.name, amount, ...left }];
  if (victim.id === game.player.id) return ["engine.hit.taken", { actor: actor.name, amount }];
  return ["engine.hit.other", { actor: actor.name, target: victim.name, amount, ...left }];
}
function label2(game, e) {
  return e.id === game.player.id ? "You" : `the ${e.name}`;
}
function verb(game, actor, base) {
  return actor.id === game.player.id ? base : `${base}s`;
}

// ../../../smoreg_works/packages/engine/src/rooms/behaviours.ts
var NOISE_RADIUS = 3;
function passableFor2(ship, self) {
  const who = walkerOf(self);
  return (d) => ship.passable(d, who);
}
function cachedMap3(world, key3, goals, passable) {
  return cached(world, key3, () => RoomDistance.from(world.ship, goals, passable));
}
function cached(world, key3, make) {
  const hit = world.cache?.get(key3);
  if (hit) return hit;
  const map = make();
  world.cache?.set(key3, map);
  return map;
}
function stagger(world, self) {
  if (self.room === void 0) return { kind: "wait" };
  const doors = world.ship.doorsOf(self.room).filter(passableFor2(world.ship, self));
  if (doors.length === 0) return { kind: "wait" };
  return { kind: "go", door: world.rng.pick(doors).id };
}
function desireDriven2(profile) {
  return (world, self) => {
    if (actionScrambled(self)) return stagger(world, self);
    const here3 = self.room;
    if (here3 === void 0) return { kind: "wait" };
    const player = world.player;
    const spotted = isAlive(player) && canSee2(world.ship, self, player);
    if (spotted && player.room !== void 0) rememberRoom(self, player.room);
    const hurt = self.hp / Math.max(1, self.hpMax);
    const fleeing = profile.fleeBelow !== void 0 && hurt < profile.fleeBelow;
    if (spotted && !fleeing) {
      if (player.room === here3) return { kind: "attack", target: player };
      if ((self.range ?? 0) >= 1) return { kind: "shoot", target: player };
    }
    const passable = passableFor2(world.ship, self);
    const step = stepFilter(world, self, profile.follow ?? "always");
    const goal = lastKnownRoom(self);
    if (fleeing) {
      if (goal === void 0) return { kind: "wait" };
      const threat3 = cachedMap3(world, mapKey(goal, self), [goal], passable);
      const safety = cached(world, keyFor(self, `flee:${goal}`), () => threat3.flee(passable));
      const door2 = safety.nextDoor(here3, step);
      return door2 ? { kind: "go", door: door2.id } : { kind: "wait" };
    }
    const parts = [];
    if (goal !== void 0 && profile.player !== 0) {
      parts.push({ map: cachedMap3(world, mapKey(goal, self), [goal], passable), weight: profile.player });
    }
    if (profile.allies) {
      const mates = alliedRooms(world, self);
      if (mates.length > 0) {
        const key3 = keyFor(self, `allies:${mates.join(",")}`);
        parts.push({ map: cachedMap3(world, key3, mates, passable), weight: profile.allies });
      }
    }
    if (profile.noise) {
      const heard = loudestRoom(world.ship, world.noise, here3, NOISE_RADIUS);
      if (heard !== void 0) {
        parts.push({ map: cachedMap3(world, keyFor(self, `noise:${heard}`), [heard], passable), weight: profile.noise });
      }
    }
    if (parts.length === 0) return { kind: "wait" };
    const door = RoomDistance.combine(parts).nextDoor(here3, step);
    if (!door) {
      if (goal === here3) rememberRoom(self, void 0);
      return { kind: "wait" };
    }
    return { kind: "go", door: door.id };
  };
}
function hunter2(memoryTurns = 8) {
  return (world, self) => {
    if (actionScrambled(self)) return stagger(world, self);
    const here3 = self.room;
    if (here3 === void 0) return { kind: "wait" };
    const player = world.player;
    const spotted = isAlive(player) && canSee2(world.ship, self, player);
    if (spotted && player.room === here3) return { kind: "attack", target: player };
    if (spotted && (self.range ?? 0) >= 1) return { kind: "shoot", target: player };
    if (spotted && player.room !== void 0) {
      rememberRoom(self, player.room);
      self.searchTurns = void 0;
    } else {
      const heard = loudestRoom(world.ship, world.noise, here3, NOISE_RADIUS);
      if (heard !== void 0 && heard !== here3) {
        rememberRoom(self, heard);
        self.searchTurns = void 0;
      }
    }
    const goal = lastKnownRoom(self);
    if (goal === void 0) return { kind: "wait" };
    if (goal === here3 && !spotted) {
      const left = (self.searchTurns ?? memoryTurns) - 1;
      if (left <= 0) {
        self.behaviour = "brute";
        rememberRoom(self, void 0);
        self.searchTurns = void 0;
        return BEHAVIOURS2.brute(world, self);
      }
      self.searchTurns = left;
      return { kind: "wait" };
    }
    const passable = passableFor2(world.ship, self);
    const map = cachedMap3(world, mapKey(goal, self), [goal], passable);
    const door = map.nextDoor(here3, passable);
    return door ? { kind: "go", door: door.id } : { kind: "wait" };
  };
}
var turret2 = (world, self) => {
  if (actionScrambled(self)) return { kind: "wait" };
  if ((self.range ?? 0) < 1) return { kind: "wait" };
  const player = world.player;
  if (!isAlive(player) || !canSee2(world.ship, self, player)) return { kind: "wait" };
  return { kind: "shoot", target: player };
};
var staticBehaviour2 = () => ({ kind: "wait" });
function stepFilter(world, self, follow) {
  const base = passableFor2(world.ship, self);
  const here3 = self.room;
  const drone = world.player.room;
  if (follow === "always" || here3 === void 0 || drone === void 0 || drone === here3) return base;
  if (follow === "withAllies" && hasMateAt(world, self, drone)) return base;
  return (d) => base(d) && world.ship.other(d, here3) !== drone;
}
function hasMateAt(world, self, room) {
  return world.entities.some(
    (e) => isAlive(e) && e.id !== self.id && e.faction === self.faction && (e.room === room || e.room === self.room)
  );
}
function alliedRooms(world, self) {
  const rooms = /* @__PURE__ */ new Set();
  for (const e of world.entities) {
    if (!isAlive(e) || e.id === self.id || e.faction !== self.faction || e.room === void 0) continue;
    rooms.add(e.room);
  }
  return [...rooms].sort((a, b) => a - b);
}
function mapKey(goal, self) {
  return keyFor(self, `goal:${goal}`);
}
function keyFor(self, key3) {
  return self.breacher === true ? `${key3}:breach` : key3;
}
function lastKnownRoom(self) {
  const v = self.data?.targetRoom;
  return typeof v === "number" ? v : void 0;
}
function rememberRoom(self, room) {
  if (!self.data) self.data = {};
  if (room === void 0) delete self.data.targetRoom;
  else self.data.targetRoom = room;
}
var brute = desireDriven2({ player: 1 });
var BEHAVIOURS2 = {
  brute,
  /** Runs once badly hurt, and never walks in after the drone. */
  coward: desireDriven2({ player: 1, fleeBelow: 0.35, follow: "never" }),
  /** Dangerous in numbers, timid alone: through the door only with a mate. */
  pack: desireDriven2({ player: 1, allies: 0.4, fleeBelow: 0.25, follow: "withAllies" }),
  /** Hunts by sound rather than sight. */
  stalker: desireDriven2({ player: 0.6, noise: 1.2 }),
  /** Keeps its distance; for the ones that shoot. */
  skirmisher: desireDriven2({ player: -0.4, fleeBelow: 0.5, follow: "never" }),
  /** Walks to the last known room, then searches it before giving up. */
  hunter: hunter2(),
  /** Stationary; shoots the drone here or through an open door. */
  turret: turret2,
  /** Stationary; does nothing on its own. */
  static: staticBehaviour2
};
function behaviourByName2(name) {
  if (name && name in BEHAVIOURS2) return BEHAVIOURS2[name];
  return BEHAVIOURS2.brute;
}

// ../../../smoreg_works/packages/engine/src/rooms/ai.ts
function takeAiTurn(game, actor, cache) {
  const world = {
    ship: game.ship,
    entities: game.entities,
    player: game.player,
    rng: game.rng,
    noise: game.noise,
    cache
  };
  return toCommand(behaviourByName2(actor.behaviour)(world, actor));
}
function toCommand(intent) {
  switch (intent.kind) {
    // Melee and a shot share one wire command: the target's id says where it
    // stands, and `perform` does not care which of the two this was. The
    // behaviour is what enforces range and line of sight for a "shoot" — only
    // ever emitting one that is already legal.
    case "attack":
    case "shoot":
      return { kind: "attack", target: intent.target.id };
    case "go":
      return { kind: "go", door: intent.door };
    case "wait":
      return { kind: "wait" };
  }
}
function runNonPlayerTurns2(game) {
  const cache = /* @__PURE__ */ new Map();
  for (let guard = 0; guard < 5e3; guard++) {
    const actor = game.schedule.next(game.entities);
    if (!actor) return;
    if (actor.id === game.player.id) return;
    const tick = tickStatuses(actor, game.rng);
    for (const msg of tick.messages) {
      if (actor.room !== void 0 && game.visible.has(actor.room)) {
        game.log.add(`The ${actor.name}'s ${msg}.`, game.schedule.time, "plain");
      }
    }
    if (!isAlive(actor)) {
      game.onDeath(actor);
      game.reapDead();
      continue;
    }
    const cmd = takeAiTurn(game, actor, cache);
    const outcome = perform2(game, actor, cmd);
    game.schedule.spend(actor, outcome.ok ? outcome.cost : 100);
    game.notifyActorTurn(actor);
    game.reapDead();
    if (!isAlive(game.player)) return;
  }
  throw new Error("runNonPlayerTurns: the player never got a turn back (AI livelock)");
}

// ../../../smoreg_works/packages/engine/src/rooms/game.ts
var DEFAULT_WIN_LINE = "The airlock closes behind you. You are out, and alive.";
var DEFAULT_DEATH_LINE = "The drone goes dark. The ship keeps what it takes.";
var RoomGame = class {
  seed;
  rng;
  schedule = new Schedule();
  log = new MessageLog();
  content;
  twist;
  /** Twist first, then extra systems. Hooks run in this order. */
  systems;
  ship;
  /** Which entry of `ships` the drone is aboard. */
  shipId = "1";
  /**
   * Every derelict this run has generated, by id. Going back aboard is a real
   * return: the same graph, the same doors as they were left, the same corpses,
   * because nothing is regenerated and nothing is repopulated.
   */
  ships = new LevelStore();
  entities = [];
  player;
  status = "playing";
  kills = 0;
  /** Every player command, in order. Replaying it against `seed` is the run. */
  inputs = [];
  /**
   * Run-wide flags a system can set and the generator can read: "the reactor
   * was breached", "the rival got here first". They outlive a ship, never a
   * run — writing one to storage would be meta-progression, which the jam
   * forbids.
   */
  flags = /* @__PURE__ */ new Set();
  /**
   * How much noise arrived in each room this turn, from `propagateRooms`.
   * A missing room means silence. Rebuilt every player turn, so it never
   * goes stale.
   */
  noise = /* @__PURE__ */ new Map();
  /** Rooms the drone can see right now. Recomputed after every player turn. */
  visible = /* @__PURE__ */ new Set();
  pendingNoises = [];
  /** True once a system says it owns the ending. Frozen for the run. */
  outcomeClaimed;
  /** False until the first ship is in place, so `travelTo` can build one. */
  started = false;
  /**
   * This run's own entity numbering. Claimed on the way into anything that can
   * spawn, so a second run alive in the same process — a replay of a bug
   * report, a bot harness comparing two voyages — numbers its machines from its
   * own sequence and neither run can renumber the other's.
   */
  ids = newIdSeq();
  constructor(cfg) {
    this.seed = cfg.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.content = cfg.content;
    this.twist = cfg.twist ?? NO_TWIST;
    this.systems = [this.twist, ...cfg.systems ?? []];
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
  travelTo(id, spec2) {
    useIds(this.ids);
    const first = !this.started;
    this.started = true;
    if (!first) {
      for (const sys of this.systems) {
        sys.beforeLevelLeave?.(this, this.roomOf(this.player).depth, spec2.reason ?? "airlock");
      }
      this.stash();
    }
    const stored = this.ships.get(id) ?? this.generateInto(id, spec2);
    stored.visits++;
    this.shipId = id;
    this.ship = stored.ship;
    if (first) this.player = this.content.makePlayer();
    this.player.room = spec2.entry ?? this.ship.entry;
    this.entities = [this.player, ...stored.entities];
    this.schedule.admit(this.player);
    this.noise = /* @__PURE__ */ new Map();
    this.pendingNoises = [];
    if (stored.visits === 1) this.populate(this.ship);
    for (const sys of this.systems) sys.onLevelEnter?.(this, this.roomOf(this.player).depth);
    this.refreshSight();
  }
  /** The store entry the drone is aboard, for a system's own bookkeeping. */
  get currentShip() {
    return this.ships.get(this.shipId);
  }
  /** Put the ship the drone is leaving back in the store, player excluded. */
  stash() {
    const stored = this.currentShip;
    stored.entities = this.entities.filter((e) => e.id !== this.player.id);
  }
  generateInto(id, spec2) {
    const stored = {
      ship: spec2.generate(this.rng),
      entities: [],
      scheduleSeed: levelSeed(this.seed, id),
      data: {},
      visits: 0
    };
    this.ships.put(id, stored);
    return stored;
  }
  /**
   * One roll per room rather than one budget per ship: how dangerous a room is
   * follows from how far in it lies, and the cap is what keeps a big ship from
   * being a wall of machines.
   */
  populate(ship) {
    let placed = 0;
    for (const room of ship.rooms) {
      if (placed >= this.content.maxMonsters) return;
      if (room.depth < 1) continue;
      if (!this.rng.chance(this.content.monsterChance(room.depth))) continue;
      const kinds = this.content.monstersForDepth(room.depth);
      if (kinds.length === 0) continue;
      const table = {};
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
  leave(reason = "airlock") {
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
  finish(status, line2) {
    if (this.status !== "playing") return;
    this.status = status;
    this.log.add(line2, this.schedule.time, status === "won" ? "good" : "bad");
  }
  // ---------------------------------------------------------------- turn cycle
  /**
   * The single entry point the UI calls. Returns the outcome so the UI can
   * distinguish "illegal, say why" from "turn taken, redraw".
   */
  playerCommand(cmd) {
    useIds(this.ids);
    if (this.status !== "playing") {
      return { ok: false, cost: 0, reason: "The run is over.", key: "engine.fail.over" };
    }
    const ready = this.schedule.next(this.entities);
    if (ready && ready.id !== this.player.id) {
      runNonPlayerTurns2(this);
    }
    const tick = tickStatuses(this.player, this.rng);
    if (tick.hpDelta < 0) this.log.add(`You take ${-tick.hpDelta} from your afflictions.`, this.schedule.time, "bad");
    for (const msg of tick.messages) this.log.add(`Your ${msg}.`, this.schedule.time, "plain");
    if (!isAlive(this.player)) {
      this.status = "dead";
      this.log.add(this.content.deathLine ?? DEFAULT_DEATH_LINE, this.schedule.time, "bad");
      return { ok: true, cost: 0 };
    }
    const outcome = perform2(this, this.player, cmd);
    if (!outcome.ok) {
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
      runNonPlayerTurns2(this);
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
  refreshSight() {
    const room = this.roomOf(this.player);
    room.explored = true;
    this.visible = visibleRooms(this.ship, room.id, this.player.sight ?? 0);
  }
  /** Register a sound. Louder carries further; shut doors swallow it. */
  makeNoise(room, strength) {
    this.pendingNoises.push({ room, strength });
  }
  settleNoise() {
    this.noise = propagateRooms(this.ship, this.pendingNoises);
    this.pendingNoises = [];
  }
  onDeath(victim) {
    if (victim.id !== this.player.id) this.kills++;
    for (const sys of this.systems) sys.onDeath?.(this, victim);
  }
  /** Called by the AI loop after each non-player actor has acted. */
  notifyActorTurn(actor) {
    for (const sys of this.systems) sys.afterActorTurn?.(this, actor);
  }
  /** Drop corpses from the entity list, unless they still block. */
  reapDead() {
    this.entities = this.entities.filter((e) => isAlive(e) || e.blocksWhenDead === true || e.id === this.player.id);
  }
  // ------------------------------------------------------------------- queries
  /** The room an entity stands in. Everything aboard is in exactly one. */
  roomOf(e) {
    if (e.room === void 0) throw new Error(`RoomGame: ${e.name} is not aboard a ship`);
    return this.ship.roomAt(e.room);
  }
  entitiesIn(r) {
    return this.entities.filter((e) => e.room === r);
  }
  /** Machines the drone can see: this room, and the next one through a hole. */
  visibleMonsters() {
    return this.entities.filter((e) => e.id !== this.player.id && isAlive(e) && canSee2(this.ship, this.player, e));
  }
  isOver() {
    return this.status !== "playing";
  }
  /** Standing in the room the airlock hangs off. */
  atAirlock() {
    return this.ship.doorsOf(this.roomOf(this.player).id).some((d) => d.state === "airlock");
  }
  describe(e) {
    const statuses = statusLine(e);
    return `${label2(this, e)} (${e.hp}/${e.hpMax})${statuses ? ` [${statuses}]` : ""}`;
  }
};
function commandNoise(cmd) {
  switch (cmd.kind) {
    case "attack":
      return 9;
    case "go":
      return 3;
    default:
      return 0;
  }
}

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
  const out2 = /* @__PURE__ */ new Set();
  for (const r of ship.rooms) {
    const door = parentDoor(ship, r.id);
    if (door) out2.add(door.id);
  }
  return out2;
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
    const here3 = columns.get(col);
    const kids = /* @__PURE__ */ new Map();
    const loose = [];
    for (const r of here3) {
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
  const out2 = /* @__PURE__ */ new Map();
  for (const door of ship.doorsOf(r)) {
    const id = ship.other(door, r);
    const far = ship.roomAt(id);
    const side = id === r ? "left" : far.col > room.col ? "right" : far.col < room.col ? "left" : far.row > room.row ? "down" : "up";
    const use = { door, dy: id === r ? 0 : far.row - room.row };
    const list = out2.get(side);
    if (list) list.push(use);
    else out2.set(side, [use]);
  }
  return out2;
}
function layoutFaults(ship) {
  const out2 = [];
  const cells = /* @__PURE__ */ new Map();
  const perColumn = /* @__PURE__ */ new Map();
  for (const r of ship.rooms) {
    const cell2 = `${r.col},${r.row}`;
    const hit = cells.get(cell2);
    if (hit !== void 0) out2.push(`${r.label} and ${ship.roomAt(hit).label} share cell ${cell2}`);
    cells.set(cell2, r.id);
    if (r.col !== r.depth) out2.push(`${r.label} is in column ${r.col} at depth ${r.depth}`);
    if (r.row < 0 || r.row >= MAX_COLUMN) out2.push(`${r.label} sits on row ${r.row}, outside the visible band`);
    perColumn.set(r.col, (perColumn.get(r.col) ?? 0) + 1);
  }
  for (const [col, n] of perColumn) {
    if (n > MAX_COLUMN) out2.push(`column ${col} holds ${n} rooms`);
  }
  for (const r of ship.rooms) {
    for (const [side, uses] of portsOf(ship, r.id)) {
      if (uses.length > 2) {
        out2.push(`${r.label} has ${uses.length} doors on its ${side} side`);
        continue;
      }
      const [a, b] = uses;
      if (a && b && Math.sign(a.dy) === Math.sign(b.dy)) {
        out2.push(`${r.label}: ${a.door.label} and ${b.door.label} leave its ${side} side the same way`);
      }
    }
  }
  for (const d of ship.doors) {
    if (d.a === d.b) continue;
    const a = ship.roomAt(d.a);
    const b = ship.roomAt(d.b);
    const dc = Math.abs(a.col - b.col);
    if (dc > 1) out2.push(`${d.label} spans ${dc} columns`);
    else if (dc === 0 && Math.abs(a.row - b.row) !== 1) {
      out2.push(`${d.label} joins ${a.label} and ${b.label} across ${Math.abs(a.row - b.row)} rows of one column`);
    }
  }
  return out2;
}
function freeAt(taken, from) {
  const start2 = Math.max(0, from);
  if (!taken.has(start2)) return start2;
  for (let step = 1; step <= MAX_COLUMN; step++) {
    const down = start2 + step;
    if (down < MAX_COLUMN && !taken.has(down)) return down;
    const up = start2 - step;
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
var LOCK_ENTRY = "lock-entry";
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
  const out2 = [];
  const say2 = (code, detail) => {
    out2.push({ code, detail });
  };
  if (ship.size < spec2.rooms[0] || ship.size > spec2.rooms[1]) {
    say2("size", `${ship.size} rooms, spec asks for ${spec2.rooms[0]}..${spec2.rooms[1]}`);
  }
  const airlocks = ship.doors.filter((d) => d.state === "airlock");
  if (airlocks.length !== 1) say2("airlock", `${airlocks.length} airlocks, expected exactly one`);
  const airlock = airlocks[0];
  if (airlock && (airlock.a !== ship.entry || airlock.b !== ship.entry)) {
    say2("airlock", `${airlock.label} does not hang off the entry room`);
  }
  const entry = ship.roomAt(ship.entry);
  if (entry.depth !== 0) say2("entry", `entry ${entry.label} is at depth ${entry.depth}`);
  if (entry.kind !== spec2.entryKind) {
    say2("entry", `entry ${entry.label} is a ${entry.kind}, not a ${spec2.entryKind}`);
  }
  const cut = walk(ship, (d) => d.state !== "airlock");
  if (cut.size !== ship.size) {
    say2("disconnected", `${ship.size - cut.size} rooms unreachable even with a cutter`);
  }
  const counts = /* @__PURE__ */ new Map();
  for (const r of ship.rooms) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  for (const k of spec2.kinds) {
    if (k.required && (counts.get(k.kind) ?? 0) !== 1) {
      say2("required", `${k.kind} appears ${counts.get(k.kind) ?? 0} times, expected once`);
    }
    if (!k.deep) continue;
    for (const r of ship.rooms) {
      if (r.kind === k.kind && r.depth < DEEP_DEPTH) {
        say2("deep", `${r.label} (${k.kind}) sits at depth ${r.depth}`);
      }
    }
  }
  const reach2 = reachableWithKeys(ship);
  for (const k of spec2.kinds) {
    if (!k.required) continue;
    for (const r of ship.rooms) {
      if (r.kind === k.kind && !reach2.rooms.has(r.id)) {
        say2("required-unreachable", `${r.label} (${k.kind}) needs a cutter or a key from behind a door`);
      }
    }
  }
  const placed = /* @__PURE__ */ new Set();
  for (const r of ship.rooms) {
    for (const mark of r.marks) {
      if (!mark.startsWith(KEY_MARK)) continue;
      const id = mark.slice(KEY_MARK.length);
      if (placed.has(id)) say2("key", `key ${id} lies in more than one room`);
      placed.add(id);
      if (!ship.doors.some((d) => d.state === "locked" && d.key === id)) {
        say2("key", `key ${id} in ${r.label} opens nothing`);
      }
    }
  }
  for (const d of ship.doors) {
    if (d.state !== "locked") continue;
    if (d.key === void 0) {
      say2("key", `${d.label} is locked and names no key`);
      continue;
    }
    if (!placed.has(d.key)) say2("key", `key ${d.key} for ${d.label} was never placed`);
    else if (!reach2.keys.has(d.key)) say2("key", `key ${d.key} lies behind ${d.label}, the door it opens`);
  }
  const tree = treeDoors(ship);
  for (const d of ship.doors) {
    if (d.state === "locked" && !tree.has(d.id)) say2("locked-loop", `${d.label} is locked but is a loop`);
    if (d.state === "sealed" && tree.has(d.id)) say2("sealed-tree", `${d.label} is welded shut across a tree edge`);
  }
  const unwelded = walk(ship, (d) => d.state !== "airlock" && d.state !== "sealed");
  if (unwelded.size !== ship.size) {
    say2("sealed-cuts", `welded doors cut ${ship.size - unwelded.size} rooms off the ship`);
  }
  for (const r of ship.rooms) {
    const deg = ship.doorsOf(r.id).length;
    if (deg > 4) say2("degree", `${r.label} has ${deg} doors`);
    if (r.depth > spec2.maxDepth) say2("depth", `${r.label} is at depth ${r.depth}, spec allows ${spec2.maxDepth}`);
  }
  for (const fault of layoutFaults(ship)) say2("layout", fault);
  const library = spec2.cards ?? [];
  if (library.length > 0) {
    for (const r of ship.rooms) {
      for (const mark of r.marks) {
        if (mark.startsWith(KEY_MARK)) continue;
        const fits = library.some(
          (c) => c.marks.includes(mark) && (!c.kinds || c.kinds.includes(r.kind))
        );
        if (!fits) say2("card", `${r.label} (${r.kind}) carries '${mark}', which no card may leave there`);
      }
    }
  }
  return out2;
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
var HEX_SPACING = 1.34;
var HEX_DIRS = [
  { q: 1, r: 0 },
  // east
  { q: 1, r: -1 },
  // north-east
  { q: 0, r: 1 },
  // south-east
  { q: 0, r: -1 },
  // north-west
  { q: -1, r: 1 },
  // south-west
  { q: -1, r: 0 }
  // west
];
var MASK_FLOOR = 0.8;
var SEARCH_BUDGET = 8e3;
function hexAdjacent(a, b) {
  return HEX_DIRS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r);
}
function hexKey(cell2) {
  return `${cell2.q},${cell2.r}`;
}
var key = hexKey;
var HEX_KEY = "hex";
function hexOf(room) {
  const raw2 = room.data[HEX_KEY];
  if (typeof raw2 !== "object" || raw2 === null) return void 0;
  const cell2 = raw2;
  if (typeof cell2.q !== "number" || typeof cell2.r !== "number") return void 0;
  return { q: cell2.q, r: cell2.r };
}
function hexAround(cell2) {
  return HEX_DIRS.map((d) => ({ q: cell2.q + d.q, r: cell2.r + d.r }));
}
function hexLayout(ship, opts = {}) {
  if (opts.allowed !== void 0) {
    const masked = embed(ship, opts.allowed);
    if (masked !== void 0) return masked;
  }
  const stored = latticeCells(ship);
  if (stored !== void 0) return { ...judge(ship, stored), masked: false };
  return embed(ship, void 0);
}
function embed(ship, allowed) {
  const cells = /* @__PURE__ */ new Map();
  const taken = /* @__PURE__ */ new Map();
  const inMask = allowed === void 0 ? void 0 : [...allowed].map(parseKey).sort(westward);
  const middle = inMask === void 0 ? void 0 : centreOf(inMask);
  const roots = ship.rooms.filter((room) => parentDoor(ship, room.id) === void 0).sort((a, b) => a.depth - b.depth || a.id - b.id);
  const stored = allowed === void 0 ? void 0 : latticeCells(ship);
  const fitted3 = stored === void 0 ? void 0 : hexFit(stored, allowed);
  if (fitted3 !== void 0) for (const [room, at] of fitted3) place2(room, at);
  let lane = 0;
  for (const root of roots) {
    if (cells.has(root.id)) continue;
    const at = inMask === void 0 ? { q: 0, r: lane } : nearestFree(inMask[0] ?? { q: 0, r: 0 });
    if (at === void 0 || taken.has(key(at))) continue;
    place2(root.id, at);
    if (inMask === void 0 || !search(root.id)) grow2(root.id);
    lane += ship.rooms.length + 2;
  }
  const offLattice = [];
  for (const room of ship.rooms) {
    if (cells.has(room.id)) continue;
    const free2 = nearestFree(inMask === void 0 ? { q: 0, r: lane } : inMask[0] ?? { q: 0, r: 0 });
    if (free2 === void 0) offLattice.push(room.id);
    else place2(room.id, free2);
    lane += 2;
  }
  repair3();
  const out2 = { ...judge(ship, cells), offLattice, masked: inMask !== void 0 };
  if (inMask === void 0) return out2;
  if (offLattice.length > 0) return void 0;
  const doors = out2.corridors.size + out2.links.size;
  if (doors > 0 && out2.corridors.size / doors < MASK_FLOOR) return void 0;
  return out2;
  function place2(room, at) {
    cells.set(room, at);
    taken.set(key(at), room);
  }
  function unplace(room) {
    const at = cells.get(room);
    if (at === void 0) return;
    taken.delete(key(at));
    cells.delete(room);
  }
  function repair3() {
    const rooms = [...ship.rooms].sort((a, b) => a.id - b.id);
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (const room of rooms) {
        const from = cells.get(room.id);
        if (from === void 0) continue;
        const now = drawn2(room.id, from);
        for (const cell2 of candidates(room.id)) {
          if (drawn2(room.id, cell2) <= now) continue;
          taken.delete(key(from));
          place2(room.id, cell2);
          moved = true;
          break;
        }
      }
      if (inMask !== void 0 && swap(rooms)) moved = true;
      if (!moved) return;
    }
  }
  function swap(rooms) {
    for (let i = 0; i < rooms.length; i++) {
      const a = rooms[i].id;
      const atA = cells.get(a);
      if (atA === void 0) continue;
      for (let j = i + 1; j < rooms.length; j++) {
        const b = rooms[j].id;
        const atB = cells.get(b);
        if (atB === void 0) continue;
        const before = drawn2(a, atA) + drawn2(b, atB);
        cells.set(a, atB);
        cells.set(b, atA);
        const after = drawn2(a, atB) + drawn2(b, atA);
        if (after > before) {
          taken.set(key(atA), b);
          taken.set(key(atB), a);
          return true;
        }
        cells.set(a, atA);
        cells.set(b, atB);
      }
    }
    return false;
  }
  function drawn2(room, cell2) {
    let n = 0;
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at !== void 0 && hexAdjacent(cell2, at)) n++;
    }
    return n;
  }
  function candidates(room) {
    const out3 = [];
    const seen = /* @__PURE__ */ new Set();
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === void 0) continue;
      for (const cell2 of around(at)) {
        if (!free(cell2) || seen.has(key(cell2))) continue;
        seen.add(key(cell2));
        out3.push(cell2);
      }
    }
    return out3;
  }
  function free(cell2) {
    const k = key(cell2);
    return !taken.has(k) && (allowed === void 0 || allowed.has(k));
  }
  function around(cell2) {
    return HEX_DIRS.map((d) => ({ q: cell2.q + d.q, r: cell2.r + d.r }));
  }
  function breathing(cell2) {
    return around(cell2).filter(free).length;
  }
  function loopsMet(room, cell2) {
    let met = 0;
    for (const { door, room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === void 0) continue;
      if (parentDoor(ship, room)?.id === door.id) continue;
      if (hexAdjacent(cell2, at)) met++;
    }
    return met;
  }
  function nearestFree(from) {
    if (free(from)) return from;
    if (inMask !== void 0) {
      let best;
      let bestAt = Infinity;
      for (const cell2 of inMask) {
        if (!free(cell2)) continue;
        const d = distance(from, cell2);
        if (d < bestAt) {
          bestAt = d;
          best = cell2;
        }
      }
      return best;
    }
    for (let ring = 1; ring <= ship.rooms.length + 2; ring++) {
      for (let dq = -ring; dq <= ring; dq++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) !== ring) continue;
          const cell2 = { q: from.q + dq, r: from.r + dr };
          if (free(cell2)) return cell2;
        }
      }
    }
    return void 0;
  }
  function seats(child, here3) {
    const score = (cell2) => loopsMet(child, cell2) * 8 + breathing(cell2) * 2 - (middle === void 0 ? 0 : distance(cell2, middle));
    return around(here3).filter(free).sort((a, b) => score(b) - score(a));
  }
  function grow2(from) {
    const queue = [from];
    while (queue.length > 0) {
      const room = queue.shift();
      const here3 = cells.get(room);
      for (const child of childrenOf(ship, room)) {
        if (cells.has(child)) continue;
        const at = seats(child, here3)[0] ?? nearestFree(here3);
        if (at === void 0) continue;
        place2(child, at);
        queue.push(child);
      }
    }
  }
  function search(root) {
    return placeAll(root, true) || placeAll(root, false);
  }
  function placeAll(root, strict) {
    const order = strict ? tightestFirst(root) : breadthFirst(root);
    const loops = strict ? 0 : loopDoorsAmong(order, root);
    let budget = SEARCH_BUDGET;
    let best;
    let bestMet = -1;
    step(0, 0);
    for (const room of order) unplace(room);
    if (best === void 0) return false;
    for (const [room, at] of best) place2(room, at);
    return true;
    function step(i, met) {
      if (i === order.length) {
        if (met > bestMet) {
          bestMet = met;
          best = new Map(order.map((room2) => [room2, cells.get(room2)]));
        }
        return strict || met >= loops;
      }
      const room = order[i];
      for (const at of strict ? fits(room) : seats(room, cells.get(parentOf(room)))) {
        if (budget-- <= 0) return true;
        const gained = strict ? 0 : loopsMet(room, at);
        place2(room, at);
        const done = step(i + 1, met + gained);
        unplace(room);
        if (done) return true;
      }
      return false;
    }
  }
  function loopDoorsAmong(order, root) {
    const set = /* @__PURE__ */ new Set([root, ...order]);
    let n = 0;
    for (const door of ship.doors) {
      if (door.a === door.b || !set.has(door.a) || !set.has(door.b)) continue;
      if (parentDoor(ship, door.a)?.id === door.id || parentDoor(ship, door.b)?.id === door.id) continue;
      n++;
    }
    return n;
  }
  function fits(room) {
    let out3;
    for (const { room: far } of ship.neighbours(room)) {
      if (far.id === room) continue;
      const at = cells.get(far.id);
      if (at === void 0) continue;
      const ring = around(at).filter(free);
      out3 = out3 === void 0 ? ring : out3.filter((c) => ring.some((d) => d.q === c.q && d.r === c.r));
      if (out3.length === 0) return out3;
    }
    return (out3 ?? []).sort((a, b) => breathing(b) - breathing(a));
  }
  function parentOf(room) {
    const door = parentDoor(ship, room);
    return door.a === room ? door.b : door.a;
  }
  function breadthFirst(root) {
    const out3 = [];
    const queue = [root];
    while (queue.length > 0) {
      const room = queue.shift();
      for (const child of childrenOf(ship, room)) {
        if (cells.has(child) || out3.includes(child)) continue;
        out3.push(child);
        queue.push(child);
      }
    }
    return out3;
  }
  function tightestFirst(root) {
    const out3 = [];
    const seen = /* @__PURE__ */ new Set([root]);
    const reach2 = /* @__PURE__ */ new Set();
    for (const { room: far } of ship.neighbours(root)) if (far.id !== root) reach2.add(far.id);
    while (reach2.size > 0) {
      let best;
      let bestAt = -1;
      for (const id of reach2) {
        let n = 0;
        for (const { room: far } of ship.neighbours(id)) if (seen.has(far.id)) n++;
        const room = ship.roomAt(id);
        const pick2 = best === void 0 || n > bestAt || n === bestAt && (room.depth < ship.roomAt(best).depth || room.depth === ship.roomAt(best).depth && id < best);
        if (pick2) {
          best = id;
          bestAt = n;
        }
      }
      const next = best;
      reach2.delete(next);
      seen.add(next);
      out3.push(next);
      for (const { room: far } of ship.neighbours(next)) {
        if (!seen.has(far.id) && !cells.has(far.id)) reach2.add(far.id);
      }
    }
    return out3;
  }
}
function hexFit(stored, allowed) {
  const rooms = [...stored.keys()].sort((a, b) => a - b);
  const root = rooms[0];
  if (root === void 0) return void 0;
  if (rooms.length > allowed.size) return void 0;
  const mask = [...allowed].map(parseKey).sort(westward);
  const middle = centreOf(mask);
  const turned = ISOMETRIES.map((turn) => new Map(rooms.map((id) => [id, turn(stored.get(id))])));
  let best;
  for (const target of mask) {
    for (const cells2 of turned) {
      const origin = cells2.get(root);
      const dq2 = target.q - origin.q;
      const dr2 = target.r - origin.r;
      let fits = true;
      let sx = 0;
      let sy = 0;
      for (const cell2 of cells2.values()) {
        const at = { q: cell2.q + dq2, r: cell2.r + dr2 };
        if (!allowed.has(key(at))) {
          fits = false;
          break;
        }
        sx += 2 * at.q + at.r;
        sy += at.r;
      }
      if (!fits) continue;
      const off = Math.hypot(sx / rooms.length - middle.x, (sy / rooms.length - middle.y) * 3 / 2);
      if (best === void 0 || off < best.off - 1e-9) best = { cells: cells2, dq: dq2, dr: dr2, off };
    }
  }
  if (best === void 0) return void 0;
  const { cells, dq, dr } = best;
  return new Map(rooms.map((id) => {
    const cell2 = cells.get(id);
    return [id, { q: cell2.q + dq, r: cell2.r + dr }];
  }));
}
function centreOf(cells) {
  let x = 0;
  let y = 0;
  for (const cell2 of cells) {
    x += 2 * cell2.q + cell2.r;
    y += cell2.r;
  }
  return { x: x / cells.length, y: y / cells.length };
}
var ISOMETRIES = (() => {
  const turn = (c) => ({ q: -c.r, r: c.q + c.r });
  const flip = (c) => ({ q: c.q + c.r, r: -c.r });
  const out2 = [];
  for (const flipped of [false, true]) {
    for (let k = 0; k < 6; k++) {
      out2.push((c) => {
        let at = flipped ? flip(c) : c;
        for (let i = 0; i < k; i++) at = turn(at);
        return at;
      });
    }
  }
  return out2;
})();
function hexThickness(cells) {
  const list = [...cells];
  if (list.length === 0) return 0;
  let best = Infinity;
  for (const turn of ISOMETRIES) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const cell2 of list) {
      const r = turn(cell2).r;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    best = Math.min(best, hi - lo + 1);
  }
  return best;
}
function distance(a, b) {
  if ("q" in b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }
  return Math.hypot((2 * a.q + a.r - b.x) / 2, (a.r - b.y) * 3 / 4);
}
function westward(a, b) {
  return 2 * a.q + a.r - (2 * b.q + b.r) || a.r - b.r;
}
function parseKey(k) {
  const [q, r] = k.split(",").map(Number);
  return { q: q ?? 0, r: r ?? 0 };
}
function childrenOf(ship, room) {
  const out2 = [];
  for (const { door, room: far } of ship.neighbours(room)) {
    if (far.id === room) continue;
    const parent = parentDoor(ship, far.id);
    if (parent?.id === door.id) out2.push({ id: far.id, door });
  }
  return out2.sort((a, b) => a.door.id - b.door.id).map((x) => x.id);
}
function latticeCells(ship) {
  const out2 = /* @__PURE__ */ new Map();
  const taken = /* @__PURE__ */ new Set();
  for (const room of ship.rooms) {
    const cell2 = hexOf(room);
    if (cell2 === void 0 || taken.has(hexKey(cell2))) return void 0;
    taken.add(hexKey(cell2));
    out2.set(room.id, cell2);
  }
  return out2.size === ship.rooms.length ? out2 : void 0;
}
function judge(ship, cells) {
  const corridors = /* @__PURE__ */ new Set();
  const links = /* @__PURE__ */ new Set();
  for (const door of ship.doors) {
    if (door.a === door.b) continue;
    const a = cells.get(door.a);
    const b = cells.get(door.b);
    if (a && b && hexAdjacent(a, b)) corridors.add(door.id);
    else links.add(door.id);
  }
  return { cells, corridors, links, offLattice: [], masked: false };
}

// ../../../smoreg_works/packages/engine/src/rooms/gen/shipgen.ts
var MAX_SHIP_ATTEMPTS = 14;
var LOOP_SHARE = [0.35, 0.5];
var LATTICE_LOOPS = [0.62, 0.82];
var MAX_CHILDREN = 2;
var COMPACT_CAP = 3;
var MAX_DEGREE = 4;
var NO_CARD_STATE = { flags: /* @__PURE__ */ new Set(), shipIndex: 0 };
function buildShip(spec2, rng, ctx = NO_CARD_STATE) {
  let leastBad;
  for (let attempt = 0; attempt < MAX_SHIP_ATTEMPTS; attempt++) {
    const built = assemble(spec2, rng.fork(attempt), ctx);
    const problems = validateShip(built.ship, spec2);
    const candidate = { ...built, attempts: attempt + 1, problems };
    if (problems.length === 0) return candidate;
    if (!leastBad || problems.length < leastBad.problems.length) leastBad = candidate;
  }
  return leastBad;
}
function cardEligible(card2, ctx, kind) {
  if (card2.kinds && !card2.kinds.includes(kind)) return false;
  if (card2.when && !card2.when(ctx)) return false;
  return true;
}
function cardWeight(card2, ctx) {
  const base = card2.weight ?? 1;
  const mult = card2.weightWhen ? card2.weightWhen(ctx) : 1;
  return Math.max(0, base * mult);
}
function assemble(spec2, rng, ctx) {
  const b = start(spec2, rng, ctx);
  if (spec2.lattice === true) {
    growLattice(b);
  } else {
    growTree(b);
    addLoops(b);
  }
  const ship = shipOf(b);
  layoutShip(ship);
  setDoorStates(b, ship);
  placeKeys(b, ship);
  placeCards(b, ship);
  return { ship, flagsSet: b.flagsSet, keys: b.keys, cards: b.cards };
}
function start(spec2, rng, ctx) {
  const entry = spec2.kinds.find((k) => k.kind === spec2.entryKind) ?? {
    kind: spec2.entryKind,
    name: spec2.entryKind.toUpperCase()
  };
  const b = {
    spec: spec2,
    rng,
    ctx,
    rooms: [makeRoom(0, entry, 0)],
    // The airlock is a loop on the entry: nothing in the engine needs a node
    // for "outside", and every walk over the graph ignores a self-edge.
    doors: [{ id: 0, label: "a1", a: 0, b: 0, state: "airlock" }],
    target: rng.int(spec2.rooms[0], spec2.rooms[1]),
    deg: [1],
    children: [0],
    fresh: new Set(spec2.kinds.filter((k) => !k.required && k.kind !== spec2.entryKind).map((k) => k.kind)),
    owed: spec2.kinds.filter((k) => k.required && k.kind !== spec2.entryKind),
    keys: [],
    cards: [],
    flagsSet: []
  };
  return b;
}
function shipOf(b) {
  return new Ship(b.rooms, b.doors, 0);
}
function growTree(b) {
  for (let guard = 0; guard < 500; guard++) {
    const short = b.rooms.length < b.target;
    const owed = b.owed.length > 0 && b.rooms.length < b.spec.rooms[1];
    if (!short && !owed) return;
    if (!growOne(b, short)) return;
  }
}
function growOne(b, short) {
  const pool = b.rooms.filter((r) => canHost(b, r));
  const dig = !short || b.owed.some((k) => k.deep) && !pool.some((r) => r.depth + 1 >= DEEP_DEPTH);
  while (pool.length > 0) {
    const node = pickWeighted(pool, (r) => nodeWeight(b, r, dig), b.rng);
    if (!node) return false;
    const kind = pickKind(b, node.depth + 1, short);
    if (kind && attach(b, node, kind)) return true;
    pool.splice(pool.indexOf(node), 1);
  }
  return false;
}
function nodeWeight(b, r, dig) {
  if (dig) return r.depth + 1 >= DEEP_DEPTH ? 100 : r.depth + 1;
  return (MAX_CHILDREN + 1 - b.children[r.id]) * (b.spec.maxDepth - r.depth + 1);
}
function canHost(b, r) {
  return b.children[r.id] < MAX_CHILDREN && b.deg[r.id] < MAX_DEGREE && r.depth < b.spec.maxDepth && countAt(b, r.depth + 1) < MAX_COLUMN;
}
function countAt(b, depth) {
  let n = 0;
  for (const r of b.rooms) if (r.depth === depth) n++;
  return n;
}
function pickKind(b, depth, short) {
  const ready = b.owed.filter((k) => !k.deep || depth >= DEEP_DEPTH);
  const slots = Math.max(1, b.target - b.rooms.length);
  if (ready.length > 0 && (!short || b.owed.length >= slots || b.rng.chance(b.owed.length / slots))) {
    return pickWeighted(ready, (k) => k.weight ?? 1, b.rng);
  }
  let free = b.spec.kinds.filter((k) => b.fresh.has(k.kind));
  if (free.length === 0) {
    for (const k of b.spec.kinds) if (!k.required && k.kind !== b.spec.entryKind) b.fresh.add(k.kind);
    free = b.spec.kinds.filter((k) => b.fresh.has(k.kind));
  }
  const here3 = free.filter((k) => !k.deep || depth >= DEEP_DEPTH);
  return pickWeighted(here3, (k) => k.weight ?? 1, b.rng);
}
function attach(b, node, kind) {
  const room = makeRoom(b.rooms.length, kind, node.depth + 1);
  b.rooms.push(room);
  b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: node.id, b: room.id, state: "open" });
  b.deg.push(1);
  b.children.push(0);
  const trial = shipOf(b);
  layoutShip(trial);
  if (layoutFaults(trial).length > 0) {
    b.rooms.pop();
    b.doors.pop();
    b.deg.pop();
    b.children.pop();
    layoutShip(shipOf(b));
    return false;
  }
  b.deg[node.id]++;
  b.children[node.id]++;
  b.fresh.delete(kind.kind);
  b.owed = b.owed.filter((k) => k.kind !== kind.kind);
  return true;
}
function growLattice(b) {
  const cells = /* @__PURE__ */ new Map();
  const taken = /* @__PURE__ */ new Map();
  const home = { q: 0, r: 0 };
  cells.set(0, home);
  taken.set(hexKey(home), 0);
  b.rooms[0].data[HEX_KEY] = home;
  for (let guard = 0; guard < 500; guard++) {
    const short = b.rooms.length < b.target;
    const owed = b.owed.length > 0 && b.rooms.length < b.spec.rooms[1];
    if (!short && !owed) break;
    if (!growCell(b, cells, taken, short)) break;
  }
  joinNeighbours(b, cells, taken);
}
function growCell(b, cells, taken, short) {
  const spots = frontier(b, cells, taken);
  if (spots.length === 0) return false;
  const spot = pickWeighted(spots, (s) => s.weight, b.rng);
  if (!spot) return false;
  const parent = b.rooms[spot.parent];
  const kind = pickKind(b, parent.depth + 1, short);
  if (!kind) return false;
  const room = makeRoom(b.rooms.length, kind, parent.depth + 1);
  room.data[HEX_KEY] = spot.cell;
  b.rooms.push(room);
  b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: parent.id, b: room.id, state: "open" });
  b.deg.push(1);
  b.children.push(0);
  const trial = shipOf(b);
  layoutShip(trial);
  if (layoutFaults(trial).length > 0) {
    b.rooms.pop();
    b.doors.pop();
    b.deg.pop();
    b.children.pop();
    layoutShip(shipOf(b));
    return false;
  }
  cells.set(room.id, spot.cell);
  taken.set(hexKey(spot.cell), room.id);
  b.deg[parent.id]++;
  b.children[parent.id]++;
  b.fresh.delete(kind.kind);
  b.owed = b.owed.filter((k) => k.kind !== kind.kind);
  return true;
}
function frontier(b, cells, taken) {
  const out2 = /* @__PURE__ */ new Map();
  for (const [id, cell2] of cells) {
    const host = b.rooms[id];
    if (b.children[id] >= MAX_CHILDREN || b.deg[id] >= MAX_DEGREE) continue;
    if (host.depth >= b.spec.maxDepth) continue;
    if (countAt(b, host.depth + 1) >= MAX_COLUMN) continue;
    for (const next of hexAround(cell2)) {
      const at = hexKey(next);
      if (taken.has(at)) continue;
      const filled = hexAround(next).filter((c) => taken.has(hexKey(c))).length;
      const weight = (1 + Math.min(filled, COMPACT_CAP)) * (MAX_CHILDREN + 1 - b.children[id]);
      const seen = out2.get(at);
      if (seen === void 0 || weight > seen.weight) out2.set(at, { cell: next, parent: id, weight });
    }
  }
  return [...out2.values()];
}
function joinNeighbours(b, cells, taken) {
  const tree = b.doors.length - 1;
  const wanted2 = Math.round(tree * (LATTICE_LOOPS[0] + b.rng.next() * (LATTICE_LOOPS[1] - LATTICE_LOOPS[0])));
  if (wanted2 <= 0) return;
  const joined2 = new Set(b.doors.map((d) => pairKey(d.a, d.b)));
  const pairs = [];
  for (const [id, cell2] of cells) {
    for (const next of hexAround(cell2)) {
      const far = taken.get(hexKey(next));
      if (far === void 0 || far <= id) continue;
      if (joined2.has(pairKey(id, far))) continue;
      pairs.push([id, far]);
    }
  }
  b.rng.shuffle(pairs);
  let added = 0;
  for (const [u, v] of pairs) {
    if (added >= wanted2) break;
    if (b.deg[u] >= MAX_DEGREE || b.deg[v] >= MAX_DEGREE) continue;
    b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: u, b: v, state: "open" });
    const depths = deepen(b);
    const trial = shipOf(b);
    layoutShip(trial);
    if (layoutFaults(trial).length > 0) {
      b.doors.pop();
      restore(b, depths);
      continue;
    }
    b.deg[u]++;
    b.deg[v]++;
    added++;
  }
  deepen(b);
  layoutShip(shipOf(b));
}
function deepen(b) {
  const was = b.rooms.map((r) => r.depth);
  const reach2 = b.rooms.map(() => Infinity);
  reach2[0] = 0;
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const here3 = queue[head];
    for (const door of b.doors) {
      if (door.a === door.b) continue;
      const far = door.a === here3 ? door.b : door.b === here3 ? door.a : void 0;
      if (far === void 0 || reach2[far] <= reach2[here3] + 1) continue;
      reach2[far] = reach2[here3] + 1;
      queue.push(far);
    }
  }
  for (const room of b.rooms) {
    const at = reach2[room.id];
    if (Number.isFinite(at)) room.depth = at;
  }
  return was;
}
function restore(b, depths) {
  for (const room of b.rooms) room.depth = depths[room.id] ?? room.depth;
}
function addLoops(b) {
  const tree = b.doors.length - 1;
  const wanted2 = Math.round(tree * (LOOP_SHARE[0] + b.rng.next() * (LOOP_SHARE[1] - LOOP_SHARE[0])));
  if (wanted2 <= 0) return;
  const joined2 = new Set(b.doors.map((d) => pairKey(d.a, d.b)));
  const pairs = [];
  for (const u of b.rooms) {
    for (const v of b.rooms) {
      if (v.id <= u.id) continue;
      if (Math.abs(u.depth - v.depth) > 1) continue;
      if (joined2.has(pairKey(u.id, v.id))) continue;
      pairs.push(u.depth <= v.depth ? [u, v] : [v, u]);
    }
  }
  b.rng.shuffle(pairs);
  let added = 0;
  for (const [u, v] of pairs) {
    if (added >= wanted2) break;
    if (b.deg[u.id] >= MAX_DEGREE || b.deg[v.id] >= MAX_DEGREE) continue;
    b.doors.push({ id: b.doors.length, label: `d${b.doors.length}`, a: u.id, b: v.id, state: "open" });
    const trial = shipOf(b);
    layoutShip(trial);
    if (layoutFaults(trial).length > 0) {
      b.doors.pop();
      continue;
    }
    b.deg[u.id]++;
    b.deg[v.id]++;
    added++;
  }
}
function setDoorStates(b, ship) {
  const tree = treeDoors(ship);
  for (const d of b.doors) {
    if (d.state === "airlock") continue;
    d.state = rollDoor(b, tree.has(d.id));
  }
}
function rollDoor(b, onTree) {
  const table = {};
  for (const [state, weight] of Object.entries(b.spec.doors)) {
    if (weight <= 0) continue;
    if (state === "locked" && !onTree) continue;
    if (state === "sealed" && onTree) continue;
    table[state] = weight;
  }
  if (Object.keys(table).length === 0) return "closed";
  return b.rng.weighted(table);
}
function placeKeys(b, ship) {
  const locked = ship.doors.filter((d) => d.state === "locked").sort((x, y) => doorDepth(ship, x) - doorDepth(ship, y) || x.id - y.id);
  for (const door of locked) {
    if (!keyFor2(b, ship, door)) door.state = "closed";
  }
}
function keyFor2(b, ship, door) {
  const id = `k${b.keys.length + 1}`;
  door.key = id;
  const candidates = [...reachableWithKeys(ship).rooms].sort((x, y) => x - y);
  if (candidates.length === 0) {
    delete door.key;
    return false;
  }
  const room = ship.roomAt(b.rng.pick(candidates));
  room.marks.push(`${KEY_MARK}${id}`);
  b.keys.push({ id, room: room.id });
  return true;
}
function placeCards(b, ship) {
  const library = b.spec.cards ?? [];
  if (library.length === 0) return;
  const per = b.spec.cardsPerRoom ?? 1;
  const used = /* @__PURE__ */ new Map();
  for (const room of ship.rooms) {
    const here3 = /* @__PURE__ */ new Set();
    for (let i = 0; i < per; i++) {
      const table = {};
      for (const card3 of library) {
        if (here3.has(card3.name)) continue;
        if ((used.get(card3.name) ?? 0) >= (card3.maxPerShip ?? Infinity)) continue;
        if (!cardEligible(card3, b.ctx, room.kind)) continue;
        const weight = cardWeight(card3, b.ctx);
        if (weight > 0) table[card3.name] = weight;
      }
      if (Object.keys(table).length === 0) break;
      const name = b.rng.weighted(table);
      const card2 = library.find((c) => c.name === name);
      here3.add(name);
      used.set(name, (used.get(name) ?? 0) + 1);
      room.marks.push(...card2.marks);
      for (const flag of card2.sets ?? []) {
        if (!b.flagsSet.includes(flag)) b.flagsSet.push(flag);
      }
      b.cards.push({ card: card2, room: room.id });
      if (card2.marks.includes(LOCK_ENTRY)) lockEntry(b, ship, room.id);
    }
  }
}
function lockEntry(b, ship, room) {
  const door = parentDoor(ship, room);
  if (!door || door.state !== "open" && door.state !== "closed") return;
  const was = door.state;
  door.state = "locked";
  if (!keyFor2(b, ship, door)) door.state = was;
}
function doorDepth(ship, d) {
  return Math.max(ship.roomAt(d.a).depth, ship.roomAt(d.b).depth);
}
function pairKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}
function makeRoom(id, kind, depth) {
  return {
    id,
    label: `r${id + 1}`,
    kind: kind.kind,
    name: kind.name,
    depth,
    col: depth,
    row: 0,
    cover: kind.cover === true,
    hazard: "none",
    explored: false,
    scanned: false,
    marks: [],
    data: {}
  };
}
function pickWeighted(items, weight, rng) {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return void 0;
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

// ../../../smoreg_works/games/salvor/src/content/i18n/en.ts
var EN = {
  // ----------------------------------------------------------- compartments
  // The generator stamps the entry compartment `DOCKING`, not the catalogue
  // name, and the design doc's mock-up reads `go d1  DOCKING   open`.
  "room.docking": "DOCKING",
  "room.cargo": "CARGO BAY",
  "room.corridor": "CORRIDOR RING",
  "room.storage": "STORAGE",
  "room.maintenance": "MAINTENANCE",
  "room.hab": "HAB BLOCK",
  "room.mess": "MESS",
  "room.hydroponics": "HYDROPONICS",
  "room.med": "MED BAY",
  "room.lab": "LAB",
  "room.quarantine": "QUARANTINE",
  "room.engineering": "ENGINEERING",
  "room.workshop": "WORKSHOP",
  "room.armory": "ARMORY",
  "room.reactor": "REACTOR",
  "room.control": "CONTROL",
  "room.coreaccess": "CORE ACCESS",
  "room.lifesupport": "LIFE SUPPORT",
  "room.cryo": "CRYO",
  "room.sensors": "SENSOR BAY",
  "room.brig": "BRIG",
  "room.escapepods": "ESCAPE PODS",
  // The tug's own four, which are stations as well as compartments.
  "room.dock": "DOCK",
  "room.hold": "HOLD",
  "room.bench": "BENCH",
  "room.helm": "HELM",
  // ---------------------------------------------------------------- the rack
  "module.cutter": "CUTTER",
  "module.thrusters": "THRUSTERS",
  "module.scanner": "SCANNER",
  "module.plating": "PLATING",
  "module.cell": "CELL",
  "module.emp": "EMP",
  "module.welder": "WELDER",
  "module.laser": "LASER",
  "module.spike": "SPIKE",
  "module.emitter": "EMITTER",
  "module.baffle": "BAFFLE",
  "module.blade": "Q-BLADE",
  "module.shocker": "SHOCKER",
  "module.lattice": "LATTICE",
  // How a module is named inside a sentence, rather than shouted on the panel.
  "noun.cutter": "cutter",
  "noun.thrusters": "thrusters",
  "noun.scanner": "scanner",
  "noun.plating": "plating",
  "noun.cell": "power cell",
  "noun.emp": "EMP",
  "noun.welder": "welder",
  "noun.laser": "laser",
  "noun.spike": "spike",
  "noun.emitter": "emitter",
  "noun.baffle": "baffle",
  "noun.blade": "quantum blade",
  "noun.shocker": "shocker",
  "noun.lattice": "lattice plating",
  // Said once, the turn a module burns out. Each names what is now impossible.
  "burn.cutter": "Your CUTTER burns out. You are down to ramming.",
  "burn.thrusters": "Your THRUSTERS burn out. You crawl on manipulators.",
  "burn.scanner": "Your SCANNER burns out. The ship goes dark beyond this door.",
  "burn.plating": "Your PLATING burns out. Nothing stands between the next hit and your core.",
  "burn.cell": "Your CELL burns out. Bulkheads will have to be cut.",
  "burn.emp": "Your EMP burns out. The charge dies in the coil.",
  "burn.welder": "Your WELDER burns out. No more field repairs.",
  "burn.laser": "Your LASER burns out. The lens goes cloudy and dead.",
  "burn.spike": "Your SPIKE burns out. What is locked stays locked.",
  "burn.emitter": "Your EMITTER burns out. Everything is in reach again, the hard way.",
  "burn.baffle": "Your BAFFLE burns out. The ship can hear you again.",
  "burn.blade": "Your Q-BLADE burns out. The edge folds back into nothing; there was only ever one.",
  "burn.shocker": "Your SHOCKER burns out. The coil cracks, and nothing like it is for sale.",
  "burn.lattice": "Your LATTICE burns out. The one armour that turned a blow is gone for good.",
  // ------------------------------------------------------------- the machines
  "machine.maintenance-bot": "maintenance bot",
  "machine.feral-drone": "feral drone",
  "machine.scout": "scout",
  "machine.security-unit": "security unit",
  "machine.welder-bot": "welder bot",
  "machine.hauler": "hauler",
  "machine.scrapper": "scrapper",
  "machine.arc-sentinel": "arc sentinel",
  "machine.sentry-turret": "sentry turret",
  "machine.jammer": "jammer",
  "machine.crawler": "crawler",
  "machine.bloom": "bloom",
  "machine.enforcer": "enforcer",
  "machine.ghost": "ghost",
  "machine.rival-drone": "rival drone",
  // ---------------------------------------------------------------- the hulls
  "hull.scrapper": "SCRAPPER",
  "hull.spark": "SPARK",
  "hull.ghost": "GHOST",
  "trait.scrapper": "6 slots, core 3",
  "trait.spark": "7 slots, core 4, THR 120",
  "trait.ghost": "8 slots, core 5, THR 140",
  // ------------------------------------------------------------- the derelicts
  "derelict.freighter": "freighter",
  "derelict.barge": "barge",
  "derelict.ferry": "ferry",
  "derelict.probe": "probe",
  "derelict.tender": "tender",
  "derelict.laboratory": "laboratory",
  "derelict.military": "military",
  "derelict.smuggler": "smuggler",
  "derelict.corsair": "corsair",
  "derelict.quarantine": "quarantine",
  "derelict.fathers-tug": "father's tug",
  // Never drawn into an itinerary: the hull a training run opens on instead of
  // the freighter (`content/tutorial.ts`).
  "derelict.tutorial": "training hull",
  "derelict.flavour": "{callsign} \xB7 {hull} \xB7 {first} \xB7 {second}",
  "flavour.tutorial.0": "yard tender",
  "flavour.tutorial.1": "banked reactor",
  "flavour.tutorial.2": "tug drive",
  "flavour.tutorial.3": "shakedown run",
  "flavour.tutorial.4": "no crew aboard",
  "flavour.freighter.0": "bulk hauler",
  "flavour.freighter.1": "fission reactor",
  "flavour.freighter.2": "ion drive",
  "flavour.freighter.3": "ore run",
  "flavour.freighter.4": "long haul",
  "flavour.barge.0": "ore barge",
  "flavour.barge.1": "banked reactor",
  "flavour.barge.2": "tug drive",
  "flavour.barge.3": "belt run",
  "flavour.barge.4": "cut loose under tow",
  "flavour.ferry.0": "passenger ferry",
  "flavour.ferry.1": "banked reactor",
  "flavour.ferry.2": "shuttle drive",
  "flavour.ferry.3": "orbital hop",
  "flavour.ferry.4": "two hundred aboard",
  "flavour.probe.0": "survey probe",
  "flavour.probe.1": "cell stack",
  "flavour.probe.2": "drift drive",
  "flavour.probe.3": "far picket",
  "flavour.probe.4": "silent for a decade",
  "flavour.tender.0": "repair tender",
  "flavour.tender.1": "yard reactor",
  "flavour.tender.2": "yard drive",
  "flavour.tender.3": "refit contract",
  "flavour.tender.4": "left under refit",
  "flavour.laboratory.0": "research hull",
  "flavour.laboratory.1": "isotope reactor",
  "flavour.laboratory.2": "survey drive",
  "flavour.laboratory.3": "deep survey",
  "flavour.laboratory.4": "no manifest",
  "flavour.military.0": "patrol cutter",
  "flavour.military.1": "shielded reactor",
  "flavour.military.2": "military drive",
  "flavour.military.3": "border patrol",
  "flavour.military.4": "lost with all hands",
  "flavour.smuggler.0": "fast hauler",
  "flavour.smuggler.1": "stripped reactor",
  "flavour.smuggler.2": "smuggler's drive",
  "flavour.smuggler.3": "no registry",
  "flavour.smuggler.4": "three false holds",
  "flavour.corsair.0": "raider",
  "flavour.corsair.1": "overdriven reactor",
  "flavour.corsair.2": "boarding drive",
  "flavour.corsair.3": "taken by boarders",
  "flavour.corsair.4": "prize crew aboard",
  "flavour.quarantine.0": "medical transport",
  "flavour.quarantine.1": "shielded reactor",
  "flavour.quarantine.2": "long-haul drive",
  "flavour.quarantine.3": "sealed from inside",
  "flavour.quarantine.4": "no distress call",
  "flavour.fathers-tug.0": "salvage tug",
  "flavour.fathers-tug.1": "fission reactor",
  "flavour.fathers-tug.2": "ion drive",
  "flavour.fathers-tug.3": "your father's callsign",
  "flavour.fathers-tug.4": "missing eleven years",
  // --------------------------------------------------- the ship's own systems
  "system.engine": "ENGINE",
  "system.core": "REACTOR",
  "system.terminal": "TERMINAL",
  "system.short.engine": "engine",
  "system.short.core": "reac",
  "system.short.terminal": "term",
  "thing.system.engine": "the engine",
  "thing.system.core": "the reactor",
  "thing.system.terminal": "the terminal",
  "log.system.online.engine": "ENGINE ONLINE. The ship notices.",
  "log.system.online.core": "REACTOR ONLINE. The ship notices.",
  "log.system.online.terminal": "TERMINAL ONLINE. The ship notices.",
  // ------------------------------------------------------------- the charters
  "charter.name.salvage": "SALVAGE",
  "charter.name.retrieve": "RETRIEVE",
  "charter.name.upload": "UPLOAD",
  "charter.name.neutralize": "NEUTRALIZE",
  "charter.salvage": "SALVAGE \xB7 bring home {need} CR of salvage",
  "charter.retrieve": "RETRIEVE \xB7 carry out the marked crate from the {room}",
  "charter.upload": "UPLOAD \xB7 five turns at the console in the {room}",
  "charter.neutralize": "NEUTRALIZE \xB7 engine, reactor and terminal online, then leave",
  // ----------------------------------------------- door verbs and door states
  "verb.go": "go",
  "verb.leave": "leave",
  "verb.key": "key",
  "verb.power": "power",
  "verb.spike": "spike",
  "verb.cut": "cut",
  "verb.weld": "weld",
  "verb.close": "close",
  // The head of a locked door's line: not a way through it but the choice
  // between the ways, which is a list of its own one level down.
  "verb.open": "open",
  // What each way through a lock costs, beside its own word in that list:
  // turns and noise, the two numbers the choice turns on.
  "cost.key": "1 turn, silent",
  "cost.power": "1 turn, noise 6",
  "cost.spike": "2 turns, noise 4",
  "cost.cut": "3 turns, noise 9",
  "state.open": "open",
  "state.closed": "closed",
  "state.locked": "locked",
  "state.sealed": "sealed",
  "state.broken": "broken",
  "state.airlock": "airlock",
  "state.out": "out",
  // ------------------------------------------------------------- small words
  "label.you": "You",
  "label.other": "the {name}",
  "label.something": "Something",
  "word.a": "a {name}",
  "word.or": "{first} or {last}",
  "word.bulkhead": "{door} bulkhead",
  "word.cr": "{n} CR",
  "word.crate": "crate",
  "word.scrap": "scrap",
  "word.vented": "no atmosphere",
  "word.derelict": "derelict",
  "word.keycard": "keycard",
  "word.module": "module",
  "word.system": "system",
  "word.theVoyage": "the voyage",
  "word.tug": "TUG",
  // What auto-explore stops for, by the noun it stops on.
  "thing.partsCrate": "a parts crate",
  "thing.scrap": "scrap",
  "thing.body.searched": "a searched body",
  "thing.system": "a ship system",
  "thing.body": "a crew body",
  "thing.cargo": "a cargo crate",
  "thing.contraband": "a contraband crate",
  "thing.console": "a console",
  "thing.package": "a charter package",
  // ------------------------------------------------------------------- the log
  "log.opening": "The tug is tied to something dark, and the rack has one drone left on it.",
  "log.win": "The airlock closes behind you. The tug pulls away with what you took.",
  "log.death": "Core breach. The drone goes dark. The ship keeps what it takes.",
  "log.hit.module": "{source} hits your {module} ({left}/{max}).",
  "log.hit.vent": "The vacuum hits your {module} ({left}/{max}).",
  "log.hit.mine": "The mine hits your {module} ({left}/{max}).",
  "log.machine.dies": "{target} dies.",
  "log.scrap.drop": "The {machine} collapses into scrap: {module}.",
  "log.door.key": "The keycard reader blinks green. {door} slides open.",
  "log.door.power": "You dump the CELL into {door}. The lock lets go.",
  "log.door.cut.on": "You cut at {door}. {left} more {left, one: turn, other: turns} of it.",
  "log.door.cut.done": "{door} gives way with a shriek.",
  "log.door.weld.on": "You run the welder down the seam of {door}.",
  "log.door.weld.done": "{door} is welded shut. It stays that way.",
  "log.door.close": "You pull {door} shut.",
  "log.spike.on": "You work the {spike} into the {target}.",
  "log.spike.done": "The {target} gives. You are through.",
  "log.body.plain": "You go through the body: {cr} CR.",
  "log.body.key": "You go through the body: {cr} CR and a keycard.",
  "log.crate.open": "You break the {crate} open: {cr} CR into the hold.",
  "log.cargo.take": "You lever the marked crate out of its rack.",
  "log.upload.on": "The console gives it up slowly. {left} more {left, one: turn, other: turns} of it.",
  "log.upload.done": "The upload completes. Whatever it was, the tug has it.",
  "log.console.away": "You step away from the console. It starts over.",
  "log.work.break.cut": "You break off the cut.",
  "log.work.break.weld": "You break off the weld.",
  "log.work.break.splice": "You break off the splice.",
  "log.work.break.purge": "You break off the purge.",
  "log.carry.take": "{module} {left}/{max} taken. Carrying {n} of {limit}.",
  "log.carry.home": "{n} carried home, into the hold.",
  "log.salvage.graft": "You graft the {module} on. It is better than new ({left}/{max}).",
  "log.salvage.mend": "You work the scrap into your {module} ({left}/{max}).",
  "log.salvage.install": "You pull a {module} ({left}/{max}) from the wreck.",
  "log.weld": "You weld the {module} back to {left}/{max}.",
  "log.pulse": "Sensor pulse. Two doors of ship come back on the schematic.",
  "log.emp": "The coil discharges. {n, one: One machine seizes, other: # machines seize} up. {left} left.",
  "log.shock": "The {module} arcs. {n, one: One machine seizes, other: # machines seize} up. {left} left.",
  "log.swap.carried": "{module} in, {old} out and into your arms.",
  "log.swap.dropped": "{module} in. Arms full: the {old} lies here.",
  "log.relic.take": "A relic: {module}. No bench mends it, no dock sells it.",
  "log.relic.seen": "The pulse reads a sealed crate in {room}. Something stands over it.",
  "log.emitter.hit": "Your {emitter} hits {target} for {n} ({hp}/{max}).",
  "log.system.work": "You work the {tool} into the {system}. {left} more {left, one: turn, other: turns} of it.",
  "log.system.advance": "The charter pays on account:",
  "log.system.all": "All three online. Press `<` to leave through the airlock \u2014 the hull is yours.",
  "log.system.all.paid": "All three online. Press `<` to leave through the airlock \u2014 the hull is yours: +{cr} CR.",
  "log.alert.hunter": "An {hunter} wakes up in {room}.",
  "log.alert.busy": "The ship has been busy: {n} more machines aboard.",
  "log.alert.calm": "The ship stops looking for you.",
  "log.alert.up": "Alert: {stage}.",
  "log.alert.wake": "Something wakes up in {room}.",
  "log.alert.door": "The ship shuts {door} behind you.",
  "log.alert.lock": "The ship locks {door} behind you.",
  "log.alert.scuttle": "SCUTTLE: in {n} turns the ship starts venting its own compartments.",
  "log.alert.vent": "The ship vents {room}. Everything in it is gone.",
  "log.alert.vacuum": "No air in {room}: the vacuum takes {n} off your core.",
  "log.alert.down": "The ship stands down. Neutralised, it stops answering.",
  "alert.noticed": "NOTICED",
  "alert.searching": "SEARCHING",
  "alert.hunting": "HUNTING",
  "alert.hunter": "ENFORCER",
  "alert.scuttle": "SCUTTLE",
  "log.bloom.hatch": "The bloom splits. Something pulls itself out.",
  "log.bloom.strip": "You cut the bloom open: {cr} CR of biomass, and nothing to bolt on.",
  "log.bloom.dies": "The bloom sags open. Biomass, and no parts in it.",
  "log.ghost.sighted": "Something with your callsign is moving in there.",
  "log.ghost.drop": "The ghost comes apart. Your old rack is on the floor.",
  "log.rival.aboard": "A rival drone is aboard. It is not here for the salvage.",
  "log.rival.gone": "The rival breaks off and runs for its own lock.",
  "log.hull.taken": "{hull} is already on the other tug's line. Three systems for nothing.",
  "log.rival.lost": "Another tug has the ship. You have twenty turns.",
  "log.rival.jumped": "The rival's tug jumps with the ship. Your drone goes with it.",
  "log.rival.system": "The rival brings the {system} online.",
  "log.rival.drops": "The rival drops {article} {module}.",
  // The bargain (G34). Every row of it lives here, with the rest of what the
  // competitor says, rather than in the action and panel blocks it would
  // otherwise be filed under: three lines, two refusals and a gauge are one
  // mechanic, and a translator reading down this file should meet them at once.
  "action.rival.payoff": "pay off RIVAL ({price} CR)",
  "action.rival.aside": "leave: RIVAL pays {price} CR",
  "action.rival.split": "give RIVAL half the sale",
  "why.rival.spent": "It has nothing left to bring up.",
  "why.rival.notHere": "The rival is not in this compartment.",
  "why.rival.dealt": "The deal on this hull is already struck.",
  "log.rival.deal.paid": "The rival takes the credits and goes. Its haul stays.",
  "log.rival.deal.sold": "The rival pays for the run of the ship:",
  "log.rival.deal.split": "You shake on half the hull. It works with you now.",
  "log.rival.raises": "The rival brings the {system} online for you.",
  "panel.deal": "DEAL  {deal}",
  "word.deal.paid": "paid off",
  "word.deal.sold": "stood aside",
  "word.deal.split": "split",
  "log.virus.caught": "The scrap carries something. {virus} in your {module}.",
  "log.virus.rot": "{virus} eats into your {module}: {left} left.",
  "log.virus.rot.burned": "{virus} finishes your {module}. The module is gone.",
  "log.virus.skim": "{virus} takes {amount} CR off the account.",
  "log.virus.skim.empty": "{virus} goes through the account. Nothing to take.",
  "log.virus.core": "{virus} reaches the core. {left} left.",
  "log.virus.twitch": "Your {module} twitches. {virus} picked where the blow lands.",
  "log.virus.moves": "The virus leaves your {from} for your {to}.",
  "log.virus.purge.on": "You run the welder over your {module}.",
  "log.virus.purge.done": "The purge takes. Your {module} is clean.",
  "log.virus.burned": "The virus goes with the burned module.",
  "log.helm.board": "The board at the HELM: {flavour}.",
  "log.charter.signed": "Signed: {charter}.",
  "log.charter.filled": "{charter} filled:",
  // Said at the airlock for every signed job that did not pay, and why: a
  // charter that fails in silence reads as one that was never checked.
  "log.charter.missed.salvage": "{charter} not filled: {have} of {need} CR of salvage.",
  "log.charter.missed.retrieve": "{charter} not filled: the crate is still aboard.",
  "log.charter.missed.upload": "{charter} not filled: the upload at the console never finished.",
  "log.credit": "{why} +{amount} CR. {total} CR.",
  "log.hull.bought": "A {hull} comes off the rack: {trait}. {credits} CR left.",
  "log.hull.tow": "The {hull} goes under tow:",
  "log.hull.tow.split": "The {hull} goes under tow, the sale split:",
  "log.hold.emptied": "The hold is emptied:",
  "log.hold.sell": "Sold for good \u2014 {module}:",
  "log.hold.sell.sick": "Sold for good \u2014 infected {module}:",
  "log.hold.fit": "You bolt the {module} ({integrity}) into slot {slot}.",
  "log.bench.repair": "The bench takes your {module} back to {left}/{max}.",
  "log.bench.graft": "The bench grafts your {module} up to {left}/{max}.",
  "log.bench.clean": "The bench burns the virus out of your {module}.",
  "log.jump": "The tug burns for the {hull}. {credits} CR left.",
  "log.jump.warn": "{hull}: {up} of {of} systems online. A jump leaves the hull behind.",
  "log.jump.left": "Left behind: {charters}.",
  "log.voyage.undock": "The clamps let go.",
  "log.voyage.home": "The airlock cycles. The tug is waiting, and the derelict is still breathing.",
  "log.voyage.won": "The tug answers on your father's callsign. You take it home. You win.",
  "log.voyage.broke": "The rack is empty and so is the account. Voyage over.",
  "log.drone.lost": "The drone stops answering. Whatever it was carrying is aboard the derelict now.",
  // -------------------------------------------------------------- the hints
  "hint.exposure": "Hits land on whatever you last used.",
  "hint.burned": "A burned module is gone. Its slot is empty now.",
  "hint.scrap": "Scrap. Take it apart for a module, or graft it onto one you have.",
  "hint.blind": "Without a scanner you see only this room. Find one.",
  "hint.keycard": "A keycard. Doors marked [ ] read it.",
  "hint.death": "Your drone is still in there. It will not be friendly.",
  "hint.objective": "One of the ship's three systems. Raise all three, get out alive, and the tug sells the hull.",
  "hint.payout": "Nothing is paid until the drone is back through the airlock. Die out here and the hold too.",
  "hint.mouse": "The mouse works too: click a numbered line, or a compartment on the schematic.",
  "hint.sold": "Hold sold for {credits} CR. Hulls cost {hullPrice}.",
  "hint.shooting": "Shooting exposes what you shot with: the answer lands on the EMITTER, the frailest module.",
  "hint.sell": "Sold for good: nobody sells modules back. To keep one, stow it in the hold instead.",
  "hint.training": "TRAINING. The first hull of this voyage is built to be learned on. Seven lines, one a turn.",
  "hint.tutorial.enter": "TRAINING HULL. Small and quiet: nothing aboard ends a run. All the drone can do is the list.",
  "hint.tutorial.scan": "Press s for a SCANNER pulse: it reads the compartments behind the doors before you enter.",
  "hint.tutorial.contact": "A machine. Attacking it is a numbered action, and so is walking away: nothing follows you.",
  "hint.tutorial.door": "A locked bulkhead. Its keycard is on a body this side: search the dead, or cut the door open.",
  "hint.tutorial.system": "Raising a system takes several turns and makes noise. Whatever is still aboard hears it.",
  "hint.tutorial.airlock": "The airlock. Stepping out banks what the drone carries and leaves the ship as it stands.",
  "hint.tutorial.sale": "That is the lesson. The next hull is not one: jump when the account can pay for a drone.",
  "hint.virus": "Salvage can carry the ship's virus. Every hull has its own. A welder cleans any of them.",
  "strain.spasm": "SPASM",
  "strain.rot": "ROT",
  "strain.leech": "LEECH",
  "strain.leash": "LEASH",
  // ----------------------------------------------------------- the refusals
  "why.credits": "Not enough credits.",
  "why.line.none": "Nothing on that line.",
  "why.notHere": "Not from here.",
  "why.jammed": "Static. Nothing responds.",
  "why.door.notHere": "There is no such door in this compartment.",
  "why.door.notLocked": "{door} is not locked.",
  "why.door.noLock": "{door} has no lock to pick.",
  "why.door.noCut": "{door} does not need cutting.",
  "why.door.noWeld": "{door} cannot be welded.",
  "why.door.notOpen": "{door} is not open.",
  "why.door.noKeycard": "No keycard on the drone.",
  "why.door.noKeycardHere": "No lock here a keycard would open.",
  "why.door.wallsIn": "Welding {door} would seal the drone in here.",
  "why.door.notBehind": "The drone did not walk in through a bulkhead.",
  "why.door.noneHere": "Nothing to do with the bulkheads here.",
  "why.door.state": "The {door} door is {state}.",
  "why.room.noRoute": "No route to {room}.",
  "why.module.missing": "No {module} in the rack.",
  "why.module.notInstalled": "No {module} installed.",
  "why.module.passive": "That module has no active use.",
  "why.module.whole": "The {module} is whole.",
  "why.module.grafted": "The {module} takes no more grafting.",
  "why.module.clean": "The {module} is clean.",
  "why.rig.emptySlot": "Empty slot.",
  "why.slot.empty": "Nothing in that slot.",
  "why.rack.full": "No free slot. Sell something first.",
  "why.rack.burnFirst": "No free slot. Something has to burn first.",
  "why.graft.full": "Nothing left to graft.",
  "why.repair.none": "Nothing to repair.",
  "why.breach.nothing": "Nothing to breach here.",
  "why.shoot.none": "Nothing in the line of fire.",
  "why.emp.spent": "{emp} is spent.",
  "why.emp.none": "Nothing in range.",
  "why.relic.have": "You already carry a {module}.",
  "why.relic.pick": "Full rack. Choose what it replaces.",
  "why.relic.noRepair": "{module} is a relic. Nothing mends it.",
  "why.swap.free": "There is a free slot: salvage it instead.",
  "why.salvage.noRig": "Nothing to take apart.",
  "why.carry.full": "The drone can carry {n} and no more.",
  "why.salvage.none": "There is nothing to take apart here.",
  "why.biomass.none": "There is no biomass here.",
  "why.body.none": "There is nobody to search here.",
  "why.body.searched": "You have been through that one already.",
  "why.cargo.none": "There is nothing to load here.",
  "why.cargo.carrying": "You are already carrying it.",
  "why.console.none": "There is no console here.",
  "why.console.done": "That console has already given up what it had.",
  "why.system.none": "There is nothing here to bring online.",
  "why.system.up": "The {system} is already online.",
  "why.system.needs": "Needs {tools}.",
  "why.virus.none": "Nothing in the rack is infected.",
  "why.virus.clean": "That module is clean.",
  "why.tug.only": "That is a job for the tug, not for out here.",
  "why.hull.none": "No such hull on the rack.",
  "why.hold.noDrone": "There is no drone to fit it to.",
  "why.hold.none": "Nothing in the hold under that number.",
  "why.charter.none": "Nothing on the board under that number.",
  "why.charter.late": "Charter board closed: the {hull} is already open.",
  "why.undock.aboard": "You are already aboard.",
  "why.undock.noDrone": "There is no drone on the rails.",
  "why.undock.sold": "The {hull} is under tow. Jump to the next hull.",
  "why.undock.tow": "The {hull} is under tow.",
  "why.jump.aboard": "The tug jumps; the drone cannot.",
  "why.jump.last": "There is nothing further out. This is the last hull of the voyage.",
  "why.jump.first": "The {price} CR jump comes first.",
  // ------------------------------------------------ the numbered action list
  "action.attack": "attack {target} {hp}/{max}",
  "action.shoot": "shoot {target}",
  "action.carry": "take {module} {left}/{max}",
  "action.salvage": "salvage {module} {left}/{max}",
  "action.swap": "{module} for {old}",
  "action.swapMenu": "{module} for \u2026 \u25B8",
  "action.discharge": "discharge {module} ({n})",
  "action.hide": "hide",
  "action.search": "search crew body",
  "action.strip": "strip biomass ({cr} CR)",
  "action.purge": "purge {module} (welder, {left} {left, one: turn, other: turns})",
  "action.work": "work {system}: {tool} {left}",
  "action.workBare": "work {system} ({left})",
  "action.take": "take {crate} ({cr} CR)",
  "action.takeMarked": "take the marked crate",
  "action.upload": "upload ({left} {left, one: turn, other: turns})",
  "action.buy": "buy {hull} {price} CR",
  "action.undock": "cast off \u2192 {hull}",
  "action.undock.todo": "cast off {left}",
  "undock.left.damaged": "{n} dmg",
  "undock.left.charter": "no job",
  // The same debt when it is the only one: then the row has room to say what
  // casting off does to the board.
  "undock.left.board": "\u2014 board closes",
  "action.repair": "{module} {price} CR",
  "action.clean": "clean {module} ({price} CR)",
  "action.graft": "{module} +1 base  {price} CR",
  "action.order": "buy {module} {price} CR",
  "action.fit": "{module} {integrity}/{max}",
  "action.sell": "{module} {left}/{max}  {price} CR",
  "action.charter": "take {charter} ({price})",
  "action.jump": "jump \u2192 {hull} {price} CR",
  // The jump row when it leaves systems raised behind: what is dropped, and
  // what the hull would have sold for. The group heading already says "jump".
  "action.jump.drop": "drop {up}/{of}, sale {cr} CR",
  // The last line of a door's own list, and the only place on it the door is
  // named: one level down there is no heading to carry `d3`.
  "action.back": "back ({door})",
  // The last line of the door list (`m`). No door is named on it: none is
  // chosen yet, and the compartment is one keystroke behind it.
  "action.backRoom": "back",
  // The travel list: how far, in doors, and the compartment nothing reaches.
  "dist.doors": "{n, one: # door, other: # doors}",
  "dist.none": "no way",
  "crate.cargo": "cargo crate",
  "crate.contraband": "contraband crate",
  // ----------------------------------------------------------- what `o` says
  "stop.over": "The run is over.",
  "stop.machine": "You see {machine} in {room}.",
  "stop.hit": "Something is hitting you.",
  "stop.alert": "Alert rising.",
  "stop.thing": "Something here: {thing}.",
  "stop.explored": "{hull} explored. {back}",
  "stop.airlock.none": "There is no way back to the airlock.",
  "stop.airlock.here": "You are standing at the airlock.",
  "stop.airlock.away": "The airlock is {n} {n, one: door, other: doors} back.",
  "stop.noTarget": "No target in sight.",
  "stop.noWay": "No way through.",
  "stop.arrived": "You reach {room}.",
  "stop.shut": "The way on is shut: {door} ({state}).",
  "stop.shut.ways": "The way on is shut: {door} ({state}) \u2014 {ways}; aboard: {have}.",
  "stop.shut.none": "The way on is shut: {door} ({state}) \u2014 {ways}; nothing aboard opens it.",
  // ------------------------------------------------------------- the panel
  "panel.turn": "turn {n}",
  "panel.sortie": "sortie {n}",
  "panel.actions": "ACTIONS",
  "panel.more": "\u2026 {n} more",
  "panel.more.arrows": "\u2026 {n} more (\u2191\u2193)",
  "panel.room": "{room} {label}",
  "panel.doorTo": "{door} \u2192 {room}",
  "panel.roomDoors": "{room} {label}  doors {doors}",
  "panel.doorMore": "\u2026 {n} more {n, one: door, other: doors}",
  "panel.roomMore": "\u2026 {n} more here",
  "panel.letter.move": "m move",
  "panel.letter.brace": ". brace",
  "panel.letter.hide": "h hide",
  "panel.letter.doors": "d doors",
  "panel.letter.leave": "< leave",
  "panel.letters.tug": "0 back  ? help",
  "panel.letters": "o explore  Tab fight  ? help",
  "panel.nextHit": "NEXT HIT LANDS ON",
  "panel.core": "CORE  {dots}",
  "panel.slot.empty": "-- empty --",
  "panel.slot.burned": "-- burned --",
  "panel.keys": "KEYS  {n}",
  "panel.alert": "ALERT {gauge}",
  "panel.alertStage": "ALERT {gauge} {stage}",
  "panel.alertScuttle": "ALERT {gauge} SCUTTLE IN {n}",
  "panel.alertOff": "ALERT {gauge} OFF",
  "panel.hunter": "ENFORCER still aboard",
  "panel.rival": "RIVAL {gauge}",
  "panel.evac": "EVAC {n}",
  "panel.goal": "GOAL  NEUTRALIZE  {cr} CR",
  "panel.goal.bare": "GOAL  3 SYSTEMS, OUT ALIVE",
  "panel.goal.done": "ALL THREE ONLINE  +{cr} CR",
  "panel.goal.out": "< out through the airlock",
  "panel.goal.noTool": "NOTHING ABOARD RAISES IT",
  "panel.goal.towed": "HULL TAKEN  under tow",
  "panel.goal.work": "{mark} {system} {tool}, {left, one: # turn, other: # turns}",
  "panel.charters": "CHARTERS",
  "panel.charter.plain": "{mark} {name}",
  "panel.charter.where": "{mark} {name} \xB7 {room}",
  "panel.charter.loot": "{mark} {name} {have}/{need} CR",
  "panel.virus": "{virus} in {module}",
  "panel.credits": "CREDITS {n}",
  "panel.hold": "CARRYING  {n} CR",
  "panel.droneLost": "NO DRONE ON THE RAILS",
  "panel.cheapest": "CHEAPEST HULL {n}",
  "panel.derelict": "DERELICT {hull}",
  "panel.tow": "under tow",
  "panel.quiet": "quiet",
  "panel.alertAt": "alert {n}",
  "panel.hullState": "{alert} \xB7 {up}/{of} up",
  "ship.rooms": "{n} rooms",
  "ship.seen": "{n} seen",
  "ship.scanned": "{n} scanned",
  "schematic.hidden": "\xBB {n} {n, one: room, other: rooms}",
  "schematic.behind": "\xAB {n} {n, one: room, other: rooms}",
  // Added with the tug-clarity pass (G40).
  "why.rack.hullFull": "The rack is full.",
  "action.hull.onRack": "{hull} \u2014 on the rack",
  "panel.contact.hit": "burns {module}",
  // The contacts block, made unmissable (G47). The bar is drawn to the panel's
  // full width around whichever of the two labels applies, so both are short by
  // obligation: what is left of the row after the label is the rule.
  "panel.contacts.here": "ENEMY IN HERE: {n}",
  "panel.contacts.near": "THROUGH THE DOOR: {n}",
  "panel.contactsMore": "\u2026 {n} more in sight",
  "danger.melee": "melee",
  "danger.door": "shoots",
  "danger.jam": "jams",
  "danger.noScrap": "no scrap",
  "danger.hunter": "hunter",
  "danger.still": "sits",
  "log.contacts.here": "In here: {list}.",
  "log.contacts.one": "{machine} {hp}, {danger}",
  "panel.head.tug": "SALVOR  tug",
  "panel.head.tugTo": "SALVOR  tug \u2192 {hull}",
  "help.where.tug.head": "WHERE YOU ARE \u2014 your own tug",
  "help.where.tug.1": "One screen, no walking: buy a drone, mend it, stow",
  "help.where.tug.2": "or sell what you will not fly, charter, cast off.",
  "help.where.ship.head": "WHERE YOU ARE \u2014 inside a derelict",
  "help.where.ship.1": "Take what pays, raise the ship's systems, then out",
  "help.where.ship.2": "through the airlock: the hold is money only once home.",
  "help.name.pick": "PICK",
  "help.key.pick": "up/down  enter does the marked line",
  "help.name.move": "MOVE",
  "help.name.doors": "DOORS",
  "help.name.seal": "SEAL",
  "ship.yourTug": "your tug",
  "ship.dockedTo": "docked to {hull}",
  "banner.ahead": "DERELICT ahead: {hull} \xB7 {rooms}",
  "banner.tug": "YOUR TUG \xAB{callsign}\xBB \xB7 docked to {hull}",
  "banner.derelict": "DERELICT {parts}",
  "word.unknownHull": "unknown hull",
  "log.opening.tug": "Your tug. All of it is on the list: drone, repairs, charters, cast off. Press ? any time.",
  "log.opening.voyage": "{callsign}. {hulls} hulls out; the last one is your father's tug.",
  // ---------------------------------------------------------- title and help
  "title.name": "SALVOR",
  "title.tagline": "A turn-based roguelike. Every hit burns the module you just used.",
  "title.menu.head": "MENU",
  "title.menu.voyage": "New voyage",
  "title.menu.voyage.at": "a fresh derelict",
  "title.menu.training": "Training run",
  "title.menu.training.at": "the hull that teaches, step by step",
  "title.menu.help": "Help",
  "title.menu.help.at": "keys, rules, what a charter is",
  "title.menu.seed": "Seed",
  "title.menu.lang": "Language",
  "title.menu.view": "View",
  "title.menu.sound": "Sound",
  "title.sound.on": "on",
  "title.sound.off": "off",
  "title.view.ascii": "ASCII",
  "title.view.web": "panels",
  "title.view.hex": "honeycomb",
  "title.view.judges": "The jam's judges expect ASCII: that is what a fresh session opens in.",
  "title.seed.empty": "type digits",
  "title.seed.typing": "digits then Enter \xB7 nothing then Enter draws at random \xB7 Esc cancels",
  "title.start": "1 or space casts off",
  "title.keys.head": "CONTROLS ABOARD",
  "title.keys.1": "?  help      m  walk      o  explore      Tab  fight",
  "title.keys.2": "i  what is this      V  view      Enter  do the lit line",
  "title.foot": "roguetemple's Fortnight 2 \xB7 smoreg \xB7 build {version}",
  "help.page.more": "{n}/{of}   ? next page   esc closes",
  "help.page.last": "{n}/{of}   ? closes   esc closes",
  "help.title": "CONTROLS",
  "help.name.act": "ACT",
  "help.name.brace": "BRACE",
  "help.name.hide": "HIDE",
  "help.name.explore": "EXPLORE",
  "help.name.engage": "ENGAGE",
  "help.name.keycard": "KEYCARD",
  "help.name.log": "LOG",
  "help.name.help": "HELP",
  "help.key.act": "1-9 0  a line of the list",
  "help.key.brace": ". or space   (braces: PLATING)",
  "help.key.hide": "h   where the compartment has cover",
  "help.key.move": "m   where to walk \xB7 <   out, or towards it",
  "help.key.doors": "d   the bulkheads here: shut, weld, open",
  "help.key.seal": "shift+D   weld the door you came through",
  "help.key.explore": "o   walk on; stops on anything new",
  "help.key.engage": "tab / shift+tab  shoot, or melee only",
  "help.key.scanner": "s   pulse: two doors out, loud",
  "help.key.emp": "e   stun this compartment, 2 charges",
  "help.key.welder": "w   mend the weakest module",
  "help.key.cell": "p   power a locked door or console",
  "help.key.spike": "K   breach a lock, two turns, quiet",
  "help.key.emitter": "f   shoot into the line of fire",
  "help.key.cutter": "c   cut a door, three turns, loud",
  "help.key.keycard": "a   spend a card on a lock, silent",
  "help.key.log": "PgUp   the last 200 lines; PgDn back",
  "help.key.help": "?   VIEW V  LANG L  NEW shift+R  CLOSE esc",
  // ------------------------------------ what is going on here (G72)
  "codex.label.wrong": "Wrong:",
  "codex.label.helps": "Helps:",
  "codex.label.turn": "Turn it:",
  "codex.fitted": "(fitted)",
  "codex.badge": "[i] {n}",
  "codex.footer.more": "{n}/{of}   arrows turn the page   esc closes",
  "codex.footer.last": "{n}/{of}   esc closes",
  "codex.spasm.title": "SPASM VIRUS",
  "codex.spasm.what": "It sits in one of your modules. Every eight turns that slot twitches and is exposed, whatever you did with it.",
  "codex.spasm.wrong": "Trusting the routing on the beat: the twitch decides where the next blow lands, not your command.",
  "codex.spasm.helps": "Two turns of welding purge it; the bench at home cleans one for 4 CR.",
  "codex.spasm.lore": "The crew logged it as a maintenance fault twice, and then stopped logging.",
  "codex.rot.title": "ROT VIRUS",
  "codex.rot.what": "A strain that eats the module it lives in, a point of integrity every five turns, and never moves.",
  "codex.rot.wrong": "Letting it sit on your best module. Rot does not care what it is chewing.",
  "codex.rot.helps": "Purge it before it burns the slot out.",
  "codex.rot.turn": "A module that burns takes the rot with it: an expensive cure, but a cure.",
  "codex.rot.lore": "Yard crews called it the slow fire and painted over it.",
  "codex.leech.title": "LEECH VIRUS",
  "codex.leech.what": "A strain that reads the account instead of the rack: five credits gone every twelve turns.",
  "codex.leech.wrong": "Taking your time. This is the one thing aboard that charges you for turns.",
  "codex.leech.helps": "Purge it, or finish quickly and clean it at the bench.",
  "codex.leech.lore": "A ledger still balancing itself long after the smuggler who kept it.",
  "codex.leash.title": "LEASH VIRUS",
  "codex.leash.what": "A strain that goes for the drone itself: a point of core every eighteen turns, and core is never mended.",
  "codex.leash.wrong": "Finishing the sortie first. Three beats is the whole drone.",
  "codex.leash.helps": "Drop what you are doing and purge it: two turns of welding.",
  "codex.leash.lore": "Corsairs wrote it to take drones whole rather than in pieces.",
  "codex.alert-1.title": "ALARM 1: NOTICED",
  "codex.alert-1.what": "The ship has heard something. Nothing is coming yet, and the gauge climbs on noise and on time.",
  "codex.alert-1.wrong": "Fighting where you did not have to. A fight is heard the length of the hull.",
  "codex.alert-1.helps": "Quiet talks it down: fifteen still turns in the open, eight in cover.",
  "codex.alert-1.lore": "Dead ships keep listening long after the crew has stopped answering.",
  "codex.alert-2.title": "ALARM 2: SEARCHING",
  "codex.alert-2.what": "The ship posts a machine where you have already walked. It waits there; it is not hunting yet.",
  "codex.alert-2.wrong": "Walking back the way you came without looking first.",
  "codex.alert-2.helps": "A pulse reads two compartments out before you step into one.",
  "codex.alert-2.lore": "It is not looking for you. It is standing where something moved.",
  "codex.alert-3.title": "ALARM 3: HUNTING",
  "codex.alert-3.what": "A machine is sent to the compartment you are in, and from here the ship shuts one bulkhead behind you every ten turns.",
  "codex.alert-3.wrong": "Working deeper in while the way out is being closed.",
  "codex.alert-3.helps": "Weld the door behind you and whatever follows arrives at a wall.",
  "codex.alert-3.turn": "Every bulkhead the ship shuts is a wall for its own machines too.",
  "codex.alert-3.lore": "The doors still answer to a crew that is not aboard.",
  "codex.alert-4.title": "ALARM 4: ENFORCER",
  "codex.alert-4.what": "The ship sends its ENFORCER. It comes looking, cuts through what you welded shut, and finds you in cover.",
  "codex.alert-4.wrong": "Trading shots in a doorway. It shoots back at one compartment.",
  "codex.alert-4.helps": "Blade or cutter end it fastest; a stun buys the two turns you need to be elsewhere.",
  "codex.alert-4.turn": "Raising a system puts two on the gauge, so the hunter is the price of neutralising the ship.",
  "codex.alert-4.lore": "One was left awake on every hull that carried anything worth waking for.",
  "codex.alert-5.title": "ALARM 5: SCUTTLE",
  "codex.alert-5.what": "The top of the gauge. Bulkheads lock rather than close, and after fifteen turns the ship vents a compartment every twelve.",
  "codex.alert-5.wrong": "One more room. The countdown on the panel is the whole warning there is.",
  "codex.alert-5.helps": "Leave. Bringing all three systems up switches the gauge off for good.",
  "codex.alert-5.turn": "Casting off drops the gauge two levels: the ship is calmer when you come back.",
  "codex.alert-5.lore": "Scuttling was a captain's last order. Nobody told the ship the captain had gone.",
  "codex.vented.title": "VENTED COMPARTMENT",
  "codex.vented.what": "Vacuum. No cover, nothing left lying about, and a point off your exposed slot for every turn you stand in it.",
  "codex.vented.wrong": "Crossing it slowly, or choosing to fight in it.",
  "codex.vented.helps": "Cross in one move, with the cheapest module exposed.",
  "codex.vented.lore": "The ship is throwing its own air away to be rid of you.",
  "codex.blade.title": "Q-BLADE, a relic",
  "codex.blade.what": "Two dice where the cutter has one, and it opens a bulkhead exactly as a cutter does. Marked \u25AA in the rack: the bench neither mends it nor grafts onto it.",
  "codex.blade.wrong": "Passing it up for a better slot later. Nothing on any shelf replaces it.",
  "codex.blade.helps": "It counts as a cutter everywhere the rules ask for one.",
  "codex.blade.lore": "One of a run of nine, and the other eight are not coming back.",
  "codex.shocker.title": "SHOCKER, a relic",
  "codex.shocker.what": "Three charges, and each one is silence in this compartment for two turns, machines included. Marked \u25AA in the rack: the bench neither mends it nor grafts onto it.",
  "codex.shocker.wrong": "Saving all three for a fight you never have. Nothing recharges it.",
  "codex.shocker.helps": "It is fired from the numbered list rather than from a letter.",
  "codex.shocker.lore": "Built for boarding parties who wanted the cargo undamaged.",
  "codex.lattice.title": "LATTICE, a relic",
  "codex.lattice.what": "Thirty integrity, and the only flat point of armour anywhere in the game. Marked \u25AA in the rack: the bench neither mends it nor grafts onto it.",
  "codex.lattice.wrong": "Waiting for the bench to mend it. A relic is never repaired, here or at home.",
  "codex.lattice.helps": "It counts as plating everywhere the rules ask for it.",
  "codex.lattice.lore": "Woven rather than cast, and nobody left alive remembers how.",
  "codex.ghost.title": "GHOST",
  "codex.ghost.what": "What is left of a drone that died aboard. It wears the rack it was carrying and swings with the best of it.",
  "codex.ghost.wrong": "Going back for your own wreck without counting what was on it.",
  "codex.ghost.helps": "It never opens an airlock, so it never leaves this hull.",
  "codex.ghost.turn": "Kill it and everything it is wearing is on the deck again.",
  "codex.ghost.lore": "Tugs do not talk about this part of the trade.",
  "codex.rival.title": "RIVAL DRONE",
  "codex.rival.what": "Another tug's drone, working the same hull. It cuts doors and raises systems, and it never comes for you.",
  "codex.rival.wrong": "Leaving it alone. Whatever it brings online is money you do not get.",
  "codex.rival.helps": "Seven hit points and no interest in a fight: this one is yours to start.",
  "codex.rival.turn": "It carries what it has taken, and a wreck drops all of it.",
  "codex.rival.lore": "Somebody else's father had a tug too.",
  "codex.sentry-turret.title": "SENTRY TURRET",
  "codex.sentry-turret.what": "The ship's own defence. It never moves, and it shoots one compartment out through any door you left open.",
  "codex.sentry-turret.wrong": "Standing in the doorway to look at it.",
  "codex.sentry-turret.helps": "Shut the bulkhead, or take it in the room: five hit points, and an emitter in the wreck.",
  "codex.sentry-turret.lore": "Bolted down where the cargo was, and never moved since.",
  "codex.jammer.title": "JAMMER",
  "codex.jammer.what": "While it stands in your compartment nothing on the rack answers. It runs when it is hurt.",
  "codex.jammer.wrong": "Reaching for a module. Nothing can be spent while this thing is here.",
  "codex.jammer.helps": "A swing still lands, and walking out of the compartment works too.",
  "codex.jammer.lore": "Salvage crews called it the quiet man.",
  "codex.bloom.title": "BLOOM",
  "codex.bloom.what": "A hatchery. It never swings; every six turns it puts out another crawler, up to four alive at once.",
  "codex.bloom.wrong": "Fighting the brood in front of it instead of the thing making them.",
  "codex.bloom.helps": "Eight hit points, and it does not fight back.",
  "codex.bloom.turn": "Stripped, it is worth two credits: the only thing here that pays.",
  "codex.bloom.lore": "Something got into the hydroponics and liked it there.",
  "codex.crawler.title": "CRAWLER",
  "codex.crawler.what": "Corrosive, and the only machine aboard that leaves no module at all.",
  "codex.crawler.wrong": "Trading integrity for it. Plating is not in its chain and the wreck pays nothing.",
  "codex.crawler.helps": "Walk away. Three hit points if you have to.",
  "codex.crawler.lore": "Not a machine, whatever the manifest called it.",
  "codex.scout.title": "SCOUT",
  "codex.scout.what": "The one thing awake at the airlock. It looks a compartment ahead, and it sees you in cover.",
  "codex.scout.wrong": "Hiding. Cover is not cover from this one.",
  "codex.scout.helps": "Three hit points, and the wreck carries a scanner.",
  "codex.scout.lore": "It does not fight you. It tells the ship where you are.",
  "codex.enforcer.title": "ENFORCER",
  "codex.enforcer.what": "The ship's hunter. It goes where you were last seen or heard, and every hit lands on the weakest module on the rack.",
  "codex.enforcer.wrong": "Welding a door and waiting. It cuts a locked bulkhead open in three turns, and cover does not hide you from it.",
  "codex.enforcer.helps": "Ten hit points and an emitter in the wreck. Or be gone: it searches where it heard you, then gives up the chase.",
  "codex.enforcer.lore": "It has no name on the manifest. Crews knew it by the sound of a door.",
  "codex.security-unit.title": "SECURITY UNIT",
  "codex.security-unit.what": "The ship's guard. Eight hit points and no tricks: it sees a compartment ahead and walks straight at you.",
  "codex.security-unit.wrong": "Trading blows on a worn rack. Eight hit points is a long fight, and every blow it lands comes off a module.",
  "codex.security-unit.helps": "A cutter ends it fastest, and its wreck carries one. A welded door holds it.",
  "codex.security-unit.lore": "Standard issue on any hull whose cargo was worth insuring.",
  "codex.scrapper.title": "SCRAPPER",
  "codex.scrapper.what": "A deep-hull machine that hunts in company. Every hit lands on the weakest module on the rack, and it runs when badly hurt.",
  "codex.scrapper.wrong": "Flying in with a worn module on the rack. It skips everything else and goes for that one.",
  "codex.scrapper.helps": "Mend or stow the weak module before you cast off. Six hit points, and its wreck carries an EMP.",
  "codex.scrapper.lore": "It takes ships apart for the parts. A drone is parts too.",
  "codex.frost.title": "FROST",
  "codex.frost.what": "Ice on every surface. While you stand in it the THRUSTERS lose 20 speed, and every machine aboard gets extra turns on you.",
  "codex.frost.wrong": "Stopping in it: a fight, a salvage, a system brought up on the ice.",
  "codex.frost.helps": "Walk straight through. Or spend one point of the CELL to warm the compartment for the rest of the sortie.",
  "codex.frost.lore": "Life support failed here first. The crew's breath is still on the walls.",
  "codex.smoke.title": "SMOKE",
  "codex.smoke.what": "Smoke to the bulkheads. Nobody sees in or out: your SCANNER shows nothing past the door and no machine spots you through it.",
  "codex.smoke.wrong": "Counting on a shot. The EMITTER and the turret are both blind here.",
  "codex.smoke.helps": "Close in: a blade, a shocker or a cutter works as well as ever. And it is cover \u2014 hiding here costs nothing.",
  "codex.smoke.turn": "Lure a hunter in and it loses you at the door. The best hiding place on the ship.",
  "codex.smoke.lore": "Something burned in here for days. The ship never opened the vents.",
  "codex.mine.title": "MINE ON A DOOR",
  "codex.mine.what": "A charge on the bulkhead. The first one through takes the blast: for you, three points into the module the step exposed, and the alert climbs a rung.",
  "codex.mine.wrong": "Walking through it because it was the short way.",
  "codex.mine.helps": "Two turns with the WELDER lift it from either side. PLATING takes the blast if you must cross.",
  "codex.mine.turn": "It goes off under a machine as readily as under you. Let one through first.",
  "codex.mine.lore": "The crew set it against boarders. The boarders are gone; the mine is not.",
  // The `i` card gets its own row in the key table, and the help card ends
  // with the list of everything this voyage has shown.
  "help.codex.head": "WHAT IS GOING ON \u2014 met this voyage",
  "help.name.codex": "SITUATION",
  "help.key.codex": "i   what is going on here; badge counts new",
  "help.rule.head": "EXPOSED \u2014 the one rule",
  "help.rule.1": "A blow lands on the module you just used: the one",
  "help.rule.2": "marked \u25C0 in the rack. With nothing exposed it hits",
  "help.rule.3": "PLATING, then CORE. At 0 a module burns out for",
  "help.rule.4": "good, and the empty slot it leaves is the only",
  "help.rule.5": "place salvage fits.",
  "help.list.head": "ACTIONS \u2014 the list on the right",
  "help.list.1": "Everything you can do here is a numbered line.",
  "help.list.2": "A dim one you cannot press yet, and it says why.",
  "help.list.3": "A locked door opens its own list; 0 goes back.",
  "help.list.4": "Or click it: a line, or a box on the schematic.",
  "help.charter.head": "CHARTERS \u2014 what a sortie is for",
  "help.charter.1": "Signed aboard the tug, under CHARTERS, before you",
  "help.charter.2": "cast off; paid when the drone is home. SALVAGE",
  "help.charter.3": "wants credits carried home. NEUTRALIZE wants the",
  "help.charter.4": "engine, reactor and terminal \u2014 it sells the hull.",
  "help.url.head": "THE ADDRESS BAR \u2014 settings with no key",
  "help.url.seed": "?seed=N        play that ship again, exactly",
  "help.url.view": "?view=ascii    or web, or hex: the three screens",
  "help.url.sound": "?sound=off     no music, no sound",
  "help.url.training": "?training=1    cast off with the prompts on",
  "help.url.debug": "?debug=1       what the machines are thinking",
  "help.url.tiles": "?tiles=1       pictures instead of letters",
  "help.url.hull": "?hull=0        the honeycomb with no hull drawn",
  // ------------------------------------------------------- the endings, and
  "end.dead": "THE ACCOUNT IS EMPTY",
  "end.lost": "DRONE LOST",
  "end.won": "YOUR FATHER'S TUG IS YOURS",
  "end.sold": "SHIP SOLD",
  "end.dead.why": "No drone on the rails and nothing left to buy one with.",
  "end.won.why": "The last hull of the itinerary is under tow. The voyage is over.",
  "end.again": "shift+R for a new run",
  "end.go": "any key \u2014 the voyage goes on",
  "end.summary": "{cr} CR \xB7 {rooms} compartments \xB7 {turns} turns \xB7 {kills} machines scrapped \xB7 {burned} modules burned",
  // ------------------------------------------------------- the error screen
  "log.title": "MESSAGE LOG",
  "log.page": "{n}/{of}   PgUp back   PgDn forward   esc closes",
  "log.empty": "Nothing has happened yet.",
  "crash.title": "SOMETHING BROKE",
  "crash.seed": "seed {seed} \xB7 {voyage} \xB7 turn {turn}",
  "crash.sortie": "sortie {n}",
  "crash.hull": "hull {n}",
  "crash.hullOf": "hull {n}/{of}",
  "crash.report": "copy this URL and report it",
  "crash.unknown": "unknown error",
  // ------------------------------------------------ the tug as a menu (G53)
  // The five verbs the tug is read by. Groups, not compartments: DOCK, HOLD,
  // BENCH and HELM were the inside of the ship talking, and a player who has
  // never been aboard one cannot guess which of the four mends a module
  // (docs/tasks/G53-tug-is-a-menu.md, 1).
  "tug.group.repair": "REPAIR",
  "tug.group.rig": "RIG",
  "tug.group.voyage": "CHARTERS",
  "tug.group.jump": "NEXT HULL",
  // One verb, one line: the modules it could be aimed at are the list under it.
  "action.pick.buy": "buy a hull \u25B8",
  // What a plain row is called on the turn it has nothing to name.
  "action.dead.undock": "cast off",
  "action.dead.clean": "clean a module",
  "action.dead.jump": "jump to the next hull",
  "action.pick.repair": "repair a module \u25B8",
  "action.pick.graft": "graft a module \u25B8 {price} CR",
  "action.pick.stow": "stow a module \u25B8",
  "action.pick.fit": "hold & shelf \u25B8",
  "action.pick.sell": "sell for good \u25B8",
  "action.pick.charter": "take a charter \u25B8",
  // A line of one of those lists. The module's state is on it because that is
  // what the choice turns on, and it is the one thing the old per-slot lines
  // never said.
  "action.one.hull": "{hull}  {price} CR",
  "action.one.module": "{module} {left}/{max}",
  "action.one.modulePriced": "{module} {left}/{max}  {price} CR",
  "action.one.held": "{module} {integrity}",
  "action.one.charter": "{charter}  {price}",
  "action.stow": "{module} {left}/{max}",
  "log.stock.buy": "{module} bought for {price} CR. In the hold. {credits} CR left.",
  "log.hold.fitted": "{n} out of the hold, onto the rails.",
  "log.hold.stow": "The hold takes the {module} ({integrity}/{max}), whole.",
  "why.stock.noDrone": "Nothing on the rails to fit it to.",
  "why.stock.spare": "The drone already carries a {module}.",
  "why.stock.none": "The shelf has nothing left.",
  "why.hold.full": "The hold already holds {n}. Fit one back first.",
  "why.hold.shelf": "Nothing in the hold, nothing to take off the shelf.",
  "why.rig.whole": "Nothing in the rack is damaged.",
  "why.rig.grafted": "Nothing in the rack takes more grafting.",
  "why.rig.empty": "Nothing in the rack.",
  "why.rig.last": "The last module stays on the rails. A rack with nothing in it flies nowhere.",
  "why.rig.clean": "Nothing in the rack is infected.",
  "why.charter.gone": "Every charter on this board is signed.",
  "why.tug.noDrone": "No drone on the rails. Buy a hull first.",
  "why.tug.noWalk": "Nowhere to walk on the tug: it is all on the list.",
  // The board that stands where the schematic does while the drone is home.
  "board.derelict": "DERELICT {hull} \xB7 {alert}",
  "board.worth": "NEUTRALIZE {up}/{of} \u2014 the hull sells for {price} CR",
  "board.rack": "HULLS ON THE RACK",
  "board.hull": "{hull}  {price} CR  {trait}",
  "board.hull.yours": "{hull}  \u2190 on the rails",
  "board.sorties": "sorties {n} \xB7 drones lost {lost}",
  "board.mode": "No alert here, nothing to walk to. It is all on the list.",
  // --------------------------------------------------------------- the engine
  //
  // Lines `packages/engine` writes. It composes English of its own for a game
  // with no table, and these rows are what this one says instead — the wording
  // here is the engine's, word for word, except the airlock: the engine named a
  // command, and the player has a key (`ui/logline.ts`).
  //
  // `{Actor}` is the machine with a capital, `{actor}` without: which one a
  // sentence needs is the sentence's business.
  "engine.hit.you": "You hit {target} for {amount} ({hp}/{max}).",
  "engine.hit.taken": "{Actor} hits you for {amount}.",
  "engine.hit.other": "{Actor} hits {target} for {amount} ({hp}/{max}).",
  "engine.dies": "{Target} dies.",
  "engine.cover.you": "You slip into cover.",
  "engine.cover.other": "{Actor} slips into cover.",
  "engine.door.open": "The door {door} slides open.",
  "engine.door.breached": "{door} gives way with a shriek.",
  "engine.door.cut.you": "You cut at {door}.",
  "engine.door.cut.other": "{Actor} cuts at {door}.",
  "engine.fail.airlock": "That is the airlock. Press < to go back to the tug.",
  "engine.fail.attack.ally": "You will not strike an ally.",
  "engine.fail.attack.away": "{Target} is not in this compartment.",
  "engine.fail.attack.gone": "Nothing to attack there.",
  "engine.fail.attack.sight": "{Target} is not in the line of fire.",
  "engine.fail.cover": "There is nothing to hide behind here.",
  "engine.fail.door.elsewhere": "The {door} door is not in this compartment.",
  "engine.fail.door.gone": "There is no such door.",
  "engine.fail.door.shut": "The {door} door is {state}.",
  "engine.fail.door.size": "{Actor} cannot fit through {door}.",
  "engine.fail.leave.none": "There is no airlock here.",
  "engine.fail.leave.other": "Only the drone leaves the ship.",
  "engine.fail.nothing": "Nothing to do.",
  "engine.fail.over": "The run is over.",
  // ------------------------------------------------------- the schematic
  //
  // The mark on the box hanging off the airlock. Three columns is no room
  // for a word in three languages, so the tug is a glyph like `d3` is a
  // label, and this row is where the picture gets explained.
  "help.where.ship.3": "\u2302 at the left edge of the schematic is your tug.",
  // обзор
  "stop.tug": "This is your tug, not a derelict: nothing here to explore.",
  "stop.noFurther": "{hull}: no way further in, {n, one: # room, other: # rooms} left unexplored.",
  "stop.noFurther.tool": "{hull}: no way further in, {n, one: # room, other: # rooms} left \u2014 you need a {tool}.",
  // --------------------------------------------------------- the hazards
  //
  // The red line, said once a sortie from the compartment next door
  // (`systems/hazards.ts`). Every one ends in ` [i]`: the codex's hook, the
  // key that opens this hazard's own card (docs/tasks/G72-codex.md).
  "log.hazard.tell.frost": "DANGER: {room} beyond {door} is iced over. Engines lose speed in there. [i]",
  "log.hazard.tell.smoke": "DANGER: {room} beyond {door} is full of smoke. Nobody sees anybody in there. [i]",
  "log.hazard.tell.mine": "DANGER: {door} is mined. The first one through it takes the blast. [i]",
  // The word in the compartment block, next to the mark.
  "word.hazard.frost": "frost: engines slow here",
  "word.hazard.smoke": "smoke: no line of sight",
  "word.hazard.mine": "mine on {door}",
  "stop.hazard": "Stopped: {what}",
  "stop.hazard.again": "Stopped: {what} Press again to go in.",
  "why.auto.hazard": "Auto-engage does not walk into a known hazard: go round, or step in yourself.",
  "why.fight.hazard": "Nothing to shoot at: it is the vacuum hitting you, not a machine. Leave the compartment.",
  "log.hazard.mine.hit": "The mine on {door} goes off under you.",
  "log.hazard.mine.machine": "{machine} sets off the mine on {door}.",
  "log.hazard.heat": "{module} warms {room}: no ice for the rest of the sortie.",
  "why.hazard.noFrost": "No ice here to fight.",
  "why.hazard.heated": "{room} is already warm.",
  "verb.heat": "heat",
  "verb.defuse": "defuse",
  "cost.defuse": "2 turns, noise 5",
  "log.door.defuse.on": "You work the welder around the charge on {door}.",
  "log.door.defuse.done": "The mine on {door} is dead. Nothing under it now.",
  "why.door.noTrap": "{door} carries no mine.",
  "log.work.break.defuse": "You break off the defusing.",
  // G88 B: the panel's own lines.
  "panel.systems.lost": "not found:",
  "panel.letters.tugTop": "? help"
};

// ../../../smoreg_works/games/salvor/src/content/i18n/es.ts
var ES = {
  // ---------------------------------------------------------- compartimentos
  "room.docking": "D\xC1RSENA",
  "room.cargo": "BODEGA",
  "room.corridor": "PASILLO",
  "room.storage": "ALMAC\xC9N",
  "room.maintenance": "T\xC9CNICA",
  "room.hab": "LITERAS",
  "room.mess": "COMEDOR",
  "room.hydroponics": "CULTIVO",
  "room.med": "M\xC9DICA",
  "room.lab": "LAB",
  "room.quarantine": "AISLADO",
  "room.engineering": "MOTORES",
  "room.workshop": "TALLER",
  "room.armory": "ARMER\xCDA",
  "room.reactor": "REACTOR",
  "room.control": "PUENTE",
  "room.coreaccess": "SALA DE ENERG\xCDA",
  "room.lifesupport": "SOPORTE",
  "room.cryo": "CRIO",
  "room.sensors": "SENSOR",
  "room.brig": "PRISI\xD3N",
  "room.escapepods": "C\xC1PSULA",
  "room.dock": "DIQUE",
  "room.hold": "CALA",
  "room.bench": "MESA",
  "room.helm": "TIM\xD3N",
  // ------------------------------------------------------------- el bastidor
  "module.cutter": "CORTADOR",
  "module.thrusters": "IMPULSORES",
  "module.scanner": "ESC\xC1NER",
  "module.plating": "BLINDAJE",
  "module.cell": "CELDA",
  "module.emp": "PEM",
  "module.welder": "SOLDADOR",
  "module.laser": "L\xC1SER",
  "module.spike": "GANZ\xDAA",
  "module.emitter": "EMISOR",
  "module.baffle": "SORDINA",
  "module.blade": "Q-HOJA",
  "module.shocker": "ATURDIDOR",
  "module.lattice": "RET\xCDCULA",
  "noun.cutter": "cortador",
  "noun.thrusters": "impulsores",
  "noun.scanner": "esc\xE1ner",
  "noun.plating": "blindaje",
  "noun.cell": "celda de carga",
  "noun.emp": "PEM",
  "noun.welder": "soldador",
  "noun.laser": "l\xE1ser",
  "noun.spike": "ganz\xFAa",
  "noun.emitter": "emisor",
  "noun.baffle": "sordina",
  "noun.blade": "hoja cu\xE1ntica",
  "noun.shocker": "aturdidor",
  "noun.lattice": "blindaje reticular",
  "burn.cutter": "Tu CORTADOR se quema. S\xF3lo te queda embestir.",
  "burn.thrusters": "Tus IMPULSORES se queman. Avanzas a rastras.",
  "burn.scanner": "Tu ESC\xC1NER se quema. Tras esta puerta la nave se apaga.",
  "burn.plating": "Tu BLINDAJE se quema. Nada separa el pr\xF3ximo golpe de tu n\xFAcleo.",
  "burn.cell": "Tu CELDA se quema. Los mamparos habr\xE1 que cortarlos.",
  "burn.emp": "Tu PEM se quema. La carga muere en la bobina.",
  "burn.welder": "Tu SOLDADOR se quema. Se acabaron los arreglos a bordo.",
  "burn.laser": "Tu L\xC1SER se quema. La lente queda turbia y muerta.",
  "burn.spike": "Tu GANZ\xDAA se quema. Lo que est\xE1 trabado sigue trabado.",
  "burn.emitter": "Tu EMISOR se quema. Todo vuelve a estar a un paso, por las malas.",
  "burn.baffle": "Tu SORDINA se quema. La nave vuelve a o\xEDrte.",
  "burn.blade": "Tu Q-HOJA se quema. El filo se pliega en nada; s\xF3lo hubo una.",
  "burn.shocker": "Tu ATURDIDOR se quema. La bobina se raja, y nada igual est\xE1 en venta.",
  "burn.lattice": "Tu RET\xCDCULA se quema. El \xFAnico blindaje que desviaba golpes se ha ido para siempre.",
  // ------------------------------------------------------------- las máquinas
  "machine.maintenance-bot": "bot t\xE9cnico",
  "machine.feral-drone": "dron salvaje",
  "machine.scout": "explorador",
  "machine.security-unit": "guardia",
  "machine.welder-bot": "bot soldador",
  "machine.hauler": "remolcador",
  "machine.scrapper": "chatarrero",
  "machine.arc-sentinel": "centinela",
  "machine.sentry-turret": "torreta",
  "machine.jammer": "inhibidor",
  "machine.crawler": "reptador",
  "machine.bloom": "brote",
  "machine.enforcer": "ejecutor",
  "machine.ghost": "espectro",
  "machine.rival-drone": "dron rival",
  // --------------------------------------------------------------- los cascos
  "hull.scrapper": "CHATARRA",
  "hull.spark": "CHISPA",
  "hull.ghost": "ESPECTRO",
  "trait.scrapper": "6 huecos, n\xFAcleo 3",
  "trait.spark": "7 huecos, n\xFAcleo 4, IMP 120",
  "trait.ghost": "8 huecos, n\xFAcleo 5, IMP 140",
  // --------------------------------------------------------------- los pecios
  "derelict.freighter": "carguero",
  "derelict.barge": "barcaza",
  "derelict.ferry": "ferri",
  "derelict.probe": "sonda",
  "derelict.tender": "taller",
  "derelict.laboratory": "laboratorio",
  "derelict.military": "militar",
  "derelict.smuggler": "contrabando",
  "derelict.corsair": "corsario",
  "derelict.quarantine": "cuarentena",
  "derelict.fathers-tug": "nave paterna",
  "derelict.tutorial": "casco de entrenamiento",
  "derelict.flavour": "{callsign} \xB7 {hull} \xB7 {first} \xB7 {second}",
  "flavour.tutorial.0": "remolcador de astillero",
  "flavour.tutorial.1": "reactor apagado",
  "flavour.tutorial.2": "motor de remolque",
  "flavour.tutorial.3": "viaje de pruebas",
  "flavour.tutorial.4": "sin tripulaci\xF3n",
  "flavour.freighter.0": "carguero pesado",
  "flavour.freighter.1": "reactor de fisi\xF3n",
  "flavour.freighter.2": "motor i\xF3nico",
  "flavour.freighter.3": "ruta de mineral",
  "flavour.freighter.4": "trayecto largo",
  "flavour.barge.0": "barcaza de mineral",
  "flavour.barge.1": "reactor apagado",
  "flavour.barge.2": "motor de remolque",
  "flavour.barge.3": "ruta del cintur\xF3n",
  "flavour.barge.4": "soltada en remolque",
  "flavour.ferry.0": "ferri de pasaje",
  "flavour.ferry.1": "reactor apagado",
  "flavour.ferry.2": "motor de lanzadera",
  "flavour.ferry.3": "salto orbital",
  "flavour.ferry.4": "doscientos en el manifiesto",
  "flavour.probe.0": "sonda de reconocimiento",
  "flavour.probe.1": "pila de celdas",
  "flavour.probe.2": "motor de deriva",
  "flavour.probe.3": "piquete lejano",
  "flavour.probe.4": "callada una d\xE9cada",
  "flavour.tender.0": "nave taller",
  "flavour.tender.1": "reactor de astillero",
  "flavour.tender.2": "motor de astillero",
  "flavour.tender.3": "contrato de reforma",
  "flavour.tender.4": "abandonada en reforma",
  "flavour.laboratory.0": "casco de estudio",
  "flavour.laboratory.1": "reactor de is\xF3topos",
  "flavour.laboratory.2": "motor de sondeo",
  "flavour.laboratory.3": "sondeo profundo",
  "flavour.laboratory.4": "sin manifiesto",
  "flavour.military.0": "patrullera",
  "flavour.military.1": "reactor blindado",
  "flavour.military.2": "motor militar",
  "flavour.military.3": "patrulla de frontera",
  "flavour.military.4": "perdida con todos a bordo",
  "flavour.smuggler.0": "carguero r\xE1pido",
  "flavour.smuggler.1": "reactor desmontado",
  "flavour.smuggler.2": "motor de contrabando",
  "flavour.smuggler.3": "sin registro",
  "flavour.smuggler.4": "tres bodegas falsas",
  "flavour.corsair.0": "asaltante",
  "flavour.corsair.1": "reactor forzado",
  "flavour.corsair.2": "motor de abordaje",
  "flavour.corsair.3": "tomada al abordaje",
  "flavour.corsair.4": "tripulaci\xF3n de presa",
  "flavour.quarantine.0": "transporte m\xE9dico",
  "flavour.quarantine.1": "reactor blindado",
  "flavour.quarantine.2": "motor de largo alcance",
  "flavour.quarantine.3": "sellada por dentro",
  "flavour.quarantine.4": "sin se\xF1al de socorro",
  "flavour.fathers-tug.0": "remolcador de rescate",
  "flavour.fathers-tug.1": "reactor de fisi\xF3n",
  "flavour.fathers-tug.2": "motor i\xF3nico",
  "flavour.fathers-tug.3": "el indicativo de tu padre",
  "flavour.fathers-tug.4": "once a\xF1os desaparecido",
  // -------------------------------------------------- los sistemas de la nave
  "system.engine": "MOTOR",
  "system.core": "REACTOR",
  "system.terminal": "TERMINAL",
  "system.short.engine": "mot",
  "system.short.core": "reac",
  "system.short.terminal": "ter",
  "thing.system.engine": "el motor",
  "thing.system.core": "el reactor",
  "thing.system.terminal": "la terminal",
  "log.system.online.engine": "MOTOR EN L\xCDNEA. La nave se entera.",
  "log.system.online.core": "REACTOR EN L\xCDNEA. La nave se entera.",
  "log.system.online.terminal": "TERMINAL EN L\xCDNEA. La nave se entera.",
  // ------------------------------------------------------------ los contratos
  "charter.name.salvage": "RESCATE",
  "charter.name.retrieve": "ENTREGA",
  "charter.name.upload": "SUBIDA",
  "charter.name.neutralize": "NEUTRALIZAR",
  "charter.salvage": "RESCATE \xB7 trae a casa {need} CR de chatarra",
  "charter.retrieve": "ENTREGA \xB7 saca la caja marcada de {room}",
  "charter.upload": "SUBIDA \xB7 cinco turnos en la consola de {room}",
  "charter.neutralize": "NEUTRALIZAR \xB7 motor, reactor y terminal en l\xEDnea, y salir",
  // ------------------------------------------ verbos y estados de las puertas
  "verb.go": "ir",
  "verb.leave": "salir",
  "verb.key": "llave",
  "verb.power": "carga",
  "verb.spike": "ganz\xFAa",
  "verb.cut": "cortar",
  "verb.weld": "soldar",
  "verb.close": "cerrar",
  "verb.open": "abrir",
  "cost.key": "1 turno, silencio",
  "cost.power": "1 turno, ruido 6",
  "cost.spike": "2 turnos, ruido 4",
  "cost.cut": "3 turnos, ruido 9",
  "state.open": "abierta",
  "state.closed": "cerrada",
  "state.locked": "trabada",
  "state.sealed": "soldada",
  "state.broken": "rota",
  "state.airlock": "esclusa",
  "state.out": "fuera",
  // --------------------------------------------------------- palabras sueltas
  "label.you": "T\xFA",
  "label.other": "{name}",
  "label.something": "Algo",
  "word.a": "{name}",
  "word.or": "{first} o {last}",
  "word.bulkhead": "mamparo {door}",
  "word.cr": "{n} CR",
  "word.crate": "caja",
  "word.scrap": "chatarra",
  "word.vented": "sin atm\xF3sfera",
  "word.derelict": "pecio",
  "word.keycard": "llave",
  "word.module": "m\xF3dulo",
  "word.system": "sistema",
  "word.theVoyage": "el viaje",
  "word.tug": "REM",
  "thing.partsCrate": "una caja de piezas",
  "thing.scrap": "chatarra",
  "thing.body.searched": "un cuerpo registrado",
  "thing.system": "un sistema de la nave",
  "thing.body": "un cuerpo",
  "thing.cargo": "una caja de carga",
  "thing.contraband": "una caja de contrabando",
  "thing.console": "una consola",
  "thing.package": "un paquete de contrato",
  // --------------------------------------------------------------- el registro
  "log.opening": "El remolcador est\xE1 amarrado a algo oscuro, y en el bastidor queda un dron.",
  "log.win": "La esclusa se cierra a tu espalda. El remolcador se aleja con lo que sacaste.",
  "log.death": "Brecha en el n\xFAcleo. El dron se apaga. La nave se queda con lo que se lleva.",
  "log.hit.module": "{source}: impacto, {module} ({left}/{max}).",
  "log.hit.vent": "VAC\xCDO: impacto, {module} ({left}/{max}).",
  "log.hit.mine": "MINA: impacto, {module} ({left}/{max}).",
  "log.machine.dies": "{target} cae.",
  "log.scrap.drop": "{machine} se deshace en chatarra: {module}.",
  "log.door.key": "El lector parpadea en verde. {door} se abre.",
  "log.door.power": "Vuelcas la CELDA en {door}. La traba cede.",
  "log.door.cut.on": "Cortas {door}. Quedan {left, one: # turno, other: # turnos}.",
  "log.door.cut.done": "{door} cede con un chirrido.",
  "log.door.weld.on": "Pasas el soldador por la junta de {door}.",
  "log.door.weld.done": "{door} queda soldada. As\xED se queda.",
  "log.door.close": "Cierras {door}.",
  "log.spike.on": "Metes la {spike} en {target}.",
  "log.spike.done": "{target} cede. Est\xE1s dentro.",
  "log.body.plain": "Registras el cuerpo: {cr} CR.",
  "log.body.key": "Registras el cuerpo: {cr} CR y una llave.",
  "log.crate.open": "Revientas {crate}: {cr} CR a la cala.",
  "log.cargo.take": "Sacas a palanca la caja marcada de su rejilla.",
  "log.upload.on": "La consola lo suelta despacio. Quedan {left, one: # turno, other: # turnos}.",
  "log.upload.done": "Subida completa. Fuera lo que fuera, el remolcador lo tiene.",
  "log.console.away": "Te apartas de la consola. Vuelve a empezar.",
  "log.work.break.cut": "Dejas el corte a medias.",
  "log.work.break.weld": "Dejas la soldadura a medias.",
  "log.work.break.splice": "Dejas el empalme a medias.",
  "log.work.break.purge": "Dejas la purga a medias.",
  "log.carry.take": "{module} {left}/{max} recogido. Lleva {n} de {limit}.",
  "log.carry.home": "Tra\xEDdos: {n}. A la bodega.",
  "log.salvage.graft": "Injertas {module}. Queda mejor que nuevo ({left}/{max}).",
  "log.salvage.mend": "Metes la chatarra en {module} ({left}/{max}).",
  "log.salvage.install": "Sacas {module} ({left}/{max}) del resto.",
  "log.weld": "Sueldas {module} hasta {left}/{max}.",
  "log.pulse": "Pulso de sensor. Dos puertas de nave vuelven al esquema.",
  "log.emp": "La bobina descarga. {n, one: Una m\xE1quina se agarrota, other: # m\xE1quinas se agarrotan}. Quedan {left}.",
  "log.shock": "El {module} chispea. {n, one: Una m\xE1quina se agarrota, other: # m\xE1quinas se agarrotan}. Quedan {left}.",
  "log.swap.carried": "{module} montado; {old} fuera, en brazos.",
  "log.swap.dropped": "{module} montado. Brazos llenos: el {old} queda aqu\xED.",
  "log.relic.take": "Una reliquia: {module}. Ning\xFAn banco la repara, ning\xFAn muelle la vende.",
  "log.relic.seen": "El pulso lee una caja sellada en {room}. Algo la custodia.",
  "log.emitter.hit": "{emitter}: impacto, {target}, da\xF1o {n} ({hp}/{max}).",
  "log.system.work": "Metes {tool} en {system}. Quedan {left, one: # turno, other: # turnos}.",
  "log.system.advance": "El contrato adelanta:",
  "log.system.all": "Los tres en l\xEDnea. Pulsa `<` para salir por la esclusa: el casco es tuyo.",
  "log.system.all.paid": "Los tres en l\xEDnea. Pulsa `<` para salir por la esclusa: el casco es tuyo: +{cr} CR.",
  "log.alert.hunter": "Un {hunter} despierta en {room}.",
  "log.alert.busy": "La nave no ha estado quieta: {n} m\xE1quinas m\xE1s a bordo.",
  "log.alert.calm": "La nave deja de buscarte.",
  "log.alert.up": "Alerta: {stage}.",
  "log.alert.wake": "Algo despierta en {room}.",
  "log.alert.door": "La nave cierra {door} a tu espalda.",
  "log.alert.lock": "La nave bloquea {door} a tu espalda.",
  "log.alert.scuttle": "BARRENO: en {n} turnos la nave empieza a despresurizar sus propios compartimentos.",
  "log.alert.vent": "La nave despresuriza {room}. Todo lo que hab\xEDa dentro se ha ido.",
  "log.alert.vacuum": "Sin aire en {room}: el vac\xEDo te quita {n} del n\xFAcleo.",
  "log.alert.down": "La nave se rinde. Neutralizada, deja de responder.",
  "alert.noticed": "DETECTADO",
  "alert.searching": "B\xDASQUEDA",
  "alert.hunting": "CAZA",
  "alert.hunter": "EJECUTOR",
  "alert.scuttle": "BARRENO",
  "log.bloom.hatch": "El brote se abre. Algo sale de dentro.",
  "log.bloom.strip": "Abres el brote: {cr} CR de biomasa, y nada que atornillar.",
  "log.bloom.dies": "El brote se desploma. Biomasa, y ni una pieza.",
  "log.ghost.sighted": "Algo con tu indicativo se mueve ah\xED dentro.",
  "log.ghost.drop": "El espectro se deshace. Tu viejo bastidor est\xE1 en el suelo.",
  "log.rival.aboard": "Hay un dron rival a bordo. No viene por la chatarra.",
  "log.rival.gone": "El rival corta y corre hacia su propia esclusa.",
  "log.hull.taken": "\xAB{hull}\xBB ya va a remolque del otro. Tres sistemas para nada.",
  "log.rival.lost": "Otro remolcador se queda la nave. Tienes veinte turnos.",
  "log.rival.jumped": "El remolcador rival salta con la nave. Tu dron se va con ella.",
  "log.rival.system": "El rival pone {system} en l\xEDnea.",
  "log.rival.drops": "El rival suelta: {module}.",
  // El trato (G34). Todas sus filas viven aqui, con lo demas que dice el rival.
  "action.rival.payoff": "pagar al rival ({price} CR)",
  "action.rival.aside": "irte: el rival da {price} CR",
  "action.rival.split": "dar al rival media venta",
  "why.rival.spent": "Ya no le queda nada que activar.",
  "why.rival.notHere": "El rival no est\xE1 en este compartimento.",
  "why.rival.dealt": "El trato por este casco ya est\xE1 cerrado.",
  "log.rival.deal.paid": "El rival coge los cr\xE9ditos y se va. Su bot\xEDn se queda.",
  "log.rival.deal.sold": "El rival paga por v\xEDa libre en la nave:",
  "log.rival.deal.split": "Cerr\xE1is a medias. Ahora trabaja contigo.",
  "log.rival.raises": "El rival pone {system} en l\xEDnea para ti.",
  "panel.deal": "TRATO {deal}",
  "word.deal.paid": "pagado",
  "word.deal.sold": "apartado",
  "word.deal.split": "a medias",
  "log.virus.caught": "La chatarra tra\xEDa algo. {virus} en {module}.",
  "log.virus.rot": "{virus} roe {module}: quedan {left}.",
  "log.virus.rot.burned": "{virus} acaba con {module}. El m\xF3dulo ya no est\xE1.",
  "log.virus.skim": "{virus} saca {amount} CR de la cuenta.",
  "log.virus.skim.empty": "{virus} rebusca en la cuenta. No hay nada.",
  "log.virus.core": "{virus} llega al n\xFAcleo. Quedan {left}.",
  "log.virus.twitch": "{module}: espasmo. {virus} eligi\xF3 d\xF3nde cae el golpe.",
  "log.virus.moves": "El virus deja {from} y pasa a {to}.",
  "log.virus.purge.on": "Pasas el soldador por {module}.",
  "log.virus.purge.done": "La purga prende. {module}: limpio.",
  "log.virus.burned": "El virus se va con el m\xF3dulo quemado.",
  "log.helm.board": "El tabl\xF3n del TIM\xD3N: {flavour}.",
  "log.charter.signed": "Firmado: {charter}.",
  "log.charter.filled": "{charter} cumplido:",
  "log.charter.missed.salvage": "{charter} sin cumplir: {have} de {need} CR de chatarra.",
  "log.charter.missed.retrieve": "{charter} sin cumplir: la caja sigue a bordo.",
  "log.charter.missed.upload": "{charter} sin cumplir: la subida en la consola no termin\xF3.",
  "log.credit": "{why} +{amount} CR. {total} CR.",
  "log.hull.bought": "Un {hull} sale del bastidor: {trait}. Quedan {credits} CR.",
  "log.hull.tow": "{hull} queda a remolque:",
  "log.hull.tow.split": "{hull} queda a remolque, venta a medias:",
  "log.hold.emptied": "Se vac\xEDa la cala:",
  "log.hold.sell": "Vendido del todo \u2014 {module}:",
  "log.hold.sell.sick": "Vendido del todo \u2014 {module} infectado:",
  "log.hold.fit": "Atornillas {module} ({integrity}) en la ranura {slot}.",
  "log.bench.repair": "La mesa devuelve tu {module} a {left}/{max}.",
  "log.bench.graft": "La mesa injerta tu {module} hasta {left}/{max}.",
  "log.bench.clean": "La mesa quema el virus de tu {module}.",
  "log.jump": "El remolcador pone rumbo a {hull}. Quedan {credits} CR.",
  "log.jump.warn": "{hull}: {up} de {of} sistemas en l\xEDnea. Saltar abandona el casco.",
  "log.jump.left": "Abandonas: {charters}.",
  "log.voyage.undock": "Sueltan las mordazas.",
  "log.voyage.home": "La esclusa cicla. El remolcador espera, y el pecio sigue respirando.",
  "log.voyage.won": "El remolcador responde al indicativo de tu padre. Te lo llevas a casa. Ganas.",
  "log.voyage.broke": "El bastidor est\xE1 vac\xEDo y la cuenta tambi\xE9n. Fin del viaje.",
  "log.drone.lost": "El dron deja de responder. Lo que llevaba se queda en el pecio.",
  // ---------------------------------------------------------------- los avisos
  "hint.exposure": "Los golpes caen sobre lo \xFAltimo que usaste.",
  "hint.burned": "Un m\xF3dulo quemado no vuelve. Su ranura queda vac\xEDa.",
  "hint.scrap": "Chatarra. Des\xE1rmala por un m\xF3dulo, o inj\xE9rtala en uno que ya tengas.",
  "hint.blind": "Sin esc\xE1ner s\xF3lo ves esta sala. Busca uno.",
  "hint.keycard": "Una llave. Las puertas marcadas [ ] la leen.",
  "hint.death": "Tu dron sigue ah\xED dentro. No ser\xE1 amistoso.",
  "hint.objective": "Uno de los tres sistemas. Activa los tres y sal vivo: el remolcador vende el casco entero.",
  "hint.payout": "No se paga nada hasta que el dron vuelve por la esclusa. Si muere aqu\xED, muere la bodega.",
  "hint.mouse": "El rat\xF3n tambi\xE9n sirve: pulsa una l\xEDnea o un compartimento del esquema.",
  "hint.sold": "La cala se vendi\xF3 por {credits} CR. Un casco cuesta {hullPrice}.",
  "hint.shooting": "Disparar expone lo que dispara: la respuesta cae en el EMISOR, lo m\xE1s fr\xE1gil del bastidor.",
  "hint.sell": "Vendido del todo: nadie revende m\xF3dulos. Para conservar uno, gu\xE1rdalo en la bodega.",
  "hint.training": "ENTRENAMIENTO. El primer casco del viaje est\xE1 hecho para aprender. Siete l\xEDneas, una a una.",
  "hint.tutorial.enter": "CASCO DE ENTRENAMIENTO. Peque\xF1o y tranquilo: nada aqu\xED acaba una partida. Todo, en la lista.",
  "hint.tutorial.scan": "Pulsa s para el pulso del SCANNER: lee los compartimentos tras las puertas antes de entrar.",
  "hint.tutorial.contact": "Una m\xE1quina. Atacar es una acci\xF3n numerada, y marcharse tambi\xE9n: nada te sigue a casa.",
  "hint.tutorial.door": "Mamparo cerrado. Su tarjeta est\xE1 en un cad\xE1ver de este lado: registra a los muertos o corta.",
  "hint.tutorial.system": "Levantar un sistema lleva varios turnos y hace ruido. Lo que siga a bordo lo oye y viene.",
  "hint.tutorial.airlock": "La esclusa. Salir ingresa lo que el dron lleva y deja la nave tal como est\xE1.",
  "hint.tutorial.sale": "Ah\xED acaba la lecci\xF3n. El siguiente casco no lo es: salta cuando la cuenta pague un dron.",
  "hint.virus": "La chatarra puede traer el virus de la nave. Cada casco tiene el suyo. El soldador lo limpia.",
  "strain.spasm": "ESPASMO",
  "strain.rot": "PUDRICI\xD3N",
  "strain.leech": "SANGUIJUELA",
  "strain.leash": "CORREA",
  // ------------------------------------------------------------ las negativas
  "why.credits": "No hay cr\xE9ditos suficientes.",
  "why.line.none": "No hay nada en esa l\xEDnea.",
  "why.notHere": "Aqu\xED no.",
  "why.jammed": "Est\xE1tica. Nada responde.",
  "why.door.notHere": "No hay tal puerta en este compartimento.",
  "why.door.notLocked": "{door} no est\xE1 trabada.",
  "why.door.noLock": "{door} no tiene traba que forzar.",
  "why.door.noCut": "{door} no necesita corte.",
  "why.door.noWeld": "{door} no se puede soldar.",
  "why.door.notOpen": "{door} no est\xE1 abierta.",
  "why.door.noKeycard": "El dron no lleva ninguna llave.",
  "why.door.noKeycardHere": "Aqu\xED no hay traba que abra una llave.",
  "why.door.wallsIn": "Soldar {door} dejar\xEDa al dron encerrado aqu\xED.",
  "why.door.notBehind": "El dron no entr\xF3 aqu\xED por un mamparo.",
  "why.door.noneHere": "Nada que hacer con los mamparos de aqu\xED.",
  "why.door.state": "La puerta {door} est\xE1 {state}.",
  "why.room.noRoute": "No hay ruta a {room}.",
  "why.module.missing": "No hay {module} en el bastidor.",
  "why.module.notInstalled": "No hay {module} montado.",
  "why.module.passive": "Ese m\xF3dulo no tiene uso activo.",
  "why.module.whole": "{module} est\xE1 entero.",
  "why.module.grafted": "{module} no admite m\xE1s injertos.",
  "why.module.clean": "{module} est\xE1 limpio.",
  "why.rig.emptySlot": "Ranura vac\xEDa.",
  "why.slot.empty": "No hay nada en esa ranura.",
  "why.rack.full": "No hay ranura libre. Vende algo primero.",
  "why.rack.burnFirst": "No hay ranura libre. Algo tiene que quemarse antes.",
  "why.graft.full": "No queda nada que injertar.",
  "why.repair.none": "Nada que reparar.",
  "why.breach.nothing": "Aqu\xED no hay nada que forzar.",
  "why.shoot.none": "Nada en la l\xEDnea de tiro.",
  "why.emp.spent": "{emp} est\xE1 agotado.",
  "why.emp.none": "Nada al alcance.",
  "why.relic.have": "Ya llevas un {module}.",
  "why.relic.pick": "Bastidor lleno. Elige qu\xE9 reemplaza.",
  "why.relic.noRepair": "{module} es una reliquia. Nada la repara.",
  "why.swap.free": "Hay una ranura libre: desgu\xE1zalo sin m\xE1s.",
  "why.salvage.noRig": "Nada que desarmar.",
  "why.carry.full": "El dron carga {n} y no m\xE1s.",
  "why.salvage.none": "Aqu\xED no hay nada que desarmar.",
  "why.biomass.none": "Aqu\xED no hay biomasa.",
  "why.body.none": "Aqu\xED no hay a qui\xE9n registrar.",
  "why.body.searched": "A ese ya lo registraste.",
  "why.cargo.none": "Aqu\xED no hay nada que cargar.",
  "why.cargo.carrying": "Ya la llevas encima.",
  "why.console.none": "Aqu\xED no hay consola.",
  "why.console.done": "Esa consola ya solt\xF3 lo que ten\xEDa.",
  "why.system.none": "Aqu\xED no hay nada que poner en l\xEDnea.",
  "why.system.up": "{system} ya est\xE1 en l\xEDnea.",
  "why.system.needs": "Hace falta: {tools}.",
  "why.virus.none": "No hay nada infectado en el bastidor.",
  "why.virus.clean": "Ese m\xF3dulo est\xE1 limpio.",
  "why.tug.only": "Eso es cosa del remolcador, no de aqu\xED fuera.",
  "why.hull.none": "No hay tal casco en el bastidor.",
  "why.hold.noDrone": "No hay dron al que mont\xE1rselo.",
  "why.hold.none": "No hay nada en la cala con ese n\xFAmero.",
  "why.charter.none": "No hay nada en el tabl\xF3n con ese n\xFAmero.",
  "why.charter.late": "Tabl\xF3n cerrado: {hull} ya est\xE1 abierto.",
  "why.undock.aboard": "Ya est\xE1s a bordo.",
  "why.undock.noDrone": "No hay dron en los ra\xEDles.",
  "why.undock.sold": "{hull} va a remolque. Salta al siguiente casco.",
  "why.undock.tow": "{hull} va a remolque.",
  "why.jump.aboard": "Salta el remolcador; el dron no.",
  "why.jump.last": "M\xE1s all\xE1 no hay nada. \xC9ste es el \xFAltimo casco del viaje.",
  "why.jump.first": "El salto de {price} CR va primero.",
  // ---------------------------------------------------- la lista de acciones
  "action.attack": "atacar {target} {hp}/{max}",
  "action.shoot": "disparar {target}",
  "action.carry": "llevarse {module} {left}/{max}",
  "action.salvage": "desguazar {module} {left}/{max}",
  "action.swap": "{module} por {old}",
  "action.swapMenu": "{module} por \u2026 \u25B8",
  "action.discharge": "descargar {module} ({n})",
  "action.hide": "esconderse",
  "action.search": "registrar cuerpo",
  "action.strip": "sacar biomasa ({cr} CR)",
  "action.purge": "purgar {module} (soldador, {left})",
  "action.work": "activar {system}: {tool} {left}",
  "action.workBare": "activar {system} ({left})",
  "action.take": "coger {crate} ({cr} CR)",
  "action.takeMarked": "coger la caja marcada",
  "action.upload": "subir ({left, one: # turno, other: # turnos})",
  "action.buy": "comprar {hull} {price} CR",
  "action.undock": "salir hacia {hull}",
  "action.undock.todo": "salir {left}",
  "undock.left.damaged": "{n} rotos",
  "undock.left.charter": "sin flete",
  "undock.left.board": "\u2014 el tabl\xF3n cierra",
  "action.repair": "{module} {price} CR",
  "action.clean": "limpiar {module} ({price} CR)",
  "action.graft": "{module} +1 base  {price} CR",
  "action.order": "comprar {module} {price} CR",
  "action.fit": "{module} {integrity}/{max}",
  "action.sell": "{module} {left}/{max}  {price} CR",
  "action.charter": "tomar {charter} ({price})",
  "action.jump": "\u2192 {hull}  {price} CR",
  "action.jump.drop": "dejar {up}/{of}, venta {cr} CR",
  "action.back": "volver ({door})",
  "action.backRoom": "volver",
  "dist.doors": "{n, one: # puerta, other: # puertas}",
  "dist.none": "sin paso",
  "crate.cargo": "caja de carga",
  "crate.contraband": "caja de contrabando",
  // ---------------------------------------------------------- lo que dice `o`
  "stop.over": "La partida ha terminado.",
  "stop.machine": "Ves {machine} en {room}.",
  "stop.hit": "Algo te est\xE1 golpeando.",
  "stop.alert": "Sube la alerta.",
  "stop.thing": "Aqu\xED hay algo: {thing}.",
  "stop.explored": "{hull} explorado. {back}",
  "stop.airlock.none": "No hay vuelta a la esclusa.",
  "stop.airlock.here": "Est\xE1s en la esclusa.",
  "stop.airlock.away": "La esclusa est\xE1 a {n, one: # puerta, other: # puertas}.",
  "stop.noTarget": "Ning\xFAn blanco a la vista.",
  "stop.noWay": "No hay paso.",
  "stop.arrived": "Llegas a {room}.",
  "stop.shut": "El paso est\xE1 cerrado: {door} ({state}).",
  "stop.shut.ways": "El paso est\xE1 cerrado: {door} ({state}) \u2014 {ways}; a bordo: {have}.",
  "stop.shut.none": "El paso est\xE1 cerrado: {door} ({state}) \u2014 {ways}; nada a bordo lo abre.",
  // ------------------------------------------------------------------ el panel
  "panel.turn": "turno {n}",
  "panel.sortie": "salida {n}",
  "panel.actions": "ACCIONES",
  "panel.more": "\u2026 {n} m\xE1s",
  "panel.more.arrows": "\u2026 {n} m\xE1s (\u2191\u2193)",
  "panel.room": "{room} {label}",
  "panel.doorTo": "{door} \u2192 {room}",
  "panel.roomDoors": "{room} {label}  puertas {doors}",
  "panel.doorMore": "\u2026 {n, one: # puerta m\xE1s, other: # puertas m\xE1s}",
  "panel.roomMore": "\u2026 {n} m\xE1s aqu\xED",
  "panel.letter.move": "m anda",
  "panel.letter.brace": ". aguanta",
  "panel.letter.hide": "h oculta",
  "panel.letter.doors": "d puertas",
  "panel.letter.leave": "< salir",
  "panel.letters.tug": "0 atr\xE1s  ? ayuda",
  "panel.letters": "o expl.  Tab pelea  ? ayuda",
  "panel.nextHit": "EL PR\xD3XIMO GOLPE DA EN",
  "panel.core": "N\xDACLEO {dots}",
  "panel.slot.empty": "-- vac\xEDa --",
  "panel.slot.burned": "-- quemado --",
  "panel.keys": "LLAVES {n}",
  "panel.alert": "ALERTA {gauge}",
  "panel.alertStage": "ALERTA {gauge} {stage}",
  "panel.alertScuttle": "ALERTA {gauge} BARRENO EN {n}",
  "panel.alertOff": "ALERTA {gauge} APAGADA",
  "panel.hunter": "EJECUTOR sigue a bordo",
  "panel.rival": "RIVAL {gauge}",
  "panel.evac": "EVAC {n}",
  "panel.goal": "META  NEUTRALIZAR  {cr} CR",
  "panel.goal.bare": "META  3 SISTEMAS, SAL VIVO",
  "panel.goal.done": "LOS TRES EN L\xCDNEA +{cr} CR",
  "panel.goal.out": "< salir por la esclusa",
  "panel.goal.noTool": "NADA A BORDO LO LEVANTA",
  "panel.goal.towed": "CASCO TOMADO  a remolque",
  "panel.goal.work": "{mark} {system} {tool}, {left, one: # turno, other: # turnos}",
  "panel.charters": "CONTRATOS",
  "panel.charter.plain": "{mark} {name}",
  "panel.charter.where": "{mark} {name} \xB7 {room}",
  "panel.charter.loot": "{mark} {name} {have}/{need} CR",
  "panel.virus": "{virus} en {module}",
  "panel.credits": "CR\xC9DITOS {n}",
  "panel.hold": "LLEVA  {n} CR",
  "panel.droneLost": "SIN DRON EN LA GRADA",
  "panel.cheapest": "CASCO BARATO {n}",
  "panel.derelict": "PECIO {hull}",
  "panel.tow": "a remolque",
  "panel.quiet": "en calma",
  "panel.alertAt": "alerta {n}",
  "panel.hullState": "{alert} \xB7 {up}/{of} act.",
  "ship.rooms": "{n, one: # sala, other: # salas}",
  "ship.seen": "{n} vistas",
  "ship.scanned": "{n} barridas",
  "schematic.hidden": "\xBB {n, one: # sala, other: # salas}",
  "schematic.behind": "\xAB {n, one: # sala, other: # salas}",
  // Added with the tug-clarity pass (G40).
  "why.rack.hullFull": "El bastidor est\xE1 lleno.",
  "action.hull.onRack": "{hull} \u2014 en el bastidor",
  "panel.contact.hit": "quema {module}",
  // The contacts block, made unmissable (G47).
  "panel.contacts.here": "ENEMIGO AQU\xCD: {n}",
  "panel.contacts.near": "TRAS LA PUERTA: {n}",
  "panel.contactsMore": "\u2026 {n} m\xE1s a la vista",
  "danger.melee": "de cerca",
  "danger.door": "dispara",
  "danger.jam": "inhibe",
  "danger.noScrap": "sin restos",
  "danger.hunter": "cazador",
  "danger.still": "no pega",
  "log.contacts.here": "Aqu\xED dentro: {list}.",
  "log.contacts.one": "{machine} {hp}, {danger}",
  "panel.head.tug": "SALVOR  rem",
  "panel.head.tugTo": "SALVOR  rem \u2192 {hull}",
  "help.where.tug.head": "D\xD3NDE EST\xC1S \u2014 tu propio remolcador",
  "help.where.tug.1": "Una pantalla: compra un dron, rep\xE1ralo, guarda o vende",
  "help.where.tug.2": "lo que no lleves, toma un contrato y sal. Aqu\xED no se anda.",
  "help.where.ship.head": "D\xD3NDE EST\xC1S \u2014 dentro de un pecio",
  "help.where.ship.1": "Coge lo que pague, pon en l\xEDnea los sistemas y sal",
  "help.where.ship.2": "por la esclusa: la cala s\xF3lo es dinero ya en casa.",
  "help.name.pick": "MARCAR",
  "help.key.pick": "arriba/abajo  enter hace la l\xEDnea marcada",
  "help.name.move": "ANDAR",
  "help.name.doors": "PUERTAS",
  "help.name.seal": "SOLDAR",
  "ship.yourTug": "tu remolcador",
  "ship.dockedTo": "amarrado a {hull}",
  "banner.ahead": "PECIO delante: {hull} \xB7 {rooms}",
  "banner.tug": "TU REMOLCADOR \xAB{callsign}\xBB \xB7 amarrado a {hull}",
  "banner.derelict": "PECIO {parts}",
  "word.unknownHull": "casco desconocido",
  "log.opening.tug": "Tu remolcador. Todo est\xE1 en la lista: dron, reparaciones, contratos, salida. ? cuando quieras.",
  "log.opening.voyage": "{callsign}. {hulls} cascos por delante; el \xFAltimo es la nave de tu padre.",
  // ---------------------------------------------------------- título y ayuda
  "title.name": "SALVOR",
  "title.tagline": "Un roguelike por turnos. Cada golpe quema el m\xF3dulo que usaste.",
  "title.menu.head": "MEN\xDA",
  "title.menu.voyage": "Viaje nuevo",
  "title.menu.voyage.at": "un pecio reci\xE9n sorteado",
  "title.menu.training": "Entrenamiento",
  "title.menu.training.at": "el casco que ense\xF1a, paso a paso",
  "title.menu.help": "Ayuda",
  "title.menu.help.at": "teclas, reglas, qu\xE9 es un contrato",
  "title.menu.seed": "Semilla",
  "title.menu.lang": "Idioma",
  "title.menu.view": "Vista",
  "title.menu.sound": "Sonido",
  "title.sound.on": "s\xED",
  "title.sound.off": "no",
  "title.view.ascii": "ASCII",
  "title.view.web": "paneles",
  "title.view.hex": "colmena",
  "title.view.judges": "El jurado del jam espera ASCII: as\xED abre una sesi\xF3n nueva.",
  "title.seed.empty": "escribe cifras",
  "title.seed.typing": "cifras y Enter \xB7 Enter vac\xEDo sortea una \xB7 Esc cancela",
  "title.start": "1 o espacio: zarpar",
  "title.keys.head": "CONTROLES A BORDO",
  "title.keys.1": "?  ayuda      m  andar      o  explorar      Tab  combate",
  "title.keys.2": "i  qu\xE9 pasa aqu\xED      V  vista      Enter  hacer la l\xEDnea",
  "title.foot": "roguetemple's Fortnight 2 \xB7 smoreg \xB7 compilaci\xF3n {version}",
  "help.page.more": "{n}/{of}   ? sigue   esc cierra",
  "help.page.last": "{n}/{of}   ? cierra   esc cierra",
  "help.title": "CONTROLES",
  "help.name.act": "ACTUAR",
  "help.name.brace": "AGUANTAR",
  "help.name.hide": "OCULTAR",
  "help.name.explore": "EXPLORAR",
  "help.name.engage": "ATACAR",
  "help.name.keycard": "LLAVE",
  "help.name.log": "REGISTRO",
  "help.name.help": "AYUDA",
  "help.key.act": "1-9 0  una l\xEDnea de la lista",
  "help.key.brace": ". o espacio   (expone: BLINDAJE)",
  "help.key.hide": "h   donde el compartimento da cobertura",
  "help.key.move": "m   ad\xF3nde ir \xB7 <   a la esclusa y fuera",
  "help.key.doors": "d   mamparos de aqu\xED: cerrar, soldar",
  "help.key.seal": "shift+D   suelda la puerta por donde entr\xF3",
  "help.key.explore": "o   sigue andando; para ante lo nuevo",
  "help.key.engage": "tab / shift+tab  disparo, o s\xF3lo cuerpo a cuerpo",
  "help.key.scanner": "s   pulso: dos puertas, ruidoso",
  "help.key.emp": "e   aturde el compartimento, 2 cargas",
  "help.key.welder": "w   repara el m\xF3dulo m\xE1s tocado",
  "help.key.cell": "p   alimenta una puerta trabada o una consola",
  "help.key.spike": "K   fuerza una traba, dos turnos, silencioso",
  "help.key.emitter": "f   dispara a la l\xEDnea de tiro",
  "help.key.cutter": "c   corta una puerta, tres turnos, ruidoso",
  "help.key.keycard": "a   gasta una llave, sin ruido",
  "help.key.log": "PgUp   las \xFAltimas 200 l\xEDneas; PgDn atr\xE1s",
  "help.key.help": "?   VISTA V  IDIOMA L  NUEVA shift+R  CERRAR esc",
  // ------------------------------------ what is going on here (G72)
  "codex.label.wrong": "Error:",
  "codex.label.helps": "Ayuda:",
  "codex.label.turn": "Darle la vuelta:",
  "codex.fitted": "(instalado)",
  "codex.badge": "[i] {n}",
  "codex.footer.more": "{n}/{of}   las flechas pasan p\xE1gina   esc cierra",
  "codex.footer.last": "{n}/{of}   esc cierra",
  "codex.spasm.title": "VIRUS SPASM",
  "codex.spasm.what": "Vive en uno de tus m\xF3dulos. Cada ocho turnos esa ranura se sacude y queda expuesta, hicieras lo que hicieras.",
  "codex.spasm.wrong": "Fiarte del reparto ese turno: d\xF3nde cae el golpe lo decide la sacudida, no tu orden.",
  "codex.spasm.helps": "Dos turnos de soldadura lo purgan; en casa el banco lo limpia por 4 CR.",
  "codex.spasm.lore": "La tripulaci\xF3n lo anot\xF3 dos veces como aver\xEDa y despu\xE9s dej\xF3 de anotar.",
  "codex.rot.title": "VIRUS ROT",
  "codex.rot.what": "Una cepa que se come el m\xF3dulo donde vive, un punto de integridad cada cinco turnos, y nunca se mueve.",
  "codex.rot.wrong": "Dejarla en tu mejor m\xF3dulo. A la podredumbre le da igual qu\xE9 roe.",
  "codex.rot.helps": "P\xFArgala antes de que la ranura se queme.",
  "codex.rot.turn": "Un m\xF3dulo que se quema se lleva la podredumbre con \xE9l: cura cara, pero cura.",
  "codex.rot.lore": "En los astilleros lo llamaban el fuego lento y lo pintaban por encima.",
  "codex.leech.title": "VIRUS LEECH",
  "codex.leech.what": "Una cepa que lee la cuenta y no el bastidor: cinco cr\xE9ditos menos cada doce turnos.",
  "codex.leech.wrong": "Tomarte tu tiempo. Es lo \xFAnico a bordo que te cobra por turnos.",
  "codex.leech.helps": "P\xFArgala, o termina r\xE1pido y l\xEDmpiala en el banco.",
  "codex.leech.lore": "Un libro de cuentas que sigue cuadrando solo mucho despu\xE9s del contrabandista.",
  "codex.leash.title": "VIRUS LEASH",
  "codex.leash.what": "Una cepa que va por el dron mismo: un punto de n\xFAcleo cada dieciocho turnos, y el n\xFAcleo no se repara.",
  "codex.leash.wrong": "Terminar la salida primero. Tres pulsos son el dron entero.",
  "codex.leash.helps": "Deja lo que est\xE9s haciendo y p\xFArgala: dos turnos de soldadura.",
  "codex.leash.lore": "Los corsarios la escribieron para llevarse los drones enteros, no a trozos.",
  "codex.alert-1.title": "ALARMA 1: ATENTA",
  "codex.alert-1.what": "La nave ha o\xEDdo algo. Todav\xEDa no viene nadie, y el medidor sube con el ruido y con el tiempo.",
  "codex.alert-1.wrong": "Pelear donde no hac\xEDa falta. Una pelea se oye de un extremo al otro del casco.",
  "codex.alert-1.helps": "El silencio la baja: quince turnos quietos a la vista, ocho a cubierto.",
  "codex.alert-1.lore": "Las naves muertas siguen escuchando mucho despu\xE9s de que la tripulaci\xF3n deje de responder.",
  "codex.alert-2.title": "ALARMA 2: BUSCANDO",
  "codex.alert-2.what": "La nave planta una m\xE1quina por donde ya has pasado. Espera ah\xED; todav\xEDa no caza.",
  "codex.alert-2.wrong": "Volver por donde viniste sin mirar antes.",
  "codex.alert-2.helps": "Un pulso lee dos compartimentos por delante antes de que entres en uno.",
  "codex.alert-2.lore": "No te busca a ti. Est\xE1 donde algo se movi\xF3.",
  "codex.alert-3.title": "ALARMA 3: CAZANDO",
  "codex.alert-3.what": "Mandan una m\xE1quina al compartimento donde est\xE1s, y desde aqu\xED la nave cierra un mamparo a tu espalda cada diez turnos.",
  "codex.alert-3.wrong": "Meterte m\xE1s adentro mientras te cierran la salida.",
  "codex.alert-3.helps": "Suelda la puerta detr\xE1s y lo que te siga llegar\xE1 a un muro.",
  "codex.alert-3.turn": "Cada mamparo que la nave cierra es un muro tambi\xE9n para sus propias m\xE1quinas.",
  "codex.alert-3.lore": "Las puertas siguen obedeciendo a una tripulaci\xF3n que no est\xE1 a bordo.",
  "codex.alert-4.title": "ALARMA 4: EJECUTOR",
  "codex.alert-4.what": "La nave manda a su EJECUTOR. Viene a buscarte, corta lo que soldaste y te encuentra a cubierto.",
  "codex.alert-4.wrong": "Cambiar disparos en un vano. Devuelve el fuego a un compartimento.",
  "codex.alert-4.helps": "La hoja o el cortador acaban antes; un aturdimiento te compra los dos turnos para irte.",
  "codex.alert-4.turn": "Levantar un sistema sube dos el medidor, as\xED que el cazador es el precio de neutralizar la nave.",
  "codex.alert-4.lore": "Dejaban uno despierto en cada casco que llevara algo por lo que valiera despertarlo.",
  "codex.alert-5.title": "ALARMA 5: BARRENO",
  "codex.alert-5.what": "Lo alto del medidor. Los mamparos se bloquean en vez de cerrarse, y a los quince turnos la nave ventea un compartimento cada doce.",
  "codex.alert-5.wrong": "Una sala m\xE1s. La cuenta atr\xE1s del panel es todo el aviso que habr\xE1.",
  "codex.alert-5.helps": "Vete. Con los tres sistemas en marcha el medidor se apaga para siempre.",
  "codex.alert-5.turn": "Zarpar baja el medidor dos escalones: la nave estar\xE1 m\xE1s tranquila cuando vuelvas.",
  "codex.alert-5.lore": "Barrenar era la \xFAltima orden del capit\xE1n. Nadie le dijo a la nave que el capit\xE1n ya no estaba.",
  "codex.vented.title": "COMPARTIMENTO VENTEADO",
  "codex.vented.what": "Vac\xEDo. Sin cobertura, sin nada tirado por ah\xED, y un punto de la ranura expuesta por cada turno que pases dentro.",
  "codex.vented.wrong": "Cruzarlo despacio, o aceptar pelear dentro.",
  "codex.vented.helps": "Cruza de un movimiento, con el m\xF3dulo m\xE1s barato expuesto.",
  "codex.vented.lore": "La nave tira su propio aire con tal de quitarte de en medio.",
  "codex.blade.title": "Q-HOJA, una reliquia",
  "codex.blade.what": "Dos dados donde el cortador tiene uno, y abre un mamparo igual que un cortador. En el bastidor la reliquia lleva la marca \u25AA: el banco no la repara ni la injerta.",
  "codex.blade.wrong": "Dejarla para una ranura mejor m\xE1s adelante. No hay estante que la reponga.",
  "codex.blade.helps": "Cuenta como cortador all\xED donde las reglas piden uno.",
  "codex.blade.lore": "Una de una serie de nueve, y las otras ocho no van a volver.",
  "codex.shocker.title": "ATURDIDOR, una reliquia",
  "codex.shocker.what": "Tres cargas, y cada una es silencio en este compartimento durante dos turnos, m\xE1quinas incluidas. En el bastidor la reliquia lleva la marca \u25AA: el banco no la repara ni la injerta.",
  "codex.shocker.wrong": "Guardar las tres para una pelea que nunca llega. No se recarga.",
  "codex.shocker.helps": "Se dispara desde la lista numerada, no desde una letra.",
  "codex.shocker.lore": "Hecho para abordajes que quer\xEDan la carga intacta.",
  "codex.lattice.title": "RET\xCDCULA, una reliquia",
  "codex.lattice.what": "Treinta de integridad y el \xFAnico punto fijo de blindaje que hay en el juego. En el bastidor la reliquia lleva la marca \u25AA: el banco no la repara ni la injerta.",
  "codex.lattice.wrong": "Esperar a que el banco la repare. Una reliquia no se repara, ni aqu\xED ni en casa.",
  "codex.lattice.helps": "Cuenta como blindaje all\xED donde las reglas lo piden.",
  "codex.lattice.lore": "Tejida y no fundida, y ya nadie vivo recuerda c\xF3mo.",
  "codex.ghost.title": "FANTASMA",
  "codex.ghost.what": "Lo que queda de un dron que muri\xF3 a bordo. Lleva el bastidor que cargaba y golpea con lo mejor de \xE9l.",
  "codex.ghost.wrong": "Volver a por tu propio resto sin contar qu\xE9 llevaba encima.",
  "codex.ghost.helps": "Nunca abre una esclusa, as\xED que nunca sale de este casco.",
  "codex.ghost.turn": "M\xE1talo y todo lo que lleva vuelve a estar en la cubierta.",
  "codex.ghost.lore": "En los remolcadores no se habla de esta parte del oficio.",
  "codex.rival.title": "DRON RIVAL",
  "codex.rival.what": "El dron de otro remolcador, trabajando el mismo casco. Corta puertas y levanta sistemas, y nunca va a por ti.",
  "codex.rival.wrong": "Dejarlo en paz. Lo que \xE9l levante es dinero que no cobras.",
  "codex.rival.helps": "Siete puntos de vida y ning\xFAn inter\xE9s en pelear: la pelea la empiezas t\xFA.",
  "codex.rival.turn": "Lleva encima lo que se ha llevado, y su resto lo suelta entero.",
  "codex.rival.lore": "El padre de alg\xFAn otro tambi\xE9n ten\xEDa un remolcador.",
  "codex.sentry-turret.title": "TORRETA",
  "codex.sentry-turret.what": "La defensa propia de la nave. No se mueve, y dispara a un compartimento por cualquier puerta que dejes abierta.",
  "codex.sentry-turret.wrong": "Quedarte en el vano para mirarla.",
  "codex.sentry-turret.helps": "Cierra el mamparo, o t\xF3mala en la sala: cinco puntos de vida y un emisor en el resto.",
  "codex.sentry-turret.lore": "Atornillada donde estaba la carga, y desde entonces sin moverse.",
  "codex.jammer.title": "INHIBIDOR",
  "codex.jammer.what": "Mientras est\xE9 en tu compartimento el bastidor no responde a nada. Herido, huye.",
  "codex.jammer.wrong": "Echar mano de un m\xF3dulo. Con esto aqu\xED no se puede gastar nada.",
  "codex.jammer.helps": "Un golpe cuerpo a cuerpo s\xED entra, y salir del compartimento tambi\xE9n sirve.",
  "codex.jammer.lore": "Los chatarreros lo llamaban el callado.",
  "codex.bloom.title": "FLORACI\xD3N",
  "codex.bloom.what": "Un criadero. Nunca golpea; cada seis turnos suelta otro reptador, hasta cuatro vivos a la vez.",
  "codex.bloom.wrong": "Pelear con la camada en vez de con lo que la hace.",
  "codex.bloom.helps": "Ocho puntos de vida, y no devuelve el golpe.",
  "codex.bloom.turn": "Despiezada vale dos cr\xE9ditos: lo \xFAnico de aqu\xED que paga.",
  "codex.bloom.lore": "Algo entr\xF3 en la hidropon\xEDa y all\xED se encontr\xF3 a gusto.",
  "codex.crawler.title": "REPTADOR",
  "codex.crawler.what": "Corrosivo, y la \xFAnica cosa a bordo que no deja ni un m\xF3dulo.",
  "codex.crawler.wrong": "Cambiarle integridad. El blindaje no est\xE1 en su cadena y el resto no paga nada.",
  "codex.crawler.helps": "Al\xE9jate. Tres puntos de vida si no queda otra.",
  "codex.crawler.lore": "No es una m\xE1quina, dijera lo que dijera el manifiesto.",
  "codex.scout.title": "EXPLORADOR",
  "codex.scout.what": "Lo \xFAnico despierto junto a la esclusa. Mira un compartimento por delante y te ve a cubierto.",
  "codex.scout.wrong": "Esconderte. Para este la cobertura no es cobertura.",
  "codex.scout.helps": "Tres puntos de vida, y el resto lleva un esc\xE1ner.",
  "codex.scout.lore": "No pelea contigo. Le dice a la nave d\xF3nde est\xE1s.",
  "codex.enforcer.title": "EJECUTOR",
  "codex.enforcer.what": "El cazador de la nave. Va a donde te vieron u oyeron por \xFAltima vez, y cada golpe cae en el m\xF3dulo m\xE1s d\xE9bil del bastidor.",
  "codex.enforcer.wrong": "Soldar una puerta y esperar. Abre un mamparo trabado en tres turnos, y la cobertura no te oculta de \xE9l.",
  "codex.enforcer.helps": "Diez puntos de vida y un emisor en el resto. O vete: registra donde te oy\xF3 y luego deja la caza.",
  "codex.enforcer.lore": "No tiene nombre en el manifiesto. Las tripulaciones lo conoc\xEDan por el ruido de una puerta.",
  "codex.security-unit.title": "GUARDIA",
  "codex.security-unit.what": "La guardia de la nave. Ocho puntos de vida y ning\xFAn truco: ve un compartimento por delante y va derecho a por ti.",
  "codex.security-unit.wrong": "Cambiar golpes con el bastidor gastado. Ocho puntos son una pelea larga, y cada golpe suyo le quita integridad a un m\xF3dulo.",
  "codex.security-unit.helps": "El cortador acaba antes con \xE9l, y su resto lleva uno. Una puerta soldada lo detiene.",
  "codex.security-unit.lore": "De serie en todo casco cuya carga valiera la pena asegurar.",
  "codex.scrapper.title": "CHATARRERO",
  "codex.scrapper.what": "M\xE1quina de cascos profundos que caza en grupo. Cada golpe cae en el m\xF3dulo m\xE1s d\xE9bil del bastidor, y muy herida huye.",
  "codex.scrapper.wrong": "Salir con un m\xF3dulo gastado en el bastidor. Se salta todo lo dem\xE1s y va a por ese.",
  "codex.scrapper.helps": "Repara el m\xF3dulo d\xE9bil o gu\xE1rdalo en la bodega antes de salir. Seis puntos de vida, y su resto lleva un PEM.",
  "codex.scrapper.lore": "Desmonta naves por piezas. Un dron tambi\xE9n es piezas.",
  "codex.frost.title": "HIELO",
  "codex.frost.what": "Escarcha en todo. Mientras est\xE1s dentro, los MOTORES pierden 20 de velocidad y cada m\xE1quina a bordo gana turnos contra ti.",
  "codex.frost.wrong": "Detenerse: una pelea, una chatarra, un sistema levantado sobre el hielo.",
  "codex.frost.helps": "Cruzar de largo. O gastar un punto de la CELDA: la sala queda caliente el resto de la salida.",
  "codex.frost.lore": "El soporte vital fall\xF3 aqu\xED primero. El aliento de la tripulaci\xF3n sigue en las paredes.",
  "codex.smoke.title": "HUMO",
  "codex.smoke.what": "Humo hasta los mamparos. Nadie ve hacia dentro ni hacia fuera: el ESC\xC1NER no muestra nada tras la puerta y ninguna m\xE1quina te ve a trav\xE9s.",
  "codex.smoke.wrong": "Contar con un disparo. El EMISOR y la torreta est\xE1n ciegos aqu\xED.",
  "codex.smoke.helps": "Acercarse: hoja, aturdidor o cortador funcionan como siempre. Y es cobertura: esconderse aqu\xED no cuesta nada.",
  "codex.smoke.turn": "Atrae a un cazador dentro y te pierde en la puerta. El mejor escondite de la nave.",
  "codex.smoke.lore": "Algo ardi\xF3 aqu\xED durante d\xEDas. La nave nunca abri\xF3 los conductos.",
  "codex.mine.title": "MINA EN UNA PUERTA",
  "codex.mine.what": "Una carga en el mamparo. El primero en cruzar se lleva la explosi\xF3n: para ti, tres puntos en el m\xF3dulo expuesto por el paso, y la alerta sube un pelda\xF1o.",
  "codex.mine.wrong": "Cruzarla porque era el camino corto.",
  "codex.mine.helps": "Dos turnos con el SOLDADOR la quitan desde cualquier lado. El BLINDAJE recibe la explosi\xF3n si hay que cruzar.",
  "codex.mine.turn": "Estalla bajo una m\xE1quina igual que bajo ti. Deja pasar a una primero.",
  "codex.mine.lore": "La tripulaci\xF3n la puso contra abordajes. Los abordadores ya no est\xE1n; la mina s\xED.",
  // The `i` card gets its own row in the key table, and the help card ends
  // with the list of everything this voyage has shown.
  "help.codex.head": "QU\xC9 PASA AQU\xCD \u2014 visto en este viaje",
  "help.name.codex": "SITUACI\xD3N",
  "help.key.codex": "i   qu\xE9 pasa aqu\xED; el sello cuenta lo nuevo",
  "help.rule.head": "EXPUESTO \u2014 la \xFAnica regla",
  "help.rule.1": "El golpe cae sobre el m\xF3dulo que acabas de usar:",
  "help.rule.2": "el marcado \u25C0. Sin nada expuesto pega al BLINDAJE",
  "help.rule.3": "y luego al N\xDACLEO. A 0 el m\xF3dulo se quema para",
  "help.rule.4": "siempre, y la ranura vac\xEDa que deja es el \xFAnico",
  "help.rule.5": "sitio donde cabe la chatarra.",
  "help.list.head": "ACCIONES \u2014 la lista de la derecha",
  "help.list.1": "Todo lo que puedes hacer aqu\xED lleva un n\xFAmero.",
  "help.list.2": "Una apagada no se puede pulsar a\xFAn y dice por qu\xE9.",
  "help.list.3": "Una puerta trabada abre su lista; 0 vuelve.",
  "help.list.4": "Tambi\xE9n con el rat\xF3n: una l\xEDnea o un compartimento.",
  "help.charter.head": "CONTRATOS \u2014 para qu\xE9 es una salida",
  "help.charter.1": "Se firman a bordo del remolcador, en CONTRATOS,",
  "help.charter.2": "antes de zarpar; se cobran con el dron en casa.",
  "help.charter.3": "RESCATE quiere cr\xE9ditos tra\xEDdos a casa.",
  "help.charter.4": "NEUTRALIZAR: motor, reactor y terminal; vende el casco.",
  "help.url.head": "LA BARRA DE DIRECCIONES \u2014 ajustes sin tecla",
  "help.url.seed": "?seed=N        la misma nave otra vez, exacta",
  "help.url.view": "?view=ascii    o web, o hex: las tres pantallas",
  "help.url.sound": "?sound=off     sin m\xFAsica ni sonido",
  "help.url.training": "?training=1    zarpa con los avisos puestos",
  "help.url.debug": "?debug=1       lo que piensan las m\xE1quinas",
  "help.url.tiles": "?tiles=1       dibujos en vez de letras",
  "help.url.hull": "?hull=0        el panal sin casco dibujado",
  // -------------------------------------------------------------- los finales
  "end.dead": "LA CUENTA EST\xC1 VAC\xCDA",
  "end.lost": "DRON PERDIDO",
  "end.won": "EL REMOLCADOR DE TU PADRE ES TUYO",
  "end.sold": "NAVE VENDIDA",
  "end.dead.why": "Sin dron en los ra\xEDles y sin nada para comprar otro.",
  "end.won.why": "El \xFAltimo casco de la ruta va a remolque. El viaje termin\xF3.",
  "end.again": "shift+R para otra partida",
  "end.go": "cualquier tecla \u2014 el viaje sigue",
  "end.summary": "{cr} CR \xB7 {rooms} salas \xB7 {turns} turnos \xB7 {kills} m\xE1quinas \xB7 {burned} m\xF3dulos quemados",
  // -------------------------------------------------------- pantalla de error
  "log.title": "REGISTRO",
  "log.page": "{n}/{of}   PgUp atr\xE1s   PgDn adelante   esc cierra",
  "log.empty": "Todav\xEDa no ha pasado nada.",
  "crash.title": "ALGO SE HA ROTO",
  "crash.seed": "semilla {seed} \xB7 {voyage} \xB7 turno {turn}",
  "crash.sortie": "salida {n}",
  "crash.hull": "casco {n}",
  "crash.hullOf": "casco {n}/{of}",
  "crash.report": "copia esta URL y rep\xF3rtala",
  "crash.unknown": "error desconocido",
  // ------------------------------------------- el remolcador como menú (G53)
  // Los cinco verbos por los que se lee el remolcador. Grupos, no bodegas:
  // DIQUE, BODEGA, BANCO y PUENTE son las tripas de la nave, y por ellos no se
  // adivina dónde se repara un módulo (docs/tasks/G53-tug-is-a-menu.md, 1).
  "tug.group.repair": "REPARAR",
  "tug.group.rig": "EQUIPO",
  "tug.group.voyage": "CONTRATOS",
  "tug.group.jump": "SIGUIENTE CASCO",
  "action.pick.buy": "comprar casco \u25B8",
  "action.dead.undock": "salir",
  "action.dead.clean": "curar m\xF3dulo",
  "action.dead.jump": "saltar al siguiente casco",
  "action.pick.repair": "reparar un m\xF3dulo \u25B8",
  "action.pick.graft": "injertar m\xF3dulo \u25B8 {price} CR",
  "action.pick.stow": "guardar m\xF3dulo \u25B8",
  "action.pick.fit": "bodega y estante \u25B8",
  "action.pick.sell": "vender del todo \u25B8",
  "action.pick.charter": "tomar contrato \u25B8",
  "action.one.hull": "{hull}  {price} CR",
  "action.one.module": "{module} {left}/{max}",
  "action.one.modulePriced": "{module} {left}/{max}  {price} CR",
  "action.one.held": "{module} {integrity}",
  "action.one.charter": "{charter}  {price}",
  "action.stow": "{module} {left}/{max}",
  "log.stock.buy": "{module} comprado por {price} CR. En la bodega. Quedan {credits} CR.",
  "log.hold.fitted": "De la bodega, montados: {n}.",
  "log.hold.stow": "La bodega guarda el {module} ({integrity}/{max}), entero.",
  "why.stock.noDrone": "No hay dron en los ra\xEDles para montarlo.",
  "why.stock.spare": "El dron ya lleva {module}.",
  "why.stock.none": "En el estante no queda nada.",
  "why.hold.full": "La bodega ya lleva {n}. Monta uno antes.",
  "why.hold.shelf": "Nada en la bodega, nada que llevarse del estante.",
  "why.rig.whole": "Nada del bastidor est\xE1 da\xF1ado.",
  "why.rig.grafted": "Nada del bastidor admite m\xE1s injertos.",
  "why.rig.empty": "El bastidor est\xE1 vac\xEDo.",
  "why.rig.last": "El \xFAltimo m\xF3dulo se queda: un bastidor vac\xEDo no vuela a ninguna parte.",
  "why.rig.clean": "Nada del bastidor est\xE1 infectado.",
  "why.charter.gone": "Todos los contratos del tabl\xF3n est\xE1n firmados.",
  "why.tug.noDrone": "No hay dron en los ra\xEDles. Compra un casco.",
  "why.tug.noWalk": "Aqu\xED no se camina: todo est\xE1 en la lista.",
  "board.derelict": "PECIO {hull} \xB7 {alert}",
  "board.worth": "NEUTRALIZAR {up}/{of} \u2014 el casco vale {price} CR",
  "board.rack": "CASCOS EN GRADA",
  "board.hull": "{hull}  {price} CR  {trait}",
  "board.hull.yours": "{hull}  \u2190 en los ra\xEDles",
  "board.sorties": "salidas {n} \xB7 drones perdidos {lost}",
  "board.mode": "Ni alarma ni pasillos. Todo est\xE1 en la lista.",
  // --------------------------------------------------------------- el motor
  //
  // Líneas que escribe el propio motor. No sabe castellano ni puede saberlo:
  // entrega la clave del suceso y sus valores, y la frase se arma aquí
  // (`ui/logline.ts`). Registro: el mismo de las líneas del rig — sujeto, dos
  // puntos, el hecho.
  //
  // `{Actor}` es la máquina con mayúscula; `{actor}`, sin ella.
  "engine.hit.you": "Impacto: {target}, da\xF1o {amount} ({hp}/{max}).",
  "engine.hit.taken": "{Actor}: impacto, da\xF1o {amount}.",
  "engine.hit.other": "{Actor} \u2192 {target}: da\xF1o {amount} ({hp}/{max}).",
  "engine.dies": "{Target} cae.",
  "engine.cover.you": "Te metes a cubierto.",
  "engine.cover.other": "{Actor} se mete a cubierto.",
  "engine.door.open": "{door}: abierta.",
  "engine.door.breached": "{door} cede con un chirrido.",
  "engine.door.cut.you": "Corte en marcha: {door}.",
  "engine.door.cut.other": "{Actor} corta: {door}.",
  "engine.fail.airlock": "Eso es la esclusa. < para volver al remolcador.",
  "engine.fail.attack.ally": "A los tuyos no.",
  "engine.fail.attack.away": "{Target} no est\xE1 en este compartimento.",
  "engine.fail.attack.gone": "Ah\xED no hay nada que atacar.",
  "engine.fail.attack.sight": "{Target} no est\xE1 en la l\xEDnea de tiro.",
  "engine.fail.cover": "Aqu\xED no hay tras qu\xE9 cubrirse.",
  "engine.fail.door.elsewhere": "{door} no est\xE1 en este compartimento.",
  "engine.fail.door.gone": "Esa puerta no existe.",
  "engine.fail.door.shut": "La puerta {door} est\xE1 {state}.",
  "engine.fail.door.size": "{Actor} no cabe: {door}.",
  "engine.fail.leave.none": "Aqu\xED no hay esclusa.",
  "engine.fail.leave.other": "De la nave sale s\xF3lo el dron.",
  "engine.fail.nothing": "Nada que hacer.",
  "engine.fail.over": "La partida termin\xF3.",
  // ---------------------------------------------------------- el esquema
  //
  // La marca de la caja colgada de la esclusa. Tres columnas no dan para
  // una palabra en tres idiomas: el remolcador es un glifo, como `d3` es
  // una etiqueta, y aquí es donde el dibujo se explica.
  "help.where.ship.3": "\u2302 a la izquierda del esquema es tu remolcador.",
  // обзор
  "stop.tug": "Este es tu remolcador, no un pecio: aqu\xED no hay nada que explorar.",
  "stop.noFurther": "{hull}: no se puede seguir, {n, one: queda # sala, other: quedan # salas} sin explorar.",
  "stop.noFurther.tool": "{hull}: no se puede seguir, {n, one: queda # sala, other: quedan # salas} \u2014 hace falta {tool}.",
  // --------------------------------------------------------- los peligros
  //
  // La línea roja, una vez por salida desde la sala contigua
  // (`systems/hazards.ts`). Todas terminan en ` [i]`: el gancho del códice,
  // la tecla que abre la ficha de este peligro (G72).
  "log.hazard.tell.frost": "PELIGRO: tras {door}, {room}: hielo. Los motores pierden velocidad ah\xED. [i]",
  "log.hazard.tell.smoke": "PELIGRO: tras {door}, {room}: humo. Nadie ve a nadie ah\xED. [i]",
  "log.hazard.tell.mine": "PELIGRO: {door} est\xE1 minada. El primero en cruzar se lleva la explosi\xF3n. [i]",
  // La palabra en el bloque de la sala, junto a la marca.
  "word.hazard.frost": "hielo: motores lentos",
  "word.hazard.smoke": "humo: sin visi\xF3n",
  "word.hazard.mine": "mina en {door}",
  "stop.hazard": "Alto: {what}",
  "stop.hazard.again": "Alto: {what} Otra vez y entro.",
  "why.auto.hazard": "El combate autom\xE1tico no entra en un peligro conocido: rod\xE9alo o entra t\xFA.",
  "why.fight.hazard": "Nada a lo que disparar: te golpea el vac\xEDo, no una m\xE1quina. Sal de la sala.",
  "log.hazard.mine.hit": "La mina de {door} estalla bajo el dron.",
  "log.hazard.mine.machine": "{machine} hace estallar la mina de {door}.",
  "log.hazard.heat": "{module} calienta {room}: sin hielo el resto de la salida.",
  "why.hazard.noFrost": "Aqu\xED no hay hielo.",
  "why.hazard.heated": "{room} ya est\xE1 caliente.",
  "verb.heat": "calentar",
  "verb.defuse": "quitar",
  "cost.defuse": "2 turnos, ruido 5",
  "log.door.defuse.on": "Trabajas el soldador en torno a la carga de {door}.",
  "log.door.defuse.done": "La mina de {door} est\xE1 desactivada.",
  "why.door.noTrap": "{door} no tiene mina.",
  "log.work.break.defuse": "Dejas el desminado a medias.",
  // G88 B: the panel's own lines.
  "panel.systems.lost": "sin hallar:",
  "panel.letters.tugTop": "? ayuda"
};

// ../../../smoreg_works/games/salvor/src/content/i18n/ru.ts
var RU = {
  // ----------------------------------------------------------------- отсеки
  "room.docking": "\u041F\u0420\u0418\u0427\u0410\u041B",
  "room.cargo": "\u0413\u0420\u0423\u0417",
  "room.corridor": "\u041A\u041E\u0420\u0418\u0414\u041E\u0420",
  "room.storage": "\u0421\u041A\u041B\u0410\u0414",
  "room.maintenance": "\u0420\u0415\u041C\u041E\u041D\u0422",
  "room.hab": "\u041A\u0410\u042E\u0422\u042B",
  "room.mess": "\u041A\u0410\u041C\u0411\u0423\u0417",
  "room.hydroponics": "\u0422\u0415\u041F\u041B\u0418\u0426\u0410",
  "room.med": "\u041B\u0410\u0417\u0410\u0420\u0415\u0422",
  "room.lab": "\u041B\u0410\u0411",
  "room.quarantine": "\u041C\u0415\u0414\u0411\u041E\u041A\u0421",
  "room.engineering": "\u041C\u041E\u0422\u041E\u0420\u042B",
  "room.workshop": "\u0426\u0415\u0425",
  "room.armory": "\u0410\u0420\u0421\u0415\u041D\u0410\u041B",
  "room.reactor": "\u0420\u0415\u0410\u041A\u0422\u041E\u0420",
  "room.control": "\u041C\u041E\u0421\u0422\u0418\u041A",
  "room.coreaccess": "\u042D\u041D\u0415\u0420\u0413\u041E\u041E\u0422\u0421\u0415\u041A",
  "room.lifesupport": "\u0412\u041E\u0417\u0414\u0423\u0425",
  "room.cryo": "\u041A\u0420\u0418\u041E",
  "room.sensors": "\u0421\u0415\u041D\u0421\u041E\u0420\u042B",
  "room.brig": "\u041A\u0410\u0420\u0426\u0415\u0420",
  "room.escapepods": "\u0428\u041B\u042E\u041F\u041A\u0418",
  "room.dock": "\u0414\u041E\u041A",
  "room.hold": "\u0422\u0420\u042E\u041C",
  "room.bench": "\u0421\u0422\u0415\u041D\u0414",
  "room.helm": "\u0420\u0423\u0411\u041A\u0410",
  // ------------------------------------------------------------------ стойка
  "module.cutter": "\u0420\u0415\u0417\u0410\u041A",
  "module.thrusters": "\u0414\u0412\u0418\u0413\u0410\u0422\u0415\u041B\u0418",
  "module.scanner": "\u0421\u041A\u0410\u041D\u0415\u0420",
  "module.plating": "\u0411\u0420\u041E\u041D\u042F",
  "module.cell": "\u0411\u0410\u0422\u0410\u0420\u0415\u042F",
  "module.emp": "\u042D\u041C\u0418",
  "module.welder": "\u0421\u0412\u0410\u0420\u041A\u0410",
  "module.laser": "\u041B\u0410\u0417\u0415\u0420",
  "module.spike": "\u041E\u0422\u041C\u042B\u0427\u041A\u0410",
  "module.emitter": "\u042D\u041C\u0418\u0422\u0422\u0415\u0420",
  "module.baffle": "\u0413\u0410\u0421\u0418\u0422\u0415\u041B\u042C",
  "module.blade": "\u041A-\u041A\u041B\u0418\u041D\u041E\u041A",
  "module.shocker": "\u0428\u041E\u041A\u0415\u0420",
  "module.lattice": "\u0420\u0415\u0428\u0401\u0422\u041A\u0410",
  "noun.cutter": "\u0440\u0435\u0437\u0430\u043A",
  "noun.thrusters": "\u0434\u0432\u0438\u0433\u0430\u0442\u0435\u043B\u0438",
  "noun.scanner": "\u0441\u043A\u0430\u043D\u0435\u0440",
  "noun.plating": "\u0431\u0440\u043E\u043D\u044F",
  "noun.cell": "\u0431\u0430\u0442\u0430\u0440\u0435\u044F",
  "noun.emp": "\u042D\u041C\u0418",
  "noun.welder": "\u0441\u0432\u0430\u0440\u043A\u0430",
  "noun.laser": "\u043B\u0430\u0437\u0435\u0440",
  "noun.spike": "\u043E\u0442\u043C\u044B\u0447\u043A\u0430",
  "noun.emitter": "\u044D\u043C\u0438\u0442\u0442\u0435\u0440",
  "noun.baffle": "\u0433\u0430\u0441\u0438\u0442\u0435\u043B\u044C",
  "noun.blade": "\u043A\u0432\u0430\u043D\u0442\u043E\u0432\u044B\u0439 \u043A\u043B\u0438\u043D\u043E\u043A",
  "noun.shocker": "\u0448\u043E\u043A\u0435\u0440",
  "noun.lattice": "\u0440\u0435\u0448\u0451\u0442\u0447\u0430\u0442\u0430\u044F \u0431\u0440\u043E\u043D\u044F",
  "burn.cutter": "\u0420\u0415\u0417\u0410\u041A \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u041E\u0441\u0442\u0430\u043B\u0441\u044F \u0442\u0430\u0440\u0430\u043D.",
  "burn.thrusters": "\u0414\u0412\u0418\u0413\u0410\u0422\u0415\u041B\u0418 \u0432\u044B\u0433\u043E\u0440\u0435\u043B\u0438. \u0414\u0430\u043B\u044C\u0448\u0435 \u2014 \u043F\u043E\u043B\u0437\u043A\u043E\u043C \u043D\u0430 \u043C\u0430\u043D\u0438\u043F\u0443\u043B\u044F\u0442\u043E\u0440\u0430\u0445.",
  "burn.scanner": "\u0421\u041A\u0410\u041D\u0415\u0420 \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u0417\u0430 \u044D\u0442\u043E\u0439 \u0434\u0432\u0435\u0440\u044C\u044E \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u0433\u0430\u0441\u043D\u0435\u0442.",
  "burn.plating": "\u0411\u0420\u041E\u041D\u042F \u0432\u044B\u0433\u043E\u0440\u0435\u043B\u0430. \u041C\u0435\u0436\u0434\u0443 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u043C \u0443\u0434\u0430\u0440\u043E\u043C \u0438 \u044F\u0434\u0440\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435\u0442.",
  "burn.cell": "\u0411\u0410\u0422\u0410\u0420\u0415\u042F \u0432\u044B\u0433\u043E\u0440\u0435\u043B\u0430. \u041F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0438 \u043F\u0440\u0438\u0434\u0451\u0442\u0441\u044F \u0440\u0435\u0437\u0430\u0442\u044C.",
  "burn.emp": "\u042D\u041C\u0418 \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u0417\u0430\u0440\u044F\u0434 \u0443\u043C\u0435\u0440 \u0432 \u043A\u0430\u0442\u0443\u0448\u043A\u0435.",
  "burn.welder": "\u0421\u0412\u0410\u0420\u041A\u0410 \u0432\u044B\u0433\u043E\u0440\u0435\u043B\u0430. \u041F\u043E\u0447\u0438\u043D\u043E\u043A \u0432 \u043F\u043E\u043B\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442.",
  "burn.laser": "\u041B\u0410\u0417\u0415\u0420 \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u041B\u0438\u043D\u0437\u0430 \u043F\u043E\u043C\u0443\u0442\u043D\u0435\u043B\u0430 \u043D\u0430\u043C\u0435\u0440\u0442\u0432\u043E.",
  "burn.spike": "\u041E\u0422\u041C\u042B\u0427\u041A\u0410 \u0432\u044B\u0433\u043E\u0440\u0435\u043B\u0430. \u0427\u0442\u043E \u0437\u0430\u043F\u0435\u0440\u0442\u043E, \u0442\u043E \u0437\u0430\u043F\u0435\u0440\u0442\u043E.",
  "burn.emitter": "\u042D\u041C\u0418\u0422\u0422\u0415\u0420 \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u0414\u043E \u0432\u0441\u0435\u0433\u043E \u0441\u043D\u043E\u0432\u0430 \u043F\u0440\u0438\u0434\u0451\u0442\u0441\u044F \u0434\u043E\u0445\u043E\u0434\u0438\u0442\u044C \u0441\u0430\u043C\u043E\u043C\u0443.",
  "burn.baffle": "\u0413\u0410\u0421\u0418\u0422\u0415\u041B\u042C \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0441\u043D\u043E\u0432\u0430 \u0442\u0435\u0431\u044F \u0441\u043B\u044B\u0448\u0438\u0442.",
  "burn.blade": "\u041A-\u041A\u041B\u0418\u041D\u041E\u041A \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u041B\u0435\u0437\u0432\u0438\u0435 \u0441\u0432\u0435\u0440\u043D\u0443\u043B\u043E\u0441\u044C \u0432 \u043D\u0438\u0447\u0442\u043E; \u0432\u0442\u043E\u0440\u043E\u0433\u043E \u0442\u0430\u043A\u043E\u0433\u043E \u043D\u0435\u0442.",
  "burn.shocker": "\u0428\u041E\u041A\u0415\u0420 \u0432\u044B\u0433\u043E\u0440\u0435\u043B. \u041A\u0430\u0442\u0443\u0448\u043A\u0430 \u0442\u0440\u0435\u0441\u043D\u0443\u043B\u0430, \u0438 \u0442\u0430\u043A\u0438\u0445 \u043D\u0438\u0433\u0434\u0435 \u043D\u0435 \u043F\u0440\u043E\u0434\u0430\u044E\u0442.",
  "burn.lattice": "\u0420\u0415\u0428\u0401\u0422\u041A\u0410 \u0432\u044B\u0433\u043E\u0440\u0435\u043B\u0430. \u0415\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u0431\u0440\u043E\u043D\u044F, \u0447\u0442\u043E \u043E\u0442\u0432\u043E\u0434\u0438\u043B\u0430 \u0443\u0434\u0430\u0440, \u0443\u0448\u043B\u0430 \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C.",
  // ------------------------------------------------------------------ машины
  "machine.maintenance-bot": "\u0440\u0435\u043C\u043E\u043D\u0442\u043D\u044B\u0439 \u0431\u043E\u0442",
  "machine.feral-drone": "\u043E\u0434\u0438\u0447\u0430\u043B\u044B\u0439 \u0434\u0440\u043E\u043D",
  "machine.scout": "\u0440\u0430\u0437\u0432\u0435\u0434\u0447\u0438\u043A",
  "machine.security-unit": "\u043E\u0445\u0440\u0430\u043D\u043D\u0438\u043A",
  "machine.welder-bot": "\u0441\u0432\u0430\u0440\u043E\u0447\u043D\u044B\u0439 \u0431\u043E\u0442",
  "machine.hauler": "\u0442\u044F\u0433\u0430\u0447",
  "machine.scrapper": "\u043C\u0443\u0441\u043E\u0440\u0449\u0438\u043A",
  "machine.arc-sentinel": "\u0434\u0443\u0433\u043E\u0432\u043E\u0439 \u0441\u0442\u0440\u0430\u0436",
  "machine.sentry-turret": "\u0442\u0443\u0440\u0435\u043B\u044C",
  "machine.jammer": "\u0433\u043B\u0443\u0448\u0438\u043B\u043A\u0430",
  "machine.crawler": "\u043F\u043E\u043B\u0437\u0443\u043D",
  "machine.bloom": "\u043A\u043E\u043A\u043E\u043D",
  "machine.enforcer": "\u043A\u0430\u0440\u0430\u0442\u0435\u043B\u044C",
  "machine.ghost": "\u043F\u0440\u0438\u0437\u0440\u0430\u043A",
  "machine.rival-drone": "\u0447\u0443\u0436\u043E\u0439 \u0434\u0440\u043E\u043D",
  // ----------------------------------------------------------------- корпуса
  "hull.scrapper": "\u0422\u0420\u0423\u0414\u042F\u0413\u0410",
  "hull.spark": "\u0418\u0421\u041A\u0420\u0410",
  "hull.ghost": "\u0422\u0415\u041D\u042C",
  "trait.scrapper": "6 \u0441\u043B\u043E\u0442\u043E\u0432, \u044F\u0434\u0440\u043E 3",
  "trait.spark": "7 \u0441\u043B\u043E\u0442\u043E\u0432, \u044F\u0434\u0440\u043E 4, \u0414\u0412\u0418\u0413 120",
  "trait.ghost": "8 \u0441\u043B\u043E\u0442\u043E\u0432, \u044F\u0434\u0440\u043E 5, \u0414\u0412\u0418\u0413 140",
  // --------------------------------------------------------------- дереликты
  "derelict.freighter": "\u0433\u0440\u0443\u0437\u043E\u0432\u0438\u043A",
  "derelict.barge": "\u0431\u0430\u0440\u0436\u0430",
  "derelict.ferry": "\u043F\u0430\u0440\u043E\u043C",
  "derelict.probe": "\u0437\u043E\u043D\u0434",
  "derelict.tender": "\u0440\u0435\u043C\u0431\u0430\u0437\u0430",
  "derelict.laboratory": "\u043B\u0430\u0431\u043E\u0440\u0430\u0442\u043E\u0440\u0438\u044F",
  "derelict.military": "\u0432\u043E\u0435\u043D\u043D\u044B\u0439",
  "derelict.smuggler": "\u043A\u043E\u043D\u0442\u0440\u0430\u0431\u0430\u043D\u0434\u0438\u0441\u0442",
  "derelict.corsair": "\u043A\u043E\u0440\u0441\u0430\u0440",
  "derelict.quarantine": "\u043A\u0430\u0440\u0430\u043D\u0442\u0438\u043D",
  "derelict.fathers-tug": "\u0431\u0443\u043A\u0441\u0438\u0440 \u043E\u0442\u0446\u0430",
  "derelict.tutorial": "\u0443\u0447\u0435\u0431\u043D\u044B\u0439 \u043A\u043E\u0440\u043F\u0443\u0441",
  "derelict.flavour": "{callsign} \xB7 {hull} \xB7 {first} \xB7 {second}",
  "flavour.tutorial.0": "\u0432\u0435\u0440\u0444\u0435\u0432\u043E\u0439 \u0442\u0435\u043D\u0434\u0435\u0440",
  "flavour.tutorial.1": "\u0437\u0430\u0433\u043B\u0443\u0448\u0435\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.tutorial.2": "\u0431\u0443\u043A\u0441\u0438\u0440\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.tutorial.3": "\u0445\u043E\u0434\u043E\u0432\u044B\u0435 \u0438\u0441\u043F\u044B\u0442\u0430\u043D\u0438\u044F",
  "flavour.tutorial.4": "\u0431\u0435\u0437 \u044D\u043A\u0438\u043F\u0430\u0436\u0430",
  "flavour.freighter.0": "\u0442\u044F\u0436\u0451\u043B\u044B\u0439 \u0433\u0440\u0443\u0437\u043E\u0432\u0438\u043A",
  "flavour.freighter.1": "\u0440\u0435\u0430\u043A\u0442\u043E\u0440 \u0434\u0435\u043B\u0435\u043D\u0438\u044F",
  "flavour.freighter.2": "\u0438\u043E\u043D\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.freighter.3": "\u0440\u0443\u0434\u043D\u044B\u0439 \u0440\u0435\u0439\u0441",
  "flavour.freighter.4": "\u0434\u043E\u043B\u0433\u0438\u0439 \u043F\u0435\u0440\u0435\u0433\u043E\u043D",
  "flavour.barge.0": "\u0440\u0443\u0434\u043D\u0430\u044F \u0431\u0430\u0440\u0436\u0430",
  "flavour.barge.1": "\u0437\u0430\u0433\u043B\u0443\u0448\u0435\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.barge.2": "\u0431\u0443\u043A\u0441\u0438\u0440\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.barge.3": "\u0440\u0435\u0439\u0441 \u043F\u043E \u043F\u043E\u044F\u0441\u0443",
  "flavour.barge.4": "\u0431\u0440\u043E\u0448\u0435\u043D\u0430 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435",
  "flavour.ferry.0": "\u043F\u0430\u0441\u0441\u0430\u0436\u0438\u0440\u0441\u043A\u0438\u0439 \u043F\u0430\u0440\u043E\u043C",
  "flavour.ferry.1": "\u0437\u0430\u0433\u043B\u0443\u0448\u0435\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.ferry.2": "\u0447\u0435\u043B\u043D\u043E\u0447\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.ferry.3": "\u043E\u0440\u0431\u0438\u0442\u0430\u043B\u044C\u043D\u044B\u0439 \u0440\u0435\u0439\u0441",
  "flavour.ferry.4": "\u0434\u0432\u0435\u0441\u0442\u0438 \u0434\u0443\u0448 \u0432 \u043C\u0430\u043D\u0438\u0444\u0435\u0441\u0442\u0435",
  "flavour.probe.0": "\u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0439 \u0437\u043E\u043D\u0434",
  "flavour.probe.1": "\u0431\u0430\u0442\u0430\u0440\u0435\u0439\u043D\u0430\u044F \u0441\u0431\u043E\u0440\u043A\u0430",
  "flavour.probe.2": "\u0434\u0440\u0435\u0439\u0444\u043E\u0432\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.probe.3": "\u0434\u0430\u043B\u044C\u043D\u0438\u0439 \u043F\u0438\u043A\u0435\u0442",
  "flavour.probe.4": "\u043C\u043E\u043B\u0447\u0438\u0442 \u0434\u0435\u0441\u044F\u0442\u044C \u043B\u0435\u0442",
  "flavour.tender.0": "\u0440\u0435\u043C\u043E\u043D\u0442\u043D\u044B\u0439 \u0442\u0435\u043D\u0434\u0435\u0440",
  "flavour.tender.1": "\u0432\u0435\u0440\u0444\u0435\u0432\u043E\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.tender.2": "\u0432\u0435\u0440\u0444\u0435\u0432\u043E\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.tender.3": "\u043A\u043E\u043D\u0442\u0440\u0430\u043A\u0442 \u043D\u0430 \u0440\u0435\u043C\u043E\u043D\u0442",
  "flavour.tender.4": "\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u0430 \u0432 \u0440\u0435\u043C\u043E\u043D\u0442\u0435",
  "flavour.laboratory.0": "\u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u0441\u043A\u0438\u0439 \u043A\u043E\u0440\u043F\u0443\u0441",
  "flavour.laboratory.1": "\u0438\u0437\u043E\u0442\u043E\u043F\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.laboratory.2": "\u043F\u0440\u0438\u0432\u043E\u0434 \u0434\u043B\u044F \u0441\u044A\u0451\u043C\u043A\u0438",
  "flavour.laboratory.3": "\u0434\u0430\u043B\u044C\u043D\u044F\u044F \u0441\u044A\u0451\u043C\u043A\u0430",
  "flavour.laboratory.4": "\u0431\u0435\u0437 \u043C\u0430\u043D\u0438\u0444\u0435\u0441\u0442\u0430",
  "flavour.military.0": "\u043F\u0430\u0442\u0440\u0443\u043B\u044C\u043D\u044B\u0439 \u043A\u0430\u0442\u0435\u0440",
  "flavour.military.1": "\u044D\u043A\u0440\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.military.2": "\u0432\u043E\u0435\u043D\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.military.3": "\u043F\u043E\u0433\u0440\u0430\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u0430\u0442\u0440\u0443\u043B\u044C",
  "flavour.military.4": "\u043F\u0440\u043E\u043F\u0430\u043B \u0441\u043E \u0432\u0441\u0435\u043C \u044D\u043A\u0438\u043F\u0430\u0436\u0435\u043C",
  "flavour.smuggler.0": "\u0431\u044B\u0441\u0442\u0440\u044B\u0439 \u0433\u0440\u0443\u0437\u043E\u0432\u0438\u043A",
  "flavour.smuggler.1": "\u0440\u0430\u0437\u043E\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.smuggler.2": "\u043A\u043E\u043D\u0442\u0440\u0430\u0431\u0430\u043D\u0434\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.smuggler.3": "\u0431\u0435\u0437 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438",
  "flavour.smuggler.4": "\u0442\u0440\u0438 \u043B\u043E\u0436\u043D\u044B\u0445 \u0442\u0440\u044E\u043C\u0430",
  "flavour.corsair.0": "\u0440\u0435\u0439\u0434\u0435\u0440",
  "flavour.corsair.1": "\u0444\u043E\u0440\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.corsair.2": "\u0430\u0431\u043E\u0440\u0434\u0430\u0436\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.corsair.3": "\u0432\u0437\u044F\u0442 \u043D\u0430 \u0430\u0431\u043E\u0440\u0434\u0430\u0436",
  "flavour.corsair.4": "\u043F\u0440\u0438\u0437\u043E\u0432\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043D\u0430 \u0431\u043E\u0440\u0442\u0443",
  "flavour.quarantine.0": "\u043C\u0435\u0434\u0438\u0446\u0438\u043D\u0441\u043A\u0438\u0439 \u0442\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442",
  "flavour.quarantine.1": "\u044D\u043A\u0440\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "flavour.quarantine.2": "\u043F\u0440\u0438\u0432\u043E\u0434 \u0434\u0430\u043B\u044C\u043D\u0435\u0433\u043E \u0445\u043E\u0434\u0430",
  "flavour.quarantine.3": "\u0437\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u043D \u0438\u0437\u043D\u0443\u0442\u0440\u0438",
  "flavour.quarantine.4": "\u0431\u0435\u0437 \u0441\u0438\u0433\u043D\u0430\u043B\u0430 \u0431\u0435\u0434\u0441\u0442\u0432\u0438\u044F",
  "flavour.fathers-tug.0": "\u0441\u043F\u0430\u0441\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0431\u0443\u043A\u0441\u0438\u0440",
  "flavour.fathers-tug.1": "\u0440\u0435\u0430\u043A\u0442\u043E\u0440 \u0434\u0435\u043B\u0435\u043D\u0438\u044F",
  "flavour.fathers-tug.2": "\u0438\u043E\u043D\u043D\u044B\u0439 \u043F\u0440\u0438\u0432\u043E\u0434",
  "flavour.fathers-tug.3": "\u043F\u043E\u0437\u044B\u0432\u043D\u043E\u0439 \u0442\u0432\u043E\u0435\u0433\u043E \u043E\u0442\u0446\u0430",
  "flavour.fathers-tug.4": "\u043F\u0440\u043E\u043F\u0430\u043B \u043E\u0434\u0438\u043D\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u043B\u0435\u0442 \u043D\u0430\u0437\u0430\u0434",
  // ------------------------------------------------------- системы корабля
  "system.engine": "\u041F\u0420\u0418\u0412\u041E\u0414",
  "system.core": "\u0420\u0415\u0410\u041A\u0422\u041E\u0420",
  "system.terminal": "\u0422\u0415\u0420\u041C\u0418\u041D\u0410\u041B",
  "system.short.engine": "\u043F\u0440\u0438\u0432",
  "system.short.core": "\u0440\u0435\u0430\u043A",
  "system.short.terminal": "\u0442\u0435\u0440\u043C",
  "thing.system.engine": "\u043F\u0440\u0438\u0432\u043E\u0434",
  "thing.system.core": "\u0440\u0435\u0430\u043A\u0442\u043E\u0440",
  "thing.system.terminal": "\u0442\u0435\u0440\u043C\u0438\u043D\u0430\u043B",
  "log.system.online.engine": "\u041F\u0420\u0418\u0412\u041E\u0414 \u0412 \u0421\u0415\u0422\u0418. \u041A\u043E\u0440\u0430\u0431\u043B\u044C \u044D\u0442\u043E \u0437\u0430\u043C\u0435\u0442\u0438\u043B.",
  "log.system.online.core": "\u0420\u0415\u0410\u041A\u0422\u041E\u0420 \u0412 \u0421\u0415\u0422\u0418. \u041A\u043E\u0440\u0430\u0431\u043B\u044C \u044D\u0442\u043E \u0437\u0430\u043C\u0435\u0442\u0438\u043B.",
  "log.system.online.terminal": "\u0422\u0415\u0420\u041C\u0418\u041D\u0410\u041B \u0412 \u0421\u0415\u0422\u0418. \u041A\u043E\u0440\u0430\u0431\u043B\u044C \u044D\u0442\u043E \u0437\u0430\u043C\u0435\u0442\u0438\u043B.",
  // ---------------------------------------------------------------- чартеры
  "charter.name.salvage": "\u0423\u0422\u0418\u041B\u042C",
  "charter.name.retrieve": "\u0414\u041E\u0421\u0422\u0410\u0412\u041A\u0410",
  "charter.name.upload": "\u041F\u0415\u0420\u0415\u0414\u0410\u0427\u0410",
  "charter.name.neutralize": "\u041F\u041E\u0414\u042A\u0401\u041C",
  "charter.salvage": "\u0423\u0422\u0418\u041B\u042C \xB7 \u043F\u0440\u0438\u0432\u0435\u0437\u0442\u0438 \u0434\u043E\u043C\u043E\u0439 {need} CR \u0443\u0442\u0438\u043B\u044F",
  "charter.retrieve": "\u0414\u041E\u0421\u0422\u0410\u0412\u041A\u0410 \xB7 \u0432\u044B\u043D\u0435\u0441\u0442\u0438 \u043C\u0435\u0447\u0435\u043D\u044B\u0439 \u044F\u0449\u0438\u043A, \u043E\u0442\u0441\u0435\u043A {room}",
  "charter.upload": "\u041F\u0415\u0420\u0415\u0414\u0410\u0427\u0410 \xB7 \u043F\u044F\u0442\u044C \u0445\u043E\u0434\u043E\u0432 \u0443 \u043A\u043E\u043D\u0441\u043E\u043B\u0438, \u043E\u0442\u0441\u0435\u043A {room}",
  "charter.neutralize": "\u041F\u041E\u0414\u042A\u0401\u041C \xB7 \u043F\u0440\u0438\u0432\u043E\u0434, \u0440\u0435\u0430\u043A\u0442\u043E\u0440 \u0438 \u0442\u0435\u0440\u043C\u0438\u043D\u0430\u043B \u0432 \u0441\u0435\u0442\u0438, \u043F\u043E\u0442\u043E\u043C \u043D\u0430 \u0432\u044B\u0445\u043E\u0434",
  // ------------------------------------------------- глаголы и состояния дверей
  "verb.go": "\u0438\u0434\u0442\u0438",
  "verb.leave": "\u0432\u044B\u0439\u0442\u0438",
  "verb.key": "\u043A\u0430\u0440\u0442\u0430",
  "verb.power": "\u0437\u0430\u0440\u044F\u0434",
  "verb.spike": "\u0432\u0441\u043A\u0440\u044B\u0442\u044C",
  "verb.cut": "\u0440\u0435\u0437\u0430\u0442\u044C",
  "verb.weld": "\u0432\u0430\u0440\u0438\u0442\u044C",
  "verb.close": "\u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  "verb.open": "\u043E\u0442\u043A\u0440\u044B\u0442\u044C",
  "cost.key": "1 \u0445\u043E\u0434, \u0442\u0438\u0445\u043E",
  "cost.power": "1 \u0445\u043E\u0434, \u0448\u0443\u043C 6",
  "cost.spike": "2 \u0445\u043E\u0434\u0430, \u0448\u0443\u043C 4",
  "cost.cut": "3 \u0445\u043E\u0434\u0430, \u0448\u0443\u043C 9",
  "state.open": "\u043E\u0442\u043A\u0440\u044B\u0442\u0430",
  "state.closed": "\u0437\u0430\u043A\u0440\u044B\u0442\u0430",
  "state.locked": "\u0437\u0430\u043F\u0435\u0440\u0442\u0430",
  "state.sealed": "\u0437\u0430\u0432\u0430\u0440\u0435\u043D\u0430",
  "state.broken": "\u0441\u043B\u043E\u043C\u0430\u043D\u0430",
  "state.airlock": "\u0448\u043B\u044E\u0437",
  "state.out": "\u043D\u0430\u0440\u0443\u0436\u0443",
  // ------------------------------------------------------------- мелкие слова
  "label.you": "\u0422\u044B",
  "label.other": "{name}",
  "label.something": "\u0427\u0442\u043E-\u0442\u043E",
  "word.a": "{name}",
  "word.or": "{first} \u0438\u043B\u0438 {last}",
  "word.bulkhead": "\u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0430 {door}",
  "word.cr": "{n} CR",
  "word.crate": "\u044F\u0449\u0438\u043A",
  "word.scrap": "\u043B\u043E\u043C",
  "word.vented": "\u043D\u0435\u0442 \u0432\u043E\u0437\u0434\u0443\u0445\u0430",
  "word.derelict": "\u0434\u0435\u0440\u0435\u043B\u0438\u043A\u0442",
  "word.keycard": "\u043A\u043B\u044E\u0447-\u043A\u0430\u0440\u0442\u0430",
  "word.module": "\u043C\u043E\u0434\u0443\u043B\u044C",
  "word.system": "\u0441\u0438\u0441\u0442\u0435\u043C\u0430",
  "word.theVoyage": "\u0440\u0435\u0439\u0441",
  "word.tug": "\u0411\u0423\u041A\u0421\u0418\u0420",
  "thing.partsCrate": "\u044F\u0449\u0438\u043A \u0441 \u0434\u0435\u0442\u0430\u043B\u044F\u043C\u0438",
  "thing.scrap": "\u043B\u043E\u043C",
  "thing.body.searched": "\u043E\u0431\u044B\u0441\u043A\u0430\u043D\u043D\u043E\u0435 \u0442\u0435\u043B\u043E",
  "thing.system": "\u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u043A\u043E\u0440\u0430\u0431\u043B\u044F",
  "thing.body": "\u0442\u0435\u043B\u043E \u043A\u043E\u0433\u043E-\u0442\u043E \u0438\u0437 \u044D\u043A\u0438\u043F\u0430\u0436\u0430",
  "thing.cargo": "\u0433\u0440\u0443\u0437\u043E\u0432\u043E\u0439 \u044F\u0449\u0438\u043A",
  "thing.contraband": "\u044F\u0449\u0438\u043A \u0441 \u043A\u043E\u043D\u0442\u0440\u0430\u0431\u0430\u043D\u0434\u043E\u0439",
  "thing.console": "\u043A\u043E\u043D\u0441\u043E\u043B\u044C",
  "thing.package": "\u0433\u0440\u0443\u0437 \u043F\u043E \u0447\u0430\u0440\u0442\u0435\u0440\u0443",
  // ------------------------------------------------------------------ журнал
  "log.opening": "\u0411\u0443\u043A\u0441\u0438\u0440 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D \u043A \u0447\u0435\u043C\u0443-\u0442\u043E \u0442\u0451\u043C\u043D\u043E\u043C\u0443, \u0438 \u043D\u0430 \u0441\u0442\u043E\u0439\u043A\u0435 \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u043E\u0434\u0438\u043D \u0434\u0440\u043E\u043D.",
  "log.win": "\u0428\u043B\u044E\u0437 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0437\u0430 \u0441\u043F\u0438\u043D\u043E\u0439. \u0411\u0443\u043A\u0441\u0438\u0440 \u0443\u0445\u043E\u0434\u0438\u0442 \u0441 \u0442\u0435\u043C, \u0447\u0442\u043E \u0442\u044B \u0432\u0437\u044F\u043B.",
  "log.death": "\u041F\u0440\u043E\u0431\u043E\u0439 \u044F\u0434\u0440\u0430. \u0414\u0440\u043E\u043D \u0433\u0430\u0441\u043D\u0435\u0442. \u041A\u043E\u0440\u0430\u0431\u043B\u044C \u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442 \u0441\u0435\u0431\u0435 \u0442\u043E, \u0447\u0442\u043E \u0437\u0430\u0431\u0440\u0430\u043B.",
  "log.hit.module": "{source}: \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435, {module} ({left}/{max}).",
  "log.hit.vent": "\u0412\u0415\u041D\u0422\u0418\u041B\u042F\u0426\u0418\u042F: \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435, {module} ({left}/{max}).",
  "log.hit.mine": "\u041C\u0418\u041D\u0410: \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435, {module} ({left}/{max}).",
  "log.machine.dies": "{target} \u0433\u0438\u0431\u043D\u0435\u0442.",
  "log.scrap.drop": "{machine} \u0440\u0430\u0441\u0441\u044B\u043F\u0430\u0435\u0442\u0441\u044F \u0432 \u043B\u043E\u043C: {module}.",
  "log.door.key": "\u0421\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u0435\u043B\u044C \u043C\u0438\u0433\u0430\u0435\u0442 \u0437\u0435\u043B\u0451\u043D\u044B\u043C. {door} \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F.",
  "log.door.power": "\u0420\u0430\u0437\u0440\u044F\u0434 \u0411\u0410\u0422\u0410\u0420\u0415\u0418: {door}. \u0417\u0430\u043C\u043E\u043A \u043E\u0442\u043F\u0443\u0441\u043A\u0430\u0435\u0442.",
  "log.door.cut.on": "\u0420\u0435\u0437 \u0438\u0434\u0451\u0442: {door}. \u0415\u0449\u0451 {left, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432}.",
  "log.door.cut.done": "{door} \u043F\u043E\u0434\u0434\u0430\u0451\u0442\u0441\u044F \u0441 \u0432\u0438\u0437\u0433\u043E\u043C.",
  "log.door.weld.on": "\u0412\u0435\u0434\u0451\u043C \u0441\u0432\u0430\u0440\u043A\u0443 \u043F\u043E \u0448\u0432\u0443: {door}.",
  "log.door.weld.done": "{door} \u0437\u0430\u0432\u0430\u0440\u0435\u043D\u0430. \u041D\u0430\u0441\u043E\u0432\u0441\u0435\u043C.",
  "log.door.close": "{door}: \u0437\u0430\u043A\u0440\u044B\u0442\u0430.",
  "log.spike.on": "{spike} \u0432 \u0440\u0430\u0431\u043E\u0442\u0435: {target}.",
  "log.spike.done": "{target}: \u043F\u0443\u0442\u044C \u043E\u0442\u043A\u0440\u044B\u0442.",
  "log.body.plain": "\u041E\u0431\u044B\u0441\u043A \u0442\u0435\u043B\u0430: {cr} CR.",
  "log.body.key": "\u041E\u0431\u044B\u0441\u043A \u0442\u0435\u043B\u0430: {cr} CR \u0438 \u043A\u043B\u044E\u0447-\u043A\u0430\u0440\u0442\u0430.",
  "log.crate.open": "\u042F\u0449\u0438\u043A \u0432\u0441\u043A\u0440\u044B\u0442 \u2014 {crate}: {cr} CR \u0432 \u0442\u0440\u044E\u043C.",
  "log.cargo.take": "\u041C\u0435\u0447\u0435\u043D\u044B\u0439 \u044F\u0449\u0438\u043A \u0441\u043D\u044F\u0442 \u0441\u043E \u0441\u0442\u0435\u043B\u043B\u0430\u0436\u0430.",
  "log.upload.on": "\u041A\u043E\u043D\u0441\u043E\u043B\u044C \u043E\u0442\u0434\u0430\u0451\u0442 \u043C\u0435\u0434\u043B\u0435\u043D\u043D\u043E. \u0415\u0449\u0451 {left, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432}.",
  "log.upload.done": "\u041F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 \u0437\u0430\u043A\u043E\u043D\u0447\u0435\u043D\u0430. \u0427\u0442\u043E \u0431\u044B \u044D\u0442\u043E \u043D\u0438 \u0431\u044B\u043B\u043E, \u043E\u043D\u043E \u0443 \u0431\u0443\u043A\u0441\u0438\u0440\u0430.",
  "log.console.away": "\u0422\u044B \u043E\u0442\u0445\u043E\u0434\u0438\u0448\u044C \u043E\u0442 \u043A\u043E\u043D\u0441\u043E\u043B\u0438. \u0412\u0441\u0451 \u0441\u043D\u0430\u0447\u0430\u043B\u0430.",
  "log.work.break.cut": "\u0420\u0435\u0437 \u0431\u0440\u043E\u0448\u0435\u043D.",
  "log.work.break.weld": "\u0421\u0432\u0430\u0440\u043A\u0430 \u0431\u0440\u043E\u0448\u0435\u043D\u0430.",
  "log.work.break.splice": "\u0421\u0440\u0430\u0449\u0438\u0432\u0430\u043D\u0438\u0435 \u0431\u0440\u043E\u0448\u0435\u043D\u043E.",
  "log.work.break.purge": "\u041F\u0440\u043E\u0436\u0438\u0433 \u0431\u0440\u043E\u0448\u0435\u043D.",
  "log.carry.take": "{module} {left}/{max} \u0441\u043D\u044F\u0442. \u041D\u0435\u0441\u0451\u0442 {n} \u0438\u0437 {limit}.",
  "log.carry.home": "\u0414\u043E\u043D\u0435\u0441\u0435\u043D\u043E: {n}. \u0412 \u0442\u0440\u044E\u043C.",
  "log.salvage.graft": "\u041D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u043D\u0438\u0435: {module} ({left}/{max}). \u041B\u0443\u0447\u0448\u0435 \u043D\u043E\u0432\u043E\u0433\u043E.",
  "log.salvage.mend": "\u041B\u043E\u043C \u0432 \u0434\u0435\u043B\u043E: {module} ({left}/{max}).",
  "log.salvage.install": "\u0418\u0437 \u043E\u0431\u043B\u043E\u043C\u043A\u043E\u0432: {module} ({left}/{max}).",
  "log.weld": "\u0421\u0432\u0430\u0440\u043A\u0430: {module} \u0434\u043E {left}/{max}.",
  "log.pulse": "\u0418\u043C\u043F\u0443\u043B\u044C\u0441 \u0441\u043A\u0430\u043D\u0435\u0440\u0430. \u0414\u0432\u0435 \u0434\u0432\u0435\u0440\u0438 \u043A\u043E\u0440\u0430\u0431\u043B\u044F \u043B\u0435\u0433\u043B\u0438 \u043D\u0430 \u0441\u0445\u0435\u043C\u0443.",
  "log.emp": "\u0420\u0430\u0437\u0440\u044F\u0434 \u043A\u0430\u0442\u0443\u0448\u043A\u0438: {n, one: # \u043C\u0430\u0448\u0438\u043D\u0430 \u0437\u0430\u043C\u0435\u0440\u043B\u0430, few: # \u043C\u0430\u0448\u0438\u043D\u044B \u0437\u0430\u043C\u0435\u0440\u043B\u0438, many: # \u043C\u0430\u0448\u0438\u043D \u0437\u0430\u043C\u0435\u0440\u043B\u043E}. \u0417\u0430\u0440\u044F\u0434: {left}.",
  "log.shock": "{module}: \u0434\u0443\u0433\u0430. {n, one: # \u043C\u0430\u0448\u0438\u043D\u0430 \u0437\u0430\u043C\u0435\u0440\u043B\u0430, few: # \u043C\u0430\u0448\u0438\u043D\u044B \u0437\u0430\u043C\u0435\u0440\u043B\u0438, many: # \u043C\u0430\u0448\u0438\u043D \u0437\u0430\u043C\u0435\u0440\u043B\u043E}. \u0417\u0430\u0440\u044F\u0434: {left}.",
  "log.swap.carried": "{module} \u0432 \u0441\u0442\u043E\u0439\u043A\u0435, {old} \u0441\u043D\u044F\u0442 \u2014 \u043D\u0435\u0441\u0451\u0448\u044C \u0441 \u0441\u043E\u0431\u043E\u0439.",
  "log.swap.dropped": "{module} \u0432 \u0441\u0442\u043E\u0439\u043A\u0435. \u0420\u0443\u043A\u0438 \u0437\u0430\u043D\u044F\u0442\u044B: {old} \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C.",
  "log.relic.take": "\u0420\u0435\u043B\u0438\u043A\u0432\u0438\u044F: {module}. \u0412\u0435\u0440\u0441\u0442\u0430\u043A \u0435\u0451 \u043D\u0435 \u0447\u0438\u043D\u0438\u0442, \u0434\u043E\u043A \u043D\u0435 \u043F\u0440\u043E\u0434\u0430\u0451\u0442.",
  "log.relic.seen": "\u0418\u043C\u043F\u0443\u043B\u044C\u0441 \u0432\u0438\u0434\u0438\u0442 \u043E\u043F\u0435\u0447\u0430\u0442\u0430\u043D\u043D\u044B\u0439 \u044F\u0449\u0438\u043A: {room}. \u041D\u0430\u0434 \u043D\u0438\u043C \u043A\u0442\u043E-\u0442\u043E \u0441\u0442\u043E\u0438\u0442.",
  "log.emitter.hit": "{emitter}: \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435, {target}, \u0443\u0440\u043E\u043D {n} ({hp}/{max}).",
  "log.system.work": "{tool} \u2192 {system}. \u0415\u0449\u0451 {left, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432}.",
  "log.system.advance": "\u0427\u0430\u0440\u0442\u0435\u0440 \u043F\u043B\u0430\u0442\u0438\u0442 \u0430\u0432\u0430\u043D\u0441:",
  "log.system.all": "\u0412\u0441\u0435 \u0442\u0440\u0438 \u0432 \u0441\u0435\u0442\u0438. \u0416\u043C\u0438 `<` \u2014 \u043D\u0430 \u0432\u044B\u0445\u043E\u0434 \u0447\u0435\u0440\u0435\u0437 \u0448\u043B\u044E\u0437, \u0438 \u043A\u043E\u0440\u043F\u0443\u0441 \u0442\u0432\u043E\u0439.",
  "log.system.all.paid": "\u0412\u0441\u0435 \u0442\u0440\u0438 \u0432 \u0441\u0435\u0442\u0438. \u0416\u043C\u0438 `<` \u2014 \u043D\u0430 \u0432\u044B\u0445\u043E\u0434 \u0447\u0435\u0440\u0435\u0437 \u0448\u043B\u044E\u0437, \u0438 \u043A\u043E\u0440\u043F\u0443\u0441 \u0442\u0432\u043E\u0439: +{cr} CR.",
  "log.alert.hunter": "{hunter} \u043F\u0440\u043E\u0441\u044B\u043F\u0430\u0435\u0442\u0441\u044F: {room}.",
  "log.alert.busy": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u043D\u0435 \u0441\u0438\u0434\u0435\u043B \u0431\u0435\u0437 \u0434\u0435\u043B\u0430: \u0435\u0449\u0451 {n, one: # \u043C\u0430\u0448\u0438\u043D\u0430, few: # \u043C\u0430\u0448\u0438\u043D\u044B, many: # \u043C\u0430\u0448\u0438\u043D} \u043D\u0430 \u0431\u043E\u0440\u0442\u0443.",
  "log.alert.calm": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u0451\u0442 \u0442\u0435\u0431\u044F \u0438\u0441\u043A\u0430\u0442\u044C.",
  "log.alert.up": "\u0422\u0440\u0435\u0432\u043E\u0433\u0430: {stage}.",
  "log.alert.wake": "\u0427\u0442\u043E-\u0442\u043E \u043F\u0440\u043E\u0441\u044B\u043F\u0430\u0435\u0442\u0441\u044F: {room}.",
  "log.alert.door": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0437\u0430 \u0442\u043E\u0431\u043E\u0439 {door}.",
  "log.alert.lock": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0437\u0430\u043F\u0438\u0440\u0430\u0435\u0442 \u0437\u0430 \u0442\u043E\u0431\u043E\u0439 {door}.",
  "log.alert.scuttle": "\u041F\u041E\u0414\u0420\u042B\u0412: \u0447\u0435\u0440\u0435\u0437 {n, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432} \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u043D\u0430\u0447\u043D\u0451\u0442 \u0441\u0442\u0440\u0430\u0432\u043B\u0438\u0432\u0430\u0442\u044C \u0441\u0432\u043E\u0438 \u043E\u0442\u0441\u0435\u043A\u0438.",
  "log.alert.vent": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0441\u0442\u0440\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442 {room}. \u0412\u0441\u0451, \u0447\u0442\u043E \u0442\u0430\u043C \u0431\u044B\u043B\u043E, \u0443\u0448\u043B\u043E \u0432 \u043F\u0443\u0441\u0442\u043E\u0442\u0443.",
  "log.alert.vacuum": "\u0412 {room} \u043D\u0435\u0442 \u0432\u043E\u0437\u0434\u0443\u0445\u0430: \u0432\u0430\u043A\u0443\u0443\u043C \u0441\u043D\u0438\u043C\u0430\u0435\u0442 {n} \u0441 \u044F\u0434\u0440\u0430.",
  "log.alert.down": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u043E\u0431\u0435\u0437\u0432\u0440\u0435\u0436\u0435\u043D: \u0442\u0440\u0435\u0432\u043E\u0433\u0430 \u0441\u043D\u044F\u0442\u0430, \u043E\u043D \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442.",
  "alert.noticed": "\u0417\u0410\u041C\u0415\u0427\u0415\u041D",
  "alert.searching": "\u041F\u041E\u0418\u0421\u041A",
  "alert.hunting": "\u041E\u0425\u041E\u0422\u0410",
  "alert.hunter": "\u041A\u0410\u0420\u0410\u0422\u0415\u041B\u042C",
  "alert.scuttle": "\u041F\u041E\u0414\u0420\u042B\u0412",
  "log.bloom.hatch": "\u041A\u043E\u043A\u043E\u043D \u043B\u043E\u043F\u0430\u0435\u0442\u0441\u044F. \u041E\u0442\u0442\u0443\u0434\u0430 \u0447\u0442\u043E-\u0442\u043E \u0432\u044B\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F.",
  "log.bloom.strip": "\u041A\u043E\u043A\u043E\u043D \u0432\u0441\u043A\u0440\u044B\u0442: {cr} CR \u0431\u0438\u043E\u043C\u0430\u0441\u0441\u044B, \u0438 \u043D\u0438 \u043E\u0434\u043D\u043E\u0439 \u0434\u0435\u0442\u0430\u043B\u0438.",
  "log.bloom.dies": "\u041A\u043E\u043A\u043E\u043D \u043E\u0441\u0435\u0434\u0430\u0435\u0442. \u0411\u0438\u043E\u043C\u0430\u0441\u0441\u0430, \u0434\u0435\u0442\u0430\u043B\u0435\u0439 \u043D\u0435\u0442.",
  "log.ghost.sighted": "\u0422\u0430\u043C \u0434\u0432\u0438\u0436\u0435\u0442\u0441\u044F \u0447\u0442\u043E-\u0442\u043E \u0441 \u0442\u0432\u043E\u0438\u043C \u043F\u043E\u0437\u044B\u0432\u043D\u044B\u043C.",
  "log.ghost.drop": "\u041F\u0440\u0438\u0437\u0440\u0430\u043A \u0440\u0430\u0437\u0432\u0430\u043B\u0438\u0432\u0430\u0435\u0442\u0441\u044F. \u0422\u0432\u043E\u044F \u0441\u0442\u0430\u0440\u0430\u044F \u0441\u0442\u043E\u0439\u043A\u0430 \u043D\u0430 \u043F\u043E\u043B\u0443.",
  "log.rival.aboard": "\u041D\u0430 \u0431\u043E\u0440\u0442\u0443 \u0447\u0443\u0436\u043E\u0439 \u0434\u0440\u043E\u043D. \u041E\u043D \u0437\u0434\u0435\u0441\u044C \u043D\u0435 \u0437\u0430 \u0443\u0442\u0438\u043B\u0435\u043C.",
  "log.rival.gone": "\u0427\u0443\u0436\u043E\u0439 \u0441\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0438 \u0443\u0445\u043E\u0434\u0438\u0442 \u043A \u0441\u0432\u043E\u0435\u043C\u0443 \u0448\u043B\u044E\u0437\u0443.",
  "log.hull.taken": "\xAB{hull}\xBB \u0443\u0436\u0435 \u043D\u0430 \u0447\u0443\u0436\u043E\u043C \u0442\u0440\u043E\u0441\u0435. \u0422\u0440\u0438 \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u043F\u043E\u0434\u043D\u044F\u0442\u044B \u0437\u0440\u044F.",
  "log.rival.lost": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0437\u0430\u0431\u0440\u0430\u043B \u0434\u0440\u0443\u0433\u043E\u0439 \u0431\u0443\u043A\u0441\u0438\u0440. \u0423 \u0442\u0435\u0431\u044F \u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044C \u0445\u043E\u0434\u043E\u0432.",
  "log.rival.jumped": "\u0411\u0443\u043A\u0441\u0438\u0440 \u0447\u0443\u0436\u043E\u0433\u043E \u043F\u0440\u044B\u0433\u0430\u0435\u0442 \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043A\u043E\u0440\u0430\u0431\u043B\u0451\u043C. \u0422\u0432\u043E\u0439 \u0434\u0440\u043E\u043D \u0443\u0445\u043E\u0434\u0438\u0442 \u0441 \u043D\u0438\u043C.",
  "log.rival.system": "\u0427\u0443\u0436\u043E\u0439 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442: {system}.",
  "log.rival.drops": "\u0427\u0443\u0436\u043E\u0439 \u0441\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u0442: {module}.",
  // Торг (G34). Все его строки живут здесь, рядом с остальной речью чужого.
  "action.rival.payoff": "\u043E\u0442\u043A\u0443\u043F\u0438\u0442\u044C\u0441\u044F ({price} CR)",
  "action.rival.aside": "\u0443\u0439\u0442\u0438: \u0447\u0443\u0436\u043E\u0439 \u043F\u043B\u0430\u0442\u0438\u0442 {price} CR",
  "action.rival.split": "\u043E\u0442\u0434\u0430\u0442\u044C \u0447\u0443\u0436\u043E\u043C\u0443 \u043F\u043E\u043B\u043F\u0440\u043E\u0434\u0430\u0436\u0438",
  "why.rival.spent": "\u0415\u043C\u0443 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0447\u0435\u0433\u043E \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0442\u044C.",
  "why.rival.notHere": "\u0427\u0443\u0436\u043E\u0433\u043E \u043D\u0435\u0442 \u0432 \u044D\u0442\u043E\u043C \u043E\u0442\u0441\u0435\u043A\u0435.",
  "why.rival.dealt": "\u0421\u0434\u0435\u043B\u043A\u0430 \u043F\u043E \u044D\u0442\u043E\u043C\u0443 \u043A\u043E\u0440\u043F\u0443\u0441\u0443 \u0443\u0436\u0435 \u0437\u0430\u043A\u043B\u044E\u0447\u0435\u043D\u0430.",
  "log.rival.deal.paid": "\u0427\u0443\u0436\u043E\u0439 \u0431\u0435\u0440\u0451\u0442 \u043A\u0440\u0435\u0434\u0438\u0442\u044B \u0438 \u0443\u0445\u043E\u0434\u0438\u0442. \u0414\u043E\u0431\u044B\u0447\u0430 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F.",
  "log.rival.deal.sold": "\u0427\u0443\u0436\u043E\u0439 \u043F\u043B\u0430\u0442\u0438\u0442 \u0437\u0430 \u043F\u0440\u0430\u0432\u043E \u043F\u0440\u043E\u0445\u043E\u0434\u0430:",
  "log.rival.deal.split": "\u0423\u0434\u0430\u0440\u0438\u043B\u0438 \u043F\u043E \u0440\u0443\u043A\u0430\u043C: \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043A\u043E\u0440\u043F\u0443\u0441\u0430. \u041E\u043D \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0441 \u0442\u043E\u0431\u043E\u0439.",
  "log.rival.raises": "\u0427\u0443\u0436\u043E\u0439 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442 \u0437\u0430 \u0442\u0435\u0431\u044F: {system}.",
  "panel.deal": "\u0421\u0414\u0415\u041B\u041A\u0410 {deal}",
  "word.deal.paid": "\u043E\u0442\u043A\u0443\u043F",
  "word.deal.sold": "\u043E\u0442\u0445\u043E\u0434",
  "word.deal.split": "\u043F\u043E\u043F\u043E\u043B\u0430\u043C",
  "log.virus.caught": "\u0412 \u043B\u043E\u043C\u0435 \u0447\u0442\u043E-\u0442\u043E \u0431\u044B\u043B\u043E. {virus} \u0432 {module}.",
  "log.virus.rot": "{virus} \u0433\u0440\u044B\u0437\u0451\u0442 {module}: \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C {left}.",
  "log.virus.rot.burned": "{virus} \u0434\u043E\u0433\u0440\u044B\u0437 {module}. \u041C\u043E\u0434\u0443\u043B\u044F \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0442.",
  "log.virus.skim": "{virus} \u0441\u043D\u0438\u043C\u0430\u0435\u0442 \u0441\u043E \u0441\u0447\u0451\u0442\u0430 {amount} CR.",
  "log.virus.skim.empty": "{virus} \u0448\u0430\u0440\u0438\u0442 \u043F\u043E \u0441\u0447\u0451\u0442\u0443. \u0411\u0440\u0430\u0442\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "log.virus.core": "{virus} \u0434\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F \u0434\u043E \u044F\u0434\u0440\u0430. \u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C {left}.",
  "log.virus.twitch": "{module}: \u0441\u0443\u0434\u043E\u0440\u043E\u0433\u0430. {virus} \u0432\u044B\u0431\u0440\u0430\u043B, \u043A\u0443\u0434\u0430 \u043F\u0440\u0438\u0434\u0451\u0442 \u0443\u0434\u0430\u0440.",
  "log.virus.moves": "\u0412\u0438\u0440\u0443\u0441 \u0443\u0445\u043E\u0434\u0438\u0442: {from} \u2192 {to}.",
  "log.virus.purge.on": "\u041F\u0440\u043E\u0436\u0438\u0433: {module}.",
  "log.virus.purge.done": "\u0427\u0438\u0441\u0442\u043A\u0430 \u0443\u0434\u0430\u043B\u0430\u0441\u044C. {module}: \u0447\u0438\u0441\u0442\u043E.",
  "log.virus.burned": "\u0412\u0438\u0440\u0443\u0441 \u0443\u0448\u0451\u043B \u0432\u043C\u0435\u0441\u0442\u0435 \u0441\u043E \u0441\u0433\u043E\u0440\u0435\u0432\u0448\u0438\u043C \u043C\u043E\u0434\u0443\u043B\u0435\u043C.",
  "log.helm.board": "\u0414\u043E\u0441\u043A\u0430 \u0447\u0430\u0440\u0442\u0435\u0440\u043E\u0432: {flavour}.",
  "log.charter.signed": "\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u043E: {charter}.",
  "log.charter.filled": "\u0427\u0430\u0440\u0442\u0435\u0440 {charter}:",
  "log.charter.missed.salvage": "{charter} \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D: {have} \u0438\u0437 {need} CR \u0443\u0442\u0438\u043B\u044F.",
  "log.charter.missed.retrieve": "{charter} \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430: \u044F\u0449\u0438\u043A \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u043D\u0430 \u0431\u043E\u0440\u0442\u0443.",
  "log.charter.missed.upload": "{charter} \u043D\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430: \u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 \u0441 \u043A\u043E\u043D\u0441\u043E\u043B\u0438 \u043D\u0435 \u0437\u0430\u043A\u043E\u043D\u0447\u0435\u043D\u0430.",
  "log.credit": "{why} +{amount} CR. \u0412\u0441\u0435\u0433\u043E {total} CR.",
  "log.hull.bought": "{hull} \u0441\u0445\u043E\u0434\u0438\u0442 \u0441\u043E \u0441\u0442\u0430\u043F\u0435\u043B\u044F: {trait}. \u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C {credits} CR.",
  "log.hull.tow": "{hull} \u0443\u0445\u043E\u0434\u0438\u0442 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435:",
  "log.hull.tow.split": "{hull} \u0443\u0445\u043E\u0434\u0438\u0442 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435, \u043F\u0440\u043E\u0434\u0430\u0436\u0430 \u043F\u043E\u043F\u043E\u043B\u0430\u043C:",
  "log.hold.emptied": "\u0422\u0440\u044E\u043C \u0440\u0430\u0437\u0433\u0440\u0443\u0436\u0435\u043D:",
  "log.hold.sell": "\u041F\u0440\u043E\u0434\u0430\u043D\u043E \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C \u2014 {module}:",
  "log.hold.sell.sick": "\u041F\u0440\u043E\u0434\u0430\u043D\u043E \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C \u2014 {module} (\u0437\u0430\u0440\u0430\u0436\u0435\u043D\u0438\u0435):",
  "log.hold.fit": "{module} ({integrity}) \u2014 \u0432 \u0441\u043B\u043E\u0442 {slot}.",
  "log.bench.repair": "\u0421\u0442\u0435\u043D\u0434: {module} \u0434\u043E {left}/{max}.",
  "log.bench.graft": "\u0421\u0442\u0435\u043D\u0434, \u043D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u043D\u0438\u0435: {module} {left}/{max}.",
  "log.bench.clean": "\u0421\u0442\u0435\u043D\u0434 \u0432\u044B\u0436\u0438\u0433\u0430\u0435\u0442 \u0432\u0438\u0440\u0443\u0441: {module}.",
  "log.jump": "\u0411\u0443\u043A\u0441\u0438\u0440 \u0438\u0434\u0451\u0442 \u0434\u0430\u043B\u044C\u0448\u0435: {hull}. \u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C {credits} CR.",
  "log.jump.warn": "{hull}: {up} \u0438\u0437 {of} \u0441\u0438\u0441\u0442\u0435\u043C \u0432 \u0441\u0435\u0442\u0438. \u041F\u0440\u044B\u0436\u043E\u043A \u0431\u0440\u043E\u0441\u0430\u0435\u0442 \u043A\u043E\u0440\u043F\u0443\u0441.",
  "log.jump.left": "\u0411\u0440\u043E\u0441\u0430\u0435\u0448\u044C: {charters}.",
  "log.voyage.undock": "\u0417\u0430\u0445\u0432\u0430\u0442\u044B \u043E\u0442\u043F\u0443\u0449\u0435\u043D\u044B.",
  "log.voyage.home": "\u0428\u043B\u044E\u0437 \u043E\u0442\u0440\u0430\u0431\u043E\u0442\u0430\u043B. \u0411\u0443\u043A\u0441\u0438\u0440 \u0436\u0434\u0451\u0442, \u0430 \u0434\u0435\u0440\u0435\u043B\u0438\u043A\u0442 \u0432\u0441\u0451 \u0435\u0449\u0451 \u0434\u044B\u0448\u0438\u0442.",
  "log.voyage.won": "\u0411\u0443\u043A\u0441\u0438\u0440 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u043D\u0430 \u043F\u043E\u0437\u044B\u0432\u043D\u043E\u0439 \u0442\u0432\u043E\u0435\u0433\u043E \u043E\u0442\u0446\u0430. \u0422\u044B \u0443\u0432\u043E\u0434\u0438\u0448\u044C \u0435\u0433\u043E \u0434\u043E\u043C\u043E\u0439. \u041F\u043E\u0431\u0435\u0434\u0430.",
  "log.voyage.broke": "\u0421\u0442\u043E\u0439\u043A\u0430 \u043F\u0443\u0441\u0442\u0430, \u0438 \u0441\u0447\u0451\u0442 \u0442\u043E\u0436\u0435. \u0420\u0435\u0439\u0441 \u043E\u043A\u043E\u043D\u0447\u0435\u043D.",
  "log.drone.lost": "\u0414\u0440\u043E\u043D \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043B \u043E\u0442\u0432\u0435\u0447\u0430\u0442\u044C. \u0412\u0441\u0451, \u0447\u0442\u043E \u043E\u043D \u043D\u0451\u0441, \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u043D\u0430 \u0434\u0435\u0440\u0435\u043B\u0438\u043A\u0442\u0435.",
  // ---------------------------------------------------------------- подсказки
  "hint.exposure": "\u0423\u0434\u0430\u0440 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u043F\u043E \u0442\u043E\u043C\u0443, \u0447\u0442\u043E \u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043B.",
  "hint.burned": "\u0421\u0433\u043E\u0440\u0435\u0432\u0448\u0438\u0439 \u043C\u043E\u0434\u0443\u043B\u044C \u043D\u0435 \u0432\u0435\u0440\u043D\u0443\u0442\u044C. \u0415\u0433\u043E \u0441\u043B\u043E\u0442 \u0442\u0435\u043F\u0435\u0440\u044C \u043F\u0443\u0441\u0442.",
  "hint.scrap": "\u041B\u043E\u043C. \u0420\u0430\u0437\u0431\u0435\u0440\u0438 \u0435\u0433\u043E \u043D\u0430 \u043C\u043E\u0434\u0443\u043B\u044C \u0438\u043B\u0438 \u043D\u0430\u0440\u0430\u0441\u0442\u0438 \u0438\u043C \u0442\u043E\u0442, \u0447\u0442\u043E \u0443\u0436\u0435 \u0441\u0442\u043E\u0438\u0442.",
  "hint.blind": "\u0411\u0435\u0437 \u0441\u043A\u0430\u043D\u0435\u0440\u0430 \u0432\u0438\u0434\u0435\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u044D\u0442\u043E\u0442 \u043E\u0442\u0441\u0435\u043A. \u041D\u0430\u0439\u0434\u0438 \u0441\u043A\u0430\u043D\u0435\u0440.",
  "hint.keycard": "\u041A\u043B\u044E\u0447-\u043A\u0430\u0440\u0442\u0430. \u0414\u0432\u0435\u0440\u0438 \u0441 \u043C\u0435\u0442\u043A\u043E\u0439 [ ] \u0435\u0451 \u0447\u0438\u0442\u0430\u044E\u0442.",
  "hint.death": "\u0422\u0432\u043E\u0439 \u0434\u0440\u043E\u043D \u0432\u0441\u0451 \u0435\u0449\u0451 \u0442\u0430\u043C. \u0414\u0440\u0443\u0436\u0435\u043B\u044E\u0431\u043D\u044B\u043C \u043E\u043D \u043D\u0435 \u0431\u0443\u0434\u0435\u0442.",
  "hint.objective": "\u041E\u0434\u043D\u0430 \u0438\u0437 \u0442\u0440\u0451\u0445 \u0441\u0438\u0441\u0442\u0435\u043C \u043A\u043E\u0440\u0430\u0431\u043B\u044F. \u041F\u043E\u0434\u043D\u0438\u043C\u0438 \u0432\u0441\u0435 \u0442\u0440\u0438 \u0438 \u0443\u0439\u0434\u0438 \u0436\u0438\u0432\u044B\u043C \u2014 \u0431\u0443\u043A\u0441\u0438\u0440 \u043F\u0440\u043E\u0434\u0430\u0441\u0442 \u043A\u043E\u0440\u043F\u0443\u0441 \u0446\u0435\u043B\u0438\u043A\u043E\u043C.",
  "hint.payout": "\u041F\u043B\u0430\u0442\u044F\u0442, \u0442\u043E\u043B\u044C\u043A\u043E \u043A\u043E\u0433\u0434\u0430 \u0434\u0440\u043E\u043D \u0432\u0435\u0440\u043D\u0443\u043B\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0448\u043B\u044E\u0437. \u041F\u043E\u0433\u0438\u0431 \u0437\u0434\u0435\u0441\u044C \u2014 \u0442\u0440\u044E\u043C \u043F\u0440\u043E\u043F\u0430\u043B \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043D\u0438\u043C.",
  "hint.mouse": "\u041C\u044B\u0448\u044C \u0442\u043E\u0436\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442: \u043A\u043B\u0438\u043A \u043F\u043E \u0441\u0442\u0440\u043E\u043A\u0435 \u0441\u043F\u0438\u0441\u043A\u0430 \u0438\u043B\u0438 \u043F\u043E \u043E\u0442\u0441\u0435\u043A\u0443 \u043D\u0430 \u0441\u0445\u0435\u043C\u0435.",
  "hint.sold": "\u0422\u0440\u044E\u043C \u043F\u0440\u043E\u0434\u0430\u043D \u0437\u0430 {credits} CR. \u041A\u043E\u0440\u043F\u0443\u0441 \u0441\u0442\u043E\u0438\u0442 {hullPrice}.",
  "hint.shooting": "\u0421\u0442\u0440\u0435\u043B\u044F\u0435\u0448\u044C \u2014 \u043F\u043E\u0434\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0448\u044C \u0442\u043E, \u0447\u0435\u043C \u0441\u0442\u0440\u0435\u043B\u044F\u0435\u0448\u044C: \u043E\u0442\u0432\u0435\u0442 \u043F\u0440\u0438\u0434\u0451\u0442 \u0432 \u042D\u041C\u0418\u0422\u0422\u0415\u0420, \u0441\u0430\u043C\u044B\u0439 \u0445\u0440\u0443\u043F\u043A\u0438\u0439 \u0432 \u0441\u0442\u043E\u0439\u043A\u0435.",
  "hint.sell": "\u041F\u0440\u043E\u0434\u0430\u043D\u043E \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C: \u043C\u043E\u0434\u0443\u043B\u0438 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u043E\u0431\u0440\u0430\u0442\u043D\u043E. \u0427\u0442\u043E\u0431\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u2014 \u0441\u043D\u0438\u043C\u0430\u0439 \u0432 \u0442\u0440\u044E\u043C.",
  "hint.training": "\u041E\u0411\u0423\u0427\u0415\u041D\u0418\u0415. \u041F\u0435\u0440\u0432\u044B\u0439 \u043A\u043E\u0440\u043F\u0443\u0441 \u0440\u0435\u0439\u0441\u0430 \u0441\u043E\u0431\u0440\u0430\u043D \u0434\u043B\u044F \u0443\u0447\u0451\u0431\u044B. \u0418\u0433\u0440\u0430 \u0441\u043A\u0430\u0436\u0435\u0442 \u0441\u0435\u043C\u044C \u0432\u0435\u0449\u0435\u0439, \u043F\u043E \u043E\u0434\u043D\u043E\u0439 \u0437\u0430 \u0440\u0430\u0437.",
  "hint.tutorial.enter": "\u0423\u0427\u0415\u0411\u041D\u042B\u0419 \u041A\u041E\u0420\u041F\u0423\u0421. \u041C\u0430\u043B\u0435\u043D\u044C\u043A\u0438\u0439 \u0438 \u0442\u0438\u0445\u0438\u0439: \u0437\u0430\u0431\u0435\u0433 \u043D\u0430 \u043D\u0451\u043C \u043D\u0435 \u043A\u043E\u043D\u0447\u0438\u0448\u044C. \u0412\u0441\u0451, \u0447\u0442\u043E \u0443\u043C\u0435\u0435\u0442 \u0434\u0440\u043E\u043D, \u2014 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435.",
  "hint.tutorial.scan": "\u041D\u0430\u0436\u043C\u0438 s \u2014 \u0438\u043C\u043F\u0443\u043B\u044C\u0441 \u0421\u041A\u0410\u041D\u0415\u0420\u0410: \u043E\u043D \u0447\u0438\u0442\u0430\u0435\u0442 \u043E\u0442\u0441\u0435\u043A\u0438 \u0437\u0430 \u0434\u0432\u0435\u0440\u044F\u043C\u0438 \u0434\u043E \u0442\u043E\u0433\u043E, \u043A\u0430\u043A \u0442\u044B \u0442\u0443\u0434\u0430 \u0432\u043E\u0439\u0434\u0451\u0448\u044C.",
  "hint.tutorial.contact": "\u041C\u0430\u0448\u0438\u043D\u0430. \u0410\u0442\u0430\u043A\u0430 \u2014 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0438\u0437 \u0441\u043F\u0438\u0441\u043A\u0430, \u0443\u0445\u043E\u0434 \u2014 \u0442\u043E\u0436\u0435: \u0441 \u043A\u043E\u0440\u0430\u0431\u043B\u044F \u0437\u0430 \u0442\u043E\u0431\u043E\u0439 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u043F\u043E\u0439\u0434\u0451\u0442.",
  "hint.tutorial.door": "\u0417\u0430\u043F\u0435\u0440\u0442\u0430\u044F \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0430. \u041A\u043B\u044E\u0447-\u043A\u0430\u0440\u0442\u0430 \u043D\u0430 \u0442\u0435\u043B\u0435 \u043F\u043E \u044D\u0442\u0443 \u0441\u0442\u043E\u0440\u043E\u043D\u0443: \u043E\u0431\u044B\u0449\u0438 \u043C\u0451\u0440\u0442\u0432\u044B\u0445 \u0438\u043B\u0438 \u0440\u0435\u0436\u044C \u0434\u0432\u0435\u0440\u044C.",
  "hint.tutorial.system": "\u041F\u043E\u0434\u043D\u044F\u0442\u044C \u0441\u0438\u0441\u0442\u0435\u043C\u0443 \u2014 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0445\u043E\u0434\u043E\u0432 \u043F\u043E\u0434\u0440\u044F\u0434 \u0438 \u0448\u0443\u043C. \u0412\u0441\u0451, \u0447\u0442\u043E \u0435\u0449\u0451 \u043D\u0430 \u0431\u043E\u0440\u0442\u0443, \u044D\u0442\u043E \u0441\u043B\u044B\u0448\u0438\u0442.",
  "hint.tutorial.airlock": "\u0428\u043B\u044E\u0437. \u0412\u044B\u0439\u0434\u0435\u0448\u044C \u2014 \u0442\u043E, \u0447\u0442\u043E \u043D\u0435\u0441\u0451\u0442 \u0434\u0440\u043E\u043D, \u043B\u044F\u0436\u0435\u0442 \u043D\u0430 \u0441\u0447\u0451\u0442, \u0430 \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F \u0442\u0430\u043A\u0438\u043C, \u043A\u0430\u043A \u0435\u0441\u0442\u044C.",
  "hint.tutorial.sale": "\u041D\u0430 \u044D\u0442\u043E\u043C \u0443\u0440\u043E\u043A \u043A\u043E\u043D\u0447\u0430\u0435\u0442\u0441\u044F. \u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043A\u043E\u0440\u043F\u0443\u0441 \u043D\u0435 \u0443\u0447\u0435\u0431\u043D\u044B\u0439: \u043F\u0440\u044B\u0433\u0430\u0439, \u043A\u043E\u0433\u0434\u0430 \u043D\u0430 \u0441\u0447\u0435\u0442\u0443 \u0445\u0432\u0430\u0442\u0438\u0442 \u043D\u0430 \u0434\u0440\u043E\u043D\u0430.",
  "hint.virus": "\u0421 \u0443\u0442\u0438\u043B\u0435\u043C \u043C\u043E\u0436\u043D\u043E \u0437\u0430\u043D\u0435\u0441\u0442\u0438 \u043A\u043E\u0440\u0430\u0431\u0435\u043B\u044C\u043D\u044B\u0439 \u0432\u0438\u0440\u0443\u0441. \u0423 \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u043A\u043E\u0440\u043F\u0443\u0441\u0430 \u0441\u0432\u043E\u0438. \u0421\u0432\u0430\u0440\u043A\u0430 \u0447\u0438\u0441\u0442\u0438\u0442 \u043B\u044E\u0431\u043E\u0439.",
  "strain.spasm": "\u0421\u0423\u0414\u041E\u0420\u041E\u0413\u0410",
  "strain.rot": "\u0413\u041D\u0418\u041B\u042C",
  "strain.leech": "\u041F\u0418\u042F\u0412\u041A\u0410",
  "strain.leash": "\u041F\u041E\u0412\u041E\u0414\u041E\u041A",
  // ------------------------------------------------------------------- отказы
  "why.credits": "\u041A\u0440\u0435\u0434\u0438\u0442\u043E\u0432 \u043D\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442.",
  "why.line.none": "\u041D\u0430 \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435\u0442.",
  "why.notHere": "\u041E\u0442\u0441\u044E\u0434\u0430 \u043D\u0435\u043B\u044C\u0437\u044F.",
  "why.jammed": "\u041F\u043E\u043C\u0435\u0445\u0438. \u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043E\u0442\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F.",
  "why.door.notHere": "\u0412 \u044D\u0442\u043E\u043C \u043E\u0442\u0441\u0435\u043A\u0435 \u0442\u0430\u043A\u043E\u0439 \u0434\u0432\u0435\u0440\u0438 \u043D\u0435\u0442.",
  "why.door.notLocked": "{door} \u043D\u0435 \u0437\u0430\u043F\u0435\u0440\u0442\u0430.",
  "why.door.noLock": "{door}: \u0432\u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.door.noCut": "{door}: \u0440\u0435\u0437\u0430\u0442\u044C \u043D\u0435\u0437\u0430\u0447\u0435\u043C.",
  "why.door.noWeld": "{door}: \u0437\u0430\u0432\u0430\u0440\u0438\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F.",
  "why.door.notOpen": "{door} \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u0442\u0430.",
  "why.door.noKeycard": "\u041A\u043B\u044E\u0447-\u043A\u0430\u0440\u0442\u044B \u043D\u0430 \u0434\u0440\u043E\u043D\u0435 \u043D\u0435\u0442.",
  "why.door.noKeycardHere": "\u0417\u0434\u0435\u0441\u044C \u043D\u0435\u0442 \u0437\u0430\u043C\u043A\u0430 \u043F\u043E\u0434 \u043A\u0430\u0440\u0442\u0443.",
  "why.door.wallsIn": "{door}: \u0441\u0432\u0430\u0440\u043A\u0430 \u0437\u0430\u043C\u0443\u0440\u0443\u0435\u0442 \u0434\u0440\u043E\u043D\u0430 \u0437\u0434\u0435\u0441\u044C.",
  "why.door.notBehind": "\u0414\u0440\u043E\u043D \u043F\u0440\u0438\u0448\u0451\u043B \u0441\u044E\u0434\u0430 \u043D\u0435 \u0447\u0435\u0440\u0435\u0437 \u0434\u0432\u0435\u0440\u044C.",
  "why.door.noneHere": "\u0421 \u0434\u0432\u0435\u0440\u044F\u043C\u0438 \u043E\u0442\u0441\u0435\u043A\u0430 \u0434\u0435\u043B\u0430\u0442\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.door.state": "{door}: {state}.",
  "why.room.noRoute": "{room}: \u043F\u0443\u0442\u0438 \u043D\u0435\u0442.",
  "why.module.missing": "{module}: \u043D\u0435\u0442 \u0432 \u0441\u0442\u043E\u0439\u043A\u0435.",
  "why.module.notInstalled": "{module}: \u043D\u0435\u0442 \u043D\u0430 \u0434\u0440\u043E\u043D\u0435.",
  "why.module.passive": "\u0423 \u044D\u0442\u043E\u0433\u043E \u043C\u043E\u0434\u0443\u043B\u044F \u043D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u044F.",
  "why.module.whole": "{module}: \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439 \u043D\u0435\u0442.",
  "why.module.grafted": "{module}: \u043D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u0442\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u043A\u0443\u0434\u0430.",
  "why.module.clean": "{module}: \u0447\u0438\u0441\u0442\u043E.",
  "why.rig.emptySlot": "\u0421\u043B\u043E\u0442 \u043F\u0443\u0441\u0442.",
  "why.slot.empty": "\u0412 \u044D\u0442\u043E\u043C \u0441\u043B\u043E\u0442\u0435 \u043F\u0443\u0441\u0442\u043E.",
  "why.rack.full": "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0433\u043E \u0441\u043B\u043E\u0442\u0430 \u043D\u0435\u0442. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u0440\u043E\u0434\u0430\u0439 \u0447\u0442\u043E-\u043D\u0438\u0431\u0443\u0434\u044C.",
  "why.rack.burnFirst": "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0433\u043E \u0441\u043B\u043E\u0442\u0430 \u043D\u0435\u0442. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0447\u0442\u043E-\u0442\u043E \u0434\u043E\u043B\u0436\u043D\u043E \u0441\u0433\u043E\u0440\u0435\u0442\u044C.",
  "why.graft.full": "\u041D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u0442\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u043A\u0443\u0434\u0430.",
  "why.repair.none": "\u0427\u0438\u043D\u0438\u0442\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.breach.nothing": "\u0412\u0441\u043A\u0440\u044B\u0432\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.shoot.none": "\u041D\u0430 \u043B\u0438\u043D\u0438\u0438 \u043E\u0433\u043D\u044F \u043F\u0443\u0441\u0442\u043E.",
  "why.emp.spent": "{emp}: \u0437\u0430\u0440\u044F\u0434\u044B \u043A\u043E\u043D\u0447\u0438\u043B\u0438\u0441\u044C.",
  "why.emp.none": "\u0412 \u0440\u0430\u0434\u0438\u0443\u0441\u0435 \u043D\u0438\u043A\u043E\u0433\u043E.",
  "why.relic.have": "{module} \u0443\u0436\u0435 \u0432 \u0441\u0442\u043E\u0439\u043A\u0435.",
  "why.relic.pick": "\u0421\u0442\u043E\u0439\u043A\u0430 \u043F\u043E\u043B\u043D\u0430. \u0412\u044B\u0431\u0435\u0440\u0438, \u0447\u0442\u043E \u0437\u0430\u043C\u0435\u043D\u0438\u0442\u044C.",
  "why.relic.noRepair": "{module} \u2014 \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044F. \u0415\u0451 \u043D\u0435 \u0447\u0438\u043D\u044F\u0442.",
  "why.swap.free": "\u0415\u0441\u0442\u044C \u043F\u0443\u0441\u0442\u043E\u0439 \u0441\u043B\u043E\u0442: \u043F\u0440\u043E\u0441\u0442\u043E \u0440\u0430\u0437\u0431\u0435\u0440\u0438.",
  "why.salvage.noRig": "\u0420\u0430\u0437\u0431\u0438\u0440\u0430\u0442\u044C \u043D\u0435\u0447\u0435\u043C.",
  "why.carry.full": "\u0414\u0440\u043E\u043D \u0443\u043D\u0435\u0441\u0451\u0442 {n}, \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0443\u0434\u0435\u0440\u0436\u0438\u0442.",
  "why.salvage.none": "\u0420\u0430\u0437\u0431\u0438\u0440\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.biomass.none": "\u0411\u0438\u043E\u043C\u0430\u0441\u0441\u044B \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0442.",
  "why.body.none": "\u041E\u0431\u044B\u0441\u043A\u0438\u0432\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u043A\u043E\u0433\u043E.",
  "why.body.searched": "\u042D\u0442\u043E \u0442\u0435\u043B\u043E \u0443\u0436\u0435 \u043E\u0431\u044B\u0441\u043A\u0430\u043D\u043E.",
  "why.cargo.none": "\u0413\u0440\u0443\u0437\u0438\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.cargo.carrying": "\u0422\u044B \u0438 \u0442\u0430\u043A \u044D\u0442\u043E \u043D\u0435\u0441\u0451\u0448\u044C.",
  "why.console.none": "\u041A\u043E\u043D\u0441\u043E\u043B\u0438 \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0442.",
  "why.console.done": "\u042D\u0442\u0430 \u043A\u043E\u043D\u0441\u043E\u043B\u044C \u0443\u0436\u0435 \u043E\u0442\u0434\u0430\u043B\u0430 \u0432\u0441\u0451, \u0447\u0442\u043E \u0431\u044B\u043B\u043E.",
  "why.system.none": "\u041F\u043E\u0434\u043D\u0438\u043C\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.system.up": "{system}: \u0443\u0436\u0435 \u0432 \u0441\u0435\u0442\u0438.",
  "why.system.needs": "\u041D\u0443\u0436\u0435\u043D \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442: {tools}.",
  "why.virus.none": "\u0412 \u0441\u0442\u043E\u0439\u043A\u0435 \u043D\u0435\u0442 \u0437\u0430\u0440\u0430\u0436\u0451\u043D\u043D\u044B\u0445 \u043C\u043E\u0434\u0443\u043B\u0435\u0439.",
  "why.virus.clean": "\u042D\u0442\u043E\u0442 \u043C\u043E\u0434\u0443\u043B\u044C \u0447\u0438\u0441\u0442.",
  "why.tug.only": "\u042D\u0442\u043E \u0434\u0435\u043B\u0430\u044E\u0442 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435, \u043D\u0435 \u0437\u0434\u0435\u0441\u044C.",
  "why.hull.none": "\u0422\u0430\u043A\u043E\u0433\u043E \u043A\u043E\u0440\u043F\u0443\u0441\u0430 \u043D\u0430 \u0441\u0442\u043E\u0439\u043A\u0435 \u043D\u0435\u0442.",
  "why.hold.noDrone": "\u0421\u0442\u0430\u0432\u0438\u0442\u044C \u043D\u0435\u043A\u0443\u0434\u0430: \u0434\u0440\u043E\u043D\u0430 \u043D\u0435\u0442.",
  "why.hold.none": "\u0412 \u0442\u0440\u044E\u043C\u0435 \u043F\u043E\u0434 \u044D\u0442\u0438\u043C \u043D\u043E\u043C\u0435\u0440\u043E\u043C \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435\u0442.",
  "why.charter.none": "\u041D\u0430 \u0434\u043E\u0441\u043A\u0435 \u043F\u043E\u0434 \u044D\u0442\u0438\u043C \u043D\u043E\u043C\u0435\u0440\u043E\u043C \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435\u0442.",
  "why.charter.late": "{hull}: \u0434\u043E\u0441\u043A\u0430 \u0447\u0430\u0440\u0442\u0435\u0440\u043E\u0432 \u0437\u0430\u043A\u0440\u044B\u0442\u0430 \u2014 \u0431\u043E\u0440\u0442 \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442.",
  "why.undock.aboard": "\u0422\u044B \u0438 \u0442\u0430\u043A \u043D\u0430 \u0431\u043E\u0440\u0442\u0443.",
  "why.undock.noDrone": "\u041D\u0430 \u0440\u0435\u043B\u044C\u0441\u0430\u0445 \u043D\u0435\u0442 \u0434\u0440\u043E\u043D\u0430.",
  "why.undock.sold": "{hull} \u0443\u0436\u0435 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435. \u041F\u0440\u044B\u0433\u0430\u0439 \u043A \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u043C\u0443 \u043A\u043E\u0440\u043F\u0443\u0441\u0443.",
  "why.undock.tow": "{hull} \u0443\u0436\u0435 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435.",
  "why.jump.aboard": "\u041F\u0440\u044B\u0433\u0430\u0435\u0442 \u0431\u0443\u043A\u0441\u0438\u0440, \u0430 \u043D\u0435 \u0434\u0440\u043E\u043D.",
  "why.jump.last": "\u0414\u0430\u043B\u044C\u0448\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435\u0442. \u042D\u0442\u043E \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043A\u043E\u0440\u043F\u0443\u0441 \u0440\u0435\u0439\u0441\u0430.",
  "why.jump.first": "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u0435\u0440\u0435\u043B\u0451\u0442 \u0437\u0430 {price} CR.",
  // ------------------------------------------------------- нумерованный список
  "action.attack": "\u0430\u0442\u0430\u043A\u0430: {target} {hp}/{max}",
  "action.shoot": "\u043E\u0433\u043E\u043D\u044C: {target}",
  "action.carry": "\u0443\u043D\u0435\u0441\u0442\u0438 {module} {left}/{max}",
  "action.salvage": "\u0440\u0430\u0437\u0431\u043E\u0440: {module} {left}/{max}",
  "action.swap": "{module} \u0432\u043C\u0435\u0441\u0442\u043E {old}",
  "action.swapMenu": "{module} \u0432\u043C\u0435\u0441\u0442\u043E \u2026 \u25B8",
  "action.discharge": "\u0440\u0430\u0437\u0440\u044F\u0434 {module} ({n})",
  "action.hide": "\u0443\u043A\u0440\u044B\u0442\u044C\u0441\u044F",
  "action.search": "\u043E\u0431\u044B\u0441\u043A\u0430\u0442\u044C \u0442\u0435\u043B\u043E",
  "action.strip": "\u0441\u043D\u044F\u0442\u044C \u0431\u0438\u043E\u043C\u0430\u0441\u0441\u0443 ({cr} CR)",
  "action.purge": "\u043F\u0440\u043E\u0436\u0438\u0433 {module} (\u0441\u0432\u0430\u0440\u043A\u0430, {left, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432})",
  "action.work": "\u043F\u043E\u0434\u044A\u0451\u043C {system} {tool} {left}",
  "action.workBare": "\u043F\u043E\u0434\u044A\u0451\u043C {system} ({left})",
  "action.take": "\u0432\u0437\u044F\u0442\u044C {crate} ({cr} CR)",
  "action.takeMarked": "\u0432\u0437\u044F\u0442\u044C \u043C\u0435\u0447\u0435\u043D\u044B\u0439 \u044F\u0449\u0438\u043A",
  "action.upload": "\u043F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 ({left, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432})",
  "action.buy": "\u043A\u0443\u043F\u0438\u0442\u044C {hull} {price} CR",
  "action.undock": "\u0432\u044B\u043B\u0435\u0442 \u043D\u0430 {hull}",
  "action.undock.todo": "\u0432\u044B\u043B\u0435\u0442 {left}",
  "undock.left.damaged": "{n} \u0431\u0438\u0442\u044B\u0445",
  "undock.left.charter": "\u0431\u0435\u0437 \u0440\u0430\u0431\u043E\u0442\u044B",
  "undock.left.board": "\u2014 \u0434\u043E\u0441\u043A\u0430 \u0437\u0430\u043A\u0440\u043E\u0435\u0442\u0441\u044F",
  "action.repair": "{module} {price} CR",
  "action.clean": "\u0447\u0438\u0441\u0442\u043A\u0430: {module} ({price} CR)",
  "action.graft": "{module} +1 \u0431\u0430\u0437\u044B  {price} CR",
  "action.order": "\u043A\u0443\u043F\u0438\u0442\u044C {module} {price} CR",
  "action.fit": "{module} {integrity}/{max}",
  "action.sell": "{module} {left}/{max}  {price} CR",
  "action.charter": "\u0432\u0437\u044F\u0442\u044C {charter} ({price})",
  "action.jump": "\u2192 {hull}  {price} CR",
  "action.jump.drop": "\u0431\u0440\u043E\u0441\u0438\u0442\u044C {up}/{of}, \u043F\u0440\u043E\u0434\u0430\u0436\u0430 {cr}",
  "action.back": "\u043D\u0430\u0437\u0430\u0434 ({door})",
  "action.backRoom": "\u043D\u0430\u0437\u0430\u0434",
  "dist.doors": "{n, one: # \u0434\u0432\u0435\u0440\u044C, few: # \u0434\u0432\u0435\u0440\u0438, many: # \u0434\u0432\u0435\u0440\u0435\u0439}",
  "dist.none": "\u043D\u0435\u0442 \u043F\u0443\u0442\u0438",
  "crate.cargo": "\u0433\u0440\u0443\u0437",
  "crate.contraband": "\u043B\u0435\u0432\u044B\u0439 \u0433\u0440\u0443\u0437",
  // ------------------------------------------------------------- что говорит `o`
  "stop.over": "\u0417\u0430\u0431\u0435\u0433 \u043E\u043A\u043E\u043D\u0447\u0435\u043D.",
  "stop.machine": "\u0412\u0438\u0434\u043D\u043E: {machine}, \u043E\u0442\u0441\u0435\u043A {room}.",
  "stop.hit": "\u0422\u0435\u0431\u044F \u0431\u044C\u044E\u0442.",
  "stop.alert": "\u0422\u0440\u0435\u0432\u043E\u0433\u0430 \u0440\u0430\u0441\u0442\u0451\u0442.",
  "stop.thing": "\u0417\u0434\u0435\u0441\u044C \u0447\u0442\u043E-\u0442\u043E \u0435\u0441\u0442\u044C: {thing}.",
  "stop.explored": "{hull} \u0438\u0437\u0443\u0447\u0435\u043D. {back}",
  "stop.airlock.none": "\u0414\u043E\u0440\u043E\u0433\u0438 \u043E\u0431\u0440\u0430\u0442\u043D\u043E \u043A \u0448\u043B\u044E\u0437\u0443 \u043D\u0435\u0442.",
  "stop.airlock.here": "\u0422\u044B \u0441\u0442\u043E\u0438\u0448\u044C \u0443 \u0448\u043B\u044E\u0437\u0430.",
  "stop.airlock.away": "\u0428\u043B\u044E\u0437: {n, one: # \u0434\u0432\u0435\u0440\u044C, few: # \u0434\u0432\u0435\u0440\u0438, many: # \u0434\u0432\u0435\u0440\u0435\u0439} \u043D\u0430\u0437\u0430\u0434.",
  "stop.noTarget": "\u0426\u0435\u043B\u0435\u0439 \u043D\u0435 \u0432\u0438\u0434\u043D\u043E.",
  "stop.noWay": "\u041F\u0440\u043E\u0445\u043E\u0434\u0430 \u043D\u0435\u0442.",
  "stop.arrived": "\u0414\u043E\u0448\u043B\u0438: {room}.",
  "stop.shut": "\u0414\u0430\u043B\u044C\u0448\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u043E: {door} ({state}).",
  "stop.shut.ways": "\u0414\u0430\u043B\u044C\u0448\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u043E: {door} ({state}) \u2014 {ways}; \u0432 \u0441\u0442\u043E\u0439\u043A\u0435: {have}.",
  "stop.shut.none": "\u0414\u0430\u043B\u044C\u0448\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u043E: {door} ({state}) \u2014 {ways}; \u0432 \u0441\u0442\u043E\u0439\u043A\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u0438\u0437 \u044D\u0442\u043E\u0433\u043E \u043D\u0435\u0442.",
  // ------------------------------------------------------------------- панель
  "panel.turn": "\u0445\u043E\u0434 {n}",
  "panel.sortie": "\u0432\u044B\u043B\u0435\u0442 {n}",
  "panel.actions": "\u0414\u0415\u0419\u0421\u0422\u0412\u0418\u042F",
  "panel.more": "\u2026 \u0435\u0449\u0451 {n}",
  "panel.more.arrows": "\u2026 \u0435\u0449\u0451 {n} (\u2191\u2193)",
  "panel.room": "{room} {label}",
  "panel.doorTo": "{door} \u2192 {room}",
  "panel.roomDoors": "{room} {label}  \u0434\u0432\u0435\u0440\u0438 {doors}",
  "panel.doorMore": "\u2026 \u0435\u0449\u0451 {n, one: # \u0434\u0432\u0435\u0440\u044C, few: # \u0434\u0432\u0435\u0440\u0438, many: # \u0434\u0432\u0435\u0440\u0435\u0439}",
  "panel.roomMore": "\u2026 \u0435\u0449\u0451 {n} \u0437\u0434\u0435\u0441\u044C",
  "panel.letter.move": "m \u0438\u0434\u0442\u0438",
  "panel.letter.brace": ". \u0443\u043F\u043E\u0440",
  "panel.letter.hide": "h \u0443\u043A\u0440\u044B\u0442",
  "panel.letter.doors": "d \u0434\u0432\u0435\u0440\u0438",
  "panel.letter.leave": "< \u0432\u044B\u0445\u043E\u0434",
  "panel.letters.tug": "0 \u043D\u0430\u0437\u0430\u0434  ? \u043F\u043E\u043C\u043E\u0449\u044C",
  "panel.letters": "o \u043E\u0431\u0437\u043E\u0440  Tab \u0431\u043E\u0439  ? \u043F\u043E\u043C\u043E\u0449\u044C",
  "panel.nextHit": "\u0421\u041B\u0415\u0414\u0423\u042E\u0429\u0418\u0419 \u0423\u0414\u0410\u0420 \u0412",
  "panel.core": "\u042F\u0414\u0420\u041E  {dots}",
  "panel.slot.empty": "-- \u043F\u0443\u0441\u0442\u043E --",
  "panel.slot.burned": "-- \u0441\u0433\u043E\u0440\u0435\u043B --",
  "panel.keys": "\u041A\u041B\u042E\u0427\u0415\u0419 {n}",
  "panel.alert": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 {gauge}",
  "panel.alertStage": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 {gauge} {stage}",
  "panel.alertScuttle": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 {gauge} \u0414\u041E \u041F\u041E\u0414\u0420\u042B\u0412\u0410 {n}",
  "panel.alertOff": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 {gauge} \u0421\u041D\u042F\u0422\u0410",
  "panel.hunter": "\u041A\u0410\u0420\u0410\u0422\u0415\u041B\u042C \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u043D\u0430 \u0431\u043E\u0440\u0442\u0443",
  "panel.rival": "\u0427\u0423\u0416\u041E\u0419 {gauge}",
  "panel.evac": "\u042D\u0412\u0410\u041A {n}",
  "panel.goal": "\u0426\u0415\u041B\u042C  \u041F\u041E\u0414\u041D\u042F\u0422\u042C \u041A\u041E\u0420\u041F\u0423\u0421 {cr} CR",
  "panel.goal.bare": "\u0426\u0415\u041B\u042C  3 \u0421\u0418\u0421\u0422\u0415\u041C\u042B, \u0423\u0419\u0422\u0418 \u0416\u0418\u0412\u042B\u041C",
  "panel.goal.done": "\u0412\u0421\u0415 \u0422\u0420\u0418 \u0412 \u0421\u0415\u0422\u0418  +{cr} CR",
  "panel.goal.out": "< \u043D\u0430 \u0432\u044B\u0445\u043E\u0434 \u0447\u0435\u0440\u0435\u0437 \u0448\u043B\u044E\u0437",
  "panel.goal.noTool": "\u041D\u0415\u0427\u0415\u041C \u041F\u041E\u0414\u041D\u042F\u0422\u042C \u041A\u041E\u0420\u041F\u0423\u0421",
  "panel.goal.towed": "\u041A\u041E\u0420\u041F\u0423\u0421 \u0412\u0417\u042F\u0422  \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435",
  "panel.goal.work": "{mark} {system} {tool}, {left, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432}",
  "panel.charters": "\u041A\u041E\u041D\u0422\u0420\u0410\u041A\u0422\u042B",
  "panel.charter.plain": "{mark} {name}",
  "panel.charter.where": "{mark} {name} \xB7 {room}",
  "panel.charter.loot": "{mark} {name} {have}/{need} CR",
  "panel.virus": "{virus}: {module}",
  "panel.credits": "\u041A\u0420\u0415\u0414\u0418\u0422\u042B {n}",
  "panel.hold": "\u041D\u0415\u0421\u0401\u0422  {n} CR",
  "panel.droneLost": "\u0414\u0420\u041E\u041D\u0410 \u041D\u0410 \u0421\u0422\u0410\u041F\u0415\u041B\u0415 \u041D\u0415\u0422",
  "panel.cheapest": "\u0414\u0415\u0428\u0401\u0412\u042B\u0419 \u041A\u041E\u0420\u041F\u0423\u0421 {n}",
  "panel.derelict": "\u0414\u0415\u0420\u0415\u041B\u0418\u041A\u0422 {hull}",
  "panel.tow": "\u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435",
  "panel.quiet": "\u0442\u0438\u0445\u043E",
  "panel.alertAt": "\u0442\u0440\u0435\u0432\u043E\u0433\u0430 {n}",
  "panel.hullState": "{alert} \xB7 {up}/{of} \u0432 \u0441\u0435\u0442\u0438",
  "ship.rooms": "{n, one: # \u043E\u0442\u0441\u0435\u043A, few: # \u043E\u0442\u0441\u0435\u043A\u0430, many: # \u043E\u0442\u0441\u0435\u043A\u043E\u0432}",
  "ship.seen": "{n} \u0432\u0438\u0434\u043D\u043E",
  "ship.scanned": "{n} \u043D\u0430 \u0441\u043A\u0430\u043D\u0435",
  "schematic.hidden": "\xBB {n, one: # \u043E\u0442\u0441\u0435\u043A, few: # \u043E\u0442\u0441\u0435\u043A\u0430, many: # \u043E\u0442\u0441\u0435\u043A\u043E\u0432}",
  "schematic.behind": "\xAB {n, one: # \u043E\u0442\u0441\u0435\u043A, few: # \u043E\u0442\u0441\u0435\u043A\u0430, many: # \u043E\u0442\u0441\u0435\u043A\u043E\u0432}",
  // Added with the tug-clarity pass (G40).
  "why.rack.hullFull": "\u0421\u0442\u043E\u0439\u043A\u0430 \u0437\u0430\u043D\u044F\u0442\u0430.",
  "action.hull.onRack": "{hull} \u2014 \u043D\u0430 \u0441\u0442\u043E\u0439\u043A\u0435",
  "panel.contact.hit": "\u0432\u044B\u0436\u0436\u0435\u0442: {module}",
  // The contacts block, made unmissable (G47).
  "panel.contacts.here": "\u0412\u0420\u0410\u0413 \u0412 \u041E\u0422\u0421\u0415\u041A\u0415: {n}",
  "panel.contacts.near": "\u0417\u0410 \u0414\u0412\u0415\u0420\u042C\u042E: {n}",
  "panel.contactsMore": "\u2026 \u0435\u0449\u0451 {n} \u0432 \u0432\u0438\u0434\u0443",
  "danger.melee": "\u0432 \u0443\u043F\u043E\u0440",
  "danger.door": "\u0441\u0442\u0440\u0435\u043B\u044F\u0435\u0442",
  "danger.jam": "\u0433\u043B\u0443\u0448\u0438\u0442",
  "danger.noScrap": "\u0431\u0435\u0437 \u043B\u043E\u043C\u0430",
  "danger.hunter": "\u043E\u0445\u043E\u0442\u043D\u0438\u043A",
  "danger.still": "\u043D\u0435 \u0431\u044C\u0451\u0442",
  "log.contacts.here": "\u0412 \u043E\u0442\u0441\u0435\u043A\u0435: {list}.",
  "log.contacts.one": "{machine} {hp}, {danger}",
  "panel.head.tug": "SALVOR  \u0431\u0443\u043A\u0441\u0438\u0440",
  "panel.head.tugTo": "SALVOR  \u0431\u0443\u043A\u0441\u0438\u0440 \u2192 {hull}",
  "help.where.tug.head": "\u0413\u0414\u0415 \u0422\u042B \u2014 \u0442\u0432\u043E\u0439 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0431\u0443\u043A\u0441\u0438\u0440",
  "help.where.tug.1": "\u041E\u0434\u0438\u043D \u044D\u043A\u0440\u0430\u043D: \u043A\u0443\u043F\u0438 \u0434\u0440\u043E\u043D\u0430, \u043F\u043E\u0447\u0438\u043D\u0438, \u0441\u043D\u0438\u043C\u0438 \u0432 \u0442\u0440\u044E\u043C \u0438\u043B\u0438 \u043F\u0440\u043E\u0434\u0430\u0439",
  "help.where.tug.2": "\u043B\u0438\u0448\u043D\u0435\u0435, \u0432\u043E\u0437\u044C\u043C\u0438 \u0447\u0430\u0440\u0442\u0435\u0440 \u0438 \u0432\u044B\u043B\u0435\u0442\u0430\u0439. \u0425\u043E\u0434\u0438\u0442\u044C \u0442\u0443\u0442 \u043D\u0435\u0433\u0434\u0435.",
  "help.where.ship.head": "\u0413\u0414\u0415 \u0422\u042B \u2014 \u0432\u043D\u0443\u0442\u0440\u0438 \u0434\u0435\u0440\u0435\u043B\u0438\u043A\u0442\u0430",
  "help.where.ship.1": "\u0411\u0435\u0440\u0438 \u0442\u043E, \u0447\u0442\u043E \u043E\u043A\u0443\u043F\u0438\u0442\u0441\u044F, \u043F\u043E\u0434\u043D\u0438\u043C\u0438 \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u043A\u043E\u0440\u0430\u0431\u043B\u044F \u0438 \u0443\u0445\u043E\u0434\u0438",
  "help.where.ship.2": "\u0447\u0435\u0440\u0435\u0437 \u0448\u043B\u044E\u0437: \u0442\u0440\u044E\u043C \u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F \u0434\u0435\u043D\u044C\u0433\u0430\u043C\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043E\u043C\u0430.",
  "help.name.pick": "\u0412\u042B\u0411\u041E\u0420",
  "help.key.pick": "\u0432\u0432\u0435\u0440\u0445/\u0432\u043D\u0438\u0437  enter \u0434\u0435\u043B\u0430\u0435\u0442 \u043E\u0442\u043C\u0435\u0447\u0435\u043D\u043D\u0443\u044E \u0441\u0442\u0440\u043E\u043A\u0443",
  "help.name.move": "\u0418\u0414\u0422\u0418",
  "help.name.doors": "\u0414\u0412\u0415\u0420\u0418",
  "help.name.seal": "\u0417\u0410\u0412\u0410\u0420\u0418\u0422\u042C",
  "ship.yourTug": "\u0442\u0432\u043E\u0439 \u0431\u0443\u043A\u0441\u0438\u0440",
  "ship.dockedTo": "\u043F\u0440\u0438\u0448\u0432\u0430\u0440\u0442\u043E\u0432\u0430\u043D: {hull}",
  "banner.ahead": "\u0414\u0415\u0420\u0415\u041B\u0418\u041A\u0422 \u0432\u043F\u0435\u0440\u0435\u0434\u0438: {hull} \xB7 {rooms}",
  "banner.tug": "\u0422\u0412\u041E\u0419 \u0411\u0423\u041A\u0421\u0418\u0420 \xAB{callsign}\xBB \xB7 \u043F\u0440\u0438\u0448\u0432\u0430\u0440\u0442\u043E\u0432\u0430\u043D: {hull}",
  "banner.derelict": "\u0414\u0415\u0420\u0415\u041B\u0418\u041A\u0422 {parts}",
  "word.unknownHull": "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u043A\u043E\u0440\u043F\u0443\u0441",
  "log.opening.tug": "\u0422\u0432\u043E\u0439 \u0431\u0443\u043A\u0441\u0438\u0440. \u0412\u0441\u0451, \u0447\u0442\u043E \u043E\u043D \u0443\u043C\u0435\u0435\u0442, \u2014 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435: \u0434\u0440\u043E\u043D, \u0440\u0435\u043C\u043E\u043D\u0442, \u0447\u0430\u0440\u0442\u0435\u0440\u044B, \u0432\u044B\u043B\u0435\u0442. ? \u2014 \u0432 \u043B\u044E\u0431\u043E\u0439 \u043C\u043E\u043C\u0435\u043D\u0442.",
  "log.opening.voyage": "{callsign}. \u0412\u043F\u0435\u0440\u0435\u0434\u0438 {hulls, one: # \u043A\u043E\u0440\u043F\u0443\u0441, few: # \u043A\u043E\u0440\u043F\u0443\u0441\u0430, many: # \u043A\u043E\u0440\u043F\u0443\u0441\u043E\u0432}; \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u2014 \u0431\u0443\u043A\u0441\u0438\u0440 \u0442\u0432\u043E\u0435\u0433\u043E \u043E\u0442\u0446\u0430.",
  // ------------------------------------------------------------ титул и справка
  "title.name": "SALVOR",
  "title.tagline": "\u041F\u043E\u0448\u0430\u0433\u043E\u0432\u044B\u0439 \u0440\u043E\u0433\u0430\u043B\u0438\u043A. \u041A\u0430\u0436\u0434\u044B\u0439 \u0443\u0434\u0430\u0440 \u0432\u044B\u0436\u0438\u0433\u0430\u0435\u0442 \u043C\u043E\u0434\u0443\u043B\u044C, \u043A\u043E\u0442\u043E\u0440\u044B\u043C \u0442\u044B \u0434\u0435\u0439\u0441\u0442\u0432\u043E\u0432\u0430\u043B.",
  "title.menu.head": "\u041C\u0415\u041D\u042E",
  "title.menu.voyage": "\u041D\u043E\u0432\u044B\u0439 \u0440\u0435\u0439\u0441",
  "title.menu.voyage.at": "\u0441\u0432\u0435\u0436\u0438\u0439 \u0434\u0435\u0440\u0435\u043B\u0438\u043A\u0442",
  "title.menu.training": "\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435",
  "title.menu.training.at": "\u0443\u0447\u0435\u0431\u043D\u044B\u0439 \u043A\u043E\u0440\u043F\u0443\u0441, \u0448\u0430\u0433 \u0437\u0430 \u0448\u0430\u0433\u043E\u043C",
  "title.menu.help": "\u0421\u043F\u0440\u0430\u0432\u043A\u0430",
  "title.menu.help.at": "\u043A\u043B\u0430\u0432\u0438\u0448\u0438, \u043F\u0440\u0430\u0432\u0438\u043B\u0430, \u0447\u0442\u043E \u0442\u0430\u043A\u043E\u0435 \u0447\u0430\u0440\u0442\u0435\u0440",
  "title.menu.seed": "\u0421\u0438\u0434",
  "title.menu.lang": "\u042F\u0437\u044B\u043A",
  "title.menu.view": "\u0412\u0438\u0434",
  "title.menu.sound": "\u0417\u0432\u0443\u043A",
  "title.sound.on": "\u0432\u043A\u043B",
  "title.sound.off": "\u0432\u044B\u043A\u043B",
  "title.view.ascii": "ASCII",
  "title.view.web": "\u043F\u0430\u043D\u0435\u043B\u0438",
  "title.view.hex": "\u0441\u043E\u0442\u044B",
  "title.view.judges": "\u0421\u0443\u0434\u044C\u0438 \u0434\u0436\u0435\u043C\u0430 \u0436\u0434\u0443\u0442 ASCII \u2014 \u0441 \u043D\u0435\u0433\u043E \u0438 \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442\u0441\u044F \u043D\u043E\u0432\u0430\u044F \u0441\u0435\u0441\u0441\u0438\u044F.",
  "title.seed.empty": "\u0432\u0432\u0435\u0434\u0438 \u0446\u0438\u0444\u0440\u044B",
  "title.seed.typing": "\u0446\u0438\u0444\u0440\u044B \u0438 Enter \xB7 \u043F\u0443\u0441\u0442\u043E\u0439 Enter \u2014 \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0439 \xB7 Esc \u043E\u0442\u043C\u0435\u043D\u0430",
  "title.start": "1 \u0438\u043B\u0438 \u043F\u0440\u043E\u0431\u0435\u043B \u2014 \u0432 \u0440\u0435\u0439\u0441",
  "title.keys.head": "\u0423\u041F\u0420\u0410\u0412\u041B\u0415\u041D\u0418\u0415 \u041D\u0410 \u0411\u041E\u0420\u0422\u0423",
  "title.keys.1": "?  \u0441\u043F\u0440\u0430\u0432\u043A\u0430      m  \u0438\u0434\u0442\u0438      o  \u0440\u0430\u0437\u0432\u0435\u0434\u043A\u0430      Tab  \u0431\u043E\u0439",
  "title.keys.2": "i  \u0447\u0442\u043E \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442      V  \u0432\u0438\u0434      Enter  \u0441\u0434\u0435\u043B\u0430\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443",
  "title.foot": "roguetemple's Fortnight 2 \xB7 smoreg \xB7 \u0441\u0431\u043E\u0440\u043A\u0430 {version}",
  "help.page.more": "{n}/{of}   ? \u0434\u0430\u043B\u044C\u0448\u0435   esc \u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  "help.page.last": "{n}/{of}   ? \u0437\u0430\u043A\u0440\u044B\u0442\u044C   esc \u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  "help.title": "\u0423\u041F\u0420\u0410\u0412\u041B\u0415\u041D\u0418\u0415",
  "help.name.act": "\u0414\u0415\u0419\u0421\u0422\u0412\u0418\u0415",
  "help.name.brace": "\u0423\u041F\u041E\u0420",
  "help.name.hide": "\u0423\u041A\u0420\u042B\u0422\u042C\u0421\u042F",
  "help.name.explore": "\u041E\u0411\u0417\u041E\u0420",
  "help.name.engage": "\u0421\u0411\u041B\u0418\u0417\u0418\u0422\u042C\u0421\u042F",
  "help.name.keycard": "\u041A\u0410\u0420\u0422\u0410",
  "help.name.log": "\u041B\u041E\u0413",
  "help.name.help": "\u0421\u041F\u0420\u0410\u0412\u041A\u0410",
  "help.key.act": "1-9 0  \u0441\u0442\u0440\u043E\u043A\u0430 \u0441\u043F\u0438\u0441\u043A\u0430",
  "help.key.brace": ". \u0438\u043B\u0438 \u043F\u0440\u043E\u0431\u0435\u043B   (\u043F\u043E\u0434 \u0443\u0434\u0430\u0440: \u0411\u0420\u041E\u041D\u042F)",
  "help.key.hide": "h   \u0442\u0430\u043C, \u0433\u0434\u0435 \u0432 \u043E\u0442\u0441\u0435\u043A\u0435 \u0435\u0441\u0442\u044C \u0443\u043A\u0440\u044B\u0442\u0438\u0435",
  "help.key.move": "m   \u043A\u0443\u0434\u0430 \u0438\u0434\u0442\u0438 \xB7 <   \u043A \u0448\u043B\u044E\u0437\u0443 \u0438 \u043D\u0430\u0440\u0443\u0436\u0443",
  "help.key.doors": "d   \u0434\u0432\u0435\u0440\u0438 \u043E\u0442\u0441\u0435\u043A\u0430: \u0437\u0430\u043A\u0440\u044B\u0442\u044C, \u0437\u0430\u0432\u0430\u0440\u0438\u0442\u044C",
  "help.key.seal": "shift+D   \u0437\u0430\u0432\u0430\u0440\u0438\u0442\u044C \u0434\u0432\u0435\u0440\u044C \u0437\u0430 \u0441\u043E\u0431\u043E\u0439",
  "help.key.explore": "o   \u0438\u0434\u0442\u0438 \u0434\u0430\u043B\u044C\u0448\u0435; \u0441\u0442\u043E\u043F \u043D\u0430 \u0432\u0441\u0451\u043C \u043D\u043E\u0432\u043E\u043C",
  "help.key.engage": "tab / shift+tab  \u0432\u044B\u0441\u0442\u0440\u0435\u043B \u0438\u043B\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043F\u043B\u043E\u0442\u043D\u0443\u044E",
  "help.key.scanner": "s   \u0438\u043C\u043F\u0443\u043B\u044C\u0441: \u0434\u0432\u0435 \u0434\u0432\u0435\u0440\u0438 \u0432\u0433\u043B\u0443\u0431\u044C, \u0433\u0440\u043E\u043C\u043A\u043E",
  "help.key.emp": "e   \u043E\u0433\u043B\u0443\u0448\u0438\u0442\u044C \u043E\u0442\u0441\u0435\u043A, 2 \u0437\u0430\u0440\u044F\u0434\u0430",
  "help.key.welder": "w   \u043F\u043E\u0447\u0438\u043D\u0438\u0442\u044C \u0441\u0430\u043C\u044B\u0439 \u0441\u043B\u0430\u0431\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C",
  "help.key.cell": "p   \u0437\u0430\u043F\u0438\u0442\u0430\u0442\u044C \u0437\u0430\u043F\u0435\u0440\u0442\u0443\u044E \u0434\u0432\u0435\u0440\u044C \u0438\u043B\u0438 \u043A\u043E\u043D\u0441\u043E\u043B\u044C",
  "help.key.spike": "K   \u0432\u0441\u043A\u0440\u044B\u0442\u044C \u0437\u0430\u043C\u043E\u043A, \u0434\u0432\u0430 \u0445\u043E\u0434\u0430, \u0442\u0438\u0445\u043E",
  "help.key.emitter": "f   \u0432\u044B\u0441\u0442\u0440\u0435\u043B \u043F\u043E \u043B\u0438\u043D\u0438\u0438 \u043E\u0433\u043D\u044F",
  "help.key.cutter": "c   \u0440\u0435\u0437\u0430\u0442\u044C \u0434\u0432\u0435\u0440\u044C, \u0442\u0440\u0438 \u0445\u043E\u0434\u0430, \u0433\u0440\u043E\u043C\u043A\u043E",
  "help.key.keycard": "a   \u043A\u043B\u044E\u0447-\u043A\u0430\u0440\u0442\u0430 \u043D\u0430 \u0437\u0430\u043C\u043E\u043A, \u0442\u0438\u0445\u043E",
  "help.key.log": "PgUp   \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 200 \u0441\u0442\u0440\u043E\u043A; PgDn \u043D\u0430\u0437\u0430\u0434",
  "help.key.help": "?   \u0412\u0418\u0414 V  \u042F\u0417\u042B\u041A L  \u0417\u0410\u041D\u041E\u0412\u041E shift+R  \u0417\u0410\u041A\u0420\u042B\u0422\u042C esc",
  // ------------------------------------ what is going on here (G72)
  "codex.label.wrong": "\u041E\u0448\u0438\u0431\u043A\u0430:",
  "codex.label.helps": "\u041F\u043E\u043C\u043E\u0433\u0430\u0435\u0442:",
  "codex.label.turn": "\u041E\u0431\u0440\u0430\u0442\u0438\u0442\u044C:",
  "codex.fitted": "(\u0432 \u0441\u0442\u043E\u0439\u043A\u0435)",
  "codex.badge": "[i] {n}",
  "codex.footer.more": "{n}/{of}   \u0441\u0442\u0440\u0435\u043B\u043A\u0438 \u043B\u0438\u0441\u0442\u0430\u044E\u0442   esc \u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  "codex.footer.last": "{n}/{of}   esc \u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  "codex.spasm.title": "\u0412\u0418\u0420\u0423\u0421 SPASM",
  "codex.spasm.what": "\u0421\u0438\u0434\u0438\u0442 \u0432 \u043E\u0434\u043D\u043E\u043C \u0438\u0437 \u043C\u043E\u0434\u0443\u043B\u0435\u0439. \u041A\u0430\u0436\u0434\u044B\u0435 \u0432\u043E\u0441\u0435\u043C\u044C \u0445\u043E\u0434\u043E\u0432 \u0441\u043B\u043E\u0442 \u0434\u0451\u0440\u0433\u0430\u0435\u0442\u0441\u044F \u0438 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u043C, \u0447\u0442\u043E \u0431\u044B \u0442\u044B \u0438\u043C \u043D\u0438 \u0434\u0435\u043B\u0430\u043B.",
  "codex.spasm.wrong": "\u0412\u0435\u0440\u0438\u0442\u044C \u0440\u0430\u0441\u043A\u043B\u0430\u0434\u043A\u0435 \u0432 \u044D\u0442\u043E\u0442 \u0445\u043E\u0434: \u043A\u0443\u0434\u0430 \u043F\u0440\u0438\u0434\u0451\u0442 \u0443\u0434\u0430\u0440, \u0440\u0435\u0448\u0430\u0435\u0442 \u0441\u0443\u0434\u043E\u0440\u043E\u0433\u0430, \u0430 \u043D\u0435 \u0442\u0432\u043E\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430.",
  "codex.spasm.helps": "\u0414\u0432\u0430 \u0445\u043E\u0434\u0430 \u0441\u0432\u0430\u0440\u043A\u0438 \u0432\u044B\u0447\u0438\u0449\u0430\u044E\u0442 \u0435\u0433\u043E; \u043D\u0430 \u0432\u0435\u0440\u0441\u0442\u0430\u043A\u0435 \u0434\u043E\u043C\u0430 \u0447\u0438\u0441\u0442\u043A\u0430 \u0441\u0442\u043E\u0438\u0442 4 CR.",
  "codex.spasm.lore": "\u042D\u043A\u0438\u043F\u0430\u0436 \u0434\u0432\u0430\u0436\u0434\u044B \u0441\u043F\u0438\u0441\u0430\u043B \u044D\u0442\u043E \u043D\u0430 \u043D\u0435\u0438\u0441\u043F\u0440\u0430\u0432\u043D\u043E\u0441\u0442\u044C, \u0430 \u043F\u043E\u0442\u043E\u043C \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043B \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0442\u044C.",
  "codex.rot.title": "\u0412\u0418\u0420\u0423\u0421 ROT",
  "codex.rot.what": "\u0428\u0442\u0430\u043C\u043C \u0435\u0441\u0442 \u0442\u043E\u0442 \u043C\u043E\u0434\u0443\u043B\u044C, \u0432 \u043A\u043E\u0442\u043E\u0440\u043E\u043C \u0441\u0438\u0434\u0438\u0442: \u043E\u0447\u043A\u043E \u043F\u0440\u043E\u0447\u043D\u043E\u0441\u0442\u0438 \u043A\u0430\u0436\u0434\u044B\u0435 \u043F\u044F\u0442\u044C \u0445\u043E\u0434\u043E\u0432, \u0438 \u0441 \u043C\u0435\u0441\u0442\u0430 \u043D\u0435 \u0441\u0445\u043E\u0434\u0438\u0442.",
  "codex.rot.wrong": "\u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0435\u0433\u043E \u043D\u0430 \u043B\u0443\u0447\u0448\u0435\u043C \u043C\u043E\u0434\u0443\u043B\u0435. \u0413\u043D\u0438\u043B\u0438 \u0432\u0441\u0451 \u0440\u0430\u0432\u043D\u043E, \u0447\u0442\u043E \u0433\u0440\u044B\u0437\u0442\u044C.",
  "codex.rot.helps": "\u0412\u044B\u0447\u0438\u0441\u0442\u0438\u0442\u044C, \u043F\u043E\u043A\u0430 \u0441\u043B\u043E\u0442 \u043D\u0435 \u0432\u044B\u0433\u043E\u0440\u0435\u043B.",
  "codex.rot.turn": "\u0412\u044B\u0433\u043E\u0440\u0435\u0432\u0448\u0438\u0439 \u043C\u043E\u0434\u0443\u043B\u044C \u0443\u043D\u043E\u0441\u0438\u0442 \u0433\u043D\u0438\u043B\u044C \u0441 \u0441\u043E\u0431\u043E\u0439: \u0434\u043E\u0440\u043E\u0433\u043E\u0435 \u043B\u0435\u0447\u0435\u043D\u0438\u0435, \u043D\u043E \u043B\u0435\u0447\u0435\u043D\u0438\u0435.",
  "codex.rot.lore": "\u041D\u0430 \u0432\u0435\u0440\u0444\u044F\u0445 \u044D\u0442\u043E \u0437\u0432\u0430\u043B\u0438 \u043C\u0435\u0434\u043B\u0435\u043D\u043D\u044B\u043C \u043E\u0433\u043D\u0451\u043C \u0438 \u0437\u0430\u043A\u0440\u0430\u0448\u0438\u0432\u0430\u043B\u0438.",
  "codex.leech.title": "\u0412\u0418\u0420\u0423\u0421 LEECH",
  "codex.leech.what": "\u0428\u0442\u0430\u043C\u043C \u0447\u0438\u0442\u0430\u0435\u0442 \u0441\u0447\u0451\u0442, \u0430 \u043D\u0435 \u0441\u0442\u043E\u0439\u043A\u0443: \u043F\u044F\u0442\u044C \u043A\u0440\u0435\u0434\u0438\u0442\u043E\u0432 \u0438\u0441\u0447\u0435\u0437\u0430\u044E\u0442 \u043A\u0430\u0436\u0434\u044B\u0435 \u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0445\u043E\u0434\u043E\u0432.",
  "codex.leech.wrong": "\u041D\u0435 \u0441\u043F\u0435\u0448\u0438\u0442\u044C. \u042D\u0442\u043E \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0435 \u043D\u0430 \u0431\u043E\u0440\u0442\u0443, \u0447\u0442\u043E \u0431\u0435\u0440\u0451\u0442 \u043F\u043B\u0430\u0442\u0443 \u0437\u0430 \u0445\u043E\u0434\u044B.",
  "codex.leech.helps": "\u0412\u044B\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0438\u043B\u0438 \u0431\u044B\u0441\u0442\u0440\u043E \u0437\u0430\u043A\u043E\u043D\u0447\u0438\u0442\u044C \u0432\u044B\u043B\u0430\u0437\u043A\u0443 \u0438 \u043E\u0442\u043C\u044B\u0442\u044C \u0435\u0433\u043E \u043D\u0430 \u0432\u0435\u0440\u0441\u0442\u0430\u043A\u0435.",
  "codex.leech.lore": "\u0413\u0440\u043E\u0441\u0441\u0431\u0443\u0445, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0441\u0432\u043E\u0434\u0438\u0442 \u0441\u0430\u043C \u0441\u0435\u0431\u044F \u0435\u0449\u0451 \u0434\u043E\u043B\u0433\u043E \u043F\u043E\u0441\u043B\u0435 \u043A\u043E\u043D\u0442\u0440\u0430\u0431\u0430\u043D\u0434\u0438\u0441\u0442\u0430.",
  "codex.leash.title": "\u0412\u0418\u0420\u0423\u0421 LEASH",
  "codex.leash.what": "\u0428\u0442\u0430\u043C\u043C \u0438\u0434\u0451\u0442 \u0437\u0430 \u0441\u0430\u043C\u0438\u043C \u0434\u0440\u043E\u043D\u043E\u043C: \u043E\u0447\u043A\u043E \u044F\u0434\u0440\u0430 \u043A\u0430\u0436\u0434\u044B\u0435 \u0432\u043E\u0441\u0435\u043C\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0445\u043E\u0434\u043E\u0432, \u0430 \u044F\u0434\u0440\u043E \u043D\u0435 \u0447\u0438\u043D\u0438\u0442\u0441\u044F.",
  "codex.leash.wrong": "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0434\u043E\u0434\u0435\u043B\u0430\u0442\u044C \u0432\u044B\u043B\u0430\u0437\u043A\u0443. \u0422\u0440\u0438 \u0443\u0434\u0430\u0440\u0430 \u2014 \u044D\u0442\u043E \u0432\u0435\u0441\u044C \u0434\u0440\u043E\u043D.",
  "codex.leash.helps": "\u0411\u0440\u043E\u0441\u0438\u0442\u044C \u0432\u0441\u0451 \u0438 \u0432\u044B\u0447\u0438\u0441\u0442\u0438\u0442\u044C: \u0434\u0432\u0430 \u0445\u043E\u0434\u0430 \u0441\u0432\u0430\u0440\u043A\u0438.",
  "codex.leash.lore": "\u041A\u043E\u0440\u0441\u0430\u0440\u044B \u043F\u0438\u0441\u0430\u043B\u0438 \u0435\u0433\u043E, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u0431\u0438\u0440\u0430\u0442\u044C \u0434\u0440\u043E\u043D\u043E\u0432 \u0446\u0435\u043B\u0438\u043A\u043E\u043C, \u0430 \u043D\u0435 \u043F\u043E \u0447\u0430\u0441\u0442\u044F\u043C.",
  "codex.alert-1.title": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 1: \u0417\u0410\u041C\u0415\u0422\u0418\u041B",
  "codex.alert-1.what": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0447\u0442\u043E-\u0442\u043E \u0443\u0441\u043B\u044B\u0448\u0430\u043B. \u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u0442\u043E \u043D\u0435 \u0438\u0434\u0451\u0442, \u043D\u043E \u0448\u043A\u0430\u043B\u0430 \u0440\u0430\u0441\u0442\u0451\u0442 \u043E\u0442 \u0448\u0443\u043C\u0430 \u0438 \u043E\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u0438.",
  "codex.alert-1.wrong": "\u0414\u0440\u0430\u0442\u044C\u0441\u044F \u0442\u0430\u043C, \u0433\u0434\u0435 \u043C\u043E\u0436\u043D\u043E \u0431\u044B\u043B\u043E \u043D\u0435 \u0434\u0440\u0430\u0442\u044C\u0441\u044F. \u0411\u043E\u0439 \u0441\u043B\u044B\u0448\u043D\u043E \u0447\u0435\u0440\u0435\u0437 \u0432\u0435\u0441\u044C \u043A\u043E\u0440\u043F\u0443\u0441.",
  "codex.alert-1.helps": "\u0422\u0438\u0448\u0438\u043D\u0430 \u0441\u0431\u0438\u0432\u0430\u0435\u0442 \u0448\u043A\u0430\u043B\u0443: \u043F\u044F\u0442\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0442\u0438\u0445\u0438\u0445 \u0445\u043E\u0434\u043E\u0432 \u0432 \u043E\u0442\u043A\u0440\u044B\u0442\u0443\u044E, \u0432\u043E\u0441\u0435\u043C\u044C \u0432 \u0443\u043A\u0440\u044B\u0442\u0438\u0438.",
  "codex.alert-1.lore": "\u041C\u0451\u0440\u0442\u0432\u044B\u0435 \u043A\u043E\u0440\u0430\u0431\u043B\u0438 \u0441\u043B\u0443\u0448\u0430\u044E\u0442 \u0435\u0449\u0451 \u0434\u043E\u043B\u0433\u043E \u043F\u043E\u0441\u043B\u0435 \u0442\u043E\u0433\u043E, \u043A\u0430\u043A \u044D\u043A\u0438\u043F\u0430\u0436 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043B \u043E\u0442\u0432\u0435\u0447\u0430\u0442\u044C.",
  "codex.alert-2.title": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 2: \u0418\u0429\u0415\u0422",
  "codex.alert-2.what": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0441\u0442\u0430\u0432\u0438\u0442 \u043C\u0430\u0448\u0438\u043D\u0443 \u0442\u0430\u043C, \u0433\u0434\u0435 \u0442\u044B \u0443\u0436\u0435 \u043F\u0440\u043E\u0448\u0451\u043B. \u041E\u043D\u0430 \u0436\u0434\u0451\u0442, \u0430 \u043D\u0435 \u043E\u0445\u043E\u0442\u0438\u0442\u0441\u044F.",
  "codex.alert-2.wrong": "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0442\u044C\u0441\u044F \u0442\u0435\u043C \u0436\u0435 \u043F\u0443\u0442\u0451\u043C, \u043D\u0435 \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0432 \u0432\u043F\u0435\u0440\u0451\u0434.",
  "codex.alert-2.helps": "\u0418\u043C\u043F\u0443\u043B\u044C\u0441 \u0447\u0438\u0442\u0430\u0435\u0442 \u0434\u0432\u0430 \u043E\u0442\u0441\u0435\u043A\u0430 \u0432\u043F\u0435\u0440\u0451\u0434, \u043F\u043E\u043A\u0430 \u0442\u044B \u043D\u0435 \u0448\u0430\u0433\u043D\u0443\u043B \u0432 \u043E\u0434\u0438\u043D \u0438\u0437 \u043D\u0438\u0445.",
  "codex.alert-2.lore": "\u041E\u043D\u0430 \u0438\u0449\u0435\u0442 \u043D\u0435 \u0442\u0435\u0431\u044F. \u041E\u043D\u0430 \u0441\u0442\u043E\u0438\u0442 \u0442\u0430\u043C, \u0433\u0434\u0435 \u0447\u0442\u043E-\u0442\u043E \u0434\u0432\u0438\u0433\u0430\u043B\u043E\u0441\u044C.",
  "codex.alert-3.title": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 3: \u041E\u0425\u041E\u0422\u0410",
  "codex.alert-3.what": "\u041C\u0430\u0448\u0438\u043D\u0443 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442 \u0432 \u0442\u043E\u0442 \u043E\u0442\u0441\u0435\u043A, \u0433\u0434\u0435 \u0442\u044B \u0441\u0442\u043E\u0438\u0448\u044C, \u0438 \u0441 \u044D\u0442\u043E\u0439 \u0441\u0442\u0443\u043F\u0435\u043D\u0438 \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0437\u0430 \u0442\u043E\u0431\u043E\u0439 \u043F\u043E \u0434\u0432\u0435\u0440\u0438 \u043A\u0430\u0436\u0434\u044B\u0435 \u0434\u0435\u0441\u044F\u0442\u044C \u0445\u043E\u0434\u043E\u0432.",
  "codex.alert-3.wrong": "\u0423\u0445\u043E\u0434\u0438\u0442\u044C \u0432\u0433\u043B\u0443\u0431\u044C, \u043F\u043E\u043A\u0430 \u043F\u0443\u0442\u044C \u043D\u0430\u0440\u0443\u0436\u0443 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u044E\u0442.",
  "codex.alert-3.helps": "\u0417\u0430\u0432\u0430\u0440\u0438 \u0434\u0432\u0435\u0440\u044C \u0437\u0430 \u0441\u043E\u0431\u043E\u0439, \u0438 \u0442\u043E, \u0447\u0442\u043E \u0438\u0434\u0451\u0442 \u0441\u043B\u0435\u0434\u043E\u043C, \u0443\u043F\u0440\u0451\u0442\u0441\u044F \u0432 \u0441\u0442\u0435\u043D\u0443.",
  "codex.alert-3.turn": "\u041A\u0430\u0436\u0434\u0430\u044F \u0437\u0430\u043A\u0440\u044B\u0442\u0430\u044F \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0430 \u2014 \u0441\u0442\u0435\u043D\u0430 \u0438 \u0434\u043B\u044F \u043C\u0430\u0448\u0438\u043D \u0441\u0430\u043C\u043E\u0433\u043E \u043A\u043E\u0440\u0430\u0431\u043B\u044F.",
  "codex.alert-3.lore": "\u0414\u0432\u0435\u0440\u0438 \u0432\u0441\u0451 \u0435\u0449\u0451 \u0441\u043B\u0443\u0448\u0430\u044E\u0442\u0441\u044F \u044D\u043A\u0438\u043F\u0430\u0436\u0430, \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u043D\u0430 \u0431\u043E\u0440\u0442\u0443 \u043D\u0435\u0442.",
  "codex.alert-4.title": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 4: \u041A\u0410\u0420\u0410\u0422\u0415\u041B\u042C",
  "codex.alert-4.what": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0432\u044B\u0441\u044B\u043B\u0430\u0435\u0442 \u041A\u0410\u0420\u0410\u0422\u0415\u041B\u042F. \u041E\u043D \u0438\u0434\u0451\u0442 \u0438\u0441\u043A\u0430\u0442\u044C, \u0440\u0435\u0436\u0435\u0442 \u0437\u0430\u0432\u0430\u0440\u0435\u043D\u043D\u043E\u0435 \u0438 \u043D\u0430\u0445\u043E\u0434\u0438\u0442 \u0442\u0435\u0431\u044F \u0432 \u0443\u043A\u0440\u044B\u0442\u0438\u0438.",
  "codex.alert-4.wrong": "\u041F\u0435\u0440\u0435\u0441\u0442\u0440\u0435\u043B\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u043F\u0440\u043E\u0451\u043C. \u041E\u043D \u0431\u044C\u0451\u0442 \u0432 \u043E\u0442\u0432\u0435\u0442 \u043D\u0430 \u043E\u0442\u0441\u0435\u043A.",
  "codex.alert-4.helps": "\u041A\u043B\u0438\u043D\u043E\u043A \u0438\u043B\u0438 \u0440\u0435\u0437\u0430\u043A \u043A\u043E\u043D\u0447\u0430\u044E\u0442 \u0435\u0433\u043E \u0431\u044B\u0441\u0442\u0440\u0435\u0435 \u0432\u0441\u0435\u0433\u043E; \u043E\u0433\u043B\u0443\u0448\u0435\u043D\u0438\u0435 \u0434\u0430\u0451\u0442 \u0434\u0432\u0430 \u0445\u043E\u0434\u0430, \u0447\u0442\u043E\u0431\u044B \u0443\u0439\u0442\u0438.",
  "codex.alert-4.turn": "\u041F\u043E\u0434\u043D\u044F\u0442\u0430\u044F \u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u0434\u0432\u0430 \u0434\u0435\u043B\u0435\u043D\u0438\u044F, \u0442\u0430\u043A \u0447\u0442\u043E \u043A\u0430\u0440\u0430\u0442\u0435\u043B\u044C \u2014 \u0446\u0435\u043D\u0430 \u043E\u0431\u0435\u0437\u0432\u0440\u0435\u0436\u0438\u0432\u0430\u043D\u0438\u044F \u043A\u043E\u0440\u0430\u0431\u043B\u044F.",
  "codex.alert-4.lore": "\u041E\u0434\u043D\u043E\u0433\u043E \u043E\u0441\u0442\u0430\u0432\u043B\u044F\u043B\u0438 \u0431\u043E\u0434\u0440\u0441\u0442\u0432\u043E\u0432\u0430\u0442\u044C \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u043C \u043A\u043E\u0440\u043F\u0443\u0441\u0435, \u0440\u0430\u0434\u0438 \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u0441\u0442\u043E\u0438\u043B\u043E \u043A\u043E\u0433\u043E-\u0442\u043E \u0431\u0443\u0434\u0438\u0442\u044C.",
  "codex.alert-5.title": "\u0422\u0420\u0415\u0412\u041E\u0413\u0410 5: \u0421\u0410\u041C\u041E\u041F\u041E\u0414\u0420\u042B\u0412",
  "codex.alert-5.what": "\u0412\u0435\u0440\u0445 \u0448\u043A\u0430\u043B\u044B. \u041F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0438 \u043D\u0435 \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u044E\u0442\u0441\u044F, \u0430 \u0437\u0430\u043F\u0438\u0440\u0430\u044E\u0442\u0441\u044F, \u0438 \u0447\u0435\u0440\u0435\u0437 \u043F\u044F\u0442\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0445\u043E\u0434\u043E\u0432 \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u0432\u0435\u043D\u0442\u0438\u043B\u0438\u0440\u0443\u0435\u0442 \u043F\u043E \u043E\u0442\u0441\u0435\u043A\u0443 \u043A\u0430\u0436\u0434\u044B\u0435 \u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C.",
  "codex.alert-5.wrong": "\u0415\u0449\u0451 \u043E\u0434\u0438\u043D \u043E\u0442\u0441\u0435\u043A. \u041E\u0442\u0441\u0447\u0451\u0442 \u043D\u0430 \u043F\u0430\u043D\u0435\u043B\u0438 \u2014 \u0432\u0441\u0451 \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435, \u043A\u0430\u043A\u043E\u0435 \u0431\u0443\u0434\u0435\u0442.",
  "codex.alert-5.helps": "\u0423\u0445\u043E\u0434\u0438\u0442\u044C. \u0412\u0441\u0435 \u0442\u0440\u0438 \u043F\u043E\u0434\u043D\u044F\u0442\u044B\u0435 \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u0433\u0430\u0441\u044F\u0442 \u0448\u043A\u0430\u043B\u0443 \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C.",
  "codex.alert-5.turn": "\u041E\u0442\u0441\u0442\u044B\u043A\u043E\u0432\u043A\u0430 \u0441\u0431\u0438\u0432\u0430\u0435\u0442 \u0448\u043A\u0430\u043B\u0443 \u043D\u0430 \u0434\u0432\u0435 \u0441\u0442\u0443\u043F\u0435\u043D\u0438: \u0432\u0435\u0440\u043D\u0451\u0448\u044C\u0441\u044F \u043D\u0430 \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u043F\u043E\u0441\u043F\u043E\u043A\u043E\u0439\u043D\u0435\u0435.",
  "codex.alert-5.lore": "\u0421\u0430\u043C\u043E\u043F\u043E\u0434\u0440\u044B\u0432 \u0431\u044B\u043B \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u043C \u043F\u0440\u0438\u043A\u0430\u0437\u043E\u043C \u043A\u0430\u043F\u0438\u0442\u0430\u043D\u0430. \u041A\u043E\u0440\u0430\u0431\u043B\u044E \u043D\u0435 \u0441\u043A\u0430\u0437\u0430\u043B\u0438, \u0447\u0442\u043E \u043A\u0430\u043F\u0438\u0442\u0430\u043D\u0430 \u0443\u0436\u0435 \u043D\u0435\u0442.",
  "codex.vented.title": "\u0412\u0415\u041D\u0422\u0418\u041B\u0418\u0420\u041E\u0412\u0410\u041D\u041D\u042B\u0419 \u041E\u0422\u0421\u0415\u041A",
  "codex.vented.what": "\u0412\u0430\u043A\u0443\u0443\u043C. \u041D\u0438 \u0443\u043A\u0440\u044B\u0442\u0438\u044F, \u043D\u0438 \u0432\u0435\u0449\u0435\u0439, \u0438 \u043E\u0447\u043A\u043E \u0441 \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0433\u043E \u0441\u043B\u043E\u0442\u0430 \u0437\u0430 \u043A\u0430\u0436\u0434\u044B\u0439 \u0445\u043E\u0434, \u0447\u0442\u043E \u0442\u044B \u0432 \u043D\u0451\u043C \u0441\u0442\u043E\u0438\u0448\u044C.",
  "codex.vented.wrong": "\u041F\u0435\u0440\u0435\u0445\u043E\u0434\u0438\u0442\u044C \u0435\u0433\u043E \u043C\u0435\u0434\u043B\u0435\u043D\u043D\u043E \u0438\u043B\u0438 \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u0442\u044C\u0441\u044F \u0434\u0440\u0430\u0442\u044C\u0441\u044F \u0432\u043D\u0443\u0442\u0440\u0438.",
  "codex.vented.helps": "\u041F\u0440\u043E\u0439\u0442\u0438 \u043E\u0434\u043D\u0438\u043C \u0445\u043E\u0434\u043E\u043C, \u043E\u0442\u043A\u0440\u044B\u0432 \u0441\u0430\u043C\u044B\u0439 \u0434\u0435\u0448\u0451\u0432\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C.",
  "codex.vented.lore": "\u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0432\u044B\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u0442 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0432\u043E\u0437\u0434\u0443\u0445, \u043B\u0438\u0448\u044C \u0431\u044B \u0438\u0437\u0431\u0430\u0432\u0438\u0442\u044C\u0441\u044F \u043E\u0442 \u0442\u0435\u0431\u044F.",
  "codex.blade.title": "\u041A-\u041A\u041B\u0418\u041D\u041E\u041A, \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044F",
  "codex.blade.what": "\u0414\u0432\u0435 \u043A\u043E\u0441\u0442\u0438 \u0442\u0430\u043C, \u0433\u0434\u0435 \u0443 \u0440\u0435\u0437\u0430\u043A\u0430 \u043E\u0434\u043D\u0430, \u0438 \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0443 \u043E\u043D \u0432\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0440\u043E\u0432\u043D\u043E \u043A\u0430\u043A \u0440\u0435\u0437\u0430\u043A. \u0412 \u0441\u0442\u043E\u0439\u043A\u0435 \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044E \u043C\u0435\u0442\u0438\u0442 \u0437\u043D\u0430\u043A \u25AA: \u0432\u0435\u0440\u0441\u0442\u0430\u043A \u0435\u0451 \u043D\u0435 \u0447\u0438\u043D\u0438\u0442 \u0438 \u043D\u0435 \u043D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u0435\u0442.",
  "codex.blade.wrong": "\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0435\u0433\u043E \u0440\u0430\u0434\u0438 \u043B\u0443\u0447\u0448\u0435\u0433\u043E \u0441\u043B\u043E\u0442\u0430 \u043F\u043E\u0442\u043E\u043C. \u041D\u0430 \u043F\u043E\u043B\u043A\u0430\u0445 \u0442\u0430\u043A\u043E\u0433\u043E \u043D\u0435\u0442.",
  "codex.blade.helps": "\u041E\u043D \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0440\u0435\u0437\u0430\u043A\u043E\u043C \u0432\u0435\u0437\u0434\u0435, \u0433\u0434\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u044E\u0442 \u0440\u0435\u0437\u0430\u043A.",
  "codex.blade.lore": "\u041E\u0434\u0438\u043D \u0438\u0437 \u0434\u0435\u0432\u044F\u0442\u0438 \u0432 \u0441\u0435\u0440\u0438\u0438, \u0438 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u0432\u043E\u0441\u0435\u043C\u044C \u0443\u0436\u0435 \u043D\u0435 \u0432\u0435\u0440\u043D\u0443\u0442\u0441\u044F.",
  "codex.shocker.title": "\u0428\u041E\u041A\u0415\u0420, \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044F",
  "codex.shocker.what": "\u0422\u0440\u0438 \u0437\u0430\u0440\u044F\u0434\u0430, \u0438 \u043A\u0430\u0436\u0434\u044B\u0439 \u2014 \u0442\u0438\u0448\u0438\u043D\u0430 \u0432 \u044D\u0442\u043E\u043C \u043E\u0442\u0441\u0435\u043A\u0435 \u043D\u0430 \u0434\u0432\u0430 \u0445\u043E\u0434\u0430, \u0432\u043C\u0435\u0441\u0442\u0435 \u0441 \u043C\u0435\u0445\u0430\u043D\u0438\u0437\u043C\u0430\u043C\u0438. \u0412 \u0441\u0442\u043E\u0439\u043A\u0435 \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044E \u043C\u0435\u0442\u0438\u0442 \u0437\u043D\u0430\u043A \u25AA: \u0432\u0435\u0440\u0441\u0442\u0430\u043A \u0435\u0451 \u043D\u0435 \u0447\u0438\u043D\u0438\u0442 \u0438 \u043D\u0435 \u043D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u0435\u0442.",
  "codex.shocker.wrong": "\u0411\u0435\u0440\u0435\u0447\u044C \u0432\u0441\u0435 \u0442\u0440\u0438 \u0434\u043E \u0431\u043E\u044F, \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u0442\u0430\u043A \u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442. \u041E\u043D \u043D\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u0440\u044F\u0436\u0430\u0435\u0442\u0441\u044F.",
  "codex.shocker.helps": "\u041E\u043D \u0441\u0442\u0440\u0435\u043B\u044F\u0435\u0442 \u0438\u0437 \u043D\u0443\u043C\u0435\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0433\u043E \u0441\u043F\u0438\u0441\u043A\u0430, \u0430 \u043D\u0435 \u0441 \u0431\u0443\u043A\u0432\u044B.",
  "codex.shocker.lore": "\u0421\u0434\u0435\u043B\u0430\u043D \u0434\u043B\u044F \u0430\u0431\u043E\u0440\u0434\u0430\u0436\u043D\u0438\u043A\u043E\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u043C \u043D\u0443\u0436\u0435\u043D \u0431\u044B\u043B \u043D\u0435\u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D\u043D\u044B\u0439 \u0433\u0440\u0443\u0437.",
  "codex.lattice.title": "\u0420\u0415\u0428\u0401\u0422\u041A\u0410, \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044F",
  "codex.lattice.what": "\u0422\u0440\u0438\u0434\u0446\u0430\u0442\u044C \u043F\u0440\u043E\u0447\u043D\u043E\u0441\u0442\u0438 \u0438 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0435 \u043F\u043E\u0441\u0442\u043E\u044F\u043D\u043D\u043E\u0435 \u043E\u0447\u043A\u043E \u0431\u0440\u043E\u043D\u0438 \u0432\u043E \u0432\u0441\u0435\u0439 \u0438\u0433\u0440\u0435. \u0412 \u0441\u0442\u043E\u0439\u043A\u0435 \u0440\u0435\u043B\u0438\u043A\u0432\u0438\u044E \u043C\u0435\u0442\u0438\u0442 \u0437\u043D\u0430\u043A \u25AA: \u0432\u0435\u0440\u0441\u0442\u0430\u043A \u0435\u0451 \u043D\u0435 \u0447\u0438\u043D\u0438\u0442 \u0438 \u043D\u0435 \u043D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u0435\u0442.",
  "codex.lattice.wrong": "\u0416\u0434\u0430\u0442\u044C, \u0447\u0442\u043E \u0435\u0451 \u043F\u043E\u0447\u0438\u043D\u044F\u0442 \u043D\u0430 \u0432\u0435\u0440\u0441\u0442\u0430\u043A\u0435. \u0420\u0435\u043B\u0438\u043A\u0432\u0438\u0438 \u043D\u0435 \u0447\u0438\u043D\u044F\u0442 \u043D\u0438 \u0437\u0434\u0435\u0441\u044C, \u043D\u0438 \u0434\u043E\u043C\u0430.",
  "codex.lattice.helps": "\u041E\u043D\u0430 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0431\u0440\u043E\u043D\u0451\u0439 \u0432\u0435\u0437\u0434\u0435, \u0433\u0434\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u044E\u0442 \u0431\u0440\u043E\u043D\u044E.",
  "codex.lattice.lore": "\u0415\u0451 \u043F\u043B\u0435\u043B\u0438, \u0430 \u043D\u0435 \u043E\u0442\u043B\u0438\u0432\u0430\u043B\u0438, \u0438 \u043A\u0430\u043A \u2014 \u043D\u0435 \u043F\u043E\u043C\u043D\u0438\u0442 \u043D\u0438\u043A\u0442\u043E \u0438\u0437 \u0436\u0438\u0432\u044B\u0445.",
  "codex.ghost.title": "\u041F\u0420\u0418\u0417\u0420\u0410\u041A",
  "codex.ghost.what": "\u0422\u043E, \u0447\u0442\u043E \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C \u043E\u0442 \u043F\u043E\u0433\u0438\u0431\u0448\u0435\u0433\u043E \u0437\u0434\u0435\u0441\u044C \u0434\u0440\u043E\u043D\u0430. \u041E\u043D \u043D\u043E\u0441\u0438\u0442 \u0442\u0443 \u0436\u0435 \u0441\u0442\u043E\u0439\u043A\u0443 \u0438 \u0431\u044C\u0451\u0442 \u043B\u0443\u0447\u0448\u0438\u043C, \u0447\u0442\u043E \u043D\u0430 \u043D\u0435\u0439 \u0431\u044B\u043B\u043E.",
  "codex.ghost.wrong": "\u0418\u0434\u0442\u0438 \u0437\u0430 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u043E\u0431\u043B\u043E\u043C\u043A\u043E\u043C, \u043D\u0435 \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u0430\u0432, \u0447\u0442\u043E \u043D\u0430 \u043D\u0451\u043C \u0432\u0438\u0441\u0435\u043B\u043E.",
  "codex.ghost.helps": "\u0428\u043B\u044E\u0437 \u043E\u043D \u043D\u0435 \u043E\u0442\u043A\u0440\u043E\u0435\u0442, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0441 \u043A\u043E\u0440\u043F\u0443\u0441\u0430 \u043D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u0443\u0439\u0434\u0451\u0442.",
  "codex.ghost.turn": "\u0423\u0431\u0435\u0439 \u0435\u0433\u043E \u2014 \u0438 \u0432\u0441\u0451, \u0447\u0442\u043E \u043E\u043D \u043D\u043E\u0441\u0438\u0442, \u0441\u043D\u043E\u0432\u0430 \u043B\u0435\u0436\u0438\u0442 \u043D\u0430 \u043F\u0430\u043B\u0443\u0431\u0435.",
  "codex.ghost.lore": "\u041F\u0440\u043E \u044D\u0442\u0443 \u0447\u0430\u0441\u0442\u044C \u0440\u0435\u043C\u0435\u0441\u043B\u0430 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0430\u0445 \u043D\u0435 \u0433\u043E\u0432\u043E\u0440\u044F\u0442.",
  "codex.rival.title": "\u0427\u0423\u0416\u041E\u0419 \u0414\u0420\u041E\u041D",
  "codex.rival.what": "\u0414\u0440\u043E\u043D \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0431\u0443\u043A\u0441\u0438\u0440\u0430 \u043D\u0430 \u0442\u043E\u043C \u0436\u0435 \u043A\u043E\u0440\u043F\u0443\u0441\u0435. \u041E\u043D \u0440\u0435\u0436\u0435\u0442 \u0434\u0432\u0435\u0440\u0438 \u0438 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0435\u0442 \u0441\u0438\u0441\u0442\u0435\u043C\u044B, \u0430 \u0437\u0430 \u0442\u043E\u0431\u043E\u0439 \u043D\u0435 \u0438\u0434\u0451\u0442.",
  "codex.rival.wrong": "\u041D\u0435 \u0442\u0440\u043E\u0433\u0430\u0442\u044C \u0435\u0433\u043E. \u0412\u0441\u0451, \u0447\u0442\u043E \u043E\u043D \u043F\u043E\u0434\u043D\u044F\u043B, \u2014 \u0434\u0435\u043D\u044C\u0433\u0438, \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u0442\u044B \u043D\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u0448\u044C.",
  "codex.rival.helps": "\u0421\u0435\u043C\u044C \u043E\u0447\u043A\u043E\u0432 \u0436\u0438\u0437\u043D\u0438 \u0438 \u043D\u0438\u043A\u0430\u043A\u043E\u0433\u043E \u0438\u043D\u0442\u0435\u0440\u0435\u0441\u0430 \u043A \u0434\u0440\u0430\u043A\u0435: \u0431\u043E\u0439 \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0448\u044C \u0442\u044B.",
  "codex.rival.turn": "\u041E\u043D \u043D\u0435\u0441\u0451\u0442 \u0432\u0441\u0451, \u0447\u0442\u043E \u0437\u0430\u0431\u0440\u0430\u043B, \u0438 \u043E\u0431\u043B\u043E\u043C\u043E\u043A \u0440\u043E\u043D\u044F\u0435\u0442 \u044D\u0442\u043E \u0446\u0435\u043B\u0438\u043A\u043E\u043C.",
  "codex.rival.lore": "\u0423 \u0447\u044C\u0435\u0433\u043E-\u0442\u043E \u0435\u0449\u0451 \u043E\u0442\u0446\u0430 \u0442\u043E\u0436\u0435 \u0431\u044B\u043B \u0431\u0443\u043A\u0441\u0438\u0440.",
  "codex.sentry-turret.title": "\u0422\u0423\u0420\u0415\u041B\u042C",
  "codex.sentry-turret.what": "\u0421\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u043E\u0431\u043E\u0440\u043E\u043D\u0430 \u043A\u043E\u0440\u0430\u0431\u043B\u044F. \u0421 \u043C\u0435\u0441\u0442\u0430 \u043D\u0435 \u0441\u0445\u043E\u0434\u0438\u0442 \u0438 \u0431\u044C\u0451\u0442 \u043D\u0430 \u043E\u0442\u0441\u0435\u043A \u0447\u0435\u0440\u0435\u0437 \u043B\u044E\u0431\u0443\u044E \u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u0443\u044E \u043E\u0442\u043A\u0440\u044B\u0442\u043E\u0439 \u0434\u0432\u0435\u0440\u044C.",
  "codex.sentry-turret.wrong": "\u0412\u0441\u0442\u0430\u0442\u044C \u0432 \u043F\u0440\u043E\u0451\u043C\u0435, \u0447\u0442\u043E\u0431\u044B \u0440\u0430\u0437\u0433\u043B\u044F\u0434\u0435\u0442\u044C \u0435\u0451.",
  "codex.sentry-turret.helps": "\u0417\u0430\u043A\u0440\u043E\u0439 \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0443 \u0438\u043B\u0438 \u0432\u043E\u0437\u044C\u043C\u0438 \u0435\u0451 \u0432 \u043E\u0442\u0441\u0435\u043A\u0435: \u043F\u044F\u0442\u044C \u043E\u0447\u043A\u043E\u0432 \u0436\u0438\u0437\u043D\u0438 \u0438 \u044D\u043C\u0438\u0442\u0442\u0435\u0440 \u0432 \u043E\u0431\u043B\u043E\u043C\u043A\u0435.",
  "codex.sentry-turret.lore": "\u041F\u0440\u0438\u0432\u0430\u0440\u0435\u043D\u0430 \u0442\u0430\u043C, \u0433\u0434\u0435 \u0431\u044B\u043B \u0433\u0440\u0443\u0437, \u0438 \u0441 \u0442\u0435\u0445 \u043F\u043E\u0440 \u043D\u0435 \u0434\u0432\u0438\u0433\u0430\u043B\u0430\u0441\u044C.",
  "codex.jammer.title": "\u0413\u041B\u0423\u0428\u0418\u041B\u041A\u0410",
  "codex.jammer.what": "\u041F\u043E\u043A\u0430 \u043E\u043D\u0430 \u0441\u0442\u043E\u0438\u0442 \u0432 \u0442\u0432\u043E\u0451\u043C \u043E\u0442\u0441\u0435\u043A\u0435, \u0441\u0442\u043E\u0439\u043A\u0430 \u043D\u0435 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u0432\u043E\u043E\u0431\u0449\u0435. \u0420\u0430\u043D\u0435\u043D\u0430\u044F \u2014 \u0443\u0431\u0435\u0433\u0430\u0435\u0442.",
  "codex.jammer.wrong": "\u0422\u044F\u043D\u0443\u0442\u044C\u0441\u044F \u043A \u043C\u043E\u0434\u0443\u043B\u044E. \u041F\u043E\u043A\u0430 \u043E\u043D\u0430 \u0437\u0434\u0435\u0441\u044C, \u043F\u043E\u0442\u0440\u0430\u0442\u0438\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F \u043D\u0438\u0447\u0435\u0433\u043E.",
  "codex.jammer.helps": "\u0423\u0434\u0430\u0440 \u0432 \u0431\u043B\u0438\u0436\u043D\u0435\u043C \u0431\u043E\u044E \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442, \u0438 \u0432\u044B\u0439\u0442\u0438 \u0438\u0437 \u043E\u0442\u0441\u0435\u043A\u0430 \u0442\u043E\u0436\u0435 \u043F\u043E\u043C\u043E\u0433\u0430\u0435\u0442.",
  "codex.jammer.lore": "\u0421\u0431\u043E\u0440\u0449\u0438\u043A\u0438 \u0437\u0432\u0430\u043B\u0438 \u0435\u0451 \u0442\u0438\u0445\u0430\u0440\u0451\u043C.",
  "codex.bloom.title": "\u0426\u0412\u0415\u0422\u0415\u041D\u0418\u0415",
  "codex.bloom.what": "\u0412\u044B\u0432\u043E\u0434\u043E\u043A. \u0421\u0430\u043C\u043E \u043D\u0435 \u0431\u044C\u0451\u0442: \u043A\u0430\u0436\u0434\u044B\u0435 \u0448\u0435\u0441\u0442\u044C \u0445\u043E\u0434\u043E\u0432 \u0432\u044B\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0435\u0449\u0451 \u043E\u0434\u043D\u043E\u0433\u043E \u043F\u043E\u043B\u0437\u0443\u043D\u0430, \u0434\u043E \u0447\u0435\u0442\u044B\u0440\u0451\u0445 \u0436\u0438\u0432\u044B\u0445 \u0440\u0430\u0437\u043E\u043C.",
  "codex.bloom.wrong": "\u0414\u0440\u0430\u0442\u044C\u0441\u044F \u0441 \u0432\u044B\u0432\u043E\u0434\u043A\u043E\u043C \u0432\u043C\u0435\u0441\u0442\u043E \u0442\u043E\u0433\u043E, \u043A\u0442\u043E \u0435\u0433\u043E \u0434\u0435\u043B\u0430\u0435\u0442.",
  "codex.bloom.helps": "\u0412\u043E\u0441\u0435\u043C\u044C \u043E\u0447\u043A\u043E\u0432 \u0436\u0438\u0437\u043D\u0438, \u0438 \u0441\u0434\u0430\u0447\u0438 \u043E\u043D\u043E \u043D\u0435 \u0434\u0430\u0451\u0442.",
  "codex.bloom.turn": "\u0420\u0430\u0437\u0434\u0435\u043B\u0430\u043D\u043D\u043E\u0435, \u043E\u043D\u043E \u0441\u0442\u043E\u0438\u0442 \u0434\u0432\u0430 \u043A\u0440\u0435\u0434\u0438\u0442\u0430: \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0435 \u0437\u0434\u0435\u0441\u044C, \u0447\u0442\u043E \u043F\u043B\u0430\u0442\u0438\u0442.",
  "codex.bloom.lore": "\u0427\u0442\u043E-\u0442\u043E \u043F\u0440\u043E\u0431\u0440\u0430\u043B\u043E\u0441\u044C \u0432 \u0433\u0438\u0434\u0440\u043E\u043F\u043E\u043D\u0438\u043A\u0443, \u0438 \u0435\u0439 \u0442\u0430\u043C \u043F\u043E\u043D\u0440\u0430\u0432\u0438\u043B\u043E\u0441\u044C.",
  "codex.crawler.title": "\u041F\u041E\u041B\u0417\u0423\u041D",
  "codex.crawler.what": "\u0415\u0434\u043A\u0438\u0439, \u0438 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u0430\u044F \u0442\u0432\u0430\u0440\u044C \u043D\u0430 \u0431\u043E\u0440\u0442\u0443, \u043F\u043E\u0441\u043B\u0435 \u043A\u043E\u0442\u043E\u0440\u043E\u0439 \u043D\u0435 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u043C\u043E\u0434\u0443\u043B\u044F.",
  "codex.crawler.wrong": "\u041C\u0435\u043D\u044F\u0442\u044C \u043D\u0430 \u043D\u0435\u0433\u043E \u043F\u0440\u043E\u0447\u043D\u043E\u0441\u0442\u044C. \u0411\u0440\u043E\u043D\u044F \u0432 \u0435\u0433\u043E \u0446\u0435\u043F\u043E\u0447\u043A\u0435 \u043D\u0435 \u0441\u0442\u043E\u0438\u0442, \u0430 \u043E\u0431\u043B\u043E\u043C\u043E\u043A \u043D\u0435 \u043F\u043B\u0430\u0442\u0438\u0442.",
  "codex.crawler.helps": "\u0423\u0439\u0442\u0438. \u0422\u0440\u0438 \u043E\u0447\u043A\u0430 \u0436\u0438\u0437\u043D\u0438, \u0435\u0441\u043B\u0438 \u0432\u0441\u0451 \u0436\u0435 \u043F\u0440\u0438\u0434\u0451\u0442\u0441\u044F.",
  "codex.crawler.lore": "\u041D\u0435 \u043C\u0430\u0448\u0438\u043D\u0430, \u0447\u0442\u043E \u0431\u044B \u043D\u0438 \u0431\u044B\u043B\u043E \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u043E \u0432 \u0434\u0435\u043A\u043B\u0430\u0440\u0430\u0446\u0438\u0438.",
  "codex.scout.title": "\u0420\u0410\u0417\u0412\u0415\u0414\u0427\u0418\u041A",
  "codex.scout.what": "\u0415\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439, \u043A\u0442\u043E \u043D\u0435 \u0441\u043F\u0438\u0442 \u0443 \u0448\u043B\u044E\u0437\u0430. \u0421\u043C\u043E\u0442\u0440\u0438\u0442 \u043D\u0430 \u043E\u0442\u0441\u0435\u043A \u0432\u043F\u0435\u0440\u0451\u0434 \u0438 \u0432\u0438\u0434\u0438\u0442 \u0442\u0435\u0431\u044F \u0432 \u0443\u043A\u0440\u044B\u0442\u0438\u0438.",
  "codex.scout.wrong": "\u041F\u0440\u044F\u0442\u0430\u0442\u044C\u0441\u044F. \u0414\u043B\u044F \u043D\u0435\u0433\u043E \u0443\u043A\u0440\u044B\u0442\u0438\u0435 \u2014 \u043D\u0435 \u0443\u043A\u0440\u044B\u0442\u0438\u0435.",
  "codex.scout.helps": "\u0422\u0440\u0438 \u043E\u0447\u043A\u0430 \u0436\u0438\u0437\u043D\u0438, \u0430 \u0432 \u043E\u0431\u043B\u043E\u043C\u043A\u0435 \u043B\u0435\u0436\u0438\u0442 \u0441\u043A\u0430\u043D\u0435\u0440.",
  "codex.scout.lore": "\u041E\u043D \u043D\u0435 \u0434\u0435\u0440\u0451\u0442\u0441\u044F \u0441 \u0442\u043E\u0431\u043E\u0439. \u041E\u043D \u0433\u043E\u0432\u043E\u0440\u0438\u0442 \u043A\u043E\u0440\u0430\u0431\u043B\u044E, \u0433\u0434\u0435 \u0442\u044B.",
  "codex.enforcer.title": "\u041A\u0410\u0420\u0410\u0422\u0415\u041B\u042C",
  "codex.enforcer.what": "\u041E\u0445\u043E\u0442\u043D\u0438\u043A \u043A\u043E\u0440\u0430\u0431\u043B\u044F. \u0418\u0434\u0451\u0442 \u0442\u0443\u0434\u0430, \u0433\u0434\u0435 \u0442\u0435\u0431\u044F \u0432\u0438\u0434\u0435\u043B\u0438 \u0438\u043B\u0438 \u0441\u043B\u044B\u0448\u0430\u043B\u0438 \u0432 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0440\u0430\u0437, \u0438 \u043A\u0430\u0436\u0434\u044B\u0439 \u0443\u0434\u0430\u0440 \u043A\u043B\u0430\u0434\u0451\u0442 \u0432 \u0441\u0430\u043C\u044B\u0439 \u0441\u043B\u0430\u0431\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C \u0441\u0442\u043E\u0439\u043A\u0438.",
  "codex.enforcer.wrong": "\u0417\u0430\u0432\u0430\u0440\u0438\u0442\u044C \u0434\u0432\u0435\u0440\u044C \u0438 \u0436\u0434\u0430\u0442\u044C. \u0417\u0430\u043F\u0435\u0440\u0442\u0443\u044E \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0443 \u043E\u043D \u0432\u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0437\u0430 \u0442\u0440\u0438 \u0445\u043E\u0434\u0430, \u0430 \u0443\u043A\u0440\u044B\u0442\u0438\u0435 \u043E\u0442 \u043D\u0435\u0433\u043E \u043D\u0435 \u0441\u043F\u0430\u0441\u0430\u0435\u0442.",
  "codex.enforcer.helps": "\u0414\u0435\u0441\u044F\u0442\u044C \u043E\u0447\u043A\u043E\u0432 \u0436\u0438\u0437\u043D\u0438 \u0438 \u044D\u043C\u0438\u0442\u0442\u0435\u0440 \u0432 \u043E\u0431\u043B\u043E\u043C\u043A\u0435. \u0418\u043B\u0438 \u0443\u0439\u0434\u0438: \u043E\u043D \u043E\u0431\u044B\u0449\u0435\u0442 \u043E\u0442\u0441\u0435\u043A, \u0433\u0434\u0435 \u0442\u0435\u0431\u044F \u0441\u043B\u044B\u0448\u0430\u043B, \u0438 \u0431\u0440\u043E\u0441\u0438\u0442 \u043F\u043E\u0433\u043E\u043D\u044E.",
  "codex.enforcer.lore": "\u0412 \u0434\u0435\u043A\u043B\u0430\u0440\u0430\u0446\u0438\u0438 \u0443 \u043D\u0435\u0433\u043E \u043D\u0435\u0442 \u0438\u043C\u0435\u043D\u0438. \u042D\u043A\u0438\u043F\u0430\u0436\u0438 \u0443\u0437\u043D\u0430\u0432\u0430\u043B\u0438 \u0435\u0433\u043E \u043F\u043E \u0437\u0432\u0443\u043A\u0443 \u0434\u0432\u0435\u0440\u0438.",
  "codex.security-unit.title": "\u041E\u0425\u0420\u0410\u041D\u041D\u0418\u041A",
  "codex.security-unit.what": "\u041E\u0445\u0440\u0430\u043D\u0430 \u043A\u043E\u0440\u0430\u0431\u043B\u044F. \u0412\u043E\u0441\u0435\u043C\u044C \u043E\u0447\u043A\u043E\u0432 \u0436\u0438\u0437\u043D\u0438 \u0438 \u043D\u0438\u043A\u0430\u043A\u0438\u0445 \u0444\u043E\u043A\u0443\u0441\u043E\u0432: \u0432\u0438\u0434\u0438\u0442 \u043D\u0430 \u043E\u0442\u0441\u0435\u043A \u0432\u043F\u0435\u0440\u0451\u0434 \u0438 \u0438\u0434\u0451\u0442 \u043F\u0440\u044F\u043C\u043E \u043D\u0430 \u0442\u0435\u0431\u044F.",
  "codex.security-unit.wrong": "\u0420\u0430\u0437\u043C\u0435\u043D\u0438\u0432\u0430\u0442\u044C\u0441\u044F \u0443\u0434\u0430\u0440\u0430\u043C\u0438 \u043D\u0430 \u0431\u0438\u0442\u043E\u0439 \u0441\u0442\u043E\u0439\u043A\u0435. \u0412\u043E\u0441\u0435\u043C\u044C \u043E\u0447\u043A\u043E\u0432 \u2014 \u0434\u043E\u043B\u0433\u0438\u0439 \u0431\u043E\u0439, \u0438 \u043A\u0430\u0436\u0434\u044B\u0439 \u0435\u0433\u043E \u0443\u0434\u0430\u0440 \u0441\u043D\u0438\u043C\u0430\u0435\u0442 \u043F\u0440\u043E\u0447\u043D\u043E\u0441\u0442\u044C \u0441 \u043C\u043E\u0434\u0443\u043B\u044F.",
  "codex.security-unit.helps": "\u0420\u0435\u0437\u0430\u043A \u043A\u043E\u043D\u0447\u0430\u0435\u0442 \u0435\u0433\u043E \u0431\u044B\u0441\u0442\u0440\u0435\u0435 \u0432\u0441\u0435\u0433\u043E, \u0430 \u0432 \u043E\u0431\u043B\u043E\u043C\u043A\u0435 \u043B\u0435\u0436\u0438\u0442 \u0441\u0432\u043E\u0439 \u0440\u0435\u0437\u0430\u043A. \u0417\u0430\u0432\u0430\u0440\u0435\u043D\u043D\u0430\u044F \u0434\u0432\u0435\u0440\u044C \u0435\u0433\u043E \u0434\u0435\u0440\u0436\u0438\u0442.",
  "codex.security-unit.lore": "\u0428\u0442\u0430\u0442\u043D\u0430\u044F \u043A\u043E\u043C\u043F\u043B\u0435\u043A\u0442\u0430\u0446\u0438\u044F \u043B\u044E\u0431\u043E\u0433\u043E \u043A\u043E\u0440\u043F\u0443\u0441\u0430, \u0447\u0435\u0439 \u0433\u0440\u0443\u0437 \u0441\u0442\u043E\u0438\u043B\u043E \u0441\u0442\u0440\u0430\u0445\u043E\u0432\u0430\u0442\u044C.",
  "codex.scrapper.title": "\u041C\u0423\u0421\u041E\u0420\u0429\u0418\u041A",
  "codex.scrapper.what": "\u041C\u0430\u0448\u0438\u043D\u0430 \u0433\u043B\u0443\u0431\u043E\u043A\u0438\u0445 \u043A\u043E\u0440\u043F\u0443\u0441\u043E\u0432, \u0445\u043E\u0434\u0438\u0442 \u0441\u0442\u0430\u0435\u0439. \u041A\u0430\u0436\u0434\u044B\u0439 \u0443\u0434\u0430\u0440 \u2014 \u0432 \u0441\u0430\u043C\u044B\u0439 \u0441\u043B\u0430\u0431\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C \u0441\u0442\u043E\u0439\u043A\u0438, \u0430 \u0442\u044F\u0436\u0435\u043B\u043E \u0440\u0430\u043D\u0435\u043D\u0430\u044F \u0443\u0431\u0435\u0433\u0430\u0435\u0442.",
  "codex.scrapper.wrong": "\u041B\u0435\u0442\u0435\u0442\u044C \u0441 \u0438\u0437\u043D\u043E\u0448\u0435\u043D\u043D\u044B\u043C \u043C\u043E\u0434\u0443\u043B\u0435\u043C \u0432 \u0441\u0442\u043E\u0439\u043A\u0435. \u041E\u043D \u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0432\u0441\u0451 \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u043E\u0435 \u0438 \u0431\u044C\u0451\u0442 \u0438\u043C\u0435\u043D\u043D\u043E \u0432 \u043D\u0435\u0433\u043E.",
  "codex.scrapper.helps": "\u041F\u043E\u0447\u0438\u043D\u0438 \u0441\u043B\u0430\u0431\u044B\u0439 \u043C\u043E\u0434\u0443\u043B\u044C \u0438\u043B\u0438 \u0441\u043D\u0438\u043C\u0438 \u0435\u0433\u043E \u0432 \u0442\u0440\u044E\u043C \u0434\u043E \u0432\u044B\u043B\u0435\u0442\u0430. \u0428\u0435\u0441\u0442\u044C \u043E\u0447\u043A\u043E\u0432 \u0436\u0438\u0437\u043D\u0438, \u0430 \u0432 \u043E\u0431\u043B\u043E\u043C\u043A\u0435 \u2014 \u042D\u041C\u0418.",
  "codex.scrapper.lore": "\u0420\u0430\u0437\u0431\u0438\u0440\u0430\u0435\u0442 \u043A\u043E\u0440\u0430\u0431\u043B\u0438 \u043D\u0430 \u0437\u0430\u043F\u0447\u0430\u0441\u0442\u0438. \u0414\u0440\u043E\u043D \u2014 \u0442\u043E\u0436\u0435 \u0437\u0430\u043F\u0447\u0430\u0441\u0442\u0438.",
  "codex.frost.title": "\u041B\u0401\u0414",
  "codex.frost.what": "\u0418\u043D\u0435\u0439 \u043D\u0430 \u0432\u0441\u0451\u043C. \u041F\u043E\u043A\u0430 \u0442\u044B \u0441\u0442\u043E\u0438\u0448\u044C \u0432 \u043D\u0451\u043C, \u0414\u0412\u0418\u0413\u0410\u0422\u0415\u041B\u0418 \u0442\u0435\u0440\u044F\u044E\u0442 20 \u0445\u043E\u0434\u0430, \u0438 \u043A\u0430\u0436\u0434\u0430\u044F \u043C\u0430\u0448\u0438\u043D\u0430 \u043D\u0430 \u0431\u043E\u0440\u0442\u0443 \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u043B\u0438\u0448\u043D\u0438\u0435 \u0445\u043E\u0434\u044B \u043F\u0440\u043E\u0442\u0438\u0432 \u0442\u0435\u0431\u044F.",
  "codex.frost.wrong": "\u0417\u0430\u0434\u0435\u0440\u0436\u0430\u0442\u044C\u0441\u044F: \u0431\u043E\u0439, \u0440\u0430\u0437\u0431\u043E\u0440\u043A\u0430 \u043B\u043E\u043C\u0430, \u043F\u043E\u0434\u044A\u0451\u043C \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u043D\u0430 \u043B\u044C\u0434\u0443.",
  "codex.frost.helps": "\u041F\u0440\u043E\u0439\u0442\u0438 \u043D\u0430\u0441\u043A\u0432\u043E\u0437\u044C. \u0418\u043B\u0438 \u043E\u0442\u0434\u0430\u0442\u044C \u043E\u0447\u043A\u043E \u0411\u0410\u0422\u0410\u0420\u0415\u0418 \u2014 \u043E\u0442\u0441\u0435\u043A \u0442\u0451\u043F\u043B\u044B\u0439 \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u0432\u044B\u043B\u0430\u0437\u043A\u0438.",
  "codex.frost.lore": "\u0416\u0438\u0437\u043D\u0435\u043E\u0431\u0435\u0441\u043F\u0435\u0447\u0435\u043D\u0438\u0435 \u043E\u0442\u043A\u0430\u0437\u0430\u043B\u043E \u0437\u0434\u0435\u0441\u044C \u043F\u0435\u0440\u0432\u044B\u043C. \u0414\u044B\u0445\u0430\u043D\u0438\u0435 \u044D\u043A\u0438\u043F\u0430\u0436\u0430 \u0434\u043E \u0441\u0438\u0445 \u043F\u043E\u0440 \u043D\u0430 \u0441\u0442\u0435\u043D\u0430\u0445.",
  "codex.smoke.title": "\u0414\u042B\u041C",
  "codex.smoke.what": "\u0414\u044B\u043C \u0434\u043E \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043E\u043A. \u041D\u0438\u043A\u0442\u043E \u043D\u0435 \u0432\u0438\u0434\u0438\u0442 \u043D\u0438 \u0432\u043D\u0443\u0442\u0440\u044C, \u043D\u0438 \u043D\u0430\u0440\u0443\u0436\u0443: \u0421\u041A\u0410\u041D\u0415\u0420 \u0437\u0430 \u0434\u0432\u0435\u0440\u044C \u043D\u0435 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442, \u043C\u0430\u0448\u0438\u043D\u0430 \u0442\u0435\u0431\u044F \u0447\u0435\u0440\u0435\u0437 \u043D\u0435\u0451 \u043D\u0435 \u0437\u0430\u043C\u0435\u0447\u0430\u0435\u0442.",
  "codex.smoke.wrong": "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u044C \u043D\u0430 \u0432\u044B\u0441\u0442\u0440\u0435\u043B. \u042D\u041C\u0418\u0422\u0422\u0415\u0420 \u0438 \u0442\u0443\u0440\u0435\u043B\u044C \u0437\u0434\u0435\u0441\u044C \u0441\u043B\u0435\u043F\u044B.",
  "codex.smoke.helps": "\u0421\u0431\u043B\u0438\u0436\u0430\u0442\u044C\u0441\u044F: \u043A\u043B\u0438\u043D\u043E\u043A, \u0448\u043E\u043A\u0435\u0440 \u0438 \u0440\u0435\u0437\u0430\u043A \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u043A\u0430\u043A \u043E\u0431\u044B\u0447\u043D\u043E. \u0418 \u044D\u0442\u043E \u0443\u043A\u0440\u044B\u0442\u0438\u0435 \u2014 \u0441\u043F\u0440\u044F\u0442\u0430\u0442\u044C\u0441\u044F \u0437\u0434\u0435\u0441\u044C \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0441\u0442\u043E\u0438\u0442.",
  "codex.smoke.turn": "\u0417\u0430\u043C\u0430\u043D\u0438 \u043E\u0445\u043E\u0442\u043D\u0438\u043A\u0430 \u0432\u043D\u0443\u0442\u0440\u044C \u2014 \u043E\u043D \u0442\u0435\u0440\u044F\u0435\u0442 \u0442\u0435\u0431\u044F \u0443 \u0434\u0432\u0435\u0440\u0438. \u041B\u0443\u0447\u0448\u0435\u0435 \u0443\u043A\u0440\u044B\u0442\u0438\u0435 \u043D\u0430 \u043A\u043E\u0440\u0430\u0431\u043B\u0435.",
  "codex.smoke.lore": "\u0417\u0434\u0435\u0441\u044C \u0447\u0442\u043E-\u0442\u043E \u0433\u043E\u0440\u0435\u043B\u043E \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0434\u043D\u0435\u0439. \u041A\u043E\u0440\u0430\u0431\u043B\u044C \u0442\u0430\u043A \u0438 \u043D\u0435 \u043E\u0442\u043A\u0440\u044B\u043B \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u044E.",
  "codex.mine.title": "\u041C\u0418\u041D\u0410 \u041D\u0410 \u0414\u0412\u0415\u0420\u0418",
  "codex.mine.what": "\u0417\u0430\u0440\u044F\u0434 \u043D\u0430 \u043F\u0435\u0440\u0435\u0431\u043E\u0440\u043A\u0435. \u041F\u0435\u0440\u0432\u044B\u0439, \u043A\u0442\u043E \u043F\u0440\u043E\u0439\u0434\u0451\u0442, \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0432\u0437\u0440\u044B\u0432: \u0442\u0435\u0431\u0435 \u2014 \u0442\u0440\u0438 \u043E\u0447\u043A\u0430 \u0432 \u043C\u043E\u0434\u0443\u043B\u044C, \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0439 \u0448\u0430\u0433\u043E\u043C, \u0438 \u0442\u0440\u0435\u0432\u043E\u0433\u0430 \u043D\u0430 \u0441\u0442\u0443\u043F\u0435\u043D\u044C \u0432\u044B\u0448\u0435.",
  "codex.mine.wrong": "\u041F\u0440\u043E\u0439\u0442\u0438 \u0441\u043A\u0432\u043E\u0437\u044C \u043D\u0435\u0451, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0442\u0430\u043A \u043A\u043E\u0440\u043E\u0447\u0435.",
  "codex.mine.helps": "\u0414\u0432\u0430 \u0445\u043E\u0434\u0430 \u0421\u0412\u0410\u0420\u0429\u0418\u041A\u041E\u041C \u0441\u043D\u0438\u043C\u0430\u044E\u0442 \u0435\u0451 \u0441 \u043B\u044E\u0431\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u044B. \u0411\u0420\u041E\u041D\u042F \u043F\u0440\u0438\u043C\u0435\u0442 \u0432\u0437\u0440\u044B\u0432, \u0435\u0441\u043B\u0438 \u043F\u0440\u043E\u0439\u0442\u0438 \u0432\u0441\u0451 \u0436\u0435 \u043D\u0430\u0434\u043E.",
  "codex.mine.turn": "\u041F\u043E\u0434 \u043C\u0430\u0448\u0438\u043D\u043E\u0439 \u043E\u043D\u0430 \u0441\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442 \u0442\u0430\u043A \u0436\u0435, \u043A\u0430\u043A \u043F\u043E\u0434 \u0442\u043E\u0431\u043E\u0439. \u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438 \u0432\u043F\u0435\u0440\u0451\u0434.",
  "codex.mine.lore": "\u042D\u043A\u0438\u043F\u0430\u0436 \u0441\u0442\u0430\u0432\u0438\u043B \u0435\u0451 \u043F\u0440\u043E\u0442\u0438\u0432 \u0430\u0431\u043E\u0440\u0434\u0430\u0436\u0430. \u0410\u0431\u043E\u0440\u0434\u0430\u0436\u043D\u0438\u043A\u043E\u0432 \u0434\u0430\u0432\u043D\u043E \u043D\u0435\u0442; \u043C\u0438\u043D\u0430 \u043E\u0441\u0442\u0430\u043B\u0430\u0441\u044C.",
  // The `i` card gets its own row in the key table, and the help card ends
  // with the list of everything this voyage has shown.
  "help.codex.head": "\u0427\u0422\u041E \u0417\u0414\u0415\u0421\u042C \u041F\u0420\u041E\u0418\u0421\u0425\u041E\u0414\u0418\u0422 \u2014 \u0432\u0441\u0442\u0440\u0435\u0447\u0435\u043D\u043E \u0432 \u0440\u0435\u0439\u0441\u0435",
  "help.name.codex": "\u041E\u0411\u0421\u0422\u0410\u041D\u041E\u0412\u041A\u0410",
  "help.key.codex": "i   \u0447\u0442\u043E \u0437\u0434\u0435\u0441\u044C \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442; \u0437\u043D\u0430\u0447\u043E\u043A \u2014 \u043D\u043E\u0432\u043E\u0435",
  "help.rule.head": "\u041E\u0422\u041A\u0420\u042B\u0422 \u2014 \u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E",
  "help.rule.1": "\u0423\u0434\u0430\u0440 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u043F\u043E \u043C\u043E\u0434\u0443\u043B\u044E, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E",
  "help.rule.2": "\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043B: \u043F\u043E \u043E\u0442\u043C\u0435\u0447\u0435\u043D\u043D\u043E\u043C\u0443 \u25C0. \u0415\u0441\u043B\u0438 \u043E\u0442\u043A\u0440\u044B\u0442\u043E \u043D\u0438\u0447\u0435\u0433\u043E",
  "help.rule.3": "\u043D\u0435\u0442 \u2014 \u0431\u044C\u044E\u0442 \u0432 \u0411\u0420\u041E\u041D\u042E, \u043F\u043E\u0442\u043E\u043C \u0432 \u042F\u0414\u0420\u041E. \u041D\u0430 \u043D\u0443\u043B\u0435 \u043C\u043E\u0434\u0443\u043B\u044C",
  "help.rule.4": "\u0432\u044B\u0433\u043E\u0440\u0430\u0435\u0442 \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430, \u0438 \u043F\u0443\u0441\u0442\u043E\u0439 \u0441\u043B\u043E\u0442 \u043E\u0442 \u043D\u0435\u0433\u043E \u2014 \u044D\u0442\u043E",
  "help.rule.5": "\u0435\u0434\u0438\u043D\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0435 \u043C\u0435\u0441\u0442\u043E, \u043A\u0443\u0434\u0430 \u0432\u043B\u0435\u0437\u0435\u0442 \u0443\u0442\u0438\u043B\u044C.",
  "help.list.head": "\u0414\u0415\u0419\u0421\u0422\u0412\u0418\u042F \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u0441\u043F\u0440\u0430\u0432\u0430",
  "help.list.1": "\u0412\u0441\u0451, \u0447\u0442\u043E \u0437\u0434\u0435\u0441\u044C \u043C\u043E\u0436\u043D\u043E \u0441\u0434\u0435\u043B\u0430\u0442\u044C, \u2014 \u0441\u0442\u0440\u043E\u043A\u0430 \u0441 \u043D\u043E\u043C\u0435\u0440\u043E\u043C.",
  "help.list.2": "\u0422\u0443\u0441\u043A\u043B\u0443\u044E \u043F\u043E\u043A\u0430 \u043D\u0430\u0436\u0430\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F, \u0438 \u043E\u043D\u0430 \u0433\u043E\u0432\u043E\u0440\u0438\u0442 \u043F\u043E\u0447\u0435\u043C\u0443.",
  "help.list.3": "\u0417\u0430\u043F\u0435\u0440\u0442\u0430\u044F \u0434\u0432\u0435\u0440\u044C \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0441\u0432\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A; 0 \u2014 \u043D\u0430\u0437\u0430\u0434.",
  "help.list.4": "\u041C\u043E\u0436\u043D\u043E \u0438 \u043C\u044B\u0448\u044C\u044E: \u043F\u043E \u0441\u0442\u0440\u043E\u043A\u0435 \u0438\u043B\u0438 \u043F\u043E \u043E\u0442\u0441\u0435\u043A\u0443 \u043D\u0430 \u0441\u0445\u0435\u043C\u0435.",
  "help.charter.head": "\u0427\u0410\u0420\u0422\u0415\u0420\u042B \u2014 \u0440\u0430\u0434\u0438 \u0447\u0435\u0433\u043E \u0432\u044B\u043B\u0435\u0442",
  "help.charter.1": "\u041F\u043E\u0434\u043F\u0438\u0441\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435, \u0432 \u0433\u0440\u0443\u043F\u043F\u0435 \u041A\u041E\u041D\u0422\u0420\u0410\u041A\u0422\u042B, \u0434\u043E",
  "help.charter.2": "\u0432\u044B\u043B\u0435\u0442\u0430; \u043F\u043B\u0430\u0442\u044F\u0442, \u043A\u043E\u0433\u0434\u0430 \u0434\u0440\u043E\u043D \u0434\u043E\u043C\u0430. \u0423\u0422\u0418\u041B\u042C \u0445\u043E\u0447\u0435\u0442 \u043A\u0440\u0435\u0434\u0438\u0442\u043E\u0432",
  "help.charter.3": "\u0434\u043E\u043D\u0435\u0441\u0451\u043D\u043D\u044B\u0445 \u0434\u043E\u043C\u043E\u0439. \u041F\u041E\u0414\u042A\u0401\u041C \u0445\u043E\u0447\u0435\u0442 \u043F\u0440\u0438\u0432\u043E\u0434, \u0440\u0435\u0430\u043A\u0442\u043E\u0440 \u0438",
  "help.charter.4": "\u0442\u0435\u0440\u043C\u0438\u043D\u0430\u043B \u0432 \u0441\u0435\u0442\u0438 \u2014 \u043E\u043D \u0438 \u043F\u0440\u043E\u0434\u0430\u0451\u0442 \u0432\u0435\u0441\u044C \u043A\u043E\u0440\u043F\u0443\u0441.",
  "help.url.head": "\u0410\u0414\u0420\u0415\u0421\u041D\u0410\u042F \u0421\u0422\u0420\u041E\u041A\u0410 \u2014 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0431\u0435\u0437 \u043A\u043B\u0430\u0432\u0438\u0448\u0438",
  "help.url.seed": "?seed=N        \u0442\u043E\u0442 \u0436\u0435 \u043A\u043E\u0440\u0430\u0431\u043B\u044C \u0435\u0449\u0451 \u0440\u0430\u0437, \u0442\u043E\u0447\u044C-\u0432-\u0442\u043E\u0447\u044C",
  "help.url.view": "?view=ascii    \u043B\u0438\u0431\u043E web, \u043B\u0438\u0431\u043E hex: \u0442\u0440\u0438 \u044D\u043A\u0440\u0430\u043D\u0430",
  "help.url.sound": "?sound=off     \u0431\u0435\u0437 \u043C\u0443\u0437\u044B\u043A\u0438 \u0438 \u0437\u0432\u0443\u043A\u0430",
  "help.url.training": "?training=1    \u043E\u0442\u0447\u0430\u043B\u0438\u0442\u044C \u0441 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430\u043C\u0438",
  "help.url.debug": "?debug=1       \u0447\u0442\u043E \u043C\u0430\u0448\u0438\u043D\u044B \u0441\u0435\u0439\u0447\u0430\u0441 \u0434\u0443\u043C\u0430\u044E\u0442",
  "help.url.tiles": "?tiles=1       \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0438 \u0432\u043C\u0435\u0441\u0442\u043E \u0431\u0443\u043A\u0432",
  "help.url.hull": "?hull=0        \u0441\u043E\u0442\u044B \u0431\u0435\u0437 \u043D\u0430\u0440\u0438\u0441\u043E\u0432\u0430\u043D\u043D\u043E\u0433\u043E \u043A\u043E\u0440\u043F\u0443\u0441\u0430",
  // ------------------------------------------------------------------ финалы
  "end.dead": "\u0421\u0427\u0401\u0422 \u041F\u0423\u0421\u0422",
  "end.lost": "\u0414\u0420\u041E\u041D \u041F\u041E\u0422\u0415\u0420\u042F\u041D",
  "end.won": "\u0411\u0423\u041A\u0421\u0418\u0420 \u041E\u0422\u0426\u0410 \u0422\u0412\u041E\u0419",
  "end.sold": "\u041A\u041E\u0420\u0410\u0411\u041B\u042C \u041F\u0420\u041E\u0414\u0410\u041D",
  "end.dead.why": "\u0414\u0440\u043E\u043D\u0430 \u043D\u0435\u0442, \u0438 \u043A\u0443\u043F\u0438\u0442\u044C \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u043D\u0435 \u043D\u0430 \u0447\u0442\u043E.",
  "end.won.why": "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043A\u043E\u0440\u043F\u0443\u0441 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0430 \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435. \u0420\u0435\u0439\u0441 \u043E\u043A\u043E\u043D\u0447\u0435\u043D.",
  "end.again": "shift+R \u2014 \u043D\u043E\u0432\u044B\u0439 \u0437\u0430\u0431\u0435\u0433",
  "end.go": "\u043B\u044E\u0431\u0430\u044F \u043A\u043B\u0430\u0432\u0438\u0448\u0430 \u2014 \u0440\u0435\u0439\u0441 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0430\u0435\u0442\u0441\u044F",
  "end.summary": "{cr} CR \xB7 {rooms, one: # \u043E\u0442\u0441\u0435\u043A, few: # \u043E\u0442\u0441\u0435\u043A\u0430, many: # \u043E\u0442\u0441\u0435\u043A\u043E\u0432} \xB7 {turns, one: # \u0445\u043E\u0434, few: # \u0445\u043E\u0434\u0430, many: # \u0445\u043E\u0434\u043E\u0432} \xB7 {kills, one: # \u043C\u0430\u0448\u0438\u043D\u0430, few: # \u043C\u0430\u0448\u0438\u043D\u044B, many: # \u043C\u0430\u0448\u0438\u043D} \xB7 \u0441\u0433\u043E\u0440\u0435\u043B\u043E {burned, one: # \u043C\u043E\u0434\u0443\u043B\u044C, few: # \u043C\u043E\u0434\u0443\u043B\u044F, many: # \u043C\u043E\u0434\u0443\u043B\u0435\u0439}",
  // ------------------------------------------------------------- экран ошибки
  "log.title": "\u0416\u0423\u0420\u041D\u0410\u041B",
  "log.page": "{n}/{of}   PgUp \u043D\u0430\u0437\u0430\u0434   PgDn \u0432\u043F\u0435\u0440\u0451\u0434   esc \u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  "log.empty": "\u041F\u043E\u043A\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E.",
  "crash.title": "\u0427\u0422\u041E-\u0422\u041E \u0421\u041B\u041E\u041C\u0410\u041B\u041E\u0421\u042C",
  "crash.seed": "\u0441\u0438\u0434 {seed} \xB7 {voyage} \xB7 \u0445\u043E\u0434 {turn}",
  "crash.sortie": "\u0432\u044B\u043B\u0435\u0442 {n}",
  "crash.hull": "\u043A\u043E\u0440\u043F\u0443\u0441 {n}",
  "crash.hullOf": "\u043A\u043E\u0440\u043F\u0443\u0441 {n}/{of}",
  "crash.report": "\u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439 \u044D\u0442\u043E\u0442 URL \u0438 \u043F\u0440\u0438\u0448\u043B\u0438 \u0435\u0433\u043E",
  "crash.unknown": "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430",
  // -------------------------------------------------- буксир как меню (G53)
  // Пять глаголов, по которым читается буксир. Группы, а не отсеки: ДОК,
  // ТРЮМ, СТЕНД и РУБКА — это внутренности корабля, и по ним нельзя угадать,
  // где чинят модуль (docs/tasks/G53-tug-is-a-menu.md, 1).
  "tug.group.repair": "\u0427\u0418\u041D\u0418\u0422\u042C",
  "tug.group.rig": "\u0421\u041D\u0410\u0420\u042F\u0416\u0415\u041D\u0418\u0415",
  "tug.group.voyage": "\u041A\u041E\u041D\u0422\u0420\u0410\u041A\u0422\u042B",
  "tug.group.jump": "\u0421\u041C\u0415\u041D\u0410 \u0422\u041E\u0427\u041A\u0418",
  "action.pick.buy": "\u043A\u0443\u043F\u0438\u0442\u044C \u043A\u043E\u0440\u043F\u0443\u0441 \u25B8",
  "action.dead.undock": "\u0432\u044B\u043B\u0435\u0442",
  "action.dead.clean": "\u043B\u0435\u0447\u0438\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C",
  "action.dead.jump": "\u043F\u0440\u044B\u0436\u043E\u043A \u0434\u0430\u043B\u044C\u0448\u0435",
  "action.pick.repair": "\u0440\u0435\u043C\u043E\u043D\u0442 \u043C\u043E\u0434\u0443\u043B\u044F \u25B8",
  "action.pick.graft": "\u043D\u0430\u0440\u0430\u0441\u0442\u0438\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C \u25B8 {price} CR",
  "action.pick.stow": "\u0441\u043D\u044F\u0442\u044C \u0432 \u0442\u0440\u044E\u043C \u25B8",
  "action.pick.fit": "\u0442\u0440\u044E\u043C \u0438 \u043F\u043E\u043B\u043A\u0430 \u25B8",
  "action.pick.sell": "\u043F\u0440\u043E\u0434\u0430\u0442\u044C \u043D\u0430\u0441\u043E\u0432\u0441\u0435\u043C \u25B8",
  "action.pick.charter": "\u0432\u0437\u044F\u0442\u044C \u0447\u0430\u0440\u0442\u0435\u0440 \u25B8",
  "action.one.hull": "{hull}  {price} CR",
  "action.one.module": "{module} {left}/{max}",
  "action.one.modulePriced": "{module} {left}/{max}  {price} CR",
  "action.one.held": "{module} {integrity}",
  "action.one.charter": "{charter}  {price}",
  "action.stow": "{module} {left}/{max}",
  "log.stock.buy": "{module} \u043A\u0443\u043F\u043B\u0435\u043D \u0437\u0430 {price} CR. \u0412 \u0442\u0440\u044E\u043C\u0435. \u041E\u0441\u0442\u0430\u043B\u043E\u0441\u044C {credits} CR.",
  "log.hold.fitted": "\u0418\u0437 \u0442\u0440\u044E\u043C\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043E: {n}.",
  "log.hold.stow": "\u0412 \u0442\u0440\u044E\u043C \u2014 {module} ({integrity}/{max}), \u0446\u0435\u043B\u044B\u043C.",
  "why.stock.noDrone": "\u041D\u0430 \u0440\u0435\u043B\u044C\u0441\u0430\u0445 \u043D\u0435\u0442 \u0434\u0440\u043E\u043D\u0430, \u043D\u0435\u043A\u0443\u0434\u0430 \u0441\u0442\u0430\u0432\u0438\u0442\u044C.",
  "why.stock.spare": "{module} \u0443 \u0434\u0440\u043E\u043D\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044C.",
  "why.stock.none": "\u041D\u0430 \u043F\u043E\u043B\u043A\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C.",
  "why.hold.full": "\u0412 \u0442\u0440\u044E\u043C\u0435 \u0443\u0436\u0435 {n}. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043F\u043E\u0441\u0442\u0430\u0432\u044C \u0447\u0442\u043E-\u043D\u0438\u0431\u0443\u0434\u044C \u043E\u0431\u0440\u0430\u0442\u043D\u043E.",
  "why.hold.shelf": "\u0412 \u0442\u0440\u044E\u043C\u0435 \u043F\u0443\u0441\u0442\u043E, \u0438 \u0441 \u043F\u043E\u043B\u043A\u0438 \u0432\u0437\u044F\u0442\u044C \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.rig.whole": "\u0412 \u0441\u0442\u043E\u0439\u043A\u0435 \u0432\u0441\u0451 \u0446\u0435\u043B\u043E.",
  "why.rig.grafted": "\u041D\u0430\u0440\u0430\u0449\u0438\u0432\u0430\u0442\u044C \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435\u0447\u0435\u0433\u043E.",
  "why.rig.empty": "\u0412 \u0441\u0442\u043E\u0439\u043A\u0435 \u043F\u0443\u0441\u0442\u043E.",
  "why.rig.last": "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043C\u043E\u0434\u0443\u043B\u044C \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u043D\u0430 \u0440\u0435\u043B\u044C\u0441\u0430\u0445: \u0441 \u043F\u0443\u0441\u0442\u043E\u0439 \u0441\u0442\u043E\u0439\u043A\u043E\u0439 \u0434\u0440\u043E\u043D \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043C\u043E\u0436\u0435\u0442.",
  "why.rig.clean": "\u0417\u0430\u0440\u0430\u0436\u0451\u043D\u043D\u044B\u0445 \u043C\u043E\u0434\u0443\u043B\u0435\u0439 \u043D\u0435\u0442.",
  "why.charter.gone": "\u0412\u0441\u0435 \u0447\u0430\u0440\u0442\u0435\u0440\u044B \u044D\u0442\u043E\u0433\u043E \u0431\u043E\u0440\u0442\u0430 \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u043D\u044B.",
  "why.tug.noDrone": "\u0414\u0440\u043E\u043D\u0430 \u043D\u0435\u0442. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043A\u0443\u043F\u0438 \u043A\u043E\u0440\u043F\u0443\u0441.",
  "why.tug.noWalk": "\u041D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440\u0435 \u0445\u043E\u0434\u0438\u0442\u044C \u043D\u0435\u0433\u0434\u0435 \u2014 \u0432\u0441\u0451 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435.",
  "board.derelict": "\u0414\u0415\u0420\u0415\u041B\u0418\u041A\u0422 {hull} \xB7 {alert}",
  "board.worth": "\u041F\u041E\u0414\u041D\u042F\u0422\u042C \u041A\u041E\u0420\u041F\u0423\u0421 {up}/{of} \u2014 \u0437\u0430 \u043D\u0435\u0433\u043E \u0434\u0430\u0434\u0443\u0442 {price} CR",
  "board.rack": "\u0421\u0422\u041E\u0419\u041A\u0410 \u041A\u041E\u0420\u041F\u0423\u0421\u041E\u0412",
  "board.hull": "{hull}  {price} CR  {trait}",
  "board.hull.yours": "{hull}  \u2190 \u043D\u0430 \u0440\u0435\u043B\u044C\u0441\u0430\u0445",
  "board.sorties": "\u0432\u044B\u043B\u0430\u0437\u043E\u043A {n} \xB7 \u0434\u0440\u043E\u043D\u043E\u0432 \u043F\u043E\u0442\u0435\u0440\u044F\u043D\u043E {lost}",
  "board.mode": "\u0422\u0440\u0435\u0432\u043E\u0433\u0438 \u043D\u0435\u0442, \u0445\u043E\u0434\u0438\u0442\u044C \u043D\u0435\u0433\u0434\u0435. \u0412\u0441\u0451, \u0447\u0442\u043E \u043C\u043E\u0436\u043D\u043E, \u2014 \u0432 \u0441\u043F\u0438\u0441\u043A\u0435.",
  // ------------------------------------------------------------------ движок
  //
  // Строки, которые пишет сам движок. Русского он не знает и знать не может, —
  // он отдаёт ключ события и значения, а фраза собирается здесь
  // (`ui/logline.ts`). Тон — как у соседних строк риги: подлежащее в
  // именительном, двоеточие, факт.
  //
  // `{Actor}` — машина с прописной, `{actor}` — со строчной.
  "engine.hit.you": "\u0423\u0434\u0430\u0440: {target}, \u0443\u0440\u043E\u043D {amount} ({hp}/{max}).",
  "engine.hit.taken": "{Actor}: \u043F\u043E\u043F\u0430\u0434\u0430\u043D\u0438\u0435, \u0443\u0440\u043E\u043D {amount}.",
  "engine.hit.other": "{Actor} \u2192 {target}: \u0443\u0440\u043E\u043D {amount} ({hp}/{max}).",
  "engine.dies": "{Target} \u0433\u0438\u0431\u043D\u0435\u0442.",
  "engine.cover.you": "\u0422\u044B \u0443\u0445\u043E\u0434\u0438\u0448\u044C \u0432 \u0443\u043A\u0440\u044B\u0442\u0438\u0435.",
  "engine.cover.other": "{Actor} \u0443\u0445\u043E\u0434\u0438\u0442 \u0432 \u0443\u043A\u0440\u044B\u0442\u0438\u0435.",
  "engine.door.open": "{door}: \u043E\u0442\u043A\u0440\u044B\u0442\u0430.",
  "engine.door.breached": "{door} \u043F\u043E\u0434\u0434\u0430\u0451\u0442\u0441\u044F \u0441 \u0432\u0438\u0437\u0433\u043E\u043C.",
  "engine.door.cut.you": "\u0420\u0435\u0437 \u0438\u0434\u0451\u0442: {door}.",
  "engine.door.cut.other": "{Actor} \u0440\u0435\u0436\u0435\u0442: {door}.",
  "engine.fail.airlock": "\u042D\u0442\u043E \u0448\u043B\u044E\u0437. < \u2014 \u043E\u0431\u0440\u0430\u0442\u043D\u043E \u043D\u0430 \u0431\u0443\u043A\u0441\u0438\u0440.",
  "engine.fail.attack.ally": "\u041F\u043E \u0441\u0432\u043E\u0438\u043C \u043D\u0435 \u0431\u044C\u0451\u043C.",
  "engine.fail.attack.away": "{Target} \u2014 \u043D\u0435 \u0432 \u044D\u0442\u043E\u043C \u043E\u0442\u0441\u0435\u043A\u0435.",
  "engine.fail.attack.gone": "\u0410\u0442\u0430\u043A\u043E\u0432\u0430\u0442\u044C \u043D\u0435\u043A\u043E\u0433\u043E.",
  "engine.fail.attack.sight": "{Target} \u2014 \u043D\u0435 \u043D\u0430 \u043B\u0438\u043D\u0438\u0438 \u043E\u0433\u043D\u044F.",
  "engine.fail.cover": "\u0417\u0434\u0435\u0441\u044C \u043D\u0435 \u0437\u0430 \u0447\u0435\u043C \u0443\u043A\u0440\u044B\u0442\u044C\u0441\u044F.",
  "engine.fail.door.elsewhere": "{door} \u2014 \u043D\u0435 \u0432 \u044D\u0442\u043E\u043C \u043E\u0442\u0441\u0435\u043A\u0435.",
  "engine.fail.door.gone": "\u0422\u0430\u043A\u043E\u0439 \u0434\u0432\u0435\u0440\u0438 \u043D\u0435\u0442.",
  "engine.fail.door.shut": "{door}: {state}.",
  "engine.fail.door.size": "{Actor} \u043D\u0435 \u043F\u0440\u043E\u043B\u0435\u0437\u0435\u0442: {door}.",
  "engine.fail.leave.none": "\u0417\u0434\u0435\u0441\u044C \u043D\u0435\u0442 \u0448\u043B\u044E\u0437\u0430.",
  "engine.fail.leave.other": "\u0421 \u043A\u043E\u0440\u0430\u0431\u043B\u044F \u0443\u0445\u043E\u0434\u0438\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u0440\u043E\u043D.",
  "engine.fail.nothing": "\u0417\u0434\u0435\u0441\u044C \u043D\u0435\u0447\u0435\u0433\u043E \u0434\u0435\u043B\u0430\u0442\u044C.",
  "engine.fail.over": "\u0417\u0430\u0431\u0435\u0433 \u043E\u043A\u043E\u043D\u0447\u0435\u043D.",
  // -------------------------------------------------------------- схема
  //
  // Метка на коробке, висящей у шлюза. Три колонки — не место для слова
  // ни в одном из трёх языков, поэтому буксир на схеме глиф, как `d3` —
  // метка, и вот строка, которая это объясняет.
  "help.where.ship.3": "\u2302 \u0441\u043B\u0435\u0432\u0430 \u043D\u0430 \u0441\u0445\u0435\u043C\u0435 \u2014 \u0442\u0432\u043E\u0439 \u0431\u0443\u043A\u0441\u0438\u0440, \u0434\u043E\u0440\u043E\u0433\u0430 \u0434\u043E\u043C\u043E\u0439.",
  // обзор
  "stop.tug": "\u042D\u0442\u043E \u0442\u0432\u043E\u0439 \u0431\u0443\u043A\u0441\u0438\u0440, \u0430 \u043D\u0435 \u0434\u0435\u0440\u0435\u043B\u0438\u043A\u0442: \u0438\u0441\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u044C \u0442\u0443\u0442 \u043D\u0435\u0447\u0435\u0433\u043E.",
  "stop.noFurther": "{hull}: \u0434\u0430\u043B\u044C\u0448\u0435 \u043D\u0435 \u043F\u0440\u043E\u0439\u0442\u0438, {n, one: \u043E\u0441\u0442\u0430\u043B\u0441\u044F # \u043E\u0442\u0441\u0435\u043A, few: \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C # \u043E\u0442\u0441\u0435\u043A\u0430, many: \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C # \u043E\u0442\u0441\u0435\u043A\u043E\u0432}.",
  "stop.noFurther.tool": "{hull}: \u0434\u0430\u043B\u044C\u0448\u0435 \u043D\u0435 \u043F\u0440\u043E\u0439\u0442\u0438, {n, one: \u043E\u0441\u0442\u0430\u043B\u0441\u044F # \u043E\u0442\u0441\u0435\u043A, few: \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C # \u043E\u0442\u0441\u0435\u043A\u0430, many: \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C # \u043E\u0442\u0441\u0435\u043A\u043E\u0432} \u2014 \u043D\u0443\u0436\u0435\u043D {tool}.",
  // --------------------------------------------------------- опасности
  //
  // Красная строка, один раз за вылазку из соседнего отсека
  // (`systems/hazards.ts`). Каждая кончается на ` [i]` — крючок справки,
  // клавиша, которая открывает карточку этой опасности (G72).
  "log.hazard.tell.frost": "\u041E\u041F\u0410\u0421\u041D\u041E\u0421\u0422\u042C: \u0437\u0430 {door} \u2014 {room}, \u0442\u0430\u043C \u043B\u0451\u0434. \u0414\u0432\u0438\u0433\u0430\u0442\u0435\u043B\u0438 \u0432\u044F\u0437\u043D\u0443\u0442. [i]",
  "log.hazard.tell.smoke": "\u041E\u041F\u0410\u0421\u041D\u041E\u0421\u0422\u042C: \u0437\u0430 {door} \u2014 {room}, \u0442\u0430\u043C \u0434\u044B\u043C. \u041D\u0438\u043A\u0442\u043E \u043D\u0438\u043A\u043E\u0433\u043E \u043D\u0435 \u0432\u0438\u0434\u0438\u0442. [i]",
  "log.hazard.tell.mine": "\u041E\u041F\u0410\u0421\u041D\u041E\u0421\u0422\u042C: {door} \u0437\u0430\u043C\u0438\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0430. \u041F\u0435\u0440\u0432\u044B\u0439, \u043A\u0442\u043E \u043F\u0440\u043E\u0439\u0434\u0451\u0442, \u043F\u043E\u043B\u0443\u0447\u0438\u0442 \u0432\u0437\u0440\u044B\u0432. [i]",
  // Слово в блоке отсека, рядом с меткой.
  "word.hazard.frost": "\u043B\u0451\u0434: \u0434\u0432\u0438\u0433\u0430\u0442\u0435\u043B\u0438 \u0432\u044F\u0437\u043D\u0443\u0442",
  "word.hazard.smoke": "\u0434\u044B\u043C: \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0432\u0438\u0434\u043D\u043E",
  "word.hazard.mine": "\u043C\u0438\u043D\u0430 \u043D\u0430 {door}",
  "stop.hazard": "\u0421\u0442\u043E\u043F: {what}",
  "stop.hazard.again": "\u0421\u0442\u043E\u043F: {what} \u0415\u0449\u0451 \u0440\u0430\u0437 \u2014 \u0432\u043E\u0439\u0434\u0443.",
  "why.auto.hazard": "\u0410\u0432\u0442\u043E\u0431\u043E\u0439 \u043D\u0435 \u0438\u0434\u0451\u0442 \u0432 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0443\u044E \u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C: \u043E\u0431\u043E\u0439\u0434\u0438 \u0438\u043B\u0438 \u0432\u043E\u0439\u0434\u0438 \u0441\u0430\u043C.",
  "why.fight.hazard": "\u0421\u0442\u0440\u0435\u043B\u044F\u0442\u044C \u043D\u0435 \u0432 \u043A\u043E\u0433\u043E: \u0442\u0435\u0431\u044F \u0431\u044C\u0451\u0442 \u0432\u0435\u043D\u0442\u0438\u043B\u044F\u0446\u0438\u044F, \u0430 \u043D\u0435 \u043C\u0430\u0448\u0438\u043D\u0430. \u0423\u0445\u043E\u0434\u0438 \u0438\u0437 \u043E\u0442\u0441\u0435\u043A\u0430.",
  "log.hazard.mine.hit": "\u041C\u0438\u043D\u0430 \u043D\u0430 {door} \u0441\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442 \u043F\u043E\u0434 \u0442\u043E\u0431\u043E\u0439.",
  "log.hazard.mine.machine": "{machine}: \u043F\u043E\u0434\u0440\u044B\u0432 \u043C\u0438\u043D\u044B \u043D\u0430 {door}.",
  "log.hazard.heat": "{module} \u0433\u0440\u0435\u0435\u0442 {room}: \u043B\u044C\u0434\u0430 \u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u0432\u044B\u043B\u0430\u0437\u043A\u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442.",
  "why.hazard.noFrost": "\u0417\u0434\u0435\u0441\u044C \u043D\u0435\u0447\u0435\u0433\u043E \u0433\u0440\u0435\u0442\u044C.",
  "why.hazard.heated": "{room}: \u0443\u0436\u0435 \u0442\u0435\u043F\u043B\u043E.",
  "verb.heat": "\u0433\u0440\u0435\u0442\u044C",
  "verb.defuse": "\u0441\u043D\u044F\u0442\u044C",
  "cost.defuse": "2 \u0445\u043E\u0434\u0430, \u0448\u0443\u043C 5",
  "log.door.defuse.on": "\u0421\u0432\u0430\u0440\u0449\u0438\u043A \u043E\u0431\u0445\u043E\u0434\u0438\u0442 \u0437\u0430\u0440\u044F\u0434 \u043D\u0430 {door}.",
  "log.door.defuse.done": "\u041C\u0438\u043D\u0430 \u043D\u0430 {door} \u0441\u043D\u044F\u0442\u0430. \u041F\u043E\u0434 \u043D\u0435\u0439 \u043F\u0443\u0441\u0442\u043E.",
  "why.door.noTrap": "\u041D\u0430 {door} \u043D\u0435\u0442 \u043C\u0438\u043D\u044B.",
  "log.work.break.defuse": "\u0420\u0430\u0437\u043C\u0438\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0431\u0440\u043E\u0448\u0435\u043D\u043E.",
  // G88 B: the panel's own lines.
  "panel.systems.lost": "\u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E:",
  "panel.letters.tugTop": "? \u043F\u043E\u043C\u043E\u0449\u044C"
};

// ../../../smoreg_works/games/salvor/src/i18n.ts
var LANGS = ["en", "es", "ru"];
var TABLES = { en: EN, es: ES, ru: RU };
var DEFAULT_LANG = "en";
var current = DEFAULT_LANG;
function currentLang() {
  return current;
}
function t(key3, params) {
  const pattern = TABLES[current][key3] ?? EN[key3];
  return fill(pattern, params, current);
}
function tId(prefix, id, or, params) {
  const key3 = `${prefix}.${id}`;
  const pattern = TABLES[current][key3] ?? EN[key3];
  return pattern === void 0 ? or : fill(pattern, params, current);
}
var FIELD = /\{([^{}]+)\}/g;
var FALLBACK = ["other", "many", "few", "one"];
function fill(pattern, params, lang) {
  if (!pattern.includes("{")) return pattern;
  return pattern.replace(FIELD, (whole, body) => {
    const comma = body.indexOf(",");
    if (comma < 0) {
      const value = params?.[body.trim()];
      return value === void 0 ? whole : String(value);
    }
    const count = Number(params?.[body.slice(0, comma).trim()]);
    if (!Number.isFinite(count)) return whole;
    return chooseForm(body.slice(comma + 1), pluralForm(lang, count), count) ?? whole;
  });
}
function chooseForm(spec2, want, count) {
  const forms = /* @__PURE__ */ new Map();
  for (const part of spec2.split(",")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    forms.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  }
  const picked = forms.get(want) ?? FALLBACK.map((f2) => forms.get(f2)).find((v) => v !== void 0);
  const form = picked ?? forms.values().next().value;
  return form === void 0 ? void 0 : form.replace(/#/g, String(count));
}
function pluralForm(lang, n) {
  if (lang !== "ru") return n === 1 ? "one" : "other";
  const abs = Math.abs(Math.trunc(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 14) return "many";
  const ones = abs % 10;
  if (ones === 1) return "one";
  if (ones >= 2 && ones <= 4) return "few";
  return "many";
}

// ../../../smoreg_works/games/salvor/src/content/monsters.ts
var SENTRY_TURRET = {
  id: "sentry-turret",
  name: "sentry turret",
  ch: "t",
  fg: "#2f97b8",
  hp: 5,
  damage: [1, 4, 0],
  defense: 0,
  speed: 100,
  fovRadius: 7,
  behaviour: "turret",
  range: 1,
  sight: 1,
  minDepth: 2,
  maxDepth: 6,
  weight: 0,
  salvage: "emitter"
};
var JAMMER = {
  id: "jammer",
  name: "jammer",
  ch: "j",
  fg: "#c46fbf",
  hp: 5,
  damage: [1, 2, 0],
  defense: 0,
  speed: 90,
  fovRadius: 5,
  behaviour: "coward",
  sight: 0,
  minDepth: 2,
  maxDepth: 6,
  weight: 0,
  salvage: "cell"
};
var CRAWLER = {
  id: "crawler",
  name: "crawler",
  ch: "z",
  fg: "#8fae4f",
  hp: 3,
  damage: [1, 3, 0],
  defense: 0,
  speed: 130,
  fovRadius: 6,
  behaviour: "pack",
  tags: ["corrosive"],
  sight: 0,
  minDepth: 2,
  maxDepth: 6,
  weight: 0
};
var BLOOM_KIND = {
  id: "bloom",
  name: "bloom",
  ch: "Y",
  fg: "#c3d96f",
  hp: 8,
  damage: [0, 0, 0],
  defense: 0,
  speed: 100,
  fovRadius: 1,
  behaviour: "static",
  sight: 0,
  minDepth: 2,
  maxDepth: 6,
  weight: 0
};
var MONSTERS = [
  { id: "maintenance-bot", name: "maintenance bot", ch: "m", fg: "#9aa5b1", hp: 4, damage: [1, 2, 0], defense: 0, speed: 80, fovRadius: 5, behaviour: "brute", sight: 0, minDepth: 2, maxDepth: 3, weight: 10, salvage: "plating" },
  { id: "feral-drone", name: "feral drone", ch: "d", fg: "#4fd0c0", hp: 3, damage: [1, 3, 0], defense: 0, speed: 150, fovRadius: 7, behaviour: "pack", sight: 0, minDepth: 2, maxDepth: 4, weight: 10, salvage: "thrusters" },
  { id: "scout", name: "scout", ch: "c", fg: "#7fb2ff", hp: 3, damage: [1, 2, 0], defense: 0, speed: 120, fovRadius: 10, behaviour: "stalker", sight: 1, keen: true, minDepth: 1, maxDepth: 6, weight: 8, salvage: "scanner" },
  { id: "security-unit", name: "security unit", ch: "S", fg: "#3f6fbf", hp: 8, damage: [1, 3, 0], defense: 0, speed: 100, fovRadius: 8, behaviour: "brute", sight: 1, minDepth: 2, maxDepth: 6, weight: 8, salvage: "cutter" },
  { id: "welder-bot", name: "welder bot", ch: "w", fg: "#6fbf5f", hp: 6, damage: [1, 3, 0], defense: 0, speed: 90, fovRadius: 6, behaviour: "coward", sight: 0, minDepth: 3, maxDepth: 6, weight: 8, salvage: "welder" },
  { id: "hauler", name: "hauler", ch: "H", fg: "#46587e", hp: 14, damage: [1, 5, 0], defense: 0, speed: 60, fovRadius: 5, behaviour: "brute", sight: 0, minDepth: 4, maxDepth: 6, weight: 4, salvage: "plating" },
  { id: "scrapper", name: "scrapper", ch: "x", fg: "#a98fe0", hp: 6, damage: [1, 3, 0], defense: 0, speed: 110, fovRadius: 8, behaviour: "pack", tags: ["precise"], sight: 1, minDepth: 4, maxDepth: 6, weight: 8, salvage: "emp" },
  { id: "arc-sentinel", name: "arc sentinel", ch: "A", fg: "#d7ecff", hp: 10, damage: [1, 4, 0], defense: 0, speed: 100, fovRadius: 9, behaviour: "brute", tags: ["burst"], sight: 1, keen: true, minDepth: 5, maxDepth: 6, weight: 3, salvage: "laser" },
  SENTRY_TURRET,
  JAMMER,
  CRAWLER,
  BLOOM_KIND
];
var ENFORCER = {
  id: "enforcer",
  name: "enforcer",
  ch: "E",
  fg: "#d9705a",
  hp: 10,
  damage: [1, 3, 0],
  defense: 0,
  speed: 120,
  fovRadius: 8,
  behaviour: "hunter",
  range: 1,
  tags: ["precise"],
  sight: 1,
  keen: true,
  breacher: true,
  minDepth: 0,
  maxDepth: 99,
  weight: 0,
  salvage: "emitter"
};
var ABOARD = [...MONSTERS, ENFORCER];
function kindsForDepth(depth) {
  return MONSTERS.filter((m) => depth >= m.minDepth && depth <= m.maxDepth);
}
function machineByName(name) {
  return ABOARD.find((m) => m.name === name);
}
function machineName(name) {
  const kind = machineByName(name);
  if (kind !== void 0) return tId("machine", kind.id, kind.name);
  return tId("machine", name.replace(/ /g, "-"), name);
}
function machineAboard(id) {
  return ABOARD.find((m) => m.id === id);
}
function monsterChance() {
  return 0;
}
var MAX_MACHINES = 8;
var CROWD = 3;

// ../../../smoreg_works/games/salvor/src/content/modules.ts
var BARE_CHASSIS = {
  speed: 80,
  sight: 0,
  // Ramming, once the CUTTER is gone. At 1d1 a bare drone needed fourteen
  // swings to bring down a hauler and took fourteen swings back; the CUTTER is
  // still twice this and the choice of when to spend it is still the game.
  damage: [1, 3, 0]
};
var MODULES = {
  cutter: {
    id: "cutter",
    name: "CUTTER",
    integrity: 11,
    price: 30,
    attack: [1, 6, 1]
  },
  thrusters: {
    id: "thrusters",
    name: "THRUSTERS",
    integrity: 12,
    price: 30,
    speed: 100
  },
  scanner: {
    id: "scanner",
    name: "SCANNER",
    integrity: 8,
    price: 25,
    active: "s",
    sight: 1
  },
  /**
   * The chain's second link, and the only one every blow passes through. It and
   * the exposed module are the whole of the drone's armour: SCANNER and CELL
   * are never exposed by a bot that only walks and swings, so in 24 of 30
   * diagnostic deaths the drone died with those two at full integrity. What
   * cannot be spent cannot save the run — so the two links that can carry it.
   */
  plating: {
    id: "plating",
    name: "PLATING",
    integrity: 13,
    price: 35
  },
  cell: {
    id: "cell",
    name: "CELL",
    integrity: 8,
    price: 20,
    active: "p"
  },
  emp: {
    id: "emp",
    name: "EMP",
    integrity: 3,
    price: 25,
    active: "e",
    charges: 2
  },
  welder: {
    id: "welder",
    name: "WELDER",
    integrity: 5,
    price: 40,
    active: "w"
  },
  laser: {
    id: "laser",
    name: "LASER",
    integrity: 4,
    price: 45,
    attack: [2, 4, 0]
  },
  /**
   * The three verbs a drone can have besides walking and swinging: open what
   * is locked, hit what is a room away, be missed by what is looking. None of
   * them is a bigger number — a hull is told apart by which of these it
   * carries, not by how much integrity it starts with.
   */
  spike: {
    id: "spike",
    name: "SPIKE",
    integrity: 3,
    price: 20,
    active: "K"
  },
  emitter: {
    id: "emitter",
    name: "EMITTER",
    integrity: 3,
    price: 35,
    // `range: 6` is the tile number from v2, and on a ship it reads as "the
    // next room through an open door" — the twist checks line of sight, not
    // this figure, so the two can never disagree by one.
    active: "f",
    attack: [1, 4, 1],
    range: 6
  },
  baffle: {
    id: "baffle",
    name: "BAFFLE",
    integrity: 4,
    price: 25,
    noisePenalty: 3,
    machineFovPenalty: 3
  },
  /**
   * The three relics (G66). No `price`: a relic is not on any shelf, and the
   * dock's default price is never asked for one — the tug's list reads
   * `relic` before it reads a price.
   *
   * The blade is the cutter's better copy: two dice where the cutter has one,
   * and it opens a bulkhead the way a cutter does (`countsAs`). The shocker is
   * an EMP with a third charge and a shorter stun that the numbered list fires,
   * because letters are the catalogue's and a relic has none. The lattice is
   * plating twice over, and the one flat point of armour in the game.
   */
  blade: {
    id: "blade",
    name: "Q-BLADE",
    integrity: 14,
    attack: [2, 6, 0],
    range: 0,
    relic: true,
    upgrades: "cutter",
    countsAs: "cutter"
  },
  shocker: {
    id: "shocker",
    name: "SHOCKER",
    integrity: 8,
    // Fired from the numbered list, so the label is the list's and not a key.
    active: "#",
    charges: 3,
    relic: true
  },
  lattice: {
    id: "lattice",
    name: "LATTICE",
    integrity: 30,
    defense: 1,
    relic: true,
    upgrades: "plating",
    countsAs: "plating"
  }
};
function isRelic(id) {
  return MODULES[id].relic === true;
}
var RELICS = Object.keys(MODULES).filter(isRelic);
var SHOCK_STUN_TURNS = 2;
var SCRAP_INTEGRITY = [1, 3];
var MAX_GRAFT = 2;
var STARTING_MODULES = ["cutter", "thrusters", "scanner", "plating", "cell"];
function moduleKind(id) {
  return MODULES[id];
}
function moduleName(id) {
  return tId("module", id, MODULES[id].name);
}
function moduleBurnLine(id) {
  return tId("burn", id, MODULES[id].name);
}
var HINT_KEYS = {
  /** The first time a blow lands on a module instead of the core. */
  exposure: "hint.exposure",
  /** The first module lost, when a slot stops being an ability. */
  burned: "hint.burned",
  /** The first turn there is salvage in the room. */
  scrap: "hint.scrap",
  /** The first turn the rack has no scanner: the ship ends at this bulkhead. */
  blind: "hint.blind"
};
function hitLine(source, kind, left, max) {
  return t("log.hit.module", { source, module: moduleName(kind.id), left, max });
}

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
function zoneKind(kind) {
  const spec2 = BY_KIND.get(kind);
  if (!spec2) throw new Error(`zones: no compartment kind '${kind}'`);
  return spec2;
}
function zoneName(kind) {
  return tId("room", kind, BY_KIND.get(kind)?.name ?? kind.toUpperCase());
}
function roomName(room) {
  return tId("room", room.kind, room.name);
}

// ../../../smoreg_works/games/salvor/src/content/tutorial.ts
var TUTORIAL_ID = "tutorial";
var TUTORIAL_SPEC = {
  id: TUTORIAL_ID,
  name: "training hull",
  rooms: [6, 7],
  maxDepth: 4,
  kinds: [ENTRY_KIND, "cargo", "corridor", "storage", "engineering", "reactor", "control"],
  band: ["scout"],
  machines: [1, 1],
  alertStart: 0,
  salePrice: 60,
  doors: { open: 55, closed: 30, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: false,
  flavour: ["yard tender", "banked reactor", "tug drive", "shakedown run", "no crew aboard"]
};
var TRAINING_KEY = "training";
function markTraining(drone) {
  drone.data = { ...drone.data ?? {}, [TRAINING_KEY]: true };
  return drone;
}
function isTraining(drone) {
  return drone?.data?.[TRAINING_KEY] === true;
}
var TUTORIAL_STEPS = [
  { id: "tutorial.enter", due: (at) => at.aboard, urgent: true },
  { id: "tutorial.contact", due: (at) => at.aboard && (at.contact || at.fighting), urgent: true },
  { id: "tutorial.door", due: (at) => at.aboard && at.lockedDoor, urgent: true },
  { id: "tutorial.system", due: (at) => at.aboard && at.system },
  { id: "tutorial.airlock", due: (at) => at.aboard && at.atAirlock && at.carrying },
  { id: "tutorial.sale", due: (at) => at.home },
  { id: "tutorial.scan", due: (at) => at.aboard && at.turnsAboard >= 1 }
];
function stepDue(at, said2, crowded5 = false) {
  return TUTORIAL_STEPS.find(
    (step) => !said2(step.id) && (!crowded5 || step.urgent === true) && step.due(at)
  );
}

// ../../../smoreg_works/games/salvor/src/content/hints.ts
var HINT_LINE_KEYS = {
  ...HINT_KEYS,
  /** The turn the drone first holds a keycard: what the `[ ]` on the schematic means. */
  keycard: "hint.keycard",
  /**
   * The turn the first drone does not come back. The same sentence as
   * `systems/ghost.ts`'s ghost warning, said here because the drone is standing
   * on the tug by then and the ghost's own file has nobody to say it to.
   */
  death: "hint.death",
  /**
   * The first module sold. There is no shop in this game and no buying one
   * back (docs/scope-rules.md), and the owner found that out by selling his
   * cutter and hunting for the line that would return it — so the line says so
   * once, on the sale, and points at the hold, which is the thing he wanted
   * (docs/tasks/G53-tug-is-a-menu.md, 4).
   */
  sell: "hint.sell",
  /**
   * The first shot traded with something that can shoot back. The rule is
   * `exposure`'s — a blow lands on whatever was last used — said again for the
   * one case a player meets it in without ever being in the room: the emitter
   * is the most brittle module on a rack, and a machine with a reach answers
   * from where it stands (docs/owner-queue.md, 1).
   */
  shooting: "hint.shooting",
  /**
   * The turn the drone first stands in a compartment with one of the ship's
   * three systems in it: what the three of them are for, and what raising all
   * of them is worth (`systems/ship.ts`, docs/owner-queue.md, 4).
   */
  objective: "hint.objective",
  /**
   * The turn the drone is first carrying credits: nothing — hold or charter —
   * is paid until it is back out through the airlock (docs/owner-queue.md, 5).
   */
  payout: "hint.payout",
  /**
   * Turn zero: the mouse works. Clicking a numbered line and clicking a box on
   * the schematic have both worked since G84 and G31, and neither was written
   * down anywhere in any of the three languages — while the owner plays with a
   * mouse (docs/tasks/G87-playability.md, 3).
   */
  mouse: "hint.mouse",
  // The training run's own chain, said only aboard the training hull and only
  // in this order (`content/tutorial.ts`, `systems/tutorial.ts`). They live in
  // this table rather than in a second one of their own so that "once a run"
  // and "survives a save" are the same mechanism for every line the game says.
  /** Aboard: everything the drone can do is the numbered list. */
  "tutorial.enter": "hint.tutorial.enter",
  /** How to see further than the compartment you are standing in. */
  "tutorial.scan": "hint.tutorial.scan",
  /** The first machine, and what a fight costs a rack. */
  "tutorial.contact": "hint.tutorial.contact",
  /** The one locked bulkhead, and where its keycard is. */
  "tutorial.door": "hint.tutorial.door",
  /** The first of the ship's three systems, and what all three are worth. */
  "tutorial.system": "hint.tutorial.system",
  /** The airlock: nothing is paid on the inside of it. */
  "tutorial.airlock": "hint.tutorial.airlock",
  /** Home again: the next drone priced, and the end of the lesson. */
  "tutorial.sale": "hint.tutorial.sale"
};
var TUG_OPENING_KEY = "log.opening.tug";
function tugOpening() {
  return t(TUG_OPENING_KEY);
}
var TUG_CALLSIGNS = [
  "DEAD RECKONING",
  "LONG WINTER",
  "SALT DRIFTER",
  "COLD LANTERN",
  "GREY HARROW",
  "LAST FERRY",
  "IRON WIDOW",
  "STILL HARBOUR"
];
function tugCallsign(seed) {
  const i = Math.abs(Math.trunc(seed)) % TUG_CALLSIGNS.length;
  return TUG_CALLSIGNS[i];
}
function voyageOpening(callsign, hulls) {
  return t("log.opening.voyage", { callsign, hulls });
}
function soldLine(credits, hullPrice) {
  return t("hint.sold", { credits, hullPrice });
}
var CHAIN_SAYS = {
  objective: "tutorial.system",
  payout: "tutorial.airlock"
};
function hint(game, id, text3) {
  const key3 = id === "sold" ? void 0 : HINT_LINE_KEYS[id];
  const line2 = text3 ?? (key3 === void 0 ? void 0 : t(key3));
  if (line2 === void 0) return false;
  const said2 = hintsOf(game.player);
  if (said2[id] === true) return false;
  if (id in CHAIN_SAYS && isTraining(game.player)) {
    said2[id] = true;
    return false;
  }
  said2[id] = true;
  game.log.add(line2, game.schedule.time, "warn", `hint.${id}`);
  return true;
}
var HINTS_PER_TURN = 2;
function turnRoom(game) {
  const lines = game.log.lines;
  const now = game.schedule.time;
  let hints2 = 0;
  let taken = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line2 = lines[i];
    if (line2.turn !== now) break;
    if (line2.tone === "alarm") return { left: 0, taken: true };
    const key3 = line2.key ?? "";
    if (key3.startsWith("hint.")) {
      hints2++;
      taken = true;
    } else if (key3 === "engine.hit.taken" || key3.startsWith("log.hit.")) {
      taken = true;
    }
  }
  return { left: Math.max(0, HINTS_PER_TURN - hints2), taken };
}
function saidHint(player, id) {
  return hintsOf(player)[id] === true;
}
function hintsOf(player) {
  const data = player.data ??= {};
  const existing = data.hints;
  if (existing) return existing;
  const fresh2 = {};
  data.hints = fresh2;
  return fresh2;
}
function startTraining(game) {
  game.log.add(t("hint.training"), game.schedule.time, "warn", "hint.training");
}

// ../../../smoreg_works/games/salvor/src/content/hulls.ts
var SCRAPPER = {
  id: "scrapper",
  name: "SCRAPPER",
  price: 40,
  modules: STARTING_MODULES,
  base: { plating: 16 },
  slots: 6,
  core: 3,
  trait: "6 slots, core 3"
};
var SPARK = {
  id: "spark",
  name: "SPARK",
  price: 90,
  modules: STARTING_MODULES,
  base: { cutter: 13, thrusters: 14, scanner: 10, plating: 18, cell: 10 },
  speed: 120,
  slots: 7,
  core: 4,
  trait: "7 slots, core 4"
};
var GHOST = {
  id: "ghost",
  name: "GHOST",
  price: 160,
  modules: STARTING_MODULES,
  base: { cutter: 16, thrusters: 17, scanner: 13, plating: 24, cell: 13 },
  speed: 140,
  slots: 8,
  core: 5,
  trait: "8 slots, core 5"
};
var HULLS = [SCRAPPER, SPARK, GHOST];
var STARTING_HULL = SCRAPPER;
var STARTING_CREDITS = 25;
var CHEAPEST_HULL = HULLS.reduce((a, b) => b.price < a.price ? b : a);
function hullKind(id) {
  return HULLS.find((h) => h.id === id);
}
function hullName(hull3) {
  return tId("hull", hull3.id, hull3.name);
}
function hullTrait(hull3) {
  return tId("trait", hull3.id, hull3.trait);
}
function startingSlots() {
  return slotsOf(STARTING_MODULES, { plating: 16 });
}
function hullSlots(hull3) {
  return slotsOf(hull3.modules, hull3.base, hull3.speed);
}
function slotsOf(modules, base, speed) {
  return modules.map((id) => {
    const kind = moduleKind(id);
    const cap = base?.[id] ?? kind.integrity;
    const slot = { kind: id, integrity: cap };
    if (cap !== kind.integrity) slot.base = cap;
    if (kind.charges !== void 0) slot.charges = kind.charges;
    if (id === "thrusters" && speed !== void 0) slot.speed = speed;
    return slot;
  });
}

// ../../../smoreg_works/games/salvor/src/content/cards-derelicts.ts
var MIN_CHARTER_DEPTH = 2;
var PINNED = 1e6;
var CHARTER_FLAG = "charter:";
function retrieveFlag(kind) {
  return `${CHARTER_FLAG}retrieve:${kind}`;
}
function uploadFlag(kind) {
  return `${CHARTER_FLAG}upload:${kind}`;
}
var UPLOAD_FLAG = `${CHARTER_FLAG}upload`;
var CHARTER_KINDS = ZONE_KINDS.filter((z) => z.kind !== ENTRY_KIND && !z.required).map((z) => z.kind);
function charterCard(kind) {
  return {
    name: `charter item (${kind})`,
    kinds: [kind],
    weight: PINNED,
    maxPerShip: 1,
    when: (ctx) => ctx.flags.has(retrieveFlag(kind)),
    marks: ["*"]
  };
}
function consoleCard(kind) {
  return {
    name: `console (${kind})`,
    kinds: [kind],
    weight: PINNED,
    maxPerShip: 1,
    when: (ctx) => ctx.flags.has(uploadFlag(kind)),
    marks: ["&"]
  };
}
var DERELICT_CARDS = CHARTER_KINDS.flatMap((kind) => [
  charterCard(kind),
  consoleCard(kind)
]);
function seatCharterMarks(ship) {
  const stuck = [];
  for (const mark of ["*", "&"]) {
    for (const room of ship.rooms) {
      if (room.depth >= MIN_CHARTER_DEPTH || !room.marks.includes(mark)) continue;
      const deeper = ship.rooms.filter((r) => r.kind === room.kind && r.depth >= MIN_CHARTER_DEPTH).sort((a, b) => b.depth - a.depth || a.id - b.id)[0];
      if (!deeper) {
        stuck.push(mark);
        continue;
      }
      room.marks.splice(room.marks.indexOf(mark), 1);
      deeper.marks.push(mark);
    }
  }
  return stuck;
}

// ../../../smoreg_works/games/salvor/src/content/cards.ts
var SALVAGE_POOL = [
  "cutter",
  "thrusters",
  "scanner",
  "plating",
  "cell",
  "emp",
  "welder",
  "laser",
  "spike",
  "emitter",
  "baffle"
];
var PINNED2 = 1e6;
var BULKHEAD = 2e3;
var CLASS_FLAG = "class:";
function deathFlag(shipIndex) {
  return `death:${shipIndex}`;
}
function rigOfCtx(ctx) {
  return ctx.player?.data?.rig;
}
function burned(ctx, kind) {
  return rigOfCtx(ctx)?.burned.includes(kind) ?? false;
}
function emptySlots(ctx) {
  const rig = rigOfCtx(ctx);
  if (!rig) return 0;
  return rig.slots.reduce((n, s) => s === null ? n + 1 : n, 0);
}
function burnedCount(ctx) {
  return rigOfCtx(ctx)?.burned.length ?? 0;
}
function carries(ctx, kind) {
  return rigOfCtx(ctx)?.slots.some((s) => s?.kind === kind) ?? false;
}
function keysHeld(ctx) {
  const keys = ctx.player?.data?.keys;
  return typeof keys === "number" ? keys : 0;
}
function isClass(ctx, id) {
  return ctx.flags.has(`${CLASS_FLAG}${id}`);
}
var CARD_MODULE = {
  "docking bay": "welder",
  "sensor closet": "scanner",
  "charging alcove": "welder",
  "thruster bay": "thrusters",
  "quarantine ward": "plating",
  "reactor antechamber": "cell",
  "armory locker": "laser",
  "containment locker": "emp",
  "instrument bay": "scanner",
  "welding bay": "welder"
};
var WORKING = [
  "cargo",
  "storage",
  "maintenance",
  "hab",
  "mess",
  "hydroponics",
  "med",
  "lab",
  "quarantine",
  "engineering",
  "workshop",
  "armory",
  "control",
  "coreaccess",
  "lifesupport",
  "cryo",
  "sensors",
  "brig",
  "escapepods"
];
var DOCKING_BAY = {
  name: "docking bay",
  kinds: ["docking"],
  when: (ctx) => ctx.shipIndex === 0,
  weight: PINNED2,
  maxPerShip: 1,
  marks: ["m:scout", "%:welder"]
};
var CARGO_MANIFEST = {
  name: "cargo manifest",
  kinds: ["cargo", "storage", "lifesupport", "maintenance", "hab", "workshop", "sensors"],
  when: (ctx) => ctx.shipIndex === 0,
  weight: PINNED2,
  maxPerShip: 2,
  marks: ["cargo"]
};
var HOLDS = [
  // The bulk hauler: containers, and the run's first lesson that a hold is
  // money. Two apiece rather than three, because `cargo manifest` is already
  // pinned to two of its compartments.
  { hull: "freighter", name: "container stack", kinds: ["cargo", "storage"], maxPerShip: 2 },
  { hull: "freighter", name: "ore drums", kinds: ["maintenance", "lifesupport", "corridor"], maxPerShip: 2 },
  // The four other hulls a voyage can open on. Each is smaller than the
  // freighter and has fewer card slots to be paid in, so each holds more per
  // slot: what `tests/ship-content.test.ts` measures is credits in front of the
  // locks, and a nine-compartment hull reaches the same band as a fourteen-
  // compartment one only by being denser.
  { hull: "barge", name: "container line", kinds: ["cargo"], maxPerShip: 1, crates: 2, pinned: true },
  { hull: "barge", name: "deck cargo", kinds: ["storage", "maintenance", "corridor"], maxPerShip: 2 },
  { hull: "ferry", name: "passenger baggage", kinds: ["cargo"], maxPerShip: 1, crates: 2, pinned: true },
  // Behind the two gates, which is the whole of what a ferry teaches: the
  // freight worth carrying is on the far side of a door with a key on a body.
  { hull: "ferry", name: "galley stores", kinds: ["mess", "cryo"], maxPerShip: 2 },
  { hull: "probe", name: "sample canisters", kinds: ["sensors"], maxPerShip: 1, crates: 2, pinned: true },
  { hull: "probe", name: "instrument cases", kinds: ["sensors", "storage"], maxPerShip: 2 },
  { hull: "tender", name: "parts pallets", kinds: ["workshop"], maxPerShip: 1, crates: 2, pinned: true },
  { hull: "tender", name: "yard stock", kinds: ["maintenance", "storage", "corridor"], maxPerShip: 2 },
  // The research hull: what it was carrying is what it was studying.
  { hull: "laboratory", name: "sample crates", kinds: ["lab", "med", "cryo"], maxPerShip: 3 },
  { hull: "laboratory", name: "supply cache", kinds: ["storage", "sensors", "hydroponics"], maxPerShip: 3 },
  // The patrol cutter: ordnance and rations, and both are worth carrying home.
  { hull: "military", name: "ammunition pallets", kinds: ["armory", "workshop"], maxPerShip: 3 },
  { hull: "military", name: "ration store", kinds: ["hab", "brig", "corridor"], maxPerShip: 3 },
  // The smuggler declares none of it. The false holds are `hidden hold` and
  // stay locked; this is the freight on the manifest.
  { hull: "smuggler", name: "unlisted freight", kinds: ["cargo", "storage"], maxPerShip: 3 },
  { hull: "smuggler", name: "transit crates", kinds: ["maintenance", "hab", "escapepods"], maxPerShip: 3 },
  // The raider: somebody else's cargo, stacked where the prize crew left it.
  { hull: "corsair", name: "prize goods", kinds: ["cargo", "hab", "mess"], maxPerShip: 3 },
  { hull: "corsair", name: "plunder pile", kinds: ["armory", "brig"], maxPerShip: 3 },
  // The medical transport: stores nobody was ever going to unload.
  { hull: "quarantine", name: "medical stores", kinds: ["med", "quarantine", "lifesupport"], maxPerShip: 3 },
  { hull: "quarantine", name: "sealed pallets", kinds: ["cryo", "hab"], maxPerShip: 3 },
  // The father's tug: eleven years of somebody else's salvage, still racked.
  { hull: "fathers-tug", name: "salvage lot", kinds: ["workshop", "hab", "cryo"], maxPerShip: 3 },
  { hull: "fathers-tug", name: "stripped racks", kinds: ["sensors", "coreaccess"], maxPerShip: 3 }
];
var HOLD_WEIGHT = 5;
var HOLD_CARDS = HOLDS.map((hold) => ({
  name: hold.name,
  kinds: hold.kinds,
  weight: hold.pinned === true ? PINNED2 : HOLD_WEIGHT,
  maxPerShip: hold.maxPerShip,
  when: (ctx) => isClass(ctx, hold.hull),
  marks: new Array(hold.crates ?? 1).fill("cargo")
}));
var SPARE_PARTS_CRATE = {
  name: "spare parts crate",
  kinds: WORKING,
  weight: 3,
  maxPerShip: 3,
  weightWhen: (ctx) => emptySlots(ctx) >= 2 ? 3 : 1,
  marks: ["X"]
};
var SENSOR_CLOSET = {
  name: "sensor closet",
  kinds: ["maintenance", "lab", "control", "sensors"],
  weightWhen: (ctx) => burned(ctx, "scanner") ? 7 : 1,
  marks: ["X:scanner", "%:scanner"]
};
var CHARGING_ALCOVE = {
  name: "charging alcove",
  kinds: ["hab", "mess", "engineering", "workshop"],
  weightWhen: (ctx) => burnedCount(ctx) >= 1 ? 3 : 1,
  marks: ["X:welder", "%:welder"]
};
var OWN_BULKHEADS = ["barge", "ferry", "probe", "tender"];
var FERRY = "ferry";
var SECURITY_CHECKPOINT = {
  name: "security checkpoint",
  kinds: ["corridor", "control", "armory", "engineering"],
  weight: 2,
  maxPerShip: 1,
  // Pinned on the two hulls whose one bulkhead is a promise rather than a draw:
  // the freighter a voyage opens on, and the training hull a training run opens
  // on instead (`content/tutorial.ts`, `TUTORIAL_ID`). The id is a literal here
  // and not an import, because a card that imported a ship class would close
  // the one loop `zones → cards → derelicts` exists to keep open
  // (docs/adr/0003-decoupling.md); `tests/tutorial.test.ts` holds the two ends
  // of the string together.
  weightWhen: (ctx) => isClass(ctx, "freighter") || isClass(ctx, "tutorial") ? BULKHEAD : 1,
  // And off the four other hulls a voyage can open on entirely. Each of them
  // states its own door plan — the ferry's two gates, the barge's and the
  // probe's open runs, the tender's welds — and each carries one or two
  // machines all told, so a lock nobody promised with the heaviest machine of
  // the band behind it is both a lesson the hull is not teaching and a third of
  // its head count (`content/derelicts.ts`, `STARTER_HULLS`).
  when: (ctx) => !OWN_BULKHEADS.some((id) => isClass(ctx, id)),
  marks: ["M", LOCK_ENTRY]
};
var QUARANTINE_WARD = {
  name: "quarantine ward",
  kinds: ["quarantine", "med"],
  weight: 4,
  maxPerShip: 1,
  sets: ["quarantine"],
  marks: ["M", "X:plating"]
};
var REACTOR_ANTECHAMBER = {
  name: "reactor antechamber",
  kinds: ["reactor"],
  weight: PINNED2,
  maxPerShip: 1,
  marks: ["%:cell", "%:cell"]
};
var THRUSTER_BAY = {
  name: "thruster bay",
  // The docking bay of the first ship is the tutorial and stays small, so this
  // one waits inside the ship rather than competing for the room the drone
  // lands in.
  kinds: ["maintenance", "workshop"],
  weightWhen: (ctx) => burned(ctx, "thrusters") ? 4 : 1,
  marks: ["%:thrusters", "%:thrusters", "X:thrusters"]
};
var ARMORY_LOCKER = {
  name: "armory locker",
  kinds: ["armory", "engineering"],
  weight: 3,
  maxPerShip: 1,
  sets: ["armed"],
  marks: ["X:laser", "M"]
};
var CONTAINMENT_LOCKER = {
  name: "containment locker",
  kinds: ["control", "coreaccess", "lab"],
  maxPerShip: 1,
  weightWhen: (ctx) => ctx.flags.has("quarantine") ? 4 : 1,
  marks: ["X:emp", "%:emp"]
};
var CREW_QUARTERS = {
  name: "crew quarters",
  kinds: ["hab", "cryo", "mess"],
  weight: 2,
  maxPerShip: 1,
  when: (ctx) => !isClass(ctx, FERRY),
  marks: ["\u2020", "\u2020", "\u2020:key", LOCK_ENTRY]
};
var STACKED_SCRAP = {
  name: "stacked scrap",
  kinds: ["cargo", "storage", "maintenance", "corridor"],
  // Over `PICKED_CLEAN`'s twelve, which is the only weight in this deck that
  // means anything: a barge that drew a stripped compartment more often than a
  // stacked one would be a barge with less aboard than the hull it replaced.
  weight: 14,
  maxPerShip: 4,
  when: (ctx) => isClass(ctx, "barge"),
  marks: ["%", "%"]
};
var BOARDING_GATE = {
  name: "boarding gate",
  kinds: ["mess"],
  weight: PINNED2,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, FERRY),
  marks: ["\u2020", LOCK_ENTRY]
};
var MUSTER_POINT = {
  name: "muster point",
  kinds: ["cryo"],
  weight: PINNED2,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, FERRY),
  marks: ["\u2020", "\u2020", LOCK_ENTRY]
};
var SUPPLY_LOCKER = {
  name: "supply locker",
  kinds: ["storage"],
  // Pinned and not merely heavy. `BULKHEAD` is what makes the freighter's one
  // door a near-certainty, and a near-certainty is the wrong shape here: the
  // seeds it misses are not slightly poorer hulls, they are hulls whose third
  // system cannot be raised at all.
  weight: PINNED2,
  maxPerShip: 1,
  when: (ctx) => ["barge", "probe", "tender"].some((id) => isClass(ctx, id)),
  marks: ["\u2020", "\u2020:key", LOCK_ENTRY]
};
var INSTRUMENT_BAY = {
  name: "instrument bay",
  kinds: ["sensors"],
  weight: 8,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "probe"),
  marks: ["X:scanner", "cover"]
};
var WELDING_BAY = {
  name: "welding bay",
  kinds: ["workshop", "maintenance"],
  weight: BULKHEAD,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "tender"),
  marks: ["m:welder-bot", "%:welder"]
};
var SPARES_RACK = {
  name: "spares rack",
  kinds: ["workshop", "maintenance", "storage"],
  weight: 7,
  maxPerShip: 3,
  when: (ctx) => isClass(ctx, "tender"),
  marks: ["X", "%"]
};
var HIDDEN_HOLD = {
  name: "hidden hold",
  kinds: ["storage", "cargo"],
  weight: 3,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "smuggler") && (carries(ctx, "cell") || keysHeld(ctx) > 0),
  marks: ["contraband", "contraband", LOCK_ENTRY]
};
var SPORE_BLOOM = {
  name: "spore bloom",
  kinds: ["quarantine", "hydroponics"],
  weight: 3,
  maxPerShip: 1,
  when: (ctx) => isClass(ctx, "quarantine"),
  marks: ["m:bloom", "m:crawler", "m:crawler", "cover"]
};
var TURRET_NEST = {
  name: "turret nest",
  kinds: ["corridor", "armory"],
  weight: 3,
  maxPerShip: 2,
  when: (ctx) => isClass(ctx, "military"),
  marks: ["m:sentry-turret", "cover"]
};
var ENGINE_ROOM = {
  name: "engine room",
  kinds: ["engineering"],
  weight: PINNED2,
  maxPerShip: 1,
  marks: ["E"]
};
var CORE_ROOM = {
  name: "core room",
  kinds: ["reactor"],
  weight: PINNED2,
  maxPerShip: 1,
  marks: ["O"]
};
var BRIDGE = {
  name: "bridge",
  kinds: ["control"],
  weight: PINNED2,
  maxPerShip: 1,
  marks: ["T"]
};
var DRONE_WRECK = {
  name: "wreck of your drone",
  weight: 5,
  maxPerShip: 1,
  when: (ctx) => ctx.flags.has(deathFlag(ctx.shipIndex)),
  marks: ["%", "%", "m:ghost"]
};
var PICKED_CLEAN = {
  name: "picked clean",
  weight: 12,
  marks: []
};
var CARDS = [
  PICKED_CLEAN,
  DOCKING_BAY,
  CARGO_MANIFEST,
  SPARE_PARTS_CRATE,
  SENSOR_CLOSET,
  CHARGING_ALCOVE,
  SECURITY_CHECKPOINT,
  QUARANTINE_WARD,
  REACTOR_ANTECHAMBER,
  THRUSTER_BAY,
  ARMORY_LOCKER,
  CONTAINMENT_LOCKER,
  CREW_QUARTERS,
  HIDDEN_HOLD,
  SPORE_BLOOM,
  TURRET_NEST,
  // The set pieces of the four hulls a voyage can open on beside the freighter.
  STACKED_SCRAP,
  SUPPLY_LOCKER,
  BOARDING_GATE,
  MUSTER_POINT,
  INSTRUMENT_BAY,
  WELDING_BAY,
  SPARES_RACK,
  ENGINE_ROOM,
  CORE_ROOM,
  BRIDGE,
  DRONE_WRECK,
  // What each class was carrying: the crates a sortie is paid in.
  ...HOLD_CARDS,
  // The charter cards: one pair per compartment kind a charter may name, each
  // eligible only while the run is carrying that charter
  // (`content/cards-derelicts.ts`). In the one deck rather than folded into a
  // hull's own — a card whose `when` is false costs a draw and nothing else.
  ...DERELICT_CARDS
];
var CARDS_PER_ROOM = 2;

// ../../../smoreg_works/games/salvor/src/content/derelicts.ts
var FREIGHTER = {
  id: "freighter",
  name: "freighter",
  rooms: [12, 14],
  maxDepth: 4,
  kinds: [
    ENTRY_KIND,
    "cargo",
    "storage",
    "corridor",
    "maintenance",
    "lifesupport",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["maintenance-bot", "feral-drone", "scout"],
  // No relic: this is the hull the game teaches itself on, and its two or
  // three machines are a count `tests/ship-content.test.ts` holds it to. A
  // guarded crate would be a fourth machine and an unmarked pile on the
  // tutorial, which is the one ship whose contents are all decisions.
  machines: [2, 3],
  // One point of threat and nothing to spend it on: the first hull of a
  // voyage carries no hazard whatever its class (`placeHazards`), and the
  // freighter names none so a freighter drawn later is the same quiet ship.
  threat: 1,
  alertStart: 0,
  salePrice: 200,
  doors: { open: 55, closed: 30, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: false,
  flavour: ["bulk hauler", "fission reactor", "ion drive", "ore run", "long haul"]
};
var DEEP_HULL = 5;
var RELIC_CHANCE = 0.6;
var RELIC_DEPTH = 3;
var CALLSIGNS = [
  "KESTREL",
  "MERIDIAN",
  "ARGENT",
  "LODESTAR",
  "TERMAGANT",
  "OSPREY",
  "CINDER",
  "HALLOWAY",
  "VESPER",
  "BRIGHT ANCHOR",
  "SIX OF SWORDS",
  "PALE HORSE"
];
var BARGE = {
  id: "barge",
  name: "barge",
  rooms: [9, 11],
  maxDepth: 6,
  kinds: [
    ENTRY_KIND,
    "cargo",
    "storage",
    "maintenance",
    "corridor",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["maintenance-bot", "scout"],
  machines: [2, 3],
  // One light hazard, as the design report gives each starter — and only
  // on a barge drawn later than first: the first hull of a voyage is clean
  // by rule (`systems/hazards.ts`, `placeHazards`).
  hazards: ["frost"],
  threat: 1,
  alertStart: 0,
  salePrice: 180,
  doors: { open: 50, closed: 50, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.2,
  virusBonus: 0,
  rival: false,
  flavour: ["ore barge", "banked reactor", "tug drive", "belt run", "cut loose under tow"]
};
var FERRY2 = {
  id: "ferry",
  name: "ferry",
  rooms: [8, 10],
  maxDepth: 4,
  kinds: [
    ENTRY_KIND,
    "hab",
    "cargo",
    "mess",
    "cryo",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["maintenance-bot", "scout"],
  machines: [2, 3],
  hazards: ["smoke"],
  threat: 1,
  alertStart: 0,
  salePrice: 200,
  doors: { open: 55, closed: 45, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.4,
  virusBonus: 0,
  rival: false,
  flavour: ["passenger ferry", "banked reactor", "shuttle drive", "orbital hop", "two hundred aboard"]
};
var PROBE = {
  id: "probe",
  name: "probe",
  rooms: [7, 8],
  maxDepth: 4,
  kinds: [ENTRY_KIND, "sensors", "storage", "engineering", "reactor", "control"],
  band: ["scout", "feral-drone"],
  machines: [1, 2],
  // Nothing: the report's hazards for a probe are static, which is not yet
  // a row of the table, and a mine is not light.
  threat: 1,
  alertStart: 0,
  salePrice: 150,
  doors: { open: 55, closed: 45, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: false,
  flavour: ["survey probe", "cell stack", "drift drive", "far picket", "silent for a decade"]
};
var TENDER = {
  id: "tender",
  name: "tender",
  rooms: [9, 11],
  maxDepth: 5,
  kinds: [
    ENTRY_KIND,
    "workshop",
    "maintenance",
    "storage",
    "corridor",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["welder-bot", "scout"],
  machines: [2, 3],
  threat: 1,
  alertStart: 0,
  salePrice: 220,
  doors: { open: 50, closed: 50, locked: 0, sealed: 0, broken: 0 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: false,
  flavour: ["repair tender", "yard reactor", "yard drive", "refit contract", "left under refit"]
};
var LABORATORY = {
  id: "laboratory",
  name: "laboratory",
  rooms: [14, 17],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND,
    "lab",
    "med",
    "hydroponics",
    "storage",
    "sensors",
    "cryo",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["scout", "scrapper", "welder-bot", "jammer"],
  strains: ["rot", "leech"],
  relics: ["shocker"],
  hazards: ["frost"],
  threat: 3,
  machines: [5, 7],
  alertStart: 0,
  salePrice: 250,
  doors: { open: 30, closed: 35, locked: 25, sealed: 0, broken: 10 },
  keyChance: 0.35,
  virusBonus: 0,
  rival: false,
  flavour: ["research hull", "isotope reactor", "survey drive", "deep survey", "no manifest"]
};
var MILITARY = {
  id: "military",
  name: "military",
  rooms: [16, 19],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND,
    "armory",
    "workshop",
    "corridor",
    "brig",
    "hab",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["security-unit", "hauler", "arc-sentinel", "sentry-turret"],
  // Either relic of an armed hull: the blade its marines carried, or the
  // lattice off its own bulkheads. The lattice is here as well as on the
  // quarantine hull because the tutorial freighter hides nothing (above), and
  // one class in five is too seldom for the strongest relic to be met.
  relics: ["blade", "lattice"],
  hazards: ["mine"],
  threat: 4,
  machines: [6, 8],
  alertStart: 1,
  salePrice: 300,
  doors: { open: 25, closed: 45, locked: 15, sealed: 5, broken: 10 },
  keyChance: 0.3,
  virusBonus: 0,
  rival: false,
  flavour: ["patrol cutter", "shielded reactor", "military drive", "border patrol", "lost with all hands"]
};
var SMUGGLER = {
  id: "smuggler",
  name: "smuggler",
  rooms: [14, 17],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND,
    "storage",
    "maintenance",
    "hab",
    "cargo",
    "escapepods",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["feral-drone", "scrapper", "welder-bot", "jammer"],
  strains: ["spasm", "leech"],
  relics: ["shocker"],
  hazards: ["smoke", "mine"],
  threat: 3,
  machines: [5, 7],
  alertStart: 0,
  salePrice: 270,
  doors: { open: 40, closed: 35, locked: 15, sealed: 0, broken: 10 },
  keyChance: 0.25,
  virusBonus: 0,
  rival: true,
  flavour: ["fast hauler", "stripped reactor", "smuggler's drive", "no registry", "three false holds"]
};
var CORSAIR = {
  id: "corsair",
  name: "corsair",
  rooms: [16, 19],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND,
    "armory",
    "hab",
    "cargo",
    "brig",
    "mess",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["security-unit", "scrapper", "arc-sentinel"],
  strains: ["spasm", "leash"],
  relics: ["blade"],
  hazards: ["smoke", "mine"],
  threat: 3,
  machines: [6, 8],
  alertStart: 2,
  salePrice: 330,
  doors: { open: 25, closed: 30, locked: 10, sealed: 15, broken: 20 },
  keyChance: 0.45,
  virusBonus: 0,
  rival: true,
  flavour: ["raider", "overdriven reactor", "boarding drive", "taken by boarders", "prize crew aboard"]
};
var QUARANTINE2 = {
  id: "quarantine",
  name: "quarantine",
  rooms: [14, 17],
  maxDepth: DEEP_HULL,
  kinds: [
    ENTRY_KIND,
    "quarantine",
    "med",
    "hab",
    "cryo",
    "lifesupport",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["crawler", "bloom", "scrapper"],
  strains: ["spasm", "rot"],
  relics: ["lattice"],
  hazards: ["frost"],
  threat: 3,
  machines: [5, 7],
  alertStart: 1,
  salePrice: 360,
  doors: { open: 25, closed: 40, locked: 5, sealed: 20, broken: 10 },
  keyChance: 0.2,
  virusBonus: 0.15,
  rival: false,
  flavour: ["medical transport", "shielded reactor", "long-haul drive", "sealed from inside", "no distress call"]
};
var FATHERS_TUG = {
  id: "fathers-tug",
  name: "father's tug",
  rooms: [20, 25],
  maxDepth: 6,
  kinds: [
    ENTRY_KIND,
    "workshop",
    "hab",
    "coreaccess",
    "cryo",
    "sensors",
    "engineering",
    "reactor",
    "control"
  ],
  band: ["enforcer", "arc-sentinel", "security-unit"],
  strains: ["spasm", "leash", "rot"],
  hazards: ["smoke"],
  threat: 4,
  machines: [5, 6],
  alertStart: 3,
  salePrice: 0,
  doors: { open: 25, closed: 45, locked: 5, sealed: 5, broken: 20 },
  keyChance: 0.3,
  virusBonus: 0,
  rival: false,
  flavour: ["salvage tug", "fission reactor", "ion drive", "your father's callsign", "missing eleven years"]
};
var DERELICTS = [
  FREIGHTER,
  BARGE,
  FERRY2,
  PROBE,
  TENDER,
  LABORATORY,
  MILITARY,
  SMUGGLER,
  CORSAIR,
  QUARANTINE2,
  FATHERS_TUG
];
var STARTER_HULLS = [
  FREIGHTER,
  BARGE,
  FERRY2,
  PROBE,
  TENDER
];
var MIDDLE_HULLS = [
  LABORATORY,
  MILITARY,
  SMUGGLER,
  CORSAIR,
  QUARANTINE2
];
var KNOWN = [...DERELICTS, TUTORIAL_SPEC];
function derelictSpec(id) {
  return KNOWN.find((d) => d.id === id);
}
function specOfShip(ship) {
  const id = classOfShip(ship);
  return id === void 0 ? void 0 : derelictSpec(id);
}
function derelictsForVoyage(rng) {
  const pool = rng.shuffle([...MIDDLE_HULLS]);
  return [rng.pick(STARTER_HULLS), pool[0], FATHERS_TUG];
}
function rollFlavour(spec2, rng) {
  const words = spec2.flavour;
  const callsign = rng.int(0, CALLSIGNS.length - 1);
  const first = rng.int(0, words.length - 2);
  const second = rng.int(first + 1, words.length - 1);
  return { callsign, first, second };
}
function derelictName(spec2) {
  return tId("derelict", spec2.id, spec2.name);
}
function derelictNameOf(id) {
  const spec2 = id === void 0 ? void 0 : derelictSpec(id);
  return spec2 === void 0 ? void 0 : derelictName(spec2);
}
function flavourCallsign(roll) {
  const i = Math.min(Math.max(0, Math.trunc(roll.callsign)), CALLSIGNS.length - 1);
  return CALLSIGNS[i];
}
function flavourWord(spec2, i) {
  const at = Math.min(Math.max(0, Math.trunc(i)), spec2.flavour.length - 1);
  return tId("flavour", `${spec2.id}.${at}`, spec2.flavour[at] ?? spec2.name);
}
function flavourLine(spec2, roll) {
  const i = Math.min(Math.max(0, Math.trunc(roll.callsign)), CALLSIGNS.length - 1);
  return t("derelict.flavour", {
    callsign: CALLSIGNS[i],
    hull: derelictName(spec2),
    first: flavourWord(spec2, roll.first),
    second: flavourWord(spec2, roll.second)
  });
}
var CHARTER_ATTEMPTS = 6;
function buildChartered(d, index2, rng, ctx) {
  const flags = new Set(ctx.flags);
  flags.add(`${CLASS_FLAG}${d.id}`);
  const spec2 = shipSpecOf(d);
  let last;
  for (let attempt = 0; attempt < CHARTER_ATTEMPTS; attempt++) {
    const built = buildShip(spec2, rng.fork(attempt), { ...ctx, flags, shipIndex: index2 });
    stampClass(built.ship, d);
    last = built;
    if (built.problems.length === 0 && seatCharterMarks(built.ship).length === 0) return built;
  }
  return last;
}
var SPEC_KEY = "derelict";
function classOfShip(ship) {
  const id = ship.roomAt(ship.entry).data[SPEC_KEY];
  return typeof id === "string" ? id : void 0;
}
function stampClass(ship, d) {
  ship.roomAt(ship.entry).data[SPEC_KEY] = d.id;
}
function shipSpecOf(d) {
  return {
    rooms: d.rooms,
    maxDepth: d.maxDepth,
    kinds: d.kinds.map(zoneKind),
    entryKind: ENTRY_KIND,
    doors: d.doors,
    cards: CARDS,
    cardsPerRoom: CARDS_PER_ROOM,
    // Every hull of this game is a honeycomb: a compartment is a cell, a door
    // only ever joins two cells that touch, and a shared edge is a door only
    // sometimes (`ShipSpec.lattice`). The owner's rule for the third view, and
    // the only way that view has nothing left over to explain.
    lattice: true
  };
}

// ../../../smoreg_works/games/salvor/src/content/palette.ts
var PALETTE = {
  bg: "#0a0d10",
  panelBg: "#10151a",
  /** Frames, wires and everything structural on the schematic. */
  fgDim: "#3f4a52",
  fg: "#b9c4cc",
  /** A room the drone can see right now: the one colour brighter than `fg`. */
  bright: "#dfe9f0",
  accent: "#e0a458",
  /** Burned-out module slots. */
  burned: "#4a3a3a",
  /**
   * The hairline between blocks, and the ground a spent integrity bar runs on.
   * Darker than `fgDim`, which is ink: this one is never read, only bounded by.
   */
  line: "#1d242a",
  /**
   * Second-rank text: a note beside a row, a unit after a number. Between `fg`
   * and `fgDim`, where the graphic view needed a step the terminal never did —
   * a character cell has no room for a note, so it either fits or is cut.
   */
  soft: "#8f9aa2",
  /** A room known only from a sensor pulse: seen, never entered. */
  zone: "#6f8a9a",
  /** The hull line down the right edge of the schematic. */
  hull: "#8a3a3a",
  /** The drone's own airlock: muted accent, worth spotting, not loud. */
  airlock: "#a07a44",
  /** A sealed bulkhead: a wall that reads as a door that will not open. */
  bulkhead: "#5a4e42",
  good: "#7fc97f",
  bad: "#d96a6a",
  warn: "#d9b56a",
  hpFull: "#7fc97f",
  hpLow: "#d96a6a",
  /**
   * Door labels by state. The order is the order of trouble: a door you can
   * walk through is quiet, one that costs a turn or a tool shouts.
   */
  door: {
    open: "#3f4a52",
    broken: "#3f4a52",
    closed: "#6f8a9a",
    locked: "#e0a458",
    sealed: "#5a4e42",
    airlock: "#a07a44"
  },
  /**
   * The drawn hull under the honeycomb (`ui/web/hullart.ts`), as three steps
   * of tone and no fewer: `bg` under the ship, `body` for its mass, `plate`
   * for anything sitting on that mass. A hull filled a shade off the
   * background read as an outline over nothing and swallowed every frame and
   * seam drawn inside it (`experiments/hullforms/README.md`). Nothing here is
   * amber: amber is the doors' and the airlock's, and a hull that spent it on
   * portholes lost the doors among them.
   */
  hullArt: {
    body: "#1b242c",
    plate: "#28343e",
    /** A panel caught in a different light: the bridge, a dish. */
    plateLit: "#33414d",
    /** A vent, a bell, a hatch: darker than the background. */
    deep: "#080b0e",
    /** The skin line, the one stroke brighter than the steel. */
    rim: "#8fa8b6"
  }
};

// ../../../smoreg_works/games/salvor/src/names.ts
function entityLabel(game, e) {
  return e.id === game.player.id ? t("label.you") : t("label.other", { name: machineName(e.name) });
}
function capitalize(s) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ../../../smoreg_works/games/salvor/src/systems/jam.ts
var BAD_FG = "#d96a6a";
function jammed(game) {
  const here3 = game.player.room;
  if (here3 === void 0) return false;
  return game.entities.some((e) => e.name === JAMMER.name && e.room === here3 && isAlive(e));
}
var JAM = {
  name: "jam",
  /**
   * Nothing while the rack answers, one word while it does not. Silence is the
   * correct panel for a mechanic that is off: a permanent "JAMMED ▯" would cost
   * a line of a panel that is already full of the rack.
   */
  panelLines(game) {
    return jammed(game) ? [{ text: "JAMMED", fg: BAD_FG }] : [];
  }
};

// ../../../smoreg_works/games/salvor/src/content/viruses.ts
var SPASM = {
  id: "spasm",
  name: "SPASM",
  period: 8,
  spread: 20,
  beat: { kind: "expose" }
};
var ROT = {
  id: "rot",
  name: "ROT",
  period: 5,
  spread: 0,
  beat: { kind: "wear", points: 1 }
};
var LEECH = {
  id: "leech",
  name: "LEECH",
  period: 12,
  spread: 0,
  beat: { kind: "skim", credits: 5 }
};
var LEASH = {
  id: "leash",
  name: "LEASH",
  period: 18,
  spread: 0,
  beat: { kind: "core", points: 1 }
};
var STRAINS = [SPASM, ROT, LEECH, LEASH];
var DEFAULT_STRAIN = SPASM.id;
function strainOf(id) {
  return STRAINS.find((s) => s.id === id) ?? SPASM;
}
function strainName(strain) {
  return tId("strain", strain.id, strain.name);
}

// ../../../smoreg_works/games/salvor/src/systems/purse.ts
function creditsOf(game) {
  const purse = read(game);
  return purse === void 0 ? 0 : purse.credits;
}
function takeCredits(game, want) {
  const purse = read(game);
  if (purse === void 0 || want <= 0) return 0;
  const took = Math.min(want, purse.credits);
  purse.credits -= took;
  return took;
}
function read(game) {
  const raw2 = game.player.data?.voyage;
  if (typeof raw2 !== "object" || raw2 === null) return void 0;
  const purse = raw2;
  return typeof purse.credits === "number" ? purse : void 0;
}

// ../../../smoreg_works/games/salvor/src/systems/virus.ts
var TWITCH_PERIOD = strainOf("spasm").period;
var SPREAD_TURNS = strainOf("spasm").spread;
var TWITCH_NOISE = 6;
var CURE_TURNS = 2;
var PURGE_NOISE = 5;
var BENCH_CURE_PRICE = 4;
var INFECTED_SELL_SHARE = 0.5;
var BAD_FG2 = "#d96a6a";
var VIRUS_HINT_KEY = "hint.virus";
var CURE_VERB = "cure";
var FAIL2 = (reason) => ({ ok: false, cost: 0, reason });
var DONE2 = () => ({ ok: true, cost: TURN_COST });
var SOURCE_CHANCE = {
  crate: 0,
  machine: 0.1,
  drone: 0.15,
  ghost: 0.25,
  // A competitor's drone is the same kind of thing as your own wreck: a rack
  // that has been aboard derelicts, not a thing the derelict grew.
  rival: 0.15
};
function infectChance(source, bonus = 0) {
  const base = SOURCE_CHANCE[source];
  if (base <= 0) return 0;
  return Math.min(1, Math.max(0, base + bonus));
}
function virusOf(player) {
  const raw2 = player.data?.virus;
  if (typeof raw2 !== "object" || raw2 === null) return void 0;
  const v = raw2;
  if (typeof v.slot !== "number" || typeof v.since !== "number" || typeof v.turns !== "number") {
    return void 0;
  }
  return raw2;
}
function clearVirus(player) {
  const v = virusOf(player);
  if (!v || !player.data) return void 0;
  delete player.data.virus;
  return v.slot;
}
function strainOn(game) {
  const listed = specOfShip(game.ship)?.strains ?? [];
  return strainOf(listed.length === 0 ? DEFAULT_STRAIN : game.rng.pick(listed));
}
function tryInfect(game, slot, source, bonus = 0) {
  const rig = rigOf(game.player);
  if (!rig || !rig.slots[slot]) return false;
  if (virusOf(game.player)) return false;
  const chance = infectChance(source, bonus);
  if (chance <= 0 || !game.rng.chance(chance)) return false;
  const data = game.player.data ??= {};
  const strain = strainOn(game);
  const state = { strain: strain.id, slot, since: game.inputs.length, turns: 0 };
  data.virus = state;
  game.log.add(
    t("log.virus.caught", { module: nameOf(rig, slot), virus: strainName(strain) }),
    game.schedule.time,
    "bad",
    "log.virus.caught"
  );
  hintOnce(game, "virus", t(VIRUS_HINT_KEY));
  return true;
}
function beat(game, rig, v, strain) {
  addNoise(game, game.roomOf(game.player).id, TWITCH_NOISE);
  const module = nameOf(rig, v.slot);
  const virus = strainName(strain);
  switch (strain.beat.kind) {
    case "expose":
      rig.exposed = v.slot;
      say(game, "log.virus.twitch", { module, virus });
      return;
    case "wear": {
      const hit = hitSlot(rig, v.slot, strain.beat.points);
      applyDerived(game.player);
      if (hit.burned) say(game, "log.virus.rot.burned", { module, virus });
      else say(game, "log.virus.rot", { module, virus, left: hit.remaining });
      return;
    }
    case "skim": {
      const took = takeCredits(game, strain.beat.credits);
      if (took > 0) say(game, "log.virus.skim", { virus, amount: took });
      else say(game, "log.virus.skim.empty", { virus });
      return;
    }
    case "core":
      applyDamage(game.player, strain.beat.points);
      say(game, "log.virus.core", { virus, left: Math.max(0, game.player.hp) });
      return;
  }
}
function say(game, key3, params) {
  game.log.add(t(key3, params), game.schedule.time, "bad", key3);
}
function addNoise(game, room, strength) {
  const heard = propagateRooms(game.ship, [{ room, strength }]);
  const merged = new Map(game.noise);
  for (const [id, level] of heard) {
    if (level > (merged.get(id) ?? 0)) merged.set(id, level);
  }
  game.noise = merged;
}
function spread2(game, rig, v) {
  const next = nextIntact(rig, v.slot);
  if (next === void 0) return;
  const from = nameOf(rig, v.slot);
  v.slot = next;
  v.since = game.inputs.length - 1;
  delete v.curing;
  game.log.add(
    t("log.virus.moves", { from, to: nameOf(rig, next) }),
    game.schedule.time,
    "bad",
    "log.virus.moves"
  );
}
function nextIntact(rig, from) {
  for (let step = 1; step < rig.slots.length; step++) {
    const i = (from + step) % rig.slots.length;
    if (rig.slots[i]) return i;
  }
  return void 0;
}
function purge(game, slot) {
  const rig = rigOf(game.player);
  const v = rig ? virusOf(game.player) : void 0;
  if (!rig || !v || !rig.slots[v.slot]) return FAIL2(t("why.virus.none"));
  if (slot !== void 0 && slot !== v.slot) return FAIL2(t("why.virus.clean"));
  if (findSlot(rig, "welder") === null) return FAIL2(noWelder());
  const left = advance(game, v);
  game.makeNoise(game.roomOf(game.player).id, PURGE_NOISE);
  if (left > 0) {
    game.log.add(
      t("log.virus.purge.on", { module: nameOf(rig, v.slot) }),
      game.schedule.time,
      "plain",
      "log.virus.purge.on"
    );
    return DONE2();
  }
  const name = nameOf(rig, v.slot);
  clearVirus(game.player);
  game.log.add(t("log.virus.purge.done", { module: name }), game.schedule.time, "good", "log.virus.purge.done");
  return DONE2();
}
function advance(game, v) {
  const resumed = v.curing !== void 0 && v.curing.turn === game.inputs.length - 1;
  const left = (resumed ? v.curing.left : CURE_TURNS) - 1;
  if (left > 0) v.curing = { left, turn: game.inputs.length };
  else delete v.curing;
  return left;
}
function breakOff(game, v) {
  if (v.curing === void 0 || v.curing.turn === game.inputs.length - 1) return;
  delete v.curing;
  game.log.add(t("log.work.break.purge"), game.schedule.time, "warn", "log.work.break.purge");
}
var VIRUS = {
  name: "virus",
  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    const rig = rigOf(game.player);
    const v = rig ? virusOf(game.player) : void 0;
    if (!rig || !v) return;
    breakOff(game, v);
    if (!rig.slots[v.slot]) {
      clearVirus(game.player);
      game.log.add(t("log.virus.burned"), game.schedule.time, "good", "log.virus.burned");
      return;
    }
    const age = game.inputs.length - v.since - 1;
    if (age <= 0) return;
    const strain = strainOf(v.strain);
    v.turns++;
    if (age % strain.period === 0) beat(game, rig, v, strain);
    if (strain.spread > 0 && age >= strain.spread) spread2(game, rig, v);
  },
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== CURE_VERB) return void 0;
    return purge(game, cmd.slot);
  },
  offerActions(game) {
    const offers = [];
    if (game.status !== "playing") return offers;
    const rig = rigOf(game.player);
    const v = rig ? virusOf(game.player) : void 0;
    if (!rig || !v || !rig.slots[v.slot]) return offers;
    const left = v.curing?.left ?? CURE_TURNS;
    const welder = findSlot(rig, "welder") !== null;
    const offer3 = {
      label: t("action.purge", { module: nameOf(rig, v.slot), left }),
      cmd: { kind: "act", verb: CURE_VERB, slot: v.slot },
      enabled: welder
    };
    if (!welder) offer3.why = noWelder();
    offers.push(offer3);
    return offers;
  },
  panelLines(game) {
    const rig = rigOf(game.player);
    const v = rig ? virusOf(game.player) : void 0;
    if (!rig || !v || !rig.slots[v.slot]) return [];
    const strain = strainOf(v.strain);
    return [
      {
        text: t("panel.virus", { virus: strainName(strain), module: nameOf(rig, v.slot) }),
        fg: BAD_FG2
      }
    ];
  }
};
function nameOf(rig, slot) {
  const kind = rig.slots[slot]?.kind;
  return kind === void 0 ? t("word.module") : moduleName(kind);
}
function noWelder() {
  return t("why.module.missing", { module: moduleName("welder") });
}
function hintOnce(game, flag, text3) {
  const data = game.player.data ??= {};
  const said2 = data.hints ?? {};
  data.hints = said2;
  if (said2[flag] === true) return;
  said2[flag] = true;
  game.log.add(text3, game.schedule.time, "warn");
}

// ../../../smoreg_works/games/salvor/src/twist/rig.ts
var SLOT_COUNT = 6;
var PANEL_LINE_WIDTH = 28;
var RELIC_MARK = "\u25AA";
function makeStartingRig(size = SLOT_COUNT) {
  return rigFrom(STARTING_MODULES.map((id) => makeSlot(id, moduleKind(id).integrity)), size);
}
function rigFrom(slots, size = SLOT_COUNT) {
  const room = Math.max(size, slots.length);
  const out2 = [];
  for (let i = 0; i < room; i++) out2.push(slots[i] ?? null);
  return {
    slots: out2,
    exposed: null,
    burnedCount: 0,
    burned: [],
    scars: new Array(room).fill(null)
  };
}
function makeSlot(kind, integrity, charges, base, bonus) {
  const k = moduleKind(kind);
  const cap = Math.max(base ?? k.integrity, k.integrity);
  const grafted = clamp(bonus ?? 0, 0, MAX_GRAFT);
  const slot = { kind, integrity: clamp(integrity, 1, cap + grafted) };
  if (cap !== k.integrity) slot.base = cap;
  if (grafted > 0) slot.bonus = grafted;
  if (k.charges !== void 0) slot.charges = charges ?? k.charges;
  return slot;
}
function capOf(slot) {
  return (slot.base ?? moduleKind(slot.kind).integrity) + (slot.bonus ?? 0);
}
function findSlot(rig, kind) {
  for (let i = 0; i < rig.slots.length; i++) {
    if (rig.slots[i]?.kind === kind) return i;
  }
  return null;
}
function findSlotAs(rig, kind) {
  const exact = findSlot(rig, kind);
  if (exact !== null) return exact;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (slot && moduleKind(slot.kind).countsAs === kind) return i;
  }
  return null;
}
function install(rig, kind, integrity, charges, base, bonus) {
  const i = rig.slots.findIndex((s) => s === null);
  if (i < 0) return void 0;
  installAt(rig, i, kind, integrity, charges, base, bonus);
  return i;
}
function installAt(rig, i, kind, integrity, charges, base, bonus) {
  rig.slots[i] = makeSlot(kind, integrity, charges, base, bonus);
  rig.scars[i] = null;
}
function removeSlot(rig, i) {
  const slot = rig.slots[i];
  if (!slot) return void 0;
  rig.slots[i] = null;
  if (rig.exposed === i) rig.exposed = null;
  return slot;
}
function repair(rig, exclude, amount = 1) {
  let best = null;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot2 = rig.slots[i];
    if (!slot2 || i === exclude || isRelic(slot2.kind)) continue;
    if (slot2.integrity >= capOf(slot2)) continue;
    if (best === null || slot2.integrity < rig.slots[best].integrity) best = i;
  }
  if (best === null) return void 0;
  const slot = rig.slots[best];
  const max = capOf(slot);
  slot.integrity = Math.min(max, slot.integrity + amount);
  return { slot: best, kind: slot.kind, integrity: slot.integrity, max };
}
function graft(rig, slot) {
  const s = rig.slots[slot];
  if (!s || isRelic(s.kind) || (s.bonus ?? 0) >= MAX_GRAFT) return void 0;
  s.bonus = (s.bonus ?? 0) + 1;
  s.integrity += 1;
  return { slot, kind: s.kind, integrity: s.integrity, max: capOf(s) };
}
var VERB_MODULE = {
  close: "thrusters",
  weld: "welder",
  cut: "cutter",
  spike: "spike",
  power: "cell",
  shoot: "emitter",
  // Burning a virus out is welding, and it exposes the welder like any other
  // welding does (`systems/virus.ts`). Without the row the purge would expose
  // the PLATING, which is the one thing a drone standing still is not risking.
  cure: "welder"
};
function expose(game, rig, cmd) {
  rig.exposed = exposureFor(game, rig, cmd);
  return rig.exposed;
}
function exposureFor(game, rig, cmd) {
  switch (cmd.kind) {
    case "attack":
      return attackExposure(rig);
    case "go":
      return findSlot(rig, "thrusters");
    case "wait":
    case "hide":
      return findSlot(rig, "plating");
    case "leave":
      return null;
    case "act":
      return actExposure(game, rig, cmd);
  }
}
function actExposure(game, rig, cmd) {
  if (cmd.verb === "use") {
    return cmd.slot !== void 0 && rig.slots[cmd.slot] ? cmd.slot : null;
  }
  if (cmd.verb === "work") {
    const tool = cmd.target === void 0 ? void 0 : hackTargetAt(game, cmd.target)?.expose;
    return findSlotAs(rig, tool ?? "plating");
  }
  if (cmd.verb === "swap") return findSlotAs(rig, "plating");
  return findSlotAs(rig, VERB_MODULE[cmd.verb] ?? "plating");
}
function attackExposure(rig) {
  return meleeSlot(rig) ?? findSlot(rig, "thrusters");
}
function meleeSlot(rig) {
  let best = null;
  let bestRoll = -1;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (!slot) continue;
    const kind = moduleKind(slot.kind);
    if (!kind.attack || (kind.range ?? 0) > 0) continue;
    const roll = expectedRoll(kind.attack);
    if (roll > bestRoll) {
      best = i;
      bestRoll = roll;
    }
  }
  return best;
}
function expectedRoll(a) {
  return a[0] * (a[1] + 1) / 2 + a[2];
}
function routeDamage(rig, raw2, tags = []) {
  const hits = [];
  if (raw2 <= 0) return { hits, toCore: 0 };
  if (tags.includes("burst")) {
    for (let i = 0; i < rig.slots.length; i++) {
      if (rig.slots[i]) hits.push(hitSlot(rig, i, 1));
    }
    return { hits, toCore: 0 };
  }
  let left = raw2;
  for (const i of chain(rig, tags)) {
    if (left <= 0) break;
    const slot = rig.slots[i];
    if (!slot) continue;
    const take2 = Math.min(left, slot.integrity);
    left -= take2;
    hits.push(hitSlot(rig, i, take2));
  }
  return { hits, toCore: left };
}
function chain(rig, tags) {
  const first = tags.includes("precise") ? weakestSlot(rig) : rig.exposed !== null && rig.slots[rig.exposed] ? rig.exposed : null;
  const out2 = [];
  if (first !== null) out2.push(first);
  const plating2 = findSlotAs(rig, "plating");
  if (plating2 !== null && !out2.includes(plating2)) out2.push(plating2);
  return tags.includes("corrosive") ? out2.filter((i) => !isArmour(rig.slots[i])) : out2;
}
function isArmour(slot) {
  if (!slot) return false;
  return slot.kind === "plating" || moduleKind(slot.kind).countsAs === "plating";
}
function weakestSlot(rig) {
  let best = null;
  for (let i = 0; i < rig.slots.length; i++) {
    const slot = rig.slots[i];
    if (!slot) continue;
    if (best === null || slot.integrity < rig.slots[best].integrity) best = i;
  }
  return best;
}
function hitSlot(rig, i, amount) {
  const slot = rig.slots[i];
  const kind = slot.kind;
  slot.integrity -= amount;
  const burned2 = slot.integrity <= 0;
  const remaining = burned2 ? 0 : slot.integrity;
  if (burned2) burnOut(rig, i);
  return { slot: i, kind, amount, remaining, burned: burned2 };
}
function burnOut(rig, i) {
  const slot = rig.slots[i];
  rig.slots[i] = null;
  rig.scars[i] = slot.kind;
  rig.burned.push(slot.kind);
  rig.burnedCount = rig.burned.length;
  if (rig.exposed === i) rig.exposed = null;
}
function derivedStats(rig) {
  const weapon = meleeSlot(rig);
  const attack2 = weapon === null ? BARE_CHASSIS.damage : moduleKind(rig.slots[weapon].kind).attack;
  const baffle = intact(rig, "baffle");
  const thrusters = slotWith(rig, "thrusters");
  let defense = 0;
  for (const slot of rig.slots) if (slot) defense += moduleKind(slot.kind).defense ?? 0;
  return {
    speed: thrusters?.speed ?? intact(rig, "thrusters")?.speed ?? BARE_CHASSIS.speed,
    sight: intact(rig, "scanner")?.sight ?? BARE_CHASSIS.sight,
    damage: [attack2[0], attack2[1], attack2[2]],
    noisePenalty: baffle?.noisePenalty ?? 0,
    machineFovPenalty: baffle?.machineFovPenalty ?? 0,
    defense
  };
}
function intact(rig, kind) {
  return findSlot(rig, kind) === null ? void 0 : moduleKind(kind);
}
function slotWith(rig, kind) {
  const i = findSlot(rig, kind);
  return i === null ? void 0 : rig.slots[i] ?? void 0;
}
function rigOf(entity) {
  return entity.data?.rig;
}
function applyDerived(player) {
  const rig = rigOf(player);
  if (!rig) return;
  const stats = derivedStats(rig);
  player.speed = stats.speed;
  player.sight = stats.sight;
  player.damage = stats.damage;
  player.defense = stats.defense;
}
function wreckSource(wreck) {
  const raw2 = wreck.source;
  return raw2 === "drone" || raw2 === "ghost" || raw2 === "rival" || raw2 === "crate" ? raw2 : "machine";
}
function wrecksIn(game, room) {
  return wrecksOn(game.ship, room);
}
function wrecksOn(ship, room) {
  const data = ship.roomAt(room).data;
  const existing = data.wrecks;
  if (existing) return existing;
  const fresh2 = [];
  data.wrecks = fresh2;
  return fresh2;
}
var FIRST_SHIP_ID = 1e3;
function nextShipId(game) {
  const data = game.currentShip.data;
  const next = typeof data.nextId === "number" ? data.nextId : FIRST_SHIP_ID;
  data.nextId = next + 1;
  return next;
}
function addWreck(game, room, kind, integrity, glyph = "%", charges) {
  const wreck = { id: nextShipId(game), kind, integrity, glyph };
  if (charges !== void 0) wreck.charges = charges;
  wrecksIn(game, room).push(wreck);
  return wreck;
}
function wreckAt(game, room, id) {
  return wrecksIn(game, room).find((w) => w.id === id);
}
function removeWreck(game, room, wreck) {
  const wrecks = wrecksIn(game, room);
  const i = wrecks.indexOf(wreck);
  if (i >= 0) wrecks.splice(i, 1);
}
function takeFor(rig, kind) {
  const relic = isRelic(kind);
  const slot = findSlot(rig, kind);
  if (slot !== null) {
    if (relic) return { kind: "no", why: t("why.relic.have", { module: moduleName(kind) }) };
    const s = rig.slots[slot];
    if ((s.bonus ?? 0) < MAX_GRAFT) return { kind: "graft", slot };
    if (s.integrity < capOf(s)) return { kind: "mend", slot };
    return { kind: "no", why: t("why.graft.full") };
  }
  if (rig.slots.some((s) => s === null)) return { kind: "install" };
  if (relic) {
    const upgrades = moduleKind(kind).upgrades;
    return { kind: "swap", slot: upgrades === void 0 ? null : findSlot(rig, upgrades) };
  }
  return { kind: "no", why: t("why.rack.burnFirst") };
}
function swapSlots(rig, kind) {
  const take2 = takeFor(rig, kind);
  if (take2.kind !== "swap") return [];
  const rest = rig.slots.flatMap((slot, i) => slot && i !== take2.slot ? [{ i, left: slot.integrity }] : []).sort((a, b) => a.left - b.left || a.i - b.i).map((s) => s.i);
  return take2.slot === null ? rest : [take2.slot, ...rest];
}
var CARRY_LIMIT = 2;
function carriedFrom(kind, integrity, charges, base, bonus) {
  const out2 = { kind, integrity };
  if (base !== void 0 && base !== moduleKind(kind).integrity) out2.base = base;
  if (charges !== void 0) out2.charges = charges;
  if (bonus !== void 0 && bonus > 0) out2.bonus = bonus;
  return out2;
}
function carriedBy(player) {
  const raw2 = player.data?.carry;
  if (!Array.isArray(raw2)) return [];
  return raw2.filter(
    (item) => typeof item === "object" && item !== null && typeof item.kind === "string" && typeof item.integrity === "number"
  );
}
function setCarried(player, carry) {
  const data = player.data ??= {};
  if (carry.length === 0) delete data.carry;
  else data.carry = [...carry];
}
function carryWreck(game, target) {
  const here3 = game.roomOf(game.player).id;
  const wrecks = wrecksIn(game, here3);
  const wreck = target === void 0 ? wrecks[0] : wrecks.find((w) => w.id === target);
  if (!wreck) return FAIL3(t("why.salvage.none"));
  const carrying = carriedBy(game.player);
  if (carrying.length >= CARRY_LIMIT) return FAIL3(t("why.carry.full", { n: CARRY_LIMIT }));
  setCarried(game.player, [...carrying, carriedFrom(wreck.kind, wreck.integrity, wreck.charges)]);
  removeWreck(game, here3, wreck);
  game.makeNoise(here3, SALVAGE_NOISE);
  const kind = moduleKind(wreck.kind);
  game.log.add(
    t("log.carry.take", {
      module: moduleName(kind.id),
      left: wreck.integrity,
      max: kind.integrity,
      n: carrying.length + 1,
      limit: CARRY_LIMIT
    }),
    game.schedule.time,
    "good",
    "log.carry.take"
  );
  return DONE3();
}
function salvage(game, target) {
  const rig = rigOf(game.player);
  if (!rig) return FAIL3(t("why.salvage.noRig"));
  const here3 = game.roomOf(game.player).id;
  const wrecks = wrecksIn(game, here3);
  const wreck = target === void 0 ? wrecks[0] : wrecks.find((w) => w.id === target);
  if (!wreck) return FAIL3(t("why.salvage.none"));
  const take2 = takeFor(rig, wreck.kind);
  const kind = moduleKind(wreck.kind);
  let line2;
  let key3;
  let installed;
  switch (take2.kind) {
    case "no":
      return FAIL3(take2.why);
    // A relic into a full rack: in one press where the rack holds the module
    // it upgrades, otherwise the list's own `swap` lines say which slot.
    case "swap":
      if (take2.slot === null) return FAIL3(t("why.relic.pick"));
      return swapIn(game, rig, wreck, take2.slot);
    case "graft": {
      const done = graft(rig, take2.slot);
      key3 = "log.salvage.graft";
      line2 = t(key3, { module: moduleName(kind.id), left: done.integrity, max: done.max });
      break;
    }
    case "mend": {
      const slot = rig.slots[take2.slot];
      slot.integrity = Math.min(capOf(slot), slot.integrity + 1);
      key3 = "log.salvage.mend";
      line2 = t(key3, { module: moduleName(kind.id), left: slot.integrity, max: capOf(slot) });
      break;
    }
    case "install": {
      const slot = install(rig, wreck.kind, wreck.integrity, wreck.charges);
      key3 = "log.salvage.install";
      line2 = t(key3, {
        module: moduleName(kind.id),
        left: rig.slots[slot].integrity,
        max: kind.integrity
      });
      installed = slot;
      break;
    }
  }
  removeWreck(game, here3, wreck);
  applyDerived(game.player);
  game.makeNoise(here3, SALVAGE_NOISE);
  game.log.add(line2, game.schedule.time, "good", key3);
  if (installed !== void 0) {
    relicLine(game, wreck.kind);
    tryInfect(game, installed, wreckSource(wreck), specOfShip(game.ship)?.virusBonus ?? 0);
  }
  return DONE3();
}
function swapFor(game, target, slot) {
  const rig = rigOf(game.player);
  if (!rig) return FAIL3(t("why.salvage.noRig"));
  const here3 = game.roomOf(game.player).id;
  const wreck = target === void 0 ? void 0 : wreckAt(game, here3, target);
  if (!wreck) return FAIL3(t("why.salvage.none"));
  const take2 = takeFor(rig, wreck.kind);
  if (take2.kind === "no") return FAIL3(take2.why);
  if (take2.kind !== "swap") return FAIL3(t("why.swap.free"));
  if (slot === void 0 || !rig.slots[slot]) return FAIL3(t("why.rig.emptySlot"));
  return swapIn(game, rig, wreck, slot);
}
function swapIn(game, rig, wreck, slot) {
  const here3 = game.roomOf(game.player).id;
  const out2 = removeSlot(rig, slot);
  const carrying = carriedBy(game.player);
  let key3;
  if (carrying.length < CARRY_LIMIT) {
    setCarried(game.player, [...carrying, carriedFrom(out2.kind, out2.integrity, out2.charges, out2.base, out2.bonus)]);
    key3 = "log.swap.carried";
  } else {
    const pile = addWreck(game, here3, out2.kind, out2.integrity, "%", out2.charges);
    pile.source = "crate";
    key3 = "log.swap.dropped";
  }
  installAt(rig, slot, wreck.kind, wreck.integrity, wreck.charges);
  removeWreck(game, here3, wreck);
  applyDerived(game.player);
  game.makeNoise(here3, SALVAGE_NOISE);
  game.log.add(
    t(key3, { module: moduleName(wreck.kind), old: moduleName(out2.kind) }),
    game.schedule.time,
    "good",
    key3
  );
  relicLine(game, wreck.kind);
  tryInfect(game, slot, wreckSource(wreck), specOfShip(game.ship)?.virusBonus ?? 0);
  return DONE3();
}
function relicLine(game, kind) {
  if (!isRelic(kind)) return;
  game.log.add(
    t("log.relic.take", { module: moduleName(kind) }),
    game.schedule.time,
    "warn",
    "log.relic.take"
  );
}
var PULSE_DOORS = 2;
var PULSE_NOISE = 8;
var EMP_STUN_TURNS = 3;
var EMP_NOISE = 6;
var WELD_NOISE = 5;
var SPIKE_NOISE = 4;
var EMITTER_NOISE = 7;
var SALVAGE_NOISE = 2;
var FAIL3 = (reason) => ({ ok: false, cost: 0, reason });
var DONE3 = () => ({ ok: true, cost: TURN_COST });
var JAMMED_KEY = "why.jammed";
var SPIKE_TURNS = 2;
var HACK_SOURCES = [];
function registerHackTarget(source) {
  HACK_SOURCES.push(source);
}
function hackTargetAt(game, target) {
  for (const source of HACK_SOURCES) {
    const hit = source(game, target);
    if (hit) return hit;
  }
  return void 0;
}
var DAMAGE_VETOES = [];
function registerDamageVeto(veto) {
  DAMAGE_VETOES.push(veto);
}
function vetoed(game, source) {
  return DAMAGE_VETOES.some((veto) => veto(game, source));
}
var BLOW_CAUSE;
function blamedOn(cause, blow2) {
  const outer = BLOW_CAUSE;
  BLOW_CAUSE = cause;
  try {
    return blow2();
  } finally {
    BLOW_CAUSE = outer;
  }
}
function useModule(game, cmd) {
  const rig = rigOf(game.player);
  const index2 = cmd.slot;
  const slot = rig && index2 !== void 0 ? rig.slots[index2] : void 0;
  if (!rig || !slot || index2 === void 0) return FAIL3(t("why.rig.emptySlot"));
  switch (slot.kind) {
    case "scanner":
      return pulse(game);
    case "emp":
      return discharge(game, slot, EMP_STUN_TURNS);
    case "shocker":
      return discharge(game, slot, SHOCK_STUN_TURNS);
    case "welder":
      return weld(game, rig, index2);
    case "spike":
      return breach(game, cmd.target);
    case "emitter":
      return shoot(game, slot);
    default:
      return FAIL3(t("why.module.passive"));
  }
}
function breach(game, target) {
  const hit = target === void 0 ? void 0 : hackTargetAt(game, target);
  if (!hit) return FAIL3(t("why.breach.nothing"));
  hit.turnsLeft = Math.max(0, hit.turnsLeft - 1);
  game.makeNoise(game.roomOf(game.player).id, SPIKE_NOISE);
  if (hit.turnsLeft > 0) {
    game.log.add(
      t("log.spike.on", { spike: moduleName("spike"), target: hit.name }),
      game.schedule.time,
      "plain",
      "log.spike.on"
    );
    return DONE3();
  }
  hit.breach(game);
  game.log.add(t("log.spike.done", { target: hit.name }), game.schedule.time, "good", "log.spike.done");
  return DONE3();
}
function shoot(game, slot) {
  const kind = moduleKind(slot.kind);
  const dice = kind.attack ?? BARE_CHASSIS.damage;
  const target = shootTarget(game);
  if (!target) return FAIL3(t("why.shoot.none"));
  const raw2 = game.rng.roll(dice[0], dice[1]) + dice[2];
  const res = dealDamage(game, target, Math.max(1, raw2 - effectiveDefense(target)), game.player);
  game.makeNoise(game.roomOf(game.player).id, EMITTER_NOISE);
  const hit = t("log.emitter.hit", {
    emitter: moduleName("emitter"),
    target: entityLabel(game, target),
    n: res.toHp,
    hp: Math.max(0, target.hp),
    max: target.hpMax
  });
  game.log.add(
    hit,
    game.schedule.time,
    "good",
    "log.emitter.hit"
  );
  if (res.killed) {
    game.log.add(
      t("log.machine.dies", { target: capitalize(entityLabel(game, target)) }),
      game.schedule.time,
      "good",
      "log.machine.dies"
    );
    game.onDeath(target);
    return DONE3();
  }
  if ((target.range ?? 0) >= 1) hint(game, "shooting");
  return DONE3();
}
function shootTarget(game) {
  const here3 = game.roomOf(game.player).id;
  const foes = game.entities.filter((e) => e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e));
  return foes.find((e) => e.room === here3) ?? foes.find((e) => canSee2(game.ship, game.player, e));
}
function pulse(game) {
  const here3 = game.roomOf(game.player).id;
  const found = [];
  for (const id of scanRooms(game.ship, here3, PULSE_DOORS)) {
    const room = game.ship.roomAt(id);
    if (!room.scanned && id !== here3 && wrecksIn(game, id).some((w) => isRelic(w.kind))) {
      found.push(roomName(room));
    }
    room.scanned = true;
    room.data.snapshot = snapshotOf(game, id);
  }
  game.makeNoise(here3, PULSE_NOISE);
  game.log.add(t("log.pulse"), game.schedule.time, "warn", "log.pulse");
  for (const room of found) {
    game.log.add(t("log.relic.seen", { room }), game.schedule.time, "warn", "log.relic.seen");
  }
  return DONE3();
}
function snapshotOf(game, room) {
  const machines = game.entities.filter((e) => e.room === room && e.id !== game.player.id && isAlive(e));
  return [...machines.map((m) => m.ch), ...wrecksIn(game, room).map((w) => w.glyph)].join(" ");
}
function discharge(game, slot, turns) {
  if ((slot.charges ?? 0) <= 0) return FAIL3(t("why.emp.spent", { emp: moduleName(slot.kind) }));
  const targets = hostilesIn(game, game.roomOf(game.player).id);
  if (targets.length === 0) return FAIL3(t("why.emp.none"));
  for (const m of targets) applyStatus(m, "stun", turns);
  slot.charges = (slot.charges ?? 0) - 1;
  game.makeNoise(game.roomOf(game.player).id, EMP_NOISE);
  let key3;
  if (slot.kind === "shocker") key3 = "log.shock";
  else key3 = "log.emp";
  game.log.add(
    t(key3, { module: moduleName(slot.kind), n: targets.length, left: slot.charges }),
    game.schedule.time,
    "good",
    key3
  );
  return DONE3();
}
function weld(game, rig, self) {
  const mend = repair(rig, self);
  if (!mend) {
    const relic = rig.slots.find((s) => s && isRelic(s.kind) && s.integrity < capOf(s));
    if (relic) return FAIL3(t("why.relic.noRepair", { module: moduleName(relic.kind) }));
    return FAIL3(t("why.repair.none"));
  }
  game.makeNoise(game.roomOf(game.player).id, WELD_NOISE);
  game.log.add(
    t("log.weld", { module: moduleName(mend.kind), left: mend.integrity, max: mend.max }),
    game.schedule.time,
    "good",
    "log.weld"
  );
  return DONE3();
}
var RIG = {
  name: "rig",
  onRunStart(game) {
    game.player.data = { ...game.player.data ?? {}, rig: makeStartingRig(), hints: {} };
    applyDerived(game.player);
    game.refreshSight();
  },
  onDeath(game, victim) {
    if (victim.id === game.player.id || victim.room === void 0) return;
    const kind = machineByName(victim.name)?.salvage;
    if (!kind) return;
    addWreck(game, victim.room, kind, game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]));
    game.log.add(
      t("log.scrap.drop", { machine: machineName(victim.name), module: moduleName(kind) }),
      game.schedule.time,
      "plain",
      "log.scrap.drop"
    );
  },
  afterPlayerTurn(game, cmd) {
    const rig = rigOf(game.player);
    if (!rig) return;
    expose(game, rig, cmd);
    muffle(game, rig);
    if (wrecksIn(game, game.roomOf(game.player).id).length > 0) hint(game, "scrap");
    if (findSlot(rig, "scanner") === null) hint(game, "blind");
  },
  onDamage(game, victim, amount, source) {
    if (victim.id !== game.player.id) return amount;
    if (vetoed(game, source)) return 0;
    const rig = rigOf(game.player);
    if (!rig) return amount;
    const route = routeDamage(rig, amount, source?.tags ?? []);
    const cause = source === void 0 ? BLOW_CAUSE : void 0;
    const who = capitalize(source ? entityLabel(game, source) : t("label.something"));
    let burned2 = false;
    for (const hit of route.hits) {
      const kind = moduleKind(hit.kind);
      const slot = rig.slots[hit.slot];
      const max = slot && slot.kind === hit.kind ? capOf(slot) : kind.integrity;
      const line2 = cause === void 0 ? hitLine(who, kind, hit.remaining, max) : t(cause, { module: moduleName(kind.id), left: hit.remaining, max });
      game.log.add(line2, game.schedule.time, "bad", cause ?? "log.hit.module");
      if (hit.burned) {
        game.log.add(moduleBurnLine(kind.id), game.schedule.time, "bad", "log.module.burn");
        burned2 = true;
      }
    }
    if (burned2) applyDerived(game.player);
    if (route.hits.length > 0) hint(game, "exposure");
    if (burned2) hint(game, "burned");
    return route.toCore;
  },
  panelLines(game) {
    const player = game.player;
    const lines = [{ text: t("panel.core", { dots: dots(player.hp, player.hpMax) }), fg: coreColour(player) }];
    const rig = rigOf(player);
    if (!rig) return lines;
    for (let i = 0; i < rig.slots.length; i++) {
      const slot = rig.slots[i];
      if (!slot) {
        const burned2 = rig.scars[i] !== null;
        lines.push({
          text: `${i + 1} ${burned2 ? t("panel.slot.burned") : t("panel.slot.empty")}`,
          fg: burned2 ? PALETTE.burned : PALETTE.fgDim
        });
        continue;
      }
      const kind = moduleKind(slot.kind);
      const max = capOf(slot);
      const bars2 = "\u25AE".repeat(slot.integrity) + "\u25AF".repeat(max - slot.integrity);
      const exposed = rig.exposed === i;
      const named2 = kind.relic ? `${moduleName(kind.id)}${RELIC_MARK}` : moduleName(kind.id);
      const prefix = `${i + 1} ${named2.padEnd(10)}`;
      const suffix = `${"+".repeat(slot.bonus ?? 0)}${exposed ? "  \u25C0" : ""}`;
      const room = Math.max(0, PANEL_LINE_WIDTH - prefix.length - suffix.length);
      const shownBars = bars2.length > room ? bars2.slice(0, room) : bars2;
      lines.push({
        text: `${prefix}${shownBars}${suffix}`,
        fg: exposed ? PALETTE.accent : PALETTE.fg
      });
    }
    return lines;
  },
  /**
   * The verbs the engine leaves to the game. Three of them are the rig's:
   * `salvage` takes a wreck apart, `use` spends a module already in the rack,
   * `shoot` is the same shot on its own key. Anything else — and anyone but
   * the player — falls through to the next system.
   */
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act") return void 0;
    if ((cmd.verb === "use" || cmd.verb === "shoot") && jammed(game)) return FAIL3(t(JAMMED_KEY));
    switch (cmd.verb) {
      case "carry":
        return carryWreck(game, cmd.target);
      case "salvage":
        return salvage(game, cmd.target);
      case "swap":
        return swapFor(game, cmd.target, cmd.slot);
      case "use":
        return useModule(game, cmd);
      case "shoot": {
        const rig = rigOf(game.player);
        const slot = rig ? findSlot(rig, "emitter") : null;
        if (!rig || slot === null) return FAIL3(t("why.module.missing", { module: moduleName("emitter") }));
        return shoot(game, rig.slots[slot]);
      }
      default:
        return void 0;
    }
  },
  /**
   * What can be done in this compartment, numbered — and the only way the UI
   * and the bots ever learn about the rig's verbs. Order is design-doc.md's:
   * attacks first, then what lies in the room.
   *
   * An offer that says `enabled` is one `playerCommand` accepts; a disabled one
   * is refused without costing a turn. Nothing else may be true of this list,
   * because a player reading a number and a bot picking one must get the same
   * game.
   */
  offerActions(game) {
    const offers = [];
    const rig = rigOf(game.player);
    if (!rig || game.status !== "playing") return offers;
    const here3 = game.roomOf(game.player).id;
    const foes = hostilesIn(game, here3);
    for (const m of foes) {
      offers.push({
        // The hit points are on the line because two of the same machine in
        // one compartment are otherwise two identical lines aimed at different
        // things (docs/tasks/G55-playtest-findings.md, 11).
        label: t("action.attack", { target: machineName(m.name), hp: m.hp, max: m.hpMax }),
        cmd: { kind: "attack", target: m.id },
        enabled: true
      });
    }
    if (findSlot(rig, "emitter") !== null) {
      const target = shootTarget(game);
      if (target) {
        offers.push({
          label: t("action.shoot", { target: machineName(target.name) }),
          cmd: { kind: "act", verb: "shoot" },
          enabled: true
        });
      }
    }
    if (foes.length > 0) {
      for (let i = 0; i < rig.slots.length; i++) {
        const slot = rig.slots[i];
        if (!slot || !isRelic(slot.kind) || moduleKind(slot.kind).active === void 0) continue;
        const spent = (slot.charges ?? 0) <= 0;
        const blocked = jammed(game);
        const offer3 = {
          label: t("action.discharge", { module: moduleName(slot.kind), n: slot.charges ?? 0 }),
          cmd: { kind: "act", verb: "use", slot: i },
          enabled: !spent && !blocked
        };
        if (blocked) offer3.why = t(JAMMED_KEY);
        else if (spent) offer3.why = t("why.emp.spent", { emp: moduleName(slot.kind) });
        offers.push(offer3);
      }
    }
    const carrying = carriedBy(game.player).length;
    for (const w of wrecksIn(game, here3)) {
      const kind = moduleKind(w.kind);
      const take2 = takeFor(rig, w.kind);
      if (take2.kind === "swap") {
        for (const i of swapSlots(rig, w.kind)) {
          offers.push({
            label: t("action.swap", { module: moduleName(kind.id), old: moduleName(rig.slots[i].kind) }),
            cmd: { kind: "act", verb: "swap", target: w.id, slot: i },
            enabled: true
          });
        }
        continue;
      }
      const offer3 = {
        label: t("action.salvage", { module: moduleName(kind.id), left: w.integrity, max: kind.integrity }),
        cmd: { kind: "act", verb: "salvage", target: w.id },
        enabled: take2.kind !== "no"
      };
      if (take2.kind === "no") offer3.why = take2.why;
      offers.push(offer3);
      if (take2.kind !== "no") continue;
      const full = carrying >= CARRY_LIMIT;
      const carryOffer = {
        label: t("action.carry", { module: moduleName(kind.id), left: w.integrity, max: kind.integrity }),
        cmd: { kind: "act", verb: "carry", target: w.id },
        enabled: !full
      };
      if (full) carryOffer.why = t("why.carry.full", { n: CARRY_LIMIT });
      offers.push(carryOffer);
    }
    if (game.roomOf(game.player).cover && foes.length === 0) {
      offers.push({ label: t("action.hide"), cmd: { kind: "hide" }, enabled: true });
    }
    return offers;
  }
};
function muffle(game, rig) {
  const penalty = derivedStats(rig).noisePenalty;
  if (penalty <= 0) return;
  const quiet = /* @__PURE__ */ new Map();
  for (const [room, strength] of game.noise) {
    const left = strength - penalty;
    if (left > 0) quiet.set(room, left);
  }
  game.noise = quiet;
}
function hostilesIn(game, room) {
  return game.entities.filter(
    (e) => e.room === room && e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e)
  );
}
function coreColour(player) {
  return player.hp <= 1 ? PALETTE.hpLow : PALETTE.fg;
}
function dots(hp, max) {
  return "\u25CF".repeat(Math.max(0, hp)) + "\u25CB".repeat(Math.max(0, max - hp));
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ../../../smoreg_works/games/salvor/src/content/player.ts
function makePlayer(hull3 = STARTING_HULL) {
  const drone = makeEntity({
    name: "drone",
    ch: "@",
    fg: "#f0e6d2",
    pos: { x: 0, y: 0 },
    faction: 0 /* Player */,
    hp: hull3.core,
    hpMax: hull3.core,
    damage: [1, 1, 0],
    defense: 0,
    speed: 100,
    fovRadius: 0,
    sight: 0,
    tags: []
  });
  drone.data = { ...drone.data ?? {}, rig: makeStartingRig(hull3.slots) };
  applyDerived(drone);
  return drone;
}

// ../../../smoreg_works/games/salvor/src/content/tug.ts
var TUG_ID = "tug";
var TUG_ROOMS = ["DOCK", "HOLD", "BENCH", "HELM"];
var TUG_KINDS = TUG_ROOMS.map(
  (name) => name.toLowerCase()
);
function tugShip() {
  const rooms = TUG_ROOMS.map((name, i) => ({
    id: i,
    label: `r${i + 1}`,
    kind: name.toLowerCase(),
    name,
    depth: i,
    col: i,
    row: 0,
    cover: false,
    hazard: "none",
    // Your own ship: nothing aboard it was ever unknown.
    explored: true,
    scanned: true,
    marks: [],
    data: {}
  }));
  const doors = [{ id: 0, label: "a1", a: 0, b: 0, state: "airlock" }];
  for (let i = 1; i < rooms.length; i++) {
    doors.push({ id: doors.length, label: `t${i}`, a: i - 1, b: i, state: "open" });
  }
  const ship = new Ship(rooms, doors, 0);
  layoutShip(ship);
  return ship;
}
function isTug(game) {
  return game.shipId === TUG_ID;
}

// ../../../smoreg_works/games/salvor/src/content/objectives.ts
var SYSTEM_GLYPH = "+";
var ADVANCE = 15;
function carries2(rig, tool) {
  return rig !== void 0 && rig.slots.some((s) => s?.kind === tool);
}
function firstAffordable(jobs, rig, keys) {
  return jobs.find((job) => job.tool === "key" ? keys > 0 : carries2(rig, job.tool));
}
function spec(s) {
  return { ...s, advance: ADVANCE, needs: (rig, keys) => firstAffordable(s.jobs, rig, keys) };
}
var ENGINE = spec({
  id: "engine",
  mark: "E",
  kind: "engineering",
  name: "ENGINE",
  short: "engine",
  jobs: [
    { tool: "cutter", turns: 3, noise: 8 },
    { tool: "welder", turns: 3, noise: 8 }
  ]
});
var CORE = spec({
  id: "core",
  mark: "O",
  kind: "reactor",
  // Named after its compartment, because `CORE` is also the drone's own last
  // line of armour on the same panel and one word cannot be two things
  // (docs/tasks/G87-playability.md, 3).
  name: "REACTOR",
  short: "reac",
  jobs: [{ tool: "cell", turns: 2, noise: 6 }]
});
var TERMINAL = spec({
  id: "terminal",
  mark: "T",
  kind: "control",
  name: "TERMINAL",
  short: "term",
  jobs: [
    { tool: "spike", turns: 2, noise: 4 },
    { tool: "key", turns: 1, noise: 0 }
  ]
});
var OBJECTIVES = [ENGINE, CORE, TERMINAL];
var OBJECTIVE_COUNT = OBJECTIVES.length;
function objectiveSpec(id) {
  return OBJECTIVES.find((o) => o.id === id);
}
function toolName(tool) {
  return tool === "key" ? t("word.keycard") : moduleName(tool);
}
function objectiveName(o) {
  return tId("system", o.id, o.name);
}
function objectiveOnlineLine(o) {
  return tId("log.system.online", o.id, o.name);
}
function toolExposes(tool) {
  return tool === "key" ? "plating" : tool;
}
function needsLine(o) {
  const names = o.jobs.map((job) => t("word.a", { name: toolName(job.tool) }));
  const last = names[names.length - 1];
  const wanted2 = names.length === 1 ? last : t("word.or", { first: names.slice(0, -1).join(", "), last });
  return t("why.system.needs", { tools: wanted2 });
}

// ../../../smoreg_works/games/salvor/src/systems/sight.ts
function canSeeDrone(game, machine) {
  if (!isAlive(machine) || machine.room === void 0) return false;
  return canSee2(game.ship, baffled(game) ? blinkered(machine) : machine, game.player);
}
function baffled(game) {
  const rig = rigOf(game.player);
  return rig !== void 0 && derivedStats(rig).machineFovPenalty > 0;
}
function blinkered(machine) {
  return { ...machine, sight: 0, keen: false };
}

// ../../../smoreg_works/games/salvor/src/systems/alert.ts
var MAX_LEVEL = 5;
var PERIOD_FIRST_SHIP = 80;
var PERIOD = 40;
var NOISE_THRESHOLD = 8;
var NOISE_COOLDOWN = 10;
var DRONE_HEARD_AT = 5;
var QUIET_TURNS = 15;
var QUIET_TURNS_HIDDEN = 8;
var MIN_SPAWN_DOORS = 2;
var HUNTER_LEVEL = 4;
var HUNTER_PERIOD = 15;
var TRAIL_CHANCE = 0.5;
var DOOR_LEVEL = 3;
var DOOR_PERIOD = 10;
var LOCK_LEVEL = MAX_LEVEL;
var SCUTTLE_WARN = 15;
var SCUTTLE_PERIOD = 12;
var VENT_DAMAGE = 1;
var STRONGER_FROM = 4;
var LEAVE_DROP = 2;
var DEATH_DROP = 3;
var WARN_FG = PALETTE.warn;
var BAD_FG3 = PALETTE.bad;
var WARN_LEVEL = 3;
var VENTED = "vented";
var LADDER = {
  1: { word: "alert.noticed", posted: 0, sent: 0, hunter: 1 >= HUNTER_LEVEL },
  2: { word: "alert.searching", posted: 1, sent: 0, hunter: 2 >= HUNTER_LEVEL },
  3: { word: "alert.hunting", posted: 0, sent: 1, hunter: 3 >= HUNTER_LEVEL },
  4: { word: "alert.hunter", posted: 0, sent: 0, hunter: 4 >= HUNTER_LEVEL },
  5: { word: "alert.scuttle", posted: 0, sent: 0, hunter: 5 >= HUNTER_LEVEL }
};
function alertState(game) {
  const data = game.currentShip.data;
  const existing = data.alert;
  if (isState(existing)) return complete(existing);
  const fresh2 = freshState();
  data.alert = fresh2;
  return fresh2;
}
function isState(raw2) {
  if (typeof raw2 !== "object" || raw2 === null) return false;
  const s = raw2;
  return typeof s.level === "number" && typeof s.turnsAboard === "number" && typeof s.lastNoiseBump === "number" && typeof s.quietTurns === "number" && typeof s.lastHunter === "number" && typeof s.rolls === "number";
}
function complete(st) {
  const s = st;
  const fresh2 = freshState();
  if (typeof s.lastDoor !== "number") s.lastDoor = fresh2.lastDoor;
  if (typeof s.scuttleFrom !== "number") s.scuttleFrom = fresh2.scuttleFrom;
  if (typeof s.frozen !== "boolean") s.frozen = fresh2.frozen;
  if (typeof s.lostDrone !== "boolean") s.lostDrone = fresh2.lostDrone;
  if (typeof s.peaks !== "number") s.peaks = fresh2.peaks;
  if (typeof s.peakVisit !== "number") s.peakVisit = fresh2.peakVisit;
  if (typeof s.vents !== "number") s.vents = fresh2.vents;
  if (typeof s.ventSorties !== "number") s.ventSorties = fresh2.ventSorties;
  if (typeof s.ventVisit !== "number") s.ventVisit = fresh2.ventVisit;
  if (typeof s.ventDeaths !== "number") s.ventDeaths = fresh2.ventDeaths;
  return s;
}
function freshState() {
  return {
    level: 0,
    turnsAboard: 0,
    lastNoiseBump: -NOISE_COOLDOWN,
    quietTurns: 0,
    lastHunter: -HUNTER_PERIOD,
    rolls: 0,
    lastDoor: 0,
    scuttleFrom: -1,
    frozen: false,
    lostDrone: false,
    peaks: 0,
    peakVisit: 0,
    vents: 0,
    ventSorties: 0,
    ventVisit: 0,
    ventDeaths: 0
  };
}
function alertRng(game) {
  const st = alertState(game);
  return new Rng(game.currentShip.scheduleSeed).fork(st.rolls++);
}
function raiseAlert(game, steps = 1) {
  const st = alertState(game);
  if (neutralised(game, st)) return;
  for (let i = 0; i < steps; i++) {
    st.quietTurns = 0;
    if (st.level >= MAX_LEVEL) continue;
    st.level++;
    climb(game, st, st.level);
  }
}
function climb(game, st, level) {
  const rung = LADDER[level];
  if (!rung) return;
  game.log.add(
    t("log.alert.up", { stage: t(rung.word) }),
    game.schedule.time,
    level >= WARN_LEVEL ? "bad" : "warn",
    "log.alert.up"
  );
  if (level === DOOR_LEVEL) st.lastDoor = st.turnsAboard;
  if (level === MAX_LEVEL) {
    st.scuttleFrom = st.turnsAboard;
    const visit = game.currentShip.visits;
    if (st.peakVisit !== visit) {
      st.peakVisit = visit;
      st.peaks++;
    }
    game.log.add(t("log.alert.scuttle", { n: SCUTTLE_WARN }), game.schedule.time, "bad", "log.alert.scuttle");
  }
  if (rung.posted + rung.sent > 0 && !isFirstShip(game)) {
    const rng = alertRng(game);
    for (let i = 0; i < rung.posted; i++) wake(game, rng, level, false);
    for (let i = 0; i < rung.sent; i++) wake(game, rng, level, true);
  }
  if (rung.hunter && !hunterAboard(game) && !isTutorialHull(game)) sendEnforcer(game, level);
}
function wake(game, rng, level, sent) {
  const room = pickSpawnRoom(game, rng, false);
  if (room === void 0) return;
  const kind = pickKind2(rng, game.content.monstersForDepth(game.ship.roomAt(room).depth));
  if (!kind) return;
  const machine = spawnMonsterIn(kind, room);
  harden(machine, level);
  notePost(machine);
  if (sent) rememberRoom(machine, game.roomOf(game.player).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  game.log.add(
    t("log.alert.wake", { room: roomName(game.ship.roomAt(room)) }),
    game.schedule.time,
    "bad",
    "log.alert.wake"
  );
}
function harden(machine, level) {
  const bonus = Math.max(0, level - STRONGER_FROM + 1);
  machine.hp += bonus;
  machine.hpMax += bonus;
}
function hunterAboard(game) {
  return game.entities.some((e) => isAlive(e) && e.name === ENFORCER.name);
}
function sendEnforcer(game, level) {
  const room = pickSpawnRoom(game, alertRng(game), ENFORCER.breacher === true);
  if (room === void 0) return;
  const hunter3 = dispatchTo(game, ENFORCER, room);
  harden(hunter3, level);
  alertState(game).lastHunter = alertState(game).turnsAboard;
  game.log.add(
    t("log.alert.hunter", {
      hunter: machineName(ENFORCER.name).toUpperCase(),
      room: roomName(game.ship.roomAt(room))
    }),
    game.schedule.time,
    "bad",
    "log.alert.hunter"
  );
}
function dispatchTo(game, kind, room) {
  const machine = spawnMonsterIn(kind, room);
  notePost(machine);
  rememberRoom(machine, game.roomOf(game.player).id);
  game.schedule.admit(machine);
  game.entities.push(machine);
  return machine;
}
function pickSpawnRoom(game, rng, breacher) {
  const rooms = roomsAtLeast(game.ship, game.roomOf(game.player).id, MIN_SPAWN_DOORS, breacher).filter(
    (r) => !crowded(game, r)
  );
  if (rooms.length === 0) return void 0;
  const explored = rooms.filter((r) => game.ship.roomAt(r).explored);
  return rng.pick(explored.length > 0 ? explored : rooms);
}
function crowded(game, room) {
  return hostilesIn(game, room).length >= CROWD;
}
var POST = "post";
function stampPosts(game) {
  for (const e of game.entities) {
    if (e.id !== game.player.id && e.faction !== game.player.faction) notePost(e);
  }
}
function notePost(machine) {
  (machine.data ??= {})[POST] = machine.room;
}
function holdAtTheDoor(game, actor) {
  const was = actor.data?.[POST];
  const now = actor.room;
  if (typeof was === "number" && now !== void 0 && was !== now && isAlive(actor)) {
    if (hostilesIn(game, now).length > CROWD) actor.room = was;
  }
  notePost(actor);
}
function roomsAtLeast(ship, from, doors, breacher) {
  const map = RoomDistance.from(ship, [from], walkFilter(ship, breacher));
  return ship.rooms.filter((r) => Number.isFinite(map.at(r.id)) && map.at(r.id) >= doors).map((r) => r.id);
}
function walkFilter(ship, breacher) {
  return (d) => ship.passable(d, { breacher });
}
function pickKind2(rng, kinds) {
  if (kinds.length === 0) return void 0;
  const table = {};
  for (const k of kinds) table[k.id] = k.weight;
  const id = rng.weighted(table);
  return kinds.find((k) => k.id === id);
}
function loudAnywhere(game) {
  for (const strength of game.noise.values()) {
    if (strength >= NOISE_THRESHOLD) return true;
  }
  return false;
}
function quietTurn(game) {
  const here3 = game.roomOf(game.player).id;
  if ((game.noise.get(here3) ?? 0) >= DRONE_HEARD_AT) return false;
  return !game.entities.some(
    (e) => e.id !== game.player.id && e.faction !== game.player.faction && canSeeDrone(game, e)
  );
}
function pointEveryoneAtTheDrone(game) {
  const here3 = game.roomOf(game.player).id;
  for (const e of game.entities) {
    if (e.id === game.player.id || !isAlive(e) || e.faction === game.player.faction) continue;
    rememberRoom(e, here3);
  }
}
function shutADoor(game, st) {
  const ship = game.ship;
  const here3 = game.roomOf(game.player).id;
  const lock = st.level >= LOCK_LEVEL;
  if (lock && !bareWayHome(ship, here3)) return;
  const candidates = ship.doors.filter(
    (d) => d.a !== d.b && d.a !== here3 && d.b !== here3 && (d.state === "open" || lock && d.state === "closed")
  );
  if (candidates.length === 0) return;
  const rng = alertRng(game);
  for (const door of rng.shuffle([...candidates])) {
    if (lock && !lockable(ship, door, here3)) continue;
    door.state = lock ? "locked" : "closed";
    st.lastDoor = st.turnsAboard;
    game.log.add(
      t(lock ? "log.alert.lock" : "log.alert.door", { door: door.label }),
      game.schedule.time,
      "bad",
      lock ? "log.alert.lock" : "log.alert.door"
    );
    return;
  }
}
function lockable(ship, door, here3) {
  const was = door.state;
  door.state = "locked";
  const still = bareWayHome(ship, here3);
  door.state = was;
  return still;
}
function bareWayHome(ship, here3) {
  const map = RoomDistance.from(ship, [ship.entry], (d) => ship.passable(d, {}));
  return Number.isFinite(map.at(here3));
}
function vent(game, st) {
  const ship = game.ship;
  const here3 = game.roomOf(game.player).id;
  const map = RoomDistance.from(ship, [here3], walkFilter(ship, true));
  const candidates = ship.rooms.filter(
    (r) => r.id !== here3 && r.id !== ship.entry && r.explored && r.hazard !== VENTED && Number.isFinite(map.at(r.id)) && map.at(r.id) >= MIN_SPAWN_DOORS
  );
  if (candidates.length === 0) return;
  const farthest = Math.max(...candidates.map((r) => map.at(r.id)));
  const pool = candidates.filter((r) => map.at(r.id) === farthest);
  const room = pool.length === 1 ? pool[0] : alertRng(game).pick(pool);
  blowOut(game, room);
  st.vents++;
  const visit = game.currentShip.visits;
  if (st.ventVisit !== visit) {
    st.ventVisit = visit;
    st.ventSorties++;
  }
  game.log.add(t("log.alert.vent", { room: roomName(room) }), game.schedule.time, "bad", "log.alert.vent");
}
function blowOut(game, room) {
  room.hazard = VENTED;
  room.cover = false;
  for (const e of [...game.entities]) {
    if (e.id === game.player.id || e.room !== room.id || !isAlive(e)) continue;
    e.hp = 0;
    e.alive = false;
    game.onDeath(e);
  }
  game.reapDead();
  const data = room.data;
  if (Array.isArray(data.wrecks)) data.wrecks.length = 0;
  if (Array.isArray(data.crates)) data.crates.length = 0;
}
function bleed(game) {
  const room = game.roomOf(game.player);
  if (room.hazard !== VENTED) return false;
  const res = blamedOn("log.hit.vent", () => dealDamage(game, game.player, VENT_DAMAGE));
  if (res.toHp > 0) {
    game.log.add(
      t("log.alert.vacuum", { room: roomName(room), n: res.toHp }),
      game.schedule.time,
      "bad",
      "log.alert.vacuum"
    );
  }
  if (isAlive(game.player)) return false;
  game.onDeath(game.player);
  return true;
}
function scuttleCountdown(st) {
  const elapsed = st.turnsAboard - st.scuttleFrom;
  if (elapsed < SCUTTLE_WARN) return SCUTTLE_WARN - elapsed;
  const since = (elapsed - SCUTTLE_WARN) % SCUTTLE_PERIOD;
  return since === 0 ? SCUTTLE_PERIOD : SCUTTLE_PERIOD - since;
}
function scuttleDue(st) {
  const elapsed = st.turnsAboard - st.scuttleFrom;
  return elapsed >= SCUTTLE_WARN && (elapsed - SCUTTLE_WARN) % SCUTTLE_PERIOD === 0;
}
function standDown(game) {
  if (isTug(game)) return;
  const st = alertState(game);
  if (st.frozen) return;
  st.frozen = true;
  st.scuttleFrom = -1;
  game.log.add(t("log.alert.down"), game.schedule.time, "good", "log.alert.down");
}
function neutralised(game, st) {
  return st.frozen || onlineSystems(game) >= OBJECTIVE_COUNT;
}
function shipAnswers(game) {
  const st = alertState(game);
  if (neutralised(game, st)) return;
  const alarmed = st.level;
  st.level = Math.max(onlineSystems(game), alarmed - (st.lostDrone ? DEATH_DROP : LEAVE_DROP));
  st.lostDrone = false;
  st.quietTurns = 0;
  st.scuttleFrom = -1;
  const rng = alertRng(game);
  const entry = game.ship.entry;
  const rooms = roomsAtLeast(game.ship, entry, MIN_SPAWN_DOORS, false).filter(
    (r) => game.ship.roomAt(r).explored
  );
  if (rooms.length === 0) return;
  const walk3 = walkFilter(game.ship, false);
  const toEntry = RoomDistance.from(game.ship, [entry], walk3);
  const room = musterRoom(game);
  let placed = 0;
  for (let i = 0; i < Math.min(2 + 2 * alarmed, room); i++) {
    const open = rooms.filter((r) => !crowded(game, r));
    if (open.length === 0) break;
    const room2 = rng.pick(open);
    const kind = pickKind2(rng, game.content.monstersForDepth(game.ship.roomAt(room2).depth));
    if (!kind) continue;
    const machine = spawnMonsterIn(kind, room2);
    notePost(machine);
    game.schedule.admit(machine);
    game.entities.push(machine);
    placed++;
    leaveTrail(game.ship, toEntry, room2, rng, walk3);
  }
  if (placed > 0) {
    game.log.add(t("log.alert.busy", { n: placed }), game.schedule.time, "bad", "log.alert.busy");
  }
}
function musterRoom(game) {
  const complement = specOfShip(game.ship)?.machines[1] ?? MAX_MACHINES;
  const aboard2 = game.entities.filter(
    (e) => e.id !== game.player.id && isAlive(e) && e.faction !== game.player.faction
  ).length;
  return Math.max(0, complement - aboard2);
}
function leaveTrail(ship, toEntry, from, rng, walk3) {
  let at = from;
  for (let guard = 0; guard < ship.size; guard++) {
    if (at === ship.entry) return;
    const door = toEntry.nextDoor(at, walk3);
    if (!door) return;
    if (door.state === "closed" && rng.chance(TRAIL_CHANCE)) door.state = "open";
    at = ship.other(door, at);
  }
}
function onlineSystems(game) {
  const raw2 = game.currentShip.data.ship;
  if (typeof raw2 !== "object" || raw2 === null) return 0;
  const online = raw2.online;
  return Array.isArray(online) ? online.length : 0;
}
var ALERT = {
  name: "alert",
  // Nothing is looking for the drone at home: the tug has no gauge, no
  // reinforcements and no hunter (design-doc.md, "Буксир").
  onLevelEnter(game) {
    if (isTug(game)) return;
    alertState(game);
    if (game.currentShip.visits > 1) shipAnswers(game);
    stampPosts(game);
  },
  /** A machine that walked into a full compartment did not get in (`holdAtTheDoor`). */
  afterActorTurn(game, actor) {
    if (isTug(game) || actor.id === game.player.id || actor.faction === game.player.faction) return;
    holdAtTheDoor(game, actor);
  },
  /**
   * A drone the ship took apart: remembered on the ship, so that the next entry
   * finds it two steps calmer rather than one (`shipAnswers`). Both ways a
   * drone dies aboard come through here — a machine's blow through the engine,
   * the vacuum through `bleed` — and both go on to `systems/voyage.ts`, which is
   * later in the list and moves the operator home.
   */
  onDeath(game, victim) {
    if (victim.id !== game.player.id || isTug(game)) return;
    const st = alertState(game);
    st.lostDrone = true;
    if (game.roomOf(victim).hazard === VENTED) st.ventDeaths++;
  },
  afterPlayerTurn(game) {
    if (game.status !== "playing" || isTug(game)) return;
    stampPosts(game);
    const st = alertState(game);
    st.turnsAboard++;
    if (bleed(game)) return;
    if (neutralised(game, st)) return;
    const period = isFirstShip(game) ? PERIOD_FIRST_SHIP : PERIOD;
    if (st.turnsAboard % period === 0) raiseAlert(game);
    if (loudAnywhere(game) && st.turnsAboard - st.lastNoiseBump >= NOISE_COOLDOWN) {
      st.lastNoiseBump = st.turnsAboard;
      raiseAlert(game);
    }
    if (st.level >= DOOR_LEVEL && st.turnsAboard - st.lastDoor >= DOOR_PERIOD) shutADoor(game, st);
    if (st.level >= MAX_LEVEL) {
      if (st.scuttleFrom >= 0 && scuttleDue(st)) vent(game, st);
      if (st.turnsAboard - st.lastHunter >= HUNTER_PERIOD) {
        st.lastHunter = st.turnsAboard;
        if (!hunterAboard(game) && !isTutorialHull(game)) sendEnforcer(game, st.level);
        pointEveryoneAtTheDrone(game);
      }
    }
    st.quietTurns = quietTurn(game) ? st.quietTurns + 1 : 0;
    const needed = game.player.hidden === true ? QUIET_TURNS_HIDDEN : QUIET_TURNS;
    if (st.level > 0 && st.quietTurns >= needed) {
      st.quietTurns = 0;
      st.level--;
      if (st.level < MAX_LEVEL) st.scuttleFrom = -1;
      game.log.add(t("log.alert.calm"), game.schedule.time, "good", "log.alert.calm");
    }
  },
  panelLines(game) {
    if (isTug(game)) return [];
    const st = alertState(game);
    const level = st.level;
    const gauge = "\u25AE".repeat(level) + "\u25AF".repeat(MAX_LEVEL - level);
    const off = neutralised(game, st);
    let text3;
    if (off) text3 = t("panel.alertOff", { gauge });
    else if (level >= MAX_LEVEL && st.scuttleFrom >= 0) {
      text3 = t("panel.alertScuttle", { gauge, n: scuttleCountdown(st) });
    } else if (level > 0) text3 = t("panel.alertStage", { gauge, stage: t(LADDER[level].word) });
    else text3 = t("panel.alert", { gauge });
    const fg = off ? void 0 : level >= MAX_LEVEL ? BAD_FG3 : level >= WARN_LEVEL ? WARN_FG : void 0;
    const lines = [fg ? { text: text3, fg } : { text: text3 }];
    if (hunterAboard(game)) lines.push({ text: t("panel.hunter"), fg: BAD_FG3 });
    return lines;
  }
};
function isFirstShip(game) {
  const ids = game.ships.ids().filter((id) => id !== TUG_ID);
  const at = ids.indexOf(game.shipId);
  return at === 0 || at === 1 && isTutorialHull(game, ids[0]);
}
function isTutorialHull(game, id = game.shipId) {
  const ship = game.ships.get(id)?.ship;
  return ship !== void 0 && classOfShip(ship) === TUTORIAL_ID;
}

// ../../../smoreg_works/games/salvor/src/systems/bloom.ts
var HATCH_PERIOD = 6;
var MAX_BROOD = 4;
var BIOMASS_CREDITS = 2;
var STRIP_NOISE = 2;
var FAIL4 = (reason) => ({ ok: false, cost: 0, reason });
var DONE4 = () => ({ ok: true, cost: TURN_COST });
function crowded2(game, room) {
  return game.entities.filter((e) => e.room === room && e.id !== game.player.id && isAlive(e)).length >= CROWD;
}
function brood(game, hatchery) {
  return game.entities.filter((e) => isAlive(e) && e.data?.hatchedBy === hatchery.id);
}
function hatch(game, hatchery, room) {
  const crawler = spawnMonsterIn(CRAWLER, room);
  (crawler.data ??= {}).hatchedBy = hatchery.id;
  notePost(crawler);
  game.schedule.admit(crawler);
  game.entities.push(crawler);
  if (game.visible.has(room)) {
    game.log.add(t("log.bloom.hatch"), game.schedule.time, "bad", "log.bloom.hatch");
  }
}
function itemsIn(room) {
  const data = room.data;
  const list = data.items ?? [];
  data.items = list;
  return list;
}
function biomassIn(room) {
  return itemsIn(room).filter((it) => it.kind === "biomass");
}
function addLoot(player, amount) {
  const data = player.data ??= {};
  data.loot = (typeof data.loot === "number" ? data.loot : 0) + amount;
}
function strip(game, target) {
  const room = game.roomOf(game.player);
  const items = itemsIn(room);
  const i = items.findIndex(
    (it) => it.kind === "biomass" && (target === void 0 || it.id === target)
  );
  if (i < 0) return FAIL4(t("why.biomass.none"));
  items.splice(i, 1);
  addLoot(game.player, BIOMASS_CREDITS);
  game.makeNoise(room.id, STRIP_NOISE);
  game.log.add(
    t("log.bloom.strip", { cr: BIOMASS_CREDITS }),
    game.schedule.time,
    "good",
    "log.bloom.strip"
  );
  return DONE4();
}
var BLOOM = {
  name: "bloom",
  /**
   * The hatchery's clock. Counted in the bloom's own turns and kept on the
   * bloom — `actor.data` rides the entity through a save and through a sortie
   * ashore, so a hatchery half-way to its next crawler is still half-way there
   * when the drone cycles back aboard.
   */
  afterActorTurn(game, actor) {
    if (actor.name !== BLOOM_KIND.name || !isAlive(actor) || actor.room === void 0) return;
    const data = actor.data ??= {};
    const turns = (typeof data.hatchTurns === "number" ? data.hatchTurns : 0) + 1;
    data.hatchTurns = turns;
    if (turns % HATCH_PERIOD !== 0) return;
    if (brood(game, actor).length >= MAX_BROOD || crowded2(game, actor.room)) return;
    hatch(game, actor, actor.room);
  },
  /**
   * A dead bloom leaves biomass and not scrap. The rig drops a module for every
   * machine whose bestiary row names one (`RIG.onDeath`), and neither of the
   * two biology rows does — so the compartment gets this instead, and the
   * player who cleared the nest gets paid for it.
   */
  onDeath(game, victim) {
    if (victim.name !== BLOOM_KIND.name || victim.room === void 0) return;
    itemsIn(game.ship.roomAt(victim.room)).push({ id: nextShipId(game), kind: "biomass" });
    game.log.add(t("log.bloom.dies"), game.schedule.time, "plain", "log.bloom.dies");
  },
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== "strip") return void 0;
    return strip(game, cmd.target);
  },
  offerActions(game) {
    const offers = [];
    if (game.status !== "playing") return offers;
    for (const it of biomassIn(game.roomOf(game.player))) {
      offers.push({
        label: t("action.strip", { cr: BIOMASS_CREDITS }),
        cmd: { kind: "act", verb: "strip", target: it.id },
        enabled: true
      });
    }
    return offers;
  }
};

// ../../../smoreg_works/games/salvor/src/content/codex.ts
function alertCodexId(level) {
  return `alert-${level}`;
}
var CODEX = {
  // ------------------------------------------------ the virus (content/viruses.ts)
  spasm: {
    id: "spasm",
    title: "codex.spasm.title",
    what: "codex.spasm.what",
    wrong: "codex.spasm.wrong",
    helps: "codex.spasm.helps",
    modules: ["welder"],
    lore: "codex.spasm.lore"
  },
  rot: {
    id: "rot",
    title: "codex.rot.title",
    what: "codex.rot.what",
    wrong: "codex.rot.wrong",
    helps: "codex.rot.helps",
    modules: ["welder"],
    turn: "codex.rot.turn",
    lore: "codex.rot.lore"
  },
  leech: {
    id: "leech",
    title: "codex.leech.title",
    what: "codex.leech.what",
    wrong: "codex.leech.wrong",
    helps: "codex.leech.helps",
    modules: ["welder"],
    lore: "codex.leech.lore"
  },
  leash: {
    id: "leash",
    title: "codex.leash.title",
    what: "codex.leash.what",
    wrong: "codex.leash.wrong",
    helps: "codex.leash.helps",
    modules: ["welder"],
    lore: "codex.leash.lore"
  },
  // ------------------------------------------- the ladder (systems/alert.ts)
  "alert-1": {
    id: "alert-1",
    title: "codex.alert-1.title",
    what: "codex.alert-1.what",
    wrong: "codex.alert-1.wrong",
    helps: "codex.alert-1.helps",
    modules: ["baffle"],
    lore: "codex.alert-1.lore"
  },
  "alert-2": {
    id: "alert-2",
    title: "codex.alert-2.title",
    what: "codex.alert-2.what",
    wrong: "codex.alert-2.wrong",
    helps: "codex.alert-2.helps",
    modules: ["scanner"],
    lore: "codex.alert-2.lore"
  },
  "alert-3": {
    id: "alert-3",
    title: "codex.alert-3.title",
    what: "codex.alert-3.what",
    wrong: "codex.alert-3.wrong",
    helps: "codex.alert-3.helps",
    modules: ["welder", "thrusters"],
    turn: "codex.alert-3.turn",
    lore: "codex.alert-3.lore"
  },
  "alert-4": {
    id: "alert-4",
    title: "codex.alert-4.title",
    what: "codex.alert-4.what",
    wrong: "codex.alert-4.wrong",
    helps: "codex.alert-4.helps",
    modules: ["cutter", "blade", "emp", "shocker"],
    turn: "codex.alert-4.turn",
    lore: "codex.alert-4.lore"
  },
  "alert-5": {
    id: "alert-5",
    title: "codex.alert-5.title",
    what: "codex.alert-5.what",
    wrong: "codex.alert-5.wrong",
    helps: "codex.alert-5.helps",
    modules: ["thrusters"],
    turn: "codex.alert-5.turn",
    lore: "codex.alert-5.lore"
  },
  vented: {
    id: "vented",
    title: "codex.vented.title",
    what: "codex.vented.what",
    wrong: "codex.vented.wrong",
    helps: "codex.vented.helps",
    modules: ["thrusters", "lattice"],
    lore: "codex.vented.lore"
  },
  // ------------------------------------------ the relics (content/modules.ts)
  blade: {
    id: "blade",
    title: "codex.blade.title",
    what: "codex.blade.what",
    wrong: "codex.blade.wrong",
    helps: "codex.blade.helps",
    modules: ["blade"],
    lore: "codex.blade.lore"
  },
  shocker: {
    id: "shocker",
    title: "codex.shocker.title",
    what: "codex.shocker.what",
    wrong: "codex.shocker.wrong",
    helps: "codex.shocker.helps",
    modules: ["shocker"],
    lore: "codex.shocker.lore"
  },
  lattice: {
    id: "lattice",
    title: "codex.lattice.title",
    what: "codex.lattice.what",
    wrong: "codex.lattice.wrong",
    helps: "codex.lattice.helps",
    modules: ["lattice"],
    lore: "codex.lattice.lore"
  },
  // --------------------------- the two drones that are not the ship's own
  ghost: {
    id: "ghost",
    title: "codex.ghost.title",
    what: "codex.ghost.what",
    wrong: "codex.ghost.wrong",
    helps: "codex.ghost.helps",
    turn: "codex.ghost.turn",
    lore: "codex.ghost.lore"
  },
  rival: {
    id: "rival",
    title: "codex.rival.title",
    what: "codex.rival.what",
    wrong: "codex.rival.wrong",
    helps: "codex.rival.helps",
    turn: "codex.rival.turn",
    lore: "codex.rival.lore"
  },
  // ---------------------------------------- the machines (content/monsters.ts)
  "sentry-turret": {
    id: "sentry-turret",
    title: "codex.sentry-turret.title",
    what: "codex.sentry-turret.what",
    wrong: "codex.sentry-turret.wrong",
    helps: "codex.sentry-turret.helps",
    modules: ["emp", "shocker"],
    lore: "codex.sentry-turret.lore"
  },
  jammer: {
    id: "jammer",
    title: "codex.jammer.title",
    what: "codex.jammer.what",
    wrong: "codex.jammer.wrong",
    helps: "codex.jammer.helps",
    modules: ["blade"],
    lore: "codex.jammer.lore"
  },
  bloom: {
    id: "bloom",
    title: "codex.bloom.title",
    what: "codex.bloom.what",
    wrong: "codex.bloom.wrong",
    helps: "codex.bloom.helps",
    turn: "codex.bloom.turn",
    lore: "codex.bloom.lore"
  },
  crawler: {
    id: "crawler",
    title: "codex.crawler.title",
    what: "codex.crawler.what",
    wrong: "codex.crawler.wrong",
    helps: "codex.crawler.helps",
    lore: "codex.crawler.lore"
  },
  scout: {
    id: "scout",
    title: "codex.scout.title",
    what: "codex.scout.what",
    wrong: "codex.scout.wrong",
    helps: "codex.scout.helps",
    modules: ["emitter"],
    lore: "codex.scout.lore"
  },
  // The three that kill most often (docs/problem-map-2026-09-11.md): the
  // alarm's hunter, the guard every hull carries, and the deep hulls' pack.
  // What they do is plain enough; what the player gets wrong is not.
  enforcer: {
    id: "enforcer",
    title: "codex.enforcer.title",
    what: "codex.enforcer.what",
    wrong: "codex.enforcer.wrong",
    helps: "codex.enforcer.helps",
    modules: ["cutter", "blade", "emp", "shocker"],
    lore: "codex.enforcer.lore"
  },
  "security-unit": {
    id: "security-unit",
    title: "codex.security-unit.title",
    what: "codex.security-unit.what",
    wrong: "codex.security-unit.wrong",
    helps: "codex.security-unit.helps",
    modules: ["cutter", "welder"],
    lore: "codex.security-unit.lore"
  },
  scrapper: {
    id: "scrapper",
    title: "codex.scrapper.title",
    what: "codex.scrapper.what",
    wrong: "codex.scrapper.wrong",
    helps: "codex.scrapper.helps",
    modules: ["emp"],
    lore: "codex.scrapper.lore"
  },
  // ------------------------------------------ the hazards (content/hazards.ts)
  //
  // Addressed by the hazard's own id, which is what the red line's key
  // carries (`log.hazard.tell.<id>`, `systems/hazards.ts`) — so `i` after a
  // red line opens the card for that very hazard. `modules` mirrors the row's
  // `counters`, written out so this file stays a table of nothing but keys.
  frost: {
    id: "frost",
    title: "codex.frost.title",
    what: "codex.frost.what",
    wrong: "codex.frost.wrong",
    helps: "codex.frost.helps",
    modules: ["cell", "thrusters"],
    lore: "codex.frost.lore"
  },
  smoke: {
    id: "smoke",
    title: "codex.smoke.title",
    what: "codex.smoke.what",
    wrong: "codex.smoke.wrong",
    helps: "codex.smoke.helps",
    modules: ["blade", "shocker", "cutter"],
    turn: "codex.smoke.turn",
    lore: "codex.smoke.lore"
  },
  mine: {
    id: "mine",
    title: "codex.mine.title",
    what: "codex.mine.what",
    wrong: "codex.mine.wrong",
    helps: "codex.mine.helps",
    modules: ["welder", "plating"],
    turn: "codex.mine.turn",
    lore: "codex.mine.lore"
  }
};
var CODEX_IDS = Object.keys(CODEX);
function codexFor(id) {
  if (id === void 0) return void 0;
  return Object.hasOwn(CODEX, id) ? CODEX[id] : void 0;
}

// ../../../smoreg_works/games/salvor/src/systems/ghost.ts
var MAX_GHOSTS = 2;
var GHOST_REINFORCE_HP = 2;
var GHOST_BASE_HP = 4;
var MIN_DOORS = 1;
var MAX_DOORS = 2;
var RAM = [1, 1, 0];
var ATTACK_MODULES = Object.keys(MODULES).filter(
  (id) => MODULES[id].attack !== void 0
);
var GHOST_ID = "ghost";
var GHOST_NAME = "ghost";
var GHOST_FG = "#b7ab97";
var SIGHTED_KEY = "log.ghost.sighted";
var DROP_KEY = "log.ghost.drop";
var HINT_FLAG = "ghost";
var GHOST_SALT = 26472;
function deathsOf(game) {
  const data = game.player.data;
  if (!data) return [];
  const voyage = data.voyage;
  if (isRecord(voyage)) {
    const states = voyage.state;
    if (Array.isArray(states)) {
      const here3 = states.find((s) => isRecord(s) && s.shipId === game.shipId);
      return isRecord(here3) ? deathList(here3.deaths, game) : [];
    }
    if (Array.isArray(voyage.deaths)) return deathList(voyage.deaths, game);
  }
  return deathList(data.deaths, game);
}
function deathList(raw2, game) {
  if (!Array.isArray(raw2)) return [];
  return raw2.filter(
    (d) => isDeath(d) && (d.shipId === void 0 || d.shipId === game.shipId)
  );
}
function isDeath(raw2) {
  if (!isRecord(raw2)) return false;
  return typeof raw2.room === "number" && isRecord(raw2.rig) && Array.isArray(raw2.rig.slots);
}
function isRecord(raw2) {
  return typeof raw2 === "object" && raw2 !== null;
}
function ghostKind(rig) {
  const modules = moduleCount(rig);
  return {
    id: GHOST_ID,
    name: GHOST_NAME,
    ch: "G",
    fg: GHOST_FG,
    hp: GHOST_BASE_HP + modules,
    damage: bestAttack(rig),
    defense: 0,
    speed: 100,
    fovRadius: 6,
    behaviour: "brute",
    sight: 1,
    minDepth: 0,
    maxDepth: 99,
    weight: 0
  };
}
function moduleCount(rig) {
  return rig.slots.filter((s) => s !== null).length;
}
function bestAttack(rig) {
  let best;
  for (const id of ATTACK_MODULES) {
    if (!rig.slots.some((s) => s?.kind === id)) continue;
    const attack2 = MODULES[id].attack;
    if (attack2 && (!best || expected(attack2) > expected(best))) best = attack2;
  }
  const pick2 = best ?? RAM;
  return [pick2[0], pick2[1], pick2[2]];
}
function expected(a) {
  return a[0] * (a[1] + 1) / 2 + a[2];
}
function isGhost(e) {
  return e.name === GHOST_NAME;
}
function ghostsAboard(game) {
  return game.entities.filter((e) => isGhost(e) && isAlive(e));
}
function ghostRigOf(e) {
  const raw2 = e.data?.ghostRig;
  return isRecord(raw2) && Array.isArray(raw2.slots) ? raw2 : void 0;
}
var GHOST2 = {
  name: "ghost",
  /**
   * Every sortie asks the ship what it did with its dead. A record it has
   * already answered is left alone, which is what makes coming back to a ship
   * that killed you twice cost two ghosts and not four.
   */
  onLevelEnter(game) {
    for (const death of deathsOf(game)) {
      if (death.ghostSpawned === true || !aboard(game, death.room)) continue;
      death.ghostSpawned = true;
      dropRig(game, death.room, death.rig, "drone");
      raise(game, death);
    }
  },
  /**
   * The one line the mechanic is owed, said the turn a ghost is first in view.
   *
   * Checked here rather than from the renderer because a hint is a rule of the
   * run: the flag lives on the player, so it survives the sortie and is not
   * said again on the ship after this one.
   */
  afterPlayerTurn(game) {
    const said2 = hints(game.player);
    if (said2[HINT_FLAG] === true) return;
    if (!ghostsAboard(game).some((g) => canSee2(game.ship, game.player, g))) return;
    said2[HINT_FLAG] = true;
    game.log.add(t(SIGHTED_KEY), game.schedule.time, "bad", SIGHTED_KEY);
  },
  /**
   * Killed, it drops the whole rack — every module it was wearing, not the one
   * piece of scrap a machine leaves. That is the deal the design makes with the
   * player: the rig you lost is recoverable, and what it costs is the fight.
   */
  onDeath(game, victim) {
    if (!isGhost(victim) || victim.room === void 0) return;
    const rig = ghostRigOf(victim);
    if (!rig) return;
    if (dropRig(game, victim.room, rig, "ghost") > 0) {
      game.log.add(t(DROP_KEY), game.schedule.time, "plain", DROP_KEY);
    }
  }
};
function raise(game, death) {
  const living = ghostsAboard(game);
  if (living.length >= MAX_GHOSTS) {
    const oldest = living[0];
    oldest.hp += GHOST_REINFORCE_HP;
    oldest.hpMax += GHOST_REINFORCE_HP;
    return;
  }
  const room = pickRoom(game, death.room);
  if (room === void 0) return;
  const ghost = spawnMonsterIn(ghostKind(death.rig), room);
  ghost.data = { ...ghost.data ?? {}, ghostRig: copyRig(death.rig) };
  notePost(ghost);
  game.schedule.admit(ghost);
  game.entities.push(ghost);
}
function pickRoom(game, from) {
  const walk3 = (d) => game.ship.passable(d, {});
  const map = RoomDistance.from(game.ship, [from], walk3);
  const band = game.ship.rooms.map((r) => r.id).filter((id) => map.at(id) >= MIN_DOORS && map.at(id) <= MAX_DOORS && !crowded3(game, id));
  if (band.length === 0) return crowded3(game, from) ? void 0 : from;
  const here3 = game.roomOf(game.player).id;
  const clear = band.filter((id) => id !== here3);
  return ghostRng(game).pick(clear.length > 0 ? clear : band);
}
function crowded3(game, room) {
  return game.entities.filter((e) => e.room === room && e.id !== game.player.id && isAlive(e)).length >= CROWD;
}
function dropRig(game, room, rig, source) {
  let dropped = 0;
  for (const slot of rig.slots) {
    if (!slot || !MODULES[slot.kind]) continue;
    const integrity = Math.max(1, Math.min(slot.integrity, capOf(slot)));
    const wreck = addWreck(game, room, slot.kind, integrity);
    wreck.source = source;
    if (slot.charges !== void 0) wreck.charges = slot.charges;
    dropped++;
  }
  return dropped;
}
function ghostRng(game) {
  const data = game.currentShip.data;
  const raw2 = data.ghostRolls;
  const rolls = typeof raw2 === "number" ? raw2 : 0;
  data.ghostRolls = rolls + 1;
  return new Rng(game.currentShip.scheduleSeed).fork(GHOST_SALT + rolls);
}
function aboard(game, room) {
  return Number.isInteger(room) && room >= 0 && room < game.ship.size;
}
function copyRig(rig) {
  return {
    slots: rig.slots.map((s) => s ? { ...s } : null),
    exposed: typeof rig.exposed === "number" ? rig.exposed : null,
    burnedCount: rig.burnedCount ?? 0,
    burned: [...rig.burned ?? []],
    scars: [...rig.scars ?? []]
  };
}
function hints(player) {
  const data = player.data ??= {};
  const existing = data.hints;
  if (existing) return existing;
  const fresh2 = {};
  data.hints = fresh2;
  return fresh2;
}

// ../../../smoreg_works/games/salvor/src/content/hazards.ts
var FROST_PENALTY = 20;
var FROST_FLOOR = 20;
var MINE_DAMAGE = 3;
var MINE_MACHINE_DAMAGE = 4;
var DEFUSE_TURNS = 2;
var DEFUSE_NOISE = 5;
var HEAT_NOISE = 3;
var MAX_HAZARDS_ABOARD = 6;
var HAZARDS = {
  /**
   * Ice on everything. Standing in it the THRUSTERS lose `FROST_PENALTY`, so a
   * fight in here is a fight the machines get extra turns in; walking through
   * costs nothing. One point of the CELL warms the compartment for the rest
   * of the sortie (`heat` in `systems/hazards.ts`).
   */
  frost: {
    id: "frost",
    level: 1,
    on: "room",
    glyph: "\u2744",
    counters: ["cell", "thrusters"],
    tell: "log.hazard.tell.frost",
    word: "word.hazard.frost"
  },
  /**
   * Smoke to the bulkheads. Nobody sees in or out — the drone's SCANNER
   * shows nothing past the door and no machine spots the drone through it, so
   * the EMITTER and the turret are both blind and the blade and the shocker
   * are not. It is also the best cover on the ship, so the room gets `cover`.
   */
  smoke: {
    id: "smoke",
    level: 1,
    on: "room",
    glyph: "\u2248",
    counters: ["blade", "shocker", "cutter"],
    tell: "log.hazard.tell.smoke",
    word: "word.hazard.smoke",
    opaque: true,
    cover: true
  },
  /**
   * A charge on the door. The first one through it — drone or machine — takes
   * the blast; for the drone that is `MINE_DAMAGE` into the module the step
   * exposed and one rung of the alert. The WELDER lifts it in `DEFUSE_TURNS`
   * (`systems/doors.ts`), and a machine walked into it first lifts it for you.
   */
  mine: {
    id: "mine",
    level: 2,
    on: "door",
    glyph: "^",
    counters: ["welder", "plating"],
    tell: "log.hazard.tell.mine",
    word: "word.hazard.mine"
  }
};
var HAZARD_IDS = Object.keys(HAZARDS);
function isHazardId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(HAZARDS, id);
}
function hazardKind(id) {
  return isHazardId(id) ? HAZARDS[id] : void 0;
}

// ../../../smoreg_works/games/salvor/src/content/words.ts
function verbWord(verb2) {
  return tId("verb", verb2, verb2);
}
function doorStateWord(state) {
  return tId("state", state, state);
}

// ../../../smoreg_works/games/salvor/src/systems/hazardstate.ts
var POCKET = "hazards";
function hazardRecords(game) {
  return hazardsOf(game.currentShip.data);
}
function hazardsOf(data) {
  const raw2 = data[POCKET];
  if (!Array.isArray(raw2)) return [];
  return raw2.filter(isRecord2);
}
function hazardStore(game) {
  const data = game.currentShip.data;
  const raw2 = data[POCKET];
  if (Array.isArray(raw2)) {
    const clean2 = raw2.filter(isRecord2);
    if (clean2.length !== raw2.length) raw2.splice(0, raw2.length, ...clean2);
    return raw2;
  }
  const fresh2 = [];
  data[POCKET] = fresh2;
  return fresh2;
}
function isRecord2(raw2) {
  if (typeof raw2 !== "object" || raw2 === null) return false;
  const r = raw2;
  if (!isHazardId(r.id) || typeof r.known !== "boolean") return false;
  return typeof r.room === "number" || typeof r.door === "number";
}
function roomHazard(ship, records, room) {
  const rec = records.find((r) => r.room === room);
  return rec !== void 0 && ship.roomAt(room).hazard === rec.id ? rec : void 0;
}
function doorHazard(ship, records, door) {
  const rec = records.find((r) => r.door === door);
  return rec !== void 0 && ship.doorAt(door).trap === rec.id ? rec : void 0;
}
function hazardKnown(ship, rec) {
  if (rec.known) return true;
  if (rec.room !== void 0) return ship.roomAt(rec.room).scanned;
  if (rec.door !== void 0) {
    const door = ship.doorAt(rec.door);
    return ship.roomAt(door.a).scanned || ship.roomAt(door.b).scanned;
  }
  return false;
}
function markHazard(ship, rec) {
  const kind = hazardKind(rec.id);
  if (!kind) return;
  if (rec.room !== void 0) {
    const room = ship.roomAt(rec.room);
    room.hazard = rec.id;
    if (kind.opaque) room.opaque = true;
    if (kind.cover) room.cover = true;
  }
  if (rec.door !== void 0) ship.doorAt(rec.door).trap = rec.id;
}
function removeHazard(game, rec) {
  const store = hazardStore(game);
  const at = store.indexOf(rec);
  if (at >= 0) store.splice(at, 1);
  if (rec.room !== void 0) {
    const room = game.ship.roomAt(rec.room);
    if (room.hazard === rec.id) room.hazard = "none";
    delete room.opaque;
  }
  if (rec.door !== void 0) {
    const door = game.ship.doorAt(rec.door);
    if (door.trap === rec.id) delete door.trap;
  }
}
function signsFresh(game) {
  const visits = game.currentShip.visits;
  const now = game.inputs.length;
  return hazardRecords(game).filter((r) => r.told === visits && r.toldAfter === now);
}
function threatAboard(records) {
  return records.reduce((sum, r) => sum + (hazardKind(r.id)?.level ?? 0), 0);
}

// ../../../smoreg_works/games/salvor/src/systems/hazards.ts
var HEAT = "heat";
var HEAT_COST = 1;
var LAST_ROOM = "hazardRoom";
var FAIL5 = (reason) => ({ ok: false, cost: 0, reason });
var DONE5 = () => ({ ok: true, cost: TURN_COST });
function placeHazards(game, spec2) {
  const placed = [];
  const pool = spec2?.hazards ?? [];
  const threat3 = spec2?.threat ?? 0;
  if (pool.length === 0 || threat3 <= 0 || isFirstShip(game)) return placed;
  const store = hazardStore(game);
  let spent = threatAboard(store);
  for (let guard = 0; guard < MAX_HAZARDS_ABOARD; guard++) {
    const id = game.rng.pick(pool);
    const kind = HAZARDS[id];
    if (spent + kind.level > threat3) break;
    const rec = kind.on === "door" ? placeOnDoor(game, store, id) : kind.on === "room" ? placeInRoom(game, store, id) : void 0;
    if (!rec) break;
    store.push(rec);
    markHazard(game.ship, rec);
    placed.push(rec);
    spent += kind.level;
  }
  return placed;
}
function placeInRoom(game, store, id) {
  const entry = game.ship.entry;
  const rooms = game.ship.rooms.filter(
    (r) => r.id !== entry && r.hazard === "none" && !store.some((h) => h.room === r.id)
  );
  if (rooms.length === 0) return void 0;
  return { id, room: game.rng.pick(rooms).id, known: false };
}
function placeOnDoor(game, store, id) {
  const entry = game.ship.entry;
  const doors = game.ship.doors.filter(
    (d) => d.a !== d.b && d.state !== "airlock" && d.state !== "sealed" && d.trap === void 0 && d.a !== entry && d.b !== entry && !store.some((h) => h.door === d.id)
  );
  if (doors.length === 0) return void 0;
  return { id, door: game.rng.pick(doors).id, known: false };
}
function hazardLine(game, rec, here3, via) {
  const ship = game.ship;
  const kind = hazardKind(rec.id);
  if (!kind) return void 0;
  if (rec.door !== void 0) {
    const door2 = ship.doorAt(rec.door);
    if (door2.a !== here3 && door2.b !== here3) return void 0;
    return t(kind.tell, { door: door2.label, room: roomName(ship.roomAt(ship.other(door2, here3))) });
  }
  if (rec.room === void 0 || rec.room === here3) return void 0;
  const door = via ?? ship.doorsOf(here3).filter((d) => ship.other(d, here3) === rec.room).sort((a, b) => a.id - b.id)[0];
  if (!door) return void 0;
  return t(kind.tell, { door: door.label, room: roomName(ship.roomAt(rec.room)) });
}
function live(game, rec) {
  const records = hazardRecords(game);
  if (rec.room !== void 0) return roomHazard(game.ship, records, rec.room) === rec;
  if (rec.door !== void 0) return doorHazard(game.ship, records, rec.door) === rec;
  return false;
}
function tell(game) {
  const here3 = game.roomOf(game.player).id;
  const visits = game.currentShip.visits;
  for (const rec of hazardRecords(game)) {
    if (rec.told === visits || !live(game, rec)) continue;
    if (rec.room === here3) {
      rec.known = true;
      rec.told = visits;
      continue;
    }
    const line2 = hazardLine(game, rec, here3);
    if (line2 === void 0) continue;
    rec.known = true;
    rec.told = visits;
    rec.toldAfter = game.inputs.length;
    game.log.add(line2, game.schedule.time, "alarm", hazardKind(rec.id).tell);
  }
}
function signThisTurn(game) {
  const visits = game.currentShip.visits;
  for (const rec of hazardRecords(game)) {
    if (rec.told === visits && rec.toldAfter === game.inputs.length) return rec.id;
  }
  return void 0;
}
function chill(game) {
  const rig = rigOf(game.player);
  if (!rig || isTug(game)) return;
  const base = derivedStats(rig).speed;
  const rec = roomHazard(game.ship, hazardRecords(game), game.roomOf(game.player).id);
  const frozen = rec?.id === "frost" && rec.heated !== game.currentShip.visits;
  game.player.speed = frozen ? Math.max(FROST_FLOOR, base - FROST_PENALTY) : base;
}
function tripMine(game, rec, door, victim) {
  removeHazard(game, rec);
  if (victim.id === game.player.id) {
    game.log.add(t("log.hazard.mine.hit", { door: door.label }), game.schedule.time, "bad", "log.hazard.mine.hit");
    blamedOn("log.hit.mine", () => dealDamage(game, game.player, MINE_DAMAGE));
    raiseAlert(game, 1);
    if (isAlive(game.player)) return false;
    game.onDeath(game.player);
    return true;
  }
  if (victim.room !== void 0 && game.visible.has(victim.room)) {
    game.log.add(
      t("log.hazard.mine.machine", { machine: capitalize(machineName(victim.name)), door: door.label }),
      game.schedule.time,
      "warn",
      "log.hazard.mine.machine"
    );
  }
  if (dealDamage(game, victim, MINE_MACHINE_DAMAGE).killed) game.onDeath(victim);
  return false;
}
function crossed(game, from, to) {
  return game.ship.doorsOf(from).filter((d) => game.ship.other(d, from) === to && game.ship.passable(d, {})).sort((a, b) => a.id - b.id)[0];
}
function watchMachines(game) {
  for (const e of game.entities) {
    if (e.id === game.player.id) continue;
    (e.data ??= {})[LAST_ROOM] = e.room;
  }
}
function heatOffer(game) {
  const room = game.roomOf(game.player);
  const rec = roomHazard(game.ship, hazardRecords(game), room.id);
  if (rec?.id !== "frost" || rec.heated === game.currentShip.visits) return [];
  const rig = rigOf(game.player);
  const has = rig !== void 0 && findSlot(rig, "cell") !== null;
  const offer3 = {
    label: `${verbWord(HEAT)} ${room.label}`,
    cmd: { kind: "act", verb: HEAT, target: room.id },
    enabled: has
  };
  if (!has) offer3.why = t("why.module.missing", { module: moduleName("cell") });
  return [offer3];
}
function heat(game, target) {
  const room = game.roomOf(game.player);
  const rec = roomHazard(game.ship, hazardRecords(game), room.id);
  if (target !== room.id || rec?.id !== "frost") return FAIL5(t("why.hazard.noFrost"));
  if (rec.heated === game.currentShip.visits) return FAIL5(t("why.hazard.heated", { room: roomName(room) }));
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "cell") : null;
  if (!rig || slot === null) return FAIL5(t("why.module.missing", { module: moduleName("cell") }));
  rig.exposed = slot;
  for (const hit of routeDamage(rig, HEAT_COST, ["corrosive"]).hits) {
    if (hit.burned) game.log.add(moduleBurnLine(hit.kind), game.schedule.time, "bad", "log.module.burn");
  }
  applyDerived(game.player);
  rec.heated = game.currentShip.visits;
  game.makeNoise(room.id, HEAT_NOISE);
  game.log.add(
    t("log.hazard.heat", { module: moduleName("cell"), room: roomName(room) }),
    game.schedule.time,
    "good",
    "log.hazard.heat"
  );
  return DONE5();
}
function adopt(game) {
  const ship = game.ship;
  const existing = hazardRecords(game);
  const fresh2 = [];
  for (const room of ship.rooms) {
    if (isHazardId(room.hazard) && !existing.some((r) => r.room === room.id)) {
      fresh2.push({ id: room.hazard, room: room.id, known: false });
    }
  }
  for (const door of ship.doors) {
    if (isHazardId(door.trap) && !existing.some((r) => r.door === door.id)) {
      fresh2.push({ id: door.trap, door: door.id, known: false });
    }
  }
  if (existing.length === 0 && fresh2.length === 0) return;
  const store = hazardStore(game);
  store.push(...fresh2);
  for (const rec of [...store]) {
    if (live(game, rec)) markHazard(ship, rec);
    else removeHazard(game, rec);
  }
}
var HAZARD = {
  name: "hazards",
  onLevelEnter(game) {
    if (isTug(game)) return;
    adopt(game);
    chill(game);
    tell(game);
    watchMachines(game);
  },
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== HEAT) return void 0;
    return heat(game, cmd.target);
  },
  offerActions(game) {
    if (game.status !== "playing" || isTug(game)) return [];
    return heatOffer(game);
  },
  /**
   * After the drone's own step: the mine under it, the ice under it, and the
   * sign for whatever is next to where it now stands. A `go` that resolved is
   * a compartment changed — nothing else moves the drone within a ship, and a
   * change of ship comes through `onLevelEnter`.
   */
  afterPlayerTurn(game, cmd) {
    if (game.status !== "playing" || isTug(game)) return;
    if (cmd.kind === "go") {
      const rec = doorHazard(game.ship, hazardRecords(game), cmd.door);
      if (rec?.id === "mine" && tripMine(game, rec, game.ship.doorAt(cmd.door), game.player)) return;
    }
    chill(game);
    if (cmd.kind === "go") tell(game);
    watchMachines(game);
  },
  /**
   * After a machine's: did it just come through a mined door? The first one
   * through takes the blast, and a machine walked into it ahead of the drone
   * is the report's second way of lifting a mine.
   */
  afterActorTurn(game, actor) {
    if (isTug(game) || actor.id === game.player.id) return;
    const was = actor.data?.[LAST_ROOM];
    const now = actor.room;
    if (typeof was === "number" && now !== void 0 && was !== now && isAlive(actor)) {
      const door = crossed(game, was, now);
      const rec = door === void 0 ? void 0 : doorHazard(game.ship, hazardRecords(game), door.id);
      if (door && rec?.id === "mine") tripMine(game, rec, door, actor);
    }
    (actor.data ??= {})[LAST_ROOM] = now;
    chill(game);
  }
};

// ../../../smoreg_works/games/salvor/src/systems/rivalstate.ts
function rivalState(game) {
  const raw2 = game.currentShip.data.rival;
  if (!isState2(raw2)) return { enabled: false, progress: 0, alive: false, taken: [], rolls: 0 };
  raw2.taken ??= [];
  raw2.rolls ??= 0;
  return raw2;
}
function isState2(raw2) {
  if (typeof raw2 !== "object" || raw2 === null) return false;
  const s = raw2;
  return typeof s.enabled === "boolean" && typeof s.progress === "number";
}

// ../../../smoreg_works/games/salvor/src/systems/populate.ts
var DEEPEST_BAND = 8;
var FILLER_DEPTH = 2;
var SYSTEM_MARK = {
  E: "engine",
  O: "core",
  T: "terminal"
};
var POPULATE = {
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
    const spec2 = specOfShip(game.ship);
    for (const room of game.ship.rooms) fill2(game, spec2, room);
    ensureOnboardingScrap(game);
    placeRelic(game, spec2);
    fillToBudget(game, spec2);
    placeHazards(game, spec2);
  }
};
function fill2(game, spec2, room) {
  const holders = [];
  for (const mark of room.marks) applyMark(game, spec2, room, mark, holders);
  for (const mark of room.marks) {
    if (mark.startsWith(KEY_MARK)) giveKey(game, room, mark.slice(KEY_MARK.length), holders);
  }
}
function applyMark(game, spec2, room, mark, holders) {
  const [head, ...rest] = mark.split(":");
  switch (head) {
    case "m":
      spawn(game, room, rest[0] ? machineById(game, rest[0]) : bandPick(game, spec2, room.depth));
      return;
    case "M":
      spawn(game, room, heaviest(game, spec2, room.depth));
      return;
    case "X": {
      const kind = rest[0] ?? game.rng.pick(SALVAGE_POOL);
      bucket(room, "wrecks").push({
        id: nextShipId(game),
        kind,
        integrity: crateIntegrity(kind),
        glyph: "X"
      });
      return;
    }
    case "%":
      bucket(room, "wrecks").push({
        id: nextShipId(game),
        kind: rest[0] ?? game.rng.pick(SALVAGE_POOL),
        integrity: rest[1] ? Number(rest[1]) : game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]),
        glyph: "%"
      });
      return;
    case "\u2020": {
      const body = { id: nextShipId(game), searched: false };
      bucket(room, "bodies").push(body);
      if (rest[0] === "key") holders.push(body.id);
      return;
    }
    // The two crates a compartment can hold. `cargo` is what the hull was
    // hauling and `contraband` is what it was not declaring; both are credits
    // and nothing else, and the price of each is the voyage's to name.
    case "cargo":
    case "contraband":
      bucket(room, "crates").push({ id: nextShipId(game), kind: head });
      return;
    case "*":
      bucket(room, "items").push({ id: nextShipId(game), kind: "charter-item" });
      return;
    case "&":
      bucket(room, "items").push({ id: nextShipId(game), kind: "console" });
      return;
    case "E":
    case "O":
    case "T":
      bucket(room, "systems").push({
        id: nextShipId(game),
        kind: SYSTEM_MARK[head],
        online: false,
        glyph: SYSTEM_GLYPH
      });
      return;
    case "cover":
      room.cover = true;
      return;
    case "vented":
      room.hazard = head;
      return;
    default:
      return;
  }
}
function giveKey(game, room, id, holders) {
  const bodies = bucket(room, "bodies");
  const free = bodies.filter((b) => b.key === void 0);
  const body = free.find((b) => holders.includes(b.id)) ?? free[0];
  if (body) body.key = id;
  else bodies.push({ id: nextShipId(game), searched: false, key: id });
}
function bandAt(game, spec2, depth) {
  const kinds = game.content.monstersForDepth(depth);
  if (!spec2) return kinds;
  const band = kinds.filter((k) => spec2.band.includes(k.id));
  for (const id of spec2.band) {
    if (band.some((k) => k.id === id)) continue;
    const extra = machineAboard(id);
    if (extra && depth >= extra.minDepth && depth <= extra.maxDepth) band.push(extra);
  }
  return band;
}
function bandPick(game, spec2, depth) {
  const kinds = bandAt(game, spec2, depth);
  if (kinds.length === 0) return void 0;
  const table = {};
  for (const k of kinds) table[k.id] = spec2 ? Math.max(1, k.weight) : k.weight;
  const id = game.rng.weighted(table);
  return kinds.find((k) => k.id === id);
}
function heaviest(game, spec2, depth) {
  let best;
  for (const k of bandAt(game, spec2, depth)) {
    if (!best || k.hp > best.hp) best = k;
  }
  return best;
}
function fillToBudget(game, spec2) {
  if (!spec2) return;
  const target = Math.min(game.rng.int(spec2.machines[0], spec2.machines[1]), MAX_MACHINES);
  const empty = game.ship.rooms.filter((r) => r.depth >= FILLER_DEPTH && !holdsMachine(game, r));
  game.rng.shuffle(empty);
  let aboard2 = machinesAboard(game);
  for (const room of empty) {
    if (aboard2 >= target) return;
    const kind = bandPick(game, spec2, room.depth);
    if (!kind) continue;
    spawn(game, room, kind);
    aboard2++;
  }
}
function machinesAboard(game) {
  return game.entities.filter((e) => e.id !== game.player.id).length;
}
function holdsMachine(game, room) {
  return game.entitiesIn(room.id).some((e) => e.id !== game.player.id);
}
function machineById(game, id) {
  for (let depth = 0; depth <= DEEPEST_BAND; depth++) {
    const hit = game.content.monstersForDepth(depth).find((k) => k.id === id);
    if (hit) return hit;
  }
  return void 0;
}
function spawn(game, room, kind) {
  if (!kind || crowded4(game, room)) return;
  const machine = spawnMonsterIn(kind, room.id);
  notePost(machine);
  game.schedule.admit(machine);
  game.entities.push(machine);
}
function crowded4(game, room) {
  return game.entitiesIn(room.id).filter((e) => e.id !== game.player.id).length >= CROWD;
}
function placeRelic(game, spec2) {
  const relics = spec2?.relics ?? [];
  if (!spec2 || relics.length === 0) return void 0;
  if (!game.rng.chance(RELIC_CHANCE)) return void 0;
  const kind = game.rng.pick(relics);
  const entry = game.ship.entry;
  const rooms = game.ship.rooms.filter(
    (r) => r.id !== entry && r.depth >= RELIC_DEPTH && roomList(r, "systems").length === 0
  );
  if (rooms.length === 0) return void 0;
  const room = game.rng.pick(rooms);
  bucket(room, "wrecks").push({
    id: nextShipId(game),
    kind,
    integrity: crateIntegrity(kind),
    glyph: "X",
    source: "crate"
  });
  if (machinesAboard(game) < Math.min(spec2.machines[1], MAX_MACHINES)) {
    spawn(game, room, bandPick(game, spec2, room.depth) ?? heaviest(game, spec2, DEEPEST_BAND));
  }
  return room;
}
function ensureOnboardingScrap(game) {
  if (game.ships.size !== 1) return;
  const room = game.ship.roomAt(game.ship.entry);
  if (roomList(room, "wrecks").length > 0) return;
  bucket(room, "wrecks").push({
    id: nextShipId(game),
    kind: CARD_MODULE["docking bay"] ?? "welder",
    integrity: game.rng.int(SCRAP_INTEGRITY[0], SCRAP_INTEGRITY[1]),
    glyph: "%"
  });
}
function crateIntegrity(kind) {
  return MODULES[kind]?.integrity ?? SCRAP_INTEGRITY[1];
}
function bucket(room, key3) {
  const data = room.data;
  const list = data[key3] ?? [];
  data[key3] = list;
  return list;
}
function roomList(room, key3) {
  return room.data[key3] ?? [];
}

// ../../../smoreg_works/games/salvor/src/systems/shipstate.ts
function shipState(game) {
  const data = game.currentShip.data;
  const raw2 = data.ship;
  if (typeof raw2 === "object" && raw2 !== null && Array.isArray(raw2.online)) {
    return raw2;
  }
  const fresh2 = { online: [] };
  data.ship = fresh2;
  return fresh2;
}

// ../../../smoreg_works/games/salvor/src/content/charters.ts
var SHIP_SYSTEMS = ["engine", "core", "terminal"];
function itemsAboard(ship) {
  return ship.rooms.flatMap((r) => r.data.items ?? []);
}
function salvageTarget(spec2) {
  const size = spec2.rooms[1];
  if (size <= 14) return 20;
  if (size <= 19) return 35;
  return 50;
}
function charterKinds(spec2) {
  return spec2.kinds.filter((k) => CHARTER_KINDS.includes(k));
}
function salvageCharter(spec2) {
  return { id: "salvage", text: t("charter.salvage", { need: salvageTarget(spec2) }), payout: 20 };
}
function retrieve(kind) {
  return {
    id: "retrieve",
    text: t("charter.retrieve", { room: zoneName(kind) }),
    payout: 25,
    target: { kind, mark: "*" }
  };
}
function upload(kind) {
  return {
    id: "upload",
    text: t("charter.upload", { room: zoneName(kind) }),
    payout: 30,
    target: { kind, mark: "&" }
  };
}
function neutralize(spec2) {
  return { id: "neutralize", text: t("charter.neutralize"), payout: spec2.salePrice };
}
var FILLED = {
  salvage: (state, _ship, spec2) => state.loot >= salvageTarget(spec2),
  retrieve: (_state, ship) => itemsAboard(ship).some((i) => i.kind === "charter-item" && i.taken === true),
  upload: (_state, ship) => itemsAboard(ship).some((i) => i.kind === "console" && i.uploaded === true),
  neutralize: (state) => SHIP_SYSTEMS.every((s) => state.online.includes(s))
};
function doneBy(id, state, ship, spec2) {
  return FILLED[id]?.(state, ship, spec2) ?? false;
}
function offerCharters(spec2, rng) {
  const out2 = [neutralize(spec2)];
  const kinds = rng.shuffle(charterKinds(spec2));
  const wanted2 = rng.int(1, 2);
  for (const id of rng.shuffle(["salvage", "retrieve", "upload"])) {
    if (out2.length - 1 >= wanted2) break;
    if (id === "salvage") {
      out2.push(salvageCharter(spec2));
      continue;
    }
    const kind = kinds.pop();
    if (kind === void 0) continue;
    out2.push(id === "retrieve" ? retrieve(kind) : upload(kind));
  }
  return out2;
}
function charterFlags(charters) {
  const out2 = [];
  for (const charter of charters) {
    if (!charter.target) continue;
    if (charter.id === "retrieve") out2.push(retrieveFlag(charter.target.kind));
    if (charter.id === "upload") out2.push(uploadFlag(charter.target.kind), UPLOAD_FLAG);
  }
  return out2;
}

// ../../../smoreg_works/games/salvor/src/systems/doors.ts
var KEY_NOISE = 0;
var CELL_NOISE = 6;
var WELD_NOISE2 = 5;
var CLOSE_NOISE = 2;
var SEARCH_NOISE = 2;
var WELD_TURNS = 2;
var CELL_COST = 1;
var BODY_CREDITS = 3;
var LOCKED_METHODS = ["power", "spike", "cut", "key"];
var METHOD_MODULE = {
  power: "cell",
  spike: "spike",
  cut: "cutter",
  weld: "welder",
  defuse: "welder"
};
var FAIL6 = (reason) => ({ ok: false, cost: 0, reason });
var DONE6 = () => ({ ok: true, cost: TURN_COST });
function workOf(room) {
  const raw2 = room.data.work;
  if (typeof raw2 !== "object" || raw2 === null) return void 0;
  const w = raw2;
  if (w.verb !== "cut" && w.verb !== "weld" && w.verb !== "defuse") return void 0;
  if (typeof w.door !== "number" || typeof w.left !== "number" || typeof w.turn !== "number") {
    return void 0;
  }
  return { verb: w.verb, door: w.door, left: w.left, turn: w.turn };
}
function advance2(game, room, verb2, door, turns) {
  const open = workOf(room);
  const resumed = open !== void 0 && open.verb === verb2 && open.door === door.id && open.turn === game.inputs.length - 1;
  const left = (resumed ? open.left : turns) - 1;
  if (left > 0) room.data.work = { verb: verb2, door: door.id, left, turn: game.inputs.length };
  else delete room.data.work;
  return left;
}
function roomActedIn(game, cmd) {
  const here3 = game.roomOf(game.player);
  if (cmd.kind !== "go") return here3;
  const door = game.ship.doors[cmd.door];
  return door ? game.ship.roomAt(game.ship.other(door, here3.id)) : void 0;
}
function keysHeld2(player) {
  const keys = player.data?.keys;
  return typeof keys === "number" ? keys : 0;
}
function setKeys(player, keys) {
  (player.data ??= {}).keys = Math.max(0, keys);
}
function addLoot2(player, amount) {
  const data = player.data ??= {};
  data.loot = (typeof data.loot === "number" ? data.loot : 0) + amount;
}
function carries3(rig, kind) {
  return rig !== void 0 && findSlotAs(rig, kind) !== null;
}
function doorHere(game, target) {
  if (target === void 0) return void 0;
  const door = game.ship.doors[target];
  if (!door || door.state === "airlock") return void 0;
  const here3 = game.roomOf(game.player).id;
  return door.a === here3 || door.b === here3 ? door : void 0;
}
function keyChance(game) {
  const id = game.currentShip.data.derelict;
  const spec2 = typeof id === "string" ? derelictSpec(id) : void 0;
  return (spec2 ?? FREIGHTER).keyChance;
}
function spikeWork(game) {
  const data = game.currentShip.data;
  const existing = data.spiked;
  if (typeof existing === "object" && existing !== null) return existing;
  const fresh2 = {};
  data.spiked = fresh2;
  return fresh2;
}
function doorHack(game, door) {
  const work3 = spikeWork(game);
  const id = String(door.id);
  return {
    name: t("word.bulkhead", { door: door.label }),
    expose: "spike",
    get turnsLeft() {
      const left = work3[id];
      return typeof left === "number" ? left : SPIKE_TURNS;
    },
    set turnsLeft(left) {
      work3[id] = left;
    },
    breach() {
      door.state = "open";
      delete work3[id];
    }
  };
}
registerHackTarget((game, target) => {
  const door = doorHere(game, target);
  return door && door.state === "locked" ? doorHack(game, door) : void 0;
});
function openWithKey(game, door) {
  if (door.state !== "locked") return FAIL6(t("why.door.notLocked", { door: door.label }));
  const keys = keysHeld2(game.player);
  if (keys <= 0) return FAIL6(t("why.door.noKeycard"));
  setKeys(game.player, keys - 1);
  door.state = "open";
  game.makeNoise(game.roomOf(game.player).id, KEY_NOISE);
  game.log.add(
    t("log.door.key", { door: door.label }),
    game.schedule.time,
    "good",
    "log.door.key"
  );
  return DONE6();
}
function powerOpen(game, door) {
  if (door.state !== "locked") return FAIL6(t("why.door.notLocked", { door: door.label }));
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "cell") : null;
  if (!rig || slot === null) return FAIL6(missing("power"));
  door.state = "open";
  game.makeNoise(game.roomOf(game.player).id, CELL_NOISE);
  game.log.add(t("log.door.power", { door: door.label }), game.schedule.time, "good", "log.door.power");
  spendCell(game, rig, slot);
  return DONE6();
}
function spendCell(game, rig, slot) {
  rig.exposed = slot;
  for (const hit of routeDamage(rig, CELL_COST, ["corrosive"]).hits) {
    if (hit.burned) game.log.add(moduleBurnLine(hit.kind), game.schedule.time, "bad", "log.module.burn");
  }
  applyDerived(game.player);
}
function spikeOpen(game, door) {
  if (door.state !== "locked") return FAIL6(t("why.door.noLock", { door: door.label }));
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "spike") : null;
  if (!rig || slot === null) return FAIL6(missing("spike"));
  const cmd = { kind: "act", verb: "use", slot, target: door.id };
  return RIG.performCommand?.(game, game.player, cmd) ?? FAIL6(t("why.breach.nothing"));
}
function cutOpen(game, room, door) {
  if (door.state !== "locked" && door.state !== "sealed") {
    return FAIL6(t("why.door.noCut", { door: door.label }));
  }
  const rig = rigOf(game.player);
  if (!carries3(rig, "cutter")) return FAIL6(missing("cut"));
  const left = advance2(game, room, "cut", door, BREACH_TURNS);
  game.makeNoise(room.id, BREACH_NOISE);
  if (left > 0) {
    game.log.add(
      t("log.door.cut.on", { door: door.label, left }),
      game.schedule.time,
      "warn",
      "log.door.cut.on"
    );
    return DONE6();
  }
  door.state = "broken";
  game.log.add(t("log.door.cut.done", { door: door.label }), game.schedule.time, "good", "log.door.cut.done");
  return DONE6();
}
function stillLeadsHome(game, room, sealing) {
  const airlock = game.ship.airlock();
  const home = airlock ? airlock.a : game.ship.entry;
  const walkable = (door) => door.id !== sealing.id && (door.state === "open" || door.state === "closed" || door.state === "broken");
  return Number.isFinite(RoomDistance.from(game.ship, [room.id], walkable).at(home));
}
function weldShut(game, room, door) {
  if (door.state !== "open" && door.state !== "closed") {
    return FAIL6(t("why.door.noWeld", { door: door.label }));
  }
  const rig = rigOf(game.player);
  if (!carries3(rig, "welder")) return FAIL6(missing("weld"));
  if (!stillLeadsHome(game, room, door)) return FAIL6(t("why.door.wallsIn", { door: door.label }));
  const left = advance2(game, room, "weld", door, WELD_TURNS);
  game.makeNoise(room.id, WELD_NOISE2);
  if (left > 0) {
    game.log.add(t("log.door.weld.on", { door: door.label }), game.schedule.time, "plain", "log.door.weld.on");
    return DONE6();
  }
  door.state = "sealed";
  game.log.add(t("log.door.weld.done", { door: door.label }), game.schedule.time, "good", "log.door.weld.done");
  return DONE6();
}
function defuseMine(game, room, door) {
  const rec = doorHazard(game.ship, hazardRecords(game), door.id);
  if (rec?.id !== "mine") return FAIL6(t("why.door.noTrap", { door: door.label }));
  const rig = rigOf(game.player);
  if (!carries3(rig, "welder")) return FAIL6(missing("defuse"));
  const left = advance2(game, room, "defuse", door, DEFUSE_TURNS);
  game.makeNoise(room.id, DEFUSE_NOISE);
  if (left > 0) {
    game.log.add(t("log.door.defuse.on", { door: door.label }), game.schedule.time, "plain", "log.door.defuse.on");
    return DONE6();
  }
  removeHazard(game, rec);
  game.log.add(t("log.door.defuse.done", { door: door.label }), game.schedule.time, "good", "log.door.defuse.done");
  return DONE6();
}
function closeDoor(game, door) {
  if (door.state !== "open") return FAIL6(t("why.door.notOpen", { door: door.label }));
  door.state = "closed";
  game.makeNoise(game.roomOf(game.player).id, CLOSE_NOISE);
  game.log.add(t("log.door.close", { door: door.label }), game.schedule.time, "plain", "log.door.close");
  return DONE6();
}
function searchBody(game, target) {
  const room = game.roomOf(game.player);
  const bodies = roomList(room, "bodies");
  const body = target === void 0 ? bodies.find((b) => !b.searched) : bodies.find((b) => b.id === target);
  if (!body) return FAIL6(t("why.body.none"));
  if (body.searched) return FAIL6(t("why.body.searched"));
  body.searched = true;
  addLoot2(game.player, BODY_CREDITS);
  const key3 = body.key !== void 0 || game.rng.chance(keyChance(game));
  if (key3) setKeys(game.player, keysHeld2(game.player) + 1);
  game.makeNoise(room.id, SEARCH_NOISE);
  game.log.add(
    key3 ? t("log.body.key", { cr: BODY_CREDITS }) : t("log.body.plain", { cr: BODY_CREDITS }),
    game.schedule.time,
    "good",
    "log.body.search"
  );
  if (key3) hint(game, "keycard");
  return DONE6();
}
function offer(verb2, door, enabled, why) {
  const out2 = {
    label: `${verbWord(verb2)} ${door.label}`,
    cmd: { kind: "act", verb: verb2, target: door.id },
    enabled
  };
  if (!enabled && why !== void 0) out2.why = why;
  return out2;
}
function missing(verb2) {
  const kind = METHOD_MODULE[verb2];
  return kind === void 0 ? t("why.door.noKeycard") : t("why.module.missing", { module: moduleName(kind) });
}
function weldOffer(game, door) {
  return stillLeadsHome(game, game.roomOf(game.player), door) ? offer("weld", door, true) : offer("weld", door, false, t("why.door.wallsIn", { door: door.label }));
}
function doorOffers(game, rig, door) {
  const has = {
    key: keysHeld2(game.player) > 0,
    power: carries3(rig, "cell"),
    spike: carries3(rig, "spike"),
    cut: carries3(rig, "cutter"),
    weld: carries3(rig, "welder"),
    defuse: carries3(rig, "welder"),
    close: true
  };
  const mine = doorHazard(game.ship, hazardRecords(game), door.id)?.id === "mine" ? [offer("defuse", door, has.defuse, missing("defuse"))] : [];
  switch (door.state) {
    case "locked":
      return [...mine, ...LOCKED_METHODS.map((verb2) => offer(verb2, door, has[verb2], missing(verb2)))];
    case "sealed":
      return has.cut ? [offer("cut", door, true)] : [];
    case "open":
      return has.weld ? [...mine, offer("close", door, true), weldOffer(game, door)] : [...mine, offer("close", door, true)];
    case "closed":
      return has.weld ? [...mine, weldOffer(game, door)] : mine;
    case "broken":
      return mine;
    default:
      return [];
  }
}
var DOORS = {
  name: "doors",
  onRunStart(game) {
    const data = game.player.data ??= {};
    if (typeof data.keys !== "number") data.keys = 0;
    if (typeof data.loot !== "number") data.loot = 0;
  },
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act") return void 0;
    if (cmd.verb === "search") return searchBody(game, cmd.target);
    const verb2 = cmd.verb;
    if (!isDoorVerb(verb2)) return void 0;
    const door = doorHere(game, cmd.target);
    if (!door) return FAIL6(t("why.door.notHere"));
    const room = game.roomOf(game.player);
    switch (verb2) {
      case "key":
        return openWithKey(game, door);
      case "power":
        return powerOpen(game, door);
      case "spike":
        return spikeOpen(game, door);
      case "cut":
        return cutOpen(game, room, door);
      case "weld":
        return weldShut(game, room, door);
      case "defuse":
        return defuseMine(game, room, door);
      case "close":
        return closeDoor(game, door);
    }
  },
  /**
   * Cutting and welding have to be consecutive: anything else the drone does —
   * a step, a swing, a turn spent waiting — drops the job where it stands.
   * Refused commands never reach here, so a key pressed for a module that
   * burned does not cost the cut.
   */
  afterPlayerTurn(game, cmd) {
    if (cmd.kind === "leave") return;
    const room = roomActedIn(game, cmd);
    if (!room) return;
    const work3 = workOf(room);
    if (!work3 || work3.turn === game.inputs.length - 1) return;
    delete room.data.work;
    game.log.add(
      work3.verb === "cut" ? t("log.work.break.cut") : work3.verb === "defuse" ? t("log.work.break.defuse") : t("log.work.break.weld"),
      game.schedule.time,
      "warn",
      "log.work.break"
    );
  },
  offerActions(game) {
    const offers = [];
    if (game.status !== "playing") return offers;
    const room = game.roomOf(game.player);
    const rig = rigOf(game.player);
    for (const body of roomList(room, "bodies")) {
      if (body.searched) continue;
      offers.push({
        label: t("action.search"),
        cmd: { kind: "act", verb: "search", target: body.id },
        enabled: true
      });
    }
    for (const door of game.ship.doorsOf(room.id)) {
      offers.push(...doorOffers(game, rig, door));
    }
    return offers;
  },
  panelLines(game) {
    return [{ text: t("panel.keys", { n: keysHeld2(game.player) }) }];
  }
};
function isDoorVerb(verb2) {
  return verb2 === "key" || verb2 === "power" || verb2 === "spike" || verb2 === "cut" || verb2 === "weld" || verb2 === "close" || verb2 === "defuse";
}

// ../../../smoreg_works/games/salvor/src/systems/voyage.ts
var REPAIR_PRICE = 1;
var REPAIR_CAP = 4;
var GRAFT_PRICE = 12;
var JUMP_PRICE = 30;
var MODULE_PRICE = 4;
var MODULE_PER_POINT = 0;
var CRATE_PRICE = { cargo: 8, contraband: 14 };
var HOLD_LIMIT = 6;
var TAKE_NOISE = 2;
var FIRST_DERELICT_ID = "1";
var HULL_TARGET = 2e3;
var HOLD_TARGET = 2100;
var STOCK_TARGET = 2200;
var CHARTER_TARGET = 2200;
var NOT_ENOUGH = "why.credits";
var RACK_FULL = "why.rack.hullFull";
var BROKE_KEY = "log.voyage.broke";
var WON_KEY = "log.voyage.won";
var LOST_KEY = "log.drone.lost";
var TO_TUG_KEY = "log.voyage.home";
var UNDOCK_KEY = "log.voyage.undock";
var FAIL7 = (reason) => ({ ok: false, cost: 0, reason });
var DONE7 = () => ({ ok: true, cost: TURN_COST });
var FREE = DONE7;
function voyageRecord(game) {
  const raw2 = game.player.data?.voyage;
  return isVoyage(raw2) ? raw2 : void 0;
}
function derelictAboard(game) {
  return voyageRecord(game)?.state.find((s) => s.shipId === game.shipId);
}
function voyageOf(game) {
  const data = game.player.data ??= {};
  const raw2 = data.voyage;
  const voyage = isVoyage(raw2) ? raw2 : fresh(game);
  data.voyage = voyage;
  voyage.keys = keysHeld2(game.player);
  voyage.loot = lootHeld(game.player);
  return voyage;
}
function isVoyage(raw2) {
  if (typeof raw2 !== "object" || raw2 === null) return false;
  const v = raw2;
  return typeof v.credits === "number" && Array.isArray(v.hold) && Array.isArray(v.derelicts) && Array.isArray(v.state) && typeof v.current === "number" && typeof v.sortie === "number";
}
function fresh(game) {
  const drawn2 = derelictsForVoyage(game.rng);
  const derelicts = isTraining(game.player) ? [TUTORIAL_SPEC, ...drawn2] : drawn2;
  const first = derelicts[0];
  return {
    credits: STARTING_CREDITS,
    hold: [],
    hull: STARTING_HULL.id,
    keys: 0,
    loot: 0,
    derelicts,
    current: 0,
    state: [freshDerelict(game, first, game.shipId === TUG_ID ? FIRST_DERELICT_ID : game.shipId)],
    offered: [],
    charters: [],
    paid: [],
    sortie: 0
  };
}
function freshDerelict(game, spec2, shipId) {
  return {
    spec: spec2,
    shipId,
    alert: spec2.alertStart,
    online: [],
    deaths: [],
    rivalProgress: 0,
    sold: false,
    banked: 0,
    stock: rollStock(game),
    flavour: rollFlavour(spec2, game.rng)
  };
}
function rollStock(_game) {
  return [...SHELF];
}
function shelfOffers(game, voyage, rig) {
  const out2 = [];
  const room = voyage.hold.length < HOLD_LIMIT;
  (voyage.state[voyage.current]?.stock ?? []).forEach((id, i) => {
    const price = stockPrice(id);
    const spare = holds(voyage, rig, id);
    const noDrone2 = voyage.hull === void 0;
    const why = noDrone2 ? t("why.stock.noDrone") : spare ? t("why.stock.spare", { module: moduleName(id) }) : room ? t(NOT_ENOUGH) : t("why.hold.full", { n: HOLD_LIMIT });
    out2.push(
      offer2(
        t("action.order", { module: moduleName(id), price }),
        { kind: "act", verb: "order", target: STOCK_TARGET + i },
        !noDrone2 && !spare && room && voyage.credits >= price,
        why
      )
    );
  });
  return out2;
}
function holds(voyage, rig, id) {
  if (rig !== void 0 && findSlot(rig, id) !== null) return true;
  return voyage.hold.some((held) => held.kind === id);
}
var SHELF = ["cutter", "plating", "thrusters"];
var SHELF_PRICE = { cutter: 20, plating: 15, thrusters: 15 };
function stockPrice(id) {
  return SHELF_PRICE[id] ?? moduleKind(id).price ?? 40;
}
function currentDerelict(game) {
  const voyage = voyageOf(game);
  const state = voyage.state[voyage.current];
  if (!state) throw new Error("VOYAGE: the voyage has no derelict to be docked to");
  return state;
}
function stateOfShip(game) {
  return voyageOf(game).state.find((s) => s.shipId === game.shipId);
}
function dock(game) {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  clearCharterFlags(game);
  const board = offerCharters(state.spec, game.rng);
  voyage.offered = voyage.current === 0 ? [...board.filter((c) => c.id === "neutralize"), salvageCharter(state.spec)] : board;
  voyage.charters = [];
  voyage.paid = [];
  game.log.add(
    t("log.helm.board", { flavour: flavourLine(state.spec, state.flavour) }),
    game.schedule.time,
    "plain",
    "log.helm.board"
  );
  dockedTo(game);
}
function clearCharterFlags(game) {
  for (const flag of [...game.flags]) {
    if (flag.startsWith(CHARTER_FLAG)) game.flags.delete(flag);
  }
}
function boarded(game) {
  return game.ships.get(currentDerelict(game).shipId) !== void 0;
}
function takeCharter(game, i) {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  const charter = voyage.offered[i];
  if (!charter) return FAIL7(t("why.charter.none"));
  if (boarded(game)) return FAIL7(t("why.charter.late", { hull: derelictName(state.spec) }));
  voyage.offered.splice(i, 1);
  voyage.charters.push(charter);
  for (const flag of charterFlags([charter])) game.flags.add(flag);
  game.log.add(t("log.charter.signed", { charter: charter.text }), game.schedule.time, "good", "log.charter.signed");
  return FREE();
}
function charterName(charter) {
  return tId("charter.name", charter.id, charter.id.toUpperCase());
}
function charterPrice(charter) {
  return charter.payout > 0 ? t("word.cr", { n: charter.payout }) : t("word.theVoyage");
}
function payCharters(game, state) {
  const voyage = voyageOf(game);
  const home = { loot: state.banked, online: state.online };
  for (const charter of voyage.charters) {
    if (charter.id === "neutralize" || voyage.paid.includes(charter.id)) continue;
    if (!doneBy(charter.id, home, game.ship, state.spec)) {
      const missed = tId("log.charter.missed", charter.id, "", {
        charter: charterName(charter),
        have: home.loot,
        need: salvageTarget(state.spec)
      });
      if (missed) game.log.add(missed, game.schedule.time, "warn", `log.charter.missed.${charter.id}`);
      continue;
    }
    voyage.paid.push(charter.id);
    credit(game, charter.payout, t("log.charter.filled", { charter: charterName(charter) }));
  }
}
function charterDone(game, charter) {
  return charter.id === "neutralize" ? currentDerelict(game).sold : voyageOf(game).paid.includes(charter.id);
}
function lootHeld(player) {
  const loot = player.data?.loot;
  return typeof loot === "number" ? loot : 0;
}
function setLoot(player, amount) {
  (player.data ??= {}).loot = Math.max(0, amount);
}
function setKeys2(player, keys) {
  (player.data ??= {}).keys = Math.max(0, keys);
}
function credit(game, amount, why, key3 = "log.credit") {
  if (amount <= 0) return;
  const voyage = voyageOf(game);
  voyage.credits += amount;
  game.log.add(
    t("log.credit", { why, amount, total: voyage.credits }),
    game.schedule.time,
    "good",
    key3
  );
}
function spend(game, amount) {
  const voyage = voyageOf(game);
  if (voyage.credits < amount) return false;
  voyage.credits -= amount;
  return true;
}
function jumpFirst(game) {
  const voyage = voyageOf(game);
  const state = voyage.state[voyage.current];
  if (state?.sold !== true || !voyage.derelicts[voyage.current + 1]) return void 0;
  return t("why.jump.first", { price: JUMP_PRICE });
}
function affordable(game, price) {
  const held = jumpFirst(game) === void 0 ? 0 : JUMP_PRICE;
  return voyageOf(game).credits - held >= price;
}
function whyNot(game, price) {
  return affordable(game, price) ? t(NOT_ENOUGH) : jumpFirst(game) ?? t(NOT_ENOUGH);
}
function charge(game, price) {
  if (!affordable(game, price)) return whyNot(game, price);
  return spend(game, price) ? void 0 : t(NOT_ENOUGH);
}
function modulePrice(slot) {
  return MODULE_PRICE + MODULE_PER_POINT * Math.max(0, slot.integrity - 1);
}
function cratePrice(crate) {
  return CRATE_PRICE[crate.kind] ?? CRATE_PRICE.cargo;
}
function fitHull(game, hull3, stocked = false) {
  const voyage = voyageOf(game);
  voyage.hull = hull3.id;
  const data = game.player.data ??= {};
  data.rig = rigFrom(stocked ? startingSlots() : hullSlots(hull3), hull3.slots);
  game.player.hpMax = hull3.core;
  game.player.hp = hull3.core;
  clearVirus(game.player);
  game.player.hp = game.player.hpMax;
  autoFit(game);
  applyDerived(game.player);
  game.refreshSight();
}
function autoFit(game) {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  if (!rig || voyage.hold.length === 0) return;
  const order = [...voyage.hold].sort((a, b) => b.integrity - a.integrity);
  const fitted3 = [];
  for (const held of order) {
    const slot = rig.slots.findIndex((s) => s === null);
    if (slot < 0) break;
    installAt(rig, slot, held.kind, held.integrity, held.charges, held.base, held.bonus);
    fitted3.push(held);
  }
  if (fitted3.length === 0) return;
  voyage.hold = voyage.hold.filter((held) => !fitted3.includes(held));
  game.log.add(
    t("log.hold.fitted", { n: fitted3.length }),
    game.schedule.time,
    "good",
    "log.hold.fitted"
  );
}
function buyHull(game, id) {
  const voyage = voyageOf(game);
  if (voyage.hull !== void 0) return FAIL7(t(RACK_FULL));
  const hull3 = hullKind(id);
  if (!hull3) return FAIL7(t("why.hull.none"));
  const no = charge(game, hull3.price);
  if (no !== void 0) return FAIL7(no);
  fitHull(game, hull3);
  game.log.add(
    t("log.hull.bought", { hull: hullName(hull3), trait: hullTrait(hull3), credits: voyage.credits }),
    game.schedule.time,
    "good",
    "log.hull.bought"
  );
  return FREE();
}
function repair2(game, slot) {
  const module = slotAt(game, slot);
  if (!module) return FAIL7(t("why.slot.empty"));
  if (isRelic(module.kind)) return FAIL7(t("why.relic.noRepair", { module: moduleName(module.kind) }));
  if (module.integrity >= capOf(module)) return FAIL7(t("why.module.whole", { module: moduleName(module.kind) }));
  const no = charge(game, repairPrice(module));
  if (no !== void 0) return FAIL7(no);
  module.integrity = capOf(module);
  applyDerived(game.player);
  game.log.add(
    t("log.bench.repair", { module: moduleName(module.kind), left: module.integrity, max: capOf(module) }),
    game.schedule.time,
    "good",
    "log.bench.repair"
  );
  return FREE();
}
function graft2(game, slot) {
  const module = slotAt(game, slot);
  if (!module) return FAIL7(t("why.slot.empty"));
  const rig = rigOf(game.player);
  if (isRelic(module.kind)) return FAIL7(t("why.relic.noRepair", { module: moduleName(module.kind) }));
  if (!canGraft(module)) return FAIL7(t("why.module.grafted", { module: moduleName(module.kind) }));
  const no = charge(game, GRAFT_PRICE);
  if (no !== void 0) return FAIL7(no);
  const done = graft(rig, slot);
  applyDerived(game.player);
  game.log.add(
    t("log.bench.graft", { module: moduleName(done.kind), left: done.integrity, max: done.max }),
    game.schedule.time,
    "good",
    "log.bench.graft"
  );
  return FREE();
}
function clean(game, slot) {
  const module = slotAt(game, slot);
  if (!module) return FAIL7(t("why.slot.empty"));
  if (infectedSlot(game) !== slot) return FAIL7(t("why.module.clean", { module: moduleName(module.kind) }));
  const no = charge(game, BENCH_CURE_PRICE);
  if (no !== void 0) return FAIL7(no);
  clearVirus(game.player);
  game.log.add(
    t("log.bench.clean", { module: moduleName(module.kind) }),
    game.schedule.time,
    "good",
    "log.bench.clean"
  );
  return FREE();
}
function sellSlot(game, slot) {
  const rig = rigOf(game.player);
  const module = slotAt(game, slot);
  if (!rig || !module) return FAIL7(t("why.slot.empty"));
  const sick = infectedSlot(game) === slot;
  const price = sellPrice(module, sick);
  removeSlot(rig, slot);
  if (sick) clearVirus(game.player);
  applyDerived(game.player);
  const module_ = moduleName(module.kind);
  credit(game, price, sick ? t("log.hold.sell.sick", { module: module_ }) : t("log.hold.sell", { module: module_ }));
  hint(game, "sell");
  return FREE();
}
function sellPrice(slot, sick = false) {
  const price = modulePrice(slot);
  return sick ? Math.max(1, Math.floor(price * INFECTED_SELL_SHARE)) : price;
}
function stowSlot(game, slot) {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  const module = slotAt(game, slot);
  if (!rig || !module) return FAIL7(t("why.slot.empty"));
  if (voyage.hold.length >= HOLD_LIMIT) return FAIL7(t("why.hold.full", { n: HOLD_LIMIT }));
  if (fullSlots(rig) <= 1) return FAIL7(t("why.rig.last"));
  const max = capOf(module);
  removeSlot(rig, slot);
  if (infectedSlot(game) === slot) clearVirus(game.player);
  voyage.hold.push(carriedFrom(module.kind, module.integrity, module.charges, module.base, module.bonus));
  applyDerived(game.player);
  game.log.add(
    t("log.hold.stow", { module: moduleName(module.kind), integrity: module.integrity, max }),
    game.schedule.time,
    "good",
    "log.hold.stow"
  );
  return FREE();
}
function buyModule(game, index2) {
  const voyage = voyageOf(game);
  const state = voyage.state[voyage.current];
  const shelf = state?.stock ?? [];
  const id = shelf[index2];
  if (id === void 0) return FAIL7(t("why.stock.none"));
  if (voyage.hull === void 0) return FAIL7(t("why.stock.noDrone"));
  if (holds(voyage, rigOf(game.player), id)) {
    return FAIL7(t("why.stock.spare", { module: moduleName(id) }));
  }
  if (voyage.hold.length >= HOLD_LIMIT) return FAIL7(t("why.hold.full", { n: HOLD_LIMIT }));
  const price = stockPrice(id);
  if (!spend(game, price)) return FAIL7(t(NOT_ENOUGH));
  shelf.splice(index2, 1);
  if (state) state.stock = shelf;
  const kind = moduleKind(id);
  voyage.hold.push({ kind: id, integrity: kind.integrity });
  game.log.add(
    t("log.stock.buy", { module: moduleName(id), price, credits: voyage.credits }),
    game.schedule.time,
    "good",
    "log.stock.buy"
  );
  return FREE();
}
function fitFromHold(game, i) {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  const held = voyage.hold[i];
  if (!rig || voyage.hull === void 0) return FAIL7(t("why.hold.noDrone"));
  if (!held) return FAIL7(t("why.hold.none"));
  const slot = install(rig, held.kind, held.integrity, held.charges, held.base, held.bonus);
  if (slot === void 0) return FAIL7(t("why.rack.full"));
  voyage.hold.splice(i, 1);
  applyDerived(game.player);
  const fitted3 = rig.slots[slot];
  game.log.add(
    t("log.hold.fit", { module: moduleName(fitted3.kind), integrity: fitted3.integrity, slot: slot + 1 }),
    game.schedule.time,
    "good",
    "log.hold.fit"
  );
  return FREE();
}
function canGraft(slot) {
  return (slot.bonus ?? 0) < MAX_GRAFT;
}
function slotAt(game, slot) {
  const rig = rigOf(game.player);
  return rig ? rig.slots[slot] ?? void 0 : void 0;
}
function fullSlots(rig) {
  return rig.slots.filter((s) => s !== null).length;
}
function infectedSlot(game) {
  return virusOf(game.player)?.slot;
}
function dockedTo(game) {
  if (!isTug(game)) return;
  game.currentShip.data.from = currentDerelict(game).shipId;
  game.currentShip.data.docked = currentDerelict(game).spec.id;
  game.currentShip.data.dockedName = flavourCallsign(currentDerelict(game).flavour);
}
function returnToTug(game, reason) {
  if (!isTug(game)) snapshot(game);
  if (reason === "airlock") {
    unload(game);
    game.log.add(t(TO_TUG_KEY), game.schedule.time, "warn", TO_TUG_KEY);
  }
  game.travelTo(TUG_ID, { generate: tugShip, reason: "custom" });
  dockedTo(game);
}
function unload(game) {
  const carried = carriedBy(game.player);
  if (carried.length === 0) return;
  const voyage = voyageOf(game);
  const room = Math.max(0, HOLD_LIMIT - voyage.hold.length);
  if (room === 0) return;
  const landed = carried.slice(0, room);
  voyage.hold.push(...landed.map((c) => carriedFrom(c.kind, c.integrity, c.charges, c.base, c.bonus)));
  setCarried(game.player, carried.slice(room));
  game.log.add(
    t("log.carry.home", { n: landed.length }),
    game.schedule.time,
    "good",
    "log.carry.home"
  );
}
function snapshot(game) {
  const state = stateOfShip(game);
  if (!state) return;
  state.online = [...shipState(game).online];
  state.alert = alertState(game).level;
  state.rivalProgress = rivalState(game).progress;
}
function undock(game) {
  const voyage = voyageOf(game);
  if (!isTug(game)) return FAIL7(t("why.undock.aboard"));
  if (voyage.hull === void 0) return FAIL7(t("why.undock.noDrone"));
  const state = currentDerelict(game);
  if (state.sold) return FAIL7(t("why.undock.sold", { hull: derelictName(state.spec) }));
  const index2 = voyage.current;
  voyage.sortie++;
  game.log.add(t(UNDOCK_KEY), game.schedule.time, "warn", UNDOCK_KEY);
  game.travelTo(state.shipId, {
    // The charters signed at the HELM are flags on the run by now, so the deck
    // puts their marks aboard as it draws the hull (`content/derelicts.ts`).
    generate: (rng) => buildChartered(state.spec, index2, rng, { flags: game.flags, shipIndex: index2 }).ship,
    reason: "custom"
  });
  game.currentShip.data.derelict = state.spec.id;
  game.currentShip.data.name = flavourCallsign(state.flavour);
  game.currentShip.data.type = state.spec.id;
  return FREE();
}
function jump(game) {
  const voyage = voyageOf(game);
  if (!isTug(game)) return FAIL7(t("why.jump.aboard"));
  const next = voyage.current + 1;
  const spec2 = voyage.derelicts[next];
  if (!spec2) return FAIL7(t("why.jump.last"));
  if (!spend(game, JUMP_PRICE)) return FAIL7(t(NOT_ENOUGH));
  const dropped = voyage.charters.filter((c) => !charterDone(game, c)).map(charterName);
  if (dropped.length > 0) {
    game.log.add(t("log.jump.left", { charters: dropped.join(", ") }), game.schedule.time, "warn", "log.jump.left");
  }
  voyage.current = next;
  if (!voyage.state[next]) voyage.state[next] = freshDerelict(game, spec2, String(next + 1));
  game.log.add(
    t("log.jump", { hull: derelictName(spec2), credits: voyage.credits }),
    game.schedule.time,
    "warn",
    "log.jump"
  );
  dock(game);
  return FREE();
}
var jumpWarnedAt = /* @__PURE__ */ new WeakMap();
function warnBeforeJump(game) {
  if (game.status !== "playing" || !isTug(game)) return;
  const voyage = voyageOf(game);
  if (!voyage.derelicts[voyage.current + 1]) return;
  const state = currentDerelict(game);
  if (state.sold || state.online.length === 0) return;
  const said2 = jumpWarnedAt.get(game) ?? /* @__PURE__ */ new Set();
  if (said2.has(voyage.current)) return;
  said2.add(voyage.current);
  jumpWarnedAt.set(game, said2);
  game.log.add(
    t("log.jump.warn", { hull: flavourCallsign(state.flavour), up: state.online.length, of: OBJECTIVE_COUNT }),
    game.schedule.time,
    "warn",
    "log.jump.warn"
  );
}
function comeHome(game) {
  const voyage = voyageOf(game);
  const state = stateOfShip(game);
  snapshot(game);
  const carried = lootHeld(game.player);
  if (carried > 0) {
    setLoot(game.player, 0);
    if (state) state.banked += carried;
    credit(game, carried, t("log.hold.emptied"));
    hint(game, "sold", soldLine(carried, CHEAPEST_HULL.price));
  }
  if (state) payCharters(game, state);
  const taken = state?.deal === void 0 && rivalState(game).progress >= OBJECTIVE_COUNT;
  if (state && taken && state.online.length >= OBJECTIVE_COUNT && !state.sold) {
    game.log.add(t("log.hull.taken", { hull: derelictName(state.spec) }), game.schedule.time, "bad");
  }
  const neutralised2 = state !== void 0 && !taken && state.online.length >= OBJECTIVE_COUNT;
  if (state && neutralised2 && !state.sold) {
    state.sold = true;
    const split = state.deal === "split";
    const price = split ? Math.floor(state.spec.salePrice / 2) : state.spec.salePrice;
    const line2 = t(split ? "log.hull.tow.split" : "log.hull.tow", { hull: derelictName(state.spec) });
    credit(game, price, line2, "log.hull.tow");
    if (isLastHull(voyage, state)) {
      game.finish("won", t(WON_KEY));
      return;
    }
  }
  returnToTug(game, "airlock");
}
function isLastHull(voyage, state) {
  return voyage.state.indexOf(state) === voyage.derelicts.length - 1;
}
function loseDrone(game) {
  const voyage = voyageOf(game);
  const state = stateOfShip(game);
  const rig = rigOf(game.player);
  if (state && game.player.room !== void 0) {
    state.deaths.push({ room: game.player.room, rig: rig ?? rigFrom([]) });
  }
  voyage.hull = void 0;
  dropCharterCargo(game);
  setKeys2(game.player, 0);
  setLoot(game.player, 0);
  clearVirus(game.player);
  (game.player.data ??= {}).rig = rigFrom([]);
  game.player.alive = true;
  game.player.hp = game.player.hpMax;
  applyDerived(game.player);
  game.log.add(t(LOST_KEY), game.schedule.time, "bad", LOST_KEY);
  hint(game, "death");
  returnToTug(game, "death");
  endIfBroke(game);
}
function endIfBroke(game) {
  const voyage = voyageOf(game);
  if (voyage.hull === void 0 && voyage.credits < CHEAPEST_HULL.price) {
    game.finish("dead", t(BROKE_KEY));
  }
}
function take(game, target) {
  const room = game.roomOf(game.player);
  const crates = roomList(room, "crates");
  const crate = target === void 0 ? crates[0] : crates.find((c) => c.id === target);
  if (!crate) return takeCargo(game, room, target);
  const price = cratePrice(crate);
  removeCrate(game, room, crate);
  setLoot(game.player, lootHeld(game.player) + price);
  game.makeNoise(room.id, TAKE_NOISE);
  game.log.add(
    t("log.crate.open", { crate: crateName(crate), cr: price }),
    game.schedule.time,
    "good",
    "log.crate.open"
  );
  return DONE7();
}
function removeCrate(game, room, crate) {
  const data = room.data;
  const crates = data.crates;
  if (!crates) return;
  const i = crates.indexOf(crate);
  if (i >= 0) crates.splice(i, 1);
}
function crateName(crate) {
  return crate.kind === "contraband" ? t("crate.contraband") : t("crate.cargo");
}
var UPLOAD_TURNS = 5;
var UPLOAD_NOISE = 6;
function itemsIn2(room, kind) {
  return [...roomList(room, "items")].filter((i) => i.kind === kind);
}
function itemAt(room, kind, target) {
  const here3 = itemsIn2(room, kind);
  return target === void 0 ? here3[0] : here3.find((i) => i.id === target);
}
function takeCargo(game, room, target) {
  const item = itemAt(room, "charter-item", target);
  if (!item) return FAIL7(t("why.cargo.none"));
  if (item.taken) return FAIL7(t("why.cargo.carrying"));
  item.taken = true;
  game.makeNoise(room.id, TAKE_NOISE);
  game.log.add(t("log.cargo.take"), game.schedule.time, "good", "log.cargo.take");
  return DONE7();
}
function upload2(game, target) {
  const room = game.roomOf(game.player);
  const console2 = itemAt(room, "console", target);
  if (!console2) return FAIL7(t("why.console.none"));
  if (console2.uploaded) return FAIL7(t("why.console.done"));
  const left = UPLOAD_TURNS - ((console2.turns ?? 0) + 1);
  game.makeNoise(room.id, UPLOAD_NOISE);
  if (left <= 0) {
    delete console2.turns;
    console2.uploaded = true;
    game.log.add(t("log.upload.done"), game.schedule.time, "good", "log.upload.done");
    return DONE7();
  }
  console2.turns = (console2.turns ?? 0) + 1;
  game.log.add(t("log.upload.on", { left }), game.schedule.time, "plain", "log.upload.on");
  return DONE7();
}
function openUploads(game) {
  return game.ship.rooms.flatMap((room) => itemsIn2(room, "console").filter((i) => (i.turns ?? 0) > 0));
}
function dropCharterCargo(game) {
  const room = game.player.room;
  if (isTug(game) || room === void 0) return;
  for (const from of game.ship.rooms) {
    for (const item of itemsIn2(from, "charter-item")) {
      if (!item.taken) continue;
      delete item.taken;
      if (from.id === room) continue;
      moveItem(from, game.ship.roomAt(room), item);
    }
  }
}
function moveItem(from, to, item) {
  const list = from.data.items;
  if (!list) return;
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
  const into = to.data.items ?? [];
  into.push(item);
  to.data.items = into;
}
function stationOffers(game) {
  const out2 = [];
  for (const verb2 of STATION_ORDER) {
    const lines = stationTargets(game, verb2);
    if (lines.length === 0) continue;
    out2.push(...COLLAPSED.has(verb2) ? [collapse(verb2, lines)] : lines);
  }
  return out2;
}
var STATION_ORDER = [
  "buy",
  "charter",
  "undock",
  "repair",
  "clean",
  "graft",
  "stow",
  "order",
  "fit",
  "sell",
  "jump"
];
var COLLAPSED = /* @__PURE__ */ new Set(["repair", "graft", "stow", "fit", "sell"]);
function collapse(verb2, lines) {
  const open = lines.find((o) => o.enabled);
  const pick2 = open ?? lines[0];
  return offer2(t(PICK_LABEL[verb2], { price: PICK_PRICE[verb2] ?? 0 }), pick2.cmd, open !== void 0, pick2.why);
}
var PICK_LABEL = {
  buy: "action.pick.buy",
  repair: "action.pick.repair",
  graft: "action.pick.graft",
  stow: "action.pick.stow",
  fit: "action.pick.fit",
  sell: "action.pick.sell",
  charter: "action.pick.charter"
};
var PICK_PRICE = { graft: GRAFT_PRICE };
function repairPrice(slot) {
  return Math.min(Math.max(1, capOf(slot) - slot.integrity) * REPAIR_PRICE, REPAIR_CAP);
}
function pickLabel(verb2) {
  const key3 = PICK_LABEL[verb2];
  return key3 === void 0 ? void 0 : t(key3, { price: PICK_PRICE[verb2] ?? 0 });
}
function castOffLeft(voyage, rig) {
  const out2 = [];
  const hurt = rig === void 0 ? 0 : damaged(rig).length;
  if (hurt > 0) out2.push(t("undock.left.damaged", { n: hurt }));
  if (voyage.charters.length === 0 && voyage.offered.length > 0) {
    out2.push(t(hurt > 0 ? "undock.left.charter" : "undock.left.board"));
  }
  return out2;
}
function stationTargets(game, verb2) {
  const voyage = voyageOf(game);
  const rig = rigOf(game.player);
  const out2 = [];
  if (verb2 === "buy") {
    HULLS.forEach((hull3, i) => {
      const cmd = { kind: "act", verb: "buy", target: HULL_TARGET + i };
      if (voyage.hull === hull3.id) {
        out2.push(offer2(t("action.hull.onRack", { hull: hullName(hull3) }), cmd, false, t(RACK_FULL)));
        return;
      }
      const full = voyage.hull !== void 0;
      out2.push(
        offer2(
          t("action.buy", { hull: hullName(hull3), price: hull3.price }),
          cmd,
          !full && affordable(game, hull3.price),
          full ? t(RACK_FULL) : whyNot(game, hull3.price)
        )
      );
    });
    return out2;
  }
  if (verb2 === "charter") {
    const open = !boarded(game);
    voyage.offered.forEach((charter, i) => {
      out2.push(
        offer2(
          t("action.charter", { charter: charterName(charter), price: charterPrice(charter) }),
          { kind: "act", verb: "charter", target: CHARTER_TARGET + i },
          open,
          t("why.charter.late", { hull: derelictName(currentDerelict(game).spec) })
        )
      );
    });
    return out2;
  }
  if (verb2 === "jump") {
    const next = voyage.derelicts[voyage.current + 1];
    if (next) {
      const here3 = currentDerelict(game);
      const sale = here3.deal === "split" ? Math.floor(here3.spec.salePrice / 2) : here3.spec.salePrice;
      out2.push(
        offer2(
          here3.sold || here3.online.length === 0 ? t("action.jump", { hull: derelictName(next), price: JUMP_PRICE }) : t("action.jump.drop", { up: here3.online.length, of: OBJECTIVE_COUNT, cr: sale }),
          { kind: "act", verb: "jump" },
          voyage.credits >= JUMP_PRICE,
          t(NOT_ENOUGH)
        )
      );
    }
    return out2;
  }
  if (verb2 === "order") return shelfOffers(game, voyage, rig);
  if (voyage.hull === void 0) return out2;
  if (verb2 === "undock") {
    const state = currentDerelict(game);
    const hull3 = flavourCallsign(state.flavour);
    const left = castOffLeft(voyage, rig);
    out2.push(
      offer2(
        left.length === 0 ? t("action.undock", { hull: hull3 }) : t("action.undock.todo", { left: left.join(", ") }),
        { kind: "act", verb: "undock" },
        !state.sold,
        t("why.undock.tow", { hull: hull3 })
      )
    );
    return out2;
  }
  if (!rig) return out2;
  const sick = infectedSlot(game);
  if (verb2 === "repair") {
    damaged(rig).forEach(({ slot, i }) => {
      const price = repairPrice(slot);
      const relic = isRelic(slot.kind);
      out2.push(
        offer2(
          t("action.repair", {
            module: moduleName(slot.kind),
            left: slot.integrity,
            max: capOf(slot),
            price
          }),
          { kind: "act", verb: "repair", slot: i },
          !relic && affordable(game, price),
          relic ? t("why.relic.noRepair", { module: moduleName(slot.kind) }) : whyNot(game, price)
        )
      );
    });
    return out2;
  }
  if (verb2 === "clean") {
    const module = sick === void 0 ? void 0 : rig.slots[sick];
    if (sick !== void 0 && module) {
      out2.push(
        offer2(
          t("action.clean", { module: moduleName(module.kind), price: BENCH_CURE_PRICE }),
          { kind: "act", verb: "clean", slot: sick },
          affordable(game, BENCH_CURE_PRICE),
          whyNot(game, BENCH_CURE_PRICE)
        )
      );
    }
    return out2;
  }
  if (verb2 === "graft") {
    rig.slots.forEach((slot, i) => {
      if (!slot || !canGraft(slot)) return;
      const relic = isRelic(slot.kind);
      out2.push(
        offer2(
          // What grafting gives rather than what the module is worth today: at
          // the bench the decision is about the ceiling, since wear is mended
          // for 4 CR and comes back next sortie while a point of base never
          // does.
          t("action.graft", { module: moduleName(slot.kind), price: GRAFT_PRICE }),
          { kind: "act", verb: "graft", slot: i },
          !relic && affordable(game, GRAFT_PRICE),
          relic ? t("why.relic.noRepair", { module: moduleName(slot.kind) }) : whyNot(game, GRAFT_PRICE)
        )
      );
    });
    return out2;
  }
  if (verb2 === "stow") {
    const last = fullSlots(rig) <= 1;
    const room = voyage.hold.length < HOLD_LIMIT;
    rig.slots.forEach((slot, i) => {
      if (!slot) return;
      out2.push(
        offer2(
          t("action.stow", { module: moduleName(slot.kind), left: slot.integrity, max: capOf(slot) }),
          { kind: "act", verb: "stow", slot: i },
          room && !last,
          last ? t("why.rig.last") : t("why.hold.full", { n: HOLD_LIMIT })
        )
      );
    });
    return out2;
  }
  if (verb2 === "fit") {
    voyage.hold.forEach((held, i) => {
      out2.push(
        offer2(
          t("action.fit", { module: moduleName(held.kind), integrity: held.integrity, max: capOf(held) }),
          { kind: "act", verb: "fit", target: HOLD_TARGET + i },
          rig.slots.some((s) => s === null),
          t("why.rack.full")
        )
      );
    });
    return out2;
  }
  if (verb2 === "sell") {
    rig.slots.forEach((slot, i) => {
      if (!slot) return;
      out2.push(
        offer2(
          t("action.sell", {
            module: moduleName(slot.kind),
            left: slot.integrity,
            max: capOf(slot),
            price: sellPrice(slot, sick === i)
          }),
          { kind: "act", verb: "sell", slot: i },
          true
        )
      );
    });
  }
  return out2;
}
function offer2(label3, cmd, enabled, why) {
  const out2 = { label: label3, cmd, enabled };
  if (!enabled && why !== void 0) out2.why = why;
  return out2;
}
function damaged(rig) {
  return rig.slots.flatMap((slot, i) => slot && slot.integrity < capOf(slot) ? [{ slot, i }] : []).sort((a, b) => a.slot.integrity - b.slot.integrity || a.i - b.i);
}
var VOYAGE = {
  name: "voyage",
  /**
   * Where a departure leads, and when a run is over. Both belong to whoever
   * owns the account: getting out of a derelict is worth what it is worth, and
   * a drone is only lost for good once there is nothing left to buy another.
   */
  claimsOutcome: true,
  onRunStart(game) {
    const voyage = voyageOf(game);
    const hull3 = hullKind(voyage.hull ?? STARTING_HULL.id) ?? STARTING_HULL;
    fitHull(game, hull3, true);
    const state = voyage.state[voyage.current];
    if (state && !isTug(game)) game.currentShip.data.derelict = state.spec.id;
    game.log.add(tugOpening(), game.schedule.time, "warn", TUG_OPENING_KEY);
    game.log.add(
      voyageOpening(tugCallsign(game.seed), voyage.derelicts.length),
      game.schedule.time,
      "plain",
      "log.opening.voyage"
    );
    dock(game);
    hint(game, "mouse");
  },
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act") return void 0;
    if (cmd.verb === "take") return take(game, cmd.target);
    if (cmd.verb === "upload") return upload2(game, cmd.target);
    if (!isStationVerb(cmd.verb)) return void 0;
    if (!isTug(game)) return FAIL7(t("why.tug.only"));
    switch (cmd.verb) {
      case "buy": {
        const hull3 = HULLS[(cmd.target ?? HULL_TARGET) - HULL_TARGET];
        return hull3 ? buyHull(game, hull3.id) : FAIL7(t("why.hull.none"));
      }
      case "repair":
        return repair2(game, cmd.slot ?? -1);
      case "graft":
        return graft2(game, cmd.slot ?? -1);
      case "clean":
        return clean(game, cmd.slot ?? -1);
      case "sell":
        return sellSlot(game, cmd.slot ?? -1);
      case "stow":
        return stowSlot(game, cmd.slot ?? -1);
      case "order":
        return buyModule(game, (cmd.target ?? STOCK_TARGET) - STOCK_TARGET);
      case "fit":
        return fitFromHold(game, (cmd.target ?? HOLD_TARGET) - HOLD_TARGET);
      case "undock":
        return undock(game);
      case "jump":
        return jump(game);
      case "charter":
        return takeCharter(game, (cmd.target ?? CHARTER_TARGET) - CHARTER_TARGET);
    }
  },
  /**
   * The airlock, on both sides of it. Out of a derelict it ends a sortie; out
   * of the tug it starts one, which is what `undock` is — so the key that says
   * "leave" means the same thing wherever the drone is standing.
   */
  beforeLevelLeave(game, _depth, reason) {
    if (reason !== "airlock" || game.status !== "playing") return;
    if (isTug(game)) {
      undock(game);
      return;
    }
    comeHome(game);
  },
  /** A drone dying is not the run ending. Being unable to buy another one is. */
  onDeath(game, victim) {
    if (victim.id !== game.player.id || game.status !== "playing") return;
    loseDrone(game);
  },
  /**
   * An upload has to be five turns *in a row*: anything else the drone does
   * drops it where it stands, the way a splice is broken off
   * (`systems/ship.ts`). The count lives on the console, so a broken-off upload
   * survives leaving the ship as what it is — nothing.
   */
  afterPlayerTurn(game, cmd) {
    for (const console2 of openUploads(game)) {
      if (cmd.kind === "act" && cmd.verb === "upload" && (cmd.target ?? console2.id) === console2.id) continue;
      delete console2.turns;
      game.log.add(t("log.console.away"), game.schedule.time, "warn", "log.console.away");
    }
    endIfBroke(game);
    warnBeforeJump(game);
  },
  offerActions(game) {
    if (game.status !== "playing") return [];
    if (isTug(game)) return stationOffers(game);
    const room = game.roomOf(game.player);
    const offers = [];
    for (const crate of roomList(room, "crates")) {
      offers.push(
        offer2(
          t("action.take", { crate: crateName(crate), cr: cratePrice(crate) }),
          { kind: "act", verb: "take", target: crate.id },
          true
        )
      );
    }
    for (const item of itemsIn2(room, "charter-item")) {
      if (item.taken) continue;
      offers.push(offer2(t("action.takeMarked"), { kind: "act", verb: "take", target: item.id }, true));
    }
    for (const item of itemsIn2(room, "console")) {
      if (item.uploaded) continue;
      const left = UPLOAD_TURNS - (item.turns ?? 0);
      offers.push(
        offer2(
          t("action.upload", { left }),
          { kind: "act", verb: "upload", target: item.id },
          true
        )
      );
    }
    return offers;
  },
  panelLines(game) {
    const voyage = voyageOf(game);
    const lines = [{ text: t("panel.credits", { n: voyage.credits }) }];
    if (voyage.loot > 0) lines.push({ text: t("panel.hold", { n: voyage.loot }) });
    if (voyage.hull === void 0) {
      lines.push({ text: t("panel.droneLost") });
      lines.push({ text: t("panel.cheapest", { n: CHEAPEST_HULL.price }) });
    }
    if (isTug(game)) {
      for (const charter of voyage.charters) {
        if (charter.id === "neutralize") continue;
        const mark = charterDone(game, charter) ? "\u2713" : "\xB7";
        lines.push({ text: `${mark} ${charterName(charter)}` });
      }
    }
    return lines;
  }
};
function isStationVerb(verb2) {
  return verb2 === "buy" || verb2 === "repair" || verb2 === "graft" || verb2 === "clean" || verb2 === "sell" || verb2 === "stow" || verb2 === "fit" || verb2 === "order" || verb2 === "undock" || verb2 === "jump" || verb2 === "charter";
}
function voyageProgress(game) {
  let seen = 0;
  for (const id of game.ships.ids()) {
    if (id === TUG_ID) continue;
    seen += game.ships.get(id)?.ship.rooms.filter((r) => r.explored).length ?? 0;
  }
  return seen;
}
function voyageMetrics(game) {
  const voyage = voyageOf(game);
  return {
    credits: voyage.credits,
    shipsSold: voyage.state.filter((s) => s.sold).length,
    dronesLost: voyage.state.reduce((n, s) => n + s.deaths.length, 0),
    sortie: voyage.sortie
  };
}

// ../../../smoreg_works/games/salvor/src/systems/rival.ts
var WORK_TURNS = 30;
var FLEE_HP = 3;
var EVAC_TURNS = 20;
var MIN_SPAWN_DOORS2 = 3;
var LOOT_MODULES = 2;
var LOOT_INTEGRITY = [2, 3];
var DEAL_PRICE = 100;
var DEAL_ALERT = 2;
var DEALS = ["paid", "sold", "split"];
var DEAL_TARGET = 2300;
var BAD_FG4 = "#d96a6a";
var NAME = "rival drone";
var NOT_ENOUGH2 = "why.credits";
var SPENT = "why.rival.spent";
var FAIL8 = (reason) => ({ ok: false, cost: 0, reason });
var DONE8 = () => ({ ok: true, cost: TURN_COST });
var ABOARD_KEY = "log.rival.aboard";
var GONE_KEY = "log.rival.gone";
var LOST_KEY2 = "log.rival.lost";
var JUMPED_KEY = "log.rival.jumped";
function startRival(game, enabled = true) {
  const fresh2 = { enabled, progress: 0, alive: false, taken: [], rolls: 0 };
  game.currentShip.data.rival = fresh2;
  return fresh2;
}
var RIVAL_CHANCE = 0.25;
function wanted(game) {
  const spec2 = specOfShip(game.ship);
  if (!spec2) return false;
  return spec2.rival || new Rng(game.currentShip.scheduleSeed).fork(0).chance(RIVAL_CHANCE);
}
function rivalKind() {
  return {
    id: "rival-drone",
    name: NAME,
    ch: "r",
    // Another tug's paint: the one amber thing aboard, so it is never misread
    // as one of the ship's own machines.
    fg: "#d9a441",
    hp: 7,
    damage: [1, 3, 0],
    defense: 0,
    speed: 110,
    fovRadius: 8,
    behaviour: "hunter",
    sight: 1,
    breacher: true,
    minDepth: 0,
    maxDepth: 99,
    weight: 0
  };
}
function rivalAboard(game) {
  return game.entities.find((e) => e.name === NAME && isAlive(e));
}
function rivalRng(game, st) {
  const rolls = st.rolls ?? 0;
  st.rolls = rolls + 1;
  return new Rng(game.currentShip.scheduleSeed).fork(rolls);
}
function breachFilter(ship) {
  return (d) => ship.passable(d, { breacher: true });
}
function spawn2(game, st) {
  const rng = rivalRng(game, st);
  const room = pickSpawnRoom2(game, rng);
  if (room === void 0) return;
  const self = spawnMonsterIn(rivalKind(), room);
  self.data = { loot: pickLoot(rng), work: 0, lastHp: self.hp };
  notePost(self);
  game.schedule.admit(self);
  game.entities.push(self);
  st.alive = true;
  point(game, st, self);
  game.log.add(t(ABOARD_KEY), game.schedule.time, "warn", ABOARD_KEY);
}
function pickSpawnRoom2(game, rng) {
  const ship = game.ship;
  const map = RoomDistance.from(ship, [ship.entry], breachFilter(ship));
  const open = ship.rooms.filter((r) => hostilesIn(game, r.id).length < CROWD);
  const deep = open.filter((r) => Number.isFinite(map.at(r.id)) && map.at(r.id) >= MIN_SPAWN_DOORS2);
  if (deep.length > 0) return rng.pick(deep).id;
  let best = 0;
  let rooms = [];
  for (const room of open) {
    const d = map.at(room.id);
    if (!Number.isFinite(d) || d <= 0) continue;
    if (d > best) {
      best = d;
      rooms = [room.id];
    } else if (d === best) {
      rooms.push(room.id);
    }
  }
  return rooms.length > 0 ? rng.pick(rooms) : void 0;
}
var MODULE_IDS = Object.keys(MODULES);
function spentCharges(kind) {
  const full = MODULES[kind].charges;
  return full === void 0 ? void 0 : Math.floor(full / 2);
}
function pickLoot(rng) {
  const loot = [];
  for (let i = 0; i < LOOT_MODULES; i++) loot.push(rng.pick(MODULE_IDS));
  return loot;
}
function nextSystem(game, st, self) {
  const here3 = self.room;
  if (here3 === void 0) return void 0;
  const taken = st.taken ?? [];
  const map = RoomDistance.from(game.ship, [here3], breachFilter(game.ship));
  let best;
  let bestDistance = Infinity;
  for (const room of game.ship.rooms) {
    const d = map.at(room.id);
    if (!Number.isFinite(d) || d >= bestDistance) continue;
    const system = roomList(room, "systems").find((s) => !s.online && !taken.includes(s.id));
    if (!system) continue;
    best = { system, room: room.id };
    bestDistance = d;
  }
  return best;
}
function point(game, st, self) {
  const errand = nextSystem(game, st, self);
  rememberRoom(self, errand ? errand.room : game.ship.entry);
  return errand;
}
function steer(game, st, self) {
  self.searchTurns = void 0;
  const here3 = self.room;
  if (here3 === void 0) return;
  if (self.hp <= FLEE_HP) {
    if (here3 === game.ship.entry) {
      depart(game, st, self);
      return;
    }
    work(self, 0);
    rememberRoom(self, game.ship.entry);
    return;
  }
  const errand = point(game, st, self);
  if (!errand || here3 !== errand.room) {
    work(self, 0);
    return;
  }
  const done = work(self) + 1;
  if (done < WORK_TURNS) {
    work(self, done);
    return;
  }
  takeSystem(game, st, self, errand.system);
}
function takeSystem(game, st, self, system) {
  work(self, 0);
  const spec2 = objectiveSpec(system.kind);
  if (dealOf(game) === "split" && spec2 !== void 0) {
    raiseFor(game, system, spec2);
    point(game, st, self);
    return;
  }
  (st.taken ??= []).push(system.id);
  game.log.add(
    t("log.rival.system", { system: spec2 === void 0 ? t("word.system") : objectiveName(spec2) }),
    game.schedule.time,
    "bad",
    "log.rival.system"
  );
  const before = st.progress;
  st.progress = Math.min(OBJECTIVE_COUNT, st.progress + 1);
  if (st.progress > before && st.progress >= OBJECTIVE_COUNT) loseTheShip(game, st);
  point(game, st, self);
}
function depart(game, st, self) {
  st.alive = false;
  game.entities = game.entities.filter((e) => e.id !== self.id);
  game.log.add(t(GONE_KEY), game.schedule.time, "good", GONE_KEY);
}
function lootOf(self) {
  const raw2 = self.data?.loot;
  if (!Array.isArray(raw2)) return [];
  return raw2.filter((x) => typeof x === "string" && x in MODULES);
}
function work(self, set) {
  const data = self.data ??= {};
  if (set !== void 0) data.work = set;
  return typeof data.work === "number" ? data.work : 0;
}
function dropOne(game, self) {
  const loot = lootOf(self);
  const kind = loot.shift();
  if (kind === void 0 || self.room === void 0) return;
  (self.data ??= {}).loot = loot;
  drop(game, self.room, kind);
}
function dropAll(game, self) {
  const loot = lootOf(self);
  if (self.room === void 0) return;
  (self.data ??= {}).loot = [];
  for (const kind of loot) drop(game, self.room, kind);
}
function drop(game, room, kind) {
  const st = rivalState(game);
  const wreck = addWreck(
    game,
    room,
    kind,
    rivalRng(game, st).int(LOOT_INTEGRITY[0], LOOT_INTEGRITY[1]),
    "%",
    spentCharges(kind)
  );
  wreck.source = "rival";
  const module = moduleName(kind).toLowerCase();
  game.log.add(
    t("log.rival.drops", { article: article(module), module }),
    game.schedule.time,
    "good",
    "log.rival.drops"
  );
}
function article(word) {
  return "aeiou".includes(word[0] ?? "") ? "an" : "a";
}
function robbed(game, self) {
  const data = self.data ??= {};
  const seen = typeof data.lastHp === "number" ? data.lastHp : self.hp;
  if (self.hp < seen && dealOf(game) === void 0) dropOne(game, self);
  data.lastHp = self.hp;
}
function dealOf(game) {
  return derelictAboard(game)?.deal;
}
function across(game) {
  if (game.status !== "playing") return void 0;
  const st = rivalState(game);
  if (!st.enabled) return void 0;
  const self = rivalAboard(game);
  if (!self || self.room === void 0 || self.room !== game.player.room) return void 0;
  const state = derelictAboard(game);
  if (!state || state.deal !== void 0) return void 0;
  return { self, st, state };
}
function bargainOffers(game) {
  const met = across(game);
  if (!met) return [];
  const errand = nextSystem(game, met.st, met.self);
  return [
    deal(0, t("action.rival.payoff", { price: DEAL_PRICE }), creditsOf(game) >= DEAL_PRICE, t(NOT_ENOUGH2)),
    deal(1, t("action.rival.aside", { price: DEAL_PRICE }), errand !== void 0, t(SPENT)),
    deal(2, t("action.rival.split"), true)
  ];
}
function deal(i, label3, enabled, why) {
  const offer3 = {
    label: label3,
    cmd: { kind: "act", verb: "bargain", target: DEAL_TARGET + i },
    enabled
  };
  if (!enabled && why !== void 0) offer3.why = why;
  return offer3;
}
function strike(game, target) {
  const wanted2 = DEALS[(target ?? DEAL_TARGET) - DEAL_TARGET];
  if (wanted2 === void 0) return FAIL8(t("why.line.none"));
  const met = across(game);
  if (!met) return FAIL8(t(dealOf(game) === void 0 ? "why.rival.notHere" : "why.rival.dealt"));
  switch (wanted2) {
    case "paid":
      return payOff(game, met);
    case "sold":
      return standAside(game, met);
    case "split":
      return splitTheSale(game, met);
  }
}
function payOff(game, met) {
  if (!spend(game, DEAL_PRICE)) return FAIL8(t(NOT_ENOUGH2));
  dropAll(game, met.self);
  met.state.deal = "paid";
  game.log.add(t("log.rival.deal.paid"), game.schedule.time, "good", "log.rival.deal.paid");
  depart(game, met.st, met.self);
  return DONE8();
}
function standAside(game, met) {
  const errand = nextSystem(game, met.st, met.self);
  const spec2 = errand ? objectiveSpec(errand.system.kind) : void 0;
  if (!errand || !spec2) return FAIL8(t(SPENT));
  met.state.deal = "sold";
  credit(game, DEAL_PRICE, t("log.rival.deal.sold"), "log.rival.deal.sold");
  raiseFor(game, errand.system, spec2);
  point(game, met.st, met.self);
  return DONE8();
}
function splitTheSale(game, met) {
  met.state.deal = "split";
  game.log.add(t("log.rival.deal.split"), game.schedule.time, "good", "log.rival.deal.split");
  point(game, met.st, met.self);
  return DONE8();
}
function raiseFor(game, system, spec2) {
  system.online = true;
  const online = shipState(game).online;
  if (!online.includes(spec2.id)) online.push(spec2.id);
  raiseAlert(game, DEAL_ALERT);
  game.log.add(
    t("log.rival.raises", { system: objectiveName(spec2) }),
    game.schedule.time,
    "good",
    "log.rival.raises"
  );
}
registerDamageVeto((game, source) => source?.name === NAME && dealOf(game) !== void 0);
function dealWord(deal2) {
  return deal2 === "paid" ? t("word.deal.paid") : deal2 === "sold" ? t("word.deal.sold") : t("word.deal.split");
}
function loseTheShip(game, st) {
  if (dealOf(game) !== void 0) return;
  st.evac = EVAC_TURNS;
  game.log.add(t(LOST_KEY2), game.schedule.time, "bad", LOST_KEY2);
}
function tickEvac(game, st) {
  if (st.evac === void 0 || st.evac <= 0) return;
  st.evac--;
  if (st.evac > 0) return;
  game.player.hp = 0;
  game.player.alive = false;
  game.log.add(t(JUMPED_KEY), game.schedule.time, "bad", JUMPED_KEY);
  game.onDeath(game.player);
}
var RIVAL = {
  name: "rival",
  /**
   * The other tug's drone is put aboard once per sortie, and what it did while
   * nobody was watching is one more system (design-doc.md, "Персистентный
   * дереликт"): the pressure is the same whether the last one was killed,
   * driven off, or simply left alone.
   */
  onLevelEnter(game) {
    const st = game.currentShip.data.rival === void 0 ? startRival(game, wanted(game)) : rivalState(game);
    if (!st.enabled) return;
    if (game.currentShip.visits > 1) st.progress = Math.min(OBJECTIVE_COUNT, st.progress + 1);
    if (!rivalAboard(game)) spawn2(game, st);
    if (st.progress >= OBJECTIVE_COUNT) loseTheShip(game, st);
  },
  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    const st = rivalState(game);
    if (!st.enabled) return;
    const self = rivalAboard(game);
    if (self) robbed(game, self);
    tickEvac(game, st);
  },
  afterActorTurn(game, actor) {
    if (game.status !== "playing" || actor.name !== NAME || !isAlive(actor)) return;
    const st = rivalState(game);
    if (!st.enabled) return;
    steer(game, st, actor);
  },
  /** The bargain, as three lines of the compartment's own list (G34). */
  offerActions(game) {
    return bargainOffers(game);
  },
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== "bargain") return void 0;
    return strike(game, cmd.target);
  },
  /**
   * Killed outright: everything it carried stays on this deck — unless a deal
   * was struck over it, in which case there is nothing left to shake out
   * (`robbed`). Killing the drone you paid is still allowed; it just pays
   * nothing.
   */
  onDeath(game, victim) {
    if (victim.name !== NAME) return;
    if (dealOf(game) === void 0) dropAll(game, victim);
    rivalState(game).alive = false;
  },
  panelLines(game) {
    const st = rivalState(game);
    if (!st.enabled) return [];
    const progress = Math.min(OBJECTIVE_COUNT, Math.max(0, st.progress));
    const gauge = "\u25AE".repeat(progress) + "\u25AF".repeat(OBJECTIVE_COUNT - progress);
    const bar = t("panel.rival", { gauge });
    const lines = [{ text: bar }];
    const struck = dealOf(game);
    if (struck !== void 0) lines.push({ text: t("panel.deal", { deal: dealWord(struck) }) });
    if (st.evac !== void 0) lines.push({ text: t("panel.evac", { n: st.evac }), fg: BAD_FG4 });
    return lines;
  }
};

// ../../../smoreg_works/games/salvor/src/systems/codex.ts
function record(game) {
  const data = game.player.data;
  if (data === void 0) return { seen: [], unread: [] };
  const raw2 = data.codex;
  if (isRecord3(raw2)) return raw2;
  const fresh2 = { seen: [], unread: [] };
  data.codex = fresh2;
  return fresh2;
}
function isRecord3(raw2) {
  if (typeof raw2 !== "object" || raw2 === null) return false;
  const r = raw2;
  return Array.isArray(r.seen) && Array.isArray(r.unread);
}
function noticeCodex(game, id) {
  const card2 = codexFor(id);
  if (card2 === void 0) return false;
  const known2 = record(game);
  if (known2.seen.includes(card2.id)) return false;
  known2.seen.push(card2.id);
  known2.unread.push(card2.id);
  return true;
}
function seenCodex(game) {
  return [...record(game).seen];
}
function codexUnread(game) {
  return record(game).unread.length;
}
function alarmCodexId(game) {
  const id = signThisTurn(game);
  return id !== void 0 && codexFor(id) !== void 0 ? id : void 0;
}
function watch(game) {
  noticeAlert(game);
  noticeVented(game);
  noticeVirus(game);
  noticeRelics(game);
  noticeContacts(game);
  noticeCodex(game, alarmCodexId(game));
}
function noticeAlert(game) {
  const level = alertState(game).level;
  if (level > 0) noticeCodex(game, alertCodexId(level));
}
function noticeVented(game) {
  const vented = game.ship.rooms.some((r) => r.hazard === "vented" && (r.explored || r.scanned));
  if (vented) noticeCodex(game, "vented");
}
function noticeVirus(game) {
  const virus = virusOf(game.player);
  if (virus === void 0) return;
  noticeCodex(game, virus.strain ?? "spasm");
}
function noticeRelics(game) {
  const rig = rigOf(game.player);
  if (rig === void 0) return;
  for (const slot of rig.slots) {
    if (slot !== null && isRelic(slot.kind)) noticeCodex(game, slot.kind);
  }
}
function noticeContacts(game) {
  const here3 = game.roomOf(game.player).id;
  const rival = rivalKind().name;
  for (const e of game.entities) {
    if (e.room !== here3 || e.id === game.player.id) continue;
    if (e.faction === game.player.faction) continue;
    noticeCodex(game, contactCodexId(e, rival));
  }
}
function contactCodexId(e, rivalName) {
  if (e.name === GHOST_NAME) return "ghost";
  if (e.name === rivalName) return "rival";
  return machineByName(e.name)?.id;
}
var CODEX_SYSTEM = {
  name: "codex",
  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    watch(game);
  }
};

// ../../../smoreg_works/games/salvor/src/systems/contacts.ts
var NOWHERE = -1;
function contactState(game) {
  const data = game.currentShip.data;
  const raw2 = data.contacts;
  if (typeof raw2 === "object" && raw2 !== null && typeof raw2.at === "number") {
    return raw2;
  }
  const fresh2 = { at: NOWHERE };
  data.contacts = fresh2;
  return fresh2;
}
var CONTACTS = {
  name: "contacts",
  /**
   * Boarding is walking in. A derelict the drone has been aboard before keeps
   * its own record of everything else, and the compartment it was standing in
   * when it cycled out is usually the one it comes back to — without this, the
   * second sortie into a hull with something waiting at the airlock would be
   * the one sortie that says nothing.
   */
  onLevelEnter(game) {
    contactState(game).at = NOWHERE;
  },
  /**
   * Only on a change of compartment, and only when something living is in the
   * new one. Standing still says nothing however long the drone stands there:
   * the machine is on the panel for exactly as long as it is in the room, and a
   * line repeated every turn is a line that stops being read — which is the
   * defect this was written for, not a fix for it.
   */
  afterPlayerTurn(game) {
    if (game.status !== "playing") return;
    const state = contactState(game);
    const room = game.roomOf(game.player).id;
    if (room === state.at) return;
    state.at = room;
    const line2 = contactsWarning(game);
    if (line2 !== void 0) game.log.add(line2, game.schedule.time, "warn", "log.contacts.here");
  }
};
function contactsWarning(game) {
  const machines = hostilesIn(game, game.roomOf(game.player).id);
  if (machines.length === 0) return void 0;
  const list = machines.map(
    (m) => t("log.contacts.one", {
      machine: machineName(m.name),
      hp: `${m.hp}/${m.hpMax}`,
      danger: dangerWord(m)
    })
  ).join("; ");
  return t("log.contacts.here", { list });
}
function dangerWord(machine, throughDoor = false) {
  if (throughDoor && (machine.range ?? 0) >= 1) return t("danger.door");
  if (machine.behaviour === "hunter") return t("danger.hunter");
  if (machine.name === JAMMER.name) return t("danger.jam");
  if (machine.tags?.includes("corrosive") === true) return t("danger.noScrap");
  if ((machine.range ?? 0) >= 1) return t("danger.door");
  const [count, sides, flat] = machine.damage;
  if (count * sides + flat <= 0) return t("danger.still");
  return t("danger.melee");
}

// ../../../smoreg_works/games/salvor/src/systems/ship.ts
var ALERT_PER_SYSTEM = 2;
var CELL_COST2 = 1;
var BROKEN_OFF_KEY = "log.work.break.splice";
var FAIL9 = (reason) => ({ ok: false, cost: 0, reason });
var DONE9 = () => ({ ok: true, cost: TURN_COST });
function systemsAboard(game) {
  return game.ship.rooms.flatMap((room) => [...roomList(room, "systems")]);
}
function systemHere(game, target) {
  const here3 = roomList(game.roomOf(game.player), "systems");
  return target === void 0 ? here3[0] : here3.find((s) => s.id === target);
}
function spendKey(game) {
  const data = game.player.data ??= {};
  data.keys = Math.max(0, keysHeld2(game.player) - 1);
}
function spendCell2(game) {
  const rig = rigOf(game.player);
  const slot = rig ? findSlot(rig, "cell") : null;
  if (!rig || slot === null) return;
  rig.exposed = slot;
  for (const hit of routeDamage(rig, CELL_COST2, ["corrosive"]).hits) {
    if (hit.burned) game.log.add(moduleBurnLine(hit.kind), game.schedule.time, "bad", "log.module.burn");
  }
  applyDerived(game.player);
}
function systemHack(game, system, spec2, job) {
  const state = shipState(game);
  const started = () => state.work?.id === system.id && state.work.tool === job.tool ? state.work : void 0;
  return {
    name: objectiveName(spec2).toLowerCase(),
    expose: toolExposes(job.tool),
    get turnsLeft() {
      return started()?.left ?? job.turns;
    },
    set turnsLeft(left) {
      state.work = { id: system.id, left, tool: job.tool };
    },
    breach(g) {
      raise2(g, system, spec2, job.tool);
    }
  };
}
function raise2(game, system, spec2, tool) {
  const state = shipState(game);
  if (state.online.includes(spec2.id)) return;
  system.online = true;
  state.online.push(spec2.id);
  if (tool === "cell") spendCell2(game);
  game.log.add(objectiveOnlineLine(spec2), game.schedule.time, "good", "log.system.online");
  if (state.online.length >= OBJECTIVE_COUNT) standDown(game);
  raiseAlert(game, ALERT_PER_SYSTEM);
  credit(game, spec2.advance, t("log.system.advance"), "log.system.advance");
  sayNeutralised(game, state);
}
function sayNeutralised(game, state) {
  if (state.online.length < OBJECTIVE_COUNT) return;
  const price = derelictAboard(game)?.spec.salePrice ?? 0;
  const line2 = price > 0 ? t("log.system.all.paid", { cr: price }) : t("log.system.all");
  game.log.add(line2, game.schedule.time, "good", "log.system.all");
}
function work2(game, target) {
  const system = systemHere(game, target);
  const spec2 = system ? objectiveSpec(system.kind) : void 0;
  if (!system || !spec2) return FAIL9(t("why.system.none"));
  const state = shipState(game);
  if (state.online.includes(spec2.id)) return FAIL9(t("why.system.up", { system: objectiveName(spec2) }));
  const job = spec2.needs(rigOf(game.player), keysHeld2(game.player));
  if (!job) return FAIL9(needsLine(spec2));
  const resumed = state.work?.id === system.id && state.work.tool === job.tool;
  if (!resumed && job.tool === "key") spendKey(game);
  const hack = systemHack(game, system, spec2, job);
  const left = (resumed ? state.work.left : job.turns) - 1;
  hack.turnsLeft = left;
  const room = game.roomOf(game.player);
  game.makeNoise(room.id, job.noise);
  if (left > 0) {
    game.log.add(
      t("log.system.work", { tool: toolName(job.tool), system: objectiveName(spec2), left }),
      game.schedule.time,
      "plain",
      "log.system.work"
    );
    return DONE9();
  }
  hack.breach(game);
  return DONE9();
}
registerHackTarget((game, target) => {
  const system = systemHere(game, target);
  const spec2 = system ? objectiveSpec(system.kind) : void 0;
  if (!system || !spec2) return void 0;
  const state = shipState(game);
  const tool = state.work?.id === system.id ? state.work.tool : void 0;
  const job = jobWith(spec2, tool) ?? spec2.needs(rigOf(game.player), keysHeld2(game.player));
  return job ? systemHack(game, system, spec2, job) : void 0;
});
function jobWith(spec2, tool) {
  return tool === void 0 ? void 0 : spec2.jobs.find((j) => j.tool === tool);
}
function sayTheRules(game) {
  if (turnRoom(game).taken) return;
  if (systemsAboard(game).length > 0 && objectiveHere(game) && hint(game, "objective")) return;
  const carried = game.player.data?.loot;
  if (derelictAboard(game) && typeof carried === "number" && carried > 0) hint(game, "payout");
}
var LIST_WIDTH = 25;
function workLabel(spec2, tool, left) {
  const system = objectiveName(spec2);
  const full = t("action.work", { system, tool: toolName(tool), left });
  return full.length <= LIST_WIDTH ? full : t("action.workBare", { system, left });
}
function objectiveHere(game) {
  const state = shipState(game);
  for (const system of roomList(game.roomOf(game.player), "systems")) {
    const spec2 = objectiveSpec(system.kind);
    if (!spec2 || state.online.includes(spec2.id)) continue;
    const doable = spec2.needs(rigOf(game.player), keysHeld2(game.player));
    const job = doable ?? spec2.jobs[0];
    const started = state.work?.id === system.id && state.work.tool === job.tool;
    return { spec: spec2, job, doable: doable !== void 0, left: started ? state.work.left : job.turns };
  }
  return void 0;
}
var SHIP = {
  name: "ship",
  performCommand(game, actor, cmd) {
    if (actor.id !== game.player.id || cmd.kind !== "act" || cmd.verb !== "work") return void 0;
    return work2(game, cmd.target);
  },
  /**
   * A splice has to be consecutive: any other command drops it where it stands.
   * The finished job is dropped too, silently — it is kept until here so that
   * the rig, which runs first, still reads the tool it was worked with off the
   * record when it marks what the last turn exposed.
   */
  afterPlayerTurn(game, cmd) {
    sayTheRules(game);
    const state = shipState(game);
    const open = state.work;
    if (!open) return;
    if (open.left <= 0) {
      delete state.work;
      return;
    }
    if (cmd.kind === "act" && cmd.verb === "work" && cmd.target === open.id) return;
    delete state.work;
    game.log.add(t(BROKEN_OFF_KEY), game.schedule.time, "warn", BROKEN_OFF_KEY);
  },
  /**
   * A splice does not survive the airlock: a drone that cycles out and back in
   * starts the job again, whichever of the two things a departure turns out to
   * be. Where it leads is `systems/voyage.ts`'s call, made from this same hook
   * one system later.
   */
  beforeLevelLeave(game, _depth, reason) {
    if (reason !== "airlock" || game.status !== "playing") return;
    delete shipState(game).work;
  },
  offerActions(game) {
    const offers = [];
    if (game.status !== "playing") return offers;
    const state = shipState(game);
    const rig = rigOf(game.player);
    const keys = keysHeld2(game.player);
    for (const system of roomList(game.roomOf(game.player), "systems")) {
      const spec2 = objectiveSpec(system.kind);
      if (!spec2 || state.online.includes(spec2.id)) continue;
      const doable = spec2.needs(rig, keys);
      const job = doable ?? spec2.jobs[0];
      const left = state.work?.id === system.id && state.work.tool === job.tool ? state.work.left : job.turns;
      const offer3 = {
        label: workLabel(spec2, job.tool, left),
        cmd: { kind: "act", verb: "work", target: system.id },
        enabled: doable !== void 0
      };
      if (!doable) offer3.why = needsLine(spec2);
      offers.push(offer3);
    }
    return offers;
  }
  // No `panelLines`. What this system is worth saying on the panel is the run's
  // own goal, and where that goes — under the contacts rule, above the rack,
  // never in the tail of the counters — is a layout decision the panel makes
  // for itself (`ui/panel.ts`, `missionBlock`). It reads the two accessors
  // above instead. The line that used to be here, `SHIP  engine · core · term
  // ·`, was four abbreviations and a row of dots, and the owner read two whole
  // derelicts past it without ever finding out what it meant.
};

// ../../../smoreg_works/games/salvor/src/systems/tug.ts
function gatedOffers(game) {
  return game.systems.flatMap((s) => s.offerActions?.(game) ?? []);
}
var TUG = {
  name: "tug",
  /**
   * Nothing lives on the tug.
   *
   * The engine populates every ship it generates (`rooms/game.ts`), and it is
   * right to: it has no way of knowing that this one is the drone's own hull
   * rather than a derelict. Clearing the deck here rather than teaching the
   * content pack about ship ids keeps that knowledge in the one file that has
   * it, and it holds for any machine that ever ends up aboard.
   */
  onLevelEnter(game) {
    if (!isTug(game)) return;
    game.entities = game.entities.filter((e) => e.id === game.player.id);
  }
  // No `offerActions`, no `performCommand` and no `panelLines`. This system
  // offers nothing of its own, refuses nothing that used to be somebody else's
  // compartment, and says nothing on the panel: the stations are one grouped
  // list now (`ui/actions.ts`) and the voyage owns every one of their verbs.
};

// ../../../smoreg_works/games/salvor/src/systems/tutorial.ts
var BOARDED_KEY = "tutorialBoarded";
var TUTORIAL = {
  name: "tutorial",
  /**
   * The boarding turn, remembered per ship, so `turnsAboard` counts from the
   * airlock and not from the start of the voyage. Written on every entry
   * including a second sortie into the same hull: the chain has almost always
   * moved past its first two lines by then, and a second boarding that reset
   * nothing would count the turns of the first one too.
   */
  onLevelEnter(game) {
    if (!isTraining(game.player) || !onTutorialHull(game)) return;
    game.currentShip.data[BOARDED_KEY] = game.schedule.time;
  },
  afterPlayerTurn(game) {
    if (game.status !== "playing" || !isTraining(game.player)) return;
    for (let room = turnRoom(game); room.left > 0; room = turnRoom(game)) {
      const step = stepDue(situation(game), (id) => saidHint(game.player, id), room.taken);
      if (step === void 0) return;
      hint(game, step.id);
    }
  }
};
function onTutorialHull(game) {
  return !isTug(game) && classOfShip(game.ship) === TUTORIAL_ID;
}
function situation(game) {
  const aboard2 = onTutorialHull(game);
  const room = game.roomOf(game.player);
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  const boarded2 = game.currentShip.data[BOARDED_KEY];
  return {
    aboard: aboard2,
    turnsAboard: typeof boarded2 === "number" ? game.schedule.time - boarded2 : 0,
    // Anything alive that is not the drone, standing where the drone can see
    // it: the scout in the docking bay on the turn the sortie walks in on it,
    // and a machine two doors away through an open door just as well.
    //
    // `isAlive` and not just `e.room`: the engine leaves the dead in the entity
    // list — that is what makes a corpse something to salvage — so without it
    // the line about what a fight costs was said over a body the drone had
    // already beaten, in 34 of 120 runs with nothing alive in sight
    // (docs/tasks/G86-tutorial-and-title.md, 2).
    contact: aboard2 && game.entities.some(
      (e) => e.id !== game.player.id && isAlive(e) && e.room !== void 0 && game.visible.has(e.room)
    ),
    // Blows traded this turn, whoever landed them.
    //
    // The machine lesson's other moment, and on the training hull usually its
    // only one: the docking bay hands the drone a scout on the turn it boards —
    // the same turn the chain owes its "here is how you act" line — and the
    // scout is dead by the next player turn, so "something alive in sight" was
    // a window one hook wide that the first line always won. Measured: the
    // lesson about what a fight costs landed before the first blow in 0 of 120
    // careful runs. A fight on the screen is the same subject standing in front
    // of the player, so it counts (docs/tasks/G86-tutorial-and-title.md, 3).
    fighting: aboard2 && tradedBlows(game),
    lockedDoor: aboard2 && game.ship.doorsOf(room.id).some((d) => d.state === "locked"),
    system: aboard2 && roomList(room, "systems").length > 0,
    atAirlock: aboard2 && room.id === game.ship.entry,
    // Something to lose: credits in hand, or work done that only counts once
    // the drone is back out. Both are exactly what the airlock line is about.
    carrying: voyage.loot > 0 || state.online.length > 0,
    // Home: on the tug, with the training hull behind the drone. The chain's
    // own first line is what says the drone has been aboard at all — the flags
    // are the run's memory of the lesson, and a save file round-trips them —
    // so this is true from the first return through the airlock and stays true.
    home: isTug(game) && saidHint(game.player, "tutorial.enter")
  };
}
function tradedBlows(game) {
  const lines = game.log.lines;
  const now = game.schedule.time;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line2 = lines[i];
    if (line2.turn !== now) return false;
    const key3 = line2.key ?? "";
    if (key3.startsWith("engine.hit.") || key3.startsWith("log.hit.")) return true;
  }
  return false;
}

// ../../../smoreg_works/games/salvor/src/game.ts
var SALVOR = {
  name: "SALVOR",
  maxMonsters: MAX_MACHINES,
  makePlayer,
  monstersForDepth: kindsForDepth,
  monsterChance,
  // Read by the engine the moment a run is built and the moment it ends, so
  // they are looked up then rather than at import time: a language chosen from
  // the URL is already set by the time the first of them is asked for.
  get openingLine() {
    return t("log.opening");
  },
  get winLine() {
    return t("log.win");
  },
  get deathLine() {
    return t("log.death");
  }
};
var TRAINING = Object.assign(Object.create(SALVOR), {
  makePlayer: () => markTraining(makePlayer())
});
var GAME_CONFIG = {
  content: SALVOR,
  twist: RIG,
  // Independent mechanics add themselves here, in the order they must run.
  // TUG comes early because it answers first: a station verb pressed in the
  // wrong compartment has to be refused before the voyage charges for it.
  // ALERT runs after the twist so it hears the noise field the BAFFLE muffled,
  // and after POPULATE so between-sortie reinforcements see a populated ship.
  // JAM and BLOOM sit in the middle: neither reads the noise field or the
  // gauge, and both are read by what came before them — the rig asks JAM
  // whether a module answers at all. SHIP counts the systems the drone brought
  // up, and VOYAGE is last because it claims the outcome: what a departure is
  // worth depends on the count SHIP has just finished making, and on the alert
  // and the rack as everything before it left them.
  //
  // GHOST comes after both POPULATE and ALERT: a sortie's dead are answered on
  // a ship that has already been filled and already sent whatever the gauge
  // owed, so the ghost is counted among what is aboard rather than under it.
  //
  // VIRUS goes first of all of them, which means straight after the twist: a
  // twitch overrules what the command exposed, so the rig has to have marked
  // that already — and the alert has to hear the twitch on the turn it happens.
  //
  // RIVAL is after POPULATE, whose first entry is what puts the ship's systems
  // in their compartments — the competitor races for those — and before SHIP,
  // which counts what the drone raised of what is left.
  //
  // CONTACTS is last of all and reads no state but the drone's compartment: the
  // line it writes is "what is standing in here", and it has to be asked after
  // whatever the turn did to where "here" is — VOYAGE can move the drone to a
  // whole other hull from its own `afterPlayerTurn`.
  //
  // TUTORIAL is last of all, after CONTACTS, and only ever says anything in a
  // training run: its lines are about the turn as it finally stands, including
  // the crossing VOYAGE has just made and the hull it has just sold.
  //
  // HAZARD sits after POPULATE, which is what lays the hazards on a hull on
  // its first boarding, and after DOORS, whose welder lifts a mine; it is
  // before ALERT because a mine going off raises the gauge, and the gauge
  // should hear it on the turn it happens.
  //
  // CODEX_SYSTEM is after even that, and it is the one entry here whose order
  // cannot matter to anybody: it writes down what the run has shown the player
  // and changes nothing at all, so it wants the turn as everything else has
  // finally left it and nothing wants it (`systems/codex.ts`, G72).
  systems: [
    VIRUS,
    POPULATE,
    TUG,
    DOORS,
    HAZARD,
    ALERT,
    GHOST2,
    JAM,
    BLOOM,
    RIVAL,
    SHIP,
    VOYAGE,
    CONTACTS,
    TUTORIAL,
    CODEX_SYSTEM
  ],
  // A run starts at home, on the four compartments of the tug, with a drone on
  // the rails and 25 CR. The first derelict is generated the first time
  // something undocks into it (`systems/voyage.ts`), which is what lets the
  // hull be drawn against the flags and the rack the sortie actually carries.
  firstShip: tugShip,
  firstShipId: TUG_ID
};
function newGame(seed, training = false) {
  const game = new RoomGame({ ...GAME_CONFIG, content: training ? TRAINING : SALVOR, seed });
  if (training) startTraining(game);
  return Object.assign(game, {
    progress: () => voyageProgress(game),
    metrics: () => voyageMetrics(game)
  });
}

// ../../../smoreg_works/games/salvor/src/ui/strikers.ts
function rackNames() {
  return Object.keys(MODULES).map(moduleName).sort((a, b) => b.length - a.length);
}
function blowsLastTurn(game) {
  const lines = game.log.lines;
  const last = lines[lines.length - 1]?.turn;
  const names = rackNames();
  const out2 = [];
  for (let i = lines.length - 1; i >= 0 && lines[i].turn === last; i--) {
    const line2 = lines[i];
    if (line2.key !== "log.hit.module") continue;
    const module = names.find((name) => line2.text.includes(name));
    if (module === void 0) continue;
    out2.push({ subject: line2.text.toLowerCase(), what: t("panel.contact.hit", { module }) });
  }
  return out2;
}
function strikersNear(game, here3) {
  const blows = blowsLastTurn(game);
  if (blows.length === 0) return [];
  const out2 = [];
  for (const door of game.ship.doorsOf(here3)) {
    if (door.a === door.b) continue;
    const room = game.ship.other(door, here3);
    if (game.visible.has(room)) continue;
    for (const machine of hostilesIn(game, room)) {
      const name = machineName(machine.name).toLowerCase();
      if (blows.some((b) => b.subject.includes(name))) out2.push({ machine, room, door });
    }
  }
  return out2;
}

// ../../../smoreg_works/games/salvor/src/ui/schematic-input.ts
var CONTENT_KEYS = ["bodies", "crates", "systems", "items"];
var BUCKET_GLYPH = {
  bodies: "\u2020",
  crates: "X",
  systems: "+",
  items: "*"
};
function bucketName(key3, raw2) {
  const rec = raw2;
  const kind = typeof rec?.kind === "string" ? rec.kind : void 0;
  if (key3 === "bodies") return t(rec?.searched === true ? "thing.body.searched" : "thing.body");
  if (key3 === "crates") return t(kind === "contraband" ? "thing.contraband" : "thing.cargo");
  if (key3 === "items") return t(kind === "console" ? "thing.console" : "thing.package");
  return t("thing.system");
}
function schematicInputOf(game, alarm = NO_ALARM, target) {
  const docked = dockedHull(game);
  const input = docked ? remoteInput(docked.ship, docked.data) : aboardInput(game, alarm);
  if (target === void 0) return input;
  return {
    ...input,
    rooms: input.rooms.map((room) => room.id === target ? { ...room, target: true } : room)
  };
}
var NO_ALARM = /* @__PURE__ */ new Set();
var NO_DOORS = /* @__PURE__ */ new Set();
function aboardInput(game, alarm) {
  const here3 = game.player.room;
  const struck = new Set(
    here3 === void 0 ? [] : strikersNear(game, here3).map((s) => s.room)
  );
  const data = game.currentShip.data;
  const named2 = signsNamed(game, here3);
  const rooms = game.ship.rooms.map((room) => {
    const state = stateOf(game, room, here3);
    const drawn2 = box(room, state, thingsOf(game, room, state, data), hostileWidth(game, room, state));
    const lit = alarm.has(room.id) ? { ...drawn2, alarm: true } : drawn2;
    const hit = struck.has(room.id) ? { ...lit, threat: true } : lit;
    return named2.rooms.has(room.id) ? { ...hit, target: true } : hit;
  });
  const line2 = isTug(game) ? tugLine(game) : shipLine(game.ship, game.currentShip.data, rooms);
  return frame(game.ship, rooms, line2, named2.doors);
}
function signsNamed(game, here3) {
  const rooms = /* @__PURE__ */ new Set();
  const doors = /* @__PURE__ */ new Set();
  if (here3 === void 0) return { rooms, doors };
  const ship = game.ship;
  for (const rec of signsFresh(game)) {
    if (rec.door !== void 0) {
      doors.add(rec.door);
      continue;
    }
    if (rec.room === void 0 || rec.room === here3) continue;
    rooms.add(rec.room);
    const door = ship.doorsOf(here3).filter((d) => ship.other(d, here3) === rec.room).sort((a, b) => a.id - b.id)[0];
    if (door) doors.add(door.id);
  }
  return { rooms, doors };
}
function remoteInput(ship, data) {
  const rooms = ship.rooms.map((room) => {
    const state = room.explored ? "explored" : room.scanned ? "scanned" : "unknown";
    return box(room, state, state === "unknown" ? marksOf(ship, room, data) : remembered(ship, room, state, data));
  });
  return frame(ship, rooms, shipLine(ship, data, rooms));
}
function tugLine(game) {
  const parts = [tugCallsign(game.seed), t("ship.yourTug")];
  const docked = derelictNameOf(tagOf(game.currentShip.data, "docked"));
  if (docked) parts.push(t("ship.dockedTo", { hull: docked }));
  return parts.join(" \xB7 ");
}
var BANNER_WIDTH = 62;
function bannerLine(game) {
  const docked = dockedHull(game);
  if (docked) {
    const ship = docked.ship;
    return clipTo(
      t("banner.ahead", {
        hull: named(tagOf(docked.data, "name"), derelictNameOf(tagOf(docked.data, "type"))),
        rooms: t("ship.rooms", { n: ship.rooms.length })
      }),
      BANNER_WIDTH
    );
  }
  if (isTug(game)) {
    const to = hull(
      tagOf(game.currentShip.data, "dockedName"),
      derelictNameOf(tagOf(game.currentShip.data, "docked"))
    );
    return clipTo(t("banner.tug", { callsign: tugCallsign(game.seed), hull: to }), BANNER_WIDTH);
  }
  const parts = [
    named(tag(game, "name"), derelictNameOf(tag(game, "type"))),
    t("ship.rooms", { n: game.ship.rooms.length }),
    alertWord(game)
  ];
  return clipTo(t("banner.derelict", { parts: parts.join(" \xB7 ") }), BANNER_WIDTH);
}
function named(name, type) {
  const parts = [];
  if (name) parts.push(`\xAB${name}\xBB`);
  if (type) parts.push(type);
  return parts.length === 0 ? t("word.unknownHull") : parts.join(" \xB7 ");
}
function hull(name, type) {
  if (!name) return type ?? t("word.unknownHull");
  return type ? `${name} (${type})` : name;
}
function alertWord(game) {
  const level = alertState(game).level;
  return level === 0 ? t("panel.quiet") : t("panel.alertAt", { n: level });
}
function dockedHull(game) {
  if (!isTug(game) || !game.atAirlock()) return void 0;
  const from = game.currentShip.data.from;
  const stored = typeof from === "string" ? game.ships.get(from) : void 0;
  return stored ? { ship: stored.ship, data: stored.data } : void 0;
}
function frame(ship, rooms, caption, lit = NO_DOORS) {
  const ports = portMap(ship);
  const doors = ship.doors.filter((d) => d.a !== d.b).map((d) => {
    const door = {
      id: d.id,
      label: d.label,
      a: d.a,
      b: d.b,
      state: d.state,
      portA: ports.get(portKey(d.a, d.id)) ?? 0,
      portB: ports.get(portKey(d.b, d.id)) ?? 0
    };
    return lit.has(d.id) ? { ...door, target: true } : door;
  });
  const airlock = ship.airlock();
  const input = { rooms, doors, shipLine: caption };
  if (airlock) input.tug = { at: ship.entry, label: airlock.label };
  return input;
}
function box(room, state, things, hostiles = 0) {
  const out2 = {
    id: room.id,
    label: room.label,
    name: roomName(room),
    kind: room.kind,
    col: room.col,
    row: room.row,
    state,
    glyphs: things.map((thing) => thing.glyph).join(" ")
  };
  if (things.length > 0) out2.things = things;
  if (hostiles > 0) out2.hostiles = hostiles;
  return out2;
}
function hostileWidth(game, room, state) {
  if (state !== "current" && state !== "visible") return 0;
  const machines = hostilesIn(game, room.id).length;
  return machines === 0 ? 0 : machines * 2 - 1;
}
function thingsIn(game, room) {
  return thingsOn(game.ship, room, game.currentShip.data);
}
var VENTED_GLYPH = "~";
function thingsOn(ship, room, pocket) {
  const out2 = [];
  if (ship.roomAt(room).hazard === "vented") out2.push({ glyph: VENTED_GLYPH, name: t("word.vented") });
  out2.push(...hazardThings(ship, room, hazardsOf(pocket)));
  out2.push(...wrecksOn(ship, room).map((w) => {
    const kind = moduleKind(w.kind);
    const what = w.glyph === "X" ? t("word.crate") : t("word.scrap");
    return {
      glyph: w.glyph,
      name: `${what} ${moduleName(kind.id)} ${w.integrity}/${kind.integrity}`
    };
  }));
  const data = ship.roomAt(room).data;
  for (const key3 of CONTENT_KEYS) {
    const list = data[key3];
    if (!Array.isArray(list)) continue;
    for (const raw2 of list) {
      const thing = asThing(raw2, BUCKET_GLYPH[key3], bucketName(key3, raw2));
      if (thing) out2.push(thing);
    }
  }
  return out2;
}
function hazardThings(ship, room, records) {
  if (records.length === 0) return [];
  const out2 = [];
  const own = roomHazard(ship, records, room);
  const kind = own === void 0 ? void 0 : hazardKind(own.id);
  if (own && kind && hazardKnown(ship, own)) out2.push({ glyph: kind.glyph, name: t(kind.word) });
  for (const door of ship.doorsOf(room)) {
    const trap = doorHazard(ship, records, door.id);
    const trapKind = trap === void 0 ? void 0 : hazardKind(trap.id);
    if (trap && trapKind && hazardKnown(ship, trap)) {
      out2.push({ glyph: trapKind.glyph, name: t(trapKind.word, { door: door.label }) });
    }
  }
  return out2;
}
function machinesIn(game, room) {
  return game.entitiesIn(room).filter((e) => e.id !== game.player.id && isAlive(e));
}
function stateOf(game, room, here3) {
  if (room.id === here3) return "current";
  if (game.visible.has(room.id)) return "visible";
  if (room.explored) return "explored";
  if (room.scanned) return "scanned";
  return "unknown";
}
function thingsOf(game, room, state, data) {
  if (state === "unknown") return marksOf(game.ship, room, data);
  if (state !== "current" && state !== "visible") return remembered(game.ship, room, state, data);
  const hostile = new Set(hostilesIn(game, room.id).map((m) => m.id));
  const machines = machinesIn(game, room.id).sort((a, b) => Number(hostile.has(b.id)) - Number(hostile.has(a.id))).map(
    (m) => hostile.has(m.id) ? { glyph: m.ch, name: machineName(m.name), hostile: true } : { glyph: m.ch, name: machineName(m.name) }
  );
  return [...machines, ...homeThings(game.ship, room), ...thingsOn(game.ship, room.id, data)];
}
function remembered(ship, room, state, data) {
  const home = homeThings(ship, room);
  const snapshot2 = room.data.snapshot;
  if (state === "scanned" && typeof snapshot2 === "string") {
    const marks = hazardThings(ship, room.id, hazardsOf(data));
    const seen = snapshot2.split(" ").filter((g) => g.length > 0).map((glyph) => ({ glyph, name: glyph }));
    return [...home, ...marks, ...seen];
  }
  return [...home, ...thingsOn(ship, room.id, data)];
}
function marksOf(ship, room, data) {
  return hazardThings(ship, room.id, hazardsOf(data));
}
function homeThings(ship, room) {
  const airlock = ship.doorsOf(room.id).find((d) => d.state === "airlock");
  return airlock ? [{ glyph: airlock.label, name: airlock.label }] : [];
}
function shipLine(ship, data, drawn2) {
  const parts = [tagOf(data, "name") ?? t("word.derelict").toUpperCase()];
  const type = derelictNameOf(tagOf(data, "type"));
  if (type) parts.push(type);
  const scanned = drawn2.filter((r) => r.state === "scanned").length;
  const seen = drawn2.filter((r) => r.state !== "unknown").length - scanned;
  parts.push(t("ship.rooms", { n: ship.rooms.length }), t("ship.seen", { n: seen }));
  if (scanned > 0) parts.push(t("ship.scanned", { n: scanned }));
  return parts.join(" \xB7 ");
}
function tag(game, key3) {
  return tagOf(game.currentShip.data, key3);
}
function tagOf(data, key3) {
  const value = data[key3];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function clipTo(text3, width) {
  if (text3.length <= width) return text3;
  const word = text3.lastIndexOf(" ", width);
  const cut = word > 0 ? text3.slice(0, word) : text3.slice(0, Math.max(0, width));
  return cut.replace(/[\s·:,]+$/, "");
}
var ONLINE_GLYPH = "\u2713";
function asThing(raw2, fallback, called) {
  if (typeof raw2 !== "object" || raw2 === null) return void 0;
  const thing = raw2;
  const own = typeof thing.glyph === "string" && thing.glyph.length > 0 ? thing.glyph[0] : void 0;
  const mark = own ?? fallback;
  if (mark.length === 0) return void 0;
  const glyph = thing.online === true ? ONLINE_GLYPH : mark;
  const name = typeof thing.name === "string" ? thing.name : typeof thing.label === "string" ? thing.label : called;
  return { glyph, name };
}
function portMap(ship) {
  const out2 = /* @__PURE__ */ new Map();
  for (const room of ship.rooms) {
    for (const [, uses] of portsOf(ship, room.id)) {
      [...uses].sort((a, b) => a.dy - b.dy || a.door.id - b.door.id).forEach((use, i) => out2.set(portKey(room.id, use.door.id), i === 0 ? 0 : 1));
    }
  }
  return out2;
}
function portKey(room, door) {
  return `${room}:${door}`;
}

// ../../../smoreg_works/games/salvor/src/ui/auto.ts
function passableForPlayer(door) {
  return door.state === "open" || door.state === "closed" || door.state === "broken";
}
function dangerAhead(game, door) {
  const here3 = game.roomOf(game.player).id;
  if (door.a !== here3 && door.b !== here3) return void 0;
  const ship = game.ship;
  const records = hazardRecords(game);
  const trap = doorHazard(ship, records, door.id);
  if (trap && hazardKnown(ship, trap)) return hazardLine(game, trap, here3, door);
  const beyond = ship.other(door, here3);
  if (beyond === here3) return void 0;
  const rec = roomHazard(ship, records, beyond);
  return rec && hazardKnown(ship, rec) ? hazardLine(game, rec, here3, door) : void 0;
}
function breachable(door) {
  return door.state !== "airlock";
}
function travelRoute(ship, from, goal, safe) {
  const tiers = safe ? [safe, passableForPlayer, breachable] : [passableForPlayer, breachable];
  let map;
  let filter = breachable;
  for (const tier of tiers) {
    const candidate = RoomDistance.from(ship, [goal], tier);
    if (!Number.isFinite(candidate.at(from))) continue;
    map = candidate;
    filter = tier;
    break;
  }
  if (map === void 0) return void 0;
  const out2 = [];
  let at = from;
  while (at !== goal && out2.length <= ship.size) {
    const door = map.nextDoor(at, filter);
    if (!door) return void 0;
    out2.push(door);
    at = ship.other(door, at);
  }
  return at === goal ? out2 : void 0;
}

// ../../../smoreg_works/games/salvor/src/ui/actions.ts
var ACTION_KEYS = "1234567890";
var MAX_ACTIONS = ACTION_KEYS.length;
var BACK_KEY = "0";
var ACTION_WIDTH = 25;
var UNKNOWN_ROOM = "\xB7\xB7\xB7\xB7";
var DOOR_VERBS = {
  key: "a",
  power: "p",
  spike: "K",
  cut: "c",
  weld: "w",
  // Lifting a mine off a door (`systems/doors.ts`): a way of dealing with the
  // door, listed with the ways through it and reached by number only — `w`
  // is the weld, and one letter cannot mean two turns.
  defuse: ""
};
var LATE_VERBS = /* @__PURE__ */ new Set(["close", "work", "upload"]);
var DOOR_RANK = {
  open: 0,
  broken: 0,
  closed: 0,
  locked: 1,
  sealed: 2,
  airlock: 3
};
function roomActions(game, menu, moves = false, cursor = 0) {
  if (game.status !== "playing") return [];
  if (isTug(game)) {
    const verb2 = typeof menu === "string" ? menu : void 0;
    return keyed(verb2 !== void 0 && tugPicks(game, verb2) || tugActions(game), cursor);
  }
  const list = moves ? travelActions(game) : hereActions(game);
  if (menu === void 0) return keyed(list, cursor);
  if (typeof menu === "string") return keyed(swapPicks(game, menu) ?? list, cursor);
  return keyed(doorMethods(game, menu) ?? list, cursor);
}
function windowStart(cursor, length, limit) {
  if (length <= limit) return 0;
  const last = length - limit;
  return Math.max(0, Math.min(cursor <= EDGE ? 0 : cursor - EDGE, last));
}
var EDGE = 4;
var TUG_ROWS = [
  { verb: "buy", nest: true, empty: "why.hull.none" },
  { head: "tug.group.repair", verb: "repair", nest: true, empty: "why.rig.whole" },
  { verb: "graft", nest: true, empty: "why.rig.grafted" },
  { verb: "clean", label: "action.dead.clean", empty: "why.rig.clean" },
  { head: "tug.group.rig", verb: "stow", nest: true, empty: "why.rig.empty" },
  // One row for every way a module gets onto the drone: the ones already in the
  // hold, and the three the dock has for sale. It is one row and not two
  // because at home the terminal panel is exactly full — ten numbered lines and
  // the headings over them is what fits — and because it is the better answer
  // anyway: the owner could not find the hold at all («не понял, как таскать
  // модули к себе не экипируя»), and a shelf whose front door is the hold
  // explains both at once.
  { verb: "fit", also: "order", nest: true, empty: "why.hold.shelf" },
  { verb: "sell", nest: true, empty: "why.rig.empty" },
  { head: "tug.group.voyage", verb: "charter", nest: true, empty: "why.charter.gone" },
  { head: "tug.group.jump", verb: "jump", label: "action.dead.jump", empty: "why.jump.last" },
  { verb: "undock", label: "action.dead.undock", empty: "why.tug.noDrone" }
];
function rowTargets(game, row) {
  const own = stationTargets(game, row.verb);
  const also = row.also === void 0 ? [] : stationTargets(game, row.also);
  return { own, all: [...own, ...also] };
}
function tugActions(game) {
  const rows = TUG_ROWS.map((row) => {
    const { own, all } = rowTargets(game, row);
    const line2 = tugRow(game, row, all, own);
    return row.head === void 0 ? line2 : { ...line2, head: t(row.head) };
  });
  const claimed = new Set(TUG_ROWS.flatMap((r) => r.also === void 0 ? [r.verb] : [r.verb, r.also]));
  const rest = gatedOffers(game).filter((o) => !claimed.has(verbOf(o) ?? "") && !aboutADoor(o)).map(fromOffer);
  return [...rows, ...rest];
}
function tugRow(game, row, offers, own) {
  const label3 = (row.label === void 0 ? pickLabel(row.verb) : t(row.label)) ?? row.verb;
  if (offers.length === 0) {
    const line3 = raw(label3, tugDead(row.verb), false);
    line3.why = t(noDrone(game) ? "why.tug.noDrone" : row.empty);
    return line3;
  }
  if (row.nest !== true) return fromOffer(offers[0]);
  const open = offers.find((o) => o.enabled);
  const line2 = {
    key: "",
    label: label3,
    cmd: (open ?? offers[0]).cmd,
    // `enabled` keeps its old promise — there is something under this line the
    // drone can spend right now — and a greyed one still steps into its list,
    // because `appReducer` reads `step` before it reads `enabled`. That is the
    // same bargain a locked bulkhead with no tool for it strikes (`doorMenu`):
    // the moment a player most needs to read what a thing would cost is the
    // moment they cannot pay for it.
    enabled: open !== void 0,
    step: row.verb
  };
  if (open === void 0) line2.why = own[0]?.why ?? t(row.empty);
  return line2;
}
function tugPicks(game, verb2) {
  const row = TUG_ROWS.find((r) => r.verb === verb2);
  if (!row || row.nest !== true) return void 0;
  const offers = rowTargets(game, row).all;
  if (offers.length === 0) return void 0;
  return [...offers.map(fromOffer), backToRoom()];
}
function aboutADoor(offer3) {
  const verb2 = verbOf(offer3) ?? "";
  return verb2 === "close" || DOOR_VERBS[verb2] !== void 0;
}
function noDrone(game) {
  return voyageRecord(game)?.hull === void 0;
}
function tugDead(verb2) {
  return { kind: "act", verb: `no-${verb2}` };
}
function travelActions(game) {
  const { here: here3, forDoors } = situation2(game);
  const rows = known(game, here3).map((room) => ({ room, route: travelRoute(game.ship, here3, room.id) })).sort((a, b) => reach(a.route) - reach(b.route) || a.room.id - b.room.id).map(({ room, route }) => travelRow(game, room, route, forDoors));
  return [...rows, backToRoom()];
}
function known(game, here3) {
  return game.ship.rooms.filter(
    (r) => r.id !== here3 && (r.explored || r.scanned || game.visible.has(r.id))
  );
}
function reach(route) {
  return route === void 0 ? Number.POSITIVE_INFINITY : route.length;
}
function travelRow(game, room, route, offers) {
  const shut = route?.find((d) => !passableForPlayer(d));
  const right = route === void 0 ? t("dist.none") : shut ? `${shut.label} ${doorStateWord(shut.state)}` : t("dist.doors", { n: route.length });
  const label3 = roomLabel(room, right, goalMark(game, room));
  const at = { leadsTo: room.id };
  if (route === void 0 || route[0] === void 0) {
    const line2 = raw(label3, { kind: "act", verb: "back" }, false);
    line2.why = t("why.room.noRoute", { room: roomName(room) });
    return { ...line2, ...at };
  }
  if (shut === route[0]) {
    return { ...doorRow(shut, waysOf(offers, shut.id), () => label3), label: label3, ...at };
  }
  if (route.length === 1 && dangerAhead(game, route[0]) === void 0) {
    return { ...raw(label3, { kind: "go", door: route[0].id }, true), ...at };
  }
  return { ...raw(label3, { kind: "go", door: route[0].id }, true), travel: room.id, ...at };
}
function roomLabel(room, right, mark = "") {
  const label3 = pad(room.label, LABEL_W);
  const width = Math.min(ROOM_W, Math.max(2, ACTION_WIDTH - label3.length - right.length));
  const name = clipName(roomName(room), Math.max(1, width - 1 - mark.length));
  return pad(mark + name, width) + label3 + right;
}
function goalMark(game, room) {
  const online = shipState(game).online;
  for (const system of roomList(room, "systems")) {
    if (!online.includes(system.kind)) return GOAL_MARK;
  }
  for (const item of roomList(room, "items")) {
    if (item.kind === "charter-item" && item.taken !== true) return BUCKET_GLYPH.items;
    if (item.kind === "console" && item.uploaded !== true) return BUCKET_GLYPH.items;
  }
  return "";
}
function hereActions(game) {
  const { here: here3, offers, doors, forDoors } = situation2(game);
  const shots = offers.filter((o) => verbOf(o) === "shoot");
  const late = offers.filter((o) => LATE_VERBS.has(verbOf(o) ?? ""));
  const swaps = offers.filter((o) => verbOf(o) === "swap");
  const spent = /* @__PURE__ */ new Set([...shots, ...forDoors, ...late, ...swaps]);
  const out2 = [
    // Attacks come off the entity list rather than off the offers: hitting what
    // is in the room is the engine's own verb, and it stays on the list even if
    // a game one day stops advertising it.
    ...attackRows(hostilesIn(game, here3)),
    ...shots.map(fromOffer),
    // A relic against a full rack: one line per crate, its slots one level down.
    ...swapRows(game, here3, swaps),
    // Anything lying about: wreckage, crates, bodies, a charter's package.
    // `hide` and `wait` are deliberately dropped — they are letters, not
    // numbers, and a list that repeats the letter row is a list nobody reads.
    ...offers.filter((o) => !spent.has(o) && o.cmd.kind === "act").map(fromOffer),
    // The bulkheads, back where the design document draws them.
    ...doorRows(game, here3, doors, forDoors),
    ...airlockRow(doors),
    // `close` only where shutting one is this turn's decision: a machine in
    // sight on the other side. Everywhere else it lives on `d`.
    ...late.filter((o) => verbOf(o) !== "close" || threatBeyond(game, here3, o)).map(fromOffer)
  ];
  return pressableFirst(out2);
}
function situation2(game) {
  const here3 = game.roomOf(game.player).id;
  const offers = gatedOffers(game);
  const doors = game.ship.doorsOf(here3);
  const doorIds = new Set(doors.map((d) => d.id));
  return { here: here3, offers, doors, forDoors: offers.filter((o) => doorOffer(o, doorIds)) };
}
function keyed(actions, cursor = 0) {
  const nested = actions.some((a) => a.step === null);
  const limit = nested ? MAX_ACTIONS - 1 : MAX_ACTIONS;
  const from = windowStart(cursor, actions.filter((a) => a.step !== null).length, limit);
  let at = 0;
  return actions.map((line2) => {
    const a = fitted(line2);
    if (a.step === null) return { ...a, key: BACK_KEY };
    const i = at++;
    const on = i - from;
    return on >= 0 && on < limit ? { ...a, key: ACTION_KEYS[on] } : a;
  });
}
function fitted(a) {
  const { label: label3, extra } = fitLabel(a.label);
  if (label3 === a.label && extra === void 0) return a;
  return extra === void 0 ? { ...a, label: label3 } : { ...a, label: label3, extra };
}
function fitLabel(text3, width = ACTION_WIDTH) {
  if (text3.length <= width) return { label: text3 };
  const price = /\s(\([^()]*\))$/.exec(text3);
  if (price !== null) {
    const head = text3.slice(0, price.index);
    if (head.length <= width) return { label: head, extra: price[1] };
  }
  return { label: squeeze(text3, width) };
}
function squeeze(text3, width) {
  const words = text3.split(" ");
  let from = words.length;
  while (from > 1 && /[0-9#]/.test(words[from - 1])) from--;
  const head = words[0];
  const tail = words.slice(from);
  const name = words.slice(1, from);
  while (name.length > 1 && joined(head, name, tail).length > width) name.pop();
  const line2 = joined(head, name, tail);
  if (line2.length <= width) return line2;
  const over = line2.length - width;
  const last = name[name.length - 1];
  if (last !== void 0 && last.length > over + 1) {
    name[name.length - 1] = `${last.slice(0, last.length - over - 1)}\u2026`;
    return joined(head, name, tail);
  }
  return `${line2.slice(0, Math.max(0, width - 1))}\u2026`;
}
function joined(head, name, tail) {
  return [head, ...name, ...tail].join(" ");
}
function pressableFirst(actions) {
  return [...actions.filter((a) => a.enabled), ...actions.filter((a) => !a.enabled)];
}
function omittedActions(actions) {
  return actions.filter((a) => a.key === "");
}
function airlockLabel(door) {
  const head = pad(`${verbWord("leave")} ${door.label}`, VERB_W);
  const state = doorStateWord("out");
  const width = Math.min(NAME_W, Math.max(2, ACTION_WIDTH - head.length - state.length));
  return head + pad(clip(t("word.tug"), width - 1), width) + state;
}
function airlockRow(doors) {
  const airlock = doors.find((d) => d.state === "airlock");
  if (!airlock) return [];
  return [raw(airlockLabel(airlock), { kind: "leave" }, true)];
}
function doorRows(game, here3, doors, offers) {
  return [...doors].filter((door) => door.state !== "airlock").sort((a, b) => rank(a) - rank(b) || a.id - b.id).map((door) => {
    const at = { leadsTo: game.ship.other(door, here3) };
    const label3 = (verb2) => doorLine(verb2, door, farName(game, door, here3));
    if (game.ship.passable(door, { isPlayer: true })) {
      const step = { ...raw(label3("go"), { kind: "go", door: door.id }, true), ...at };
      return dangerAhead(game, door) === void 0 ? step : { ...step, travel: at.leadsTo };
    }
    return { ...doorRow(door, waysOf(offers, door.id), label3), ...at };
  });
}
function doorLine(verb2, door, name) {
  const head = pad(`${verbWord(verb2)} ${door.label}`, VERB_W);
  const state = doorStateWord(door.state);
  const width = Math.min(NAME_W, Math.max(2, ACTION_WIDTH - head.length - state.length));
  return head + pad(clipName(name, width - 1), width) + state;
}
function farName(game, door, here3) {
  const at = here3 ?? game.roomOf(game.player).id;
  const far = game.ship.roomAt(game.ship.other(door, at));
  return far.explored || far.scanned || game.visible.has(far.id) ? roomName(far) : UNKNOWN_ROOM;
}
function threatBeyond(game, here3, offer3) {
  const target = offer3.cmd.kind === "act" ? offer3.cmd.target : void 0;
  const door = target === void 0 ? void 0 : game.ship.doors[target];
  if (!door) return false;
  const far = game.ship.other(door, here3);
  return game.visible.has(far) && hostilesIn(game, far).length > 0;
}
function waysHere(game) {
  const { doors, forDoors } = situation2(game);
  return [...doors].sort((a, b) => rank(a) - rank(b) || a.id - b.id).flatMap((door) => waysOf(forDoors, door.id));
}
function doorRow(door, ways, name) {
  if (ways.length > 1) return doorMenu(door, name("open"), ways);
  const opener = ways.find((w) => w.enabled);
  if (!opener) {
    const line2 = raw(name("go"), { kind: "go", door: door.id }, false);
    line2.why = t("why.door.state", { door: door.label, state: doorStateWord(door.state) });
    return ways.length === 0 ? line2 : { ...line2, ways };
  }
  return { key: "", label: name(opener.verb), cmd: opener.cmd, enabled: true, ways };
}
function doorMenu(door, label3, ways) {
  const opener = ways.find((w) => w.enabled);
  return {
    key: "",
    label: label3,
    cmd: (opener ?? ways[0]).cmd,
    enabled: opener !== void 0,
    ways,
    step: door.id
  };
}
function doorMethods(game, id) {
  const { doors, forDoors } = situation2(game);
  const door = doors.find((d) => d.id === id);
  if (!door || door.state === "airlock") return void 0;
  if (game.ship.passable(door, { isPlayer: true })) {
    if (dangerAhead(game, door) === void 0) return void 0;
    const through = { verb: "go", letter: "", cmd: { kind: "go", door: door.id }, enabled: true };
    return [methodAction(through), ...waysOf(forDoors, id).map(methodAction), backAction(door)];
  }
  const ways = waysOf(forDoors, id);
  if (ways.length === 0) return void 0;
  return [...ways.map(methodAction), backAction(door)];
}
var SWAP_LEVEL = "swap:";
function swapLevel(wreck) {
  return `${SWAP_LEVEL}${wreck}`;
}
function swapWreck(level) {
  if (!level.startsWith(SWAP_LEVEL)) return void 0;
  const id = Number(level.slice(SWAP_LEVEL.length));
  return Number.isInteger(id) ? id : void 0;
}
function swapRows(game, here3, swaps) {
  const byCrate = /* @__PURE__ */ new Map();
  for (const o of swaps) {
    const id = o.cmd.kind === "act" ? o.cmd.target : void 0;
    if (id === void 0) continue;
    const list = byCrate.get(id) ?? [];
    list.push(o);
    byCrate.set(id, list);
  }
  const out2 = [];
  for (const [id, group] of byCrate) {
    if (group.length === 1) {
      out2.push(fromOffer(group[0]));
      continue;
    }
    const wreck = wreckAt(game, here3, id);
    const first = group[0];
    out2.push({
      key: "",
      label: wreck ? t("action.swapMenu", { module: moduleName(wreck.kind) }) : first.label,
      cmd: first.cmd,
      enabled: group.some((o) => o.enabled),
      step: swapLevel(id)
    });
  }
  return out2;
}
function swapPicks(game, level) {
  const id = swapWreck(level);
  if (id === void 0) return void 0;
  const group = gatedOffers(game).filter(
    (o) => o.cmd.kind === "act" && o.cmd.verb === "swap" && o.cmd.target === id
  );
  if (group.length < 2) return void 0;
  return [...group.map(fromOffer), backToRoom()];
}
function methodAction(way) {
  const out2 = raw(methodLabel(way.verb), way.cmd, way.enabled);
  if (way.why !== void 0) out2.why = way.why;
  return out2;
}
function methodLabel(verb2) {
  const cost = tId("cost", verb2, "");
  return cost === "" ? verbWord(verb2) : pad(verbWord(verb2), METHOD_W) + cost;
}
function backToRoom() {
  return {
    key: "",
    label: t("action.backRoom"),
    // Never sent: `appReducer` reads `step` before it reads `cmd`. It is still
    // an `act` no system claims, which the engine refuses for no turn, so the
    // one line that must never cost anything cannot.
    cmd: { kind: "act", verb: "back" },
    enabled: true,
    step: null
  };
}
function backAction(door) {
  return {
    key: "",
    // The bulkhead is named here and nowhere else on this list: one level down
    // there is no heading to say which door these four belong to.
    label: t("action.back", { door: door.label }),
    // Never sent — `appReducer` reads `step` first. It is an `act` no system
    // claims all the same, which the engine refuses for no turn, so the one
    // line of the list that must never cost anything cannot.
    cmd: { kind: "act", verb: "back" },
    enabled: true,
    step: null
  };
}
function waysOf(offers, door) {
  return offers.filter((o) => o.cmd.kind === "act" && o.cmd.target === door).map((o) => {
    const way = {
      verb: verbOf(o) ?? "",
      letter: DOOR_VERBS[verbOf(o) ?? ""] ?? "",
      cmd: o.cmd,
      enabled: o.enabled
    };
    if (o.why !== void 0) way.why = o.why;
    return way;
  });
}
function rank(door) {
  return DOOR_RANK[door.state] ?? 1;
}
var VERB_W = 7;
var NAME_W = 10;
var GOAL_MARK = "\u25C6";
var ROOM_W = 10;
var LABEL_W = 4;
var METHOD_W = 8;
function attackRows(machines) {
  const rows = machines.map(
    (m) => raw(
      t("action.attack", { target: machineName(m.name), hp: m.hp, max: m.hpMax }),
      { kind: "attack", target: m.id },
      true
    )
  );
  const seen = /* @__PURE__ */ new Map();
  return rows.map((row) => {
    const n = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, n);
    const twins = rows.filter((r) => r.label === row.label).length;
    return twins > 1 ? { ...row, label: `${row.label} #${n}` } : row;
  });
}
function fromOffer(offer3) {
  const action = raw(offer3.label, offer3.cmd, offer3.enabled);
  if (offer3.why !== void 0) action.why = offer3.why;
  return action;
}
function raw(label3, cmd, enabled) {
  return { key: "", label: label3, cmd, enabled };
}
function verbOf(offer3) {
  return offer3.cmd.kind === "act" ? offer3.cmd.verb : void 0;
}
function doorOffer(offer3, doors) {
  const verb2 = verbOf(offer3);
  if (verb2 === void 0 || DOOR_VERBS[verb2] === void 0) return false;
  const target = offer3.cmd.kind === "act" ? offer3.cmd.target : void 0;
  return target !== void 0 && doors.has(target);
}
function pad(text3, width) {
  return text3.length < width ? text3.padEnd(width) : `${text3} `;
}
function clipName(name, width) {
  if (name.length <= width) return name;
  const word = name.lastIndexOf(" ", width);
  return word > 0 ? name.slice(0, word) : clip(name, width);
}
function clip(text3, width) {
  return text3.length <= width ? text3 : text3.slice(0, Math.max(0, width));
}

// ../../../smoreg_works/games/salvor/src/ui/theme.ts
var THEME = PALETTE;
var LAYOUT = {
  mapWidth: 66,
  mapHeight: 34,
  sidebarWidth: 29,
  logHeight: 7,
  fontSize: 18
};
var SCREEN_WIDTH = LAYOUT.mapWidth + LAYOUT.sidebarWidth;
var SCREEN_HEIGHT = LAYOUT.mapHeight + LAYOUT.logHeight + 1;

// ../../../smoreg_works/games/salvor/src/ui/input.ts
var TUG_KEYS = ["help.where.tug.head", "help.where.tug.1", "help.where.tug.2"];
var SHIP_KEYS = [
  "help.where.ship.head",
  "help.where.ship.1",
  "help.where.ship.2",
  // The one mark on the schematic that is not a label: what `⌂` is, said in
  // the block a player reads while standing in the ship it hangs off.
  "help.where.ship.3"
];
function tugHelp() {
  return TUG_KEYS.map((k) => t(k));
}
function shipHelp() {
  return SHIP_KEYS.map((k) => t(k));
}
var NAME_W2 = 10;
var KEY_ROWS = [
  ["help.name.act", "help.key.act"],
  ["help.name.pick", "help.key.pick"],
  ["help.name.brace", "help.key.brace"],
  ["help.name.hide", "help.key.hide"],
  ["help.name.move", "help.key.move"],
  ["help.name.doors", "help.key.doors"],
  ["help.name.seal", "help.key.seal"],
  ["help.name.explore", "help.key.explore"],
  ["help.name.engage", "help.key.engage"],
  ["module.scanner", "help.key.scanner"],
  ["module.emp", "help.key.emp"],
  ["module.welder", "help.key.welder"],
  ["module.cell", "help.key.cell"],
  ["module.spike", "help.key.spike"],
  ["module.emitter", "help.key.emitter"],
  ["module.cutter", "help.key.cutter"],
  ["help.name.keycard", "help.key.keycard"],
  ["help.name.codex", "help.key.codex"],
  ["help.name.log", "help.key.log"],
  ["help.name.help", "help.key.help"]
];
function keyHelp() {
  return KEY_ROWS.map(([name, text3]) => `${t(name).padEnd(NAME_W2)} ${t(text3)}`);
}
var RULE_KEYS = [
  "help.rule.head",
  "help.rule.1",
  "help.rule.2",
  "help.rule.3",
  "help.rule.4",
  "help.rule.5"
];
var LIST_KEYS = [
  "help.list.head",
  "help.list.1",
  "help.list.2",
  "help.list.3",
  "help.list.4"
];
var CHARTER_KEYS = [
  "help.charter.head",
  "help.charter.1",
  "help.charter.2",
  "help.charter.3",
  "help.charter.4"
];
var URL_KEYS = [
  "help.url.head",
  "help.url.seed",
  "help.url.view",
  "help.url.sound",
  "help.url.training",
  "help.url.debug",
  // The two the owner takes his itch.io screenshots with, and the two that were
  // written down nowhere at all: the tiles (G80) and the drawn hull (G81) are
  // switches on the drawing rather than views of their own, so `V` does not
  // reach either and nothing on the start screen names them
  // (docs/tasks/G86-tutorial-and-title.md, 12).
  "help.url.tiles",
  "help.url.hull"
];
function ruleHelp() {
  return RULE_KEYS.map((k) => t(k));
}
function urlHelp() {
  return URL_KEYS.map((k) => t(k));
}
function listHelp() {
  return LIST_KEYS.map((k) => t(k));
}
function charterHelp() {
  return CHARTER_KEYS.map((k) => t(k));
}
function helpBlocks(onTug, seen) {
  const blocks2 = [
    onTug ? tugHelp() : shipHelp(),
    keyHelp(),
    ruleHelp(),
    listHelp(),
    charterHelp(),
    urlHelp()
  ];
  if (seen.length > 0) blocks2.push([t("help.codex.head"), ...seen.map((title) => ` ${title}`)]);
  return blocks2;
}
var HELP_ROWS = SCREEN_HEIGHT - 8;
function helpPages(onTug, seen = []) {
  const blocks2 = helpBlocks(onTug, seen);
  const total = blocks2.reduce((n, b) => n + b.length, 0) + blocks2.length - 1;
  const want = Math.max(1, Math.ceil(total / HELP_ROWS));
  for (let cap = Math.ceil(total / want); cap <= HELP_ROWS; cap++) {
    const pages = packed(blocks2, cap);
    if (pages.length <= want) return pages;
  }
  return packed(blocks2, HELP_ROWS);
}
function packed(blocks2, cap) {
  const pages = [];
  for (const block of blocks2) {
    const last = pages[pages.length - 1];
    if (last !== void 0 && last.length + 1 + block.length <= cap) last.push("", ...block);
    else pages.push([...block]);
  }
  return pages;
}
function helpFooter(page2, pages) {
  const at = { n: page2 + 1, of: pages };
  return page2 + 1 < pages ? t("help.page.more", at) : t("help.page.last", at);
}
function helpHeadings() {
  return [
    t(TUG_KEYS[0]),
    t(SHIP_KEYS[0]),
    t(RULE_KEYS[0]),
    t(LIST_KEYS[0]),
    t(CHARTER_KEYS[0]),
    t(URL_KEYS[0]),
    t("help.codex.head")
  ];
}
var CODEX_WIDTH = 52;
var CARD_MARK = "[i]";
function codexHeading(entry) {
  return `${CARD_MARK} ${t(entry.title)}`;
}
function codexBody(entry, fitted3) {
  const out2 = [...wrapped(t(entry.what))];
  out2.push("");
  out2.push(...wrapped(`${t("codex.label.wrong")} ${t(entry.wrong)}`));
  out2.push(...wrapped(`${t("codex.label.helps")} ${helpsLine(entry, fitted3)}`));
  if (entry.turn !== void 0) out2.push(...wrapped(`${t("codex.label.turn")} ${t(entry.turn)}`));
  out2.push("");
  out2.push(...wrapped(t(entry.lore)));
  return out2;
}
function helpsLine(entry, fitted3) {
  const modules = (entry.modules ?? []).map(
    (id) => fitted3.has(id) ? `${moduleName(id)} ${t("codex.fitted")}` : moduleName(id)
  );
  const prose = t(entry.helps);
  return modules.length === 0 ? prose : `${modules.join(", ")}. ${prose}`;
}
function codexFooter(page2, pages) {
  const at = { n: page2 + 1, of: pages };
  return pages > 1 ? t("codex.footer.more", at) : t("codex.footer.last", at);
}
function wrapped(text3) {
  const out2 = [];
  let line2 = "";
  for (const word of text3.split(" ")) {
    if (line2.length === 0) line2 = word;
    else if (line2.length + 1 + word.length <= CODEX_WIDTH) line2 += ` ${word}`;
    else {
      out2.push(line2);
      line2 = word;
    }
  }
  out2.push(line2);
  return out2;
}

// ../../../smoreg_works/games/salvor/src/ui/logline.ts
var ENGINE_KEYS = [
  "engine.hit.you",
  "engine.hit.taken",
  "engine.hit.other",
  "engine.dies",
  "engine.cover.you",
  "engine.cover.other",
  "engine.door.open",
  "engine.door.breached",
  "engine.door.cut.you",
  "engine.door.cut.other",
  "engine.fail.airlock",
  "engine.fail.attack.ally",
  "engine.fail.attack.away",
  "engine.fail.attack.gone",
  "engine.fail.attack.sight",
  "engine.fail.cover",
  "engine.fail.door.elsewhere",
  "engine.fail.door.gone",
  "engine.fail.door.shut",
  "engine.fail.door.size",
  "engine.fail.leave.none",
  "engine.fail.leave.other",
  "engine.fail.nothing",
  "engine.fail.over"
];
var KNOWN2 = new Set(ENGINE_KEYS);
var NAMED = /* @__PURE__ */ new Set(["actor", "target"]);
function logText(line2) {
  if (line2.key === void 0 || !KNOWN2.has(line2.key)) return line2.text;
  return t(line2.key, said(line2.params ?? {}));
}
function said(params) {
  const out2 = {};
  for (const [name, value] of Object.entries(params)) {
    if (NAMED.has(name)) {
      const phrase = t("label.other", { name: machineName(String(value)) });
      out2[name] = phrase;
      out2[capitalize(name)] = capitalize(phrase);
    } else if (name === "state") {
      out2[name] = doorStateWord(String(value));
    } else {
      out2[name] = value;
    }
  }
  return out2;
}
var ALARM = "alarm";
function logFades(lines) {
  const turns = [...new Set(lines.map((line2) => line2.turn))].sort((a, b) => b - a);
  const rank2 = new Map(turns.map((turn, i) => [turn, i]));
  return lines.map((line2) => {
    if (line2.tone === ALARM) return "fresh";
    const at = rank2.get(line2.turn) ?? 0;
    return at === 0 ? "fresh" : at === 1 ? "recent" : "old";
  });
}
function opensTurn(lines, i) {
  const before = lines[i - 1];
  return before !== void 0 && before.turn !== lines[i].turn;
}
var HISTORY_LINES = 200;
var HISTORY_ROWS = SCREEN_HEIGHT - 8;
function historyPages(lines, rows) {
  const text3 = lines.slice(Math.max(0, lines.length - HISTORY_LINES)).map((line2) => logText(line2) + (line2.count > 1 ? ` (x${line2.count})` : ""));
  if (text3.length === 0) return [[t("log.empty")]];
  const size = Math.max(1, rows);
  const pages = [];
  for (let end = text3.length; end > 0; end -= size) {
    pages.push(text3.slice(Math.max(0, end - size), end));
  }
  return pages;
}

// ../../../smoreg_works/games/salvor/src/ui/doorlist.ts
function doorLevel(game, cursor = 0) {
  return keyed([...doorRows2(game), backToRoom()], cursor);
}
function doorWays(game, id, cursor = 0) {
  const door = doorsHere(game).find((d) => d.id === id);
  if (door === void 0) return void 0;
  const ways = waysOf2(game, door);
  if (ways.length < 2) return void 0;
  const lines = ways.map((way) => way.verb === "go" ? { ...methodAction(way), label: doorLabel(game, door, "go") } : methodAction(way));
  return keyed([...lines, backAction(door)], cursor);
}
function doorsHere(game) {
  const here3 = game.roomOf(game.player).id;
  return [...game.ship.doorsOf(here3)].filter((door) => door.state !== "airlock").sort((a, b) => a.id - b.id);
}
function doorRows2(game) {
  const ways = waysHere(game);
  return doorsHere(game).map((door) => doorRow2(game, door, waysOf2(game, door, ways)));
}
function waysOf2(game, door, all) {
  return [...passing(game, door), ...shutting(game, door.id), ...waysFor(all ?? waysHere(game), door.id)];
}
function passing(game, door) {
  if (!game.ship.passable(door, { isPlayer: true })) return [];
  return [{ verb: "go", letter: "", cmd: { kind: "go", door: door.id }, enabled: true }];
}
function shutting(game, door) {
  return gatedOffers(game).filter((o) => o.cmd.kind === "act" && o.cmd.verb === "close" && o.cmd.target === door).map((o) => {
    const way = { verb: "close", letter: "", cmd: o.cmd, enabled: o.enabled };
    if (o.why !== void 0) way.why = o.why;
    return way;
  });
}
function waysFor(ways, door) {
  return ways.filter((w) => w.cmd.kind === "act" && w.cmd.target === door);
}
function doorRow2(game, door, ways) {
  const at = { leadsTo: game.ship.other(door, game.roomOf(game.player).id) };
  if (ways.length > 1) return { ...doorMenu(door, doorLabel(game, door, ""), ways), ...at };
  const only = ways[0];
  if (only === void 0) {
    const line3 = {
      key: "",
      label: doorLabel(game, door, ""),
      cmd: { kind: "go", door: door.id },
      enabled: false,
      why: t("why.door.state", { door: door.label, state: doorStateWord(door.state) })
    };
    return { ...line3, ...at };
  }
  const line2 = {
    key: "",
    label: doorLabel(game, door, only.verb),
    cmd: only.cmd,
    enabled: only.enabled,
    ways
  };
  if (only.why !== void 0) line2.why = only.why;
  return { ...line2, ...at };
}
function doorLabel(game, door, verb2) {
  const head = pad(verb2 === "" ? door.label : `${verbWord(verb2)} ${door.label}`, VERB_W2);
  const state = doorStateWord(door.state);
  const width = Math.min(NAME_W3, Math.max(2, ACTION_WIDTH - head.length - state.length));
  return head + pad(clipName(farName(game, door), width - 1), width) + state;
}
var VERB_W2 = 8;
var NAME_W3 = 10;

// ../../../smoreg_works/games/salvor/src/ui/view.ts
var VIEWS = ["ascii", "web", "hex"];

// ../../../smoreg_works/games/salvor/src/ui/title.ts
var PICK_KEYS = ["1", "2", "3", "4"];
var LANG_KEY = "L";
var SOUND_KEY = "S";
var BUILD_VERSION = "0.1.0";
function titleScreen(settings, typing) {
  return {
    name: t("title.name"),
    tagline: t("title.tagline"),
    menuHead: t("title.menu.head"),
    items: [
      { key: PICK_KEYS[0], label: t("title.menu.voyage"), value: t("title.menu.voyage.at") },
      { key: PICK_KEYS[1], label: t("title.menu.training"), value: t("title.menu.training.at") },
      { key: PICK_KEYS[2], label: t("title.menu.help"), value: t("title.menu.help.at") },
      { key: PICK_KEYS[3], label: t("title.menu.seed"), value: seedValue(settings.seed, typing) },
      { key: LANG_KEY, label: t("title.menu.lang"), options: langOptions() },
      { key: VIEW_KEY_ROW, label: t("title.menu.view"), options: viewOptions(settings.view) },
      { key: SOUND_KEY, label: t("title.menu.sound"), value: t(settings.sound ? "title.sound.on" : "title.sound.off") }
    ],
    hints: [
      typing === void 0 ? t("title.start") : t("title.seed.typing", { seed: settings.seed }),
      t("title.view.judges")
    ],
    keysHead: t("title.keys.head"),
    keys: [t("title.keys.1"), t("title.keys.2")],
    foot: t("title.foot", { version: BUILD_VERSION })
  };
}
var VIEW_KEY_ROW = "V";
var DEFAULT_TITLE = { view: "ascii", sound: true, seed: 0 };
function seedValue(seed, typing) {
  if (typing === void 0) return String(seed);
  return typing.length === 0 ? t("title.seed.empty") : `${typing}_`;
}
function langOptions() {
  const on = currentLang();
  return LANGS.map((lang) => ({ text: lang.toUpperCase(), on: lang === on }));
}
function viewOptions(view) {
  return VIEWS.map((v) => ({ text: t(VIEW_NAMES[v]), on: v === view }));
}
var VIEW_NAMES = {
  ascii: "title.view.ascii",
  web: "title.view.web",
  hex: "title.view.hex"
};

// ../../../smoreg_works/games/salvor/src/ui/appstate.ts
var NO_MARKS = { lost: 0, sold: 0 };
var IDLE = { kind: "idle" };
function initialState(settings = DEFAULT_TITLE) {
  return {
    settings,
    seedText: void 0,
    titleHelp: false,
    overlay: "title",
    exploring: false,
    ask: void 0,
    warned: void 0,
    crash: void 0,
    cursor: 0,
    at: "",
    menu: void 0,
    moves: false,
    doors: false,
    helpPage: 0,
    logPage: 0,
    codex: [],
    codexAt: 0,
    seen: NO_MARKS,
    effect: IDLE
  };
}
function listOf(game, state) {
  return listFor(game, state.menu, state.moves, state.doors, state.cursor);
}
function listFor(game, menu, moves, doors, cursor = 0) {
  if (doors) {
    if (menu === void 0) return doorLevel(game, cursor);
    if (typeof menu !== "string") return doorWays(game, menu, cursor) ?? doorLevel(game, cursor);
  }
  return roomActions(game, menu, moves, cursor);
}
function aimedAt(game, state) {
  return listOf(game, state)[state.cursor]?.leadsTo;
}
function codexSeen(game) {
  return seenCodex(game).map((id) => codexFor(id)).filter((entry) => entry !== void 0).map((entry) => t(entry.title));
}
function codexView(game, state) {
  if (state.overlay !== "codex") return void 0;
  const entry = codexFor(state.codex[state.codexAt]);
  if (entry === void 0) return void 0;
  const rig = rigOf(game.player);
  const fitted3 = /* @__PURE__ */ new Set();
  for (const slot of rig?.slots ?? []) if (slot !== null) fitted3.add(slot.kind);
  return { entry, fitted: fitted3, page: state.codexAt, pages: state.codex.length };
}

// ../../../smoreg_works/games/salvor/src/ui/debug.ts
function machinesAboard2(game) {
  return game.entities.filter((e) => e.id !== game.player.id && e.faction !== game.player.faction && isAlive(e));
}
function roomLabelOf(game, room) {
  if (room === void 0) return "?";
  return game.ship.rooms[room]?.label ?? String(room);
}
function machineLine(game, distances, m) {
  const remembered2 = lastKnownRoom(m);
  const dist = m.room === void 0 ? "?" : String(distances.at(m.room));
  return `MACHINE ${m.name} room=${roomLabelOf(game, m.room)} behaviour=${m.behaviour ?? "brute"} remembers=${remembered2 === void 0 ? "-" : roomLabelOf(game, remembered2)} dist=${dist} hp=${m.hp}/${m.hpMax} stunned=${m.stunned ?? 0} sees-drone=${canSeeDrone(game, m)}`;
}
function alertLine(game) {
  const a = alertState(game);
  const scuttle = a.scuttleFrom >= 0 ? ` scuttleFrom=${a.scuttleFrom}` : "";
  return `ALERT level=${a.level}/5 turnsAboard=${a.turnsAboard} quiet=${a.quietTurns}${scuttle}${a.frozen ? " frozen" : ""}`;
}
function droneLine(game) {
  const rig = rigOf(game.player);
  const exposed = rig?.exposed;
  const exposedKind = exposed === null || exposed === void 0 ? "-" : rig?.slots[exposed]?.kind ?? "-";
  const carried = carriedBy(game.player);
  const hold = carried.length === 0 ? "-" : carried.map((c) => `${c.kind}:${c.integrity}`).join(",");
  return `DRONE exposed=${exposedKind} carrying=${hold}`;
}
function rivalLine(game) {
  const r = rivalState(game);
  if (!r.enabled) return "RIVAL disabled";
  return `RIVAL progress=${r.progress} alive=${r.alive ?? false} evac=${r.evac ?? "-"}`;
}
function virusLine(game) {
  const v = virusOf(game.player);
  if (!v) return "VIRUS none";
  const curing = v.curing === void 0 ? "-" : String(v.curing.left);
  return `VIRUS strain=${v.strain ?? "spasm"} slot=${v.slot} turns=${v.turns} curing=${curing}`;
}
function relicsLine(game) {
  const found = [];
  for (const room of game.ship.rooms) {
    for (const wreck of wrecksIn(game, room.id)) {
      if (wreck.source === "crate") found.push(`${wreck.kind}@${room.label}`);
    }
  }
  return found.length === 0 ? "RELICS none" : `RELICS ${found.join(", ")}`;
}
function debugLines(game) {
  const here3 = game.roomOf(game.player).id;
  const distances = RoomDistance.from(game.ship, [here3], passableForPlayer);
  const machines = machinesAboard2(game);
  return [
    alertLine(game),
    ...machines.length === 0 ? ["MACHINES none"] : machines.map((m) => machineLine(game, distances, m)),
    droneLine(game),
    rivalLine(game),
    virusLine(game),
    relicsLine(game)
  ];
}
function debugBlock(game, enabled) {
  return enabled ? debugLines(game) : [];
}

// ../../../smoreg_works/games/salvor/src/ui/panel.ts
var PANEL_WIDTH = LAYOUT.sidebarWidth - 1;
var PANEL_HEIGHT = LAYOUT.mapHeight;
var ROOM_LINES = 4;
var DOOR_LINES = 4;
var CONTACT_LINES = 6;
var LIST_FLOOR = 8;
var MISSION_LINES = 6;
var MISSION_FLOOR = 2;
var NO_FLASH = { integrity: [], slots: /* @__PURE__ */ new Set(), turn: -1 };
var NOBODY = /* @__PURE__ */ new Set();
function panelBlocks(game, actions, cursor = -1) {
  const foot = footBlocks(game, actions.some((a) => a.step === null));
  const need = isTug(game) ? listHeight(actions) + (omittedActions(actions).length > 0 ? 1 : 0) : Math.min(LIST_FLOOR, listHeight(actions));
  const fits = (rows2) => PANEL_HEIGHT - rows2.length - foot.length >= need;
  let head = headBlocks(game, ROOM_LINES, CONTACT_LINES, DOOR_LINES, MISSION_LINES);
  for (let allow = ROOM_LINES - 1; allow >= 0; allow--) {
    if (fits(head)) break;
    head = headBlocks(game, allow, CONTACT_LINES, DOOR_LINES, MISSION_LINES);
  }
  for (let allow = DOOR_LINES - 1; allow >= 1; allow--) {
    if (fits(head)) break;
    head = headBlocks(game, 0, CONTACT_LINES, allow, MISSION_LINES);
  }
  const airless = (rows2) => fits(squeezeAir(rows2, PANEL_HEIGHT - foot.length - need));
  for (let allow = MISSION_LINES - 1; allow >= MISSION_FLOOR; allow--) {
    if (airless(head)) break;
    head = headBlocks(game, 0, CONTACT_LINES, 1, allow);
  }
  const floor = Math.max(1, Math.min(contactsHere(game), CONTACT_LINES));
  for (let allow = CONTACT_LINES - 1; allow >= floor; allow--) {
    if (airless(head)) break;
    head = headBlocks(game, 0, allow, 1, MISSION_FLOOR);
  }
  head = squeezeAir(head, PANEL_HEIGHT - foot.length - need);
  if (isTug(game)) head = squeezeAir(head, PANEL_HEIGHT - foot.length - need, (l) => /^[✓·] /.test(l.text));
  const { rows, omitted } = fitList(actions, PANEL_HEIGHT - head.length - foot.length, cursor);
  const out2 = [...head, ...rows];
  if (omitted > 0 && out2.length < PANEL_HEIGHT - foot.length) {
    const reachable = omittedActions(actions).length > 0;
    const said2 = t(reachable ? "panel.more.arrows" : "panel.more", { n: Math.min(omitted, 99) });
    out2.push({ text: clip2(said2), fg: THEME.fgDim });
  }
  while (out2.length < PANEL_HEIGHT - foot.length) out2.push({ text: "" });
  out2.push(...foot);
  if (out2.length <= PANEL_HEIGHT) return out2;
  return [...out2.slice(0, PANEL_HEIGHT - foot.length), ...foot];
}
function headBlocks(game, allow, contacts, doors, mission) {
  const out2 = [];
  const push = (text3, fg) => {
    out2.push(fg === void 0 ? { text: clip2(text3) } : { text: clip2(text3), fg });
  };
  push(heading(game), THEME.accent);
  push(t("panel.turn", { n: game.schedule.time }), THEME.fgDim);
  const seen = contactsBlock(game, contacts);
  if (seen.length > 0) {
    out2.push({ text: "" });
    out2.push(...seen);
  }
  const goal = missionBlock(game, mission);
  if (goal.length > 0) {
    out2.push({ text: "" });
    out2.push(...goal);
  }
  const sick = virusOf(game.player)?.slot;
  let paragraph = true;
  for (const sys of game.systems) {
    const lines = sys.panelLines?.(game) ?? [];
    if (lines.length === 0) continue;
    if (lines.length > 1 || paragraph) out2.push({ text: "" });
    paragraph = lines.length > 1;
    for (const line2 of lines) {
      const infected = sick !== void 0 && slotNumberOf(line2.text) === sick;
      const text3 = clip2(infected ? `${line2.text} !` : line2.text);
      if (infected) out2.push({ text: text3, fg: THEME.bad });
      else out2.push(line2.fg === void 0 ? { text: text3 } : { text: text3, fg: line2.fg });
    }
  }
  const room = roomBlock(game, allow, doors);
  if (room.length > 0) {
    out2.push({ text: "" });
    for (const line2 of room) push(line2.text, line2.fg);
  }
  out2.push({ text: "" });
  push(t("panel.actions"), THEME.accent);
  return out2;
}
function missionBlock(game, allow = MISSION_LINES) {
  const goal = goalLines(game);
  if (isTug(game)) return dockedDerelict(game)?.sold === true ? [] : goal.slice(0, 1);
  const aboard2 = systemsAboard(game);
  if (aboard2.length === 0) return [];
  const systems = shipState(game).online.length >= OBJECTIVE_COUNT ? [] : systemsLines(game, aboard2.map((s) => s.kind)).map((text3) => ({ text: clip2(text3) }));
  const found = objectiveHere(game);
  const here3 = [];
  if (found) {
    const text3 = t("panel.goal.work", {
      mark: SYSTEM_GLYPH,
      system: objectiveName(found.spec),
      tool: toolName(found.job.tool),
      left: found.left
    });
    here3.push({ text: clip2(text3), fg: found.doable ? THEME.fg : THEME.fgDim });
  }
  const rows = [...goal, ...systems, ...here3, ...charterBlock(game)];
  if (rows.length <= allow) return rows;
  const short = [...goal, ...systems, ...here3];
  if (short.length <= allow) return short;
  const floor = [...goal, ...here3.length > 0 ? here3 : systems];
  return floor.length <= allow ? floor : goal.slice(0, Math.max(allow, MISSION_FLOOR));
}
function goalLines(game) {
  const state = derelictAboard(game) ?? dockedDerelict(game);
  const price = state?.spec.salePrice ?? 0;
  const up = isTug(game) ? state?.online.length ?? 0 : shipState(game).online.length;
  if (state?.sold === true) return [{ text: clip2(t("panel.goal.towed")), fg: THEME.good }];
  if (state !== void 0 && up >= OBJECTIVE_COUNT) {
    return [
      { text: clip2(t("panel.goal.done", { cr: price })), fg: THEME.good },
      { text: clip2(t("panel.goal.out")), fg: THEME.good }
    ];
  }
  const stuck = isTug(game) ? [] : unraisable(game);
  if (stuck.length > 0) {
    return [
      { text: clip2(t("panel.goal.noTool")), fg: THEME.bad },
      ...stuck.map((o) => ({ text: clip2(`${objectiveName(o)}: ${o.jobs.map((j) => toolName(j.tool)).join("/")}`) }))
    ];
  }
  const text3 = price > 0 ? t("panel.goal", { cr: price }) : t("panel.goal.bare");
  return [{ text: clip2(text3), fg: THEME.accent }];
}
function unraisable(game) {
  const online = shipState(game).online;
  const left = OBJECTIVES.filter(
    (o) => !online.includes(o.id) && systemsAboard(game).some((s) => s.kind === o.id)
  );
  const rig = rigOf(game.player);
  const keys = keysHeld2(game.player);
  return left.every((o) => o.needs(rig, keys) === void 0) ? left : [];
}
function dockedDerelict(game) {
  const voyage = voyageRecord(game);
  return voyage?.state[voyage.current];
}
function systemsLines(game, kinds) {
  const online = shipState(game).online;
  const where = systemRooms(game);
  const specs = OBJECTIVES.filter((o) => kinds.includes(o.id));
  const lost = specs.filter((o) => !online.includes(o.id) && !where.has(o.id));
  const tokens = specs.filter((o) => !lost.includes(o)).map((o) => online.includes(o.id) ? `\u2713${objectiveName(o)}` : `\xB7${objectiveName(o)} ${where.get(o.id)}`);
  const names = lost.map(objectiveName);
  const whole = [t("panel.systems.lost"), ...names].join(" ");
  if (lost.length > 0) tokens.push(...whole.length <= PANEL_WIDTH ? [whole] : [t("panel.systems.lost"), ...names]);
  return wrapped2(tokens, " ");
}
function systemRooms(game) {
  const out2 = /* @__PURE__ */ new Map();
  for (const room of game.ship.rooms) {
    if (room.explored !== true && room.scanned !== true) continue;
    for (const sys of roomList(room, "systems")) {
      if (!out2.has(sys.kind)) out2.set(sys.kind, room.label);
    }
  }
  return out2;
}
function charterBlock(game) {
  const voyage = voyageRecord(game);
  const state = derelictAboard(game);
  if (!voyage || !state) return [];
  const signed = voyage.charters.filter((c) => c.id !== "neutralize");
  if (signed.length === 0) return [];
  const out2 = [{ text: clip2(t("panel.charters")), fg: THEME.accent }];
  for (const charter of signed) {
    const done = charterDone(game, charter);
    out2.push({
      text: clip2(charterLine(charter, done, state.banked + voyage.loot, state.spec)),
      fg: done ? THEME.fgDim : THEME.fg
    });
  }
  return out2;
}
function charterLine(charter, done, loot, spec2) {
  const parts = { mark: done ? "\u2713" : "\xB7", name: tId("charter.name", charter.id, charter.id) };
  if (done) return t("panel.charter.plain", parts);
  if (charter.id === "salvage") {
    const need = salvageTarget(spec2);
    return t("panel.charter.loot", { ...parts, have: Math.min(loot, need), need });
  }
  const kind = charter.target?.kind;
  return kind === void 0 ? t("panel.charter.plain", parts) : t("panel.charter.where", { ...parts, room: zoneName(kind) });
}
function contactsBar(label3, fg) {
  const rule = "\u2550".repeat(Math.max(0, PANEL_WIDTH - label3.length - 4));
  return { text: clip2(`\u2550\u2550 ${label3} ${rule}`), fg };
}
function contactsBlock(game, allow = CONTACT_LINES) {
  const here3 = game.roomOf(game.player).id;
  const blows = blowsLastTurn(game);
  const found = contactsOf(game, here3);
  const shown = found.slice(0, Math.max(1, allow));
  if (shown.length === 0) return [];
  const rows = (group, inRoom2) => group.flatMap(({ machine, door }) => {
    const line2 = {
      text: contactLine(machine, inRoom2 ? void 0 : door?.label ?? "\u2192"),
      fg: contactTone(machine.hp, machine.hpMax),
      id: machine.id
    };
    const blow2 = blows.find((b) => b.subject.includes(machineName(machine.name).toLowerCase()));
    return blow2 ? [line2, { text: clip2(`   ${blow2.what}`), fg: THEME.bad }] : [line2];
  });
  const inRoom = shown.filter((c) => c.room === here3);
  const beyond = shown.filter((c) => c.room !== here3);
  const out2 = [];
  if (inRoom.length > 0) {
    const n = found.filter((c) => c.room === here3).length;
    out2.push(contactsBar(t("panel.contacts.here", { n }), THEME.bad));
    out2.push(...rows(inRoom, true));
  }
  if (beyond.length > 0) {
    const n = found.filter((c) => c.room !== here3).length;
    out2.push(contactsBar(t("panel.contacts.near", { n }), THEME.warn));
    out2.push(...rows(beyond, false));
  }
  if (found.length > shown.length) {
    const line2 = t("panel.contactsMore", { n: found.length - shown.length });
    out2.push({ text: clip2(line2), fg: THEME.fgDim });
  }
  return out2;
}
function contactsHere(game) {
  const room = game.roomOf(game.player).id;
  return contactsOf(game, room).filter((c) => c.room === room).length;
}
function contactsOf(game, here3) {
  const doors = game.ship.doorsOf(here3);
  const rooms = [here3, ...[...game.visible].filter((id) => id !== here3).sort((a, b) => a - b)];
  const seen = rooms.flatMap(
    (room) => hostilesIn(game, room).map((machine) => {
      const door = doors.find((d) => d.a !== d.b && game.ship.other(d, here3) === room);
      return door ? { machine, room, door } : { machine, room };
    })
  );
  return [...seen, ...strikersNear(game, here3)];
}
function contactTone(hp, hpMax) {
  if (hpMax <= 0 || hp >= hpMax) return THEME.hpFull;
  const share = hp / hpMax;
  if (share > 0.5) return THEME.fg;
  if (share > 0.25) return THEME.warn;
  return THEME.hpLow;
}
function contactLine(machine, door) {
  const hp = `${machine.hp}/${machine.hpMax}`;
  const place2 = door === void 0 ? "" : ` ${door}`;
  const tail = `${place2} ${dangerWord(machine, door !== void 0)}`;
  const room = PANEL_WIDTH - 3 - hp.length - tail.length;
  const name = clipName(machineName(machine.name), Math.max(3, room));
  return clip2(`${machine.ch} ${name} ${hp}${tail}`);
}
function footBlocks(game, nested = false) {
  return letterRows(game, nested).map((line2) => ({ text: clip2(line2), fg: THEME.fgDim }));
}
function squeezeAir(head, want, gives = (line2) => line2.text === "") {
  const out2 = [...head];
  for (let i = out2.length - 1; i >= 0 && out2.length > want; i--) {
    if (gives(out2[i])) out2.splice(i, 1);
  }
  return out2;
}
function listHeight(actions) {
  return actions.filter((a) => a.key !== "").reduce((n, a) => n + rowsOf(a), 0);
}
function rowsOf(action) {
  return 1 + (action.head === void 0 ? 0 : 1) + (action.extra === void 0 ? 0 : 1);
}
function fitList(actions, budget, cursor) {
  const groups = actions.filter((a) => a.key !== "").map((a) => {
    const at = actions.indexOf(a);
    const fg = at === cursor ? THEME.accent : a.enabled ? THEME.fg : THEME.fgDim;
    const rows2 = [];
    if (a.head !== void 0) rows2.push({ text: clip2(a.head), fg: THEME.accent });
    rows2.push({ text: clip2(`${at === cursor ? "\u25B8" : " "}${a.key} ${a.label}`), fg });
    if (a.extra !== void 0) rows2.push({ text: clip2(`   ${a.extra}`), fg: THEME.zone });
    return rows2;
  });
  const keyless = omittedActions(actions).length;
  const height = groups.reduce((n, g) => n + g.length, 0);
  if (keyless === 0 && height <= budget) return { rows: groups.flat(), omitted: 0 };
  const first = groups[0]?.length ?? 0;
  const room = budget - 1 >= first ? budget - 1 : Math.max(0, Math.min(budget, first));
  const rows = [];
  let kept = 0;
  for (const group of groups) {
    if (rows.length + group.length > room) break;
    rows.push(...group);
    kept++;
  }
  return { rows, omitted: keyless + (groups.length - kept) };
}
function heading(game) {
  if (isTug(game)) {
    const docked = hullWord(game, dockedDerelict(game), derelictNameOf(tag(game, "docked")));
    return docked === void 0 ? t("panel.head.tug") : t("panel.head.tugTo", { hull: docked });
  }
  const named2 = hullWord(game, derelictAboard(game), derelictNameOf(tag(game, "type")));
  const parts = [
    t("title.name"),
    named2 ?? t("word.derelict"),
    t("panel.sortie", { n: game.currentShip.visits })
  ];
  return parts.join("  ");
}
function hullWord(game, state, fallback) {
  if (state === void 0) return fallback;
  const callsign = flavourCallsign(state.flavour);
  const rest = isTug(game) ? t("panel.head.tugTo", { hull: "" }).length : t("title.name").length + 2 + t("panel.sortie", { n: game.currentShip.visits }).length + 2;
  return callsign.length + rest <= PANEL_WIDTH ? callsign : fallback;
}
function roomBlock(game, allow = ROOM_LINES, doors = DOOR_LINES) {
  if (isTug(game)) return [];
  const room = game.roomOf(game.player);
  const parts = { room: roomName(room), label: room.label };
  const out2 = doors >= 2 ? [{ text: t("panel.room", parts), fg: THEME.accent }, ...doorBlock(game, room.id, doors)] : [{ text: t("panel.roomDoors", { ...parts, doors: doorLabels(game, room.id, parts) }), fg: THEME.accent }];
  const content = thingsIn(game, room.id).filter((t2) => t2.glyph !== SYSTEM_GLYPH).map((t2) => ({ text: contentLine(t2.glyph, t2.name, "") }));
  if (allow <= 0) return out2;
  if (content.length <= allow) return [...out2, ...content];
  return [
    ...out2,
    ...content.slice(0, allow - 1),
    { text: ` ${t("panel.roomMore", { n: content.length - (allow - 1) })}`, fg: THEME.fgDim }
  ];
}
function doorLabels(game, here3, parts) {
  const labels = doorsOut(game, here3).map((d) => d.label);
  const spent = t("panel.roomDoors", { ...parts, doors: "" }).length;
  const kept = [];
  for (const label3 of labels) {
    const rest = labels.length - kept.length - 1;
    const tail = rest > 0 ? ` +${rest}` : "";
    const width = spent + kept.join(" ").length + (kept.length > 0 ? 1 : 0) + label3.length + tail.length;
    if (width > PANEL_WIDTH) break;
    kept.push(label3);
  }
  const left = labels.length - kept.length;
  return left > 0 ? [...kept, `+${left}`].join(" ") : kept.join(" ");
}
function doorBlock(game, here3, allow) {
  const doors = doorsOut(game, here3);
  const width = doors.reduce((n, d) => Math.max(n, d.label.length), 0);
  const lines = doors.map((d) => ({ text: doorLine2(game, here3, d, width), fg: THEME.zone }));
  if (lines.length <= allow) return lines;
  return [
    ...lines.slice(0, allow - 1),
    { text: clip2(` ${t("panel.doorMore", { n: lines.length - (allow - 1) })}`), fg: THEME.fgDim }
  ];
}
function doorsOut(game, here3) {
  return game.ship.doorsOf(here3).filter((d) => d.a !== d.b || d.state === "airlock");
}
function doorLine2(game, here3, door, width) {
  const state = doorStateWord(door.state === "airlock" ? "out" : door.state);
  const label3 = door.label.padEnd(width);
  const room = PANEL_WIDTH - 2 - label3.length - 3 - state.length;
  const name = clipName(farRoomName(game, door, here3), Math.max(2, room));
  const text3 = ` ${t("panel.doorTo", { door: label3, room: name })}`;
  return clip2(clipTo2(text3, PANEL_WIDTH - state.length - 1).padEnd(PANEL_WIDTH - state.length) + state);
}
function farRoomName(game, door, here3) {
  if (door.state === "airlock") return t("word.tug");
  const far = game.ship.roomAt(game.ship.other(door, here3));
  return far.explored || far.scanned || game.visible.has(far.id) ? roomName(far) : UNKNOWN_ROOM;
}
function contentLine(glyph, name, right) {
  const width = PANEL_WIDTH - 3 - right.length;
  const text3 = clipTo2(name, width - (right.length > 0 ? 1 : 0));
  return ` ${glyph} ${right.length > 0 ? text3.padEnd(width) : text3}${right}`;
}
function letterRows(game, nested) {
  if (isTug(game)) return [t(nested ? "panel.letters.tug" : "panel.letters.tugTop")];
  const first = [t("panel.letter.move"), t("panel.letter.doors"), t("panel.letter.brace")];
  if (game.roomOf(game.player).cover) first.push(t("panel.letter.hide"));
  if (!isTug(game)) first.push(t("panel.letter.leave"));
  return [...wrapped2(first), t("panel.letters")];
}
function wrapped2(tokens, gap = "  ") {
  const rows = [];
  for (const token of tokens) {
    const last = rows.length - 1;
    const row = rows[last];
    if (row !== void 0 && row.length + gap.length + token.length <= PANEL_WIDTH) rows[last] = `${row}${gap}${token}`;
    else rows.push(token);
  }
  return rows;
}
function panelColour(line2, flash, lit = NOBODY) {
  const slot = slotNumberOf(line2.text);
  if (slot !== void 0 && flash.has(slot)) return THEME.bad;
  if (line2.id !== void 0 && lit.has(line2.id)) return THEME.bad;
  if (line2.fg !== void 0) return line2.fg;
  if (line2.text.includes("\u25C0")) return THEME.accent;
  if (line2.text.includes("burned")) return THEME.burned;
  return THEME.fg;
}
function slotNumberOf(text3) {
  const n = Number(text3.slice(0, 1));
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : void 0;
}
function debugBlockLines(game, enabled) {
  return debugBlock(game, enabled).map((text3) => ({ text: clipTo2(text3, DEBUG_LINE_WIDTH), fg: THEME.fgDim }));
}
var DEBUG_LINE_WIDTH = 160;
function clip2(text3) {
  return clipTo2(text3, PANEL_WIDTH);
}
function clipTo2(text3, width) {
  if (text3.length <= width) return text3;
  return width <= 1 ? text3.slice(0, Math.max(0, width)) : `${text3.slice(0, width - 1)}\u2026`;
}
function codexBadge(game) {
  const unread = codexUnread(game);
  return unread === 0 ? void 0 : t("codex.badge", { n: unread });
}

// ../../../smoreg_works/packages/audio/src/plan.ts
function secondsPerBeat(grid) {
  return 60 / grid.bpm;
}

// ../../../smoreg_works/games/salvor/src/ui/music.ts
var GRID = { bpm: 74.9, beatsPerBar: 4, barsPerPhrase: 16 };
var BEAT_MS = secondsPerBeat(GRID) * 1e3;
var RAMP_SECONDS = 2 * BEAT_MS / 1e3;

// ../../../smoreg_works/games/salvor/src/ui/pulse.ts
var NOTHING_LIT = { ids: /* @__PURE__ */ new Set(), rooms: /* @__PURE__ */ new Set() };

// ../../../smoreg_works/games/salvor/src/ui/schematic.ts
var HEIGHT = 34;
var BOX_W = 9;
var COL_STEP = 13;
var GUTTER = COL_STEP - BOX_W;
var STEM = BOX_W + 1;
var INNER = BOX_W - 2;
var SHIP_LINE_Y = HEIGHT - 1;
var COUNTER_Y = HEIGHT - 3;
var TUG_W = 5;
var TUG_OFFSET = TUG_W + GUTTER;
var ROOM_FG = {
  unknown: THEME.fgDim,
  scanned: THEME.zone,
  explored: THEME.fg,
  visible: THEME.bright,
  current: THEME.accent
};
var SOLID = {
  h: "\u2500",
  v: "\u2502",
  tl: "\u250C",
  tr: "\u2510",
  bl: "\u2514",
  br: "\u2518",
  teeTop: "\u2534",
  teeBottom: "\u252C",
  portL: "\u2524",
  portR: "\u251C"
};
var DASHED = { ...SOLID, h: "\u254C", v: "\u2506" };
var TUG_GLYPH = "\u2302";

// ../../../smoreg_works/games/salvor/src/ui/tugboard.ts
function tugBoard(game) {
  const voyage = voyageOf(game);
  const state = currentDerelict(game);
  const alert = state.alert === 0 ? t("panel.quiet") : t("panel.alertAt", { n: state.alert });
  const out2 = [
    t("banner.tug", { callsign: tugCallsign(game.seed), hull: flavourCallsign(state.flavour) }),
    "",
    t("board.derelict", { hull: derelictName(state.spec), alert })
  ];
  if (state.sold) out2.push(t("panel.tow"));
  else out2.push(t("board.worth", { up: state.online.length, of: OBJECTIVE_COUNT, price: state.spec.salePrice }));
  out2.push(t("board.sorties", { n: voyage.sortie, lost: lostDrones(voyage.state) }));
  out2.push("", t("board.rack"));
  for (const hull3 of HULLS) {
    out2.push(
      voyage.hull === hull3.id ? ` ${t("board.hull.yours", { hull: hullName(hull3) })}` : ` ${t("board.hull", { hull: hullName(hull3), price: hull3.price, trait: hullTrait(hull3) })}`
    );
  }
  out2.push("", t("board.mode"));
  return out2;
}
function lostDrones(state) {
  return state.reduce((n, s) => n + s.deaths.length, 0);
}

// ../../../smoreg_works/games/salvor/src/ui/render.ts
function endingBanners() {
  return {
    dead: { title: t("end.dead"), fg: THEME.bad, why: t("end.dead.why") },
    lost: { title: t("end.lost"), fg: THEME.bad },
    won: { title: t("end.won"), fg: THEME.good, why: t("end.won.why") },
    sold: { title: t("end.sold"), fg: THEME.good }
  };
}
function restartHint() {
  return t("end.again");
}
var RUN_OVER = /* @__PURE__ */ new Set(["dead", "won"]);
function endHint(overlay) {
  return RUN_OVER.has(overlay) ? t("end.again") : t("end.go");
}
function cardTitles() {
  return { help: t("help.title"), crash: t("crash.title"), history: t("log.title") };
}
function historyFooter(page2, pages) {
  return t("log.page", { n: page2 + 1, of: pages });
}
var PANEL_X = LAYOUT.mapWidth + 1;
function latestAlarm(lines) {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].tone === "alarm") return i;
  return -1;
}
function runSummary(game) {
  const burned2 = rigOf(game.player)?.burnedCount ?? 0;
  return t("end.summary", {
    cr: voyageRecord(game)?.credits ?? 0,
    rooms: voyageProgress(game),
    turns: game.schedule.time,
    kills: game.kills,
    burned: burned2
  });
}

// ../../../smoreg_works/games/salvor/src/tiles/sprites.ts
var TILE_DEFS = '<symbol id="tile-machine-maintenance-bot" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="4" y="3" width="4" height="1"/><rect x="9" y="3" width="1" height="5"/><rect x="2" y="4" width="7" height="3"/><rect x="2" y="7" width="3" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="1" y="8" width="10" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="3" y="9" width="1" height="1"/><rect x="5" y="9" width="2" height="1"/><rect x="8" y="9" width="1" height="1"/><rect x="10" y="9" width="1" height="1"/></symbol><symbol id="tile-machine-feral-drone" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="2" height="2"/><rect x="9" y="2" width="2" height="2"/><rect x="2" y="4" width="2" height="1"/><rect x="8" y="4" width="2" height="1"/><rect x="3" y="5" width="6" height="1"/><rect x="3" y="6" width="1" height="1"/><rect x="5" y="6" width="2" height="1"/><rect x="8" y="6" width="1" height="2"/><rect x="3" y="7" width="5" height="1"/><rect x="2" y="8" width="2" height="1"/><rect x="8" y="8" width="2" height="1"/><rect x="1" y="9" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/></symbol><symbol id="tile-machine-scout" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="1" height="2"/><rect x="3" y="3" width="5" height="1"/><rect x="2" y="4" width="7" height="1"/><rect x="2" y="5" width="2" height="2"/><rect x="7" y="5" width="2" height="3"/><rect x="2" y="7" width="5" height="1"/><rect x="3" y="8" width="5" height="1"/><rect x="4" y="9" width="1" height="2"/><rect x="6" y="9" width="1" height="1"/><rect x="3" y="10" width="1" height="1"/><rect x="6" y="10" width="2" height="1"/></symbol><symbol id="tile-machine-security-unit" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="1" width="6" height="1"/><rect x="2" y="2" width="8" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="4" y="3" width="4" height="1"/><rect x="9" y="3" width="1" height="2"/><rect x="2" y="4" width="7" height="1"/><rect x="1" y="5" width="10" height="3"/><rect x="2" y="8" width="8" height="1"/><rect x="3" y="9" width="2" height="3"/><rect x="7" y="9" width="2" height="2"/><rect x="2" y="11" width="1" height="1"/><rect x="7" y="11" width="3" height="1"/></symbol><symbol id="tile-machine-welder-bot" viewBox="0 0 12 12" fill="currentColor"><rect x="7" y="1" width="1" height="1"/><rect x="6" y="2" width="1" height="4"/><rect x="2" y="3" width="4" height="1"/><rect x="2" y="4" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="2" y="5" width="4" height="1"/><rect x="2" y="6" width="6" height="2"/><rect x="2" y="8" width="2" height="2"/><rect x="6" y="8" width="2" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="6" y="9" width="3" height="1"/></symbol><symbol id="tile-machine-hauler" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="10" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="3" y="3" width="6" height="1"/><rect x="10" y="3" width="1" height="8"/><rect x="1" y="4" width="9" height="4"/><rect x="1" y="8" width="4" height="1"/><rect x="7" y="8" width="3" height="2"/><rect x="1" y="9" width="6" height="1"/><rect x="1" y="10" width="1" height="1"/><rect x="3" y="10" width="1" height="1"/><rect x="5" y="10" width="2" height="1"/><rect x="8" y="10" width="1" height="1"/></symbol><symbol id="tile-machine-scrapper" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="1" height="1"/><rect x="10" y="1" width="1" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="9" y="2" width="1" height="1"/><rect x="3" y="3" width="6" height="1"/><rect x="2" y="4" width="1" height="1"/><rect x="4" y="4" width="4" height="1"/><rect x="9" y="4" width="1" height="3"/><rect x="2" y="5" width="7" height="2"/><rect x="3" y="7" width="6" height="1"/><rect x="2" y="8" width="1" height="1"/><rect x="4" y="8" width="1" height="2"/><rect x="7" y="8" width="1" height="2"/><rect x="9" y="8" width="1" height="1"/><rect x="1" y="9" width="1" height="2"/><rect x="10" y="9" width="1" height="2"/></symbol><symbol id="tile-machine-arc-sentinel" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="0" width="4" height="1"/><rect x="3" y="1" width="6" height="1"/><rect x="3" y="2" width="1" height="1"/><rect x="8" y="2" width="1" height="2"/><rect x="3" y="3" width="5" height="1"/><rect x="2" y="4" width="8" height="1"/><rect x="1" y="5" width="1" height="1"/><rect x="3" y="5" width="6" height="1"/><rect x="10" y="5" width="1" height="1"/><rect x="4" y="6" width="4" height="2"/><rect x="3" y="8" width="2" height="3"/><rect x="7" y="8" width="2" height="2"/><rect x="2" y="10" width="1" height="1"/><rect x="7" y="10" width="3" height="1"/></symbol><symbol id="tile-machine-sentry-turret" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="2" height="4"/><rect x="3" y="5" width="6" height="1"/><rect x="2" y="6" width="1" height="1"/><rect x="4" y="6" width="4" height="1"/><rect x="9" y="6" width="1" height="2"/><rect x="2" y="7" width="7" height="1"/><rect x="1" y="8" width="10" height="3"/></symbol><symbol id="tile-machine-jammer" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="8" height="1"/><rect x="1" y="2" width="10" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="10" y="3" width="1" height="1"/><rect x="2" y="4" width="1" height="1"/><rect x="9" y="4" width="1" height="1"/><rect x="3" y="5" width="6" height="1"/><rect x="5" y="6" width="2" height="3"/><rect x="3" y="9" width="6" height="1"/><rect x="2" y="10" width="8" height="1"/></symbol><symbol id="tile-machine-crawler" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="1" height="1"/><rect x="10" y="2" width="1" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="9" y="3" width="1" height="1"/><rect x="3" y="4" width="6" height="1"/><rect x="2" y="5" width="1" height="1"/><rect x="4" y="5" width="4" height="1"/><rect x="9" y="5" width="1" height="1"/><rect x="1" y="6" width="10" height="1"/><rect x="2" y="7" width="8" height="1"/><rect x="3" y="8" width="6" height="1"/><rect x="2" y="9" width="1" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="7" y="9" width="1" height="1"/><rect x="9" y="9" width="1" height="1"/><rect x="1" y="10" width="1" height="1"/><rect x="3" y="10" width="1" height="1"/><rect x="8" y="10" width="1" height="1"/><rect x="10" y="10" width="1" height="1"/></symbol><symbol id="tile-machine-bloom" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="1" height="1"/><rect x="7" y="1" width="1" height="1"/><rect x="3" y="2" width="1" height="1"/><rect x="5" y="2" width="2" height="1"/><rect x="8" y="2" width="1" height="1"/><rect x="4" y="3" width="4" height="1"/><rect x="3" y="4" width="6" height="1"/><rect x="2" y="5" width="3" height="1"/><rect x="7" y="5" width="3" height="3"/><rect x="2" y="6" width="5" height="1"/><rect x="2" y="7" width="3" height="1"/><rect x="3" y="8" width="6" height="1"/><rect x="4" y="9" width="4" height="1"/><rect x="3" y="10" width="2" height="1"/><rect x="7" y="10" width="2" height="1"/></symbol><symbol id="tile-machine-enforcer" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="0" width="1" height="1"/><rect x="9" y="0" width="1" height="5"/><rect x="2" y="1" width="2" height="1"/><rect x="8" y="1" width="1" height="2"/><rect x="2" y="2" width="6" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="5" y="3" width="2" height="1"/><rect x="2" y="4" width="7" height="1"/><rect x="1" y="5" width="10" height="3"/><rect x="2" y="8" width="8" height="1"/><rect x="2" y="9" width="2" height="2"/><rect x="8" y="9" width="2" height="1"/><rect x="1" y="10" width="1" height="1"/><rect x="8" y="10" width="3" height="1"/></symbol><symbol id="tile-actor-drone" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="4" height="1"/><rect x="3" y="2" width="2" height="1"/><rect x="7" y="2" width="2" height="1"/><rect x="2" y="3" width="8" height="1"/><rect x="1" y="4" width="10" height="1"/><rect x="1" y="5" width="1" height="2"/><rect x="3" y="5" width="6" height="2"/><rect x="10" y="5" width="1" height="3"/><rect x="1" y="7" width="9" height="1"/><rect x="2" y="8" width="8" height="1"/><rect x="3" y="9" width="2" height="2"/><rect x="7" y="9" width="2" height="1"/><rect x="2" y="10" width="1" height="1"/><rect x="7" y="10" width="3" height="1"/></symbol><symbol id="tile-actor-ghost" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="4" height="1"/><rect x="3" y="2" width="2" height="1"/><rect x="7" y="2" width="2" height="1"/><rect x="2" y="3" width="2" height="1"/><rect x="8" y="3" width="2" height="1"/><rect x="1" y="4" width="1" height="4"/><rect x="10" y="4" width="1" height="4"/><rect x="3" y="5" width="1" height="2"/><rect x="8" y="5" width="1" height="2"/><rect x="2" y="8" width="1" height="1"/><rect x="9" y="8" width="1" height="1"/><rect x="3" y="9" width="2" height="1"/><rect x="7" y="9" width="2" height="1"/><rect x="2" y="10" width="1" height="1"/><rect x="4" y="10" width="1" height="1"/><rect x="7" y="10" width="1" height="1"/><rect x="9" y="10" width="1" height="1"/></symbol><symbol id="tile-actor-rival-drone" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="0" width="2" height="2"/><rect x="4" y="2" width="4" height="1"/><rect x="3" y="3" width="1" height="1"/><rect x="5" y="3" width="2" height="1"/><rect x="8" y="3" width="1" height="2"/><rect x="3" y="4" width="5" height="1"/><rect x="2" y="5" width="8" height="2"/><rect x="2" y="7" width="2" height="3"/><rect x="8" y="7" width="2" height="2"/><rect x="1" y="9" width="1" height="1"/><rect x="8" y="9" width="3" height="1"/></symbol><symbol id="tile-module-cutter" viewBox="0 0 12 12" fill="currentColor"><rect x="9" y="1" width="2" height="1"/><rect x="8" y="2" width="2" height="1"/><rect x="7" y="3" width="2" height="1"/><rect x="6" y="4" width="2" height="1"/><rect x="5" y="5" width="2" height="1"/><rect x="2" y="6" width="1" height="1"/><rect x="4" y="6" width="2" height="1"/><rect x="2" y="7" width="3" height="2"/><rect x="1" y="8" width="1" height="1"/><rect x="1" y="9" width="3" height="1"/></symbol><symbol id="tile-module-thrusters" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="8" height="1"/><rect x="2" y="2" width="1" height="1"/><rect x="9" y="2" width="1" height="2"/><rect x="2" y="3" width="7" height="1"/><rect x="3" y="4" width="6" height="1"/><rect x="4" y="5" width="4" height="2"/><rect x="3" y="8" width="1" height="1"/><rect x="5" y="8" width="2" height="3"/><rect x="8" y="8" width="1" height="1"/><rect x="2" y="9" width="1" height="2"/><rect x="9" y="9" width="1" height="2"/><rect x="3" y="11" width="1" height="1"/><rect x="8" y="11" width="1" height="1"/></symbol><symbol id="tile-module-scanner" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="4" height="1"/><rect x="2" y="2" width="2" height="1"/><rect x="8" y="2" width="2" height="1"/><rect x="1" y="3" width="1" height="6"/><rect x="4" y="3" width="4" height="1"/><rect x="10" y="3" width="1" height="6"/><rect x="3" y="4" width="2" height="1"/><rect x="7" y="4" width="2" height="1"/><rect x="3" y="5" width="1" height="2"/><rect x="5" y="5" width="2" height="2"/><rect x="8" y="5" width="1" height="3"/><rect x="3" y="7" width="2" height="1"/><rect x="7" y="7" width="1" height="2"/><rect x="4" y="8" width="3" height="1"/><rect x="2" y="9" width="2" height="1"/><rect x="8" y="9" width="2" height="1"/><rect x="4" y="10" width="4" height="1"/></symbol><symbol id="tile-module-plating" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="8" height="6"/><rect x="3" y="7" width="6" height="2"/><rect x="4" y="9" width="4" height="1"/><rect x="5" y="10" width="2" height="1"/></symbol><symbol id="tile-module-cell" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="4" height="2"/><rect x="1" y="3" width="10" height="1"/><rect x="1" y="4" width="1" height="5"/><rect x="10" y="4" width="1" height="6"/><rect x="3" y="5" width="6" height="1"/><rect x="3" y="7" width="6" height="1"/><rect x="1" y="9" width="9" height="1"/></symbol><symbol id="tile-module-emp" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="2" height="3"/><rect x="1" y="2" width="1" height="1"/><rect x="10" y="2" width="1" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="9" y="3" width="1" height="1"/><rect x="3" y="4" width="6" height="4"/><rect x="0" y="5" width="2" height="2"/><rect x="10" y="5" width="2" height="2"/><rect x="2" y="8" width="1" height="1"/><rect x="5" y="8" width="2" height="3"/><rect x="9" y="8" width="1" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="10" y="9" width="1" height="1"/></symbol><symbol id="tile-module-welder" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="1" height="1"/><rect x="4" y="2" width="1" height="2"/><rect x="6" y="2" width="1" height="2"/><rect x="5" y="4" width="1" height="2"/><rect x="4" y="6" width="3" height="3"/><rect x="3" y="9" width="5" height="2"/></symbol><symbol id="tile-module-laser" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="5" height="1"/><rect x="2" y="3" width="1" height="6"/><rect x="6" y="3" width="1" height="2"/><rect x="6" y="5" width="6" height="2"/><rect x="6" y="7" width="1" height="3"/><rect x="2" y="9" width="4" height="1"/></symbol><symbol id="tile-module-spike" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="0" width="2" height="7"/><rect x="4" y="7" width="4" height="1"/><rect x="3" y="8" width="2" height="2"/><rect x="7" y="8" width="2" height="3"/><rect x="3" y="10" width="4" height="1"/></symbol><symbol id="tile-module-emitter" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="1"/><rect x="2" y="2" width="4" height="1"/><rect x="9" y="2" width="1" height="1"/><rect x="2" y="3" width="5" height="1"/><rect x="8" y="3" width="1" height="2"/><rect x="2" y="4" width="6" height="2"/><rect x="2" y="6" width="7" height="1"/><rect x="2" y="7" width="5" height="1"/><rect x="8" y="7" width="1" height="1"/><rect x="2" y="8" width="4" height="1"/><rect x="9" y="8" width="1" height="1"/><rect x="2" y="9" width="3" height="1"/></symbol><symbol id="tile-module-baffle" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="8"/><rect x="10" y="2" width="1" height="9"/><rect x="3" y="3" width="6" height="1"/><rect x="3" y="4" width="1" height="4"/><rect x="8" y="4" width="1" height="5"/><rect x="5" y="5" width="2" height="2"/><rect x="3" y="8" width="5" height="1"/><rect x="1" y="10" width="9" height="1"/></symbol><symbol id="tile-module-blade" viewBox="0 0 12 12" fill="currentColor"><rect x="9" y="0" width="2" height="2"/><rect x="8" y="1" width="1" height="1"/><rect x="7" y="2" width="3" height="1"/><rect x="6" y="3" width="3" height="1"/><rect x="5" y="4" width="3" height="1"/><rect x="4" y="5" width="3" height="1"/><rect x="3" y="6" width="3" height="1"/><rect x="2" y="7" width="5" height="1"/><rect x="1" y="8" width="1" height="1"/><rect x="5" y="8" width="2" height="1"/><rect x="1" y="9" width="5" height="1"/><rect x="9" y="10" width="2" height="2"/></symbol><symbol id="tile-module-shocker" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="4" height="1"/><rect x="4" y="2" width="4" height="1"/><rect x="3" y="3" width="4" height="1"/><rect x="2" y="4" width="7" height="1"/><rect x="5" y="5" width="4" height="1"/><rect x="4" y="6" width="4" height="1"/><rect x="3" y="7" width="4" height="1"/><rect x="2" y="8" width="3" height="1"/><rect x="9" y="10" width="2" height="2"/></symbol><symbol id="tile-module-lattice" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="0" width="10" height="1"/><rect x="1" y="1" width="1" height="1"/><rect x="4" y="1" width="1" height="1"/><rect x="7" y="1" width="1" height="1"/><rect x="10" y="1" width="1" height="8"/><rect x="1" y="2" width="9" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="4" y="3" width="1" height="1"/><rect x="7" y="3" width="1" height="1"/><rect x="1" y="4" width="9" height="1"/><rect x="1" y="5" width="1" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="7" y="5" width="1" height="1"/><rect x="1" y="6" width="9" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="1" y="8" width="9" height="1"/><rect x="9" y="10" width="2" height="2"/></symbol><symbol id="tile-thing-crate" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="2" height="1"/><rect x="9" y="2" width="2" height="1"/><rect x="1" y="3" width="1" height="6"/><rect x="3" y="3" width="1" height="1"/><rect x="8" y="3" width="1" height="1"/><rect x="10" y="3" width="1" height="8"/><rect x="4" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/><rect x="5" y="5" width="2" height="2"/><rect x="4" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="3" y="8" width="1" height="1"/><rect x="8" y="8" width="1" height="1"/><rect x="1" y="9" width="2" height="1"/><rect x="9" y="9" width="1" height="2"/><rect x="1" y="10" width="8" height="1"/></symbol><symbol id="tile-thing-scrap" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="2" height="2"/><rect x="8" y="2" width="2" height="2"/><rect x="7" y="3" width="1" height="1"/><rect x="7" y="4" width="2" height="1"/><rect x="3" y="5" width="3" height="1"/><rect x="2" y="6" width="5" height="1"/><rect x="3" y="7" width="3" height="1"/><rect x="8" y="7" width="2" height="2"/><rect x="2" y="9" width="2" height="2"/></symbol><symbol id="tile-thing-body" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2" width="6" height="1"/><rect x="2" y="3" width="8" height="1"/><rect x="2" y="4" width="1" height="2"/><rect x="5" y="4" width="2" height="2"/><rect x="9" y="4" width="1" height="3"/><rect x="2" y="6" width="7" height="1"/><rect x="3" y="7" width="6" height="1"/><rect x="3" y="8" width="1" height="1"/><rect x="5" y="8" width="2" height="1"/><rect x="8" y="8" width="1" height="2"/><rect x="3" y="9" width="5" height="1"/></symbol><symbol id="tile-thing-parcel" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="4" height="1"/><rect x="3" y="2" width="2" height="1"/><rect x="7" y="2" width="2" height="1"/><rect x="1" y="3" width="10" height="2"/><rect x="1" y="5" width="4" height="2"/><rect x="7" y="5" width="4" height="5"/><rect x="1" y="7" width="6" height="3"/></symbol><symbol id="tile-thing-keycard" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="10" height="1"/><rect x="1" y="3" width="1" height="5"/><rect x="10" y="3" width="1" height="6"/><rect x="3" y="4" width="3" height="1"/><rect x="3" y="5" width="1" height="1"/><rect x="5" y="5" width="1" height="2"/><rect x="3" y="6" width="2" height="1"/><rect x="1" y="8" width="9" height="1"/></symbol><symbol id="tile-thing-vented" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="2" height="1"/><rect x="8" y="2" width="2" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="4" y="3" width="1" height="1"/><rect x="7" y="3" width="1" height="1"/><rect x="10" y="3" width="1" height="1"/><rect x="0" y="4" width="1" height="1"/><rect x="5" y="4" width="2" height="1"/><rect x="11" y="4" width="1" height="1"/><rect x="2" y="6" width="2" height="1"/><rect x="8" y="6" width="2" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="10" y="7" width="1" height="1"/><rect x="0" y="8" width="1" height="1"/><rect x="5" y="8" width="2" height="1"/><rect x="11" y="8" width="1" height="1"/></symbol><symbol id="tile-thing-system" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="8"/><rect x="10" y="2" width="1" height="9"/><rect x="5" y="3" width="2" height="2"/><rect x="3" y="5" width="6" height="2"/><rect x="5" y="7" width="2" height="2"/><rect x="1" y="10" width="9" height="1"/></symbol><symbol id="tile-thing-system-online" viewBox="0 0 12 12" fill="currentColor"><rect x="10" y="1" width="1" height="2"/><rect x="9" y="2" width="1" height="2"/><rect x="8" y="3" width="1" height="2"/><rect x="7" y="4" width="1" height="2"/><rect x="0" y="5" width="1" height="1"/><rect x="6" y="5" width="1" height="2"/><rect x="0" y="6" width="2" height="1"/><rect x="5" y="6" width="1" height="2"/><rect x="1" y="7" width="2" height="1"/><rect x="4" y="7" width="1" height="2"/><rect x="2" y="8" width="2" height="1"/><rect x="3" y="9" width="1" height="1"/></symbol><symbol id="tile-thing-cover" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="3" width="6" height="1"/><rect x="2" y="4" width="8" height="1"/><rect x="1" y="5" width="4" height="1"/><rect x="7" y="5" width="4" height="1"/><rect x="1" y="6" width="3" height="3"/><rect x="8" y="6" width="3" height="5"/><rect x="1" y="9" width="7" height="2"/></symbol><symbol id="tile-door-open" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="2" height="9"/><rect x="9" y="1" width="2" height="10"/><rect x="1" y="10" width="8" height="1"/></symbol><symbol id="tile-door-closed" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="4" height="8"/><rect x="7" y="2" width="4" height="9"/><rect x="1" y="10" width="6" height="1"/></symbol><symbol id="tile-door-locked" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="7"/><rect x="10" y="2" width="1" height="8"/><rect x="4" y="3" width="4" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/><rect x="3" y="5" width="6" height="3"/><rect x="1" y="9" width="9" height="1"/></symbol><symbol id="tile-door-sealed" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="1"/><rect x="3" y="2" width="6" height="1"/><rect x="10" y="2" width="1" height="9"/><rect x="1" y="3" width="2" height="1"/><rect x="4" y="3" width="4" height="1"/><rect x="9" y="3" width="1" height="6"/><rect x="1" y="4" width="3" height="1"/><rect x="5" y="4" width="2" height="1"/><rect x="8" y="4" width="1" height="4"/><rect x="1" y="5" width="4" height="2"/><rect x="7" y="5" width="1" height="2"/><rect x="1" y="7" width="3" height="1"/><rect x="5" y="7" width="2" height="1"/><rect x="1" y="8" width="2" height="1"/><rect x="4" y="8" width="4" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="3" y="9" width="6" height="1"/><rect x="1" y="10" width="9" height="1"/></symbol><symbol id="tile-door-broken" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="4" height="1"/><rect x="7" y="2" width="4" height="1"/><rect x="1" y="3" width="3" height="1"/><rect x="9" y="3" width="2" height="1"/><rect x="1" y="4" width="2" height="1"/><rect x="10" y="4" width="1" height="7"/><rect x="1" y="5" width="1" height="2"/><rect x="1" y="7" width="2" height="1"/><rect x="9" y="7" width="1" height="4"/><rect x="1" y="8" width="3" height="1"/><rect x="8" y="8" width="1" height="3"/><rect x="1" y="9" width="4" height="1"/><rect x="6" y="9" width="2" height="2"/><rect x="1" y="10" width="5" height="1"/></symbol><symbol id="tile-door-airlock" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="1" width="6" height="1"/><rect x="2" y="2" width="8" height="1"/><rect x="1" y="3" width="4" height="1"/><rect x="7" y="3" width="4" height="1"/><rect x="1" y="4" width="3" height="1"/><rect x="8" y="4" width="3" height="1"/><rect x="1" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="4"/><rect x="1" y="7" width="3" height="1"/><rect x="8" y="7" width="1" height="2"/><rect x="1" y="8" width="4" height="1"/><rect x="7" y="8" width="1" height="1"/><rect x="2" y="9" width="8" height="1"/><rect x="3" y="10" width="6" height="1"/></symbol><symbol id="tile-zone-docking" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="7"/><rect x="10" y="2" width="1" height="8"/><rect x="4" y="3" width="4" height="1"/><rect x="3" y="4" width="2" height="1"/><rect x="7" y="4" width="2" height="1"/><rect x="3" y="5" width="1" height="1"/><rect x="8" y="5" width="1" height="2"/><rect x="3" y="6" width="2" height="1"/><rect x="7" y="6" width="1" height="2"/><rect x="4" y="7" width="3" height="1"/><rect x="1" y="9" width="9" height="1"/></symbol><symbol id="tile-zone-cargo" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2" width="6" height="1"/><rect x="3" y="3" width="1" height="1"/><rect x="8" y="3" width="1" height="2"/><rect x="3" y="4" width="5" height="1"/><rect x="1" y="5" width="10" height="1"/><rect x="1" y="6" width="1" height="2"/><rect x="10" y="6" width="1" height="3"/><rect x="1" y="8" width="9" height="1"/></symbol><symbol id="tile-zone-corridor" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="3" y="3" width="2" height="1"/><rect x="7" y="3" width="2" height="1"/><rect x="3" y="7" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="1" y="9" width="10" height="1"/></symbol><symbol id="tile-zone-storage" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="1"/><rect x="10" y="2" width="1" height="8"/><rect x="1" y="3" width="9" height="1"/><rect x="1" y="4" width="1" height="1"/><rect x="1" y="5" width="9" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="1" y="7" width="9" height="1"/><rect x="1" y="8" width="1" height="1"/><rect x="1" y="9" width="9" height="1"/></symbol><symbol id="tile-zone-maintenance" viewBox="0 0 12 12" fill="currentColor"><rect x="7" y="1" width="4" height="1"/><rect x="6" y="2" width="2" height="1"/><rect x="10" y="2" width="1" height="3"/><rect x="6" y="3" width="1" height="2"/><rect x="5" y="4" width="1" height="2"/><rect x="9" y="4" width="1" height="2"/><rect x="4" y="5" width="1" height="2"/><rect x="7" y="5" width="2" height="1"/><rect x="3" y="6" width="1" height="2"/><rect x="6" y="6" width="2" height="1"/><rect x="2" y="7" width="1" height="2"/><rect x="5" y="7" width="2" height="1"/><rect x="1" y="8" width="1" height="1"/><rect x="4" y="8" width="2" height="1"/><rect x="1" y="9" width="4" height="1"/><rect x="1" y="10" width="3" height="1"/></symbol><symbol id="tile-zone-hab" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="10" height="1"/><rect x="1" y="3" width="1" height="6"/><rect x="10" y="3" width="1" height="7"/><rect x="3" y="4" width="6" height="1"/><rect x="3" y="7" width="6" height="1"/><rect x="1" y="9" width="9" height="1"/></symbol><symbol id="tile-zone-mess" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="1" height="3"/><rect x="8" y="2" width="2" height="6"/><rect x="2" y="5" width="3" height="1"/><rect x="3" y="6" width="1" height="2"/><rect x="1" y="8" width="10" height="2"/></symbol><symbol id="tile-zone-hydroponics" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="1" height="7"/><rect x="2" y="2" width="2" height="1"/><rect x="7" y="2" width="2" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="8" y="3" width="1" height="1"/><rect x="3" y="4" width="1" height="1"/><rect x="7" y="4" width="1" height="1"/><rect x="1" y="8" width="10" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="10" y="9" width="1" height="2"/><rect x="1" y="10" width="9" height="1"/></symbol><symbol id="tile-zone-med" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="2" width="4" height="3"/><rect x="1" y="5" width="10" height="2"/><rect x="4" y="7" width="4" height="3"/></symbol><symbol id="tile-zone-lab" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="1" width="6" height="1"/><rect x="5" y="2" width="2" height="2"/><rect x="4" y="4" width="4" height="2"/><rect x="3" y="6" width="6" height="1"/><rect x="2" y="7" width="8" height="3"/><rect x="3" y="10" width="6" height="1"/></symbol><symbol id="tile-zone-quarantine" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="1" width="2" height="1"/><rect x="4" y="2" width="4" height="1"/><rect x="4" y="3" width="1" height="2"/><rect x="7" y="3" width="1" height="1"/><rect x="3" y="4" width="1" height="3"/><rect x="7" y="4" width="2" height="1"/><rect x="5" y="5" width="2" height="3"/><rect x="8" y="5" width="1" height="1"/><rect x="2" y="6" width="1" height="2"/><rect x="8" y="6" width="2" height="1"/><rect x="9" y="7" width="1" height="1"/><rect x="1" y="8" width="1" height="1"/><rect x="10" y="8" width="1" height="2"/><rect x="1" y="9" width="9" height="1"/></symbol><symbol id="tile-zone-engineering" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="1" width="1" height="1"/><rect x="5" y="1" width="2" height="1"/><rect x="8" y="1" width="1" height="1"/><rect x="2" y="2" width="8" height="2"/><rect x="1" y="4" width="3" height="1"/><rect x="8" y="4" width="3" height="1"/><rect x="1" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="3"/><rect x="1" y="7" width="3" height="1"/><rect x="8" y="7" width="1" height="1"/><rect x="2" y="8" width="8" height="2"/><rect x="3" y="10" width="1" height="1"/><rect x="5" y="10" width="2" height="1"/><rect x="8" y="10" width="1" height="1"/></symbol><symbol id="tile-zone-workshop" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="8" height="1"/><rect x="1" y="3" width="10" height="1"/><rect x="2" y="4" width="8" height="1"/><rect x="4" y="5" width="4" height="2"/><rect x="3" y="7" width="6" height="1"/><rect x="2" y="8" width="8" height="1"/><rect x="1" y="9" width="10" height="1"/></symbol><symbol id="tile-zone-armory" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="1" height="1"/><rect x="10" y="1" width="1" height="2"/><rect x="1" y="2" width="2" height="1"/><rect x="9" y="2" width="1" height="2"/><rect x="2" y="3" width="2" height="1"/><rect x="8" y="3" width="1" height="2"/><rect x="3" y="4" width="2" height="1"/><rect x="7" y="4" width="1" height="3"/><rect x="4" y="5" width="3" height="2"/><rect x="3" y="7" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="2" y="8" width="2" height="1"/><rect x="8" y="8" width="2" height="1"/><rect x="1" y="9" width="2" height="1"/><rect x="9" y="9" width="2" height="1"/><rect x="1" y="10" width="1" height="1"/><rect x="10" y="10" width="1" height="1"/></symbol><symbol id="tile-zone-reactor" viewBox="0 0 12 12" fill="currentColor"><rect x="4" y="1" width="4" height="1"/><rect x="2" y="2" width="2" height="1"/><rect x="8" y="2" width="2" height="1"/><rect x="1" y="3" width="1" height="6"/><rect x="5" y="3" width="2" height="1"/><rect x="10" y="3" width="1" height="2"/><rect x="4" y="4" width="4" height="4"/><rect x="0" y="5" width="1" height="2"/><rect x="10" y="5" width="2" height="2"/><rect x="10" y="7" width="1" height="2"/><rect x="5" y="8" width="2" height="1"/><rect x="2" y="9" width="2" height="1"/><rect x="8" y="9" width="2" height="1"/><rect x="4" y="10" width="4" height="1"/></symbol><symbol id="tile-zone-control" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="1" height="5"/><rect x="10" y="2" width="1" height="6"/><rect x="3" y="3" width="1" height="1"/><rect x="8" y="3" width="1" height="1"/><rect x="4" y="5" width="4" height="1"/><rect x="1" y="7" width="9" height="1"/><rect x="4" y="8" width="4" height="1"/><rect x="3" y="9" width="6" height="1"/></symbol><symbol id="tile-zone-coreaccess" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="2" height="2"/><rect x="9" y="1" width="2" height="9"/><rect x="1" y="3" width="8" height="1"/><rect x="1" y="4" width="2" height="1"/><rect x="1" y="5" width="8" height="1"/><rect x="1" y="6" width="2" height="1"/><rect x="1" y="7" width="8" height="1"/><rect x="1" y="8" width="2" height="2"/></symbol><symbol id="tile-zone-lifesupport" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="2" height="4"/><rect x="4" y="1" width="4" height="4"/><rect x="9" y="1" width="2" height="4"/><rect x="2" y="6" width="1" height="1"/><rect x="5" y="6" width="2" height="1"/><rect x="9" y="6" width="1" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="7" y="7" width="1" height="1"/><rect x="10" y="7" width="1" height="1"/><rect x="0" y="8" width="1" height="1"/><rect x="5" y="8" width="2" height="1"/><rect x="11" y="8" width="1" height="1"/></symbol><symbol id="tile-zone-cryo" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="0" width="2" height="3"/><rect x="2" y="1" width="1" height="1"/><rect x="9" y="1" width="1" height="1"/><rect x="3" y="2" width="1" height="1"/><rect x="8" y="2" width="1" height="1"/><rect x="4" y="3" width="4" height="1"/><rect x="1" y="4" width="10" height="2"/><rect x="4" y="6" width="4" height="1"/><rect x="3" y="7" width="1" height="1"/><rect x="5" y="7" width="2" height="3"/><rect x="8" y="7" width="1" height="1"/><rect x="2" y="8" width="1" height="1"/><rect x="9" y="8" width="1" height="1"/></symbol><symbol id="tile-zone-sensors" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="3" width="6" height="1"/><rect x="2" y="4" width="2" height="1"/><rect x="8" y="4" width="2" height="1"/><rect x="1" y="5" width="2" height="2"/><rect x="4" y="5" width="4" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="2" y="7" width="2" height="1"/><rect x="8" y="7" width="2" height="1"/><rect x="3" y="8" width="6" height="1"/></symbol><symbol id="tile-zone-brig" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="1"/><rect x="1" y="2" width="3" height="3"/><rect x="5" y="2" width="2" height="3"/><rect x="8" y="2" width="3" height="8"/><rect x="1" y="5" width="7" height="1"/><rect x="1" y="6" width="3" height="3"/><rect x="5" y="6" width="2" height="3"/><rect x="1" y="9" width="7" height="1"/></symbol><symbol id="tile-zone-escapepods" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="0" width="2" height="9"/><rect x="9" y="0" width="2" height="9"/><rect x="4" y="1" width="4" height="2"/><rect x="4" y="3" width="1" height="1"/><rect x="7" y="3" width="1" height="4"/><rect x="4" y="4" width="3" height="3"/><rect x="5" y="7" width="2" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="7" y="9" width="1" height="1"/><rect x="3" y="10" width="1" height="1"/><rect x="8" y="10" width="1" height="1"/></symbol><symbol id="tile-hazard-frost" viewBox="0 0 12 12" fill="currentColor"><rect x="5" y="0" width="2" height="4"/><rect x="1" y="2" width="2" height="1"/><rect x="9" y="2" width="2" height="2"/><rect x="1" y="3" width="3" height="1"/><rect x="8" y="3" width="1" height="1"/><rect x="2" y="4" width="8" height="1"/><rect x="3" y="5" width="6" height="2"/><rect x="2" y="7" width="8" height="1"/><rect x="1" y="8" width="3" height="1"/><rect x="5" y="8" width="2" height="4"/><rect x="8" y="8" width="3" height="1"/><rect x="1" y="9" width="2" height="1"/><rect x="9" y="9" width="2" height="1"/></symbol><symbol id="tile-hazard-smoke" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2" width="2" height="1"/><rect x="7" y="2" width="2" height="1"/><rect x="2" y="3" width="4" height="1"/><rect x="7" y="3" width="4" height="2"/><rect x="1" y="4" width="6" height="1"/><rect x="0" y="5" width="12" height="2"/><rect x="1" y="7" width="10" height="1"/><rect x="2" y="8" width="3" height="1"/><rect x="7" y="8" width="3" height="1"/></symbol><symbol id="tile-hazard-mine" viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="1" width="6" height="1"/><rect x="2" y="2" width="8" height="1"/><rect x="1" y="3" width="3" height="1"/><rect x="8" y="3" width="3" height="1"/><rect x="1" y="4" width="2" height="4"/><rect x="4" y="4" width="4" height="4"/><rect x="9" y="4" width="2" height="5"/><rect x="1" y="8" width="3" height="1"/><rect x="8" y="8" width="1" height="1"/><rect x="2" y="9" width="8" height="1"/><rect x="3" y="10" width="6" height="1"/></symbol><symbol id="ov-damaged" viewBox="0 0 12 12" fill="currentColor"><rect x="7" y="0" width="1" height="2"/><rect x="6" y="1" width="1" height="3"/><rect x="5" y="3" width="1" height="3"/><rect x="4" y="5" width="1" height="3"/><rect x="3" y="7" width="1" height="3"/><rect x="2" y="9" width="1" height="1"/></symbol><symbol id="ov-infected" viewBox="0 0 12 12" fill="currentColor"><rect x="9" y="1" width="2" height="7"/><rect x="9" y="9" width="2" height="2"/></symbol><symbol id="ov-exposed" viewBox="0 0 12 12" fill="currentColor"><rect x="7" y="2" width="1" height="8"/><rect x="6" y="3" width="1" height="6"/><rect x="5" y="4" width="1" height="4"/><rect x="4" y="5" width="1" height="2"/></symbol>';
var ZONE_DEFS = '<symbol id="z16-docking" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="1"/><rect x="2" y="3" width="1" height="9"/><rect x="13" y="3" width="1" height="10"/><rect x="6" y="4" width="4" height="1"/><rect x="5" y="5" width="6" height="1"/><rect x="5" y="6" width="2" height="3"/><rect x="9" y="6" width="2" height="4"/><rect x="5" y="9" width="4" height="1"/><rect x="6" y="10" width="4" height="1"/><rect x="2" y="12" width="11" height="1"/></symbol><symbol id="z16-cargo" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="2" width="6" height="1"/><rect x="5" y="3" width="1" height="1"/><rect x="10" y="3" width="1" height="2"/><rect x="5" y="4" width="5" height="1"/><rect x="2" y="5" width="12" height="1"/><rect x="2" y="6" width="1" height="2"/><rect x="13" y="6" width="1" height="6"/><rect x="2" y="8" width="11" height="1"/><rect x="2" y="9" width="1" height="2"/><rect x="2" y="11" width="11" height="1"/></symbol><symbol id="z16-corridor" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1"/><rect x="3" y="4" width="3" height="1"/><rect x="10" y="4" width="3" height="1"/><rect x="3" y="8" width="3" height="1"/><rect x="10" y="8" width="3" height="1"/><rect x="1" y="10" width="14" height="1"/></symbol><symbol id="z16-storage" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1"/><rect x="1" y="3" width="1" height="1"/><rect x="14" y="3" width="1" height="8"/><rect x="1" y="4" width="13" height="1"/><rect x="1" y="5" width="1" height="1"/><rect x="1" y="6" width="13" height="1"/><rect x="1" y="7" width="1" height="1"/><rect x="1" y="8" width="13" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="1" y="10" width="13" height="1"/></symbol><symbol id="z16-maintenance" viewBox="0 0 16 16" fill="currentColor"><rect x="10" y="1" width="5" height="1"/><rect x="9" y="2" width="2" height="1"/><rect x="14" y="2" width="1" height="3"/><rect x="9" y="3" width="1" height="2"/><rect x="8" y="4" width="1" height="2"/><rect x="13" y="4" width="1" height="2"/><rect x="7" y="5" width="1" height="2"/><rect x="10" y="5" width="3" height="1"/><rect x="6" y="6" width="1" height="2"/><rect x="9" y="6" width="3" height="1"/><rect x="5" y="7" width="1" height="2"/><rect x="8" y="7" width="2" height="1"/><rect x="4" y="8" width="1" height="2"/><rect x="7" y="8" width="2" height="1"/><rect x="3" y="9" width="1" height="1"/><rect x="6" y="9" width="2" height="1"/><rect x="2" y="10" width="4" height="1"/><rect x="2" y="11" width="3" height="1"/><rect x="2" y="12" width="2" height="1"/></symbol><symbol id="z16-hab" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1"/><rect x="1" y="3" width="1" height="7"/><rect x="14" y="3" width="1" height="8"/><rect x="3" y="4" width="10" height="1"/><rect x="3" y="7" width="10" height="1"/><rect x="1" y="10" width="13" height="1"/></symbol><symbol id="z16-mess" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="1" height="3"/><rect x="7" y="2" width="1" height="4"/><rect x="12" y="2" width="3" height="5"/><rect x="2" y="5" width="5" height="1"/><rect x="4" y="6" width="2" height="3"/><rect x="13" y="7" width="2" height="4"/><rect x="1" y="9" width="12" height="2"/></symbol><symbol id="z16-hydroponics" viewBox="0 0 16 16" fill="currentColor"><rect x="7" y="1" width="2" height="2"/><rect x="2" y="2" width="3" height="1"/><rect x="11" y="2" width="3" height="1"/><rect x="1" y="3" width="2" height="1"/><rect x="6" y="3" width="4" height="2"/><rect x="13" y="3" width="2" height="1"/><rect x="2" y="4" width="2" height="1"/><rect x="12" y="4" width="2" height="1"/><rect x="3" y="5" width="4" height="1"/><rect x="9" y="5" width="4" height="1"/><rect x="7" y="6" width="2" height="3"/><rect x="1" y="9" width="14" height="1"/><rect x="1" y="10" width="1" height="1"/><rect x="14" y="10" width="1" height="2"/><rect x="1" y="11" width="13" height="1"/></symbol><symbol id="z16-med" viewBox="0 0 16 16" fill="currentColor"><rect x="6" y="3" width="4" height="3"/><rect x="1" y="6" width="14" height="3"/><rect x="6" y="9" width="4" height="3"/></symbol><symbol id="z16-lab" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="1" width="8" height="1"/><rect x="6" y="2" width="4" height="3"/><rect x="5" y="5" width="6" height="2"/><rect x="4" y="7" width="8" height="1"/><rect x="3" y="8" width="10" height="1"/><rect x="2" y="9" width="12" height="3"/><rect x="3" y="12" width="10" height="1"/><rect x="4" y="13" width="8" height="1"/></symbol><symbol id="z16-quarantine" viewBox="0 0 16 16" fill="currentColor"><rect x="7" y="1" width="2" height="1"/><rect x="6" y="2" width="1" height="2"/><rect x="9" y="2" width="1" height="2"/><rect x="5" y="4" width="1" height="2"/><rect x="7" y="4" width="2" height="5"/><rect x="10" y="4" width="1" height="2"/><rect x="4" y="6" width="1" height="2"/><rect x="11" y="6" width="1" height="2"/><rect x="3" y="8" width="1" height="2"/><rect x="12" y="8" width="1" height="2"/><rect x="2" y="10" width="1" height="1"/><rect x="7" y="10" width="2" height="1"/><rect x="13" y="10" width="1" height="2"/><rect x="2" y="11" width="11" height="1"/></symbol><symbol id="z16-engineering" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="1" width="2" height="1"/><rect x="7" y="1" width="2" height="1"/><rect x="11" y="1" width="2" height="1"/><rect x="2" y="2" width="12" height="1"/><rect x="1" y="3" width="14" height="1"/><rect x="1" y="4" width="4" height="1"/><rect x="11" y="4" width="4" height="1"/><rect x="1" y="5" width="3" height="1"/><rect x="12" y="5" width="3" height="1"/><rect x="1" y="6" width="2" height="3"/><rect x="13" y="6" width="2" height="6"/><rect x="1" y="9" width="3" height="1"/><rect x="12" y="9" width="1" height="3"/><rect x="1" y="10" width="4" height="1"/><rect x="11" y="10" width="1" height="2"/><rect x="1" y="11" width="10" height="1"/><rect x="2" y="12" width="12" height="1"/><rect x="3" y="13" width="2" height="1"/><rect x="7" y="13" width="2" height="1"/><rect x="11" y="13" width="2" height="1"/></symbol><symbol id="z16-workshop" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="1"/><rect x="1" y="3" width="14" height="1"/><rect x="2" y="4" width="12" height="1"/><rect x="4" y="5" width="8" height="1"/><rect x="6" y="6" width="4" height="2"/><rect x="5" y="8" width="6" height="1"/><rect x="4" y="9" width="8" height="1"/><rect x="3" y="10" width="10" height="1"/><rect x="2" y="11" width="12" height="1"/></symbol><symbol id="z16-armory" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="2" height="1"/><rect x="13" y="1" width="2" height="2"/><rect x="1" y="2" width="3" height="1"/><rect x="12" y="2" width="1" height="1"/><rect x="2" y="3" width="3" height="1"/><rect x="11" y="3" width="3" height="1"/><rect x="3" y="4" width="3" height="1"/><rect x="10" y="4" width="3" height="1"/><rect x="4" y="5" width="3" height="1"/><rect x="9" y="5" width="3" height="1"/><rect x="5" y="6" width="6" height="1"/><rect x="6" y="7" width="4" height="1"/><rect x="5" y="8" width="6" height="1"/><rect x="4" y="9" width="3" height="1"/><rect x="9" y="9" width="3" height="1"/><rect x="3" y="10" width="3" height="1"/><rect x="10" y="10" width="3" height="1"/><rect x="2" y="11" width="3" height="1"/><rect x="11" y="11" width="3" height="1"/><rect x="1" y="12" width="3" height="1"/><rect x="12" y="12" width="3" height="1"/><rect x="1" y="13" width="2" height="1"/><rect x="13" y="13" width="2" height="1"/></symbol><symbol id="z16-reactor" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="1" width="6" height="1"/><rect x="3" y="2" width="2" height="1"/><rect x="11" y="2" width="2" height="1"/><rect x="2" y="3" width="1" height="1"/><rect x="7" y="3" width="2" height="1"/><rect x="13" y="3" width="1" height="1"/><rect x="1" y="4" width="1" height="6"/><rect x="5" y="4" width="6" height="1"/><rect x="14" y="4" width="1" height="2"/><rect x="4" y="5" width="8" height="4"/><rect x="0" y="6" width="1" height="2"/><rect x="14" y="6" width="2" height="2"/><rect x="14" y="8" width="1" height="2"/><rect x="5" y="9" width="6" height="1"/><rect x="2" y="10" width="1" height="1"/><rect x="7" y="10" width="2" height="1"/><rect x="13" y="10" width="1" height="1"/><rect x="3" y="11" width="2" height="1"/><rect x="11" y="11" width="2" height="1"/><rect x="5" y="12" width="6" height="1"/></symbol><symbol id="z16-control" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="1"/><rect x="1" y="2" width="1" height="7"/><rect x="14" y="2" width="1" height="8"/><rect x="4" y="3" width="1" height="1"/><rect x="11" y="3" width="1" height="1"/><rect x="5" y="5" width="6" height="1"/><rect x="4" y="7" width="1" height="1"/><rect x="11" y="7" width="1" height="1"/><rect x="1" y="9" width="13" height="1"/><rect x="6" y="10" width="4" height="1"/><rect x="5" y="11" width="6" height="1"/><rect x="3" y="12" width="10" height="1"/></symbol><symbol id="z16-coreaccess" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="3" height="2"/><rect x="12" y="1" width="3" height="11"/><rect x="1" y="3" width="11" height="1"/><rect x="1" y="4" width="3" height="1"/><rect x="1" y="5" width="11" height="1"/><rect x="1" y="6" width="3" height="1"/><rect x="1" y="7" width="11" height="1"/><rect x="1" y="8" width="3" height="1"/><rect x="1" y="9" width="11" height="1"/><rect x="1" y="10" width="3" height="2"/></symbol><symbol id="z16-lifesupport" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="3" height="5"/><rect x="6" y="1" width="4" height="5"/><rect x="12" y="1" width="3" height="5"/><rect x="2" y="8" width="2" height="1"/><rect x="8" y="8" width="2" height="1"/><rect x="14" y="8" width="2" height="1"/><rect x="1" y="9" width="1" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="7" y="9" width="1" height="1"/><rect x="10" y="9" width="1" height="1"/><rect x="13" y="9" width="1" height="1"/><rect x="0" y="10" width="1" height="1"/><rect x="5" y="10" width="2" height="1"/><rect x="11" y="10" width="2" height="1"/></symbol><symbol id="z16-cryo" viewBox="0 0 16 16" fill="currentColor"><rect x="7" y="1" width="2" height="4"/><rect x="2" y="2" width="1" height="1"/><rect x="13" y="2" width="1" height="1"/><rect x="3" y="3" width="1" height="1"/><rect x="12" y="3" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="11" y="4" width="1" height="1"/><rect x="5" y="5" width="6" height="1"/><rect x="1" y="6" width="14" height="2"/><rect x="5" y="8" width="6" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="7" y="9" width="2" height="4"/><rect x="11" y="9" width="1" height="1"/><rect x="3" y="10" width="1" height="1"/><rect x="12" y="10" width="1" height="1"/><rect x="2" y="11" width="1" height="1"/><rect x="13" y="11" width="1" height="1"/></symbol><symbol id="z16-sensors" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="8" height="1"/><rect x="2" y="4" width="12" height="1"/><rect x="1" y="5" width="4" height="1"/><rect x="11" y="5" width="4" height="1"/><rect x="1" y="6" width="3" height="2"/><rect x="6" y="6" width="4" height="2"/><rect x="12" y="6" width="3" height="3"/><rect x="1" y="8" width="4" height="1"/><rect x="11" y="8" width="1" height="1"/><rect x="2" y="9" width="12" height="1"/><rect x="4" y="10" width="8" height="1"/></symbol><symbol id="z16-brig" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="1"/><rect x="1" y="3" width="4" height="3"/><rect x="7" y="3" width="2" height="3"/><rect x="11" y="3" width="4" height="8"/><rect x="1" y="6" width="10" height="1"/><rect x="1" y="7" width="4" height="3"/><rect x="7" y="7" width="2" height="3"/><rect x="1" y="10" width="10" height="1"/></symbol><symbol id="z16-escapepods" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="0" width="3" height="10"/><rect x="12" y="0" width="3" height="10"/><rect x="5" y="1" width="6" height="2"/><rect x="5" y="3" width="2" height="1"/><rect x="9" y="3" width="2" height="5"/><rect x="5" y="4" width="4" height="4"/><rect x="6" y="8" width="4" height="1"/><rect x="6" y="10" width="1" height="1"/><rect x="9" y="10" width="1" height="1"/><rect x="5" y="11" width="1" height="1"/><rect x="10" y="11" width="1" height="1"/><rect x="4" y="12" width="1" height="1"/><rect x="11" y="12" width="1" height="1"/></symbol>';
var TILE_IDS = {
  "machine.maintenance-bot": "tile-machine-maintenance-bot",
  "machine.feral-drone": "tile-machine-feral-drone",
  "machine.scout": "tile-machine-scout",
  "machine.security-unit": "tile-machine-security-unit",
  "machine.welder-bot": "tile-machine-welder-bot",
  "machine.hauler": "tile-machine-hauler",
  "machine.scrapper": "tile-machine-scrapper",
  "machine.arc-sentinel": "tile-machine-arc-sentinel",
  "machine.sentry-turret": "tile-machine-sentry-turret",
  "machine.jammer": "tile-machine-jammer",
  "machine.crawler": "tile-machine-crawler",
  "machine.bloom": "tile-machine-bloom",
  "machine.enforcer": "tile-machine-enforcer",
  "actor.drone": "tile-actor-drone",
  "actor.ghost": "tile-actor-ghost",
  "actor.rival-drone": "tile-actor-rival-drone",
  "module.cutter": "tile-module-cutter",
  "module.thrusters": "tile-module-thrusters",
  "module.scanner": "tile-module-scanner",
  "module.plating": "tile-module-plating",
  "module.cell": "tile-module-cell",
  "module.emp": "tile-module-emp",
  "module.welder": "tile-module-welder",
  "module.laser": "tile-module-laser",
  "module.spike": "tile-module-spike",
  "module.emitter": "tile-module-emitter",
  "module.baffle": "tile-module-baffle",
  "module.blade": "tile-module-blade",
  "module.shocker": "tile-module-shocker",
  "module.lattice": "tile-module-lattice",
  "thing.crate": "tile-thing-crate",
  "thing.scrap": "tile-thing-scrap",
  "thing.body": "tile-thing-body",
  "thing.parcel": "tile-thing-parcel",
  "thing.keycard": "tile-thing-keycard",
  "thing.vented": "tile-thing-vented",
  "thing.system": "tile-thing-system",
  "thing.system-online": "tile-thing-system-online",
  "thing.cover": "tile-thing-cover",
  "door.open": "tile-door-open",
  "door.closed": "tile-door-closed",
  "door.locked": "tile-door-locked",
  "door.sealed": "tile-door-sealed",
  "door.broken": "tile-door-broken",
  "door.airlock": "tile-door-airlock",
  "zone.docking": "tile-zone-docking",
  "zone.cargo": "tile-zone-cargo",
  "zone.corridor": "tile-zone-corridor",
  "zone.storage": "tile-zone-storage",
  "zone.maintenance": "tile-zone-maintenance",
  "zone.hab": "tile-zone-hab",
  "zone.mess": "tile-zone-mess",
  "zone.hydroponics": "tile-zone-hydroponics",
  "zone.med": "tile-zone-med",
  "zone.lab": "tile-zone-lab",
  "zone.quarantine": "tile-zone-quarantine",
  "zone.engineering": "tile-zone-engineering",
  "zone.workshop": "tile-zone-workshop",
  "zone.armory": "tile-zone-armory",
  "zone.reactor": "tile-zone-reactor",
  "zone.control": "tile-zone-control",
  "zone.coreaccess": "tile-zone-coreaccess",
  "zone.lifesupport": "tile-zone-lifesupport",
  "zone.cryo": "tile-zone-cryo",
  "zone.sensors": "tile-zone-sensors",
  "zone.brig": "tile-zone-brig",
  "zone.escapepods": "tile-zone-escapepods",
  "hazard.frost": "tile-hazard-frost",
  "hazard.smoke": "tile-hazard-smoke",
  "hazard.mine": "tile-hazard-mine",
  "overlay.damaged": "ov-damaged",
  "overlay.infected": "ov-infected",
  "overlay.exposed": "ov-exposed"
};
var ZONE_IDS = {
  "zone.docking": "z16-docking",
  "zone.cargo": "z16-cargo",
  "zone.corridor": "z16-corridor",
  "zone.storage": "z16-storage",
  "zone.maintenance": "z16-maintenance",
  "zone.hab": "z16-hab",
  "zone.mess": "z16-mess",
  "zone.hydroponics": "z16-hydroponics",
  "zone.med": "z16-med",
  "zone.lab": "z16-lab",
  "zone.quarantine": "z16-quarantine",
  "zone.engineering": "z16-engineering",
  "zone.workshop": "z16-workshop",
  "zone.armory": "z16-armory",
  "zone.reactor": "z16-reactor",
  "zone.control": "z16-control",
  "zone.coreaccess": "z16-coreaccess",
  "zone.lifesupport": "z16-lifesupport",
  "zone.cryo": "z16-cryo",
  "zone.sensors": "z16-sensors",
  "zone.brig": "z16-brig",
  "zone.escapepods": "z16-escapepods"
};
var TILE_BY_GLYPH = {
  "m": "machine.maintenance-bot",
  "d": "machine.feral-drone",
  "c": "machine.scout",
  "S": "machine.security-unit",
  "w": "machine.welder-bot",
  "H": "machine.hauler",
  "x": "machine.scrapper",
  "A": "machine.arc-sentinel",
  "t": "machine.sentry-turret",
  "j": "machine.jammer",
  "z": "machine.crawler",
  "Y": "machine.bloom",
  "E": "machine.enforcer",
  "@": "actor.drone",
  "G": "actor.ghost",
  "r": "actor.rival-drone",
  "X": "thing.crate",
  "%": "thing.scrap",
  "\u2020": "thing.body",
  "*": "thing.parcel",
  "~": "thing.vented",
  "+": "thing.system",
  "\u2713": "thing.system-online",
  "\u2744": "hazard.frost",
  "\u2248": "hazard.smoke",
  "^": "hazard.mine",
  "!": "overlay.infected",
  "\u25C0": "overlay.exposed"
};
var TILE_NAMES = Object.keys(TILE_IDS);

// ../../../smoreg_works/games/salvor/src/ui/web/xml.ts
function esc(text3) {
  return text3.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ../../../smoreg_works/games/salvor/src/ui/web/tiles.ts
var PICTOGRAM_KINDS = /* @__PURE__ */ new Set([
  "docking",
  "reactor",
  "engineering",
  "control",
  "med",
  "cargo"
]);
function tileRow(things, spec2) {
  const shown = things.slice(0, drawn(things.length, spec2.max));
  const rest = things.length - shown.length;
  const cells = shown.map((thing, i) => cell(thing, spec2.x + spec2.step * i, spec2));
  if (rest > 0) {
    const at = spec2.x + spec2.step * shown.length + spec2.size / 2;
    cells.push(`<text class="glyph tile-more" x="${at}" y="${spec2.baseline}" text-anchor="middle">+${rest}</text>`);
  }
  return cells.join("");
}
function cell(thing, x, spec2) {
  const id = tileIdOf(thing.glyph);
  const hostile = thing.hostile === true;
  if (id === void 0) {
    const cls = hostile ? "glyph hostile" : "glyph";
    return `<text class="${cls}" x="${x + spec2.size / 2}" y="${spec2.baseline}" text-anchor="middle">${esc(thing.glyph)}</text>`;
  }
  return [
    `<use class="${hostile ? "tile hostile" : "tile"}" href="#${id}"`,
    ` x="${x}" y="${spec2.y}" width="${spec2.size}" height="${spec2.size}">`,
    `<title>${esc(thing.name)}</title></use>`
  ].join("");
}
function drawn(count, max) {
  return count > max ? max - 1 : count;
}
function tileRowWidth(count, spec2) {
  const shown = drawn(count, spec2.max);
  const cells = shown + (count > shown ? 1 : 0);
  return cells === 0 ? 0 : (cells - 1) * spec2.step + spec2.size;
}
function thingsOf2(room) {
  if (room.things !== void 0) return room.things;
  const glyphs = room.glyphs.split(" ").filter((g) => g.length > 0);
  const machines = Math.ceil((room.hostiles ?? 0) / 2);
  return glyphs.map(
    (glyph, i) => i < machines ? { glyph, name: glyph, hostile: true } : { glyph, name: glyph }
  );
}
function tileIdOf(glyph) {
  const name = TILE_BY_GLYPH[glyph];
  return name === void 0 ? void 0 : TILE_IDS[name];
}
function zoneTile(room, x, y, size) {
  const id = zoneIdOf(room.kind);
  if (id === void 0) return "";
  return [
    `<use class="zone-tile" href="#${id}"`,
    ` x="${x}" y="${y}" width="${size}" height="${size}">`,
    `<title>${esc(room.name)}</title></use>`
  ].join("");
}
function zoneIdOf(kind) {
  if (kind === void 0 || !PICTOGRAM_KINDS.has(kind)) return void 0;
  return ZONE_IDS[`zone.${kind}`];
}
function tileDefs(svg) {
  const used = /* @__PURE__ */ new Set();
  for (const match of svg.matchAll(/href="#([^"]+)"/g)) used.add(match[1]);
  if (used.size === 0) return "";
  const body = [...SYMBOLS].filter(([id]) => used.has(id)).map(([, symbol]) => symbol);
  return body.length === 0 ? "" : `<defs>${body.join("")}</defs>`;
}
var SYMBOLS = indexSymbols(TILE_DEFS + ZONE_DEFS);
function indexSymbols(source) {
  const out2 = /* @__PURE__ */ new Map();
  for (const part of source.split("</symbol>")) {
    const id = /^<symbol id="([^"]+)"/.exec(part)?.[1];
    if (id !== void 0) out2.set(id, `${part}</symbol>`);
  }
  return out2;
}

// ../../../smoreg_works/games/salvor/src/ui/web/schematic-svg.ts
var BOX_W2 = 132;
var BOX_H = 76;
var COL_STEP2 = 186;
var ROW_STEP = 104;
var ORIGIN_X = 112;
var ORIGIN_Y = 58;
var RIGHT_PAD = 56;
var BOTTOM_PAD = 52;
var TUG_W2 = 66;
var TUG_H = 52;
var TUG_GAP = 46;
var PORT_Y = [0.34, 0.68];
var GUTTER_MID = (COL_STEP2 - BOX_W2) / 2;
var TAG_H = 20;
var TAG_CHAR_W = 8;
var TAG_PAD = 10;
var UNKNOWN = "\xB7\xB7\xB7\xB7";
var TILE_SIZE = 16;
var TILE_STEP = 20;
var TILE_MAX = 6;
var TILE_X = 10;
var TILE_Y = 34;
var ZONE_SIZE = 16;
var ZONE_X = 10;
var ZONE_Y = 12;
var NAME_X_TILED = 32;
function svgOf(input, banner = "", tiles = false) {
  const placed = place(input.rooms);
  const boxes = new Map(placed.map((p) => [p.room.id, p]));
  const size = extent(placed);
  const parts = [
    hull2(size),
    ...input.doors.map((door) => wire(door, boxes)).filter((s) => s.length > 0),
    ...placed.map((p) => box2(p, tiles)),
    ...input.doors.map((door) => tag2(door, boxes)).filter((s) => s.length > 0),
    tug(input, boxes),
    banner.length > 0 ? text(16, 30, banner, "banner") : "",
    input.shipLine.length > 0 ? text(16, size.h - 18, input.shipLine, "ship-line") : ""
  ];
  const body = parts.filter((s) => s.length > 0).join("");
  return [
    `<svg class="schematic${tiles ? " has-tiles" : ""}" viewBox="0 0 ${size.w} ${size.h}" preserveAspectRatio="xMidYMid meet" role="img">`,
    tileDefs(body),
    body,
    "</svg>"
  ].join("");
}
function place(rooms) {
  const taken = /* @__PURE__ */ new Set();
  const out2 = [];
  for (const room of [...rooms].sort((a, b) => here(b) - here(a))) {
    const cell2 = `${room.row}:${room.col}`;
    if (room.col < 0 || room.row < 0 || taken.has(cell2)) continue;
    taken.add(cell2);
    out2.push({ room, x: ORIGIN_X + COL_STEP2 * room.col, y: ORIGIN_Y + ROW_STEP * room.row });
  }
  return out2;
}
function here(room) {
  return room.state === "current" ? 1 : 0;
}
function extent(placed) {
  const right = placed.reduce((m, p) => Math.max(m, p.x + BOX_W2), ORIGIN_X);
  const bottom = placed.reduce((m, p) => Math.max(m, p.y + BOX_H), ORIGIN_Y);
  return { w: right + RIGHT_PAD, h: bottom + BOTTOM_PAD };
}
function portY(p, port) {
  return p.y + BOX_H * PORT_Y[port];
}
function box2(p, tiles) {
  const { room } = p;
  const unknown = room.state === "unknown";
  const name = unknown ? UNKNOWN : room.name;
  const picture = tiles && !unknown ? zoneTile(room, p.x + ZONE_X, p.y + ZONE_Y, ZONE_SIZE) : "";
  const body = [
    `<rect class="room-box" x="${p.x}" y="${p.y}" width="${BOX_W2}" height="${BOX_H}" rx="3"/>`,
    picture,
    text(p.x + (picture.length > 0 ? NAME_X_TILED : 10), p.y + 25, name, "room-name"),
    text(p.x + BOX_W2 - 10, p.y + BOX_H - 12, room.label, "room-id", "end")
  ].filter((s) => s.length > 0);
  if (room.glyphs.length > 0) body.push(tiles ? tileRowOf(p) : glyphRow(p));
  if (!unknown && (room.hostiles ?? 0) > 0) body.push(threat(p));
  if (room.state === "current") {
    body.unshift(
      `<rect class="room-halo" x="${p.x}" y="${p.y}" width="${BOX_W2}" height="${BOX_H}" rx="3"/>`
    );
  }
  const flashing = room.alarm === true || room.threat === true ? " is-alarmed" : "";
  const aimed = room.target === true ? " is-goal" : "";
  return `<g class="room is-${room.state}${aimed}${flashing}" data-room="${room.id}">${body.join("")}</g>`;
}
function glyphRow(p) {
  const glyphs = p.room.glyphs.split(" ").filter((g) => g.length > 0);
  const machines = Math.ceil((p.room.hostiles ?? 0) / 2);
  let x = p.x + 12;
  const cells = glyphs.map((glyph, i) => {
    const cell2 = text(x, p.y + BOX_H - 14, glyph, i < machines ? "glyph hostile" : "glyph");
    x += glyph.length * 9 + 8;
    return cell2;
  });
  return cells.join("");
}
function tileRowOf(p) {
  return tileRow(thingsOf2(p.room), {
    x: p.x + TILE_X,
    y: p.y + TILE_Y,
    size: TILE_SIZE,
    step: TILE_STEP,
    max: TILE_MAX,
    baseline: p.y + TILE_Y + TILE_SIZE
  });
}
function threat(p) {
  const machines = Math.ceil((p.room.hostiles ?? 0) / 2);
  const w = 22;
  return [
    `<rect class="threat-cap" x="${p.x + BOX_W2 - w - 6}" y="${p.y - 7}" width="${w}" height="14" rx="2"/>`,
    text(p.x + BOX_W2 - w / 2 - 6, p.y + 4, String(machines), "threat-count", "middle")
  ].join("");
}
function wire(door, boxes) {
  const ends = endsOf(door, boxes);
  if (!ends) return "";
  const [from, to] = ends;
  const d = from.x === to.x ? `M ${from.x} ${from.y} L ${to.x} ${to.y}` : `M ${from.x} ${from.y} L ${bend(from, to)} ${from.y} L ${bend(from, to)} ${to.y} L ${to.x} ${to.y}`;
  return `<path class="door-wire is-${door.state}${door.target === true ? " is-goal" : ""}" d="${d}"/>`;
}
function tag2(door, boxes) {
  const ends = endsOf(door, boxes);
  if (!ends) return "";
  const [from, to] = ends;
  const at = from.x === to.x ? mid(from, to) : { x: bend(from, to), y: (from.y + to.y) / 2 };
  const w = door.label.length * TAG_CHAR_W + TAG_PAD;
  return [
    `<g class="door is-${door.state}${door.target === true ? " is-goal" : ""}">`,
    `<rect class="door-tag" x="${round(at.x - w / 2)}" y="${round(at.y - TAG_H / 2)}" width="${w}" height="${TAG_H}" rx="3"/>`,
    text(round(at.x), round(at.y + 5), door.label, "door-label", "middle"),
    "</g>"
  ].join("");
}
function endsOf(door, boxes) {
  if (door.a === door.b) return void 0;
  const a = boxes.get(door.a);
  const b = boxes.get(door.b);
  if (!a || !b) return void 0;
  if (a.room.col === b.room.col) {
    const [upper, lower] = a.y < b.y ? [a, b] : [b, a];
    return [
      { x: upper.x + BOX_W2 / 2, y: upper.y + BOX_H },
      { x: lower.x + BOX_W2 / 2, y: lower.y }
    ];
  }
  const left = a.room.col < b.room.col ? a : b;
  const right = left === a ? b : a;
  const leftPort = left === a ? door.portA : door.portB;
  const rightPort = right === a ? door.portA : door.portB;
  return [
    { x: left.x + BOX_W2, y: portY(left, leftPort) },
    { x: right.x, y: portY(right, rightPort) }
  ];
}
function bend(from, to) {
  return round(Math.min(from.x, to.x) + GUTTER_MID);
}
function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function tug(input, boxes) {
  const dock2 = input.tug ? boxes.get(input.tug.at) : void 0;
  if (!dock2) return "";
  const x = dock2.x - TUG_GAP - TUG_W2;
  const y = dock2.y + (BOX_H - TUG_H) / 2;
  const cy = y + TUG_H / 2;
  const label3 = input.tug?.label ?? "";
  return [
    '<g class="tug">',
    `<path class="door-wire is-airlock" d="M ${x + TUG_W2} ${cy} L ${dock2.x} ${cy}"/>`,
    `<rect class="tug-box" x="${x}" y="${y}" width="${TUG_W2}" height="${TUG_H}" rx="4"/>`,
    text(x + TUG_W2 / 2, cy + 7, TUG_GLYPH, "tug-name", "middle"),
    label3.length > 0 ? text(round(x + TUG_W2 + TUG_GAP / 2), round(cy - 8), label3, "door-label", "middle") : "",
    "</g>"
  ].filter((s) => s.length > 0).join("");
}
function hull2(size) {
  const x = size.w - RIGHT_PAD / 2;
  return `<path class="hull" d="M ${x} 12 L ${x} ${size.h - 12}"/>`;
}
function text(x, y, body, cls, anchor) {
  const at = anchor ? ` text-anchor="${anchor}"` : "";
  return `<text class="${cls}" x="${round(x)}" y="${round(y)}"${at}>${esc(body)}</text>`;
}
function round(n) {
  return Math.round(n * 10) / 10;
}

// ../../../smoreg_works/games/salvor/src/ui/web/styles.ts
var TOKENS = {
  bg: THEME.bg,
  "panel-bg": THEME.panelBg,
  "fg-dim": THEME.fgDim,
  fg: THEME.fg,
  bright: THEME.bright,
  accent: THEME.accent,
  burned: THEME.burned,
  line: THEME.line,
  soft: THEME.soft,
  zone: THEME.zone,
  hull: THEME.hull,
  airlock: THEME.airlock,
  bulkhead: THEME.bulkhead,
  good: THEME.good,
  bad: THEME.bad,
  warn: THEME.warn,
  // The drawn hull under the honeycomb (hullart.ts): its three steps of tone
  // and the two marks on it, out of the same palette as everything else.
  "hull-body": THEME.hullArt.body,
  "hull-plate": THEME.hullArt.plate,
  "hull-plate-lit": THEME.hullArt.plateLit,
  "hull-deep": THEME.hullArt.deep,
  "hull-rim": THEME.hullArt.rim
};
function varOf(colour) {
  const name = Object.keys(TOKENS).find((key3) => TOKENS[key3] === colour);
  return name === void 0 ? colour : `var(--${name})`;
}
var ROOT = Object.entries(TOKENS).map(([name, value]) => `--${name}:${value};`).join("");
var WEB_ROOT_CLASS = "salvor-web";
var WEB_CSS = `
.${WEB_ROOT_CLASS}{${ROOT}
  --mono: ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace;
  --amber-wash:#1a140a;
  --red-wash:#1c1113;
  position:fixed; inset:0; display:grid;
  grid-template-columns:1fr clamp(340px, 31vw, 460px);
  /* Three fixed-ish bands so the whole screen lands inside a 1366x768 laptop
     without a scrollbar \u2014 the artboards were drawn 1240 tall, and the itch
     viewport is 764 (docs/itch-page.md). The schematic takes what is left. */
  grid-template-rows:38px 1fr auto;
  background:var(--bg); color:var(--fg);
  font-family:var(--mono); font-size:13px; line-height:1.45; overflow:hidden;
}
.${WEB_ROOT_CLASS} *{box-sizing:border-box;}

/* --------------------------------------------------------------- the strip */
/* Which ship this is and what turn it is: the two lines the panel used to open
   with, moved out of it so the panel can start on the thing that matters. */
.web-head{grid-column:1 / -1; grid-row:1; display:flex; align-items:center; gap:16px;
  padding:0 14px; background:var(--panel-bg); border-bottom:1px solid var(--line);
  white-space:nowrap; overflow:hidden;}
.web-head .ship{color:var(--bright); font-weight:600; letter-spacing:.1em;
  overflow:hidden; text-overflow:ellipsis;}
.web-head .turn{margin-left:auto; color:var(--soft); font-size:11px; letter-spacing:.1em;
  font-variant-numeric:tabular-nums;}

/* ------------------------------------------------------------- the schematic */
.web-map{grid-column:1; grid-row:2; min-width:0; min-height:0; padding:10px 4px 4px 12px;
  background:radial-gradient(120% 90% at 30% 20%, #0f1519 0%, var(--bg) 70%);}
.schematic{width:100%; height:100%; display:block;}

/* The tug's board stands where the schematic does while the drone is home: no
   boxes, no doors, nothing to walk (docs/tasks/G54-two-ships-confusion.md). */
.web-board{margin:0; font-family:var(--mono); font-size:15px; line-height:1.5;
  color:var(--fg); white-space:pre; overflow:auto;}
.web-board::first-line{color:var(--accent);}
.schematic text{font-family:var(--mono); fill:var(--fg);}

.room-box{fill:#0d1216; fill-opacity:.85; stroke:var(--bulkhead); stroke-width:1;}
.room-name{font-size:14px; letter-spacing:.06em; fill:var(--fg); font-weight:600;}
.room-id{font-size:11px; fill:var(--fg-dim);}
.glyph{font-size:14px; fill:var(--soft); letter-spacing:.16em;}
.glyph.hostile{fill:var(--bad); font-weight:700;}

/* Tiles (?tiles=1). A tile is a symbol of unit rects painted currentColor
   (src/tiles/sprites.ts), so what fill is to a glyph, color is to a tile \u2014 and
   the pair of rules below is the pair above, said in the other property. That
   is the whole of the colour policy: whatever painted the letter paints the
   picture, the one red on machines included (G40), and the compartment's state
   still wins over it further down the block, exactly as it does for text. No
   colour is named here that is not already named for glyphs. */
.tile{color:var(--soft);}
.tile.hostile{color:var(--bad);}
/* The pictogram is the compartment's own, and quieter than its name: a label
   for the box, never one of the things standing in it. */
.zone-tile{color:var(--fg-dim);}
/* The seventh thing and everything after it, counted rather than drawn. */
.tile-more{fill:var(--fg-dim);}
/* With the flag on, every letter left in the row is centred in the cell a tile
   would have taken \u2014 and tracking is added after the last glyph as well as
   between them, so a tracked string set from its middle sits half a letter-space
   left of where it belongs. A pixel at this size, and it comes straight out of
   the gap the row is measured on. Off in tile mode, unchanged everywhere else. */
.has-tiles .glyph{letter-spacing:0;}

/* The four states of a compartment, in the order a run meets them. Each takes
   one signal and no more: a dash, a hue, a hue, and then the amber frame. */
.room.is-unknown .room-box{stroke-dasharray:4 4; stroke:var(--fg-dim); fill-opacity:.25;}
.room.is-unknown .room-name{fill:var(--fg-dim); letter-spacing:.28em;}
.room.is-scanned .room-box{stroke:#2a3238; fill:#0c1115;}
.room.is-scanned .room-name{fill:var(--fg-dim); font-weight:400;}
.room.is-scanned .room-id,.room.is-scanned .glyph{fill:var(--fg-dim);}
.room.is-scanned .tile,.room.is-scanned .zone-tile{color:var(--fg-dim);}
.room.is-explored .room-box{stroke:var(--bulkhead);}
.room.is-visible .room-box{stroke:var(--zone);}
.room.is-visible .room-name{fill:var(--bright);}
.room.is-current .room-box{stroke:var(--accent); stroke-width:2; fill:#151a1f; fill-opacity:.95;}
.room.is-current .room-halo{fill:none; stroke:var(--accent); stroke-width:5; opacity:.10;}
.room.is-current .room-name{fill:var(--bright);}
.room.is-current .room-id{fill:var(--airlock);}
.room.is-current .glyph{fill:var(--bright);}
.room.is-current .tile{color:var(--bright);}
.room.is-current .zone-tile{color:var(--airlock);}

/* Machines in there, said on the box rather than only in one small glyph: a red
   cap over the top edge with the count on it. An addition to the compartment's
   state, never a replacement for it \u2014 the artboards' rule, and the answer to
   "\u043C\u0435\u043D\u044F \u0431\u044C\u044E\u0442, \u044F \u043D\u0435 \u043F\u043E\u043D\u0438\u043C\u0430\u044E \u043E\u0442\u043A\u0443\u0434\u0430" (docs/tasks/G55-playtest-findings.md). */
.threat-cap{fill:var(--bad); opacity:.9;}
.threat-count{font-size:11px; font-weight:700; fill:var(--bg);}

/* A machine has just come into sight in there. Last in the block so it beats
   every state above it, and colour only: the stroke width and the halo are left
   where the state put them, so a box cannot resize or move while it flashes.
   The blinking itself is not a CSS animation \u2014 the frame is redrawn on the beat
   by ui/pulse.ts, which is also how the terminal view does it and how
   prefers-reduced-motion is honoured without a second rule here. */
/* Where the highlighted line of the move list would take the drone. Amber,
   like everything the screen is asking a decision about, but without the halo
   the compartment underfoot carries \u2014 the two must not be confusable. */
.room.is-goal .room-box{stroke:var(--accent); stroke-dasharray:6 3;}
.room.is-goal .room-name{fill:var(--accent);}
/* The door a red hazard line has just named (SchematicDoor.target): the
   same amber dashes a lock wears, on whatever state the door is in. */
.door-wire.is-goal{stroke:var(--accent); stroke-width:2.5; stroke-dasharray:3 4;}
.door.is-goal .door-label{fill:var(--accent);}

.room.is-alarmed .room-box{stroke:var(--bad); fill:var(--red-wash);}
.room.is-alarmed .room-name,.room.is-alarmed .room-id{fill:var(--bad);}

/* Five door states and the airlock. Two rules, and the first one beats the
   artboards' table:

   1. A door you can walk through is the BRIGHTEST line on the map, not the
      faintest. The artboards drew an open door as a hairline in the dim ink and every
      other state louder, which is backwards for the thing the whole picture is
      for \u2014 where can I go. Drawn that way the walkable graph disappeared into
      the background and what was left read as loose labels: "\u043A\u0430\u0440\u0442\u0430 \u0432\u0441\u0451 \u0435\u0449\u0451
      \u0433\u043E\u0432\u043D\u043E, \u043A\u043E\u0440\u0438\u0434\u043E\u0440 \u043D\u0430 \u0433\u043B\u0430\u0437 \u043D\u0435 \u0432\u0438\u0434\u043D\u043E".
   2. What stops you is a line with a GAP in it, and the worse the obstacle the
      wider the gap. Weight says how hard, dash says how shut. */
.door-wire{fill:none; stroke:var(--soft); stroke-width:2; stroke-linecap:round;
  stroke-linejoin:round;}
.door-wire.is-closed{stroke:var(--zone); stroke-dasharray:9 5;}
.door-wire.is-locked{stroke:var(--accent); stroke-width:2.5; stroke-dasharray:3 4;}
.door-wire.is-sealed{stroke:var(--bulkhead); stroke-width:3.5; stroke-dasharray:3 5;}
.door-wire.is-broken{stroke:var(--fg-dim); stroke-width:1.5; stroke-dasharray:1 5;}
.door-wire.is-airlock{stroke:var(--airlock); stroke-width:3.5;}

/* The label is a mark on a wire, not a node on the graph. It had a filled box
   and a border, so on a busy hull the eye counted twenty more boxes than there
   are compartments. Only the two states worth stopping for keep a frame. */
.door-tag{fill:var(--bg); stroke:none;}
.door-label{font-size:10px; fill:var(--soft);}
.door.is-closed .door-label{fill:var(--zone);}
.door.is-locked .door-tag{fill:var(--accent);}
.door.is-locked .door-label{fill:var(--bg); font-weight:700;}
.door.is-sealed .door-tag{fill:var(--bulkhead); fill-opacity:.5;}
.door.is-sealed .door-label{fill:var(--fg);}
.door.is-broken .door-label{fill:var(--fg-dim);}
.door.is-airlock .door-label{fill:var(--airlock); font-weight:700;}

/* ------------------------------------------------------------- the honeycomb */
/* The third view: hexagons and straight corridors (ui/web/hex-svg.ts). It
   borrows the room and door state classes wholesale \u2014 a compartment is the same
   compartment in all three drawings \u2014 and adds only what a hexagon has that a
   box does not.

   The corridor is drawn twice: a wide bulkhead-brown stroke for the walls, and
   the door's own state stroke on top of it. That is why a closed door reads as
   a corridor with a shut door in it rather than as a dashed line in space. */
.hexmap .room-box{fill:#0c1116; fill-opacity:.9; stroke-width:1.5;}
.hexmap .room-name{font-size:13px; letter-spacing:.04em;}
.hexmap .room-id{font-size:10px;}
.hexmap .glyph{font-size:12px; letter-spacing:.22em;}
/* The compartment's pictogram sits over the drawn hull here, where the dim ink
   the box view gives it would sink into the plating. The compartment hue is
   what the honeycomb already paints an outline with, so it costs no new signal. */
.hexmap .zone-tile{color:var(--zone);}
.hexmap .room.is-current .room-halo{fill:none; stroke:var(--accent); stroke-width:7; opacity:.12;}
.hexmap .hall-wall{stroke:var(--bulkhead); stroke-width:11; stroke-linecap:butt;}
.hexmap .hall-wall.is-airlock{stroke:var(--airlock);}
.hexmap .door-wire{stroke-width:3;}
.hexmap .door-wire.is-open{stroke:#0c1116;}
.hexmap .door-tag{fill:var(--bg); fill-opacity:.92;}
.hexmap .door.link .door-tag{fill:var(--panel-bg); stroke:var(--zone); stroke-width:1;}
.hexmap .door.link .door-label{fill:var(--zone);}

/* The run a long door makes under the deck. Drawn before everything, so the
   compartments and corridors it passes behind cover it: what is left is a line
   you can follow from one chip to the other, which is what tells a walk the
   long way round from a teleport. */
.hexmap .duct{stroke:var(--zone); stroke-width:1; stroke-dasharray:2 6; opacity:.4;}
.hexmap .duct.is-sealed{stroke:var(--bulkhead);}
.hexmap .duct.is-locked{stroke:var(--accent); opacity:.3;}

/* An unexplored hexagon is a shape and an id, and nothing else worth reading \u2014
   most of a hull is unexplored, and at full weight the dashes were the loudest
   thing on the screen. */
.hexmap .room.is-unknown .room-box{stroke:#232b31; stroke-dasharray:3 5;}
.hexmap .room.is-unknown .room-id{fill:#38424a;}
.hexmap .room.is-unknown .room-name{fill:#2b343a;}

/* The drawn hull under the honeycomb (ui/web/hullart.ts, G81). Three steps of
   tone and no fewer \u2014 the page under the ship, the hull's mass, the plate on
   that mass \u2014 because a hull a shade off the background read as an outline
   over nothing. Nothing in this block is amber: amber is the doors' and the
   airlock's, and a hull that spent it on portholes lost the doors among them.
   Every mark is steel or darker, and the skin line is the one thing brighter. */
.hexmap .hull-art{stroke:none; opacity:1;}
.hexmap .hull-skin{fill:var(--hull-body);}
/* A hole cut out of the hull \u2014 the hub of a ring station: the page shows through. */
.hexmap .hull-hole{fill:var(--bg);}
.hexmap .hull-rim{fill:none; stroke:var(--hull-rim); stroke-width:3; stroke-linejoin:miter;
  stroke-miterlimit:6;}
.hexmap .hull-rim-in{fill:none; stroke:var(--bg); stroke-width:1; stroke-linejoin:miter;
  stroke-miterlimit:6;}
.hexmap .hull-wash{fill:var(--bg); opacity:.1;}
.hexmap .hull-plate{fill:var(--hull-plate);}
.hexmap .hull-plate-lit{fill:var(--hull-plate-lit); stroke:var(--zone); stroke-width:1.3;}
.hexmap .hull-plate-rimmed{stroke:var(--hull-rim); stroke-width:1.8;}
.hexmap .hull-pod .hull-plate{stroke:var(--hull-rim); stroke-width:2;}
.hexmap .hull-deep{fill:var(--hull-deep);}
.hexmap .hull-deep-rimmed{stroke:var(--zone); stroke-width:1.3;}
.hexmap .hull-bell{fill:var(--hull-deep); stroke:var(--hull-rim); stroke-width:1.6;}
.hexmap .hull-flame{fill:var(--zone); opacity:.22;}
.hexmap .hull-light{fill:#ffffff; opacity:.045;}
.hexmap .hull-line{stroke:var(--zone); stroke-width:1; fill:none;}
.hexmap .hull-glass{fill:var(--zone); opacity:.9;}
.hexmap .hull-steel{fill:var(--zone);}
/* Over a hull, an unexplored hexagon lets a little of the plating through:
   most of a hull is unexplored, and a page of near-black cells over a drawn
   ship read as holes punched in it. The sibling combinator keeps this to the
   frames that have a hull at all, so ?hull=0 looks exactly as it did. */
.hexmap .hull-art ~ .room.is-unknown .room-box{fill-opacity:.55;}

.tug-box{fill:#0d1216; stroke:var(--fg); stroke-width:1.5;}
.tug-name{font-size:18px; fill:var(--fg);}
.hull{stroke:var(--hull); stroke-width:2.5; opacity:.8;}
.banner{font-size:14px; fill:var(--accent); letter-spacing:.05em;}
.ship-line{font-size:11px; fill:var(--soft);}

/* ------------------------------------------------------------------ the panel */
.web-panel{grid-column:2; grid-row:2; min-height:0; overflow-y:auto; padding:10px 12px 16px;
  background:var(--panel-bg); border-left:1px solid var(--line);
  display:flex; flex-direction:column; gap:9px;}

/* One block of the panel. panelBlocks already parts them with blank rows and
   this is that parting drawn: a rule between blocks instead of an empty row,
   which buys back the height the artboards spent on air. */
.pb{display:flex; flex-direction:column; gap:1px;}
.pb + .pb{border-top:1px solid var(--line); padding-top:8px;}
.pl{white-space:pre; min-height:1.45em;}
.pl.h{letter-spacing:.2em; font-size:10px; color:var(--soft);}
.pl.hit{color:var(--bad); animation:salvor-hit .45s steps(2,end) 2;}
@keyframes salvor-hit{0%,100%{opacity:1;} 50%{opacity:.25;}}
.bar{letter-spacing:.5px;}
.bar .off{color:var(--line);}

/* The rack. A slot is a row with a bar in it, and it gets the row treatment: a
   cold ground, a quiet left edge, and nothing loud \u2014 so that the one slot which
   is loud has the whole panel to itself. */
.pl.slot{padding:3px 7px; background:#0c1115; border:1px solid var(--line);
  border-left:2px solid var(--line);}
.pl.slot.is-exposed{background:var(--amber-wash); border-color:var(--accent);
  border-left-width:4px; box-shadow:0 0 0 3px rgba(224,164,88,.10); font-weight:600;}
.pl.slot.hit{border-color:var(--bad); border-left-color:var(--bad);}

/* The ship's alert, coloured by the rung it is on (panel-html.ts puts the
   level on the row as a class). Nothing below three: a counter. Three and four
   are the ship shutting doors and sending its hunter \u2014 amber, the terminal's
   own warn colour rather than the accent, so the one rule about amber (a
   decision is required *here*) keeps its word. Five is the scuttle countdown:
   red, and blinking, because it is the one number on the screen that is a
   deadline. The blink is a CSS animation and not a beat redraw (ui/pulse.ts)
   because it has to run while the player is thinking, not only on turns \u2014
   and it is switched off for anyone who asked their system for less motion. */
.web-alert.is-l3,.web-alert.is-l4{color:var(--warn) !important; font-weight:600;}
.web-alert.is-l5{color:var(--bad) !important; font-weight:700;
  animation:salvor-alert .9s steps(2,end) infinite;}
@keyframes salvor-alert{0%,100%{opacity:1;} 50%{opacity:.35;}}
@media (prefers-reduced-motion: reduce){.web-alert.is-l5{animation:none;}}

/* The same row lifted above the rack from three up: framed, on a wash of its
   own colour, so the shape of the panel changes the moment the ship starts
   answering \u2014 which is what the owner asked for in "\u0443\u0440\u043E\u0432\u0435\u043D\u044C \u0430\u043B\u0435\u0440\u0442\u0430 \u0434\u043E\u043B\u0436\u0435\u043D
   \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u0442\u044C\u0441\u044F \u0431\u043E\u043B\u0435\u0435 \u043E\u0447\u0435\u0432\u0438\u0434\u043D\u043E". */
.pb.web-alarm{border:1px solid var(--warn); background:var(--amber-wash); border-radius:2px;
  padding:4px 8px; letter-spacing:.06em;}
.pb.web-alarm.is-l5{border-color:var(--bad); background:var(--red-wash);}
.pb.web-alarm + .pb{border-top:none; padding-top:0;}

/* The exposed slot said twice: once as its own row in the rack, once as a small
   mark in the bottom-left corner of the map, which is where the owner asked for
   it \u2014 "\u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0443\u0434\u0430\u0440 \u043C\u0435\u043B\u043A\u0438\u043C \u0437\u043D\u0430\u0447\u043A\u043E\u043C \u0441\u043D\u0438\u0437\u0443 \u0441\u043B\u0435\u0432\u0430". It sits in the map cell of
   the grid rather than over it, so it can never cover a compartment box. */
.web-expose{grid-column:1; grid-row:2; align-self:end; justify-self:start;
  margin:0 0 8px 12px; z-index:2; pointer-events:none;}
.expose{border:1px solid var(--accent); background:var(--amber-wash); border-radius:2px;
  padding:3px 8px; display:flex; align-items:baseline; gap:8px;}
.expose .lbl{font-size:9px; letter-spacing:.16em; color:var(--airlock);}
.expose .row{font-size:12px; font-weight:600; letter-spacing:.04em; color:var(--accent);
  line-height:1.2; white-space:pre;}

.acts{display:flex; flex-direction:column; gap:1px;}
/* position:relative because the cursor mark is absolute inside it. Without it
   the mark hangs off the root element instead of its own row, and lands in the
   log at the foot of the screen \u2014 which is exactly where the owner found it. */
.act{position:relative; display:grid; grid-template-columns:18px 1fr; gap:7px; align-items:baseline;
  width:100%; text-align:left; padding:3px 6px; border:1px solid transparent; border-radius:2px;
  background:none; color:var(--fg); font:inherit; cursor:pointer;}
.act:hover{background:#18222a; border-color:#26333c;}
.act .key{color:var(--soft); text-align:right; font-variant-numeric:tabular-nums;}
.act .label{white-space:pre-wrap;}
.act .extra{grid-column:2; color:var(--soft); font-size:11px;}
.act.is-off{color:var(--fg-dim);} .act.is-off .key{color:var(--fg-dim);}
.act.is-off .extra{color:var(--fg-dim);}
.act.is-cursor{background:var(--amber-wash); border-color:var(--accent); color:var(--accent);}
.act.is-cursor .key{color:var(--accent);}
.act.is-cursor .label{font-weight:700;}
.act .cursor{position:absolute; margin-left:-13px; color:var(--accent);}

/* The keys, pinned to the bottom right corner of the panel in every state \u2014
   "\u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0438 \u043F\u043E \u0445\u043E\u0442\u043A\u0435\u044F\u043C \u0432\u0441\u0435\u0433\u0434\u0430 \u0441\u043D\u0438\u0437\u0443 \u0441\u043F\u0440\u0430\u0432\u0430" (docs/tasks/G48-travel-to-a-room.md).
   panelBlocks already puts them on its last rows; margin-top:auto is what
   keeps them at the corner when the panel is taller than its content. */
.pb.foot{margin-top:auto; border-top:1px solid var(--line); padding-top:7px;
  color:var(--soft); font-size:11px;}

/* -------------------------------------------------------------------- the log */
/* Seven lines and the newest of them at the bottom, which is what the terminal
   shows too (LAYOUT.logHeight). The rest of the tail stays scrollable above:
   mount.ts pins the box to its own bottom after every frame, because innerHTML
   reopens it at the top otherwise \u2014 and the top of a log is the part already
   read. */
.web-log{grid-column:1 / -1; grid-row:3; height:124px; overflow-y:auto;
  padding:6px 14px; border-top:1px solid var(--line); background:#0c1013; font-size:12px;
  line-height:1.4;}
.web-log div{white-space:pre-wrap;}
.web-log .plain{color:var(--fg);} .web-log .good{color:var(--good);}
.web-log .bad{color:var(--bad);} .web-log .warn{color:var(--warn);}
/* Age, in three steps and by turn rather than by line count: this turn keeps
   its tone, the turn before it goes soft, everything older goes dim
   (ui/logline.ts, logFades). The gap is the same statement without colour \u2014
   four pixels where one turn ends and the next begins. */
.web-log .recent{color:var(--soft);} .web-log .old{color:var(--fg-dim);}
.web-log .turn-gap{margin-top:4px;}

/* The alarm tone: a hazard the drone has been told about (systems/hazards.ts).
   Red ink that never fades, and the newest one on a red ground across the
   whole row \u2014 the same two rules the terminal draws it by, so a player who
   reads only the bottom of the screen cannot miss it in either view. */
.web-log .alarm{color:var(--bad); font-weight:600;}
.web-log .alarm.live{background:var(--bad); color:var(--bright); margin:0 -14px; padding:1px 14px;}

/* ---------------------------------------------------------------- the overlays */
.web-over{position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(6,9,11,.9); padding:24px; z-index:5;}
.card{max-width:min(700px,92vw); max-height:88vh; overflow-y:auto; padding:20px 26px;
  border:1px solid var(--line); border-top:2px solid var(--accent); border-radius:3px;
  background:var(--panel-bg);}
.card div{white-space:pre-wrap;}
.card .h{color:var(--accent); font-size:19px; letter-spacing:.1em; margin-bottom:10px;}
.card .head{color:var(--soft); font-size:10px; letter-spacing:.2em; margin-top:14px;}
.card .keys{color:var(--fg);} .card .prose{color:var(--soft);}
.card .sub{color:var(--fg); margin:10px 0;}
.card .hint{color:var(--fg-dim); margin-top:14px;}
.card.good{border-top-color:var(--good);} .card.good .h{color:var(--good);}
.card.bad{border-top-color:var(--bad);} .card.bad .h{color:var(--bad);}

/* ------------------------------------------------------------ the start screen
   G84. The terminal spends rows on the name because rows are all a grid has;
   here it is a type size, and the menu is a real three-column grid so the keys
   line up without a padded string. Amber stays what rule 1 above says it is \u2014
   the key you are being asked to press \u2014 so the ring rows mark what they are
   *on* with the bright token and leave the rest dim, exactly as the terminal does. */
.card.title{max-width:min(760px,94vw); text-align:center;}
.card.title .head, .card.title .hint, .card.title .keys{text-align:center;}
.title-name{color:var(--accent); font-size:44px; font-weight:600; letter-spacing:.22em;
  line-height:1.1; margin-bottom:10px;}
.title-tag{color:var(--fg); font-size:15px; margin-bottom:6px;}
.title-menu{display:inline-grid; grid-template-columns:auto auto auto; gap:2px 14px;
  text-align:left; margin:10px 0 4px;}
/* The row generates no box of its own, so the pointer and the hover live on
   its three cells. Amber is spoken for (rule 1), so a row under the cursor
   brightens its own ground rather than borrowing the signal colour. */
.title-row{display:contents;}
.title-row > span{cursor:pointer; padding:1px 4px; margin:-1px -4px;}
.title-row:hover > span{background:var(--line);}
.title-row:hover .title-label{color:var(--bright);}
/* And the same ground under the row the arrows have walked to, which is the row
   Enter does (ui/appstate.ts, the title branch). */
.title-row.is-cursor > span{background:var(--line);}
.title-row.is-cursor .title-label{color:var(--bright); font-weight:700;}
.title-key{color:var(--accent); font-weight:600;}
.title-label{color:var(--fg);}
.title-value{color:var(--soft);}
.title-on{color:var(--bright); font-weight:600;}
.title-off{color:var(--fg-dim);}
.title-foot{color:var(--fg-dim); font-size:11px; margin-top:16px;}
`;

// ../../../smoreg_works/games/salvor/src/ui/web/panel-html.ts
function listHeading() {
  return t("panel.actions");
}
var BAR_RUN = /[▮▯]+/g;
var EXPOSED = "\u25C0";
var LIFT_ALERT_FROM = 3;
function alertLevelOf(text3) {
  const prefix = t("panel.alert", { gauge: "" }).trim();
  const row = text3.trim();
  if (prefix.length === 0 || !row.startsWith(prefix)) return void 0;
  const bar = /[▮▯]+/.exec(row.slice(prefix.length));
  if (bar === null) return void 0;
  return [...bar[0]].filter((ch) => ch === "\u25AE").length;
}
function htmlOf(blocks2, foot, actions, cursor, flash = /* @__PURE__ */ new Set(), lit = /* @__PURE__ */ new Set()) {
  const heading2 = listHeading();
  const alarm = blocks2.find((line2) => (alertLevelOf(line2.text) ?? 0) >= LIFT_ALERT_FROM);
  const body = alarm === void 0 ? blocks2 : blocks2.filter((line2) => line2 !== alarm);
  const groups = ordered(groupsOf(body), heading2);
  const out2 = groups.map((group) => {
    const rows = group.map((line2, j) => lineHtml(line2, flash, lit, j === 0));
    if (group.some((line2) => line2.text.trim() === heading2)) rows.push(actionsHtml(actions, cursor));
    return `<section class="pb">${rows.join("")}</section>`;
  });
  if (alarm !== void 0) {
    const level = alertLevelOf(alarm.text) ?? 0;
    out2.unshift(`<section class="pb web-alarm is-l${level}">${lineHtml(alarm, flash, lit)}</section>`);
  }
  if (foot.length === 0) return out2.join("");
  const keys = foot.map((line2) => lineHtml(line2, flash, lit)).join("");
  return [...out2, `<section class="pb foot">${keys}</section>`].join("");
}
function ordered(groups, heading2) {
  const rack = groups.filter((g) => g.some((l) => slotNumberOf(l.text) !== void 0));
  const seen = groups.filter((g) => !rack.includes(g) && g.some((l) => l.id !== void 0));
  const acts = groups.filter(
    (g) => !rack.includes(g) && !seen.includes(g) && g.some((l) => l.text.trim() === heading2)
  );
  const rest = groups.filter((g) => !rack.includes(g) && !seen.includes(g) && !acts.includes(g));
  return [...rack, ...seen, ...acts, ...rest];
}
function groupsOf(blocks2) {
  const out2 = [];
  let group = [];
  for (const line2 of blocks2) {
    if (line2.text.trim().length === 0) {
      if (group.length > 0) out2.push(group);
      group = [];
      continue;
    }
    group.push(line2);
  }
  if (group.length > 0) out2.push(group);
  return out2;
}
function exposeHtml(blocks2, flash, lit) {
  const row = blocks2.find((line2) => line2.text.includes(EXPOSED));
  if (row === void 0) return "";
  const slot = slotNumberOf(row.text);
  const hit = slot !== void 0 && flash.has(slot);
  return [
    `<div class="web-expose"><div class="expose${hit ? " hit" : ""}">`,
    `<span class="lbl">${esc(t("panel.nextHit"))}</span>`,
    `<div class="row">${bars(row.text.trim())}</div>`,
    "</div></div>"
  ].join("");
}
function codexHtml(badge) {
  if (badge === void 0) return "";
  const place2 = `style="grid-column:1;grid-row:2;align-self:start;justify-self:start;margin:8px 0 0 12px;z-index:2;pointer-events:none"`;
  const chip2 = `style="border:1px solid var(--accent);background:var(--amber-wash);border-radius:2px;padding:2px 8px;color:var(--accent);font-size:12px;font-weight:600;letter-spacing:.06em"`;
  return `<div class="web-codex" ${place2}><div ${chip2}>${esc(badge)}</div></div>`;
}
function lineHtml(line2, flash = /* @__PURE__ */ new Set(), lit = /* @__PURE__ */ new Set(), first = false) {
  const slot = slotNumberOf(line2.text);
  const hit = slot !== void 0 && flash.has(slot);
  const colour = varOf(panelColour(line2, flash, lit));
  const classes = ["pl"];
  if (first && line2.fg === THEME.accent) classes.push("h");
  if (slot !== void 0) classes.push("slot");
  if (line2.text.includes(EXPOSED)) classes.push("is-exposed");
  if (hit) classes.push("hit");
  const alert = alertLevelOf(line2.text);
  if (alert !== void 0) classes.push("web-alert", `is-l${alert}`);
  return `<div class="${classes.join(" ")}" style="color:${colour}">${bars(line2.text)}</div>`;
}
function bars(text3) {
  let out2 = "";
  let at = 0;
  for (const run2 of text3.matchAll(BAR_RUN)) {
    const start2 = run2.index;
    out2 += esc(text3.slice(at, start2));
    out2 += `<span class="bar">${[...run2[0]].map((ch) => `<i class="${ch === "\u25AE" ? "on" : "off"}">${ch}</i>`).join("")}</span>`;
    at = start2 + run2[0].length;
  }
  return out2 + esc(text3.slice(at));
}
function debugHtml(lines) {
  if (lines.length === 0) return "";
  const rows = lines.map((line2) => lineHtml(line2)).join("");
  return `<section class="pb web-debug">${rows}</section>`;
}
function actionsHtml(actions, cursor) {
  if (actions.length === 0) return "";
  const rows = actions.map((action, i) => {
    const head = action.head === void 0 ? "" : `<div class="pl h">${esc(action.head)}</div>`;
    const classes = ["act"];
    if (i === cursor) classes.push("is-cursor");
    if (!action.enabled) classes.push("is-off");
    const extra = action.extra === void 0 ? "" : `<span class="extra">${esc(action.extra)}</span>`;
    const mark = i === cursor ? '<span class="cursor">\u25B8</span>' : "";
    return [
      head,
      `<button type="button" class="${classes.join(" ")}" data-line="${i}">`,
      `<span class="key">${mark}${esc(action.key)}</span>`,
      `<span class="label">${esc(action.label)}</span>`,
      extra,
      "</button>"
    ].join("");
  });
  return `<div class="acts">${rows.join("")}</div>`;
}

// ../../../smoreg_works/games/salvor/src/content/hullforms.ts
var SHAPES = {
  /** The freighter: a box, blunt both ends, a short chin at the bow. */
  boxcar: {
    name: "box freighter",
    nose: 0.5,
    bodies: [{ sections: [[0.16, 1], [0.6, 1], [0.24, 0.6]], blunt: true }]
  },
  /** The barge: a pusher box, a coupling, a barge behind. */
  bargetrain: {
    name: "barge train",
    nose: 0.6,
    bodies: [
      { sections: [[0.42, 1]], blunt: true },
      { from: 0.4, sections: [[0.2, 0.15]], blunt: true },
      { from: 0.58, sections: [[0.3, 0.9], [0.12, 0.45]] }
    ]
  },
  /** The ferry: a whale, fat amidships, tapering both ways. */
  whale: {
    name: "whaler",
    nose: 0.9,
    bodies: [{ sections: [[0.18, 0.7], [0.5, 1], [0.2, 0.7], [0.12, 0.3]] }]
  },
  /** The probe: a teardrop, the bulk forward of the stern, a long point. */
  teardrop: {
    name: "probe teardrop",
    nose: 1.3,
    bodies: [{ sections: [[0.2, 0.6], [0.45, 1], [0.25, 0.6], [0.1, 0.2]] }]
  },
  /** The tender: a dock — a long flat slab with a bay cut into its belly. */
  drydock: {
    name: "dock ladder",
    nose: 0.4,
    bodies: [{ sections: [[0.3, 1], [0.25, 0.55], [0.45, 1]], blunt: true }]
  },
  /** The laboratory: a spindle, both ends drawn to a point. */
  spindle: {
    name: "courier spindle",
    nose: 1.1,
    bodies: [{ sections: [[0.18, 0.5], [0.44, 1], [0.24, 0.6], [0.14, 0.2]] }]
  },
  /** The military hull: a wedge, widest at the stern, straight to the point. */
  dreadnought: {
    name: "wedge dreadnought",
    nose: 1,
    bodies: [{ sections: [[0.3, 1], [0.3, 0.75], [0.25, 0.45], [0.15, 0.2]] }]
  },
  /** The smuggler: a hammer — a wide head aft, a narrow shaft forward. */
  hammerboat: {
    name: "hammer boat",
    nose: 0.7,
    // The head takes more of the keel than the sandbox's did: the game's
    // compartments come as a compact deck that has to fit in the head, and a
    // short head is a long shaft, which is a wide ship and small hexagons.
    bodies: [{ sections: [[0.55, 1], [0.35, 0.35], [0.1, 0.2]] }]
  },
  /** The corsair: a harpoon — a head, a long shaft, the longest point. */
  harpoon: {
    name: "harpoon corvette",
    nose: 1.5,
    bodies: [{ sections: [[0.36, 1], [0.44, 0.4], [0.2, 0.2]] }]
  },
  /** The quarantine hull: a station — a drum with a hole through the middle. */
  ringstation: {
    name: "ring station",
    nose: 0.3,
    bodies: [{ sections: [[0.2, 0.6], [0.6, 1], [0.2, 0.6]], blunt: true }],
    holes: [{ from: 0.4, sections: [[0.2, 0.15]], blunt: true }]
  },
  /** The father's tug: the hammer again, its head taller than anything. */
  tug: {
    name: "hammer tug",
    nose: 0.7,
    bodies: [{ sections: [[0.45, 1], [0.15, 0.6], [0.4, 0.3]] }]
  },
  /** A scout needle: the keel with a slight bulge. Unused by the catalogue, kept for variety. */
  needle: {
    name: "scout needle",
    nose: 1.4,
    bodies: [{ sections: [[0.25, 0.4], [0.4, 0.7], [0.35, 0.2]] }]
  },
  /** Two keels and a cross-piece. Unused by the catalogue, kept for variety. */
  catamaran: {
    name: "catamaran",
    nose: 0.9,
    bodies: [
      { dy: 1, sections: [[0.25, 0.45], [0.5, 0.5], [0.25, 0.25]] },
      { dy: -1, sections: [[0.25, 0.45], [0.5, 0.5], [0.25, 0.25]] },
      { from: 0.35, sections: [[0.3, 1]], blunt: true }
    ]
  },
  /** A hull and a tall cross-piece. Unused by the catalogue, kept for variety. */
  cross: {
    name: "hospital cross",
    nose: 0.8,
    bodies: [
      { sections: [[0.3, 0.5], [0.4, 0.5], [0.3, 0.3]] },
      { from: 0.4, sections: [[0.2, 1]], blunt: true }
    ]
  }
};
var COL = Math.sqrt(3);
function shipForm(kind, seed, size, half) {
  const spec2 = SHAPES[kind];
  const rng = mulberry32(Math.imul(seed, 40503) >>> 0);
  const jitter = () => 0.9 + rng() * 0.2;
  const bodies = [];
  for (const body of spec2.bodies) {
    const end = Math.max(0, ...bodies.map((b) => b.sections[b.sections.length - 1].to));
    bodies.push(resolve(body, size, half, jitter, bodies.length === 0 ? void 0 : end));
  }
  const holes = half === 0 ? [] : (spec2.holes ?? []).map((hole) => resolve(hole, size, half - 1, jitter, void 0));
  const nose2 = spec2.nose * COL * jitter();
  const cells = cellsOf(bodies, holes);
  const polygons = bodies.map((body) => polygonOf(body, nose2));
  const cuts = holes.map(holePolygonOf);
  const pods = bodies.flatMap((body, i) => body.sections[0].from === 0 ? podsOf(polygons[i], rng) : []);
  const hull3 = polygons[0];
  const all = polygons.flat();
  return {
    kind,
    name: spec2.name,
    seed,
    size,
    half,
    cells,
    hull: hull3,
    bodies: polygons,
    holes: cuts,
    pods,
    R: 1,
    length: Math.max(...all.map((p) => p.x)),
    sternHalf: Math.abs(hull3[0].y),
    halfMax: Math.max(...all.map((p) => Math.abs(p.y)))
  };
}
function resolve(spec2, size, half, jitter, noLaterThan) {
  const row = Math.round((spec2.dy ?? 0) * (half + 1));
  let at = Math.round((spec2.from ?? 0) * size);
  if (noLaterThan !== void 0) at = Math.min(at, noLaterThan);
  const sections = [];
  for (const [lengthShare, halfShare] of spec2.sections) {
    const length = Math.max(1, Math.round(lengthShare * size * jitter()));
    const rows = Math.round(halfShare * half);
    sections.push({ from: at, to: at + length, half: rows });
    at += length;
  }
  return { row, sections, blunt: spec2.blunt === true };
}
function cellsOf(bodies, holes) {
  const out2 = /* @__PURE__ */ new Map();
  for (const body of bodies) {
    for (const cell2 of blockCells(body)) out2.set(hexKey(cell2), cell2);
  }
  for (const hole of holes) {
    for (const cell2 of blockCells(hole)) out2.delete(hexKey(cell2));
  }
  return [...out2.values()].sort((a, b) => 2 * a.q + a.r - (2 * b.q + b.r) || a.r - b.r);
}
function blockCells(body) {
  const out2 = [];
  for (const section of body.sections) {
    for (let r = body.row - section.half; r <= body.row + section.half; r++) {
      const first = Math.ceil(section.from - r / 2);
      const last = Math.ceil(section.to - r / 2) - 1;
      for (let q = first; q <= last; q++) out2.push({ q, r });
    }
  }
  return out2;
}
function polygonOf(body, nose2) {
  const top = [];
  const bottom = [];
  const cy = body.row * 1.5;
  const sections = body.sections;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const H = s.half * 1.5 + 1;
    const x0 = (s.from - 0.5) * COL;
    const x1 = s.to * COL;
    const prev = sections[i - 1];
    const next = sections[i + 1];
    const leanIn = prev !== void 0 && prev.half > s.half ? chamfer(s, prev) : 0;
    const leanOut = next !== void 0 && next.half > s.half ? chamfer(s, next) : 0;
    top.push({ x: x0 + leanIn, y: cy - H }, { x: x1 - leanOut, y: cy - H });
    bottom.push({ x: x0 + leanIn, y: cy + H }, { x: x1 - leanOut, y: cy + H });
  }
  const last = sections[sections.length - 1];
  const tip = body.blunt ? [] : [{ x: last.to * COL + nose2, y: cy }];
  return [...top, ...tip, ...bottom.reverse()];
}
function chamfer(shorter, taller) {
  const own = (shorter.to - shorter.from) * COL;
  return Math.min(own * 0.5, (taller.half - shorter.half) * 1.5 * 2.2);
}
function holePolygonOf(hole) {
  const first = hole.sections[0];
  const last = hole.sections[hole.sections.length - 1];
  const cy = hole.row * 1.5;
  const H = Math.max(...hole.sections.map((s) => s.half)) * 1.5 + 0.5;
  const x0 = first.from * COL;
  const x1 = (last.to - 0.5) * COL;
  return [
    { x: x0, y: cy - H },
    { x: x1, y: cy - H },
    { x: x1, y: cy + H },
    { x: x0, y: cy + H }
  ];
}
function podsOf(body, rng) {
  const top = body[0];
  const bottom = body[body.length - 1];
  const half = (bottom.y - top.y) / 2;
  const mid2 = (bottom.y + top.y) / 2;
  const w = 0.95;
  const len = 2.2 + rng() * 0.8;
  const seats = half >= 1.5 ? [mid2 - half + w * 0.55, mid2 + half - w * 0.55] : [mid2];
  return seats.map((y) => ({ x: top.x - len, y: y - w / 2, w: len + 0.4, h: w }));
}
var MASK_SLACK = 0.2;
function fitSize(kind, seed, half, want) {
  for (let size = 2; size < SIZE_CEILING; size++) {
    if (shipForm(kind, seed, size, half).cells.length >= want) return size;
  }
  return SIZE_CEILING;
}
var SIZE_CEILING = 12;
var HALF_CEILING = 3;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = a + 1831565813 >>> 0;
    let t2 = a;
    t2 = Math.imul(t2 ^ t2 >>> 15, t2 | 1);
    t2 ^= t2 + Math.imul(t2 ^ t2 >>> 7, t2 | 61);
    return ((t2 ^ t2 >>> 14) >>> 0) / 4294967296;
  };
}

// ../../../smoreg_works/games/salvor/src/content/hulls-art.ts
var HULL_PROFILES = {
  /** The freighter: a box with two pods and a blunt bow. */
  boxcar: {
    form: "boxcar",
    nacelles: 2,
    podLength: 3,
    nose: 0,
    bridge: true,
    hatches: 4,
    plating: "frames",
    ports: 2
  },
  /** The barge: tanks in a row, one pod pushing, no bridge of its own. */
  train: {
    form: "bargetrain",
    nacelles: 1,
    podLength: 3.4,
    nose: 0,
    bridge: false,
    hatches: 6,
    plating: "tanks",
    ports: 0
  },
  /** The ferry: a hab block, lit along the whole rim. */
  habblock: {
    form: "whale",
    nacelles: 2,
    podLength: 2.4,
    nose: 0.4,
    bridge: true,
    hatches: 2,
    plating: "frames",
    ports: 8
  },
  /** The probe: a needle, one pod, a long spike forward. */
  needle: {
    form: "teardrop",
    nacelles: 1,
    podLength: 3.2,
    nose: 1.6,
    bridge: false,
    hatches: 0,
    plating: "bare",
    ports: 0
  },
  /** The tender: a dock that never moves — hatches everywhere, no engines. */
  drydock: {
    form: "drydock",
    nacelles: 0,
    podLength: 0,
    nose: 0,
    bridge: true,
    hatches: 6,
    plating: "frames",
    ports: 3
  },
  /** The laboratory: a spindle, tapered both ways. */
  spindle: {
    form: "spindle",
    nacelles: 1,
    podLength: 2.8,
    nose: 1,
    bridge: true,
    hatches: 1,
    plating: "tanks",
    ports: 4
  },
  /** The military hull: an arrow, two pods, a sharp bow. */
  arrow: {
    form: "dreadnought",
    nacelles: 2,
    podLength: 3.6,
    nose: 1.3,
    bridge: true,
    hatches: 2,
    plating: "frames",
    ports: 1
  },
  /** The smuggler: a hammer, heavy pods and a blunt head. */
  hammer: {
    form: "hammerboat",
    nacelles: 2,
    podLength: 3.8,
    nose: 0,
    bridge: true,
    hatches: 3,
    plating: "frames",
    ports: 2
  },
  /** The corsair: a harpoon, one big pod and the longest spike. */
  harpoon: {
    form: "harpoon",
    nacelles: 1,
    podLength: 3.8,
    nose: 1.8,
    bridge: true,
    hatches: 1,
    plating: "bare",
    ports: 1
  },
  /** The quarantine hull: a station — a drum of tanks with a hole through it, no engines. */
  ring: {
    form: "ringstation",
    nacelles: 0,
    podLength: 0,
    nose: 0,
    bridge: false,
    hatches: 5,
    plating: "tanks",
    ports: 4
  },
  /** The father's tug: the hammer again, but the pods are the biggest there are. */
  tug: {
    form: "tug",
    nacelles: 2,
    podLength: 4.2,
    nose: 0.5,
    bridge: true,
    hatches: 3,
    plating: "frames",
    ports: 2
  }
};
var HULL_ART = {
  freighter: "boxcar",
  tutorial: "boxcar",
  barge: "train",
  ferry: "habblock",
  probe: "needle",
  tender: "drydock",
  laboratory: "spindle",
  military: "arrow",
  smuggler: "hammer",
  corsair: "harpoon",
  quarantine: "ring",
  "fathers-tug": "tug"
};
function hullProfileOf(classId) {
  if (classId === void 0) return void 0;
  const id = HULL_ART[classId];
  return id === void 0 ? void 0 : HULL_PROFILES[id];
}
function hullArtOf(ship, shipId) {
  const classId = classOfShip(ship);
  const profile = hullProfileOf(classId);
  if (profile === void 0) return { profile, seed: shipId, form: void 0, mask: void 0 };
  const kept = FITTED.get(ship)?.get(shipId);
  if (kept !== void 0) return kept;
  const seed = fnv(shipId);
  const form = fitted2(ship, profile.form, seed);
  const mask = new Set(form.cells.map(hexKey));
  const art = { profile, seed: shipId, form, mask };
  const byId = FITTED.get(ship) ?? /* @__PURE__ */ new Map();
  byId.set(shipId, art);
  FITTED.set(ship, byId);
  return art;
}
var FITTED = /* @__PURE__ */ new WeakMap();
var GROW_TRIES = 4;
var LINKLESS_TRIES = 1;
function fitted2(ship, kind, seed) {
  const own = hexLayout(ship);
  const grownHere = own.links.size === 0 && own.offLattice.length === 0;
  const across2 = hexThickness(own.cells.values());
  const half = Math.min(HALF_CEILING, Math.max(0, Math.ceil((across2 - 1) / 2)));
  const laid = (form) => hexLayout(ship, { allowed: new Set(form.cells.map(hexKey)) });
  let size = fitSize(kind, seed, half, Math.ceil(ship.rooms.length * (1 + MASK_SLACK)));
  let honoured;
  let since = 0;
  for (let i = 0; i <= GROW_TRIES && size <= SIZE_CEILING; i++, size++) {
    const form = shipForm(kind, seed, size, half);
    const layout = laid(form);
    if (layout.masked && layout.links.size === 0) return form;
    if (layout.masked && honoured === void 0) honoured = form;
    if (honoured !== void 0 && since++ >= LINKLESS_TRIES) return honoured;
  }
  if (honoured !== void 0) return honoured;
  if (grownHere) {
    for (; size <= SIZE_CEILING; size++) {
      const form = shipForm(kind, seed, size, half);
      if (hexFit(own.cells, new Set(form.cells.map(hexKey))) !== void 0) return form;
    }
  }
  return shipForm(kind, seed, Math.min(size, SIZE_CEILING), half);
}
function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ../../../smoreg_works/games/salvor/src/ui/web/hullart.ts
var OUTSET = 0.36;
var SIMPLIFY = 0.52;
function hullLayer(input) {
  if (input.cells.length === 0) return { svg: "", box: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  if (input.form !== void 0 && input.art.profile !== void 0) {
    return formLayer(input, input.form, input.art.profile);
  }
  return outlineLayer(input);
}
function outlineLayer(input) {
  const { cells, at, R: R2, spacing, art } = input;
  const U = R2 * spacing;
  const seed = fnv2(`${art.seed}|${cells.map(key2).sort().join(";")}`);
  const uid = seed.toString(36);
  const raw2 = outlineLoops(cells, at, U);
  const loops = raw2.map((loop) => simplify(outset(loop, U * OUTSET), U * SIMPLIFY));
  const skin = loops.map(pathOf).join(" ");
  const hull3 = hullOfLoops(loops);
  const corners2 = cells.flatMap((c) => tilingCorners(at(c), U));
  const box3 = boxOf(corners2);
  const aft = aftOf(cells, at, box3, input.airlock, U);
  const sternX = aft < 0 ? box3.minX : box3.maxX;
  const bowX = aft < 0 ? box3.maxX : box3.minX;
  const profile = art.profile;
  const body = [];
  const drawn2 = { ...box3 };
  const silhouette = [...loops];
  if (profile) {
    const pods = nacelles(cells, at, box3, aft, sternX, U, profile, seed, drawn2);
    const wedge = nose(cells, at, box3, aft, bowX, U, profile, drawn2);
    body.push(pods.svg, wedge.svg);
    silhouette.push(...pods.shapes, ...wedge.shapes);
  }
  body.push(`<path class="hull-skin" d="${skin}" fill-rule="evenodd"/>`);
  if (profile) {
    body.push(plating(hull3, aft, bowX, U, profile, seed));
    body.push(hatches(cells, at, U, profile, seed, hull3));
    body.push(portholes(cells, at, U, profile, seed, hull3));
    body.push(bridge(cells, at, box3, aft, bowX, U, profile, drawn2));
  }
  body.push(`<path class="hull-rim" d="${skin}" fill-rule="evenodd"/>`);
  body.push(`<path class="hull-rim-in" d="${skin}" fill-rule="evenodd"/>`);
  body.push(`<path class="hull-wash" d="${skin}" fill-rule="evenodd"/>`);
  for (const loop of loops) grow(drawn2, loop);
  drawn2.minX -= 2;
  drawn2.minY -= 2;
  drawn2.maxX += 2;
  drawn2.maxY += 2;
  const svg = [
    `<g class="hull-art">`,
    `<defs><clipPath id="hull-clip-${uid}"><path d="${silhouette.map(pathOf).join(" ")}" fill-rule="evenodd"/></clipPath></defs>`,
    `<g clip-path="url(#hull-clip-${uid})">`,
    ...body.filter((s) => s.length > 0),
    `</g>`,
    `</g>`
  ].join("");
  return { svg, box: drawn2 };
}
function formLayer(input, form, profile) {
  const { cells, R: R2, spacing, art } = input;
  const U = R2 * spacing;
  const seed = fnv2(`${art.seed}|${form.kind}|${cells.map(key2).sort().join(";")}`);
  const uid = seed.toString(36);
  const bodies = form.bodies.map((poly) => poly.map((p) => scaled(p, U)));
  const holes = form.holes.map((poly) => poly.map((p) => scaled(p, U)));
  const skins = bodies.map(pathOf);
  const cuts = holes.map(pathOf);
  const union = [...bodies.map(clockwise), ...holes.map(counterclockwise)].map(pathOf).join(" ");
  const hull3 = hullOfForm(bodies, holes);
  const box3 = boxOf(bodies.flat());
  const bowX = box3.maxX;
  const drawn2 = { ...box3 };
  const defs = [];
  const span = { x: box3.minX - U * 4, y: box3.minY - U * 4, w: box3.maxX - box3.minX + U * 8, h: box3.maxY - box3.minY + U * 8 };
  skins.forEach((_, i) => {
    const others = skins.filter((__, j) => j !== i);
    if (others.length === 0 && cuts.length === 0) return;
    defs.push(
      `<mask id="hull-rim-${uid}-${i}" maskUnits="userSpaceOnUse" x="${f(span.x)}" y="${f(span.y)}" width="${f(span.w)}" height="${f(span.h)}"><rect x="${f(span.x)}" y="${f(span.y)}" width="${f(span.w)}" height="${f(span.h)}" fill="#fff"/>` + others.map((d) => `<path d="${d}" fill="#000"/>`).join("") + cuts.map((d) => `<path d="${d}" fill="#fff"/>`).join("") + `</mask>`
    );
  });
  const pods = podsOf2(form, U, profile, drawn2);
  const silhouette = [...bodies.map(clockwise), ...pods.shapes.map(clockwise), ...holes.map(counterclockwise)];
  defs.push(`<clipPath id="hull-clip-${uid}"><path d="${silhouette.map(pathOf).join(" ")}"/></clipPath>`);
  const body = [];
  body.push(pods.svg);
  body.push(`<path class="hull-skin" d="${union}"/>`);
  body.push(plating(hull3, -1, bowX, U, profile, seed));
  for (const cut of cuts) body.push(`<path class="hull-hole" d="${cut}"/>`);
  skins.forEach((skin, i) => {
    const mask = skins.length > 1 || cuts.length > 0 ? ` mask="url(#hull-rim-${uid}-${i})"` : "";
    body.push(`<g${mask}><path class="hull-rim" d="${skin}"/><path class="hull-rim-in" d="${skin}"/></g>`);
  });
  for (const cut of cuts) body.push(`<path class="hull-rim" d="${cut}"/><path class="hull-rim-in" d="${cut}"/>`);
  body.push(hatchesOn(bodies[0], U, profile, seed, hull3));
  body.push(portholesOn(bodies[0], U, profile, seed, hull3));
  body.push(bridgeAt(bodies[0], U, profile, hull3));
  body.push(`<path class="hull-wash" d="${union}"/>`);
  drawn2.minX -= 2;
  drawn2.minY -= 2;
  drawn2.maxX += 2;
  drawn2.maxY += 2;
  const svg = [
    `<g class="hull-art hull-profile">`,
    `<defs>${defs.join("")}</defs>`,
    `<g clip-path="url(#hull-clip-${uid})">`,
    ...body.filter((s) => s.length > 0),
    `</g>`,
    `</g>`
  ].join("");
  return { svg, box: drawn2 };
}
function clockwise(loop) {
  return signedAreaOf(loop) >= 0 ? loop : [...loop].reverse();
}
function counterclockwise(loop) {
  return signedAreaOf(loop) <= 0 ? loop : [...loop].reverse();
}
function scaled(p, U) {
  return { x: p.x * U, y: p.y * U };
}
function podsOf2(form, U, profile, drawn2) {
  if (profile.nacelles === 0) return NOTHING;
  if (profile.nacelles === 1) {
    const hull3 = form.hull;
    const first = form.pods[0];
    const w = first?.h ?? 0.95;
    const reach2 = first?.w ?? 3;
    const mid2 = (hull3[0].y + hull3[hull3.length - 1].y) / 2;
    return podOf({ x: hull3[0].x - (reach2 - 0.4), y: mid2 - w / 2, w: reach2, h: w }, U, drawn2);
  }
  return form.pods.map((pod) => podOf(pod, U, drawn2)).reduce(join, NOTHING);
}
var NOTHING = { svg: "", shapes: [] };
function join(a, b) {
  return { svg: a.svg + b.svg, shapes: [...a.shapes, ...b.shapes] };
}
function podOf(unit, U, drawn2) {
  const pod = { x: unit.x * U, y: unit.y * U, w: unit.w * U, h: unit.h * U };
  const y = pod.y + pod.h / 2;
  const rect = [
    { x: pod.x, y: pod.y },
    { x: pod.x + pod.w, y: pod.y },
    { x: pod.x + pod.w, y: pod.y + pod.h },
    { x: pod.x, y: pod.y + pod.h }
  ];
  const bell = [
    { x: pod.x, y: y - pod.h * 0.5 },
    { x: pod.x - U * 0.42, y: y - pod.h * 0.72 },
    { x: pod.x - U * 0.42, y: y + pod.h * 0.72 },
    { x: pod.x, y: y + pod.h * 0.5 }
  ];
  const flame = [
    { x: pod.x - U * 0.5, y: y - pod.h * 0.42 },
    { x: pod.x - U * 1.5, y },
    { x: pod.x - U * 0.5, y: y + pod.h * 0.42 }
  ];
  grow(drawn2, [...bell, ...flame, ...rect]);
  const ribs = [1, 2].map((i) => seg({ x: pod.x + pod.w * i / 3, y: pod.y }, { x: pod.x + pod.w * i / 3, y: pod.y + pod.h })).join("");
  const svg = [
    `<g class="hull-pod">`,
    `<rect class="hull-plate" x="${f(pod.x)}" y="${f(pod.y)}" width="${f(pod.w)}" height="${f(pod.h)}"/>`,
    `<g class="hull-line" opacity="0.35">${ribs}</g>`,
    `<polygon class="hull-bell" points="${pts(bell)}"/>`,
    `<polygon class="hull-flame" points="${pts(flame)}"/>`,
    seg({ x: pod.x - U * 0.5, y }, { x: pod.x - U * 1.35, y }, "hull-line", 0.7, 2),
    `</g>`
  ].join("");
  return { svg, shapes: [rect, bell, flame] };
}
function bridgeAt(hull3, U, profile, inside) {
  if (!profile.bridge) return "";
  const w = U * 1.5;
  const hh = U * 0.5;
  const bowX = Math.max(...hull3.map((p) => p.x));
  const cy = (hull3[0].y + hull3[hull3.length - 1].y) / 2;
  const cut = U * 0.25;
  for (let back = 0; back < 8; back++) {
    const cx = bowX - U * (1.9 + back * 0.35);
    const block = [
      { x: cx - w / 2, y: cy - hh },
      { x: cx + w / 2 - cut, y: cy - hh },
      { x: cx + w / 2, y: cy - hh + cut },
      { x: cx + w / 2, y: cy + hh - cut },
      { x: cx + w / 2 - cut, y: cy + hh },
      { x: cx - w / 2, y: cy + hh }
    ];
    if (!block.every((p) => inside.contains(p))) continue;
    const glass = [-1, 0, 1].map(
      (k) => `<rect class="hull-glass" x="${f(cx + w / 2 - U * 0.55)}" y="${f(cy + k * U * 0.26 - U * 0.06)}" width="${f(U * 0.28)}" height="${f(U * 0.13)}"/>`
    ).join("");
    return `<g class="hull-bridge"><polygon class="hull-plate-lit hull-plate-rimmed" points="${pts(block)}"/>${glass}</g>`;
  }
  return "";
}
function sideSpot(hull3, t2, side) {
  const bowX = Math.max(...hull3.map((p2) => p2.x));
  const noseAt = hull3.findIndex((p2) => p2.x === bowX);
  const top = hull3.slice(0, noseAt + 1);
  const bottom = [...hull3.slice(noseAt)].reverse();
  const chain2 = side < 0 ? top : bottom;
  const x = chain2[0].x + (bowX - chain2[0].x) * t2;
  for (let i = 0; i + 1 < chain2.length; i++) {
    const a = chain2[i];
    const b = chain2[i + 1];
    if (x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x) || a.x === b.x) continue;
    const k = (x - a.x) / (b.x - a.x);
    const p2 = { x, y: a.y + (b.y - a.y) * k };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = side < 0 ? { x: (b.y - a.y) / len, y: -(b.x - a.x) / len } : { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    return { p: p2, n };
  }
  const p = chain2[chain2.length - 1];
  return { p, n: { x: 0, y: side } };
}
function along(seed, salt, i) {
  return 0.14 + hash01(seed, salt, i) * 0.66;
}
function hatchesOn(hull3, U, profile, seed, inside) {
  if (profile.hatches === 0) return "";
  const r = U * 0.11;
  const out2 = [];
  for (let i = 0; i < profile.hatches; i++) {
    const { p, n } = sideSpot(hull3, along(seed, 6, i), i % 2 === 0 ? -1 : 1);
    const c = { x: p.x - n.x * U * 0.24, y: p.y - n.y * U * 0.24 };
    if (!inside.holds(c.x - r, c.y - r, r * 2, r * 2)) continue;
    out2.push(
      `<g class="hull-hatch" opacity="0.85">`,
      `<rect class="hull-deep hull-deep-rimmed" x="${f(c.x - r)}" y="${f(c.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}"/>`,
      seg({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }),
      `</g>`
    );
  }
  return out2.join("");
}
function portholesOn(hull3, U, profile, seed, inside) {
  if (profile.ports === 0) return "";
  const w = U * 0.14;
  const h = U * 0.08;
  const out2 = [];
  for (let i = 0; i < profile.ports; i++) {
    const { p, n } = sideSpot(hull3, along(seed, 7, i), i % 2 === 0 ? -1 : 1);
    const c = { x: p.x - n.x * U * 0.16, y: p.y - n.y * U * 0.16 };
    const t2 = { x: -n.y, y: n.x };
    for (const k of [-1, 1]) {
      const q = { x: c.x + t2.x * U * 0.12 * k, y: c.y + t2.y * U * 0.12 * k };
      if (!inside.holds(q.x - w / 2, q.y - h / 2, w, h)) continue;
      out2.push(`<rect class="hull-glass" x="${f(q.x - w / 2)}" y="${f(q.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 3)}"/>`);
    }
  }
  return out2.join("");
}
function hullOfLoops(loops) {
  const contains = (p) => insideLoops(p, loops);
  return {
    atX: (x) => pairUp(loops.flatMap((loop) => crossingsX(loop, x))),
    atY: (y) => pairUp(loops.flatMap((loop) => crossingsY(loop, y))),
    contains,
    holds: (x, y, w, h) => cornersOf(x, y, w, h).every(contains)
  };
}
function hullOfForm(bodies, holes) {
  const contains = (p) => bodies.some((b) => insideLoop(p, b)) && !holes.some((h) => insideLoop(p, h));
  const spans = (cross) => subtract(merge(bodies.flatMap((b) => pairUp(cross(b)))), merge(holes.flatMap((h) => pairUp(cross(h)))));
  return {
    atX: (x) => spans((loop) => crossingsX(loop, x)),
    atY: (y) => spans((loop) => crossingsY(loop, y)),
    contains,
    holds: (x, y, w, h) => cornersOf(x, y, w, h).every(contains)
  };
}
function cornersOf(x, y, w, h) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}
function crossingsX(loop, x) {
  const out2 = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a.x === b.x) continue;
    if (x < Math.min(a.x, b.x) || x >= Math.max(a.x, b.x)) continue;
    out2.push(a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x));
  }
  return out2;
}
function crossingsY(loop, y) {
  const out2 = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a.y === b.y) continue;
    if (y < Math.min(a.y, b.y) || y >= Math.max(a.y, b.y)) continue;
    out2.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
  }
  return out2;
}
function pairUp(crossings) {
  const sorted = [...crossings].sort((a, b) => a - b);
  const out2 = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) out2.push([sorted[i], sorted[i + 1]]);
  return out2;
}
function merge(spans) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out2 = [];
  for (const span of sorted) {
    const last = out2[out2.length - 1];
    if (last !== void 0 && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out2.push([span[0], span[1]]);
  }
  return out2;
}
function subtract(spans, cuts) {
  let out2 = spans;
  for (const cut of cuts) {
    const next = [];
    for (const span of out2) {
      if (cut[1] <= span[0] || cut[0] >= span[1]) {
        next.push(span);
        continue;
      }
      if (cut[0] > span[0]) next.push([span[0], cut[0]]);
      if (cut[1] < span[1]) next.push([cut[1], span[1]]);
    }
    out2 = next;
  }
  return out2;
}
function outlineLoops(cells, at, U) {
  const set = new Set(cells.map(key2));
  const first = cells[0];
  if (first === void 0) return [];
  const edgeOfDir = edgesByDirection(at, first, U);
  const segs = [];
  for (const cell2 of cells) {
    const corners2 = tilingCorners(at(cell2), U);
    HEX_DIRS.forEach((d, dir) => {
      if (set.has(key2({ q: cell2.q + d.q, r: cell2.r + d.r }))) return;
      const j = edgeOfDir[dir];
      segs.push([corners2[j], corners2[(j + 1) % 6]]);
    });
  }
  const stamp = (p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  const starts = /* @__PURE__ */ new Map();
  segs.forEach((s, i) => {
    const k = stamp(s[0]);
    const list = starts.get(k);
    if (list) list.push(i);
    else starts.set(k, [i]);
  });
  const used = new Array(segs.length).fill(false);
  const out2 = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const seg2 = segs[i];
    const loop = [seg2[0], seg2[1]];
    let cur = seg2[1];
    for (; ; ) {
      const next = (starts.get(stamp(cur)) ?? []).find((j) => !used[j]);
      if (next === void 0) break;
      used[next] = true;
      const far = segs[next][1];
      if (stamp(far) === stamp(loop[0])) break;
      loop.push(far);
      cur = far;
    }
    if (loop.length >= 3) out2.push(loop);
  }
  return out2;
}
function simplify(loop, eps) {
  if (loop.length < 4) return loop;
  let start2 = 0;
  for (let i = 1; i < loop.length; i++) if (loop[i].x < loop[start2].x) start2 = i;
  const chain2 = [...loop.slice(start2), ...loop.slice(0, start2)];
  chain2.push(chain2[0]);
  const keep = new Array(chain2.length).fill(false);
  keep[0] = true;
  keep[chain2.length - 1] = true;
  const stack = [[0, chain2.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = away(chain2[i], chain2[a], chain2[b]);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst < 0 || far <= eps) continue;
    keep[worst] = true;
    stack.push([a, worst], [worst, b]);
  }
  const out2 = chain2.filter((_, i) => keep[i]);
  out2.pop();
  return out2.length >= 3 ? out2 : loop;
}
function outset(loop, d) {
  return loop.map((p, i) => {
    const prev = loop[(i - 1 + loop.length) % loop.length];
    const next = loop[(i + 1) % loop.length];
    const n1 = leftNormal(prev, p);
    const n2 = leftNormal(p, next);
    const nx = n1.x + n2.x;
    const ny = n1.y + n2.y;
    const len = Math.hypot(nx, ny) || 1;
    return { x: p.x + nx / len * d, y: p.y + ny / len * d };
  });
}
function pathOf(loop) {
  return loop.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p.x)} ${f(p.y)}`).join(" ") + " Z";
}
function insideLoops(p, loops) {
  let inside = false;
  for (const loop of loops) if (insideLoop(p, loop)) inside = !inside;
  return inside;
}
function insideLoop(p, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function signedAreaOf(loop) {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}
function nacelles(cells, at, box3, aft, sternX, U, profile, seed, drawn2) {
  if (profile.nacelles === 0) return NOTHING;
  const cols = /* @__PURE__ */ new Map();
  for (const cell2 of cells) {
    const p = at(cell2);
    const k = Math.round(p.x * 4) / 4;
    const col = cols.get(k) ?? { x: p.x, top: p.y, bottom: p.y };
    col.top = Math.min(col.top, p.y);
    col.bottom = Math.max(col.bottom, p.y);
    cols.set(k, col);
  }
  const reach2 = Math.max(U * 1.2, (box3.maxX - box3.minX) * 0.2);
  const stern = [...cols.values()].filter((c) => Math.abs(c.x - sternX) <= reach2);
  if (stern.length === 0) return NOTHING;
  const seat = stern.reduce((best, c) => c.bottom - c.top > best.bottom - best.top ? c : best, stern[0]);
  const length = U * profile.podLength * (0.94 + hash01(seed, 1) * 0.12);
  const tip = sternX + aft * U * 0.7;
  const root = tip - aft * length;
  const mid2 = (seat.top + seat.bottom) / 2;
  const spread3 = Math.min(U * 0.95, Math.max(U * 0.42, (seat.bottom - seat.top) / 2 + U * 0.1));
  const wide = spread3 > U * 0.6;
  const seats = profile.nacelles === 2 ? [mid2 - spread3, mid2 + spread3] : [mid2];
  const w = U * (profile.nacelles === 2 ? wide ? 0.7 : 0.58 : 0.85);
  return seats.map((y) => {
    const x = Math.min(root, tip);
    const front = x + (aft < 0 ? length : 0);
    const ribs = [];
    for (let i = 1; i <= 3; i++) {
      const rx = root + aft * (length * i) / 4;
      ribs.push(seg({ x: rx, y: y - w / 2 }, { x: rx, y: y + w / 2 }));
    }
    const rect = [
      { x, y: y - w / 2 },
      { x: x + length, y: y - w / 2 },
      { x: x + length, y: y + w / 2 },
      { x, y: y + w / 2 }
    ];
    const bell = [
      { x: tip, y: y - w * 0.5 },
      { x: tip + aft * U * 0.42, y: y - w * 0.72 },
      { x: tip + aft * U * 0.42, y: y + w * 0.72 },
      { x: tip, y: y + w * 0.5 }
    ];
    const flame = [
      { x: tip + aft * U * 0.5, y: y - w * 0.42 },
      { x: tip + aft * U * 1.4, y },
      { x: tip + aft * U * 0.5, y: y + w * 0.42 }
    ];
    grow(drawn2, [...bell, ...flame, ...rect]);
    const svg = [
      `<g class="hull-pod">`,
      `<rect class="hull-plate" x="${f(x)}" y="${f(y - w / 2)}" width="${f(length)}" height="${f(w)}"/>`,
      `<g class="hull-line" opacity="0.35">${ribs.join("")}</g>`,
      `<line class="hull-line" opacity="0.7" stroke-width="1.6" x1="${f(front)}" y1="${f(y - w / 2)}" x2="${f(front)}" y2="${f(y + w / 2)}"/>`,
      `<polygon class="hull-bell" points="${pts(bell)}"/>`,
      `<polygon class="hull-flame" points="${pts(flame)}"/>`,
      `<line class="hull-line" opacity="0.7" stroke-width="2" x1="${f(tip + aft * U * 0.45)}" y1="${f(y)}" x2="${f(tip + aft * U * 1.25)}" y2="${f(y)}"/>`,
      `</g>`
    ].join("");
    return { svg, shapes: [rect, bell, flame] };
  }).reduce(join, NOTHING);
}
function nose(cells, at, box3, aft, bowX, U, profile, drawn2) {
  if (profile.nose <= 0) return NOTHING;
  const fore = aft < 0 ? 1 : -1;
  const ys = bowCells(cells, at, box3, bowX, fore, U).map((p) => p.y);
  if (ys.length === 0) return NOTHING;
  const top = Math.min(...ys) - U * 0.25;
  const bottom = Math.max(...ys) + U * 0.25;
  const mid2 = (top + bottom) / 2;
  const root = bowX - fore * U * 0.9;
  const tipX = bowX + fore * U * profile.nose;
  const half = Math.min((bottom - top) / 2, U * 1.1);
  const wedge = [
    { x: root, y: mid2 - half },
    { x: bowX + fore * U * 0.1, y: mid2 - half * 0.8 },
    { x: tipX, y: mid2 },
    { x: bowX + fore * U * 0.1, y: mid2 + half * 0.8 },
    { x: root, y: mid2 + half }
  ];
  grow(drawn2, wedge);
  const svg = [
    `<g class="hull-nose">`,
    `<polygon class="hull-plate hull-plate-rimmed" points="${pts(wedge)}"/>`,
    seg({ x: bowX + fore * U * 0.1, y: mid2 - half * 0.8 }, { x: bowX + fore * U * 0.1, y: mid2 + half * 0.8 }, "hull-line", 0.5),
    `</g>`
  ].join("");
  return { svg, shapes: [wedge] };
}
function plating(hull3, aft, bowX, U, profile, seed) {
  const box3 = boxOfHull(hull3);
  if (box3 === void 0) return "";
  if (profile.plating === "bare") return capsOf(hull3, box3, aft, bowX, U);
  const out2 = [];
  const h = box3.maxY - box3.minY;
  const w = box3.maxX - box3.minX;
  const across2 = (x, cls, opacity, width) => hull3.atX(x).map(([lo, hi]) => seg({ x, y: lo }, { x, y: hi }, cls, opacity, width)).join("");
  const along2 = (y) => hull3.atY(y).map(([lo, hi]) => seg({ x: lo, y }, { x: hi, y })).join("");
  if (profile.plating === "frames") {
    const frames = [];
    const panels = [];
    const step = U * 1.15;
    let i = 0;
    for (let x = box3.minX + step; x < box3.maxX; x += step, i++) {
      frames.push(across2(x));
      if (hash01(seed, 2, i) < 0.34) panels.push(panel(hull3, x, Math.min(x + step, box3.maxX)));
    }
    out2.push(panels.join(""));
    out2.push(`<g class="hull-line" opacity="0.3">${frames.join("")}</g>`);
    const seams = [0.3, 0.7].map((t2) => along2(box3.minY + h * t2)).join("");
    out2.push(`<g class="hull-line" opacity="0.18">${seams}</g>`);
  } else {
    const rings = [];
    const step = U * 0.62;
    let i = 0;
    for (let x = box3.minX + step * 0.5; x < box3.maxX; x += step, i++) {
      rings.push(across2(x));
      if (i % 3 === 1) rings.push(across2(x + 4));
    }
    out2.push(`<g class="hull-line" opacity="0.26">${rings.join("")}</g>`);
    out2.push(`<g class="hull-line" opacity="0.2">${along2(box3.minY + h * 0.5)}</g>`);
  }
  out2.push(capsOf(hull3, box3, aft, bowX, U));
  const vents = [];
  for (let i = 0; i < 6; i++) {
    const x = box3.minX + w * (0.15 + hash01(seed, 3, i) * 0.7);
    const y = box3.minY + h * (0.35 + hash01(seed, 4, i) * 0.3);
    const vw = U * (0.4 + hash01(seed, 5, i) * 0.5);
    if (!hull3.holds(x, y, vw, U * 0.16)) continue;
    vents.push(`<rect class="hull-deep" opacity="0.5" x="${f(x)}" y="${f(y)}" width="${f(vw)}" height="${f(U * 0.16)}"/>`);
  }
  out2.push(vents.join(""));
  return out2.join("");
}
function panel(hull3, x0, x1) {
  const out2 = [];
  for (const [lo0, hi0] of hull3.atX(x0)) {
    for (const [lo1, hi1] of hull3.atX(x1 - 0.01)) {
      const lo = Math.max(lo0, lo1);
      const hi = Math.min(hi0, hi1);
      if (hi - lo < 1) continue;
      out2.push(`<rect class="hull-light" x="${f(x0)}" y="${f(lo)}" width="${f(x1 - x0)}" height="${f(hi - lo)}"/>`);
    }
  }
  return out2.join("");
}
function capsOf(hull3, box3, aft, bowX, U) {
  const capX = bowX + aft * U * 1.7;
  const sternCapX = (aft < 0 ? box3.minX : box3.maxX) - aft * U * 1.4;
  const across2 = (x, opacity) => hull3.atX(x).map(([lo, hi]) => seg({ x, y: lo }, { x, y: hi }, "hull-line", opacity, 1.4)).join("");
  return [
    panel(hull3, Math.min(capX, bowX), Math.max(capX, bowX)),
    across2(capX, 0.4),
    across2(sternCapX, 0.35)
  ].join("");
}
function boxOfHull(hull3) {
  const probe = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let x = -4e3; x <= 4e3; x += 2) {
    const spans = hull3.atX(x);
    if (spans.length === 0) continue;
    probe.minX = Math.min(probe.minX, x);
    probe.maxX = Math.max(probe.maxX, x);
    for (const [lo, hi] of spans) {
      probe.minY = Math.min(probe.minY, lo);
      probe.maxY = Math.max(probe.maxY, hi);
    }
  }
  return Number.isFinite(probe.minX) ? probe : void 0;
}
function hatches(cells, at, U, profile, seed, hull3) {
  if (profile.hatches === 0) return "";
  const spots = rimSpots(cells, at, U).filter((s) => Math.abs(s.n.y) > 0.4 || Math.abs(s.n.x) > 0.9);
  const picked = pick(spots, profile.hatches, (s) => hash01(seed, 6, s.cell.q, s.cell.r, s.dir));
  const r = U * 0.11;
  return picked.filter(({ p }) => hull3.holds(p.x - r, p.y - r, r * 2, r * 2)).map(({ p }) => [
    `<g class="hull-hatch" opacity="0.85">`,
    `<rect class="hull-deep hull-deep-rimmed" x="${f(p.x - r)}" y="${f(p.y - r)}" width="${f(r * 2)}" height="${f(r * 2)}"/>`,
    seg({ x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }),
    `</g>`
  ].join("")).join("");
}
function portholes(cells, at, U, profile, seed, hull3) {
  if (profile.ports === 0) return "";
  const spots = rimSpots(cells, at, U).filter((s) => Math.abs(s.n.y) > 0.4);
  const picked = pick(spots, profile.ports, (s) => hash01(seed, 7, s.cell.q, s.cell.r, s.dir));
  const w = U * 0.14;
  const h = U * 0.08;
  return picked.map(({ p, n }) => {
    const t2 = { x: -n.y, y: n.x };
    return [-1, 1].map((k) => {
      const c = { x: p.x + t2.x * U * 0.12 * k, y: p.y + t2.y * U * 0.12 * k };
      if (!hull3.holds(c.x - w / 2, c.y - h / 2, w, h)) return "";
      return `<rect class="hull-glass" x="${f(c.x - w / 2)}" y="${f(c.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 3)}"/>`;
    }).join("");
  }).join("");
}
function bridge(cells, at, box3, aft, bowX, U, profile, drawn2) {
  if (!profile.bridge) return "";
  const fore = aft < 0 ? 1 : -1;
  const w = U * 0.95;
  const h = U * 0.62;
  const cy = bowLine(cells, at, box3, bowX, fore, U);
  const back = bowX - fore * U * 0.45;
  const front = back + fore * w;
  const cut = U * 0.16;
  const block = [
    { x: back, y: cy - h / 2 },
    { x: front - fore * cut, y: cy - h / 2 },
    { x: front, y: cy - h / 2 + cut },
    { x: front, y: cy + h / 2 - cut },
    { x: front - fore * cut, y: cy + h / 2 },
    { x: back, y: cy + h / 2 }
  ];
  grow(drawn2, block);
  const glass = [-1, 0, 1].map((k) => {
    const x = front - fore * U * 0.3;
    return `<rect class="hull-glass" x="${f(Math.min(x, x + fore * U * 0.18))}" y="${f(cy + k * U * 0.17 - U * 0.045)}" width="${f(U * 0.18)}" height="${f(U * 0.09)}"/>`;
  }).join("");
  return `<g class="hull-bridge"><polygon class="hull-plate-lit hull-plate-rimmed" points="${pts(block)}"/>${glass}</g>`;
}
function aftOf(cells, at, box3, airlock, U) {
  const band = Math.max((box3.maxX - box3.minX) * 0.32, U);
  let west = 0;
  let east = 0;
  for (const cell2 of cells) {
    const x = at(cell2).x;
    if (x < box3.minX + band) west++;
    if (x > box3.maxX - band) east++;
  }
  const tilt = west - east;
  if (Math.abs(tilt) > 1) return tilt > 0 ? -1 : 1;
  const dock2 = airlock === void 0 ? void 0 : at(airlock).x;
  if (dock2 === void 0) return -1;
  return dock2 < (box3.minX + box3.maxX) / 2 ? -1 : 1;
}
function bowCells(cells, at, box3, bowX, fore, U) {
  const reach2 = Math.max(U * 1.2, (box3.maxX - box3.minX) * 0.2);
  const edge = bowX - fore * U * 0.87;
  return cells.map(at).filter((p) => Math.abs(p.x - edge) <= reach2);
}
function bowLine(cells, at, box3, bowX, fore, U) {
  const ys = bowCells(cells, at, box3, bowX, fore, U).map((p) => p.y);
  if (ys.length === 0) return (box3.minY + box3.maxY) / 2;
  return (Math.min(...ys) + Math.max(...ys)) / 2;
}
function rimSpots(cells, at, U) {
  const set = new Set(cells.map(key2));
  const out2 = [];
  const first = cells[0];
  if (first === void 0) return out2;
  const edgeOfDir = edgesByDirection(at, first, U);
  for (const cell2 of cells) {
    const c = at(cell2);
    const corners2 = tilingCorners(c, U);
    HEX_DIRS.forEach((d, dir) => {
      if (set.has(key2({ q: cell2.q + d.q, r: cell2.r + d.r }))) return;
      const j = edgeOfDir[dir];
      const a = corners2[j];
      const b = corners2[(j + 1) % 6];
      const mid2 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nx = mid2.x - c.x;
      const ny = mid2.y - c.y;
      const len = Math.hypot(nx, ny) || 1;
      const n = { x: nx / len, y: ny / len };
      const p = { x: mid2.x + n.x * U * OUTSET * 0.5, y: mid2.y + n.y * U * OUTSET * 0.5 };
      out2.push({ cell: cell2, dir, p, n });
    });
  }
  return out2;
}
function pick(list, n, score) {
  return [...list].map((item) => ({ item, score: score(item) })).sort((a, b) => a.score - b.score).slice(0, n).map((x) => x.item);
}
function tilingCorners(c, U) {
  const half = Math.sqrt(3) / 2 * U;
  return [
    { x: c.x, y: c.y - U },
    { x: c.x + half, y: c.y - U / 2 },
    { x: c.x + half, y: c.y + U / 2 },
    { x: c.x, y: c.y + U },
    { x: c.x - half, y: c.y + U / 2 },
    { x: c.x - half, y: c.y - U / 2 }
  ];
}
function edgesByDirection(at, sample, U) {
  const c = at(sample);
  const corners2 = tilingCorners(c, U);
  return HEX_DIRS.map((d) => {
    const far = at({ q: sample.q + d.q, r: sample.r + d.r });
    const tx = far.x - c.x;
    const ty = far.y - c.y;
    let best = 0;
    let bestDot = -Infinity;
    for (let j = 0; j < 6; j++) {
      const a = corners2[j];
      const b = corners2[(j + 1) % 6];
      const dot = ((a.x + b.x) / 2 - c.x) * tx + ((a.y + b.y) / 2 - c.y) * ty;
      if (dot > bestDot) {
        bestDot = dot;
        best = j;
      }
    }
    return best;
  });
}
function leftNormal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dy / len, y: -dx / len };
}
function away(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
function boxOf(points) {
  const box3 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  grow(box3, points);
  return box3;
}
function grow(box3, points) {
  for (const p of points) {
    box3.minX = Math.min(box3.minX, p.x);
    box3.maxX = Math.max(box3.maxX, p.x);
    box3.minY = Math.min(box3.minY, p.y);
    box3.maxY = Math.max(box3.maxY, p.y);
  }
}
function key2(cell2) {
  return `${cell2.q},${cell2.r}`;
}
function seg(p, q, cls, opacity, width) {
  const c = cls === void 0 ? "" : ` class="${cls}"`;
  const o = opacity === void 0 ? "" : ` opacity="${opacity}"`;
  const w = width === void 0 ? "" : ` stroke-width="${width}"`;
  return `<line${c}${o}${w} x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(q.x)}" y2="${f(q.y)}"/>`;
}
function pts(list) {
  return list.map((p) => `${f(p.x)},${f(p.y)}`).join(" ");
}
function f(n) {
  return Math.round(n * 10) / 10;
}
function fnv2(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function hash01(seed, ...parts) {
  let h = seed >>> 0;
  for (const part of parts) {
    h ^= Math.imul((part | 0) + 2654435769, 2246822507) >>> 0;
    h = Math.imul(h ^ h >>> 13, 3266489909) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2146121005) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2221713035) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ../../../smoreg_works/games/salvor/src/ui/web/hex-svg.ts
var R = 46;
var INRADIUS = Math.sqrt(3) / 2 * R;
var STEP = INRADIUS * 2 * HEX_SPACING;
var PAD = { x: 26, top: 46, bottom: 34 };
var TAG_H2 = 16;
var TAG_CHAR_W2 = 7;
var UNKNOWN2 = "\xB7\xB7\xB7\xB7";
var TILE_SIZE2 = 12;
var TILE_STEP2 = 15;
var TILE_MAX2 = 4;
var TILE_BOTTOM = 29;
var ZONE_SIZE2 = 14;
var ZONE_TOP = -30;
function hexSvgOf(input, layout, banner = "", art, tiles = false) {
  const at = /* @__PURE__ */ new Map();
  const cells = [];
  for (const room of input.rooms) {
    const cell2 = layout.cells.get(room.id);
    if (cell2) {
      at.set(room.id, centre(cell2));
      cells.push(cell2);
    }
  }
  if (at.size === 0) return "";
  const hull3 = art === void 0 ? void 0 : hullLayer({
    cells,
    airlock: input.tug === void 0 ? void 0 : layout.cells.get(input.tug.at),
    at: centre,
    R,
    spacing: HEX_SPACING,
    art,
    form: layout.masked ? art.form : void 0
  });
  const box3 = extent2([...at.values()], hull3?.box);
  const corridors = input.doors.filter((d) => layout.corridors.has(d.id));
  const links = input.doors.filter((d) => layout.links.has(d.id) && d.a !== d.b);
  const named2 = new Map(input.rooms.map((room) => [room.id, room.label]));
  const body = [
    hull3?.svg ?? "",
    ...links.map((door) => duct(door, at)),
    ...corridors.map((door) => corridor(door, at)),
    ...input.rooms.map((room) => hex(room, at.get(room.id), tiles)),
    ...corridors.map((door) => tag3(door, at)),
    ...stacked(links, at, named2),
    banner.length > 0 ? text2(box3.x + 14, box3.y + 26, banner, "banner") : "",
    input.shipLine.length > 0 ? text2(box3.x + 14, box3.y + box3.h - 12, input.shipLine, "ship-line") : ""
  ].filter((s) => s.length > 0).join("");
  return [
    `<svg class="schematic hexmap${tiles ? " has-tiles" : ""}" viewBox="${box3.x} ${box3.y} ${box3.w} ${box3.h}" preserveAspectRatio="xMidYMid meet" role="img">`,
    tileDefs(body),
    body,
    "</svg>"
  ].filter((s) => s.length > 0).join("");
}
function hexCentre(cell2) {
  return { x: STEP * (cell2.q + cell2.r / 2), y: R * 1.5 * HEX_SPACING * cell2.r };
}
var centre = hexCentre;
function extent2(points, hull3) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let x = Math.min(...xs) - INRADIUS - PAD.x;
  let y = Math.min(...ys) - R - PAD.top;
  let right = Math.max(...xs) + INRADIUS + PAD.x;
  let bottom = Math.max(...ys) + R + PAD.bottom;
  if (hull3) {
    x = Math.min(x, hull3.minX - HULL_PAD.x);
    y = Math.min(y, hull3.minY - HULL_PAD.top);
    right = Math.max(right, hull3.maxX + HULL_PAD.x);
    bottom = Math.max(bottom, hull3.maxY + HULL_PAD.bottom);
  }
  return { x: round2(x), y: round2(y), w: round2(right - x), h: round2(bottom - y) };
}
var HULL_PAD = { x: 8, top: 28, bottom: 18 };
function corners(c) {
  const half = INRADIUS;
  return [
    { x: c.x, y: c.y - R },
    { x: c.x + half, y: c.y - R / 2 },
    { x: c.x + half, y: c.y + R / 2 },
    { x: c.x, y: c.y + R },
    { x: c.x - half, y: c.y + R / 2 },
    { x: c.x - half, y: c.y - R / 2 }
  ];
}
function hex(room, c, tiles) {
  if (c === void 0) return "";
  const unknown = room.state === "unknown";
  const points = corners(c).map((p) => `${round2(p.x)},${round2(p.y)}`).join(" ");
  const body = [
    room.state === "current" ? `<polygon class="room-halo" points="${points}"/>` : "",
    `<polygon class="room-box" points="${points}"/>`,
    // What the compartment is for, over its name. Never on an unknown one:
    // that is precisely the fact the drone has not found out, and a reactor
    // drawn on a dashed cell would say otherwise.
    tiles && !unknown ? zoneTile(room, c.x - ZONE_SIZE2 / 2, c.y + ZONE_TOP, ZONE_SIZE2) : "",
    text2(c.x, c.y - 4, unknown ? UNKNOWN2 : room.name, "room-name", "middle"),
    text2(c.x, c.y + 12, room.label, "room-id", "middle")
  ];
  if (room.glyphs.length > 0) {
    body.push(tiles ? tileRowIn(room, c) : text2(c.x, c.y + 26, room.glyphs, "glyph", "middle"));
  }
  if ((room.hostiles ?? 0) > 0) body.push(threat2(c, room.hostiles ?? 0));
  const aimed = room.target === true ? " is-goal" : "";
  const hot = room.alarm === true || room.threat === true ? " is-alarmed" : "";
  return [
    `<g class="room is-${room.state}${aimed}${hot}" data-room="${room.id}">`,
    body.filter((s) => s.length > 0).join(""),
    "</g>"
  ].join("");
}
function tileRowIn(room, c) {
  const things = thingsOf2(room);
  const spec2 = { size: TILE_SIZE2, step: TILE_STEP2, max: TILE_MAX2 };
  return tileRow(things, {
    ...spec2,
    x: round2(c.x - tileRowWidth(things.length, spec2) / 2),
    y: round2(c.y + TILE_BOTTOM - TILE_SIZE2),
    baseline: round2(c.y + TILE_BOTTOM)
  });
}
function threat2(c, columns) {
  const machines = Math.ceil(columns / 2);
  const w = 20;
  return [
    `<rect class="threat-cap" x="${round2(c.x - w / 2)}" y="${round2(c.y - R - 7)}"`,
    ` width="${w}" height="14" rx="2"/>`,
    text2(c.x, c.y - R + 4, String(machines), "threat-count", "middle")
  ].join("");
}
function corridor(door, at) {
  const ends = trimmed(door, at);
  if (!ends) return "";
  const [from, to] = ends;
  return [
    `<line class="hall-wall is-${door.state}"`,
    ` x1="${round2(from.x)}" y1="${round2(from.y)}" x2="${round2(to.x)}" y2="${round2(to.y)}"/>`,
    `<line class="door-wire is-${door.state}${door.target === true ? " is-goal" : ""}"`,
    ` x1="${round2(from.x)}" y1="${round2(from.y)}" x2="${round2(to.x)}" y2="${round2(to.y)}"/>`
  ].join("");
}
function trimmed(door, at) {
  const a = at.get(door.a);
  const b = at.get(door.b);
  if (!a || !b) return void 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return void 0;
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: a.x + ux * INRADIUS, y: a.y + uy * INRADIUS },
    { x: b.x - ux * INRADIUS, y: b.y - uy * INRADIUS }
  ];
}
function tag3(door, at) {
  const ends = trimmed(door, at);
  if (!ends) return "";
  const [from, to] = ends;
  const mid2 = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const w = door.label.length * TAG_CHAR_W2 + 8;
  return [
    `<g class="door is-${door.state}${door.target === true ? " is-goal" : ""}">`,
    `<rect class="door-tag" x="${round2(mid2.x - w / 2)}" y="${round2(mid2.y - TAG_H2 / 2)}"`,
    ` width="${w}" height="${TAG_H2}" rx="2"/>`,
    text2(mid2.x, mid2.y + 4, door.label, "door-label", "middle"),
    "</g>"
  ].join("");
}
function duct(door, at) {
  const a = at.get(door.a);
  const b = at.get(door.b);
  if (!a || !b) return "";
  return [
    `<line class="duct is-${door.state}"`,
    ` x1="${round2(a.x)}" y1="${round2(a.y)}" x2="${round2(b.x)}" y2="${round2(b.y)}"/>`
  ].join("");
}
function stacked(links, at, named2) {
  const used = /* @__PURE__ */ new Map();
  const step = (room) => {
    const n = used.get(room) ?? 0;
    used.set(room, n + 1);
    return n;
  };
  return links.map((door) => {
    const a = at.get(door.a);
    const b = at.get(door.b);
    if (!a || !b) return "";
    return [
      chip(a, b, door, named2.get(door.b) ?? "", step(door.a)),
      chip(b, a, door, named2.get(door.a) ?? "", step(door.b))
    ].join("");
  });
}
function chip(from, to, door, far, rank2) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const x = from.x + dx / len * (INRADIUS - 4);
  const y = from.y + dy / len * (R - 6) + rank2 * (TAG_H2 + 3);
  const label3 = far.length > 0 ? `${door.label} \u2192 ${far}` : door.label;
  const w = label3.length * TAG_CHAR_W2 + 8;
  return [
    `<g class="door link is-${door.state}${door.target === true ? " is-goal" : ""}">`,
    `<rect class="door-tag" x="${round2(x - w / 2)}" y="${round2(y - TAG_H2 / 2)}"`,
    ` width="${w}" height="${TAG_H2}" rx="2"/>`,
    text2(x, y + 4, label3, "door-label", "middle"),
    "</g>"
  ].join("");
}
function text2(x, y, body, cls, anchor) {
  const at = anchor === void 0 ? "" : ` text-anchor="${anchor}"`;
  return `<text class="${cls}" x="${round2(x)}" y="${round2(y)}"${at}>${esc(body)}</text>`;
}
function round2(n) {
  return Math.round(n * 10) / 10;
}

// ../../../smoreg_works/games/salvor/src/ui/web/screen.ts
var LOG_LINES = 14;
function screenHtml(game, state, flash, lit = NOTHING_LIT, map = "graph", debug = false, hull3 = true, tiles = false) {
  const overlay = state.overlay;
  if (overlay === "crash") return card("bad", crashCard(state));
  if (overlay === "title") return card("title", titleCard(state));
  const actions = listOf(game, state);
  const blocks2 = panelBlocks(game, [], state.cursor);
  const foot = footBlocks(game);
  const body = blocks2.slice(HEAD_ROWS, blocks2.length - foot.length);
  return [
    headHtml(blocks2),
    `<div class="web-map">${mapHtml(game, state, lit, map, hull3, tiles)}</div>`,
    // The two marks laid over the map: what the next blow lands on, bottom
    // left, and what there is to read about, top left (G72).
    codexHtml(codexBadge(game)),
    exposeHtml(blocks2, flash, lit.ids),
    `<div class="web-panel">${htmlOf(body, foot, actions, state.cursor, flash, lit.ids)}</div>`,
    `<div class="web-log">${logHtml(game.log.tail(LOG_LINES))}</div>`,
    // The debug overlay (G68): the owner's flag, drawn under the log and
    // nowhere else — `debugHtml` already answers "" when it is off.
    debugHtml(debugBlockLines(game, debug)),
    overlayHtml(game, state)
  ].join("");
}
var HEAD_ROWS = 2;
function headHtml(blocks2) {
  const ship = blocks2[0]?.text.trim() ?? "";
  const turn = blocks2[1]?.text.trim() ?? "";
  return [
    '<div class="web-head">',
    `<span class="ship">${esc(ship)}</span>`,
    `<span class="turn">${esc(turn)}</span>`,
    "</div>"
  ].join("");
}
function mapHtml(game, state, lit, map, hull3, tiles) {
  if (isTug(game)) return `<pre class="web-board">${tugBoard(game).map(esc).join("\n")}</pre>`;
  const input = schematicInputOf(game, lit.rooms, aimedAt(game, state));
  if (map === "hex") {
    const art = hull3 ? hullArtOf(game.ship, game.shipId) : void 0;
    return hexSvgOf(input, layoutOf(game.ship, art?.mask), bannerLine(game), art, tiles);
  }
  return svgOf(input, bannerLine(game), tiles);
}
var LAYOUTS = /* @__PURE__ */ new WeakMap();
function layoutOf(ship, mask) {
  const kept = LAYOUTS.get(ship);
  if (kept !== void 0 && kept.mask === mask) return kept.layout;
  const layout = hexLayout(ship, { allowed: mask });
  LAYOUTS.set(ship, { mask, layout });
  return layout;
}
function logHtml(lines) {
  const fades = logFades(lines);
  const alarm = latestAlarm(lines);
  return lines.map((line2, i) => {
    const fade = fades[i];
    const faded = fade === "fresh" ? "" : ` ${fade}`;
    const live2 = line2.tone === "alarm" && i === alarm ? " live" : "";
    const gap = opensTurn(lines, i) ? " turn-gap" : "";
    const repeat = line2.count > 1 ? ` (x${line2.count})` : "";
    return `<div class="${line2.tone}${faded}${live2}${gap}">${esc(logText(line2) + repeat)}</div>`;
  }).join("");
}
function overlayHtml(game, state) {
  if (state.overlay === "help") return card("", helpCard(game, state.helpPage));
  if (state.overlay === "codex") return card("", codexCard(game, state));
  if (state.overlay === "history") return card("", historyCard(game, state.logPage));
  const ending = endingBanners()[state.overlay];
  if (!ending) return "";
  const tone = ending.fg === THEME.good ? "good" : "bad";
  return card(tone, [
    `<div class="h">${esc(ending.title)}</div>`,
    ...ending.why === void 0 ? [] : [`<div class="sub">${esc(ending.why)}</div>`],
    `<div class="sub">${esc(runSummary(game))}</div>`,
    `<div class="hint">${esc(endHint(state.overlay))}</div>`
  ]);
}
function titleCard(state) {
  const screen = titleScreen(state.settings, state.seedText);
  return [
    `<div class="title-name">${esc(screen.name)}</div>`,
    `<div class="title-tag">${esc(screen.tagline)}</div>`,
    `<div class="head">${esc(screen.menuHead)}</div>`,
    `<div class="title-menu">${screen.items.map((item, i) => titleItemHtml(item, i, state.cursor)).join("")}</div>`,
    ...screen.hints.map((line2) => `<div class="hint">${esc(line2)}</div>`),
    `<div class="head">${esc(screen.keysHead)}</div>`,
    ...screen.keys.map((line2) => `<div class="keys">${esc(line2)}</div>`),
    `<div class="title-foot">${esc(screen.foot)}</div>`
  ];
}
function titleItemHtml(item, index2, cursor) {
  const lit = index2 === cursor ? " is-cursor" : "";
  return [
    `<div class="title-row${lit}" data-line="${index2}">`,
    `<span class="title-key">${esc(item.key)}</span>`,
    `<span class="title-label">${esc(item.label)}</span>`,
    `<span class="title-value">${titleValueHtml(item)}</span>`,
    `</div>`
  ].join("");
}
function titleValueHtml(item) {
  if (!item.options) return esc(item.value ?? "");
  return item.options.map((o) => `<span class="${o.on ? "title-on" : "title-off"}">${esc(o.text)}</span>`).join(`<span class="title-off"> \xB7 </span>`);
}
function helpCard(game, page2) {
  const headings = helpHeadings();
  const keys = keyHelp();
  const pages = helpPages(isTug(game), codexSeen(game));
  const body = (pages[Math.min(page2, pages.length - 1)] ?? []).map((line2) => {
    const cls = headings.includes(line2) ? "head" : keys.includes(line2) ? "keys" : "prose";
    return `<div class="${cls}">${esc(line2)}</div>`;
  });
  return [
    `<div class="h">${esc(cardTitles().help)}</div>`,
    ...body,
    `<div class="prose">${esc(helpFooter(page2, pages.length))}</div>`
  ];
}
function codexCard(game, state) {
  const view = codexView(game, state);
  if (view === void 0) return [];
  const body = codexBody(view.entry, view.fitted).map(
    (line2) => line2.length === 0 ? '<div class="prose">&nbsp;</div>' : `<div class="prose">${esc(line2)}</div>`
  );
  return [
    `<div class="h">${esc(codexHeading(view.entry))}</div>`,
    ...body,
    `<div class="hint">${esc(codexFooter(view.page, view.pages))}</div>`
  ];
}
function historyCard(game, page2) {
  const pages = historyPages(game.log.lines, HISTORY_ROWS);
  const at = Math.min(page2, pages.length - 1);
  const body = (pages[at] ?? []).map((line2) => `<div class="keys">${esc(line2)}</div>`);
  return [
    `<div class="h">${esc(cardTitles().history)}</div>`,
    ...body,
    `<div class="prose">${esc(historyFooter(at, pages.length))}</div>`
  ];
}
function crashCard(state) {
  const body = (state.crash ?? []).map((line2) => `<div class="prose">${esc(line2)}</div>`);
  return [`<div class="h">${esc(cardTitles().crash)}</div>`, ...body, hint2()];
}
function hint2() {
  return `<div class="hint">${esc(restartHint())}</div>`;
}
function card(tone, body) {
  const cls = tone.length > 0 ? `card ${tone}` : "card";
  return `<div class="web-over"><div class="${cls}">${body.join("")}</div></div>`;
}

// render.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";
var here2 = dirname(fileURLToPath(import.meta.url));
var out = join2(here2, "pages");
function walk2(game, state, steps) {
  for (let step = 0; step < steps; step++) {
    const offered = listOf(game, state).filter(function usable(action) {
      return action.enabled;
    });
    const casting = offered.find(function leaving(action) {
      return /cast off/i.test(action.label);
    });
    const going = offered.find(function open(action) {
      return action.cmd.kind === "go";
    });
    const next = going ?? casting;
    game.playerCommand(next === void 0 ? { kind: "wait" } : next.cmd);
  }
}
var SEED = "artboard-1";
var BOARDS = [
  {
    file: "01-title",
    group: "Screens",
    title: "Title",
    note: "Seven keyed rows, every one clickable. The whole start of the game.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "title" }),
    steps: 0
  },
  {
    file: "02-tug",
    group: "Screens",
    title: "The tug",
    note: "The hub between runs. Rack left, actions right, no map at all.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "none" }),
    steps: 0
  },
  {
    file: "03-derelict-graph",
    group: "Screens",
    title: "Aboard \u2014 graph map",
    note: "The default view. Map left, panel right, log along the bottom.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "none" }),
    steps: 14
  },
  {
    file: "04-derelict-hex",
    group: "Screens",
    title: "Aboard \u2014 honeycomb",
    note: "The same screen with the hex map and the drawn hull under it.",
    map: "hex",
    state: (base) => ({ ...base, overlay: "none" }),
    steps: 14
  },
  {
    file: "05-help",
    group: "Cards",
    title: "Help card",
    note: "A text card over the screen. Sized by column arithmetic today.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "help" }),
    steps: 14
  },
  {
    file: "06-codex",
    group: "Cards",
    title: "Codex",
    note: "The reference card. Left list, right body.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "codex" }),
    steps: 14
  },
  {
    file: "07-history",
    group: "Cards",
    title: "Log history",
    note: "The log opened full. Compare with the kit's expanding drawer.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "history" }),
    steps: 14
  },
  {
    file: "08-lost",
    group: "Cards",
    title: "Ending \u2014 lost",
    note: "An ending banner and a run summary.",
    map: "graph",
    state: (base) => ({ ...base, overlay: "lost" }),
    steps: 14
  }
];
function page(board, body) {
  return [
    /* The pane reads its card index off the first line of each page. It sits
       ahead of the doctype by the tool's contract, so the page is served in
       quirks mode; everything below sets its own box model and lays out with
       grid, and the screenshots are identical either way. */
    `<!-- @dsCard group="${board.group}" -->`,
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>SALVOR \u2014 ${board.title}</title>`,
    `<style>${WEB_CSS}</style>`,
    "<style>html,body{margin:0;background:#05080d;}</style>",
    "</head><body>",
    `<div class="${WEB_ROOT_CLASS}">${body}</div>`,
    "</body></html>"
  ].join("\n");
}
mkdirSync(out, { recursive: true });
var index = [];
for (const board of BOARDS) {
  const game = newGame(SEED, false);
  const base = initialState({ view: "web", sound: false, seed: game.seed });
  walk2(game, { ...base, overlay: "none" }, board.steps);
  const state = board.state(base);
  const body = screenHtml(game, state, NO_FLASH.slots, NOTHING_LIT, board.map, false, true, false);
  writeFileSync(join2(out, `${board.file}.html`), page(board, body), "utf8");
  index.push(`${board.file}.html \u2014 ${board.title}: ${board.note}`);
  console.log(`wrote ${board.file}.html  (${String(body.length)} bytes of markup)`);
}
writeFileSync(join2(out, "INDEX.txt"), `${index.join("\n")}
`, "utf8");
