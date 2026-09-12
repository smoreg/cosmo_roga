/**
 * The ship's own turn: it is paid, it builds, then what it has built moves.
 *
 * The pool is fed by resource nodes and by nothing else. It never sees what
 * the drones are carrying — RimWorld ties raid strength to colony wealth and
 * the documented result is players refusing to accumulate wealth. In a game
 * whose whole objective is picking things up, that would be fatal.
 */

import { answeringWeapon } from "./combat";
import { cellAt } from "./deck";
import { buildBlocked, hostileBuilt, incomePaid, turnBegan } from "./events";
import type { GameEvent } from "./events";
import { hexKey, hexNeighbours } from "./hex";
import type { Axial } from "./hex";
import { attackFrom, checkOutcome, moveUnitTo } from "./actions";
import type { Applied } from "./actions";
import { intentFor } from "./intent";
import { makeUnit } from "./mission";
import { nextInt } from "./rng";
import { HIT_CHANCE, SHIP_UNIT_TYPES, profileOf } from "./roster";
import { drones, hostiles, isOccupied, liveNodes, liveSpawners, unitById } from "./topology";
import type { DeckMap, GameState, MapObject, Unit, UnitType } from "./types";

interface Opening {
  readonly spawner: MapObject;
  readonly at: Axial;
}

function openingsBeside(deck: DeckMap, state: GameState, spawner: MapObject): Opening[] {
  const out: Opening[] = [];
  for (const neighbour of hexNeighbours(spawner.at)) {
    if (cellAt(deck, neighbour) === null) continue;
    if (isOccupied(state, neighbour)) continue;
    const probe: Unit = { ...makeUnit("scout", -1, spawner.at, deck.feetAcross), movement: 1 };
    const intent = intentFor(deck, state, probe, neighbour);
    if (intent.kind !== "move" || intent.forcesDoor !== null) continue;
    out.push({ spawner, at: neighbour });
  }
  return out;
}

function affordableTypes(pool: number): UnitType[] {
  const out: UnitType[] = [];
  for (const type of SHIP_UNIT_TYPES) {
    if (profileOf(type).cost <= pool) out.push(type);
  }
  return out;
}

/**
 * No per-turn cap: the ship spends everything it can afford, so long as there
 * is room beside a spawner to put the thing. What it builds arrives spent, so
 * a spawn is never an ambush out of nowhere — it acts from the next turn.
 */
export function buildWave(deck: DeckMap, state: GameState): Applied {
  const events: GameEvent[] = [];
  let current = state;

  for (let guard = 0; guard < 24; guard++) {
    const spawners = liveSpawners(current);
    if (spawners.length === 0) {
      events.push(buildBlocked(current.pool, "noSpawners"));
      break;
    }
    const affordable = affordableTypes(current.pool);
    if (affordable.length === 0) break;

    const openings: Opening[] = [];
    for (const spawner of spawners) openings.push(...openingsBeside(deck, current, spawner));
    if (openings.length === 0) {
      events.push(buildBlocked(current.pool, "noRoom"));
      break;
    }

    const [typeIndex, afterType] = nextInt(current.rng, affordable.length);
    const [spotIndex, afterSpot] = nextInt(afterType, openings.length);
    const type = affordable[typeIndex];
    const spot = openings[spotIndex];
    if (type === undefined || spot === undefined) break;

    const cost = profileOf(type).cost;
    const built: Unit = {
      ...makeUnit(
        type,
        current.nextUnitId,
        spot.at,
        deck.feetAcross,
        `${profileOf(type).label} ${current.nextUnitId}`,
      ),
      movement: 0,
      hasAttacked: true,
    };
    current = {
      ...current,
      rng: afterSpot,
      pool: current.pool - cost,
      units: [...current.units, built],
      nextUnitId: current.nextUnitId + 1,
    };
    events.push(hostileBuilt(built.id, type, spot.spawner.id, spot.at, cost, current.pool));
  }

  return { state: current, events };
}

/* ---------- what the ship does with what it has ---------- */

interface Choice {
  readonly weaponIndex: number;
  readonly target: Axial;
  readonly score: number;
}

/** Expected damage out, less expected damage back. */
function scoreAttack(attacker: Unit, weaponIndex: number, defender: Unit): number {
  const weapon = profileOf(attacker.type).weapons[weaponIndex];
  if (weapon === undefined) return Number.NEGATIVE_INFINITY;
  const answer = answeringWeapon(profileOf(defender.type).weapons, weapon);
  const dealt = weapon.damage * weapon.strikes * HIT_CHANCE;
  const taken = answer === null ? 0 : answer.damage * answer.strikes * HIT_CHANCE;
  return dealt - taken;
}

