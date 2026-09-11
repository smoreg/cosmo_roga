import { useCallback, useMemo, useState } from "react";
import { answeringWeapon, forecast } from "../core/combat";
import type { Forecast } from "../core/combat";
import { attackWith, moveUnit } from "../core/commands";
import type { Command } from "../core/commands";
import { cellAt, deckGeometry } from "../core/deck";
import { hexAt, hexCentre, hexDistance, hexKey, hexNeighbours } from "../core/hex";
import type { Axial, Point } from "../core/hex";
import { intentFor, reachableHexes, routeTo } from "../core/intent";
import type { Intent } from "../core/intent";
import { profileOf } from "../core/roster";
import { objectAt, unitAt } from "../core/topology";
import type { DeckMap, GameState, Unit } from "../core/types";

export type ArrowKind = "move" | "attack" | "blocked";

export interface Arrow {
  readonly from: Axial;
  readonly to: Axial;
  readonly kind: ArrowKind;
}

export interface Plan {
  /** The route, step by step, and the last one red when it is an attack. */
  readonly arrows: readonly Arrow[];
  /** The last step shoulders a shut door open, which costs the whole move. */
  readonly forcesDoor: boolean;
  /** Where the drone would end up. */
  readonly stopAt: Axial | null;
  /** The hex it would attack from there, if any. */
  readonly attackAt: Axial | null;
  readonly why: string | null;
}

export interface WeaponOption {
  readonly index: number;
  readonly name: string;
  readonly damage: number;
  readonly strikes: number;
  readonly weaponClass: string;
  readonly odds: Forecast;
}

export interface PendingAttack {
  readonly at: Axial;
  readonly targetName: string;
  readonly targetHp: number;
  readonly targetMaxHp: number;
  readonly options: readonly WeaponOption[];
}

export interface MissionInput {
  readonly selected: Unit | null;
  readonly reachable: ReadonlySet<string>;
  /** Reachable only by shouldering a shut door open, which ends the move. */
  readonly forceable: ReadonlySet<string>;
  readonly plan: Plan | null;
  readonly pending: PendingAttack | null;
  readonly pick: () => void;
  readonly hover: (point: Point | null) => void;
  readonly choose: (weaponIndex: number) => void;
  readonly clear: () => void;
}

/** Why a step was refused, in words the player is owed. */
function explain(intent: Intent): string | null {
  if (intent.kind !== "refused") return null;
  switch (intent.reason) {
    case "bulkhead":
      return "A bulkhead — the artwork drew no door on this edge.";
    case "doorShut":
      return "The door is shut. Moving into it forces it open, and that is the whole move.";
    case "doorLocked":
      return "The door is locked. Cut it open — it has one hit point.";
    case "friendlyOccupied":
      return "Your own drone is standing there.";
    case "objectInTheWay":
      return "Machinery fills that hex.";
    case "alreadyAttacked":
      return "This drone has already attacked this turn.";
    case "noMovementLeft":
      return "No movement left. It can still attack.";
    case "destroyed":
      return "That drone is gone.";
    case "offMap":
    case "notAdjacent":
      return null;
  }
}

/**
 * Everything the player's hands do, kept out of the rules and out of the store.
 *
 * Selection and hover are transient and change on every mouse move, so they
 * live here rather than in a global store where they would repaint the world.
 * Nothing here decides anything: it asks `intentFor` and dispatches commands.
 */
