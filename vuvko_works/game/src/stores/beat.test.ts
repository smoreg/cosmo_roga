import { describe, expect, it } from "vitest";
import { useGameStore } from "./game-store";
import { attackWith, moveUnit } from "../core/commands";
import { hexNeighbours } from "../core/hex";
import { intentFor } from "../core/intent";
import raw from "../assets/decks/hollow-tide-35ft.json";
import type { RawDeckExport } from "../core/deck";

function boarded() {
  useGameStore.getState().start(raw as unknown as RawDeckExport, { seed: "beat" });
  return useGameStore.getState();
}

/** The batch is published a microtask after the dispatches that filled it. */
async function settled() {
  await Promise.resolve();
  await Promise.resolve();
  return useGameStore.getState().lastBatch;
}

describe("the published beat", function suite() {
  it("carries a whole walk, not its last step", async function walk() {
    const store = boarded();
    const deck = store.deck!;
    let drone = store.state!.units.find(function ours(unit) {
      return unit.side === "drone";
    })!;

    let taken = 0;
    for (let step = 0; step < 3; step++) {
      const state = useGameStore.getState().state!;
      const next = hexNeighbours(drone.at).find(function open(at) {
        return intentFor(deck, state, drone, at).kind === "move";
      });
      if (next === undefined) break;
      useGameStore.getState().dispatch(moveUnit(drone.id, next));
      taken++;
      drone = useGameStore.getState().state!.units.find(function same(unit) {
        return unit.id === drone.id;
      })!;
    }

    expect(taken).toBeGreaterThan(1);
    const batch = await settled();
    const moves = batch.filter(function isMove(event) {
      return event.kind === "unitMoved";
    });
    expect(moves).toHaveLength(taken);
  });

  it("carries an attack, which is what the combat effects play", async function hit() {
    const store = boarded();
    const drone = store.state!.units.find(function ours(unit) {
      return unit.side === "drone";
    })!;
    const enemy = store.state!.units.find(function theirs(unit) {
      return unit.side === "ship" && unit.hp > 0;
    });
    if (enemy === undefined) return;

    /* Straight to the declaration: the point is what the store publishes, not
       how a drone got into range. */
    useGameStore.getState().dispatch(attackWith(drone.id, 0, enemy.at));
    const batch = await settled();
    expect(
      batch.some(function declared(event) {
        return event.kind === "attackDeclared";
      }),
    ).toBe(true);
  });
});