function bestAttackFrom(deck: DeckMap, state: GameState, unit: Unit): Choice | null {
  let best: Choice | null = null;
  for (const neighbour of hexNeighbours(unit.at)) {
    const intent = intentFor(deck, state, unit, neighbour);
    if (intent.kind !== "attack" || intent.targetUnit === null) continue;
    const defender = intent.targetUnit;
    const weapons = profileOf(unit.type).weapons;
    for (let index = 0; index < weapons.length; index++) {
      const score = scoreAttack(unit, index, defender);
      if (best === null || score > best.score) {
        best = { weaponIndex: index, target: neighbour, score };
      }
    }
  }
  return best;
}

/** A step-by-step route toward the nearest drone, through joinable edges only. */
function routeToward(deck: DeckMap, state: GameState, unit: Unit): Axial[] {
  const targets = drones(state);
  if (targets.length === 0) return [];

  const start = hexKey(unit.at);
  const cameFrom = new Map<string, Axial | null>([[start, null]]);
  const frontier: Axial[] = [unit.at];
  let found: Axial | null = null;

  while (frontier.length > 0 && found === null) {
    const current = frontier.shift();
    if (current === undefined) break;
    for (const neighbour of hexNeighbours(current)) {
      const key = hexKey(neighbour);
      if (cameFrom.has(key) || cellAt(deck, neighbour) === null) continue;

      const probe: Unit = { ...unit, at: current, movement: 1, hasAttacked: false };
      const intent = intentFor(deck, state, probe, neighbour);

      if (intent.kind === "attack" && intent.targetUnit !== null) {
        cameFrom.set(key, current);
        found = current;
        break;
      }
      // The ship does not force shut doors, and will not walk into machinery.
      if (intent.kind !== "move" || intent.forcesDoor !== null) continue;
      cameFrom.set(key, current);
      frontier.push(neighbour);
    }
  }
  if (found === null) return [];

  const route: Axial[] = [];
  let cursor: Axial | null = found;
  while (cursor !== null && hexKey(cursor) !== start) {
    route.unshift(cursor);
    cursor = cameFrom.get(hexKey(cursor)) ?? null;
  }
  return route;
}

export function runShipTurn(deck: DeckMap, state: GameState): Applied {
  const events: GameEvent[] = [turnBegan(state.turn, "ship")];

  const nodes = liveNodes(state).length;
  const income = nodes * state.incomePerNode;
  let current: GameState = { ...state, side: "ship", pool: state.pool + income };
  events.push(incomePaid(income, current.pool, nodes));

  const wave = buildWave(deck, current);
  current = wave.state;
  events.push(...wave.events);

  // Ready everything that was already aboard; what was just built stays spent.
  const readied = current.units.map(function readyHostile(unit: Unit): Unit {
    if (unit.side !== "ship") return unit;
    const wasJustBuilt = unit.hasAttacked && unit.movement === 0 && unit.hp === unit.maxHp;
    const isNew = wave.events.some(function builtThis(event: GameEvent): boolean {
      return event.kind === "hostileBuilt" && event.unitId === unit.id;
    });
    if (isNew && wasJustBuilt) return unit;
    return { ...unit, movement: unit.maxMovement, hasAttacked: false };
  });
  current = { ...current, units: readied };

  for (const mover of hostiles(current)) {
    if (current.outcome !== null) break;
    const acted = actFor(deck, current, mover.id);
    current = acted.state;
    events.push(...acted.events);
  }

  const settled = checkOutcome(current);
  return { state: settled.state, events: [...events, ...settled.events] };
}

function actFor(deck: DeckMap, state: GameState, unitId: number): Applied {
  const events: GameEvent[] = [];
  let current = state;

  for (let step = 0; step < 12; step++) {
    const unit = unitById(current, unitId);
    if (unit === null || unit.hp <= 0) break;

    const attack = bestAttackFrom(deck, current, unit);
    if (attack !== null && !unit.hasAttacked) {
      const done = attackFrom(deck, current, unit.id, attack.weaponIndex, attack.target);
      current = done.state;
      events.push(...done.events);
      break;
    }
    if (unit.movement <= 0) break;

    const route = routeToward(deck, current, unit);
    const next = route[0];
    if (next === undefined) break;

    const intent = intentFor(deck, current, unit, next);
    if (intent.kind === "attack") continue;
    if (intent.kind !== "move" || intent.forcesDoor !== null) break;

    const done = moveUnitTo(deck, current, unit.id, next);
    current = done.state;
    events.push(...done.events);
  }
  return { state: current, events };
}
