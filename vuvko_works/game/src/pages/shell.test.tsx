import { beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { JAM_NAME } from "../components/organisms/CreditsScreen";
import { DEFAULT_VOLUME, useSettingsStore } from "../stores/settings-store";
import { useUiStore } from "../stores/ui-store";

function mount() {
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

function press(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (button === undefined) {
    throw new Error(
      `no button "${label}" — saw: ${[...host.querySelectorAll("button")]
        .map((candidate) => candidate.textContent)
        .join(" | ")}`,
    );
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  useUiStore.setState({ screen: "splash", returnTo: "title" });
  useSettingsStore.setState({ volume: DEFAULT_VOLUME, muted: false });
});

describe("the shell", () => {
  it("opens on a splash that asks for the one gesture audio needs", () => {
    const page = mount();
    expect(page.host.textContent).toContain("Click to proceed");
    press(page.host, "Click to proceed");
    expect(useUiStore.getState().screen).toBe("loading");
    page.stop();
  });

  it("lists what it is loading, and only lets you on when it is done", () => {
    const page = mount();
    press(page.host, "Click to proceed");

    /* Every step is named, and the button is shut until they settle. */
    for (const label of ["Rules and renderer", "Typefaces", "Deck plans", "Music"]) {
      expect(page.host.textContent).toContain(label);
    }
    const gate = [...page.host.querySelectorAll("button")].at(-1);
    expect(gate?.disabled).toBe(true);
    expect(page.host.querySelector('[role="progressbar"]')).not.toBeNull();
    page.stop();
  });

  it("reaches the title, and both its other doors lead back", () => {
    const page = mount();
    act(() => {
      useUiStore.setState({ screen: "title" });
    });
    expect(page.host.textContent).toContain("New game");

    press(page.host, "Settings");
    expect(useUiStore.getState().screen).toBe("settings");
    press(page.host, "Back");
    expect(useUiStore.getState().screen).toBe("title");

    press(page.host, "Credits");
    expect(useUiStore.getState().screen).toBe("credits");
    press(page.host, "Back");
    expect(useUiStore.getState().screen).toBe("title");
    page.stop();
  });

  it("starts at half volume and remembers being turned down", () => {
    const page = mount();
    act(() => {
      useUiStore.setState({ screen: "settings", returnTo: "title" });
    });
    expect(useSettingsStore.getState().volume).toBe(0.5);
    expect(page.host.textContent).toContain("50%");

    const slider = page.host.querySelector<HTMLInputElement>('input[type="range"]');
    expect(slider).not.toBeNull();
    act(() => {
      useSettingsStore.getState().setVolume(0.2);
    });
    expect(page.host.textContent).toContain("20%");

    act(() => {
      useSettingsStore.getState().setMuted(true);
    });
    expect(page.host.textContent).toContain("muted");
    expect(useSettingsStore.getState().effectiveVolume()).toBe(0);
    page.stop();
  });

  it("credits everyone whose work is in the build", () => {
    const page = mount();
    act(() => {
      useUiStore.setState({ screen: "credits", returnTo: "title" });
    });
    const text = page.host.textContent ?? "";
    /* The two that are required by their terms, and the one held on a
       conditional permission. */
    expect(text).toContain("Eric Matyas");
    expect(text).toContain("soundimage.org");
    expect(text).toContain("Robert Pearce");
    expect(text).toContain("CC BY-NC 4.0");
    expect(text).toContain("3D63");
    expect(text).toContain("non-commercial");
    expect(text).toContain(`Created for ${JAM_NAME}`);
    page.stop();
  });

  it("stamps the build on every screen", () => {
    const page = mount();
    expect(page.host.textContent).toMatch(/\(WIP:build \S+\)/);
    act(() => {
      useUiStore.setState({ screen: "title" });
    });
    expect(page.host.textContent).toMatch(/\(WIP:build \S+\)/);
    page.stop();
  });
});
