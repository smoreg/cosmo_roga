/* rules.js -- the boarding prototype's rules and state. Touches no DOM.
   A classic script, not a module, because the page must work from file://
   where module loading and fetch are equally refused.

   Everything here is deliberately small. Terrain defence, armour, damage
   types, traits, time of day and the hack/take verb are all left out on
   purpose: this page exists to show movement, zone of control, doors and
   the Wesnoth attack exchange working on a real exported map. */

'use strict';

const HEX_DIRS = [
  {q:1,r:0}, {q:1,r:-1}, {q:0,r:1}, {q:0,r:-1}, {q:-1,r:1}, {q:-1,r:0},
];
const hexKey = c => c.q + "," + c.r;
const edgeKey = (a, b) => {
  const x = hexKey(a), y = hexKey(b);
  return x < y ? x + "|" + y : y + "|" + x;
};
const hexDist = (a, b) => {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
};

function hexGeom(ft){
  const R = ft / Math.sqrt(3);
  return {
    R, ft,
    centre: c => ({x: ft * (c.q + c.r/2), y: 1.5 * R * c.r}),
    corners: c => {
      const {x, y} = hexGeom(ft).centre(c);
      const pts = [];
      for (let i = 0; i < 6; i++){
        const a = Math.PI / 180 * (60 * i - 30);
        pts.push([x + R * Math.cos(a), y + R * Math.sin(a)]);
      }
      return pts;
    },
  };
}

