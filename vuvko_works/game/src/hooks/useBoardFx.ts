/**
 * The board's half of the animation contract.
 *
 * `useReveal` handles the chrome — names, values, log lines — where the kit
 * wants text descrambling into place. This is the other half: what happens on
 * the map itself, which the kit gives three named effects for. A move is a
 * `wake`, a melee hit is an `impact`, a shot is an `edgeBurst`. Nothing here
 * decides anything; the store has already committed the truth and these only
 * decide how long the board takes to admit it.
 *
 * Two things make driving a CSS-pixel library from SVG work. `wake` takes a
 * `place` callback — the library's whole portability story — so a step becomes
 * an `x`/`y` attribute rather than `style.left`. And every parameter of
 * `impact` and `edgeBurst` is guarded, so an SVG board can hand over the
 * elements it actually has and leave the rest null.
 */

import { useEffect } from "react";
import { clearGhosts, edgeBurst, impact, wake } from "../vendor/derelict-fx";
import type { WakePos } from "../vendor/derelict-fx";
import type { GameEvent } from "../core/events";
import type { Axial, Point } from "../core/hex";

/** How far above a token its damage number floats, in hex widths. */
const DAMAGE_RISE = 0.55;

/**
 * The route the token takes, and the face it wears while taking it.
 *
 * A move arrives as one `unitMoved` per hex because the reducer only ever
 * takes one step — that is what keeps a walk undoable step by step — so the
 * path has to be re-assembled here from the batch.
 */
function routeOf(batch: readonly GameEvent[]): {
  unitId: number;
  hexes: Axial[];
  from: Axial;
} | null {
  const moves = batch.filter(function isMove(event) {
    return event.kind === "unitMoved";
  });
  const first = moves[0];
  if (first === undefined) return null;
  const hexes: Axial[] = [];
  for (const step of moves) {
    if (step.unitId !== first.unitId) break;
    hexes.push(step.to);
  }
  return { unitId: first.unitId, hexes, from: first.from };
}

/** The blow, if this batch was one. */
function blowOf(batch: readonly GameEvent[]): {
  attackerId: number;
  targetId: number;
  melee: boolean;
  damage: number;
} | null {
  const declared = batch.find(function isDeclaration(event) {
    return event.kind === "attackDeclared";
  });
  if (declared === undefined || declared.targetIsObject) return null;
  /* Narrowed in two steps on purpose: a predicate that closes over `declared`
     is not a type predicate, and the damage comes back untyped. */
  const landings = batch.filter(function isLanding(event) {
    return event.kind === "strikeLanded";
  });
  const landed = landings.find(function onTarget(event) {
    return event.targetId === declared.targetId;
  });
  return {
    attackerId: declared.attackerId,
    targetId: declared.targetId,
    melee: declared.weapon.weaponClass === "melee",
    damage: landed === undefined ? 0 : landed.damage,
  };
}

export interface BoardFxProps {
  /** The svg the tokens live in — everything is found by query inside it. */
  readonly root: SVGSVGElement | null;
  /** The beat the store just published. */
  readonly batch: readonly GameEvent[];
  /** Where a hex sits, in the same user units the tokens are drawn in. */
  readonly centreOf: (at: Axial) => Point | null;
  /** One hex across, so the effects can size themselves to the board. */
  readonly unit: number;
  /** What a unit looks like, so the flyer wears the right face and colour. */
  readonly faceOf: (unitId: number) => { label: string; colour: string };
}

/** Nudge an SVG element to a point without going through the layout engine. */
function put(el: Element | null, at: Point): void {
  if (el === null) return;
  el.setAttribute("x", String(at.x));
  el.setAttribute("y", String(at.y));
}

/**
 * What `wake` calls to move the token one tile.
 *
 * The library's default writes `style.left` and `style.top`, which an SVG
 * element does not have; this is the whole of what it takes to run the kit's
 * movement on a board that is not laid out in CSS pixels.
 */
