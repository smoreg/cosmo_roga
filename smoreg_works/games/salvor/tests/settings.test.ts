// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MENU_MUSIC, music } from "../src/ui/react/audio.js";
import {
  BASE_FRAME,
  DEFAULT_MOTION,
  DEFAULT_VOLUME,
  FRAME_MS,
  isMotion,
  rememberMotion,
  rememberVolume,
  setMotion,
  storedMotion,
  storedVolume,
  type Store,
} from "../src/ui/react/settings.js";

/** A store that answers, and one that refuses everything. */
const kept = (): Store => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
};
const hostile: Store = {
  getItem: () => {
    throw new Error("no");
  },
  setItem: () => {
    throw new Error("no");
  },
};

describe("what a player sets", () => {
  it("starts the music at half, and half is what half sounds like", () => {
    expect(DEFAULT_VOLUME).toBe(0.5);
    music.setVolume(DEFAULT_VOLUME);
    music.play(MENU_MUSIC);
    /* `HTMLAudioElement.volume` is linear amplitude: a half is six decibels
       down, which is heard as about seven tenths as loud. The position is
       squared on the way through, so the middle of the slider is a quarter of
       the amplitude — which is what a middle sounds like. */
    expect(music.volumeNow()).toBeCloseTo(0.25, 6);
    music.setVolume(1);
    expect(music.volumeNow()).toBe(1);
    music.setVolume(0);
    expect(music.volumeNow()).toBe(0);
  });

  it("keeps the volume between none and all, whatever it is handed", () => {
    const store = kept();
    rememberVolume(2, store);
    expect(storedVolume(store)).toBe(1);
    rememberVolume(-1, store);
    expect(storedVolume(store)).toBe(0);
    store.setItem("salvor.volume", "not a number");
    expect(storedVolume(store)).toBe(DEFAULT_VOLUME);
  });

  it("moves at one frame of 225ms unless told otherwise", () => {
    expect(DEFAULT_MOTION).toBe("normal");
    expect(FRAME_MS.normal).toBe(BASE_FRAME);
    /* Faster is the same design at twice the speed, and instant is the off
       switch — not a very small frame, which would be a flicker. */
    expect(FRAME_MS.faster).toBe(BASE_FRAME / 2);
    expect(FRAME_MS.instant).toBe(0);
  });

  it("writes the motion into the page, where every keyframe reads it", () => {
    setMotion("faster");
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--sv-frame")).toBe("112.5ms");
    expect(root.getPropertyValue("--sv-frame-2")).toBe("225ms");
    setMotion("instant");
    expect(root.getPropertyValue("--sv-frame")).toBe("0ms");
    setMotion("normal");
    expect(root.getPropertyValue("--sv-frame")).toBe("225ms");
  });

  it("remembers both, and survives a storage that refuses", () => {
    const store = kept();
    rememberMotion("instant", store);
    expect(storedMotion(store)).toBe("instant");
    store.setItem("salvor.motion", "sideways");
    expect(storedMotion(store)).toBe(DEFAULT_MOTION);

    /* Private mode, a full quota, site data switched off. The setting is lost
       and nothing else is. */
    expect(() => {
      rememberVolume(0.3, hostile);
      rememberMotion("faster", hostile);
    }).not.toThrow();
    expect(storedVolume(hostile)).toBe(DEFAULT_VOLUME);
    expect(storedMotion(hostile)).toBe(DEFAULT_MOTION);
  });

  it("knows a motion from anything else", () => {
    for (const m of ["instant", "faster", "normal"]) expect(isMotion(m)).toBe(true);
    for (const m of ["fast", "", null, 2, undefined]) expect(isMotion(m)).toBe(false);
  });
});