/* ---------- seeded randomness ----------
   A seed is the thing you send someone, so every roll comes from one. */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seedFrom(str){
  let h = 2166136261;
  for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- the roster ----------
   damage-strikes, exactly as written in the brief. A weapon's class is what
   decides whether the defender may answer: melee answers melee, ranged
   answers ranged, and a unit with no weapon of the attacker's class does not
   strike back at all. That is Wesnoth's rule and it is the whole reason the
   emitter is worth a slot. */
const MELEE = "melee", RANGED = "ranged";
const ROSTER = {
  drone:    {name:"Drone",    side:"drone", hp:12, mp:4,
             weapons:[{name:"welder",  cls:MELEE,  dmg:3, strikes:1},
                      {name:"emitter", cls:RANGED, dmg:2, strikes:2}]},
  scout:    {name:"Scout",    side:"ship", hp:4,  mp:4, cost:6,
             weapons:[{name:"claw",    cls:MELEE,  dmg:1, strikes:2}]},
  sentinel: {name:"Sentinel", side:"ship", hp:8,  mp:4, cost:11,
             weapons:[{name:"ram",     cls:MELEE,  dmg:3, strikes:2},
                      {name:"arc",     cls:RANGED, dmg:1, strikes:2}]},
  hunter:   {name:"Hunter",   side:"ship", hp:8,  mp:4, cost:15,
             weapons:[{name:"blade",   cls:MELEE,  dmg:2, strikes:2},
                      {name:"lance",   cls:RANGED, dmg:3, strikes:3}]},
};
const SHIP_TYPES = ["scout", "sentinel", "hunter"];

/* Authored here, not in the brief -- flagged in the README as ours to argue
   with. A spawner takes both drones two or three turns of full attention;
   a node takes one. */
const SPAWNER_HP = 12;
const NODE_HP = 6;
const HIT_CHANCE = 0.75;
const NODE_MIN_HEXES = 4;      // "more than 3 hexes"
const INCOME_PER_NODE = 1;

/* ---------- building a mission from an exported map ---------- */

function buildMission(doc, opts){
  opts = opts || {};
  const rng = mulberry32(seedFrom(String(opts.seed == null ? doc.seed : opts.seed)));
  const hexFt = doc.hex.feetAcross;
  const income    = opts.income    == null ? INCOME_PER_NODE : opts.income;
  const spawnerHp = opts.spawnerHp == null ? SPAWNER_HP      : opts.spawnerHp;
  const nodeHp    = opts.nodeHp    == null ? NODE_HP         : opts.nodeHp;

  const cells = new Map();
  for (const h of doc.hexes) cells.set(hexKey(h), {q:h.q, r:h.r, zone:h.zone, over:h.over || [h.zone]});

  const zones = new Map();
  for (const z of doc.zones) zones.set(z.id, z);

  /* A door lies on the lattice edge two hexes share, so it is a property of
     a move rather than an object standing in a hex. */
  const doors = doc.doors
    .filter(d => d.from && d.to)
    .map(d => ({id:d.id, a:d.a, b:d.b, state:d.state, loop:d.loop,
                from:{q:d.from[0], r:d.from[1]}, to:{q:d.to[0], r:d.to[1]}}));
  const doorByEdge = new Map();
  for (const d of doors) doorByEdge.set(edgeKey(d.from, d.to), d);

  /* Which zones can be walked to from the boarding point. Sealed rooms and
     rooms behind no door at all are unreachable, and the mission must know
     it -- the generator refuses to fabricate a door and so do we. */
  const entry = doc.zones.find(z => z.entry) || doc.zones[0];
  const zoneAdj = new Map();
  for (const d of doors){
    if (!zoneAdj.has(d.a)) zoneAdj.set(d.a, new Set());
    if (!zoneAdj.has(d.b)) zoneAdj.set(d.b, new Set());
    zoneAdj.get(d.a).add(d.b); zoneAdj.get(d.b).add(d.a);
  }
  const reachable = new Set([entry.id]);
  const stack = [entry.id];
  while (stack.length){
    const z = stack.pop();
    for (const n of (zoneAdj.get(z) || [])) if (!reachable.has(n)){ reachable.add(n); stack.push(n); }
  }

  const hexesOf = id => [...cells.values()].filter(c => c.zone === id);

  /* Candidates for a spawner or a node, nearest the middle of their own room
     first, so machinery is never tucked into a doorway by accident. */
  function byCentrality(list, taken){
    return list
      .filter(c => !taken || !taken.has(hexKey(c)))
      .map(c => ({c, s: list.reduce((a, o) => a + hexDist(c, o), 0)}))
      .sort((a, b) => a.s - b.s || (hexKey(a.c) < hexKey(b.c) ? -1 : 1))
      .map(x => x.c);
  }

  /* A spawner or a node fills its hex, so placing one on the single hex that
     links two parts of the deck would wall the ship off silently. The
     generator next door refuses to fabricate a door; this refuses to remove
     one. Reject any candidate that would disconnect what is walkable. */
  const playable = [...cells.values()].filter(c => reachable.has(c.zone));
  function passable(a, b){
    const ca = cells.get(hexKey(a)), cb = cells.get(hexKey(b));
    if (!ca || !cb) return false;
    if (ca.zone === cb.zone) return true;
    return !!doorByEdge.get(edgeKey(a, b));      // a shut door can still be forced
  }
  function disconnects(blocked, candidate){
    const out = new Set([...blocked, hexKey(candidate)]);
    const free = playable.filter(c => !out.has(hexKey(c)));
    if (!free.length) return false;
    const seen = new Set([hexKey(free[0])]);
    const st = [free[0]];
    while (st.length){
      const c = st.pop();
      for (const d of HEX_DIRS){
        const n = {q:c.q + d.q, r:c.r + d.r}, k = hexKey(n);
        if (seen.has(k) || out.has(k)) continue;
        const cell = cells.get(k);
        if (!cell || !reachable.has(cell.zone)) continue;
        if (!passable(c, n)) continue;
        seen.add(k); st.push(n);
      }
    }
    return seen.size !== free.length;
  }
  function place(list, blocked, taken){
    for (const c of byCentrality(list, taken))
      if (!disconnects(blocked, c)) return c;
    return null;
  }

  const objects = [];
  const taken = new Set();     // hexes something already sits on
  const blocked = new Set();   // hexes machinery permanently fills
  let nextObj = 0;
  let nudged = 0;              // placements moved off a chokepoint

  /* Spawn zones: one hex in the bridge, one hex per weapons bay. */
  const spawnZones = doc.zones.filter(z =>
    reachable.has(z.id) && hexesOf(z.id).length &&
    (z.kind === "command" && /bridge/i.test(z.name) || /weapons bay/i.test(z.name)));
  for (const z of spawnZones){
    const list = hexesOf(z.id);
    const c = place(list, blocked, taken);
    if (!c) continue;
    if (byCentrality(list, taken)[0] !== c) nudged++;
    taken.add(hexKey(c)); blocked.add(hexKey(c));
    objects.push({id:nextObj++, kind:"spawner", zone:z.id, q:c.q, r:c.r,
                  hp:spawnerHp, maxHp:spawnerHp, name:z.name + " spawner"});
  }

  /* Resource nodes: one per room of more than three hexes, skipping rooms no
     drone can ever reach. The start room keeps its node. */
  const nodeZones = doc.zones.filter(z =>
    reachable.has(z.id) && hexesOf(z.id).length >= NODE_MIN_HEXES);
  for (const z of nodeZones){
    const list = hexesOf(z.id);
    const c = place(list, blocked, taken);
    if (!c) continue;
    if (byCentrality(list, taken)[0] !== c) nudged++;
    taken.add(hexKey(c)); blocked.add(hexKey(c));
    objects.push({id:nextObj++, kind:"node", zone:z.id, q:c.q, r:c.r,
                  hp:nodeHp, maxHp:nodeHp, name:z.name + " node"});
  }

  /* Two drones, in the boarding compartment. */
  const units = [];
  const startHexes = hexesOf(entry.id).filter(c => !taken.has(hexKey(c)));
  const seat = byCentrality(startHexes, null)[0];
  const order = startHexes.slice().sort((a, b) => hexDist(a, seat) - hexDist(b, seat) ||
                                                  (hexKey(a) < hexKey(b) ? -1 : 1));
  for (let i = 0; i < 2 && i < order.length; i++){
    units.push(makeUnit("drone", order[i], i, "Drone " + (i + 1)));
    taken.add(hexKey(order[i]));
  }

  const M = {
    doc, hexFt, geom: hexGeom(hexFt), rng,
    seed: String(opts.seed == null ? doc.seed : opts.seed),
    cells, zones, doors, doorByEdge, reachable, income,
    entryZone: entry.id, entryHex: seat,
    units, objects, nextUnitId: units.length, nextObjId: nextObj,
    pool: 0, turn: 1, side: "drone", over: null, log: [],
  };
  say(M, "map", doc.ship.name + " — " + hexFt + " ft hexes, seed " + M.seed);
  say(M, "map", cells.size + " hexes, " + doc.zones.filter(z => hexesOf(z.id).length).length +
       " rooms, " + doors.length + " doors. " +
       doc.zones.filter(z => hexesOf(z.id).length && !reachable.has(z.id)).length +
       " room(s) unreachable and left without a node.");
  say(M, "map", objects.filter(o => o.kind === "spawner").length + " spawn zones, " +
       objects.filter(o => o.kind === "node").length + " resource nodes (+" +
       objects.filter(o => o.kind === "node").length * income + "/turn)." +
       (nudged ? " " + nudged + " placement(s) moved off a chokepoint." : ""));
  say(M, "turn", "Turn 1 — drones.");
  return M;
}

function makeUnit(type, at, id, name){
  const t = ROSTER[type];
  return {id, type, side:t.side, name: name || t.name, hp:t.hp, maxHp:t.hp,
          mp:t.mp, maxMp:t.mp, q:at.q, r:at.r, acted:false,
          weapons:t.weapons.map(w => Object.assign({}, w))};
}

/* ---------- lookups ---------- */
const unitAt = (M, c) => M.units.find(u => u.q === c.q && u.r === c.r && u.hp > 0);
const objectAt = (M, c) => M.objects.find(o => o.q === c.q && o.r === c.r && o.hp > 0);
const cellAt = (M, c) => M.cells.get(hexKey(c));
const drones = M => M.units.filter(u => u.side === "drone" && u.hp > 0);
const hostiles = M => M.units.filter(u => u.side === "ship" && u.hp > 0);
const liveNodes = M => M.objects.filter(o => o.kind === "node" && o.hp > 0);
const liveSpawners = M => M.objects.filter(o => o.kind === "spawner" && o.hp > 0);

/* ---------- the edge test ----------
   Two hexes in the same room are always joined. Two hexes in different rooms
   are joined only where the artwork put a door: everything else is a
   bulkhead. This is the single rule that turns the deck into a graph of
   chokepoints rather than an open field. */
function edgeInfo(M, from, to){
  const a = cellAt(M, from), b = cellAt(M, to);
  if (!a || !b) return {ok:false, why:"outside the map"};
  if (hexDist(from, to) !== 1) return {ok:false, why:"not adjacent"};
  if (a.zone === b.zone) return {ok:true, door:null};
  const door = M.doorByEdge.get(edgeKey(from, to));
  if (!door) return {ok:false, why:"bulkhead", door:null};
  if (door.state === "closed") return {ok:true, door, opens:true};
  return {ok:true, door};
}

/* Zone of control projects through a passable edge only: nothing pins you
   through a wall. Ending a move in an enemy's ZOC stops you there. */
function inEnemyZOC(M, side, c){
  for (const d of HEX_DIRS){
    const n = {q:c.q + d.q, r:c.r + d.r};
    const u = unitAt(M, n);
    if (!u || u.side === side) continue;
    if (edgeInfo(M, c, n).ok) return u;
  }
  return null;
}

/* What one step costs, and why it might be refused.

   Movement and the attack are gated separately, as in Wesnoth: a unit may
   attack so long as it has not already acted, whatever is left of its
   movement. Spending the last point walking up to something must not be the
   thing that stops you hitting it. */
function stepCheck(M, unit, to){
  if (unit.hp <= 0) return {kind:"none", why:"destroyed"};
  const e = edgeInfo(M, unit, to);
  const target = unitAt(M, to), obj = objectAt(M, to);
  if (!e.ok && e.why === "bulkhead")
    return {kind:"blocked", why:"bulkhead — no door on this edge"};
  if (!e.ok) return {kind:"blocked", why:e.why};

  const shut = !!(e.door && e.door.state === "closed");
  if (target){
    if (target.side === unit.side) return {kind:"blocked", why:"occupied by " + target.name};
    if (unit.acted) return {kind:"blocked", why:"already attacked this turn"};
    return {kind:"attack", target, door:e.door, blocked:shut,
            why: shut ? "the door is shut" : null};
  }
  if (obj){
    if (unit.side !== "drone") return {kind:"blocked", why:"occupied by " + obj.name};
    if (unit.acted) return {kind:"blocked", why:"already attacked this turn"};
    return {kind:"attack", object:obj, door:e.door, blocked:shut,
            why: shut ? "the door is shut" : null};
  }

  /* Everything below is movement, and only movement needs the points. */
  if (unit.mp <= 0) return {kind:"blocked", why:"no movement left"};
  if (e.opens) return {kind:"move", opens:e.door, cost:unit.mp,
                       why:"opening the door ends the move"};
  const zoc = inEnemyZOC(M, unit.side, to);
  return {kind:"move", cost:1, stops:!!zoc,
          why: zoc ? "stopped by " + zoc.name + "'s zone of control" : null};
}

function stepMove(M, unit, to){
  const c = stepCheck(M, unit, to);
  if (c.kind !== "move") return c;
  const fromZone = cellAt(M, unit).zone, toZone = cellAt(M, to).zone;
  unit.q = to.q; unit.r = to.r;
  if (c.opens){
    c.opens.state = "open";
    unit.mp = 0;
    say(M, "door", unit.name + " forces door d" + c.opens.id + " open into " +
        M.zones.get(toZone).name + " — that is the whole move.");
  } else {
    unit.mp -= 1;
    if (fromZone !== toZone)
      say(M, "move", unit.name + " crosses into " + M.zones.get(toZone).name + ".");
    if (c.stops){
      unit.mp = 0;
      say(M, "zoc", unit.name + " is halted by " + inEnemyZOC(M, unit.side, unit).name +
          "'s zone of control.");
    }
  }
  return c;
}

/* ---------- the exchange ----------
   Attacker strikes, defender answers, alternating until both have spent
   their strikes or one is destroyed. The defender answers only with a weapon
   of the attacker's class. Every strike is an independent 75%. */
function attack(M, attacker, weaponIdx, target){
  const w = attacker.weapons[weaponIdx];
  const isObject = !target.weapons;
  const counter = isObject ? null : target.weapons.find(x => x.cls === w.cls);

  attacker.acted = true; attacker.mp = 0;
  const lines = [];
  say(M, "fight", attacker.name + " attacks " + target.name + " with " + w.name +
      " (" + w.dmg + "-" + w.strikes + ", " + w.cls + "). " +
      (isObject ? "It cannot answer." :
       counter ? target.name + " answers with " + counter.name + " (" + counter.dmg +
                 "-" + counter.strikes + ")." :
                 target.name + " has no " + w.cls + " weapon and cannot answer."));

  let ai = 0, di = 0;
  while (ai < w.strikes || (counter && di < counter.strikes)){
    if (ai < w.strikes){
      ai++;
      if (M.rng() < HIT_CHANCE){
        target.hp -= w.dmg;
        lines.push(attacker.name + " hits for " + w.dmg + " (" + Math.max(0, target.hp) + " left)");
      } else lines.push(attacker.name + " misses");
      if (target.hp <= 0) break;
    }
    if (counter && di < counter.strikes){
      di++;
      if (M.rng() < HIT_CHANCE){
        attacker.hp -= counter.dmg;
        lines.push(target.name + " hits back for " + counter.dmg + " (" + Math.max(0, attacker.hp) + " left)");
      } else lines.push(target.name + " misses");
      if (attacker.hp <= 0) break;
    }
  }
  for (const l of lines) say(M, "strike", "  " + l);

  if (target.hp <= 0) destroyed(M, target);
  if (attacker.hp <= 0) destroyed(M, attacker);
  checkOver(M);
  return lines;
}

function destroyed(M, thing){
  thing.hp = 0;
  if (thing.kind === "spawner"){
    say(M, "kill", thing.name + " destroyed. " + liveSpawners(M).length + " spawn zone(s) left.");
  } else if (thing.kind === "node"){
    say(M, "kill", thing.name + " cut. Income is now +" + liveNodes(M).length * M.income + "/turn.");
  } else {
    say(M, "kill", thing.name + " destroyed.");
  }
}

/* ---------- the ship's turn ---------- */
function shipTurn(M){
  const income = liveNodes(M).length * M.income;
  M.pool += income;
  const num = x => (Math.round(x * 100) / 100).toString();
  say(M, "econ", "Nodes pay " + num(income) + ". Pool " + num(M.pool) + ".");
  for (const u of hostiles(M)) { u.mp = u.maxMp; u.acted = false; }
  spawnWave(M);                    // anything built now arrives spent, and acts next turn
  for (const u of hostiles(M)){
    if (u.hp <= 0) continue;
    aiAct(M, u);
    if (M.over) return;
  }
}

function spawnWave(M){
  /* No per-turn cap: the ship spends everything it can afford, so long as
     there is room beside a spawner to put the thing. */
  for (let guard = 0; guard < 24; guard++){
    const affordable = SHIP_TYPES.filter(t => ROSTER[t].cost <= M.pool);
    if (!affordable.length) break;
    const type = affordable[Math.floor(M.rng() * affordable.length)];
    const spawners = liveSpawners(M);
    if (!spawners.length) break;
    const openings = [];
    for (const s of spawners){
      for (const d of HEX_DIRS){
        const n = {q:s.q + d.q, r:s.r + d.r};
        if (!cellAt(M, n) || unitAt(M, n) || objectAt(M, n)) continue;
        if (!edgeInfo(M, s, n).ok) continue;
        openings.push({s, n});
      }
    }
    if (!openings.length){ say(M, "econ", "No room beside a spawn zone; the ship holds " + M.pool + "."); break; }
    const spot = openings[Math.floor(M.rng() * openings.length)];
    M.pool -= ROSTER[type].cost;
    const u = makeUnit(type, spot.n, M.nextUnitId++, ROSTER[type].name + " " + M.nextUnitId);
    u.mp = 0; u.acted = true;               // arrives, acts next turn
    M.units.push(u);
    say(M, "spawn", spot.s.name + " builds a " + ROSTER[type].name + " (" +
        ROSTER[type].cost + "). Pool " + (Math.round(M.pool * 100) / 100) + ".");
  }
}

function aiAct(M, u){
  const targets = drones(M);
  if (!targets.length) return;
  /* Attack if something is already in reach. */
  if (tryAttack(M, u)) return;
  /* Otherwise walk the passable graph toward the nearest drone. */
  const path = pathToward(M, u, targets);
  for (const step of path){
    if (u.mp <= 0) break;
    const c = stepCheck(M, u, step);
    if (c.kind !== "move") break;
    stepMove(M, u, step);
    if (tryAttack(M, u)) return;
    if (u.mp <= 0) break;
  }
  tryAttack(M, u);
}

function tryAttack(M, u){
  if (u.acted || u.hp <= 0) return false;
  let best = null;
  for (const d of HEX_DIRS){
    const n = {q:u.q + d.q, r:u.r + d.r};
    const t = unitAt(M, n);
    if (!t || t.side === u.side) continue;
    if (!edgeInfo(M, u, n).ok) continue;
    const e = edgeInfo(M, u, n);
    if (e.door && e.door.state === "closed") continue;
    u.weapons.forEach((w, i) => {
      const answer = t.weapons.find(x => x.cls === w.cls);
      const mine = w.dmg * w.strikes * HIT_CHANCE;
      const theirs = answer ? answer.dmg * answer.strikes * HIT_CHANCE : 0;
      const score = mine - theirs;
      if (!best || score > best.score) best = {score, i, t};
    });
  }
  if (!best) return false;
  attack(M, u, best.i, best.t);
  return true;
}

function pathToward(M, u, targets){
  const start = hexKey(u);
  const prev = new Map([[start, null]]);
  const q = [{q:u.q, r:u.r}];
  let found = null;
  while (q.length){
    const c = q.shift();
    for (const d of HEX_DIRS){
      const n = {q:c.q + d.q, r:c.r + d.r};
      const k = hexKey(n);
      if (prev.has(k) || !cellAt(M, n)) continue;
      const e = edgeInfo(M, c, n);
      if (!e.ok) continue;
      const t = unitAt(M, n);
      if (t && t.side !== u.side){ prev.set(k, c); found = c; q.length = 0; break; }
      if (t || objectAt(M, n)) continue;
      if (e.door && e.door.state === "closed") continue;   // the ship does not force doors
      prev.set(k, c); q.push(n);
    }
    if (found) break;
  }
  if (!found) return [];
  const path = [];
  let cur = found;
  while (cur && hexKey(cur) !== start){ path.unshift(cur); cur = prev.get(hexKey(cur)); }
  return path;
}

/* ---------- turn flow ---------- */
function endTurn(M){
  if (M.over) return;
  shipTurn(M);
  if (M.over) return;
  M.turn++;
  M.side = "drone";
  for (const u of drones(M)){ u.mp = u.maxMp; u.acted = false; }
  say(M, "turn", "Turn " + M.turn + " — drones.");
  checkOver(M);
}

function checkOver(M){
  if (M.over) return;
  if (!liveSpawners(M).length){
    M.over = "win";
    say(M, "over", "Every spawn zone is destroyed. The ship has nothing left to build with.");
  } else if (!drones(M).length){
    M.over = "loss";
    say(M, "over", "Both drones are gone. Nothing is coming back to the tug.");
  }
}

function say(M, kind, text){
  M.log.push({turn:M.turn, kind, text});
}

/* Expected damage either way, so the player can see the bet before taking it. */
function forecast(attacker, weaponIdx, target){
  const w = attacker.weapons[weaponIdx];
  const counter = target.weapons ? target.weapons.find(x => x.cls === w.cls) : null;
  return {
    weapon: w,
    counter,
    dealt: w.dmg * w.strikes * HIT_CHANCE,
    taken: counter ? counter.dmg * counter.strikes * HIT_CHANCE : 0,
    kill: w.dmg * w.strikes >= target.hp,
  };
}

const Rules = {
  HEX_DIRS, hexKey, edgeKey, hexDist, hexGeom, buildMission, ROSTER, SHIP_TYPES,
  HIT_CHANCE, SPAWNER_HP, NODE_HP, INCOME_PER_NODE, NODE_MIN_HEXES,
  unitAt, objectAt, cellAt, drones, hostiles, liveNodes, liveSpawners,
  edgeInfo, inEnemyZOC, stepCheck, stepMove, attack, endTurn, forecast,
};
