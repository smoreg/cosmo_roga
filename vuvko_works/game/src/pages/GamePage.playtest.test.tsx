import { describe, expect, it } from "vitest";
import { applyCommand } from "../core/apply";
import { endTurn } from "../core/commands";
import { parseDeck } from "../core/deck";
import type { RawDeckExport } from "../core/deck";
import { hexKey } from "../core/hex";
import { intentFor, reachableHexes } from "../core/intent";
import { buildMission } from "../core/mission";
import { drones, hostiles, liveNodes, unitById } from "../core/topology";
import type { Command } from "../core/commands";
import type { GameState } from "../core/types";
import raw from "../assets/decks/hollow-tide-35ft.json";

/**
 * Can a person actually play a turn?
 *
 * This drives the same commands the UI dispatches, in the same order a pair of
 * hands would: pick a drone, walk it, cut a door, hit something, end the turn.
 * If this passes, the app is playable; if it does not, no amount of rendering
 * will save it.
 */
describe("a playable turn", () => {
  it("walks a drone, and the walk costs what it should", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "playtest" });
    const drone = mission.state.units[0];
    expect(drone).toBeDefined();

    const reach = reachableHexes(deck, mission.state, drone!);
    expect(reach.size).toBeGreaterThan(3);

    let state: GameState = mission.state;
    let moves = 0;
    for (const key of reach.keys()) {
      const [q, r] = key.split(",").map(Number);
      const target = { q: q!, r: r! };
      const current = unitById(state, drone!.id);
      if (current === null) break;
      if (intentFor(deck, state, current, target).kind !== "move") continue;
      const result = applyCommand(deck, state, { kind: "moveUnit", unitId: drone!.id, to: target });
      if (result.events.some((event) => event.kind === "unitMoved")) {
        state = result.state;
        moves++;
      }
      if (moves >= 2) break;
    }
    expect(moves).toBeGreaterThan(0);
    const after = unitById(state, drone!.id);
    expect(after?.movement).toBeLessThan(drone!.maxMovement);
  });

  it("cuts a locked door open and then walks through it", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const door = deck.doors.find((candidate) => candidate.initialState === "locked");
    expect(door).toBeDefined();

    for (let attempt = 0; attempt < 25; attempt++) {
      const mission = buildMission(deck, { seed: `cut-${String(attempt)}` });
      const drone = { ...mission.state.units[0]!, at: door!.from };
      let state: GameState = { ...mission.state, units: [drone] };

      const cut = applyCommand(deck, state, {
        kind: "attackWith",
        attackerId: drone.id,
        weaponIndex: 0,
        target: door!.to,
      });
      if (!cut.events.some((event) => event.kind === "doorCut")) continue;
      state = cut.state;
      expect(state.doorStates.get(door!.id)).toBe("broken");

      /* Next turn it can walk through what it cut. */
      const next = applyCommand(deck, state, endTurn()).state;
      const ready = unitById(next, drone.id);
      if (ready === null) continue;
      expect(intentFor(deck, next, ready, door!.to).kind).not.toBe("refused");
      return;
    }
    throw new Error("never landed a strike on the door in 25 seeds");
  });

  it("plays ten turns of real commands without the rules refusing anything unexpected", () => {
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const mission = buildMission(deck, { seed: "ten-turns" });
    let state = mission.state;
    const history: Command[] = [];
    let attacks = 0;

    for (let turn = 0; turn < 10 && state.outcome === null; turn++) {
      for (const drone of drones(state)) {
        /* Attack something adjacent if there is anything worth hitting. */
        let acted = false;
        for (const neighbour of [
          { q: drone.at.q + 1, r: drone.at.r },
          { q: drone.at.q + 1, r: drone.at.r - 1 },
          { q: drone.at.q, r: drone.at.r + 1 },
          { q: drone.at.q, r: drone.at.r - 1 },
          { q: drone.at.q - 1, r: drone.at.r + 1 },
          { q: drone.at.q - 1, r: drone.at.r },
        ]) {
          const current = unitById(state, drone.id);
          if (current === null) break;
          if (intentFor(deck, state, current, neighbour).kind !== "attack") continue;
          const command: Command = {
            kind: "attackWith",
            attackerId: drone.id,
            weaponIndex: 1,
            target: neighbour,
          };
          const result = applyCommand(deck, state, command);
          expect(result.events[0]?.kind).not.toBe("commandRefused");
          state = result.state;
          history.push(command);
          attacks++;
          acted = true;
          break;
        }
        if (acted) continue;

        const current = unitById(state, drone.id);
        if (current === null) continue;
        for (const key of reachableHexes(deck, state, current).keys()) {
          const [q, r] = key.split(",").map(Number);
          const to = { q: q!, r: r! };
          const now = unitById(state, drone.id);
          if (now === null) break;
          if (intentFor(deck, state, now, to).kind !== "move") continue;
          const command: Command = { kind: "moveUnit", unitId: drone.id, to };
          state = applyCommand(deck, state, command).state;
          history.push(command);
          break;
        }
      }
      state = applyCommand(deck, state, endTurn()).state;
      history.push(endTurn());
    }

    expect(history.length).toBeGreaterThan(10);
    expect(attacks).toBeGreaterThan(0);
    expect(hostiles(state).length).toBeGreaterThan(0);
    /* The scripted player hits whatever is adjacent, so it will happily cut a
       node it walks past — which is the source-versus-symptom choice working,
       not a fault. It just cannot gain nodes. */
    expect(liveNodes(state).length).toBeLessThanOrEqual(6);
    expect(liveNodes(state).length).toBeGreaterThan(0);
    expect(hexKey(state.units[0]!.at)).toBeTypeOf("string");
  });
});