function placeHex(el: Element, pos: WakePos): void {
  const { x, y } = pos;
  if (typeof x === "number" && typeof y === "number") put(el, { x, y });
}

export function useBoardFx({ root, batch, centreOf, unit, faceOf }: BoardFxProps): void {
  useEffect(
    function play() {
      if (root === null || batch.length === 0) return;
      const board = root;
      function find(selector: string): SVGElement | null {
        return board.querySelector<SVGElement>(selector);
      }
      const flyer = find("[data-fx-flyer]");
      const edge = find("[data-fx-edge]");
      const damageEl = find("[data-fx-damage]");

      const route = routeOf(batch);
      if (route !== null && flyer !== null) {
        const walker = flyer;
        const token = find(`[data-unit="${String(route.unitId)}"]`);
        const start = centreOf(route.from);
        const path: WakePos[] = [];
        for (const hex of route.hexes) {
          const centre = centreOf(hex);
          if (centre !== null) path.push({ x: centre.x, y: centre.y });
        }
        if (start !== null) put(flyer, start);
        flyer.setAttribute("fill", faceOf(route.unitId).colour);
        flyer.style.opacity = "1";
        /* The store already moved the real token; the flyer is what the eye
           follows, so the token waits until the route has been walked. */
        if (token !== null) token.style.opacity = "0";
        function done(): void {
          walker.style.opacity = "0";
          if (token !== null) token.style.removeProperty("opacity");
          clearGhosts(walker.parentNode ?? undefined);
        }
        clearGhosts(flyer.parentNode ?? undefined);
        const running = wake(flyer, path, {
          label: faceOf(route.unitId).label,
          place: placeHex,
          onDone: done,
        });
        return function drop() {
          running.cancel();
          done();
        };
      }

      const blow = blowOf(batch);
      if (blow === null) return;
      const attacker = find(`[data-glyph="${String(blow.attackerId)}"]`);
      const target = find(`[data-unit="${String(blow.targetId)}"]`);
      const targetGlyph = find(`[data-glyph="${String(blow.targetId)}"]`);
      /* Both effects want somewhere to put the spark and the number. The edge
         sits between the two tokens for a melee and on the target for a shot,
         which is the difference the kit draws between them. */
      const targetAt = target === null ? null : centreFromToken(target);
      const attackerAt = attacker === null ? null : centreFromToken(attacker);
      if (targetAt !== null) {
        put(damageEl, { x: targetAt.x, y: targetAt.y - unit * DAMAGE_RISE });
        const mid =
          attackerAt === null || !blow.melee
            ? targetAt
            : { x: (attackerAt.x + targetAt.x) / 2, y: (attackerAt.y + targetAt.y) / 2 };
        put(edge, mid);
      }

      const damage = blow.damage > 0 ? `-${String(blow.damage)}` : "";
      function clean(): void {
        if (target !== null) {
          target.style.removeProperty("opacity");
          target.style.removeProperty("filter");
        }
        if (edge !== null) edge.style.opacity = "0";
        if (damageEl !== null) damageEl.style.opacity = "0";
      }
      const running = blow.melee
        ? impact({
            attacker,
            target: targetGlyph,
            edge,
            damageEl,
            damage,
            targetLabel: faceOf(blow.targetId).label,
            onDone: clean,
          })
        : edgeBurst({ target, edge, damageEl, damage, onDone: clean });
      return function drop() {
        running.cancel();
        clean();
        if (targetGlyph !== null) targetGlyph.textContent = faceOf(blow.targetId).label;
      };
    },
    [root, batch, centreOf, unit, faceOf],
  );
}

/** Where a token is, read back off the circle the board drew for it. */
function centreFromToken(token: SVGElement): Point | null {
  const dot = token.matches("circle") ? token : token.querySelector("circle");
  if (dot === null) {
    const x = token.getAttribute("x");
    const y = token.getAttribute("y");
    if (x === null || y === null) return null;
    return { x: Number(x), y: Number(y) };
  }
  return { x: Number(dot.getAttribute("cx")), y: Number(dot.getAttribute("cy")) };
}
