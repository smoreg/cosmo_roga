import { beforeEach, describe, expect, it, vi } from "vitest";
import deckExport from "../assets/decks/hollow-tide-35ft.json";

/* Generating a hull rasterises tiles onto a canvas, which jsdom does not
   have. The flow being tested here is the one around generation, so the
   generator itself is stood in for by the deck that ships with the game. */
vi.mock("../render/generate", () => ({
  generateDeck: vi.fn(() => Promise.resolve(deckExport)),
  ensureLibrary: vi.fn(),
}));
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useGameStore } from "../stores/game-store";
import { useUiStore } from "../stores/ui-store";
import { MISSION_TYPES, SHIP_PROFILES } from "../core/missions";
import { createRng } from "../core/rng";

function mountPage() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<App />);
  });
  return {
    host,
    stop() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function buttonSaying(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined)
    throw new Error(
      `no button "${label}" — saw: ${[...host.querySelectorAll("button")]
        .map((b) => b.textContent)
        .join(" | ")}`,
    );
  return found;
}

/** Press Board it and wait for the hull to come back. */
async function board(host: HTMLElement): Promise<void> {
  buttonSaying(host, "Board it").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  /* A store is a module singleton; each test gets it back as it started. */
  useUiStore.setState({ screen: "briefing", returnTo: "title" });
  useGameStore.setState({
    brief: null,
    roller: createRng("flow"),
    deck: null,
    state: null,
    settings: null,
    history: [],
    events: [],
    unreachableRooms: [],
    nudgedPlacements: 0,
  });
});

describe("the run", () => {
  it("opens on a briefing with a contract already rolled", () => {
    const page = mountPage();
    expect(page.host.textContent).toContain("Derelict Extraction");

    const brief = useGameStore.getState().brief;
    expect(brief).not.toBeNull();
    expect(MISSION_TYPES).toContain(brief!.type);
    expect(SHIP_PROFILES).toContain(brief!.profile);

    /* The sheet says what was rolled. */
    expect(page.host.textContent).toContain(brief!.type.name);
    expect(page.host.textContent).toContain(brief!.profile.code);
    expect(page.host.textContent).toContain(brief!.seed);
    page.stop();
  });

  it("rolls a different contract on demand", () => {
    const page = mountPage();
    const first = useGameStore.getState().brief;

    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      act(() => {
        buttonSaying(page.host, "Roll again").dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      const brief = useGameStore.getState().brief;
      expect(brief).not.toBeNull();
      seen.add(brief!.profile.code);
    }
    expect(useGameStore.getState().brief?.seed).not.toBe(first?.seed);
    /* Not the same hull every time. */
    expect(seen.size).toBeGreaterThan(1);
    page.stop();
  });

  it("boards the ship, and the mission runs on the rolled seed", async () => {
    const page = mountPage();
    const brief = useGameStore.getState().brief;

    await board(page.host);
    const store = useGameStore.getState();
    expect(useUiStore.getState().screen).toBe("mission");
    expect(store.deck).not.toBeNull();
    expect(store.settings?.seed).toBe(brief!.seed);
    /* The map is on screen, not the briefing. */
    expect(page.host.querySelector("svg")).not.toBeNull();
    expect(page.host.textContent).toContain("End turn");
    page.stop();
  });

  it("shows the outcome when the mission ends, and goes back for the next one", async () => {
    const page = mountPage();
    await board(page.host);

    /* Win it outright by levelling the spawn zones. */
    act(() => {
      const store = useGameStore.getState();
      const flattened = store.state!.objects.map((object) =>
        object.kind === "spawner" ? { ...object, hp: 0 } : object,
      );
      useGameStore.setState({ state: { ...store.state!, objects: flattened, outcome: "win" } });
    });

    expect(page.host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(page.host.textContent).toContain("Ship secured");

    act(() => {
      buttonSaying(page.host, "Next contract").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(useUiStore.getState().screen).toBe("briefing");
    expect(useGameStore.getState().deck).toBeNull();
    /* And it remembers how the last one went. */
    expect(page.host.textContent).toContain("Last contract: secured.");
    /* With a fresh contract waiting. */
    expect(useGameStore.getState().brief).not.toBeNull();
    page.stop();
  });

  it("says so when both drones were lost", async () => {
    const page = mountPage();
    await board(page.host);
    act(() => {
      const store = useGameStore.getState();
      useGameStore.setState({ state: { ...store.state!, outcome: "loss" } });
    });
    expect(page.host.textContent).toContain("Contract lost");

    act(() => {
      buttonSaying(page.host, "Next contract").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(page.host.textContent).toContain("both drones lost");
    page.stop();
  });
});