export function useMissionInput(
  deck: DeckMap | null,
  state: GameState | null,
  dispatch: (command: Command) => void,
): MissionInput {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [pendingAt, setPendingAt] = useState<Axial | null>(null);

  const selected = useMemo(
    function findSelected(): Unit | null {
      if (state === null || selectedId === null) return null;
      for (const unit of state.units) {
        if (unit.id === selectedId && unit.hp > 0) return unit;
      }
      return null;
    },
    [state, selectedId],
  );

  const reachable = useMemo(
    function computeReach(): ReadonlySet<string> {
      if (deck === null || state === null || selected === null) return new Set<string>();
      return new Set(reachableHexes(deck, state, selected).keys());
    },
    [deck, state, selected],
  );

  /**
   * Hexes the drone can end up on that the router will not route to, because
   * getting there means forcing a shut door and that costs everything left.
   * They are offered by the plan, so they have to be shown as available or the
   * map contradicts the arrows.
   */
  const forceable = useMemo(
    function computeForceable(): ReadonlySet<string> {
      const out = new Set<string>();
      if (deck === null || state === null || selected === null) return out;

      const standings: Axial[] = [selected.at];
      for (const key of reachable) {
        const [q, r] = key.split(",").map(Number);
        if (q === undefined || r === undefined) continue;
        standings.push({ q, r });
      }

      for (const from of standings) {
        const standing = hexKey(from) === hexKey(selected.at);
        const probe: Unit = { ...selected, at: from, movement: standing ? selected.movement : 1 };
        for (const neighbour of hexNeighbours(from)) {
          if (reachable.has(hexKey(neighbour))) continue;
          const intent = intentFor(deck, state, probe, neighbour);
          if (intent.kind === "move" && intent.forcesDoor !== null) out.add(hexKey(neighbour));
        }
      }
      return out;
    },
    [deck, state, selected, reachable],
  );

  const plan = useMemo(
    function computePlan(): Plan | null {
      if (deck === null || state === null || selected === null || cursor === null) return null;
      const geometry = deckGeometry(deck);
      const under = hexAt(geometry, cursor);
      if (hexKey(under) === hexKey(selected.at)) return null;
      if (cellAt(deck, under) === null) return null;

      /* `intentFor` only answers about a neighbour, so it is asked only where
         that is the question. Everything further away is a routing problem. */
      const adjacent = hexDistance(selected.at, under) === 1;
      const standing = unitAt(state, under);
      const machinery = objectAt(state, under);

      if (standing !== null && standing.side === selected.side) {
        return {
          arrows: [],
          forcesDoor: false,
          stopAt: null,
          attackAt: null,
          why: "Your own drone is standing there.",
        };
      }

      /* Something to hit: walk up to it and swing. Which side it is approached
         from is the player's to choose, and they choose it with the pointer —
         the neighbour nearest the cursor wins, so leaning left of a sentinel
         means coming at it from the left. */
      const worthHitting = standing !== null || (machinery !== null && selected.side === "drone");
      if (worthHitting) {
        const approach = approachFrom(deck, state, selected, under, cursor, geometry);
        if (approach === null) {
          const reason = adjacent ? intentFor(deck, state, selected, under) : null;
          return {
            arrows: [],
            forcesDoor: false,
            stopAt: null,
            attackAt: null,
            why: reason === null ? "No way to reach it this turn." : explain(reason),
          };
        }
        const route =
          hexKey(approach) === hexKey(selected.at)
            ? []
            : (routeTo(deck, state, selected, approach) ?? []);
        const arrows = chain(selected.at, route, "move");
        const last = route.at(-1) ?? selected.at;
        arrows.push({ from: last, to: under, kind: "attack" });
        return {
          arrows,
          forcesDoor: false,
          stopAt: route.length === 0 ? null : last,
          attackAt: under,
          why: null,
        };
      }

      const route = routeTo(deck, state, selected, under);
      if (route !== null && route.length > 0) {
        return {
          arrows: chain(selected.at, route, "move"),
          forcesDoor: false,
          stopAt: under,
          attackAt: null,
          why: null,
        };
      }

      /* A shut door is not a wall: walking into it shoulders it open, and that
         is the whole move. It is never part of a route — it ends one — so it
         has to be offered here rather than found by the router. */
      const forcing = forceThrough(deck, state, selected, under);
      if (forcing !== null) {
        const walk =
          hexKey(forcing) === hexKey(selected.at)
            ? []
            : (routeTo(deck, state, selected, forcing) ?? []);
        const arrows = chain(selected.at, walk, "move");
        arrows.push({ from: walk.at(-1) ?? selected.at, to: under, kind: "move" });
        return {
          arrows,
          forcesDoor: true,
          stopAt: under,
          attackAt: null,
          why: "Forcing the door open is the whole move.",
        };
      }

      /* Nowhere to walk. If it is next door, the rules can say exactly why —
         a bulkhead, a shut door, a locked one worth cutting. */
      if (adjacent) {
        const intent = intentFor(deck, state, selected, under);
        if (intent.kind === "attack" && intent.targetDoor !== null) {
          return {
            arrows: [{ from: selected.at, to: under, kind: "attack" }],
            forcesDoor: false,
            stopAt: null,
            attackAt: under,
            why: null,
          };
        }
        return {
          arrows: [{ from: selected.at, to: under, kind: "blocked" }],
          forcesDoor: false,
          stopAt: null,
          attackAt: null,
          why: explain(intent),
        };
      }
      return {
        arrows: [{ from: selected.at, to: under, kind: "blocked" }],
        forcesDoor: false,
        stopAt: null,
        attackAt: null,
        why: "Too far this turn.",
      };
    },
    [deck, state, selected, cursor],
  );

  const pending = useMemo(
    function computePending(): PendingAttack | null {
      if (deck === null || state === null || selected === null || pendingAt === null) return null;
      const intent = intentFor(deck, state, selected, pendingAt);
      if (intent.kind !== "attack") return null;

      const targetUnit = intent.targetUnit;
      const targetObject = intent.targetObject;
      const targetDoor = intent.targetDoor;

      const doorName = targetDoor === null ? "" : `Door d${String(targetDoor.id)}`;
      const targetName = targetUnit?.name ?? targetObject?.name ?? doorName;
      const targetHp = targetUnit?.hp ?? targetObject?.hp ?? 1;
      const targetMaxHp = targetUnit?.maxHp ?? targetObject?.maxHp ?? 1;

      const options: WeaponOption[] = [];
      profileOf(selected.type).weapons.forEach(function offer(weapon, index) {
        const answering =
          targetUnit === null ? null : answeringWeapon(profileOf(targetUnit.type).weapons, weapon);
        options.push({
          index,
          name: weapon.name,
          damage: weapon.damage,
          strikes: weapon.strikes,
          weaponClass: weapon.weaponClass,
          odds: forecast({ weapon, answering, attackerHp: selected.hp, targetHp }),
        });
      });
      return { at: pendingAt, targetName, targetHp, targetMaxHp, options };
    },
    [deck, state, selected, pendingAt],
  );

  const clear = useCallback(function clearAll(): void {
    setSelectedId(null);
    setPendingAt(null);
    setCursor(null);
  }, []);

  const hover: (point: Point | null) => void = setCursor;

  const pick = useCallback(
    function pickHere(): void {
      if (deck === null || state === null) return;
      if (state.outcome !== null) return;

      /* A chooser is open: any click that is not an answer dismisses it. */
      if (pendingAt !== null) {
        setPendingAt(null);
        return;
      }
      if (cursor === null) return;
      const under = hexAt(deckGeometry(deck), cursor);

      const standing = unitAt(state, under);
      if (standing?.side === "drone") {
        setSelectedId(standing.id);
        return;
      }
      if (selected === null || plan === null) return;

      /* Walk the route one legal step at a time: the reducer only ever takes
         single steps, which is what keeps a move undoable and replayable. */
      let walker = selected;
      for (const arrow of plan.arrows) {
        if (arrow.kind !== "move") break;
        dispatch(moveUnit(walker.id, arrow.to));
        walker = { ...walker, at: arrow.to, movement: walker.movement - 1 };
      }
      if (plan.attackAt !== null) setPendingAt(plan.attackAt);
    },
    [deck, state, selected, plan, cursor, pendingAt, dispatch],
  );

  const choose = useCallback(
    function chooseWeapon(weaponIndex: number): void {
      if (selected === null || pendingAt === null) return;
      dispatch(attackWith(selected.id, weaponIndex, pendingAt));
      setPendingAt(null);
    },
    [selected, pendingAt, dispatch],
  );

  return { selected, reachable, forceable, plan, pending, pick, hover, choose, clear };
}

