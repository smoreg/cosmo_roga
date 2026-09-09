import type { Point } from "./grid.js";
import type { Entity } from "./entity.js";
import type { Rng } from "./rng.js";
import type { Effect, EffectContext, EffectOutcome } from "./effects.js";
import { applyEffects, applyEffectsToArea } from "./effects.js";
import { disc } from "./shapes.js";

/** Three slots, keys 1/2/3. Anything more needs an inventory screen, and an
 *  inventory screen is the classic jam time sink. */
export const INVENTORY_SLOTS = 3;

export type TargetingMode =
  | { kind: "self" }
  | { kind: "adjacent" }
  | { kind: "ranged"; range: number }
  | { kind: "area"; range: number; radius: number };

export interface ItemKind {
  id: string;
  name: string;
  ch: string;
  fg: string;
  targeting: TargetingMode;
  effects: readonly Effect[];
  /** Uses before the item is gone. 1 = single-use potion/scroll. */
  charges: number;
  minDepth: number;
  maxDepth: number;
  weight: number;
}

export interface ItemInstance {
  kindId: string;
  charges: number;
}

export interface FloorItem {
  pos: Point;
  item: ItemInstance;
}

export function makeItem(kind: ItemKind): ItemInstance {
  return { kindId: kind.id, charges: kind.charges };
}

export interface ItemRegistry {
  get(id: string): ItemKind | undefined;
  all(): readonly ItemKind[];
}

export function registry(kinds: readonly ItemKind[]): ItemRegistry {
  const byId = new Map(kinds.map((k) => [k.id, k]));
  return {
    get: (id) => byId.get(id),
    all: () => kinds,
  };
}

export function inventoryOf(e: Entity): ItemInstance[] {
  if (!e.inventory) e.inventory = [];
  return e.inventory;
}

export function inventoryFull(e: Entity): boolean {
  return inventoryOf(e).length >= INVENTORY_SLOTS;
}

export interface PickupResult {
  ok: boolean;
  reason?: string;
}

export function pickUp(e: Entity, item: ItemInstance): PickupResult {
  const inv = inventoryOf(e);
  if (inv.length >= INVENTORY_SLOTS) return { ok: false, reason: "Your hands are full." };
  inv.push(item);
  return { ok: true };
}

export function dropSlot(e: Entity, slot: number): ItemInstance | undefined {
  const inv = inventoryOf(e);
  if (slot < 0 || slot >= inv.length) return undefined;
  return inv.splice(slot, 1)[0];
}

export interface UseResult {
  ok: boolean;
  reason?: string;
  outcome?: EffectOutcome;
  /** The item was spent and removed from the inventory. */
  consumed: boolean;
}

/**
 * Use the item in `slot`. `target` is required for anything but self-targeting;
 * validating range is the caller's job (see targeting.ts) so that the UI can
 * show why a shot is refused before the turn is spent.
 */
export function useItem(
  ctx: EffectContext,
  reg: ItemRegistry,
  user: Entity,
  slot: number,
  target?: Entity | Point,
): UseResult {
  const inv = inventoryOf(user);
  const instance = inv[slot];
  if (!instance) return { ok: false, reason: "Nothing in that slot.", consumed: false };

  const kind = reg.get(instance.kindId);
  if (!kind) return { ok: false, reason: "Unknown item.", consumed: false };

  let outcome: EffectOutcome;
  switch (kind.targeting.kind) {
    case "self":
      outcome = applyEffects(ctx, user, user, kind.effects);
      break;

    case "adjacent":
    case "ranged": {
      const victim = asEntity(target);
      if (!victim) return { ok: false, reason: "No target.", consumed: false };
      outcome = applyEffects(ctx, user, victim, kind.effects);
      break;
    }

    case "area": {
      const at = asPoint(target);
      if (!at) return { ok: false, reason: "No target.", consumed: false };
      outcome = applyEffectsToArea(ctx, user, disc(at, kind.targeting.radius), kind.effects);
      break;
    }
  }

  instance.charges--;
  const consumed = instance.charges <= 0;
  if (consumed) inv.splice(slot, 1);
  return { ok: true, outcome, consumed };
}

function asEntity(t: Entity | Point | undefined): Entity | undefined {
  if (t && "hp" in t) return t;
  return undefined;
}

function asPoint(t: Entity | Point | undefined): Point | undefined {
  if (!t) return undefined;
  if ("hp" in t) return t.pos;
  return t;
}

/** Weighted roll for a drop appropriate to this depth. */
export function rollItem(reg: ItemRegistry, depth: number, rng: Rng): ItemKind | undefined {
  const eligible = reg.all().filter((k) => depth >= k.minDepth && depth <= k.maxDepth);
  if (eligible.length === 0) return undefined;
  const table: Record<string, number> = {};
  for (const k of eligible) table[k.id] = k.weight;
  const id = rng.weighted(table);
  return eligible.find((k) => k.id === id);
}
