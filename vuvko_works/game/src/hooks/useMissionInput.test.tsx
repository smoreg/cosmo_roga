import { REFERENCE_HEX_FEET } from "../core/roster";
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMissionInput } from "./useMissionInput";
import type { MissionInput } from "./useMissionInput";
import { applyCommand } from "../core/apply";
import type { Command } from "../core/commands";
import { deckGeometry, parseDeck } from "../core/deck";
import type { RawDeckExport } from "../core/deck";
import { hexCentre, hexKey, hexNeighbours } from "../core/hex";
import type { Axial } from "../core/hex";
import { buildMission, makeUnit } from "../core/mission";
import { reachableHexes } from "../core/intent";
import { canReachAcross } from "../core/topology";
import type { GameState } from "../core/types";
import raw from "../assets/decks/hollow-tide-35ft.json";

function mount(seedState?: (state: GameState) => GameState) {
  const deck = parseDeck(raw as unknown as RawDeckExport);
  const mission = buildMission(deck, { seed: "input" });
  let state = seedState === undefined ? mission.state : seedState(mission.state);
  const sent: Command[] = [];

  const captured: { input: MissionInput | null } = { input: null };
  function Probe() {
    captured.input = useMissionInput(deck, state, function send(command) {
      sent.push(command);
      state = applyCommand(deck, state, command).state;
    });
    return null;
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function draw() {
    act(() => {
      root.render(<Probe />);
    });
  }
  draw();
  return {
    deck,
    geometry: deckGeometry(deck),
    sent,
    draw,
    get input() {
      if (captured.input === null) throw new Error("not mounted");
      return captured.input;
    },
    get state() {
      return state;
    },
    stop() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function select(harness: ReturnType<typeof mount>, at: Axial) {
  act(() => {
    harness.input.hover(hexCentre(harness.geometry, at));
  });
  harness.draw();
  act(() => {
    harness.input.pick();
  });
  harness.draw();
}

describe("moving by route", () => {
  it("plans a chain of steps to a hex several away, not just a neighbour", () => {
    const harness = mount();
    const drone = harness.state.units[0]!;
    select(harness, drone.at);
    expect(harness.input.selected?.id).toBe(drone.id);

    /* Find somewhere two or more steps off. */
    const far = [...reachableHexes(harness.deck, harness.state, drone).entries()].find(
      ([, left]) => left <= drone.movement - 2,
    );
    expect(far).toBeDefined();
    const [q, r] = far![0].split(",").map(Number);

    act(() => {
      harness.input.hover(hexCentre(harness.geometry, { q: q!, r: r! }));
    });
    harness.draw();

    const plan = harness.input.plan;
    expect(plan).not.toBeNull();
    expect(plan!.arrows.length).toBeGreaterThan(1);
    expect(plan!.arrows.every((step) => step.kind === "move")).toBe(true);
    expect(hexKey(plan!.arrows.at(-1)!.to)).toBe(far![0]);

    act(() => {
      harness.input.pick();
    });
    harness.draw();
    /* One command per step: the reducer only ever takes single steps. */
    expect(harness.sent.filter((command) => command.kind === "moveUnit")).toHaveLength(
      plan!.arrows.length,
    );
    expect(hexKey(harness.state.units[0]!.at)).toBe(far![0]);
    harness.stop();
  });

  it("refuses a hex beyond this turn's movement, and says why", () => {
    const harness = mount();
    const drone = harness.state.units[0]!;
    select(harness, drone.at);

    const reach = reachableHexes(harness.deck, harness.state, drone);
    const far = [...harness.deck.cells.values()].find(
      (cell) => !reach.has(hexKey(cell.at)) && hexKey(cell.at) !== hexKey(drone.at),
    );
    expect(far).toBeDefined();
    act(() => {
      harness.input.hover(hexCentre(harness.geometry, far!.at));
    });
    harness.draw();
    expect(harness.input.plan?.why).not.toBeNull();
    expect(harness.input.plan?.stopAt).toBeNull();
    harness.stop();
  });
});

describe("approaching a hostile", () => {
  it("stops on the side the cursor is on, and ends in a red arrow", () => {
    /* Find a hostile the drone could reach from more than one side — and judge
       that against the state with the hostile already on the board, because
       its zone of control changes what is reachable. */
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const base = buildMission(deck, { seed: "input" }).state;
    const drone = base.units[0]!;

    let target: Axial | null = null;
    let sides: Axial[] = [];
    for (const cell of deck.cells.values()) {
      if (hexKey(cell.at) === hexKey(drone.at)) continue;
      if (base.objects.some((object) => hexKey(object.at) === hexKey(cell.at))) continue;
      if (base.units.some((unit) => hexKey(unit.at) === hexKey(cell.at))) continue;

      const staged: GameState = {
        ...base,
        units: [drone, makeUnit("scout", 90, cell.at, REFERENCE_HEX_FEET)],
      };
      const reach = reachableHexes(deck, staged, drone);
      const usable = hexNeighbours(cell.at).filter(function approachable(side) {
        if (hexKey(side) === hexKey(drone.at)) return false;
        if (!reach.has(hexKey(side))) return false;
        if (staged.objects.some((object) => hexKey(object.at) === hexKey(side))) return false;
        return canReachAcross(deck, staged, side, cell.at);
      });
      if (usable.length >= 2) {
        target = cell.at;
        sides = usable;
        break;
      }
    }
    expect(target).not.toBeNull();
    expect(sides.length).toBeGreaterThan(1);

    const harness = mount(function place(state) {
      return {
        ...state,
        units: [state.units[0]!, makeUnit("scout", 90, target!, REFERENCE_HEX_FEET)],
      };
    });
    select(harness, harness.state.units[0]!.at);

    const centre = hexCentre(harness.geometry, target!);
    const stops = new Set<string>();

    for (const side of sides) {
      const towards = hexCentre(harness.geometry, side);
      /* Hover just inside the hostile's hex, leaning toward one side. */
      act(() => {
        harness.input.hover({
          x: centre.x + (towards.x - centre.x) * 0.4,
          y: centre.y + (towards.y - centre.y) * 0.4,
        });
      });
      harness.draw();
      const plan = harness.input.plan;
      expect(plan).not.toBeNull();
      expect(plan!.attackAt).not.toBeNull();

      expect(hexKey(plan!.attackAt!)).toBe(hexKey(target!));
      expect(plan!.arrows.at(-1)?.kind).toBe("attack");
      expect(plan!.arrows.slice(0, -1).every((step) => step.kind === "move")).toBe(true);

      /* It stopped beside the target, on the side the cursor leaned to. */
      const stopAt = plan!.arrows.at(-1)!.from;
      expect(hexKey(stopAt)).toBe(hexKey(side));
      stops.add(hexKey(stopAt));
    }

    /* Leaning different ways must actually change where it stops, or the
       cursor is not deciding anything. */
    expect(stops.size).toBe(sides.length);
    harness.stop();
  });

  it("does not shuffle around a hostile it is already beside", () => {
    /* Standing still is worth a nudge: a small lean must not make a drone walk
       around something it can already hit. */
    const deck = parseDeck(raw as unknown as RawDeckExport);
    const base = buildMission(deck, { seed: "input" }).state;
    const drone = base.units[0]!;
    const beside = hexNeighbours(drone.at).find(function free(at) {
      if (!deck.cells.has(hexKey(at))) return false;
      if (base.objects.some((object) => hexKey(object.at) === hexKey(at))) return false;
      if (base.units.some((unit) => hexKey(unit.at) === hexKey(at))) return false;
      return canReachAcross(deck, base, drone.at, at);
    });
    expect(beside).toBeDefined();

    const harness = mount(function place(state) {
      return {
        ...state,
        units: [state.units[0]!, makeUnit("scout", 91, beside!, REFERENCE_HEX_FEET)],
      };
    });
    select(harness, harness.state.units[0]!.at);

    const centre = hexCentre(harness.geometry, beside!);
    const home = hexCentre(harness.geometry, drone.at);
    /* Lean mildly away from where the drone stands. */
    act(() => {
      harness.input.hover({
        x: centre.x - (home.x - centre.x) * 0.18,
        y: centre.y - (home.y - centre.y) * 0.18,
      });
    });
    harness.draw();

    const plan = harness.input.plan;
    expect(plan?.attackAt).not.toBeNull();
    expect(plan?.arrows).toHaveLength(1);
    expect(plan?.stopAt).toBeNull();
    expect(hexKey(plan!.arrows[0]!.from)).toBe(hexKey(drone.at));
    harness.stop();
  });
});