/**
 * Where to stand to shoulder a shut door open into `target`, if anywhere.
 *
 * Forcing costs whatever movement is left, so it can only ever be the last
 * step — which is why the router leaves it out and this looks for it
 * separately. Standing still is preferred, then the shortest walk.
 */
function forceThrough(deck: DeckMap, state: GameState, unit: Unit, target: Axial): Axial | null {
  const reach = reachableHexes(deck, state, unit);
  let best: { at: Axial; steps: number } | null = null;

  for (const neighbour of hexNeighbours(target)) {
    const standing = hexKey(neighbour) === hexKey(unit.at);
    if (!standing && !reach.has(hexKey(neighbour))) continue;

    const probe: Unit = { ...unit, at: neighbour, movement: standing ? unit.movement : 1 };
    const intent = intentFor(deck, state, probe, target);
    if (intent.kind !== "move" || intent.forcesDoor === null) continue;

    const steps = standing ? 0 : (routeTo(deck, state, unit, neighbour)?.length ?? Infinity);
    if (best === null || steps < best.steps) best = { at: neighbour, steps };
  }
  return best === null ? null : best.at;
}

/** One arrow per step along a route. */
function chain(start: Axial, route: readonly Axial[], kind: ArrowKind): Arrow[] {
  const arrows: Arrow[] = [];
  let from = start;
  for (const step of route) {
    arrows.push({ from, to: step, kind });
    from = step;
  }
  return arrows;
}

/**
 * Which side of a hostile to come at it from.
 *
 * Every neighbour the drone could stand on is a candidate; the one whose
 * direction from the hostile best matches the cursor's own offset wins, with a
 * shorter walk breaking a tie. Standing adjacent already counts, so hovering a
 * hostile you are next to never makes you walk around it.
 */
function approachFrom(
  deck: DeckMap,
  state: GameState,
  unit: Unit,
  target: Axial,
  cursor: Point,
  geometry: ReturnType<typeof deckGeometry>,
): Axial | null {
  const centre = hexCentre(geometry, target);
  const offsetX = cursor.x - centre.x;
  const offsetY = cursor.y - centre.y;
  const length = Math.hypot(offsetX, offsetY);
  const wantX = length === 0 ? 0 : offsetX / length;
  const wantY = length === 0 ? 0 : offsetY / length;

  const reach = reachableHexes(deck, state, unit);
  let best: { at: Axial; score: number } | null = null;

  for (const neighbour of hexNeighbours(target)) {
    const standing = hexKey(neighbour) === hexKey(unit.at);
    if (!standing && !reach.has(hexKey(neighbour))) continue;

    const probe: Unit = { ...unit, at: neighbour };
    if (intentFor(deck, state, probe, target).kind !== "attack") continue;

    const towards = hexCentre(geometry, neighbour);
    const dx = towards.x - centre.x;
    const dy = towards.y - centre.y;
    const span = Math.hypot(dx, dy) || 1;
    /* How well this side matches where the pointer is, and standing still is
       worth a nudge so a drone already in place does not shuffle. */
    const score = (dx / span) * wantX + (dy / span) * wantY + (standing ? 0.35 : 0);
    if (best === null || score > best.score) best = { at: neighbour, score };
  }
  return best === null ? null : best.at;
}
