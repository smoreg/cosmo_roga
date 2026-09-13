import { describe, expect, it } from "vitest";
import { useGameStore } from "./game-store";
import { moveUnit, endTurn } from "../core/commands";
import { hexNeighbours, hexKey } from "../core/hex";
import { intentFor } from "../core/intent";
import raw from "../assets/decks/hollow-tide-35ft.json";
import type { RawDeckExport } from "../core/deck";

function boarded() {
  const store = useGameStore.getState();
  store.start(raw as unknown as RawDeckExport, { seed: "undo" });
  return useGameStore.getState();
}

describe("taking an action back", () => {
  it("has nothing to take back before anything is done", () => {
    const store = boarded();
    expect(store.canUndo()).toBe(false);
  });

  it("takes back a move, and puts the drone where it was", () => {
    const store = boarded();
    const deck = store.deck!;
    const drone = store.state!.units.find((unit) => unit.side === "drone")!;
    const step = hexNeighbours(drone.at).find(
      (at) => intentFor(deck, store.state!, drone, at).kind === "move",
    )!;

    useGameStore.getState().dispatch(moveUnit(drone.id, step));
    const after = useGameStore.getState();
    expect(hexKey(after.state!.units.find((u) => u.id === drone.id)!.at)).toBe(hexKey(step));
    expect(after.canUndo()).toBe(true);

    after.undo();
    const back = useGameStore.getState();
    expect(hexKey(back.state!.units.find((u) => u.id === drone.id)!.at)).toBe(hexKey(drone.at));
    expect(back.history).toHaveLength(0);
    expect(back.canUndo()).toBe(false);
  });

  it("refuses to take back a turn, because the ship moved on its own roll", () => {
    const store = boarded();
    store.dispatch(endTurn());
    const after = useGameStore.getState();
    expect(after.history).toHaveLength(1);
    expect(after.canUndo()).toBe(false);

    /* And calling it anyway changes nothing, rather than quietly rewinding. */
    const before = after.state;
    after.undo();
    expect(useGameStore.getState().state).toBe(before);
  });

  it("will not reach back past something that was revealed", () => {
    /* A move after a sealed turn is still yours to take back; the turn before
       it is not. Undo walks back to the seal and stops. */
    const store = boarded();
    store.dispatch(endTurn());
    const deck = useGameStore.getState().deck!;
    const state = useGameStore.getState().state!;
    const drone = state.units.find((unit) => unit.side === "drone" && unit.movement > 0);
    if (drone === undefined) return;
    const step = hexNeighbours(drone.at).find(
      (at) => intentFor(deck, state, drone, at).kind === "move",
    );
    if (step === undefined) return;

    useGameStore.getState().dispatch(moveUnit(drone.id, step));
    expect(useGameStore.getState().canUndo()).toBe(true);
    useGameStore.getState().undo();
    expect(useGameStore.getState().history).toHaveLength(1);
    expect(useGameStore.getState().canUndo()).toBe(false);
  });
});
