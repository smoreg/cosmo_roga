import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DeckView } from "./DeckView";
import { useGameStore } from "../../stores/game-store";
import { deckGeometry, parseDeck } from "../../core/deck";
import type { RawDeckExport } from "../../core/deck";
import { buildMission, makeUnit } from "../../core/mission";
import { hexNeighbours } from "../../core/hex";
import type { GameEvent } from "../../core/events";
import type { Weapon } from "../../core/types";
import raw from "../../assets/decks/hollow-tide-35ft.json";
import { FRAME } from "../../vendor/derelict-fx";

const KNIFE: Weapon = { name: "welder", weaponClass: "melee", damage: 3, strikes: 1 };
const GUN: Weapon = { name: "emitter", weaponClass: "ranged", damage: 2, strikes: 2 };

function board() {
  const deck = parseDeck(raw as unknown as RawDeckExport);
  const mission = buildMission(deck, { seed: "fx" });
  /* The fixture opens with nothing aboard — the ship builds its units as the
     mission runs — so the test puts one next to a drone itself. */
  const ours = mission.state.units.find(function drone(unit) {
    return unit.side === "drone";
  })!;
  const scout = makeUnit("scout", 90, hexNeighbours(ours.at)[0]!, deckGeometry(deck).feetAcross);
  const state = { ...mission.state, units: [...mission.state.units, scout] };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(function first() {
    root.render(<DeckView deck={mission.deck} state={state} />);
  });
  return {
    state,
    host,
    beat(batch: readonly GameEvent[]) {
      act(function publish() {
        useGameStore.setState({ lastBatch: [...batch] });
      });
    },
    edge() {
      return host.querySelector<SVGElement>("[data-fx-edge]");
    },
    drop() {
      act(function stop() {
        root.unmount();
      });
      host.remove();
    },
  };
}

function blow(weapon: Weapon, attackerId: number, targetId: number): GameEvent[] {
  return [
    {
      kind: "attackDeclared",
      attackerId,
      targetId,
      targetIsObject: false,
      weapon,
      answeringWeapon: null,
    },
    {
      kind: "strikeLanded",
      sourceId: attackerId,
      targetId,
      targetIsObject: false,
      damage: 3,
      remaining: 9,
    },
  ];
}

afterEach(function tidy() {
  useGameStore.setState({ lastBatch: [] });
  document.body.replaceChildren();
});

describe("the board's combat effects", function suite() {
  it("lights the edge when a blow is published", async function fires() {
    const view = board();
    const drone = view.state.units.find(function ours(unit) {
      return unit.side === "drone";
    });
    const enemy = view.state.units.find(function theirs(unit) {
      return unit.side === "ship";
    });
    expect(drone, "the fixture has a drone").toBeDefined();
    expect(enemy, "the fixture has something to hit").toBeDefined();
    expect(view.edge(), "the board lends the effects an edge element").not.toBeNull();

    for (const weapon of [KNIFE, GUN]) {
      view.edge()?.style.removeProperty("opacity");
      view.beat(blow(weapon, drone!.id, enemy!.id));
      /* The kit lights the edge on the beat after the blow is declared, so
         the assertion has to be past one frame and inside the next. */
      await act(async function tick() {
        await new Promise(function soon(done) {
          setTimeout(done, FRAME * 1.6);
        });
      });
      expect(view.edge()?.style.opacity, weapon.weaponClass).toBe("1");
      /* And it has to be a colour, not a fill the library cannot reach:
         `style.color` only paints here because the board fills from it. */
      expect(view.edge()?.getAttribute("fill"), weapon.weaponClass).toBe("currentColor");
    }
    view.drop();
  });
});
